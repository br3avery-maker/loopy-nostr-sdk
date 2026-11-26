import { finalizeEvent, generateSecretKey, getPublicKey } from '../../vendor/nostr.js';
import { sha256, bytes, encode, decode, toBase64Url, fromBase64Url } from '../core/bytes.js';
import { endpoint } from '../core/urls.js';
import { isHex } from '../core/guards.js';
import { verifiedCopy } from '../nostr/history.js';
import { matchesFilter } from '../nostr/filter.js';

/**
 * Deterministic test-only symmetric envelope for exercising NIP-44 / NIP-59 flows offline.
 * NOT cryptographic encryption — for unit and integration tests only.
 */
function createTestCipher(selfPubkey) {
  const pairKey = peer => [selfPubkey, peer].sort().join(':');
  return {
    encrypt: async (peer, plaintext) => {
      if (!isHex(peer, 64)) throw new TypeError('Valid 64-hex peer pubkey required');
      const payload = JSON.stringify({ k: pairKey(peer), p: String(plaintext) });
      return 'test-nip44:' + toBase64Url(encode(payload));
    },
    decrypt: async (peer, ciphertext) => {
      if (!isHex(peer, 64)) throw new TypeError('Valid 64-hex peer pubkey required');
      if (typeof ciphertext !== 'string' || !ciphertext.startsWith('test-nip44:')) {
        throw new Error('Invalid test-nip44 ciphertext');
      }
      const parsed = JSON.parse(decode(fromBase64Url(ciphertext.slice('test-nip44:'.length))));
      if (parsed.k !== pairKey(peer)) throw new Error('Test cipher key pair mismatch');
      return parsed.p;
    },
  };
}

/**
 * In-memory Nostr test signer implementing NIP-07-like `getPublicKey`, `signEvent`, and test `nip44`.
 */
export function createTestSigner({ secretKey = generateSecretKey(), includeNip44 = true } = {}) {
  if (!(secretKey instanceof Uint8Array) || secretKey.byteLength !== 32) {
    throw new TypeError('secretKey must be a 32-byte Uint8Array');
  }
  const pubkey = getPublicKey(secretKey);
  const signedEvents = [];
  let closed = false;

  const signer = {
    mode: 'test',
    pubkey,
    secretKey,
    signedEvents,
    getPublicKey: async () => {
      if (closed) throw new Error('Test signer closed');
      return pubkey;
    },
    signEvent: async template => {
      if (closed) throw new Error('Test signer closed');
      const signed = verifiedCopy(finalizeEvent(template, secretKey));
      signedEvents.push(signed);
      return signed;
    },
    close: async () => {
      closed = true;
    },
  };
  if (includeNip44) signer.nip44 = createTestCipher(pubkey);
  return signer;
}

/**
 * In-memory NIP-01 + NIP-42 mock WebSocket relay harness compatible with
 * `queryRelay`, `publishRelay`, `subscribeRelay`, and `createRelayPool`.
 */
export function createMockRelay({
  url = 'wss://mock-relay.example',
  requireAuth = false,
  challenge = 'mock-challenge',
  initialEvents = [],
  onEvent,
  onReq,
} = {}) {
  const canonicalUrl = endpoint(url);
  const events = new Map();
  for (const ev of initialEvents) {
    const v = verifiedCopy(ev);
    events.set(v.id, v);
  }
  const sentFrames = [];
  const connections = [];

  class MockRelaySocket {
    constructor(targetUrl) {
      this.url = targetUrl;
      this.readyState = 0;
      this._listeners = new Map();
      this._subs = new Map();
      this._authed = false;
      connections.push(this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this._emit('open', {});
        if (requireAuth) this._deliver(['AUTH', challenge]);
      });
    }

    addEventListener(type, fn) {
      let set = this._listeners.get(type);
      if (!set) {
        set = new Set();
        this._listeners.set(type, set);
      }
      set.add(fn);
    }

    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }

    _emit(type, payload) {
      const propHandler = this['on' + type];
      if (typeof propHandler === 'function') propHandler(payload);
      const set = this._listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn(payload);
    }

    _deliver(frame) {
      if (this.readyState !== 1) return;
      queueMicrotask(() => {
        if (this.readyState !== 1) return;
        this._emit('message', { data: JSON.stringify(frame) });
      });
    }

    send(raw) {
      if (this.readyState !== 1) return;
      const frame = JSON.parse(String(raw));
      sentFrames.push({ url: this.url, frame });
      const [verb] = frame;

      if (verb === 'AUTH') {
        const authEvent = frame[1];
        try {
          const verified = verifiedCopy(authEvent);
          const hasChallenge = verified.tags.some(t => t[0] === 'challenge' && t[1] === challenge);
          if (verified.kind === 22242 && hasChallenge) {
            this._authed = true;
            this._deliver(['OK', verified.id, true, '']);
            return;
          }
        } catch {}
        this._deliver(['OK', authEvent?.id ?? '', false, 'restricted: invalid auth']);
        return;
      }

      if (verb === 'EVENT') {
        const event = frame[1];
        if (requireAuth && !this._authed) {
          this._deliver(['OK', event?.id ?? '', false, 'auth-required: authenticate first']);
          return;
        }
        try {
          const verified = verifiedCopy(event);
          if (onEvent) {
            const custom = onEvent(verified, this);
            if (custom && custom.accepted === false) {
              this._deliver(['OK', verified.id, false, custom.message ?? 'blocked: rejected']);
              return;
            }
          }
          events.set(verified.id, verified);
          this._deliver(['OK', verified.id, true, '']);
          // Fan out to matching live subscriptions across open connections.
          for (const conn of connections) {
            if (conn.readyState !== 1) continue;
            for (const [subId, filters] of conn._subs) {
              if (filters.some(f => matchesFilter(verified, f))) {
                conn._deliver(['EVENT', subId, verified]);
              }
            }
          }
        } catch (err) {
          this._deliver(['OK', event?.id ?? '', false, `invalid: ${err?.message ?? 'bad event'}`]);
        }
        return;
      }

      if (verb === 'REQ') {
        const subId = frame[1];
        const filters = frame.slice(2);
        if (requireAuth && !this._authed) {
          this._deliver(['CLOSED', subId, 'auth-required: authenticate first']);
          return;
        }
        this._subs.set(subId, filters);
        if (onReq) onReq(subId, filters, this);
        const matched = [];
        for (const ev of events.values()) {
          if (filters.some(f => matchesFilter(ev, f))) matched.push(ev);
        }
        matched.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
        const limit = filters.length === 1 && Number.isInteger(filters[0]?.limit) ? filters[0].limit : matched.length;
        for (const ev of matched.slice(0, limit)) {
          this._deliver(['EVENT', subId, ev]);
        }
        this._deliver(['EOSE', subId]);
        return;
      }

      if (verb === 'CLOSE') {
        this._subs.delete(frame[1]);
      }
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this._subs.clear();
      this._emit('close', {});
    }
  }

  return {
    url: canonicalUrl,
    Socket: MockRelaySocket,
    events,
    sentFrames,
    connections,
    pushEvent(event) {
      const verified = verifiedCopy(event);
      events.set(verified.id, verified);
      for (const conn of connections) {
        if (conn.readyState !== 1) continue;
        for (const [subId, filters] of conn._subs) {
          if (filters.some(f => matchesFilter(verified, f))) {
            conn._deliver(['EVENT', subId, verified]);
          }
        }
      }
      return verified;
    },
    reset() {
      events.clear();
      sentFrames.length = 0;
      for (const conn of connections) conn.close();
      connections.length = 0;
    },
  };
}

