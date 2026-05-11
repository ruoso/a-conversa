Feature: WebSocket auth on connect

  The `GET /ws` upgrade endpoint is gated by the same
  `aconversa-session` cookie the HTTP auth middleware reads. An
  upgrade without the cookie — or with a cookie whose JWT fails
  verification — is refused with HTTP 401 + the canonical error
  envelope (`{ error: { code: "auth-required", ... } }`) BEFORE the
  WebSocket handshake completes. A valid cookie permits the upgrade,
  the server mints a per-connection id, attaches the authenticated
  user to the per-connection context, and emits the hello frame.

  Refinement: tasks/refinements/backend/ws_auth_on_connect.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool

  Scenario: an upgrade with no session cookie is refused with HTTP 401
    When a WebSocket client connects to "/ws" without a session cookie
    Then the WebSocket upgrade is refused with HTTP status 401

  Scenario: an upgrade with a valid session cookie succeeds and the hello frame arrives
    Given a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user
    When a WebSocket client connects to "/ws" with the session cookie
    Then the WebSocket upgrade completes and a hello frame arrives
