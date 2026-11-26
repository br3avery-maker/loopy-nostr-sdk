# Batch 5 — signed revisions, comparison, and archive recovery

Candidate 1.1.1-rc.5 is based on the exact rc.4 ZIP pinned in provenance. No live publication, repository mutation, embeddings, or dependency changes.

## Compared sources

- Open Specs (`nogringo/openspecs`, commit `04a7672a19588406d0bffe710053c7d3a6146cc9`): `apps/crawler/lib/src/snapshot.dart` and `test/crawler_test.dart` define kind-1349 wrapper, replaceable/addressable coordinate, e/k/p/a consistency and inner signature verification. Loopy independently implements that wire contract in JavaScript and additionally checks the outer signature and rejects ambiguous duplicate binding tags. Original Dart tests were inspected, not executed. No claim of complete external snapshot-spec compliance.
- Open Specs `packages/markdown/src/diff.ts` and `test/diff.test.ts`: document comparison, normalized similarity, block-oriented changes, bounded pairing, and sanitized rendering. Loopy intentionally does not copy the HTML-rendering stack or its parser dependencies. It exposes exact source-line alignment and bounded fallback instead. Its similarity scores are not comparable to upstream word-level scores. Whitespace, link target and code changes remain visible even if rendered output would match.
- Quarry `nsite-reuse:02facfa9fce826d63b13` (`archive-worker.js`, SHA-256 `02facfa9fce826d63b134f3ed034967eb8e7f1674adf575766b08ae62a284b93`): version-specific file retrieval and verified ZIP restore; use existing CAS and manifest/ZIP primitives, not a replacement archive DB.
- Quarry `nostr-archiver-signed-wacz-upload` (`fiatjaf/nostr-web-archiver`, `src/sw/api.ts`, blob `1f98817d1d9aad027cdf203fc982225bdcb29791`): bind archive bytes to SHA-256 upload authorization; existing Blossom client already handles signed upload and readback. No WACZ capture implemented.
- Existing Loopy `history.js`, `sync.js`, `content-addressable.js`, `versions.js`, `zip.js`, and `nsite/retrieval.js`: share verified identity, transport, provenance, CAS, and deterministic recovery. No new persistence engine. Quarry archive/diff-related lookup verified seven exact payloads; additional BLE reconciliation, graph revision, and semantic candidate-ranking patterns do not implement the specific history/restore contracts and were not substituted for them.

## Behavioral fixes versus additions

Four existing archive behaviors were tested against rc.4: custom store content was trusted without independent hash verification; duplicate normalized paths silently overwrote; caller-controlled manifest references remained mutable during recovery; equal-timestamp version ordering was arrival-dependent. The remaining new cases exercise missing APIs (not preexisting defects). `materializeVersion` now independently verifies bytes and rejects ambiguous file mappings, with configurable recovery budgets.

```js
const template=Archive.snapshotTemplate(oldSignedEvent);
// Only when separately authorized: sign with the archivist, not the original author's key.
const snapshot=await Nostr.checkedSign(archivistSigner,template,archivistPubkey);
const preserved=Archive.unwrapSnapshot(snapshot,{expectedCoordinate:Nostr.eventIdentity(oldSignedEvent)});
const store=Archive.contentStore(storage);
const receipt=await Archive.archiveRevision(preserved.event,store);
await storage.set('revision:'+receipt.eventId,receipt);
const recovered=await Archive.restoreRevision(receipt,store);
```

For historical sites, parse the recovered signed manifest, load the exact file hashes through existing retrieval/CAS interfaces, then `materializeVersion` and `writeZip`. ZIP restoration is deterministic for the supplied file map, not a guarantee of matching an original archive's compression or metadata. A signed manifest alone does not establish that its historical blobs are available. Snapshot publication is an optional caller action, never an automatic side effect of archive operations. Original author signatures authenticate event bytes, not document correctness or archivist trust. Snapshot JSON uses canonical wire fields; serialization need not match upstream JSON byte order.

## Integrated consumer test

A deterministic in-memory NIP-01 relay models actual replaceable-event replacement, signature verification, OK and exact-ID readback; a simulated Blossom server validates the actual SDK-generated signed upload authorization and payload digest. The test publishes an initial named site, signs an archivist snapshot with a different test key, retrieves and archives historical bytes, previews and publishes an identity-preserving replacement, resolves the current manifest through author outbox discovery, syncs snapshots, verifies both signatures, reconstructs both versions offline, compares Markdown source, and writes/reads a historical ZIP. Test keys are freshly generated; no real credentials or network writes. Shared blobs deduplicate. This is not a live relay, physical Android signer, browser IndexedDB, original Dart runtime, or full external Open Specs app test.
