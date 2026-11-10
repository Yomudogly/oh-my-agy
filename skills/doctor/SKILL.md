---
name: doctor
description: "[oh-my-agy] Diagnose and fix oh-my-agy installation, manifest health, and runtime issues: plugin discovery, lifecycle hook wiring and Node availability, rules size, agents/skills integrity, and stale workflow state. Use for $doctor, or when skills, hooks, subagents, or continuation are failing or not working."
---

# oh-my-agy Doctor

Run read-only checks first, report, then remediate only after the user confirms and only for confirmed oh-my-agy-owned targets.

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
| Name collisions | other plugins/skills named `plan`, `design`, `code-review`, `team`, ... at a higher priority shadow ours | WARN |
| Rules & hook sizes | only `rules/AGENTS.md` exists in `rules/` (no duplicate `.md` files), `wc -c rules/AGENTS.md` `< 24000` bytes, `hooks/omagy-hook.mjs` `< 235000` bytes (with zero static import of `omagy-cli.mjs`), and `hooks/omagy-cli.mjs` `< 100000` bytes | WARN if duplicate rule files or over byte ceilings |
| Skills, SDO & routing eval | every `skills/*/SKILL.md` is `< 20000` bytes, passes strict YAML frontmatter checks (`name` matching directory, non-empty `description` with zero `->` step-chain arrows), resolves all relative `.md#anchor` links, has zero empty subdirectories or dev files, and `sh "<PLUGIN_DIR>/hooks/run.sh" skill-eval --min-rank1 90` exits `0` (`0` cosine collisions, `100%` negative survival) | CRITICAL per broken skill or routing/collision failure |
| Agents | every `agents/*.md` has `name` and `description` and no unrecognized top-level frontmatter keys such as `level` | CRITICAL per broken agent; WARN on unknown frontmatter keys |
| Hooks JSON & symlinks | `hooks.json` parses; commands reference `./hooks/run.sh`; `PreToolUse` matcher covers `write_file`, `edit_file`, `apply_patch`, and `read_file`; no broken/dangling symlinks in `hooks/` | CRITICAL if invalid or dangling symlink |
| HUD Sidecar | `sidecars/hud/sidecar.json` parses with `has_web_ui: true` and `SIDECAR_UI_ENTRYPOINT_AUX_PANE`, and `sh "<PLUGIN_DIR>/sidecars/hud/run.sh" selftest` prints `"selftest":"PASS"` | WARN if missing or failing |
| Node | `cd /tmp && sh "<PLUGIN_DIR>/hooks/run.sh" selftest` prints `{"selftest":"PASS","passed":74,"failed":0}` (runs offline in a temp dir, including `T6`–`T8` and `T35`–`T39` v0.4.6 checks). If the sandbox denies it, rerun this one command with `BypassSandbox: true` | CRITICAL if node is missing or the selftest fails |
| Floor guard & quality gates | `sh "<PLUGIN_DIR>/hooks/run.sh" floor-guard "<workspace>"` exits `0` (`1` on 9-category anti-tampering violations; `2` outside a git worktree), and if `.omagy/config.json` defines `qualityGates`, `sh "<PLUGIN_DIR>/hooks/run.sh" quality-gates "<workspace>"` returns `"ok":true` (use `quality-gate <report.json...>` for `semgrep`/`axe` scanner JSON reports) | WARN if floor violations or invalid gate config |
| Live hooks | `$TMPDIR/oh-my-agy/<conversationId>.routing.json` exists and its `at` matches the latest user message time (the PreInvocation hook wrote it). This needs no plugin-file access | WARN if missing or stale |
| Hook PATH | if the selftest passes in your shell but hooks never fire, Antigravity's hook shell may lack nvm/homebrew in PATH. Set `OMAGY_NODE` or check that `run.sh` finds Node | WARN |
| Workspace & inner-folder state | `.omagy/state/*-state.json` parse at the parent workspace root and any discovered inner-folder `<subfolder>/.omagy/` scopes; list active modes, `awaiting_confirmation` holds, and scopes; flag stale (>6h), terminal-but-active, or orphaned team boards (`sh "<PLUGIN_DIR>/hooks/run.sh" validate-team-tasks "<workspace>" "<team>"`) | WARN |
| Runtime storage & `.tmp` hygiene | `.omagy/` total size is within budget (`< 50 MB` warn threshold) and no orphaned `<file>.tmp.<pid>` files from dead PIDs remain in `.omagy/` | WARN if oversized or orphan `.tmp` files exist |
| Gitignore | `.omagy/` is in `.gitignore` | INFO |
| Notifications | config JSON parses (see `$configure-notifications`) | WARN if invalid |

