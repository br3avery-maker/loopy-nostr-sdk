/** Portable public-only account recovery & publication receipts, adapted from Nostr Anchor. */
import {assertSignedEvent} from '../nostr/events.js';
import {normalizePubkey} from '../moderation/identity.js';

const KEYS=['mode','pubkey','npub','label','connectedAt','connectionDetail','bunkerRelays','remoteSignerPubkey','androidSignerPackage','rememberedPermissions'];
const SECRET_KEYS=new Set(['nsec','secret','privateKey','private_key','bunkerUri','bunkerSecret','connectionSecret','clientSecret','password','passphrase','token','authorization','accessToken','refreshToken']);
function stripSecrets(value,depth=0){if(depth>12)throw Error('Backup nested too deeply');if(Array.isArray(value))return value.slice(0,10000).map(x=>stripSecrets(x,depth+1));if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value).slice(0,5000)){if(SECRET_KEYS.has(k)||/secret|private.?key|(?:auth|refresh|access).*token|passphrase|password|bunker.?uri/i.test(k))continue;out[k]=stripSecrets(v,depth+1)}return out}return value}
export function sanitizePublicSession(session){if(!session)return null;const out={};for(const key of KEYS)if(session[key]!==undefined)out[key]=stripSecrets(session[key]);const pubkey=normalizePubkey(out.pubkey);if(!pubkey)throw TypeError('Public session requires valid pubkey');out.pubkey=pubkey;if(!['nip07','nip46','nip55','read-only','ephemeral-test'].includes(out.mode))out.mode='read-only';if(out.mode==='ephemeral-test')out.mode='read-only';if(typeof out.connectionDetail==='string'&&/bunker:\/\/|nostrconnect:\/\/|nsec1/i.test(out.connectionDetail))delete out.connectionDetail;return out}
export function buildPublicAccountBackup(state,{now=Math.floor(Date.now()/1000)}={}){
 if(!state?.session)throw TypeError('Public session is required');const session=sanitizePublicSession(state.session);
 const rows={profile:state.profile||{},relays:state.relays||[],blossomServers:state.blossomServers||[],follows:state.follows||[],publications:state.publications||[],preferences:state.preferences||{}};
 return {schema:'nsite-loopy-public-backup/1',exportedAt:now,containsSecrets:false,account:session,records:stripSecrets(rows)};
}
/** Restore only checked published events, never active signer privileges. */
export function restorePublicAccountBackup(input){const backup=typeof input==='string'?JSON.parse(input):input;if(!backup||backup.schema!=='nsite-loopy-public-backup/1'||backup.containsSecrets!==false)throw Error('Invalid public backup schema');const session=sanitizePublicSession(backup.account);const rec=stripSecrets(backup.records||{});const verified=[],rejected=[];
 for(const item of (Array.isArray(rec.publications)?rec.publications:[]).slice(0,10000)){
  if(!item?.currentEvent){rejected.push({reason:'missing signed event'});continue}
  try{assertSignedEvent(item.currentEvent);if(item.currentEvent.pubkey!==session.pubkey)throw Error('author mismatch');verified.push(item)}catch(e){rejected.push({reason:e.message})}
 }
 return {session:{...session,mode:'read-only',needsSignerReconnect:true},profile:rec.profile||{},relays:rec.relays||[],blossomServers:rec.blossomServers||[],follows:rec.follows||[],publications:verified,rejectedPublications:rejected,signerConnected:false};
}
export function summarizePublicationReceipts(receipts=[]){
 const list=Array.isArray(receipts)?receipts:(receipts?.relays||receipts?.verified||[]);const output=[];
 for(const r of list){const accepted=r.accepted===true||r.acknowledged===true,readback=r.readback===true||r.independentlyRetrieved===true;
 output.push({relay:String(r.relay||''),stage:readback&&accepted?'retrieved':accepted?'acknowledged':r.stage==='failed'?'failed':'unverified',accepted,readback})}
 return {total:output.length,accepted:output.filter(x=>x.accepted).length,retrieved:output.filter(x=>x.readback&&x.accepted).length,verified:output.some(x=>x.readback&&x.accepted),receipts:output};
}
/** Export signed-event URL references only: not proof of blob availability, MIME, or content hash. */
export function extractEventAssets(event){
 assertSignedEvent(event);const refs=new Set();
 const add=value=>{if(typeof value!=='string')return;try{const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)refs.add(u.href)}catch{}};
 for(const t of event.tags){
  if(t[0]==='imeta')for(const v of t.slice(1))if(v.startsWith('url '))add(v.slice(4));
  if(event.kind===1063&&t[0]==='url')add(t[1]);
  if([31337,32123,36787].includes(event.kind)&&['url','image'].includes(t[0]))add(t[1]);
 }
 // Anchor's content-addressed inline URL pattern; no fetch or claim of verification.
 for(const match of event.content.matchAll(/https:\/\/[^\s"'<>()]+?\/[0-9a-f]{64}(?:\.[a-zA-Z0-9]{2,5})?(?=$|[\s"'<>()?#])/gi))add(match[0]);
 return [...refs];
}
export * from './kinds.js';
export * from './relays.js';
