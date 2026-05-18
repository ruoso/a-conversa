# Canvas-side per-other-voter dot row on the participant's read-mostly graph

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_other_vote_indicators_canvas_dots`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_other_vote_indicators` (settled — commit `3ad24b9`. Shipped (a) the `apps/participant/src/graph/otherVotes.ts` projection emitting `OthersVoteIndex = { nodes: Map<string, OtherVote[]>; edges: Map<string, OtherVote[]> }` keyed by entity id, with first-vote-arrival sort order and per-`(entity, voter)` dispute-wins rollup; (b) an 8th argument on `projectGraph` that stamps a symmetric `otherVotes: readonly OtherVote[]` field on both `ParticipantNodeData` and `ParticipantEdgeData`; (c) the localized `elements` memo in `<GraphView>` carries `otherVotes` through onto each Cytoscape element `data` record as inert data (the `...node.data` / `...edge.data` spreads in [`GraphView.tsx:840-865`](../../../apps/participant/src/graph/GraphView.tsx#L840) — explicitly intended as the seam THIS leaf reads from); (d) a nested `<ul data-other-votes>` child on both `<li>` row kinds in the existing DOM mirror tree carrying one `<li data-voter-id data-vote>` per other voter (the v0 DOM-mirror-only surface per Decision §3 of the predecessor). The 7th Playwright `test()` block (alice+ben role-swap) pins the data-layer contract end-to-end.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_own_vote_indicators` (settled — established the `text-outline-*` stylesheet family on labels for the OWN vote signal. This leaf reads no own-vote data; the placement chosen here (below-center of the node bounding box for nodes; edge midpoint for edges) does not collide with the own-vote label outline because the own-vote signal is painted on the in-canvas label text by Cytoscape itself, while this leaf paints a DOM overlay anchored OUTSIDE the node bounding box).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_diagnostic_highlights` (settled — established the override-vs-compose stylesheet semantics. This leaf paints OUTSIDE the Cytoscape canvas entirely — a sibling DOM overlay — so there is no stylesheet collision with diagnostic borders, axiom-mark double-borders, annotation overlays, per-status borders, OR the own-vote label outline. The dot row is a strictly additive at-a-glance layer painted in screen-coordinate space).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_per_facet_state_styling` (settled — established the `<ul data-testid="participant-graph-status-mirror" aria-hidden="true" className="sr-only">` DOM mirror seam this leaf does NOT extend with new attributes; the per-voter data is already on the mirror from the predecessor, and the canvas overlay is a SECOND DOM surface — visible, not aria-hidden — sibling to both the Cytoscape mount AND the existing mirror).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_graph_render` (settled — established `<GraphView>` + `cytoscapeTestEnv` infrastructure. The Cytoscape `Core` instance lives in `cyInstanceRef` ([`GraphView.tsx:675`](../../../apps/participant/src/graph/GraphView.tsx#L675)); the test stub at [`apps/participant/src/graph/cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) shims `HTMLCanvasElement.prototype.getContext('2d')` + `ResizeObserver` for happy-dom. Decision §6 walks the small extensions this leaf adds to the stub so the overlay's position-event subscriptions can fire under Vitest).

## What this task is

Extend the participant's read-mostly `<GraphView>` with the at-a-glance VISUAL per-other-voter dot row on the Cytoscape canvas — the v1 polish layer deferred from `part_other_vote_indicators` Decision §3. Before this leaf the per-voter attribution data is stamped on every emitted Cytoscape element (`data.otherVotes: readonly OtherVote[]`) AND surfaced on the DOM mirror as a nested `<ul data-other-votes>` child, but the canvas itself shows nothing — the at-a-glance "X agrees, Y disputes" signal is only readable via the aria-hidden test mirror. After this leaf the debater sees a small dot row painted alongside every node and edge that has at least one other-participant vote, with the dot colour encoding the per-voter arm.

Concretely the deliverable is:

- A new `apps/participant/src/graph/OtherVotesOverlay.tsx` — a React component that mounts as a sibling of the Cytoscape canvas mount, reads the live Cytoscape `Core` handle, subscribes to the per-element position / pan / zoom events, and renders one absolutely-positioned `<div data-canvas-vote-dots data-element-id="<node-or-edge-id>">` per element that has a non-empty `data.otherVotes` array. Each container holds one `<span data-canvas-vote-dot data-voter-id="<uuid>" data-vote="agree|dispute">` per voter, painted in encounter order — same first-vote-arrival sort order the DOM mirror surfaces, so the dot order matches the mirror order for testability consistency. The overlay is `pointer-events: none` so clicks pass through to Cytoscape; it is NOT `aria-hidden` because the visual signal is user-facing (the DOM mirror remains the test seam; the overlay is the at-a-glance VISUAL).
- A small extension to [`GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx)'s return JSX — the existing `<>` fragment grows a third sibling: `<OtherVotesOverlay cy={cyInstanceRef.current} containerRef={containerRef} />` rendered alongside the canvas mount `<div>` AND the existing DOM-mirror `<ul>`. The overlay is unconditional (it renders an empty wrapper when the cy ref is null or there are no other-votes anywhere); the "nothing to paint" branch short-circuits at render time before any DOM nodes land (Decision §6 — early-exit for the "empty other-votes" case to keep the no-other-vote case as cheap as the pre-leaf path).
- An extension to [`cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) — the noop ResizeObserver shim already exists; this leaf adds a small `requestAnimationFrame` polyfill (happy-dom does not ship one) so the overlay's rAF-batched re-render flow runs under Vitest. The polyfill calls the callback synchronously via `queueMicrotask` (test-environment-only — no behavioural change in production where the real rAF runs).
- Tests pin: Vitest at the helper layer (the rAF-batching microtask + the position-read helper that calls into `cy.getElementById(id).renderedPosition()` / `.renderedBoundingBox()` / `.midpoint()`), at the component layer (`<OtherVotesOverlay>` mounted with a seeded cy handle renders one container per element with non-empty `otherVotes`, the right number of dots inside each container, the right per-voter `data-voter-id` + `data-vote`, the right per-element `data-element-id`, the `pointer-events: none` style on the overlay root, an early-exit empty render when no element has other-votes), and at the `<GraphView>` integration layer (the overlay is mounted as a sibling of the canvas, the cy ref is threaded correctly, an `otherVotes` mutation propagates to the overlay through the re-render). Playwright at the e2e layer extends `tests/e2e/participant-graph-render.spec.ts` with an 8th `test()` block reusing the `dave + maria` role-swap pair (the inverse of block 2's `maria + dave`; Decision §7 of the predecessor exhausted the 12-user pool and pioneered the role-swap pattern, which the 7th block adopted; this leaf adopts the same option for one more block). Asserts the canvas overlay surfaces the expected `<span data-canvas-vote-dot>` count + per-voter attributes for the seeded synthetic voters; the per-voter DOM probe is selectable via the documented attribute names without needing position arithmetic in the assertion.

Out of scope (deferred to existing or future leaves):

- **Per-voter hover tooltip showing the voter's display name.** The dot row carries `data-voter-id` (UUID) but does NOT render the per-voter display name — the at-a-glance signal is "how many others, which way?", not "who specifically?". The per-voter name read goes through `useWsStore.sessionState[id].participants` which the entity-detail-panel can host. Decision §4 walks through the rationale.
- **Click-to-detail on a dot.** Dots are `pointer-events: none` so clicks pass to Cytoscape; per-voter detail surfaces in the future `part_entity_detail_panel` (tap the node, see its full per-voter table).
- **Animation on a new dot arriving** (e.g. a small fade-in when a new voter's dot is added). Static rendering only for v1; a future polish leaf can add CSS transitions if the static signal proves insufficient.
- **Cap on the number of dots displayed.** Decision §5 settles on "render every voter, no cap"; a future polish leaf can revisit if real-world sessions show >10 voters per entity making the row visually unmanageable.
- **Off-viewport culling** (don't paint dots for elements outside the visible viewport). v1 paints every element with non-empty `otherVotes`, regardless of viewport position; if the dot count grows large enough to burn frames, a future polish leaf can add a `renderedBoundingBox()`-clipped filter. Decision §6 documents the perf budget.
- **Visual regression** on the rendered dot row. Pixel comparisons are deferred per the pattern every prior visual-layer leaf adopted; the DOM-attribute assertions are the load-bearing test contract.
- **`<OtherVoteIndicator>` React component port from the moderator.** The moderator's per-voter dot uses `axiomMarkColorFor(participantId)` for the per-participant outer ring. This leaf's overlay surfaces a smaller-surface vocabulary (just the per-voter arm color: emerald-500 / rose-500 — same per-arm palette `part_own_vote_indicators` adopted); a future leaf may port the moderator's per-participant ring color if cross-surface visual identity becomes load-bearing.
- **Symmetric extension to the moderator's `<GraphCanvasPane>`** of the same overlay component. The moderator uses ReactFlow + a different per-node React tree; the moderator-side per-other-voter dot row is owned by `mod_vote_indicators_on_graph` (settled) and surfaces via the moderator's own `<VoteIndicator>` component inside `<StatementNode>`. No cross-surface refactor here.

## Why it needs to be done

`m_participant_mvp` ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a debater can see and engage with the live graph from their tablet. `part_other_vote_indicators` lit up the per-voter data pipeline (projection → projector → DOM mirror) but explicitly deferred the at-a-glance VISUAL on the canvas to this leaf (Decision §3 of the predecessor). The methodology assumes the debater sees not just their own vote (the `text-outline-*` ring from `part_own_vote_indicators`) but ALSO sees who among the other debaters has weighed in on which facet and how — that's the basis of the agreement loop the format depends on:

- [`docs/methodology.md`](../../../docs/methodology.md) — the format's per-facet voting flow is a multi-participant dynamic; "do the others agree?" is a question the debater asks before deciding whether to amend, withdraw, or push for commit. The DOM-mirror surface from the predecessor leaf carries the data but only an assistive technology can read it; the at-a-glance visual signal is what the debater's eye scans during the live debate.
- The moderator already has a per-other-voter dot row on its surface (settled via `mod_vote_indicators_on_graph` + `mod_vote_indicators_in_sidebar`); the cross-surface vocabulary symmetry assumes the debater sees the SAME per-voter attribution the moderator does. Without this leaf, the debater's surface is missing half of the moderator's vote-attribution information visually, even though the data is locally available.
- The deferred-from-predecessor footprint is small (1d effort); the data plumbing is settled; this leaf is a pure visual-rendering task.

Downstream concretely:

- **`part_entity_detail_panel`** (the React-driven tap-to-detail panel) is the natural home for the per-voter display-name lookup + the per-facet vote breakdown. The dot row this leaf paints is the at-a-glance scan; the per-voter detail is the tap-to-detail. The dot row's `data-voter-id` attribute is the join key the detail panel uses to surface the per-voter name + role + per-facet vote table.
- **`audience.aud_graph_render`** (future) will be the third Cytoscape consumer; if it also needs an at-a-glance per-other-voter dot row, the overlay component this leaf ships becomes a natural extraction candidate for `@a-conversa/shell` (the same trigger-on-the-third-caller policy `projectAxiomMarks` / `projectAnnotations` / `projectDiagnosticHighlights` / `projectOwnVotes` / `projectOtherVotes` already follow).
- **`part_pan_zoom_tap`** (future, 1d, depends on `!part_graph_render` — already settled architecturally) will register pan/zoom interactions on the Cytoscape Core handle. The overlay this leaf installs already subscribes to `cy.on('pan zoom render', ...)` for repositioning, so the future pan-zoom-tap leaf composes cleanly: the overlay re-positions in response to any pan/zoom — whether the gesture comes from default Cytoscape interactions or a future tap-to-zoom flow.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape on the participant surface. The library exposes `cy.elements().forEach(ele => ele.renderedPosition())` + `ele.renderedBoundingBox()` + `cy.on('pan zoom render', cb)` + per-element `cy.on('position', 'node', cb)` as the canonical DOM-overlay-positioning vocabulary (the same vocabulary `cytoscape-node-html-label` plugin builds on internally). No new top-level dependency — this leaf consumes the bare library directly per `part_graph_render` Decision §1 (no `react-cytoscapejs` wrapper).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behavioural assertion below is a committed Vitest case or Playwright scenario. Failing-first verification per the predecessor leaves' pattern.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation()` is the participant surface's localization seam. This leaf adds NO new user-facing strings; the at-a-glance visual is colour-encoded (emerald/rose) + `aria-label` localized via existing `vote.agree` / `vote.dispute` keys IF accessibility-of-the-overlay becomes a need (Decision §4 ships without aria labels since the dot row is decorative — the DOM mirror is the load-bearing aria seam).
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region only; the overlay lives entirely in the participant workspace.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the dot row paints per-entity (not per-facet) per the predecessor's per-entity rollup; this leaf inherits that rollup posture (per-`(entity, voter)` dispute-wins consolidation already done by `projectOtherVotes`).

No new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side / participant-side decision.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_other_vote_indicators.md`](part_other_vote_indicators.md) — the direct source of debt. Decision §3 deferred this leaf; the projection + projector + DOM-mirror chain are settled there. This leaf reads the SAME `data.otherVotes: readonly OtherVote[]` field already stamped on every Cytoscape element record (the `...node.data` / `...edge.data` spreads at [`GraphView.tsx:840-865`](../../../apps/participant/src/graph/GraphView.tsx#L840) carry the field through onto the localized Cytoscape data record; this leaf reads it back via `cy.elements().forEach(ele => ele.data('otherVotes'))`).
- [`tasks/refinements/participant-ui/part_own_vote_indicators.md`](part_own_vote_indicators.md) — established the own-vote canvas signal via the `text-outline-*` Cytoscape stylesheet primitive painted on the label text inside the node bounding box. The own-vote signal is INSIDE the node; the other-vote dot row this leaf paints is OUTSIDE the node bounding box (below-center) so the two never collide. The per-arm colour palette (`#10b981` emerald-500 for agree, `#e11d48` rose-600 for dispute) is shared verbatim across the two surfaces; an own-vote'd disputed node and an other-voter'd disputed dot read in the same hue family.
- [`tasks/refinements/participant-ui/part_diagnostic_highlights.md`](part_diagnostic_highlights.md) — established the override-vs-compose stylesheet semantics. This leaf paints OUTSIDE the canvas entirely so no Cytoscape stylesheet composition applies.
- [`tasks/refinements/participant-ui/part_per_facet_state_styling.md`](part_per_facet_state_styling.md) — established the DOM-mirror infrastructure + the `aria-hidden="true" className="sr-only"` test-seam posture. This leaf does NOT extend the existing mirror; the canvas overlay is a SEPARATE, USER-VISIBLE DOM surface sibling to both the canvas mount AND the mirror.
- [`tasks/refinements/participant-ui/part_graph_render.md`](part_graph_render.md) — the predecessor that installed the Cytoscape mount + `cyInstanceRef` + the `cytoscapeTestEnv` happy-dom shim. Decision §6 of this leaf walks the minimal extension to the shim for rAF support.
- [`tasks/refinements/moderator-ui/mod_vote_indicators_on_graph.md`](../moderator-ui/mod_vote_indicators_on_graph.md) — the canonical reference for per-voter dot rendering on the moderator's ReactFlow surface. The moderator renders the dots INSIDE the React-tree `<StatementNode>`; the participant cannot mirror that approach (Cytoscape paints to `<canvas>`, no React in the node render loop — same constraint that drove Decision §6 of `part_per_facet_state_styling` to settle on the DOM mirror seam). This leaf's React DOM overlay positioned via `cy.elements().renderedPosition()` is the Cytoscape-equivalent of the moderator's React-tree per-node rendering — different mechanism, same observable signal.

### Live code the leaf plugs into

- [`apps/participant/src/graph/GraphView.tsx:675`](../../../apps/participant/src/graph/GraphView.tsx#L675) — `cyInstanceRef`. The Cytoscape `Core` handle is already stored in a ref; this leaf reads the ref into the overlay via either a callback prop (the cleanest seam) or by lifting `cyInstanceRef` into a `useState` so the overlay can subscribe to changes (Decision §2 picks the `useState` approach for React-natural re-rendering when the cy instance becomes available after the one-shot mount effect runs).
- [`apps/participant/src/graph/GraphView.tsx:896-969`](../../../apps/participant/src/graph/GraphView.tsx#L896) — the return JSX. This leaf inserts ONE new sibling element into the existing `<>` fragment, between the canvas mount `<div>` and the existing DOM-mirror `<ul>`. The overlay renders as `<div data-testid="participant-other-votes-overlay" className="absolute inset-0 pointer-events-none">` (absolute-positioned inside the existing `participant-graph-root` containing block — see Decision §3 on the positioning ancestor).
- [`apps/participant/src/graph/GraphView.tsx:840-865`](../../../apps/participant/src/graph/GraphView.tsx#L840) — the localized `elements` memo. NO change needed — the `otherVotes` field is already carried through via `...node.data` / `...edge.data` spreads onto each Cytoscape element data record. This leaf reads the field via `cy.getElementById(id).data('otherVotes')`.
- [`apps/participant/src/graph/cytoscapeTestEnv.ts`](../../../apps/participant/src/graph/cytoscapeTestEnv.ts) — the happy-dom shim. This leaf adds a `requestAnimationFrame` polyfill (Decision §6) so the overlay's rAF-batched re-render flow runs under Vitest. The polyfill is test-only; production runs the real rAF.
- [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) — the `OtherVote` type. This leaf imports `type OtherVote` for the dot-rendering loop type. No projection change.
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — `ParticipantNodeData.otherVotes` + `ParticipantEdgeData.otherVotes`. Already settled by the predecessor; this leaf is a read-only consumer.
- [`tests/e2e/participant-graph-render.spec.ts:1594`](../../../tests/e2e/participant-graph-render.spec.ts#L1594) — the existing 7th `test()` block (alice+ben role-swap). This leaf adds an 8th block following the same role-swap pattern.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts:118-131`](../../../tests/e2e/fixtures/auth.ts#L118) — `DEV_USER_POOL` (12 users). The pool is exhausted as fresh pairs; the 7th block adopted alice+ben role-swap. This leaf's 8th block uses `dave + maria` (the inverse of block 2's `maria + dave`) per Decision §7. The per-block-isolated `freshContext` + `createSession` (each block creates its own session) guarantees no race on session state even when usernames re-appear.
- [`tests/e2e/participant-graph-render.spec.ts:64-101`](../../../tests/e2e/participant-graph-render.spec.ts#L64) — `createSession`, `logoutAndClearAllCookies`, `freshContext` helpers. The 8th `test()` block reuses them verbatim.
- [`playwright.config.ts`](../../../playwright.config.ts) — `chromium-participant-skeleton` already matches `participant-graph-render.spec.ts`. No config change needed. The new block runs in parallel under `fullyParallel`.

### What the surface MUST NOT do

- **No re-derivation of `otherVotes` from the events log.** The data is already on each Cytoscape element record via the predecessor's projector; the overlay reads it via `ele.data('otherVotes')`.
- **No `fetch('/api/...')` from the overlay.** Read-only consumer of `cy.elements()` and the per-element `data('otherVotes')`.
- **No mutation of the `useWsStore` from the overlay.** Read-only via the Cytoscape ref (which itself is fed by the existing memo chain reading the store).
- **No new top-level dependency.** No `cytoscape-node-html-label`, no `react-cytoscapejs`, no positioning library. The overlay is plain React + absolute positioning + per-element coordinate reads from Cytoscape's built-in API.
- **No new Cytoscape stylesheet selectors.** The visual is painted in DOM, not in the canvas; the stylesheet is unchanged.
- **No new i18n keys.** Per-arm colour is the visual signal; the existing `vote.agree` / `vote.dispute` keys remain unconsumed by this leaf (the dot row is decorative — the DOM mirror is the aria seam).
- **No interception of pointer events.** The overlay carries `pointer-events: none` so clicks pass through to Cytoscape; the moderator's pan/zoom + future tap-to-detail flows are unaffected.
- **No removal or modification of the existing DOM mirror.** The mirror stays as-is per the predecessor — it remains the aria-hidden test seam; the canvas overlay is the user-visible visual.
- **No change to `projectGraph`'s output ordering or shape.** This leaf is purely a downstream visual consumer.
- **No port of the moderator's `axiomMarkColorFor(participantId)` per-participant ring color** (deferred — see "Out of scope").
- **No off-viewport culling or dot-count cap** (deferred — see "Out of scope"; Decision §5 + §6 explain the perf budget rationale).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/graph/OtherVotesOverlay.tsx` — NEW. The React DOM overlay component. Props: `{ cy: Core | null; containerRef: RefObject<HTMLDivElement | null> }`. Behaviour: (1) early-exit returning `<div data-testid="participant-other-votes-overlay" />` empty when `cy === null` or there is no element with non-empty `otherVotes`; (2) subscribes via a `useEffect` on the `cy` instance to `cy.on('render pan zoom resize', scheduleUpdate)` AND `cy.on('position', 'node', scheduleUpdate)` AND `cy.on('add remove data', scheduleUpdate)`; cleanup detaches all listeners; (3) `scheduleUpdate` calls `requestAnimationFrame(commit)` with a singleton handle (drops re-entrant scheduling within the same frame) per Decision §6; (4) `commit` reads `cy.elements()` and for each element with non-empty `data.otherVotes` writes the per-element rendered position into a `useSyncExternalStore`-backed snapshot; (5) the render reads the snapshot and emits one `<div data-canvas-vote-dots data-element-id="<id>" style={{ position: 'absolute', left: <x>, top: <y>, transform: 'translateX(-50%)' }}>` per element, containing one `<span data-canvas-vote-dot data-voter-id="<uuid>" data-vote="<choice>" className="<emerald|rose>">` per voter (per Decision §3 — below-center for nodes, midpoint for edges); (6) the overlay root is `<div data-testid="participant-other-votes-overlay" className="absolute inset-0 pointer-events-none">` so it overlays the canvas mount WITHIN the existing `participant-graph-root` positioning ancestor (Decision §3 walks the containing-block setup).
- `apps/participant/src/graph/OtherVotesOverlay.test.tsx` — NEW. Vitest cases (9): (a) the overlay renders empty when `cy === null`; (b) the overlay renders empty when no element has non-empty `otherVotes`; (c) the overlay renders one `<div data-canvas-vote-dots>` per node with non-empty `otherVotes`; (d) the overlay renders one `<div data-canvas-vote-dots>` per edge with non-empty `otherVotes`; (e) each per-element container holds the right number of `<span data-canvas-vote-dot>`s with the right `data-voter-id` + `data-vote` per voter, in first-vote-arrival order; (f) the overlay root carries `pointer-events: none` (style or class assertion); (g) a position event triggers a single rAF-batched re-render, not one per event (assertion via a mock rAF spy: multiple `cy.emit('pan')` within one frame produce one call to `commit`); (h) cleanup detaches the listeners on unmount (`cy.removeListener` invocations match the `cy.on` invocations); (i) per-element `data-element-id` matches the node/edge id Cytoscape uses (sanity check for the join key the future entity-detail-panel will consume).
- `apps/participant/src/graph/GraphView.tsx` — modified. (1) Import `OtherVotesOverlay` from `./OtherVotesOverlay`. (2) Lift `cyInstanceRef` into a `useState<Core | null>(null)` per Decision §2 so the overlay re-renders when the cy instance becomes available after the one-shot mount effect runs (the one-shot mount effect now calls `setCyInstance(cy)` + `cyRef?.(cy)` together; the cleanup calls `setCyInstance(null)` + `cyRef?.(null)`). (3) The return fragment grows one new sibling: `<OtherVotesOverlay cy={cyInstance} containerRef={containerRef} />` rendered AFTER the canvas mount `<div>` and BEFORE the existing DOM-mirror `<ul>` (rendering after the canvas mount means the overlay paints visually ABOVE the canvas in the natural DOM stacking; the absolute-positioning + pointer-events-none from Decision §3 keep it visually correct without breaking clicks). (4) The existing `participant-graph-root` `<div>` grows `className="relative h-full w-full"` (was `"h-full w-full"`) so the absolute-positioned overlay's containing block is the graph root, NOT the page body (Decision §3 walks the CSS positioning chain). (5) The module-header refinement comment grows one more entry citing THIS leaf.
- `apps/participant/src/graph/GraphView.test.tsx` — modified. Existing cases stay (the new sibling element is additive and tests target specific `data-testid`s, not exhaustive children lists). 4 new cases added: (a) the overlay is mounted as a sibling of the canvas mount inside `participant-graph-root` (`getByTestId('participant-other-votes-overlay')` returns an element after mount); (b) the overlay receives the `cy` instance once the mount effect has run (assert via a small handle the overlay sets on `window.__test_overlayCy` in test env, OR via a more direct mock-`OtherVotesOverlay` substitution that records its received `cy` prop); (c) when `otherVotes` is non-empty on a seeded node, the overlay surfaces a `<div data-canvas-vote-dots data-element-id="..."` with the expected dot count; (d) `participant-graph-root` carries `className="relative …"` (positioning ancestor check).
- `apps/participant/src/graph/cytoscapeTestEnv.ts` — modified. Add a `requestAnimationFrame` polyfill: stash the original (typically undefined in happy-dom) at install-time; assign `(globalThis as { requestAnimationFrame?: …}).requestAnimationFrame = (cb) => { queueMicrotask(() => cb(performance.now())); return 0; }` AND `cancelAnimationFrame = () => undefined` if the originals are undefined. Restore at `restore()`-time. Symmetric handle layout to the existing `originalResizeObserver` / `originalGetContext` slots. Per Decision §6 — production runs the real rAF; tests run synchronous microtasks so assertions can observe the post-rAF state without `await`-ing real timers.
- `tests/e2e/participant-graph-render.spec.ts` — modified. Adds an 8th `test()` block: `dave creates a session, maria claims debater-A, seeded WS events + synthetic-UUID other-voter votes surface as canvas dot row entries`. Reuses block 2's helpers verbatim; seeds the lobby chain identically with the inverse role pairing; seeds two `node-created` + one `edge-created` + three `proposal`s (one per voteable target) + two synthetic-UUID `vote` events on one node (X agree, Y dispute) + one synthetic-UUID `vote` on the edge (X dispute); `page.goto('/p/sessions/${sessionId}')`; asserts that for the targeted node id the overlay contains one `<div data-canvas-vote-dots data-element-id="<nodeId>">` with TWO `<span data-canvas-vote-dot>` children (one `data-vote="agree" data-voter-id="<X>"` and one `data-vote="dispute" data-voter-id="<Y>"`, in that arrival order); and for the targeted edge id contains one container with ONE dot (`data-vote="dispute" data-voter-id="<X>"`); and that the un-voted node has NO `<div data-canvas-vote-dots data-element-id="<otherNodeId>">` (early-exit on empty `otherVotes`); the DOM-mirror entries (existing assertions from predecessor block 7) carry the SAME per-voter rows the canvas dots show, in the SAME order (sort-order cross-check). Wall-clock for the project grows by zero (parallel under `fullyParallel`).
- `playwright.config.ts` — unchanged.
- `apps/participant/package.json` — unchanged.

### Files this task does NOT touch

- `apps/participant/src/routes/OperateRoute.tsx` — unchanged.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx`, `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/graph/otherVotes.ts`, `projectGraph.ts` — unchanged (the predecessor's projection is the canonical data source).
- `apps/participant/src/graph/facetStatus.ts`, `axiomMarks.ts`, `annotations.ts`, `diagnosticHighlights.ts`, `ownVotes.ts` — unchanged.
- `apps/moderator/`, `apps/server/`, `apps/root/`, `apps/audience/` — unchanged.
- `packages/shell/`, `packages/shared-types/`, `packages/i18n-catalogs/` — unchanged. No new substrate, no new types, no new strings.
- `docs/adr/` — no new ADR. Every decision below applies an existing ADR or mirrors a settled moderator-side / participant-side decision.
- `.tji` files — `complete 100` on `part_other_vote_indicators_canvas_dots` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual.

### Component shape (`apps/participant/src/graph/OtherVotesOverlay.tsx`)

Sketched:

```tsx
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';

import type { OtherVote } from './otherVotes';

export interface OtherVotesOverlayProps {
  readonly cy: Core | null;
  readonly containerRef: RefObject<HTMLDivElement | null>;
}

interface DotPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly votes: readonly OtherVote[];
}

const DOT_AGREE_CLASS = 'inline-block w-2 h-2 rounded-full bg-emerald-500';
const DOT_DISPUTE_CLASS = 'inline-block w-2 h-2 rounded-full bg-rose-500';
const NODE_DOTS_OFFSET_Y = 4; // px below the bounding box

export function OtherVotesOverlay({ cy, containerRef }: OtherVotesOverlayProps): ReactElement {
  const [placements, setPlacements] = useState<readonly DotPlacement[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (cy === null) return undefined;

    const commit = (): void => {
      frameRef.current = null;
      const next: DotPlacement[] = [];
      cy.elements().forEach((ele) => {
        const votes = ele.data('otherVotes') as readonly OtherVote[] | undefined;
        if (votes === undefined || votes.length === 0) return;
        if (ele.isNode()) {
          const node = ele as NodeSingular;
          const bb = node.renderedBoundingBox();
          next.push({
            id: node.id(),
            x: (bb.x1 + bb.x2) / 2,
            y: bb.y2 + NODE_DOTS_OFFSET_Y,
            votes,
          });
        } else if (ele.isEdge()) {
          const edge = ele as EdgeSingular;
          const mid = edge.midpoint();
          // `midpoint()` returns model coords; convert via pan + zoom.
          const pan = cy.pan();
          const zoom = cy.zoom();
          next.push({
            id: edge.id(),
            x: mid.x * zoom + pan.x,
            y: mid.y * zoom + pan.y,
            votes,
          });
        }
      });
      setPlacements(next);
    };

    const scheduleUpdate = (): void => {
      if (frameRef.current !== null) return; // already scheduled this frame
      frameRef.current = requestAnimationFrame(commit);
    };

    // Initial paint (the cy mount may already have elements by this point).
    scheduleUpdate();

    cy.on('render pan zoom resize', scheduleUpdate);
    cy.on('position', 'node', scheduleUpdate);
    cy.on('add remove data', scheduleUpdate);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      cy.off('render pan zoom resize', scheduleUpdate);
      cy.off('position', 'node', scheduleUpdate);
      cy.off('add remove data', scheduleUpdate);
    };
  }, [cy]);

  return (
    <div
      data-testid="participant-other-votes-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      {placements.map((p) => (
        <div
          key={p.id}
          data-canvas-vote-dots
          data-element-id={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}px`,
            top: `${p.y}px`,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '2px',
          }}
        >
          {p.votes.map((v) => (
            <span
              key={v.participantId}
              data-canvas-vote-dot
              data-voter-id={v.participantId}
              data-vote={v.choice}
              className={v.choice === 'agree' ? DOT_AGREE_CLASS : DOT_DISPUTE_CLASS}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

The `containerRef` prop is reserved for the rare positioning-debug branch (e.g. measuring the container's `getBoundingClientRect()` to refine the coordinate transform); the sketch above does not consume it, but the prop stays on the API for the Acceptance criteria to pin and for a future polish leaf to use without re-shaping the seam.

## Acceptance criteria

The check that says "done":

- `apps/participant/src/graph/OtherVotesOverlay.tsx` exists, exports a `OtherVotesOverlay` component matching the sketch above (early-exit when `cy === null` or no element has non-empty `otherVotes`; rAF-batched re-renders subscribed to the documented event set; per-element `<div data-canvas-vote-dots data-element-id="..." …>` with per-voter `<span data-canvas-vote-dot data-voter-id="..." data-vote="...">` children).
- `apps/participant/src/graph/OtherVotesOverlay.test.tsx` covers the 9 Vitest cases listed under Constraints.
- `apps/participant/src/graph/GraphView.tsx`: (a) lifts `cyInstanceRef` into a `useState<Core | null>` so the overlay re-renders when the cy instance becomes available; (b) renders `<OtherVotesOverlay cy={cyInstance} containerRef={containerRef} />` as a sibling of the canvas mount; (c) the canvas mount div now carries `className="relative h-full w-full"` so the absolute-positioned overlay's containing block is the graph root.
- `apps/participant/src/graph/GraphView.test.tsx` covers the 4 new Vitest cases plus the adapted existing cases.
- `apps/participant/src/graph/cytoscapeTestEnv.ts` ships a `requestAnimationFrame` + `cancelAnimationFrame` polyfill that queues callbacks via `queueMicrotask` so Vitest can observe post-rAF state synchronously; the polyfill restores cleanly on `restore()`.
- `tests/e2e/participant-graph-render.spec.ts` adds the 8th `test()` block (`dave + maria` role-swap) per the Constraints sketch. **Per ORCHESTRATOR.md UI-stream e2e policy**: the route IS reachable (settled by `part_graph_render`), the data pipeline IS in place (settled by `part_other_vote_indicators`), the overlay IS in scope — the e2e is in scope, not deferred. The spec asserts via documented `data-*` attributes on the overlay's DOM; position arithmetic is intentionally out of the assertion path (Decision §6 — coordinate values are sensitive to the happy-dom-vs-real-browser layout drift; the per-voter attribute presence + ordering carries the load-bearing signal).
- **Failing-first verification per ADR 0022**: short-circuiting `OtherVotesOverlay` to render an empty `<div data-testid="participant-other-votes-overlay" />` regardless of `cy` / `otherVotes` flips at least 6 of the 9 overlay Vitest cases red AND the new Playwright assertion red; the early-exit cases stay green. Document the verification in the Status block.
- `pnpm run check` clean.
- `pnpm run test:smoke` green; Vitest count rises by the new cases (9 overlay + 4 GraphView = +13).
- `pnpm -F @a-conversa/participant build` succeeds (bundle grows by the small overlay component; no new dependency).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended spec and it passes; chromium-participant-skeleton wall-clock unchanged (the new block runs in parallel).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_other_vote_indicators_canvas_dots` in the same commit (the Closer's ritual).

## Decisions

### §1 — React DOM overlay positioned via `cy.elements().renderedPosition()` / `.renderedBoundingBox()` / `.midpoint()`

Three rendering approaches were named in the registration note (and re-evaluated here):

- **(A) React DOM overlay positioned via Cytoscape's `cy.elements().renderedPosition()` / `renderedBoundingBox()` / `midpoint()`.** Chosen. Clean separation of concerns: Cytoscape owns the canvas paint + the per-element position model; React owns the dot row paint + the per-voter dot mapping. The overlay subscribes to a small set of Cytoscape events and re-positions DOM nodes in screen-coordinate space; the overlay is a sibling of the canvas mount inside the same `participant-graph-root` containing block. Testability: standard React testing libraries assert against the rendered DOM (no canvas-pixel probing needed). Extends the existing `cytoscapeTestEnv` stub with one small rAF polyfill (Decision §6) and otherwise composes with the predecessor leaf's infrastructure.
- **(B) Cytoscape compound nodes / nested elements.** Rejected for the same reasons `part_other_vote_indicators` Decision §3 named: forces Cytoscape's compound-node mechanism (a load-bearing layout change that ripples into `cy.layout({ name: 'cose' })`), complicates the projection (per-voter child nodes interleaved with per-entity parent nodes), breaks the `nodes.length === per-node-created-event count` invariant the existing tests rely on. High implementation cost; high test churn; the compound-node visual is not actually what we want (we want a small dot row alongside the node, not a compound subgraph).
- **(C) Cytoscape `background-image` data URLs.** Rejected: encoding the dot row as a per-node image URL forces an SVG-encoding step on every projection change, which scales poorly as the per-node vote count grows; per-voter probing (`data-voter-id` per dot) is impossible because the image is opaque to the DOM; the cross-surface vocabulary symmetry the moderator's per-voter dot row carries (per-voter UUID + arm assignable to a DOM seam) doesn't translate.

Decision §1: ship (A). The originating note already named (A) as the default approach; the alternatives were vetted at predecessor-leaf time and the rationale carries over.

### §2 — `cyInstanceRef` lifted into `useState` so the overlay sees the cy handle once mounted

Today's `cyInstanceRef` is a plain `useRef<Core | null>(null)` — fine for the existing imperative `cy.json({ elements })` element-sync flow, but React-invisible (mutating the ref doesn't trigger re-renders). The overlay component needs to KNOW when the cy instance becomes available so it can subscribe to events and render its first dot batch. Three options:

- **(a) Lift `cyInstanceRef` into `useState<Core | null>(null)`.** Chosen. The one-shot mount effect now calls `setCyInstance(cy)` + `cyRef?.(cy)` together; cleanup calls `setCyInstance(null)` + `cyRef?.(null)`. The overlay reads `cyInstance` via prop; its `useEffect` re-runs when the instance becomes available. Standard React idiom; predictable re-rendering.
- **(b) Pass a callback ref to the overlay that latches the cy instance internally.** Rejected: forces the overlay to own a piece of state Cytoscape's mount effect knows about FIRST. The `useState` lift puts the source of truth in the canvas mount where it belongs.
- **(c) Use the existing `cyRef` callback prop to pipe the instance from `<GraphView>` consumer-side, then have the overlay receive the instance via a parent-managed state.** Equivalent in effect to (a) but adds a piece of consumer-shaped boilerplate; rejected because the cy instance is internal to `<GraphView>` and doesn't need to escape to the parent for the overlay to work.

Decision §2: (a) — promote the `Core | null` ref to a `useState` slot; the overlay receives it as a prop. The existing optional `cyRef` callback continues to fire alongside `setCyInstance` (no behavioural change for any downstream consumer of `cyRef`).

### §3 — Dot placement: below-center for nodes (`renderedBoundingBox().bottom` + `4px` offset, `translateX(-50%)` centring); midpoint for edges (`edge.midpoint()` transformed via `cy.pan()` + `cy.zoom()`); overlay positioned absolutely inside `participant-graph-root` (which becomes `position: relative`)

Three sub-decisions packed:

**(3a) Per-node placement.** Cytoscape's `renderedBoundingBox()` returns the element's screen-space bounding box in pixels (already accounting for pan + zoom — that's why it's called "rendered" position). The dot row's anchor point is the bounding box's bottom-center: `{ x: (bb.x1 + bb.x2) / 2, y: bb.y2 + 4 }`. The `translateX(-50%)` CSS transform centres the dot row horizontally around the anchor. The `4px` offset keeps the dots out of the node's border / outline (which can be up to 3px wide for axiom-marked + diagnosed nodes per the predecessor stylesheet layers).

Alternatives:
- **Right-of-rightmost-edge placement.** Rejected: the node's right edge can be variable across pan/zoom + the `cose` layout drift; the bottom edge is the most consistent anchor.
- **Inside-the-node-body placement** (e.g. bottom-row inside the node body). Rejected: Cytoscape paints the node body to canvas; the DOM overlay can't paint inside the canvas. The OUTSIDE-the-bounding-box position is the only DOM-accessible placement.
- **Above-the-node placement.** Rejected: own-vote label outline (own-vote's `text-outline-*` paint) is centred on the node — a top-row dot would visually crowd the own-vote signal. Below-center keeps the two visual layers separated.

**(3b) Per-edge placement.** Edges don't have a clean bounding box (the curve geometry varies); Cytoscape's `edge.midpoint()` returns the midpoint in MODEL coordinates (NOT rendered). The transform `(mid.x * zoom + pan.x, mid.y * zoom + pan.y)` converts model → screen, mirroring what `renderedBoundingBox()` does internally for nodes. The dots paint at the edge midpoint; the existing edge `roleLabel` already paints there (via Cytoscape's `label` style + `text-background-*` for the white pill) so the dot row visually composes with the role label without overlapping (the role label is in canvas, the dot row is in DOM ABOVE it; the dot row's offset places it under the label's white-pill background, which gives a subtle clarity boundary).

Alternatives:
- **Near one of the endpoints** (e.g. at the source or target node's edge attachment). Rejected: the per-edge dot row would visually attach to whichever endpoint, biasing the reader's interpretation of "which entity is this vote about?". The midpoint is the unbiased anchor.
- **Stacked on top of the edge label.** Rejected: the role label is already at the midpoint; stacking would clutter the visual.

**(3c) Containing block.** The overlay uses `position: absolute` so each dot row's `left`/`top` is in coordinates relative to the nearest `position: relative` (or `absolute` / `fixed` / `sticky`) ancestor. Today the `participant-graph-root` `<div>` has only `className="h-full w-full"` — no `position` declaration — so the nearest positioned ancestor would be either the page body OR (more likely on most browser default stacks) NONE, which means the overlay would position relative to the initial containing block (the viewport). The fix: add `relative` to the `participant-graph-root` `<div>`'s className so it becomes the positioning ancestor. The overlay's `inset-0` then fills the same rectangle the Cytoscape canvas occupies; per-element coordinates from `renderedBoundingBox()` are already in that rectangle's coordinate space (Cytoscape paints into the same container rectangle), so no further coordinate translation is needed.

Decision §3: ship below-center for nodes (`+4px` offset), edge-midpoint for edges (transformed via pan + zoom), and add `relative` to the `participant-graph-root` className.

### §4 — Per-voter visual: just the per-arm color dot (emerald-500 agree, rose-500 dispute); no per-participant ring color, no per-voter name label, no aria-label

The moderator's per-voter dot vocabulary (`mod_vote_indicators_on_graph` + `mod_vote_indicators_in_sidebar`) uses an outer ring colored by `axiomMarkColorFor(participantId)` — a per-participant chromatic identity. This leaf could port that signal, but three reasons argue against it for v1:

- **The participant tablet's at-a-glance reading distance is smaller than the moderator's.** The dot row sits below a 200x80 px node body; a per-participant outer ring would need to be perceptually distinct from the per-arm inner color at that scale, which forces either larger dots (visual clutter) or hue separation (chromatic complexity). The moderator surface has more pixels per element; the per-participant ring works there.
- **`axiomMarkColorFor` is currently a moderator-workspace helper.** Porting it surfaces the same "duplicate now, extract on the third caller" question the predecessor leaves answered for `projectAxiomMarks` / `projectAnnotations` / `projectDiagnosticHighlights` / `projectOwnVotes` / `projectOtherVotes`. Adding a sixth duplicate without a concrete need is anti-YAGNI.
- **The per-voter UUID is on the DOM seam already** (`data-voter-id` on each dot). The future entity-detail-panel reads the UUID and resolves the per-participant identity from the session's participant list; the at-a-glance canvas surface doesn't need the visual identity to surface the load-bearing signal ("how many others, which way?").

`aria-label` on the dots is also out of scope: the dot row is decorative — the DOM mirror (the predecessor's nested `<ul data-other-votes>`) carries the load-bearing aria seam. A future polish leaf can add per-dot aria labels if the dot row needs to surface to screen readers independently; for now the mirror is the canonical aria surface.

Decision §4: ship per-arm color dot only (emerald-500 agree, rose-500 dispute; same palette as `part_own_vote_indicators` Decision §3); no per-participant ring color; no aria-label. The per-voter UUID is on the DOM seam for future detail-panel consumption.

### §5 — No cap on dot count; render every voter in first-vote-arrival order; the DOM mirror sort order is the canonical seam

The per-entity per-voter list (`OthersVoteIndex`) has no upper bound — every other-participant who has voted is in the list. Two options for handling large lists:

- **(a) Render every voter, no cap.** Chosen. The methodology assumes a small number of debaters per session (typically 2-4); the per-entity list is bounded in practice by the participant count. Even at the largest envisioned scale (say 10 debaters), 10 small dots in a 2px-gap row is ~30px of horizontal real estate — fits under a 200px-wide node bounding box with room to spare. The future entity-detail-panel surfaces per-voter detail; the at-a-glance row is the scan summary.
- **(b) Cap at e.g. 10 dots, render `+N more` indicator.** Rejected: adds branching logic for a case that doesn't exist in practice; the cap-vs-no-cap question is a polish-stage concern.

First-vote-arrival sort order: the predecessor's projection (`projectOtherVotes`, Decision §5 there) maintains first-vote-arrival order and preserves that order across arm-switches (in-place overwrite at the original position). The DOM mirror surfaces that order via the nested `<ul data-other-votes>` children; this leaf's canvas dot row preserves the same order via direct iteration over `data.otherVotes` (which IS the ordered list). Testability cross-check: a per-voter Playwright probe asserts the DOM-mirror order matches the canvas-dot order via parallel `nth-child(n)` queries.

Decision §5: ship (a) — render every voter, no cap; preserve first-vote-arrival order via direct iteration; the predecessor's sort-order contract carries through verbatim.

### §6 — Performance: rAF-batched re-renders subscribed to a small event set; happy-dom rAF polyfill in `cytoscapeTestEnv`; no off-viewport culling for v1

Three sub-decisions packed:

**(6a) Event subscription set.** The overlay subscribes to FOUR Cytoscape event categories:
- `render` — fires whenever Cytoscape re-paints the canvas (the most general signal that something may have moved).
- `pan zoom` — fire when the user pans / zooms (today the participant has no pan/zoom UI gestures because `part_pan_zoom_tap` is deferred, but Cytoscape's default pan/zoom is on per `part_graph_render` Decision §1, and the test environment can emit these events directly).
- `resize` — fires when the viewport size changes (the canvas's `<div>` bounds change).
- `position` (qualified by selector `'node'`) — fires per-element when a node's position changes (e.g. after `cy.layout({ name: 'cose' }).run()` settles).
- `add remove data` — fire on element add / remove / data mutation; the `data` arm is what catches the `otherVotes` field changing on an existing element (when a new vote arrives, the predecessor's projection mints a fresh element-data record via the `cy.json({ elements })` bulk-replace, which fires `add` + `remove` on the swapped elements).

Alternatives considered: subscribing to ALL `cy` events (`cy.on('*', cb)`) is over-broad and burns frames on unrelated mutations; subscribing to NONE and relying on React's render cycle is incorrect because position-only changes don't flow through React.

**(6b) Batching via rAF.** Every subscribed event calls `scheduleUpdate`, which is a singleton-handle wrapper: if a frame is already scheduled, drop the second call. The frame's `commit` is a single pass over `cy.elements()` that reads the per-element position and writes a fresh placement array via `setPlacements`. React's reconciler then commits the DOM updates. At 60fps the worst case is one commit per frame regardless of how many events fired; the per-event delivery cost is just the singleton-handle check.

**(6c) happy-dom rAF polyfill.** happy-dom does not ship `requestAnimationFrame` / `cancelAnimationFrame` by default. The Vitest cases need rAF to run synchronously so the assertions can observe post-rAF state without `await`-ing real timers. The polyfill in `cytoscapeTestEnv.ts` calls the callback via `queueMicrotask` — synchronous-enough for Vitest, doesn't drift the test timing.

**(6d) Off-viewport culling.** The naive `cy.elements().forEach` reads every element's `data('otherVotes')` and positions every element with non-empty votes — INCLUDING elements whose `renderedBoundingBox()` falls outside the visible viewport. For v1, no culling: the per-element work is dominated by the React reconciler's DOM commit, not the read pass; a 50-element session at 60fps is well within budget. If real usage shows the dot count growing large enough to matter, a future polish leaf can add a `cy.extent()`-clipped filter that drops off-viewport elements before stamping.

Decision §6: ship the rAF-batched five-event-set subscription; ship the happy-dom rAF polyfill in the existing `cytoscapeTestEnv`; skip viewport culling for v1.

### §7 — Playwright 8th block: `dave + maria` role-swap (block-2 inverse) per the user-pool exhaustion pattern the 7th block pioneered

The existing `tests/e2e/participant-graph-render.spec.ts` describe has SEVEN `test()` blocks (alice+ben, maria+dave, frank+erin, grace+henry, ivan+julia, kate+leo, alice+ben role-swap). The 12-user pool is exhausted; the 7th block (`part_other_vote_indicators` Decision §7) settled on the role-swap pattern with synthetic-UUID voter seeding for the OTHER-voter signal. This leaf needs another block; the same pattern applies:

- **(a) Role-swap an existing pair.** Chosen: use `dave + maria` (the inverse of block 2's `maria + dave`). The per-block-isolated `createSession` + `freshContext` guarantees no race on session state even though the username pair re-appears; the OIDC dance per `loginAs` is independent per `freshContext`.
- **(b) Expand the dev-user pool again.** Rejected for the same reason `part_other_vote_indicators` Decision §7 rejected it: adds infra cost (Authelia config edit + DEV_USER_POOL constant bump) for ONE block of value.
- **(c) Split into a new spec file.** Rejected: same reason — would duplicate ~80 lines of fixture composition for one block.
- **(d) Reuse the alice+ben role-swap pair from block 7.** Rejected: would mean two blocks in the describe share the same `(creator, debater)` pair, which complicates failure attribution if both blocks fail (which is which?). Different role-swap pair gives each block its own observable identity.

Why `dave + maria` specifically: block 2 (`maria + dave`) used the standard `(creator=maria, debater=dave)` orientation; the inverse `(creator=dave, debater=maria)` is the natural complement. Selecting this pair over (say) `henry + grace` is a coin-flip among equivalents; documenting the choice (block-2 inverse) makes the rationale legible to future readers.

The 8th `test()` block:

1. Sets up `dave` (creator) + `maria` (debater-A) via `freshContext` + `loginAs` + the existing helpers.
2. Sets up the session + lobby chain (mirroring block 7's seed pattern).
3. Navigates `maria` to `/p/sessions/${sessionId}`.
4. Asserts `route-operate` + `participant-graph-root` + `participant-other-votes-overlay` visible.
5. Seeds events via `__aConversaWsStore.getState().applyEvent(...)`:
   - Two `node-created` (NODE_A, NODE_B) + one `edge-created` (EDGE_AB).
   - Three `proposal`s (classify-node P1 on NODE_A, set-edge-substance P2 on EDGE_AB, classify-node P3 on NODE_B).
   - A `vote` of `agree` on P1 by SYNTHETIC_VOTER_X.
   - A `vote` of `dispute` on P1 by SYNTHETIC_VOTER_Y.
   - A `vote` of `dispute` on P2 by SYNTHETIC_VOTER_X.
6. Asserts the overlay surfaces:
   - For NODE_A: one `<div data-canvas-vote-dots data-element-id="<NODE_A>">` with TWO `<span data-canvas-vote-dot>`s (first agree by X, then dispute by Y — first-vote-arrival order).
   - For EDGE_AB: one container with ONE dot (dispute by X).
   - For NODE_B: NO `<div data-canvas-vote-dots data-element-id="<NODE_B>">` (the empty-list early-exit; nothing rendered for the un-voted entity).
7. Cross-checks the dot order matches the predecessor's DOM-mirror nested-list order for the same entities (sort-order pin).

Per the predecessor leaves' pattern: assertions target documented `data-*` attributes, not canvas pixels and not position arithmetic (Decision §6 — coordinate values are sensitive to happy-dom-vs-real-browser layout drift; per-voter attribute presence + ordering carries the load-bearing signal).

### §8 — The DOM mirror seam is unchanged; the canvas overlay is a SECOND DOM surface (visible + decorative; mirror is aria-hidden + load-bearing for tests)

The predecessor's nested `<ul data-other-votes>` mirror remains the testability seam — every per-voter assertion still works against the mirror; this leaf's overlay does NOT replace or duplicate the mirror's data semantics. The two surfaces serve different consumers:

- **DOM mirror** (`<ul data-other-votes>` nested inside `<li data-testid="participant-node-status">` / `<li data-testid="participant-edge-status">`): `aria-hidden="true"` + `sr-only`; carries the per-voter UUID + arm losslessly for unit tests, e2e tests, and assistive-tech consumers. ALREADY EXISTS post-`part_other_vote_indicators`.
- **Canvas overlay** (`<div data-canvas-vote-dots>` with per-voter `<span data-canvas-vote-dot>` children, positioned absolutely above the canvas): user-visible per-arm color dots; `pointer-events: none` so clicks pass to Cytoscape; decorative — the aria signal is on the mirror. NEW HERE.

Two surfaces, one data source (`data.otherVotes` per Cytoscape element). The new e2e block's sort-order cross-check asserts the two surfaces stay in lockstep — if a future bug ever desynchronises them, the cross-check fires.

Decision §8: explicit documentation that the mirror stays as-is; the overlay is additive; the two surfaces are independent renderings of the same per-voter data, deliberately not consolidated (the mirror's `sr-only` + `aria-hidden` posture conflicts with the overlay's user-visible + decorative posture; merging would force one or the other to compromise).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-17.

- Shipped the React DOM overlay approach (Decision §1 option A) as `apps/participant/src/graph/OtherVotesOverlay.tsx` — a sibling of the Cytoscape mount inside `participant-graph-root` (now `position: relative` per Decision §3c) that reads `data.otherVotes` off each Cytoscape element and emits one `<div data-canvas-vote-dots data-element-id=…>` per voted entity, with `<span data-canvas-vote-dot data-voter-id=… data-vote=…>` children per voter. `pointer-events: none` keeps clicks passing through to Cytoscape, and the overlay is intentionally NOT `aria-hidden` (the predecessor's DOM mirror remains the load-bearing aria seam per Decision §8).
- rAF-batched re-renders via a singleton frame handle (Decision §6b) subscribed to the documented Cytoscape event set: `render pan zoom resize` + `cy.on('position', 'node', …)` + `cy.on('add remove data', …)`. Multiple events within one frame collapse to a single `commit` pass.
- Dot placement per Decision §3a/§3b: below-center for nodes (`renderedBoundingBox()` bottom + 4px offset + `translateX(-50%)` centring) and edge-midpoint for edges (`edge.midpoint()` transformed via `cy.pan()` + `cy.zoom()` to screen coords). Per-arm color only (emerald-500 agree / rose-500 dispute) per Decision §4 — no per-participant ring color, no per-voter name label.
- `apps/participant/src/graph/cytoscapeTestEnv.ts` grew a `requestAnimationFrame` / `cancelAnimationFrame` polyfill backed by `queueMicrotask` (Decision §6c). General-purpose: future Cytoscape-adjacent overlays needing rAF under Vitest/happy-dom reuse the polyfill without re-shimming. The polyfill is install/restore-symmetric with the existing `originalResizeObserver` / `originalGetContext` slots.
- `apps/participant/src/graph/GraphView.tsx` lifted `cyInstanceRef` into a `useState<Core | null>(null)` slot per Decision §2 so the overlay re-renders when the cy instance lands after the one-shot mount effect; the existing `cyRef` callback still fires alongside `setCyInstance`.
- 8th Playwright block (`dave + maria` role-swap, block-2 inverse per Decision §7) appended to `tests/e2e/participant-graph-render.spec.ts`. Seeds two synthetic-UUID voters on a node + one on an edge + leaves a third node un-voted; asserts the overlay surfaces the expected per-voter `data-voter-id` / `data-vote` attributes in first-vote-arrival order AND that the canvas-dot ordering matches the predecessor's DOM-mirror ordering (Decision §8 sort-order cross-check). Coordinate values are intentionally NOT in the assertion path (per Decision §6).
- Failing-first verification per ADR 0022: short-circuiting `OtherVotesOverlay` to render an empty wrapper flipped 5 of 9 overlay Vitest cases red (c/d/e/f/i — the actual-render assertions) plus 1 GraphView case (zz3 — the seeded-otherVotes dot count) = 6 total failures, matching the acceptance threshold. The early-exit cases (a/b), the rAF batching / cleanup cases (g/h), and the integration mount-sanity cases (zz1/zz2/zz4) stayed green as expected. Restored; all 64 cases green.
- Test deltas: Vitest 3974 → 3987 (+13: 9 overlay + 4 GraphView). Cucumber unchanged. Playwright 7 → 8 blocks in `participant-graph-render.spec.ts`; `chromium-participant-skeleton` wall-clock 18.0s (no regression vs baseline under `fullyParallel`).
