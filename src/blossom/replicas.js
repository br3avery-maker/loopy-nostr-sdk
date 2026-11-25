import { endpoint } from '../core/urls.js';
import { eventTemplate } from '../nostr/events.js';
import { fetchVerified } from './client.js';

const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const mime = value => typeof value === 'string' && value.length <= 256 && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value);
function blobMeta(blob) {
  if (!blob || !hex(blob.sha256) || !Number.isSafeInteger(blob.size) || blob.size < 0 || !mime(blob.type)) throw new TypeError('Invalid blob metadata');
  return { sha256: blob.sha256, size: blob.size, type: blob.type.toLowerCase() };
}
function candidates(servers) {
  if (!Array.isArray(servers) || !servers.length || servers.length > 16) throw new RangeError('Supply 1–16 explicit Blossom destinations');
  return [...new Set(servers.map(value => {
    if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Invalid Blossom destination');
    const url = new URL(endpoint(value, 'blossom')), host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Require named, explicit HTTPS destinations; not an egress/DNS security boundary.
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(localhost|local|internal)$/.test(host)) throw new TypeError('Unsafe Blossom destination');
    url.hostname = host;
    return endpoint(url.href, 'blossom');
  }))];
}
function checkOptions(fetcher, timeoutMs) {
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError('Invalid fetch transport or timeout');
}
function cancelled(signal) { if (signal?.aborted) throw new Error('Blossom operation cancelled'); }
async function boundedRequest(url, init, {fetcher, timeoutMs, signal}) {
  cancelled(signal);
  const controller = new AbortController();
  let timer, abort;
  const deadline = new Promise((_, reject) => {
    abort = () => { controller.abort(); reject(new Error('Blossom operation cancelled')); };
    signal?.addEventListener('abort', abort, {once:true});
    timer = setTimeout(() => { controller.abort(); reject(new Error('Blossom preflight timeout')); }, timeoutMs);
  });
  try { return await Promise.race([deadline, Promise.resolve().then(() => { cancelled(signal); return fetcher(url, {...init, signal:controller.signal, redirect:'error', credentials:'omit', cache:'no-store'}); })]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}
const codes = {200:'preflight-accepted',400:'invalid',401:'auth-required',402:'payment-required',403:'policy',404:'preflight-unsupported',405:'preflight-unsupported',411:'length-required',413:'size',415:'media-type',429:'rate-limited',501:'preflight-unsupported',503:'unavailable'};
/** BUD-06 metadata-only check. No upload, auth token, payment or existence claim. */
export async function preflightBlob(blob, {servers, fetcher=globalThis.fetch, signal, timeoutMs=10000} = {}) {
  const metadata = blobMeta(blob), destinations = candidates(servers); checkOptions(fetcher, timeoutMs);
  const decisions = [];
  for (const server of destinations) {
    cancelled(signal);
    try {
      const response = await boundedRequest(server+'/upload', {method:'HEAD',headers:{'X-SHA-256':metadata.sha256,'X-Content-Length':String(metadata.size),'X-Content-Type':metadata.type}}, {fetcher,timeoutMs,signal});
      cancelled(signal);
      const status = response.status;
      decisions.push({server,status:Number.isInteger(status)?status:null,code:response.redirected?'network':(codes[status]??'unknown'),verified:false});
    } catch { cancelled(signal); decisions.push({server,status:null,code:'network',verified:false}); }
  }
  return {...metadata,decisions,selected:decisions.filter(d=>d.code==='preflight-accepted').map(d=>d.server),fallbacks:decisions.filter(d=>['preflight-unsupported','unknown'].includes(d.code)).map(d=>d.server)};
}
/** Prepare a bounded, explicitly scoped BUD-11 upload authorization for external signing. */
export function blossomBatchUploadAuth({hashes,servers,now=Math.floor(Date.now()/1000),expiresIn=600} = {}) {
  if (!Array.isArray(hashes) || !hashes.length || hashes.length > 24 || hashes.some(h=>!hex(h))) throw new TypeError('Supply 1–24 SHA-256 hashes');
  if (!Number.isSafeInteger(now) || now < 1 || !Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 600 || !Number.isSafeInteger(now+expiresIn)) throw new RangeError('Invalid authorization lifetime');
  const domains = [...new Set(candidates(servers).map(s=>new URL(s).hostname.toLowerCase()))], unique = [...new Set(hashes)];
  return eventTemplate({kind:24242,created_at:now-1,content:`Authorize upload of ${unique.length} blob(s) to ${domains.length} server domain(s)`,tags:[['t','upload'],['expiration',String(now+expiresIn)],...unique.map(h=>['x',h]),...domains.map(h=>['server',h])]});
}
function contentTypeMatches(expected, value) {
  const actual = String(value??'').split(';')[0].trim().toLowerCase();
  const js = ['text/javascript','application/javascript','application/x-javascript'];
  return actual===expected || (js.includes(expected)&&js.includes(actual));
}
/** Count actual readbacks, not uploader claims. Distinct origins, not proof of independent operators. */
export async function verifyBlobCopies(blob, {servers, required=1, fetcher=globalThis.fetch, signal, timeoutMs=15000, maxBytes=128*1024*1024}={}) {
  const metadata=blobMeta(blob), destinations=candidates(servers); checkOptions(fetcher,timeoutMs);
  if (!Number.isSafeInteger(required)||required<1||required>16 || !Number.isSafeInteger(maxBytes)||maxBytes<0||metadata.size>maxBytes||maxBytes>128*1024*1024) throw new RangeError('Invalid copy count or byte bound');
  const copies=[], failed=[], seenOrigins=new Set();
  for (const server of destinations) {
    cancelled(signal);
    const origin=new URL(server).origin;
    if(seenOrigins.has(origin)) continue;
    try {
      const r=await fetchVerified(metadata.sha256,{servers:[server],signal,timeoutMs,maxBytes:metadata.size,fetcher:async(url,init)=>{
        const response=await fetcher(url,{...init,credentials:'omit',cache:'no-store'});
        if(response.redirected||!response.ok||!contentTypeMatches(metadata.type,response.headers?.get?.('content-type'))) throw new Error('Unexpected blob response or content type');
        return response;
      }});
      cancelled(signal);
      if(r.server!==server||r.data.byteLength!==metadata.size) throw new Error('Blob byte count mismatch');
      seenOrigins.add(origin); copies.push({server,hash:metadata.sha256,size:metadata.size,type:metadata.type,verified:true});
    } catch { cancelled(signal); failed.push({server,code:'readback-unverified'}); }
  }
  return {...metadata,required,copies,failed,status:copies.length>=required?'verified':copies.length?'partial':'unverified'};
}
