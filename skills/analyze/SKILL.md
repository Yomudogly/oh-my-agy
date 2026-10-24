---
name: analyze
description: "[oh-my-agy] Read-only deep repository analysis returning a ranked synthesis with explicit confidence, concrete file references, and evidence-vs-inference boundaries. Use when the user says 'analyze', 'investigate', 'why does', 'what's causing', or needs a grounded cross-file explanation before any changes."
---

# Analyze — Read-Only Deep Analysis

Use `$analyze` to answer a repository question with grounded, read-only evidence. Explain what the code most likely says; do not turn analysis into implementation or generic fix planning.

Shared operating, delegation, state, and verification invariants live in the oh-my-agy rules (`rules/AGENTS.md`).

## Use when

- The user needs a causal, architectural, behavioral, impact, or tradeoff explanation.
- The answer requires tracing multiple files or boundaries, or ranking plausible explanations.
- The user needs confidence and concrete evidence before changing anything.

Do not use it for edits, implementation, a new product plan, a simple one-file lookup, or `$team` orchestration.

## Inputs and method

1. Restate the question and define the evidence-backed scope.
2. Identify the smallest files, tests, configs, and docs likely to answer it.
3. Read direct code paths and contracts first; trace boundaries only as far as needed.
4. Compare competing explanations across distinct frames (code path, config/env/orchestration, measurement/artifact mismatch), rank them by the **6-tier Evidence Strength Hierarchy**, and run a **Rebuttal Pass** against the leading explanation before synthesis.
5. For `--deep` or high-ambiguity multi-subsystem mysteries, dispatch up to 3 parallel `tracer` subagents via `invoke_subagent` (one per causal frame: Code-path, Config/env/orchestration, Measurement/artifact mismatch) and synthesize their findings after cross-rebuttal.
6. Stop when the question is answered with sufficient evidence, or name the smallest read-only probe that would resolve the remaining uncertainty.

## Evidence discipline

Label every material claim as one of:

- **Evidence** — directly shown by code, tests, generated artifacts, configuration, or docs.
- **Inference** — a reasoned conclusion drawn from cited evidence.
- **Unknown** — not settled by the repository evidence.

Rank evidence using the **6-tier Evidence Strength Hierarchy** (strongest to weakest):
1. **Tier 1**: Controlled reproduction, direct test/probe output, or source-of-truth artifact that uniquely discriminates between hypotheses.
2. **Tier 2**: Primary artifact with tight provenance (`file:line` behavior, timestamped logs, git history, config snapshot).
3. **Tier 3**: Multiple independent sources converging on the same mechanism.
4. **Tier 4**: Single-source code-path inference that fits the symptom but is not uniquely discriminating.
5. **Tier 5**: Weak circumstantial clues (naming, temporal proximity, stack order).
6. **Tier 6**: Intuition, analogy, or speculation.

Prefer direct paths and higher-tier corroboration over lower-tier clues. Never present guesses as evidence or inference, and never overclaim certainty.

## Output contract

Answer the asked question first and use this shape:

### Question
Restated question, briefly.

### Ranked synthesis
| Rank | Explanation | Confidence | Basis |
|------|-------------|------------|-------|
| 1 | ... | High / Medium / Low | strongest supporting evidence |
| 2 | ... | High / Medium / Low | why it trails |
| 3 | ... | High / Medium / Low | why it remains possible |

### Evidence
- `path/to/file:line-line` — direct observation.
- `path/to/file:line-line` — corroborating observation.

### Inference
- What the evidence most strongly implies.
- Why weaker alternatives were down-ranked.

### Intent-vs-Reality Diff (include when auditing docs, specs, or expected vs actual behavior; ported from OmO `ulw-research`)
| Surface / Claim | Expected / Documented (`source`) | Actual Code Behavior (`file:line`) | Drift Classification |
|-----------------|----------------------------------|------------------------------------|----------------------|
| ... | ... | ... | `Match` / `Undocumented` / `Broken` / `Stale` |

### Unknowns / limits
- What the repository does not establish.
- The next discriminating read-only probe, when useful.

## Stop conditions

- Do not edit files, run an implementation lane, or make recommendations the evidence cannot support.
- Do not continue searching after the answer and confidence boundary are grounded.
- If evidence is insufficient, report the limit explicitly rather than manufacturing certainty.
