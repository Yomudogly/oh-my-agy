---
name: cancel
description: "[oh-my-agy] Cancel active oh-my-agy workflow modes (autopilot, deep-interview, ralplan, plan, ultragoal, ultraqa, autoresearch, performance-goal, team) with exact-scope cleanup of their state, subagents, and background tasks. Use for $cancel, 'stop the workflow', 'cancel autopilot', or when a hard blocker prevents progress."
---

# Cancel Skill

## When to use

Use `$cancel` to stop an active oh-my-agy mode and run its documented cleanup: when work is verified done, the user says stop, or a hard blocker prevents meaningful progress. Do not cancel while recoverable work remains unless the user asks.

## Inputs and preconditions

- Accepted forms: `$cancel`, `$cancel <mode>`, `$cancel --force`.
- Reject `--all`, unknown flags, and repeated or mixed flags before changing anything.
- Discover active modes by reading `.omagy/state/*-state.json` in the workspace root. Active means `active:true` and a non-terminal `current_phase`.
- Confirm the exact target before cleanup. If several modes are active and no mode was named, cancel in dependency order (below) and report each one.

## Operational steps

1. Validate arguments and select the exact target mode(s).
2. Process active modes in dependency order:
   `autopilot -> team -> ultragoal -> ultraqa -> autoresearch -> performance-goal -> ralplan -> deep-interview -> plan`.
3. **Autopilot**: write `active:false`, `current_phase:"cancelled"`, `completed_at`. **Preserve** `handoff_artifacts` and the iteration so a new `$autopilot` can resume from them. Clean up only the child work Autopilot owns (its team run, its ultraqa harnesses).
4. **Team (with worktree/branch preservation, ported from OMX 0.21.34)**: `manage_subagents list`, then inspect only the conversation IDs recorded on `.omagy/state/team/<team>/tasks.json`. Because `manage_subagents kill` deletes branched workspaces, if any worker ran with `Workspace: "branch"` or `"share"` and has unmerged work, salvage or checkpoint its commits/branch in the leader lane first (stopping a worker is not permission to discard unsaved work). Then `kill` only those recorded worker conversation IDs, mark the remaining `in_progress` tasks `blocked` with `result:"cancelled"`, and terminalize `team-state.json`. Never use `kill_all` unless the user explicitly aborts everything.
5. **Ultraqa**: stop its background commands (`manage_task list` -> `kill` the ones it started), remove its temporary harnesses/fixtures, and terminalize its state.
6. **Ultragoal / performance-goal / autoresearch**: terminalize the state file. Do not modify `goals.json`, the ledger, or evidence artifacts beyond appending one `cancelled` ledger note.
7. **Planning modes** (ralplan, deep-interview, plan): terminalize the state. Keep the context snapshots, specs, and plans.
8. `--force`: additionally delete the target mode's `*-state.json` file (exact path only) after terminalizing it. This is for corrupt or stale state that keeps the Stop hook nudging. It never widens scope.
9. Report any cleanup failure instead of claiming success.

Terminal write shape (read-modify-write the existing file):
```json
{"active": false, "current_phase": "cancelled", "completed_at": "<ISO>", "updated_at": "<ISO>", "cancel_reason": "<user request | blocker>"}
```

## Exit and evidence

Report one line per selected mode: mode, terminal phase, what was preserved, linked cleanup (subagents killed, tasks stopped, files removed), and any refusal reason. A clean no-op reports `No active oh-my-agy modes detected.`
