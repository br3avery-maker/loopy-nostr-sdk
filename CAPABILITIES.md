# Capability and API inventory

The complete machine-readable inventory is [docs/API_INDEX.json](docs/API_INDEX.json) (183 runtime API symbols). [API reference](docs/API_REFERENCE.md) and [TypeScript declarations](types/index.d.ts) define usage and contracts. The source families below are implemented; evidence is local rc.9 source tests, not live end-to-end production acceptance.

| API or capability | Source / export | Consumer or usage | Test evidence | State |
| --- | --- | --- | --- | --- |
| Core | src/core | archive and protocol adapters | crypto-signers, archive-directory | Source-tested |
| Nostr | src/nostr | examples/signers.js | crypto-signers, relay, cross-donor-history, public-migration | Source-tested |
| Nsite | src/nsite | examples/offline-publish-plan.js | manifest, cross-donor-publication, cross-donor-retrieval | Source-tested |
| Blossom | src/blossom | Nsite pipeline | blossom-publish, consumer-revision-lifecycle | Simulated transport-tested |
| Archive | src/archive | examples/archive-cas.js | cross-donor-archive, archive-directory, repo-recovery | Source-tested |
| Directory | src/directory | directory curation | archive-directory | Source-tested |
| Storage | src/storage | CAS and directory | archive-directory, public-migration | Memory and modeled IndexedDB-tested |
| Adapters | src/adapters | browser/Android signing host | crypto-signers, manifest | Source-tested; device unverified |
| Moderation and Moji | src/moderation, src/moji | policy import and emoji selection | repo-recovery | Source-tested |
| Anchor | src/anchor | backup, media references, kinds and receipt summaries | anchor-consumer-regressions | Source-tested |
| Intelligence | src/intelligence | draft/relay audit and Open Specs lookup | anchor-intelligence, open-specs, review-relay-plan | Source-tested; prior rc.8 live read verified |

## Integration boundaries

See GAPS.md for real host/browser/device and publication acceptance. An importable API is not a deployed application. Test exact event and blob bytes, not only acknowledgment.
