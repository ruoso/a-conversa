-- Extend the session_events.kind CHECK constraint with 'session-restarted'.
--
-- Refinement: tasks/refinements/session_lifecycle/sl_restart_endpoint.md
-- ADRs:        docs/adr/0020-migrations-node-pg-migrate-forward-only.md,
--              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
-- TaskJuggler: session_lifecycle.sl_restart_endpoint
--
-- **Why a new kind.** `POST /api/sessions/:id/restart` reopens an
-- ended session — it is the inverse of `POST /api/sessions/:id/end`.
-- The reopen clears `sessions.ended_at` back to NULL (the row returns
-- to the `live` derived status), but a column-clear alone leaves the
-- immutable log unable to explain why a session that was ended is live
-- again. `session-restarted` is the dedicated, stateless event kind
-- that records the reopen on the log so the change history and replay
-- show it — the fifth sibling of the session-lifecycle group
-- (`session-created` / `session-ended` / `participant-joined` /
-- `participant-left`). It is the literal inverse of `session-ended`
-- and carries no payload (the event's existence at its sequence IS the
-- record; `createdAt` timestamps the reopen). Reusing
-- `session-mode-changed` was rejected — that kind means lobby→operate
-- canvas transitions (ADR 0028) and maintains `started_at`; overloading
-- it with reopen semantics conflates two distinct lifecycle axes.
--
-- **Forward-only.** Per ADR 0020 there is no down migration. The
-- supported rollback path is restoring from backup; reverting a
-- production constraint expansion is a one-way door at the schema
-- level.
--
-- Postgres semantics: dropping + re-adding a CHECK constraint inside
-- one transaction is atomic from the perspective of any subsequent
-- INSERT; existing rows are NOT re-validated against the new
-- constraint (and we don't have any 'session-restarted' rows
-- pre-existing). The migration restates the WHOLE kind list — these
-- migrations are not additive ALTERs.

ALTER TABLE session_events
    DROP CONSTRAINT IF EXISTS session_events_kind_check;

ALTER TABLE session_events
    ADD CONSTRAINT session_events_kind_check
    CHECK (kind IN (
        -- Session lifecycle
        'session-created',
        'session-ended',
        'participant-joined',
        'participant-left',
        -- Session reopen (moderator restarts an ended session; clears
        -- ended_at back to NULL — the inverse of session-ended; this task)
        'session-restarted',
        -- Global entity creation
        'node-created',
        'edge-created',
        'annotation-created',
        -- Session inclusion
        'entity-included',
        -- Proposals (single kind; payload.kind discriminates)
        'proposal',
        -- Votes
        'vote',
        -- Resolutions
        'commit',
        'meta-disagreement-marked',
        -- Snapshots
        'snapshot-created',
        -- Entity removal (proposal-withdraw retracts propose-time-
        -- minted entities; ADR 0027)
        'entity-removed',
        -- Session mode transition (moderator advances the session out
        -- of the lobby into the operate canvas; ADR 0028)
        'session-mode-changed',
        -- Per-facet agreement withdrawal (a previously-committed/agreed
        -- facet returns to disputed; promoted from `vote.choice =
        -- 'withdraw'` per ADR 0030 §3)
        'withdraw-agreement',
        -- Proposal-withdrawn terminator (a log-silent zero-emission
        -- withdraw appends this proposal-keyed terminal marker; ADR 0037)
        'proposal-withdrawn'
    ));
