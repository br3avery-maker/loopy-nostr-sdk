# Architecture and integration boundaries

## Components and dependency direction
`src/core` provides byte/hash/path/URL and configuration primitives. `vendor/nostr.js` supplies established cryptographic and NIP-46 primitives. `src/nostr` handles signed events, signer adapters, queries, profiles, history and receipt checks. `src/blossom` handles verified content transfer. `src/nsite` composes signed manifests and content retrieval/publication. `src/archive` and `src/storage` support content-addressed persistence and ZIP recovery. `src/directory`, `src/moderation`, `src/moji`, `src/anchor` and `src/intelligence` implement higher-level data and advisory operations. `src/adapters` integrates host callbacks. `src/index.js` exposes independent namespaces and an optional facade.

## Data flow and state
Caller configuration supplies explicit relays, signer and storage; verified signed event and exact content hash are data identity, not trust in document prose. Query → signature/filter check → revision/provenance selection → cache or advisory interpretation. Publication → immutable file/tag plan → user-approved signer → exact signed event → upload/hash readback and relay OK/exact-ID readback. Archive stores content by hash and verified revision; storage remains replaceable via its async contract. Transport failures/partial history and stale caches remain visible.

## Contracts and integration
See `types/index.d.ts`, `types/intelligence/`, `docs/API_REFERENCE.md` and `docs/API_INDEX.json`. Each namespace is independently importable; `createNsiteSDK` composes them. Injected transports and storage are trusted host capabilities, not proof of actual remote delivery. `Intelligence` is advisory; signed proposals are not executable or authoritative protocol rules. Runtime transport, UI/host and packaging remain separable. The public candidate retains API symbols; default moderation policy data is empty, and signer/IndexedDB timing now follows the documented contracts.

Keep domain logic reusable and host adapters separate when supported by the existing architecture. Do not create parallel services or move behavior merely to satisfy a diagram. Link decisions to PROJECT.md and actual source. No architecture document proves runtime behavior.
