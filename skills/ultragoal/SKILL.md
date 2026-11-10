---
name: ultragoal
description: "[oh-my-agy] Create and execute durable repo-native multi-goal plans with a goals.json + ledger.jsonl audit trail, sequential completion, review gates, and resume. Use for $ultragoal, 'create-goals', 'complete-goals', durable multi-goal execution, or the Autopilot execution stage."
---

# Ultragoal Workflow

## When to use

Use for `$ultragoal`, `create-goals`, `complete-goals`, durable multi-goal planning, or sequential execution of an approved plan/spec. Also used as Autopilot's execution stage.

The **repo ledger is the single source of truth**. Antigravity's `/goal` slash command is user-triggered. You may suggest it for very long runs, but never depend on it.

## Durable artifacts (leader-owned)

- `.omagy/ultragoal/brief.md`: the source brief (spec or plan text, or a pointer to it).
- `.omagy/ultragoal/goals.json`: the plan.
- `.omagy/ultragoal/ledger.jsonl`: append-only audit trail, one JSON object per line.

`goals.json` schema:
```json
{
  "version": 1,
  "criteria_revision": 1,
  "objective": "<one-line aggregate objective>",
  "source": ".omagy/specs/deep-interview-<slug>.md | .omagy/plans/prd-<slug>.md | inline",
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "invariants": ["<architecture/domain invariant that must hold at the end>"],
  "goals": [
    {
      "id": "G1",
      "title": "<short title>",
      "objective": "<verifiable objective>",
      "rigor": "light|heavy",
      "acceptance": ["<testable criterion>"],
      "status": "pending|in_progress|complete|blocked|failed|superseded",
      "depends_on": [],
      "product_failures": 0,
      "evidence": null
    }
  ]
}
```

**Goal rigor classification (`rigor`)**:
- `"light"`: narrow change inside an existing module/pattern with no schema, auth, security, or public API contract change. Verified by targeted tests + acceptance check.
- `"heavy"`: cross-cutting change, new boundary/schema/auth/security surface, or state machine change. Requires targeted tests + at least 1 adversarial probe + independent `verifier` (`AdversarialVerify`) check before checkpointing.

Ledger entry shape (append; never rewrite earlier lines):
```json
{"at":"<ISO>","goal_id":"G1","event":"created|started|checkpoint|blocked|failed|steer|review-blockers|final-gate","status":"<status>","evidence":"<commands + exit codes / file refs>","note":"<optional>"}
```

Append a ledger line using the crash-resilient newline-isolated hook helper (`sh <plugin>/hooks/run.sh append-jsonl .omagy/ultragoal/ledger.jsonl '<json>'`, which prepends `\n` if a prior crash left a torn tail and refuses symlinks), or by reading the file and writing it back with the new line added on its own newline. Read the ledger tolerantly (`sh <plugin>/hooks/run.sh read-jsonl .omagy/ultragoal/ledger.jsonl` or line-by-line JSON parsing that skips malformed torn lines).

## Operational steps: create

1. Read the brief: the deep-interview spec, ralplan PRD/test-spec, or the user's inline brief. Copy it or point to it from `brief.md`.
2. Decompose it into right-sized, independently verifiable **vertical feature slices** (using a `Contract-First` foundational goal before parallel `$team` fan-out and a `Risk-First` spike goal for existential technical unknowns) with testable acceptance criteria and explicit dependencies. Split any candidate goal touching `> 5–8` files, spanning `>= 2` independent subsystems, or joining two independent behaviors with `"and"` in its `title`. Carry spec non-goals, `Always / Ask First / Never` decision boundaries, and invariants into `goals.json`.
3. Write `goals.json`, append `created` ledger entries, and show the user a compact goal table (plus `[oh-my-agy HUD](sidecar://oh-my-agy/hud/)` once if the HUD sidecar is enabled).
4. Standalone: write `.omagy/state/ultragoal-state.json` (`mode:"ultragoal"`, `active:true`, `current_phase:"planning"`). Inside Autopilot: keep the Autopilot state and set its `current_phase:"ultragoal"`.

## Operational steps: execute

0. **Pre-Flight Baseline & Scoped Per-Goal Staging**: before starting or resuming the execution loop, capture a `git status --porcelain` dirty-worktree baseline so pre-existing modified/untracked files stay untouched. Whenever creating per-goal commits, **never run blind `git add -A`, `git add .`, or `git commit -a`**: stage explicit goal-owned paths only (`git add -- <owned-paths>`) and verify staged files via `git diff --staged --name-only` so pre-existing dirty files, `.omagy/` scratch state, and secrets never stage.

Repeat until every goal is `complete` (or `superseded`):

