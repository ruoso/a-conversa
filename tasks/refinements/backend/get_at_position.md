# Refinement: `backend.replay_endpoints.get_at_position`

## TaskJuggler entry

- **Task:** `backend.replay_endpoints.get_at_position`
- **Definition:** [`tasks/20-backend.tji`](../../20-backend.tji) (the `task get_at_position` block inside `task replay_endpoints`).
- **One-line:** `GET /sessions/:id/state?position=... — projected state at log position`.

## Effort estimate

**1d** (from the `.tji` block).

## Inherited dependencies

- **`data_and_methodology.replay_primitive.project_at_position`** (explicit `depends`) — **settled.** Shipped at [`apps/server/src/projection/at-position.ts`](../../../apps/server/src/projection/at-position.ts) (`projectAtPosition`, `replayHeadSequence`, `ReplayPositionError`). Refinement: [`tasks/refinements/data-and-methodology/project_at_position.md`](../data-and-methodology/project_at_position.md). This is the replay primitive this endpoint exposes over HTTP.
- **`backend.replay_endpoints` parent depends** — `!session_management`, `data_and_methodology.replay_primitive`. **Settled.** Session CRUD, the visibility gate (`canSeeSession`), and the replay primitive are all in place.
- **Sibling replay endpoints** `get_session_log`, `list_snapshots`, `get_snapshot` — **settled and shipped.** They established the `replayRoutesPlugin` home, the `canSeeSession` 404 gate, and the Vitest + Cucumber two-layer test discipline this task reuses verbatim. Refinements: [`get_session_log.md`](./get_session_log.md), [`list_snapshots.md`](./list_snapshots.md), [`get_snapshot.md`](./get_snapshot.md).

## What this task is

Add the fourth (and final) endpoint to the replay-routes family: `GET /api/sessions/:id/state?position=N`. Where the sibling `get_session_log` returns the **raw event log** (the source of truth), this endpoint returns the **projected state** — the materialized `Projection` — as it stood after applying every event up to and including log position `N`. It is a thin HTTP wrapper over the already-shipped `projectAtPosition` replay primitive: read the session's event log, replay it to position `N`, serialize the resulting `Projection` to the same wire shape the WS `snapshot` message already uses, and return it. Position is event-sequence space (`0` = pre-history empty baseline; `N` = after the event whose `sequence === N`), exactly as `projectAtPosition` defines it.

## Why it needs to be done

It is the backend seam every replay/test-mode position-export surface reads from. The direct downstream consumer is `replay_test.test_mode.test_mode_export_position` ("Export the projected state at any position", [`tasks/60-replay-and-test-mode.tji`](../../60-replay-and-test-mode.tji) line 110), which `depends backend.replay_endpoints.get_at_position`. The timeline scrubber and its inspectors render per-event stops by walking the log client-side; the *export* surface needs the server's canonical projection at a chosen position rather than re-deriving it in the browser. This endpoint is the last leaf of the `replay_endpoints` group, so closing it completes the replay-API surface.

## Inputs / context

- **The replay primitive to expose** — [`apps/server/src/projection/at-position.ts`](../../../apps/server/src/projection/at-position.ts):
  - `projectAtPosition(events: readonly Event[], sessionId: string, position: number): Projection` (lines 35–49) — replays `events` whose `sequence <= position`, returns a `Projection` with `lastAppliedSequence === position`.
  - `replayHeadSequence(events: readonly Event[]): number` (lines 25–27) — the highest `sequence` in the log (`0` for an empty log).
  - `class ReplayPositionError extends Error` (lines 11–23), with `position` and `headSequence` fields — thrown for a non-integer, negative, or `> headSequence` position. **This is the 400 source for an out-of-range position.**
