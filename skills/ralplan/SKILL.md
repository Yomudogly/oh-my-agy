---
name: ralplan
description: "[oh-my-agy] Multi-agent consensus planning with independent architectural and critic review (plus --hyperplan 5-persona hostile cross-critique), or lightweight evidence-backed single-lane planning (--light, --interview, --review) when full consensus review is unnecessary. Use for $ralplan, 'plan this', 'let's plan', lightweight feature scoping, reviewing an existing plan, high-stakes architectural plans, or the Autopilot planning stage. Flags: --light, --interview, --review, --interactive, --deliberate, --hyperplan, --advisory."
---

# Ralplan (Consensus & Lightweight Planning)

Ralplan owns both **multi-agent consensus planning** (the stage Autopilot runs between `$deep-interview` and `$ultragoal` driving Planner, Architect, and Critic review with **RALPLAN-DR structured deliberation**) and **lightweight single-lane planning** (`--light`, `--interview`, `--review`) for bounded features when full consensus review is unnecessary. Review evidence is local lifecycle evidence, not a security authority. Once the plan and sequential approvals are durable, progression to Ultragoal must stay reachable, and cancel/recovery must never be blocked.

## Usage

```text
$ralplan "task description"
$ralplan --light "task description"
$ralplan --interview "task description"
$ralplan --review ".omagy/plans/plan-<slug>.md"
$ralplan --interactive "task description"
$ralplan --deliberate "task description"
$ralplan --migrate "task description"
$ralplan --hyperplan "task description"
$ralplan --advisory "task description"
```

## Flags

- `--light`: lightweight, explore-first single-lane planning without the multi-agent Architect + Critic consensus loop. Standalone `--light` writes `.omagy/state/plan-state.json` (`{"mode":"plan","active":true,"current_phase":"interview|drafting|review"}`) so the planning write guard stays active while drafting, applies Intent Classification (`CLEAR` vs `UNCLEAR` autonomous defaults with `Adopted Defaults`), the **Two-Filter + Owner-Decision Survival Gate** (open "why" first; process steps as proposals), and the **4-Item Brief Sharpener (`sharpen`)** (`consumer`, `cheapest done-check`, `non-goals`, `outside verification check`), saves `.omagy/plans/plan-<slug>.md` (`>= 80%` claims citing `file:line`, `>= 90%` testable acceptance criteria, `Affected User Ideal State & Gap Table`, `Review Focus (Top 5 Silent Edge Cases)`, `Interfaces: Consumes / Produces`), and terminalizes `plan-state.json` on delivery (or transitions to direct execution if the user says `"just do it"` / `"skip planning"`).
- `--interview`: lightweight Socratic scoping before planning — gather repo facts first (`explore` or direct reads), then ask one surviving owner-decision fork per turn via `ask_question` (`(Recommended)` option first) before generating the plan in `.omagy/plans/`.
- `--review`: evaluate an existing plan in `.omagy/plans/` (or a specified path) via an independent `critic` subagent (`APPROVE` / `ITERATE` / `REJECT`; never self-approve; report the gap if an independent lane is unavailable).
- `--interactive`: pause at key decision points (draft review in step 2, final approval in step 6) using `ask_question`. Without it, the Planner -> Architect -> Critic loop runs fully automated.
- `--deliberate`: force deliberate mode. It adds a pre-mortem (3 scenarios) and an expanded test plan (unit/integration/e2e/observability). Deliberate mode also turns on automatically when the request signals high risk: auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage.
- `--migrate`: safe legacy, database schema, API, or SDK migration planning — follow [references/migration-and-ears.md](references/migration-and-ears.md). Enforces the 4-stage Strangler sequence (`(1) Characterization Tests` -> `(2) Strangler Adapter / Expand-Only Seam` -> `(3) Dual-Run / Shadow Parity & Instant Rollback Switch` -> `(4) Cutover & Legacy Decommission`), EARS (`THE` / `WHEN` / `WHILE` / `IF-THEN` / `WHERE`) acceptance criteria, and deliberate pre-mortem review.
- `--hyperplan`: run a 2-round, 5-persona hostile cross-critique tournament before the Planner drafts the PRD:
  - **Round 1 (Independent Analysis)**: dispatch parallel read-only subagents across 5 adversarial lenses:
    1. `skeptic` (`architect` or `research` subagent): attacks accidental complexity, speculative abstractions, and YAGNI violations.
    2. `validator` (`test-engineer` or `verifier` subagent): attacks edge-case blast radius, data loss vectors, and untestable assumptions.
    3. `researcher` (`researcher` subagent): attacks uncited API/version claims and stale training-weight assumptions.
    4. `architect` (`architect` subagent): attacks coupling, state ownership, and boundary leaks.
    5. `creative` (`planner` subagent): proposes lateral inversions that achieve 80%+ of the outcome with a fraction of the moving parts.
  - **Round 2 (Cross-Attack & Survival Distillation)**: evaluate each persona's Round 1 claims against the others, tagging every major design proposal as `SURVIVES`, `WEAKENED (with required mitigation)`, or `KILLED (with reason)` in `.omagy/plans/hyperplan-distillation-{slug}.md`. Feed only `SURVIVES` and mitigated `WEAKENED` proposals into Step 1 (`Planner`).
