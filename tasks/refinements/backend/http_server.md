# HTTP server bootstrap

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.http_server`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.repo_skeleton` (settled), `foundation.dev_env` (settled — compose + Dockerfile in place)

## What this task is

Land the running HTTP server for `apps/server`. Two things happen together:

1. **Settle the deferred web-framework decision** from [ADR 0001](../../../docs/adr/0001-language-and-runtime.md) (which named the language but explicitly deferred "Express, Fastify, Hono, or similar" to the repo-skeleton work). Record the choice as [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md).
2. **Bootstrap the server**: a `createServer()` factory that returns a configured `FastifyInstance`, and an entry point (`apps/server/src/index.ts`) that listens on `PORT` (default 3000) with structured logging and graceful shutdown. Today the server has one trivial route (`GET /`) returning `{ status: 'ok' }`; the sibling `api_skeleton` tasks (`error_handling`, `request_logging`, `health_endpoint`, `openapi_or_equivalent`) plug into this same instance once they land.

This task does **not** wire migrations on startup (that's `health_endpoint`'s migration-state check, owned separately), nor does it add WebSocket support (`backend.websocket_protocol.ws_connection_handling` does that). It also does not pre-empt `error_handling`'s `setErrorHandler` wiring, `request_logging`'s pino serializers, or `openapi_or_equivalent`'s swagger registration — each sibling builds on the bootstrap.

## Why it needs to be done

Every backend route that follows — auth callback handlers, session-management endpoints, replay endpoints, the WebSocket upgrade path — needs an HTTP server to register against. The Dockerfile's runtime stage (per [ADR 0015](../../../docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md)) still ships a stub `CMD` that prints a banner and exits; the compose `app` service therefore restart-loops with a perpetually-failing healthcheck (per [ADR 0018](../../../docs/adr/0018-compose-file-three-service-dev-stack.md)). This task replaces the stub with a real entry point — the compose `app` service starts cleanly and `curl http://localhost:3000/` returns `{ status: 'ok' }` against a live stack.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md):

- Server-authoritative real-time over WebSockets — HTTP and WebSocket coexist on the same Node process. The framework choice must support both first-class.
- The application ships as a single Docker image (the same image runs the server and serves frontend bundles); the runtime is `node:lts-alpine`.
- Local dev runs in compose with Postgres + Authelia + `app`; production is the same image against a managed Postgres and real OIDC providers.

From the in-flight refinements:

- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — schema-on-write gate the eventual append path will call.
- [`apps/server/src/projection/*`](../../../apps/server/src/projection/) — projection libraries the eventual session endpoints will read from.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — event-envelope shape (Zod). When the first real route lands, the type provider will likely be `fastify-type-provider-zod`.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — empirical verifications must be committed tests. The HTTP server is a real network surface, so the bootstrap ships with **Vitest unit tests** (`.inject(...)`-based) **and** a **Cucumber scenario** that drives the running instance.

## Constraints / requirements

- **Framework**: TypeScript-first, mature WebSocket story (the next M3 task adds WebSocket), plugin ecosystem covering CORS / errors / logging / healthcheck / OpenAPI, in-process test harness.
- **Module shape**:
  - `apps/server/src/server.ts` — exports `createServer(options?): FastifyInstance`. Returns a configured but not-listening instance. Configurable enough that test code can pass `{ logger: false }`.
  - `apps/server/src/index.ts` — entry point. Calls `createServer()`, listens on `PORT` (default 3000), logs the listening address, handles `SIGINT`/`SIGTERM` for graceful shutdown.
- **Plugins wired at bootstrap**:
  - `@fastify/sensible` — typed `httpErrors` helpers so the eventual `error_handling` sibling has a consistent surface to build on.
  - `@fastify/cors` — permissive in dev (`origin: true`); production tightening is `deployment.prod_container` work.
