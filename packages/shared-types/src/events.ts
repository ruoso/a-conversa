// Event envelope and per-kind payload schema registry.
//
// Refinement: tasks/refinements/data-and-methodology/event_base_envelope.md
// ADR: docs/adr/0021-event-envelope-discriminated-union-with-zod.md
// TaskJuggler: data_and_methodology.event_types.event_base_envelope
//
// This module defines the canonical envelope shape for every event
// appended to the `session_events` table (apps/server/migrations/
// 0010_session_events.sql), the discriminated-union `Event` type
// downstream code switches on, and a per-kind payload schema registry
// that downstream `event_types.*` tasks fill in.
//
// Today's task delivers the *building blocks*:
//
//   - The envelope type + Zod schema.
//   - The discriminated-union shape (`Event = EventEnvelope<K>` over
//     all `K`).
//   - The registry pattern with placeholder schemas
//     (`z.object({}).passthrough()`) for each of the 13 kinds, plus
//     two **worked examples** (`session-created` and `vote`) that
//     demonstrate the discriminated-union shape works end-to-end.
//   - `validateEvent(envelope)` — parses the outer envelope, looks
//     up the payload schema by `kind`, parses the payload, returns
//     the typed `Event`. The schema-on-write step (the
//     `event_validation` task) calls this before insert.
//
// **What downstream tasks do** — each `event_types.*` task tightens
// its kinds' placeholder schemas in `eventPayloadSchemas` below:
//
//   - `session_lifecycle_events` → `session-created`, `session-ended`,
//     `participant-joined`, `participant-left` (**done** —
//     tightened below; reconciled the worked-example `ts` field on
//     `session-created` to `created_at` per the refinement).
//   - `entity_creation_events` → `node-created`, `edge-created`,
//     `annotation-created`.
//   - `entity_inclusion_events` → `entity-included`.
//   - `proposal_events` → `proposal` (with payload-internal `kind`
//     discriminator over the 11 proposal sub-kinds).
//   - `vote_events` → `vote` (the `vote` schema here is a worked
//     example; that task may refine it).
//   - `resolution_events` → `commit`, `meta-disagreement-marked`.
//   - `snapshot_events` → `snapshot-created`.
//
// **No event versioning in v1** (R20). The envelope omits a `version`
// field. Adding one later is a non-breaking shape change (optional
// field on the envelope schema, registry can dispatch on
// `(kind, version)` instead of just `kind`). The revisit trigger is
// the first time we want to replay a recorded log against a server
// whose schema has changed.
//
// **Sequence is `number` not `bigint`**. The DB column is BIGINT.
// JS `number` is safe up to 2^53 (~9e15) — well beyond any plausible
// per-session event count. If a single session ever crosses 2^53
// events, this widens to `bigint`; recorded as a known ceiling, not
// an immediate concern.

import { z } from 'zod';

// -- Event kinds ------------------------------------------------------
//
// Mirrors the CHECK constraint in `apps/server/migrations/
// 0010_session_events.sql` exactly. If a kind is added to or removed
// from the SQL CHECK, this list must change in lockstep.

export const eventKinds = [
  // Session lifecycle
  'session-created',
  'session-ended',
  'participant-joined',
  'participant-left',
  // Global entity creation
  'node-created',
  'edge-created',
  'annotation-created',
  // Session inclusion
  'entity-included',
  // Proposals (single envelope kind; payload.kind discriminates)
  'proposal',
  // Votes
  'vote',
  // Resolutions
  'commit',
  'meta-disagreement-marked',
  // Snapshots
  'snapshot-created',
] as const;

export type EventKind = (typeof eventKinds)[number];

export const eventKindSchema = z.enum(eventKinds);

// -- Per-kind payload schemas: registry + worked examples -------------
//
// The registry is a `Record<EventKind, z.ZodTypeAny>`. Today every
// kind maps to either a tight schema owned by a completed
// `event_types.*` task or a placeholder (`z.object({}).passthrough()`
// — accepts any object so writers aren't blocked while downstream
// tasks finalize their kinds). Each downstream `event_types.*` task
// replaces its kinds' entries with a tight schema.

// -- Session lifecycle event payload schemas --------------------------
//
// Owned by `session_lifecycle_events`. Refinement:
// tasks/refinements/data-and-methodology/session_lifecycle_events.md.
//
// Field naming:
//   - UUID columns use `z.string().uuid()`.
//   - Timestamps are ISO-8601 strings (`z.string().datetime({ offset: true })`).
//   - Per-event timestamp field names mirror the `sessions` and
//     `session_participants` projection columns (`created_at`,
//     `ended_at`, `joined_at`, `left_at`) so the event payload reads
//     as the source of truth and the projection is a pure copy.
//
// **Reconciliation note**: ADR 0021 originally documented the
// `session-created` worked example with a `ts` field. The
// `session_lifecycle_events` refinement is canonical and uses
// `created_at` (matching the `sessions.created_at` column it
// projects). The schema below uses `created_at`.

