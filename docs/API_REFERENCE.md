# Public API reference — Nsite Loopy SDK 1.1.1-rc.10

`import {createNsiteSDK, Core, Nostr, Nsite, Blossom, Archive, Directory, Storage, Adapters, Moderation, Moji, Anchor, Intelligence} from '@chaoticka/nsite-loopy-sdk'`. `docs/API_INDEX.json` is the generated complete export list; `types/index.d.ts` is the TypeScript consumer contract. All storage and network functions are explicit: imports have no side effects.

## Facade

`createNsiteSDK(options?)` accepts `{relays:string[], server?:HTTPS_URL, signer?:Signer, storage?:StorageAdapter, Socket?:WebSocketConstructor, fetcher?:fetch, clock?:()=>seconds}`. It returns `{options, core, nostr, nsite, blossom, archive, directory, storage, adapters, moderation, moji, anchor, intelligence, publish(files,overrides), query(filter,overrides)}`. `publish` reads the approved signer's identity if `pubkey` isn't supplied. A facade is optional: every namespace can be used independently.

## Core (11 exports)

- `bytes(input)` UTF-8/ArrayBuffer/Uint8Array to bytes; `encode(text)`, `hex(bytes)`, `unhex(hex)`; `toBase64Url(bytes)`; `sha256(bytes,{cryptoProvider?})` returns lowercase SHA-256 hex.
- `endpoint(value,type='relay')`: canonical plain `wss://` relay or `https://` Blossom URL, rejects credentials, fragments, queries and unsafe local targets for Blossom.
- `endpoints(urls,type,max)`: validate and deduplicate endpoint list.
- `nsitePath(path)`: canonical leading slash and dot/traversal protection; `slug(value)`: 1–13 lower-case canonical named-site identifier.
- `normalizeOptions(options)`: validates and returns standard runtime options.

## Nostr (37 exports)

