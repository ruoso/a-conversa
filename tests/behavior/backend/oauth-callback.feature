Feature: OIDC callback handler — full handshake against a stubbed issuer

  The backend completes the OIDC authorization-code flow against the
  issuer configured by `oauth_provider_config`. `GET /auth/login`
  generates state/nonce/PKCE-verifier, persists them server-side, and
  302-redirects to the issuer's authorization endpoint. `GET /auth/callback`
  validates the inbound state, exchanges the code for tokens (validating
  the id_token in one call via openid-client's `authorizationCodeGrant`),
  reads ONLY the `sub` claim, and upserts a `users` row keyed on the
  namespaced OIDC subject (`provider:sub`, where provider is the issuer
  URL's full origin — protocol + hostname + port — per F-008 hardening
  in docs/security/m3-review/auth.md).
  Refinement: tasks/refinements/backend/oauth_callback_handler.md
  ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
               docs/adr/0017-mock-oauth-authelia-users-file.md,
               docs/adr/0022-no-throwaway-verifications.md,
               docs/adr/0023-web-framework-fastify.md

  Background:
    Given the auth server is built with a stubbed OIDC client and pglite-backed pool

  Scenario: happy path — login redirects to issuer; callback creates a user
    When I GET /auth/login
    Then the response status is 302
    And the Location header points at "http://authelia:9091/auth"
    When I GET the callback URL with the stored state and a stubbed sub "alice"
    Then the response status is 302
    And the Location header points at "http://localhost:3000/screen-name?from=callback"
    And a users row exists with oauth_subject "http://authelia:9091:alice"
    And the users row's screen_name is "<pending>"

  Scenario: returning user — same oauth_subject reuses the row and is redirected
    Given a user with oauth_subject "http://authelia:9091:alice" exists
    When I GET /auth/login
    And I GET the callback URL with the stored state and a stubbed sub "alice"
    Then the response status is 302
    And the Location header points at "http://localhost:3000"
    And exactly one users row exists with oauth_subject "http://authelia:9091:alice"

  Scenario: state mismatch — callback with bad state returns 400
    When I GET /auth/login
    And I GET the callback URL with a deliberately bad state
    Then the response status is 400
    And the response body's error.code is "auth-state-invalid"
