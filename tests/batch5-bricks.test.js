import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Blossom, Core, Moderation, Nostr, Storage } from '../src/index.js';

function makeKeypair() {
  const sk = Nostr.generateSecretKey();
  const pk = Nostr.getPublicKey(sk);
  const signer = {
    async getPublicKey() { return pk; },
    async signEvent(t) { return Nostr.finalizeEvent(t, sk); },
  };
  return { sk, pk, signer };
}

test('Batch 5: Core.mapLimit preserves output order, bounds active concurrency, and honors AbortSignal', async () => {
  let active = 0;
  let peak = 0;
  const out = await Core.mapLimit([30, 10, 20, 5, 15], 2, async (ms, idx) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, ms));
    active -= 1;
    return `${idx}:${ms}`;
  });
  assert.equal(peak, 2);
  assert.deepEqual(out, ['0:30', '1:10', '2:20', '3:5', '4:15']);

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => Core.mapLimit([1, 2], 2, x => x, { signal: ac.signal }),
    err => err.code === 'cancelled'
  );
});

test('Batch 5: Nostr.subscribeRelay distinguishes EOSE vs live events and supports close()', async () => {
  const { sk, pk } = makeKeypair();
  const storedEv = Nostr.finalizeEvent(Nostr.textNote('stored', { created_at: 100 }), sk);
  const liveEv = Nostr.finalizeEvent(Nostr.textNote('live', { created_at: 101 }), sk);
  let sentClose = false;
  let serverSocket;

  class MockSocket {
    constructor() {
      serverSocket = this;
      queueMicrotask(() => this.onopen?.());
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'REQ') {
        const subId = msg[1];
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify(['EVENT', subId, storedEv]) });
          this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
          this.onmessage?.({ data: JSON.stringify(['EVENT', subId, liveEv]) });
        });
      } else if (msg[0] === 'CLOSE') {
        sentClose = true;
      }
    }
    close() {}
  }

  const received = [];
  let eoseSeen = false;
  await new Promise(resolve => {
    const sub = Nostr.subscribeRelay(
      'wss://stream.example',
      { authors: [pk], kinds: [1] },
      {
        Socket: MockSocket,
        onEvent(ev, meta) {
          received.push({ id: ev.id, live: meta.live, relay: meta.relay });
          if (meta.live) {
            sub.close();
            resolve();
          }
        },
        onEose() {
          eoseSeen = true;
        },
      }
    );
  });

  assert.equal(eoseSeen, true);
  assert.equal(sentClose, true);
  assert.ok(serverSocket);
  assert.deepEqual(received, [
    { id: storedEv.id, live: false, relay: 'wss://stream.example' },
    { id: liveEv.id, live: true, relay: 'wss://stream.example' },
  ]);
});

