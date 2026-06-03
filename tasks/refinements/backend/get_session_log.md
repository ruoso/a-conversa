# `GET /sessions/:id/events` — paginated event log

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.replay_endpoints.get_session_log`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.session_management` — settled. The whole session-management family shipped: `apps/server/src/sessions/routes.ts` (the Fastify sessions plugin), the `SessionResponse` schema machinery, `__buildTestSessionsApp(...)`, and — load-bearing for this task — the visibility seam `apps/server/src/sessions/visibility.ts` (`canSeeSession`, `visibilityWhereFragment`). Inherited via the parent `replay_endpoints` block's `depends !session_management`.
- `data_and_methodology.replay_primitive` — settled. The replay primitive (`apps/server/src/projection/at-position.ts`, `position-navigation.ts`, `snapshot-resolution.ts`, barrel `index.ts`) consumes a `readonly Event[]` log ordered by per-session `sequence`. This task lands the HTTP surface that *delivers* that log to a client; it does not itself project. Inherited via the parent `replay_endpoints` block's `depends data_and_methodology.replay_primitive`.
- `data_and_methodology.event_types` — settled (transitively). The `Event` discriminated-union envelope and its Zod validators live in `packages/shared-types/src/events.ts` (ADR 0021).

## What this task is

First sibling under `backend.replay_endpoints`. Lands `GET /sessions/:id/events` — an authenticated user issues a GET against a specific session id; the server returns that session's persisted event log as a **forward, sequence-ordered, cursor-paginated** stream, gated by the same visibility predicate the session-metadata endpoints apply.

This is the *raw-log* read surface. It is deliberately distinct from its sibling `backend.replay_endpoints.get_at_position` (`GET /sessions/:id/state?position=...`), which returns *projected state* at a log position. This endpoint returns the events themselves, in replay order, so a client (the test-mode loader, a replay scrubber, an audit tool) can feed them through the replay primitive itself. Separation of concerns: the log is the source of truth; projection is a derived view computed elsewhere.

The artifact shape:

- **A read-side events helper** — `apps/server/src/events/read.ts` (new file, sibling to the existing write-side `apps/server/src/events/append.ts`). Exports `readSessionEventsPage(executor, { sessionId, afterSequence, limit })` returning `{ events: Event[]; nextCursor: number | null }`. The SQL mirrors the slice query already proven in the WS catch-up handler (`apps/server/src/ws/handlers/catch-up.ts` lines 589–596): `WHERE session_id = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT $3`, with a `limit + 1` look-ahead to compute `nextCursor` accurately. Rows map to the wire-ready `Event` envelope via the same row→Event shape catch-up uses (`rowToEvent`, catch-up.ts ~line 550).
- **A replay-routes plugin** — `apps/server/src/replay/routes.ts` (new file). Registers `GET /sessions/:id/events` and is the family home for the three sibling replay endpoints that follow (`get_at_position`, `list_snapshots`, `get_snapshot`). Registered in `apps/server/src/server.ts` alongside `sessionsRoutesPlugin` (server.ts line 86). Imports `canSeeSession` from `apps/server/src/sessions/visibility.ts` for the gate.
- **Vitest unit suite** — `apps/server/src/replay/routes.test.ts` (and `apps/server/src/events/read.test.ts` for the helper).
- **Cucumber + pglite feature** — `tests/behavior/backend/get-session-events.feature` + `tests/behavior/steps/backend-get-session-events.steps.ts` (new files), exercising the endpoint against the migrated schema.

## Why it needs to be done

- **`replay_test.test_mode_load_session`** ("Load a saved session's event log", [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) line 78–79) depends directly on `backend.replay_endpoints.get_session_log`. The test-mode loader pages the full log down and replays it through `projectFromLog` to reconstruct state for design iteration. Without a paginated log-read HTTP surface, the loader has no way to fetch a saved session's events (the only event-read path today is WebSocket-only, inside the catch-up handler).
- **Replay / scrubber UI** (the `replay_primitive` position-navigation and snapshot-resolution seams) needs the events to drive `nextPosition` / `prevPosition` and to resolve chapter markers; the client loads the log once via this endpoint, then navigates locally.
- **Audit surfaces.** A participant who left a session retains visibility (the visibility rule keeps past participants) and may review the full event history; this endpoint is the canonical "show me everything that happened, in order."

