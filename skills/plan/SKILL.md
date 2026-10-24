---
name: plan
description: "[oh-my-agy] Lightweight, evidence-backed planning with optional Socratic interview (--interview), direct mode (--direct), or critic review of an existing plan (--review). Use for 'plan this', 'let's plan', or scoping before implementation when a full deep-interview is unnecessary."
---

<Purpose>
Plan creates concise, actionable work plans. It auto-detects interview vs direct mode, supports `--interview` for Socratic clarification, and `--review` for evaluating an existing plan.
</Purpose>

<Use_When>
- Planning before implementation: "plan this", "let's plan".
- Requirements are vague and need scoping (use `--interview`).
- Reviewing an existing plan (`--review`).
</Use_When>

<Do_Not_Use_When>
- The user wants direct execution: do the scoped task directly. Use `$ultragoal` only for durable goals and `$team` for coordinated parallel work.
- A simple, focused fix with obvious scope: skip planning.
- Consensus review is required: use `$ralplan`.
</Do_Not_Use_When>

<Execution_Policy>
- **Explore Before Asking**: Always gather codebase facts (directly or via the `explore` subagent) before asking a single question or drafting a plan. Never ask the user for discoverable facts.
- **Intent Classification (`CLEAR` vs `UNCLEAR`, ported from OmO `ulw-plan`)**:
  - `CLEAR` intent (concrete target, specific feature/bug, or explicit `--interview`): ask only questions that survive the **Two-Filter + Owner-Decision Survival Gate** below, one question at a time via `ask_question`.
  - `UNCLEAR` intent (open-ended "make X better", "improve Y", "you decide", or `--direct` on a broad prompt): do NOT interrogate the user with open-ended questionnaires. Research codebase patterns and official best practices, adopt and announce concrete defaults (naming each default + a 1-line rationale in an `Adopted Defaults` section), and recommend `$ralplan` / `critic` review.
- **Two-Filter Question Gate + Owner-Decision Survival**:
  - **Filter 1 (Material Fork)**: Would the answer change the architecture, schema, or touched files?
  - **Filter 2 (Unresolvable by Repo/Docs)**: Can this be answered by inspecting the repo or official docs? If yes, inspect—do not ask.
  - **Owner-Decision Survival**: Ask the user ONLY when the surviving fork is irreversible, destructive, spend-bearing, or changes an external/public contract. For reversible engineering choices, pick the strongest repo-aligned default and state it in the plan.
- Plans must be evidence-backed: at least 80% of claims cite file/line, and at least 90% of acceptance criteria are testable.
- Right-size the steps to the scope. Save plans to `.omagy/plans/<slug>.md`.
- Standalone plan mode is a planning mode. While `.omagy/state/plan-state.json` is active, do not implement. Write state as `{"mode":"plan","active":true,"current_phase":"interview|drafting|review"}` and terminalize it when the plan is delivered.
</Execution_Policy>

<Steps>

### Mode selection
| Mode | Trigger | Behavior |
|------|---------|----------|
| Interview (`CLEAR`) | `--interview` or concrete request with an owner-decision fork | Explore first, then ask only surviving owner-decision forks (1 per turn) |
| Autonomous Default (`UNCLEAR`) | Open-ended ("improve X", "you decide") | Explore + research, adopt & announce best-practice defaults, generate plan |
| Direct | `--direct` or fully specified request | Explore and generate the plan immediately |
| Review | `--review` | Critic evaluation of an existing plan |

### Interview (`--interview` / `CLEAR` with owner-decision forks)
1. Gather codebase facts (directly or via the `explore` subagent).
2. Run candidate questions through the **Two-Filter + Owner-Decision Survival Gate**. Ask one surviving question per `ask_question` call, informed by repo facts. Put the recommended option first with `(Recommended)`.
3. Build on the answers. Optionally invoke the `analyst` subagent to surface hidden requirements.
4. Create the plan when owner-decision forks are resolved or the user signals readiness.

### Direct / Autonomous Default (`--direct` or `UNCLEAR`)
1. Gather codebase facts and (for `UNCLEAR`) best-practice evidence.
2. Record any reversible choices under `Adopted Defaults` (`Decision | Default Chosen | 1-Line Rationale | Reversibility`).
3. Generate the plan immediately. Optional `critic` subagent review if requested or if intent was `UNCLEAR`.

### Review (`--review`)
1. Read the plan from `.omagy/plans/` (or the given path).
2. Evaluate it via the `critic` subagent. Verdict: APPROVED / REVISE / REJECT.
3. If the plan's author is the current lane, the critic subagent provides the independent review. Never self-approve.

### Output
Every plan includes:
1. **Requirements Summary & Adopted Defaults** (if any).
2. **Affected User Ideal State & Gap Table**:
   | Dimension | Current State | Ideal State | Gap | Approach | Verification Metric |
   |-----------|---------------|-------------|-----|----------|---------------------|
3. **Acceptance Criteria** (90%+ concretely testable).
4. **Implementation Steps** (with `file:line` refs, adaptive count, and `LIGHT` vs `HEAVY` rigor tag per step).
5. **Risks/Mitigations & Verification Commands**.
Save it to `.omagy/plans/`.

Use outcome-first framing and concise visible updates. Newer user updates override the active branch locally. If the user says `continue`, continue the current branch instead of restarting.

</Steps>

<Escalation_And_Stop_Conditions>
- Stop interviewing when requirements are clear. Do not over-interview.
- Escalate irreconcilable trade-offs that need a business decision.
- "just do it" / "skip planning": terminalize plan state and hand off to direct execution or `$ultragoal`.
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Acceptance criteria are testable (90%+ concrete).
- [ ] Claims cite file/line (80%+).
- [ ] Risks have mitigations; no vague terms.
- [ ] Plan saved to `.omagy/plans/` and plan state terminal.
</Final_Checklist>

<Advanced>
## Question classification
| Type | Example | Action |
|------|---------|--------|
| Codebase fact | "Where is X?" | Explore first; do not ask |
| User preference | "Priority?" | Ask via `ask_question` |
| Scope decision | "Include Y?" | Ask the user |

## Review quality criteria
| Criterion | Standard |
|-----------|----------|
| Clarity | 80%+ claims cite file/line |
| Testability | 90%+ criteria concrete |
| Verification | File refs exist |
</Advanced>
