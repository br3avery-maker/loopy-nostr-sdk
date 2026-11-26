# Public API reference — Nsite Loopy SDK 1.1.1-rc.10

> Generated deterministically from `docs/API_INDEX.json` and `package.json` via `python3 scripts/sync_docs.py --write`.

`import { createNsiteSDK, Core, Nostr, Nsite, Blossom, Archive, Directory, Storage, Adapters, Moderation, Moji, Anchor, Intelligence, Testing } from '@chaoticka/nsite-loopy-sdk';`

- **Runtime API inventory**: 246 symbols across 13 namespaces (plus `createNsiteSDK` facade).
- **Machine-readable index**: `docs/API_INDEX.json`
- **TypeScript declarations**: `types/index.d.ts` and per-namespace subpath `.d.ts` files (strict typed, zero `any`).
- **Side-effect free**: importing any namespace performs zero network, storage, or signing I/O.

## Facade

`createNsiteSDK(options?)` accepts `{ relays?, server?, signer?, storage?, pool?, Socket?, fetcher?, clock? }` and returns:

- All 12 core/domain namespaces (`core`, `nostr`, `nsite`, `blossom`, `archive`, `directory`, `storage`, `adapters`, `moderation`, `moji`, `anchor`, `intelligence`) plus normalized `options`.
- `publish(files, overrides?)` — runs `Nsite.publishNsite` using configured defaults (resolving `pubkey` from `signer` when omitted).
- `query(filter, overrides?)` — queries a single `relay` or multiple `relays`, reusing an injected `RelayPool` (`overrides.pool || options.pool`) when provided and returning deduplicated, sorted `SignedEvent[]`.
- `close({ closePool = true } = {})` — closes configured `storage` and (unless `closePool: false`) configured `pool`.

## Subpath imports

| Subpath | Entry module | Type declarations |
| --- | --- | --- |
| `@chaoticka/nsite-loopy-sdk` | `./src/index.js` | `./types/index.d.ts` |
| `@chaoticka/nsite-loopy-sdk/core` | `./src/core/index.js` | `./types/core.d.ts` |
| `@chaoticka/nsite-loopy-sdk/nostr` | `./src/nostr/index.js` | `./types/nostr.d.ts` |
| `@chaoticka/nsite-loopy-sdk/nsite` | `./src/nsite/index.js` | `./types/nsite.d.ts` |
| `@chaoticka/nsite-loopy-sdk/blossom` | `./src/blossom/index.js` | `./types/blossom.d.ts` |
| `@chaoticka/nsite-loopy-sdk/archive` | `./src/archive/index.js` | `./types/archive.d.ts` |
| `@chaoticka/nsite-loopy-sdk/directory` | `./src/directory/index.js` | `./types/directory.d.ts` |
| `@chaoticka/nsite-loopy-sdk/storage` | `./src/storage/index.js` | `./types/storage.d.ts` |
| `@chaoticka/nsite-loopy-sdk/adapters` | `./src/adapters/index.js` | `./types/adapters.d.ts` |
| `@chaoticka/nsite-loopy-sdk/moderation` | `./src/moderation/index.js` | `./types/moderation.d.ts` |
| `@chaoticka/nsite-loopy-sdk/moji` | `./src/moji/index.js` | `./types/moji.d.ts` |
| `@chaoticka/nsite-loopy-sdk/anchor` | `./src/anchor/index.js` | `./types/anchor.d.ts` |
| `@chaoticka/nsite-loopy-sdk/intelligence` | `./src/intelligence/index.js` | `./types/intelligence/index.d.ts` |
| `@chaoticka/nsite-loopy-sdk/testing` | `./src/testing/index.js` | `./types/testing.d.ts` |

## Cross-brick contracts

