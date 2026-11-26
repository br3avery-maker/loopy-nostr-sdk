import test from 'node:test';
import assert from 'node:assert/strict';
import { Adapters, Blossom, Core, Nostr, Storage } from '../src/index.js';

const secret = Nostr.generateSecretKey();
const pubkey = Nostr.getPublicKey(secret);
const signer = {
  getPublicKey: async () => pubkey,
  signEvent: async t => Nostr.finalizeEvent(t, secret),
};

test('strict browser Window.fetch receiver works across browserEnvironment, relayInfo, and Blossom', async () => {
  const originalFetch = globalThis.fetch;
  const payload = Core.encode('hello-browser-fetch');
  const hash = await Core.sha256(payload);
  globalThis.fetch = async function strictWindowFetch(url, init) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    if (String(url).startsWith('https://relay.example')) {
      return new Response(JSON.stringify({ name: 'StrictRelay' }), { status: 200, headers: { 'content-type': 'application/nostr+json' } });
    }
    if (init?.method === 'HEAD') return new Response(null, { status: 200 });
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ sha256: hash, size: payload.byteLength }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  try {
    const env = Adapters.browserEnvironment({ globalObj: globalThis });
    const envRes = await env.fetcher('https://relay.example');
    assert.equal(envRes.ok, true);

    const info = await Nostr.relayInfo('wss://relay.example');
    assert.equal(info.name, 'StrictRelay');

    const pre = await Blossom.preflightBlob({ sha256: hash, size: payload.byteLength, type: 'text/plain' }, { servers: ['https://cdn.example'] });
    assert.deepEqual(pre.selected, ['https://cdn.example']);

    const up = await Blossom.uploadVerified(payload, { server: 'https://cdn.example', signer, pubkey, path: 'note.txt' });
    assert.equal(up.verified, true);

    const fetched = await Blossom.fetchVerified(hash, { servers: ['https://cdn.example'] });
    assert.equal(fetched.hash, hash);

    const copies = await Blossom.verifyBlobCopies({ sha256: hash, size: payload.byteLength, type: 'text/plain' }, { servers: ['https://cdn.example'], required: 1 });
    assert.equal(copies.status, 'verified');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Nostr event contracts reject uppercase hex, empty tags, and lone surrogates; checkedSign returns clean wire event', async () => {
  assert.throws(() => Nostr.eventTemplate({ kind: 1, content: 'hi', tags: [[]] }), /Invalid unsigned Nostr event/i);
  assert.throws(() => Nostr.eventTemplate({ kind: 1, content: 'bad\ud800surrogate' }), /Invalid unsigned Nostr event|surrogate/i);
  assert.throws(() => Nostr.eventTemplate({ kind: 1, content: 'ok', tags: [['t', 'bad\udc00tag']] }), /Invalid unsigned Nostr event|surrogate/i);

  const signed = Nostr.finalizeEvent(Nostr.eventTemplate({ kind: 1, content: 'clean' }), secret);
  assert.throws(() => Nostr.assertSignedEvent({ ...signed, id: signed.id.toUpperCase() }), /hex|invalid/i);

  const leakySigner = {
    getPublicKey: async () => pubkey,
    signEvent: async t => ({ ...Nostr.finalizeEvent(t, secret), extraField: 'leak', [Symbol('meta')]: true }),
  };
  const checked = await Nostr.checkedSign(leakySigner, Nostr.eventTemplate({ kind: 1, content: 'clean' }), pubkey);
  assert.deepEqual(Object.keys(checked).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags']);
  assert.equal(Object.getOwnPropertySymbols(checked).length, 0);
});

test('signers forward nip44 and bunkerSigner parses bunker:// offline without network fetch', async () => {
  const browser = Nostr.browserSigner({
    getPublicKey: async () => pubkey,
    signEvent: async t => Nostr.finalizeEvent(t, secret),
    nip44: {
      encrypt: async (peer, text) => `enc:${peer}:${text}`,
      decrypt: async (peer, text) => `dec:${peer}:${text}`,
    },
  });
  const enc = Nostr.encryptionAdapter(browser);
  assert.equal(await enc.encrypt(pubkey, 'secret'), `enc:${pubkey}:secret`);
  assert.equal(await enc.decrypt(pubkey, 'cipher'), `dec:${pubkey}:cipher`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('bunker:// must not call fetch'); };
  try {
    const remote = await Nostr.bunkerSigner(`bunker://${pubkey}?relay=wss%3A%2F%2Frelay.example&secret=topsecret`);
    assert.equal(typeof remote.connect, 'function');
    assert.equal(typeof remote.nip44.encrypt, 'function');
    await remote.close();

    await assert.rejects(
      Nostr.bunkerSigner(`bunker://${pubkey}?relay=http%3A%2F%2Finsecure.example`),
      /Invalid NIP-46 bunker URI|relay|wss/i
    );
    await assert.rejects(
      Nostr.bunkerSigner('alice@example.com'),
      /Invalid NIP-46 bunker URI|NIP-05/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.throws(() => Nostr.nostrConnectRequest({ relays: ['http://not-wss.example'] }), /relay|wss/i);
});

test('NIP-55 intent validation, strict request correlation, and androidHandoff launch safety', async () => {
  assert.throws(
    () => Nostr.androidIntent({ type: 'get_public_key', requestId: 'req-1', callbackUrl: 'javascript:alert(1)' }),
    /callback/i
  );
  assert.throws(
    () => Nostr.androidIntent({ type: 'get_public_key', requestId: 'req-1', callbackUrl: 'http://insecure.example/cb' }),
    /callback/i
  );
  const validUri = Nostr.androidIntent({ type: 'get_public_key', requestId: 'req-1', callbackUrl: 'https://app.example/cb' });
  assert.match(validUri, /^nostrsigner:/);

  const template = Nostr.eventTemplate({ kind: 1, content: 'android-note' });
  const signed = Nostr.finalizeEvent(template, secret);
  assert.throws(
    () => Nostr.verifyAndroidResult({ event: signed, template, expectedPubkey: pubkey }),
    /correlation/i
  );

  // When launch() throws, onReturn() must not leave an unhandled rejection behind.
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const handoff = Adapters.androidHandoff({
      launch: async () => { throw new Error('Intent launch failed'); },
      onReturn: async () => Promise.reject(new Error('never-awaited')),
    });
    await assert.rejects(handoff.sign({ requestId: 'req-2', event: template, expectedPubkey: pubkey }), /Intent launch failed/);
    await new Promise(r => setTimeout(r, 15));
    assert.equal(unhandled, false);

    const pkHandoff = Adapters.androidHandoff({
      launch: async uri => { assert.match(uri, /type=get_public_key/); },
      onReturn: async id => ({ id, result: pubkey }),
    });
    assert.equal(await pkHandoff.getPublicKey({ requestId: 'req-pk' }), pubkey);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('relay transport fails fast on readback EOSE, handles bare auth-required, catches ws.send throws, and enforces frame caps', async () => {
  const signed = Nostr.finalizeEvent(Nostr.eventTemplate({ kind: 1, content: 'readback-check' }), secret);

  // 1) Immediate failure on readback EOSE (no waiting for full timeout)
  class MissingReadbackSocket {
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'EVENT') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, true, '']) }));
      if (msg[0] === 'REQ') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) }));
    }
    close() {}
  }
  const t0 = Date.now();
  await assert.rejects(
    Nostr.publishRelay('wss://relay.example', signed, { Socket: MissingReadbackSocket, timeoutMs: 5000 }),
    err => err.code === 'readback-missing'
  );
  assert.ok(Date.now() - t0 < 1000, 'readback EOSE must fail immediately without waiting for timeout');

  // 2) Bare 'auth-required' OK triggers NIP-42 AUTH and preserves authenticated: true
  class BareAuthSocket {
    constructor() { this.authed = false; queueMicrotask(() => this.onopen?.({})); }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'EVENT' && !this.authed) {
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge-123']) });
          this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, false, 'auth-required']) });
        });
      } else if (msg[0] === 'AUTH') {
        this.authed = true;
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, true, '']) }));
      } else if (msg[0] === 'EVENT' && this.authed) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, true, '']) }));
      } else if (msg[0] === 'REQ') {
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify(['EVENT', msg[1], signed]) });
          this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) });
        });
      }
    }
    close() {}
  }
  const receipt = await Nostr.publishRelay('wss://relay.example', signed, {
    Socket: BareAuthSocket,
    authSigner: signer,
    authPubkey: pubkey,
  });
  assert.equal(receipt.authenticated, true);
  const many = await Nostr.publishMany(signed, ['wss://relay.example'], {
    Socket: BareAuthSocket,
    authSigner: signer,
    authPubkey: pubkey,
  });
  assert.equal(many.verified[0].authenticated, true);

  // 3) queryRelay catches synchronous ws.send throws and enforces maxBytes cap
  class ThrowingSendSocket {
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    send() { throw new Error('socket send failed'); }
    close() {}
  }
  await assert.rejects(
    Nostr.queryRelay('wss://relay.example', { kinds: [1] }, { Socket: ThrowingSendSocket }),
    err => err.code === 'network' && /Relay send failed/.test(err.message)
  );

  class OversizedFrameSocket {
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    send() { queueMicrotask(() => this.onmessage?.({ data: 'x'.repeat(2048) })); }
    close() {}
  }
  await assert.rejects(
    Nostr.queryRelay('wss://relay.example', { kinds: [1] }, { Socket: OversizedFrameSocket, maxBytes: 1024 }),
    err => err.code === 'size-limit'
  );
});

