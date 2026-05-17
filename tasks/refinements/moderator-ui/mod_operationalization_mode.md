# Moderator diagnostic flow operationalization mode

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_diagnostic_flow.mod_operationalization_mode` (see `mod_diagnostic_flow` group at line 436 and this leaf at line 438).

```tji
task mod_operationalization_mode "Operationalization mode" {
  effort 1d
  allocate team
}
```

## Effort estimate

**1d.** Confirmed.

Operationalization is the methodology's first and most central diagnostic test (`docs/methodology.md` § "Operationalization test" L110–120): the moderator selects a target node, asks the participants *"what evidence would change your mind on this?"*, and routes the captured verbal answer toward one of five follow-up paths (re-classification, axiom-mark, defeater capture, decomposition, or "no signal yet — try another test"). The methodology engine, the wire envelope, and the underlying capture flows the operationalization answers feed into (`mod_capture_flow`, `mod_axiom_mark_flow`, `mod_defeater_flow`, `mod_decompose_flow`) are all complete — what's missing is the *entry path* that flips the moderator's capture surface into "operationalization mode" and pins the load-bearing reactive prompt chrome around it.

Most of the substrate this task needs already exists:

- `CaptureMode` already carries `'operationalization'` as one of its nine valid values ([apps/moderator/src/stores/captureStore.ts:138](../../../apps/moderator/src/stores/captureStore.ts#L138)).
- The mode-banner copy `moderator.modeBanner.operationalization.{label,description}` is already pinned across all three locales (the 18 keys shipped with `mod_mode_banner`; en-US copy: "Operationalization" / "Make a disputed statement testable by naming its conditions." — [packages/i18n-catalogs/src/catalogs/en-US.json:373](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L373)).
- `<IsOughtPrompt>` already mounts in operationalization mode ([apps/moderator/src/layout/IsOughtPrompt.tsx:15](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L15)) as the first reactive prompt the moderator sees once they've entered the mode.
- The disputation-test chip already pins which nodes are functioning as **claims** — the methodology's gate for "should I run operationalization on this?" — via the `disputationOutcome(...)` helper ([apps/moderator/src/graph/disputationOutcome.ts](../../../apps/moderator/src/graph/disputationOutcome.ts), Decisions §D7 of [`mod_disputation_test_display.md`](mod_disputation_test_display.md)).
- The mode-entry + exit-affordance pattern is well-pinned: `mod_decompose_mode` shipped `enterDecomposeMode(nodeId)` + `exitDecomposeMode()` as atomic store helpers ([apps/moderator/src/stores/captureStore.ts:377](../../../apps/moderator/src/stores/captureStore.ts#L377)) and `mod_interpretive_split_mode` generalised the exit affordance into the shared `<ProposalModeExitAffordance mode={...}>` body ([apps/moderator/src/layout/ProposalModeExitAffordance.tsx](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx)). This task follows the same pattern.

Concretely the deliverable is:

- **Two new store helpers** on `useCaptureStore` — `enterOperationalizationMode(nodeId: string)` and `exitOperationalizationMode()` — plus a new `operationalizationTargetNodeId: string | null` slice. Atomic-set / F1-clear discipline mirrors `enterDecomposeMode` / `enterInterpretiveSplitMode`.
- **A context-menu entry** on the node right-click menu in `buildNodeMenuItems` ([apps/moderator/src/graph/GraphCanvasPane.tsx:228](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L228)) — a new `'run-operationalization-test'` item that calls the new mode-entry helper. The item follows the same `onEnterOperationalizationMode?: (nodeId: string) => void` optional-handler shape as the `onEnterDecomposeMode?` / `onEnterInterpretiveSplitMode?` seams.
- **An exit affordance** generalised by promoting `<ProposalModeExitAffordance>`'s `ProposalMode` union from `'decompose' | 'interpretive-split'` to `'decompose' | 'interpretive-split' | 'operationalization'` (or, if the shared affordance's scope-name "proposal" no longer fits, a renamed `<ModeExitAffordance>` with the same body — see Decisions §D2 for the call). The thin per-mode wrapper `<OperationalizationModeExitButton>` mounts unconditionally inside `<OperateRoute>`'s `modeBanner` slot, sibling to `<DecomposeModeExitButton>` and `<InterpretiveSplitModeExitButton>`.
- **An operationalization-mode capture surface** `<OperationalizationCapturePanel>` — a single text area for the moderator to transcribe the participant's verbal answer ("nothing could change my mind" / "if X were true I'd retract" / "different empirical evidence" / etc.) plus a localized prompt header that restates the operationalization question. The panel is **inert in this leaf** (placeholder textarea, no propose-action wiring); the answer-routing chips (axiom-mark / capture-defeater / propose-reclassification / propose-decompose) are placeholders that the downstream F5 / F6 / F7 tasks own. Mirrors `<IsOughtPrompt>`'s "prompt-only, downstream actions placeholder" framing.
- **The new i18n catalog keys** under `moderator.operationalization.*` in en-US / pt-BR / es-419 (the panel chrome, the question prompt, the five answer-route placeholder action labels, the exit affordance aria/tooltip, and the banner target-wording overlay).
- **Vitest coverage** (store helpers, the new context-menu item, the exit affordance's per-mode branch, the capture panel's render/mode-gating, the `<OperateRoute>` slot-swap integration smoke, catalog parity); e2e deferred to `mod_pw_diagnostic_flow` per the F3-leaf precedent.

No new methodology engine, no new wire envelope, no new diagnostic kind, no new propose-action wiring, no new commit-gating, no new keyboard shortcut (`Cmd+O` lands when `mod_keyboard_shortcuts.mod_global_keymap` ships, per `docs/moderator-ui.md` L194 — pinning the shortcut is explicitly deferred here; the entry path through the right-click context menu is sufficient for this leaf, mirroring how `mod_decompose_mode` shipped without `Cmd+D`).

## Inherited dependencies (settled/pending)

Settled (this task plugs into existing seams without changing their contracts):

- `moderator_ui.mod_capture_flow` (done — parent `mod_diagnostic_flow` group depends on it). The bottom-strip capture pane substrate, the `<BottomStripCapture>` scaffold with its five sub-slots, `<ModeBanner>` reading `captureStore.mode`, and `useCaptureStore`'s `setMode` API are all in place.
- `moderator_ui.mod_decompose_flow.mod_decompose_mode` (done — commit `83bea9b`). Pinned the **mode-entry pattern** this task mirrors: atomic `enterDecomposeMode(nodeId)` store helper, `decomposeTargetNodeId` slice, F1-coupling clear, context-menu seam via `onEnterDecomposeMode?: (nodeId: string) => void` parameter to `buildNodeMenuItems`, sibling exit-affordance mount inside the `modeBanner` slot. See [`mod_decompose_mode.md`](mod_decompose_mode.md) Decisions §3 / §6.
- `moderator_ui.mod_decompose_flow.mod_interpretive_split_mode` (done). Generalised the exit-affordance body into the parameterised [`<ProposalModeExitAffordance mode={...}>`](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx) shape ([`mod_interpretive_split_mode.md`](mod_interpretive_split_mode.md) Decision §2). The per-mode key bundle (`MODE_KEYS`) and per-mode `data-testid` discipline are the seam this task extends from a two-mode union to a three-mode union (or to a renamed `<ModeExitAffordance>` — see Decisions §D2).
- `moderator_ui.mod_diagnostic_flow.mod_is_ought_prompt` (done — May 16, 2026, commit history per [`mod_is_ought_prompt.md`](mod_is_ought_prompt.md) Status block). Already mounts in operationalization mode (`mode === 'operationalization' || mode === 'warrant-elicitation'` per [apps/moderator/src/layout/IsOughtPrompt.tsx:15](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L15)), pins the `moderator.diagnostic.isOughtPrompt.*` i18n namespace + the disabled-placeholder action chip pattern + the "prompt-only, downstream actions placeholder" framing + the "defer Playwright e2e to `mod_pw_diagnostic_flow` when the full flow is unreachable" precedent this task inherits.
- `moderator_ui.mod_diagnostic_flow.mod_disputation_test_display` (done — commit `7bf8cf3`, [`mod_disputation_test_display.md`](mod_disputation_test_display.md)). Pinned `disputationOutcome(substanceStatus): 'data' | 'claim' | 'unsettled' | null` as the load-bearing helper this task's context-menu entry consults to decide whether to **enable** the new `'run-operationalization-test'` item (the methodology gates operationalization on `'claim'` per `docs/methodology.md` L130–133 + Decisions §D6 of `mod_disputation_test_display.md`).
- `moderator_ui.mod_diagnostic_flow.mod_diagnostic_methodology_suggestions` (done — commit `2311144`, [`mod_diagnostic_methodology_suggestions.md`](mod_diagnostic_methodology_suggestions.md)). Pinned the **sidebar-panel pattern** that lives in the `'diagnostic-flags'` `RightSidebar` slot — explicitly NOT the right pattern for this task (see Decisions §D1) but a useful contrast: methodology suggestions are reactive to `activeDiagnostics`, operationalization-mode is reactive to `captureStore.mode`.
- `moderator_ui.mod_mode_banner` (done). The `moderator.modeBanner.operationalization.{label,description}` keys are already shipped in all three locales — this task does NOT mint banner keys.
- `frontend_i18n.i18n_diagnostic_descriptions` (done). The `moderator.diagnostic.*` namespace is established; this task adds a parallel `moderator.operationalization.*` subtree (matching the convention `mod_decompose_mode` and `mod_interpretive_split_mode` followed with `moderator.decompose.*` / `moderator.interpretiveSplit.*`).
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done). The node-card surface the right-click context menu attaches to is unchanged by this task.

Pending (this task feeds these, but does NOT depend on them):

- `moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode` — the last F3 sibling. Will reuse the **same mode-entry pattern** this task pins: `enterWarrantElicitationMode(nodeId)` store helper, a parallel `'elicit-warrant'` context-menu entry, a parallel `<WarrantElicitationCapturePanel>` (or a generalised `<DiagnosticCapturePanel mode={...}>` — see Decisions §D3), and the same `<ModeExitAffordance mode="warrant-elicitation">` extension. The shared exit-affordance body and per-mode i18n discipline this task generalises are explicitly designed so warrant-elicitation drops in via the same key-namespace + thin-wrapper recipe.
- `moderator_ui.mod_axiom_mark_flow` (done — `mod_axiom_mark_action` shipped), `moderator_ui.mod_defeater_flow`, `moderator_ui.mod_decompose_flow` (done — `mod_decompose_mode` + `mod_multi_component_capture`), and the (pending) standalone `set-node-substance` propose-action work — the five answer-route follow-up paths the operationalization panel's placeholder action chips will eventually fire. This task pins the chip identifiers (`'route-axiom-mark'`, `'route-defeater'`, `'route-reclassify'`, `'route-decompose'`, `'route-no-signal'`) as the stable contract those downstream tasks will switch on.
- `moderator_ui.mod_diagnostic_resolution_flow.mod_resolution_path_picker` — the F7 task that turns the inert chips into real propose actions. The chip seams (`data-operationalization-route="<route>"`, `data-testid="operationalization-action-<route>"`) are the contract that picker will switch on, mirroring the `data-suggestion-move="<move>"` seam `mod_diagnostic_methodology_suggestions` pinned.
- `moderator_ui.mod_keyboard_shortcuts.mod_global_keymap` — will own the `Cmd+O` shortcut per `docs/moderator-ui.md` L194. This task explicitly defers shortcut binding to that task; the context-menu entry is sufficient as the v1 entry path.
- `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` — full F3 Playwright (this task contributes a scoped per-component assertion; see Acceptance criteria for the e2e deferral rationale and the inherited debt the future spec MUST cover).

## What this task is

Land the **entry path + mode-aware capture surface** for the operationalization diagnostic test — the methodology's first-line tool for resolving a disputed node by asking the participant what would change their mind. The moderator right-clicks a node whose substance is in `'claim'` outcome (per `disputationOutcome(...)`), picks "Run operationalization test", and the capture pane flips into operationalization mode: the mode banner labels the flow, the exit affordance is wired (Esc / × button), the bottom-strip's primary content swaps from the F1 statement-input grid to a dedicated `<OperationalizationCapturePanel>` that surfaces the operationalization prompt + a transcription area for the participant's verbal answer + the five placeholder answer-route chips, and the existing `<IsOughtPrompt>` continues to mount in the mode-banner slot (it already gates on `mode === 'operationalization'`).

Concretely, this task lands:

1. **A store-coupled mode-entry helper** `enterOperationalizationMode(nodeId)` exported from `useCaptureStore`:
   ```ts
   enterOperationalizationMode: (nodeId: string) => void;
   exitOperationalizationMode: () => void;
   operationalizationTargetNodeId: string | null;
   setOperationalizationTargetNodeId: (id: string | null) => void;
   ```
   `enterOperationalizationMode(nodeId)` is an atomic single-`set()` that flips `mode = 'operationalization'`, sets `operationalizationTargetNodeId = nodeId`, and clears the F1 capture-flow slices (`text = ''`, `classification = null`, `targetEntityId = null`, `edgeRole = null`) so a stale F1 draft does not bleed into the operationalization flow. `exitOperationalizationMode()` is the symmetric atomic reset back to `mode = 'idle'` + `operationalizationTargetNodeId = null`. `reset()` (already shipped) clears the new slice via the spread of `initialCaptureState`. This mirrors `enterDecomposeMode` / `enterInterpretiveSplitMode` verbatim (see Decisions §D4 for the F1-clear rationale carried over).

2. **A context-menu entry** `'run-operationalization-test'` on the node right-click menu, added to `buildNodeMenuItems` via a new optional `onEnterOperationalizationMode?: (nodeId: string) => void` parameter (same shape as the existing `onEnterDecomposeMode?` / `onEnterInterpretiveSplitMode?` seams). The canvas threads `(nodeId) => useCaptureStore.getState().enterOperationalizationMode(nodeId)` as the argument. When the optional handler is omitted (direct unit-test invocations of the factory), the legacy `actionStub('run-operationalization-test', target)` is used so existing factory-shape tests do not churn.

   The menu item's label key is `moderator.contextMenu.node.runOperationalization` (new — added in this leaf's i18n delta).

   **Methodology-gated disabled state**: the item is **always rendered** but `aria-disabled="true"` (with `disabled: true` on the underlying `MenuItem`) when `disputationOutcome(node.facetStatuses.substance) !== 'claim'` — operationalization is the methodology's resolution tool for disputed claims, not for nodes that are functioning as data or are still unsettled. The gate uses the load-bearing `disputationOutcome` helper, so the methodology vocabulary stays in one place. See Decisions §D5 for the always-show-and-disable choice vs. omit-when-inapplicable.

3. **A mode-aware exit affordance** `<OperationalizationModeExitButton>` (thin wrapper, source-stable with `<DecomposeModeExitButton>` / `<InterpretiveSplitModeExitButton>`). The shared `<ProposalModeExitAffordance mode={...}>` body is generalised to accept the new mode value; the `MODE_KEYS` per-mode key bundle gains a new `'operationalization'` entry with `moderator.operationalization.exit.{ariaLabel,tooltip}` + `moderator.operationalization.banner.targetWording` keys; the `targetNodeId` selector adds a third branch reading `operationalizationTargetNodeId`; the `exitMode` selector adds a third branch reading `exitOperationalizationMode`. The Escape-key handler attaches to the keymap when `mode === 'operationalization'`. Decisions §D2 records whether the shared body is **renamed** (`<ModeExitAffordance>` — broader scope name to reflect the third mode no longer fitting "proposal mode") or **kept-named** (the `ProposalMode` union widens but the symbol name is preserved for source stability).

4. **A new capture-pane surface** `<OperationalizationCapturePanel>` ([apps/moderator/src/layout/OperationalizationCapturePanel.tsx](../../../apps/moderator/src/layout/OperationalizationCapturePanel.tsx)) that the bottom strip mounts in place of `<CaptureTextInput>` + `<ClassificationPalette>` + `<CaptureTargetAndRole>` when `mode === 'operationalization'`. The panel renders:

   - A header row with the operationalization prompt: localized `t('moderator.operationalization.prompt.question')` — `"What evidence would change your mind on this?"` in en-US, mirroring `docs/methodology.md` L112 verbatim.
   - A target-wording overlay (right of the prompt) showing the wording of the node being operationalized — reuses `resolveProposalTargetWording(events, operationalizationTargetNodeId)` from `<ProposalModeExitAffordance>` (the helper is mode-neutral; the alias `resolveProposalTargetWording` is already exported, no new helper).
   - A transcription textarea where the moderator types the participant's verbal answer. The textarea is **placeholder-only in this leaf**: its value is local component state (or a new `operationalizationAnswerText` slice on `useCaptureStore` — see Decisions §D7 for which) and the value is NOT propagated to any propose action in this leaf. Defensive `MAX_METHODOLOGY_TEXT_LENGTH` clamp mirrors `<CaptureTextInput>`'s paste-bypass defense.
   - A row of **five placeholder answer-route chips** (all `disabled` + `aria-disabled="true"`, mirroring `<IsOughtPrompt>`'s action chips):
     - `data-operationalization-route="route-axiom-mark"` — "Mark as axiom" (for "nothing could change my mind" answers; downstream wires to `mod_axiom_mark_action`).
     - `data-operationalization-route="route-defeater"` — "Capture as defeater" (for "I'd retract if X" answers; downstream wires to `mod_defeater_flow`).
     - `data-operationalization-route="route-reclassify"` — "Re-classify" (for "empirical / value / definitional" answers that point at the kind the node should have been; downstream wires to a `propose-classify-node` action).
     - `data-operationalization-route="route-decompose"` — "Decompose" (for "different answers from the two debaters" → compound signal; downstream wires to `mod_decompose_mode`).
     - `data-operationalization-route="route-no-signal"` — "No signal yet — try another test" (the no-op route that exits operationalization mode without proposing anything; downstream may wire to a soft route-back-to-idle or to opening warrant-elicitation as the next-in-line test).

5. **An `<OperateRoute>` integration**: when `mode === 'operationalization'` the bottom-strip's `textInput` / `classificationPalette` / `edgeRoleSelector` slots collapse to the unified `<OperationalizationCapturePanel>` (single panel spanning the strip's body width, mirroring the proposal-mode slot-swap convention at [apps/moderator/src/routes/Operate.tsx:175–200](../../../apps/moderator/src/routes/Operate.tsx#L175)), the `proposeAction` slot stays null (no propose-action is wired in this leaf — placeholder), and the `modeBanner` slot continues to mount `<ModeBanner />` + `<IsOughtPrompt />` + `<DecomposeModeExitButton />` + `<InterpretiveSplitModeExitButton />` + **the new `<OperationalizationModeExitButton />`**.

6. **The new i18n catalog keys** under `moderator.operationalization.*` and one menu-label key under `moderator.contextMenu.node.runOperationalization`, in en-US / pt-BR / es-419:
   - `moderator.contextMenu.node.runOperationalization` — `"Run operationalization test"` / `"Executar teste de operacionalização"` / `"Ejecutar prueba de operacionalización"`.
   - `moderator.operationalization.prompt.question` — `"What evidence would change your mind on this?"` / `"Que evidência mudaria sua opinião sobre isso?"` / `"¿Qué evidencia cambiaría tu opinión sobre esto?"` (the canonical operationalization question, verbatim from `docs/methodology.md` L112).
   - `moderator.operationalization.prompt.guidance` — `"Capture the participant's answer below. The answer routes the next move: empirical evidence → re-classify; a different value → re-classify; truth-by-meaning → re-classify; nothing could change my mind → axiom-mark; specific retraction conditions → capture as defeater."` (and per-locale translations).
   - `moderator.operationalization.answer.placeholder` — `"Type the participant's verbal answer..."` (and per-locale).
   - `moderator.operationalization.action.route-axiom-mark` — `"Mark as axiom"` / etc.
   - `moderator.operationalization.action.route-defeater` — `"Capture as defeater"` / etc.
   - `moderator.operationalization.action.route-reclassify` — `"Re-classify"` / etc.
   - `moderator.operationalization.action.route-decompose` — `"Decompose"` / etc.
   - `moderator.operationalization.action.route-no-signal` — `"No signal yet"` / etc.
   - `moderator.operationalization.exit.ariaLabel` — `"Exit operationalization mode"` / etc.
   - `moderator.operationalization.exit.tooltip` — `"Exit operationalization mode (Esc)"` / etc.
   - `moderator.operationalization.banner.targetWording` (ICU) — `"Operationalizing: {nodeWording}"` / `"Operacionalizando: {nodeWording}"` / `"Operacionalizando: {nodeWording}"`.
   - Catalog parity must hold across all three locales.

This task is rendering + entry-path only. It does NOT capture or fire any propose-action (the five route chips are inert), does NOT modify any wire envelope, does NOT add a methodology engine rule, does NOT add a `Cmd+O` keyboard shortcut (deferred to `mod_global_keymap`), does NOT change diagnostic detection, does NOT change `<IsOughtPrompt>` or the diagnostic-suggestions panel.

## Why it needs to be done

Per `docs/methodology.md` § "Operationalization test" L110–120, operationalization is the methodology's primary tool for resolving a disputed claim — the first test the moderator reaches for once the disputation-test chip says "claim". Today the moderator has no UI surface to enter that test: the mode value exists in `CaptureMode`, the banner copy exists, and `<IsOughtPrompt>` already gates on the mode, but **nothing calls `setMode('operationalization')`** anywhere in the app. The diagnostic flow has a gap between "the chip says this node is a claim" (settled by `mod_disputation_test_display`) and "the moderator runs the operationalization test on it" (this task).

Per `docs/moderator-ui.md` L68–74 (F3 § "Operationalization"):

> Operationalization (Cmd+O, sketch): select target → trigger → capture the participant's verbal answer in the capture pane. The answer drives next steps:
> - Empirical evidence → propose re-classification as fact / predictive.
> - Different value/principle → propose re-classification as value / normative.
> - Truth-by-meaning → propose re-classification as definitional.
> - "Nothing could change my mind" → propose an axiom-mark for that participant (F5).
> - Specific retraction conditions → propose defeaters (F6).
> - Different answers from the two debaters → strong signal of compound; propose decomposition (F2).

The five answer-routes are the load-bearing methodology contract this task surfaces. Pinning the chip identifiers (`route-axiom-mark`, `route-defeater`, `route-reclassify`, `route-decompose`, `route-no-signal`) early — before two surfaces independently coin variants — is the same drift-prevention rationale that motivated the disputation-test helper's pure-helper extraction and the methodology-suggestions panel's `SuggestionMove` enum.

Splitting the entry path + capture surface (this task) from the wiring of the answer-route chips (F5 / F6 / F7) is the same split `mod_is_ought_prompt` and `mod_diagnostic_methodology_suggestions` made: the placeholder-chip discipline lets the F5 / F6 / F7 owners flip `disabled={false}` + add `onClick={...}` in their own diff, not refactor the markup. The cost of leaving this gap open until F7 lands is that:

- The F3 diagnostic flow has no UI surface to *invoke* its central test — `<IsOughtPrompt>` mounts but is unreachable from any real user gesture.
- The disputation-test chip's promise of "see at a glance which nodes are claims that need operationalization" goes unfulfilled — the moderator sees the chip but has no way to act on it.
- The `moderator.operationalization.*` i18n vocabulary stays uncoined, blocking warrant-elicitation (which will mirror the same convention) and the audience-broadcast diagnostic surface if it ever surfaces in-flight diagnostic-mode banners.
- F7's resolution-path-picker would have to ship the mode-entry chrome AND the answer-route wiring in one task, increasing scope.

The shared exit-affordance generalisation (Decisions §D2) means this task also unblocks `mod_warrant_elicitation_mode` (the last F3 sibling) — that task drops into the generalised body without re-extracting.

## Inputs / context

Code seams the implementation plugs into:

- [apps/moderator/src/stores/captureStore.ts L132–141](../../../apps/moderator/src/stores/captureStore.ts#L132) — `CaptureMode` discriminated union (`'operationalization'` already present at L138). No type-union edit needed; only new slice + helpers.
- [apps/moderator/src/stores/captureStore.ts L342–365](../../../apps/moderator/src/stores/captureStore.ts#L342) — `initialCaptureState` constant. Add `operationalizationTargetNodeId: null` here so `reset()` clears the new slice.
- [apps/moderator/src/stores/captureStore.ts L377–402](../../../apps/moderator/src/stores/captureStore.ts#L377) — `enterDecomposeMode` / `exitDecomposeMode` implementation. The operationalization mode-entry / exit helpers mirror these atomic `set()` calls (no `decomposeComponents` seed — operationalization is single-textarea, not multi-row).
- [apps/moderator/src/stores/captureStore.ts L442–464](../../../apps/moderator/src/stores/captureStore.ts#L442) — `enterInterpretiveSplitMode` / `exitInterpretiveSplitMode`. Same mirror — three mode-entry/exit pairs become four after this task.
- [apps/moderator/src/graph/GraphCanvasPane.tsx L228–272](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L228) — `buildNodeMenuItems(target, onOpenAxiomMarkSubmenu?, onEnterDecomposeMode?, onEnterInterpretiveSplitMode?)`. Extend the signature with a fourth optional `onEnterOperationalizationMode?: (nodeId: string) => void` parameter; insert the new `'run-operationalization-test'` item between `'propose-interpretive-split'` (L249) and `'propose-meta-disagreement'` (L257) — placement rationale: operationalization is a diagnostic move (post-`set-substance`-style propose actions, pre-meta-disagreement / axiom-mark / annotate) and reading top-to-bottom should follow the methodology's escalating commitment order (propose-restructure → diagnostic → axiom-mark).
- [apps/moderator/src/graph/GraphCanvasPane.tsx ~L900–950](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L900) — `<GraphCanvasPaneInner>`'s `buildNodeMenuItems` call site. Thread `(nodeId) => useCaptureStore.getState().enterOperationalizationMode(nodeId)` as the new fourth argument.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L29](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L29) — `ProposalMode = 'decompose' | 'interpretive-split'`. Widen to include `'operationalization'` (or rename the symbol to `ModeExitAffordanceMode` — see Decisions §D2).
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L65–76](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L65) — `MODE_KEYS` per-mode key bundle. Add the `'operationalization'` entry pointing at the new `moderator.operationalization.exit.*` and `moderator.operationalization.banner.targetWording` keys.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L88–93](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L88) — the `targetNodeId` / `exitMode` per-mode branch selectors. Add a third branch for `'operationalization'` reading `operationalizationTargetNodeId` / `exitOperationalizationMode`.
- [apps/moderator/src/layout/DecomposeModeExitButton.tsx](../../../apps/moderator/src/layout/DecomposeModeExitButton.tsx) — thin wrapper template. Mirror it as `apps/moderator/src/layout/OperationalizationModeExitButton.tsx`.
- [apps/moderator/src/layout/IsOughtPrompt.tsx L15](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L15) — `mode === 'operationalization' || mode === 'warrant-elicitation'` gate. Unchanged — the prompt already mounts in operationalization mode and this task makes that mount reachable.
- [apps/moderator/src/routes/Operate.tsx L133–202](../../../apps/moderator/src/routes/Operate.tsx#L133) — the mode-driven slot-swap pattern. Extend the existing `isProposalMode` gate to a tri-state slot-swap that ALSO recognises `'operationalization'` (or add a parallel `isOperationalizationMode` gate — see Decisions §D6 for the choice). The `modeBanner` slot's children list gains `<OperationalizationModeExitButton />`.
- [apps/moderator/src/graph/disputationOutcome.ts](../../../apps/moderator/src/graph/disputationOutcome.ts) — `disputationOutcome(substanceStatus): 'data' | 'claim' | 'unsettled' | null`. Imported by `buildNodeMenuItems` (or by the canvas's menu-item builder call site — see Decisions §D5 for where the gate runs) to decide the menu item's `disabled` state.
- [apps/moderator/src/graph/StatementNode.tsx L113](../../../apps/moderator/src/graph/StatementNode.tsx#L113) — `StatementNodeData.facetStatuses`. The disabled-state gate reads `data.facetStatuses.substance` off the projected node data to call `disputationOutcome(...)`.
- [apps/moderator/src/layout/captureKeymap.ts](../../../apps/moderator/src/layout/captureKeymap.ts) — the keymap attaches `onExitMode` only while in the matching mode. The `<ProposalModeExitAffordance>` body already gates on `mode === targetMode` (line 104); this task extends that gate to operationalization mode via the generalised body, no keymap-internal change required.
- [packages/i18n-catalogs/src/catalogs/en-US.json L390 (`moderator.diagnostic`)](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L390), [`moderator.decompose` ~L420](../../../packages/i18n-catalogs/src/catalogs/en-US.json) and [`moderator.interpretiveSplit`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the sibling namespaces. The new `moderator.operationalization.*` subtree lives alongside.
- [packages/shared-types/src/index.ts (`MAX_METHODOLOGY_TEXT_LENGTH`)](../../../packages/shared-types/src/index.ts) — the defensive paste-bypass clamp used by `<CaptureTextInput>` and the per-row decompose / interpretive-split mutators. The operationalization answer textarea reuses it.

Methodology / design references:

- [docs/methodology.md L110–120](../../../docs/methodology.md#L110) — the canonical operationalization-test definition and the five answer-routes this task surfaces.
- [docs/methodology.md L130–133](../../../docs/methodology.md#L130) — the disputation-test gate: a node is a claim (warranting operationalization) iff its substance facet is `disputed` / `meta-disagreement`. Pinned by `disputationOutcome(...)` Decisions §D2 / §D7 of [`mod_disputation_test_display.md`](mod_disputation_test_display.md).
- [docs/methodology.md L196 (operationalization referenced in walkthrough)](../../../docs/methodology.md#L196) — confirms operationalization is the methodology's primary surfacing tool.
- [docs/methodology.md L200–206](../../../docs/methodology.md#L200) — the axiom-mark route ("nothing could change my mind"); the `route-axiom-mark` chip downstream wires to `mod_axiom_mark_action`.
- [docs/moderator-ui.md L68–74](../../../docs/moderator-ui.md#L68) — F3 § "Operationalization" — the canonical UI contract for the entry path, the capture-pane behavior, and the five answer-routes.
- [docs/moderator-ui.md L79](../../../docs/moderator-ui.md#L79) — "The mode banner indicates which test is in progress so participants and audience know what's being asked." Confirms the mode-banner + exit-affordance + target-wording-overlay chrome this task lands is on-contract.
- [docs/moderator-ui.md L173–183](../../../docs/moderator-ui.md#L173) — the canonical mode-banner mode list, including "Run operationalization test".
- [docs/moderator-ui.md L194](../../../docs/moderator-ui.md#L194) — `Cmd+O` for operationalization (the deferred shortcut, owned by `mod_global_keymap`).

Predecessor refinements:

- [`mod_disputation_test_display`](mod_disputation_test_display.md) — pinned the `disputationOutcome(...)` helper this task's context-menu gate consults, the `data-disputation-outcome` seam (informational), the "chip is a methodology label, mode-entry is downstream" framing, and the e2e-deferral precedent.
- [`mod_diagnostic_methodology_suggestions`](mod_diagnostic_methodology_suggestions.md) — pinned the **sidebar-panel pattern** (explicitly NOT the right fit here, see Decisions §D1) and the `SuggestionMove` enum + `data-suggestion-move` seam convention this task's `data-operationalization-route` seams mirror.
- [`mod_is_ought_prompt`](mod_is_ought_prompt.md) — pinned the `moderator.diagnostic.*` i18n namespace, the disabled-placeholder action chip pattern, the inline-mode-banner-chrome surface convention, the `mode === 'operationalization'` gate this task's flow makes reachable, and the e2e-deferral precedent.
- [`mod_decompose_mode`](mod_decompose_mode.md) — pinned the **mode-entry pattern** (atomic `set()`, F1-clear coupling, optional handler parameter on `buildNodeMenuItems`, sibling exit-affordance mount).
- [`mod_interpretive_split_mode`](mod_interpretive_split_mode.md) — generalised the exit affordance into the parameterised `<ProposalModeExitAffordance>` body this task extends.
- [`mod_mode_banner`](mod_mode_banner.md) — pinned the `moderator.modeBanner.<mode>.{label,description}` catalog discipline (already includes operationalization).

ADRs the implementation cites:

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface. The context-menu integration runs through the existing node-card menu pipeline; no new ReactFlow seam.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized prompt + action chips + banner overlay; ICU template for `targetWording`.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the entity / facet separation is respected: the context-menu gate reads from the facet projection (entity-derived view of facet status), the mode-entry does not emit any facet-layer event, the placeholder chips do not capture or fire facet-layer events.

**No new ADR is required.** The task reuses ReactFlow, Tailwind utilities, the established `moderator.<mode>.*` i18n namespace convention, the existing `<ProposalModeExitAffordance>` body (extended additively), the existing `buildNodeMenuItems` signature pattern (extended additively), and the existing `useCaptureStore` slice + helper pattern. The methodology answer-route vocabulary is data (encoded in the chip identifiers + i18n keys), not architecture. The disabled-by-disputation-outcome gate is a re-use of the already-shipped pure helper. No cross-workspace contract changes.

(One naming-and-scope question — whether to **rename** `<ProposalModeExitAffordance>` to `<ModeExitAffordance>` because operationalization isn't a "proposal mode" — is settled under Decisions §D2 in favor of keeping the symbol-name and widening the union, on grounds of source-stability for the two existing call sites and the modest scope drift this introduces. If a future fourth or fifth mode lands and the "proposal" qualifier becomes actively misleading, the rename can be done as an additive alias in a focused chore.)

## Constraints / requirements

### Store helpers (pure, no React, no side effects beyond the `set()` calls)

- **File**: extend `apps/moderator/src/stores/captureStore.ts`.
- **New slice**: `operationalizationTargetNodeId: string | null` on `CaptureState`. Initial value `null`. Added to `initialCaptureState` so `reset()` clears it via the spread.
- **New setter**: `setOperationalizationTargetNodeId(id: string | null): void` — symmetric with `setDecomposeTargetNodeId` / `setInterpretiveSplitTargetNodeId`, exists for symmetry and test seams (callers should prefer `enterOperationalizationMode` / `exitOperationalizationMode`).
- **New coupled helper** `enterOperationalizationMode(nodeId: string): void` — atomic single-`set()`:
  ```ts
  enterOperationalizationMode: (nodeId) =>
    set({
      mode: 'operationalization',
      operationalizationTargetNodeId: nodeId,
      // F1-coupling clear (mirrors enterDecomposeMode / enterInterpretiveSplitMode):
      // a stale in-progress F1 draft must not bleed into the operationalization flow.
      text: '',
      classification: null,
      targetEntityId: null,
      edgeRole: null,
    }),
  ```
- **New coupled helper** `exitOperationalizationMode(): void` — atomic single-`set()`:
  ```ts
  exitOperationalizationMode: () =>
    set({
      mode: 'idle',
      operationalizationTargetNodeId: null,
    }),
  ```
- **Existing `reset()` already clears the new slice via the spread of `initialCaptureState`** (the same way it already clears `decomposeTargetNodeId` and `interpretiveSplitTargetNodeId`); no change to `reset()`.

### Context-menu entry (`buildNodeMenuItems` extension)

- **File**: edit `apps/moderator/src/graph/GraphCanvasPane.tsx`.
- **New optional parameter** on `buildNodeMenuItems`: `onEnterOperationalizationMode?: (nodeId: string) => void`. Inserted as the fourth optional argument (after `onEnterInterpretiveSplitMode?`).
- **New menu item** `id: 'run-operationalization-test'`, `labelKey: 'moderator.contextMenu.node.runOperationalization'`. Inserted between `'propose-interpretic-split'` (currently L249) and `'propose-meta-disagreement'` (currently L257).
- **`onSelect`** mirrors the decompose / interpretive-split pattern:
  ```ts
  onSelect:
    target.kind === 'node' && target.id !== null && onEnterOperationalizationMode
      ? () => onEnterOperationalizationMode(target.id as string)
      : () => actionStub('run-operationalization-test', target),
  ```
- **Methodology-gated disabled state**: the item is **always rendered** but `disabled: true` (and the rendered button carries `aria-disabled="true"`) when the gate fails. The gate is computed at menu-build time from the target node's substance facet status; see Decisions §D5 for the gate computation site. The `disabled` field on `MenuItem` already exists in the menu type (or is added in this task if it doesn't — additive change to the existing factory type).
- **Canvas call site**: in `<GraphCanvasPaneInner>` thread the new handler:
  ```ts
  const items = buildNodeMenuItems(
    target,
    onOpenAxiomMarkSubmenu,
    (nodeId) => useCaptureStore.getState().enterDecomposeMode(nodeId),
    (nodeId) => useCaptureStore.getState().enterInterpretiveSplitMode(nodeId),
    (nodeId) => useCaptureStore.getState().enterOperationalizationMode(nodeId),
  );
  ```

### Mode-aware exit affordance generalisation

- **File**: edit `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`.
- **Widen the type union** `ProposalMode` from `'decompose' | 'interpretive-split'` to `'decompose' | 'interpretive-split' | 'operationalization'`. Per Decisions §D2 the symbol name is **preserved** (no rename), even though "proposal mode" is now a slight misnomer — source-stability outweighs the scope-language nit; a focused rename chore can happen later if a fourth or fifth mode pushes the misnomer over the threshold.
- **Extend `MODE_KEYS`** with the new `'operationalization'` entry pointing at the new keys (see i18n section below).
- **Extend the `targetNodeId` selector** (currently lines 88–90) to a three-branch ternary or a small lookup:
  ```ts
  const targetNodeId = useCaptureStore((s) =>
    targetMode === 'decompose'
      ? s.decomposeTargetNodeId
      : targetMode === 'interpretive-split'
        ? s.interpretiveSplitTargetNodeId
        : s.operationalizationTargetNodeId,
  );
  ```
  Symmetric three-branch extension for `exitMode`.
- **No keymap change required** — `attachCaptureKeymap({ onExitMode })` already gates internally on `useCaptureStore.getState().mode === <matching mode>`; widening the `ProposalMode` union and adding the third per-mode branch in the body is sufficient.

### New thin wrapper

- **File**: new `apps/moderator/src/layout/OperationalizationModeExitButton.tsx`.
- **Body**: copy-of-`DecomposeModeExitButton.tsx` with `mode="operationalization"`:
  ```tsx
  import { type ReactElement } from 'react';
  import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

  export function OperationalizationModeExitButton(): ReactElement | null {
    return <ProposalModeExitAffordance mode="operationalization" />;
  }
  ```

### New capture-pane surface (`<OperationalizationCapturePanel>`)

- **File**: new `apps/moderator/src/layout/OperationalizationCapturePanel.tsx`.
- **Props**: `{}` (no props; the panel reads from `useCaptureStore` + the i18n shell directly, mirroring `<IsOughtPrompt>` / `<DecomposeComponentsGrid>` self-subscription pattern).
- **Mode gate**: returns `null` when `useCaptureStore((s) => s.mode) !== 'operationalization'`. (Even though the `<OperateRoute>` slot-swap only mounts the panel in operationalization mode, the panel defensively self-gates to mirror `<IsOughtPrompt>`'s pattern and to keep direct unit-test invocations deterministic regardless of the harness mode.)
- **Header row**:
  - Localized prompt header (`moderator.operationalization.prompt.question`) — the canonical methodology question.
  - Target-wording overlay (right-aligned) showing the node being operationalized: `t('moderator.operationalization.banner.targetWording', { nodeWording })` where `nodeWording` is the result of `resolveProposalTargetWording(events, operationalizationTargetNodeId)`. The events array comes from `useWsStore`'s session slice; `useParams<{ id: string }>()` provides the session id (same shape as `<ProposalModeExitAffordance>`).
- **Guidance row** (smaller text below the header): localized `moderator.operationalization.prompt.guidance` — the one-sentence reminder of the five answer-routes.
- **Transcription textarea**: `<textarea>` with `aria-label="moderator.operationalization.answer.placeholder"` and `placeholder` matching. The textarea's value lives in local component state via `useState<string>('')` (Decisions §D7 settles local-state vs. new store slice in favor of local state, since this leaf does not propagate the answer anywhere; the F5 / F6 / F7 owners can promote to a store slice later if their handlers need it).
- **Action chip row**: five `<button disabled aria-disabled="true">` chips, each carrying:
  - `data-testid={`operationalization-action-${route}`}` and `data-operationalization-route={route}` (stable seams for the F5 / F6 / F7 wiring).
  - Localized label via `t(`moderator.operationalization.action.${route}`)`.
  - The same disabled-placeholder Tailwind palette as `<IsOughtPrompt>`'s action chips (`rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70`) — palette continuity with the sibling F3 mode-banner-adjacent surface.
- **Stable test ids on the panel root**: `data-testid="operationalization-capture-panel"`, `data-operationalization-target-node-id={operationalizationTargetNodeId ?? ''}` so the test suite can assert the target node id without parsing the wording overlay.

### `<OperateRoute>` integration

- **File**: edit `apps/moderator/src/routes/Operate.tsx`.
- **Mode-gate computation**: add `const isOperationalizationMode = mode === 'operationalization';` next to the existing `isDecomposeMode` / `isInterpretiveSplitMode` computations.
- **`modeBanner` slot**: append `<OperationalizationModeExitButton />` to the existing children list (sibling to `<DecomposeModeExitButton />` and `<InterpretiveSplitModeExitButton />`). The two existing exit buttons each self-gate on their matching mode, so adding the third is purely additive.
- **`textInput` / `classificationPalette` / `edgeRoleSelector` slot-swap**: extend the existing `isProposalMode` switch. The cleanest shape (Decisions §D6) is to keep `isProposalMode` as the existing decompose-or-interpretive-split gate AND add a parallel `isOperationalizationMode` gate; the `textInput` slot's expression becomes a three-arm select:
  ```tsx
  textInput={
    isOperationalizationMode ? (
      <OperationalizationCapturePanel />
    ) : isProposalMode ? (
      isInterpretiveSplitMode ? <InterpretiveSplitReadingsGrid /> : <DecomposeComponentsGrid mode="decompose" />
    ) : (
      <CaptureTextInput onSubmit={() => { void propose(); }} />
    )
  }
  classificationPalette={isOperationalizationMode || isProposalMode ? null : <ClassificationPalette />}
  edgeRoleSelector={isOperationalizationMode || isProposalMode ? null : <CaptureTargetAndRole />}
  proposeAction={
    isDecomposeMode ? (
      <ProposeDecompositionAction />
    ) : isInterpretiveSplitMode ? (
      <ProposeInterpretiveSplitAction />
    ) : isOperationalizationMode ? null : (
      <ProposeAction />
    )
  }
  ```
  The `proposeAction` slot is `null` in operationalization mode in this leaf — there is no propose-action to wire (the five route chips are inert placeholders); future F5 / F6 / F7 work will replace `null` with a `<RouteOperationalizationAction>` once a route chip becomes active.

### i18n

- **New catalog keys** under `moderator.operationalization` + the one menu-label key (en-US / pt-BR / es-419):
  - `moderator.contextMenu.node.runOperationalization` — `"Run operationalization test"` / `"Executar teste de operacionalização"` / `"Ejecutar prueba de operacionalización"`.
  - `moderator.operationalization.prompt.question` — `"What evidence would change your mind on this?"` / `"Que evidência mudaria sua opinião sobre isso?"` / `"¿Qué evidencia cambiaría tu opinión sobre esto?"`.
  - `moderator.operationalization.prompt.guidance` — `"Empirical evidence routes to re-classification; a different value or principle routes to re-classification; truth-by-meaning routes to re-classification; 'nothing could change my mind' routes to axiom-mark; specific retraction conditions route to defeater capture."` (and per-locale).
  - `moderator.operationalization.answer.placeholder` — `"Type the participant's verbal answer..."` (and per-locale).
  - `moderator.operationalization.action.route-axiom-mark` — `"Mark as axiom"` (and per-locale).
  - `moderator.operationalization.action.route-defeater` — `"Capture as defeater"` (and per-locale).
  - `moderator.operationalization.action.route-reclassify` — `"Re-classify"` (and per-locale).
  - `moderator.operationalization.action.route-decompose` — `"Decompose"` (and per-locale).
  - `moderator.operationalization.action.route-no-signal` — `"No signal yet"` (and per-locale).
  - `moderator.operationalization.exit.ariaLabel` — `"Exit operationalization mode"` (and per-locale).
  - `moderator.operationalization.exit.tooltip` — `"Exit operationalization mode (Esc)"` (and per-locale).
  - `moderator.operationalization.banner.targetWording` (ICU) — `"Operationalizing: {nodeWording}"` (and per-locale).
- Catalog parity must hold across all three locales (the `i18n-catalogs` parity test fails CI on missing keys).
- The English copy for the prompt question is **verbatim from `docs/methodology.md` L112** to keep the methodology vocabulary stable across the UI and the design doc.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided to be the Acceptance bar.

Extension to `apps/moderator/src/stores/captureStore.test.ts` (or a new sibling file if scope warrants):

- `enterOperationalizationMode('n1')` flips `mode` to `'operationalization'`, sets `operationalizationTargetNodeId` to `'n1'`, and clears `text` / `classification` / `targetEntityId` / `edgeRole` to their initial values (F1-clear discipline).
- `exitOperationalizationMode()` flips `mode` back to `'idle'` and clears `operationalizationTargetNodeId` to `null`. Does NOT re-populate the F1 slices (mirrors `exitDecomposeMode` discipline).
- `reset()` clears `operationalizationTargetNodeId` even when the mode was entered (asserts the new slice is part of `initialCaptureState` spread).
- `setOperationalizationTargetNodeId('n2')` updates the slice without flipping mode (symmetry test).
- Calling `enterOperationalizationMode('n1')` then `enterDecomposeMode('n2')` flips mode to `'decompose'` and sets `decomposeTargetNodeId` to `'n2'`, but **does NOT clear `operationalizationTargetNodeId`** — the operationalization slice is owned by its own enter/exit pair, and an external mode flip leaves stale state (mirrors the existing decompose/interpretive-split mutual-state behavior; the next `enterOperationalizationMode` overwrites). Pin the invariant so a future cross-mode-clear refactor is a deliberate change.

Extension to `apps/moderator/src/graph/GraphCanvasPane.test.tsx` (or wherever the `buildNodeMenuItems` factory tests live):

- `buildNodeMenuItems(target, undefined, undefined, undefined, undefined)` (all handlers omitted) includes a `'run-operationalization-test'` item whose `onSelect` calls `actionStub` (the legacy fallback). Pinned to keep direct-factory unit tests stable.
- `buildNodeMenuItems(target, undefined, undefined, undefined, handler)` with a node target returns an item whose `onSelect` calls `handler(target.id)`.
- `buildNodeMenuItems(target, undefined, undefined, undefined, handler)` with a non-node target falls back to `actionStub` (the existing pattern for the other proposal items).
- The new menu item appears between `'propose-interpretive-split'` and `'propose-meta-disagreement'` in the returned array (DOM-order pinning).
- When the target node's substance facet status is `'agreed'` (disputation outcome `'data'`), the item is `disabled: true`; when `'disputed'` (outcome `'claim'`), the item is `disabled: false`; when the facet is absent (outcome `null`), the item is `disabled: true` (no disputation reading yet — operationalization is premature).

New file `apps/moderator/src/layout/OperationalizationModeExitButton.test.tsx`:

- Renders `null` when mode is not `'operationalization'` (parametric over all eight non-matching `CaptureMode` values).
- Renders the affordance when mode is `'operationalization'` and `operationalizationTargetNodeId` is set; the rendered button carries `data-testid="operationalization-mode-exit"` and the wording overlay carries `data-testid="operationalization-mode-target-wording"` (per-mode `data-testid` discipline established by `<ProposalModeExitAffordance>`).
- Clicking the × button calls `exitOperationalizationMode()` (asserted by reading `useCaptureStore.getState().mode` post-click; expects `'idle'`).
- Pressing Escape while in operationalization mode triggers the same exit (asserted by attaching the keymap and dispatching a synthetic Escape KeyboardEvent; expects `mode === 'idle'`).
- Cross-locale: the ariaLabel + tooltip resolve to non-key strings in en-US / pt-BR / es-419.

New file `apps/moderator/src/layout/OperationalizationCapturePanel.test.tsx`:

- Returns `null` when mode is not `'operationalization'` (parametric).
- Renders the prompt-question header with the localized `moderator.operationalization.prompt.question` text when mode is `'operationalization'`.
- Renders the guidance row with the localized `moderator.operationalization.prompt.guidance` text.
- The target-wording overlay renders `"Operationalizing: {nodeWording}"` when `operationalizationTargetNodeId` points at a node whose `node-created` event is in the WS events log; renders nothing when the events log lacks a matching event (resolver-tolerance assertion mirroring `<ProposalModeExitAffordance>`'s tolerance).
- Renders all five action chips in canonical order (`route-axiom-mark`, `route-defeater`, `route-reclassify`, `route-decompose`, `route-no-signal`), each disabled and aria-disabled, each carrying the matching `data-operationalization-route` and `data-testid` seams.
- Clicking each chip is a no-op (asserted by capturing `mode` before / after and asserting equality — placeholder-discipline pin so the F5 / F6 / F7 owners notice if they accidentally activate the chip before wiring).
- The textarea is editable: typing changes its `value` and clamps text > `MAX_METHODOLOGY_TEXT_LENGTH` to the maximum (defensive paste-bypass test mirroring `<CaptureTextInput>`).
- Cross-locale: prompt question + guidance + answer placeholder + the five action chip labels resolve to non-key strings in en-US / pt-BR / es-419 and differ from en-US.

Extension to `apps/moderator/src/App.test.tsx` (or wherever the `<Operate>` route's integration smoke lives):

- A single integration case: with the capture store in `mode === 'operationalization'` and a target node id set, the `<OperateRoute>`'s bottom strip contains a `data-testid="operationalization-capture-panel"` element (asserting the slot-swap fires), the strip's modeBanner slot contains a `data-testid="operationalization-mode-exit"` element, the `data-testid="mode-banner"` continues to render (asserting the banner co-exists with the new exit button), and the `data-testid="is-ought-prompt"` element is present (asserting the existing prompt continues to mount).
- A negative integration case: with the capture store in `mode === 'idle'`, none of the operationalization-mode test ids are present — the slot-swap fires only in the matching mode.

Extension to `apps/moderator/src/layout/captureKeymap.test.ts` (if not subsumed by the exit-button tests):

- The Escape handler attaches when `mode === 'operationalization'` and detaches when the mode changes. Mirrors the existing decompose / interpretive-split keymap-attach tests (no new infrastructure required; the test pattern is established).

No new tests are added to `wsStore.test.ts`, `selectors.test.ts`, `GraphCanvasPane.test.tsx` (beyond the menu-item factory cases above), `diagnosticHighlights.test.ts`, `diagnosticSuggestions.test.ts`, or `disputationOutcome.test.ts` — this task is a mode-entry + capture-surface overlay; the projection / canvas / chip / suggestions contracts are unchanged.

## Acceptance criteria

1. `apps/moderator/src/stores/captureStore.ts` exports `enterOperationalizationMode(nodeId)` / `exitOperationalizationMode()` / `setOperationalizationTargetNodeId(id)` / `operationalizationTargetNodeId` per Constraints / requirements above; `reset()` clears the new slice via the spread of `initialCaptureState`.
2. `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `buildNodeMenuItems` factory accepts a new fourth optional `onEnterOperationalizationMode?: (nodeId: string) => void` parameter and emits a `'run-operationalization-test'` item between `'propose-interpretive-split'` and `'propose-meta-disagreement'`. The item is `disabled: true` when the target node's substance facet status maps (via `disputationOutcome(...)`) to anything other than `'claim'`. The canvas's `<GraphCanvasPaneInner>` threads the new handler.
3. `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`'s `ProposalMode` union widens to include `'operationalization'`; the `MODE_KEYS` bundle, the `targetNodeId` selector, and the `exitMode` selector each gain a third branch.
4. `apps/moderator/src/layout/OperationalizationModeExitButton.tsx` exists and exports a thin wrapper that renders `<ProposalModeExitAffordance mode="operationalization" />`.
5. `apps/moderator/src/layout/OperationalizationCapturePanel.tsx` exists, exports `OperationalizationCapturePanel`, and renders per Constraints / requirements above. Renders `null` outside operationalization mode.
6. `apps/moderator/src/routes/Operate.tsx` mounts `<OperationalizationModeExitButton />` in the `modeBanner` slot (sibling to the existing decompose / interpretive-split exit buttons) and swaps the `textInput` / `classificationPalette` / `edgeRoleSelector` slots to `<OperationalizationCapturePanel />` / `null` / `null` when `mode === 'operationalization'`. The `proposeAction` slot is `null` in operationalization mode.
7. Catalog keys exist in all three locales under `moderator.operationalization.*` and at `moderator.contextMenu.node.runOperationalization` with the values listed in Constraints / requirements; catalog parity test passes.
8. All Vitest cases listed under "Tests" above are committed and pass.
9. **Playwright e2e**: explicitly deferred to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` (per the sibling [`mod_is_ought_prompt`](mod_is_ought_prompt.md), [`mod_disputation_test_display`](mod_disputation_test_display.md), and [`mod_diagnostic_methodology_suggestions`](mod_diagnostic_methodology_suggestions.md) precedent). **Rationale**: the operationalization-mode surface is reachable through a fully user-driven path (right-click a node → "Run operationalization test" → operationalization mode mounts), BUT the gate's enabling condition is that the target node's substance facet status is `'disputed'` / `'meta-disagreement'`. Driving the gate end-to-end from a Playwright test requires (a) creating a node, (b) proposing its wording + classification, (c) committing the wording + classification, (d) proposing the substance as `disputed` via a `set-node-substance` proposal — and the standalone `set-node-substance` propose-action UI is **not yet shipped** (it is the broader F3 / F7 capture work covered by `mod_resolution_path_picker` and related downstream tasks; the F1 capture flow today only ships `classify-node` + `set-edge-substance`). Reaching the operationalization-mode entry point end-to-end requires that propose path to land first. Per-component DOM coverage (the Vitest cases above) is the load-bearing test contract that takes the e2e's place for this task; the panel's seams (`data-testid="operationalization-capture-panel"`, `data-operationalization-route="<route>"`, `data-operationalization-target-node-id="<id>"`, `data-testid="operationalization-mode-exit"`) are stable for the future e2e.
10. **Deferred-e2e debt inheritance**: the future Playwright spec under `mod_pw_diagnostic_flow` MUST assert that the moderator can right-click a node whose substance is `disputed`, pick "Run operationalization test" from the context menu, and observe the bottom-strip swap to `<OperationalizationCapturePanel>` carrying the localized prompt + target-wording overlay + the five disabled action chips. The stable seams listed in #9 are the contract that future spec inherits. The picker-side wiring (chips fire real propose actions) is the responsibility of `mod_resolution_path_picker` + `mod_axiom_mark_action` + `mod_defeater_flow` e2e contributions, not this task's debt.
11. `pnpm run check` clean.
12. `pnpm run test:smoke` green; the test count rises by the new Vitest cases.
13. `pnpm -F @a-conversa/moderator build` succeeds.
14. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
15. `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_operationalization_mode` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md"` line. The `mod_pw_diagnostic_flow` note is extended with the inherited deferred-e2e contract from Acceptance #10.

