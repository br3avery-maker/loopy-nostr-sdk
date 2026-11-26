import test from 'node:test';
import assert from 'node:assert/strict';
import {Nostr} from '../src/index.js';
const key=Nostr.generateSecretKey(), other=Nostr.generateSecretKey(), pubkey=Nostr.getPublicKey(key);
const signed=(kind,tags=[],content='',created_at=100,keyOverride=key)=>Nostr.finalizeEvent({kind,tags,content,created_at},keyOverride);
const relay='wss://example.invalid';
const socket=(events)=>class {constructor(){queueMicrotask(()=>this.onopen?.())} send(raw){const [type,id]=JSON.parse(raw);if(type==='REQ')queueMicrotask(()=>{for(const event of events)this.onmessage?.({data:JSON.stringify(['EVENT',id,event])});this.onmessage?.({data:JSON.stringify(['EOSE',id])})})}close(){}};
for(const [kind,discover,tag] of [[10002,Nostr.discoverRelays,'r'],[10063,Nostr.discoverBlossom,'server']]){
 test(`kind ${kind} uses lowest ID at equal timestamp regardless of arrival order`,async()=>{
 const events=['a','b'].map(x=>signed(kind,[[tag,kind===10002?`wss://${x}.example`:`https://${x}.example`]]));
 const sorted=events.sort((a,b)=>a.id<b.id?-1:1);
 for(const candidates of [sorted,[...sorted].reverse()]){const result=await discover(pubkey,{bootstrap:[relay],query:async()=>candidates});assert.equal(result.sourceEvent,sorted[0].id);}
 });
}
test('raw REQ rejects valid signed events outside kind, author, identifier and time filters',async()=>{
 const good=signed(30817,[['d','target']], 'good');
 const events=[signed(1,[['d','target']]),signed(30817,[['d','target']],'',100,other),signed(30817,[['d','other']]),signed(30817,[['d','target']],'old',99),signed(30817,[['d','target']],'future',101),good];
 const result=await Nostr.queryRelay(relay,{kinds:[30817],authors:[pubkey],'#d':['target'],since:100,until:100},{Socket:socket(events)});
 assert.deepEqual(result.map(e=>e.id),[good.id]);
});
test('exact ID filter rejects valid unrelated signed events',async()=>{const good=signed(1,[],'good'),bad=signed(1,[],'bad');assert.deepEqual((await Nostr.queryRelay(relay,{ids:[good.id]},{Socket:socket([bad,good])})).map(e=>e.id),[good.id]);});
test('query limit counts matching unique IDs, not unrelated events',async()=>{const a=signed(1,[],'a'),b=signed(1,[],'b'),c=signed(1,[],'c');const result=await Nostr.queryRelay(relay,{kinds:[1],limit:2},{Socket:socket([signed(7),a,a,b,c])});assert.deepEqual(result.map(x=>x.id),[a.id,b.id]);});
test('zero limit returns no events even when relay sends signed data',async()=>{assert.deepEqual(await Nostr.queryRelay(relay,{kinds:[1],limit:0},{Socket:socket([signed(1)])}),[]);});
test('readback cannot establish publication before relay OK',async()=>{
 const event=signed(1);class Premature {constructor(){queueMicrotask(()=>this.onopen?.())}send(raw){const [type]=JSON.parse(raw);if(type==='EVENT')queueMicrotask(()=>{this.onmessage?.({data:JSON.stringify(['EVENT','read-'+event.id.slice(0,16),event])});this.onclose?.()})}close(){}}
 await assert.rejects(Nostr.publishRelay(relay,event,{Socket:Premature,timeoutMs:50}),/closed|timeout/);
});
test('signer cannot mutate the approved template in place and bypass comparison',async()=>{
 const approved=Nostr.eventTemplate({content:'approved',tags:[['d','original']]});
 const expected=structuredClone(approved);
 await assert.rejects(Nostr.checkedSign({signEvent:async t=>{t.tags[0][1]='different';t.content='different';return Nostr.finalizeEvent(t,key)}},approved,pubkey),/changed/);
 assert.deepEqual(approved,expected);
});
test('tag filters only match first tag value, and empty filter lists match nothing',async()=>{
 const good=signed(1,[['t','yes'],['p',pubkey]]),bad=signed(1,[['t','no','yes']]);
 assert.deepEqual((await Nostr.queryRelay(relay,{'#t':['yes']},{Socket:socket([bad,good])})).map(e=>e.id),[good.id]);
 assert.deepEqual(await Nostr.queryRelay(relay,{authors:[]},{Socket:socket([good])}),[]);
});
test('same timestamp profile winner uses lowest ID',async()=>{const a=signed(0,[],JSON.stringify({name:'a'})),b=signed(0,[],JSON.stringify({name:'b'}));const low=a.id<b.id?a:b;const result=await Nostr.fetchProfiles({pubkeys:[pubkey],relays:[relay],query:async()=>[a,b]});assert.equal(result.profiles.get(pubkey).name,JSON.parse(low.content).name);});
