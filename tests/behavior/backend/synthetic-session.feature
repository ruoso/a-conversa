Feature: Test-mode synthetic-session generator — list + generate through the real write path

  The non-production test-mode plugin lets an authenticated operator
  conjure a synthetic session for design iteration without three live
  participants. `GET /test-mode/synthetic-scenarios` lists the scenarios
  the server can build; `POST /test-mode/synthetic-sessions` mints a
  fresh session owned by the caller and appends a validated event log
  through the SAME production write path (`validateEvent` +
  `appendSessionEvent`) a live session flows through — so the generated
  session is a real persisted session the existing read path serves
  unchanged. An unknown scenario 400s; an unauthenticated POST 401s.

  Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
  ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And the test-mode server is built with the pglite-backed pool
    And I have a valid session cookie for that user

  Scenario: The scenario list advertises the bundled descriptors
    When I GET /test-mode/synthetic-scenarios with the session cookie
    Then the response status is 200
    And the response body's scenarios include "empty"
    And the response body's scenarios include "structured"

  Scenario: Generating the empty scenario persists a real session log owned by the caller
    When I POST /test-mode/synthetic-sessions with scenario "empty"
    Then the response status is 201
    And the response body carries a sessionId
    And the generated session is owned by that user
    And the generated session has session_events at sequences "1,2,3,4"

  Scenario: Generating the structured scenario persists a non-empty log
    When I POST /test-mode/synthetic-sessions with scenario "structured"
    Then the response status is 201
    And the response body carries a sessionId
    And the generated session has more than 4 session_events

  Scenario: An unknown scenario is rejected
    When I POST /test-mode/synthetic-sessions with scenario "does-not-exist"
    Then the response status is 400
    And the response body's error.code is "validation-failed"

  Scenario: An unauthenticated generate is rejected
    When I POST /test-mode/synthetic-sessions with scenario "empty" and no session cookie
    Then the response status is 401
    And the response body's error.code is "auth-required"
