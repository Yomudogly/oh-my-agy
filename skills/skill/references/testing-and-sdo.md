# Behavioral Skill Testing, SDO & Deterministic Authoring Reference

Reference manual for [SKILL.md](../SKILL.md) covering Search-Driven Optimization (SDO), `skill-init` & `skill-validate` CLI contracts, `.agents/skills.json` team sharing, conditional workflows, output patterns, `$skill test` pressure testing, and `$skill eval` routing benchmarks.

## Table of Contents

- [1. Search-Driven Optimization (SDO) and The Workflow-Summary Trap](#1-search-driven-optimization-sdo-and-the-workflow-summary-trap)
- [2. Deterministic CLI Reference (`skill-init` and `skill-validate`)](#2-deterministic-cli-reference-skill-init-and-skill-validate)
- [3. Team Skill Sharing via `.agents/skills.json`](#3-team-skill-sharing-via-agentsskillsjson)
- [4. Degrees of Freedom, Conditional Workflows, and Output Patterns](#4-degrees-of-freedom-conditional-workflows-and-output-patterns)
  - [Write the Procedure, Not the Workaround](#write-the-procedure-not-the-workaround)
- [5. Subagent Pressure Testing (`skill test`)](#5-subagent-pressure-testing-skill-test)
- [6. Test Report Artifact](#6-test-report-artifact)
- [7. Corpus Routing Evaluation (`skill-eval`) and Rejected-Change Impact Ledger](#7-corpus-routing-evaluation-skill-eval-and-rejected-change-impact-ledger)
  - [Corpus Routing Evaluation (`skill-eval`)](#corpus-routing-evaluation-skill-eval)
  - [Rejected-Change Impact Ledger](#rejected-change-impact-ledger)

---

## 1. Search-Driven Optimization (SDO) and The Workflow-Summary Trap

Antigravity injects each skill's YAML frontmatter `name` and `description` into the model's `<skills>` catalog before any `SKILL.md` file is opened.

### The Workflow-Summary Trap
When a `description` summarizes the internal step sequence (especially with step-chain arrows or numbered phases), models frequently **skip opening `SKILL.md`** and improvise from the one-line summary alone. Conversely, when trigger phrases live only inside body headings (`## When to Use`) instead of `description`, the model never activates the skill in the first place.

### SDO Frontmatter Rules
1. **Third-person capability + explicit trigger cues**: include concrete activation phrasing (`Use when...`, `Use for...`, `Triggers on...`, or `Activate...`) in `description` (`50..1,024` chars).
2. **Zero step-chain arrows or HTML markup**: never include the two-character step arrow (`-` followed immediately by `>`) in `description`, and never include HTML/XML tags (`<script>`, `<div>`, `<br/>`) or unclosed `<`/`>` brackets. Balanced CLI metavariables (`<command>`, `<slug>`, `<UTC>`) are permitted.
3. **Strict context budgets**: keep `SKILL.md <= 19,000` bytes (`< 20,000` B hard cap, `<= 500` lines) and offload deep reference material to 1-level-deep `references/*.md` files (`< 40,000` B each).

```yaml
# GOOD: states capability + explicit trigger cues without summarizing internal steps
name: schema-migration-guard
description: "Audit SQL and ORM migration files for lock-amplifying DDL, non-nullable backfills, and rollback safety. Use when creating, reviewing, or running database schema migrations."
```

---

## 2. Deterministic CLI Reference (`skill-init` and `skill-validate`)

Both commands run zero-dependency on Node.js (`>= 18`) via `hooks/omagy-skill.mjs`.

### `skill-init` — Scaffold a Clean Skill Directory

```sh
sh <plugin>/hooks/run.sh skill-init <skill-name> \
  [--scope project|shared|user] \
  [--dir <customParentDir>] \
  [--resources references,scripts,assets,resources] \
  [--description "<SDO description>"] \
  [-C <workspaceRoot>] \
  [--force] \
  [--json]
```

- **Target resolution**:
  - `--scope project` (default): `<rootDir>/.agents/skills/<skill-name>/`
  - `--scope shared`: `<rootDir>/tools/agents/skills/<skill-name>/` + idempotent registration in `<rootDir>/.agents/skills.json`
  - `--scope user`: `<OMAGY_USER_SKILLS_DIR || ~/.gemini/config/skills>/<skill-name>/`
  - `--dir <path>`: `<path>/<skill-name>/` (`scope: "custom"`)
- **Exit codes**:
  - `0`: scaffolded cleanly and verified with `validateSkillDirectory(..., { strict: true })`.
  - `1`: target directory is non-empty without `--force`, not a regular directory, or existing `.agents/skills.json` is malformed.
  - `2`: invalid `<skill-name>` (must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, `1..64` chars), unknown `--scope`, or unknown `--resources` bucket.

### `skill-validate` — Lint Single Skills, Collections, or `.agents/skills.json`

```sh
sh <plugin>/hooks/run.sh skill-validate [skillDirOrCollectionOrManifest] [-C <workspaceRoot>] [--strict] [--json]
```

- **Auto-detected `kind`**:
  - `'manifest'`: when target ends with `.json` (validates `.agents/skills.json` schema + existing local `entries[].path` child skills).
  - `'skill'`: when `<target>/SKILL.md` exists.
  - `'collection'`: when `<target>` is a parent folder of skill directories (ignores `.DS_Store` and hidden dotfiles).
- **Enforced checks (`exitCode: 0` clean, `1` validation failure, `2` missing/unreadable target)**:
  - UTF-8 no-BOM cleanliness, `name` (`1..64` chars kebab-case matching folder basename), `description` (`20..1,024` chars; `< 50` chars or missing trigger cues warns and fails under `--strict`).
  - Zero step-chain arrows or HTML/unbalanced `<>` in `description`; warns if `## When to Use` / `## When to Activate` appears in body while `description` lacks trigger cues.
  - `SKILL.md < 20,000` bytes (`> 19,000` bytes or `> 500` lines warns and fails under `--strict`); `references/*.md < 40,000` bytes, 1-level deep under `references/` (zero nested `references/sub/`), and `>= 2` `##` headings when `> 100` lines.
  - Skill-scoped relative link resolution across `.md` (`+#anchor`) and non-`.md` (`scripts/*`, `assets/*`, `resources/*`), rejecting `\` backslashes and escaping links (permitting `../<sibling>/...` only inside a multi-skill collection when `<parent>/<sibling>/SKILL.md` exists).
  - `fs.lstatSync` + `fs.realpathSync` symlink containment across every segment, personal OS home-path ban, empty-subdir ban, unresolved `TODO:` placeholder ban, and auxiliary clutter ban (`README.md`, `CHANGELOG.md`, `INSTALLATION_GUIDE.md`, `QUICK_REFERENCE.md`, `CREATION-LOG.md`, `test-*.md`, `example.py`, `*.skill`, `__pycache__`, `*.pyc`).

---

## 3. Team Skill Sharing via `.agents/skills.json`

To share skills across a repository or monorepo under version control with regex filtering, declare `.agents/skills.json` using Antigravity's official two-key schema (`entries` and `inherits` only):

```json
{
  "entries": [
    {
      "path": "tools/agents/skills",
      "include_only": ["^(?:release|api|db)-"],
      "exclude": ["^experimental-"]
    }
  ],
  "inherits": [
    {
      "path": "../shared-platform/.agents/skills.json",
      "exclude": ["^internal-only-"]
    }
  ]
}
```

- **Allowed top-level keys**: `entries` and `inherits` (arrays).
- **Allowed item keys**: `path` (required non-empty string; workspace-relative `entries[].path` must not traverse `..`), `include_only` (optional array of valid JS regular expression strings), and `exclude` (optional array of valid JS regular expression strings).
- Validate directly with `sh <plugin>/hooks/run.sh skill-validate .agents/skills.json --strict --json`.

---

## 4. Degrees of Freedom, Conditional Workflows, and Output Patterns

### Conditional Workflow Pattern
When a skill supports distinct operational branches (for example, auditing an existing artifact vs creating one from scratch), place an explicit routing gate at the top of `## Workflow` instead of mixing instructions:

```markdown
## Workflow
1. Classify the request mode:
   - **New artifact** -> execute **Path A (Scaffold & Author)**.
   - **Existing artifact** -> execute **Path B (Inspect, Diff & Repair)**.
2. **Path A**: run `scripts/init.mjs`, populate required fields, then jump to Step 4.
3. **Path B**: read the existing file in full, preserve user-owned sections, apply minimal edits.
4. **Verify**: run `scripts/validate.mjs --strict` and report exit code `0`.
```

### Strict vs Flexible Output Templates & Input/Output Examples

- **Strict Output Template (Low Freedom)**: use for machine-parsed JSON, compliance gates, or PR/release headers where exact headings are mandatory:
  ```markdown
  ALWAYS emit this exact verdict block with zero extra headings:
  ## Verdict: <APPROVE | REQUEST CHANGES>
  - **Blocking Issues**: <count>
  - **Verification Command**: `<exact command>` (exit `<code>`)
  ```
- **Flexible Output Template + Concrete Input/Output Pair (Medium Freedom)**: use when structural clarity matters more than rigid wording, pairing the template with one realistic input/output example:
  ```markdown
  Input: fixed race in `hooks/omagy-skill.mjs` when `.agents/skills.json` has BOM
  Output: `fix(skill): strip UTF-8 BOM before parsing .agents/skills.json`
  ```

### Match the Form to the Failure

| Skill Type | Primary Failure Mode | Required Structure |
|---|---|---|
| **Output-Shaping / Technique Skill** (e.g. `$pr`, `$visual-ralph --design`, `$hud --handoff`) | Model produces generic, unformatted, or incomplete output | **Positive Concrete Recipe**: output template + concrete input/output example + verification checklist. Avoid defensive exception clauses that invite skipping. |
| **Discipline / Gate Skill** (e.g. `$code-review`, `$ralplan`, `$ultraqa`) | Model rationalizes skipping a gate under time, sunk-cost, or authority pressure | **Gate Function + Rationalization Table + Red Flags**: state the non-negotiable gate, list common excuses (`"Small change"`, `"Already tested earlier"`), and pair each with the counter-rule. |
| **Reference / Tool Wrapper Skill** (e.g. `$doctor`, `$hud`, `$wiki`, `$skill`) | Model guesses CLI flags or paths instead of running the exact subcommand | **Command Contract Table**: exact CLI syntax, flags, exit codes (`0\|1\|2`), and JSON output contract. |

### Write the Procedure, Not the Workaround

Encode durable, repeatable engineering procedures rather than session-specific scar tissue:
1. **Reject over-specified single-runtime mechanics**: never hardcode transient quirks of one developer machine when a portable invariant or CLI flag expresses the contract.
2. **Collapse fragmented diagnostics**: replace multi-step ad-hoc grep chains with a single deterministic validator (`skill-validate`, `wiki-lint`, `floor-guard`).
3. **State invariant + verification command**: specify *what must hold* and *which command proves it*.

---

## 5. Subagent Pressure Testing (`skill test`)

Before trusting a new or edited discipline/workflow skill, run `$skill test <name>`:

1. **RED (Baseline Under 3 Simultaneous Pressures)**: craft a realistic scenario combining at least three pressures — **time urgency** (*"Release window closes in 10 minutes"*), **sunk cost** (*"200 lines are already written"*), **authority nudge** (*"Lead said manual spot-check is enough"*), or **batch fatigue** — and run a fresh subagent (`invoke_subagent`) without the skill update to capture its exact rationalizations.
2. **GREEN (Compliance With Updated `SKILL.md`)**: tighten `SKILL.md` to close the loophole, then spawn a fresh subagent with the identical 3-pressure prompt plus instructions to load `SKILL.md`. Require explicit gate compliance across all three pressures.
3. **5-Rep Micro-Tests & Meta-Testing**: for high-risk wording, run up to 5 short edge-phrasing prompts (`5/5` pass required). If a subagent still rationalizes a bypass, ask via `send_message` which exact sentence made the shortcut appear acceptable and tighten that line.

---

## 6. Test Report Artifact

Save `$skill test <name>` evidence to `.omagy/artifacts/skill-test-<name>-<UTC>.md` recording:
1. Target `SKILL.md` path, byte size (`<= 19,000` B / `< 20,000` B), and `skill-validate --strict` exit code (`0`).
2. The 3-pressure prompt verbatim.
3. Baseline (`RED`) rationalization vs updated (`GREEN`) compliance evidence.
4. Any meta-test wording refinements applied.

---

## 7. Corpus Routing Evaluation (`skill-eval`) and Rejected-Change Impact Ledger

### Corpus Routing Evaluation (`skill-eval`)

Whenever you add, rename, prune, or edit a plugin `SKILL.md` `description`, run the deterministic TF-IDF routing and collision evaluator:

```sh
sh <plugin>/hooks/run.sh skill-eval --min-rank1 95 --json
```

- Enforces **`rank1Pct >= 95%`** across natural-language positive prompts (rejecting leading `$` or `/` command-prefix cheats), **`negativeSurvivalPct === 100%`** on sibling-owned negative prompts, and **`collisionErrors.length === 0`** (`cosine < 0.75`; warnings surfaced at `>= 0.50`).

### Rejected-Change Impact Ledger

When pruning, consolidating, or rejecting candidate skill sections during edits or byte-budget trims, log every dropped item so coverage never regresses silently:

| Candidate / Pruned Item | Disposition & Rationale | Covered Instead By | Verification Gate |
|---|---|---|---|
| `<rule or snippet>` | `Rejected (one-off workaround / duplicate / out-of-scope)` | `<existing skill, hook, script, or explicit non-goal>` | `skill-validate --strict` / `skill-eval --min-rank1 95` / `$skill test` |
