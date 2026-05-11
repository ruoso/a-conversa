Feature: GET /sessions — list the sessions visible to the caller

  An authenticated user GETs /sessions. The server returns every
  session the caller is permitted to see — public sessions for any
  authenticated user; private sessions only for the host or a
  current/past participant — ordered `created_at` DESC. The response
  wraps the list under a `sessions` key.

  This feature exercises the visibility gate end-to-end against the
  migrated schema in pglite: the `sessions` and `session_participants`
  tables are real; the SELECT runs through the production handler
  against pglite via the same DbPool adapter the create-session
  scenarios use. The basic-vs-filters split (per the refinement) means
  THIS feature covers the canonical visibility question; the sibling
  `session_listing_filters` task layers further query params on top.

  Refinement: tasks/refinements/backend/list_sessions_endpoint.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: An empty database returns an empty sessions list
    When I GET /sessions
    Then the response status is 200
    And the response body's sessions array has 0 entries

  Scenario: Two public sessions are listed in created_at DESC order
    Given a public session with topic "Older debate" exists for that user at "2026-05-08T10:00:00.000Z"
    And a public session with topic "Newer debate" exists for that user at "2026-05-09T10:00:00.000Z"
    When I GET /sessions
    Then the response status is 200
    And the response body's sessions array has 2 entries
    And the response body's sessions[0].topic is "Newer debate"
    And the response body's sessions[1].topic is "Older debate"

  Scenario: A private session is NOT visible to a non-participant
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    When I GET /sessions as user "ben"
    Then the response status is 200
    And the response body's sessions array has 0 entries

  Scenario: A private session IS visible to a participant
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And user "ben" is a participant in that private session
    When I GET /sessions as user "ben"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Alice's private"
    And the response body's sessions[0].privacy is "private"
