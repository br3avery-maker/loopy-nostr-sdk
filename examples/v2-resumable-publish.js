/** Run: node examples/v2-resumable-publish.js. NO NETWORK, NO PUBLIC PUBLICATION. */
import { Nostr, Nsite } from '../src/index.js';
import { createMockBlossom, createMockRelay, createTestSigner } from '../src/testing/index.js';

const signer = createTestSigner();
const relay = createMockRelay({ url: 'wss://relay.example.net' });
const blossom = createMockBlossom({
  servers: ['https://blossom-1.example.net', 'https://blossom-2.example.net'],
});
const pool = Nostr.createRelayPool({ Socket: relay.Socket });

const files = {
  'index.html': '<!doctype html><title>v2 Demo</title><h1>Resumable Publish</h1>',
  'style.css': 'body{font-family:sans-serif}',
};
const planOptions = {
  pubkey: signer.pubkey,
  server: blossom.servers[0],
  storageServers: blossom.servers,
  requiredCopies: 2,
  relays: [relay.url],
  identifier: 'v2-demo',
  title: 'Resumable v2 Demo',
  created_at: 1764100000,
};

const plan = await Nsite.planNsitePublication(files, planOptions);
const stages = [];
const published = await Nsite.publishNsite(files, {
  ...planOptions,
  signer,
  approvedPlan: plan.id,
  resolveCurrent: Nsite.createRelayRevisionResolver({ pool, relays: [relay.url] }),
  fetcher: blossom.fetcher,
  Socket: relay.Socket,
  preflight: true,
  batchAuth: true,
  onProgress: evt => stages.push(evt.stage),
});

pool.close();
console.log(JSON.stringify({
  state: 'OFFLINE_EXAMPLE_NO_PUBLICATION',
  planSchema: plan.schema,
  jobStage: published.job.stage,
  manifestEventId: published.event.id,
  verifiedRelayReceipts: published.receipts.verified.length,
  progressStages: [...new Set(stages)],
}, null, 2));