test('Batch 5: Nostr.createRelayPool multiplexes on one socket per relay and caches NIP-42 AUTH per principal', async () => {
  const { sk, pk, signer } = makeKeypair();
  const note1 = Nostr.finalizeEvent(Nostr.textNote('one', { created_at: 200 }), sk);
  const note2 = Nostr.finalizeEvent(Nostr.textNote('two', { created_at: 201 }), sk);

  let socketCreations = 0;
  let authHandshakes = 0;
  const stored = new Map([[note1.id, note1]]);

  class AuthRelaySocket {
    constructor(url) {
      this.url = url;
      this.authed = false;
      socketCreations += 1;
      queueMicrotask(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge-xyz']) });
      });
    }
    send(raw) {
      const msg = JSON.parse(raw);
      if (msg[0] === 'AUTH') {
        authHandshakes += 1;
        this.authed = true;
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', msg[1].id, true, '']) }));
      } else if (msg[0] === 'REQ') {
        const [, subId, filter] = msg;
        queueMicrotask(() => {
          if (!this.authed) {
            this.onmessage?.({ data: JSON.stringify(['CLOSED', subId, 'auth-required: login']) });
            return;
          }
          for (const ev of stored.values()) {
            if (!filter.ids || filter.ids.includes(ev.id)) {
              this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
            }
          }
          this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
        });
      } else if (msg[0] === 'EVENT') {
        const ev = msg[1];
        queueMicrotask(() => {
          if (!this.authed) {
            this.onmessage?.({ data: JSON.stringify(['OK', ev.id, false, 'auth-required: login']) });
            return;
          }
          stored.set(ev.id, ev);
          this.onmessage?.({ data: JSON.stringify(['OK', ev.id, true, '']) });
        });
      }
    }
    close() {}
  }

  const pool = Nostr.createRelayPool({
    Socket: AuthRelaySocket,
    authSigner: signer,
    authPubkey: pk,
  });

  // Two concurrent queries share ONE socket and ONE NIP-42 AUTH handshake
  const [q1, q2] = await Promise.all([
    pool.query(['wss://auth.example'], { kinds: [1] }),
    pool.query(['wss://auth.example'], { authors: [pk] }),
  ]);
  assert.equal(socketCreations, 1);
  assert.equal(authHandshakes, 1);
  assert.equal(q1.events.length, 1);
  assert.equal(q2.events.length, 1);

  // Subsequent publish reuses the same authenticated socket with zero extra handshakes
  const pub = await pool.publish(['wss://auth.example'], note2);
  assert.equal(pub.verified.length, 1);
  assert.equal(pub.verified[0].authenticated, true);
  assert.equal(socketCreations, 1);
  assert.equal(authHandshakes, 1);

  pool.close();
  await assert.rejects(() => pool.query(['wss://auth.example'], { kinds: [1] }), err => err.code === 'closed');
});

test('Batch 5: Nostr.createEventStore honors NIP-01 replacement, rejects ephemeral events, and enforces author-matched NIP-09 deletions', async () => {
  const alice = makeKeypair();
  const bob = makeKeypair();
  const store = Nostr.createEventStore(Storage.memoryStore());

  // Ephemeral rejected
  const eph = Nostr.finalizeEvent(Nostr.eventTemplate({ kind: 20001, content: 'ping', created_at: 100 }), alice.sk);
  assert.equal((await store.put(eph)).reason, 'ephemeral');

  // Addressable replacement: newer wins, older rejected
  const addrOld = Nostr.finalizeEvent(
    Nostr.eventTemplate({ kind: 30023, content: 'v1', tags: [['d', 'post-1']], created_at: 100 }),
    alice.sk
  );
  const addrNew = Nostr.finalizeEvent(
    Nostr.eventTemplate({ kind: 30023, content: 'v2', tags: [['d', 'post-1']], created_at: 200 }),
    alice.sk
  );
  assert.equal((await store.put(addrNew)).stored, true);
  assert.equal((await store.put(addrOld)).reason, 'superseded');
  const queried = await store.query({ authors: [alice.pk], kinds: [30023] });
  assert.equal(queried.length, 1);
  assert.equal(queried[0].id, addrNew.id);

  // Regular note + cross-author deletion rejected, same-author deletion removes + tombstones
  const note = Nostr.finalizeEvent(Nostr.textNote('keep or delete', { created_at: 150 }), alice.sk);
  assert.equal((await store.put(note)).stored, true);

  const bobDel = Nostr.finalizeEvent(Nostr.deletionTemplate({ ids: [note.id], created_at: 160 }), bob.sk);
  const bobRes = await store.applyDeletion(bobDel);
  assert.equal(bobRes.deletedIds.length, 0);
  assert.equal(bobRes.ignored[0].reason, 'author-mismatch');
  assert.equal((await store.get(note.id))?.id, note.id);

  const aliceDel = Nostr.finalizeEvent(
    Nostr.deletionTemplate({ ids: [note.id], addresses: [`30023:${alice.pk}:post-1`], created_at: 250 }),
    alice.sk
  );
  const aliceRes = await store.applyDeletion(aliceDel);
  assert.deepEqual(aliceRes.deletedIds, [note.id]);
  assert.deepEqual(aliceRes.deletedAddresses, [`30023:${alice.pk}:post-1`]);
  assert.equal(await store.get(note.id), null);
  // Re-ingesting tombstoned event is blocked
  assert.equal((await store.put(note)).reason, 'deleted');
  assert.equal((await store.put(addrNew)).reason, 'deleted');
});

