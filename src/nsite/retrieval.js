import { endpoint, endpoints, nsitePath, slug } from '../core/urls.js';
import { sha256 } from '../core/bytes.js';
import { isHex } from '../core/guards.js';
import { defaultFetch } from '../core/http.js';
import { verifiedCopy } from '../nostr/history.js';
import { discoverRelays, discoverBlossom } from '../nostr/discovery.js';
import { queryRelay } from '../nostr/relay-transport.js';
import { fetchVerified } from '../blossom/client.js';
import { parseManifest, NSITE_NAMED_KIND, NSITE_ROOT_KIND } from './manifest.js';
import { mediaType } from './files.js';

const newer = (a, b) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
const aborted = signal => {
  if (signal?.aborted) throw new Error('Nsite retrieval cancelled');
};
const message = e => String(e?.message ?? e);

// Serialize same-key cache commits within this JS realm; no new database.
const cacheWrites = new WeakMap();
async function commitCache(storage, key, fn) {
  let keys = cacheWrites.get(storage);
  if (!keys) {
    keys = new Map();
    cacheWrites.set(storage, keys);
  }
  const prior = keys.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(fn);
  keys.set(key, next);
  try {
    return await next;
  } finally {
    if (keys.get(key) === next) keys.delete(key);
  }
}

