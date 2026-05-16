Feature: GET /sessions/:id/participants — list a session's participants

  An authenticated user GETs /sessions/:id/participants. The server
  returns every `session_participants` row for the session — active AND
  historical (`left_at IS NOT NULL` from leave-and-rejoin churn) — in
  a stable `joined_at ASC, id ASC` order. Visibility is routed through
  the canonical `canSeeSession` predicate (public OR host OR
  current/past participant); invisible sessions collapse to 404
  `not-found` (existence-non-leak, identical envelope to "unknown id").

  This feature exercises the endpoint end-to-end against the real
  migrated schema in pglite: `sessions` and `session_participants` are
  real tables; the SELECT runs through the production handler against
  pglite via the same DbPool adapter the create-session scenarios use.

  Privacy-gated 404 is NOT re-asserted here — that property is already
  covered by `get_session_endpoint`'s Cucumber suite, and the
  visibility predicate is the SAME function (`canSeeSession`). The
  Vitest layer (`apps/server/src/sessions/routes.test.ts`) pins the
  same property at the handler-level seam.

  Refinement: tasks/refinements/backend/list_session_participants_endpoint.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A freshly-created session returns the implicit-moderator row
    When I POST /sessions with topic "Solo lobby" and privacy "public"
    Then the response status is 201
    When I GET /sessions/:id/participants for the most recently created session
    Then the response status is 200
    And the response body's participants array has 1 entry
    And the participants entry at index 0 has role "moderator"
    And the participants entry at index 0 has leftAt null

  Scenario: After two debater assignments the list returns 3 rows in joined_at ASC order
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"
    When I POST /sessions with topic "Three slots" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A"
    Then the response status is 200
    When I POST /sessions/:id/participants assigning user "carol" as role "debater-B"
    Then the response status is 200
    When I GET /sessions/:id/participants for the most recently created session
    Then the response status is 200
    And the response body's participants array has 3 entries
    And the participants entry at index 0 has role "moderator"
    And the participants entry at index 1 has role "debater-A"
    And the participants entry at index 2 has role "debater-B"

  Scenario: After a debater is removed the list still returns 3 rows with leftAt populated for the removed row
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"
    When I POST /sessions with topic "Removal trail" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A"
    Then the response status is 200
    When I POST /sessions/:id/participants assigning user "carol" as role "debater-B"
    Then the response status is 200
    When I DELETE /sessions/:id/participants for user "ben"
    Then the response status is 200
    When I GET /sessions/:id/participants for the most recently created session
    Then the response status is 200
    And the response body's participants array has 3 entries
    And the participants entry at index 0 has role "moderator"
    And the participants entry at index 0 has leftAt null
    And the participants entry at index 1 has role "debater-A"
    And the participants entry at index 1 has a non-null leftAt
    And the participants entry at index 2 has role "debater-B"
    And the participants entry at index 2 has leftAt null
