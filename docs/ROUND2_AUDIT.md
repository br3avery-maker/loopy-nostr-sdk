# Round 2 Big-Picture Audit & Roadmap (`@chaoticka/nsite-loopy-sdk`)

This document captures the multi-loop Round 2 architectural, runtime, API, documentation, and TypeScript audit of `@chaoticka/nsite-loopy-sdk` against the core design priorities:

> **Reusable modular code · stateless · zero runtime dependencies · unbroken by switching bricks**

All **safe, low-risk small tweaks** uncovered during Loops 1–2 have been applied and verified directly. Larger structural refactors, cross-module moves, documentation regeneration, and TypeScript declaration overhauls are **documented and saved as Big Jobs below** for deliberate sequencing.

---

## 1. Executive Health Snapshot

| Area | Status | Notes |
|---|---|---|
| Zero runtime dependencies | **Clean** | `package.json` has zero `dependencies`; only 4 lazy dynamic `import('node:...')` calls exist in `src/archive/zip.js` and `src/storage/fs.js`. |
| Browser/Edge portability | **Clean** | Zero static `node:` imports, zero DOM globals (`window`, `document`, `localStorage`), zero unguarded `fetch()` calls outside `src/core/http.js` and `src/testing/index.js`. |
| Workflow integrity | **Clean** | All 4 `workflows/*.json` files resolve cleanly against live exports. |
| Brick swappability (`Storage`, `Signer`, `Transport`, `CAS`) | **Hardened (Round 2 tweaks)** | Fixed `fsStore` binary `Uint8Array` loss + unified `keys(prefix)` across all 4 `Storage` adapters and `createAccountSession`. |
| Layer DAG strictness | **2 cycles remain** | `blossom <-> nsite` and `nostr <-> moderation` (saved as **Big Job 1**). |
| Transport deduplication | **Duplicate framing/auth** | `src/nostr/pool.js` (885 lines) and `src/nostr/relay-transport.js` (382 lines) duplicate NIP-01 frame parsing and NIP-42 AUTH (saved as **Big Job 2**). |
| Module size balance | **3 large monoliths** | `ecosystemOptimizer.js` (1,281 lines), `engine.js` (947 lines), `directory/model.js` (578 lines) (saved as **Big Job 3**). |
| Documentation freshness | **Drift detected** | `docs/API_REFERENCE.md` is missing 85+ symbols; `CAPABILITIES.md` still cites `188` symbols vs `242` actual (saved as **Big Job 4**). |
| TypeScript strictness | **27 `any` + loose `object`** | `types/index.d.ts` has 24 `any` uses and bare `object` signatures; `tsc` not installed locally (saved as **Big Job 5**). |

---

## 2. Small Tweaks Applied in Round 2

Every item below was a confirmed behavioral bug, brick-swap break, or localized hygiene defect fixed with zero breaking API changes and covered by `tests/round2-tweaks.test.js`:

1. **`src/storage/fs.js` — Transparent `Uint8Array` persistence + `keys(prefix)`**:
   - *Bug*: `JSON.stringify` serialized `Uint8Array` as `{ "0": 104, ... }`, breaking `Archive.contentStore(Storage.fsStore(dir))` when swapping from `memoryStore` or `indexedDbStore` to disk.
   - *Fix*: Added tagged base64url round-trip serialization (`__loopy_u8__`) for `Uint8Array` values (top-level or nested) and implemented `keys(prefix = '')`.
2. **`src/storage/memory.js`, `scoped.js`, `indexeddb.js`, `src/core/session.js` — `keys(prefix)` contract parity**:
   - *Bug*: All storage adapters ignored the optional `prefix` argument in `keys(prefix)`, and `createAccountSession().storage.keys(prefix)` only matched the session prefix.
   - *Fix*: Every `StorageAdapter` now consistently filters keys by optional `prefix`.
3. **`src/core/http.js` — `boundedFetch` `read: 'json'` fallback for `text()`-only Responses**:
   - *Bug*: Mock or minimal `Response` objects implementing `text()` without `body`/`arrayBuffer()`/`json()` fell through to empty bytes and threw `invalid-json`.
   - *Fix*: Added `response.text()` fallback with full UTF-8 byte-length enforcement against `maxBytes`.
4. **`src/nostr/nip05.js` — Accurate private-domain error wording**:
   - *Bug*: Rejecting a private/local NIP-05 domain leaked `"Blossom endpoint"` from `Core.endpoint()`.
   - *Fix*: Validates host directly and throws `"Invalid or private NIP-05 domain; public named HTTPS domain required"`.
