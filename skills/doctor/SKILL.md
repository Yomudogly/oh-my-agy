---
name: doctor
description: "[oh-my-agy] Diagnose and fix oh-my-agy installation, manifest health, and runtime issues (plugin discovery, lifecycle hook wiring, Node availability, rules size, agents and skills integrity, continuation nudges, and stale workflow state); install, enable, update, or uninstall the plugin and bootstrap AGENTS.md (--setup, --init-deep); configure Slack, Discord, Telegram, webhook, or command notifications (--notifications); and audit sessions (--session, --session-compare, --session-scan). Use when hooks, subagents, or continuation are failing or not working."
---

# oh-my-agy Doctor

Run read-only checks first, report, then remediate only after the user confirms and only for confirmed oh-my-agy-owned targets.

## Mode Dispatch

- **Health Diagnostics (default `$doctor`)**: inspect discovery roots, manifests, SDO skill compliance, hook selftests, floor-guard, and workspace `.omagy/` state.
- **Plugin Setup & `AGENTS.md` Bootstrap (`$doctor --setup` / `$doctor --init-deep`)**: install, enable, update, or uninstall `oh-my-agy` in user or project scope, configure `.gitignore`, and bootstrap root or hierarchical subdirectory `AGENTS.md` files (scanning high-density/high-churn boundaries via `sh <plugin>/hooks/run.sh init-deep-scan [root] --json`) — follow [references/setup-and-init-deep.md](references/setup-and-init-deep.md).
- **Stop & Idle Notifications (`$doctor --notifications`)**: inspect, configure, smoke-test, or disable Slack, Discord, Telegram, generic HTTPS webhook, or global local-command notifications (`~/.gemini/config/oh-my-agy/notifications.json` and `<workspace>/.omagy/notifications.json`, enforcing SSRF and global-only `command.command` boundaries) — follow [notifications.md](./references/notifications.md).
- **Session Transcript Forensics (`$doctor --session` / `--session-compare` / `--session-scan`)**: run 7-lens transcript forensics, baseline-vs-candidate session regression checks, or privacy-safe cross-session orphan tool-call, compaction, and failure-cluster scanning (`sh <plugin>/hooks/run.sh session-scan [transcriptOrDir] --json`) — follow [session-forensics.md](./references/session-forensics.md).

## Locate the plugin

Resolve `PLUGIN_DIR` from the path of this `SKILL.md` (two levels up). Check where it is installed:
- workspace: `<repo>/.agents/plugins/oh-my-agy` (or `.agent/`, `_agents/`, `_agent/`)
- global: `~/.gemini/config/plugins/oh-my-agy`
- symlinked: report the real path (`readlink -f`). On macOS, Antigravity's terminal sandbox denies `~/Documents`, `~/Desktop`, and `~/Downloads`, so a plugin symlinked into those folders is unreadable from sandboxed `run_command`.

**Sandbox note:** Antigravity's terminal sandbox may deny reading this plugin's `hooks.json`, `rules/`, `agents/`, `skills/`, and `hooks/` even from `~/.gemini/config/plugins/oh-my-agy` (observed with 0.21.33; the exact rule is unknown). File tools (`read_file`) are not affected. When a sandboxed shell check fails with `Operation not permitted`, read the file with `read_file` instead, or rerun only that command with `BypassSandbox: true`. This is not a plugin fault: report it as INFO.

If the plugin directory is outside every discovery root, Antigravity will not load it. Report this as **CRITICAL**.

## Checks

