/** Run: node examples/relay-pool-store.js. NO NETWORK, NO PUBLIC SIGNING. */
import { createNsiteSDK, Nostr, Storage } from '../src/index.js';
import { createMockRelay, createTestSigner } from '../src/testing/index.js';

const signer = createTestSigner();
const relay = createMockRelay({ url: 'wss://relay.example.net' });
const pool = Nostr.createRelayPool({ Socket: relay.Socket });
const sdk = createNsiteSDK({ relays: [relay.url], pool, storage: Storage.memoryStore() });
const store = Nostr.createEventStore(Storage.scopedStore(sdk.options.storage, 'events'));

const note = await Nostr.checkedSign(signer, Nostr.textNote('Pooled offline note'), signer.pubkey);
const receipts = await pool.publish([relay.url], note);
const fetched = await sdk.query({ authors: [signer.pubkey], kinds: [1] });
for (const ev of fetched) await store.put(ev);

const delEvent = await Nostr.checkedSign(
  signer,
  Nostr.deletionTemplate({ ids: [note.id], reason: 'cleanup' }),
  signer.pubkey
);
const deletion = await store.applyDeletion(delEvent);
const remaining = await store.query({ authors: [signer.pubkey], kinds: [1] });

await sdk.close();
console.log(JSON.stringify({
  state: 'OFFLINE_EXAMPLE_NO_NETWORK',
  relayVerifiedCount: receipts.verified.length,
  pooledConnectionsOpened: relay.connections.length,
  fetchedCount: fetched.length,
  deletedIds: deletion.deletedIds,
  remainingNotesAfterDeletion: remaining.length,
}, null, 2));