- `generateSecretKey()`, `getPublicKey(secret)`, `finalizeEvent(unsigned,secret)`: crypto/test primitives. Do not serialize test private keys into public artifacts; normal apps should use external signers.
- `verifyEvent(event)`: BIP-340 signature verification on clean canonical event fields, guarding against vendor verification memoization. `assertSignedEvent(event)` throws on invalid signatures.
- `eventTemplate({kind,created_at,content,tags})`, `checkedSign(signer,template,expectedPubkey)`: snapshot approved event fields before invoking the signer; reject changed fields or author identity.
- `browserSigner(window.nostr)`: NIP-07 adapter, errors when absent. `bunkerSigner(uri,options)`: NIP-46 signer object requiring `.connect()` then approval; `.close()` stops session.
- `nostrConnectRequest({relays,name,perms,secret?,clientSecret?})`: generate client-initiated `nostrconnect://` copy code and `start(signal)` listener; start listening before app switch; do not regenerate pending attempts casually.
- `androidIntent({type,requestId,event?,currentPubkey?,callbackUrl?})`: creates Android NIP-55 request URI; **launch only**, not login. `verifyAndroidResult(...)` validates correlation, author, content and signature after Android host returns. `connectIdentity(signer)` confirms identity via the signer.
- `relayList(kind10002)`: signed NIP-65 read/write list; `planRelays({authorList,recipientLists,defaults,max})`: bounded role-aware relay selection. `discoverRelays(pubkey,{bootstrap,query,defaults,max})`: retrieve latest signed kind10002 and diagnostics; equal timestamps choose lowest event ID. `relayInfo(url,{fetcher})`: NIP-11 metadata over HTTPS. `blossomServers(kind10063)` / `discoverBlossom(pubkey,{bootstrap,query})`: signed BUD-03 discovery with the same deterministic tie-break.
- `queryRelay(relay,filter,{Socket,timeoutMs,signal,verify,maxEvents})`: finite REQ/EOSE; returns verified deduplicated signed events matching all locally checkable NIP-01 constraints, bounded by the lower of maxEvents and filter.limit. Errors are not empty results; a local cap is not proof of relay exhaustion. NIP-50 search and other extension predicates remain relay-defined. `publishRelay(relay,event,{Socket,...})`: waits for actual OK, then requests signed exact-ID readback on the same connection; `publishMany(event,relays,{writer?})`: returns verified/failure receipts without hiding partial failures.
- `textNote(content,{replyTo?})`: kind1 plain note, with `e`/`p` reply tags; `reaction(target,emoji='+')`: kind7 reaction. `publishTemplate(template,{signer,pubkey,relays,publisher?})`: checked signed publication, requiring readback. `fetchFeed({authors,kinds,relays,query?,limit?})`: verified, deduped, time-sorted events plus per-relay failures.
- `eventIdentity(event)`: verified NIP-01 event ID or replacement coordinate; preserves exact first `d` tag. `collectEventObservations(rows)`: returns verified event records, distinct per-event relay sightings, latest revisions and rejected inputs. `syncEventHistory({relays,filter,cursors?,pageSize?,boundaryLimit?,maxPages?,now?,query?,signal?})`: read-only bounded per-relay historical scan. Persists no state automatically; commit observations before cursors. `window-read` is relay-reported coverage, not proof of a complete corpus. See `CROSS_DONOR_HISTORY.md`.
- `parseProfile(signedKind0)` / `fetchProfiles({pubkeys,relays,query?})`: extract bounded metadata from signed profiles. `fetchProfiles` deduplicates authors, queries each author/relay independently (up to 16 simultaneous queries, 100 observed events per request), and selects the newest observed valid profile with lowest event ID on ties. Partial failures include the affected `pubkey` and relay; `queried` does not guarantee completeness.
- `relayAuthTemplate({challenge,relay})`: NIP-42 challenge-bound template; `httpAuthHeader({url,method,signer,pubkey})`: signed NIP-98 HTTP auth. `encryptionAdapter(nip44Signer)`: delegates to trusted signer; **does not invent homemade NIP-44 encryption**.

- `prepareEventReplacement(signedBaseline,{pubkey?,content?,replaceTags?,created_at?})`: preserve exact address and unowned tags, including original publication metadata; returns unsigned template and review. `reviewEventReplacement(baseline,template,pubkey)` checks signature, account, kind, identity, newer timestamp, exact tag multiset changes and removed profile fields. No signing, automatic safety verdict or freshness claim.

## Nsite (11 exports)

- `NSITE_ROOT_KIND=15128`, `NSITE_NAMED_KIND=35128`, `nsiteAddress(pubkey,{identifier?,gateway?})`: root/named nsite URLs.
- `prepareManifestFiles(fileMap,{maxFiles?,maxBytes?})`: normalizes each path, hashes exact bytes and computes deterministic aggregate of sorted `<hash> <path>\n` records. Returns `{entries,aggregate,totalBytes}`.
- `manifestTemplate(prepared,{identifier?,server?,title?,description?,created_at?})`: unsigned kind15128/35128 manifest. `parseManifest(signedEvent,{verify?,now?})`: signature check, path bounds, aggregate check and site URL.
- `normalizeFileMap(fileMap)`, `compareFiles(before,after)`, `mediaType(path)`: normalized file paths, changed hashes, MIME types.
- `planNsitePublication(files,{pubkey,server,relays,identifier?,title?,description?,created_at?,baseline?})`: read-only, digest-bound plan with exact unsigned template, file hashes, changes and observed baseline status. See `CROSS_DONOR_PUBLICATION.md`.
- `publishNsite(fileMap,{signer,pubkey,server,relays,identifier,title,description,uploader?,publisher?,checkpoint?,signal?})`: prepare → upload each exact asset → verify → sign manifest → publish → independent relay readback → stage receipt. Supports signed `baseline`, `approvedPlan` (plan ID), `allowFileRemovals`, and optional `resolveCurrent` recheck; use the exact plan timestamp. Stops on any failed gate. Returns `{job,event,manifest,receipts}`.

