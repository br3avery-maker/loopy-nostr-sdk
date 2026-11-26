import test from 'node:test';
import assert from 'node:assert/strict';
import { Anchor, Archive, Blossom, Core, Intelligence, Moderation, Nostr, Nsite } from '../src/index.js';

function makeKeypair() {
  const sk = Nostr.generateSecretKey();
  const pk = Nostr.getPublicKey(sk);
  const signer = {
    async getPublicKey() { return pk; },
    async signEvent(t) { return Nostr.finalizeEvent(t, sk); },
  };
  return { sk, pk, signer };
}

test('Batch 4 (#1b): parseCuratorBlocklist classifies 64-hex hashes inside media/hashes arrays as emojiHashes, not pubkeys', () => {
  const pubHex = 'a'.repeat(64);
  const hashHex = 'b'.repeat(64);
  const raw = JSON.stringify({
    pubkeys: [pubHex],
    media: [hashHex, 'https://cdn.example/bad.png'],
    hashes: ['c'.repeat(64)],
  });
  const parsed = Moderation.parseCuratorBlocklist(raw);
  assert.deepEqual(parsed.pubkeys, [pubHex]);
  assert.deepEqual([...parsed.emojiHashes].sort(), [hashHex, 'c'.repeat(64)]);
  assert.deepEqual(parsed.mediaUrls, ['https://cdn.example/bad.png']);
});

test('Batch 4 (#7c/d): restorePublicAccountBackup restores preferences and summarizePublicationReceipts deduplicates relays by highest stage', () => {
  const { pk } = makeKeypair();
  const backup = Anchor.buildPublicAccountBackup({
    session: { pubkey: pk, signerMode: 'nip07' },
    preferences: { defaultLicense: 'CC-BY-4.0', theme: 'light' },
    relays: [],
    blossomServers: [],
    follows: [],
    publications: [],
  });
  const restored = Anchor.restorePublicAccountBackup(backup);
  assert.deepEqual(restored.preferences, { defaultLicense: 'CC-BY-4.0', theme: 'light' });
  assert.equal(restored.signerConnected, false);

  const eventId = 'd'.repeat(64);
  const summary = Anchor.summarizePublicationReceipts([
    { relay: 'wss://Relay.Example/', eventId, accepted: true, readback: false },
    { relay: 'wss://relay.example', eventId, accepted: true, readback: true },
    { relay: 'wss://relay2.example', eventId, accepted: false, readback: false },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.retrieved, 1);
  assert.equal(summary.verified, true);
  assert.equal(summary.receipts.find(r => r.relay === 'wss://relay.example')?.eventId, eventId);
});

test('Batch 4 (#13b): detectAndPrepareContent blocks readyToPublish when tags contain pending Blossom placeholders', () => {
  const prefs = Intelligence.reconstructPreferences({
    events: [],
    profile: null,
    relays: [{ url: 'wss://relay.example', read: true, write: true }],
    blossomServers: [{ url: 'https://blossom.example' }],
  });
  const draft = Intelligence.detectAndPrepareContent({
    submission: {
      text: 'New gallery photo',
      assets: [
        {
          id: 'img-1',
          name: 'photo.png',
          mimeType: 'image/png',
          size: 4096,
          // Deliberately omit sha256 so engine emits blossom.pending / pending-sha256 placeholder
        },
      ],
    },
    preferences: prefs,
    corrections: [],
    existingSites: [],
  });
  assert.equal(draft.readyToPublish, false);
  assert.ok(draft.validationIssues.some(i => i.level === 'error' && i.code === 'PENDING_BLOB_UPLOAD'));
});

test('Batch 4 (#17a): resolveNsiteManifest returns not-found when one bootstrap fails but another resolves kind 10002 and manifest targets succeed cleanly', async () => {
  const { sk, pk } = makeKeypair();
  const relayListEv = Nostr.finalizeEvent(
    Nostr.eventTemplate({
      kind: 10002,
      created_at: 1_700_000_000,
      tags: [['r', 'wss://author-write.example', 'write']],
      content: '',
    }),
    sk
  );

  const res = await Nsite.resolveNsiteManifest(pk, {
    bootstrap: ['wss://dead-boot.example', 'wss://good-boot.example'],
    mode: 'refresh',
    now: 1_700_000_010,
    query: async (relay, filter) => {
      if (relay === 'wss://dead-boot.example') throw new Error('bootstrap offline');
      if (relay === 'wss://good-boot.example' && filter.kinds?.includes(10002)) return [relayListEv];
      if (relay === 'wss://author-write.example') return [];
      return [];
    },
  });
  assert.equal(res.status, 'not-found');
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].relay, 'wss://dead-boot.example');
});