## Decisions

- **D1: Mode-entry pattern, not inline chip and not sidebar panel.** Three alternatives considered (one per established F3-leaf pattern):
  1. *Inline chip on the node card* (mirror `<DisputationTestChip>`) — rejected. The disputation chip is a *passive read* of an existing facet (the methodology label for `substance`); operationalization is an **action** the moderator takes (run a test, capture an answer). An inline chip cannot host a transcription textarea or a multi-step capture surface; even if the chip launched a modal it would conflate "see at a glance" (the chip's strength) with "take a multi-second action" (operationalization's reality). The chip + mode-entry split is correct: the chip *signals* the node is a claim, the mode-entry *acts on* the signal.
  2. *Sidebar panel in `'diagnostic-flags'`* (mirror `<DiagnosticSuggestionsPanel>`) — rejected. The suggestions panel is reactive to `activeDiagnostics` (the engine fired a structural diagnostic). Operationalization is not reactive to a diagnostic — it is reactive to the moderator's decision to investigate a claim. The trigger surface is the node (a per-node action), not the diagnostic flag pane (a per-diagnostic-list surface). Mounting in the diagnostic-flags pane would conflate two axes: per-claim methodology actions vs. per-diagnostic resolution actions. The methodology vocabulary lists operationalization as a per-node diagnostic test (`docs/methodology.md` § "Diagnostic tests" L106–141), not as a per-diagnostic resolution path (the catalog at L216–233 is `mod_diagnostic_methodology_suggestions`'s scope).
  3. *Mode-entry via context menu + bottom-strip slot-swap* — chosen. This is the same pattern `mod_decompose_mode` and `mod_interpretive_split_mode` established for the other diagnostic-flow actions (decompose is also a methodology resolution path per `docs/methodology.md` § "Decomposition" L142–161). The pattern is well-tested, well-localized, has a clean exit affordance, and composes cleanly with `<IsOughtPrompt>` (which already gates on operationalization mode). The `<OperationalizationCapturePanel>` becomes the operationalization-flow's `<DecomposeComponentsGrid>` analog — a single mode-owned bottom-strip surface that owns the operationalization-specific capture.

  This is **the third F3 pattern**, not a reuse of either sibling's. The three patterns coexist by axis: the inline chip is per-node methodology labeling, the sidebar panel is per-diagnostic suggestion catalog, the mode-entry is per-action capture flow. Each pattern owns one axis cleanly.

