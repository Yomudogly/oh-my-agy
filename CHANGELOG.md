# Changelog

Starting with `0.3.1`, `oh-my-agy` uses standalone semantic versioning (`0.x.y`) and records the upstream reference versions of **oh-my-codex (OMX)**, **oh-my-claudecode (OMC)**, and **oh-my-openagent (OMO)** tracked in each release. (Earlier releases used `<omx-version>-agy.<revision>`.)

## 0.4.2

*Upstream references: **OMX** `v0.21.43` · **OMC** `v5.7.22` · **OMO** `v5.1.52` · **obra/superpowers** `v7.0.1` · **Antigravity 2.0 Plugin & Sidecar Spec***

- **5-Tab HUD Consolidation with Doctor Diagnostics in Overview (`sidecars/hud/main.mjs`, `skills/hud/SKILL.md`, `rules/AGENTS.md`)**:
  - Consolidated `ALLOWED_VIEWS` from 6 tabs down to **5 high-signal tabs**: `Overview`, `Workflows`, `Skills`, `Subagents`, and `Wiki` (normalizing `?view=doctor` and legacy `?view=` parameters to `overview`).
  - Folded **Diagnostics & Runtime Health** (Quality Gates summary, Stale Modes, Configured Quality Gates, Latest PreInvocation Routing, and Recent Hook Errors) directly into the bottom of the `Overview` tab and removed the standalone `Doctor` tab.
- **Inline Edit + Run from HUD for Workflows & Skills (`sidecars/hud/main.mjs`)**:
  - Replaced static command blocks on all `8` `Workflows` cards and `27` `Skills` cards with a stacked `.cmd-box` containing a full-width, focus-safe inline editable `<input class="cmd-input">` field on top (preserving edits across 4-second live polling via `editedPrompts` and active focus guards) and a `.cmd-actions` button row underneath with three actions:
    - **`Run in Chat`**: dispatches the edited command into the active conversation via `POST /api/dispatch` (`agentapi send-message`), automatically falling back to `agentapi new-conversation` when no active conversation ID is found.
    - **`New Chat`**: launches a fresh Antigravity conversation seeded with the edited command (`agentapi new-conversation`).
    - **`Copy`**: copies the edited command to the clipboard.
- **Two-Mode Subagent Invocation from the `Subagents` Tab (`sidecars/hud/main.mjs`)**:
  - Enriched all `18` specialist subagent cards with editable task briefs (`defaultPrompt`), CLI model mapping (`normalizeCliModel`: `flash -> flash`, `pro -> pro`, `inherit -> ''`), and two native invocation buttons:
    - **`Dispatch into Active Chat`**: sends a structured delegation message to the active leader conversation (`agentapi send-message -- <conversationId> ...`) instructing it to call `invoke_subagent(TypeName: "<agent>", Model: "<tier>", Role: "<title>", Prompt: "<task>")` (with automatic `new-conversation` fallback).
    - **`Launch Standalone Chat`**: spawns a dedicated specialist session (`agentapi new-conversation --profile=<agent> [--model=<flash|pro>] --title="[OMA] <agent>" -- <task>`).
  - Hardened `POST /api/dispatch` with `Content-Type: application/json` enforcement (`415` on non-JSON requests), `X-Sidecar-Token` verification when configured (`401`), `16 KB` body size cap (`413`), and zero-shell-interpolation `execFileSync` with explicit `'--'` flag termination before positional arguments.

## 0.4.1

*Upstream references: **OMX** `v0.21.43` · **OMC** `v5.7.22` · **OMO** `v5.1.52` · **obra/superpowers** `v7.0.1` · **Antigravity 2.0 Plugin & Sidecar Spec***

- **Streamlined 6-Tab HUD Sidecar with Auto-Discovered Catalogs (`sidecars/hud/main.mjs`, `skills/hud/SKILL.md`, `omagy_wiki/hud-sidecar-architecture.md`)**:
  - Consolidated `ALLOWED_VIEWS` from 10 tabs down to **6 high-signal tabs**: `Overview`, `Workflows`, `Skills`, `Subagents`, `Wiki`, and `Doctor` (normalizing legacy `?view=` parameters to `overview`).
  - Folded active/recent **Ultragoal**, **Deep Interview**, **Team Board**, and **Reviews & Deep Research** status cards directly into `Overview` while preserving all snapshot keys in `buildHudSnapshot()` for backward compatibility.
  - Added `buildPluginCatalog(pluginRoot, activeModes)` which dynamically parses all `27` `skills/*/SKILL.md` and `18` `agents/*.md` from disk and enriches them with:
    - **`Workflows` panel**: 8 interactive workflow blueprints (`/autopilot`, `/deep-interview`, `/ralplan`, `/ultragoal`, `/team`, `/deep-research`, `/code-review & /ultraqa`, and `Solo`) with stage pipelines, live `ACTIVE` badges, artifact paths, and copyable quick-start commands.
    - **`Skills` panel**: live search input, category filter pills, and cards for all `27` skills showing flags, how-to-use guidance, and one-click copyable quick-start prompts.
    - **`Subagents` panel**: lane-filtered cards for all `18` role subagents displaying work-shape model routing (`flash` / `inherit` / `pro`), responsibilities, and when to invoke each specialist.
