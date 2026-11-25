# Loopy Nostr SDK 1.1.1-rc.10

**Executable JavaScript ESM SDK** recovered/adapted from the user's nsite source collection and validated independently. This is not an archive browser, design mockup, or a checklist masquerading as an SDK. It exposes source modules for Nostr identities/events, NIP-46/55 signers, relay discovery and transport, signed publication and readback, Blossom, NIP-5A sites, ZIP/archive preservation, content-addressed deduplication, collections, profile/feed functions and storage.

**Release candidate, not deployed:** transport filters, equal-timestamp replacement, signer input immutability and publish/readback ordering hardened in a cross-donor comparison. See `docs/CROSS_DONOR_TRANSPORT.md`. Batch 2 adds verified event identity, revision/provenance views, and bounded resumable per-relay history with explicit failure and boundary-stall states. See `docs/CROSS_DONOR_HISTORY.md`.

**Review repairs:** canonical archive restoration paths, symlink rejection and atomic replacement; relay recommendations exclude known rejected endpoints. See `docs/REVIEW_REPAIRS.md`.

## Quick start

Requirements: Node 22 recommended (Node 20+ for offline) for offline tests and ZIP decoding; browser with Web Crypto and WebSocket for live read/write. No credentials are bundled. Use the named exports directly from `src/index.js`, or install locally as a package:

```sh
npm pack --ignore-scripts
# From a separate consumer directory: npm install /path/to/chaoticka-nsite-loopy-sdk-1.1.1-rc.10.tgz
npm test                  # source tests (no network)
npm run test:types       # type-check consumer against public .d.ts
npm run verify           # tests + file/config checks
npm pack --dry-run        # verify npm package contents
```

```js
import { createNsiteSDK, Nostr, Nsite, Blossom, Archive, Directory } from '@chaoticka/nsite-loopy-sdk';

const sdk = createNsiteSDK({
  relays: ['wss://relay.example.net'],
  server: 'https://blossom.example.net',
  signer: Nostr.browserSigner(window.nostr), // or the user's approved NIP-46 signer
});
const signed = await Nostr.checkedSign(
  sdk.options.signer,
  Nostr.textNote('Hello from Deepink'),
  await sdk.options.signer.getPublicKey()
);
// Publish using Nostr.publishMany(signed, approvedRelays) and inspect actual readback.
```

**Important:** the `.example.net` addresses are documentation placeholders and do not represent connected relays or Blossom storage. No network call is made merely by importing this SDK.

## API families

| Package API | Reusable actual code | Source/verification |
| --- | --- | --- |
| `Core` | Bytes, SHA-256, canonical URL/path validation, shared options | Adapted from existing nsite publisher/Directory Editor, offline tested |
| `Nostr` | Schnorr event verification/signing, NIP-07/46/55, relay NIP-65, NIP-11, NIP-42, NIP-98, kind0 profiles, notes/replies/reactions, relay readback | Bundled permissive crypto vendor and source-driven adapters; offline tested |
| `Nsite` | NIP-5A manifest hashes, root/named-site addressing, file maps, prepare/sign/upload/publish/readback pipeline | Directory Editor/BreBre Web publishing patterns; offline tested |
| `Blossom` | Signed authorization, exact-byte uploads + readback, multi-server content fallback | Directory Editor + BreBre donor mechanisms; mocked transport tests |
| `Archive` | ZIP read/write (including DEFLATE decoding in Node), CRC, CAS blob storage, version comparison/materialization, archive catalog | Archive Repair + Code Quarry patterns; offline tested |
| `Directory` | Source-derived 31 API exports: collection grouping, rules, hiding, stacking clones, publisher sorting, validation, public catalog, HTML metadata | Original Directory Editor model + portable metadata function; offline tested |
| `Storage` | Common memory and IndexedDB async contract | Directory Editor/Archive Repair storage adapters |
| `Adapters` | Browser and Android signer host contracts | Existing Amber host and signer conventions, not device tested |

For digest-bound previews, signed-baseline updates and explicit tag edits, see `docs/CROSS_DONOR_PUBLICATION.md`.

See `docs/API_REFERENCE.md`, `docs/OPTIONS.md`, `docs/DEEPINK_CONSUMER.md`, and machine-readable `docs/API_INDEX.json`.

## Skills and workflows

Agent Skills under `skills/` cover Deepink-like Nostr client upgrades, nsite publishing, archive recovery, directory curation, signer handoff, and source mining. `workflows/` has ordered, test-gated JSON workflows; `.github/workflows/verify.yml` is CI-only. Nothing auto-deploys, signs, or publishes.

Private donor archives and occurrence maps are deliberately excluded from the public SDK. Public module provenance and source comparison documents are included.

## Verification and limits

