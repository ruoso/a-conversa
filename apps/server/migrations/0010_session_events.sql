-- Per-session append-only event log — the canonical record of every
-- state transition in a session.
--
-- Refinement: tasks/refinements/data-and-methodology/session_events_table.md
-- TaskJuggler: data_and_methodology.schema.session_events_table
-- Forward-only per ADR 0020 (no down migration).
--
-- This table is the **source of truth**. Every other table
-- (`nodes`/`edges`/`annotations`, the `session_*` joins) records *what
-- entities exist*; this table records *what happened*. The two
-- combine to produce the projected session state — the visible graph
-- is computed from this log on demand (see docs/data-model.md —
-- visible-graph derivation).
--
-- Append-only contract (R12 + R13):
--
--   * **R12** — sequence is application-managed, monotonic per
--     session. The server selects `MAX(sequence)+1` inside the same
--     transaction that inserts the event. Single-writer-per-session
--     (server-authoritative model) makes this safe; the
--     `UNIQUE (session_id, sequence)` constraint below is the safety
--     net that turns a concurrent writer's collision into a clean
--     transaction failure rather than silent corruption.
--   * **R13** — no retention policy in v1. Events accumulate
--     indefinitely; the change history is part of the product
--     (replay, audit, snapshot resolution).
--   * Append-only is enforced by application contract today and will
--     be reinforced in production by revoking UPDATE/DELETE on the
--     running app's role (separate operational task — out of scope
--     for the schema migration). No DB-level UPDATE/DELETE-blocking
--     trigger is added: per the refinement, the contract lives at
--     the application layer + production-role permissions, not at
--     the table.
--
-- Schema-on-write payload validation is **deferred to**
-- `data_and_methodology.event_types.event_validation`. That task
-- owns the per-kind JSON-schema validators that run before insert.
-- Per-event-kind payload schemas themselves are owned by the
-- `data_and_methodology.event_types.*` tasks
-- (event_base_envelope, session_lifecycle_events,
-- entity_creation_events, entity_inclusion_events, proposal_events,
-- vote_events, resolution_events, snapshot_events). This migration
-- intentionally accepts any well-formed JSONB in `payload`; the
-- CHECK constraint here only validates the `kind` discriminator.
--
-- Event-kind treatment: **single 'proposal' kind, payload-discriminated**.
-- docs/data-model.md (Event types — Proposals) is explicit:
--   "All proposals share the same lifecycle (proposed -> agreed /
--    disputed / meta-disagreement) but vary in payload by `kind`"
-- — i.e. proposals are one event kind at the envelope level, with
-- the payload's own `kind` field discriminating among
-- `classify-node` / `set-node-substance` / `set-edge-substance` /
-- `edit-wording` / `decompose` / `interpretive-split` /
-- `axiom-mark` / `meta-move` / `break-edge` / `amend-node` /
-- `annotate`. The CHECK constraint below mirrors that: a single
-- `'proposal'` kind, with the inner discrimination living in
-- the payload schema (validated at write time by the
-- `event_validation` task).
--
-- The full envelope-level catalog (mirrors docs/data-model.md —
-- event types):
--   * Session lifecycle: session-created, session-ended,
--     participant-joined, participant-left.
--   * Global entity creation: node-created, edge-created,
--     annotation-created.
--   * Session inclusion: entity-included.
--   * Proposals: proposal (single kind; payload.kind discriminates).
--   * Votes: vote.
--   * Resolutions: commit, meta-disagreement-marked.
--   * Snapshots: snapshot-created.
--
-- `actor` is nullable. Today every event has a participant-actor,
-- but the refinement leaves room for future system-generated events
-- (e.g. timeouts, server-emitted lifecycle markers) — making the
-- column nullable now avoids a future schema-migration dance. ON
-- DELETE RESTRICT matches the soft-delete convention on
-- `users` (0001_users.sql) and on `sessions` (0002_sessions.sql) —
-- the event log references actors, so neither user nor session can
-- be hard-deleted while their event-log rows exist.
--
-- `payload` is NOT NULL with no default: writers must always supply
-- a payload object (even if `'{}'::jsonb` for events with no
-- payload-specific data). Forcing the writer to be explicit catches
-- the "I forgot to fill in the payload" bug class at insert time
-- rather than producing rows with silently-defaulted empty payloads.
--
-- `gen_random_uuid()` is in core Postgres 13+; the dev stack pins
-- postgres:16-alpine, so this is safe (matches earlier migrations).

