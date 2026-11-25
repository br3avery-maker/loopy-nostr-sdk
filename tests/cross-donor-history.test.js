import test from 'node:test';
import assert from 'node:assert/strict';
import {Nostr,Storage} from '../src/index.js';
const key=Nostr.generateSecretKey(),key2=Nostr.generateSecretKey();
const author=Nostr.getPublicKey(key);
const event=(time,content,kind=30817,d='spec',secret=key)=>Nostr.finalizeEvent({kind,created_at:time,content,tags:d===null?[]:[['d',d]]},secret);
const a='wss://a.example',b='wss://b.example';
const e1=event(10,'one'),e2=event(20,'two'),tie=event(20,'tie');
const filter={kinds:[30817]};
const obs=(event,relay=a,seenAt=30)=>({event,relay,seenAt});
const sort=(a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id);
const mock=(byRelay,hook=()=>{})=>async(relay,f)=>{hook(relay,f);return (byRelay[relay]??[]).filter(e=>e.created_at>=f.since&&e.created_at<=f.until&&f.kinds.includes(e.kind)).sort(sort).slice(0,f.limit)};
const opts={relays:[a],filter,now:100,pageSize:2,boundaryLimit:10,maxPages:10};
test('exact identity: first d is not trimmed, other authors/kinds and regular IDs separate',()=>{
  const x=event(1,'x',30817,' a:b '),y=event(2,'y',30817,' a:b '),z=event(3,'z',30817,' a:b ',key2);
  assert.equal(Nostr.eventIdentity(x),`30817:${author}: a:b `);assert.equal(Nostr.eventIdentity(x),Nostr.eventIdentity(y));assert.notEqual(Nostr.eventIdentity(x),Nostr.eventIdentity(z));
  assert.equal(Nostr.eventIdentity(event(1,'x',10002,'ignored')),`10002:${author}:`);
  assert.equal(Nostr.eventIdentity(event(1,'x',30817,null)),`30817:${author}:`);
  const regular=event(1,'r',1,null);assert.equal(Nostr.eventIdentity(regular),regular.id);
});
test('canonical revisions and exact per-event sightings remain independent',()=>{
  const r=Nostr.collectEventObservations([obs(e1,a,35),obs(e1,b,32),obs(e1,a+'/',30),obs(e2,b),obs(tie,a)]);
  assert.equal(r.records.length,3);assert.equal(r.current.length,1);assert.equal(r.current[0].id,[e2.id,tie.id].sort()[0]);
  assert.deepEqual(r.records.find(x=>x.event.id===e1.id).relays,[{relay:a,firstSeenAt:30,lastSeenAt:35},{relay:b,firstSeenAt:32,lastSeenAt:32}]);
  assert.deepEqual(r.records.find(x=>x.event.id===e2.id).relays.map(x=>x.relay),[b]);
});
test('tampered signatures, missing wire fields and ephemeral auth never enter history',()=>{
  const invalid={...e1,content:'tampered'}, missing={...event(10,'',1,null)};delete missing.tags;
  const r=Nostr.collectEventObservations([obs(e1),obs(invalid),obs(event(10,'auth',27235)),obs(missing)]);
  assert.equal(r.records.length,1);assert.equal(r.rejected.length,3);assert.throws(()=>Nostr.eventIdentity(invalid));
});
test('records detach caller objects and preserve source bytes across storage roundtrip',async()=>{
  const copy=JSON.parse(JSON.stringify(e1));const r=Nostr.collectEventObservations([obs(copy)]);copy.tags[0][1]='changed';
  const store=Storage.memoryStore();await store.set('history',r);const back=await store.get('history');assert.equal(back.records[0].event.tags[0][1],'spec');assert(Nostr.verifyEvent(back.records[0].event));
});
test('per-relay pagination reads different depths and dedupes exact sightings only',async()=>{
  const x=event(4,'deep'),y=event(15,'mid',30817,'other');const r=await Nostr.syncEventHistory({...opts,relays:[a,b],query:mock({[a]:[e2,e1,x],[b]:[e2,y]})});
  assert.deepEqual(r.relays.map(x=>x.status),['window-read','window-read']);assert.equal(r.cursors[a].watermark,20);assert.equal(r.cursors[b].watermark,20);
  assert.equal(r.observations.length,5);assert.equal(Nostr.collectEventObservations(r.observations).records.length,4);
});
test('boundary expansion retrieves all tied fixtures before stepping to older events',async()=>{
  const dense=Array.from({length:5},(_,i)=>event(20,'dense'+i,30817,'dense'+i));const r=await Nostr.syncEventHistory({...opts,query:mock({[a]:[...dense,e1]})});
  assert.equal(r.relays[0].status,'window-read');assert.equal(r.observations.length,6);assert.equal(r.cursors[a].watermark,20);
});
test('saturated exact-time boundary is not exhausted; resume with larger bound',async()=>{
  const dense=Array.from({length:5},(_,i)=>event(20,'dense'+i,30817,'dense'+i)),query=mock({[a]:[...dense,e1]});
  const r=await Nostr.syncEventHistory({...opts,boundaryLimit:5,query});assert.equal(r.relays[0].status,'boundary-stalled');assert.equal(r.cursors[a].watermark,null);assert.equal(r.cursors[a].window.nextUntil,100);
  const next=await Nostr.syncEventHistory({...opts,cursors:r.cursors,query});assert.equal(next.relays[0].status,'window-read');assert.equal(next.observations.length,6);
});
test('apparently capped repeated all-tied page does not advance',async()=>{
  const dense=Array.from({length:5},(_,i)=>event(20,'dense'+i,30817,'dense'+i));const fetch=mock({[a]:[...dense,e1]});
  const r=await Nostr.syncEventHistory({...opts,pageSize:4,query:(relay,f)=>fetch(relay,{...f,limit:Math.min(2,f.limit)})});
  assert.equal(r.relays[0].status,'boundary-stalled');assert.equal(r.cursors[a].watermark,null);
});
test('transport failure preserves watermark and unfinished range, distinct from empty EOSE',async()=>{
  const first=await Nostr.syncEventHistory({...opts,query:mock({[a]:[e1]})});const query=async()=>{throw Error('offline')};
  const failed=await Nostr.syncEventHistory({...opts,now:110,cursors:first.cursors,query});assert.equal(failed.relays[0].status,'failed');assert.equal(failed.cursors[a].watermark,10);assert.equal(failed.cursors[a].window.nextUntil,110);
  const empty=await Nostr.syncEventHistory({...opts,query:mock({})});assert.equal(empty.relays[0].status,'window-read');assert.equal(empty.cursors[a].watermark,null);
});
test('bounded partial cursor resumes old window before newer incremental scan',async()=>{
  const data=[e2,e1,event(5,'old')],query=mock({[a]:data});const first=await Nostr.syncEventHistory({...opts,maxPages:1,query});assert.equal(first.relays[0].status,'partial');assert.equal(first.cursors[a].watermark,null);assert.equal(first.cursors[a].window.nextUntil,9);
  const next=await Nostr.syncEventHistory({...opts,now:200,cursors:first.cursors,query});assert.equal(next.relays[0].status,'window-read');assert.equal(next.observations.length,1);assert.equal(next.cursors[a].watermark,20);
  const latest=event(150,'new'),calls=[];const delta=await Nostr.syncEventHistory({...opts,now:200,cursors:next.cursors,query:mock({[a]:[...data,latest]},(r,f)=>calls.push(f))});assert.equal(calls[0].since,20);assert.equal(delta.cursors[a].watermark,150);
});
test('boundary read failure retries same range without promoting cursor',async()=>{
  const q=mock({[a]:[e2,e1]});let n=0;const r=await Nostr.syncEventHistory({...opts,query:(r,f)=>++n===2?Promise.reject(Error('boundary offline')):q(r,f)});
  assert.equal(r.relays[0].status,'failed');assert.equal(r.observations.length,2);assert.equal(r.cursors[a].window.nextUntil,100);assert.equal(r.cursors[a].watermark,null);
});
test('bad scope and relay mismatch rejected before any transport',async()=>{
  const r=await Nostr.syncEventHistory({...opts,query:mock({})});let calls=0;const query=async()=>{calls++;return []};
  await assert.rejects(Nostr.syncEventHistory({...opts,filter:{kinds:[1]},cursors:r.cursors,query}),/mismatched/);
  await assert.rejects(Nostr.syncEventHistory({...opts,relays:[b],cursors:{[b]:r.cursors[a]},query}),/mismatched/);
  await assert.rejects(Nostr.syncEventHistory({...opts,filter:{kinds:[27235]},query}),/non-ephemeral/);assert.equal(calls,0);
});
test('injected out-of-filter, bad signature, unordered responses fail closed',async()=>{
  for(const response of [[event(10,'wrong',1)],[{...e1,content:'fake'}],[e1,e2]]){const r=await Nostr.syncEventHistory({...opts,query:async()=>response});assert.equal(r.relays[0].status,'failed');assert.equal(r.cursors[a].watermark,null);assert.equal(r.observations.length,0);}
});
test('cancellation cannot be mistaken for exhaustion',async()=>{
  const abort=new AbortController();abort.abort();let calls=0;const r=await Nostr.syncEventHistory({...opts,signal:abort.signal,query:async()=>{calls++;return []}});assert.equal(calls,0);assert.equal(r.relays[0].status,'cancelled');assert.equal(r.cursors[a].watermark,null);
});
test('mixed-timestamp page followed by an equally capped boundary is not safe to advance',async()=>{
  const dense=Array.from({length:5},(_,i)=>event(20,'dense'+i,30817,'dense'+i));const fetch=mock({[a]:[event(30,'top'),...dense,e1]});
  const r=await Nostr.syncEventHistory({...opts,pageSize:4,query:(relay,f)=>fetch(relay,{...f,limit:Math.min(2,f.limit)})});
  assert.equal(r.relays[0].status,'boundary-stalled');assert.equal(r.cursors[a].watermark,null);
});
test('abort while awaiting a relay response cannot complete the window',async()=>{
  const abort=new AbortController();const r=await Nostr.syncEventHistory({...opts,signal:abort.signal,query:async()=>{abort.abort();return []}});assert.equal(r.relays[0].status,'cancelled');assert.equal(r.cursors[a].watermark,null);
});
test('default WebSocket transport reads exact bounded history and resumes a stored cursor',async()=>{
  class Socket {
    constructor(url){this.url=url;queueMicrotask(()=>this.onopen?.())}
    send(raw){const [op,id,f]=JSON.parse(raw);assert.equal(op,'REQ');for(const e of [e2,e1].filter(e=>e.created_at>=f.since&&e.created_at<=f.until).slice(0,f.limit)){this.onmessage?.({data:JSON.stringify(['EVENT',id,e])})}this.onmessage?.({data:JSON.stringify(['EOSE',id])})}
    close(){}
  }
  const store=Storage.memoryStore();const first=await Nostr.syncEventHistory({...opts,maxPages:1,Socket});assert.equal(first.relays[0].status,'partial');await store.set('history',{observations:first.observations,cursors:first.cursors});const saved=await store.get('history');
  const next=await Nostr.syncEventHistory({...opts,cursors:saved.cursors,Socket});assert.equal(next.relays[0].status,'window-read');assert.equal(Nostr.collectEventObservations([...saved.observations,...next.observations]).records.length,2);
});
