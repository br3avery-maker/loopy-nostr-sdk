# Anchor intelligence integration (1.1.1-rc.6)

Private candidate, derived from `br3avery-maker/anchor` commit `8b787cc071a657347b1bb29177eef9c2e7f4cf65`. The five original TypeScript files are preserved under `provenance/anchor-intelligence-source/`; runtime ESM and declarations are compiled using TypeScript ES2022 with `.js` import extensions. No React, network or signer dependency was added. The existing Anchor namespace and transport APIs remain in place. Use `import { Intelligence } from '@chaoticka/nsite-loopy-sdk'` or the `@chaoticka/nsite-loopy-sdk/intelligence` subpath.

## Operations

- `reconstructPreferences`, `recordCorrection`: infer or apply explicit preferences from caller-supplied evidence.
- `detectAndPrepareContent`, `analyzeNsiteIdentity`: classify six content categories, propose metadata and warn about root/named site changes.
- `auditCoverage`, `summarizeObservedActivity`: inspect supplied evidence, not independently query the network.
- `auditSinglePublication`, `analyzeAccountEcosystem`: return advisory audit and correction proposals; no automatic edits.
- `classifyRelay`, `buildRelayOptimizationPlan`, `isSuitablePublicOutboxRole`, `roleClassLabel`: advisory relay decisions; live endpoint health is not implied.
- `getKindSpec`, `classifyEventStorage`, `getLicensesForCategory`, registry constants: source-derived application conventions and reference data, not a live or authoritative NIP registry. `Intelligence.classifyEventStorage` retains donor behavior; use `Anchor.classifyEventStorage` for validated protocol inputs.

A prepared draft is not authorization to sign or publish. Verify caller-supplied events with Loopy, resolve local assets with verified upload, validate URLs and kind-specific contracts, preserve identity and unowned tags, approve the final event and destination before signing. Donor defaults and ecosystem compatibility assumptions require separate live validation. The prior headless consumer adapter demonstrates this boundary.

## Receipt contract change

`publishTemplate`, `publishNsite`, and `publishMany` now require a trusted injected writer to return `{relay,eventId,accepted:true,readback:true}` for the exact expected relay and signed event ID. Missing fields, false acknowledgment and mismatched identities are rejected. Successful results only include validated receipts. Existing custom mocks/adapters returning only `readback:true` must be updated. The default transport performs actual protocol OK and exact-ID signature verification; the SDK cannot independently prove a custom transport's assertions. Signed event copies isolate caller state from transport mutation.

`Anchor.extractEventAssets` recognizes NIP-94 direct URL tags, music URL/cover tags for 31337/32123/36787, existing imeta URLs, and signed content-addressed inline HTTPS references. It returns references only; it does not claim blob availability or hash verification. The media logic follows Anchor `src/nostr/network.ts` `extractAssetsFromEvent`, narrowed to the established URL-list API.

## Provenance and tests

Originally a private source-derived extraction. Owner-controlled contributions are now offered under MIT; no deployment authorized. Original donor sources verified against the pinned Git tree in the independent consumer evidence. Original nine native intelligence cases ported only by changing import paths. Eight regression cases cover media URLs and strict receipt handling, including the original three consumer failures. Existing positive test mocks updated to honor the corrected receipt contract. Full headless consumer integration retested against an installed SDK with no local donor-runtime imports. Live relay, Android signer, complete Anchor UI integration and IC tool registration remain separate acceptance work.

## rc.8 review repair

The exact donor TypeScript source remains unchanged under `provenance/anchor-intelligence-source`. The runtime `relayIntelligence.js` is an adapted copy: known negative probe and policy evidence is retained across current/candidate duplicates and all fallback and specialty write destinations. Suggested unknown relays are not verified. See `REVIEW_REPAIRS.md`.
