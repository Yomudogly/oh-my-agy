---
name: skill
description: "[oh-my-agy] Author, scaffold, validate, and manage Antigravity skills: list, init, add, edit, remove, search, info, sync, setup, scan, validate, test, eval, and extract SKILL.md folders across project, shared (.agents/skills.json), and user scopes with progressive-disclosure references/ and scripts/ bundles. Use for $skill <command> or when creating, scaffolding, validating, sharing, or capturing a repeatable workflow as a SKILL.md skill."
---

# Skill Authoring & Management

Create, scaffold, validate, evaluate, and maintain self-contained Antigravity `SKILL.md` directories with `$skill`.

<Purpose>
Deliver concise, high-signal, deterministic skills across project, VCS-shared, and user scopes without context bloat, auxiliary clutter, or fragile ad-hoc instructions.
</Purpose>

<Use_When>
- The user invokes `$skill` or asks to list, initialize (`init`), add, edit, remove, search, inspect (`info`), sync, set up, scan, validate, pressure-test (`test`), evaluate (`eval`), or extract skills.
- A repeatable, codebase-specific workflow or domain playbook should be packaged as a `SKILL.md` folder with optional `scripts/`, `references/`, `assets/`, or `resources/`.
- A team wants to share repository skills via Antigravity's `.agents/skills.json` manifest (`entries` and `inherits`).
</Use_When>

<Do_Not_Use_When>
- Bundling skills together with hooks, subagents, rules, and sidecars as an installable plugin: use Antigravity's built-in `plugin` skill.
- Saving a one-line user preference or session correction: suggest the `/learn` slash command or `omagy_wiki/agreements.md`.
- Diagnosing broken plugin hooks, Node runtime health, or stale `.omagy/state/` files: use `$doctor`.
</Do_Not_Use_When>

## Scopes, Discovery Priority, and Team Sharing (`.agents/skills.json`)

Every skill is a directory `<root>/<name>/` whose entrypoint is `SKILL.md`:

- **project**: `.agents/skills/<name>/SKILL.md` at the repository root (`.agent/`, `_agents/`, and `_agent/` are also recognized by Antigravity).
- **shared (declared via VCS)**: `tools/agents/skills/<name>/SKILL.md` (or another repo folder) registered in `.agents/skills.json` using top-level `entries` and `inherits` arrays (`{ "path": "tools/agents/skills", "include_only": ["^release-"], "exclude": ["^wip-"] }`).
- **user**: `~/.gemini/config/skills/<name>/SKILL.md` (overridable in CLI tests via `OMAGY_USER_SKILLS_DIR`).
- **plugin** (read-only by default): `<plugin>/skills/<name>/SKILL.md`. Modify plugin skills only when the user explicitly targets the plugin repository.

**Collision priority**: `project > declared (.agents/skills.json) > user (global) > built-in`. Always warn before creating or syncing a skill whose `name` shadows another active scope.

## Command Contract

