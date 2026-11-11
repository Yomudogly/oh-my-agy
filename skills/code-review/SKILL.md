---
name: code-review
description: "[oh-my-agy] Merge-readiness code review through two independent subagent lanes (code-reviewer + architect) with a deterministic APPROVE / REQUEST CHANGES / COMMENT verdict. Use when the user asks for a code review or quality/security assessment, or before merging a change."
---

# Code Review Task Card

Use this explicit opt-in for a merge-readiness review. It is read-only and never promises auto-fix.

## When to use

- The user asks for a code review or quality/security assessment.
- A change is ready for review before merge, or a major feature needs independent review.
- Do not activate this card for implementation, broad planning, or automatic cleanup.

## Inputs

- Scope: the requested files, commit, PR, or whole diff.
- Requirements/spec, acceptance criteria, and relevant test/CI evidence.
- Existing review artifacts and known risks, if any.
- If the user says `continue`, advance the current review step rather than restarting.

Record the scope first (prefer generating a file-based review package so diffs never bloat the leader context window):
```sh
sh <plugin>/hooks/run.sh review-package <workspace> <base_sha> <head_sha> .omagy/artifacts/reviews/review-<base7>..<head7>.diff
```
(`review-package` validates `git merge-base --is-ancestor` and commit count `> 0`, exiting with code `3` on an empty or wrong-branch range, and writes commit log, `--stat`, and `git diff -U10` to the file. For uncommitted working-tree reviews, use `git status --short` and `git diff --stat`.)

## Execution