5. **`src/nostr/edit.js` & `src/intelligence/open-specs.js` — Removed upward `anchor` imports**:
   - *Fix*: Switched `classifyEventStorage` imports from `../anchor/kinds.js` to `../core/guards.js`, and hoisted `new Set(objectFields(next.content))` out of a `.filter()` loop in `src/nostr/edit.js`.
6. **`src/nostr/health-cache.js` — `savePolicy` freshness-window validation**:
   - *Bug*: `savePolicy` accepted arbitrary far-future or already-expired `observedAt` timestamps (unlike `saveMonitorEvent`).
   - *Fix*: Enforced `[now - policyTtl, now + 60]` bounds and threw `RangeError` on out-of-window values.
7. **`src/blossom/repair.js` — Single-GET verification on default repair upload**:
   - *Bug*: `repairBlobReplicas` performed a second `verifyBlobCopies` GET immediately after `uploadVerified` already fetched and verified SHA-256 + MIME.
   - *Fix*: Passed `expectedType` + `verifyContentType: true` and skipped the redundant second GET when using default `uploadVerified` (while keeping readback verification for custom uploaders).
8. **`src/index.js` — Immutable `createNsiteSDK` config**:
   - *Fix*: Cloned and froze `config` and `config.relays` inside `createNsiteSDK` so external mutations cannot corrupt a live SDK instance.
9. **`src/directory/model.js` — Prototype-key, live-endpoint & `publicCatalog` URL hardening**:
   - *Fix*: Filtered `isForbiddenKey` IDs in `setQueue`, canonicalized/validated live `servers` and `relays` via `Core.endpoint()` in `validatedLive`, and sanitized `url`/`status` through `safeURL()` in `publicCatalog` so direct calls on unvalidated site arrays cannot emit `javascript:` or `data:` URLs.
10. **`src/core/urls.js` — RFC 8375 `.home.arpa` local-domain rejection**:
    - *Fix*: Added `home.arpa` to `isPrivateOrLocalHost` alongside `.localhost`, `.local`, and `.internal`.
11. **`src/directory/metadata.js` — Bounded HTML metadata scanning**:
    - *Fix*: Sliced `htmlMetadata` input to `512 KiB` before regex extraction to prevent pathological backtracking on multi-MB malformed HTML pages.
12. **`src/moji/index.js` — Prototype-safe NIP-30 emoji shortcodes**:
    - *Fix*: Guarded `sanitizeEmojiShortcode` with `!isForbiddenKey(s)` so `__proto__`, `constructor`, and `prototype` cannot reach downstream shortcode-keyed maps.
13. **`src/anchor/index.js` — Expanded secret-field redaction in public backups**:
    - *Fix*: Extended `stripSecrets` to redact `apiKey`/`api_key`, `mnemonic`, and `seedPhrase`/`seed_phrase` in addition to `nsec`, `secret`, `privateKey`, `token`, `password`, `passphrase`, `bunkerUri`, and `authorization`.
14. **`src/nostr/other-nips.js` — NIP-98 lowercase HTTP method normalization**:
    - *Fix*: Normalized `method` via `.trim().toUpperCase()` in `httpAuthHeader` so `'post'` works cleanly and emits canonical uppercase `['method', 'POST']`.
15. **`src/nostr/store.js` — Prefix-scoped `storage.keys('evt:')` scans**:
    - *Fix*: Passed `EVT_PREFIX` to `storage.keys(EVT_PREFIX)` in `query()` and `keys()` (retaining the `startsWith` fallback guard for custom adapters) so shared stores avoid scanning unrelated keys.

### Loop 3–4 Static & Cross-Brick Security Confirmation
- **Zero** `eval` / `new Function`, **zero** `console.*` calls, and **zero** `globalThis` mutations across all 77 `src/**/*.js` files.
- **100% subpath export parity** across all 13 `package.json` runtime subpaths and matching `types/*.d.ts` declarations.
- **Verified brick swaps on disk (`Storage.fsStore`)**: `Archive.contentStore`, `Nostr.createEventStore` (with NIP-09 `a`-tag tombstones), and `Core.createAccountSession` all run cleanly against `fsStore` and `scopedStore`.
- **Verified NIP-59 anti-spoofing**: `unwrapGiftWrap` blocks forged `rumor.pubkey !== seal.pubkey` payloads and wrong-recipient unwraps.
- **Verified BIP-173 bech32 strictness**: `decodeNip19` accepts canonical uppercase/lowercase and rejects mixed-case identifiers.

---

## 3. Saved Big Jobs Roadmap (Pending Scope Selection)

The following five Big Jobs + Optional Protocol/Testing Bricks are intentionally saved for review before execution. Each can be tackled independently in its own clean batch.

