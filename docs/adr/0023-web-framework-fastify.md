# 0023 — Web framework: Fastify

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

[ADR 0001](0001-language-and-runtime.md) settled the backend language and runtime — **TypeScript on Node.js** — and deliberately deferred the web-framework choice ("Express, Fastify, Hono, or similar … deferred to the repo-skeleton work; it is not load-bearing for any other foundation decision and is best chosen alongside the test-framework picks"). Repo-skeleton work is done; the M3 backend milestone now needs a real HTTP/WebSocket server, and `backend.api_skeleton.http_server` is the task that picks the framework and lands the bootstrap.

The architectural constraints from [docs/architecture.md](../architecture.md) shape the choice:

- **Server-authoritative real-time over WebSockets**, single Node process owning the canonical event log per session. HTTP and WebSocket coexist on the same port and process; the framework must support both first-class (`backend.websocket_protocol` plugs into this same process immediately after `api_skeleton` lands).
- **TypeScript-first ergonomics** — the project is strict TS end-to-end ([ADR 0013](0013-typecheck-tsconfig-strict-with-project-references.md)). The framework should type its handlers without bolt-on `@types/*` packages or awkward generics.
- **Plugin ecosystem for cross-cutting concerns** — CORS, error handling, structured logging, healthcheck, OpenAPI, and (later) OIDC integration with Authelia ([ADR 0017](0017-mock-oauth-authelia-users-file.md)). The siblings of this task (`error_handling`, `request_logging`, `health_endpoint`, `openapi_or_equivalent`) plug into the framework — small, well-maintained plugins beat hand-rolled middleware.
- **Test ergonomics** — handlers must be unit-testable in-process without binding to a port. The eventual Cucumber + pglite scenarios and Playwright + compose specs (per [ADR 0022](0022-no-throwaway-verifications.md)) also benefit from a built-in inject/test harness so route smokes don't need a live socket.

Candidates surveyed:

- **Fastify** — Node-native, TypeScript-first, pino-backed structured logging out of the box, mature WebSocket support via `@fastify/websocket`, large plugin ecosystem (`@fastify/cors`, `@fastify/helmet`, `@fastify/sensible`, `@fastify/swagger`), built-in `.inject()` for in-process route testing. Current stable: **5.x**.
- **Express** — most familiar; largest ecosystem; but TypeScript support is bolt-on (`@types/express`), WebSocket integration is awkward (`express-ws` wraps `ws` outside the routing layer), and the project is in maintenance mode relative to newer alternatives. Feels dated for a 2026 TS-first project.
- **Hono** — newest of the three, runtime-agnostic (Node, Bun, Cloudflare Workers, Deno), zero deps, modern TS ergonomics. WebSocket support exists per-runtime but is less mature than Fastify's for the long-lived, server-authoritative connection pattern this project needs.
- **`node:http` + minimal helpers** — cleanest dependency footprint; no framework at all. Reasonable only if the API surface is small and stays small. The eventual surface (session endpoints, replay endpoints, auth, OIDC callback, OpenAPI docs) is large enough that a framework saves real code.

## Decision

The backend uses **Fastify 5** as its HTTP/WebSocket framework.

Pinned versions (current stable as of 2026-05-10):

- `fastify@5.8.5` — the framework itself.
- `@fastify/sensible@6.0.4` — typed `httpErrors` helpers (`reply.notFound()`, `reply.badRequest()`, …) so `error_handling` has a consistent shape to build on.
- `@fastify/cors@11.2.0` — CORS plugin, wired permissively for dev now; production tightening is a `deployment.prod_container`-era concern.

Plugins explicitly deferred to sibling tasks:

- `@fastify/websocket` — owned by `backend.websocket_protocol.ws_connection_handling`. Not added today.
- `@fastify/helmet` — owned by the eventual security-headers pass; not load-bearing for the bootstrap.
- `@fastify/swagger` + `@fastify/swagger-ui` — owned by `backend.api_skeleton.openapi_or_equivalent`.
- `fastify-type-provider-zod` (or `fastify-type-provider-typebox`) — chosen alongside the first real route that needs request/response schemas (likely the session-management endpoints). Today's bootstrap has one trivial route with no body validation, so the type provider is intentionally deferred — it's easier to pick it after `backend.session_management` knows what its schemas look like.