| Brick pair / boundary | Exact contract |
| --- | --- |
| `createNsiteSDK({ pool })` + `Nostr.createRelayPool` | `sdk.query(filter)` returns `SignedEvent[]` (matching unpooled `queryRelay`), throwing only if every relay fails; `pool.query(relays, filter)` returns `{ events, relays, failed }`. |
| `Nsite.publishNsite` (v2) + `Nsite.createRelayRevisionResolver` | Pass `resolveCurrent: Nsite.createRelayRevisionResolver({ relays, pool, Socket })` to v2 `publishNsite`; returns newest verified manifest `SignedEvent`, `null` on `not-found`, or throws on unreachable/invalid relays. |
| `Nostr.createEventStore` + `{ verify: false }` | Skips redundant BIP-340 re-verification for pre-verified regular, replaceable, and addressable events while strictly validating shape, hex IDs/pubkeys, and integer timestamps. |
| `Nostr.createRelayHealthCache` + `Nostr.planRelayDelivery` | `await healthCache.exportForDelivery({ now })` returns `{ observations, relayPolicies, monitorEvents }`, spreading directly into `planRelayDelivery(event, { ...exported })`. |
| `Core.boundedFetch(url, init, options)` | 3-argument signature: `(url, fetchInit, { fetcher, timeoutMs, maxBytes, signal, read, acceptRedirects })`. |
| `Storage.scopedStore(adapter, namespace)` | Isolates keys under `${namespace}:`; `namespace` must be non-empty and must not contain `:`. |
| `Core.mediaType` / `Nsite.mediaType` | Single shared implementation in `src/core/media.js` (`mediaType`, `baseMediaType`, `contentTypeMatches`). |
| `Nostr.decodeNip19` / `Moderation.decodeNip19` | Single shared implementation in `src/nostr/nip19.js` (`decodeNip19`, `noteEncode`, `nprofileEncode`, `neventEncode`, `naddrEncode`). |

## Core (34 exports)

Stateless primitives for bytes, UTF-8, hex, Base64/Base64url, SHA-256, MIME/media-type matching (`mediaType`, `baseMediaType`, `contentTypeMatches`), canonical URL/endpoint/path/slug validation, bounded HTTP reads (`boundedFetch`), bounded async concurrency (`mapLimit`), runtime capability checks, account session invalidation (`createAccountSession`), and versioned schema migrations (`migrateSchema`).

- **Functions (34)**: `assertHex`, `assertSafeHttpUrl`, `assertSafeInt`, `baseMediaType`, `boundedFetch`, `bytes`, `canonicalGatewayHost`, `checkRuntimeCapabilities`, `classifyEventStorage`, `contentTypeMatches`, `createAccountSession`, `decode`, `defaultFetch`, `encode`, `endpoint`, `endpoints`, `fromBase64Url`, `hasLoneSurrogate`, `hex`, `isForbiddenKey`, `isHex`, `isPrivateOrLocalHost`, `mapLimit`, `mediaType`, `migrateSchema`, `normalizeOptions`, `nsitePath`, `safeHttpUrl`, `sdkError`, `sha256`, `slug`, `toBase64`, `toBase64Url`, `unhex`

## Nostr (58 exports)

BIP-340 Schnorr signing/verification, canonical event templates and replacement review, NIP-07/46/55 signers and reconnectable bunker descriptors, NIP-19 codecs, NIP-05 verification, NIP-11 metadata, NIP-42 relay auth, NIP-65 relay lists and update planning, NIP-98 HTTP auth, NIP-09 deletion templates, NIP-17/59 gift-wrap DMs (`rumorTemplate`, `sealTemplate`, `giftWrapEvent`, `unwrapGiftWrap`), single-shot and pooled relay transports (`queryRelay`, `subscribeRelay`, `createRelayPool`), persistent `StorageAdapter`-backed event store (`createEventStore`), relay health cache (`createRelayHealthCache`), and event-specific relay delivery planning/execution (`planRelayDelivery`, `executeRelayDelivery`).

