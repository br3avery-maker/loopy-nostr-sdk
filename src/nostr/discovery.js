import {relayList,planRelays} from './nip65.js';
import {assertSignedEvent} from './events.js';
import {queryRelay} from './relay-transport.js';
import {endpoint,endpoints} from '../core/urls.js';
/** Locate latest signed NIP-65 list from finite bootstrap queries. Returns diagnostics, never silently overrides user preferences. */
export async function discoverRelays(pubkey,{bootstrap=[],query=queryRelay,defaults=[],max=8,signal,timeoutMs,Socket}={}){
  if(!/^[0-9a-f]{64}$/.test(pubkey))throw new TypeError('Valid author pubkey required');
  const roots=endpoints(bootstrap,'relay',24);
  if(!roots.length)throw new Error('Provide at least one bootstrap relay');
  const observations=await Promise.allSettled(roots.map(async relay=>query(relay,{kinds:[10002],authors:[pubkey],limit:3},{signal,timeoutMs,Socket})));
  const candidates=[];const errors=[];
  for(let i=0;i<observations.length;i++){
    const result=observations[i],relay=roots[i];if(result.status==='rejected'||!Array.isArray(result.value)){errors.push({relay,error:result.status==='rejected'?String(result.reason?.message??result.reason):'Malformed relay result'});continue;}
    for(const event of result.value){try{if(event.pubkey!==pubkey||event.kind!==10002)continue;assertSignedEvent(event);candidates.push(event)}catch{}}
  }
  candidates.sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id));
  const latest=candidates[0]||null;
  const records=latest?relayList(latest):[];
  return {status:latest?'verified-list':'bootstrap-only',pubkey,sourceEvent:latest?.id||null,records,relays:planRelays({authorList:records,defaults:defaults.length?defaults:roots,max}),errors};
}
/** Blossom BUD-03 kind10063 server-list discovery. Validated, signed, no speculative uploads. */
export function blossomServers(event){
  if(event?.kind!==10063)throw new TypeError('Expected signed kind 10063');assertSignedEvent(event);
  const valid=[];for(const tag of event.tags){if(tag[0]!=='server')continue;try{valid.push(endpoint(tag[1],'blossom'))}catch{}}
  return [...new Set(valid)];
}
export async function discoverBlossom(pubkey,{bootstrap=[],query=queryRelay,signal,timeoutMs,Socket}={}){
  if(!/^[0-9a-f]{64}$/.test(pubkey))throw new TypeError('Pubkey required');
  const roots=endpoints(bootstrap,'relay',24);
  const obs=await Promise.allSettled(roots.map(async relay=>query(relay,{kinds:[10063],authors:[pubkey],limit:2},{signal,timeoutMs,Socket})));
  const errors=obs.flatMap((r,i)=>r.status==='rejected'||!Array.isArray(r.value)?[{relay:roots[i],error:r.status==='rejected'?String(r.reason?.message??r.reason):'Malformed relay result'}]:[]);
  const events=obs.flatMap(r=>r.status==='fulfilled'&&Array.isArray(r.value)?r.value:[]).filter(e=>e?.pubkey===pubkey&&e?.kind===10063);
  const verified=[];for(const event of events){try{verified.push({event,servers:blossomServers(event)})}catch{}}
  verified.sort((a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id));
  return {sourceEvent:verified[0]?.event.id||null,servers:verified[0]?.servers||[],verified:Boolean(verified.length),errors};
}
