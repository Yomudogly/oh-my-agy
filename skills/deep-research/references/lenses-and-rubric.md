# Deep Research Lenses, Source Hierarchy & 100-Point Evaluation Rubric

Reference guide for [`skills/deep-research/SKILL.md`](../SKILL.md). Read this file during Phase 1–3 (lens scoping, Boolean query formulation, and source ranking) and Phase 5 (scoring and remediation).

---

## 1. Lens-Specific Investigation Matrices

### A. Technical Lens (`--technical`)
Use when investigating system architectures, distributed protocols, algorithms, compilers/runtimes, AI/ML models, or performance/security bottlenecks.
- **Mechanistic Foundations**: What are the underlying data structures, complexity bounds (time/space/I/O), and hardware/network constraints?
- **Tradeoff Triangle**: What does this design sacrifice (e.g., read vs. write amplification, consistency vs. tail latency, memory vs. CPU)?
- **Benchmark Scrutiny**: Under what payload sizes, concurrency levels, and hardware profiles were claims measured? Distinguish p50 vs. p99/p99.9.
- **Failure Modes & Blast Radius**: How does the system degrade under partial network partition, clock skew, OOM, corrupted state, or adversarial input?

### B. Business Lens (`--business`)
Use when evaluating market opportunities, competitive landscapes, monetization models, build-vs-buy economics, or strategic positioning.
- **Market Structure & Timing**: TAM/SAM/SOM grounded in bottom-up unit counts (`[DERIVED]`), secular tailwinds, and regulatory shifts.
- **ICP & Acute Pain**: Who experiences the pain most acutely, what is their current workaround cost (time/money/risk), and who holds budget authority?
- **Competitive Matrix & Moats**: Direct competitors, incumbent bundling threats, open-source alternatives, switching costs, network effects, and data flywheels.
- **Unit Economics & GTM**: COGS/inference/infra floor, gross margin trajectory, CAC payback drivers, pricing metric alignment, and distribution channels.

### C. Idea / Product Lens (`--idea`)
Use when validating a new product concept, feature thesis, startup idea, or workflow redesign before committing engineering cycles.
- **First-Principles Problem Validation**: Is this a vitamin or a painkiller? What job-to-be-done (`JTBD`) is the user hiring this product for?
- **Contrarian / Non-Obvious Insight**: What do incumbents or conventional wisdom get wrong about this problem? Why have prior attempts failed, and what changed (`why now`)?
- **Minimum Viable Wedge**: What is the smallest high-leverage workflow slice that delivers immediate value without requiring ecosystem-wide adoption?
- **Falsification & Kill Criteria**: What specific user behavior, conversion metric, or technical threshold would prove this idea wrong within 2–4 weeks?

### D. Implementation Lens (`--implementation`)
Use when translating a concept or requirement into a concrete codebase integration, dependency selection, or migration blueprint.
- **Brownfield Touchpoint Map**: Exact files, modules, schemas, and interfaces in the current repository (`[from-code]`, `file:line`).
- **Package / SDK Evaluation**: Maintenance velocity, transitive dependency footprint, bundle/binary size, license compatibility, and TypeScript/type safety (via `dependency-expert`).
- **API & Version Fidelity**: Current upstream API signatures, deprecations, rate limits, and edge-runtime/OS compatibility (via `researcher`).
- **Rollout, Migration & Verification Plan**: Feature-flagging, backward compatibility, rollback path, and unit/integration/e2e test locks.

---

## 2. Source Credibility Hierarchy (Tier A–E) & Claim Tags

Never treat promotional blog posts or unverified forum claims with the same weight as primary specifications, reproducible benchmarks, or verified code.

| Tier | Priority | Qualifying Sources | Allowed Claim Tag |
|---|---|---|---|
| **Tier A** | Gold Standard | Official RFCs/specs (IETF, W3C, ECMA), primary upstream source code, reproducible benchmarks, local command/test outputs, peer-reviewed meta-analyses, audited 10-K/regulatory filings. | `[VERIFIED]` |
| **Tier B** | High Priority | Official maintainer documentation, release notes/changelogs, verified engineering postmortems, specialized peer-reviewed papers, primary datasets. | `[VERIFIED]` |
| **Tier C** | Contextual | Industry analyst reports (Gartner, Forrester), technical whitepapers, preprints (`arXiv`), architectural case studies with disclosed methodology. | `[VERIFIED]` (with source caveat) or `[DERIVED]` |
| **Tier D/E** | Leads Only | Single-author blogs, trade press, social/HN threads, vendor marketing pages. Use only to surface hypotheses for Tier A/B verification. | `[ASSUMED]` (until verified) |

