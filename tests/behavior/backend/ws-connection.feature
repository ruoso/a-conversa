Feature: WebSocket connection lifecycle

  The backend WebSocket route at GET /ws upgrades incoming requests
  via @fastify/websocket, mints a per-connection UUID, sends a
  placeholder hello envelope, and emits a structured 1001 close on
  server shutdown. Auth, subscription, the canonical message
  envelope, message types, and broadcasts are all separate downstream
  websocket_protocol tasks; these scenarios cover only the lifecycle
  primitive.

  Refinement: tasks/refinements/backend/ws_connection_handling.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Scenario: a connecting client receives a placeholder hello frame
    Given an HTTP server built from createServer
    When a WebSocket client connects to "/ws"
    Then the client receives a placeholder hello frame with a UUID connectionId

  Scenario: a client-initiated close completes cleanly
    Given an HTTP server built from createServer
    When a WebSocket client connects to "/ws"
    And the client closes the WebSocket with code 1000
    Then the WebSocket close handshake completes with code 1000

  Scenario: server shutdown closes in-flight WebSocket connections with 1001
    Given an HTTP server built from createServer
    When a WebSocket client connects to "/ws"
    And the server closes the HTTP application
    Then the WebSocket received a server-shutdown close with code 1001 and reason "server-shutting-down"
