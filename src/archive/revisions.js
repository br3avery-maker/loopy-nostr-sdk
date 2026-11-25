import {classifyEventStorage} from '../anchor/kinds.js';
import {eventIdentity,verifiedCopy} from '../nostr/history.js';
import {eventTemplate} from '../nostr/events.js';
import {encode,sha256} from '../core/bytes.js';

// Wire format from Open Specs' replaceable-event-snapshots implementation.
// A snapshot is an archivist's statement, not a new author-signed revision.
export const SNAPSHOT_KIND=1349;
const MAX_SNAPSHOT_BYTES=2*1024*1024;
function coordinate(event){
  if(!['replaceable','addressable'].includes(classifyEventStorage(event.kind)))throw Error('Not a replaceable event');
  return eventIdentity(event);
}
function bounded(text,maxBytes){if(!Number.isSafeInteger(maxBytes)||maxBytes<1||text.length>maxBytes||encode(text).length>maxBytes)throw Error('Revision byte limit exceeded');}
export function snapshotTemplate(input,{created_at=Math.floor(Date.now()/1000),maxBytes=MAX_SNAPSHOT_BYTES}={}){
  const event=verifiedCopy(input),address=coordinate(event),content=JSON.stringify(event);
  bounded(content,maxBytes);
  return eventTemplate({kind:SNAPSHOT_KIND,created_at,content,tags:[['e',event.id],['k',String(event.kind)],['p',event.pubkey],['a',address]]});
}
export function unwrapSnapshot(input,{maxBytes=MAX_SNAPSHOT_BYTES,expectedCoordinate}={}){
  if(input?.kind!==SNAPSHOT_KIND)throw Error('Not a revision snapshot');
  if(typeof input.content!=='string')throw Error('Malformed snapshot content');
  bounded(input.content,maxBytes);
  const snapshot=verifiedCopy(input),event=verifiedCopy(JSON.parse(snapshot.content)),address=coordinate(event);
  for(const [name,value] of [['e',event.id],['k',String(event.kind)],['p',event.pubkey],['a',address]]){
    const tags=snapshot.tags.filter(t=>t[0]===name);
    if(tags.length!==1||tags[0][1]!==value)throw Error('Snapshot '+name+' tag mismatch');
  }
  if(expectedCoordinate!==undefined&&address!==expectedCoordinate)throw Error('Wrong revision coordinate');
  return {event,coordinate:address,snapshotId:snapshot.id,archivist:snapshot.pubkey};
}
/** Keep exact signed wire fields in the existing CAS, without trusting the store's receipt. */
export async function archiveRevision(input,store,{maxBytes=MAX_SNAPSHOT_BYTES}={}){
  const event=verifiedCopy(input),address=coordinate(event),data=encode(JSON.stringify(event));
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||data.length>maxBytes)throw Error('Revision byte limit exceeded');
  const hash=await sha256(data),receipt=await store.put(data.slice());
  if(receipt?.hash!==hash||receipt?.size!==data.length)throw Error('Invalid revision storage receipt');
  const record={schema:'nostr-revision/1',coordinate:address,eventId:event.id,hash,size:data.length};
  await restoreRevision(record,store,{maxBytes});
  return record;
}
export async function restoreRevision(input,store,{maxBytes=MAX_SNAPSHOT_BYTES}={}){
  const record=structuredClone(input);
  if(record?.schema!=='nostr-revision/1'||typeof record.coordinate!=='string'||!(/^[a-f0-9]{64}$/).test(record.hash)||!(/^[a-f0-9]{64}$/).test(record.eventId)||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(record.size)||record.size<1||record.size>maxBytes)throw Error('Invalid revision record');
  const raw=await store.get(record.hash);
  if(!(raw instanceof Uint8Array)||raw.length!==record.size)throw Error('Missing or invalid revision bytes');
  const data=new Uint8Array(raw);
  if(await sha256(data)!==record.hash)throw Error('Corrupt revision bytes');
  const event=verifiedCopy(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));
  if(event.id!==record.eventId||coordinate(event)!==record.coordinate)throw Error('Revision identity mismatch');
  return event;
}
