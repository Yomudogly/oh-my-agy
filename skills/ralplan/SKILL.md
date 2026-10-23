---
name: ralplan
description: "[oh-my-agy] Consensus planning: Planner -> Architect -> Critic subagent review loop producing an execution-ready plan and a bound handoff to $ultragoal. Use for $ralplan, for high-stakes plans that need architectural review, or as the Autopilot planning stage. Flags: --interactive, --deliberate, --advisory."
---

# Ralplan (Consensus Planning)

Ralplan is the consensus-planning stage that Autopilot runs between `$deep-interview` and `$ultragoal`. It drives Planner, Architect, and Critic review with **RALPLAN-DR structured deliberation**: short mode by default, deliberate mode for high-risk work. Review evidence is local lifecycle evidence, not a security authority. Once the plan and sequential approvals are durable, progression to Ultragoal must stay reachable, and cancel/recovery must never be blocked.

## Usage

```text
$ralplan "task description"
$ralplan --interactive "task description"
$ralplan --deliberate "task description"
$ralplan --advisory "task description"
```

## Flags

- `--interactive`: pause at key decision points (draft review in step 2, final approval in step 6) using `ask_question`. Without it, the Planner -> Architect -> Critic loop runs fully automated.
- `--deliberate`: force deliberate mode. It adds a pre-mortem (3 scenarios) and an expanded test plan (unit/integration/e2e/observability). Deliberate mode also turns on automatically when the request signals high risk: auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage.
- `--advisory`: standalone only. It runs the same review lifecycle and returns the reviewed plan, but never authorizes execution. Terminal state records `consensus_gate.complete:false` and `execution_handoff.authorized:false` explicitly. A later explicit execution request from the user is needed before any implementation. It cannot be combined with Autopilot, Ultragoal, or Team.

## Pre-context intake

Before consensus planning:
1. Derive a task slug. Reuse the latest `.omagy/context/{slug}-*.md` if one exists.
2. Otherwise create `.omagy/context/{slug}-{YYYYMMDDTHHMMSSZ}.md` with task statement, desired outcome, known facts/evidence, constraints, unknowns, and likely touchpoints.
3. If a deep-interview spec exists (`.omagy/specs/deep-interview-{slug}.md`), treat it as the requirements source of truth and do not re-interview.
4. If ambiguity is still high, gather brownfield facts first (directly or via the `explore` subagent), then run `$deep-interview --quick`.
5. If the plan depends on official docs, version-aware guidance, or external dependency behavior, run `$best-practice-research` (delegating to the `researcher` subagent) before finalizing.
6. Treat an approved prior `$autoresearch` artifact as evidence. Do not make Autoresearch a runtime component unless the user asked for ongoing research automation.

## State

Standalone: write `.omagy/state/ralplan-state.json` (`mode:"ralplan"`, `active:true`, `current_phase` in `planner|user-feedback|architect-review|critic-review|revise|handoff|complete`, `iteration`, `updated_at`). Inside Autopilot, store the same fields under `state.ralplan` in `autopilot-state.json` instead, and keep Autopilot's `current_phase:"ralplan"`.

## Consensus workflow

1. **Planner** writes an adaptive plan, right-sized to scope (do not default to exactly five steps), plus a compact **RALPLAN-DR summary**:
   - Principles (3-5)
   - Decision Drivers (top 3)
   - Viable Options (>= 2) with bounded pros/cons, or an explicit invalidation rationale when only one survives
   - Deliberate mode only: pre-mortem (3 scenarios) and an expanded test plan

   The main lane may author the plan for standalone runs. For complex Autopilot planning, invoke the `planner` subagent. Save `.omagy/plans/prd-{slug}.md` and `.omagy/plans/test-spec-{slug}.md`.
2. **User feedback** (`--interactive` only): present the draft plus Principles/Drivers/Options with `ask_question` (`Proceed to review` / `Request changes` / `Skip review`). Otherwise proceed automatically.
3. **Architect review**: `invoke_subagent` with `TypeName: "architect"`. Pass the full task statement, context snapshot path, PRD/test-spec paths, and prior findings. The architect must give the strongest steelman antithesis, at least one real tradeoff tension, and a synthesis when possible. In deliberate mode it flags principle violations. **Wait for the result before step 4.**
4. **Critic review**: only after the Architect returns, `invoke_subagent` with `TypeName: "critic"`. Pass the same inputs plus the completed Architect review. The Critic enforces principle-option consistency, fair alternatives, clear risk mitigation, testable acceptance criteria, and concrete verification. In deliberate mode it rejects a missing or weak pre-mortem or test plan. Verdict: `APPROVE` | `ITERATE` | `REJECT`.
5. **Re-review loop** (max 5 iterations): any non-`APPROVE` verdict runs the full loop again: collect feedback -> Planner revises -> Architect -> Critic. After 5 iterations without approval, present the best version and the outstanding objections to the user.
6. **On approval**, persist review evidence to `.omagy/plans/ralplan-review-{slug}.md` (Architect review, Critic review, verdicts, iteration). Standalone interactive: ask which execution lane to use next. Inside Autopilot: the explicit `$autopilot` request authorizes the supervised transition to `$ultragoal`.
7. **Record the handoff** (in ralplan state or under Autopilot `handoff_artifacts.ralplan`):
   ```json
   {
     "planning_artifacts": [".omagy/plans/prd-<slug>.md", ".omagy/plans/test-spec-<slug>.md"],
     "ralplan_architect_review": {"verdict": "approve", "path": ".omagy/plans/ralplan-review-<slug>.md"},
     "ralplan_critic_review": {"verdict": "APPROVE", "path": ".omagy/plans/ralplan-review-<slug>.md"},
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
- `$autoresearch`: when the plan centers on a research question with an evaluator.
- `$performance-goal`: when the plan centers on measurable performance.

For team-worthy plans, include explicit staffing: lanes, role per lane (`executor`, `test-engineer`, `designer`, ...), owned files per lane, and verification responsibilities.

## Scenario examples

**Good:** the user says `continue` after the workflow already has a clear next step. Continue the current branch instead of restarting.
**Good:** the user changes only the delivery step (e.g. `make a PR`). Keep the earlier constraints and apply the update locally.
**Bad:** the user says `continue`, and the workflow restarts discovery or stops before gathering the missing review evidence.
