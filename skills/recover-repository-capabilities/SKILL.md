---
name: recover-repository-capabilities
description: Audit related repositories for real missing code, merge reusable mechanisms into one tested SDK and preserve source provenance.
---
# Recover repository capabilities into Loopy

## When to use
Invoke when an app needs code already built across Anchor/Moji/HowAmI/Pretend Internet/etc, or when the user says the capability library is missing functionality. **Search broadly by functions and evidence, not by the name of the first broken app.**

## Required inputs
Actual existing SDK exports and tests; connected repo file search; owner-authored AgentOps policy; provenance and license decisions; source files and tests for candidate mechanisms.

## Procedure
1. List relevant repos. Read their AGENTS/README where relevant and search all owner-approved code domains by behavior. Inspect exact source, callers and tests.
2. Compare with current SDK module API index. `reuse`, `adapt`, `merge`, `keep separate`, `unresolved` or `reject`. Keep source paths/commit refs and bounds in `provenance/repo-capabilities.json`.
3. Extract the smallest independently useful portable mechanism. Preserve protocol semantics, versioning, native runtime constraints and licensing. Do not copy private user evidence or secrets to a public artifact.
4. Add executable code, TypeScript declarations, tests, upstream references and relevant docs in **the existing SDK**. Test success, denial, tampering, retry and offline scenarios as applicable.
5. Use `npm test && npm run test:types && python3 validation/verify_package.py && python3 validation/verify_repo_audit.py`. Distinguish local tests from live relay/device tests.
6. Version the package, build a clean installation consumer, rebuild the static docs, save recoverable ZIP/source to Library/Drive with SHA-256 readback. Never claim plugin/IC core installation or public release without evidence.

## Stop conditions
Unclear source licensing, a rejected project as proposed canonical implementation, missing actual source, or integration without meaningful independent tests. Preserve candidates as pending, not fake completed APIs.
