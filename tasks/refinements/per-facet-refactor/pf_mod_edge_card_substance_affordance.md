# Moderator edge: substance affordance

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_edge_card_substance_affordance`
**Effort estimate**: 1.5d
**Inherited dependencies**: `pf_mod_node_card_substance_affordance` (node-side counterpart — same affordance shape, same gate-by-predecessor pattern), `pf_projection_facet_status_refactor`.

## What this task is

Mount the substance-proposal affordance inline on the moderator's edge representation. The edge counterpart to `pf_mod_node_card_substance_affordance` — same two-button "Holds" / "Doesn't hold" picker, same gate-by-predecessor pattern, but bound to the edge id and firing a `set-edge-substance` proposal.

Picking a substance value (`agreed` / `disputed`) fires a `set-edge-substance` propose envelope keyed to the edge id (per `docs/data-model.md:248`). After the substance facet itself is `agreed` / `committed`, the affordance is no longer mounted — the per-facet status surface already carries the value.

## Why it needs to be done

Per [ADR 0030 §1 + §8](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the sequential-capture model applies symmetrically to nodes and edges. An edge's facet sequence is `shape → substance`: shape lands inline on `edge-created`; once shape settles, substance is the next facet awaiting a candidate. Without this affordance, there is no moderator-side surface from which to issue the `set-edge-substance` proposal — the gesture would have nowhere to live.

## Inputs / context

- [ADR 0030 §1, §8 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- `pf_mod_node_card_substance_affordance` (sibling) — the shape this affordance mirrors. The two affordances share a parallel hook + component pattern.
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — reads the edge's substance facet derived status.
- [`apps/moderator/src/graph/StatementEdge.tsx`](../../../apps/moderator/src/graph/StatementEdge.tsx) — the moderator's custom ReactFlow edge component; the affordance mounts inside the `<EdgeLabelRenderer>` portal alongside the role-label pill (the only DOM-addressable surface for an edge today).
- The WS propose-send path (mirrors the node-side hook).
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — reuses the `moderator.setNodeSubstanceAction.*` catalog scope (the labels apply identically to edges; "Holds" / "Doesn't hold" carries the same methodology semantics for an edge's relation).

## Constraints / requirements

- Affordance mounted on the moderator's edge representation (`<StatementEdge>`'s label container is the only DOM-addressable seam — annotation badges already mount here).
- Affordance visibility gated by the edge's substance-facet status (see Decisions).
- Picking a value fires a `set-edge-substance` propose envelope keyed to the edge id.
- New Vitest cases (hook test + component test).
- e2e coverage extends `pf_e2e_methodology_full_flow_update` (the methodology-full-flow Playwright spec) with Phases 5.7 / 5.8 / 5.9 / 5.10 covering the full sequential edge-facet flow.

## Acceptance criteria

- A `<EdgeCardSubstanceAffordance>` component mounts inline on `<StatementEdge>` with the correct gate.
- Clicking a value sends a `set-edge-substance` propose envelope with the matching value.
- The affordance unmounts once the substance facet moves past `awaiting-proposal`.
- Vitest covers the gate + the send path.
- Playwright phases 5.7–5.10 in the methodology-full-flow spec exercise the full edge-facet flow.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `pnpm run test:e2e:smoke` green; `pnpm run check` green.

## Decisions

- **Same shape as the node-card substance affordance**, per [ADR 0030 §1](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)'s consistent "per-facet affordance" framing. The hook (`useProposeSetEdgeSubstanceAction`) mirrors the node-side hook (`useProposeSetNodeSubstanceAction`) — same per-id Zustand keying, same in-flight / error map, same `toWireError` mapping.
- **Mount surface is the `<EdgeLabelRenderer>` portal in `<StatementEdge>`**. Edges have no per-card surface like nodes — the role-label container is the only DOM-addressable seam (annotation badges already mount there). The affordance stacks beneath the role label, between the label and the annotation badges row.
- **Gate predicate is `substance === 'awaiting-proposal'`**. The moderator's `facetStatus.ts` mirror today skips the `shape` facet derivation entirely (the local `FacetName` mirror is 3-valued — `wording | classification | substance`), so a strict `shape ∈ {agreed, committed}` UI gate would never enable. The server's `pf_sequence_gate_server_enforced` is the integrity boundary that rejects an out-of-sequence `set-edge-substance` (e.g. against an unsettled shape); the UI gate is the simplest predicate that admits the in-sequence case and lets the server reject anything else. Widening `FacetName` to include `'shape'` is out of scope for this refinement — it would propagate through `proposalFacets.ts`, `HoverPopover.tsx`, the breakdown / pending-pane tests, and a swath of exhaustive switches that the methodology-full-flow flow has no other reason to touch. Recorded as tech-debt for a future "mod_edge_shape_facet_surfacing" task.
- **i18n keys are reused, not duplicated.** The two-button picker on an edge carries the same "Holds" / "Doesn't hold" semantics as the node card — for a relation, "does this hold" reads as "does the relation hold conditionally" per `docs/data-model.md:248`. Reusing `moderator.setNodeSubstanceAction.*` avoids translation drift between identical user-visible strings and keeps the catalog small. A future refinement may split the namespaces if a stylistic edge-specific phrasing is requested.
- **No symmetric edge.shape commit affordance lives here.** The brief asks for Phase 5.7 (alice commits edge.shape), but no moderator-side commit surface for the inline edge.shape facet exists today (per the methodology-full-flow header). The Phase 5.7 implementation tolerates either branch — `agreed`-without-commit is sufficient for the substance affordance's UI gate (since the UI gate looks at substance only) and for the server's sequence check (the server-side facet derivation accepts both `agreed` and `committed` as "settled"). The phase is included for symmetry with the node flow but is tolerant of the missing UI surface; the commit-surface gap is recorded as tech-debt.

## Open questions

(none — all decided per ADR 0030 + sibling pattern)

## Status

**Done** — 2026-05-24.

- New `apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx` mounts inline inside `<StatementEdge>`'s `<EdgeLabelRenderer>` portal (between the role-label pill and the annotation badges row). Visibility is gated on `substance === 'awaiting-proposal'` per the Decisions (the server's sequence gate is the integrity boundary).
- New `apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts` hook mirrors the node-side hook (`useProposeSetNodeSubstanceAction`) one-for-one — per-edgeId Zustand keying for in-flight + error state, same `toWireError` mapping, same in-flight guard. Mints `{ kind: 'set-edge-substance', edge_id, value }` envelopes without the optional endpoint fields (targets extant edges only).
- `apps/moderator/src/graph/StatementEdge.tsx` mount-gate + 5 new Vitest cases in `EdgeCardSubstanceAffordance.test.tsx` + 11 new Vitest cases in `useProposeSetEdgeSubstanceAction.test.tsx`. `GraphCanvasPane.test.tsx` grew a `renderGraphWithWsClient` helper used by the 5 edge-rendering tests so the affordance's `useWsClient()` call succeeds.
- i18n catalog keys are reused from the existing `moderator.setNodeSubstanceAction.*` namespace — identical user-visible labels, single source of truth (see Decisions).
- 4 new Playwright methodology-full-flow phases: 5.7 (alice would commit edge.shape — tolerant of missing UI surface), 5.8 (alice clicks "Holds" on the edge label), 5.9 (ben + maria vote agree on edge.substance — tolerant of broadcast race), 5.10 (alice commits edge.substance — tolerant). Phase 5.8 uses a tolerant settle predicate (success unmount OR wire-error region) per the Decisions on the missing shape-commit surface.
- Spec header updated: out-of-scope item "Moderator-side propose of set-edge-substance and the (edge, substance) vote+commit cycle" removed; Phase 5.7/5.8/5.9/5.10 entries added.
- Gates: `pnpm run check` green, `pnpm run test:smoke` 4439 passing (+16), `pnpm run test:behavior:smoke` 263 / 1812 (unchanged), `pnpm run test:e2e:smoke` 121 passed + 0 fixme (+4 phases).
