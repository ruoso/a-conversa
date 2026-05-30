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
//   - `proposal_events` → `proposal` (**done** — tightened below;
//     the envelope payload nests a `proposal: ProposalPayload` under
//     a `proposal` key, where `ProposalPayload` is a discriminated
//     union over `kind` covering the eleven proposal sub-kinds; see
//     `./events/proposals.ts`).
//   - `vote_events` → `vote` (**done** — tightened below; reconciled
//     the worked-example field names `proposal_event_id` /
//     `participant_id` to `proposal_id` / `participant`, and added
//     `voted_at: ISO8601` per the refinement).
//   - `resolution_events` → `commit`, `meta-disagreement-marked`.
//   - `snapshot_events` → `snapshot-created` (**done** — tightened
//     below; payload is `{ snapshot_id, label, log_position }` with
//     label capped at 128 chars and `log_position` a positive integer
//     matching the session sequence ceiling documented above).
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

import {
  MAX_METHODOLOGY_TEXT_LENGTH,
  MAX_SCREEN_NAME_LENGTH,
  MAX_SNAPSHOT_LABEL_LENGTH,
  MAX_TOPIC_LENGTH,
} from './limits.js';
import { type ProposalEnvelopePayload, proposalEnvelopePayloadSchema } from './events/proposals.js';

// -- Proposal payload re-exports -------------------------------------
//
// Owned by `proposal_events`. The eleven sub-kind schemas, the
// discriminated `ProposalPayload`, the `StatementKind` enum, and the
// outer `proposalEnvelopePayloadSchema` live in `./events/proposals.ts`
// (split out because the discriminated union runs long). Re-exported
// here so consumers see a single entry point.

export {
  amendNodeProposalSchema,
  annotateProposalSchema,
  axiomMarkProposalSchema,
  breakEdgeProposalSchema,
  captureNodeEdgeShapeSchema,
  captureNodeProposalSchema,
  classifyNodeProposalSchema,
  decomposeProposalSchema,
  editWordingProposalSchema,
  interpretiveSplitProposalSchema,
  metaMoveProposalSchema,
  proposalComponentSchema,
  proposalEnvelopePayloadSchema,
  proposalPayloadSchema,
  restructureEditProposalSchema,
  rewordEditProposalSchema,
  setEdgeSubstanceProposalSchema,
  setNodeSubstanceProposalSchema,
  statementKindSchema,
} from './events/proposals.js';
export type {
  AmendNodeProposal,
  AnnotateProposal,
  AxiomMarkProposal,
  BreakEdgeProposal,
  CaptureNodeEdgeShape,
  CaptureNodeProposal,
  ClassifyNodeProposal,
  DecomposeProposal,
  EditWordingProposal,
  InterpretiveSplitProposal,
  MetaMoveProposal,
  ProposalComponent,
  ProposalEnvelopePayload,
  ProposalPayload,
  RestructureEditProposal,
  RewordEditProposal,
  SetEdgeSubstanceProposal,
  SetNodeSubstanceProposal,
  StatementKind,
} from './events/proposals.js';

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
  // Entity removal (per ADR 0027 — proposal-withdraw removes
  // propose-time-minted entities from the structure)
  'entity-removed',
  // Session-mode transition (per ADR 0028 — the moderator advances
  // the session out of the lobby into the operate canvas; the
  // participant lobby's auto-navigation `useEffect` consumes the
  // event as its primary trigger). The event is bidirectional in
  // the wire vocabulary (the payload's `previous_mode`/`new_mode`
  // pair describes a transition between the two-mode v1 enum), even
  // though v1 only emits `lobby → operate`.
  'session-mode-changed',
  // Per-facet agreement withdrawal (per ADR 0030 §3). Promoted from
  // a `vote.choice = 'withdraw'` variant to its own top-level event
  // kind so the transition "agreed/committed facet returns to
  // disputed" is a direct read of the log rather than a derivation
  // off the proposal-keyed vote shape that ADR 0030 dismantles.
  'withdraw-agreement',
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
  // Topic length cap mirrors the HTTP-layer `maxLength: 256` already
  // enforced on `createSessionBodySchema`. See
  // `packages/shared-types/src/limits.ts` and finding F-003 in
  // `docs/security/m3-review/inputs.md`.
  topic: z.string().max(MAX_TOPIC_LENGTH),
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
  // Screen-name cap mirrors `validateScreenName`'s post-trim 64-char
  // check in `apps/server/src/auth/routes.ts` — see
  // `packages/shared-types/src/limits.ts` and finding F-003 in
  // `docs/security/m3-review/inputs.md`.
  screen_name: z.string().max(MAX_SCREEN_NAME_LENGTH),
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
// `annotationKindSchema` — because downstream `proposal_events` reuses
// them (e.g. `set-edge-substance` carries an edge role; an annotation-
// related proposal carries the kind). Single source of truth: changing
// a value in `./events/enums.ts` keeps the payload schemas, the
// proposal payloads, and any consuming UI in sync. The string lists
// mirror the SQL CHECK constraints exactly — drift would let payloads
// validate but inserts fail.
//
// **Why a leaf module**: hosting the enums inline here would create a
// circular import — `events.ts` imports `./events/proposals.ts`, which
// in turn needs `annotationKindSchema`. Top-level Zod builders run at
// module-init time, so a circular import where one side reads the
// other's binding before it's been assigned crashes with `Cannot
// access ... before initialization`. The leaf module breaks the cycle.
//
// **Edge endpoints are polymorphic** (per
// `edge_target_annotation_schema_extension`): each edge endpoint may
// be either a node or an annotation. `edgeCreatedPayloadSchema`
// carries four `.optional()` endpoint id fields (`source_node_id`,
// `source_annotation_id`, `target_node_id`, `target_annotation_id`)
// with two per-endpoint `.refine()` XOR blocks enforcing exactly-one-
// per-side. This mirrors `annotationCreatedPayloadSchema`'s
// polymorphic-target shape — modulo `.optional()` vs `.nullable()`:
// the edge schema is post-greenfield with payloads already on disk in
// the node-only shape, so absent-field (optional) is the encoding
// that lets today's payloads parse unchanged.

