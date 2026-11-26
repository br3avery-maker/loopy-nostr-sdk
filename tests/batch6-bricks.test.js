import test from 'node:test';
import assert from 'node:assert/strict';
import { Core, Nostr, Nsite, Blossom, Archive, Storage, Testing } from '../src/index.js';
import {
  createTestSigner,
  createMockRelay,
  createMockBlossom,
  withStrictBrowserFetch,
} from '../src/testing/index.js';

test('Blossom.uploadVerified single-GET SHA-256 + MIME verification and publishResumable deduplication', async () => {
  const signer = createTestSigner();
  const mockBlossom = createMockBlossom({ servers: ['https://cdn.example'] });
  const mockRelay = createMockRelay({ url: 'wss://relay.example' });

  // Direct uploadVerified with verifyContentType: true verifies hash + MIME in one GET
  const uploaded = await Blossom.uploadVerified('<h1>Hello</h1>', {
    server: 'https://cdn.example',
    signer,
    pubkey: signer.pubkey,
    path: 'index.html',
    verifyContentType: true,
    fetcher: mockBlossom.fetcher,
    clock: () => 1700000000,
  });
  assert.equal(uploaded.verified, true);
  assert.equal(uploaded.typeVerified, true);
  assert.equal(uploaded.type, 'text/html');
  const getCountSingle = mockBlossom.requests.filter(r => r.method === 'GET').length;
  assert.equal(getCountSingle, 1);

  // MIME mismatch is rejected with code: 'mime-mismatch'
  await assert.rejects(
    () =>
      Blossom.uploadVerified('console.log(1)', {
        server: 'https://cdn.example',
        signer,
        pubkey: signer.pubkey,
        path: 'app.js',
        expectedType: 'text/javascript',
        verifyContentType: true,
        fetcher: async (url, init) => {
          const res = await mockBlossom.fetcher(url, init);
          if (!init?.method || init.method === 'GET') {
            return { ...res, headers: new Headers({ 'content-type': 'text/plain' }) };
          }
          return res;
        },
        clock: () => 1700000000,
      }),
    err => err.code === 'mime-mismatch'
  );

  // Full publishNsite v2 uses default uploadVerified and performs ONLY:
  // 1 initial check GET (404) + 1 PUT + 1 readback GET (NOT 2 post-upload GETs)
  mockBlossom.clear();
  const files = { 'index.html': '<!doctype html><title>Single GET</title>' };
  const plan = await Nsite.planNsitePublication(files, {
    pubkey: signer.pubkey,
    server: 'https://cdn.example',
    storageServers: ['https://cdn.example'],
    requiredCopies: 1,
    relays: [mockRelay.url],
    created_at: 1700000000,
    clock: () => 1700000000,
  });

  const published = await Nsite.publishNsite(files, {
    signer,
    pubkey: signer.pubkey,
    server: 'https://cdn.example',
    storageServers: ['https://cdn.example'],
    requiredCopies: 1,
    relays: [mockRelay.url],
    created_at: 1700000000,
    clock: () => 1700000000,
    approvedPlan: plan.id,
    resolveCurrent: async () => null,
    fetcher: mockBlossom.fetcher,
    Socket: mockRelay.Socket,
  });

  assert.equal(published.job.stage, 'relay-verified');
  assert.equal(published.job.files[0].copies.length, 1);
  assert.equal(published.job.files[0].attempts[0].status, 'hash-verified');
  // 1 prior check GET (404) + 1 uploadVerified readback GET (200) = 2 GETs total (no redundant 3rd GET)
  const getReqs = mockBlossom.requests.filter(r => r.method === 'GET');
  assert.equal(getReqs.length, 2);
});