## Inputs / context

From [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts):

- `canSeeSession(executor, sessionId, userId): Promise<boolean>` (lines 167–178) — the async predicate encoding `public OR host OR participant (incl. historical)`. This task reuses it directly for the gate; **no inlined SQL.** The visibility decision and its rationale are recorded in [`list_sessions_endpoint.md`](./list_sessions_endpoint.md) and [`get_session_endpoint.md`](./get_session_endpoint.md); this endpoint inherits it verbatim — the events of a session are exactly as visible as the session itself.
- `visibilityWhereFragment(userIdParamIndex)` (lines 115–132) — the SQL-fragment form, available if a single-query join is preferred over the two-step gate (see Decisions).

From [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) (lines 88–106): `appendSessionEvent(client, event)` — the write-side counterpart. The new read helper lands beside it in the same `events/` module, mirroring its executor-injection shape.

From [`apps/server/src/ws/handlers/catch-up.ts`](../../../apps/server/src/ws/handlers/catch-up.ts) (lines 542–596): the WS catch-up handler already reads `session_events` by sequence range, ordered ascending, with a `LIMIT`, and maps rows to `Event` via `rowToEvent` (~line 550). This is the proven prior art for the read SQL; the new helper lifts the same query shape. **This task does NOT refactor catch-up** to consume the new helper — catch-up is shipped and tested; re-pointing it is out of scope and carries regression risk for zero functional gain here.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `EventEnvelope<K>` / `Event` (lines 820–863) — the wire-ready envelope: `{ id, sessionId, sequence, kind, actor, payload, createdAt }`. Already camelCase; the response carries this shape unmodified.
- `eventEnvelopeSchema` (lines 871–885) and `validateEvent` (lines 918–954) — the Zod machinery (ADR 0021). The OpenAPI response schema references the event envelope shape.

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts): `ApiError.notFound(...)` → 404 `not-found`. Used for both "session does not exist" and "session exists but is not visible" — the same existence-leak rule as `get_session_endpoint`.

From [`apps/server/src/server.ts`](../../../apps/server/src/server.ts): `createServer()` (lines 369–707) registers route plugins; sessions plugin at line 86. The new `replayRoutesPlugin` registers here.