test('delivery blocks trailing-dot local relay hints and executeRelayDelivery uses injectable clock', async () => {
  const signed = Nostr.finalizeEvent(Nostr.eventTemplate({ kind: 1, created_at: 1699999990, content: 'routing' }), secret);
  const hintList = Nostr.finalizeEvent(
    Nostr.eventTemplate({ kind: 10002, created_at: 1699999990, tags: [['r', 'wss://localhost.', 'write'], ['r', 'wss://good.example', 'write']] }),
    secret
  );
  const plan = Nostr.planRelayDelivery(signed, { signedLists: [hintList], now: 1700000000 });
  const selected = plan.groups.flatMap(g => g.selected.map(c => c.relay));
  assert.deepEqual(selected, ['wss://good.example']);
  assert.ok(!selected.some(r => r.includes('localhost')));

  class OkSocket {
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'EVENT') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, true, '']) }));
      if (msg[0] === 'REQ') queueMicrotask(() => {
        this.onmessage?.({ data: JSON.stringify(['EVENT', msg[1], signed]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', msg[1]]) });
      });
    }
    close() {}
  }
  const executed = await Nostr.executeRelayDelivery(signed, {
    allowedRelays: ['wss://good.example'],
    defaults: ['wss://good.example'],
    now: 1700000000,
    clock: () => 1700000042,
    Socket: OkSocket,
  });
  assert.equal(executed.observations[0]?.at, 1700000042);
});