- Local unit/integration tests exercise actual vendor BIP-340 cryptography, NIP-5A manifest logic, ZIP encoding/decoding and modeled relay/Blossom transports.
- A fake WebSocket or injected uploader in offline tests is **not a live relay**, and no Android Intent/ActivityResult path has been tested on a physical phone by this SDK package.
- End-to-end live operations require real signer approval, available relays, Blossom permissions, host support and separate publication authorization.
- The source collection is private due to historical donor and third-party licenses. Do not automatically publish it to a public GitHub repo.

Recovered provenance: `provenance/manifest.json`; exact donor occurrence map is in the companion archive. See `LICENSES.md` before redistribution.

## Repository-wide recovery additions in v1.1.0

`Moderation`, `Moji`, and `Anchor` are importable, independently usable namespaces. `Archive` adds the source-exact internal Gear CDC chunker. The four sets were built from current owner-repository implementations, with exact source paths and missing features cataloged in `docs/REPO_CAPABILITY_AUDIT.md` and `provenance/repo-capabilities.json`.

```js
import { Moderation, Moji, Anchor, Archive } from '@chaoticka/nsite-loopy-sdk';
const inspected = Moderation.inspectNsiteSpam({title:'Example',description:'A local zine'});
const policy = {bannedPubkeys:Moderation.BUILT_IN_NSFW_BAN_PUBKEYS};
const publicBackup = Anchor.buildPublicAccountBackup({session:{mode:'read-only',pubkey:'a'.repeat(64)}});
```

None of these imports sign, fetch, upload, render media, auto-ban unverified authors, or connect a network. **Code is distinct from the user's curation choices.** Confirmed spam campaigns and explicit blocklists can hide items in a browsing view while leaving raw index and recovery data unchanged. Local tests are not Android/live signer acceptance.

## Verified retrieval and cache policy

See [CROSS_DONOR_RETRIEVAL.md](docs/CROSS_DONOR_RETRIEVAL.md) for `Nsite.resolveNsiteManifest`, `Nsite.resolveManifestPath`, `Nsite.loadNsiteFile`, bounded `Blossom.fetchVerified`, and failure/cache semantics.

## Verified history and offline reconstruction

See [CROSS_DONOR_ARCHIVE.md](docs/CROSS_DONOR_ARCHIVE.md) for signed revision snapshots, exact event CAS records, lossless bounded Markdown source comparison and verified historical file restore. `tests/consumer-revision-lifecycle.test.js` combines publication, updates, transport, discovery, synchronization, snapshots and offline ZIP recovery using deterministic simulated relay/Blossom transports and real signature/hash checks.

## rc.6 Anchor intelligence and consumer fixes

See [integration notes](docs/ANCHOR_INTELLIGENCE.md). The extracted advisory namespace is separately importable; publication still uses approved Loopy transport.

## Open Specs discovery and registry lookup

See [OPEN_SPECS.md](docs/OPEN_SPECS.md). Signed proposals augment, but do not replace, the bundled kind reference.

## Public review repairs (rc.10)

Profile retrieval uses bounded individual author/relay queries rather than a shared feed limit. NIP-19 event IDs remain independent of optional author hints. See [review repairs and regression cases](docs/PUBLIC_REVIEW_REPAIRS.md). All 185 local JavaScript tests, 15 SDK Python tests, TypeScript and 62 module pins/183 API export checks passed; current repository CI and independent review are separate gates.

## Public migration and license

This candidate fixes premature NIP-46 relay connection and resolves IndexedDB writes only after commit. Public default moderation lists are empty; callers supply their own policies. Original software is MIT; see [LICENSE](LICENSE), [LICENSES.md](LICENSES.md), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [AI-DEVELOPMENT.md](AI-DEVELOPMENT.md). No npm registry publication is claimed.

## Project documentation

[Project](PROJECT.md) · [Architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md) · [Capabilities](CAPABILITIES.md) · [Security](SECURITY.md) · [Reuse](REUSE.md) · [UI scope](UI.md) · [Changelog](CHANGELOG.md) · [Release](RELEASE.md) · [Gaps](GAPS.md)

## Unreleased reconciliation: relay delivery

See [event-specific relay planning and receipt summaries](docs/RELAY_DELIVERY_RECONCILIATION.md). Offline, additive APIs; no transport changes or publication authorization. The existing rc.10 candidate version is not a new release.

## Blossom reconciliation (draft batch 2)

See [Blossom publishing reconciliation](docs/BLOSSOM_RECONCILIATION.md) for explicit BUD-06 metadata preflight, bounded BUD-11 multi-hash authorization templates and multi-origin readback with exact bytes, size and MIME. These are additive building blocks; multi-copy upload orchestration, gateway verification and application adoption remain open. No network publication is implied.
