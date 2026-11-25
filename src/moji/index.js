/** MojiSurvivor-derived portable NIP-30 emoji, hash-identity, and optional game mechanics. */
import {sha256} from '../core/bytes.js';
import {assertSignedEvent} from '../nostr/events.js';
import {isEmojiAllowed} from '../moderation/lists.js';

/** Uses the actual Blossom content hash if embedded; otherwise a deterministic URL fingerprint, NOT a verified media digest. */
export async function extractEmojiHash(url){
 if(typeof url!=='string'||!url.trim())throw TypeError('Media URL required');
 const trimmed=url.trim();
 if(!trimmed.startsWith('data:')){try{const u=new URL(trimmed);if(!['https:','http:'].includes(u.protocol))throw Error('Invalid media scheme');const match=/\/([0-9a-f]{64})(?:\.[a-z0-9]{1,8})?$/i.exec(u.pathname);if(match)return match[1].toLowerCase();u.hash='';return sha256(u.href)}catch(e){if(e.message==='Invalid media scheme')throw e}}
 return sha256(trimmed);
}
export function sanitizeEmojiShortcode(s){return typeof s==='string'&&/^[a-zA-Z0-9_+-]{1,64}$/.test(s)?s:''}
export async function buildStableEmojiKey(url,source='nip30',hashOverride){if(!['nip30','reserve'].includes(source))throw TypeError('Unknown emoji source');const hash=/^[a-f0-9]{64}$/i.test(hashOverride||'')?hashOverride.toLowerCase():await extractEmojiHash(url);return `${source}:${hash}`}
export function deriveEmojiStatsFromHash(hash){
 if(typeof hash!=='string'||!/^[0-9a-f]{64}$/i.test(hash))throw TypeError('64-character emoji hash required');hash=hash.toLowerCase();const n=i=>parseInt(hash.slice(i*2,i*2+2),16);
 const hp=20+Math.floor(n(0)/255*80),speed=Number((1+n(1)/255*2.2).toFixed(2)),damage=5+Math.floor(n(2)/255*20),behaviorType=n(3)%4,expValue=1+Math.floor(n(4)/255*4),mojoValue=1+(n(4)>205?2:n(4)>110?1:0);
 const powerRating=Math.floor(hp*0.5+speed*15+damage*2),tier=powerRating>=112?'Apex':powerRating>=94?'Epic':powerRating>=76?'Rare':'Common';
 return {hp,speed,damage,behaviorType,behaviorName:['Swarm Rusher','Zigzag Stalker','Shockwave Brute','Orbiting Sniper'][behaviorType],expValue,mojoValue,powerRating,tier};
}
export async function deriveEmojiStats({shortcode,url,source='nip30',hashOverride}={}){
 const hash=/^[0-9a-f]{64}$/i.test(hashOverride||'')?hashOverride.toLowerCase():await extractEmojiHash(url);
 return {emojiKey:`${source}:${hash}`,shortcode:sanitizeEmojiShortcode(shortcode)||hash.slice(0,8),url,source,hash,...deriveEmojiStatsFromHash(hash)};
}
/** Parse a signed NIP-30 set (30030) or user list (10030); referenced 'a' tags need separate signed-event resolution. */
export async function parseNip30Event(event,{policy={},max=500}={}){
 if(![10030,30030].includes(event?.kind))throw TypeError('Expected kind 10030 or 30030');assertSignedEvent(event);
 const title=event.tags.find(t=>t[0]==='title')?.[1]||event.tags.find(t=>t[0]==='d')?.[1]||'Emoji pack';
 const out=[],excluded=[],refs=[];for(const tag of event.tags){if(tag[0]==='a'&&typeof tag[1]==='string')refs.push(tag[1]);if(tag[0]!=='emoji')continue;if(out.length+excluded.length>=max)break;const shortcode=sanitizeEmojiShortcode(tag[1]),url=tag[2];if(!shortcode||typeof url!=='string')continue;let u;try{u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue}catch{continue}
 const stats=await deriveEmojiStats({shortcode,url:u.href,source:'nip30'});const emoji={...stats,packAuthor:event.pubkey,packTitle:title.slice(0,100),eventId:event.id};(isEmojiAllowed(emoji,policy)?out:excluded).push(emoji)
 }
 return {eventId:event.id,pubkey:event.pubkey,title:title.slice(0,100),kind:event.kind,emojis:out,excluded,unresolvedReferences:refs};
}
export async function collectNip30Emojis(events,{policy={},max=1000}={}){
 if(!Array.isArray(events))throw TypeError('Signed NIP-30 event list expected');const seen=new Map(),rejected=[],unresolved=[];
 for(const event of events){if(![10030,30030].includes(event?.kind))continue;try{const pack=await parseNip30Event(event,{policy,max});unresolved.push(...pack.unresolvedReferences);rejected.push(...pack.excluded);for(const emoji of pack.emojis)if(!seen.has(emoji.emojiKey)&&seen.size<max)seen.set(emoji.emojiKey,emoji)}catch(e){rejected.push({eventId:event?.id||null,error:e.message})}}
 return {emojis:[...seen.values()],rejected,unresolvedReferences:[...new Set(unresolved)]};
}
