---
name: modernize
description: "[oh-my-agy] Phased codebase, dependency, framework, and runtime modernization workflow using behavior-lock baselines, license/coverage pre-flight checks, codemod waves, Expand-Migrate-Contract seams, and rollback checkpoints. Use for $modernize or when upgrading packages, frameworks, language versions, SDKs, or legacy modules end-to-end. Flags: --plan, --dry-run, --wave."
---

# Modernize

Execute controlled, reversible upgrades across dependencies, runtimes, frameworks, and legacy modules without breaking production behavior. Unlike `$ralplan --migrate` (which stops at planning a migration PRD), `$modernize` runs pre-flight dependency/coverage audits, locks existing behavior with regression tests, applies incremental codemod or adapter waves, and verifies every checkpoint before advancing.

## Usage

```text
$modernize "upgrade Node runtime, dependencies, or framework across target modules"
$modernize --plan "upgrade major ORM and router without writing code yet"
$modernize --wave 1 "bump core packages and lock characterization tests"
```

## Boundaries

- Load [references/modernization-safety-ladder.md](references/modernization-safety-ladder.md) before designing compatibility shims, dual-write seams, or multi-wave rollbacks.
- **Do NOT invent an upgrade plan blindly**: run pre-flight audits (`dep-license-diff`, `coverage-map`) and check upstream migration guides (`$deep-research --quick` via `researcher`) first.
- **Keep waves atomic and reversible**: complete characterization tests before editing syntax, API signatures, or lockfiles. Never squash an entire multi-major upgrade into one unverified rewrite.
- **Respect host parity**: avoid Antigravity-only scripts or host-locked assumptions when modernizing shared tooling.

## Pre-Flight Audit & Dependency Triage

Run read-only diagnostics from the plugin root (or `-C <target-repo>`) before installing or editing dependencies:

1. **Supply-chain & license check**: run `sh <plugin>/hooks/run.sh dep-license-diff <repo> --json` (or invoke `supply-chain-auditor`) to surface unpinned (`*`, `latest`), missing lockfiles, or strong copyleft (`AGPL`, standalone/`AND` `GPL`/`SSPL`) transitive additions.
2. **Test coverage & risk ranking**: run `sh <plugin>/hooks/run.sh coverage-map <repo> --json` to locate high-LOC/high-export modules lacking test coverage and flag zero-assertion test files before touching them.
3. **Deprecation & breaking-change research**: invoke `researcher` (or `explore` for internal callers via `grep`) to fetch official changelogs, minimum runtime versions, and removed APIs for each target package or SDK.
4. Inspect `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, lockfiles, and `.github/workflows` to align CI runtime matrices with the target version.

If `--plan` is set, stop after emitting the wave plan in `.omagy/plans/modernize-{slug}.md` and confirm scope with the user.

## Step-by-Step Wave Execution

Execute upgrades in strict sequence via `executor` (or directly in small bounded repos), verifying after every wave:

1. **Wave 0 — Behavior Lock Baseline**: add or harden characterization tests via `test-engineer` covering critical inputs, error paths, serialization formats, and public contracts of every un-tested target module reported by `coverage-map`. Establish a green baseline before changing dependency versions or code.
2. **Wave 1 — Safe Minor/Patch & Tooling Alignment**: apply non-breaking dependency bumps, type definitions, linter/compiler configs, and CI version-matrix updates first. Verify lockfile determinism (`dep-license-diff`) and baseline suite pass.
3. **Wave 2 — Expand-Migrate-Contract Seam (Breaking Major / API Upgrades)**:
   - **Expand**: introduce a compatibility adapter, dual-read/dual-write wrapper, or side-by-side schema column without removing legacy consumers.
   - **Migrate**: run targeted codemods or incremental module ports (`grep` every caller first so shared abstractions update coherently), verifying unit and integration checks per batch.
   - **Contract**: remove temporary adapters and deprecated shims ONLY once 100% of callers pass cleanly under the target version.
4. **Wave 3 — Docs, Environment & Runtime Parity**: run `sh <plugin>/hooks/run.sh docs-drift <repo> --json` and update `README.md`, setup guides, `.env.example` keys (never inspect `.env` secrets), and CI workflows (`devops-engineer` / `doc-steward`).

## Verification & Rollback Gates

Every wave requires fresh evidence before moving to the next wave:

- Targeted unit/integration suite, typecheck, lint, and build pass with exit code `0`.
- `sh <plugin>/hooks/run.sh dep-license-diff <repo> --json` confirms zero new copyleft/unpinned regressions.
- `sh <plugin>/hooks/run.sh floor-guard <repo> --json` reports `0` suppressed checkers, lost assertions, placeholder code, or hardcoded secrets.
- Record each wave's before/after baseline, changed manifests, rollback commit/patch strategy, and residual warnings (e.g. deferred major bumps) before claiming completion. For high-risk runtime shifts, invoke `runtime-qa` or `verifier` for independent verification.
