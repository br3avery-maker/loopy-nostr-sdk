import { isHex } from './guards.js';

function prefixStorage(storage, prefix) {
  const fullPrefix = `acct:${prefix}:`;
  return {
    get: async key => storage.get(fullPrefix + String(key)),
    set: async (key, value) => storage.set(fullPrefix + String(key), value),
    delete: async key => storage.delete(fullPrefix + String(key)),
    keys: async (filterPrefix = '') => {
      const sub = typeof filterPrefix === 'string' ? filterPrefix : String(filterPrefix ?? '');
      const full = fullPrefix + sub;
      const all = await storage.keys(full);
      return (Array.isArray(all) ? all : [])
        .filter(k => typeof k === 'string' && k.startsWith(full))
        .map(k => k.slice(fullPrefix.length));
    },
  };
}

/**
 * Stateless factory for an account-scoped cancellation + storage + cleanup boundary.
 * When closed or invalidated (e.g. account switch / logout), aborts its signal and runs
 * registered cleanups in LIFO order so stale in-flight work cannot write into a new account.
 */
export function createAccountSession({ pubkey, storage, onInvalidate } = {}) {
  if (pubkey !== undefined && !isHex(pubkey, 64)) {
    throw new TypeError('64-character lowercase hex pubkey required when provided');
  }
  if (
    storage !== undefined &&
    (!storage ||
      typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' ||
      typeof storage.delete !== 'function' ||
      typeof storage.keys !== 'function')
  ) {
    throw new TypeError('Valid StorageAdapter required when provided');
  }
  if (onInvalidate !== undefined && typeof onInvalidate !== 'function') {
    throw new TypeError('onInvalidate must be a function');
  }

  const controller = new AbortController();
  const cleanups = [];
  let closed = false;
  let invalidationReason = null;

  const scopedStorage = storage ? (pubkey ? prefixStorage(storage, pubkey) : storage) : null;

  const assertActive = () => {
    if (closed || controller.signal.aborted) {
      throw new Error(invalidationReason ? `Account session invalidated: ${invalidationReason}` : 'Account session closed');
    }
  };

  const register = cleanup => {
    if (typeof cleanup !== 'function') throw new TypeError('Cleanup callback must be a function');
    if (closed) {
      Promise.resolve()
        .then(() => cleanup())
        .catch(() => {});
      return () => {};
    }
    cleanups.push(cleanup);
    return () => {
      const idx = cleanups.indexOf(cleanup);
      if (idx >= 0) cleanups.splice(idx, 1);
    };
  };

  const close = async (reason = null) => {
    if (closed) return;
    closed = true;
    invalidationReason = reason == null ? null : String(reason);
    controller.abort(invalidationReason ? new Error(invalidationReason) : undefined);
    const pending = cleanups.splice(0, cleanups.length).reverse();
    const errors = [];
    for (const fn of pending) {
      try {
        await fn();
      } catch (err) {
        errors.push(err);
      }
    }
    if (onInvalidate) {
      try {
        await onInvalidate({ pubkey: pubkey ?? null, reason: invalidationReason });
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'One or more session cleanups failed');
  };

  return {
    pubkey: pubkey ?? null,
    signal: controller.signal,
    storage: scopedStorage,
    get aborted() {
      return closed || controller.signal.aborted;
    },
    get closed() {
      return closed;
    },
    get reason() {
      return invalidationReason;
    },
    assertActive,
    register,
    invalidate: reason => close(reason ?? 'invalidated'),
    close: () => close(null),
  };
}
