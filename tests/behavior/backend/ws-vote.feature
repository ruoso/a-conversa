Feature: WebSocket vote (client → server)

  An authenticated WebSocket client subscribed to a session may send a
  `vote` envelope. The server validates the request through the
  methodology engine's `voteHandler` (three arms — `agree`, `dispute`,
  `withdraw`), allocates the next sequence number, INSERTs the
  resulting `vote` event into `session_events`, emits the
  `event-applied` broadcast on every subscribed connection (including
  the voter), and sends a `voted` ack envelope to the originating
  client (`inResponseTo` correlated to the request's `id`). The voter
  therefore receives BOTH frames; non-voter subscribed clients
  receive only the `event-applied` broadcast.

  Voter identity comes from the authenticated connection — the wire
  payload does NOT carry a `voterId` field. A client cannot vote on
  behalf of someone else.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a vote without a prior `subscribe` yields
  `code: 'forbidden'`; a duplicate vote yields
  `code: 'already-voted'`; a withdraw of a still-pending proposal
  yields `code: 'no-prior-agree'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row + a
  participant row + a node row + a pending proposal are seeded, the
  vote envelope is sent, and the receiving clients are inspected for
  the arrived frames.

  Refinement: tasks/refinements/backend/ws_vote_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: A subscribed participant agrees on a proposal — voter receives both voted ack and event-applied broadcast, second subscribed client receives the broadcast
    Given a vote-ready session for "alice-ws" exists with id "88888888-8888-4888-8888-888888888801" and node id "88888888-8888-4888-8888-8888888888a1" and pending proposal id "88888888-8888-4888-8888-8888888888b1"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "88888888-8888-4888-8888-888888888801"
    And a second authenticated WebSocket client connects to "/api/ws"
    And the second client sends a subscribe envelope for session "88888888-8888-4888-8888-888888888801"
    And the client sends a vote envelope for session "88888888-8888-4888-8888-888888888801" with expectedSequence 5 on proposal "88888888-8888-4888-8888-8888888888b1" choosing "agree"
    Then the client receives a voted ack referencing the vote envelope at sequence 6
    And the client also receives an event-applied envelope for the vote at sequence 6
    And the second client receives an event-applied envelope for the vote at sequence 6

  Scenario: A duplicate agree from the same voter is rejected with already-voted
    Given a vote-ready session for "alice-ws" exists with id "88888888-8888-4888-8888-888888888802" and node id "88888888-8888-4888-8888-8888888888a2" and pending proposal id "88888888-8888-4888-8888-8888888888b2"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "88888888-8888-4888-8888-888888888802"
    And the client sends a vote envelope for session "88888888-8888-4888-8888-888888888802" with expectedSequence 5 on proposal "88888888-8888-4888-8888-8888888888b2" choosing "agree"
    And the client waits for the voted ack
    And the client sends a vote envelope for session "88888888-8888-4888-8888-888888888802" with expectedSequence 6 on proposal "88888888-8888-4888-8888-8888888888b2" choosing "agree"
    Then the client receives an error envelope with code "already-voted" referencing the vote envelope

  Scenario: A withdraw of a still-pending proposal is rejected with no-prior-agree
    Given a vote-ready session for "alice-ws" exists with id "88888888-8888-4888-8888-888888888803" and node id "88888888-8888-4888-8888-8888888888a3" and pending proposal id "88888888-8888-4888-8888-8888888888b3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "88888888-8888-4888-8888-888888888803"
    And the client sends a vote envelope for session "88888888-8888-4888-8888-888888888803" with expectedSequence 5 on proposal "88888888-8888-4888-8888-8888888888b3" choosing "withdraw"
    Then the client receives an error envelope with code "no-prior-agree" referencing the vote envelope

  Scenario: An unsubscribed client cannot vote — receives a forbidden error envelope
    Given a vote-ready session for "alice-ws" exists with id "88888888-8888-4888-8888-888888888804" and node id "88888888-8888-4888-8888-8888888888a4" and pending proposal id "88888888-8888-4888-8888-8888888888b4"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a vote envelope for session "88888888-8888-4888-8888-888888888804" with expectedSequence 5 on proposal "88888888-8888-4888-8888-8888888888b4" choosing "agree"
    Then the client receives an error envelope with code "forbidden" referencing the vote envelope