test('Nostr.createRelayHealthCache persists observations, NIP-11 policies, and NIP-66 monitors with TTL pruning and composes with planRelayDelivery', async () => {
  const storage = Storage.memoryStore();
  const cache = Nostr.createRelayHealthCache(storage, {
    observationTtl: 600,
    policyTtl: 3600,
    monitorTtl: 600,
  });
  const author = createTestSigner();
  const monitor = createTestSigner();
  const now = 1700005000;

  const note = await author.signEvent(Nostr.eventTemplate({ kind: 1, content: 'hello', created_at: now }));

  // Record one fresh failure and one stale observation
  await cache.recordObservations(
    [
      {
        relay: 'wss://bad.example/',
        eventId: note.id,
        author: author.pubkey,
        kind: 1,
        principal: author.pubkey,
        at: now - 30,
        code: 'rate-limited',
        accepted: false,
        readback: false,
      },
      {
        relay: 'wss://old.example/',
        eventId: note.id,
        author: author.pubkey,
        kind: 1,
        principal: author.pubkey,
        at: now - 5000,
        code: 'timeout',
        accepted: false,
        readback: false,
      },
    ],
    { now }
  );

  // Save NIP-11 policy forbidding large frames on tiny.example
  await cache.savePolicy(
    'wss://tiny.example',
    { limitation: { max_message_length: 10 } },
    { observedAt: now - 10, now }
  );

  // Save verified NIP-66 kind 30166 monitor report endorsing good.example for kind 1
  const monitorEvent = await monitor.signEvent(
    Nostr.eventTemplate({
      kind: 30166,
      created_at: now - 20,
      tags: [
        ['d', 'wss://good.example'],
        ['k', '1'],
      ],
      content: '',
    })
  );
  await cache.saveMonitorEvent(monitorEvent, { now });

  const exported = await cache.exportForDelivery({ now });
  assert.equal(exported.observations.length, 1);
  assert.equal(exported.relayPolicies.length, 1);
  assert.equal(exported.monitorEvents.length, 1);

  const plan = Nostr.planRelayDelivery(note, {
    defaults: ['wss://bad.example', 'wss://tiny.example', 'wss://good.example'],
    authPubkey: author.pubkey,
    authAvailable: true,
    now,
    ...exported,
  });

  const selected = plan.groups[0].selected.map(c => c.relay);
  assert.deepEqual(selected, ['wss://good.example']);
  const excludedRelays = plan.excluded.map(e => e.relay).sort();
  assert.deepEqual(excludedRelays, ['wss://bad.example', 'wss://tiny.example']);

  // After TTL expires, observations & monitors prune cleanly
  const later = await cache.exportForDelivery({ now: now + 700 });
  assert.equal(later.observations.length, 0);
  assert.equal(later.monitorEvents.length, 0);
  assert.equal(later.relayPolicies.length, 1);
  await cache.clear();
  assert.equal((await cache.getPolicies({ now })).length, 0);
});

test('Nostr NIP-17 / NIP-59 rumorTemplate, sealTemplate, giftWrapEvent, and unwrapGiftWrap round-trip with anti-spoofing', async () => {
  const alice = createTestSigner();
  const bob = createTestSigner();
  const mallory = createTestSigner();
  const now = 1700010000;

  const rumor = await Nostr.rumorTemplate({
    pubkey: alice.pubkey,
    kind: 14,
    content: 'Secret rendezvous at dawn',
    tags: [['p', bob.pubkey]],
    created_at: now,
  });
  assert.equal(rumor.kind, 14);
  assert.equal('sig' in rumor, false);
  assert.equal(Core.isHex(rumor.id, 64), true);

  const sealUnsigned = await Nostr.sealTemplate(rumor, {
    recipientPubkey: bob.pubkey,
    encryptor: Nostr.encryptionAdapter(alice),
    created_at: now,
    jitterSeconds: 120,
  });
  assert.equal(sealUnsigned.kind, 13);
  assert.deepEqual(sealUnsigned.tags, []);
  assert.ok(sealUnsigned.created_at <= now && sealUnsigned.created_at >= now - 120);

  const sealSigned = await alice.signEvent(sealUnsigned);
  const { event: wrap, ephemeralPubkey } = await Nostr.giftWrapEvent(sealSigned, {
    recipientPubkey: bob.pubkey,
    encryptorForEphemeral: secretKey => createTestSigner({ secretKey }).nip44,
    created_at: now,
    jitterSeconds: 300,
  });
  assert.equal(wrap.kind, 1059);
  assert.equal(wrap.pubkey, ephemeralPubkey);
  assert.notEqual(wrap.pubkey, alice.pubkey);
  assert.deepEqual(wrap.tags, [['p', bob.pubkey]]);

  // Verify gift wrap integrates directly with planRelayDelivery kind 10050 inbox routing
  const bobInbox = await bob.signEvent(
    Nostr.eventTemplate({ kind: 10050, created_at: now, tags: [['relay', 'wss://dm-inbox.example']], content: '' })
  );
  const deliveryPlan = Nostr.planRelayDelivery(wrap, { signedLists: [bobInbox], now });
  assert.equal(deliveryPlan.visibility, 'private');
  assert.equal(deliveryPlan.groups[0].selected[0].relay, 'wss://dm-inbox.example');

  // Bob unwraps cleanly
  const unwrapped = await Nostr.unwrapGiftWrap(wrap, {
    recipientPubkey: bob.pubkey,
    decryptor: Nostr.encryptionAdapter(bob),
  });
  assert.equal(unwrapped.seal.pubkey, alice.pubkey);
  assert.equal(unwrapped.rumor.pubkey, alice.pubkey);
  assert.equal(unwrapped.rumor.content, 'Secret rendezvous at dawn');
  assert.equal(unwrapped.rumor.id, rumor.id);

  // Anti-spoofing: Mallory seals Alice's rumor -> unwrap MUST reject!
  const spoofedSeal = await mallory.signEvent(
    await Nostr.sealTemplate(rumor, {
      recipientPubkey: bob.pubkey,
      encryptor: Nostr.encryptionAdapter(mallory),
      created_at: now,
    })
  );
  const { event: spoofedWrap } = await Nostr.giftWrapEvent(spoofedSeal, {
    recipientPubkey: bob.pubkey,
    encryptorForEphemeral: secretKey => createTestSigner({ secretKey }).nip44,
    created_at: now,
  });
  await assert.rejects(
    () =>
      Nostr.unwrapGiftWrap(spoofedWrap, {
        recipientPubkey: bob.pubkey,
        decryptor: Nostr.encryptionAdapter(bob),
      }),
    /Rumor pubkey does not match verified seal author/
  );
});