CREATE TABLE IF NOT EXISTS session_events (
    -- Globally-unique surrogate id. UUID per CC1. Generated
    -- server-side. Used by cross-session references (e.g. a snapshot
    -- pointing at a specific event).
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Owning session. RESTRICT so a session cannot be hard-deleted
    -- while its event-log rows exist (matches the soft-delete
    -- convention from 0002_sessions.sql).
    session_id      UUID            NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,

    -- Per-session monotonic sequence number (R12). The application
    -- sets this via MAX(sequence)+1 in-transaction at insert time.
    -- The unique constraint at the bottom of the table is the
    -- safety net that catches concurrent-writer collisions.
    sequence        BIGINT          NOT NULL,

    -- Event kind discriminator. TEXT + CHECK (CC2) listing every
    -- envelope-level kind from docs/data-model.md. Proposals use a
    -- single 'proposal' kind at this level; the payload's own
    -- `kind` field discriminates among proposal sub-kinds (see
    -- the header comment above for the full list).
    kind            TEXT            NOT NULL
                                    CHECK (kind IN (
                                        -- Session lifecycle
                                        'session-created',
                                        'session-ended',
                                        'participant-joined',
                                        'participant-left',
                                        -- Global entity creation
                                        'node-created',
                                        'edge-created',
                                        'annotation-created',
                                        -- Session inclusion
                                        'entity-included',
                                        -- Proposals (single kind; payload.kind
                                        -- discriminates among classify-node,
                                        -- set-node-substance, set-edge-substance,
                                        -- edit-wording, decompose,
                                        -- interpretive-split, axiom-mark,
                                        -- meta-move, break-edge, amend-node,
                                        -- annotate).
                                        'proposal',
                                        -- Votes
                                        'vote',
                                        -- Resolutions
                                        'commit',
                                        'meta-disagreement-marked',
                                        -- Snapshots
                                        'snapshot-created'
                                    )),

    -- Who caused the event. Nullable: today always set; nullable
    -- now to leave room for future system-generated events without
    -- a schema migration. RESTRICT so a user cannot be hard-deleted
    -- while their event-log rows exist (matches the soft-delete
    -- convention from 0001_users.sql).
    actor           UUID            NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Kind-specific payload. JSONB — discriminated union per
    -- envelope kind. NOT NULL with no default: writers must always
    -- supply an object, even '{}'::jsonb for payload-less events.
    -- Schema-on-write validation lives in the `event_validation`
    -- task; this migration only requires "well-formed JSONB".
    payload         JSONB           NOT NULL,

    -- Server-clock insert time. Used for time-based filtering and
    -- audit; ordering authority within a session is `sequence`,
    -- not `created_at` (clocks can skew, sequence cannot).
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Per-session uniqueness of the sequence number — the safety
    -- net for application-managed monotonic allocation (R12). A
    -- concurrent writer that picks the same MAX(sequence)+1 will
    -- get a clean unique-violation error; the application can
    -- retry the transaction. Without this, a race could silently
    -- produce two events with the same sequence and corrupt the
    -- replay order.
    UNIQUE (session_id, sequence)
);

-- Ordered-replay index. The unique constraint above already creates
-- a B-tree on (session_id, sequence) and Postgres will use it for
-- ordered replay; this explicit index would be redundant. Recorded
-- here as a deliberate choice rather than a missing index — the
-- unique constraint's index is the ordered-replay index.

-- Filtered-by-kind queries within a session — e.g. "show me every
-- axiom-mark proposal in this session", "list every commit". The
-- common access pattern is "given a session, find events of these
-- kinds", so session_id leads.
CREATE INDEX IF NOT EXISTS session_events_session_kind_idx
    ON session_events (session_id, kind);

-- Time-based filtering within a session — e.g. "events in the last
-- five minutes", "events between two wall-clock points". Again
-- session_id leads to keep the per-session scan cheap.
CREATE INDEX IF NOT EXISTS session_events_session_created_at_idx
    ON session_events (session_id, created_at);
