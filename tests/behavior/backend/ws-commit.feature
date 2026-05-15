Feature: WebSocket commit (client → server, moderator-only)

  An authenticated WebSocket client subscribed to a session may send a
  `commit` envelope. The methodology engine's `commitHandler` enforces
  moderator-only authority — only the session's moderator may commit a
  pending proposal. The server validates the request through the
  engine, allocates the next sequence number, INSERTs the resulting
  `commit` event into `session_events`, emits the `event-applied`
  broadcast on every subscribed connection (including the moderator),
  and sends a `committed` ack envelope to the originating client
  (`inResponseTo` correlated to the request's `id`). The moderator
  therefore receives BOTH frames; non-moderator subscribed clients
  receive only the `event-applied` broadcast.

  Moderator identity comes from the authenticated connection — the
  wire payload does NOT carry a `moderatorId` field. A client cannot
  commit on behalf of someone else.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a non-moderator participant attempting commit
  yields `code: 'not-a-moderator'` (the headline authority gate); a
  commit before unanimous-agree yields
  `code: 'unanimous-agree-required'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row + a host
  participant row + a node row + a pending proposal + the three
  agree votes are seeded, the commit envelope is sent, and the
  receiving clients are inspected for the arrived frames.

  Refinement: tasks/refinements/backend/ws_commit_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: The moderator commits a unanimously-agreed proposal — committed ack + event-applied broadcast on the moderator's own socket
    Given a commit-ready session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999901" and node id "99999999-9999-4999-8999-9999999999a1" and pending proposal id "99999999-9999-4999-8999-9999999999b1" with all participants agreeing
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "99999999-9999-4999-8999-999999999901"
    And the client sends a commit envelope for session "99999999-9999-4999-8999-999999999901" with expectedSequence 9 on proposal "99999999-9999-4999-8999-9999999999b1"
    Then the client receives a committed ack referencing the commit envelope at sequence 10
    And the client also receives an event-applied envelope for the commit at sequence 10

  Scenario: A non-moderator subscribed participant cannot commit — receives a not-a-moderator error envelope
    Given a commit-ready session hosted by "other-host" with id "99999999-9999-4999-8999-999999999902" and node id "99999999-9999-4999-8999-9999999999a2" and pending proposal id "99999999-9999-4999-8999-9999999999b2" where "alice-ws" is a debater
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "99999999-9999-4999-8999-999999999902"
    And the client sends a commit envelope for session "99999999-9999-4999-8999-999999999902" with expectedSequence 5 on proposal "99999999-9999-4999-8999-9999999999b2"
    Then the client receives an error envelope with code "not-a-moderator" referencing the commit envelope

  Scenario: A commit before unanimous-agree is rejected with unanimous-agree-required
    Given a half-agree session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999903" and node id "99999999-9999-4999-8999-9999999999a3" and pending proposal id "99999999-9999-4999-8999-9999999999b3" where only the moderator has agreed
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "99999999-9999-4999-8999-999999999903"
    And the client sends a commit envelope for session "99999999-9999-4999-8999-999999999903" with expectedSequence 6 on proposal "99999999-9999-4999-8999-9999999999b3"
    Then the client receives an error envelope with code "unanimous-agree-required" referencing the commit envelope

  Scenario: An unsubscribed client cannot commit — receives a forbidden error envelope
    Given a commit-ready session for "alice-ws" exists with id "99999999-9999-4999-8999-999999999904" and node id "99999999-9999-4999-8999-9999999999a4" and pending proposal id "99999999-9999-4999-8999-9999999999b4" with all participants agreeing
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a commit envelope for session "99999999-9999-4999-8999-999999999904" with expectedSequence 9 on proposal "99999999-9999-4999-8999-9999999999b4"
    Then the client receives an error envelope with code "forbidden" referencing the commit envelope
