# Publication reconciliation — batch 3 (unreleased)

The recovered owner-controlled Safehouse publisher, `src/publish.js`, explicitly checks destination copy counts, uses the actual file MIME type, distinguishes manifest readback from site readback and records attempted uploads. This independent adaptation preserves those useful behaviors and the existing Loopy planner's immutable bytes, exact signed baseline and digest checks. The original donor archive and exact source remain in private recovery evidence. The previous source comparison is in [BLOSSOM_RECONCILIATION.md](BLOSSOM_RECONCILIATION.md). A search of restored code for named resume functions did not establish a reusable durable resume implementation; resume here is new orchestration using the existing primitives, not a claimed source-exact port.

## Existing API, explicit opt-in

```js
const settings = {
  pubkey, server: approvedServers[0], storageServers: approvedServers,
  requiredCopies: 2, relays: approvedRelays,
  identifier: 'example', created_at: reviewedTimestamp,
  baseline: previouslyObservedManifest,
  gateway: 'nsite.lol', // optional, explicit gateway hostname
};
const plan = await Nsite.planNsitePublication(files, settings);
// Review plan.id, storage, gateway, exact template and file changes.
// After explicit approval:
const result = await Nsite.publishNsite(files, {
  ...settings, signer, approvedPlan: plan.id, resolveCurrent,
  checkpoint: job => localStore.set(plan.id, job),
  resume: savedJobOrUndefined,
});
```

Without the new fields, `planNsitePublication` and `publishNsite` preserve the original version-1 digest and behavior. Providing `storageServers`, `requiredCopies` or `gateway` opts into `nsite-publication-plan/2`. The primary server must be first in the explicitly supplied storage list. The required threshold cannot exceed distinct origins. All normalized approved destinations, threshold, per-path MIME, gateway URL, exact manifest template, baseline and file bytes' hashes are bound to the digest. Server tags describe **approved candidates**, not proof every file is stored on every listed server. No new runtime exports, dependencies or implicit discovery. MIME support adds wasm and webmanifest.

Version 2 requires `approvedPlan`, a signer account check and a `resolveCurrent` function with the existing verified-current-or-confirmed-null contract. An unavailable or incomplete resolver must reject; a race remains possible after the last check because Nostr has no atomic compare-and-swap. File removal approval remains separate. Explicit network writes and signing remain caller-controlled. Every file is freshly read at approved storage candidates before upload. Failed/corrupt/wrong-MIME reads don't count. The existing uploader is used only for missing copies, with a scoped bounded descriptor/readback transport, then the existing distinct-origin verified-copy API checks the actual bytes again. A claimed successful upload cannot satisfy the threshold by itself. Different paths on one origin do not count as separate copies. Distinct origins are not proof of independent operators. This mode requires readable blobs with the expected MIME; identical bytes needed with incompatible MIME types may not be supported by a content-addressed server. The injected transport and baseline resolver remain trusted. Host DNS/egress controls remain necessary in server environments.

## Resume and receipt semantics

Persist the **local** version-2 checkpoint (schema `nsite-job/2`) through the existing callback. A checkpoint stores the plan and baseline IDs, path/hash/size/type and observed copies, attempted destinations, exact signed manifest when available, verified relay receipts and optional gateway result. It does not store private keys, unsigned approval tokens, upload authorization headers or file bodies. It is not a public receipt or automatic permission to publish. Resume requires the same bytes, options, timestamp, approved digest and baseline. A saved manifest is verified against the exact plan. A resolver may report the saved signed revision as current; another revision blocks execution. Prior storage and relay claims are not blindly trusted. Fresh reads allow still-present copies to be reused and missing ones repaired. The saved manifest is reused without another manifest signature. Relay publication is re-attempted with the identical event on the original approved relay set; it is not skipped solely because a saved receipt claims success. Interrupted publication may already have caused a write. A crash before durable persistence of a signature can still require signing again; callers must persist checkpoints durably and serialize runs for a plan. The thrown error may carry `error.job` for local recovery. Signer cancellation remains dependent on the signer adapter (separate baseline review).

Manifest relay verification still requires the SDK's exact ID/relay acknowledgment and readback receipts. An explicit gateway is checked only after that gate. Each approved path is encoded by segment; redirects, credentials, caching, wrong MIME, incorrect size or hash cannot count as site verification. Gateway checks are bounded by 30 seconds overall and 10 seconds per file; an unavailable or stale gateway is `gateway-unverified` rather than erasing successful manifest receipts. Without an explicit gateway, the result remains `relay-verified`. No gateway check is performed automatically in a directory or discovery operation. This is a point-in-time readback, not an availability guarantee.

## Evidence and remaining scope

Eleven offline cases exercise versioned approval, origin thresholds, fallback, unverified uploader claims, interruption after uploads and signing, stale/tampered checkpoint rejection, lost copy recovery, gateway bytes and MIME, exact relay receipts, cancellation and the real SDK uploader with simulated HTTP. Live Blossom/relays/gateway, actual browser/Android signer, automatic multi-hash signed-token execution, NIP-66 monitor evidence and authenticated relay execution, and reverse adoption by existing consumers remain outstanding. No new release or public network publication has occurred.
