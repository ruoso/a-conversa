# In-memory graph data structure (nodes, edges, annotations, indices)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.projection_data_structure`
**Effort estimate**: 2d
**Inherited dependencies**: `data_and_methodology.event_types` (settled — full event-type registry, validator, and shared-types enums all landed).

## What this task is

Define the in-memory graph data structure that holds a single session's projected state — the typed containers and indices `project_from_log`, `project_incrementally`, `per_facet_status_derivation`, `active_firing_computation`, and `projection_caching` build on. This task delivers the **storage** shape (data + indices + plain mutators); event-handling and derivation logic live in the next tasks.

## Why it needs to be done

[architecture.md — Storage](../../../docs/architecture.md#storage) is explicit:

> In-memory graph projection per active session, rebuilt from the session's event log (joined against the global node/edge tables) on session load and updated as events stream in. Cycle detection, multi-warrant detection, and contradiction detection all run against this in-memory representation.

Every downstream consumer — projection rebuild, incremental update, per-facet status derivation, structural diagnostics, caching — needs *something* to read from and write into. This task is that something. Without it the rest of the projection sub-stream has no shape to operate on.

## Inputs / context

Primary references:

- [docs/data-model.md — Nodes / Edges / Annotations / Per-participant agreement / Visible-graph derivation](../../../docs/data-model.md). The structure mirrors what this doc describes: globally-identified nodes / edges / annotations, plus per-session facets, per-participant agreement state, and axiom marks.
- [docs/architecture.md — Sessions and the global graph + Storage](../../../docs/architecture.md). Explains the global-vs-session split this projection respects: global identity (id, wording, role, endpoints, creator) is mirrored from the global tables; session-scoped state is derived from the event log later.
- [packages/shared-types/src/events/enums.ts](../../../packages/shared-types/src/events/enums.ts) and [packages/shared-types/src/events/proposals.ts](../../../packages/shared-types/src/events/proposals.ts) — the `EdgeRole`, `AnnotationKind`, and `StatementKind` enums the typed entity records reuse.
- [apps/server/migrations/0004_nodes.sql](../../../apps/server/migrations/0004_nodes.sql), [0005_edges.sql](../../../apps/server/migrations/0005_edges.sql), [0006_annotations.sql](../../../apps/server/migrations/0006_annotations.sql) — the persistent shape the projected entities mirror (id, wording / role+endpoints / kind+content+target, creator, timestamp).

## Constraints / requirements

- Lives under `apps/server/src/projection/` per [ADR 0010 (directory layout)](../../../docs/adr/0010-directory-layout.md). Pure in-memory logic; no DB access.
- Types reuse `EdgeRole`, `AnnotationKind`, `StatementKind` from `@a-conversa/shared-types`. UUIDs are `string`.
- The class / module exposes **storage-shaped** methods (`addNode`, `removeNode`, `addEdge`, `removeEdge`, `addAnnotation`, `removeAnnotation`, `setNodeVisible`, `setEdgeVisible`, `setAnnotationVisible`) plus index getters. It does **not** expose event-handling methods (`applyXyzEvent`) — those land in `project_from_log` / `project_incrementally`.
- The structure carries enough room for downstream tasks to attach their per-facet-state without re-shaping core records (open `Map`-shaped slots for per-participant agreement, axiom marks, derived facet status). Concrete index / state shapes for those concerns are owned by their own tasks.
- Indices specified for this task: by-id maps for nodes / edges / annotations; edges-by-source-node-id; edges-by-target-node-id; annotations-by-target-node-id; annotations-by-target-edge-id; a `pendingProposals` set keyed by proposal-event id.
- No comments beyond what `docs/data-model.md` would expect a reader to know.
- Verifications are committed Vitest unit tests per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md). No `node -e` probes.

## Acceptance criteria

- `apps/server/src/projection/types.ts` exports `ProjectedNode`, `ProjectedEdge`, `ProjectedAnnotation`, `Projection`, `PerParticipantAgreement`, `PerParticipantFacetState`, `FacetState`.
- `apps/server/src/projection/projection.ts` exports `createEmptyProjection(sessionId)` and the `Projection` class with the methods listed above. Construction is a factory; mutators maintain index invariants.
- `apps/server/src/projection/index.ts` is a barrel re-export.
- `apps/server/src/projection/projection.test.ts` exercises every invariant listed in this refinement.
- `pnpm run test:smoke` green; `make test` end-to-end green.

## Decisions

