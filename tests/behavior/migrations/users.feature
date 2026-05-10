Feature: 0001_users — UNIQUE on oauth_subject and soft-delete
  # Per-migration regression: users.oauth_subject is the real identity
  # key (UNIQUE), and rows are soft-deleted (deleted_at NULL by default).

  Scenario: Duplicate oauth_subject is rejected
    Given a user with oauth_subject "authelia:alice" exists
    When I insert another user with oauth_subject "authelia:alice"
    Then the insert is rejected with a unique-violation error

  Scenario: Soft-delete column defaults to NULL
    Given a user with oauth_subject "authelia:bob" exists
    Then the user's deleted_at is NULL
