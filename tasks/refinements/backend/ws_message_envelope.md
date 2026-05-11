# Common WS message envelope and serialization

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_message_envelope`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.websocket_protocol.ws_connection_handling` (settled — the WS upgrade path + placeholder `hello` frame), `backend.websocket_protocol.ws_auth_on_connect` (settled at the parent `websocket_protocol`-task level: this task does NOT exercise auth, only consumes the auth-populated `WsConnectionContext.user`).

## What this task is

Define the canonical envelope shape that every WebSocket message — client→server AND server→client — flows through, plus the parse / serialize / dispatch seams downstream message-type tasks compose against. **No individual message types** are added here; those are six separate downstream tasks (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`, `ws_error_message`). What lands today:

1. **The envelope shape** — a generic `WsEnvelope<T>` carrying `type` (closed-enum discriminator), `id` (client-generated UUID v4 message id), optional `inResponseTo` (server uses to correlate error / ack envelopes back to the originating request), and `payload` (per-`type` shape from the discriminated-union variant).
2. **The Zod schema** — `wsEnvelopeSchema` for the outer envelope (type / id / inResponseTo / payload-as-unknown) plus a per-`type` payload-schema registry (`wsMessagePayloadSchemas`). `parseWsEnvelope` and `parseWsEnvelopeJson` run the two-stage parse (outer first, then payload) and return a typed `WsEnvelopeUnion`. `serializeWsEnvelope` validates-then-stringifies on the way out.
3. **The dispatcher seam** — a per-server-instance `WsDispatcher` class with `register(type, handler)` and `dispatch(envelope, connection)`. Each downstream message-type task calls `register(...)` from its own plugin / setup hook. Unknown-type and handler-exception paths route through replaceable seams (`onUnknownType`, `onHandlerError`) so `ws_error_message` can wire the actual wire-format error envelope into those seams when it lands.
4. **The hello migration** — the on-connect `hello` frame `ws_connection_handling` shipped (`{ type: 'hello', connectionId }`) is replaced by the envelope-shaped equivalent (`{ type: 'hello', id, payload: { connectionId } }`). The existing connection test asserts the new shape; the prior `WsHelloPlaceholder` interface is marked `@deprecated` and kept only as a historical type-level breadcrumb.

The source-of-truth schema lives in `packages/shared-types` (`ws-envelope.ts`) so the participant / moderator / audience apps import the same envelope types when they land. The server-side helpers (`apps/server/src/ws/envelope.ts`, `dispatcher.ts`) wrap the shared schema with construction + I/O glue.

## Why it needs to be done

`ws_connection_handling` lands the WebSocket upgrade path with a placeholder hello frame and an explicit deferral comment naming `ws_message_envelope` as the task that defines the canonical shape. Every downstream WS message-type task (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`, `ws_error_message`) depends on this envelope — they each register a handler against the dispatcher and parse/build envelopes of their type. Until this task lands, none of them can.

The broadcast surface (`ws_event_broadcast`, `ws_proposal_status_broadcast`, `ws_diagnostic_broadcast`) likewise needs the envelope shape — server-emitted broadcasts ride the same wire format as client-emitted messages.

The cross-app frontends (`participant_ui`, `moderator_ui`, `audience_ui`) consume the same envelope types via `@a-conversa/shared-types` — a single canonical shape across server and clients prevents the wire-format drift that ad-hoc per-message types would accumulate.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md):

- "Clients (moderator, debaters, audience) connect over **WebSockets**" — every state-changing client interaction (proposals, votes, commits, meta-disagreement) and every server-emitted state broadcast rides this channel.

From the existing event envelope ([ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md), [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts)):

- The persisted-event log uses a Zod-validated TypeScript discriminated union over a `kind` discriminator with a per-kind payload-schema registry and a two-stage parse (outer envelope first, per-kind payload second). The error message names the offending kind. **The WS envelope mirrors this pattern**: same library (Zod), same two-stage parse, same registry shape. The two envelopes are distinct — a WS message isn't always an event (votes before commit, error responses, snapshots) and the envelope fields differ (`id` + `inResponseTo` for WS correlation; `sessionId` + `sequence` for events) — but the discipline is identical.

From [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (the placeholder hello):

- `WsHelloPlaceholder` was explicitly named as the shape this task supersedes. The connection handler currently sends `JSON.stringify({ type: 'hello', connectionId })` as the first frame; this task replaces that send with the envelope-shaped equivalent and the test pin migrates to match.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts):

