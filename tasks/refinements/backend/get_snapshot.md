# `GET /sessions/:id/snapshots/:snapshotId` — fetch one snapshot marker

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.replay_endpoints.get_snapshot` (line 402)
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `backend.replay_endpoints.list_snapshots` — settled (sibling, **Done** 2026-06-04). The direct `.tji` dependency (`depends !list_snapshots`, line 405). It built both seams this task reuses verbatim: the `readSessionSnapshots(executor, { sessionId })` read helper in [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts) (lines 180–202) and the snapshots route + OpenAPI schemas on `replayRoutesPlugin` in [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts). It also **explicitly handed this task the by-`:label` reconciliation decision** — see [`list_snapshots.md`](./list_snapshots.md) Open questions, the second bullet. This refinement resolves it (Decisions §1).
- `backend.session_management` — settled. The visibility seam `apps/server/src/sessions/visibility.ts` (`canSeeSession`, lines 167–178). Inherited via the parent `replay_endpoints` block's `depends !session_management`.
- `data_and_methodology.replay_primitive` — settled. Inherited via the parent block's `depends data_and_methodology.replay_primitive`. This task does not project; it reads one snapshot marker from the events.
- `data_and_methodology.event_types.snapshot_events` — settled (transitively, via `replay_primitive`). The `snapshot-created` event kind and its payload schema (`snapshotCreatedPayloadSchema`, [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) lines 623–628): `{ snapshot_id: uuid, label: string (1–128), log_position: positive int }`.

## What this task is

Fourth and last sibling under `backend.replay_endpoints`. Lands the single-marker read: an authenticated user GETs a specific snapshot of a specific session and the server returns that one snapshot marker as a `SnapshotRecord` — `{ snapshotId, label, logPosition, createdAt }`. Where `list_snapshots` returns the whole chapter list, this returns one chapter by its canonical key. The read is gated by the same visibility predicate the session-metadata, event-log, and snapshot-list endpoints apply.

**The route resolves a snapshot by its `snapshotId` (a UUID), not by `:label`.** The `.tji` one-line title reads `GET /sessions/:id/snapshots/:label`, but a snapshot's `label` carries **no uniqueness guarantee** — `createSnapshot` ([`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts) lines 82–119) trims and length-checks the label but never dedupes, so a session can hold two snapshots both labeled `"Round 1"`. The canonical, unique key is `snapshotId` (minted per-snapshot, `createSnapshot.ts` line 102), which `list_snapshots` already returns in every record precisely so a by-id lookup is always available regardless of label collisions. This task therefore lands `GET /api/sessions/:id/snapshots/:snapshotId`. The path-param divergence from the `.tji` title is a deliberate correctness call (Decisions §1); both path segments are UUIDs.

A snapshot is **not** a separate table row — it is a regular `session_events` row with `kind = 'snapshot-created'` (settled by `data_and_methodology.event_types.snapshot_events`). Resolving one marker is therefore a filtered read of the snapshot-created events plus an in-memory match on `snapshot_id` — no projection, no separate store, no new SQL.

The artifact shape:

- **No new read helper.** The handler reuses the shipped `readSessionSnapshots(pool, { sessionId })` ([`read.ts`](../../../apps/server/src/events/read.ts) lines 180–202) and selects the matching record by `snapshotId` in memory. Snapshots are sparse (a handful per session), so reading the small set and `.find()`-ing one costs nothing measurable and reuses a helper already covered by Vitest + Cucumber (Decisions §2).
- **A new route on the existing `replayRoutesPlugin`** — `GET /api/sessions/:id/snapshots/:snapshotId` added to [`routes.ts`](../../../apps/server/src/replay/routes.ts), alongside the shipped `GET /api/sessions/:id/snapshots`. Visibility-gated via `canSeeSession`. A new two-param path schema (`id` + `snapshotId`, both UUID); the **200 response reuses the already-registered `snapshotRecordRef`** (`SnapshotRecord` schema, `routes.ts` lines 155–193) — no new response schema is introduced.
- **Vitest unit cases** — added to the existing [`apps/server/src/replay/routes.test.ts`](../../../apps/server/src/replay/routes.test.ts) (handler). No new `read.test.ts` cases — the helper is unchanged.
- **Cucumber + pglite feature** — `tests/behavior/backend/get-session-snapshot.feature` + `tests/behavior/steps/backend-get-session-snapshot.steps.ts` (new files), pinning the HTTP/replay protocol seam against the migrated schema.

