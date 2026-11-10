# Ideation Lenses and Concept Shaping

Reference manual for [`skills/deep-interview/SKILL.md`](../SKILL.md) when `--ideate` is active (standalone or combined with `--quick`, `--standard`, or `--deep`). Run this divergent-then-convergent pass after Phase 0/1 context grounding and **before** Phase 2 Socratic requirement crystallization whenever the problem is real but the right product wedge or technical shape is still open.

---

## 1. Problem Reframing (`How Might We`)

Before proposing solutions, strip premature implementation framing ("add a dashboard", "build a daemon", "introduce a queue") back to the underlying user pain, trigger moment, and constraint tension:

1. Ground brownfield constraints in `[from-code][auto-confirmed]` repository facts first—never ideate against imagined architecture.
2. Write 1–3 sharp reframings in the exact structure:
   - `"How might we [outcome] for [user] without [constraint]?"`
3. Name the **real baseline competitor**: the exact workaround the affected persona uses today (manual CLI ritual, copy-pasted spreadsheet, ad-hoc script, ignoring noisy alerts, or an existing repo helper). Every candidate direction competes against this status quo.

---

## 2. Divergent Phase: `5–8` Variations Across 7 Ideation Lenses

Generate **`5–8` structurally distinct candidate directions**. Explicitly **reject `20+` shallow brainstorm lists**, synonym swaps, or trivial flag permutations—every candidate must change the workflow boundary, wedge, ownership model, or mechanism. Tag each candidate with one or more of the **7 Ideation Lenses**:

1. **Inversion**: flip who initiates, owns, or verifies the work (pull vs push, declarative policy vs imperative steps, caller-enforced contract vs downstream cleanup, local-first vs centralized).
2. **Constraint Removal**: ask what design becomes possible if the dominant bottleneck (manual approval, cold-start configuration, network round-trip, schema lock, human data entry) is eliminated at the root instead of wrapped in UI.
3. **10x Narrowing / Wedge**: narrow the target persona, trigger condition, or input surface by `10x` so the highest-frequency pain point works end-to-end with zero setup before generalizing.
4. **Zero-UI / Automation**: solve the problem with zero new screens, menus, or standalone surfaces—embed into an existing hook, CLI gate, editor diagnostic, PR check, or convention-over-configuration rule.
5. **Analogue Transfer**: adapt a proven invariant from an adjacent engineering domain (append-only ledgers, compiler pass diagnostics, content-addressable digests, circuit breakers, expand/contract migrations) to enforce correctness structurally.
6. **Adversarial Abuse**: stress the problem from the perspective of a fatigued operator, noisy tenant, malformed input stream, or malicious actor—what breaks, spams, games, or leaks in the naive solution, and what counter-design makes that failure mode impossible by construction?
7. **Subtraction / Delete-the-Feature**: ask which existing step, state file, configuration knob, or proposed requirement can be *deleted* so the failure mode disappears or collapses into an existing repository primitive (`6-Rung Reuse Ladder` rungs 1–2).

---

## 3. Convergent Phase: Value, Differentiation & Assumption Audit

Filter and rank the `5–8` candidates down to one recommended direction (plus 1–2 viable runners-up when real tradeoffs remain) using three convergent tests:

### A. `Painkiller vs Vitamin` User-Value Test
- **Specific Affected Persona**: name the concrete user/operator role, exact trigger event, and cost of failure today (never generic "users" or "developers").
- **Current Workaround = Real Competitor**: compare switching friction against the actual workaround used today.
- **Classification**:
  - **Painkiller**: eliminates an acute failure mode, blocking bottleneck, data/security hazard, or recurring high-friction toil relative to the current workaround. Keep and prioritize.
  - **Vitamin**: nice-to-have polish or speculative flexibility with low urgency over the current workaround. Cut into `Not Doing (and Why)` unless near-zero cost inside the painkiller wedge.

### B. 6-Tier Differentiation Ladder
Score each surviving candidate by the highest credible tier it achieves over the current workaround and existing codebase (`New capability -> 10x improvement -> New audience -> New context -> Better UX -> Cheaper`):

1. **New capability**: unlocks an outcome previously impossible in this system or workflow.
2. **10x improvement**: order-of-magnitude gain in speed, defect prevention, setup elimination, or determinism on the core job.
3. **New audience**: enables personas previously blocked by access, skill, or tooling prerequisites.
4. **New context**: embeds the capability directly where the work already happens instead of requiring a context switch.
5. **Better UX**: cleaner ergonomics or lower cognitive load on an existing capability.
6. **Cheaper**: lower runtime, maintenance, token, or operational cost for equivalent behavior.

*Anti-inflation rule*: reject candidates that pitch Tier 1–2 complexity while delivering only Tier 5–6 polish.

### C. `Must Be True / Should Be True / Might Be True` Assumption Audit
Surface the load-bearing assumptions behind the recommended direction and pair each with a fast validation test:
- **`Must Be True`** *(existential)*: if false, the direction fails outright; verify immediately via code/doc inspection or resolve as a Phase 2 Stage-1 gate before planning.
- **`Should Be True`** *(degrades materially)*: if false, scope, latency, or ergonomics degrade and require a pre-named fallback or scope cut.
- **`Might Be True`** *(deferrable upside)*: plausible hypothesis not required for MVP value; quarantine out of MVP scope until measured.

---

## 4. Ideation Artifact & Selection Bridge into Phase 2

1. Persist the ideation brief to `.omagy/artifacts/ideas/<slug>.md` with all seven sections:
   - `## Problem Statement` — affected persona, current workaround (real competitor), brownfield constraints, and `"How Might We"` reframing(s).
   - `## Candidate Directions` — `5–8` distinct variations with Lens tag, `Painkiller vs Vitamin` rating, 6-Tier Differentiation rung, and core tradeoff.
   - `## Recommended Direction` — selected wedge/mechanism and why it beats the current workaround and runners-up.
   - `## Must/Should/Might Be True Assumptions & Validation Tests` — `Assumption | Tier | Failure Impact | Fast Validation Test`.
   - `## MVP Scope` — smallest end-to-end painkiller slice.
   - `## Not Doing (and Why)` — discarded variations, Vitamin cuts, and deferred `Might Be True` bets (seeds Phase 2 `Non-goals`).
   - `## Open Questions` — unresolved human-judgment forks surviving the Two-Filter Gate (seeds Phase 2 Socratic rounds).
2. **Selection Bridge (`ask_question` -> Phase 2)**:
   - Unless **No-Questions Override** is active (in which case record the top-ranked direction as `[adopted-default]` and proceed directly), call `ask_question` (`is_multi_select: false`) with header `Ideation Bridge | Target: direction-lock | Artifact: .omagy/artifacts/ideas/{slug}.md`, placing `(Recommended) <Direction> — <1-line painkiller wedge>` first, followed by 1–3 distinct runner-up wedges and `Refine ideation — explore another lens or constraint`.
   - Record `ideation_artifact_path` (`.omagy/artifacts/ideas/<slug>.md`) and `selected_direction` in interview state, seed `Non-goals` from `Not Doing (and Why)`, and enter **Phase 2 (Socratic interview loop)** to drive ambiguity `<= threshold` and crystallize `.omagy/specs/deep-interview-{slug}.md`.
