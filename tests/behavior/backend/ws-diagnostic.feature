Feature: WebSocket diagnostic broadcast

  When a structural diagnostic fires or clears for a session (cycle,
  contradiction, multi-warrant, dangling-claim, or coherency-hint),
  every WebSocket connection subscribed to that session receives a
  `diagnostic` envelope carrying the affected entry, its severity
  classification (`blocking` or `advisory`), and the status (`fired`
  or `cleared`). Broadcasts are per-session: a client subscribed to
  one session receives diagnostics only for that session.

  These scenarios exercise the end-to-end fan-out path through the
  real WS upgrade (`app.injectWS`) against a pglite-backed pool — a
  session row is seeded, subscribed clients are opened, the diagnostic
  broadcast surface is driven via `app.wsDiagnosticBroadcast.notifyForSession(...)`,
  and the receiving clients are inspected for the arrived frames. The
  notify step simulates what the projection-cache wiring will produce
  AFTER `applyEvent` re-computes the diagnostic snapshot (a future
  task wires the cache to the bus; this task delivers the bridge
  surface the wiring will call).

  Refinement: tasks/refinements/backend/ws_diagnostic_broadcast.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: A subscribed client receives a diagnostic envelope when a cycle fires for the session
    Given a public session owned by "alice-ws" exists with id "77777777-7777-4777-8777-777777777701"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777701"
    And the server notifies a cycle diagnostic fired for session "77777777-7777-4777-8777-777777777701" at sequence 1
    Then the client receives a diagnostic envelope with kind "cycle" and severity "blocking" and status "fired"

  Scenario: A subscribed client receives a diagnostic envelope when a contradiction clears for the session
    Given a public session owned by "alice-ws" exists with id "77777777-7777-4777-8777-777777777702"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777702"
    And the server notifies a contradiction diagnostic cleared for session "77777777-7777-4777-8777-777777777702" at sequence 4
    Then the client receives a diagnostic envelope with kind "contradiction" and severity "blocking" and status "cleared"

  Scenario: A client subscribed to session A does not receive diagnostic broadcasts for session B
    Given a public session owned by "alice-ws" exists with id "77777777-7777-4777-8777-777777777703"
    And a public session owned by "alice-ws" exists with id "77777777-7777-4777-8777-777777777704"
    When an authenticated WebSocket client connects to "/ws"
    And the client sends a subscribe envelope for session "77777777-7777-4777-8777-777777777703"
    And the server notifies a cycle diagnostic fired for session "77777777-7777-4777-8777-777777777704" at sequence 1
    Then the client receives no diagnostic envelope within 200ms
