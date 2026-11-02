---
name: hud
description: "[oh-my-agy] Show an on-demand status board of active oh-my-agy workflows (autopilot phase, ultragoal progress, team tasks, QA cycle) from .omagy/ state. Use for $hud, 'what modes are active', 'workflow status', or before resuming work."
---

# HUD (Status Board)

oh-my-codex's HUD had two layers: a Codex TUI statusline (`[tui] status_line` in `~/.codex/config.toml`) and an `omx hud --watch` CLI. In Antigravity, `oh-my-agy` provides both an **on-demand chat status board** and a **live Auxiliary Pane UI extension** (`sidecars/hud/sidecar.json`) accessible via the `sidecar://` link scheme.

## Aux Pane UI Pill (`sidecar://oh-my-agy/hud/`)

When `sidecars/hud/sidecar.json` is present and the plugin is enabled, include a single one-click pill at the end of the HUD output (following Antigravity's `ui-plugin-navigation` skill rules: one single `SIDECAR_UI_ENTRYPOINT_AUX_PANE` view in `sidecar.json` so the Extensions menu shows only `oh-my-agy HUD`, with internal tabs inside the panel):

- `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` (contains 6 tabs: `Overview` with consolidated live modes/Ultragoal/Interview/Team/Review/Research cards, `Workflows` lane guide, searchable `Skills` catalog with quick-start commands, `Subagents` specialist roster, `Wiki`, and `Doctor`)

## Presets
- `minimal`: one line, e.g. `[OMA] autopilot:ultragoal | ultragoal:3/7`
- `focused` (default): the minimal line plus each active mode's phase, iteration, and last-update age.
- `full`: focused plus goal/task tables and recent ledger entries.

Accept `$hud --preset=<name>`. A default can be stored in `.omagy/config.json` as `{"hud": {"preset": "focused"}}`.

## Sources (strictly read-only, ported from OMX `v0.21.42` `#3963` & OMC `v5.7.21` `#4649`/`#4661`/`#4662`)
- **Zero-mutation invariant (OMX `#3963`)**: `$hud` is strictly observational. Never write state files, reclaim or reassign team tasks, or mutate `.omagy/` while rendering the status board.
- `.omagy/state/*-state.json` and `.omagy/state/sessions/*/*-state.json`: mode, active, current_phase, iteration, updated_at (aggregate across the 5 newest session directories by default, or filter to a requested `--session=<id>`).
- `.omagy/ultragoal/goals.json` and the tail of `ledger.jsonl`: goal counts by status, current goal
- `.omagy/state/team/*/tasks.json`: task counts by status, worker assignments. Show active team boards even when no session `team-state.json` snapshot exists, and hide completed team runs whose `updated_at` is older than 20 minutes in team-only views (OMC `#4661`, `#4662`).
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
