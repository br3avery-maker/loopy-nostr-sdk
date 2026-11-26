# Relay delivery reconciliation — first integration

Source comparison: [Pretend Internet relay-router](https://github.com/br3avery-maker/Pretend-Internet/tree/05fee992a984cd373e4283b29033f3d6256e5ab4/tools/relay-router), router.mjs Git blob e647688aab92893f0d134ed268ca221998d01bf7, validation.mjs blob 2b4f9baeb6a482706efaff315cd1b124e5f9d50c. Reference-only comparison; the new module independently implements the observed planning contract using existing SDK signature and receipt primitives. Archived Safehouse predecessor was tested with the SDK verifier and filter supplied as explicit dependency adapters; no private donor source is distributed.

## Reusable contract

```js
import { Nostr } from '@chaoticka/nsite-loopy-sdk';
const plan = Nostr.planRelayDelivery(alreadySignedEvent, {
  signedLists: verifiedListEvents, defaults: approvedBootstrapRelays,
  relayPolicies: callerObservedNip11Documents, redundancy: 2,
});
// Planning is offline; no publication or authentication has happened.
// Following a separately approved send via an appropriate trusted writer:
const result = Nostr.summarizeRelayDelivery(plan, exactEventReceipts);
```

The flat planRelays helper remains unchanged. The new API separates author-write and recipient-read groups and retains missing/insufficient destination status. It verifies caller-supplied signed kind-10002/10050 lists and selects newest observed revision (lowest ID on ties), including empty replacements. Missing read lists are not replaced with author/bootstrap relays. It applies fresh observed NIP-11 limits for UTF-8 frame bytes, Unicode content length, tag count, PoW, declared auth and payment. Stale metadata is advisory; equal-time conflicting limit observations are conservative. Explicitly allowed endpoints constrain every group. Private plans require explicit destinations; gift wraps use only signed recipient inbox lists; protected events require declared matching author authentication capability. No authentication operation occurs. Unapproved IP literals and local hostname hints are excluded; caller-specified destinations may be local. This is not DNS/SSRF protection; callers own egress policy. Candidate and input bounds are enforced. Receipt summaries require exact event ID and relay; stored/unknown-persistence kinds require readback; ephemeral acknowledgments are distinct. Duplicate or unrelated receipts do not satisfy redundancy. Custom writer assertions are not independent network proof. Plans and receipts are caller-owned advisory data, not a publication authorization or a cryptographically bound approval. Do not use generic publishMany as a private/authenticated/ephemeral delivery transport.

## Comparison and remaining work

| Capability | Disposition |
| --- | --- |
| Grouped destinations, redundancy, fresh policy and recipient guards | Implemented offline plan and receipt-summary APIs. |
| Exact event identity/readback | Preserve stronger SDK contract; archived router custom-writer test accepted verification booleans without exact identity. |
| Signed NIP-66 monitor evidence, registry snapshot, scoped cooldown | Identified in existing router; not yet integrated. |
| Authenticated bounded transport and group fallback execution | Existing donor identified; not implemented by this planner. |
| BUD-06 metadata-only preflight | Identified; pending integration. |
| Safehouse publication consumer | Batched auth, blob copies, bounded response bytes, MIME checks and gateway readback identified; migration pending. |

Ten regression tests and three independent archived-donor comparisons passed offline on reconstructed rc.9 source with relevant runtime imports byte-identical to rc.10 head e611870edd7ca0ab987b4508325df21e2a54dc07. Full local source checks passed 190 JavaScript tests, 15 SDK Python tests, TypeScript, 63 module pins and 185 exports. Exact-head CI/review is separate; no live transport, signer, target device or release acceptance is claimed. This is the first integration, not exhaustive donor reconciliation.
