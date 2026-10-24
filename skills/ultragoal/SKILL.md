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
      "rigor": "light|heavy",
      "acceptance": ["<testable criterion>"],
      "status": "pending|in_progress|complete|blocked|failed|superseded",
      "depends_on": [],
      "product_failures": 0,
      "evidence": null
    }
  ]
}
```

**Goal rigor classification (`rigor`, ported from OmO `ulw-execute`)**:
- `"light"`: narrow change inside an existing module/pattern with no schema, auth, security, or public API contract change. Verified by targeted tests + acceptance check.
- `"heavy"`: cross-cutting change, new boundary/schema/auth/security surface, or state machine change. Requires targeted tests + at least 1 adversarial probe + independent `verifier` (`AdversarialVerify`) check before checkpointing.

Ledger entry shape (append; never rewrite earlier lines):
```json
{"at":"<ISO>","goal_id":"G1","event":"created|started|checkpoint|blocked|failed|steer|review-blockers|final-gate","status":"<status>","evidence":"<commands + exit codes / file refs>","note":"<optional>"}
```

Append a ledger line using the crash-resilient newline-isolated hook helper (`sh <plugin>/hooks/run.sh append-jsonl .omagy/ultragoal/ledger.jsonl '<json>'`, which prepends `\n` if a prior crash left a torn tail and refuses symlinks, ported from OMX 0.21.33 PR #3893), or by reading the file and writing it back with the new line added on its own newline. Read the ledger tolerantly (`sh <plugin>/hooks/run.sh read-jsonl .omagy/ultragoal/ledger.jsonl` or line-by-line JSON parsing that skips malformed torn lines).

## Operational steps: create

1. Read the brief: the deep-interview spec, ralplan PRD/test-spec, or the user's inline brief. Copy it or point to it from `brief.md`.
2. Decompose it into right-sized, independently verifiable goals with testable acceptance criteria and explicit dependencies. Carry spec non-goals, decision boundaries, and invariants into `goals.json`.
3. Write `goals.json`, append `created` ledger entries, and show the user a compact goal table.
4. Standalone: write `.omagy/state/ultragoal-state.json` (`mode:"ultragoal"`, `active:true`, `current_phase:"planning"`). Inside Autopilot: keep the Autopilot state and set its `current_phase:"ultragoal"`.

## Operational steps: execute

Repeat until every goal is `complete` (or `superseded`):

1. Pick the first `pending` goal whose dependencies are complete. Set it `in_progress`, append `started`, and set the phase to `executing`.
2. Implement the goal: solo, or via an `executor` subagent for a bounded slice, or via `$team` when parallel lanes are justified.
3. Audit the goal against real artifacts (`current_phase:"verifying"`):
   - For `"rigor": "light"`, run targeted tests and acceptance checks directly.
   - For `"rigor": "heavy"`, form a `DoneClaim` (changed files, commands + exit codes, criterion mapping) and validate it (via the `verifier` subagent when independent confirmation is warranted) using the `AdversarialVerify` contract:
     - `verdict`: `"confirmed" | "false-positive" | "needs-fix" | "needs-human-review"`
     - `failure_class`: `"none" | "product" | "harness"`
4. Checkpoint: when `verdict` is `"confirmed"` (or `"light"` checks pass), set the goal `status:"complete"` with `evidence`, then append a `checkpoint` ledger line containing commands and exit codes. Refresh `updated_at` in state.
5. **Failure triage (`product` vs `harness`) & blocked-goal cascade**:
   - If verification fails with `failure_class: "harness"` (test runner setup, missing fixture, port/env glitch), run up to 1 bounded harness-repair attempt without incrementing `product_failures`.
   - If verification fails with `failure_class: "product"`, increment `product_failures` (max 3 attempts per goal). After 3 product failures or `"needs-human-review"`, set the goal `status:"blocked"` (`[~]`), append `blocked` to the ledger, and **cascade `status:"blocked"`** (`note:"blocked-by:<goal_id>"`) to every downstream `pending` goal whose `depends_on` transitively includes this goal. Continue with remaining independent `pending` goals; if none remain and user input is required, write state `current_phase:"blocked"`, `active:false`, and ask.

## Explicit steering & stale-goal reconciliation

- **Stale-Goal Reconciliation (on start/resume)**: Before executing a `pending` goal, run observable repo checks (`fileExists`, `fileContains`, `gitGrep`) against its target paths. If the repository already satisfies a goal's acceptance criteria from earlier work, verify with targeted tests and record a `checkpoint` with `note:"reconciled-from-repo"` instead of re-implementing.
- **Explicit Steering**: Change the decomposition only with evidence. Append a `steer` ledger entry with `kind`, `evidence`, and `rationale`, then edit `goals.json` accordingly. Supported kinds: `add_subgoal`, `split_subgoal`, `reorder_pending`, `revise_pending_wording`, `amend_criterion`, `annotate_ledger`, `mark_blocked_superseded`. Never silently delete goals. Mark them `superseded` instead.
- **Criterion Amendment Audit Trail**: When a goal's acceptance criterion must be adjusted due to newly discovered repo facts, append a `steer` (`kind:"amend_criterion"`) ledger entry recording `previous_criterion`, `amended_criterion`, and `evidence` so requirements changes remain auditable. Ordinary prose does not mutate the plan.

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