From the `session_events` migration ([`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql)): `(id, session_id, sequence, kind, actor, payload, created_at)` with `UNIQUE (session_id, sequence)`; the unique constraint gives the `(session_id, sequence)` ordered access path the paginated read uses.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — events are schema-validated on write; on read they are trusted (no re-validation in the hot path) and returned as `Event`. From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest covers the helper + handler logic; Cucumber+pglite covers the end-to-end query against the migrated schema.

## Constraints / requirements

- **Endpoint**: `GET /sessions/:id/events`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Path param** (JSON Schema on `schema.params`):

  ```jsonc
  {
    "type": "object",
    "required": ["id"],
    "additionalProperties": false,
    "properties": { "id": { "type": "string", "format": "uuid" } }
  }
  ```

  A non-UUID `:id` → 400 `validation-failed` from the Fastify validator before the handler runs.

- **Query string** (JSON Schema on `schema.querystring`):

  ```jsonc
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "after": { "type": "integer", "minimum": 0 },
      "limit": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 100 }
    }
  }
  ```

  - `after` — exclusive lower bound on `sequence`. Absent → treated as `0` (start of log; the first real event is `sequence = 1`).
  - `limit` — page size, default `100`, max `1000`. Out-of-range → 400 `validation-failed`.

- **Visibility gate** — `if (!(await canSeeSession(pool, id, request.authUser.id))) throw ApiError.notFound(...)`. Zero-visibility → 404 (whether the id is unused or exists-but-invisible — indistinguishable from outside, per the existence-leak rule). The gate runs **before** the events read; an invisible session never reaches the events query.

- **Read**: `readSessionEventsPage(pool, { sessionId: id, afterSequence: after ?? 0, limit })`:

  ```sql
  SELECT id, session_id, sequence, kind, actor, payload, created_at
  FROM session_events
  WHERE session_id = $1 AND sequence > $2
  ORDER BY sequence ASC
  LIMIT $3            -- bound to limit + 1 for the has-more look-ahead
  ```

  Fetch `limit + 1` rows; if the extra row is present, drop it and set `nextCursor` to the last *returned* event's `sequence`; else `nextCursor = null`. Map rows to `Event` via the catch-up `rowToEvent` shape.

- **Ordering**: ascending by `sequence` (replay order). This is the opposite of `GET /sessions`' `created_at DESC` — and deliberately so: the event log is replayed *forward* from `sequence = 1`, so the natural read order is ascending. The `UNIQUE (session_id, sequence)` index is the ordered access path.

- **Response shape** — 200 + JSON body:

  ```json
  {
    "events": [
      { "id": "<uuid>", "sessionId": "<uuid>", "sequence": 1, "kind": "<kind>",
        "actor": "<uuid>" | null, "payload": { }, "createdAt": "<iso-8601>" }
    ],
    "nextCursor": 1 | null
  }
  ```

  `events` is an `Event[]` (the envelope shape, unmodified). `nextCursor` is the sequence to pass as `?after=` to fetch the next page, or `null` when the page reaches the head of the log. A client pages until `nextCursor === null`.

- **Empty page is 200, not 404.** A visible session with no events past the cursor (or a brand-new session) returns `{ events: [], nextCursor: null }`. 404 is reserved for the session itself being absent/invisible; an empty log page is a meaningful empty answer.

- **Status codes**:
  - 200 — visible session; a (possibly empty) page of events.
  - 400 — `:id` not a UUID, or `after`/`limit` out of range (`validation-failed`).
  - 401 — unauthenticated (`auth-required`, middleware-owned).
  - 404 — session does not exist OR exists but not visible (`not-found`, single phrasing for both).
  - 500 — DB error or unhandled exception.

- **Pool injection contract** — same as the sessions plugin; `replayRoutesPlugin` accepts `{ pool?: DbPool }` and lazily resolves the default pool on first request.

- **Test layers per ADR 0022**:
  - **Vitest** (`events/read.test.ts`) — helper unit cases: returns events ascending; `after` excludes ≤ cursor; `limit` caps page size; `nextCursor` is the last returned sequence when more remain; `nextCursor` is `null` at head; empty result → `{ events: [], nextCursor: null }`.
  - **Vitest** (`replay/routes.test.ts`) — handler cases via `.inject()`: authenticated + visible → 200 + ascending events; no auth → 401; unknown id → 404; private not visible → 404 (NOT 403); private visible to host → 200; private visible to participant → 200; non-UUID path → 400; `?limit=0` / `?limit=5000` → 400; second-page fetch via `?after=<nextCursor>` returns the continuation.
  - **Cucumber+pglite** (`get-session-events.feature`) — end-to-end against the migrated schema: a visible session returns its events in ascending sequence order; paging with `?after`+`?limit` returns the next page and finally `nextCursor: null`; a private session is NOT visible to a non-participant → 404; an unknown id → 404. **This is the protocol-seam pin required by the backend e2e policy** (the endpoint crosses the HTTP/replay boundary; Vitest-only is insufficient).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, including the new `events/read.test.ts` and `replay/routes.test.ts` cases.
- `pnpm run test:behavior:smoke` (Cucumber) green, including the new `get-session-events.feature` scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `GET /sessions/{id}/events` tagged appropriately (`replay` or `sessions`) with the `cookieAuth` security requirement and a 200 response describing `{ events: Event[], nextCursor }`.
- The exact before/after Vitest and Cucumber totals are recorded in the `## Status` block on completion (per the [README ritual](../README.md#task-completion-ritual)); this refinement intentionally does not hard-code baseline counts, which drift between authoring and implementation.