test('profiles, discovery, nip65, and NIP-98 HTTP auth enforce URL, time, abort, and payload guards', async () => {
  const profileEvent = Nostr.finalizeEvent(
    Nostr.eventTemplate({
      kind: 0,
      content: JSON.stringify({
        name: 'Alice',
        picture: 'javascript:alert(1)',
        banner: 'http://insecure.example/b.png',
        website: 'data:text/html,evil',
      }),
    }),
    secret
  );
  const parsed = Nostr.parseProfile(profileEvent);
  assert.equal(parsed.picture, undefined);
  assert.equal(parsed.banner, undefined);
  assert.equal(parsed.website, undefined);

  const goodList = Nostr.finalizeEvent(
    Nostr.eventTemplate({ kind: 10002, created_at: 1000, tags: [['r', 'wss://good.example', '']] }),
    secret
  );
  const futureList = Nostr.finalizeEvent(
    Nostr.eventTemplate({ kind: 10002, created_at: 9999999999, tags: [['r', 'wss://evil.example', 'write']] }),
    secret
  );
  assert.deepEqual(Nostr.relayList(goodList), [{ url: 'wss://good.example', read: true, write: true }]);

  const discovered = await Nostr.discoverRelays(pubkey, {
    bootstrap: ['wss://boot.example'],
    now: 1100,
    query: async () => [goodList, futureList],
  });
  assert.equal(discovered.sourceEvent, goodList.id);
  assert.deepEqual(discovered.records, [{ url: 'wss://good.example', read: true, write: true }]);
  assert.ok(discovered.relays.includes('wss://good.example') && !discovered.relays.includes('wss://evil.example'));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    Nostr.discoverRelays(pubkey, { bootstrap: ['wss://boot.example'], signal: controller.signal, query: async () => [] }),
    /cancelled/i
  );
  await assert.rejects(Nostr.discoverBlossom(pubkey, { bootstrap: [] }), /bootstrap/i);

  const authHeader = await Nostr.httpAuthHeader({
    url: 'https://api.example/upload?x=1#secret-fragment',
    method: 'POST',
    payload: 'body-bytes',
    signer,
    pubkey,
    created_at: 1700000000,
  });
  assert.match(authHeader, /^Nostr /);
  const decoded = JSON.parse(Buffer.from(authHeader.slice(6), 'base64').toString('utf8'));
  const expectedPayloadHash = await Core.sha256('body-bytes');
  assert.ok(decoded.tags.some(t => t[0] === 'u' && t[1] === 'https://api.example/upload?x=1'));
  assert.ok(decoded.tags.some(t => t[0] === 'payload' && t[1] === expectedPayloadHash));
});

