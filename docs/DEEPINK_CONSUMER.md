# Deepink end-to-end consumer recipe

This is a practical integration recipe for the existing Deepink app (not a replacement frontend).

1. **Preserve UI and sample data separately.** Keep existing components/navigation and move browser-only localStorage sample posts behind a clearly labeled demo adapter.
2. **Choose signer without new keys:** prefer approved `Nostr.browserSigner(window.nostr)` if present. On one phone, use client-initiated NIP46 via `nostrConnectRequest({relays:[signerTransportRelay]})`, listen before displaying **Copy connection**, and keep the pending secret/session stable across app switch. For an installed Android wrapper, use `Adapters.androidHandoff({launch,onReturn})` and `Nostr.androidIntent`; never call it authenticated until the returned signed event is verified with request ID and author.
3. **Find actual relays:** `Nostr.discoverRelays(pubkey,{bootstrap,query:Nostr.queryRelay})` loads signed NIP65 lists. Use author-write for publishing, recipient-read for notifications, and configured bounded fallbacks. Distinguish these from signer transport relays. Use `Nostr.relayInfo` to inspect NIP11 server policies but do not infer acceptance from metadata.
4. **Posts, replies, and reactions:** `Nostr.textNote`, `Nostr.reaction`, `Nostr.publishTemplate`, `Nostr.fetchFeed`; kind1 and kind7 events, signed by the user's current identity, exact-ID relay readback, dedupe by event ID.
5. **Profiles:** `Nostr.fetchProfiles({pubkeys,relays})` verifies kind0 and keeps bounded display data. Account-switch cleanup must close subscriptions and prevent old-account state from leaking into the new profile.
6. **Media:** `Nostr.discoverBlossom(pubkey)` on signed kind10063; `Blossom.uploadVerified` uses a signed kind24242 token, checks upload descriptor, downloads by hash, compares exact bytes. Only then put media URL in published note.
7. **Nsites:** `Nsite.prepareManifestFiles`, `manifestTemplate`, `publishNsite` for static site publication; do not use a fake wallet or fake zap as a success condition.
8. **Local-first archive:** `Archive.contentStore(Storage.indexedDbStore())`, `Archive.writeZip`, `Archive.materializeVersion` preserve original bytes, save hash-linked snapshots, and avoid duplicate blob storage. `Directory` supports collection, clone stacks, filtering and public backup.

**Independent acceptance:** browser login and actual signer approval; publish kind1, reload and retrieve signed note from a relay; second identity replies and reacts; switch accounts without stale content; upload one Blossom image, verify exact GET bytes; distinguish authorized live publication from mock transport tests. Devices/browser/runtime require separate evidence receipts. Source signatures can be checked offline; actual Amber popup is not proven here.

See public module provenance and the source comparison documents for donor acknowledgments.
