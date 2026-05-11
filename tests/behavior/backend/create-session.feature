Feature: POST /sessions — create a debate session

  An authenticated user POSTs a topic (and optional privacy) to
  /sessions. The server inserts the sessions row AND emits the
  corresponding `session-created` event into `session_events` at
  sequence=1 atomically (single transaction). The response carries the
  created session in camelCase. Without auth the endpoint 401s. A
  malformed body (empty topic, etc.) 400s with the canonical
  `validation-failed` envelope.

  Refinement: tasks/refinements/backend/create_session_endpoint.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Successful creation writes both the sessions row and the session-created event
    When I POST /sessions with topic "Is the moon made of cheese?" and privacy "private"
    Then the response status is 201
    And the response body's hostUserId matches the user's id
    And the response body's privacy is "private"
    And the response body's topic is "Is the moon made of cheese?"
    And the response body's endedAt is null
    And the sessions table has 1 row for that host
    And the session_events table has 1 row at sequence 1 with kind "session-created"
    And the session-created event's payload host_user_id matches the user's id
    And the session-created event's payload privacy is "private"
    And the session-created event's payload topic is "Is the moon made of cheese?"

  Scenario: Privacy defaults to public when the body omits it
    When I POST /sessions with topic "A default-privacy debate" and no privacy field
    Then the response status is 201
    And the response body's privacy is "public"
    And the sessions row's privacy is "public"
    And the session-created event's payload privacy is "public"

  Scenario: Empty topic is rejected
    When I POST /sessions with topic "" and no privacy field
    Then the response status is 400
    And the response body's error.code is "validation-failed"
    And the sessions table has 0 rows for that host
    And the session_events table has 0 rows
