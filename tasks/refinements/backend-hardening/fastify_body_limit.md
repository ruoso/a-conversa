Source: docs/security/m3-review/inputs.md F-002

# Configure Fastify `bodyLimit` + `@fastify/websocket` `maxPayload`

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.fastify_body_limit`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer` factory at `apps/server/src/server.ts`); `backend.websocket_protocol.ws_connection_handling` (settled — the `wsConnectionHandlingPlugin` at `apps/server/src/ws/connection.ts` is where `@fastify/websocket` is registered).

## What this task is

Set explicit ceilings on the two payload-size knobs that today silently inherit upstream defaults:

1. **`bodyLimit` on the Fastify factory** — the default is `1 * 1024 * 1024` (1 MiB). Drop to **64 KiB** for a-conversa's HTTP surface.
2. **`maxPayload` on `@fastify/websocket`** — the underlying `ws` library defaults to `100 * 1024 * 1024` (100 MiB) when unset; `@fastify/websocket` does not force a smaller default. Set to **64 KiB**.

Both knobs are driven by env vars (`BODY_LIMIT_BYTES`, `WS_MAX_PAYLOAD_BYTES`) so production can tune without code change, with sensible defaults baked in. The resolution helpers (`resolveBodyLimit`, `resolveWsMaxPayload`) follow the same shape as the existing `resolveCatchUpMaxEvents` in `ws/handlers/catch-up.ts` — read the env, parse-int, fall back to the default on absent / unparseable / non-positive input.

## Why it needs to be done

`docs/security/m3-review/inputs.md` F-002 (Medium): a single client can push a 100 MiB JSON WS frame against today's defaults, Node parses it into memory (peak ~3-5× the encoded size), the dispatcher rejects it as malformed-envelope, and the server still pays the parse cost. Same shape on the HTTP side — Fastify will accept up to 1 MiB before the framework rejects, and the only HTTP body we accept that has any real user-controlled length is the session-create `topic` (already capped at 256 chars at the schema layer).

The realistic per-frame / per-body payloads we actually accept:

- **HTTP `POST /sessions`**: a couple hundred bytes (topic + privacy bool).
- **HTTP `POST /auth/...`**: handshake payloads from the OIDC client; no large body.
- **WS C→S envelopes**: every client-to-server type carries a tight Zod schema (`subscribe`, `unsubscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`). The largest free-text-bearing C→S envelope is `propose` carrying `new_wording` / `wording` / `content`; a sibling task (`user_text_length_caps`) will cap those fields at ~8 KiB. 64 KiB at the frame level is 6–8× headroom over the post-cap maximum.

64 KiB at both knobs is tight enough to choke a memory-pressure DoS early (a hostile client trying to push N × 100 MiB frames is rejected at 64 KiB before any JSON parser sees a byte of payload) and generous enough that no legitimate body bumps against it.

## Inputs / context

