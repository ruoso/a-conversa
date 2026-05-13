# Input validation / injection / info-leak / DoS review

## Severity legend (Critical / High / Medium / Low / Informational)
- **Critical** — likely exploitable, leads to data exposure / RCE / auth bypass.
- **High** — exploitable under realistic conditions, with significant impact.
- **Medium** — narrow attack window OR significant defense-in-depth gap.
- **Low** — small surface, partial mitigations, hardening opportunity.
- **Informational** — no concrete attack, but worth tracking.

## Findings

### F-001 [Medium] — No per-connection subscription cap; one auth'd client can subscribe to unlimited sessions
**Location**: `apps/server/src/ws/subscriptions.ts:82-138` (`WsSubscriptionRegistry.subscribe`); `apps/server/src/ws/handlers/subscribe.ts:68-130` (`buildSubscribeHandler`).
**Description**: `subscribe` only checks visibility (`canSeeSession`) and then unconditionally `registry.subscribe(connectionId, sessionId)`. There is no per-connection ceiling on the size of `byConnection.get(connectionId)`. A logged-in client can subscribe to every public session in the database; each subscribe issues exactly one parameterized `SELECT 1 FROM sessions ...` round-trip but the connection's memory + the per-event broadcast fan-out cost both scale linearly with that set.
**Impact**: A single authenticated client can (a) consume O(N_sessions) memory in the registry, (b) receive a copy of every `event-applied` / `diagnostic` / `proposal-status` envelope for every public session — amplifying any future high-frequency session into per-attacker bandwidth, and (c) DOS the broadcast surface by holding open ~50 connections each subscribed to thousands of sessions. No rate-limit / quota is in place. Authentication mitigates anonymous abuse but not insider abuse.
**Suggested fix**: Cap `byConnection[connectionId].size` at a small constant (e.g. 32) inside `subscribe(...)`; reject excess subscribes with an `error` envelope (`code: 'subscription-limit'`). Also consider a connection cap on `openConnections` (`apps/server/src/ws/connection.ts:460`) per user-id.
**Confidence**: Confirmed.

### F-002 [Medium] — No body size limit configured on Fastify or @fastify/websocket; relies on library defaults
**Location**: `apps/server/src/server.ts:99-117` (Fastify factory has no `bodyLimit`); `apps/server/src/ws/connection.ts:723-740` (`app.register(fastifyWebsocket, { preClose, errorHandler })` — no `maxPayload`).
**Description**: `createServer()` does not set `bodyLimit`; Fastify's documented default is 1 MiB. `@fastify/websocket` is registered without `options.maxPayload`; the upstream `ws` library defaults to 100 MiB if unset, and `@fastify/websocket` does not force a smaller default. The receive loop at `apps/server/src/ws/connection.ts:338-392` calls `parseWsEnvelopeJson(text)` on every frame, including a `JSON.parse` over user-supplied bytes.
**Impact**: A single client can push a 100 MiB JSON frame; Node parses it into memory (peak ~3-5× the encoded size), the dispatcher rejects it as malformed-envelope, and the server still pays the parse cost. Repeated frames hold per-connection memory until GC. Combined with no max-connections cap, this is a credible memory-pressure DoS surface.
**Suggested fix**: Set `bodyLimit: 64 * 1024` (or similar) on Fastify; pass `options: { maxPayload: 64 * 1024 }` to `app.register(fastifyWebsocket, ...)`. Add an explicit default in `dispatcher` / `connection` rather than trusting upstream defaults.
**Confidence**: Confirmed (defaults verified against upstream library docs).

