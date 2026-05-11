// Step definitions for tests/behavior/backend/request-logging.feature.
//
// Refinement: tasks/refinements/backend/request_logging.md
// TaskJuggler: backend.api_skeleton.request_logging
//
// The whole scenario is already covered by reused steps from
// http-server.steps.ts:
//
//   - `Given an HTTP server built from createServer` — constructs
//     and readies a Fastify instance via `createServer({ logger:
//     false })`, parks it on `world.scratch.httpServer`.
//   - `When a GET request is sent to "..."` — injects the request
//     and captures `{ statusCode, body, headers }` on
//     `world.scratch.lastResponse`.
//   - `Then the response status is <int>` — asserts the captured
//     status code.
//   - `Then the response has a non-empty "..." header` — asserts a
//     captured response header is a non-empty string (added in
//     http-server.steps.ts alongside this feature).
//
// This file exists as the step-defs companion for the
// request-logging.feature per the convention every other backend
// scenario follows (`backend-error-handling.steps.ts`,
// `http-server.steps.ts`). It deliberately contains no new step
// definitions today — the feature reuses the shared `Given` / `When`
// / `Then` library. Future request-logging scenarios (e.g.
// asserting log-line shape via a custom stream) will land their
// step defs here.

export {};
