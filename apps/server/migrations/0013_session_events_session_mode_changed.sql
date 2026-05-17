-- Extend the session_events.kind CHECK constraint with 'session-mode-changed'.
--
-- Refinement: tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
-- ADRs:        docs/adr/0028-session-mode-changed-wire-event.md,
--              docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
--              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
-- TaskJuggler: participant_ui.part_graph_view.part_session_start_handoff_dedicated_event
--
-- **Why a new kind.** Per ADR 0028 the lobby → operate transition is
-- signalled by a dedicated wire event rather than inferred from the
-- first content event arriving on the per-session WS stream. The
-- moderator-only `POST /api/sessions/:id/start` endpoint emits one
-- `session-mode-changed` envelope at the moment the moderator advances
-- the session out of the lobby; the participant lobby's auto-navigation
-- `useEffect` consumes the event as its primary trigger (the
-- predecessor's `CONTENT_EVENT_KINDS` heuristic stays as a
-- defense-in-depth fallback). The dedicated event also lets a future
-- replay surface reconstruct the lobby → operate boundary in O(1) per
-- transition instead of re-applying the heuristic.
--
-- **Forward-only.** Per ADR 0020 there is no down migration. The
-- supported rollback path is restoring from backup; reverting a
-- production constraint expansion is a one-way door at the schema
-- level.
--
-- Postgres semantics: dropping + re-adding a CHECK constraint inside
-- one transaction is atomic from the perspective of any subsequent
-- INSERT; existing rows are NOT re-validated against the new
-- constraint (PostgreSQL re-validates on `ADD CONSTRAINT ... NOT
-- VALID` skip-and-validate splits, but our straightforward
-- `ADD CONSTRAINT ... CHECK (...)` runs against the table at write
-- time — and we don't have any 'session-mode-changed' rows
-- pre-existing).

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
        'session-mode-changed'
    ));
