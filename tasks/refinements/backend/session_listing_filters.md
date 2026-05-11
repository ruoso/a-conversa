# `GET /sessions` filters — host, participant, privacy, topic, pagination

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.session_management.session_listing_filters`
**Effort estimate**: 1d
**Inherited dependencies**:

- `backend.session_management.list_sessions_endpoint` — settled ([`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts), [`tasks/refinements/backend/list_sessions_endpoint.md`](./list_sessions_endpoint.md)). The visibility-gated `GET /sessions` lives there with the `{ sessions: SessionResponse[] }` wrapper shape; this task layers additional query params on top of that gate.
- `data_and_methodology.schema.sessions_table` — settled. `host_user_id`, `privacy`, `topic`, `created_at`, `ended_at` are the column surface we filter against.
- `data_and_methodology.schema.session_participants_table` — settled. The participant filter joins against `session_participants` (existence-style — historical rows count, same shape as the visibility gate).

## What this task is

Last sibling under `backend.session_management`. Extends the existing `GET /sessions` endpoint with finer-grained query params that **narrow within** what the caller is already permitted to see. The visibility gate landed by `list_sessions_endpoint` stays in place; the filters are AND-composed on top.

The filter set:

- `?host=<userId>` — only sessions hosted by the given user id. UUID-validated at the schema layer.
- `?participant=<userId>` — only sessions where the given user id is a current or historical participant. EXISTS-style join, same shape as the visibility gate's participant branch (past participants count — once you were a participant you've seen the session).
- `?privacy=public|private` — narrow to a single privacy bucket. Enum-validated.
- `?topic=<substring>` — case-insensitive substring match on the topic column (ILIKE for v1; full-text-search deferred to a future task).
- `?limit=<n>` — page size, default 50, max 200. Integer-coerced + range-validated at the schema layer.
- `?offset=<n>` — page offset, default 0. Integer-coerced + range-validated at the schema layer.

The response shape grows from `{ sessions: SessionResponse[] }` to `{ sessions: SessionResponse[]; total: number }`. The `total` is the count of rows within visibility + filters BEFORE limit/offset — i.e. "how many would the caller see if they paged all the way through?" The wrapper key was added in `list_sessions_endpoint` for exactly this future; clients that destructure `{ sessions }` continue to work, and clients that want pagination metadata read `total` alongside.

## Why it needs to be done

- **Lobby UIs (moderator + participant) need filters.** `tasks/40-moderator-ui.tji` and `tasks/50-participant-ui.tji` consume `GET /sessions` to render a session-picker. A user with even a few dozen sessions in their history can't usefully scroll an unfiltered list; the picker needs "show me sessions hosted by X", "only active public sessions", and a topic search box.
- **Pagination is the cure for any future scale concern** raised in `list_sessions_endpoint`'s "Open questions" — the visibility-gated SELECT is fine for a single user's small history today, but a public-session-heavy DB grows the public branch unboundedly. Landing `limit`/`offset` before that scale arrives keeps the API contract stable.
- **It closes the `backend.session_management` sub-stream.** With this task the session-management endpoint surface (create / list / list-with-filters / get / end / privacy-toggle / participant-assign / participant-remove) is feature-complete for v1; downstream consumers can build against a stable shape.

## Inputs / context

From [`tasks/refinements/backend/list_sessions_endpoint.md`](./list_sessions_endpoint.md):

- The visibility-gate SQL (verbatim, this task does not change it):

  ```sql
  WHERE privacy = 'public'
     OR host_user_id = $1
     OR EXISTS (
          SELECT 1 FROM session_participants sp
          WHERE sp.session_id = sessions.id AND sp.user_id = $1
        )
  ```

- The response-shape decision: `{ sessions: SessionResponse[] }` was chosen as a wrapper-key shape "to grow (pagination cursor, total count, filter echo) without breaking the contract." This task is exactly the future that decision anticipated.

- The `?status=active|ended` query param is already on the endpoint (lifecycle filter on `ended_at IS NULL` / `IS NOT NULL`). This task does NOT touch it; the new filters compose with `status` orthogonally.

From [`apps/server/migrations/0002_sessions.sql`](../../../apps/server/migrations/0002_sessions.sql):