- **The handler to mirror** — the `get_snapshot` route in [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts) lines 531–629: `app.get(..., { preHandler: app.authenticate, preValidation: <reject-unknown-query>, schema: {...}, response: {...} }, async (request, reply) => {...})`. Same auth assertion (lines 586–597), same `ensurePool()`, same `canSeeSession` 404 gate (lines 605–612).
- **Plugin header + imports** — [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts) lines 1–37. Lines 22–28 already document this endpoint as the projected-state counterpart to `get_session_log`. Imports `ApiError`, `errorEnvelopeRef`, the pool accessor, the read helpers, and `canSeeSession`.
- **The read helpers** — [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts): `readSessionEventsPage` (lines 113–139, cursor-paginated) and `readSessionSnapshots` (lines 180–202). The executor-injection style (`SessionEventReadExecutor`, lines 30–35) is the pattern a new full-log read helper follows.
- **The visibility gate** — [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) `canSeeSession(executor, sessionId, userId)` (lines 167–178): public OR host OR current/past participant.
- **The projection serializer to reuse** — `serializeProjectionForWire(projection: Projection): Record<string, unknown>` at [`apps/server/src/ws/handlers/snapshot.ts`](../../../apps/server/src/ws/handlers/snapshot.ts) lines 299–347, re-exported from [`apps/server/src/ws/handlers/index.ts`](../../../apps/server/src/ws/handlers/index.ts) lines 74–76. Flattens the `Projection` class's Maps to plain objects; the single source of truth for projection→wire shape.
- **The wire payload to match** — `snapshotStatePayloadSchema` at [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) lines 881–885: `{ sessionId: uuid, sequence: int>=0, projection: unknown }`, with the documented projection structure at lines 851–868 and the "why `projection` is opaque" rationale at lines 870–879.
- **Error helper** — `ApiError.notFound(...)` → 404 `not-found`; `new ApiError(400, 'validation-failed', ...)` → 400, both in [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts).
- **ADRs** — [`0021`](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) (events validated on write, trusted on read), [`0022`](../../../docs/adr/0022-no-throwaway-verifications.md) (permanent two-layer coverage), [`0023`](../../../docs/adr/0023-web-framework-fastify.md) (Fastify).

## Constraints / requirements

1. **Route & registration.** `app.get('/api/sessions/:id/state', {...}, handler)` inside the existing `replayRoutesPlugin` in `apps/server/src/replay/routes.ts`. No new plugin — it is the fourth sibling in the family's home (`get_session_log` Decisions §2).
2. **Auth.** `preHandler: app.authenticate`; defensive `request.authUser === undefined → 500` assertion, identical to the siblings. 401 `auth-required` is middleware-owned and emitted before the handler.
3. **Path param.** `:id` is a UUID (`sessionIdParamsSchema`, already declared in the plugin). Non-UUID → 400 `validation-failed`.
4. **Query param `position`.** Required, JSON-schema `{ type: 'integer', minimum: 0 }` (ajv coerces the query string `"5" → 5`). A missing, non-integer, or negative `position` → 400 `validation-failed` from schema validation. Reject any **unknown** query key with the same `preValidation` 400 the sibling routes use (Fastify's `removeAdditional` would otherwise strip it silently) — only `position` is accepted.
5. **Visibility gate first.** `canSeeSession(pool, sessionId, userId)` runs before any event read. Zero visibility → 404 `not-found` (id unused or exists-but-invisible — indistinguishable from outside, per the existence-leak rule the siblings enforce). The event read never runs for an invisible session.
6. **Read the log, replay, serialize.** After the gate: read the session's full event log in ascending `sequence` order, call `projectAtPosition(events, sessionId, position)`, then `serializeProjectionForWire(projection)`. A `ReplayPositionError` (position `> headSequence`) is caught and re-thrown as 400 `validation-failed` (the position is out of the log's range — a client-input error, not a server fault). The 400 message should carry the valid range (`0..headSequence`), which the error already computes.
7. **Empty / head positions.** `position = 0` is always valid for a visible session (returns the empty baseline projection, `lastAppliedSequence === 0`) — including a brand-new session with no events. `position = headSequence` returns the full-log projection.
8. **Response (200) shape.** `{ sessionId, sequence, projection }`, byte-identical in field names and structure to the WS `snapshot` payload (`snapshotStatePayloadSchema`): `sequence === position === projection.lastAppliedSequence`; `projection` is the opaque serialized object. Declared as a Fastify JSON-schema for the OpenAPI doc (the WS counterpart is a Zod schema in a different validation system; the two are structurally parallel, not literally shared — see Decisions §3).
9. **`projection` is opaque in the response schema** — an open object (`type: 'object', additionalProperties: true`), for the same reason the WS schema uses `z.unknown()`: the projection is built by a pure function over schema-validated events; re-validating its output is redundant and would couple the route to every facet field. The serializer's unit tests pin the wire shape; the response schema keeps only the outer envelope honest.
10. **Read on a single connection.** Use the default pool (`ensurePool()` / `getDefaultPool()`), as the siblings do. No transaction is needed — this is a read-only replay.
11. **OpenAPI.** The route's `schema` carries `tags: ['replay']`, a `summary`/`description`, `security: [{ cookieAuth: [] }]`, `params`, `querystring`, and `response: { 200, '4xx': errorEnvelopeRef, '5xx': errorEnvelopeRef }`, matching the sibling routes. The generated `/docs/json` lists `GET /sessions/{id}/state`.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), all coverage is permanent (Vitest + Cucumber); no throwaway scripts.

