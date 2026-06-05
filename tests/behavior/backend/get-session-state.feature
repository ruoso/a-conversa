Feature: GET /sessions/:id/state — projected state at a log position

  An authenticated user GETs /sessions/:id/state?position=N. The server
  reads the session's event log, replays it to position N, and returns
  the materialized projection as `{ sessionId, sequence, projection }` —
  byte-identical in field names and structure to the WS `snapshot`
  payload, so a consumer can reuse WS-snapshot handling code unchanged.
  Where GET /sessions/:id/events returns the raw event log (the source of
  truth), this endpoint returns the derived view, gated by the same
  visibility predicate the session-metadata and event-log endpoints
  apply. Position is event-sequence space: 0 is the empty baseline; N is
  the state after the event whose sequence === N.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: `sessions`, `session_participants`, and
  `session_events` are real tables; the read runs through the production
  handler — including the real replay primitive — against the same
  DbPool adapter the session-management scenarios use. This is the
  protocol-seam pin required by the backend e2e policy — the endpoint
  crosses the HTTP/replay boundary.

  Refinement: tasks/refinements/backend/get_at_position.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the replay server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible session returns its full-log projection at the head position
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log
    When I GET the state at position 3 for the most recently created session
    Then the response status is 200
    And the response body's sequence is 3
    And the response body's projection.lastAppliedSequence is 3
    And the response body's projection.nodes array has 1 entry

  Scenario: A visible session returns the empty baseline projection at position 0
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log
    When I GET the state at position 0 for the most recently created session
    Then the response status is 200
    And the response body's sequence is 0
    And the response body's projection.lastAppliedSequence is 0
    And the response body's projection.nodes array has 0 entries

  Scenario: A private session is NOT visible to a non-participant (404)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And the most recently created session has a projectable event log
    When I GET the state at position 0 for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: A position above the log's head sequence returns 400 (out of range)
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log
    When I GET the state at position 99 for the most recently created session
    Then the response status is 400
    And the response body's error.code is "validation-failed"
