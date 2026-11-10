# oh-my-agy

Multi-agent workflow layer for [Google Antigravity](https://antigravity.google).

`oh-my-agy` brings structured, evidence-backed agentic engineering to Antigravity with zero external CLI dependencies:
- **Supervised Autopilot**: `/deep-interview -> /ralplan -> /ultragoal` end-to-end delivery (`/autopilot`)
- **Divergent Ideation, Consensus & Hostile Planning**: 7-lens divergent concept shaping (`/deep-interview --ideate`), Planner -> Architect -> Critic (`/ralplan`), 5-persona hostile cross-critique (`/ralplan --hyperplan`), and explore-first planning (`/plan`)
- **Durable Goal Ledgers & Blind-Claim Verification**: repo-native `goals.json` + `ledger.jsonl` execution (`/ultragoal`) with `light`/`heavy` rigor tiering, `product` vs `harness` failure triage, Blind-Claim `AdversarialVerify` packets, and 4-tier `RECONCILE` rulings
- **Coordinated Subagent Teams**: parallel worker waves on a leader-owned DAG task board (`/team`) with work-shape model routing (`flash` / `inherit` / `pro`) and verified completion evidence
- **Adversarial QA, Dual-Lane Review & Ship Readiness**: 9-class trigger-mapped dynamic QA (`/ultraqa`), Two-Axis + Demolition/ADR code review (`/code-review`, including `--audit [path]` whole-repo lean audits and `--ship` production ship-readiness gates), and fail-closed `semgrep`/`axe` scanner checks (`quality-gate`)
- **Codebase Reuse Map, Anti-Tampering Floor Guard & Debt Telemetry**: automatic shared-first `[oh-my-agy] Codebase map` injection (`codebase-map`), 6-Rung Reuse Ladder, `shortcut: <ceiling>, <when to upgrade>` debt ledger (`scan-debt`), `omagy-ignore-start..end` protected blocks, 9-category `floor-guard` anti-tampering analysis, and TF-IDF skill routing checks (`skill-eval`) surfaced live in the Aux Pane HUD (`sidecar://oh-my-agy/hud/`)
- **Multi-Lens Deep Research**: 5-phase technical, business, idea, and implementation investigations (`/deep-research`) with Boolean query matrices, Tier A–E source ranking, `[VERIFIED]`/`[DERIVED]`/`[ASSUMED]` tags, and a 5-dimension `>=85` self-audit
- **18 Role Subagents & 27 Workflow Skills**: including causal hypothesis tracing (`tracer`), post-modification simplification (`code-simplifier`), throwaway prototyping (`/loft`), read-only `stdin`-sandboxed external second opinions (`/ask --doubt`), PR paper-trail assembly (`/pr --ship` / `--watch`), and session continuation packets (`/handoff`)
- **Persistent Project Wiki & Working Agreements**: markdown knowledge base and guardrail ledger under `omagy_wiki/` (`/wiki`)

All workflow state is plain JSON and Markdown under `.omagy/`, and the lifecycle hooks run on a dependency-free Node.js runtime (`hooks/omagy-hook.mjs` + lazy-loaded cold CLI `hooks/omagy-cli.mjs`).

## Requirements

- Antigravity with plugin support (skills, agents, rules, hooks).
- Node.js 18 or newer for lifecycle hooks. Without Node, the hooks fail open and skills still work via the operating rules.

## Layout

```text
oh-my-agy/
├── .gitattributes         # LF line-ending normalization across POSIX & Windows checkouts
├── .github/workflows/ci.yml # 3-OS GitHub Actions CI matrix (ubuntu, macos, windows on Node 20)
├── plugin.json            # Antigravity manifest (v0.4.6, strict JSON)
├── assets/logo.png        # Plugin icon
├── HOW_TO_USE.md          # Complete guide to all 27 skills, 18 subagents, hooks & recipes
├── rules/AGENTS.md        # always-on operating contract (<24 KB)
├── hooks.json             # SessionStart + PreInvocation routing/wiki, Stop continuation, opt-in PreToolUse guard
├── hooks/
│   ├── run.sh             # POSIX-portable Node locator (homebrew/volta/fnm/nvm/Windows), fails open if absent
│   ├── omagy-hook.mjs     # hot-path hook runtime + 20 CLI subcommands (`selftest`, `floor-guard`, `skill-eval`, `quality-gate`, `codebase-map`, `scan-debt`, `check-test-junk`, `review-package`, `goal-brief`, `research-matrix`, `audit-research`, `verify-evidence`, `validate-team-tasks`, `watch-pr`, `failure-sig`, `session-compare`, `wiki-repair`, `quality-gates`, `append-jsonl`, `read-jsonl`)
│   ├── omagy-cli.mjs      # lazy-loaded zero-dep cold CLI (`floor-guard`, `skill-eval`, `quality-gate` & static validators)
│   └── skill-eval-cases.json # 27-skill positive + owner-paired negative routing benchmark corpus
├── sidecars/hud/          # Aux Pane UI extension (`sidecar://oh-my-agy/hud/`: Overview, Workflows, Skills, Subagents, Wiki)
├── agents/                # 18 role subagents (explore, researcher, architect, critic, tracer, code-simplifier, ...)
└── skills/                # 27 workflow skills + progressive-disclosure `references/`
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
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest     # -> {"selftest":"PASS","passed":74,"failed":0}
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-eval --min-rank1 90 # -> SKILL-EVAL: PASS (skills=27, ...)
sh ~/.gemini/config/plugins/oh-my-agy/sidecars/hud/run.sh selftest # -> {"selftest":"PASS",...}
```

Antigravity's sandboxed terminal may deny reading plugin files directly. If the selftest prints `Operation not permitted`, run it with sandbox bypass. The hooks themselves are unaffected: they write `$TMPDIR/oh-my-agy/<conversationId>.routing.json` on every user message, which is the quickest live health check.

### Uninstall

Delete the plugin directory and restart Antigravity. Workspace `.omagy/` and `omagy_wiki/` folders remain until you remove them.

## Usage

> **Full Guide**: See **[HOW_TO_USE.md](HOW_TO_USE.md)** for a complete walkthrough of all 27 skills (with flags and examples), all 18 role subagents, `.omagy/` state & crash-resilient ledgers, `omagy_wiki/` working agreements, lifecycle hooks, and end-to-end recipes.

In Antigravity, trigger skills with `/<skill>` in chat (for example `/autopilot build X`, `/deep-research --technical "topic"`, `/code-review`, `/handoff`, `/cancel`). `$<skill>` is also supported by the `PreInvocation` hook as an alias (useful if a name like `/plan` overlaps with Antigravity's built-in `/plan` slash command).

| Skill | Purpose |
|---|---|
| `/autopilot` | supervised `/deep-interview -> /ralplan -> /ultragoal` delivery |
| `/deep-interview` | Socratic interview with ambiguity scoring, `--ideate` 7-lens divergent concept shaping, and Two-Filter owner-decision gating (via `ask_question`) |
| `/plan` / `/ralplan` | explore-first lightweight plan / Planner -> Architect -> Critic consensus (plus `--hyperplan`) |
| `/ultragoal` | durable `goals.json` + `ledger.jsonl` execution with rigor tiering, Blind-Claim `AdversarialVerify`, and final review gates |
| `/team` | parallel subagent workers on a leader-owned DAG task board with completion evidence |
| `/code-review` | independent `code-reviewer` + `architect` lanes (Two-Axis + Demolition/ADR tests, `--re-review`, `--audit [path]` whole-repo lean audit, `--ship` production readiness), deterministic verdict |
| `/ultraqa` | 9-class trigger-mapped adversarial e2e QA cycles |
| `/deep-research`, `/analyze`, `/best-practice-research` | 4-lens deep research (`--technical`, `--business`, `--idea`, `--implementation`) with `>=85` scorecard audit, 6-tier evidence analysis (`--deep`, `--audit [path]`), and official-docs lookup |
| `/ai-slop-cleaner`, `/design`, `/loft`, `/pr`, `/visual-ralph` | anti-slop cleanup, `DESIGN.md` crafting, throwaway prototyping, PR assembly (`--ship`, `--watch`), and visual-diff loops |
| `/autoresearch`, `/performance-goal` | validator-gated research and benchmark optimization loops (with CWV/SQL/cache domain playbooks) |
| `/ask` | read-only `stdin`-sandboxed second opinion and `--doubt` blind-claim critique from local `claude` / `gemini` / `codex` CLIs |
| `/wiki` | repo markdown wiki (`omagy_wiki/index.md`) and working-agreement ledger (`omagy_wiki/agreements.md`) |
| `/handoff`, `/cancel`, `/hud`, `/doctor`, `/omagy-setup`, `/skill`, `/configure-notifications` | session handoff, workflow control, 5-tab Aux Pane HUD (`sidecar://oh-my-agy/hud/`), diagnostics, skill extraction & `$skill eval` routing benchmarks, and notifications |

## Architecture & Runtime Notes

- **Hooks & State Isolation**: `SessionStart` and `PreInvocation` inject `/skill` (and `$skill`) routing (while stripping code fences, blockquotes, relay headers, URLs, quoted strings, negations, and help queries), active `.omagy/state/` reminders, bounded (`<=3,500` chars) `omagy_wiki/agreements.md` + `omagy_wiki/index.md` context once per session (with `expires: <ISO 8601>` time-boxed expiry filtering and standalone secret redaction), a once-per-session shared-first `[oh-my-agy] Codebase map` (`<=1,800` chars, opt-out via `OMAGY_MAP=0`, configurable via `OMAGY_MAP_CHARS`; also appended to `goal-brief` packets), and unseen subdirectory `AGENTS.md` files and child-project `omagy_wiki/` along touched workspace paths. State files support conversation-owner isolation (`owner_conversation_id` and `.omagy/state/sessions/<conversationId>/`), environment overrides (`OMAGY_ROOT` / `OMAGY_STATE_ROOT`), parent-workspace anchoring, inner-folder `.omagy` discovery (`discoverOmagyScopes`), and multi-repo workspace anchoring (`.omagy-workspace`).
- **Bounded Continuation & Calibrated Drift Guard**: The `Stop` hook re-enters active autonomous loops at most 2 consecutive times without a state update, never on errors or while background tasks are running, enforces permission-denial / user-refusal finality (`blocked`), and ignores states older than 6 hours. On completion claims, `scanDiffBlockers` scans tracked `git diff` (via hunk-spoof-immune `parseUnifiedDiff`) and bounded untracked code files for left-behind blocker patterns (`test.skip`, `test.only`, placeholder `TODO: implement` / `throw new Error("Not implemented")`), unexempted checker suppressions (requiring `-- <reason>` or `shortcut:`), bare/placeholder empty `catch` blocks (exempting `/* fail open: ... */` or `shortcut:`), `omagy-ignore-start..end` / `simplify-ignore-start..end` protected-block tampering, and `open-caller:<symbol>` broken call sites of removed non-generic symbols (complemented by the 9-category `floor-guard` CLI).
- **Opt-In PreToolUse Guard**: `PreToolUse` ships disabled in `hooks.json` because Antigravity requires a `decision` when enabled. When opted in, it enforces the planning-phase write boundary across `Path`, `TargetFile`, `filePath`, rename/move, `edits[]`, and `apply_patch` (failing closed on targetless file-mutation tools), `protected-block-guard` (`reconstructPostEditContent` blocking edits/deletions to `omagy-ignore` and `simplify-ignore` regions), `agreements-guard` (preserving `[by:human]` lines in `omagy_wiki/agreements.md`), and `write-existing-file-guard` (requiring confirmation before overwriting an unread non-empty source file) without ever emitting `allow`.
- **Aux Pane HUD & Code Health Telemetry**: `sidecars/hud/main.mjs` serves the 5-tab `sidecar://oh-my-agy/hud/` web UI (`Overview`, `Workflows`, `Skills`, `Subagents`, `Wiki`), featuring live `Code Health & Technical Debt` KPIs (5s + git-mtime cached uncommitted `git diff` function reuse, orphaned call sites, secret-redacted `shortcut:` / `ceiling:` debt markers, and `floorGuard` anti-tampering counts), `Benchmarks & Autoresearch`, `Visual Ralph & Loft Prototypes`, `Diagnostics & Runtime Health` (including mtime-cached `Skill Eval`), and `X-Content-Type-Options: nosniff` artifact serving (`.md` as `text/plain; charset=utf-8`, including `.omagy/artifacts/ideas/`).
- **Subagents & Fallbacks**: `agents/*.md` defines 18 specialized subagents invoked via `invoke_subagent`. If a custom role is unavailable in a session, workflows fall back to Antigravity's built-in `self` or `research` subagent with the role's prompt preamble.

## License

[MIT](LICENSE). See [LICENSE](LICENSE) for full copyright notices.

## Credits

`oh-my-agy` synthesizes workflows, multi-agent patterns, and guardrails inspired by and adapted from:
- **[oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex)** by Yeachan Heo — foundational workflow chain (`deep-interview -> ralplan -> ultragoal`), durable state contracts, team evidence validation, and project wiki architecture.
- **[oh-my-claudecode (OMC)](https://github.com/Yeachan-Heo/oh-my-claudecode)** by Yeachan Heo — causal `tracer` agent, `code-simplifier` agent, `/loft` prototyping, `/pr` paper-trail assembly, Two-Axis + Demolition/ADR code review, session state isolation, and completion drift guards.
- **[oh-my-openagent / oh-my-opencode (OMO)](https://github.com/code-yeongyu/oh-my-openagent)** by Yeongyu Kim — explore-first `CLEAR`/`UNCLEAR` intent routing, Two-Filter owner-decision gating, `--hyperplan` 5-persona hostile cross-critique, `DoneClaim` / `AdversarialVerify` (`product` vs `harness` triage), `/handoff`, work-shape model routing, working-agreement ledgers, subdirectory `AGENTS.md` discovery, unread-overwrite guards, `check-test-junk` test-smell scanning, and `eval-integrity` audits.
- **[superpowers](https://github.com/obra/superpowers)** by Jesse Vincent — tactical TDD/debugging/verification gate functions (`Name the Break`, 4-layer defense-in-depth, condition-based waiting, `find-polluter` bisection, Red-Green revert verification), pre-assembled review packages & `--re-review` calibration, 4-state worker status (`COMPLETED_WITH_CONCERNS`, `NEEDS_CONTEXT`), `cost_if_wrong` review rulings, `$doctor --session` 7-dimension transcript forensics, and `$skill test` subagent pressure testing & SDO hygiene.
- **[Ponytail](https://github.com/dietrichgebert/ponytail)** (`@dietrichgebert/ponytail`) by Dietrich Gebert — shared-first codebase export map (`codebase-map` session & subagent brief injection), 6-Rung Reuse Ladder & Minimal Complete Change, Risky-Logic Test Rule, `shortcut: <ceiling>, <when to upgrade>` debt ledger (`scan-debt`), git-diff reuse & open-caller drift guard (`analyzeDiffCodeHealth`), caller-grep review rule, 4-part finding schema (`Location` + `Symptom` + `Why` + `Fix`), `Lean: -<N> lines` estimates, and `--audit` whole-repo quality & lean audit mode.
- **[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)** by Addy Osmani — calibrated anti-tampering floor guards (`floor-guard`, `omagy-ignore` protected blocks, structured suppression & empty-`catch` exemptions), TF-IDF skill routing benchmarks (`skill-eval`), fail-closed scanner gates (`quality-gate`), `--ideate` 7-lens divergent concept shaping, `--doubt` blind-claim verification & 4-tier `RECONCILE`, `--ship` production readiness & CWV Metric-Honesty playbooks, and OWASP LLM01–LLM10 / Expand-Contract specialist guardrails.
