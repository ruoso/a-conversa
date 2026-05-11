# Server → client: canonical error envelope

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.websocket_protocol.ws_error_message`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — the closed `WsMessageType` enum + `WsDispatcher`'s `onUnknownType` / `onHandlerError` seams + `parseWsEnvelopeJson` and the `WsEnvelopeValidationError` it throws on a malformed inbound frame), `backend.websocket_protocol.ws_subscribe_to_session` (settled — the placeholder log+drop branch on visibility failure in `apps/server/src/ws/handlers/subscribe.ts` is replaced by this task with a typed error envelope), `backend.api_skeleton.error_handling` (settled — the `ApiError` shape `{ code, message, ...details }` whose `code` vocabulary the WS error envelope reuses).

## What this task is

Land the canonical **server → client** error envelope and wire it into the three placeholder error paths left by `ws_message_envelope` and `ws_subscribe_to_session`:

1. **The envelope shape.** A new `error` entry in the closed `WsMessageType` enum in `packages/shared-types/src/ws-envelope.ts` plus its payload schema. The payload mirrors the HTTP `ApiError` body shape minus the HTTP status code (the WS channel has no status code; the `code` discriminator is the typed branch). Fields:
   - `code: string` — kebab-case discriminator. Reuses the HTTP `ApiError.code` taxonomy where applicable (`unauthorized`, `forbidden`, `not-found`, `bad-request`, `conflict`, `unprocessable-entity`, `internal-error`) and adds two WS-specific codes (`unknown-message-type` for an unregistered `type`; `malformed-envelope` for a frame that fails `parseWsEnvelopeJson`). Future message-type tasks (propose / vote / commit / meta-disagreement) will reuse this `code` field for `RejectionReason` values surfaced by the methodology engine.
   - `message: string` — human-readable detail. `ApiError`-shaped server-side errors echo their own `message` here; non-`ApiError` throws surface the generic literal `'internal error'` (the no-leak rule below).
   - `details?: Record<string, unknown>` — optional structured context (Zod issues, methodology-rejection details, etc.). Same `ApiErrorDetails` shape the HTTP envelope uses.
2. **The construction helper.** `apps/server/src/ws/error-envelope.ts` exports `buildWsErrorEnvelope({ inResponseTo?, code, message, details? })` which returns a typed `WsEnvelope<'error'>` with a freshly minted v4 UUID `id`, and `sendWsError(send, options)` which builds + serialises + invokes the sender closure. The two-function split keeps the builder unit-testable (Vitest, pure-logic) without standing up a Fastify instance, while the sender wraps it for the dispatcher + handler call sites.
3. **The dispatcher-seam wiring.** The two seams `WsDispatcher` already exposes (`onUnknownType`, `onHandlerError`) are wired in `wsDispatcherPlugin` to call `sendWsError` against the per-connection socket. `onUnknownType` emits `code: 'unknown-message-type'`. `onHandlerError` discriminates: if the thrown value is an `ApiError`-shaped object (has both `code: string` and `message: string` fields), the wire envelope echoes those; otherwise it emits the generic `code: 'internal-error'` / `message: 'internal error'` and logs the underlying error server-side at error level (the no-leak rule).
4. **The malformed-envelope wiring.** The receive loop in `apps/server/src/ws/connection.ts` currently logs + drops on a `WsEnvelopeValidationError` from `parseWsEnvelopeJson`. The catch branch is replaced with `sendWsError(code: 'malformed-envelope', message: ...)`. **The connection stays open** — a malformed frame is a client bug, not a server failure; closing the socket would mask transient framing glitches that the client can recover from by re-sending. (This matches the dispatcher's "log + continue" contract for unknown types and handler exceptions — the WS surface treats per-frame failures as recoverable.)
5. **The subscribe-handler placeholder cleanup.** The visibility-rejection branch in `apps/server/src/ws/handlers/subscribe.ts` currently logs at warn level and returns; it is replaced with `sendWsError(socket, { code: 'not-found', inResponseTo: envelope.id, message: 'session not found' })`. The `not-found` (vs. `forbidden`) discriminator inherits the existence-non-leak rule from `get_session_endpoint` / `canSeeSession` — if the user can't see it, the wire says not-found, not forbidden, regardless of whether the underlying row exists.

The per-connection `WsConnectionContext` now carries the same sender closure the connection handler registers on `app.wsConnectionSenders` (the broadcast surface's per-connection sender registry). The error helper takes the sender closure as a parameter — keeping the helper decoupled from any specific socket implementation and reusable across the dispatcher seams (which only see `WsConnectionContext`) and the subscribe handler (which already uses `connection.socket.send`).

## Why it needs to be done

Three callers today have a placeholder error path that ships as "log + drop" with an explicit comment naming `ws_error_message`:

- `apps/server/src/ws/dispatcher.ts`'s default `onUnknownType` / `onHandlerError` callbacks — log only; no wire-format error reaches the client.
- `apps/server/src/ws/connection.ts`'s receive loop — on `parseWsEnvelopeJson` rejection, logs + drops.
- `apps/server/src/ws/handlers/subscribe.ts`'s visibility-failure branch — logs + drops; the client never sees the rejection.

The client-side surface today has no way to distinguish a server-handler bug from a transient network glitch from a methodology rejection. Every state-changing client action (subscribe / propose / vote / commit / mark-meta-disagreement / snapshot) needs a deterministic rejection channel; the upcoming five message-type tasks (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`) will all surface their methodology-engine `RejectionReason` failures through this same `error` envelope. Landing the surface now means each of those tasks adds only its `code` value to the documented vocabulary, not a new wire shape.

