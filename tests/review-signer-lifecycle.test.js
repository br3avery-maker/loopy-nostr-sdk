import test from 'node:test';
import assert from 'node:assert/strict';
import {Nostr, Adapters} from '../src/index.js';
import {BunkerSigner} from '../vendor/nostr.js';
const key=Nostr.generateSecretKey(), pubkey=Nostr.getPublicKey(key);
const uri='bunker://'+pubkey+'?relay=wss%3A%2F%2Frelay.example.org';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function withSigner(factory,run){const original=BunkerSigner.fromBunker;BunkerSigner.fromBunker=factory;try{await run(await Nostr.bunkerSigner(uri));}finally{BunkerSigner.fromBunker=original;}}
async function rejectsPromptly(p){let timer;try{await assert.rejects(Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('test timeout')),200)})]),/NIP-46 signer closed/);}finally{clearTimeout(timer);}}
test('closing pending connection rejects all waiting callers and ignores late approval',async()=>{
 const waiting=deferred(),started=deferred();let closes=0,keyCalls=0;
 await withSigner(()=>({connect:()=>{started.resolve();return waiting.promise;},getPublicKey:async()=>{keyCalls++;return pubkey;},close:async()=>{closes++;}}),async s=>{
  const p=s.connect(),q=s.connect();const checks=Promise.all([rejectsPromptly(p),rejectsPromptly(q)]);await started.promise;await s.close();await checks;waiting.resolve();await new Promise(r=>setImmediate(r));assert.equal(keyCalls,0);assert.equal(closes,1);await assert.rejects(s.connect(),/closed/);
 });
});
test('closing connected signer rejects pending key and signing calls despite late success or failure',async()=>{
 const sign=deferred(),get=deferred();let initial=true,closes=0;
 await withSigner(()=>({connect:async()=>{},getPublicKey:()=>initial?(initial=false,Promise.resolve(pubkey)):get.promise,signEvent:()=>sign.promise,close:async()=>{closes++;}}),async s=>{
  await s.connect();const p=s.signEvent(Nostr.eventTemplate({content:'x'})),q=s.getPublicKey(),r=s.connect();const checks=Promise.all([rejectsPromptly(p),rejectsPromptly(q),rejectsPromptly(r)]);await new Promise(r=>setImmediate(r));await s.close();await checks;sign.resolve({});get.reject(new Error('late remote failure'));await new Promise(r=>setImmediate(r));assert.equal(closes,1);await assert.rejects(s.signEvent({}),/not connected|closed/);
 });
});
test('closing during initial key retrieval also rejects connection',async()=>{
 const get=deferred(),started=deferred();await withSigner(()=>({connect:async()=>{},getPublicKey:()=>{started.resolve();return get.promise;},close:async()=>{}}),async s=>{const p=s.connect(),check=rejectsPromptly(p);await started.promise;await s.close();await check;get.resolve(pubkey);});
});
test('Android result verifies against the launched template, not a subsequently mutated draft',async()=>{
 const template=Nostr.eventTemplate({content:'original',tags:[['p',pubkey]]});const expected=structuredClone(template),pending=deferred();let launched;
 const adapter=Adapters.androidHandoff({launch:async uri=>{launched=JSON.parse(decodeURIComponent(uri.slice('nostrsigner:'.length).split('?')[0]));template.content='edited';template.tags[0][1]='a'.repeat(64);},onReturn:()=>pending.promise});
 const result=adapter.sign({requestId:'test-id',event:template,expectedPubkey:pubkey});pending.resolve({id:'test-id',event:Nostr.finalizeEvent(structuredClone(expected),key)});assert.equal((await result).content,'original');assert.deepEqual(launched,expected);
});
test('Android rejects a signature for the modified draft rather than the launched request',async()=>{
 const template=Nostr.eventTemplate({content:'original'});const adapter=Adapters.androidHandoff({launch:async()=>{template.content='edited';},onReturn:async()=>{await new Promise(r=>setImmediate(r));return {id:'test-id',event:Nostr.finalizeEvent(template,key)};}});
 await assert.rejects(adapter.sign({requestId:'test-id',event:template,expectedPubkey:pubkey}),/different event/);
});
