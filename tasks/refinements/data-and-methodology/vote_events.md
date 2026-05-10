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

## Status

**Done** 2026-05-10.

- `votePayloadSchema` in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) reconciled to the canonical refinement shape: `{ proposal_id: UUID, participant: UUID, vote: 'agree' | 'dispute' | 'withdraw', voted_at: ISO8601 }`. `VotePayload` is exported via `z.infer`. The schema is registered as `eventPayloadSchemas['vote']`; the `EventPayloadMap['vote']` entry resolves to `VotePayload`.
- **Field-rename reconciliation from the original worked example** (`event_base_envelope` shipped a placeholder-quality `vote` schema while waiting for this task): `proposal_event_id` → `proposal_id`, `participant_id` → `participant`, plus the new `voted_at: ISO8601` field. ADR 0021 carried the worked-example field names in its narrative; an Amendment was appended to record the reconciliation rather than rewriting the body.
- Tests in [`packages/shared-types/src/events.test.ts`](../../../packages/shared-types/src/events.test.ts) updated: round-trip on the new shape; happy + invalid `voted_at` (non-ISO and missing); `proposal_id` and `participant` UUID checks; the `every kind round-trips` representative payload for `vote` updated. All other tests still pass; `pnpm run test:smoke` is green (113 tests).
- **Out of scope here, owned by `event_validation` / methodology engine**: the server-side referential check that `proposal_id` references an existing proposal in the same session, and the withdrawal-against-prior-agree check.
