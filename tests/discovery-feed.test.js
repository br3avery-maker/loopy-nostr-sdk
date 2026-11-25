import test from 'node:test';import assert from 'node:assert/strict';import {Nostr} from '../src/index.js';
const key=Nostr.generateSecretKey(),pubkey=Nostr.getPublicKey(key);const signer={getPublicKey:async()=>pubkey,signEvent:async t=>Nostr.finalizeEvent(t,key)};
test('NIP65 automatic discovery uses newest signed list and includes fallback diagnostics',async()=>{
  const kind=10002,tags=[['r','wss://real.example','write'],['r','wss://inbox.example','read']];const event=Nostr.finalizeEvent(Nostr.eventTemplate({kind,tags}),key);
  const result=await Nostr.discoverRelays(pubkey,{bootstrap:['wss://boot.example'],query:async()=>[event]});
  assert.equal(result.status,'verified-list');assert.equal(result.records.length,2);assert.ok(result.relays.includes('wss://real.example'));assert.equal(result.sourceEvent,event.id);
});
test('discovery rejects other-author and invalid signatures',async()=>{const e=Nostr.finalizeEvent(Nostr.eventTemplate({kind:10002,tags:[['r','wss://evil.example']]}),key);const x=await Nostr.discoverRelays('f'.repeat(64),{bootstrap:['wss://boot.example'],query:async()=>[e]});assert.equal(x.status,'bootstrap-only');assert.ok(!x.relays.includes('wss://evil.example'));});
test('BUD03 Blossom discovery obtains signed servers',async()=>{const event=Nostr.finalizeEvent(Nostr.eventTemplate({kind:10063,tags:[['server','https://blossom.example'],['server','http://bad.example']]}),key);const result=await Nostr.discoverBlossom(pubkey,{bootstrap:['wss://relay.example'],query:async()=>[event]});assert.equal(result.verified,true);assert.deepEqual(result.servers,['https://blossom.example']);});
test('Deepink post/reply/reaction templates signed and retrieved',async()=>{
  const post=Nostr.finalizeEvent(Nostr.textNote('Hello'),key);const reply=Nostr.finalizeEvent(Nostr.textNote('Reply',{replyTo:post}),key);const react=Nostr.finalizeEvent(Nostr.reaction(post,'+'),key);
  assert.equal(reply.tags.find(t=>t[0]==='e')?.[1],post.id);assert.equal(react.kind,7);
  const result=await Nostr.publishTemplate(Nostr.textNote('Published'),{signer,pubkey,relays:['wss://rel.example'],publisher:async event=>({verified:[{relay:'wss://rel.example',eventId:event.id,accepted:true,readback:true}]})});assert.equal(result.event.kind,1);
  const feed=await Nostr.fetchFeed({authors:[pubkey],relays:['wss://rel.example'],query:async()=>[post,reply,react]});assert.equal(feed.events.length,3);
});
test('note publication does not accept unverified relay',async()=>{await assert.rejects(Nostr.publishTemplate(Nostr.textNote('hello'),{signer,pubkey,relays:['wss://rel.example'],publisher:async()=>({verified:[{relay:'wss://rel.example',accepted:true}]})}),/No verified relay/);});
test('valid signed kind0 profile parses and selects newest',async()=>{const e=Nostr.finalizeEvent(Nostr.eventTemplate({kind:0,content:JSON.stringify({name:'Test',about:'Hi',junk:42})}),key);assert.equal(Nostr.parseProfile(e).name,'Test');const profiles=await Nostr.fetchProfiles({pubkeys:[pubkey],relays:['wss://rel.example'],query:async()=>[e]});assert.equal(profiles.profiles.get(pubkey).about,'Hi');});
