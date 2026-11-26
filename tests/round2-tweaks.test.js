import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  Anchor,
  Archive,
  Blossom,
  Core,
  Directory,
  Moji,
  Nostr,
  Storage,
  Testing,
  createNsiteSDK,
} from '../src/index.js';

function createMockIndexedDB() {
  const stores = new Map();
  return {
    open(name) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (!stores.has(name)) stores.set(name, new Map());
        const dbMap = stores.get(name);
        const db = {
          objectStoreNames: { contains: storeName => dbMap.has(storeName) },
          createObjectStore: storeName => {
            if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
          },
          transaction(storeName) {
            if (!dbMap.has(storeName)) dbMap.set(storeName, new Map());
            const map = dbMap.get(storeName);
            const txn = { oncomplete: null, onabort: null, onerror: null, error: null };
            const runReq = fn => {
              const r = { result: undefined, error: null, onsuccess: null, onerror: null };
              queueMicrotask(() => {
                try {
                  r.result = fn();
                  r.onsuccess?.();
                  txn.oncomplete?.();
                } catch (err) {
                  r.error = err;
                  txn.error = err;
                  r.onerror?.();
                  txn.onerror?.();
                }
              });
              return r;
            };
            txn.objectStore = () => ({
              get: k => runReq(() => map.get(k)),
              put: (v, k) => runReq(() => { map.set(k, v); }),
              delete: k => runReq(() => { map.delete(k); }),
              getAllKeys: () => runReq(() => [...map.keys()]),
            });
            return txn;
          },
          close() {},
        };
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

test('Round 2: Storage.fsStore preserves Uint8Array binary values and works seamlessly with Archive.contentStore', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loopy-r2-fs-'));
  try {
    const store = Storage.fsStore(tmpDir);
    const binary = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    await store.set('raw:bin', binary);
    await store.set('nested:obj', { meta: 'ok', bytes: binary, list: [binary] });

    const gotRaw = await store.get('raw:bin');
    assert.ok(gotRaw instanceof Uint8Array);
    assert.deepEqual([...gotRaw], [...binary]);

    const gotNested = await store.get('nested:obj');
    assert.equal(gotNested.meta, 'ok');
    assert.ok(gotNested.bytes instanceof Uint8Array);
    assert.deepEqual([...gotNested.bytes], [...binary]);
    assert.ok(gotNested.list[0] instanceof Uint8Array);
    assert.deepEqual([...gotNested.list[0]], [...binary]);

    // Brick-swap proof: Archive.contentStore backed by fsStore on disk
    const cas = Archive.contentStore(Storage.scopedStore(store, 'cas'));
    const payload = Core.encode('hello durable CAS on filesystem');
    const { hash } = await cas.put(payload);
    const readBack = await cas.get(hash);
    assert.ok(readBack instanceof Uint8Array);
    assert.equal(Core.decode(readBack), 'hello durable CAS on filesystem');

    await store.close();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Round 2: keys(prefix) filtering is consistent across all 4 Storage adapters and createAccountSession', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loopy-r2-keys-'));
  try {
    const mem = Storage.memoryStore();
    const scoped = Storage.scopedStore(Storage.memoryStore(), 'app');
    const disk = Storage.fsStore(tmpDir);
    const idb = Storage.indexedDbStore({ name: 'r2-test', store: 'kv', indexedDBProvider: createMockIndexedDB() });
    const session = Core.createAccountSession({
      pubkey: 'a'.repeat(64),
      storage: Storage.memoryStore(),
    });

    const adapters = [
      ['memoryStore', mem],
      ['scopedStore', scoped],
      ['fsStore', disk],
      ['indexedDbStore', idb],
      ['accountSession.storage', session.storage],
    ];

    for (const [label, adapter] of adapters) {
      await adapter.set('ns:alpha', 1);
      await adapter.set('ns:beta', 2);
      await adapter.set('other:gamma', 3);

      const all = (await adapter.keys()).slice().sort();
      assert.deepEqual(all, ['ns:alpha', 'ns:beta', 'other:gamma'], `${label} keys()`);

      const filtered = (await adapter.keys('ns:')).slice().sort();
      assert.deepEqual(filtered, ['ns:alpha', 'ns:beta'], `${label} keys('ns:')`);

      const empty = await adapter.keys('missing:');
      assert.deepEqual(empty, [], `${label} keys('missing:')`);
    }

    await disk.close();
    await idb.close();
    await session.close();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Round 2: Core.boundedFetch json mode falls back to response.text() and enforces maxBytes', async () => {
  const textOnlyFetcher = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    async text() {
      return JSON.stringify({ hello: 'world' });
    },
  });

  const res = await Core.boundedFetch('https://example.com/data.json', {}, {
    fetcher: textOnlyFetcher,
    read: 'json',
    maxBytes: 1024,
  });
  assert.deepEqual(res.json, { hello: 'world' });

  await assert.rejects(
    () =>
      Core.boundedFetch('https://example.com/data.json', {}, {
        fetcher: textOnlyFetcher,
        read: 'json',
        maxBytes: 8,
      }),
    err => err?.code === 'size-limit'
  );
});