Command sketch:
```bash
P="<PLUGIN_DIR>"
node -e "for (const f of process.argv.slice(1)) JSON.parse(require('fs').readFileSync(f,'utf8'))" "$P/plugin.json" "$P/hooks.json" && echo manifests OK
wc -c "$P/rules/AGENTS.md"
for f in "$P"/skills/*/SKILL.md; do d=$(basename "$(dirname "$f")"); n=$(sed -n 's/^name: *//p' "$f" | head -1); [ "$d" = "$n" ] || echo "MISMATCH $f ($n)"; done
for f in "$P"/agents/*.md; do grep -q '^name:' "$f" && grep -q '^description:' "$f" || echo "BAD AGENT $f"; done
sh "$P/hooks/run.sh" selftest
sh "$P/hooks/run.sh" skill-eval --min-rank1 90
sh "$P/hooks/run.sh" floor-guard .
ls -la .omagy/state 2>/dev/null
```

## Session Transcript Forensics & A/B Comparison (`$doctor --session` / `--session-compare`)

When invoked with `--session` (or when diagnosing why a workflow drifted, repeated work, or skipped a skill gate), run the 7-dimension transcript forensics protocol in [session-forensics.md](./references/session-forensics.md):
1. Resolve the transcript via `$TMPDIR/oh-my-agy/<conversationId>.routing.json` (`transcriptPath`) or `<appDataDir>/brain/<conversationId>/.system_generated/logs/transcript.jsonl`.
2. Enforce the **Context-Safety Protocol** (`wc -lc`, checking lines `> 100 KB`, extracting line numbers and metadata before reading step fields).
3. Evaluate the 7 behavioral lenses (`skill-timeline`, `plan-adherence`, `repeated-work`, `stumbles`, `quality-evidence`, `request-conflicts`, `cost-and-time`) with `[line N / step S]` citations.
4. **Comparative Session Analysis (`$doctor --session-compare <baseline.jsonl> <candidate.jsonl>`)**: run `sh "<PLUGIN_DIR>/hooks/run.sh" session-compare "<baseline>" "<candidate>" [.omagy/artifacts/session-compare-<UTC>.json]` to compute deterministic deltas across `duration_ms`, `turns`, `tool_calls`, `failed_tools`, `stumbles`, `repeated_work` (files read `>= 3x`), and `compactions` (`byTool` call/failure breakdown) and classify `assessment.status` as `no_regression | regression | inconclusive`.
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

- Not discovered: symlink or copy the plugin into a discovery root (see `$omagy-setup`), then restart Antigravity.
- Disabled: enable it via the built-in `plugin` skill flow (language-server `JetboxWriteState`) or link `[oh-my-agy](customization://oh-my-agy)` (never `plugin://`). Do not hand-edit `config.json`.
- Stale or corrupt state: `$cancel --force <mode>` (exact file only).
- Restart Antigravity after plugin file changes, and report before/after evidence (including `[oh-my-agy](customization://oh-my-agy)` and `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` when the sidecar is enabled).

## Exit conditions

Report **HEALTHY** only when discovery, manifest, skills, agents, hooks JSON, the Node selftest, and workspace state all pass. Otherwise report **ISSUES FOUND** with the exact failing evidence and the smallest confirmed remediation. Never claim a fix from a recommendation alone.
