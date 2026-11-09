---
name: deep-research
description: "[oh-my-agy] Multidisciplinary deep research and systems analysis across technical, business, idea, and implementation lenses. Executes terminological scoping, Boolean query matrices, Tier A-E source ranking with claim-kind tags, dialectical contradiction resolution, and a 5-dimension 100-point self-audit producing reports in .omagy/artifacts/research/. Use for $deep-research, 'deep research', technical/architecture deep dives, market/business landscape analyses, product/idea validation, or pre-implementation research."
---

# Deep Research & Multi-Lens Systems Analysis

Conduct institutional- and engineering-grade deep research across **technical**, **business**, **idea**, and **implementation** lenses. Rather than returning surface-level summaries, `$deep-research` maps first-principles mechanisms, causal feedback loops, empirical contradictions, and concrete builder/stakeholder action matrices, audited against a 5-dimension $\ge 85/100$ quality rubric.

## Boundary with Other Research Skills

- **`$best-practice-research`**: Fast, single-question official-documentation or version-aware lookup for an already-chosen technology.
- **`$autoresearch`**: Stateful, validator-gated loop that iterates until a shell command (`mission-validator-script`) or `architect` prompt review passes.
- **`$deep-research` (this skill)**: Comprehensive, multi-angle investigation producing a durable, audited report at `.omagy/artifacts/research/deep-research-<slug>-<UTC>.md` with a handoff to `$deep-interview`, `$ralplan`, or `$ultragoal`.

---

## Usage & Lenses

```text
$deep-research "<topic or question>"
$deep-research --technical "<architecture, algorithm, protocol, or scaling topic>"
$deep-research --business "<market, ICP, unit economics, pricing, or moat topic>"
$deep-research --idea "<product thesis, problem validation, wedge, or contrarian idea>"
$deep-research --implementation "<codebase integration, SDK comparison, migration, or rollout>"
```

### The 4 Research Lenses
If no lens flag is provided, classify the primary lens (or combine multiple lenses) based on the user's prompt:

| Lens | Flag | Primary Focus | Default Subagent Dispatch |
|---|---|---|---|
| **Technical** | `--technical` | System architecture tradeoffs, algorithmic complexity, latency/throughput limits, failure modes, security boundaries, and standards/RFCs. | `researcher` + `architect` (+ `explore` if brownfield) |
| **Business** | `--business` | Market landscape (TAM/SAM/SOM), ICP & acute pain points, competitive matrix & moats, unit economics/pricing, GTM distribution, and regulatory risk. | `researcher` + `analyst` |
| **Idea / Product** | `--idea` | First-principles problem validation, jobs-to-be-done, contrarian insights, minimum viable wedge, why-now catalysts, and explicit kill/falsification criteria. | `analyst` + `researcher` |
| **Implementation** | `--implementation` | Repo integration touchpoints (`file:line`), SDK/package maintenance & license comparison, API version constraints, migration/rollout sequence, and test strategy. | `explore` + `dependency-expert` + `researcher` |

Read [lenses-and-rubric.md](./references/lenses-and-rubric.md) for the full per-lens investigation checklists, Boolean operator patterns, Tier A–E source hierarchy, and 0–100 scoring rubric.

---

## Operating Principles

1. **Objectivity & Dialectical Rigor**: Actively seek disconfirming evidence, competing hypotheses, postmortems, and failure modes. Never advocate one-sidedly for a default narrative.
2. **First-Principles Depth**: Trace proximate symptoms to root mechanistic, economic, or architectural drivers.
3. **Systemicity**: Model the domain as an interconnected system of reinforcing loops (amplifiers) and balancing loops (bottlenecks/constraints).
4. **Claim-Kind, "Data Came First" & Source Fidelity**:
   - **Data Came First**: model training memory is only a `LEAD`, never a source. Every factual or quantitative claim returned by a research worker must cite `OBSERVED: <URL | file:line | command output>` retrieved during the run, and worker replies end with `## EXPAND` listing `LEAD: <next concrete source>` or `DEAD END: <query/URL> — PROBED: <why it failed>`.
   - Tag material claims explicitly as **`[VERIFIED]`** (proven by local command/code inspection or primary Tier A/B upstream source), **`[DERIVED]`** (calculated from cited figures with the formula shown), or **`[ASSUMED]`** (explicit working hypothesis).
   - Preserve source scope, hedges, and exact numbers: never widen scope (`scope_widened`), drop qualifiers (`hedge_dropped`), invent causal links (`causality_added`), or glue footnote/superscript digits onto figures (`conversion_altered_number`, e.g., `42¹` or `100[1]` without spacing, checked automatically by `audit-research`).
