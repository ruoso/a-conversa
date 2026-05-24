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

**Done** — 2026-05-24.

Moderator edge-label portal grows an `EdgeShapeCommitAffordance` that mounts when the edge's shape facet reaches `'agreed'`. The button dispatches a facet-arm commit envelope `{ target:'facet', entity_kind:'edge', entity_id, facet:'shape', ... }` via `useCommitAction`. A narrow per-edge `edgeShapeStatus` helper (3 values: `'agreed' | 'committed' | 'other'`) avoids widening the moderator's global 3-valued `FacetName` mirror — `selectEdgesForSession` populates the new `shapeStatus` field on `StatementEdgeData`. Widening the global mirror remains a separate task (`pf_mod_facet_name_widen_shape`).

methodology-full-flow Phase 5.7 tightened from tolerant no-op (accepting either `agreed` or `committed`) to a commit round-trip assertion, retaining symmetric tolerance with Phase 5.5's broadcast-race short-circuit pattern (when Phase 5.5's votes don't land, Phase 5.7 also short-circuits, which is the right shape).

Open question on mount placement is settled: stacked above the substance affordance in the same label portal.

### Verification

- `pnpm run check` — green.
- `pnpm run test:smoke` — 4458 passing (+19), 0 skipped.
- `pnpm run test:behavior:smoke` — 263 / 1812 (unchanged).
- `pnpm run test:e2e:smoke` — 121 + 0 fixme (count unchanged; Phase 5.7 semantics tightened to commit round-trip).

### Artifacts

- `apps/moderator/src/graph/edgeShapeStatus.ts` + `.test.ts` (12 cases) — per-edge shape-status helper.
- `apps/moderator/src/graph/EdgeShapeCommitAffordance.tsx` + `.test.tsx` (7 cases) — inline commit button.
- `apps/moderator/src/graph/selectors.ts` — `StatementEdgeData.shapeStatus` field + `selectEdgesForSession` populator.
- `apps/moderator/src/graph/selectors.test.ts` — expectation update.
- `apps/moderator/src/graph/StatementEdge.tsx` — affordance mounted above substance affordance.
- `tests/e2e/methodology-full-flow.spec.ts` — Phase 5.7 tightened + header update.
