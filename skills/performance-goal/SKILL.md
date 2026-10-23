---
name: performance-goal
description: "[oh-my-agy] Evaluator-gated performance optimization loop with durable artifacts: define an evaluator command and pass/fail contract first, then optimize in small reversible patches with recorded checkpoints until the evaluator passes. Use when the user wants measurable speed, latency, throughput, memory, or benchmark improvement as a goal-oriented loop."
---

# Performance Goal Workflow

Use this skill when the user asks to optimize performance and wants a goal-oriented loop rather than a one-off review.

## Contract

- Durable workflow state lives under `.omagy/goals/performance/<slug>/` (`state.json`, `checkpoints.jsonl`).
- No optimization work starts until an **evaluator command** and a **pass/fail contract** exist.
- Completion requires a passing evaluator checkpoint plus a completion audit. Passing ordinary tests alone is not enough unless they are the declared evaluator.
- Codex's hidden goal tools do not exist in Antigravity. The artifacts are the source of truth.

## Create

If no workflow exists, establish (asking with `ask_question` only for values the repo cannot answer):
- objective (e.g. "Reduce CLI startup latency by 20%")
- evaluator command (e.g. `npm run perf:startup`)
- evaluator contract (e.g. "PASS when p95 latency improves by >= 20% vs baseline and regression tests pass")
- slug

Write `.omagy/goals/performance/<slug>/state.json`:
```json
{"slug":"startup-latency","objective":"...","evaluator_command":"...","evaluator_contract":"...",
 "baseline":null,"lastValidation":null,"status":"active","created_at":"<ISO>","updated_at":"<ISO>"}
```
Also write `.omagy/state/performance-goal-state.json` (`mode:"performance-goal"`, `active:true`, `current_phase:"baseline"`, `state.slug`). The Stop hook uses it to keep the loop going.

## Agent loop

1. **Baseline**: run the evaluator (several runs if the metric is noisy) and record `baseline` with the raw numbers.
2. **Optimize** in small, reversible patches, one hypothesis per patch. Use the `debugger` or `architect` subagent for profiling analysis when useful.
3. **Evaluate**: run the evaluator and related regression tests after each patch.
4. **Checkpoint** every result by appending to `checkpoints.jsonl`:
   `{"at":"<ISO>","status":"pass|fail|blocked","evidence":"<numbers, command, exit code>","patch":"<summary>"}`
   Then update `lastValidation` in `state.json` and `updated_at`/`iteration` in the mode state. Revert patches that regress or do not help.
5. **Complete** only when `lastValidation.status == "pass"` and the audit confirms no required work remains. Set `state.json` `status:"complete"` and write the mode state terminal (`active:false`, `current_phase:"complete"`, `completed_at`).
6. **Blocked** (e.g. a missing fixture or benchmark infra): checkpoint `blocked`, set the mode state to `current_phase:"blocked"`, `active:false`, and ask the user.

## Completion gate

A performance goal is incomplete unless `state.json` holds `lastValidation.status: "pass"` produced by the declared evaluator command, with the evidence recorded in `checkpoints.jsonl`. Report baseline vs final numbers, the patches kept, the patches reverted, and the residual risks.
