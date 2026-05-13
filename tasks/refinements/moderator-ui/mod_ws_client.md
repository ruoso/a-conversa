# Moderator WebSocket client

**TaskJuggler entry**: `moderator_ui.mod_shell.mod_ws_client` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 2d
**Inherited dependencies**: `mod_state_management` (settled — Zustand slices under `apps/moderator/src/stores/`), `backend.websocket_protocol.ws_message_envelope` (settled — `parseWsEnvelopeJson` + `serializeWsEnvelope` published from `@a-conversa/shared-types`).

## What this task is

The moderator console's typed WebSocket-client layer. Opens a single `/ws` connection per authenticated session, sends typed C→S envelopes, parses inbound S→C envelopes via `parseWsEnvelopeJson` from `@a-conversa/shared-types`, and routes the result into a Zustand slice the rest of the moderator UI subscribes to.

The client owns four pieces of behavior:

1. **Lifecycle**: open the socket after the auth hook reports `authenticated`; close it on logout / unmount.
2. **Typed send**: a `send(envelope: WsEnvelopeUnion): Promise<WsEnvelopeUnion | undefined>` that mints an `id`, serializes via `serializeWsEnvelope`, sends, and resolves the returned promise on the correlated `inResponseTo` reply (or rejects on a correlated `error` envelope).
3. **Inbound dispatch**: every parsed envelope is appended to a Zustand-backed log and, for `event-applied` frames, deduped by `event.sequence` into a per-session event log. Subscriber slices/components select against the store.
4. **Reconnection + catch-up**: on `close` (any code), retry with exponential backoff capped at 30s; after the new socket's `hello`, re-`subscribe` to every previously-subscribed session and issue a `catch-up` envelope with `sinceSequence = highWaterMark[sessionId]`. The server's catch-up handler either replays missing events (slice path) or sends a `snapshot-state` (fallback path); both routes deliver into the same dispatch table.

## Why it needs to be done

Every moderator-UI flow downstream of `mod_shell` reads its server-state surface through this client:

- `mod_capture_flow.mod_propose_action` sends a `propose` envelope; the resulting `proposed` ack drives "proposal accepted" UI feedback, while the `event-applied` broadcast (post-commit-ack) is what fans the new pending proposal into the right-sidebar's pane.
- `mod_pending_proposals_pane.*` reads the pending-proposal list off the dispatched `event-applied` + `proposal-status` frames.
- `mod_diagnostic_flow.*` reads diagnostic frames out of the dispatched `diagnostic` envelopes.
- `mod_change_history_pane.*` reads the projected event log directly.
- `mod_pending_proposals_pane.mod_commit_button` and `mod_meta_move_flow` both `send` write envelopes.

A single client surface owned here means: one reconnection state machine, one envelope-correlation table, one dedupe rule, one Zustand store slice the rest of the UI selects against.

## Inputs / context

