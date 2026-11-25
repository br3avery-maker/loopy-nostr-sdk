---
name: publish-nsite
description: Prepare, sign, upload, verify and recover a NIP-5A nsite release with exact-byte Blossom receipts and Nostr relay readback using the unified SDK.
---

# Publish a real nsite

Inputs: static HTML/CSS/JS file map, approved signer, user-selected Blossom destination, known relays, root or named identifier, explicit publication authorization. Outputs: SHA-256 pin, deterministic `manifestTemplate`, signed manifest, exact-asset upload receipts, relay OK+readback, safe checkpoint and URL.

Run `Nsite.prepareManifestFiles` to validate/sha every path, then `Nsite.publishNsite` using injected approved `Signer`. This code performs BUD-11 authorization and verifies each GET against its hash. It waits for signed exact-ID relay readback; a relay OK alone does not pass. `checkpoint(job)` must retain safe non-secret state so retries can resume. Do not assert gateway rendering from relay readback. Don't ship a public event without explicit user authorization.

On any failure: stop; preserve downloaded bytes and receipts; do not regenerate identities, change the signed event or swap to unknown paid/auth-required endpoints silently.
