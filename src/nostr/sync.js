import {endpoints} from '../core/urls.js';
import {verifiedCopy} from './history.js';
import {classifyEventStorage} from '../core/guards.js';
import {matchesFilter} from './filter.js';
import {queryRelay} from './relay-transport.js';
const isTime=x=>Number.isSafeInteger(x)&&x>=0;
function integer(value,name,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`${name} must be between ${min} and ${max}`);return value;}
function normalizeFilter(filter){
  if(!filter||typeof filter!=='object'||Array.isArray(filter))throw new TypeError('Expected a filter');
  const out={};
  for(const key of Object.keys(filter).sort()){
    const value=filter[key];
    if(key==='since'||key==='until'){if(!isTime(value))throw new TypeError(`Invalid ${key}`);out[key]=value;continue;}
    if(!['ids','authors','kinds'].includes(key)&&!/^#[a-zA-Z]$/.test(key))throw new TypeError(`Unsupported history filter: ${key}`);
    if(!Array.isArray(value)||!value.length||!value.every(v=>key==='kinds'?Number.isSafeInteger(v)&&v>=0&&v<=65535:typeof v==='string'&&(!['ids','authors'].includes(key)||/^[0-9a-f]{64}$/.test(v))))throw new TypeError(`Invalid ${key}`);
    out[key]=[...new Set(value)].sort();
  }
  if(!out.kinds||out.kinds.some(k=>classifyEventStorage(k)==='ephemeral'))throw new TypeError('History requires explicit non-ephemeral event kinds');
  if((out.since??0)>(out.until??Infinity))throw new RangeError('Inverted time window');
  return out;
}
function validateCursor(cursor,relay,scope,base){
  if(!cursor)return {relay,scope,watermark:null,window:null};
  const c=structuredClone(cursor);
  if(c.relay!==relay||c.scope!==scope||!(c.watermark===null||isTime(c.watermark))||!(c.window===null||c.window&&['since','until','nextUntil'].every(k=>isTime(c.window[k]))&&(c.window.newestAt===null||isTime(c.window.newestAt))&&c.window.since<=c.window.nextUntil&&c.window.nextUntil<=c.window.until&&(c.window.newestAt===null||c.window.newestAt<=c.window.until)))throw new Error('Invalid or mismatched history cursor');
  if(c.watermark!==null&&(c.watermark<(base.since??0)||c.watermark>(base.until??Infinity)))throw new Error('Watermark outside filter');
  if(c.window&&(c.window.since!==Math.max(base.since??0,c.watermark??0)||c.window.until>(base.until??Infinity)))throw new Error('Cursor window outside filter');
  return c;
}
/** Bounded per-relay historical queries. Store returned observations before committing cursors. */
export async function syncEventHistory({relays=[],filter={},cursors={},pageSize=100,boundaryLimit=500,maxPages=8,now=Math.floor(Date.now()/1000),query=queryRelay,signal,timeoutMs=8000,Socket}={}){
  integer(pageSize,'pageSize',1,1000);integer(boundaryLimit,'boundaryLimit',pageSize+1,5000);integer(maxPages,'maxPages',1,100);integer(now,'now',0,Number.MAX_SAFE_INTEGER);
  const urls=endpoints(relays,'relay',16);if(!urls.length)throw new Error('Provide at least one relay');
  const base=normalizeFilter(filter),scope=JSON.stringify(base);
  // Validate before opening any socket. Cursors from different relays/filters cannot be reused.
  const initial=urls.map(relay=>validateCursor(cursors[relay],relay,scope,base));
  const results=await Promise.all(urls.map(async(relay,index)=>{
    const cursor=initial[index],seen=new Map();let pages=0,status='partial',error=null;
    const currentUntil=Math.min(base.until??now,now);
    if(!cursor.window){
      const since=Math.max(base.since??0,cursor.watermark??0);
      if(currentUntil<since)return {relay,cursor,observations:[],pages,status:'not-yet-in-window',error};
      cursor.window={since,until:currentUntil,nextUntil:currentUntil,newestAt:cursor.watermark};
    }
    const w=cursor.window;
    const read=async(since,until,limit)=>{
      if(signal?.aborted)throw new Error('History sync cancelled');
      const f={...base,since,until,limit};
      const response=await query(relay,f,{signal,timeoutMs,maxEvents:limit,...(Socket?{Socket}:{})});
      if(signal?.aborted)throw new Error('History sync cancelled');
      if(!Array.isArray(response)||response.length>limit)throw new Error('Malformed or over-limit relay page');
      const unique=new Map();let prior=Infinity;
      for(const input of response){
        const e=verifiedCopy(input);
        if(!matchesFilter(e,f))throw new Error('Out-of-filter relay response');
        if(e.created_at>prior)throw new Error('Relay page not in descending timestamp order');prior=e.created_at;
        unique.set(e.id,e);
      }
      for(const e of unique.values()){
        seen.set(e.id,{relay,event:e,seenAt:now});
        w.newestAt=Math.max(w.newestAt??0,e.created_at);
      }
      return [...unique.values()];
    };
    const complete=()=>{cursor.watermark=w.newestAt!==null&&w.newestAt>=w.since?w.newestAt:cursor.watermark;cursor.window=null;status='window-read';};
    try{
      for(;pages<maxPages;){
        pages++;
        const page=await read(w.since,w.nextUntil,pageSize);
        if(!page.length){complete();break;}
        const oldest=page.at(-1).created_at;
        const boundary=await read(oldest,oldest,boundaryLimit);
        const ids=new Set(boundary.map(e=>e.id)),known=page.filter(e=>e.created_at===oldest);
        // A full boundary, missing previously seen IDs, or an apparently hidden
        // cap at the previously observed page size is ambiguous. Never step past it.
        if(boundary.length>=boundaryLimit||known.some(e=>!ids.has(e.id))||(page.length>1&&boundary.length===page.length)){
          status='boundary-stalled';break;
        }
        if(oldest===w.since){complete();break;}
        w.nextUntil=oldest-1;
      }
    }catch(e){status=signal?.aborted?'cancelled':'failed';error=String(e?.message??e);}
    return {relay,cursor,observations:[...seen.values()],pages,status,error};
  }));
  return {observations:results.flatMap(r=>r.observations),cursors:{...cursors,...Object.fromEntries(results.map(r=>[r.relay,r.cursor]))},relays:results.map(({relay,pages,status,error})=>({relay,pages,status,error}))};
}