- `--advisory`: standalone only. It runs the same review lifecycle and returns the reviewed plan, but never authorizes execution. Terminal state records `consensus_gate.complete:false` and `execution_handoff.authorized:false` explicitly. A later explicit execution request from the user is needed before any implementation. It cannot be combined with Autopilot, Ultragoal, or Team.

## Pre-context intake

Before consensus planning:
1. Derive a task slug. Reuse the latest `.omagy/context/{slug}-*.md` if one exists.
2. Otherwise create `.omagy/context/{slug}-{YYYYMMDDTHHMMSSZ}.md` with task statement, desired outcome, known facts/evidence, constraints, unknowns, and likely touchpoints.
3. If a deep-interview spec exists (`.omagy/specs/deep-interview-{slug}.md`), treat it as the requirements source of truth and do not re-interview.
4. If ambiguity is still high, gather brownfield facts first (directly or via the `explore` subagent), then run `$deep-interview --quick`.
5. If the plan depends on official docs, version-aware guidance, or external dependency behavior, run `$deep-research --quick` (delegating to the `researcher` subagent) before finalizing.
6. Treat an approved prior `$deep-research --loop` artifact (`.omagy/specs/autoresearch-<slug>/`) as evidence. Do not make ongoing research automation a runtime component unless the user asked for it.

## State

Standalone consensus mode: write `.omagy/state/ralplan-state.json` (`mode:"ralplan"`, `active:true`, `current_phase` in `planner|user-feedback|architect-review|critic-review|revise|handoff|complete`, `iteration`, `updated_at`). Standalone lightweight mode (`--light` / `--interview` / `--review`): write `.omagy/state/plan-state.json` (`mode:"plan"`, `active:true`, `current_phase` in `interview|drafting|review`) and terminalize it when the plan or review is delivered. Inside Autopilot, store the consensus fields under `state.ralplan` in `autopilot-state.json` instead, and keep Autopilot's `current_phase:"ralplan"`.

## Consensus workflow

1. **Planner** writes an adaptive plan, right-sized to scope (do not default to exactly five steps), plus a compact **RALPLAN-DR summary**:
   - Principles (3-5)
   - Decision Drivers (top 3)
   - Viable Options (>= 2) with bounded pros/cons, or an explicit invalidation rationale when only one survives
   - Deliberate mode only: pre-mortem (3 scenarios) and an expanded test plan
   - **Global Constraints**: verbatim spec/architectural invariants carried into every task and reviewer dispatch.
   - **Review Focus (Top 5 Silent Edge Cases)**: the 5 input classes or failure modes the spec is silent on that would bite a real user, each wired to an owning task's test step.
   - **Per-Task `Interfaces: Consumes / Produces`, EARS Criteria & `Proportion` Check**: explicit input/output signatures and EARS (`THE`/`WHEN`/`WHILE`/`IF-THEN`/`WHERE`; see [references/migration-and-ears.md](references/migration-and-ears.md)) acceptance criteria per goal/task without fake calendar/effort promises, keeping task bodies proportional (signatures + assertions, never full-file code transcripts longer than the spec).
   - **Blind-Claim `AdversarialVerify` Contract**: specify in `.omagy/plans/test-spec-{slug}.md` that downstream heavy-rigor `AdversarialVerify` (`verifier`) receives only `ARTIFACT` (diff / `review-package` path / touched file paths) + `CONTRACT` (acceptance criteria / invariants) + raw command exit codes, stripping persuasive executor narrative summaries (`CLAIM` rationales).

   The main lane may author the plan for standalone runs. For complex Autopilot planning, invoke the `planner` subagent. Save `.omagy/plans/prd-{slug}.md` and `.omagy/plans/test-spec-{slug}.md`.