- **Class with internal `Map`s, factory entry point.** The `Projection` is a class because the mutator methods need shared private indices and the invariants are clearer when grouped on `this`; `createEmptyProjection(sessionId)` is the factory entry point so callers don't `new` directly. The class is in-process / per-session — never serialized.
- **Duplicate add throws.** `addNode(id-already-present)` throws `ProjectionInvariantError`. The projection is built from a validated event log; a duplicate add is a programming error in the calling layer, not user input. Same for `addEdge` and `addAnnotation`. (Idempotent "upsert" semantics would mask real bugs in the event-handling layer that owns this assumption.)
- **Removing a node implicitly removes its incident edges and annotations.** When `removeNode(id)` runs, every edge with that node as source or target is removed (and their indices cleared); every annotation targeting that node is also removed. This matches `docs/data-model.md` — visible-graph derivation: "When a node becomes invisible, every edge with that node as source or target becomes invisible automatically." Same cascade applies on `removeEdge(id)` for annotations targeting that edge. The cascade keeps callers honest — if the higher layer wants explicit removals it can `removeAnnotation` / `removeEdge` first and observe via `getEdge(id) === undefined` after, but the structure never holds an edge whose endpoint is gone.
- **Removing an unknown id is a no-op, not a throw.** `removeNode(unknown-id)` returns silently. The cascade above could hand back ids the caller has already processed; making the second cleanup throw would force the caller to track what it had already removed. This is the only mutator with no-op semantics — `addX` and `setXVisible` of an unknown id throw because they imply the caller expected the entity to exist.
- **Visibility is a flag, not a removal.** `setNodeVisible(id, false)` keeps the entity in the by-id map and in `getEdgesBySource` / `getEdgesByTarget`. The flag is what `docs/data-model.md`'s visible-graph derivation produces; `removeX` is the destructive op for true removal (e.g. when the entity is rolled back, never to return). The two operations are distinct: `removeX` for "the entity is gone from this projection," `setXVisible(false)` for "the entity exists in the projection but is currently hidden by the visibility rules."
- **Index getters return all entries, not visibility-filtered.** `getEdgesBySource(nodeId)` returns every edge in the index regardless of `visible`. Visibility filtering is a concern of the rendering and diagnostic layers (cycle detection runs against the visible subgraph; the moderator's debug view may want to see all). A `getVisibleEdgesBySource` is trivial to add later without re-shaping the index. Keeping the indices visibility-agnostic means downstream consumers can do either.
- **Per-participant facet state is a `Map<participantId, PerParticipantFacetState>` slot per facet on the entity record.** This task initialises the slot to an empty map; `per_facet_status_derivation` populates it. Same shape on nodes (classification + substance), edges (substance), and annotations (wording + substance, per `docs/data-model.md`). The keys are the participant user-ids that voted; absence of a key means "this participant has not voted on this facet's most recent proposal." Storing the per-participant entries on the entity (rather than in a separate map) keeps the invariants local — removing the entity automatically clears its facet state.
- **Axiom marks: `Map<participantId, AxiomMarkRecord>` slot per node.** Same shape rationale as per-participant facet state. `axiom_mark_logic` (methodology engine) and `per_facet_status_derivation` populate it; this task only initializes the slot to empty.
- **Derived facet-status fields default to `'proposed'` on `addX`.** The `wording`, `classification`, `substance` (where applicable) fields each carry a `FacetState` with `status: 'proposed'` and an empty per-participant agreement map at construction. `per_facet_status_derivation` and the methodology engine update them as votes / commits arrive. Initialising to `proposed` matches the data-model rule: "Operations that create new entities (...) produce entities whose facets each start as `proposed`." Wording is initialized to `proposed` here as well; the `project_from_log` task is responsible for transitioning it as the first commit lands.
- **`pendingProposals` is a `Map<proposalEventId, PendingProposal>`** (not a set), so the proposal payload is queryable by id. The values are referenced by vote and commit events. This task creates the map; population / removal (commit / meta-disagreement-marked) is owned by `project_from_log` and `per_facet_status_derivation`.
- **No DB-touching code, no event-handling code.** This task draws the line at "the rest of the projection sub-stream picks up the structure and writes events into it." A future change here is a structural one — adding an index, changing a slot's shape — not an event-rule change.
- **Property-style test uses a small custom generator.** The acceptance ask is "add N random distinct nodes, assert all are retrievable; remove a random subset, assert the remainder is intact." This is a one-page deterministic-seed test, not fast-check, matching the precedent in `apps/server/src/events/validate.test.ts`.

## Open questions

(none — all decided. Per-participant agreement *index shape* — e.g. "all entities pending a vote from participant P" — is owned by `per_facet_status_derivation`, not this task.)

## Status

**Done** 2026-05-10.

Implementation in `apps/server/src/projection/`:

- `types.ts` — `ProjectedNode`, `ProjectedEdge`, `ProjectedAnnotation`, `Projection` (interface), `FacetState`, `PerParticipantFacetState`, `AxiomMarkRecord`, `PendingProposal`.
- `projection.ts` — `Projection` class, `createEmptyProjection(sessionId)` factory, `ProjectionInvariantError`. Methods: `addNode`, `removeNode`, `addEdge`, `removeEdge`, `addAnnotation`, `removeAnnotation`, `setNodeVisible`, `setEdgeVisible`, `setAnnotationVisible`, `getNode`, `getEdge`, `getAnnotation`, `getEdgesBySource`, `getEdgesByTarget`, `getAnnotationsByNode`, `getAnnotationsByEdge`, `addPendingProposal`, `removePendingProposal`, `getPendingProposal`. Plus iterators `nodes()`, `edges()`, `annotations()` for replay tooling.
- `index.ts` — barrel re-export.

Tests: `apps/server/src/projection/projection.test.ts` — 22 cases covering empty-projection invariants, single-entity add/remove, duplicate-add throws, cascade-on-node-remove (incident edges + annotations), cascade-on-edge-remove (annotations only), index getters, visibility-flag semantics, pending-proposal map, and the property-style deterministic-random sweep.

`pnpm run test:smoke` green; `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `projection_data_structure`.
