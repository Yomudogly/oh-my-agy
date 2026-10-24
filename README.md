# oh-my-agy

Multi-agent workflow layer for [Google Antigravity](https://antigravity.google).

`oh-my-agy` brings structured, evidence-backed agentic engineering to Antigravity with zero external CLI dependencies:
- **Supervised Autopilot**: `/deep-interview -> /ralplan -> /ultragoal` end-to-end delivery (`/autopilot`)
- **Consensus & Hostile Planning**: Planner -> Architect -> Critic (`/ralplan`) plus 5-persona hostile cross-critique (`/ralplan --hyperplan`) and explore-first planning (`/plan`)
- **Durable Goal Ledgers**: repo-native `goals.json` + `ledger.jsonl` execution (`/ultragoal`) with `light`/`heavy` rigor tiering and `product` vs `harness` failure triage
- **Coordinated Subagent Teams**: parallel worker waves on a leader-owned DAG task board (`/team`) with work-shape model routing (`flash` / `inherit` / `pro`) and verified completion evidence
- **Adversarial QA & Dual-Lane Review**: 9-class trigger-mapped dynamic QA (`/ultraqa`) and Two-Axis + Demolition/ADR code review (`/code-review`)
- **18 Role Subagents & 26 Workflow Skills**: including causal hypothesis tracing (`tracer`), post-modification simplification (`code-simplifier`), throwaway prototyping (`/loft`), PR paper-trail assembly (`/pr`), and session continuation packets (`/handoff`)
- **Persistent Project Wiki & Working Agreements**: markdown knowledge base and guardrail ledger under `omagy_wiki/` (`/wiki`)

All workflow state is plain JSON and Markdown under `.omagy/`, and the lifecycle hooks run on a single dependency-free Node.js script.

## Requirements

- Antigravity with plugin support (skills, agents, rules, hooks).
- Node.js 18 or newer for lifecycle hooks. Without Node, the hooks fail open and skills still work via the operating rules.

## Layout

```text
oh-my-agy/
├── plugin.json            # Antigravity manifest (v0.3.1)
├── HOW_TO_USE.md          # Complete guide to all 26 skills, 18 subagents, hooks & recipes
├── rules/AGENTS.md        # always-on operating contract (~13 KB)
├── hooks.json             # SessionStart + PreInvocation routing/wiki, Stop continuation, opt-in PreToolUse guard
├── hooks/
│   ├── run.sh             # finds Node (homebrew/volta/fnm/nvm), fails open if absent
│   └── omagy-hook.mjs     # hook runtime + `verify-evidence` + `append-jsonl` + `read-jsonl` + `selftest`
├── agents/                # 18 role subagents (explore, researcher, architect, critic, tracer, code-simplifier, ...)
└── skills/                # 26 workflow skills
```

## Install

Antigravity loads plugins from its discovery roots, so clone the repository into one:

```bash
# user scope: available in every workspace
git clone https://github.com/Yomudogly/oh-my-agy.git ~/.gemini/config/plugins/oh-my-agy

# or project scope: only this repository (commit it to share with your team)
git clone https://github.com/Yomudogly/oh-my-agy.git .agents/plugins/oh-my-agy
```

Restart Antigravity (new plugin directories are discovered at startup), then run `/doctor`. Add `.omagy/` to your project's `.gitignore`.

On macOS, keep the real plugin directory in the discovery root. Do not make it a symlink into `~/Documents`, `~/Desktop`, or `~/Downloads`, because Antigravity's sandboxed terminal cannot read those folders.

### Update

```bash
git -C ~/.gemini/config/plugins/oh-my-agy pull
```

Then restart Antigravity. See [CHANGELOG.md](CHANGELOG.md) for release notes.

### Verify

Run the offline hook selftest at any time:

```bash
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest     # -> {"selftest":"PASS","passed":30,"failed":0}
```

Antigravity's sandboxed terminal may deny reading plugin files directly. If the selftest prints `Operation not permitted`, run it with sandbox bypass. The hooks themselves are unaffected: they write `$TMPDIR/oh-my-agy/<conversationId>.routing.json` on every user message, which is the quickest live health check.

### Uninstall

Delete the plugin directory and restart Antigravity. Workspace `.omagy/` and `omagy_wiki/` folders remain until you remove them.

## Usage

> **Full Guide**: See **[HOW_TO_USE.md](HOW_TO_USE.md)** for a complete walkthrough of all 26 skills (with flags and examples), all 18 role subagents, `.omagy/` state & crash-resilient ledgers, `omagy_wiki/` working agreements, lifecycle hooks, and end-to-end recipes.

In Antigravity, trigger skills with `/<skill>` in chat (for example `/autopilot build X`, `/code-review`, `/handoff`, `/cancel`). `$<skill>` is also supported by the `PreInvocation` hook as an alias (useful if a name like `/plan` overlaps with Antigravity's built-in `/plan` slash command).

| Skill | Purpose |
|---|---|
| `/autopilot` | supervised `/deep-interview -> /ralplan -> /ultragoal` delivery |
| `/deep-interview` | Socratic interview with ambiguity scoring and Two-Filter owner-decision gating (via `ask_question`) |
| `/plan` / `/ralplan` | explore-first lightweight plan / Planner -> Architect -> Critic consensus (plus `--hyperplan`) |
| `/ultragoal` | durable `goals.json` + `ledger.jsonl` execution with rigor tiering and final review gates |
| `/team` | parallel subagent workers on a leader-owned DAG task board with completion evidence |
| `/code-review` | independent `code-reviewer` + `architect` lanes (Two-Axis + Demolition/ADR tests), deterministic verdict |
| `/ultraqa` | 9-class trigger-mapped adversarial e2e QA cycles |
| `/analyze`, `/best-practice-research` | 6-tier evidence-ranked analysis, multi-lane causal tracing, and intent-vs-reality diffing |
| `/ai-slop-cleaner`, `/design`, `/loft`, `/pr`, `/visual-ralph` | anti-slop cleanup, `DESIGN.md` crafting, throwaway prototyping, PR assembly, and visual-diff loops |
| `/autoresearch`, `/performance-goal` | validator-gated research and benchmark optimization loops |
| `/ask` | second opinion from local `claude` / `gemini` / `codex` CLIs |
| `/wiki` | repo markdown wiki (`omagy_wiki/index.md`) and working-agreement ledger (`omagy_wiki/agreements.md`) |
| `/handoff`, `/cancel`, `/hud`, `/doctor`, `/omagy-setup`, `/skill`, `/configure-notifications` | session handoff, workflow control, diagnostics, skill extraction, and notifications |

## Architecture & Runtime Notes

- **Hooks & State Isolation**: `SessionStart` and `PreInvocation` inject `/skill` (and `$skill`) routing, active `.omagy/state/` reminders, bounded (`<=3,500` chars) `omagy_wiki/agreements.md` + `omagy_wiki/index.md` context once per session, and unseen subdirectory `AGENTS.md` files along touched workspace paths. State files support conversation-owner isolation (`owner_conversation_id` and `.omagy/state/sessions/<conversationId>/`) and multi-repo workspace anchoring (`.omagy-workspace`).
- **Bounded Continuation & Drift Guard**: The `Stop` hook re-enters active autonomous loops at most 2 consecutive times without a state update, never on errors or while background tasks are running, and ignores states older than 6 hours. On completion claims, it scans `git diff` for left-behind blocker patterns (`test.skip`, `test.only`, placeholder `TODO: implement` / `throw new Error("Not implemented")`).
- **Opt-In PreToolUse Guard**: `PreToolUse` ships disabled in `hooks.json` because Antigravity requires a `decision` when enabled. When opted in, it enforces the planning-phase write boundary and `write-existing-file-guard` (requiring confirmation before overwriting an unread non-empty source file) without ever emitting `allow`.
- **Subagents & Fallbacks**: `agents/*.md` defines 18 specialized subagents invoked via `invoke_subagent`. If a custom role is unavailable in a session, workflows fall back to Antigravity's built-in `self` or `research` subagent with the role's prompt preamble.

## License

[MIT](LICENSE). See [LICENSE](LICENSE) for full copyright notices.

## Credits

`oh-my-agy` synthesizes workflows, multi-agent patterns, and guardrails inspired by and adapted from:
- **[oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex)** by Yeachan Heo — foundational workflow chain (`deep-interview -> ralplan -> ultragoal`), durable state contracts, team evidence validation, and project wiki architecture.
- **[oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode)** by Yeachan Heo — causal `tracer` agent, `code-simplifier` agent, `/loft` prototyping, `/pr` paper-trail assembly, Two-Axis + Demolition/ADR code review, session state isolation, and completion drift guards.
- **[oh-my-openagent / oh-my-opencode (OMO)](https://github.com/code-yeongyu/oh-my-openagent)** by Yeongyu Kim — explore-first `CLEAR`/`UNCLEAR` intent routing, Two-Filter owner-decision gating, `--hyperplan` 5-persona hostile cross-critique, `DoneClaim` / `AdversarialVerify` (`product` vs `harness` triage), `/handoff`, work-shape model routing, working-agreement ledgers, subdirectory `AGENTS.md` discovery, and unread-overwrite guards.
