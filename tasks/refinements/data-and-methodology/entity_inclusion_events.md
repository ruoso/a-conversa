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

## Open questions

- **Should there be a `session_annotations` join table?** Per round 1 / round 2 we have `session_nodes` and `session_edges`. Annotations weren't separately tracked in M-N joins — they were assumed to ride along with their target. But annotations are first-class entities that go through the agreement workflow; an annotation might be referenced in session B even if its target node was originally created in session A. Having a `session_annotations` join would mirror nodes/edges cleanly.
  - **(a)** Add `session_annotations` as a third join table.
  - **(b)** Keep the implicit "annotations follow their target" rule.
  - **My instinct: (a) add a third join table.** Clean, mirrors nodes/edges, supports the cross-session-reference story for annotations the same way it does for nodes and edges. Out of scope as a schema change in this task — but the answer affects how `entity_kind: 'annotation'` is handled. **Awaiting input.**
