# Capability and API inventory

The complete machine-readable inventory is [docs/API_INDEX.json](docs/API_INDEX.json) (246 runtime API symbols across 13 namespaces, plus `createNsiteSDK`). [API reference](docs/API_REFERENCE.md) (generated and checked by `scripts/sync_docs.py`) and [TypeScript declarations](types/index.d.ts) define usage and contracts. The source families below are implemented; evidence is local offline source tests (rc.9/rc.10 baseline plus unreleased modular bricks and Round 2 hardening), not live end-to-end production acceptance.

| API or capability | Source / export | Consumer or usage | Test evidence | State |
| --- | --- | --- | --- | --- |
| Core | src/core | archive, media, HTTP, concurrency, session, schema and protocol adapters | crypto-signers, archive-directory, batch5-bricks, batch6-bricks, round2-big-jobs | Source-tested |
| Nostr | src/nostr | examples/signers.js, examples/relay-pool-store.js, examples/giftwrap-dm.js | crypto-signers, relay, cross-donor-history, public-migration, batch5-bricks, batch6-bricks | Source-tested |
| Nsite | src/nsite | examples/offline-publish-plan.js, examples/v2-resumable-publish.js | manifest, cross-donor-publication, cross-donor-retrieval, round2-big-jobs | Source-tested |
| Blossom | src/blossom | Nsite pipeline, examples/blossom-replica-repair.js | blossom-publish, consumer-revision-lifecycle, batch5-bricks, batch6-bricks | Simulated transport-tested |
| Archive | src/archive | examples/archive-cas.js | cross-donor-archive, archive-directory, repo-recovery, batch6-bricks | Source-tested |
| Directory | src/directory | directory curation | archive-directory, round2-tweaks | Source-tested |
| Storage | src/storage | CAS, event store, health cache and directory | archive-directory, public-migration, batch5-bricks, round2-tweaks | Memory, modeled IndexedDB, and Node fs-tested |
| Adapters | src/adapters | browser/Android signing host | crypto-signers, manifest | Source-tested; device unverified |
| Moderation and Moji | src/moderation, src/moji | policy import and emoji selection | repo-recovery, round2-tweaks | Source-tested |
| Anchor | src/anchor | backup, media references, kinds and receipt summaries | anchor-consumer-regressions, round2-tweaks | Source-tested |
| Intelligence | src/intelligence | draft/relay/ecosystem audit and Open Specs lookup | anchor-intelligence, open-specs, review-relay-plan, round2-big-jobs | Source-tested; prior rc.8 live read verified |
| Testing | src/testing | offline consumer test harnesses (`@chaoticka/nsite-loopy-sdk/testing`) | batch6-bricks, round2-big-jobs, examples/* | Source-tested |

## Integration boundaries

See GAPS.md for real host/browser/device and publication acceptance. An importable API is not a deployed application. Test exact event and blob bytes, not only acknowledgment.

The rc.10 profile and NIP-19 corrections retain the public names and add an optional event author hint field. See [regression evidence](docs/PUBLIC_REVIEW_REPAIRS.md).

Additive event-specific delivery planning/summary: [source comparison and limits](docs/RELAY_DELIVERY_RECONCILIATION.md). Local signed regression and archived donor comparisons passed; exact-head CI/review remains separate.

Opt-in version-2 publication plans support required verified storage copies, resume with signed manifest reuse, live/pooled baseline checks (`Nsite.createRelayRevisionResolver`), and explicit gateway checks. See [publication reconciliation](docs/PUBLICATION_RECONCILIATION.md); local simulated transport acceptance, not a live publication claim.
