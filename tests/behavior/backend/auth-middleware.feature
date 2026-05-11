Feature: Auth middleware — protected endpoints enforce session-cookie validation

  Every protected HTTP endpoint opts into the auth middleware via
  `preHandler: app.authenticate`. The middleware reads the
  `aconversa-session` cookie, verifies the HS256 JWT, looks up the
  user (filtering out soft-deleted rows), and attaches
  `request.authUser = { id, screenName }`. Any failure mode collapses
  to a single 401 envelope with code `auth-required` — no information
  leak about which sub-case fired. `GET /auth/me` is the canonical
  protected endpoint and the regression target for this layer.

  Refinement: tasks/refinements/backend/auth_middleware.md
  ADRs:        docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the auth server is built with a stubbed OIDC client and pglite-backed pool

  Scenario: Hitting a protected route without a cookie returns 401 with the standard envelope
    When I GET /auth/me without any session cookie
    Then the response status is 401
    And the response body's error.code is "auth-required"

  Scenario: Hitting a protected route with a valid cookie returns the authenticated user
    Given a user with oauth_subject "authelia:alice" exists with screen_name "alice"
    And I have a valid session cookie for that user
    When I GET /auth/me with the session cookie
    Then the response status is 200
    And the response body's screenName is "alice"

  Scenario: Hitting a protected route with an expired cookie returns 401 auth-required
    Given a user with oauth_subject "authelia:bob" exists with screen_name "bob"
    And I have an expired session cookie for that user
    When I GET /auth/me with the session cookie
    Then the response status is 401
    And the response body's error.code is "auth-required"