1. Pick the first `pending` goal whose dependencies are complete. Set it `in_progress`, append `started`, and set the phase to `executing`.
2. Implement the goal: solo, or via an `executor` subagent for a bounded slice, or via `$team` when parallel lanes are justified.
   - **Zero-Context-Bleed Brief & Review Handoffs**: extract per-goal briefs via `sh <plugin>/hooks/run.sh goal-brief .omagy/ultragoal/goals.json <goal_id>` and package commit ranges via `sh <plugin>/hooks/run.sh review-package <workspace> <base_sha> <head_sha>` so subagents read file paths instead of inline prompt dumps.
   - **4-State Worker Routing & Model Escalation**: handle worker returns deterministically (and harvest any `### Noticed (Out of Scope)` items into `"Rulings made & Deferred minors"` without scope-creeping the active goal):
     - `COMPLETED`: proceed to step 3 verification.
     - `COMPLETED_WITH_CONCERNS`: inspect the reported concern (e.g., file growth or fragile edge case); either log a `Ruling:` (`event:"steer"`, `kind:"ruling"`) with `cost_if_wrong` or run a targeted fix pass before checkpointing.
     - `NEEDS_CONTEXT`: if a signature/path is missing or the worker reports a spec-vs-codebase architecture contradiction (`file:line` falsification), supply the authoritative context via `send_message` to the same worker conversation ID (or record an explicit `steer` / escalate when the spec contract itself is contradicted) without incrementing `product_failures`.
     - `BLOCKED`: if a worker on `Model: "flash"` or `"inherit"` stalls after 2 attempts on a complex implementation slice, escalate the retry to a higher model tier (`flash -> inherit -> pro`).
3. Audit the goal against real artifacts (`current_phase:"verifying"`):
   - Apply the **No-Reassurance Test Rerun Rule**: never re-run an unchanged passing test command when zero files have been edited since that pass.
   - For `"rigor": "light"`, run targeted tests and acceptance checks directly.
   - For `"rigor": "heavy"`, record the leader's internal `DoneClaim` (changed files, commands + exit codes, criterion mapping, and canonical `verdict` from `VERIFICATION_VERDICTS`: `live-ui-verified | unit-test-verified | type-check-only | enforcement-verified | formally-verified | verifier-blocked | verifier-failed`), then validate via the `verifier` subagent (`AdversarialVerify`) using a **Blind-Claim Packet**:
     - **Blind-Claim `AdversarialVerify` Input Rule**: pass only `ARTIFACT` (actual diff / `review-package` path / touched file paths) + `CONTRACT` (verbatim goal `acceptance` criteria, `goals.json` `invariants`, and `Consumes / Produces` signatures) + raw command exit codes and diagnostic outputs—**stripping persuasive executor narrative summaries** (`CLAIM` self-assessments or prose rationales explaining why code is "safe").
     - `AdversarialVerify` returns `verdict`: `"confirmed" | "false-positive" | "needs-fix" | "needs-human-review"` and `failure_class`: `"none" | "product" | "harness"`.
   - **4-Tier `RECONCILE` Precedence**: classify every verification discrepancy, adversarial probe hit, or review finding in strict top-down precedence order:
     1. `(1) Contract gap` — exposes an ambiguity, contradiction, or missing safety boundary in the spec/plan/criteria -> treat as `"needs-human-review"` (or record an authorized `steer` with `kind:"amend_criterion"`, incrementing `criteria_revision`).
     2. `(2) Actionable defect` — proven bug, regression, unmet criterion, or missing verification proof against `ARTIFACT` + `CONTRACT` -> route to Step 5 failure triage as `"needs-fix"` (`failure_class: "product"`, or `"harness"` when isolated to test/env setup).
     3. `(3) Explicit Ruling` — bounded non-defect tradeoff within the stated load/scope ceiling -> record `Ruling: <decision> — <why> — <cost_if_wrong>` via `steer` (`kind:"ruling"`) and proceed to checkpoint rather than forcing speculative churn.
     4. `(4) Context noise` — false positive disproved by repository `file:line` or command exit-code evidence -> dismiss with concrete `file:line` citation (`verdict: "false-positive"` when auditing an external critique; satisfies verification once `CONTRACT` proof holds).
   - **`Doubt/Review Theater` Circuit Breaker**: if `>= 2` consecutive verification (`AdversarialVerify`) or final-gate review cycles return prose critiques ("substantive findings") with `0` actionable defects passing Tier 1–2, halt automated re-spinning immediately—do not invent blocking nits or burn `product_failures`; either checkpoint via an explicit Tier 3 `Ruling:` (with `cost_if_wrong`) or escalate (`"needs-human-review"`) to the user.