1. Identify changed files and review boundaries. Do not silently widen the scope.
   - **Anti-Pre-Judging Guard**: never poison reviewer prompts with instructions to ignore or down-rate specific areas (`"do not flag X"`, `"at most LOW"`). Let the reviewer grade findings independently.
   - **Scoped Fix Re-Review (`--re-review <fix_base_sha>`)**: on fix-round re-reviews after a `REQUEST CHANGES` verdict, generate a review package for `<fix_base_sha>..HEAD` and pass the prior findings list. Reviewers verify only whether prior findings were resolved and whether `<fix_base_sha>..HEAD` introduced new defects, quarantining untouched-code observations under `Out-of-Scope Observations`.
   - **Whole-Repo / Folder Quality & Lean Audit (`--audit [path]`)**: when invoked with `--audit [path]`, map entry points, data flow, expected load (`single-user script` vs `concurrent service`), and existing `shortcut:` debt (`sh <plugin>/hooks/run.sh scan-debt <workspace>`) first, then audit the target scope ranked by importance (`Must fix` -> `Should fix` -> `Nice to have`, capped at 20 findings), reporting 4-part finding cards (`What this is`, `Problem`, `Fix`, `If we skip it`) and `Lean: -<N> lines, -<M> dependencies possible`.
   - **Security & Threat-Model Review (`--security [path]`)**: when invoked with `--security` (or on auth, crypto, secret, untrusted-input, MCP/tool, or LLM prompt boundaries), run `sh <plugin>/hooks/run.sh lookout <paths> --json` first to flag un-negated destructive or hazardous commands, and dispatch `security-reviewer` in parallel alongside `code-reviewer` and `architect` for structured **STRIDE** threat modeling plus **OWASP Top 10** and **OWASP LLM01–LLM10** (prompt injection, insecure output handling, excessive agency, credential leakage) review.
   - **Production Ship-Readiness Gate (`--ship`)**: when invoked with `--ship` for release/merge gating, load [ship-readiness.md](./references/ship-readiness.md) and verify: (a) [structured `requestId` + `entryPoint` logs, RED/USE metrics, and high-cardinality label guards](./references/ship-readiness.md#1-structured-observability-requestid-entrypoint-reduse-metrics-and-cardinality-guard), (b) [2-tier symptom alerts + 3-line actionable runbooks](./references/ship-readiness.md#2-two-tier-symptom-alerts-and-three-line-actionable-runbooks), (c) [quantitative canary Advance / Hold / Rollback thresholds, Error Budget Release Gate (`>20%` / `0–20%` / `0%` freeze), and RTO-bound rollback plan](./references/ship-readiness.md#3-progressive-delivery-quantitative-canary-thresholds-error-budget-gate-and-rto-rollback), and (d) [pre-ship `quality-gate`, `floor-guard`, and `git diff --staged --name-only` secret checks](./references/ship-readiness.md#4-pre-ship-automated-gates-quality-gate-floor-guard-and-staged-secret-check). Any failing `floor-guard`/`quality-gate` check, staged secret, missing RTO rollback on a one-way change, or non-P0 feature rollout under `0%` error budget forces **REQUEST CHANGES**.
2. Launch both lanes **in parallel**, in one `invoke_subagent` call with two entries, each on a clean context with explicit scope and artifacts. Respect the user's model selection (`Model: "inherit"`).
   - `TypeName: "code-reviewer"`, prompt:
     ```text
     CODE REVIEW TASK (Two-Axis: Spec Compliance & Project Standards)
     Review the supplied scope on two axes:
     1) Spec Axis: acceptance criteria, edge cases, and behavioral correctness.
        - Spec silence is not permission: grade unhandled inputs by their effect on a reasonable user, not LOW merely because the spec omitted the trigger.
        - Flag any defect mandated by the plan itself as HIGH (plan-mandated).
     2) Standards Axis: AGENTS.md, DESIGN.md, omagy_wiki/ conventions, security, quality, performance, and maintainability.
        - Grep repo callers whenever a signature, return value, export, or behavior changes; reserve "Cannot Verify from Diff" for external/dynamic boundaries only.
        - State assumed load; treat `shortcut: <ceiling>, <upgrade>` comments as documented decisions unless expected load crosses the ceiling.
        - Every finding requires a concrete input/scenario case and 4 fields (What this is, Problem, Fix, If we skip it), plus `Lean: -<N> lines possible` when bloat exists.
        - **Executed-Repro Interrogation (`interrogate`)**: whenever feasible in a read-only/sandboxed check, test candidate findings with a minimal repro command or caller trace before reporting, and report the `Survived / Dropped findings: <survived>/<total>` count so speculative false positives are filtered out before the final report.
     Return files reviewed, severity-rated findings with file:line evidence and concrete fixes,
     and a recommendation: APPROVE / REQUEST CHANGES / COMMENT. Do not review architecture.
     Scope: <review-package file path or diff command, spec/acceptance paths>
     ```
   - `TypeName: "architect"`, prompt:
     ```text
     ARCHITECTURE / DEVIL'S-ADVOCATE REVIEW TASK
     Review the same scope for boundaries, interfaces, hidden coupling, long-term tradeoffs,
     the Demolition Test ("if we deleted this boundary and inlined callers, would the code get simpler or harder?"),
     the ADR Test (hard to reverse? surprising without context? real trade-off?),
     and the strongest counterargument against approval. Return file:line evidence,
     recommendations, and Architectural Status: CLEAR / WATCH / BLOCK.
     Scope: <same>
     ```
   - For security-sensitive scopes (auth, crypto, input handling, secrets), add a third `security-reviewer` lane.
   - **Configurable Custom Quality Gates (`qualityGates["code-review"]`)**: if `.omagy/config.json` defines `qualityGates["code-review"]` (strict no-op when absent/empty; reserved controller skills like `code-review`, `ralplan`, `deep-interview`, `ai-slop-cleaner` are rejected to prevent self-recursion), launch each configured gate skill in its own independent subagent (`Model: gate.model || "inherit"`).
3. If a role agent is unavailable, use the `self` subagent with the role's `agents/<role>.md` body as a preamble. If a lane still cannot run or returns no evidence, report `independent review unavailable`. Do **not** substitute the current/authoring lane, and do **not** approve.

## Review taxonomy

- `code-reviewer` checks **Security**, **Code Quality**, **Performance**, **Best Practices**, and **Maintainability**.
- Severities: **CRITICAL** (security or data-loss blocker), **HIGH** (bug/major smell), **MEDIUM** (important improvement), **LOW** (style/suggestion).
- `architect` checks boundaries/interfaces, hidden coupling, long-horizon tradeoffs, and devil's-advocate concerns. Status: **CLEAR**, **WATCH** (non-blocking concern), or **BLOCK** (merge blocker).
- Every finding names `file:line`, the issue, the risk, and a concrete fix, and separates facts from suggestions.

## State contract

- Standalone: no state file is needed.
- Inside Autopilot: set `current_phase:"code-review"` in `autopilot-state.json`. On a clean review, store the report path under `handoff_artifacts.code_review` before moving on. On a non-clean review, persist the findings and return to Ultragoal rework (implementation issues) or `ralplan` (design issues).
- Save the report to `.omagy/artifacts/code-review-<slug>-<timestamp>.md` when running inside a workflow.

## Final synthesis and gate

- Architect **BLOCK** -> **REQUEST CHANGES**.
- Else `security-reviewer` **CRITICAL** / **HIGH** finding or `lookout` hazard (`exitCode: 1` under `--security`) -> **REQUEST CHANGES**.
- Else code-reviewer **REQUEST CHANGES** -> **REQUEST CHANGES**.
- Else any configured `blocking` custom quality gate returning **REQUEST CHANGES** / **REJECT** / **BLOCK** -> **REQUEST CHANGES** (configured `advisory` gates record findings without blocking).
- Else architect **WATCH** -> **COMMENT**.
- Else follow the code-reviewer recommendation.

**APPROVE** only when code-reviewer returns APPROVE, the architect status is CLEAR, and both lanes returned evidence. **REQUEST CHANGES** for any blocker, unresolved HIGH/CRITICAL finding, or unavailable lane. **COMMENT** records non-blocking findings.

## Output contract

```text
CODE REVIEW REPORT
Files Reviewed: <count>
Total Issues: <n>
Architectural Status: CLEAR | WATCH | BLOCK
CRITICAL (n) | HIGH (n) | MEDIUM (n) | LOW (n)
Findings: file:line -> issue, risk, concrete fix (or none)
ARCHITECTURE WATCHLIST: concern, status, recommendation (or none)
- code-reviewer recommendation: <...>
- architect status: <...>
- final recommendation: <...>
RECOMMENDATION: <APPROVE | REQUEST CHANGES | COMMENT>
```

Fill in observed values, include scope, lane evidence references, unresolved risks, and validation gaps, and surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` when `.omagy/artifacts/code-review-<slug>-<timestamp>.md` is written.

## Receiving review feedback (`receiving-code-review` discipline)

When acting on review feedback from a human partner, GitHub PR reviewer, or `$code-review` lane:
1. **No Performative Agreement**: never reply with `"You're absolutely right!"`, `"Great point!"`, or `"Thanks for catching that!"`. State the technical verification or fix directly.
2. **Halt on Partially Ambiguous Batches**: if asked to fix items `1-6` and items `4,5` are unclear or conflict with the spec, clarify `4,5` before implementing the batch rather than guessing on half the list.
3. **Verify External Suggestions Against the Codebase (YAGNI Check)**: before implementing an external reviewer's suggestion, `grep` callers and build targets to confirm the code path is live and the problem is real. Push back with concrete `file:line` evidence when a suggestion violates YAGNI or breaks an existing contract.
4. **Inline PR Thread Replies**: when resolving GitHub PR review comments via `gh api`, reply directly to the comment thread (`repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`) rather than posting a disconnected top-level PR comment.

## Exit condition

Stop when the scoped diff has two independent lane results and a deterministic final recommendation. Never claim merge-ready without the required evidence.