- **Logger**: Fastify's built-in Pino. `info` outside test, silenced under test. `request_logging` will tighten redaction.
- **Trivial proof route**: `GET /` returns `{ status: 'ok' }`. The proper `/healthz` is `health_endpoint`'s sibling task.
- **Build**: `apps/server`'s existing `build` script (`tsc -b`) must keep working; emitted JS under `dist/` is what the Dockerfile's runtime stage runs.
- **Test layers**:
  - **Vitest** (`apps/server/src/server.test.ts`) — `createServer()` returns an instance with the expected plugins registered; `GET /` returns 200 + `{ status: 'ok' }` via `app.inject(...)`; unknown routes return 404.
  - **Cucumber** (`tests/behavior/backend/http-server.feature`) — start the server in-process (no port bind needed; use `.inject(...)` from the World), send `GET /`, assert response.
- **Dockerfile**: replace the stub `CMD` with `CMD ["node", "/app/apps/server/dist/index.js"]`. The image now runs the real server; the compose `app` healthcheck (targeting `/healthz`) still fails until `health_endpoint` lands, but `curl /` against the host port works.
- **Makefile**: leave `up-app` separate from `up` for now — the proper full-stack story depends on migrations-on-startup + `/healthz`, both still pending. Note the deferral in the Makefile comment.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) and `pnpm run test:behavior:smoke` (Cucumber) green.
- `make up && make up-app` runs the real server inside the compose stack; `curl http://localhost:3000/` returns `{ status: 'ok' }`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- ADR 0023 captures the framework choice; ADR 0001 Amendment notes the deferral is resolved; ADR 0015 Amendment notes the stub `CMD` is replaced.

## Decisions

- **Framework: Fastify 5.** Pinned to `5.8.5` (current stable on 2026-05-10). Rationale lives in [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md): TypeScript-first; mature WebSocket plugin (`@fastify/websocket`) for the next task; large plugin ecosystem for siblings; in-process `.inject(...)` for unit and Cucumber tests; pino logger built in.
- **Plugins at bootstrap**: `@fastify/sensible@6.0.4`, `@fastify/cors@11.2.0`. `@fastify/websocket` deferred to `ws_connection_handling`; `@fastify/swagger` deferred to `openapi_or_equivalent`; `@fastify/helmet` deferred.
- **Type provider deferred.** No Zod-vs-TypeBox decision today; the trivial route doesn't need one. The first route that needs schema-typed request/response (likely a session-management endpoint) will pick the type provider then.
- **Server module shape**: `createServer()` factory + thin `index.ts` entry. Test code imports `createServer` and uses `.inject(...)`; the entry point only runs in real (or compose) deployments.
- **Cucumber World extension**: rather than expanding `AConversaWorld` with an `httpServer` field, the new scenario's step defs construct their own Fastify instance in-step and tear it down after — the existing pglite `Before` hook still runs (harmless overhead for a DB-free scenario), but the scenario doesn't touch `this.db`. Cleaner than splitting World variants; rejected only if the overhead becomes noticeable later.
- **Dockerfile CMD swap**: `CMD ["node", "/app/apps/server/dist/index.js"]`. The runtime stage's `COPY --from=build /app/apps/server/dist` already places the compiled entry there.
- **Makefile**: `up-app` stays separate for one more task cycle. Once `health_endpoint` (with migration-state check) and migrations-on-startup land, `up` will absorb `up-app`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-10. Landed as:

- ADR: [docs/adr/0023-web-framework-fastify.md](../../../docs/adr/0023-web-framework-fastify.md) (Fastify 5).
- Amendments: [ADR 0001](../../../docs/adr/0001-language-and-runtime.md) (deferral resolved), [ADR 0015](../../../docs/adr/0015-dockerfile-multi-stage-pnpm-corepack.md) (stub `CMD` replaced).
- Server: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts), [`apps/server/src/index.ts`](../../../apps/server/src/index.ts).
- Tests: [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts) (Vitest, +5 tests), [`tests/behavior/backend/http-server.feature`](../../../tests/behavior/backend/http-server.feature) (Cucumber, +1 scenario).
- Dockerfile entry point replaced; compose `app` service now runs the real server (`curl http://localhost:3000/` → `{ status: 'ok' }`).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
