Feature: POST /sessions/:id/end — moderator ends a debate session

  An authenticated user POSTs to /sessions/:id/end to mark the session
  ended. Only the host (the moderator at v1) may end the session. The
  server flips the row's `ended_at` from NULL to NOW() AND emits a
  `session-ended` event into `session_events` at the next available
  sequence — both writes are atomic (single transaction). The row stays
  for replay/history.

  Visibility-then-authority ordering: invisible private sessions return
  404 BEFORE the authority check fires, preserving the
  existence-non-leak property. Visible-but-not-host returns 403
  `not-a-moderator`. An already-ended session returns 409
  `session-already-ended` — re-ending is deliberately NOT idempotent.

  This feature exercises the visibility + authority gates AND the
  transactional row + event write end-to-end against the migrated
  schema in pglite — `sessions` and `session_events` are real tables;
  the UPDATE + MAX(sequence) + INSERT chain runs through the production
  handler against the pglite-backed DbPool adapter.

  Refinement: tasks/refinements/backend/end_session_endpoint.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Host ends an active session — row flips, session-ended event lands at sequence 2
    When I POST /sessions with topic "A debate to end" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    And the response body's topic is "A debate to end"
    And the response body's endedAt is a non-null ISO timestamp
    And the sessions row's ended_at is not null
    And the session_events table has 1 row at sequence 2 with kind "session-ended"
    And the session-ended event's payload ended_at is a non-null ISO timestamp

  Scenario: Non-host caller is rejected with 403 not-a-moderator
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Alice's session" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session as user "ben"
    Then the response status is 403
    And the response body's error.code is "not-a-moderator"
    And the sessions row's ended_at is null

  Scenario: Already-ended session returns 409 session-already-ended
    When I POST /sessions with topic "End me twice" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 409
    And the response body's error.code is "session-already-ended"

  Scenario: Unknown session id returns 404 not-found
    When I POST /sessions/00000000-0000-4000-8000-000000000000/end
    Then the response status is 404
    And the response body's error.code is "not-found"
