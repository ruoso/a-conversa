Feature: GET /sessions/:id/events — paginated event log

  An authenticated user GETs /sessions/:id/events. The server returns
  that session's persisted event log as a forward, sequence-ordered,
  cursor-paginated stream — the raw events themselves, in replay order
  — gated by the same visibility predicate the session-metadata
  endpoints apply. The response wraps the events under an `events` key
  and carries `nextCursor` (the sequence to pass as the next `?after`,
  or null at the head of the log).

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: `sessions`, `session_participants`, and
  `session_events` are real tables; the read runs through the
  production handler against the same DbPool adapter the
  session-management scenarios use. This is the protocol-seam pin
  required by the backend e2e policy — the endpoint crosses the
  HTTP/replay boundary.

  Refinement: tasks/refinements/backend/get_session_log.md
  ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the replay server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible session returns its events in ascending sequence order
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has 3 events
    When I GET the events for the most recently created session
    Then the response status is 200
    And the response body's events array has 3 entries
    And the response body's events[0].sequence is 1
    And the response body's events[2].sequence is 3
    And the response body's nextCursor is null

  Scenario: Paging with after + limit walks the log to nextCursor null
    Given a public session with topic "Long debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has 5 events
    When I GET the events for the most recently created session with limit 2
    Then the response status is 200
    And the response body's events array has 2 entries
    And the response body's events[0].sequence is 1
    And the response body's nextCursor is 2
    When I GET the events for the most recently created session with limit 2 after 2
    Then the response status is 200
    And the response body's events array has 2 entries
    And the response body's events[0].sequence is 3
    And the response body's nextCursor is 4
    When I GET the events for the most recently created session with limit 2 after 4
    Then the response status is 200
    And the response body's events array has 1 entry
    And the response body's events[0].sequence is 5
    And the response body's nextCursor is null

  Scenario: A private session is NOT visible to a non-participant (404)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And the most recently created session has 2 events
    When I GET the events for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: An unknown session id returns 404
    When I GET the events for session "00000000-0000-4000-8000-ffffffff0001"
    Then the response status is 404
    And the response body's error.code is "not-found"
