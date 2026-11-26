import { encode, decode, toBase64Url, fromBase64Url } from '../core/bytes.js';

const U8_MARKER = '__loopy_u8__';

function serializeValue(value) {
  return JSON.stringify(value, (_k, v) =>
    v instanceof Uint8Array ? { [U8_MARKER]: toBase64Url(v) } : v
  );
}

function deserializeValue(raw) {
  return JSON.parse(raw, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === U8_MARKER && typeof v[U8_MARKER] === 'string') {
        return fromBase64Url(v[U8_MARKER]);
      }
    }
    return v;
  });
}

/**
 * Node.js filesystem StorageAdapter using atomic temp-file + rename writes and
 * traversal-safe base64url key encoding. Node built-ins are loaded lazily on first
 * invocation so browser/edge bundles remain 100% Node-free when fsStore is unused.
 */
export function fsStore(directory) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new TypeError('fsStore requires a non-empty directory path');
  }
  let modsPromise = null;
  let closed = false;

  const loadMods = () => {
    if (closed) throw new Error('fsStore is closed');
    if (!modsPromise) {
      modsPromise = Promise.all([import('node:fs/promises'), import('node:path')]).then(([fs, path]) => ({
        fs,
        path,
        root: path.resolve(directory),
      }));
    }
    return modsPromise;
  };

  const assertKey = key => {
    if (typeof key !== 'string' || !key.length) throw new TypeError('Storage key must be a non-empty string');
  };

  const keyFile = (path, root, key) => {
    const encoded = toBase64Url(encode(key));
    return path.join(root, `${encoded}.json`);
  };

  return {
    async get(key) {
      assertKey(key);
      const { fs, path, root } = await loadMods();
      try {
        const raw = await fs.readFile(keyFile(path, root, key), 'utf8');
        return deserializeValue(raw);
      } catch (err) {
        if (err?.code === 'ENOENT') return undefined;
        throw err;
      }
    },

    async set(key, value) {
      assertKey(key);
      const { fs, path, root } = await loadMods();
      await fs.mkdir(root, { recursive: true });
      const target = keyFile(path, root, key);
      const payload = serializeValue(value);
      const tmp = path.join(
        root,
        `.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.json`
      );
      try {
        await fs.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tmp, target);
      } catch (err) {
        try {
          await fs.unlink(tmp);
        } catch {}
        throw err;
      }
    },

    async delete(key) {
      assertKey(key);
      const { fs, path, root } = await loadMods();
      try {
        await fs.unlink(keyFile(path, root, key));
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    },

    async keys(prefix = '') {
      const { fs, root } = await loadMods();
      const filter = typeof prefix === 'string' ? prefix : String(prefix ?? '');
      let entries;
      try {
        entries = await fs.readdir(root);
      } catch (err) {
        if (err?.code === 'ENOENT') return [];
        throw err;
      }
      const out = [];
      for (const name of entries) {
        if (!name.endsWith('.json') || name.startsWith('.tmp-')) continue;
        try {
          const decoded = decode(fromBase64Url(name.slice(0, -5)));
          if (!filter || decoded.startsWith(filter)) out.push(decoded);
        } catch {}
      }
      return out.sort();
    },

    async close() {
      closed = true;
    },
  };
}
