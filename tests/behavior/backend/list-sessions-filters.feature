Feature: GET /sessions — query-string filters and pagination

  Builds on the visibility-gated `GET /sessions` (landed in
  `list_sessions_endpoint`) by layering optional query-string filters
  AND offset/limit pagination on top. Filters are AND-composed and
  narrow WITHIN the visibility gate — a caller asking
  `?host=<other-user>` only sees the matching sessions they were
  already permitted to see (public sessions, plus private sessions
  where the caller is a participant).

  The response shape grows from `{ sessions: [...] }` to
  `{ sessions: [...], total: integer }` — `total` is the count of
  rows matching visibility + filters BEFORE limit/offset, so a paged
  UI can render "showing 1-50 of N" accurately.

  This feature exercises the new surface end-to-end against the
  migrated schema in pglite: the `sessions` and `session_participants`
  tables are real; the SELECT runs through the production handler via
  the same DbPool adapter the create-session and list-sessions
  scenarios use.

  Refinement: tasks/refinements/backend/session_listing_filters.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user
    And a user with oauth_subject "authelia:ben" exists with screen_name "ben"

  Scenario: ?host narrows to sessions hosted by the supplied user id
    Given a public session with topic "Alice's hosted talk" exists for user "alice"
    And a public session with topic "Ben's hosted talk" exists for user "ben"
    When I GET /sessions filtered by host "ben"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Ben's hosted talk"
    And the response body's total is 1

  Scenario: ?privacy=private respects the visibility gate (non-participant sees nothing)
    Given a private session with topic "Alice's secret" exists for user "alice"
    When I GET /sessions filtered by privacy "private" as user "ben"
    Then the response status is 200
    And the response body's sessions array has 0 entries
    And the response body's total is 0

  Scenario: ?topic substring match is case-insensitive
    Given a public session with topic "Climate is changing" exists for user "alice"
    And a public session with topic "Cooking with steam" exists for user "alice"
    When I GET /sessions filtered by topic "CLIMATE"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Climate is changing"
    And the response body's total is 1

  Scenario: ?limit + ?offset paginates over the full visibility-gated set
    Given a public session with topic "Topic one" exists for that user at "2026-05-08T10:00:00.000Z"
    And a public session with topic "Topic two" exists for that user at "2026-05-08T11:00:00.000Z"
    And a public session with topic "Topic three" exists for that user at "2026-05-08T12:00:00.000Z"
    When I GET /sessions with limit 2 and offset 0
    Then the response status is 200
    And the response body's sessions array has 2 entries
    And the response body's sessions[0].topic is "Topic three"
    And the response body's sessions[1].topic is "Topic two"
    And the response body's total is 3
