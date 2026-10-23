---
name: wiki
description: "[oh-my-agy] Persistent markdown project wiki stored in the repository under omagy_wiki/ with keyword/tag search, cross-links, linting, and session-log capture. Use for 'wiki add', 'wiki query', 'wiki read', 'wiki lint', 'wiki delete', or when durable project knowledge (architecture, decisions, debugging notes) should be recorded or looked up."
---

# Wiki

A persistent, self-maintained markdown knowledge base for project and session knowledge. The agent operates it directly with file tools; no CLI or MCP server is needed.

## Storage

- Pages: `omagy_wiki/<page-slug>.md`
- Index: `omagy_wiki/index.md` (one line per page: `- [[slug]] — title — category — tags`)
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

## Session capture

At the end of substantial work, if the user opted in (`.omagy/config.json` -> `{"wiki": {"autoCapture": true}}`) or asks, write a `session-log-<YYYYMMDD>-<topic>` page with discoveries, decisions, and gotchas. Never include secrets or raw private transcripts.

## Hard constraints
- No vector embeddings. Query uses keyword + tag matching only.
- Wiki files are repository project knowledge (commit them like docs). They are separate from `.omagy/` runtime state.
