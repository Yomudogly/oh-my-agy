---
name: hud
description: "[oh-my-agy] Show an on-demand status board of active oh-my-agy workflows (autopilot phase, ultragoal progress, team tasks, QA cycle) from .omagy/ state. Use for $hud, 'what modes are active', 'workflow status', or before resuming work."
---

# HUD (Status Board)

oh-my-codex's HUD had two layers: a Codex TUI statusline (`[tui] status_line` in `~/.codex/config.toml`) and an `omx hud --watch` CLI. Antigravity has no configurable statusline, so this skill renders the same information **on demand** in chat.

## Presets
- `minimal`: one line, e.g. `[OMA] autopilot:ultragoal | ultragoal:3/7`
- `focused` (default): the minimal line plus each active mode's phase, iteration, and last-update age.
- `full`: focused plus goal/task tables and recent ledger entries.

Accept `$hud --preset=<name>`. A default can be stored in `.omagy/config.json` as `{"hud": {"preset": "focused"}}`.

## Sources (read-only)
- `.omagy/state/*-state.json`: mode, active, current_phase, iteration, updated_at
- `.omagy/ultragoal/goals.json` and the tail of `ledger.jsonl`: goal counts by status, current goal
- `.omagy/state/team/*/tasks.json`: task counts by status, worker assignments
- `.omagy/goals/performance/*/state.json`: baseline vs `lastValidation`
- `manage_subagents list` and `manage_task list`: live subagents and background tasks

## Rendering

```text
[OMA] autopilot:ultragoal (iter 1, 4m ago) | ultragoal:3/7 complete | team:qa-sweep 2/5 | tasks:1 bg
```
Then, for focused/full, a small table:

| Mode | Phase | Iter | Updated | Notes |
|---|---|---|---|---|

Flag problems:
- **stale**: active and `updated_at` older than 6h. The Stop hook ignores it; suggest `$cancel` or resuming.
- **stuck**: two recent consecutive continuation nudges without a state change. Check `/tmp/oh-my-agy/*.nudge.json`, or `$TMPDIR/oh-my-agy/` on macOS.
- **inconsistent**: e.g. autopilot at `ultragoal` with no `goals.json`.

If nothing is active, print `[OMA] No active modes` and suggest `$autopilot` or `$ultragoal`.

For a live view, the user can ask you to `schedule` a recurring refresh (e.g. every 5 minutes while a long run is active).
