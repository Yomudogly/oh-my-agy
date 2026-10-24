# oh-my-agy

Multi-agent workflow layer for [Google Antigravity](https://antigravity.google), ported from [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) (OMX) by Yeachan Heo. It currently tracks OMX **0.21.33**.

It brings OMX's workflows to Antigravity:
- the autopilot chain `$deep-interview -> $ralplan -> $ultragoal`
- consensus planning
- durable goal ledgers
- adversarial QA
- dual-lane code review
- 18 role subagents
- 25 workflow skills (including `$loft` prototyping and `$pr` paper-trail assembly)

There is **no runtime dependency on the `omx` CLI**. State is plain JSON and Markdown under `.omagy/`, and the hooks are a single dependency-free Node script.

> [!NOTE]
> This is an unofficial community port. It is not affiliated with Google or with the oh-my-codex project.

## Requirements

- Antigravity with plugin support (skills, agents, rules, hooks).
- Node.js 18 or newer for the hooks. Without Node, the hooks do nothing and skills still work; `$name` routing then comes from the rules file.

## Layout

```text
oh-my-agy/
├── plugin.json            # Antigravity manifest
├── rules/AGENTS.md        # always-on operating contract (ported templates/AGENTS.md, ~12 KB)
├── hooks.json             # SessionStart + PreInvocation routing/wiki, Stop continuation, opt-in PreToolUse guard
├── hooks/
│   ├── run.sh             # finds Node (homebrew/volta/fnm/nvm), fails open if absent
│   └── omagy-hook.mjs     # hook runtime + `verify-evidence` + `selftest`
├── agents/                # 18 role subagents (explore, researcher, architect, critic, tracer, code-simplifier, ...)
└── skills/                # 25 workflow skills
```

## Install

Antigravity only loads plugins from its discovery roots, so clone the repo into one:

```bash
# user scope: available in every workspace
git clone https://github.com/Yomudogly/oh-my-agy.git ~/.gemini/config/plugins/oh-my-agy

# or project scope: only this repository (commit it to share with your team)
git clone https://github.com/Yomudogly/oh-my-agy.git .agents/plugins/oh-my-agy
```

Restart Antigravity (new plugin directories are discovered at startup), then run `$doctor`. Add `.omagy/` to your project's `.gitignore`.

On macOS, keep the real plugin directory in the discovery root. Don't make it a symlink into `~/Documents`, `~/Desktop` or `~/Downloads`, because Antigravity's sandboxed terminal can't read those folders.

### Update

```bash
git -C ~/.gemini/config/plugins/oh-my-agy pull
```

Then restart Antigravity. See [CHANGELOG.md](CHANGELOG.md) for what changed.

### Verify

Run the offline hook selftest at any time:

```bash
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest     # -> {"selftest":"PASS","passed":20,"failed":0}
```

Antigravity's sandboxed terminal may deny reading this plugin's files. If the selftest prints `Operation not permitted`, run it with sandbox bypass. The hooks themselves are unaffected: they write `$TMPDIR/oh-my-agy/<conversationId>.routing.json` on every user message, which is the quickest live health check.

### Uninstall

Delete the plugin directory and restart Antigravity. Workspace `.omagy/` and `omagy_wiki/` folders stay until you remove them.

## Usage

Type `$<skill>` in a message (e.g. `$autopilot build X`, `$code-review`, `$cancel`). The `PreInvocation` hook turns `$name` into routing context. The rules file covers the case where hooks are unavailable. `/name` also routes, except for names Antigravity already owns (`/plan`, `/goal`, ...); use `$plan` for the oh-my-agy planner.

| Skill | Purpose |
|---|---|
| `autopilot` | supervised `deep-interview -> ralplan -> ultragoal` delivery |
| `deep-interview` | Socratic interview with ambiguity scoring (via `ask_question`) |
| `plan` / `ralplan` | lightweight plan / Planner -> Architect -> Critic consensus |
| `ultragoal` | durable goals.json + ledger.jsonl execution with a final review gate |
| `team` | parallel subagent workers on a leader-owned task board |
| `code-review` | independent code-reviewer + architect lanes (Two-Axis + Demolition/ADR tests), deterministic verdict |
| `ultraqa` | adversarial e2e QA cycles |
| `ai-slop-cleaner`, `analyze`, `best-practice-research`, `design`, `loft`, `pr`, `visual-ralph` | methodology, prototyping, and PR paper-trail skills |
| `autoresearch`, `performance-goal` | validator-gated loops |
| `ask` | second opinion from local `claude` / `gemini` / `codex` CLIs |
| `wiki` | repo markdown wiki in `omagy_wiki/` |
| `cancel`, `hud`, `doctor`, `omagy-setup`, `skill`, `configure-notifications` | operations |

## What changed vs oh-my-codex

| oh-my-codex | oh-my-agy |
|---|---|
| `.codex-plugin/plugin.json` | `plugin.json` (only the fields Antigravity reads) |
| `templates/AGENTS.md` (22 KB) | `rules/AGENTS.md` (~12 KB, under the 24 KB rule cap) |
| `prompts/*.md` installed by `omx setup` | `agents/*.md` shipped in the plugin |
| Codex native subagents / `task(agent_type=...)` | `invoke_subagent` with `TypeName: <role>` |
| `omx question` (tmux UI) | `ask_question` |
| `omx state write/read/clear` | agent writes `.omagy/state/<mode>-state.json` directly |
| `omx ultragoal`, `omx performance-goal` CLIs + Codex `get_goal/update_goal` | agent-maintained `goals.json` / `ledger.jsonl` / `checkpoints.jsonl` |
| `omx team` (tmux panes, mailboxes, `omx team api`) | concurrent subagents, `send_message`, `manage_subagents`, branch/share workspaces, `.omagy/evidence/task-<id>.json` checked by the leader (`requires_code_change` default from task wording/role, ported from 0.21.33), revive-before-respawn after restarts |
| `omx wiki` CLI | file-based `omagy_wiki/` + bounded (`<=3,500` chars) `index.md` auto-injection once per conversation |
| `$imagegen` | `generate_image` |
| Codex hooks (`SessionStart`, `UserPromptSubmit`, `PreCompact`, `PostCompact`, `SubagentStop`, ...) | `SessionStart` + `PreInvocation` (routing, active state, bounded wiki index), `Stop` (bounded continuation on `NO_TOOL_CALL` + notifications), `PreToolUse` (opt-in guard) |
| `omx` notifications (Discord/Telegram/Slack/OpenClaw, reply listener) | Slack/Discord/Telegram/webhook/command from the Stop hook |
| `hud` Codex statusline + `omx hud --watch` | on-demand `$hud` status board |
| `omx setup` / `omx doctor` | `$omagy-setup` / `$doctor` (Antigravity paths) |
| `.omx/`, `omx_wiki/` | `.omagy/`, `omagy_wiki/` (legacy dirs read for migration) |
| `.mcp.json` (`omx mcp-serve ...`, all disabled) | not shipped. File state replaces the state/memory servers; add the `omx` servers to `mcp_config.json` manually if wanted |

## Limitations

- **No compaction hooks** in Antigravity (`PreCompact` / `PostCompact`), so there is no automatic compaction snapshot. `SessionStart` and `PreInvocation` inject active `.omagy/state/` and `omagy_wiki/index.md` context once per session, and durable artifacts under `.omagy/` cover resume.
- **No hidden goal primitive for agents.** The ledger is the source of truth. Antigravity's `/goal` is user-triggered only.
- **Continuation is bounded:** the Stop hook re-enters the loop at most 2 times without a state update, never on errors/max-steps, never while background work is pending, and ignores states older than 6h. That's safer than OMX's hook lock, but long autonomous runs depend on the agent refreshing `updated_at`.
- **Team workers are subagents, not separate CLI processes.** Mixing models via `OMX_TEAM_WORKER_CLI=claude` and launching from a tmux leader are gone. Use `$ask` for cross-model opinions.
- **PreToolUse guard ships disabled.** Antigravity requires a `decision` for PreToolUse, and the guard deliberately never emits `allow` (which would widen permissions). Enable it in `hooks.json` and confirm in `$doctor` that "no opinion" (`{}`) is accepted by your Antigravity build.
- **Hook payload assumptions:** routing reads the last user message from `transcriptPath` and fails open (no routing) if that format changes. The rules file still covers `$name` invocation.
- **Agent file format:** `agents/*.md` uses `name`/`description` frontmatter with the body as the system prompt. If a role is not picked up, workflows fall back to the `self` subagent with the role text as the prompt preamble.
- Not ported: Ralph/ultrawork/pipeline stubs (already removed upstream), `omx sparkshell`, `omx auth` slot rotation, `--madmax`/`--yolo` launch flags, OpenClaw/clawdbot gateways, Codex model-routing env vars.

## License

[MIT](LICENSE), same as oh-my-codex. The original oh-my-codex work is © Yeachan-Heo; the Antigravity port adaptations are © Yomudogly. Both copyright notices are kept in [LICENSE](LICENSE).

## Credits

- [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo: the original workflows, skills, role prompts and operating contract that this port adapts.
