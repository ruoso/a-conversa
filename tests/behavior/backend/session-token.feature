Feature: Platform session-token — issuance, validation, and lifecycle

  After completing OIDC + screen-name collection, the user holds an
  `aconversa-session` cookie carrying a 7-day HS256 JWT with `{ sub,
  iat, exp }` claims (sub = users.id). The cookie gates `GET /auth/me`
  and (eventually) every protected endpoint and the WebSocket upgrade.
  The OIDC callback decides which cookie to issue based on the
  upserted row's screen_name: a returning user (non-`<pending>`) gets
  the session cookie + a 302 to APP_BASE_URL; a new user (`<pending>`)
  gets the short-lived pending cookie + a 302 to
  `APP_BASE_URL/screen-name?from=callback` (per
  tasks/refinements/backend/auth_callback_new_user_browser_redirect.md,
  superseding the original 200 + `needsScreenName: true` JSON shape).
  POST /auth/screen-name issues the session cookie on success;
  POST /auth/logout clears it.
  Refinement: tasks/refinements/backend/session_token_management.md
  ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the auth server is built with a stubbed OIDC client and pglite-backed pool

  Scenario: returning user — callback issues the session cookie and 302-redirects
    Given a user with oauth_subject "http://authelia:9091:alice" exists with screen_name "alice"
    When I GET /auth/login
    And I GET the callback URL with the stored state and a stubbed sub "alice"
    Then the response status is 302
    And the Location header points at "http://localhost:3000"
    And the response sets a aconversa-session cookie carrying a valid JWT
    And the response does NOT set a aconversa-auth-pending cookie

  Scenario: new user — callback issues the pending cookie, no session cookie yet
    When I GET /auth/login
    And I GET the callback URL with the stored state and a stubbed sub "newcomer"
    Then the response status is 302
    And the Location header points at "http://localhost:3000/screen-name?from=callback"
    And the response sets a aconversa-auth-pending cookie
    And the response does NOT set a aconversa-session cookie

  Scenario: screen-name set — issues the session cookie and clears the pending cookie
    Given a user with oauth_subject "authelia:newcomer" was inserted via the OIDC callback
    When I POST /auth/screen-name with screenName "newcomer" and the pending cookie
    Then the response status is 200
    And the response sets a aconversa-session cookie carrying a valid JWT
    And the response sets a cleared aconversa-auth-pending cookie

  Scenario: /auth/me returns the user; /auth/logout clears; /auth/me without cookie is 401
    Given a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user
    When I GET /auth/me with the session cookie
    Then the response status is 200
    And the response body's screenName is "alice"
    When I POST /auth/logout with the session cookie
    Then the response status is 204
    And the response sets a cleared aconversa-session cookie
    When I GET /auth/me without any session cookie
    Then the response status is 401
    And the response body's error.code is "auth-required"