## Blossom (4 exports)

- `blossomUploadAuth({hash,server,now?,expiresIn?})`: unsigned kind24242 upload auth (caller signs).
- `blossomAuthHeader(signedEvent)`: Nostr event base64url authorization header.
- `uploadVerified(bytes,{server,signer,pubkey,path,fetcher?,signal?})`: cryptographic sign → PUT `/upload` → descriptor check → GET hash readback and SHA-256 comparison. Returns `{hash,size,server,url,verified:true}` only after exact byte match.
- `fetchVerified(hash,{servers,fetcher?,signal?})`: tries verified HTTPS Blossom URLs in order and returns first exact-hash copy. Throws if none match.

## Archive (9 exports)

- `writeZip(fileMap,{maxFiles,maxBytes})`: deterministic stored ZIP with CRC32 and central directory, no external compressor. `readZip(bytes,{maxFiles,maxOutputBytes,maxRatio,inflate?})`: validates central directory, names, CRC, sizes, path traversal, symlinks and expansion. Reads stored/DEFLATE; Node uses built-in `zlib` for DEFLATE, browsers may inject `inflate`.
- `crc32(bytes)`: ZIP checksum (not a cryptographic hash).
- `contentStore(storage?)`: content-addressed `put/get/verify/saveManifest/loadManifest/keys`, using hash identity and shared storage interface.
- `diffVersions(previous,next)`, `materializeVersion(manifest,store)`, `groupVersions(versions)`: compare historical manifest paths, rebuild version from CAS and group by publisher/root/named identifier.
- `buildArchiveCatalog(versions,{pages?,jobs?,settings?})` / `searchArchive(catalog,{query,sort,offset,limit,publisher,includeHidden})`: searchable version lineage; hide local entries without erasing raw input.

## Directory (31 exports)

Source-derived `Nsite Directory Editor/app/model.js` plus `htmlMetadata`:

- `emptyState`, `validateCatalog`, `validateWorkspace`, `validateRules`, `upgrade`, `VERSION`, `defaultRules`: versioned workspace and schema checks.
- `effective`, `matches`, `reasons`, `select`, `directoryRows`, `SORTS`, `safeURL`, `safeImage`, `htmlMetadata`: effective metadata, filter rules, search/sort, safe links/images, static metadata.
- `patch`, `bulkGroup`, `stackSites`, `unstack`, `membership`, `groupState`, `toggleState`, `publisherCounts`, `publisherKey`, `similarityKey`, `setQueue`, `moveQueue`, `ageSeconds`: revisioned edits, clone stacks independent of collections, search/sort, queue navigation.
- `exportCatalog`, `publicCatalog`: reversible JSON export and public-only catalog with hidden entries filtered.

## Storage (2 exports)

`memoryStore(seed?)`: async clone-on-read `get/set/delete/keys` in memory. `indexedDbStore({name,store,indexedDBProvider?})`: same contract via browser IndexedDB. Secrets must be managed by the signer; don't store `nsec` or bunker connection tokens in the generic library.

## Adapters (2 exports)

`browserEnvironment({signer?,storage?,Socket?,fetcher?})`: browser host capability detection. `androidHandoff({launch,onReturn})`: host-provided NIP-55 request and correlated result. **Requires a native Android host callback, not just a URL click.**

## Failure states

- `Error` indicates unverified publication, network timeout, corrupt archive, signature mismatch, missing signer, incompatible host, or invalid bytes; callers should not substitute a success message.
- `fetchFeed`/`discoverRelays` return diagnostics when at least one relay failed. A signed event fetched from one relay does not prove availability on others.
- Pure operations (`writeZip`, `nsitePath`, `manifestTemplate`) have no network or side effects.

