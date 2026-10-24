# How to Use `oh-my-agy`

This guide covers every workflow skill, role subagent, hook, state file, and practical recipe in **`oh-my-agy` (`v0.3.1`)** for Google Antigravity.

---

## Table of Contents

1. [How Invocations Work (`/` vs `$` vs Natural Language)](#1-how-invocations-work--vs--vs-natural-language)
2. [Choosing the Right Workflow Lane](#2-choosing-the-right-workflow-lane)
3. [All 26 Workflow Skills (With Flags & Examples)](#3-all-26-workflow-skills-with-flags--examples)
   - [3.1 Discovery, Analysis & Prototyping](#31-discovery-analysis--prototyping)
   - [3.2 Planning & Consensus](#32-planning--consensus)
   - [3.3 Autonomous & Parallel Execution](#33-autonomous--parallel-execution)
   - [3.4 Verification, QA, Cleanup & Shipping](#34-verification-qa-cleanup--shipping)
   - [3.5 Knowledge, Continuity & Plugin Operations](#35-knowledge-continuity--plugin-operations)
4. [All 18 Role Subagents & How Delegation Works](#4-all-18-role-subagents--how-delegation-works)
5. [Durable State (`.omagy/`), Ledgers & Resuming Work](#5-durable-state-omagy-ledgers--resuming-work)
6. [Project Wiki (`omagy_wiki/`) & Subdirectory `AGENTS.md`](#6-project-wiki-omagy_wiki--subdirectory-agentsmd)
7. [Lifecycle Hooks & CLI Utilities](#7-lifecycle-hooks--cli-utilities)
8. [End-to-End Recipes](#8-end-to-end-recipes)

---

## 1. How Invocations Work (`/` vs `$` vs Natural Language)

In Antigravity, you can trigger `oh-my-agy` workflows in three ways:

1. **Slash Command (`/skill`) — Primary in Antigravity**:
   Type `/` in the chat input to pick any `oh-my-agy` skill from the autocomplete menu, or type it directly in your prompt:
   ```text
   /autopilot Add WebAuthn passkey login with fallback recovery codes
   /ralplan --hyperplan Design our multi-region billing webhook pipeline
   /code-review
   /handoff
   ```
2. **Dollar Alias (`$skill`) — Useful for Reserved Names**:
   The `PreInvocation` hook also recognizes `$<skill>` (left-to-right). This is especially handy if a skill name like `/plan` overlaps with Antigravity's built-in `/plan` slash command:
   ```text
   $plan --direct Refactor the token refresh middleware
   ```
3. **Natural-Language Routing**:
   Even without a slash command, `oh-my-agy` routes clear intent phrases automatically:
   - `"analyze ..."`, `"investigate ..."`, `"why does ..."` -> `/analyze`
   - `"deep interview"`, `"interview me"`, `"don't assume"` -> `/deep-interview`
   - `"cancel"`, `"stop the workflow"` -> `/cancel`
   - `"continue"`, `"resume"`, `"keep going"` -> resumes the active `.omagy/state/*-state.json` from its `current_phase`

---

## 2. Choosing the Right Workflow Lane

Before starting a task, pick the lightest lane that matches your risk and ambiguity:

```text
Is the task small, clear, and local?
 ├── YES ──> Just ask normally (Solo mode: understand -> execute -> verify -> report)
 └── NO
      ├── Are requirements/boundaries ambiguous? ──> /deep-interview
      ├── Do we need to see/feel a fork in code first? ──> /loft
      ├── Do we need a quick implementation plan? ──> /plan
      ├── Is this high-stakes architecture? ──> /ralplan (or /ralplan --hyperplan)
      ├── Do you want hands-off end-to-end delivery? ──> /autopilot
      ├── Do we already have an approved spec/plan?
      │    ├── Sequential multi-goal execution ──> /ultragoal
      │    └── Parallel multi-file worker execution ──> /team
      └── Is the code written and needs hardening/shipping?
           ├── Dynamic adversarial QA ──> /ultraqa
           ├── De-slop / refactor cleanup ──> /ai-slop-cleaner
           ├── Merge-readiness review ──> /code-review
           └── Review-ready PR description ──> /pr
```

---

## 3. All 26 Workflow Skills (With Flags & Examples)

### 3.1 Discovery, Analysis & Prototyping

#### `/analyze` — Grounded Repository & Root-Cause Analysis
Read-only cross-file investigation using a **6-tier Evidence Strength Hierarchy** (`[T1]` Direct runtime reproduction down to `[T6]` Structural inference), an **Intent-vs-Reality Diff** table (`Match | Undocumented | Broken | Stale`), and a mandatory self-disconfirmation rebuttal pass.
- **Flags**:
  - `--deep`: Spawns up to **3 parallel `tracer` subagents** on competing hypotheses (`H1`, `H2`, `H3`) before synthesizing.
- **Examples**:
  ```text
  /analyze Why does session refresh race when two tabs wake from sleep?
  /analyze --deep Trace why webhook retries occasionally duplicate ledger rows
  ```

#### `/best-practice-research` — Official Docs & Upstream Standards Research
Read-only research that gathers local repo usage (`explore`) and official/upstream version-aware documentation (`researcher` / `dependency-expert`), then outputs an **Intent-vs-Reality Diff** and cited recommendation.
- **Example**:
  ```text
  /best-practice-research What is the current recommended Next.js 15 caching strategy for authenticated API routes?
  ```

#### `/deep-interview` — Socratic Requirements Interview with Ambiguity Gating
Runs an **Explore-First** codebase pass, computes a weighted ambiguity score across Goal, Constraints, Success Criteria, and Context, applies the **Two-Filter + Owner-Decision Survival Gate** (never asks discoverable facts; uses Antigravity's interactive `ask_question` UI), and builds an **Affected User Ideal State & Gap Table**.
- **Flags**:
  - `--quick`: Threshold `<= 0.30`, max 3 rounds
  - `--standard` (default): Threshold `<= 0.20`, max 8 rounds
  - `--deep`: Threshold `<= 0.10`, max 12 rounds
  - `--autoresearch`: Interviews specifically to define a validator-gated `/autoresearch` contract
- **Outputs**: `.omagy/interviews/<slug>-<UTC>.md` and `.omagy/specs/deep-interview-<slug>.md`
- **Examples**:
  ```text
  /deep-interview Build a tenant-isolated audit log export system
  /deep-interview --quick Add dark mode support to the dashboard
  ```

#### `/loft` — Shape-Before-Steel Throwaway Prototyping
Settles a logic or UI design fork that prose cannot resolve by building a self-contained throwaway prototype under `.omagy/artifacts/loft/<slug>/`.
- **Two Prototype Shapes**:
  1. **Logic Fork**: Pure zero-I/O JavaScript module (`logic.mjs`) + interactive browser harness (`index.html`).
  2. **UI Fork**: Single `index.html` rendering **3 structurally distinct variants (`A`, `B`, `C`)** behind one top switcher bar.
- **Example**:
  ```text
  /loft Compare 3 layout structures for the real-time incident timeline drawer
  ```

#### `/design` — Durable `DESIGN.md` System Specification
Creates or refreshes the repository's `DESIGN.md` as the single source of truth for typography, color tokens, layout spatial rules, motion, and anti-slop guardrails.
- **Example**:
  ```text
  /design Create a DESIGN.md for a developer observability CLI and web console
  ```

#### `/ask` — External CLI Second Opinion
Queries a locally installed `claude`, `gemini`, or `codex` CLI in non-interactive mode for an independent second opinion and saves the output under `.omagy/artifacts/ask-<advisor>-<slug>-<UTC>.md`.
- **Examples**:
  ```text
  /ask claude Review our rate-limiter state machine for edge cases
  /ask codex Suggest a zero-downtime Postgres migration for splitting the users table
  ```

---

### 3.2 Planning & Consensus

#### `/plan` — Lightweight, Evidence-Backed Planning
Runs an **Explore-First Mandate** (`explore` + `researcher`), classifies intent as **`CLEAR`** (adopts best-practice defaults autonomously with 1-line rationales) or **`UNCLEAR`** (asks only owner-decision questions via `ask_question`), and writes an execution-ready plan to `.omagy/plans/plan-<slug>.md`.
- **Flags**:
  - `--direct`: Skip questions and adopt best-practice defaults immediately
  - `--interview`: Up to 3 Socratic rounds via `ask_question`
  - `--review`: Run the `critic` subagent on an existing `.omagy/plans/*.md` file
- **Examples**:
  ```text
  /plan Add idempotency keys to POST /v1/payments
  /plan --direct Extract shared validation helpers into src/lib/validators
  /plan --review .omagy/plans/plan-payments-idempotency.md
  ```

#### `/ralplan` — Consensus Planning (`Planner -> Architect -> Critic` + `--hyperplan`)
High-rigor planning for complex or architectural work. Runs a sequential subagent consensus loop (`planner` -> `architect` with steelman antithesis + Demolition/ADR checks -> `critic` gate) until `APPROVE`, then produces `.omagy/plans/ralplan-<slug>.md`, `.omagy/plans/prd-<slug>.md`, and `.omagy/plans/test-spec-<slug>.md`.
- **Flags**:
  - `--interactive`: Prompts you via `ask_question` before finalizing the handoff to `/ultragoal` or `/team`
  - `--deliberate`: Pre-mortem and expanded risk matrix for security/migration work
  - `--hyperplan`: Runs a **2-round, 5-persona hostile cross-critique tournament** (`skeptic`, `validator`, `researcher`, `architect`, `creative`) where Round 2 cross-examines Round 1 (`SURVIVES | WEAKENED | KILLED`) before entering the `architect -> critic` gate
  - `--advisory`: Single-pass architectural evaluation of an existing plan or diff
- **Examples**:
  ```text
  /ralplan --interactive Migrate auth sessions from JWT cookies to opaque Redis-backed tokens
  /ralplan --hyperplan Re-architect the event ingestion pipeline for 10x burst throughput
  ```

---

### 3.3 Autonomous & Parallel Execution

#### `/autopilot` — End-to-End Supervised Autonomous Delivery
Chains **`/deep-interview -> /ralplan -> /ultragoal`** with durable state in `.omagy/state/autopilot-state.json`. Every stage transition and artifact (`prd-*.md`, `test-spec-*.md`, `goals.json`, `ledger.jsonl`) is enforced before code is written.
- **Example**:
  ```text
  /autopilot Build an API key management page with scoped permissions, rotation, and usage metrics
  ```

#### `/ultragoal` — Durable Multi-Goal Execution Ledger
Turns a brief or plan into `.omagy/ultragoal/goals.json` and executes goals sequentially with an append-only audit trail in `.omagy/ultragoal/ledger.jsonl` (using crash-resilient newline-isolated JSONL appends).
- **Key Features**:
  - **Rigor Tiering**: Each goal is tagged `"rigor": "light"` (fast inline verification) or `"rigor": "heavy"` (independent `verifier` subagent pass).
  - **Adversarial Verification (`product` vs `harness`)**: Distinguishes product bugs (`failure_class: "product"`, max 3 retries) from test/env harness issues (`failure_class: "harness"`, repaired without burning the product retry budget).
  - **Dependency Cascade**: If a goal becomes `"blocked"` (`[~]`), dependent goals automatically cascade to `"blocked"`.
  - **Final Quality Gate**: Runs `architect` (`CLEAR`) + `verifier` (`PASS`) before marking the run `complete`.
- **Examples**:
  ```text
  /ultragoal Execute .omagy/plans/ralplan-api-keys.md
  /ultragoal Complete the remaining goals in .omagy/ultragoal/goals.json
  ```

#### `/team` — Coordinated Parallel Subagent Workers on a DAG Task Board
Dispatches up to 6 concurrent subagent workers across wave-scheduled DAG tasks stored under `.omagy/state/team/<team-slug>/tasks/task-<id>.json`.
- **Key Features**:
  - **Work-Shape Model Routing**: Routes `Splittable / Quick` tasks to `Model: "flash"`, `Cohesive / Deep` tasks to `Model: "inherit"`, and `Ultrabrain` tasks to `Model: "pro"` (or `"inherit"`).
  - **Safe Workspace Isolation**: Uses `Workspace: "share"` (shares git object store like `git worktree` so worker branch commits survive worker shutdown) and preserves any unmerged commits, untracked files, or `.omagy/evidence/task-<id>.json` before terminating workers.
  - **Evidence Validation**: Every code-changing task requires `.omagy/evidence/task-<id>.json` verified by the leader.
- **Example**:
  ```text
  /team 3:executor Execute the 5 independent module migrations in .omagy/plans/ralplan-esm-migration.md
  ```

#### `/visual-ralph` — Measured Frontend Implementation Against a Visual Reference
Iteratively builds or restyles a UI to match a reference image, generated mockup, or live URL using Playwright screenshots and the `vision` subagent's 6-category weighted rubric (`>= 90` overall, every category `>= 80`).
- **Example**:
  ```text
  /visual-ralph Match the pricing page to .omagy/artifacts/visual-ralph/pricing-target/reference.png
  ```

#### `/autoresearch` — Validator-Gated Research Loop
Iterates on a bounded research artifact until an explicit validator command (exit code `0`) or `architect` review passes.
- **Example**:
  ```text
  /autoresearch Benchmark and document the top 3 SQLite WAL tuning profiles until scripts/validate-report.sh passes
  ```

#### `/performance-goal` — Evaluator-Gated Performance Optimization Loop
Requires an upfront benchmark evaluator command and quantitative target, captures a baseline (`checkpoint-0.json`), and applies small, single-hypothesis reversible patches recorded in `checkpoints.jsonl` until the target is met.
- **Example**:
  ```text
  /performance-goal Reduce p95 bundle parse latency below 45ms using `npm run bench:parse`
  ```

---

### 3.4 Verification, QA, Cleanup & Shipping

#### `/code-review` — Dual-Lane Merge-Readiness Review
Runs `code-reviewer` and `architect` in parallel across two axes (**Axis 1: Spec & Requirement Compliance**, **Axis 2: Code Quality & Operational Standards**) plus the **Demolition Test** and **ADR Test**, then computes a deterministic verdict (`APPROVE`, `REQUEST CHANGES`, or `COMMENT`).
- **Example**:
  ```text
  /code-review Review the current branch diff against main
  ```

#### `/ultraqa` — 9-Class Adversarial End-to-End QA
Builds a scenario matrix mapping all **9 adversarial failure classes** (Empty/Null, Boundary/Scale, Malformed/Unexpected Type, Permission/AuthZ, Retry/Idempotency, Partial Failure/Rollback, Concurrent/Race, Config/Env Drift, Regression Lock) to explicit trigger conditions, then runs up to 5 diagnose-fix-retest cycles.
- **Flags**: `--tests`, `--build`, `--lint`, `--typecheck`, `--interactive`, `--custom "<cmd>"`
- **Example**:
  ```text
  /ultraqa --tests --interactive Stress-test the checkout webhook handler
  ```

#### `/ai-slop-cleaner` — Anti-Slop Refactor & Simplification Pass
Locks behavior with regression tests first, classifies fallbacks (`Essential | Speculative | Bug-Hiding`), executes 4 separated cleanup passes (Dead Code -> Duplication -> Naming/Error-Handling -> Test Lock), and optionally runs `code-simplifier`.
- **Flags**:
  - `--review`: Report-only mode (lists ranked findings and fallback table without editing files).
- **Examples**:
  ```text
  /ai-slop-cleaner Clean up src/services/billing/
  /ai-slop-cleaner --review Audit src/api/ for speculative fallbacks and dead abstractions
  ```

#### `/pr` — Assemble a Review-Ready PR Body from the `.omagy/` Paper Trail
Reads `.omagy/plans/`, `.omagy/ultragoal/`, `.omagy/evidence/`, and review artifacts to generate `.omagy/artifacts/pr-body-<slug>.md` with a 1-line summary, ASCII/Mermaid architecture visual, Before/After verification commands, and ADR-tested reversibility notes (plus optional `gh pr create` / `gh pr edit`).
- **Example**:
  ```text
  /pr Draft the PR description for this branch
  ```

---

### 3.5 Knowledge, Continuity & Plugin Operations

#### `/wiki` — Persistent Repo Markdown Wiki & Working Agreements
Maintains durable project knowledge under `omagy_wiki/` (`index.md`, `agreements.md`, topic pages, and `log.md`). Both `agreements.md` and `index.md` are automatically injected (bounded to `<= 3,500` chars) at the start of every session.
- **Subcommands**: `add`, `query`, `read`, `list`, `lint`, `delete`, `ingest-session`
- **Examples**:
  ```text
  /wiki add Guardrail: never call Stripe APIs inside a DB transaction (category: agreements)
  /wiki query payment retry idempotency
  /wiki lint
  ```

#### `/handoff` — Self-Contained Session Continuation Packet
Generates `.omagy/artifacts/handoff-<slug>-<UTC>.md` (and `handoff-latest.md`) containing current objective, verified completed work, active `.omagy/state/` pointers, adopted defaults, remaining tasks, and a copy-paste **Resume Prompt** before running Antigravity's `/compact` or opening a fresh conversation.
- **Example**:
  ```text
  /handoff Save context before I compact the chat
  ```

#### `/hud` — Workflow Status Board
Prints a compact dashboard of all active `.omagy/state/*-state.json` modes, `/ultragoal` goal progress, `/team` task counts, and `omagy_wiki/` page counts.
- **Example**:
  ```text
  /hud
  ```

#### `/cancel` — Exact-Scope Workflow Cancellation
Cleanly terminates active workflow modes (`autopilot`, `deep-interview`, `ralplan`, `plan`, `ultragoal`, `ultraqa`, `autoresearch`, `performance-goal`, `team`), preserves any unmerged subagent worktrees/branches before stopping subagents, and marks state files `cancelled` (`"active": false`).
- **Examples**:
  ```text
  /cancel
  /cancel team
  ```

#### `/doctor` — Diagnostics & Health Check
Verifies plugin placement, `hooks/run.sh selftest` (`30/30` checks), live hook routing (`$TMPDIR/oh-my-agy/<conversationId>.routing.json`), `rules/AGENTS.md` size budget, skills/agents integrity, and stale `.omagy/state/` files.
- **Example**:
  ```text
  /doctor
  ```

#### `/omagy-setup` — Plugin Setup, Project Bootstrap & `.omx` Migration
Verifies user or project plugin installation, optionally creates a project `AGENTS.md` (with canonical `realpath` and symlink target safety checks), updates `.gitignore`, and migrates legacy `.omx/` / `omx_wiki/` directories.
- **Example**:
  ```text
  /omagy-setup
  ```

#### `/skill` — Manage & Extract Reusable Skills
Lists, inspects, adds, edits, scans, validates, or extracts reusable Antigravity skills (`SKILL.md`).
- **Subcommands**: `list`, `info`, `search`, `add`, `edit`, `remove`, `validate`, `scan`, `sync`, `extract` (runs the 3-question Skillify gate to turn a recurring session workflow into a durable skill).
- **Examples**:
  ```text
  /skill list
  /skill extract prisma-migration-check
  ```

#### `/configure-notifications` — Stop/Idle Notifications
Configures stop/idle notifications in `~/.gemini/antigravity/oh-my-agy-config.json` for macOS local notifications, Slack, Discord, Telegram, or a custom webhook.
- **Examples**:
  ```text
  /configure-notifications local
  /configure-notifications test
  ```

---

## 4. All 18 Role Subagents & How Delegation Works

`oh-my-agy` ships 18 specialized subagents in [`agents/`](agents/). Skills invoke them automatically via Antigravity's `invoke_subagent` tool, or you can request them directly in your prompt (e.g., *"Use the `tracer` and `security-reviewer` subagents to inspect the auth flow"*).

| Subagent (`TypeName`) | Role & When to Use | Default Model Routing | Read/Write |
|---|---|---|---|
| `explore` | Fast repo-local file, symbol, pattern, and dependency lookup | `flash` | Read-only |
| `researcher` | Official docs, upstream API behavior, and version-aware citations | `inherit` | Read-only |
| `dependency-expert` | Package/SDK selection, upgrade/migration risk, license & maintenance comparison | `inherit` | Read-only |
| `analyst` | Pre-planning requirements analysis: hidden requirements, edge cases, unstated assumptions | `inherit` | Read-only |
| `planner` | Right-sized, evidence-backed implementation plans saved under `.omagy/plans/` | `inherit` | Write (`.omagy/`) |
| `architect` | Architectural review, Steelman Antithesis, Demolition Test, ADR Test, `CLEAR / WATCH / BLOCK` | `pro` / `inherit` | Read-only |
| `critic` | Plan & work review gate (`APPROVE / ITERATE / REJECT`), always run sequentially after `architect` | `pro` / `inherit` | Read-only |
| `executor` | Bounded implementation slices with explicit file ownership and verification | `inherit` (`flash` for trivial) | Read/Write |
| `debugger` | Root-cause isolation, stack-trace analysis, failing-test diagnosis, minimal fix | `inherit` | Read/Write |
| `tracer` | Competing-hypothesis causal tracing (`H1..Hn`), 6-tier evidence ranking, rebuttal probes | `pro` / `inherit` | Read-only |
| `code-simplifier` | Post-modification clarity, de-abstraction, and dead-code removal with zero behavior change | `inherit` | Read/Write |
| `test-engineer` | Integration/e2e test strategy, regression locks, flaky-test hardening, TDD | `inherit` | Read/Write |
| `verifier` | Independent completion verification and `AdversarialVerify` (`product` vs `harness` failure triage) | `inherit` | Read-only (+ test runs) |
| `code-reviewer` | Severity-rated diff review (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) across Spec and Standards axes | `pro` / `inherit` | Read-only |
| `security-reviewer` | OWASP Top 10, secrets, authn/authz, injection, and trust-boundary review | `pro` / `inherit` | Read-only |
| `designer` | UI/UX design decisions and polished frontend implementation grounded in `DESIGN.md` | `inherit` | Read/Write |
| `vision` | Screenshot, mockup, PDF, and diagram analysis, including `/visual-ralph` rubric scoring | `inherit` | Read-only |
| `team-worker` | `/team` task-board worker executing assigned `task-<id>.json` slices and writing `.omagy/evidence/` | `flash` / `inherit` / `pro` | Read/Write |

### Subagent Workspace Isolation & Work Preservation
- When running parallel writers (`/team` or parallel `executor` subagents), `oh-my-agy` prefers `Workspace: "share"` over `"branch"` because `"share"` shares the parent repository's git object store (like `git worktree`), so worker branch commits survive in the parent repo even if the worker is terminated.
- Before calling `manage_subagents(Action: "kill")`, the leader always checks for and preserves unmerged worker commits, modified/untracked files, and `.omagy/evidence/task-<id>.json`.

---

## 5. Durable State (`.omagy/`), Ledgers & Resuming Work

All runtime state lives in your workspace under `.omagy/` (add `.omagy/` to `.gitignore`).

```text
.omagy/
├── state/
│   ├── <mode>-state.json                      # Active mode state (autopilot, ralplan, ultragoal, team, ...)
│   ├── sessions/<conversationId>/             # Conversation-scoped state isolation
│   └── team/<team-slug>/                      # Leader-owned team manifest, workers.json, tasks/task-<id>.json
├── context/<slug>-<UTC>.md                    # Pre-flight context snapshots
├── interviews/<slug>-<UTC>.md                 # Socratic interview transcripts
├── specs/deep-interview-<slug>.md             # Crystallized execution-ready specs
├── plans/                                     # plan-*.md, ralplan-*.md, prd-*.md, test-spec-*.md
├── ultragoal/
│   ├── brief.md                               # Goal brief
│   ├── goals.json                             # Structured goals with rigor tiers & criteria
│   └── ledger.jsonl                           # Crash-resilient append-only execution audit trail
├── goals/performance/<slug>/                  # Performance baseline, checkpoints.jsonl, summary.md
├── evidence/task-<id>.json                    # Verified completion evidence for code-changing team tasks
└── artifacts/                                 # Reusable outputs: handoff-latest.md, pr-body-*.md, loft/, ask-*
```

### How to Resume Interrupted Work
- **In the same conversation**: Say `continue`, `resume`, or `keep going`. The agent reads `.omagy/state/*-state.json` and resumes from `current_phase` without repeating discovery.
- **Across conversations or after `/compact`**:
  1. Run `/handoff` before compacting or closing the session.
  2. In the new session, paste the generated **Resume Prompt** from `.omagy/artifacts/handoff-latest.md` (or say `Resume from .omagy/artifacts/handoff-latest.md`).
- **Multi-Repo Workspaces**: Place an empty `.omagy-workspace` file in a parent directory to anchor `.omagy/` and `omagy_wiki/` across multiple sibling repositories.

---

## 6. Project Wiki (`omagy_wiki/`) & Subdirectory `AGENTS.md`

Unlike `.omagy/` (which is transient workflow state and gitignored), **`omagy_wiki/`** is meant to be **committed to git** so project memory compounds across sessions and teammates:

1. **`omagy_wiki/agreements.md` (Working-Agreement Ledger)**:
   Stores explicit user preferences, architectural boundaries, and "do not touch" guardrails. Automatically injected **ahead of `index.md`** on `SessionStart` and `PreInvocation`.
2. **`omagy_wiki/index.md` & `<slug>.md`**:
   Catalog and topic pages for architecture decisions, debugging notes, and conventions.
3. **Hierarchical Subdirectory `AGENTS.md` Discovery**:
   When your prompt references a file or path inside a subdirectory (e.g., `packages/billing/src/invoice.ts`), the `PreInvocation` hook automatically walks from the workspace root down to that directory and injects any nested `AGENTS.md` files once per conversation.

---

## 7. Lifecycle Hooks & CLI Utilities

`oh-my-agy` wires its hooks through [`hooks.json`](hooks.json) -> [`hooks/run.sh`](hooks/run.sh) -> [`hooks/omagy-hook.mjs`](hooks/omagy-hook.mjs):

- **`SessionStart` & `PreInvocation` (Enabled by default)**:
  - Detects `/skill` and `$skill` triggers and natural-language routing keywords.
  - Injects a 1-line reminder of active `.omagy/state/*-state.json` modes owned by the current conversation.
  - Injects bounded (`<= 3,500` chars) `omagy_wiki/agreements.md` + `omagy_wiki/index.md` once per session.
  - Injects unseen subdirectory `AGENTS.md` files along touched workspace paths.
  - Automatically skips leader skill routing and unowned parent states when invoked inside a delegated subagent prompt (`isSubagentPayload`).
- **`Stop` (Enabled by default)**:
  - Continues active `autopilot`, `ultragoal`, `ultraqa`, `autoresearch`, or `performance-goal` loops on normal stops (`NO_TOOL_CALL`), bounded to at most 2 consecutive nudges without a state update.
  - Scans `git diff` on completion claims for left-behind blocker patterns (`test.skip`, `test.only`, `TODO: implement`, `throw new Error("Not implemented")`).
- **`PreToolUse` (Opt-in in `hooks.json`)**:
  - Blocks file writes outside `.omagy/` and `omagy_wiki/` while a planning mode (`deep-interview`, `ralplan`, `plan`, or `autopilot` planning phase) is active, including canonical `realpath` and symlink-escape protection.
  - Enforces `write-existing-file-guard`: requires user confirmation before a full-file `Overwrite: true` on an existing non-empty source file that hasn't been read yet in the current session.

### Built-In Hook CLI Commands

```bash
# 1. Run the 30-check offline hook selftest
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest

# 2. Validate a /team task's completion evidence file
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh verify-evidence .omagy/evidence/task-1.json

# 3. Append a crash-resilient newline-isolated JSONL record (auto-prepends \n if missing)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh append-jsonl .omagy/ultragoal/ledger.jsonl '{"ts":"2026-10-24T00:00:00Z","goal_id":"G1","event":"start"}'

# 4. Read a JSONL file tolerantly (skips partial/corrupted lines after a crash)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh read-jsonl .omagy/ultragoal/ledger.jsonl
```

---

## 8. End-to-End Recipes

### Recipe 1: Greenfield Feature from Idea to Verified Code (`/autopilot`)
```text
/autopilot Build a webhook delivery subsystem with HMAC-SHA256 signatures, exponential backoff retries, dead-letter queue inspection, and integration tests
```
*What happens*: Runs `/deep-interview` (asks only high-impact owner decisions via `ask_question`) -> `/ralplan` (`planner` -> `architect` -> `critic` consensus + PRD & test spec) -> `/ultragoal` (executes goals sequentially with `verifier` + `architect` final gates).

### Recipe 2: Settle a Design Fork, Stress-Test the Plan, Then Execute (`/loft` -> `/ralplan --hyperplan` -> `/ultragoal`)
```text
/loft Build 3 UI variants for the multi-tenant role permission matrix editor
```
*(Pick Variant B after opening `.omagy/artifacts/loft/.../index.html`)*
```text
/ralplan --hyperplan Implement Variant B with optimistic updates and audit logging
```
*(After consensus approval)*
```text
/ultragoal
```

### Recipe 3: Hard Bug Investigation & Adversarial Hardening (`/analyze --deep` -> `/ultraqa`)
```text
/analyze --deep Why do concurrent checkout requests occasionally fail with a stale inventory version error?
```
*(After reviewing the 3-lane `tracer` root-cause synthesis and applying the fix)*
```text
/ultraqa --tests Verify the checkout concurrency fix against race conditions and partial rollbacks
```

### Recipe 4: Parallel Multi-File Migration, Review & PR (`/team` -> `/code-review` -> `/pr`)
```text
/team 4:executor Migrate the 8 legacy REST controllers in src/controllers/ to typed Zod route handlers per .omagy/plans/ralplan-zod-routes.md
```
*(Once all wave tasks complete and `.omagy/evidence/task-*.json` pass)*
```text
/code-review
/pr
```

### Recipe 5: Save Context Before `/compact` and Record Team Guardrails (`/wiki` + `/handoff`)
```text
/wiki add All public API handlers must validate request bodies with Zod before touching the database (category: agreements)
/handoff
```
*(Then run `/compact` or open a new chat and paste the Resume Prompt from `.omagy/artifacts/handoff-latest.md`.)*
