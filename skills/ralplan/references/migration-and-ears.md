# Strangler Migration Planning, EARS Requirements & Plan Receipts (`$ralplan --migrate`)

Reference playbook for [`skills/ralplan/SKILL.md`](../SKILL.md). Load this reference when `$ralplan --migrate` is invoked (or when a consensus plan involves legacy module replacement, database schema evolution, public API versioning, or major SDK/runtime upgrades), and apply its EARS acceptance grammar and `plan-hash` receipt gate across consensus plans.

## 1. Four-Stage Strangler Migration Sequence (`--migrate`)

Never plan a "big-bang" rewrite that deletes legacy code before parity is proven. Decompose every `--migrate` PRD (`.omagy/plans/prd-<slug>.md`) and test specification (`.omagy/plans/test-spec-<slug>.md`) into four sequential, independently revertible stages:

| Stage | Goal Rigor | Primary Deliverable | Rollback & Safety Invariant |
| :--- | :---: | :--- | :--- |
| **1. Characterization Tests** | `light` or `heavy` | Golden input/output/error fixtures locking current legacy behavior | Zero production code edits; tests pass 100% against untouched legacy path |
| **2. Strangler Adapter / Seam** | `heavy` | Caller-transparent routing boundary + additive DB/schema **Expand** | Default flag/route stays 100% legacy; zero wire/schema breakage |
| **3. Dual-Run / Shadow Parity** | `heavy` | Target implementation behind seam + shadow comparator + instant rollback switch | Mismatches logged/failed without corrupting state; instant config rollback (`RTO` seconds) |
| **4. Cutover & Decommission** | `heavy` | Default routing flip + dead legacy removal + DB **Contract** cleanup | Zero open callers of removed legacy symbols (`analyzeDiffCodeHealth` green) |

### Stage 1: Characterization Tests (Lock Observable Legacy Behavior First)
- Capture real inputs, outputs, side effects, exit/status codes, ordering guarantees, and edge-case quirks of the legacy module **before** modifying production paths.
- Separate **contractual invariants** (must remain behavior-identical) from **approved bug fixes** (explicitly documented deltas in `.omagy/plans/prd-<slug>.md` so parity checks expect the fix).
- Forbid refactoring legacy internals during Stage 1.

### Stage 2: Strangler Adapter / Routing Seam & Expand-Only Schema
- Introduce a single narrow adapter, facade, or config-driven router in front of legacy callers so call sites do not branch on `if (useNewSystem)` across dozens of files.
- Keep default traffic/execution `100%` on the legacy implementation at Stage 2 completion.
- **Expand / Contract Persistence & Wire Rule**:
  - Stage 2 performs **Expand only**: nullable columns, additive JSON/protobuf fields, dual-tolerant readers, and backward-compatible writers.
  - Never drop columns, rename persisted keys, or tighten constraints before Stage 4 cutover stabilization.

### Stage 3: Dual-Run / Shadow Parity Verification & Rollback Switch
- Implement the replacement module behind the Stage 2 seam.
- Prove behavioral equivalence via **shadow dual-read execution** or **deterministic fixture replay** comparing legacy vs replacement outputs, error classifications, and latency budgets.
- Require an **instant configuration/environment rollback switch** that restores legacy routing without redeploying binaries or running destructive down-migrations.
- Ensure any dual-write migration step is idempotent under retries, partial crashes, and out-of-order replays.

### Stage 4: Cutover & Legacy Decommission
- Flip default routing to the replacement path only after Stage 3 parity verification passes with `0` unapproved divergences.
- Decommission legacy implementations, temporary shadow comparators, compatibility shims, and **Contract-phase** schema artifacts in a dedicated final goal.
- Verify via `grep -rnE` and `analyzeDiffCodeHealth` (`scanDiffBlockers`) that zero dangling imports or open callers of removed legacy symbols remain.

## 2. EARS (`Easy Approach to Requirements Syntax`) Acceptance Grammar

Ambiguous prose criteria (*"handles errors gracefully"*, *"supports legacy payloads"*) cause downstream executor-vs-verifier disputes. Author acceptance criteria in `.omagy/plans/prd-<slug>.md` and `.omagy/plans/test-spec-<slug>.md` using the 5 canonical **EARS** patterns:

| EARS Pattern | Canonical Syntax | Concrete Testable Example |
| :--- | :--- | :--- |
| **Ubiquitous** | `THE <system> SHALL <observable response>.` | `THE token parser SHALL reject payloads larger than 65,536 bytes with exit code 1.` |
| **Event-Driven** | `WHEN <trigger event>, THE <system> SHALL <observable response>.` | `WHEN a client submits an expired session cookie, THE auth middleware SHALL return HTTP 401 without querying the profile store.` |
| **State-Driven** | `WHILE <active state>, THE <system> SHALL <observable response>.` | `WHILE shadow parity mode is enabled, THE router SHALL return the legacy response and record any payload digest mismatch.` |
| **Unwanted-Behavior** | `IF <fault or invalid condition>, THEN THE <system> SHALL <recovery or refusal>.` | `IF the migration lock times out after 5,000 ms, THEN THE runner SHALL abort with exit code 2 and leave existing rows unchanged.` |
| **Optional-Feature** | `WHERE <feature or config is enabled>, THE <system> SHALL <observable response>.` | `WHERE qualityGates.ralplan is configured in .omagy/config.json, THE gate runner SHALL invoke each non-reserved skill in an independent subagent.` |

### EARS Authoring Checklist
1. **Explicit subject**: every criterion names the exact module, CLI subcommand, endpoint, or state machine (`THE <system>`).
2. **Deterministic postcondition**: every `SHALL` clause states a machine-checkable postcondition (exit code, HTTP status, JSON field, file/ledger write, or bounded metric threshold) with zero vague adjectives (`fast`, `clean`, `seamless`, `robust`).
3. **1:1 Test-Spec Mapping**: every EARS acceptance criterion in `prd-<slug>.md` maps to a concrete verification command or adversarial probe in `test-spec-<slug>.md`.

