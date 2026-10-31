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

Record the scope first:
```sh
git status --short
git diff --stat
git diff -- <scope>
```

## Execution

1. Identify changed files and review boundaries. Do not silently widen the scope.
2. Launch both lanes **in parallel**, in one `invoke_subagent` call with two entries, each on a clean context with explicit scope and artifacts. Respect the user's model selection (`Model: "inherit"`).
   - `TypeName: "code-reviewer"`, prompt:
     ```text
     CODE REVIEW TASK (Two-Axis: Spec Compliance & Project Standards)
     Review the supplied scope on two axes:
     1) Spec Axis: acceptance criteria, edge cases, and behavioral correctness.
     2) Standards Axis: AGENTS.md, DESIGN.md, omagy_wiki/ conventions, security, quality, performance, and maintainability.
     Return files reviewed, severity-rated findings with file:line evidence and concrete fixes,
     and a recommendation: APPROVE / REQUEST CHANGES / COMMENT. Do not review architecture.
     Scope: <scope, diff command, spec/acceptance paths>
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
   - **Configurable Custom Quality Gates (`qualityGates["code-review"]`, ported from OMX `v0.21.41` `#3956` & OMC `v5.7.22` `#4670`/`#4671`)**: if `.omagy/config.json` defines `qualityGates["code-review"]` (strict no-op when absent/empty; reserved controller skills like `code-review`, `ralplan`, `deep-interview`, `ai-slop-cleaner` are rejected to prevent self-recursion), launch each configured gate skill in its own independent subagent (`Model: gate.model || "inherit"`).
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

Fill in observed values, and include scope, lane evidence references, unresolved risks, and validation gaps.

## Exit condition

Stop when the scoped diff has two independent lane results and a deterministic final recommendation. Never claim merge-ready without the required evidence.
