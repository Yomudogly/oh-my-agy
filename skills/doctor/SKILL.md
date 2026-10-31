---
name: doctor
description: "[oh-my-agy] Diagnose and fix oh-my-agy installation and runtime issues: plugin discovery, hook wiring and Node availability, rules size, agents/skills integrity, stale workflow state, and leftover oh-my-codex artifacts. Use for $doctor, or when skills, hooks, subagents, or continuation are not working."
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
| Plugin manifest | `plugin.json` parses as JSONC, has `name: "oh-my-agy"` and a non-empty `version` matching the top heading in `CHANGELOG.md` (ported from OMX v0.21.37 #3923) | CRITICAL if invalid or missing; WARN on version drift |
| Enabled | Antigravity's plugin list (`GetAllPlugins`; see the built-in `plugin` skill) shows oh-my-agy enabled with skills, agents, rules, and hooks | CRITICAL if missing; WARN if disabled |
| Name collisions | other plugins/skills named `plan`, `design`, `code-review`, `team`, ... at a higher priority shadow ours | WARN |
| Rules integrity & size | only `rules/AGENTS.md` exists in `rules/` (no duplicate `.md` files) and `wc -c rules/AGENTS.md` < 24000 bytes | WARN if duplicate rule files or over 24000 bytes |
| Skills | every `skills/*/SKILL.md` has frontmatter `name` matching its directory and a non-empty `description` | CRITICAL per broken skill |
| Agents | every `agents/*.md` has `name` and `description` and no unrecognized top-level frontmatter keys such as `level` (ported from OMC v5.7.21 #4657) | CRITICAL per broken agent; WARN on unknown frontmatter keys |
| Hooks JSON & symlinks | `hooks.json` parses; commands reference `./hooks/run.sh`; no broken/dangling symlinks in `hooks/` (ported from OMC v5.7.19 #4631) | CRITICAL if invalid or dangling symlink |
| Node | `cd /tmp && sh "<PLUGIN_DIR>/hooks/run.sh" selftest` prints `{"selftest":"PASS","passed":42,"failed":0}` (runs offline in a temp dir). If the sandbox denies it, rerun this one command with `BypassSandbox: true` | CRITICAL if node is missing or the selftest fails |
| Quality gates | if `.omagy/config.json` defines `qualityGates`, `sh "<PLUGIN_DIR>/hooks/run.sh" quality-gates "<workspace>"` returns `"ok":true` (ported from OMX v0.21.41 #3956 & OMC v5.7.22 #4670/#4671) | WARN if invalid gate config |
| Live hooks | `$TMPDIR/oh-my-agy/<conversationId>.routing.json` exists and its `at` matches the latest user message time (the PreInvocation hook wrote it). This needs no plugin-file access | WARN if missing or stale |
| Hook PATH | if the selftest passes in your shell but hooks never fire, Antigravity's hook shell may lack nvm/homebrew in PATH. Set `OMAGY_NODE` or check that `run.sh` finds Node | WARN |
| Workspace state | `.omagy/state/*-state.json` parse; list active modes; flag stale (>6h), terminal-but-active, or orphaned team boards | WARN |
| Gitignore | `.omagy/` is in `.gitignore` | INFO |
| Notifications | config JSON parses (see `$configure-notifications`) | WARN if invalid |
| Legacy OMX | `.omx/`, `omx_wiki/`, `~/.codex/AGENTS.md` with the OMX marker, Codex plugin cache `oh-my-codex` | INFO (offer migration; never delete Codex files unasked) |

Command sketch:
```bash
P="<PLUGIN_DIR>"
node -e "for (const f of process.argv.slice(1)) JSON.parse(require('fs').readFileSync(f,'utf8'))" "$P/hooks.json" && echo hooks.json OK
wc -c "$P/rules/AGENTS.md"
for f in "$P"/skills/*/SKILL.md; do d=$(basename "$(dirname "$f")"); n=$(sed -n 's/^name: *//p' "$f" | head -1); [ "$d" = "$n" ] || echo "MISMATCH $f ($n)"; done
for f in "$P"/agents/*.md; do grep -q '^name:' "$f" && grep -q '^description:' "$f" || echo "BAD AGENT $f"; done
sh "$P/hooks/run.sh" selftest
ls -la .omagy/state 2>/dev/null
```
(`plugin.json` is JSONC, so validate it by stripping `//` comments first or by trusting the Antigravity plugin listing.)

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
- Disabled: enable it via the built-in `plugin` skill flow (language-server `JetboxWriteState`). Do not hand-edit `config.json`.
- Stale or corrupt state: `$cancel --force <mode>` (exact file only).
- Legacy `.omx/` artifacts: offer to copy `.omx/specs`, `.omx/plans`, `.omx/context`, and `.omx/ultragoal` into `.omagy/`. Leave `.omx/` in place unless the user asks to remove it.
- Restart Antigravity after plugin file changes, and report before/after evidence.

## Exit conditions

Report **HEALTHY** only when discovery, manifest, skills, agents, hooks JSON, the Node selftest, and workspace state all pass. Otherwise report **ISSUES FOUND** with the exact failing evidence and the smallest confirmed remediation. Never claim a fix from a recommendation alone.
