---
name: autopilot
description: "[oh-my-agy] Canonical autonomous orchestrator for hands-off delivery: supervised $deep-interview -> $ralplan -> $ultragoal chain with durable state and evidence-backed completion. Use when the user invokes $autopilot or asks for end-to-end autonomous delivery from an idea, issue, or requirements seed."
---

# Autopilot

<Purpose>
Autopilot is the canonical orchestrator for hands-off delivery. Its defining default chain is mandatory:

```text
$deep-interview -> $ralplan -> $ultragoal
```

The chain is not a list of optional hints, and Autopilot is not an alias for direct execution. Autopilot supervises each child stage in one recoverable session, carries durable artifacts forward, and continues through implementation verification until the requested outcome is complete or a genuine blocker is recorded.
</Purpose>

<Use_When>
- The user explicitly invokes `$autopilot`.
- The user asks for end-to-end autonomous delivery from an idea, issue, or requirements seed.
- The work needs requirements clarification, consensus planning, durable execution, and evidence-backed completion as one supervised workflow.
</Use_When>

<Default_Chain>
Run or resume these stages in order:

1. **`deep-interview`** clarifies intent, scope, non-goals, constraints, acceptance criteria, and unresolved decisions, and produces a durable spec at `.omagy/specs/deep-interview-<slug>.md`. It is a real stage. Do not replace it with a one-question check or skip it just because the task looks actionable.
2. **`ralplan`** turns the clarified requirements into an execution-ready consensus plan through Planner -> Architect -> Critic subagent review.
3. **`ultragoal`** executes the approved plan through durable goals, ledger receipts, focused verification, cleanup, review, and terminal evidence.

`$team`, `$code-review`, and `$ultraqa` may run inside the supervised execution when the active Ultragoal plan or verification boundary requires them. They do not replace or weaken the three-stage chain.

When review or QA proves the requirements or plan wrong, keep Autopilot active, set its phase back to `ralplan`, attach the findings, and continue through `ultragoal` again. Implementation-only review fixes may stay inside Ultragoal's blocker/review loop.
</Default_Chain>

<Execution_Policy>
- A new run MUST begin at `deep-interview` and MUST keep the phase order `deep-interview -> ralplan -> ultragoal`.
- Child stages are supervised phases, not peer workflow activations. Keep `mode:"autopilot"` active and update `current_phase`. Do not create standalone child state files for the stages Autopilot supervises (child skills write their artifacts but not their own `*-state.json` while Autopilot owns the run).
- Continue automatically through safe, reversible stage transitions. Stop only for an explicit user cancellation, a human-only dependency, or a verified terminal result.
- Deep-interview rounds use `ask_question`. That is expected user interaction and does not count as a stop.
- Authority-decreasing operations always stay available: `$cancel`, exact-mode state clear, and disabling the plugin hooks.
</Execution_Policy>

<State_Management>
Autopilot owns `.omagy/state/autopilot-state.json`. Start a new run by writing it with `write_to_file`:

```json
{
  "mode": "autopilot",
  "active": true,
  "current_phase": "deep-interview",
  "iteration": 1,
  "started_at": "<ISO>",
  "updated_at": "<ISO>",
  "state": {
    "task": "<user request>",
    "phase_cycle": ["deep-interview", "ralplan", "ultragoal"],
    "handoff_artifacts": { "deep_interview": null, "ralplan": null, "ultragoal": null, "code_review": null, "ultraqa": null },
    "return_to_ralplan_reason": null
  }
}
```

Refresh `updated_at` on every write. The oh-my-agy `Stop` hook uses it to tell real progress from a stall. It re-enters the loop at most twice without a state change.

Stage transitions:
- **`deep-interview -> ralplan`**: requires the spec path in `handoff_artifacts.deep_interview` and a non-empty completion rationale.
- **`ralplan -> ultragoal`**: requires durable planning artifacts, sequential Architect then Critic approvals, and a `ralplan_execution_handoff` with `source:"autopilot"` bound to this run's iteration. The explicit `$autopilot` request authorizes this supervised transition.
- **`ultragoal -> complete`**: requires every goal in `.omagy/ultragoal/goals.json` complete, ledger receipts, and fresh verification evidence matching the requested outcome.
- **review/QA loopback**: keep `active:true`, set `current_phase:"ralplan"`, increment `iteration`, and persist `return_to_ralplan_reason` with the findings.
- **completion**: write `active:false`, `current_phase:"complete"`, `completed_at`.
- **cancellation**: run `$cancel`. It preserves handoff artifacts for inspection or resume.
- **blocked on the user**: write `active:false`, `current_phase:"blocked"`, record the question in `state.blocker`, then ask.
</State_Management>

<Continuation_And_Resume>
When the user says `continue`, `resume`, or `keep going`, read `.omagy/state/autopilot-state.json` and continue from `current_phase`:
- `deep-interview`: resume clarification from the saved context snapshot and transcript.
- `ralplan`: resume consensus planning from the spec and any loopback findings.
- `ultragoal`: resume durable execution from `.omagy/ultragoal/goals.json` and the ledger.
- `blocked`: re-read the recorded blocker, apply the user's answer, set `active:true` and the prior phase, and continue.
- `complete`: report the terminal evidence. Do not restart.
- `cancelled` or `failed`: report the preserved artifacts. Start a new run only on a new explicit `$autopilot` request.

Never discard valid handoff artifacts or restart discovery just because the conversation resumed.
</Continuation_And_Resume>

<Final_Checklist>
- [ ] The run started at `deep-interview` and produced a durable spec.
- [ ] Ralplan produced an execution-ready plan with sequential Architect -> Critic approval evidence.
- [ ] Ultragoal completed every goal with ledger receipts.
- [ ] `$code-review` (independent lanes) and verification evidence cover the requested behavior, failure paths, and recovery paths.
- [ ] Autopilot state is terminal (`active:false`) and all artifacts are coherent.
</Final_Checklist>

<Examples>
<Good>
User: `$autopilot implement issue #42`
Flow: write autopilot state at `deep-interview`, interview with `ask_question` until the spec is ready, run supervised `ralplan` with architect and critic subagents, run supervised `ultragoal`, verify, run `$code-review`, and mark the state complete.
</Good>
<Good>
User: `continue`
Context: autopilot state has `current_phase:"ralplan"`.
Flow: resume planning from the existing spec. Do not start a separate standalone Ralplan run.
</Good>
<Bad>
Flow: treat `$deep-interview`, `$ralplan`, and `$ultragoal` as optional suggestions and jump directly to implementation.
Why bad: it hollows out Autopilot's defining orchestration contract.
</Bad>
</Examples>
