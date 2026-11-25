import {bytes,sha256} from '../core/bytes.js';
import {memoryStore} from '../storage/memory.js';
/** Dedupes payload by SHA-256 while allowing several logical file/ZIP versions to refer to one object. */
export function contentStore(storage=memoryStore()){
  const get=async hash=>{const data=await storage.get('blob:'+hash);if(!data)return null;const value=Uint8Array.from(data);if(await sha256(value)!==hash)throw new Error('Corrupt stored object');return value};
  return {
    async put(data){const value=new Uint8Array(bytes(data)),hash=await sha256(value);let valid=false;try{valid=Boolean(await get(hash));}catch{}if(!valid)await storage.set('blob:'+hash,Array.from(value));return {hash,size:value.length}},
    get,
    async verify(hash){const b=await this.get(hash);return Boolean(b)},
    async saveManifest(id,manifest){await storage.set('manifest:'+id,manifest)},
    async loadManifest(id){return storage.get('manifest:'+id)},
    keys:()=>storage.keys()
  };
}