test('Batch 4 (#25b): buildArchiveCatalog deduplicates identical event IDs before counting site versions', async () => {
  const { sk } = makeKeypair();
  const prepared = await Nsite.prepareManifestFiles({ 'index.html': '<h1>v1</h1>' });
  const ev = Nostr.finalizeEvent(
    Nsite.manifestTemplate(prepared, { identifier: 'demo', server: 'https://blossom.example', created_at: 1_700_000_100 }),
    sk
  );
  const manifest = await Nsite.parseManifest(ev, { now: 1_700_000_200 });
  const catalog = Archive.buildArchiveCatalog([
    { site: 'demo', event: ev, files: manifest.files },
    { site: 'demo', event: ev, files: manifest.files },
  ]);
  assert.equal(catalog.sites.length, 1);
  assert.equal(catalog.sites[0].versions, 1);
});

test('Batch 4 (#23): verifyBlobCopies preserves granular failure codes, supports image/vnd.microsoft.icon alias, and bounded concurrency', async () => {
  const iconBytes = new Uint8Array([0, 0, 1, 0, 1, 0]);
  const iconHash = await Core.sha256(iconBytes);
  const meta = { sha256: iconHash, size: iconBytes.length, type: 'image/x-icon' };

  const fetcher = async url => {
    if (url.startsWith('https://good.example/')) {
      return {
        ok: true,
        status: 200,
        redirected: false,
        headers: new Headers({ 'content-type': 'image/vnd.microsoft.icon' }),
        arrayBuffer: async () => iconBytes.buffer.slice(0),
      };
    }
    if (url.startsWith('https://missing.example/')) {
      return { ok: false, status: 404, redirected: false, headers: new Headers() };
    }
    if (url.startsWith('https://wrongmime.example/')) {
      return {
        ok: true,
        status: 200,
        redirected: false,
        headers: new Headers({ 'content-type': 'text/plain' }),
        arrayBuffer: async () => iconBytes.buffer.slice(0),
      };
    }
    if (url.startsWith('https://redir.example/')) {
      return { ok: true, status: 200, redirected: true, headers: new Headers({ 'content-type': 'image/x-icon' }) };
    }
    if (url.startsWith('https://badhash.example/')) {
      return {
        ok: true,
        status: 200,
        redirected: false,
        headers: new Headers({ 'content-type': 'image/x-icon' }),
        arrayBuffer: async () => new Uint8Array([9, 9, 9, 9, 9, 9]).buffer,
      };
    }
    throw new Error('network down');
  };

  const res = await Blossom.verifyBlobCopies(meta, {
    servers: [
      'https://good.example',
      'https://missing.example',
      'https://wrongmime.example',
      'https://redir.example',
      'https://badhash.example',
    ],
    required: 1,
    concurrency: 3,
    fetcher,
  });
  assert.equal(res.status, 'verified');
  assert.equal(res.copies.length, 1);
  assert.equal(res.copies[0].server, 'https://good.example');
  const codes = Object.fromEntries(res.failed.map(f => [f.server, f.code]));
  assert.equal(codes['https://missing.example'], 'not-found');
  assert.equal(codes['https://wrongmime.example'], 'mime-mismatch');
  assert.equal(codes['https://redir.example'], 'redirect');
  assert.equal(codes['https://badhash.example'], 'hash-mismatch');
});