- **New `/deep-research` Skill & Zero-Dependency Node CLI Helpers (`skills/deep-research/`, `hooks/omagy-hook.mjs`)**:
  - Added `skills/deep-research/SKILL.md` (`27`th skill) with progressive-disclosure references (`references/lenses-and-rubric.md`, `references/report-template.md`) focused on 4 explicit research lenses (`--technical`, `--business`, `--idea`, `--implementation`), parallel subagent dispatch (`explore`, `researcher`, `dependency-expert`, `architect`, `analyst`), Tier A–E source ranking with `[VERIFIED]` / `[DERIVED]` / `[ASSUMED]` claim-kind tags, dialectical contradiction resolution, Mermaid systemic modeling, and a 5-dimension `>= 85/100` self-audit saved under `.omagy/artifacts/research/`.
  - Added **`research-matrix "<topic>" [lens] [--json]`** (`buildResearchMatrix`) and **`audit-research <reportPath> [--json]`** (`auditResearchReport`) CLI subcommands in `hooks/omagy-hook.mjs`, eliminating Python runtime dependencies.
  - Expanded offline hook selftest suite from `52` to `54` checks (`T1`–`T10`) and HUD sidecar selftest to verify the 6 core views, 27-skill / 18-subagent / 8-workflow auto-discovered catalog, `buildResearchMatrix`, and `auditResearchReport`.

## 0.4.0

*Upstream references: **OMX** `v0.21.43` · **OMC** `v5.7.22` · **OMO** `v5.1.52` · **obra/superpowers** `v7.0.1` · **Antigravity 2.0 Plugin & Sidecar Spec***

- **Hook Runtime CLI Helpers, `transcriptPath` Routing & Shell Wrapper Hardening (`hooks/omagy-hook.mjs`, `hooks/run.sh`, `sidecars/hud/run.sh`, `sidecars/hud/main.mjs`)**:
  - Added **`review-package <cwd> <baseRef> [headRef] [outPath]`** (`buildReviewPackage`): validates `git merge-base --is-ancestor <baseRef> <headRef>` and `git rev-list --count <baseRef>..<headRef> > 0` (exiting with code `3` on an empty or non-ancestor commit range so callers never review a 0-commit diff) and writes a single self-contained review artifact (`.omagy/artifacts/reviews/review-pkg-<base>-<head>.md`) with commit log, diffstat, and `-U10` unified diff.
  - Added **`goal-brief <sourcePath> <goalId|taskNumber> [outPath]`** (`extractGoalBrief`): extracts a single goal from `.omagy/ultragoal/goals.json` or a fence-aware `### Task <N>` / `### Goal <ID>` section from a `.omagy/plans/*.md` file into `.omagy/ultragoal/briefs/goal-<id>.md` so worker subagents receive lean task context without loading the full plan.
  - Persisted `transcriptPath` and `artifactDirectoryPath` in `$TMPDIR/oh-my-agy/<conversationId>.routing.json` across `SessionStart` and `PreInvocation`, and added `lastUserInput` hook payload fallback in `lastUserMessage()` per the Antigravity Hooks Spec.
  - Replaced external `dirname`, `ls | sort -V | tail`, and `cat` calls in `hooks/run.sh` and `sidecars/hud/run.sh` with pure POSIX parameter expansion (`${0%/*}`), portable glob comparison, and Windows Node path fallbacks, and updated `sidecars/hud/main.mjs` to accept both `selftest` and `--selftest`.
- **Tactical Discipline Gates Across 8 Role Subagents (`agents/*.md`, adapted from `obra/superpowers` `v7.0.1`)**:
  - `test-engineer.md`: added **Pre-Test Gate (`Name the Break`)**, **Pre-Mock Gate (`Exercise the Real Thing`)**, **Mutation Check**, **Full-Suite Rule**, and condition-based `waitFor` polling over arbitrary `setTimeout`/`sleep`.
  - `debugger.md`: added **Multi-Component Boundary Instrumentation**, **Backward Call-Stack Tracing (`console.error(new Error().stack)`)**, **`find-polluter` Bisection** for state-polluting tests, **4-Layer Defense-in-Depth Validation** (Entry Point -> Business Logic -> Environment Guard -> Debug Instrumentation), and **Condition-Based Waiting**.
  - `verifier.md`: added **Anti-Hedging & Anti-Rationalization Gate** (rejecting `should`, `probably`, `seems to`) and the **Red-Green Regression Verification Rule** (`Write test -> Run (PASS) -> Revert fix -> Run (MUST FAIL) -> Restore fix -> Run (PASS)`).
  - `code-reviewer.md`: wired `review-package` input, added **`Spec Silence Is Not Permission`**, **`HIGH (plan-mandated)`** severity calibration, **Scoped Fix Re-Review (`--re-review <fix_base_sha>`)** with `Out-of-Scope Observations`, and **`Cannot Verify from Diff`**.
  - `executor.md` & `team-worker.md`: standardized 4-state worker status (`COMPLETED | COMPLETED_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`) and `<15 line` return summaries with detailed report file offloading (`.omagy/evidence/task-<id>-report.md`).
  - `planner.md` & `critic.md`: added `## Global Constraints`, `## Review Focus (Top 5 Silent Edge Cases)`, per-task `Interfaces: Consumes / Produces`, and `Proportion` check against gold-plating.
