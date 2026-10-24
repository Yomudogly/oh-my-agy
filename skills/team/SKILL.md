---
name: team
description: "[oh-my-agy] N coordinated subagent workers on a shared, leader-owned task board, built on Antigravity invoke_subagent/send_message (replaces OMX's tmux team runtime). Use only for an explicit $team request when an approved plan benefits from parallel lanes, task-state tracking, or workspace isolation."
---

# Team Skill

## When to use

Use only for an explicit `$team` request (for example `$team 3:executor "implement X"`), or when an active `$ultragoal`/`$autopilot` plan calls for coordinated parallel lanes. Team is explicit and outside the default workflow. Ordinary work never silently becomes a team run.

OMX launched tmux panes of headless Codex processes with mailbox files. In Antigravity, workers are **subagents**:
- launch: `invoke_subagent` (several entries in one call run concurrently)
- coordinate: `send_message` to a worker's conversation ID
- monitor/stop: `manage_subagents` (`list`, `kill`)
- isolate: prefer `Workspace: "share"` (shared git object store with an independent branch, like `git worktree`) over `"branch"` (isolated clone deleted when the subagent is killed) whenever workers write overlapping areas or commit recovery matters.

## Inputs and preconditions

- Launch shape: `$team [N:role] "<task>"`. Default role is `team-worker`. Use `executor`, `test-engineer`, `designer`, etc. for specialized lanes. Max **6** concurrent workers.
- Ground the task first: reuse or create `.omagy/context/{slug}-*.md` (target, evidence, constraints, unknowns, touchpoints). Prefer an approved spec or plan (`.omagy/specs/`, `.omagy/plans/`).
- Do not launch nested teams. Workers never spawn subagents.
- **Work-Shape Model Routing (`Splittable` vs `Cohesive`, ported from OmO `ulw-execute` / categories)**:
  - **Splittable / Quick** (isolated single-file edits, mechanical renames, doc/config updates, targeted lookups): fan out across parallel workers with `Model: "flash"`.
  - **Cohesive / Deep** (multi-file feature slices, shared state/types, stateful debugging): keep together in a single worker with `Model: "inherit"` rather than splitting across workers that would fight over interfaces.
  - **Ultrabrain / Review & Architecture** (`architect`, `critic`, `tracer`, `security-reviewer`): use `Model: "pro"` (or `"inherit"` when the session already runs a frontier reasoning model).

## Task board & DAG wave scheduling (leader-owned)

`.omagy/state/team/<team>/tasks.json`:
```json
{
  "team": "<team>",
  "objective": "<task>",
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "tasks": [
    {"id": "1", "title": "...", "role": "team-worker", "model": "inherit|flash|pro", "owned_paths": ["src/auth/**"], "acceptance": ["..."],
     "requires_code_change": true, "depends_on": [], "fingerprint": "<sha1-or-short-hash-of-title+owned_paths+acceptance>",
     "status": "pending|in_progress|completed|failed|blocked", "worker": null, "conversation_id": null, "result": null}
  ]
}
```
Also write `.omagy/state/team-state.json` (`mode:"team"`, `active:true`, `current_phase:"executing"`, `state.team:"<team>"`).

**DAG Wave Scheduling & Fingerprint-Cached Amendment (ported from OmO `mass-ulw`)**:
- Tasks form an explicit DAG via `depends_on`. Launch ready waves (`status:"pending"` whose `depends_on` tasks are all `"completed"`), up to 6 concurrent workers per wave.
- If a task fails or blocks After retries, mark it `"blocked"` and cascade `"blocked"` (`result:"blocked-by:<id>"`) to downstream tasks whose `depends_on` transitively includes `<id>`, while continuing independent branches.
- When amending a team plan mid-run, recompute each task's `fingerprint` (`title + owned_paths + acceptance + upstream fingerprints`). Any `"completed"` task whose `fingerprint` is unchanged stays `"completed"` and its verified output is reused without re-running.

Only the leader edits the board. Workers report results in their final message, and the leader transitions status.

**`requires_code_change` default** (ported from OMX 0.21.33 task-evidence intent). Set it explicitly on every task:
- `false` when the task is analysis-only: its wording asks to analyze, audit, review, research, explain, compare, or summarize, or it explicitly says not to change code. A report or summary without a named output file also counts as analysis-only.
- `false` for read-only roles: `explore`, `researcher`, `analyst`, `architect`, `critic`, `code-reviewer`, `security-reviewer`, `verifier`, `vision`.
- `true` otherwise, for execution roles (`team-worker`, `executor`, `debugger`, `test-engineer`, `designer`) and any task that adds, fixes, changes, or writes a file.

## Operational steps

