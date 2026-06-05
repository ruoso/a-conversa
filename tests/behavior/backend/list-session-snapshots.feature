Feature: GET /sessions/:id/snapshots — list a session's snapshot markers

  An authenticated user GETs /sessions/:id/snapshots. The server returns
  all of that session's snapshot markers — the moderator-created labeled
  checkpoints — each as `{ snapshotId, label, logPosition, createdAt }`,
  ordered by `logPosition` ascending (chapter order), gated by the same
  visibility predicate the session-metadata and event-log endpoints
  apply. A snapshot is a regular event (`kind: snapshot-created`), not a
  separate table; the response wraps the markers under a `snapshots` key.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: `sessions`, `session_participants`, and
  `session_events` are real tables; the read runs through the production
  handler against the same DbPool adapter the session-management
  scenarios use. This is the protocol-seam pin required by the backend
  e2e policy — the endpoint crosses the HTTP/replay boundary.

  Refinement: tasks/refinements/backend/list_snapshots.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the replay server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible session returns its snapshots in logPosition ascending order
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a snapshot "Chapter two" at position 7
    And the most recently created session has a snapshot "Chapter one" at position 3
    When I GET the snapshots for the most recently created session
    Then the response status is 200
    And the response body's snapshots array has 2 entries
    And the response body's snapshots[0].logPosition is 3
    And the response body's snapshots[0].label is "Chapter one"
    And the response body's snapshots[1].logPosition is 7
    And the response body's snapshots[1].label is "Chapter two"

  Scenario: A visible session with no snapshots returns an empty list (200)
    Given a public session with topic "Quiet debate" exists for that user at "2026-05-09T10:00:00.000Z"
    When I GET the snapshots for the most recently created session
    Then the response status is 200
    And the response body's snapshots array has 0 entries

  Scenario: A private session is NOT visible to a non-participant (404)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And the most recently created session has a snapshot "Secret chapter" at position 2
    When I GET the snapshots for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: An unknown session id returns 404
    When I GET the snapshots for session "00000000-0000-4000-8000-ffffffff0001"
    Then the response status is 404
    And the response body's error.code is "not-found"

  # ----------------------------------------------------------------
  # Create→list round-trip — the producer→consumer contract.
  #
  # The scenarios above seed snapshots directly as fixtures. These two
  # prove the seam the `replay_test.snapshots` consumers stand on: a
  # snapshot created through the REAL moderator write-path (the
  # `label-snapshot` WS handler, step machinery reused from
  # ws-label-snapshot.feature) is retrievable, in the same session,
  # through GET /sessions/:id/snapshots — same snapshotId, same label,
  # same logPosition. Both halves run against the one shared pglite
  # world: the WS app writes the `snapshot-created` event; the replay
  # app reads it back. The snapshottable seed lands MAX(sequence)=2, so
  # the first labeled snapshot takes sequence 3 (and logPosition 3),
  # the second takes sequence 4.
  #
  # Refinement: tasks/refinements/replay_test/snapshot_creation_ui.md
  # ----------------------------------------------------------------

  Scenario: A moderator-created snapshot is listable with matching identity (write-path → REST read)
    Given a ws-auth-gated server is built against the pglite-backed pool
    And the cucumber world has a valid session cookie for that user
    And a snapshottable session for "alice" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa801"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa801"
    And the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa801" with expectedSequence 2 and label "Chapter one"
    Then the client receives a snapshot-labeled ack referencing the label-snapshot envelope
    When I GET the snapshots for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa801"
    Then the response status is 200
    And the response body's snapshots array has 1 entry
    And the response body's snapshots[0].label is "Chapter one"
    And the response body's snapshots[0].logPosition is 3
    And the response body's snapshots[0].snapshotId matches the snapshot-labeled ack

  Scenario: Two moderator-created snapshots accumulate in logPosition-ascending order (write-path → REST read)
    Given a ws-auth-gated server is built against the pglite-backed pool
    And the cucumber world has a valid session cookie for that user
    And a snapshottable session for "alice" exists with id "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa802"
    When an authenticated WebSocket client connects to "/api/ws"
    And the client sends a subscribe envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa802"
    And the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa802" with expectedSequence 2 and label "Opening"
    Then the client receives a snapshot-labeled ack referencing the label-snapshot envelope
    When the client sends a label-snapshot envelope for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa802" with expectedSequence 3 and label "Closing"
    Then the client receives a snapshot-labeled ack referencing the label-snapshot envelope
    When I GET the snapshots for session "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa802"
    Then the response status is 200
    And the response body's snapshots array has 2 entries
    And the response body's snapshots[0].logPosition is 3
    And the response body's snapshots[0].label is "Opening"
    And the response body's snapshots[1].logPosition is 4
    And the response body's snapshots[1].label is "Closing"
