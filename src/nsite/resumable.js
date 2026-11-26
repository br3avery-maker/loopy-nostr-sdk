import {parseManifest} from './manifest.js';
import {checkedSign} from '../nostr/events.js';
import {verifiedCopy,eventIdentity} from '../nostr/history.js';
import {verifiedReceipts} from '../nostr/receipts.js';
import {verifyBlobCopies} from '../blossom/replicas.js';
import {fetchVerified} from '../blossom/client.js';

const matchesTemplate=(event,plan)=>event.pubkey===plan.pubkey&&event.kind===plan.template.kind&&event.created_at===plan.template.created_at&&event.content===plan.template.content&&JSON.stringify(event.tags)===JSON.stringify(plan.template.tags);
const cancelled=signal=>{if(signal?.aborted)throw new Error('Publication cancelled');};
const baseType=v=>String(v??'').split(';')[0].trim().toLowerCase();
const jsTypes=['text/javascript','application/javascript','application/x-javascript'];
const correctType=(expected,actual)=>expected===baseType(actual)||(jsTypes.includes(expected)&&jsTypes.includes(baseType(actual)));

/** Bound the existing uploader's descriptor and body read, without changing its signing contract. */
function scopedUploadFetch(fetcher,server,entry,signal){
  return async (url,init={})=>{
    const isPut=url===server+'/upload'&&init.method==='PUT';
    if(!isPut&&!(url===server+'/'+entry.hash&&(!init.method||init.method==='GET')))throw new Error('Unexpected upload transport destination');
    cancelled(signal);
    const max=isPut?65536:entry.size,controller=new AbortController();let timer,abort,reader;
    const deadline=new Promise((_,reject)=>{
      abort=()=>{controller.abort();reject(new Error('Publication cancelled'));};
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{controller.abort();reject(new Error('Upload transport timeout'));},45000);
    });
    const read=async()=>{
      cancelled(signal);
      const response=await fetcher(url,{...init,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
      if(response.redirected)throw new Error('Upload redirect refused');
      if(!response.ok)return {ok:false,status:response.status};
      if(Number(response.headers?.get?.('content-length'))>max)throw new Error('Upload response exceeds byte bound');
      let data;
      if(response.body?.getReader){
        reader=response.body.getReader();const chunks=[];let size=0;
        for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max)throw new Error('Upload response exceeds byte bound');chunks.push(r.value);}
        data=new Uint8Array(size);let pos=0;for(const chunk of chunks){data.set(chunk,pos);pos+=chunk.byteLength;}
      }else{data=new Uint8Array(await response.arrayBuffer());if(data.length>max)throw new Error('Upload response exceeds byte bound');}
      return {ok:true,status:response.status,json:async()=>JSON.parse(new TextDecoder().decode(data)),arrayBuffer:async()=>data.buffer};
    };
    try{return await Promise.race([deadline,read()]);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();if(reader)try{void reader.cancel().catch(()=>{});}catch{}}
  };
}

