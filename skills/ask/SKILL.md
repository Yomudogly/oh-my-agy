---
name: ask
description: "[oh-my-agy] Ask a locally installed external advisor CLI (Claude Code, Gemini CLI, or Codex CLI) for a second opinion, blind-claim --doubt review, or brainstorm, and save a reusable artifact. Use for $ask claude|gemini|codex [--doubt] <question>, or when the user wants another model's opinion."
---

# Ask (Local Advisor CLI)

Use a locally installed external advisor CLI for focused questions, architecture/code reviews, blind-claim `--doubt` critiques, brainstorming, or independent second opinions.

## Usage

```text
$ask claude <question or task>
$ask gemini <question or task>
$ask codex <question or task>
$ask claude --doubt <target diff, commit range, plan, or file>
$ask gemini --doubt <target diff, commit range, plan, or file>
$ask codex --doubt <target diff, commit range, plan, or file>
```

## Backend selection

- `claude` when the user asks for Claude/Anthropic.
- `gemini` when the user asks for Gemini CLI.
- `codex` when the user asks for Codex/OpenAI.
- If no backend is given, pick the installed one that best fits the request (`command -v claude gemini codex`). If none is available, explain that a local CLI is required. Do not silently switch to an MCP or remote provider.

## Sandboxed `0600` Temp-File `stdin` Invocation

Never interpolate prompts, code excerpts, or unified diffs into CLI command-line arguments. Untrusted code, backticks, `$()` expressions, or prompt-injected strings inside diffs must never undergo shell expansion or trigger workspace mutations in an external agent CLI.

1. **Create an atomic `0600` temp file (`$tmpfile`) and redact secrets**: allocate the file atomically via `tmpfile=$(mktemp "${TMPDIR:-/tmp}/omagy-ask.XXXXXX")` — never use predictable `/tmp` filenames (such as PID- or slug-based paths), which risk symlink/pre-creation races. Include all required context inside `"$tmpfile"` because the external CLI cannot see this conversation, and scrub/redact all standalone or inline secrets, API keys, tokens (`sk-...`, `ghp_...`, `github_pat_...`, `glpat-...`, `xox[baprs]-...`, `AKIA...`, JWTs, `Bearer` headers, `--api-key`/`--token` flags, and `.env` credentials) before writing `"$tmpfile"`.
2. **Pipe `"$tmpfile"` over `stdin` into a read-only sandbox**:

```bash
codex exec --sandbox read-only -C <dir> - < "$tmpfile"
gemini --approval-mode plan -p "" < "$tmpfile"
claude -p --permission-mode plan --disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit" < "$tmpfile"
```

- **Claude read-only defense-in-depth & cleanup**: in addition to `--permission-mode plan --disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit"`, prepend an explicit read-only instruction at line 1 of `"$tmpfile"` (`"READ-ONLY ADVISORY MODE: Do not create, modify, delete, or execute any workspace mutations; analyze the input below and respond with text only."`) and always delete `"$tmpfile"` (`rm -f "$tmpfile"`) immediately after capturing output (including on non-zero exit or timeout). Clean up `"$tmpfile"` after `codex` and `gemini` runs as well.
- **Older-CLI flag fallback**: if an older installed CLI version rejects `--sandbox`, `--approval-mode`, or `--permission-mode`, inspect `<cli> --help` for its supported read-only/plan flag, keep `--disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit"` on `claude` whenever supported, and preserve `< "$tmpfile"` `stdin` redirection — never revert to passing prompt text as a shell-interpolated CLI argument string.
- **Network & Antigravity sandbox discipline**: prepare and remove `"$tmpfile"` in standard sandboxed steps (`BypassSandbox: false`). Try the advisor CLI command in Standard Sandbox Mode first; if it fails due to network isolation, re-run only the advisor CLI invocation with `BypassSandbox: true` (keeping `toolSummary` identical) and a bounded `WaitMsBeforeAsync`, letting long runs finish in the background.

