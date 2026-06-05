# `GET /sessions/:id/snapshots` — list a session's snapshot markers

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.replay_endpoints.list_snapshots`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.session_management` — settled. The session-management family shipped, including the visibility seam `apps/server/src/sessions/visibility.ts` (`canSeeSession`, `visibilityWhereFragment`). Inherited via the parent `replay_endpoints` block's `depends !session_management`.
- `data_and_methodology.replay_primitive` — settled. The replay primitive landed, including `apps/server/src/projection/snapshot-resolution.ts` (`resolveSnapshotPosition`, `snapshotPositions`, `nextSnapshotPosition`, `prevSnapshotPosition`) and the projection's in-memory snapshot map (`projection.snapshots()`, `getSnapshot`, `snapshotCount`). This task delivers the HTTP surface that *lists* the snapshot markers; it does not project. Inherited via the parent `replay_endpoints` block's `depends data_and_methodology.replay_primitive`.
- `backend.replay_endpoints.get_session_log` — settled (sibling, **Done** 2026-06-03). It created the two seams this task extends: the `replayRoutesPlugin` ([`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts)) and the read-side events helper module ([`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts)). See [`get_session_log.md`](./get_session_log.md) for the visibility-gate, pool-injection, and OpenAPI-schema patterns this task mirrors. Not a formal `.tji` dependency edge, but a hard prerequisite in practice — this task adds a route to that plugin and a helper to that module.
- `data_and_methodology.event_types.snapshot_events` — settled (transitively, via `replay_primitive`). The `snapshot-created` event kind and its payload schema live in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) (`snapshotCreatedPayloadSchema`, lines 623–628): `{ snapshot_id: uuid, label: string (1–128), log_position: positive int }`.

## What this task is

Third sibling under `backend.replay_endpoints`. Lands `GET /sessions/:id/snapshots` — an authenticated user issues a GET against a specific session id; the server returns **all snapshot markers** for that session (the moderator-created labeled checkpoints), each as `{ snapshotId, label, logPosition, createdAt }`, ordered by `logPosition` ascending (chapter order). The list is gated by the same visibility predicate the session-metadata and event-log endpoints apply.

A "snapshot" is **not** a separate table row — it is a regular event in `session_events` with `kind = 'snapshot-created'` (the snapshots-as-events decision was settled by `data_and_methodology.event_types.snapshot_events`). Its payload self-describes the marker: `snapshot_id` (the canonical consumer key, distinct from the envelope `id`), `label` (moderator's 1–128-char chapter name), and `log_position` (the sequence the marker points at — equal, by construction, to the snapshot event's own `sequence`; see [`createSnapshot.ts` lines 101–116](../../../apps/server/src/methodology/handlers/createSnapshot.ts)). Listing snapshots therefore needs neither a projection nor a separate store: it is a filtered read of the snapshot-created events, mapped to the camelCase `SnapshotRecord` shape.

The artifact shape:

- **A read-side snapshots helper** — `readSessionSnapshots(executor, { sessionId })` added to the existing [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts) (sibling to `readSessionEventsPage`). Returns `SnapshotRecord[]` ordered by `sequence` ASC. SQL: `WHERE session_id = $1 AND kind = 'snapshot-created' ORDER BY sequence ASC`; each row's `payload` JSON yields `snapshotId`/`label`/`logPosition`, and `created_at` yields `createdAt` (normalized to ISO-8601, reusing `read.ts`'s existing driver-shape handling for `Date | string`).
- **A new route on the existing `replayRoutesPlugin`** — `GET /api/sessions/:id/snapshots` added to [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts), alongside the shipped `GET /api/sessions/:id/events`. Visibility-gated via `canSeeSession`. A new `SessionSnapshotsResponse` OpenAPI schema (with a shared `SnapshotRecord` element schema) registered the same idempotent way the events schemas are (routes.ts lines 222–227).
- **Vitest unit cases** — added to the existing `apps/server/src/events/read.test.ts` (helper) and `apps/server/src/replay/routes.test.ts` (handler).
- **Cucumber + pglite feature** — `tests/behavior/backend/list-session-snapshots.feature` + `tests/behavior/steps/backend-list-session-snapshots.steps.ts` (new files), pinning the HTTP/replay protocol seam against the migrated schema.