- **D2: Keep `<ProposalModeExitAffordance>` symbol-named; widen the union additively.** Three alternatives considered:
  1. *Rename to `<ModeExitAffordance>`* (and `ProposalMode` to `ExitAffordanceMode`) — would communicate the broader scope. But: two existing call sites (`<DecomposeModeExitButton>` and `<InterpretiveSplitModeExitButton>`) would need their imports updated; the source-stability of the existing symbols is currently 100% (no test file or downstream depends on the name except the two wrappers); a rename is doable but pulls scope into this leaf. Rejected for this leaf — the rename can be done as an additive alias if a fourth or fifth mode lands and the "proposal" qualifier becomes actively misleading.
  2. *Extract a parallel `<DiagnosticModeExitAffordance>`* for the diagnostic modes (operationalization + the pending warrant-elicitation) — would split the body that the interpretive-split refinement explicitly extracted-and-shared. Rejected as a regression of the share-the-body Decision §2 of `mod_interpretive_split_mode.md`.
  3. *Keep the symbol name; widen the union additively* — chosen. The `ProposalMode` type union becomes `'decompose' | 'interpretive-split' | 'operationalization'`. The "proposal" qualifier is a modest scope-language drift (operationalization is not a "proposal" in the strict propose-action sense), but the body shape — a mode-entry that hangs off a target node id, surfaces an exit affordance with target-wording overlay, attaches Escape-key handling, and gates on `mode === targetMode` — is identical across all three modes. The cost of the modest naming drift is small; the cost of either alternative is larger.

