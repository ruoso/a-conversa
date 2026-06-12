# sd_schema — Schema: session start time + listing indexes

## TaskJuggler entry

`session_discovery.sd_schema` — defined in
[`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 26–30).
Back-link: this refinement expands the one-line note there.

Gates milestone **M11 `m_session_discovery`** (`tasks/99-milestones.tji`,
registered 2026-06-12). This is the first task in the milestone — the
foundation the list endpoints (`sd_api`) and discovery surfaces
(`sd_frontend`) build on.

## Effort estimate

1d (`effort 1d`, `allocate team`).

## Inherited dependencies

No `depends` declared in the `.tji` — this is the root of the
session-discovery tree. It builds on already-landed schema work rather than a
sibling refinement:

- **Settled** — `sessions` table exists with `created_at` / `ended_at`
  lifecycle markers and the `privacy` flag
  (`apps/server/migrations/0002_sessions.sql`; refinement
  `tasks/refinements/data-and-methodology/sessions_table.md`, Done 2026-05-10).
- **Settled** — `session_events` append-only log with a `(session_id, kind)`
  index (`apps/server/migrations/0010_session_events.sql`).
- **Settled** — `session-mode-changed` event kind for the lobby→operate
  transition, emitted by `POST /api/sessions/:id/start`
  (ADR 0028; migration `0013_session_events_session_mode_changed.sql`).
- **Settled** — node-pg-migrate forward-only migration tooling and the
  migration-safety linter (ADRs 0020 / 0034).

## What this task is

Add a queryable **session start time** to the read model and the indexes the
two discovery lists need, so that "My Sessions" and "Public Sessions" can sort
by start time and the public list can cheaply exclude unstarted sessions.

Concretely, a single forward-only migration that:

1. Adds `started_at TIMESTAMPTZ NULL` to `sessions`.
2. Backfills existing rows from their first `session-mode-changed → operate`
   event in `session_events`.
3. Adds a partial index supporting the public-list query (`privacy = 'public'
   AND started_at IS NOT NULL`, ordered `started_at DESC`).

Plus the **single writer** for the new column: the existing
`POST /api/sessions/:id/start` endpoint sets `started_at` in the same
transaction that appends the `session-mode-changed → operate` event, so the
go-forward invariant matches the backfill.

Topic search and the my-sessions ordering are addressed at the index/decision
level here (so the endpoints don't have to relitigate them) but the query
logic itself lives in `sd_api`.

## Why it needs to be done

The `sessions` table has **no started marker today** — lifecycle is
`created_at` / `ended_at` only, and the lobby→operate transition lives purely
in the event log (ADR 0028 added a projector field, not a SQL column). The
discovery feature's two product constraints both need a start time in the
relational read model:

- **Public Sessions lists only started, public sessions.** While a session is
  in lobby mode its id is the secret participants join with, so unstarted
  sessions must never be enumerable (the load-bearing lobby-secrecy rule in the
  `.tji` header). `started_at IS NOT NULL` is the started predicate, and it has
  to be indexable to back a paginated list.
- **Both lists sort by start time.** A column the database can `ORDER BY` (and,
  for the public list, index) is the read-model shape the endpoints need.

`sd_my_sessions_endpoint` and `sd_public_sessions_endpoint` (`depends
!!sd_schema`) both read this column; nothing downstream can be built until it
exists and is populated.

## Inputs / context

- **Current sessions schema** —
  `apps/server/migrations/0002_sessions.sql:29-69`. Columns: `id`,
  `host_user_id`, `privacy` (`TEXT` + CHECK `IN ('public','private')`),
  `topic`, `created_at`, `ended_at`. Indexes: `sessions_host_user_id_idx`
  on `(host_user_id)`; `sessions_public_idx` on `(created_at DESC) WHERE
  privacy = 'public'`. **No `started_at`.**
- **session_participants** — `apps/server/migrations/0003_session_participants.sql:39-91`.
  `role TEXT CHECK (role IN ('moderator','debater-A','debater-B'))`; partial
  unique indexes on active membership. (Consumed by `sd_my_sessions_endpoint`,
  not this task; noted for continuity.)
- **session_events log** — `apps/server/migrations/0010_session_events.sql`.
  Columns `id, session_id, sequence, kind, actor, payload JSONB, created_at`;
  index `session_events_session_kind_idx` on `(session_id, kind)` — the
  backfill query rides this index.
- **session-mode-changed event** — kind added in
  `apps/server/migrations/0013_session_events_session_mode_changed.sql`;
  payload schema
  `packages/shared-types/src/events.ts:685-692`
  (`{ previous_mode, new_mode, changed_by, changed_at }`, modes
  `'lobby' | 'operate'`).
- **The start endpoint (single writer)** — `POST /api/sessions/:id/start` in
  `apps/server/src/sessions/routes.ts` (handler ~line 1955; transactional
  block ~2045–2103). Host-only, idempotent on re-POST, allocates
  `MAX(sequence)+1`, `validateEvent` → `appendSessionEvent` → post-commit
  broadcast. This is where the `started_at` write hooks in.
- **Existing Cucumber pin for the start path** —
  `tests/behavior/backend/session-start.feature` (happy path, non-host
  rejection, idempotent re-POST, ended/invisible rejection; established by
  ADR 0028). The new `started_at` scenarios extend this surface.
- **Migration tooling** — runner `apps/server/scripts/migrate.ts`
  (`direction: 'up'`, `singleTransaction: true`, `checkOrder: true`);
  `make migrate` / `pnpm run migrate`; safety linter `scripts/lint-migrations.ts`
  via `pnpm run lint:migrations` (wired into `pnpm run check`).
- **ADRs** — 0016 (Postgres `16-alpine`, **no extensions in v1**), 0020
  (forward-only migrations), 0021 (event envelope), 0022 (no throwaway
  verifications / test layering), 0028 (`session-mode-changed`), 0029
  (anonymous public-session access scope), 0034 (migration-safety /
  backward-compatibility invariant), 0045 (replay visibility).
- Next migration number: **`0018`** (last is
  `apps/server/migrations/0017_edges_polymorphic_endpoints.sql`).

## Constraints / requirements

- **Forward-only** (ADR 0020): one `.sql` migration, no down section, plain
  `CREATE INDEX` (the runner is single-transaction; `CONCURRENTLY` cannot run
  inside a transaction — matches the pattern in `0002_sessions.sql`).
- **Backward-compatible** (ADR 0034): the immediately previous deployed image
  must tolerate the change. `ADD COLUMN ... NULL`, `CREATE INDEX`, and a
  backfill `UPDATE` all satisfy this (the prior image ignores a nullable column
  it never reads or writes). The migration must pass `pnpm run lint:migrations`
  with **no** escape-hatch marker — none of the linter's flagged patterns
  (drop/rename/alter-type/set-not-null/add-not-null-without-default/truncate)
  apply.
- **No new Postgres extension** (ADR 0016): the migration must not require
  `pg_trgm` or full-text search; enabling either needs a superseding ADR and is
  out of scope (see Decision D4).
- **Lobby-secrecy invariant**: `started_at` must be the single
  authoritative started-predicate for the public list. It is NULL for lobby
  (unstarted) sessions and non-NULL exactly when a `session-mode-changed →
  operate` event exists for the session — true for both backfilled rows and
  go-forward writes.
- **The event log stays the source of truth**: `started_at` is a maintained
  read-model projection, written in the same transaction as the event it
  mirrors (never independently settable by an API caller).

## Acceptance criteria

Per ADR 0022, every check below lands as a committed test at the right layer;
no ad-hoc `psql`/`node -e` probes. This task crosses the DB and protocol seam,
so the load-bearing pins are **Cucumber** (behavior, pglite per ADR 0007 /
0022) — Vitest alone is not sufficient here.

1. **Migration `0018_sessions_started_at.sql`** exists and, applied via the
   runner against the compose stack (`make migrate`), cleanly:
   - adds `started_at TIMESTAMPTZ NULL` to `sessions`;
   - creates partial index `sessions_public_started_idx ON sessions
     (started_at DESC) WHERE privacy = 'public' AND started_at IS NOT NULL`;
   - backfills `started_at` from the earliest `session-mode-changed → operate`
     event's `created_at` per session.
2. **`pnpm run lint:migrations` passes** for the new migration with no
   escape-hatch comment (ADR 0034).
3. **Backfill behavior** (Cucumber, e.g.
   `tests/behavior/migrations/sessions-started-at-backfill.feature`): given a
   session row with a historical `session-mode-changed → operate` event and
   `started_at IS NULL`, after the migration its `started_at` equals that
   event's `created_at`; a session with no such event keeps `started_at NULL`.
4. **Go-forward write** (Cucumber, extending
   `tests/behavior/backend/session-start.feature`):
   - a freshly created (lobby) session has `started_at IS NULL`;
   - `POST /api/sessions/:id/start` sets `started_at` non-NULL in the same
     transaction as the operate event;
   - an idempotent re-POST does **not** move `started_at` (set-once on the
     lobby→operate transition).
5. **`pnpm run check` green** (build + lint + unit + behavior). Test output is
   redirected to a file and inspected via an Explore sub-agent per the project
   test-output convention; no raw inline dumps.
6. tj3 parse stays clean — the **closer** adds `complete 100` and the `##
   Status` block; the implementer does not edit the `.tji`.

This is a backend/schema task, **not** a UI-stream task, so the
moderator/participant/audience Playwright e2e policy does not apply here; the
discovery flows' Playwright coverage lands in `sd_e2e`.

## Decisions

**D1 — Denormalized indexed `started_at` column, not query-time derivation
from the event log.**
Chosen: a `TIMESTAMPTZ NULL` column on `sessions`, mirroring the existing
`ended_at` nullability pattern (NULL ⟺ not-yet-started). *Alternative
rejected:* derive started state per query by scanning `session_events` JSONB
(`payload->>'new_mode' = 'operate'`). Rejected because the public list needs an
*indexable* `started_at IS NOT NULL ... ORDER BY started_at DESC` predicate;
a per-query event-log scan can't be cheaply indexed and would couple every
listing query to the append-only log. A maintained read-model column is the
right shape — the event log stays the source of truth (D2 keeps them in sync).

**D2 — Fold the single writer into this task (the start endpoint sets
`started_at`), rather than a separate wiring task.**
Chosen: `POST /api/sessions/:id/start` (`apps/server/src/sessions/routes.ts`)
gains an `UPDATE sessions SET started_at = NOW()` inside the existing
transaction that appends the `session-mode-changed → operate` event, written
only on the lobby→operate transition (the endpoint is already idempotent, so a
re-POST that short-circuits emits no event and touches no column). *Alternative
rejected:* keep `sd_schema` pure DDL+backfill and register a separate
`sd_started_at_write` task. Rejected because the column is meaningless — and
the public list silently broken for every session created after deploy — until
its writer exists; the column ⟺ event invariant is best owned by the task that
introduces the column, and the change is ~3 lines in one existing transaction
plus a Cucumber scenario. (The predecessor "pure DDL" schema tasks each fed a
brand-new endpoint built by its own task; here the writer already exists, so
the coupling is the simpler seam.)

**D3 — Backfill from `session_events.created_at` (server clock), not
`payload.changed_at` (actor clock).**
Chosen:
`UPDATE sessions s SET started_at = e.first_op FROM (SELECT session_id,
MIN(created_at) AS first_op FROM session_events WHERE kind =
'session-mode-changed' AND payload->>'new_mode' = 'operate' GROUP BY
session_id) e WHERE e.session_id = s.id;`. *Rationale:* `created_at` is the
server insert clock — monotonic with `sequence` and the same source the
go-forward `NOW()` write (D2) approximates, so backfilled and new rows are
consistent. `payload.changed_at` is the actor's reported time and can skew;
it's wire self-description, not the read-model clock. Rides the existing
`session_events_session_kind_idx`.

**D4 — Topic search is plain `topic ILIKE '%q%'`, no trigram / no full-text,
no new index.**
Chosen: leave topic search to a sequential `ILIKE` post-filter in the list
endpoints; add no topic index here. *Rationale:* ADR 0016 bars Postgres
extensions in v1 — `pg_trgm` would need `CREATE EXTENSION` and a superseding
ADR. `topic` is short free text, and both lists already bound their candidate
set before the topic filter applies (the public list via the partial index;
my-sessions via membership), so an `ILIKE` over a small filtered set is
adequate at v1 scale. *Alternative rejected:* a `pg_trgm` GIN index — premature
(new extension + ADR for unproven load). A future trigram index is genuinely
perf-gated work, not schema work to do now; it is **not** registered as a WBS
task (it would be picked up and force-enable the extension against this
decision) — it is surfaced to the parking lot instead.

**D5 — One new index (public-list partial); no dedicated my-sessions index;
keep the existing `sessions_public_idx`.**
Chosen: add only `sessions_public_started_idx ON sessions (started_at DESC)
WHERE privacy = 'public' AND started_at IS NOT NULL`, mirroring the existing
`sessions_public_idx` shape. *My-sessions* needs no new index: its candidate
set is bounded by host/participant membership (covered by
`sessions_host_user_id_idx` and the `session_participants` indexes), and the
start-time sort (`NULLS FIRST, started_at DESC` — lobby rows to the top) runs
in-memory over that small per-user set. The legacy `sessions_public_idx`
(`created_at DESC`) is left in place — forward-only, harmless, and dropping an
index is needless churn.

**D6 — Plain `CREATE INDEX` inside the single-transaction migration.**
Chosen: non-concurrent `CREATE INDEX`, consistent with `0002_sessions.sql`.
*Rationale:* the node-pg-migrate runner wraps each migration in one transaction
(ADR 0020), and `CREATE INDEX CONCURRENTLY` cannot run in a transaction; the
brief lock is acceptable at pre-MVP table sizes.

**D7 — No anonymous-access or replay-visibility change in this task.**
The lobby-secrecy and visibility predicates (`canSeeSessionAnonymously` per
ADR 0029, `canReplaySessionAnonymously` per ADR 0045) are enforced by the
endpoints that read this column, not by the schema. This task only provides the
`started_at` predicate they filter on; it adds no new visibility rule and
touches no ADR text, so no amendment pass is owed here (the `sd_docs` task
handles any ADR 0029 amendment for the discovery surfaces).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- Added `started_at TIMESTAMPTZ NULL` to `sessions` table and created partial index `sessions_public_started_idx` — `apps/server/migrations/0018_sessions_started_at.sql`.
- Backfill from earliest `session-mode-changed → operate` event's `created_at` per session runs in the same migration (rides `session_events_session_kind_idx`).
- `POST /api/sessions/:id/start` (`apps/server/src/sessions/routes.ts`) sets `started_at = NOW()` in the same transaction as the operate event; idempotent re-POST does not move the value.
- Cucumber scenario for go-forward write added to `tests/behavior/backend/session-start.feature` + `tests/behavior/steps/backend-session-start.steps.ts`.
- Backfill behavior pinned in `tests/behavior/migrations/sessions-started-at-backfill.feature` + `tests/behavior/steps/sessions-started-at-backfill.steps.ts`.
- pglite migration support updated in `tests/behavior/support/migrate.ts`.
- Mock-pool handler for `SET started_at = NOW()` added in `apps/server/src/sessions/routes.test.ts` (fixer: missing branch caused 500 in Vitest suite).