- `id UUID`, `host_user_id UUID`, `privacy TEXT` (CHECK `IN ('public','private')`), `topic TEXT`, `created_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ NULL`.
- Partial index `sessions_public_idx ON (created_at DESC) WHERE privacy = 'public'`. The dominant access path for "public sessions, newest first" is covered; the OR-branches fall back to sequential scans on the visibility set (small per user).
- No index on `topic`. ILIKE substring scans the visibility-gated set; for v1 the row counts are small enough this is fine. A future task may add a `pg_trgm` index or migrate to full-text-search.

From [`apps/server/migrations/0003_session_participants.sql`](../../../apps/server/migrations/0003_session_participants.sql):

- `(session_id, user_id, role, joined_at, left_at)` — the participant join target. The `?participant=<userId>` filter joins via EXISTS (mirrors the visibility gate's participant branch) so leave-and-rejoin's multiple-row supply doesn't duplicate the parent session row.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest for pure handler/query logic + Fastify `.inject()`; Cucumber+pglite for the end-to-end query against the migrated schema. Both layers grow here.

From [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — the existing handler at `app.get('/sessions', ...)`. The handler already:

- Reads `request.authUser.id` as `$1`.
- Builds a `lifecycleFilter` string from `?status` and concatenates it onto the WHERE clause.
- Executes one parameterized SELECT, maps rows to camelCase via `sessionRowToResponse`, returns `{ sessions: [...] }`.

This task extends the handler in place — same plugin, same schema id (`SessionListResponse`), same SELECT-then-map pattern; the schema gains new optional properties, the WHERE gains new conditional clauses, and a parallel COUNT(*) feeds the response's `total` field.

## Constraints / requirements

- **Endpoint**: `GET /sessions` (extending the existing handler — no new path).
- **Auth**: required. `preHandler: app.authenticate` (already on the route).
- **Query string** (JSON Schema, replacing the existing `listSessionsQuerystringSchema`):

  ```jsonc
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "status":      { "type": "string", "enum": ["active", "ended"] },
      "host":        { "type": "string", "format": "uuid" },
      "participant": { "type": "string", "format": "uuid" },
      "privacy":     { "type": "string", "enum": ["public", "private"] },
      "topic":       { "type": "string", "minLength": 1, "maxLength": 256 },
      "limit":       { "type": "integer", "minimum": 1, "maximum": 200, "default": 50 },
      "offset":      { "type": "integer", "minimum": 0, "default": 0 }
    }
  }
  ```

  Every filter is optional. `additionalProperties: false` rejects unknown keys with `validation-failed`. `limit` defaults to 50 and is capped at 200; `offset` defaults to 0. Integer coercion is enabled (Fastify's default ajv config) so `?limit=10` arrives as `10`.

- **Visibility gate stays in place.** The filters narrow WITHIN the visible set. The composed WHERE is conceptually:

  ```text
  ( <visibility-gate> )
    AND <lifecycle-filter?>
    AND host_user_id = <host?>
    AND EXISTS (... session_participants ... user_id = <participant?>)
    AND privacy = <privacy?>
    AND topic ILIKE <topic-pattern?>
  ```

  Filters omitted from the query string are omitted from the WHERE.

- **WHERE-composition pattern**: the handler accumulates SQL fragments AND a parameter array, tracking a positional `$N` counter. Each filter appended:

  ```ts
  const params: unknown[] = [userId];   // $1 is the visibility-gate caller id
  let p = 1;
  let where = `( /* visibility gate */ )`;
  if (status === 'active')  { where += ` AND ended_at IS NULL`; }
  if (status === 'ended')   { where += ` AND ended_at IS NOT NULL`; }
  if (host !== undefined)   { p++; params.push(host);        where += ` AND host_user_id = $${p}`; }
  if (participant !== ...)  { p++; params.push(participant); where += ` AND EXISTS (... sp.user_id = $${p})`; }
  if (privacy !== ...)      { p++; params.push(privacy);     where += ` AND privacy = $${p}`; }
  if (topic !== ...)        { p++; params.push(`%${topic}%`);where += ` AND topic ILIKE $${p}`; }
  // limit and offset appended last with positional placeholders:
  p++; params.push(limit);  const limitClause  = ` LIMIT  $${p}`;
  p++; params.push(offset); const offsetClause = ` OFFSET $${p}`;
  ```

  **No user-controlled string ever touches the SQL text.** Enum values (`status`, `privacy`) are validated at the schema layer and the WHERE fragments use hard-coded literals. UUID values flow through `$N` placeholders. The `topic` substring is wrapped in `%...%` and passed as a parameter — ILIKE evaluates the pattern at query time, so the `%` wildcards remain wildcards, but the captured substring is a value, not SQL.

- **`total` count via a parallel query**. The handler issues two queries (in either order; they don't need a transaction — READ COMMITTED with no concurrent writers visible to this caller's filter set is fine):

  ```sql
  -- Page query:
  SELECT id, host_user_id, privacy, topic, created_at, ended_at
  FROM sessions
  WHERE <composed-where>
  ORDER BY created_at DESC
  LIMIT $N OFFSET $M;

  -- Total query (same WHERE, same params except no LIMIT/OFFSET):
  SELECT COUNT(*)::int AS total
  FROM sessions
  WHERE <composed-where>;
  ```

  The total reflects the count of rows visible to the caller AFTER the filters but BEFORE the limit/offset — the canonical "how many rows match my query overall?" pagination semantics. Bigint-narrowing concern: `COUNT(*)` is bigint; the `::int` cast caps the value at 2^31 (~2.1B) which is fine for any plausible per-user filter set. (If we ever ship admin endpoints that return DB-wide totals, this cast becomes the wrong choice; today it's correct.)

- **`SessionListResponse` schema extension**: add `total` as a required `integer >= 0`. The shape was designed for this growth; adding a required field is a breaking change in the strict-additivity sense, but no consumer has been built yet against the endpoint (only the test layers), and the shape is documented through OpenAPI so generated clients regenerate.

  ```jsonc
  {
    "$id": "SessionListResponse",
    "type": "object",
    "required": ["sessions", "total"],
    "additionalProperties": false,
    "properties": {
      "sessions": { "type": "array", "items": { "$ref": "SessionResponse#" } },
      "total":    { "type": "integer", "minimum": 0, "description": "..." }
    }
  }
  ```

- **Ordering**: unchanged — `ORDER BY created_at DESC`. With pagination, ties become observable, but `created_at` is `TIMESTAMPTZ` at NOW() microsecond resolution and intra-tie ordering is astronomically unlikely for a single user's list. If a future bug surfaces from tie-ordering, the cure is `ORDER BY created_at DESC, id DESC` — the cost is negligible. We leave this as a deliberate v1 simplification.

- **Status codes** (unchanged from `list_sessions_endpoint`):
  - 200 — successful query (possibly empty `sessions` array; `total === 0`).
  - 400 — invalid query string (bad UUID, out-of-range limit, bad enum, etc.).
  - 401 — unauthenticated.
  - 500 — DB error.

- **Module shape**: extend the existing handler in [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts). Update the schema constant, the handler body, and the `sessionListResponseSchema` declaration in place. No new files.

- **Test layers per ADR 0022**:
  - **Vitest** — ~10 new cases covering each filter individually, filter combinations, pagination behavior, and bad-param rejection.
  - **Cucumber+pglite** — 4 scenarios covering host filter, participant filter under the visibility gate, pagination + total, and topic substring case-insensitive match.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; new cases bring the total from 799 to 809 (+10).
- `pnpm run test:behavior:smoke` (Cucumber) green; new feature adds 4 scenarios (155 → 159).
- `make test` green end-to-end.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.
- Generated OpenAPI document at `/docs/json` carries the extended `GET /sessions` querystring schema AND the `SessionListResponse` shape with the `total: integer` property.

## Decisions

- **Filter set scope: host + participant + privacy + topic + limit + offset.** Pulled directly from the WBS task title ("Filter session list by participant / privacy / status") plus the `list_sessions_endpoint` refinement's Open Questions (pagination strategy, host filter ergonomics). Three rejected expansions:
  - **`?role=moderator|debater-A|debater-B`** — "show me sessions where I'm the moderator." Useful but composes oddly with `?participant=<userId>` (the participant filter is already user-id-anchored; adding role would either redefine participant to mean "is participant in role R" or require a separate `?myRole` axis). Deferred until a concrete UI surface asks for it.
  - **`?since=<iso>` / `?until=<iso>`** — date-range filter. The `created_at DESC` order + pagination already lets a client window by scrolling; an explicit date range is a future ergonomic improvement, not a v1 requirement.
  - **`?q=<full-text>` instead of `?topic=<substring>`** — full-text-search across topic + (future) participant screen names + (future) tags. Real value at scale; out of scope here. The `topic` ILIKE is the minimum useful surface that doesn't lock in a v1 anti-pattern (a future FTS migration will replace `topic ILIKE` with `to_tsvector(topic) @@ plainto_tsquery($N)` — same handler shape, different SQL).

- **Filter composition: AND, not OR.** Two alternatives surveyed:
  - **AND** (chosen). Every filter is a narrowing; combining "host=X" with "privacy=public" means "public sessions hosted by X". Matches user mental model of search ergonomics (refinement progressively narrows).
  - **OR with explicit grouping** (rejected). Requires a query-string DSL for boolean composition; opens parsing/precedence questions that have no v1 demand. If a future use case needs OR (e.g. "sessions hosted by X OR participated in by Y"), it lands as a separate task with a thought-through DSL — not bolted onto AND-composition with magic key suffixes.

- **Visibility gate stays in place; filters narrow within it.** Two alternatives surveyed:
  - **Visibility gate always applies** (chosen). A caller asking `?host=<other-user>` sees ONLY the matching sessions they would already be allowed to see — public sessions hosted by that user, plus private sessions where the caller is also a participant. The filter does NOT lift the visibility gate; private sessions hosted by a third party remain invisible. This matches the architecture's source-of-truth model: the listing endpoint reads what the caller is permitted to see, full stop.
  - **`?host=me` shorthand bypasses participant check** (rejected). The visibility gate already admits the caller as host on their own sessions via the `host_user_id = $1` branch; a `?host=<callerId>` query naturally returns the host's full set including private sessions. No bypass needed.

- **`?topic=<substring>` uses ILIKE, not full-text-search, for v1.** Three alternatives surveyed:
  - **ILIKE on `topic` with `%substring%` pattern** (chosen). Single-line SQL change, no schema migration, no extension dependency. Case-insensitive by ILIKE semantics. Cost is a sequential scan over the visibility-gated set; for v1 row counts (hundreds at most per user) this is fine.
  - **`pg_trgm` + GIN index** (rejected). Faster substring search at scale, but requires a migration (CREATE EXTENSION pg_trgm + CREATE INDEX) and per-environment extension support (pglite supports pg_trgm via shim but production deploys would need it enabled). Worth doing when "fast substring search" is the bottleneck; today it isn't.
  - **`tsvector` full-text-search** (rejected). Most powerful, but requires a stored generated column or a query-time `to_tsvector(topic)`, plus a `tsquery` parser at the API boundary (`plainto_tsquery` vs `phraseto_tsquery` vs `websearch_to_tsquery`). Deferred to a future `backend.session_management.session_search` task when there's a UI surface that needs ranking/highlighting.

- **`limit` default 50, max 200; `offset`-based pagination.** Three alternatives surveyed:
  - **`limit` default 50 / max 200 + `offset`** (chosen). Conventional REST pagination; default page size is a UI-friendly cap that comfortably fills a session-picker; max 200 prevents accidental "give me everything" requests without an explicit override. Offset is simpler than cursor for v1 row counts.
  - **`limit` only, no offset** (rejected). Forces the client to filter creatively to walk pages; no path to "page 2" without changing filter values. Anti-pattern.
  - **Cursor-based pagination** (rejected for v1). `(created_at, id) >= ($prev_cursor)` is the stable form, but requires returning a cursor token in the response and demarshalling it on the next request. Justified at scale; over-engineered for hundreds of rows per user. The migration path is forward-compatible: a future task can add `?cursor=<token>` alongside `?offset=<n>` and deprecate the latter.

- **`total` is the count within visibility + filters, NOT the overall count.** Two alternatives surveyed:
  - **Filtered + visibility-gated count** (chosen). Matches the page query's WHERE clause; gives the client the right denominator for "showing 1-50 of N" page UI. The whole point of `total` for a paginated client is "how far can I page through THIS query".
  - **Unfiltered visibility-gated count** (rejected). Would tell the client "you can see N sessions total" regardless of the filter narrowing, which is the wrong number for a pagination UI and arguably leaks information (private sessions where the caller is a participant become countable even when the filter doesn't match them — fine for visibility-respecting queries but disorienting in a "pages 1-N" display).

- **Parameterized SQL only; positional `$N` counter.** Two alternatives surveyed:
  - **Manually-counted `$N` placeholders accumulated alongside params** (chosen). Direct, debuggable, no extra dependency. Mirrors the existing `lifecycleFilter` string-concat pattern in the same handler, scaled up to handle multiple conditionals.
  - **Query builder library** (rejected). knex / drizzle / kysely would simplify the composition, but the project has no SQL-builder convention yet and adopting one for one handler is over-investment. The hand-rolled pattern is small enough to read top-to-bottom.

- **`total` and the page query are separate SELECTs, not a window function.** Two alternatives surveyed:
  - **Two SELECTs** (chosen). One does the visibility + filters + COUNT(*); the other does visibility + filters + ORDER + LIMIT/OFFSET. The page query and count query share the WHERE construction (a single function builds the composed WHERE + params; the handler passes them to two queries). Simpler to reason about, simpler to test.
  - **`COUNT(*) OVER ()` window function** (rejected). Would let one query return both the rows AND the unfiltered count, at the cost of executing COUNT once per row (or relying on Postgres's deduplication; the planner may or may not). Marginal performance benefit at v1 row counts; meaningfully harder to read. Defer until a hot-path benchmark justifies it.

- **`additionalProperties: false` on the query schema rejects unknown filters.** Two alternatives surveyed:
  - **`additionalProperties: false`** (chosen). Adding a new query param is a deliberate API surface decision; silently accepting and ignoring `?random_typo=value` masks client bugs. Fastify's validator emits `validation-failed` with a clear message identifying the unknown key.
  - **`additionalProperties: true`** (rejected). Would let clients add arbitrary keys hoping they're recognized; produces confusing failures-as-no-ops when the server simply ignores the typo.

- **Empty `sessions` array + `total: 0` on no matches.** Same shape as `list_sessions_endpoint`'s empty case; the `total` field carries 0. No 404 — the listing resource exists, its current content is empty.

## Open questions

- **Index on `host_user_id` for the `?host=<userId>` filter** — currently there's no dedicated index. The partial public-index doesn't cover this branch. For v1 row counts the sequential scan is fine; if a future profile shows the host filter as a hot path, a B-tree on `(host_user_id, created_at DESC)` is the natural addition. Tracked here as a future-task seed, not a blocker.
- **`?participant=me` shorthand** — a future ergonomic ("show me sessions I'm a participant in") that maps to `?participant=<callerId>`. Deferred; the explicit form works today, and the shorthand can land later without breaking the explicit form.
- **Sort order beyond `created_at DESC`** — `?sort=` axis with `created_at`, `topic`, `ended_at` options. Deferred; the single fixed sort is the simplest answer until a UI surface asks for more.
- **Cursor-based pagination migration** — if/when v1's limit+offset proves insufficient (large session histories per user; admin/audit surfaces over the DB-wide row set), add a parallel `?cursor=<token>` axis and deprecate `?offset` over a release cycle. Tracked as a future task seed.

## Status

**Done** — 2026-05-10. Landed as:

- Handler + schema extension: [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — `GET /sessions` querystring schema gains `host`/`participant`/`privacy`/`topic`/`limit`/`offset` (all optional; UUID-validated where appropriate, enum-validated for `privacy`, range-validated for `limit`/`offset`). Handler accumulates a composed WHERE + a positional `$N` parameter array; the visibility gate stays at `$1` and each filter appends a fragment + a value. Two parallel SELECTs: the page (`ORDER BY created_at DESC LIMIT $N OFFSET $M`) and the count (`COUNT(*)::int`); both share the same WHERE up to the pagination placeholders. Response shape grows to `{ sessions, total }`.
- `SessionListResponse` schema gains a required `total: integer >= 0`; OpenAPI document carries the extended shape.
- Vitest unit tests: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — extended with the `GET /sessions — filters and pagination` describe block (11 cases): each filter individually (host, participant, privacy, topic), filter combinations (host AND privacy; topic AND limit), pagination behavior (limit + offset; total reflects unpaged count; empty match → total=0), and bad-param rejection (non-UUID host, out-of-range limit, bad privacy enum). The memory pool shim recognises the new SQL surface and disambiguates page vs. count queries.
- Cucumber+pglite scenarios: [`tests/behavior/backend/list-sessions-filters.feature`](../../../tests/behavior/backend/list-sessions-filters.feature) (4 scenarios) with step defs at [`tests/behavior/steps/backend-list-sessions-filters.steps.ts`](../../../tests/behavior/steps/backend-list-sessions-filters.steps.ts). Exercise host filter, privacy filter under the visibility gate, case-insensitive topic substring match, and limit+offset pagination + total against the migrated pglite schema.
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- **Test totals**: Vitest 799 → 810 (+11); Cucumber 155 → 159 (+4).