## Inputs / context

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts):

- `ApiError` carries `code: string`, `message: string`, optional `details: ApiErrorDetails`. The class also carries `statusCode: number` for the HTTP envelope — the WS envelope drops `statusCode` because the channel has no status code; the `code` discriminator is the typed branch.
- The kebab-case `code` taxonomy: `bad-request`, `unauthorized`, `forbidden`, `not-found`, `conflict`, `unprocessable-entity`, `internal-error`. The `rejectedToApiError(rejection)` mapper turns a methodology `RejectionReason` into an `ApiError` whose `code` is the rejection's `reason` verbatim — meaning every future `RejectionReason` value (`not-a-moderator`, `self-vote-not-allowed`, `sequence-mismatch`, `proposal-not-pending`, ...) is automatically part of the WS error vocabulary when the matching message-type task lands.

From [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts):

- The two seams `onUnknownType(envelope, connection)` and `onHandlerError(err, envelope, connection)` already exist; `ws_message_envelope` landed them with default `log + return` implementations and an explicit comment naming `ws_error_message` as the task that will plug in the wire-format construction. Wiring them today does NOT change the dispatcher's signature.

From [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts):

- The receive-loop's catch on `WsEnvelopeValidationError` is the single malformed-envelope branch — replacing it is one edit. The same loop registers a per-connection sender on `app.wsConnectionSenders` on open; the sender closure is the natural reuse point for `sendWsError`'s send-fn parameter.

From [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts):

- The visibility-rejection branch is one log call. Replacing it with `sendWsError(code: 'not-found', inResponseTo: envelope.id, ...)` is the placeholder cleanup the prior refinement explicitly named.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md):

- Schema-on-write — every server-emitted envelope passes through `serializeWsEnvelope` (which calls `parseWsEnvelope` first) before reaching the socket. The error envelope's schema is therefore enforced at construction time; a server bug that produces an `error` envelope with a missing `code` field surfaces at serialise time, not on the client.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure-logic builder behaviour (envelope shape, `inResponseTo` optionality, `code`/`message` echoing) → Vitest. Wire-path behaviour (dispatcher seams firing on the wire; malformed frames producing the error envelope; subscribe placeholder replaced with `not-found`) → Cucumber against the real `app.injectWS` upgrade path.

## Constraints / requirements

