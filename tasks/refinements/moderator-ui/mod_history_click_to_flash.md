# Refinement — `moderator_ui.mod_change_history_pane.mod_history_click_to_flash`

## TaskJuggler entry

Defined in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) (lines 684–688):

```tj
task mod_history_click_to_flash "Click entry to flash affected entities on graph" {
  effort 1d
  allocate team
  depends !mod_history_scroller
}
```

Nested under `moderator_ui.mod_change_history_pane`. This refinement lives at
`tasks/refinements/moderator-ui/mod_history_click_to_flash.md`.

## Effort estimate

**1d.** The work is three small, mechanical pieces against seams that already
exist:

1. A pure `affectedEntities(event)` helper (mirrors the established
   `summarizeEvent` shape in `eventSummary.ts`) that maps one event to the
   graph-entity ids it touches — a switch over `EventKind` with a `never`
   fallback, plus a sub-switch over proposal kinds.
2. A transient **entity-flash channel** modelled exactly on the existing
   canvas-focus channel (`useUiStore.requestCanvasFocus` /
   `useCanvasFocusEffect`) and the selection store (`useSelectionStore`):
   a small zustand slice the node/edge components read by id, plus a one-line
   auto-clear effect.
3. Wiring an activation affordance onto the change-history row that dispatches
   both **re-frame** (reuse `requestCanvasFocus`) and **flash** (new channel).

No new dependency, no i18n catalog work (the affordance is a non-textual
visual flash), no schema change. The bulk is the exhaustive `affectedEntities`
switch, which is graceful against over-extraction (see Decision §D3), so the
proposal arm carries low edge-case risk.

## Inherited dependencies

**Settled (hard dependency):**

- **`mod_history_scroller`** — ships the change-history pane
  (`apps/moderator/src/layout/ChangeHistoryPane.tsx`), the stable row contract
  (`<li data-testid="change-history-row" data-event-id data-event-kind
  data-sequence>` at `ChangeHistoryPane.tsx:153–188`), the
  `ChangeHistoryRow` view-model (`apps/moderator/src/graph/changeHistory.ts:38–69`),
  and the REST-prefetch + WS-overlay merge seam `mergeAndOrderEventLog`
  (`changeHistory.ts:82–109`). This task extends the row, not reshapes it.

**Settled (available seams this task reuses, not formal `depends`):**

- **`mod_diagnostic_focus_action`** — the canvas-focus command channel:
  `FocusRequest` + `requestCanvasFocus` on `useUiStore`
  (`apps/moderator/src/stores/uiStore.ts:35–83`) and its consumer
  `useCanvasFocusEffect` (`apps/moderator/src/graph/useCanvasFocusEffect.ts:34–62`).
  This task dispatches `requestCanvasFocus` to re-frame the viewport on the
  clicked row's entities — no change to that channel.
- **`mod_state_management` / selection** — `useSelectionStore`
  (`apps/moderator/src/stores/selectionStore.ts:15–33`) is the precedent for a
  store the node/edge components subscribe to by id and self-style from
  (selection paints `ring-4 ring-sky-500`, stamps `data-selected`). The new
  flash store copies that read-by-id pattern.
- **`mod_history_event_summary`** — runs in parallel (it is *not* a `depends`
  of this task). It also extends `ChangeHistoryRow` (adds `summary`) and
  establishes the "pure `graph/*` helper, one event in → descriptor out, no
  cross-event resolution in v1" convention
  (`eventSummary.ts:96–172`, its Decision §D4) that `affectedEntities` follows.
  Both extensions to `ChangeHistoryRow` are independent fields; the implementer
  merges them additively.

**Pending:** none. Everything this task needs is already on disk.

## What this task is

Make a change-history row **clickable**, so activating it (mouse or keyboard)
(a) re-frames the graph canvas onto the entities that event affected and
(b) briefly **flashes** those entities — a transient, self-clearing pulse that
draws the moderator's eye to the node(s)/edge(s) the event touched. This closes
the loop the predecessor refinements deferred: `mod_history_event_summary`
deliberately did **not** resolve a row's target ids to wordings inline,
recording that "the sibling `mod_history_click_to_flash` will make those
references navigable on the graph instead" (`eventSummary.ts:38–42`).

## Why it needs to be done