| Check | How | Status |
|---|---|---|
| Plugin manifest | `plugin.json` parses via strict `JSON.parse()` (no `//` comments), uses only official Antigravity top-level keys (`name`, `displayName`, `version`, `description`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`), has `description` `<= 160` chars, and has `version` matching the top heading in `CHANGELOG.md` | CRITICAL if invalid or missing; WARN on version drift or unknown keys |
| Enabled | Antigravity's plugin list (`GetAllPlugins`; see the built-in `plugin` skill) shows oh-my-agy enabled with skills, agents, rules, and hooks | CRITICAL if missing; WARN if disabled |
| Name collisions | other plugins/skills named `code-review`, `team`, `skill`, `pr`, ... at a higher priority shadow ours | WARN |
| Rules & hook sizes | only `rules/AGENTS.md` exists in `rules/` (no duplicate `.md` files), `wc -c rules/AGENTS.md` `< 24000` bytes, `hooks/omagy-hook.mjs` `< 170000` bytes (`< 175000` hard ceiling, with zero static import of `omagy-skill.mjs`, `omagy-cli.mjs`, or `omagy-selftest.mjs`), `hooks/omagy-cli.mjs` `< 93734` bytes, and `sidecars/hud/{ui,client}.mjs` each `< 256000` bytes | WARN if duplicate rule files or over byte ceilings |
| Skills, SDO & routing eval | `sh "<PLUGIN_DIR>/hooks/run.sh" skill-validate "<PLUGIN_DIR>/skills" --strict --json` exits `0` (`ok: true`, `errors: []`, `warnings: []` across all 20 skills: `SKILL.md <= 19000` bytes, `references/*.md < 40000` bytes 1-level deep with `> 100`-line TOCs, valid YAML frontmatter without `->` or HTML tags, valid `.md#anchor` & `scripts/*` links, zero clutter), `.agents/skills.json` passes `skill-validate` when present, and `sh "<PLUGIN_DIR>/hooks/run.sh" skill-eval --min-rank1 95` exits `0` (`0` cosine collisions, `100%` negative survival) | CRITICAL per broken skill or routing/collision failure |
| Agents | every `agents/*.md` has `name`, `description`, `subagent`, `mainAgent`, and `tools` (`14` roles total) and no unrecognized top-level frontmatter keys such as `level` | CRITICAL per broken agent; WARN on unknown frontmatter keys |
| Hooks JSON & symlinks | `hooks.json` parses; commands reference `./hooks/run.sh`; `PreToolUse` matcher covers `write_file`, `edit_file`, `apply_patch`, and `read_file`; no broken/dangling symlinks in `hooks/` | CRITICAL if invalid or dangling symlink |
| HUD Sidecar | `sidecars/hud/sidecar.json` parses with `has_web_ui: true` and `SIDECAR_UI_ENTRYPOINT_AUX_PANE`, and `sh "<PLUGIN_DIR>/sidecars/hud/run.sh" selftest` prints `"selftest":"PASS"` (`H1`–`H24`, including `vm.Script` inline script compilation) | WARN if missing or failing |
| Node | `cd /tmp && sh "<PLUGIN_DIR>/hooks/run.sh" selftest` prints `{"selftest":"PASS","passed":87,"failed":0}` (runs offline in a temp dir across `T1`–`T10` and `T20`–`T52`). If the sandbox denies it, rerun this one command with `BypassSandbox: true` | CRITICAL if node is missing or the selftest fails |
| Floor guard & quality gates | `sh "<PLUGIN_DIR>/hooks/run.sh" floor-guard "<workspace>"` exits `0` (`1` on 9-category anti-tampering violations; `2` outside a git worktree), and if `.omagy/config.json` defines `qualityGates`, `sh "<PLUGIN_DIR>/hooks/run.sh" quality-gates "<workspace>"` returns `"ok":true` (use `quality-gate <report.json...>` for `semgrep`/`axe` scanner JSON reports) | WARN if floor violations or invalid gate config |
| Live hooks | `$TMPDIR/oh-my-agy/<conversationId>.routing.json` exists and its `at` matches the latest user message time (the PreInvocation hook wrote it). This needs no plugin-file access | WARN if missing or stale |
| Hook PATH | if the selftest passes in your shell but hooks never fire, Antigravity's hook shell may lack nvm/homebrew in PATH. Set `OMAGY_NODE` or check that `run.sh` finds Node | WARN |
| Workspace & inner-folder state | `.omagy/state/*-state.json` parse at the parent workspace root and any discovered inner-folder `<subfolder>/.omagy/` scopes; list active modes, `awaiting_confirmation` holds, and scopes; flag stale (>6h), terminal-but-active, or orphaned team boards (`sh "<PLUGIN_DIR>/hooks/run.sh" validate-team-tasks "<workspace>" "<team>"`) | WARN |
| Runtime storage & `.tmp` hygiene | `.omagy/` total size is within budget (`< 50 MB` warn threshold) and no orphaned `<file>.tmp.<pid>` files from dead PIDs remain in `.omagy/` | WARN if oversized or orphan `.tmp` files exist |
| Gitignore | `.omagy/` is in `.gitignore` | INFO |
| Notifications | config JSON parses and passes SSRF/scope rules (see [notifications.md](./references/notifications.md)) | WARN if invalid |

Command sketch:
```bash
P="<PLUGIN_DIR>"
node -e "for (const f of process.argv.slice(1)) JSON.parse(require('fs').readFileSync(f,'utf8'))" "$P/plugin.json" "$P/hooks.json" && echo manifests OK
wc -c "$P/rules/AGENTS.md"
for f in "$P"/skills/*/SKILL.md; do d=$(basename "$(dirname "$f")"); n=$(sed -n 's/^name: *//p' "$f" | head -1); [ "$d" = "$n" ] || echo "MISMATCH $f ($n)"; done
for f in "$P"/agents/*.md; do grep -q '^name:' "$f" && grep -q '^description:' "$f" || echo "BAD AGENT $f"; done
sh "$P/hooks/run.sh" selftest
sh "$P/hooks/run.sh" skill-validate "$P/skills" --strict
sh "$P/hooks/run.sh" skill-eval --min-rank1 95
sh "$P/hooks/run.sh" floor-guard .
ls -la .omagy/state 2>/dev/null
```

## Session Transcript Forensics, Clustering & A/B Comparison (`$doctor --session` / `--session-compare` / `--session-scan`)

When invoked with `--session` (or when diagnosing why a workflow drifted, repeated work, or skipped a skill gate), run the 7-dimension transcript forensics protocol in [session-forensics.md](./references/session-forensics.md):
1. Resolve the transcript via `$TMPDIR/oh-my-agy/<conversationId>.routing.json` (`transcriptPath`) or `<appDataDir>/brain/<conversationId>/.system_generated/logs/transcript.jsonl`.
2. Enforce the **Context-Safety Protocol** (`wc -lc`, checking lines `> 100 KB`, extracting line numbers and metadata before reading step fields).
3. Evaluate the 7 behavioral lenses (`skill-timeline`, `plan-adherence`, `repeated-work`, `stumbles`, `quality-evidence`, `request-conflicts`, `cost-and-time`) with `[line N / step S]` citations.
4. **Comparative Session Analysis (`$doctor --session-compare <baseline.jsonl> <candidate.jsonl>`) & Multi-Session Clustering (`$doctor --session-scan [transcriptOrDir]`)**:
   - Run `sh <plugin>/hooks/run.sh session-compare "<baseline>" "<candidate>" [.omagy/artifacts/session-compare-<UTC>.json]` to compute deterministic deltas across `duration_ms`, `turns`, `tool_calls`, `failed_tools`, `stumbles`, `repeated_work` (files read `>= 3x`), and `compactions` (`byTool` call/failure breakdown) and classify `assessment.status` as `no_regression | regression | inconclusive`.
   - Run `sh <plugin>/hooks/run.sh session-scan [transcriptOrDir] --json` across a transcript file or brain/logs directory for privacy-safe aggregate diagnostics (`filesScanned`, `totalSteps`, `compactions`, `orphanToolCalls`, `failedToolCalls`, and `topFailureClusters` with home paths and UUIDs scrubbed, never echoing raw user prompts).
5. When `--export [skeleton|evidence|full]` is requested, run the mandatory Two-Pass Redaction & Scrub Audit (`<SECRET-n>`, `<EMAIL-n>`, `<PERSON-n>`, `<HOST-n>`, `<REPO-n>`) before writing `.omagy/artifacts/session-forensics-<id>-<UTC>.md`.

## Report contract

```text
## oh-my-agy Doctor Report
### Summary
[HEALTHY / ISSUES FOUND]
### Checks
| Check | Status | Details |
### Issues Found
1. ...
### Recommended Fixes
...
```

## Remediation (after confirmation)

- Not discovered: symlink or copy the plugin into a discovery root per `$doctor --setup` ([setup-and-init-deep.md](./references/setup-and-init-deep.md)), then restart Antigravity.
- Disabled: enable it via the built-in `plugin` skill flow (language-server `JetboxWriteState`) or link `[oh-my-agy](customization://oh-my-agy)` (never `plugin://`). Do not hand-edit `config.json`.
- Stale or corrupt state: `$cancel --force <mode>` (exact file only).
- Restart Antigravity after plugin file changes, and report before/after evidence (including `[oh-my-agy](customization://oh-my-agy)` and `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` when the sidecar is enabled).

## Exit conditions

Report **HEALTHY** only when discovery, manifest, skills, agents, hooks JSON, the Node selftest, and workspace state all pass. Otherwise report **ISSUES FOUND** with the exact failing evidence and the smallest confirmed remediation. Never claim a fix from a recommendation alone.
