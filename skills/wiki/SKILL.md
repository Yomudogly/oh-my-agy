---
name: wiki
description: "[oh-my-agy] Persistent markdown project wiki stored in the repository under omagy_wiki/ with keyword/tag search, cross-links, linting, and session-log capture. Use for 'wiki add', 'wiki query', 'wiki read', 'wiki lint', 'wiki delete', or when durable project knowledge (architecture, decisions, debugging notes) should be recorded or looked up."
---

# Wiki

A persistent, self-maintained markdown knowledge base for project and session knowledge. The agent operates it directly with file tools; no CLI or MCP server is needed.

## Storage

- Pages: `omagy_wiki/<page-slug>.md`
- Index: `omagy_wiki/index.md` (one line per page: `- [[slug]] — title — category — tags`)
- Working Agreements Ledger: `omagy_wiki/agreements.md` (persistent user corrections and repo invariants, e.g. `- [v1] [by:human] Never use default exports in packages/core — <date>`; auto-injected ahead of `index.md` on `SessionStart`/`PreInvocation` by `omagy-hook.mjs`, ported from OmO Kibitzer `system/agreements.md`).
  - **Human-Agreement Guard (ported from OmO `#11112`, `#11214`, `#11284`)**: entries tagged `[by:human]` (or `(by: human)`) must never be deleted, reworded, or downgraded by automated wiki refreshes or overwrites (`omagy-hook.mjs` `agreements-guard` enforces this in `PreToolUse`). Do not re-record the same agreement correction twice from the same turn.
- Child-Project Discovery (ported from OmO `#10921`, `#11165`): in multi-repo workspaces, touching files inside a child package/repo that has its own `omagy_wiki/` automatically surfaces a once-per-session child-wiki summary via `omagy-hook.mjs`.
- Log: `omagy_wiki/log.md` (append-only: `<ISO> <op> <slug> — note`)
- Legacy: if `omagy_wiki/` does not exist but `omx_wiki/` does (from oh-my-codex), read it as compatibility input. Offer to migrate it with `mv omx_wiki omagy_wiki` before the first write.

Page format:
```markdown
---
title: Auth Architecture
category: architecture
tags: [auth, architecture]
created: <ISO>
updated: <ISO>
---

# Auth Architecture

Content. Cross-reference with [[other-page-slug]].
```

## Categories
`architecture`, `decision`, `pattern`, `debugging`, `environment`, `session-log`, `reference`, `convention`

## Operations

- **Add / ingest**: derive a slug from the title (lowercase, hyphenated). If the page exists, merge rather than overwrite (ingest), or refuse and suggest editing (quick add). Write the page, update `index.md`, and append to `log.md`.
- **Query**: keyword + tag + category match. Search with `grep -ril "<terms>" omagy_wiki/` and filter by frontmatter. Rank title/tag matches first, show matching lines in context, and cite the page paths.
- **Read**: open `omagy_wiki/<slug>.md`. If missing, suggest the closest slugs.
- **List**: render `index.md`, or rebuild it if it is stale.
- **Delete**: confirm with the user, remove the page, update the index, append to the log, and report any `[[slug]]` links that are now dangling.
- **Refresh**: rebuild `index.md` from page frontmatter.
- **Lint**: report pages with missing or invalid frontmatter, unknown categories, dangling `[[links]]`, orphan pages (no inbound links and not in the index), duplicate titles, and index drift. Lint never rewrites files unless the user asks for fixes.

## Session capture & secret-reference rules

At the end of substantial work, if the user opted in (`.omagy/config.json` -> `{"wiki": {"autoCapture": true}}`) or asks, write a `session-log-<YYYYMMDD>-<topic>` page with discoveries, decisions, and gotchas. Never include real secret values or raw private transcripts.
- **Secret-reference exclusion (ported from OmO `#10528`, `#11305`)**: never store literal credentials/tokens, and if one entry fails validation, drop only that entry rather than discarding the whole capture. Symbolic references that merely name an env var or placeholder (`process.env.X`, `$VAR`, `${VAR}`, `{{ slot }}`, `[FILTERED]`, `[REDACTED]`, the bare word `Bearer`, `null`, `example`, `placeholder`) are valid documentation and must not be flagged as secrets unless a real secret value is concatenated onto them.

## Hard constraints
- No vector embeddings. Query uses keyword + tag matching only.
- Wiki files are repository project knowledge (commit them like docs). They are separate from `.omagy/` runtime state.
