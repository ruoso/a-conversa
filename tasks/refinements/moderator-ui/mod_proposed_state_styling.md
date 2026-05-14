# Moderator proposed-state styling (dashed border, faded fill for in-flight entities)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**:
- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `StatementNode` + `projectNodes` populate `data` from the WS log).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `StatementEdge` + `selectEdgesForSession` populate edge `data`).
- `moderator_ui.mod_graph_rendering.mod_annotation_rendering` (done — established the per-target enrichment pattern in `projectNodes` and the selector).
- `data_and_methodology.projection.per_facet_status_derivation` (done — defines the `FacetStatus` enum and the server-side `deriveFacetStatus` derivation this task ports to the client).

## What this task is

Visually mark nodes and edges whose substance / classification / wording facet is in the **proposed** state — proposed but not yet agreed by every current participant. Per the methodology, the proposed state is the "in flight" agreement-layer state for a facet: a `proposal` event has landed, some or no participants have voted `agree`, no participant has voted `dispute`, and no commit has landed. The moderator needs to see at a glance which entities on the canvas are still being negotiated, separately from the agreed / disputed / committed ones.

This task lands:

- A client-side facet-status helper (`apps/moderator/src/graph/facetStatus.ts`) that walks the WS event log and derives, per `(entityKind, entityId, facet)` triple, the entity's current `FacetStatus`. Mirrors the rules in `apps/server/src/projection/facet-status.ts`'s `deriveFacetStatus` so the same state machine runs in both places (no server round-trip required for the visual layer). Also exports the client-side `FacetStatus` and `FacetName` types (the server enum is not currently re-exported through `@a-conversa/shared-types`; we mirror them locally and document the parallel).
- An extension to `selectors.ts` and `GraphCanvasPane.tsx`'s `projectNodes` that enriches each emitted `Node` / `Edge` `data` with a `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` map. Only facets that have at least one event affecting them appear in the map — a freshly-created node with no proposals has `facetStatuses: {}` (no styling override).
- An extension to `StatementNode` and `StatementEdge` that reads `data.facetStatuses` and applies the proposed-state Tailwind classes (`border-dashed`, `opacity-60` on the node card; a dashed-stroke `style` on the edge path) when any facet is `'proposed'`. A `data-facet-status="proposed"` attribute is added on the rendered root element as a stable seam for the sibling state-styling tasks (`mod_agreed_state_styling`, `mod_disputed_state_styling`, `mod_per_facet_state_visualization`) to extend.
- Tests covering: the facet-status helper across every transition rule; the projection populating `facetStatuses`; the components applying the right Tailwind / SVG-style for each status across locales.

This task is rendering-only. The vote-capture flow (`mod_capture_flow.mod_propose_action`, `mod_pending_proposals_pane.mod_vote_indicators_in_sidebar`) lands the *creating* of proposals from the UI; here we just show the visual state of what's already in the log. The sibling state-styling tasks (`mod_agreed_state_styling`, `mod_disputed_state_styling`) will add their own class-name branches on the same `facetStatuses` data, and `mod_per_facet_state_visualization` will subdivide a single node into per-facet visual slices once all three baseline states are styled.

## Why it needs to be done

The methodology distinguishes four agreement-layer states for every facet (`proposed | agreed | disputed | meta-disagreement`) and two committed-layer ones (`committed | withdrawn`). Without per-state visual differentiation, the moderator sees a homogeneous slate-bordered card for every node regardless of whether the substance has been agreed, is disputed, or hasn't yet been voted on — and the same for every edge. The first of these states to render is `proposed`, which is also the most common: every new facet starts in `proposed` and stays there until a vote / commit happens. Without proposed-state styling, the moderator has no visual signal that a node's classification / substance is still in flight. The sibling state-styling tasks (`mod_agreed_state_styling`, `mod_disputed_state_styling`) extend the same data shape and component seam this task ships; landing the projection + class-name plumbing once here means each follow-up task is just a new class-name branch.