## 3. Deterministic `plan-hash` Receipt & Fake-Timeline Lint Gate

AI-generated plans must sequence work by **DAG dependencies, vertical feature slices, rigor tiers, and verification gates** — never by fabricated human calendar promises or effort estimates.

### Forbidden Fake-Timeline Patterns
`verifyPlanHash` (`sh <plugin>/hooks/run.sh plan-hash`) scans non-fenced PRD prose (ignoring fenced code blocks and inline backticks, and honoring a 48-character negation window such as *"avoid calendar promises"*) and fails with `exitCode: 1` (`timelineViolations`) whenever un-negated schedule promises appear:
- Numbered week buckets (for example, `Week` followed by digits)
- Multi-unit duration estimates (for example, numeric ranges of `days`, `weeks`, or `months`)
- Calendar quarter targets (for example, `Q1`–`Q4` followed by a 4-digit year)
- Numbered sprint labels (for example, `Sprint` followed by digits)

If `plan-hash compute` exits `1` due to `timelineViolations`, replace calendar labels with dependency-ordered stages (`Stage 1`, `Goal G1`, `Depends On: ["G1"]`) before requesting or recording consensus approval.

### Dual `.md` + `.json` Consensus Receipt Protocol
When Critic returns `APPROVE` in `$ralplan` Step 6, persist **both** artifacts under `.omagy/plans/`:

1. **Human & HUD Review Log (`.omagy/plans/ralplan-review-<slug>.md`)**:
   - Records Architect antithesis/tradeoffs, Critic review, custom `qualityGates.ralplan` verdicts, 4-Tier `RECONCILE` dispositions, and any `Ruling: <decision> — <why> — <cost_if_wrong>` entries.
2. **Cryptographic Receipt (`.omagy/plans/ralplan-review-<slug>.json`)**:
   - Generated deterministically via:
     ```sh
     sh <plugin>/hooks/run.sh plan-hash compute .omagy/plans/prd-<slug>.md --spec .omagy/plans/test-spec-<slug>.md --write-receipt APPROVE --json
     ```
   - Receipt payload written on `exitCode: 0`:
     ```json
     {
       "slug": "<slug>",
       "prd_file": ".omagy/plans/prd-<slug>.md",
       "test_spec_file": ".omagy/plans/test-spec-<slug>.md",
       "prd_hash": "<64-hex-sha256>",
       "spec_hash": "<64-hex-sha256>",
       "plan_hash": "<64-hex-combined-sha256>",
       "critic_verdict": "APPROVE",
       "verified_at": "<ISO-8601>"
     }
     ```

### Pre-Execution Verification in `$ultragoal`
When `$ultragoal` starts from a `$ralplan` PRD, run:
```sh
sh <plugin>/hooks/run.sh plan-hash verify .omagy/plans/prd-<slug>.md .omagy/plans/ralplan-review-<slug>.json --json
```
- `exitCode: 0` (`ok: true`, `matches: true`): `prd-<slug>.md` and `test-spec-<slug>.md` match the Critic-approved SHA-256 hash with zero fake-timeline violations.
- `exitCode: 1` (`matches: false`): the PRD or test spec drifted after approval (or lacks `critic_verdict: "APPROVE"`). Halt execution until the edit is re-approved via `$ralplan` or recorded as an explicit authorized `steer` (`criteria_revision` increment).

## 4. Strangler PRD Goal Skeleton (`--migrate` Template)

```markdown
### Goal G1 — Characterization Fixtures for Legacy `<Module>`
- **Rigor**: `"light"`
- **Depends On**: `[]`
- **Acceptance Criteria (EARS)**:
  1. THE characterization suite SHALL replay 25 golden request/response fixtures against `<legacyModule>` with exit code 0.
  2. WHEN `<legacyModule>` receives malformed input `<case>`, THE suite SHALL assert the exact legacy error code before any seam edit.

### Goal G2 — Strangler Routing Seam & Expand-Only Schema
- **Rigor**: `"heavy"`
- **Depends On**: `["G1"]`
- **Acceptance Criteria (EARS)**:
  1. WHILE `MIGRATION_MODE=legacy` (default), THE `<Adapter>` SHALL route 100% of calls to `<legacyModule>` with zero behavior delta on `G1` fixtures.
  2. WHERE schema columns are added, THE migration SHALL use nullable/defaulted **Expand** definitions compatible with the un-upgraded reader.

### Goal G3 — Shadow Parity Comparator & Instant Rollback Switch
- **Rigor**: `"heavy"`
- **Depends On**: `["G2"]`
- **Acceptance Criteria (EARS)**:
  1. WHILE `MIGRATION_MODE=shadow`, THE `<Adapter>` SHALL return the legacy output and fail CI if `<targetModule>` diverges on any `G1` fixture.
  2. IF `<targetModule>` throws or exceeds `<budget> ms`, THEN THE `<Adapter>` SHALL fall back to `<legacyModule>` via config toggle in `< 5 s` RTO.

### Goal G4 — Default Cutover & Legacy Decommission
- **Rigor**: `"heavy"`
- **Depends On**: `["G3"]`
- **Acceptance Criteria (EARS)**:
  1. WHEN `MIGRATION_MODE` defaults to `target`, THE `<targetModule>` SHALL pass all characterization and adversarial probes with exit code 0.
  2. THE repository SHALL contain zero open callers or dead imports of `<legacyModule>` (`analyzeDiffCodeHealth` `openCallers.length === 0`).
```