test('Batch 4 (#24 + v2.5): planNsitePublication surfaces mimeConflicts only when present, and publishNsite deduplicates uploads, supports preflight/batchAuth/gatewayConcurrency/onProgress', async () => {
  const { pk, signer } = makeKeypair();
  const shared = '<h1>Same Page</h1>';
  // Clean site: no mimeConflicts property
  const cleanPlan = await Nsite.planNsitePublication(
    { 'index.html': shared, '404.html': shared },
    {
      pubkey: pk,
      server: 'https://a.example',
      storageServers: ['https://a.example', 'https://b.example'],
      requiredCopies: 2,
      relays: ['wss://relay.example'],
      gateway: 'nsite.lol',
      created_at: 1_700_000_500,
      clock: () => 1_700_000_500,
    }
  );
  assert.equal(Object.hasOwn(cleanPlan, 'mimeConflicts'), false);

  // Conflicting MIME site: identical bytes at .html and .txt
  const conflictPlan = await Nsite.planNsitePublication(
    { 'index.html': shared, 'copy.txt': shared },
    {
      pubkey: pk,
      server: 'https://a.example',
      storageServers: ['https://a.example'],
      requiredCopies: 1,
      relays: ['wss://relay.example'],
      created_at: 1_700_000_500,
      clock: () => 1_700_000_500,
    }
  );
  assert.equal(conflictPlan.mimeConflicts?.length, 1);
  assert.deepEqual(conflictPlan.mimeConflicts[0].types, ['text/html', 'text/plain']);

  // Exercise v2.5: deduplication + preflight + batchAuth + gatewayConcurrency + onProgress
  const store = new Map();
  let headCalls = 0;
  let putCalls = 0;
  let signedAuthEvents = 0;
  const countingSigner = {
    getPublicKey: () => signer.getPublicKey(),
    async signEvent(tmpl) {
      if (tmpl.kind === 24242) signedAuthEvents += 1;
      return signer.signEvent(tmpl);
    },
  };

  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (init.method === 'HEAD' && u.pathname === '/upload') {
      headCalls += 1;
      return { ok: true, status: 200, headers: new Headers() };
    }
    if (init.method === 'PUT' && u.pathname === '/upload') {
      putCalls += 1;
      const body = new Uint8Array(init.body);
      const hash = await Core.sha256(body);
      store.set(`${u.origin}/${hash}`, { data: body, type: init.headers['Content-Type'] });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => Core.encode(JSON.stringify({ sha256: hash, size: body.length })).buffer,
      };
    }
    if (u.hostname.endsWith('.nsite.lol')) {
      const body = Core.encode(shared);
      return {
        ok: true,
        status: 200,
        redirected: false,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => body.buffer.slice(0),
      };
    }
    const found = store.get(url);
    if (!found) return { ok: false, status: 404, redirected: false, headers: new Headers() };
    return {
      ok: true,
      status: 200,
      redirected: false,
      headers: new Headers({ 'content-type': found.type }),
      arrayBuffer: async () => found.data.buffer.slice(0),
    };
  };

  const progress = [];
  const result = await Nsite.publishNsite(
    { 'index.html': shared, '404.html': shared },
    {
      pubkey: pk,
      signer: countingSigner,
      server: 'https://a.example',
      storageServers: ['https://a.example', 'https://b.example'],
      requiredCopies: 2,
      relays: ['wss://relay.example'],
      gateway: 'nsite.lol',
      created_at: 1_700_000_500,
      clock: () => 1_700_000_500,
      approvedPlan: cleanPlan.id,
      resolveCurrent: async () => null,
      fetcher,
      preflight: true,
      batchAuth: true,
      gatewayTimeoutMs: 15000,
      gatewayConcurrency: 2,
      onProgress: ev => progress.push(ev),
      publisher: async (event, relays) => ({
        status: 'partially-verified',
        verified: relays.map(relay => ({ relay, eventId: event.id, accepted: true, readback: true })),
        failed: [],
      }),
    }
  );

  // Only 1 unique SHA-256 across 2 files -> uploaded once per server (2 PUTs total, not 4!)
  assert.equal(putCalls, 2);
  assert.equal(headCalls, 2);
  assert.equal(signedAuthEvents, 2);
  assert.equal(result.job.files.length, 2);
  assert.equal(result.job.stage, 'site-verified');
  assert.ok(progress.some(p => p.stage === 'uploading' && p.deduplicated === true));
  assert.ok(progress.some(p => p.stage === 'gateway'));
});
