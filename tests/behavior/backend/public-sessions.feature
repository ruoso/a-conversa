Feature: GET /sessions/public — anonymous, started-only public list

  The anonymous "Public Sessions" discovery surface. Returns exactly the
  public, already-started sessions (`privacy = 'public' AND started_at IS
  NOT NULL`) so anyone — signed in or not — can browse what there is to
  watch or replay. It requires NO authentication and ignores any session
  cookie entirely.

  The lobby-secrecy gate is load-bearing: a lobby (unstarted, `started_at
  IS NULL`) public session — whose id is still the join secret — never
  appears, and a private session never appears. Each row carries only the
  listing fields `id, topic, startedAt, endedAt` — no host identity, no
  privacy flag, no participant data. Both live started sessions (the
  "join live" target, `endedAt = null`) and ended ones (the "see replay"
  target, `endedAt` set) are included; the client keys the affordance on
  `endedAt`. The list sorts `started_at DESC, created_at DESC`; topic
  substring and `started_at` date-range filters narrow within the public
  set, and `?limit`/`?offset` paginate with `total` carrying the full
  match count.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: the `sessions` table (with `started_at`) is real and
  the SELECT runs through the production handler via the same DbPool
  adapter the create-session and list-sessions scenarios use.

  Refinement: tasks/refinements/session_discovery/sd_public_sessions_endpoint.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0029-anonymous-public-session-access.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: the gate excludes lobby and private sessions; only started public appears
    Given a started session with topic "Started public" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    And a lobby session with topic "Lobby public" hosted by "alice"
    And a started private session with topic "Started private" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    When I request the public sessions
    Then the response status is 200
    And the response body contains a session with topic "Started public"
    And the response body does not contain a session with topic "Lobby public"
    And the response body does not contain a session with topic "Started private"
    And the response body's total is 1

  Scenario: both live and ended started public sessions are included
    Given a started session with topic "Live debate" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    And an ended session with topic "Ended debate" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    When I request the public sessions
    Then the response status is 200
    And the response body's sessions array has 2 entries
    And the response body's session with topic "Live debate" has a null endedAt
    And the response body's session with topic "Ended debate" has a non-null endedAt

  Scenario: a request with no session cookie returns 200 with the list, not 401
    Given a started session with topic "Anyone can watch" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    When I request the public sessions without a session cookie
    Then the response status is 200
    And the response body contains a session with topic "Anyone can watch"
    And the response body's total is 1

  Scenario: a valid cookie does not widen the result — auth is ignored, not required
    Given a started session with topic "Public started" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    And a started private session with topic "My private session" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    When I request the public sessions with my session cookie
    Then the response status is 200
    And the response body contains a session with topic "Public started"
    And the response body does not contain a session with topic "My private session"
    And the response body's total is 1

  Scenario: a returned row exposes only the listing fields
    Given a started session with topic "Listing fields only" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    When I request the public sessions
    Then the response status is 200
    And every returned session exposes only id, topic, startedAt, endedAt

  Scenario: rows sort most-recently-started first
    Given a started session with topic "Started earlier" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Started later" hosted by "alice" started at "2026-05-10T12:00:00.000Z"
    When I request the public sessions
    Then the response status is 200
    And the response body's sessions[0].topic is "Started later"
    And the response body's sessions[1].topic is "Started earlier"

  Scenario: ?topic substring match is case-insensitive
    Given a started session with topic "Climate change debate" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Cooking with steam" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    When I request the public sessions filtered by topic "CLIMATE"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Climate change debate"
    And the response body's total is 1

  Scenario: ?startedAfter narrows by started_at
    Given a started session with topic "Ran in window" hosted by "alice" started at "2026-05-10T12:00:00.000Z"
    And a started session with topic "Ran earlier" hosted by "alice" started at "2026-05-09T12:00:00.000Z"
    When I request the public sessions started after "2026-05-10T00:00:00.000Z"
    Then the response status is 200
    And the response body's sessions array has 1 entry
    And the response body's sessions[0].topic is "Ran in window"
    And the response body's total is 1

  Scenario: an over-cap offset fails 400 validation-failed before any DB round-trip
    When I request the public sessions with offset 100001
    Then the response status is 400
    And the response body's error.code is "validation-failed"

  Scenario: ?limit + ?offset paginates over the ordered set
    Given a started session with topic "Page A" hosted by "alice" started at "2026-05-10T08:00:00.000Z"
    And a started session with topic "Page B" hosted by "alice" started at "2026-05-10T09:00:00.000Z"
    And a started session with topic "Page C" hosted by "alice" started at "2026-05-10T10:00:00.000Z"
    When I request the public sessions with limit 2 and offset 0
    Then the response status is 200
    And the response body's sessions array has 2 entries
    And the response body's sessions[0].topic is "Page C"
    And the response body's sessions[1].topic is "Page B"
    And the response body's total is 3
