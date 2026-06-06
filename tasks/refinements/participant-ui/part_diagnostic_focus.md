# part_diagnostic_focus — Tap a flag to focus the affected region

## TaskJuggler entry

- WBS: `participant_ui.part_diagnostics_view.part_diagnostic_focus`
- Defined in [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji) (the
  `task part_diagnostic_focus "Tap a flag to focus the affected region"` block,
  L427-431, inside `task part_diagnostics_view "View structural diagnostics (P6)"`
  L420).

## Effort estimate

`0.5d` (per the `.tji` block). A handler-addition + thin-seam task, not a markup
or store rewrite — the predecessor `part_diagnostics_list` shipped the inert
diagnostic rows specifically so this leaf is a small diff (its Decision §6: rows
are read-only, "focusing is deferred to sibling task `part_diagnostic_focus`").
The moderator twin `mod_diagnostic_focus_action` (also `0.5d`) is the proven
shape; this task mirrors it on the Cytoscape side.

## Inherited dependencies

Direct `depends`: `!part_diagnostics_list` (L430). Through the parent
`part_diagnostics_view` (L421) it transitively inherits the P6 dependency set
(`!part_graph_view`, `data_and_methodology.diagnostics.diagnostic_event_emission`,
`frontend_i18n.i18n_diagnostic_descriptions`), all settled.

**Settled (shipped):**

- `part_diagnostics_list` — shipped (commit `c0bb6632`) the diagnostics
  inventory this task makes interactive:
  - `apps/participant/src/layout/ParticipantDiagnosticsList.tsx` — the toggle +
    panel + read-only rows (L138-168). Each `<li data-testid="participant-diagnostic-row">`
    already carries `data-diagnostic-key` / `-kind` / `-severity` (L143-146); the
    inner badge+title `<div>` (L149-162) and detail `<p>` (L163-165) are what
    becomes the clickable affordance.
  - `apps/participant/src/layout/ParticipantOperateFooter.tsx` (L23-33) — composes
    `<ParticipantStatusIndicator>` + `<ParticipantDiagnosticsList sessionId={…}>`;
    mounted as the operate route's `footer` prop and rendered on **every** tab
    (the footer is a `ParticipantLayout` sibling of `main`, outside the tab
    switch — see `OperateRoute.tsx:202`).
  - `packages/shell/src/diagnostics/order-active-diagnostics.ts:36` —
    `orderActiveDiagnostics(...)`, the shared blocking-first order the list
    already consumes (`ParticipantDiagnosticsList.tsx:68`).
  - The participant-side `applyDiagnostic(page, payload)` path is exercised by
    `tests/e2e/participant-diagnostics-list.spec.ts` (the spec this task
    extends). See `tasks/refinements/participant-ui/part_diagnostics_list.md`.
- `part_diagnostic_highlights` — shipped the per-entity diagnostic highlight
  styling on the Cytoscape canvas (amber node borders / edge underlays) so the
  affected region is *already visually marked*; this task adds the *navigation*
  to it. The `affectedEntities(payload)` helper that names the region lives in
  the shell package (below). See
  `tasks/refinements/participant-ui/part_diagnostic_highlights.md`.
- `shell_diagnostic_highlights_extract` — `affectedEntities(payload)` at
  `packages/shell/src/diagnostics/diagnostic-highlights.ts:302`, re-exported from
  `@a-conversa/shell` (`packages/shell/src/index.ts:186`).
- `part_pan_zoom_tap` — pinned the Cytoscape mount contract
  (`GraphView.tsx:1169+`): pan/zoom ON, single-select, zoom clamped to
  `[MIN_ZOOM, MAX_ZOOM]` (`GraphView.tsx:226-227`). It also shipped the
  `window.__aConversaCyInstance` test seam (`GraphView.tsx:1074-1096`, set at
  L1206) that exposes the live Cytoscape `Core` to Playwright — load-bearing for
  this task's e2e (Decision §D5).
