# Interface requirements and acceptance

Read the current [AgentOps interface quality policy](https://github.com/br3avery-maker/AgentOps/blob/main/policies/interface-quality.md) before choosing an interface, framework, layout or theme. This file records project-specific decisions; the canonical policy and explicit owner-approved exceptions take precedence.

**Interface scope:** headless

**Scope evidence:** The repository contains an ESM library (`src/index.js`), API declarations, CLI recovery scripts, documentation and examples, not a graphical application or theme. `src/adapters` exposes host interaction contracts without supplying rendered chrome.

## Required interface baseline

For applicable UI, content gets the space and chrome earns its space. Prefer flat content flows, avoid duplicate navigation, giant dialogs, unnecessary nested scrolling, fake controls and inaccessible actions. Use bottom navigation for broad domains, drawers/sidebars for apps and secondary controls, top tabs for pages in the active context, and fullscreen for immersive content with reliable exit/recovery. Add only layers the product needs. Preserve existing authorized design decisions.

For personal interfaces use the exact current [BreBre Colors token file](https://github.com/br3avery-maker/AgentOps/blob/main/policies/brebre-colors.json): black #000000, deep pink #FF1493, white, light pink, silver, neutral grays and the approved dark pink tokens. Zero purple, violet, plum, lavender, indigo or blue-tinted/slate gray in UI chrome, including defaults, SVGs, shadows and overlays. Project-specific owner-approved exceptions and original artwork/media are separate. Do not apply the palette to unrelated projects. Run the canonical [palette checker](https://github.com/br3avery-maker/AgentOps/blob/main/scripts/check_ui_palette.py) on actual UI source and inspect the rendered result; source scan alone is not a rendered pass.

Target WCAG 2.2 AA where applicable: reflow at 320 CSS px, 200% text enlargement, contrast, labels, keyboard focus, reading order, screen-reader semantics, reduced motion and pointer targets (24 CSS px minimum subject to WCAG exceptions; about 48 dp on Android as a platform recommendation). Test portrait/landscape, keyboard, safe areas, dialog dismissal, Back and return-state recovery. Show real loading/empty/error states; avoid repeating setup. For same-phone remote signing, follow the [existing pairing interaction](https://github.com/br3avery-maker/AgentOps/blob/main/integrations/nostr-work-access.md#preferred-same-phone-remote-signing-interaction), preserving the pending attempt across app switching.

## Project-specific design

No graphical layout or palette applies to this SDK. Consuming applications own their navigation, accessible controls, signer handoff and state recovery. The documented Android/browser adapters must not be confused with an installed or rendered UI.

## Verification and evidence

No graphical source or device screenshot test is claimed. API and CLI acceptance is covered by source/consumer tests; target browser and Android integration are outstanding in GAPS.md. Re-evaluate UI scope if a graphical demo or application is added.

A headless SDK need not invent graphical UI tests. Its CLI, API, documentation and examples still need the applicable usability, accessibility and consumer checks; re-evaluate scope if graphical surfaces are added. The starter checker validates documentation structure, not UI compliance.
