# Cross-donor comparison — batch 3: safe edits and publishing

Candidate 1.1.1-rc.3, based on the SHA-256-pinned rc.2 ZIP (`e1c1cb927025f207769af0b01fea93c2c26bc893c39e40b23e3496c8f41f5313`). No embeddings, live signing, relay writes, deployment, or upstream changes. The existing Quarry database and source collection remain unchanged. The new primitives are independent implementations of the observed invariants, not a wholesale port of donor code; donor redistribution rights remain separate.

## Sources inspected and dispositions

| Source | Observed implementation | Decision |
|---|---|---|
| Open Specs `packages/nostr/src/spec.ts` at `04a7672a19588406d0bffe710053c7d3a6146cc9` (`editSpec`, `specDraftOf`, `forkSpec`, `withdrawSpec`) | Explicit owned tags, preserve foreign tags and original publication date, separate fork from edit, withdrawal is intentional replacement | Generalize explicit ownership to arbitrary replaceable/addressable events, verify original signed baseline, keep exact `d` and author, report removed tag multiplicity. Do not automatically derive or trim an existing `d`. |
| Quarry `better-nips-replaceable-registration`, formstr-hq/better-nips `src/hooks/useAppDirectory.ts`, `9efa4b8f9ae66b9d50b925a4398b78fd39d8d006a7a3d89a6e18cc8e1dd50dc7` | Same `d` replaces prior app registration | Preserve identity; explicitly changing owned tags may discard unlisted metadata, so preserve unknown tags by default. Excerpt only; license unverified. |
| Quarry `sidecar-local-replaceable-baseline-design`, dmnyc/sidecar `replaceable-baseline.js`, `12617408a71def7de8ad5a36d1f05dc4b2fdaca20dd9c7aa858a6bd61301aee9` and `sidecar-replaceable-baseline-invariants`, `test/replaceable-baseline.test.js`, `ac861434edf8a93b6b655239b00a7879d64514c8fbf14ceb1e843e9711ef1b94` | Local baseline and destructive overwrite warnings; stale/no baseline does not mean safe; total list wipes and profile-field loss deserve notice | Expose exact losses rather than impose Sidecar's UI warning thresholds; no network needed for local review. Optional freshness checks belong before publish, not in the signer prompt. Excerpts only; donor tests not executed. |
| Quarry `nsyte-dry-run-parity`, sandwichfarm/nsyte `src/commands/deploy.ts`, `c7650e8af3a0b521100d0c9203f7ec9faae2131c901a903886e545547618ae17` | Dry run and deploy use same mapping helpers; no signer needed for preview | Share a single SDK plan path, bind exact reviewed bytes, destinations, metadata, timestamp and signed baseline by digest. Excerpt only. |
| Quarry `iris-sites-runtime-update-policy`, `9c01eeba8871de55a89e76b255d2e08fbbc9b02b204b6b8f66215890d91262bf` | Compare runtime signature to classify bootstrap/ignore/notify/reload | Distinguish unchanged paths from changed paths by hash; runtime reload policy remains consumer-owned. |
| Quarry `nsite-path-hash-publisher`, lez/nsite `uploadr.py`, `ace628fcb8b08ae2e65670c089e8c306589fb5e3bc39fec4bbade3b01180ef9a` | Older per-path kind34128 publishing, content hash storage, mtime comparison | Do not merge legacy per-path event format into NIP-5A manifest publisher; compare exact content hashes, not mtime. |
| BreBre-Web `publish.js`, `0dd138ab9c4eb4771929bb0c48959143e52def78ee9171d4e0c4a188a1c91342` | Check destination; fail if no relay completed; clone inherits metadata/lineage separately | Keep explicit freshness resolver contract; fail if it throws, never treat a failed read as proof of absence. |
| Directory Editor `app/publish-core.js`, `6dc086e39f17e4ebaa17d84a6080db21c54c0cf73d0fc8c1c0bcf7df6caae34f` and `app/publish.js`, `7199294efaf8878f5f4181a8b7acc3d866ad188250f415a142ef9f8e933bf4be` | Prepared jobs, account binding, exact destination review, upload/relay receipts | Keep existing SDK checkpoint API, validate author/destinations before uploads, add plan/baseline IDs to job. |
| Safehouse publisher `src/manifest.js`, `b6fda06647376eeb34e6f9e811b06ea199cf777b1f5dbdbd0faee64cc211a318`, `src/publish.js`, `bf4a2e4902fcbff3181a28f20f229c25734b63a9fce9ca271514e89757064aee` | Plan ID binds identity, settings, metadata and aggregate; receipt records plan and stages | Reuse the established plan/receipt pattern; exact template timestamp is additionally bound. The source collection is the authority for byte identity. |
| Safehouse `src/preview.js`, `dac18867f19529e4970d7b21163e022c865a4ec2559fb78e5e687f29156e835f`, and `safehouse-cli/safehouse.mjs`, `db7d2c0fced52e183e2ca8a366607e996d1d882e0ce62667e840b2022e522568` | Preview compilation does not alter published bytes; separate offline recovery | Preserve the same original bytes in preview and publication; do not integrate a browser preview compiler or replacement archive CLI. |