Machine-readable export inventory: `docs/API_INDEX.json`; typed API: `types/index.d.ts`; tested call graph: `docs/DEEPINK_CONSUMER.md`.

## Moderation

- `campaignMatch(description)` preserves the confirmed three-signal spam campaign: role opener, resource promise after opener, real external link (not `index.html` or `Node.js`).
- `inspectNsiteSpam(site)` distinguishes `confirmed`, `review` and `clear` with inspectable reasons; `clusterNsiteSpam(sites)` detects repeated description templates from distinct authors without turning a guess into an irreversible block.
- `filterNsites(sites,{bannedPubkeys,hideConfirmed,hideSuspected=false,ownPubkey})` excludes confirmed spam from *visible* results, protects local/pinned items, and returns all hidden rows plus decisions. Original records stay untouched.
- `parseCuratorBlocklist(json)` and `mergeBlocklists` import/export user-curated publisher and SHA-256 media hashes. Known NSFW publisher/hashes/URL lists are *data*, not media downloads. No content is fetched or rendered.
- `isEmojiAllowed(candidate,policy)` supports open-with-banlist or verified-safe-publishers-only, without filename/shortcode keyword censorship. `normalizePubkey`, `decodeNip19`, `normalizeEmojiHash` validate identifiers. For `nevent`, `hex` is always the event ID and `author` is the optional author hint (or null), never a verified identity claim.
- `parseNip51MuteList(signedEvent)` verifies a kind-10000 event signature before extracting muted authors. `muteListTemplate(pubkeys)` creates an unsigned template only; no automatic publish.

## Moji

- `extractEmojiHash(url)` extracts an embedded Blossom SHA-256 when present, or computes a deterministic canonical URL fingerprint otherwise; a URL fingerprint is **not** a verified media content hash.
- `buildStableEmojiKey(url,source)` uses `nip30:<hash>` or `reserve:<hash>`, not a mutable shortcode. `deriveEmojiStatsFromHash` and `deriveEmojiStats` port MojiSurvivor's deterministic hash-driven stats and rarity tiers.
- `parseNip30Event(signedEvent,{policy})` imports signed kind 30030 / 10030 emoji tags while applying publisher/media bans. `collectNip30Emojis(events)` deduplicates by media identity, returns exclusions and unresolved `a` references. It never claims to have fetched linked packs automatically.

## Anchor

- `sanitizePublicSession`, `buildPublicAccountBackup`, `restorePublicAccountBackup`: public-only account configuration exports. No `nsec`, bunker URI, signer credential, or private auth state. Restore is **always read-only until reapproved** and checks saved signed publication events.
- `summarizePublicationReceipts` separates accepted `OK` from **independently retrieved**. `extractEventAssets` parses the `imeta` URL tags from verified events without fetching or rendering media.
- `kindSpec`, `classifyEventStorage` are derived from Anchor's NIP-kind registry and NIP-01 storage rules.
- `assessRelayOutbox`, `planVerifiedOutbox` accept probe evidence, do not assume unknown relays are healthy, and recommend writes only when an actual write probe is recorded.

## Archive (Gear profile additions)

- `GEAR_PROFILE`, `gearChunks(data)` reproduce Pretend Internet's exact Gear CDC profile (`gear-v1-16k-64k-256k`); chunking is internal and does not replace Blossom whole-file SHA-256 or NIP-5A aggregates.
- `chunkManifest(bytes)` creates a hashed reusable chunk manifest; `restoreChunkManifest(manifest,read)` verifies every chunk and final whole-file bytes.
- **No Hashtree codec bundled.** This does not claim byte-for-byte HTS-01 node interoperability; use the canonical upstream `@hashtree/core` encoder separately.

## Verified retrieval and cache policy

See [CROSS_DONOR_RETRIEVAL.md](CROSS_DONOR_RETRIEVAL.md) for `Nsite.resolveNsiteManifest`, `Nsite.resolveManifestPath`, `Nsite.loadNsiteFile`, bounded `Blossom.fetchVerified`, and failure/cache semantics.

