---
name: design
description: "[oh-my-agy] Create or refresh the repo-local DESIGN.md as the source of truth for product, UI/UX, and frontend decisions. Use when product/UX/frontend decisions need a durable design brief before implementation."
---

# Design Skill

Use `$design` to discover product and UI evidence, close only design-critical context gaps, and create or refresh the repository’s durable `DESIGN.md` contract. It is a maintained design brief, not a pixel-matching loop or one-off critique.

Shared operating, delegation, state, and verification invariants live in the oh-my-agy rules (`rules/AGENTS.md`).

## Use when

- Product, UX, frontend, or design-system decisions need a repo-local source of truth.
- A feature needs a design brief before a designer lane or implementation.
- Existing UI, assets, screenshots, or constraints need an actionable design summary.

Do not use it for visual-reference implementation matching (use `$visual-ralph`), screenshot comparison alone, or backend/infrastructure work without user-facing design impact.

## Relationship to `$visual-ralph`

`$design` owns product goals, users, information architecture, visual language, components, accessibility, constraints, and open questions in `DESIGN.md`. `$visual-ralph` owns implementation against an approved visual reference or live-URL baseline, measured verdicts, and pixel-diff evidence. Run `$design` first when both are needed; `DESIGN.md` supports but does not replace the visual verdict target.

## Workflow

### 1. Discover local evidence

Inspect and cite existing `DESIGN.md`, design/UX/frontend docs, README/specs/issues, routes/pages/layouts/components/stories, theme and token files, assets, screenshots/mockups, Storybook or Playwright baselines, and accessibility/responsive/i18n/platform constraints. Separate observations from inferences; note absent evidence.

### 2. Interview only missing context

Ask concise questions only for gaps the repository cannot resolve: users/jobs, goals/non-goals, brand personality and forbidden aesthetics, primary flows, accessibility/device/browser targets, or unavailable assets/references. If answers are unavailable, record explicit assumptions and open questions rather than blocking.

### 3. Create or refresh `DESIGN.md`

Preserve useful content, remove contradictions, mark unknowns, and keep decisions actionable. The root file must contain these sections:

# Design
## Source of truth
Status (Draft | Active | Needs refresh), date, product surfaces, evidence reviewed.
## Brand
Personality, trust signals, avoid.
## Product goals
Goals, non-goals, success signals.
## Personas and jobs
Primary personas, user jobs, contexts of use.
## Information architecture
Navigation, routes/screens, content hierarchy, and per-screen **Brief & Layout Contract** (ported from OmO `frontend` `#10685`, `#11023`):
- **Primary action**: exactly one per screen; peer actions differ by style, never size.
- **Information priorities 1–3**: in reading order.
- **Left out on purpose**: explicit exclusions to prevent feature/card bloat.
- **Required content**: every input, datum, label, and copy listed by name so subtraction never drops or merges required fields.
- **Data shape -> component**: map data structure to the lightest native/house component before reaching for cards.
- **Mandatory `Layout:` line**: for any structural screen or region change, record:
  `Layout: <screen or region> - <spatial problem> -> <pattern name> (<pattern URL or reference>); scroll owner: <CSS selector>; anti-patterns: <what to avoid>`
## Design principles
Principles, tradeoffs, and **Draft Guard anti-slop rules** (ported from OmO `check-draft-guard.ts` `#11022`, `#11314`):
- No one-side coloured border/shadow/gradient stripes (`edge-stripe`, `pseudo-bar`, `inset-shadow-stripe`, `gradient-stripe`) or `>=2px` accent outlines on rounded cards (`accent-outline`), whether decorative or marking selected/focused/active state.
- No decorative badges without a changing state (`decorative-badge`, e.g. "New", "AI-powered"), no stat tiles with marketing-form numbers (`vanity-stat`, e.g. `10x`, `500+`, `24/7` — only measured figures pass), and no emoji used as icons (`emoji-icon`).
- No invented proof/testimonials, prop decoration, subtitle-under-every-heading, duplicate facts, or promotional filler copy ("seamlessly", "effortlessly", "supercharge", "at a glance").
## Visual language
Color, typography, spacing, shape/elevation, motion, imagery/iconography.
## Components
Existing/new components, variants/states, token ownership.
## Accessibility
Target standard, keyboard/focus, contrast, semantics, reduced motion/sensory concerns.
## Responsive behavior
Breakpoints/devices, layout adaptations, touch/hover differences.
## Interaction states
Loading, empty, error, success, disabled, offline/slow network where applicable.
## Content voice
Tone, terminology, microcopy rules.
## Implementation constraints
Framework/styling, tokens, performance, compatibility, test/screenshot expectations.
## Open questions
`[ ]` question, owner, and impact.

### 4. Apply the contract & external reference hygiene

Before UI decisions, cite relevant `DESIGN.md` sections, reuse documented components/tokens, and update the file or add an open question when implementation exposes a contradiction. Do not invent a parallel design-system layer.
- **External design reference fetch rule (ported from OmO `#11323`, `#11338`)**: when inspecting external design systems or component catalogs, fetch only published agent surfaces (`llms.txt`, `llms-full.txt`, same-origin pages linked from that site's own `llms.txt`, registry JSON, or `.md` docs). Never follow off-site links from `llms.txt`, and `robots.txt` disallow rules always take precedence over `llms.txt` links.

### 5. Handoff

For normal frontend work, provide the relevant sections, repo evidence, and acceptance criteria. For visual-reference, image, or live-URL matching, hand off to `$visual-ralph` with the approved baseline and identify `DESIGN.md` as supporting context only.

## Evidence and completion

Complete only when design docs/assets/components/screenshots were inspected or noted absent; missing context is answered, assumed, or listed; root `DESIGN.md` contains every required section; recommendations cite it; and any Visual Ralph handoff is clearly separated from design governance.
