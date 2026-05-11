Feature: WebSocket mark-meta-disagreement (client → server, moderator-only)

  An authenticated WebSocket client subscribed to a session may send a
  `mark-meta-disagreement` envelope. The methodology engine's
  `markMetaDisagreementHandler` enforces moderator-only authority —
  only the session's moderator may mark a pending proposal as
  meta-disagreement. The server validates the request through the
  engine, allocates the next sequence number, INSERTs the resulting
  `meta-disagreement-marked` event into `session_events`, emits the
  `event-applied` broadcast on every subscribed connection (including
  the moderator), and sends a `meta-disagreement-marked` ack envelope
  to the originating client (`inResponseTo` correlated to the
  request's `id`). The moderator therefore receives BOTH frames;
  non-moderator subscribed clients receive only the `event-applied`
  broadcast.

  Marking a proposal as meta-disagreement is the methodology's
  last-resort escape valve (per `docs/methodology.md` lines 203–212):
  when diagnostic tests and decomposition have failed to resolve a
  facet-level dispute, the moderator declares the disagreement
  irreducible. The affected facet's status transitions to
  `meta-disagreement` and the proposal moves from `pendingProposals`
  to `unresolvedMetaDisagreements`, terminating the proposal's life
  cycle with a typed not-decided outcome.

  Moderator identity comes from the authenticated connection — the
  wire payload does NOT carry a `moderatorId` field. A client cannot
  mark on behalf of someone else.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a non-moderator participant attempting mark
  yields `code: 'not-a-moderator'` (the headline authority gate); a
  mark on an already-committed proposal yields
  `code: 'proposal-already-committed'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row +
  participant rows + a node row + a pending proposal + a recorded
  dispute (so the methodology-exhaustion gate passes) are seeded, the
  mark envelope is sent, and the receiving clients are inspected for
  the arrived frames.

  Refinement: tasks/refinements/backend/ws_meta_disagreement_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: The moderator marks a pending proposal as meta-disagreement — ack + broadcast on the moderator's socket
    Given a markable session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa901" and node id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9a01" and pending proposal id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b01" with a recorded dispute
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa901"
    And the client sends a mark-meta-disagreement envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa901" with expectedSequence 7 on proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b01"
    Then the client receives a meta-disagreement-marked ack referencing the mark envelope at sequence 8
    And the client also receives an event-applied envelope for the meta-disagreement-marked event at sequence 8

  Scenario: A non-moderator subscribed participant cannot mark — receives a not-a-moderator error envelope
    Given a markable session hosted by "other-host" with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa902" and node id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9a02" and pending proposal id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b02" where "alice-ws" is a debater with a recorded dispute
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa902"
    And the client sends a mark-meta-disagreement envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa902" with expectedSequence 6 on proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b02"
    Then the client receives an error envelope with code "not-a-moderator" referencing the mark envelope

  Scenario: A mark on an already-committed proposal is rejected with proposal-already-committed
    Given a committed-proposal session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa903" and node id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9a03" and pending proposal id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b03"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa903"
    And the client sends a mark-meta-disagreement envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa903" with expectedSequence 8 on proposal "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa9b03"
    Then the client receives an error envelope with code "proposal-already-committed" referencing the mark envelope