export {
  annotationKindSchema,
  edgeRoleSchema,
  entityKindSchema,
  facetNameSchema,
} from './events/enums.js';
export type { AnnotationKind, EdgeRole, EntityKind, FacetName } from './events/enums.js';

import {
  annotationKindSchema,
  edgeRoleSchema,
  entityKindSchema,
  facetNameSchema,
} from './events/enums.js';

export const nodeCreatedPayloadSchema = z.object({
  node_id: z.string().uuid(),
  // `nodes.wording` is TEXT NOT NULL with no DB-level length cap. The
  // Zod `min(1)` rejects the empty string (a UI-visible "blank node"
  // is not meaningful); `.max()` caps the methodology text length to
  // prevent storage / bandwidth amplification (F-003). See
  // `packages/shared-types/src/limits.ts`.
  wording: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
  created_by: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

export type NodeCreatedPayload = z.infer<typeof nodeCreatedPayloadSchema>;

export const edgeCreatedPayloadSchema = z
  .object({
    edge_id: z.string().uuid(),
    role: edgeRoleSchema,
    source_node_id: z.string().uuid().optional(),
    source_annotation_id: z.string().uuid().optional(),
    target_node_id: z.string().uuid().optional(),
    target_annotation_id: z.string().uuid().optional(),
    created_by: z.string().uuid(),
    created_at: z.string().datetime({ offset: true }),
  })
  .refine(
    (payload) =>
      (payload.source_node_id === undefined) !== (payload.source_annotation_id === undefined),
    { message: 'exactly one of source_node_id / source_annotation_id must be set' },
  )
  .refine(
    (payload) =>
      (payload.target_node_id === undefined) !== (payload.target_annotation_id === undefined),
    { message: 'exactly one of target_node_id / target_annotation_id must be set' },
  );

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
    // `annotations.content` is TEXT NOT NULL; same `min(1)` and
    // `.max(MAX_METHODOLOGY_TEXT_LENGTH)` reasoning as `wording` on the
    // node payload (F-003).
    content: z.string().min(1).max(MAX_METHODOLOGY_TEXT_LENGTH),
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

// `entityKindSchema` lives in `./events/enums.ts` (re-exported above)
// for the same circular-import reason as the other shared enums.
export const entityIncludedPayloadSchema = z.object({
  entity_kind: entityKindSchema,
  entity_id: z.string().uuid(),
  included_by: z.string().uuid(),
  included_at: z.string().datetime({ offset: true }),
});

export type EntityIncludedPayload = z.infer<typeof entityIncludedPayloadSchema>;

// -- Vote event payload schema ---------------------------------------
//
// Owned originally by `vote_events`; rewritten per ADR 0030 §2 +
// `pf_facet_keyed_vote_payload` into a `target`-discriminated union.
// Refinements:
//   - tasks/refinements/data-and-methodology/vote_events.md (historical
//     proposal-keyed shape — do not edit).
//   - tasks/refinements/per-facet-refactor/pf_facet_keyed_vote_payload.md
//     (this rewrite).
//
// **Two arms, one event kind.**
//
//   - `target: 'facet'` — votes against facet-valued proposal sub-kinds
//     (`classify-node`, `set-node-substance`, `set-edge-substance`,
//     `edit-wording`). Keyed directly by `(entity_kind, entity_id,
//     facet)` per ADR 0030 §2 so the agreement state hangs off the
//     facet itself rather than off whichever proposal happened to last
//     touch it. NO `proposal_id` on this arm.
//   - `target: 'proposal'` — votes against the seven structural
//     proposal sub-kinds (`decompose`, `interpretive-split`,
//     `axiom-mark`, `meta-move`, `break-edge`, `amend-node`,
//     `annotate`). Keyed by `proposal_id` per ADR 0030 §9 — these
//     proposals do not have a per-facet target the vote could attach
//     to; the vote applies to the proposal as a whole.
//
// **`choice` enum collapses to `'agree' | 'dispute'`.** Withdrawal is
// no longer a vote variant; it is its own top-level event kind
// (`'withdraw-agreement'`, per ADR 0030 §3 + `pf_withdraw_agreement_event_kind`).
//
// **Why one event kind (discriminated payload) rather than two event
// kinds.** Matches the precedent already established for `proposal`
// (one envelope kind; `payload.kind` discriminates). A single
// discriminator field on the payload is the lightest carriage for two
// coexisting shapes and keeps the consumer switch shape uniform —
// `case 'vote': switch (event.payload.target) { ... }`.
//
// Validation is shape-only: the `choice` enum is constrained,
// UUIDs / ISO-8601 are checked, and the discriminated union rejects
// cross-arm corruptions (a `target: 'facet'` payload with a
// `proposal_id`, a `target: 'proposal'` payload with an `entity_id`,
// etc.). Server-side referential checks (the proposal exists, the
// participant joined, prior-vote rules) live in
// `apps/server/src/events/validate.ts` and the methodology engine.
export const facetVotePayloadSchema = z.object({
  target: z.literal('facet'),
  entity_kind: z.enum(['node', 'edge']),
  entity_id: z.string().uuid(),
  facet: facetNameSchema,
  participant: z.string().uuid(),
  choice: z.enum(['agree', 'dispute']),
  voted_at: z.string().datetime({ offset: true }),
});

export type FacetVotePayload = z.infer<typeof facetVotePayloadSchema>;

export const proposalVotePayloadSchema = z.object({
  target: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  participant: z.string().uuid(),
  choice: z.enum(['agree', 'dispute']),
  voted_at: z.string().datetime({ offset: true }),
});

export type ProposalVotePayload = z.infer<typeof proposalVotePayloadSchema>;

export const votePayloadSchema = z.discriminatedUnion('target', [
  facetVotePayloadSchema,
  proposalVotePayloadSchema,
]);

export type VotePayload = z.infer<typeof votePayloadSchema>;

// -- Resolution event payload schemas --------------------------------
//
// Owned originally by `resolution_events`; the `commit` payload was
// rewritten per ADR 0030 §2 + §9 + `pf_facet_keyed_commit_payload` into
// a `target`-discriminated union matching the vote payload's split.
// Refinements:
//   - tasks/refinements/data-and-methodology/resolution_events.md
//     (historical proposal-keyed shape — do not edit).
//   - tasks/refinements/per-facet-refactor/pf_facet_keyed_commit_payload.md
//     (this rewrite).
//
// Two kinds — `commit` (a proposal is committed once every participant
// is voting `agree`) and `meta-disagreement-marked` (last-resort
// fallback recording an unresolvable proposal). Both payloads are
// shape-only here: server-side referential and authority checks (the
// actor is the moderator; the proposal exists and isn't already
// resolved; no double-resolve) live in `event_validation` and the
// methodology engine, not in Zod.
//
// **Commit: two arms, one event kind.** Mirroring the vote split per
// ADR 0030 §9: a commit's identity has to match its votes' identity.
//
//   - `target: 'facet'` — commits against facet-valued proposal sub-
//     kinds (`classify-node`, `set-node-substance`, `set-edge-substance`,
//     `edit-wording`). Keyed directly by `(entity_kind, entity_id,
//     facet)` per ADR 0030 §2 so the commit hangs off the facet itself.
//     NO `proposal_id` on this arm.
//   - `target: 'proposal'` — commits against the seven structural
//     proposal sub-kinds (`decompose`, `interpretive-split`,
//     `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`).
//     Keyed by `proposal_id` per ADR 0030 §9 — these proposals do not
//     have a per-facet target the commit could attach to.
//
// `committed_by` carries the UUID of the actor that committed (the
// moderator in v1; the field name is action-shaped rather than
// role-shaped so a future relaxation does not require a wire rename).
// `committed_at` is the action-clock ISO-8601 timestamp on both arms
// (parallel to `voted_at` on the vote payload).
//
// Field names mirror the vote schema's style: UUIDs via
// `z.string().uuid()`, ISO-8601 timestamps via
// `z.string().datetime({ offset: true })`.

export const facetCommitPayloadSchema = z.object({
  target: z.literal('facet'),
  entity_kind: z.enum(['node', 'edge']),
  entity_id: z.string().uuid(),
  facet: facetNameSchema,
  committed_by: z.string().uuid(),
  committed_at: z.string().datetime({ offset: true }),
});

export type FacetCommitPayload = z.infer<typeof facetCommitPayloadSchema>;

export const proposalCommitPayloadSchema = z.object({
  target: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  committed_by: z.string().uuid(),
  committed_at: z.string().datetime({ offset: true }),
});

export type ProposalCommitPayload = z.infer<typeof proposalCommitPayloadSchema>;

export const commitPayloadSchema = z.discriminatedUnion('target', [
  facetCommitPayloadSchema,
  proposalCommitPayloadSchema,
]);

export type CommitPayload = z.infer<typeof commitPayloadSchema>;

// **Meta-disagreement-marked: two arms, one event kind.** Mirroring
// the vote + commit split per ADR 0030 §2 + §9: a meta-disagreement
// mark's identity has to match the votes whose impasse it acknowledges.
//
//   - `target: 'facet'` — marks against facet-valued proposal sub-kinds
//     (`classify-node`, `set-node-substance`, `set-edge-substance`,
//     `edit-wording`). Keyed directly by `(entity_kind, entity_id,
//     facet)` per ADR 0030 §2 so the meta-disagreement state hangs off
//     the facet itself rather than off whichever proposal happened to
//     last touch it. NO `proposal_id` on this arm. The two competing
//     candidate values for the facet are derived by the projection from
//     the two most-recent proposals targeting that facet (ADR 0030 §2
//     sentence 4); they are NOT carried inline in the event payload.
//   - `target: 'proposal'` — marks against the seven structural
//     proposal sub-kinds (`decompose`, `interpretive-split`,
//     `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`).
//     Keyed by `proposal_id` per ADR 0030 §9 — these proposals do not
//     have a per-facet target the mark could attach to.
//
// `marked_by` carries the UUID of the actor that marked (the moderator
// in v1; the field name is action-shaped rather than role-shaped so a
// future relaxation does not require a wire rename — mirrors the
// `committed_by` field on the commit payload). `marked_at` is the
// action-clock ISO-8601 timestamp on both arms (parallel to
// `committed_at` on the commit payload and `voted_at` on the vote
// payload).
//
// Field names mirror the vote + commit schemas' style: UUIDs via
// `z.string().uuid()`, ISO-8601 timestamps via
// `z.string().datetime({ offset: true })`.

export const facetMetaDisagreementPayloadSchema = z.object({
  target: z.literal('facet'),
  entity_kind: z.enum(['node', 'edge']),
  entity_id: z.string().uuid(),
  facet: facetNameSchema,
  marked_by: z.string().uuid(),
  marked_at: z.string().datetime({ offset: true }),
});

export type FacetMetaDisagreementPayload = z.infer<typeof facetMetaDisagreementPayloadSchema>;

export const proposalMetaDisagreementPayloadSchema = z.object({
  target: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  marked_by: z.string().uuid(),
  marked_at: z.string().datetime({ offset: true }),
});

export type ProposalMetaDisagreementPayload = z.infer<typeof proposalMetaDisagreementPayloadSchema>;

export const metaDisagreementMarkedPayloadSchema = z.discriminatedUnion('target', [
  facetMetaDisagreementPayloadSchema,
  proposalMetaDisagreementPayloadSchema,
]);

export type MetaDisagreementMarkedPayload = z.infer<typeof metaDisagreementMarkedPayloadSchema>;

// -- Snapshot event payload schema -----------------------------------
//
// Owned by `snapshot_events`. Refinement:
// tasks/refinements/data-and-methodology/snapshot_events.md.
//
// A snapshot is a regular event in `session_events` (kind:
// `snapshot-created`) — no separate table. The payload carries the
// snapshot's surrogate UUID, a short user-supplied label (VARCHAR(128)
// per the refinement's decision), and `log_position` — the session's
// `sequence` value at the moment of the snapshot (typically the
// snapshot event's own sequence, so replay-up-to-this-snapshot
// includes the snapshot event itself).
//
// `log_position` is `z.number().int().positive()` (sequence values
// are 1-indexed and BIGINT in SQL). JS `number` is safe up to 2^53,
// matching the ceiling documented in the file header — well beyond
// any plausible per-session event count.
//
// Discoverability is already covered by the `(session_id, kind)`
// index on `session_events` (R29) — no additional index needed for
// snapshot lookups.
export const snapshotCreatedPayloadSchema = z.object({
  snapshot_id: z.string().uuid(),
  // Snapshot label cap centralised in `limits.ts` (was previously a
  // magic 128 here). Same value, different sourcing.
  label: z.string().min(1).max(MAX_SNAPSHOT_LABEL_LENGTH),
  log_position: z.number().int().positive(),
});

export type SnapshotCreatedPayload = z.infer<typeof snapshotCreatedPayloadSchema>;

// -- Entity removal event payload schema -----------------------------
//
// Per ADR 0027 — when a proposal is withdrawn before commit, the
// propose-time-minted entities leave the structure via explicit
// `entity-removed` events (one per entity the proposal introduced).
// The payload mirrors `entity-included`'s shape with a `removed_by` /
// `removed_at` pair instead of `included_by` / `included_at`, so a
// projector that handles inclusion can mechanically extend to handle
// removal. The `entity_kind` discriminator covers node / edge /
// annotation per the same enum used by `entity-included`.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_entity_canvas_visibility.md
export const entityRemovedPayloadSchema = z.object({
  entity_kind: entityKindSchema,
  entity_id: z.string().uuid(),
  removed_by: z.string().uuid(),
  removed_at: z.string().datetime({ offset: true }),
});

export type EntityRemovedPayload = z.infer<typeof entityRemovedPayloadSchema>;

// -- Session-mode-changed event payload schema -----------------------
//
// Per ADR 0028 — a dedicated event emitted by the moderator-only
// `POST /api/sessions/:id/start` endpoint at the precise moment the
// session advances out of the lobby into the operate canvas. The
// participant lobby's auto-navigation `useEffect` consumes the event
// as its primary trigger; the predecessor's `CONTENT_EVENT_KINDS`
// heuristic stays as a defense-in-depth fallback (Decision §7 of
// `part_session_start_handoff_dedicated_event.md`).
//
// Two-mode v1 enum (`{ lobby, operate }`); the `previous_mode` field
// is intentionally redundant with the projector's prior state so a
// wire-trace reader knows the full transition shape from one event in
// isolation. Forward-compatible with a future `'concluded'` /
// `'paused'` value (the closed Zod enum is the source of truth;
// widening is a one-line change + a SQL migration + an ADR amendment
// per the [ADR amendment-pass rule](../../../docs/adr/README.md)).
//
// Refinement: tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
export const sessionModeSchema = z.enum(['lobby', 'operate']);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const sessionModeChangedPayloadSchema = z.object({
  previous_mode: sessionModeSchema,
  new_mode: sessionModeSchema,
  changed_by: z.string().uuid(),
  changed_at: z.string().datetime({ offset: true }),
});

export type SessionModeChangedPayload = z.infer<typeof sessionModeChangedPayloadSchema>;

// -- Withdraw-agreement event payload schema -------------------------
//
// Per ADR 0030 §3 — promoted from a `vote.choice = 'withdraw'` variant
// to its own top-level event kind. Payload addresses the targeted
// facet directly via `(entity_kind, entity_id, facet)` rather than
// hanging off a proposal id, matching the per-facet keying ADR 0030
// is dismantling the proposal-keyed vote shape in favour of.
//
// `entity_kind` is intentionally NARROWER than `entityKindSchema`:
// facet-valued proposals only target nodes and edges (annotations
// have no facets in v1), so a payload with `entity_kind: 'annotation'`
// is a category error that the schema rejects at the seam rather than
// deferring to a downstream invariant violation.
//
// `withdrawn_at` mirrors the sibling per-action timestamps
// (`voted_at`, `committed_at`, `marked_at`): the participant-action-
// level clock, parallel to how `voted_at` works on the vote payload.
// The envelope's `createdAt` separately carries the server-clock
// insert time.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md
export const withdrawAgreementPayloadSchema = z.object({
  entity_kind: z.enum(['node', 'edge']),
  entity_id: z.string().uuid(),
  facet: facetNameSchema,
  participant: z.string().uuid(),
  withdrawn_at: z.string().datetime({ offset: true }),
});

export type WithdrawAgreementPayload = z.infer<typeof withdrawAgreementPayloadSchema>;

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
  proposal: proposalEnvelopePayloadSchema,
  // Owned by vote_events
  vote: votePayloadSchema,
  // Owned by resolution_events
  commit: commitPayloadSchema,
  'meta-disagreement-marked': metaDisagreementMarkedPayloadSchema,
  // Owned by snapshot_events
  'snapshot-created': snapshotCreatedPayloadSchema,
  // Owned by mod_proposed_entity_canvas_visibility (ADR 0027)
  'entity-removed': entityRemovedPayloadSchema,
  // Owned by part_session_start_handoff_dedicated_event (ADR 0028)
  'session-mode-changed': sessionModeChangedPayloadSchema,
  // Owned by pf_withdraw_agreement_event_kind (ADR 0030 §3)
  'withdraw-agreement': withdrawAgreementPayloadSchema,
};

// -- Per-kind payload type map ---------------------------------------
//
// `EventPayloadMap` resolves each kind to its concrete payload type.
// All thirteen kinds are tightened: the four session-lifecycle kinds,
// the three entity-creation kinds, `entity-included`, `proposal`,
// `vote`, the two resolution kinds (`commit`,
// `meta-disagreement-marked`), and `snapshot-created`.

export interface EventPayloadMap {
  'session-created': SessionCreatedPayload;
  'session-ended': SessionEndedPayload;
  'participant-joined': ParticipantJoinedPayload;
  'participant-left': ParticipantLeftPayload;
  'node-created': NodeCreatedPayload;
  'edge-created': EdgeCreatedPayload;
  'annotation-created': AnnotationCreatedPayload;
  'entity-included': EntityIncludedPayload;
  proposal: ProposalEnvelopePayload;
  vote: VotePayload;
  commit: CommitPayload;
  'meta-disagreement-marked': MetaDisagreementMarkedPayload;
  'snapshot-created': SnapshotCreatedPayload;
  'entity-removed': EntityRemovedPayload;
  'session-mode-changed': SessionModeChangedPayload;
  'withdraw-agreement': WithdrawAgreementPayload;
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
