# Session Transcript Forensics (`$doctor --session`)

Post-session diagnostic workflow for Antigravity JSONL transcripts (`transcript.jsonl` and `transcript_full.jsonl`). Adapted from `superpowers`'s `analyze-session` 7-dimension methodology for Antigravity's native conversation logs.

## 1. Transcript Discovery

Locate the target transcript in priority order:
1. **Explicit path**: if the user passes a file path to `$doctor --session <path>`, verify it exists on disk.
2. **Runtime routing record**: check `$TMPDIR/oh-my-agy/<conversationId>.routing.json` for `transcriptPath` (persisted automatically by `SessionStart` and `PreInvocation` when the host payload provides `transcriptPath`, `transcript_path`, or `logPath`).
3. **Antigravity brain directory**: resolve `<appDataDir>/brain/<conversationId>/.system_generated/logs/transcript.jsonl` (start with compact `transcript.jsonl`; consult the matching line in `transcript_full.jsonl` only when `truncated_fields` is present on a specific step).

## 2. Context-Safety Protocol (Mandatory Before Reading)

Never dump raw JSONL lines directly into the main conversation context. A single tool result, image payload, or un-truncated step can exceed `100 KB` and blow out the context window.

1. **Measure file shape first**:
   ```bash
   wc -lc "<transcript.jsonl>"
   awk 'length($0) > 102400 { print NR, length($0) }' "<transcript.jsonl>"
   ```
2. **Extract line indices and metadata first**:
   ```bash
   node -e '
     const fs = require("fs");
     const lines = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/).filter(Boolean);
     lines.forEach((raw, idx) => {
       try {
         const row = JSON.parse(raw);
         console.log(JSON.stringify({
           line: idx + 1,
           step: row.step_index,
           source: row.source,
           type: row.type,
           status: row.status,
           tools: (row.tool_calls || []).map(t => t.name || t.tool_name),
           truncated: row.truncated_fields || []
         }));
       } catch {}
     });
   ' "<transcript.jsonl>" | head -n 120
   ```
3. **Slice string fields (`<= 500` chars)** when inspecting individual steps unless a specific line requires full inspection.

## 3. Seven Behavioral Diagnostic Lenses

Delegate the 7 lenses across up to 3 read-only `tracer` or `explore` subagents (or run sequentially on short transcripts `< 150` lines). Every finding must cite `[line N / step S]`:

1. **`skill-timeline`**:
   - Which skills (`SKILL.md`) were read, in what order, and which skill routing hints were active?
   - Flag **skipped skill reads** (the model claimed or paraphrased a skill workflow from its YAML description without calling `read_file` on `SKILL.md`).
2. **`plan-adherence` (including post-compaction drift)**:
   - Compare planned tasks/goals against executed steps before and after context compaction boundaries (`<CONTEXT_SUMMARY>`).
   - Flag silently dropped tasks, unapproved scope expansion, or skipped verification gates after compaction.
3. **`repeated-work`**:
   - Identify duplicate file reads (`>= 3` full reads of the same unchanged file in one turn sequence), redundant grep/search loops, or repeated failed edits on the same target block.
4. **`stumbles`**:
   - Catalog tool errors (`status: "ERROR"`), sandbox permission denials reiterated without changing strategy, edit target mismatches, and hook blocks (`decision: "block"` or `decision: "ask"`).
5. **`quality-evidence`**:
   - Check whether completion claims were preceded by fresh test/selftest/build execution in the same phase, or whether the agent hedged (`should work`, `seems to pass`) or relied on stale runs.
6. **`request-conflicts`**:
   - Surface places where earlier user instructions, `omagy_wiki/agreements.md`, or `SKILL.md` rules conflicted with later user turns or host constraints, and how the agent resolved them.
7. **`cost-and-time`**:
   - Identify the highest-latency steps (wall-clock delta between consecutive `created_at` timestamps), oversized subagent prompts (`> 50` lines when a `goal-brief` or file pointer would suffice), and avoidable subagent spawns.

## 4. Two-Pass Redaction & Scrubbed Bundle Export (`--export`)

When the user asks to share or archive a session report (`$doctor --session <id> --export [skeleton|evidence|full]`), write the artifact to `.omagy/artifacts/session-forensics-<id>-<UTC>.md` after a mandatory two-pass scrub:

1. **Export tiers**:
   - `skeleton`: step index, timestamps, tool names, status codes, and the 7-dimension diagnostic summary (zero code or prompt prose).
   - `evidence`: `skeleton` + `<= 300`-char scrubbed excerpts for cited `[line N / step S]` findings.
   - `full`: complete diagnostic report + scrubbed step timeline.
2. **Pass 1 — Deterministic Replacement**:
   Replace sensitive tokens consistently across the report using numbered placeholders so causal links remain readable:
   - `<SECRET-1>`, `<SECRET-2>` for bearer tokens, API keys (`sk-`, `ghp_`, `AIza`, `xoxb-`), and private keys.
   - `<EMAIL-1>`, `<EMAIL-2>` for email addresses.
   - `<PERSON-1>`, `<PERSON-2>` for personal OS home usernames (`/Users/<PERSON-1>/...`, `/home/<PERSON-1>/...`).
   - `<HOST-1>`, `<REPO-1>` for internal hostnames and private repository URLs when requested.
3. **Pass 2 — Independent Scrub Audit**:
   Before declaring the export complete, scan the generated `.omagy/artifacts/session-forensics-*.md` file with regexes for raw `/Users/[^<\s/]+`, `/home/[^<\s/]+`, `@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`, and token prefixes (`sk-`, `ghp_`, `AIza`, `Bearer `). Any match blocks export completion until redacted.