/** Resolve an exact coordinate, with optional caller-owned signed-event cache. */
export async function resolveNsiteManifest(
  pubkey,
  {
    identifier = '',
    bootstrap = [],
    relays = [],
    storage,
    mode = 'cache-first',
    ttlSeconds = 60,
    now = Math.floor(Date.now() / 1000),
    query = queryRelay,
    signal,
    timeoutMs = 8000,
    Socket,
  } = {}
) {
  if (!isHex(pubkey, 64)) throw new TypeError('Valid author pubkey required');
  if (identifier) slug(identifier);
  if (!['cache-first', 'refresh', 'offline'].includes(mode)) throw new TypeError('Invalid cache mode');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 0) {
    throw new RangeError('Invalid cache time');
  }
  aborted(signal);
  const kind = identifier ? NSITE_NAMED_KIND : NSITE_ROOT_KIND;
  const key = `nsite-manifest:${kind}:${pubkey}:${identifier}`;
  const errors = [];
  const matches = e => e.pubkey === pubkey && e.kind === kind && (!identifier || e.tags.find(t => t[0] === 'd')?.[1] === identifier);
  const validate = async input => {
    const event = verifiedCopy(input);
    if (!matches(event)) throw new Error('Wrong manifest coordinate');
    return { event, manifest: await parseManifest(event, { now }) };
  };
  let cached = null;
  let checkedAt = null;
  if (storage) {
    try {
      const record = await storage.get(key);
      if (record !== undefined && record !== null) {
        if (!Number.isSafeInteger(record.checkedAt) || record.checkedAt < 0 || record.checkedAt > now) {
          throw new Error('Invalid cached observation time');
        }
        cached = await validate(record.event);
        checkedAt = record.checkedAt;
      }
    } catch (e) {
      errors.push({ stage: 'cache', error: message(e) });
    }
  }
  const result = (status, value = null, observedAt = null, queriedRelays = []) => ({
    status,
    event: value?.event ?? null,
    manifest: value?.manifest ?? null,
    checkedAt: observedAt,
    queriedRelays,
    errors,
  });
  aborted(signal);
  if (mode === 'offline') return result(cached ? 'stale' : 'unreachable', cached, checkedAt);
  if (mode === 'cache-first' && cached && now - checkedAt < ttlSeconds) return result('cached', cached, checkedAt);

  const roots = endpoints(bootstrap, 'relay', 24);
  const hints = endpoints(relays, 'relay', 24);
  let authorRelays = [];
  let outboxResolved = false;
  const failedOutboxRelays = new Set();
  if (roots.length) {
    try {
      const discovery = await discoverRelays(pubkey, { bootstrap: roots, query, signal, timeoutMs, Socket, max: 24, now });
      authorRelays = discovery.records.filter(x => x.write).map(x => x.url);
      outboxResolved = discovery.sourceEvent !== null || discovery.errors.length === 0;
      for (const err of discovery.errors) {
        if (err?.relay) failedOutboxRelays.add(err.relay);
      }
      errors.push(...discovery.errors.map(x => ({ ...x, stage: 'outbox' })));
    } catch (e) {
      aborted(signal);
      errors.push({ stage: 'outbox', error: message(e) });
    }
  }
  aborted(signal);
  const fallbackRoots = outboxResolved && authorRelays.length
    ? roots.filter(r => !failedOutboxRelays.has(r))
    : roots;
  const allTargets = [...new Set([...authorRelays, ...hints, ...fallbackRoots])];
  const targets = allTargets.slice(0, 24);
  if (allTargets.length > targets.length) errors.push({ stage: 'manifest', error: 'Relay selection truncated to 24 endpoints' });
  const filter = { kinds: [kind], authors: [pubkey], ...(identifier ? { '#d': [identifier] } : {}), limit: 20 };
  const reads = await Promise.allSettled(targets.map(async url => query(url, structuredClone(filter), { signal, timeoutMs, Socket, maxEvents: 20 })));
  aborted(signal);
  const events = new Map();
  let successful = 0;
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i];
    if (r.status === 'rejected' || !Array.isArray(r.value)) {
      errors.push({
        stage: 'manifest',
        relay: targets[i],
        error: r.status === 'rejected' ? message(r.reason) : 'Malformed query result',
      });
      continue;
    }
    successful++;
    for (const input of r.value) {
      try {
        const e = verifiedCopy(input);
        if (!matches(e)) throw new Error('Wrong manifest coordinate');
        events.set(e.id, e);
      } catch (e) {
        errors.push({ stage: 'manifest', relay: targets[i], error: message(e) });
      }
    }
  }
  // Include the newest signed candidate even if its manifest is malformed; never silently downgrade it.
  const best = [...events.values()].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  if (!best) {
    const hasManifestError = errors.some(x => x.stage === 'manifest');
    const hasUnresolvedOutboxError = roots.length > 0 && !outboxResolved && errors.some(x => x.stage === 'outbox');
    const fatalError = hasManifestError || hasUnresolvedOutboxError;
    return cached
      ? result('stale', cached, checkedAt, targets)
      : result(successful && !fatalError ? 'not-found' : 'unreachable', null, null, targets);
  }
  if (cached && newer(cached.event, best)) return result('stale', cached, checkedAt, targets);
  let value;
  try {
    value = await validate(best);
  } catch (e) {
    errors.push({ stage: 'manifest', error: message(e) });
    return result('invalid', null, null, targets);
  }
  if (storage) {
    try {
      const preserved = await commitCache(storage, key, async () => {
        aborted(signal);
        const current = await storage.get(key);
        if (current?.event && Number.isSafeInteger(current.checkedAt) && current.checkedAt >= 0) {
          let prior;
          try {
            prior = await validate(current.event);
          } catch {}
          if (prior && (newer(prior.event, value.event) || (prior.event.id === value.event.id && current.checkedAt > now))) {
            return result('stale', prior, current.checkedAt, targets);
          }
        }
        aborted(signal);
        await storage.set(key, { event: value.event, checkedAt: now });
        return null;
      });
      if (preserved) return preserved;
    } catch (e) {
      aborted(signal);
      errors.push({ stage: 'cache', error: message(e) });
    }
  }
  aborted(signal);
  return result('resolved', value, now, targets);
}

