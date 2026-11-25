import {normalizePubkey,normalizeEmojiHash,normalizePubkeyList,normalizeHashList} from './identity.js';
import {assertSignedEvent,eventTemplate} from '../nostr/events.js';
// Public build: policy lists are caller-supplied; private curated data is not distributed.
export const MOJI_CURATOR_BLOCKLIST_VERSION='moji-curator-blocklist/v1';
export const BUILT_IN_NSFW_BAN_PUBKEYS=Object.freeze([]);
export const BUILT_IN_NSFW_MEDIA_URLS=Object.freeze([]);
export const BUILT_IN_NSFW_BLOB_HASHES=Object.freeze([]);
export function parseCuratorBlocklist(raw){let v;if(typeof raw!=='string'||!raw.trim())throw Error('Blocklist JSON required');try{v=JSON.parse(raw)}catch{throw Error('Invalid blocklist JSON')}if(!v||typeof v!=='object')throw Error('Blocklist must be JSON array or object');
 const pubs=[],hashes=[],urls=[];
 function entry(obj){if(typeof obj==='string'){const p=normalizePubkey(obj),h=normalizeEmojiHash(obj);if(p)pubs.push(p);else if(h)hashes.push(h);else if(/^https:\/\//i.test(obj))urls.push(obj);return}if(!obj||typeof obj!=='object')return;for(const k of ['author','pubkey','sourceAddress'])if(typeof obj[k]==='string'){const p=normalizePubkey(k==='sourceAddress'?obj[k].split(':')[1]:obj[k]);if(p)pubs.push(p)}if(typeof obj.hash==='string')hashes.push(obj.hash);if(typeof obj.url==='string'&&/^https:\/\//i.test(obj.url))urls.push(obj.url)}
 if(Array.isArray(v))v.slice(0,10000).forEach(entry);else{
  for(const k of ['blockedPublishers','nsfwBanPubkeys','pubkeys','safePubkeys'])if(Array.isArray(v[k]))v[k].slice(0,10000).forEach(entry);
  for(const k of ['nsfwBanEmojiHashes','emojiHashes','hashes'])if(Array.isArray(v[k]))hashes.push(...v[k].slice(0,10000));
  for(const k of ['blocked','media'])if(Array.isArray(v[k]))v[k].slice(0,10000).forEach(entry);
 }
 return {schema:MOJI_CURATOR_BLOCKLIST_VERSION,pubkeys:normalizePubkeyList(pubs),emojiHashes:normalizeHashList(hashes),mediaUrls:[...new Set(urls)].slice(0,10000)};
}
/** NIP-51: only verified signer output is accepted. Hashed words and private encrypted content are outside this parser. */
export function parseNip51MuteList(event){if(event?.kind!==10000)throw Error('Expected NIP-51 kind 10000');assertSignedEvent(event);return {pubkey:event.pubkey,pubkeys:normalizePubkeyList(event.tags.filter(t=>t[0]==='p').map(t=>t[1])),eventId:event.id,createdAt:event.created_at};}
export function muteListTemplate(pubkeys,{created_at=Math.floor(Date.now()/1000)}={}){const tags=normalizePubkeyList(pubkeys).map(p=>['p',p]);return eventTemplate({kind:10000,content:'',tags,created_at})}
/** No user decisions are silently replaced by fetched lists. */
export function mergeBlocklists(...lists){const p=[],h=[],u=[];for(const l of lists){p.push(...(l?.pubkeys||[]));h.push(...(l?.emojiHashes||[]));u.push(...(l?.mediaUrls||[]))}return {pubkeys:normalizePubkeyList(p),emojiHashes:normalizeHashList(h),mediaUrls:[...new Set(u)]}}
/** Default = block exact known publishers or hashes, never keywords/shortcodes. */
export function isEmojiAllowed(candidate,policy={}){
 if(candidate?.source==='reserve')return true;
 const author=normalizePubkey(candidate?.packAuthor),hash=normalizeEmojiHash(candidate?.hash);
 if(candidate?.emojiKey&&new Set(policy.blockedEmojiKeys||[]).has(candidate.emojiKey))return false;
 if(author&&new Set(normalizePubkeyList(policy.bannedPubkeys===undefined?BUILT_IN_NSFW_BAN_PUBKEYS:[...policy.bannedPubkeys])).has(author))return false;
 if(hash&&new Set(normalizeHashList(policy.bannedEmojiHashes===undefined?BUILT_IN_NSFW_BLOB_HASHES:[...policy.bannedEmojiHashes])).has(hash))return false;
 if(policy.filterMode==='safe_list_only')return !!author&&(new Set(normalizePubkeyList(policy.safePubkeys?[...policy.safePubkeys]:[])).has(author)||Boolean(policy.isSignedIn&&author===normalizePubkey(policy.activeUserPubkey)));
 return true;
}