## Why it needs to be done

- **Deep-linking / single-marker resolution.** A replay or snapshot-list UI that has a `snapshotId` (from a shared URL, a stored bookmark, or a prior list response) needs to resolve that one marker — its `label` and `logPosition` — without loading and scanning the whole chapter list. This endpoint is that resolution surface.
- **`replay_test.snapshots.snapshot_jump_ui`** ("Snapshot jump", [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji)) jumps replay to a marker's `logPosition`. The list view already holds the full record set after `list_snapshots`, so the *list*-driven jump needs no per-marker fetch; this endpoint serves the **deep-link** path — arriving at a session URL that names a single snapshot and resolving it before the list (if any) is loaded.
- **Closes the `replay_endpoints` family.** This is the last of the four siblings (`get_session_log`, `get_at_position`, `list_snapshots`, `get_snapshot`); landing it completes the replay/history HTTP surface the plugin was built to host (`routes.ts` lines 13–20).

## Inputs / context

From [`apps/server/src/replay/routes.ts`](../../../apps/server/src/replay/routes.ts) (the plugin `list_snapshots` extended):

- `replayRoutesPluginAsync` (lines 305–505) — the plugin body; the new route is registered here, after the snapshots-list route (which ends at line 504). The `/api` path prefix and `preHandler: app.authenticate` pattern are reused verbatim.
- `snapshotRecordSchema` / `snapshotRecordRef` (lines 155–193) — the shared `SnapshotRecord` element schema with a stable `$id`. **Reused directly as the 200 response** — the single-marker body *is* one `SnapshotRecord`. The schema-registration idempotence guard (lines 313–324) already registers it; this route just `$ref`s it.
- `sessionIdParamsSchema` (lines 230–241) — the single-`:id` UUID path-param schema. This task needs a **two-param** schema (`id` + `snapshotId`), so it adds a sibling `sessionSnapshotParamsSchema` modeled on it (same `format: 'uuid'`, `additionalProperties: false` shape). A non-UUID in either segment → 400 `validation-failed` before the handler runs.
- `sessionSnapshotsQuerySchema` (lines 277–281) and the `preValidation` query-rejection hook (lines 429–442) — v1's no-query-string contract and the strip-not-reject workaround. **Reused verbatim**: Fastify's ajv runs `removeAdditional: true`, so an unknown query param is silently stripped rather than rejected; the route-scoped `preValidation` hook restores the 400 the contract requires. This task's route carries the same hook.
- The `request.authUser` defensive check (lines 476–483), the lazy-pool `ensurePool` pattern (lines 328–335), and the `canSeeSession` gate (lines 496–498) are all reused directly.
- `__buildTestReplayApp` (lines 532–558) — the test-harness builder; the new Vitest handler cases inject against it.

From [`apps/server/src/events/read.ts`](../../../apps/server/src/events/read.ts):

- `readSessionSnapshots` (lines 180–202) — returns `SnapshotRecord[]` ordered by `sequence` ASC, mapping each `snapshot-created` payload to the camelCase record. **Reused unchanged.** The handler calls it then `.find(r => r.snapshotId === snapshotId)`.

From [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) (lines 314–319): the `SnapshotRecord` interface — `{ snapshotId: string; label: string; logPosition: number; createdAt: string }`. This is the response shape (a single record, not an array).

From [`apps/server/src/methodology/handlers/createSnapshot.ts`](../../../apps/server/src/methodology/handlers/createSnapshot.ts) (lines 82–119): the writer validates `label` (trim, non-empty, ≤128) but performs **no uniqueness check** — labels are free text and may repeat within a session. It mints a fresh `snapshot_id` (line 102) per snapshot and sets `log_position = sequence` (lines 101, 114). This is the authority for "label is not a key; `snapshotId` is" (Decisions §1).

