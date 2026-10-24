---
name: skill
description: "[oh-my-agy] Manage Antigravity skills: list, add, edit, remove, search, info, sync, setup, scan, and validate SKILL.md files in user or project scope. Use for $skill <command> or when a durable, codebase-specific workflow should be captured as a skill."
---

# Skill Management

Manage Antigravity `SKILL.md` files with `$skill` commands.

<Purpose>
Create, inspect, validate, update, and organize user- or project-scoped skills. Keep each skill specific, actionable, evidence-based, and useful to this codebase.
</Purpose>

<Use_When>
- The user asks to list, add, edit, remove, search, inspect, sync, set up, scan, or validate skills.
- A durable, codebase-specific solution or workflow should be captured as a skill.
</Use_When>

<Do_Not_Use_When>
- Packaging several customizations into a plugin: use Antigravity's built-in `plugin` skill.
- Persisting a correction or preference from this conversation: suggest the `/learn` slash command.
- Changing runtime code, hooks, or installation logic.
</Do_Not_Use_When>

## Scopes and commands

Antigravity skill roots (a skill lives at `<root>/<name>/SKILL.md`):
- **project**: `.agents/skills/` at the repository root (`.agent/`, `_agents/`, and `_agent/` are also discovered)
- **user**: `~/.gemini/config/skills/`
- **plugin** (read-only here): `<plugin>/skills/`, including this oh-my-agy plugin. Edit plugin skills only when the user explicitly targets the plugin.

Name collisions resolve by priority: project > declared > user (global) > built-in. Warn when a new skill would shadow an existing one.

| Command | Contract |
|---|---|
| `$skill list` | Scan the project and user roots (and plugins, read-only), parse frontmatter, and show name, description, scope, and path. |
| `$skill add [name]` | Run the authoring wizard, validate the name, choose a scope, create `SKILL.md`, and report its path. |
| `$skill edit <name>` | Find it in one scope, show its metadata, then update the description, body, or name, and report the change. |
| `$skill remove <name>` | Show scope and metadata, confirm with `ask_question`, then remove its directory. |
| `$skill search <query>` | Case-insensitive search of name, description, and body. Rank name/description matches first and show context. |
| `$skill info <name>` | Show parsed metadata, scope, path, and the full body. Suggest `$skill search` when absent. |
| `$skill sync` | Compare user and project skills (user-only / project-only / common) and confirm every copy or overwrite. |
| `$skill setup` | Ensure both roots exist, scan them, then offer add, list, scan, import, or done. |
| `$skill scan` | Run setup's inventory without the interactive menu. |
| `$skill extract [name]` | Extract a repeatable workflow discovered in the current session into a project/user `SKILL.md` after passing the 3-question Skillify quality gate: (1) *"Could someone Google this in 5 minutes?"* -> No; (2) *"Is this specific to this codebase, project, or workflow?"* -> Yes; (3) *"Did this take real debugging, design, or operational effort to discover?"* -> Yes. |
| `$skill validate` | Validate every skill in both roots and report pass/fail per path. Never rewrite files. |

With an argument, use direct command mode. Without one, use the guided setup menu.

## Authoring contract

Ask (with `ask_question`, or plain text for free-form values) for any missing values:
1. `name`: lowercase letters/digits separated by single hyphens (`[a-z0-9]+(?:-[a-z0-9]+)*`).
2. `description`: what the skill does **and when to use it**, in the third person. This is the only text Antigravity shows the model before activation, so make the trigger conditions explicit.
3. `scope`: `project` or `user`.

Frontmatter (Antigravity reads `name` and `description`; omit `triggers`/`argument-hint`, which Codex used, and fold that information into the description instead):

```yaml
---
name: <name>
description: <what it does>. Use when <trigger conditions>.
---
```

Body shape:
```markdown
# <Skill title>

## Purpose
What durable, codebase-specific outcome this skill provides.

## When to Activate
Recognition signals, scope, and explicit non-goals.

## Workflow
1. Inspect the named files or inputs.
2. Apply the precise approach and record important assumptions.
3. Verify observable behavior and report evidence.

## Examples / Gotchas
Concrete invocation, edge cases, and failure recovery.
```

Progressive disclosure: keep `SKILL.md` concise. Put bulky reference material in `references/` and helper scripts in `scripts/`, and link to them relatively. Prefer hard-won, non-obvious knowledge over generic advice. Include exact paths, commands, error text, and expected evidence.

## Validation and errors

Before reporting success, check that the file exists, starts with `---` frontmatter, has a non-empty `name` and `description`, uses a valid name that matches its directory, and has a non-empty body. Reject malformed YAML, multiline required scalars, duplicate names in one scope, missing directories/files, permission failures, and invalid arguments.

```text
✗ Error: <clear message>
→ Suggestion: <specific next step>
```

## Exit contract

Every command ends with one concise result: `✓` plus the affected skill/path and next action, or `✗` plus the error and suggestion. New skills are picked up on the next conversation (a new skill directory may need an Antigravity restart).