4. Checkpoint: when `verdict` is `"confirmed"` (or `"false-positive"` on a dismissed critique with `CONTRACT` proof green, or `"light"` checks pass), set the goal `status:"complete"` with `evidence`, then append a `checkpoint` ledger line containing commands, exit codes, and `criteria_revision` (matching `goals.json` `criteria_revision`). When rendering ledger cells into Markdown or CSV tables, sanitize leading formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) via `renderLedgerCell`. Refresh `updated_at` in state.
5. **Failure triage (`product` vs `harness`), unavailable verification & blocked-goal cascade**:
   - **Unavailable verification never fabricates completion**: if the required test runner, verifier subagent, or external environment is unavailable or indeterminate, never mark the goal `complete` and never fabricate passing evidence. Record a truthful non-terminal `blocked` ledger entry (`event:"blocked"`, `status:"blocked"`, `note:"verification-unavailable:<reason>"`) and keep the goal `in_progress` or `blocked` until verification can actually run.
   - If verification fails with `failure_class: "harness"` (test runner setup, missing fixture, port/env glitch), run up to 1 bounded harness-repair attempt without incrementing `product_failures`.
   - If verification fails with `failure_class: "product"`, increment `product_failures` (max 3 attempts per goal). After 3 product failures or `"needs-human-review"`, set the goal `status:"blocked"` (`[~]`), append `blocked` to the ledger, and **cascade `status:"blocked"`** (`note:"blocked-by:<goal_id>"`) to every downstream `pending` goal whose `depends_on` transitively includes this goal. Continue with remaining independent `pending` goals; if none remain and user input is required, write state `current_phase:"blocked"`, `active:false`, and ask.

## Explicit steering & stale-goal reconciliation

- **Stale-Goal Reconciliation (on start/resume)**: Before executing a `pending` goal, run observable repo checks (`fileExists`, `fileContains`, `gitGrep`) against its target paths. If the repository already satisfies a goal's acceptance criteria from earlier work, verify with targeted tests and record a `checkpoint` with `note:"reconciled-from-repo"` instead of re-implementing.
- **Explicit Steering**: Change the decomposition only with evidence. Append a `steer` ledger entry with `kind`, `evidence`, and `rationale`, then edit `goals.json` accordingly. Supported kinds: `add_subgoal`, `split_subgoal`, `reorder_pending`, `revise_pending_wording`, `amend_criterion`, `annotate_ledger`, `mark_blocked_superseded`. Never silently delete goals. Mark them `superseded` instead.
- **Criterion Amendment, `criteria_revision` Binding & Autonomous Ruling Audit Trail (`Rulings, not stalls`)**: Whenever a goal's acceptance criteria or invariants in `goals.json` are amended after creation, increment top-level `criteria_revision` (default `1`) in `goals.json` and append a `steer` (`kind:"amend_criterion"` or `kind:"ruling"`) ledger entry recording `criteria_revision`, `decision` (or `previous_criterion` / `amended_criterion`), `rationale`, `evidence`, and `cost_if_wrong` (`"Ruling: <what was decided> — <why> — <cost_if_wrong>"`). Any `checkpoint` or `final-gate` receipt recorded against an older `criteria_revision` is stale and must be re-verified against the current `criteria_revision` before closeout. Surface all autonomous rulings and any deferred minor review observations explicitly under `"Rulings made & Deferred minors"` in the final closeout report. Ordinary prose does not mutate the plan.

## Team bridge

For parallel story execution, run `$team` against the active goals. Team workers return task evidence only. The Ultragoal leader alone updates `goals.json` and the ledger.

## Final gate and exit evidence

Before final completion (phase `reviewing`):

1. Run targeted verification for every goal.
2. Run `$ai-slop-cleaner` on the changed files, then rerun verification.
3. Audit every invariant from `goals.json` and the brief/spec/steering against implementation, tests, and review evidence.
4. Run `$code-review` through independent `code-reviewer` and `architect` subagent lanes. If review or invariant proof is not clean, add a `Resolve final code-review blockers` goal with the findings, append `review-blockers`, and loop back to execution. Inside Autopilot, design-level findings return Autopilot to `ralplan`.
5. When clean: append a `final-gate` ledger entry with cleaner, verification, review, and invariant evidence. Standalone: write the state terminal (`active:false`, `current_phase:"complete"`, `completed_at`). Inside Autopilot: set `handoff_artifacts.ultragoal` and let Autopilot finish.

Report goal ids/statuses, ledger path, review verdicts, and any blocker. Never claim completion from state files alone. Completion requires the verification evidence in the ledger.

## Resume

On `continue`/`resume`, read `goals.json`, the tail of `ledger.jsonl`, and the state file, then resume from the first non-complete goal. Do not re-decompose an existing plan unless steering is justified.
- **Resumed-run `started`-edge closeout bound**: when resuming an interrupted or previously blocked goal, append a fresh `started` ledger entry (`event:"started"`). Only verification runs and `checkpoint` entries recorded **strictly after** that latest unmatched `started` entry count toward closing out the resumed goal — pre-resume notes or stale artifacts from an earlier attempt never satisfy closeout.
