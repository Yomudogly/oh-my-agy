# Production Ship-Readiness Playbook (`--ship`)

Lazy-loaded release-readiness checklist for `$code-review --ship` and `$pr --ship`. Apply these gates when preparing production-bound service, API, database, worker, or frontend changes for merge and rollout.

## 1. Structured Observability: requestId, entryPoint, RED/USE Metrics, and Cardinality Guard

- **Structured Log Attribution (`requestId` + `entryPoint`)**: every production request, RPC, webhook, queue consumer, cron job, or CLI entrypoint must emit structured JSON logs carrying correlation `requestId` (or W3C `traceparent`), `entryPoint` (normalized route/handler name), `actor`/`tenantId` (with secrets/PII redacted), `durationMs`, and deterministic `status` / `errorCode`. Unstructured string-concatenated `console.log` calls without correlation context fail `--ship` on production request paths.
- **RED & USE Golden Signals**:
  - **Request-driven endpoints (RED)**: **R**ate (requests/sec), **E**rrors (failed requests/sec by class), **D**uration (latency histogram exposing p50/p95/p99).
  - **Resource pools & queues (USE)**: **U**tilization (`%` active workers/connections), **S**aturation (queue depth / wait latency), **E**rrors (timeouts, drops, evictions, OOMs).
- **High-Cardinality Metric Label Guard**: never attach unbounded or user-identifying values (`userId`, `email`, `requestId`, `traceId`, `sessionId`, raw `url` with path IDs/query params, or raw exception messages) as Prometheus/OpenTelemetry metric labels. Normalize route templates (`/v1/orders/:id`) in metrics and keep high-cardinality identifiers strictly in structured logs and distributed traces.

## 2. Two-Tier Symptom Alerts and Three-Line Actionable Runbooks

- **2-Tier Symptom-Based Alerting**: alert on user-observable symptoms (SLO burn rate, elevated 5xx/failure ratio, p99 latency breach, dead-letter queue growth) rather than noisy cause-only host metrics:
  - **Tier 1 (`Page / Critical`)**: fast multi-window SLO error-budget burn (e.g., `>= 2%` budget consumed in `1h` confirmed over `5m`) or total availability loss requiring immediate human mitigation.
  - **Tier 2 (`Ticket / Warning`)**: slow error-budget burn (e.g., `>= 5%` in `6h–24h`) or approaching pool/disk saturation routed to next-business-day engineering triage.
- **3-Line Actionable Runbook Contract**: every new alert or operational feature flag ships with a 3-line minimum runbook:
  1. **Verify Blast Radius**: exact dashboard URL, log query, or CLI health probe confirming user impact.
  2. **Mitigate / Rollback**: single copy-pasteable kill-switch flag flip, traffic shift, or artifact revert command.
  3. **Confirm Recovery & Escalate**: post-mitigation metric threshold proving recovery and owning team escalation point.

## 3. Progressive Delivery: Quantitative Canary Thresholds, Error Budget Gate, and RTO Rollback

- **Quantitative Canary Advance / Hold / Rollback Thresholds**: define numeric promotion criteria across staged traffic ramps (`1% -> 10% -> 50% -> 100%`) with both a minimum bake duration and minimum request-sample floor:
  - **Advance**: 5xx/error-rate delta `<= +0.1%` vs control, p95/p99 latency regression `<= +10%`, zero new crash/corruption signatures, and sample floor satisfied.
  - **Hold**: sample count below statistical floor or borderline transient variance (`+0.1%` to `+0.5%` error delta without upward slope) — hold stage and extend observation without advancing traffic.
  - **Rollback (Immediate)**: error-rate delta `> +0.5%` (or Tier 1 fast-burn alert), p99 latency `> 1.25x` baseline sustained `>= 5m`, auth/data-integrity/idempotency violation, or liveness/readiness failure.
- **Error Budget Release Gate** (rolling 30-day SLO error budget remaining):
  - **`> 20%` remaining**: normal release velocity under standard CI, `$code-review`, and canary gates.
  - **`0–20%` (`> 0%` and `<= 20%`) remaining**: heightened release discipline — require explicit `architect` / reliability sign-off, runtime kill-switch flag, and progressive canary bake before `100%` promotion.
  - **`0%` (exhausted)**: **feature freeze** — block non-essential feature rollouts (`REQUEST CHANGES` on feature PRs); permit only P0 incident mitigations, security fixes, and reliability/burn-reduction work until budget recovers or an explicit executive exception is logged.
- **RTO-Bound Rollback Plan**: verify rollback executes end-to-end inside the service's Recovery Time Objective (**RTO**, e.g., `< 5m` via runtime flag or immutable container/bundle re-point rather than a slow cold CI rebuild), and verify wire/queue/DB schema compatibility across concurrent `N` and `N-1` replicas during rollback.

## 4. Pre-Ship Automated Gates: quality-gate, floor-guard, and Staged Secret Check

Run deterministic local/CI hygiene checks before approving `--ship` or opening/merging the PR:

1. **Fail-Closed Scanner Report Validator (`quality-gate`)**: when Semgrep SAST or Axe accessibility JSON reports are produced, validate them fail-closed (`exit 0` clean; `exit 1` blocking `ERROR`/`HIGH`/`CRITICAL` or `serious`/`critical`; `exit 2` empty/malformed/silent-green report):
   ```sh
   sh <plugin>/hooks/run.sh quality-gate <semgrep-or-axe-report.json...>
   ```
   *(To validate `.omagy/config.json` workflow gate config on a workspace directory, run `sh <plugin>/hooks/run.sh quality-gates <workspace>`.)*
2. **Anti-Regression Floor Guard (`floor-guard`)**: confirm zero silenced checkers, unfinished `TODO`/stub throws, bare empty catches, modified `omagy-ignore` / `simplify-ignore` protected blocks, deleted/skipped tests, net assertion drops, loosened governance thresholds, or removed `[vN]` floor agreements against the base ref:
   ```sh
   sh <plugin>/hooks/run.sh floor-guard <workspace> <base_ref>
   ```
3. **Explicit-Path Staging & Redacted Staged Secret Check**: stage explicit owned files only (never blind `git add -A` or `git add .`) and inspect staged paths with `--name-only` so raw secret contents never print to terminal transcripts:
   ```sh
   git diff --staged --name-only
   ```
   Verify zero `.env*`, `*.pem`, `*.key`, `*credentials*`, `*secret*`, or out-of-scope dirty files are staged before commit or push.