- **D3: Land an operationalization-specific `<OperationalizationCapturePanel>` rather than a generalised `<DiagnosticCapturePanel mode={...}>` body.** Two alternatives considered:
  1. *Generalised `<DiagnosticCapturePanel mode={...}>` body* upfront — would be premature. The warrant-elicitation mode (the next sibling) will share structural elements (prompt header, target-wording overlay, textarea, action chips) BUT the methodology vocabulary differs sharply: operationalization's chips are answer-route chips (axiom-mark / defeater / re-classify / decompose / no-signal), warrant-elicitation's chips are warrant-shape chips (per `docs/methodology.md` § "Warrant elicitation" L136–140, the warrant becomes a new node with `bridges-from` / `bridges-to` edges to the data and claim — the chip surface for that mode is "create the warrant node" + "configure its bridge edges", a different action vocabulary). Trying to abstract the body before seeing the second mode's concrete requirements risks an abstraction that fits operationalization but not warrant-elicitation.
  2. *Per-mode component, share when the second mode lands* — chosen. The warrant-elicitation refinement can extract the shared body if the shapes converge (the precedent is `mod_interpretive_split_mode.md` Decision §2 extracting `<ProposalModeExitAffordance>` from `<DecomposeModeExitButton>` only **after** seeing two concrete instances). This task ships the concrete instance; the extraction decision waits for the second instance. This mirrors the same discipline both decompose-flow refinements followed.

  Note: the `<ProposalModeExitAffordance>` body **is** generalised in this leaf (D2 above) because three instances now exist; the *capture panel* body is not generalised because only one instance exists.

