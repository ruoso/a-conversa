# Session lifecycle events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.session_lifecycle_events`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.event_types.event_base_envelope` (settled — Zod, no versioning, packages/shared-types)

## What this task is

Implement the four session-lifecycle event kinds — `session-created`, `session-ended`, `participant-joined`, `participant-left` — as Zod schemas (and the corresponding TypeScript types) under `packages/shared-types`. Wire them into the discriminated-union event catalog defined by `event_base_envelope`.

## Why it needs to be done

Every session begins with `session-created` and `participant-joined` events. The projection runtime, WS protocol, and replay all need these kinds to reconstruct who's in a session and when.

## Inputs / context

From [docs/data-model.md — event types — session lifecycle](../../../docs/data-model.md#session-lifecycle):

- `session-created` — payload: host, privacy (public/private), creation timestamp.
- `session-ended` — closes a session (deliberate end-of-show). Optional in v1.
- `participant-joined` — payload: participant id, role (moderator / debater-A / debater-B), screen name, timestamp.
- `participant-left` — affects derivation of "all current participants have agreed" for in-flight proposals.

The session-table schema (per `sessions_table.md`):

- `id`, `host_user_id`, `privacy` (TEXT with CHECK), `topic`, `created_at`, `ended_at`.

The session_participants schema (per `session_participants_table.md`):

- `session_id`, `user_id`, `role` (TEXT with CHECK), `joined_at`, `left_at`. Multiple rows per (session, user) under the leave-and-rejoin policy.

## Constraints / requirements

- Schemas live in `packages/shared-types`.
- Each schema is a Zod schema; the inferred TS type uses `z.infer<typeof X>`.
- The discriminated union over `kind` includes these four.
- Server validation rejects malformed payloads at append time (per `session_events_table.md` R11 — schema-on-write).
- Effects on the database (e.g., `session-created` writes a row to `sessions`) are the server's job; the schemas don't include side-effect logic — they're just payload shapes.

## Acceptance criteria

- Four Zod schemas exported from `packages/shared-types`:
  - `SessionCreatedPayload` — `{ host_user_id: UUID, privacy: 'public' | 'private', topic: string, created_at: ISO8601 }`.
  - `SessionEndedPayload` — `{ ended_at: ISO8601 }`.
  - `ParticipantJoinedPayload` — `{ user_id: UUID, role: 'moderator' | 'debater-A' | 'debater-B', screen_name: string, joined_at: ISO8601 }`.
  - `ParticipantLeftPayload` — `{ user_id: UUID, left_at: ISO8601 }`.
- Each schema has corresponding inferred TS types.
- Each is added to the discriminated `EventPayload` union by `kind`.
- Round-trip tests: a payload validates, serializes to JSON, deserializes, equals original.
- A property-based test that asserts every kind round-trips.

## Decisions

- **One Zod schema per kind**, all exported from `packages/shared-types`.
- **Schemas are payload-only** — the envelope (id, sessionId, sequence, kind, actor, created_at) is shared across all kinds and lives in the base envelope module.
- **`session-ended` payload includes `ended_at`** even though the session table has its own `ended_at` column — the event is the source of truth (per the event-sourced model); the column is a projection.
- **Timestamps: ISO 8601 strings.** Zod has no native datetime type; we serialize as strings and parse on the way in.

## Open questions

(none — straightforward implementation of the kinds defined in data-model.md)
