Feature: Screen-name collection — replaces the `<pending>` placeholder

  The OIDC callback (`oauth_callback_handler`) inserts new users with
  the placeholder `screen_name = '<pending>'` and sets a short-lived
  `aconversa-auth-pending` cookie carrying the user id. The user then
  posts their chosen screen name to `POST /auth/screen-name`; the
  handler verifies the cookie, validates the name, replaces the
  placeholder, and clears the cookie. Without that cookie the
  endpoint is 401 — there is no platform-session token yet (that's
  the next sibling task).
  Refinement: tasks/refinements/backend/screen_name_collection.md
  ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the auth server is built with a stubbed OIDC client and pglite-backed pool

  Scenario: first-auth flow — pending cookie + valid name replaces the placeholder
    Given a user with oauth_subject "authelia:alice" was inserted via the OIDC callback
    When I POST /auth/screen-name with screenName "alice" and the pending cookie
    Then the response status is 200
    And the users row's screen_name is "alice"
    And the response sets a cleared aconversa-auth-pending cookie

  Scenario: missing pending cookie — POST is rejected with 401
    When I POST /auth/screen-name with screenName "alice" and NO pending cookie
    Then the response status is 401
    And the response body's error.code is "auth-pending-cookie-invalid"

  Scenario: already-set screen name — second submission is rejected with 409
    Given a user with oauth_subject "authelia:alice" was inserted via the OIDC callback
    And the user's screen name has been set to "alice"
    When I POST /auth/screen-name with screenName "alice-renamed" and the pending cookie
    Then the response status is 409
    And the response body's error.code is "screen-name-already-set"
