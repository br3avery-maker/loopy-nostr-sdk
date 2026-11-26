/** Browser-only IndexedDB storage with the same asynchronous interface as memoryStore. */
export function indexedDbStore({ name = 'nsite-loopy', store = 'records', indexedDBProvider = globalThis.indexedDB } = {}) {
  if (!indexedDBProvider || typeof indexedDBProvider.open !== 'function') {
    throw new Error('IndexedDB not available in this host');
  }
  if (typeof name !== 'string' || !name.length || typeof store !== 'string' || !store.length) {
    throw new TypeError('IndexedDB database and store names must be non-empty strings');
  }

  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDBProvider.open(name, 1);
      } catch (err) {
        dbPromise = null;
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(store)) {
          req.result.createObjectStore(store);
        }
      };
      req.onsuccess = () => {
        const database = req.result;
        database.onversionchange = () => {
          try { database.close?.(); } catch {}
          dbPromise = null;
        };
        database.onclose = () => {
          dbPromise = null;
        };
        resolve(database);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('IndexedDB open failed'));
      };
    });
    return dbPromise;
  };

  const access = (method, key, value) =>
    open().then(
      database =>
        new Promise((resolve, reject) => {
          const txn = database.transaction(store, method === 'get' || method === 'getAllKeys' ? 'readonly' : 'readwrite');
          const obj = txn.objectStore(store);
          const req =
            method === 'put'
              ? obj.put(value, key)
              : method === 'getAllKeys'
                ? obj.getAllKeys()
                : obj[method](key);
          let result;
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
          txn.oncomplete = () => resolve(result);
          txn.onabort = () => reject(txn.error ?? new Error('IndexedDB transaction aborted'));
          txn.onerror = () => reject(txn.error ?? new Error('IndexedDB transaction failed'));
        })
    );

  return {
    get: k => access('get', k),
    set: async (k, v) => {
      await access('put', k, v);
    },
    delete: async k => {
      await access('delete', k);
    },
    keys: async (prefix = '') => {
      const filter = typeof prefix === 'string' ? prefix : String(prefix ?? '');
      const all = await access('getAllKeys');
      const list = Array.isArray(all) ? all : [];
      return filter ? list.filter(k => typeof k === 'string' && k.startsWith(filter)) : list;
    },
    async close() {
      const pending = dbPromise;
      dbPromise = null;
      if (!pending) return;
      try {
        const database = await pending;
        database?.close?.();
      } catch {}
    },
  };
}
