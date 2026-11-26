# Cross-donor comparison — batch 2: event identity, provenance and history

**Candidate:** 1.1.1-rc.2, based on the unchanged published-to-user rc.1 archive. No live relay writes, signing approvals, deployment, or embedding inference. The new module is a protocol-based implementation, not a wholesale port of donor code. All cross-donor references are evidence, not a redistribution grant.

## Inspected sources and dispositions

| Source | Observed implementation | Disposition |
|---|---|---|
| Open Specs `packages/nostr/src/relay.ts`, `corpus.ts`, `pool.ts`, commit `04a7672a19588406d0bffe710053c7d3a6146cc9` | Newest per coordinate, lowest-ID ties; per-relay inclusive time cursor. No-new-ID pages become exhausted; empty query results can mask failed transport. | Preserve revision invariant and independent relay progress. Replace ambiguous completion semantics with explicit status and bounded exact-time boundary probes. |
| Quarry `ndk-cache-event-provenance`, irislib/iris-apps `packages/ndk-cache/src/index.ts`, SHA-256 `e4a5d1a3275f7cccffe9e576ddad7205750b60e01093adec7282da420e90df65` | Separate duplicate-sighting operation; canonical cache entry keyed by event identity. | Keep sightings by immutable ID even when a revision is superseded. |
| Quarry `nostrapps-live-addressable-app-discovery`, eskema/nostrapps `src/system-napps/apps.ts`, SHA-256 `3b24b94c8b45029bffa7ce91c25ceee11cf8874a5384fc1c869ed4056200bfa5` | Materialize newest manifest per app address and retain address-level sightings. | Separate exact revision sightings from address-level projections; a relay that saw an old revision is not evidence that it has the current one. |
| Quarry `nsite-manager-relay-provenance-cache`, hzrd149/nsite-manager `src/services/event-metadata.ts`, SHA-256 `4046f0f0aad115d8186e064a872803d08a2d1aa479a37c4b0634ecb9d390c279` | Batched persistent per-event-ID relay lists. | Reuse existing SDK storage contract; no new DB, UI, or scheduler. |
| Quarry `spring-paged-sync-loop` and `spring-persistent-bounded-sync-queue`, nostrband/nostr-universe | Bounded pagination, task persistence and concurrency. | Adopt bounded resume and no implicit background loop. |
| Loopy rc.1 `fetchFeed` / `classifyEventStorage` / `queryRelay` / memory and IndexedDB adapters | Verified, ID-deduped feed without exposed sightings; existing storage class and finite transport contracts. | Preserve all existing APIs; use same crypto, filter predicate, storage classification and transport. |

## API and consumer example

`Nostr.eventIdentity(signedEvent)` verifies the event, returns `kind:pubkey:d` for addressable events (first raw `d`, including spaces or colons, missing = empty), `kind:pubkey:` for replaceable events, and immutable event ID otherwise. `collectEventObservations` rejects ephemeral events, invalid signatures, malformed times and invalid relay URLs. Every accepted sighting is verified. Duplicate IDs retain the first verified wire representation, with first/last client observation time per normalized relay. The `current` array selects latest observed by created_at, then lowest ID; it does not resolve NIP-09 deletions or prove globally newest events. Older revisions stay in `records`.

```js
import { Nostr, Storage } from '@chaoticka/nsite-loopy-sdk';
// Swap in your existing durable storage adapter for a persistent consumer.
const storage = Storage.memoryStore();
const key = 'open-specs-history';
const saved = (await storage.get(key)) ?? {observations: [], cursors: {}};
const batch = await Nostr.syncEventHistory({
  relays: ['wss://relay.openspecs.uid.ovh'],
  filter: {kinds: [30817]},
  cursors: saved.cursors,
  pageSize: 100, boundaryLimit: 500, maxPages: 8,
});
const observations = [...saved.observations, ...batch.observations];
// One storage record is a simple atomic checkpoint for this bounded example.
// For large histories use the existing CAS and transactional storage design.
await storage.set(key, {observations, cursors: batch.cursors});
const view = Nostr.collectEventObservations(observations);
console.log(batch.relays, view.current.length);
```

`syncEventHistory` returns only this batch's observations, not the entire accumulated history. Persist observations before or atomically with cursors; discarding observations and committing cursor would skip archived data. A failed or partial window is resumed before a new incremental scan. Each relay has an independent checkpoint. All requests use inclusive bounds; the scanner probes the oldest second at a larger limit before moving to an earlier second. It stops at a saturated or suspiciously equal-sized boundary or when the boundary no longer contains IDs already seen in the page. Increase the boundary limit, or adjust the smaller page size, to retry; repeated ambiguous boundaries can remain blocked. `window-read` means the requested bounded window was traversed according to observed relay responses; it never claims the complete corpus or all global revisions. The algorithm cannot prove completeness if a relay silently omits events or applies an undetectable cap (including a cap of one), and late older arrivals require backfill. It requires newest-first timestamp order from the query adapter and explicit rejection on transport failure; an adapter returning `[]` for network failure violates the contract. Default `queryRelay` may suppress invalid responses, so its empty result is not evidence a remote relay is honest. The candidate does not add continuous subscriptions, deletion processing, or automatic persistence.

## Differential evidence

Original Open Specs `corpus.ts` was transpiled unchanged and its documented dependencies injected with deterministic fixture query/parser/winner adapters. This isolates pagination, not upstream pool behavior. For six signed fixtures (five sharing the newest timestamp), page size two: original returned two and marked exhausted; candidate recovered all six. The empty-result path marks the upstream cursor exhausted; candidate's explicit rejected transport preserves its completed watermark and unfinished window. The real rc.1 `fetchFeed` returned one deduped event from two relays without sighting records; candidate retained both sightings for that event. See the companion comparison JSON and harness. New tests are offline, including a mock WebSocket consumer and stored cursor roundtrip. Prior live Open Specs retrieval is separate evidence, not proof this new scanner works on every real relay.

Remaining comparison: update baseline / preview parity, cache freshness and outbox routing, kind-1349 snapshots and Markdown revision differences. No permanent integration or SDK replacement yet.
