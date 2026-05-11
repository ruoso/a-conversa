Feature: No-OAuth-profile-data policy — id_token claims never leak

  Per ADR 0002, the platform reads no profile data — OAuth is purely
  an authentication signal; the only user-supplied datum stored is
  `screen_name`. This feature drives the complete OIDC handshake
  against a stubbed issuer whose id_token carries profile claims
  (`email`, `name`, `picture`, `preferred_username`, `given_name`,
  `family_name`, `locale`) and asserts none of those values reach the
  callback response body, the `users` row, the `users` table schema,
  the `/auth/me` response, or any response surface.
  Refinement: tasks/refinements/backend/no_profile_data_policy.md
  ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
               docs/adr/0022-no-throwaway-verifications.md

  Background:
    Given the auth server is built with a profile-claim-bearing stubbed OIDC client

  Scenario: callback with profile-claim-bearing id_token — users row carries only screen_name + oauth_subject
    When I GET /auth/login
    And I GET the callback URL with the stored state and a stubbed sub "alice"
    Then the response status is 200
    And the response body contains none of the profile-claim values
    And the users row for "authelia:alice" carries only id, oauth_subject, screen_name, created_at, deleted_at
    And the users row for "authelia:alice" has screen_name "<pending>"

  Scenario: GET /auth/me returns only userId and screenName — no profile data
    Given a user with oauth_subject "authelia:bob" exists with screen_name "bob"
    And I have a valid session cookie for that user
    When I GET /auth/me with the session cookie
    Then the response status is 200
    And the response body has exactly the keys "userId, screenName"
    And the response body contains none of the profile-claim values

  Scenario: users table schema (from migration source) contains no profile-data column names
    Then the users migration file contains no profile-data column names
