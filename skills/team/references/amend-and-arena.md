# Live DAG Amendment & Competing Worker Arena (`$team --amend` & `$team --arena`)

Reference playbook for [`skills/team/SKILL.md`](../SKILL.md). Use `--amend` to mutate an active team task board safely mid-flight without losing verified work, and `--arena` to run `N=2..3` competing `executor` lanes on a high-risk or high-ambiguity implementation slice before merging the strongest verified solution.

## 1. Live Mid-Flight DAG Amendment (`$team --amend`)

When new repository facts, upstream review findings, or user steering arrive mid-run, amend the board atomically in the **leader lane** instead of tearing down the team and restarting from scratch.

### Atomic Board Read-Modify-Write Contract
1. **Read current board state first**:
   - Read `.omagy/state/team/<team>/tasks.json` (and any per-task `.omagy/state/team/<team>/tasks/task-<id>.json` records when present) via `read_file` before any edit.
   - Inspect live worker liveness via `manage_subagents` (`Action: "list"`) so in-flight workers are distinguished from idle/completed ones.
2. **Preserve verified work via `fingerprint`**:
   - Recompute `fingerprint` (`title + owned_paths + acceptance + upstream fingerprints`) for every task on the board.
   - Any `"completed"` task whose `fingerprint` is unchanged stays `"completed"` with its existing `result` and `.omagy/evidence/task-<id>.json` receipt untouched.
   - If an amendment alters a `"completed"` task's `owned_paths`, `acceptance`, or upstream interface contract, never erase its audit trail: either mark it `"blocked"` (`result: "superseded-by:<newId>"`) or append a bounded delta task (`"<id>b"`, `depends_on: ["<id>"]`) carrying the new requirement.
3. **Idle/Pending vs In-Flight Steering Matrix**:

| Current Task State | Allowed `--amend` Action | Commit & Evidence Safety Rule |
| :--- | :--- | :--- |
| `pending` | Edit `title`, `role`, `model`, `owned_paths`, `acceptance`, `depends_on`, `requires_code_change` in `tasks.json` + `tasks/task-<id>.json` | Re-verify disjoint `owned_paths` across sibling wave tasks |
| `blocked` / `failed` | Narrow scope, split into smaller tasks, escalate `model` (`flash -> inherit -> pro`), or reset to `pending` (`worker: null`, `conversation_id: null`) | Preserve prior `.omagy/evidence/task-<id>*` diagnostics for context |
| `in_progress` (same `owned_paths`) | Send bounded steering via `send_message` to existing `conversation_id`; update `acceptance` + `updated_at` | Keep `worker` and `conversation_id` intact; require fresh verification post-steering |
| `in_progress` (scope invalidated / `owned_paths` reassigned) | Send `STOP & REPORT HEAD` via `send_message`, salvage `Workspace: "share"` commits + `.omagy/evidence/`, then retire worker | Run `--exclude` unmerged-commit guard (`skills/team/SKILL.md`) before killing or removing any worktree |

Bounded live-steering message template (`send_message` to an `in_progress` worker):
```text
TEAM <team> — AMEND TASK <id>
Updated Acceptance / Constraint:
- <exact delta requirement or interface signature update>
Owned Paths (unchanged): <owned_paths>
Instruction: Incorporate this update before final verification, re-run <verification command>, update .omagy/evidence/task-<id>.json with the new verified_head SHA, and report TASK <id> status.
```

4. **Mandatory Post-Amendment Board Validation**:
   Immediately after writing `.omagy/state/team/<team>/tasks.json` (and any `tasks/task-<id>.json` files), run:
   ```sh
   sh <plugin>/hooks/run.sh validate-team-tasks <cwd> <team> --json
   ```
   Confirm `ok: true` before dispatching or resuming any wave:
   - Zero duplicate task IDs or missing `depends_on` targets.
   - Zero DAG dependency cycles.
   - Explicit boolean `requires_code_change` on every task.
   - Zero phantom `in_progress` tasks missing `worker` or `conversation_id`.

## 2. High-Risk Slice Bake-Off (`$team --arena`)

Use `$team --arena` when a specific implementation slice carries high algorithmic, concurrency, parser, or refactoring risk and running `N=2..3` isolated `executor` implementations against one shared test contract is safer than betting on a single trajectory.

