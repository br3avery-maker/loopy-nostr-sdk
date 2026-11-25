# Project definition

## Requested outcome
Build a reusable, local-first Nostr SDK from existing project implementations and independent cross-donor comparison, rather than reimplementing the same transport and publishing code in each application. The owner's November 25, 2026 decision creates this public repository for the SDK and offers original owner-controlled code under MIT.

## Current scope
The complete source candidate 1.1.1-rc.9: ESM runtime and TypeScript declarations, Nostr identity/signing/transport/history, Nsite publication and retrieval, Blossom, archive/CAS/ZIP, directory, storage, moderation, Moji, Anchor and Open Specs intelligence; source tools, examples, skill/workflow recipes, tests and public provenance. Preserve the existing npm name and API exports.

## Non-goals and constraints
No public npm release, Nostr write, private donor archive distribution, account-bound data or global IC installation in this migration. Keep signing and external writes explicit. Consumer UI and Android runtime integration remain separate. No personal moderation defaults in public distribution; consumers provide policy arrays. Preserve third-party licenses and attribution.

## Canonical source and history
This repository is the public SDK source home. `package.json` identifies 1.1.1-rc.9; `provenance/manifest.json` pins 62 runtime/vendor module paths, and `docs/API_INDEX.json` lists 183 exports. Earlier 1.1.0 and rc.1–rc.8 candidates are preserved separately; source lineage and review repairs are described in `CHANGELOG.md` and `docs/`. Historical private recovery archives are not shipped.

## Decision log
Record decisions with date, decision-maker, alternatives, why, and impact. Do not treat an unapproved proposal as accepted.

- 2026-11-25 — Owner: create public Loopy Nostr SDK; MIT for original code, retain upstream terms, disclose AI assistance and welcome attribution corrections. Migration decision: retain existing npm name; preserve original private candidates rather than copying personal datasets into public source.
