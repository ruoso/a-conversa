Feature: 0002_sessions — host FK and privacy CHECK
  # Per-migration regression: sessions.host_user_id is FK to users(id)
  # with RESTRICT semantics, and privacy is restricted to
  # ('public', 'private') by CHECK.

  Scenario: A session with a non-existent host_user_id is rejected
    When I insert a session with a host_user_id that does not exist
    Then the insert is rejected with a foreign-key-violation error

  Scenario: privacy = 'invalid' is rejected by the CHECK constraint
    Given a user with oauth_subject "authelia:host" exists
    When I insert a session with privacy "invalid" for that user
    Then the insert is rejected with a check-violation error

  Scenario: privacy defaults to 'public' when omitted
    Given a user with oauth_subject "authelia:host2" exists
    When I insert a session with no privacy specified for that user
    Then the session's privacy is "public"