export const sessionCreatedPayloadSchema = z.object({
  host_user_id: z.string().uuid(),
  privacy: z.enum(['public', 'private']),
  topic: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

export type SessionCreatedPayload = z.infer<typeof sessionCreatedPayloadSchema>;

export const sessionEndedPayloadSchema = z.object({
  ended_at: z.string().datetime({ offset: true }),
});

export type SessionEndedPayload = z.infer<typeof sessionEndedPayloadSchema>;

export const participantJoinedPayloadSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['moderator', 'debater-A', 'debater-B']),
  screen_name: z.string(),
  joined_at: z.string().datetime({ offset: true }),
});

export type ParticipantJoinedPayload = z.infer<typeof participantJoinedPayloadSchema>;

export const participantLeftPayloadSchema = z.object({
  user_id: z.string().uuid(),
  left_at: z.string().datetime({ offset: true }),
});

export type ParticipantLeftPayload = z.infer<typeof participantLeftPayloadSchema>;

// -- Entity creation event payload schemas ---------------------------
//
// Owned by `entity_creation_events`. Refinement:
// tasks/refinements/data-and-methodology/entity_creation_events.md.
//
// Three kinds — `node-created`, `edge-created`, `annotation-created` —
// each materialize one row in the global `nodes` / `edges` /
// `annotations` tables (see apps/server/migrations/0004_nodes.sql,
// 0005_edges.sql, 0006_annotations.sql). The Zod field names mirror
// the SQL columns 1:1 so the payload reads as the source of truth and
// the projection is a pure copy.
//
// Two enums are exported at the top level — `edgeRoleSchema` and
// `annotationKindSchema` — because downstream `proposal_events` will
// reuse them (e.g. `set-edge-substance` carries an edge role; an
// annotation-related proposal carries the kind). Single source of
// truth: changing a value here keeps the payload schemas, the
// proposal payloads, and any consuming UI in sync. The string lists
// mirror the SQL CHECK constraints exactly — drift here would let
// payloads validate but inserts fail.

/**
 * Edge role enum. Mirrors the CHECK constraint on `edges.role` in
 * `apps/server/migrations/0005_edges.sql` exactly.
 */
export const edgeRoleSchema = z.enum([
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
]);

export type EdgeRole = z.infer<typeof edgeRoleSchema>;

/**
 * Annotation kind enum. Mirrors the CHECK constraint on
 * `annotations.kind` in `apps/server/migrations/0006_annotations.sql`
 * exactly.
 */
export const annotationKindSchema = z.enum(['note', 'reframe', 'scope-change', 'stance']);

export type AnnotationKind = z.infer<typeof annotationKindSchema>;