- The HTTP error envelope is `{ error: { code, message, ...details } }`. The WS error envelope (owned by `ws_error_message`, NOT this task) mirrors that shape. This task defines the seam (the `onUnknownType` / `onHandlerError` callbacks on `WsDispatcher`) so the error-message task can plug the wire-format construction in without touching this file's contract.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Every empirical verification is a committed test. Pure-logic envelope behavior (round-trip, parse rejection, dispatcher registry) is Vitest; envelope-over-the-wire flow (the canonical hello frame; the malformed-message path) is Cucumber against `app.injectWS`. No mocks of the WS library; no ad-hoc probes.

## Constraints / requirements

- **Source of truth**: `packages/shared-types/src/ws-envelope.ts` owns the schema + types. Server-side `apps/server/src/ws/envelope.ts` is a wafer-thin wrapper that re-exports the shared surface and adds server-side construction helpers (`buildHelloEnvelope`, `buildServerEnvelope`). Cross-app frontends import from `@a-conversa/shared-types` directly.
- **Wire format**: JSON, full stop. See Decisions for the rationale against msgpack / binary alternatives.
- **Discriminator field**: `type` (string literal from a closed enum). The closed-vs-open question is settled — closed, via `z.enum(wsMessageTypes)` plus a `Record<WsMessageType, …>` registry whose exhaustiveness TypeScript enforces. Adding a new `type` is a deliberate code change in three files (`wsMessageTypes`, the payload registry, the `WsMessagePayloadMap`); the compiler complains until all three are updated.
- **Correlation**: every envelope carries `id` (RFC 4122 v4 UUID). `inResponseTo` is optional — server-emitted responses (errors, acks, commit-results when those land) echo the originating client envelope's `id`. The server mints its own `id` on unsolicited server-emitted envelopes (`hello`, broadcasts).
- **Dispatcher**: per-server-instance, decorated onto `app.wsDispatcher` via a `fastify-plugin`-wrapped Fastify plugin. Mirror of the `authenticatePlugin` decoration pattern. Sibling message-type plugins reach for `app.wsDispatcher.register(...)` at their own registration time; the connection handler calls `app.wsDispatcher.dispatch(envelope, ctx)` for every inbound frame.
- **Unknown-type policy**: when a parsed envelope's `type` has no registered handler, the dispatcher's default `onUnknownType` callback logs at warn level with `{ connectionId, messageId, messageType }`. The wire-format error envelope is `ws_error_message`'s job — this task provides the seam, not the implementation.
- **Handler-exception policy**: when a handler throws or rejects, the dispatcher catches and routes through `onHandlerError`. Default logs at error level. Same wire-format-error deferral.
- **Hello migration**: the on-connect frame is now envelope-shaped (`{ type: 'hello', id, payload: { connectionId } }`). The single existing connection-handling test that asserted the placeholder shape is updated in-place; no test count change for that test.
- **No mocking of the WS library**: Vitest tests against the dispatcher are pure-logic (no `app.injectWS`); Cucumber tests use the real upgrade path through `createServer` + `app.injectWS`.
- **Coordination with `ws_auth_on_connect`**: the two tasks edit `connection.ts` concurrently. The auth task adds a `preValidation` hook that runs BEFORE the WS handshake completes; this task adds the message-receive loop INSIDE the connection handler that fires AFTER the handshake. The two stream-edits compose without overlapping — the auth happens before the dispatcher runs.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, with **net +26 tests** (19 new envelope tests in `packages/shared-types/src/ws-envelope.test.ts` + 7 new dispatcher tests in `apps/server/src/ws/dispatcher.test.ts`; the existing connection-test count is unchanged because the hello-shape test migrates in-place).
- `pnpm run test:behavior:smoke` (Cucumber) green, with **+2 scenarios** in `tests/behavior/backend/ws-envelope.feature`.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- The placeholder `{ type: 'hello', connectionId }` frame is gone from the wire; the canonical envelope is the new first frame on every connection.
- A reader of `apps/server/src/ws/dispatcher.ts` can identify exactly where `ws_error_message` will plug the wire-format error envelope into the unknown-type and handler-exception seams.

## Decisions

