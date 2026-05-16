Feature: POST /sessions/:id/invite/claim — debater self-claims a role slot via an invite URL

  An authenticated debater follows the moderator's shared invite URL
  (`<origin>/sessions/<id>/invite?role=<role>`), authenticates, and
  POSTs the role they want to claim to this endpoint. The server
  transactionally INSERTs a `session_participants` row for the caller
  AND emits a `participant-joined` event into `session_events` at the
  next available sequence — atomic single transaction. The caller's
  id is implicit from the session cookie; the body carries only
  `{ role }`.

  The host (the implicit moderator from the create-session amendment)
  is BLOCKED from self-claiming a debater slot — they already hold the
  moderator slot for the session's lifetime. Repeat self-claims by the
  same caller are rejected with 409 `user-already-joined`; foreign
  collisions on the same role surface as 409 `role-already-filled`.
  No tokenized invitations in v1; the visibility model is the gate
  (public OR host OR existing-participant on private).

  This feature exercises:
    - The happy path: another debater self-claims debater-A on a
      public session created by the host → 200 + new row + new event
      with `actor === payload.user_id`.
    - A repeat self-claim by the same caller → 409 user-already-joined.
    - A foreign-user collision on the same role → 409 role-already-filled.
    - An unknown session id → 404 not-found (no existence leak).
    - An unauthenticated POST → 401 auth-required.

  Refinement: tasks/refinements/backend/session_invite_self_claim_endpoint.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Authenticated debater self-claims debater-A on a public session
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Self-claim happy path" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/invite/claim for the most recently created session as user "ben" with role "debater-A"
    Then the response status is 200
    And the response body's role is "debater-A"
    And the response body's userId matches the user "ben"
    And the session_participants table has 2 active rows for the most recent session
    And the session_events table has 1 row at sequence 3 with kind "participant-joined"
    And the participant-joined event at sequence 3 has role "debater-A"
    And the participant-joined event at sequence 3 has actor matching its payload user_id

  Scenario: Repeat self-claim by the same caller is rejected
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Repeat claim" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/invite/claim for the most recently created session as user "ben" with role "debater-A"
    Then the response status is 200
    When I POST /sessions/:id/invite/claim for the most recently created session as user "ben" with role "debater-A"
    Then the response status is 409
    And the response body's error.code is "user-already-joined"
    And the session_participants table has 2 active rows for the most recent session
    And the session_events table has 0 rows at sequence 4

  Scenario: Foreign-user collision on the same role is rejected
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:maria" exists with screen_name "maria"
    When I POST /sessions with topic "Slot collision" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/invite/claim for the most recently created session as user "ben" with role "debater-A"
    Then the response status is 200
    When I POST /sessions/:id/invite/claim for the most recently created session as user "maria" with role "debater-A"
    Then the response status is 409
    And the response body's error.code is "role-already-filled"
    And the session_participants table has 2 active rows for the most recent session

  Scenario: Unknown session id returns 404 (no existence leak)
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions/00000000-0000-4000-8000-ffffffff0099/invite/claim as user "ben" with role "debater-A"
    Then the response status is 404
    And the response body's error.code is "not-found"

  Scenario: Unauthenticated POST returns 401 auth-required
    When I POST /sessions with topic "Auth required" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/invite/claim for the most recently created session with no cookie and role "debater-A"
    Then the response status is 401
    And the response body's error.code is "auth-required"
