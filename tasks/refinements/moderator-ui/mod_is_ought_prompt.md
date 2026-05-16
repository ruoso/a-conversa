# Moderator diagnostic flow is-ought check prompt

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) - task `moderator_ui.mod_diagnostic_flow.mod_is_ought_prompt` (see `mod_diagnostic_flow` at lines 357-375 and this leaf at line 363).

```tji
task mod_is_ought_prompt "Is-ought check prompt" {
  effort 0.5d
  allocate team
}
```

## Effort estimate

**0.5d.** Confirmed. This is a focused moderator-UI chrome task: add the is-ought check prompt surface in diagnostic flow, wire it to existing capture-mode/state seams, localize the copy, and pin behavior with committed tests.

The work is intentionally narrower than full diagnostic-flow orchestration:

- no new methodology-engine rule;
- no new websocket envelope;
- no new diagnostic kind;
- no mutation of proposal wire shapes;
- no right-sidebar diagnostic resolution behavior (that is F7).

## Inherited dependencies (settled/pending)

Settled:

- `moderator_ui.mod_capture_flow` is complete and provides the bottom-strip capture seams this task reuses: input, propose affordance pattern, mode banner slot wiring, and store mutation rhythm (see predecessor refinements [tasks/refinements/moderator-ui/mod_capture_text_input.md](mod_capture_text_input.md) and [tasks/refinements/moderator-ui/mod_propose_action.md](mod_propose_action.md)).
- `frontend_i18n.i18n_diagnostic_descriptions` is complete and provides localized diagnostic vocabulary and tone conventions the prompt must align with (see [tasks/refinements/frontend-i18n/i18n_diagnostic_descriptions.md](../frontend-i18n/i18n_diagnostic_descriptions.md)).
- Capture-mode substrate already includes `operationalization` and `warrant-elicitation` values in [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts#L132) and [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts#L138).
- Mode banner localization seam is already generic (`moderator.modeBanner.<mode>.{label,description}`) in [apps/moderator/src/layout/ModeBanner.tsx](../../../apps/moderator/src/layout/ModeBanner.tsx#L32).

Pending (this task feeds these):

- `moderator_ui.mod_diagnostic_flow.mod_operationalization_mode` is the expected entry point that makes this prompt practically reachable from the UI flow.
- `moderator_ui.mod_diagnostic_flow.mod_disputation_test_display` and `moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode` consume adjacent F3 context and must remain copy-consistent with this prompt.
- `moderator_ui.mod_diagnostic_flow.mod_diagnostic_methodology_suggestions` and F7 diagnostic-resolution tasks consume the same diagnostic semantics but are out of this task's scope.
- Playwright end-to-end for full F3 path is owned by `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow`.

## What this task is

Land a moderator-visible is-ought check prompt in the diagnostic flow that helps the moderator decide whether disputed wording is carrying prescriptive load and whether to route next action toward normative decomposition or warrant extraction.

In practical UI terms, this task is a prompt surface plus i18n keys and tests, not a full flow engine. It should be implemented so it can be mounted by `mod_operationalization_mode` without redesigning store contracts.

## Why this needs to be done

- F3 in [docs/moderator-ui.md](../../../docs/moderator-ui.md#L64) explicitly includes the is-ought check as a moderator diagnostic step (line 75).
- Without a concrete prompt, the diagnostic flow relies on moderator memory and becomes inconsistent across sessions.
- A pinned prompt keeps methodology language aligned with existing diagnostic descriptions and reduces drift between moderator behavior and participant/audience expectation.
- This task is a low-cost bridge that unblocks consistent copy and test seams before heavier diagnostic-flow tasks land.

## Inputs/context with real file paths and line references

- WBS source and dependency chain:
  - [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji#L357) (`mod_diagnostic_flow` group)
  - [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji#L358) (group depends `!mod_capture_flow, frontend_i18n.i18n_diagnostic_descriptions`)
  - [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji#L363) (`mod_is_ought_prompt` leaf)
- Functional intent for this step:
  - [docs/moderator-ui.md](../../../docs/moderator-ui.md#L64) (F3 section)
  - [docs/moderator-ui.md](../../../docs/moderator-ui.md#L75) (is-ought check statement)
  - [docs/moderator-ui.md](../../../docs/moderator-ui.md#L79) (mode banner visibility expectation)
- Existing mode and banner seams to reuse:
  - [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts#L132) (`CaptureMode`)
  - [apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts#L208) (`setMode`)
  - [apps/moderator/src/layout/ModeBanner.tsx](../../../apps/moderator/src/layout/ModeBanner.tsx#L32) (mode key resolution)
- Existing diagnostic vocabulary and descriptions to stay consistent with:
  - [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L419) (`diagnostics` namespace)
  - [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L420) to [packages/i18n-catalogs/src/catalogs/en-US.json](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L444) (kinds: cycle/contradiction/multi-warrant/dangling-claim/coherency-hint)
- Existing downstream diagnostic surfacing seam (not changed by this task):
  - [apps/moderator/src/ws/wsStore.ts](../../../apps/moderator/src/ws/wsStore.ts#L54) (`lastDiagnostic`)
  - [apps/moderator/src/ws/wsStore.ts](../../../apps/moderator/src/ws/wsStore.ts#L67) (`activeDiagnostics`)
  - [apps/moderator/src/layout/RightSidebar.tsx](../../../apps/moderator/src/layout/RightSidebar.tsx#L35) (`diagnosticFlagsSlot`)

## Constraints/requirements

- Keep scope limited to moderator diagnostic-flow prompt chrome and text; do not introduce engine or protocol changes.
- Reuse existing i18n pipeline and key-shape conventions from moderator refinements.
- Prompt text must be methodology-neutral and operational, not argumentative.
- The prompt must support future wiring from `mod_operationalization_mode` without store API churn.
- Follow ADR 0022 test discipline: every behavior assertion is committed in Vitest/Playwright, no throwaway probes.
- UI-stream e2e policy:
  - Default is Playwright e2e scope.
  - Because this leaf is not directly reachable until `mod_operationalization_mode` wires the entry path, full F3 e2e is explicitly deferred to `mod_pw_diagnostic_flow`.
  - Inherited deferred scenario from this task: "moderator enters operationalization, sees is-ought prompt at the right moment, chooses path, and proceeds through diagnostic branch" remains pending until operationalization-mode wiring exists.

## Acceptance criteria (testable; reference ADR 0022)

1. A dedicated is-ought prompt UI surface exists in moderator diagnostic flow code with stable test ids and is mountable by diagnostic mode components.
2. i18n keys for the prompt are added in all three locales under a moderator diagnostic namespace and pass catalog parity checks.
3. Prompt copy aligns with the existing diagnostic terminology set from `diagnostics.*` and does not redefine diagnostic kinds.
4. Vitest coverage is committed for rendering, i18n resolution, and mode-gated visibility/behavior (ADR 0022).
5. If prompt actions are wired in this task, Vitest covers action callbacks; if actions are intentionally deferred, tests assert inert/placeholder behavior explicitly.
6. Playwright status is explicit in the refinement and implementation notes:
   - either a scoped e2e is added if a real user path exists at implementation time,
   - or e2e is deferred to `mod_pw_diagnostic_flow` with no ambiguity.
7. No ADR is added unless implementation reveals an architectural cross-cutting decision beyond this task's local scope.

## Decisions with rationale and rejected alternatives

- **D1: Keep this task as UI prompt chrome, not methodology logic.**
  - Rationale: the task title is "prompt" and effort is 0.5d; engine/protocol logic belongs to data-and-methodology or websocket tasks.
  - Rejected: embedding new inference or auto-classification rules in this leaf.

- **D2: Reuse existing mode/banner/store seams instead of introducing a new diagnostic prompt state machine.**
  - Rationale: `CaptureMode` and mode banner infrastructure already exist and are tested.
  - Rejected: adding a parallel prompt-specific global store.

- **D3: Keep prompt terminology aligned with `i18n_diagnostic_descriptions` and existing methodology glossary keys.**
  - Rationale: avoids drift in user-facing language across moderator surfaces.
  - Rejected: creating ad-hoc, differently named diagnostic terms in prompt copy.

- **D4: Defer full Playwright F3 scenario unless a complete reachable path exists at implementation time.**
  - Rationale: policy requires e2e by default, but unreachable flows must be explicitly deferred to owning WBS test tasks.
  - Rejected: writing brittle pseudo-e2e against non-user seams as a substitute for real path coverage.

- **D5: No new ADR by default.**
  - Rationale: current constraints are covered by ADR 0022 and existing frontend i18n decisions.
  - Rejected: creating an ADR for local prompt wording/layout choices.

## Open questions

- Should the prompt include one explicit "next suggested action" line (for example, decompose vs warrant), or remain strictly interrogative and leave action selection to later diagnostic tasks?
- Should this prompt be always visible in operationalization mode, or only appear after a specific dispute signal is present in store state?
- If action chips are added in this leaf, should they be keyboard-addressable immediately, or deferred until `mod_keyboard_shortcuts.mod_global_keymap` alignment?

## Status

**Done** — May 16, 2026.

- Prompt component: [apps/moderator/src/layout/IsOughtPrompt.tsx](../../../apps/moderator/src/layout/IsOughtPrompt.tsx)
- Vitest unit coverage: [apps/moderator/src/layout/IsOughtPrompt.test.tsx](../../../apps/moderator/src/layout/IsOughtPrompt.test.tsx)
- Integration point: [apps/moderator/src/routes/Operate.tsx](../../../apps/moderator/src/routes/Operate.tsx) (mounted in operationalization mode flow)
- i18n catalogs: en-US / pt-BR / es-419 updated with moderator diagnostic prompt keys (catalog parity verified)
- Vitest delta: 3382 → 3395 (+13 assertions)
- Playwright e2e: deferred to `mod_pw_diagnostic_flow` per acceptance criterion 6 (full F3 path unreachable until operationalization-mode wiring)
- No ADR added (all constraints covered by ADR 0022 and existing frontend i18n decisions per D5)