From [`apps/server/src/sessions/visibility.ts`](../../../apps/server/src/sessions/visibility.ts) (`canSeeSession`, lines 167–178): the async `public OR host OR participant (incl. historical)` predicate. Reused verbatim — a session's snapshots are exactly as visible as the session itself. The existence-leak rationale is recorded in [`list_sessions_endpoint.md`](./list_sessions_endpoint.md), [`get_session_endpoint.md`](./get_session_endpoint.md), [`get_session_log.md`](./get_session_log.md), and [`list_snapshots.md`](./list_snapshots.md).

From [`apps/server/src/errors.ts`](../../../apps/server/src/errors.ts): `ApiError.notFound(...)` → 404 `not-found`. Used for the session-absent / session-invisible case (single phrasing, existence-leak rule) **and** for the snapshot-not-found-within-a-visible-session case (a distinct message is acceptable there — see Decisions §3).

From [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts): `snapshotCreatedPayloadSchema` (lines 623–628) and the `'snapshot-created'` kind discriminator — the on-disk payload the helper maps. Validated on write (ADR 0021), trusted on read.

From [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md): events are schema-validated on write; on read the rows are trusted and not re-parsed. From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): Vitest covers the handler; Cucumber+pglite covers the end-to-end query against the migrated schema.

## Constraints / requirements

- **Endpoint**: `GET /api/sessions/:id/snapshots/:snapshotId`.
- **Auth**: required. `preHandler: app.authenticate`; 401 `auth-required` on any failure mode (middleware-owned).
- **Path params**: a new `sessionSnapshotParamsSchema` requiring `id` (UUID) and `snapshotId` (UUID), `additionalProperties: false`. A non-UUID in **either** segment → 400 `validation-failed` before the handler runs.
- **Query string**: none for v1. Reuse `sessionSnapshotsQuerySchema` (empty, `additionalProperties: false`) **and** the route-scoped `preValidation` hook that rejects any present query key with 400 — identical to `list_snapshots` (the ajv strip-not-reject gap is the same here).
- **Visibility gate** — `if (!(await canSeeSession(pool, id, request.authUser.id))) throw ApiError.notFound(...)`. Runs **before** the snapshots read. Zero visibility → 404 (id unused or exists-but-invisible — indistinguishable from outside, and indistinguishable from snapshot-not-found because the gate short-circuits before any snapshot lookup).
- **Resolve**: `const all = await readSessionSnapshots(pool, { sessionId: id }); const record = all.find((r) => r.snapshotId === snapshotId);`
  - `record === undefined` (no snapshot with that id in this *visible* session) → `throw ApiError.notFound('snapshot not found')`.
  - otherwise → 200 + the bare `SnapshotRecord`.
