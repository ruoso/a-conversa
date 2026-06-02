# mod_diagnostic_focus_action — Click flag to focus affected region

## TaskJuggler entry

- WBS: `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_focus_action`
- Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) (the
  `task mod_diagnostic_focus_action "Click flag to focus affected region"`
  block, L580-585, inside `task mod_diagnostic_resolution_flow "F7 — Resolve a
  structural diagnostic"` L568).

## Effort estimate

`0.5d` (per the `.tji` block). This is a handler-addition + thin-seam task, not
a markup or store rewrite — the predecessor `mod_diagnostic_flag_pane` shipped
the inert flag rows specifically so this leaf is a small diff (its Decision §D3:
"shipping inert rows with stable seams lets that leaf be a handler-addition
diff, not a markup rewrite").

## Inherited dependencies

Direct `depends`: `!mod_diagnostic_flag_pane` (L583). Through the parent
`mod_diagnostic_resolution_flow` (L569) it transitively inherits the F7
dependency set, all settled.

**Settled (shipped):**

- `mod_diagnostic_flag_pane` — shipped `apps/moderator/src/layout/DiagnosticFlagPane.tsx`
  (the flag rows this task makes clickable), `apps/moderator/src/layout/orderActiveDiagnostics.ts`
  (the shared blocking-first order), and the moderator-side
  `applyDiagnostic(page, payload)` / `seedWsStore` Playwright fixtures in
  `tests/e2e/fixtures/wsStoreSeed.ts`. Its `tests/e2e/moderator-diagnostic-flag-pane.spec.ts`
  is the spec this task extends. See
  `tasks/refinements/moderator-ui/mod_diagnostic_flag_pane.md`.
- `mod_diagnostic_methodology_suggestions` — shipped the per-kind
  `affectedEntities(payload)` projection and explicitly **deferred** stamping
  the affected-entity DOM seams to *this* task (its Decision §D5: "the
  focus-on-canvas affordance is `mod_diagnostic_focus_action`'s scope … The
  future task will compute affected entities via the already-shipped
  `affectedEntities(payload)` helper and add its own seams"). See
  `tasks/refinements/moderator-ui/mod_diagnostic_methodology_suggestions.md`.
- `mod_diagnostic_highlighting` / `shell_diagnostic_highlights_extract` — the
  `affectedEntities(payload)` helper. **Path correction:** the `.tji` note and
  older refinements name `apps/moderator/src/graph/diagnosticHighlights.ts` as
  its home, but the third-caller consolidation lifted it to
  `packages/shell/src/diagnostics/diagnostic-highlights.ts:247-270`, re-exported
  from `@a-conversa/shell` (`packages/shell/src/index.ts:152`). The moderator
  graph-local module no longer exists; import from the shell package.
- `mod_pan_zoom` / `mod_layout_tidy_action` — the canvas's `useReactFlow()`
  handle and the `fitView(...)` re-center seam
  (`apps/moderator/src/graph/GraphCanvasPane.tsx:953`, `handleTidyUp` at
  L1410-1417). ReactFlow `11.11.4` (`apps/moderator/package.json`).
- `root_app.root_moderator_cutover` — the moderator app is the live root
  surface; `Operate.tsx` renders both the canvas and the right sidebar.

**Pending:** none.

## What this task is

The flag rows in `<DiagnosticFlagPane>` are currently presentational — they
carry `data-diagnostic-*` seams but no click handler
(`apps/moderator/src/layout/DiagnosticFlagPane.tsx:115-146`). This task makes
**each flag row clickable**: clicking a row computes the diagnostic's affected
node/edge id set via `affectedEntities(payload)` and **focuses the graph canvas
on that region** — ReactFlow `fitView` pans/zooms so the affected entities fill
the viewport. Any row is clickable and focuses *its own* affected region (not
just the auto-focused head row).

The architectural wrinkle this task resolves: the flag pane lives in the right
sidebar (`Operate.tsx:338`), which is **outside** the `<ReactFlowProvider>`
(mounted inside `GraphCanvasPane`, `GraphCanvasPane.tsx:937-939`), so the pane
**cannot call `useReactFlow().fitView()` directly**. The click and the
viewport-move are on opposite sides of the provider boundary. This task bridges
them with a small **focus-request command** on the existing `uiStore` (which
already owns canvas view state — the `zoom` field): the pane *dispatches* a
focus request; a thin effect *inside* the provider consumes it and calls
`fitView`.

Each clickable row also gains stable `data-diagnostic-affected-nodes` /
`data-diagnostic-affected-edges` seams (the affected-entity contract deferred
here from `mod_diagnostic_methodology_suggestions` §D5), so the focus target is
deterministically assertable in tests without reading viewport transform math.

## Why it needs to be done

`mod_diagnostic_flag_pane` gave the moderator the *inventory* — every open flag,
blocking-first. But an inventory the moderator can read but not act on is
inert: the next move in resolving a diagnostic is "show me where on the graph
this is." `mod_diagnostic_focus_action` is that navigation gesture — it turns
the flag list into a jump-table over the canvas. It is the immediate
predecessor of `mod_resolution_path_picker` (L586-591,
`depends !mod_diagnostic_focus_action`): once the moderator can focus a flag's
region, the picker can offer the resolution moves for the focused diagnostic.

## Inputs / context

- `apps/moderator/src/layout/DiagnosticFlagPane.tsx:115-146` — the flag row
  `<li>` this task makes interactive. It already carries
  `data-diagnostic-key/kind/severity` and `data-focused`; the row inner content
  (the `<div>` badge+title at L130-140 and the action `<p>` at L141-143) is what
  becomes the clickable affordance. The header comment at L17-24 forecasts
  exactly this leaf ("Turning a flag click into a canvas-focus gesture (and
  stamping `data-suggestion-affected-*` via `affectedEntities`) is the next leaf
  `mod_diagnostic_focus_action`").
- `packages/shell/src/diagnostics/diagnostic-highlights.ts:247-270` —
  `affectedEntities(payload): { readonly nodes: readonly string[]; readonly edges: readonly string[] }`.
  Every diagnostic kind returns at least one node (cycle → cycle nodes;
  contradiction → `[nodeA, nodeB]` + edges; multi-warrant → data/claim/warrant
  nodes; dangling-claim → `[nodeId]`; coherency-hint → per sub-kind, L272-284),
  so the node set is always non-empty and `fitView` on the nodes always has a
  target. The arrays are **not deduplicated** (L243-245) — this task dedupes
  before stamping/focusing. Re-exported from `@a-conversa/shell`
  (`packages/shell/src/index.ts:152`); the pane already imports
  `diagnosticIdentityKey` from there (`DiagnosticFlagPane.tsx:30`).
- `apps/moderator/src/stores/uiStore.ts:26-47` — `useUiStore`. Already owns
  per-session canvas view state (`zoom`, clamped; `MIN_ZOOM`/`MAX_ZOOM`) plus
  `activeSidebarPane`. This is the home for the new `focusRequest` field +
  `requestCanvasFocus` action (Decision D1). In-memory only, per its header
  comment — matches a transient viewport command.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:937-941` — `GraphCanvasPane`
  wraps `GraphCanvasPaneInner` in `<ReactFlowProvider>`; only the inner
  component may call `useReactFlow()` (`:953`). The sidebar is outside this
  subtree.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:1410-1417` — `handleTidyUp`: the
  existing `fitView({ duration: 0, padding: 0.1 })` precedent, called inside a
  `requestAnimationFrame` so ReactFlow's internal node-position store is settled
  before the bounding box is computed. The focus effect mirrors this
  rAF-then-`fitView` shape, passing `{ nodes }`.
- `apps/moderator/src/routes/Operate.tsx:338` — the `diagnosticFlagsSlot={<DiagnosticFlagPane sessionId={…} />}`
  mount. No change needed here (the command channel decouples the pane from the
  canvas; nothing threads through `Operate`).
- `packages/i18n-catalogs/src/catalogs/en-US.json:649-656` — the
  `moderator.diagnostic.flags` block (`header`, `severity.*`, `countAria`) this
  task extends with a `focusAria` interpolated label. Per-kind titles
  (`diagnostics.<kind>.title`) already exist in all three catalogs.
- `apps/moderator/src/layout/DiagnosticFlagPane.test.tsx` and
  `apps/moderator/src/layout/orderActiveDiagnostics.test.ts` — the predecessor's
  Vitest; the click/seam cases extend the former, reusing its `applyDiagnostic`
  store seam + `*FiredPayload` builders.
- `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` + the
  `applyDiagnostic(page, payload)` / `seedWsStore` helpers in
  `tests/e2e/fixtures/wsStoreSeed.ts` (L165, L369) under the
  `chromium-create-session` Playwright project — the proven path for seeding a
  `fired` diagnostic into a live moderator client. The focus-behavior scenarios
  extend this spec (Decision D5).

## Constraints / requirements

1. **Focus-command on the existing `uiStore`, not a new store.** Add to
   `useUiStore`:
   - `focusRequest: FocusRequest | null` where
     `FocusRequest = { readonly nodeIds: readonly string[]; readonly edgeIds: readonly string[]; readonly nonce: number }`;
   - `requestCanvasFocus(target: { nodeIds: readonly string[]; edgeIds: readonly string[] }): void`,
     which sets a **fresh** `focusRequest` object with `nonce` = previous
     nonce + 1.
   Do **not** create a new dedicated viewport store (Decision D1). Do not
   thread callbacks through `Operate`/`RightSidebar` (Decision D1 alternatives).
2. **Consumer is a thin, extracted hook.** Add
   `apps/moderator/src/graph/useCanvasFocusEffect.ts` exporting
   `useCanvasFocusEffect(reactFlow: ReactFlowInstance): void`. It subscribes to
   `useUiStore`'s `focusRequest`, holds a `lastHandledNonce` ref, and — only
   when `focusRequest !== null` and its `nonce` advances past the ref — calls,
   inside a `requestAnimationFrame`, `fitView({ nodes, padding, duration })`
   where `nodes` is the request's `nodeIds` mapped to `{ id }` and filtered to
   ids ReactFlow currently knows (`reactFlow.getNode(id) !== undefined`). The
   hook is consumed by one line in `GraphCanvasPaneInner`
   (`useCanvasFocusEffect(reactFlow)`). The ref-guard (not a store write-back)
   is what makes the effect StrictMode-safe and avoids the canvas mutating the
   store it reads (Decision D2).
3. **`fitView` parameters.** `padding: 0.2` (slightly looser than tidy-up's
   `0.1` so the region isn't edge-to-edge) and `duration: 250` (a short animated
   pan to orient the moderator; tidy-up uses `0` because it re-frames the whole
   graph). These are tunable details, not contract; the contract is "the
   viewport moves to frame the affected nodes."
4. **Focus on nodes; edges ride their endpoints.** `fitView` frames *nodes*. The
   affected-edge set never widens the region beyond the affected nodes (for
   every kind, each affected edge connects two affected nodes — see the
   `affectedEntities` per-kind shapes), so framing `nodeIds` suffices. Edges are
   stamped in the DOM seam for parity/inspection but are not passed to `fitView`.
5. **Clickable row = a `<button>`, for keyboard operability.** Wrap the row's
   existing inner content (the badge+title `<div>` and the action `<p>`) in a
   single full-width `<button type="button">` carrying:
   - `data-testid="diagnostic-flag-focus-button"`,
   - `onClick` → `requestCanvasFocus(affectedEntities(payload))` (deduped),
   - `aria-label` from `moderator.diagnostic.flags.focusAria` interpolated with
     `t('diagnostics.<kind>.title')`.
   Do **not** put `onClick` + `role="button"` + `tabIndex` + key handlers on the
   `<li>` (Decision D3 alternative) — a real `<button>` gets Enter/Space and
   focus-ring for free. The `<li>`'s existing `data-diagnostic-*` / `data-focused`
   / `aria-current` seams stay where they are (no churn to the predecessor's
   per-row contract).
6. **Affected-entity DOM seams (the §D5 deferral, paid here).** The button (or
   its `<li>`) carries:
   - `data-diagnostic-affected-nodes` = the deduped affected node ids joined by
     a single space,
   - `data-diagnostic-affected-edges` = the deduped affected edge ids joined by
     a single space (empty string when none).
   Naming uses the row's established `data-diagnostic-*` family rather than the
   `data-suggestion-*` prefix the `.tji` note tentatively suggested — that
   prefix belonged to the suggestions-panel chip-row context that no longer
   hosts this affordance (Decision D4). The `.tji` note's "(or equivalent)"
   covers the rename.
7. **No selection / order mutation.** Clicking a row focuses the canvas only. It
   does **not** change which flag is `data-focused` (still derived from
   `orderActiveDiagnostics(...)[0]`), does **not** introduce a
   `selectedDiagnosticKey` store field, and does **not** re-target the embedded
   `<DiagnosticSuggestionsPanel>`. Selection/resolution is `mod_resolution_path_picker`'s
   scope (Decision D6, continuing the predecessor's §D4 boundary).
8. **No wire/store-projection change.** No new WS envelope, no `activeDiagnostics`
   change, no new `CaptureMode`. `focusRequest` is transient client-only UI
   state (ADR 0027 — the pane stays an entity-layer reader; a viewport command
   is neither an entity nor a facet event).
9. **i18n (ADR 0024).** Add `moderator.diagnostic.flags.focusAria` (e.g.
   `"Focus the canvas on {title}"`) to all three catalogs
   (`en-US`, `pt-BR`, `es-419`). Non-English values are machine-drafted and go
   into the `*.review.json` `pending` lists for native-speaker sign-off (the
   parity test ignores `*.review.json` by filename). Coin no new per-kind
   strings — interpolate the existing `diagnostics.<kind>.title`.

## Acceptance criteria

All empirical checks ship as committed tests (ADR 0022 — no throwaway
verifications).

1. **Vitest — `uiStore` focus command** (extend
   `apps/moderator/src/stores/stores.test.tsx` or co-locate): `requestCanvasFocus({nodeIds, edgeIds})`
   sets `focusRequest` with those ids and `nonce === 1` from the initial
   `null`; a second call advances `nonce` to `2` and replaces the ids; the
   `focusRequest` object reference is fresh each call. Initial state is `null`.
2. **Vitest — `useCanvasFocusEffect`** (new
   `apps/moderator/src/graph/useCanvasFocusEffect.test.ts`, mocking
   `useReactFlow`/passing a fake `ReactFlowInstance` whose `getNode` returns a
   stub for known ids and `undefined` otherwise, and a spy `fitView`): advancing
   `focusRequest.nonce` calls `fitView` once with `nodes` = the known ids mapped
   to `{ id }` (unknown ids filtered out); re-rendering with the **same** nonce
   does **not** re-call `fitView` (ref-guard); a request whose ids are all
   unknown does not call `fitView`; `focusRequest === null` is a no-op. (Drive
   the rAF deterministically — fake timers or a stubbed `requestAnimationFrame`.)
3. **Vitest — `DiagnosticFlagPane` click + seams** (extend
   `apps/moderator/src/layout/DiagnosticFlagPane.test.tsx`, reusing the
   `applyDiagnostic` seam + `*FiredPayload` builders): each row renders a
   `diagnostic-flag-focus-button`; clicking the button (and pressing
   Enter/Space on it via `userEvent`) calls `requestCanvasFocus` with the
   **deduped** `affectedEntities` of *that* row's payload; clicking a non-head
   (advisory) row dispatches that row's region, not the head's; each row's
   `data-diagnostic-affected-nodes` / `data-diagnostic-affected-edges` equal the
   deduped affectedEntities output for its payload; the focus button's
   `aria-label` resolves via `moderator.diagnostic.flags.focusAria`.
4. **Vitest — i18n parity:** the new `moderator.diagnostic.flags.focusAria` key
   resolves in en-US / pt-BR / es-419 (asserted in the pane test; the
   `packages/i18n-catalogs` parity test enforces it at CI).
5. **Playwright — focus behavior** (e2e is **in scope, not deferred** — the
   flag pane is route-rendered and a `fired` diagnostic is seedable today via
   the `window.__aConversaWsStore` backdoor; see Decision D5). Extend
   `tests/e2e/moderator-diagnostic-flag-pane.spec.ts` (no `playwright.config.ts`
   change — the spec is already in `chromium-create-session`'s `testMatch`):
   create session → seed participants → enter `/m/sessions/:id/operate` →
   `seedWsStore` a small multi-node graph → `applyDiagnostic(page, payload)` a
   blocking `cycle` over a node subset that is off-center / not already framed.
   Capture the `.react-flow__viewport` `transform` attribute, click the cycle
   row's `diagnostic-flag-focus-button`, and assert the transform **changes**
   (the viewport moved/zoomed to the affected region). Also assert the row's
   `data-diagnostic-affected-nodes` equals the seeded cycle's node ids. (Use
   Playwright auto-retry/poll to absorb the `duration: 250` animation settle.)
6. `make build` and the moderator + e2e suites pass; the i18n parity check is
   green.

## Decisions

- **D1: Bridge the provider boundary with a focus-command field on the existing
  `uiStore` — not a new store, not callback-threading, not a window-global.**
  The sidebar (`Operate.tsx:338`) is outside the `<ReactFlowProvider>`
  (`GraphCanvasPane.tsx:937-939`), so the pane can't call `fitView` directly.
  `uiStore` already owns per-session canvas view state (the `zoom` field,
  `uiStore.ts:29`), so a transient `focusRequest` command belongs there. The
  pane *dispatches*; a hook inside the provider *consumes*. *Alternatives:* (a)
  a brand-new dedicated `viewportStore` — rejected: a second store for one
  field, when `uiStore` is the established home for canvas-view state, is
  ceremony; (b) thread an `onFocusNodes` callback `Operate → RightSidebar →
  DiagnosticFlagPane` — rejected: `Operate` is *also* outside the provider, so
  it has no `fitView` to pass down; the callback would have to originate inside
  `GraphCanvasPane` and be hoisted out via a ref anyway, i.e. more plumbing for
  worse decoupling; (c) a `window.__aConversaGraphCanvas` imperative handle —
  rejected: window-globals are a test backdoor, not an app seam; untyped and
  un-idiomatic. The store-command pattern mirrors how diagnostic *highlights*
  already cross the boundary (store → selector → canvas), just for an imperative
  one-shot instead of derived state.

- **D2: Consumer is an extracted `useCanvasFocusEffect` hook with a
  nonce-ref-guard; the canvas never writes the store it reads.** The hook keys
  off a monotonic `nonce` and a `lastHandledNonce` ref, firing `fitView` only
  when the nonce advances. *Alternative:* have the consumer reset
  `focusRequest` to `null` after handling — rejected: a reader writing back to
  the store it subscribes to is a re-render/ordering smell and is fragile under
  React StrictMode's double-invoked effects; the ref-guard achieves
  idempotency without the write-back. The `nonce` is load-bearing (it is the
  ref-guard's key and lets an identical re-click re-center), not decorative.
  Extracting the hook (vs. inlining the effect in the 1700-line
  `GraphCanvasPaneInner`) gives a clean unit-test seam and keeps the canvas diff
  to a single call site.

- **D3: The clickable affordance is a real `<button>`, not a click-handled
  `<li>`.** Wrapping the row's inner content in `<button type="button">` gets
  Enter/Space activation, focus-ring, and the correct screen-reader role for
  free. *Alternative:* `onClick` + `role="button"` + `tabIndex={0}` +
  `onKeyDown` on the `<li>` — rejected: re-implements native button semantics by
  hand and is easy to get subtly wrong (Space-scroll, repeat-key). The existing
  per-row `data-diagnostic-*` / `data-focused` / `aria-current` seams stay on
  the `<li>`, so the predecessor's contract is untouched (handler-addition diff,
  not markup rewrite — honoring `mod_diagnostic_flag_pane` §D3).

- **D4: Affected-entity seams use the `data-diagnostic-affected-*` name, not
  `data-suggestion-affected-*`.** The `.tji` note tentatively named
  `data-suggestion-affected-nodes/-edges`, but that prefix was coined for the
  suggestions-panel *chip* row; here the seam lives on a *flag* row whose
  established family is `data-diagnostic-*`. Consistent naming makes the row's
  seam set read as one vocabulary. The note's "(or equivalent)" sanctions the
  rename. Value format: deduped ids joined by a single space (HTML token-list
  convention; node/edge ids contain no spaces), edges → `""` when none. This
  pays down the affected-entity seam contract that
  `mod_diagnostic_methodology_suggestions` §D5 deferred to this task.

- **D5: e2e is in scope — extend the predecessor spec; do not defer to
  `mod_pw_diagnostic_flow`.** The flag pane is route-rendered and a `fired`
  diagnostic is injectable via `window.__aConversaWsStore`
  (`applyDiagnostic(page, payload)` in `tests/e2e/fixtures/wsStoreSeed.ts`),
  exactly as the predecessor's own Playwright spec already does — so the
  UI-stream policy's strict "not reachable" test (no route AND no event surface)
  fails on both counts. The behavioral pin is the `.react-flow__viewport`
  `transform` changing on click; the deterministic pin is the
  `data-diagnostic-affected-nodes` seam. *Alternative:* defer to
  `mod_pw_diagnostic_flow` as `mod_diagnostic_methodology_suggestions` §D6 did —
  rejected: `mod_pw_diagnostic_flow` is named as a deferral sink by 8+ prior
  refinements yet is **not a registered WBS task** (per `mod_diagnostic_flag_pane`
  §D5); adding a ninth deferral worsens a planning-debt time bomb. A few
  scenarios appended to the already-wired flag-pane spec cost less than the debt.

- **D6: Click focuses the canvas only — no selection, no order change, no
  panel re-target.** This continues `mod_diagnostic_flag_pane` §D4's boundary:
  "focused" stays derived from `orderActiveDiagnostics(...)[0]`. User-driven
  diagnostic *selection* (a click promoting a flag to the focused suggestion) is
  `mod_resolution_path_picker`'s scope. *Alternative:* have a click also select
  the diagnostic and re-target the suggestions panel — rejected: pre-empts the
  next leaf's design and inflates a 0.5d navigation gesture into a selection-state
  feature.

- **D7: No new ADR.** The task reuses the established Zustand store pattern
  (`uiStore` already holds canvas view state; React per ADR 0003), Tailwind
  (ADR 0005), Vitest (ADR 0006), Playwright (ADR 0008), i18n (ADR 0024), and the
  entity/facet separation (ADR 0027 — a viewport command is neither). The
  imperative-command-via-store channel is a thin UI seam with one producer (the
  flag pane) and one consumer (the canvas hook) today; it does not introduce a
  new dependency, a protocol/replay-boundary change, or a security trade-off, so
  it is recorded here as a Decision rather than an ADR. If a second imperative
  viewport command ever appears (e.g. "center on selected node"), the
  `focusRequest` shape generalizes in place — that is a future implementation
  choice, not a standing question to re-litigate.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-02.

- Added `FocusRequest` type, `focusRequest` field, and `requestCanvasFocus` action to `apps/moderator/src/stores/uiStore.ts`; focus-command is transient client-only UI state with a monotonic nonce.
- Created `apps/moderator/src/graph/useCanvasFocusEffect.ts` — nonce-ref-guarded hook that calls `requestAnimationFrame` → `fitView({ nodes, padding: 0.2, duration: 250 })`, filtering unknown node ids; prevents StrictMode double-fire.
- Added `useCanvasFocusEffect(reactFlow)` call site to `apps/moderator/src/graph/GraphCanvasPane.tsx` (inside the `<ReactFlowProvider>` boundary).
- Wrapped each flag row's inner content in a real `<button type="button" data-testid="diagnostic-flag-focus-button">` with `onClick` dispatching `requestCanvasFocus(affectedEntities(payload))` (deduped) and `aria-label` from `moderator.diagnostic.flags.focusAria`; stamped `data-diagnostic-affected-nodes` / `data-diagnostic-affected-edges` on the button — paying down the §D5 seam contract from `mod_diagnostic_methodology_suggestions`; `apps/moderator/src/layout/DiagnosticFlagPane.tsx`.
- Added `moderator.diagnostic.flags.focusAria` to all three catalogs (`packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json`); non-English drafts flagged in `pt-BR.review.json` and `es-419.review.json`.
- Extended Vitest: 3 `requestCanvasFocus` cases in `apps/moderator/src/stores/stores.test.tsx`; 6 `useCanvasFocusEffect` cases in new `apps/moderator/src/graph/useCanvasFocusEffect.test.ts`; button/seam/aria/parity cases in `apps/moderator/src/layout/DiagnosticFlagPane.test.tsx`.
- Extended Playwright: focus-on-click scenario (viewport transform changes + `data-diagnostic-affected-nodes` seam) in `tests/e2e/moderator-diagnostic-flag-pane.spec.ts`.
- Deviation: Enter/Space covered structurally via native `<button type="button">` (keyboard contract for free) rather than `userEvent` — `@testing-library/user-event` is not a project dependency; adding it requires an ADR (out of scope).