test('Blossom uploadVerified accepts pre-signed batch authEvent, surfaces non-JSON HTTP errors, and verifyBlobCopies supports earlyStop', async () => {
  const body = Core.encode('batched-asset');
  const hash = await Core.sha256(body);
  const batchTemplate = Blossom.blossomBatchUploadAuth({
    hashes: [hash],
    servers: ['https://cdn1.example'],
    now: 1700000000,
    expiresIn: 300,
  });
  const batchAuth = await Nostr.checkedSign(signer, batchTemplate, pubkey);

  let signCalls = 0;
  const noSignSigner = { getPublicKey: async () => pubkey, signEvent: async () => { signCalls++; throw new Error('should not sign'); } };
  const uploaded = await Blossom.uploadVerified(body, {
    server: 'https://cdn1.example',
    signer: noSignSigner,
    pubkey,
    authEvent: batchAuth,
    clock: () => 1700000010,
    fetcher: async (url, init) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ sha256: hash, size: body.byteLength }), { status: 200 });
      return new Response(body, { status: 200 });
    },
  });
  assert.equal(uploaded.verified, true);
  assert.equal(signCalls, 0);

  await assert.rejects(
    Blossom.uploadVerified(body, {
      server: 'https://cdn1.example',
      signer,
      pubkey,
      fetcher: async () => new Response('Plain text unauthorized', { status: 401 }),
    }),
    err => err.status === 401 && /401/.test(err.message)
  );

  let fetchCount = 0;
  const copies = await Blossom.verifyBlobCopies(
    { sha256: hash, size: body.byteLength, type: 'text/plain' },
    {
      servers: ['https://a.example', 'https://b.example', 'https://c.example'],
      required: 1,
      earlyStop: true,
      fetcher: async () => {
        fetchCount++;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
      },
    }
  );
  assert.equal(copies.status, 'verified');
  assert.equal(fetchCount, 1);
});

test('indexedDbStore recovers from transient open failure, calls getAllKeys() with 0 args, supports close(), and scopedStore isolates namespaces', async () => {
  let attempts = 0;
  let closed = false;
  let getAllKeysArgCount = -1;
  const records = new Map();
  const fakeProvider = {
    open() {
      attempts++;
      const req = {};
      queueMicrotask(() => {
        if (attempts === 1) {
          req.error = new Error('transient open failure');
          req.onerror?.();
          return;
        }
        req.result = {
          objectStoreNames: { contains: () => true },
          close() { closed = true; },
          transaction() {
            const txn = {};
            return {
              set oncomplete(fn) { txn.oncomplete = fn; },
              set onabort(fn) { txn.onabort = fn; },
              set onerror(fn) { txn.onerror = fn; },
              objectStore() {
                const run = fn => {
                  const r = {};
                  queueMicrotask(() => {
                    r.result = fn();
                    r.onsuccess?.();
                    txn.oncomplete?.();
                  });
                  return r;
                };
                return {
                  put: (v, k) => run(() => { records.set(k, v); }),
                  get: k => run(() => records.get(k)),
                  delete: k => run(() => { records.delete(k); }),
                  getAllKeys(...args) { getAllKeysArgCount = args.length; return run(() => [...records.keys()]); },
                };
              },
            };
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };

  const idb = Storage.indexedDbStore({ indexedDBProvider: fakeProvider });
  await assert.rejects(idb.get('k'), /transient open failure/);
  await idb.set('k', 'v');
  assert.equal(await idb.get('k'), 'v');
  assert.deepEqual(await idb.keys(), ['k']);
  assert.equal(getAllKeysArgCount, 0);
  await idb.close();
  assert.equal(closed, true);

  const backing = Storage.memoryStore();
  const nsA = Storage.scopedStore(backing, 'alpha');
  const nsB = Storage.scopedStore(backing, 'beta');
  await nsA.set('item', 1);
  await nsB.set('item', 2);
  assert.equal(await nsA.get('item'), 1);
  assert.equal(await nsB.get('item'), 2);
  assert.deepEqual(await nsA.keys(), ['item']);
  assert.deepEqual(await nsB.keys(), ['item']);
  await nsA.delete('item');
  assert.equal(await nsA.get('item'), undefined);
  assert.equal(await nsB.get('item'), 2);
});
