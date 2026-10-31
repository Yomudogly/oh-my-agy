# Deep Interview Scoring, Challenge Modes & Spec Templates

Reference manual for [`skills/deep-interview/SKILL.md`](../SKILL.md). Read this file during Phase 2 (scoring & challenge modes) and Phase 4 (crystallizing the spec or `--autoresearch` bundle).

---

## 1. Stage Priority, Pressure Ladder & Ledgers (Phase 2a)

Target the lowest-scoring dimension while respecting stage priority:
- **Stage 1, intent-first**: Intent, Outcome, Scope, Non-goals, Decision Boundaries.
- **Stage 2, feasibility**: Constraints, Success Criteria.
- **Stage 3, brownfield grounding**: Context Clarity (brownfield only).

### Follow-Up Pressure Ladder After Each Answer
1. Ask for a concrete example, counterexample, or evidence signal behind the claim.
2. Probe the hidden assumption or dependency that makes it true.
3. Force a boundary or tradeoff: what would you explicitly not do, defer, or reject?
4. Challenge fuzzy or conflicting terms against repo docs and current code.
5. Stress-test with one concrete scenario or edge case.
6. If the answer still describes symptoms, reframe toward root cause.

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
- `Decision Boundaries` explicit.
- **Pressure pass complete**: at least one earlier answer revisited with an evidence, assumption, or tradeoff follow-up.
- **Practical closure audit**: another question would change execution materially, not just polish wording.
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
1. **Metadata**: profile, rounds, final ambiguity, threshold, context type (`greenfield|brownfield`), and context snapshot path (`.omagy/context/{slug}-*.md`).
2. **Prompt-Safe Initial-Context Summary** (when oversized context was provided) with references to full sources.
3. **Clarity Breakdown Table**: per-dimension score, weight, justification, and remaining gap.
4. **Affected User Ideal State & Gap Table**:
   `Dimension | Current State | Ideal State | Gap | Approach | Verification Metric`
5. **Core Specification**:
   - Intent
   - Desired Outcome
   - In-Scope
   - Out-of-Scope / Non-goals
   - Decision Boundaries (what the agent may decide without confirmation, plus any `[adopted-default]` choices)
   - Constraints
   - Testable Acceptance Criteria
6. **Pressure & Assumption Audit**: assumptions exposed and their resolutions; pressure-pass findings (which answer was revisited and what changed).
7. **Brownfield & Terminology Grounding**: evidence vs inference notes (`[from-code][auto-confirmed]`, `[from-code]`, `[from-research]`, `[from-user]`), Docs/Terminology Ledger, and scenario/edge-case findings.
8. **Optional Durable-Doc Recommendations**: opt-in, public-safe, no raw transcript dumps.
9. **Transcript & Residual Risks**: condensed/full transcript and residual-risk state if ended by early exit, hard cap, or above-threshold proceed.

---

## 5. Autoresearch Specialization (`--autoresearch`)

When `--autoresearch` is active:
- Focus the interview on mission clarity, evaluator readiness, keep policy, slug naming, **research fidelity rules**, and launch-now vs refine-further.
- Accepted seed inputs: `topic`, `evaluator`, `keep-policy`, `slug`, a mission draft, evaluator examples.
- Canonical spec: `.omagy/specs/deep-interview-autoresearch-{slug}.md` with sections `Mission Draft`, `Evaluator Draft`, `Fidelity`, `Launch Readiness`, `Seed Inputs`, `Confirmation Bridge`.
- **Locked `## Fidelity` block (ported from OmO `ulw-research` `#11166`, `#11289`)**: infer first from the prompt and ask only triggered fields:
  - `as of`: version/release/commit/date anchor (default: latest at run start).
  - `meaning check`: `on` (full rigor) or `off` (light rigor).
  - `source floor`: `standard`, `primary only`, or `pointed only: <URLs/paths>`.
  - `derived numbers`: `allowed` or `none` (when `none`, only direct measured/quoted figures are permitted).
- Launch bundle under `.omagy/specs/autoresearch-{slug}/`: `mission.md`, `sandbox.md`, `result.json` (`topic`, `evaluatorCommand`, `keepPolicy`, `slug`, `fidelity`, `launchReady`, `blockedReasons`).
- Mark the draft **not launch-ready** while the evaluator command contains placeholders (`<...>`, `TODO`, `TBD`, `REPLACE_ME`, `CHANGEME`, `your-command-here`) or any required `## Fidelity` field is undecided.
- After generating artifacts, offer `refine further` vs `launch` via `ask_question`. Hand off to `$autoresearch` only after explicit confirmation.
