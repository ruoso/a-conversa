Feature: HTTP server bootstrap

  The backend HTTP server (apps/server) boots via createServer(),
  registers @fastify/sensible and @fastify/cors, and answers GET /
  with a trivial status payload. The proper /healthz route belongs
  to backend.api_skeleton.health_endpoint; this scenario is the
  bootstrap smoke.
  Refinement: tasks/refinements/backend/http_server.md
  ADR:        docs/adr/0023-web-framework-fastify.md

  Scenario: GET / returns the bootstrap status payload
    Given an HTTP server built from createServer
    When a GET request is sent to "/"
    Then the response status is 200
    And the response body is JSON with status "ok"

  Scenario: unknown routes return 404
    Given an HTTP server built from createServer
    When a GET request is sent to "/no-such-route"
    Then the response status is 404
