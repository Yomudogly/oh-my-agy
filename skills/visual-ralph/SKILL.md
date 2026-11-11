---
name: visual-ralph
description: "[oh-my-agy] Measured frontend implementation against an approved visual reference (generated mockup, static image, or live URL) via $ultragoal with a vision verdict before every edit and pixel-diff evidence, or repo-local DESIGN.md design-system authoring and refresh (--design) as the durable source of truth for UI, UX, typography, color tokens, and layout rules. Use when a UI must be built or restyled to match a visual target, when cloning a URL, or when creating or refreshing DESIGN.md before frontend implementation."
---

# Visual Ralph & Design System Skill

Use `$visual-ralph` for measured frontend implementation from an approved generated reference, static image, or live-URL baseline, and `$visual-ralph --design` to create, refresh, or audit the repository's durable `DESIGN.md` design-system contract.

- **Visual-reference implementation (default `$visual-ralph`)**: `description / URL -> approved reference -> $ultragoal implementation -> Visual Ralph verdict + pixel diff -> reusable design system` (including migrated `$web-clone` URL cloning).
- **Design-system governance (`$visual-ralph --design`)**: discover product/UI evidence, close missing UX/token context gaps, and create or refresh root `DESIGN.md` (`Source of truth`, `Brand`, `Product goals`, `Personas and jobs`, `Information architecture`, `Design principles`, `Visual language`, `Components`, `Accessibility`, `Responsive behavior`, `Interaction states`, `Content voice`, `Implementation constraints`, `Open questions`).

Shared operating, delegation, state, and verification invariants live in the oh-my-agy rules (`rules/AGENTS.md`).

## Use when

- The user wants a web/app UI built or restyled against a visual target or live URL.
- Product, UX, typography, color tokens, or frontend decisions need a repo-local `DESIGN.md` source of truth (`--design`).
- The result must leave reusable repo-native tokens/components, not just a matching screenshot.

Do not use it for non-visual backend work, comparison-only fixes that can be done directly, deterministic SVG/code-native assets, or throwaway layout-fork exploration (use `$loft`).

## Design-System Governance (`$visual-ralph --design`)

