---
name: amber-signer-handoff
 description: Integrate NIP-07, NIP-46 bunker approval or Android NIP-55 deep links with correctly verified signer callbacks, one-phone copy/paste pairing and no secret-key custody.
---

# Reuse working signer code in browser and Android

Inspect the host first (browser, WebView, APK, CI, Work shell). For NIP-07 use `Nostr.browserSigner(window.nostr)` if genuinely injected. For NIP-46 use `nostrConnectRequest`, start the listener, display one stable selectable/copyable URI, approve in the signer, return and confirm `getPublicKey`; allow user-provided bunker URI as secondary. For NIP-55 use `androidIntent` and `Adapters.androidHandoff({launch,onReturn})`. Android must return a correlated signed event, verified by `verifyAndroidResult`, before saying connected or published.

Credentials are sensitive. Never log, embed, upload or publish `nsec`, `nbunksec`, bunker transport secrets or client private keys. Use actual test-device evidence for app-switch and return behavior. Web2App preview launch, clipboard copy, public-key retrieval and successful signing are separate gates.