The change-history pane is read-only today — it tells the moderator *what*
happened but not *where* on the graph. In a busy session the graph can hold
dozens of nodes and edges; a row like "Edge created · supports · 2 min ago" is
only actionable if the moderator can find the edge. Click-to-flash turns each
history row into a jump-to-entity affordance, which is the navigation primitive
the whole pane was built toward (`mod_history_scroller` Inputs note: "makes a
row click flash the affected graph entities"). It also lets later diagnostic /
replay flows reuse the same flash channel to point at entities from any pane.

## Inputs / context

- **Row contract & view-model** (extend, do not reshape):
  - Row JSX: `apps/moderator/src/layout/ChangeHistoryPane.tsx:153–188` — the
    `<li data-testid="change-history-row" data-event-id={row.id}
    data-event-kind={row.kind} data-sequence={row.sequence}>` with kind /
    optional summary / actor / timestamp columns. No `onClick` today.
  - `ChangeHistoryRow` interface: `apps/moderator/src/graph/changeHistory.ts:38–69`
    (`id`, `sequence`, `kind`, `actor`, `createdAt`, `summary`).
  - `mergeAndOrderEventLog(prefetched, live)`: `changeHistory.ts:82–109` — the
    one place rows are built; `mod_history_event_summary` added `summary` here,
    this task adds `affected` here the same way.
- **Pure per-event helper precedent**: `apps/moderator/src/graph/eventSummary.ts:96–172`
  — `summarizeEvent(event)`, an exhaustive `switch (event.kind)` with a
  `never`-narrowed `default` returning a safe value. `affectedEntities` mirrors
  this shape (pure, clock/RNG/UI-free, total over `EventKind`).
- **Canvas-focus channel (reused for re-framing)**:
  - `apps/moderator/src/stores/uiStore.ts:35–83` — `FocusRequest { nodeIds,
    edgeIds, nonce }` and `requestCanvasFocus({ nodeIds, edgeIds })`, which
    advances a monotonic nonce so an identical re-click re-centers.
  - `apps/moderator/src/graph/useCanvasFocusEffect.ts:34–62` — consumes the
    request inside the `<ReactFlowProvider>`, filters to ids ReactFlow
    currently knows (`reactFlow.getNode(id) !== undefined`), and calls
    `fitView`. The "filter to known ids" guard is what makes over-extraction
    (Decision §D3) safe for free.
- **Selection store (precedent for read-by-id styling)**:
  `apps/moderator/src/stores/selectionStore.ts:15–33` — `useSelectionStore`;
  node/edge components subscribe and paint `ring-4 ring-sky-500` +
  `data-selected` when their id matches.
- **Node / edge appearance & existing ring/animation vocabulary**:
  `apps/moderator/src/graph/StatementNode.tsx` and `StatementEdge.tsx` — the
  selection ring (`ring-4 ring-sky-500`), the diagnostic halo
  (`ring-4 ring-amber-500/80 ring-offset-2 motion-safe:animate-pulse` for
  blocking, lighter amber for advisory), and the `data-selected` /
  `data-diagnostic-severity` attribute idiom. The flash uses the same ring +
  `motion-safe:` gating vocabulary in a distinct colour.
- **ReactFlow id ↔ payload id mapping** (flash/focus ids must match what
  ReactFlow knows):
  - Node id = `event.payload.node_id` (`GraphCanvasPane.tsx:772`).
  - Edge id = `event.payload.edge_id` (`selectors.ts:824`).
  - A promoted annotation renders as a node with id = `annotation.id`
    (`selectors.ts:1005`); non-promoted annotations are decorations with no
    ReactFlow entity, so a flash id that names one is simply filtered out.
- **Event payload entity-id fields** (`packages/shared-types/src/events.ts`,
  proposal variants in `packages/shared-types/src/events/proposals.ts`):
  - `node-created` → `node_id`.
  - `edge-created` → `edge_id`; endpoints `source_node_id` /
    `source_annotation_id` (XOR) and `target_node_id` / `target_annotation_id`
    (XOR).
  - `annotation-created` → `annotation_id`; target `target_node_id` /
    `target_edge_id` (XOR, nullable pair).
  - `entity-included` / `entity-removed` → `entity_kind` ∈ {node, edge,
    annotation} + `entity_id`.
  - `vote` / `commit` / `meta-disagreement-marked` → **facet arm** carries
    `entity_kind` (+ `entity_id`); **proposal arm** carries only `proposal_id`.
  - `withdraw-agreement` → `entity_kind` (node|edge) + `entity_id`.
  - `proposal` → inner `proposal.kind` discriminates; target fields are
    `node_id` / `parent_node_id` / `new_node_id` (node-ish), `edge_id`
    (edge-ish), and `meta-move` / `annotate` carry `target_kind` + `target_id`.
  - `session-created` / `session-ended` / `participant-joined` /
    `participant-left` / `session-mode-changed` / `snapshot-created` → no
    graph-entity id (flash nothing).
- **E2E seam**: `tests/e2e/moderator-change-history.spec.ts` (the scroller's
  seeded reverse-chronological spec, ~lines 92–129) already seeds the WS store
  via the `window.__aConversaWsStore` backdoor and renders the Operate route
  with the pane mounted. The new flash spec extends this file.
- ADRs: **0004** (ReactFlow on the moderator graph), **0021** (event
  envelope), **0022** (no throwaway verifications), **0006/0008** (Vitest /
  Playwright layering).

## Constraints / requirements

1. **`affectedEntities(event)` is a pure helper** in
   `apps/moderator/src/graph/affectedEntities.ts` — no clock, no RNG, no
   react-i18next, no store access. Same input → same output. It mirrors
   `eventSummary.ts` and stays unit-testable without a render harness.
2. **Total over `EventKind`.** Exhaustive `switch (event.kind)` with a
   `default` arm narrowed to `never` returning the empty result
   `{ nodeIds: [], edgeIds: [] }`, so a future/unknown kind flashes nothing
   rather than throwing (mirrors `eventSummary.ts:162–170`).
3. **Single-event payload only — no cross-event resolution in v1.** The helper
   reads ids out of the event's own payload (same boundary
   `mod_history_event_summary` set in its Decision §D4). It does not walk the
   log to resolve a `proposal_id` back to the entity a proposal targets; the
   proposal arm extracts the entity ids carried *in the proposal payload
   itself*.
