---
name: pr
description: "[oh-my-agy] Assemble a review-ready PR body from the .omagy/ paper trail: one-line summary with the smallest load-bearing visual, verification evidence (before/after), and ADR-tested reversibility. Use for $pr, 'draft a PR', or after $ultragoal / $code-review."
---

# PR Body Assembly (`$pr`)

Assemble a reviewer-ready Pull Request description directly from the repository diff and `.omagy/` paper trail (`.omagy/ultragoal/ledger.jsonl`, `.omagy/evidence/*.json`, `.omagy/artifacts/code-review-*.md`, `.omagy/plans/prd-*.md`). Never fabricate verification output that was not actually run.

## When to use

- The user invokes `$pr` or asks to draft/update a PR description.
- At the closeout of `$autopilot` or `$ultragoal` when preparing changes for review.

## Inputs & paper-trail lookup

1. Inspect git state: `git status --short`, `git diff --stat`, and branch commits against the base branch.
2. Read available `.omagy/` artifacts without re-running heavy suites unless evidence is missing or stale:
   - `.omagy/ultragoal/goals.json` and `.omagy/ultragoal/ledger.jsonl`
   - `.omagy/evidence/task-*.json`
   - `.omagy/artifacts/code-review-*.md`
   - Project `DESIGN.md` or `omagy_wiki/index.md` for canonical domain terminology.

## Required template

```markdown
## Summary
<one-sentence claim stating the change and why, followed by the smallest visual that proves the shape>

## Evidence
- **Before / Baseline:** <failing check, repro output, or prior behavior>
- **After / Verification:** <passing test/typecheck/lint/selftest commands and outputs>
- **Review Gate:** <$code-review verdict or verification artifact paths>

## Reversibility
- **Door:** <Two-way door (cheap rollback) | One-way door (irreversible / migration required)>
- **ADR Test:** <Hard to reverse? Surprising without context? Real trade-off? — brief answers>
- **Rollback:** `<exact revert/flag command or migration note>`
- **Blast Radius:** <one line naming affected callers/subsystems>
```

## Section rules

1. **Summary & Smallest Visual**:
   Match a single compact visual to the change type (never include all forms):
   - Logic / algorithm -> short pseudocode or state table
   - Control flow -> call tree
   - UI / layout -> component tree or before/after screenshot reference
   - Broad refactor -> shallow file tree
   - Cross-component flow -> compact Mermaid diagram (`flowchart LR` or `sequenceDiagram`)
2. **Evidence**:
   Quote real commands, exit codes, and test counts from the session or `.omagy/` artifacts. Name any explicit validation gaps.
3. **Reversibility (ADR Test)**:
   Evaluate the diff against three questions:
   - Is it hard to reverse?
   - Would a future reader find it surprising without session context?
   - Does it settle a real architectural or domain trade-off?
   If all three are "No", classify as a **Two-way door** and give the one-line revert command. If any is "Yes", classify accordingly, explain why, and recommend capturing the decision in `omagy_wiki/` or an ADR.

## Output

Output the ready-to-paste Markdown PR body (and optionally save to `.omagy/artifacts/pr-<slug>.md` when inside an active workflow), followed by the list of `.omagy/` paper-trail files consumed.