### Claim-Kind Discipline & Worker Evidence Contract
- **Data Came First (`OBSERVED:`)**: training memory is a `LEAD`, never a source. Every factual claim from a research subagent must carry `OBSERVED: <URL | file:line | command output>`, and worker reports conclude with `## EXPAND` (`LEAD: <concrete follow-up>` or `DEAD END: <query/URL> — PROBED: <why empty/paywalled/refuted>`).
- **`[VERIFIED]`**: Directly established by a cited Tier A/B source or a command/code read executed during the run.
- **`[DERIVED]`**: Computed from cited inputs with the explicit formula shown (e.g., `10k req/s * 4 KB = 40 MB/s [DERIVED]`).
- **`[ASSUMED]`**: Explicit working assumption or unverified hypothesis that requires validation.
- **No `conversion_altered_number`**: never glue superscript or bracketed footnote markers directly onto numeric figures (e.g., `42¹` or `100[1]`); separate citations from numbers (`42 [1]`) so PDF/HTML copy-paste never corrupts values (`audit-research` flags glued footnote digits outside code blocks).
- **Chart Data Integrity**: compute chart aggregates at the source, align date buckets to local midnight, visually hatch partial-period bars, cross-check totals against a second source, and use HTML/CSS bars with component-prefixed classes (`kpi-label`, `bar-seg`) instead of distorted `preserveAspectRatio="none"` SVGs.

---

## 3. Contradiction Resolution Protocol

When reputable sources or benchmarks disagree:
1. **Isolate Workload & Environment Variables**: Compare dataset scale, hardware generation, configuration tuning, and version numbers.
2. **Audit Methodology & Incentives**: Check whether a benchmark was published by a vendor testing its own tuned system against an untuned competitor (`benchmark marketing`).
3. **Define Parameter Boundaries**: Formulate a synthesis rule: *"Under condition $X$ (e.g., $< 10\text{M}$ vectors, single-node RAM), Approach A dominates; beyond threshold $Y$ (multi-tenant disk-backed), Approach B dominates."*

---

## 4. The 5-Dimension Self-Assessment Rubric (0–100 Scale, Target $\ge 85$)

Every `$deep-research` report must conclude with the 5-dimension scorecard and pass `sh <PLUGIN_DIR>/hooks/run.sh audit-research <reportPath>`.

### Dimension 1: Depth of Analysis ($\ge 85$)
- **90–100**: Penetrates beyond consensus into first-principles mechanics, algorithmic/economic root drivers, and second-order consequences.
- **85–89**: Strong mechanistic and contextual depth with minor gaps in edge-case quantification.
- **< 85 (Fails Gate)**: Primarily summarizes surface documentation or conventional wisdom without dissecting root causes.
- **Remediation**: Drill down one sub-system level ("Why does this bottleneck or market dynamic exist physically/economically?") and add 2+ Tier A/B evidence points.

### Dimension 2: Systemicity ($\ge 85$)
- **90–100**: Explicitly models reinforcing loops, balancing constraints, latency/cost cliffs, and cross-component coupling with a clear Mermaid diagram.
- **85–89**: Maps key interdependencies and constraints clearly.
- **< 85 (Fails Gate)**: Linear list of isolated points with no feedback loop or bottleneck analysis.
- **Remediation**: Add a causal loop or architecture interaction diagram identifying at least one reinforcing loop and one balancing constraint.

### Dimension 3: Critical Thinking ($\ge 85$)
- **90–100**: Actively tests disconfirming evidence, resolves empirical contradictions with boundary conditions, and tags claims with `[VERIFIED]`, `[DERIVED]`, and `[ASSUMED]`.
- **85–89**: Evaluates competing options objectively with explicit caveats and claim tags.
- **< 85 (Fails Gate)**: One-sided advocacy, missing counter-arguments, or untagged quantitative claims.
- **Remediation**: Execute contradiction queries (`"limitations"`, `"postmortem"`, `"criticism"`), add a Thesis vs. Antithesis comparison table, and tag all material claims.

### Dimension 4: Interdisciplinarity / Lens Rigor ($\ge 85$)
- **90–100**: Bridges multiple lenses (e.g., connecting technical architecture limits to unit economics, developer ergonomics, or rollout risk) to surface insights invisible to a single silo.
- **85–89**: Thoroughly covers the requested lens while grounding adjacent operational/product constraints.
- **< 85 (Fails Gate)**: Narrowly siloed analysis that ignores obvious adjacent failure modes (e.g., a technically clever design that blows up COGS or breaks existing repo interfaces).
- **Remediation**: Cross-check the primary findings against at least one adjacent lens (Technical $\leftrightarrow$ Implementation or Business $\leftrightarrow$ Idea).

### Dimension 5: Practical Applicability ($\ge 85$)
- **90–100**: Delivers a concrete, prioritized **Action Matrix** with decision thresholds, falsification tests, file/component targets (when brownfield), and a ready-to-run handoff to `$ralplan` or `$ultragoal`.
- **85–89**: Clear, actionable recommendations with minor extrapolation needed.
- **< 85 (Fails Gate)**: Generic advice ("improve caching", "do user research") lacking concrete thresholds, options, or next steps.
- **Remediation**: Replace generic advice with concrete decision rules (`If X -> do Y`), concrete metrics, and explicit workflow handoff inputs.
