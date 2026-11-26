/** Run: node examples/blossom-replica-repair.js. NO NETWORK, NO PUBLIC UPLOAD. */
import { Blossom, Nsite } from '../src/index.js';
import { createMockBlossom, createTestSigner } from '../src/testing/index.js';

const signer = createTestSigner();
const primary = 'https://blossom-a.example.net';
const mirror = 'https://blossom-b.example.net';
const blossom = createMockBlossom({ servers: [primary, mirror] });

const files = {
  'index.html': '<!doctype html><h1>Replica Repair Demo</h1>',
  'app.js': 'export const ok = true;\n',
};
const prepared = await Nsite.prepareManifestFiles(files);
for (const entry of prepared.entries) {
  await Blossom.uploadVerified(entry.bytes, {
    server: primary,
    signer,
    pubkey: signer.pubkey,
    path: entry.path,
    fetcher: blossom.fetcher,
  });
}

const manifest = { files: prepared.entries.map(({ path, hash }) => ({ path, hash })) };
const repair = await Blossom.repairBlobReplicas(manifest, {
  sourceServers: [primary],
  targetServers: [primary, mirror],
  signer,
  pubkey: signer.pubkey,
  requiredCopies: 2,
  fetcher: blossom.fetcher,
});

const orphanHash = 'f'.repeat(64);
const orphans = Blossom.findUnreferencedBlobs(
  [...prepared.entries.map(e => e.hash), orphanHash],
  [manifest]
);

console.log(JSON.stringify({
  state: 'OFFLINE_EXAMPLE_NO_NETWORK',
  repairStatus: repair.status,
  repairedBlobs: repair.repaired,
  healthyBlobs: repair.healthy,
  unreferencedHashes: orphans,
}, null, 2));
