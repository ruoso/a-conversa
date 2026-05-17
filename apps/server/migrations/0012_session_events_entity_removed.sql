-- Extend the session_events.kind CHECK constraint with 'entity-removed'.
--
-- Refinement: tasks/refinements/moderator-ui/mod_proposed_entity_canvas_visibility.md
-- ADRs:        docs/adr/0027-entity-and-facet-layers-strict-separation.md,
--              docs/adr/0020-migrations-node-pg-migrate-forward-only.md
-- TaskJuggler: moderator_ui.mod_graph_rendering.mod_proposed_entity_canvas_visibility
--
-- **Why a new kind.** Per ADR 0027 the entity layer and the facet
-- layer are strictly separate. Proposal-withdraw — rescinding the
-- proposer's intent to introduce entities — is an entity-layer action.
-- The structural fan-out at propose-time (`node-created` /
-- `edge-created` / `entity-included`) needs an explicit, symmetric
-- "untaint the structure" event so projectors can keep their
-- event-presence-as-structure model. Implicit derivation from
-- "proposal withdrawn AND entity has no committed facets" was
-- considered and rejected (ADR 0027 L30) — it pushes a derivation
-- rule into every projector and makes "why isn't this entity visible?"
-- a multi-step query instead of a single-event lookup.
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
-- time — and we don't have any 'entity-removed' rows pre-existing).

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
        'entity-removed'
    ));
