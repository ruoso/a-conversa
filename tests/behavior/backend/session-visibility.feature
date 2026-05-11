Feature: Session visibility rule — public-by-default + host-marks-private

  The platform enforces a single visibility rule across every endpoint
  that reads `sessions.privacy`: an authenticated user can see a
  session iff (a) it is public, OR (b) they are the host, OR (c) they
  are or were a participant. The rule is implemented in
  `apps/server/src/sessions/visibility.ts` and consumed by every
  session-management endpoint (list, get, end, privacy-toggle,
  participant-assign, participant-remove).

  This feature exercises the rule end-to-end against the migrated
  schema in pglite. The `sessions` and `session_participants` tables
  are real; the `canSeeSession` predicate runs through the production
  module against pglite via the same DbPool adapter the create-session
  scenarios use. The basic-vs-filters split (per the refinement) means
  THIS feature covers the canonical visibility rule; sibling features
  (`list-sessions.feature`, `get-session.feature`,
  `end-session.feature`, etc.) cover the per-endpoint composition.

  Refinement: tasks/refinements/backend/privacy_field_enforcement.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And a user with oauth_subject "authelia:ben" exists with screen_name "ben"

  Scenario: A public session is visible to any authenticated user
    Given a public session with topic "Public discussion" exists for user "alice"
    When I ask whether user "ben" can see the most recently created session
    Then the visibility predicate returns true

  Scenario: A private session is visible to its host
    Given a private session with topic "Alice's private debate" exists for user "alice"
    When I ask whether user "alice" can see the most recently created session
    Then the visibility predicate returns true

  Scenario: A private session is visible to an active participant
    Given a private session with topic "Alice's private debate" exists for user "alice"
    And user "ben" is a participant in that private session
    When I ask whether user "ben" can see the most recently created session
    Then the visibility predicate returns true

  Scenario: A private session is visible to a historical (left) participant
    Given a private session with topic "Alice's private debate" exists for user "alice"
    And user "ben" is a historical (left) participant in that private session
    When I ask whether user "ben" can see the most recently created session
    Then the visibility predicate returns true

  Scenario: A private session is NOT visible to a stranger
    Given a private session with topic "Alice's private debate" exists for user "alice"
    When I ask whether user "ben" can see the most recently created session
    Then the visibility predicate returns false

  Scenario: An unknown session id is not visible to anyone
    When I ask whether user "alice" can see the session with id "00000000-0000-4000-8000-000000000000"
    Then the visibility predicate returns false
