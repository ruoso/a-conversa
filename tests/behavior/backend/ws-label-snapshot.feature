Feature: WebSocket label-snapshot (client → server, moderator-only)

  An authenticated WebSocket client subscribed to a session may send a
  `label-snapshot` envelope. The WS handler enforces moderator-only
  authority at the wire layer — only the session's moderator
  (`sessions.host_user_id`) may mint a labeled snapshot. The server
  reads the row under FOR UPDATE, confirms the requester is the
  moderator, validates the optimistic-concurrency token
  (`expectedSequence`), calls the standalone `createSnapshot` engine
  helper to validate the label and mint a `snapshot-created` event
  envelope, INSERTs the event into `session_events`, emits the
  `event-applied` broadcast on every subscribed connection (including
  the moderator), and sends a `snapshot-labeled` ack envelope to the
  originating client (`inResponseTo` correlated to the request's
  `id`). The moderator therefore receives BOTH frames;
  non-moderator subscribed clients receive only the `event-applied`
  broadcast.

  Moderator identity comes from the authenticated connection — the
  wire payload does NOT carry a `moderatorId` field. A client cannot
  mint a snapshot on behalf of someone else.

  Rejection paths surface as canonical `error` envelopes (per
  `ws_error_message`): a non-moderator participant attempting
  label-snapshot yields `code: 'moderator-only'` (the headline
  authority gate); a stale `expectedSequence` yields
  `code: 'sequence-mismatch'`.

  These scenarios exercise the end-to-end wire path through the real
  WS upgrade (`app.injectWS`) against pglite — a session row +
  participant rows are seeded, the label-snapshot envelope is sent,
  and the receiving client is inspected for the arrived frames.

  Refinement: tasks/refinements/backend/ws_label_snapshot_message.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: The moderator labels a snapshot at the current sequence — ack + broadcast on the moderator's socket
    Given a snapshottable session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa701"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa701"
    And the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa701" with expectedSequence 2 and label "Segment 1 close"
    Then the client receives a snapshot-labeled ack referencing the label-snapshot envelope
    And the client also receives an event-applied envelope for the snapshot-created event at sequence 3

  Scenario: A non-moderator subscribed participant cannot label a snapshot — receives a moderator-only error envelope
    Given a snapshottable session hosted by "other-host" with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa702" where "alice-ws" is a debater
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa702"
    And the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa702" with expectedSequence 3 and label "Segment 1 close"
    Then the client receives an error envelope with code "moderator-only" referencing the label-snapshot envelope

  Scenario: A stale expectedSequence is rejected with sequence-mismatch
    Given a snapshottable session for "alice-ws" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa703"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa703"
    And the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa703" with expectedSequence 1 and label "Segment 1 close"
    Then the client receives an error envelope with code "sequence-mismatch" referencing the label-snapshot envelope
