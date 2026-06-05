Feature: GET /sessions/:id/diagnostics — structural diagnostics at a log position

  An authenticated user GETs /sessions/:id/diagnostics?position=N. The
  server reads the session's event log, replays it to position N, and runs
  the methodology engine's structural detectors over the resulting
  projection, returning `{ diagnostics: [...] }` — the bare DiagnosticEntry
  objects (cycles, contradictions, multi-warrants, dangling claims,
  coherency hints), each keyed on a string `kind`. It is the
  diagnostics-shaped sibling of GET /sessions/:id/state: where /state
  returns the projected state, this returns the diagnostics that state
  yields. Position is event-sequence space: 0 is the empty baseline (no
  diagnostics); N is the state after the event whose sequence === N.

  This feature exercises the endpoint end-to-end against the migrated
  schema in pglite: `sessions`, `session_participants`, and
  `session_events` are real tables; the read runs through the production
  handler — including the real replay primitive AND the real detectors —
  against the same DbPool adapter the session-management scenarios use.
  This is the protocol-seam pin required by the backend e2e policy — the
  endpoint crosses the HTTP/replay boundary and emits projector-derived
  detector output.

  Refinement: tasks/refinements/backend/get_diagnostics_at_position.md
  ADRs:        docs/adr/0044-replay-position-diagnostics-via-backend-endpoint.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md,
               docs/adr/0007-cucumber-pglite-for-protocol-seam.md

  Background:
    Given the replay server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A visible session returns its full-log diagnostics at the head position
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log with a structural diagnostic
    When I GET the diagnostics at position 5 for the most recently created session
    Then the response status is 200
    And the response body's diagnostics array contains an entry of kind "dangling-claim"

  Scenario: A visible session returns no diagnostics at position 0 (empty baseline)
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log with a structural diagnostic
    When I GET the diagnostics at position 0 for the most recently created session
    Then the response status is 200
    And the response body's diagnostics array is empty

  Scenario: A private session is NOT visible to a non-participant (404)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a private session with topic "Alice's private" exists for user "alice"
    And the most recently created session has a projectable event log with a structural diagnostic
    When I GET the diagnostics at position 0 for the most recently created session as user "ben"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: A position above the log's head sequence returns 400 (out of range)
    Given a public session with topic "Public debate" exists for that user at "2026-05-09T10:00:00.000Z"
    And the most recently created session has a projectable event log with a structural diagnostic
    When I GET the diagnostics at position 99 for the most recently created session
    Then the response status is 400
    And the response body's error.code is "validation-failed"