- **Functions (58)**: `androidIntent`, `assertSignedEvent`, `blossomServers`, `browserSigner`, `bunkerSigner`, `checkedSign`, `collectEventObservations`, `connectIdentity`, `createBunkerSessionDescriptor`, `createEventStore`, `createRelayHealthCache`, `createRelayPool`, `decodeNip19`, `deletionTemplate`, `discoverBlossom`, `discoverRelays`, `encryptionAdapter`, `eventIdentity`, `eventTemplate`, `executeRelayDelivery`, `fetchFeed`, `fetchProfiles`, `finalizeEvent`, `generateSecretKey`, `getPublicKey`, `giftWrapEvent`, `httpAuthHeader`, `naddrEncode`, `neventEncode`, `nostrConnectRequest`, `noteEncode`, `nprofileEncode`, `npubEncode`, `parseProfile`, `planRelayDelivery`, `planRelayListUpdate`, `planRelays`, `prepareEventReplacement`, `publishMany`, `publishRelay`, `publishTemplate`, `queryRelay`, `reaction`, `relayAuthTemplate`, `relayInfo`, `relayList`, `restoreBunkerSigner`, `reviewEventReplacement`, `rumorTemplate`, `sealTemplate`, `subscribeRelay`, `summarizeRelayDelivery`, `syncEventHistory`, `textNote`, `unwrapGiftWrap`, `verifyAndroidResult`, `verifyEvent`, `verifyNip05`

## Nsite (16 exports)

NIP-5A root (kind `15128`) and named (kind `35128`) static site addressing, file-map normalization, cross-platform path portability checks (`checkPortablePaths`), deterministic manifest preparation and parsing, digest-bound publication plans (`planNsitePublication`), v1 and opt-in v2 multi-copy resumable publication (`publishNsite`), verified retrieval (`resolveNsiteManifest`, `resolveManifestPath`, `loadNsiteFile`), and live/pooled baseline revision resolver (`createRelayRevisionResolver`).

- **Constants (2)**: `NSITE_NAMED_KIND`, `NSITE_ROOT_KIND`
- **Functions (14)**: `checkPortablePaths`, `compareFiles`, `createRelayRevisionResolver`, `loadNsiteFile`, `manifestTemplate`, `mediaType`, `normalizeFileMap`, `nsiteAddress`, `parseManifest`, `planNsitePublication`, `prepareManifestFiles`, `publishNsite`, `resolveManifestPath`, `resolveNsiteManifest`

## Blossom (9 exports)

BUD-01/BUD-06/BUD-11 unsigned upload and batch authorization templates, exact-byte verified uploads with optional Content-Type checks (`uploadVerified`), multi-server verified retrieval (`fetchVerified`), multi-origin copy verification (`verifyBlobCopies`), unreferenced blob auditing (`findUnreferencedBlobs`), and replica repair (`repairBlobReplicas`).

- **Functions (9)**: `blossomAuthHeader`, `blossomBatchUploadAuth`, `blossomUploadAuth`, `fetchVerified`, `findUnreferencedBlobs`, `preflightBlob`, `repairBlobReplicas`, `uploadVerified`, `verifyBlobCopies`

## Archive (20 exports)

Deterministic stored and async DEFLATE ZIP reading/writing (`readZip`, `writeZip`, `writeZipAsync`), CRC32, Gear CDC chunking (`GEAR_PROFILE`, `gearChunks`, `chunkManifest`, `restoreChunkManifest`), content-addressed blob store (`contentStore`), version diffing and materialization, searchable archive catalogs, lossless Markdown source comparison (`compareMarkdown`), and kind `1349` signed revision snapshots (`snapshotTemplate`, `unwrapSnapshot`, `archiveRevision`, `restoreRevision`).

- **Constants (2)**: `GEAR_PROFILE`, `SNAPSHOT_KIND`
- **Functions (18)**: `archiveRevision`, `buildArchiveCatalog`, `chunkManifest`, `compareMarkdown`, `contentStore`, `crc32`, `diffVersions`, `gearChunks`, `groupVersions`, `materializeVersion`, `readZip`, `restoreChunkManifest`, `restoreRevision`, `searchArchive`, `snapshotTemplate`, `unwrapSnapshot`, `writeZip`, `writeZipAsync`

