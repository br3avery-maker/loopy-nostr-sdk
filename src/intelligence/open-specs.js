import {verifiedCopy,eventIdentity} from '../nostr/history.js';
import {matchesFilter} from '../nostr/filter.js';
import {queryRelay} from '../nostr/relay-transport.js';
import {discoverRelays} from '../nostr/discovery.js';
import {endpoint,endpoints} from '../core/urls.js';
import {getKindSpec,NIP_KIND_REGISTRY} from './nipRegistry.js';
import {classifyEventStorage} from '../anchor/kinds.js';

export const OPEN_SPEC_KIND=30817;
// Read-only defaults, including the upstream importer relay. Never used for publishing.
export const OPEN_SPEC_READ_RELAYS=Object.freeze(['wss://relay.nmail.li','wss://relay.ditto.pub','wss://relay.dreamith.to','wss://nos.lol','wss://nostr.oxtr.dev','wss://relay.openspecs.uid.ovh']);
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const kind=x=>Number.isSafeInteger(x)&&x>=0&&x<=65535;
const own=(o,k)=>Object.hasOwn(o,k);
const value=(e,k)=>e.tags.find(t=>t[0]===k)?.[1]??'';
const all=(e,k)=>e.tags.filter(t=>t[0]===k);
const compare=(a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id);
const limit=(v,name,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new RangeError(`${name} outside ${min}..${max}`);return v;};

