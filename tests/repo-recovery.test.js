import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Core,Nostr,Moderation,Moji,Anchor,Archive,createNsiteSDK} from '../src/index.js';
const key=Nostr.generateSecretKey(),pubkey=Nostr.getPublicKey(key);
const sign=template=>Nostr.finalizeEvent(template,key);
const HASH='ab'.repeat(32);

test('NIP-19 roundtrip validates bech32 checksum, mixed case and prefix',()=>{
 const npub=Nostr.npubEncode(pubkey);assert.equal(Moderation.normalizePubkey(npub),pubkey);assert.equal(Moderation.normalizePubkey('nostr:'+npub),pubkey);
 assert.equal(Moderation.decodeNip19(npub).type,'npub');assert.equal(Moderation.normalizePubkey(npub.slice(0,-1)+'!'),null);assert.throws(()=>Moderation.decodeNip19(npub.toUpperCase().slice(0,12)+npub.slice(12)),/Mixed-case/);
});
test('public SDK does not ship personal publisher or media blocklists',()=>{
 assert.deepEqual(Moderation.BUILT_IN_NSFW_BAN_PUBKEYS,[]);assert.deepEqual(Moderation.BUILT_IN_NSFW_MEDIA_URLS,[]);assert.deepEqual(Moderation.BUILT_IN_NSFW_BLOB_HASHES,[]);
});

test('Moji curator imports explicit lists; ignores invalid IDs; safe-list behavior',()=>{
 const data=Moderation.parseCuratorBlocklist(JSON.stringify({blockedPublishers:[pubkey],nsfwBanEmojiHashes:[HASH],blocked:[{author:pubkey}]}));assert.deepEqual(data.pubkeys,[pubkey]);assert.deepEqual(data.emojiHashes,[HASH]);
 const c={emojiKey:'nip30:'+HASH,source:'nip30',hash:HASH,packAuthor:pubkey};
 assert.equal(Moderation.isEmojiAllowed(c,{bannedPubkeys:[pubkey]}),false);
 assert.equal(Moderation.isEmojiAllowed(c,{bannedEmojiHashes:[HASH]}),false);
 assert.equal(Moderation.isEmojiAllowed(c,{filterMode:'safe_list_only',safePubkeys:[]}),false);
 assert.equal(Moderation.isEmojiAllowed(c,{filterMode:'safe_list_only',safePubkeys:[pubkey]}),true);
 assert.equal(Moderation.isEmojiAllowed({...c,source:'reserve'},{bannedPubkeys:[pubkey]}),true);
});
test('NIP-51 mute lists require valid signatures and reject tampering',()=>{
 const unsigned=Moderation.muteListTemplate([pubkey,pubkey]);assert.equal(unsigned.kind,10000);assert.equal(unsigned.tags.length,1);
 const signed=sign(unsigned);assert.deepEqual(Moderation.parseNip51MuteList(signed).pubkeys,[pubkey]);assert.throws(()=>Moderation.parseNip51MuteList({...signed,tags:[]}),/Invalid Nostr event/);
});
test('confirmed role-promise-external-link spam requires all three independent signals',()=>{
 assert.equal(Moderation.campaignMatch('Independent web researcher offering curated resources at https://spam.example').reasons.length,3);
 assert.equal(Moderation.campaignMatch('Independent web researcher has produced a good index.html'),null);
 assert.equal(Moderation.campaignMatch('Community writer sharing practical notes with no links'),null);
 assert.equal(Moderation.inspectNsiteSpam({title:'Tools',description:'Independent web researcher sharing resources at www.demo.org'}).status,'confirmed');
 assert.equal(Moderation.inspectNsiteSpam({title:'Notes | A note about art',description:'A normal zine with no links'}).status,'review');
 assert.equal(Moderation.inspectNsiteSpam({kind:15128,pathCount:1,title:'Alice | Note',description:'https://example.com'}).status,'review');
});
test('cross-account clustering never globally bans a repeated title or protected own site',()=>{
 const items=[{id:'a',pubkey:'a'.repeat(64),description:'Notes on widgets and projects by a useful researcher'},
 {id:'b',pubkey:'b'.repeat(64),description:'Notes on widgets and projects by another researcher'},
 {id:'c',pubkey:'c'.repeat(64),description:'Notes on widgets and projects by a human',pinned:true},
 {id:'d',pubkey:'d'.repeat(64),description:'Notes on entirely different literature'}];
 const clusters=Moderation.clusterNsiteSpam(items);assert.equal(clusters.length,1);assert.deepEqual(clusters[0].ids,['a','b']);
 const filtered=Moderation.filterNsites(items);assert.equal(filtered.rawCount,4);assert.equal(filtered.hidden.length,0);assert.equal(filtered.visible.length,4);
 const opt=Moderation.filterNsites(items,{hideSuspected:true});assert.deepEqual(opt.hidden.map(x=>x.id),['a','b']);
});
test('Moji SHA identity uses immutable Blossom hash or URL fingerprint, never shortcode identity',async()=>{
 const url='https://blossom.example/'+HASH+'.png';assert.equal(await Moji.extractEmojiHash(url),HASH);
 assert.equal(await Moji.buildStableEmojiKey(url),`nip30:${HASH}`);
 assert.equal(await Moji.extractEmojiHash('https://example.org/cat.png'),await Core.sha256('https://example.org/cat.png'));
 const stat=Moji.deriveEmojiStatsFromHash(HASH);assert.equal(stat.behaviorName,Moji.deriveEmojiStatsFromHash(HASH).behaviorName);
 assert.equal(stat.hp>=20&&stat.hp<=100,true);assert.equal(stat.damage>=5&&stat.damage<=25,true);
});
test('NIP-30 ingest validates signed event, filters blocked pack authors, deduplicates media hash',async()=>{
 const media='https://blossom.example/'+HASH+'.png';const event=sign(Nostr.eventTemplate({kind:30030,tags:[['d','test'],['emoji','cat',media],['emoji','kitty',media]],content:''}));
 const parsed=await Moji.parseNip30Event(event);assert.equal(parsed.emojis.length,2);
 const grouped=await Moji.collectNip30Emojis([event,event]);assert.equal(grouped.emojis.length,1);
 const blocked=await Moji.parseNip30Event(event,{policy:{bannedPubkeys:[pubkey]}});assert.equal(blocked.emojis.length,0);assert.equal(blocked.excluded.length,2);
 await assert.rejects(Moji.parseNip30Event({...event,tags:[['emoji','evil',media]]}),/Invalid Nostr event/);
});
test('Anchor backup redacts secret fields, restores read-only and retains only verified publication events',()=>{
 const signed=sign(Nostr.eventTemplate({content:'published'}));const state={session:{mode:'nip46',pubkey,npub:Nostr.npubEncode(pubkey),secret:'do-not-save',connectionDetail:'bunker://private-example',rememberedPermissions:['sign_event']},profile:{name:'Example',privateKey:'must-not-save'},publications:[{currentEvent:signed},{currentEvent:{...signed,content:'tampered'}}]};
 const backup=Anchor.buildPublicAccountBackup(state);const str=JSON.stringify(backup);assert(!str.includes('do-not-save'));assert(!str.includes('private-example'));assert(!str.includes('must-not-save'));
 const restored=Anchor.restorePublicAccountBackup(backup);assert.equal(restored.signerConnected,false);assert.equal(restored.session.mode,'read-only');assert.equal(restored.publications.length,1);assert.equal(restored.rejectedPublications.length,1);
});
test('Anchor receipt summary separates relay acknowledgement from independent retrieval',()=>{
 const r=Anchor.summarizePublicationReceipts([{relay:'wss://one',accepted:true,readback:false},{relay:'wss://two',accepted:true,readback:true},{relay:'wss://bad',stage:'failed'}]);assert.equal(r.accepted,2);assert.equal(r.retrieved,1);assert.equal(r.verified,true);
});
test('exact deterministic Gear CDC boundaries match original Pretend-Internet profile',()=>{
 const data=Uint8Array.from({length:410000},(_,i)=>(i*89+Math.floor(i/123))%256);
 const gear=Array.from({length:256},(_,i)=>createHash('sha256').update(`nsite-gear-v1:${i}`).digest().readUInt32LE());let start=0,roll=0,sizes=[];
 for(let i=0;i<data.length;i++){roll=((roll<<1)+gear[data[i]])>>>0;const size=i-start+1;if(size>=16384&&((roll&65535)===0||size>=262144)){sizes.push(size);start=i+1;roll=0}}if(start<data.length)sizes.push(data.length-start);
 assert.deepEqual(Archive.gearChunks(data).map(a=>a.length),sizes);
});
test('CDC manifest restores exact file bytes and rejects corrupt chunks',async()=>{
 const data=Uint8Array.from({length:280000},(_,i)=>i%251);const manifest=await Archive.chunkManifest(data);
 const chunks=Archive.gearChunks(data),stored=new Map();for(const chunk of chunks)stored.set(await Core.sha256(chunk),chunk);
 assert.deepEqual(await Archive.restoreChunkManifest(manifest,h=>stored.get(h)),data);
 const bad=new Map(stored),first=manifest.chunks[0].hash;bad.set(first,Uint8Array.from(stored.get(first),(_,i)=>i===0?42:0));
 await assert.rejects(Archive.restoreChunkManifest(manifest,h=>bad.get(h)),/invalid chunk/);
});
test('facade exposes current recovered modules (not just indexed donor mentions)',()=>{
 const sdk=createNsiteSDK();assert.equal(sdk.moderation.inspectNsiteSpam,Moderation.inspectNsiteSpam);assert.equal(sdk.moji.parseNip30Event,Moji.parseNip30Event);assert.equal(sdk.anchor.buildPublicAccountBackup,Anchor.buildPublicAccountBackup);
});