The visual contract — dashed border, faded fill — matches the long-standing convention in CAD / diagramming software that dashed-stroke = tentative / draft / proposed, while solid stroke = committed. The dashed-stroke pattern is already documented as the proposed-state visual in the title of this task in `tasks/30-moderator-ui.tji` ("Proposed state styling (dashed, faded)").

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; the custom node / edge components are the explicit extension points for state styling.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the locale-aware mount the components already use; the styling is locale-independent but the rendering still passes through `useTranslation` so we keep the existing test infrastructure.
- `apps/server/src/projection/facet-status.ts` — the canonical `deriveFacetStatus` derivation rules. This task ports the same rules to the client (the server has no client-side derivation helper to call; the WS surface broadcasts `proposal-status` envelopes carrying `perFacetStatus` *per proposal*, but the projection here needs to attribute statuses *per entity-facet*, and several flows produce per-entity-facet status without a corresponding pending proposal — committed facets, withdrawn facets, meta-disagreement-marked facets — so the client computes from the event log directly rather than depending on the proposal-status broadcast slice).
- `apps/server/src/projection/types.ts` — `FacetStatus` (`proposed | agreed | disputed | committed | withdrawn | meta-disagreement`), `FacetName` (`classification | substance | wording`), `PerParticipantVote` (`agree | dispute | withdraw`). The same enum values are mirrored locally in `apps/moderator/src/graph/facetStatus.ts`; the moderator workspace does not import from the server workspace and `shared-types` does not currently re-export `FacetStatus`.
- `apps/moderator/src/graph/StatementNode.tsx` — the node card to extend with the proposed-state class names.
- `apps/moderator/src/graph/StatementEdge.tsx` — the edge component to extend with a dashed `stroke-dasharray` style on the `<BaseEdge>` when the substance facet is proposed.
- `apps/moderator/src/graph/selectors.ts` — the existing `selectEdgesForSession` selector; extended to compute per-edge facet statuses.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` is extended to compute per-node facet statuses for `(node, classification)`, `(node, substance)`, `(node, wording)`.
- `packages/shared-types/src/events/proposals.ts` — the `ProposalPayload` discriminated union. Each sub-kind tells us which entity + facet it targets:
  - `classify-node` → `(node, classification)`
  - `set-node-substance` → `(node, substance)`
  - `set-edge-substance` → `(edge, substance)`
  - `edit-wording.reword` → `(node, wording)`
  - `edit-wording.restructure` → `(node, wording)` (the new node id is created at commit)
  - `amend-node` → `(node, wording)` (the methodology-engine repair op)
  - The remaining sub-kinds (`decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `annotate`) are *structural* / per-participant / annotation-targeting; they do not produce a facet status for the moderator's node/edge cards and are out of scope for this task (see Decisions). The `proposed_consequences_stub` and meta-move surfaces are their own follow-up tasks.
- `packages/shared-types/src/events.ts` — `voteEvent` (`vote: agree | dispute | withdraw`), `commitEvent` (`proposal_id`), `metaDisagreementMarkedEvent` (`proposal_id`), `participantJoinedEvent`, `participantLeftEvent` — all consumed by the client derivation to compute current-participants × per-facet votes.

## Constraints / requirements

