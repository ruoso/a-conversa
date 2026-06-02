-- Extend the session_events.kind CHECK constraint with 'proposal-withdrawn'.
--
-- Refinement: tasks/refinements/backend/ws_withdraw_proposal_zero_emission_terminator.md
-- ADRs:        docs/adr/0037-proposal-withdrawn-terminator-event.md,
--              docs/adr/0027-entity-and-facet-layers-strict-separation.md,
--              docs/adr/0020-migrations-node-pg-migrate-forward-only.md,
--              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
-- TaskJuggler: backend.websocket_protocol.ws_withdraw_proposal_zero_emission_terminator
--
-- **Why a new kind.** Per ADR 0037 a pending proposal has exactly
-- three terminal dispositions — committed, marked a meta-disagreement,
-- or withdrawn. The first two have explicit, proposal-keyed events on
-- the immutable log (`commit`, `meta-disagreement-marked`); the
-- *withdrawn* disposition did not. Withdrawing one of the seven
-- zero-emission sub-kinds (which mint no structural entity at
-- propose-time) appended NOTHING to the log, so the pending row never
-- cleared on any read surface and the withdraw was not replayable.
-- `proposal-withdrawn` is the proposal-keyed terminal marker for the
-- withdrawn disposition, the fourth sibling of `commit` /
-- `meta-disagreement-marked`. The `withdraw-proposal` handler appends
-- it iff the withdraw is otherwise log-silent (zero `entity-removed`
-- events). The reuse-`entity-removed`-with-a-synthetic-overlay-entity
-- alternative was rejected (ADR 0037 Alternatives) — it overloads the
-- entity layer with facet-layer semantics, the mixing ADR 0027 forbids.
--
-- **Namespace note.** This event kind shares its name with the
-- `proposal-withdrawn` WS ack ENVELOPE type, but the two live in
-- separate namespaces (`eventKinds` vs `wsMessageTypes`); the overlap
-- is intentional + namespace-distinct (per the `withdraw.ts` docblock).
--
-- **Forward-only.** Per ADR 0020 there is no down migration. The
-- supported rollback path is restoring from backup; reverting a
-- production constraint expansion is a one-way door at the schema
-- level.
--
-- Postgres semantics: dropping + re-adding a CHECK constraint inside
-- one transaction is atomic from the perspective of any subsequent
-- INSERT; existing rows are NOT re-validated against the new
-- constraint (our straightforward `ADD CONSTRAINT ... CHECK (...)`
-- runs against the table at write time — and we don't have any
-- 'proposal-withdrawn' rows pre-existing).

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
        'session-mode-changed',
        -- Per-facet agreement withdrawal (a previously-committed/agreed
        -- facet returns to disputed; promoted from `vote.choice =
        -- 'withdraw'` per ADR 0030 §3)
        'withdraw-agreement',
        -- Proposal-withdrawn terminator (a log-silent zero-emission
        -- withdraw appends this proposal-keyed terminal marker; ADR 0037)
        'proposal-withdrawn'
    ));