### F-003 [Medium] — No per-payload size cap on user-authored text in proposal / annotation events
**Location**: `packages/shared-types/src/events/proposals.ts:123,132,153,217,247,264` (`z.string().min(1)` with no max); `packages/shared-types/src/events.ts:247,280` (node wording / annotation content); `packages/shared-types/src/events.ts:195` (`screen_name: z.string()` — no max either).
**Description**: Every user-authored text field in the methodology vocabulary (`new_wording`, `wording`, `content`, `new_content`) is `z.string().min(1)` with no upper bound. The frame-level `bodyLimit` (F-002) is the only ceiling. A single `propose` envelope can carry an ~MB wording string that gets (1) JSON-parsed, (2) re-validated, (3) stored verbatim in `session_events.payload`, (4) re-validated on read, (5) projected, and (6) re-broadcast in `event-applied` to every subscriber.
**Impact**: A debater can store unbounded text in the per-session event log (no row-count or row-size cap on `session_events` — see F-011) and force every other subscriber to receive the inflated payload. Storage exhaustion + bandwidth amplification.
**Suggested fix**: Add `.max(8192)` (or similar, per-field) on every user-authored `z.string()` field in `shared-types/src/events/*.ts`. Mirror the API-layer ceiling already enforced on `sessions.topic` (`maxLength: 256` in `createSessionBodySchema`).
**Confidence**: Confirmed.

### F-004 [Medium] — Catch-up handler can issue an unbounded `SELECT ... ORDER BY sequence` over the full session log per request
**Location**: `apps/server/src/ws/handlers/catch-up.ts:270-294` (snapshot-fallback branch) and `:296-330` (slice-replay branch).
**Description**: When `currentMax - sinceSequence > threshold` (default 500), the handler runs `SELECT ... FROM session_events WHERE session_id = $1 ORDER BY sequence ASC` — **no LIMIT**. For a long-running session with N events this is an O(N) scan. The slice-replay branch is bounded by `threshold`, but the snapshot branch is unbounded; a client can force this by sending `sinceSequence = 0`. Worse, an attacker can fire many `catch-up` envelopes in sequence (only gated by "is subscribed"); each one re-issues the same heavy query.
**Impact**: A malicious authenticated client subscribed to a long session can issue rapid `catch-up { sinceSequence: 0 }` envelopes and force the DB to replay the full event log on every request. CPU + IO pressure on Postgres scales with attacker request rate. Compounded by no rate-limit on inbound WS frames.
**Suggested fix**: (a) Rate-limit `catch-up` per-connection (e.g. one in flight, second is rejected). (b) Hard-cap the snapshot branch's SELECT with a `LIMIT` matching the projection's defended depth. (c) Cache the snapshot per `(sessionId, sequence)` so concurrent requests collide on one read.
**Confidence**: Confirmed.

### F-005 [Low] — Snapshot-fallback threshold sourced from env without a hard ceiling
**Location**: `apps/server/src/ws/handlers/catch-up.ts:139-149` (`resolveCatchUpMaxEvents`).
**Description**: Reads `WS_CATCHUP_MAX_EVENTS` from env and `parseInt`s it. Any positive integer is accepted — there is no upper bound. An operator misconfiguration of `WS_CATCHUP_MAX_EVENTS=10000000` would push the slice-replay branch's intermediate buffer into multi-GB territory.
**Impact**: Operator footgun; not directly attacker-exploitable without env-var control. Defense-in-depth gap.
**Suggested fix**: Clamp the resolved value to a sane ceiling (e.g. `min(parsed, 5000)`).
**Confidence**: Confirmed.

### F-006 [Low] — `getDefaultFlowStateStore`'s `setInterval` sweeper is the only GC; no upper bound on map growth between sweeps
**Location**: `apps/server/src/auth/flow-state.ts:190-203` (`getDefaultFlowStateStore`).
**Description**: `defaultSweepTimer` runs every 60 s and removes expired entries; `take(state)` lazily removes on first hit. But there's no cap on `map.size` between sweeps. An unauthenticated attacker can hit `GET /auth/login` repeatedly — each call generates a fresh `state`, allocates a `FlowStateEntry` (`nonce`, `codeVerifier`, ~hundreds of bytes), and inserts it without ever following through to `/auth/callback`. At 60-second sweep intervals + 5-minute TTL, the worst-case map size is `request_rate × 5 minutes` before the sweeper trims expired entries.
**Impact**: Pre-auth memory-growth DoS surface — a hostile client can sustain thousands of concurrent `/auth/login` calls (each starts a flow). Each entry is small; effect is limited but unbounded.
**Suggested fix**: Cap `map.size` in `createFlowStateStore`'s `put(...)` (e.g. 10_000); reject excess or evict oldest. Combined with rate-limiting `/auth/login` on the deployment edge.
**Confidence**: Confirmed.

