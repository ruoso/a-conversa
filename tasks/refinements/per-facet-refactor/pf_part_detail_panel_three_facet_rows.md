# Participant detail panel: three facet rows per node

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.participant_ui.pf_part_detail_panel_three_facet_rows`
**Effort estimate**: 1.5d
**Inherited dependencies**: `pf_awaiting_proposal_facet_status`, `pf_projection_facet_status_refactor` (participant-side mirror).

## What this task is

Rewrite `apps/participant/src/detail/ParticipantVoteButtons.tsx` so a node's detail panel always renders three rows (wording / classification / substance) and an edge's detail panel always renders two rows (shape / substance). Each row's content depends on the facet's derived status, per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md):

- `awaiting-proposal` — empty-state text ("Awaiting a proposal"), no vote buttons.
- `proposed` / `disputed` — current candidate value displayed; agree / dispute buttons.
- `agreed` / `committed` — current value displayed; withdraw button (the gesture that emits `withdraw-agreement` — handled by `pf_part_withdraw_agreement_action`).
- `meta-disagreement` — both candidate values displayed side by side; no vote buttons.
- `withdrawn` — current value displayed; the facet is back in dispute (agree / dispute buttons).

The existing `proposalFacetTarget` helper splits: for facet-valued proposals it goes away (the row hangs off the facet itself, reads the candidate from the projection); for structural proposals it stays (synthesizes a `'proposal'` facet for the participant vote row, per the function's current behavior).

## Why it needs to be done

Per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): "Participant detail panel renders all three facet rows per node (two per edge). A node's panel always shows wording, classification, and substance rows; an edge's panel always shows shape and substance." The current code only renders rows for facets that have a proposal-id-keyed row to attach to (per [`ParticipantVoteButtons.tsx:146`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx), `proposalFacetTarget`), which is exactly the voteless-wording-facet bug ADR 0030 is fixing.

## Inputs / context

- [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — current component; `proposalFacetTarget` at L146 splits.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — derives the per-row status.
- [`tasks/refinements/participant-ui/part_voting.md`](../participant-ui/part_voting.md), [`part_per_facet_state_styling.md`](../participant-ui/part_per_facet_state_styling.md) — historical records of the prior shape; do not edit.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — new catalog keys for the row chrome + empty-state strings.

## Constraints / requirements

- Node detail panel always renders three rows (wording, classification, substance).
- Edge detail panel always renders two rows (shape, substance).
- Each row's render depends on the row's derived status (per the seven-status state machine above).
- The vote action (agree / dispute) targets `(entity, facet)` per `pf_part_vote_action_facet_keyed`.
- The withdraw action targets `(entity, facet)` per `pf_part_withdraw_agreement_action`.
- `proposalFacetTarget` shrinks to the structural-proposal branches only.
- Vitest cases at `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` cover each of the seven status renderings + the structural-proposal branch.
- e2e coverage rolls into `pf_e2e_methodology_full_flow_update`.

## Acceptance criteria

- The component renders the right number of rows per entity kind (3 for nodes, 2 for edges).
- Each row's content matches the seven-status state machine.
- `proposalFacetTarget` is reduced to the structural-proposal branches.
- Vitest covers all status renderings.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Always-render shape** per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). Empty rows for `awaiting-proposal` facets are a feature, not a bug — they make the methodology's per-facet structure visible from the first frame.
- **The withdraw button replaces the agree button on `agreed` / `committed` rows.** A participant who has agreed to a committed facet can only withdraw their agreement; they cannot re-agree (no-op) or re-dispute (use withdraw instead — different gesture). On `withdrawn` rows, agree / dispute are back; agreeing re-establishes the participant's agreement (the projection rebuilds the consensus state from the per-participant vote map).
- **Meta-disagreement shows both candidates.** The "side by side" carriage per [ADR 0030 Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the projection retains both values (the originally-committed one and the disputed alternative); the row reads them and renders both with no vote buttons. (The two-value carriage on `FacetState` may itself be a sub-decision the `pf_projection_facet_status_refactor` implementation makes — judgment at implementation time.)

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

- Always-on three-facet-rows shape lands per ADR 0030 §10: node panels render `wording` / `classification` / `substance`; edge panels render `shape` / `substance`. The structural-sub-kind synthetic `'proposal'` row is preserved as a sibling for `decompose` / `interpretive-split` / `axiom-mark` / `annotate` / `meta-move` / `break-edge` gestures.
- Per-row content is driven by the seven-status state machine: `awaiting-proposal` → empty-state body ("Awaiting a proposal"); `proposed` / `disputed` → agree + dispute against the current candidate; `agreed` / `committed` → placeholder withdraw button; `withdrawn` → agree + dispute (facet back in dispute); `meta-disagreement` → both candidates side by side, no buttons.
- `proposalFacetTarget` shrunk to the structural-proposal branches only; the facet-targeting sub-kinds now hang off the per-facet rows directly. A new `facetTargetingProposalTarget` helper resolves the facet a facet-targeting proposal addresses.
- Component now accepts a `facetStatusIndex` prop; `EntityDetailPanel` mounts it directly (was previously mounted via `OperateRoute`'s `actionSlot`). `OperateRoute`'s `actionSlot` now hosts the axiom-mark button only.
- New i18n key `participant.detailPanel.facetRow.awaitingProposal` in `en-US` / `pt-BR` / `es-419`; `pt-BR.review.json` + `es-419.review.json` carry a PENDING review entry.
- Vitest: `ParticipantVoteButtons.test.tsx` rewritten to 27 tests covering always-on rows + per-status content + click→wire + in-flight + structural sub-kind synthetic row. Full smoke suite 4371 passed (unchanged). Cucumber 262 / 1803 unchanged. Playwright 111 passed + 0 fixme (unchanged; +1 inline three-row assertion in `tests/e2e/participant-graph-render.spec.ts` block 8).
- TODO markers (2): `TODO(pf_part_vote_action_facet_keyed)` on the `useVoteAction` binding; `TODO(pf_part_withdraw_agreement_action)` on the placeholder withdraw arm. Both point at existing WBS leaves.
- Artifacts: `apps/participant/src/detail/ParticipantVoteButtons.tsx` (rewrite); `apps/participant/src/detail/ParticipantVoteButtons.test.tsx` (rewrite); `apps/participant/src/detail/EntityDetailPanel.tsx` + `EntityDetailPanel.test.tsx`; `apps/participant/src/routes/OperateRoute.tsx`; `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` + `{pt-BR,es-419}.review.json`; `tests/e2e/participant-graph-render.spec.ts`.