- **D4: F1-coupling clear on `enterOperationalizationMode`, mirroring `enterDecomposeMode` / `enterInterpretiveSplitMode`.** Rationale: the same staleness risk applies — a moderator who started typing an F1 statement and then right-clicked a node to run operationalization would otherwise carry stale `text` / `classification` / `targetEntityId` / `edgeRole` into the operationalization flow, where the slots that would render those values (the `<CaptureTextInput>`, the `<ClassificationPalette>`, the `<CaptureTargetAndRole>`) are collapsed to `null`. Clearing on entry keeps the F1 slices in a defined state regardless of mount/unmount timing. Decisions §6 of [`mod_decompose_mode.md`](mod_decompose_mode.md) records the canonical rationale.

- **D5: Always render the `'run-operationalization-test'` menu item; disable it when the disputation outcome is not `'claim'`.** Three alternatives considered:
  1. *Omit the item when the gate fails* — would hide the option entirely for nodes that aren't currently claims, making the menu shorter and "cleaner". But: (a) a moderator scanning the menu would not learn that the option exists; (b) the gate condition is "the node is currently functioning as data / unsettled" — a transient state that changes as the substance facet evolves; the omission would create a confusing "appears and disappears" UX; (c) the test-bar would have to assert two different menu-item lists per facet state, doubling the assertion surface. Rejected.
  2. *Always enable the item; let the moderator open operationalization on any node* — would conflict with the methodology contract that operationalization is a tool for disputed claims (`docs/methodology.md` L130–133). The chip already communicates this; enabling the menu item universally would invite mis-use ("the moderator opens operationalization on an agreed-data node, runs the test, and the participant gives an answer that has no place to go because the methodology has no route for 'I'd retract my agreement on a data node'"). Rejected.
  3. *Always render, gate the `disabled` state on `disputationOutcome(...) === 'claim'`* — chosen. Mirrors the methodology contract verbatim, keeps the menu shape stable across facet states, and uses the load-bearing `disputationOutcome(...)` helper as the gate (no second copy of the methodology mapping). Disabled buttons remain in the tab order with `aria-disabled="true"` so screen readers announce the option exists but is not currently applicable. The disputation-test chip in the same node card explains *why* the item is disabled (the chip says "Data" or "Unsettled" instead of "Claim").

  Gate computation site: the gate is computed in the canvas's `buildNodeMenuItems` call site (the `<GraphCanvasPaneInner>` body has the `target` node's projected data including `facetStatuses.substance`), not in the factory itself — the factory stays a pure shape function that takes the `disabled` boolean as a precomputed argument on the menu item. This keeps the factory's tests pure and the methodology-projection coupling at the call site.