### Big Job 1 — Strict 100% Acyclic Layer DAG & Shared Media/NIP-19 Bricks
- **Problem**:
  - **Cycle A (`blossom <-> nsite`)**: `src/blossom/client.js` and `src/blossom/repair.js` import `mediaType` from `src/nsite/files.js`, while `src/nsite/*` imports from `src/blossom/*`. In addition, MIME alias matching (`JS_MEDIA_TYPES`, `ICON_MEDIA_TYPES`, `contentTypeMatches`) is duplicated **3×** across `src/blossom/client.js`, `src/blossom/replicas.js`, and `src/nsite/resumable.js`.
  - **Cycle B (`nostr <-> moderation`)**: `src/nostr/client.js` and `src/nostr/follow-list.js` import NIP-19 decoders from `src/moderation/identity.js`, while `src/moderation/*` imports from `src/nostr/*`.
- **Proposed Change**:
  - Extract `src/core/media.js` (`mediaType`, `contentTypeMatches`, MIME alias tables) and re-export `mediaType` from `src/nsite/files.js` for backward compatibility.
  - Extract pure NIP-19 bech32/TLV codecs (`decodeNip19`, `noteEncode`, `nprofileEncode`, `neventEncode`, `naddrEncode`) into `src/nostr/nip19.js` and re-export from `src/moderation/identity.js`.
  - Add an automated layer-cycle check to `validation/verify_repo_audit.py` so cycles can never regress.
- **Impact / Risk**: High architectural payoff (true brick independence & tree-shaking), low runtime risk (zero breaking public exports).

### Big Job 2 — Unified Wire/NIP-42 Engine & Pooled Transport Injection
- **Problem**:
  - `src/nostr/pool.js` (885 lines) and `src/nostr/relay-transport.js` (382 lines) independently implement NIP-01 frame parsing, NIP-42 AUTH challenge/response handshakes, refusal-code classification, and WebSocket cleanup (~1,267 lines combined).
  - `createNsiteSDK` creates ephemeral per-call WebSockets for `query()`, `publish()`, `fetchFeed()`, `fetchProfiles()`, and `syncEventHistory()` instead of optionally reusing a caller-owned `RelayPool`.
- **Proposed Change**:
  - Extract a stateless internal `src/nostr/wire.js` brick (frame codec, refusal classifier, NIP-42 auth challenge builder/verifier).
  - Refactor both `relay-transport.js` and `pool.js` to share `wire.js` without changing any public signatures.
  - Optionally allow `createNsiteSDK({ pool })` (and high-level query/publish helpers) to reuse an injected `RelayPool` while preserving standalone zero-state calls when no pool is passed.
- **Impact / Risk**: High maintainability & mobile battery/socket efficiency; moderate testing scope (must preserve every existing transport/auth/pool edge-case test).

### Big Job 3 — Decompose Intelligence & Directory Monoliths + Defensive Input Normalization
- **Problem**:
  - `src/intelligence/ecosystemOptimizer.js` (1,281 lines / 69.7 KB), `src/intelligence/engine.js` (947 lines / 38.1 KB), and `src/directory/model.js` (578 lines / 21.3 KB) make up nearly half of the entire `src/` codebase.
  - Adversarial probing showed `Intelligence.analyzeAccountEcosystem` throws raw `TypeError` (`Cannot read properties of undefined (reading 'filter')`) when optional fields like `publications` are omitted instead of normalizing defaults gracefully.
- **Proposed Change**:
  - Split `ecosystemOptimizer.js` into focused stateless bricks (e.g., `src/intelligence/ecosystem/scoring.js`, `routing.js`, `diagnostics.js`, `recommendations.js`) with a thin orchestrator.
  - Split `engine.js` into focused analysis bricks (`relay-audit.js`, `manifest-audit.js`, `signer-audit.js`).
  - Add defensive input normalization so partial snapshots degrade cleanly with explicit warnings rather than crashing.
- **Impact / Risk**: Big win for readability, modularity, and unit-test granularity; zero public API breakage.

### Big Job 4 — Auto-Synced API Documentation, Capabilities Ledger & Batch 5–6 Examples
- **Problem**:
  - `docs/API_REFERENCE.md` is missing **85+ runtime exports** (still lists old counts `Core (11)`, `Nostr (37)`, `Blossom (4)`, `Storage (2)`, and omits `Intelligence` and `Testing`).
  - `CAPABILITIES.md` (`188` symbols), `PROJECT.md` (`65` pins / `188` exports), `README.md` (`185` tests / `62` pins / `183` exports), and `DEVELOPMENT.md` still quote rc.9/rc.10 numbers instead of the current verified baseline.
  - `examples/` lacks runnable examples for the Batch 5–6 bricks (`createRelayPool`, `createEventStore`, `repairBlobReplicas`, NIP-17/NIP-59 gift-wrap, `createAccountSession`, v2 `planNsitePublication -> publishNsite` with `resolveCurrent`, and `@chaoticka/nsite-loopy-sdk/testing`).