test('Round 2: Nostr.verifyNip05 handles text()-only responses and uses NIP-05 domain error copy', async () => {
  const pubkey = 'b'.repeat(64);
  const res = await Nostr.verifyNip05('Alice@Example.COM', {
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({
          names: { alice: pubkey },
          relays: { [pubkey]: ['wss://relay.example.com'] },
        });
      },
    }),
  });
  assert.equal(res.pubkey, pubkey);
  assert.deepEqual(res.relays, ['wss://relay.example.com']);

  await assert.rejects(
    () => Nostr.verifyNip05('alice@127.0.0.1', { fetcher: async () => { throw new Error('should not fetch'); } }),
    err => /NIP-05 domain/i.test(err.message) && !/Blossom/i.test(err.message)
  );
});

test('Round 2: Nostr.createRelayHealthCache.savePolicy rejects out-of-window observedAt', async () => {
  const cache = Nostr.createRelayHealthCache(Storage.memoryStore(), { policyTtl: 3600 });
  const now = 1700000000;

  // Within freshness window succeeds
  const saved = await cache.savePolicy('wss://relay.example.com', { name: 'Relay' }, { observedAt: now, now });
  assert.equal(saved.relay, 'wss://relay.example.com');

  // Far-future observedAt rejected
  await assert.rejects(
    () => cache.savePolicy('wss://relay.example.com', { name: 'Future' }, { observedAt: now + 999999, now }),
    RangeError
  );

  // Stale observedAt rejected
  await assert.rejects(
    () => cache.savePolicy('wss://relay.example.com', { name: 'Stale' }, { observedAt: now - 7200, now }),
    RangeError
  );
});

test('Round 2: Blossom.repairBlobReplicas avoids redundant GET after default uploadVerified', async () => {
  const signer = Testing.createTestSigner();
  const s1 = 'https://b1.example.com';
  const s2 = 'https://b2.example.com';
  const mock = Testing.createMockBlossom({ servers: [s1, s2] });

  const content = Core.encode('<h1>Repair me</h1>');
  const { hash } = await mock.seed(s1, content, 'text/html');

  const manifest = {
    files: [{ path: '/index.html', hash, size: content.byteLength, type: 'text/html' }],
    servers: [s1, s2],
  };

  const report = await Blossom.repairBlobReplicas(manifest, {
    targetServers: [s1, s2],
    requiredCopies: 2,
    signer,
    pubkey: signer.pubkey,
    fetcher: mock.fetcher,
  });

  assert.equal(report.status, 'healthy');
  assert.equal(report.repaired, 1);
  // b2 gets 1 GET from initial verifyBlobCopies (404) + 1 GET from uploadVerified's single-GET readback (200),
  // and NOT an extra post-upload verifyBlobCopies GET.
  const b2Gets = mock.requests.filter(r => r.method === 'GET' && r.url.startsWith(s2));
  assert.equal(b2Gets.length, 2);
});

test('Round 2: createNsiteSDK freezes options and relays against external mutation', () => {
  const relays = ['wss://relay1.example.com', 'wss://relay2.example.com'];
  const sdk = createNsiteSDK({ relays });

  // Mutating caller array must not affect SDK config
  relays.push('wss://evil.example.com');
  assert.deepEqual(sdk.options.relays, ['wss://relay1.example.com', 'wss://relay2.example.com']);

  // SDK config and relays are frozen
  assert.ok(Object.isFrozen(sdk.options));
  assert.ok(Object.isFrozen(sdk.options.relays));
  assert.throws(() => {
    sdk.options.relays.push('wss://mutated.example.com');
  }, TypeError);
});

test('Round 2: Directory.setQueue blocks forbidden prototype keys and validateCatalog canonicalizes live endpoints', () => {
  const state = Directory.emptyState();
  Directory.setQueue(state, ['site-1', '__proto__', 'constructor', 'prototype', 'site-2']);
  assert.deepEqual(state.queue.ids, ['site-1', 'site-2']);

  const catalog = Directory.validateCatalog({
    sites: [
      {
        id: 'site-1',
        url: 'https://example.com/',
        title: 'Example',
        live: true,
        servers: ['https://CDN.Example.COM/', 'http://127.0.0.1/bad', 'https://cdn.example.com'],
        relays: ['wss://Relay.Example.COM/', 'ws://insecure.example.com', 'wss://relay.example.com'],
      },
    ],
  });
  assert.deepEqual(catalog[0].servers, ['https://cdn.example.com']);
  assert.deepEqual(catalog[0].relays, ['wss://relay.example.com']);
});