- `mod_diagnostic_focus_action` — the moderator twin (shipped 2026-06-02). Its
  `uiStore` `FocusRequest` command (`apps/moderator/src/stores/uiStore.ts:35-83`)
  and `useCanvasFocusEffect` consumer hook
  (`apps/moderator/src/graph/useCanvasFocusEffect.ts`) are the line-for-line
  pattern this task ports to the participant's Cytoscape surface. See
  `tasks/refinements/moderator-ui/mod_diagnostic_focus_action.md`.

**Pending:** none.

## What this task is

The diagnostic rows in `<ParticipantDiagnosticsList>` are currently
presentational — they carry `data-diagnostic-*` seams but no click handler
(`ParticipantDiagnosticsList.tsx:141-166`). This task makes **each row
clickable**: tapping a row computes the diagnostic's affected node/edge id set
via `affectedEntities(payload)` and **focuses the graph canvas on that region** —
Cytoscape `cy.animate({ fit: { eles, padding }, … })` pans/zooms so the affected
entities fill the viewport, over the already-rendered amber highlight from
`part_diagnostic_highlights`. Any row focuses *its own* region (not just the
blocking head row).

Two architectural wrinkles this task resolves, both downstream of the
participant layout differing from the moderator's:

1. **The list is outside the graph subtree.** `<ParticipantDiagnosticsList>`
   lives in the operate route's `footer` (`OperateRoute.tsx:202`), a
   `ParticipantLayout` sibling of `main`. `<GraphView>` lives inside `main`
   (`OperateRoute.tsx:424`). The tap and the viewport-move are in disjoint
   subtrees, so the list **cannot reach the Cytoscape `Core` directly.** This
   task bridges them with a **focus-request command** on the existing
   participant `uiStore` (the moderator pattern): the list *dispatches* a
   request; a thin effect *inside* `<GraphView>` consumes it and calls
   `cy.animate({ fit })`.

2. **The graph is conditionally mounted.** `main` renders `<GraphView>` only when
   `currentTab === 'graph'` (`OperateRoute.tsx:421-437`); on the `proposals` or
   `my-agreements` tab the canvas is unmounted, but the footer (and the
   diagnostics list) stays visible. So tapping a diagnostic from a non-graph tab
   must **first switch to the graph tab** (`useUiStore.setCurrentTab('graph')`),
   then dispatch the focus request; the freshly-mounted `<GraphView>` consumes
   the pending request on mount. (See Decision §D2 for why the
   nonce-ref-guard makes mount-handles-pending correct.)

Each clickable row also gains stable `data-diagnostic-affected-nodes` /
`data-diagnostic-affected-edges` seams (mirroring the moderator row), so the
focus target is deterministically assertable in tests without reading the
canvas's pan/zoom transform.

## Why it needs to be done

`part_diagnostics_list` gave the debater the *inventory* — every open structural
flag, blocking-first, reachable from the footer on any tab. But an inventory the
debater can read but not act on is inert: when a flag fires, the next move is
"show me where on my graph this is." `part_diagnostic_focus` is that navigation
gesture — it turns the diagnostics list into a jump-table over the canvas,
pairing with the amber highlight `part_diagnostic_highlights` already paints so a
tap both *navigates to* and *lands on* the marked region. It is the second and
final leaf of `part_diagnostics_view` (P6); completing it closes the diagnostics
view milestone for the participant surface.

## Inputs / context

- `apps/participant/src/layout/ParticipantDiagnosticsList.tsx:138-168` — the
  `ordered.map(...)` row render. Each `<li>` (L141-166) is what this task makes
  interactive; the inner badge+title `<div>` (L149-162) and detail `<p>`
  (L163-165) become the clickable button's content. The component already reads
  `activeDiagnostics` from `useWsStore` (L60-62) and orders via
  `orderActiveDiagnostics` (L68); it imports `diagnosticIdentityKey` (used at
  L139) — `affectedEntities` joins it from the same `@a-conversa/shell` import.
- `apps/participant/src/layout/ParticipantOperateFooter.tsx:23-33` — the footer
  wrapper. No structural change needed; the command channel decouples the list
  from the canvas, so nothing threads through here.
- `apps/participant/src/routes/OperateRoute.tsx:198-205` — `OperateRoute` mounts
  the footer (`<ParticipantOperateFooter sessionId={id}>`, L202) unconditionally,
  confirming the list is visible on every tab.