- **Workflow Skills & Operating Contract Upgrades (`rules/AGENTS.md`, `skills/*`)**:
  - `rules/AGENTS.md`: added **Receiving review feedback** (Restate -> Verify in code -> Evaluate technically -> Respond or apply; forbidding performative agreement) and **Antigravity tool disambiguation (`manage_task` vs task checklists)**.
  - `$deep-interview` (`SKILL.md` + `references/scoring-and-templates.md`): added the **Zero-Context `Builder Check` Pass** before spec handoff.
  - `$plan` & `$ralplan`: required `## Global Constraints`, `## Review Focus (Top 5 Silent Edge Cases)`, per-task `Interfaces: Consumes / Produces`, and `Proportion` checks, and removed SDO-violating `->` workflow chains from `autopilot` and `ralplan` YAML `description` fields.
  - `$code-review`: wired `review-package` pre-assembly (handling exit code `3` as an immediate `BLOCK`), added the **Anti-Pre-Judging Guard**, **Scoped Fix Re-Review (`--re-review <fix_base_sha>`)**, and **Receiving Review Feedback**.
  - `$ultragoal`, `$team`, & `$pr`: wired `goal-brief` and `review-package`, added 4-state worker routing (`NEEDS_CONTEXT` re-dispatch, `BLOCKED` model escalation `flash -> inherit -> pro`), added **`cost_if_wrong` `Ruling:` ledger entries** and `"## Rulings Made & Deferred Minors"` closeout reporting, and added submodule-safe worktree hygiene (`git rev-parse --show-superproject-working-tree`).
- **Session Transcript Forensics & Behavioral Skill Testing (`skills/doctor/`, `skills/skill/`)**:
  - `$doctor --session [conversationId|path]` (`skills/doctor/references/session-forensics.md`): 7-dimension JSONL transcript diagnostics (`skill-timeline`, post-compaction `plan-adherence`, `repeated-work`, `stumbles`, `quality-evidence`, `request-conflicts`, `cost-and-time`) with context-safety (`>100KB` line checks) and two-pass scrubbed bundle export (`--export [skeleton|evidence|full]`).
  - `$skill test <name>` (`skills/skill/references/testing-and-sdo.md`): behavioral subagent pressure testing (`RED -> GREEN -> REFACTOR` under 3+ combined pressures + 5-rep fresh-context micro-tests), **Match the Form to the Failure** authoring guidance, and SDO frontmatter validation.
- **Strict Marketplace Manifest & 52-Check Offline Selftest (`plugin.json`, `hooks/omagy-hook.mjs`)**:
  - Converted `plugin.json` to strict comment-free JSON (`v0.4.0`, `description <= 160` chars, strictly conforming to the 10-key Antigravity `plugin.json` schema allowlist).
  - Expanded `sh ./hooks/run.sh selftest` from `44` to `52` checks (`T1`–`T8`), covering `buildReviewPackage`, `extractGoalBrief`, `transcriptPath`/`artifactDirectoryPath` routing persistence + `lastUserInput` fallback, strict `plugin.json` schema allowlist & `assets/logo.png` PNG validation, all 26 `skills/*/SKILL.md` (`<20KB`, SDO frontmatter without `->`, valid `./references/` links), `rules/AGENTS.md` (`<24KB`), all 18 `agents/*.md`, zero personal path leaks, and POSIX `run.sh` portability under minimal `PATH`.

## 0.3.4

*Upstream references: **OMX** `v0.21.43` · **OMC** `v5.7.22` · **OMO** `v5.1.52` · **Antigravity 2.0 Plugin & Sidecar Spec***

