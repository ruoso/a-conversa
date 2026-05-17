# Moderator diagnostic flow warrant-elicitation mode

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_diagnostic_flow.mod_warrant_elicitation_mode` (see `mod_diagnostic_flow` group at line 440 and this leaf at line 459).

```tji
task mod_warrant_elicitation_mode "Warrant-elicitation mode" {
  effort 1d
  allocate team
  note "Compose on the 3-mode <ProposalModeExitAffordance> + StructuralProposalMode alias (Exclude<ProposalMode, 'operationalization'>) seam landed in the commit closing moderator_ui.mod_diagnostic_flow.mod_operationalization_mode: widen ProposalMode once more to include 'warrant-elicitation', add a per-mode MODE_KEYS entry + selector branches + a thin <WarrantElicitationModeExitButton> wrapper, keep the structural-family components (decompose / interpretive-split) narrowed onto StructuralProposalMode."
}
```

## Effort estimate

**1d.** Confirmed.

This task is the **fourth-mode arm** of the 3-mode pattern that `mod_operationalization_mode` deliberately built as a reusable seam — the `.tji` note above is explicit that this leaf is *composing* on that seam, not extending it architecturally. Concretely the deliverable is a verbatim mirror of the operationalization-mode delivery shape, with:

- **Two new store helpers** on `useCaptureStore` — `enterWarrantElicitationMode(nodeId: string)` and `exitWarrantElicitationMode()` — plus a new `warrantElicitationTargetNodeId: string | null` slice. Atomic-set / F1-clear discipline copied verbatim from `enterOperationalizationMode` / `exitOperationalizationMode` ([apps/moderator/src/stores/captureStore.ts:375](../../../apps/moderator/src/stores/captureStore.ts#L375)).
- **A context-menu entry** `'run-warrant-elicitation-test'` on the node right-click menu, added to `buildNodeMenuItems` via a sixth optional `onEnterWarrantElicitationMode?: (nodeId: string) => void` parameter (same shape as `onEnterOperationalizationMode?`), inserted **between** `'run-operationalization-test'` (currently L275) and `'propose-meta-disagreement'` (currently L284) so the diagnostic-test cluster is contiguous (operationalization → warrant-elicitation, mirroring `docs/methodology.md` § "Diagnostic tests" L106–141 narrative order).
- **A methodology-gated `disabled` state** identical to the operationalization predicate: `disputationOutcome(node.facetStatuses.substance) !== 'claim'`. Rationale under Decisions §D1 (alternative gates considered: `'meta-disagreement'`-only, `null`-allowed, always-enabled).
- **The exit affordance** generalised by widening `<ProposalModeExitAffordance>`'s `ProposalMode` union from `'decompose' | 'interpretive-split' | 'operationalization'` ([apps/moderator/src/layout/ProposalModeExitAffordance.tsx:29](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L29)) to `'decompose' | 'interpretive-split' | 'operationalization' | 'warrant-elicitation'`. The exported `StructuralProposalMode = Exclude<ProposalMode, 'operationalization'>` alias ([apps/moderator/src/layout/ProposalModeExitAffordance.tsx:45](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L45)) **widens** to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` so the decompose-flow component family (`<DecomposeComponentsGrid>` / `<DecomposeComponentRow>` / `<DecomposeComponentClassificationPicker>` / `<DecomposeComponentTextInput>` / `<ProposeAction>` / `useProposeProposalAction`) continues to narrowly accept only the two structural-restructure modes — see Decisions §D2 for the exact alias shape rationale.
- **A thin per-mode wrapper** `<WarrantElicitationModeExitButton>` mounting unconditionally inside `<OperateRoute>`'s `modeBanner` slot, sibling to `<DecomposeModeExitButton>` / `<InterpretiveSplitModeExitButton>` / `<OperationalizationModeExitButton>`.
- **A warrant-elicitation capture-pane surface** `<WarrantElicitationCapturePanel>` — a single text area for the moderator to transcribe the participant's articulated bridge ("the unstated step from X to your conclusion") plus a localized prompt header that restates the warrant-elicitation question + a row of **three placeholder warrant-shape chips** (`route-create-warrant-node`, `route-decompose-claim`, `route-defer`) per Decisions §D3 — the panel is inert in this leaf (placeholder textarea, no propose-action wiring); the chips' downstream wiring (warrant node creation + `bridges-from` / `bridges-to` edge proposal) is owned by future F4 (`mod_draw_edge_flow`) + F2 (`mod_decompose_flow`) consumers.
- **The new i18n catalog keys** under `moderator.warrantElicitation.*` in en-US / pt-BR / es-419 (the panel chrome, the question prompt, the three chip labels, the exit affordance aria/tooltip, the banner target-wording overlay). The mode-banner copy (`moderator.modeBanner.warrant-elicitation.{label,description}`) is **already shipped** ([packages/i18n-catalogs/src/catalogs/en-US.json:400](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L400)) — this task does NOT mint banner keys.
- **Vitest coverage** (store helpers, the new context-menu item, the exit affordance's per-mode branch, the capture panel's render/mode-gating, the `<OperateRoute>` slot-swap integration smoke, catalog parity).
- **A thin inline Playwright spec** asserting the right-click menu shows the disabled warrant-elicitation item against a freshly-proposed node, that the item is `aria-disabled="true"` while the disputation gate is failing, and that the menu / surface seams are stable — see Decisions §D8 + Acceptance §9 for the precise scope and why this avoids growing `mod_pw_diagnostic_flow`'s inherited debt.