test('Anchor event kind and relay audit require observed health, not guessed success',()=>{
 assert.deepEqual(Anchor.kindSpec(30030).storageClass,'addressable');assert.equal(Anchor.kindSpec(10000).nip,'NIP-51');
 const r=Anchor.planVerifiedOutbox([{url:'wss://a.example',status:'unknown'},{url:'wss://b.example',wsReachable:true,writeProbeAccepted:true,latencyMs:25},{url:'wss://c.example',wsReachable:false}]);
 assert.deepEqual(r.write,['wss://b.example']);assert.equal(r.reviewed[0].audit.status,'unverified');assert.equal(r.reviewed[2].audit.status,'exclude-write');
});

test('caller-supplied Moji publisher and media hash bans are applied without fetching',async()=>{
 const author=pubkey,hash=HASH;const url='https://blossom.example/'+hash+'.gif';assert.equal(await Moji.extractEmojiHash(url),hash);
 const policy={bannedPubkeys:[author],bannedEmojiHashes:[hash]};
 assert.equal(Moderation.isEmojiAllowed({source:'nip30',hash,packAuthor:'9'.repeat(64)},policy),false);
 assert.equal(Moderation.isEmojiAllowed({source:'nip30',hash:'d'.repeat(64),packAuthor:author},policy),false);
 const data=Moderation.parseCuratorBlocklist(JSON.stringify({blockedPublishers:[author],nsfwBanEmojiHashes:[hash]}));assert.equal(data.emojiHashes[0],hash);
});
