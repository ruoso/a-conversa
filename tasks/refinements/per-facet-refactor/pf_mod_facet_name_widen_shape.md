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

(pending)
