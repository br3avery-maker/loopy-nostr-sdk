import {endpoint,endpoints} from '../core/urls.js';
import {assertSignedEvent} from './events.js';
import {isVerifiedReceipt} from './receipts.js';
import {matchesFilter} from './filter.js';
function frame(raw){try {return JSON.parse(typeof raw==='string'?raw:String(raw));} catch{return null;}}
/** Finite NIP-01 REQ, EOSE and EVENT handling; no fake empty results after connection failure. */
export function queryRelay(url,filter,{Socket=globalThis.WebSocket,timeoutMs=8000,signal,verify=true,maxEvents=500}={}){
  url=endpoint(url);
  if(!Socket)throw new Error('WebSocket transport unavailable');
  if(!filter||typeof filter!=='object'||Array.isArray(filter))throw new TypeError('Expected one Nostr filter object');
  filter=structuredClone(filter);
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1)throw new RangeError('maxEvents must be a positive integer');
  if(Object.hasOwn(filter,'limit')&&(!Number.isSafeInteger(filter.limit)||filter.limit<0))throw new RangeError('Filter limit must be a nonnegative integer');
  const cap=Math.min(maxEvents,filter.limit??maxEvents);
  return new Promise((resolve,reject)=>{
    const ws=new Socket(url),id='loop-'+Math.random().toString(36).slice(2),events=new Map();let done=false,open=false,timer;
    const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{ws.close()}catch{}};
    const finish=(err)=>{if(done)return;done=true;clean();err?reject(err):resolve([...events.values()])};
    const abort=()=>finish(new Error('Relay query cancelled'));
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new Error('Relay EOSE timeout')),timeoutMs);
    ws.onopen=()=>{open=true;ws.send(JSON.stringify(['REQ',id,filter]))};
    ws.onerror=()=>finish(new Error('Relay WebSocket error'));
    ws.onclose=()=>{if(!done)finish(new Error(open?'Relay closed before EOSE':'Relay failed to connect'))};
    ws.onmessage=({data})=>{const m=frame(data);if(!Array.isArray(m)||m[1]!==id)return;
      if(m[0]==='EVENT') {try{const e=verify?assertSignedEvent(m[2]):m[2];if(cap>0&&e?.id&&matchesFilter(e,filter))events.set(e.id,e)}catch{}if(cap>0&&events.size>=cap)finish();}
      else if(m[0]==='EOSE')finish();else if(m[0]==='CLOSED')finish(new Error('Relay subscription rejected'));
    };
  });
}
/** Publish exact event and verify relay OK plus subsequent exact-ID REQ readback. */
export function publishRelay(url,event,{Socket=globalThis.WebSocket,timeoutMs=10000,signal,verify=true}={}){
  url=endpoint(url);if(verify)assertSignedEvent(event);if(!Socket)throw new Error('WebSocket transport unavailable');
  return new Promise((resolve,reject)=>{
    const ws=new Socket(url),id='read-'+event.id.slice(0,16);let done=false,accepted=false,timer;
    const abort=()=>finish(new Error('Publish cancelled'));
    const finish=e=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);try{ws.close()}catch{}e?reject(e):resolve({relay:url,eventId:event.id,accepted:true,readback:true})};
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new Error(accepted?'Relay OK received, readback timed out':'Relay OK timeout')),timeoutMs);
    ws.onopen=()=>ws.send(JSON.stringify(['EVENT',event]));
    ws.onerror=()=>finish(new Error('Relay WebSocket error'));
    ws.onclose=()=>{if(!done)finish(new Error('Relay closed before verified readback'))};
    ws.onmessage=({data})=>{const m=frame(data);if(!Array.isArray(m))return;
      if(m[0]==='OK'&&m[1]===event.id){if(m[2]!==true)return finish(new Error('Relay refused signed event'));if(!accepted){accepted=true;ws.send(JSON.stringify(['REQ',id,{ids:[event.id],limit:1}]))}}
      else if(accepted&&m[0]==='EVENT'&&m[1]===id&&m[2]?.id===event.id){try{if(verify)assertSignedEvent(m[2]);finish()}catch{finish(new Error('Readback signature invalid'))}}
      else if(m[0]==='CLOSED'&&m[1]===id)finish(new Error('Relay readback denied'));
    };
  });
}
/** Include per-relay failures; acceptance on one relay does not imply delivery to all. */
export async function publishMany(event,relays,{writer=publishRelay,...options}={}){
  const destinations=endpoints(relays),snapshot=structuredClone(event);assertSignedEvent(snapshot);
  const results=await Promise.allSettled(destinations.map(async relay=>writer(relay,structuredClone(snapshot),options)));
  const ok=[],fail=[];for(let i=0;i<results.length;i++){const relay=destinations[i],r=results[i];if(r.status==='fulfilled'&&isVerifiedReceipt(r.value,snapshot.id,relay))ok.push({relay,eventId:snapshot.id,accepted:true,readback:true});else fail.push({relay,error:r.status==='rejected'?(r.reason?.message||String(r.reason)):'Missing explicit acknowledgment or exact-event readback'})}
  return {status:ok.length?'partially-verified':'unverified',verified:ok,failed:fail};
}
