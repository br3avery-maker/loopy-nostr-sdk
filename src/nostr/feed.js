import {eventTemplate,checkedSign,assertSignedEvent} from './events.js';
import {publishMany,queryRelay} from './relay-transport.js';
import {verifiedReceipts} from './receipts.js';
import {verifiedCopy} from './history.js';
import {endpoints} from '../core/urls.js';
/** Kind 1 text note. Reply carries both parent event and author's pubkey. */
export function textNote(content,{replyTo,created_at=Math.floor(Date.now()/1000)}={}){
  if(typeof content!=='string'||content.length>16000)throw new TypeError('Text note must be a string <= 16k characters');
  const tags=replyTo?[['e',replyTo.id,'','reply'],...(replyTo.pubkey?[['p',replyTo.pubkey]]:[])]:[];
  return eventTemplate({kind:1,content,tags,created_at});
}
export function reaction(target,emoji='+',{created_at=Math.floor(Date.now()/1000)}={}){
  if(!target?.id||!/^[0-9a-f]{64}$/.test(target.id)||!/^[0-9a-f]{64}$/.test(target.pubkey))throw new TypeError('Signed target event id and pubkey required');
  return eventTemplate({kind:7,content:String(emoji),tags:[['e',target.id],['p',target.pubkey]],created_at});
}
export async function publishTemplate(template,{signer,pubkey,relays,publisher=publishMany}={}){
  if(!signer||!/^[0-9a-f]{64}$/.test(pubkey||''))throw new Error('Approved signer and author required');
  const destinations=endpoints(relays,'relay',16);if(!destinations.length)throw new Error('At least one relay required');
  const signed=verifiedCopy(await checkedSign(signer,template,pubkey));
  const receipts=await publisher(structuredClone(signed),[...destinations]);
  const verified=verifiedReceipts(receipts,signed.id,destinations);
  if(!verified.length)throw new Error('No verified relay readback for signed note');
  return {event:signed,receipts:{...receipts,verified}};
}
export async function fetchFeed({authors=[],kinds=[1,7],relays=[],limit=100,query=queryRelay}={}){
  if(!authors.length)throw new Error('Provide at least one author pubkey');
  const filter={authors,kinds,limit:Math.min(500,Math.max(1,limit))};
  const urls=endpoints(relays,'relay',24);const seen=new Map(),fail=[];
  const results=await Promise.allSettled(urls.map(url=>query(url,filter)));
  for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='rejected'){fail.push({relay:urls[i],error:String(r.reason?.message||r.reason)});continue}for(const event of r.value){try{assertSignedEvent(event);if(authors.includes(event.pubkey)&&kinds.includes(event.kind))seen.set(event.id,event)}catch{}}}
  return {events:[...seen.values()].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,limit),failed:fail,status:results.some(r=>r.status==='fulfilled')?'queried':'unreachable'};
}
