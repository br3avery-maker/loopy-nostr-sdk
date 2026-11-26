import test from 'node:test';
import assert from 'node:assert/strict';
import {Nostr} from '../src/index.js';
const a=Nostr.generateSecretKey(), b=Nostr.generateSecretKey(), author=Nostr.getPublicKey(a), peer=Nostr.getPublicKey(b);
const A='wss://author.example', B='wss://backup.example', C='wss://unapproved.example';
const now=Math.floor(Date.now()/1000);
const signed=(kind,tags=[],key=a,created_at=now)=>Nostr.finalizeEvent({kind,tags,content:'',created_at},key);
const event=signed(1), opts={allowedRelays:[A,B],defaults:[A,B,C],redundancy:1,timeoutMs:500,now};
const signer={signEvent:async t=>Nostr.finalizeEvent(t,a)};
function fake(handler,initial) {
  const opened=[];
  class Socket {
    constructor(url){this.url=url;this.sent=[];opened.push(this);queueMicrotask(()=>{if(this.closed)return;this.onopen?.();initial?.(this);});}
    send(raw){const m=JSON.parse(raw);this.sent.push(m);handler(this,m);}
    emit(m){queueMicrotask(()=>{if(!this.closed)this.onmessage?.({data:JSON.stringify(m)});});}
    close(){this.closed=true;}
  }
  return {Socket,opened};
}
const reply=(s,m)=>{if(m[0]==='EVENT')s.emit(['OK',m[1].id,true,'']);if(m[0]==='REQ')s.emit(['EVENT',m[1],event]);};
test('bounded fallback uses same signed event and never opens unapproved destination',async()=>{
  const {Socket,opened}=fake((s,m)=>s.url===A?s.emit(['OK',event.id,false,'unsupported-kind: denied']):reply(s,m));
  const r=await Nostr.executeRelayDelivery(event,{...opts,Socket});assert.equal(r.summary.status,'verified');assert.deepEqual(opened.map(s=>s.url),[A,B]);assert.ok(opened.every(s=>s.sent[0][1].id===event.id&&s.closed));assert.equal(r.observations[0].code,'unsupported-kind');assert.equal(r.observations[1].readback,true);
  assert.equal(Nostr.planRelayDelivery(event,{...opts,observations:r.observations}).groups[0].selected[0].relay,B);
});
test('AUTH before protected event is exact challenge, destination, and author; no content before approval',async()=>{
  const e=signed(1,[['-']]);const {Socket,opened}=fake((s,m)=>{if(m[0]==='AUTH'){assert.equal(m[1].kind,22242);assert.equal(m[1].pubkey,author);assert.deepEqual(m[1].tags,[['relay',A],['challenge','abc']]);assert.equal(Nostr.verifyEvent(m[1]),true);s.emit(['OK',m[1].id,true,'']);}else if(m[0]==='EVENT')s.emit(['OK',e.id,true,'']);else if(m[0]==='REQ')s.emit(['EVENT',m[1],e]);},s=>s.emit(['AUTH','abc']));
  const r=await Nostr.executeRelayDelivery(e,{...opts,Socket,authSigner:signer,authPubkey:author});assert.equal(r.summary.status,'verified');assert.deepEqual(opened[0].sent.map(m=>m[0]),['AUTH','EVENT','REQ']);assert.equal(r.observations[0].principal,author);
});
test('auth-required on EVENT retries once with original event only after exact AUTH OK',async()=>{
  let auth=false;const {Socket,opened}=fake((s,m)=>{if(m[0]==='EVENT'&&!auth){s.emit(['AUTH','c']);s.emit(['OK',event.id,false,'auth-required: authenticate']);}else if(m[0]==='AUTH'){auth=true;s.emit(['OK',m[1].id,true,'']);}else reply(s,m);});
  const r=await Nostr.executeRelayDelivery(event,{...opts,Socket,authSigner:signer,authPubkey:author});assert.equal(r.summary.status,'verified');assert.deepEqual(opened[0].sent.map(m=>m[0]),['EVENT','AUTH','EVENT','REQ']);assert.equal(opened[0].sent[0][1].id,opened[0].sent[2][1].id);
});
test('auth-required readback uses fresh subscription and ignores prior response',async()=>{
  let old;const {Socket,opened}=fake((s,m)=>{if(m[0]==='EVENT')s.emit(['OK',event.id,true,'']);if(m[0]==='REQ'&&!old){old=m[1];s.emit(['AUTH','read']);s.emit(['CLOSED',old,'auth-required: read']);}else if(m[0]==='AUTH')s.emit(['OK',m[1].id,true,'']);else if(m[0]==='REQ'){assert.notEqual(m[1],old);s.emit(['EVENT',old,event]);s.emit(['EVENT',m[1],event]);}});
  const r=await Nostr.executeRelayDelivery(event,{...opts,Socket,authSigner:signer,authPubkey:author});assert.equal(r.summary.status,'verified');assert.deepEqual(opened[0].sent.map(m=>m[0]),['EVENT','REQ','AUTH','REQ']);
});
test('wrong signer identity or template never sends AUTH or protected event',async()=>{
  const e=signed(1,[['-']]);for(const authSigner of [{signEvent:async t=>Nostr.finalizeEvent(t,b)},{signEvent:async t=>Nostr.finalizeEvent({...t,content:'mutated'},a)}]){
    const {Socket,opened}=fake(()=>assert.fail('no frame permitted'),s=>s.emit(['AUTH','c']));const r=await Nostr.executeRelayDelivery(e,{...opts,Socket,authSigner,authPubkey:author});assert.equal(r.summary.status,'partial-or-failed');assert.ok(opened.every(s=>s.sent.length===0&&s.closed));
  }
});
test('cancel pending AUTH signer closes socket and late approval sends nothing',async()=>{
  const e=signed(1,[['-']]), ac=new AbortController();let release,started;const wait=new Promise(r=>started=r);
  const authSigner={signEvent:t=>new Promise(r=>{release=()=>r(Nostr.finalizeEvent(t,a));started();})};const {Socket,opened}=fake(()=>assert.fail('no frame permitted'),s=>s.emit(['AUTH','c']));
  const promise=Nostr.executeRelayDelivery(e,{...opts,Socket,authSigner,authPubkey:author,signal:ac.signal});await wait;ac.abort();await assert.rejects(promise,/cancelled/);release();await new Promise(r=>setImmediate(r));assert.ok(opened.every(s=>s.closed&&s.sent.length===0));
});
test('changed challenge during approval rejects stale signature',async()=>{
  const e=signed(1,[['-']]);let release,started;const wait=new Promise(r=>started=r);const authSigner={signEvent:t=>new Promise(r=>{release=()=>r(Nostr.finalizeEvent(t,a));started();})};const {Socket,opened}=fake(()=>assert.fail('no frame permitted'),s=>s.emit(['AUTH','first']));
  const promise=Nostr.executeRelayDelivery(e,{...opts,Socket,authSigner,authPubkey:author,maxAttempts:1});await wait;opened[0].emit(['AUTH','second']);await new Promise(r=>setImmediate(r));release();assert.equal((await promise).summary.status,'partial-or-failed');assert.equal(opened[0].sent.length,0);
});
test('ephemeral ACK is not durable delivery, unapproved destination list rejected before opening',async()=>{
  const e=signed(20001);const {Socket,opened}=fake((s,m)=>{assert.equal(m[0],'EVENT');s.emit(['OK',e.id,true,'']);});
  await assert.rejects(Nostr.executeRelayDelivery(e,{defaults:[A],Socket}),/approved/);assert.equal(opened.length,0);
  const r=await Nostr.executeRelayDelivery(e,{...opts,Socket});assert.equal(r.summary.status,'accepted-ephemeral');assert.equal(r.receipts[0].readback,false);
});
test('monitor signatures, newest revision, and conflict are advisory, not allowlists',()=>{
  const positive=signed(30166,[['d',B],['k','1']],a),negative=signed(30166,[['d',B],['k','!1']],b);
  const stale=signed(30166,[['d',A],['k','1']],a,now-4000),alien=signed(30166,[['d',C],['k','1']],a);
  let plan=Nostr.planRelayDelivery(event,{...opts,monitorEvents:[positive,stale,alien]});assert.equal(plan.groups[0].selected[0].relay,B);
  plan=Nostr.planRelayDelivery(event,{...opts,monitorEvents:[positive,negative]});const c=[...plan.groups[0].selected,...plan.groups[0].fallbacks].find(x=>x.relay===B);assert.ok(c.warnings.includes('monitor-conflict'));assert.equal(plan.excluded.length,0);
  plan=Nostr.planRelayDelivery(event,{...opts,monitorEvents:[{...positive,content:'tampered'}]});assert.equal(plan.groups[0].selected[0].relay,A);
});
test('local cooldown scoped to exact principal and author/kind; stale failure does not block',()=>{
  const observation={relay:A,eventId:event.id,author,kind:1,principal:'anonymous',at:now,code:'unsupported-kind',accepted:false,readback:false};
  assert.equal(Nostr.planRelayDelivery(event,{...opts,observations:[observation]}).groups[0].selected[0].relay,B);
  assert.equal(Nostr.planRelayDelivery(event,{...opts,observations:[{...observation,principal:peer}]}).groups[0].selected[0].relay,A);
  assert.equal(Nostr.planRelayDelivery(event,{...opts,observations:[{...observation,at:now-301}]}).groups[0].selected[0].relay,A);
});
test('ack followed by wrong readback does not count as verified',async()=>{
  const {Socket}=fake((s,m)=>{if(m[0]==='EVENT')s.emit(['OK',event.id,true,'']);if(m[0]==='REQ')s.emit(['EVENT',m[1],{...event,content:'tampered'}]);});
  const r=await Nostr.executeRelayDelivery(event,{...opts,Socket,maxAttempts:1});assert.equal(r.summary.status,'partial-or-failed');assert.equal(r.receipts[0].accepted,true);assert.equal(r.receipts[0].readback,false);assert.equal(r.attempts[0].status,'accepted-unverified');
});