- `apps/participant/src/routes/OperateRoute.tsx:415-464` — `currentTab =
  useUiStore((s) => s.currentTab)` (L415); the graph region (incl. `<GraphView>`)
  renders only under `currentTab === 'graph'` (L421-437). This is the
  conditional-mount this task accounts for.
- `apps/participant/src/stores/uiStore.ts` — `useUiStore`. Already owns the
  participant's per-surface UI state: `currentTab` (L29) with `setCurrentTab`
  (L55), and `zoom` (L40) with `setZoom` (L56). This is the home for the new
  `focusRequest` field + `requestCanvasFocus` action (Decision §D1) — same
  store that already owns canvas-view state, exactly as the moderator's
  `uiStore` does.
- `apps/participant/src/graph/GraphView.tsx:1135` —
  `const [cyInstance, setCyInstance] = useState<Core | null>(null)`: the
  React-visible Cytoscape handle set in the one-shot mount effect (its purpose,
  per the surrounding comment L1125-1134, is exactly to let a downstream consumer
  KNOW when the instance lands). This task's focus hook consumes `cyInstance`.
- `apps/participant/src/graph/GraphView.tsx:226-227` —
  `export const MIN_ZOOM = 0.1; export const MAX_ZOOM = 2.5;`, pinned onto the
  mount config (L1182-1183). Cytoscape's `fit` respects the instance's
  `minZoom`/`maxZoom`, so framing a single-node region cannot over-zoom past
  `MAX_ZOOM` — no extra clamp logic needed (Constraint §3).
- `apps/participant/src/graph/GraphView.tsx:1074-1096` + `:1206` — the
  `window.__aConversaCyInstance` test seam (`shouldExposeCyTestSeam()` gate:
  Vitest `MODE === 'test'` or the `?aconversaTestMode` query flag). It exposes
  the live `Core` so Playwright can read `cy.pan()` / `cy.zoom()` via
  `page.evaluate(...)` — the e2e's behavioral pin (Decision §D5).
- `packages/shell/src/diagnostics/diagnostic-highlights.ts:302` —
  `affectedEntities(payload): { readonly nodes: readonly string[]; readonly edges: readonly string[] }`.
  Every diagnostic kind returns at least one node (cycle → cycle nodes;
  contradiction → `[nodeA, nodeB]` + edges; multi-warrant → data/claim/warrant
  nodes; dangling-claim → `[nodeId]`; coherency-hint → per sub-kind), so the node
  set is always non-empty and `fit` on the nodes always has a target. The arrays
  are **not deduplicated** — this task dedupes before stamping/focusing.
  Re-exported from `@a-conversa/shell` (`packages/shell/src/index.ts:186`).
- `apps/moderator/src/stores/uiStore.ts:35-83` — the reference
  `FocusRequest = { readonly nodeIds: readonly string[]; readonly edgeIds: readonly string[]; readonly nonce: number }`
  type + `focusRequest` field + `requestCanvasFocus(target)` action (fresh object,
  `nonce` = prev + 1). Port verbatim to the participant `uiStore`.
- `apps/moderator/src/graph/useCanvasFocusEffect.ts` — the reference consumer:
  a `lastHandledNonce` ref-guard + `requestAnimationFrame` → re-frame. This task
  ports its *shape* but swaps the ReactFlow `fitView({ nodes, padding, duration })`
  body for the Cytoscape `cy.animate({ fit: { eles, padding }, duration })` body
  (Constraint §2).
- `apps/moderator/src/layout/DiagnosticFlagPane.tsx:151-177` — the reference
  clickable affordance: a full-width `<button type="button">` carrying the focus
  testid, `onClick` → `requestCanvasFocus`, an interpolated `aria-label`, and the
  `data-diagnostic-affected-*` seams. Port the markup pattern.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — the
  `participant.diagnostics` block (keys today: `header`, `empty`, `toggleLabel`,
  `toggleAria`, `countAria`, `severity`) this task extends with a `focusAria`
  interpolated label. The moderator twin's value is
  `moderator.diagnostic.flags.focusAria = "Focus the canvas on {title}"` — reuse
  the wording. Per-kind titles (`diagnostics.<kind>.title`) already exist in all
  three catalogs.
