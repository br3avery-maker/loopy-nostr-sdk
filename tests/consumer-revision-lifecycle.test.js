import test from 'node:test';
import assert from 'node:assert/strict';
import {Archive,Nostr,Nsite,Core,Storage,createNsiteSDK} from '../src/index.js';
import {matchesFilter} from '../src/nostr/filter.js';
const key=Nostr.generateSecretKey(),archKey=Nostr.generateSecretKey(),pubkey=Nostr.getPublicKey(key),now=1700000000;
const signer={getPublicKey:async()=>pubkey,signEvent:async t=>Nostr.finalizeEvent(t,key)};
const relay='wss://relay.example',server='https://blob.example';
const wire=e=>JSON.parse(JSON.stringify(e));
// Actual SDK transports against a deterministic in-memory relay and Blossom server.
// No external network, keys or user signatures.
test('consumer lifecycle: publish, preview, revision replacement, outbox retrieval, snapshot history, verified offline restore',async()=>{
  const relayEvents=new Map(),blobs=new Map(),writes=[],storage=Storage.memoryStore(),store=Archive.contentStore(storage);
  const record=e=>{
    assert(Nostr.verifyEvent(e));
    const id=Nostr.eventIdentity(e),current=relayEvents.get(id);
    if(!current||e.created_at>current.created_at||(e.created_at===current.created_at&&e.id<current.id))relayEvents.set(id,wire(e));
  };
  record(Nostr.finalizeEvent({kind:10002,tags:[['r',relay,'write']],content:'',created_at:now-1},key));
  class Socket {
    constructor(url){assert.equal(url,relay);this.closed=false;queueMicrotask(()=>{if(!this.closed)this.onopen?.()});}
    close(){this.closed=true;}
    send(raw){const msg=JSON.parse(raw);const emit=data=>{if(!this.closed)this.onmessage?.({data:JSON.stringify(data)});};queueMicrotask(()=>{
      if(msg[0]==='EVENT'){record(msg[1]);writes.push(msg[1].id);emit(['OK',msg[1].id,true,'']);}
      if(msg[0]==='REQ'){const events=[...relayEvents.values()].filter(e=>matchesFilter(e,msg[2])).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,msg[2].limit??500);for(const e of events)emit(['EVENT',msg[1],e]);emit(['EOSE',msg[1]]);}
    });}
  }
  let downloads=0;
  const fetcher=async(url,init={})=>{
    assert(url.startsWith(server+'/'));
    if(init.method==='PUT'){
      const data=new Uint8Array(init.body),hash=await Core.sha256(data),auth=JSON.parse(Buffer.from(init.headers.Authorization.slice(6),'base64url').toString());
      assert(Nostr.verifyEvent(auth));assert.equal(auth.pubkey,pubkey);assert.equal(auth.kind,24242);assert(auth.tags.some(t=>t[0]==='x'&&t[1]===hash));blobs.set(hash,data);return {ok:true,json:async()=>({sha256:hash,size:data.length})};
    }
    downloads++;const data=blobs.get(url.slice(server.length+1));return data?{ok:true,arrayBuffer:async()=>data.slice().buffer}:{ok:false,status:404};
  };
  const sdk=createNsiteSDK({signer,relays:[relay],server,Socket,fetcher,storage});
  const initial={'index.html':'<h1>first</h1>','readme.md':'# Title\n\nFirst\n','same.txt':'unchanged'};
  const first=await sdk.publish(initial,{identifier:'demo',created_at:now,title:'Preserved title'});
  assert.equal(first.job.stage,'relay-verified');
  const archived=await Archive.archiveRevision(first.event,store);
  const snapshot=Nostr.finalizeEvent(Archive.snapshotTemplate(first.event,{created_at:now+1}),archKey);
  const snapshotReceipt=await Nostr.publishRelay(relay,snapshot,{Socket});assert(snapshotReceipt.readback);
  // Capture the exact historical bytes before replacing the current manifest.
  for(const f of first.manifest.files)assert.equal((await Nsite.loadNsiteFile(first.event,f.path,{store,fetcher,now})).hash,f.hash);
  const updated={'index.html':'<h1>second</h1>','readme.md':'# Title\n\nSecond\n','same.txt':'unchanged'};
  const plan=await Nsite.planNsitePublication(updated,{pubkey,server,relays:[relay],baseline:first.event,created_at:now+2});
  const second=await sdk.publish(updated,{baseline:first.event,approvedPlan:plan.id,created_at:now+2,resolveCurrent:async()=>{
    const r=await sdk.query({kinds:[35128],authors:[pubkey],'#d':['demo']});return r[0]??null;
  }});
  assert.equal(second.job.planId,plan.id);assert(second.event.tags.some(t=>t[0]==='title'&&t[1]==='Preserved title'));
  assert.equal(Nostr.eventIdentity(first.event),Nostr.eventIdentity(second.event));assert.notEqual(first.event.id,second.event.id);
  const resolved=await Nsite.resolveNsiteManifest(pubkey,{identifier:'demo',bootstrap:[relay],storage,Socket,now:now+3});
  assert.equal(resolved.event.id,second.event.id);
  for(const f of second.manifest.files)assert.equal((await Nsite.loadNsiteFile(second.event,f.path,{store,fetcher,now:now+3})).hash,f.hash);
  const history=await Nostr.syncEventHistory({relays:[relay],filter:{kinds:[1349],'#a':[Nostr.eventIdentity(first.event)]},now:now+3,pageSize:2,boundaryLimit:10,maxPages:10,Socket});
  assert.equal(history.relays[0].status,'window-read');assert.equal(history.observations.length,1);
  const old=Archive.unwrapSnapshot(history.observations[0].event,{expectedCoordinate:Nostr.eventIdentity(second.event)});
  assert.equal(old.event.id,first.event.id);assert.equal(old.archivist,Nostr.getPublicKey(archKey));
  const sightings=Nostr.collectEventObservations([{event:old.event,relay,seenAt:now+3},{event:resolved.event,relay,seenAt:now+3}]);
  assert.equal(sightings.records.length,2);assert.equal(sightings.current[0].id,second.event.id);
  const oldEvent=await Archive.restoreRevision(archived,store),oldManifest=await Nsite.parseManifest(oldEvent,{now:now+3});
  const beforeDownloads=downloads;
  const a=await Archive.materializeVersion(oldManifest,store),b=await Archive.materializeVersion(resolved.manifest,store);
  assert.equal(downloads,beforeDownloads);assert.equal(new TextDecoder().decode(a['index.html']),initial['index.html']);assert.equal(new TextDecoder().decode(b['index.html']),updated['index.html']);
  const comparison=Archive.compareMarkdown(new TextDecoder().decode(a['readme.md']),new TextDecoder().decode(b['readme.md']));assert(comparison.changed&&comparison.exact);
  const zip=Archive.writeZip(a),restored=await Archive.readZip(zip);for(const [path,bytes] of Object.entries(a))assert.deepEqual(restored[path],bytes);
  assert.equal(blobs.size,5);assert.equal(writes.length,3);
});
