# Moderator diagnostic highlighting (ambient outline on nodes / edges affected by active diagnostics)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_diagnostic_highlighting` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d (confirmed)
**Inherited dependencies**:

Settled (this task plugs into existing seams without changing their contracts):

- `moderator_ui.mod_graph_rendering.mod_node_rendering` (done — `StatementNode` + `projectNodes` populate `data` from the WS event log).
- `moderator_ui.mod_graph_rendering.mod_edge_rendering` (done — `StatementEdge` + `selectEdgesForSession` populate edge `data`).
- `moderator_ui.mod_graph_rendering.mod_proposed_state_styling` / `mod_agreed_state_styling` / `mod_disputed_state_styling` / `mod_meta_disagreement_split_render` (all done — pinned the `data-facet-status` seam, the `cardRollupStatus` border/ring branches on the node card, and the `style.stroke` / `strokeDasharray` branches on the edge. This task composes a *separate* non-color layer on top of those.).
- `moderator_ui.mod_graph_rendering.mod_selection` (done — pinned `data-selected` + `ring-4 ring-sky-500` on the node card root and the edge role-label pill. The selection ring is the prior art for "compose another ring on top of the existing status ring"; this task uses the same compositional pattern.).
- `moderator_ui.mod_shell.mod_ws_client` (done — `useWsStore` already has an `applyDiagnostic(payload)` writer that the client invokes on every inbound `diagnostic` envelope. Today it just keeps the LAST envelope in `sessionState[sessionId].lastDiagnostic`; this task widens the slice to track the active diagnostic set per session.).
- `data_and_methodology.diagnostics.diagnostic_event_emission` (done — defined the `DiagnosticEntry` discriminated union, the canonical identity key per kind, and the `fired` / `cleared` diff semantics that flow over the wire).
- `data_and_methodology.diagnostics.blocking_vs_advisory_classification` (done — pinned the `'blocking' | 'advisory'` vocabulary, doc-grounded in `docs/methodology.md` lines 210–227. The wire envelope already carries `severity` per the classifier; this task consumes that field for the blocking-vs-advisory cue differentiation).
- `backend.websocket_protocol.ws_diagnostic_broadcast` (done — `diagnostic` envelope shape pinned in `packages/shared-types/src/ws-envelope.ts` with `sessionId / kind / severity / status / sequence / diagnostic` fields, and the bridge fans out `fired` / `cleared` deltas to every subscribed connection).
- `frontend_i18n.i18n_diagnostic_descriptions` (done — `diagnostics.<kind>.title` / `.description` / `.detail` / `.action` keys exist in en-US / pt-BR / es-419. This task consumes `diagnostics.<kind>.title` for the hover tooltip; the longer-form `.description` / `.detail` / `.action` are owned by the future flag-pane / banner tasks, not this one.).