- **Source of truth**: `packages/shared-types/src/ws-envelope.ts` owns the `error` type, the `errorPayloadSchema`, and the `WsMessagePayloadMap['error']` entry. Server-side `apps/server/src/ws/error-envelope.ts` is the construction + sender glue (the `buildWsErrorEnvelope` builder + the `sendWsError` adapter). The exhaustive `Record<WsMessageType, …>` annotation enforces the three-place update at compile time.
- **Unified `code` vocabulary.** Reuse `ApiError.code` taxonomy verbatim where applicable. Add two WS-specific codes: `unknown-message-type` (dispatcher's `onUnknownType`) and `malformed-envelope` (connection.ts's `parseWsEnvelopeJson` rejection). Future message-type tasks add their `RejectionReason`-derived codes through the same surface — no new wire shape per task.
- **`inResponseTo` correlation contract.**
  - Present when the error responds to a specific client envelope. Cases: dispatcher seams (echo `envelope.id`), subscribe handler's visibility rejection (echo the originating `subscribe` envelope's id).
  - Absent when the error is server-emitted without a client correlate. Cases: malformed-envelope (we can't read the `id` off a frame that failed to parse — there might not be one); future fire-and-forget server-emitted conditions (rare in v1, but the shape must permit them).
- **No-leak rule for non-`ApiError` thrown values.** `onHandlerError` MUST NOT echo a generic `error.message` to the client — programmer-error messages can leak stack details, database column names, internal hostnames, etc. The branch:
  - If the thrown value is an `ApiError`-shaped object (has both `code: string` and `message: string` fields): use `err.code` + `err.message` (these were chosen explicitly by the handler that threw — safe to echo).
  - Otherwise: emit the generic literal `code: 'internal-error'` / `message: 'internal error'` and log the full error server-side at error level. The client gets the discriminator (`internal-error`) so it can branch; the operator sees the detail in the server log.
- **Connection-stays-open invariant on malformed envelopes.** A frame that fails `parseWsEnvelopeJson` triggers `sendWsError(code: 'malformed-envelope')`; the socket is NOT closed. Rationale: framing glitches are transient client bugs that the client can recover from by re-sending. Closing the socket would force a reconnect (and a re-auth + re-subscribe round-trip) for what may be a one-frame hiccup. The connection-test pins this contract.
- **Connection-stays-open invariant on dispatcher-seam fires.** Same rule: the dispatcher's `onUnknownType` / `onHandlerError` send an error envelope and the connection remains open. The receive loop keeps reading the next frame.
- **`ApiError`-shape duck-typing.** The `onHandlerError` branch checks for `typeof err.code === 'string' && typeof err.message === 'string'`; it does NOT `instanceof ApiError`. Rationale: methodology-engine rejections may be wrapped into `ApiError` via `rejectedToApiError(rejection)` at the call site, OR a future message-type handler may construct a plain-object error with the same shape. Duck-typing covers both without forcing a specific import.
- **No throwaway probes (ADR 0022).** Every behaviour we want pinned ships as a committed test. The three placeholder paths each get coverage at the layer matching the change:
  - Pure-logic builder → Vitest (`error-envelope.test.ts`).
  - Dispatcher seam fires → Vitest (`dispatcher.test.ts` extension).
  - Subscribe handler's not-found → Vitest (`handlers/subscribe.test.ts` extension).
  - Malformed-envelope wire surface → Vitest (`connection.test.ts` extension) + Cucumber (`ws-error.feature`).
  - End-to-end wire surface for unknown-type / not-found → Cucumber (`ws-error.feature`).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm --filter @a-conversa/shared-types run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, with a net positive test delta (new builder tests + extensions on dispatcher / subscribe / connection test files; existing 920 vitest pass after the change).
- `pnpm run test:behavior:smoke` (Cucumber) green, with **+3 scenarios** in `tests/behavior/backend/ws-error.feature` (unknown-type produces wire error; malformed JSON produces wire error and the connection still works after; subscribe-to-non-visible-session produces a wire error with `not-found`). The existing `ws-subscribe.feature` "no-ack" scenario is replaced (in-place) with the new `not-found` assertion — the prior log+drop behaviour is gone.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- A reader of `apps/server/src/ws/error-envelope.ts` can identify exactly where each downstream message-type task (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`) will reuse `sendWsError` for its methodology-rejection path.

## Decisions

- **Unified `code` vocabulary spanning HTTP and WS.** The HTTP envelope's `ApiError.code` taxonomy and the WS envelope's `payload.code` share the same kebab-case strings (`unauthorized`, `forbidden`, `not-found`, `bad-request`, `conflict`, `unprocessable-entity`, `internal-error`) plus two WS-specific additions (`unknown-message-type`, `malformed-envelope`). Future `RejectionReason` values from the methodology engine ride the same surface via `rejectedToApiError(rejection).code` once the message-type tasks land. Rationale: a client that handles HTTP and WS through the same dispatch layer (the moderator console and the participant tablet both will) gets one branch table for both transports. Splitting the vocabularies would force every consumer to maintain a per-transport mapping for no semantic gain.
- **`inResponseTo` correlation contract.** Present when the error responds to a specific client envelope (dispatcher seams echo `envelope.id`; subscribe handler's visibility rejection echoes the originating subscribe envelope's id). Absent when the error is server-emitted without a client correlate (malformed-envelope is the canonical case — we can't read an `id` off a frame that failed to parse). The shape permits the absent case for future fire-and-forget server-emitted conditions (e.g. a session-wide policy violation broadcast); v1 only uses the absent case for malformed-envelope.
- **No-leak rule for non-`ApiError` thrown values.** `onHandlerError` discriminates by duck-typing: if the thrown value has both `code: string` and `message: string`, it's treated as `ApiError`-shaped and the wire envelope echoes those fields. Otherwise the wire envelope emits the generic literal `code: 'internal-error'` / `message: 'internal error'` and the full error is logged server-side at error level. Security rationale: a programmer-error `throw new Error('SELECT failed near "host_user_id"')` leaks the database column to the client; the literal generic message keeps the client surface flat and tells the operator (via the log) where to look. `ApiError` is the explicit opt-in for safe-to-echo messages — handlers that want a specific message visible to the client throw `ApiError.notFound(...)`, `ApiError.conflict(...)`, etc.
- **Connection-stays-open on malformed envelopes (vs. close).** A frame that fails `parseWsEnvelopeJson` triggers `sendWsError(code: 'malformed-envelope')`; the socket is NOT closed. Rationale: a malformed frame is a per-frame client bug, not a connection-state problem. The client may recover by re-serialising and re-sending; closing the socket would force a reconnect + re-auth + re-subscribe handshake for a one-frame hiccup. This matches the dispatcher's already-existing log-and-continue contract for unknown types and handler exceptions — every error surface in the WS protocol stays at the per-frame level. The cucumber scenario "client sends malformed JSON; the same connection still works after" pins this invariant against regression.
- **`ApiError`-shape duck-typing in `onHandlerError`.** The branch checks `typeof err.code === 'string' && typeof err.message === 'string'`; it does NOT `instanceof ApiError`. Rationale: (a) methodology-engine rejections may be wrapped into `ApiError` at the call site (`rejectedToApiError(rejection)`) or constructed as plain-object errors by a future message-type handler; (b) the cross-workspace import would force every handler to depend on `apps/server/src/errors.ts` even if it only constructs a plain-object error. Duck-typing covers both shapes; the alternative (a structural type guard helper) would be the same code in a different file.
- **`error-envelope.ts` is the single construction surface.** Both dispatcher seams and the subscribe handler call `sendWsError(send, {...})` against the same helper. The helper builds the envelope, runs it through `serializeWsEnvelope` (so a construction bug fails loudly at the server, not on the client), and invokes the sender closure. The five upcoming message-type tasks (propose / vote / commit / meta-disagreement / snapshot) will reuse the same helper for their methodology-rejection path — adding a new code value to the existing vocabulary, not a new wire shape.
- **Sender as a parameter, not coupled to `socket.send` directly.** `sendWsError(send, options)` takes the sender closure as a parameter so the helper is decoupled from any specific socket implementation. The dispatcher seams reach the sender via the per-connection `app.wsConnectionSenders.get(connectionId)` registry the broadcast surface already populates; the subscribe handler reaches it via `connection.socket.send` directly (the closure-wrap is a one-line lambda). Either source produces the same wire output because both flow through `serializeWsEnvelope`.
- **The `error` discriminator is the closed-enum extension.** Adding `error` to `wsMessageTypes`, `wsMessagePayloadSchemas['error']`, and `WsMessagePayloadMap.error` is the three-place change the closed-union pattern requires. The compiler enforces exhaustiveness — a future task that adds a new `WsMessageType` without the matching registry + map entry breaks build. Same discipline `ws_message_envelope` established.
- **Connection-test extension for malformed-envelope.** The existing `connection.test.ts` is extended with one scenario asserting `socket.send('{ not valid')` produces an `error` envelope with `code: 'malformed-envelope'` AND the readyState stays at OPEN AND a subsequent valid frame is still processed. Pins both the wire-format contract and the connection-stays-open invariant.
- **Dispatcher-test extension for both seams.** Existing `dispatcher.test.ts` gets three new tests: `onUnknownType` sends an `error` envelope with `code: 'unknown-message-type'`; `onHandlerError` for a generic `Error` produces `code: 'internal-error'` and the wire message is the literal `'internal error'` (NOT `err.message`); `onHandlerError` for an `ApiError`-shaped throw produces the wire envelope with the thrown `code` + `message`.
- **Subscribe-test extension for the visibility-failure path.** Existing `handlers/subscribe.test.ts` is extended with one test that replaces the current "no ack arrives" assertion with "an `error` envelope arrives with `code: 'not-found'` and `inResponseTo` echoing the subscribe envelope's id." The existing test on the same surface is updated in-place; the prior log+drop behaviour is gone.
- **Cucumber scenarios in `ws-error.feature`.** Three scenarios cover (1) unknown-type → wire error; (2) malformed JSON → wire error + the same connection still produces a working subscribe; (3) subscribe-to-non-visible-session → wire error with `not-found` (regression-pin for the placeholder replacement). The third scenario REPLACES (in-place) the existing "no-ack" scenario in `ws-subscribe.feature` — the prior log+drop assertion is gone because the behaviour it pinned is gone.
- **Cucumber step file `backend-ws-error.steps.ts`.** Owned by this task; reuses the auth-gated WS test-app + cookie carriers from `backend-ws-connection.steps.ts` / `backend-ws-auth.steps.ts` (same pattern as `backend-ws-envelope.steps.ts` / `backend-ws-subscribe.steps.ts`). Adds new Whens (send unknown-type envelope; send malformed frame) and Thens (receive error envelope with `code: …`; same connection still subscribes after).
- **Future message-type tasks reuse this surface.** Each of the five upcoming message-type tasks (`ws_propose_message`, `ws_vote_message`, `ws_commit_message`, `ws_meta_disagreement_message`, `ws_snapshot_message`) will surface a methodology-rejection failure (the engine's `RejectionReason`) as an `error` envelope through the same `sendWsError(send, { code: rejection.reason, message: rejection.detail, inResponseTo: envelope.id })` call — same surface, same vocabulary, no new wire shape per task. The `rejectedToApiError(rejection)` helper in `errors.ts` already produces the right `code` + `message` from a `RejectionReason`; the WS path can call the same helper or construct the equivalent literal directly.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- Shared types: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `error` added to `wsMessageTypes` + `errorPayloadSchema` + `wsMessagePayloadSchemas['error']` + `WsMessagePayloadMap.error`.
- Server (builder + sender helper): [`apps/server/src/ws/error-envelope.ts`](../../../apps/server/src/ws/error-envelope.ts) — `buildWsErrorEnvelope`, `sendWsError`, `isApiErrorShape`, and the exported `WS_*_CODE` / `WS_INTERNAL_ERROR_MESSAGE` constants.
- Server (dispatcher seam wiring): [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) — default `onUnknownType` now logs + sends `code: 'unknown-message-type'`; default `onHandlerError` logs + sends `code: <ApiError.code>` (echoed) or `code: 'internal-error'` (no-leak fallback).
- Server (malformed-envelope wiring): [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — receive-loop catch on `WsEnvelopeValidationError` now sends `code: 'malformed-envelope'` (no `inResponseTo`) and keeps the socket open.
- Server (subscribe placeholder cleanup): [`apps/server/src/ws/handlers/subscribe.ts`](../../../apps/server/src/ws/handlers/subscribe.ts) — visibility-rejection branch now sends `code: 'not-found'` with `inResponseTo = envelope.id` (the prior log+drop is gone).
- Barrel exports: [`apps/server/src/ws/index.ts`](../../../apps/server/src/ws/index.ts) re-exports the new builder + sender + constants.
- Tests (Vitest, +20 tests, total 920 → 940):
  - [`apps/server/src/ws/error-envelope.test.ts`](../../../apps/server/src/ws/error-envelope.test.ts) — 18 builder / sender / `isApiErrorShape` / constant tests.
  - [`apps/server/src/ws/dispatcher.test.ts`](../../../apps/server/src/ws/dispatcher.test.ts) — extended (8 tests total, +1 net) to cover both seams' wire output + the no-leak rule + the `ApiError`-shape echoing branch.
  - [`apps/server/src/ws/handlers/subscribe.test.ts`](../../../apps/server/src/ws/handlers/subscribe.test.ts) — visibility-rejection test rewritten in-place to assert the `not-found` wire envelope.
  - [`apps/server/src/ws/connection.test.ts`](../../../apps/server/src/ws/connection.test.ts) — +1 test for the malformed-envelope wire envelope + connection-stays-open invariant.
  - [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts) — vocabulary-pin test updated to include `error` in the closed enum.
- Tests (Cucumber, +2 scenarios net, total 190 → 192):
  - [`tests/behavior/backend/ws-error.feature`](../../backend/ws-error.feature) — +3 scenarios (unknown-type → error, malformed JSON → error + connection stays open, subscribe-not-visible → not-found).
  - [`tests/behavior/steps/backend-ws-error.steps.ts`](../../backend/steps/backend-ws-error.steps.ts) — step definitions.
  - [`tests/behavior/backend/ws-subscribe.feature`](../../backend/ws-subscribe.feature) — the "no-ack within 200ms" scenario is gone (replaced in-place by the not-found scenario in `ws-error.feature` — the prior log+drop behaviour was replaced by a typed wire envelope).
  - [`tests/behavior/steps/backend-ws-subscribe.steps.ts`](../../backend/steps/backend-ws-subscribe.steps.ts) — the matching dead Then step was removed; a note records the replacement.
- WBS: `complete 100` marker added to `ws_error_message` in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
