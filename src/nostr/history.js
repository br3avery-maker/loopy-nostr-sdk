import {classifyEventStorage} from '../anchor/kinds.js';
import {endpoint} from '../core/urls.js';
import {assertSignedEvent,eventTemplate} from './events.js';

// Immutable wire fields, not transport metadata or vendor verification symbols.
export function verifiedCopy(input){
  if(!input||!Number.isSafeInteger(input.kind)||!Number.isSafeInteger(input.created_at)||typeof input.content!=='string'||!Array.isArray(input.tags))throw new TypeError('Malformed signed event');
  const event={...eventTemplate({kind:input.kind,created_at:input.created_at,content:input.content,tags:structuredClone(input.tags)}),id:input.id,pubkey:input.pubkey,sig:input.sig};
  if(!/^[0-9a-f]{64}$/.test(event.id)||!/^[0-9a-f]{64}$/.test(event.pubkey)||!/^[0-9a-f]{128}$/.test(event.sig))throw new Error('Noncanonical event hex');
  assertSignedEvent(event);return event;
}
function identity(event){
  const storage=classifyEventStorage(event.kind);
  if(storage==='addressable')return `${event.kind}:${event.pubkey}:${event.tags.find(t=>t[0]==='d')?.[1]??''}`;
  if(storage==='replaceable')return `${event.kind}:${event.pubkey}:`;
  return event.id;
}
/** Identity of a verified signed event. Keep exact d tag bytes, including colons and whitespace. */
export function eventIdentity(event){return identity(verifiedCopy(event));}
/** Rebuild a revision/provenance view from exact signed sightings. Ephemeral events are not archived. */
export function collectEventObservations(observations){
  if(!Array.isArray(observations))throw new TypeError('Expected observations array');
  const records=new Map(), winners=new Map(), rejected=[];
  for(let i=0;i<observations.length;i++){
    try{
      const {event:input,relay:raw,seenAt}=observations[i];
      const event=verifiedCopy(input),relay=endpoint(raw);
      if(!Number.isSafeInteger(seenAt)||seenAt<0)throw new TypeError('seenAt must be epoch seconds');
      if(classifyEventStorage(event.kind)==='ephemeral')throw new Error('Ephemeral events are excluded from history');
      let record=records.get(event.id);
      if(!record){record={event,identity:identity(event),relays:new Map()};records.set(event.id,record);}
      const previous=record.relays.get(relay);
      record.relays.set(relay,{relay,firstSeenAt:Math.min(previous?.firstSeenAt??seenAt,seenAt),lastSeenAt:Math.max(previous?.lastSeenAt??seenAt,seenAt)});
      const current=winners.get(record.identity);
      if(!current||event.created_at>current.created_at||(event.created_at===current.created_at&&event.id<current.id))winners.set(record.identity,event);
    }catch(error){rejected.push({index:i,error:String(error?.message??error)});}
  }
  return {records:[...records.values()].map(r=>({...r,relays:[...r.relays.values()].sort((a,b)=>a.relay.localeCompare(b.relay))})).sort((a,b)=>a.event.id.localeCompare(b.event.id)),current:[...winners.values()].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)),rejected};
}