No new methodology engine rule, no new wire envelope, no new diagnostic kind, no new propose-action wiring, no new commit-gating, no new keyboard shortcut (`Cmd+W` lands when `mod_keyboard_shortcuts.mod_global_keymap` ships per [docs/moderator-ui.md L193](../../../docs/moderator-ui.md#L193) — deferred here, same precedent as operationalization).

## Inherited dependencies (settled/pending)

Settled (this task plugs into existing seams without changing their contracts):

- `moderator_ui.mod_diagnostic_flow.mod_operationalization_mode` (done — commit `428ded2` rebased to `621c593`, [`mod_operationalization_mode.md`](mod_operationalization_mode.md)). The 3-mode `<ProposalModeExitAffordance>` body, the `StructuralProposalMode` alias, the `MenuItem.disabled` + click-guard + `aria-disabled` plumbing, the per-mode `MODE_KEYS` recipe, the per-mode `data-testid` discipline, the `disputationOutcome(...) === 'claim'` gating precedent, and the per-mode `enter*/exit*` store-helper pattern were all explicitly built in the commit that closed operationalization-mode **so this task can compose on them**. The `.tji` note is direct: "compose on the 3-mode ProposalModeExitAffordance + StructuralProposalMode alias landed in this commit". This task's diff shape should be a verbatim mirror, not a refactor.
- `moderator_ui.mod_diagnostic_flow.mod_disputation_test_display` (done — commit `7bf8cf3`, [`mod_disputation_test_display.md`](mod_disputation_test_display.md)). Pinned `disputationOutcome(...)` ([apps/moderator/src/graph/disputationOutcome.ts](../../../apps/moderator/src/graph/disputationOutcome.ts)) as the load-bearing methodology helper this task's context-menu gate consults — same helper, same gate predicate as operationalization-mode.
- `moderator_ui.mod_diagnostic_flow.mod_is_ought_prompt` (done). Already mounts in **both** operationalization-mode AND warrant-elicitation mode (`mode === 'operationalization' || mode === 'warrant-elicitation'` per [apps/moderator/src/layout/IsOughtPrompt.tsx:16](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L16)) — this task makes the `warrant-elicitation` arm of that gate reachable. The action chip `is-ought-prompt-action-warrant` already exists ([apps/moderator/src/layout/IsOughtPrompt.tsx:53](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L53)) as the "suggested next: elicit the warrant" placeholder; downstream wiring (clicking it enters warrant-elicitation mode) is **explicitly NOT in scope for this leaf** (see Decisions §D6) — the entry path through the right-click context menu is sufficient v1.
- `moderator_ui.mod_diagnostic_flow.mod_diagnostic_methodology_suggestions` (done — commit `2311144`, [`mod_diagnostic_methodology_suggestions.md`](mod_diagnostic_methodology_suggestions.md)). Pinned the per-diagnostic sidebar pattern (explicitly NOT the right pattern for this leaf — see Decisions §D1 of `mod_operationalization_mode.md`; same axis distinction applies here).
- `moderator_ui.mod_capture_flow` (done). The bottom-strip capture pane substrate, `<BottomStripCapture>`'s five sub-slots, `<ModeBanner>` reading `captureStore.mode`, and `useCaptureStore`'s `setMode` API are all in place.
- `moderator_ui.mod_mode_banner` (done). The `moderator.modeBanner.warrant-elicitation.{label,description}` keys are already shipped in all three locales (en-US: `"Warrant elicitation"` / `"Surface the warrant that licenses the inference from data to claim."` — [packages/i18n-catalogs/src/catalogs/en-US.json:400](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L400); pt-BR and es-419 covered by the catalog-parity gate).
- `frontend_i18n.i18n_diagnostic_descriptions` (done). Pinned `moderator.diagnostic.*` + the per-mode `moderator.<mode>.*` namespace convention; the new `moderator.warrantElicitation.*` subtree slots in alongside.
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done). The node-card surface the right-click context menu attaches to is unchanged.
- `moderator_ui.mod_graph_rendering.mod_proposed_entity_canvas_visibility` (done). A right-clickable node exists immediately after a `propose-classify-node` is committed — the Playwright spec relies on this propose→render path (Decisions §D8).

Pending (this task feeds these, but does NOT depend on them):

- `moderator_ui.mod_keyboard_shortcuts.mod_global_keymap` — will own the `Cmd+W` shortcut per [docs/moderator-ui.md L193](../../../docs/moderator-ui.md#L193). This task explicitly defers shortcut binding to that task; the context-menu entry is the v1 entry path (same precedent as `mod_decompose_mode` and `mod_operationalization_mode`).
- `moderator_ui.mod_draw_edge_flow` (`mod_drag_to_create_edge` + `mod_role_palette_on_drop`) — the F4 task that ships the gesture to create the `bridges-from` and `bridges-to` edges from the new warrant node to the data and claim. The three placeholder chips on `<WarrantElicitationCapturePanel>` (`route-create-warrant-node`, `route-decompose-claim`, `route-defer`) pin the contract those downstream tasks will switch on (the `route-create-warrant-node` chip will fire a node-creation proposal + two edge-creation proposals; the `route-decompose-claim` chip routes back into `mod_decompose_mode`).
- `moderator_ui.mod_diagnostic_resolution_flow.mod_resolution_path_picker` — the F7 task that turns the inert chips into real propose actions (mirroring how operationalization-mode's inert chips will eventually become picker-driven).
- `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` — full F3 Playwright spec. This task lands a **thin inline spec** for the warrant-elicitation surface (Decisions §D8 + Acceptance §9) so the inherited-debt count on `mod_pw_diagnostic_flow` does NOT grow by a fourth refinement.

## What this task is

Land the **entry path + mode-aware capture surface** for the warrant-elicitation diagnostic test — the methodology's tool for surfacing the unstated bridge between data and claim when role disagreement persists. The moderator right-clicks a node whose substance is in `'claim'` outcome (per `disputationOutcome(...)`), picks "Elicit warrant", and the capture pane flips into warrant-elicitation mode: the mode banner labels the flow, the exit affordance is wired (Esc / × button), the bottom-strip's primary content swaps from the F1 statement-input grid to a dedicated `<WarrantElicitationCapturePanel>` that surfaces the warrant-elicitation prompt + a transcription area for the participant's articulated bridge + three placeholder warrant-shape chips, and the existing `<IsOughtPrompt>` continues to mount in the mode-banner slot (it already gates on `mode === 'warrant-elicitation'`).

Concretely, this task lands:

1. **A store-coupled mode-entry helper** `enterWarrantElicitationMode(nodeId)` exported from `useCaptureStore`:
   ```ts
   enterWarrantElicitationMode: (nodeId: string) => void;
   exitWarrantElicitationMode: () => void;
   warrantElicitationTargetNodeId: string | null;
   setWarrantElicitationTargetNodeId: (id: string | null) => void;
   ```
   `enterWarrantElicitationMode(nodeId)` is an atomic single-`set()` that flips `mode = 'warrant-elicitation'`, sets `warrantElicitationTargetNodeId = nodeId`, and clears the F1 capture-flow slices (`text = ''`, `classification = null`, `targetEntityId = null`, `edgeRole = null`) so a stale F1 draft does not bleed into the warrant-elicitation flow. `exitWarrantElicitationMode()` is the symmetric atomic reset back to `mode = 'idle'` + `warrantElicitationTargetNodeId = null`. `reset()` (already shipped) clears the new slice via the spread of `initialCaptureState`. **Verbatim mirror of `enterOperationalizationMode` / `exitOperationalizationMode`** per Decision §D4 of [`mod_operationalization_mode.md`](mod_operationalization_mode.md) — the F1-clear rationale and atomic-set discipline carry over.

2. **A context-menu entry** `'run-warrant-elicitation-test'` on the node right-click menu, added to `buildNodeMenuItems` via a new optional `onEnterWarrantElicitationMode?: (nodeId: string) => void` parameter (sixth in the parameter list, after the existing `disabledRunOperationalizationTest?`). The canvas threads `(nodeId) => useCaptureStore.getState().enterWarrantElicitationMode(nodeId)` as the argument. When the optional handler is omitted (direct unit-test invocations of the factory), the legacy `actionStub('run-warrant-elicitation-test', target)` is used.

   The menu item's label key is `moderator.contextMenu.node.runWarrantElicitation` (new — added in this leaf's i18n delta).

   **Methodology-gated disabled state**: identical predicate to operationalization-mode (`disputationOutcome(node.facetStatuses.substance) !== 'claim'`). Per Decisions §D1 this is the most defensible gate against the methodology text "when role disagreement persists" (L138) — both `disputed` and `meta-disagreement` substance statuses map to `'claim'` via `disputationOutcome(...)`, and "role disagreement persists" is exactly the broader contested-claim condition. Gate computation site: the canvas's `<GraphCanvasPaneInner>` body precomputes a second boolean `disabledRunWarrantElicitationTest` from the same `substanceStatus` reading and threads it through as a seventh argument (or eighth, if we keep the operationalization arg position) to `buildNodeMenuItems`. See Decisions §D1 for the full alternatives analysis (meta-disagreement-only, always-enabled, etc.).

3. **A mode-aware exit affordance** `<WarrantElicitationModeExitButton>` (thin wrapper, source-stable with the three sibling exit buttons). The shared `<ProposalModeExitAffordance mode={...}>` body is generalised additively:
   - The `ProposalMode` union widens from 3 to 4 modes: `'decompose' | 'interpretive-split' | 'operationalization' | 'warrant-elicitation'`.
   - The `StructuralProposalMode = Exclude<ProposalMode, 'operationalization'>` alias widens to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` (Decisions §D2) so the structural-restructure components stay narrowed onto `'decompose' | 'interpretive-split'` only.
   - `MODE_KEYS` gains a `'warrant-elicitation'` entry pointing at `moderator.warrantElicitation.exit.{ariaLabel,tooltip}` + `moderator.warrantElicitation.banner.targetWording`.
   - The `targetNodeId` selector gains a fourth branch reading `warrantElicitationTargetNodeId`.
   - The `exitMode` selector gains a fourth branch reading `exitWarrantElicitationMode`.
   - The Escape-key handler attaches to the keymap when `mode === 'warrant-elicitation'` (no keymap-internal change required — the body's existing `mode === targetMode` gate carries the new mode through).

4. **A new capture-pane surface** `<WarrantElicitationCapturePanel>` ([apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx](../../../apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx) — new file) that the bottom strip mounts in place of `<CaptureTextInput>` + `<ClassificationPalette>` + `<CaptureTargetAndRole>` when `mode === 'warrant-elicitation'`. The panel renders:

   - A header row with the warrant-elicitation prompt: localized `t('moderator.warrantElicitation.prompt.question')` — `"What's the unstated bridge from X to your conclusion?"` in en-US, mirroring [docs/methodology.md L138](../../../docs/methodology.md#L138) verbatim (with `X` substituted by the target node's wording via ICU interpolation, see Decisions §D5).
   - A target-wording overlay (right of the prompt) showing the wording of the node being elicited — reuses `resolveProposalTargetWording(events, warrantElicitationTargetNodeId)` from `<ProposalModeExitAffordance>` (the helper is mode-neutral and already exported — [apps/moderator/src/layout/ProposalModeExitAffordance.tsx:59](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L59)).
   - A guidance row (smaller text below the header): localized `moderator.warrantElicitation.prompt.guidance` — the one-sentence reminder that the articulated warrant becomes a new node bridging data and claim.
   - A transcription textarea where the moderator types the participant's articulated bridge. The textarea is **placeholder-only in this leaf**: its value is local component state (`useState<string>('')`), NOT propagated to any propose action — Decision §D7 of [`mod_operationalization_mode.md`](mod_operationalization_mode.md) carried over verbatim (local state over store slice; F2/F4/F7 owners promote later if they need to). Defensive `MAX_METHODOLOGY_TEXT_LENGTH` clamp mirrors `<CaptureTextInput>` and `<OperationalizationCapturePanel>`.
   - A row of **three placeholder warrant-shape chips** (all `disabled` + `aria-disabled="true"`, mirroring `<OperationalizationCapturePanel>`'s chip pattern):
     - `data-warrant-elicitation-route="route-create-warrant-node"` — "Create warrant node" (the canonical path per `docs/methodology.md` L140; the articulated bridge becomes a new node with `bridges-from` and `bridges-to` edges; downstream wires to a node-creation propose action + two edge-creation propose actions in `mod_draw_edge_flow` / F4).
     - `data-warrant-elicitation-route="route-decompose-claim"` — "Decompose the claim" (the "claim + implicit warrant" decomposition seam per `docs/methodology.md` L149; downstream re-routes into `mod_decompose_mode` against the original claim).
     - `data-warrant-elicitation-route="route-defer"` — "Defer — no clear bridge" (the no-op route that exits warrant-elicitation mode without proposing anything; downstream may wire to a soft route-back-to-idle).

5. **An `<OperateRoute>` integration**: when `mode === 'warrant-elicitation'` the bottom-strip's `textInput` / `classificationPalette` / `edgeRoleSelector` slots collapse to the unified `<WarrantElicitationCapturePanel>` (single panel spanning the strip's body width, mirroring the operationalization-mode slot-swap convention at [apps/moderator/src/routes/Operate.tsx:183](../../../apps/moderator/src/routes/Operate.tsx#L183)), the `proposeAction` slot stays null (no propose-action is wired in this leaf — placeholder), and the `modeBanner` slot continues to mount `<ModeBanner />` + `<IsOughtPrompt />` + the three existing per-mode exit buttons + **the new `<WarrantElicitationModeExitButton />`**.

   The cleanest shape (Decisions §D2 of operationalization-mode + Decisions §D2 here): add a parallel `isWarrantElicitationMode` gate alongside the existing `isProposalMode` / `isOperationalizationMode` gates. The `textInput` slot becomes a four-arm select; the `classificationPalette` / `edgeRoleSelector` slots widen the `null` union to include the warrant-elicitation gate; the `proposeAction` slot adds the warrant-elicitation `null` arm.

6. **The new i18n catalog keys** under `moderator.warrantElicitation.*` and one menu-label key under `moderator.contextMenu.node.runWarrantElicitation`, in en-US / pt-BR / es-419:
   - `moderator.contextMenu.node.runWarrantElicitation` — `"Elicit warrant"` / `"Eliciar a garantia"` / `"Elicitar la garantía"`.
   - `moderator.warrantElicitation.prompt.question` (ICU) — `"What's the unstated bridge from \"{nodeWording}\" to your conclusion?"` / `"Qual é a ponte não declarada de \"{nodeWording}\" para a sua conclusão?"` / `"¿Cuál es el puente no declarado de \"{nodeWording}\" hasta tu conclusión?"`. (ICU template per Decisions §D5 — substitutes the target node's wording so the prompt is grounded in the specific claim under elicitation.)
   - `moderator.warrantElicitation.prompt.guidance` — `"Capture the participant's articulated bridge below. The bridge becomes a new node with bridges-from and bridges-to edges connecting the data and the claim — often the actual disagreement."` (and per-locale).
   - `moderator.warrantElicitation.answer.placeholder` — `"Type the participant's articulated bridge..."` (and per-locale).
   - `moderator.warrantElicitation.action.route-create-warrant-node` — `"Create warrant node"` / `"Criar nó de garantia"` / `"Crear nodo de garantía"`.
   - `moderator.warrantElicitation.action.route-decompose-claim` — `"Decompose the claim"` / `"Decompor a alegação"` / `"Descomponer la afirmación"`.
   - `moderator.warrantElicitation.action.route-defer` — `"Defer — no clear bridge"` / `"Adiar — sem ponte clara"` / `"Aplazar — sin puente claro"`.
   - `moderator.warrantElicitation.exit.ariaLabel` — `"Exit warrant elicitation mode"` (and per-locale).
   - `moderator.warrantElicitation.exit.tooltip` — `"Exit warrant elicitation mode (Esc)"` (and per-locale).
   - `moderator.warrantElicitation.banner.targetWording` (ICU) — `"Eliciting warrant for: {nodeWording}"` / `"Elicitando garantia para: {nodeWording}"` / `"Elicitando garantía para: {nodeWording}"`.
   - Catalog parity must hold across all three locales.

7. **A thin inline Playwright spec** at `tests/e2e/moderator-warrant-elicitation-mode.spec.ts` (new file — Decisions §D8) asserting the right-click menu surface is reachable, the new item renders disabled against a freshly-proposed node (the disputation gate fails because no substance proposal has landed), and the surface seams (`data-testid="graph-context-menu-item-run-warrant-elicitation-test"`, the `aria-disabled` attribute) are stable. This avoids growing `mod_pw_diagnostic_flow`'s inherited-debt count to four — see Decisions §D8 for the full scoping argument.

This task is rendering + entry-path only. It does NOT capture or fire any propose-action (the three route chips are inert), does NOT modify any wire envelope, does NOT add a methodology engine rule, does NOT add a `Cmd+W` keyboard shortcut, does NOT change diagnostic detection, does NOT change `<IsOughtPrompt>` or the diagnostic-suggestions panel, does NOT wire the `is-ought-prompt-action-warrant` chip's `onClick` (see Decisions §D6).

## Why it needs to be done

Per [docs/methodology.md § "Warrant elicitation" L136–141](../../../docs/methodology.md#L136), warrant elicitation is the methodology's tool for surfacing the unstated bridge between data and claim — invoked when role disagreement persists ("is X data or is X the claim?"). The articulated warrant is itself a new node that often *is* the actual fact-or-value disagreement, and surfacing it dissolves the original role dispute.

Per [docs/moderator-ui.md L77](../../../docs/moderator-ui.md#L77) (F3 § "Warrant elicitation"):

> Warrant elicitation (Cmd+W): when role disagreement persists, capture the unstated bridge as a new node with `bridges-from` and `bridges-to` edges to the data and claim.

Today the moderator has no UI surface to enter that test: the mode value exists in `CaptureMode` ([apps/moderator/src/stores/captureStore.ts:139](../../../apps/moderator/src/stores/captureStore.ts#L139)), the banner copy exists ([packages/i18n-catalogs/src/catalogs/en-US.json:400](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L400)), `<IsOughtPrompt>` already gates on the mode ([apps/moderator/src/layout/IsOughtPrompt.tsx:16](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L16)), and the IsOughtPrompt's `is-ought-prompt-action-warrant` chip ([apps/moderator/src/layout/IsOughtPrompt.tsx:53](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L53)) already exists as the placeholder "suggested next" affordance — but **nothing calls `setMode('warrant-elicitation')`** anywhere in the app. The F3 diagnostic flow has the same gap warrant-elicitation had before `mod_operationalization_mode` landed for operationalization.

This is also the **last F3 leaf gating M4**. Once warrant-elicitation closes, the only remaining barriers to `m_moderator_mvp` propagating are the two `graph_rendering` tech-debt leaves (depending on the gating analysis). Closing this leaf with the same surface-area discipline as its three siblings (mod_is_ought_prompt, mod_disputation_test_display, mod_operationalization_mode) keeps the F3 cluster shape coherent for the eventual M4 review.

The cost of leaving this gap open is asymmetric with operationalization:

- The F3 diagnostic flow's full catalog has all four tests UI-reachable except this one — closing it makes the F3 surface complete.
- The `<IsOughtPrompt>` panel's `is-ought-prompt-action-warrant` chip points at a nonexistent destination — it is disabled today, but the **mode-entry destination** must exist before that chip can be wired.
- The `moderator.warrantElicitation.*` i18n vocabulary stays uncoined, blocking F4 `bridges-from` / `bridges-to` edge-role wiring (which references the warrant-elicitation flow as its triggering surface in the methodology vocabulary).
- `mod_resolution_path_picker` (F7) would have to ship the mode-entry chrome AND the chip-wiring in one task, increasing F7's scope.

Splitting the entry path + capture surface (this task) from the wiring of the three warrant-shape chips (F4 / F2 / F7) is the same split the three sibling F3 tasks made.

## Inputs / context

Code seams the implementation plugs into:

- [apps/moderator/src/stores/captureStore.ts L132–141](../../../apps/moderator/src/stores/captureStore.ts#L132) — `CaptureMode` discriminated union (`'warrant-elicitation'` already present at L139). No type-union edit needed.
- [apps/moderator/src/stores/captureStore.ts L338–386](../../../apps/moderator/src/stores/captureStore.ts#L338) — `operationalizationTargetNodeId` slice + helpers. The warrant-elicitation slice + helpers mirror this block verbatim.
- [apps/moderator/src/stores/captureStore.ts L388–413](../../../apps/moderator/src/stores/captureStore.ts#L388) — `initialCaptureState` constant. Add `warrantElicitationTargetNodeId: null` here so `reset()` clears it via the spread (mirroring the existing `operationalizationTargetNodeId: null` line at L412).
- [apps/moderator/src/stores/captureStore.ts L554–572](../../../apps/moderator/src/stores/captureStore.ts#L554) — `setOperationalizationTargetNodeId` / `enterOperationalizationMode` / `exitOperationalizationMode` implementation. The warrant-elicitation helpers mirror these atomic `set()` calls.
- [apps/moderator/src/graph/GraphCanvasPane.tsx L244–299](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L244) — `buildNodeMenuItems(target, onOpenAxiomMarkSubmenu?, onEnterDecomposeMode?, onEnterInterpretiveSplitMode?, onEnterOperationalizationMode?, disabledRunOperationalizationTest?)`. Extend the signature with `onEnterWarrantElicitationMode?: (nodeId: string) => void` and `disabledRunWarrantElicitationTest?: boolean`; insert the new `'run-warrant-elicitation-test'` item between the existing `'run-operationalization-test'` (L275) and `'propose-meta-disagreement'` (L284).
- [apps/moderator/src/graph/GraphCanvasPane.tsx L987–1028](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L987) — `<GraphCanvasPaneInner>`'s `buildNodeMenuItems` call site. Add `const disabledRunWarrantElicitationTest = disputationOutcome(substanceStatus) !== 'claim';` next to the operationalization gate computation (L1005), thread `enterWarrantElicitationMode` and `disabledRunWarrantElicitationTest` as additional arguments.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L29](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L29) — `ProposalMode` union. Widen additively from 3 to 4 modes.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L45](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L45) — `StructuralProposalMode = Exclude<ProposalMode, 'operationalization'>` alias. Widen to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` so the structural-restructure component family stays narrowed onto `'decompose' | 'interpretive-split'` only (Decisions §D2).
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L81–97](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L81) — `MODE_KEYS` per-mode key bundle. Add the `'warrant-elicitation'` entry pointing at the new `moderator.warrantElicitation.exit.*` and `moderator.warrantElicitation.banner.targetWording` keys.
- [apps/moderator/src/layout/ProposalModeExitAffordance.tsx L109–122](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx#L109) — the `targetNodeId` / `exitMode` per-mode branch selectors. Convert the three-arm nested ternaries into a small lookup or four-arm selector reading `warrantElicitationTargetNodeId` / `exitWarrantElicitationMode`. (The same pattern the 3-mode generalisation followed — `mod_operationalization_mode` Decisions §D2.)
- [apps/moderator/src/layout/DecomposeModeExitButton.tsx](../../../apps/moderator/src/layout/DecomposeModeExitButton.tsx) / [InterpretiveSplitModeExitButton.tsx](../../../apps/moderator/src/layout/InterpretiveSplitModeExitButton.tsx) / [OperationalizationModeExitButton.tsx](../../../apps/moderator/src/layout/OperationalizationModeExitButton.tsx) — thin wrapper templates. Mirror as `apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx`.
- [apps/moderator/src/layout/OperationalizationCapturePanel.tsx](../../../apps/moderator/src/layout/OperationalizationCapturePanel.tsx) — the closest sibling capture panel; the warrant-elicitation panel mirrors its structure (header + guidance + textarea + chip row + `MAX_METHODOLOGY_TEXT_LENGTH` clamp + self-gate on `mode === <targetMode>`) with three chips instead of five and an ICU-templated prompt (Decisions §D3 + §D5).
- [apps/moderator/src/layout/IsOughtPrompt.tsx L16](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L16) — `mode === 'operationalization' || mode === 'warrant-elicitation'` gate. Unchanged — the prompt already mounts in warrant-elicitation mode and this task makes that mount reachable.
- [apps/moderator/src/routes/Operate.tsx L125–225](../../../apps/moderator/src/routes/Operate.tsx#L125) — the mode-driven slot-swap pattern with `isProposalMode` and the parallel `isOperationalizationMode` gates. Add the parallel `isWarrantElicitationMode` gate; extend the `textInput` slot's expression to a four-arm select; extend the `classificationPalette` / `edgeRoleSelector` / `proposeAction` slot expressions to include the warrant-elicitation arm (Decisions §D2). The `modeBanner` slot's children list gains `<WarrantElicitationModeExitButton />`.
- [apps/moderator/src/graph/disputationOutcome.ts](../../../apps/moderator/src/graph/disputationOutcome.ts) — `disputationOutcome(substanceStatus): 'data' | 'claim' | 'unsettled'`. Imported by `<GraphCanvasPaneInner>` to decide both the operationalization-item disabled state AND the warrant-elicitation-item disabled state (same predicate per Decisions §D1).
- [apps/moderator/src/graph/StatementNode.tsx L113](../../../apps/moderator/src/graph/StatementNode.tsx#L113) — `StatementNodeData.facetStatuses`. The disabled-state gate reads `data.facetStatuses.substance` off the projected node data.
- [apps/moderator/src/layout/captureKeymap.ts](../../../apps/moderator/src/layout/captureKeymap.ts) — the keymap attaches `onExitMode` only while in the matching mode. The `<ProposalModeExitAffordance>` body already gates on `mode === targetMode`; this task extends that gate to warrant-elicitation mode via the generalised body, no keymap-internal change required.
- [packages/i18n-catalogs/src/catalogs/en-US.json L400–423](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L400) — existing `moderator.modeBanner.warrant-elicitation.*` keys (already shipped, no edit needed). The new `moderator.warrantElicitation.*` subtree lives alongside.
- [packages/shared-types/src/index.ts (`MAX_METHODOLOGY_TEXT_LENGTH`)](../../../packages/shared-types/src/index.ts) — the defensive paste-bypass clamp. The warrant-elicitation answer textarea reuses it.

Methodology / design references:

- [docs/methodology.md L136–141](../../../docs/methodology.md#L136) — the canonical warrant-elicitation definition: invoked when role disagreement persists; the articulated warrant becomes a new node bridging data and claim.
- [docs/methodology.md L130–134](../../../docs/methodology.md#L130) — the disputation-test gate (substance `disputed` / `meta-disagreement` → node is a claim). Same gate the operationalization-mode entry uses.
- [docs/methodology.md L149](../../../docs/methodology.md#L149) — the "claim + implicit warrant" decomposition seam. The `route-decompose-claim` chip on the new panel maps to this seam.
- [docs/methodology.md L80](../../../docs/methodology.md#L80) — "extracting a warrant creates a node and an edge" — the warrant-creation route's wire shape (the `route-create-warrant-node` chip).
- [docs/moderator-ui.md L77](../../../docs/moderator-ui.md#L77) — F3 § "Warrant elicitation" — the canonical UI contract for the entry path, the capture-pane behavior, and the bridges-from/bridges-to edge creation.
- [docs/moderator-ui.md L79](../../../docs/moderator-ui.md#L79) — "The mode banner indicates which test is in progress so participants and audience know what's being asked." Confirms the mode-banner + exit-affordance + target-wording-overlay chrome this task lands is on-contract.
- [docs/moderator-ui.md L179](../../../docs/moderator-ui.md#L179) — the canonical mode-banner mode list includes "Elicit warrant".
- [docs/moderator-ui.md L193](../../../docs/moderator-ui.md#L193) — `Cmd+W` for warrant-elicitation (the deferred shortcut, owned by `mod_global_keymap`).

Predecessor refinements:

- [`mod_operationalization_mode`](mod_operationalization_mode.md) — the direct sibling whose 3-mode generalisation this task composes on. The Decisions block carries over almost verbatim (the chosen pattern: mode-entry via context menu + bottom-strip slot-swap; the chosen abstraction: keep the symbol name and widen the union additively; the chosen capture-surface scope: per-mode component instead of premature generalisation; the chosen F1-clear discipline; the chosen menu-item always-render-and-disable pattern; the chosen local-state-over-store-slice for the textarea; the chosen `Cmd+W` deferral to `mod_global_keymap`).
- [`mod_disputation_test_display`](mod_disputation_test_display.md) — pinned the `disputationOutcome(...)` helper this task's context-menu gate consults.
- [`mod_is_ought_prompt`](mod_is_ought_prompt.md) — pinned the `moderator.diagnostic.*` i18n namespace + the disabled-placeholder action chip pattern + the inline-mode-banner-chrome surface convention + the `mode === 'warrant-elicitation'` gate this task's flow makes reachable + the existing `is-ought-prompt-action-warrant` chip (the placeholder destination affordance whose downstream wiring is deferred — Decisions §D6).
- [`mod_diagnostic_methodology_suggestions`](mod_diagnostic_methodology_suggestions.md) — pinned the per-diagnostic sidebar pattern (explicitly NOT the right fit here — same axis distinction as `mod_operationalization_mode` Decisions §D1).
- [`mod_decompose_mode`](mod_decompose_mode.md) — pinned the original mode-entry pattern; the `Cmd+<key>` deferral precedent.
- [`mod_interpretive_split_mode`](mod_interpretive_split_mode.md) — generalised the exit affordance the first time (extract-and-share into `<ProposalModeExitAffordance>`).
- [`mod_mode_banner`](mod_mode_banner.md) — pinned the `moderator.modeBanner.<mode>.{label,description}` catalog discipline (already includes warrant-elicitation).

ADRs the implementation cites:

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface. The context-menu integration runs through the existing node-card menu pipeline; no new ReactFlow seam.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case + the thin Playwright spec.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized prompt + action chips + banner overlay; ICU templates for both `prompt.question` and `banner.targetWording`.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the entity / facet separation is respected: the context-menu gate reads from the facet projection (entity-derived view of facet status), the mode-entry does not emit any facet-layer event, the placeholder chips do not capture or fire facet-layer events.

**No new ADR is required.** The task is a verbatim composition on the 3-mode seam that `mod_operationalization_mode` built explicitly for this task to reuse. The methodology vocabulary for warrant-elicitation is data (encoded in the chip identifiers + i18n keys), not architecture. The chosen gate predicate matches an existing precedent (operationalization's gate). No cross-workspace contract changes.

## Constraints / requirements

### Store helpers (pure, no React, no side effects beyond the `set()` calls)

- **File**: extend `apps/moderator/src/stores/captureStore.ts`.
- **New slice**: `warrantElicitationTargetNodeId: string | null` on `CaptureState`. Initial value `null`. Added to `initialCaptureState` so `reset()` clears it via the spread (alongside the existing `operationalizationTargetNodeId: null`).
- **New setter**: `setWarrantElicitationTargetNodeId(id: string | null): void` — symmetric with `setOperationalizationTargetNodeId`, exists for symmetry and test seams.
- **New coupled helper** `enterWarrantElicitationMode(nodeId: string): void` — atomic single-`set()`:
  ```ts
  enterWarrantElicitationMode: (nodeId) =>
    set({
      mode: 'warrant-elicitation',
      warrantElicitationTargetNodeId: nodeId,
      // F1-coupling clear (mirrors enterOperationalizationMode / enterDecomposeMode):
      // a stale in-progress F1 draft must not bleed into the warrant-elicitation flow.
      text: '',
      classification: null,
      targetEntityId: null,
      edgeRole: null,
    }),
  ```
- **New coupled helper** `exitWarrantElicitationMode(): void` — atomic single-`set()`:
  ```ts
  exitWarrantElicitationMode: () =>
    set({
      mode: 'idle',
      warrantElicitationTargetNodeId: null,
    }),
  ```
- **Existing `reset()` already clears the new slice via the spread of `initialCaptureState`** (the same way it clears the three existing per-mode target slices); no change to `reset()`.

### Context-menu entry (`buildNodeMenuItems` extension)

- **File**: edit `apps/moderator/src/graph/GraphCanvasPane.tsx`.
- **Two new optional parameters** on `buildNodeMenuItems`:
  - `onEnterWarrantElicitationMode?: (nodeId: string) => void`. Inserted as the sixth optional argument (after `disabledRunOperationalizationTest?`).
  - `disabledRunWarrantElicitationTest?: boolean`. Inserted as the seventh optional argument.
- **New menu item** `id: 'run-warrant-elicitation-test'`, `labelKey: 'moderator.contextMenu.node.runWarrantElicitation'`. Inserted **immediately after** `'run-operationalization-test'` (currently L275–282) and **before** `'propose-meta-disagreement'` (currently L284). The contiguous placement makes the two diagnostic-test items read together in the menu, matching the methodology's narrative grouping at `docs/methodology.md` L106–141.
- **`onSelect`** mirrors the operationalization pattern verbatim:
  ```ts
  onSelect:
    target.kind === 'node' && target.id !== null && onEnterWarrantElicitationMode
      ? () => onEnterWarrantElicitationMode(target.id as string)
      : () => actionStub('run-warrant-elicitation-test', target),
  disabled: disabledRunWarrantElicitationTest ?? false,
  ```
- **Canvas call site** (`<GraphCanvasPaneInner>`): add the gate computation and thread the new arguments:
  ```ts
  const substanceStatus = targetNode?.data.facetStatuses.substance;
  const disabledRunOperationalizationTest = disputationOutcome(substanceStatus) !== 'claim';
  const disabledRunWarrantElicitationTest = disputationOutcome(substanceStatus) !== 'claim';
  menuItems = buildNodeMenuItems(
    contextMenu.target,
    /* onOpenAxiomMarkSubmenu */ () => { /* ... existing body ... */ },
    enterDecomposeMode,
    enterInterpretiveSplitMode,
    enterOperationalizationMode,
    disabledRunOperationalizationTest,
    enterWarrantElicitationMode,
    disabledRunWarrantElicitationTest,
  );
  ```
  The two gates are independent constants today (both reading `substanceStatus` and computing the same predicate) so a future task that diverges the predicate for warrant-elicitation can do so without churning the call shape.

### Mode-aware exit affordance generalisation

- **File**: edit `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`.
- **Widen the `ProposalMode` union** from 3 to 4 modes: `'decompose' | 'interpretive-split' | 'operationalization' | 'warrant-elicitation'`. Symbol-name **preserved** (Decisions §D2 — same source-stability rationale `mod_operationalization_mode` settled).
- **Widen the `StructuralProposalMode` alias** to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` so the structural-restructure component family (`<DecomposeComponentsGrid>` / `<DecomposeComponentRow>` / `<DecomposeComponentClassificationPicker>` / `<DecomposeComponentTextInput>` / `<ProposeAction>` / `useProposeProposalAction`) stays narrowed onto `'decompose' | 'interpretive-split'` only. The alias's *meaning* ("the structural-restructure modes only") is preserved; the *implementation* of the exclusion gains a second mode (Decisions §D2 details the alias-widening choice vs. alternatives).
- **Extend `MODE_KEYS`** with the new `'warrant-elicitation'` entry pointing at the new keys (see i18n section below).
- **Extend the `targetNodeId` selector** (currently a three-arm nested ternary at L109–115) to a four-arm form. A small lookup keeps it readable:
  ```ts
  const targetNodeId = useCaptureStore((s) => {
    switch (targetMode) {
      case 'decompose':
        return s.decomposeTargetNodeId;
      case 'interpretive-split':
        return s.interpretiveSplitTargetNodeId;
      case 'operationalization':
        return s.operationalizationTargetNodeId;
      case 'warrant-elicitation':
        return s.warrantElicitationTargetNodeId;
    }
  });
  ```
  Symmetric four-arm extension for `exitMode`. (Switch-over-nested-ternary chosen at 4 arms — Decisions §D2 records the readability threshold.)
- **No keymap change required** — `attachCaptureKeymap({ onExitMode })` is already gated internally on `useCaptureStore.getState().mode === <matching mode>` via the body's `mode !== targetMode` short-circuit (L137).

### New thin wrapper

- **File**: new `apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx`.
- **Body**: copy-of-`OperationalizationModeExitButton.tsx` with `mode="warrant-elicitation"`:
  ```tsx
  import { type ReactElement } from 'react';
  import { ProposalModeExitAffordance } from './ProposalModeExitAffordance';

  export function WarrantElicitationModeExitButton(): ReactElement | null {
    return <ProposalModeExitAffordance mode="warrant-elicitation" />;
  }
  ```

### New capture-pane surface (`<WarrantElicitationCapturePanel>`)

- **File**: new `apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx`.
- **Props**: `{}` (no props; self-subscribes to `useCaptureStore` + the i18n shell, mirroring `<OperationalizationCapturePanel>` / `<IsOughtPrompt>` / `<DecomposeComponentsGrid>`).
- **Mode gate**: returns `null` when `useCaptureStore((s) => s.mode) !== 'warrant-elicitation'`.
- **Header row**:
  - Localized prompt header (`moderator.warrantElicitation.prompt.question`, ICU-templated with `{nodeWording}`) — the canonical methodology question grounded in the target node's wording.
  - Target-wording overlay (right-aligned) showing the node being elicited: `t('moderator.warrantElicitation.banner.targetWording', { nodeWording })` where `nodeWording` is the result of `resolveProposalTargetWording(events, warrantElicitationTargetNodeId)`. The events array comes from `useWsStore`'s session slice; `useParams<{ id: string }>()` provides the session id (same shape as `<OperationalizationCapturePanel>` and `<ProposalModeExitAffordance>`).
  - When `nodeWording` is `null` (the resolver-tolerance fallback — the events log has not yet projected the matching `node-created` event), the prompt falls back to a non-templated localized string (`moderator.warrantElicitation.prompt.questionGeneric`, `"What's the unstated bridge from the target to your conclusion?"`) and the overlay renders empty. Decisions §D5 records why we ship both a templated and a generic prompt key (resolver-tolerance + i18n safety).
- **Guidance row** (smaller text below the header): localized `moderator.warrantElicitation.prompt.guidance` — the one-sentence reminder of the bridges-from/bridges-to outcome.
- **Transcription textarea**: `<textarea>` with `aria-label={t('moderator.warrantElicitation.answer.placeholder')}` and `placeholder` matching. The textarea's value lives in local component state via `useState<string>('')` (Decisions §D7 of `mod_operationalization_mode.md` carried over).
- **Action chip row**: three `<button disabled aria-disabled="true">` chips, each carrying:
  - `data-testid={`warrant-elicitation-action-${route}`}` and `data-warrant-elicitation-route={route}` (stable seams for the F2 / F4 / F7 wiring).
  - Localized label via `t(`moderator.warrantElicitation.action.${route}`)`.
  - The same disabled-placeholder Tailwind palette as `<OperationalizationCapturePanel>`'s chips (`rounded border border-amber-400 bg-white px-2 py-0.5 text-xs text-amber-900 disabled:cursor-not-allowed disabled:opacity-70`).
- **Stable test ids on the panel root**: `data-testid="warrant-elicitation-capture-panel"`, `data-warrant-elicitation-target-node-id={warrantElicitationTargetNodeId ?? ''}`.

### `<OperateRoute>` integration

- **File**: edit `apps/moderator/src/routes/Operate.tsx`.
- **Mode-gate computation**: add `const isWarrantElicitationMode = mode === 'warrant-elicitation';` next to the existing `isProposalMode` / `isOperationalizationMode` computations (currently L142–147).
- **`modeBanner` slot**: append `<WarrantElicitationModeExitButton />` to the existing children list (sibling to the three existing exit buttons). The four existing exit buttons each self-gate on their matching mode, so adding the fourth is purely additive.
- **`textInput` slot-swap**: extend the existing three-arm select to four arms. Cleanest shape:
  ```tsx
  textInput={
    isWarrantElicitationMode ? (
      <WarrantElicitationCapturePanel />
    ) : isOperationalizationMode ? (
      <OperationalizationCapturePanel />
    ) : isProposalMode ? (
      isInterpretiveSplitMode ? <InterpretiveSplitReadingsGrid /> : <DecomposeComponentsGrid mode="decompose" />
    ) : (
      <CaptureTextInput onSubmit={() => { void propose(); }} />
    )
  }
  classificationPalette={
    isWarrantElicitationMode || isOperationalizationMode || isProposalMode ? null : <ClassificationPalette />
  }
  edgeRoleSelector={
    isWarrantElicitationMode || isOperationalizationMode || isProposalMode ? null : <CaptureTargetAndRole />
  }
  proposeAction={
    isDecomposeMode ? (
      <ProposeDecompositionAction />
    ) : isInterpretiveSplitMode ? (
      <ProposeInterpretiveSplitAction />
    ) : isOperationalizationMode || isWarrantElicitationMode ? null : (
      <ProposeAction />
    )
  }
  ```
  The `proposeAction` slot is `null` in warrant-elicitation mode in this leaf (mirrors operationalization-mode).

### i18n

- **New catalog keys** under `moderator.warrantElicitation` + the one menu-label key (en-US / pt-BR / es-419):
  - `moderator.contextMenu.node.runWarrantElicitation` — `"Elicit warrant"` / `"Eliciar a garantia"` / `"Elicitar la garantía"`.
  - `moderator.warrantElicitation.prompt.question` (ICU) — `"What's the unstated bridge from \"{nodeWording}\" to your conclusion?"` / `"Qual é a ponte não declarada de \"{nodeWording}\" para a sua conclusão?"` / `"¿Cuál es el puente no declarado de \"{nodeWording}\" hasta tu conclusión?"`.
  - `moderator.warrantElicitation.prompt.questionGeneric` (non-ICU fallback for the wording-resolver-null case, per Decisions §D5) — `"What's the unstated bridge from the target to your conclusion?"` / `"Qual é a ponte não declarada do alvo para a sua conclusão?"` / `"¿Cuál es el puente no declarado del objetivo hasta tu conclusión?"`.
  - `moderator.warrantElicitation.prompt.guidance` — `"The articulated bridge becomes a new node with bridges-from and bridges-to edges connecting the data and the claim — often the actual disagreement once surfaced."` (and per-locale).
  - `moderator.warrantElicitation.answer.placeholder` — `"Type the participant's articulated bridge..."` (and per-locale).
  - `moderator.warrantElicitation.action.route-create-warrant-node` — `"Create warrant node"` (and per-locale).
  - `moderator.warrantElicitation.action.route-decompose-claim` — `"Decompose the claim"` (and per-locale).
  - `moderator.warrantElicitation.action.route-defer` — `"Defer — no clear bridge"` (and per-locale).
  - `moderator.warrantElicitation.exit.ariaLabel` — `"Exit warrant elicitation mode"` (and per-locale).
  - `moderator.warrantElicitation.exit.tooltip` — `"Exit warrant elicitation mode (Esc)"` (and per-locale).
  - `moderator.warrantElicitation.banner.targetWording` (ICU) — `"Eliciting warrant for: {nodeWording}"` (and per-locale).
- Catalog parity must hold across all three locales (the `i18n-catalogs` parity test fails CI on missing keys).
- The English copy for the prompt question is **derived from `docs/methodology.md` L138** ("What's the unstated bridge from X to your conclusion?"), with `X` interpolated as `{nodeWording}` per Decisions §D5.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided to be the Acceptance bar.

Extension to `apps/moderator/src/stores/captureStore.test.ts`:

- `enterWarrantElicitationMode('n1')` flips `mode` to `'warrant-elicitation'`, sets `warrantElicitationTargetNodeId` to `'n1'`, and clears `text` / `classification` / `targetEntityId` / `edgeRole` to their initial values (F1-clear discipline).
- `exitWarrantElicitationMode()` flips `mode` back to `'idle'` and clears `warrantElicitationTargetNodeId` to `null`. Does NOT re-populate the F1 slices.
- `reset()` clears `warrantElicitationTargetNodeId` even when the mode was entered.
- `setWarrantElicitationTargetNodeId('n2')` updates the slice without flipping mode (symmetry test).
- Calling `enterWarrantElicitationMode('n1')` then `enterOperationalizationMode('n2')` flips mode to `'operationalization'` and sets `operationalizationTargetNodeId` to `'n2'`, but **does NOT clear `warrantElicitationTargetNodeId`** — the warrant-elicitation slice is owned by its own enter/exit pair (mirrors the cross-mode invariant pinned by sibling tests).

Extension to `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:

- `buildNodeMenuItems(target)` (all handlers omitted) includes a `'run-warrant-elicitation-test'` item whose `onSelect` calls `actionStub` (the legacy fallback).
- `buildNodeMenuItems(target, ..., handler)` with the warrant-elicitation handler supplied and a node target returns an item whose `onSelect` calls `handler(target.id)`.
- `buildNodeMenuItems(target, ..., handler)` with a non-node target falls back to `actionStub`.
- The new menu item appears **between** `'run-operationalization-test'` and `'propose-meta-disagreement'` in the returned array (DOM-order pinning).
- When the target node's substance facet status is `'agreed'` (disputation outcome `'data'`), the item is `disabled: true`; when `'disputed'` (outcome `'claim'`), the item is `disabled: false`; when `'meta-disagreement'` (outcome `'claim'`), `disabled: false`; when the facet is absent (outcome `null` → `'unsettled'`), `disabled: true` — mirrors the operationalization-item gate tests.

New file `apps/moderator/src/layout/WarrantElicitationModeExitButton.test.tsx`:

- Renders `null` when mode is not `'warrant-elicitation'` (parametric over all eight non-matching `CaptureMode` values).
- Renders the affordance when mode is `'warrant-elicitation'` and `warrantElicitationTargetNodeId` is set; the rendered button carries `data-testid="warrant-elicitation-mode-exit"` and the wording overlay carries `data-testid="warrant-elicitation-mode-target-wording"`.
- Clicking the × button calls `exitWarrantElicitationMode()` (asserted via `useCaptureStore.getState().mode` post-click expecting `'idle'`).
- Pressing Escape while in warrant-elicitation mode triggers the same exit.
- Cross-locale: the ariaLabel + tooltip resolve to non-key strings in all three locales.

New file `apps/moderator/src/layout/WarrantElicitationCapturePanel.test.tsx`:

- Returns `null` when mode is not `'warrant-elicitation'` (parametric).
- Renders the ICU-templated prompt-question header with `{nodeWording}` interpolated when the target node's `node-created` event is in the events log; renders the generic fallback prompt when the wording resolves to `null` (Decisions §D5).
- Renders the guidance row with the localized `moderator.warrantElicitation.prompt.guidance` text.
- The target-wording overlay renders `"Eliciting warrant for: {nodeWording}"` when the wording resolves; renders nothing when the events log lacks a matching event.
- Renders all three action chips in canonical order (`route-create-warrant-node`, `route-decompose-claim`, `route-defer`), each disabled and aria-disabled, each carrying the matching `data-warrant-elicitation-route` and `data-testid` seams.
- Clicking each chip is a no-op (asserted by capturing `mode` before/after and asserting equality — placeholder-discipline pin).
- The textarea is editable: typing changes its `value` and clamps text > `MAX_METHODOLOGY_TEXT_LENGTH` to the maximum.
- Cross-locale: prompt question + guidance + answer placeholder + the three chip labels resolve to non-key strings in en-US / pt-BR / es-419 and differ from en-US.

Extension to `apps/moderator/src/App.test.tsx`:

- A single integration case: with the capture store in `mode === 'warrant-elicitation'` and a target node id set, the `<OperateRoute>`'s bottom strip contains a `data-testid="warrant-elicitation-capture-panel"` element, the strip's modeBanner slot contains a `data-testid="warrant-elicitation-mode-exit"` element, `data-testid="mode-banner"` continues to render, and `data-testid="is-ought-prompt"` is present.
- A negative integration case: with the capture store in `mode === 'idle'`, none of the warrant-elicitation test ids are present.

Extension to `apps/moderator/src/layout/captureKeymap.test.ts` (if not subsumed by the exit-button tests):

- The Escape handler attaches when `mode === 'warrant-elicitation'` and detaches when the mode changes.

**Playwright spec** (new file, `tests/e2e/moderator-warrant-elicitation-mode.spec.ts` — Decisions §D8):

- A single scenario asserts the right-click → menu surface is reachable end-to-end and the warrant-elicitation menu item is present with the methodology-gated `aria-disabled` state.
  1. Log in as the test moderator, reach the operate canvas (reuses the existing `moderatorReachOperate` pattern from `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts:70`).
  2. Propose a free-floating `classify-node` statement via the F1 capture flow (reuses the existing `proposeStatement` pattern).
  3. Wait for the node to render with `data-facet-status="proposed"` (the substance facet is `'proposed'`, not `'disputed'` — the disputation gate fails).
  4. Right-click the node → assert the context menu opens.
  5. Assert `page.getByTestId('graph-context-menu-item-run-warrant-elicitation-test')` is visible.
  6. Assert the item carries `aria-disabled="true"` (the methodology gate fails because substance is not `'disputed'` / `'meta-disagreement'`).
  7. Assert clicking the disabled item does NOT swap the bottom strip into warrant-elicitation mode (the `data-testid="warrant-elicitation-capture-panel"` does NOT appear after the click).
  8. Symmetric assertion for the operationalization item (`graph-context-menu-item-run-operationalization-test`) carrying `aria-disabled="true"` against the same proposed node — pins that the sibling F3 item also closes its inherited deferred-e2e debt for the disabled-state contract (one of the inheritance scenarios `mod_pw_diagnostic_flow` carries today).

This spec deliberately does NOT drive the gate to the **enabled** state — that still requires the `set-node-substance` propose-action UI which is not yet shipped (the same blocker the three sibling F3 refinements faced). The enabled-state e2e is what remains deferred to `mod_pw_diagnostic_flow`; the disabled-state contract is pinned inline here.

## Acceptance criteria

1. `apps/moderator/src/stores/captureStore.ts` exports `enterWarrantElicitationMode(nodeId)` / `exitWarrantElicitationMode()` / `setWarrantElicitationTargetNodeId(id)` / `warrantElicitationTargetNodeId` per Constraints / requirements above; `reset()` clears the new slice via the spread of `initialCaptureState`.
2. `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `buildNodeMenuItems` factory accepts the new sixth + seventh optional parameters (`onEnterWarrantElicitationMode?`, `disabledRunWarrantElicitationTest?`) and emits a `'run-warrant-elicitation-test'` item between `'run-operationalization-test'` and `'propose-meta-disagreement'`. The item is `disabled: true` when the target node's substance facet status maps (via `disputationOutcome(...)`) to anything other than `'claim'`. The canvas's `<GraphCanvasPaneInner>` threads the new handler + gate.
3. `apps/moderator/src/layout/ProposalModeExitAffordance.tsx`'s `ProposalMode` union widens to include `'warrant-elicitation'`; `StructuralProposalMode` widens to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>`; the `MODE_KEYS` bundle, the `targetNodeId` selector, and the `exitMode` selector each gain a fourth branch.
4. `apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx` exists and exports a thin wrapper that renders `<ProposalModeExitAffordance mode="warrant-elicitation" />`.
5. `apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx` exists, exports `WarrantElicitationCapturePanel` and `WARRANT_ELICITATION_ROUTES`, and renders per Constraints / requirements above. Renders `null` outside warrant-elicitation mode.
6. `apps/moderator/src/routes/Operate.tsx` mounts `<WarrantElicitationModeExitButton />` in the `modeBanner` slot (sibling to the three existing per-mode exit buttons) and swaps the `textInput` / `classificationPalette` / `edgeRoleSelector` slots to `<WarrantElicitationCapturePanel />` / `null` / `null` when `mode === 'warrant-elicitation'`. The `proposeAction` slot is `null` in warrant-elicitation mode.
7. Catalog keys exist in all three locales under `moderator.warrantElicitation.*` and at `moderator.contextMenu.node.runWarrantElicitation` with the values listed in Constraints / requirements; catalog parity test passes.
8. All Vitest cases listed under "Tests" above are committed and pass.
9. **Playwright spec** `tests/e2e/moderator-warrant-elicitation-mode.spec.ts` exists and lands the inline scenario described under "Tests" above. The scenario asserts the disabled-state contract (the menu item is visible and `aria-disabled="true"` against a freshly-proposed node) for BOTH the warrant-elicitation item AND the operationalization item — closing the disabled-state portion of `mod_pw_diagnostic_flow`'s inherited debt inline.
10. **Deferred-e2e debt — only the enabled-state e2e remains.** The future Playwright spec under `mod_pw_diagnostic_flow` MUST assert the enabled-state path (right-click a node whose substance is `'disputed'` / `'meta-disagreement'`, pick "Elicit warrant", and observe the bottom-strip swap to `<WarrantElicitationCapturePanel>` carrying the localized prompt + target-wording overlay + the three disabled action chips). That assertion remains deferred because the `set-node-substance` propose-action UI is not yet shipped (same blocker the three sibling F3 refinements share). The stable seams (`data-testid="warrant-elicitation-capture-panel"`, `data-warrant-elicitation-route="<route>"`, `data-warrant-elicitation-target-node-id="<id>"`, `data-testid="warrant-elicitation-mode-exit"`, `data-testid="graph-context-menu-item-run-warrant-elicitation-test"`) are the contract that future spec inherits. The picker-side wiring (chips fire real propose actions) is the responsibility of `mod_resolution_path_picker` + `mod_draw_edge_flow` + `mod_decompose_flow` e2e contributions, not this task's debt.
11. `pnpm run check` clean.
12. `pnpm run test:smoke` green; the Vitest test count rises by the new cases.
13. `pnpm run test:e2e:smoke` green; the Playwright spec count rises by 1 file (with 1 scenario).
14. `pnpm -F @a-conversa/moderator build` succeeds.
15. `tj3 --silent project.tjp` silent (no `Warning:` or `Error:` lines — the pre-commit hook enforces this).
16. `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_warrant_elicitation_mode` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md"` line. The `mod_pw_diagnostic_flow` note (currently at L748) is **trimmed** to reflect the reduced inherited debt: the disabled-state contract for the operationalization + warrant-elicitation context-menu items is now pinned inline here, so `mod_pw_diagnostic_flow` inherits only the enabled-state path (disputation chip + suggestions panel + operationalization-mode swap + warrant-elicitation-mode swap all driven by a real `set-node-substance` proposal). Per ORCHESTRATOR.md "Behavior + e2e coverage growth — don't lose sight of it" §"Watch the inherited-debt count": this leaves `mod_pw_diagnostic_flow` with three enabled-state inheritances (disputation chip, suggestions panel, two mode-entry swaps), not four — the debt does NOT grow.

## Decisions

- **D1: Gate predicate identical to operationalization-mode: `disputationOutcome(substanceStatus) !== 'claim'`.** Four alternatives considered:

  1. *Gate only on `substanceStatus === 'meta-disagreement'`* — narrower interpretation of "role disagreement persists". The methodology text at L138 reads "When role disagreement persists" — `'meta-disagreement'` is the substance-facet state that *encodes* irreducible role disagreement (per `docs/methodology.md` L210 and the existing `disputationOutcome` comment block at L19–20: `'meta-disagreement' → 'claim' (escalated dispute: same data-vs-claim outcome)`). But: (a) a freshly-disputed node has `substance === 'disputed'`, NOT `'meta-disagreement'` — the latter only appears after diagnostics fail to resolve; gating on `'meta-disagreement'` only would mean the moderator cannot reach for warrant-elicitation as a *first-line* diagnostic on a disputed claim, only as a *last-resort* tool after other diagnostics. The methodology text reads warrant-elicitation as a peer diagnostic to operationalization (both listed under "Diagnostic tests" L106–141), not as a post-escalation tool. Rejected.

  2. *Gate on `substanceStatus === 'disputed'` only* — would parallel the methodology's "role disagreement" language strictly (a node whose substance is disputed has its role contested). But: (a) `'meta-disagreement'` is a strict superset — if the role is being held in irreducible disagreement, warrant-elicitation is the canonical methodology response; (b) the existing `disputationOutcome` helper already collapses both states to `'claim'`, and re-introducing the distinction at this gate would duplicate methodology logic. Rejected.

  3. *Always enable; let the moderator open warrant-elicitation on any node* — would conflict with the methodology contract (warrant-elicitation is a tool for contested claims, not for agreed-data nodes). The disputation chip already communicates this gate visually. Rejected for the same reason `mod_operationalization_mode` Decisions §D5 rejected its parallel alternative.

  4. *Gate predicate identical to operationalization-mode: `disputationOutcome(substanceStatus) !== 'claim'`* — chosen. Both `'disputed'` and `'meta-disagreement'` map to `'claim'` via `disputationOutcome`; both states are "contested-claim" methodology contexts. Warrant-elicitation is the methodology's *response to role contest* (whether early via `'disputed'` or persistent via `'meta-disagreement'`); the same gate condition that enables operationalization enables warrant-elicitation. Pinning the two gates to the *same* predicate (with independent constant computations at the call site, per Constraints) keeps the methodology vocabulary in one place (`disputationOutcome` is the helper) and makes a future divergence (if warrant-elicitation later wants to gate strictly on `'meta-disagreement'`) a one-line change. Mirrors `mod_operationalization_mode` Decisions §D5's reasoning.

  This is the most defensible call: the methodology text is loose ("when role disagreement persists"), and the `disputationOutcome === 'claim'` predicate captures *all* contested-claim conditions. A future refinement can narrow if methodology iteration justifies it; broadening would require chip-time chip-and-mode coordination that is not justified by current text.

- **D2: Widen `ProposalMode` to 4 modes; widen `StructuralProposalMode` to `Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>`; convert the 3-arm nested ternary selectors to 4-arm switch expressions.** Three alternatives considered:

  1. *Rename `<ProposalModeExitAffordance>` to `<ModeExitAffordance>` and `ProposalMode` to `ExitAffordanceMode`* — would communicate the broader scope (4 modes, two of which are diagnostic tests, not proposal modes). But: four call sites would need their imports updated (the four thin wrappers); the symbol-stability rationale `mod_operationalization_mode` Decisions §D2 cited still applies — a rename pulls scope into this leaf. Rejected.

  2. *Re-extract `<DiagnosticModeExitAffordance>` for operationalization + warrant-elicitation* — would split the body that operationalization-mode just unified. The reusable seam was built specifically so this leaf composes on it, not refactors it. Rejected as a regression of the explicit `.tji` note ("compose on the 3-mode ProposalModeExitAffordance + StructuralProposalMode alias landed in this commit").

  3. *Widen the union additively; widen the `StructuralProposalMode` exclusion; convert the 3-arm nested ternaries to 4-arm switch expressions* — chosen. The `ProposalMode` type union becomes `'decompose' | 'interpretive-split' | 'operationalization' | 'warrant-elicitation'`. The `StructuralProposalMode = Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` alias *evaluates to the same type* as before this task (`'decompose' | 'interpretive-split'`) so the structural-restructure component family does not change its prop shape — the alias's *implementation* gains a second exclusion to preserve its *meaning*. At 4 arms the nested ternaries become harder to read than a switch; converting to switch expressions is a cheap readability improvement that pays off if a fifth mode ever lands. Verbatim composition on the 3-mode seam.

  The `StructuralProposalMode` alias **does not** widen to include the diagnostic modes — the methodology-vocabulary divergence between structural-restructure proposals (decompose/interpretive-split) and diagnostic-test capture (operationalization/warrant-elicitation) is real and load-bearing. The alias is a methodology boundary, not just a type narrowing.

- **D3: Three warrant-shape chips (`route-create-warrant-node`, `route-decompose-claim`, `route-defer`), not five — different from operationalization's chip count.** Three alternatives considered:

  1. *Mirror operationalization's five-chip shape* upfront — would create false symmetry. Operationalization's five chips encode the methodology's five answer-routes per `docs/methodology.md` L114–120 (`fact`/`predictive`, `value`/`normative`, `definitional`, axiom-mark, defeater). Warrant-elicitation's methodology response is narrower: per `docs/methodology.md` L138–140 + L80 the articulated warrant becomes a *new node* with `bridges-from` and `bridges-to` edges — one primary route. The "claim + implicit warrant" decomposition seam at L149 is a secondary route (the warrant might be better surfaced via decomposition of the bundled claim). The "no clear bridge" defer route is a no-op route (mirroring `route-no-signal` on operationalization). Padding to five would invent methodology that isn't in the docs.

  2. *Single "create warrant node" chip* — would under-encode. The decomposition route is genuinely a methodology alternative when the warrant is implicit in a compound claim, and the defer route is genuinely needed for the "no clear bridge" exit. Mid-three chips capture the methodology's actual decision space.

  3. *Three chips* (`route-create-warrant-node`, `route-decompose-claim`, `route-defer`) — chosen. Maps 1:1 to the methodology's articulated routes. The chips are inert in this leaf (placeholders for F2/F4/F7 wiring); pinning the canonical three avoids over- or under-encoding.

  No generalised `<DiagnosticCapturePanel mode={...}>` body either — same `mod_operationalization_mode` Decisions §D3 reasoning carries over: two concrete instances now exist, but their chip vocabularies differ sharply (five answer-routes vs. three warrant-shape routes), so a premature shared abstraction would fit neither cleanly. The extraction decision waits for a *third* concrete diagnostic mode if one ever lands.

- **D4: F1-coupling clear on `enterWarrantElicitationMode`, mirroring the three sibling modes.** Same staleness-risk rationale `mod_decompose_mode` Decisions §6 / `mod_operationalization_mode` Decisions §D4 carries forward — a moderator who started typing an F1 statement and then right-clicked to elicit a warrant would otherwise carry stale `text` / `classification` / `targetEntityId` / `edgeRole` into the warrant-elicitation flow, where the slots that would render those values are collapsed to `null`. No new rationale; verbatim mirror.

- **D5: ICU-templated prompt question with `{nodeWording}` interpolation + a non-ICU `prompt.questionGeneric` fallback.** Two alternatives considered:

  1. *Static prompt question* (no interpolation) — `"What's the unstated bridge from the target to your conclusion?"`. Mirrors operationalization's static prompt question. But: operationalization's question ("What evidence would change your mind on this?") refers to the target implicitly via "this"; warrant-elicitation's methodology text explicitly substitutes `X` (the target wording) — `"What's the unstated bridge from X to your conclusion?"`. The wording-substitution is methodology-load-bearing: the moderator asks the question grounded in the specific claim, and the participant's articulated bridge is "from-this-claim-to-the-conclusion", not generic. Static would lose that grounding.

  2. *ICU-templated with fallback* — chosen. Primary prompt is `moderator.warrantElicitation.prompt.question` with `{nodeWording}` interpolation; when `resolveProposalTargetWording(events, warrantElicitationTargetNodeId)` returns `null` (the resolver-tolerance fallback for the transient inconsistency case the predecessor refinements pin) the panel falls back to `moderator.warrantElicitation.prompt.questionGeneric` (no interpolation). The same resolver-tolerance pattern `<ProposalModeExitAffordance>`'s wording overlay uses (renders empty when `null`) — here we render a generic prompt instead of empty because the prompt is load-bearing and an empty prompt would leave the moderator without a question.

  Two i18n keys for one logical message is the cost of the resolver-tolerance + interpolation safety; the alternative (gracefully degrading the interpolation with a placeholder like "the target") would conflate i18n with rendering logic.

- **D6: Do NOT wire the `is-ought-prompt-action-warrant` chip's `onClick` in this leaf.** Two alternatives considered:

  1. *Wire the chip's `onClick` to `useCaptureStore.getState().enterWarrantElicitationMode(targetNodeId)`* — would close a small loose end (the chip exists today as a disabled placeholder; this task introduces the destination; the wiring is one line). But: the chip lives inside `<IsOughtPrompt>`, which mounts in operationalization-mode OR warrant-elicitation-mode — wiring it would mean "entering operationalization mode, then clicking the warrant chip, swaps the mode to warrant-elicitation on the same target". That cross-mode flow is a methodology decision (does operationalization "fall through" to warrant-elicitation, or are they independent moderator picks?) that this leaf has no mandate to make. The IsOughtPrompt refinement explicitly left the chips disabled as placeholders for the F7 picker (`mod_resolution_path_picker`).

  2. *Keep the chip disabled; defer wiring to `mod_resolution_path_picker`* — chosen. The chip stays inert per `mod_is_ought_prompt`'s placeholder discipline. The entry path through the right-click context menu is the v1 entry path; F7 owns the picker-side chip-wiring discipline (same decision the operationalization-mode panel made for its five answer-route chips).

- **D7: Warrant-elicitation textarea uses local component state, not a new store slice.** Verbatim mirror of `mod_operationalization_mode` Decisions §D7. The textarea's value is component-local; entering warrant-elicitation mode mounts the component fresh, exiting unmounts it. F2/F4/F7 owners can promote to a store slice when wiring the chips. No new rationale.

- **D8: Land a thin inline Playwright spec; only the enabled-state e2e remains deferred to `mod_pw_diagnostic_flow`.** Three alternatives considered:

  1. *Defer the full Playwright spec to `mod_pw_diagnostic_flow`* — matches the three sibling F3 refinements' precedent. But: `mod_pw_diagnostic_flow` already inherits e2e debt from three prior tasks (disputation-test display, methodology-suggestions, operationalization-mode); adding a fourth inheritance pushes that single task into "planning-debt time bomb" territory per ORCHESTRATOR.md §"Behavior + e2e coverage growth" §"Watch the inherited-debt count on `mod_pw_*`": *"If it's inheriting from 2+ refinements already, pay debt down instead — either land a small Playwright spec inline, or split the deferral target into multiple smaller future tasks."* Full deferral would violate that guidance.

  2. *Split `mod_pw_diagnostic_flow` into per-mode sub-tasks* (`mod_pw_disputation_test`, `mod_pw_methodology_suggestions`, `mod_pw_operationalization_mode`, `mod_pw_warrant_elicitation_mode`) — would let each refinement own a targeted Playwright sub-task without inflating one catch-all. But: the per-mode sub-tasks all share the same blocker (the `set-node-substance` propose-action UI), so splitting them now creates four open leaves all gated on the same future task. The split is a real future option but not the cheaper one *for this leaf*.

  3. *Land a thin inline spec that pins the disabled-state contract for both the operationalization AND warrant-elicitation context-menu items; defer only the enabled-state e2e* — chosen. The disabled-state surface IS reachable today end-to-end: log in, propose a node, right-click it, observe the two diagnostic-test items rendered with `aria-disabled="true"` because the substance facet is `'proposed'` (gate fails). This is exactly the case ORCHESTRATOR.md prefers ("prefer to land a thin Playwright spec inline when ANY route renders the component, even if disabled/inert"). Landing this inline:

     - Closes the disabled-state portion of the inherited debt for BOTH F3 mode-entry items (operationalization + warrant-elicitation) in one spec.
     - Reduces `mod_pw_diagnostic_flow`'s inherited debt from "4 refinements deferring" to "3 refinements deferring the enabled-state path" (the disputation chip, the suggestions panel, and the two mode-entry swaps' enabled-state). The debt does NOT grow with this leaf.
     - Establishes the right-click pattern the future enabled-state spec will extend (same `getByTestId('graph-context-menu')` / `getByTestId('graph-context-menu-item-<id>')` shape the existing decompose-flow e2e at `tests/e2e/moderator-proposed-entity-canvas-visibility.spec.ts:239–240` already uses).

  The Acceptance #16 line trims the `mod_pw_diagnostic_flow` note in the same commit to reflect the reduced inherited debt — the Closer should be explicit that the inheritance is the *enabled-state path only* after this leaf lands. (If during implementation the disabled-state spec turns out to be flaky or technically blocked — e.g. the context menu doesn't render the item against a proposed node for some unrelated reason — the Implementer should report back rather than silently defer; the refinement-writer's call is that this is landable inline.)

- **D9: No new `Cmd+W` keyboard shortcut in this leaf — defer to `mod_global_keymap`.** Verbatim mirror of `mod_operationalization_mode` Decisions §D8 / `mod_decompose_mode` Decisions §8. The consolidated `mod_global_keymap` task owns the canonical mode-to-shortcut table per [docs/moderator-ui.md L189–203](../../../docs/moderator-ui.md#L189). Context-menu entry is v1.

- **D10: No new wire envelope, no new methodology engine rule, no new diagnostic kind.** The warrant-elicitation mode surface is rendering + entry-path only. The three placeholder chips will eventually fire **existing** propose actions (a node-creation proposal + two edge-creation proposals for `bridges-from` / `bridges-to` via F4 `mod_draw_edge_flow`, or a decomposition proposal via F2 `mod_decompose_mode`, or a soft mode-exit) — no new wire surface needed. Mirrors operationalization-mode's Decision §D9.

- **D11: No new ADR.** The task is a verbatim composition on the 3-mode seam `mod_operationalization_mode` Decisions §D2 explicitly built for this task to reuse. The widening of `StructuralProposalMode`'s exclusion list preserves the alias's *meaning* (structural-restructure modes only); the widening is mechanical. The chip-vocabulary divergence (3 chips vs. 5) is data (encoded in chip identifiers + i18n keys), not architecture. The gate-predicate choice (D1) reuses an existing precedent. No cross-workspace contract changes.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- 4th-mode arm of the F3 diagnostic-test pattern landed on the seam established by `mod_operationalization_mode`: `ProposalMode` widened additively to `'decompose' | 'interpretive-split' | 'operationalization' | 'warrant-elicitation'`, `StructuralProposalMode = Exclude<ProposalMode, 'operationalization' | 'warrant-elicitation'>` keeps the decompose / interpretive-split component family narrowed off the diagnostic modes, new per-mode `MODE_KEYS` entry + selector branches via switch statements ([apps/moderator/src/layout/ProposalModeExitAffordance.tsx](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx)).
- Store substrate: `enterWarrantElicitationMode(nodeId)` / `exitWarrantElicitationMode()` helpers + `warrantElicitationTargetNodeId` slice + `setWarrantElicitationTargetNodeId` setter on `useCaptureStore` with the same atomic single-`set()` discipline + F1-coupling clear as the operationalization arm ([apps/moderator/src/stores/captureStore.ts](../../../apps/moderator/src/stores/captureStore.ts) + [.test.ts](../../../apps/moderator/src/stores/captureStore.test.ts), +7 Vitest cases).
- Context-menu entry: new `'run-warrant-elicitation-test'` item added to `buildNodeMenuItems` via the 7th-parameter `onEnterWarrantElicitationMode?: (nodeId: string) => void` seam, with methodology-gated `disabled` boolean threaded as the 6th-then-7th parameter (computed call-site, same disabled-state pattern as the operationalization item) ([apps/moderator/src/graph/GraphCanvasPane.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) + [.test.tsx](../../../apps/moderator/src/graph/GraphCanvasPane.test.tsx), +5 factory + 3 wire cases, factory-call stub-arity 11→12).
- Exit affordance + capture surface: new `<WarrantElicitationModeExitButton>` thin wrapper sibling to `<OperationalizationModeExitButton>` ([apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx](../../../apps/moderator/src/layout/WarrantElicitationModeExitButton.tsx) + [.test.tsx](../../../apps/moderator/src/layout/WarrantElicitationModeExitButton.test.tsx)); inert `<WarrantElicitationCapturePanel>` with three disabled warrant-shape chips (fact / value / normative bridging-warrant — stable `data-warrant-shape="..."` seams) + ICU-templated prompt with generic fallback ([apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx](../../../apps/moderator/src/layout/WarrantElicitationCapturePanel.tsx) + [.test.tsx](../../../apps/moderator/src/layout/WarrantElicitationCapturePanel.test.tsx)). Escape priority extended in `captureKeymap` (+2 cases).
- Route integration: `<OperateRoute>` gained the parallel `isWarrantElicitationMode` gate and a 4-way `textInput` slot-swap; `<WarrantElicitationModeExitButton/>` mounts unconditionally inside the `modeBanner` slot ([apps/moderator/src/routes/Operate.tsx](../../../apps/moderator/src/routes/Operate.tsx); [apps/moderator/src/App.test.tsx](../../../apps/moderator/src/App.test.tsx), +2 integration cases).
- i18n: full `moderator.warrantElicitation.*` subtree + `moderator.contextMenu.node.runWarrantElicitation` added across all three locales — `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — catalog parity holds.
- **Inline disabled-state Playwright spec lands** at [tests/e2e/moderator-warrant-elicitation-mode.spec.ts](../../../tests/e2e/moderator-warrant-elicitation-mode.spec.ts) (registered in `playwright.config.ts` under `chromium-create-session.testMatch`), asserting the disabled-state contract for BOTH F3 diagnostic-test menu items (run-operationalization-test + run-warrant-elicitation-test). This is the first commit landed under the new ORCHESTRATOR.md "Behavior + e2e coverage growth" guidance — the disabled-state e2e portion is shipped inline rather than deferred, so `mod_pw_diagnostic_flow`'s inherited-debt scope shrank from 4 inheritances to 3 (only the enabled-state portion remains, still blocked by `set-node-substance` propose-UI).
- Verification: Vitest 3688 → 3744 (+56); `pnpm run check` green; `pnpm run test:smoke` green; `pnpm -F @a-conversa/moderator build` clean; Playwright 5/5 chromium green (new warrant-elicitation spec + canvas-visibility regression all scenarios).
