# Backend Code Audit, Systemic Review & Improvement Roadmap

Date: 2026-11-25 (Remediation & Brick Expansion Batches 0–6 completed 2026-11-26)  
Target: `@chaoticka/nsite-loopy-sdk` (`1.1.1-rc.10`)  
Scope: Complete four-pass audit of every module in `src/`, `types/`, `vendor/nostr.js` boundaries, `package.json`, `scripts/`, `validation/`, `examples/`, `workflows/`, `skills/`, and `.github/workflows/`, followed by stateless zero-dependency modular remediation and brick expansion across Batches 0–6.

## Remediation & Verification Snapshot (Batches 0–6 Complete)

- **Batch 0 (Guardrails)**: Added `scripts/sync_manifest.py` (SHA-256 pin sync + bidirectional runtime / `docs/API_INDEX.json` / `types/index.d.ts` / subpath `.d.ts` parity) and temporary `scripts/dev_preview.mjs` preview server on port 3000.
- **Batch 1 (`src/core/`)**: Extracted shared stateless zero-dependency brick contracts (`bytes.js`, `guards.js`, `http.js`, `urls.js`, `options.js`, `concurrency.js`, `index.js`) covering canonical endpoint/host/gateway/path/slug validation, safe HTTP URLs, prototype-key guards, `classifyEventStorage`, `boundedFetch`, `sdkError`, `checkRuntimeCapabilities`, `decode`/`fromBase64Url`, and `mapLimit`.
- **Batch 2 (Transport, Signers, Blossom, Storage, Adapters)**: Hardened `src/nostr/*`, `src/blossom/*`, `src/storage/*` (including `Storage.scopedStore`), and `src/adapters/*` against trailing-dot local-host bypasses, NIP-42/NIP-46/NIP-55 edge cases, stream byte caps, redirect/timeout leaks, and corrupt storage records.
- **Batch 3 (Domain Modules, Subpath Types & Unified Facade)**: Hardened `src/nsite/*`, `src/archive/*` (browser-native `DecompressionStream('deflate-raw')` ZIP support, zero-copy `Uint8Array` CAS), `src/directory/*`, `src/moderation/*`, `src/moji/*`, `src/anchor/*`, `src/intelligence/*`, upgraded `createNsiteSDK` with multi-relay deduplicated `query()` + `close()`, and added typed subpath exports (`./core`..`./anchor`) in `package.json` and `types/*.d.ts`.
- **Batch 4 (Final 7 Audit Closures & Publication v2.5)**: Closed all remaining confirmed audit defects: `parseCuratorBlocklist` context-aware hex-hash classification (`#1b`), `restorePublicAccountBackup` `preferences` restoration & `summarizePublicationReceipts` canonical relay dedup (`#7c/d`), `PENDING_BLOB_UPLOAD` readiness blocking (`#13b`), `resolveNsiteManifest` resolved-outbox non-fatal `'not-found'` (`#17a`), `verifyBlobCopies` granular failure codes, icon MIME alias & bounded concurrency (`#23`), `planNsitePublication` `mimeConflicts` surfacing & SHA-256 upload deduplication + opt-in `preflight`/`batchAuth`/`gatewayTimeoutMs`/`gatewayConcurrency`/`onProgress` (`#24`), `buildArchiveCatalog` duplicate event-ID dedup (`#25b`), and Python archive cumulative byte/ratio/manifest bounds (`#27f/g`).
- **Batch 5 (Modular Stateless Bricks)**: Added zero-dependency stateless bricks: `Nostr.subscribeRelay` & `Nostr.createRelayPool` (multiplexed WebSockets + per-principal NIP-42 AUTH caching), `Nostr.createEventStore` & `Nostr.deletionTemplate` (NIP-01 replacement + author-matched NIP-09 tombstones), full NIP-19 entity encoders (`noteEncode`, `nprofileEncode`, `neventEncode`, `naddrEncode`), explicit opt-in `Nostr.verifyNip05`, `Nostr.planRelayListUpdate` (dual-broadcast migration), lazy-imported atomic `Storage.fsStore`, and `Blossom.findUnreferencedBlobs` + `Blossom.repairBlobReplicas`.
- **Batch 6 (Optimization, Privacy, Ergonomics & Consumer Test Kit)**: Added single-GET SHA-256 + MIME verification in `Blossom.uploadVerified` & `publishResumable`, durable TTL-bounded `Nostr.createRelayHealthCache` (composing directly with `planRelayDelivery`), NIP-17/NIP-59 gift-wrap builders (`Nostr.rumorTemplate`, `Nostr.sealTemplate`, `Nostr.giftWrapEvent`, `Nostr.unwrapGiftWrap`), static-site ergonomics (`Nsite.checkPortablePaths`, opt-in `emptyFiles: 'skip'` & `strictPortablePaths`, `Archive.writeZipAsync` DEFLATE writer), session & schema bricks (`Core.createAccountSession`, `Core.migrateSchema`, `Nostr.createBunkerSessionDescriptor`, `Nostr.restoreBunkerSigner`, NIP-46 `ping()`), and the exported `@chaoticka/nsite-loopy-sdk/testing` kit (`createTestSigner`, `createMockRelay`, `createMockBlossom`, `withStrictBrowserFetch`).
- **Verification**: All **283 / 283** offline Node tests passing (`npm test`), **35 / 35** Python unit tests passing, `scripts/sync_manifest.py --check` **PASS** (79 module pins, 242 API symbols across root and all 12 subpath `.d.ts` files), `validation/verify_package.py` **PASS**, `validation/verify_repo_audit.py` **PASS**, `scripts/check_starter.py --mode ready .` **READY**, runnable examples **PASS**. (`tsc` typecheck runs in CI since `typescript` is not installed locally; live relay/device verification remains separately gated.)

## Baseline Audit Snapshot (Pre-Remediation)

