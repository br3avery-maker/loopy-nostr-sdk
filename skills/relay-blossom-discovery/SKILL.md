---
name: relay-blossom-discovery
 description: Reuse signed NIP-65 relay-list and BUD-03 Blossom server discovery, endpoint roles, NIP-11 hints and verified transport fallbacks in existing Nostr apps.
---

# Route events and blobs using discovered user choices

Inputs: signed identity pubkey, bounded trusted bootstrap relays, optional user destination overrides. Outputs: `discoverRelays`/`discoverBlossom` results, validated destinations, per-endpoint diagnostics, independent readback receipts.

Read kind10002 lists with `Nostr.discoverRelays`. Author-write relays are for posts authored by the user; recipients' read relays are for mentions/replies as required; no marker means both. BUD-03 kind10063 yields Blossom **server URLs**, not event relays. Inspect NIP-11 with `relayInfo`; it is metadata only. Run `queryRelay`/`publishRelay` for actual verification. Keep signer transport relays separate from content publication relays.

Stop on invalid signatures, unavailable endpoints, ambiguous role, paid/auth-required restrictions without consent, or unverified write results. Do not promote a relay-directory listing to operational proof.
