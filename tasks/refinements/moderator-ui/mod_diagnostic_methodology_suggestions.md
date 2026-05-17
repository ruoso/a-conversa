# Moderator diagnostic flow methodology suggestions per diagnostic kind

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_diagnostic_flow.mod_diagnostic_methodology_suggestions` (see `mod_diagnostic_flow` group at line 436 and this leaf at line 457).

```tji
task mod_diagnostic_methodology_suggestions "Methodology suggestions per diagnostic kind" {
  effort 1d
  allocate team
  depends data_and_methodology.diagnostics.diagnostic_event_emission
}
```

## Effort estimate

**1d.** Confirmed.

The methodology has, per diagnostic kind, an explicit catalog of next-action paths the moderator may take (cycle → break-edge / decompose / axiom-mark; contradiction → decompose / amend / axiom-mark both; multi-warrant → decompose-claim; dangling-claim → prompt-for-support / mark-conceded; coherency-hint → review / repair / leave-as-intentional). These are documented in `docs/methodology.md` § "Resolution of structural diagnostics" (L216–233) and in the `diagnostics.<kind>.action` i18n catalog entries (en-US / pt-BR / es-419) that landed in `frontend_i18n.i18n_diagnostic_descriptions`. The wire-level `DiagnosticPayload` (with `kind`, `severity`, the inlined per-kind `diagnostic` payload, and the affected entity ids) is already streaming over the WS surface and being projected into `useWsStore`'s `activeDiagnostics` map per session — the engine side is complete (M2 milestone).

What this task adds is the **moderator-facing render** of those suggestions: a localized, per-active-diagnostic list of suggested next-move chips that the moderator can scan at a glance, scoped to one diagnostic at a time, with the canonical action vocabulary keyed off `payload.kind` and (for coherency-hint) `payload.diagnostic.hint.kind`. The work is:

- a pure derivation helper that maps a `DiagnosticPayload` to its ordered list of suggested next-move identifiers (e.g. `['decompose', 'amend', 'axiom-mark-both']` for `contradiction`),
- a `<DiagnosticSuggestionsPanel>` component that consumes the helper, renders the chips with i18n labels, and surfaces them inside the diagnostic flag pane scaffold (or, when no flag pane is yet wired, inline alongside the diagnostic halo's existing tooltip seam),
- the new i18n catalog keys under `moderator.diagnostic.suggestions.*` for the per-move labels and panel chrome,
- Vitest coverage; e2e deferred to `mod_pw_diagnostic_flow` per the precedent set by `mod_is_ought_prompt` and `mod_disputation_test_display`.

No new methodology engine, no new wire envelope, no new diagnostic kind, no commit-gating, no resolution-event emission — the suggestion chips are inert presentational affordances in this leaf (placeholder buttons, same pattern as `IsOughtPrompt`'s `decompose` / `warrant` actions). Wiring the chips to a real propose-action handler is owned by F7's `mod_resolution_path_picker` (per [tasks/30-moderator-ui.tji L528](../../30-moderator-ui.tji#L528)) and is explicitly downstream.

## Inherited dependencies (settled/pending)

Settled (this task plugs into existing seams without changing their contracts):

- `data_and_methodology.diagnostics.diagnostic_event_emission` (done — `DiagnosticEntry` discriminated union over the five kinds, `identityKeyFor`, `DiagnosticBus`. The wire envelope already carries the full entry verbatim via `DiagnosticPayload.diagnostic: unknown`).
- `data_and_methodology.diagnostics.blocking_vs_advisory_classification` (done — `Severity` vocabulary `'blocking' | 'advisory'` pinned, and `WsDiagnosticSeverity` is stamped on every wire envelope by the broadcast bridge; this task reads `severity` to pick the chip-row palette but does NOT re-derive it).
- `backend.websocket_protocol.ws_diagnostic_broadcast` (done — `diagnostic` envelope fan-out is shipped; the moderator's `useWsStore.applyDiagnostic` already adds/removes entries from `activeDiagnostics` keyed by `diagnosticIdentityKey(payload)`).
- `moderator_ui.mod_shell.mod_ws_client` (done — `useWsStore` is the surface this task subscribes to via the existing `sessionState[sessionId]?.activeDiagnostics` selector pattern pinned by `mod_diagnostic_highlighting`).
- `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` (done — established the moderator-side `WireDiagnostic` mirror types, the `affectedEntities(payload)` helper, the `projectDiagnosticHighlights(activeDiagnostics)` aggregator, the `data-diagnostic-severity` seam, and the amber halo composition discipline ("diagnostic overlays compose on top of the per-facet state layer, they don't overwrite it"). This task reuses the mirror types from [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) verbatim — no second mirror.).
- `frontend_i18n.i18n_diagnostic_descriptions` (done — `diagnostics.<kind>.title` / `.description` / `.detail` / `.action` keys are pinned in en-US / pt-BR / es-419. This task adds a sibling `moderator.diagnostic.suggestions.*` subtree; the `diagnostics.<kind>.action` keys carry the methodology's prose recommendation as a single sentence, which is reused verbatim as the panel header copy when one diagnostic is in focus).
- `moderator_ui.mod_diagnostic_flow.mod_is_ought_prompt` (done — pinned the `moderator.diagnostic.*` i18n namespace, the disabled-placeholder action chip pattern, the inline-chrome surface convention, and the "defer Playwright e2e to `mod_pw_diagnostic_flow` when the full flow is unreachable" precedent this task inherits).
- `moderator_ui.mod_diagnostic_flow.mod_disputation_test_display` (done — pinned the `moderator.diagnostic.disputationTest.*` sibling subtree, the per-outcome chip palette discipline (`data-*-outcome` stable seams, sky/rose/slate vocabulary), and the rendering-layer-only / no-new-`CaptureMode` framing this task mirrors. The per-statement disputation chip is **not the right pattern** for this task; see Decisions §D1 for why).
- `moderator_ui.mod_app_skeleton.mod_layout_shell` + `moderator_ui.mod_app_skeleton.mod_right_sidebar` (done — `<RightSidebar>` has a dedicated `diagnosticFlagsSlot` and a `'diagnostic-flags'` `SidebarPane` enum value; this task is allowed to mount its panel into that slot via `Operate.tsx`, mirroring the way `<IsOughtPrompt>` was mounted into the bottom-strip mode-banner slot in `mod_is_ought_prompt`).

Pending (this task feeds these, but does NOT depend on them):

- `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane` (the full diagnostic flag list with severity grouping, focus actions, and acknowledgment). When that task lands it will replace or wrap this panel; the i18n keys and the `suggestionsForDiagnostic(payload)` helper this task ships are explicitly designed to be reused.
- `moderator_ui.mod_diagnostic_resolution_flow.mod_resolution_path_picker` (the F7 task that turns the suggestion chips into real propose-action handlers + the engine-side resolution events). The chip identifiers this task pins (`'break-edge'`, `'decompose'`, `'axiom-mark'`, `'amend'`, `'axiom-mark-both'`, `'prompt-for-support'`, `'mark-conceded'`, `'review-configuration'`) are the contract that picker will switch on.
- `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_focus_action` (click-flag-to-focus). When implemented it will reuse the per-diagnostic identity key + the per-entity ids returned by `affectedEntities(payload)` (already shipped).
- `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` (full F3 Playwright; this task contributes a scoped per-component assertion. See Acceptance criteria for the e2e deferral rationale and the inherited debt the future spec MUST cover).

## What this task is

Surface, for every active diagnostic on the canvas, the **methodology's catalog of next-action paths** the moderator may consider — keyed off the diagnostic's kind (and, for coherency-hint, its sub-kind). When the moderator looks at a fired cycle diagnostic, the suggestion panel says: "consider breaking one supports edge / decomposing a node in the cycle / having a participant axiom-mark a node in the cycle." When they look at a contradiction: "consider decomposing one or both nodes / amending one to remove conflict / accepting the contradiction as a bedrock disagreement (each side axiom-marks)." Each suggestion is a localized, click-target chip — inert in this leaf, wired in F7's `mod_resolution_path_picker`.

Concretely, this task lands:

1. **A pure derivation helper** `suggestionsForDiagnostic(payload: DiagnosticPayload): SuggestionMove[]` exported from `apps/moderator/src/graph/diagnosticSuggestions.ts`. The output is the ordered list of methodology-pinned next-action move identifiers for the diagnostic's kind/sub-kind. The discriminated-union vocabulary:

   ```ts
   export type SuggestionMove =
     | 'break-edge'           // cycle (drop one supports edge)
     | 'decompose'            // cycle, contradiction, multi-warrant
     | 'axiom-mark'           // cycle (terminate the chain at one participant's bedrock)
     | 'amend'                // contradiction (edit one node to remove conflict)
     | 'axiom-mark-both'      // contradiction (accept as bedrock disagreement)
     | 'prompt-for-support'   // dangling-claim
     | 'mark-conceded'        // dangling-claim
     | 'review-configuration' // coherency-hint (generic — review the flagged config)
     | 'repair-configuration' // coherency-hint (repair if accidental)
     | 'leave-as-intentional' // coherency-hint (leave if structure is intentional);
   ```

   The mapping (load-bearing — pinned by tests, grounded in `docs/methodology.md` L218–227 and `docs/data-model.md` L173–199):

   - `cycle`           → `['break-edge', 'decompose', 'axiom-mark']`
   - `contradiction`   → `['decompose', 'amend', 'axiom-mark-both']`
   - `multi-warrant`   → `['decompose']` (single canonical move per L225; the methodology's "no requirement to act" advisory framing is communicated by the panel-level `data-diagnostic-severity="advisory"` chrome, not by adding a no-op move)
   - `dangling-claim`  → `['prompt-for-support', 'mark-conceded']`
   - `coherency-hint`  → `['review-configuration', 'repair-configuration', 'leave-as-intentional']` (the three coherency-hint sub-kinds all map to the same three moves per `docs/methodology.md` L227 and `docs/data-model.md` L197 — the methodology pins no per-sub-kind variant. If a future sub-kind needs distinct moves, this helper's switch becomes a nested narrow on `payload.diagnostic.hint.kind`; the test pins the current invariant.)

2. **A `<DiagnosticSuggestionsPanel>` component** mounted in the `diagnosticFlagsSlot` of `<RightSidebar>` (via `Operate.tsx`). The panel reads `activeDiagnostics` for the current session via `useWsStore`, picks the **first active blocking diagnostic** (or, if no blocking entries are active, the first advisory) as the focused diagnostic in this leaf — single-focus picking is the simpler abstraction that's defensible because the full multi-diagnostic flag list is owned by `mod_diagnostic_flag_pane`; see Decisions §D2. For the focused diagnostic the panel renders:
   - a header carrying the localized diagnostic kind title (`t('diagnostics.<kind>.title')` — reuses the existing keys, no duplication),
   - the localized methodology-recommended action prose (`t('diagnostics.<kind>.action')` — reuses the existing keys),
   - a row of chips, one per `SuggestionMove` from the helper's output, each carrying `data-suggestion-move="<move>"` and `data-suggestion-diagnostic-kind="<kind>"` as stable test seams, each disabled with `aria-disabled="true"` (placeholder per Decisions §D3 — the F7 picker will turn them on),
   - an empty-state row when no diagnostic is active (`data-testid="diagnostic-suggestions-empty"`, localized "No active diagnostics" copy).

3. **The new i18n catalog keys** under `moderator.diagnostic.suggestions.*` in en-US / pt-BR / es-419:
   - `panelAriaLabel` (ICU: `Methodology suggestions for {kind} diagnostic`)
   - `panelHeader` (panel chrome heading: `Methodology suggestions`)
   - `empty` (`No active diagnostics`)
   - `move.break-edge` (`Break a supports edge`)
   - `move.decompose` (`Decompose a node`)
   - `move.axiom-mark` (`Axiom-mark a node`)
   - `move.amend` (`Amend a node`)
   - `move.axiom-mark-both` (`Both sides axiom-mark`)
   - `move.prompt-for-support` (`Prompt for support`)
   - `move.mark-conceded` (`Mark as conceded`)
   - `move.review-configuration` (`Review configuration`)
   - `move.repair-configuration` (`Repair configuration`)
   - `move.leave-as-intentional` (`Leave as intentional`)
   - Plus per-move pt-BR / es-419 translations; catalog parity test fails CI if any locale is missing a key.

This task is rendering only. It does NOT capture a resolution proposal, does NOT add a `CaptureMode`, does NOT modify the active-diagnostics projection, does NOT change diagnostic detection or classification, does NOT extend the WS envelope, does NOT touch `mod_diagnostic_highlighting`'s amber halo.

## Why it needs to be done

The methodology engine fires structural diagnostics. The moderator-side `mod_diagnostic_highlighting` already surfaces *where* the problem is (the amber halo on affected nodes / edges). What's still missing is *what to do about it*: the methodology has a catalog of moves per diagnostic kind, but today they live only in the moderator's head (or in `docs/methodology.md`'s prose). During live debate the moderator cannot stop to re-read methodology docs; the suggested moves must be on the screen.

Per `docs/moderator-ui.md` § F7 L120 ("Methodology suggestions appear: decompose, amend, break-edge, accept-as-bedrock (axiom-marks each side)"), this surface is explicitly part of the moderator-UI contract. F7's `mod_resolution_path_picker` will own the *wiring* of those suggestions to real propose actions; this task owns the *display* of the suggestion catalog. Splitting display from wiring is the same split `mod_is_ought_prompt` made (the prompt's decompose / warrant chips are inert placeholders pending the operationalization-mode and warrant-elicitation-mode entry-point tasks).

The cost of leaving this gap until F7 lands is that:

- The F3 diagnostic flow has no methodology-vocabulary surface to point at when discussing resolution paths on-camera (the `IsOughtPrompt` covers is-ought only).
- F7's resolution-path-picker would have to ship both the display layer AND the wiring layer in one task, increasing scope and pushing the methodology-vocabulary pinning later.
- The `moderator.diagnostic.suggestions.move.*` i18n keys this task lands are the locked vocabulary multiple downstream surfaces will use (F7's picker, the eventual blocking-diagnostic banner's "address now" affordance, the audience-broadcast surface's diagnostic ticker if it ever surfaces methodology recommendations). Pinning that vocabulary early — before two surfaces independently coin variants — is the same drift-prevention rationale that motivated the disputation-test chip's pure-helper extraction.

## Inputs / context

Code seams the implementation plugs into:

- [apps/moderator/src/ws/wsStore.ts L48](../../../apps/moderator/src/ws/wsStore.ts#L48) — `WsSessionState.activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`. The panel reads this via the existing `(state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS` selector pattern.
- [apps/moderator/src/ws/wsStore.ts L159](../../../apps/moderator/src/ws/wsStore.ts#L159) — `applyDiagnostic(payload)` reducer. Unchanged.
- [apps/moderator/src/graph/diagnosticHighlights.ts L33](../../../apps/moderator/src/graph/diagnosticHighlights.ts#L33) — `DiagnosticHighlightSeverity` / `DiagnosticHighlightKind` aliases of `WsDiagnosticSeverity` / `WsDiagnosticKind`. Imported verbatim.
- [apps/moderator/src/graph/diagnosticHighlights.ts L62](../../../apps/moderator/src/graph/diagnosticHighlights.ts#L62) — the `WireDiagnostic` discriminated union (the moderator-side mirror of the server's `DiagnosticEntry`). This task imports it (after promoting the module-local types to `export` if not already) rather than re-declaring a second mirror — one drift surface, not two. If the existing types are `internal`-scoped, the implementer promotes them to `export` in the same commit (additive change, no consumer break).
- [apps/moderator/src/graph/diagnosticHighlights.ts L188](../../../apps/moderator/src/graph/diagnosticHighlights.ts#L188) — `diagnosticIdentityKey(payload)`. Used to stable-key the panel's `data-suggestion-diagnostic-key` attribute (the picker downstream will use the same key to address the diagnostic when the chip is wired up).
- [apps/moderator/src/graph/diagnosticHighlights.ts L230](../../../apps/moderator/src/graph/diagnosticHighlights.ts#L230) — `affectedEntities(payload)`. The panel's "focus on canvas" affordance is OUT of scope here (owned by `mod_diagnostic_focus_action`), but the helper's existence means the panel can attach `data-suggestion-affected-nodes="<comma-joined>"` for the future focus action's test seam if desired (deferred — see Decisions §D5).
- [apps/moderator/src/stores/uiStore.ts L20](../../../apps/moderator/src/stores/uiStore.ts#L20) — `SidebarPane = 'pending-proposals' | 'change-history' | 'diagnostic-flags'`. The panel mounts inside the `'diagnostic-flags'` pane; the activeSidebarPane state is unchanged.
- [apps/moderator/src/layout/RightSidebar.tsx L36](../../../apps/moderator/src/layout/RightSidebar.tsx#L36) — `diagnosticFlagsSlot` prop. `Operate.tsx` will pass `<DiagnosticSuggestionsPanel sessionId={sessionId} />` to this slot.
- [apps/moderator/src/routes/Operate.tsx L78](../../../apps/moderator/src/routes/Operate.tsx#L78) — `import { IsOughtPrompt } from '../layout/IsOughtPrompt';`. The same import-plus-slot-prop pattern is used for the new panel.
- [apps/moderator/src/layout/IsOughtPrompt.tsx L41](../../../apps/moderator/src/layout/IsOughtPrompt.tsx#L41) — the disabled-placeholder chip JSX pattern. Mirrored for the suggestion chips (same `disabled`, `aria-disabled="true"`, `disabled:cursor-not-allowed disabled:opacity-70` discipline).
- [apps/server/src/diagnostics/event-emission.ts L66](../../../apps/server/src/diagnostics/event-emission.ts#L66) — server-side `DiagnosticKind` enum, mirrored on the wire as `WsDiagnosticKind`. Source of truth for the kind discriminator.
- [apps/server/src/diagnostics/classification.ts L81](../../../apps/server/src/diagnostics/classification.ts#L81) — `classifyDiagnostic(entry)` (server side; the moderator reads the wire-stamped `payload.severity` instead, never calls this).
- [apps/server/src/ws/broadcast/diagnostic.ts L189](../../../apps/server/src/ws/broadcast/diagnostic.ts#L189) — `dispatch(status, entry)`; the bridge fans out the envelope to subscribed connections. The moderator's `applyDiagnostic` reducer already consumes this stream.
- [packages/shared-types/src/ws-envelope.ts L1196](../../../packages/shared-types/src/ws-envelope.ts#L1196) — `wsDiagnosticKinds` closed enum (`cycle / contradiction / multi-warrant / dangling-claim / coherency-hint`). The helper's exhaustive switch narrows on this.
- [packages/shared-types/src/ws-envelope.ts L1213](../../../packages/shared-types/src/ws-envelope.ts#L1213) — `wsDiagnosticSeverities` closed enum (`blocking / advisory`).
- [packages/shared-types/src/ws-envelope.ts L1258](../../../packages/shared-types/src/ws-envelope.ts#L1258) — `DiagnosticPayload` shape.
- [packages/i18n-catalogs/src/catalogs/en-US.json L390](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L390) — `moderator.diagnostic.*` namespace (existing siblings `isOughtPrompt` and `disputationTest`). The new `suggestions` subtree sits alongside.
- [packages/i18n-catalogs/src/catalogs/en-US.json L500](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L500) — `diagnostics.<kind>` namespace (`title` / `description` / `detail` / `action`). The panel header reuses `diagnostics.<kind>.title` and the contextual prose reuses `diagnostics.<kind>.action` — no duplication.

Methodology / design references:

- [docs/methodology.md L216–233](../../../docs/methodology.md#L216) — "Resolution of structural diagnostics," the canonical per-kind move catalog this helper encodes.
- [docs/methodology.md L222 (cycle)](../../../docs/methodology.md#L222) — "Cycle in `supports` — break one `supports` edge, decompose a node in the cycle, or have a participant axiom-mark a node in the cycle."
- [docs/methodology.md L223 (contradiction)](../../../docs/methodology.md#L223) — "Contradiction — decompose one or both nodes, amend one to remove conflict, or accept the contradiction as a bedrock disagreement."
- [docs/methodology.md L225 (multi-warrant)](../../../docs/methodology.md#L225) — "Multiple competing warrants on one data→claim — decompose the claim."
- [docs/methodology.md L226 (dangling-claim)](../../../docs/methodology.md#L226) — "Dangling claim — a soft prompt; the moderator asks for support or asks whether the claim is being conceded/accepted."
- [docs/methodology.md L227 (coherency-hint)](../../../docs/methodology.md#L227) — "Coherency hints — advisory only; no required resolution." Confirms the methodology pins no per-sub-kind variant.
- [docs/moderator-ui.md L114–123 (F7)](../../../docs/moderator-ui.md#L114) — the design contract: "Methodology suggestions appear: decompose, amend, break-edge, accept-as-bedrock (axiom-marks each side). Pick a path and run through the lifecycle."

Predecessor refinements:

- [`mod_disputation_test_display`](mod_disputation_test_display.md) — the sibling F3 task that just landed. Established the F3-leaf surface conventions this task mirrors (pure helper extracted from the rendering component; `data-*` stable seams; cross-locale Vitest cases; e2e deferred to `mod_pw_diagnostic_flow`). The chip pattern itself is **not reused** (see Decisions §D1); the discipline around it is.
- [`mod_is_ought_prompt`](mod_is_ought_prompt.md) — the first F3 leaf to ship. Pinned the `moderator.diagnostic.*` i18n namespace, the disabled-placeholder chip pattern, the deferred-e2e precedent this task inherits, and the "no new methodology engine, no protocol change" framing.
- [`mod_diagnostic_highlighting`](mod_diagnostic_highlighting.md) — established the moderator-side `WireDiagnostic` mirror, the `affectedEntities` helper, and the `data-diagnostic-severity` seam this task consumes.
- [`diagnostic_event_emission`](../data-and-methodology/diagnostic_event_emission.md) — the engine-side aggregator + bus this task indirectly subscribes to (via the WS broadcast).
- [`ws_diagnostic_broadcast`](../backend/ws_diagnostic_broadcast.md) — the wire envelope that delivers `DiagnosticPayload` to the moderator.

ADRs the implementation cites:

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the suggestion panel is non-canvas chrome (sidebar slot), so no ReactFlow-specific concerns.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized chip labels + panel chrome.
- [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-are-strictly-separate.md) — the entity / facet separation is respected: the panel reads from the diagnostic projection (entity-layer derived view), it does not emit or consume facet-layer events.

No new ADR is required. The task reuses ReactFlow-free chrome (the sidebar slot), Tailwind utilities already in the moderator bundle, the existing `moderator.diagnostic.*` i18n namespace, the existing `WireDiagnostic` mirror, and the existing `activeDiagnostics` projection. The methodology-move vocabulary is data (encoded in a pure helper + i18n keys), not architecture.

## Constraints / requirements

### Derivation helper (pure, no React, no Zustand)

- **File**: `apps/moderator/src/graph/diagnosticSuggestions.ts`. Mirrors the `diagnosticHighlights.ts` / `disputationOutcome.ts` pure-module pattern.
- **Public API**:
  ```ts
  export type SuggestionMove =
    | 'break-edge'
    | 'decompose'
    | 'axiom-mark'
    | 'amend'
    | 'axiom-mark-both'
    | 'prompt-for-support'
    | 'mark-conceded'
    | 'review-configuration'
    | 'repair-configuration'
    | 'leave-as-intentional';

  export function suggestionsForDiagnostic(payload: DiagnosticPayload): readonly SuggestionMove[];
  ```
- **Exhaustive narrow** on `payload.kind` (typed via `WsDiagnosticKind`); for `coherency-hint` the helper additionally narrows on `payload.diagnostic.hint.kind` (via the `WireDiagnostic` mirror) but currently returns the same triple for all three sub-kinds — the test pins the invariant so a future per-sub-kind divergence is a deliberate compile-or-test break, not a silent regression.
- **Module-level comment** cites `docs/methodology.md` L216–233 as the canonical mapping reference and notes that a drift between this helper's mapping and the methodology doc is a methodology-engine-level discrepancy (same drift-pinning comment shape as `disputationOutcome.ts`).
- **Returned array is `readonly` and freshly built per call** — callers (the panel) memoize on `payload` reference if they want stability. The pure helper does not maintain its own cache.

### Panel component (`<DiagnosticSuggestionsPanel>`)

- **File**: `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx`.
- **Props**: `{ readonly sessionId: string }`. Same prop pattern as `<GraphCanvasPane>` and `<PendingProposalsPane>`.
- **Subscription**: uses `useWsStore((state) => state.sessionState[sessionId]?.activeDiagnostics ?? EMPTY_ACTIVE_DIAGNOSTICS)` (reusing the same `EMPTY_ACTIVE_DIAGNOSTICS` constant from `GraphCanvasPane.tsx` — or, if it's not exported, the panel imports a sibling stable empty `Map` constant from `diagnosticSuggestions.ts`). Subscription is read-only.
- **Focus-pick rule** (single-diagnostic in-leaf, see Decisions §D2):
  - Sort the active diagnostics map's values into a stable order: `[...activeDiagnostics.values()].sort()` by `(severity, sequence)` — blocking before advisory, then by ascending sequence (oldest blocking first). Identity ties are broken by `diagnosticIdentityKey(payload)` lexicographic order.
  - Pick the first entry as the focused diagnostic. If the map is empty, render the empty-state row instead.
- **Render shape** when a diagnostic is focused:
  ```tsx
  <section
    data-testid="diagnostic-suggestions-panel"
    data-diagnostic-kind={focused.kind}
    data-diagnostic-severity={focused.severity}
    data-diagnostic-key={diagnosticIdentityKey(focused)}
    role="region"
    aria-label={t('moderator.diagnostic.suggestions.panelAriaLabel', { kind: t(`diagnostics.${focused.kind}.title`) })}
    className="..."
  >
    <header data-testid="diagnostic-suggestions-header" className="...">
      <h3>{t('moderator.diagnostic.suggestions.panelHeader')}</h3>
      <p data-testid="diagnostic-suggestions-kind-title">
        {t(`diagnostics.${focused.kind}.title`)}
      </p>
      <p data-testid="diagnostic-suggestions-action-prose">
        {t(`diagnostics.${focused.kind}.action`)}
      </p>
    </header>
    <ul data-testid="diagnostic-suggestions-moves" className="...">
      {moves.map((move) => (
        <li key={move}>
          <button
            type="button"
            disabled
            aria-disabled="true"
            data-testid={`diagnostic-suggestions-move-${move}`}
            data-suggestion-move={move}
            data-suggestion-diagnostic-kind={focused.kind}
            className="..."
          >
            {t(`moderator.diagnostic.suggestions.move.${move}`)}
          </button>
        </li>
      ))}
    </ul>
  </section>
  ```
- **Render shape** when the map is empty:
  ```tsx
  <section
    data-testid="diagnostic-suggestions-panel"
    data-diagnostic-kind="none"
    role="region"
    aria-label={t('moderator.diagnostic.suggestions.panelHeader')}
    className="..."
  >
    <p
      data-testid="diagnostic-suggestions-empty"
      className="text-xs italic text-slate-500"
    >
      {t('moderator.diagnostic.suggestions.empty')}
    </p>
  </section>
  ```
- **Memoized** focused-pick + `moves` derivation in a `useMemo` keyed on the `activeDiagnostics` map reference, so a noisy re-render of `<Operate>` doesn't churn the chip row.
- **Per-severity panel chrome palette**:
  - `blocking` → `border-rose-400 bg-rose-50` (matches the disputed/blocking visual idiom established by the meta-disagreement and disputed-state stylings).
  - `advisory` → `border-amber-300 bg-amber-50` (matches `IsOughtPrompt`'s panel and the `mod_diagnostic_highlighting` amber halo).
  - The chip buttons themselves stay the disabled-placeholder slate palette (mirrors `IsOughtPrompt` action chips).

### Sidebar mount

- **`Operate.tsx`** passes `<DiagnosticSuggestionsPanel sessionId={sessionId} />` to `<RightSidebar diagnosticFlagsSlot=... />`. This populates the previously-empty `diagnostic-flags` pane. When `mod_diagnostic_flag_pane` lands it will replace this slot with a richer pane that *contains* this panel (or this panel's content), not a separate sidebar slot.
- The pane retains its existing header / expand-collapse / `aria-expanded` chrome from `<RightSidebar>` — no changes there.

### i18n

- **New catalog keys** under `moderator.diagnostic.suggestions` (en-US / pt-BR / es-419):
  - `panelHeader`           → "Methodology suggestions" / "Sugestões metodológicas" / "Sugerencias metodológicas"
  - `panelAriaLabel` (ICU)  → "Methodology suggestions for {kind}" / "Sugestões metodológicas para {kind}" / "Sugerencias metodológicas para {kind}"
  - `empty`                 → "No active diagnostics" / "Sem diagnósticos ativos" / "Sin diagnósticos activos"
  - `move.break-edge`            → "Break a supports edge" / "Romper uma aresta de apoio" / "Romper una arista de apoyo"
  - `move.decompose`             → "Decompose a node" / "Decompor um nó" / "Descomponer un nodo"
  - `move.axiom-mark`            → "Axiom-mark a node" / "Marcar como axioma um nó" / "Marcar como axioma un nodo"
  - `move.amend`                 → "Amend a node" / "Emendar um nó" / "Enmendar un nodo"
  - `move.axiom-mark-both`       → "Both sides axiom-mark" / "Ambos os lados marcam como axioma" / "Ambos lados marcan como axioma"
  - `move.prompt-for-support`    → "Prompt for support" / "Solicitar apoio" / "Solicitar apoyo"
  - `move.mark-conceded`         → "Mark as conceded" / "Marcar como concedido" / "Marcar como concedido"
  - `move.review-configuration`  → "Review configuration" / "Revisar configuração" / "Revisar configuración"
  - `move.repair-configuration`  → "Repair configuration" / "Reparar configuração" / "Reparar configuración"
  - `move.leave-as-intentional`  → "Leave as intentional" / "Manter como intencional" / "Mantener como intencional"
  - Catalog parity must hold across all three locales (the `i18n-catalogs` parity test fails CI on missing keys).
- **The `{kind}` ICU substitution** in `panelAriaLabel` is the *localized* kind title (the panel resolves `diagnostics.<kind>.title` first and passes the resolved string into the ICU template), so the aria label reads naturally in each locale.
- The `diagnostics.<kind>.title` and `diagnostics.<kind>.action` keys (existing, from `i18n_diagnostic_descriptions`) are reused verbatim — no duplication.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided to be the Acceptance bar.

New file `apps/moderator/src/graph/diagnosticSuggestions.test.ts`:

- `suggestionsForDiagnostic` with a cycle payload returns `['break-edge', 'decompose', 'axiom-mark']` (load-bearing, doc-grounded order).
- … with a contradiction payload returns `['decompose', 'amend', 'axiom-mark-both']`.
- … with a multi-warrant payload returns `['decompose']`.
- … with a dangling-claim payload returns `['prompt-for-support', 'mark-conceded']`.
- … with each of the three coherency-hint sub-kind payloads (`incomplete-warrant-missing-bridges-to`, `incomplete-warrant-missing-bridges-from`, `self-contradicts`) returns `['review-configuration', 'repair-configuration', 'leave-as-intentional']` (the per-sub-kind invariant — pinned so a future per-sub-kind divergence is a deliberate break).
- Exhaustive-narrow guard: every value of `WsDiagnosticKind` (sourced from `wsDiagnosticKinds`) yields a non-empty array. A future enum addition trips this test.
- Order-determinism guard: repeated calls with the same payload reference produce arrays whose `.join('\0')` equals (pins the canonical-order discipline).

New file `apps/moderator/src/layout/DiagnosticSuggestionsPanel.test.tsx`:

- Renders the empty-state row when `activeDiagnostics` is an empty map (asserts `data-testid="diagnostic-suggestions-empty"` is present, no `data-testid="diagnostic-suggestions-moves"`).
- Renders the focused-diagnostic panel when one blocking cycle is active: header carries the localized `diagnostics.cycle.title`, action prose carries `diagnostics.cycle.action`, the chip row has three chips with `data-suggestion-move="break-edge"`, `"decompose"`, `"axiom-mark"` in order, all disabled and aria-disabled.
- Renders the contradiction chips when one contradiction is active: three chips `decompose`, `amend`, `axiom-mark-both`.
- When BOTH a blocking and an advisory diagnostic are active, the panel focuses on the blocking one (`data-diagnostic-severity="blocking"` on the panel root).
- When two blocking diagnostics are active with different sequences, the panel focuses on the lower-sequence one (oldest blocking first).
- When two diagnostics with the same severity and sequence are active, the panel focuses on the one whose `diagnosticIdentityKey` sorts lexicographically first (deterministic tie-break).
- The chip buttons are inert: `fireEvent.click(chip)` does NOT change the panel state and does NOT mutate the store (placeholder discipline — pinned so the F7 picker landing notices the regression if it accidentally activates the chips before wiring).
- Locale parity: the en-US / pt-BR / es-419 catalog keys all resolve to non-key strings; the panel header text differs across locales for `panelHeader` and each move label.
- Per-severity chrome class: `data-diagnostic-severity="blocking"` panels carry the rose palette tokens; `"advisory"` panels carry the amber palette tokens.

Extension to `apps/moderator/src/App.test.tsx` (or wherever the `<Operate>` route's integration smoke lives):

- A single integration case: with a session that has one active diagnostic in the moderator's `useWsStore`, the `<RightSidebar>`'s `diagnostic-flags` pane body contains a `data-testid="diagnostic-suggestions-panel"` element. (Smoke only — the panel's per-render behavior is covered by `DiagnosticSuggestionsPanel.test.tsx`.)

No new tests are added to `wsStore.test.ts`, `selectors.test.ts`, `GraphCanvasPane.test.tsx`, `diagnosticHighlights.test.ts`, or `disputationOutcome.test.ts` — this task is purely a new sidebar-pane consumer; the projection + canvas + chip contracts are unchanged.

## Acceptance criteria

1. `apps/moderator/src/graph/diagnosticSuggestions.ts` exists, exports `SuggestionMove` and `suggestionsForDiagnostic(payload)`. Module-level comment cites `docs/methodology.md` L216–233 as the canonical mapping reference.
2. `apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx` exists, exports `DiagnosticSuggestionsPanel`, and renders per Constraints / requirements above. The panel mounts the disabled-placeholder chip row when a diagnostic is active, an empty-state row when no diagnostic is active, and the focused-diagnostic header carrying the localized `diagnostics.<kind>.title` + `diagnostics.<kind>.action`.
3. `apps/moderator/src/routes/Operate.tsx` passes `<DiagnosticSuggestionsPanel sessionId={sessionId} />` to `<RightSidebar diagnosticFlagsSlot=... />`. The placeholder text in the `'diagnostic-flags'` sidebar pane is replaced by the panel.
4. Catalog keys exist in all three locales under `moderator.diagnostic.suggestions.*` with the values listed in Constraints / requirements; catalog parity test passes.
5. All Vitest cases listed under "Tests" above are committed and pass.
6. **Playwright e2e**: explicitly deferred to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow` (per the sibling [`mod_is_ought_prompt`](mod_is_ought_prompt.md) and [`mod_disputation_test_display`](mod_disputation_test_display.md) precedent). **Rationale**: the panel surface is reachable only when an active diagnostic exists in `activeDiagnostics`, which requires the projection to detect a cycle / contradiction / multi-warrant / dangling-claim / coherency-hint and the WS broadcast to deliver the `fired` envelope. While the engine-side pipeline is complete (M2), driving it end-to-end from a Playwright test requires either (a) a user flow that builds a contradiction or a cycle on the canvas — which depends on `mod_resolution_path_picker`-shaped action seams not yet present (the moderator can propose edges, but proposing a contradiction edge that ALSO commits to fire the diagnostic requires the F4 + F6 + F7 capture flows to be integration-reachable end-to-end, which they are not all yet), or (b) a backdoor WS-store seed, which would not exercise the projection-and-broadcast wiring the diagnostic flow actually depends on. Per-component DOM coverage (the Vitest cases above) is the load-bearing test contract that takes the e2e's place for this task; the panel's seams (`data-testid="diagnostic-suggestions-panel"`, `data-suggestion-move="<move>"`, `data-suggestion-diagnostic-kind="<kind>"`, `data-diagnostic-severity="<severity>"`) are stable for the future e2e.
7. **Deferred-e2e debt inheritance**: the future Playwright spec under `mod_pw_diagnostic_flow` MUST assert that, with at least one active blocking diagnostic in the session, the moderator's `'diagnostic-flags'` sidebar pane contains a `data-testid="diagnostic-suggestions-panel"` element whose `data-diagnostic-kind` matches the fired diagnostic's kind and whose chip row contains the kind-specific move chips in canonical order. The stable seams listed in #6 are the contract that future spec inherits. The picker-side wiring (chips fire real propose actions) is the responsibility of `mod_resolution_path_picker`'s own e2e contribution, not this task's debt.
8. `pnpm run check` clean.
9. `pnpm run test:smoke` green; the test count rises by the new Vitest cases.
10. `pnpm -F @a-conversa/moderator build` succeeds.
11. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
12. `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_diagnostic_methodology_suggestions` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md"` line. The `mod_pw_diagnostic_flow` note is extended with the inherited deferred-e2e contract from Acceptance #7.

## Decisions

- **D1: Render the methodology suggestions as a sidebar panel listing chip moves, not as an inline chip on the affected node.** Four alternatives considered:
  1. *Per-node inline chips* (mirror `<DisputationTestChip>` on `<StatementNode>`) — rejected. The disputation outcome is a per-statement methodology label (a 1:1 read of a node's `substance` facet). Methodology suggestions are per-diagnostic, and a diagnostic spans multiple entities (a cycle covers N nodes; a contradiction covers 2 nodes + 1+ edges). Putting the same three "break-edge / decompose / axiom-mark" chips on every node in a cycle would be visually noisy, redundant, and tie the chip's gesture target (a single node) to a move that may apply to a *different* node in the cycle. The methodology's vocabulary is diagnostic-centric, not entity-centric.
  2. *Popover row* (mirror the disputation row in `<HoverPopover>`) — rejected for the same reason as #1 plus: popover surfaces are gated on hover, and suggestion moves are not a hover-detail concern. The moderator wants the suggestion list visible while they decide which move to make; hover-on-affected-node is the wrong gesture.
  3. *Inline panel below the bottom-strip mode banner* (mirror `<IsOughtPrompt>`) — rejected. The is-ought prompt is reactive to `captureStore.mode` (the moderator entered operationalization or warrant-elicitation mode); methodology suggestions are reactive to the `activeDiagnostics` projection (whether any diagnostic is fired, regardless of capture mode). Mounting in the bottom strip would tie the suggestion visibility to capture mode, which is the wrong axis.
  4. *Sidebar pane (the `'diagnostic-flags'` slot)* — chosen. The sidebar's `'diagnostic-flags'` pane is the design contract's home for diagnostic surfaces (`docs/moderator-ui.md` L118 "The diagnostic appears as a flag in the sidebar"). Mounting this leaf there means `mod_diagnostic_flag_pane` (the F7 task that lands the full diagnostic flag list) can later wrap or replace the panel without re-arranging the layout. The stacked-pane chrome from `<RightSidebar>` is already shipped; this task just fills the previously-empty `diagnosticFlagsSlot`.

- **D2: Focus on a single diagnostic at a time in this leaf, picked by `(severity-blocking-first, sequence-ascending, identity-key-lex)`.** Three alternatives considered:
  1. *Render every active diagnostic side-by-side* — premature; the multi-diagnostic flag list is `mod_diagnostic_flag_pane`'s scope, not this leaf's. Shipping a multi-flag panel here would either duplicate F7's work or pin a design that F7 has to overwrite.
  2. *Pick the most-recent fired diagnostic* — rejected. The methodology contract says blocking diagnostics need attention before forward progress; picking by recency would let a benign advisory hint hide an unaddressed blocking cycle.
  3. *Pick blocking-first, then oldest-by-sequence* — chosen. Matches the methodology's "blocking diagnostics block forward progress until acknowledged" forcing (`docs/methodology.md` L222) and the operational reality that the oldest blocking diagnostic is the one most likely to be the active subject. Lexicographic identity-key tiebreak keeps tests deterministic when two diagnostics share severity and sequence.

- **D3: Chips are disabled placeholders (no propose-action wiring) in this leaf.** Three alternatives considered:
  1. *Wire chips to real propose-action handlers in this leaf* — would conflate two concerns: vocabulary pinning (this leaf) and resolution-event emission (F7's `mod_resolution_path_picker`). F7 also depends on `data_and_methodology.diagnostics.blocking_vs_advisory_classification` (already settled) plus a yet-unbuilt `resolution_events` engine surface; pulling that scope into this leaf would push the methodology-vocabulary pinning later, blocking the F7 picker and the audience-broadcast diagnostic ticker on a single bottleneck.
  2. *Render chips as plain text labels (no `<button>`)* — would miss the DOM-shape pinning that F7's picker needs. Shipping the disabled `<button>` shape now means the picker can `disabled={false}` + add the `onClick` handler in one diff, not refactor the markup.
  3. *Disabled `<button>` with `aria-disabled="true"`* — chosen. Mirrors `<IsOughtPrompt>`'s landed pattern (its decompose / warrant chips ship disabled with the exact same justification). The chip seams (`data-suggestion-move`, `data-suggestion-diagnostic-kind`) are stable contracts the picker will switch on.

- **D4: Reuse the existing `diagnostics.<kind>.title` and `diagnostics.<kind>.action` i18n keys for the panel header and action prose.** Two alternatives considered:
  1. *Coin sibling `moderator.diagnostic.suggestions.<kind>.title` / `.action` keys* — rejected. The `diagnostics.<kind>.*` keys were specifically designed in `i18n_diagnostic_descriptions` to be the canonical moderator-facing prose for each diagnostic; coining moderator-only siblings would duplicate strings and create translation-drift risk between the suggestion panel header and the (eventual) diagnostic flag list, the blocking banner, and the audience-broadcast ticker.
  2. *Reuse the existing keys* — chosen. The per-move chip labels (`moderator.diagnostic.suggestions.move.<move>`) are new because the methodology has no prose for the *short* move identifier (the existing `.action` key carries the full multi-sentence prose); the panel header reads the existing prose verbatim.

- **D5: Do NOT stamp `data-suggestion-affected-nodes` / `data-suggestion-affected-edges` attributes in this leaf.** Reasoning: the focus-on-canvas affordance is `mod_diagnostic_focus_action`'s scope; the panel doesn't need the affected-entity ids in the DOM to render, and adding them now would invite a brittle test seam that the focus task will have to re-shape. The future task will compute affected entities via the already-shipped `affectedEntities(payload)` helper and add its own seams.

- **D6: Single-helper-per-kind switch (no per-coherency-hint sub-kind divergence in v1).** The methodology's `docs/methodology.md` L227 and `docs/data-model.md` L197 explicitly state coherency-hint sub-kinds are all advisory-equivalent with the same generic guidance. The helper narrows on sub-kind to surface the seam, but currently returns the same triple; the test pins this invariant so a future per-sub-kind move catalog requires a deliberate change.

- **D7: Promote (not re-mirror) the `WireDiagnostic` shapes from `diagnosticHighlights.ts`.** The mirror types live in `diagnosticHighlights.ts` as module-internal interfaces. This task's helper needs the same narrowing surface. Two alternatives:
  1. *Re-declare a parallel mirror* — rejected; doubles the drift-surface against the server's `DiagnosticEntry` and would require duplicating the drift-pinning test in `diagnosticHighlights.test.ts`.
  2. *Promote the existing types to `export`* — chosen. Additive change to `diagnosticHighlights.ts` (no consumer break). The helper imports `WireDiagnostic` (and the per-kind narrow types) from there. The single drift surface stays single.

- **D8: No new `CaptureMode`.** The suggestions panel is reactive to `activeDiagnostics`, not to capture mode. Adding a `'diagnostic-suggestions'` mode value would either require a corresponding `setMode` caller (there isn't one — the panel is always-on when an active diagnostic exists) or sit unused in the union. Rejected for the same reason `mod_disputation_test_display` rejected a `'disputation-test'` mode.

- **D9: No new wire envelope.** The `diagnostic` envelope already carries everything the panel needs (`kind`, `severity`, `diagnostic` payload, `sequence` for the tiebreak). The panel reads `activeDiagnostics`; the projection is shipped. Adding a `'suggestion'` envelope would duplicate signal with worse latency.

- **D10: e2e deferral to `mod_pw_diagnostic_flow` per the `mod_is_ought_prompt` + `mod_disputation_test_display` precedent.** The panel surface is reachable only when an active diagnostic is fired, which requires the moderator to drive a diagnostic-triggering action end-to-end. While the engine pipeline is M2-complete, the moderator-UI capture flows that *trigger* a structural diagnostic (e.g. proposing a `contradicts` edge that commits to fire a contradiction, or building a cycle via `supports` proposals that commit) are not all yet integration-reachable from Playwright without backdoor seeds. Per ORCHESTRATOR.md UI-stream e2e policy, a deferred e2e MUST identify the future WBS task that inherits the debt; that's `mod_pw_diagnostic_flow` (the F3 Playwright owner, already the canonical inheritor for F3 leaves). The panel's seams are stable for the future spec to assert against.

- **D11: No new ADR.** The task reuses ReactFlow-free chrome, Tailwind utilities, the `moderator.diagnostic.*` i18n namespace, the `WireDiagnostic` mirror, and the existing `activeDiagnostics` projection. The methodology-move vocabulary is data (encoded in a pure helper + i18n keys), not architecture. The seams that pin the per-kind catalog are local to the moderator workspace and don't change any cross-workspace contract.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Pure derivation helper `suggestionsForDiagnostic(payload): readonly SuggestionMove[]` landed in [`apps/moderator/src/graph/diagnosticSuggestions.ts`](../../../apps/moderator/src/graph/diagnosticSuggestions.ts) — exhaustive `WsDiagnosticKind` narrow plus coherency-hint sub-kind narrow (single triple for all three sub-kinds per D6), module-comment citing `docs/methodology.md` L216–233 as the canonical mapping reference.
- `<DiagnosticSuggestionsPanel>` landed in [`apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.tsx) — focused-single-diagnostic pick `(severity-blocking-first, sequence-ascending, identity-key-lex)` per D2, disabled-placeholder chip row per D3, per-severity panel chrome palette (rose/amber), reuses `diagnostics.<kind>.title` and `diagnostics.<kind>.action` keys per D4.
- Mounted in `<RightSidebar diagnosticFlagsSlot=...>` via [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx); the previously-empty `'diagnostic-flags'` pane now hosts the panel.
- `WireDiagnostic` and per-kind shape interfaces promoted to `export` in [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) per D7 — single drift surface preserved.
- New `moderator.diagnostic.suggestions.*` i18n subtree pinned across [en-US](../../../packages/i18n-catalogs/src/catalogs/en-US.json) / [pt-BR](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) / [es-419](../../../packages/i18n-catalogs/src/catalogs/es-419.json): `panelHeader`, `panelAriaLabel` (ICU), `empty`, and 10 `move.<id>` keys; catalog-parity test green.
- Vitest delta 3606 → 3633 (+27: 10 helper cases in [`diagnosticSuggestions.test.ts`](../../../apps/moderator/src/graph/diagnosticSuggestions.test.ts), 16 panel cases in [`DiagnosticSuggestionsPanel.test.tsx`](../../../apps/moderator/src/layout/DiagnosticSuggestionsPanel.test.tsx), 1 integration smoke in [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) asserting the panel mounts in the diagnostic-flags pane body when an active diagnostic exists); `pnpm -F @a-conversa/moderator build` clean; Playwright canvas-visibility regression 4/4 chromium tests green.
- E2e deferred per Acceptance #7 to `moderator_ui.mod_tests.mod_e2e_playwright.mod_pw_diagnostic_flow`; that task's note has been amended to inherit the panel-presence + per-kind chip-row contracts and the stable `data-testid` / `data-suggestion-*` / `data-diagnostic-*` seams this leaf pins.
