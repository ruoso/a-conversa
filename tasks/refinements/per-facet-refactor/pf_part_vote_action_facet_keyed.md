# Participant vote action: facet-keyed

**TaskJuggler entry**: [tasks/15-per-facet-refactor.tji](../../15-per-facet-refactor.tji) — task `per_facet_refactor.participant_ui.pf_part_vote_action_facet_keyed`
**Effort estimate**: 0.5d
**Inherited dependencies**: `pf_facet_keyed_vote_payload`, `pf_vote_handler_facet_keyed`, `pf_part_detail_panel_three_facet_rows`.

## What this task is

Rewrite `apps/participant/src/detail/useVoteAction.ts` to send the new facet-keyed vote payload. The hook accepts an entity-target (a `(entity_kind, entity_id, facet)` triple) OR a proposal-target (a `proposal_id` for structural proposals). On send, it constructs the discriminated payload with the right `target` value and dispatches to `useWsClient().send('vote', payload)`.

Existing callers (the agree / dispute buttons in `ParticipantVoteButtons`) update to pass the entity-target shape per `pf_part_detail_panel_three_facet_rows`'s rewrite; the structural-proposal callers stay on the proposal-target shape.

## Why it needs to be done

The wire shape changes per [ADR 0030 §2](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md); the hook is the participant-side surface that constructs the new payload. Without this task, the new payload shape is consumed only by the moderator-side surfaces.

## Inputs / context

- [ADR 0030 §2 + Consequences](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md).
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — current hook.
- [`apps/participant/src/detail/useVoteAction.test.tsx`](../../../apps/participant/src/detail/useVoteAction.test.tsx) — existing tests (revised in-place).
- `pf_facet_keyed_vote_payload`, `pf_vote_handler_facet_keyed` (siblings) — the wire shape + the server's accept path.

## Constraints / requirements

- Hook signature accepts either an entity target `{ entity_kind, entity_id, facet }` or a proposal target `{ proposal_id }`. The hook constructs the payload with the matching `target` discriminator.
- `choice` argument is `'agree' | 'dispute'`. The withdraw gesture is no longer a vote choice (handled by `pf_part_withdraw_agreement_action`).
- In-flight state + lastError surfacing follow the prior hook's pattern.
- Existing Vitest cases at `useVoteAction.test.tsx` are revised against the new shape (per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). New cases assert the discriminator routing.

## Acceptance criteria

- Hook accepts both target shapes and constructs the matching payload.
- The `'withdraw'` choice is gone from the hook's API.
- Vitest covers both target paths.
- `pnpm run test:smoke` green; `make test` green; `tj3 project.tjp` parses clean.

## Decisions

- **One hook, two target shapes**, paralleling the discriminated payload. Splitting into two hooks (`useFacetVoteAction` + `useProposalVoteAction`) was considered; the single hook is simpler for the call site (it picks the target shape based on whether the row is facet-keyed or proposal-keyed; the hook handles dispatch).

## Open questions

(none — all decided per ADR 0030)
