# Unresolved evidence and next actions

| ID | Unresolved question | Evidence | Next useful action | State |
| --- | --- | --- | --- | --- |
| GAP-001 | Public source acceptance and independent review | rc.10 local source tests and module hashes; public source imported on PR #1; exact-head checks and review pending | Review exact public PR head, run CI and resolve substantive findings | open |
| GAP-002 | Npm package and rollback | No rc.10 registry release | Verify packed files, clean consumer install, digest and prior-version compatibility; separate release authorization | open |
| GAP-003 | Browser/Android signer and IndexedDB | Injected host and transaction fixtures; no physical phone acceptance | Test actual Amber handoff, state recovery, real browser transactions | open |
| GAP-004 | Current live relay/Blossom acceptance | Predecessor rc.8 read-only Open Specs pass; local rc.10 offline tests | Run bounded public read-only check on exact head; live writes require explicit authorization | open |
| GAP-005 | Upstream bundle provenance and attribution | Embedded MIT notices and original Unlicense preserved; exact component versions not established | Establish precise bundle build provenance where possible; investigate attribution reports | open |
| GAP-006 | IC and application adoption | Prior local IC Forge and headless consumers tested on earlier candidates | Pin exact public SDK in existing adapters and real consumers; do not claim global installation | open |

A missing external verification is not a green pass. All original private candidate archives remain untouched.

## Bidirectional source reconciliation (open)

The first relay delivery planning/receipt-summary implementation is in [comparison notes](docs/RELAY_DELIVERY_RECONCILIATION.md). Existing donor monitor/cache/cooldown, authenticated transport, fallback, Blossom preflight and publisher copy/MIME/gateway behavior remain open. Reconcile every relevant source family and test actual consumers; do not treat local regression success as complete coverage. Original specification-intelligence and signer-review tracks remain separate.
