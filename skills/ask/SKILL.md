---
name: ask
description: "[oh-my-agy] Ask a locally installed external advisor CLI (Claude Code, Gemini CLI, or Codex CLI) for a second opinion, review, or brainstorm, and save a reusable artifact. Use for $ask claude|gemini|codex <question>, or when the user wants another model's opinion."
---

# Ask (Local Advisor CLI)

Use a locally installed external advisor CLI for focused questions, reviews, brainstorming, or second opinions.

## Usage

```text
$ask claude <question or task>
$ask gemini <question or task>
$ask codex <question or task>
```

## Backend selection

- `claude` when the user asks for Claude/Anthropic.
- `gemini` when the user asks for Gemini CLI.
- `codex` when the user asks for Codex/OpenAI.
- If no backend is given, pick the installed one that best fits the request (`command -v claude gemini codex`). If none is available, explain that a local CLI is required. Do not silently switch to an MCP or remote provider.

## Local CLI commands

Pass the prompt as a single argument. Write long prompts to a temp file first (with `write_to_file`) and pipe or reference it, to avoid shell-quoting problems.

```bash
claude -p "<prompt>"
gemini -p "<prompt>"
codex exec "<prompt>"
```

These CLIs need network access. If the sandboxed `run_command` fails on network, re-run the same command with `BypassSandbox: true` (the user approves it). Use a bounded `WaitMsBeforeAsync`, and let long runs finish in the background.

Include relevant context in the prompt (file excerpts, the diff, constraints). The external CLI does not see this conversation.

## Artifact requirement

After running, save a markdown artifact to:

```text
.omagy/artifacts/ask-<backend>-<slug>-<YYYYMMDDTHHMMSSZ>.md
```

Minimum sections:
1. Original user task
2. Backend and final prompt sent to the CLI
3. Raw CLI output
4. Concise summary
5. Action items / next steps

Then give the user the summary and action items, and say where you agree or disagree with the advisor and why.
