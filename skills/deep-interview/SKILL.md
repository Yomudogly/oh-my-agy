---
name: deep-interview
description: "[oh-my-agy] Socratic deep interview with quantitative ambiguity gating before planning or execution. Use when a request is broad, ambiguous, or missing acceptance criteria, or when the user says 'deep interview', 'interview me', 'ask me everything', 'don't assume', or 'ouroboros'. Supports --quick, --standard (default), --deep, and --autoresearch."
---

<Purpose>
Deep Interview is an intent-first Socratic clarification loop that runs before planning or implementation. It turns vague ideas into execution-ready specifications by asking targeted questions: why the user wants the change, how far it should go, what stays out of scope, and what the agent may decide without confirmation.
</Purpose>

<Use_When>
- The request is broad, ambiguous, or missing concrete acceptance criteria.
- The user says "deep interview", "interview me", "ask me everything", "don't assume", or "ouroboros".
- The user wants to avoid misaligned implementation from underspecified requirements.
- A requirements artifact is needed before handing off to `$ralplan`, `$autopilot`, `$ultragoal`, or `$team`.
</Use_When>

<Do_Not_Use_When>
- The request already has concrete file/symbol targets and clear acceptance criteria.
- The user explicitly asks to skip planning/interview and execute immediately.
- The user only wants lightweight brainstorming (use `$plan`).
- A complete PRD/plan already exists and execution should start.
</Do_Not_Use_When>

<Depth_Profiles>
- **Quick (`--quick`)**: fast pre-PRD pass; threshold `<= 0.30`; max 5 rounds.
- **Standard (`--standard`, default)**: full requirement interview; threshold `<= 0.20`; max 12 rounds.
- **Deep (`--deep`)**: high-rigor exploration; threshold `<= 0.15`; max 20 rounds.
- **Autoresearch (`--autoresearch`)**: Standard rigor, specialized for `$autoresearch` mission readiness (see below).

`max rounds` is a hard cap, not a target. Do not continue only to reach a round count. If no flag is given, use Standard. Optional per-repo overrides may live in `.omagy/config.json` under `deepInterview` (`defaultProfile`, `quickThreshold`, `standardThreshold`, `deepThreshold`, `quickMaxRounds`, `standardMaxRounds`, `deepMaxRounds`, `enableChallengeModes`). Ignore a malformed config. Explicit flags win.
</Depth_Profiles>

<Execution_Policy>
- Ask ONE question per round. Never batch several interview rounds into one form.
- Ask about intent and boundaries before implementation detail.
- Target the weakest clarity dimension each round, after applying the stage-priority rules below.
- Treat every answer as a claim to pressure-test. The next question should usually demand evidence or examples, expose a hidden assumption, force a tradeoff or boundary, or reframe root cause vs symptom.
- Do not rotate to a new dimension just for coverage while the current answer is still vague. Go one layer deeper first.
- Before crystallizing, complete at least one explicit pressure pass that revisits an earlier answer with a deeper assumption- or tradeoff-focused follow-up.
- Gather codebase facts yourself (or via the `explore` subagent) before asking the user about internals. Never ask the user for facts the repository can answer.
- Always run preflight context intake before the first question. For brownfield work, it includes doc/context grounding: governing `AGENTS.md`/`GEMINI.md` files, README/getting-started docs, relevant `docs/` contracts/plans/ADRs, existing `.omagy/context/` snapshots, and glossary/context files such as `CONTEXT.md`.
- Treat existing repo language as evidence, not authority. If the user's term is fuzzy, overloaded, or conflicts with docs/code, surface the exact wording and ask which meaning governs.
- Cross-check user claims about current behavior against code or documented contracts. If docs and code disagree, ask a confirmation question that names both sources.
- Use scenario-based edge-case grilling when a boundary or handoff is unclear: invent one concrete scenario that stresses it, then ask one focused question about the expected outcome.
- Durable doc/glossary/ADR updates are opt-in and public-safe only. Recommend them in the handoff; never auto-create them from interview transcripts.
- If initial context is oversized, do not paste it into prompts. Make the first round a request for a prompt-safe summary (goals, constraints, success criteria, non-goals, decision boundaries, references to full sources). This gate blocks scoring, crystallizing, and handoff.
- Route facts before judgment. Before each round, classify the needed information as a discoverable fact, a fact needing confirmation, or a human decision. The interview with the human is for judgment.
- When ambiguity depends on current external best practices or version-aware behavior, use `$best-practice-research` before crystallizing.
- Transcript/spec labels:
  - `[from-code][auto-confirmed]`: exact, high-confidence codebase facts with no prescription attached. Record them as context, not interview rounds.
  - `[from-code]`: inferred or pattern-based findings that need a confirmation-style round.
  - `[from-research]`: externally sourced facts (limits, compatibility, docs). Facts only, never decisions.
  - `[from-user]`: goals, preferences, scope, non-goals, acceptance criteria, tradeoffs, and any decision-bearing interpretation.
