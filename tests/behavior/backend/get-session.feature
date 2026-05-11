Feature: GET /sessions/:id — fetch a single session's metadata

  An authenticated user GETs /sessions/:id. The server returns the
  session's metadata if and only if the caller can see it — public
  sessions for any authenticated user; private sessions only for the
  host or a current/past participant. When the id does not exist OR
  exists but is invisible to the caller, the server returns 404 —
  the two cases are deliberately indistinguishable to avoid leaking
  the existence of private sessions to unauthorized callers.

  This feature exercises the visibility gate end-to-end against the
  migrated schema in pglite: the `sessions` and `session_participants`
  tables are real; the SELECT runs through the production handler
  against pglite via the same DbPool adapter the create-session
  scenarios use.

  Refinement: tasks/refinements/backend/get_session_endpoint.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible public session is returned with the SessionResponse shape
    Given a public session with topic "Visible to all" exists for that user at "2026-05-09T10:00:00.000Z"
    When I GET /sessions/:id for the most recently created session
    Then the response status is 200
    And the response body's topic is "Visible to all"
    And the response body's privacy is "public"
    And the response body's hostUserId matches the user's id

  Scenario: A private session is NOT visible to a non-participant (404, not 403)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    When I GET /sessions/:id for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: An unknown session id returns 404 not-found
    When I GET /sessions/00000000-0000-4000-8000-000000000000
    Then the response status is 404
    And the response body's error.code is "not-found"
