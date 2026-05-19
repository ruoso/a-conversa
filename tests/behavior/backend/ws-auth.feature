Feature: WebSocket auth on connect

  The `GET /api/ws` upgrade endpoint reads the same
  `aconversa-session` cookie the HTTP auth middleware reads. A valid
  cookie permits the upgrade and the server attaches the authenticated
  user to the per-connection context. Per ADR 0029 +
  `aud_anonymous_ws_subscribe`, an upgrade without the cookie — or
  with a cookie whose JWT fails verification — is NO LONGER 401:
  the gate falls through to anonymous (`request.authUser = undefined`)
  and the upgrade completes; the subscribe handler discriminates by
  `connection.user === undefined` and the
  `canSeeSessionAnonymously` predicate enforces the per-session
  privacy boundary at the data layer. The origin-allowlist gate
  (`ws_origin_allowlist`) is unchanged and still rejects off-origin
  upgrades with HTTP 403.

  Refinement: tasks/refinements/backend/ws_auth_on_connect.md
               tasks/refinements/audience/aud_anonymous_ws_subscribe.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md

  Background:
    Given a ws-auth-gated server is built against the pglite-backed pool

  Scenario: an upgrade with no session cookie completes as anonymous and a hello frame arrives
    When a WebSocket client connects to "/api/ws" without a session cookie
    Then the WebSocket upgrade completes anonymously and a hello frame arrives

  Scenario: an upgrade with a valid session cookie succeeds and the hello frame arrives
    Given a user with oauth_subject "authelia:alice-ws" exists with screen_name "alice-ws"
    And the cucumber world has a valid session cookie for that user
    When a WebSocket client connects to "/api/ws" with the session cookie
    Then the WebSocket upgrade completes and a hello frame arrives