/** Resolve a validated manifest's exact path, directory index, or explicit 404. */
export function resolveManifestPath(manifest, requestPath) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/') || requestPath.startsWith('//')) {
    throw new TypeError('Absolute site path required');
  }
  const root = requestPath === '/';
  const directory = requestPath.endsWith('/');
  const path = root ? '/' : nsitePath(directory ? requestPath.slice(0, -1) : requestPath);
  const files = new Map(manifest.files.map(f => [nsitePath(f.path), f.hash]));
  const find = (p, status) => (files.has(p) ? { path: p, hash: files.get(p), status } : null);
  return (!directory && find(path, 200)) || find((root ? '' : path) + '/index.html', 200) || find('/404.html', 404) || null;
}

/** Read a site file as verified bytes, not executable HTML; CAS is optional. */
export async function loadNsiteFile(
  input,
  path,
  {
    now = Math.floor(Date.now() / 1000),
    store,
    servers = [],
    relays = [],
    query = queryRelay,
    fetcher = defaultFetch,
    signal,
    timeoutMs = 15000,
    maxBytes = 128 * 1024 * 1024,
    Socket,
  } = {}
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid Blossom retrieval limits');
  aborted(signal);
  const event = verifiedCopy(input);
  const manifest = await parseManifest(event, { now });
  const match = resolveManifestPath(manifest, path);
  const errors = [];
  if (!match) return null;
  const output = (source, data, server = null) => ({
    ...match,
    mediaType: mediaType(match.path),
    manifest,
    eventId: event.id,
    source,
    data,
    server,
    errors,
  });
  if (store) {
    try {
      const data = await store.get(match.hash);
      aborted(signal);
      if (data !== null && data !== undefined) {
        if (!(data instanceof Uint8Array) || data.length > maxBytes) throw new Error('Corrupt or oversized cached content');
        const snapshot = new Uint8Array(data);
        if ((await sha256(snapshot)) !== match.hash) throw new Error('Corrupt or oversized cached content');
        aborted(signal);
        return output('cache', snapshot);
      }
    } catch (e) {
      aborted(signal);
      errors.push({ stage: 'cache', error: message(e) });
    }
  }
  const valid = values => {
    const out = [];
    for (const v of values) {
      try {
        const url = endpoint(v, 'blossom');
        if (!out.includes(url)) out.push(url);
      } catch (e) {
        errors.push({ stage: 'blossom', error: message(e) });
      }
    }
    return out;
  };
  // Reserve room for caller-explicit servers so a manifest with >16 server tags cannot crowd them out.
  const manifestServers = valid(event.tags.filter(t => t[0] === 'server').map(t => t[1])).slice(0, 16);
  const callerServers = valid(servers);
  const initial = [...new Set([...manifestServers, ...callerServers])].slice(0, 32);
  let fetched;
  const attempt = async targets => {
    if (!targets.length) return null;
    try {
      const r = await fetchVerified(match.hash, { servers: targets, fetcher, signal, timeoutMs, maxBytes });
      errors.push(...r.failed.map(x => ({ ...x, stage: 'blossom' })));
      return r;
    } catch (e) {
      aborted(signal);
      errors.push({ stage: 'blossom', error: message(e) });
      return null;
    }
  };
  fetched = await attempt(initial);
  if (!fetched && relays.length) {
    const discovery = await discoverBlossom(event.pubkey, { bootstrap: relays, query, signal, timeoutMs, Socket, now });
    aborted(signal);
    errors.push(...discovery.errors.map(x => ({ ...x, stage: 'blossom-discovery' })));
    fetched = await attempt(valid(discovery.servers).filter(x => !initial.includes(x)).slice(0, 32));
  }
  if (!fetched) throw new AggregateError(errors.map(x => new Error(x.error)), 'No verified nsite file available');
  if (store) {
    try {
      await store.put(new Uint8Array(fetched.data));
    } catch (e) {
      errors.push({ stage: 'cache', error: message(e) });
    }
  }
  aborted(signal);
  return output('blossom', fetched.data, fetched.server);
}