## Archive — signed revisions and source comparison (rc.5)

- `SNAPSHOT_KIND = 1349`; `snapshotTemplate(event,{created_at?,maxBytes?})` validates the original author signature and builds an **unsigned** snapshot template compatible with Open Specs' e/k/p/a binding. The caller supplies an explicitly approved archivist signer using `Nostr.checkedSign`. No implicit network operation.
- `unwrapSnapshot(signedSnapshot,{expectedCoordinate?,maxBytes?})`: verifies both signatures and exactly one matching e/k/p/a tag of each type; returns `{event,coordinate,snapshotId,archivist}` or throws. Archivist identity is separate from original author identity.
- `archiveRevision(event,store,{maxBytes?})` writes canonical signed wire fields to existing CAS and independently verifies readback; returns `{schema:'nostr-revision/1',coordinate,eventId,hash,size}`. `restoreRevision(record,store,{maxBytes?})` rechecks hash, size, signature and record identity. Caller persists the record and, if needed, the signed snapshot separately using the existing storage/CAS interfaces.
- `compareMarkdown(base,other,{maxBytes?,maxCells?})`: lossless line-based source comparison, returns `{changed,exact,similarity,changes:[{kind,text}]}`. `exact:false` means the optimal line alignment exceeded the bounded LCS budget; unchanged prefix/suffix plus complete replacement preserve both sources. Similarity is the matched-line fraction, not semantic similarity. Render text as text; no HTML is produced.
- `materializeVersion(manifest,store,{maxFiles?,maxBytes?})`: checks canonical unique paths, snapshots manifest references, independently verifies every blob digest, bounds total bytes. Pass a manifest parsed from a verified event when author authenticity matters. `groupVersions` orders equal-timestamp parsed manifests by event ID.

## Intelligence (22 exports)

Host-independent Anchor content preparation and advisory ecosystem intelligence. See [Anchor intelligence integration](ANCHOR_INTELLIGENCE.md) for typed operations, donor provenance, limitations and safe publication boundaries.

Verified relay receipts now require explicit acknowledgment and exact event ID.

## Open Specs registry adapter

See [OPEN_SPECS.md](OPEN_SPECS.md) for signed document search, revision-aware indexing and advisory kind definitions.

### Event-specific relay delivery

`Nostr.planRelayDelivery(signedEvent, options)` and `Nostr.summarizeRelayDelivery(plan, receipts)` are offline advisory APIs. See [relay delivery reconciliation](RELAY_DELIVERY_RECONCILIATION.md) for group/policy contracts, exact receipts, explicit private/authentication boundaries and remaining transport work.

## Reconciled Blossom prerequisites and replicas

`Blossom.preflightBlob`, `Blossom.blossomBatchUploadAuth` and `Blossom.verifyBlobCopies` expose explicit advisory upload preflight, scoped unsigned batch authorization and MIME/size/hash-verified multi-origin readback. See [BLOSSOM_RECONCILIATION.md](BLOSSOM_RECONCILIATION.md). None uploads or signs on behalf of the caller.

### Opt-in version-2 publication

See [PUBLICATION_RECONCILIATION.md](PUBLICATION_RECONCILIATION.md). The existing plan/publish functions accept `storageServers`, `requiredCopies`, and optional `gateway` hostname; execution requires approved digest and verified current-revision resolver, and accepts `resume` with the typed version-2 checkpoint. The original single-server contract remains supported.

### Authenticated relay delivery

`Nostr.executeRelayDelivery(event, options)` recomputes an approved-destination plan and performs bounded fallback, optionally using a caller-approved NIP-42 signer. Signed NIP-66 monitor hints and principal-scoped observations can inform planning; neither is proof of relay compatibility. See [relay authentication reconciliation](RELAY_AUTH_RECONCILIATION.md) for cancellation, protected/ephemeral event semantics and remaining integration limits.
