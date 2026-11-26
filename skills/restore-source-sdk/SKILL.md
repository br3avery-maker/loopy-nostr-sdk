---
name: restore-source-sdk
description: Recover nsite ZIP/HTML code into the actual Nsite Loopy Unified SDK, with deterministic source pins, reusable APIs, evidence and consumer tests.
---

# Recover and standardize nsite source

Trigger: user requests reusable nsite code/libraries, not an archive report. Locate the existing SDK and original source ZIPs first. Read AgentOps and the `docs/WORKFLOWS.md` contract.

Inputs: authorized source ZIP/HTML files, a specific missing capability or batch import request, and the existing Code Quarry/IC Loopy database if available. Outputs: changed `src/<domain>` module, typed `types/index.d.ts`, API index, tests, source lineage and restore receipts.

1. `python3 scripts/nsite_source_audit.py scan SOURCES --out provenance/source-index.json` (discovery only). For complete reversible source code archive use `python3 scripts/source_collection.py export --input SOURCE_FOLDER --out Full-Source-Collection.zip`.
2. Check the existing `docs/API_INDEX.json` for an equivalent implementation. Use the existing IC Workshop + Loopy/Embeddy semantic index and Code Quarry to find donor behavior; never mistake semantic similarity for a working API.
3. Extract source with exact `SHA-256`, project lineage, dependencies, license and failure modes. Convert into a standard module using a common signer, transport, storage or file-map interface. Avoid a new mock service or a duplicate alternative SDK.
4. Add a real test and one failure-path test. Run `npm run verify`, typecheck independently, and update `provenance/manifest.json`; all claimed runtime imports must resolve without app-only globals.
5. Consumer test the module outside the donor app. For signer/network/device code, label host-specific checks pending until actually executed. Repackage and hash exports; preserve originals. Public redistribution of raw donor material requires separate review.

Stop: source license unclear for proposed public publication, missing exact source bytes, signer approval absent, test fails, or only interface/mock evidence. Never produce a completion claim on indexing alone.