- `npm test`: **237 / 237 passing** (offline Node test suite).
- `python3 validation/verify_package.py`: **PASS** (65 SHA-256 module pins, 189 API symbols).
- `python3 validation/verify_repo_audit.py`: **PASS** (15 capability records).
- `python3 scripts/check_starter.py --mode ready .`: **READY** (0 unfilled markers, 0 errors).
- Runtime vs `docs/API_INDEX.json` vs `types/index.d.ts` vs `types/intelligence/*.d.ts` & `workflows/*.json` symbol parity: **0 missing / 0 stale symbols** (verified programmatically; however, several `.d.ts` parameter/return types drifted from runtime behavior — see #28).
- Runnable examples (`examples/offline-publish-plan.js`, `examples/archive-cas.js`): **PASS**.
- `npm run test:types`: **FAIL locally (`tsc: not found`)** — CI installs `typescript@5.6.3` out-of-band in `.github/workflows/verify.yml:21` rather than declaring `devDependencies`.

---

## Executive Review: The Larger Picture (8 Systemic Root Causes)

Across four full passes covering all 12 namespaces, `vendor/nostr.js`, `types/`, `workflows/`, `examples/`, and `scripts/`, we confirmed **33 distinct defect groups** (30 empirically reproduced via Node probes) and **10 performance/scalability bottlenecks**. Almost every issue traces back to **eight systemic architectural root causes** — fixing these root causes cleanly resolves whole clusters of bugs at once rather than playing whack-a-mole:

1. **Hardening drift between newer and older sibling APIs**: Security and reliability hardening landed incrementally (`rc.1`–`rc.10` + reconciliation batches 1–4). Newer paths (`publishRelay`, `planRelayDelivery`, `fetchProfiles`, `fetchVerified`, `bunkerSigner`, `validateCatalog`) have strict bounds, cancellation, and input validation, while older or parallel siblings (`queryRelay`, `fetchFeed`, `discoverRelays`/`discoverBlossom`, `uploadVerified`, `nostrConnectRequest`, `verifyAndroidResult`, `Directory.patch`, `nsiteAddress`, `textNote`, `relayInfo`, `planVerifiedOutbox`) retained earlier, weaker assumptions.
2. **Duplicated security-critical validators**: URL/hostname validation is hand-rolled across 8+ files (`core/urls.js`, `blossom/replicas.js`, `nostr/delivery.js`, `nostr/other-nips.js`, `intelligence/relayIntelligence.js`, `intelligence/engine.js`, `anchor/relays.js`, `nsite/plan.js`, `nsite/manifest.js`, `moderation/identity.js`), causing trailing-dot local-host bypasses (`planRelayDelivery`), `:443` negative-evidence bypasses (`buildRelayOptimizationPlan`), trailing-slash false `critical` coverage alarms (`auditCoverage`), unvalidated `followRelayCounts`, and deduplication mismatches. Hex validation and kind storage-class logic are similarly fragmented across modules.
3. **Weak untrusted-data & output boundaries**: Untrusted network/backup/draft inputs cross boundaries without uniform scheme, prototype, or readiness sanitization: `parseProfile` passes `javascript:`/`data:` URLs; `androidIntent` accepts `javascript:` `callbackUrl`; `verifyAndroidResult` allows omitted `requestId`/`returnedId`; `bunkerSigner` lets `vendor/nostr.js` fire an unguarded HTTPS NIP-05 fetch before `connect()`; `Anchor.stripSecrets` allows `__proto__` prototype mutation on parsed backups and leaks `nsec1`/`bunker://` values in non-secret keys while silently dropping `preferences`; `Directory.patch` and `effective` mishandle prototype keys (`__proto__`, `toString`); and `Intelligence` marks drafts `readyToPublish: true` with 32-char invalid NIP-5A `dTag`s, `../` paths, literal `"pending-sha256"` placeholders, and unvalidated `javascript:` `externalImageUrl` `imeta` tags.
4. **Unconnected reconciliation islands**: Batches 2–4 built strong primitives (`preflightBlob`, `blossomBatchUploadAuth`, `verifyBlobCopies`, `planRelayDelivery`, `executeRelayDelivery`, NIP-42 `publishRelay`), but top-level flows (`publishNsite`, `publishResumable`, `uploadVerified`, `createNsiteSDK`) do not compose them yet—leaving N×M signer prompts, triple full-blob downloads, and no NIP-42 relay-auth plumbing for nsite publishing.
5. **Broken feedback loops & lossy error surfaces**: Lower layers drop or omit machine-readable error codes (`publishRelay` omits `.code` on auth/send/readback errors and ignores `EOSE` on readback; `queryRelay` drops `CLOSED` reasons; `publishResumable` collapses upload failures to `{ status: 'failed' }`; `verifyBlobCopies` collapses all readbacks to `'readback-unverified'`; `verifiedReceipts` drops `authenticated`). As a result, higher-level planners (`executeRelayDelivery` -> `planRelayDelivery`) misclassify auth/network faults as 5-minute `'rejected'` bans, and wall-clock timestamps vs caller `now` cause returned observations to be silently discarded.
6. **Connection-per-call & strictly sequential I/O**: Every relay query/publish opens and closes a fresh WebSocket, and uploads, replica checks, preflights, gateway checks, and coordinate rechecks run sequentially—causing severe latency, 30s sequential `checkGateway` failures on moderate sites, and redundant full-file downloads across every storage mirror even after `requiredCopies` is met.
7. **Packaging, types, and facade drift**: Subpath `exports` lack TypeScript `"types"` conditions, `types/index.d.ts` omits several runtime options/overloads, `createNsiteSDK().query()` ignores all relays after `relays[0]`, `verify_package.py` only checks one direction of API parity, and `npm run verify` fails locally without `typescript` in `devDependencies`.
8. **Browser vs. Node runtime portability traps**: Because all 237 automated tests run only in Node.js (Undici), browser-only failures go undetected—most critically, 7 modules default `fetcher = globalThis.fetch` (or `fetch`) and invoke it detached, which passes in Node but throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` in Chrome, Firefox, and Safari; alongside Node-only `node:zlib` in `readZip`, O(n²) browser base64 encoding, IndexedDB open/version lifecycle traps, and load-time `fetch` capture in `vendor/nostr.js`.

---

## Part 1: Confirmed Bugs, Correctness Defects & Security Gaps

Items marked **[Reproduced]** were verified directly against `src/index.js` via Node.js repro probes.

### Critical & High Priority (Security, Trust Boundaries & Data Integrity)

1. **`parseCuratorBlocklist` merges allowlisted `safePubkeys` into the ban list AND misclassifies plain 64-hex blob hashes as pubkeys** **[Reproduced]**
   - **Location**: `src/moderation/lists.js:10, 12`
   - **Evidence**:
     - Line 12: `for (const k of ['blockedPublishers','nsfwBanPubkeys','pubkeys','safePubkeys'])` pushes every `safePubkeys` entry directly into `pubs` (the ban list).
     - Line 10: `entry(obj)` runs `const p = normalizePubkey(obj), h = normalizeEmojiHash(obj); if (p) pubs.push(p); else if (h) hashes.push(h);`. Because any 64-char hex string satisfies `normalizePubkey`, plain 64-hex SHA-256 emoji hashes in `media`, `blocked`, or top-level arrays are always classified into `pubkeys` (`emojiHashes: []`).
   - **Fix**: Remove `'safePubkeys'` from the blocklist loop (return separately if needed), and pass a context hint (`'pubkey'` vs `'hash'` vs `'auto'`) so `media`/hash fields classify 64-hex strings into `emojiHashes`.

2. **Trailing-dot bypass of local/internal relay hint guard in `planRelayDelivery`** **[Reproduced]**
   - **Location**: `src/nostr/delivery.js:108-113`
   - **Evidence**: `safeHint` checks `!/\.(?:localhost|local|internal)$/.test(host)` without stripping a trailing dot (`host.replace(/\.$/, '')`). Signed kind-10002 hints `wss://admin.internal./` and `wss://app.localhost./` are selected as delivery targets.
   - **Fix**: Canonicalize trailing dots in one shared `Core.endpoint()` / host-policy helper and use it in `safeHint`.

3. **`Directory.patch`, `bulkGroup`, `effective`, and `validateWorkspace` prototype-key & malformed-input flaws** **[Reproduced]**
   - **Location**: `src/directory/model.js:5, 11-13, 29, 36`
   - **Evidence**:
     - `Directory.patch(state, ['__proto__'], { hidden: true })` mutates `Object.getPrototypeOf(state.edits)`, leaking edits onto every site in the workspace. (`bulkGroup` has the same unguarded ID loop.)
     - `state.edits` is a plain `{}` instead of `Object.create(null)`, so a valid catalog site with `id: 'toString'` triggers `Boolean(state.edits['toString']) === true` and is falsely excluded from `curation: 'unedited'` in `directoryRows`.
     - `validateWorkspace` crashes with raw `TypeError` on non-array `separateCopies` (`123`), non-iterable `queue.ids`, or `null` entries in `stacks`/`screenshots`; accepts non-object `w.edits` strings; and validates `live.relays` only via `startsWith('wss://')`. `validatedLive` accepts arbitrary unvalidated strings in `servers`/`relays`.
   - **Fix**: Reject prototype keys (`__proto__`, `constructor`, `prototype`) in `patch`/`bulkGroup`, check `Object.hasOwn(state.edits, id)` (or `Object.create(null)`), defensively check types in `validateWorkspace`, and validate endpoints via `Core.endpoint()`.

4. **`verifyAndroidResult` bypasses correlation check when `requestId` is omitted; `androidIntent` allows `javascript:` `callbackUrl`; `androidHandoff` leaks unhandled rejections** **[Reproduced]**
   - **Location**: `src/nostr/nip55.js:3-20`; `src/adapters/android.js:5`
   - **Evidence**:
     - `verifyAndroidResult({ event, template, expectedPubkey })` evaluates `undefined !== undefined` (`false`) and succeeds with zero correlation ID verification.
     - `androidIntent` does not validate `callbackUrl` (accepts `javascript:alert(1)`), does not validate `currentPubkey` as 64-char hex, and does not validate `event` via `eventTemplate` (accepts `{ bad: true }`).
     - `androidHandoff` starts `const pending = onReturn(requestId)` before `await launch(uri)`; if `launch` throws, `pending` is left detached (risking unhandled promise rejection if it later rejects), and a `null` reply crashes on `reply.id`.
     - Missing `get_public_key` result verification and Android signer `package` retention required by NIP-55.
   - **Fix**: Require non-empty valid `requestId` in `verifyAndroidResult`; restrict `callbackUrl` to approved `https:` or custom app scheme (never `javascript:`/`data:`); validate `currentPubkey` and `eventTemplate(event)`; attach rejection cleanup on `pending` when `launch` fails; add `get_public_key` handoff/verification.

5. **`bunkerSigner` fires unguarded HTTPS NIP-05 fetch before `connect()` and accepts invalid/empty relay lists** **[Reproduced]**
   - **Location**: `src/nostr/signers.js:9-11, 29, 38-43` + `vendor/nostr.js` (`Qo`/`es`/`Lr`)
   - **Evidence**:
     - `bunkerSigner` promises *"Does not connect until connect() is called"*, yet delegates directly to vendor `parseBunkerInput`, whose NIP-05 fallback (`es`) immediately calls load-time-captured `fetch('https://' + domain + '/.well-known/nostr.json?name=...')` with no private/local-host block, no `timeoutMs`, no `credentials: 'omit'`, and no `fetcher` injection.
     - For `bunker://` URIs, `bunkerSigner` accepts zero relays or `ws://` / malformed relays (`bunker://<pk>?relay=ws://evil.local`) without validating via `Core.endpoints()`.
     - `connect()` does not verify the returned pubkey is 64-char lowercase hex.
     - `nostrConnectRequest` does not validate `relays` via `Core.endpoints()`, and `start()` returns the raw vendor `BunkerSigner` without `mode: 'nip46'` or `cancellable()` lifecycle guards.
   - **Fix**: Parse `bunker://` strictly offline in `bunkerSigner` (reject non-`bunker://` unless an explicit opt-in NIP-05 resolver with `fetcher`/`timeoutMs`/host-guard is used), validate all relays with `Core.endpoints()`, validate returned pubkey, and wrap `nostrConnectRequest` with the same `cancellable()` lifecycle guard.

6. **`parseProfile` passes through `javascript:` and `data:` URLs in `picture`, `banner`, and `website`** **[Reproduced]**
   - **Location**: `src/nostr/profiles.js:4, 9`
   - **Evidence**: Despite the comment *"preserving only safe serializable profile fields; never HTML"*, `parseProfile` copies `picture`, `banner`, and `website` verbatim up to 1024 chars, passing through `javascript:alert(1)` and `data:text/html,<script>x</script>` to consumers.
   - **Fix**: Validate `picture`, `banner`, and `website` with an `https:` (or `http:`/`https:` without credentials) URL guard and omit or reject disallowed schemes.

7. **`Anchor` public backup: prototype pollution in `stripSecrets`, secret leakage in values, and silent loss of `preferences` on restore** **[Reproduced]**
   - **Location**: `src/anchor/index.js:7-20`
   - **Evidence**:
     - `stripSecrets` copies keys into a plain `{}` object; parsing JSON containing `{"records":{"profile":{"__proto__":{"isAdmin":true}}}}` mutates the prototype of `restored.profile` (`restored.profile.isAdmin === true`).
     - `stripSecrets` only filters by key name (and `sanitizePublicSession` only checks `connectionDetail`), so `nsec1...`, `bunker://...?secret=...`, or `nostrconnect://...?secret=...` inside `session.label`, `profile`, `preferences`, or `publications` are exported verbatim with `containsSecrets: false`.
     - `buildPublicAccountBackup` saves `records.preferences`, but `restorePublicAccountBackup` omits `preferences` from its return object (silent data loss).
     - `summarizePublicationReceipts` (`line 22-27`) doesn't deduplicate relays or verify `eventId`; `extractEventAssets` (`line 31`) emits `http:` and local/metadata URLs without separation.
   - **Fix**: Ignore `'__proto__'`, `'constructor'`, `'prototype'` in `stripSecrets`; redact secret-bearing string patterns (`nsec1...`, `bunker://`, `nostrconnect://`) across all string values; return `preferences` from `restorePublicAccountBackup` (and update `types/index.d.ts`).

8. **`publishRelay` ignores `EOSE` during readback, omits `.code` on auth/send errors, and breaks `executeRelayDelivery` feedback loop** **[Reproduced]**
   - **Location**: `src/nostr/relay-transport.js:49-77`; `src/nostr/delivery.js:205-210`
   - **Evidence**:
     - After `OK true`, if a relay immediately sends `['EOSE', id]` with 0 events on the readback `REQ`, `publishRelay` ignores `EOSE` and stalls for the full `timeoutMs` (default 10s), rejecting with `code: 'timeout'` instead of immediate `code: 'readback-missing'`.
     - `publishRelay` fails to attach `.code` to NIP-42 auth failures (`lines 55, 58, 60, 62, 72, 73`), `ws.send` failures (`line 50`), and frame-limit errors (`line 70`). `executeRelayDelivery` (`line 206`) therefore misclassifies them all as `code: 'rejected'` (triggering a 300s ban instead of 15s network cooldown or auth handling).
     - `refused()` (`line 49`) omits NIP-01 prefixes `pow:`, `restricted:`, `duplicate:`, `invalid:`; `authRequired()` (`line 63`) requires a trailing colon (`'auth-required:'`), missing bare `'auth-required'`.
     - `executeRelayDelivery` stamps `at: nowSeconds()` (real wall clock) even when caller supplies `now`; feeding the returned `observations` back into `planRelayDelivery(..., { now })` silently drops every observation as future (`at > now + 60`).
   - **Fix**: Fail immediately on readback `EOSE` (`code: 'readback-missing'`, `accepted: true`), attach `.code` to every `publishRelay` error path, expand NIP-01 prefix matching, and add an injectable `clock` (defaulting to `nowSeconds`, or consistent with `now`) in `executeRelayDelivery` and `publishRelay`.

9. **`queryRelay` lacks DoS bounds, NIP-42 AUTH, `timeoutMs` validation, `ws.send` error handling, and `CLOSED` reason codes** **[Reproduced]**
   - **Location**: `src/nostr/relay-transport.js:9-31`
   - **Evidence**:
     - `ws.send` in `ws.onopen` (`line 24`) has no `try/catch`; a synchronous throw escapes unhandled and hangs until `Relay EOSE timeout`.
     - `timeoutMs` (`line 23`) is never validated (`NaN`, `0`, `-1`, `Infinity` accepted).
     - No frame-count or received-byte cap (unlike `publishRelay`'s 1024 frames / 2 MiB); a hostile relay can stream unlimited giant or non-matching frames.
     - No NIP-42 `AUTH` support for read-gated relays, and `CLOSED` drops `m[2]` behind a generic message.
   - **Fix**: Share framed-socket lifecycle, bounds, timeout validation, and NIP-42 auth with `publishRelay`, and attach structured `.code` on `CLOSED`.

10. **`syncEventHistory` permanently stalls on relays with ≥2 events in the same second, and rejects out-of-order relay pages** **[Reproduced]**
    - **Location**: `src/nostr/sync.js:56, 76`
    - **Evidence**:
      - Line 76 checks `(page.length > 1 && boundary.length === page.length)`. If a relay has only 2 events total and both share the same `created_at` (e.g. bulk publish in one second) with `pageSize = 100`, `page.length === 2` and `boundary.length === 2`, causing `syncEventHistory` to return `status: 'boundary-stalled'` and never advance the watermark—even though `page.length << pageSize` proved the relay returned all events!
      - Line 56 rejects any relay page not strictly sorted descending (NIP-01 descending sort is SHOULD, not MUST).
    - **Fix**: Gate the hidden-cap stall heuristic on `page.length >= pageSize` (or `boundary.length >= boundaryLimit`), and sort verified page events locally (`created_at DESC, id ASC`).

11. **`mediaType()` breaks strict v2 MIME verification for common web/media files and misclassifies extensionless names** **[Reproduced]**
    - **Location**: `src/nsite/files.js:3-6` (consumed by `plan.js:58`, `resumable.js:59`, `replicas.js:78`)
    - **Evidence**: `mediaType('js')` returns `'text/javascript; charset=utf-8'` (no `.` check); `/favicon.ico`, `/track.mp3`, `/hero.avif`, `/font.woff`, `/doc.pdf` all return `'application/octet-stream'`, breaking strict `Content-Type` verification in `verifyBlobCopies` and `checkGateway`.
    - **Fix**: Parse extension only when `basename.lastIndexOf('.') > 0`, expand standard MIME mappings (`.ico`, `.avif`, `.mp3`, `.ogg`, `.wav`, `.flac`, `.mp4`, `.webm`, `.pdf`, `.xml`, `.woff`, `.ttf`, `.otf`, `.map`, `.cjs`), and handle common MIME aliases (`image/x-icon` / `image/vnd.microsoft.icon`).

12. **Zip-bomb header spoofing in `readZip`, 32-bit/16-bit truncation in `writeZip`, and eager 1 GB allocation in `restoreChunkManifest`** **[Reproduced]**
    - **Location**: `src/archive/zip.js:14, 18-37, 42-55`; `src/archive/chunks.js:11`
    - **Evidence**:
      - `readZip` passes full `maxOutputBytes` (128 MiB) to `inflateRawSync` instead of `Math.min(size, remainingBudget)` (allowing a spoofed `size = 10` header to inflate 128 MiB); does not validate `maxFiles`/`maxOutputBytes`/`maxRatio` (`NaN` bypasses budget); does not explicitly reject ZIP64 `0xffff`/`0xffffffff` sentinels or non-symlink special UNIX modes (FIFO/device/socket); and doesn't verify custom `inflate()` returns a `Uint8Array`.
      - `writeZip` checks `total > maxBytes` on file payloads only (not `cursor` with headers), allowing silent `Uint32` / `Uint16` wraparound if raised above 4 GiB / 65,535 entries.
      - `restoreChunkManifest` fails to reject negative `manifest.size` (`size: -1` throws raw `RangeError: Invalid typed array length: -1`) and allocates up to 1 GB *before* validating chunk entries and `sum(chunk.size) === manifest.size`.
    - **Fix**: Bound per-entry inflation to `Math.min(size, remainingBudget)`, reject invalid limits/ZIP64 sentinels/special UNIX file modes, validate `cursor`/`count` bounds in `writeZip`, and validate all chunk sizes and `size >= 0` before allocating in `restoreChunkManifest`.

13. **`Intelligence.detectAndPrepareContent` marks invalid drafts `readyToPublish: true` (dTag > 13 chars, `../` paths, `pending-sha256` placeholders)** **[Reproduced]**
    - **Location**: `src/intelligence/engine.js:7-15, 250-291, 447-649, 829-830`
    - **Evidence**:
      - `slugify()` has no 13-character limit, so `analyzeNsiteIdentity` and `detectAndPrepareContent` emit 32-char `d` tags for kind `35128` (rejected by `Core.slug()`, `manifestTemplate`, `parseManifest`, and `ecosystemOptimizer`) with `readyToPublish: true`.
      - Unhashed assets emit literal `'https://blossom.pending/pending-sha256'` and `'pending-sha256'` into event `tags`, and unvalidated asset paths (`'../evil.html'`) pass into `['path', '/../evil.html', 'pending-sha256']` with `readyToPublish: true`.
      - `summarizeObservedActivity` (`line 830`) indexes `counts[r.type] += 1` without checking `Object.hasOwn(counts, r.type)`.
    - **Fix**: Enforce `Core.slug()` (≤13 chars) and `Core.nsitePath()` in nsite preparation; emit a blocking validation issue (or distinct `pendingUpload` state) whenever placeholder hashes or `blossom.pending` are present; guard `summarizeObservedActivity` keys.

14. **`encryptionAdapter` cannot wrap `browserSigner` or `bunkerSigner`** **[Reproduced]**
    - **Location**: `src/nostr/signers.js:4-7, 22-35`; `src/nostr/other-nips.js:21-25`
    - **Evidence**: `browserSigner` strips `provider.nip44`; `bunkerSigner` omits `nip44`. `Nostr.encryptionAdapter(Nostr.browserSigner(providerWithNip44))` throws `'Signer does not provide approved NIP-44 methods'`.
    - **Fix**: Forward `nip44` on `browserSigner` when present and expose cancellation-safe `nip44` wrappers on `bunkerSigner` / `nostrConnectRequest`.

15. **Unguarded network fetches in `Blossom.uploadVerified` and `Nostr.relayInfo`**
    - **Location**: `src/blossom/client.js:11-22`; `src/nostr/nip65.js:22-28`
    - **Evidence**:
      - `uploadVerified` (used directly in `examples/deepink-api.js:14`) calls `fetcher` with no `redirect: 'error'`, no `credentials: 'omit'`, no `timeoutMs`, no byte cap on `response.json()` or `remote.arrayBuffer()`, no MIME check on readback, and no `-1` clock-skew guard on `created_at`.
      - `relayInfo` fetches `https://<relay-host>` (including local/private/metadata relay hosts permitted by `Core.endpoint(url, 'relay')`) with no `redirect: 'error'`, no `credentials: 'omit'`, no `timeoutMs`, and no response byte cap on `response.json()`.
    - **Fix**: Share a bounded fetch helper (`redirect: 'error'`, `credentials: 'omit'`, `timeoutMs`, `maxBytes`) across `fetchVerified`, `uploadVerified`, `replicas.js`, and `relayInfo`, and apply a host-safety option on `relayInfo`.

---

### Medium Priority (Correctness, Retrieval, Moderation & Interoperability)

16. **`Core.endpoint()` trailing-dot inconsistency & `assertSignedEvent` uppercase hex mismatch** **[Reproduced]**
    - **Location**: `src/core/urls.js:8-10`; `src/blossom/replicas.js:15-19`; `src/nostr/events.js:10`; `src/nostr/history.js:9`
    - **Evidence**: `Core.endpoint('https://blossom.example.com./', 'blossom')` returns `'https://blossom.example.com.'` whereas `normalizeBlobServers` strips the dot. `assertSignedEvent` accepts uppercase `id`/`pubkey`/`sig` (`/i`) while `verifiedCopy` rejects uppercase hex. `checkedSign` returns the signer's raw object without stripping extra properties/symbols or cloning `tags`.
    - **Fix**: Assign `url.hostname = host` in `Core.endpoint()`, enforce lowercase hex in `assertSignedEvent`, and return a clean verified copy from `checkedSign`.

17. **`resolveNsiteManifest` false `'unreachable'` on non-fatal outbox errors & `loadNsiteFile` caller-server eviction** **[Reproduced]**
    - **Location**: `src/nsite/retrieval.js:52, 84-89`
    - **Evidence**:
      - Line 52 returns `'unreachable'` when `successful > 0` (all manifest relays succeeded with 0 events) if `errors.length > 0` from a single failed bootstrap outbox relay.
      - Line 85 puts untrusted manifest `server` tags *before* caller-supplied `servers` and slices at 32: a manifest with 32 dead `server` tags completely evicts the caller's explicit rescue `servers`.
      - Line 89 does not validate `relays` up front, throwing a raw `TypeError` only after initial fetches fail.
    - **Fix**: Track manifest-stage failures separately from outbox warnings; prioritize or reserve slots for caller-supplied `servers` (never let untrusted manifest tags evict explicit caller overrides); validate `relays` up front.

18. **`resolveManifestPath` misses versioned directory routes & `parseManifest` / `nsiteAddress` validation gaps** **[Reproduced]**
    - **Location**: `src/nsite/retrieval.js:75`; `src/nsite/manifest.js:8, 13, 38-51`
    - **Evidence**:
      - `resolveManifestPath(manifest, '/v1.2')` falls through to `/404.html` even when `/v1.2/index.html` exists because `.includes('.')` gates the `/index.html` fallback.
      - `parseManifest(event, { verify: false })` accepts missing/undefined `created_at` (`undefined > now + 300` is `false`) and unvalidated `tags`.
      - `prepareManifestFiles` accepts `Array` inputs (turning `['hi']` into `'/0'`).
      - `nsiteAddress` accepts `'localhost'`, `'127.0.0.1'`, and trailing dots, whereas `plan.js:27` enforces strict RFC-1123 public hostnames.
    - **Fix**: Try `path + '/index.html'` whenever exact path lookup misses; validate `created_at`/`tags` even when `verify: false`; reject arrays in `prepareManifestFiles`/`normalizeFileMap`; share one gateway hostname validator.

19. **`Moderation.filterNsites` ignores `npub1` bans & case-mismatched `ownPubkey`; `decodeNip19` TLV gaps** **[Reproduced]**
    - **Location**: `src/moderation/campaigns.js:26, 30-33`; `src/moderation/identity.js:17-24`
    - **Evidence**:
      - `filterNsites` lowercases `bannedPubkeys` without `normalizePubkey` (so `npub1...` bans silently fail) and compares `ownPubkey` case-sensitively (so uppercase hex or `npub1` `ownPubkey` fails protection and hides the user's own site). `clusterNsiteSpam` pushes `s.id` even when `undefined`.
      - `decodeNip19` accepts `naddr` without required `d` identifier or `kind`, accepts `kind > 65535` (up to `2^32 - 1`), uses non-fatal `TextDecoder`, and accepts credentialed/fragmented relay strings (`wss://user:pass@evil.local/x#frag`).
    - **Fix**: Normalize `bannedPubkeys` and `ownPubkey` via `normalizePubkey`; enforce NIP-19 `naddr` required TLVs, `kind <= 65535`, fatal UTF-8 decoding, and `Core.endpoint()` for relay TLVs.

20. **`Moji.extractEmojiHash` & `deriveEmojiStats` scheme/input inconsistencies** **[Reproduced]**
    - **Location**: `src/moji/index.js:10-11, 21-24`
    - **Evidence**: `extractEmojiHash` accepts lowercase `data:text/html,<script>alert(1)</script>` and arbitrary garbage strings (`'not a url'`) while rejecting uppercase `DATA:text/html,...`. `deriveEmojiStats` omits `source` validation (`['nip30','reserve']`) and skips URL validation when `hashOverride` is supplied.
    - **Fix**: Case-insensitively restrict `data:` to `data:image/(png|jpeg|webp|gif|avif);base64,` (or reject non-URLs explicitly), and share `source`/URL checks with `buildStableEmojiKey`.

21. **`fetchFeed`, `textNote`, `discoverRelays`, and `discoverBlossom` validation & cancellation bugs** **[Reproduced]**
    - **Location**: `src/nostr/feed.js:7-11, 25-32`; `src/nostr/discovery.js:6-36`
    - **Evidence**:
      - `fetchFeed` crashes with `TypeError: r.value is not iterable` if `query` returns `null`, fails to validate `authors` as 64-char hex, and passes `limit: NaN` on invalid `limit`.
      - `textNote` emits malformed `e`/`p` tags for non-hex `replyTo`.
      - `discoverBlossom(pk, { bootstrap: [] })` silently returns empty instead of throwing like `discoverRelays`.
      - Both `discoverRelays` and `discoverBlossom` swallow `AbortSignal` cancellations into `errors` instead of throwing, and neither rejects far-future `created_at` timestamps.
    - **Fix**: Validate hex inputs, integer limits, array responses, non-empty `bootstrap`, future timestamp bounds, and propagate `signal?.aborted` consistently; forward `signal`/`timeoutMs`/`Socket` to `fetchFeed`, `fetchProfiles`, and `publishTemplate`.

22. **Intelligence relay normalization defeats negative-evidence blocking & accepts dirty `followRelayCounts`** **[Reproduced]**
    - **Location**: `src/intelligence/relayIntelligence.js:59-61, 207, 312-323, 353-367`; `src/intelligence/engine.js:284`
    - **Evidence**:
      - `normalizeRelay` preserves `:443` and lowercases paths without rejecting credentials/queries/fragments. A dead `wss://relay.damus.io:443` fails to match fallback `'wss://relay.damus.io'` in `deniedWrite`, allowing the dead relay back into `recommendedWriteRelays` (**reproduced**).
      - `followRelayCounts` keys like `'wss://user:pass@evil.local:8080/a?x=1#f'` enter `discoveredCandidates` without `Core.endpoint()` validation.
      - Dead boolean branches at `relayIntelligence.js:207` (`relay.write ? 'keep-read-only' : 'keep-read-only'`) and `engine.js:284` (`... || true`).
    - **Fix**: Use `Core.endpoint()` for relay canonicalization/filtering in `relayIntelligence.js` and remove dead branches.

23. **`checkGateway` hardcoded 30s sequential deadline & swallowed upload/readback error causes**
    - **Location**: `src/nsite/resumable.js:48, 51, 117`; `src/blossom/replicas.js:84`
    - **Evidence**: `checkGateway` enforces a hardcoded 30s deadline across sequential file fetches (failing large sites); `resumable.js:117` swallows all upload failures into `{ status: 'failed' }`; `verifyBlobCopies` collapses 404/MIME/hash/timeout errors into `'readback-unverified'`.
    - **Fix**: Make `gatewayTimeoutMs` configurable, run with bounded concurrency, and return sanitized structured `.code` values.

24. **Duplicate content hashes across paths in `publishNsite` / `planNsitePublication`**
    - **Location**: `src/nsite/publisher.js:34`; `src/nsite/resumable.js:98-121`; `src/nsite/plan.js:58`
    - **Evidence**: Identical SHA-256 blobs at multiple paths (e.g. `/index.html` and `/404.html`) are signed, uploaded, and verified repeatedly; conflicting MIME extensions for identical bytes aren't detected at plan time.
    - **Fix**: Deduplicate uploads/copy checks by SHA-256 and flag same-hash/conflicting-MIME pairs during `planNsitePublication`.

25. **Archive catalog/version/CAS minor correctness gaps** **[Reproduced]**
    - **Location**: `src/archive/catalog.js:6, 17`; `src/archive/versions.js:16`; `src/archive/content-addressable.js:5`
    - **Evidence**:
      - `searchArchive` with negative `offset` (e.g. `offset: -2, limit: 1`) slices from the end of the array instead of clamping `offset >= 0`.
      - `buildArchiveCatalog` double-counts duplicate `event.id` entries in `versions: list.length`.
      - `groupVersions` silently buckets any non-35128 kind under `:15128` and stringifies missing `identifier` as `'undefined'`.
      - `contentStore.get(hash)` does not validate 64-char lowercase hex.

26. **Kind registry drift & unvalidated `Intelligence.classifyEventStorage`** **[Reproduced]**
    - **Location**: `src/anchor/kinds.js:2-4` vs `src/intelligence/nipRegistry.js:7-176, 279-290`
    - **Evidence**: `Intelligence.classifyEventStorage(-1)` returns `'regular'` while `Anchor.classifyEventStorage(-1)` throws; both registries omit kinds actively used by the SDK (`1059`, `1349`, `10050`, `22242`, `30166`, `30817`).

27. **Protocol, parser & Python tooling edge cases**
    - `src/nostr/other-nips.js:10-19`: `httpAuthHeader` omits optional NIP-98 `['payload', sha256(body)]` tag and preserves URL `#fragment` in the `u` tag (which never matches server-side request URLs).
    - `src/nostr/nip65.js:10, 20`: `relayList` drops `['r', url, '']` empty-marker tags; `planRelays` accepts negative/`NaN` `max` (slicing wrong items).
    - `src/nostr/relay-transport.js:81-86`: `publishMany` rejects `acceptEphemeral: true` receipts because `isVerifiedReceipt` requires `readback: true`.
    - `src/nostr/filter.js:10`: tag filter check allows `[undefined]` to match a 1-element tag `['e']` unless `typeof tag[1] === 'string'`.
    - `src/directory/metadata.js:4-6`: `htmlMetadata` misses `<meta content="..." name="description">` attribute order, OpenGraph fallbacks (`og:title`/`og:description`), numeric entities, and `</script >` whitespace.
    - `scripts/nsite_source_audit.py:55`: `archive_members()` does not cap cumulative uncompressed bytes across members (up to 12,000 × 550 KB ≈ 6.6 GB).
    - `scripts/source_collection.py:86, 100-113`: `restore()` reads `MANIFEST.json` unbounded, skips compression-ratio and cumulative-byte (`MAX_TOTAL`) checks, and reads every object twice.
    - `validation/verify_package.py:15`: Only verifies `API_INDEX.json` -> runtime, not reverse undocumented exports or `types/index.d.ts` parity.

28. **Packaging, TypeScript Declarations & Facade Gaps**
    - `package.json:12-32`: Subpath exports (`./nostr`, `./nsite`, `./blossom`, `./archive`, `./directory`, `./storage`, `./adapters`, `./moderation`, `./moji`, `./anchor`) lack `"types"` entries, breaking `moduleResolution: "NodeNext"` subpath imports.
    - `package.json`: Missing `typescript` in `devDependencies`, causing `npm run test:types` / `npm run verify` to fail locally without global `tsc`.
    - `types/index.d.ts:100, 142, 244`: `publishMany` omits `timeoutMs`/`signal`/`Socket`/`authSigner`/`authPubkey`/`requireAuthentication`/`acceptEphemeral`; `Blossom.uploadVerified` omits `clock` and `ArrayBuffer`; `restorePublicAccountBackup` omits `preferences`.
    - `src/index.js:21`: `createNsiteSDK().query()` only queries `config.relays[0]`, ignoring all other configured relays, and exposes no `.close()` lifecycle hook.

### Pass 4 Additions (Browser Runtime, Intelligence, Anchor & Protocol Plumbing)

29. **[CRITICAL / Browser Runtime] Unbound `globalThis.fetch` throws `Illegal invocation` across 7 modules in real browsers** **[Reproduced]**
    - **Location**: `src/nostr/nip65.js:22` (`fetcher = fetch`), `src/blossom/client.js:11, 25`, `src/blossom/replicas.js:40, 67`, `src/nsite/resumable.js:71`, `src/core/options.js:2`, `src/adapters/browser.js:4`
    - **Evidence**: All 7 files default `fetcher = globalThis.fetch` (or `fetch`) and invoke `fetcher(...)` as a detached function. In Node.js (Undici) this passes silently so all 237 offline tests stay green, but in Chrome, Firefox, and Safari invoking detached `Window.fetch` throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`. Under a strict `this === globalThis` fetch probe: `browserEnvironment().fetcher`, `normalizeOptions().fetcher`, `relayInfo`, and `uploadVerified` throw immediately; `fetchVerified` throws `'No Blossom copy passed SHA-256'`; `preflightBlob` reports `code: 'network'`; and `verifyBlobCopies` reports `code: 'readback-unverified'`.
    - **Fix**: Export one shared `defaultFetch = (...args) => globalThis.fetch(...args)` from `src/core/` and use it as the default `fetcher` across all modules (plus a strict `this`-binding test in `tests/`).

30. **[HIGH / Correctness] `Intelligence.auditCoverage` false-alarms healthy publications as `'critical'` (0% coverage) on trailing-slash / port differences** **[Reproduced]**
    - **Location**: `src/intelligence/engine.js:743-755`
    - **Evidence**: `auditCoverage` checks `new Set(pub.publishedRelays).has(r)` and `new Set(pub.assetLocations[hash]).has(s)` using raw strings. Because `Nostr`/`Blossom` canonical endpoints omit trailing slashes while NIP-65/browser URLs commonly include `/` or `:443`, `publishedRelays: ['wss://relay.damus.io/']` vs `expectedRelays: ['wss://relay.damus.io']` and `assetLocations: { [h]: ['https://blossom.example/'] }` vs `expectedBlossomServers: ['https://blossom.example']` produce `relayCoverageRatio: 0, mediaCoverageRatio: 0, status: 'critical'`.
    - **Fix**: Normalize relay and Blossom URLs with shared `Core.endpoint()` (or canonical lowercase host + stripped default port/trailing slash) before set comparison in `auditCoverage`.

31. **[MEDIUM / Advisory Safety] `Intelligence.reconstructPreferences` recommends unreachable relays/unhealthy Blossom servers & `#`-prefixed tags; `detectAndPrepareContent` embeds unvalidated `javascript:` URLs in `imeta`** **[Reproduced]**
    - **Location**: `src/intelligence/engine.js:146, 159, 175, 480-520`
    - **Evidence**:
      - `reconstructPreferences` puts relays marked `status: 'unreachable', wsReachable: false` into `defaultWriteRelays.value`, and Blossom servers marked `healthy: false` into `defaultBlossomServers.value`.
      - `reconstructPreferences` keeps leading `#` on Nostr `t` tags (`['t', '  #Foo  ']` -> `'#foo'`), violating NIP-12/NIP-24 lowercase non-`#` hashtag format.
      - `detectAndPrepareContent` emits `externalImageUrl: 'javascript:alert(1)'` verbatim into `['imeta', 'url javascript:alert(1)', ...]` with no URL scheme check.
    - **Fix**: Exclude known-unreachable relays / unhealthy Blossom servers (or separate them into a degraded list), strip leading `#` from `t` tags, and validate all `external*Url` inputs via `safeHttpUrl`.

32. **[MEDIUM / Validation] `Anchor.planVerifiedOutbox` & `assessRelayOutbox` missing URL validation, deduplication, `max` bounds, and `null` safety** **[Reproduced]**
    - **Location**: `src/anchor/relays.js:2-12`
    - **Evidence**:
      - `planVerifiedOutbox` returns `undefined`, `'javascript:alert(1)'`, and un-deduplicated `'wss://r1.example'` + `'wss://r1.example/'` in `write`.
      - `max: 0` or `max: NaN` returns `write: []` while still reporting `insufficientEvidence: false`; `max: -1` slices off the last relay.
      - `assessRelayOutbox(null)` crashes with raw `TypeError` (`Cannot read properties of null`); `NaN` `latencyMs` breaks sort stability.
    - **Fix**: Guard `relay && typeof relay === 'object'`, canonicalize & deduplicate URLs with `Core.endpoint(url, 'relay')`, validate `max` as positive safe integer, treat non-finite `latencyMs` as `Infinity`, and compute `insufficientEvidence` from `write.length === 0`.

33. **[MEDIUM / Protocol & Auth Plumbing] `eventTemplate` accepts empty `[]` tags and lone UTF-16 surrogates; `publishNsite` cannot pass NIP-42 auth to `publisher`; `verifiedReceipts` drops `authenticated`** **[Reproduced]**
    - **Location**: `src/nostr/events.js:4-6`; `src/nsite/publisher.js:39`; `src/nsite/resumable.js:127`; `src/nostr/receipts.js:8`
    - **Evidence**:
      - `eventTemplate` accepts `tags: [[]]` (missing NIP-01 tag name) and lone UTF-16 surrogates (`'hi\uD800world'`), which serialize differently across `JSON.stringify` (`\ud800`) vs UTF-8 `TextEncoder` (`U+FFFD`), risking cross-runtime SHA-256 event ID mismatches.
      - Neither `publishNsite` (`publisher.js:39`) nor `publishResumable` (`resumable.js:127`) accepts or forwards `authSigner`, `authPubkey`, `requireAuthentication`, or `timeoutMs` to `publisher(...)`, preventing nsite publication to NIP-42 auth-gated relays even though `publishMany` already supports them.
      - `verifiedReceipts` strips `authenticated: true` when normalizing verified relay receipts and compares `relays.includes(r?.relay)` without URL canonicalization.
    - **Fix**: Require `tag.length >= 1` and reject lone surrogates (`[\uD800-\uDFFF]` unpaired) in `eventTemplate`; thread NIP-42 auth and timeout options through `publishNsite`/`publishResumable`; preserve `authenticated` on `verifiedReceipts`.

---

## Part 2: Performance & Scalability Bottlenecks

| Area | Location | Bottleneck | Recommended Fix |
| --- | --- | --- | --- |
| **CAS Blob Storage** | `src/archive/content-addressable.js:7` | `Array.from(value)` converts every `Uint8Array` into a boxed JS `number[]` (~8× RAM blowup + slow IDB serialization). | Store `Uint8Array` directly (accept `Uint8Array \| Array` on read for backward compatibility). |
| **WebSocket Churn** | `relay-transport.js`, `profiles.js:24`, `sync.js:69-72`, `open-specs.js:66` | New WebSocket opened/closed per query or publish (200 follows × 5 relays = 1,000 handshakes; `syncEventHistory` opens 2 sockets/page). | Add opt-in caller-owned `RelayPool` with connection reuse, multiplexed `REQ`s, and per-socket NIP-42 AUTH reuse. |
| **Blossom Triple Download & N×M Signing** | `blossom/client.js:11-22`, `blossom/replicas.js:71`, `nsite/resumable.js:98-121` | `publishResumable` runs `verifyBlobCopies` across *all* servers (without early-stopping once `required` copies are found), triggers 1 signer prompt per file × server, skips BUD-06 preflight, and downloads every uploaded blob **twice more** (once in `uploadVerified`, again in `verifyBlobCopies` for MIME). | Early-stop `verifyBlobCopies` (or add `mode: 'threshold' \| 'all'`), run `preflightBlob` first, accept pre-signed BUD-11 batch auth in `uploadVerified`, and verify SHA-256 + MIME in a single readback. |
| **Sequential Network Fan-Out** | `delivery.js:195`, `resumable.js:51,98`, `replicas.js:43,71`, `open-specs.js:91` | Relays, file uploads, preflights, copy checks, gateway checks, and coordinate rechecks all run strictly sequentially. | Bounded worker pool (`concurrency` option, e.g. 4) with deterministic result ordering and configurable global deadline. |
| **Policy Recompilation** | `src/moderation/lists.js:27-30` | `isEmojiAllowed` rebuilds `new Set(normalizePubkeyList(...))` (including full NIP-19 decoding) on every emoji in `parseNip30Event` / `collectNip30Emojis`. | Add `compileModerationPolicy` / `WeakMap` cache for O(1) lookups. |
| **Triple Event Cloning** | `history.js:8` → `events.js:10` → `events.js:4` | Every `verifiedCopy` calls `structuredClone(tags)` 3 times (heavy GC on 10k-tag nsite manifests). | Clone once at boundary; pass internal clean object to vendor verifier. |
| **Redundant Verification & Parsing** | `discovery.js:14,18`; `edit.js:17` | `discoverRelays` verifies the winning kind-10002 signature twice; `reviewEventReplacement` re-parses `JSON.parse(next.content)` inside `.filter()` for every profile key. | Pass `{ verify: false }` after verifying once; hoist `new Set(objectFields(next.content))`. |
| **Directory Sort & Grouping** | `src/directory/model.js:12, 29-30` | `directoryRows` recomputes `effective`/`reasons` twice and runs 5 regexes in `similarityKey` per sort comparison (`O(N log N)`); `bulkGroup` increments `revision` per item. | Precompute sort keys (Schwartzian transform), reuse `effective` map, bump `revision` once per bulk op. |
| **Browser Base64 Loop** | `core/bytes.js:21`, `nostr/other-nips.js:17` | Byte-by-byte `binary += String.fromCharCode(c)` is O(n²) without `Buffer`. | Chunked `String.fromCharCode.apply(null, slice)` (8 KiB chunks). |
| **IndexedDB Lifecycle & Scale** | `src/storage/indexeddb.js:4-6` | Eager `open()` caches permanent rejections; no `close()`, no `onversionchange`/`onblocked` handling, `getAllKeys(undefined)` passed to strict mocks, multi-store same-DB version collision, unbounded `getAllKeys()`. | Lazy open with retry, `close()`, `onversionchange` handler, parameterless `obj.getAllKeys()`, optional prefix/cursor key scan. |

---

## Part 3: Architectural Brainstorm & Cohesive Solution Design

Because the 30 findings cluster around 7 root causes, fixing them through **shared core primitives** rather than one-off patches will reduce code duplication and prevent future drift:

### 1. Shared Internal Core Guards (`src/core/`)
Make every module depend on one canonical set of hardened primitives:
- `assertHex(value, length)` (strict lowercase hex)
- `canonicalEndpoint(input, type, { allowLocal })` (strips trailing dot + default port, blocks credentials/fragments/queries, enforces public DNS-host policy for Blossom, untrusted NIP-65 hints, `relayInfo`, and `relayIntelligence`)
- `safeHttpUrl(input, { allowHttp })` (shared by `parseProfile`, `Directory.safeURL`, `Moji`, `Anchor.extractEventAssets`, and `androidIntent` `callbackUrl`)
- `canonicalGatewayHost(host)` (shared between `manifest.js` and `plan.js`)
- `boundedFetch(url, init, { fetcher, timeoutMs, maxBytes, signal })` (shared by `fetchVerified`, `uploadVerified`, `preflightBlob`, `verifyBlobCopies`, `checkGateway`, and `relayInfo`)
- `SdkError` / structured `{ code, stage, retryable, relay?, server?, cause? }` metadata

### 2. Unified Relay Transport, `RelayPool` & Live Subscriptions (`src/nostr/pool.js`)
- Unify socket framing, frame/byte DoS caps, `ws.send` error guards, `timeoutMs` validation, `EOSE` readback handling, NIP-01 `OK`/`CLOSED` prefix classification, and NIP-42 AUTH between `queryRelay` and `publishRelay`.
- Add caller-owned `createRelayPool({ Socket, maxConnections, idleTimeoutMs, authSigner, authPubkey })`:
  - Multiplexes concurrent `REQ`s over one WebSocket per relay.
  - Exposes **`subscribe(relays, filter, { onEvent, onEose, onClosed, signal }) -> { close() }`** with explicit EOSE vs live-event boundaries and frame/byte caps.
  - Caches NIP-42 AUTH per active socket + principal.
  - Plugs directly into `fetchProfiles`, `syncEventHistory`, `resolveNsiteManifest`, and `executeRelayDelivery` via existing `query`/`writer` injection seams.

### 3. Publication v2.5 ("Deduplicated, Preflighted, Batched & Authenticated")
Wire the existing reconciliation primitives together end-to-end:
1. Deduplicate files by SHA-256 and detect same-hash/different-MIME conflicts during `planNsitePublication`.
2. Run BUD-06 `preflightBlob` across approved storage servers before signing.
3. Group missing hashes into ≤24-hash `blossomBatchUploadAuth` batches -> sign once per batch -> pass signed auth into `uploadVerified({ authEvent })`.
4. Verify SHA-256 + `Content-Type` in a single readback pass (eliminating the 2×–3× download amplification) and early-stop `verifyBlobCopies` once `required` distinct origins pass when requested.
5. Publish the signed manifest via `executeRelayDelivery` (with consistent `clock`, NIP-42 auth, NIP-11 limits, NIP-66 monitor ranking, and observation cooldowns).
6. Run bounded concurrent `checkGateway` with configurable `gatewayTimeoutMs`.

### 4. Local `EventStore` + NIP-09 Deletion Layer (`src/nostr/store.js`)
- `StorageAdapter`-backed verified event store implementing NIP-01 storage classes (regular / replaceable / addressable with lowest-ID tie-breaking, rejecting ephemeral).
- **NIP-09 deletion (`kind 5`)** builder (`deletionTemplate`) + author-matched tombstoning when querying active views while preserving raw archival history.
- Atomic observation + cursor commit helper for `syncEventHistory`.

### 5. Browser-Native Streaming DEFLATE & Node `fsStore`
- `src/archive/zip.js`: Fall back to Web Streams `DecompressionStream('deflate-raw')` (standard in modern browsers and Node 20+) with streaming output-byte caps, plus opt-in `compress: true` in `writeZip`.
- `src/storage/fs.js`: Atomic temp-file + `rename` `StorageAdapter` for Node CLI publishers, archive tools, and backend daemons.

### 6. Complementary Protocol Primitives
- **NIP-19 full encoders** (`nprofileEncode`, `neventEncode`, `naddrEncode`) matching `decodeNip19` and `npubEncode`.
- **NIP-17 / NIP-59 gift-wrap & seal builders** (pairing with fixed `encryptionAdapter` and `planRelayDelivery`'s existing `kind 1059`/`10050` inbox routing).
- **NIP-05 verification helper** (bounded HTTPS fetch, `redirect: 'error'`, exact lowercase pubkey check, opt-in rather than implicit inside `bunkerSigner`).
- **`StorageAdapter`-cached NIP-11 & NIP-66 fetchers** to feed `planRelayDelivery`'s `relayPolicies` and `monitorEvents`.

### 7. Verification, Packaging & Contributor Tooling
- **Subpath `.d.ts` declarations** in `types/` mapped in `package.json` `exports`, tested in `tests/types-consumer.ts`, plus `typescript` in `devDependencies`.
- **Bidirectional parity & pin sync script** (`scripts/sync_manifest.py --check/--write`) covering `provenance/manifest.json` (65 pins), `docs/API_INDEX.json` (189 symbols), runtime exports in both directions, and `types/*.d.ts`.
- **Parser fuzz / boundary suite** covering `readZip`, `decodeNip19`, `parseManifest`, `matchesFilter`, `restoreChunkManifest`, `htmlMetadata`, `validateWorkspace`, and `restorePublicAccountBackup`.

---

## Part 4: Anticipated Consumer Needs & Forward-Looking Architecture

Once the 33 confirmed defects and 10 bottlenecks above are resolved, real downstream consumers (DeepInk, Anchor, Nsite Directory Editor, Pretend Internet, Android/WebToApp hosts, and CLI/CI publishers) will predictably run into the following production needs. Designing for them up front avoids breaking changes in `1.x`:

### 1. Multi-Account Isolation & Cross-Tab Consistency
- **Scoped storage adapter (`Storage.scopedStore(adapter, namespace)`)**: Prefix keys by verified account pubkey so switching accounts in a browser or WebView cannot bleed cached profiles, sync cursors, or pending publish checkpoints across accounts.
- **Session-bound `AbortController` manager**: Provide a lightweight `AccountSession` controller that automatically cancels in-flight relay queries, subscriptions, bunker calls, and uploads on logout/account switch.
- **Cross-tab invalidation hook**: Optional `BroadcastChannel` / `storage`-event notifier so two open browser tabs don't overwrite each other's `Directory` workspace or `syncEventHistory` cursor.

### 2. Persistent Relay Health & Circuit-Breaker Cache
- **Durable observation store**: `executeRelayDelivery` and `planRelayDelivery` already support cooldowns, NIP-11 policies, and NIP-66 monitors, but state currently lives only in memory. Adding a `StorageAdapter`-backed cache with TTL and schema versioning stops apps from repeatedly timing out on dead relays after every page reload or Android app resume.

### 3. Durable NIP-46 Reconnection & Mobile Lifecycle Contract
- **Secret-free session descriptor + host vault callback**: Separate the serializable session record (`{ remotePubkey, userPubkey, relays, clientPubkey, permissions }`) from an opaque host-provided secret getter/setter (`{ loadClientSecret, saveClientSecret }`), so apps can reconnect after reload/backgrounding without ever placing client secrets into backups, `localStorage`, or logs.
- **Visibility/reconnect hook**: Expose a `reconnect()` / `ping()` method on the NIP-46 adapter so Android WebViews and mobile browsers can recover dropped WebSocket subscriptions after OS suspension without triggering duplicate signer approval prompts.

### 4. Static-Site Portability, Large-Site Ergonomics & Progress Reporting
- **Cross-platform path collision checks in `planNsitePublication`**: Warn (or reject under `strictPortablePaths: true`) when a site contains case-colliding paths (`/Index.html` vs `/index.html`), Unicode NFC vs NFD colliding paths (`/caf\u00e9.html` vs `/cafe\u0301.html`), or Windows-reserved filenames (`CON`, `NUL`, trailing spaces/dots) that silently overwrite files when recovered via `readZip` on macOS/Windows.
- **Zero-byte file policy (`emptyFiles: 'reject' | 'skip'`)**: Real static-site generators emit 0-byte marker files (`.nojekyll`, `.gitkeep`, empty placeholder `.css`); currently `prepareManifestFiles` hard-fails on any 0-byte file (`manifest.js:17`). An explicit opt-in `'skip'` (recording skipped paths in the plan) avoids ad-hoc caller workarounds.
- **Structured `onProgress` callback**: Emit `{ stage, path, completed, total, bytesTransferred, server?, relay? }` across `publishNsite`, `publishResumable`, `syncEventHistory`, and `writeZip`/`readZip` so browser UIs and CLI publishers can render real progress bars without scraping checkpoints.

### 5. Blossom Replica Repair & Safe Garbage Collection
- **`repairBlobReplicas(manifest, { sourceServers, targetServers, signer, requiredCopies })`**: First-class workflow combining `fetchVerified`, BUD-06 `preflightBlob`, BUD-04 `/mirror` (with fallback to `uploadVerified`), and `verifyBlobCopies` to heal degraded nsite/media coverage identified by `Intelligence.auditCoverage`.
- **`findUnreferencedBlobs(storedHashes, retainedManifests)`**: Safe orphan-hash calculation across pinned revisions so users can reclaim Blossom/CAS space without accidentally deleting blobs referenced by an older archived revision.

### 6. Schema Versioning & Migration Registry
- Every persisted document (`nsite-job/2`, `loopy.anchor-backup/1`, `nostr-revision/1`, `loopy.open-specs-index/1`, `Directory` workspace, `syncEventHistory` cursors, `Intelligence` corrections) should expose a lightweight `migrate<Schema>(input)` / `validate<Schema>(input)` pair so future `1.x`/`2.x` releases upgrade saved user state deterministically instead of rejecting legacy checkpoints.

### 7. Safe NIP-65 Relay-List Editing & Migration Helper
- **`planRelayListUpdate(currentKind10002, { add, remove, setMode })`**: Preserve unrecognized tags, prevent publishing an empty or all-unreachable write list, canonicalize endpoints, and emit a dual-broadcast plan (publishing the updated kind `10002` to *both* old and new write relays so followers actually discover the migration).

### 8. Runtime Capability Preflight (`Core.checkRuntimeCapabilities()`)
- A zero-side-effect diagnostic returning `{ subtleCrypto, webSocket, fetch, indexedDB, decompressionStream, secureContext, browserNip07 }`. In particular, browser apps loaded over non-HTTPS origins (e.g., LAN IP `http://192.168.x.x` or misconfigured WebViews) lose `crypto.subtle`; surfacing a crisp preflight check avoids cryptic `Cannot read properties of undefined (reading 'digest')` failures mid-publish.

### 9. Exported Consumer Test Kit (`@chaoticka/nsite-loopy-sdk/testing`)
- Publish an optional subpath containing deterministic offline fakes (`createMockRelay`, `createMockBlossom`, `createTestSigner`, `withStrictBrowserFetch` enforcing `this === globalThis` in Node tests) so downstream apps (DeepInk, Anchor, Directory Editor) can test full end-to-end publication, auth, and recovery flows offline—and catch browser `Illegal invocation` regressions in CI.

### 10. Reproducible Vendor Bundle Provenance (Closing `GAPS.md` GAP-005)
- Add a deterministic build script + lockfile/checksum manifest documenting the exact upstream commit/version of `nostr-tools`, `@noble/*`, and `@scure/*` compiled into `vendor/nostr.js`, and verify in CI that `vendor/nostr.js` does not rely on unbound load-time `fetch` capture.

---

## Recommended Phased Implementation Order

- **Phase 1 — Core Guard Consolidation & Critical Security/Browser/Correctness Fixes (Zero API breaks)**:
  Unify `src/core/` guards (`defaultFetch` fixing browser `Illegal invocation` #29, `assertHex`, `canonicalEndpoint`, `safeHttpUrl`, `boundedFetch`), then resolve items #1–#15 and #29–#30 (`parseCuratorBlocklist` safePubkeys + hash classification, `safeHint` trailing-dot, `Directory` prototype keys & `validateWorkspace`, NIP-55 `verifyAndroidResult`/`androidIntent`/`androidHandoff`, `bunkerSigner` pre-connect fetch & relay checks + `nostrConnectRequest` wrapper, `parseProfile` URL schemes, `Anchor` backup `__proto__`/secret redaction/`preferences`, `publishRelay` EOSE + `.code` + `executeRelayDelivery` clock, `queryRelay` DoS/send/timeout guards, `syncEventHistory` same-second stall, `mediaType()` table, `readZip`/`writeZip`/`restoreChunkManifest` bounds, `Intelligence` nsite `dTag`/placeholder readiness + `auditCoverage` URL normalization, `browserSigner`/`bunkerSigner` `nip44` forwarding, `uploadVerified`/`relayInfo` fetch guards).
- **Phase 2 — Retrieval, Moderation, Packaging, Auth Plumbing & Type Parity**:
  Resolve items #16–#28 and #31–#33 (`resolveNsiteManifest` outbox vs manifest status, `loadNsiteFile` caller server priority, `resolveManifestPath` `/v1.2`, `parseManifest`/`prepareManifestFiles` edge cases, `filterNsites`/`decodeNip19`/`Moji`, `fetchFeed`/`textNote`/`discoverRelays`/`discoverBlossom`, `relayIntelligence` `:443` & `followRelayCounts`, `reconstructPreferences`/`detectAndPrepareContent` external URLs, `Anchor.planVerifiedOutbox`, `eventTemplate` empty tags & lone surrogates, NIP-42 auth plumbing in `publishNsite`/`publishResumable`, `verifiedReceipts` auth metadata, `searchArchive`/`groupVersions`/`contentStore`, kind registry unification, Python archive bounds, subpath `.d.ts` + `types/index.d.ts` fixes + `createNsiteSDK`).
- **Phase 3 — Performance, Transport Architecture & Forward-Looking Capabilities**:
  CAS `Uint8Array` storage, single-clone verification, `isEmojiAllowed` policy cache, `directoryRows` Schwartzian sort, `indexedDbStore` lifecycle + browser `DecompressionStream` ZIP, `RelayPool` + `subscribeRelay`, Publication v2.5 (deduped SHA-256 + BUD-06 preflight + BUD-11 batch auth + single readback + bounded concurrency + `executeRelayDelivery` wiring + `onProgress`), `EventStore` + NIP-09 deletions, and Part 4 consumer ergonomics (`scopedStore`, durable relay-health cache, `repairBlobReplicas`, `checkRuntimeCapabilities`, and `/testing` harness).
