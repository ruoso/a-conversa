# Vote events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.vote_events`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.event_types.proposal_events` (settled)

## What this task is

Implement the `vote` event kind — a participant's stance (`agree` / `dispute` / `withdraw`) on a previously-issued proposal.

## Why it needs to be done

Per-facet, per-participant agreement tracking flows through votes. The commit step requires every participant to be voting `agree`. Withdrawal is a vote with value `withdraw` against an already-committed agreement.

## Inputs / context

From [docs/data-model.md — event types — votes](../../../docs/data-model.md#votes):

> `vote` — a participant signals their stance on a proposal. Payload: proposal id, participant, vote (agree | dispute | withdraw), timestamp. Withdraw applies only to a previously-agreed proposal and sends the facet/operation back to disputed.

## Decisions

- **Single Zod schema** in `packages/shared-types`:
  - `VotePayload` — `{ proposal_id: UUID, participant: UUID, vote: 'agree' | 'dispute' | 'withdraw', voted_at: ISO8601 }`.
- **Validation**: `vote` enum is constrained; the proposal_id must reference an existing proposal (server-side referential check, not Zod).
- **Withdrawal semantics**: server-side check that a `withdraw` vote is only valid against a participant's existing `agree` vote on a committed proposal.

## Acceptance criteria

- `VotePayload` Zod schema exported.
- Added to the discriminated `EventPayload` union.
- Round-trip test.
- Validation rejects: malformed UUIDs, unknown vote values.
