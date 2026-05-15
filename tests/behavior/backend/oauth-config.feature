Feature: OIDC client configuration

  The backend speaks generic OIDC to whatever issuer URL the env
  supplies (per ADR 0002 and 0017). The auth config module reads
  OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and
  APP_BASE_URL from the environment, validates them with Zod, and
  builds a configured openid-client Configuration via discovery. The
  redirect URI is derived as ${APP_BASE_URL}/auth/callback so the
  Authelia client registration (infra/authelia/configuration.yml,
  client `aconversa-app-dev`) matches without per-deployment
  duplication.
  Refinement: tasks/refinements/backend/oauth_provider_config.md
  ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
               docs/adr/0017-mock-oauth-authelia-users-file.md,
               docs/adr/0022-no-throwaway-verifications.md

  Scenario: env vars flow through loadOidcConfig into an openid-client Configuration
    Given the dev OIDC environment is set
    When the OIDC config is loaded
    Then the loaded redirect URI is "http://localhost:3000/api/auth/callback"
    And the loaded client id is "aconversa-app-dev"
    When the OIDC client is obtained
    Then the obtained client's metadata client_id is "aconversa-app-dev"
    And obtaining the OIDC client again returns the same Configuration instance
