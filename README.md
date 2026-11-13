# oh-my-agy

Multi-agent workflow layer for [Google Antigravity](https://antigravity.google).

`oh-my-agy` brings structured, evidence-backed agentic engineering to Antigravity with zero external CLI dependencies:
- **Supervised Autopilot**: `/deep-interview -> /ralplan -> /ultragoal` end-to-end delivery (`/autopilot`)
- **Divergent Ideation, Consensus & Migration Planning**: 7-lens divergent concept shaping (`/deep-interview --ideate`), lightweight single-lane planning (`/ralplan --light`), Planner -> Architect -> Critic consensus (`/ralplan`), 5-persona hostile cross-critique (`/ralplan --hyperplan`), strangler-fig & EARS migration plans (`/ralplan --migrate`), and SHA-256 + fake-timeline plan receipts (`plan-hash`)
- **Durable Goal Ledgers, Shadow Checkpoints & Receipt-Backed Verification**: repo-native `goals.json` + `ledger.jsonl` + compaction-resilient `notepad.md` execution (`/ultragoal`) with test-gated `goal-done`, stash-free index-preserving git checkpoints (`checkpoint` under `refs/omagy/checkpoints/*`), `stale-after-edit` completion freshness guards, Blind-Claim `AdversarialVerify` packets, and 4-tier `RECONCILE` rulings
- **Coordinated Subagent Teams & Arena Bake-Offs**: parallel `executor` worker waves on a leader-owned DAG task board (`/team`, including `--amend` live re-planning and `--arena` multi-candidate bake-offs) with work-shape model routing (`flash` / `inherit` / `pro`) and verified completion evidence
- **Google Stitch 2-Layer `DESIGN.md` & Visual QA**: unified design-system authoring and visual-diff implementation (`/visual-ralph --design`) with 3-level nested YAML tokens, 8 canonical Stitch prose sections, 5 AA-compliant starter presets, pure-Node WCAG 2.1 AA/AAA linting (`validate-design-md`), Craft Floor `A12`–`F9`, and optional `StitchMCP` synchronization
- **Adversarial QA, Dual-Lane Review & Security/Ship Gates**: 9-class dynamic QA with browser settle & DOM quarantine (`/ultraqa`), Two-Axis + Demolition/ADR code review (`/code-review`, including `--audit [path]`, `--ship`, and `--security` `STRIDE` + `OWASP` + `lookout` hazard scans), and fail-closed `semgrep`/`axe` checks (`quality-gate`)
- **Codebase Reuse Map, Anti-Tampering Floor Guard & HUD Telemetry**: shared-first `[oh-my-agy] Codebase map` injection (`codebase-map`), 6-Rung Reuse Ladder, `shortcut:` debt ledger (`scan-debt`), `omagy-ignore-start..end` protected blocks, 9-category `floor-guard`, and `95%`-ratcheted TF-IDF skill routing checks (`skill-eval`) surfaced live in the Aux Pane HUD (`sidecar://oh-my-agy/hud/`)
- **Multi-Lens, Quick & Loop Deep Research**: 5-phase technical, business, idea, and implementation investigations (`/deep-research`), bounded upstream docs lookups (`/deep-research --quick`), and validator-gated research loops (`/deep-research --loop`) with Tier A–E source ranking and a 5-dimension `>=85` self-audit
- **14 Role Subagents & 20 Workflow Skills**: spike-verified 3-tier `tools:` YAML frontmatter, causal hypothesis tracing (`tracer`), blast-radius & statechart mapping (`/analyze --blast-radius|--statechart`), throwaway & arena prototyping (`/loft --arena`), `stdin`-sandboxed external second opinions (`/ask --doubt`), PR paper-trail assembly (`/pr --ship` / `--watch`), session handoff (`/hud --handoff`), setup/notifications/forensics (`/doctor --setup|--notifications|--init-deep|--session-scan`), and persistent markdown wiki (`/wiki` with CJK `wiki-query` & dead-ref `wiki-lint`)

All workflow state is plain JSON and Markdown under `.omagy/`, and the lifecycle hooks run on a dependency-free 4-module Node.js runtime (`hooks/omagy-hook.mjs` `<-` `{hooks/omagy-skill.mjs, hooks/omagy-cli.mjs}` `<-` `hooks/omagy-selftest.mjs`, with `omagy-hook.mjs` loading zero cold modules on lifecycle events).

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
├── plugin.json               # Antigravity manifest (v0.5.2, strict JSON)
├── assets/
│   ├── logo.png              # Plugin icon
│   └── sidecar-hud.gif       # Live Aux Pane HUD showcase animation
├── HOW_TO_USE.md             # Complete guide to all 20 skills, 14 subagents, hooks & recipes
├── rules/AGENTS.md           # always-on operating contract (<24 KB)
├── hooks.json                # SessionStart + PreInvocation routing/wiki, Stop continuation, opt-in PreToolUse guard
├── hooks/
│   ├── run.sh                # POSIX-portable Node locator (homebrew/volta/fnm/nvm/Windows), fails open on lifecycle hooks
│   ├── omagy-hook.mjs        # hot-path hook runtime (<170 KB: SessionStart, PreInvocation, PreToolUse, Stop & state primitives)
│   ├── omagy-skill.mjs       # lazy-loaded non-lifecycle CLI dispatcher + zero-dep `skill-validate` & `skill-init` (`32` total CLI subcommands)
│   ├── omagy-cli.mjs         # lazy-loaded zero-dep cold CLI (<93,734 B; 13 subcommands: `floor-guard`, `skill-eval`, `quality-gate`, `validate-design-md`, `goal-done`, `checkpoint`, `handoff`, `lookout`, `plan-hash`, `init-deep-scan`, `wiki-query`, `wiki-lint`, `session-scan` & static validators)
│   ├── omagy-selftest.mjs    # lazy-loaded 87-check offline selftest suite (`T1`–`T10`, `T20`–`T52`)
│   └── skill-eval-cases.json # 20-skill positive + owner-paired negative routing benchmark corpus (>=95% rank-1)
├── sidecars/hud/             # Modular Aux Pane UI (`main.mjs` + `ui.mjs` + `client.mjs`: SSE `/api/events`, `Cmd/Ctrl+K` palette, `#artifact-drawer`, `/api/skill-doc`, `/api/wiki-search`, 5 tabs)
├── agents/                   # 14 role subagents with verified `subagent`/`mainAgent`/`tools` frontmatter
└── skills/                   # 20 workflow skills + progressive-disclosure `references/`
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
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest     # -> {"selftest":"PASS","passed":87,"failed":0}
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-eval --min-rank1 95 # -> SKILL-EVAL: PASS (skills=20, ...)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-validate ~/.gemini/config/plugins/oh-my-agy/skills --strict
sh ~/.gemini/config/plugins/oh-my-agy/sidecars/hud/run.sh selftest # -> {"selftest":"PASS",...}
```

Antigravity's sandboxed terminal may deny reading plugin files directly. If the selftest prints `Operation not permitted`, run it with sandbox bypass. The hooks themselves are unaffected: they write `$TMPDIR/oh-my-agy/<conversationId>.routing.json` on every user message, which is the quickest live health check.

### Uninstall

Delete the plugin directory and restart Antigravity. Workspace `.omagy/` and `omagy_wiki/` folders remain until you remove them.

## Usage

> **Full Guide**: See **[HOW_TO_USE.md](HOW_TO_USE.md)** for a complete walkthrough of all 20 skills (with flags and examples), all 14 role subagents, `.omagy/` state & crash-resilient ledgers, `omagy_wiki/` working agreements, lifecycle hooks, all 32 CLI utilities, and end-to-end recipes.

In Antigravity, trigger skills with `/<skill>` in chat (for example `/autopilot build X`, `/deep-research --technical "topic"`, `/visual-ralph --design`, `/code-review --security`, `/hud --handoff`, `/cancel`). `$<skill>` is also supported by the `PreInvocation` hook as an alias.

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
| `/performance-goal` | evaluator-gated benchmark optimization loops (with CWV/SQL/cache domain playbooks) |
| `/ask` | read-only `stdin`-sandboxed second opinion and `--doubt` blind-claim critique from local `claude` / `gemini` / `codex` CLIs |
| `/wiki` | repo markdown wiki (`omagy_wiki/index.md`), working agreements (`omagy_wiki/agreements.md`), CJK `wiki-query`, and dead-ref `wiki-lint` |
| `/hud`, `/cancel`, `/doctor`, `/skill` | live SSE 5-tab Aux Pane HUD (`sidecar://oh-my-agy/hud/`, `Cmd/Ctrl+K` palette, `#artifact-drawer`, Skill `SKILL.md` previews) & `--handoff` packets, exact-scope cancellation, diagnostics & setup (`--setup`, `--notifications`, `--init-deep`, `--session`, `--session-compare`, `--session-scan`), and full skill authoring lifecycle (`init`, `validate`, `sync`, `eval`, `test`, `extract`, `.agents/skills.json`) |

## Architecture & Runtime Notes

- **Hooks, Compaction Recovery & State Isolation**: `SessionStart` and `PreInvocation` strip UTF-8 BOMs, sanitize `[Message ...]` / `<SYSTEM_MESSAGE>` / `<CONTEXT_SUMMARY>` relay blocks (`sanitizeRelayedText`) alongside code fences, blockquotes, URLs, quotes, negations, and help queries before `/skill` / `$skill` detection, and cap `injectSteps[0].ephemeralMessage` deterministically at `<= 6,000` chars. When `<CONTEXT_SUMMARY>` compaction is detected (`compactionEpoch`), `PreInvocation` automatically re-injects `omagy_wiki/` (`<= 3,500` chars, expiry-filtered & secret-redacted) plus `.omagy/ultragoal/notepad.md` (`<= 2,000` chars). A shared-first `[oh-my-agy] Codebase map` (`<= 1,800` chars, opt-out via `OMAGY_MAP=0`) and nested subdirectory `AGENTS.md` / child `omagy_wiki/` files are injected on demand.
- **Bounded Continuation, Context-Overflow Bail-Out & Freshness/Drift Guards**: `Stop` exits immediately on context-overflow errors (`isContextOverflowStop`), re-enters active autonomous loops at most 2 consecutive times without a state update, honors `awaiting_confirmation` holds, and enforces permission-denial / user-refusal finality (`blocked`). On completion claims, `checkVerificationFreshness` inspects the trailing `<= 512 KB` of the transcript to nudge once (`runtimeFile(conv, 'freshness')`) when code files outside `.omagy/`, `omagy_wiki/`, and `<appDataDir>/brain/` were edited after the last passing test or when the last test failed, while `scanDiffBlockers` (`runtimeFile(conv, 'drift')`) catches left-behind blockers, unexempted suppressions, bare empty `catch` blocks, protected-block tampering, and `open-caller:<symbol>` broken call sites.
- **Opt-In PreToolUse Guard**: When enabled in `hooks.json`, `PreToolUse` enforces `append-only-guard` (blocking `Overwrite: true` on non-empty `.omagy/ultragoal/ledger.jsonl` and `omagy_wiki/log.md` even during planning), the planning-phase write boundary (`Path`, `TargetFile`, `filePath`, rename/move, `edits[]`, `apply_patch`), `protected-block-guard` (`omagy-ignore` / `simplify-ignore`), `agreements-guard` (`[by:human]` preservation), and `write-existing-file-guard` (unread `Overwrite: true` protection).
- **Live Aux Pane HUD, Slide-Over Drawer & Workbench Telemetry**: `sidecars/hud/{main,ui,client}.mjs` serve the live 5-tab `sidecar://oh-my-agy/hud/` web UI (`Overview`, `Workflows`, `Skills`, `Subagents`, `Wiki`) with debounced `GET /api/events` SSE (`150 ms` watcher debounce + `15 s` poll fallback + digest-diffed DOM preservation), `?activeRoot=` workspace & scope filtering, `Cmd/Ctrl+K` Command Palette, a Slide-Over `#artifact-drawer` (JSON `Receipt` previews, 3-mode Visual Ralph comparator, opaque-origin `srcdoc` Loft `<iframe sandbox="allow-scripts">` with relative ES module bundling, `GET /api/skill-doc` previews for `SKILL.md` + `references/*.md` with SDO tag headings, and secret-redacted XSS-safe Markdown previews across `.omagy/{artifacts,plans,specs,evidence,ultragoal,goals}`), `GET /api/wiki-search` + TOC chips + backlinks, interactive `--flag` chips & `Model` pills, `customization://oh-my-agy` quick actions, Antigravity light/dark CSS tokens (`>= 12px`), Team DAG wave bars, and Governance cards (`Code Health`, `Shadow Checkpoints`, `Stitch DESIGN.md`, `Session Forensics`, `Notifications`, `Diagnostics & Runtime Health`).
- **14 Subagents & Scoped Tooling**: `agents/*.md` defines 14 specialized subagents with `subagent: true`, `mainAgent: false`, and 3-tier `tools:` YAML arrays (`4` write roles, `8` repo-inspecting read-only roles, `2` pure read/web roles), `context7` and `codegraph_explore` fast paths, and built-in `self` / `research` fallback support.

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
