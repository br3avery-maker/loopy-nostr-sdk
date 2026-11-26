# Development, tests and target runtime

## Runtime and dependencies
ESM JavaScript, declared Node >=20; local tests ran under Node 22.16.0 and TypeScript 5.8.3. Python 3 is used for source recovery and provenance validation. No declared npm runtime dependencies; bundled audited-in-source Nostr cryptography has its own upstream licenses. Browser Web Crypto/WebSocket, IndexedDB and Android host callbacks are required only by the corresponding adapters. Prefer Node 22 for verification.

## Build
From the SDK root, use `npm pack --ignore-scripts` to build the npm tarball. For TypeScript checks install a reviewed compiler (CI uses `typescript@5.6.3` with scripts disabled). `npm run verify` checks source, declarations and hashes. The initial public candidate is not yet published to npm; CI also performs a clean offline tarball install.

## Tests
Local rc.9 source checks: `npm run verify` passed 180 Node tests, TypeScript and 62 module pins/183 export checks; `python3 -m unittest discover -s tests -p 'test_*.py'` passed 15 recovery tests before the starter-document test suite was combined. The rc.10 review repair passed 185 Node tests, 15 SDK Python tests, TypeScript and the same module/export checks in the local recovered source. On the current working head (post-Batch 6 & Round 2 Big Jobs 1–6), local offline verification passes 304 Node tests, 35 Python tests, 89 module pins, 246 runtime API symbols across strict zero-`any` TypeScript declarations, `scripts/sync_docs.py --check`, `validation/verify_package.py`, `validation/verify_repo_audit.py` (13-layer acyclic DAG), and 6 offline runnable examples. Run both commands on the actual repository head; CI `tsc` and remote checks are recorded separately. Public-migration tests exercise deferred bunker initialization and IndexedDB completion/abort.

## Device and integration acceptance
Signed fixture and simulated relay/Blossom consumer tests are in `tests/consumer-revision-lifecycle.test.js`; actual predecessor rc.8 live read-only Open Specs retrieval passed. Current rc.10 physical Android/Amber, real IndexedDB browser storage, live Nostr publication and live Blossom upload remain unverified (see GAPS.md). Use real target-runtime evidence before claiming support.

For applicable graphical interfaces, follow [UI.md](UI.md) and record actual target runtime and rendered evidence. For headless projects, record API/CLI and independent consumer acceptance instead. See [ARCHITECTURE.md](ARCHITECTURE.md), [REUSE.md](REUSE.md) and [SECURITY.md](SECURITY.md) for boundaries and dependencies.
