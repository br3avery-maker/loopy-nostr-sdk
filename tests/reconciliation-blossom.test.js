import test from 'node:test';
import assert from 'node:assert/strict';
import {Blossom,Core,Nostr} from '../src/index.js';
const a='https://a.example',b='https://b.example',c='https://c.example';
const data=new TextEncoder().encode('hello world'), sha256=await Core.sha256(data), blob={sha256,size:data.length,type:'text/html'};
const response=(type='text/html',body=data)=>new Response(body,{headers:{'content-type':type}});
test('preflight makes only HEAD metadata requests; status not reason text drives selection',async()=>{
 const calls=[];const r=await Blossom.preflightBlob(blob,{servers:[a,a+'/',b,c],fetcher:async(url,init)=>{calls.push({url,init});return new Response(null,{status:url.startsWith(a)?200:url.startsWith(b)?415:405,headers:{'X-Reason':'accepted'}})}});
 assert.deepEqual(r.selected,[a]);assert.deepEqual(r.fallbacks,[c]);assert.equal(r.decisions[1].code,'media-type');assert.equal(calls.length,3);
 for(const {url,init} of calls){assert.ok(url.endsWith('/upload'));assert.equal(init.method,'HEAD');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers['X-SHA-256'],sha256);assert.equal(init.headers['X-Content-Length'],String(data.length));assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,undefined)}
 assert.ok(r.decisions.every(d=>d.verified===false));
});
test('preflight distinguishes auth/payment/rate-limit, without signing or paying',async()=>{
 const r=await Blossom.preflightBlob(blob,{servers:[a,b,c],fetcher:async url=>new Response(null,{status:url.startsWith(a)?401:url.startsWith(b)?402:429})});assert.deepEqual(r.decisions.map(d=>d.code),['auth-required','payment-required','rate-limited']);assert.deepEqual(r.selected,[]);
});
test('preflight timeout even if injected fetch never settles; cancellation stops remaining requests',async()=>{
 const r=await Blossom.preflightBlob(blob,{servers:[a],timeoutMs:10,fetcher:()=>new Promise(()=>{})});assert.equal(r.decisions[0].code,'network');const controller=new AbortController();let calls=0;
 await assert.rejects(Blossom.preflightBlob(blob,{servers:[a,b],signal:controller.signal,fetcher:()=>{calls++;controller.abort();return new Promise(()=>{})}}),/cancelled/);assert.equal(calls,1);
});
test('unsafe destinations and malformed metadata are rejected before request',async()=>{
 for(const server of ['https://172.16.0.1','https://[::1]','https://localhost.','http://a.example','https://a.example?q=1','https://user@a.example']) await assert.rejects(Blossom.preflightBlob(blob,{servers:[server],fetcher:()=>assert.fail('must not fetch')}));
 await assert.rejects(Blossom.preflightBlob({...blob,type:'text/html\r\nX: y'},{servers:[a],fetcher:()=>assert.fail('must not fetch')}));
});
test('batched authorization retains exact hash/domain scopes and bounded expiry',async()=>{
 const template=Blossom.blossomBatchUploadAuth({hashes:[sha256,sha256,'b'.repeat(64)],servers:[a,a+'/sub',b],now:1000,expiresIn:120});assert.equal(template.kind,24242);assert.equal(template.created_at,999);assert.deepEqual(template.tags,[['t','upload'],['expiration','1120'],['x',sha256],['x','b'.repeat(64)],['server','a.example'],['server','b.example']]);
 const key=Nostr.generateSecretKey(),pk=Nostr.getPublicKey(key);const event=await Nostr.checkedSign({signEvent:async t=>Nostr.finalizeEvent(t,key)},template,pk);assert.equal(Nostr.verifyEvent(event),true);
 for(const args of [{hashes:[],servers:[a]},{hashes:[sha256],servers:[]},{hashes:[sha256],servers:[a],expiresIn:601}])assert.throws(()=>Blossom.blossomBatchUploadAuth(args));
});
test('multiple copy verification checks each origin, rejects valid bytes with wrong MIME and never trusts descriptor',async()=>{
 const calls=[];const r=await Blossom.verifyBlobCopies(blob,{servers:[a,a+'/alias','https://a.example.',b,c],required:2,fetcher:async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return url.startsWith(b)?response('application/octet-stream'):response('text/html; charset=utf-8')}});
 assert.equal(r.status,'verified');assert.deepEqual(r.copies.map(x=>x.server),[a,c]);assert.deepEqual(r.failed.map(x=>x.server),[b]);assert.equal(calls.length,3);
});
test('hash mismatches, excess bytes, wrong size and inadequate distinct origins never satisfy copy count',async()=>{
 const r=await Blossom.verifyBlobCopies(blob,{servers:[a,a+'/other',b,c],required:2,fetcher:async url=>url.startsWith(a)?response():url.startsWith(b)?response('text/html',new Uint8Array(data.length)):response('text/html',new Uint8Array(data.length+1))});assert.equal(r.status,'partial');assert.equal(r.copies.length,1);assert.equal(r.failed.length,2);
 const incorrect=await Blossom.verifyBlobCopies({...blob,size:blob.size+1},{servers:[a],fetcher:async()=>response()});assert.equal(incorrect.status,'unverified');
});
test('JavaScript MIME aliases accepted, redirects rejected; readback cancellation terminates',async()=>{
 const r=await Blossom.verifyBlobCopies({...blob,type:'text/javascript'},{servers:[a,b],required:2,fetcher:async url=>{const res=response('application/javascript');if(url.startsWith(b))Object.defineProperty(res,'redirected',{value:true});return res}});assert.equal(r.status,'partial');
 const controller=new AbortController();let calls=0;await assert.rejects(Blossom.verifyBlobCopies(blob,{servers:[a,b],signal:controller.signal,fetcher:()=>{calls++;controller.abort();return new Promise(()=>{})}}),/cancelled/);assert.equal(calls,1);
});
