# Changelog

Starting with `0.3.1`, `oh-my-agy` uses standalone semantic versioning (`0.x.y`) and records the upstream reference versions of **oh-my-codex (OMX)**, **oh-my-claudecode (OMC)**, and **oh-my-openagent (OMO)** tracked in each release. (Earlier releases used `<omx-version>-agy.<revision>`.)

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
