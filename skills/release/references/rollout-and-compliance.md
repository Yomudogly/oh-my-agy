# Release Compliance, Rollout & Rollback Reference

Companion reference for `$release` and `devops-engineer`. Standardizes SemVer decisions, dry-run validation, phased rollout gates, and post-release incident rollback procedures.

## SemVer Classification Rules & Manifest Parity

Evaluate every user-visible or downstream contract touched since the previous tagged release:

| Surface | Breaking (`MAJOR`) | Additive (`MINOR`) | Internal / Fix (`PATCH`) |
|---|---|---|---|
| CLI & Hook Events | Removing/renaming existing command, flipping required exit codes | Adding new subcommands/flags with unchanged defaults | Fixing edge-case parsing bugs without altering valid behavior |
| Config & State Schemas | Removing required keys or rejecting previously valid configs | Adding optional keys with backward-compatible defaults | Clarifying schema comments or validation diagnostics |
| Programmatic Exports | Removing/renaming exported symbols or narrowing accepted params | Exporting new helpers while keeping existing signatures intact | Internal performance optimization or bug fix |
| Dependencies & Runtime | Dropping supported runtime minor/major versions cleanly | Bumping minimum patch/minor tooling inside existing range | Updating lockfile patches with identical runtime floor |

Checklist for manifest sync before cutting any release:
1. Verify primary manifest version (`plugin.json`, `package.json`, `Cargo.toml`, `pyproject.toml`) matches the top heading `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`.
2. Grep the codebase for hardcoded version strings or fallback literals (`0.x.y`) so CLI `--version`, host bundles, and HUD snapshots report the identical release version.
3. Verify manifest constraints (e.g., `plugin.json` strict JSON, exact 10 top-level keys, `description <= 160` characters).
4. Confirm `.gitignore` / bundle exclusions omit local `.omagy/` scratch state, test artifacts, and environment files (never inspect `.env` secrets).
5. Run `sh <plugin>/hooks/run.sh docs-drift <repo> --json` and `wiki-lint` to ensure README/guide docs match the release surface cleanly.

## Dry-Run Artifact & Bundle Inspection

Before tagging or uploading any release artifact, run non-mutating validation across the exact layout users will consume:

1. **Package & Archive File Audit**:
   - Avoid executing live `npm publish` or pushing tags during automated verification; always validate via `npm publish --dry-run` or `tar -tvf` / `unzip -l` first.
   - Never trigger destructive `git reset` commands when cleaning up staging directories.
   - Confirm only intended runtime files, skills, agents, docs, and assets appear in the artifact manifest.
   - Verify execute permissions (`+x`) on all shipped shell entrypoints (`hooks/run.sh`, `sidecars/hud/run.sh`, CLI bin scripts) and validate pure POSIX syntax with `sh -n`.
2. **Clean-Room Install Smoke Test**:
   - Stage or install generated bundles into an isolated `/tmp` directory outside the repository working tree.
   - Run hook selftests from `/tmp`, CLI `--help`/`--version` smoke checks, and strict host validation (`host-setup` + `host-validate <host> --strict`) for every supported host (`claude`, `codex`).
   - Confirm zero leaked host-specific prose or local `/Users/` home paths appear in generated bundles.

## Staged Rollout & Canary Checkpoints

For services, CLIs, or multi-host plugins, structure rollout into observable stages rather than unmonitored all-at-once cuts:

1. **Canary / Pre-Release Verification (`t = 0`)**:
   - Stage to a prerelease tag (`vX.Y.Z-rc.1`), canary channel, or isolated staging environment first when production blast radius is high.
   - Invoke `runtime-qa` to run black-box probes covering startup, health checks, exit codes, backward-compatible config loading, and graceful error handling.
2. **Progressive Traffic / Channel Ramp**:
   - Verify error budgets, latency p95/p99, unhandled-rejection logs, and schema read/write parity at each ramp increment.
   - Pause promotion immediately if canary telemetry regresses relative to the prior release baseline.
3. **Post-Release Verification**:
   - Confirm tagged source matches the verified `HEAD` commit SHA and CI workflow run passed cleanly (`contents: read` least-privilege checks green).
   - Verify published install commands and documentation links resolve cleanly.

## Emergency Rollback Protocol

Keep a pre-tested rollback plan documented BEFORE executing any release tag, push, or publish step:

- **Package Registries**:
  - Prefer publishing a tested hotfix patch or marking broken releases deprecated with an explicit upgrade note instead of deleting immutable registry versions.
  - Ensure prior lockfile pins continue resolving cleanly for downstream users rolling back.
- **Services & Containers**:
  - Keep the previous immutable container digest or release SHA immediately re-deployable.
  - Require Expand-Migrate-Contract discipline on database/state changes so rolling back application binaries does not corrupt schema reads or writes.
- **Git & Release Notes**:
  - Keep existing public tags immutable; supersede broken releases with a clearly annotated patch note citing root cause and mitigation commit SHA.
  - Require explicit user confirmation in the active session before running any `git tag`, `git push`, GitHub release API call, or registry publication.
