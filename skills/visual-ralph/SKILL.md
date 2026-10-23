---
name: visual-ralph
description: "[oh-my-agy] Measured frontend implementation against an approved visual reference (generated mockup, static image, or live URL) via $ultragoal, with a vision verdict before every edit, pixel-diff evidence, and a reusable design system. Use when a UI must be built or restyled to match a visual target, including URL cloning."
---

# Visual Ralph Skill

Use `$visual-ralph` for measured frontend implementation from an approved generated reference, static image, or live-URL baseline. The loop is:

`description / URL -> approved reference -> $ultragoal implementation -> Visual Ralph verdict + pixel diff -> reusable design system`.

For URL cloning, this skill owns the migrated `$web-clone` use case. Record the URL, viewport, fidelity, and interaction notes here.

Shared operating, delegation, state, and verification invariants live in the oh-my-agy rules (`rules/AGENTS.md`).

## Use when

- The user wants a web/app UI built or restyled against a visual target.
- A live URL or generated mockup needs measured implementation and pixel-level iteration.
- The result must leave reusable repo-native tokens/components, not just a matching screenshot.

Do not use it for a durable `DESIGN.md` brief (`$design`), non-visual backend work, comparison-only fixes that can be done directly, or deterministic SVG/code-native assets.

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

### 5. Verdict before every edit
For each iteration: capture the current screenshot with the same viewport/state, then run a Visual Ralph verdict by invoking the `vision` subagent with both images (reference and current). Treat its JSON as authoritative:
```json
{"score": 0, "verdict": "match|close|mismatch", "category_match": true, "differences": [], "suggestions": [], "reasoning": ""}
```
If `score < 90`, turn `differences[]` and `suggestions[]` into the next edit plan, then edit and re-verdict.

### 6. Secondary diff evidence
Use a pixel diff (e.g. `pixelmatch`/ImageMagick `compare`, when available in the repo or system) only to locate hotspots and turn them into edits. It never replaces the verdict. Record the final reference, screenshot, and diff artifacts under `.omagy/artifacts/visual-ralph/<slug>/`.

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
