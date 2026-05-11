Feature: WebSocket snapshot (client → server, state query)

  An authenticated WebSocket client subscribed to a session may send a
  `snapshot` envelope to request the current projection state. This is
  a read-only catch-up surface: the server runs the same
  subscribe-before-act gate + visibility re-check the four write
  handlers (propose / vote / commit / mark-meta-disagreement) use,
  loads the session's event log, builds the projection via
  `projectFromLog`, and responds with a `snapshot-state` envelope
  carrying the full projection at the current `lastAppliedSequence`.
  No event is appended; no broadcast is emitted; no transaction is
  opened.

  The handler implements **Interpretation A** of the WBS task —
  state-query catch-up. **Interpretation B** (the moderator creates a
  labeled checkpoint `snapshot-created` event) is deferred to a future
  task once the methodology engine grows a snapshot-create handler.
  See `tasks/refinements/backend/ws_snapshot_message.md` for the
  choice rationale.

  Catch-up pattern: a freshly-connected client follows
  `subscribe → snapshot → react-to-deltas`. The snapshot anchors the
  client's local projection; subsequent `event-applied` broadcasts
  apply as deltas on top.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a snapshot without a prior `subscribe` yields
  `code: 'forbidden'`; a snapshot of a non-visible session yields
  `code: 'not-found'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row +
  participant rows + a node row + a pending proposal are seeded, the
  snapshot envelope is sent, and the receiving client is inspected
  for the arrived frame.

  Refinement: tasks/refinements/backend/ws_snapshot_message.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: A subscribed participant requests a snapshot — receives snapshot-state reflecting the seeded session
    Given a snapshot-ready session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999901" and node id "99999999-9999-4999-8999-999999999a01" and pending proposal id "99999999-9999-4999-8999-999999999b01"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "99999999-9999-4999-8999-999999999901"
    And the client sends a snapshot envelope for session "99999999-9999-4999-8999-999999999901"
    Then the client receives a snapshot-state response referencing the snapshot envelope at sequence 5
    And the snapshot-state projection contains the seeded node "99999999-9999-4999-8999-999999999a01" and pending proposal "99999999-9999-4999-8999-999999999b01"

  Scenario: An unsubscribed client cannot snapshot — receives a forbidden error envelope
    Given a snapshot-ready session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999902" and node id "99999999-9999-4999-8999-999999999a02" and pending proposal id "99999999-9999-4999-8999-999999999b02"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a snapshot envelope for session "99999999-9999-4999-8999-999999999902"
    Then the client receives an error envelope with code "forbidden" referencing the snapshot envelope

  Scenario: A snapshot reflects events appended by sibling write handlers — regression-pin for the catch-up contract
    Given a propose-ready session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999903" and node id "99999999-9999-4999-8999-999999999a03"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "99999999-9999-4999-8999-999999999903"
    And the client sends a propose envelope for session "99999999-9999-4999-8999-999999999903" with expectedSequence 3 targeting node "99999999-9999-4999-8999-999999999a03"
    And the client receives a proposed ack referencing the propose envelope at sequence 4
    And the client sends a snapshot envelope for session "99999999-9999-4999-8999-999999999903"
    Then the client receives a snapshot-state response referencing the snapshot envelope at sequence 4
    And the snapshot-state projection contains one pending proposal
