import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  createNsiteSDK,
  Core,
  Nostr,
  Nsite,
  Archive,
  Directory,
  Storage,
  Moderation,
  Moji,
  Anchor,
  Intelligence,
} from '../src/index.js';

function makeLocalSigner() {
  const secret = Nostr.generateSecretKey();
  const pubkey = Nostr.getPublicKey(secret);
  return {
    pubkey,
    secret,
    signer: {
      async getPublicKey() { return pubkey; },
      async signEvent(template) { return Nostr.finalizeEvent(template, secret); },
    },
  };
}

function makeDeflateZip(name, rawBytes) {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(name);
  const compressed = new Uint8Array(deflateRawSync(rawBytes));
  const crc = Archive.crc32(rawBytes);

  const local = new Uint8Array(30 + nameBytes.length + compressed.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true); // DEFLATE
  lv.setUint32(14, crc, true);
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, rawBytes.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(compressed, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true); // DEFLATE
  cv.setUint32(16, crc, true);
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, rawBytes.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}

test('Batch 3 Nsite: mediaType, dotted-directory index resolution, corrupt cache, server cap & auth forwarding', async () => {
  assert.equal(Nsite.mediaType('/README'), 'application/octet-stream');
  assert.equal(Nsite.mediaType('/v1.2/README'), 'application/octet-stream');
  assert.equal(Nsite.mediaType('/assets/font.woff2'), 'font/woff2');
  assert.equal(Nsite.mediaType('/app.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(Nsite.mediaType('/hero.avif'), 'image/avif');

  const manifest = {
    files: [
      { path: '/index.html', hash: 'a'.repeat(64) },
      { path: '/v1.2/index.html', hash: 'b'.repeat(64) },
    ],
  };
  assert.equal(Nsite.resolveManifestPath(manifest, '/v1.2')?.path, '/v1.2/index.html');
  assert.equal(Nsite.resolveManifestPath(manifest, '/v1.2/')?.path, '/v1.2/index.html');

  const { pubkey, secret, signer } = makeLocalSigner();
  const corruptStore = Storage.memoryStore({
    [`nsite-manifest:${Nsite.NSITE_ROOT_KIND}:${pubkey}:`]: { checkedAt: 1700000000, event: { bogus: true } },
  });
  const res = await Nsite.resolveNsiteManifest(pubkey, {
    storage: corruptStore,
    relays: ['wss://relay.example'],
    query: async () => [],
    now: 1700000010,
  });
  assert.equal(res.status, 'not-found');
  assert.equal(res.errors.some(e => e.stage === 'cache'), true);

  // Caller servers must not be evicted when manifest lists >16 server tags.
  const body = Core.encode('hello-caller-server');
  const hash = await Core.sha256(body);
  const manyServers = Array.from({ length: 20 }, (_, i) => ['server', `https://m${i}.example`]);
  const signedManifest = Nostr.finalizeEvent({
    kind: Nsite.NSITE_ROOT_KIND,
    created_at: 1700000100,
    content: '',
    tags: [['path', '/index.html', hash], ...manyServers],
  }, secret);
  const seenUrls = [];
  const loaded = await Nsite.loadNsiteFile(signedManifest, '/', {
    servers: ['https://caller-pinned.example'],
    fetcher: async (url) => {
      seenUrls.push(url);
      if (url.startsWith('https://caller-pinned.example/')) {
        return new Response(body, { status: 200 });
      }
      return new Response('miss', { status: 404 });
    },
  });
  assert.ok(loaded);
  assert.equal(loaded.server, 'https://caller-pinned.example');
  assert.equal(seenUrls.some(u => u.startsWith('https://caller-pinned.example/')), true);

  // publishNsite forwards NIP-42 authSigner/authPubkey/clock/timeoutMs to publisher
  let capturedPubOpts = null;
  await Nsite.publishNsite({ 'index.html': 'hi' }, {
    pubkey,
    signer,
    server: 'https://blossom.example',
    relays: ['wss://relay.example'],
    authSigner: signer,
    authPubkey: pubkey,
    requireAuthentication: true,
    timeoutMs: 4321,
    clock: () => 1700000500,
    uploader: async (data) => ({ hash: await Core.sha256(data), verified: true }),
    publisher: async (ev, relays, opts) => {
      capturedPubOpts = opts;
      return { verified: [{ relay: relays[0], eventId: ev.id, accepted: true, readback: true }], failed: [] };
    },
  });
  assert.equal(capturedPubOpts.authSigner, signer);
  assert.equal(capturedPubOpts.authPubkey, pubkey);
  assert.equal(capturedPubOpts.requireAuthentication, true);
  assert.equal(capturedPubOpts.timeoutMs, 4321);

  await assert.rejects(() => Nsite.prepareManifestFiles(['not-a-map']), /File map required/);
});

test('Batch 3 Archive: native DEFLATE zip read, Uint8Array CAS storage, chunk bounds & search clamping', async () => {
  const payload = Core.encode('Compressed without custom inflate callback '.repeat(20));
  const zipBytes = makeDeflateZip('docs/readme.txt', payload);
  const extracted = await Archive.readZip(zipBytes);
  assert.deepEqual(extracted['docs/readme.txt'], payload);

  // Method mismatch between local header and central directory must fail.
  const badZip = new Uint8Array(zipBytes);
  new DataView(badZip.buffer).setUint16(8, 0, true); // tamper local header method to 0 while central says 8
  await assert.rejects(() => Archive.readZip(badZip), /method mismatch/i);

  // Content store stores Uint8Array directly while still reading legacy JS Arrays.
  const backing = new Map();
  const rawAdapter = {
    async get(k) { return backing.get(k) ?? null; },
    async set(k, v) { backing.set(k, v); },
    async delete(k) { backing.delete(k); },
    async keys() { return [...backing.keys()]; },
  };
  const cas = Archive.contentStore(rawAdapter);
  const { hash } = await cas.put(new Uint8Array([10, 20, 30]));
  assert.equal(backing.get(`blob:${hash}`) instanceof Uint8Array, true);
  const legacyHash = await Core.sha256(new Uint8Array([4, 5, 6]));
  backing.set(`blob:${legacyHash}`, [4, 5, 6]);
  assert.deepEqual(await cas.get(legacyHash), new Uint8Array([4, 5, 6]));

  // restoreChunkManifest rejects negative size and excessive chunks before allocating.
  await assert.rejects(
    () => Archive.restoreChunkManifest({ profile: Archive.GEAR_PROFILE.id, size: -5, hash: 'a'.repeat(64), chunks: [] }, async () => new Uint8Array()),
    /Unsupported chunk manifest/i,
  );
  await assert.rejects(
    () => Archive.restoreChunkManifest(
      { profile: Archive.GEAR_PROFILE.id, size: 10, hash: 'a'.repeat(64), chunks: [{ hash: 'a'.repeat(64), size: 5 }, { hash: 'b'.repeat(64), size: 5 }] },
      async () => new Uint8Array(5),
      { maxChunks: 1 },
    ),
    /budget/i,
  );

  // searchArchive clamps negative/NaN offset and limit.
  const cat = Archive.buildArchiveCatalog([
    { site: 'site-one', event: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 100 }, identifier: 'one', files: [] },
    { site: 'site-two', event: { id: 'c'.repeat(64), pubkey: 'b'.repeat(64), created_at: 200 }, identifier: 'two', files: [] },
  ]);
  const res = Archive.searchArchive(cat, { offset: -5, limit: 1 });
  assert.equal(res.total, 2);
  assert.equal(res.rows.length, 1);
});

test('Batch 3 Directory: prototype-pollution immunity, single bulkGroup revision & HTML metadata parsing', () => {
  const state = Directory.emptyState();
  Directory.patch(state, ['__proto__', 'constructor', 'site-1', 'site-2'], { title: 'Clean' });
  assert.equal(({}).title, undefined);
  assert.equal(Object.hasOwn(state.edits, '__proto__'), false);
  assert.equal(state.edits['site-1'].title, 'Clean');

  const beforeRev = state.revision;
  Directory.bulkGroup(state, ['site-1', 'site-2', 'site-3'], 'featured');
  assert.equal(state.revision, beforeRev + 1);

  const validatedWs = Directory.validateWorkspace(
    { ...Directory.emptyState(), live: { relays: ['http://not-wss.example', 'wss://relay.example:443/'] } },
    [],
  );
  assert.deepEqual(validatedWs.live.relays, ['wss://relay.example']);

  const html = `
    <html>
      <head>
        <meta content="Reversed &amp; &#x27;quoted&#x27; desc" name="description">
        <meta property="og:title" content="OG Fallback Title">
        <script>const x = "<h1>Ignored</h1>";</script >
      </head>
      <body><h1>Real Heading</h1></body>
    </html>
  `;
  const meta = Directory.htmlMetadata(html);
  assert.equal(meta.title, 'OG Fallback Title');
  assert.equal(meta.description, "Reversed & 'quoted' desc");
  assert.deepEqual(meta.headings, ['Real Heading']);
});

test('Batch 3 Moderation & Moji: safePubkeys not blocked, npub1/review filters, TLV relay guard & data:image guard', async () => {
  const badPub = '1'.repeat(64);
  const safePub = '2'.repeat(64);
  const parsed = Moderation.parseCuratorBlocklist(JSON.stringify({
    blockedPublishers: [badPub],
    safePubkeys: [safePub],
    media: ['https://cdn.example/bad.png', 'javascript:alert(1)'],
  }));
  assert.deepEqual(parsed.pubkeys, [badPub]);
  assert.equal(parsed.pubkeys.includes(safePub), false);
  assert.deepEqual(parsed.mediaUrls, ['https://cdn.example/bad.png']);

  const bannedNpub = Nostr.npubEncode(badPub);
  const ownPub = '3'.repeat(64);
  const filtered = Moderation.filterNsites([
    { id: 'banned', pubkey: badPub, title: 'Banned' },
    { id: 'own', pubkey: ownPub, title: 'My Site', description: 'Independent web researcher sharing resources https://t.me/demo' },
    { id: 'review-site', pubkey: '4'.repeat(64), title: 'Review', description: 'Curated guides and resources at https://promo.example' },
  ], {
    bannedPubkeys: [bannedNpub],
    ownPubkey: ownPub.toUpperCase(),
    hideSuspected: true,
  });
  assert.deepEqual(filtered.visible.map(s => s.id), ['own']);
  assert.equal(filtered.hidden.some(s => s.id === 'banned'), true);
  assert.equal(filtered.hidden.some(s => s.id === 'review-site'), true);

  // Compiled emoji policy
  const compiled = Moderation.compileEmojiPolicy({ bannedPubkeys: [badPub] });
  assert.equal(Moderation.isEmojiAllowed({ packAuthor: badPub }, compiled), false);
  assert.equal(Moderation.isEmojiAllowed({ packAuthor: safePub }, compiled), true);

  // Moji rejects non-image data: URLs while accepting data:image/*
  const imgHash = await Moji.extractEmojiHash('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(Core.isHex(imgHash, 64), true);
  await assert.rejects(() => Moji.extractEmojiHash('data:text/html,<script>alert(1)</script>'), /Invalid media scheme/);
  await assert.rejects(() => Moji.extractEmojiHash('javascript:alert(1)'), /Invalid media scheme/);
});

test('Batch 3 Anchor: deep secret scrubbing & outbox rejection of writeProbeAccepted === false', () => {
  const { pubkey } = makeLocalSigner();
  const backup = Anchor.buildPublicAccountBackup({
    session: { pubkey, mode: 'nip07', nsec: 'nsec1secretvalue' },
    profile: {
      name: 'Alice',
      about: 'Contact me via bunker://abc?secret=xyz or nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    },
    relays: [],
    blossomServers: [],
    follows: [],
    publications: [],
  });
  assert.equal(JSON.stringify(backup).includes('nsec1'), false);
  assert.equal(JSON.stringify(backup).includes('bunker://'), false);
  assert.equal(backup.records.profile.name, 'Alice');

  const outbox = Anchor.planVerifiedOutbox([
    { url: 'wss://good.example:443/', status: 'reachable', wsReachable: true, write: true, read: true, writeProbeAccepted: true },
    { url: 'wss://good.example', status: 'reachable', wsReachable: true, write: true, read: true, writeProbeAccepted: true },
    { url: 'wss://rejected.example', status: 'reachable', wsReachable: true, write: true, read: true, writeProbeAccepted: false },
  ], { max: 5 });
  assert.deepEqual(outbox.write, ['wss://good.example']);
  assert.equal(outbox.reviewed.find(r => r.url === 'wss://rejected.example').audit.status, 'exclude-write');
});

test('Batch 3 Intelligence: canonical URL auditCoverage, filtered preferences, content guards & :443 relay blocks', () => {
  assert.throws(() => Intelligence.classifyEventStorage(-1), RangeError);
  assert.throws(() => Intelligence.classifyEventStorage(70000), RangeError);
  assert.equal(Intelligence.classifyEventStorage(35128), 'addressable');

  const audit = Intelligence.auditCoverage([
    {
      id: 'pub-1',
      title: 'Note',
      category: 'post',
      eventId: 'a'.repeat(64),
      publishedRelays: ['wss://relay.example'],
      expectedRelays: ['wss://relay.example:443/'],
      assetHashes: ['d'.repeat(64)],
      assetLocations: { ['d'.repeat(64)]: ['https://blossom.example'] },
      expectedBlossomServers: ['https://blossom.example/'],
      deleted: false,
    },
  ]);
  assert.equal(audit.healthyCount, 1);
  assert.equal(audit.gaps[0].status, 'healthy');

  const prefs = Intelligence.reconstructPreferences({
    events: [{ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, created_at: 100, tags: [['t', '#Nostr']], content: '', sig: 'c'.repeat(128) }],
    profile: null,
    relays: [
      { url: 'wss://dead.example', status: 'unreachable', write: true, read: true },
      { url: 'wss://live.example:443/', status: 'reachable', write: true, read: true },
    ],
    blossomServers: [
      { url: 'https://down.example', status: 'unreachable' },
      { url: 'https://up.example/', status: 'healthy' },
    ],
  });
  assert.deepEqual(prefs.defaultWriteRelays.value, ['wss://live.example']);
  assert.deepEqual(prefs.defaultBlossomServers.value, ['https://up.example']);
  assert.deepEqual(prefs.defaultHashtags.value, ['nostr']);

  const badArticle = Intelligence.detectAndPrepareContent({
    submission: { assets: [], text: 'Hello', title: 'Article', explicitHint: 'article', externalImageUrl: 'javascript:alert(1)' },
    preferences: prefs,
    corrections: [],
    existingSites: [],
  });
  assert.equal(badArticle.validationIssues.some(w => w.code === 'INVALID_EXTERNAL_URL'), true);

  const badSite = Intelligence.detectAndPrepareContent({
    submission: {
      assets: [{ name: '../escape.html', path: '../escape.html', mimeType: 'text/html', size: 10, kind: 'html' }],
      text: '',
      explicitHint: 'nsite',
      targetSiteMode: 'named',
      targetSiteSlug: 'this-slug-is-way-too-long',
    },
    preferences: prefs,
    corrections: [],
    existingSites: [],
  });
  assert.equal(badSite.validationIssues.some(w => w.code === 'UNSAFE_ASSET_PATH'), true);
  assert.equal(badSite.validationIssues.some(w => w.code === 'INVALID_NSITE_SLUG'), true);

  const relayPlan = Intelligence.buildRelayOptimizationPlan({
    currentRelays: [{ url: 'wss://relay.damus.io:443/', status: 'unreachable', wsReachable: false, write: true, read: true, writeProbeAccepted: false }],
    candidateRelays: [{ url: 'wss://relay.damus.io', status: 'reachable', wsReachable: true, write: true, read: true, writeProbeAccepted: true }],
    followRelayCounts: { 'javascript:alert(1)': 10, 'http://bad.example': 5 },
  });
  assert.equal(relayPlan.recommendedWriteRelays.includes('wss://relay.damus.io'), false);
  assert.equal(relayPlan.discoveredCandidates.some(c => c.url.includes('javascript:') || c.url.includes('http://')), false);
});

test('Batch 3 Facade: createNsiteSDK multi-relay query deduplication and close() lifecycle', async () => {
  const { secret } = makeLocalSigner();
  const evOld = Nostr.finalizeEvent({ kind: 1, created_at: 100, content: 'old', tags: [] }, secret);
  const evNew = Nostr.finalizeEvent({ kind: 1, created_at: 200, content: 'new', tags: [] }, secret);

  const responsesByUrl = {
    'wss://r1.example': [evOld, evNew],
    'wss://r2.example': [evNew],
    'wss://r3.example': 'FAIL',
  };

  class MockRelaySocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      queueMicrotask(() => {
        if (responsesByUrl[url] === 'FAIL') {
          this.onerror?.(new Error('dial failed'));
          return;
        }
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'REQ') {
        const subId = msg[1];
        queueMicrotask(() => {
          for (const ev of responsesByUrl[this.url] || []) {
            this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
          }
          this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
        });
      }
    }
    close() { this.readyState = 3; }
  }

  let signerClosed = false;
  let storageClosed = false;
  const sdk = createNsiteSDK({
    relays: ['wss://r1.example', 'wss://r2.example', 'wss://r3.example'],
    Socket: MockRelaySocket,
    signer: {
      async getPublicKey() { return evNew.pubkey; },
      async signEvent(t) { return Nostr.finalizeEvent(t, secret); },
      async close() { signerClosed = true; },
    },
    storage: {
      async get() { return null; },
      async set() {},
      async delete() {},
      async keys() { return []; },
      async close() { storageClosed = true; },
    },
  });

  const events = await sdk.query({ kinds: [1] });
  assert.deepEqual(events.map(e => e.id), [evNew.id, evOld.id]);

  await sdk.close();
  assert.equal(signerClosed, true);
  assert.equal(storageClosed, true);
});