- **Wire format: JSON.** Three reasons. (1) Every existing transport in the project is JSON — the HTTP error envelope, the OpenAPI surface, the persisted-event payload in JSONB columns. Adding a second wire format for one channel would force every consumer to handle two encodings. (2) The development surface (browser devtools, `wscat`, `injectWS`) treats text frames as inspectable; binary frames need a decoder hooked up before anything is readable. (3) The bandwidth savings of msgpack / protobuf are real but small at the message sizes this protocol carries (a vote envelope is ~200 bytes JSON; the same in msgpack is ~120 bytes — single-digit kbps savings on a session at peak). The cost of the second wire format outweighs the bandwidth win until a profiler says otherwise.
- **Closed discriminated union via `z.enum` + registry.** `wsMessageTypes` is an `as const` tuple; `wsMessageTypeSchema = z.enum(...)`. Adding a new `type` requires editing three places (the tuple, the registry entry, the payload-type-map interface) — TypeScript enforces the exhaustiveness via `Record<WsMessageType, z.ZodTypeAny>` and the `WsMessagePayloadMap` interface. **An open union would let the server silently accept an unknown `type` and route to a missing handler**, defeating the dispatcher's reject-unknown contract. Closed is the right shape.
- **Two-stage parse (outer + per-`type` payload) instead of a giant `z.discriminatedUnion`.** Same trade-off `events.ts` made: a type-mismatch surfaces at the envelope level; a payload-shape error surfaces tagged with the offending `type`. `z.discriminatedUnion` produces an issue tree that mixes envelope and payload errors; the two-stage parse keeps them distinct. The cost (two `safeParse` calls per envelope vs one) is rounding-error on the WS receive surface.
- **`id` is required on every envelope; `inResponseTo` is optional.** Client and server both mint a v4 UUID per message they originate (`crypto.randomUUID()` Node-side; `crypto.randomUUID()` browser-side). Server-emitted responses (errors, acks, commit-results) echo the originating envelope's `id` via `inResponseTo`. Unsolicited server-emitted envelopes (`hello`, broadcasts) carry their own `id` and no `inResponseTo`. The pattern matches the request-id correlation HTTP middleware already uses (`x-request-id` reflected back on responses; the WS surface uses `id` + `inResponseTo` instead because the WS channel is duplex).
- **Dispatcher decoration pattern: per-app-instance.** `WsDispatcher` is constructed inside the Fastify plugin and decorated onto `app.wsDispatcher`. Module-scoped state would carry handlers across `createServer()` instances and tests would interfere with each other. The decoration uses `fastify-plugin`'s skip-override so the decorator reaches the root scope (mirror of `app.authenticate`).
- **Unknown-type and handler-error seams are constructor options.** `WsDispatcher` accepts optional `onUnknownType` and `onHandlerError` callbacks; defaults log at warn / error level and return. `ws_error_message` will replace the defaults (or override them at construction time) with the wire-format error envelope. The seam means this task ships without depending on the not-yet-existing error envelope while leaving a clearly-marked plug-in point.
- **The hello frame is now envelope-shaped.** `{ type: 'hello', id, payload: { connectionId } }`. The placeholder `WsHelloPlaceholder` interface is marked `@deprecated` but kept so a code reader scanning the file finds the migration breadcrumb. The connection-handling test that asserted the placeholder shape is updated in-place to assert the envelope shape — no net test-count change, just a hello-shape migration.
- **JSON-only via `parseWsEnvelopeJson` rejects binary frames implicitly.** Binary frames (`Buffer`, `ArrayBuffer`, fragmented `Buffer[]`) are stringified to UTF-8 before `JSON.parse`; a binary frame that's not valid UTF-8 JSON fails the parse and routes through the same `WsEnvelopeValidationError` path as a malformed string. The future protocol can introduce a binary message type if a real need arises; the current contract is JSON-text-only.
- **`serializeWsEnvelope` validates on the way out.** A round-trip through `parseWsEnvelope` before `JSON.stringify` catches the case where the server constructs a malformed envelope (programmer error). The cost is one extra parse per outgoing frame, which is negligible on the WS surface. Without this, a server bug would silently emit a bad envelope and break the client's parse with a confusing error far from the cause.
- **Coordination with `ws_auth_on_connect`**: the auth task adds a `preValidation` hook + a `user` field on `WsConnectionContext`; this task adds the message-receive loop + `app.wsDispatcher`. The auth gate runs BEFORE the connection handler ever fires (so the dispatcher only sees authenticated connections); the dispatcher runs INSIDE the connection handler (so per-connection auth is available via `ctx.user` when handlers reach for it). The two compose at integration time without overlapping.
- **Cucumber scenarios use `app.injectWS` via `createServer`**: same surface as `ws-connection.feature`. Two scenarios — the canonical hello envelope arrives on connect; a malformed client message surfaces via the warn-level log path (asserted via a log-capture seam, since the wire-format error envelope is `ws_error_message`'s job).

## Open questions

(none — all decided)
