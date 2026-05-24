# Moderator pending-proposals pane: facet-keyed

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.moderator_ui.pf_mod_pending_proposals_pane_facet_keyed`
**Effort estimate**: 1d
**Inherited dependencies**: `pf_projection_facet_status_refactor` (moderator-side mirror), `pf_commit_handler_facet_keyed` (commit envelope shape).

## What this task is

Rewrite the moderator's pending-proposals pane to read the new facet-keyed projection. The pane shows, for each entity with at least one non-`agreed` / non-`committed` facet, the per-facet rows with their current candidate values, vote counts, and per-row commit buttons. The structural proposals (decompose / interpretive-split / axiom-mark / annotate / meta-move / break-edge) continue to render as proposal-keyed rows (per `pf_structural_handlers_unchanged`).

The commit button on a facet row sends a `commit` envelope with `target: 'facet'` and the `(entity_kind, entity_id, facet)` triple. The commit button on a structural-proposal row sends a `commit` with `target: 'proposal'` and the proposal id. The pane's component code reads these from the projection and dispatches accordingly.

## Why it needs to be done

The pending-proposals pane is the moderator's primary view of in-flight agreement work. After the wire change, "what's in flight" is no longer a list of proposals — it's a list of facets-with-candidates. Per [ADR 0030 §2 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md), the pane has to map the new projection shape to the moderator's commit-and-resolve loop.

## Inputs / context

- [ADR 0030 §2, §9 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/moderator/src/`](../../../apps/moderator/src/) — pending-proposals pane component (exact filename to identify at implementation time; likely under `apps/moderator/src/pendingProposals/` or similar).
- [`apps/moderator/src/graph/facetStatus.ts`](../../../apps/moderator/src/graph/facetStatus.ts) — moderator-side `deriveFacetStatus`.
- [`tasks/refinements/moderator-ui/mod_pending_proposals_pane.md` family](../moderator-ui/) — historical record of the prior shape (do not edit). The five existing leaves (`mod_proposal_list`, `mod_per_facet_breakdown`, `mod_vote_indicators_in_sidebar`, `mod_commit_button`, `mod_proposal_filter_search`) are all `complete 100`; this task's refactor lands on top of them.
- The WS client commit-send path; the existing `useCommitAction` (or equivalent) hook is updated to support the discriminated payload (or replaced with two narrower hooks — `useFacetCommitAction` + `useProposalCommitAction`).

## Constraints / requirements

- Pane lists entities with non-settled facets; each row shows the per-facet status, candidate value, vote tallies, and a per-row commit button (visible when status is `'agreed'`).
- Structural proposals render as their own row group; their commit buttons target the proposal id.
- Filter / search affordances from the existing pane carry through (re-validated against the new data shape).
- Vitest cases at the pane's test file cover: facet-target rows render with correct status; structural-target rows render alongside; commit button fires the right envelope shape.
- e2e coverage rolls into `pf_e2e_methodology_full_flow_update`.

## Acceptance criteria

- Pane displays facet-keyed rows + structural-keyed rows correctly.
- Per-row commit buttons fire the correct envelope shape.
- Filter / search still works.
- Vitest covers both row types + the commit-dispatch path.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **Two row shapes coexist in the same pane**, with a clear visual divider (or section labels) between facet-keyed and structural-keyed work. The shape mirrors the underlying mixed-model decision in [ADR 0030 §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- **Commit button per row, not per proposal.** The unit of commit is now the facet (for facet-valued work) or the structural proposal (for structural work); the pane's primary affordance follows the unit.
- **The existing five pane sub-tasks are not re-opened.** This task's refactor lands on top of their delivered surface; their refinements are historical records.

## Open questions

(none — all decided per ADR 0030)

## Status

**Done** — 2026-05-24.

Moderator pending-proposals pane now dispatches per-row commits via a facet-or-proposal-arm wire envelope per [ADR 0030 §2 + §9](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md). The WS commit schema is a discriminated union; the server resolves facet-arm commits via `candidateProposalEventId` with a `capture-node` log-walk fallback symmetric to the vote handler. methodology-full-flow Phase 2.3 (alice's capture-node commit) flows through the facet-arm path end-to-end.

Artifacts:

- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `wsCommitPayloadSchema` split into facet/proposal `discriminatedUnion('target', ...)`.
- [`apps/server/src/ws/handlers/commit.ts`](../../../apps/server/src/ws/handlers/commit.ts) — dispatch on `payload.target`; facet-arm resolves `candidateProposalEventId` with capture-node log-walk fallback.
- [`apps/moderator/src/layout/useCommitAction.ts`](../../../apps/moderator/src/layout/useCommitAction.ts) — dual-arm rewrite; per-slot Zustand keying mirroring `useVoteAction`.
- [`apps/moderator/src/layout/PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) — `commitTargetForProposal` helper; row `useCommitAction` bound to the correct arm.
- Tests: [`apps/moderator/src/layout/useCommitAction.test.tsx`](../../../apps/moderator/src/layout/useCommitAction.test.tsx), [`apps/moderator/src/layout/PendingProposalsPane.test.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.test.tsx), [`apps/server/src/ws/handlers/commit.test.ts`](../../../apps/server/src/ws/handlers/commit.test.ts), [`tests/behavior/backend/ws-commit.feature`](../../../tests/behavior/backend/ws-commit.feature), [`tests/behavior/steps/backend-ws-commit.steps.ts`](../../../tests/behavior/steps/backend-ws-commit.steps.ts).

Verification: `pnpm run check` green; `pnpm run test:smoke` 4423 passing (+4); `pnpm run test:behavior:smoke` 263 scenarios / 1812 steps (+1 / +9); `pnpm run test:e2e:smoke` 114 + 0 fixme (unchanged).
