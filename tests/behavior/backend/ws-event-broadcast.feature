Feature: WebSocket event-applied broadcast

  When the server appends an event to `session_events` for a session,
  every WebSocket connection subscribed to that session receives an
  `event-applied` envelope carrying the appended event. Broadcasts are
  per-session: a client subscribed to one session receives broadcasts
  only for that session; a client that unsubscribes (or whose socket
  closes) receives no further broadcasts.

  These scenarios exercise the end-to-end fan-out path through the
  real WS upgrade (`app.injectWS`) against a pglite-backed pool — a
  session row is seeded, subscribed clients are opened, the broadcast
  bus is emitted, and the receiving clients are inspected for the
  arrived frames. The bus-emit step simulates what the route's post-
  commit-emit code path produces; the routes' own end-to-end test path
  is covered via the existing `routes.test.ts` Vitest suite which
  pins the INSERT → commit → emit ordering inside the handler.

  Refinement: tasks/refinements/backend/ws_event_broadcast.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: A subscribed client receives event-applied broadcasts for new events in the session
    Given a public session owned by "alice-ws" exists with id "66666666-6666-4666-8666-666666666601"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666601"
    And the server emits an event-applied broadcast for session "66666666-6666-4666-8666-666666666601" with sequence 1
    Then the client receives an event-applied envelope for sequence 1

  Scenario: Two clients subscribed to the same session both receive the same broadcast in the same order
    Given a public session owned by "alice-ws" exists with id "66666666-6666-4666-8666-666666666602"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666602"
    And a second authenticated WebSocket client connects to "/ws"
    And the second client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666602"
    And the server emits an event-applied broadcast for session "66666666-6666-4666-8666-666666666602" with sequence 1
    And the server emits an event-applied broadcast for session "66666666-6666-4666-8666-666666666602" with sequence 2
    Then the client receives event-applied envelopes with sequences 1 then 2
    And the second client receives event-applied envelopes with sequences 1 then 2

  Scenario: A client subscribed to session A does not receive broadcasts for session B
    Given a public session owned by "alice-ws" exists with id "66666666-6666-4666-8666-666666666603"
    And a public session owned by "alice-ws" exists with id "66666666-6666-4666-8666-666666666604"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666603"
    And the server emits an event-applied broadcast for session "66666666-6666-4666-8666-666666666604" with sequence 1
    Then the client receives no event-applied envelope within 200ms

  Scenario: Unsubscribed clients receive no broadcasts after unsubscribe
    Given a public session owned by "alice-ws" exists with id "66666666-6666-4666-8666-666666666605"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "66666666-6666-4666-8666-666666666605"
    And the client sends an unsubscribe envelope for session "66666666-6666-4666-8666-666666666605"
    And the server emits an event-applied broadcast for session "66666666-6666-4666-8666-666666666605" with sequence 1
    Then the client receives no event-applied envelope within 200ms
