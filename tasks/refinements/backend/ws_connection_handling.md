# WebSocket connection lifecycle

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_connection_handling`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — Fastify bootstrap), `backend.auth` (settled at the parent `websocket_protocol`-task level: the WS sub-tree depends on auth; this first task does NOT exercise auth, only leaves a seam for the next task to fill).

## What this task is

Land the WebSocket foundation for `apps/server`. Three things happen together:

1. **Register `@fastify/websocket`** against the Fastify app (in `server.ts`'s `createServer` factory, alongside the existing `await app.register(...)` chain).
2. **Mount a `GET /ws` route** that upgrades to a WebSocket connection, mints a per-connection v4 UUID `connectionId`, logs `ws-connection-opened` and `ws-connection-closed` at info level via the per-request logger, sends a placeholder `{ type: 'hello', connectionId }` first message, and emits a clean 1011 close on unexpected handler errors.
3. **Wire a server-shutdown contract** that closes every still-open connection with code 1001 going-away when the Fastify app closes — via a `preClose` hook passed to `@fastify/websocket`'s plugin options (so the structured close frame reaches the wire before the underlying `ws.Server` teardown).

This task is the **first of 15** `websocket_protocol` tasks. Every downstream WS task (auth on connect, session subscription, the canonical message envelope, message types, broadcasts, reconnection) builds on the foundation this lays. The placeholder `{ type: 'hello', connectionId }` first message is explicitly **NOT** the canonical envelope — `ws_message_envelope` will replace it. A clearly-marked seam in the connection handler is reserved for `ws_auth_on_connect` to fill (currently a comment placeholder before the `connectionId` mint).

## Why it needs to be done

The architecture (per [docs/architecture.md](../../../docs/architecture.md)) is server-authoritative real-time: clients (moderator console, debater tablets, audience view) subscribe to a session's event stream over WebSockets, receive applied-event broadcasts from the server, and send proposal / vote / commit messages back. None of those can land without a WebSocket upgrade path; this task provides it. The 14 sibling tasks in the `websocket_protocol` sub-tree each plug into this same Fastify instance once they land, exactly the way the `api_skeleton` siblings (`error_handling`, `request_logging`, `openapi_or_equivalent`, `health_endpoint`) plugged into the HTTP bootstrap.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md):

- "Clients (moderator, debaters, audience) connect over **WebSockets**." HTTP and WebSocket coexist on the same Node process; the framework choice (Fastify, per [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md)) was made with this requirement in mind, citing `@fastify/websocket` as the canonical adapter.

From the existing server bootstrap:

- [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — the `createServer` factory the new plugin registers against. Comments in that file already named `@fastify/websocket` as a "plugin explicitly deferred to its owning task" (this one).
- [`apps/server/src/logger.ts`](../../../apps/server/src/logger.ts) — per-env Pino options. The WS plugin reuses Fastify's per-request `request.log` (which carries `reqId`) and the app-level `app.log` — no parallel logger.
- [`apps/server/src/auth/middleware.ts`](../../../apps/server/src/auth/middleware.ts) — the platform session-token primitives `ws_auth_on_connect` will compose. This task does NOT call them; the seam is reserved.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Every empirical verification is a committed test in the appropriate layer. The WS connection lifecycle ships with **Vitest unit tests** (`apps/server/src/ws/connection.test.ts`, four cases) AND **Cucumber scenarios** (`tests/behavior/backend/ws-connection.feature`, three scenarios) — both drive a real Fastify instance with the WS plugin registered, via the library's `app.injectWS(...)` (which provides an in-process WS client without binding a port). No mocking of the WS library; the unexpected-error path is exercised via a deterministic test-only header gated behind `NODE_ENV !== 'production'`.

## Constraints / requirements

- **Library**: `@fastify/websocket` (the canonical Fastify WS adapter; named in the deferral comment of `server.ts`).
- **Route**: `GET /ws`, `{ websocket: true }`. The route is marked `schema.hide: true` so the OpenAPI surface stays clean — the WS protocol documentation is owned by `ws_protocol_documentation`, not by the OpenAPI generator.
- **Connection id**: `crypto.randomUUID()` (Node 20+ built-in, RFC 4122 v4). Stable for the connection's lifetime. Not a user id; the auth task will attach a user id alongside.
- **Placeholder hello envelope**: `{ type: 'hello', connectionId }`, JSON-serialised. NOT the canonical envelope. `ws_message_envelope` will replace it; any consumer reading the wire during the gap should treat the shape as ephemeral.
- **Logging**: `ws-connection-opened` on open, `ws-connection-closed` (with `code` + `reason`) on close, `ws-connection-error` on the unexpected-error path. All at info / error level via `request.log` (per-connection) or `app.log` (shutdown). No parallel pino instance.
- **Shutdown contract**: `preClose` option of `@fastify/websocket` (not a route-plugin `onClose` hook — the library's default `preClose` runs first and would emit a 1005-equivalent close before our hook fires). Every still-open connection receives a `socket.close(1001, 'server-shutting-down')` before the underlying ws.Server tears down.
- **Unexpected-error contract**: when the WS handler throws synchronously or its promise rejects, `@fastify/websocket`'s `errorHandler` option fires; we log the error and emit a `socket.close(1011, 'internal-error')`. Routing through `errorHandler` keeps the close code consistent regardless of which unexpected-error path fired.
- **Auth seam**: a clearly-marked comment (`// ws_auth_on_connect will gate here`) placed BEFORE the `connectionId` mint so an unauthenticated upgrade can be rejected without allocating per-connection state.
- **Out of scope here**: auth on connect, subscription state, message routing, broadcasts, reconnection state, the canonical envelope, and message types. Each is a separate downstream task in the same sub-tree.
- **No ad-hoc probes**: every empirical check is a committed test (ADR 0022). The unexpected-error path is exercised via the `X-WS-Test-Force-Error: 1` header (gated by `NODE_ENV !== 'production'`), not by mocking the WS library.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, with **+4 tests** in `apps/server/src/ws/connection.test.ts`.
- `pnpm run test:behavior:smoke` (Cucumber) green, with **+3 scenarios** in `tests/behavior/backend/ws-connection.feature`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- The placeholder `{ type: 'hello', connectionId }` envelope is explicitly documented (in code comments and this refinement) as the seam `ws_message_envelope` will replace.
- A reader of `apps/server/src/ws/connection.ts` can identify exactly where `ws_auth_on_connect` will plug in.

