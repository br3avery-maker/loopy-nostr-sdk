---
name: build-nostr-client
description: Upgrade an existing simulated Nostr/social app such as Deepink to real signed posts, profiles, replies, reactions, relays and Blossom using the Nsite Loopy SDK.
---

# Retrofit an existing Nostr client

Read `docs/DEEPINK_CONSUMER.md` and the existing app first; don't replace the app or redesign its UI. Inputs: source app, approved signer host, publication/reading relays, optional Blossom destination. Outputs: app code with real APIs and explicit failure states, tests, and verified receipts.

Use `Nostr.browserSigner` for NIP-07; `nostrConnectRequest`/`bunkerSigner` for NIP-46; `Adapters.androidHandoff` with a real host callback for NIP-55. A public key or a launched Amber screen is watch-only/partial until approved signing is verified. Use `discoverRelays` from signed kind10002, `discoverBlossom` from signed kind10063, `textNote`, `reaction`, `publishTemplate`, `fetchFeed`, `fetchProfiles`, and `Blossom.uploadVerified`. Use `Directory` and `Archive` for local-first curation and caching.

Gate: real signed kind1 relay readback, reload and retrieval, account switch, second-account reply/reaction, one verified Blossom media upload. Document browser, WebView and Android device results separately. Do not invent zaps or label fake data live.
