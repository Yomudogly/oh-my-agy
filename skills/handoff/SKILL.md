---
name: handoff
description: "[oh-my-agy] Create a structured, self-contained session handoff artifact under .omagy/artifacts/handoff-<slug>-<UTC>.md so work can resume cleanly after /compact or in a fresh conversation. Use for $handoff, 'create a handoff', 'save context for next session', or before context compaction."
---

# Handoff — Structured Session Continuation Artifact

Use `$handoff` (ported from `oh-my-openagent` `/handoff`) when a conversation is getting long, before running Antigravity's `/compact` slash command, or when handing work over to a fresh conversation or another engineer/agent.

## When to use

- The user invokes `$handoff` or asks to "save handoff", "prepare for a new session", or "summarize state before compacting".
- A multi-stage run (`$autopilot`, `$ultragoal`, `$ralplan`, `$team`) pauses at a milestone or blocker and needs a self-contained resume packet.

## Operational steps

1. **Inspect active state & git status**:
   - Read any active state files under `.omagy/state/` (and `.omagy/state/sessions/<conversationId>/`).
   - Read `.omagy/ultragoal/goals.json` and the tail of `.omagy/ultragoal/ledger.jsonl` if present.
   - Inspect `git status --short` and `git diff --stat` to capture modified and untracked files.
2. **Write the handoff artifact**:
   - Derive a short `<slug>` and UTC timestamp (`YYYYMMDDTHHMMSSZ`).
   - Write `.omagy/artifacts/handoff-<slug>-<UTC>.md` and copy/update `.omagy/artifacts/handoff-latest.md` using this exact structure:

```markdown
# Session Handoff: <title>

- **Created**: `<ISO UTC>`
- **Conversation ID**: `<conversationId>`
- **Active Mode / Phase**: `<mode> (<current_phase>) | none`
- **Branch / Commit**: `<branch> @ <short-sha>`

## 1. Objective & Current Status
<1-3 sentences stating the target outcome and what percentage/stage is complete>

## 2. Completed Work & Verification Evidence
- `<file:line>` — <change summary> (Verified by: `<command>` -> exit `<code / output>`)

## 3. Active Durable State & Artifacts
- State file(s): `.omagy/state/...`
- Plan / Spec: `.omagy/plans/...` or `.omagy/specs/...`
- Ultragoal ledger: `.omagy/ultragoal/goals.json` (`<completed>/<total>` goals complete)
- Working agreements / Wiki updates: `omagy_wiki/...`

## 4. Key Decisions & Adopted Defaults
- `[from-user]` / `[adopted-default]`: <decision + 1-line rationale>

## 5. Open Blockers, Dirty Files & Residual Risks
- Uncommitted files: `<list from git status>`
- Open blockers / next discriminating probe: `<none or exact details>`

## 6. Exact Resume Prompt (Copy-Paste into Next Session)
> Read `.omagy/artifacts/handoff-latest.md` and resume from `<exact next step or $skill command>`.
```

3. **Report**:
   - Output the clickable link to `.omagy/artifacts/handoff-<slug>-<UTC>.md`, display the **Exact Resume Prompt**, and remind the user they can now run `/compact` or open a new session safely.
