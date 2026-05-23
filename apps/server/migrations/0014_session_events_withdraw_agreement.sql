-- Extend the session_events.kind CHECK constraint with 'withdraw-agreement'.
--
-- Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md
-- ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
--              docs/adr/0020-migrations-node-pg-migrate-forward-only.md,
--              docs/adr/0021-event-envelope-discriminated-union-with-zod.md
-- TaskJuggler: per_facet_refactor.schema_and_events.pf_withdraw_agreement_event_kind
--
-- **Why a new kind.** Per ADR 0030 §3 the methodology's "withdraw
-- agreement" gesture (a previously-committed-or-agreed facet returning
-- to disputed) gets its own top-level event kind rather than living as
-- a `vote.choice = 'withdraw'` variant. The promotion makes the
-- transition a direct read of the log (one event = one state change)
-- rather than a derivation off the proposal-keyed vote shape that ADR
-- 0030 is itself dismantling in favour of per-facet keying. Every
-- downstream consumer (server-side dispatcher, projection replay,
-- participant UI, Cucumber + Playwright scenarios) routes off this
-- kind directly.
--
-- **Forward-only.** Per ADR 0020 there is no down migration. The
-- supported rollback path is restoring from backup; reverting a
-- production constraint expansion is a one-way door at the schema
-- level.
--
-- **No row updates.** Per ADR 0030 Consequences the pre-release clean-
-- break means no `vote { choice: 'withdraw' }` rows need transformation
-- here — the downstream `pf_facet_keyed_vote_payload` migration owns
-- the choice-enum narrowing. This migration is structural-CHECK-only:
-- it widens the kind whitelist to accept the new event without
-- mutating existing data.
--
-- Postgres semantics: dropping + re-adding a CHECK constraint inside
-- one transaction is atomic from the perspective of any subsequent
-- INSERT; existing rows are NOT re-validated against the new
-- constraint (PostgreSQL re-validates on `ADD CONSTRAINT ... NOT
-- VALID` skip-and-validate splits, but our straightforward
-- `ADD CONSTRAINT ... CHECK (...)` runs against the table at write
-- time — and we don't have any 'withdraw-agreement' rows pre-existing).

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
        'withdraw-agreement'
    ));
