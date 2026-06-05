Feature: GET /sessions/:id/snapshots/:snapshotId — fetch one snapshot marker

  An authenticated user GETs /sessions/:id/snapshots/:snapshotId. The
  server resolves that one snapshot marker by its canonical `snapshotId`
  (a UUID — labels carry no uniqueness guarantee) and returns it as a bare
  `{ snapshotId, label, logPosition, createdAt }` record, gated by the same
  visibility predicate the session-metadata, event-log, and snapshot-list
  endpoints apply. A snapshot is a regular event (`kind: snapshot-created`),
  not a separate table; resolving one marker is a filtered read plus an
  in-memory match on `snapshot_id`.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: `sessions`, `session_participants`, and
  `session_events` are real tables; the read runs through the production
  handler against the same DbPool adapter the session-management
  scenarios use. This is the protocol-seam pin required by the backend
  e2e policy — the endpoint crosses the HTTP/replay boundary.

  Refinement: tasks/refinements/backend/get_snapshot.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the replay server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible session resolves a snapshot by its snapshotId
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a snapshot "Chapter two" at position 7
    And the most recently created session has a snapshot "Chapter one" at position 3
    When I GET the snapshot at position 7 for the most recently created session
    Then the response status is 200
    And the response body's snapshot label is "Chapter two"
    And the response body's snapshot logPosition is 7

  Scenario: A visible session queried with an unknown snapshotId returns 404
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a snapshot "Chapter one" at position 3
    When I GET the snapshot "00000000-0000-4000-8000-cccccccc0001" for the most recently created session
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: A private session is NOT visible to a non-participant (404)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And the most recently created session has a snapshot "Secret chapter" at position 2
    When I GET the snapshot at position 2 for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: An unknown session id returns 404
    When I GET the snapshot "00000000-0000-4000-8000-aaaaaaaa0001" for session "00000000-0000-4000-8000-ffffffff0001"
    Then the response status is 404
    And the response body's error.code is "not-found"