- **Canonical wire spec**: [`docs/ws-protocol.md`](../../../docs/ws-protocol.md) — every envelope, gate stack, error code, reconnection sequence.
- **Schema source of truth**: [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `parseWsEnvelopeJson`, `serializeWsEnvelope`, `WsEnvelopeUnion`, the per-`type` payload map.
- **Auth gate**: [`apps/moderator/src/auth/useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) — the client opens only when `auth.status === 'authenticated'`. The `aconversa-session` cookie is HttpOnly and is attached by the browser on the WS upgrade automatically (same-origin in production, Vite dev-server proxies `/ws` to backend per `mod_app_skeleton`'s decisions).
- **Sibling stores**: [`apps/moderator/src/stores/index.ts`](../../../apps/moderator/src/stores/) — three slices already in place (`captureStore`, `selectionStore`, `uiStore`). This task adds a fourth slice for server-state (`wsStore`).
- **Reconnection contract**: [`tasks/refinements/backend/ws_reconnection_handling.md`](../backend/ws_reconnection_handling.md) — the server-side `catch-up` handler this client drives.

## Constraints / requirements

- **Schema consumption**: the client MUST consume `parseWsEnvelopeJson` and `serializeWsEnvelope` from `@a-conversa/shared-types`. Re-implementing the envelope schema is forbidden (the schema is the single source of truth).
- **No dynamic import of envelope helpers** — they live in the moderator bundle from start, not lazily.
- **Browser-only**: `new WebSocket(url)` is the transport; no `ws` npm package, no Node-only primitives.
- **Cookie-only auth**: the client never reads the session cookie (it's HttpOnly) and never appends an auth token to the URL. Same-origin upgrade carries the cookie.
- **Reconnect policy**:
  - Backoff schedule: 250ms, 500ms, 1s, 2s, 4s, 8s, 16s, 30s, 30s, … (cap 30s). Reset on any successful `hello` receipt.
  - Reconnect is automatic. The client surfaces `status: 'open' | 'connecting' | 'closed' | 'reconnecting'` for UI affordances.
  - Reconnect is suppressed when the close is initiated by the client itself (logout / explicit `close()` / unmount).
- **Subscription resume**: after every successful reconnection, the client iterates `wsStore.subscriptions` (the set of sessionIds the consumer asked for) and sends `subscribe` then `catch-up` for each. The client does NOT track sessions the consumer never opted into.
- **Dedupe**: `event-applied` frames are deduped by `event.sequence` per session. The dedupe rule is "ignore any frame whose `sequence <= sessionState.lastAppliedSequence`". Live and replay frames go through the same path.
- **Send correlation**: every C→S request mints a v4 UUID `id`, registers a pending-promise keyed by that `id`, and waits for an inbound envelope with matching `inResponseTo`. A correlated `error` envelope rejects the promise with the wire error code. Unmatched inbound envelopes (every unsolicited server-emit) flow through dispatch without resolving any promise.
- **Timeout**: pending requests time out after 10s (default — overridable per-call). The pending entry is then removed and the promise rejects with a `timeout` error code.
- **Malformed-envelope handling**: an inbound frame that fails `parseWsEnvelopeJson` is logged (warn) and dropped; the connection stays open (the server's `malformed-envelope` `error` envelope path is for server-side parse failures — on the client we never see one).
- **Error-on-the-wire**: an unsolicited `error` envelope (no `inResponseTo`) is dispatched to the store; the connection stays open.
- **Zustand integration**: a fourth store slice `useWsStore` joins `useCaptureStore` / `useSelectionStore` / `useUiStore` under `apps/moderator/src/stores/`. The barrel `stores/index.ts` re-exports it. The slice's shape:
  - `connectionStatus: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'`.
  - `connectionId: string | undefined` — populated from the `hello` payload.
  - `subscriptions: Set<string>` — sessionIds the consumer asked for (re-applied on reconnect).
  - `sessionState: Record<sessionId, { lastAppliedSequence: number; events: Event[]; pendingProposals: ProposalStatusPayload[]; lastDiagnostic?: DiagnosticPayload }>` — server-state per session.
  - `lastError: ErrorPayload | undefined` — last unsolicited error envelope received.
- **React seam**: a `useWsClient()` hook returns the singleton client + the slice's reactive state. A provider component (`WsClientProvider`) mounts the client when `auth.status === 'authenticated'` and tears it down on logout. The provider is the only place that owns the client lifecycle.
- **No global mutable singleton**: the client instance is held by the provider via `useRef`; React state owns its lifecycle. Tests construct fresh clients via the same constructor.
- **Test coverage**: Vitest smoke tests against a mock `WebSocket` (per ADR 0022 — no probes, every behavior is a committed test). Cover open/send/receive, correlation, dedupe, reconnection-with-catch-up, malformed-frame drop, and the React `WsClientProvider`'s lifecycle. Defer Playwright end-to-end to the per-flow tasks downstream.
- **No new runtime dep**: the client uses the browser-native `WebSocket` and `crypto.randomUUID()` only.
- **No localStorage / sessionStorage**: in-memory state only (consistent with `mod_state_management`'s persistence policy + the cookie-only-auth rule).

## Acceptance criteria

- `apps/moderator/src/ws/client.ts` (or co-located module) exists and:
  - exposes `createWsClient({ url, onEnvelope?, onStatusChange?, randomId?, now?, makeSocket? })` returning `{ status, send, subscribe, unsubscribe, close }` (or equivalent surface).
  - drives reconnection with exponential backoff capped at 30s.
  - resumes subscriptions + issues catch-up on each successful reconnect.
- `apps/moderator/src/ws/wsStore.ts` (or co-located) exists and:
  - publishes `useWsStore` Zustand slice with the shape above.
  - is exported from the existing `apps/moderator/src/stores/index.ts` barrel.
- `apps/moderator/src/ws/WsClientProvider.tsx` (or equivalent) mounts the client when authenticated; tears it down on logout or unmount.
- Vitest tests under `apps/moderator/src/ws/*.test.ts(x)` cover the listed behaviors (mock WebSocket).
- `pnpm install` clean; `pnpm run check` green; `pnpm run test:smoke` green (test count delta matches the new tests); `pnpm -F @a-conversa/moderator build` green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Integration pattern: hook + provider, NOT a pure store-slice singleton.** The hook + provider pair gives React control over the client lifecycle (mount when auth resolves, unmount on logout); a global singleton would leak across tests + complicate hot-reload. The provider holds the client in a `useRef`; the store slice holds the *state* the client dispatches into. Tests can instantiate the client directly.
- **One client, one connection.** The server is the per-session fan-out point; the client opens one WS and subscribes to N sessions through it. A future cross-tab consolidation (SharedWorker) is out of scope; today the surface is one-WS-per-tab.
- **Dedupe by `event.sequence`, scoped per `sessionId`.** Live and replay frames flow through the same reducer. The contract is "ignore any frame whose `sequence <= sessionState.lastAppliedSequence`."
- **Catch-up is automatic.** On every successful reconnect (every fresh `hello`), the client iterates `wsStore.subscriptions` and issues `subscribe` then `catch-up` for each. The consumer never has to do this manually.
- **Correlation table is per-client.** Pending requests are keyed by the envelope `id`; a `Map<string, { resolve, reject, timer }>` lives on the client instance. Requests time out after 10s by default; the client config accepts an override for tests.
- **No envelope re-implementation.** `parseWsEnvelopeJson` + `serializeWsEnvelope` are imported from `@a-conversa/shared-types`. The client's send path serializes via the shared helper (re-validates on write); the receive path parses via the shared helper.
- **Backoff schedule: 250ms × 2^n capped at 30s.** Resets on any received `hello`. Suppressed on explicit `close()`.
- **No retry of in-flight requests on reconnect.** A pending request whose ack never arrives times out per the per-call timeout. The consumer reads the timeout and re-issues if appropriate; auto-resending writes across a reconnect is dangerous (the server could have applied the first attempt and the resume could double-apply). Read-only ops (catch-up, snapshot) are safe to re-issue but the consumer's reducer dedupes on `sequence` anyway.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

Landed:

- `apps/moderator/src/ws/client.ts` — `createWsClient` factory + `WsClient`
  interface. Drives the full lifecycle: socket open/close, exponential
  backoff (250ms × 2^n capped at 30s, reset on every `hello`), per-request
  correlation via `Map<id, PendingRequest>`, typed `send<T>(type, payload)`
  serialized through `serializeWsEnvelope` from `@a-conversa/shared-types`,
  10s default per-request timeout (overridable), `WsRequestError` /
  `WsRequestTimeoutError` reject shapes, `trackSession` / `untrackSession`
  for resume-aware subscription, and hello-driven auto-resume that issues
  `subscribe` + `catch-up` for every tracked session on every successful
  reconnect.
- `apps/moderator/src/ws/wsStore.ts` — `useWsStore` Zustand slice owning
  the server-state surface (connection status, connectionId, subscription
  resume list, per-session `lastAppliedSequence` / event log / pending
  proposal map / last diagnostic, last unsolicited error). Dedupe-by-
  sequence enforced in `applyEvent`.
- `apps/moderator/src/ws/WsClientProvider.tsx` — React provider + hook.
  Holds the client in a `useRef`; opens on `auth.status === 'authenticated'`
  and tears down on unmount (resetting the store).
- `apps/moderator/src/ws/index.ts` — barrel for the WS surface.
- `apps/moderator/src/stores/index.ts` — extended to re-export
  `useWsStore` so the stores barrel stays the one-stop import surface
  for moderator-side Zustand stores.
- Inbound parse uses `parseWsEnvelopeJson` from `@a-conversa/shared-types`
  verbatim; no envelope schema is re-implemented in moderator code.

Smoke tests (Vitest, ADR 0022):

- `apps/moderator/src/ws/client.test.ts` — 21 tests against a `FakeSocket`
  mock + injected scheduler: connect + hello, send correlation +
  WsRequestError + WsRequestTimeoutError + not-open rejection, store-side
  dispatch of `event-applied` (with dedupe), `snapshot-state`,
  `proposal-status`, `diagnostic`, unsolicited `error`, malformed-frame
  drop, onEnvelope handler invocation, reconnect scheduling + suppression
  on explicit close, resume-on-reconnect subscribe + catch-up, backoff
  reset on hello, backoff escalation on successive failures, and
  trackSession idempotence.
- `apps/moderator/src/ws/wsStore.test.ts` — 5 tests pinning the slice's
  reducer contract (initial state, idempotent trackSubscription, dedup-
  by-sequence, snapshot-monotonic high-water, reset).
- `apps/moderator/src/ws/WsClientProvider.test.tsx` — 3 tests for the
  React provider: opens injected client on auth transition, closes +
  resets store on unmount, `useWsClient` throws outside the provider.

Verification:

- `pnpm install` clean.
- `pnpm run check` green (lint + prettier + typecheck + tests typecheck).
- `pnpm run test:smoke` total: 1322 → 1351 (+29 new).
- `pnpm -F @a-conversa/moderator build` green; Vite output 281.91 kB
  pre-gzip / 90.53 kB gzipped.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after
  `complete 100`.

Downstream consumers plug in by:

- Calling `useWsClient()` inside a `<WsClientProvider auth={...}>` subtree
  to send envelopes (`client.send('propose', ...)` etc.) or to call
  `trackSession(sessionId)`.
- Reading `useWsStore(...)` for the dispatched server-state surface
  (events per session, proposal status, diagnostics, connection status).

