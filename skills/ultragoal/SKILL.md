---
name: ultragoal
description: "[oh-my-agy] Create and execute durable repo-native multi-goal plans with a goals.json + ledger.jsonl audit trail, sequential completion, review gates, and resume. Use for $ultragoal, 'create-goals', 'complete-goals', durable multi-goal execution, or the Autopilot execution stage."
---

# Ultragoal Workflow

## When to use

Use for `$ultragoal`, `create-goals`, `complete-goals`, durable multi-goal planning, or sequential execution of an approved plan/spec. Also used as Autopilot's execution stage.

Codex's hidden `/goal` state (`get_goal`/`create_goal`/`update_goal`) does not exist for agents in Antigravity. The **repo ledger is the single source of truth**. Antigravity's `/goal` slash command is user-triggered. You may suggest it for very long runs, but never depend on it.

## Durable artifacts (leader-owned)

- `.omagy/ultragoal/brief.md`: the source brief (spec or plan text, or a pointer to it).
- `.omagy/ultragoal/goals.json`: the plan.
- `.omagy/ultragoal/ledger.jsonl`: append-only audit trail, one JSON object per line.

`goals.json` schema:
```json
{
  "version": 1,
  "objective": "<one-line aggregate objective>",
  "source": ".omagy/specs/deep-interview-<slug>.md | .omagy/plans/prd-<slug>.md | inline",
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "invariants": ["<architecture/domain invariant that must hold at the end>"],
  "goals": [
    {
      "id": "G1",
      "title": "<short title>",
      "objective": "<verifiable objective>",
      "acceptance": ["<testable criterion>"],
      "status": "pending|in_progress|complete|blocked|failed|superseded",
      "depends_on": [],
      "evidence": null
    }
  ]
}
```

Ledger entry shape (append; never rewrite earlier lines):
```json
{"at":"<ISO>","goal_id":"G1","event":"created|started|checkpoint|blocked|failed|steer|review-blockers|final-gate","status":"<status>","evidence":"<commands + exit codes / file refs>","note":"<optional>"}
```

Append a ledger line by reading the file and writing it back with the new line added, or with `run_command` using a non-interpolating write (e.g. `printf '%s\n' '<json>' >> .omagy/ultragoal/ledger.jsonl`) when quoting is safe.

## Operational steps: create

1. Read the brief: the deep-interview spec, ralplan PRD/test-spec, or the user's inline brief. Copy it or point to it from `brief.md`.
2. Decompose it into right-sized, independently verifiable goals with testable acceptance criteria and explicit dependencies. Carry spec non-goals, decision boundaries, and invariants into `goals.json`.
3. Write `goals.json`, append `created` ledger entries, and show the user a compact goal table.
4. Standalone: write `.omagy/state/ultragoal-state.json` (`mode:"ultragoal"`, `active:true`, `current_phase:"planning"`). Inside Autopilot: keep the Autopilot state and set its `current_phase:"ultragoal"`.

## Operational steps: execute

Repeat until every goal is `complete` (or `superseded`):

1. Pick the first `pending` goal whose dependencies are complete. Set it `in_progress`, append `started`, and set the phase to `executing`.
2. Implement the goal: solo, or via an `executor` subagent for a bounded slice, or via `$team` when parallel lanes are justified.
3. Audit the goal against real artifacts: run its acceptance checks and targeted tests. Set the phase to `verifying`.
4. Checkpoint: set the goal `status:"complete"` with `evidence`, then append a `checkpoint` ledger line containing commands and exit codes. Refresh `updated_at` in state.
5. Blocked/failed goal: record `blocked|failed` with evidence. Continue with independent goals. Retry failed goals after the blocker is resolved. If the blocker needs the user, write the Ultragoal (or Autopilot) state as `current_phase:"blocked"`, `active:false`, and ask.

## Explicit steering

Change the decomposition only with evidence. Append a `steer` ledger entry with `kind`, `evidence`, and `rationale`, then edit `goals.json` accordingly. Supported kinds: `add_subgoal`, `split_subgoal`, `reorder_pending`, `revise_pending_wording`, `annotate_ledger`, `mark_blocked_superseded`. Never silently delete goals. Mark them `superseded` instead. Ordinary prose does not mutate the plan.

## Team bridge

For parallel story execution, run `$team` against the active goals. Team workers return task evidence only. The Ultragoal leader alone updates `goals.json` and the ledger.

## Final gate and exit evidence

Before final completion (phase `reviewing`):

1. Run targeted verification for every goal.
2. Run `$ai-slop-cleaner` on the changed files, then rerun verification.
3. Audit every invariant from `goals.json` and the brief/spec/steering against implementation, tests, and review evidence.
4. Run `$code-review` through independent `code-reviewer` and `architect` subagent lanes. If review or invariant proof is not clean, add a `Resolve final code-review blockers` goal with the findings, append `review-blockers`, and loop back to execution. Inside Autopilot, design-level findings return Autopilot to `ralplan`.
5. When clean: append a `final-gate` ledger entry with cleaner, verification, review, and invariant evidence. Standalone: write the state terminal (`active:false`, `current_phase:"complete"`, `completed_at`). Inside Autopilot: set `handoff_artifacts.ultragoal` and let Autopilot finish.

Report goal ids/statuses, ledger path, review verdicts, and any blocker. Never claim completion from state files alone. Completion requires the verification evidence in the ledger.

## Resume

On `continue`/`resume`, read `goals.json`, the tail of `ledger.jsonl`, and the state file, then resume from the first non-complete goal. Do not re-decompose an existing plan unless steering is justified.