4. **Return shape is two flat string-id lists**: `AffectedEntities = { readonly
   nodeIds: readonly string[]; readonly edgeIds: readonly string[] }`.
   Node-ish ids (node ids, annotation ids — both ReactFlow node ids when the
   entity is on the canvas) go in `nodeIds`; edge ids go in `edgeIds`. This is
   exactly the split `requestCanvasFocus` consumes.
5. **Classification need not be perfect — over-extraction is safe.** Both
   consumers filter to ids ReactFlow currently knows
   (`useCanvasFocusEffect` already does; the flash effect does the same), so an
   id that names a not-yet-created or non-promoted entity is a harmless no-op.
   The helper may extract liberally; it must not *crash* on any well-formed
   event.
6. **`affected` is computed onto the row, not at click time.** Add
   `affected: AffectedEntities` to `ChangeHistoryRow`
   (`changeHistory.ts:38–69`) and populate it in `mergeAndOrderEventLog`
   (`changeHistory.ts:82–109`), the same one-line-per-event addition pattern
   `summary` used. This keeps the pane store-free and the click handler
   synchronous, and pins the mapping under the existing `changeHistory.test.ts`.
7. **The flash channel is a new transient store + a one-line auto-clear
   effect**, modelled on the canvas-focus channel:
   - `apps/moderator/src/stores/flashStore.ts` — `useFlashStore` with
     `flashingIds: ReadonlySet<string>`, a monotonic `flashNonce`, a
     `flash(ids)` action (`flashingIds = new Set(ids)`, `flashNonce += 1`), and
     `clear()` (empties `flashingIds`). In-memory, transient, like
     `focusRequest`.
   - `apps/moderator/src/graph/useFlashAutoClear.ts` — mounted once inside the
     `<ReactFlowProvider>` alongside `useCanvasFocusEffect`. Watches
     `flashNonce`; on advance, schedules a single `setTimeout(clear,
     FLASH_DURATION_MS)`; cancels/replaces the timer on the next nonce and on
     unmount. The clock lives only here, ref-guarded by nonce exactly like
     `useCanvasFocusEffect`'s `lastHandledNonce`.
