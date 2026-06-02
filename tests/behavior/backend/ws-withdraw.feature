Feature: WebSocket withdraw-proposal (client → server, proposer-only)

  An authenticated WebSocket client subscribed to a session may send a
  `withdraw-proposal` envelope to retract a pending proposal they are
  the original proposer of. Per ADR 0027 the entity layer and the
  facet layer are strictly separate — when a proposer rescinds their
  intent BEFORE the proposal commits, the entities the propose-time
  fan-out minted (e.g. a `node-created` + `entity-included` for a
  free-floating `classify-node`) must leave the structure via explicit
  `entity-removed` events. The server validates the request directly
  (the authority + state predicates live at the protocol layer — see
  refinement D1), allocates the next sequence number(s), INSERTs one
  `entity-removed` event per propose-time-minted entity into
  `session_events`, emits the `event-applied` broadcast(s) on every
  subscribed connection (including the proposer), and sends a
  `proposal-withdrawn` ack envelope to the originating client
  (`inResponseTo` correlated to the request's `id`). The proposer
  therefore receives BOTH the ack AND any matching broadcasts;
  non-proposer subscribed clients receive only the broadcasts.

  Proposer identity comes from the authenticated connection — the
  wire payload does NOT carry a `proposerId` field. A client cannot
  withdraw on behalf of someone else.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a non-proposer participant attempting withdraw
  yields `code: 'forbidden'` (the headline authority gate); a
  withdraw against an already-committed proposal yields
  `code: 'proposal-already-committed'`; an unsubscribed withdraw
  yields `code: 'forbidden'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row + a host
  participant row + a node row + a pending proposal (mirroring the
  propose-time fan-out's `node-created` + `entity-included` +
  `proposal` triple) are seeded, the withdraw envelope is sent, and
  the receiving client is inspected for the arrived frames.

  Refinement: tasks/refinements/backend/ws_withdraw_proposal_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0027-entity-and-facet-layers-strict-separation.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-withdraw" exists with screen_name "alice-withdraw"
    And the cucumber world has a valid session cookie for that user

  Scenario: The proposer withdraws their own pending classify-node proposal — proposal-withdrawn ack + event-applied broadcast for the entity-removed event on the proposer's own socket
    Given a withdrawable classify-node session for "alice-withdraw" exists with id "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1" and node id "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2" and pending proposal id "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
    And the client sends a withdraw-proposal envelope for session "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1" with expectedSequence 5 on proposal "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3"
    Then the client receives a proposal-withdrawn ack referencing the withdraw envelope with removedEventCount 1
    And the client also receives an event-applied envelope for an entity-removed event at sequence 6 with entity_id "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2"

  Scenario: A non-proposer subscribed participant cannot withdraw — receives a forbidden error envelope
    Given a withdrawable classify-node session hosted by "other-withdraw" with id "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1" and node id "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2" and pending proposal id "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3" where "alice-withdraw" is a debater
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1"
    And the client sends a withdraw-proposal envelope for session "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1" with expectedSequence 6 on proposal "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3"
    Then the client receives an error envelope with code "forbidden" referencing the withdraw envelope

  Scenario: A withdraw of an already-committed proposal is rejected with proposal-already-committed
    Given a committed-proposal session for "alice-withdraw" exists with id "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1" and node id "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2" and committed proposal id "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"
    And the client sends a withdraw-proposal envelope for session "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1" with expectedSequence 11 on proposal "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3"
    Then the client receives an error envelope with code "proposal-already-committed" referencing the withdraw envelope

  Scenario: A proposer withdraws their own zero-emission axiom-mark proposal — a proposal-withdrawn terminator event is appended, broadcast, and acked with removedEventCount 0; a re-withdraw is rejected proposal-not-found
    Given a withdrawable axiom-mark session for "alice-withdraw" exists with id "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" and node id "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2" and pending proposal id "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1"
    And the client sends a withdraw-proposal envelope for session "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" with expectedSequence 5 on proposal "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"
    Then the client receives a proposal-withdrawn ack referencing the withdraw envelope with removedEventCount 0
    And the client also receives an event-applied envelope for a proposal-withdrawn event at sequence 6 with proposal_id "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"
    And the session "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" log contains exactly one proposal-withdrawn event for proposal "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3" with a non-null withdrawn_by
    When the client sends a withdraw-proposal envelope for session "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" with expectedSequence 6 on proposal "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3"
    Then the client receives an error envelope with code "proposal-not-found" referencing the withdraw envelope

  Scenario: An unsubscribed client cannot withdraw — receives a forbidden error envelope
    Given a withdrawable classify-node session for "alice-withdraw" exists with id "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" and node id "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2" and pending proposal id "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a withdraw-proposal envelope for session "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" with expectedSequence 5 on proposal "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3"
    Then the client receives an error envelope with code "forbidden" referencing the withdraw envelope