### Step 1: Lock the Shared Test & Invariant Contract
1. Commit or freeze the shared characterization/regression test contract and `owned_paths` on the leader's base commit (`BASE_SHA`).
2. Represent the arena slice in `.omagy/state/team/<team>/tasks.json` as `2..3` parallel candidate tasks (`"<id>-a"`, `"<id>-b"`, optional `"<id>-c"`) plus a read-only selection gate task `"<id>-select"` (`depends_on: ["<id>-a", "<id>-b"]`, `requires_code_change: false`):
   ```json
   [
     {
       "id": "2-a",
       "title": "Arena A: iterative ring-buffer scheduler",
       "role": "executor",
       "model": "inherit",
       "owned_paths": ["src/scheduler/**"],
       "acceptance": ["Passes npm test -- scheduler.spec.ts", "Zero external deps"],
       "requires_code_change": true,
       "depends_on": ["1"],
       "fingerprint": "arena-2-a",
       "status": "pending",
       "worker": null,
       "conversation_id": null,
       "result": null
     },
     {
       "id": "2-b",
       "title": "Arena B: min-heap priority queue scheduler",
       "role": "executor",
       "model": "inherit",
       "owned_paths": ["src/scheduler/**"],
       "acceptance": ["Passes npm test -- scheduler.spec.ts", "Zero external deps"],
       "requires_code_change": true,
       "depends_on": ["1"],
       "fingerprint": "arena-2-b",
       "status": "pending",
       "worker": null,
       "conversation_id": null,
       "result": null
     },
     {
       "id": "2-select",
       "title": "Select and verify winning scheduler candidate",
       "role": "critic",
       "model": "pro",
       "owned_paths": [],
       "acceptance": ["Independent verifier + critic verdict recorded"],
       "requires_code_change": false,
       "depends_on": ["2-a", "2-b"],
       "fingerprint": "arena-2-select",
       "status": "pending",
       "worker": null,
       "conversation_id": null,
       "result": null
     }
   ]
   ```
   *(Overlapping `owned_paths` across `2-a` and `2-b` are permitted strictly because each arena worker runs in its own isolated `Workspace: "share"` worktree branched from `BASE_SHA` and only one winner merges.)*
3. Run `sh <plugin>/hooks/run.sh validate-team-tasks <cwd> <team> --json` and confirm `ok: true`.

### Step 2: Parallel Candidate Execution (`Workspace: "share"`)
Launch the `N=2..3` `executor` subagents in one `invoke_subagent` batch (`Workspace: "share"`, `Model: "inherit"`):
- Assign each worker a distinct architectural/algorithmic directive while keeping `owned_paths`, `Acceptance`, and `Verification` identical.
- Require each worker to commit its verified slice on its worktree branch and write `.omagy/evidence/task-<id>-<a|b|c>.json` containing:
  - canonical `verdict` from `VERIFICATION_VERDICTS` (`unit-test-verified`, `enforcement-verified`, `live-ui-verified`, etc.),
  - `verified_head` (`7–40` hex commit SHA),
  - non-echo `verification` command entries (`result: "passed"`).

### Step 3: Independent `verifier` + `critic` Selection Gate
Never select a winner from worker prose summaries alone:
1. **Deterministic receipt & scope gate**:
   - Validate each candidate's `.omagy/evidence/task-<id>-*.json` (`read_file` or `sh <plugin>/hooks/run.sh verify-evidence <cwd> .omagy/evidence/task-<id>-<a>.json <team> <id>-a`).
   - Build per-candidate diff packages (`BASE_SHA..<verified_head>`) via `sh <plugin>/hooks/run.sh review-package <cwd> <BASE_SHA> <verified_head> .omagy/artifacts/team-arena-<team>-<id>/candidate-<a>.diff`.
   - Disqualify any candidate that failed tests, used `echo`/`true` verification stubs, omitted `verified_head`, or modified files outside `owned_paths`.
2. **Sequential `verifier` -> `critic` evaluation**:
   - Invoke `verifier` (`TypeName: "verifier"`) with a **Blind-Claim Packet** (`ARTIFACT` diff packages + `CONTRACT` acceptance criteria + raw command outputs, stripping executor self-assessments) to verify `VERIFICATION_VERDICTS` and probe silent edge cases.
   - Invoke `critic` (`TypeName: "critic"`) over surviving `verifier`-confirmed candidates to score correctness, boundary clarity, `Lean:` diff footprint, and reversibility (`cost_if_wrong`), returning `APPROVE <id-winner>` plus `Decision:` / `Rejected:` lines.

### Step 4: Clean Winner Integration & Runner-Up Diff Archival
1. **Archive evidence and runner-up diffs before cleanup**:
   - Copy all candidate `.omagy/evidence/task-<id>-*.json` receipts into the leader's `.omagy/evidence/`.
   - Persist runner-up `.diff` files and `.omagy/artifacts/team-arena-<team>-<id>/arena-selection.md` (`Decision:`, `Rejected:`, `verified_head` SHAs) under `.omagy/artifacts/` so rejected approaches stay inspectable without cluttering git history.
2. **Cherry-pick or fast-forward merge the winner**:
   - Inspect `git status --porcelain` (using `.trimEnd()`) in the leader workspace first; never overwrite active manual Git states (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_START`, `rebase-merge`, `rebase-apply`).
   - Merge (`git merge --ff-only <verified_head>`) or cherry-pick (`git cherry-pick <verified_head>`) the winning commit(s), check all 7 unmerged porcelain prefixes (`DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`), and re-run the verification command on the integrated leader `HEAD`.
3. **Update board & retire runner-up worktrees**:
   - Mark the winner and `"<id>-select"` `"completed"`, record `"arena-runner-up:archived"` on non-selected candidates, run `validate-team-tasks`, and clean up finished subagent worktrees only after confirming all commits/diffs are archived.