2. **User feedback** (`--interactive` only): present the draft plus Principles/Drivers/Options with `ask_question` (`Proceed to review` / `Request changes` / `Skip review`). Otherwise proceed automatically.
3. **Architect review**: `invoke_subagent` with `TypeName: "architect"`. Pass a **Blind-Claim Review Packet** containing `ARTIFACT` (PRD/test-spec paths and context snapshot path), `CONTRACT` (raw user task statement and verbatim spec invariants), and raw prior gate outputs—stripping persuasive planner self-praise or narrative rationalizations outside the plan files. The architect must give the strongest steelman antithesis, at least one real tradeoff tension, and a synthesis when possible. In deliberate mode it flags principle violations. **Wait for the result before step 4.**
4. **Critic review**: only after the Architect returns, `invoke_subagent` with `TypeName: "critic"`. Pass the same Blind-Claim Review Packet (`ARTIFACT` + `CONTRACT`) plus the completed raw Architect review. The Critic enforces principle-option consistency, fair alternatives, clear risk mitigation, testable acceptance criteria, and concrete verification. In deliberate mode it rejects a missing or weak pre-mortem or test plan. Verdict: `APPROVE` | `ITERATE` | `REJECT`.
4b. **Configurable Custom Quality Gates (`qualityGates.ralplan`)**:
    - If `.omagy/config.json` has no `qualityGates.ralplan` entries, skip this step completely (strict no-op; emit no gate table).
    - When configured after Critic approval (entries normalized via `sh <plugin>/hooks/run.sh quality-gates <workspace> ralplan` or by reading `.omagy/config.json`: `"<skill>"` defaults to `mode: "blocking"`, `model: "inherit"`), reject any reserved workflow-controller skill (`ralplan`, `deep-interview`, `code-review`, `ai-slop-cleaner`, `autopilot`, `ultragoal`, `team`) to prevent self-recursion, and invoke each configured gate skill in a fresh independent subagent (`Model: gate.model`, never reusing the `architect` or `critic` conversation ID).
    - Record all gate results in `.omagy/plans/ralplan-review-{slug}.md`. `advisory` gates never block completion. Any `blocking` gate returning `iterate` or `reject` sets `ralplan_consensus_gate.complete: false` (`blocked_reason: "quality_gate_not_approved:<skill>"`) and feeds into Step 5's re-review loop.
5. **Re-review loop, 4-Tier `RECONCILE` & `Doubt/Review Theater` Circuit Breaker** (max 5 iterations):
   - **4-Tier `RECONCILE` Precedence**: before revising on any non-`APPROVE` verdict, classify every Architect, Critic, `--hyperplan`, or custom quality-gate finding in strict precedence order and record the disposition in `.omagy/plans/ralplan-review-{slug}.md`:
     1. `(1) Contract gap` — spec/plan ambiguity or contradictory requirement exposed -> escalate to the user or amend the source spec/constraints rather than guessing.
     2. `(2) Actionable defect` — proven architectural flaw, unhandled failure mode, signature mismatch, or untestable criterion -> `needs-fix`; Planner revises the plan, then re-runs `Architect -> Critic -> Custom Quality Gates`.
     3. `(3) Explicit Ruling` — bounded non-defect tradeoff where alternatives carry higher cost/complexity -> record `Ruling: <decision> — <why> — <cost_if_wrong>` in `.omagy/plans/ralplan-review-{slug}.md` and the PRD instead of churning architecture across rounds.
     4. `(4) Context noise` — false positive disproved by repository `file:line` or official documentation -> dismiss with concrete `file:line` or doc citation.
   - **`Doubt/Review Theater` Circuit Breaker**: if `>= 2` consecutive consensus review or downstream verification cycles return prose critiques ("substantive findings") with `0` actionable defects passing Tier 1–2, halt automated re-spinning immediately—either approve/checkpoint via an explicit Tier 3 `Ruling:` (with `cost_if_wrong`, passing the cited `RECONCILE` rulings once if needed to satisfy a pending Critic/gate verdict) or escalate directly to the user rather than burning remaining iterations up to 5. After 5 iterations without approval, present the best version and the outstanding objections to the user.