## Why it needs to be done

- **`backend.replay_endpoints.get_snapshot`** (`GET /sessions/:id/snapshots/:label`, [tasks/20-backend.tji](../../20-backend.tji) line 401) depends directly on `!list_snapshots`. The two share the snapshots read helper this task introduces (get_snapshot resolves a single marker; list returns all).
- **`replay_test.snapshots.snapshot_list_ui`** ("Snapshot list view", [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) lines 114–124) depends on `backend.replay_endpoints.list_snapshots`. The moderator/replay snapshot-list view loads the chapter markers once via this endpoint and renders them; `snapshot_jump_ui` then jumps to a marker's `logPosition` via the replay primitive's position navigation.
- **Replay / scrubber chapter markers.** `snapshot-resolution.ts`'s `snapshotPositions` / `nextSnapshotPosition` / `prevSnapshotPosition` operate on a `readonly SnapshotRecord[]`; this endpoint is the HTTP source of that array for a client that drives chapter-jump locally.

## Inputs / context

From [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts) (the plugin `get_session_log` shipped):

- `replayRoutesPluginAsync` (lines 214–315) — the plugin body; the new route is registered here, after the events route. The `/api` path prefix and `preHandler: app.authenticate` pattern (lines 240–243) are reused verbatim.
- `EVENT_ENVELOPE_SCHEMA_ID` / `sessionEventsResponseSchema` (lines 48–145) — the model for declaring a shared element schema plus a wrapper response schema with a stable `$id`, `$ref`-ed from the route's `schema.response`. The new snapshot schemas follow this exact shape.
- `sessionIdParamsSchema` (lines 151–162) — the `:id` UUID path-param schema. **Reused unchanged** — a non-UUID `:id` → 400 `validation-failed` before the handler runs.
- The schema-registration idempotence guard (lines 222–227), the lazy-pool `ensurePool` pattern (lines 231–238), the `request.authUser` defensive check (lines 278–286), and the `canSeeSession` gate (lines 302–304) are all reused directly.
- `__buildTestReplayApp` (lines 342–368) — the test harness builder; the new Vitest handler cases inject against it.

From [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts):

- `SessionEventReadExecutor` (lines 28–33) — the structural `query<TRow>(text, params?)` executor surface; the new `readSessionSnapshots` reuses it (production `pg.Pool`, Vitest shim, pglite adapter).
- `rowToEvent` (lines 58–71) — the driver-shape normalization for `sequence` (string|number) and `created_at` (Date|string). The new helper mirrors the `created_at` normalization for `createdAt`.

From [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) (lines 314–319): the `SnapshotRecord` interface — `{ snapshotId: string; label: string; logPosition: number; createdAt: string }`. This is the response element shape (already camelCase). The read helper returns `SnapshotRecord[]`.

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts):

- `snapshotCreatedPayloadSchema` (lines 623–628) and `SnapshotCreatedPayload` (line 631) — the snake_case on-disk payload (`snapshot_id`, `label`, `log_position`). The read helper maps these to the camelCase record.
- The kind discriminator literal `'snapshot-created'` (line 152) and the lead comment (lines 608–615) confirming "no separate table" and `log_position` as a positive integer in sequence space.
- `MAX_SNAPSHOT_LABEL_LENGTH` (128) — the label cap enforced on write.

