# Interface requirements and acceptance

Read the current [AgentOps interface quality policy](https://github.com/br3avery-maker/AgentOps/blob/main/policies/interface-quality.md) before choosing an interface, framework, layout or theme. This file records project-specific decisions; the canonical policy and explicit owner-approved exceptions take precedence.

<!-- FILL:ui-scope | DISCOVER: actual source tree, product requirements and intended user-facing surfaces including examples, docs sites and plugin UI. | ACCEPT: exactly applicable or headless. Headless means no user-facing graphical interface in this project scope. -->
**Interface scope:** {{FILL:ui-scope}}

<!-- FILL:ui-scope-evidence | DISCOVER: current project requirements and actual source/entrypoints. | ACCEPT: concrete source path or requirement explaining applicable/headless; do not use bare N/A. -->
**Scope evidence:** {{FILL:ui-scope-evidence}}

## Required interface baseline

For applicable UI, content gets the space and chrome earns its space. Prefer flat content flows, avoid duplicate navigation, giant dialogs, unnecessary nested scrolling, fake controls and inaccessible actions. Use bottom navigation for broad domains, drawers/sidebars for apps and secondary controls, top tabs for pages in the active context, and fullscreen for immersive content with reliable exit/recovery. Add only layers the product needs. Preserve existing authorized design decisions.

For personal interfaces use the exact current [BreBre Colors token file](https://github.com/br3avery-maker/AgentOps/blob/main/policies/brebre-colors.json): black #000000, deep pink #FF1493, white, light pink, silver, neutral grays and the approved dark pink tokens. Zero purple, violet, plum, lavender, indigo or blue-tinted/slate gray in UI chrome, including defaults, SVGs, shadows and overlays. Project-specific owner-approved exceptions and original artwork/media are separate. Do not apply the palette to unrelated projects. Run the canonical [palette checker](https://github.com/br3avery-maker/AgentOps/blob/main/scripts/check_ui_palette.py) on actual UI source and inspect the rendered result; source scan alone is not a rendered pass.

Target WCAG 2.2 AA where applicable: reflow at 320 CSS px, 200% text enlargement, contrast, labels, keyboard focus, reading order, screen-reader semantics, reduced motion and pointer targets (24 CSS px minimum subject to WCAG exceptions; about 48 dp on Android as a platform recommendation). Test portrait/landscape, keyboard, safe areas, dialog dismissal, Back and return-state recovery. Show real loading/empty/error states; avoid repeating setup. For same-phone remote signing, follow the [existing pairing interaction](https://github.com/br3avery-maker/AgentOps/blob/main/integrations/nostr-work-access.md#preferred-same-phone-remote-signing-interaction), preserving the pending attempt across app switching.

## Project-specific design

<!-- FILL:ui-design | DISCOVER: owner-approved theme, actual navigation and interaction flows, existing design source and intended platform. | ACCEPT: source-backed design and exceptions, or explain why a headless project has no such surfaces. -->
{{FILL:ui-design}}

## Verification and evidence

<!-- FILL:ui-verification | DISCOVER: actual palette scan, rendered/browser/device checks and source revision, or headless scope evidence. | ACCEPT: observed checks with paths/results, unverified GAP references, or reasoned headless inapplicability. Never claim a test that was not run. -->
{{FILL:ui-verification}}

A headless SDK need not invent graphical UI tests. Its CLI, API, documentation and examples still need the applicable usability, accessibility and consumer checks; re-evaluate scope if graphical surfaces are added. The starter checker validates documentation structure, not UI compliance.
