# Moderator edge: shape-commit affordance

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_edge_shape_commit_affordance`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_shape_facet_wire_vote` (wire vocabulary), `pf_mod_edge_card_substance_affordance` (sibling mount surface).

## What this task is

Add a moderator-side commit-button affordance for the inline `edge.shape` facet on the `<StatementEdge>` label portal. Today the participant UI votes on `edge.shape` via the symmetric `__aConversaCyInstance` edge-tap branch, and the server-side facet-arm dispatch is pinned by `pf_shape_facet_wire_vote`, but the moderator console has no per-edge surface to commit the inline `edge.shape` facet once it reaches unanimity.

## Why it needs to be done

Source of debt: [`pf_mod_edge_card_substance_affordance.md`](pf_mod_edge_card_substance_affordance.md) Status block — methodology-full-flow Phase 5.7 is presently a tolerant no-op that accepts either `agreed` or `committed` as "settled" for the substance affordance's UI gate. Closing this debt makes Phase 5.7 a strict commit assertion symmetric with the node-card commit affordance.

## Constraints / requirements

- Commit button mounts on `<StatementEdge>`'s `<EdgeLabelRenderer>` portal, gated on the edge's shape facet being `'agreed'`.
- Reuses the facet-keyed commit dispatch already wired by `pf_commit_handler_facet_keyed`.
- Vitest covers the gate + send path; methodology-full-flow Phase 5.7 tightened from tolerant no-op to strict commit assertion.

## Decisions

(none yet — to be settled at refinement time)

## Open questions

- Mount placement relative to the substance affordance (stacked vs. inline)?

## Status

(pending)
