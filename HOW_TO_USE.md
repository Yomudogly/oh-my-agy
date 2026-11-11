# How to Use `oh-my-agy`

This guide covers every workflow skill, role subagent, hook, state file, CLI utility, and practical recipe in **`oh-my-agy` (`v0.5.0`)** for Google Antigravity.

---

## Table of Contents

1. [How Invocations Work (`/` vs `$` vs Natural Language)](#1-how-invocations-work--vs--vs-natural-language)
2. [Choosing the Right Workflow Lane](#2-choosing-the-right-workflow-lane)
3. [All 20 Workflow Skills (With Flags & Examples)](#3-all-20-workflow-skills-with-flags--examples)
   - [3.1 Discovery, Analysis & Prototyping](#31-discovery-analysis--prototyping)
   - [3.2 Planning & Consensus](#32-planning--consensus)
   - [3.3 Autonomous, Parallel & Visual Execution](#33-autonomous-parallel--visual-execution)
   - [3.4 Verification, QA, Cleanup & Shipping](#34-verification-qa-cleanup--shipping)
   - [3.5 Knowledge, Continuity & Plugin Operations](#35-knowledge-continuity--plugin-operations)
4. [All 14 Role Subagents & How Delegation Works](#4-all-14-role-subagents--how-delegation-works)
5. [Durable State (`.omagy/`), Ledgers & Resuming Work](#5-durable-state-omagy-ledgers--resuming-work)
6. [Project Wiki (`omagy_wiki/`) & Subdirectory `AGENTS.md`](#6-project-wiki-omagy_wiki--subdirectory-agentsmd)
7. [Lifecycle Hooks & CLI Utilities (30 Total)](#7-lifecycle-hooks--cli-utilities-30-total)
8. [End-to-End Recipes](#8-end-to-end-recipes)

---

## 1. How Invocations Work (`/` vs `$` vs Natural Language)

In Antigravity, you can trigger `oh-my-agy` workflows in three ways:

1. **Slash Command (`/skill`) — Primary in Antigravity**:
   Type `/` in the chat input to pick any `oh-my-agy` skill from the autocomplete menu, or type it directly in your prompt:
   ```text
   /autopilot Add WebAuthn passkey login with fallback recovery codes
   /ralplan --hyperplan Design our multi-region billing webhook pipeline
   /visual-ralph --design Create a Stitch DESIGN.md using the modern-saas-indigo preset
   /code-review --security
   /hud --handoff
   ```
2. **Dollar Alias (`$skill`) — Explicit Hook Routing**:
   The `PreInvocation` hook also recognizes `$<skill>` (left-to-right), while stripping relayed `[Message]` / `<SYSTEM_MESSAGE>` / `<CONTEXT_SUMMARY>` blocks, code fences, quotes, and negations:
   ```text
   $ralplan --light Refactor the token refresh middleware
   ```
3. **Natural-Language Routing**:
   Even without a slash command, `oh-my-agy` routes clear intent phrases automatically:
   - `"analyze ..."`, `"investigate ..."`, `"why does ..."` -> `/analyze`
   - `"deep research ..."` -> `/deep-research`
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
      ├── Are requirements/boundaries ambiguous? ──> /deep-interview (or --ideate)
      ├── Do we need to see/feel a fork or bake off candidates? ──> /loft (or /loft --arena)
      ├── Do we need a design system (`DESIGN.md`) first? ──> /visual-ralph --design
      ├── Do we need a quick single-lane plan? ──> /ralplan --light
      ├── Is this high-stakes architecture or a migration? ──> /ralplan (--hyperplan | --migrate)
      ├── Do you want hands-off end-to-end delivery? ──> /autopilot
      ├── Do we already have an approved spec/plan?
      │    ├── Sequential multi-goal execution ──> /ultragoal
      │    └── Parallel multi-file worker execution ──> /team (or /team --arena | --amend)
      └── Is the code written and needs hardening/shipping?
           ├── Dynamic adversarial QA ──> /ultraqa
           ├── De-slop / refactor cleanup ──> /ai-slop-cleaner
           ├── Merge, security, or ship review ──> /code-review (--security | --ship | --audit)
           └── Review-ready PR description ──> /pr (--ship | --watch)
```

---

## 3. All 20 Workflow Skills (With Flags & Examples)

### 3.1 Discovery, Analysis & Prototyping

#### `/deep-research` — Multi-Lens Deep Research, Quick Docs Lookup & Validator-Gated Loops
Runs a 5-phase investigation across **Technical**, **Business**, **Idea / Product**, and **Implementation** lenses: terminological scoping, Boolean query matrix generation (`hooks/run.sh research-matrix`), parallel subagent harvest (`explore`, `researcher`, `architect`, `planner`, `critic`), Tier A–E source ranking with `[VERIFIED]` / `[DERIVED]` / `[ASSUMED]` claim tags, dialectical contradiction resolution, Mermaid systemic modeling, and a deterministic 5-dimension `>= 85/100` self-audit (`hooks/run.sh audit-research`). Also supports fast official-docs lookups (`--quick`) and stateful validator-gated research loops (`--loop`).
- **Flags**:
  - `--technical`: Architecture tradeoffs, algorithms, scaling benchmarks, failure modes, and RFCs/standards.
  - `--business`: TAM/SAM/SOM, ICP & pain points, competitive moats, unit economics, pricing, and GTM risk.
  - `--idea`: First-principles problem validation, jobs-to-be-done, contrarian insight, MVP wedge, and kill criteria.
  - `--implementation`: Codebase touchpoint map, SDK/package comparison, API version constraints, and migration/test plan.
  - `--quick`: Bounded read-only lookup combining repo usage (`explore`) with official version-aware upstream docs (`researcher` via `context7` + web search) and an **Intent-vs-Reality Diff** without creating `.omagy/state/`.
  - `--loop`: Stateful validator-gated research iteration backed by `.omagy/state/autoresearch-state.json` until an explicit validator command exits `0` or `architect` review passes.
- **Outputs**: `.omagy/artifacts/research/deep-research-<slug>-<UTC>.md`
- **Examples**:
  ```text
  /deep-research --technical "HNSW vs DiskANN vector indexing tradeoffs at 50M vectors"
  /deep-research --quick "Recommended Next.js 15 caching strategy for authenticated API routes"
  /deep-research --loop "Benchmark top 3 SQLite WAL tuning profiles until scripts/validate-report.sh passes"
  ```

#### `/analyze` — Grounded Repository, Root-Cause, Blast-Radius & Statechart Analysis
Read-only cross-file investigation using a **6-tier Evidence Strength Hierarchy** (`[T1]` Direct runtime reproduction down to `[T6]` Structural inference), an **Intent-vs-Reality Diff** table (`Match | Undocumented | Broken | Stale`), and a mandatory self-disconfirmation rebuttal pass.
- **Flags**:
  - `--deep`: Spawns up to **3 parallel `tracer` subagents** on competing hypotheses (`H1`, `H2`, `H3`) before synthesizing.
  - `--audit [path]`: Runs a read-only whole-repo (or subtree) quality & lean audit using `codebase-map` and `scan-debt`, ranking structural bloat (`Lean: -<N> lines`), duplicate helpers, and un-triggered `shortcut:` debt.
  - `--blast-radius <symbolOrPath>`: Maps direct and transitive callers, contract boundaries, and regression test surface (`references/blast-radius-and-statechart.md`, leveraging `codegraph_explore` when indexed).
  - `--statechart <moduleOrFlow>`: Extracts explicit states, guards, transitions, and unreachable/deadlock edges as a verified Mermaid `stateDiagram-v2`.
- **Examples**:
  ```text
  /analyze Why does session refresh race when two tabs wake from sleep?
  /analyze --deep Trace why webhook retries occasionally duplicate ledger rows
  /analyze --blast-radius src/auth/tokenService.ts
  /analyze --statechart src/payments/checkoutMachine.ts
  /analyze --audit src/
  ```

#### `/deep-interview` — Socratic Requirements Interview & Divergent Ideation (`--ideate`)
Runs an **Explore-First** codebase pass, computes a weighted ambiguity score across Intent, Outcome, Scope, Constraints, Success Criteria, and Context, applies the **Two-Filter + Owner-Decision Survival Gate** (never asks discoverable facts; uses Antigravity's interactive `ask_question` UI), checks **Phase 0 Capability Map DAGs** (`>= 3` capabilities) and `"Want vs. Should Want"` XY-problem probes, and builds an **Affected User Ideal State & Gap Table** with `Always / Ask First / Never` boundaries.
- **Flags**:
  - `--quick`: Threshold `<= 0.30`, max 5 rounds
  - `--standard` (default): Threshold `<= 0.20`, max 12 rounds
  - `--deep`: Threshold `<= 0.15`, max 20 rounds
  - `--ideate`: Divergent-to-convergent concept shaping (`How Might We` reframing, `5–8` variations across 7 lenses, `Painkiller vs Vitamin` + 6-Tier Differentiation, `Must/Should/Might Be True` assumption audit) saved to `.omagy/artifacts/ideas/<slug>.md` before converging into Phase 2 Socratic crystallization
  - `--autoresearch`: Interviews specifically to define a validator-gated `/deep-research --loop` contract
- **Outputs**: `.omagy/artifacts/ideas/<slug>.md` (`--ideate`), `.omagy/interviews/<slug>-<UTC>.md`, and `.omagy/specs/deep-interview-<slug>.md`
- **Examples**:
  ```text
  /deep-interview Build a tenant-isolated audit log export system
  /deep-interview --ideate Explore product wedges for developer incident replay
  /deep-interview --quick Add dark mode support to the dashboard
  ```

#### `/loft` — Shape-Before-Steel Throwaway Prototyping & `--arena` Bake-Offs
Settles a logic or UI design fork that prose cannot resolve by building a self-contained throwaway prototype under `.omagy/artifacts/loft/<slug>/` (and persisting `loft-verdict.json`).
- **Shapes & Flags**:
  1. **Logic Fork**: Pure zero-I/O JavaScript module (`logic.mjs`) + interactive browser harness (`index.html`).
  2. **UI Fork**: Single `index.html` rendering **3 structurally distinct variants (`A`, `B`, `C`)** behind one top switcher bar.
  3. **`--arena`**: Dispatches `N=2..3` isolated `Workspace: "share"` `executor` candidates against the same bounded spec and scores them via an independent `critic` rubric (`references/arena-bakeoff.md`).
- **Examples**:
  ```text
  /loft Compare 3 layout structures for the real-time incident timeline drawer
  /loft --arena Compare 2 parser implementations for streaming CSV chunk boundaries
  ```

#### `/ask` — Sandboxed External CLI Second Opinion & Blind-Claim Critique (`--doubt`)
Queries a locally installed `claude`, `gemini`, or `codex` CLI in non-interactive mode by piping a `0600` temp file over `stdin` (`< <tmpfile>`, zero shell interpolation of code or diffs) into read-only sandboxes (`codex exec --sandbox read-only`, `gemini --approval-mode plan`, `claude -p`) and saves the output under `.omagy/artifacts/ask-<advisor>-<slug>-<UTC>.md`.
- **Flags**:
  - `--doubt`: Assembles a **Blind-Claim Packet** (`## ARTIFACT` + `## CONTRACT` + raw test/command outputs, strictly omitting persuasive author `CLAIM` narratives) and triages findings through the 4-tier `RECONCILE` precedence into `.omagy/artifacts/ask-<advisor>-doubt-<slug>-<UTC>.md`.
- **Examples**:
  ```text
  /ask claude Review our rate-limiter state machine for edge cases
  /ask codex --doubt Verify src/auth/session.ts against .omagy/specs/deep-interview-auth.md
  ```

---

### 3.2 Planning & Consensus

#### `/ralplan` — Consensus, Hostile, Lightweight (`--light`) & Migration (`--migrate`) Planning
Unified planning skill scaling from fast single-lane feature plans to multi-agent consensus and strangler-fig migrations. Full consensus runs a sequential subagent loop (`planner` -> `architect` with steelman antithesis + Demolition/ADR checks -> `critic` gate) until `APPROVE`, writes `.omagy/plans/ralplan-<slug>.md`, `.omagy/plans/prd-<slug>.md`, and `.omagy/plans/test-spec-<slug>.md`, and binds both human (`.md`) and cryptographic SHA-256 + fake-timeline-checked (`.omagy/plans/ralplan-review-<slug>.json`) receipts via `hooks/run.sh plan-hash`.
- **Flags**:
  - `--light`: Explore-first single-lane plan without `architect`/`critic` tournament overhead, writing `.omagy/plans/plan-<slug>.md` (guarded by `.omagy/state/plan-state.json`).
  - `--interview`: Up to 3 Socratic clarification rounds via `ask_question` before drafting a lightweight plan.
  - `--review <planPath>`: Runs the `critic` subagent gate against an existing `.omagy/plans/*.md` file.
  - `--interactive`: Prompts you via `ask_question` before finalizing handoff to `/ultragoal` or `/team`.
  - `--deliberate`: Pre-mortem and expanded risk matrix for security-critical work.
  - `--hyperplan`: Runs a **2-round, 5-persona hostile cross-critique tournament** (`skeptic`, `validator`, `researcher`, `architect`, `creative`) where Round 2 cross-examines Round 1 (`SURVIVES | WEAKENED | KILLED`) before entering `architect -> critic`.
  - `--migrate`: Applies the phased migration & EARS (`WHEN / IF-THEN / WHILE / WHERE`) playbook (`references/migration-and-ears.md`: characterization tests -> strangler adapter -> dual-run parity -> cutover -> cleanup, with zero fake calendar promises).
  - `--advisory`: Single-pass architectural evaluation of an existing plan or diff.
- **Examples**:
  ```text
  /ralplan --light Add idempotency keys to POST /v1/payments
  /ralplan --interactive Migrate auth sessions from JWT cookies to opaque Redis-backed tokens
  /ralplan --hyperplan Re-architect the event ingestion pipeline for 10x burst throughput
  /ralplan --migrate Replace legacy Moment.js date math with Temporal/Intl adapters
  ```

---

### 3.3 Autonomous, Parallel & Visual Execution

#### `/autopilot` — End-to-End Supervised Autonomous Delivery
Chains **`/deep-interview -> /ralplan -> /ultragoal`** with durable state in `.omagy/state/autopilot-state.json`. Every stage transition, SHA-256 plan receipt, and execution artifact (`prd-*.md`, `test-spec-*.md`, `goals.json`, `ledger.jsonl`) is verified before code is written.
- **Example**:
  ```text
  /autopilot Build an API key management page with scoped permissions, rotation, and usage metrics
  ```

#### `/ultragoal` — Durable Multi-Goal Execution Ledger with Checkpoints & Notepad
Turns a brief or plan into `.omagy/ultragoal/goals.json`, verifies `.omagy/plans/ralplan-review-<slug>.json` via `hooks/run.sh plan-hash verify` when handed off from `/ralplan`, maintains compaction-resilient working notes in `.omagy/ultragoal/notepad.md` (`## Priority`, `## Working`, `## Manual`), creates stash-free shadow git checkpoints (`hooks/run.sh checkpoint create`), and records verified goal completions via `hooks/run.sh goal-done` into `.omagy/evidence/goal-<id>.json` and append-only `.omagy/ultragoal/ledger.jsonl`.
- **Key Features**:
  - **Rigor Tiering**: `"rigor": "light"` (fast inline check) or `"rigor": "heavy"` (independent `verifier` subagent pass).
  - **Test-Gated `goal-done` & Index-Preserving Shadow `checkpoint`**: Rejects no-op commands (`echo ok`), writes `.omagy/evidence/goal-<id>.json`, and snapshots working tree + `.git/index` + untracked set under `refs/omagy/checkpoints/*` without touching `HEAD` or `git stash`.
  - **Blind-Claim `AdversarialVerify` & 4-Tier `RECONCILE`**: Strips persuasive executor narratives, distinguishes `product` vs `harness` failures, reconciles findings across `(1) Contract gap -> (2) Actionable defect -> (3) Explicit Ruling -> (4) Context noise`, and halts `Doubt/Review theater` after `>= 2` clean cycles.
  - **Final Quality Gate**: Runs `architect` (`CLEAR`) + `verifier` (`PASS`) before marking the run `complete`.
- **Examples**:
  ```text
  /ultragoal Execute .omagy/plans/ralplan-api-keys.md
  /ultragoal Complete the remaining goals in .omagy/ultragoal/goals.json
  ```

#### `/team` — Coordinated Parallel Subagent Workers (`--amend` & `--arena`)
Dispatches up to 6 concurrent `executor` subagent workers across wave-scheduled DAG tasks stored under `.omagy/state/team/<team-slug>/tasks/task-<id>.json`.
- **Flags & Features**:
  - **Work-Shape Model Routing**: `Splittable / Quick` -> `Model: "flash"`, `Cohesive / Deep` -> `Model: "inherit"`, `Ultrabrain` -> `Model: "pro"` (with `ESCALATE_MODEL: pro` upward escalation).
  - **Safe Workspace Isolation**: Uses `Workspace: "share"` so worker branch commits survive worker shutdown, requiring `.omagy/evidence/task-<id>.json` (`verdict` + `verified_head`) on every code-changing slice.
  - `--amend`: Safely adds, re-scopes, or cancels pending DAG tasks mid-flight without corrupting in-progress worker waves (`references/amend-and-arena.md`).
  - `--arena`: Runs `N=2..3` isolated `Workspace: "share"` workers on the same hard slice and selects the winner via independent `critic` scoring.
- **Examples**:
  ```text
  /team 3:executor Execute the 5 independent module migrations in .omagy/plans/ralplan-esm-migration.md
  /team --amend Split task-4 into schema migration and backfill tasks
  /team --arena 2:executor Implement the lock-free ring buffer slice
  ```

#### `/visual-ralph` — Visual Reference Loop & Google Stitch 2-Layer `DESIGN.md` (`--design`)
Operates in two modes: (1) iteratively building or restyling a UI against a visual reference using Playwright screenshots (`await document.fonts.ready` + double-`requestAnimationFrame` settle + DOM/cookie quarantine) and the `vision` subagent's 6-category rubric (`>= 90` overall, every category `>= 80`), or (2) authoring and validating the repository's durable Google Stitch 2-Layer `DESIGN.md` (`--design`).
- **Flags**:
  - `--design`: Launches the Google Stitch 2-Layer `DESIGN.md` workflow (`references/design-system-stitch.md`):
    - **Layer 1 (3-Level Nested YAML Frontmatter)**: `colors`, `typography`, `spacing`, `shapes` (`elevation` optional), supporting `{ value, role }` token leaves.
    - **Layer 2 (8 Canonical Stitch Prose Sections)**: `Overview`, `Colors`, `Typography`, `Layout` (with `scroll owner:`), `Elevation & Depth`, `Shapes`, `Components`, and `Do's and Don'ts`, cross-referencing `{category.subpath}` tokens and enforcing Craft Floor `A12`–`F9`.
    - **5 AA-Compliant Starter Presets**: `modern-saas-indigo`, `minimal-dark-developer`, `high-density-fintech`, `editorial-warm-luxury`, `neo-brutalist-vibrant`, plus live URL `getComputedStyle` extraction, deterministic validation via `sh <plugin>/hooks/run.sh validate-design-md DESIGN.md --json [--strict]`, and optional `StitchMCP` deployment.
- **Examples**:
  ```text
  /visual-ralph Match the pricing page to .omagy/artifacts/visual-ralph/pricing-target/reference.png
  /visual-ralph --design Author DESIGN.md starting from minimal-dark-developer and validate AA contrast
  /visual-ralph --design Extract tokens from localhost:3000 into a Stitch 2-Layer DESIGN.md
  ```

#### `/performance-goal` — Evaluator-Gated Performance Optimization Loop
Requires an upfront benchmark evaluator command and quantitative target, captures a baseline (`checkpoint-0.json`), and applies small, single-hypothesis reversible patches recorded in `checkpoints.jsonl` until the target is met (consulting `references/domain-playbooks.md` for Core Web Vitals Field CrUX vs Lab Lighthouse **Metric-Honesty Rule**, `EXPLAIN (ANALYZE, BUFFERS)` 3-signal triage, connection pool sizing, viewer-keyed caching, and *"Neutral is a revert"*).
- **Example**:
  ```text
  /performance-goal Reduce p95 bundle parse latency below 45ms using `npm run bench:parse`
  ```

---

### 3.4 Verification, QA, Cleanup & Shipping

#### `/code-review` — Dual-Lane Merge, Audit, Ship & Security (`--security`) Review
Runs `code-reviewer` and `architect` in parallel across **Axis 1 (Spec Compliance)** and **Axis 2 (Code Quality & Operational Standards)** plus the **Demolition Test**, **ADR Test**, caller-grep verification, `[Pre-existing in base]` vs `[Introduced in diff]` tagging, `Confidence: HIGH | MEDIUM | LOW` calibration (`LOW` `< 80%` routed to non-blocking `Open Questions` when `0` `HIGH`/`MEDIUM` findings remain), **Concept-Count Test**, and `Lean: -<N> lines` estimates.
- **Flags**:
  - `--re-review`: Verifies prior review fixes and checks for newly introduced regressions.
  - `--audit [path]`: Read-only whole-repo (or subtree) quality & lean audit (`codebase-map` + `scan-debt`).
  - `--ship`: Production ship-readiness checklist (`references/ship-readiness.md`, `quality-gate`, and `floor-guard`).
  - `--security`: Dispatches `security-reviewer` for a dedicated `STRIDE` + `OWASP` Top 10 / LLM01–LLM10 audit paired with `hooks/run.sh lookout` destructive-command/SQL hazard scanning.
- **Examples**:
  ```text
  /code-review Review the current branch diff against main
  /code-review --security
  /code-review --ship
  /code-review --audit src/
  ```

#### `/ultraqa` — 9-Class Adversarial End-to-End QA
Builds a scenario matrix mapping all **9 adversarial failure classes** (Empty/Null, Boundary/Scale, Malformed/Unexpected Type, Permission/AuthZ, Retry/Idempotency, Partial Failure/Rollback, Concurrent/Race, Config/Env Drift, Regression Lock) to explicit trigger conditions, deduplicates repeated failures via `hooks/run.sh failure-sig`, enforces browser font/rAF settle + console/network triage + untrusted DOM/cookie quarantine (`references/browser-verification-safety.md`), and runs up to 5 diagnose-fix-retest cycles.
- **Flags**: `--tests`, `--build`, `--lint`, `--typecheck`, `--interactive`, `--custom "<cmd>"`
- **Example**:
  ```text
  /ultraqa --tests --interactive Stress-test the checkout webhook handler
  ```

#### `/ai-slop-cleaner` — Anti-Slop Refactor & Simplification Pass
Locks behavior with regression tests first, classifies fallbacks (`Essential | Speculative | Bug-Hiding`), executes 4 separated cleanup passes (Dead Code -> Duplication -> Naming/Error-Handling -> Test Lock with `check-test-junk`), and runs `executor`'s simplification protocol (Chesterton's Fence `git log -S`, Rule of 500, and `omagy-ignore` / `simplify-ignore` preservation).
- **Flags**: `--review` (report-only mode without editing files)
- **Examples**:
  ```text
  /ai-slop-cleaner Clean up src/services/billing/
  /ai-slop-cleaner --review Audit src/api/ for speculative fallbacks and dead abstractions
  ```

#### `/pr` — Assemble a Review-Ready PR Body, Ship Gate (`--ship`) & Watch Open PRs (`--watch`)
Reads `.omagy/plans/`, `.omagy/ultragoal/`, `.omagy/evidence/`, and review artifacts to generate `.omagy/artifacts/pr-body-<slug>.md` with a 1-line summary, architecture visual, Before/After verification commands, `Decision:` / `Rejected:` / `Constraint:` trailers, and ADR-tested reversibility notes.
- **Flags**:
  - `--ship`: Appends the production ship-readiness & rollout checklist (`quality-gate`, `floor-guard`, `git diff --staged --name-only` audit).
  - `--watch`: Classifies PR state (`ready | waiting | blocked | gone` via `watch-pr`), triages CI logs (`real / flaky / environmental`) without mutating workflow runs, and resolves review threads across all 3 GitHub review surfaces + GraphQL `reviewThreads`.
- **Examples**:
  ```text
  /pr Draft the PR description for this branch
  /pr --ship
  /pr --watch
  ```

---

### 3.5 Knowledge, Continuity & Plugin Operations

#### `/wiki` — Persistent Repo Markdown Wiki, Working Agreements, CJK Query & Lint
Maintains durable project knowledge under `omagy_wiki/` (`index.md`, `agreements.md`, topic pages, and append-only `log.md`). Both `agreements.md` and `index.md` are automatically injected (`<= 3,500` chars) at session start and after `<CONTEXT_SUMMARY>` compaction.
- **Subcommands**: `add`, `query` (`hooks/run.sh wiki-query` with `tags*3 + title*2 + body*1` weighting and CJK bi-grams), `read`, `list`, `lint` (`hooks/run.sh wiki-lint` catching dangling `[[slug]]` links and dead `file:line` references + secret/expiry hygiene), `delete`, `ingest-session`
- **Examples**:
  ```text
  /wiki add Guardrail: never call Stripe APIs inside a DB transaction (category: agreements)
  /wiki query payment retry idempotency
  /wiki lint
  ```

#### `/hud` — Workflow Status Board, Aux Pane UI (`sidecar://oh-my-agy/hud/`) & `--handoff`
Prints a compact read-only dashboard of active `.omagy/state/*-state.json` modes, `/ultragoal` goal progress, `/team` task counts, and `omagy_wiki/` agreements, and surfaces `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` to toggle the 5-tab Auxiliary Pane UI (`Overview` with `verificationFreshness` & `Floor Guard` KPIs, `Workflows`, `Skills`, `Subagents`, `Wiki`).
- **Flags**:
  - `--handoff [slug]`: Runs `hooks/run.sh handoff` to generate secret-redacted `.omagy/artifacts/handoff-<slug>-<UTC>.md` and `.omagy/artifacts/handoff-latest.md` (with active modes, ultragoal progress & `notepad.md`, dirty worktree summary, verification status, and copy-paste **Resume Prompt**) before `/compact` or switching sessions.
- **Examples**:
  ```text
  /hud
  /hud --handoff pre-compact-auth
  ```

#### `/cancel` — Exact-Scope Workflow Cancellation
Cleanly terminates active workflow modes (`autopilot`, `deep-interview`, `ralplan`, `plan`, `ultragoal`, `ultraqa`, `autoresearch`, `performance-goal`, `team`), preserves unmerged subagent worktrees/branches before stopping subagents, and marks state files `cancelled` (`"active": false`).
- **Examples**:
  ```text
  /cancel
  /cancel team
  ```

#### `/doctor` — Diagnostics, Setup, Notifications, Deep Init & Session Forensics
All-in-one operational health, setup, notification, and transcript forensics toolkit:
- **Default (`/doctor`)**: Verifies plugin placement, `hooks/run.sh selftest` (`85/85`), `hooks/run.sh skill-eval --min-rank1 95` (`20` skills), `hooks/run.sh floor-guard`, `sidecars/hud/run.sh selftest`, hook module byte ceilings (`omagy-hook.mjs < 175 KB`, `omagy-cli.mjs < 93,734 B`, `AGENTS.md < 24 KB`, `SKILL.md < 20 KB`), 14-agent `tools:` YAML frontmatter, `plugin.json` `v0.5.0` parity, and stale/waiting `.omagy/state/` files.
- **Flags**:
  - `--setup`: Verifies user/project plugin installation, safely bootstraps project `AGENTS.md`, and updates `.gitignore` (`references/setup-and-init-deep.md`).
  - `--init-deep`: Runs `hooks/run.sh init-deep-scan` to score subdirectories by code density and git churn and generates non-duplicative child `AGENTS.md` files where warranted.
  - `--notifications`: Configures stop/idle notifications in `.omagy/notifications.json` or `~/.gemini/antigravity/oh-my-agy-config.json` (macOS local, Slack, Discord, Telegram, or HTTPS webhook; `references/notifications.md`).
  - `--session [conversationId|path]`: 7-dimension JSONL transcript forensics + scrubbed `--export [skeleton|evidence|full]` (`references/session-forensics.md`).
  - `--session-compare <baseline.jsonl> <candidate.jsonl>`: Privacy-safe A/B transcript regression comparison (`session-compare`, subtracting `> 30m` idle gaps).
  - `--session-scan [dirOrFile]`: Runs `hooks/run.sh session-scan` across up to 100 transcripts to report privacy-safe step totals, compactions, orphan tool calls, and top normalized failure clusters.
- **Examples**:
  ```text
  /doctor
  /doctor --setup
  /doctor --init-deep
  /doctor --notifications local
  /doctor --session
  /doctor --session-compare baseline.jsonl candidate.jsonl
  /doctor --session-scan ~/.gemini/antigravity/brain
  ```

#### `/skill` — Manage, Validate, Evaluate (`>=95%`), Test & Extract Skills
Lists, inspects, adds, edits, scans, validates, benchmarks, pressure-tests, or extracts reusable Antigravity skills (`SKILL.md`), enforcing **"Write the Procedure, Not the Workaround"**.
- **Subcommands**: `list`, `info`, `search`, `add`, `edit`, `remove`, `validate`, `eval` (`hooks/run.sh skill-eval --min-rank1 95`), `test <name>` (3-pressure `RED -> GREEN -> REFACTOR` subagent testing), `scan`, `sync`, `extract` (requires `>= 2` concrete validations, genericized repo-independent paths, and `T6`/`T39` compliance).
- **Examples**:
  ```text
  /skill list
  /skill validate
  /skill eval
  /skill test code-review
  /skill extract prisma-migration-check
  ```

---

## 4. All 14 Role Subagents & How Delegation Works

`oh-my-agy` ships 14 specialized subagents in [`agents/`](agents/), each carrying verified `subagent: true`, `mainAgent: false`, and a 3-tier `tools:` YAML allowlist. Skills invoke them via `invoke_subagent`, or you can request them directly in chat.

| Subagent (`TypeName`) | Role & Folded Capabilities | Default Model | `tools:` Tier |
|---|---|---|---|
| `explore` | Repo-local file, symbol, and dependency lookup (`codegraph_explore` fast path -> `read_file`) | `flash` | Repo-inspecting read-only |
| `researcher` | Official docs (`context7` first), version-aware citations (`UNVERIFIED:` guard), plus folded SDK/package comparison, license/CVE audit & migration playbooks | `inherit` | Pure read + web (`read_file`, `search_web`) |
| `planner` | Folded pre-planning requirements analysis (Capability Map DAG, XY probe, `Always/Ask/Never`, `Must/Should/Might Be True`) + right-sized plans under `.omagy/plans/` | `inherit` | Repo-inspecting read-only |
| `architect` | Architectural review, Steelman Antithesis, Demolition/ADR Tests, Expand/Contract & Idempotency checks, `CLEAR / WATCH / BLOCK` | `pro` / `inherit` | Repo-inspecting read-only |
| `critic` | Sequential plan & arena review gate (`APPROVE / ITERATE / REJECT`) with concrete alternatives | `pro` / `inherit` | Repo-inspecting read-only |
| `executor` | Bounded implementation slices, folded `<team_protocol>` (`VERIFICATION_VERDICTS`, `verified_head`), folded simplification (`Chesterton's Fence`, `Rule of 500`), `ESCALATE_MODEL: pro`, and `Decision:`/`Rejected:`/`Constraint:` trailers | `inherit` (`flash` for trivial) | Implementation write |
| `debugger` | 4-Phase Iron Law root-cause isolation (`codegraph_explore` fast path), `find-polluter` bisection, LLM01 log quarantine, minimal fix | `inherit` | Implementation write |
| `tracer` | Competing-hypothesis causal tracing (`H1..Hn`, `codegraph_explore` fast path), 6-tier evidence ranking, rebuttal probes | `pro` / `inherit` | Repo-inspecting read-only |
| `test-engineer` | Integration/e2e test strategy, `R/F/C/D` & 2×2 mutation proof, flaky-test hardening, TDD | `inherit` | Implementation write |
| `verifier` | Independent completion verification and Blind-Claim `AdversarialVerify` (`product` vs `harness` triage) | `inherit` | Repo-inspecting read-only (+ test runs) |
| `code-reviewer` | Severity- & `Confidence: HIGH\|MEDIUM\|LOW`-rated diff review across Spec and Standards axes + `Lean: -<N> lines` | `pro` / `inherit` | Repo-inspecting read-only |
| `security-reviewer` | `STRIDE`, OWASP Top 10 & LLM01–LLM10, lifecycle scripts, DNS SSRF, authn/authz, and `lookout` hazard review | `pro` / `inherit` | Repo-inspecting read-only |
| `designer` | UI/UX design decisions and polished frontend implementation grounded in Stitch 2-Layer `DESIGN.md` & Craft Floor | `inherit` | Implementation write |
| `vision` | Screenshot, mockup, PDF, and diagram analysis, including `/visual-ralph` 6-category rubric scoring | `inherit` | Pure read + web (`read_file`, `search_web`) |

### Subagent Workspace Isolation & Work Preservation
- Parallel writers (`/team`, `/loft --arena`, or parallel `executor` subagents) use `Workspace: "share"` so worker branch commits share the parent repository's git object store and survive subagent shutdown.
- Before calling `manage_subagents(Action: "kill")`, the leader preserves unmerged commits, modified/untracked files, and `.omagy/evidence/task-<id>.json`.

---

## 5. Durable State (`.omagy/`), Ledgers & Resuming Work

All runtime state lives in your workspace under `.omagy/` (add `.omagy/` to `.gitignore`).

```text
.omagy/
├── config.json                                # Optional qualityGates, HUD, wiki, deepInterview settings
├── notifications.json                         # Optional workspace notification targets (/doctor --notifications)
├── state/
│   ├── <mode>-state.json                      # Active mode state (autopilot, ralplan, plan, ultragoal, autoresearch, team, ...)
│   ├── sessions/<conversationId>/             # Conversation-scoped state isolation
│   └── team/<team-slug>/                      # Leader-owned team manifest, workers.json, tasks/task-<id>.json
├── context/<slug>-<UTC>.md                    # Pre-flight context snapshots
├── interviews/<slug>-<UTC>.md                 # Socratic interview transcripts
├── specs/deep-interview-<slug>.md             # Crystallized execution-ready specs
├── plans/                                     # plan-*.md, ralplan-*.md, prd-*.md, test-spec-*.md, ralplan-review-*.{md,json}
├── ultragoal/
│   ├── brief.md                               # Goal brief & briefs/goal-<id>.md slices
│   ├── goals.json                             # Structured goals with rigor tiers & criteria
│   ├── notepad.md                             # Compaction-resilient Priority / Working / Manual notes
│   └── ledger.jsonl                           # Append-only execution audit trail (guarded by append-only-guard)
├── goals/performance/<slug>/                  # Performance baseline, checkpoints.jsonl, summary.md
├── evidence/                                  # Verified task-<id>.json & goal-<id>.json completion receipts
└── artifacts/                                 # Reusable outputs: handoff-latest.md, pr-body-*.md, ideas/, research/, loft/, ask-*
```

### How to Resume Interrupted Work
- **In the same conversation (including after `/compact`)**: Say `continue`, `resume`, or `keep going`. When `<CONTEXT_SUMMARY>` compaction occurs, `PreInvocation` automatically re-injects `omagy_wiki/` agreements and `.omagy/ultragoal/notepad.md` (`compactionEpoch`), and the agent resumes from `current_phase`.
- **Across conversations**:
  1. Run `/hud --handoff` before closing the session.
  2. In the new session, paste the generated **Resume Prompt** from `.omagy/artifacts/handoff-latest.md`.
- **Parent-Project Anchoring & Inner-Folder `.omagy` Discovery**: `stateRoot` walks upward so working in a subfolder anchors `.omagy/` at the parent project root, while `discoverOmagyScopes` tracks any existing `<subfolder>/.omagy/` scopes in HUD `Overview`. Place an empty `.omagy-workspace` file in a parent folder to anchor multi-repo workspaces.

---

## 6. Project Wiki (`omagy_wiki/`) & Subdirectory `AGENTS.md`

Unlike `.omagy/` (transient workflow state), **`omagy_wiki/`** is designed to be **committed to git**:

1. **`omagy_wiki/agreements.md` (Working-Agreement Ledger)**:
   Stores user preferences and architectural guardrails (`[v1]`–`[v10]`), injected ahead of `index.md` on `SessionStart`, `PreInvocation`, and post-compaction recovery. Protected by `PreToolUse` `agreements-guard` (`[by:human]`) and `floor-guard` (`rule-removed` / `threshold-loosened`), with automatic `expires: <ISO 8601>` filtering and secret redaction.
2. **`omagy_wiki/index.md`, `<slug>.md` & Append-Only `log.md`**:
   Searchable via `hooks/run.sh wiki-query` (weighted `tags*3 + title*2 + body*1` + CJK bi-grams) and verified via `hooks/run.sh wiki-lint` (zero broken `[[slug]]` links or dead `file:line` references). `omagy_wiki/log.md` is protected against full-file overwrites by `PreToolUse` `append-only-guard`.
3. **Hierarchical Subdirectory `AGENTS.md` & Child-Project `omagy_wiki/`**:
   Bootstrap candidate subdirectories via `/doctor --init-deep` (`init-deep-scan`); `PreInvocation` injects nested `AGENTS.md` and child `omagy_wiki/` files automatically when prompts reference those paths.

---

## 7. Lifecycle Hooks & CLI Utilities (30 Total)

`oh-my-agy` wires its hooks through [`hooks.json`](hooks.json) -> [`hooks/run.sh`](hooks/run.sh) -> [`hooks/omagy-hook.mjs`](hooks/omagy-hook.mjs) (`< 175 KB`), dynamically importing [`hooks/omagy-cli.mjs`](hooks/omagy-cli.mjs) (`< 93,734 B`) for cold CLI evaluators and [`hooks/omagy-selftest.mjs`](hooks/omagy-selftest.mjs) for `selftest`:

- **`SessionStart` & `PreInvocation` (Enabled by default)**:
  - Strips UTF-8 BOMs (`stripUtf8Bom`) and sanitizes relayed `[Message ...]` / `<SYSTEM_MESSAGE>` / `<CONTEXT_SUMMARY>` blocks (`sanitizeRelayedText`), fenced/inline code, comments, blockquotes, URLs, quotes, negations, and help queries before `/skill` / `$skill` detection.
  - Detects `<CONTEXT_SUMMARY>` compaction epochs (`compactionEpoch`) even when the user says `"continue"`, re-injecting `omagy_wiki/` (`<= 3,500` chars) + `.omagy/ultragoal/notepad.md` (`<= 2,000` chars), and enforces a deterministic `<= 6,000`-char ceiling on `injectSteps[0].ephemeralMessage` (`routing + modes` > `compaction recovery` > `wiki` > `subdir AGENTS.md` > `codebase-map`).
- **`Stop` (Enabled by default)**:
  - Bails out immediately (`{ decision: "stop" }`) on context-overflow markers (`isContextOverflowStop`), honors `awaiting_confirmation` holds, caps continuation nudges at 2 without a state update, and enforces user-refusal finality (`blocked`).
  - Runs **`checkVerificationFreshness`** (`<= 512 KB` transcript tail scan, isolated on `runtimeFile(conv, 'freshness')` and exempting `.omagy/**`, `omagy_wiki/**`, and `<appDataDir>/brain/**`) to nudge once when source files changed after the last passing test (`stale`) or when the last test failed (`fail`), alongside **`scanDiffBlockers`** (`runtimeFile(conv, 'drift')`).
- **`PreToolUse` (Opt-in in `hooks.json`)**:
  - Enforces `append-only-guard` (blocking `Overwrite: true` on non-empty `.omagy/ultragoal/ledger.jsonl` and `omagy_wiki/log.md` before planning exemptions), the planning-phase write boundary, `protected-block-guard`, `agreements-guard`, `notifications-guard`, and `write-existing-file-guard`.

### Built-In Hook CLI Commands (30 Total)

```bash
# 1. Run the 85-check offline hook, runtime, and static repository selftest (hooks/omagy-selftest.mjs)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh selftest

# 2. Evaluate TF-IDF skill routing accuracy, owner-negative survival, and cosine collisions across all 20 skills (>=95% default)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh skill-eval --min-rank1 95

# 3. Run 9-category anti-tampering floor guard across working tree + staged + untracked against HEAD or <baseRef> (exit 0|1|2)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh floor-guard . main --json

# 4. Validate semgrep and axe scanner JSON reports fail-closed (exit 0 clean, 1 blocking findings, 2 empty/invalid scan)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh quality-gate semgrep-report.json axe-report.json --json

# 5. Validate a Google Stitch 2-Layer DESIGN.md (3-level YAML tokens, 8 sections, {category.subpath} refs, WCAG 4.5:1 AA or --strict 7.0:1 AAA)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh validate-design-md DESIGN.md --json

# 6. Run a real verification command, write .omagy/evidence/goal-<id>.json, and mark the goal complete in goals.json + ledger.jsonl
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh goal-done G1 --json -- npm test

# 7. Create, list, or roll back stash-free index-preserving shadow git checkpoints under refs/omagy/checkpoints/*
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh checkpoint create pre-refactor --json

# 8. Generate a secret-redacted session handoff packet (.omagy/artifacts/handoff-<slug>-<UTC>.md & handoff-latest.md)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh handoff . pre-compact --json

# 9. Scan commands or SQL/shell files for destructive hazards with a 48-char negation window (/code-review --security)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh lookout scripts/deploy.sh --json

# 10. Compute or verify SHA-256 plan + test-spec receipts and lint fake calendar timelines (.omagy/plans/ralplan-review-<slug>.json)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh plan-hash compute .omagy/plans/prd-auth.md --spec .omagy/plans/test-spec-auth.md --write-receipt APPROVE --json

# 11. Rank subdirectories needing nested AGENTS.md files by code density and git churn (/doctor --init-deep)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh init-deep-scan . --json

# 12. Query omagy_wiki/ pages with weighted tag/title/body scoring and CJK bi-grams (/wiki query)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh wiki-query "checkpoint freshness" omagy_wiki --json

# 13. Lint omagy_wiki/ for dangling [[slug]] links and dead or out-of-range file:line references (/wiki lint)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh wiki-lint omagy_wiki . --json

# 14. Scan JSONL session transcripts for compactions, orphan tool calls, and top normalized failure clusters without leaking prompts
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh session-scan ~/.gemini/antigravity/brain --json

# 15. Pre-assemble a git review package (supports -C <dir>; exits 3 on 0-commit or non-ancestor range)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh review-package . main HEAD .omagy/artifacts/reviews/review-pkg.md

# 16. Extract a single goal/task brief + Codebase Reuse Map from goals.json or a fence-aware markdown plan (exits 4 on unclosed fence)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh goal-brief .omagy/ultragoal/goals.json G1 .omagy/ultragoal/briefs/goal-G1.md

# 17. Validate a /team or /ultragoal completion evidence file (rejects echo/printf/true no-op commands, checks VERIFICATION_VERDICTS)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh verify-evidence . .omagy/evidence/task-1.json alpha 1

# 18. Validate a /team task board fail-closed (errors with team_task_read_failed on corrupt/mismatched task files)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh validate-team-tasks . alpha

# 19. Validate optional .omagy/config.json qualityGates (deep-interview, ralplan, code-review)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh quality-gates .

# 20. Append a crash-resilient newline-isolated JSONL record (auto-prepends \n if missing)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh append-jsonl .omagy/ultragoal/ledger.jsonl '{"ts":"2026-11-11T00:00:00Z","goal_id":"G1","event":"start"}'

# 21. Read a JSONL file tolerantly (skips partial/corrupted lines and strips UTF-8 BOM)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh read-jsonl .omagy/ultragoal/ledger.jsonl

# 22. Generate a lens-specific Boolean query matrix for /deep-research
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh research-matrix "Distributed Consensus" technical --json

# 23. Audit a /deep-research report against the 8-section & 5-dimension (>=85) rubric (including conversion_altered_number check)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh audit-research .omagy/artifacts/research/report.md --json

# 24. Scan test files for 7 AI-slop junk-test patterns (suppress with // check-test-junk: ignore)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh check-test-junk tests/ --json

# 25. Build a shared-first codebase export map (prioritizes shared/utils/lib folders)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh codebase-map . 1800

# 26. Harvest shortcut: / ceiling: technical debt markers and upgrade conditions
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh scan-debt . --json

# 27. Classify PR / CI / review readiness with 60s zero-checks confirmation window (/pr --watch)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh watch-pr '{"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","checks":{"passed":3}}'

# 28. Normalize test failure output for repeated-failure deduplication (/ultraqa)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh failure-sig "=== 4 passed in 1.20s (0:00:01) ==="

# 29. Compare two JSONL session transcripts with 30m idle-gap subtraction and zero prompt/path leakage (/doctor --session-compare)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh session-compare baseline.jsonl candidate.jsonl --fail-on-regression

# 30. Repair [[wiki-links]] and [label](slug.md) links outside code spans on move/archive/delete (/wiki)
sh ~/.gemini/config/plugins/oh-my-agy/hooks/run.sh wiki-repair omagy_wiki '{"moved":{"old-slug":"new-slug"},"archived":["old-arch"],"deleted":["gone"]}'
```

---

## 8. End-to-End Recipes

### Recipe 1: Greenfield Feature from Idea to Verified Code (`/autopilot`)
```text
/autopilot Build a webhook delivery subsystem with HMAC-SHA256 signatures, exponential backoff retries, dead-letter queue inspection, and integration tests
```
*What happens*: Runs `/deep-interview` -> `/ralplan` (`planner` -> `architect` -> `critic` consensus + SHA-256 `plan-hash` receipt) -> `/ultragoal` (executes goals sequentially with `checkpoint`, `goal-done`, and `verifier` + `architect` final gates).

### Recipe 2: Stitch Design System + Visual Implementation (`/visual-ralph --design` -> `/visual-ralph`)
```text
/visual-ralph --design Create DESIGN.md from the high-density-fintech preset and verify WCAG AA contrast
```
*(After `validate-design-md DESIGN.md` exits `0`)*
```text
/visual-ralph Implement the portfolio overview screen matching reference.png and DESIGN.md tokens
```

### Recipe 3: Hard Bug Investigation & Adversarial Hardening (`/analyze --deep` -> `/ultraqa`)
```text
/analyze --deep Why do concurrent checkout requests occasionally fail with a stale inventory version error?
```
*(After reviewing the 3-lane `tracer` root-cause synthesis and applying the fix)*
```text
/ultraqa --tests Verify the checkout concurrency fix against race conditions and partial rollbacks
```

### Recipe 4: Parallel Migration, Security Review & PR (`/ralplan --migrate` -> `/team` -> `/code-review --security` -> `/pr --ship`)
```text
/ralplan --migrate Migrate the 8 legacy REST controllers in src/controllers/ to typed Zod route handlers
/team 4:executor Execute .omagy/plans/prd-zod-routes.md
/code-review --security
/pr --ship
```

### Recipe 5: Save Context Before `/compact` and Record Team Guardrails (`/wiki` + `/hud --handoff`)
```text
/wiki add All public API handlers must validate request bodies with Zod before touching the database (category: agreements)
/wiki lint
/hud --handoff pre-compact
```
*(Then run `/compact` or open a new chat and paste the Resume Prompt from `.omagy/artifacts/handoff-latest.md`.)*
