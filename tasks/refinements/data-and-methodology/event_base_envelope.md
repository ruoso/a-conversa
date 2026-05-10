# Common event envelope

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.event_base_envelope`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.schema.session_events_table` (settled)

## What this task is

Define the common TypeScript envelope shape for events appended to the `session_events` table. Every event — regardless of kind — shares this envelope; kind-specific data lives in the `payload` field. The envelope plus a per-kind discriminated union of payload schemas is the contract every event-emitting and event-consuming part of the codebase shares.

## Why it needs to be done

Every downstream event task (`session_lifecycle_events`, `entity_creation_events`, `proposal_events`, `vote_events`, `resolution_events`, `snapshot_events`) builds on this envelope. The projection runtime, the WS protocol, the change-history view, replay, test mode — all read events through this shape.

## Inputs / context

From [docs/data-model.md — change history](../../../docs/data-model.md#change-history):

> Each event records the actor, timestamp, and any payload specific to the event kind.

From [tasks/refinements/data-and-methodology/session_events_table.md](session_events_table.md):

The `session_events` table columns (per the schema decision):

- `id` — UUID, primary key.
- `session_id` — UUID, FK.
- `sequence` — BIGINT, monotonic per session.
- `kind` — TEXT with CHECK.
- `actor` — UUID FK to users (nullable for system-generated events, if any).
- `payload` — JSONB.
- `created_at` — timestamp.

The TS envelope mirrors this schema, with `payload` typed as a discriminated union by `kind`.

## Constraints / requirements

- Typed in TypeScript with an exhaustive discriminated union over `kind`.
- Exported from `packages/shared-types` (per `dir_layout`) so server, frontend surfaces, and tests share the same definition.
- Validated server-side at write time (per `session_events_table.md` R11 — schema-on-write).
- Each kind's payload has a JSON Schema (or equivalent) that the validation step runs against the JSONB payload before append.

## Acceptance criteria

- A `packages/shared-types` module exports:
  - `EventEnvelope<K>` generic type — the wrapper carrying `id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`, `createdAt`.
  - A discriminated union of all event kinds with their typed payloads.
  - JSON-schema definitions (or equivalent runtime validators) per kind.
- A round-trip test: a payload typed as kind `K` serializes to JSON, validates against the kind-`K` schema, deserializes, and equals the original.
- Used by the server's event-append code (downstream task) and by the WS message types (downstream task).

## Decisions

- **Envelope mirrors the table schema** — `id`, `sessionId`, `sequence`, `kind`, `actor`, `payload`, `createdAt`.
- **Payload typed as discriminated union by kind** — TypeScript's discriminated unions give exhaustive matching for switch statements, which is exactly what the projection runtime needs.
- **Lives in `packages/shared-types`** — server and clients share definitions.
- **Schema-on-write validation** (carries from session_events_table R11). The validation step runs before insert; invalid payloads are rejected.

## Open questions

- **Validation library.** Common choices for TypeScript JSON-schema-style validation:
  - **Zod** — TypeScript-native; types and runtime validators co-located; great DX. Schema definitions look like TS code.
  - **JSON Schema (ajv)** — language-agnostic schemas; widely used; schemas in JSON files. Heavier to author than Zod for TS-first code.
  - **TypeBox** — generates JSON Schema from TS-shaped definitions; bridges the two worlds.
  - **My instinct: Zod.** Co-located definitions, types and runtime validation in lockstep, lightweight runtime cost. JSON Schema export is possible if external systems need it (Zod has converters). **Awaiting input.**
- **Versioning.** As the event catalog evolves (new event kinds added, payloads change), how do we handle compatibility? **My instinct for v1: don't version yet.** The event log is append-only and the catalog is small; any change in v1 happens before there are real recordings. Revisit when there's a compatibility concern. **Awaiting input.**
