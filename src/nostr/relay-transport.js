import {endpoint,endpoints} from '../core/urls.js';
import {assertSignedEvent,checkedSign} from './events.js';
import {verifiedCopy} from './history.js';
import {relayAuthTemplate} from './other-nips.js';
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
/** Exact event ACK + readback; optional explicitly authorized NIP-42 and ephemeral delivery. */
export function publishRelay(url,event,{Socket=globalThis.WebSocket,timeoutMs=10000,signal,verify=true,authSigner,authPubkey,requireAuthentication=false,acceptEphemeral=false}={}){
  url=endpoint(url);event=verify?verifiedCopy(event):structuredClone(event);
  if(!Socket)throw new Error('WebSocket transport unavailable');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new RangeError('Invalid publication timeout');
  if(authSigner!==undefined&&(!verify||typeof authSigner?.signEvent!=='function'||typeof authPubkey!=='string'||! /^[0-9a-f]{64}$/.test(authPubkey)))throw new TypeError('Explicit verified AUTH signer and identity required');
  const protectedEvent=event.tags.some(t=>t[0]==='-');
  if(protectedEvent&&(!authSigner||authPubkey!==event.pubkey))throw new Error('Protected event requires author authentication');
  if(requireAuthentication&&!authSigner)throw new Error('Authentication capability required');
  if([22242,24242,27235].includes(event.kind))throw new Error('Transport auth event is not publishable');
  const ephemeral=acceptEphemeral===true&&event.kind>=20000&&event.kind<30000;
  if(signal?.aborted)return Promise.reject(new Error('Publish cancelled'));
  return new Promise((resolve,reject)=>{
    const ws=new Socket(url);let id='read-'+event.id.slice(0,16),done=false,accepted=false,timer,phase='opening',challenge=null,authId=null,attempted=false,authenticated=false,afterAuth='event',frameCount=0,received=0;
    const abort=()=>finish(new Error('Publish cancelled'));
    const finish=err=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);try{ws.close()}catch{}if(err){err.accepted=accepted;reject(err);}else resolve({relay:url,eventId:event.id,accepted:true,readback:!ephemeral});};
    const refused=reason=>{const prefix=typeof reason==='string'?reason.split(':',1)[0]:'';const code=({'auth-required':'auth-required','rate-limited':'rate-limited','unsupported-kind':'unsupported-kind','payment-required':'payment-required','blocked':'policy','event-too-large':'size'})[prefix]??'rejected';return Object.assign(new Error('Relay refused signed event'),{code});};
    const send=message=>{if(done)return;try{ws.send(JSON.stringify(message));}catch{finish(new Error('Relay send failed'));}};
    const write=()=>{phase='event';send(['EVENT',event]);};
    const read=()=>{phase='read';send(['REQ',id,{ids:[event.id],limit:1}]);};
    const authenticate=()=>{
      if(done||phase!=='wait-auth'||!challenge)return;
      if(attempted||!authSigner)return finish(new Error('Relay authentication unavailable or refused'));
      attempted=true;phase='sign-auth';const usedChallenge=challenge;
      Promise.resolve().then(()=>{if(done)throw new Error('Cancelled');return checkedSign(authSigner,relayAuthTemplate({challenge:usedChallenge,relay:url}),authPubkey);}).then(auth=>{
        if(done)return;if(challenge!==usedChallenge)return finish(new Error('Relay AUTH challenge changed'));
        authId=auth.id;phase='auth-ack';send(['AUTH',verifiedCopy(auth)]);
      }).catch(()=>finish(new Error('Relay authentication denied or invalid')));
    };
    const needAuth=next=>{if(attempted||authenticated||!authSigner)return finish(new Error('Relay authentication unavailable or refused'));afterAuth=next;phase='wait-auth';authenticate();};
    const authRequired=reason=>typeof reason==='string'&&reason.startsWith('auth-required:');
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
    timer=setTimeout(()=>finish(Object.assign(new Error('Relay publication or authentication timeout'),{code:'timeout'})),timeoutMs);
    ws.onopen=()=>{if(done)return;if(requireAuthentication||protectedEvent)needAuth('event');else write();};
    ws.onerror=()=>finish(Object.assign(new Error('Relay WebSocket error'),{code:'network'}));
    ws.onclose=()=>{if(!done)finish(Object.assign(new Error('Relay closed before verified readback'),{code:'network'}));};
    ws.onmessage=({data})=>{
      if(done)return;if(typeof data!=='string'||++frameCount>1024||(received+=new TextEncoder().encode(data).length)>2097152)return finish(new Error('Relay response limit exceeded'));
      const m=frame(data);if(!Array.isArray(m))return;
      if(m[0]==='AUTH'&&typeof m[1]==='string'&&m[1].length>0&&m[1].length<=512){if(phase==='auth-ack'&&challenge!==m[1])return finish(new Error('Relay AUTH challenge changed'));challenge=m[1];authenticate();return;}
      if(phase==='auth-ack'&&m[0]==='OK'&&m[1]===authId){if(m[2]!==true)return finish(new Error('Relay authentication refused'));authenticated=true;if(afterAuth==='read'){id+='-auth';read();}else write();return;}
      if(phase==='event'&&m[0]==='OK'&&m[1]===event.id){if(m[2]!==true){if(authRequired(m[3]))return needAuth('event');return finish(refused(m[3]));}accepted=true;if(ephemeral)return finish();read();return;}
      if(phase==='read'&&accepted&&m[0]==='EVENT'&&m[1]===id&&m[2]?.id===event.id){try{if(verify)assertSignedEvent(m[2]);finish();}catch{finish(new Error('Readback signature invalid'));}return;}
      if(phase==='read'&&m[1]===id&&m[0]==='CLOSED'){if(authRequired(m[2]))return needAuth('read');finish(new Error('Relay readback denied'));}
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
