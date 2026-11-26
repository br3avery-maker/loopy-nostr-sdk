import test from 'node:test';import assert from 'node:assert/strict';
import {Nostr,Storage} from '../src/index.js';
import {BunkerSigner} from '../vendor/nostr.js';
test('bunker setup is offline until connect and guards session lifecycle',async()=>{
 const original=BunkerSigner.fromBunker;let calls=0,closed=0;const key=Nostr.getPublicKey(Nostr.generateSecretKey());
 try{BunkerSigner.fromBunker=()=>{calls++;return {connect:async()=>{},getPublicKey:async()=>key,signEvent:async t=>t,close:async()=>{closed++}}};
 const s=await Nostr.bunkerSigner('bunker://'+key+'?relay=wss%3A%2F%2Frelay.example.org');assert.equal(calls,0);await assert.rejects(s.getPublicKey(),/not connected/);await assert.rejects(s.signEvent({}),/not connected/);assert.deepEqual(await Promise.all([s.connect(),s.connect()]),[key,key]);assert.equal(calls,1);await s.close();assert.equal(closed,1);await assert.rejects(s.connect(),/closed/);
 }finally{BunkerSigner.fromBunker=original}
});
function fakeDB(){let request,transaction;const open={};const provider={open(){queueMicrotask(()=>{open.result={transaction(){request={};transaction={objectStore:()=>({put:()=>request,delete:()=>request,get:()=>request,getAllKeys:()=>request})};return transaction}};open.onsuccess()});return open}};return {provider,get request(){return request},get transaction(){return transaction}};}
test('IndexedDB write waits for commit, and rejects a late abort',async()=>{
 for(const method of ['set','delete']){const f=fakeDB();const s=Storage.indexedDbStore({indexedDBProvider:f.provider});let settled=false;const p=s[method]('k','v').finally(()=>{settled=true});await new Promise(r=>setImmediate(r));f.request.onsuccess();await new Promise(r=>setImmediate(r));assert.equal(settled,false);f.transaction.error=new Error('late abort');f.transaction.onabort();await assert.rejects(p,/late abort/);}
});
test('IndexedDB request result returned only after completion',async()=>{const f=fakeDB();const s=Storage.indexedDbStore({indexedDBProvider:f.provider});const p=s.get('k');await new Promise(r=>setImmediate(r));f.request.result='value';f.request.onsuccess();f.transaction.oncomplete();assert.equal(await p,'value');});