- Auto-confirm only descriptive facts. If a finding implies what the feature should do, which pattern to follow, or what is in/out of scope, route the whole decision to the user as `[from-user]`.
- Re-score ambiguity after each answer and show progress transparently.
- Once ambiguity is at or below threshold, stop ordinary questioning and run the closure audit.
- Do not hand off while ambiguity is above threshold unless the user explicitly opts to proceed with a warning.
- Do not crystallize or hand off while `Non-goals` or `Decision Boundaries` remain unresolved, even if the score meets threshold.
- Deep-interview is a requirements mode. Do not implement.
</Execution_Policy>

<Asking_Questions>
Use Antigravity's `ask_question` tool for every interview round. It replaces `omx question`.

- One question per `ask_question` call. Header line in the question text:
  `Round {n} | Target: {weakest_dimension} | Ambiguity: {score}%`, then the question.
- `is_multi_select: false` (single-answer) when exactly one answer should drive the next branch or the options are mutually exclusive: lane selection, primary failure mode, competing interpretations.
- `is_multi_select: true` when several options can all hold at once: all out-of-scope items, all success metrics, all deployment constraints.
- If one selected option would immediately need a follow-up to disambiguate the others, ask a single-answer round now and the follow-up next. Do not hide a branching tree inside one multi-select.
- Options: 2-6 concrete, bounded choices written as the user's answer, formatted `Label — short description`. Put the recommended option first with the `(Recommended)` prefix. Do not add an "Other" option: the UI always provides a write-in.
- If `ask_question` is unavailable (for example in a headless run), ask exactly one concise plain-text question and wait for the answer.
- If the user skips a question, record that as `[from-user] skipped`, lower confidence for that dimension, and choose the next-highest-leverage question rather than re-asking verbatim.
</Asking_Questions>

<Steps>

## Phase 0: Preflight context intake

1. Derive a short task slug from the user's request.
2. Load the latest relevant snapshot from `.omagy/context/{slug}-*.md` if one exists.
3. Check whether the initial context or loaded snapshot is too large for safe prompt use. If so, round 1 must request a prompt-safe summary.
4. If no snapshot exists, create one containing: task statement; desired outcome; stated solution; probable intent hypothesis; known facts/evidence; constraints; unknowns; decision-boundary unknowns; likely codebase touchpoints; repo docs/rules/context inspected; terminology or doc/code conflicts; prompt-safe summary status (`not_needed` | `needed` | `recorded`).
5. For brownfield tasks, inspect the applicable documentation/rule surface before the first user-facing round. Prefer exact, nearby sources over broad scans.
6. Save to `.omagy/context/{slug}-{YYYYMMDDTHHMMSSZ}.md` (UTC).

## Phase 1: Initialize

1. Parse the depth profile flag.
2. Classify **brownfield** (existing codebase target) vs **greenfield**. For brownfield, collect relevant code context first (directly or via `explore`).
3. Persist state. Standalone: write `.omagy/state/deep-interview-state.json`. Inside Autopilot: do not create this file. Store the same fields under `state.deep_interview` in `autopilot-state.json`.

```json
{
  "mode": "deep-interview",
  "active": true,
  "current_phase": "interview",
  "started_at": "<ISO>",
  "updated_at": "<ISO>",
  "state": {
    "slug": "<slug>",
    "profile": "quick|standard|deep|autoresearch",
    "type": "greenfield|brownfield",
    "initial_idea": "<user input>",
    "rounds": [],
    "current_ambiguity": 1.0,
    "threshold": 0.2,
    "max_rounds": 12,
    "challenge_modes_used": [],
    "current_stage": "intent-first",
    "current_focus": "intent",
    "context_snapshot_path": ".omagy/context/<slug>-<ts>.md"
  }
}
```

4. Announce the kickoff with profile, threshold, and current ambiguity.

## Phase 2: Socratic interview loop

