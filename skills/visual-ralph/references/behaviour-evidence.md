# Behavioral UI Evidence, State-and-Flow QA & WCAG 2.2 AA

Reference playbook for [`skills/visual-ralph/SKILL.md`](../SKILL.md) and [`skills/ultraqa/references/browser-verification-safety.md`](../../ultraqa/references/browser-verification-safety.md). Load this reference whenever verifying interactive web applications, async UI states, or accessibility compliance beyond static screenshots.

## 1. Behavioral State-and-Flow Truth Contract

A static screenshot proves resting layout only. Interactive surfaces must hold six behavioral invariants across live transitions:

| Invariant | Failure Mode to Catch | Verification Signal |
| :--- | :--- | :--- |
| **`Unknown != Empty`** | Showing an empty-state illustration before initial fetch resolves or after an error | Loading/pending skeleton stays distinct from verified empty data and error UI |
| **Every region agrees** | Header count, sidebar badge, list body, and toast disagree after a mutation | All visible regions reflect the same committed state post-action |
| **Response belongs to target** | Slow response from item A overwrites freshly selected item B (`Switch` race) | Stale in-flight responses are aborted or discarded by request token/ID |
| **Cancelling != undoing** | Dismissing a modal or clicking Cancel mutates draft/persisted state unexpectedly | Draft or committed state returns cleanly to its pre-open baseline |
| **One press, one request** | Rapid double-click submits duplicate mutations or corrupts optimistic UI (`Twice`) | Button disables/dedupes while in flight; network shows 1 request or idempotent key |
| **Re-entry survives navigation** | Reload, deep-link URL, or browser Back/Forward loses or desyncs state (`Re-entry`) | Hard reload + URL deep-link + Back/Forward restore consistent UI and focus |

## 2. Five Live Capture Recipes (Network Boundary Holds, Never `sleep`)

Capture behavioral transitions by intercepting/holding requests at the browser network boundary (Playwright route interception or DevTools request blocking) rather than inserting brittle `sleep` calls:

1. **`Held`**: Hold the target XHR/`fetch` request open -> verify loading indicator, disabled submit/action controls, and absence of premature empty state.
2. **`Failed`**: Abort or return `500`/`503` on the real client request -> verify inline error banner, preserved user input, and working retry control.
3. **`Switch`**: Hold request for item A, immediately select item B (letting B resolve first), then release A -> verify item B stays rendered and item A's stale payload is ignored.
4. **`Twice`**: Trigger the primary mutation twice rapidly -> verify single in-flight mutation (or idempotent dedupe) with zero duplicate rows/toasts.
5. **`Re-entry`**: Complete a state change, then reload, visit the deep link directly, and traverse Back/Forward -> verify URL, data, and keyboard focus remain coherent.

## 3. Evidence Provenance: `EXECUTED` vs `TRACED` & `UNVERIFIED` Gate

- **Name provenance under every capture**: record the build/commit SHA, route/viewport, and data source (`real local backend` vs `injected network fault` vs `stubbed response`).
- **Injected fault vs stubbed success**:
  - An **injected network hold or error** against the real client code counts as **`EXECUTED`** for `Held`, `Failed`, and `Switch` flows.
  - A **stubbed success response** proves only the stub — never mark the end-to-end happy path `EXECUTED` or `match` until it runs at least once against the real backend/data store (otherwise tag it **`UNVERIFIED`** and block `match`/`GOOD` verdicts).
- **Never substitute `TRACED` for `EXECUTED`**: static code inspection is `TRACED`, not live UI proof.

## 4. WCAG 2.2 AA & Honest Tooling / Assistive-Tech Rules

1. **WCAG 2.2 AA Target Size (`SC 2.5.8`) & Labels (`SC 3.3.2`)**:
   - Interactive controls must meet **`24x24` CSS px** target size or spacing (`SC 2.5.8` AA; `44x44` CSS px is `SC 2.5.5` AAA).
   - A `placeholder` attribute is **not** a visible label (`SC 3.3.2`); every input needs a persistent `<label>`, `aria-labelledby`, or visible label association.
   - Verify keyboard navigation, focus traps, visible `:focus-visible` rings, and `320px` reflow (`SC 1.4.10`/`1.4.12`) alongside WAI-ARIA APG patterns for dialogs, menus, tabs, listboxes, and comboboxes.
2. **Fail-Closed Automated A11y Integrity**:
   - When running automated accessibility engines (`axe`, `pa11y`, or repo test runners), never report a clean `0 violations` total if any engine failed to execute, timed out, or emitted invalid JSON. Map `pa11y` `typeCode === 1` errors to `serious` (not `critical`) unless they block task completion.
3. **Honest Screen-Reader / AT Tagging**:
   - Never claim screen-reader verification unless tested with a real assistive technology; tag unexecuted AT checks **`manual`** naming the intended browser + screen-reader pair (e.g., `manual (Safari + VoiceOver)` or `manual (Chrome + NVDA)`).
4. **Verify With Project-Owned Tooling**:
   - Use the test runners, linters, typecheckers, and browser harnesses already installed in the repository. Never install a new test framework, browser package, or typechecker solely to verify a UI change; instead, report exact skipped checks transparently.
