import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from '../src/index.js';

test('defaultFetch and normalizeOptions never trigger browser Window.fetch Illegal invocation', async () => {
  const originalFetch = globalThis.fetch;
  let calledWithGlobal = 0;
  globalThis.fetch = function strictBrowserFetch(url, init) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    calledWithGlobal++;
    return Promise.resolve(new Response(JSON.stringify({ url, method: init?.method || 'GET' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  };
  try {
    const r1 = await Core.defaultFetch('https://example.com/a');
    assert.equal(r1.status, 200);

    const opts = Core.normalizeOptions();
    const detached = opts.fetcher;
    const r2 = await detached('https://example.com/b');
    assert.equal(r2.status, 200);

    const r3 = await Core.boundedFetch('https://example.com/c', {}, { read: 'json' });
    assert.equal(r3.ok, true);
    assert.deepEqual(r3.json, { url: 'https://example.com/c', method: 'GET' });
    assert.equal(calledWithGlobal, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint canonicalizes trailing dots and enforces publicHost consistently', () => {
  assert.equal(Core.endpoint('https://Blossom.Example.COM./', 'blossom'), 'https://blossom.example.com');
  assert.equal(Core.endpoint('wss://Relay.Example.COM:443/', 'relay'), 'wss://relay.example.com');
  assert.equal(Core.endpoint('wss://Relay.Example.COM./', 'relay'), 'wss://relay.example.com');

  // Local relay allowed by default for local dev, rejected when publicHost: true
  assert.equal(Core.endpoint('wss://localhost:7777/', 'relay'), 'wss://localhost:7777');
  assert.throws(() => Core.endpoint('wss://localhost:7777/', 'relay', { publicHost: true }), /public WSS host/);
  assert.throws(() => Core.endpoint('wss://admin.internal./', 'relay', { publicHost: true }), /public WSS host/);
  assert.throws(() => Core.endpoint('wss://app.localhost./', 'relay', { publicHost: true }), /public WSS host/);
  assert.throws(() => Core.endpoint('wss://127.0.0.1/', 'relay', { publicHost: true }), /public WSS host/);

  // Blossom enforces publicHost by default
  assert.throws(() => Core.endpoint('https://blob.internal./', 'blossom'), /named HTTPS host/);
  assert.throws(() => Core.endpoint('https://[::1]/', 'blossom'), /named HTTPS host/);

  // endpoints deduplicates trailing-dot and default-port variants and validates max
  assert.deepEqual(
    Core.endpoints(['wss://relay.example/', 'wss://RELAY.example:443', 'wss://relay.example.'], 'relay'),
    ['wss://relay.example']
  );
  assert.throws(() => Core.endpoints(['wss://relay.example'], 'relay', -1), RangeError);
  assert.throws(() => Core.endpoints(['wss://relay.example'], 'relay', Number.NaN), RangeError);
});

test('boundedFetch enforces redirects, byte limits, malformed Content-Length, timeouts, and cancellation', async () => {
  // Refuses redirects
  await assert.rejects(
    () => Core.boundedFetch('https://example.com/x', {}, {
      fetcher: async () => ({ ok: true, status: 200, redirected: true, headers: new Headers() }),
    }),
    err => err.code === 'redirect'
  );

  // Fast-rejects oversized valid Content-Length without reading stream
  let readCalled = false;
  await assert.rejects(
    () => Core.boundedFetch('https://example.com/big', {}, {
      maxBytes: 10,
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '999' }),
        body: { getReader() { readCalled = true; throw new Error('should not read'); }, cancel: async () => {} },
      }),
    }),
    err => err.code === 'size-limit'
  );
  assert.equal(readCalled, false);

  // Handles malformed Content-Length ('abc', '-5') safely via streaming cap
  for (const badHeader of ['abc', '-5']) {
    const okRes = await Core.boundedFetch('https://example.com/ok', {}, {
      maxBytes: 4,
      fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-length': badHeader },
      }),
    });
    assert.deepEqual([...okRes.data], [1, 2, 3, 4]);

    await assert.rejects(
      () => Core.boundedFetch('https://example.com/too-big', {}, {
        maxBytes: 3,
        fetcher: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': badHeader },
        }),
      }),
      err => err.code === 'size-limit'
    );
  }

  // Cancellation before start and mid-flight
  const ac1 = new AbortController();
  ac1.abort();
  await assert.rejects(
    () => Core.boundedFetch('https://example.com/aborted', {}, { signal: ac1.signal, fetcher: async () => new Response('') }),
    err => err.code === 'cancelled'
  );

  // Timeout
  await assert.rejects(
    () => Core.boundedFetch('https://example.com/slow', {}, {
      timeoutMs: 25,
      fetcher: (_u, init) => new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(new Error('aborted')));
      }),
    }),
    err => err.code === 'timeout' && err.retryable === true
  );

  // Invalid JSON reports structured code
  await assert.rejects(
    () => Core.boundedFetch('https://example.com/bad-json', {}, {
      read: 'json',
      fetcher: async () => new Response('{not-json', { status: 200 }),
    }),
    err => err.code === 'invalid-json'
  );

  // read: 'none' returns status without reading body
  const headRes = await Core.boundedFetch('https://example.com/head', { method: 'HEAD' }, {
    read: 'none',
    fetcher: async () => new Response(null, { status: 204 }),
  });
  assert.equal(headRes.status, 204);
  assert.equal('data' in headRes, false);
});