Repeat until: ambiguity `<= threshold` and the readiness gates pass, the user exits with a warning, or max rounds are reached. Below threshold, do not open a new ordinary branch.

### 2a) Generate the next question
If oversized context has no recorded summary, the only allowed question is the summary request.

Inputs: original idea, prior rounds, dimension scores, brownfield context, doc/terminology notes, and any activated challenge mode (Phase 3).

Target the lowest-scoring dimension, respecting stage priority:
- **Stage 1, intent-first:** Intent, Outcome, Scope, Non-goals, Decision Boundaries.
- **Stage 2, feasibility:** Constraints, Success Criteria.
- **Stage 3, brownfield grounding:** Context Clarity (brownfield only).

Follow-up pressure ladder after each answer:
1. Ask for a concrete example, counterexample, or evidence signal behind the claim.
2. Probe the hidden assumption or dependency that makes it true.
3. Force a boundary or tradeoff: what would you explicitly not do, defer, or reject?
4. Challenge fuzzy or conflicting terms against repo docs and current code.
5. Stress-test with one concrete scenario or edge case.
6. If the answer still describes symptoms, reframe toward root cause.

Maintain a **Breadth Ledger** of independent ambiguity tracks (scope, constraints, outputs, verification, brownfield integration, user-named deliverables). It is a guard, not a rotation rule.

For brownfield work, maintain a **Docs/Terminology Ledger**: sources inspected (paths), canonical repo terms, user terms that conflict, doc/code mismatches needing a human decision, and optional durable-doc follow-ups.

Dimensions:
- Intent Clarity: why the user wants this.
- Outcome Clarity: the end state.
- Scope Clarity: how far the change goes.
- Constraint Clarity: technical/business limits.
- Success Criteria Clarity: how completion is judged.
- Context Clarity: existing-code understanding (brownfield only).

`Non-goals` and `Decision Boundaries` are mandatory readiness gates. Ask about them early and revisit them until they are explicit.

### 2b) Ask the question
Use `ask_question` as described in `<Asking_Questions>`.

### 2c) Score ambiguity
Score each dimension in `[0.0, 1.0]` with a justification and the gap.

- Greenfield: `ambiguity = 1 - (intent×0.30 + outcome×0.25 + scope×0.20 + constraints×0.15 + success×0.10)`
- Brownfield: `ambiguity = 1 - (intent×0.25 + outcome×0.20 + scope×0.20 + constraints×0.15 + success×0.10 + context×0.10)`

Readiness gates:
- `Non-goals` explicit.
- `Decision Boundaries` explicit.
- Pressure pass complete: at least one earlier answer revisited with an evidence, assumption, or tradeoff follow-up.
- Practical closure audit: another question would change execution materially, not just polish wording.
- If a gate is unresolved below threshold, ask only a final closure question that names the gate.
- If ambiguity `<= 0.10`, another question is allowed only as that closure question. Otherwise crystallize immediately.

### 2d) Report progress
Show a weighted breakdown table, readiness-gate status, and the next focus dimension.

### 2e) Persist state
Append the round (question, answer, label, scores) to state and refresh `updated_at`.

### 2f) Round controls
- Do not offer early exit before the first assumption probe and one persistent follow-up.
- **Dialectic Rhythm Guard:** after 3 consecutive non-user/confirmation entries (`[from-code]`, `[from-research]`, auto-confirmed facts), the next material round must ask for direct human judgment, unless the closure audit says crystallize.
- From round 4, allow explicit early exit with a risk warning.
- Soft warning at the profile midpoint. Hard cap at `max_rounds`.

## Phase 3: Challenge modes

Use each mode once when applicable, and track usage in state:
- **Contrarian** (round 2+, or immediately on an untested assumption): challenge core assumptions.
- **Terminologist** (brownfield, when a key term is fuzzy or conflicts with repo language): force a canonical meaning.
- **Simplifier** (round 4+, or when scope grows faster than outcome clarity): probe minimal viable scope.
- **Ontologist** (round 5+ with ambiguity > 0.25, or when the user keeps describing symptoms): ask for essence-level reframing.

If ambiguity stalls for 3 rounds (±0.05), force Ontologist once.

## Phase 4: Crystallize artifacts

When threshold is met (or on early exit with a warning, or at the hard cap):