## Decisions

- **Library: `@fastify/websocket@11.2.0`.** Pinned to `11.2.0` (latest stable on 2026-05-11). Rationale: named in `server.ts`'s deferral comment and in ADR 0023's Decisions; the upstream library is the canonical Fastify WS adapter, ships `app.injectWS` for in-process testing, and carries the `errorHandler` + `preClose` hooks the close-code contract relies on. No alternative library was surveyed — the bootstrap already committed to Fastify and this is the canonical adapter.
- **Route: `GET /ws`** with `{ websocket: true }`. Schema marked `hide: true` to skip the OpenAPI generator (WS protocol documentation is a separate task).
- **Connection id: `crypto.randomUUID()`** (Node built-in, v4). The unit test asserts the wire value matches a v4 pattern; the Cucumber scenario asserts the same against the live frame.
- **Placeholder hello envelope: `{ type: 'hello', connectionId }`.** Documented in code (the `WsHelloPlaceholder` interface), in the refinement (here), and in the route schema description as the shape that `ws_message_envelope` will replace. Any client wired against this shape WILL need a migration when the envelope task lands.
- **Shutdown contract: `preClose` hook passed to `@fastify/websocket` options.** The library's own preClose fires AFTER any options-supplied preClose and would emit a 1005-equivalent close otherwise; the structured 1001 frame must reach the wire first. Source-code comment in `connection.ts` captures the rationale.
- **Unexpected-error contract: 1011 internal-error via the library's `errorHandler` option.** Routes both synchronous-throw and promise-reject paths through the same close-code emission.
- **Auth seam: comment-marked, NOT a no-op function call.** A `// ws_auth_on_connect will gate here` placed in the handler is clearer than a no-op `await authenticateWs(request)` stub — the next task will introduce the function and the call together. Rejected the stub option because it would imply this task touched the auth surface.
- **Plugin shape: outer `fastify-plugin`-wrapped + inner encapsulated.** The outer plugin registers `@fastify/websocket` at root scope (so the library's decorations — `app.injectWS`, `app.websocketServer`, `request.ws` — reach the top scope, which tests need) and then registers the inner route plugin under its own encapsulation. Keeps the route + handler encapsulated while exposing exactly the library decorations downstream tasks (and tests) need.
- **`openConnections` set: module-scoped.** The outer plugin's `preClose` callback can't reach a closure-scoped set inside the inner route plugin (the library's options are wired at outer-plugin registration time). Module-scope is the simplest split; the trade-off (two `createServer` instances in the same process would share bookkeeping) is acceptable today — tests build one instance at a time.
- **Test env: per-file `@vitest-environment node`.** The project-wide Vitest default is `happy-dom`; the `ws` library needs Node's real `net`/`Buffer` stack for `injectWS`'s in-memory duplex stream. Per-file directive overrides without touching the global. Standard Vitest pattern.
- **Cucumber steps: own file, reuse the http-server `Given`.** `tests/behavior/steps/backend-ws-connection.steps.ts` adds When/Then steps that consume the `httpServer` scratch carrier the existing http-server steps populate. Keeps each step file's responsibility narrow (HTTP vs. WS).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Server: [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (the plugin), [`apps/server/src/ws/index.ts`](../../../apps/server/src/ws/index.ts) (barrel), [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (registration in `createServer`).
- Dependency: `@fastify/websocket@11.2.0` added to `apps/server/package.json` via `pnpm add --filter @a-conversa/server`.
- Tests: [`apps/server/src/ws/connection.test.ts`](../../../apps/server/src/ws/connection.test.ts) (Vitest, +4 tests — hello frame + UUID v4 connectionId; client-close handshake; server-shutdown 1001; unexpected-error 1011 via test-only force-error header), [`tests/behavior/backend/ws-connection.feature`](../../../tests/behavior/backend/ws-connection.feature) + [`tests/behavior/steps/backend-ws-connection.steps.ts`](../../../tests/behavior/steps/backend-ws-connection.steps.ts) (Cucumber, +3 scenarios — placeholder hello, client-initiated close, server-shutdown 1001).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
