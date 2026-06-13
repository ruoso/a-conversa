Feature: POST /sessions/:id/restart — moderator reopens an ended session

  An authenticated user POSTs to /sessions/:id/restart to reopen a
  session that was previously ended. Only the host (the moderator at v1)
  may restart the session. The server clears the row's `ended_at` back
  to NULL (the row returns to the `live` derived status — `started_at`
  is untouched) AND emits a `session-restarted` event into
  `session_events` at the next available sequence — both writes are
  atomic (single transaction). It is the exact authority/visibility
  mirror of the end endpoint, with the state precondition inverted.

  Visibility-then-authority ordering: invisible private sessions return
  404 BEFORE the authority check fires, preserving the
  existence-non-leak property. Visible-but-not-host returns 403
  `not-a-moderator`. A not-ended (live/lobby) session returns 409
  `session-not-ended` — restart is deliberately NOT idempotent, since
  only an ended session can be reopened.

  This feature exercises the visibility + authority gates AND the
  transactional row + event write end-to-end against the migrated
  schema in pglite — `sessions` and `session_events` are real tables;
  the UPDATE + MAX(sequence) + INSERT chain runs through the production
  handler against the pglite-backed DbPool adapter. The round-trip
  scenario additionally replays the full event log through the
  projection loader to prove the `session-restarted` kind replays clean.

  Refinement: tasks/refinements/session_lifecycle/sl_restart_endpoint.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Host restarts an ended session — ended_at clears, session-restarted event lands at sequence 4
    # POST /sessions writes session-created (seq 1) + the host's
    # participant-joined (seq 2); the end below writes session-ended
    # (seq 3); the restart's session-restarted event lands at seq 4.
    When I POST /sessions with topic "A debate to reopen" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I POST /sessions/:id/restart for the most recently created session
    Then the response status is 200
    And the response body's topic is "A debate to reopen"
    And the response body's endedAt is null
    And the sessions row's ended_at is null
    And the sessions row's started_at is unchanged by the restart
    And the session_events table has 1 row at sequence 4 with kind "session-restarted"
    And the session-restarted event's payload is an empty object

  Scenario: Restart a not-ended (live) session returns 409 session-not-ended
    When I POST /sessions with topic "Never ended" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/restart for the most recently created session
    Then the response status is 409
    And the response body's error.code is "session-not-ended"
    And the sessions row's ended_at is null
    And no session-restarted event was appended

  Scenario: Non-host caller is rejected with 403 not-a-moderator
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Alice's session to reopen" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I POST /sessions/:id/restart for the most recently created session as user "ben"
    Then the response status is 403
    And the response body's error.code is "not-a-moderator"
    And the sessions row's ended_at is not null

  Scenario: Unknown session id returns 404 not-found
    When I POST /sessions/00000000-0000-4000-8000-000000000000/restart
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: End then restart replays clean to the open state
    When I POST /sessions with topic "Round-trip replay" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I POST /sessions/:id/restart for the most recently created session
    Then the response status is 200
    And replaying the session's event log yields a projection in the open state