export const nodeCreatedPayloadSchema = z.object({
  node_id: z.string().uuid(),
  // `nodes.wording` is TEXT NOT NULL with no DB-level length cap. The
  // Zod `min(1)` rejects the empty string (a UI-visible "blank node"
  // is not meaningful). No upper cap here; UIs can impose a soft
  // display limit.
  wording: z.string().min(1),
  created_by: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

export type NodeCreatedPayload = z.infer<typeof nodeCreatedPayloadSchema>;

export const edgeCreatedPayloadSchema = z.object({
  edge_id: z.string().uuid(),
  role: edgeRoleSchema,
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

export type EdgeCreatedPayload = z.infer<typeof edgeCreatedPayloadSchema>;

/**
 * Annotation-created payload.
 *
 * Polymorphic-FK encoding (R11 / option a, mirrored in
 * `0006_annotations.sql`): two nullable typed columns plus a CHECK
 * constraint enforcing exactly-one-non-null. The Zod `.refine()`
 * below enforces the same XOR at validation time so a malformed
 * payload is rejected before the insert.
 */
export const annotationCreatedPayloadSchema = z
  .object({
    annotation_id: z.string().uuid(),
    kind: annotationKindSchema,
    // `annotations.content` is TEXT NOT NULL; same `min(1)` reasoning
    // as `wording` on the node payload.
    content: z.string().min(1),
    target_node_id: z.string().uuid().nullable(),
    target_edge_id: z.string().uuid().nullable(),
    created_by: z.string().uuid(),
    created_at: z.string().datetime({ offset: true }),
  })
  .refine((payload) => (payload.target_node_id === null) !== (payload.target_edge_id === null), {
    message: 'exactly one of target_node_id / target_edge_id must be set',
  });

export type AnnotationCreatedPayload = z.infer<typeof annotationCreatedPayloadSchema>;

// -- Entity inclusion event payload schema ---------------------------
//
// Owned by `entity_inclusion_events`. Refinement:
// tasks/refinements/data-and-methodology/entity_inclusion_events.md.
//
// A single payload schema with `entity_kind` discriminating over
// `node | edge | annotation` (R26: `session_annotations` is a third
// M-N join table, mirroring `session_nodes` and `session_edges`).
// The server-side write path switches on `entity_kind` to insert into
// the matching join table; that lives with the API skeleton /
// `event_validation` task and is not part of payload validation.

/**
 * Entity-kind enum for `entity-included` payloads. Discriminates the
 * target join table: `node` → `session_nodes`, `edge` → `session_edges`,
 * `annotation` → `session_annotations` (R26).
 */
export const entityKindSchema = z.enum(['node', 'edge', 'annotation']);

export type EntityKind = z.infer<typeof entityKindSchema>;

export const entityIncludedPayloadSchema = z.object({
  entity_kind: entityKindSchema,
  entity_id: z.string().uuid(),
  included_by: z.string().uuid(),
  included_at: z.string().datetime({ offset: true }),
});

export type EntityIncludedPayload = z.infer<typeof entityIncludedPayloadSchema>;

// Worked example: vote.
//
// Refined by `vote_events`; the shape here matches docs/data-model.md
// — Event types — Votes.
export const votePayloadSchema = z.object({
  proposal_event_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  vote: z.enum(['agree', 'dispute', 'withdraw']),
});

export type VotePayload = z.infer<typeof votePayloadSchema>;

// Placeholder for kinds whose payload schema is owned by a
// not-yet-completed downstream task. Accepts any object; downstream
// tasks tighten this.
const placeholderPayloadSchema = z.object({}).passthrough();

// The registry. Keys are exhaustive over `EventKind` (TypeScript
// enforces this via the explicit type annotation).
export const eventPayloadSchemas: Record<EventKind, z.ZodTypeAny> = {
  // Owned by session_lifecycle_events
  'session-created': sessionCreatedPayloadSchema,
  'session-ended': sessionEndedPayloadSchema,
  'participant-joined': participantJoinedPayloadSchema,
  'participant-left': participantLeftPayloadSchema,
  // Owned by entity_creation_events
  'node-created': nodeCreatedPayloadSchema,
  'edge-created': edgeCreatedPayloadSchema,
  'annotation-created': annotationCreatedPayloadSchema,
  // Owned by entity_inclusion_events
  'entity-included': entityIncludedPayloadSchema,
  // Owned by proposal_events
  proposal: placeholderPayloadSchema,
  // Owned by vote_events
  vote: votePayloadSchema,
  // Owned by resolution_events
  commit: placeholderPayloadSchema,
  'meta-disagreement-marked': placeholderPayloadSchema,
  // Owned by snapshot_events
  'snapshot-created': placeholderPayloadSchema,
};

// -- Per-kind payload type map ---------------------------------------
//
// `EventPayloadMap` resolves each kind to its concrete payload type.
// Today the four session-lifecycle kinds plus the `vote` worked
// example have tight types; the remaining nine fall back to
// `Record<string, unknown>` (the placeholder's TS image) and will
// tighten as their downstream tasks land.

export interface EventPayloadMap {
  'session-created': SessionCreatedPayload;
  'session-ended': SessionEndedPayload;
  'participant-joined': ParticipantJoinedPayload;
  'participant-left': ParticipantLeftPayload;
  'node-created': NodeCreatedPayload;
  'edge-created': EdgeCreatedPayload;
  'annotation-created': AnnotationCreatedPayload;
  'entity-included': EntityIncludedPayload;
  proposal: Record<string, unknown>;
  vote: VotePayload;
  commit: Record<string, unknown>;
  'meta-disagreement-marked': Record<string, unknown>;
  'snapshot-created': Record<string, unknown>;
}

export type PayloadFor<K extends EventKind> = EventPayloadMap[K];

// -- Envelope --------------------------------------------------------
//
// Mirrors the column shape of `session_events` (camelCased). The
// envelope is generic in `K` so a value of `EventEnvelope<'vote'>`
// has its `payload` typed as `VotePayload` directly.

export interface EventEnvelope<K extends EventKind = EventKind> {
  /** Surrogate UUID — `session_events.id`. */
  id: string;
  /** Owning session — `session_events.session_id`. */
  sessionId: string;
  /**
   * Per-session monotonic sequence — `session_events.sequence`
   * (BIGINT in the DB). Represented as JS `number`; safe up to 2^53
   * (~9e15) which is well beyond any plausible per-session event
   * count. Documented ceiling.
   */
  sequence: number;
  /** Discriminator — matches the SQL CHECK list. */
  kind: K;
  /**
   * Causing actor — `session_events.actor`. Nullable for future
   * system-generated events (timeouts, server-emitted markers); today
   * always set, but the envelope shape must allow `null`.
   */
  actor: string | null;
  /** Kind-specific payload (typed per `PayloadFor<K>`). */
  payload: PayloadFor<K>;
  /** Server-clock insert time — `session_events.created_at`. ISO-8601. */
  createdAt: string;
}

/**
 * Discriminated union over `EventKind`. Switch statements on
 * `event.kind` narrow `event.payload` to the correct per-kind type.
 *
 * ```ts
 * function handle(event: Event) {
 *   switch (event.kind) {
 *     case 'vote':
 *       // event.payload is VotePayload here
 *       break;
 *     // ...
 *   }
 * }
 * ```
 */
export type Event = {
  [K in EventKind]: EventEnvelope<K>;
}[EventKind];

// -- Envelope Zod schema ---------------------------------------------
//
// Validates the *outer* envelope — id/sessionId/sequence/kind/actor/
// createdAt shape — without parsing the payload. `validateEvent`
// composes this with the per-kind payload schema lookup.

export const eventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  kind: eventKindSchema,
  actor: z.string().uuid().nullable(),
  // The payload is validated separately against the per-kind schema;
  // here we accept any value and let the kind-specific parse run
  // afterwards. (Splitting the parse this way produces clearer
  // errors than a giant discriminatedUnion: a kind-mismatch surfaces
  // at the envelope level; a payload-shape error surfaces with the
  // kind name in the message.)
  payload: z.unknown(),
  createdAt: z.string().datetime({ offset: true }),
});

// -- validateEvent ---------------------------------------------------
//
// Two-stage parse:
//
//   1. Outer envelope shape (`eventEnvelopeSchema`).
//   2. Per-kind payload (`eventPayloadSchemas[kind]`).
//
// Returns the typed `Event` on success. Throws an `Error` on failure
// with a message that names the kind and the failing path inside
// the payload (or notes the unknown kind), so the schema-on-write
// caller can log a useful diagnostic.

/**
 * Thrown when validation fails at any stage.
 *
 * `cause` carries the underlying `ZodError` when the failure was a
 * schema mismatch; absent when the failure was an unknown kind.
 */
export class EventValidationError extends Error {
  override readonly name = 'EventValidationError';
}

/**
 * Validate an unknown value as a typed `Event`.
 *
 * @param raw the candidate value (e.g. a JSON-parsed envelope from
 *            the wire, or an in-memory object about to be appended).
 * @returns the typed `Event` (discriminated union).
 * @throws {EventValidationError} on any envelope or payload mismatch
 *         or on an unknown kind.
 */
export function validateEvent(raw: unknown): Event {
  const envelopeResult = eventEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new EventValidationError(
      `event envelope failed validation: ${envelopeResult.error.message}`,
      { cause: envelopeResult.error },
    );
  }

  const envelope = envelopeResult.data;
  const payloadSchema = eventPayloadSchemas[envelope.kind];
  // The registry is exhaustive over `EventKind`, and the envelope
  // schema's `kind` field is `eventKindSchema` (the same enum).
  // `payloadSchema` is therefore always defined; this guard exists
  // to make the failure mode explicit if someone widens
  // `eventEnvelopeSchema.kind` without adding the matching registry
  // entry.
  if (!payloadSchema) {
    throw new EventValidationError(`no payload schema registered for kind '${envelope.kind}'`);
  }

  const payloadResult = payloadSchema.safeParse(envelope.payload);
  if (!payloadResult.success) {
    throw new EventValidationError(
      `payload for kind '${envelope.kind}' failed validation: ${payloadResult.error.message}`,
      { cause: payloadResult.error },
    );
  }

  // We've validated the envelope shape and the payload shape; the
  // resulting object is a valid `Event`. The cast is the bridge
  // between Zod's runtime check and the TS discriminated union.
  return {
    ...envelope,
    payload: payloadResult.data,
  } as Event;
}
