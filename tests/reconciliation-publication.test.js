import test from 'node:test';
import assert from 'node:assert/strict';
import {Core,Nsite,Nostr} from '../src/index.js';
const key=Nostr.generateSecretKey(),pubkey=Nostr.getPublicKey(key),A='https://store-a.example',B='https://store-b.example',C='https://store-c.example',R='wss://relay.example';
const files={'index.html':'<h1>hello</h1>','assets/main.js':'console.log(42)'};
const created_at=Math.floor(Date.now()/1000);
const options={pubkey,server:A,storageServers:[A,B,C],requiredCopies:2,relays:[R],identifier:'demo',created_at,gateway:'gateway.example'};
const legacy={pubkey,server:A,relays:[R],identifier:'demo',created_at};
function fixture({gatewayBad=false,failServers=[],signerAccount=pubkey}={}){
 const store=new Map(),uploads=[],signed=[],pubs=[],requests=[],checkpoints=[];
 const gateway=new Map(Object.entries(files).map(([p,body])=>['/'+p,{data:body,type:Nsite.mediaType(p)}]));
 let current=null,account=signerAccount;
 const signer={getPublicKey:async()=>account,signEvent:async template=>{signed.push(structuredClone(template));return Nostr.finalizeEvent(template,key);}};
 const fetcher=async (url,init)=>{
   requests.push({url,method:init?.method??'GET',redirect:init?.redirect,credentials:init?.credentials});
   const u=new URL(url);
   if(u.hostname.endsWith('.gateway.example')){
     const f=gateway.get(u.pathname);return f?new Response(gatewayBad?'wrong':f.data,{headers:{'Content-Type':f.type}}):new Response(null,{status:404});
   }
   const b=store.get(url);return b?new Response(b.data,{headers:{'Content-Type':b.type}}):new Response(null,{status:404});
 };
 const uploader=async(data,{server,path})=>{
   uploads.push({server,path});if(failServers.includes(server))throw new Error('upload rejected');
   const hash=await Core.sha256(data);store.set(server+'/'+hash,{data:new Uint8Array(data),type:Nsite.mediaType(path)});return {verified:true,hash};
 };
 const publisher=async(event,relays)=>{pubs.push(event);current=event;return {verified:relays.map(relay=>({relay,eventId:event.id,accepted:true,readback:true})),failed:[]};};
 return {store,uploads,signed,pubs,requests,checkpoints,signer,fetcher,uploader,publisher,setCurrent(e){current=e},setAccount(v){account=v},resolveCurrent:async()=>current,checkpoint:j=>{checkpoints.push(j)}};
}
async function approved(settings=options,input=files){return {...settings,approvedPlan:(await Nsite.planNsitePublication(input,settings)).id};}

