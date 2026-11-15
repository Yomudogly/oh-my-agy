---
name: release
description: "[oh-my-agy] End-to-end release engineering workflow covering pre-release quality gates, SemVer bump classification, CHANGELOG and manifest synchronization, dry-run packaging validation, rollout/rollback playbooks, and tag or registry confirmation gates. Use for $release or when preparing a versioned release, release notes, or production rollout."
---

# Release

Prepare, verify, and stage a versioned software release cleanly. Unlike `$pr` (which summarizes branch changes for a pull request review), `$release` validates cross-repo release readiness, computes SemVer impact, synchronizes version manifests and release notes (`CHANGELOG.md`), executes dry-run packaging (`--dry-run`) checks, and assembles an explicit go/no-go release checklist before any irreversible git tag or package publish runs.

## Usage

```text
$release "0.7.0"
$release --check "validate release readiness without modifying manifests"
$release --dry-run "prepare bump, changelog, and dry-run bundle validation"
```

## Boundaries

- Consult [references/rollout-and-compliance.md](references/rollout-and-compliance.md) before classifying breaking changes, publishing artifacts, or staging canary rollbacks.
- **Confirmation gate for irreversible actions**: never execute `git tag`, `git push`, GitHub release creation, or a live `npm publish` without explicit user approval in the active turn (avoid running live `npm publish` cleanly by validating `--dry-run` first).
- **Zero unverified greenwashing**: never bump version manifests or `CHANGELOG.md` until tests, license checks, doc parity, and floor guards pass cleanly.
- **No fabricated release metrics or unverified diffs**: every item in `CHANGELOG.md` must come from observed commits, diffs, or verified artifact outputs in the current workspace.

## Pre-Release Readiness Gate

Run read-only readiness checks in order (delegate to `devops-engineer`, `doc-steward`, or `supply-chain-auditor` for parallel audit/fixes):

1. **Git hygiene & clean diff**: verify working tree expectations (`git status --short`), ensure zero untracked temp debris, and run `sh <plugin>/hooks/run.sh floor-guard <repo> --json` (`total: 0`, zero secrets, disabled tests, or unresolved blockers).
2. **Test, lint, syntax & host parity suite**: run full repo tests, POSIX `sh -n` syntax checks on launchers, CI build scripts, and host validation (`skill-validate --strict`, `host-validate --strict` when shipping plugins).
3. **Supply-chain & license compliance**: run `sh <plugin>/hooks/run.sh dep-license-diff <repo> [lastTag] --json` and `sh <plugin>/hooks/run.sh mcp-audit <repo> --json` to confirm zero new strong-copyleft, unpinned, or credential issues.
4. **Documentation & env drift**: run `sh <plugin>/hooks/run.sh docs-drift <repo> --json` and `sh <plugin>/hooks/run.sh wiki-lint <wiki> --json` (where applicable) so README commands, links, and `.env.example` keys match code.

If `--check` is set, stop here with a structured Pass/Fail readiness scorecard.

## SemVer, Manifest & Changelog Synchronization

1. **Determine SemVer Bump**:
   - `MAJOR`: breaking CLI/API/config removals or incompatible data/schema shifts without backward compatibility.
   - `MINOR`: backward-compatible features, new skills/agents/commands, additive flags, or non-breaking improvements.
   - `PATCH`: bug fixes, security patches, doc updates, or internal test/CI hardening.
2. **Inspect Changes Since Last Tag**: collect `git log <lastTag>..HEAD --oneline` (or diff summary) and group verified entries cleanly into `Added`, `Changed`, `Fixed`, `Security`, and `Verification`.
3. **Sync Version Across All Declared Sources**: update every manifest that declares the version (e.g., `plugin.json`, `package.json`, `pyproject.toml`, fallback version strings, `README.md` headers, and top `## [X.Y.Z] - YYYY-MM-DD` heading in `CHANGELOG.md`) atomically.
4. **Enforce Release Hygiene**: confirm zero personal home paths (`/Users/...`), zero unapproved external attribution leaks, and exact schema constraints on manifests (e.g., `plugin.json` description length and key set).

## Dry-Run Packaging & Rollout Go/No-Go Handoff

1. Run dry-run artifact packaging cleanly (`npm publish --dry-run`, `tar`/`zip` tarball inspection, or isolated temp-dir host bundle install + strict validation) and verify file permissions, entrypoint paths, and omitted dev/state directories (`.omagy/`).
2. Document the rollout and rollback plan (`references/rollout-and-compliance.md`): canary verification commands, health/smoke probes (`runtime-qa`), and exact revert procedure (`git revert` / deprecate version / hotfix).
3. Present the verified Go/No-Go scorecard, exact pending manual/confirmed release commands (tag, release notes, optional publish), and wait for explicit user authorization before executing any external publish or push.