- `tests/e2e/participant-diagnostics-list.spec.ts` + `applyDiagnostic(page, payload)`
  in `tests/e2e/fixtures/wsStoreSeed.ts` — the proven path for reaching the
  debater operate route (login → invite-accept → lobby → operate) and seeding a
  `fired` diagnostic via `window.__aConversaWsStore`. The focus-behavior
  scenarios extend this spec (Decision §D5).

## Constraints / requirements

1. **Focus-command on the existing participant `uiStore`, not a new store.** Add
   to `apps/participant/src/stores/uiStore.ts`:
   - `focusRequest: FocusRequest | null` where
     `FocusRequest = { readonly nodeIds: readonly string[]; readonly edgeIds: readonly string[]; readonly nonce: number }`;
   - `requestCanvasFocus(target: { nodeIds: readonly string[]; edgeIds: readonly string[] }): void`,
     which sets a **fresh** `focusRequest` object with `nonce` = previous nonce + 1
     (1 from the initial `null`).
   Do **not** create a new dedicated viewport store, and do not thread callbacks
   through `OperateRoute` / `ParticipantOperateFooter` (Decision §D1). Mirror the
   moderator `uiStore` shape line-for-line so the two surfaces stay aligned.
2. **Consumer is a thin, extracted hook.** Add
   `apps/participant/src/graph/useCanvasFocusEffect.ts` exporting
   `useCanvasFocusEffect(cy: Core | null): void`. It subscribes to `useUiStore`'s
   `focusRequest`, holds a `lastHandledNonce` ref, and — only when `cy !== null`,
   `focusRequest !== null`, and its `nonce` advances past the ref — calls, inside
   a `requestAnimationFrame`, `cy.animate({ fit: { eles, padding }, duration, easing })`.
   `eles` is the request's `nodeIds` resolved to the Cytoscape collection
   `cy.collection()` of nodes the instance currently knows (filter via
   `cy.getElementById(id)` non-empty, so a stale request can't ask `fit` to frame
   a node that has left the graph); if the resolved collection is empty, no-op.
   **Guard `cy === null` BEFORE touching `lastHandledNonce`** so a request that
   arrives before the instance lands (the tab-switch-then-mount path) is handled
   once `cyInstance` is set, not dropped. The hook is consumed by one line inside
   `<GraphView>` (`useCanvasFocusEffect(cyInstance)`). The ref-guard (not a store
   write-back) is what makes the effect StrictMode-safe and avoids the canvas
   mutating the store it reads (Decision §D2).
