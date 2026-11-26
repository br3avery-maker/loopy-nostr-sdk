import {prepareManifestFiles,manifestTemplate,parseManifest,nsiteAddress} from './manifest.js';
import {normalizeBlobServers} from '../blossom/replicas.js';
import {mediaType} from './files.js';
import {endpoint,endpoints} from '../core/urls.js';
import {sha256} from '../core/bytes.js';
import {eventTemplate} from '../nostr/events.js';
import {verifiedCopy} from '../nostr/history.js';
import {reviewEventReplacement} from '../nostr/edit.js';
const metadata=(event,name)=>event?.tags.find(t=>t[0]===name)?.[1]??'';
const ownTag=t=>['d','path','server','title','description'].includes(t[0])||(t[0]==='x'&&t[2]==='aggregate');
const stamp=()=>Math.floor(Date.now()/1000);
/** Internal shared path: snapshot all options and exact file bytes before asynchronous work. */
export async function preparePublication(files,{pubkey,server,relays,identifier,title,description,created_at=stamp(),baseline,approvedPlan,storageServers,requiredCopies,gateway}={}){
  if(!/^[0-9a-f]{64}$/.test(pubkey||''))throw new TypeError('Author pubkey required');
  server=endpoint(server,'blossom');relays=endpoints(relays);if(!relays.length)throw new TypeError('At least one relay required');
  const enhanced=storageServers!==undefined||requiredCopies!==undefined||gateway!==undefined;
  let storage,gatewayHost;
  if(enhanced){
    const destinations=normalizeBlobServers(storageServers??[server]);
    const primary=normalizeBlobServers([server])[0];
    if(destinations[0]!==primary)throw new Error('Primary server must be first approved storage destination');
    server=primary;
    const required=requiredCopies??1;
    if(!Number.isSafeInteger(required)||required<1||required>new Set(destinations.map(s=>new URL(s).origin)).size)throw new RangeError('Invalid storage copy threshold');
    storage={servers:destinations,required};
    if(gateway!==undefined){
      if(typeof gateway!=='string'||gateway.length>253||!gateway.includes('.')||!gateway.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))||/^[0-9.]+$/.test(gateway)||/\.(local|internal|localhost)$/.test(gateway))throw new TypeError('Invalid explicit gateway hostname');
      gatewayHost=gateway;
    }
  }
  const prior=baseline==null?null:verifiedCopy(baseline);
  identifier=identifier??(prior?.kind===35128?metadata(prior,'d'):'');
  if(typeof identifier!=='string')throw new TypeError('Invalid nsite identifier');
  const prepared=await prepareManifestFiles(files);
  let template=eventTemplate(manifestTemplate(prepared,{identifier,server,title:title??metadata(prior,'title'),description:description??metadata(prior,'description'),created_at}));
  if(enhanced)template.tags=template.tags.flatMap(t=>t[0]==='server'?storage.servers.map(s=>['server',s]):[t]);
  if(template.created_at>stamp()+300)throw new Error('Future publication timestamp');
  let before=null,review=null;
  if(prior){
    before=await parseManifest(prior);
    if(before.identifier!==identifier)throw new Error('Publication identifier differs from baseline');
    // Preserve foreign tags and content, including publication date and lineage.
    template={...template,content:prior.content,tags:[...template.tags,...prior.tags.filter(t=>!ownTag(t)&&!(t[0]==='x'&&t[1]===before.aggregate))]};
    review=reviewEventReplacement(prior,template,pubkey);
  }
  const previous=new Map((before?.files??[]).map(e=>[e.path,e.hash]));
  const next=new Map(prepared.entries.map(e=>[e.path,e.hash]));
  const changes=[];
  if(before){
    for(const [path,hash] of previous){if(!next.has(path))changes.push({path,change:'deleted',from:hash});else if(next.get(path)!==hash)changes.push({path,change:'modified',from:hash,to:next.get(path)});}
    for(const [path,hash] of next)if(!previous.has(path))changes.push({path,change:'added',to:hash});
    changes.sort((a,b)=>a.path.localeCompare(b.path));
  }
  const plan={schema:'nsite-publication-plan/1',pubkey,identifier,server,relays,baselineId:prior?.id??null,baselineStatus:prior?'observed':'unknown',aggregate:prepared.aggregate,totalBytes:prepared.totalBytes,files:prepared.entries.map(({path,hash,size})=>({path,hash,size})),template,changes,removedTags:review?.removedTags??[],addedTags:review?.addedTags??[]};
  if(enhanced){
    plan.schema='nsite-publication-plan/2';plan.storage=storage;
    plan.gateway=gatewayHost===undefined?null:nsiteAddress(pubkey,{identifier,gateway:gatewayHost});
    plan.files=plan.files.map(f=>({...f,type:mediaType(f.path).split(';')[0]}));
  }
  const id=await sha256(JSON.stringify(plan));
  if(approvedPlan!==undefined&&approvedPlan!==id)throw new Error('Publication does not match approved plan');
  return {prepared,plan:{...plan,id}};
}
/** Read-only preview: no signer, uploader, publisher or network call. */
export async function planNsitePublication(files,options={}){return (await preparePublication(files,options)).plan}