## Decisions

- **Cursor pagination by `sequence`, not limit/offset.** Three alternatives surveyed:
  - **`?after=<sequence>` exclusive cursor + `?limit`** (chosen). `sequence` is the per-session monotonic key the replay primitive already addresses positions in; it is the natural, stable cursor. Cursor pagination is immune to the page-drift that limit/offset suffers when rows are appended between page fetches (the event log is append-only, so new events can land at the head mid-pagination; offset would re-read or skip). The exclusive `sequence > $after` matches the catch-up handler's proven slice query exactly.
  - **limit/offset** (rejected). Offset pagination drifts on an append-only log and re-scans skipped rows; it also has no natural relationship to the replay-primitive's position vocabulary. No upside here.
  - **No pagination, return the whole log** (rejected). The task title says *paginated*; a long-running session's log is unbounded, and a single unpaged read risks large payloads and memory pressure on both ends. `list_sessions` could defer pagination because a user's session list is small; an event log is not.

- **`nextCursor` via `limit + 1` look-ahead, not a separate COUNT.** Two alternatives surveyed:
  - **Fetch `limit + 1`, trim, derive `nextCursor`/`hasMore` from the extra row** (chosen). One query, exact has-more signal, no ambiguity on the exact-multiple-of-limit boundary (where "last page had exactly `limit` rows" would otherwise be indistinguishable from "more remain"). The extra row is one event of overhead.
  - **Return `nextCursor` = last event's sequence whenever `events.length === limit`** (rejected). Produces a spurious final empty page when the total is an exact multiple of `limit`; clients must tolerate an empty trailing fetch. The look-ahead removes that wart for one extra row.
  - **Separate `SELECT COUNT(*)` / `MAX(sequence)`** (rejected). A second round-trip for information the look-ahead already yields.

- **Reuse `canSeeSession`; do NOT inline the visibility SQL.** The visibility seam now has a real helper (`apps/server/src/sessions/visibility.ts`), which did not exist when `get_session_endpoint` inlined the predicate. With the helper in hand and this being yet another call site for the same gate, calling `canSeeSession` is the right move — it is the canonical encoding of the visibility decision, and an events endpoint must enforce exactly the session's own visibility. Alternative — a single visibility-joined events query using `visibilityWhereFragment` — was considered (one round-trip instead of two) but rejected for v1: the two-step gate (visibility check, then read) keeps the 404 path byte-identical to `get_session_endpoint`, keeps the events query trivial, and the extra round-trip is a small bounded cost. If profiling later shows the double round-trip matters, the single-query form is a drop-in using the existing fragment helper.

- **New `apps/server/src/replay/routes.ts` plugin, not an extension of `sessions/routes.ts`.** Two alternatives surveyed:
  - **Dedicated `replayRoutesPlugin`** (chosen). Three more replay endpoints follow in this same `.tji` block (`get_at_position`, `list_snapshots`, `get_snapshot`); giving the family its own plugin gives them a home and avoids further bloating `sessions/routes.ts` (already ~3600 lines). The plugin imports `canSeeSession` for the gate — the visibility decision stays owned by `sessions/visibility.ts`, the plugin merely consumes it.
  - **Extend `sessions/routes.ts`** (rejected). The path is a `/sessions/:id/...` sub-resource, so it *could* live there, but four replay endpoints would compound an already-large file; the replay family is a distinct concern (history/replay vs. session lifecycle) and deserves its own module.

- **New read helper in `apps/server/src/events/read.ts`, mirroring `append.ts`.** The write side (`appendSessionEvent`) already lives in `events/`; the read counterpart belongs beside it with the same executor-injection shape. The SQL is lifted from the catch-up handler's proven slice query. Centralizing the read here means the upcoming `get_at_position` endpoint (which must load the prefix `sequence ≤ position` to project) can reuse a sibling helper rather than re-deriving the query.

