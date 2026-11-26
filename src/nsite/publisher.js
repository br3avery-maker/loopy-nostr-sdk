import {parseManifest} from './manifest.js';
import {publishResumable} from './resumable.js';
import {preparePublication} from './plan.js';
import {checkedSign} from '../nostr/events.js';
import {eventIdentity,verifiedCopy} from '../nostr/history.js';
import {uploadVerified} from '../blossom/client.js';
import {verifiedReceipts} from '../nostr/receipts.js';
import {publishMany} from '../nostr/relay-transport.js';
/** Fully verified NIP-5A pipeline. No user credentials: signer injected and explicit. */
export async function publishNsite(files,{signer,pubkey,server,relays,identifier,title,description,created_at,baseline,approvedPlan,allowFileRemovals=false,resolveCurrent,uploader=uploadVerified,publisher=publishMany,checkpoint=async()=>{},signal,Socket,fetcher,storageServers,requiredCopies,gateway,resume}={}){
  if(!signer||typeof signer.signEvent!=='function'||!/^[0-9a-f]{64}$/.test(pubkey||''))throw new TypeError('Approved signer and author pubkey required');
  const cancelled=()=>{if(signal?.aborted)throw new Error('Cancelled')};cancelled();
  if(baseline!=null&&!approvedPlan)throw new Error('A replacement requires an approved publication plan');
  // Approval is an explicit digest of the preview, including its exact timestamp.
  const {prepared,plan}=await preparePublication(files,{pubkey,server,relays,identifier,title,description,created_at,baseline,approvedPlan,storageServers,requiredCopies,gateway});
  if(resume!==undefined&&plan.schema!=='nsite-publication-plan/2')throw new Error('Resume requires a version 2 publication plan');
  if(plan.schema==='nsite-publication-plan/2'){
    if(!approvedPlan)throw new Error('Replica publication requires an approved publication plan');
    return publishResumable(prepared,plan,{signer,allowFileRemovals,resolveCurrent,uploader,publisher,checkpoint,signal,Socket,fetcher,resume});
  }
  identifier=plan.identifier;
  if(plan.changes.some(c=>c.change==='deleted')&&allowFileRemovals!==true)throw new Error('Publication removes files; explicit removal approval required');
  if(typeof signer.getPublicKey==='function'&&await signer.getPublicKey()!==pubkey)throw new Error('Signer account does not match publication');
  const checkCurrent=async()=>{
    cancelled();if(!resolveCurrent)return;
    const current=await resolveCurrent({pubkey,kind:plan.template.kind,identifier,relays:[...plan.relays],signal});
    cancelled();
    if(current!==null){const event=verifiedCopy(current);const expected=`${plan.template.kind}:${pubkey}:${identifier}`;if(eventIdentity(event)!==expected||event.id!==plan.baselineId)throw new Error('Publication baseline changed; prepare a new preview');}
    else if(plan.baselineId!==null)throw new Error('Publication baseline missing; prepare a new preview');
  };
  await checkCurrent();
  const job={schema:'nsite-job/1',identifier,aggregate:prepared.aggregate,files:[],relays:[],stage:'prepared',planId:plan.id,baselineId:plan.baselineId};
  await checkpoint(structuredClone(job));
  for(const entry of prepared.entries){cancelled();const result=await uploader(new Uint8Array(entry.bytes),{server:plan.server,signer,pubkey,path:entry.path,signal,fetcher});if(!result?.verified||result.hash!==entry.hash)throw new Error('Unverified Blossom upload '+entry.path);job.files.push({path:entry.path,hash:entry.hash,size:entry.size});job.stage='uploading';await checkpoint(structuredClone(job));}
  await checkCurrent();cancelled();
  const event=verifiedCopy(await checkedSign(signer,plan.template,pubkey));
  const parsed=await parseManifest(event);cancelled();
  job.stage='signed';job.eventId=event.id;await checkpoint(structuredClone(job));await checkCurrent();cancelled();
  const receipts=await publisher(structuredClone(event),[...plan.relays],{signal,Socket});
  job.relays=verifiedReceipts(receipts,event.id,plan.relays);
  if(!job.relays.length)throw new Error('No signed nsite manifest was independently read back');
  job.url=parsed.url;job.stage='relay-verified';await checkpoint(structuredClone(job));
  return {job,event,manifest:parsed,receipts:{...receipts,verified:job.relays}};
}
