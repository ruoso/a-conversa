# Global entity creation events

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.event_types.entity_creation_events`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.event_types.event_base_envelope` (settled)

## What this task is

Implement the three global-entity-creation event kinds — `node-created`, `edge-created`, `annotation-created` — as Zod schemas and TS types under `packages/shared-types`. These events create rows in the global `nodes`, `edges`, and `annotations` tables.

## Why it needs to be done

Every node, edge, and annotation in the system originates from one of these events. The projection has to handle them; the WS protocol carries them; the validation pipeline rejects malformed ones.

## Inputs / context

From [docs/data-model.md — event types — global entity creation](../../../docs/data-model.md#global-entity-creation):

- `node-created` — payload: node id, wording, creator, timestamp.
- `edge-created` — payload: edge id, role, source-node-id, target-node-id, creator, timestamp.
- `annotation-created` — payload: annotation id, content, target-entity-id (node or edge), creator, timestamp.

Schema decisions already made (round 1 + round 2):

- Node `id`: UUID; `wording`: TEXT.
- Edge `id`: UUID; `role`: one of `supports` / `rebuts` / `qualifies` / `bridges-from` / `bridges-to` / `defines` / `contradicts`; `source_node_id`, `target_node_id`: UUIDs; unique on (role, source, target).
- Annotation `id`: UUID; `target_node_id` or `target_edge_id` (one nullable, exactly one non-null per CHECK); `kind`: TEXT with CHECK over `note`/`reframe`/`scope-change`/`stance`; `content`: TEXT.

These events typically co-occur with `entity-included` for the originating session (the node/edge/annotation is created globally and immediately referenced in the session that created it).

## Constraints / requirements

- Schemas live in `packages/shared-types` next to the session-lifecycle schemas.
- Validate strictly — UUID format, edge role enum, annotation kind enum, exactly-one-target for annotations.
- The annotation-created payload encodes the polymorphic-FK choice (R11 / option a): `target_node_id` and `target_edge_id` columns; exactly one non-null. Validate this in the Zod schema (refinement function).
- Edge endpoints must reference existing nodes — but that's a server-side referential check, not a payload-validation check. The Zod schema validates structural shape only.

## Acceptance criteria

- Three Zod schemas exported from `packages/shared-types`:
  - `NodeCreatedPayload` — `{ node_id: UUID, wording: string, created_by: UUID, created_at: ISO8601 }`.
  - `EdgeCreatedPayload` — `{ edge_id: UUID, role: EdgeRole, source_node_id: UUID, target_node_id: UUID, created_by: UUID, created_at: ISO8601 }` where `EdgeRole` is the union of the seven roles.
  - `AnnotationCreatedPayload` — `{ annotation_id: UUID, kind: AnnotationKind, content: string, target_node_id: UUID | null, target_edge_id: UUID | null, created_by: UUID, created_at: ISO8601 }`, with a Zod `.refine()` ensuring exactly one of `target_node_id` / `target_edge_id` is non-null.
- Each is in the discriminated `EventPayload` union.
- Round-trip tests for each payload.
- Validation rejects: malformed UUID, unknown edge role, unknown annotation kind, both target columns non-null on annotation, neither target column non-null on annotation.

## Decisions

- **Annotation polymorphic-FK encoding** carries from R11: two nullable typed columns + Zod `.refine()` enforcing exactly-one-non-null at validation time.
- **Edge role enum and annotation kind enum** exported as `z.enum(...)` from `packages/shared-types` so other code (WS messages, server validation, frontend rendering) imports the same single source of truth.

## Open questions

(none — implementation of well-specified kinds)
