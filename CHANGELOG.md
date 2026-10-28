# Changelog

Starting with `0.3.1`, `oh-my-agy` uses standalone semantic versioning (`0.x.y`) and records the upstream reference versions of **oh-my-codex (OMX)**, **oh-my-claudecode (OMC)**, and **oh-my-openagent (OMO)** tracked in each release. (Earlier releases used `<omx-version>-agy.<revision>`.)

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
