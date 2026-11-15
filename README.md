# oh-my-agy

Multi-agent workflow layer for [Google Antigravity](https://antigravity.google).

`oh-my-agy` brings structured, evidence-backed agentic engineering to Antigravity with zero external CLI dependencies:
- **Supervised Autopilot**: `/deep-interview -> /ralplan -> /ultragoal` end-to-end delivery (`/autopilot`)
- **Divergent Ideation, Consensus & Migration Planning**: 7-lens divergent concept shaping (`/deep-interview --ideate`), lightweight single-lane planning (`/ralplan --light`), Planner -> Architect -> Critic consensus (`/ralplan`), 5-persona hostile cross-critique (`/ralplan --hyperplan`), strangler-fig & EARS migration plans (`/ralplan --migrate`), and SHA-256 + fake-timeline plan receipts (`plan-hash`)
- **Durable Goal Ledgers, Shadow Checkpoints & Receipt-Backed Verification**: repo-native `goals.json` + `ledger.jsonl` + compaction-resilient `notepad.md` execution (`/ultragoal`) with test-gated `goal-done`, stash-free index-preserving git checkpoints (`checkpoint` under `refs/omagy/checkpoints/*`), `stale-after-edit` completion freshness guards, Blind-Claim `AdversarialVerify` packets, and 4-tier `RECONCILE` rulings
- **Coordinated Subagent Teams & Arena Bake-Offs**: parallel `executor` worker waves on a leader-owned DAG task board (`/team`, including `--amend` live re-planning and `--arena` multi-candidate bake-offs) with work-shape model routing (`flash` / `inherit` / `pro`) and verified completion evidence
- **Google Stitch 2-Layer `DESIGN.md` & Visual QA**: unified design-system authoring and visual-diff implementation (`/visual-ralph --design`) with 3-level nested YAML tokens, 8 canonical Stitch prose sections, 5 AA-compliant starter presets, pure-Node WCAG 2.1 AA/AAA linting (`validate-design-md`), Craft Floor `A12`–`F9`, and optional `StitchMCP` synchronization
- **Adversarial QA, Dual-Lane Review, Modernization, Threat-Modeling & Ship Gates**: 9-class dynamic QA with browser settle & DOM quarantine (`/ultraqa`), Two-Axis + Demolition/ADR code review (`/code-review`, including `--audit [path]`, `--ship`, and `--security` `STRIDE` + `OWASP` + `lookout` hazard scans), phased dependency/framework upgrades (`/modernize`), `STRIDE` + OWASP Agentic threat modeling (`/threat-model`), end-to-end versioned release engineering (`/release`), and fail-closed `semgrep`/`axe` checks (`quality-gate`)
- **Codebase Reuse Map, Anti-Tampering Floor Guard, Audit CLIs & HUD Telemetry**: shared-first `[oh-my-agy] Codebase map` injection (`codebase-map`), 6-Rung Reuse Ladder, `shortcut:` debt ledger (`scan-debt`), `omagy-ignore-start..end` protected blocks, 10-category `floor-guard`, static repository audits (`docs-drift`, `coverage-map`, `dep-license-diff`, `mcp-audit`), and `95%`-ratcheted TF-IDF skill routing checks (`skill-eval`) surfaced live in the Aux Pane HUD (`sidecar://oh-my-agy/hud/`)
- **Multi-Lens, Quick & Loop Deep Research**: 5-phase technical, business, idea, and implementation investigations (`/deep-research`), bounded upstream docs lookups (`/deep-research --quick`), and validator-gated research loops (`/deep-research --loop`) with Tier A–E source ranking and a 5-dimension `>=85` self-audit
- **18 Role Subagents & 23 Workflow Skills**: spike-verified 3-tier `tools:` YAML frontmatter (`supply-chain-auditor`, `devops-engineer`, `runtime-qa`, `doc-steward` added cleanly beside the 14-agent core), causal hypothesis tracing (`tracer`), blast-radius & statechart mapping (`/analyze --blast-radius|--statechart`), throwaway & arena prototyping (`/loft --arena`), `stdin`-sandboxed external second opinions (`/ask --doubt`), PR paper-trail assembly (`/pr --ship` / `--watch`), session handoff (`/hud --handoff`), setup/notifications/forensics (`/doctor --setup|--notifications|--init-deep|--session-scan`), and persistent markdown wiki (`/wiki` with CJK `wiki-query` & dead-ref `wiki-lint`)

All workflow state is plain JSON and Markdown under `.omagy/`, and the lifecycle hooks run on a dependency-free modular Node.js runtime (`hooks/omagy-hook.mjs` `<-` `{hooks/omagy-skill.mjs, hooks/omagy-cli.mjs, hooks/omagy-audit.mjs, hooks/omagy-host-setup.mjs}` `<-` `hooks/omagy-selftest.mjs`, with `omagy-hook.mjs` loading zero cold modules on lifecycle events).

## Live Auxiliary Pane HUD (`sidecars/hud/`)

`oh-my-agy` includes a modular, zero-dependency Auxiliary Pane workbench (`sidecar://oh-my-agy/hud/`) in [`sidecars/hud/`](sidecars/hud/) so you can monitor active autonomous runs, inspect artifacts, launch skills or subagents, and explore your project wiki without leaving the IDE:

![oh-my-agy Auxiliary Pane HUD](assets/sidecar-hud.gif)

- **How to Open**: Run `/hud` in chat and click `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)`, or toggle **Oh My Agy** in Antigravity's Auxiliary Pane extensions bar.
- **Real-Time Multi-Workspace Workbench**: Streams `.omagy/` and `omagy_wiki/` changes over debounced `GET /api/events` SSE (`150 ms` watcher debounce + `15 s` fallback poll) with stateful DOM preservation, a top-bar multi-workspace switcher (`?activeRoot=`), inner-folder scope filter chips, one-click `Handoff` (`/hud --handoff`), and a `Cmd/Ctrl+K` Command Palette indexing Views, Skills, Subagents, Artifacts, and Wiki pages.
- **Overview Telemetry, DAG Waves & Slide-Over `#artifact-drawer`**: Tracks the `Current Workflow Mode` spotlight with contextual remediation buttons (`/cancel`, `/doctor`, `/wiki lint`), Ultragoal & Team Task DAG wave progress with JSON `Receipt` previews (`.omagy/evidence/*.json`, `.omagy/plans/ralplan-review-*.json`), a 3-mode Visual Ralph comparator (`side-by-side`, `split-slider`, `onion-skin`), an opaque-origin `srcdoc` Loft prototype sandbox, Code Health & `floor-guard` KPIs, Shadow Git Checkpoints, Google Stitch `DESIGN.md` WCAG contrast checks, Session Transcript Forensics, Notification readiness flags, and Doctor diagnostics.
- **Interactive Launchers, Skill `SKILL.md` Previews & 3D `Wiki` Mind-Map**: Provides animated horizontally scrollable `Workflows` pipelines, inline-editable `agentapi` prompt launchers (`Run in Chat`, `New Chat`, `Dispatch into Active Chat`, `Launch Standalone Chat`), `--flag` composer chips, **`Preview` buttons on every `Skills` card** (`GET /api/skill-doc` rendering `SKILL.md` + `references/*.md` playbooks in `#artifact-drawer`), Subagent `Model` tier pills (`inherit` | `flash_lite` | `flash` | `pro`), and an interactive 3D Canvas `Wiki` mind-map (`3D Map` / `List` switch) with server-indexed `/api/wiki-search`, TOC jump chips, computed `[[slug]]` backlinks, `omagy_wiki/log.md` activity, and left-rule Working Agreements.

> See [HOW_TO_USE.md — Section 7](HOW_TO_USE.md#7-live-auxiliary-pane-hud-sidecarshud) for the complete tab, keyboard shortcut, and security reference.

## Requirements

- Antigravity with plugin support (skills, agents, rules, hooks).
- Node.js 18 or newer for lifecycle hooks. Without Node, the hooks fail open and skills still work via the operating rules.

## Layout

```text
oh-my-agy/
├── .gitattributes            # LF line-ending normalization across POSIX & Windows checkouts
├── .github/workflows/ci.yml  # 3-OS GitHub Actions CI matrix (ubuntu, macos, windows on Node 20)
├── plugin.json               # Antigravity manifest (v0.7.0, strict JSON)
├── assets/
│   ├── logo.png              # Plugin icon
│   └── sidecar-hud.gif       # Live Aux Pane HUD showcase animation
├── HOW_TO_USE.md             # Complete guide to all 23 skills, 18 subagents, hooks & recipes
├── rules/AGENTS.md           # always-on operating contract (<24 KB)
├── hooks.json                # SessionStart + PreInvocation routing/wiki, Stop continuation, opt-in PreToolUse guard
├── hooks/
│   ├── run.sh                # POSIX-portable Node locator, dual OMAGY_HOST/--host= routing, fail-open on lifecycle hooks
│   ├── omagy-hook.mjs        # hot-path hook runtime (<170 KB: SessionStart, PreInvocation, PreToolUse, Stop & state primitives)
│   ├── omagy-host.mjs        # polyglot Claude/Codex wire codecs, Desktop session gating, bundle drift & transcript normalization
│   ├── omagy-host-setup.mjs  # lazy-loaded `host-setup` & `host-validate` generator for Claude Code & OpenAI Codex
│   ├── omagy-skill.mjs       # lazy-loaded non-lifecycle CLI dispatcher + zero-dep `skill-validate` & `skill-init` (`38` total CLI subcommands)
│   ├── omagy-cli.mjs         # lazy-loaded zero-dep cold CLI (<90 KB; 13 COLD_CLI_EVENTS)
│   ├── omagy-audit.mjs       # lazy-loaded repo audit CLIs (`docs-drift`, `coverage-map`, `dep-license-diff`, `mcp-audit`)
│   ├── omagy-selftest.mjs    # lazy-loaded 93-check offline selftest suite (`T1`–`T10`, `T20`–`T58`)
│   └── skill-eval-cases.json # 23-skill positive + owner-paired negative routing benchmark corpus (>=95% rank-1)
├── sidecars/hud/             # Modular Desktop-only HUD (`main.mjs` + `dispatch.mjs` + `ui.mjs` + `client.mjs`: SSE, `desktop-serve`, Codex WS, 5 tabs, 11 workflows)
├── agents/                   # 18 role subagents with verified `subagent`/`mainAgent`/`tools` frontmatter
└── skills/                   # 23 workflow skills + progressive-disclosure `references/`
```

## Install

Antigravity loads plugins from its discovery roots, so clone the repository into one:

```bash
# user scope: available in every workspace
git clone https://github.com/Yomudogly/oh-my-agy.git ~/.gemini/config/plugins/oh-my-agy

# or project scope: only this repository (commit it to share with your team)
git clone https://github.com/Yomudogly/oh-my-agy.git .agents/plugins/oh-my-agy
```

Restart Antigravity (new plugin directories are discovered at startup), then run `/doctor` (or `/doctor --setup` to bootstrap project `AGENTS.md` and `.gitignore`). Add `.omagy/` to your project's `.gitignore`.

On macOS, keep the real plugin directory in the discovery root. Do not make it a symlink into `~/Documents`, `~/Desktop`, or `~/Downloads`, because Antigravity's sandboxed terminal cannot read those folders.

### Update

```bash
git -C ~/.gemini/config/plugins/oh-my-agy pull
```

Then restart Antigravity. See [CHANGELOG.md](CHANGELOG.md) for release notes.

### Verify

Run the offline hook, routing, and HUD selftests at any time:

```bash
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest     # -> {"selftest":"PASS","passed":93,"failed":0}
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-eval --min-rank1 95 # -> SKILL-EVAL: PASS (skills=23, ...)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-validate ~/.gemini/config/plugins/oh-my-agy/skills --strict
sh ~/.gemini/config/plugins/oh-my-agy/sidecars/hud/run.sh selftest # -> {"selftest":"PASS",...}
```

### Claude Code & OpenAI Codex Compatibility (Experimental)

> [!WARNING]
> **Experimental Support**: `oh-my-agy` is built and battle-tested primarily for **Google Antigravity**. The **OpenAI Codex** and **Claude Code** adapters below are **experimental** — they pass strict schema, hook-protocol, and selftest suites, but have not yet been exhaustively field-tested and confirmed across every Codex and Claude CLI/Desktop workflow. Please report edge cases on GitHub Issues.

The canonical repository stays pure Antigravity while generating and validating host-native, **self-contained copy installs by default** (zero symlinks to Antigravity; pass `--symlink` only if contributing from a live checkout).

#### 1. Global Install — Standalone (No Antigravity Required)

**OpenAI Codex / Codex Desktop** (installs into `~/.codex`, or `$CODEX_HOME` if set):

```bash
git clone https://github.com/Yomudogly/oh-my-agy.git /tmp/oh-my-agy
sh /tmp/oh-my-agy/hooks/run.sh host-setup codex
sh /tmp/oh-my-agy/hooks/run.sh host-validate codex --strict --json
rm -rf /tmp/oh-my-agy
```

**Claude Code / Claude Desktop** (installs into `~/.claude`, or `$CLAUDE_CONFIG_DIR` if set):

```bash
git clone https://github.com/Yomudogly/oh-my-agy.git /tmp/oh-my-agy
sh /tmp/oh-my-agy/hooks/run.sh host-setup claude
sh /tmp/oh-my-agy/hooks/run.sh host-validate claude --strict --json
rm -rf /tmp/oh-my-agy
```

*(Add `--codex-home /custom/path` only if installing into a non-default Codex folder; `/tmp/oh-my-agy` is safe to delete after validation because all bundle files are copied standalone.)*

#### 2. Global Install — From an Existing Antigravity Checkout

If you already cloned `oh-my-agy` at `~/.gemini/config/plugins/oh-my-agy`:

```bash
# OpenAI Codex / Codex Desktop
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-setup codex
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-validate codex --strict --json

# Claude Code / Claude Desktop
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-setup claude
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-validate claude --strict --json
```

#### 3. First-Run Activation (Codex & Claude Code)

- **OpenAI Codex / Codex Desktop**:
  - Registers a native local Codex UI plugin (`oh-my-agy@oh-my-agy-local`) across `~/.codex/marketplaces/oh-my-agy`, `~/.codex/plugins/cache/oh-my-agy-local/oh-my-agy/<version>`, `~/.codex/plugins/oh-my-agy`, `~/.codex/agents/*.toml`, adapted `~/.codex/AGENTS.md` (zero `Antigravity`/`sidecar://` mentions), and `~/.codex/config.toml` (`[agents].enabled = true` and `[features].hooks = true`, stripping deprecated `[features].multi_agent` while preserving `[mcp_servers]`, `[projects]`, and `[hooks.state]`). Legacy duplicate `oh-my-agy` entries in `~/.codex/hooks.json` and `~/.codex/skills/` are automatically cleaned without touching `.system/` or custom user files.
  - Reload Codex Desktop so **Oh My Agy** appears under **Installed Plugins** (note: Codex's plugin detail UI currently lists **Skills** and **Hooks**, while custom role agents load from `~/.codex/agents/*.toml` and `[agents.<role>]` in `config.toml`), approve hooks once via `/hooks`, and run `/hud` (or `$hud`) inside Codex Desktop to launch/reuse the localhost HUD (`#212121` theme, Copy-only prompt buttons) and print a clickable `[oh-my-agy HUD](http://127.0.0.1:<port>/)` link.
- **Claude Code / Claude Desktop**:
  - Installs a standalone `~/.claude/plugins/oh-my-agy` bundle and adapted global rules at `~/.claude/rules/oh-my-agy.md`. Load the plugin in Claude Code sessions with `claude --plugin-dir ~/.claude/plugins/oh-my-agy`.

#### 4. Updating Codex & Claude Code Setups

Updating an existing installation uses the exact same `host-setup` command — it idempotently refreshes standalone copied files, updates the versioned Codex plugin cache (`~/.codex/plugins/cache/oh-my-agy-local/oh-my-agy/<version>`), refreshes adapted rules, and migrates `config.toml` flags without overwriting your MCP servers, `[projects]`, `[hooks.state]`, or custom skills:

```bash
# Option A: If you keep the clone at ~/.gemini/config/plugins/oh-my-agy
git -C ~/.gemini/config/plugins/oh-my-agy pull
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-setup codex
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-validate codex --strict --json
# (Replace `codex` with `claude` to update Claude Code)
```

```bash
# Option B: Standalone update without keeping a local clone
git clone https://github.com/Yomudogly/oh-my-agy.git /tmp/oh-my-agy
sh /tmp/oh-my-agy/hooks/run.sh host-setup codex
sh /tmp/oh-my-agy/hooks/run.sh host-validate codex --strict --json
rm -rf /tmp/oh-my-agy
```

After updating, reload Codex Desktop (or start a fresh Claude Code session). If a Desktop HUD daemon from the prior version is already running, restart it before running `/hud` again:

```bash
pkill -f "sidecars/hud/main.mjs desktop-serve" || true
```

#### 5. Single-Project Install (Optional — Run Inside a Repo)

```bash
# OpenAI Codex (writes <repo>/.codex/ + repo AGENTS.md)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-setup codex --workspace .
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-validate codex --workspace . --strict --json

# Claude Code / Claude Desktop (writes <repo>/.claude/ + .claude/launch.json HUD Preview)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-setup claude --workspace .
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh host-validate claude --workspace . --strict --json
```

- **Desktop-Only HUD Preview**: Auto-started loopback `desktop-serve` previews run **only on Desktop apps** (Claude Desktop `.claude/launch.json` `oh-my-agy-hud` on `48800..49799` or daemon `47800..48799`, and Codex Desktop Web Preview on `47800..48799`, plus `sidecars/hud/run.sh desktop-ensure` on demand). Plain CLI, IDE extensions, and CI never spawn the HUD daemon unless `OMAGY_DESKTOP_HUD=1` is set on a Desktop session (`OMAGY_DESKTOP_HUD=0` forces off).

Antigravity's sandboxed terminal may deny reading plugin files directly. If the selftest prints `Operation not permitted`, run it with sandbox bypass. The hooks themselves are unaffected: they write `$TMPDIR/oh-my-agy/<conversationId>.routing.json` on every user message, which is the quickest live health check.

### Uninstall

Delete the plugin directory and restart Antigravity. Workspace `.omagy/` and `omagy_wiki/` folders remain until you remove them.

## Usage

> **Full Guide**: See **[HOW_TO_USE.md](HOW_TO_USE.md)** for a complete walkthrough of all 23 skills (with flags and examples), all 18 role subagents, `.omagy/` state & crash-resilient ledgers, `omagy_wiki/` working agreements, lifecycle hooks, all 38 CLI utilities, and end-to-end recipes.

In Antigravity, trigger skills with `/<skill>` in chat (for example `/autopilot build X`, `/deep-research --technical "topic"`, `/visual-ralph --design`, `/code-review --security`, `/threat-model`, `/modernize`, `/release`, `/hud --handoff`, `/cancel`). `$<skill>` is also supported by the `PreInvocation` hook as an alias.

| Skill | Purpose |
|---|---|
| `/autopilot` | supervised `/deep-interview -> /ralplan -> /ultragoal` delivery |
| `/deep-interview` | Socratic interview with ambiguity scoring, `--ideate` 7-lens divergent concept shaping, `--autoresearch` loop specs, and Two-Filter owner-decision gating (via `ask_question`) |
| `/ralplan` | Planner -> Architect -> Critic consensus planning (`--hyperplan` 5-persona tournament, `--light` single-lane plan, `--interview`, `--review`, `--migrate` strangler/EARS plan + SHA-256 `plan-hash` receipt) |
| `/ultragoal` | durable `goals.json` + `ledger.jsonl` + `notepad.md` execution with `goal-done`, stash-free git `checkpoint`, `plan-hash verify`, and Blind-Claim `AdversarialVerify` |
| `/team` | parallel `executor` subagent workers on a leader-owned DAG task board (`--amend` live task edits, `--arena` isolated bake-offs) with verified completion evidence |
| `/code-review` | independent `code-reviewer` + `architect` lanes (`Confidence: HIGH\|MEDIUM\|LOW`, `--re-review`, `--audit [path]` lean audit, `--ship` production readiness, `--security` `STRIDE` + `OWASP` + `lookout` hazard check) |
| `/ultraqa` | 9-class trigger-mapped adversarial e2e QA cycles with `failure-sig` deduplication and browser settle/DOM quarantine |
| `/deep-research` | 4-lens deep research (`--technical`, `--business`, `--idea`, `--implementation`) with `>=85` self-audit, `--quick` upstream docs lookup, and `--loop` validator-gated iteration |
| `/analyze` | 6-tier evidence root-cause synthesis (`--deep` parallel `tracer`, `--audit [path]` lean audit, `--blast-radius` caller impact, `--statechart` Mermaid `stateDiagram-v2`) |
| `/visual-ralph` | visual-diff frontend loop + `--design` Google Stitch 2-Layer `DESIGN.md` authoring, 5 AA starter presets, `validate-design-md` WCAG linter, and `StitchMCP` sync |
| `/loft`, `/ai-slop-cleaner`, `/pr` | throwaway & `--arena` prototyping, 4-pass anti-slop cleanup, and PR assembly (`--ship`, `--watch`) |
| `/modernize`, `/threat-model`, `/release` | phased dependency/framework upgrade waves (`--plan`, `--dry-run`, `--wave`), trust-boundary `STRIDE` + OWASP Agentic/MCP risk modeling, and versioned release readiness & rollback playbooks |
| `/performance-goal` | evaluator-gated benchmark optimization loops (with CWV/SQL/cache domain playbooks) |
| `/ask` | read-only `stdin`-sandboxed second opinion and `--doubt` blind-claim critique from local `claude` / `gemini` / `codex` CLIs |
| `/wiki` | repo markdown wiki (`omagy_wiki/index.md`), working agreements (`omagy_wiki/agreements.md`), CJK `wiki-query`, and dead-ref `wiki-lint` |
| `/hud`, `/cancel`, `/doctor`, `/skill` | live SSE 5-tab Aux Pane HUD (`sidecar://oh-my-agy/hud/`, `Cmd/Ctrl+K` palette, `#artifact-drawer`, Skill `SKILL.md` previews, 11 workflows) & `--handoff` packets, exact-scope cancellation, diagnostics & setup (`--setup`, `--notifications`, `--init-deep`, `--session`, `--session-compare`, `--session-scan`), and full skill authoring lifecycle (`init`, `validate`, `sync`, `eval`, `test`, `extract`, `.agents/skills.json`) |

## Architecture & Runtime Notes

- **Hooks, Compaction Recovery & State Isolation**: `SessionStart` and `PreInvocation` strip UTF-8 BOMs, sanitize `[Message ...]` / `<SYSTEM_MESSAGE>` / `<CONTEXT_SUMMARY>` relay blocks (`sanitizeRelayedText`) alongside code fences, blockquotes, URLs, quotes, negations, and help queries before `/skill` / `$skill` detection, and cap `injectSteps[0].ephemeralMessage` deterministically at `<= 6,000` chars. When `<CONTEXT_SUMMARY>` compaction is detected (`compactionEpoch`), `PreInvocation` automatically re-injects `omagy_wiki/` (`<= 3,500` chars, expiry-filtered & secret-redacted) plus `.omagy/ultragoal/notepad.md` (`<= 2,000` chars). A shared-first `[oh-my-agy] Codebase map` (`<= 1,800` chars, opt-out via `OMAGY_MAP=0`) and nested subdirectory `AGENTS.md` / child `omagy_wiki/` files are injected on demand.
- **Bounded Continuation, Context-Overflow Bail-Out & Freshness/Drift Guards**: `Stop` exits immediately on context-overflow errors (`isContextOverflowStop`), re-enters active autonomous loops at most 2 consecutive times without a state update, honors `awaiting_confirmation` holds, and enforces permission-denial / user-refusal finality (`blocked`). On completion claims, `checkVerificationFreshness` inspects the trailing `<= 512 KB` of the transcript to nudge once (`runtimeFile(conv, 'freshness')`) when code files outside `.omagy/`, `omagy_wiki/`, and `<appDataDir>/brain/` were edited after the last passing test or when the last test failed, while `scanDiffBlockers` (`runtimeFile(conv, 'drift')`) catches left-behind blockers, unexempted suppressions, bare empty `catch` blocks, protected-block tampering, and `open-caller:<symbol>` broken call sites.
- **Opt-In PreToolUse Guard**: When enabled in `hooks.json`, `PreToolUse` enforces `append-only-guard` (blocking `Overwrite: true` on non-empty `.omagy/ultragoal/ledger.jsonl` and `omagy_wiki/log.md` even during planning), the planning-phase write boundary (`Path`, `TargetFile`, `filePath`, rename/move, `edits[]`, `apply_patch`), `protected-block-guard` (`omagy-ignore` / `simplify-ignore`), `agreements-guard` (`[by:human]` preservation), and `write-existing-file-guard` (unread `Overwrite: true` protection).
- **Live Aux Pane HUD, Slide-Over Drawer & Workbench Telemetry**: `sidecars/hud/{main,ui,client}.mjs` serve the live 5-tab `sidecar://oh-my-agy/hud/` web UI (`Overview`, `Workflows`, `Skills`, `Subagents`, `Wiki`) with **11** declarative `WORKFLOW_BLUEPRINTS`, debounced `GET /api/events` SSE (`150 ms` watcher debounce + `15 s` poll fallback + digest-diffed DOM preservation), `?activeRoot=` workspace & scope filtering, `Cmd/Ctrl+K` Command Palette, a Slide-Over `#artifact-drawer` (JSON `Receipt` previews, 3-mode Visual Ralph comparator, opaque-origin `srcdoc` Loft `<iframe sandbox="allow-scripts">` with relative ES module bundling and `omagy-loft-error` banner bridge, `GET /api/skill-doc` previews for `SKILL.md` + `references/*.md` with SDO tag headings, and secret-redacted XSS-safe Markdown previews across `.omagy/{artifacts,plans,specs,evidence,ultragoal,goals}`), `GET /api/wiki-search` + TOC chips + backlinks, interactive `--flag` chips & `Model` pills, `customization://oh-my-agy` quick actions, Antigravity light/dark CSS tokens (`>= 12px`), Team DAG wave bars, and Governance cards (`Code Health`, `Shadow Checkpoints`, `Stitch DESIGN.md`, `Session Forensics`, `Notifications`, `Diagnostics & Runtime Health`).
- **18 Subagents & Scoped Tooling**: `agents/*.md` defines 18 specialized subagents with `subagent: true`, `mainAgent: false`, and 3-tier `tools:` YAML arrays (`6` write roles, `10` repo-inspecting read-only roles, `2` pure read/web roles), `context7` and `codegraph_explore` fast paths, and built-in `self` / `research` fallback support.

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