1. **Decompose** the task into independent tasks with **disjoint `owned_paths`** where possible, testable acceptance, and explicit dependencies. If two tasks must touch the same file, serialize them via `depends_on` or give them isolated workspaces.
2. **Write the board**, then **launch** the ready tasks in one `invoke_subagent` call (one entry per task, at most 6). Each worker prompt must be self-contained:
   ```text
   TEAM <team> — TASK <id>: <title>
   Objective: <objective>
   Owned paths (edit only these): <paths>
   Acceptance: <criteria>
   Context: <spec/plan/context paths>
   Verification: <exact commands>
   Constraints: do not edit .omagy/state/**, do not spawn subagents, report conflicts instead of editing outside scope.
   Evidence (when requires_code_change is true): write .omagy/evidence/task-<id>.json with {"team":"<team>","taskId":"<id>","summary":"...","verification":[{"command":"...","result":"passed","output":"..."}],"unverified":[]} and include EVIDENCE_RECORDED: .omagy/evidence/task-<id>.json on its own line.
   Report format: TASK <id>: COMPLETED|FAILED|BLOCKED / Changed files / Verification / EVIDENCE_RECORDED / Blockers
   ```
   Record each `conversation_id`, then set `status:"in_progress"`.
3. **Wait** for worker messages. Do not poll; the system wakes you when a worker reports. Optionally set a liveness `schedule` timer with `TimerCondition: "any"`.
4. **On each report**: for tasks with `requires_code_change: true`, validate `.omagy/evidence/task-<id>.json` with `read_file` (not the shell). Reject the report unless all of these hold:
   - the file is inside `<workspace>/.omagy/evidence/`, is not a symlink, and is valid JSON of at most 1 MiB;
   - `team` and `taskId` match this task;
   - `summary` is real text (not `TODO`/`TBD`/`placeholder`/`pending`/`not run`);
   - `verification` is a non-empty array whose every entry has a real `command`, `result: "passed"`, and a real `output`;
   - `unverified` is an array (empty, or listing checks that were not run).

   Then re-run the verification command for anything non-trivial, transition the task to `completed`/`failed`/`blocked` with `result`, and refresh `updated_at`. Launch newly unblocked tasks.
   (Optional scripted check: `sh <plugin>/hooks/run.sh verify-evidence <workspace> .omagy/evidence/task-<id>.json <team> <id>`. Antigravity's terminal sandbox may deny reading plugin files, in which case it needs `BypassSandbox: true`. The `read_file` check above is the default.)
5. **Blocked worker**: answer via `send_message` to the same conversation ID rather than spawning a replacement. For a stuck or looping worker, **preserve its work before killing** (since `manage_subagents kill` deletes `"branch"` workspaces): if it ran in `"share"` or `"branch"`, ask it once via `send_message` to commit/report its branch or salvage reachable commits in the leader lane before calling `manage_subagents kill` on that worker only, then set the task `pending` and relaunch with a sharper prompt.
6. **Integrate & Shutdown Worktree Preservation (ported from OMX 0.21.34 PR #3896)**:
   - When workers used `share`/`branch` workspaces, merge their changes into the main workspace and resolve conflicts in the leader lane.
   - **Never discard unsaved worker work on shutdown**: before removing any worker branch/worktree or killing a worker with `Workspace: "branch"`, verify in the leader lane that (a) the worker's `HEAD` is an ancestor of the leader's `HEAD` (`git merge-base --is-ancestor <workerHead> HEAD`), and (b) no unpreserved untracked, ignored, or submodule changes remain (`git status --porcelain --untracked-files=all --ignored --ignore-submodules=none`). If checkpointing or merging fails, retain the worker branch/workspace and team state (`status:"blocked"`) for recovery instead of deleting it. Preserve tracked or staged `.omagy/evidence` files during cleanup.
7. **Finish** only when `pending=0`, `in_progress=0`, `failed=0` (or failures are explicitly acknowledged), and all isolated worker branches are verified merged. Run integrated verification (tests/lint/typecheck/build) in the leader lane. Write `team-state.json` terminal (`active:false`, `current_phase:"complete"`, `completed_at`).

## Team and Ultragoal

When a leader-owned `.omagy/ultragoal/goals.json` exists, workers return task evidence only. The leader checkpoints the corresponding Ultragoal goal and appends the ledger entry with the integrated verification evidence.

## Recovery

- Worker reports touching files outside its scope: inspect the diff, keep or revert deliberately, and note it on the board.
- Two workers conflict on the same file: stop the later one, serialize the remaining work, and relaunch.
- Never kill all subagents to "reset" unless the user aborts. Kill only the exact stale worker.
- **After a server restart** (Antigravity stops all subagents): read the board, then revive each `in_progress` worker by `send_message` to its recorded `conversation_id` with a short "resume TASK <id>" note before spawning anything. If a worker cannot be revived, continue that task in the leader lane or relaunch it once with the board context. Do not spawn a replacement only because the original stopped.

## Exit and evidence

Report team name, task table (id, role, status, worker result summary), integration/merge notes, leader verification commands with exit codes, failures or blockers, and the terminal state path. Final integration and verification always stay in the leader lane.
