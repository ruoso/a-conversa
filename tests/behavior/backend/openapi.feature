Feature: OpenAPI documentation surface

  The backend exposes its API contract as an OpenAPI 3.x document at
  `/docs/json`, served by the `@fastify/swagger` + `@fastify/swagger-ui`
  plugins (registered before the route plugins so each route's `schema`
  block is captured). Frontends (audience, moderator, participant) and
  external API consumers fetch `/docs/json` to generate typed clients;
  human readers visit `/docs` for the Swagger UI rendering.

  Refinement: tasks/refinements/backend/openapi_or_equivalent.md
  ADRs:        docs/adr/0023-web-framework-fastify.md
  TaskJuggler: backend.api_skeleton.openapi_or_equivalent

  Scenario: GET /docs/json returns a parseable OpenAPI document with the healthz path
    Given an HTTP server built from createServer
    When a GET request is sent to "/docs/json"
    Then the response status is 200
    And the response body is a parseable OpenAPI document
    And the OpenAPI document includes the "/healthz" path
    And the OpenAPI document declares the tag taxonomy "meta,auth,sessions,events,replay"

  Scenario: GET /docs serves the Swagger UI HTML
    Given an HTTP server built from createServer
    When a GET request is sent to "/docs"
    Then the response status is 200
    And the response content-type is "text/html"
