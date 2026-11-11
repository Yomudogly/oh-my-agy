---
name: wiki
description: "[oh-my-agy] Persistent markdown project wiki stored in the repository under omagy_wiki/ with keyword/tag search, cross-links, linting, and session-log capture. Use for 'wiki add', 'wiki query', 'wiki read', 'wiki lint', 'wiki delete', or when durable project knowledge (architecture, decisions, debugging notes) should be recorded or looked up."
---

# Wiki

A persistent, self-maintained markdown knowledge base for project and session knowledge. The agent operates it directly with file tools; no CLI or MCP server is needed.

## Storage

- Pages: `omagy_wiki/<page-slug>.md`
- Index: `omagy_wiki/index.md` (one line per page: `- [[slug]] — title — category — tags`)
- Working Agreements Ledger: `omagy_wiki/agreements.md` (persistent user corrections and repo invariants, e.g. `- [v1] [by:human] Never use default exports in packages/core — <date>`; auto-injected ahead of `index.md` on `SessionStart`/`PreInvocation` by `omagy-hook.mjs`).
  - **Human-Agreement Guard**: entries tagged `[by:human]` (or `(by: human)`) must never be deleted, reworded, or downgraded by automated wiki refreshes or overwrites (`omagy-hook.mjs` `agreements-guard` enforces this in `PreToolUse`). Do not re-record the same agreement correction twice from the same turn.
  - **Time-Boxed Expiry (`expires: <ISO 8601>`)**: a wiki page may declare `expires: <ISO 8601>` in YAML frontmatter, and individual lines in `agreements.md` or `index.md` may carry `[expires: YYYY-MM-DD]` (or `(expires: <ISO>)`). Once the timestamp passes, `omagy-hook.mjs` stops projecting that file or line into new sessions without deleting the file on disk. During `$wiki refresh` or `$wiki lint`, move expired pages to category `reference` rather than deleting them.
- Child-Project Discovery: in multi-repo workspaces, touching files inside a child package/repo that has its own `omagy_wiki/` automatically surfaces a once-per-session child-wiki summary via `omagy-hook.mjs`.
- Log: `omagy_wiki/log.md` (append-only: `<ISO> <op> <slug> — note`)

Page format:
```markdown
---
title: Auth Architecture
category: architecture
tags: [auth, architecture]
created: <ISO>
updated: <ISO>
expires: <optional ISO 8601 date or timestamp>
---

# Auth Architecture

Content. Cross-reference with [[other-page-slug]].
```

## Categories
`architecture`, `decision`, `pattern`, `debugging`, `environment`, `session-log`, `reference`, `convention`

## Operations

- **Add / ingest**: derive a slug from the title (lowercase, hyphenated). For periodic or recurring pages (`session-log-*`, `weekly-*`), allocate the slug with `nextAvailableWikiSlug` (which scans active, `archive/`, and `deleted/` pages and appends `-2`, `-3`, etc. so archived or deleted slugs are never resurrected with stale inbound links). If a topic page already exists, merge rather than overwrite (ingest), or refuse and suggest editing (quick add). Write the page, update `index.md`, and append to `log.md`.
- **Query**: run `sh <plugin>/hooks/run.sh wiki-query "<query>" [omagy_wiki] --json` for deterministic lexical ranking (`tags*3 + title*2 + body*1` with hyphen splitting and CJK bi-gram tokenization, redacting secret snippets), and supplement with `grep -ril "<terms>" omagy_wiki/` or `read_file` when full surrounding line context is needed. Rank title/tag matches first and cite page paths.
- **Read**: open `omagy_wiki/<slug>.md`. If missing, suggest the closest slugs.
- **List**: render `index.md`, or rebuild it if it is stale.
- **Delete / Move / Archive & Link Repair**: confirm destructive deletes with the user, remove or move the page, update `index.md`, append to `log.md`, and run `sh <plugin>/hooks/run.sh wiki-repair omagy_wiki '{"moved":{"<old>":"<new>"},"archived":["<slug>"],"deleted":["<slug>"]}'` (or an action array `'[{"action":"delete","oldSlug":"<slug>"}]'`) to automatically rewrite `[[old-slug]]`, `[[old-slug|Label]]`, and `[Label](old-slug.md)` references across all markdown pages while leaving fenced (` ``` ` / `~~~`) and inline (`` `...` ``) code spans untouched.
- **Refresh**: rebuild `index.md` from page frontmatter.
- **Lint**: run `sh <plugin>/hooks/run.sh wiki-lint [omagy_wiki] [repoRoot] --json` to deterministically detect dangling `[[slug]]` wiki links (`brokenWikiLinks`) and dead or out-of-range repository `file:line` citations (`brokenFileRefs`), alongside checking missing/invalid frontmatter, unknown categories, orphan pages, duplicate titles, and `index.md` drift. Lint never rewrites files unless the user asks for fixes. Surface `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` once when listing, reading, or linting wiki pages so the user can browse pages and lint status in the `Wiki` tab of the Auxiliary Pane.

## Session capture & secret-reference rules

At the end of substantial work, if the user opted in (`.omagy/config.json` -> `{"wiki": {"autoCapture": true}}`) or asks, write a `session-log-<YYYYMMDD>-<topic>` page with discoveries, decisions, and gotchas. Never include real secret values or raw private transcripts.
- **Secret-reference exclusion & inline/standalone token redaction**: never store literal credentials/tokens, and if one entry fails validation, drop only that entry rather than discarding the whole capture. `omagy-hook.mjs` (`redactSecrets`) automatically masks standalone secret tokens (`sk-...`, `ghp_...`, `github_pat_...`, `glpat-...`, `xox[baprs]-...`, `AKIA...`, and 3-part JWTs `eyJ...`), inline CLI flags (`--api-key=...`, `--token=...`, `--secret=...`, `--password=...`, `--client-secret=...`), `Authorization: Bearer <token>` headers, and inline `api_key`/`secret`/`token`/`password` assignments wherever they appear before injecting wiki/agreement text. Symbolic references that merely name an env var or placeholder (`process.env.X`, `$VAR`, `${VAR}`, `{{ slot }}`, `[FILTERED]`, `[REDACTED]`, the bare word `Bearer`, `null`, `example`, `placeholder`) are valid documentation and must not be flagged as secrets unless a real secret value is concatenated onto them.

## Hard constraints
- No vector embeddings. Query uses keyword + tag matching only.
- Wiki files are repository project knowledge (commit them like docs). They are separate from `.omagy/` runtime state.
