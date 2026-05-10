# Resolution events

**TaskJuggler entry**: `data_and_methodology.event_types.resolution_events` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji)
**Effort estimate**: 0.5d
**Inherited dependencies**: `vote_events` (settled)

## What and why

Implement the two resolution event kinds — `commit` (moderator commits a proposal) and `meta-disagreement-marked` (last-resort fallback). These transition a proposal from `proposed` (or `disputed`) to its resolved state.

## Decisions

Two Zod schemas in `packages/shared-types`:

- **`CommitPayload`** — `{ proposal_id: UUID, moderator: UUID, committed_at: ISO8601 }`. Server-side checks: every participant is currently voting `agree`; only the moderator can commit; proposal exists and isn't already committed or meta-disagreed.
- **`MetaDisagreementMarkedPayload`** — `{ proposal_id: UUID, moderator: UUID, marked_at: ISO8601 }`. Carries both proposed values implicitly via the underlying proposal data.

Both added to the discriminated `EventPayload` union.

## Acceptance criteria

- Two Zod schemas exported from `packages/shared-types`.
- Round-trip tests.
- Validation rejects malformed UUIDs.
- Server-side referential and authority checks (separate from Zod) enforce the moderator-only / proposal-exists / no-double-resolve rules.

## Status

**Done** 2026-05-10.

`CommitPayload` and `MetaDisagreementMarkedPayload` Zod schemas land in `packages/shared-types/src/events.ts`, both registered in `eventPayloadSchemas` (replacing the placeholder passthroughs) and exported as TS types via `z.infer`. Field shape mirrors the vote schema's style: `z.string().uuid()` for `proposal_id` / `moderator`, `z.string().datetime({ offset: true })` for `committed_at` / `marked_at`. Round-trip + invalid-UUID + invalid-timestamp tests added in `packages/shared-types/src/events.test.ts`; the property-style "every kind round-trips" iterator now uses real payloads for both kinds. Server-side referential / authority checks remain pending in `event_validation` and the methodology engine.