- **Proposed Change**:
  - Add a deterministic doc-sync/generator script (or integrate into `scripts/sync_manifest.py`) so `docs/API_REFERENCE.md` and current inventory metrics in `CAPABILITIES.md`, `PROJECT.md`, `README.md`, and `DEVELOPMENT.md` stay locked to `docs/API_INDEX.json` and fail CI on drift.
  - Add concise, runnable, offline-verifiable examples under `examples/` for pool + event store, replica repair, v2 resumable publication, gift-wrap DM round-trip, and mock harness usage.
- **Impact / Risk**: Very low risk, high developer-experience & audit-readiness payoff.

### Big Job 5 — Strict TypeScript Declarations (Eliminate `any` & Bare `object`)
- **Problem**:
  - `types/` currently contains **27 occurrences of `any`** (24 in `types/index.d.ts`, mostly `Socket?: any` and `emptyState(): any`) plus loose `object` params/returns across `Directory`, `Moderation`, `Moji`, `Anchor`, and `Archive`.
  - `npm run test:types` currently requires CI (no local `typescript` binary).
- **Proposed Change**:
  - Define strict structural interfaces (`WebSocketLike`, `DirectoryState`, `SiteRecord`, `CuratorPolicy`, `EmojiRecord`, `PublicAccountBackup`, `ArchiveCatalog`, etc.) across `types/*.d.ts`.
  - Expand `tests/types-consumer.ts` to assert strict narrowing (no implicit `any` leakage).
- **Impact / Risk**: Low runtime risk (declarations only), high payoff for downstream TypeScript consumers.

### Big Job 6 — Cross-Brick Contract Consistency & Facade Ergonomics
- **Problem** (surfaced during Loop 3–4 brick-swapping probes):
  - **Verb/Return Shape Asymmetry**: `createNsiteSDK().query()` returns `Event[]`, whereas `Nostr.createRelayPool().query()` returns `{ events, ... }`; `publishNsite()` v1 vs v2 return fields differ (`manifest` vs `event`/`receipt`).
  - **Option Naming Drift**: Blossom/Nsite bricks mix `server`, `storageServers`, and `servers` across `planNsitePublication`, `publishNsite`, `repairBlobReplicas`, and `createMockBlossom`.
  - **`createEventStore.put(ev, { verify: false })`**: Still re-runs Schnorr verification inside `eventIdentity(ev)` -> `verifiedCopy(ev)` for replaceable/addressable events even when caller explicitly passed `{ verify: false }` for pre-verified batches.
  - **Resumable v2 Publication Ergonomics**: `publishNsite` with `storageServers` rightly requires `approvedPlan` and `resolveCurrent`, but lacks an optional convenience helper that builds a default relay-backed `resolveCurrent` from the supplied `relays` + `Socket`.
- **Proposed Change**:
  - Keep 100% backward compatibility on existing signatures, add clean non-breaking normalization/helpers where safe, fix `createEventStore.put(..., { verify: false })` to compute identity without redundant re-verification, and publish a concise Cross-Brick Contract Table in `docs/API_REFERENCE.md`.
- **Impact / Risk**: Low risk, big ergonomic win for consumers composing bricks freely.

---

## 4. Optional Protocol & Testing Ergonomics (Backlog Ideas)

Smaller self-contained bricks to consider alongside or after Big Jobs 1–6:

1. **Multi-Relay Mock Router (`Testing.createMockRelayNetwork`)**: Combine multiple `createMockRelay()` instances behind a single URL-routing `Socket` class so `createNsiteSDK({ relays: [r1.url, r2.url], Socket })` and `createRelayPool` can be tested across heterogeneous relays (e.g., 1 healthy + 1 slow + 1 NIP-42 AUTH-gated + 1 rejecting).
2. **Pure Stateless Nostr Protocol Bricks** (zero dependencies):
   - **NIP-10** thread marker parser (`root` / `reply` / `mention` tags).
   - **NIP-21 / NIP-27** `nostr:` URI extractor & validator.
   - **NIP-57** zap receipt (`kind 9735`) cryptographic & tag verifier.
3. **Pre-Release Hygiene**: Remove temporary `scripts/dev_preview.mjs` (already excluded from `npm pack`) when preparing a final npm release tarball.