| Command | Deterministic Contract |
|---|---|
| `$skill list` | Scan project, declared `.agents/skills.json`, and user roots (plus plugins read-only), parse frontmatter, and report `name`, `scope`, byte size, and path. |
| `$skill init <name>` | Scaffold an SDO-compliant skill folder via `sh <plugin>/hooks/run.sh skill-init <name> [--scope project\|shared\|user] [--dir <parent>] [--resources references,scripts,assets,resources] [--description <text>] [--force] --json` and verify immediately with `--strict` validation. |
| `$skill add [name]` | Run the 6-step authoring workflow: gather concrete trigger examples, triage resources, scaffold via `skill-init`, author `SKILL.md`, and pass `skill-validate --strict`. |
| `$skill edit <name>` | Locate the target skill, inspect its current frontmatter and resource budget, apply focused edits, and re-run `skill-validate --strict`. |
| `$skill remove <name>` | Show scope, metadata, and bundled files, confirm deletion via `ask_question`, and remove only the confirmed skill directory. |
| `$skill search <query>` | Case-insensitive search across `name`, `description`, and body; rank metadata matches ahead of body matches. |
| `$skill info <name>` | Show parsed metadata, scope, byte size, bundled resource inventory, and `SKILL.md` summary; suggest `$skill search` if missing. |
| `$skill sync` | Diff `user` vs `project` / `shared` skills (`only-left`, `only-right`, `diverged`), exclude caches, and confirm every copy or overwrite. |
| `$skill setup` | Ensure target skill roots exist, run an inventory scan, and offer guided `init`/`add`, `validate`, `sync`, or exit. |
| `$skill scan` | Non-interactive inventory + structural summary across project, declared `.agents/skills.json`, and user skill roots. |
| `$skill validate [path]` | Run `sh <plugin>/hooks/run.sh skill-validate [skillDir\|collectionDir\|.agents/skills.json] --strict --json` to enforce frontmatter, byte ceilings, SDO triggers, 1-level links, anti-clutter, symlink containment, and manifest schema without mutating files. |
| `$skill test <name>` | Execute the blind 3-pressure subagent behavioral loop (`RED` baseline vs `GREEN` compliance + 5-rep micro-tests) in [testing-and-sdo.md](./references/testing-and-sdo.md#5-subagent-pressure-testing-skill-test), writing `.omagy/artifacts/skill-test-<name>-<UTC>.md`. |
| `$skill eval` | Run deterministic TF-IDF routing, cosine-collision (`>= 0.75` error), and negative owner-survival checks via `sh <plugin>/hooks/run.sh skill-eval --min-rank1 95 --json` ([testing-and-sdo.md](./references/testing-and-sdo.md#corpus-routing-evaluation-skill-eval)). |
| `$skill extract [name]` | Distill a repeatable workflow proven across `>= 2` concrete runs into a sanitized `SKILL.md` (`<= 19,000` B, zero secrets or personal paths) and validate with `skill-validate --strict`. |

With an explicit subcommand, execute directly; with bare `$skill`, present the guided setup menu.

## 3-Level Progressive Disclosure & 3-Bucket Resource Triage

Skills share the context window with conversation history, rules, and workspace files. Partition every skill across three loading tiers:

1. **Level 1 — YAML Metadata (`name` + `description`, ~100 words, always loaded)**:
   - `name`: kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$` (`1..64` chars) matching the parent folder name.
   - `description`: `50..1,024` chars in the third person stating **what the skill does** and **explicit trigger conditions** (`Use when...`, `Use for...`, `Triggers on...`).
   - **Critical Routing Rule**: Antigravity exposes **only** `name` and `description` prior to skill activation. Trigger conditions placed solely in body sections (`## When to Use`) are invisible during skill selection.
   - **SDO Workflow-Summary Guard**: never put `->` step-chain arrows or full step recipes in `description` (models skip reading `SKILL.md` when `description` summarizes the steps), and never include HTML/XML tags or unbalanced `<`/`>` (balanced CLI metavariables like `<command>` or `<slug>` are allowed).
2. **Level 2 — `SKILL.md` Body (`<= 19,000 B` warning / `< 20,000 B` hard ceiling, `<= 500` lines, loaded on activation)**:
   - Imperative workflow steps, decision trees, command tables, and links to Level 3 files.
3. **Level 3 — Bundled Resources (loaded or executed strictly on demand)**:
   - `scripts/*`: deterministic Node/POSIX scripts executed via shell (`node ./scripts/run.mjs`) for fragile validation, parsing, or transformations without spending tokens reading code into context.
   - `references/*.md`: deep domain schemas, rubrics, and edge-case catalogs (`< 40,000 B` each). Keep `references/` **strictly 1 level deep** from `SKILL.md` (never nest `references/sub/doc.md`), and include a top Table of Contents (`>= 2` `##` ATX headings) in every reference file over `100` lines.
   - `assets/*` and `resources/*`: boilerplate files, templates, or static assets copied or filled into outputs without loading into context.

## Degrees-of-Freedom Calibration

Match instruction specificity to task fragility rather than writing uniform prose:

| Freedom Tier | When to Choose | Authoring Pattern |
|---|---|---|
| **High Freedom** (heuristics & principles) | Multiple valid designs exist and the right choice depends on live codebase signals (e.g., architectural tradeoff reviews, code cleanup passes). | Concise principles, ranked priorities, and stop conditions; avoid rigid boilerplate that fights local conventions. |
| **Medium Freedom** (parameterized templates & conditional workflows) | A preferred structure or branching workflow exists, with bounded adaptation to project specifics (e.g., PR assembly, conditional create-vs-update flows). | Explicit decision tree (`If creating -> follow Path A; if auditing -> follow Path B`) plus strict or flexible output templates ([testing-and-sdo.md](./references/testing-and-sdo.md#4-degrees-of-freedom-conditional-workflows-and-output-patterns)). |
| **Low Freedom** (exact CLI / `scripts/*` commands, zero freelancing) | Operations are fragile, stateful, or security-sensitive where small deviations corrupt state or bypass gates (e.g., `skill-validate --strict`, manifest schema validation, hash receipts). | Exact copy-pasteable commands, deterministic flags, expected exit codes (`0\|1\|2`), and fail-closed error handling. |

## Anti-Clutter & Context-Economy Rules

- **Default assumption**: the model is already capable of general software engineering. Challenge every sentence: *"Does this add domain-specific constraints, non-obvious procedures, or project invariants the model cannot infer?"* Prefer one concrete input/output example over verbose exposition.
- **Zero auxiliary clutter**: never place `README.md`, `CHANGELOG.md`, `INSTALLATION_GUIDE.md`, `QUICK_REFERENCE.md`, `CREATION-LOG.md`, `test-*.md`, `example.py`, unresolved `` `TODO:` `` markers, `__pycache__/`, or `.skill` zip archives inside a skill directory (`skill-validate` fails closed on all of them).
- **Write the Procedure, Not the Workaround**: capture portable invariants and deterministic CLI checks rather than machine-specific hacks or 5-step ad-hoc grep chains ([testing-and-sdo.md](./references/testing-and-sdo.md#write-the-procedure-not-the-workaround)).
- **Rejected-Change Impact Ledger**: when trimming or consolidating an existing skill, record pruned rules, replacement coverage, and verification gates per [testing-and-sdo.md](./references/testing-and-sdo.md#rejected-change-impact-ledger).

## 6-Step Skill Authoring Lifecycle (`$skill init` / `$skill add` / `$skill edit`)

1. **Gather Concrete Trigger & Near-Miss Examples**:
   - Collect `3–4` concrete user prompts that must trigger the skill plus `2` near-miss prompts that belong to sibling skills. Confirm scope (`project`, `shared`, or `user`) via `ask_question` only when not already specified.
2. **Triage Reusable Contents into `scripts/`, `references/`, and `assets/`**:
   - Ask what an agent executing those examples repeatedly would otherwise rewrite or rediscover each run: deterministic code belongs in `scripts/`, detailed reference docs (`> 100` lines with TOC) belong 1-level deep in `references/`, and output boilerplates belong in `assets/` or `resources/`. Leave unneeded subdirectories uncreated.
3. **Scaffold Cleanly with `skill-init`**:
   ```sh
   sh <plugin>/hooks/run.sh skill-init <skill-name> --scope project --resources references,scripts --json
   ```
   - Use `--scope shared` to scaffold under `tools/agents/skills/<skill-name>/` and idempotently register `{ "path": "tools/agents/skills" }` in `.agents/skills.json` (`entries`). `skill-init` refuses to overwrite non-empty folders unless `--force` is passed.
4. **Author SDO Frontmatter, Conditional Workflow, and Output Pattern**:
   - Keep YAML frontmatter lean (`name` and `description`; optional `license`, `allowed-tools`, `metadata`, `compatibility` when required).
   - Structure `SKILL.md` with imperative verbs, explicit conditional branches when the skill handles multiple modes, and either a strict output template (for compliance/API contracts) or a flexible template + input/output examples ([testing-and-sdo.md](./references/testing-and-sdo.md#4-degrees-of-freedom-conditional-workflows-and-output-patterns)).
5. **Run Deterministic Structural & Routing Validation**:
   ```sh
   sh <plugin>/hooks/run.sh skill-validate <skill-dir-or-.agents/skills.json> --strict --json
   ```
   - Fix every reported error or `--strict` warning (`>= 20,000 B` hard / `> 19,000 B` strict warning, `references/*.md >= 40,000 B`, nested `references/`, broken `.md#anchor` or `scripts/*` links, `\` backslashes, `->` or HTML tags in `description`, banned clutter, invalid `.agents/skills.json` regexes, or symlink escapes). When editing plugin skills, also run `sh <plugin>/hooks/run.sh skill-eval --min-rank1 95 --json`.
6. **Iterate from Real Execution Evidence**:
   - Exercise the skill on real tasks (or run `$skill test <name>` for gate/discipline skills). Observe where the agent hesitates, over-reads, or rationalizes a shortcut, then tighten `description`, move bulky tables to `references/`, or extract repeated shell logic into `scripts/`.

## Extracting Reusable Skills (`$skill extract [name]`)

1. **Repeatability Gate (`>= 2` verified runs)**: extract only workflows proven across `>= 2` real tasks that are (a) non-trivial beyond baseline model recall, (b) repeatable across future sessions, and (c) grounded in verified execution evidence.
2. **Sanitize & Genericize**: strip secrets/tokens, internal hostnames, and personal OS home paths (`/<Users-or-home>/<username>/...`), replacing them with `<workspace>`, `<plugin>`, or `$HOME`.
3. **Budget & Link Hygiene**: keep `SKILL.md <= 19,000` bytes (`< 20,000` B hard cap), use brace notation `.omagy/{artifacts,plans,specs}` when documenting workflow artifact paths, and verify with `skill-validate --strict`.

## Symlink Containment & Sync Hygiene

- **Canonical containment**: `skill-validate` inspects every path segment with `fs.lstatSync` and `fs.realpathSync`, rejecting dangling symlinks and any symlink escaping the canonical skill directory (in multi-skill collections, bounded `../<sibling>/...` links are allowed only when `<parent>/<sibling>/SKILL.md` exists inside the same canonical collection root).
- **Cache exclusion**: never write bytecode or tool caches into skill folders (`PYTHONDONTWRITEBYTECODE=1`), and exclude `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.mypy_cache/`, `.DS_Store`, `Thumbs.db`, and `*.pyc` during `$skill sync`.

```text
✗ Error: <exact diagnostic code and path>
→ Suggestion: <concrete remediation command or edit>
```

## Exit Contract

End every `$skill` operation with one concise line: `✓` + affected skill path, scope, byte size, and `skill-validate --strict` result, or `✗` + exact error code and remediation step. Newly scaffolded skill directories take effect on the next conversation (or after reloading skills in Antigravity).