test('Round 2 (Loop 3–4): Core.endpoint rejects RFC 8375 .home.arpa local domains', () => {
  assert.equal(Core.isPrivateOrLocalHost('nas.home.arpa'), true);
  assert.throws(() => Core.endpoint('https://nas.home.arpa', 'blossom'), TypeError);
});

test('Round 2 (Loop 3–4): Directory.publicCatalog sanitizes unsafe URLs and htmlMetadata bounds multi-MB inputs', () => {
  const state = Directory.emptyState();
  const exported = Directory.publicCatalog(
    [
      {
        id: 'xss-1',
        url: 'javascript:alert(1)',
        status: 'data:text/html,boom',
        title: 'Untrusted',
        publisher: 'anon',
        tags: [],
      },
    ],
    state
  );
  assert.equal(exported[0].url, '');
  assert.equal(exported[0].status, '');

  const huge = '<title>Bounded Title</title>' + '<meta name="description" content="Short">' + 'x'.repeat(1_000_000);
  const meta = Directory.htmlMetadata(huge);
  assert.equal(meta.title, 'Bounded Title');
  assert.equal(meta.description, 'Short');
});

test('Round 2 (Loop 3–4): Moji.sanitizeEmojiShortcode blocks prototype-pollution keys', async () => {
  assert.equal(Moji.sanitizeEmojiShortcode('__proto__'), '');
  assert.equal(Moji.sanitizeEmojiShortcode('constructor'), '');
  assert.equal(Moji.sanitizeEmojiShortcode('prototype'), '');
  assert.equal(Moji.sanitizeEmojiShortcode('party_parrot'), 'party_parrot');

  const signer = Testing.createTestSigner();
  const ev = await signer.signEvent({
    kind: 30030,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'pack'],
      ['emoji', '__proto__', 'https://example.com/bad.png'],
      ['emoji', 'party_parrot', 'https://example.com/ok.png'],
    ],
    content: '',
  });
  const parsed = await Moji.parseNip30Event(ev);
  assert.deepEqual(
    parsed.emojis.map(e => e.shortcode),
    ['party_parrot']
  );
});

test('Round 2 (Loop 3–4): Anchor.buildPublicAccountBackup redacts apiKey, mnemonic, and seedPhrase', () => {
  const backup = Anchor.buildPublicAccountBackup({
    session: { pubkey: 'a'.repeat(64), mode: 'read-only' },
    preferences: {
      apiKey: 'sk-live-123',
      api_key: 'sk-live-456',
      mnemonic: 'abandon ability able',
      seedPhrase: 'zoo zoo wrong',
      theme: 'contrast',
    },
  });
  const json = JSON.stringify(backup);
  assert.equal(json.includes('sk-live-123'), false);
  assert.equal(json.includes('sk-live-456'), false);
  assert.equal(json.includes('abandon ability'), false);
  assert.equal(json.includes('zoo zoo'), false);
  assert.equal(backup.records.preferences.theme, 'contrast');
});

test('Round 2 (Loop 3–4): Nostr.httpAuthHeader normalizes lowercase HTTP methods to canonical uppercase', async () => {
  const signer = Testing.createTestSigner();
  const header = await Nostr.httpAuthHeader({
    url: 'https://api.example.com/v1/upload',
    method: 'post',
    signer,
    pubkey: signer.pubkey,
    created_at: 1700000000,
  });
  assert.match(header, /^Nostr /);
  const event = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'));
  assert.equal(Nostr.verifyEvent(event), true);
  assert.deepEqual(event.tags, [
    ['u', 'https://api.example.com/v1/upload'],
    ['method', 'POST'],
  ]);
});

test('Round 2 (Loop 3–4): Nostr.createEventStore passes evt: prefix to storage.keys()', async () => {
  const seenPrefixes = [];
  const base = Storage.memoryStore();
  const spyStorage = {
    get: k => base.get(k),
    set: (k, v) => base.set(k, v),
    delete: k => base.delete(k),
    keys: prefix => {
      seenPrefixes.push(prefix);
      return base.keys(prefix);
    },
  };
  const store = Nostr.createEventStore(spyStorage);
  const signer = Testing.createTestSigner();
  const ev = await signer.signEvent({ kind: 1, created_at: 1700000000, tags: [], content: 'indexed' });
  await store.put(ev);
  const rows = await store.query({ kinds: [1] });
  const ids = await store.keys();
  assert.equal(rows.length, 1);
  assert.deepEqual(ids, [ev.id]);
  assert.deepEqual(seenPrefixes, ['evt:', 'evt:']);
});

