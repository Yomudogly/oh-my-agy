# Changelog

Versions follow `<oh-my-codex version>-agy.<port revision>`.

## 0.21.33-agy.1

- `$team`: the leader sets `requires_code_change` from the task wording and the worker role (analysis-only tasks and read-only roles: `false`). Ported from OMX 0.21.33 task-evidence intent.
- `$team`: the leader validates `.omagy/evidence/task-<id>.json` with file reads; the `verify-evidence` script is now optional.
- After a server restart, stopped subagents are revived with `send_message` before any replacement is spawned (rules and `$team` recovery). Ported from the OMX 0.21.33 leader contract.
- `$doctor`: live-hook check via `$TMPDIR/oh-my-agy/<conversationId>.routing.json`; documents that Antigravity's terminal sandbox may deny reading plugin files.

## 0.21.21-agy.1

- Hook `workspaceRoots` ignores workspace paths that no longer exist.
- Install and doctor guidance for macOS folders the terminal sandbox denies (`~/Documents`, `~/Desktop`, `~/Downloads`).

## 0.21.18-agy.1

- Stop hook: continuation now triggers on Antigravity's real normal-stop reason `NO_TOOL_CALL` (previously only `model_stop`, so auto-continuation never fired in live sessions).
- `SessionStart` hook plus a bounded (≤3,500 chars) `omagy_wiki/index.md` summary injected once per conversation. Ported from OMX 0.21.18.
- Team completion evidence: `.omagy/evidence/task-<id>.json` plus the `verify-evidence` validator. Ported from OMX 0.21.18.
- Selftest no longer leaks runtime files into `$TMPDIR/oh-my-agy`; `run.sh` picks the newest nvm Node.
- Single rules file `rules/AGENTS.md`.

## 0.21.8-agy.1

- Initial Antigravity port of oh-my-codex 0.21.8: 23 skills, 16 role subagents, the operating contract as `rules/AGENTS.md`, and `PreInvocation` routing, `Stop` continuation and an opt-in `PreToolUse` planning-guard hook.
