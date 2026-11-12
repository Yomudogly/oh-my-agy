---
name: hud
description: "[oh-my-agy] Show an on-demand status board of active oh-my-agy workflows (autopilot phase, ultragoal progress, team tasks, QA cycle) from .omagy/ state, or create a structured, self-contained session handoff artifact under .omagy/artifacts/handoff-<slug>-<UTC>.md (--handoff) so work resumes cleanly after /compact or in a fresh conversation. Use for $hud, 'what modes are active', 'workflow status', 'create a handoff', 'save context for next session', or before context compaction."
---

# HUD (Status Board)

In Antigravity, `oh-my-agy` provides both an **on-demand chat status board** and a **live Auxiliary Pane UI extension** (`sidecars/hud/sidecar.json`) accessible via the `sidecar://` link scheme.

## Aux Pane UI Pill (`sidecar://oh-my-agy/hud/`)

When `sidecars/hud/sidecar.json` is present and the plugin is enabled, include a single one-click pill at the end of the HUD output (following Antigravity's `ui-plugin-navigation` skill rules: one single `SIDECAR_UI_ENTRYPOINT_AUX_PANE` view in `sidecar.json` so the Extensions menu shows only `Oh My Agy`, with internal tabs inside the panel):

- `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` (served by `sidecars/hud/main.mjs` + `sidecars/hud/ui.mjs` with live `GET /api/events` SSE updates, `15 s` fallback polling, digest-diffed stateful DOM preservation, a wide Slide-Over `#artifact-drawer` with asymmetric transitions & code-block copy, GPU sliding tab pills, arrow-key `tablist` navigation, keyboard shortcuts `/` / `1`–`5` / `Escape`, and Hallmark light/dark CSS tokens across 5 tabs: `Overview` with single-line workspace folder & scope pills, single `Current Workflow Mode` spotlight, GPU `scaleX` progress bars, 5-event `Recent Ledger Events`, 2-tab `Reviews`/`Research` switcher, 10-item collapsible `Plans, Specs, Handoffs & Artifacts`, quick actions including `customization://oh-my-agy`, and Benchmarks/Visual-Ralph/Loft/Code-Health/Doctor cards, `Workflows` single-line horizontally scrollable animated step pipelines, searchable `Skills` catalog with `<mark>` match highlights & `--flag` composer chips, `Subagents` specialist roster with `Model` tier pills `inherit`|`flash_lite`|`flash`|`pro` and `invoke_subagent` snippet preview, and interactive 3D Canvas mind-map / `List` `[[slug]]` Markdown `Wiki` explorer with left-rule Working Agreements)

## Presets
- `minimal`: one line, e.g. `[OMA] autopilot:ultragoal | ultragoal:3/7`
- `focused` (default): the minimal line plus each active mode's phase, iteration, and last-update age.
- `full`: focused plus goal/task tables and recent ledger entries.

Accept `$hud --preset=<name>`. A default can be stored in `.omagy/config.json` as `{"hud": {"preset": "focused"}}`.

## Sources (strictly read-only)
- **Zero-mutation status invariant & live SSE (`/api/status` & `/api/events`)**: `$hud`, `GET /api/status`, and debounced `GET /api/events` (`150 ms` `.omagy/` + `omagy_wiki/` watcher debounce with `computeSnapshotDigest` duplicate suppression and `statusRequiresToken` verification) are strictly observational — never write state files or mutate `.omagy/` while rendering. Interactive actions (`Run in Chat`, `New Chat`, `Dispatch into Active Chat`, `Launch Standalone Chat`, `Continue`, two-step `Cancel Mode`, `Create Handoff`, `Run /doctor`) use `POST /api/dispatch` via Antigravity's native `agentapi` CLI without mutating `.omagy/` files directly, while `window.addEventListener('message', ...)` rejects null/foreign `event.source` frames and reconnects `/api/events` on `workspace-change`.
- `.omagy/state/*-state.json` and `.omagy/state/sessions/*/*-state.json`: mode, active, current_phase, iteration, updated_at (aggregate across the 5 newest session directories by default, or filter to a requested `--session=<id>`).
- `.omagy/ultragoal/goals.json` and the tail of `ledger.jsonl`: goal counts by status, current goal
- `.omagy/state/team/*/tasks.json`: task counts by status, worker assignments. Show active team boards even when no session `team-state.json` snapshot exists, and hide completed team runs whose `updated_at` is older than 20 minutes in team-only views.
- `.omagy/goals/performance/*/state.json`: baseline vs `lastValidation`
- **Code Health & Technical Debt (`analyzeDiffCodeHealth`, `scanShortcutDebt` & `codeHealth.floorGuard`)**: working-tree function reuse ratio (`used` vs `new` symbols, `reusePct`), open callers of removed symbols (`⚠ N open callers`), the repository `shortcut:` / `ceiling:` debt ledger (`total` markers and `no-trigger` rot risk count), and 5,000ms + `.git/index` & `.git/HEAD` mtime-cached `codeHealth.floorGuard` anti-tampering telemetry (`runFloorGuard`: `ok`, `exitCode`, `deletedTests`, `removedAssertions`, `untrackedBlockers`, `suppressions`, `emptyCatches`, `protectedBlocksModified`, `total`).
- **Diagnostics & Runtime Health (`validateQualityGates` & `doctor.skillEval`)**: configured `.omagy/config.json` quality gates, stale mode detection, recent `.omagy/logs/hook-errors.jsonl` fail-open entries, and mtime-memoized `doctor.skillEval` routing health (`evaluateSkillRouting`: `ok`, `rank1Pct`, `minRank1`, `collisionErrors`, `negativeSurvivalPct`) surfaced as `Skill Eval: PASS (<rank1Pct>%) | FAIL`.
- **Safe Read-Only Artifacts & Slide-Over Drawer (`/api/artifact` + `#artifact-drawer`)**: `resolveSafeArtifactFile` serves symlink-free allowlisted files under `.omagy/{artifacts,plans,specs}` (including `.omagy/artifacts/{visual-ralph,loft,research,ideas}`, top-level `code-review-*.md` / `handoff-*.md` / `ask-*.md`, `.omagy/plans/*.md`, `.omagy/specs/**/*.md`, and Loft `(?:variant-[a-c]/)?index.html` + local `.js`/`.mjs`/`.css` assets) with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `redactSecrets()` applied to `.md`/`.txt` responses. `#artifact-drawer` renders a 3-mode Visual Ralph comparator (`side-by-side`, `split-slider`, `onion-skin`), an opaque-origin `srcdoc` Loft `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` (never `allow-same-origin`, zero token in iframe URL, external scripts/links stripped, local assets & relative ES module imports bundled, active HUD theme variables injected), and XSS-escaped Markdown previews.
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

## Structured Session Handoff (`$hud --handoff`)

While default `$hud` status rendering is strictly observational, explicit `$hud --handoff` writes a self-contained continuation artifact before `/compact` or switching to a fresh conversation:

1. **Inspect active state & git status** (redacting any secrets via `redactSecrets` or running `sh <plugin>/hooks/run.sh handoff` when available):
   - Active state files in `.omagy/state/` and `.omagy/state/sessions/<conversationId>/`.
   - `.omagy/ultragoal/goals.json` and the tail of `.omagy/ultragoal/ledger.jsonl` if present.
   - `git status --short` and `git diff --stat` to capture modified and untracked files.
2. **Write the handoff artifact**:
   - Derive `<slug>` and UTC timestamp (`YYYYMMDDTHHMMSSZ`), write `.omagy/artifacts/handoff-<slug>-<UTC>.md`, and update `.omagy/artifacts/handoff-latest.md`:

```markdown
# Session Handoff: <title>

- **Created**: `<ISO UTC>`
- **Conversation ID**: `<conversationId>`
- **Active Mode / Phase**: `<mode> (<current_phase>) | none`
- **Branch / Commit**: `<branch> @ <short-sha>`

## 1. Objective & Current Status
<1-3 sentences stating the target outcome and what percentage/stage is complete>

## 2. Completed Work & Verification Evidence
- `<file:line>` — <change summary> (Verified by: `<command>` -> exit `<code / output>`)

## 3. Active Durable State & Artifacts
- State file(s): `.omagy/state/...`
- Plan / Spec: `.omagy/plans/...` or `.omagy/specs/...`
- Ultragoal ledger: `.omagy/ultragoal/goals.json` (`<completed>/<total>` goals complete)
- Working agreements / Wiki updates: `omagy_wiki/...`

## 4. Key Decisions & Adopted Defaults
- `[from-user]` / `[adopted-default]`: <decision + 1-line rationale>

## 5. Open Blockers, Dirty Files & Residual Risks
- Uncommitted files: `<list from git status>`
- Open blockers / next discriminating probe: `<none or exact details>`

## 6. Exact Resume Prompt (Copy-Paste into Next Session)
> Read `.omagy/artifacts/handoff-latest.md` and resume from `<exact next step or $skill command>`.
```

3. **Report**: output the clickable link to `.omagy/artifacts/handoff-<slug>-<UTC>.md`, display the **Exact Resume Prompt**, and remind the user they can now run `/compact` or open a new session safely.
