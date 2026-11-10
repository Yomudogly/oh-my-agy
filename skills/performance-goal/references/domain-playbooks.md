# Performance Domain Playbooks

Lazy-loaded domain reference for `$performance-goal` optimization loops across web/frontend, relational databases, connection pools, and application/edge caches.

## 1. Core Web Vitals Field vs Lab Metric-Honesty Rule

Distinguish real-user **Field** telemetry from synthetic **Lab** runs before stating baselines or completion claims:

- **Field (`CrUX` / RUM 75th-percentile targets)**:
  - **LCP (Largest Contentful Paint)**: Good `<= 2.5s` | Needs Improvement `2.5s–4.0s` | Poor `> 4.0s`
  - **INP (Interaction to Next Paint)**: Good `<= 200ms` | Needs Improvement `200ms–500ms` | Poor `> 500ms`
  - **CLS (Cumulative Layout Shift)**: Good `<= 0.1` | Needs Improvement `0.1–0.25` | Poor `> 0.25`
- **Lab (`Lighthouse` / DevTools / Playwright trace)**: deterministic synthetic proxy for isolating render-blocking CSS/JS, unprioritized hero fetches (`fetchpriority="high"`), main-thread long tasks (`> 50ms`), and unsized media layout shifts, but **cannot observe real-user INP interaction variety, post-scroll CLS, warm/cold cache distributions, or low-end mobile CPU thermal variance**.
- **Metric-Honesty Rule**: never claim real-user Core Web Vitals (`CrUX` p75) improvement from synthetic `Lighthouse` or local Lab benchmarks alone. Label synthetic runs explicitly as `measured (synthetic lab proxy)` and require `CrUX` / RUM `web-vitals` p75 field data (or state an explicit field-validation gap) before claiming production CWV wins.

## 2. Database Query Tuning and EXPLAIN ANALYZE BUFFERS

Inspect real execution plans with `EXPLAIN (ANALYZE, BUFFERS)` (wrapped inside `BEGIN; EXPLAIN (ANALYZE, BUFFERS) ...; ROLLBACK;` for `INSERT`/`UPDATE`/`DELETE`) rather than planner cost estimates alone:

| `EXPLAIN (ANALYZE, BUFFERS)` Signal | Red-Flag Symptom | Root-Cause Fix |
|---|---|---|
| **`Seq Scan` & Filter Discard Ratio** (`Rows Removed by Filter` `>>` `actual rows`) | Scanning wide tables only to discard most rows; high CPU + buffer churn | Add a composite, partial, or covering index ordered by equality columns first, then range/sort predicates (`CREATE INDEX CONCURRENTLY`). |
| **Row-Estimate Skew (`rows=` vs `actual rows=`)** | Planner misestimates cardinality by `>= 10x`, choosing `Nested Loop` explosion over `Hash Join` | Refresh `ANALYZE`, create multivariate `CREATE STATISTICS` on correlated columns, and rewrite non-sargable wrappers (`DATE(created_at)` -> half-open timestamp range). |
| **`Buffers: shared read` & `temp read/written`** | Cold I/O (`shared read` dominating `shared hit`) or disk sort/hash spill (`temp written > 0`) | Trim `SELECT *` to index-only `INCLUDE (...)` projections, replace deep `OFFSET` with keyset `(created_at, id) < ($1, $2)` pagination, or scope `SET LOCAL work_mem` per heavy report transaction. |

## 3. Connection Pool Sizing Math

Enforce the cluster-wide database connection ceiling across every replica, background worker, and migration runner:

```text
instances * pool_max < max_connections - reserved
```

- Reserve `reserved` (`>= 15` slots or `15–20%` of `max_connections`) for superuser diagnostics, replication, backups, and online DDL migrations.
- Keep direct database active concurrency close to `((cpu_cores * 2) + effective_io_spindles)` across the cluster; when horizontal autoscaling or serverless fan-out requires `instances * pool_max` above that ceiling, route traffic through a transaction-mode pooler (`PgBouncer`, `Supavisor`, `RDS Proxy`) and avoid session-pinned state (`SET` without `LOCAL`, session advisory locks, unconfigured prepared statements).
- Configure bounded `connectionTimeoutMillis`, `idleTimeoutMillis`, and server `statement_timeout` / `lock_timeout` so pool saturation sheds load cleanly instead of hanging every worker thread.

## 4. Viewer-Keyed Cache Isolation and Singleflight Coalescing

- **Viewer-Keyed Cache Isolation (Zero Cross-User / Cross-Tenant Leakage)**: never cache authenticated, tenant-scoped, or role-dependent payloads under a bare route/query key. Scope application cache keys explicitly by `tenantId + viewerId` (or canonical permission-set hash), set `Vary: Authorization, Cookie, Accept-Encoding` on shared proxies, and emit `Cache-Control: private, no-store` on user-specific PII responses.
- **Singleflight Stampede Coalescing & TTL Jitter**: prevent thundering-herd cache stampedes on hot keys by coalescing concurrent misses into one in-flight promise per key (`singleflight` map that always deletes its in-flight key in `finally` so transient errors never poison future requests), spreading expirations with `±10–20%` TTL jitter, and serving bounded `stale-while-revalidate` where freshness budgets allow.

## 5. Neutral Is a Revert Discipline

- **"Neutral is a revert"**: added caching layers, custom fast paths, lock splitting, and manual batching carry permanent maintenance and bug surface cost. If an optimization patch yields a neutral or within-noise delta against the `>= 5x` median/IQR baseline—or fails the declared evaluator contract—**revert the patch immediately**, record the checkpoint (`status: "fail"`, reason: `reverted — neutral delta within noise`), and test the next independent hypothesis from a clean baseline.
