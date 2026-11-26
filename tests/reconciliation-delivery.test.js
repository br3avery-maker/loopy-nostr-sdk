import test from 'node:test';
import assert from 'node:assert/strict';
import { Nostr } from '../src/index.js';
const { planRelayDelivery, summarizeRelayDelivery } = Nostr;
const now = 1700000000, a = Nostr.generateSecretKey(), b = Nostr.generateSecretKey();
const author = Nostr.getPublicKey(a), peer = Nostr.getPublicKey(b);
const sign = (key, kind, tags = [], content = '', created_at = now) => Nostr.finalizeEvent({kind,tags,content,created_at},key);
const A='wss://author.example', B='wss://inbox.example', C='wss://fallback.example', D='wss://extra.example';
const event = sign(a,1,[['p',peer]],'💗 hi');
const lists = [sign(a,10002,[['r',A,'write'],['r',C,'read']]),sign(b,10002,[['r',B,'read'],['r',D,'write']])];
const policy = (relay,limitation,observedAt=now) => ({relay,observedAt,document:{limitation}});
const receipt = (relay, id=event.id, readback=true) => ({relay,eventId:id,accepted:true,readback});
const options = {signedLists:lists,defaults:[C],now,redundancy:1};
test('signed destination groups preserve recipient failure and role-specific relay choice',()=>{
  const plan=planRelayDelivery(event,options);
  assert.deepEqual(plan.groups.map(g=>g.selected.map(x=>x.relay)),[[A],[B]]);
  assert.equal(summarizeRelayDelivery(plan,[receipt(A)]).status,'partial-or-failed');
  assert.equal(summarizeRelayDelivery(plan,[receipt(A),receipt(B)]).status,'verified');
  assert.equal(planRelayDelivery(event,{...options,signedLists:[lists[0]]}).groups[1].status,'recipient-list-missing');
});
test('newest list wins even when empty; same-time tie is lowest ID; reject tampering',()=>{
  const empty=sign(b,10002,[],'',now+1);
  assert.equal(planRelayDelivery(event,{...options,signedLists:[...lists,empty]}).groups[1].status,'recipient-list-missing');
  const other=sign(b,10002,[['r',D,'read']]);
  const winner=[lists[1],other].sort((x,y)=>x.id.localeCompare(y.id))[0];
  assert.equal(planRelayDelivery(event,{...options,signedLists:[...lists,other]}).groups[1].selected[0].relay,winner.tags[0][1]);
  assert.equal(planRelayDelivery(event,{...options,signedLists:[lists[0],{...lists[1],content:'changed'}]}).groups[1].status,'recipient-list-missing');
});
test('fresh NIP-11 restrictions exclude candidates, stale metadata stays advisory, later fallback survives cap',()=>{
  const plan=planRelayDelivery(event,{...options,maxCandidates:1,relayPolicies:[policy(A,{max_content_length:1}),policy(B,{payment_required:true},now-22000)]});
  assert.deepEqual(plan.groups[0].selected.map(x=>x.relay),[C]);
  assert.deepEqual(plan.excluded,[{group:'author',relay:A,reasons:['content-size']}]);
  assert.ok(plan.groups[1].selected[0].warnings.includes('metadata-unavailable-or-stale'));
  const conflict=planRelayDelivery(event,{...options,relayPolicies:[policy(A,{max_content_length:1}),policy(A,{max_content_length:100})]});
  assert.equal(conflict.groups[0].selected[0].relay,C);
});
test('exact frame bytes, Unicode character limit, tag limit, PoW and declared auth/payment are distinct',()=>{
  const plan=planRelayDelivery(event,{...options,relayPolicies:[policy(A,{max_message_length:1,max_content_length:4,max_event_tags:0,min_pow_difficulty:257,auth_required:true,payment_required:true})]});
  assert.deepEqual(plan.excluded[0].reasons,['frame-size','tag-count','pow','auth-required','payment-required']);
  const entitled=planRelayDelivery(event,{...options,authAvailable:true,authPubkey:author,entitledRelays:[A],relayPolicies:[policy(A,{auth_required:true,payment_required:true})]});
  assert.equal(entitled.groups[0].selected[0].requiresAuthentication,true);
});
test('private and protected planning never widens destinations or implies authentication',()=>{
  assert.throws(()=>planRelayDelivery(event,{...options,visibility:'private'}),/approved destinations/);
  const privatePlan=planRelayDelivery(event,{...options,visibility:'private',allowedRelays:[D]});
  assert.deepEqual(privatePlan.groups.map(g=>g.selected.map(x=>x.relay)),[[D]]);
  const protectedEvent=sign(a,1,[['-']]);
  assert.throws(()=>planRelayDelivery(protectedEvent,options),/author authentication/);
  assert.throws(()=>planRelayDelivery(protectedEvent,{...options,authAvailable:true,authPubkey:peer}),/author authentication/);
  assert.equal(planRelayDelivery(protectedEvent,{...options,authAvailable:true,authPubkey:author}).groups[0].selected[0].requiresAuthentication,true);
  assert.throws(()=>planRelayDelivery(sign(a,22242),options),/not publishable/);
});
test('gift wraps use only latest signed recipient inbox list, never bootstrap fallback',()=>{
  const wrap=sign(a,1059,[['p',peer]]);
  assert.throws(()=>planRelayDelivery(wrap,options),/verified recipient inbox/);
  const inbox=sign(b,10050,[['relay',B]]);
  const plan=planRelayDelivery(wrap,{...options,signedLists:[...lists,inbox],pinned:[A]});
  assert.deepEqual(plan.groups.map(g=>g.selected.map(x=>x.relay)),[[B]]);
  assert.equal(plan.visibility,'private');
  assert.throws(()=>planRelayDelivery(wrap,{...options,signedLists:[inbox],allowedRelays:[A]}),/verified recipient inbox/);
  assert.throws(()=>planRelayDelivery(wrap,{...options,signedLists:[inbox,sign(b,10050,[],'',now+1)]}),/verified recipient inbox/);
});
test('stored-event receipts require exact ID, relay and readback; duplicate receipts cannot meet redundancy',()=>{
  const plan=planRelayDelivery(event,{...options,redundancy:2});
  const bad=[receipt(A),receipt(A),receipt(C,'0'.repeat(64)),receipt(B,event.id,false),receipt(D)];
  const r=summarizeRelayDelivery(plan,bad);
  assert.equal(r.status,'partial-or-failed');assert.deepEqual(r.groups[0].delivered,[A]);assert.deepEqual(r.groups[1].delivered,[]);
});
test('ephemeral acknowledgments are not described as durable readback',()=>{
  const ephemeral=sign(a,20001), plan=planRelayDelivery(ephemeral,{...options});
  assert.equal(summarizeRelayDelivery(plan,[receipt(A,ephemeral.id,false)]).status,'accepted-ephemeral');
  assert.equal(summarizeRelayDelivery(plan,[receipt(A,event.id,false)]).status,'partial-or-failed');
});
test('discovered local address hints are not selected absent an explicit caller destination',()=>{
  const local='wss://127.0.0.1:9000', localList=sign(b,10002,[['r',local,'read']]);
  const plan=planRelayDelivery(event,{...options,signedLists:[lists[0],localList]});
  assert.equal(plan.groups[1].status,'recipient-list-missing');
  assert.equal(planRelayDelivery(event,{...options,signedLists:[localList],allowedRelays:[local]}).groups[1].selected[0].relay,local);
});
test('route input size and recipient bounds fail before planning',()=>{
  assert.throws(()=>planRelayDelivery({...event,content:'x'.repeat(1048577)},options),/input bounds/);
  assert.throws(()=>planRelayDelivery(event,{...options,redundancy:0}),/delivery limits/);
  assert.throws(()=>planRelayDelivery(event,{...options,signedLists:Array(257).fill(lists[0])}),/signed lists/);
});