From [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (`createServer`, pre-task):

```ts
const app = Fastify({
  logger: defaultLogger,
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  ...options,
});
```

No `bodyLimit` set → Fastify's documented default of `1048576` (1 MiB) silently applies.

From [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (`wsConnectionHandlingPluginAsync`, pre-task):

```ts
await app.register(fastifyWebsocket, {
  preClose: wsShutdownPreClose,
  errorHandler(error, socket, request) { ... },
});
```

No `options.maxPayload` → `@fastify/websocket` passes through; the underlying `ws.WebSocketServer` defaults to `100 * 1024 * 1024` (100 MiB).

**Upstream `maxPayload` direction**: confirmed by reading `node_modules/.pnpm/ws@8.20.0/node_modules/ws/lib/` — `maxPayload` is consulted in `receiver.js` (`haveLength`, `decompress`) only, never in `sender.js`. The receiver creates a `RangeError` with `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` and close code **1009** ("Too Big") when an inbound message exceeds the limit. **Outgoing frames are NOT subject to `maxPayload`** — the server's `snapshot-state` response (which can be large for long sessions) is sent via the `Sender` and is unaffected.

This direction-asymmetry is what makes 64 KiB safe on both knobs: any legitimate client → server frame is well under 64 KiB (after `user_text_length_caps`); any server → client frame, including `snapshot-state`, is not gated by `maxPayload`.

From [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) — the precedent for env-var-driven resolution helpers:

```ts
export const DEFAULT_WS_CATCHUP_MAX_EVENTS = 500;
export const WS_CATCHUP_MAX_EVENTS_ENV = 'WS_CATCHUP_MAX_EVENTS';
export function resolveCatchUpMaxEvents(env: NodeJS.ProcessEnv = process.env): number {
  // parseInt; fall back to default on absent / empty / non-positive.
}
```

The two new helpers (`resolveBodyLimit`, `resolveWsMaxPayload`) mirror this shape so the per-helper readers all look alike.

## Constraints / requirements

- **`bodyLimit` default**: `64 * 1024` (65536 bytes). Env override: `BODY_LIMIT_BYTES`.
- **`maxPayload` default**: `64 * 1024` (65536 bytes). Env override: `WS_MAX_PAYLOAD_BYTES`.
- **Helpers exported**:
  - `apps/server/src/server.ts` — `DEFAULT_BODY_LIMIT_BYTES`, `BODY_LIMIT_ENV` const, `resolveBodyLimit(env)`.
  - `apps/server/src/ws/connection.ts` — `DEFAULT_WS_MAX_PAYLOAD_BYTES`, `WS_MAX_PAYLOAD_ENV` const, `resolveWsMaxPayload(env)`.
- **Resolution shape** (both helpers): read env → `parseInt(raw, 10)` → return default on `undefined` / `''` / `NaN` / `<= 0`. Mirrors `resolveCatchUpMaxEvents`.
- **`bodyLimit`** is set on the `Fastify({...})` factory call, BEFORE `...options` spread, so a test can override via `createServer({ bodyLimit: ... })` if it ever needs a per-test ceiling.
- **`maxPayload`** is wired into the `app.register(fastifyWebsocket, { maxPayload, preClose, errorHandler })` call in `wsConnectionHandlingPluginAsync`.
- **Inline comments** on both sites linking F-002 + this refinement.
- **Test-app compatibility**: `__buildTestWsApp` already calls `wsConnectionHandlingPlugin` with the same env resolution, so existing WS tests continue to use the same default (64 KiB). Tests that need a smaller limit (e.g. the oversized-payload regression) write a small fixture by setting the env temporarily — there is no need to thread a new option through `WsConnectionHandlingOptions` because we want the production path itself under test, not a side-door override.
- **Per ADR 0022**: every empirical verification is a committed test. The body-limit test (POST > 64 KiB → 413) and the WS-payload test (frame > 64 KiB → close 1009) both live as Vitest cases in the respective `.test.ts` files.

## Acceptance criteria

- `createServer()` (no options) builds a Fastify with `bodyLimit === 64 * 1024`. Verified via `app.initialConfig.bodyLimit` in a Vitest assertion.
- A POST to any route with a body > 64 KiB returns **413** under the canonical error envelope. Verified end-to-end via `app.inject({ method: 'POST', url: '/sessions', payload: 'a'.repeat(64 * 1024 + 1) })`.
- A POST with a body well under the limit (e.g. 1 KiB) reaches the route handler (asserts pass-through unchanged).
- A WS connection that sends a frame > 64 KiB receives a **close with code 1009**. Verified via `injectWS` in `connection.test.ts`.
- A WS connection that sends a normal-size frame is handled by the dispatcher as usual (regression).
- `resolveBodyLimit` / `resolveWsMaxPayload` unit tests cover: default on absent / empty / `NaN` / negative / zero, parsed value on a valid positive integer.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new tests; all pass.
- `complete 100` added to the `fastify_body_limit` task entry in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **64 KiB at both knobs.** Most C→S WS envelopes are < 1 KiB; the largest realistic free-text-bearing envelope (post-`user_text_length_caps`) will carry ~8 KiB of user-authored content plus envelope overhead. 64 KiB is 6–8× headroom over that ceiling and ~1500× under the current `ws` default. Production can tune up via env without a code change if a future feature requires.
- **`maxPayload` 64 KiB is safe in both directions.** Confirmed by reading the upstream `ws` library: `maxPayload` only gates the **receiver** path (`receiver.js`, `permessage-deflate.js`), never the sender. Outgoing frames (including a potentially-large `snapshot-state`) are not subject to it. A future deployment that observes legitimate inbound frames bumping the ceiling can tune `WS_MAX_PAYLOAD_BYTES` without touching code.
- **Close code 1009 ("Too Big") for oversize WS frames.** Set by the upstream `ws` library when `maxPayload` is exceeded; we don't override it. This is the IANA WebSocket close code reserved for "message too big to process" (RFC 6455 §7.4.1). Clients reading the close code can distinguish "too big" from "internal error" (1011) and "going away" (1001).
- **Env vars `BODY_LIMIT_BYTES` and `WS_MAX_PAYLOAD_BYTES`.** Matches the project's `_BYTES` suffix convention; the `WS_` prefix mirrors `WS_CATCHUP_MAX_EVENTS`.
- **Defaults baked into exported constants** (`DEFAULT_BODY_LIMIT_BYTES`, `DEFAULT_WS_MAX_PAYLOAD_BYTES`) so tests can assert against the constant rather than re-typing the magic number; matches the `DEFAULT_WS_CATCHUP_MAX_EVENTS` precedent.
- **No throwaway-option-on-`createServer`.** The env-var resolution happens at factory time. Tests that want to verify the resolution helper in isolation call it directly with a `{ BODY_LIMIT_BYTES: '...' }` record; the integration tests use the helper's actual default. The `createServer` options shape stays purely Fastify-passthrough (`FastifyServerOptions`).
- **No throwaway-option on `WsConnectionHandlingOptions`.** Same reasoning — production path resolves the env at registration time; tests that need a smaller limit set the env. The existing `__buildTestWsApp` continues to work without changes; existing call sites are not perturbed.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — added `DEFAULT_BODY_LIMIT_BYTES = 64 * 1024`, `BODY_LIMIT_ENV = 'BODY_LIMIT_BYTES'`, `BodyLimitEnv`, and `resolveBodyLimit(env)`. Wired `bodyLimit: resolveBodyLimit(process.env)` into the `Fastify({...})` factory call (before the `...options` spread so a test can still override per-instance).
  - [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — added `DEFAULT_WS_MAX_PAYLOAD_BYTES = 64 * 1024`, `WS_MAX_PAYLOAD_ENV = 'WS_MAX_PAYLOAD_BYTES'`, `WsMaxPayloadEnv`, and `resolveWsMaxPayload(env)`. Wired `options: { maxPayload: resolveWsMaxPayload(process.env) }` into the `app.register(fastifyWebsocket, ...)` call. Inline comments document the F-002 close + the receiver-only direction of `maxPayload` (verified against `ws@8.20.0/lib/receiver.js`).

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts) — +10 tests (15 → 25 in the file). Two new describe blocks:
    - `resolveBodyLimit` — 6 tests pinning default-on-absent / empty / NaN / zero / negative, parsed-on-positive, and the `BODY_LIMIT_ENV` constant.
    - `createServer — bodyLimit lockdown (inputs.md F-002)` — 4 tests pinning `app.initialConfig.bodyLimit` against the default and against the env override, and the end-to-end behavior (POST > 64 KiB → 413 with canonical envelope; POST < 64 KiB does NOT trip 413 — regression).
  - [`apps/server/src/ws/connection.test.ts`](../../../apps/server/src/ws/connection.test.ts) — +7 tests (5 → 12 in the file). Two new describe blocks:
    - `resolveWsMaxPayload` — 5 tests pinning default-on-absent / empty / NaN / zero / negative, parsed-on-positive, and the `WS_MAX_PAYLOAD_ENV` constant.
    - `wsConnectionHandlingPlugin — maxPayload lockdown (inputs.md F-002)` — 2 integration tests: oversized inbound frame (4 KiB+1 against a tight 4 KiB env override) → WS close code **1009** ("Too Big"); 1 KiB malformed frame against the default 64 KiB → dispatcher sees the frame (replies with `malformed-envelope`, connection stays open — regression).

- `tasks/25-backend-hardening.tji` — `complete 100` added to `fastify_body_limit`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: +17 Vitest cases (server.test.ts: +10; ws/connection.test.ts: +7). `pnpm run check` and `pnpm run test:smoke` both green (1090 tests across 68 files).

**WS `maxPayload` direction (load-bearing finding)**: confirmed against `ws@8.20.0` upstream sources — `maxPayload` is consulted by `lib/receiver.js` (`haveLength`) and `lib/permessage-deflate.js` (`decompress` callback) only; `lib/sender.js` does NOT reference it. Outgoing frames are therefore not subject to the limit, so a 64 KiB ceiling is safe even for the server's `snapshot-state` reply path (which can exceed 64 KiB on long sessions). The receiver emits a `RangeError` with code `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH` and WS close code 1009 when an inbound message exceeds the ceiling.