When invoked with `--design` (or before visual implementation when a design brief is requested):
1. **Discover local evidence**: inspect existing `DESIGN.md`, frontend routes/components/stories, theme/token files, screenshots, and accessibility/responsive constraints. Separate observations from inferences.
2. **Interview only missing context**: ask concise questions only for gaps the repository cannot resolve (users/jobs, brand personality and forbidden aesthetics, primary flows, accessibility/device targets). Record explicit assumptions and `[ ]` open questions rather than blocking when answers are unavailable.
3. **Author or refresh `DESIGN.md`**:
   - Enforce per-screen **Brief & Layout Contract**: one primary action per screen (peers differ by style, never size); priorities 1–3 in reading order; explicit **Left out on purpose** exclusions; **Required content** listed by name (`B7`); lightest native/house component before cards; and mandatory `Layout: <screen or region> - <spatial problem> -> <pattern name> (<reference>); scroll owner: <CSS selector>; anti-patterns: <what to avoid>` (`A12`).
   - Enforce **Draft Guard & Craft Floor** (`A13`, `B8`, `E7`, `F8`, `F9`): heading steps `>=1.25x`, top space `>=1.5x` bottom, inter-group gap `>=2x` intra-group, desktop measure `65-75ch` (`>=45ch` mobile), display `<=6rem`, tracking `>=-0.04em`; themed `::selection`, `caret-color`, scrollbars, `:focus-visible`, and `tabular-nums` (`F8`); tinted secondary text on coloured surfaces (`E7`); no one-side accent stripes, `>=2px` card accent outlines, decorative state-free badges, vanity marketing stats, emoji icons, kickers above headings, stacked icon-tile card grids, or card-in-card scaffolds (`F9`).
   - **External design reference hygiene**: fetch only published agent surfaces (`llms.txt`, `llms-full.txt`, same-origin pages linked from that site's `llms.txt`, registry JSON, or `.md` docs); never follow off-site links from `llms.txt`, and `robots.txt` disallow rules always take precedence.
   - Validate `DESIGN.md` when `validate-design-md` is used, and keep `DESIGN.md` governance distinct from visual-verdict implementation handoffs.

## Workflow

### 1. Ground the repository
Inspect the package manager/scripts, frontend framework and routes, styling/token conventions, screenshot tooling, and reusable components. Choose stack-specific commands only when the repository supports them.

### 2. Establish a reference
- **Live URL**: capture a baseline with the browser tooling available in this session (Playwright MCP, Chrome DevTools MCP, or the `/browser` workflow). Record an artifact containing: source URL and permission/scope, viewport(s), route/state, seed/login assumptions, baseline screenshot path or capture command, visible-control parity notes, and exclusions (backend/API/auth, personalized data, crawling, third-party widgets).
- **Generated concept**: use Antigravity's `generate_image` tool (16:9 or the target aspect ratio). The prompt specifies: UI mockup, viewport, surface, layout hierarchy, typography, color mood, exact text, no logos/watermarks/unrequested marks, and readable, feasible UI details. Generate only the interface, without device frames.
- **Static image**: use the file the user supplied.

Copy the approved reference to `.omagy/artifacts/visual-ralph/<slug>/reference.png`. Do not leave it only in the artifact directory.

### 3. Approval gate
Stop after generation or capture and get approval of one reference image/state (or a targeted regeneration/capture adjustment). Show it to the user, then use `ask_question` (`Approve this reference` / `Regenerate with changes` / `Use a different source`). Before approval, do not implement or start `$ultragoal`. After approval, the reference is the visual source of truth. Major pivots require an explicit user request.

### 4. Hand off to `$ultragoal`
Pass the approved reference, URL and permission note when applicable, viewport/content state, interaction parity and exclusions, the user's description, detected frontend context, screenshot command/viewport, and the completion checklist (template below). The Ultragoal execution lane edits, runs, captures, and iterates until matched or blocked.

### 5. Verdict before every edit & bounded QA loop
For each iteration:
- **Pre-edit Before/After baseline**: when restyling an existing screen, capture fixed before-edit screenshots across target viewports/states first so each round compares before vs after side-by-side.
- **Scroll-owner (`A12`), Brief/Subtraction (`B7`), Craft Floor (`A13`, `B8`, `E7`, `F8`, `F9`) & 320px Reflow check**: verify in the DOM that (1) the actual main scrolling element matches `scroll owner: <selector>` in `DESIGN.md` (`A12`), (2) every item in **Required content** remains intact and unmerged after subtraction (`B7`), (3) computed styles satisfy the Craft Floor (`A13` heading top space `>=1.5x` bottom and inter-group gap `>=2x` intra-group; `B8` heading steps `>=1.25x`, display `<=6rem`, tracking `>=-0.04em`; `E7` tinted secondary text on coloured surfaces and y-offset shadows; `F8` themed `::selection`, `caret-color`, scrollbars, `:focus-visible`, and `tabular-nums`; `F9` no generated scaffolds such as kickers over headings, stacked icon tiles in equal card grids, card-in-card, or one-side accent stripes), and (4) at `320px` width (`WCAG 1.4.10/1.4.12` reflow) primary content does not overflow horizontally or clip.
- Capture the current screenshot with the same viewport/state, then run a Visual Ralph verdict by invoking the `vision` subagent with both images (reference and current). Treat its JSON as authoritative:
```json
{"score": 0, "verdict": "match|close|mismatch", "category_match": true, "differences": [], "suggestions": [], "reasoning": ""}
```
- **Bounded 2–3 round stop rule**: layout, function, accessibility, reflow (`320px`), scroll-owner (`A12`), missing-content (`B7`), and Craft Floor (`A13`, `B8`, `E7`, `F8`, `F9`) defects earn another fix round (scoped to the affected region). Once `score >= 90` or after 2–3 rounds where only subjective taste notes remain, record the taste notes and stop iterating.

### 6. Secondary diff evidence
Use a pixel diff (e.g. `pixelmatch`/ImageMagick `compare`, when available in the repo or system) only to locate hotspots and turn them into edits. It never replaces the verdict. Record the final reference, current screenshot (`current.png`), verdict JSON (`verdict.json`), and diff artifacts under `.omagy/artifacts/visual-ralph/<slug>/`, and surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` once so the user can inspect the interactive reference vs. current overlay slider in the `Visual Ralph` tab of the Auxiliary Pane.

### 7. Reusable design system
Encode the match in existing repo-native CSS variables, theme tokens, config, component variants, stories, or `DESIGN.md` updates. Capture colors, spacing, typography/weights, radii, shadows/elevation, and important variants/states. Extend existing patterns rather than adding a parallel layer.

## Completion evidence and stop conditions

Do not declare done until: the approved reference and the reproduction command (viewport, route, state, output path) are saved; the final verdict is `>= 90`; secondary diff evidence is recorded; reusable tokens/components exist; the repo's build/lint/test verification passes; no unapproved pivot occurred; and remaining differences are documented. Stop at the approval gate, or report a concrete blocker when evidence cannot satisfy these conditions.

## Handoff template

```text
$ultragoal "Implement the approved frontend reference.
Reference: .omagy/artifacts/visual-ralph/<slug>/reference.png
Source URL and permission/scope: <when applicable>
Viewport/content state: <viewport, route/state, seed/login assumptions>
Interaction parity and exclusions: <visible controls and known limits>
Route/surface: <route or component>
Screenshot command: <command and viewport>
Run the Visual Ralph verdict (vision subagent) before every next edit; pass threshold >= 90.
Use pixel diff only as secondary evidence.
Extract reusable tokens/components for colors, spacing, typography, radii, shadows, and variants.
Run the repository's equivalent verification before completion.
Do not make major design pivots unless explicitly requested."
```
