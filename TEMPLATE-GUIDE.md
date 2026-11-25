# Reusable repository starter — GitHub template

This is the source of the existing private GitHub starter template; GitHub's template setting is separate and was verified enabled on November 25, 2026. It is not an installed agent. It is stack-neutral; do not import a whole Nostr UI framework into an SDK by default.

## Reused conventions

- AgentOps `AGENTS.md`, policies `authority.md`, `verification.md`, `collaboration.md`, `project-selection.md` and `merge-readiness.md` define operating authority, truth levels, re-entry and review. Link to the current policies rather than freeze copies into every repo.
- AgentOps #30 already tracks cold-import/readiness. AgentOps #22 / draft PR #23 already own portable handoff and worktree procedures. This kit does **not** replace those.
- The existing `gpt-plugins` MKStack scaffold proves reusable source copy and local tests; its app-specific React/Nostr implementation is not copied here.
- Pretend Internet's `templates/mini-app` already supplies app-specific examples and validations. A generic SDK template should not masquerade as one.

## GitHub-native use

The canonical home is a **private GitHub repository** with **Settings → General → Template repository** enabled. The template must contain these files at its **repository root**, not inside `AgentOps/templates/`. The AgentOps subfolder is only a reviewed staging/source copy until the private template exists.

GitHub `Use this template` creates a new repository; `.github/ISSUE_TEMPLATE` and `.github/PULL_REQUEST_TEMPLATE.md` become native forms and templates. GitHub Actions validates template annotations for a repository marked `is_template`; on derived non-template repositories it also requires filled-in documentation. A green template check is not a release qualification. If the GitHub event does not expose `is_template`, the strict check fails closed rather than pretending a project is ready.

Never turn the existing AgentOps repository into a template or accidentally make private code public. Creating a new private template and enabling its template setting are distinct operations, to be verified by GitHub readback. A derived project requires separate owner authorization; this template does not create it automatically.

## Use before creating a repository

1. Copy the contents to a **new empty local directory** (never overwrite an existing checkout). Do not make the GitHub repo until the user actually wants it.
2. Run `python3 scripts/check_starter.py --mode template .` to confirm every unresolved token has an instructional annotation.
3. Inspect existing source; fill `{{FILL:...}}` fields from observed evidence; record unfillable gaps.
4. Run `python3 scripts/check_starter.py --mode ready .` before claiming the repository is ready. Its nonzero result identifies every unfinished field; it does not authorize fabrication to make it green.
5. Run applicable *real* source and consumer tests. Only then consider initializing a repository or proposing an SDK migration. No file should be promoted merely because the template checker passed.

## Project standards

The root includes UI, architecture, reuse, security and change history documents, linked from README and AGENTS.md. Fill their discovery markers from actual project evidence. The UI scope must be explicitly `applicable` or `headless`, with a reason backed by source/requirements. Headless projects do not need graphical UI tests; fill design and verification with the applicable boundaries, not bare N/A. Projects with graphical interfaces must follow the current AgentOps policy, including the personal palette where applicable, accessibility, device and interaction evidence. No checker result certifies actual UI behavior.

## What the checker means

- **template mode:** structure and every token's attached discovery/acceptance instructions are present. Outstanding fields are **expected** and listed as informational.
- **ready mode:** blocks any unresolved `FILL` token/annotation, missing/empty required file, and common bogus filler (`TBD`, `TODO`, `lorem ipsum`, `coming soon`) in key project documents.
- Neither mode tests APIs, security, Android interoperability, Nostr relays or live deployments.