5. **Inline HTML Chart & Data-Visualization Integrity**: when embedding visual charts or HTML comparison tables, compute aggregates at the data source, bucket dates by the reader's local midnight, hatch partial time-window bars so incomplete periods never masquerade as drops, cross-check headline KPI totals against a second source, and prefer HTML/CSS flex/grid bars over stretched `preserveAspectRatio="none"` SVGs.
6. **Actionable Output**: Every report concludes with a concrete **Builder & Stakeholder Action Matrix** and a **Next-Workflow Handoff** (`$deep-interview`, `$ralplan`, or `$ultragoal`).

---

## 5-Phase Research Workflow

```text
PHASE 1: Intake, Lens Classification & Terminological Apparatus
   |
PHASE 2: Boolean Query Matrix, Parallel Subagent Harvest & Tier A-E Ranking
   |
PHASE 3: Dialectical Contradiction Resolution & Causal Loop Modeling
   |
PHASE 4: Multidimensional Synthesis & Report Drafting (.omagy/artifacts/research/)
   |
PHASE 5: 5-Dimension Self-Assessment (>=85) & Automated Audit (audit-research)
```

### Phase 1: Intake, Lens Classification & Terminological Apparatus
1. **Scope & Lens Selection**: Identify the core thesis/question, select the active lens(es) (`technical`, `business`, `idea`, `implementation`), and define temporal/version anchors (`as of`).
2. **Brownfield Grounding (when workspace code is relevant)**: Inspect local architecture, `package.json`, configs, or `omagy_wiki/` first (directly or via `explore`) so research is anchored to real repo constraints.
3. **Terminological Apparatus**: Define 8–15 core domain concepts, separating canonical definitions from competing vendor/disciplinary interpretations.

### Phase 2: Query Matrix Generation & Parallel Source Harvest
1. **Generate the Boolean Search Matrix**: Run the dependency-free Node helper via `hooks/run.sh`:
   ```bash
   sh <PLUGIN_DIR>/hooks/run.sh research-matrix "<topic>" <technical|business|idea|implementation|general>
   ```
2. **Parallel Subagent Dispatch**: For multi-faceted topics, launch bounded parallel subagents (`invoke_subagent`, max 3–4 concurrent lanes) matching the lens table above (`explore` for repo facts, `researcher` for upstream/external evidence, `dependency-expert` for package/SDK comparison, `analyst` for product/market stress-testing).
3. **Tier-Rank All Sources (Tier A–E)**:
   - **Tier A (Gold Standard)**: Official specifications/RFCs, reproducible benchmarks, peer-reviewed systematic reviews, primary regulatory/financial filings, verified repo code/test outputs.
   - **Tier B (High Priority)**: Maintainer documentation, official release notes/changelogs, engineering postmortems, specialized peer-reviewed studies.
   - **Tier C (Contextual)**: Industry analyst reports, preprints (`arXiv`), architectural case studies.
   - **Tier D/E (Leads Only)**: Practitioner blog posts, Hacker News/forum threads, vendor marketing copy (never use Tier D/E as sole proof for a `[VERIFIED]` claim).