- **D6: Add a parallel `isOperationalizationMode` gate alongside `isProposalMode`, rather than folding operationalization into `isProposalMode`.** Two alternatives considered:
  1. *Rename `isProposalMode` to `isModeOwnedBottomStripSlot`* (or `isStructuralMode`) and include operationalization — would communicate the broader gate. But the existing `isProposalMode` semantically corresponds to "decompose OR interpretive-split", which are the *structural restructure* modes (per `docs/methodology.md` § "Decomposition" / § "Interpretive splits"); operationalization is a *diagnostic test* mode, semantically distinct. Renaming would erase that distinction in the code's variable name.
  2. *Add a parallel `isOperationalizationMode` gate and union them where the slot-swap shape is shared* — chosen. The `textInput` slot becomes a three-arm select; the `classificationPalette` / `edgeRoleSelector` slots become a union (`isOperationalizationMode || isProposalMode ? null : ...`); the `proposeAction` slot keeps its existing two-arm select with a third arm for the new `null` case. The variable names continue to communicate the methodology axis each gate fires on. The cost is one extra `const` line in `<OperateRouteInner>`; the benefit is conceptual clarity preserved.

- **D7: Operationalization-answer textarea uses local component state, not a new `captureStore.operationalizationAnswerText` slice.** Two alternatives considered:
  1. *New store slice `operationalizationAnswerText: string`* with a `setOperationalizationAnswerText(text)` setter — would mirror the per-mode slice pattern (`decomposeComponents`, `interpretiveSplitReadings`) and let the F5 / F6 / F7 wiring read the answer when wiring the route chips. But: (a) this leaf does not propagate the answer anywhere (the chips are inert), so the slice would be write-only in this commit; (b) the slice would need to be cleared on `exitOperationalizationMode()` and `reset()`, adding lifecycle surface; (c) the F5 / F6 / F7 owners may want the slice to carry richer shape (e.g. structured per-route data, captured retraction-condition wording for the defeater route) — pinning a `string` shape now risks an awkward migration. Rejected as premature.
  2. *Local component state via `useState<string>('')`* — chosen. The textarea's value is component-local; entering operationalization mode mounts the component fresh (each entry seeds an empty value), exiting unmounts it. When the F5 / F6 / F7 owner wires the route chips, they can promote to a store slice and shape the slice to fit their handler's needs in the same diff. Mirrors how `<IsOughtPrompt>`'s placeholder actions hold no transient state (the prompt has nothing to capture; this panel captures one freeform string locally).

