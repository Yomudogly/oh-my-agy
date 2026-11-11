# Deep Interview Scoring, Challenge Modes & Spec Templates

Reference manual for [`skills/deep-interview/SKILL.md`](../SKILL.md). Read this file during Phase 2 (scoring & challenge modes) and Phase 4 (crystallizing the spec or `--autoresearch` bundle).

---

## 1. Stage Priority, Pressure Ladder & Ledgers (Phase 2a)

Target the lowest-scoring dimension while respecting stage priority:
- **Stage 1, intent-first**: Intent, Outcome, Scope, Non-goals, Decision Boundaries (`Always / Ask First / Never`).
- **Stage 2, feasibility**: Constraints, Success Criteria.
- **Stage 3, brownfield grounding**: Context Clarity (brownfield only).

### Phase 0 Capability Map DAG (`>= 3` Bundled Capabilities)
When a request bundles `>= 3` independent capabilities, workflows, or subsystems, draft a lightweight **Capability Map DAG** during Phase 0/1 before deep-diving individual edge cases:

`Module id | Responsibility | Depends on | Build order`

Use the DAG to confirm scope cuts, isolate foundational contracts (`Depends on: none`), and sequence Socratic rounds in dependency order rather than jumping across uncoupled features.

### Follow-Up Pressure Ladder After Each Answer
1. Ask for a concrete example, counterexample, or evidence signal behind the claim.
2. Probe the hidden assumption or dependency that makes it true (`Must Be True / Should Be True / Might Be True`).
3. Force a boundary or tradeoff: what would you explicitly not do, defer, or reject?
4. Challenge fuzzy or conflicting terms against repo docs and current code.
5. Stress-test with one concrete scenario or edge case.
6. If the answer still describes symptoms, reframe toward root cause.
7. **`"Want vs. Should Want"` Buzzword / Convention-Signaling Probe**: when the user leans on convention-signaling or XY-problem buzzwords (`"scalable"`, `"clean"`, `"modern"`, `"the standard way"`, `"future-proof"`) without naming a concrete operational pressure, ask: *"If you didn't have to justify this to anyone, what would you actually want?"* Lock scope to the real outcome rather than performative complexity.

### Required Ledgers
- **Breadth Ledger**: Track independent ambiguity tracks (scope, constraints, outputs, verification, brownfield integration, user-named deliverables). It is a guard, not a rotation rule.
- **Docs/Terminology Ledger (brownfield)**: Record sources inspected (paths), canonical repo terms, user terms that conflict, doc/code mismatches needing a human decision, and optional durable-doc follow-ups.

---

## 2. Ambiguity Scoring Formulas & Readiness Gates (Phase 2c)

Score each dimension in `[0.0, 1.0]` with a justification and the remaining gap:
- **Intent Clarity**: why the user wants this.
- **Outcome Clarity**: the end state.
- **Scope Clarity**: how far the change goes.
- **Constraint Clarity**: technical/business limits.
- **Success Criteria Clarity**: how completion is judged.
- **Context Clarity**: existing-code understanding (brownfield only).

### Weighted Formulas
- **Greenfield**:
  `ambiguity = 1 - (intent×0.30 + outcome×0.25 + scope×0.20 + constraints×0.15 + success×0.10)`
- **Brownfield**:
  `ambiguity = 1 - (intent×0.25 + outcome×0.20 + scope×0.20 + constraints×0.15 + success×0.10 + context×0.10)`

### Mandatory Readiness Gates
- `Non-goals` explicit.
- `Decision Boundaries` explicit (`Always / Ask First / Never`, plus `[adopted-default]` tags).
- **Pressure pass complete**: at least one earlier answer revisited with an evidence, assumption, or tradeoff follow-up.
- **Practical closure audit & 3-Question Predictability Check**: confirm another question would change architecture, scope, or acceptance tests materially rather than polish wording, and ask *"Can you predict the user's reaction to the next 3 materially distinct questions?"* Reject predictable rubber-stamp boilerplate; once the next 3 distinct answers are predictable from stated intent and boundaries, stop questioning and crystallize.
- **Zero-Context Builder Check (`builder-check` pass)**: before handing off a complex spec, optionally audit the draft from the perspective of a zero-context builder who cannot talk to the author (`"What would a builder have to guess where a wrong guess would break a user contract or cross-module interface?"`). Triage findings into `Answered already` (cite section), `Minor` (record under `[adopted-default]` in Decision Boundaries), and `Theirs` (ask in a single final closure question only if it survives the Owner-Decision Gate).
- If a gate is unresolved below threshold, ask only a final closure question that names the gate.
- If `ambiguity <= 0.10`, another question is allowed only as that closure question; otherwise crystallize immediately.

