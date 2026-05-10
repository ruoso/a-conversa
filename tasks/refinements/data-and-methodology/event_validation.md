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

## Status

**Done** 2026-05-10 — server-side gate landed in `apps/server/src/events/validate.ts` (barrel: `apps/server/src/events/index.ts`). Wraps the shared-types `validateEvent` primitive and adds:

- A typed `EventValidationError` with stable, JSON-serializable shape: `{ name, message, code, kind, issues }`. `code` is one of `'envelope-invalid' | 'unknown-kind' | 'payload-invalid'`; `kind` carries the recovered kind string when discoverable (else `null`); `issues` is a flat `{ path, message, code }[]` lifted from Zod's issue list (payload-stage paths re-rooted with a `payload.` prefix so the path is unambiguous on the wire).
- Stage classification by message prefix (`event envelope failed validation` vs `payload for kind '...' failed validation` vs `no payload schema registered for kind`), since the underlying primitive runs the envelope and payload parses sequentially and the Zod issue paths alone don't disambiguate the stage.

37 tests cover acceptance for every registered kind, the envelope-level failure modes (id/sessionId UUIDs, missing/unknown kind, non-integer sequence, non-UUID actor, non-ISO createdAt), one payload-level failure per kind, the property-style sweep over the registry, and the JSON-serialization shape.

`apps/server` workspace gained a direct `zod` dependency (already a transitive dep via shared-types; promoted to direct so `ZodError` is type-safe in the wrapper). `shared-types` package.json gained `main` / `types` / `exports` entries so `@a-conversa/shared-types` resolves under NodeNext. Root `test:smoke` script extended from `vitest run tests/smoke packages` to also discover `apps/**` test files.

**Deferred wiring**: the actual `INSERT INTO session_events` caller is part of `backend.api_skeleton`. When that lands, the append path imports `validateEvent` from `@a-conversa/server/events` (or the in-tree relative path) and only proceeds to INSERT on a successful return. Cross-field referential checks (proposal_id refers to an existing proposal in this session, vote actor matches `participant`, etc.) are not part of payload validation and layer on later in the methodology engine.