Pending edges (this task does NOT depend on them; they consume this task's seams):

- `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_flag_pane` (the sidebar list of active diagnostics).
- `moderator_ui.mod_diagnostic_resolution_flow.mod_diagnostic_focus_action` (the "click flag → focus on the canvas" action).
- `moderator_ui.mod_blocking_diagnostic_banner` (the explicit top-of-canvas banner for blocking diagnostics that need acknowledgment).

## What this task is

Render an **ambient halo** on every node and edge that's part of an *active* (un-cleared) diagnostic's affected-entity set, so the moderator can see at a glance — without leaving the canvas, without opening any sidebar — which part of the graph each fired diagnostic lives on. The halo persists for as long as the diagnostic remains in the active set (i.e. the projection hasn't fired a `'cleared'` envelope for the diagnostic's identity), and disappears the moment the `'cleared'` envelope arrives.

Concretely, this task lands:

1. **An active-diagnostic set on the WS store.** Today `useWsStore` keeps only `lastDiagnostic: DiagnosticPayload` per session — the last envelope seen. That's enough for a "show the most recent diagnostic" banner but not for ambient highlighting (the moderator may have N active diagnostics simultaneously and each must drive its own highlight). This task **widens** the per-session state with `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>`, keyed by the diagnostic's wire identity key. The store's `applyDiagnostic` reducer becomes: on `status === 'fired'` set/replace `activeDiagnostics.get(identityKey)`, on `status === 'cleared'` delete that key. `lastDiagnostic` stays (unchanged contract for the existing test in `client.test.ts:387`); this task is purely additive.

2. **A pure projection helper** `projectDiagnosticHighlights(activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>) → DiagnosticHighlightIndex` exported from `apps/moderator/src/graph/diagnosticHighlights.ts`. The output buckets affected entities by id, with **per-entity severity rollup** (blocking wins over advisory when the same entity appears in both a cycle and a coherency-hint), and carries the originating diagnostic kinds for the tooltip. Shape:
   ```ts
   export interface DiagnosticHighlight {
     readonly severity: 'blocking' | 'advisory'; // highest-severity hit
     readonly kinds: readonly WsDiagnosticKind[]; // every kind that touched this entity, dedup'd, in encounter order
   }
   export interface DiagnosticHighlightIndex {
     readonly nodes: ReadonlyMap<string, DiagnosticHighlight>;
     readonly edges: ReadonlyMap<string, DiagnosticHighlight>;
   }
   ```
   The helper walks each active `DiagnosticPayload`, narrows on `payload.kind`, and extracts the affected entity ids from the inlined `payload.diagnostic` per the kind's payload shape (cycle → all `nodes` + zero edges; contradiction → `nodeA` + `nodeB` + every id in `edges`; multi-warrant → `dataNodeId` + `claimNodeId` + every `warrantNodeIds[i]`; dangling-claim → `nodeId`; coherency-hint → narrows again on `payload.diagnostic.hint.kind` for the three coherency-hint sub-variants, each of which carries its own ids per `apps/server/src/diagnostics/coherency-hint-detection.ts`).

3. **Two new fields on `StatementNodeData` and `StatementEdgeData`** carrying the per-entity `DiagnosticHighlight | undefined`: `diagnosticHighlight?: DiagnosticHighlight`. `projectNodes` and `selectEdgesForSession` enrich each emitted node/edge from `index.nodes.get(id)` / `index.edges.get(id)`. The component reads the field and applies a halo when present.

4. **A halo visual on the node card.** When `data.diagnosticHighlight !== undefined`, the card root stamps `data-diagnostic-severity="blocking" | "advisory"` (stable seam, mirrors `data-facet-status` + `data-selected` decisions) and composes one of two Tailwind ring classes onto the existing `className`:
   - `'blocking'` → `ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white animate-pulse`
   - `'advisory'` → `ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white` (no pulse).

   The amber palette is deliberately distinct from the existing slate / rose / violet status palette and from the sky-500 selection ring — the moderator sees "this card has a problem the methodology engine wants me to look at" as a *yellow halo* signal, separate from "this facet is disputed" (rose) or "this is selected" (sky). Tailwind's `ring-*` stacks happily on top of the per-status `ring-2 ring-rose-500` / `ring-2 ring-violet-400` (the disputed / meta-disagreement state rings) and the `ring-4 ring-sky-500` (selection); ring layering composes left-to-right in className order with the widest ring on the outside. Width separation (`ring-4` for blocking, `ring-2 ring-offset-1` for advisory, `ring-2` for status, `ring-4` for selection) keeps the rings visually distinguishable.

5. **A halo visual on the edge role-label pill.** When `data.diagnosticHighlight !== undefined`, the role-label pill stamps `data-diagnostic-severity="..."` and composes the same Tailwind ring class onto its existing className. The `<BaseEdge>` `<path>` is *not* restyled — the methodology-state path styling (proposed dashed / disputed red stroke / meta-disagreement violet dotted) stays the canonical signal on the edge body; the diagnostic halo lives on the label pill (the same compositional decision made in `mod_selection` and `mod_proposed_state_styling` for the same reason: the `<path>` element is inside ReactFlow's SVG and is not directly id-targetable for tests, while the label div is a stable DOM seam).

6. **A native `title` tooltip on the halo'd entity** carrying the localized diagnostic kind title(s). When one diagnostic is active on the entity the tooltip reads `t('diagnostics.<kind>.title')`; when N > 1 the tooltip joins the unique kind titles with the locale-appropriate list separator (en-US `", "`, the simple comma-separator falls back to the same in pt-BR / es-419 — the long-form prose is owned by the flag pane, not this task). The `title` attribute is the lowest-friction tooltip surface — no portal, no positioning logic, no extra DOM, mirrors the `AnnotationBadge` + `AxiomMarkBadge` tooltip pattern landed earlier in this work stream. A *richer* tooltip (hover card with detail + action prose) belongs to the future `mod_hover_details` task, NOT here.

7. **Reactive update via the existing WS event stream.** No new socket plumbing. The client already routes `diagnostic` envelopes to `useWsStore.getState().applyDiagnostic(payload)`; the widened reducer (point 1) translates each `fired` / `cleared` arm into a set delta. `<StatementNode>` and `<StatementEdge>` re-render through the existing `data` flow because `projectNodes` / `selectEdgesForSession` already re-run whenever the events array reference flips — we additionally subscribe each projection to `sessionState[sessionId].activeDiagnostics` so the diagnostic delta triggers a fresh projection pass (one extra dependency on the existing `useMemo` in `GraphCanvasPane`; same memoization story as `events`).

This task is rendering only. It does NOT add resolution actions, does not surface the diagnostic in a sidebar list, does not block the moderator from committing through a blocking diagnostic, does not change the methodology-state styling layer, does not touch the diagnostic detection or emission code. The acknowledgment-and-commit-gating story is `commit_gating_on_blocking_diagnostics` (a future task explicitly named in `blocking_vs_advisory_classification`'s decisions); the flag pane is `mod_diagnostic_flag_pane`; the focus-click action is `mod_diagnostic_focus_action`; the banner is `mod_blocking_diagnostic_banner`.

## Why it needs to be done

The methodology engine fires diagnostics (`cycle`, `contradiction`, `multi-warrant`, `dangling-claim`, `coherency-hint`) as a *structural finding* — the projection has detected a pattern the moderator needs to attend to. The detectors, the classifier, the WS broadcast, and the i18n description templates are all settled and wired. What's still missing is the *first surface* on the moderator console that visualizes the finding: today an inbound `diagnostic` envelope is parsed, validated, dispatched to the store, and then ... nothing. The moderator can't see anything.

Surface order in this work stream is: **graph-canvas highlight (this task) → sidebar flag pane → blocking banner → focus-click action → commit gating**. The graph-canvas highlight is the lowest-friction surfacing because:

- It uses pixels the moderator is already looking at (the canvas), not a sidebar the moderator has to scan.
- It's directly anchored on the affected entity, so the moderator immediately knows *where* the problem lives (vs. a sidebar list that names ids the moderator has to cross-reference).
- It composes with the existing methodology-state styling without competing for the same visual axis — the rose / violet state rings tell the moderator about agreement-layer state; the amber halo tells the moderator about structural diagnostics. Two complementary signals, two complementary colors, one canvas.

Without this task, the WS stream of `diagnostic` envelopes lands silently. The first methodology-engine-driven structural finding the moderator misses is the kind of failure that erodes trust in the whole tool ("the engine claims to detect cycles but I never see one") — the cost of the silent fan-out is direct.

## Inputs / context

Code seams the implementation plugs into:

- `apps/moderator/src/ws/wsStore.ts:53` — `lastDiagnostic?: DiagnosticPayload` on `WsSessionState`. This task adds `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` alongside it.
- `apps/moderator/src/ws/wsStore.ts:191-201` — `applyDiagnostic(payload)` reducer. This task widens it to dispatch on `payload.status` (`'fired'` → add/replace by identity key; `'cleared'` → delete).
- `apps/moderator/src/ws/client.test.ts:387` — the existing test that asserts `sessionState?.lastDiagnostic?.kind === 'cycle'`. Stays green (the existing `lastDiagnostic` slot remains a "last envelope seen" slot, contract-preserved).
- `apps/moderator/src/graph/GraphCanvasPane.tsx:270-380` — `projectNodes(events)`. Extended to (a) read `activeDiagnostics` for the session via a new `useWsStore` selector in the parent, (b) accept it as a second argument, (c) call `projectDiagnosticHighlights` once up-front and enrich each emitted node's `data.diagnosticHighlight` from `index.nodes.get(nodeId)`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx:438-460` — `selectEdgesForSession`. Same enrichment pattern via `index.edges.get(edgeId)`.
- `apps/moderator/src/graph/StatementNode.tsx:79-122` — `StatementNodeData`. Gains `diagnosticHighlight?: DiagnosticHighlight`.
- `apps/moderator/src/graph/StatementNode.tsx:238-271` — the className composition + `rootProps` block. Gains a `diagnosticClassName` branch and a `data-diagnostic-severity` stamp, composed alongside the existing `styleClassName` + `selectionClassName`.
- `apps/moderator/src/graph/StatementEdge.tsx:155-167` — the role-label `labelDataAttrs` + `labelSelectionClassName`. Same compositional addition for the edge label.
- `apps/moderator/src/graph/selectors.ts:58-76` — `StatementEdgeData`. Gains the same `diagnosticHighlight?: DiagnosticHighlight` field.

Wire / type surface:

- `packages/shared-types/src/ws-envelope.ts:1061-1131` — `DiagnosticPayload` (`{ sessionId, kind, severity, status, sequence, diagnostic }`), `wsDiagnosticKinds` (the five `'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'` kinds), `wsDiagnosticSeverities` (`'blocking' | 'advisory'`), `wsDiagnosticStatuses` (`'fired' | 'cleared'`). All shipped; this task imports them.
- `apps/server/src/diagnostics/event-emission.ts:66-143` — `DiagnosticKind` + the per-kind interfaces (`CycleDiagnosticEntry { nodes: string[] }`, `ContradictionDiagnosticEntry { nodeA, nodeB, edges }`, `MultiWarrantDiagnosticEntry { dataNodeId, claimNodeId, warrantNodeIds }`, `DanglingClaimDiagnosticEntry { nodeId }`, `CoherencyHintDiagnosticEntry { hint: CoherencyHint }`). The shapes the projection narrows on; the moderator code DOES NOT import from `apps/server/*` (workspace boundary) — `apps/moderator/src/graph/diagnosticHighlights.ts` re-declares the shapes via inline TS types that mirror them, the same pattern `facetStatus.ts` followed to mirror the server's `FacetStatus` enum per `mod_proposed_state_styling`'s Decisions.
- `apps/server/src/diagnostics/coherency-hint-detection.ts:90-144` — `HintKind` + `IncompleteWarrantMissingBridgesToHint` (`{ warrantNodeId, dataNodeId }`), `IncompleteWarrantMissingBridgesFromHint` (`{ warrantNodeId, claimNodeId }`), `SelfContradictsHint` (`{ edgeId, nodeId }`). Again mirrored locally.
- `apps/server/src/diagnostics/event-emission.ts:identityKeyFor` — the canonical per-kind string key. The store uses the *wire* identity (it doesn't have `identityKeyFor`'s server-side scope), so the moderator-side helper `diagnosticIdentityKey(payload)` re-derives the same string from `payload.kind` + the inlined `payload.diagnostic` fields. The two helpers MUST produce the same key for the same diagnostic — pinned by an inline comment + a Vitest test that hand-builds the wire payload from a known server-side identity and asserts the round-trip.

Refinements that document the policy this task encodes:

- `tasks/refinements/data-and-methodology/diagnostic_event_emission.md` — identity-key canonicalization per kind.
- `tasks/refinements/data-and-methodology/blocking_vs_advisory_classification.md` — the `'blocking' | 'advisory'` vocabulary + the per-kind table.
- `tasks/refinements/data-and-methodology/cycle_detection.md` / `contradiction_detection.md` / `multi_warrant_detection.md` / `dangling_claim_detection.md` / `coherency_hint_detection.md` — per-detector payload shapes the projection narrows on.
- `tasks/refinements/frontend-i18n/i18n_diagnostic_descriptions.md` — the `diagnostics.<kind>.title` keys consumed by the tooltip.

ADRs:

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — ReactFlow on the moderator surface; node / edge custom components are the extension points.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check ships as a committed Vitest case.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — `useTranslation` for the localized tooltip title.

No new ADR is required: the task reuses ReactFlow (no new graph-rendering dependency), uses Tailwind utilities already in the moderator bundle, consumes wire types already pinned by `ws_diagnostic_broadcast`, and adds one i18n catalog key only if `i18n_diagnostic_descriptions`'s title key isn't reusable for the tooltip — which it is, so no new key.

## Constraints / requirements

### Store widening (additive, contract-preserving)

- **New field on `WsSessionState`**: `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` (default `new Map()` in `ensureSession`). The key is the wire identity (per `diagnosticIdentityKey(payload)` — see helper below). The value is the most recent `DiagnosticPayload` envelope for that identity (so the store always carries the freshest `sequence` + `severity` + `diagnostic` content).
- **Reducer change** in `applyDiagnostic(payload)`:
  - Compute `key = diagnosticIdentityKey(payload)`.
  - On `payload.status === 'fired'`: build `nextActive = new Map(session.activeDiagnostics); nextActive.set(key, payload)`. Set the per-session record with both `lastDiagnostic: payload` AND `activeDiagnostics: nextActive`.
  - On `payload.status === 'cleared'`: build `nextActive = new Map(session.activeDiagnostics); nextActive.delete(key)`. Set `lastDiagnostic: payload` AND `activeDiagnostics: nextActive`. (Even cleared envelopes update `lastDiagnostic` — the slot is "last envelope seen," not "last fired diagnostic," and downstream consumers that read it must already tolerate the cleared semantics.)
- **`lastDiagnostic` contract preserved.** The existing `client.test.ts:387` test continues to pass. The slot is now used by neither this task nor any *new* consumer; the existing reader stays valid.
- **`reset()` clears `activeDiagnostics`** via the same `initialState` path (the per-session map is rebuilt from `ensureSession` whenever a session record is recreated).

### Projection helper

- **File**: `apps/moderator/src/graph/diagnosticHighlights.ts`. Pure module, no React, no Zustand. Mirrors the `facetStatus.ts` pattern (mirror-the-server-enum-locally + pure projection).
- **Mirrored types** (matching the server enums verbatim; mirror-comment at the top of the file flags drift risk + points at `apps/server/src/diagnostics/event-emission.ts` as canonical):
  ```ts
  export type DiagnosticHighlightSeverity = 'blocking' | 'advisory';
  export type DiagnosticHighlightKind =
    | 'cycle'
    | 'contradiction'
    | 'multi-warrant'
    | 'dangling-claim'
    | 'coherency-hint';
  ```
  Re-exported as type aliases of `WsDiagnosticSeverity` / `WsDiagnosticKind` from `@a-conversa/shared-types` so the moderator-side names are stable while staying anchored to the wire types.
- **Public API**:
  ```ts
  export function diagnosticIdentityKey(payload: DiagnosticPayload): string;
  export function affectedEntities(payload: DiagnosticPayload): {
    readonly nodes: readonly string[];
    readonly edges: readonly string[];
  };
  export function projectDiagnosticHighlights(
    activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>,
  ): DiagnosticHighlightIndex;
  export const EMPTY_DIAGNOSTIC_HIGHLIGHTS: DiagnosticHighlightIndex; // frozen { nodes: empty Map, edges: empty Map }
  ```
  All pure. `diagnosticIdentityKey` is the inverse of `apps/server/src/diagnostics/event-emission.ts`'s `identityKeyFor`; it MUST produce the same string for the same canonical diagnostic so the store's set delta from a server-side `fired` / `cleared` pair correctly resolves to "same entry, add then remove."
- **Identity-key formulas** (mirroring the server's, per `diagnostic_event_emission.md`'s Acceptance criteria):
  - `cycle`: `cycle\0<sorted node ids joined with \0>` — sort the `payload.diagnostic.nodes` array to canonicalize adjacency-walk start point.
  - `contradiction`: `contradiction\0<nodeA>\0<nodeB>` — the server canonicalizes (lexicographic) so the wire pair is already canonical.
  - `multi-warrant`: `multi-warrant\0<dataNodeId>\0<claimNodeId>\0<sorted warrant ids joined with \0>`.
  - `dangling-claim`: `dangling-claim\0<nodeId>`.
  - `coherency-hint`: `coherency-hint\0<hint.kind>\0<per-sub-kind fields>` — the three sub-kind branches each contribute their canonical ids per the server's identity formula.
- **`affectedEntities(payload)`** — the per-kind narrow that extracts entity ids from the payload:
  - `cycle` → `{ nodes: payload.diagnostic.nodes, edges: [] }`.
  - `contradiction` → `{ nodes: [nodeA, nodeB], edges: payload.diagnostic.edges }`.
  - `multi-warrant` → `{ nodes: [dataNodeId, claimNodeId, ...warrantNodeIds], edges: [] }`.
  - `dangling-claim` → `{ nodes: [nodeId], edges: [] }`.
  - `coherency-hint` → sub-kind switch:
    - `incomplete-warrant-missing-bridges-to` → `{ nodes: [warrantNodeId, dataNodeId], edges: [] }`.
    - `incomplete-warrant-missing-bridges-from` → `{ nodes: [warrantNodeId, claimNodeId], edges: [] }`.
    - `self-contradicts` → `{ nodes: [nodeId], edges: [edgeId] }`.
- **Severity rollup per entity**: when an entity appears in multiple active diagnostics, `blocking > advisory`. The `kinds` array preserves encounter order (the map iteration order is the order the envelopes landed in, which is the wire arrival order — stable across reads on the same snapshot). Deduped by kind so a node appearing in two distinct cycles doesn't show `kinds: ['cycle', 'cycle']`.

### Component wiring

- **`StatementNodeData`**: add `diagnosticHighlight?: DiagnosticHighlight` (`undefined` when no active diagnostic touches this node).
- **`StatementEdgeData`**: add the same `diagnosticHighlight?: DiagnosticHighlight`.
- **`projectNodes(events, highlights)`** signature widening: second positional arg is the precomputed `DiagnosticHighlightIndex`. `GraphCanvasPane`'s `useMemo` reads `activeDiagnostics` from the WS store via a stable selector, computes the index once, and threads it into both projections. Default to `EMPTY_DIAGNOSTIC_HIGHLIGHTS` when the session has no active diagnostics so the projection's `index.nodes.get(...)` and `.edges.get(...)` paths stay uniform.
- **`selectEdgesForSession(state, sessionId, highlights?)`** — same widening for the edge selector. The third arg is optional with a default of `EMPTY_DIAGNOSTIC_HIGHLIGHTS` so the existing 27 Vitest cases in `selectors.test.ts` keep their two-arg call sites working without per-test churn.
- **Component className composition**:
  - Node card root className: `${baseClassName} ${styleClassName}${selectionClassName ? ' ' + selectionClassName : ''}${diagnosticClassName ? ' ' + diagnosticClassName : ''}`. `diagnosticClassName` is `'ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white animate-pulse'` for `'blocking'`, `'ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white'` for `'advisory'`, empty string when `diagnosticHighlight === undefined`.
  - Edge role-label className: `rounded bg-white px-1 text-xs text-slate-900 shadow-sm${labelSelectionClassName}${labelDiagnosticClassName}`. Same branch shape as the node.
- **`data-diagnostic-severity` stamp**: stamped on the same DOM element that carries `data-facet-status` + `data-selected` (the node card root + the edge role-label pill). Three possible values: `'blocking'` / `'advisory'` / absent. Absent (no attribute at all) when `diagnosticHighlight === undefined` — mirrors the `data-facet-status` decision to omit on baseline rather than stamp `"none"`.
- **`title` tooltip**: when `diagnosticHighlight !== undefined`, set `title` on the same element. Value: `highlight.kinds.map(k => t(\`diagnostics.\${k}.title\`)).join(', ')`. Single-kind: one localized title. Multi-kind: the localized titles joined with a culture-naive `", "` (per Decisions — the long-form prose lives in the flag pane, not the inline tooltip; the simple separator stays correct enough across en-US / pt-BR / es-419 for v1).
- **Reduced motion**: the `animate-pulse` class on the blocking-severity ring is gated on `motion-safe:animate-pulse` Tailwind variant — `motion-safe:` respects the user's `prefers-reduced-motion: reduce` media-query, so the pulse is auto-suppressed for users who opted out without any per-component JS. Advisory (no pulse) is unaffected.

### Performance

- **Projection cost** is `O(N_diagnostics × max(payload entity count))`. v1 sessions have at most a handful of active diagnostics; the cost is negligible. The projection is memoized in `GraphCanvasPane` via `useMemo([events, activeDiagnostics, sessionId])` so the helper runs only when one of the three changes by referential identity.
- **`StatementNode` / `StatementEdge` re-render scope**: ReactFlow re-renders the node/edge whenever its `data` reference changes. The projection produces a fresh `data` object on every events-or-activeDiagnostics tick (consistent with the existing `projectNodes` semantics — each pass returns a fresh `Node<...>[]`), so the render scope follows the existing model. The existing `EMPTY_*` stable-reference pattern (e.g. `EMPTY_ANNOTATIONS`, `EMPTY_VOTES`) is matched by `EMPTY_DIAGNOSTIC_HIGHLIGHTS` so the no-diagnostic baseline doesn't churn references.

### i18n

- **No new catalog keys** required for v1. The `diagnostics.<kind>.title` keys from `i18n_diagnostic_descriptions` are reused for the tooltip. Catalog parity stays at 65 keys across all three locales.
- **No tooltip prose in this task beyond the kind title.** The longer-form `.description` / `.detail` / `.action` strings are owned by the flag pane and the banner — surfacing them inline on the canvas would either truncate (the `title` attribute has no rich formatting) or duplicate the panes' surfaces.

### Tests (committed, per ADR 0022)

All listed tests are pre-decided to be the Acceptance bar. The implementer should not introduce new uncovered behavior; if a new branch surfaces during implementation, document it and add the corresponding case.

New file `apps/moderator/src/graph/diagnosticHighlights.test.ts`:

- `diagnosticIdentityKey` round-trips through every kind:
  - `cycle` — same node set in two adjacency walks produces the same key.
  - `contradiction` — `{nodeA, nodeB, edges: [e1]}` and `{nodeA, nodeB, edges: [e1, e2]}` produce the SAME key (edges are content, not identity).
  - `multi-warrant` — adding a warrant changes the key.
  - `dangling-claim` — node id is the full identity.
  - `coherency-hint` — each of the three sub-kinds produces a distinct key; same sub-kind with same per-sub-kind ids produces the same key.
- `affectedEntities` per kind (5 cases): each kind extracts the documented entity ids.
- `affectedEntities` coherency-hint sub-kinds (3 cases): each of the three sub-kinds extracts its documented ids.
- `projectDiagnosticHighlights` per kind: each of the five kinds produces an index that hits the documented entity ids with the documented severity.
- `projectDiagnosticHighlights` severity rollup: an entity appearing in a blocking diagnostic AND an advisory one resolves to `severity: 'blocking'`.
- `projectDiagnosticHighlights` kinds dedupe: an entity appearing in two cycles resolves to `kinds: ['cycle']` (not duplicated).
- `projectDiagnosticHighlights` kinds order: an entity touched first by a cycle then by a multi-warrant resolves to `kinds: ['cycle', 'multi-warrant']` (encounter order preserved).
- Empty input → `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference (the stable empty-index reference).

Extension to `apps/moderator/src/ws/wsStore.test.ts`:

- A `fired` `diagnostic` payload populates `activeDiagnostics` keyed by the wire identity.
- A `cleared` payload for the same identity removes the entry.
- A `cleared` for an unknown identity is a no-op (no error, no spurious entry).
- Two distinct `fired` diagnostics co-exist in `activeDiagnostics`.
- `lastDiagnostic` continues to be set to the most recent envelope (regardless of `status`).
- `reset()` clears `activeDiagnostics`.

Extension to `apps/moderator/src/graph/StatementNode.test.tsx`:

- A node with `diagnosticHighlight === undefined` has no `data-diagnostic-severity` attribute and no amber ring in its className.
- A node with `diagnosticHighlight: { severity: 'blocking', kinds: ['cycle'] }` stamps `data-diagnostic-severity="blocking"` and has `ring-4 ring-amber-500/80 ring-offset-2 ring-offset-white motion-safe:animate-pulse` in the className.
- A node with `diagnosticHighlight: { severity: 'advisory', kinds: ['multi-warrant'] }` stamps `data-diagnostic-severity="advisory"` and has `ring-2 ring-amber-300/70 ring-offset-1 ring-offset-white` (no pulse class).
- A node with a blocking highlight AND an active `'disputed'` rollup status renders BOTH the rose status ring AND the amber diagnostic ring in the className — the two rings compose, neither overwrites the other.
- A node with a blocking highlight AND `isSelected: true` renders BOTH the sky selection ring AND the amber diagnostic ring — same composition pin.
- A node with `diagnosticHighlight.kinds: ['cycle']` has `title="Cycle"` (en-US) on the card root.
- A node with `diagnosticHighlight.kinds: ['cycle', 'contradiction']` has a `title` containing both kind titles joined with `", "`.
- 3 cross-locale cases: the title for a `['cycle']` highlight resolves to the matching en-US / pt-BR / es-419 catalog string.

Extension to `apps/moderator/src/graph/StatementEdge.test.tsx`:

- An edge with `diagnosticHighlight === undefined` has no `data-diagnostic-severity` and no amber ring on the role-label pill.
- An edge with a blocking highlight stamps `data-diagnostic-severity="blocking"` on the role-label pill and has the matching ring classes.
- An edge with an advisory highlight stamps `data-diagnostic-severity="advisory"` and has the matching ring classes.
- An edge with a blocking diagnostic AND `substance: 'disputed'` keeps the disputed red stroke on the `<path>` (per inline-style assertion) AND stamps the amber ring on the role-label — the methodology-state path styling and the diagnostic halo are independent visual layers.

Extension to `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:

- `projectNodes` enriches a node's `data.diagnosticHighlight` from the precomputed index when the node id is in the highlights.
- `projectNodes` leaves `data.diagnosticHighlight === undefined` when the node id is not in the highlights.
- `selectEdgesForSession` does the same for edges.
- End-to-end: with `node-created` + a `fired` `cycle` diagnostic in the WS store, the rendered canvas card carries the amber ring + `data-diagnostic-severity="blocking"`.
- End-to-end: with the same state plus a `cleared` envelope for the same identity, the next render clears the ring + the attribute.

No Playwright case is required in this task. The visual-regression layer (the future `mod_vr_diagnostic_highlighting` sibling, parallel to `mod_vr_state_styling`) will own the pixel-level confirmation; the existing per-component DOM assertions are the load-bearing test contract per the project's no-throwaway-verifications rule.

## Acceptance criteria

- `apps/moderator/src/graph/diagnosticHighlights.ts` exists, exports `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`, `EMPTY_DIAGNOSTIC_HIGHLIGHTS`. The module-level comment cites `apps/server/src/diagnostics/event-emission.ts` as the canonical-identity reference, mirroring the `facetStatus.ts` mirror-comment pattern.
- `apps/moderator/src/ws/wsStore.ts` carries `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` on `WsSessionState`, the widened `applyDiagnostic` reducer, and the test-listed reducer behavior.
- `apps/moderator/src/graph/selectors.ts`'s `StatementEdgeData` carries `diagnosticHighlight?: DiagnosticHighlight`; `selectEdgesForSession` accepts the optional third arg + enriches accordingly.
- `apps/moderator/src/graph/StatementNode.tsx`'s `StatementNodeData` carries `diagnosticHighlight?: DiagnosticHighlight`; the component composes the amber ring branch + stamps `data-diagnostic-severity` + sets `title`.
- `apps/moderator/src/graph/StatementEdge.tsx`'s role-label pill composes the same branch.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` subscribes to `activeDiagnostics`, computes the `DiagnosticHighlightIndex` once per memoization tick, threads it into both projections.
- All new / extended test files contain the listed cases.
- `pnpm run check` clean.
- `pnpm run test:smoke` green (test count rises by the new cases).
- `pnpm -F @a-conversa/moderator build` succeeds.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `tasks/30-moderator-ui.tji` gets `complete 100` on `mod_diagnostic_highlighting` plus a `note "Refinement: tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md"` line.

## Decisions

- **Halo (ring), not color tint / corner badge / marker icon, on the node card.** Four candidates considered:
  1. *Color tint on the card border* — collides with the rose / violet / slate-700 status border already pinned by `mod_disputed_state_styling` / `mod_meta_disagreement_split_render` / `mod_agreed_state_styling`. Either the diagnostic color overwrites the status color (loses methodology-state signal) or vice versa (loses diagnostic signal). Rejected.
  2. *Corner badge with an icon* — adds DOM weight, competes with the annotation badge row + axiom-mark badge row for corner real estate, and forces a per-kind icon system that doesn't exist yet (no shared icon package). Better suited to the per-facet-pill kind of detail rendering than the at-a-glance scan. Rejected.
  3. *Halo / ring* — purely a CSS-class addition, composes cleanly with the existing status / selection rings (Tailwind `ring-*` stacks via `ring-offset-*`), reads as "this entity needs attention" without overwriting anything else. **Chosen.** Mirrors the established `mod_disputed_state_styling` (rose ring) + `mod_meta_disagreement_split_render` (violet ring) + `mod_selection` (sky ring) idiom; the diagnostic ring is the fourth layer in the same family.
  4. *Per-kind marker icon stamped inside the card body* — same DOM-weight + icon-package problem as the corner badge, plus would interfere with the wording + kind label layout. Rejected.

- **Single style across diagnostic kinds (color is severity-driven, not kind-driven).** Cycle / contradiction / multi-warrant / dangling-claim / coherency-hint share one visual idiom: amber halo. Kind-specific halos would either (a) require five distinguishable colors that *also* don't collide with the existing palette (slate / rose / violet / sky / amber / emerald / fuchsia / cyan / lime / amber for participant colors) — pragmatically impossible — or (b) require five distinguishable shapes / icons — too much visual complexity. The methodology's first-cut classification is binary (`blocking` vs `advisory`), which IS the load-bearing severity axis the moderator's attention needs to flow on; the *specific* kind is information for the tooltip + the flag pane, not the at-a-glance scan.

- **Blocking vs advisory cue differentiation: ring width + offset + animation.** `ring-4 ring-offset-2 motion-safe:animate-pulse` for blocking, `ring-2 ring-offset-1` (no pulse) for advisory. Three axes of differentiation (width, offset, animation) so the two read distinctly under any color-vision profile + with `prefers-reduced-motion` honored. Both use the same amber family so the "this is a diagnostic, regardless of severity" signal stays consistent.

- **Amber color family, not red or orange.** Red is already claimed by the disputed status ring (rose-500 / rose-600). Orange overlaps too closely with amber to be reliably distinguishable, and `tailwind/orange` collides with the `axiomMark` palette's `amber` bucket per `mod_axiom_mark_decoration` (a participant in the `amber` bucket would have their axiom-mark badge read as "diagnostic" if the diagnostic palette were also amber — but: (a) the axiom-mark badge is a small `rounded-sm` square with an "A" glyph, the diagnostic ring is a halo around the card frame; the shape difference is the primary visual seam, color is secondary; (b) the axiom-mark badge uses `bg-amber-100 text-amber-900 ring-1 ring-amber-300` — light fill + dark text + thin light ring — while the diagnostic ring is `ring-amber-300/70` / `ring-amber-500/80` with explicit opacity and a `ring-offset-white` separation; the two read as distinct decoration families. The collision is acknowledged + accepted; the alternative (a sixth distinct color family) is more cost than benefit). `amber` is the canonical "warning / attention" color in most UI palettes and tilts away from the "this is wrong" red of dispute toward the "this needs your attention" yellow of methodology-engine notice — which is exactly the semantic the moderator should read.

- **Tooltip on hover: ship now via native `title`, defer rich card to `mod_hover_details`.** The native `title` attribute is the cheapest tooltip surface — no portal, no positioning logic, no extra DOM, no test-id juggling. It carries the localized diagnostic kind title(s), which is enough to answer "what is this halo about?" without requiring the moderator to leave the canvas. The full description / detail / action prose belongs to the future `mod_diagnostic_flag_pane` (the sidebar) and the future `mod_hover_details` (the rich hover card) — both of those tasks consume the same `data-diagnostic-severity` seam this task stamps, plus the underlying `activeDiagnostics` map this task ships on the store. Putting rich prose in the inline tooltip would duplicate either the pane's surface or `mod_hover_details`' surface, with worse UX (the native tooltip can't render markdown / multiline).

- **Animation policy: `motion-safe:animate-pulse` on blocking only; advisory is static.** A pulsing blocking ring is the load-bearing "this is urgent" signal — the moderator's eye is drawn to motion. Advisory is static so the canvas doesn't become a wall of pulses when several coherency hints fire simultaneously. `motion-safe:` honors `prefers-reduced-motion` automatically via Tailwind — users who opted out see a static blocking ring (still differentiated from advisory by width + offset), so the severity signal degrades gracefully.

- **Layer ordering: status ring (rose / violet / slate-700) + selection ring (sky) + diagnostic ring (amber) compose, none overwrite.** Tailwind's `ring-*` utility is additive at the className level; the LAST ring class wins per CSS specificity rules, but `ring-offset-*` separates them visually. The composition rule:
  - Innermost: the status ring (`ring-2 ring-rose-500` or `ring-2 ring-violet-400`) — the methodology-state signal closest to the card body.
  - Middle: the selection ring (`ring-4 ring-sky-500`) — sits outside the status ring per the `mod_selection` decision.
  - Outermost: the diagnostic ring (`ring-2` or `ring-4` amber + `ring-offset-*`) — sits outside the selection ring because diagnostics outrank "I just clicked this" in the visual hierarchy (the moderator may be selecting a diagnostic-affected entity to act on it; the diagnostic context is the load-bearing reason for the selection).
  Tailwind's `ring-offset-*` creates the visual separation; the last applied `ring-*` rules win on CSS specificity but the `ring-offset-*` separation keeps each ring readable. In practice the className concatenation order is `status → selection → diagnostic`, matching the visual stacking.

- **Severity rollup: blocking wins.** An entity touched by a cycle (blocking) AND a coherency-hint (advisory) reads as blocking. Two reasons: (a) blocking is the methodology's "this needs acknowledgment before forward progress" signal; demoting it to advisory because some less-urgent diagnostic also touches the entity inverts the methodology vocabulary; (b) the rollup is one-way — once an entity is touched by blocking, demoting requires *every* blocking diagnostic to clear, which the moderator handles via the `cleared` deltas naturally.

- **Identity-key parity with the server.** The wire envelope doesn't carry the identity key directly; the moderator-side helper re-derives it from `payload.kind` + the inlined `payload.diagnostic` fields. A drift between the moderator's `diagnosticIdentityKey` and the server's `identityKeyFor` would break the `fired` / `cleared` matching — a `cleared` whose key doesn't match the previously-fired `fired` would leak an "active" entry in the store forever. Mitigated by: (a) the formulas in this refinement match the server's verbatim per `diagnostic_event_emission.md`'s Acceptance criteria; (b) the test file includes a round-trip case that hand-builds a wire payload from a known server-side identity and asserts the moderator helper produces the same string; (c) a future shared workspace package could extract the helper into shared code — out of scope here, same rationale as `facetStatus.ts`'s server-mirror.

- **Store widening, not store replacement.** `lastDiagnostic` stays on `WsSessionState` because the existing `client.test.ts:387` test reads it, and because future consumers (a "you just got a new diagnostic, here's a toast" UX) may want the slot. The widening is purely additive — `activeDiagnostics` is the new field this task adds; nothing existing is removed or renamed.

- **`projectNodes` second arg, not store read inside the projection.** The projection stays pure (consistent with the existing `projectNodes(events)` signature) — the new `highlights: DiagnosticHighlightIndex` arg makes the dependency explicit. The store-subscribe + memoization lives in `GraphCanvasPane`, the existing seam for "where in the component tree do we couple to Zustand for the canvas." This matches the `computeFacetStatuses(events)` + `projectVotesByFacet(events)` pattern from earlier siblings.

- **`selectEdgesForSession`'s third arg defaults to `EMPTY_DIAGNOSTIC_HIGHLIGHTS`.** Optional with a stable empty default so the existing 27 `selectors.test.ts` cases keep their two-arg signatures. Same backward-compat pattern as `mod_proposed_state_styling` used when it added the `facetStatuses` enrichment.

- **No new ADR.** The task reuses ReactFlow (no new graph-rendering dependency — that's the load-bearing ADR test), reuses Tailwind utilities, reuses wire types pinned by `ws_diagnostic_broadcast`, reuses i18n keys pinned by `i18n_diagnostic_descriptions`. The architectural seams (active-diagnostics store slot, projection helper, per-entity highlight prop) are local to the moderator workspace and don't change any cross-workspace contract.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New pure projection module `apps/moderator/src/graph/diagnosticHighlights.ts` exports `DiagnosticHighlight`, `DiagnosticHighlightIndex`, `diagnosticIdentityKey`, `affectedEntities`, `projectDiagnosticHighlights`, and the stable `EMPTY_DIAGNOSTIC_HIGHLIGHTS` reference; the module-level mirror-comment cites `apps/server/src/diagnostics/event-emission.ts` as the canonical identity-key reference (same pattern `facetStatus.ts` follows).
- `apps/moderator/src/graph/diagnosticHighlights.test.ts` pins the per-kind identity-key formula (cycle / contradiction / multi-warrant / dangling-claim / coherency-hint plus the three coherency-hint sub-kinds), the per-kind `affectedEntities` extractor, the `projectDiagnosticHighlights` severity rollup (blocking wins over advisory), the kinds-dedupe + encounter-order guarantee, and the empty-input stable-reference contract. Includes the round-trip-consistency case that hand-builds wire payloads matching the server's `identityKeyFor` formula verbatim so a future drift fails the suite.
- `apps/moderator/src/ws/wsStore.ts` carries a new additive `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` slot on `WsSessionState`; the widened `applyDiagnostic` reducer dispatches on `payload.status` (fired adds/replaces by `diagnosticIdentityKey`, cleared deletes), with `lastDiagnostic` semantics fully preserved for the existing `client.test.ts` reader. `reset()` clears the slot via the `ensureSession` rebuild path. `wsStore.test.ts` covers fired/cleared/unknown-cleared/co-existence/reset cases plus the `lastDiagnostic` backward-compat assertion.
- `apps/moderator/src/graph/selectors.ts`'s `StatementEdgeData` gains an optional `diagnosticHighlight?: DiagnosticHighlight`; `selectEdgesForSession` takes an optional third `highlights` arg defaulting to `EMPTY_DIAGNOSTIC_HIGHLIGHTS` (existing 27 two-arg call sites unchanged).
- `apps/moderator/src/graph/StatementNode.tsx` and `apps/moderator/src/graph/StatementEdge.tsx` stamp a stable `data-diagnostic-severity` DOM attribute (`"blocking"` / `"advisory"` / absent), compose amber `ring-*` Tailwind classes alongside the existing status + selection rings (`ring-4 ring-amber-500/80 ring-offset-2 motion-safe:animate-pulse` for blocking; `ring-2 ring-amber-300/70 ring-offset-1` for advisory), and set a native `title` tooltip from the existing `diagnostics.<kind>.title` i18n keys (no new catalog keys added; en-US / pt-BR / es-419 parity preserved). Component tests pin the no-highlight baseline, both severity branches, the multi-kind tooltip join, three cross-locale title assertions, and the composition-with-status-ring + composition-with-selection-ring invariants.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` subscribes to `sessionState[sessionId].activeDiagnostics`, computes `projectDiagnosticHighlights` once per memoization tick (`useMemo([events, activeDiagnostics, sessionId])`), and threads the index into both `projectNodes(events, highlights)` and `selectEdgesForSession(state, sessionId, highlights)`. `GraphCanvasPane.test.tsx` adds end-to-end coverage: a `fired` cycle envelope renders the amber ring + attribute on the affected card; a follow-up `cleared` envelope clears both on the next render.
- Visual-regression coverage explicitly deferred to a future `mod_vr_diagnostic_highlighting` sibling (parallel to `mod_vr_state_styling`); per-component DOM assertions remain the load-bearing contract per ADR 0022.
- Verification: `pnpm run check` green; `pnpm run test:smoke` 2431 passing (was 2380; +51 new cases); `pnpm -F @a-conversa/moderator build` succeeds; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