From [`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts) (lines 101–116): the writer sets `sequence = currentSequence + 1` and `payload.log_position = sequence`, so **`log_position === sequence`** for every snapshot event. Ordering by `sequence ASC` is therefore identical to ordering by `logPosition ASC` — the read helper orders by the indexed `sequence` column and the result is chapter order.

From [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) (`canSeeSession`, lines 167–178): the async `public OR host OR participant (incl. historical)` predicate. Reused verbatim — a session's snapshots are exactly as visible as the session itself. The visibility decision and its existence-leak rationale are recorded in [`list_sessions_endpoint.md`](./list_sessions_endpoint.md), [`get_session_endpoint.md`](./get_session_endpoint.md), and [`get_session_log.md`](./get_session_log.md).

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts): `ApiError.notFound(...)` → 404 `not-found`, used for both "session absent" and "session invisible" (single phrasing, existence-leak rule).

From the `session_events` migration ([`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql)): `(id, session_id, sequence, kind, actor, payload, created_at)`; `'snapshot-created'` is in the `kind` CHECK constraint, and the `(session_id, kind)` index (`session_events_session_kind_idx`, noted in [`get_session_log.md`](./get_session_log.md) open questions) makes the `kind`-filtered read cheap — no full-log scan.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md): events are schema-validated on write; on read the rows are trusted and not re-parsed in the hot path. From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): Vitest covers the helper + handler; Cucumber+pglite covers the end-to-end query against the migrated schema.

## Constraints / requirements

- **Endpoint**: `GET /api/sessions/:id/snapshots`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Path param**: reuse `sessionIdParamsSchema` — `:id` must be a UUID; non-UUID → 400 `validation-failed` before the handler runs.
- **Query string**: none for v1 (no pagination, no filter — see Decisions). A `schema.querystring` with `additionalProperties: false` and no properties rejects unknown query params with 400.
- **Visibility gate** — `if (!(await canSeeSession(pool, id, request.authUser.id))) throw ApiError.notFound(...)`. Runs **before** the snapshots read; zero visibility → 404 (id unused or exists-but-invisible — indistinguishable from outside).
- **Read**: `readSessionSnapshots(pool, { sessionId: id })`:

  ```sql
  SELECT id, sequence, payload, created_at
  FROM session_events
  WHERE session_id = $1 AND kind = 'snapshot-created'
  ORDER BY sequence ASC
  ```

  Map each row → `SnapshotRecord`: `snapshotId = payload.snapshot_id`, `label = payload.label`, `logPosition = payload.log_position`, `createdAt = created_at` (ISO-8601, normalized as in `rowToEvent`). The on-disk payload is trusted (validated on write per ADR 0021) — **no per-row Zod re-parse.**

- **Ordering**: ascending by `sequence` (≡ `logPosition`, since `log_position === sequence`). This is chapter order — the order a snapshot-list UI and the replay primitive's `snapshotPositions` both expect.

- **Response shape** — 200 + JSON body:

  ```json
  {
    "snapshots": [
      { "snapshotId": "<uuid>", "label": "<string>", "logPosition": 7, "createdAt": "<iso-8601>" }
    ]
  }
  ```

  `snapshots` is a `SnapshotRecord[]` (the camelCase projection-type shape), ordered ascending by `logPosition`. The wrapper object (rather than a bare array) matches the `{ events, nextCursor }` envelope style of the sibling endpoint and leaves room for a future `nextCursor`/`headPosition` field without a breaking shape change.

- **Empty list is 200, not 404.** A visible session with no snapshots (the common case — most sessions are never snapshotted) returns `{ "snapshots": [] }`. 404 is reserved for the session itself being absent/invisible.

- **Status codes**:
  - 200 — visible session; a (possibly empty) list of snapshot markers.
  - 400 — `:id` not a UUID, or an unknown query param (`validation-failed`).
  - 401 — unauthenticated (`auth-required`, middleware-owned).
  - 404 — session does not exist OR exists but not visible (`not-found`, single phrasing for both).
  - 500 — DB error or unhandled exception.

- **Pool injection contract** — unchanged; the route lives on the existing `replayRoutesPlugin`, which already resolves the pool lazily.

- **OpenAPI** — register a shared `SnapshotRecord` element schema (`$id: 'SnapshotRecord'`) and a `SessionSnapshotsResponse` wrapper schema (`$id: 'SessionSnapshotsResponse'`, `{ snapshots: SnapshotRecord[] }`), `$ref`-ed from the route's `schema.response[200]`, mirroring the events schemas (routes.ts lines 48–145). Tag the route `['snapshots']` (or `['replay']`); `security: [{ cookieAuth: [] }]`.

