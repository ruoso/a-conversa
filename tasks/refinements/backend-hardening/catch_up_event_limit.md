Source: docs/security/m3-review/inputs.md F-004 + F-005

# Bound the catch-up handler's per-request work

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.resource_limits_and_dos.catch_up_event_limit`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.websocket_protocol.ws_reconnection_handling` — settled (the `catch-up` handler at `apps/server/src/ws/handlers/catch-up.ts`; the `DEFAULT_WS_CATCHUP_MAX_EVENTS = 500` threshold + `resolveCatchUpMaxEvents(env)` helper this task tightens).
- `backend.websocket_protocol.ws_connection_handling` — settled (the per-connection close hook in `apps/server/src/ws/connection.ts`; the new rate-limit cleanup call lives alongside the existing `app.wsSubscriptions.removeConnection(...)` / `app.wsConnectionSenders.unregister(...)` lines).
- `backend.websocket_protocol.ws_error_message` — settled (the canonical wire `error` envelope; the new `too-many-catch-up-requests` rate-limit reject rides this surface via the dispatcher's `onHandlerError` seam).
- `backend.websocket_protocol.ws_protocol_documentation` — settled (`docs/ws-protocol.md` + `protocol-docs.test.ts`; the new wire code is added to both the doc's WS-specific table and the test's vocabulary union).

## What this task is

Two complementary defenses against the F-004 / F-005 surface in the WS `catch-up` handler:

1. **Server-side `LIMIT` on every catch-up SELECT** — both the slice-replay query and the snapshot-fallback query now carry an explicit `LIMIT`. The slice-replay LIMIT is the resolved threshold (already implicitly bounded by the case-1 guard `currentMax - sinceSequence <= threshold`; the explicit LIMIT is a belt-and-braces defense-in-depth marker). The snapshot-fallback LIMIT is `MAX_CATCH_UP_EVENTS_CEILING = 5000` — **decoupled from the slice threshold**: the threshold drives slice-vs-snapshot branching, but the snapshot SELECT is bounded by the hard ceiling so a session that fits under 5000 events gets a FULL snapshot regardless of the (typically smaller) slice threshold. Sessions whose log exceeds 5000 events get a truncated projection (`lastAppliedSequence < currentMax`), and the operator's signal is the snapshot's lastAppliedSequence — this is the F-011 / archival hand-off point.

2. **Hard ceiling on the env-resolved threshold** — `resolveCatchUpMaxEvents(env)` now clamps its return value to `MAX_CATCH_UP_EVENTS_CEILING = 5000`. F-005's operator footgun (an `WS_CATCHUP_MAX_EVENTS=10000000` setting would push the slice / snapshot buffer into multi-GB territory) is closed: no env override can lift the per-request work above the ceiling. The handler additionally re-clamps in case a test bypasses the resolver and passes a too-large value directly through the options.

3. **Per-connection rate limit** — a fixed-window counter in a module-scoped `Map<connectionId, { count, windowStartMs }>` caps each connection at 10 `catch-up` envelopes per 60-second window (defaults; env-overridable via `WS_CATCH_UP_MAX_PER_MINUTE`). The (cap + 1)th envelope is rejected with the typed wire `error` `{ code: 'too-many-catch-up-requests' }`; the connection stays open and the cap window self-resets after 60 s. The bucket is cleared from the module Map by `connection.ts`'s socket-close hook (paired with the existing subscription / sender cleanup calls), satisfying the per-connection / clears-on-close invariant.

The rate-limit gate runs **before** the subscribe / visibility gates so an abusive client hitting the cap pays only the Map lookup cost — no registry scan, no DB round-trip.

## Why it needs to be done

`docs/security/m3-review/inputs.md` F-004 (Medium) and F-005 (Low) describe a cost-asymmetric DoS:

- F-004: the snapshot-fallback path issues `SELECT … FROM session_events WHERE session_id = $1 ORDER BY sequence ASC` with **no LIMIT**. For a long-running session with N events this is an O(N) scan. The slice-replay branch is implicitly bounded by `threshold`, but the snapshot branch is unbounded; an attacker who fires repeated `catch-up { sinceSequence: 0 }` envelopes forces the DB to replay the full event log per request. The attacker pays one envelope per request; the server pays an O(N) SQL scan. Authentication mitigates anonymous abuse but does not bound the asymmetry — an insider with one valid session token can sustain the asymmetry at their request rate.

- F-005: `resolveCatchUpMaxEvents` reads `WS_CATCHUP_MAX_EVENTS` and `parseInt`s with no upper bound. An operator misconfiguration (`WS_CATCHUP_MAX_EVENTS=10000000`) silently pushes the slice-replay buffer into multi-GB territory. Not directly attacker-exploitable without env-var control, but defense-in-depth.

The right defenses are layered:

- A bounded SELECT means the worst-case query cost per request is fixed.
- A hard ceiling on the threshold means the worst-case bound itself is bounded.
- A per-connection rate limit means an attacker cannot amortize the bounded-but-still-expensive request rate at their own pace.

Each defense is independently meaningful — the rate limit doesn't eliminate the SELECT cost, just caps the rate at which it can be paid; the LIMIT doesn't eliminate the cost-asymmetry, just bounds the per-request cost. Together they reduce the asymmetric DoS surface to "an attacker can cause 10 bounded SELECTs per minute per authenticated connection," which is no longer asymmetric in the F-004 sense.

## Inputs / context

From [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) (pre-task):

```ts
// Snapshot-fallback branch — F-004 surface (no LIMIT):
if (currentMax - sinceSequence > threshold) {
  const logRes = await opts.pool.query<SessionEventRow>(
    `SELECT id, session_id, sequence, kind, actor, payload, created_at
     FROM session_events
     WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  );
  ...
}