6. **On approval**, persist **both** `.omagy/plans/ralplan-review-{slug}.md` (human/HUD review log: Architect review, Critic review, verdicts, `RECONCILE` rulings, iteration) **and** `.omagy/plans/ralplan-review-{slug}.json` via `sh <plugin>/hooks/run.sh plan-hash compute .omagy/plans/prd-{slug}.md --spec .omagy/plans/test-spec-{slug}.md --write-receipt APPROVE --json` (enforcing the deterministic fake-timeline lint and binding `plan_hash` cryptographically to the approved PRD + test spec; see [references/migration-and-ears.md](references/migration-and-ears.md)). Surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` once so the user can inspect the `Reviews` tab in the Auxiliary Pane. Standalone interactive: ask which execution lane to use next. Inside Autopilot: the explicit `$autopilot` request authorizes the supervised transition to `$ultragoal`.
7. **Record the handoff** (in ralplan state or under Autopilot `handoff_artifacts.ralplan`):
   ```json
   {
     "planning_artifacts": [".omagy/plans/prd-<slug>.md", ".omagy/plans/test-spec-<slug>.md"],
     "ralplan_architect_review": {"verdict": "approve", "path": ".omagy/plans/ralplan-review-<slug>.md"},
     "ralplan_critic_review": {"verdict": "APPROVE", "path": ".omagy/plans/ralplan-review-<slug>.md"},
     "ralplan_receipt": ".omagy/plans/ralplan-review-<slug>.json",
     "ralplan_consensus_gate": {"complete": true},
     "ralplan_execution_handoff": {"authorized": true, "reason": "<rationale>", "authorized_at": "<ISO>", "review_cycle": 1, "source": "autopilot|user"}
   }
   ```
   `source:"autopilot"` is valid only inside an active Autopilot run whose phase is `ralplan`. Standalone runs use `source:"user"`, and only after the user picks an execution lane.
8. **Transition** to `$ultragoal` (or the chosen lane) only after the plan, the sequential approvals, and the handoff record exist. Do not implement inside Ralplan.

> **Important:** steps 3 and 4 MUST run sequentially as separate subagents. Never put Architect and Critic in the same parallel batch. Never ask the Architect to also act as Critic. Never role-play either lane in the main lane. If a role agent is unavailable, use the `self` subagent with the role's `agents/<role>.md` body as the prompt preamble. If no independent lane can run at all, report `independent review unavailable` and stop at `critic-review` rather than approving.

## Planning/execution boundary

Ralplan is a planning mode. While it is active and no execution handoff exists, implementation writes are out of scope. Ralplan may inspect the repository and write only planning artifacts under `.omagy/context/`, `.omagy/plans/`, `.omagy/specs/`, and `.omagy/state/`. (The optional `oh-my-agy-planning-guard` hook can enforce this boundary.)

Existing `prd-*.md` / `test-spec-*.md` files alone are never consensus evidence and never permission to skip Ralplan. A conversational "just do it" does not replace the review evidence. Offer `$cancel` + direct execution if the user wants to abandon planning.

## Goal-mode follow-ups

When the handoff permits execution, suggest the following, recording the chosen lane in the handoff:
- `$ultragoal`: the default durable goal-mode follow-up.
- `$team`: coordinated parallel implementation, with Ultragoal owning the ledger.
- `$deep-research --loop`: when the plan centers on a research question with an evaluator.
- `$performance-goal`: when the plan centers on measurable performance.

For team-worthy plans, include explicit staffing: lanes, role per lane (`executor`, `test-engineer`, `designer`, ...), owned files per lane, and verification responsibilities.

## Scenario examples

**Good:** the user says `continue` after the workflow already has a clear next step. Continue the current branch instead of restarting.
**Good:** the user changes only the delivery step (e.g. `make a PR`). Keep the earlier constraints and apply the update locally.
**Bad:** the user says `continue`, and the workflow restarts discovery or stops before gathering the missing review evidence.