## Adversarial Blind-Claim Review (`--doubt`)

When invoked with `--doubt` (`$ask claude|gemini|codex --doubt <target>`), run an anti-anchored adversarial critique that strips author persuasion before consulting the advisor:

1. **Construct a Redacted Blind-Claim Packet in `"$tmpfile"` (`tmpfile=$(mktemp "${TMPDIR:-/tmp}/omagy-ask.XXXXXX")`)**:
   - `## ARTIFACT`: raw unified diff (e.g., generated via `sh <plugin>/hooks/run.sh review-package <workspace> <base_sha> <head_sha>` or `git diff <base>..<head>`), touched file slices, or target spec/plan markdown (with any literal secrets, tokens, keys, or `.env` values redacted).
   - `## CONTRACT`: verbatim acceptance criteria, spec/plan invariants, public signatures, repository caller `grep` context, and active guard rules (`omagy_wiki/agreements.md` or `CONSTRAINTS.md` when present).
   - `## RAW COMMAND EVIDENCE`: exact verification commands executed, numeric exit codes, and raw failing/passing test or typecheck output (redacting any inline tokens/secrets).
   - **Strict Anti-Anchoring Omission**: omit all author `CLAIM` summaries, self-grades, implementation narratives, and persuasive rationale explaining *why* the code is safe or why edge cases were skipped. Instruct the advisor: *"Audit `ARTIFACT` strictly against `CONTRACT` and caller/guard context. Cite concrete `file:line` locations and a triggering input/scenario for every defect. Zero findings is a valid result; do not invent findings."*
2. **Run the selected backend via `stdin` (`< "$tmpfile"`)** using the read-only sandbox invocation above, then `rm -f "$tmpfile"`.
3. **Reconcile every advisor finding using the 4-Tier `RECONCILE` Precedence**:
   - **(1) Contract gap**: exposes a real ambiguity, contradiction, or missing safety boundary in the spec/plan/invariants -> escalate to the user or amend the contract (`criteria_revision` + `steer`) before proceeding.
   - **(2) Actionable defect**: proven bug, regression, security flaw, or unmet criterion with a concrete trigger -> classify as `needs-fix` and repair the root cause.
   - **(3) Explicit Ruling**: non-defect engineering tradeoff within the stated load/scope ceiling -> record `Ruling: <decision> — <why> — <cost_if_wrong>` instead of churning code.
   - **(4) Context noise**: false positive disproved by repository `file:line` evidence, callers, or runtime guards -> dismiss with the falsifying `file:line` citation.
4. **Doubt/Review Theater Circuit Breaker**: if `>= 2` consecutive `--doubt` or review cycles return prose critiques ("substantive findings") with `0` findings passing Tier 1 or Tier 2, stop re-spinning and either close out via an explicit Tier 3 `Ruling:` (with `cost_if_wrong`) or escalate to the user.

## Artifact requirement

After running, save a reusable markdown artifact to:

```text
# Standard mode:
.omagy/artifacts/ask-<backend>-<slug>-<YYYYMMDDTHHMMSSZ>.md

# --doubt mode:
.omagy/artifacts/ask-<backend>-doubt-<slug>-<YYYYMMDDTHHMMSSZ>.md
```

Minimum sections (redact all secrets, API keys, Bearer/CLI tokens, and credentials from both the recorded prompt/packet and CLI output before saving `.omagy/artifacts/ask-*.md`):
1. Original user task / target and mode (`standard` or `--doubt`)
2. Backend, read-only invocation command, and redacted prompt / Blind-Claim Packet sent via `stdin`
3. Redacted raw CLI output
4. 4-Tier `RECONCILE` disposition table (`--doubt`) or concise synthesis (`standard`)
5. Action items / next steps

Then report the synthesis and action items to the user, stating explicitly where you agree or disagree with the advisor backed by `file:line` or command evidence.