test('Nsite static-site ergonomics: checkPortablePaths, emptyFiles skip mode, and strictPortablePaths', async () => {
  const signer = createTestSigner();

  // Portable paths pass cleanly
  const clean = Nsite.checkPortablePaths(['index.html', 'assets/app.js', 'docs/guide.md']);
  assert.equal(clean.ok, true);
  assert.equal(clean.issues.length, 0);

  // Case collision, NFC/NFD collision, Windows reserved name, trailing dot, illegal char
  const cafeNfc = 'docs/caf\u00e9.html';
  const cafeNfd = 'docs/cafe\u0301.html';
  const report = Nsite.checkPortablePaths([
    'Readme.md',
    'readme.md',
    cafeNfc,
    cafeNfd,
    'sub/CON.txt',
    'sub/bad:name.html',
    'sub/trailing.',
  ]);
  assert.equal(report.ok, false);
  const codes = new Set(report.issues.map(i => i.code));
  assert.ok(codes.has('case-collision'));
  assert.ok(codes.has('unicode-normalization-collision'));
  assert.ok(codes.has('windows-reserved'));
  assert.ok(codes.has('windows-illegal-char'));
  assert.ok(codes.has('trailing-dot-or-space'));

  // prepareManifestFiles defaults to rejecting empty files; emptyFiles: 'skip' omits and reports them
  const filesWithEmpty = {
    'index.html': '<h1>Hi</h1>',
    '.nojekyll': '',
    'empty.txt': new Uint8Array(0),
  };
  await assert.rejects(() => Nsite.prepareManifestFiles(filesWithEmpty), /Empty file/);
  const prepared = await Nsite.prepareManifestFiles(filesWithEmpty, { emptyFiles: 'skip' });
  assert.equal(prepared.entries.length, 1);
  assert.deepEqual(prepared.skippedEmpty, ['/.nojekyll', '/empty.txt']);

  // planNsitePublication threads emptyFiles and strictPortablePaths
  const plan = await Nsite.planNsitePublication(filesWithEmpty, {
    pubkey: signer.pubkey,
    server: 'https://cdn.example',
    relays: ['wss://relay.example'],
    created_at: 1700000000,
    clock: () => 1700000000,
    emptyFiles: 'skip',
  });
  assert.deepEqual(plan.skippedEmpty, ['/.nojekyll', '/empty.txt']);
  assert.equal('portabilityIssues' in plan, false);

  // strictPortablePaths rejects collisions before planning completes
  await assert.rejects(
    () =>
      Nsite.planNsitePublication(
        { 'Index.html': '<h1>A</h1>', 'index.html': '<h1>B</h1>' },
        {
          pubkey: signer.pubkey,
          server: 'https://cdn.example',
          relays: ['wss://relay.example'],
          created_at: 1700000000,
          clock: () => 1700000000,
          strictPortablePaths: true,
        }
      ),
    /Non-portable nsite paths/
  );
});