3. **`fit` parameters.** Frame to a **pixel** `padding` (Cytoscape `fit` padding
   is in rendered pixels, unlike ReactFlow's `0..1` ratio) of roughly `48`, and a
   short `duration` of `250` with `easing: 'ease-out'` — a brief animated pan to
   orient the debater. These are tunable details, not contract; the contract is
   "the viewport moves to frame the affected nodes." Cytoscape's `fit` honors the
   instance's `[MIN_ZOOM, MAX_ZOOM]`, so a single-node region won't over-zoom
   (no manual clamp).
4. **Focus on nodes; edges ride their endpoints.** `fit` frames *nodes*. For
   every diagnostic kind each affected edge connects two affected nodes (see the
   `affectedEntities` per-kind shapes), so the affected-edge set never widens the
   region beyond the nodes. Frame `nodeIds`; stamp `edgeIds` in the DOM seam for
   parity/inspection but do not add them to the `fit` collection.
5. **Switch to the graph tab on tap.** The row's click handler calls
   `useUiStore.getState().setCurrentTab('graph')` (idempotent when already
   `'graph'`) **and** `requestCanvasFocus(affectedEntities(payload))` (deduped).
   This is what makes a tap from the `proposals` / `my-agreements` tab navigate
   to the canvas before re-framing it. When already on the graph tab, the mounted
   `<GraphView>`'s focus effect handles the advanced nonce directly; when coming
   from another tab, the freshly-mounted `<GraphView>` handles the pending
   request once `cyInstance` lands (Constraint §2 guard).
6. **Clickable row = a `<button>`, for keyboard operability.** Wrap the row's
   existing inner content (the badge+title `<div>` at L149-162 and the detail
   `<p>` at L163-165) in a single full-width `<button type="button">` carrying:
   - `data-testid="participant-diagnostic-focus-button"`,
   - `onClick` → `setCurrentTab('graph')` + `requestCanvasFocus(...)` (deduped),
   - `aria-label` from `participant.diagnostics.focusAria` interpolated with
     `t('diagnostics.<kind>.title')`.
   Do **not** put `onClick` + `role="button"` + `tabIndex` + key handlers on the
   `<li>` — a real `<button>` gets Enter/Space and the focus-ring for free
   (Decision §D3). The `<li>`'s existing `data-diagnostic-key/-kind/-severity`
   seams stay where they are (handler-addition diff, not markup rewrite, honoring
   `part_diagnostics_list` §6's inert-rows-with-stable-seams intent).
7. **Affected-entity DOM seams.** The button (or its `<li>`) carries:
   - `data-diagnostic-affected-nodes` = the deduped affected node ids joined by a
     single space,
   - `data-diagnostic-affected-edges` = the deduped affected edge ids joined by a
     single space (empty string when none).
   Naming uses the row's established `data-diagnostic-*` family, matching the
   moderator twin's `data-diagnostic-affected-nodes/-edges` exactly (HTML
   token-list convention; node/edge ids contain no spaces).
8. **Tap focuses the canvas + foregrounds the graph tab only — no selection
   change.** The tap does **not** write `useSelectionStore` (the diagnostic
   region is a *set* of entities; the single-selection slot can't represent it,
   and the entity detail panel is a separate concern), does **not** change which
   row is rendered, and does **not** alter `orderActiveDiagnostics` output.
   Diagnostic *highlighting* of the region is already shipped by
   `part_diagnostic_highlights`; this task only navigates to it (Decision §D6).
9. **No wire / store-projection change.** No new WS envelope, no `activeDiagnostics`
   change, no projector change. `focusRequest` is transient client-only UI state
   (ADR 0027 — the list stays an entity-layer reader; a viewport command is
   neither an entity nor a facet event). `setCurrentTab` is an existing UI action.
10. **i18n (ADR 0024).** Add `participant.diagnostics.focusAria` (e.g.
    `"Focus the graph on {title}"`) to all three catalogs (`en-US`, `pt-BR`,
    `es-419`). Non-English values are machine-drafted and go into the
    `*.review.json` `pending` lists for native-speaker sign-off (the parity test
    ignores `*.review.json` by filename). Coin no new per-kind strings —
    interpolate the existing `diagnostics.<kind>.title`.

## Acceptance criteria

All empirical checks ship as committed tests (ADR 0022 — no throwaway
verifications; every assertion below lands in the named test layer, no `node -e`
/ inline probes).

1. **Vitest — `uiStore` focus command** (extend the participant store test, e.g.
   `apps/participant/src/stores/stores.test.tsx`): `requestCanvasFocus({nodeIds, edgeIds})`
   sets `focusRequest` with those ids and `nonce === 1` from the initial `null`;
   a second call advances `nonce` to `2` and replaces the ids; the `focusRequest`
   object reference is fresh each call; initial state is `null`. `setCurrentTab`
   behavior is already covered by the predecessor — no new tab-store cases needed.
2. **Vitest — `useCanvasFocusEffect`** (new
   `apps/participant/src/graph/useCanvasFocusEffect.test.ts`, passing a fake
   Cytoscape `Core` whose `getElementById` returns a non-empty stub for known ids
   and an empty collection otherwise, plus a spy `animate`): advancing
   `focusRequest.nonce` calls `animate` once with a `fit.eles` collection built
   from the known ids (unknown ids filtered out); re-rendering with the **same**
   nonce does **not** re-call `animate` (ref-guard); a request whose ids are all
   unknown does not call `animate`; `focusRequest === null` is a no-op; a request
   that arrives while `cy === null` is handled on the first render where `cy`
   becomes non-null (the tab-switch-then-mount path). Drive the rAF
   deterministically (fake timers or a stubbed `requestAnimationFrame`).
3. **Vitest — `ParticipantDiagnosticsList` tap + seams** (extend the component's
   Vitest, reusing its diagnostics-seeding helper / payload builders): each row
   renders a `participant-diagnostic-focus-button`; clicking the button calls
   `setCurrentTab('graph')` **and** `requestCanvasFocus` with the **deduped**
   `affectedEntities` of *that* row's payload; clicking a non-head (advisory) row
   dispatches that row's region, not the head's; each row's
   `data-diagnostic-affected-nodes` / `data-diagnostic-affected-edges` equal the
   deduped `affectedEntities` output for its payload; the focus button's
   `aria-label` resolves via `participant.diagnostics.focusAria`.
4. **Vitest — i18n parity:** the new `participant.diagnostics.focusAria` key
   resolves in en-US / pt-BR / es-419 (asserted in the component test; the
   `packages/i18n-catalogs` parity test enforces it at CI).
5. **Playwright — focus behavior is IN SCOPE, not deferred** (Decision §D5).
   Extend `tests/e2e/participant-diagnostics-list.spec.ts` (no
   `playwright.config.ts` change — the spec is already in the participant
   project's `testMatch`): reach the debater operate route via the spec's
   existing helper, `seedWsStore` a small multi-node graph, `applyDiagnostic(page,
   payload)` a blocking `cycle` over a node subset that is off-center / not
   already framed. Read the pre-tap `cy.pan()` + `cy.zoom()` via
   `page.evaluate` over the `window.__aConversaCyInstance` seam, open the
   diagnostics panel, click the cycle row's `participant-diagnostic-focus-button`,
   and assert (with Playwright auto-retry/poll to absorb the `duration: 250`
   settle) that `cy.pan()` / `cy.zoom()` **changed** — the viewport re-framed the
   region. Also assert the row's `data-diagnostic-affected-nodes` equals the
   seeded cycle's node ids. Add a **cross-tab** scenario: with `currentTab` driven
   to `proposals` (foreground the proposals tab), tap a diagnostic and assert the
   graph region (`route-operate-graph-region`) becomes visible (tab switched to
   `graph`) and the viewport framed the region. The participant graph e2e
   convention asserts canvas behavior through `window.__aConversaCyInstance` /
   DOM mirrors rather than a DOM transform (Cytoscape paints to `<canvas>`), so
   reading `cy.pan()`/`cy.zoom()` from the seam is the established viewport pin.
6. `make build` and the participant + e2e suites pass; the i18n parity check is
   green.

## Decisions

- **D1: Bridge the footer↔canvas gap with a focus-command field on the existing
  participant `uiStore` — not a new store, not callback-threading, not a
  window-global.** `<ParticipantDiagnosticsList>` is in the route `footer`
  (`OperateRoute.tsx:202`), a `ParticipantLayout` sibling of `main`; `<GraphView>`
  is inside `main` (`OperateRoute.tsx:424`). The tap and the viewport-move are on
  opposite sides of the layout split, so the list can't reach the `Core`
  directly. `uiStore` already owns participant canvas-view state (`zoom`,
  `currentTab`), so a transient `focusRequest` command belongs there. The list
  *dispatches*; a hook inside `<GraphView>` *consumes*. *Alternatives:* (a) a
  new dedicated `viewportStore` — rejected: a second store for one field when
  `uiStore` is the established home is ceremony, and it would diverge from the
  moderator's `uiStore`-hosted twin; (b) thread an `onFocusRegion` callback
  `OperateRoute → ParticipantLayout → ParticipantOperateFooter →
  ParticipantDiagnosticsList` — rejected: `OperateRoute` is *also* outside the
  graph subtree and has no `Core` to pass down; the callback would have to
  originate inside `<GraphView>` and be hoisted out via a ref anyway, i.e. more
  plumbing for worse decoupling; (c) a `window.__aConversaCyInstance` imperative
  call from the list — rejected: that seam is a *test* backdoor gated on a
  test-mode flag (`GraphView.tsx:1074-1096`), not a production app seam. The
  store-command pattern is exactly how the moderator twin
  (`mod_diagnostic_focus_action` §D1) crosses its provider boundary; reusing it
  keeps the two surfaces aligned.

- **D2: Consumer is an extracted `useCanvasFocusEffect(cy)` hook with a
  nonce-ref-guard; the canvas never writes the store it reads, and a
  pre-mount request is handled on the first non-null `cy` render.** The hook keys
  off a monotonic `nonce` and a `lastHandledNonce` ref, firing the `fit` only
  when the nonce advances. The `cy === null` guard sits *before* the ref touch,
  so the tab-switch-then-mount path (tap on the proposals tab → `setCurrentTab`
  mounts `<GraphView>` → `cyInstance` lands a render later) handles the pending
  request once the instance is available rather than dropping it. *Alternative:*
  have the consumer reset `focusRequest` to `null` after handling — rejected: a
  reader writing back to the store it subscribes to is a re-render/ordering smell
  and is fragile under React StrictMode's double-invoked effects; the ref-guard
  achieves idempotency without the write-back, exactly as the moderator twin
  (§D2) does. The `nonce` is load-bearing (ref-guard key + lets an identical
  re-tap re-center), not decorative. A documented, benign consequence of the
  mount-handles-pending path: returning to the graph tab after a tap re-frames
  the most recently tapped region — acceptable (the debater left the canvas
  framed on that region) and strictly better than silently dropping a cross-tab
  tap.

- **D3: The clickable affordance is a real `<button>`, not a click-handled
  `<li>`.** Wrapping the row's inner content in `<button type="button">` gets
  Enter/Space activation, focus-ring, and the correct screen-reader role for
  free. *Alternative:* `onClick` + `role="button"` + `tabIndex={0}` + `onKeyDown`
  on the `<li>` — rejected: re-implements native button semantics by hand and is
  easy to get subtly wrong (Space-scroll, repeat-key). The `<li>`'s existing
  `data-diagnostic-*` seams stay put — handler-addition diff, not markup rewrite.
  Matches the moderator twin (§D3).

- **D4: Affected-entity seams use the `data-diagnostic-affected-*` name.** The
  seam lives on a *diagnostic* row whose established family is `data-diagnostic-*`
  (`ParticipantDiagnosticsList.tsx:143-146`); reusing the prefix makes the row's
  seam set read as one vocabulary, and it matches the moderator twin's
  `data-diagnostic-affected-nodes/-edges` so cross-surface e2e helpers can share
  selectors. Value format: deduped ids joined by a single space, edges → `""`
  when none.

- **D5: e2e is in scope — extend the predecessor spec; do not defer.** Per the
  UI-stream e2e policy's strict "not reachable" test (no route AND no event
  surface): the diagnostics list is route-rendered in the operate footer and a
  `fired` diagnostic is injectable via `window.__aConversaWsStore`
  (`applyDiagnostic` in `tests/e2e/fixtures/wsStoreSeed.ts`), exactly as the
  predecessor's own `tests/e2e/participant-diagnostics-list.spec.ts` already
  does — both reachability counts fail, so the surface IS reachable. Crucially,
  the *viewport-change* assertion that `part_pan_zoom_tap` §12 deferred (because
  Cytoscape paints to `<canvas>` and the moderator's DOM-transform trick doesn't
  apply) is *feasible here* via the `window.__aConversaCyInstance` seam that
  `part_pan_zoom_tap` §8 shipped: Playwright reads `cy.pan()`/`cy.zoom()` from
  `page.evaluate`. The behavioral pin is those values changing on tap; the
  deterministic pin is the `data-diagnostic-affected-nodes` seam; the cross-tap
  scenario pins the `setCurrentTab('graph')` navigation. *Alternative:* defer the
  viewport assertion to a future `part_pw_*` catch-all (as `part_pan_zoom_tap`
  §12 did for raw pan/zoom gestures) — rejected: unlike a raw drag gesture, this
  task's focus is *deterministic* (a known region → a known frame), the seam to
  observe it already exists, and the predecessor spec is already wired to seed
  diagnostics; appending the scenarios costs less than deferring and re-deriving
  the setup later. No new deferral sink is created.

- **D6: Tap focuses the canvas + foregrounds the graph tab only — no selection,
  no row/order change.** The participant's single-`useSelectionStore` slot can't
  represent a multi-entity region, and the entity detail panel is a separate
  tap-an-entity concern; conflating them would inflate a `0.5d` navigation
  gesture into a selection-state feature. The region is *already* visually
  distinguished by `part_diagnostic_highlights`' amber styling, so focus +
  highlight together fully answer "where is this flag." *Alternative:* also select
  the diagnostic's primary node and open its detail panel — rejected: pre-empts
  no specific successor but adds selection-state coupling the task doesn't need;
  it can be layered later behind its own leaf if a product need surfaces.
  Mirrors the moderator twin (§D6) "focus only" boundary.

- **D7: No new ADR.** The task reuses the established Zustand store pattern
  (`uiStore` already holds participant canvas-view state; React per ADR 0003),
  the existing Cytoscape read-mostly surface (ADR 0004), Tailwind (ADR 0005),
  Vitest (ADR 0006), Playwright (ADR 0008), i18n (ADR 0024), and the entity/facet
  separation (ADR 0027 — a viewport command is neither). The
  imperative-command-via-store channel is a thin UI seam with one producer (the
  diagnostics list) and one consumer (the graph hook) today; it is the same
  pattern `mod_diagnostic_focus_action` recorded as a Decision (its §D7) rather
  than an ADR, and this task is the participant port of that already-vetted
  choice — no new dependency, protocol/replay-boundary change, or security
  trade-off. If a second imperative participant viewport command ever appears
  (e.g. "center on selected node"), the `focusRequest` shape generalizes in
  place.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- `apps/participant/src/stores/uiStore.ts` — added `FocusRequest` type, `focusRequest: FocusRequest | null` field (initial `null`), and `requestCanvasFocus(target)` action (nonce increments per call, fresh object each time); mirrors moderator `uiStore` shape.
- `apps/participant/src/graph/useCanvasFocusEffect.ts` — new hook: subscribes to `focusRequest`, nonce-ref-guard, `cy === null` guard before ref touch, resolves node collection via `cy.getElementById`, calls `cy.animate({ fit: { eles, padding: 48 }, duration: 250, easing: 'ease-out' })` inside `requestAnimationFrame`; handles tab-switch-then-mount path.
- `apps/participant/src/graph/GraphView.tsx` — import + `useCanvasFocusEffect(cyInstance)` call (one line added).
- `apps/participant/src/layout/ParticipantDiagnosticsList.tsx` — row inner content wrapped in `<button type="button" data-testid="participant-diagnostic-focus-button">` with `aria-label` from `participant.diagnostics.focusAria`, `onClick` → `setCurrentTab('graph')` + `requestCanvasFocus(deduped affectedEntities)`; `<li>` gains `data-diagnostic-affected-nodes/-edges` seams.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — added `participant.diagnostics.focusAria`.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` + `es-419.json` — machine-drafted translations; `pt-BR.review.json` + `es-419.review.json` pending lists updated.
- `apps/participant/src/graph/useCanvasFocusEffect.test.ts` — new Vitest: nonce-advance calls animate, same-nonce no-op, all-unknown ids no-op, `focusRequest===null` no-op, tab-switch-then-mount path.
- `apps/participant/src/stores/stores.test.tsx` — extended: `requestCanvasFocus` sets `focusRequest` with nonce 1, second call advances to nonce 2, initial state is `null`.
- `apps/participant/src/layout/ParticipantDiagnosticsList.test.tsx` — extended: focus button renders, click dispatches correct region per row, affected-* seams, `focusAria` i18n parity.
- `tests/e2e/participant-diagnostics-list.spec.ts` — extended: "same-tab re-frame" (viewport pan/zoom changes after tap) and "cross-tab navigation" (graph tab foregrounds and viewport re-frames from proposals tab) scenarios.