## Public operations

`Nostr.prepareEventReplacement(baseline, options)` edits explicitly named tag groups. For example:

```js
const review = Nostr.prepareEventReplacement(liveSignedTrack, {
  created_at: Math.max(Math.floor(Date.now() / 1000), liveSignedTrack.created_at + 1),
  replaceTags: {title: [['title', 'Corrected track title']]},
});
// Show review.template, removedTags, addedTags, contentChanged and removedProfileFields.
// Only after actual user approval, sign with the original author and publish via the existing API.
```

`Nostr.reviewEventReplacement(baseline, template, pubkey)` also checks externally constructed templates. It accepts only verified signed replaceable/addressable baselines; rejects wrong author, kind, first `d` and non-increasing timestamps; preserves duplicate tag counts in the review. Generic review reports exact tag removals and added tags, and removed JSON-object keys for kind 0; it does not semantically interpret every kind, decide whether all edits are safe, or bind arbitrary generic signing to a preview. Keep `published_at` and foreign tags unless explicitly editing their names. Generic profile JSON content is still caller-controlled. The generic track test is a synthetic addressable music metadata fixture, not a standardization claim for any particular music event kind.

`Nsite.planNsitePublication` and `Nsite.publishNsite` use the same preparation path. A consumer may use the plan without a signer or network access. For an observed signed baseline, missing title/description preserve existing values; explicit empty strings remove them. File removals require separate explicit approval. The named identifier is inferred from the baseline if omitted, and cannot be changed for an update. For root sites the identity remains root. A named new site must use a valid explicit identifier. Existing foreign tags and content are retained; path, server, title, description and aggregate metadata belong to the manifest editor. The plan reports all changed paths and removed/added tags. A no-baseline plan says `unknown`, not `new site` or `safe`.

```js
const settings = {
  pubkey, server, relays, baseline: signedCurrentManifest,
  created_at: Math.max(Math.floor(Date.now() / 1000), signedCurrentManifest.created_at + 1),
};
const plan = await Nsite.planNsitePublication(files, settings);
// Review plan.template, plan.files, plan.changes, plan.removedTags and exact destination.
// Following explicit user approval:
const receipt = await Nsite.publishNsite(files, {
  ...settings, signer, approvedPlan: plan.id,
  allowFileRemovals: userApprovedFileRemovals,
  resolveCurrent: getVerifiedCurrentManifest,
});
```

Use the same timestamp and options when executing a digest-approved plan. The ID binds exact template, file hashes/sizes, normalized server, relay order, author, identifier and baseline event ID. The publisher snapshots file bytes before yielding and passes copies to upload adapters. It validates destinations, plan, removal approval and signer identity before upload; checks the optional resolver before upload, before manifest signing, and after signing before relay publication. The resolver must verify all evidence it relies on, return the current signed event for the requested coordinate, return null only after a successful absence check in its declared relay scope, and reject on incomplete/unavailable reads. The SDK validates returned signed events and exact baseline ID. The resolver is an injectable contract, not a new network discovery implementation. It cannot provide atomic compare-and-swap over Nostr; an event can arrive after the last check. The legacy `publishNsite` entry point without a baseline/approval/resolver is still supported for compatibility and is not certified overwrite-safe. No approval digest is a security boundary against a dishonest caller or transport adapter. Injected upload/publisher adapters remain trusted; wrong relay or explicitly wrong event-ID receipt is rejected, existing receipt adapters omitting acceptance/ID remain supported. Default transports supply explicit signed readback and acknowledgement. Cancellation after publication cannot undo a remote write.

## Differential and verification

20 new offline tests exercise generic replacement identity and metadata, exact preview/approved signature, deterministic file order, stale/new baseline, byte snapshots, destructive removals, invalid destinations, signer mismatch, cancellation, receipt binding, and root-site updates. The comparison with rc.2 separates new missing API surfaces from concrete behavioral defects. Existing `prepareManifestFiles` and `uploadVerified` used mutable caller buffers, the publisher validated some destinations after uploads and could send a manifest after cancellation, and injected receipts could refer to a different relay/event. Original existing API tests are retained. New primitives do not implement any music-specific publishing protocol, automated signer approval, live resolver, or document comparison/snapshot support. Live relay/Blossom/Android tests remain separate.
