---
name: omagy-setup
description: "[oh-my-agy] Install, enable, update, or uninstall the oh-my-agy plugin for Antigravity in user or project scope, bootstrap a project AGENTS.md, and migrate legacy oh-my-codex (.omx) artifacts. Use for $omagy-setup, 'install oh-my-agy', or 'set up oh-my-agy in this repo'."
---

# oh-my-agy Setup

Replaces `omx setup`. Antigravity discovers plugins by directory, so setup consists of placing the plugin in a discovery root, enabling it, and preparing the workspace.

## 1. Choose scope (`ask_question`)
- **User (recommended)**: available in every workspace. Target: `~/.gemini/config/plugins/oh-my-agy`.
- **Project**: shared with the team via VCS. Target: `<repo>/.agents/plugins/oh-my-agy`.

## 2. Install
Resolve `SRC` (this plugin's directory, two levels up from this `SKILL.md`).
- Prefer keeping the **real directory** at the target and, if you want a working copy elsewhere, symlink that copy to the target (`ln -s "<target>" "<checkout>"`). A target that is itself a symlink into `~/Documents`, `~/Desktop`, or `~/Downloads` is unreadable from Antigravity's sandboxed terminal on macOS.
- Copy with `cp -R "<SRC>" "<target>"`. Antigravity's file tools and hook runner load the plugin regardless of the terminal sandbox. Shell-based checks (`selftest`) may need `BypassSandbox: true`.
- Check the target first: canonicalize the parent scope root (`realpath`, e.g. macOS `/var` -> `/private/var`) and inspect the target with `ls -ld`. Refuse dangling symlinks or symlinked `.omagy/state` / `.gitignore` destinations that point outside the repository (ported from OMX 0.21.31–0.21.32). If a valid target exists, ask before replacing it, and never delete a non-oh-my-agy directory.
- Writing under `~/.gemini/config` is outside the workspace sandbox, so run that one command with `BypassSandbox: true` (the user approves it).
- Make the hook scripts executable: `chmod +x <target>/hooks/run.sh <target>/hooks/omagy-hook.mjs`.

## 3. Enable and restart
- A newly added plugin **directory is discovered only at startup**. Ask the user to restart Antigravity.
- Plugins are enabled by default. If the user previously disabled it, re-enable it via the built-in `plugin` skill flow (language-server `JetboxWriteState`). Do not hand-edit `~/.gemini/config/config.json`.
- After restart, verify with `$doctor`.

## 4. Prepare the workspace (project-level, optional)
- Add `.omagy/` to `.gitignore` (append only if missing).
- Optionally create `omagy_wiki/` on the first `$wiki` use (not now).
- **AGENTS.md bootstrap** (replaces `omx agents-init`): when the user wants it, create or extend a lightweight root `AGENTS.md` describing the project (purpose, layout, build/test/lint commands, conventions, and do/don't rules) from real repo evidence. Antigravity loads `AGENTS.md`/`GEMINI.md` hierarchically. Never overwrite an existing file. Merge into a clearly marked section instead.

## 5. Migrate from oh-my-codex (optional)
If `.omx/` exists, offer to copy reusable artifacts:
`.omx/context -> .omagy/context`, `.omx/specs -> .omagy/specs`, `.omx/plans -> .omagy/plans`, `.omx/interviews -> .omagy/interviews`, `.omx/ultragoal -> .omagy/ultragoal`, and `omx_wiki -> omagy_wiki`.
Do not migrate `.omx/state/` (runtime-specific). Leave the originals in place.

## 6. Optional extras
- Notifications: `$configure-notifications`.
- Planning write guard: in `hooks.json`, set `"enabled": true` on `oh-my-agy-planning-guard` to force a confirmation for implementation writes during deep-interview/ralplan/plan.
- MCP: oh-my-codex's `omx mcp-serve` servers are not used. oh-my-agy keeps state in plain files. If the `omx` CLI is installed and you want its code-intel/trace servers, add them to `~/.gemini/config/mcp_config.json` manually.

## Update / uninstall
- Update: pull or replace the source directory (symlink installs update in place), then restart.
- Uninstall: remove the plugin directory (or use the `plugin` skill's `DeletePlugin`). Workspace `.omagy/` and `omagy_wiki/` stay unless the user asks to purge them.

## Exit evidence
Report scope, target path (and whether it is a symlink), executable bits, gitignore change, migrated paths, and the restart requirement. Run `$doctor` after the restart.