- **Auxiliary Pane UI Extension (`sidecars/hud/` & `sidecar://oh-my-agy/hud/`)**:
  - Added `sidecars/hud/sidecar.json`, `sidecars/hud/run.sh`, and `sidecars/hud/main.mjs` (`buildHudSnapshot`, `createHudServer`, `resolveSafeArtifactFile`) exposing a single, zero-dependency, strictly read-only Auxiliary Pane status & artifact board (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`, `sidecar-id: oh-my-agy/hud`) with 10 internal tabs (`Overview`, `Ultragoal`, `Team DAG`, `Interview` ambiguity/readiness radar, `Reviews` Ralplan/Hyperplan/Code-Review gates, `Benchmarks` performance checkpoints & Autoresearch claim tags, `Visual Ralph` Reference vs. Current opacity overlay comparator, `Loft` full-height prototype viewer, `Wiki` page reader & lint explorer, and `Doctor` hook/routing diagnostics), live host `theme-change` CSS variable and `workspace-change` URI syncing, `X-Sidecar-Token` / `?token=` authentication, path-traversal-safe `/api/artifact` serving, standalone secret redaction, and an offline `selftest`.
  - Wired `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` chat pills (per Antigravity's `ui-plugin-navigation` skill) and `[oh-my-agy](customization://oh-my-agy)` settings links across `rules/AGENTS.md`, `$hud`, `$autopilot`, `$ultragoal`, `$team`, `$deep-interview`, `$ralplan`, `$code-review`, `$performance-goal`, `$autoresearch`, `$visual-ralph`, `$loft`, `$wiki`, `$doctor`, and `$omagy-setup`, plus `generative_ui` `<agent-embed>` guidance in `$loft`.
- **Hooks (`hooks.json` & `hooks/omagy-hook.mjs`)**:
  - Fixed `oh-my-agy-planning-guard` `PreToolUse.matcher` in `hooks.json` to match Antigravity 2.0's native file tools (`write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`, `rename_file`, `read_file`, `view_file`) in addition to legacy IDE tool names (`write_to_file`, `replace_file_content`, `multi_replace_file_content`).
  - Updated `AGY_SLASH` in `hooks/omagy-hook.mjs` with current Antigravity built-in slash commands (`teamwork`, `compact`, `plugin`, `automation`) and guarded `main()` behind `isMainModule` so helper exports can be imported by sidecars without side effects.
  - Expanded offline hook selftest suite from `42` to `44` checks (`hooks/omagy-hook.mjs selftest`), adding regression checks for the `hooks.json` `PreToolUse` matcher and `sidecars/hud/sidecar.json` `SIDECAR_UI_ENTRYPOINT_AUX_PANE` manifest.
- **Skills Progressive Disclosure & Hygiene (`skills/deep-interview/`, `.gitignore`)**:
  - Extracted the detailed ambiguity scoring formulas, follow-up pressure ladder, ledgers, challenge modes, and spec/`--autoresearch` templates from `skills/deep-interview/SKILL.md` into `skills/deep-interview/references/scoring-and-templates.md`.
  - Standardized `write_file` / `write_to_file` tool references across `$autopilot`, `$ask`, `$configure-notifications`, and `$ultraqa`, and added `.codegraph/` and `sidecars/*/logs|events|data/` to `.gitignore`.

## 0.3.3

*Upstream references: **OMX** `v0.21.43` · **OMC** `v5.7.22` · **OMO** `v5.1.52`*

- **Hooks (`hooks/omagy-hook.mjs`, adapted from OMX `v0.21.38`–`v0.21.43`, OMC `v5.7.20`–`v5.7.22`, & OMO `v5.1.50`–`v5.1.52`)**:
  - **Time-Boxed Expiry & Standalone Secret Redaction in Wiki / Agreements / Subdir Injection** (`redactSecrets`, `filterAndRedactWikiLines`, `loadWikiSummary`, `discoverSubdirAgents`, from OMO `v5.1.52` `#11458` & `#11556`): skips wiki pages/files whose YAML frontmatter has an expired `expires: <ISO 8601>` and skips individual lines carrying an expired `[expires: YYYY-MM-DD...]` or `(expires: ...)` without deleting files on disk; masks standalone secret tokens (`sk-...`, `gh[pousr]_...`, `github_pat_...`, `glpat-...`, `xox[baprs]-...`, `AKIA...`, and 3-part JWTs `eyJ...`) before injecting into `SessionStart` or `PreInvocation` context.
  - **Verification Receipt Guard Against No-Op Output Commands** (`isRealVerificationCommand` in `validateCompletionEvidence`, from OMO `v5.1.52` `#11542`): strips leading `KEY=VAL` assignments and passthrough wrappers (`env`, `time`, `nice`, `nohup`, `command`) and rejects no-op output binaries (`echo`, `printf`, `true`, `:`, `rem`, `noop`) from earning verification receipts in `verify-evidence`.
  - **Configurable Custom Quality Gates Validator** (`validateQualityGates` & CLI subcommand `quality-gates [cwd] [stage]`, from OMX `v0.21.41` `#3956` & OMC `v5.7.22` `#4670`/`#4671`): validates `.omagy/config.json` (or `.omx-config.json`) `qualityGates` for `deep-interview`, `ralplan`, and `code-review`; returns a strict no-op (`gates: []`) when unconfigured; normalizes string entries to `{ skill, mode: "blocking", model: "inherit" }`; and rejects reserved workflow-controller skills (`deep-interview`, `ralplan`, `code-review`, `ai-slop-cleaner`, `autopilot`, `ultragoal`, `team`, `plan`, `ultraqa`, `cancel`, `verification`) to prevent self-recursion as well as sunset skills (`ralph`, `ultrawork`, `pipeline`, `ecomode`, `swarm`).
  - Expanded offline hook selftest suite from `37` to `42` checks (`hooks/omagy-hook.mjs selftest`).
- **Configurable Quality Gates & No-Questions Override (`rules/AGENTS.md`, `skills/deep-interview/`, `skills/ralplan/`, `skills/code-review/`)**:
  - Added **Configurable Custom Quality Gates** across `$deep-interview`, `$ralplan`, and `$code-review` (`qualityGates["deep-interview"]`, `qualityGates.ralplan`, `qualityGates["code-review"]`, from OMX `v0.21.41` `#3956` & OMC `v5.7.22` `#4670`/`#4671`): executes user-configured blocking or advisory skill gates before stage exit and persists structured results in `.omagy/state/`.
  - Added **No-Questions Override** (`rules/AGENTS.md`, `skills/deep-interview/SKILL.md`, from OMO `v5.1.52` `#11556`): when the user says `"don't ask"`, `"no questions"`, `"do not ask me"`, or `"hands-off"`, skips `ask_question` even on `UNCLEAR` forks, adopts best-practice defaults, and records them under `## Adopted Defaults`.
- **Impeccable Craft Floor & `320px` Reflow (`skills/design/`, `skills/visual-ralph/`, `agents/designer.md`, `agents/vision.md`, adapted from OMO `v5.1.52` `#11811` & `#11820`)**:
  - Added the **Craft Floor** (`A13` spacing rhythm `>=1.5x` heading top/bottom and `>=2x` group gap; `B8` heading scale `>=1.25x`, display `<=6rem`, tracking `>=-0.04em`; `E7` tinted secondary text on coloured surfaces and y-offset shadows; `F8` themed `::selection`, `caret-color`, scrollbars, `:focus-visible`, `text-underline-offset`, `tabular-nums`; `F9` generated-scaffold bans) and the **`320px` `WCAG 1.4.10/1.4.12` reflow check** across `$design`, `$visual-ralph`, `designer`, and `vision`.
- **Execution, Wiki, HUD, Team, Cancel & Doctor Hardening (`skills/ultragoal/`, `skills/wiki/`, `skills/hud/`, `skills/team/`, `skills/cancel/`, `skills/doctor/`)**:
  - `$ultragoal`: preserved non-terminal `"blocked"` (`[~]`) checkpoints when verification is genuinely unavailable in the environment without falsely marking the overall run `complete` (from OMX `v0.21.43` `#3964`), and bounded final review/closeout checks on resumed runs to changes since the latest `started` ledger edge (from OMC `v5.7.20` `#4650`).
  - `$wiki`: documented `expires: <ISO 8601>` time-boxed expiry tags (`[expires: YYYY-MM-DD]` and frontmatter `expires:`) and standalone secret redaction during prompt injection and `$wiki lint` (from OMO `v5.1.52` `#11458` & `#11556`).
  - `$hud` & `$team`: enforced strict read-only status inspection in `$hud` (never mutates `.omagy/`, from OMX `v0.21.42` `#3963`), added fallback to `.omagy/state/team/<team-slug>/manifest.json` when `team-state.json` is absent or inactive, and added a 20-minute completed-team HUD display window (from OMC `v5.7.21` `#4661`/`#4662`).
  - `$cancel`: scoped missing-state reporting to the current session's active modes (`owner_conversation_id` / `.omagy/state/sessions/<conversationId>/`) and capped absent-file summaries with `... and N more` (from OMC `v5.7.20` `#4654`).
  - `$doctor`: updated selftest expectation to `42/42`, added `.omagy/config.json` `qualityGates` check, and added agent frontmatter key validation against unsupported `skills:` arrays in `agents/*.md` (from OMC `v5.7.20` `#4657`).

## 0.3.2

*Upstream references: **OMX** `v0.21.37` · **OMC** `v5.7.19` · **OMO** `v5.1.49`*

- **Hooks (`hooks/omagy-hook.mjs`, adapted from OMX `v0.21.35`–`v0.21.37`, OMC `v5.7.12`–`v5.7.19`, & OMO `v5.1.45`–`v5.1.49`)**:
  - **Skill Detection Sanitization & Leading-Invocation Priority** (`stripQuotedAndNegatedRegions`, `isInformationalHelpPrompt`, `detectSkills`, from OMC `v5.7.13` `#4551`/`#4553`/`#4564` & OMO `v5.1.45` `#10822`): strips fenced code blocks, inline code, HTML comments, blockquotes, relay headers (`[a -> b]`), URLs, quoted strings, negated invocations (`do not use $autopilot`), and informational help queries (`what does $ralplan do?`), while preserving direct leading `$skill` invocations on reference-heavy prompts.
  - **Multi-Target, Rename/Move, `apply_patch` & Fail-Closed Planning Write Guard** (`extractToolTargets`, `isPathInsideAllowedOmagy`, `FILE_MUTATION_TOOLS_RE` in `preToolUse`, from OMO `v5.1.49` `#11369`): inspects all target paths across `Path`, `TargetFile`, `filePath`, rename/move destinations, `edits[]`, and `apply_patch` (`*** Add/Update/Delete File:` and `*** Move to:`) headers; blocks any target outside `.omagy/` or `omagy_wiki/`; and fails closed (`force_ask`) when an explicit file-mutation tool omits its path argument while planning is active.
  - **Human Working-Agreement Overwrite Guard** (`agreements-guard` in `preToolUse`, from OMO `v5.1.47` `#11112`): escalates full overwrites of `omagy_wiki/agreements.md` that would delete existing `[by:human]` entries.
  - **Child-Project `omagy_wiki/` Discovery** (`discoverSubdirAgents`, from OMO `v5.1.45`–`v5.1.47` `#10921`/`#11165`): when touched file paths cross into a nested subpackage with its own `omagy_wiki/agreements.md` or `omagy_wiki/index.md`, injects a bounded child-wiki digest once per conversation alongside nested `AGENTS.md` files.
  - **Environment Root Overrides & Structured Hook Error Logging** (`OMAGY_ROOT`, `OMAGY_STATE_ROOT`, `omagyLogsDir`, from OMX `v0.21.36` `#3909`): honors `OMAGY_ROOT` (precedence 1) and `OMAGY_STATE_ROOT` (precedence 2) for `.omagy/` state resolution and appends uncaught hook error records to `.omagy/logs/hook-errors.jsonl` when opted in, while keeping hook execution fail-open (`exit 0`).
  - **Strict Whole-Integer Numeric Validation** (`intOr`, from OMC `v5.7.12`–`v5.7.15` `#4543`/`#4599`/`#4600`): validates `OMAGY_STALE_MS`, `OMAGY_MAX_STOP_NUDGES`, and notification `cooldownSeconds` with `/^\d+$/` + `Number.isSafeInteger` so partial strings (`15abc`) or floats (`1.5`) fall back cleanly.
  - **Permission-Denial / User-Refusal Finality in `Stop` Continuation** (from OMO `v5.1.49` `#11371`): continuation prompts now explicitly instruct the agent that a permission denial or user refusal is final for that operation and must be marked `blocked` rather than retried via an alternative tool, command, path, or host.
  - Expanded offline hook selftest suite from `30` to `37` checks (`hooks/omagy-hook.mjs selftest`).
- **Design & Visual QA (`skills/design/`, `skills/visual-ralph/`, `agents/designer.md`, `agents/vision.md`, adapted from OMO `v5.1.45`–`v5.1.49`)**:
  - Added **Per-Screen Brief & Subtraction Contract** (`Primary action`, `Information priorities 1-3`, `Left out on purpose`, `Required content`, `Data shape -> component`), mandatory `Layout:` line with explicit `scroll owner` (`window` or one named container; never nested vertical scrollbars), and **Draft Guard** anti-slop rules (from OMO `#10889`, `#11044`, `#11056`, `#11160`, `#11284`, `#11375`).
  - Added same-origin `llms.txt` discovery (`robots.txt` disallow wins; `<= 16 KiB` cap) for live URL references in `$design` and `$visual-ralph` (from OMO `#11197`).
  - Added **Pre-edit Baseline Mode** (Before/After comparison without requiring an external mockup), `A12` scroll-owner DOM probe, `B7` required-content check, and a bounded 2–3 round visual QA fix loop in `$visual-ralph` and `vision` (from OMO `#10913`, `#10970`, `#11056`, `#11284`).
- **Research, Deep-Interview & Wiki Guardrails (`skills/deep-interview/`, `skills/autoresearch/`, `skills/best-practice-research/`, `skills/wiki/`, adapted from OMO `v5.1.47`–`v5.1.48`)**:
  - Added locked `## Fidelity` contract (`as of`, `meaning check`, `source floor`, `derived numbers`) in `$deep-interview --autoresearch`, plus `[VERIFIED]` / `[DERIVED]` / `[ASSUMED]` claim-kind tags, meaning-drift check, and text-only polish-pass guard in `$autoresearch` and `$best-practice-research` (from OMO `#11108`, `#11196`).
  - Updated `$wiki` with `[by:human]` vs `[by:agent]` working-agreement preservation, child-project `omagy_wiki/` discovery, and secret-reference exclusion rules (`process.env.X`, `$VAR`, `{{slot}}`, `[FILTERED]`, bare `Bearer`, `null`/`example` placeholders) during `$wiki lint` (from OMO `#10921`, `#11112`, `#11165`).
- **Team, Setup, Doctor & Skill Management (`skills/team/`, `skills/omagy-setup/`, `skills/doctor/`, `skills/skill/`, `agents/executor.md`, `agents/team-worker.md`)**:
  - `$team`, `executor`, `team-worker`, and `rules/AGENTS.md`: enforced permission-denial / user-refusal finality rule (from OMO `v5.1.49` `#11371`).
  - `$team`: hardened `git status --porcelain` parsing (`.trimEnd()` instead of `.trim()`) and unmerged conflict detection across all 7 git unmerged porcelain prefixes (`DD|AU|UD|UA|DU|AA|UU`, from OMC `v5.7.16` `#4607`/`#4608`).
  - `$omagy-setup` & `$doctor`: added symlink-safe copy (`rm -f` on existing/dangling symlinks before `cp -R`, from OMC `v5.7.19` `#4631`) and manifest version consistency check against `CHANGELOG.md` (from OMX `v0.21.37` `#3923`).
  - `$skill`: added project skill symlink boundary check (`realpath` within canonical project root, from OMO `v5.1.45` `#10716`) and bytecode/test-cache exclusion (`__pycache__`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`, `*.pyc`, from OMO `v5.1.49` `#11376`/`#11377`).

## 0.3.1

*Upstream references: **OMX** `v0.21.34` · **OMC** `v5.7.11` · **OMO** `v5.1.44`*

- **Hooks (`omagy-hook.mjs`, adapted from OMX `v0.21.31`–`v0.21.34` & OMO `v5.1.44`)**:
  - Added **Working-Agreement Ledger** auto-injection (`omagy_wiki/agreements.md` / `omx_wiki/agreements.md`) ahead of `index.md` on `SessionStart` and `PreInvocation`.
  - Added **Hierarchical Subdirectory `AGENTS.md` Discovery** (`discoverSubdirAgents`) on `PreInvocation`, injecting unseen nested `AGENTS.md` files along touched workspace paths once per conversation.
  - Added **`write-existing-file-guard`** in `PreToolUse`, escalating full-file `Overwrite: true` calls on non-empty existing source files that have not been read in the current session.
  - Added **Subagent Prompt & Hook Isolation** (`isSubagentPayload`, from OMX `codex-native-hook.ts`) so delegated subagent prompts do not trigger leader `$skill` routing on quoted skill tokens and are not hijacked by unowned parent `.omagy/state/*-state.json` files.
  - Added **Canonical Scope Root & Symlink Escape Guards** (`canonicalizePath`, `hasSymlinkSegment`, and `fs.lstatSync` checks in `readStateDir` and `preToolUse`, from OMX `v0.21.31`–`v0.21.32`) to block symlinked state files and symlink escapes out of `.omagy/` or `omagy_wiki/` during planning/overwrite guards.
  - Added **Crash-Resilient JSONL Ledger Helpers** (`append-jsonl` and `read-jsonl` CLI subcommands, from OMX `v0.21.33` PR #3893) that prepend `\n` when existing non-empty `.jsonl` files lack a trailing newline and skip corrupted partial lines on read.
  - Added `$handoff` skill routing (`30` selftests passing).
- **New Skill (`skills/handoff/`, adapted from OMO `v5.1.44`)**:
  - `$handoff`: generates a self-contained session continuation artifact (`.omagy/artifacts/handoff-<slug>-<UTC>.md` and `handoff-latest.md`) with objective, verified work, active `.omagy/state/` pointers, adopted defaults, and a copy-paste resume prompt before `/compact` or a fresh session.
- **Planning, Execution & QA Upgrades (adapted from OMX `v0.21.34` & OMO `v5.1.44`)**:
  - `$team`, `$cancel` & `rules/AGENTS.md`: added **Worktree / Branch Preservation on Shutdown, Kill, or Cancel** (from OMX `v0.21.34` PR #3896) — prefers `Workspace: "share"` over `"branch"`, preserves unmerged commits (`git merge-base --is-ancestor`), modified/untracked/ignored files, and tracked/staged `.omagy/evidence/` before `manage_subagents kill` or `git worktree remove`.
  - `$plan` & `$deep-interview`: added **Explore-First Mandate**, **`CLEAR` vs `UNCLEAR` Intent Routing** (autonomous best-practice defaults on open-ended requests), **Two-Filter + Owner-Decision Survival Gate**, and **Affected User Ideal State & Gap Table**.
  - `$ralplan`: added `--hyperplan` 2-round, 5-persona hostile cross-critique tournament (`skeptic`, `validator`, `researcher`, `architect`, `creative` -> `SURVIVES | WEAKENED | KILLED` distillation).
  - `$ultragoal`, `$performance-goal` & `verifier`: added `"rigor": "light|heavy"` goal tiering, structured `DoneClaim` / `AdversarialVerify` (`failure_class: "none" | "product" | "harness"` so harness repairs do not burn the 3-attempt product circuit breaker), automatic `"blocked"` (`[~]`) dependency cascade, and crash-resilient `append-jsonl` / `read-jsonl` ledger appends.
  - `$ultraqa`: mapped all 9 adversarial classes to explicit trigger conditions (`triggered` vs 1-line `not-applicable` logging).
  - `$analyze` & `$best-practice-research`: added **Intent-vs-Reality Diff** table (`Match | Undocumented | Broken | Stale`).
  - `$omagy-setup`: added canonical scope root (`realpath`) and symlink/dangling-symlink target checks before modifying `AGENTS.md` or plugin paths (from OMX `v0.21.31`–`v0.21.32`).
  - `$team` & `rules/AGENTS.md`: added **Work-Shape Model Routing** (`Splittable/Quick -> flash`, `Cohesive/Deep -> inherit`, `Ultrabrain -> pro|inherit`) and **DAG Wave Scheduling with Fingerprint-Cached Amendment**.
- **Documentation**:
  - Added [`HOW_TO_USE.md`](HOW_TO_USE.md) covering all 26 skills (flags, inputs, outputs, examples), all 18 role subagents, `.omagy/` state & crash-resilient ledgers, `omagy_wiki/`, hooks, and end-to-end recipes.

## 0.21.33-agy.2

*Upstream references: **OMX** `v0.21.33` · **OMC** `v5.7.11`*

- **Hooks (`omagy-hook.mjs`)**:
  - `PreToolUse` planning guard now inspects `args.Path`/`args.path` (used by `write_file`/`edit_file`) in addition to legacy `TargetFile`, and enforces `autopilot` planning-phase and `ralplan_gate` (`prd-*.md` + `test-spec-*.md`) write guards.
  - Added conversation-scoped state isolation (`owner_conversation_id` and `.omagy/state/sessions/<conversationId>/`) so parallel conversations in the same workspace do not hijack each other's `Stop` or `PreToolUse` hooks.
  - Added multi-repo parent root anchoring via `.omagy-workspace` / `.omc-workspace` markers (ported from `oh-my-claudecode`).
  - Added deterministic `Stop`-hook completion drift guard scanning `git diff` added lines for unconditional `test.skip`, `test.only`, and placeholder `TODO: implement` / `throw new Error("Not implemented")` stubs when claiming completion.
- **New Skills (`skills/loft/`, `skills/pr/`)**:
  - `$loft`: shape-before-steel throwaway prototyping (pure zero-I/O logic module in an HTML harness or 3 structural UI variants behind a switcher) for settling design forks.
  - `$pr`: PR body assembly from `.omagy/` paper-trail artifacts with Summary visual, Before/After verification evidence, and ADR-tested reversibility.
- **New Role Subagents (`agents/tracer.md`, `agents/code-simplifier.md`)**:
  - `tracer`: competing-hypothesis causal tracing with 6-tier Evidence Strength Hierarchy and rebuttal rounds.
  - `code-simplifier`: post-modification code simplification preserving exact runtime behavior.
- **Skill & Agent Upgrades**:
  - `$analyze`: added 6-tier Evidence Strength Hierarchy, rebuttal pass, and `--deep` 3-lane parallel `tracer` mode.
  - `$code-review` & `architect`: added Two-Axis Review (Spec + Standards axes), Demolition Test, and ADR Test.
  - `$ultragoal`: added observable stale-goal reconciliation and `amend_criterion` ledger audit trail.
  - `$skill`: added `$skill extract` with the 3-question Skillify quality gate.
  - `$ai-slop-cleaner`: added `--review` pass separation and `code-simplifier` integration.

## 0.21.33-agy.1

- `$team`: the leader sets `requires_code_change` from the task wording and the worker role (analysis-only tasks and read-only roles: `false`). Ported from OMX 0.21.33 task-evidence intent.
- `$team`: the leader validates `.omagy/evidence/task-<id>.json` with file reads; the `verify-evidence` script is now optional.
- After a server restart, stopped subagents are revived with `send_message` before any replacement is spawned (rules and `$team` recovery). Ported from the OMX 0.21.33 leader contract.
- `$doctor`: live-hook check via `$TMPDIR/oh-my-agy/<conversationId>.routing.json`; documents that Antigravity's terminal sandbox may deny reading plugin files.

## 0.21.21-agy.1

- Hook `workspaceRoots` ignores workspace paths that no longer exist.
- Install and doctor guidance for macOS folders the terminal sandbox denies (`~/Documents`, `~/Desktop`, `~/Downloads`).

## 0.21.18-agy.1

- Stop hook: continuation now triggers on Antigravity's real normal-stop reason `NO_TOOL_CALL` (previously only `model_stop`, so auto-continuation never fired in live sessions).
- `SessionStart` hook plus a bounded (≤3,500 chars) `omagy_wiki/index.md` summary injected once per conversation. Ported from OMX 0.21.18.
- Team completion evidence: `.omagy/evidence/task-<id>.json` plus the `verify-evidence` validator. Ported from OMX 0.21.18.
- Selftest no longer leaks runtime files into `$TMPDIR/oh-my-agy`; `run.sh` picks the newest nvm Node.
- Single rules file `rules/AGENTS.md`.

## 0.21.8-agy.1

- Initial Antigravity port of oh-my-codex 0.21.8: 23 skills, 16 role subagents, the operating contract as `rules/AGENTS.md`, and `PreInvocation` routing, `Stop` continuation and an opt-in `PreToolUse` planning-guard hook.
