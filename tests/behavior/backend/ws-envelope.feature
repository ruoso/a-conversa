Feature: WebSocket message envelope

  The backend WebSocket route at GET /ws emits and accepts messages
  wrapped in the canonical envelope defined by `ws_message_envelope`:
  `{ type, id, payload, inResponseTo? }`. The placeholder hello frame
  `ws_connection_handling` shipped is replaced by the envelope-shaped
  equivalent (`{ type: 'hello', id, payload: { connectionId } }`).

  These scenarios cover the envelope behavior end-to-end through the
  real upgrade path (via @fastify/websocket's `app.injectWS`). The
  malformed-message scenario asserts the dispatcher's drop-and-stay-
  open contract — the wire-format error envelope is `ws_error_message`'s
  job, NOT this task; here we cover the seam (the connection survives
  garbage input rather than crashing).

  Refinement: tasks/refinements/backend/ws_message_envelope.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Scenario: a connecting client receives the canonical hello envelope
    Given an authenticated WebSocket test app
    When an authenticated WebSocket client connects to "/ws"
    Then the client receives a canonical hello envelope with a UUID id and a UUID connectionId

  Scenario: a malformed client message is dropped without closing the connection
    Given an authenticated WebSocket test app
    When an authenticated WebSocket client connects to "/ws"
    And the client sends the malformed frame "{ not valid json"
    Then the WebSocket connection is still open