1. Write the transcript summary to `.omagy/interviews/{slug}-{timestamp}.md`.
2. Write the execution-ready spec to `.omagy/specs/deep-interview-{slug}.md` containing:
   - Metadata (profile, rounds, final ambiguity, threshold, context type) and the context snapshot path.
   - Prompt-safe initial-context summary (when oversized context was provided) with references to the full sources.
   - Clarity breakdown table.
   - Intent; Desired Outcome; In-Scope; Out-of-Scope / Non-goals; Decision Boundaries (what the agent may decide without confirmation); Constraints; testable Acceptance Criteria.
   - Assumptions exposed and their resolutions; pressure-pass findings (which answer was revisited and what changed).
   - Brownfield evidence vs inference notes; Docs/Terminology Ledger; scenario/edge-case findings.
   - Optional durable-doc recommendations (opt-in, public-safe, no raw transcript dumps).
   - Technical context findings; full or condensed transcript.
   - Residual-risk state if the interview ended by early exit, hard cap, or above-threshold proceed.
3. Standalone: write state `current_phase:"complete"`, `active:false`, `completed_at`. Inside Autopilot: set `handoff_artifacts.deep_interview` to the spec path and advance Autopilot to `ralplan`.

### Autoresearch specialization (`--autoresearch`)
- Focus the interview on mission clarity, evaluator readiness, keep policy, slug naming, and launch-now vs refine-further.
- Accepted seed inputs: `topic`, `evaluator`, `keep-policy`, `slug`, a mission draft, evaluator examples.
- Canonical spec: `.omagy/specs/deep-interview-autoresearch-{slug}.md` with sections `Mission Draft`, `Evaluator Draft`, `Launch Readiness`, `Seed Inputs`, `Confirmation Bridge`.
- Launch bundle under `.omagy/specs/autoresearch-{slug}/`: `mission.md`, `sandbox.md`, `result.json` (`topic`, `evaluatorCommand`, `keepPolicy`, `slug`, `launchReady`, `blockedReasons`).
- Mark the draft **not launch-ready** while the evaluator command contains placeholders (`<...>`, `TODO`, `TBD`, `REPLACE_ME`, `CHANGEME`, `your-command-here`).
- After generating artifacts, offer `refine further` vs `launch` via `ask_question`. Hand off to `$autoresearch` only after explicit confirmation.

## Phase 5: Execution bridge

Present handoff options with `ask_question` (single-answer, recommended option first). The spec is the requirements source of truth. Preserve intent, non-goals, decision boundaries, acceptance criteria, terminology grounding, and residual-risk warnings across the handoff.

1. **`$ultragoal`** (default durable execution): input is the spec. Convert it into durable goals with sequential completion tracking. It skips requirements discovery.
2. **`$ralplan`** (recommended when architecture/test-shape review is still needed): treat the spec as requirements truth and do not repeat the interview. Output goes to `.omagy/plans/`.
3. **`$autopilot`**: planning plus execution from the clarified brief.
4. **`$team`**: coordinated parallel execution against the shared spec.
5. **Refine further**: continue the interview loop.

Context-sensitive goal-mode suggestions: `$autoresearch` for research projects, `$performance-goal` for measurable optimization work.

Optional stride contract: when the downstream workflow needs an explicit stop condition, store it as structured data under `handoff_artifacts.deep_interview.execution_contract` in Autopilot state, e.g. `{"version":1,"execution_stride":"task|deliverable|milestone","selected_by":"user","completion_unit":"...","stop_condition":"..."}`. Do not infer stride from task length.

**Do NOT implement inside deep-interview.** On handoff, activate the selected skill.

</Steps>

<Escalation_And_Stop_Conditions>
- User says stop/cancel/abort: persist state and stop.
- Ambiguity stalls for 3 rounds: force Ontologist once.
- Max rounds reached: proceed with an explicit residual-risk warning.
- All dimensions >= 0.9: early crystallization is allowed.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Preflight snapshot exists under `.omagy/context/`.
- [ ] Oversized context (if any) has a recorded prompt-safe summary before scoring or handoff.
- [ ] Ambiguity was shown each round, with intent-first priority and weakest-dimension targeting.
- [ ] At least one assumption probe and one pressure pass happened.
- [ ] Challenge modes fired when applicable.
- [ ] Transcript written to `.omagy/interviews/` and spec to `.omagy/specs/deep-interview-{slug}.md`.
- [ ] Brownfield questions used evidence-backed confirmation; terminology conflicts were resolved.
- [ ] Handoff options were offered. No direct implementation was performed.
</Final_Checklist>