### F-007 [Low] — `pino-pretty` dev logging may include unredacted error objects from DB driver
**Location**: `apps/server/src/error-handler.ts:218-226` (catch-all 5xx): `request.log.error({ err }, 'unhandled error in route handler');`
**Description**: The 5xx fallback path emits the full `err` object (stack, message, possibly DB driver fields like SQLSTATE, query text echo in `pg`'s `DatabaseError`) to the server log. The response body to the client is sanitized to the generic `'internal-error'` envelope — that part is correct. But in dev (`pino-pretty`) and structured prod (`pino` default JSON), `{ err }` is serialized in full. The `logger.ts` comment claims "Pino's standard request serializer is replaced (see below) so headers are dropped entirely" — but there is no `serializers` or `redact` config actually wired (`logger.ts:147-189` returns either `false`, `{ level }`, or `{ level, transport: ... }`).
**Impact**: Server logs can leak DB column names / query text / file paths to anyone with log access. Not directly client-visible (the response body is clean), so this is a defense-in-depth concern only.
**Suggested fix**: Add a `redact: { paths: [...], remove: true }` config to `createLoggerOptions`'s prod branch, redacting known-sensitive paths. Or use `pino-std-serializers`'s `err` serializer with explicit allowlist.
**Confidence**: Confirmed.

### F-008 [Low] — Defensive 500s in route handlers echo internal sentinel messages to the client
**Location**: `apps/server/src/sessions/routes.ts:1118-1123, 1154, 1226, 1693-1697, 1899, 2120, 2235-2238, 2342, 2491-2497`; `apps/server/src/ws/handlers/catch-up.ts:192` (`throw new Error('ws-catch-up: connection.user is undefined — auth gate bypassed')`).
**Description**: Several "unreachable" defensive 500s are thrown as `ApiError(500, 'internal-error', '<descriptive>')`. Per `error-handler.ts`, `ApiError`-branded throws have their `message` echoed in the response body. Likewise the dispatcher's `onHandlerError` seam echoes `ApiError.code` + `ApiError.message` over WS. Strings like `'auth middleware did not populate request.authUser'`, `'session insert returned no row'`, `'session_participants UPDATE returned no row or null left_at'` would leak operational/internal-state details if any of these branches ever fired.
**Impact**: Modest info leak — would tell an attacker which internal wiring just broke. Not currently triggerable, but the "defensive but actually reachable under cascading failure" class of bug is a known footgun.
**Suggested fix**: Change defensive paths to throw a plain `Error` (not `ApiError`); the catch-all then renders the generic literal. Keep the descriptive text in the log line only.
**Confidence**: Confirmed.

### F-009 [Low] — `unknown-message-type` WS error echoes the client-supplied `type` value verbatim in the wire message
**Location**: `apps/server/src/ws/dispatcher.ts:164-170` — `sendWsError(..., { message: \`no handler registered for message type '${envelope.type}'\`, ... })`.
**Description**: The envelope parser already constrains `type` to the closed `wsMessageTypes` enum, so the echo is bounded to a small fixed set. But the pattern of echoing client input into an outbound message is fragile — if `wsMessageTypeSchema` is ever widened (e.g. to a free-form string for forward-compatibility), this becomes a reflected-input vector. Not currently exploitable.
**Impact**: None today (closed enum). Future-proofing concern.
**Suggested fix**: Use a fixed message (`'unknown message type'`); add the rejected `type` to a `details` field rather than the user-facing message string. Or keep as-is and document the dependency on the closed enum.
**Confidence**: Suspected (defensive observation).

### F-010 [Informational] — WS error envelope `subscribed` / ack frames are server-emitted but type discriminator is shared with client→server vocabulary; protocol does not assert directionality at parse time
**Location**: `packages/shared-types/src/ws-envelope.ts:106-141` (`wsMessageTypes`); `apps/server/src/ws/dispatcher.ts:253-270` (`dispatch`).
**Description**: The closed `WsMessageType` enum contains both C→S types (`subscribe`, `propose`, `vote`, `commit`, `mark-meta-disagreement`, `snapshot`, `catch-up`) and S→C types (`hello`, `subscribed`, `unsubscribed`, `proposed`, `voted`, `committed`, `meta-disagreement-marked`, `snapshot-state`, `caught-up`, `event-applied`, `error`, `diagnostic`, `proposal-status`). The dispatcher only invokes handlers registered against `dispatcher.register(type, handler)`, and only C→S handlers are registered (`apps/server/src/ws/handlers/index.ts`). A client sending a `subscribed` ack envelope to the server therefore falls into the `onUnknownType` branch — handled, but the dispatcher still pays for full envelope+payload validation against the `subscribedPayloadSchema`, and the parse path then sends an `error` envelope back. Functionally safe; the asymmetry is that a malicious client can force the server to validate the larger ack payload shapes (UUIDs, ints) as a no-op DoS amplifier.
**Impact**: Negligible per-frame cost; relevant only if combined with the no-rate-limit + no-bodyLimit findings above. Worth noting as an "input asymmetry" the protocol doesn't currently police.
**Suggested fix**: Explicitly partition `wsMessageTypes` into `clientToServer` and `serverToClient` subsets; reject S→C types at parse time with a single `bad-direction` error envelope (cheaper than per-payload schema validation).
**Confidence**: Confirmed.

### F-011 [Informational] — No row-count ceiling on `session_events`; per-session log grows without bound
**Location**: `apps/server/migrations/0010_session_events.sql` (full table); `apps/server/src/sessions/routes.ts` event-append sites.
**Description**: `session_events` has `UNIQUE (session_id, sequence)` but no row-count cap, no partition strategy, no archival. Combined with no user-text size limit (F-003), one session can accumulate arbitrarily large event logs. The catch-up SELECT (F-004) reads them all.
**Impact**: Long-running sessions become a quadratic burden as projection cost scales with log length. Storage growth is unbounded.
**Suggested fix**: Tracked as future infra concern (snapshots / archival). Not a CVE-class finding.
**Confidence**: Confirmed.

### F-012 [Informational] — `flow-state` sweep cadence (60 s) leaves a window for state-confusion timing observation
**Location**: `apps/server/src/auth/flow-state.ts:130-144` (`take()`).
**Description**: `take(state)` first deletes-then-checks-expiry, returning `undefined` for both "unknown state" and "expired state". This collapses two timing branches into one observable path — good. Constant-time concern is minimal.
**Impact**: None.
**Confidence**: Informational only.

### F-013 [Low] — `ILIKE '%<topic>%'` against an unindexed `sessions.topic` column scales poorly under attacker-controlled patterns
**Location**: `apps/server/src/sessions/routes.ts:1418-1426`; `apps/server/migrations/0002_sessions.sql`.
**Description**: The topic filter is parameterized (`params.push(\`%${query.topic}%\`)`) — SQL injection is **not** present. But the surrounding `WHERE topic ILIKE $N` performs a full table scan over `sessions` for every list call with a `topic` filter; there's no GIN/trigram index. Attacker-controlled 256-char patterns force every comparison to the full string. Capped at 256 chars on the API layer (schema `maxLength: 256`), so the per-row cost is bounded; the total cost scales with `|sessions|`.
**Impact**: Low-tier DoS at scale. Not a regression vs. existing behavior; rate-limit + a future trgm index resolves.
**Suggested fix**: Add `CREATE INDEX ... USING gin (topic gin_trgm_ops)` in a future migration if topic search becomes hot.
**Confidence**: Confirmed.

## Coverage notes

- **SQL injection audit**: All `client.query` / `pool.query` calls reviewed across `apps/server/src/sessions/routes.ts`, `apps/server/src/sessions/visibility.ts`, `apps/server/src/sessions/references.ts`, `apps/server/src/ws/handlers/*.ts`, `apps/server/src/auth/routes.ts`. **Every query uses parameterized `$N` placeholders**; the only string-interpolated values into SQL text are (a) the visibility-fragment `$N` slot index in `visibilityWhereFragment(userIdParamIndex)` (`visibility.ts:115-132`; the slot index is integer-validated at the function entry), (b) the join-table / column names in the entity-inclusion dispatch table (`routes.ts:2517-2533`; hard-coded literals selected from a closed `entityKind` enum that's Zod-validated at the route boundary). No user input ever reaches the SQL text. Confidence: confirmed.
- **HTTP body validation**: Every `POST` / `PATCH` / `DELETE` endpoint in `routes.ts` carries a Fastify `schema.body` / `schema.params` / `schema.querystring` JSON Schema with `additionalProperties: false`, `format: 'uuid'`, and enum constraints. No `z.any()` or `passthrough()` slips through. Confidence: confirmed.
- **WS envelope validation**: Two-stage parse in `packages/shared-types/src/ws-envelope.ts:1300-1414` is tight. The outer envelope is `wsEnvelopeSchema` with `payload: z.unknown()`; per-type payload is then validated against `wsMessagePayloadSchemas[type]`. The `payload: z.unknown()` decisions are deliberate and contained (`snapshot-state`'s `projection`, `diagnostic`'s `diagnostic` body, `event-applied`'s inner `event.payload` — all server-emitted, server-validated). No client-controlled `z.unknown()` reaches a handler.
- **Cookie / cookie-bearing auth**: Pending cookie uses `crypto.timingSafeEqual` (`pending-cookie.ts:203-211`). Session token uses `jose.jwtVerify` with a single algorithm allowlist (`session-token.ts:206-211`); rejects extra payload claims (`:248-253`). Cookies are `HttpOnly; SameSite=Lax; Path=/` and conditionally `Secure`. Confidence: confirmed.
- **OIDC / SSRF**: `OIDC_ISSUER_URL` is loaded from env at startup (`auth/config.ts:123`); user-controlled callback parameters (`state`, `code`) are passed to `openid-client` which validates them server-side. No user-controlled URL is ever `fetch`'d. The 302 redirect after callback goes to env-controlled `oidcConfig.appBaseUrl` (`routes.ts:682`) — no open redirect.
- **Header injection**: Set-Cookie values are constructed by `buildSessionCookieHeader` / `buildPendingCookieHeader` from JWT (RFC-7515 base64url, no CRLF) and constants. `Location` header is set via `reply.redirect(url.toString(), 302)` — `URL.toString()` percent-encodes CRLF. No raw user input to headers found.
- **Prototype pollution**: All Zod parses use `z.object({...})` (no `passthrough()`, no `record(z.string(), z.any())` over inbound data). Zod's `.parse` does not write `__proto__` keys into the output.
- **ReDoS**: Only regexes in scope are `kebabFromErrorName` (`error-handler.ts:111-114` — operates on internal `err.name` strings, not user input) and the JWT base64url char-class in `pending-cookie.ts` (linear). No catastrophic-backtracking patterns over user input.
- **`eval` / `Function` / dynamic require**: None found.
- **JSON.parse on user input**: Two locations (`pending-cookie.ts:216`, `ws-envelope.ts:1406`). Both wrap in try/catch. Both fail to typed errors.

## Overall assessment

The codebase exhibits strong fundamentals: 100% parameterized SQL, schema-on-write at every event-append boundary, two-stage Zod parse on every inbound WS frame, `timingSafeEqual` on cookie HMAC, narrow JWT verifier (single algorithm, strict payload-shape audit), and existence-non-leak (404-not-403) semantics across the visibility-gated session-management surface. The error-handler plugin correctly sanitizes 5xx responses to a generic envelope and never serializes `Error.message` / stack to the client (except via the deliberate `ApiError.message` echo, which is handler-author-controlled).

The findings concentrate on **DoS surface and resource ceilings** — body-size, payload-size, per-connection subscription cap, per-user-text length cap, catch-up rate-limit, flow-state map cap. None are remote pre-auth code execution, none allow cross-tenant data exposure beyond what visibility already gates, none break authentication. They are concerns about cost asymmetry: an authenticated client can cheaply force expensive server work. The right hardening sequence is (1) wire explicit `bodyLimit` + `maxPayload`, (2) add per-string `.max(...)` to the methodology payloads, (3) cap per-connection subscriptions, (4) rate-limit `catch-up`. Most are one-liner config changes.

The two info-leak concerns (F-007 logger redaction, F-008 defensive 500 messages) are defense-in-depth — neither is currently triggerable in a way that exposes secrets — but tightening both is cheap.