- **`facetStatus.ts` helper** (`apps/moderator/src/graph/facetStatus.ts`): exports the local `FacetStatus` and `FacetName` types (closed string unions mirroring the server enum verbatim) and a pure function `computeFacetStatuses(events: readonly Event[]): FacetStatusIndex` that returns:
  ```ts
  type FacetStatusIndex = {
    readonly nodes: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
    readonly edges: ReadonlyMap<string, Readonly<Partial<Record<FacetName, FacetStatus>>>>;
  };
  ```
  The function walks the events array once and builds per-entity per-facet `FacetState` records (the same shape as `apps/server/src/projection/types.ts`'s `FacetState`), then runs the per-rule derivation from `deriveFacetStatus` to produce the final status. Rules ported verbatim:
  - Meta-disagreement on a facet short-circuits to `'meta-disagreement'`.
  - Filter votes by `current participants` (participants who have joined and not left).
  - A `withdraw` vote against a committed facet → `'withdrawn'`; a `withdraw` vote against an uncommitted facet → `'disputed'`.
  - Any `dispute` vote → `'disputed'`.
  - Committed (commit landed, no dispute / withdraw) → `'committed'`.
  - All current participants voted `agree` → `'agreed'`.
  - Anything else → `'proposed'`.
- **Header comment in `facetStatus.ts`** documents that the derivation mirrors `apps/server/src/projection/facet-status.ts`'s `deriveFacetStatus`. If the server enum ever widens, the client mirror is updated in lock-step (and a future ADR / task may extract a shared helper into a workspace package; today the duplication is the smaller cost than carving out a new package mid-stream).
- **`StatementNodeData` extension**: add `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` (default `{}`). The component reads this and applies styling.
- **`StatementEdgeData` extension**: add `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>` (default `{}`). Same shape as nodes; edges in v1 only carry a `substance` facet.
- **`projectNodes` enrichment**: build the `FacetStatusIndex` once via `computeFacetStatuses(events)`, then read `index.nodes.get(node.id) ?? {}` to populate each emitted node's `data.facetStatuses`. The function signature stays `(events) → Node[]`.
- **`selectEdgesForSession` enrichment**: same — compute the index once, then `index.edges.get(edge.id) ?? {}` for each emitted edge.
- **`StatementNode` styling**: when any facet status is `'proposed'`, append Tailwind classes `border-dashed opacity-60` to the existing card class names (replacing the default `border` with `border-dashed`). A `data-facet-status="proposed"` attribute lands on the card root for tests + downstream tasks. When no facet is proposed, the classes / attribute are absent (so the existing solid-border / fully-opaque baseline is preserved exactly).
- **`StatementEdge` styling**: when the `substance` facet is `'proposed'`, pass `style={{ ...incomingStyle, strokeDasharray: '6 4', opacity: 0.6 }}` to `<BaseEdge>` (ReactFlow's `<BaseEdge>` applies `style` directly to the underlying `<path>` element). A `data-facet-status="proposed"` attribute lands on the role-label pill (the only stable DOM seam — `<BaseEdge>`'s `<path>` is rendered inside ReactFlow's SVG and is hard to target by id directly). The "dashed stroke for proposed edges" is the visual contract; the attribute on the label keeps tests targetable.
- **Multi-facet conflict resolution**: if a node has *both* a proposed facet and an agreed facet (the common case during a typical session), the proposed-state styling wins for the card-level decoration. The per-facet view (`mod_per_facet_state_visualization`) is what eventually subdivides the card into per-facet slices; this task ships the card-level conservative default ("any facet is proposed → card reads as proposed").
- **Tests** (committed, per ADR 0022):
  - `apps/moderator/src/graph/facetStatus.test.ts` (new file):
    - 1 case: empty event log returns empty maps.
    - 1 case: a `classify-node` proposal with no votes → `nodes.get(nodeId).classification === 'proposed'`.
    - 1 case: a `classify-node` proposal + one `agree` vote with two current participants → still `'proposed'` (not all current participants have voted agree).
    - 1 case: a `classify-node` proposal + all current participants `agree` → `'agreed'`.
    - 1 case: a `classify-node` proposal + a `dispute` vote → `'disputed'`.
    - 1 case: a `classify-node` proposal + all `agree` + a `commit` → `'committed'`.
    - 1 case: a committed `classify-node` + a `withdraw` vote → `'withdrawn'`.
    - 1 case: a `classify-node` proposal + a `mark-meta-disagreement` → `'meta-disagreement'`.
    - 1 case: a left participant's vote is excluded from the agreement count.
    - 1 case: an empty-session facet (no current participants, no votes) stays `'proposed'`.
    - 1 case: a `set-node-substance` proposal → `nodes.get(nodeId).substance === 'proposed'`.
    - 1 case: a `set-edge-substance` proposal → `edges.get(edgeId).substance === 'proposed'`.
    - 1 case: an `edit-wording.reword` proposal → `nodes.get(nodeId).wording === 'proposed'`.
    - 1 case: a node with no proposals targeting any of its facets has no entry in the index (or an empty object).
    - 1 case: structural proposal sub-kinds (`decompose`, `axiom-mark`, etc.) do NOT produce a facet entry on the parent node (out of scope per Decisions).
  - `apps/moderator/src/graph/selectors.test.ts` — extended with:
    - 1 case: `selectEdgesForSession` attaches `facetStatuses.substance === 'proposed'` to an edge that has a `set-edge-substance` proposal with no votes.
    - 1 case: an edge with no facet-targeting proposals has `facetStatuses: {}`.
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — extended with:
    - 1 case: `projectNodes` attaches `facetStatuses.classification === 'proposed'` to a node that has a `classify-node` proposal but no commit.
    - 1 case: `projectNodes` leaves `facetStatuses` empty for a node with no facet-targeting proposals.
    - 1 case: end-to-end through the canvas — a `node-created` + a `classify-node` proposal in the WS store renders the node with the proposed-state classes / attribute applied.
  - `apps/moderator/src/graph/StatementNode.test.tsx` — extended with:
    - 1 case: a node with `facetStatuses.classification === 'proposed'` has `border-dashed opacity-60` in its className and `data-facet-status="proposed"` on the card root.
    - 1 case: a node with `facetStatuses: {}` keeps the solid-border baseline (no `border-dashed`, no `data-facet-status` attribute, no `opacity-60`).
    - 1 case: a node with `facetStatuses.substance === 'agreed'` and `facetStatuses.classification === 'proposed'` still gets proposed styling (any-facet-proposed wins).
    - 3 cases × 3 locales: cross-locale rendering — the proposed styling applies regardless of active locale (the wording / kind label still resolve through i18n; the styling is locale-independent).
  - `apps/moderator/src/graph/StatementEdge.test.tsx` — extended with:
    - 1 case: an edge with `facetStatuses.substance === 'proposed'` has `data-facet-status="proposed"` on the role-label pill.
    - 1 case: an edge with `facetStatuses: {}` has no `data-facet-status` attribute on the role-label pill (the existing default rendering).

## Acceptance criteria

- `apps/moderator/src/graph/facetStatus.ts` exists, exports `FacetStatus`, `FacetName`, `FacetStatusIndex`, `computeFacetStatuses`.
- `apps/moderator/src/graph/selectors.ts` extends `StatementEdgeData` with `facetStatuses` and `selectEdgesForSession` populates it.
- `apps/moderator/src/graph/StatementNode.tsx` extends `StatementNodeData` with `facetStatuses` and applies the proposed-state class names.
- `apps/moderator/src/graph/StatementEdge.tsx` reads `data.facetStatuses` and applies the dashed-stroke / faded style.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `projectNodes` enriches each node's `data.facetStatuses`.
- All test files listed above contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_proposed_state_styling` plus a `note "Refinement: …"` line.

## Decisions

- **Client computes status from event log; identical state machine to server's `deriveFacetStatus`.** The server doesn't expose a client-callable helper, and the WS `proposal-status` broadcast only covers facets attached to *pending proposals* (not committed / withdrawn / meta-disagreement facets). The visual layer needs per-entity-facet status for every entity on the canvas, regardless of whether its facet has an active proposal. Porting the small rule set (~30 lines) is cheaper than threading another wire-side surface through. The header comment in `facetStatus.ts` and this Decisions line are the link back to the server-side canonical implementation. If a future refactor extracts a shared workspace helper, the duplication becomes the call site.
- **Card-level "any facet proposed → proposed styling" wins over agreed.** A node with one proposed facet and one agreed facet is still "in flight" overall — the proposed signal is the load-bearing one for the moderator's at-a-glance scan. The sibling `mod_per_facet_state_visualization` task subdivides the card into per-facet slices, at which point each facet gets its own styling and this card-level fallback recedes. Until that lands, this conservative default is the more honest UX than picking "agreed wins" (which would hide in-flight work).
- **Dashed border + `opacity-60` for nodes; `strokeDasharray: '6 4'` + `opacity: 0.6` for edges.** Matches the long-standing CAD / diagram convention for "tentative" and the title of this task in the WBS. The 60% opacity is the same as the proposed-state opacity used in several whiteboarding tools; a darker fade would risk illegibility against light themes. No design-token system exists yet (`packages/ui-tokens` is a future workstream per `mod_annotation_rendering`'s decisions); inline Tailwind utilities + raw style props are the right level today.
- **Out-of-scope proposal sub-kinds.** `decompose` / `interpretive-split` produce new child nodes whose facets start fresh at the commit; the parent node's facets aren't visibly "proposed" by the decomposition itself (the decomposition has its own pending-proposal indicator in the sidebar). `axiom-mark` is per-participant and rendered separately (`mod_axiom_mark_decoration`). `meta-move` targets a node/edge but produces no facet-status change (it's a sibling annotation). `break-edge` produces an edge deletion at commit, not a facet status. `annotate` produces an annotation. Each of these has its own dedicated rendering task; this task does not duplicate their semantics.
- **`facetStatuses` map (not flat `facetStatus: FacetStatus | undefined`).** Per-facet status is fundamentally per-facet — every entity has up to three facets (classification / substance / wording for nodes; substance for edges). A flat top-level `facetStatus` would force the rollup decision to be hard-coded in the projection rather than the component; the map shape pushes the decision into the component (where the sibling `mod_per_facet_state_visualization` can replace the rollup with per-facet rendering without changing the projection).
- **`data-facet-status="proposed"` on the rendered root** — stable seam for `mod_per_facet_state_visualization` and the visual-regression task (`mod_vr_state_styling`) to target without DOM-text scraping. The Tailwind class names are not stable as a test surface (Tailwind may emit different class strings in production / with JIT changes); the data attribute is.
- **Client-side `FacetStatus` / `FacetName` types mirror the server enum.** The server module is `apps/server/src/projection/types.ts` (a workspace not depended-on by the moderator). `@a-conversa/shared-types` does not currently re-export `FacetStatus`; this task does not widen `shared-types` either, because the projection types are internal to the server and the WS envelope only carries `Record<string, string>` for `perFacetStatus` (see `proposalStatusPayloadSchema`). A future workstream may decide to extract a shared methodology types package; until then the moderator's local mirror is the seam that future task replaces.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/graph/facetStatus.ts` — client-side port of `apps/server/src/projection/facet-status.ts`'s `deriveFacetStatus`. Exports the local `FacetStatus` / `FacetName` types (mirroring the server enum verbatim; `@a-conversa/shared-types` does not re-export `FacetStatus` today), the `FacetStatusIndex` shape (`{ nodes: Map<id, perFacetRecord>, edges: Map<id, perFacetRecord> }`), and the pure `computeFacetStatuses(events)` projection. The walk is single-pass: builds the current-participants set from `participant-joined` / `participant-left` events, maps proposal envelope ids to their (entityKind, entityId, facet) target via `targetOf(payload)`, accumulates per-facet `InternalFacetState` records, then runs the seven derivation rules. Out-of-scope proposal sub-kinds (`decompose`, `axiom-mark`, `meta-move`, `break-edge`, `annotate`, `interpretive-split`) return `null` from `targetOf` and contribute nothing to the index. Module-scope `EMPTY_FACET_STATUSES` is the stable-reference empty record.
- Updated `apps/moderator/src/graph/selectors.ts` — extended `StatementEdgeData` with `facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>`. `selectEdgesForSession` now computes `computeFacetStatuses(events)` once per call and reads `index.edges.get(edgeId) ?? EMPTY_FACET_STATUSES` for each emitted edge's `data.facetStatuses`.
- Updated `apps/moderator/src/graph/StatementNode.tsx` — extended `StatementNodeData` with `facetStatuses`. Exported `cardRollupStatus(facetStatuses)` (returns `'proposed'` when any facet is proposed, `undefined` otherwise — the conservative card-level rollup per the Decisions). The component reads the rollup, applies `border-dashed opacity-60` (with `border-slate-400` instead of `border-slate-300` for legibility against the dimmed fill) and stamps `data-facet-status="proposed"` on the card root when the rollup hits. Baseline rendering is preserved exactly when `facetStatuses` is empty.
- Updated `apps/moderator/src/graph/StatementEdge.tsx` — reads `data?.facetStatuses ?? {}` and, when `substance === 'proposed'`, composes `{ strokeDasharray: '6 4', opacity: 0.6 }` with any caller-provided `style` into the `<BaseEdge>` style prop. Stamps `data-facet-status="proposed"` on the role-label pill (the stable DOM seam — `<BaseEdge>`'s path is inside ReactFlow's SVG and not directly id-targetable).
- Updated `apps/moderator/src/graph/GraphCanvasPane.tsx` — `projectNodes` now computes `computeFacetStatuses(events)` once up-front and enriches each emitted node's `data.facetStatuses` via `index.nodes.get(nodeId) ?? EMPTY_FACET_STATUSES`.
- New `apps/moderator/src/graph/facetStatus.test.ts` — 18 Vitest cases. Empty-log baseline; the four agreement-layer states (`proposed`, `agreed`, `disputed`, `meta-disagreement`); the two committed-layer states (`committed`, `withdrawn`); current-participants filtering (left-participant exclusion, empty-session facet stays proposed); facet routing per proposal sub-kind (`set-node-substance` → substance, `set-edge-substance` → edge substance, `edit-wording.reword` → wording); entities-without-proposals absent from the index; out-of-scope sub-kind (`axiom-mark`) produces no facet entry; multi-facet independence (one node carries independent statuses on classification and substance); three-participant unanimous-vote requirement.
- Updated `apps/moderator/src/graph/selectors.test.ts` — added 2 new cases for `selectEdgesForSession` facet-status enrichment: substance proposal lands `'proposed'` on `data.facetStatuses.substance`; edge with no facet-targeting proposals has `facetStatuses: {}`. Existing single-edge `toEqual` updated to include `facetStatuses: {}`. Total file: 27 cases (was 25).
- Updated `apps/moderator/src/graph/StatementNode.test.tsx` — added 7 new cases under a new describe-block: proposed classification applies the Tailwind classes + `data-facet-status`; empty facetStatuses keeps the baseline; the any-facet-proposed-wins rollup with classification=agreed + substance=proposed still styles as proposed; non-proposed mix (agreed / committed / disputed only) does not style as proposed; 3 cross-locale cases (en-US / pt-BR / es-419) verify the styling applies regardless of active locale. Test helper extended to default `facetStatuses` to `{}`. Total file: 29 cases (was 22).
- Updated `apps/moderator/src/graph/StatementEdge.test.tsx` — added 2 new cases under a new describe-block: edge with `facetStatuses.substance === 'proposed'` stamps `data-facet-status="proposed"` on the role-label pill; edge with empty facetStatuses omits the attribute. Test helpers and edge construction updated to include `facetStatuses: {}` in the existing baseline cases. Total file: 26 cases (was 24).
- Updated `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — added 3 new cases under two new describe-blocks (`projectNodes` facet-status enrichment: classify-node proposal → `facetStatuses.classification === 'proposed'`; no proposals → empty; `GraphCanvasPane` end-to-end: a `node-created` + a `classify-node` proposal in the WS store render the node card with the proposed-state classes and attribute). Existing `projectNodes` `toEqual` updated to include `facetStatuses: {}`. Total file: 22 cases (was 19).
- Tests: +18 facetStatus + 2 selectors + 7 StatementNode + 2 StatementEdge + 3 GraphCanvasPane = +32 cases. `pnpm run test:smoke` 2139 → 2171, green. `pnpm run check` clean. `pnpm -F @a-conversa/moderator build` green (534.37 kB / gzip 166.65 kB — small bump from the facetStatus helper + per-component class-name glue). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers — the sibling state-styling tasks (`mod_agreed_state_styling`, `mod_disputed_state_styling`), `mod_per_facet_state_visualization`, the visual-regression task (`mod_vr_state_styling`), and any future component / Playwright test selecting on `[data-facet-status="proposed"]` — now have the per-entity per-facet `FacetStatus` index, the card / edge rollup seams, and the stable `data-facet-status` attribute to extend. The next two state-styling siblings only need to add a class-name branch on `cardRollupStatus` (for nodes) and a parallel `strokeDasharray` / `style` branch (for edges); they do NOT need to re-derive `FacetStatus` or re-wire the projection.
