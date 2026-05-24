Feature: WebSocket propose (client → server)

  An authenticated WebSocket client subscribed to a session may send a
  `propose` envelope. The server validates the request through the
  methodology engine, allocates the next sequence number, INSERTs the
  resulting `proposal` event into `session_events`, emits the
  `event-applied` broadcast on every subscribed connection (including
  the proposer), and sends a `proposed` ack envelope to the originating
  client (`inResponseTo` correlated to the request's `id`). The
  proposer therefore receives BOTH frames; non-proposer subscribed
  clients receive only the `event-applied` broadcast.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a propose without a prior `subscribe` yields
  `code: 'forbidden'`; a stale `expectedSequence` yields
  `code: 'sequence-mismatch'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row + a
  participant row + a node row are seeded, the propose envelope is
  sent, and the receiving clients are inspected for the arrived
  frames.

  Refinement: tasks/refinements/backend/ws_propose_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: A subscribed participant proposes — proposer receives both proposed ack and event-applied broadcast, second subscribed client receives the broadcast
    Given a propose-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777701" and node id "77777777-7777-4777-8777-777777777ab1"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777701"
    And a second authenticated WebSocket client connects to "/api/ws"
    And the second client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777701"
    And the client sends a propose envelope for session "77777777-7777-4777-8777-777777777701" with expectedSequence 3 targeting node "77777777-7777-4777-8777-777777777ab1"
    Then the client receives a proposed ack referencing the propose envelope at sequence 4
    And the client also receives an event-applied envelope for sequence 4
    And the second client receives an event-applied envelope for sequence 4

  Scenario: An unsubscribed client cannot propose — receives a forbidden error envelope
    Given a propose-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777702" and node id "77777777-7777-4777-8777-777777777ab2"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a propose envelope for session "77777777-7777-4777-8777-777777777702" with expectedSequence 3 targeting node "77777777-7777-4777-8777-777777777ab2"
    Then the client receives an error envelope with code "forbidden" referencing the propose envelope

  Scenario: A propose with a stale expectedSequence is rejected with sequence-mismatch
    Given a propose-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777703" and node id "77777777-7777-4777-8777-777777777ab3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777703"
    And the client sends a propose envelope for session "77777777-7777-4777-8777-777777777703" with expectedSequence 1 targeting node "77777777-7777-4777-8777-777777777ab3"
    Then the client receives an error envelope with code "sequence-mismatch" referencing the propose envelope

  # Server-enforced per-facet sequence gate — per
  # `pf_sequence_gate_server_enforced` + ADR 0030 §8 the propose
  # handler is the integrity boundary for the methodology's sequential
  # capture order. A `classify-node` against a node whose `wording`
  # facet is not `'agreed'` / `'committed'` is refused with the typed
  # `facet-sequence-out-of-order` error code; the connection stays
  # open (per ADR 0029).
  #
  # The seeded `propose-ready session` has a `node-created` event at
  # seq 3 with `wording: 'A claim ...'`; the wording facet's candidate
  # is the inline value, no votes have been cast, so the facet derives
  # to `'proposed'`. A `classify-node` against that node id fires the
  # gate.
  Scenario: A classify-node against a node whose wording facet is not agreed is refused at the wire (facet-sequence-out-of-order); the connection stays open
    Given a propose-ready session for "alice-ws" exists with id "77777777-7777-4777-8777-777777777704" and node id "77777777-7777-4777-8777-777777777ab4"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777704"
    And the client sends a classify-node propose envelope for session "77777777-7777-4777-8777-777777777704" with expectedSequence 3 targeting extant node "77777777-7777-4777-8777-777777777ab4"
    Then the client receives an error envelope with code "facet-sequence-out-of-order" referencing the propose envelope
    And the WebSocket connection is still open