/** A signed proposal is evidence of authorship, not protocol authority. Exact d bytes are preserved. */
export function parseOpenSpec(input,{maxBytes=2*1024*1024}={}){
  limit(maxBytes,'maxBytes',1,8*1024*1024);
  if(input?.kind!==OPEN_SPEC_KIND||typeof input.content!=='string'||input.content.length>maxBytes||new TextEncoder().encode(input.content).length>maxBytes)throw Error('Invalid or oversized Open Specs event');
  const event=verifiedCopy(input),ds=all(event,'d'),identifier=value(event,'d');
  if(ds.length!==1||!identifier.trim())throw Error('Open Specs identifier absent or ambiguous');
  const titleTag=value(event,'title').trim(),summaryTag=value(event,'summary').trim();
  const title=titleTag||event.content.match(/^#{1,6}\s+(.+?)\s*$/m)?.[1]||identifier.replace(/[-_:.]+/g,' ').trim()||identifier;
  const kinds=all(event,'k').flatMap(t=>{const raw=(t[1]??'').trim(),name=(t[2]??'').trim()||null;if(!raw)return [];return [{raw,kind:/^\d+$/.test(raw)&&kind(Number(raw))?Number(raw):null,name}];});
  const published=Number(value(event,'published_at'));
  return {event,coordinate:eventIdentity(event),identifier,title,titleIsDerived:!titleTag,summary:summaryTag||event.content.trim().slice(0,160),summaryIsDerived:!summaryTag,kinds,topics:[...new Set(all(event,'t').map(t=>(t[1]??'').trim().toLowerCase()).filter(Boolean))],status:value(event,'s').trim()||value(event,'status').trim()||null,publishedAt:Number.isSafeInteger(published)&&published>0?published:event.created_at,withdrawn:!event.content.trim(),references:[...all(event,'a').map(t=>({type:'coordinate',value:t[1]??'',relay:t[2]??null,marker:t[3]??null})),...all(event,'i').map(t=>({type:'external',value:t[1]??'',relay:null,marker:t[2]??null}))].filter(r=>r.value),authority:'unreviewed-proposal'};
}
/** Retain history; select the latest observed revision before inspecting covered kinds or withdrawals. */
export function indexOpenSpecs(events,options={}){
  if(!Array.isArray(events))throw TypeError('Expected signed event array');
  const records=new Map(),winners=new Map(),rejected=[];
  for(let i=0;i<events.length;i++)try{
    const spec=parseOpenSpec(events[i],options);
    if(records.has(spec.event.id))continue;
    records.set(spec.event.id,spec);const prior=winners.get(spec.coordinate);
    if(!prior||compare(spec,prior)<0)winners.set(spec.coordinate,spec);
  }catch(e){rejected.push({index:i,error:String(e.message??e)});}
  return {schema:'loopy.open-specs-index/1',records:[...records.values()].sort(compare),current:[...winners.values()].sort(compare),rejected};
}
/** Rebuild from signed events rather than trusting a caller's index or remote status labels. */
export function lookupKindDefinitions(eventKind,events,{reviewedEventIds=[]}={}){
  if(!kind(eventKind))throw TypeError('Expected Nostr event kind');
  if(!Array.isArray(reviewedEventIds)||!reviewedEventIds.every(hex))throw TypeError('Review pins must be exact event IDs');
  const index=indexOpenSpecs(events),pins=new Set(reviewedEventIds);
  const proposals=index.current.filter(s=>!s.withdrawn&&s.kinds.some(k=>k.kind===eventKind)).map(s=>({...s,authority:pins.has(s.event.id)?'locally-reviewed-proposal':'unreviewed-proposal'}));
  // A locally reviewed proposal remains a proposal. No remote label or pin modifies the built-in registry.
  return {kind:eventKind,protocolStorageClass:classifyEventStorage(eventKind),builtin:{...getKindSpec(eventKind),source:own(NIP_KIND_REGISTRY,eventKind)?'anchor-bundled-reference':'generic-fallback',authority:'local-reference-not-live-standard'},proposals,reviewRequired:proposals.some(s=>s.authority==='unreviewed-proposal'),rejected:index.rejected};
}

/** Bounded relay query, with optional NIP-65 write-relay discovery and exact-coordinate recheck.
 * A finite response can establish observations, never global completeness. Search tags may be removed by later revisions.
 */
export async function queryOpenSpecs({authors=[],identifiers=[],covers=[],topics=[],relays=OPEN_SPEC_READ_RELAYS,limit:pageLimit=100,maxCoordinates=20,outbox=true,query=queryRelay,signal,timeoutMs=8000,Socket}={}){
  limit(pageLimit,'limit',1,500);limit(maxCoordinates,'maxCoordinates',1,100);
  for(const [v,name,valid] of [[authors,'authors',hex],[identifiers,'identifiers',x=>typeof x==='string'&&x.trim()],[covers,'covers',kind],[topics,'topics',x=>typeof x==='string'&&x.trim()]])if(!Array.isArray(v)||v.length>100||!v.every(valid))throw TypeError(`Invalid ${name}`);
  const roots=endpoints(relays,'relay',24);if(!roots.length)throw Error('Provide read relays');
  const requested={kinds:[OPEN_SPEC_KIND],...(authors.length?{authors:[...new Set(authors)]}:{}),...(identifiers.length?{'#d':[...new Set(identifiers)]}:{}),...(covers.length?{'#k':[...new Set(covers.map(String))]}:{}),...(topics.length?{'#t':[...new Set(topics)]}:{}),limit:pageLimit};
  const observations=[],errors=[],queries=[],rejected=[];let cancelled=false;
  const read=async(urls,filter,stage)=>{
    const results=await Promise.allSettled(urls.map(async relay=>{
      if(signal?.aborted)throw Error('Open Specs lookup cancelled');
      const response=await query(relay,structuredClone(filter),{signal,timeoutMs,Socket,maxEvents:filter.limit});
      if(signal?.aborted)throw Error('Open Specs lookup cancelled');
      if(!Array.isArray(response)||response.length>filter.limit)throw Error('Malformed/over-limit relay response');
      const valid=[];
      for(const input of response)try{const s=parseOpenSpec(input);if(!matchesFilter(s.event,filter))throw Error('Out-of-filter spec');valid.push(s.event);}catch(e){rejected.push({stage,relay,error:String(e.message??e)});}
      return {relay,valid,received:response.length};
    }));
    let ok=0;
    for(let i=0;i<results.length;i++){const r=results[i],relay=urls[i];if(r.status==='rejected'){errors.push({stage,relay,error:String(r.reason?.message??r.reason)});continue;}ok++;queries.push({stage,relay,received:r.value.received,capped:r.value.received>=filter.limit});for(const event of r.value.valid)observations.push({relay,event,stage});}
    cancelled ||= !!signal?.aborted;
    return ok;
  };
  const authorOutbox=new Map();
  const findOutbox=async(author)=>{
    if(!outbox)return [];
    if(authorOutbox.has(author))return authorOutbox.get(author);
    const p=(async()=>{try{const d=await discoverRelays(author,{bootstrap:roots,query,signal,timeoutMs,Socket,max:8});errors.push(...d.errors.map(e=>({stage:'outbox',...e})));return d.records.filter(r=>r.write).map(r=>endpoint(r.url)).slice(0,8);}catch(e){errors.push({stage:'outbox',error:String(e.message??e)});return [];}})();authorOutbox.set(author,p);return p;
  };
  let initialOK=await read(roots,requested,'search');
  // Bound author lookups. Only known authors are queried on outbox during search.
  if(!cancelled&&authors.length&&authors.length<=20&&outbox){const extra=[...new Set((await Promise.all(authors.map(findOutbox))).flat())].filter(x=>!roots.includes(x)).slice(0,16);initialOK+=await read(extra,requested,'outbox-search');}
  const candidates=indexOpenSpecs(observations.map(o=>o.event)).current;
  const selected=candidates.slice(0,maxCoordinates);const resolution=[];
  // Re-query coordinate without #k/#t, so an obsolete matching revision cannot masquerade as current.
  // A successful finite query still cannot prove no newer unseen revision exists.
  for(const s of selected){
    if(signal?.aborted){cancelled=true;break;}
    const extra=await findOutbox(s.event.pubkey),urls=[...new Set([...roots,...extra])].slice(0,32),before=errors.length,observedBefore=observations.length,queriesBefore=queries.length;
    const ok=await read(urls,{kinds:[OPEN_SPEC_KIND],authors:[s.event.pubkey],'#d':[s.identifier],limit:Math.min(pageLimit,20)},'coordinate');
    const found=observations.slice(observedBefore).some(o=>o.event.pubkey===s.event.pubkey&&value(o.event,'d')===s.identifier);
    const capped=queries.slice(queriesBefore).some(q=>q.capped);
    resolution.push({coordinate:s.coordinate,status:ok===0?'unreachable':!found?'unconfirmed':errors.length>before||capped?'partial':'observed',queries:ok});
  }
  const index=indexOpenSpecs(observations.map(o=>o.event));
  const statuses=new Map(resolution.map(r=>[r.coordinate,r.status]));
  const specs=index.current.filter(s=>statuses.has(s.coordinate)&&!s.withdrawn&&matchesFilter(s.event,requested)).map(s=>({...s,revisionStatus:statuses.get(s.coordinate)}));
  return {status:cancelled?'cancelled':initialOK===0?'unreachable':errors.length||rejected.length||queries.some(q=>q.capped)||resolution.some(r=>r.status!=='observed')||selected.length<candidates.length?'partial':specs.length?'observed':'not-observed',specs,index,observations,queries,resolution,errors,rejected,complete:false};
}