- **D8: No new `Cmd+O` keyboard shortcut in this leaf — defer to `mod_global_keymap`.** Per [`mod_decompose_mode`](mod_decompose_mode.md) Decision §8 precedent: shipping per-mode shortcuts piecemeal would scatter the keymap discipline across N refinements; the consolidated `mod_global_keymap` task owns the canonical mode-to-shortcut table per `docs/moderator-ui.md` L189–203. The context-menu entry path in this leaf is sufficient for v1 reachability — the same precedent `mod_decompose_mode` followed (decompose shipped without `Cmd+D`).

- **D9: No new wire envelope, no new methodology engine rule, no new diagnostic kind.** The operationalization-mode surface is rendering + entry-path only. The five answer-route chips eventually fire **existing** propose actions (axiom-mark via `mod_axiom_mark_action`, defeater capture via `mod_defeater_flow`, re-classify via the existing `classify-node` proposal kind, decompose via the existing `decompose` proposal kind, no-signal as a soft mode-exit) — no new wire surface is needed. The methodology engine has nothing to fire for "the moderator entered operationalization mode" — entering a mode is a UI-local state change, not an event-log event. (This mirrors `mod_decompose_mode`'s "no event for mode entry" framing.)

- **D10: e2e deferral to `mod_pw_diagnostic_flow` per the F3-leaf precedent.** The operationalization-mode entry surface is reachable through a user gesture (right-click → menu pick), BUT the methodology gate (`disputationOutcome === 'claim'`) requires a node whose substance is `disputed` — and the standalone `set-node-substance` propose-action UI is not yet shipped. The same situation `mod_disputation_test_display` and `mod_diagnostic_methodology_suggestions` faced: the surface is reachable from real user actions, just not yet *triggerable* end-to-end without backdoor seeds. Per ORCHESTRATOR.md UI-stream e2e policy, a deferred e2e MUST identify the future WBS task that inherits the debt; that's `mod_pw_diagnostic_flow` (the F3 Playwright owner, already the canonical inheritor for F3 leaves). The panel's seams + the context-menu item's `data-testid` are stable for the future spec.

- **D11: No new ADR.** The task reuses ReactFlow, Tailwind utilities, the established per-mode `moderator.<mode>.*` i18n namespace convention, the existing `<ProposalModeExitAffordance>` shape (widened additively), the existing `buildNodeMenuItems` shape (widened additively), the existing `useCaptureStore` slice + helper pattern, and the already-shipped `disputationOutcome(...)` helper. The methodology answer-route vocabulary is data (encoded in the chip identifiers + i18n keys), not architecture. No cross-workspace contract changes. The (minor) naming drift introduced by widening `ProposalMode` to include `'operationalization'` is settled in D2 above without requiring an ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Store substrate: `enterOperationalizationMode(nodeId)` / `exitOperationalizationMode()` helpers + `operationalizationTargetNodeId` slice + `setOperationalizationTargetNodeId` setter landed on `useCaptureStore` with atomic single-`set()` discipline and F1-coupling clear ([apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts) + [.test.ts](../../../apps/moderator/src/stores/captureStore.test.ts), 9 new Vitest cases).
- Context-menu entry: new `'run-operationalization-test'` item added to `buildNodeMenuItems` via the optional `onEnterOperationalizationMode?: (nodeId: string) => void` seam, with the methodology-gated `disabled` boolean threaded as the 6th parameter (computed call-site via `disputationOutcome(...) === 'claim'` per Decisions §D5). Added `MenuItem.disabled` + click-guard + `aria-disabled` plumbing on the shared menu component ([apps/moderator/src/graph/GraphCanvasPane.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) + [.test.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.test.tsx), 8 new cases incl. 3 substance-driven integration cases; [apps/moderator/src/graph/GraphContextMenu.tsx](../../../apps/moderator/src/graph/GraphContextMenu.tsx)).
- Exit affordance + reusable seam: `<ProposalModeExitAffordance>`'s `ProposalMode` union widened additively to `'decompose' | 'interpretive-split' | 'operationalization'` (D2 — symbol-named kept, source stability preserved) with new per-mode `MODE_KEYS` entry + selector branches; new `<OperationalizationModeExitButton>` thin wrapper sibling to the two existing per-mode buttons ([apps/moderator/src/layout/ProposalModeExitAffordance.tsx](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx); [apps/moderator/src/layout/OperationalizationModeExitButton.tsx](../../../apps/moderator/src/layout/OperationalizationModeExitButton.tsx) + [.test.tsx](../../../apps/moderator/src/layout/OperationalizationModeExitButton.test.tsx)). Escape priority extended in `captureKeymap` ([.ts](../../../apps/moderator/src/layout/captureKeymap.ts) + [.test.ts](../../../apps/moderator/src/layout/captureKeymap.test.ts), 2 new cases).
- **Reusable `StructuralProposalMode` alias** — new `StructuralProposalMode = Exclude<ProposalMode, 'operationalization'>` alias exported from `ProposalModeExitAffordance.tsx`. The decompose-flow component family (`DecomposeComponentsGrid` / `DecomposeComponentRow` / `DecomposeComponentClassificationPicker` / `DecomposeComponentTextInput` / `ProposalAction` / `useProposeProposalAction`) was narrowed onto it. **This alias is the reusable seam the sibling `mod_warrant_elicitation_mode` task is designed to compose on**: widen `ProposalMode` once more to include `'warrant-elicitation'`, the structural-family stays narrowed via the `Exclude<...>` alias, and the new mode plugs cleanly into the shared exit-affordance body via the same per-mode `MODE_KEYS` recipe.
- Capture surface: inert `<OperationalizationCapturePanel>` lands as a single-panel bottom-strip surface (localized prompt header + target-wording overlay + `MAX_METHODOLOGY_TEXT_LENGTH`-clamped local-state textarea + the five `disabled` + `aria-disabled="true"` answer-route chips with stable `data-operationalization-route="route-{axiom-mark,defeater,reclassify,decompose,no-signal}"` seams per Acceptance #9) ([apps/moderator/src/layout/OperationalizationCapturePanel.tsx](../../../apps/moderator/src/layout/OperationalizationCapturePanel.tsx) + [.test.tsx](../../../apps/moderator/src/layout/OperationalizationCapturePanel.test.tsx)).
- Route integration: `<OperateRoute>` gained the parallel `isOperationalizationMode` gate (D6) and a three-way `textInput` slot-swap that collapses the F1 capture trio onto `<OperationalizationCapturePanel>` when the mode is active; `<OperationalizationModeExitButton/>` mounts unconditionally inside the `modeBanner` slot sibling to the two existing per-mode exit buttons ([apps/moderator/src/routes/Operate.tsx](../../../apps/moderator/src/routes/Operate.tsx); [apps/moderator/src/App.test.tsx](../../../apps/moderator/src/App.test.tsx), 2 new slot-swap smokes).
- i18n: 12 keys × 3 locales added — full `moderator.operationalization.*` subtree (prompt question/guidance, answer placeholder, five answer-route chip labels, exit aria/tooltip, ICU banner target-wording) + `moderator.contextMenu.node.runOperationalization` ([packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json](../../../packages/i18n-catalogs/src/catalogs/)), catalog parity holds.
- **e2e deferred to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow`** per the F3-leaf precedent (Acceptance #9–#10, Decisions §D10) — the operationalization-mode entry surface is user-reachable, but exercising the disputation gate end-to-end requires the standalone `set-node-substance` propose-action UI which is not yet shipped. The panel/exit/menu-item `data-testid` + `data-operationalization-route` seams are stable for the future spec.
- Verification: Vitest 3633 → 3688 (+55 across 5 affected files); `pnpm -F @a-conversa/moderator build` clean; Playwright canvas-visibility regression 4/4 chromium green.
