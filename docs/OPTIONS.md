# Standardized options and interfaces

**Signer interface:** `{getPublicKey(): Promise<hex64>, signEvent(unsigned): Promise<SignedNostrEvent>, close?()}`. Signing requires explicit approval in the user's selected signer. `Nostr.browserSigner`, `.bunkerSigner`, `.nostrConnectRequest`, and `Adapters.androidHandoff` adapt real hosts to this contract.

**Transport options:** `fetcher` is WHATWG `fetch`; `Socket` is the browser `WebSocket` constructor or a compatible injected constructor; `clock` returns Unix seconds; `signal` is an `AbortSignal`. Network results must be verified before status success. The tests inject deterministic mock transports solely for logic acceptance.

**Storage interface:** asynchronous `get(key)`, `set(key, value)`, `delete(key)`, `keys()`. Use IndexedDB for offline browser catalog/caches; `memoryStore` for tests or ephemeral state. Do not store remote-signing transport secrets in generic persisted state.

**Filename / URL constraints:** Files use canonical forward-slash site paths. No `..`, `.`, empty path components, query strings, fragments, backslashes, NUL, or encoded traversal. Relays are `wss://` and Blossom servers `https://`, validated separately. The default path policy does not automatically authorize private LAN SSRF to Blossom servers.

**Publication:** `(files, {signer,pubkey,server,relays,identifier,title,description,checkpoint})`. Each output stage is checkpointable. A prepared manifest is not a signed event; an upload response is not exact-byte verification; a relay `OK` is not successful readback; a gateway URL is not proof the gateway currently renders.

**Host compatibility:** Node >=20 supports direct Nostr crypto, ZIP and pure manifests. Browsers need `crypto.subtle`, `WebSocket`, `fetch`, `TextEncoder`; IndexedDB optional. Android app switching requires a host-specific callback. Shell/Codex NIP46 can use `bunkerSigner` after user-approved connection. Do not confuse signed publication and host deployment.

**Finite query:** `queryRelay` snapshots a single filter, checks exact IDs, authors, kinds, single-letter tag values and inclusive time bounds locally, and counts only matching unique events toward its cap. `limit:0` returns no stored events. This finite API does not implement live subscriptions or guarantee complete pagination at a cap. Search extensions are relay-defined. `verify:false` deliberately disables cryptographic checking, not filter matching.

**Signer and publication hardening:** `checkedSign` gives the signer a detached copy and compares the returned signed event to the original approved snapshot. `publishRelay` only accepts readback after a positive matching OK and the subsequent REQ. Readback on the same connection is not independent external relay verification.

**History scan:** Explicit non-ephemeral `filter.kinds` is required; supported filter keys are exact IDs/authors/kinds, single-letter tags, `since` and `until`. Set `pageSize` (1–1000, default 100), `boundaryLimit` (greater than pageSize, at most 5000, default 500), `maxPages` (1–100, default 8; each page can have one extra boundary query), and `now` (epoch seconds, defaults to batch start). A checkpoint is bound to a normalized relay and filter; do not move it to another relay/filter. Use the existing storage adapter to commit received observations and cursor together. Retain the previous watermark and unfinished window on transport failures, cancellation, or ambiguous boundary results. The observed-window result does not establish global completeness or detect every silent relay cap; late arrivals older than the watermark need an explicit overlapping backfill. See `CROSS_DONOR_HISTORY.md`.
