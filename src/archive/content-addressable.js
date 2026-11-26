import { bytes, sha256 } from '../core/bytes.js';
import { isHex } from '../core/guards.js';
import { memoryStore } from '../storage/memory.js';

/** Dedupes payload by SHA-256 while allowing several logical file/ZIP versions to refer to one object. */
export function contentStore(storage = memoryStore()) {
  const get = async hash => {
    if (!isHex(hash, 64)) throw new TypeError('SHA-256 hash required');
    const data = await storage.get('blob:' + hash);
    if (data === null || data === undefined) return null;
    const value = data instanceof Uint8Array ? new Uint8Array(data) : Uint8Array.from(data);
    if ((await sha256(value)) !== hash) throw new Error('Corrupt stored object');
    return value;
  };
  return {
    async put(data) {
      const value = new Uint8Array(bytes(data));
      const hash = await sha256(value);
      let valid = false;
      try { valid = Boolean(await get(hash)); } catch {}
      if (!valid) await storage.set('blob:' + hash, value);
      return { hash, size: value.length };
    },
    get,
    async verify(hash) {
      const b = await this.get(hash);
      return Boolean(b);
    },
    async saveManifest(id, manifest) {
      await storage.set('manifest:' + id, manifest);
    },
    async loadManifest(id) {
      return storage.get('manifest:' + id);
    },
    keys: () => storage.keys(),
  };
}