- **Build.** `pnpm --filter @a-conversa/server run build` succeeds.
- **Vitest — read helper** (`events/read.test.ts`, if a new full-log read helper is added per Decisions §2): returns all events ascending; empty log → `[]`; the helper does **not** gate visibility.
- **Vitest — handler** (`replay/routes.test.ts`) via Fastify `.inject()`:
  - authenticated + visible + valid `position` → 200 with `{ sessionId, sequence, projection }`, `sequence === position`, `projection.lastAppliedSequence === position`;
  - `position = 0` → empty baseline projection;
  - `position = headSequence` → full-log projection;
  - no auth → 401;
  - unknown / invisible session → 404 (NOT 403);
  - missing / non-integer / negative `position` → 400;
  - `position > headSequence` → 400 (out-of-range, message carries `0..headSequence`);
  - unknown query key → 400.
- **Cucumber + pglite** (`get-session-state.feature`) — the protocol-seam pin required by the backend e2e policy (this endpoint crosses the HTTP/replay boundary, so Vitest alone is insufficient): against the migrated schema, seed a session with a few events; assert `GET /sessions/:id/state?position=K` returns the projected state matching the WS-snapshot shape at that position; assert the 404 path for a private session the caller can't see; assert the 400 path for an out-of-range position. This mirrors the `get-session-events.feature` / `get-session-snapshot.feature` precedent.
- **`make test`** green end-to-end.
- **OpenAPI.** `/docs/json` lists `GET /sessions/{id}/state` tagged `replay` with the `cookieAuth` security requirement, a `position` query param, and a 200 response describing `{ sessionId, sequence, projection }`.
- **TaskJuggler.** `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the closer adds `complete 100`.
- **No Playwright** for this task: it is a backend HTTP/replay leaf, not a `moderator_ui.* / participant_ui.* / audience.* / replay_test.*` UI-stream task, so the UI-stream Playwright policy does not apply. The downstream UI consumer `replay_test.test_mode.test_mode_export_position` (which already exists in the WBS) owns the user-visible export flow and its Playwright coverage — no new follow-up task is registered here.

## Decisions

**§1 — HTTP wrapper over `projectAtPosition`; no new replay logic.** The replay primitive is already shipped, refined, and unit-tested. This endpoint reads the log, calls `projectAtPosition`, and serializes the result. *Alternative — recompute / cache materialized projections server-side:* rejected. The project has no materialized-projection store (snapshots are sparse *markers*, not stored projections), and replaying a bounded session log per request is the same cost the WS snapshot path already pays. Caching is a premature optimization with no stated consumer pressure.

**§2 — Read the full event log via a dedicated `readSessionEventLog` helper, then let `projectAtPosition` break internally.** `projectAtPosition` validates the requested position against the *true* head sequence (`replayHeadSequence(events)`); that requires the whole log, not just events up to `position` — reading only up to `position` would make an out-of-range position indistinguishable from the head and silently return the wrong (truncated) projection instead of a 400. So the handler reads the entire log ascending and passes it in. *Add a small `readSessionEventLog(executor, { sessionId }): Promise<Event[]>` to `events/read.ts`* (full-log, ascending, no pagination, executor-injection — mirroring `readSessionSnapshots`), Vitest-covered. *Alternative — loop `readSessionEventsPage` until `nextCursor === null`:* rejected; it reuses the paginated helper but adds cursor-loop logic in the handler and N round-trips for no benefit over one ascending read. A dedicated single-query helper is simpler and independently unit-testable. *Alternative — read only `sequence <= position` plus a separate `MAX(sequence)` head query:* rejected; two queries and a re-implementation of the range check that `projectAtPosition` already owns, to save reading the (bounded) tail of a session log. Reuse the primitive's existing validation.

**§3 — Response is structurally identical to the WS `snapshot` payload, reusing `serializeProjectionForWire`.** Both the WS snapshot and this HTTP replay return "the projection at a sequence," and the test-mode loader/exporter should treat them interchangeably. Reuse the single `serializeProjectionForWire` helper — do **not** hand-roll a second projection→wire serializer, which would let the two wire shapes drift apart. The 200 body is `{ sessionId, sequence, projection }`, matching `snapshotStatePayloadSchema`'s field names and structure. The response is declared as a Fastify JSON-schema (the WS schema is Zod in `shared-types`, a different validation system — they are kept structurally parallel, not literally shared, because the HTTP route's schema feeds the OpenAPI generator). *Alternative — a bespoke flat projection body without the `{ sessionId, sequence }` envelope:* rejected; the envelope is what lets a consumer correlate the payload with a position and reuse WS-snapshot handling code unchanged.

**§4 — `serializeProjectionForWire` should move to the projection layer; importing it in place is the accepted fallback.** The helper is a pure `Projection → wire` mapping and is now consumed by two seams (WS snapshot, HTTP replay), so its natural home is the `projection` module (e.g. `apps/server/src/projection/serialize.ts`), with both `ws/handlers/snapshot.ts` and `replay/routes.ts` importing it from there. This avoids the HTTP layer reaching into a WS-handler module for a non-WS concern. *If* the relocation churns the WS handler's tests beyond what a 1d task should absorb, importing `serializeProjectionForWire` directly from `ws/handlers/index.js` is an acceptable fallback — the reuse (one serializer, one wire shape) is the load-bearing requirement; its file location is not. Either way, no second serializer is written.

**§5 — `position` is a required query param (no implicit "current state" default).** The endpoint's purpose is *state at a chosen position*; an explicit `position` keeps the contract single-purpose and matches the explicit-contract bias of the sibling routes (which reject unknown query keys rather than guess). *Alternative — default `position` to the head when omitted:* rejected as scope the consumers don't ask for; a "current full state" convenience can be added later if a surface needs it, and omitting `position` today cleanly yields a 400 rather than a silent semantic. *Alternative — accept a `snapshotId` query param as an alternate addressing mode:* rejected here; resolving a snapshot id to a position is `snapshot_resolution`'s job, and the consumer (`test_mode_export_position`) addresses by numeric position. Keep one addressing axis.

**§6 — 404 (not 403) for invisible sessions, gate-before-read.** Identical to all three siblings (existence-leak rule). The visibility gate runs before the event read, so an out-of-range-position 400 is reachable only after the session is confirmed visible and leaks nothing about a private session.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Added `readSessionEventLog(executor, { sessionId }): Promise<Event[]>` to `apps/server/src/events/read.ts` — full-log ascending read, executor-injection pattern mirroring `readSessionSnapshots`.
- Added `GET /api/sessions/:id/state?position=N` route to `apps/server/src/replay/routes.ts` inside `replayRoutesPlugin` — auth + `canSeeSession` 404 gate, reads full log via `readSessionEventLog`, calls `projectAtPosition`, serializes via `serializeProjectionForWire` (imported from `ws/handlers/index.js`), returns `{ sessionId, sequence, projection }`.
- `ReplayPositionError` (out-of-range position) caught and re-raised as 400 `validation-failed` carrying the valid `0..headSequence` range.
- Vitest coverage in `apps/server/src/events/read.test.ts` (3 new tests: full-log ascending, empty log → `[]`, no visibility gate) and `apps/server/src/replay/routes.test.ts` (16 new handler tests: 200 head/pos0-baseline/brand-new/mid-prefix, 401, 404 unknown, 404 private-not-403, 200 private-host, 400 non-uuid/missing/negative/non-integer/out-of-range-with-range/unknown-query-key).
- Cucumber/pglite feature created at `tests/behavior/backend/get-session-state.feature` with step definitions at `tests/behavior/steps/backend-get-session-state.steps.ts` (4 scenarios: head projection, pos0 baseline, private→404, out-of-range→400).
- `serializeProjectionForWire` imported from `ws/handlers/index.js` (accepted §4 fallback — avoids churning WS-handler tests; single-serializer requirement satisfied).
- Closes the fourth and final replay endpoint; `backend.replay_endpoints` group is now fully shipped.
