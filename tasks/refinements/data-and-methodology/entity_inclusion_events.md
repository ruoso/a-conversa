# Session inclusion events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.entity_inclusion_events`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.event_types.event_base_envelope` (settled)

## What this task is

Implement the `entity-included` event kind — the event that records "session S begins referencing global entity E." Adds a row to either `session_nodes` or `session_edges`.

## Why it needs to be done

Cross-session reference (the M-N relationship between sessions and global graph entities) flows through this event. Whenever a session creates a node/edge/annotation, an `entity-included` event fires too; whenever a session imports an existing entity from another session (per `cross_session_permissions`), a standalone `entity-included` event fires.

## Inputs / context

From [docs/data-model.md — event types — session inclusion](../../../docs/data-model.md#session-inclusion):

> `entity-included` — the session begins referencing an existing global entity. Payload: session id, entity-id, by-whom, timestamp.

The session_nodes / session_edges schema (per round 2):

- `session_nodes`: composite PK `(session_id, node_id)`, plus `included_by`, `included_at`.
- `session_edges`: composite PK `(session_id, edge_id)`, plus `included_by`, `included_at`.

Annotations are a third global-entity kind; they also need session inclusion. Currently the schema doesn't have a `session_annotations` table — that may need to be added during this work, or annotations may piggyback on their target's inclusion (since an annotation's target is always a node or edge that's already in `session_nodes` / `session_edges`).

## Constraints / requirements

- Schema lives in `packages/shared-types`.
- Distinguishes the entity kind being included (node / edge / annotation) — the event applies to the right table.
- Validates UUID and timestamp shape.
- Server-side referential check (the entity exists, the session is active, the user has permission to include) is separate from payload validation.

## Acceptance criteria

- `EntityIncludedPayload` Zod schema exported from `packages/shared-types`:
  - `{ entity_kind: 'node' | 'edge' | 'annotation', entity_id: UUID, included_by: UUID, included_at: ISO8601 }`.
- Added to the discriminated `EventPayload` union.
- Round-trip tests.
- Validation rejects: malformed UUIDs, unknown entity kinds.

## Decisions

- **Single payload schema with `entity_kind` discriminator.** Cleaner than three separate kinds (`node-included` / `edge-included` / `annotation-included`); the table-write logic switches on `entity_kind`.

## Additional decisions

- **`session_annotations` is a third M-N join table** mirroring `session_nodes` and `session_edges` (R26). Annotations are first-class graph entities and get the same cross-session-reference treatment as nodes and edges. The schema task lives at `data_and_methodology.schema.session_annotations_join_table` (added to the WBS in round 4); the refinement is at [tasks/refinements/data-and-methodology/session_annotations_join_table.md](session_annotations_join_table.md).
- The `entity-included` event with `entity_kind: 'annotation'` writes to `session_annotations`.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10 — `EntityIncludedPayload` Zod schema and `entityKindSchema` enum added to `packages/shared-types/src/events.ts`; registered in `eventPayloadSchemas` (replacing the placeholder); `EventPayloadMap['entity-included']` tightened to the inferred type. Tests added in `packages/shared-types/src/events.test.ts`: round-trip per `entity_kind` (node / edge / annotation), invalid UUID via `validateEvent`, and unknown-kind (`'attribute'`) rejection; representative payload in the property-style iterator updated from `{}` to a concrete value. Server-side join-table dispatch (`entity_kind` → `session_nodes` / `session_edges` / `session_annotations`) is deferred to `event_validation` / `backend.api_skeleton`.
