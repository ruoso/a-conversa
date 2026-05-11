Feature: /healthz liveness endpoint

  The backend exposes GET /healthz as a liveness probe. The compose
  `app` service healthcheck (per ADR 0018) targets this route — a 200
  flips the service from (unhealthy) to healthy without coupling the
  healthcheck to DB or OIDC availability.

  Semantics are liveness-only: a 200 says "the server process is
  running and able to serve HTTP traffic." Readiness (DB ping, OIDC
  reachability) is a separate concern owned by a future /readyz
  refinement and is intentionally not exercised here.

  Refinement: tasks/refinements/backend/health_endpoint.md
  ADRs:        docs/adr/0023-web-framework-fastify.md,
               docs/adr/0020-migrations-node-pg-migrate-forward-only.md

  Scenario: GET /healthz returns 200 with the liveness payload
    Given an HTTP server built from createServer
    When a GET request is sent to "/healthz"
    Then the response status is 200
    And the response body is JSON with status "ok"
    And the response body has a non-empty version string

  Scenario: /healthz is wired by createServer's bootstrap (regression)
    # If a future refactor forgets to register the healthz plugin,
    # the compose healthcheck silently regresses. This scenario locks
    # the wiring at the bootstrap layer rather than relying solely on
    # the unit test.
    Given an HTTP server built from createServer
    When a GET request is sent to "/healthz"
    Then the response status is 200
