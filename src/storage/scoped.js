/** Stateless key-prefixing wrapper so multiple bricks share any StorageAdapter without collisions. */
export function scopedStore(adapter, namespace) {
  if (
    !adapter ||
    typeof adapter.get !== 'function' ||
    typeof adapter.set !== 'function' ||
    typeof adapter.delete !== 'function' ||
    typeof adapter.keys !== 'function'
  ) {
    throw new TypeError('StorageAdapter with get, set, delete, and keys methods required');
  }
  if (typeof namespace !== 'string' || !namespace.length || namespace.length > 128 || /[\u0000:]/.test(namespace)) {
    throw new TypeError('Namespace must be a 1–128 character string without ":" or control characters');
  }
  const prefix = namespace + ':';
  const qualify = key => {
    if (typeof key !== 'string' || !key.length) throw new TypeError('Storage key must be a non-empty string');
    return prefix + key;
  };
  return {
    get: key => adapter.get(qualify(key)),
    set: (key, value) => adapter.set(qualify(key), value),
    delete: key => adapter.delete(qualify(key)),
    async keys(filterPrefix = '') {
      const sub = typeof filterPrefix === 'string' ? filterPrefix : String(filterPrefix ?? '');
      const full = prefix + sub;
      const all = await adapter.keys(full);
      return (Array.isArray(all) ? all : [])
        .filter(k => typeof k === 'string' && k.startsWith(full))
        .map(k => k.slice(prefix.length));
    },
  };
}
