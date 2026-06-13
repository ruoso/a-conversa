Feature: GET /sessions/mine — the caller's own sessions, role-annotated

  The authenticated "My Sessions" surface. Unlike `GET /sessions` (which
  applies the public-visibility gate and AND-composes its filters), this
  endpoint returns exactly the sessions the caller is involved in —
  sessions they host OR in which they hold (or held) a
  `session_participants` row — with NO visibility gate. The caller always
  sees their own sessions regardless of privacy; a session they neither
  host nor participate in (even a public one) never appears.

  Each row is annotated with the caller's resolved `role` (precedence
  host > moderator > debater, the active participant row preferred over a
  historical one) so the client can route "join live" without a second
  request. Lobby (unstarted, NULL `started_at`) and ended sessions are
  both included; the list sorts lobby-first
  (`started_at DESC NULLS FIRST, created_at DESC`). Topic substring and
  `started_at` date-range filters narrow within the membership set, and
  `?limit`/`?offset` paginate with `total` carrying the full match count.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: the `sessions` (with `started_at`) and
  `session_participants` tables are real; the SELECT runs through the
  production handler via the same DbPool adapter the create-session and
  list-sessions scenarios use.

  Refinement: tasks/refinements/session_discovery/sd_my_sessions_endpoint.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user
    And a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"

  Scenario: membership scope + per-row role; non-member sessions are absent
    Given a started session with topic "Alice hosts" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    And a started session with topic "Alice moderates" hosted by "ben" started at "2026-05-10T09:00:00.000Z"
    And "alice" is a "moderator" participant in the session with topic "Alice moderates"
    And a started session with topic "Alice debates A" hosted by "ben" started at "2026-05-10T08:00:00.000Z"
    And "alice" is a "debater-A" participant in the session with topic "Alice debates A"
    And a started session with topic "Alice debates B" hosted by "ben" started at "2026-05-10T07:00:00.000Z"
    And "alice" is a "debater-B" participant in the session with topic "Alice debates B"
    And a started session with topic "Carol's public session" hosted by "carol" started at "2026-05-10T06:00:00.000Z"
    When I request my sessions
    Then the response status is 200
    And the response body contains a session with topic "Alice hosts" and role "host"
    And the response body contains a session with topic "Alice moderates" and role "moderator"
    And the response body contains a session with topic "Alice debates A" and role "debater-A"
    And the response body contains a session with topic "Alice debates B" and role "debater-B"
    And the response body does not contain a session with topic "Carol's public session"
    And the response body's total is 4

  Scenario: lobby, started, and ended sessions are all included
    Given a lobby session with topic "Alice's lobby" hosted by "alice"
    And a started session with topic "Alice's started" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    And an ended session with topic "Alice's ended" hosted by "alice" started at "2026-05-09T10:00:00.000Z"
    When I request my sessions
    Then the response status is 200
    And the response body's sessions array has 3 entries
    And the response body's total is 3

  Scenario: lobby sessions sort ahead of started ones; started by start time DESC
    Given a started session with topic "Started earlier" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Started later" hosted by "alice" started at "2026-05-10T12:00:00.000Z"
    And a lobby session with topic "Still in lobby" hosted by "alice"
    When I request my sessions
    Then the response status is 200
    And the response body's sessions[0].topic is "Still in lobby"
    And the response body's sessions[1].topic is "Started later"
    And the response body's sessions[2].topic is "Started earlier"

  Scenario: a caller who both hosts and participates gets role host
    Given a started session with topic "Alice both roles" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And "alice" is a "moderator" participant in the session with topic "Alice both roles"
    When I request my sessions
    Then the response status is 200
    And the response body contains a session with topic "Alice both roles" and role "host"

  Scenario: the active participant role wins over a historical (left) one
    Given a started session with topic "Ben's debate" hosted by "ben" started at "2026-05-10T08:00:00.000Z"
    And "alice" held a "debater-A" participant row in the session with topic "Ben's debate" but left
    And "alice" is a "moderator" participant in the session with topic "Ben's debate"
    When I request my sessions
    Then the response status is 200
    And the response body contains a session with topic "Ben's debate" and role "moderator"

  Scenario: ?topic substring match is case-insensitive
    Given a started session with topic "Climate change debate" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Cooking with steam" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    When I request my sessions filtered by topic "CLIMATE"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Climate change debate"
    And the response body's total is 1

  Scenario: ?startedAfter narrows by started_at and excludes lobby sessions
    Given a started session with topic "Ran in window" hosted by "alice" started at "2026-05-10T12:00:00.000Z"
    And a lobby session with topic "Never ran" hosted by "alice"
    When I request my sessions started after "2026-05-10T00:00:00.000Z"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Ran in window"
    And the response body's total is 1

  Scenario: an over-cap offset fails 400 validation-failed before any DB round-trip
    When I request my sessions with offset 100001
    Then the response status is 400
    And the response body's error.code is "validation-failed"

  Scenario: ?limit + ?offset paginates over the ordered set
    Given a started session with topic "Page A" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Page B" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    And a started session with topic "Page C" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    When I request my sessions with limit 2 and offset 0
    Then the response status is 200
    And the response body's sessions array has 2 entries
    And the response body's sessions[0].topic is "Page C"
    And the response body's sessions[1].topic is "Page B"
    And the response body's total is 3

  Scenario: a request with no session cookie is rejected 401 auth-required
    When I request my sessions without a session cookie
    Then the response status is 401
    And the response body's error.code is "auth-required"
