# Modernization Safety Ladder & Expand-Migrate-Contract Patterns

Reference playbook for `$modernize`. Follow this ladder whenever upgrading dependencies, runtimes, build toolchains, data schemas, or public SDKs across multi-file repositories.

## Pre-Flight Checklist & Risk Matrix

Before altering manifests or code, score every target module or package across blast radius, test coverage, and runtime reversibility:

| Risk Tier | Typical Scope | Mandatory Pre-Flight Gate | Rollback Mechanism |
|---|---|---|---|
| Low (Patch/Minor) | Single package minor bump, additive API | `dep-license-diff`, existing unit tests | Lockfile + manifest revert |
| Medium (Toolchain / Runtime) | Node/Python minor-to-major bump, test runner swap | `coverage-map`, CI matrix parity, characterization tests | Branch/commit revert + pinned runtime |
| High (Framework / ORM / Auth / DB) | Major framework jump, persistence driver, wire format | Full Expand-Migrate-Contract wave + `verifier` / `runtime-qa` | Feature flag or adapter fallback |
| Critical (Multi-Service Protocol) | Event schema, token format, public REST/gRPC breaking change | Dual-read/dual-write seam + staged cutover | Versioned endpoint + shadow rollback |

Key pre-flight checks:
1. Run `dep-license-diff` first so a transitive dependency bump never introduces an incompatible copyleft (`AGPL` / `GPL`) or unpinned (`*` / `latest`) package.
2. Run `coverage-map` to spot high-LOC modules lacking test coverage before touching them.
3. Flag and strengthen any zero-assertion test files before relying on them as safety nets.
4. Grep every dynamic import (`import(...)`), reflection call, serialization boundary, and environment variable key touched by target packages.
5. Check `.github/workflows` and `Dockerfile` base images early (`devops-engineer`) so local and CI runtimes match from Wave 1 onward.
6. Confirm downstream consumers of public SDKs or HTTP contracts using `explore` before selecting between an in-place bump and an Expand-Migrate-Contract seam.

## Wave Sequencing & Behavior Locks

Never combine mechanical syntax upgrades, behavioral refactors, and major dependency bumps in a single mixed commit or pass.

### Wave 0 — Lock Behavior First
1. Capture Golden inputs and outputs across every public boundary being touched:
   - CLI exit codes, stderr/stdout structure, and flag edge cases
   - HTTP status codes, JSON envelope shapes, and validation errors
   - Persisted database/state schemas and serialization defaults (`null` vs `undefined`, timestamps, encodings)
2. Replace zero-assertion smoke tests flagged by `coverage-map` with explicit invariant assertions.
3. Keep characterization tests black-box wherever possible so internal refactors inside Wave 2 do not break the safety harness.
4. Record the baseline test, build, and benchmark results before touching dependency versions.

### Wave 1 — Prepare Environment & Deprecations
1. Resolve non-breaking deprecation warnings on the OLD major version while tests remain green.
2. Update polyfills, TypeScript compiler options, linter configs, and CI version matrices before bumping major packages.
3. Lock deterministic dependency versions and commit/verify a clean lockfile baseline.

### Wave 2 — Incremental Codemod & Caller Migration
1. Run official automated codemods first in scoped directory batches or `--dry-run` previews.
2. Inspect generated diffs line by line rather than blind-applying across unrelated modules.
3. Fix shared wrapper helpers in one canonical location instead of duplicating compatibility shims across dozens of callers.
4. Verify `typecheck`, `lint`, `build`, and targeted tests after each vertical module slice before starting the next slice.

### Wave 3 — Remove Shims & Lock Parity
1. Confirm zero remaining callers import deprecated shims or legacy entrypoints (`grep` before deletion).
2. Remove temporary dual-write paths and dead compatibility helpers (`$ai-slop-cleaner` style minimal diff).
3. Run the full verification battery plus `docs-drift`, `floor-guard`, and `dep-license-diff`.

## Expand-Migrate-Contract Seams

When changing persistent state, APIs, config schemas, or inter-process contracts, NEVER perform an in-place breaking swap when callers or stored data could straddle versions:

1. **Expand (Additive Only)**:
   - Introduce new fields, endpoints, config keys, or storage columns alongside legacy equivalents.
   - Support reading EITHER old or new format during transition.
   - Enable dual-write cleanly when downstream readers or standby rollbacks lag behind writers.
   - Verify legacy consumers continue working with zero regressions before changing any caller.
2. **Migrate (Backfill & Switch Readers)**:
   - Backfill historical records idempotently in bounded batches; verify checksum or row-count parity.
   - Update internal callers incrementally to consume the new field or API.
   - Monitor error rates, latency deltas, timezone normalization, and case-sensitivity edge cases.
   - Keep any temporary fallback marked with `shortcut: <ceiling>, <when to remove>` so debt stays visible (`scan-debt`).
3. **Contract (Decommission Legacy)**:
   - Confirm zero read or write hits remain on legacy code paths across source and runtime probes.
   - Delete legacy adapters, deprecated schema columns, and old config keys cleanly.
   - Re-run characterization and negative boundary tests after final cleanup.

## Common Migration Pitfalls & Recovery Drills

Watch closely for subtle regressions that slip past compiling builds:

- **Silent behavioral shifts across major versions**:
  - Default HTTP client/server timeouts and keep-alive limits
  - Strict JSON / strict query-string / strict URL parsing changes
  - Changed empty-string or `null` handling in ORMs and serializers
  - ESM vs CJS resolution differences (`package.json` `exports` conditions and default imports)
  - Default TLS minimum versions or cookie `SameSite` defaults
- **Hidden `devDependency` or peer-dependency drift**:
  - Verify clean production installs (`--omit=dev`) and container builds when dependencies move between `dependencies` and `peerDependencies`.
- **Unpinned transitive security or license surprises**:
  - Run `dep-license-diff <repo> [baseRef] --json` after every lockfile regeneration to verify zero new copyleft (`AGPL`, standalone/`AND` `GPL`, `SSPL`) or unpinned specs.
- **Rollback Verification Drill**:
  - Before closing any multi-wave modernization, explicitly verify what reverting the latest wave requires:
    1. Manifest + lockfile restore path
    2. Down-migration idempotency (when database changes exist)
    3. Adapter or feature-flag switch recovery without data corruption
  - Document deferred major bumps and residual risks clearly in the closeout report.
