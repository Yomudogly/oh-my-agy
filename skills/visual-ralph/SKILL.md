---
name: visual-ralph
description: "[oh-my-agy] Measured frontend implementation against an approved visual reference (generated mockup, static image, or live URL) via $ultragoal with a vision verdict before every edit and pixel-diff evidence, or repo-local DESIGN.md design-system authoring and refresh (--design) as the durable source of truth for UI, UX, typography, color tokens, and layout rules. Use when a UI must be built or restyled to match a visual target, when cloning a URL, or when creating or refreshing DESIGN.md before frontend implementation."
---

# Visual Ralph & Design System Skill

Use `$visual-ralph` for measured frontend implementation from an approved generated reference, static image, or live-URL baseline, and `$visual-ralph --design` to create, refresh, or audit the repository's durable `DESIGN.md` design-system contract.

- **Visual-reference implementation (default `$visual-ralph`)**: `description / URL -> approved reference -> $ultragoal implementation -> Visual Ralph verdict + pixel diff -> reusable design system` (including migrated `$web-clone` URL cloning).
- **Design-system governance (`$visual-ralph --design`)**: author, extract from a live URL, audit/lint (`validate-design-md`), or sync (`StitchMCP`) repository-root `DESIGN.md` in the Google Stitch Two-Layer format (YAML frontmatter `colors`/`typography`/`spacing`/`shapes` + 8 canonical `## ` sections: `Overview`, `Colors`, `Typography`, `Layout`, `Elevation & Depth`, `Shapes`, `Components`, `Do's and Don'ts` with `{category.subpath}` token references). See [design-system-stitch.md](./references/design-system-stitch.md).

Shared operating, delegation, state, and verification invariants live in the oh-my-agy rules (`rules/AGENTS.md`).

## Use when

- The user wants a web/app UI built or restyled against a visual target or live URL.
- Product, UX, typography, color tokens, or frontend decisions need a repo-local `DESIGN.md` source of truth (`--design`).
- The result must leave reusable repo-native tokens/components, not just a matching screenshot.

Do not use it for non-visual backend work, comparison-only fixes that can be done directly, deterministic SVG/code-native assets, or throwaway layout-fork exploration (use `$loft`).

## Design-System Governance (`$visual-ralph --design`)

When invoked with `--design` (or before visual implementation when a design system contract is requested), load [design-system-stitch.md](./references/design-system-stitch.md) and execute the matching workflow:

1. **[Guided Discovery & 5 Starter Presets](./references/design-system-stitch.md#workflow-1-guided-discovery-and-starter-presets)**: inspect existing `DESIGN.md`, routes/components, and theme tokens first; offer fast-track selection from the **5 AA-compliant canonical presets** (`modern-saas-indigo`, `minimal-dark-developer`, `high-density-fintech`, `editorial-warm-luxury`, `neo-brutalist-vibrant`) or ask progressive 1–2 question sets only for unresolved brand/UX gaps.
2. **[Live Website Token Extraction](./references/design-system-stitch.md#workflow-2-live-website-token-extraction)**: verify `robots.txt` / `llms.txt` hygiene first (never follow off-site links from `llms.txt`, and `robots.txt` disallow rules always win), run the in-browser `window.getComputedStyle` JavaScript harvester via `playwright` or `chrome-devtools` MCP, and normalize harvested tokens into 3-level Stitch YAML categories.
3. **Author or refresh Two-Layer `DESIGN.md` with OMA Craft Floor (`A12`–`F9`)**:
   - **Stitch Two-Layer Structure**: YAML frontmatter (`colors`, `typography`, `spacing`, `shapes`, optional `elevation`) followed by all 8 canonical `## ` sections (`Overview`, `Colors`, `Typography`, `Layout`, `Elevation & Depth`, `Shapes`, `Components`, `Do's and Don'ts`) referencing tokens via `{category.subpath}`.
   - **Brief & Layout Contract (`A12`, `B7`)**: one primary action per screen (peers differ by style, never size); priorities 1–3 in reading order; explicit **Left out on purpose** exclusions and **Required content** list (`B7`); lightest native/house component before cards; mandatory `Layout: <screen or region> - <spatial problem> -> <pattern name> (<reference>); scroll owner: <CSS selector>; anti-patterns: <what to avoid>` (`A12`) plus `320px` overflow-free reflow.
   - **Craft Floor & Anti-Slop Guard (`A13`, `B8`, `E7`, `F8`, `F9`)**: heading steps `>=1.25x`, top space `>=1.5x` bottom, inter-group gap `>=2x` intra-group, desktop measure `65-75ch` (`>=45ch` mobile), display `<=6rem`, tracking `>=-0.04em`; explicit semantic pairs (`primaryForeground`/`secondaryForeground`, `E7`); themed `color-scheme`, `::selection`, `caret-color`, scrollbars, `:focus-visible`, and `tabular-nums` (`F8`); mandatory **loading / empty / error** state triad and zero AI-slop scaffolds (`F9`: no one-side accent stripes, `>=2px` card accent outlines, decorative state-free badges, fake vanity KPI stats, emoji icons, kickers above headings, stacked 3-card icon grids, or card-in-card wrappers).
4. **[Deterministic Audit & Linting](./references/design-system-stitch.md#workflow-3-deterministic-audit-and-linting)**: run `sh <plugin>/hooks/run.sh validate-design-md DESIGN.md --json` (or `--strict` for `7.0:1` WCAG AAA) and resolve any missing sections, broken `{category.subpath}` references, or semantic contrast failures until exit code `0`.
5. **[Optional Google Stitch MCP Sync](./references/design-system-stitch.md#workflow-4-google-stitch-mcp-sync)**: when syncing to an active Google Stitch project via `StitchMCP`, run the Base64 `upload_design_md` + `create_design_system_from_design_md` (`deviceType: "AGNOSTIC"`) flow or direct `create_design_system` / `update_design_system` / `apply_design_system` token mapping. Keep `DESIGN.md` governance distinct from visual-verdict implementation handoffs.

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
