import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createNsiteSDK,
  Core,
  Nostr,
  Nsite,
  Moderation,
  Intelligence,
  Storage,
} from '../src/index.js';
import { createMockBlossom, createMockRelay, createTestSigner } from '../src/testing/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Big Job 1: shared Core media helpers and Nostr NIP-19 codecs are unified with zero cycles', () => {
  assert.equal(Nsite.mediaType, Core.mediaType);
  assert.equal(Core.mediaType('/site/app.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(Core.baseMediaType('text/html; charset=utf-8'), 'text/html');
  assert.equal(Core.contentTypeMatches('application/javascript', 'text/javascript; charset=utf-8'), true);
  assert.equal(Core.contentTypeMatches('image/x-icon', 'image/vnd.microsoft.icon'), true);
  assert.equal(Core.contentTypeMatches('text/html', 'application/json'), false);

  assert.equal(Nostr.decodeNip19, Moderation.decodeNip19);
  assert.equal(Nostr.noteEncode, Moderation.noteEncode);
  assert.equal(Nostr.nprofileEncode, Moderation.nprofileEncode);
  assert.equal(Nostr.neventEncode, Moderation.neventEncode);
  assert.equal(Nostr.naddrEncode, Moderation.naddrEncode);

  const out = execFileSync('python3', ['validation/verify_repo_audit.py'], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.status, 'PASS');
  assert.equal(parsed.layer_dag, 'acyclic');
});

test('Big Job 2: createNsiteSDK({ pool }) reuses a single pooled WebSocket and honors closePool option', async () => {
  const signer = createTestSigner();
  const relay = createMockRelay({ url: 'wss://pool-sdk.example.net' });
  const note1 = await Nostr.checkedSign(signer, Nostr.textNote('first pooled note', { created_at: 1764100001 }), signer.pubkey);
  const note2 = await Nostr.checkedSign(signer, Nostr.textNote('second pooled note', { created_at: 1764100002 }), signer.pubkey);
  relay.pushEvent(note1);
  relay.pushEvent(note2);

  const pool = Nostr.createRelayPool({ Socket: relay.Socket });
  const sdk = createNsiteSDK({ relays: [relay.url], pool });

  const first = await sdk.query({ authors: [signer.pubkey], kinds: [1] });
  const second = await sdk.query({ ids: [note1.id] });
  assert.equal(first.length, 2);
  assert.equal(first[0].id, note2.id);
  assert.equal(second.length, 1);
  assert.equal(second[0].id, note1.id);
  // Both queries reused the single pooled connection
  assert.equal(relay.connections.length, 1);

  // Closing SDK with closePool: false leaves the external pool usable
  await sdk.close({ closePool: false });
  assert.equal(pool.relays().length, 1);
  const third = await pool.query([relay.url], { ids: [note2.id] });
  assert.equal(third.events.length, 1);

  // Default close() closes the pool too
  const sdk2 = createNsiteSDK({ relays: [relay.url], pool });
  await sdk2.close();
  assert.equal(pool.relays().length, 0);

  // Invalid pool rejected up front
  assert.throws(() => createNsiteSDK({ pool: {} }), TypeError);
});

test('Big Job 3: decomposed Intelligence modules normalize partial and empty inputs without crashing', () => {
  const minimalEcosystem = Intelligence.analyzeAccountEcosystem({ pubkey: 'a'.repeat(64) });
  assert.equal(typeof minimalEcosystem.overallScore, 'number');
  assert.ok(Array.isArray(minimalEcosystem.clientMatrix));
  assert.ok(Array.isArray(minimalEcosystem.recommendations));
  assert.equal(minimalEcosystem.outboxDiagnosis.writeRelayCount, 0);

  const emptyEcosystem = Intelligence.analyzeAccountEcosystem();
  assert.equal(typeof emptyEcosystem.overallScore, 'number');

  const partialSingle = Intelligence.auditSinglePublication({
    pub: { id: 'p1', kind: 1, content: 'hello partial input' },
  });
  assert.equal(partialSingle.publicationId, 'p1');
  assert.equal(partialSingle.kind, 1);
  assert.ok(partialSingle.formatScore >= 0 && partialSingle.formatScore <= 100);

  const partialPrefs = Intelligence.reconstructPreferences({});
  assert.equal(partialPrefs.artistOrAuthorName.provenance, 'unknown');
  assert.equal(partialPrefs.defaultWriteRelays.provenance, 'unknown');

  const partialDraft = Intelligence.detectAndPrepareContent({ submission: { text: 'Quick note' } });
  assert.equal(partialDraft.kind, 1);
  assert.equal(partialDraft.detectedCategory, 'post');

  const partialCoverage = Intelligence.auditCoverage([{ id: 'pub-1', title: 'Minimal' }]);
  assert.equal(partialCoverage.totalActivePublications, 1);
  assert.equal(partialCoverage.healthyCount, 1);

  const partialActivity = Intelligence.summarizeObservedActivity();
  assert.equal(partialActivity.totalObserved, 0);
});

test('Big Job 4: docs/API_REFERENCE.md stays synced and all 4 new offline examples exit cleanly', () => {
  const checkOut = execFileSync('python3', ['scripts/sync_docs.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(JSON.parse(checkOut).status, 'PASS');

  for (const ex of [
    'examples/relay-pool-store.js',
    'examples/blossom-replica-repair.js',
    'examples/giftwrap-dm.js',
    'examples/v2-resumable-publish.js',
  ]) {
    const out = execFileSync(process.execPath, [ex], { cwd: ROOT, encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.ok(parsed.state.startsWith('OFFLINE_EXAMPLE_'));
  }
});

test('Big Job 5: TypeScript declarations contain zero any types and match all runtime symbols', () => {
  const typesDir = path.join(ROOT, 'types');
  const dtsFiles = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.d.ts')) dtsFiles.push(full);
    }
  };
  walk(typesDir);
  assert.ok(dtsFiles.length >= 14);
  for (const file of dtsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    // Strip block and line comments before checking for `any` type tokens
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/\bany\b/.test(stripped), false, `Found \`any\` type in ${path.relative(ROOT, file)}`);
  }

  const syncOut = execFileSync('python3', ['scripts/sync_manifest.py', '--check'], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(syncOut);
  assert.equal(parsed.status, 'PASS');
  assert.equal(parsed.errors.length, 0);
});

test('Big Job 6: EventStore { verify: false } supports pre-verified replaceable/addressable events without Schnorr re-check', async () => {
  const store = Nostr.createEventStore(Storage.memoryStore());
  const pubkey = 'b'.repeat(64);
  const older = {
    id: '1'.repeat(64),
    pubkey,
    created_at: 1764100100,
    kind: 30023,
    tags: [['d', 'article-1']],
    content: 'v1',
    sig: '0'.repeat(128), // intentionally fake signature to prove verify: false skips Schnorr check
  };
  const newer = {
    id: '2'.repeat(64),
    pubkey,
    created_at: 1764100200,
    kind: 30023,
    tags: [['d', 'article-1']],
    content: 'v2',
    sig: '0'.repeat(128),
  };

  // Default verify: true still rejects fake signatures
  await assert.rejects(() => store.put(older), /Invalid Nostr event/i);

  const r1 = await store.put(older, { verify: false });
  assert.equal(r1.stored, true);
  const r2 = await store.put(newer, { verify: false });
  assert.equal(r2.stored, true);
  assert.equal(r2.replacedId, older.id);

  const results = await store.query({ authors: [pubkey], kinds: [30023] });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, newer.id);
});

test('Big Job 6: Nsite.createRelayRevisionResolver integrates with v2 publishNsite for initial and baseline updates', async () => {
  const signer = createTestSigner();
  const relay = createMockRelay({ url: 'wss://resolver.example.net' });
  const blossom = createMockBlossom({
    servers: ['https://blossom-x.example.net', 'https://blossom-y.example.net'],
  });
  const pool = Nostr.createRelayPool({ Socket: relay.Socket });
  const resolveCurrent = Nsite.createRelayRevisionResolver({ pool, relays: [relay.url] });

  // Initial state: not-found -> null
  assert.equal(await resolveCurrent({ pubkey: signer.pubkey, identifier: 'demo' }), null);

  // Initial v2 publish
  const v1Files = { 'index.html': '<h1>v1</h1>' };
  const v1Opts = {
    pubkey: signer.pubkey,
    server: blossom.servers[0],
    storageServers: blossom.servers,
    requiredCopies: 2,
    relays: [relay.url],
    identifier: 'demo',
    created_at: 1764100300,
  };
  const plan1 = await Nsite.planNsitePublication(v1Files, v1Opts);
  const pub1 = await Nsite.publishNsite(v1Files, {
    ...v1Opts,
    signer,
    approvedPlan: plan1.id,
    resolveCurrent,
    fetcher: blossom.fetcher,
    Socket: relay.Socket,
  });
  assert.equal(pub1.job.stage, 'relay-verified');

  // Resolver now returns the verified live v1 manifest event
  const current = await resolveCurrent({ pubkey: signer.pubkey, identifier: 'demo' });
  assert.equal(current?.id, pub1.event.id);

  // Subsequent v2 update with observed baseline succeeds
  const v2Files = { 'index.html': '<h1>v2</h1>' };
  const v2Opts = {
    ...v1Opts,
    baseline: current,
    created_at: 1764100400,
  };
  const plan2 = await Nsite.planNsitePublication(v2Files, v2Opts);
  const pub2 = await Nsite.publishNsite(v2Files, {
    ...v2Opts,
    signer,
    approvedPlan: plan2.id,
    resolveCurrent,
    fetcher: blossom.fetcher,
    Socket: relay.Socket,
  });
  assert.equal(pub2.job.stage, 'relay-verified');
  assert.notEqual(pub2.event.id, pub1.event.id);

  // Unreachable relay fails closed (throws instead of returning null)
  const failingResolver = Nsite.createRelayRevisionResolver({
    relays: [relay.url],
    query: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(
    () => failingResolver({ pubkey: signer.pubkey, identifier: 'demo' }),
    /Unable to verify current nsite revision/
  );

  pool.close();
});
