# Plugin Setup, Lifecycle & Hierarchical AGENTS.md Bootstrap (`$doctor --setup` / `--init-deep`)

Reference guide for [`skills/doctor/SKILL.md`](../SKILL.md). Antigravity discovers plugins by directory, so setup places `oh-my-agy` in a discovery root, ensures executable permissions, and prepares workspace rules and `.gitignore`.

## 1. Choose Scope (`ask_question`)

- **User (`Recommended`)**: available in every workspace. Target: `~/.gemini/config/plugins/oh-my-agy`.
- **Project**: shared with the team via VCS. Target: `<repo>/.agents/plugins/oh-my-agy`.

## 2. Install & Symlink-Safe Copy

Resolve `SRC` (this plugin's directory, two levels up from `skills/doctor/SKILL.md`).
- Prefer keeping the **real directory** at the target and, if you want a working checkout elsewhere, symlink that checkout to the target (`ln -s "<target>" "<checkout>"`). On macOS, a target that is itself a symlink into `~/Documents`, `~/Desktop`, or `~/Downloads` is unreadable from Antigravity's sandboxed terminal.
- Inspect the target first: canonicalize the parent scope root (`realpath`, e.g. macOS `/var` to `/private/var`) and run `ls -ld`. Refuse dangling symlinks or symlinked `.omagy/state` / `.gitignore` destinations pointing outside the repository. If a valid target already exists, ask before replacing it, and never delete a non-`oh-my-agy` directory.
- **Symlink-safe copy**: before copying plugin files into an existing target, remove any existing or dangling symlinks at the destination (`[ -L "<target>" ] && rm -f "<target>"`, and if `<target>/hooks` exists, `find "<target>/hooks" -type l -exec rm -f {} +`) so `cp -R "<SRC>" "<target>"` never fails with `ENOENT` on a broken symlink or writes through a live symlink into an external path.
- Copy with `cp -R "<SRC>" "<target>"`. Writing under `~/.gemini/config` is outside the workspace sandbox, so run only that copy/chmod step with `BypassSandbox: true` (user-approved).
- Ensure hook and HUD sidecar scripts are executable:
  ```bash
  chmod +x "<target>/hooks/run.sh" "<target>/hooks/omagy-hook.mjs" "<target>/sidecars/hud/run.sh" "<target>/sidecars/hud/main.mjs"
  ```

## 3. Enable & Restart

- A newly added plugin **directory is discovered only at startup**. Ask the user to restart Antigravity.
- Plugins are enabled by default. If the user previously disabled `oh-my-agy`, re-enable it via the built-in `plugin` skill flow (language-server `JetboxWriteState` keyed on `<dir>`, the install directory name `(.path | split("/") | last)`, never `plugin.json`'s `name`) or link `[oh-my-agy](customization://oh-my-agy)` (never `plugin://`). Do not hand-edit `~/.gemini/config/config.json`.
- After restart, run `$doctor` to verify health and offer `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` to open the Auxiliary Pane status board.

## 4. Workspace Preparation & `AGENTS.md` Bootstrap (`--setup` / `--init-deep`)

- **Gitignore**: append `.omagy/` to `.gitignore` if missing (`omagy_wiki/` is created lazily on the first `$wiki` operation, not during setup).
- **Root `AGENTS.md` bootstrap (`--setup`)**: when requested, create or extend a concise root `AGENTS.md` from real repository evidence (purpose, directory layout, build/test/lint commands, conventions, and do/don't rules). Antigravity loads `AGENTS.md` and `GEMINI.md` hierarchically. Never overwrite an existing file — merge into a clearly marked section instead.
- **Hierarchical subdirectory `AGENTS.md` (`--init-deep`)**: for monorepos or multi-package workspaces, scan candidate package/module directories (`sh "<PLUGIN_DIR>/hooks/run.sh" init-deep-scan "<workspace>" --json` when available, or repo file-density + git-churn inspection) to propose bounded subdirectory `AGENTS.md` files for high-density boundaries. Confirm target paths with the user before writing, keep each file concise and package-specific, and never overwrite human-authored sections.
- **Optional extras**:
  - Stop/idle notifications: see [notifications.md](./notifications.md) (`$doctor --notifications`).
  - Planning write guard: in `hooks.json`, set `"enabled": true` on `oh-my-agy-planning-guard` to require confirmation before source writes while `deep-interview`, `ralplan`, or `plan` state is active.

## 5. Update, Uninstall & Exit Evidence

- **Update**: pull or replace the plugin directory (symlinked checkouts update in place), re-verify executable bits, and restart Antigravity.
- **Uninstall**: remove the plugin directory (or use the `plugin` skill's `DeletePlugin` keyed on `<dir>`; if the plugin is currently disabled, set `"enabled": true` via `JetboxWriteState` first so `~/.gemini/config/config.json` does not retain a stale disabled entry on reinstall). Leave workspace `.omagy/` and `omagy_wiki/` intact unless the user explicitly asks to purge them.
- **Exit evidence**: report chosen scope, target path (and whether it is a symlink), executable bits, `.gitignore` / `AGENTS.md` changes, and the restart requirement.
