Feature: PATCH /sessions/:id/privacy — host toggles session privacy

  An authenticated host PATCHes /sessions/:id/privacy with a body of
  { privacy: 'public' | 'private' } to flip the session's privacy
  column. Only the host (the moderator at v1) may toggle. Live
  sessions only — an ended session returns 409
  `session-already-ended` (privacy at end-time is the frozen value).

  No `session-privacy-changed` event is written — privacy is session-
  row metadata, not a methodology-level fact about the debate. See
  `tasks/refinements/backend/session_privacy_toggle.md` "Option B".

  Visibility-then-authority ordering: invisible private sessions
  return 404 BEFORE the authority check fires, preserving the
  existence-non-leak property. Visible-but-not-host returns 403
  `not-a-moderator`.

  This feature exercises the visibility + authority + lifecycle gates
  AND the UPDATE against the real migrated schema's CHECK constraint
  (`CHECK (privacy IN ('public','private'))`) in pglite. The handler
  runs end-to-end against the pglite-backed DbPool adapter.

  Refinement: tasks/refinements/backend/session_privacy_toggle.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Host toggles public to private — subsequent GET returns private
    When I POST /sessions with topic "Switch me" and privacy "public"
    Then the response status is 201
    When I PATCH /sessions/:id/privacy for the most recently created session with privacy "private"
    Then the response status is 200
    And the response body's privacy is "private"
    And the sessions row's privacy is "private"
    And the session_events table has 1 rows

  Scenario: Non-host caller is rejected with 403 not-a-moderator
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Alice's session" and privacy "public"
    Then the response status is 201
    When I PATCH /sessions/:id/privacy for the most recently created session as user "ben" with privacy "private"
    Then the response status is 403
    And the response body's error.code is "not-a-moderator"
    And the sessions row's privacy is "public"

  Scenario: Ended session returns 409 session-already-ended
    When I POST /sessions with topic "End then privatize" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/end for the most recently created session
    Then the response status is 200
    When I PATCH /sessions/:id/privacy for the most recently created session with privacy "private"
    Then the response status is 409
    And the response body's error.code is "session-already-ended"
    And the sessions row's privacy is "public"