test('core guards enforce strict lowercase hex, lone surrogates, prototype keys, URLs, gateway hosts, and NIP-01 kinds', () => {
  const valid64 = 'a'.repeat(64);
  assert.equal(Core.isHex(valid64), true);
  assert.equal(Core.isHex('A'.repeat(64)), false);
  assert.equal(Core.isHex('a'.repeat(63)), false);
  assert.equal(Core.assertHex(valid64, 64, 'pubkey'), valid64);
  assert.throws(() => Core.assertHex('A'.repeat(64), 64, 'pubkey'), TypeError);

  assert.equal(Core.hasLoneSurrogate('hello 🌍 world'), false);
  assert.equal(Core.hasLoneSurrogate('hi\uD800world'), true);
  assert.equal(Core.hasLoneSurrogate('hi\uDC00world'), true);
  assert.equal(Core.hasLoneSurrogate('end\uD800'), true);

  assert.equal(Core.isForbiddenKey('__proto__'), true);
  assert.equal(Core.isForbiddenKey('constructor'), true);
  assert.equal(Core.isForbiddenKey('prototype'), true);
  assert.equal(Core.isForbiddenKey('site-1'), false);

  assert.equal(Core.safeHttpUrl('https://example.com/img.png'), 'https://example.com/img.png');
  assert.equal(Core.safeHttpUrl('http://example.com/img.png'), null);
  assert.equal(Core.safeHttpUrl('http://example.com/img.png', { allowHttp: true }), 'http://example.com/img.png');
  assert.equal(Core.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(Core.safeHttpUrl('data:text/html,<script>1</script>'), null);
  assert.equal(Core.safeHttpUrl('https://user:pass@example.com/'), null);
  assert.throws(() => Core.assertSafeHttpUrl('javascript:alert(1)'), TypeError);

  assert.equal(Core.canonicalGatewayHost('Nsite.Example.COM.'), 'nsite.example.com');
  assert.throws(() => Core.canonicalGatewayHost('localhost'), TypeError);
  assert.throws(() => Core.canonicalGatewayHost('127.0.0.1'), TypeError);
  assert.throws(() => Core.canonicalGatewayHost('app.internal.'), TypeError);

  assert.equal(Core.classifyEventStorage(0), 'replaceable');
  assert.equal(Core.classifyEventStorage(1), 'regular');
  assert.equal(Core.classifyEventStorage(3), 'replaceable');
  assert.equal(Core.classifyEventStorage(15128), 'replaceable');
  assert.equal(Core.classifyEventStorage(22242), 'ephemeral');
  assert.equal(Core.classifyEventStorage(35128), 'addressable');
  assert.throws(() => Core.classifyEventStorage(-1), RangeError);
  assert.throws(() => Core.classifyEventStorage(65536), RangeError);
  assert.throws(() => Core.classifyEventStorage(1.5), RangeError);

  const caps = Core.checkRuntimeCapabilities();
  assert.equal(typeof caps.subtleCrypto, 'boolean');
  assert.equal(typeof caps.fetch, 'boolean');
  assert.equal(caps.subtleCrypto, true);
});

test('toBase64 and toBase64Url handle large payloads identically in Buffer and browser-fallback modes', () => {
  const payload = new Uint8Array(25000);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 0xff;

  const nodeB64 = Core.toBase64(payload);
  const nodeB64Url = Core.toBase64Url(payload);

  const savedBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    assert.equal(Core.toBase64(payload), nodeB64);
    assert.equal(Core.toBase64Url(payload), nodeB64Url);
  } finally {
    globalThis.Buffer = savedBuffer;
  }
});
