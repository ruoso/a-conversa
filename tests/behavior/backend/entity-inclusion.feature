Feature: POST /sessions/:id/include — bring an existing global entity into the destination session

  The cross-session entity-inclusion endpoint composes the two
  cross-session-permission predicates landed by the previous siblings:
  destination-side visibility (`visibilityWhereFragment`) + active-
  participant check, AND source-side reachability (`canReference<Kind>`).
  When both predicates pass, the destination session has not ended, and
  the entity isn't already a member of the destination, the endpoint
  INSERTs a row into the matching `session_<kind>s` join table AND
  emits an `entity-included` event into `session_events` at the next
  available sequence — atomic single transaction.

  This feature exercises the end-to-end write path against the
  migrated schema in pglite. The `sessions`,
  `session_participants`, `nodes`, `edges`, `annotations`, and three
  `session_<kind>s` join tables are real; the endpoint runs through
  the production Fastify handler against the pglite-backed pool. Five
  scenarios cover the success path (a participant of a destination
  brings a node from a public source) and the four canonical
  rejection modes (non-participant, source-not-visible, already-
  included, destination-ended).

  Refinement: tasks/refinements/backend/entity_inclusion_endpoint.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: A participant of the destination brings a node from a public source session
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Source for inclusion" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion source
    And a node exists in the inclusion source seeded by "alice"
    When I POST /sessions with topic "Destination for inclusion" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion destination
    When I POST /sessions/:id/include with that node into the inclusion destination as "alice"
    Then the response status is 200
    And the response body's entityKind is "node"
    And the session_nodes table has 1 row for the destination linking to that node
    And the session_events table has 1 row at sequence 3 with kind "entity-included" in the destination

  Scenario: A non-participant of the destination cannot include an entity
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Source for ben non-participant" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion source
    And a node exists in the inclusion source seeded by "alice"
    When I POST /sessions with topic "Destination ben cannot enter" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion destination
    When I POST /sessions/:id/include with that node into the inclusion destination as "ben"
    Then the response status is 403
    And the response body's error.code is "not-a-participant"

  Scenario: An entity in a source session the caller cannot see is not referenceable
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Alice private source" and privacy "private"
    Then the response status is 201
    And I capture that session as the inclusion source
    And a node exists in the inclusion source seeded by "alice"
    When I POST /sessions with topic "Ben hosts destination" and privacy "public" as user "ben"
    Then the response status is 201
    And I capture that session as the inclusion destination
    When I POST /sessions/:id/include with that node into the inclusion destination as "ben"
    Then the response status is 403
    And the response body's error.code is "entity-not-referenceable"

  Scenario: Re-including the same entity into the destination is rejected
    When I POST /sessions with topic "Source for double include" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion source
    And a node exists in the inclusion source seeded by "alice"
    When I POST /sessions with topic "Destination for double include" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion destination
    When I POST /sessions/:id/include with that node into the inclusion destination as "alice"
    Then the response status is 200
    When I POST /sessions/:id/include with that node into the inclusion destination as "alice"
    Then the response status is 409
    And the response body's error.code is "entity-already-included"

  Scenario: Including an entity into an ended destination is rejected
    When I POST /sessions with topic "Source for ended dest" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion source
    And a node exists in the inclusion source seeded by "alice"
    When I POST /sessions with topic "Destination that ends" and privacy "public"
    Then the response status is 201
    And I capture that session as the inclusion destination
    When I POST /sessions/:id/end on the inclusion destination
    Then the response status is 200
    When I POST /sessions/:id/include with that node into the inclusion destination as "alice"
    Then the response status is 409
    And the response body's error.code is "session-already-ended"