8. **Node/edge components read the flash store by id**, mirroring the selection
   read: `const flashing = useFlashStore((s) => s.flashingIds.has(id))`. When
   `flashing`, the component stamps `data-flashing="true"` and composes a flash
   ring onto its existing class stack. The ring is **distinct from selection
   (sky) and diagnostic (amber)** — a fuchsia/violet pulse, e.g.
   `ring-4 ring-fuchsia-500 ring-offset-2 motion-safe:animate-pulse` — and is
   `motion-safe:`-gated so `prefers-reduced-motion` users get a static ring,
   not a pulse (the existing diagnostic-halo accessibility idiom). Exact colour
   / radius / duration are **tunable, not contract** (a `mod_vr_*` sibling pins
   pixels; this task pins behaviour).
9. **The row gains an accessible activation affordance.** Wrap the row's
   columns in a `<button type="button">` filling the row (or make the row
   surface a button) with an `aria-label` describing the jump action; Enter /
   Space activation comes free with button semantics, plus a
   `focus-visible:` ring. The existing `data-event-id` / `data-event-kind` /
   `data-sequence` attributes stay on the `<li>` — the row contract is
   unchanged for the parallel sibling `mod_history_event_summary` and the
   future `mod_history_filtering`.
10. **Activation dispatches both channels** from the click handler, reading the
    row's precomputed `affected`:
    `useUiStore.getState().requestCanvasFocus({ nodeIds, edgeIds })` (re-frame)
    **and** `useFlashStore.getState().flash([...nodeIds, ...edgeIds])` (flash).
    A row whose `affected` is empty (session/participant/mode/snapshot kinds)
    stays clickable but dispatches empty sets — a harmless no-op, no special
    casing.
