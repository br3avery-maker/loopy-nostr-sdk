# Authenticated relay delivery and monitor evidence — reconciliation batch 4

## Existing source and comparison

Compared the owner-controlled [Pretend Internet relay router](https://github.com/br3avery-maker/Pretend-Internet/tree/05fee992a984cd373e4283b29033f3d6256e5ab4/tools/relay-router), especially `router.mjs` (Registry.monitor/observe, RelayRouter.plan/publish) and `transport.mjs` (RelayTransport.publish). Independent adaptation into the existing SDK transport and planner: no imported donor network stack or new dependency. The donor has useful signed monitor evidence, principal-scoped rejection cooldown and bounded fallback. Its duplicate rejection branch could return accepted:true after a negative OK; LNsdk retains the explicit positive ACK requirement. Reuses `checkedSign`, `relayAuthTemplate`, `verifiedCopy`, the existing receipt verifier and relay planner.

## Callable behavior

```js
const result = await Nostr.executeRelayDelivery(signedEvent, {
  allowedRelays: approvedDestinations,
  defaults: approvedDestinations,
  signedLists: verifiedListEvents,
  monitorEvents: observedMonitorEvents,
  observations: localPriorObservations,
  redundancy: 2,
  maxAttempts: 8,
  // Only if separately approved by the caller:
  authSigner: approvedSigner,
  authPubkey: approvedSigningIdentity,
  signal,
});
```

Execution is explicit; no discovery, scheduling or implicit signing merely by importing or planning. The executor recomputes the plan from the signed event and caller inputs; no externally mutable plan is trusted. Every attempted URL must be in the explicit `allowedRelays` list and the applicable delivery group. Each destination is tried once across groups, with at most one NIP-42 authentication exchange per connection and an exact retry of the same event if necessary. Maximum 64 destination attempts, at most 120s per connection (default 10s), no global deadline except caller cancellation. Protected events require author authentication before sending the event. No protected event is sent without successful AUTH ACK. If the relay never sends a challenge before a protected write, the operation times out rather than disclose the event. Gift wraps retain the signed kind-10050 inbox and allowlist rules; private delivery never widens to public defaults. Dedicated transport-auth kinds are not published as normal events.

The existing `publishRelay` accepts optional `authSigner`, `authPubkey`, `requireAuthentication` and `acceptEphemeral`. The signer is only asked for a bound challenge/relay template, checked against exact signed content, tags, timestamp and approved identity. The wrapper rejects cancellation, timeout, wrong signature/template or changed challenge; late signer completion cannot send anything on a closed connection. The underlying external signer may still present a pending approval. An AUTH exchange does not authorize arbitrary signing or publishing. Readback after an auth refusal uses a fresh subscription ID. Explicit stored-event ACK and exact signed readback are required for verified delivery. A negative duplicate OK is not treated as a positive ACK. For opted-in ephemeral delivery, a positive ACK yields `readback:false` / `accepted-ephemeral` only. An ACK without verified readback is reported separately as accepted-unverified by the executor; no durable success is implied. Existing ordinary unauthenticated stored-event calls retain the original verified receipt shape; protected and auth-token calls are intentionally stricter. Transport response bounds: 1024 text frames and 2 MiB aggregate UTF-8; host egress/DNS policy is still required. No raw relay text, signed AUTH token or signer secrets are returned in observations.

## Advisory evidence and local cache

`planRelayDelivery` now accepts `monitorEvents`, `monitorTTL` (default 3600 seconds), `observations` and `observationTTL` (default 3600 seconds). It validates signed kind-30166 reports, exactly one d tag, freshness, newest timestamp/lowest-ID per relay/monitor, and kind-specific positive/negative hints. Reports cannot expand the approved destinations, exclude a relay by themselves, or establish compatibility. Conflicts remain warnings. Known author-write/pinned preference is preserved; within preference groups, fresh previous readback and positive hints improve rank. Reports are capped at 256. The caller owns and trusts the local transport observation cache (up to 2048 rows), with validated fields, explicit configured AUTH identity scope or anonymous scope, per-event cooldown and short author/kind-specific unsupported-kind suppression. The scope is the configured signing capability, not a claim AUTH succeeded on every connection. Observations are local, untrusted as remote evidence, and may include private event/author identifiers; do not publish them. Persist the returned observations in existing caller storage if desired; no new database or global registry was introduced. Monitor discovery/automatic polling and cache persistence adapters remain separate. NIP-11 timestamp-bound policy semantics and richer monitor features are not added in this batch.

Eleven new offline regressions exercise actual BIP-340 signatures and modeled WebSocket exchanges: fallback, protected AUTH ordering, auth-required EVENT/readback, mismatched signer, cancellation, changed challenge, ephemeral ACK, signed monitoring, scoped cooldown and false readback. Live relays, physical signer, and existing-app adoption remain unverified. This is one reconciliation batch, not full donor coverage or release approval.
