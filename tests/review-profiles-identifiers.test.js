import test from 'node:test';
import assert from 'node:assert/strict';
import {Nostr,Moderation} from '../src/index.js';

const relays=['wss://one.example','wss://two.example'];
const keys=Array.from({length:101},()=>Nostr.generateSecretKey());
const pubkeys=keys.map(key=>Nostr.getPublicKey(key));
const profile=(key,name,created_at)=>Nostr.finalizeEvent(Nostr.eventTemplate({kind:0,content:JSON.stringify({name}),created_at}),key);
const events=keys.map((key,i)=>profile(key,`profile-${i}`,100+i));

// Simulate a relay enforcing the requested limit on signed matching events.
function reply(pool,filter){return pool.filter(e=>filter.authors.includes(e.pubkey)&&filter.kinds.includes(e.kind)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,filter.limit)}

test('profile retrieval does not drop the 101st author or repeat duplicate queries',async()=>{
  let active=0,peak=0;const calls=[];
  const r=await Nostr.fetchProfiles({pubkeys:[...pubkeys,pubkeys[0]],relays:[relays[0]],query:async(url,filter)=>{
    calls.push(filter.authors);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setImmediate(resolve));active--;
    return reply(events,filter);
  }});
  assert.equal(r.status,'queried');assert.equal(r.failed.length,0);
  assert.equal(r.profiles.size,101);assert.equal(r.profiles.get(pubkeys[0]).name,'profile-0');
  assert.equal(calls.length,101);assert.ok(calls.every(a=>a.length===1));assert.ok(peak<=16);
});
test('revisions from one author do not crowd out another; ties and invalid results stay deterministic',async()=>{
  const revisions=Array.from({length:101},(_,i)=>profile(keys[0],`revision-${i}`,200+i));
  const other=events[1],tied=profile(keys[0],'tie',300),latest=revisions.at(-1);
  const malformed=Nostr.finalizeEvent(Nostr.eventTemplate({kind:0,content:'not json',created_at:400}),keys[0]);
  const unrelated=events[2],tampered={...latest,content:'{"name":"tampered"}'};
  const result=await Nostr.fetchProfiles({pubkeys:pubkeys.slice(0,2),relays,query:async(url,filter)=>{
    const pool=url===relays[0]?[...revisions,malformed,other]:[tied,other];
    return [...reply(pool,filter),unrelated,tampered];
  }});
  const winning=latest.id<tied.id?latest:tied;
  assert.equal(result.profiles.size,2);assert.equal(result.profiles.get(pubkeys[0]).name,JSON.parse(winning.content).name);
  assert.equal(result.profiles.get(pubkeys[1]).name,'profile-1');assert.equal(result.profiles.has(unrelated.pubkey),false);
});
test('partial profile failures identify the author and relay, and malformed transport results are failures',async()=>{
  const result=await Nostr.fetchProfiles({pubkeys:pubkeys.slice(0,2),relays,query:async(url,filter)=>{
    if(url===relays[1]){if(filter.authors[0]===pubkeys[0])throw Error('offline');return null}
    return reply(events,filter);
  }});
  assert.equal(result.status,'queried');assert.equal(result.profiles.size,2);
  assert.equal(result.failed.length,2);assert.deepEqual(new Set(result.failed.map(x=>x.pubkey)),new Set(pubkeys.slice(0,2)));
  assert.ok(result.failed.every(x=>x.relay===relays[1]));
  const offline=await Nostr.fetchProfiles({pubkeys:pubkeys.slice(0,2),relays,query:()=>{throw Error('offline')}});
  assert.equal(offline.status,'unreachable');assert.equal(offline.failed.length,4);
  await assert.rejects(Nostr.fetchProfiles({pubkeys:['extra'+pubkeys[0]],relays,query:()=>{throw Error('must not query')}}),/Expected hex/);
});

// Independent bech32 encoder for checksum-valid NIP-19 TLV fixtures.
const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function encode(hrp,bytes){
  const words=[];let acc=0,bits=0;for(const byte of bytes){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;words.push((acc>>>bits)&31)}}if(bits)words.push((acc<<(5-bits))&31);
  const input=[...hrp].map(c=>c.charCodeAt(0)>>>5).concat(0,[...hrp].map(c=>c.charCodeAt(0)&31),words,[0,0,0,0,0,0]);
  let chk=1;for(const x of input){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^x;[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3].forEach((g,i)=>{if(top&(1<<i))chk^=g})}chk^=1;
  return hrp+'1'+[...words,...Array.from({length:6},(_,i)=>(chk>>>(5*(5-i)))&31)].map(x=>alphabet[x]).join('');
}
const id=Array(32).fill(0x11),author=Array(32).fill(0x22),hint=[...new TextEncoder().encode(relays[0])];
const tlv=(t,bytes)=>[t,bytes.length,...bytes];
test('nevent preserves exact event ID independently of optional author, kind, and relay hints',()=>{
  for(const parts of [[...tlv(0,id),...tlv(2,author)],[...tlv(2,author),...tlv(0,id)]]){
    const r=Moderation.decodeNip19(encode('nevent',[...parts,...tlv(1,hint),...tlv(3,[0,0,0,1])]));
    assert.equal(r.hex,'11'.repeat(32));assert.equal(r.author,'22'.repeat(32));assert.equal(r.kind,1);assert.deepEqual(r.relays,[relays[0]]);
  }
  const minimal=Moderation.decodeNip19(encode('nevent',tlv(0,id)));assert.equal(minimal.hex,'11'.repeat(32));assert.equal(minimal.author,null);
  assert.throws(()=>Moderation.decodeNip19(encode('nevent',tlv(2,author))),/event ID/);
  assert.equal(Moderation.normalizePubkey(encode('nevent',[...tlv(0,id),...tlv(2,author)])),null);
});
test('nprofile ignores unsupported author hints; naddr retains its coordinate author',()=>{
  const p=Moderation.decodeNip19(encode('nprofile',[...tlv(0,id),...tlv(2,author)]));assert.equal(p.hex,'11'.repeat(32));
  const a=Moderation.decodeNip19(encode('naddr',[...tlv(0,[120]),...tlv(2,author),...tlv(3,[0,0,0x75,0x30])]));assert.equal(a.hex,'22'.repeat(32));assert.equal(a.identifier,'x');assert.equal(a.kind,30000);
});