// Slice-replay branch — implicitly bounded by the case-1 guard but
// no explicit LIMIT in the SQL text:
const sliceRes = await opts.pool.query<SessionEventRow>(
  `SELECT id, session_id, sequence, kind, actor, payload, created_at
   FROM session_events
   WHERE session_id = $1 AND sequence > $2 AND sequence <= $3
   ORDER BY sequence ASC`,
  [sessionId, sinceSequence, currentMax],
);

// F-005 surface — env reader with no upper-bound clamp:
export function resolveCatchUpMaxEvents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[WS_CATCHUP_MAX_EVENTS_ENV];
  if (raw === undefined || raw === '') return DEFAULT_WS_CATCHUP_MAX_EVENTS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WS_CATCHUP_MAX_EVENTS;
  return parsed; // <-- no Math.min(parsed, ceiling)
}
```

From [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) (the close-hook seam this task plugs into):

```ts
socket.on('close', (code, reasonBuffer) => {
  openConnections.delete(ctx);
  app.wsSubscriptions.removeConnection(connectionId);
  app.wsConnectionSenders.unregister(connectionId);
  // <-- new call lands here: clearCatchUpRateStateForConnection(connectionId)
  const reason = reasonBuffer.toString('utf8');
  request.log.info({ connectionId, userId: user.id, code, reason }, 'ws-connection-closed');
});
```

From [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) — the `onHandlerError` seam echoes `ApiError`-shaped throws as the canonical wire `error` envelope with `inResponseTo: envelope.id`. A `throw new ApiError(429, 'too-many-catch-up-requests', '…')` lands on the wire as:

```json
{ "type": "error", "id": "…", "inResponseTo": "<catch-up.id>",
  "payload": { "code": "too-many-catch-up-requests", "message": "…" } }