## Directory (31 exports)

Versioned Nsite directory workspace curation: schema validation/upgrade, rules matching, clone stacking/unstacking, bulk collection grouping, queue navigation, publisher counts, safe URL/image normalization, static HTML metadata extraction, and reversible public/full catalog exports.

- **Constants (3)**: `SORTS`, `VERSION`, `defaultRules`
- **Functions (28)**: `ageSeconds`, `bulkGroup`, `directoryRows`, `effective`, `emptyState`, `exportCatalog`, `groupState`, `htmlMetadata`, `matches`, `membership`, `moveQueue`, `patch`, `publicCatalog`, `publisherCounts`, `publisherKey`, `reasons`, `safeImage`, `safeURL`, `select`, `setQueue`, `similarityKey`, `stackSites`, `toggleState`, `unstack`, `upgrade`, `validateCatalog`, `validateRules`, `validateWorkspace`

## Storage (4 exports)

Unified async `StorageAdapter` contract (`get`/`set`/`delete`/`keys`/`close?`) with in-memory (`memoryStore`), browser IndexedDB (`indexedDbStore`), Node filesystem (`fsStore`), and namespace-isolated wrapper (`scopedStore`) adapters.

- **Functions (4)**: `fsStore`, `indexedDbStore`, `memoryStore`, `scopedStore`

## Adapters (2 exports)

Host capability detection (`browserEnvironment`) and Android NIP-55 correlated intent handoff (`androidHandoff`). Requires an explicit host callback on Android; never fakes login from a URL click.

- **Functions (2)**: `androidHandoff`, `browserEnvironment`

## Moderation (24 exports)

Deterministic spam campaign detection (`campaignMatch`, `inspectNsiteSpam`, `clusterNsiteSpam`, `filterNsites`), curator blocklist parsing/merging, NIP-51 mute lists (`parseNip51MuteList`, `muteListTemplate`), compiled emoji policy filters (`compileEmojiPolicy`, `isEmojiAllowed`), and NIP-19/hex normalization helpers. Public default ban lists are empty; callers provide explicit policies.

- **Constants (5)**: `BUILT_IN_NSFW_BAN_PUBKEYS`, `BUILT_IN_NSFW_BLOB_HASHES`, `BUILT_IN_NSFW_MEDIA_URLS`, `CAMPAIGN_ROLE_OPENERS`, `MOJI_CURATOR_BLOCKLIST_VERSION`
- **Functions (19)**: `campaignMatch`, `clusterNsiteSpam`, `compileEmojiPolicy`, `decodeNip19`, `filterNsites`, `inspectNsiteSpam`, `isEmojiAllowed`, `mergeBlocklists`, `muteListTemplate`, `naddrEncode`, `neventEncode`, `normalizeEmojiHash`, `normalizeHashList`, `normalizePubkey`, `normalizePubkeyList`, `noteEncode`, `nprofileEncode`, `parseCuratorBlocklist`, `parseNip51MuteList`

## Moji (7 exports)

Stable SHA-256 or canonical URL emoji identity (`extractEmojiHash`, `buildStableEmojiKey`), shortcode sanitization, deterministic hash-driven stats (`deriveEmojiStatsFromHash`, `deriveEmojiStats`), and verified NIP-30 pack extraction (`parseNip30Event`, `collectNip30Emojis`).

- **Functions (7)**: `buildStableEmojiKey`, `collectNip30Emojis`, `deriveEmojiStats`, `deriveEmojiStatsFromHash`, `extractEmojiHash`, `parseNip30Event`, `sanitizeEmojiShortcode`

## Anchor (9 exports)

Public-only account backup/restore without private credentials (`sanitizePublicSession`, `buildPublicAccountBackup`, `restorePublicAccountBackup`), receipt summaries (`summarizePublicationReceipts`), verified event asset extraction (`extractEventAssets`), event storage classification, kind specs, and evidence-backed outbox planning (`assessRelayOutbox`, `planVerifiedOutbox`).

