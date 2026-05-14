Feature: HTTP server bootstrap

  The backend HTTP server (apps/server) boots via createServer(),
  registers @fastify/sensible and @fastify/cors, and serves the
  moderator SPA's index.html at GET / (per
  backend.api_skeleton.serve_static_frontends). Liveness lives at
  /healthz (owned by backend.api_skeleton.health_endpoint).
  Refinement: tasks/refinements/backend/http_server.md
              tasks/refinements/backend/serve_static_frontends.md
  ADR:        docs/adr/0023-web-framework-fastify.md

  Scenario: GET / serves the moderator SPA index.html (single-origin)
    Given an HTTP server built from createServer
    When a GET request is sent to "/"
    Then the response status is 200
    And the response content-type is HTML

  Scenario: unknown JSON-accept routes return the canonical 404 envelope
    Given an HTTP server built from createServer
    When a GET request is sent to "/no-such-route" with Accept "application/json"
    Then the response status is 404
