---
name: loft
description: "[oh-my-agy] Shape-before-steel prototyping: settle a design or logic fork that prose cannot resolve by building a throwaway artifact (pure zero-I/O logic module in an HTML harness, or 3 structurally distinct UI variants behind one switcher). Use for $loft or when a spec/interview stalls on 'we need to see/feel it first'."
---

# Loft — Shape Before Steel (`$loft`)

When a design question stalls in prose—two plausible models, neither falsifiable by talk—build a cheap, disposable runnable artifact so the user can react to it, then fold their decision back into the spec or plan.

## When to use

- A `$deep-interview` or `$ralplan` decision fork stalls in words ("does this state machine feel right?", "steps, cards, or split-pane?").
- The user invokes `$loft` or says "let's prototype both options" / "we'd have to see it first".

Do **not** use `$loft` when the answer is discoverable from repo code (`explore`), upstream docs (`researcher`), or a direct Socratic question (`$deep-interview`), or when diagnosing a bug (`debugger` / `$analyze`).

## Choose the fork

Pick exactly **one** fork per loft (one loft answers one question):

### 1. Logic Fork — "Is the state/rule model right?"
For questions about state machines, reducers, scoring formulas, or edge-case transitions:
1. Isolate the decision-bearing core as a **pure, zero-I/O module** (no framework, no network, no persistence).
2. Wrap it in a single self-contained clickable HTML harness under `.omagy/artifacts/loft/<slug>/index.html` (and optionally copy to the conversation artifact directory and embed inline via `<agent-embed src="file:///<artifact_path>/loft-<slug>.html"></agent-embed>` when compact `<500px`, using Antigravity's `https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js` and semantic tokens `--card`, `--foreground`, `--border` per the built-in `generative_ui` skill): one button per scenario/edge case, with the full state transition visible after every click.
3. Once confirmed, record the chosen state rules in the spec/plan; the pure function can be lifted into production work during `$ultragoal`.

### 2. UI Fork — "What structure holds the data best?"
For questions of layout, information architecture, navigation model, or density:
1. **Rubric First (`arena`)**: before building variants, name the 3–5 concrete evaluation criteria (e.g., scan speed, keyboard density, error visibility, mobile collapse) at the top of the harness so variants are judged against explicit goals rather than vibe.
2. Build **three variants (`A`, `B`, `C`) that differ in structure** (information hierarchy, navigation flow, density)—never three color/font reskins.
3. **HTML Data-Visualization Hygiene**: when a loft prototype renders charts, timelines, or metrics, compute aggregates at the source, bucket dates by the reader's local midnight, hatch partial-window bars so incomplete periods never look like drops, cross-check KPI totals against a second source, use HTML/CSS bars over stretched `preserveAspectRatio="none"` SVGs, and scope styles with component-prefixed CSS classes (`kpi-label`, `bar-seg`) so `A`/`B`/`C` never collide.
4. Provide an on-page switcher cycling `A` / `B` / `C` using realistic data density in `.omagy/artifacts/loft/<slug>/index.html`, and surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` so the user can test the full-height `A` / `B` / `C` variants in the `Loft` tab of the Auxiliary Pane (or open on an isolated git branch `loft/<slug>`).
5. **Variant Grafting (`arena`)**: once the user picks a winner (or requests a hybrid, e.g., *"Variant B's layout with Variant A's filter bar"*), graft the winning structural traits into `DESIGN.md` or `.omagy/specs/` and leave the throwaway harness behind.

## Discipline

- **Disposable by design**: no database migrations, no new dependencies, no production wiring, and no commits to `main`. Keep artifacts in `.omagy/artifacts/loft/<slug>/` or on a non-merged `loft/<slug>` branch.
- **Fast feedback**: use `ask_question` after presenting the loft artifact so the user can select the winning variant or edge-case behavior in one click.
- **Fold the answer**: write the user's chosen option and 1-line rationale into the active `.omagy/specs/deep-interview-<slug>.md`, `.omagy/plans/prd-<slug>.md`, or `DESIGN.md`, then return to the calling workflow.
