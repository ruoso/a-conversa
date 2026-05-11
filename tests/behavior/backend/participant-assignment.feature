Feature: POST /sessions/:id/participants + DELETE /sessions/:id/participants/:userId — assign and remove participants

  An authenticated host POSTs a debater assignment (`debater-A` or
  `debater-B`) and the server INSERTs the `session_participants` row
  AND emits a `participant-joined` event into `session_events` at the
  next available sequence — atomic single transaction. The moderator
  role is reserved for the host and is assigned implicitly at session
  creation (Option A — the create-session transaction now writes the
  host's `session_participants` row + a `participant-joined` event at
  sequence=2 alongside the session-created event at sequence=1).

  The DELETE endpoint flips the active row's `left_at` to NOW() and
  emits a `participant-left` event. Either the host or the participant
  themselves may remove a participant; the moderator (the host at v1)
  cannot be removed via this endpoint.

  This feature exercises:
    - The implicit-moderator join landed automatically by
      `POST /sessions`.
    - The host assigning two debaters → both rows + both events land
      at consecutive sequences.
    - The non-host authority rejection.
    - The already-filled role rejection.
    - The host removing a debater → row's `left_at` flips and a
      `participant-left` event lands.

  Refinement: tasks/refinements/backend/participant_assignment.md
  ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
               docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the sessions server is built with the pglite-backed pool
    And a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user

  Scenario: Host creates a session — the moderator participant row and the participant-joined event auto-land
    When I POST /sessions with topic "Auto moderator" and privacy "public"
    Then the response status is 201
    And the session_participants table has 1 active row for the host as moderator
    And the session_events table has 1 row at sequence 2 with kind "participant-joined"
    And the participant-joined event at sequence 2 has role "moderator"

  Scenario: Host assigns debater-A then debater-B — both rows and events land at consecutive sequences
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"
    When I POST /sessions with topic "Two debaters" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A"
    Then the response status is 200
    And the response body's role is "debater-A"
    When I POST /sessions/:id/participants assigning user "carol" as role "debater-B"
    Then the response status is 200
    And the response body's role is "debater-B"
    And the session_events table has 1 row at sequence 3 with kind "participant-joined"
    And the session_events table has 1 row at sequence 4 with kind "participant-joined"
    And the session_participants table has 3 active rows for the most recent session

  Scenario: A non-host caller cannot assign a debater
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"
    When I POST /sessions with topic "Host gate" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A" as user "carol"
    Then the response status is 403
    And the response body's error.code is "not-a-moderator"

  Scenario: Assigning to an already-filled role is rejected
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    And a user with oauth_subject "authelia:carol" exists with screen_name "carol"
    When I POST /sessions with topic "Role collision" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A"
    Then the response status is 200
    When I POST /sessions/:id/participants assigning user "carol" as role "debater-A"
    Then the response status is 409
    And the response body's error.code is "role-already-filled"

  Scenario: Host removes a debater — left_at flips and a participant-left event lands
    Given a user with oauth_subject "authelia:ben" exists with screen_name "ben"
    When I POST /sessions with topic "Removal" and privacy "public"
    Then the response status is 201
    When I POST /sessions/:id/participants assigning user "ben" as role "debater-A"
    Then the response status is 200
    When I DELETE /sessions/:id/participants for user "ben"
    Then the response status is 200
    And the response body's leftAt is a non-null ISO timestamp
    And the session_participants row for user "ben" has left_at not null
    And the session_events table has 1 row at sequence 4 with kind "participant-left"