### Round Controls (Phase 2f)
- Do not offer early exit before the first assumption probe and one persistent follow-up.
- **Dialectic Rhythm Guard**: after 3 consecutive non-user/confirmation entries (`[from-code]`, `[from-research]`, auto-confirmed facts), the next material round must ask for direct human judgment, unless the closure audit says crystallize.
- From round 4, allow explicit early exit with a risk warning.
- Soft warning at the profile midpoint. Hard cap at `max_rounds`.

---

## 3. Challenge Modes (Phase 3)

Use each mode at most once when triggered, and record it in `state.challenge_modes_used`:
- **Contrarian** (round 2+, or immediately on an untested assumption): challenge core assumptions.
- **Terminologist** (brownfield, when a key term is fuzzy or conflicts with repo language): force a canonical meaning.
- **Simplifier** (round 4+, or when scope grows faster than outcome clarity): probe minimal viable scope.
- **Ontologist** (round 5+ with `ambiguity > 0.25`, or when the user keeps describing symptoms): ask for essence-level reframing.

If ambiguity stalls for 3 consecutive rounds (`±0.05`), force **Ontologist** once.

---

## 4. Execution-Ready Spec Template (Phase 4)

Write `.omagy/specs/deep-interview-{slug}.md` with all of the following sections:
1. **Metadata**: profile, rounds, final ambiguity, threshold, context type (`greenfield|brownfield`), context snapshot path (`.omagy/context/{slug}-*.md`), and optional ideation artifact path (`.omagy/artifacts/ideas/{slug}.md`).
2. **Prompt-Safe Initial-Context Summary** (when oversized context was provided) with references to full sources, plus a **Capability Map DAG** (`Module id | Responsibility | Depends on | Build order`) whenever `>= 3` independent capabilities are bundled.
3. **Clarity Breakdown Table**: per-dimension score, weight, justification, and remaining gap.
4. **Affected User Ideal State & Gap Table**:
   `Dimension | Current State | Ideal State | Gap | Approach | Verification Metric`
5. **Core Specification**:
   - Intent
   - Desired Outcome
   - In-Scope
   - Out-of-Scope / Non-goals (plus explicit anti-goals)
   - Decision Boundaries (`Always / Ask First / Never`):
     - `Always`: safe autonomous actions, engineering defaults, and `[adopted-default]` choices
     - `Ask First`: irreversible, destructive, spend-bearing, schema, or external-contract forks
     - `Never`: hard prohibitions, out-of-bounds surfaces, and anti-goals
   - Constraints
   - Testable Acceptance Criteria
6. **Pressure & Assumption Audit**: assumptions tiered as **`Must Be True`** (existential; verify immediately), **`Should Be True`** (degrades scope/UX if false; pre-named fallback), or **`Might Be True`** (deferrable upside) with validation tests; pressure-pass findings (which answer was revisited, `"Want vs. Should Want"` reframings, and what changed).
7. **Brownfield & Terminology Grounding**: evidence vs inference notes (`[from-code][auto-confirmed]`, `[from-code]`, `[from-research]`, `[from-user]`), Docs/Terminology Ledger, and scenario/edge-case findings.
8. **Optional Durable-Doc Recommendations**: opt-in, public-safe, no raw transcript dumps.
9. **Transcript & Residual Risks**: condensed/full transcript and residual-risk state if ended by early exit, hard cap, or above-threshold proceed.

---

## 5. Autoresearch Specialization (`--autoresearch`)

When `--autoresearch` is active:
- Focus the interview on mission clarity, evaluator readiness, keep policy, slug naming, **research fidelity rules**, and launch-now vs refine-further.
- Accepted seed inputs: `topic`, `evaluator`, `keep-policy`, `slug`, a mission draft, evaluator examples.
- Canonical spec: `.omagy/specs/deep-interview-autoresearch-{slug}.md` with sections `Mission Draft`, `Evaluator Draft`, `Fidelity`, `Launch Readiness`, `Seed Inputs`, `Confirmation Bridge`.
- **Locked `## Fidelity` block**: infer first from the prompt and ask only triggered fields:
  - `as of`: version/release/commit/date anchor (default: latest at run start).
  - `meaning check`: `on` (full rigor) or `off` (light rigor).
  - `source floor`: `standard`, `primary only`, or `pointed only: <URLs/paths>`.
  - `derived numbers`: `allowed` or `none` (when `none`, only direct measured/quoted figures are permitted).
- Launch bundle under `.omagy/specs/autoresearch-{slug}/`: `mission.md`, `sandbox.md`, `result.json` (`topic`, `evaluatorCommand`, `keepPolicy`, `slug`, `fidelity`, `launchReady`, `blockedReasons`).
- Mark the draft **not launch-ready** while the evaluator command contains placeholders (`<...>`, `TODO`, `TBD`, `REPLACE_ME`, `CHANGEME`, `your-command-here`) or any required `## Fidelity` field is undecided.
- After generating artifacts, offer `refine further` vs `launch` via `ask_question`. Hand off to `$deep-research --loop` only after explicit confirmation.
