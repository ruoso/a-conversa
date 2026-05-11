Feature: Centralized error handling and JSON envelope

  The backend HTTP server's error-handler plugin (apps/server/src/error-handler.ts)
  wires setErrorHandler and setNotFoundHandler on the root scope so every
  error response — whether route-thrown or transport-level — serializes
  under the canonical envelope `{ error: { code, message, ...detail } }`.
  Refinement: tasks/refinements/backend/error_handling.md
  TaskJuggler: backend.api_skeleton.error_handling

  Scenario: a route-thrown ApiError surfaces the canonical envelope at the matching status
    Given an HTTP server with an error-handling test route registered
    When a GET request is sent to "/test/throw/bad-request"
    Then the response status is 400
    And the response body envelope has error code "bad-request" and message "missing the foo field"

  Scenario: unknown routes return the canonical 404 envelope
    Given an HTTP server with an error-handling test route registered
    When a GET request is sent to "/no-such-route-ever"
    Then the response status is 404
    And the response body envelope has error code "not-found" and message "Route not found"
