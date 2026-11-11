# Arena Bake-Off Protocol (`$loft --arena`)

Reference playbook for [`skills/loft/SKILL.md`](../SKILL.md). Use `$loft --arena` when an architectural, algorithmic, state-machine, or UI fork has `2..3` plausible contenders that prose cannot separate and each contender needs an isolated runnable prototype judged against one frozen contract.

## 1. When to Use `--arena` vs Standard `$loft`

| Situation | Mode | Output Footprint |
| :--- | :--- | :--- |
| Pure state/rule model check or 3 structural UI layouts behind one switcher | Standard `$loft` | `.omagy/artifacts/loft/<slug>/index.html` |
| `2..3` competing runtime algorithms, data structures, parser designs, or multi-component UX flows whose implementations would collide in one file | `$loft --arena` | `.omagy/artifacts/loft/<slug>/variant-a/` .. `variant-c/` + `arena-verdict.md` |
| High-risk production slice inside an active multi-worker execution board | `$team --arena` | `Workspace: "share"` branches + `.omagy/evidence/task-<id>-*.json` |

- Never exceed `N=3` variants. Eliminate weak contenders on paper first using the 6-Rung Reuse Ladder (`rules/AGENTS.md`).
- Keep one arena per fork: never vary both the underlying algorithm and the UI layout simultaneously across candidates.

## 2. Freeze the Contract & Shared Harness First (Leader Lane)

Before spawning any worker, freeze the shared evaluation contract under `.omagy/artifacts/loft/<slug>/contract.md` and, when executable, a deterministic fixture or benchmark runner under `.omagy/artifacts/loft/<slug>/harness/`:

1. **Question under test**:
   - Write one falsifiable fork statement (for example, *"Event-sourced ring buffer vs immutable snapshot reducer for 10k-row undo/redo"* or *"Command-palette drawer vs split-pane inspector for triage speed"*).
2. **Identical input fixtures**:
   - Supply realistic payloads, boundary edge cases (empty state, unicode/long tokens, malformed records, rapid burst events), viewport sizes (`1280x800` and `320px` reflow for UI), and seed data that every variant must execute unchanged.
3. **Weighted scoring rubric**:
   - **Correctness & Edge-Case Survival** (`40%`): passes every frozen fixture without silent fallbacks or swallowed errors.
   - **Complexity & LOC (`Lean:`)** (`25%`): total lines of code, distinct concept count, and zero-dependency footprint (`Lean: <LOC> lines, <deps> deps`).
   - **Performance or UX Ergonomics** (`20%`): measured p50/p95 latency and peak memory on the shared benchmark, or keyboard/scan density plus loading/empty/error state triad for UI variants.
   - **Reversibility (`cost_if_wrong`)** (`15%`): blast radius if requirements change later (`low | medium | high` + 1-line migration cost).
4. **Hard guardrails**:
   - Zero production database migrations, zero new package installs unless dependency selection itself is the fork, and zero commits to `main`.

Contract template (`.omagy/artifacts/loft/<slug>/contract.md`):
```markdown
# Loft Arena Contract: <slug>

## Fork Statement
<single falsifiable architectural / UX / algorithmic question>

## Candidates
- **Variant A**: <distinct thesis A>
- **Variant B**: <distinct thesis B>
- **Variant C** (optional): <distinct thesis C>

## Frozen Fixtures & Harness Command
- Fixture path: `.omagy/artifacts/loft/<slug>/harness/fixtures.json`
- Benchmark / check command: `node .omagy/artifacts/loft/<slug>/harness/run.mjs <variant-dir>`

## Disqualification Triggers
1. Fails any frozen fixture or mutates shared fixture inputs.
2. Adds unrequested external dependencies or touches production source outside the prototype sandbox.
```

## 3. Parallel Variant Dispatch (`Workspace: "share"`)

Spawn `N=2..3` parallel `executor` subagents (or `designer` subagents for UI forks) in a single `invoke_subagent` batch with `Workspace: "share"` and `Model: "inherit"`:

- Assign each worker **one distinct approach** (`variant-a`, `variant-b`, optional `variant-c`) so workers cannot converge on the same compromise design.
- **Output isolation**:
  - Self-contained prototype files live under `.omagy/artifacts/loft/<slug>/variant-a/`, `.omagy/artifacts/loft/<slug>/variant-b/`, and `.omagy/artifacts/loft/<slug>/variant-c/` (or on isolated worktree branches `loft/<slug>-a`, `loft/<slug>-b`, `loft/<slug>-c` when repository module imports are required).
  - Workers must not read sibling variant directories or mutate `.omagy/state/`.

