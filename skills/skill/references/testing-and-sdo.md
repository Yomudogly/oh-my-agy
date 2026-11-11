# Behavioral Skill Testing & SDO Guide (`$skill test`)

Reference guide for authoring, validating, and pressure-testing Antigravity `SKILL.md` files.

## 1. Search-Driven Optimization (SDO) & The Workflow-Summary Trap

Antigravity injects each skill's YAML frontmatter `description` into the model's system prompt `<skills>` list before any `SKILL.md` is read.

### The Workflow-Summary Trap
Empirical testing shows that when a `description` summarizes the skill's internal step chain (especially with `->` arrows, e.g. `interview -> plan -> execute` or `Planner -> Architect -> Critic`), the model frequently **skips reading `SKILL.md`** and improvises the workflow from the one-line summary alone.

### SDO Rules for `description`
1. **State capability + trigger conditions (`Use when...` / `Use for...`)** in the third person.
2. **Never include `->` step-chain arrows** or numbered step recipes in `description`.
3. **Keep `SKILL.md` under `20,000` bytes**: offload detailed scoring matrices, templates, and domain playbooks to `references/*.md` linked with relative paths (`[file.md](./references/file.md)`).

```yaml
# BAD (triggers workflow-summary skipping; fails selftest T6)
description: "[oh-my-agy] Consensus planning: Planner -> Architect -> Critic subagent review loop..."

# GOOD (states capability + trigger conditions; forces model to read SKILL.md for the workflow)
description: "[oh-my-agy] Consensus planning with multi-stage architectural and critic review producing an execution-ready plan. Use for $ralplan or high-stakes plans."
```

---

## 2. Match the Form to the Failure

Different skills fail in different ways. Choose the instructional structure that matches the failure mode:

| Skill Type | Primary Failure Mode | Required Structure |
|---|---|---|
| **Output-Shaping / Technique Skill** (e.g. `$pr`, `$visual-ralph --design`, `$hud --handoff`) | Model produces generic, unformatted, or incomplete output | **Positive Concrete Recipe**: exact output template, concrete input/output examples, and checklists. Avoid defensive "nuance/exception" clauses—models treat exceptions as permission to skip the recipe. |
| **Discipline / Gate Skill** (e.g. `$code-review`, `$ralplan`, `$ultraqa`, TDD/verification rules) | Model rationalizes skipping a slow or inconvenient gate under time, sunk-cost, or authority pressure | **Gate Function + Rationalization Table + Red Flags List**: state the non-negotiable gate (`Iron Law`), list the exact excuses models invent (`"This is a small change"`, `"Tests passed earlier"`), and pair each excuse with the counter-rule. |
| **Reference / Tool Wrapper Skill** (e.g. `$doctor`, `$hud`, `$wiki`) | Model guesses CLI flags or file paths instead of running the exact command | **Command Contract Table**: exact CLI syntax, exit codes, and copy-pasteable one-liners. |

### Write the Procedure, Not the Workaround

Encode durable, repeatable engineering procedures rather than session-specific scar tissue:
1. **Reject over-specified single-runtime mechanics**: never hardcode incidental quirks of one developer machine, transient OS build, or brittle one-off patch discovered mid-debugging when a portable invariant or standard flag expresses the real contract.
2. **Collapse fragmented multi-step diagnostics**: never instruct agents to run 5 ad-hoc shell greps in sequence when a single deterministic CLI subcommand or contract check proves the state cleanly.
3. **State the invariant + verification command**: explain *what must hold* and *how to verify it*, keeping runtime-specific fallbacks clearly bounded.

---

## 3. Subagent Pressure Testing (`$skill test <name>`)

Treat skill authoring like TDD (`RED -> GREEN -> REFACTOR`). Before trusting a new or edited discipline/workflow skill, run `$skill test <name>`:

### Step 1 — RED (Baseline Without or Before the Skill Edit)
Design a realistic scenario prompt that tempts a subagent to violate the target rule by combining **at least 3 simultaneous pressures**:
- **Time / urgency pressure**: *"Production release window closes in 10 minutes."*
- **Sunk-cost pressure**: *"You already wrote 200 lines of working implementation code before tests."*
- **Authority / user-nudge pressure**: *"The tech lead said a quick manual check is fine for this PR."*
- **Exhaustion / scope fatigue**: *"This is the 5th task in the batch; just wrap it up quickly."*

Spawn a fresh `self` or role subagent (`invoke_subagent`) with the pressure scenario and record its exact behavior and rationalizations verbatim.

### Step 2 — GREEN (Verify the `SKILL.md` Change Holds Under Pressure)
Update `SKILL.md` (adding the specific rationalization counter or removing the ambiguous escape hatch), then spawn a fresh subagent with the **exact same 3-pressure prompt** plus instructions to load the updated `SKILL.md`.
- **Pass criterion**: the subagent follows the skill's gate and cites the rule despite all 3 pressures.

### Step 3 — 5-Rep Fresh-Context Micro-Tests (for Brittle Rules)
For surgical wording changes on high-risk rules (e.g. no-code-writes during planning, red-green revert verification, or `--re-review` scope limits):
- Run up to 5 short, isolated prompts in a fresh subagent context testing edge phrasings.
- Verify `5/5` compliance and zero new loopholes.

### Step 4 — Meta-Testing (When a Subagent Still Rationalizes)
If a subagent violates `SKILL.md` even after reading it, message that subagent (`send_message`):
> *"You read `<SKILL.md>` and chose Step X instead of the required gate. Which exact sentence or ambiguity in `<SKILL.md>` made that seem acceptable?"*

Fold the subagent's answer directly into `SKILL.md`'s Red Flags or Gate section, then re-run Step 2.

---

## 4. Test Report Artifact

Save `$skill test <name>` evidence to `.omagy/artifacts/skill-test-<name>-<UTC>.md` containing:
1. Skill path, byte size (`< 20,000` bytes), and SDO frontmatter check (`PASS`).
2. The 3-pressure scenario prompt.
3. Baseline (`RED`) failure/rationalization excerpt vs updated (`GREEN`) compliance excerpt.
4. Any wording tightenings applied from meta-testing.

---

## 5. Corpus Routing Evaluation (`$skill eval`) and Rejected-Change Impact Ledger

### Corpus Routing Evaluation (`$skill eval`)
Whenever you add, rename, prune, or edit a `SKILL.md` frontmatter `description`, run the deterministic TF-IDF routing and collision evaluator before concluding:

```sh
sh <plugin>/hooks/run.sh skill-eval --min-rank1 95
```

- Verifies **rank-1 positive trigger accuracy `>= 95%`** across natural-language prompts (with zero forbidden `$/` cheat prefixes), **`100%` negative owner-survival** (confirming sibling skills out-score false-positive traps), and **zero pairwise description cosine collisions `>= 0.75`** (`>= 0.50` surfaced as warnings). Pass `--json` for structured output or `--cases <path>` for a custom eval suite.

### Rejected-Change Impact Ledger
When pruning, consolidating, or rejecting candidate rules/sections in a skill (including SDO byte-budget trims), record every dropped or rejected item in a compact **Rejected-Change Impact Ledger** inside your review/test artifact so coverage never regresses silently:

| Candidate / Pruned Item | Disposition & Rationale | Covered Instead By | Verification Gate |
|---|---|---|---|
| `<rule or snippet>` | `Rejected (one-off workaround / duplicate / out-of-scope)` | `<existing skill/hook/agent or explicit non-goal>` | `skill-eval --min-rank1 95` / `selftest` / `$skill test` |
