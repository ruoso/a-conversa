Feature: Cucumber smoke

  Scenario: Smoke scenario
    Given I run a smoke test
    When I run cucumber
    Then it passes