/** Verify exact gateway paths with the SDK's existing bounded hash-verifying reader. */
async function checkGateway(plan,fetcher,signal){
  const controller=new AbortController(),abort=()=>controller.abort();
  const timer=setTimeout(abort,30000);signal?.addEventListener('abort',abort,{once:true});
  const files=[];const base=new URL(plan.gateway);
  try{
    for(const entry of plan.files){
      cancelled(signal);
      if(controller.signal.aborted){files.push({path:entry.path,status:'unverified'});continue;}
      // Encode every segment; a literal '%' or space in a file name cannot redirect the request.
      const url=new URL(entry.path.split('/').map(encodeURIComponent).join('/'),base).href;
      try{
        const r=await fetchVerified(entry.hash,{servers:[base.origin],maxBytes:entry.size,timeoutMs:10000,signal:controller.signal,fetcher:async(_hashURL,init)=>{
          const response=await fetcher(url,{...init,redirect:'error',credentials:'omit',cache:'no-store'});
          if(response.redirected||!response.ok||!correctType(entry.type,response.headers?.get?.('content-type')))throw new Error('Gateway response or MIME mismatch');
          return response;
        }});
        if(r.data.byteLength!==entry.size)throw new Error('Gateway size mismatch');
        files.push({path:entry.path,status:'hash-verified'});
      }catch{cancelled(signal);files.push({path:entry.path,status:'unverified'});}
    }
    return {url:plan.gateway,status:files.every(f=>f.status==='hash-verified')?'verified':'unverified',files};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

/** Version 2 orchestration, reached through the existing publishNsite API. */
export async function publishResumable(prepared,plan,{signer,allowFileRemovals,resolveCurrent,uploader,publisher,checkpoint,signal,Socket,fetcher=globalThis.fetch,resume}={}){
  cancelled(signal);
  if(typeof resolveCurrent!=='function')throw new Error('Replica publication requires a current-revision resolver');
  if(typeof signer.getPublicKey!=='function'||typeof fetcher!=='function')throw new TypeError('Replica publication requires an account check and fetch transport');
  if(plan.changes.some(c=>c.change==='deleted')&&allowFileRemovals!==true)throw new Error('Publication removes files; explicit removal approval required');
  let event=null;
  // Saved claims of uploads or relay delivery are never accepted as fresh evidence.
  if(resume!==undefined){
    if(!resume||resume.schema!=='nsite-job/2'||resume.planId!==plan.id||resume.baselineId!==plan.baselineId||resume.aggregate!==plan.aggregate)throw new Error('Resume checkpoint does not match approved publication plan');
    if(resume.event!==undefined&&resume.event!==null){event=verifiedCopy(resume.event);if(!matchesTemplate(event,plan))throw new Error('Resume manifest differs from approved publication plan');}
    if(resume.eventId!=null&&resume.eventId!==event?.id)throw new Error('Resume event ID mismatch');
  }
  const job={schema:'nsite-job/2',identifier:plan.identifier,aggregate:plan.aggregate,planId:plan.id,baselineId:plan.baselineId,files:[],relays:[],stage:'prepared',event,eventId:event?.id??null,gateway:null};
  const save=async()=>{await checkpoint(structuredClone(job));cancelled(signal);};
  const identity=async()=>{cancelled(signal);if(await signer.getPublicKey()!==plan.pubkey)throw new Error('Signer account does not match publication');cancelled(signal);};
  const checkCurrent=async()=>{
    await identity();
    const current=await resolveCurrent({pubkey:plan.pubkey,kind:plan.template.kind,identifier:plan.identifier,relays:[...plan.relays],signal});
    await identity();
    if(current===null){if(plan.baselineId!==null)throw new Error('Publication baseline missing; prepare a new preview');return;}
    const observed=verifiedCopy(current);
    if(eventIdentity(observed)!==`${plan.template.kind}:${plan.pubkey}:${plan.identifier}`||!(observed.id===plan.baselineId||observed.id===event?.id))throw new Error('Publication baseline changed; prepare a new preview');
  };
  // A new or resumed job must observe the approved baseline or the exact saved signed revision.
  await checkCurrent();await save();
  try{
    const types=new Map(plan.files.map(f=>[f.path,f.type]));
    for(const entry of prepared.entries){
      await identity();
      const metadata={sha256:entry.hash,size:entry.size,type:types.get(entry.path)};
      const check=servers=>verifyBlobCopies(metadata,{servers,required:1,fetcher,signal});
      const prior=await check([...plan.storage.servers]);
      const copies=new Map(prior.copies.map(c=>[new URL(c.server).origin,c]));
      const row={path:entry.path,hash:entry.hash,size:entry.size,type:metadata.type,copies:[...copies.values()],attempts:[]};
      job.files.push(row);job.stage='uploading';await save();
      for(const server of plan.storage.servers){
        if(copies.size>=plan.storage.required)break;
        const origin=new URL(server).origin;if(copies.has(origin))continue;
        await identity();
        try{
          const result=await uploader(new Uint8Array(entry.bytes),{server,signer,pubkey:plan.pubkey,path:entry.path,signal,fetcher:scopedUploadFetch(fetcher,server,entry,signal)});
          if(!result?.verified||result.hash!==entry.hash)throw new Error('Unverified upload');
          await identity();
          const observed=await check([server]);
          for(const copy of observed.copies)copies.set(new URL(copy.server).origin,copy);
          row.attempts.push({server,status:observed.copies.length?'hash-verified':'unverified'});
        }catch{cancelled(signal);await identity();row.attempts.push({server,status:'failed'});}
        row.copies=[...copies.values()];await save();
      }
      if(copies.size<plan.storage.required)throw new Error('Insufficient independently verified storage copies: '+entry.path);
    }
    await checkCurrent();
    if(!event){event=verifiedCopy(await checkedSign(signer,plan.template,plan.pubkey));await identity();}
    const manifest=await parseManifest(event);
    job.stage='signed';job.event=event;job.eventId=event.id;await save();
    await checkCurrent();
    const receipts=await publisher(structuredClone(event),[...plan.relays],{signal,Socket});
    job.relays=verifiedReceipts(receipts,event.id,plan.relays);
    if(!job.relays.length)throw new Error('No signed nsite manifest was independently read back');
    job.url=plan.gateway??manifest.url;job.stage='relay-verified';await save();
    if(plan.gateway){
      await identity();job.gateway=await checkGateway(plan,fetcher,signal);
      job.stage=job.gateway.status==='verified'?'site-verified':'gateway-unverified';await save();
    }
    return {job,event,manifest,receipts:{...receipts,verified:job.relays}};
  }catch(error){
    // Preserve a recoverable, sanitized last checkpoint on errors; no auth tokens or bytes.
    const failure=new Error(String(error?.message??error),{cause:error});failure.job=structuredClone(job);throw failure;
  }
}