- **Test layers per ADR 0022**:
  - **Vitest** (`events/read.test.ts`) — helper cases: returns snapshots ascending by `sequence`; maps `payload.snapshot_id`/`label`/`log_position` → camelCase record; normalizes `created_at`; ignores non-`snapshot-created` events (a session with proposals/votes but no snapshots → `[]`); empty session → `[]`.
  - **Vitest** (`replay/routes.test.ts`) — handler cases via `.inject()`: authenticated + visible with snapshots → 200 + ascending records; visible with none → 200 + `{ snapshots: [] }`; no auth → 401; unknown id → 404; private not visible → 404 (NOT 403); private visible to host → 200; private visible to participant → 200; non-UUID path → 400.
  - **Cucumber+pglite** (`list-session-snapshots.feature`) — end-to-end against the migrated schema: a visible session with two labeled snapshots returns both in `logPosition` ascending order with their labels; a visible session with no snapshots returns `{ snapshots: [] }`; a private session is NOT visible to a non-participant → 404; an unknown id → 404. **This is the protocol-seam pin required by the backend e2e policy** — the endpoint crosses the HTTP/replay boundary, so Vitest-only is insufficient.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, including the new `events/read.test.ts` and `replay/routes.test.ts` cases.
- `pnpm run test:behavior:smoke` (Cucumber) green, including the new `list-session-snapshots.feature` scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` lists `GET /sessions/{id}/snapshots` tagged appropriately with the `cookieAuth` security requirement and a 200 response describing `{ snapshots: SnapshotRecord[] }`.
- Per the [README ritual](../README.md#task-completion-ritual), the exact before/after Vitest and Cucumber totals are recorded in the `## Status` block on completion; this refinement intentionally does not hard-code baseline counts (they drift between authoring and implementation).

## Decisions

- **List by direct snapshot-event read, not by loading the full projection.** Three approaches surveyed:
  - **Filtered read of `kind = 'snapshot-created'` events, mapped to `SnapshotRecord`** (chosen). A snapshot event is fully self-describing (`snapshot_id`, `label`, `log_position` in the payload; `createdAt` in the envelope), so the marker list is directly derivable from the events with no projection step. The `(session_id, kind)` index makes the read cheap and bounded by snapshot count, not log length. This reuses the `events/read.ts` seam and matches the "raw read, project elsewhere" separation the sibling `get_session_log` established.
  - **Load the whole log, project it, return `projection.snapshots()`** (rejected). Correct but wasteful: it reads and replays the entire event log and instantiates the projection engine purely to enumerate markers that the snapshot events already carry verbatim. The projection's snapshot map is the right structure for a *live* WS session that already holds a projection; it is the wrong tool for a stateless HTTP list.
  - **A dedicated snapshots table** (rejected — and already foreclosed). `data_and_methodology.event_types.snapshot_events` decided snapshots are regular events with no separate table; introducing one here would contradict a settled decision and duplicate state.

- **No pagination for v1 (return all snapshots).** Unlike the sibling `get_session_log`, which paginates because an event log is unbounded, snapshots are **sparse** moderator-created chapter markers — a handful per session even for a long debate. This is the same reasoning `list_sessions` used to defer pagination (a small, bounded list). Returning the full set in one response keeps the contract simple and lets the snapshot-list UI render chapters without a paging loop. If a session is ever found to accrue a pathological number of snapshots, a `?after`/`?limit` cursor can layer on later using the same `sequence` key without breaking the `{ snapshots: [...] }` wrapper — which is precisely why the response is a wrapper object, not a bare array.

- **Order by `logPosition` (≡ `sequence`) ascending — chapter order.** `log_position === sequence` for every snapshot event by construction (`createSnapshot.ts` lines 101–116), so the helper orders by the indexed `sequence` column and the result is identical to position order. This matches `snapshot-resolution.ts`'s `snapshotPositions` (ascending positions) and is the order a chapter-list UI reads top-to-bottom. `createdAt` ordering was not considered separately — `sequence` is the ordering authority across the whole event model; `createdAt` is audit metadata only.

