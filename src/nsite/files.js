import {nsitePath} from '../core/urls.js';
import {bytes,sha256} from '../core/bytes.js';
export function mediaType(path){
  const ext=path.split('.').pop()?.toLowerCase();
  return ({html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',woff2:'font/woff2',wasm:'application/wasm',webmanifest:'application/manifest+json',txt:'text/plain; charset=utf-8',md:'text/markdown; charset=utf-8'})[ext]||'application/octet-stream';
}
export function normalizeFileMap(input){const out=Object.create(null);for(const [name,data] of Object.entries(input)){const path=nsitePath(name).slice(1);if(Object.hasOwn(out,path))throw new Error('Repeated file path');out[path]=bytes(data)}return out;}
export async function compareFiles(before,after){
  const a=normalizeFileMap(before),b=normalizeFileMap(after),changes=[];
  for(const path of new Set([...Object.keys(a),...Object.keys(b)])){
    if(!a[path])changes.push({path,change:'added',to:await sha256(b[path])});
    else if(!b[path])changes.push({path,change:'deleted',from:await sha256(a[path])});
    else {const x=await sha256(a[path]),y=await sha256(b[path]);if(x!==y)changes.push({path,change:'modified',from:x,to:y})}
  }
  return changes.sort((x,y)=>x.path.localeCompare(y.path));
}