/**
 * In-memory Blossom server mock (`HEAD /upload`, `PUT /upload`, `GET /<sha256>`)
 * supporting strict verification tests without network access.
 */
export function createMockBlossom({
  servers = ['https://mock-blossom.example'],
  preflightStatus = 200,
  requireAuth = false,
} = {}) {
  const allowed = new Set(servers.map(s => endpoint(s, 'blossom')));
  const store = new Map(); // key: `${origin}/${hash}` -> { bytes, type, size }
  const requests = [];

  async function seed(server, data, contentType = 'application/octet-stream') {
    const base = endpoint(server, 'blossom');
    const raw = new Uint8Array(bytes(data));
    const hash = await sha256(raw);
    store.set(`${base}/${hash}`, { bytes: raw, type: contentType, size: raw.byteLength });
    return { hash, size: raw.byteLength, url: `${base}/${hash}`, type: contentType };
  }

  async function fetcher(url, init = {}) {
    const parsed = new URL(url);
    const base = endpoint(parsed.origin, 'blossom');
    const method = (init.method || 'GET').toUpperCase();
    requests.push({ method, url: String(url), headers: init.headers ?? {} });

    if (!allowed.has(base)) {
      return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
    }

    if (method === 'HEAD' && parsed.pathname === '/upload') {
      return {
        ok: preflightStatus >= 200 && preflightStatus < 300,
        status: preflightStatus,
        headers: new Headers(),
      };
    }

    if (method === 'PUT' && parsed.pathname === '/upload') {
      const headers = new Headers(init.headers ?? {});
      if (requireAuth && !String(headers.get('authorization') || '').startsWith('Nostr ')) {
        return { ok: false, status: 401, headers: new Headers(), json: async () => ({ error: 'auth required' }) };
      }
      const raw = new Uint8Array(bytes(init.body ?? new Uint8Array(0)));
      const hash = await sha256(raw);
      const type = headers.get('content-type') || 'application/octet-stream';
      store.set(`${base}/${hash}`, { bytes: raw, type, size: raw.byteLength });
      const descriptor = { sha256: hash, size: raw.byteLength, type, url: `${base}/${hash}` };
      const encoded = encode(JSON.stringify(descriptor));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => descriptor,
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
      };
    }

    if (method === 'GET' && /^\/[0-9a-f]{64}$/.test(parsed.pathname)) {
      const entry = store.get(`${base}${parsed.pathname}`);
      if (!entry) {
        return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const copy = new Uint8Array(entry.bytes);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': entry.type, 'content-length': String(entry.size) }),
        arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
      };
    }

    return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
  }

  return {
    servers: [...allowed],
    store,
    requests,
    seed,
    fetcher,
    clear() {
      store.clear();
      requests.length = 0;
    },
  };
}

/**
 * Wraps a fetch implementation to enforce strict browser `Window.fetch` receiver binding.
 * Throws `TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")` whenever
 * called detached (`const f = globalThis.fetch; f(url)`) instead of `globalThis.fetch(url)`.
 */
export function withStrictBrowserFetch(fetcher) {
  if (typeof fetcher !== 'function') throw new TypeError('fetch function required');
  return function strictBrowserFetch(input, init) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return fetcher(input, init);
  };
}
