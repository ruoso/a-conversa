Feature: ProjectionCache — per-session in-memory cache backed by a real DB
  # The Vitest tests at apps/server/src/projection/cache.test.ts cover
  # the cache lifecycle (hydration, in-flight dedup, idle eviction,
  # loader-failure recovery) with an injected stub `EventLoader`.
  # This feature covers the DB-driven hydration path: a `pg`-shaped
  # `EventLoader` reads `session_events` out of pglite, runs each row
  # through the row→envelope mapping, and the cache rebuilds the
  # projection via `projectFromLog`.
  #
  # Per ADR 0022 (no throwaway verifications) the rehydration probe
  # IS this committed scenario.

  Scenario: rehydrate from a real DB after eviction
    # Load the empty fixture (4 events). Build a pglite-driven
    # EventLoader (SELECT ... FROM session_events ORDER BY sequence).
    # The first getProjection hydrates: the projection has 4 events
    # applied and 3 current participants. Evicting drops the cache;
    # the next getProjection re-issues a fresh equivalent projection
    # (event count, participant count, participant ids match) and
    # the loader has been invoked exactly twice (once per hydration).
    Given the empty fixture is loaded for cache tests
    When I build a pglite-driven event loader and a ProjectionCache
    And I getProjection the empty fixture session
    Then the cached projection has lastAppliedSequence 4
    And the cached projection has 3 current participants
    And the loader has been invoked 1 time
    When I evict the empty fixture session from the cache
    And I getProjection the empty fixture session again
    Then the rehydrated projection has lastAppliedSequence 4
    And the rehydrated projection has 3 current participants
    And the loader has been invoked 2 times

  Scenario: applyEvent updates the cached projection without reload
    # Same setup, but instead of evicting we INSERT a new
    # participant-joined event into session_events and ask the cache
    # to apply it. The cached projection's participant count goes
    # from 3 to 4; the loader was called only the once at hydration
    # time (applyEvent does NOT re-read the log).
    Given the empty fixture is loaded for cache tests
    When I build a pglite-driven event loader and a ProjectionCache
    And I getProjection the empty fixture session
    Then the cached projection has 3 current participants
    When I insert a fresh participant-joined event at sequence 5
    And I apply that event through the cache
    Then the cached projection has 4 current participants
    And the cached projection has lastAppliedSequence 5
    And the loader has been invoked 1 time