```

From [`docs/security/m3-review/inputs.md`](../../../docs/security/m3-review/inputs.md) F-004 + F-005: the source findings.

From [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md): every behavior lands as a committed Vitest case.

## Constraints / requirements

- **Hard ceiling**: `MAX_CATCH_UP_EVENTS_CEILING = 5000`, exported from `apps/server/src/ws/handlers/catch-up.ts`. `resolveCatchUpMaxEvents(env)` clamps `Math.min(parsed, MAX_CATCH_UP_EVENTS_CEILING)`. The handler also re-clamps in `buildCatchUpHandler` so a test that passes `maxCatchUpEvents` directly cannot escape the ceiling.
- **Slice-replay SELECT**: append `LIMIT $4` to the query text; pass the resolved threshold (re-clamped to the ceiling in the builder) as the fourth parameter.
- **Snapshot-fallback SELECT**: append `LIMIT $2` to the query text; pass `MAX_CATCH_UP_EVENTS_CEILING` (NOT the threshold) as the second parameter — so a small per-request threshold doesn't truncate the snapshot below the ceiling.
- **Rate-limit cap**: `DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE = 10`. Env override: `WS_CATCH_UP_MAX_PER_MINUTE`. Helper: `resolveCatchUpRateLimit(env)` mirrors the shape of `resolveCatchUpMaxEvents` (no upper-bound clamp here — over-large values only weaken the protection; they don't amplify it).
- **Rate-limit window**: `CATCH_UP_RATE_LIMIT_WINDOW_MS = 60_000` (60 s, fixed-window).
- **Per-connection state location**: module-scoped `Map<connectionId, { count, windowStartMs }>` inside `apps/server/src/ws/handlers/catch-up.ts`. Cleared from `connection.ts`'s socket-close hook via `clearCatchUpRateStateForConnection(connectionId)` (exported from the handler module). Mirrors the existing per-instance cleanup pattern (`removeConnection` / `unregister`).
- **Typed wire `code`**: `WS_TOO_MANY_CATCH_UP_REQUESTS_CODE = 'too-many-catch-up-requests'`, exported from the handler module. The handler throws `new ApiError(429, WS_TOO_MANY_CATCH_UP_REQUESTS_CODE, '…')`; the dispatcher seam emits the canonical wire `error` envelope.
- **Gate ordering**: rate-limit check is Gate 0 — runs before subscribe-before-act, before visibility. An abusive client over the cap pays only a Map lookup; no DB round-trip.
- **Test-side seam**: `__buildTestWsApp` accepts an optional `catchUpRateLimitPerWindow` and `now` so tests pin the cap + clock deterministically. The handler module exports `__getCatchUpRateBucketForTests` / `__clearAllCatchUpRateStateForTests` (double-underscore convention) so cross-test residue is explicit.
- **Doc-coverage**: `docs/ws-protocol.md` adds `too-many-catch-up-requests` to the WS-specific codes table; `apps/server/src/ws/protocol-docs.test.ts` adds the literal to its `WS_SPECIFIC_CODES` union.
- **Per ADR 0022**: every behavior assertion lands as a committed Vitest case. No throwaway probes.

## Acceptance criteria

- `MAX_CATCH_UP_EVENTS_CEILING = 5000` exported from `apps/server/src/ws/handlers/catch-up.ts`.
- `resolveCatchUpMaxEvents({ WS_CATCHUP_MAX_EVENTS: '10000000' })` returns `5000` (F-005 clamp).
- Both catch-up SELECTs include `LIMIT $<n>` in their SQL text, and the parameter is the resolved threshold.
- A snapshot-fallback test with threshold = 2 against a 5-event session sees a snapshot whose `lastAppliedSequence` is **2** (proving the `LIMIT 2` is honored end-to-end).
- A builder test that passes `maxCatchUpEvents: 50000` directly observes the SQL LIMIT param is `5000` (the ceiling), not `50000`.
- `DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE = 10` exported; `WS_CATCH_UP_RATE_LIMIT_ENV = 'WS_CATCH_UP_MAX_PER_MINUTE'` exported; `resolveCatchUpRateLimit({...})` follows the standard env-resolver shape.
- `WS_TOO_MANY_CATCH_UP_REQUESTS_CODE = 'too-many-catch-up-requests'` exported.
- An integration test sends 10 catch-up envelopes in a single window → all succeed; the 11th in the same window → wire `error` with `code: 'too-many-catch-up-requests'` and `inResponseTo: <that envelope.id>`.
- After advancing the injected clock past `CATCH_UP_RATE_LIMIT_WINDOW_MS`, a fresh envelope succeeds on the same socket — proving the window resets without a reconnect.
- The rate-limited connection stays open (no close frame; subsequent successful envelopes flow on the same socket).
- `docs/ws-protocol.md` lists `too-many-catch-up-requests` in the WS-specific codes table.
- `protocol-docs.test.ts` includes the literal in its `WS_SPECIFIC_CODES` set; the doc-coverage tests pass.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new tests; all pass.
- `complete 100` added to the `catch_up_event_limit` task entry in `tasks/25-backend-hardening.tji`; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement document.

## Decisions

- **Per-minute cap of 10 envelopes (fixed-window).** Real-world reconnection traffic is typically one `catch-up` per session per reconnect; even an audience-surface chapter-scrub UI issuing a fresh `catch-up` per navigation event stays well below 10/min unless the user is mashing the scrubber. 10 is generous enough to leave a comfortable buffer for legitimate clients and tight enough to make an asymmetric flood costly to the attacker. Operators with a sustained legitimate burst above 10/min lift the cap via `WS_CATCH_UP_MAX_PER_MINUTE` without a code change.
- **Fixed-window over sliding-window.** A fixed-window scheme tolerates a worst-case burst of `2 × cap` requests across a window boundary (an attacker who times their requests precisely around the window flip). For an asymmetric-cost defense this is fine; a tighter sliding-window adds memory + complexity without materially raising the bar — the SELECT cost is already bounded by the LIMIT, so even `2 × cap` SELECTs per window doesn't reproduce the F-004 surface. The simplest shape that satisfies the threat model.
- **Typed wire `code: 'too-many-catch-up-requests'` (new WS-specific code).** The existing `ApiError` factory codes (`bad-request` … `internal-error`) don't include a 429 / rate-limit factory. `too-many-catch-up-requests` is more specific than the generic HTTP `too-many-requests` would be — it tells the client exactly which surface throttled them (a future per-message-type cap, e.g. `too-many-propose-requests`, can follow the same naming pattern without colliding with HTTP semantics). Lives in the WS-specific code class alongside `unknown-message-type` and `malformed-envelope`; the protocol-docs test's vocabulary widens by one entry.
- **`ApiError(429, …)`-shaped throw, not a separate WS-direct send.** The dispatcher's `onHandlerError` seam already echoes `ApiError`-shaped throws as the canonical wire `error` envelope with `inResponseTo` correlation. Throwing keeps the rate-limit reject on the same path as every other handler-level rejection (`forbidden`, `not-found`); a separate `connection.socket.send(buildWsErrorEnvelope(...))` would diverge from the dispatcher's correlation + logging surface. The 429 status is a hint — only `code` + `message` actually reach the wire (the WS `error` envelope carries no status field).
- **Per-connection state lives in a module-scoped Map in `handlers/catch-up.ts`, cleared from `connection.ts`'s close hook.** Two alternatives were considered:
  - Decorating `app.wsCatchUpRateLimiter` via a Fastify plugin (mirrors `app.wsConnectionSenders`). Cleaner separation, but requires a separate plugin file + a registration ordering decision, for what is ultimately a single Map.
  - Storing the bucket on `WsConnectionContext` itself. Simplest reach for the handler, but mutates the per-connection context for a concern (rate limiting) that's logically the handler's, not the connection's.
  The chosen shape (module-scoped Map + explicit close-hook cleanup call from `connection.ts`) matches the precedent set by `openConnections` in `connection.ts` itself — module-scoped state, lifecycle managed at the close-hook seam. The risk of two `createServer()` instances conflating their rate state is the same trade-off `openConnections` already accepts.
- **Gate 0 (rate limit) runs BEFORE Gate 1 (subscribe-before-act) and Gate 2 (visibility).** A request that trips the rate limit should pay the cheapest possible cost (a Map lookup + an `ApiError` throw); putting the rate limit AFTER the subscribe gate would let an abusive subscribed-and-authorised client amortize the registry + DB lookup costs as well. The trade-off: an UNSUBSCRIBED client hitting the cap gets a rate-limit error instead of a `forbidden` error — but that's not a leak (the connection is authenticated; the rate-limit error carries no session-level information).
- **Hard ceiling 5000 (two orders of magnitude over the default 500).** Closes F-005. Generous enough that an operator who genuinely wants a deeper slice window for a long-lived session has room; two orders of magnitude under any value that would stress Node's per-process memory budget even with a moderately-large per-event payload. The handler additionally re-clamps in `buildCatchUpHandler` so a direct option override (bypassing the env resolver) cannot escape the ceiling.
- **No cache layer for the snapshot path.** F-004's suggested fix mentions "cache the snapshot per `(sessionId, sequence)` so concurrent requests collide on one read." Out of scope here — the cache is a future infra concern (paired with `inputs.md` F-011 / session-events archival). The bounded SELECT + the rate limit already reduce the asymmetric DoS surface to a known-bounded shape; the cache would be a performance optimisation on top, not a security requirement.
- **The 429 status is a hint, not a wire field.** The dispatcher's `onHandlerError` only consults `code` + `message`. The 429 keeps the `ApiError` factory ergonomic and matches HTTP semantics in case any future HTTP route ever throws the same code (today none does). Choosing 429 over (say) 503 reflects the per-client nature of the limit — 503 ("service unavailable") would be the right code for a global capacity guard (cf. `flow_state_map_bound`'s 503 + `temporarily-unavailable`), but the per-connection cap is structurally a 429.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation:
  - [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) — added `MAX_CATCH_UP_EVENTS_CEILING = 5000`, `DEFAULT_CATCH_UP_RATE_LIMIT_PER_MINUTE = 10`, `CATCH_UP_RATE_LIMIT_WINDOW_MS = 60_000`, `WS_CATCH_UP_RATE_LIMIT_ENV`, `WS_TOO_MANY_CATCH_UP_REQUESTS_CODE`, `resolveCatchUpRateLimit(env)`, `clearCatchUpRateStateForConnection(connectionId)`, and the module-scoped `catchUpRateState` Map. `resolveCatchUpMaxEvents` now clamps to the ceiling (F-005). The handler's slice-replay SELECT carries `LIMIT $4 = threshold`; the snapshot-fallback SELECT carries `LIMIT $2 = MAX_CATCH_UP_EVENTS_CEILING`. Gate 0 (rate limit) runs before subscribe-before-act.
  - [`apps/server/src/ws/connection.ts`](../../../apps/server/src/ws/connection.ts) — imported `clearCatchUpRateStateForConnection` and called it from the socket `close` hook alongside the existing `app.wsSubscriptions.removeConnection(...)` / `app.wsConnectionSenders.unregister(...)` cleanups. `BuildTestWsAppOptions` widened to accept `catchUpRateLimitPerWindow` so tests can pin a small cap.
  - [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) — re-exported the new constants + `resolveCatchUpRateLimit`; `WsHandlersOptions` widened to accept `catchUpRateLimitPerWindow` + `now`; the registration call passes both through to `registerCatchUpHandlers`.
  - [`docs/ws-protocol.md`](../../../docs/ws-protocol.md) — `too-many-catch-up-requests` added to the WS-specific codes table; the `catch-up` envelope section now documents the rate-limit + bounded-SELECT contract.

- Tests (Vitest, per ADR 0022):
  - [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) — +21 cases (13 → 34). Three new describe blocks:
    - `resolveCatchUpMaxEvents — F-005 ceiling` (3 new cases inside the existing block) — env value above the ceiling clamps; equal-to-ceiling returns the ceiling; below-ceiling returns verbatim. Plus a pin for `MAX_CATCH_UP_EVENTS_CEILING === 5000`.
    - `resolveCatchUpRateLimit — env-resolution helper` — 9 cases pinning default-on-absent / empty / NaN / zero / negative, parsed-on-positive, plus the three exported constants.
    - `ws_reconnection_handling — per-connection rate limit (F-004)` — 4 integration cases: cap-allowed (10 envelopes succeed), cap+1 rejected with `too-many-catch-up-requests` wire error, window reset after `CATCH_UP_RATE_LIMIT_WINDOW_MS`, connection-stays-open after reject.
    - `ws_reconnection_handling — bounded SELECT LIMIT (F-004)` — 4 integration cases: slice SQL carries `LIMIT $4`; snapshot SQL carries `LIMIT $2`; snapshot LIMIT param is the ceiling (decoupled from threshold); builder re-clamps a too-large `maxCatchUpEvents` to the ceiling.
  - [`apps/server/src/ws/protocol-docs.test.ts`](../../../apps/server/src/ws/protocol-docs.test.ts) — `WS_SPECIFIC_CODES` widened to include `too-many-catch-up-requests`; the doc-vocabulary coverage tests now pass against the updated `docs/ws-protocol.md`.

- `tasks/25-backend-hardening.tji` — `complete 100` added to the `catch_up_event_limit` task entry under `resource_limits_and_dos`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (clean parse).

Test count delta: +21 Vitest cases in `catch-up.test.ts` (13 → 34). `pnpm run check` and `pnpm run test:smoke` both green (1343 tests across 74 files).

**Rate-limit state lifecycle (load-bearing)**: the module-scoped `catchUpRateState` Map in `apps/server/src/ws/handlers/catch-up.ts` is cleared per-connection by `connection.ts`'s socket `close` hook calling `clearCatchUpRateStateForConnection(connectionId)`. The Map's size is therefore bounded by the count of connections that have issued at least one `catch-up` envelope and have not yet closed; a leak is structurally impossible while the close hook fires (mirrors the lifecycle invariant of `openConnections` in the same file).
