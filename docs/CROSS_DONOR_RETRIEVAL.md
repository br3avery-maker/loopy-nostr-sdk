# Batch 4 — Verified discovery and retrieval

Release candidate 1.1.1-rc.4, built from the exact rc.3 ZIP pinned in `provenance/manifest.json`. No network writes, signing, publication, new database, or embedding. The restored Quarry database is unchanged. The added code independently implements observed patterns; donor excerpts are not redistributed in this SDK.

## Donor comparison

| Quarry donor | Source | Applied invariant |
|---|---|---|
| `nsite-cache-first-manifest-resolution` | hzrd149/nsite-gateway `src/services/nostr.ts`, blob `5f2b3d0e9c7d611a9d60f0fb424949715311a0a4` | Cache-first then author outbox and caller hints; explicit observation age and refresh mode. |
| `nsite-manifest-path-resolution` | hzrd149/nsite-gateway `src/helpers/site-manifest.ts`, blob `6bc47502dd7468544982f8ea85858215689ee92c` | Exact path, directory index, explicit 404; no silent SPA replacement. |
| `nostrapps-napplet-integrity-gate` | eskema/nostrapps `src/nsite/napplet.ts`, blob `920c452709db07d4d13d83ed81cb2d290363133f` | Reverify signed event and file bytes on restore; use manifest and author servers. |
| `nostrsite-stable-site-address-cache` | nostrband/nostrsite `src/index.ts`, blob `5340c9d357c6be055be6c1199a056c836ae978a5` | Stable address for offline lookup, distinct from exact revision ID. |
| `ndk-cache-warmup-query` | irislib/iris-apps `packages/ndk-cache/src/index.ts`, blob `e2eee63eafbc396a6eaf1c673d0942600ca2be32` | Cache readiness before lookup. Existing async storage interface is sufficient. |
| `nsite-manager-relay-provenance-cache` | hzrd149/nsite-manager `src/services/event-metadata.ts`, blob `839d0cf42e22c950e3b273933fdfe1d76ab1fe25` | Keep exact event identity and relay observations separate; rc.2 provenance API remains unchanged. |
| Open Specs | `packages/nostr/src/nip65.ts`, `relay.ts`, commit `04a7672a19588406d0bffe710053c7d3a6146cc9` | Role-aware outboxes, bounded queries. Do not conflate empty query with failed relay; retain errors. |

## Consumer contract

```js
import {Nsite,Archive,Storage} from '@chaoticka/nsite-loopy-sdk';
const storage=Storage.memoryStore(); // Or existing IndexedDB adapter
const resolved=await Nsite.resolveNsiteManifest(pubkey,{
  identifier:'demo', bootstrap:configuredIndexers, relays:knownHints,
  storage, mode:'refresh', signal,
});
if (resolved.event) {
  const file=await Nsite.loadNsiteFile(resolved.event,'/',{
    store:Archive.contentStore(storage), relays:resolved.queriedRelays,
    servers:configuredBlossomFallbacks, signal,
  });
  // file.data is verified bytes, NOT trusted executable HTML.
}
```

- `resolved`: a valid signed candidate observed this run, including possible partial relay failures. Not a proof of global latest; inspect `errors` and `queriedRelays`.
- `cached`: signature and manifest reverified locally, observation within TTL, no network query. `stale`: offline, refresh missing, or older relay result; explicitly not fresh. `checkedAt` is observation epoch seconds, not event creation time.
- `not-found`: successful bounded queries returned no matching candidate and no recorded failure; not proof of nonexistence. `unreachable`: no reliable result or offline cache miss. `invalid`: selected signed candidate fails manifest validation; do not silently roll back. Do not feed a cached/stale/not-found or partial result directly into the rc.3 publication freshness gate as proof of current revision or absence.
- Named manifests match exact author/kind/first d tag. Root manifests ignore d tags. Latest observed revision sorts by created_at and lowest ID. Marked aggregate x tags take precedence over unrelated x tags; legacy unmarked x remains checked if no marked aggregate exists. `created_at` is exposed in the parsed record.
- Resolve path from raw absolute site path (no decoding, query stripping or arbitrary filesystem access). Exact, directory index, then explicit `/404.html`, otherwise null. Bytes must still be loaded and verified; do not execute untrusted code outside appropriate sandbox.
- File load verifies signed manifest every time, checks cached SHA-256, tries manifest and caller endpoints, then discovers the author's signed Blossom list if needed. Existing content store repairs corrupted payloads from verified bytes; it snapshots caller data before asynchronous digest. No speculative upload. `fetchVerified` tries each valid unique server, skips malformed candidates, bounds each attempt (default 15 seconds) and bytes (default 128 MiB), checks digest, and stops on cancellation. Successful fallback exposes prior errors. HTTPS redirects are rejected; callers with known redirect requirements need an explicitly reviewed transport policy.

## Limits

Tests use signed offline fixtures, fake transports and memory storage; no real relay, browser IndexedDB or remote Blossom availability is claimed. Query limit 20 and up to 24 relays are bounded observations, not full history; relays may omit revisions. Same-key writes are serialized only for calls sharing the same storage object in a single JS realm; across tabs/processes use host transaction coordination. A non-streaming injected response's arrayBuffer is bounded after read. Endpoint syntax validation is not complete SSRF prevention; server-side consumers need a network egress policy including DNS/private addresses. The caller must provide configured bootstrap/fallback endpoints; no hardcoded new relay service or signer.
