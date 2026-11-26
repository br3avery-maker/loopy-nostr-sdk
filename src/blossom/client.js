import {endpoint} from '../core/urls.js';
import {bytes,sha256,toBase64Url,encode} from '../core/bytes.js';
import {eventTemplate,checkedSign} from '../nostr/events.js';
import {mediaType} from '../nsite/files.js';
export function blossomAuthHeader(signedEvent){return 'Nostr '+toBase64Url(encode(JSON.stringify(signedEvent)))}
export function blossomUploadAuth({hash,server,expiresIn=600,now=Math.floor(Date.now()/1000)}={}){
  if(!/^[0-9a-f]{64}$/.test(hash))throw new TypeError('SHA-256 hash required');
  return eventTemplate({kind:24242,created_at:now,tags:[['t','upload'],['expiration',String(now+expiresIn)],['server',new URL(endpoint(server,'blossom')).hostname],['x',hash]],content:'Upload nsite asset '+hash.slice(0,16)});
}
/** Real BUD-11 upload + descriptor + exact-byte readback; signer stays external. */
export async function uploadVerified(data,{server,signer,pubkey,path='file',fetcher=globalThis.fetch,signal,clock}={}){
  if(!fetcher)throw new Error('fetch transport required');
  const body=new Uint8Array(bytes(data)),hash=await sha256(body),base=endpoint(server,'blossom');
  const unsigned=blossomUploadAuth({hash,server:base,now:clock?.()??Math.floor(Date.now()/1000)});
  const event=await checkedSign(signer,unsigned,pubkey);
  const response=await fetcher(base+'/upload',{method:'PUT',headers:{Authorization:blossomAuthHeader(event),'Content-Type':mediaType(path),'X-SHA-256':hash},body,signal});
  if(!response.ok)throw new Error('Blossom upload HTTP '+response.status);
  const descriptor=await response.json();
  if(descriptor.sha256!==hash||descriptor.size!==body.length)throw new Error('Blossom descriptor mismatch');
  const remote=await fetcher(base+'/'+hash,{cache:'no-store',signal});
  if(!remote.ok||await sha256(new Uint8Array(await remote.arrayBuffer()))!==hash)throw new Error('Blossom download integrity mismatch');
  return {hash,size:body.length,server:base,verified:true,url:base+'/'+hash};
}
/** Bounded fallback across public HTTPS endpoints; verify all returned bytes. */
export async function fetchVerified(hash,{servers=[],fetcher=globalThis.fetch,signal,timeoutMs=15000,maxBytes=128*1024*1024}={}){
  if(!/^[a-f0-9]{64}$/.test(hash))throw new TypeError('Hash required');
  if(!Array.isArray(servers)||servers.length>32)throw new RangeError('Maximum 32 Blossom endpoints');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('Invalid Blossom retrieval limits');
  if(typeof fetcher!=='function')throw new TypeError('Fetch transport required');
  const failures=[],seen=new Set();
  for(const input of servers){
    if(signal?.aborted)throw new Error('Blossom retrieval cancelled');
    let server=String(input),timer,abort,reader;
    const controller=new AbortController();
    try{
      server=endpoint(input,'blossom');if(seen.has(server))continue;seen.add(server);
      const deadline=new Promise((_,reject)=>{
        abort=()=>{controller.abort();reject(new Error('Blossom retrieval cancelled'));};
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>{controller.abort();reject(new Error('Blossom retrieval timeout'));},timeoutMs);
      });
      const read=async()=>{
        const response=await fetcher(server+'/'+hash,{signal:controller.signal,redirect:'error'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const length=response.headers?.get?.('content-length');
        if(length!==null&&length!==undefined&&Number(length)>maxBytes)throw new Error('Blossom byte limit exceeded');
        let data;
        if(response.body?.getReader){
          reader=response.body.getReader();const chunks=[];let size=0;
          for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>maxBytes)throw new Error('Blossom byte limit exceeded');chunks.push(r.value);}
          data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
        }else{data=new Uint8Array(await response.arrayBuffer());if(data.byteLength>maxBytes)throw new Error('Blossom byte limit exceeded');}
        if(await sha256(data)!==hash)throw new Error('Content hash mismatch');
        return data;
      };
      const data=await Promise.race([deadline,read()]);
      if(signal?.aborted)throw new Error('Blossom retrieval cancelled');
      return {server,data,hash,failed:failures.map(e=>({error:e.message}))};
    }catch(e){if(signal?.aborted)throw new Error('Blossom retrieval cancelled');failures.push(new Error(`${server}: ${e?.message??e}`));}
    finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);controller.abort();if(reader)try{void reader.cancel().catch(()=>{});}catch{}}
  }
  if(signal?.aborted)throw new Error('Blossom retrieval cancelled');
  throw new AggregateError(failures,'No Blossom copy passed SHA-256');
}
