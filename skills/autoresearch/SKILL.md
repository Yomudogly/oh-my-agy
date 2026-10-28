---
name: autoresearch
description: "[oh-my-agy] Stateful, validator-gated research loop that keeps going until an explicit completion artifact passes (script validator or architect review). Use when the research output itself is a bounded deliverable that must pass a validator, typically after $deep-interview --autoresearch."
---

# Autoresearch

Autoresearch is a persistent, measured research loop. The `Stop` hook keeps an active run going until a completion artifact satisfies the chosen validation mode. A model saying "done" does not end it.

## Boundary with planning research

Use `$autoresearch` when the research output is itself a bounded deliverable that must pass an explicit validator. Do not use it for ordinary pre-planning docs lookup or general best-practice checks; use `$best-practice-research` for those. If `$autoresearch` runs before architecture planning, its approved artifact feeds evidence into `$ralplan`. It does not become an architecture component unless the user explicitly asks for ongoing research automation.

## Use when
- You want a persistent research loop that continues until validation evidence exists.
- You want to choose, at init, between script validation and prompt + architect validation.

## Do not use when
- You have not decided the validation regime yet. Run `$deep-interview --autoresearch` first.

## Core contract
1. **Init chooses validation mode.** Pick exactly one:
   - `mission-validator-script`: a shell command whose exit code and output decide pass/fail.
   - `prompt-architect-artifact`: an `architect` subagent reviews the output against a validator prompt.
2. **Persist mode state** in `.omagy/state/autoresearch-state.json`:
   ```json
   {"mode":"autoresearch","active":true,"current_phase":"researching","iteration":1,"updated_at":"<ISO>",
    "state":{"slug":"<slug>","validation_mode":"mission-validator-script|prompt-architect-artifact",
             "completion_artifact_path":".omagy/specs/autoresearch-<slug>/completion.json",
             "mission_validator_command":"<cmd>","validator_prompt":null,
             "output_artifact_path":".omagy/specs/autoresearch-<slug>/report.md"}}
   ```
   Set `mission_validator_command` **or** `validator_prompt`, according to the mode.
3. **Completion is artifact-gated.** The loop does not stop because the model says "done", because a stop fired once, or because several turns were no-ops. If a real blocker needs the user, write `current_phase:"blocked"`, `active:false` and ask.

## Completion artifact contract

### `mission-validator-script`
Run the validator with `run_command`. The completion artifact records a passing result:
```json
{"status": "passed", "passed": true, "command": "<cmd>", "exit_code": 0, "summary": "metric improved beyond baseline"}
```

### `prompt-architect-artifact`
Invoke the `architect` subagent with the validator prompt, the mission, and the output artifact. The completion artifact includes its approval and the output path:
```json
{"validator_prompt": "Review the research output against the mission.", "architect_review": {"verdict": "approved", "notes": "..."}, "output_artifact_path": ".omagy/specs/autoresearch-<slug>/report.md"}
```

## Recommended flow
1. Run `$deep-interview --autoresearch` to clarify the mission, evaluator, and locked `## Fidelity` block (`as of`, `meaning check`, `source floor`, `derived numbers`).
2. Use the materialized `.omagy/specs/autoresearch-{slug}/mission.md`, `sandbox.md`, and `result.json`. Refuse to launch while `result.json` has `launchReady:false` or the `## Fidelity` block is unlocked (ported from OmO `ulw-research` `#11166`).
3. Write the autoresearch state with the chosen validation mode.
4. Iterate: research (`researcher` subagent, `search_web`, `read_url_content`, context7, repo reads), update the output artifact, run the validator, and refresh `updated_at` and `iteration`.
5. **Claim-kind discipline & meaning/polish preservation (ported from OmO `ulw-research` `#11151`, `#11152`, `#11160`, `#11289`, `#11302`)**:
   - Distinguish claim kinds explicitly: **`[VERIFIED]`** (`V`: backed by a command/test output executed in this run), **`[DERIVED]`** (`D`: computed from cited inputs with the formula shown, forbidden when `derived numbers: none`), and **`[ASSUMED]`** (`A`: explicit assumption). Never write first-person "we verified/measured" unless backed by a command output from the run.
   - **Meaning check**: verify that report sentences preserve the exact scope, subject, direction, and hedges/qualifiers of their sources (no `scope_widened`, `hedge_dropped`, `certainty_added`, or `causality_added`).
   - **Polish pass guard**: any final prose polish must change text only — never alter numbers, units, hedges, qualifiers, links, or claim tags.
6. Finish only after the completion artifact satisfies the mode. Then write the state terminal (`active:false`, `current_phase:"complete"`, `completed_at`).