### Phase 3: Critical Analysis, Dialectics & System Dynamics
1. **Causal Loop & Bottleneck Mapping**: Identify reinforcing feedback loops and balancing constraints (scaling limits, unit-cost cliffs, organizational friction).
2. **Contradiction Arbitration**: When sources or benchmarks conflict, do not average them away. Compare workload parameters, hardware/version baselines, sample sizes, and incentives to specify the exact boundary conditions under which Option A beats Option B.
3. **Evaluation Integrity Audit (`eval-integrity`)**: When evaluating empirical studies, benchmarks, or model evaluations, map the **7 evaluation roles** (`Claim`, `System under test`, `Dataset and split`, `Designer`, `Evaluator or judge`, `Scorer`, `Subjects`), verify an independent ground-truth signal, probe the **8 independence failure modes** (`Contamination`, `Invalid controls`, `Circular judging`, `Scorer-label coupling`, `Evaluator-designer coupling`, `Split/annotator dependence`, `Hypothesis priming`, `Observer/demand effects`), and include a single `**Verdict: PASS | FAIL | INCONCLUSIVE**` line in the report so the HUD `Overview` tab can surface the evaluation integrity badge.

### Phase 4: Multidimensional Synthesis & Report Drafting
Write the report to `.omagy/artifacts/research/deep-research-<slug>-<UTC>.md` (and optionally copy or link `.omagy/artifacts/research/deep-research-latest.md`) following [report-template.md](./references/report-template.md):

1. **Executive Summary** (250–500 words): Core thesis, key `[VERIFIED]` / `[DERIVED]` findings, primary tradeoffs, and recommended path.
2. **Introduction, Context & Scope**: Problem definition, boundary conditions, historical/version trajectory, and why-now significance.
3. **Research Methodology & Source Tiers**: Active lens(es), query strategy, Tier A–E source breakdown, and bias/contradiction controls.
4. **Multidimensional Lens Analysis**: Deep dive across the selected lens(es) (`Technical`, `Business`, `Idea / Product`, `Implementation`) plus cross-lens interactions and paradox resolution.
5. **Interpretation, Synthesis & Systemic Modeling**: Unified mental model and at least one Mermaid diagram (causal loop, dialectical synthesis, or architecture topology from [report-template.md](./references/report-template.md)).
6. **Uncertainty, Risks, Gaps & Falsification Criteria**: Epistemic blind spots, threat/failure modes, and concrete falsification tests that would invalidate the recommendation.
7. **Conclusions & Action Matrix**: Prioritized action items tailored to the builder/team and decision-makers, plus explicit handoff guidance (`$deep-interview`, `$ralplan`, or `$ultragoal`).
8. **Glossary of Core Concepts**: Canonical vs. competing definitions.
9. **Research Self-Assessment Scorecard**: Mandatory 5-dimension table (`0–100` scale).

### Phase 5: Reflexive Self-Assessment ($\ge 85$) & Automated Audit
1. Score the completed report across all 5 rubric dimensions defined in [lenses-and-rubric.md](./references/lenses-and-rubric.md):
   - **1. Depth of Analysis** (Target $\ge 85$)
   - **2. Systemicity** (Target $\ge 85$)
   - **3. Critical Thinking** (Target $\ge 85$)
   - **4. Interdisciplinarity / Lens Rigor** (Target $\ge 85$)
   - **5. Practical Applicability** (Target $\ge 85$)
2. Run the deterministic Node audit command:
   ```bash
   sh <PLUGIN_DIR>/hooks/run.sh audit-research .omagy/artifacts/research/deep-research-<slug>-<UTC>.md
   ```
3. If `audit-research` exits non-zero or any dimension scores `< 85`, apply the targeted remediation steps in [lenses-and-rubric.md](./references/lenses-and-rubric.md) and re-run `audit-research` until it passes (`PASS`).
4. Surface the report path, executive summary, scorecard, `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` pill, and the recommended next workflow (`$ralplan` for consensus planning or `$ultragoal` for durable execution).

---

## Stop Rules

- This skill is read-only with respect to application source code: it writes only research artifacts under `.omagy/artifacts/research/`.
- Do not report completion until `sh <PLUGIN_DIR>/hooks/run.sh audit-research <reportPath>` returns `PASS` with all 5 dimensions $\ge 85$.
