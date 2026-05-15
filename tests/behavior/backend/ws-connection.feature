Feature: WebSocket connection lifecycle

  The backend WebSocket route at GET /ws upgrades incoming requests
  via @fastify/websocket, mints a per-connection UUID, sends the
  canonical hello envelope (`{ type: 'hello', id, payload: { connectionId } }`),
  and emits a structured 1001 close on server shutdown. Auth on the
  upgrade is owned by `ws_auth_on_connect`; the message envelope is
  owned by `ws_message_envelope` — these scenarios now run AGAINST the
  auth-gated test app (`__buildTestWsApp` + a pglite-backed pool +
  a valid session cookie) because the `/ws` upgrade refuses
  unauthenticated requests. Subscription, message types, and
  broadcasts are downstream websocket_protocol tasks.

  Refinement: tasks/refinements/backend/ws_connection_handling.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool
    And a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user

  Scenario: a connecting client receives a canonical hello envelope
    When an authenticated WebSocket client connects to "/api/ws"
    Then the client receives a hello envelope with a UUID connectionId

  Scenario: a client-initiated close completes cleanly
    When an authenticated WebSocket client connects to "/api/ws"
    And the client closes the WebSocket with code 1000
    Then the WebSocket close handshake completes with code 1000

  Scenario: server shutdown closes in-flight WebSocket connections with 1001
    When an authenticated WebSocket client connects to "/api/ws"
    And the server closes the WebSocket application
    Then the WebSocket received a server-shutdown close with code 1001 and reason "server-shutting-down"
