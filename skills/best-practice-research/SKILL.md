---
name: best-practice-research
description: "[oh-my-agy] Bounded, read-only best-practice research using official/upstream evidence first, producing a cited recommendation and handoff. Use when a task depends on current best practices, version-aware guidance, standards, or upstream behavior for an already-chosen technology."
---

# Best-Practice Research

Use this skill when a task depends on current external best practices, version-aware guidance, standards, official recommendations, or upstream behavior. This is a workflow wrapper: it routes evidence gathering and synthesis; it is not a new research authority and it does not replace `researcher`.

## Purpose

Produce a cited, reusable best-practice answer or handoff that separates current external evidence from repo-local facts and dependency-selection decisions. For pre-planning investigation, this is the ordinary first research wrapper: gather official/upstream evidence, then hand it to `$ralplan` or the caller as planning input. Do not present `$best-practice-research` as a final architecture component or as a validator-gated research loop.

## Terminal By Default

This skill is terminal and read-only by default. It gathers evidence and produces a cited recommendation with a handoff, then stops. Do not write or edit files, create or amend commits, run mutating commands, or otherwise modify repository state under this skill — even when the question has clear implementation implications. When implementation is warranted, stop and hand off rather than continuing: name `$ralplan` for planning and `$ultragoal`, `$team`, or `executor` for execution, and resume only after the user explicitly switches to that workflow.

## Activate When

- The user asks for best practices, recommended approach, current guidance, official recommendations, standards, or version-aware external behavior.
- `$ralplan`, `$deep-interview`, `$team`, or another workflow needs current external evidence before planning or execution can be correct.
- The task involves an already chosen technology and needs authoritative usage guidance, migration notes, API behavior, lifecycle rules, or current safety guidance.

## Do Not Activate When

- The answer is fully repo-local; use the `explore` subagent (or direct reads) for codebase facts.
- The main question is whether to adopt, replace, upgrade, or compare dependencies; use the `dependency-expert` subagent.
- The user only needs implementation against already-grounded requirements; execute directly, or use `$team` when coordinated parallel work is warranted.
- The task can be answered from stable local project conventions without current external lookup.

## Specialist Routing

1. Use the `explore` subagent (or direct reads) first for brownfield facts: current code usage, local constraints, versions, config, and integration points.
2. Use the `researcher` subagent (`invoke_subagent`, TypeName `researcher`) or `search_web`/`read_url_content`/context7 directly for official/upstream docs, release notes, standards, migration guides, source-backed examples, and current best-practice evidence for an already chosen technology.
3. Use the `dependency-expert` subagent only for adoption/upgrade/replacement/comparison decisions.
4. Return to the caller with explicit evidence, uncertainty, and any implementation handoff constraints.

## Source-Quality & Fidelity Rules

- Prefer official documentation, upstream source, release notes, changelogs, standards, and maintainer guidance.
- Include source URLs for material claims.
- State date/version context for current best-practice claims.
- Label third-party summaries as supplemental; do not use them before official/upstream sources.
- Flag stale, conflicting, undocumented, or version-mismatched evidence.
- **Claim-kind & meaning preservation (ported from OmO `ulw-research` `#11151`, `#11289`, `#11302`)**: distinguish `[VERIFIED]` (proven by local command/test output or primary upstream source), `[DERIVED]` (calculated from cited figures), and `[ASSUMED]` claims. Preserve source hedges and scope boundaries (`no hedge_dropped` or `scope_widened`).
- Do not over-fetch: gather the smallest evidence set that can support the decision.

## Workflow

1. Classify the question: conceptual best practice, implementation guidance, migration/version guidance, standards/compliance guidance, or mixed local + external guidance.
2. Gather repo-local facts (directly or via the `explore` subagent) when local usage or constraints affect the answer.
3. Gather external evidence (directly or via the `researcher` subagent) when current or version-aware practice affects correctness.
4. Synthesize a concise answer with source quality, version/date context, caveats, and an implementation or planning handoff.
5. Stop when the answer is grounded enough for the caller; otherwise report the exact blocker or specialist handoff needed.

## Output Contract

```md
## Best-Practice Research: <question>

### Direct Recommendation
<actionable guidance or decision support>

### Evidence Used
- Official/upstream: <source URL> — <what it establishes>
- Supplemental, if any: <source URL> — <why it is secondary>

### Version / Date Context
<versions, dates, release channels, or unknowns>

### Repo-Local Context & Intent-vs-Reality Drift
<repo-local facts, or "not needed". When comparing local usage against upstream/official guidance, classify each surface as `Match`, `Undocumented`, `Broken`, or `Stale` with `file:line` and upstream URL.>

### Boundaries / Non-goals
<what this research does not decide>

### Handoff
<planning/execution/test implications; name the next workflow — `$ralplan` for planning, `$ultragoal`/`$team`/`executor` for execution — and note that this skill stops here unless the user explicitly switches workflows>
```

## Stop Rules

- Stop after a source-backed recommendation is reusable by the caller.
- Stop and route upward if the task becomes dependency comparison, broad architecture, or implementation.
- Do not continue researching when remaining work would only polish wording rather than change the recommendation.
- This skill never implements. After delivering the recommendation and handoff, stop; do not modify repo files or repo state. Resume only when the user explicitly switches to a planning or implementation workflow named in the handoff.