Worker brief template:
```text
LOFT ARENA — VARIANT <A|B|C>: <distinct hypothesis name>
Contract & Fixtures: .omagy/artifacts/loft/<slug>/contract.md
Owned Output Path: .omagy/artifacts/loft/<slug>/variant-<a|b|c>/
Assigned Approach: <exact structural or algorithmic thesis to prove>
Constraints:
- Implement ONLY the assigned thesis against the frozen contract; do not blend sibling approaches.
- Keep dependencies at zero and code minimal (report exact LOC and concept count).
- Run the shared harness/fixtures and capture raw command outputs + exit codes.
Report back:
1. Summary of how the thesis handled the fixtures
2. Exact files written + total LOC (`Lean: <N> lines`)
3. Raw benchmark / fixture verification output and exit code
4. Honest failure modes or `cost_if_wrong` limits discovered while building
```

## 4. Blind Independent `critic` Evaluation

Once all `2..3` workers return, re-run the shared harness in the leader lane so metrics are measured under identical conditions, strip worker narrative self-praise, and assemble a **Blind Arena Packet** for a fresh `critic` subagent (`TypeName: "critic"`, `Model: "pro"` or `"inherit"`):

1. Label candidates neutrally (`Variant A`, `Variant B`, `Variant C`) with their file paths, measured LOC counts, and raw leader-verified harness outputs + exit codes.
2. Pass `.omagy/artifacts/loft/<slug>/contract.md` verbatim.
3. Require the `critic` to return:
   - A per-criterion scorecard table across Correctness, `Lean:` complexity, Performance/UX, and `cost_if_wrong`.
   - Verdict:
     - `APPROVE <Variant>`: one contender wins cleanly on correctness and composite score.
     - `APPROVE <Variant> WITH GRAFT`: one contender wins structurally plus one bounded, low-coupling trait from a runner-up.
     - `REJECT ALL`: every variant violates correctness or frozen invariants (revise the contract or hypothesis set before retrying once).
   - Explicit `Decision:` and `Rejected:` lines citing concrete `file:line` or metric deltas.

Verdict artifact template (`.omagy/artifacts/loft/<slug>/arena-verdict.md`):
```markdown
# Loft Arena Verdict: <slug>

- **Question**: <fork statement>
- **Critic Verdict**: APPROVE Variant B
- **Decision**: Adopt Variant B's <core mechanism> — <measured delta / why> — `cost_if_wrong`: <bound>.
- **Rejected**:
  - Variant A (`<title>`): <concrete failure mode, LOC bloat, or latency delta>.
  - Variant C (`<title>`): <concrete failure mode, LOC bloat, or coupling risk>.

## Scorecard
| Variant | Correctness (40%) | Lean / LOC (25%) | Perf / UX (20%) | Reversibility (15%) | Total |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Variant A | 36/40 | 16/25 (310 LOC) | 15/20 | 10/15 | 77 |
| Variant B | 40/40 | 23/25 (118 LOC) | 18/20 | 14/15 | 95 |
```

## 5. User Selection, Variant Grafting & Worktree Cleanup

1. **Present the evidence**:
   - Show the compact scorecard, `Decision:` / `Rejected:` summary, and runnable artifact links (plus `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` when HTML variants are inspectable in the `Loft` tab).
   - When visual/UX taste or product tradeoffs remain close, call `ask_question` with the `critic`-recommended winner first (`(Recommended) Variant B — ...`).
2. **Fold into durable specs**:
   - Write the winning `Decision:` + `Rejected:` rationale into `.omagy/specs/deep-interview-<slug>.md`, `.omagy/plans/prd-<slug>.md`, or `DESIGN.md` (documenting any approved hybrid graft explicitly).
3. **Preserve evidence before cleanup**:
   - Keep `.omagy/artifacts/loft/<slug>/contract.md` and `.omagy/artifacts/loft/<slug>/arena-verdict.md` intact.
   - If variants used linked `Workspace: "share"` worktrees or `loft/<slug>-*` branches, archive compact diff stats or winning source excerpts into `.omagy/artifacts/loft/<slug>/` first, verify no unpreserved untracked user files exist, and clean up losing worktrees/branches so zero prototype commits leak onto active feature branches.
