# Validate event payloads against schema before append

**TaskJuggler entry**: `data_and_methodology.event_types.event_validation` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji)
**Effort**: 1d

## What and why

Centralize event payload validation. Every event passes through this gate before being appended to `session_events`. Schema-on-write per R11; rejects malformed payloads early so the projection only ever sees valid events.

## Decisions

- Module lives in `apps/server/src/events/validate.ts`.
- Validates the envelope (id, sessionId, sequence, kind, actor, timestamp) AND the kind-specific payload via the appropriate Zod schema from `packages/shared-types`.
- Throws a typed `EventValidationError` with field-level details on failure.
- Server's append code calls this synchronously before INSERT — invalid events never persist.
- Property-based test: random payloads of every kind validate or reject as expected.

## Acceptance criteria

- `validate.ts` exports `validateEvent(envelope, payload)` returning a typed result or throwing `EventValidationError`.
- All eleven proposal kinds plus the lifecycle / creation / inclusion / vote / resolution / snapshot kinds are covered.
- Property-based tests confirm coverage.
- Server's append path uses this; tests verify invalid events don't reach the DB.