test('Archive.writeZipAsync compresses compressible payloads with DEFLATE and round-trips through Archive.readZip', async () => {
  const repeated = 'Hello compressed nsite archive! '.repeat(200);
  const tiny = 'ok';
  const files = {
    'index.html': repeated,
    'tiny.txt': tiny,
  };

  const stored = Archive.writeZip(files);
  const compressed = await Archive.writeZipAsync(files);
  assert.ok(compressed.byteLength < stored.byteLength, 'DEFLATE archive should be smaller than stored archive');

  const extracted = await Archive.readZip(compressed);
  assert.equal(Core.decode(extracted['index.html']), repeated);
  assert.equal(Core.decode(extracted['tiny.txt']), tiny);

  // compress: false produces byte-identical output to synchronous writeZip
  const uncompressed = await Archive.writeZipAsync(files, { compress: false });
  assert.deepEqual(uncompressed, stored);
});

test('Core.createAccountSession isolates storage, aborts signal, and runs cleanups in LIFO order', async () => {
  const shared = Storage.memoryStore();
  const alice = createTestSigner();
  const bob = createTestSigner();
  const order = [];
  let invalidatedInfo = null;

  const sessionA = Core.createAccountSession({
    pubkey: alice.pubkey,
    storage: shared,
    onInvalidate: info => {
      invalidatedInfo = info;
    },
  });
  const sessionB = Core.createAccountSession({ pubkey: bob.pubkey, storage: shared });

  await sessionA.storage.set('draft', 'alice-secret-draft');
  await sessionB.storage.set('draft', 'bob-draft');
  assert.equal(await sessionA.storage.get('draft'), 'alice-secret-draft');
  assert.equal(await sessionB.storage.get('draft'), 'bob-draft');
  assert.deepEqual(await sessionA.storage.keys(), ['draft']);

  sessionA.register(() => order.push('first'));
  sessionA.register(() => order.push('second'));
  const unregisterThird = sessionA.register(() => order.push('third'));
  unregisterThird();

  sessionA.assertActive();
  await sessionA.invalidate('account-switch');
  assert.equal(sessionA.aborted, true);
  assert.equal(sessionA.closed, true);
  assert.equal(sessionA.signal.aborted, true);
  assert.deepEqual(order, ['second', 'first']);
  assert.deepEqual(invalidatedInfo, { pubkey: alice.pubkey, reason: 'account-switch' });
  assert.throws(() => sessionA.assertActive(), /Account session invalidated: account-switch/);
  // Idempotent second close does not re-run cleanups
  await sessionA.close();
  assert.deepEqual(order, ['second', 'first']);
});

test('Core.migrateSchema walks multi-step migrations, validates output, and rejects cycles', () => {
  const migrations = {
    'doc/1': doc => ({ ...doc, schema: 'doc/2', count: Number(doc.count || 0) }),
    'doc/2': doc => ({ ...doc, schema: 'doc/3', versioned: true }),
  };

  const migrated = Core.migrateSchema(
    { schema: 'doc/1', count: '42' },
    {
      targetSchema: 'doc/3',
      migrations,
      validate: doc => {
        if (typeof doc.count !== 'number') throw new Error('count must be number');
      },
    }
  );
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.from, 'doc/1');
  assert.equal(migrated.to, 'doc/3');
  assert.deepEqual(migrated.steps, [
    { from: 'doc/1', to: 'doc/2' },
    { from: 'doc/2', to: 'doc/3' },
  ]);
  assert.deepEqual(migrated.data, { schema: 'doc/3', count: 42, versioned: true });

  // Already at target schema -> migrated: false
  const noop = Core.migrateSchema({ schema: 'doc/3', count: 1 }, { targetSchema: 'doc/3', migrations });
  assert.equal(noop.migrated, false);
  assert.equal(noop.steps.length, 0);

  // Cycle protection
  assert.throws(
    () =>
      Core.migrateSchema(
        { schema: 'a/1' },
        {
          targetSchema: 'a/3',
          migrations: {
            'a/1': d => ({ ...d, schema: 'a/2' }),
            'a/2': d => ({ ...d, schema: 'a/1' }),
          },
        }
      ),
    /Cyclic schema migration/
  );
});

