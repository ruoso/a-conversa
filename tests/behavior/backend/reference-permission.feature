Feature: Cross-session reference permission rule — entity reachability via any visible origin

  The platform's cross-session reference rule extends the session
  visibility predicate to globally-stored entities (nodes, edges,
  annotations): an entity is referenceable by caller C iff at least
  ONE of the sessions it lives in is visible to C per the visibility
  rule. The rule is implemented in
  `apps/server/src/sessions/references.ts` and will be consumed by
  the upcoming `POST /sessions/:id/include` endpoint.

  This feature exercises the rule end-to-end against the migrated
  schema in pglite. The `sessions`, `session_participants`, `nodes`,
  `edges`, `annotations`, and three `session_<kind>s` join tables
  are all real; the `canReference<Kind>` predicates run through the
  production module against the pglite-backed pool. The basic-vs-
  derived split mirrors `session-visibility.feature` — THIS feature
  pins the cross-session rule, and the upcoming inclusion-endpoint
  feature will cover the HTTP surface that composes this predicate
  with the participant-of-destination check.

  Refinement: tasks/refinements/backend/reference_permission_check.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given a user with screen name "alice" exists for reference tests
    And a user with screen name "ben" exists for reference tests
    And a user with screen name "carl" exists for reference tests

  Scenario: A node in a public origin is referenceable by any authenticated user
    Given a public session hosted by "alice" includes a fresh node
    When I ask whether user "ben" can reference that node
    Then the reference predicate returns true

  Scenario: A node in a private origin is referenceable by the origin host
    Given a private session hosted by "alice" includes a fresh node
    When I ask whether user "alice" can reference that node
    Then the reference predicate returns true

  Scenario: A node in a private origin is NOT referenceable by a stranger
    Given a private session hosted by "alice" includes a fresh node
    When I ask whether user "ben" can reference that node
    Then the reference predicate returns false

  Scenario: A multi-origin node is referenceable by a stranger via the public origin
    Given a private session hosted by "alice" includes a fresh node
    And a public session hosted by "carl" also includes that same node
    When I ask whether user "ben" can reference that node
    Then the reference predicate returns true

  Scenario: An edge in a private origin is NOT referenceable by a stranger
    Given a private session hosted by "alice" includes a fresh edge
    When I ask whether user "ben" can reference that edge
    Then the reference predicate returns false

  Scenario: An annotation in a public origin is referenceable by any authenticated user
    Given a public session hosted by "alice" includes a fresh annotation
    When I ask whether user "ben" can reference that annotation
    Then the reference predicate returns true
