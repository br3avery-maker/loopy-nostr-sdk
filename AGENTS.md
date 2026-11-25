# Repository working instructions — fill on discovery

Read this file, the local README and PROJECT.md, then the current `br3avery-maker/AgentOps/AGENTS.md` and applicable policies. Existing source and the owner's latest corrections outrank template examples. Discover -> inspect -> reuse -> adapt -> implement -> test -> verify -> preserve evidence.

## When you encounter an unfinished section

A `{{FILL:id}}` token, matching `<!-- FILL:id | DISCOVER: ... | ACCEPT: ... -->` comment, empty required file, ungrounded claim, or unimplemented public API is a **work cue**, not permission to hallucinate an answer.

1. Read `DISCOVER`, inspect the actual named source (and open/closed issues or prior work), and identify the canonical owner/revision. Use current source, not a stale memory or a guessed file name.
2. Fill with a **specific, evidence-backed value** and a path/link to the proof. Delete both the token and its `FILL` annotation only after verification. For instructions that genuinely do not apply, explain *why* rather than pretending they were completed.
3. If evidence is absent, preserve the marker, add a `GAP-###` entry in GAPS.md with exact missing source/decision, confidence, and next action; do not replace the blank with generic boilerplate, a fake command, or green status.
4. Correct mismatches in the file that **owns** the fact (requirements, API, tests, release). Never quietly rewrite the owner's request to satisfy a check. Do not auto-implement unrelated features merely because a placeholder exists.
5. Run `python3 scripts/check_starter.py --mode template .` during drafting. Run `--mode ready` before declaring this repository ready for handoff/release; unresolved mandatory markers block readiness. No script verifies real application behavior.
6. Save exact changed paths, tests actually run, artifact identities, unresolved blockers, and one next action in GAPS.md or the owning issue/PR. A PR, successful script, and public release are distinct states.

## Required project standards

Read [ARCHITECTURE.md](ARCHITECTURE.md), [REUSE.md](REUSE.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md) for their respective work. For any authorized interface work, read [UI.md](UI.md) and the current [AgentOps interface policy](https://github.com/br3avery-maker/AgentOps/blob/main/policies/interface-quality.md) **before** design or implementation. Personal interface chrome uses the exact [BreBre Colors](https://github.com/br3avery-maker/AgentOps/blob/main/policies/brebre-colors.json) and zero-purple rule unless the owner explicitly approves a project-specific exception. Check source palette and rendered behavior; preserve accessibility, content-first navigation and recovery. For a genuinely headless SDK, record the scope evidence and reasoned inapplicability rather than inventing UI tests.

## Authority and safety

Discussion/inspection is not blanket implementation authority. No new repository, signer secret, schedule, Nostr event, APK publication, public deployment, deletion, or permission change without the relevant explicit authorization; an owner may separately authorize using this template for new repositories. Do not export sensitive source material into a public issue. Keep this AGENTS.md short; project-specific details belong in PROJECT.md.
