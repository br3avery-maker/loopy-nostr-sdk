import {assertSignedEvent} from './events.js';
import {fetchFeed} from './feed.js';
/** Parse kind0 metadata, preserving only safe serializable profile fields; never HTML. */
export function parseProfile(event){
  if(event?.kind!==0)throw new TypeError('Expected kind 0 profile');assertSignedEvent(event);
  let p;try{p=JSON.parse(event.content)}catch{throw new Error('Invalid kind0 metadata JSON')}
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Invalid profile object');
  const out={pubkey:event.pubkey,updated:event.created_at};for(const k of ['name','display_name','about','picture','banner','nip05','website'])if(typeof p[k]==='string')out[k]=p[k].slice(0,k==='about'?4096:1024);
  return out;
}
export async function fetchProfiles({pubkeys=[],relays=[],query}={}){
  const result=await fetchFeed({authors:pubkeys,kinds:[0],relays,query});const profiles=new Map();
  for(const e of result.events){if(profiles.has(e.pubkey))continue;try{profiles.set(e.pubkey,parseProfile(e))}catch{}}
  return {profiles,failed:result.failed,status:result.status};
}
