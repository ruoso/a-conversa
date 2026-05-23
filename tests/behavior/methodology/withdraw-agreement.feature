Feature: withdraw-agreement event kind — wire-and-replay round-trip through pglite
  # Per ADR 0030 §3 the methodology's "withdraw agreement" gesture is
  # promoted from a `vote.choice = 'withdraw'` variant to its own top-
  # level event kind. THIS feature pins the protocol-boundary seam the
  # new kind has to satisfy as a wire shape: an envelope INSERTed into
  # the `session_events` table (a) passes the SQL `CHECK (kind IN …)`
  # constraint extended by `0014_session_events_withdraw_agreement.sql`,
  # (b) round-trips out through `selectEvents` → `validateEvent` (the
  # JSONB / TIMESTAMPTZ / BIGINT coercion path), (c) replays through
  # `projectFromLog` without throwing, and (d) the projection's
  # `lastAppliedSequence` advances past the new event.
  #
  # **Scoping note.** The Vitest tests at
  # `packages/shared-types/src/events.test.ts` and
  # `apps/server/src/events/validate.test.ts` cover the in-memory
  # schema (round-trip + invalid-payload rejection + payload-corruption
  # sweep across every kind). This scenario adds the integration pin
  # the schema tests cannot reach: the wire shape must survive the DB
  # column-level encoders.
  #
  # **Projection-side handler is out of scope** for this task. Per the
  # refinement at
  # `tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md`
  # this task is JUST the event-kind plumbing. The replay-handler that
  # reverts the per-facet status to `disputed` lives in the downstream
  # `pf_withdraw_agreement_handler` task; the methodology-engine
  # validator lives in `pf_facet_keyed_vote_payload`. Today the replay
  # switch has no case for `'withdraw-agreement'`, so the event applies
  # as a no-op on the projection state — the assertion here is that
  # the replay survives (no `OutOfOrderEventError`, no exception), not
  # that the facet status changes. When the downstream handler lands,
  # the new scenarios it scopes will pin the status-flip directly.
  #
  # Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_event_kind.md
  # ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
  #              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
  #              docs/adr/0020-migrations-node-pg-migrate-forward-only.md

  Scenario: a withdraw-agreement envelope inserts, validates, and replays cleanly
    # Seed a 3-participant session with a node-created event so the
    # `(entity_kind: 'node', entity_id)` reference on the withdraw-
    # agreement payload resolves to a real entity in the projection.
    # INSERT a `withdraw-agreement` envelope at the next sequence and
    # round-trip the whole log: read rows → validateEvent → replay
    # via projectFromLog. The replay completes (no throw) and the
    # projection's `lastAppliedSequence` matches the new event's
    # sequence, confirming the new kind is wire-shaped, schema-valid,
    # CHECK-accepted, and apply-tolerant end-to-end.
    Given a seeded session with three participants for withdraw-agreement tests
    And a node-created event for the withdraw-agreement-test node
    When a withdraw-agreement event is inserted for the withdraw-agreement-test node's classification facet
    And I project the withdraw-agreement event log via projectFromLog
    Then the projection's lastAppliedSequence equals the withdraw-agreement event's sequence
    And the withdraw-agreement event round-trips through validateEvent with kind "withdraw-agreement"
