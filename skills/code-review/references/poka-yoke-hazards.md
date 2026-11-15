# Poka-Yoke & Boundary Hazard Checklist

Playbook for [`skills/code-review/SKILL.md`](../SKILL.md). Consult during substantive code review, architecture review, and post-change diff inspection to catch structural failure modes before merge.

## Contents

- [1. Poka-Yoke State and API Design](#1-poka-yoke-state-and-api-design)
- [2. TOCTOU and Async Concurrency Races](#2-toctou-and-async-concurrency-races)
- [3. Parser and Serializer Round-Trip Asymmetry](#3-parser-and-serializer-round-trip-asymmetry)
- [4. Silent Fallback Masking](#4-silent-fallback-masking)
- [5. Multi-Tenant Isolation and Idempotency](#5-multi-tenant-isolation-and-idempotency)

## 1. Poka-Yoke State and API Design

Design types, schemas, and call signatures so invalid transitions and misconfigurations are unrepresentable at compile time or rejected immediately at the boundary.

- **Illegal states in structs and records**:
  - Flag boolean-flag combinations (`loading: true, error: "...", data: {...}`) where contradictory states can coexist.
  - Prefer discriminated unions (`status: "idle" | "loading" | "error" | "ready"`) or explicit finite-state enums validated at transition time.
- **Unvalidated primitive obsession**:
  - Raw `string` identifiers passed interchangeably between user IDs, workspace paths, slugs, and tokens risk silent cross-argument swaps.
  - Require branded types, validated parser constructors, or explicit boundary assertions whenever two ID parameters share a primitive signature.
- **Implicit defaults hiding required choices**:
  - Flag optional config parameters whose default silently weakens trust boundaries (e.g., `verifyTls = false`, `allowAllOrigins = true`, `dryRun = false` on destructive mutations).
  - Require explicit opt-in booleans for dangerous modes so omitting an option stays fail-closed.
- **Non-exhaustive switches**:
  - Verify state-machine and enum dispatch handles every variant with an explicit fail-closed branch (`default: throw new Error(...)`) rather than a silent fall-through.
- **Ambiguous return sentinels**:
  - Returning `null`, `""`, or `-1` for both "not found" and "permission denied / I/O error" forces callers to conflate emptiness with failure.
  - Distinguish `{ ok: false, reason }` or explicit exceptions at system boundaries.

## 2. TOCTOU and Async Concurrency Races

Inspect every check-then-act sequence across filesystem, cache, database, and UI async updates for interleaving windows.

- **Filesystem TOCTOU (`exists` / `stat` then `open` / `write`)**:
  - Replace pre-flight existence checks with atomic OS primitives (`O_CREAT | O_EXCL`, `mktemp` with `0600` mode, temp-file write followed by atomic `rename`).
  - Canonicalize paths via `realpath` and check symlink containment immediately before reading or writing, rejecting dangling or escaping links.
- **Read-modify-write lost updates**:
  - JSON state files, counters, and ledgers read without locking or compare-and-swap can drop concurrent updates.
  - Enforce single-writer ownership (`owner_conversation_id`), transactional conditional writes, or append-only logs where multiple producers run.
- **Stale async UI and Promise races**:
  - Rapid user interactions or retried RPCs resolving out of order overwrite newer state unless guarded by monotonic request sequence numbers, `AbortController`, or generation tokens.
- **Unbounded concurrency and fan-out**:
  - Flag unbounded `Promise.all(items.map(...))` over user-supplied or repository-sized lists.
  - Require worker pools, explicit concurrency caps, or bounded timeouts.
- **Cleanup vs. in-flight work**:
  - Timer callbacks, child processes, and temporary directories must inspect disposal/cancellation flags before mutating shared state after completion.

## 3. Parser and Serializer Round-Trip Asymmetry

Verify that readers and writers agree on escaping, quoting, normalization, and delimiter precedence.

- **Quoting and escape mismatch**:
  - Serializers emitting scalars with `:`, `#`, quotes, or newlines must follow the exact quoting/escaping grammar the reader decodes.
  - Confirm `#` inside quoted YAML scalars or URLs is never stripped as a mid-line comment.
- **Code and prose context blindness**:
  - Regex scanners checking markdown, HTML, or source files for comments, links, CLI commands, or secrets must track fenced code blocks, inline code spans, and string/template literals rather than scanning blindly across delimiters.
- **Path and Unicode normalization drift**:
  - Watch macOS vs. Linux symlinked temp/workspace roots (`realpath` vs. unresolved paths), POSIX `/` vs. Windows separators, and invisible/bidi Unicode characters (`trojan_unicode`) embedded in identifiers or prompts.
- **Truncated or partial framing**:
  - Streamed buffers, JSONL ledgers, and `postMessage` frames must reject or isolate malformed records fail-closed without corrupting valid adjacent entries.
- **Round-trip property check**:
  - For every custom serializer/parser pair introduced in a diff, verify `parse(serialize(x))` preserves edge strings (`""`, `"a: b"`, multi-line text, unicode, escaped quotes).

## 4. Silent Fallback Masking

Distinguish safe fail-open degradation (telemetry, optional UI hints) from dangerous silent fallbacks that hide broken invariants or security controls.

- **Swallowed `catch` blocks (`catch { return null }`)**:
  - Confirm caught errors either rethrow on integrity/security paths, record structured diagnostics (`.omagy/logs/`), or carry an inline rationale explaining why fail-open degradation is safe.
- **Unbounded compatibility shims**:
  - Fallback branches written during migrations (`if (legacyField) ...`) must document removal criteria or a `shortcut: <ceiling>, <when to upgrade>` marker instead of accepting malformed inputs forever.
- **Fail-open auth or schema gates**:
  - Signature verification, origin/source checks (`postMessage`), and strict validators must deny when inputs, headers, or credentials are missing or unparseable.
- **Fallback-induced masked regressions**:
  - Check that retry loops or fallback transports surface the primary failure reason in diagnostics rather than only reporting the fallback attempt.

## 5. Multi-Tenant Isolation and Idempotency

Verify every persisted key, cache entry, retry handler, and destructive cleanup scopes strictly to its caller and tolerates replay.

- **Tenant, session, and workspace key scoping**:
  - Confirm state paths, temp files, cache keys, and lock names include `sessionId`, `conversationId`, or canonical workspace root so parallel runs cannot hijack sibling sessions.
- **Unsafe cleanup globs or unanchored deletes**:
  - Deletion helpers must prove canonical containment strictly below `canonBase` (`rel` non-empty, not `'..'`, minimum depth `>= 1`) before unlinking or recursing.
  - Quote path expansions and disallow empty variables inside cleanup targets.
- **Idempotency on retry**:
  - Ledger appends, webhook handlers, and database migrations must deduplicate by stable event/goal ID or handle already-applied states cleanly without duplicate side effects.
- **Cross-context origin and capability boundaries**:
  - Browser `postMessage` receivers, local HTTP servers, and child processes must verify `event.source` / origin, bind loopback-only locally, fence untrusted error/UI payloads explicitly before model/chat dispatch, and scrub privileged credentials (`AGY_*`, API keys) from child environments.