Structured logging uses Fastify's built-in **Pino** (the framework's default logger). The `request_logging` sibling task will refine the redaction/serializer config; the bootstrap just enables `logger: true` with a sensible level (`info` outside test, `silent` under test) so the route smoke tests don't drown stdout.

## Consequences

- **Single-process HTTP + WebSocket.** The same `FastifyInstance` will register WebSocket routes once `@fastify/websocket` lands; HTTP and WebSocket share the listener, the logger, the error path, and the auth middleware. This matches the architecture's "single server holds the canonical event log per active debate."
- **First-class TypeScript.** Fastify's types resolve handler signatures from the registered route schemas (once a type provider is wired), and the framework itself is authored in TS. No `@types/*` package, no `as any` at the boundary.
- **Built-in in-process testing via `app.inject(...)`.** Vitest unit tests in `apps/server/src/server.test.ts` exercise routes without binding a port. The Cucumber scenario for the HTTP server also uses `.inject(...)` so the in-process test layer matches the unit layer's semantics.
- **Pino logger out of the box.** Structured JSON logs with request-id correlation are the default; the `request_logging` sibling tightens redaction (no auth tokens, no PII) without re-plumbing the logger.
- **Plugin ecosystem covers the siblings.** Each remaining `api_skeleton` task plugs in cleanly — `error_handling` wires `setErrorHandler` on top of `@fastify/sensible`'s `httpErrors`; `health_endpoint` registers `GET /healthz`; `openapi_or_equivalent` registers `@fastify/swagger`; `request_logging` configures pino serializers and a request-id hook. None of them have to rewrite the bootstrap.
- **The trivial `GET /` route stays.** It returns `{ status: 'ok' }` — not a real healthcheck — and exists purely as a smoke endpoint for `curl http://localhost:3000/` against the running compose stack. The proper `/healthz` (with DB ping and migration-state check) is owned by `backend.api_skeleton.health_endpoint`. The compose `app` healthcheck (per ADR 0018) targets `/healthz` and will start passing once that sibling lands; today it targets `/healthz` and `curl /` is the human-facing smoke.
- **No type-provider lock-in today.** Choosing Zod-vs-TypeBox is deferred to the first route that needs request/response schemas. The choice will be its own short ADR (or an Amendment to this one) when made.
- **Dependency pin policy.** Fastify follows semver; pins are exact on first install and updated by the routine dep-bump pass. The `package.json` pins are the source of truth; this ADR records the initial set.

## Amendments

### 2026-05-10 — `/healthz` is liveness-only (not DB-pinging)

The Consequences section originally framed `/healthz` as "the proper
healthcheck with DB ping and migration-state check." On landing
`backend.api_skeleton.health_endpoint`, that framing was walked back
deliberately:

- **`/healthz` is liveness-only.** Returns 200 + `{ status: 'ok', version }`
  whenever the server is running. No DB ping, no OIDC check, no
  per-request migration-state recheck.
- **Migration state is gated at startup**, not at `/healthz`. The
  `applyMigrationsOnStartup` call in `index.ts` runs before
  `app.listen(...)`; the only way the route can answer is past the
  gate, so a per-request recheck is redundant.
- **DB / OIDC readiness is deferred to a future `/readyz`.** The
  separation matters operationally: a liveness probe that flips to
  red on a transient DB blip causes Docker / k8s to restart-loop the
  app (the well-known anti-pattern). Readiness probes are designed
  to flip; liveness probes are designed not to.

The route lives at [`apps/server/src/routes/healthz.ts`](../../apps/server/src/routes/healthz.ts)
as a `FastifyPluginAsync`, registered by `createServer` in
[`server.ts`](../../apps/server/src/server.ts). Refinement:
[tasks/refinements/backend/health_endpoint.md](../../tasks/refinements/backend/health_endpoint.md).
