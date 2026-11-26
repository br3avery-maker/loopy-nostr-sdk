# Cross-donor review: Nostr transport and replacement

2026-11-25. Local release candidate 1.1.1-rc.1, based on the verified 1.1.0 archive. No publication, live signing, remote release or production merge.

## Evidence and comparison

Protocol reference: https://github.com/nostr-protocol/nips/blob/master/01.md (current text retrieved 2026-11-25). Exact ID/author match; all specified predicates match; tag queries match the first value; empty arrays never match; time bounds inclusive; initial limit; lowest event ID wins equal-timestamp replacement. `OK` and subsequent readback are distinct stages.

Open Specs pinned revision `04a7672a19588406d0bffe710053c7d3a6146cc9`: `packages/nostr/src/relay.ts` has a correct revision selector; `nip65.ts` and `event.ts` select on timestamp alone; `pool.ts` uses nostr-tools SimplePool; `corpus.ts` paginates per relay but may confuse repeated pages/failures with exhaustion. Source review, not a claim of runtime verification of every upstream function.

The existing verified Code Quarry excerpts were also inspected. No donor source copied in this candidate; the changes are independent implementations of the documented protocol and signing invariants. Donor excerpts with unverified distribution licenses remain reference-only.

| Donor / existing source | Finding | Disposition |
|---|---|---|
| Open Specs `relay.ts`; NostrApps `src/system-napps/apps.ts` | Correct lowest-ID tie-break | Adopt invariant in Loopy kind 10002 and 10063 selectors |
| Open Specs `nip65.ts`; iris-apps NDK cache `packages/ndk-cache/src/index.ts` | Timestamp-only selection can be order-dependent | Do not copy as-is |
| Loopy `feed.js`, `profiles.js` | Already chooses lowest ID on a timestamp tie | Retain and regression-test |
| Open Specs `pool.ts`; Loopy `relay-transport.js` | Pool delegates query filtering; Loopy had signature-only validation | Enforce core predicates in Loopy while preserving errors and injected socket contract |
| NDK cache, NostrApps, nsite-manager `src/services/event-metadata.ts` | Separate observed relay provenance from winner selection; nsite-manager persistence merge across batches needs validation | Candidate for next batch, not integrated |
| Better NIPs `src/hooks/useAppDirectory.ts`; Open Specs `spec.ts` | Stable d-tag and preserved metadata during updates | Compare against nsite manifest pipeline; no port yet |
| Sidecar `test/replaceable-baseline.test.js` | Destructive replacement warning; no baseline does not imply safe | Reference tests; needs nsite-specific user approval contract |
| nsyte `src/commands/deploy.ts` | Dry-run and deploy share manifest preparation | Reuse existing Loopy preparation API, test preview/publish parity next |
| nsite-gateway `src/services/nostr.ts` | Cache-first manifest resolution with outbox lookup | Check stale cache/failed fetch semantics before reuse |
| nostr-docs `src/lib/localStore.ts` | Durable pending-broadcast flag | Compare with Loopy's checkpoint stages; no integration yet |

## Runtime results

`tests/cross-donor-transport.test.js` used independently generated signed fixtures and deterministic injected transports. On original SDK 1.1.0, nine of ten cases failed (profile selection already passed). On candidate, ten of ten pass. Entire Node suite: 68 tests. Python: 10 tests. TypeScript consumer check passed. No real relay or signer was contacted in these tests. The earlier live Open Specs read experiment is separate evidence.

Changes: deterministic kind10002/10063 tie-break; finite NIP-01 query filter and local cap enforcement; reject unsolicited pre-OK readback; protect approved signing snapshot from in-place mutation by signer. The query limit can terminate locally and is not a guarantee of exhaustion or newest-event selection when an adversarial relay sends unordered results. Query extensions are not evaluated locally; same-socket readback is not independent network verification.

Remaining batch: generic addressable event revision/provenance APIs, corpus same-timestamp and failure cursors, outbox/caching, nsite update preview and preflight, snapshots, and Markdown. Compare against remaining donors before changing contracts. This candidate is not a full SDK adoption or a finished multi-codebase audit.