- **Functions (9)**: `assessRelayOutbox`, `buildPublicAccountBackup`, `classifyEventStorage`, `extractEventAssets`, `kindSpec`, `planVerifiedOutbox`, `restorePublicAccountBackup`, `sanitizePublicSession`, `summarizePublicationReceipts`

## Intelligence (28 exports)

Host-independent advisory rules for preference reconstruction (`reconstructPreferences`), root-vs-named nsite safety (`analyzeNsiteIdentity`), intelligent content preparation (`detectAndPrepareContent`), relay/media coverage auditing (`auditCoverage`), relay role classification (`classifyRelay`, `buildRelayOptimizationPlan`), single-release and full-account ecosystem optimization (`auditSinglePublication`, `analyzeAccountEcosystem`), and signed Open Specs discovery/indexing (`parseOpenSpec`, `indexOpenSpecs`, `queryOpenSpecs`, `lookupKindDefinitions`).

- **Constants (9)**: `CANDIDATE_DISCOVERY_RELAYS`, `ECOSYSTEM_CLIENTS`, `ECOSYSTEM_DISCOVERY_RELAYS`, `LICENSE_GUIDE`, `LICENSE_OPTIONS`, `MUSIC_GENRE_SUGGESTIONS`, `NIP_KIND_REGISTRY`, `OPEN_SPEC_KIND`, `OPEN_SPEC_READ_RELAYS`
- **Functions (19)**: `analyzeAccountEcosystem`, `analyzeNsiteIdentity`, `auditCoverage`, `auditSinglePublication`, `buildRelayOptimizationPlan`, `classifyEventStorage`, `classifyRelay`, `detectAndPrepareContent`, `getKindSpec`, `getLicensesForCategory`, `indexOpenSpecs`, `isSuitablePublicOutboxRole`, `lookupKindDefinitions`, `parseOpenSpec`, `queryOpenSpecs`, `reconstructPreferences`, `recordCorrection`, `roleClassLabel`, `summarizeObservedActivity`

## Testing (4 exports)

Zero-dependency offline test harnesses for SDK consumers: disposable BIP-340/NIP-44 test signers (`createTestSigner`), in-memory NIP-01/NIP-42 mock WebSocket relays (`createMockRelay`), in-memory BUD-01/06/11 mock Blossom servers (`createMockBlossom`), and strict browser-like fetch enforcement (`withStrictBrowserFetch`).

- **Functions (4)**: `createMockBlossom`, `createMockRelay`, `createTestSigner`, `withStrictBrowserFetch`

## Failure states and honesty boundaries

- Errors are never silently converted into empty results or verified receipts: failed relays, missing readback, signature mismatches, corrupt ZIP/CAS payloads, and unreachable baseline checks throw or return explicit failure diagnostics.
- Local offline examples and tests (using `Testing` mocks) exercise real BIP-340 cryptography, NIP-5A manifest hashing, ZIP codecs, and protocol state machines, but are distinct from live relay/Blossom deployment or physical Android device verification.

## Companion guides

- [Options](OPTIONS.md) · [Cross-donor transport](CROSS_DONOR_TRANSPORT.md) · [History sync](CROSS_DONOR_HISTORY.md) · [Publication & plans](CROSS_DONOR_PUBLICATION.md) · [Verified retrieval](CROSS_DONOR_RETRIEVAL.md) · [Archive & snapshots](CROSS_DONOR_ARCHIVE.md)
- [Relay delivery reconciliation](RELAY_DELIVERY_RECONCILIATION.md) · [Relay auth reconciliation](RELAY_AUTH_RECONCILIATION.md) · [Blossom reconciliation](BLOSSOM_RECONCILIATION.md) · [Publication v2 reconciliation](PUBLICATION_RECONCILIATION.md)
- [Anchor intelligence](ANCHOR_INTELLIGENCE.md) · [Open Specs registry](OPEN_SPECS.md) · [Round 2 audit](ROUND2_AUDIT.md)