test('Nostr.createBunkerSessionDescriptor and restoreBunkerSigner persist secret-free metadata and restore via vault callback', async () => {
  const clientSecret = Nostr.generateSecretKey();
  const clientPubkey = Nostr.getPublicKey(clientSecret);
  const remote = createTestSigner();
  const user = createTestSigner();

  const descriptor = Nostr.createBunkerSessionDescriptor({
    remotePubkey: remote.pubkey,
    userPubkey: user.pubkey,
    clientPubkey,
    relays: ['wss://bunker-relay.example/'],
    permissions: ['get_public_key', 'sign_event', 'sign_event'],
    createdAt: 1700000000,
  });

  assert.equal(descriptor.schema, 'nip46-bunker-session/1');
  assert.deepEqual(descriptor.permissions, ['get_public_key', 'sign_event']);
  assert.equal('secret' in descriptor, false);
  assert.equal('clientSecret' in descriptor, false);

  // Wrong vault key fails fast
  await assert.rejects(
    () =>
      Nostr.restoreBunkerSigner(descriptor, {
        loadClientSecret: async () => Nostr.generateSecretKey(),
      }),
    /does not match descriptor clientPubkey/
  );

  // Valid vault key restores signer with connect(), ping(), signEvent(), and close()
  let pingCount = 0;
  const restored = await Nostr.restoreBunkerSigner(descriptor, {
    loadClientSecret: async pk => {
      assert.equal(pk, clientPubkey);
      return clientSecret;
    },
    createTransport: () => ({
      connect: async () => {},
      getPublicKey: async () => user.pubkey,
      signEvent: async template => user.signEvent(template),
      ping: async () => {
        pingCount += 1;
        return 'pong';
      },
      close: async () => {},
    }),
  });

  const pk = await restored.connect();
  assert.equal(pk, user.pubkey);
  assert.equal(await restored.ping(), 'pong');
  assert.equal(pingCount, 1);
  const signed = await restored.signEvent(Nostr.eventTemplate({ kind: 1, content: 'restored', created_at: 1700000001 }));
  assert.equal(signed.pubkey, user.pubkey);
  await restored.close();
});

test('Testing kit: createMockRelay AUTH + live subscriptions and withStrictBrowserFetch receiver guard', async () => {
  const signer = createTestSigner();
  const relay = Testing.createMockRelay({ url: 'wss://auth-relay.example', requireAuth: true });
  const note = await signer.signEvent(Nostr.eventTemplate({ kind: 1, content: 'authed note', created_at: 1700000000 }));

  const receipt = await Nostr.publishRelay(relay.url, note, {
    Socket: relay.Socket,
    authSigner: signer,
    authPubkey: signer.pubkey,
    requireAuthentication: true,
  });
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.readback, true);

  const queried = await Nostr.queryRelay(relay.url, { ids: [note.id] }, {
    Socket: relay.Socket,
    authSigner: signer,
    authPubkey: signer.pubkey,
  });
  assert.equal(queried.length, 1);
  assert.equal(queried[0].id, note.id);

  // withStrictBrowserFetch throws on detached invocation, succeeds via globalThis.fetch / Core.defaultFetch
  const originalFetch = globalThis.fetch;
  try {
    const strict = withStrictBrowserFetch(async url => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => `fetched:${url}`,
    }));
    globalThis.fetch = strict;

    // Detached call throws Illegal invocation just like real browsers
    const detached = globalThis.fetch;
    assert.throws(() => detached('https://example.com'), /Illegal invocation/);

    // Core.defaultFetch / Core.boundedFetch succeed because they bind globalThis
    const res = await Core.boundedFetch('https://example.com/ok', {}, { read: 'text' });
    assert.equal(res.text, 'fetched:https://example.com/ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
