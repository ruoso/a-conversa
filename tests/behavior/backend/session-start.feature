Feature: POST /sessions/:id/start — moderator advances the session out of the lobby

  An authenticated user POSTs to /sessions/:id/start to advance a debate
  session from the `lobby` mode into the `operate` mode. Only the host
  (the moderator at v1) may start the session. The server emits a
  `session-mode-changed` event into `session_events` at the next
  available sequence; the event is broadcast to every subscribed WS
  connection by the existing post-commit emit path
  (`apps/server/src/sessions/routes.ts`'s
  `app.wsBroadcast.emit({ event })`).

  Per ADR 0028 the dedicated event is the canonical signal for the
  lobby → operate transition; the participant lobby's auto-navigation
  `useEffect` consumes the event as its primary trigger, and the
  predecessor's first-content-event heuristic is retained as a
  defense-in-depth fallback.

  Visibility-then-authority ordering: invisible private sessions return
  404 BEFORE the authority check fires, preserving the
  existence-non-leak property. Visible-but-not-host returns 403
  `not-a-moderator`. An ended session returns 422
  `session-already-ended`. A re-POST against a session already in the
  `operate` mode is idempotent: 200 with the session row and NO second
  event emitted (Decision §5 of the refinement).

  This feature exercises the visibility + authority gates AND the
  transactional event INSERT end-to-end against the migrated schema in
  pglite — `sessions` and `session_events` are real tables; the
  visibility-gated SELECT + MAX(sequence) + INSERT chain runs through
  the production handler against the pglite-backed DbPool adapter.

  Refinement: tasks/refinements/participant-ui/part_session_start_handoff_dedicated_event.md
  ADRs:        docs/adr/0028-session-mode-changed-wire-event.md,
               docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Host starts an active session — session-mode-changed event lands at sequence 3
    # The create-session amendment from participant_assignment writes a
    # `participant-joined` event for the host (as moderator) at sequence
    # 2, so the subsequent session-mode-changed event lands at sequence 3.
    When I POST /sessions with topic "A debate to start" and privacy "public"
    Then the response status is 201
    And the sessions row's started_at is null
    When I POST /sessions/:id/start for the most recently created session
    Then the response status is 200
    And the response body's topic is "A debate to start"
    And the response body's endedAt is null
    And the sessions row's started_at is not null
    And the session_events table has 1 row at sequence 3 with kind "session-mode-changed"
    And the session-mode-changed event's payload new_mode is "operate"
    And the session-mode-changed event's payload previous_mode is "lobby"
    And the session-mode-changed event's payload changed_by matches the user's id
    And the session-mode-changed event's payload changed_at is a non-null ISO timestamp

  Scenario: Non-host caller is rejected with 403 not-a-moderator
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Alice's session to start" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/start for the most recently created session as user "ben"
    Then the response status is 403
    And the response body's error.code is "not-a-moderator"
    And no session-mode-changed event has been recorded for the most recently created session

  Scenario: Already-started session — idempotent re-POST returns 200 with no second event
    When I POST /sessions with topic "Start me twice" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/start for the most recently created session
    Then the response status is 200
    And the sessions row's started_at is not null
    And the session_events table has 1 row at sequence 3 with kind "session-mode-changed"
    When I remember the sessions row's started_at
    When I POST /sessions/:id/start for the most recently created session
    Then the response status is 200
    And the session_events table has 1 row at sequence 3 with kind "session-mode-changed"
    And only 1 session-mode-changed event exists for the most recently created session
    And the sessions row's started_at is unchanged

  Scenario: Ended session is rejected with 422 session-already-ended
    When I POST /sessions with topic "End me before start" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I POST /sessions/:id/start for the most recently created session
    Then the response status is 422
    And the response body's error.code is "session-already-ended"

  Scenario: Unknown session id returns 404 not-found
    When I POST /sessions/00000000-0000-4000-8000-00000000ff00/start
    Then the response status is 404
    And the response body's error.code is "not-found"