test('Batch 5: Full NIP-19 encoders round-trip cleanly with decodeNip19 on both Nostr and Moderation', () => {
  const pk = '1'.repeat(64);
  const id = '2'.repeat(64);
  const relays = ['wss://relay1.example', 'wss://relay2.example'];

  const note = Nostr.noteEncode(id);
  assert.deepEqual(Nostr.decodeNip19(note), { type: 'note', hex: id });

  const nprof = Nostr.nprofileEncode({ pubkey: pk, relays });
  assert.deepEqual(Moderation.decodeNip19(nprof), {
    type: 'nprofile',
    hex: pk,
    relays,
    identifier: null,
    kind: null,
  });

  const nev = Nostr.neventEncode({ id, author: pk, kind: 1, relays });
  assert.deepEqual(Nostr.decodeNip19(nev), {
    type: 'nevent',
    hex: id,
    author: pk,
    relays,
    identifier: null,
    kind: 1,
  });

  const naddr = Nostr.naddrEncode({ identifier: 'my-site', pubkey: pk, kind: 35128, relays });
  assert.deepEqual(Nostr.decodeNip19(naddr), {
    type: 'naddr',
    hex: pk,
    relays,
    identifier: 'my-site',
    kind: 35128,
  });
});

test('Batch 5: Nostr.verifyNip05 performs bounded opt-in HTTPS verification and rejects private hosts or mismatched keys', async () => {
  const pk = 'a'.repeat(64);
  const okRes = await Nostr.verifyNip05('Alice@Example.COM', {
    expectedPubkey: pk,
    fetcher: async url => {
      assert.equal(url, 'https://example.com/.well-known/nostr.json?name=alice');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () =>
          Core.encode(
            JSON.stringify({
              names: { alice: pk },
              relays: { [pk]: ['wss://relay.example/', 'ws://bad.local'] },
            })
          ).buffer,
      };
    },
  });
  assert.equal(okRes.verified, true);
  assert.equal(okRes.pubkey, pk);
  assert.deepEqual(okRes.relays, ['wss://relay.example']);

  // Rejects localhost / private hostnames
  await assert.rejects(() => Nostr.verifyNip05('alice@localhost', { fetcher: async () => ({ ok: true }) }));

  // Prototype-safe lookup (toString is not treated as a valid user)
  const protoRes = await Nostr.verifyNip05('tostring@example.com', {
    fetcher: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => Core.encode(JSON.stringify({ names: {} })).buffer,
    }),
  });
  assert.equal(protoRes.verified, false);
  assert.equal(protoRes.reason, 'not-found');
});

test('Batch 5: Nostr.planRelayListUpdate preserves foreign tags, forbids empty write lists, and dual-broadcasts', () => {
  const { sk } = makeKeypair();
  const current = Nostr.finalizeEvent(
    Nostr.eventTemplate({
      kind: 10002,
      content: 'kept',
      tags: [
        ['r', 'wss://old-write.example', 'write'],
        ['r', 'wss://stay.example'],
        ['client', 'nsite-loopy'],
      ],
      created_at: 100,
    }),
    sk
  );

  const plan = Nostr.planRelayListUpdate(current, {
    remove: ['wss://old-write.example'],
    add: [{ url: 'wss://new-write.example', read: false, write: true }],
    setMode: { 'wss://stay.example': 'read' },
    created_at: 200,
  });

  assert.equal(plan.template.content, 'kept');
  assert.ok(plan.template.tags.some(t => t[0] === 'client' && t[1] === 'nsite-loopy'));
  // Dual-broadcast includes both old write relay and new write relay
  assert.ok(plan.broadcastRelays.includes('wss://old-write.example'));
  assert.ok(plan.broadcastRelays.includes('wss://new-write.example'));

  assert.throws(
    () => Nostr.planRelayListUpdate(current, { remove: ['wss://old-write.example', 'wss://stay.example'] }),
    /at least one write relay/
  );
});

