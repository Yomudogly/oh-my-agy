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
- Auto-detect interview vs direct. `--interview` forces Socratic mode and `--direct` skips it.
- Ask one question at a time with `ask_question`. Gather codebase facts first and never ask the user for discoverable facts.
- Plans must be evidence-backed: at least 80% of claims cite file/line, and at least 90% of acceptance criteria are testable.
- Right-size the steps to the scope. Save plans to `.omagy/plans/<slug>.md`.
- Standalone plan mode is a planning mode. While `.omagy/state/plan-state.json` is active, do not implement. Write state as `{"mode":"plan","active":true,"current_phase":"interview|drafting|review"}` and terminalize it when the plan is delivered.
</Execution_Policy>

<Steps>

### Mode selection
| Mode | Trigger | Behavior |
|------|---------|----------|
| Interview | `--interview` or broad request | Socratic requirements gathering |
| Direct | `--direct` or detailed request | Generate the plan immediately |
| Review | `--review` | Critic evaluation of an existing plan |

### Interview (`--interview`)
1. Classify the request. Gather codebase facts (directly or via the `explore` subagent).
2. Ask one focused question per `ask_question` call, informed by those facts. Put the recommended option first.
3. Build on the answers. Optionally invoke the `analyst` subagent to surface hidden requirements.
4. Create the plan when the user signals readiness or requirements are clear.

### Direct
1. Quick analysis (the `analyst` subagent is optional).
2. Generate the plan immediately.
3. Optional `critic` subagent review if requested.

### Review (`--review`)
1. Read the plan from `.omagy/plans/` (or the given path).
2. Evaluate it via the `critic` subagent. Verdict: APPROVED / REVISE / REJECT.
3. If the plan's author is the current lane, the critic subagent provides the independent review. Never self-approve.

### Output
Every plan includes: Requirements Summary, Acceptance Criteria (testable), Implementation Steps (with file refs, adaptive count), Risks/Mitigations, and Verification. Save it to `.omagy/plans/`.

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