test('legacy plan and replica preview have distinct deterministic schemas; exact destinations and types are digest bound',async()=>{
 const old=await Nsite.planNsitePublication(files,legacy);assert.equal(old.schema,'nsite-publication-plan/1');assert.equal(old.storage,undefined);
 const p=await Nsite.planNsitePublication(files,options);assert.equal(p.schema,'nsite-publication-plan/2');assert.deepEqual(p.storage,{servers:[A,B,C],required:2});
 assert.deepEqual(p.template.tags.filter(t=>t[0]==='server'),[['server',A],['server',B],['server',C]]);assert.equal(p.files.find(f=>f.path==='/index.html').type,'text/html');
 const f=fixture();for(const patch of [{requiredCopies:1},{storageServers:[A,C,B]},{gateway:'other.example'}])await assert.rejects(Nsite.publishNsite(files,{...f,...options,approvedPlan:p.id,...patch}),/does not match approved plan/);
 assert.equal(f.requests.length+f.signed.length+f.uploads.length+f.pubs.length,0);
});
test('strict approval, same-origin threshold, primary and explicit gateway validation happen before network',async()=>{
 const f=fixture();await assert.rejects(Nsite.publishNsite(files,{...f,...options}),/approved publication plan/);
 await assert.rejects(Nsite.publishNsite(files,{...f,...await approved(),resolveCurrent:undefined}),/current-revision resolver/);
 await assert.rejects(Nsite.planNsitePublication(files,{...options,storageServers:[A,A+'/mirror'],requiredCopies:2}),/copy threshold/);
 await assert.rejects(Nsite.planNsitePublication(files,{...options,storageServers:[B,C]}),/Primary server/);
 await assert.rejects(Nsite.planNsitePublication(files,{...options,gateway:'localhost'}),/gateway hostname/);
 assert.equal(f.requests.length+f.signed.length+f.uploads.length,0);
});
test('replica failure falls back to approved storage, then signs and verifies every gateway file',async()=>{
 const f=fixture({failServers:[B]});const result=await Nsite.publishNsite(files,{...f,...await approved()});
 assert.equal(result.job.stage,'site-verified');assert.equal(result.job.files.length,2);assert.equal(result.job.gateway.status,'verified');assert.ok(result.job.files.every(row=>row.copies.map(x=>x.server).join(',')===[A,C].join(',')));
 assert.equal(f.uploads.length,6);assert.equal(f.signed.length,1);assert.equal(f.pubs.length,1);
 assert.equal(result.job.event.id,result.event.id);assert.ok(result.job.files.every(row=>row.attempts.some(a=>a.server===B&&a.status==='failed')));
 assert.ok(f.requests.filter(x=>x.url.includes('.gateway.example')).every(x=>x.redirect==='error'&&x.credentials==='omit'));
});
test('uploader claim alone cannot satisfy threshold or trigger manifest signing',async()=>{
 const f=fixture();await assert.rejects(Nsite.publishNsite(files,{...f,...await approved(),uploader:async d=>({verified:true,hash:await Core.sha256(d)})}),/Insufficient independently verified storage copies/);
 assert.equal(f.signed.length+f.pubs.length,0);
});
test('checkpoint interruption reuses independently present blobs instead of uploading again',async()=>{
 const f=fixture(),settings=await approved();let saved;
 await assert.rejects(Nsite.publishNsite(files,{...f,...settings,checkpoint:j=>{saved=j;if(j.files[0]?.copies.length===2)throw new Error('interrupted');}}),/interrupted/);
 assert.equal(f.uploads.length,2);assert.equal(f.signed.length,0);
 // Corrupt saved claims are ignored: only actual storage reads are authoritative.
 saved.files[0].copies=[];
 const result=await Nsite.publishNsite(files,{...f,...settings,resume:saved});
 assert.equal(f.uploads.length,4);assert.equal(f.signed.length,1);assert.equal(result.job.stage,'site-verified');
});
test('signed checkpoint resumes without signing again and rejects changed signature or stale revision',async()=>{
 const f=fixture(),settings=await approved();let saved;
 await assert.rejects(Nsite.publishNsite(files,{...f,...settings,checkpoint:j=>{saved=j;if(j.stage==='signed')throw new Error('interrupted after sign')}}),/interrupted after sign/);
 assert.equal(f.signed.length,1);assert.equal(f.pubs.length,0);assert.ok(Nostr.verifyEvent(saved.event));
 const invalid=structuredClone(saved);invalid.event.content='tampered';await assert.rejects(Nsite.publishNsite(files,{...f,...settings,resume:invalid}),/Invalid Nostr event/);
 const wrong=structuredClone(saved);wrong.event=Nostr.finalizeEvent({...wrong.event,content:'different'},key);wrong.eventId=wrong.event.id;await assert.rejects(Nsite.publishNsite(files,{...f,...settings,resume:wrong}),/differs from approved/);
 const other=Nostr.finalizeEvent({...saved.event,created_at:saved.event.created_at+1},key);f.setCurrent(other);await assert.rejects(Nsite.publishNsite(files,{...f,...settings,resume:saved}),/baseline changed/);
 f.setCurrent(saved.event);const result=await Nsite.publishNsite(files,{...f,...settings,resume:saved});
 assert.equal(f.signed.length,1);assert.equal(f.uploads.length,4);assert.equal(result.event.id,saved.eventId);
});
test('claimed completed copies are freshly checked, missing copies repaired on resume',async()=>{
 const f=fixture(),settings=await approved();const first=await Nsite.publishNsite(files,{...f,...settings});
 const row=first.job.files[0];f.store.delete(B+'/'+row.hash);const count=f.uploads.length;
 const resumed=await Nsite.publishNsite(files,{...f,...settings,resume:first.job});assert.equal(f.uploads.length,count+1);assert.equal(f.signed.length,1);assert.equal(resumed.job.stage,'site-verified');
});
test('gateway mismatch cannot be called site-verified and preserves manifest result',async()=>{
 const f=fixture({gatewayBad:true});const result=await Nsite.publishNsite(files,{...f,...await approved()});
 assert.equal(result.job.stage,'gateway-unverified');assert.equal(result.job.gateway.status,'unverified');assert.equal(result.receipts.verified.length,1);assert.ok(result.job.gateway.files.every(x=>x.status==='unverified'));
});
test('gateway check refuses wrong MIME and redirect even with correct bytes',async()=>{
 const f=fixture();const orig=f.fetcher;f.fetcher=async(u,i)=>{if(u.includes('.gateway.example')){
   const name=new URL(u).pathname.slice(1);return name==='index.html'?new Response(files[name],{headers:{'Content-Type':'text/plain'}}):{ok:true,redirected:true,headers:new Headers({'Content-Type':'text/javascript'}),arrayBuffer:async()=>Core.encode(files[name]).buffer};
 }return orig(u,i);};
 const r=await Nsite.publishNsite(files,{...f,...await approved()});assert.equal(r.job.stage,'gateway-unverified');assert.ok(r.job.gateway.files.every(x=>x.status==='unverified'));
});
test('relay receipt must match exact event and approved destination; cancellation blocks publication',async()=>{
 const f=fixture(),settings=await approved();await assert.rejects(Nsite.publishNsite(files,{...f,...settings,publisher:async e=>({verified:[{relay:'wss://wrong.example',eventId:e.id,accepted:true,readback:true}]})}),/No signed nsite/);
 const g=fixture(),controller=new AbortController();await assert.rejects(Nsite.publishNsite(files,{...g,...settings,signal:controller.signal,checkpoint:j=>{if(j.stage==='signed')controller.abort()}}),/cancelled/i);assert.equal(g.pubs.length,0);
});
test('real default uploader uses bounded descriptor, exact readback, auth and no redirects or credentials',async()=>{
 const f=fixture(),input={'index.html':'ok'};const settings=await approved({...legacy,storageServers:[A,B],requiredCopies:2},input);let puts=0;
 const orig=f.fetcher;const fetcher=async(url,init)=>{if(init?.method==='PUT'){
    puts++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.match(init.headers.Authorization,/^Nostr /);const data=new Uint8Array(init.body),hash=await Core.sha256(data);assert.equal(init.headers['X-SHA-256'],hash);
    f.store.set(url.slice(0,-7)+'/'+hash,{data,type:init.headers['Content-Type']});return Response.json({sha256:hash,size:data.byteLength});
 }return orig(url,init);};
 const r=await Nsite.publishNsite(input,{...f,...settings,uploader:undefined,fetcher});assert.equal(puts,2);assert.equal(f.signed.filter(t=>t.kind===24242).length,2);assert.equal(r.job.stage,'relay-verified');assert.equal(r.job.event.kind,35128);
 assert.ok(!JSON.stringify(f.checkpoints).includes('Authorization'));
});