- **Ascending sequence order (not `created_at DESC`).** The event log is replayed forward; ascending `sequence` is replay order and the order every downstream consumer (test-mode loader, scrubber, projection) needs. `sequence` — not `created_at` — is the ordering authority (wall-clock `created_at` is audit metadata only, per the `session_events` schema), so ties and clock skew are non-issues.

- **Events returned as the raw `Event` envelope, not re-validated and not re-shaped.** ADR 0021 validates on write; on read the rows are trusted and mapped straight to the camelCase `Event` envelope (`rowToEvent`). No per-row Zod re-parse in the read path — it would add cost for no safety gain on data the server itself wrote and validated. The envelope is already the wire shape, so no response-specific DTO is introduced.

- **`get_session_log` (raw events) is separate from `get_at_position` (projected state).** This endpoint never projects; it returns events. The sibling `get_at_position` owns "projected state at a position." Keeping them separate means the raw-log read has no dependency on the projection engine's output shape, and a client can choose to project locally (the replay UI does) or ask the server for a single position (an audit snapshot view does).

## Open questions

- **`headSequence` in the response envelope.** Including the session's current max `sequence` would let a client size a scrubber / progress bar before paging the whole log. Deferred — it adds a query or a join for a convenience the paginate-until-`nextCursor`-is-`null` loop already delivers; the test-mode loader pages the full log anyway. If a UI needs the head without a full page-through, revisit then (cheap: `MAX(sequence)` alongside the gate).
- **`kind` filtering (`?kind=commit`).** The `session_events_session_kind_idx` index exists, so a kind filter would be cheap and a diagnostics/audit surface might want "show me only the commits." Deferred — no current consumer needs it; the raw-log read is the v1 surface and a filter is an orthogonal axis that can layer on later without changing the pagination contract.
- **`ETag` / conditional GET on a completed (ended) session's log.** An ended session's log is immutable, so its pages are perfectly cacheable. Deferred — premature for v1; the consumers today fetch once and replay locally.

## Status

**Done** — 2026-06-03.

- Landed `apps/server/src/events/read.ts` — new read-side helper `readSessionEventsPage(executor, { sessionId, afterSequence, limit })` returning `{ events: Event[]; nextCursor: number | null }`, using `limit + 1` look-ahead; SQL mirrors the catch-up handler's proven slice query.
- Landed `apps/server/src/replay/routes.ts` — new `replayRoutesPlugin` Fastify plugin registering `GET /sessions/:id/events`; visibility-gated via `canSeeSession`; cursor-paginated response `{ events, nextCursor }`.
- Updated `apps/server/src/server.ts` — `replayRoutesPlugin` registered alongside `sessionsRoutesPlugin`.
- Landed `apps/server/src/events/read.test.ts` — 6 Vitest cases covering the read helper (ascending order, `after` exclusion, page cap, `nextCursor` look-ahead, head sentinel, empty result).
- Landed `apps/server/src/replay/routes.test.ts` — 11 Vitest cases covering the handler via `.inject()` (auth, visibility, pagination, 400/404 paths).
- Landed `tests/behavior/backend/get-session-events.feature` + `tests/behavior/steps/backend-get-session-events.steps.ts` — 4 Cucumber+pglite scenarios pinning the HTTP/replay protocol seam (ascending order, paging with `?after`, private-not-visible → 404, unknown id → 404).
- Fixer applied a scoped `eslint-disable`/`eslint-enable` block in `replay/routes.ts` around the `FastifyPluginAsync` declaration to satisfy `@typescript-eslint/require-await` (the function must be typed `FastifyPluginAsync` to match sibling convention, but its body awaits nothing).
- All four driver verification steps passed: `pnpm run check`, Vitest (293 scenarios), Cucumber (2051 steps), Playwright.