- **Response shape** — 200 + JSON body is one record:

  ```json
  { "snapshotId": "<uuid>", "label": "<string>", "logPosition": 7, "createdAt": "<iso-8601>" }
  ```

  This is exactly the `SnapshotRecord` element shape (`projection/types.ts` 314–319) — no wrapper object, no response-specific DTO. A single resource GET returns the resource itself (contrast `list_snapshots`'s `{ snapshots: [...] }` wrapper, which exists to leave room for collection-level fields). The `200` response `$ref`s the already-registered `snapshotRecordRef`.

- **Status codes**:
  - 200 — visible session **and** a snapshot with `:snapshotId` exists in it → the `SnapshotRecord`.
  - 400 — `:id` or `:snapshotId` not a UUID, or an unknown query param (`validation-failed`).
  - 401 — unauthenticated (`auth-required`, middleware-owned).
  - 404 — session absent/invisible (`not-found`, byte-identical to `list_snapshots`), **or** session visible but no snapshot with that id (`not-found`, message `'snapshot not found'`).
  - 500 — DB error or unhandled exception.

- **Existence-leak invariant** — the visibility gate runs first, so a caller who cannot see the session gets the **same** 404 whether or not the snapshot exists. The distinct `'snapshot not found'` message is reachable **only** after the session is confirmed visible to the caller, so it leaks nothing about a private session's contents.

- **OpenAPI** — register the route with `params: sessionSnapshotParamsSchema`, `querystring: sessionSnapshotsQuerySchema`, `response: { 200: snapshotRecordRef, '4xx': errorEnvelopeRef, '5xx': errorEnvelopeRef }`. Tag `['replay']` (matching `list_snapshots`); `security: [{ cookieAuth: [] }]`. No new schema is added to the schema store — `SnapshotRecord` is already registered.

- **Pool injection contract** — unchanged; the route lives on the existing `replayRoutesPlugin`, which resolves the pool lazily.

- **Test layers per ADR 0022**:
  - **Vitest** (`replay/routes.test.ts`) — handler cases via `.inject()`: authenticated + visible + snapshot exists → 200 + the matching record; visible session but `:snapshotId` is a valid UUID with no matching snapshot → 404 `not-found`; correct `:snapshotId` but a snapshot belonging to a *different* session is NOT returned (the `sessionId` filter is honored) → 404; no auth → 401; unknown `:id` → 404; private session not visible to caller → 404 (NOT 403, and indistinguishable from snapshot-not-found); private visible to host → 200; private visible to participant → 200; non-UUID `:id` → 400; non-UUID `:snapshotId` → 400; unknown query param → 400.
  - **Cucumber+pglite** (`get-session-snapshot.feature`) — end-to-end against the migrated schema: a visible session with a labeled snapshot, fetched by its `snapshotId`, returns that record with the right `label`/`logPosition`; a visible session queried with an unknown (well-formed) `snapshotId` → 404; a private session is NOT visible to a non-participant → 404; an unknown session `:id` → 404. **This is the protocol-seam pin required by the backend e2e policy** — the endpoint crosses the HTTP/replay boundary, so Vitest-only is insufficient.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green, including the new `replay/routes.test.ts` cases.
- `pnpm run test:behavior:smoke` (Cucumber) green, including the new `get-session-snapshot.feature` scenarios.
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` (closer adds the marker; this is the last leaf of `replay_endpoints` — closer also checks whether the parent `replay_endpoints` block / any milestone needs propagation per the [README ritual](../README.md#task-completion-ritual)).
- Generated OpenAPI document at `/docs/json` lists `GET /sessions/{id}/snapshots/{snapshotId}` tagged `replay` with the `cookieAuth` security requirement and a 200 response describing a single `SnapshotRecord` (the existing `components.schemas.SnapshotRecord`, **not** a new schema).
- Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), all coverage is permanent (Vitest + Cucumber); no throwaway scripts.
- Per the [README ritual](../README.md#task-completion-ritual), the exact before/after Vitest and Cucumber totals are recorded in the `## Status` block on completion; this refinement intentionally does not hard-code baseline counts (they drift between authoring and implementation).

## Decisions

- **§1 — Resolve by `:snapshotId` (UUID), not by `:label`.** The `.tji` title reads `:label`, but labels are not unique: `createSnapshot` (lines 82–119) validates a label's shape but never checks for collisions, so a single session can hold multiple identically-labeled snapshots. Four options were weighed:
  - **`:snapshotId` — resolve by the canonical UUID key** (chosen). `snapshotId` is unique by construction (`randomUUID()` per snapshot) and is already the key the snapshot-resolution layer and the `list_snapshots` response treat as canonical (`list_snapshots.md` Decisions, "`snapshotId` is the response's canonical key"). It is a UUID, so it reuses the exact UUID-format param-validation pattern (`format: 'uuid'` → clean 400), exactly like `:id`. A client lists chapters (which returns each `snapshotId`) then deep-links by id — an unambiguous two-step. `list_snapshots` deliberately returns `snapshotId` "so a by-id lookup is always available regardless of how `get_snapshot` resolves it" — this is the resolution it set up.
  - **`:label`, return the most-recent (highest-`sequence`) match** (rejected). Keeps the title's URL form and stays human-friendly, but silently hides older same-labeled snapshots, and a deep-link by label can resolve to a *different* snapshot after a relabel/new-snapshot — fragile for the share-a-URL use case. A list-driven jump already holds the precise `snapshotId`, so resolving by label only ever *loses* precision; it is strictly worse than by-id for every concrete consumer.
  - **`:label`, 409 on ambiguity** (rejected). Turns a routine read into a conflict the caller must special-case, for a key the system never promised to be unique. Pushes label-collision handling onto every consumer.
  - **`:ref` accepting either a UUID (→ id) or a string (→ label)** (rejected). Most flexible, but reintroduces the ambiguous label semantics for the string branch and adds discriminator branching for no consumer that needs it — over-engineered against the simpler-abstraction bias. (A label that happens to be a UUID string would also be unreachable.)

  The path divergence from the `.tji` title does not touch the WBS file (orchestrator/closer own `.tji` shape); it is surfaced in the return summary so the closer can align the title if desired. No ADR is warranted — this is a route-shape refinement consistent with the already-settled "`snapshotId` is canonical" decision, not a new architectural seam.

- **§2 — Reuse `readSessionSnapshots` + in-memory `.find`; do NOT add a targeted single-row SQL helper.** Two approaches:
  - **Read the (sparse) snapshot set via the existing helper, match `snapshotId` in memory** (chosen). Snapshots are a handful per session (the `list_snapshots` "sparse markers" reasoning), and the `(session_id, kind)` index already bounds the read to snapshot rows only. A targeted `WHERE ... AND payload->>'snapshot_id' = $2` would still scan the same `kind`-filtered rows (the JSON predicate is not indexed), so it offers no cost win — while reusing the already-tested helper adds zero new SQL, zero new test surface for the helper, and keeps both snapshot endpoints reading through one code path. This is the "reuse the existing seam, fewer call sites" bias.
  - **A new `readSessionSnapshot(executor, { sessionId, snapshotId })` doing a targeted single-row query** (rejected). Marginally more "honest" as a get-one, but functionally identical in cost (no index on the JSON key) and adds a second helper plus its own Vitest cases for no behavioral gain. If a session is ever found to accrue a pathological number of snapshots, this helper can be introduced later behind the same handler with no contract change.

- **§3 — Single-resource 200 returns the bare `SnapshotRecord`, not a wrapper.** `list_snapshots` wraps its array in `{ snapshots: [...] }` to leave room for future collection-level fields (e.g. `headPosition`). A single-resource GET has no such collection metadata, so it returns the resource directly — the idiomatic REST single-GET shape and exactly the existing `SnapshotRecord` schema, so the 200 response reuses `snapshotRecordRef` with no new schema. Snapshot-not-found within a *visible* session is a 404 with a distinct `'snapshot not found'` message; because the visibility gate runs first, that message is unreachable for a session the caller cannot see, so it does not weaken the existence-leak rule.

- **§4 — Reuse `canSeeSession`; do NOT inline visibility SQL.** A snapshot is exactly as visible as its session — the same gate, the same byte-identical 404 path, as `list_snapshots` and `get_session_log`. The two-step gate (visibility check, then read) keeps the query trivial.

- **§5 — Trusted read, no Zod re-parse (ADR 0021).** Inherited through `readSessionSnapshots`, which maps the on-write-validated payload directly. No per-row re-validation in the read path.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-04.

- Added `sessionSnapshotParamsSchema` (two-param UUID path schema) and the `GET /api/sessions/:id/snapshots/:snapshotId` route to `apps/server/src/replay/routes.ts`; visibility-gated via `canSeeSession`, resolves via `readSessionSnapshots` + in-memory `.find`, 200 `$ref`s the existing `snapshotRecordRef`.
- Added 11 Vitest handler cases to `apps/server/src/replay/routes.test.ts`: 200 match; valid-UUID-no-match 404; different-session filter 404; 401; unknown session id 404; private-not-visible 404≠403; host 200; participant 200; non-UUID `:id` 400; non-UUID `:snapshotId` 400; unknown query param 400.
- Created `tests/behavior/backend/get-session-snapshot.feature` (4 Cucumber scenarios: resolve-by-snapshotId, unknown-snapshotId 404, private-not-visible 404, unknown session 404) — protocol-seam pin required by backend e2e policy.
- Created `tests/behavior/steps/backend-get-session-snapshot.steps.ts` — step definitions for the feature.
- Route resolves by `:snapshotId` (UUID), not `:label`, per Decisions §1 (labels are not unique; `snapshotId` is canonical). The `.tji` title reads `:label`; the route lands at `:snapshotId` — deliberate correctness call.
- Closes the `replay_endpoints` sibling family (`get_session_log`, `get_at_position`, `list_snapshots`, `get_snapshot` all shipped).
