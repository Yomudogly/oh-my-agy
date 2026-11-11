---
name: deep-interview
description: "[oh-my-agy] Socratic deep interview with quantitative ambiguity gating before planning or execution. Use when a request is broad, ambiguous, or missing acceptance criteria, or when the user says 'deep interview', 'interview me', 'ask me everything', 'don't assume', or 'ouroboros'. Supports --quick, --standard (default), --deep, --ideate, and --autoresearch."
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
- The user only wants lightweight scoping or planning (use `$ralplan --light`).
- A complete PRD/plan already exists and execution should start.
</Do_Not_Use_When>

<Depth_Profiles>
- **Quick (`--quick`)**: fast pre-PRD pass; threshold `<= 0.30`; max 5 rounds.
- **Standard (`--standard`, default)**: full requirement interview; threshold `<= 0.20`; max 12 rounds.
- **Deep (`--deep`)**: high-rigor exploration; threshold `<= 0.15`; max 20 rounds.
- **Ideate (`--ideate`, profile or modifier)**: pre-Phase-2 divergent/convergent concept shaping (`How Might We` reframing, `5–8` variations across 7 lenses, `Painkiller vs Vitamin` + 6-Tier Differentiation, `Must/Should/Might Be True` audit) saved to `.omagy/artifacts/ideas/{slug}.md` with a single-answer `ask_question` bridge into Phase 2 Socratic convergence; see [ideation-lenses.md](./references/ideation-lenses.md#ideation-lenses-and-concept-shaping).
- **Autoresearch (`--autoresearch`)**: Standard rigor, specialized for `$deep-research --loop` mission readiness (see below).

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
- **Two-Filter Question Gate + Owner-Decision Survival**:
  - **Filter 1 (Material Fork)**: Does the answer change architecture, scope, schema, or file boundaries?
  - **Filter 2 (Unresolvable by Repo/Docs)**: Can this be answered by inspecting the repo or official docs? If yes, inspect—do not ask.
  - **Owner-Decision Survival**: Unless the user explicitly asked for a deep Socratic grilling ("interview me", "ask me everything"), ask only decisions that are irreversible, destructive, spend-bearing, scope-defining, or change a public/external contract. For reversible engineering defaults, propose the recommended default and record it under `[adopted-default]` if the user says "you decide" / "use best practices".
  - **Open "Why" First, Outcome-vs-How Attribution & Anti-Goals**: when the user hasn't stated *why* they want something, ask an open question first without steering option menus (`ask_question` with concrete choices is used once intent/"why" is known and a named fork exists). Process steps (where files go, doing recon, writing docs) are agent calls stated as proposals rather than questions. Separate **outcome-talk** from **how-talk**: if the user only described desired outcomes, any implementation/`how` choices proposed by the agent must be tagged `[adopted-default]` (never `[from-user]`). Capture explicit **anti-goals** (*"what would make this a failure even if it technically works"*) alongside `Non-goals`, and play back multi-part design understanding in incremental 200–300 word chunks. When nothing material is open on the first turn, present a short design/spec for approval immediately.
- When ambiguity depends on current external best practices or version-aware behavior, use `$deep-research --quick` before crystallizing.
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
Use Antigravity's `ask_question` tool for every interview round.

- **No-Questions Override**: do not call `ask_question` or ask the user when they have explicitly said not to (`"don't ask"`, `"no questions"`, `"do not ask me"`, `"hands-off"`). Instead, adopt best-practice defaults, record them as `[adopted-default]`, and crystallize the spec directly.
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
    "profile": "quick|standard|deep|ideate|autoresearch",
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

4. Announce the kickoff with profile, threshold, and current ambiguity, and surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` once so the user can monitor the live `Interview` tab (ambiguity gauge, dimension bars, and readiness gates) in the Auxiliary Pane.

## Phase 2: Socratic interview loop

Repeat until: ambiguity `<= threshold` and the readiness gates pass, the user exits with a warning, or max rounds are reached. Below threshold, do not open a new ordinary branch. Read [scoring-and-templates.md](./references/scoring-and-templates.md) for the full stage-priority ladder, ledgers, challenge modes, and spec templates.

### 2a) Generate the next question
If oversized context has no recorded summary, the only allowed question is the summary request.

Target the lowest-scoring dimension, respecting stage priority (**Stage 1**: Intent, Outcome, Scope, Non-goals, Decision Boundaries -> **Stage 2**: Constraints, Success Criteria -> **Stage 3**: Context Clarity for brownfield). Apply the 6-step follow-up pressure ladder and maintain the **Breadth Ledger** and brownfield **Docs/Terminology Ledger** defined in [scoring-and-templates.md](./references/scoring-and-templates.md). `Non-goals` and `Decision Boundaries` are mandatory readiness gates.

### 2b) Ask the question
Use `ask_question` as described in `<Asking_Questions>`.

### 2c) Score ambiguity
Score each dimension in `[0.0, 1.0]` with a justification and gap:
- Greenfield: `ambiguity = 1 - (intent×0.30 + outcome×0.25 + scope×0.20 + constraints×0.15 + success×0.10)`
- Brownfield: `ambiguity = 1 - (intent×0.25 + outcome×0.20 + scope×0.20 + constraints×0.15 + success×0.10 + context×0.10)`

Enforce all readiness gates (`Non-goals`, `Decision Boundaries`, pressure pass complete, practical closure audit, and zero-context `Builder Check` triage) and round controls (Dialectic Rhythm Guard after 3 consecutive non-user entries; early exit from round 4 with risk warning; hard cap at `max_rounds`) per [scoring-and-templates.md](./references/scoring-and-templates.md). If `ambiguity <= 0.10` and gates pass, crystallize immediately.

### 2d) Report progress & persist state
Show the weighted breakdown table, readiness-gate status, and next focus dimension. Append the round (question, answer, label, scores) to state and refresh `updated_at`.

## Phase 3: Challenge modes

Use each mode at most once when triggered (`Contrarian`, `Terminologist`, `Simplifier`, `Ontologist`; force `Ontologist` once if ambiguity stalls `±0.05` for 3 rounds) and record usage in `state.challenge_modes_used`. See [scoring-and-templates.md](./references/scoring-and-templates.md) for trigger rules.

## Phase 4: Crystallize artifacts

When threshold is met (or on early exit with a warning, or at the hard cap):

0. **Configurable Custom Quality Gates (`qualityGates["deep-interview"]`)**: after writing the spec in step 2, if `.omagy/config.json` defines `qualityGates["deep-interview"]` (strict no-op when absent/empty; reserved controller skills like `deep-interview`, `ralplan`, `code-review`, `ai-slop-cleaner` are rejected to prevent self-recursion), run each configured gate skill in an independent subagent (`Model: gate.model || "inherit"`). Any `blocking` gate returning `reject`/`iterate` requires revising the spec before step 3; `advisory` or `unavailable` gates are recorded without blocking.
1. Write the transcript summary to `.omagy/interviews/{slug}-{timestamp}.md`.
2. Write the execution-ready spec to `.omagy/specs/deep-interview-{slug}.md` following the 9-section template (including the **Affected User Ideal State & Gap Table**, `[adopted-default]` decision boundaries, and pressure/terminology audits) in [scoring-and-templates.md](./references/scoring-and-templates.md).
   - For **`--autoresearch`**, also generate `.omagy/specs/deep-interview-autoresearch-{slug}.md` (with the locked `## Fidelity` block: `as of`, `meaning check`, `source floor`, `derived numbers`) and the launch bundle under `.omagy/specs/autoresearch-{slug}/` (`mission.md`, `sandbox.md`, `result.json`), marking `launchReady: false` if placeholders or undecided fidelity fields remain, per [scoring-and-templates.md](./references/scoring-and-templates.md).
3. Standalone: write state `current_phase:"complete"`, `active:false`, `completed_at`. Inside Autopilot: set `handoff_artifacts.deep_interview` to the spec path and advance Autopilot to `ralplan`.

## Phase 5: Execution bridge

Present handoff options with `ask_question` (single-answer, recommended option first). The spec is the requirements source of truth. Preserve intent, non-goals, decision boundaries, acceptance criteria, terminology grounding, and residual-risk warnings across the handoff.

1. **`$ultragoal`** (default durable execution): input is the spec. Convert it into durable goals with sequential completion tracking. It skips requirements discovery.
2. **`$ralplan`** (recommended when architecture/test-shape review is still needed): treat the spec as requirements truth and do not repeat the interview. Output goes to `.omagy/plans/`.
3. **`$autopilot`**: planning plus execution from the clarified brief.
4. **`$team`**: coordinated parallel execution against the shared spec.
5. **Refine further**: continue the interview loop.

Context-sensitive goal-mode suggestions: `$deep-research --loop` for validator-gated research projects, `$performance-goal` for measurable optimization work.

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