- **`snapshotId` is the response's canonical key; the envelope `id` is not exposed.** The snapshot-resolution layer already settled that the canonical snapshot key is `snapshotId` (a UUID), not `label` — labels carry no uniqueness guarantee. The list returns `snapshotId` for consumers (the jump-to-snapshot action keys on it) and omits the envelope-level `id`, which is an internal event identity with no consumer use here. The element shape is exactly the existing `SnapshotRecord` (`projection/types.ts` 314–319) — no response-specific DTO is introduced.

- **Add the route to the existing `replayRoutesPlugin`; add the helper to the existing `events/read.ts`.** Both seams were built by `get_session_log` precisely to host this family (the plugin's lead comment names `list_snapshots` as a planned sibling, routes.ts line 15). Extending them — rather than creating a parallel plugin or module — is the reuse the predecessor refinement set up, keeps all four replay endpoints in one place, and lets `get_snapshot` (the next sibling, depends `!list_snapshots`) reuse the same `readSessionSnapshots` helper.

- **Reuse `canSeeSession`; do NOT inline visibility SQL.** A session's snapshots are exactly as visible as the session itself — the same gate, byte-identical 404 path, as `get_session_log`. The two-step gate (visibility check, then read) keeps the snapshots query trivial; the single-query `visibilityWhereFragment` form remains available if profiling ever shows the extra round-trip matters.

- **Trusted read, no Zod re-parse (ADR 0021).** The `payload` JSON was validated against `snapshotCreatedPayloadSchema` on write; on read the helper reads `payload.snapshot_id`/`label`/`log_position` directly and maps to the record. No per-row re-validation in the read path — cost for no safety gain on data the server itself wrote.

## Open questions

- **`headPosition` / current max `sequence` in the response.** A snapshot-list UI rendering a scrubber with chapter markers might want the session's current head position to place the markers proportionally. Deferred — the wrapper-object response shape accommodates adding it later (a single `MAX(sequence)` alongside the gate) without a breaking change; no current consumer needs it for a plain chapter list.
- **`get_snapshot`'s `:label` path param vs. label non-uniqueness.** The next sibling endpoint is specified as `GET /sessions/:id/snapshots/:label`, but the snapshot model's canonical key is `snapshotId`, and labels are not guaranteed unique. Reconciling that (resolve-by-label-returning-most-recent, switch the path to `:snapshotId`, or 409 on ambiguity) is **`get_snapshot`'s** decision, not this task's — flagged here only so its refinement picks it up. This task returns `snapshotId` so a by-id lookup is always available regardless of how `get_snapshot` resolves it.

## Status

**Done** — 2026-06-04.

- Added `readSessionSnapshots(executor, { sessionId })` to `apps/server/src/events/read.ts` — returns `SnapshotRecord[]` ordered by `sequence` ASC, mapping `snapshot-created` event payloads to the camelCase record shape.
- Added `GET /api/sessions/:id/snapshots` route to `apps/server/src/replay/routes.ts` — visibility-gated via `canSeeSession`, tagged `['replay']`, with `SnapshotRecord` / `SessionSnapshotsResponse` OpenAPI schemas and a `preValidation` hook that rejects any query param with 400 (Fastify's ajv silently strips rather than rejects, so a hook guard is needed for v1's no-querystring contract).
- Added Vitest helper cases to `apps/server/src/events/read.test.ts` — 3 cases: ascending+mapping, ignores non-snapshot events, empty session.
- Added Vitest handler cases to `apps/server/src/replay/routes.test.ts` — 9 cases: 200 ordered, 200 empty, 401, 404 unknown, 404 private-invisible, 200 host, 200 participant, 400 non-UUID, 400 unknown query.
- Added Cucumber feature `tests/behavior/backend/list-session-snapshots.feature` — 4 scenarios: ordered list, empty 200, private→404, unknown→404.
- Added Cucumber step definitions `tests/behavior/steps/backend-list-session-snapshots.steps.ts`.
- All 297 Cucumber scenarios / 2086 steps passed; 20/20 Vitest route cases and helper cases green.
