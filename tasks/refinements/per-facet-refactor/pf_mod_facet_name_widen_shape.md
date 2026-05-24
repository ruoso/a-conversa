# Moderator FacetName: widen to include 'shape'

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_facet_name_widen_shape`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_shape_facet_wire_vote` (wire vocabulary already 4-valued).

## What this task is

Widen the moderator app's local `FacetName` mirror (currently 3-valued: `'wording' | 'classification' | 'substance'`) to include `'shape'`, propagating through ~10 consumers + a swath of exhaustive `switch` cases + test fixtures. Brings the moderator's local type alias in sync with the wire-level `facetNameSchema` (already 4-valued post `pf_shape_facet_wire_vote`).

## Why it needs to be done

Source of debt: [`pf_mod_edge_card_substance_affordance.md`](pf_mod_edge_card_substance_affordance.md) Status block + Decisions — the substance affordance's UI gate uses the simpler predicate `substance === 'awaiting-proposal'` rather than the stricter `shape ∈ {agreed, committed}` form because the moderator's `facetStatus.ts` mirror skips the shape facet entirely. Widening here lets the substance affordance (and any future edge-shape UI surface) use the strict predicate and removes the local / wire-level type drift.

**Low priority**: the server's `pf_sequence_gate_server_enforced` is the integrity boundary — the simpler UI predicate already admits the in-sequence case and lets the server reject anything else. This is a quality / consistency clean-up, not a correctness fix.

## Constraints / requirements

- Widen `FacetName` in the moderator app's local type alias (likely [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) and any sibling exports).
- Resolve every exhaustive `switch` over `FacetName` that becomes a compile error (~10 consumers including `proposalFacets.ts`, `HoverPopover.tsx`, the breakdown / pending-pane tests).
- Update affected tests to cover the new arm.
- Tighten the `pf_mod_edge_card_substance_affordance` gate predicate from `substance === 'awaiting-proposal'` to the strict `shape ∈ {agreed, committed}` form.

## Decisions

(none yet — to be settled at refinement time)

## Open questions

- Does the strict-predicate tightening also require the moderator's edge-shape commit affordance to be in place (i.e. does this task depend on `pf_mod_edge_shape_commit_affordance`)?

## Status

**Done** — 2026-05-24.

Moderator's `FacetName` widened from 3 to 4 values per ADR 0030's canonical wire enum (adds `'shape'`). The canonical `computeFacetStatuses` now tracks the edge shape facet directly, reading from `edge-created` events and the `(entity, facet)`-keyed vote/commit/withdraw stream. The narrow `edgeShapeStatus.ts` helper introduced by `pf_mod_edge_shape_commit_affordance` is retired — the canonical index serves both the commit and substance affordances.

Substance-affordance gate tightened to the strict `shape ∈ {agreed, committed} AND substance === 'awaiting-proposal'` form per ADR 0030 §8 (the predecessor task documented this as deferred debt; now closed).

Parity fix: `currentParticipants` in `facetStatus.ts` now excludes the moderator role so Rule 7 (the unanimous-agree → `'agreed'` transition) fires correctly on debater-only unanimity, matching the retired `deriveEdgeShapeStatus` helper's behavior.

`FACET_RENDER_ORDER` in `StatementNode` + `HoverPopover` narrows to `Exclude<FacetName, 'shape'>` with a defensive comment — shape lives on edges, not nodes, so the node-render order doesn't carry it.

Artifacts:

- `apps/moderator/src/graph/facetStatus.ts` — `FacetName` widened + shape-skip arms removed + edge-created shape seed + moderator-role filter on `currentParticipants`.
- `apps/moderator/src/graph/selectors.ts` — `shapeStatus` field removed; `deriveEdgeShapeStatus` call removed; shape-skip in `projectVotesByFacet` removed.
- `apps/moderator/src/graph/StatementEdge.tsx` — gate reads canonical index; substance gate tightened to strict.
- `apps/moderator/src/graph/StatementNode.tsx` + `HoverPopover.tsx` — `FACET_RENDER_ORDER` narrowed to `Exclude<FacetName, 'shape'>`.
- `apps/moderator/src/graph/EdgeShapeCommitAffordance.tsx` — comment update.
- `apps/moderator/src/graph/facetStatus.test.ts` — +5 shape-facet derivation tests.
- `apps/moderator/src/graph/selectors.test.ts` — fixture updates.
- `tests/e2e/methodology-full-flow.spec.ts` — Phase 5.8 defensively tolerant of shape-vote race.
- DELETED: `apps/moderator/src/graph/edgeShapeStatus.ts` + `edgeShapeStatus.test.ts`.

Verification:

- `pnpm run check` — green.
- `pnpm run test:smoke` — 4450 passing (net −8: −15 retired helper tests + +5 new derivation + +2 fixture-aligned existing), 0 skipped.
- `pnpm run test:behavior:smoke` — 263 / 1812 (unchanged).
- `pnpm run test:e2e:smoke` — 121 + 0 fixme (unchanged).
