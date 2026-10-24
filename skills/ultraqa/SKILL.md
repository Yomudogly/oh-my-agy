---
name: ultraqa
description: "[oh-my-agy] Adversarial dynamic end-to-end QA: build a hostile scenario matrix, run baseline + adversarial scenarios, diagnose, fix, clean up, and report, in up to 5 bounded cycles. Use for $ultraqa (--tests, --build, --lint, --typecheck, --interactive, --custom \"pattern\") when runnable behavior needs more than a shallow test checklist."
---

# UltraQA Task Card

Use this explicit opt-in when runnable behavior needs adversarial dynamic end-to-end QA. This card defines the QA matrix, evidence contract, and bounded cycling.

## When to use and inputs

- Goals: `--tests`, `--build`, `--lint`, `--typecheck`, `--interactive`, or `--custom "pattern"`. Without a structured goal, derive a runnable behavior goal.
- Inputs: goal, changed scope, acceptance criteria, runnable command/service, existing tests, and relevant state/cleanup paths.
- If the user says `continue`, advance the current verified QA step rather than restarting.
- A shallow build/lint/typecheck/test checklist does not satisfy UltraQA. Exercise the requested behavior through adversarial scenarios whenever it can be run, simulated, or harnessed safely.

## Plan and trigger-mapped scenario matrix

Before running commands, record a matrix (in `.omagy/artifacts/ultraqa-<slug>/matrix.md`) with: scenario id, class, trigger status (`triggered` or `not-applicable: <1-line reason>`), intent, user/attacker model, setup, command or harness, expected signal, actual result, `failure_class` (`none | product | harness`), fixes, evidence, and cleanup. Evaluate all **9 adversarial classes** against their concrete trigger conditions (ported from OmO `ulw-execute`):

| # | Adversarial Class | Trigger Condition (run when true; otherwise log 1-line `not-applicable`) | Probes |
|---|---|---|---|
| 1 | **Malformed input** | Code parses user, CLI, file, network, JSON, or env input | Invalid JSON, missing fields, bad flags, oversized strings, unusual Unicode, path traversal (`../`), corrupted state |
| 2 | **Prompt injection** | Code ingests untrusted text, prompts, transcripts, or external content | Instruction overrides, secret exfiltration strings, verification-skip payloads, fake completion claims |
| 3 | **Cancel / resume** | Workflow persists state, checkpoints, or supports stop/resume | Mid-run abort, resume from partial state, idempotent re-entry, `$cancel` cleanup |
| 4 | **Stale state** | Code reads cached state, lockfiles, timestamps, or session IDs | Expired timestamps (`> STALE_MS`), foreign `owner_conversation_id`, schema-version mismatch, contradictory phases |
| 5 | **Dirty worktree** | Code runs git commands, file generators, or cleanup steps | Pre-existing modified/untracked files outside scope remain untouched after run and rollback |
| 6 | **Hung or long-running commands** | Code spawns child processes, network calls, or loops | Bounded timeout, clean process termination (`manage_task kill`), no orphan processes |
| 7 | **Flaky tests** | Async timing, concurrency, temp files, or randomness in tests | Capped reruns (3x), shared-state isolation, deterministic ordering (a single lucky green does not count) |
| 8 | **Misleading success output** | CLI/hook/API returns status text or exit codes | Non-zero exit with `"PASS"` text, zero exit with `"ERROR"`/`test.skip`, partial output truncation |
| 9 | **Repeated interruptions** | Interactive loop, hook nudge, or retry state machine | Repeated `continue`, rapid duplicate invocations, retry budget exhaustion |

## Cycle (maximum 5)

1. **PLAN ADVERSARIAL QA**: goal, success criteria, safety bounds, stop condition, runnable surfaces, matrix.
2. **RUN BASELINE VERIFICATION**: `--tests` runs the project tests; `--build` runs the build plus built-artifact probes; `--lint`; `--typecheck` plus typed harnesses; `--custom` checks the pattern and exit status; `--interactive` uses a bounded CLI/service harness.
3. **RUN ADVERSARIAL SCENARIOS**: capture exit codes, output, artifacts, and cleanup. Use `run_command` with a bounded `WaitMsBeforeAsync` for long runs, and `manage_task kill` for hung processes.
4. **CHECK RESULT**: pass only when baseline, adversarial scenarios, evidence, and cleanup all pass. Otherwise diagnose and repeat.
5. **ARCHITECT DIAGNOSIS** (via the `architect` or `debugger` subagent for non-trivial failures): root cause and safety impact. **FIX ISSUES** precisely. **CLEAN UP AND ROLL BACK** temporary harnesses, fixtures, logs, processes, state, and failed experiments before the next cycle.

Generate temporary tests, scripts, fixtures, or harnesses only when useful. Keep them under `.omagy/artifacts/ultraqa-<slug>/` or the project's test directories. Use bounded runtimes and project-native tools. Write harness files with `write_to_file` (not interpolating heredocs). Use absolute repo paths in harness imports. Classify harness setup failures as harness debris: fix the harness and rerun before declaring a product defect.

## Safety, state, and exit

No destructive commands, secret exfiltration, credential dumping, production writes, or unbounded process spawning. No unbounded waits. Preserve unrelated dirty work. If a scenario is unsafe, record it as blocked along with the safe substitute. Three repeats of the same failure stop with a diagnosis. Cycle 5 stops with residual risks. Success exits after a passing cycle.

State: standalone writes `.omagy/state/ultraqa-state.json`; inside Autopilot, use `state.ultraqa` and `current_phase:"ultraqa"`. Phases: `planning -> baseline -> adversarial-e2e -> diagnose -> fix -> cleanup -> complete`. Update `iteration`, `current_phase`, and `updated_at` as you go (the Stop hook keeps an active run going). Terminal: `active:false`, `current_phase:"complete"|"failed"|"blocked"`, `completed_at`.

## Evidence/output contract

Return `# UltraQA Report` with: **Goal and success criteria** (stop condition, safety bounds); **Scenario matrix** (all columns); **Commands run** (exit code, purpose, timeout, key output); **Failures found** (root cause, user/safety impact); **Fixes applied** (files, rationale, scenarios, regression evidence); **Cleanup and rollback** (artifacts/processes/worktree before and after); **Residual risks**; **Evidence** (logs, harness output, screenshots where relevant, rerun/flake evidence).

## Exit condition

`ULTRAQA COMPLETE: Goal met after N cycles` only after a passing baseline plus adversarial matrix, clean artifacts, and complete evidence. Otherwise return the exact bounded status: `ULTRAQA STOPPED: Max cycles`, `ULTRAQA STOPPED: Same failure detected 3 times`, `ULTRAQA BLOCKED: ...`, or `ULTRAQA ERROR: ...`, with the owner and next safe step.