11. **No persistence, no multi-flash accumulation.** Each activation replaces
    the flashing set (a fresh click flashes only the new row's entities); the
    auto-clear timer resets on each new nonce.

## Acceptance criteria

Per **ADR 0022**, every check below ships as a committed automated test — no
throwaway verification.

**Vitest — pure helper (`apps/moderator/src/graph/affectedEntities.test.ts`, new):**

1. Total over `EventKind`: a representative event of every kind is accepted and
   returns an `AffectedEntities`; no kind throws.
2. `node-created` → `nodeIds = [node_id]`, `edgeIds = []`.
3. `edge-created` → `edgeIds = [edge_id]`; node endpoints land in `nodeIds`;
   annotation endpoints land in `nodeIds` (promoted-annotation ids are
   ReactFlow node ids); the XOR endpoints are read correctly.
4. `annotation-created` → host `target_node_id` in `nodeIds` **or**
   `target_edge_id` in `edgeIds`; `annotation_id` included as a node-ish id.
5. `entity-included` / `entity-removed` classify `entity_id` by `entity_kind`
   (node/annotation → `nodeIds`, edge → `edgeIds`).
6. Facet-arm `vote` / `commit` / `meta-disagreement-marked` /
   `withdraw-agreement` extract `entity_id` by `entity_kind`; the
   **proposal-arm** `vote` / `commit` / `meta-disagreement-marked` return empty
   (only a `proposal_id`, no graph entity, no cross-event resolution — §3).
7. Representative `proposal` sub-kinds extract their in-payload target ids:
   e.g. `classify-node` / `axiom-mark` / `amend-node` → `node_id` in `nodeIds`;
   `break-edge` / `set-edge-substance` → `edge_id` in `edgeIds`; `meta-move` /
   `annotate` classify `target_id` by `target_kind`; `decompose` /
   `interpretive-split` include `parent_node_id`.
8. Session/participant/mode/snapshot kinds (`session-created`,
   `session-ended`, `participant-joined`, `participant-left`,
   `session-mode-changed`, `snapshot-created`) → empty `{ nodeIds: [], edgeIds:
   [] }`.

**Vitest — row view-model (`apps/moderator/src/graph/changeHistory.test.ts`,
extended):**

9. `mergeAndOrderEventLog` populates `row.affected` from `affectedEntities(event)`
   for each row (one case asserting a node-created row and an edge-created row
   carry the right ids).

**Vitest — flash store (`apps/moderator/src/stores/flashStore.test.ts`, new):**

10. `flash(ids)` sets `flashingIds` to exactly those ids and advances
    `flashNonce` by 1; `flash` again replaces the set (no accumulation);
    `clear()` empties `flashingIds`.

**Vitest — auto-clear effect (`apps/moderator/src/graph/useFlashAutoClear.test.tsx`
or `.test.ts`, new; fake timers):**

11. After `flash(ids)`, advancing the clock by `FLASH_DURATION_MS` clears
    `flashingIds`; a second `flash` before expiry resets the timer (the set
    survives until the *new* duration elapses); unmount cancels a pending
    timer.

**Vitest — pane interaction (`apps/moderator/src/layout/ChangeHistoryPane.test.tsx`,
extended):**

12. The row exposes an accessible button (role/`aria-label`); a mouse click
    **and** a keyboard Enter/Space both invoke activation.
13. Activating a row calls `requestCanvasFocus` and `flash` with that row's
    `affected.nodeIds` / `affected.edgeIds` (assert via spies/store reads); a
    row with empty `affected` activates without error and dispatches empty
    sets.

**Vitest — node/edge styling (`StatementNode.test.tsx` /
`StatementEdge.test.tsx`, extended):**

14. When the component's id ∈ `flashingIds`, it renders `data-flashing="true"`
    and the flash ring class; when not, neither is present. The pulse class is
    `motion-safe:`-gated (asserted by class inspection, matching the existing
    diagnostic-halo test idiom).

**Playwright — e2e (`tests/e2e/moderator-change-history.spec.ts`, extended) —
IN SCOPE, not deferred:**

15. The change-history pane and graph canvas are both route-rendered today
    (the scroller landed the pane on the Operate route and the canvas is
    mounted), so this behaviour is **reachable** and the e2e is in scope per
    the UI-stream e2e policy. Seed (via `window.__aConversaWsStore`) a
    `node-created` (and an `edge-created`) event; render Operate; click the
    change-history row for the created node; assert the matching ReactFlow node
    gets `data-flashing="true"` (and, optionally, that the viewport re-frames).
    Single locale (en-US) — the affordance is non-textual, so no cross-locale
    assertion is needed here.

**Build / test gate:** `make` build + lint + test green before commit (global
rule; doc-only exception does not apply — this task ships source).

**Deferred:** none. The feature is reachable and fully covered inline; no
follow-up WBS task is registered by this refinement.

## Decisions

**§D1 — Flash and re-frame are two channels, both fired by one click; flash is
a new store, not an overload of the focus channel.**
Re-framing the viewport (`fitView`) and changing entity *appearance* are
structurally different jobs: the focus consumer (`useCanvasFocusEffect`) holds
a `ReactFlowInstance` and pans the camera; it has no path to a node's render.
Entity appearance is driven the way selection already is — node/edge components
subscribe to a store by id and self-style. So the click dispatches
`requestCanvasFocus` (reused verbatim) **and** `flash` (new store). *Alternative
rejected — make `useCanvasFocusEffect` also stamp flashing:* it would need to
reach into the node render path it can't see, and it would conflate "where the
camera looks" with "what pulses," breaking the clean single-responsibility
split the focus refinement (`mod_diagnostic_focus_action`) deliberately drew.
*Alternative rejected — flash only, no re-frame:* an off-screen flash is
invisible; pairing with the free, already-tested focus channel is what makes
the affordance actually find the entity.

**§D2 — `affected` is precomputed onto `ChangeHistoryRow`, not resolved at
click time.**
This copies exactly what `mod_history_event_summary` did with `summary`: one
line in `mergeAndOrderEventLog`, a flat field on the row. It keeps the pane
free of any store read for its data, makes the click handler a synchronous
two-line dispatch, and pins the event→ids mapping under the existing
`changeHistory.test.ts` merge tests. *Alternative rejected — look the raw event
up from the WS store inside the click handler:* it pushes store-coupling and
async-ish lookup into the view, and duplicates the merge the pane already has.

**§D3 — Extract ids liberally from the single event payload; rely on the
consumers' "filter to known ReactFlow ids" guard for correctness.**
`useCanvasFocusEffect` already drops ids ReactFlow doesn't know
(`getNode(id) !== undefined`, `useCanvasFocusEffect.ts:50–53`), and the flash
effect does the same. That property means the helper need not distinguish
"target that exists now" from "client-minted id that won't exist until commit"
(proposal `new_node_id`, decompose components, interpretive-split readings) —
extracting them is a free no-op until they materialise. This is what keeps the
proposal arm cheap and total within the 1d budget, and is why classification
imperfections degrade gracefully (Constraint §5) rather than erroring. *Why not
resolve proposal targets through the log* (so a proposal-arm `vote` flashes the
voted entity): that is cross-event resolution, explicitly out of scope for v1
per the boundary `mod_history_event_summary` set (§D4 there); the in-payload
ids are the v1 contract.

**§D4 — Flash colour/animation is a distinct, `motion-safe:`-gated ring;
exact values are tunable, not contract.**
Selection owns sky, diagnostics own amber, so flash takes a third hue
(fuchsia/violet) to avoid ambiguity when rings stack. It reuses the existing
diagnostic-halo accessibility idiom (`motion-safe:animate-pulse` so
reduced-motion users get a static ring), so no new a11y mechanism is invented.
Pixel-exact appearance is left to a `mod_vr_*` visual-regression sibling if one
is scoped — per the UI-stream policy, visual-regression captures appearance and
**does not** substitute for the Playwright behaviour spec (§15), which is what
this task lands.

**§D5 — The row's interactive surface is a real `<button>`, keeping the
`<li>` data-contract intact.**
A button gives keyboard activation, focus-visible styling, and screen-reader
semantics for free, and leaves the `data-event-id` / `-kind` / `-sequence`
attributes the parallel sibling and future filtering task depend on untouched
on the `<li>`. *Alternative rejected — `onClick` + `role="button"` +
`tabIndex` + manual `onKeyDown` on the `<li>`:* re-implements button semantics
by hand and is the well-known a11y footgun the button element exists to avoid.

**§D6 — No new ADR.**
The flash channel introduces no new dependency and no new architectural seam
*class*: it is another zustand slice read by components (selection precedent) plus
a nonce-guarded consumer effect (focus precedent). It composes existing,
ADR-blessed patterns (ADR 0004 ReactFlow, the established store conventions), so
it is documented here under Decisions rather than as a standalone ADR.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Created `apps/moderator/src/graph/affectedEntities.ts` — pure, exhaustive `switch`-over-`EventKind` helper returning `{ nodeIds, edgeIds }`, with `never`-narrowed default (+ `affectedEntities.test.ts`, 20 cases covering totality, all facet/proposal arms, session/participant no-entity kinds).
- Created `apps/moderator/src/stores/flashStore.ts` — transient `useFlashStore` with `flashingIds: ReadonlySet<string>`, monotonic `flashNonce`, `flash(ids)`, and `clear()` (+ `flashStore.test.ts`).
- Created `apps/moderator/src/graph/useFlashAutoClear.ts` — nonce-guarded `setTimeout` effect that self-clears `flashingIds` after `FLASH_DURATION_MS`; cancels/replaces on new nonce and on unmount (+ `useFlashAutoClear.test.ts`, fake timers).
- Extended `apps/moderator/src/graph/changeHistory.ts` — `affected: AffectedEntities` field added to `ChangeHistoryRow`; populated in `mergeAndOrderEventLog` (+ `changeHistory.test.ts`).
- Extended `apps/moderator/src/layout/ChangeHistoryPane.tsx` — row columns wrapped in accessible `<button type="button">` with `aria-label` from kind+summary; click handler dispatches `requestCanvasFocus` + `flash` from precomputed `row.affected` (+ `ChangeHistoryPane.test.tsx`).
- Extended `apps/moderator/src/graph/StatementNode.tsx` and `StatementEdge.tsx` — read flash store by id; stamp `data-flashing="true"` and fuchsia `motion-safe:animate-pulse` ring when flashing (+ both `.test.tsx`).
- Extended `apps/moderator/src/graph/GraphCanvasPane.tsx` — mount `useFlashAutoClear` alongside `useCanvasFocusEffect`.
- Extended `apps/moderator/src/stores/index.ts` — export `useFlashStore`.
- Extended `tests/e2e/moderator-change-history.spec.ts` — Playwright spec: seed node+edge events, click row, assert `data-flashing="true"` on the graph node.
</content>
</invoke>