test('Batch 5: Storage.fsStore persists atomically with traversal-safe keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nsite-fsstore-'));
  try {
    const store = Storage.fsStore(dir);
    const trickyKey = '../../etc/passwd:ns/1?a=b';
    assert.equal(await store.get(trickyKey), undefined);
    await store.set(trickyKey, { ok: true, count: 42 });
    assert.deepEqual(await store.get(trickyKey), { ok: true, count: 42 });
    assert.deepEqual(await store.keys(), [trickyKey]);

    // Ensure no file escaped dir
    const entries = await fs.readdir(dir);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].endsWith('.json'));

    await store.delete(trickyKey);
    assert.equal(await store.get(trickyKey), undefined);
    assert.deepEqual(await store.keys(), []);
    await store.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Batch 5: Blossom.findUnreferencedBlobs and repairBlobReplicas heal degraded replicas', async () => {
  const { pk, signer } = makeKeypair();
  const bodyA = Core.encode('<h1>index</h1>');
  const bodyB = Core.encode('body{color:black}');
  const hashA = await Core.sha256(bodyA);
  const hashB = await Core.sha256(bodyB);
  const orphanHash = 'f'.repeat(64);

  const orphans = Blossom.findUnreferencedBlobs([hashA, hashB, orphanHash], [
    { files: [{ path: '/index.html', hash: hashA }] },
    { tags: [['path', '/style.css', hashB]] },
  ]);
  assert.deepEqual(orphans, [orphanHash]);

  // Seed only server A; repairBlobReplicas must copy both blobs to server B
  const serverBlobs = new Map([
    [`https://a.example/${hashA}`, { data: bodyA, type: 'text/html' }],
    [`https://a.example/${hashB}`, { data: bodyB, type: 'text/css' }],
  ]);

  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (init.method === 'HEAD' && u.pathname === '/upload') {
      return { ok: true, status: 200, headers: new Headers() };
    }
    if (init.method === 'PUT' && u.pathname === '/upload') {
      const data = new Uint8Array(init.body);
      const hash = await Core.sha256(data);
      serverBlobs.set(`${u.origin}/${hash}`, { data, type: init.headers['Content-Type'] });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => Core.encode(JSON.stringify({ sha256: hash, size: data.length })).buffer,
      };
    }
    const found = serverBlobs.get(url);
    if (!found) return { ok: false, status: 404, redirected: false, headers: new Headers() };
    return {
      ok: true,
      status: 200,
      redirected: false,
      headers: new Headers({ 'content-type': found.type }),
      arrayBuffer: async () => found.data.buffer.slice(0),
    };
  };

  const report = await Blossom.repairBlobReplicas(
    {
      files: [
        { path: '/index.html', hash: hashA },
        { path: '/style.css', hash: hashB },
      ],
    },
    {
      sourceServers: ['https://a.example'],
      targetServers: ['https://a.example', 'https://b.example'],
      requiredCopies: 2,
      signer,
      pubkey: pk,
      fetcher,
    }
  );
  assert.equal(report.status, 'healthy');
  assert.equal(report.repaired, 2);
  assert.equal(report.degraded, 0);
  assert.equal(serverBlobs.has(`https://b.example/${hashA}`), true);
  assert.equal(serverBlobs.has(`https://b.example/${hashB}`), true);
});
