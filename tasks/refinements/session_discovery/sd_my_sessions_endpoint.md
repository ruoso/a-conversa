# sd_my_sessions_endpoint — GET /api/sessions/mine (authenticated, role-annotated)

## TaskJuggler entry

`session_discovery.sd_api.sd_my_sessions_endpoint` — defined in
[`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 34–39).
Back-link: this refinement expands the one-line note there.

Part of milestone **M11 `m_session_discovery`** (`tasks/99-milestones.tji`,
registered 2026-06-12). Sibling of `sd_public_sessions_endpoint` under the
`sd_api` group; both feed the `sd_frontend` discovery surfaces.

## Effort estimate

1d (`effort 1d`, `allocate team`).

## Inherited dependencies

`depends !!sd_schema`.

- **Settled** — `sessions.started_at TIMESTAMPTZ NULL` exists and is
  maintained: backfilled from the earliest `session-mode-changed → operate`
  event and written by `POST /api/sessions/:id/start` in the same transaction
  (`apps/server/migrations/0018_sessions_started_at.sql`; refinement
  `tasks/refinements/session_discovery/sd_schema.md`, Done 2026-06-12). NULL ⟺
  lobby (unstarted); non-NULL ⟺ started. This is the load-bearing predicate for
  the start-time sort and the lobby/started distinction.
- **Settled** — partial index `sessions_public_started_idx` exists but is
  scoped to `privacy = 'public'`; it does **not** serve this endpoint (whose
  candidate set is membership-bounded, not privacy-bounded — see D5 in
  `sd_schema.md` and D6 below).
- **Settled** — topic search is plain `topic ILIKE '%q%'`, no trigram / no
  full-text (sd_schema D4). This endpoint inherits that decision.

## What this task is

A new authenticated REST endpoint, `GET /api/sessions/mine`, that returns the
sessions the calling user is involved in — sessions they **host**
(`sessions.host_user_id = caller`) **OR** in which they **hold (or held) a
`session_participants` row** (moderator / debater-A / debater-B). Each returned
row is annotated with the caller's **role** in that session so the client can
route "join live" without a second request (moderator surface for host /
moderator, participant surface for a debater, audience otherwise). The list
includes **lobby-mode (unstarted, `started_at IS NULL`)** and **ended**
sessions, is paginated (limit/offset), filterable by topic substring and by a
start-time date range, and is sorted by start time with **lobby sessions
(NULL `started_at`) at the top** — the ones a returning user most likely wants
to get back into.

It requires the session cookie — same auth surface as the existing
`/api/auth/*` and `GET /api/sessions` routes (`preHandler: app.authenticate`).

## Why it needs to be done

The discovery feature's "My Sessions" surface (`sd_my_sessions_page` →
`sd_session_list_component`) needs a single call that answers "what are my
sessions, and what's my role in each?" The existing `GET /api/sessions`
endpoint cannot answer this:

- Its filters are **AND-composed** — there is no way to express "host OR
  participant" (`apps/server/src/sessions/routes.ts:1542-1592`).
- It applies the **public-visibility gate** (`visibilityWhereFragment`,
  `apps/server/src/sessions/visibility.ts:115`), so it would *also* surface
  every public session the caller is not in — wrong for "my sessions".
- It sorts `created_at DESC` and returns neither `started_at` nor a per-row
  caller role — both of which the role-aware "join live" routing
  (`sd_join_live_link`) and the lobby/started affordances need.

So a dedicated endpoint is the right shape. `sd_session_list_component`,
`sd_my_sessions_page`, and `sd_join_live_link` (`depends` chain down from
`sd_api`) all consume the role-annotated rows this produces; nothing in the
authenticated discovery surface can be built until it exists.

## Inputs / context

- **Reference handler — `GET /api/sessions`** —
  `apps/server/src/sessions/routes.ts:1447-1653`. The closest existing pattern:
  Fastify `app.get` with `preHandler: app.authenticate`, an incrementally
  composed parameterized `WHERE`, offset pagination, a page query + a
  `COUNT(*)::int` total query, and `{ sessions, total }` response. This
  endpoint mirrors its mechanics but swaps the visibility gate for the
  membership predicate and adds role annotation + the start-time sort.
- **Querystring schema pattern** —
  `apps/server/src/sessions/routes.ts:878-965` (`listSessionsQuerystringSchema`):
  `topic` (min/max from `MIN_TOPIC_SEARCH_LENGTH`/`MAX_TOPIC_SEARCH_LENGTH`,
  `packages/shared-types/src/limits.ts`), `limit` (default 50, max 200),
  `offset` (default 0, max `MAX_SESSION_LIST_OFFSET` = 100 000),
  `additionalProperties: false`. Reuse these caps verbatim (D3, D4).
- **Auth middleware** — `apps/server/src/auth/middleware.ts`. `app.authenticate`
  reads the `aconversa-session` cookie, verifies the HS256 JWT, loads the user,
  sets `request.authUser = { id, screenName }`, and throws
  `ApiError(401, 'auth-required', …)` on any failure. Handlers read
  `request.authUser.id` (see the defensive `authUser === undefined` guard at
  `routes.ts:1492-1499`).
- **`session_participants` table** —
  `apps/server/migrations/0003_session_participants.sql`. Columns
  `id, session_id, user_id, role` (`CHECK role IN ('moderator','debater-A',
  'debater-B')`), `joined_at`, `left_at TIMESTAMPTZ NULL`. **Active membership
  ⟺ `left_at IS NULL`**; leave-and-rejoin creates multiple rows; partial unique
  indexes enforce one active occupant per `(session_id, role)` and one active
  row per `(session_id, user_id)` `WHERE left_at IS NULL`. Indexes available:
  `sessions_host_user_id_idx` on `(host_user_id)` plus the participants
  partial-unique indexes (D6).
- **`sessions` table** — `apps/server/migrations/0002_sessions.sql:29-69` plus
  `started_at` from `0018_sessions_started_at.sql`. Columns now: `id`,
  `host_user_id`, `privacy`, `topic`, `created_at`, `started_at`, `ended_at`.
- **Response mappers** — `sessionRowToResponse`
  (`apps/server/src/sessions/routes.ts:1086-1102`) maps a session row to the
  camelCase `SessionResponse` (`id, hostUserId, privacy, topic, createdAt,
  endedAt`) — **note it does not emit `startedAt`**; this endpoint needs an
  extended mapper (D2). `toIsoString` (`routes.ts:975`) normalizes timestamps.
- **Shared response schema** — `sessionResponseSchema` /
  `SESSION_RESPONSE_SCHEMA_ID` (`routes.ts:306-355`); the wrapper
  `sessionListResponseRef` (`routes.ts:429`). This endpoint declares its own
  response schema (D2) — it does not reuse the shared `SessionResponse` (which
  lacks `startedAt` and `role` and is consumed by four other endpoints).
- **Error envelope / status conventions** — `apps/server/src/error-handler.ts`;
  `{ error: { code, message } }`; 401 `auth-required`, 400 `validation-failed`.
- **Behavior-test surface** — features live in `tests/behavior/backend/*.feature`
  with steps in `tests/behavior/steps/`. Authenticated requests in steps: mint a
  JWT for a seeded user (`backend-session-token.steps.ts`,
  "I have a valid session cookie for that user") and inject with
  `headers: { cookie: 'aconversa-session=<token>' }` against the pglite-backed
  app (`backend-create-session.steps.ts:62-114`). The closest sibling feature to
  pattern-match is `tests/behavior/backend/list-sessions-filters.feature`
  (+ `backend-list-sessions-filters.steps.ts`).
- **Vitest unit surface** — `apps/server/src/sessions/routes.test.ts` drives the
  handler against a mock pool via `__buildTestSessionsApp`. New SQL shapes
  (the membership `WHERE`, the role subquery, the start-time `ORDER BY`) need
  matching mock-pool branches there (the sd_schema Status block records the
  same gotcha — an unhandled query shape returns a 500 in the Vitest suite).
- **ADRs** — 0007 (Cucumber + pglite), 0022 (no throwaway verifications), 0023
  (Fastify), 0028 (`session-mode-changed` — the lobby→operate signal `started_at`
  mirrors), 0029 (anonymous public-session access — **does not** apply here:
  this endpoint is authenticated-only), 0045 (replay visibility — enforced by
  the replay surface, not this list).

## Constraints / requirements

- **Authenticated-only.** `preHandler: app.authenticate`; no anonymous access.
  401 `auth-required` when the session cookie is absent or invalid. (Anonymous
  discovery is the sibling `sd_public_sessions_endpoint`'s job under ADR 0029.)
- **Membership scope, no visibility gate.** The result set is exactly the
  sessions where `host_user_id = caller` OR an `EXISTS` participant row for the
  caller — **not** the public-visibility gate. The caller can always see their
  own sessions regardless of privacy; a session the caller neither hosts nor
  participates in must never appear (a Cucumber scenario pins this).
- **Includes lobby and ended.** No `started_at`/`ended_at` lifecycle filter is
  applied by default; lobby (`started_at IS NULL`) and ended
  (`ended_at IS NOT NULL`) sessions are both returned.
- **Membership uses any (current OR historical) row.** Mirror the existing
  `participant` filter's `EXISTS` shape (`routes.ts:1566-1576`): a past
  participant (`left_at IS NOT NULL`) still sees the session, and leave-and-rejoin
  (multiple rows) does not duplicate the parent session row. (D1.)
- **Role annotation per row** with a documented precedence (D7) so "join live"
  routes deterministically.
- **Start-time sort, lobby-first.** `ORDER BY started_at DESC NULLS FIRST,
  created_at DESC` — NULL `started_at` (lobby) rows at the top, deterministic
  secondary key for stable pagination (D8).
- **Parameterized SQL only.** Every user-controlled value (caller id, topic
  pattern, date bounds, limit/offset) flows through a `$N` placeholder; reuse
  the existing incremental-`WHERE` composition pattern. No string interpolation
  of user input.
- **Reuse the search/pagination caps** (`MIN/MAX_TOPIC_SEARCH_LENGTH`,
  `MAX_SESSION_LIST_OFFSET`, limit default 50 / max 200) from
  `packages/shared-types/src/limits.ts` — same input-hardening posture as
  `GET /api/sessions` (closes the same F-013 / G-013 review items).
- **No schema or migration change.** This task is read-path only; `sd_schema`
  already provided the column and the participants/host indexes already exist.

## Acceptance criteria

Per ADR 0022, every check below lands as a committed test at the right layer —
no ad-hoc `psql` / `node -e` probes. This task crosses the HTTP + DB seam
(authenticated wire behavior, membership filtering, role annotation), so the
load-bearing pins are **Cucumber** (behavior, pglite per ADR 0007 / 0022);
Vitest covers the handler against the mock pool. Test output is redirected to a
file and inspected via an Explore sub-agent per the project test-output
convention; no raw inline dumps.

1. **Endpoint exists**: `GET /api/sessions/mine`, registered in
   `apps/server/src/sessions/routes.ts`, `preHandler: app.authenticate`, with a
   querystring schema (`additionalProperties: false`) for `topic`, date bounds,
   `limit`, `offset`, and a declared response schema for
   `{ sessions: MySessionResponse[]; total: integer }` where each row carries
   `id, hostUserId, privacy, topic, createdAt, startedAt, endedAt, role`.
2. **Membership scope (Cucumber, `tests/behavior/backend/my-sessions.feature`
   + steps)**:
   - a session the caller **hosts** appears with `role = "host"`;
   - a session where the caller holds a **moderator** row appears with
     `role = "moderator"`;
   - a session where the caller holds a **debater-A / debater-B** row appears
     with `role = "debater-A"` / `"debater-B"`;
   - a session the caller **neither hosts nor participates in is absent**
     (including a public one — the no-visibility-gate pin);
   - a **lobby (unstarted)** session the caller owns appears, and a freshly
     started one and an **ended** one also appear (lifecycle inclusion).
3. **Lobby-first ordering (Cucumber)**: given a lobby session (NULL
   `started_at`) and a started session, the lobby session sorts ahead of the
   started one; among started sessions, more-recent `started_at` sorts first.
4. **Role precedence (Cucumber)**: a caller who is both host and a participant
   of the same session gets `role = "host"`; a caller with a historical
   (left) debater row **and** a current moderator row gets the **active** role
   (`"moderator"`) (D7).
5. **Topic + date filtering (Cucumber)**: `?topic=` narrows by substring
   (case-insensitive); the date bounds narrow by `started_at` range; an
   out-of-range / over-cap query param fails with **400 `validation-failed`**
   before any DB round-trip.
6. **Pagination (Cucumber)**: `limit`/`offset` page the ordered set and `total`
   reports the full match count before limit/offset.
7. **Auth (Cucumber)**: a request with no `aconversa-session` cookie is
   rejected **401 `auth-required`**; a valid cookie returns 200.
8. **Vitest unit** (`apps/server/src/sessions/routes.test.ts`): the handler
   maps rows to the camelCase `MySessionResponse` shape (including `startedAt`
   and `role`) and the mock pool has branches for the membership page query,
   the count query, and the role subquery (no unhandled-query 500).
9. **`pnpm run check` green** (build + lint + unit + behavior).
10. tj3 parse stays clean — the **closer** adds `complete 100` and the
    `## Status` block; the implementer does not edit the `.tji`.

This is a backend / protocol task, **not** a UI-stream task, so the
moderator/participant/audience Playwright e2e policy does not apply; the
discovery flows' Playwright coverage (My Sessions role badges + role-aware
join-live routing) lands in `sd_e2e`.

## Decisions

**D1 — Membership predicate `host OR EXISTS(any participant row)`, including
historical rows; not active-only.**
Chosen: `WHERE s.host_user_id = $1 OR EXISTS (SELECT 1 FROM session_participants
sp WHERE sp.session_id = s.id AND sp.user_id = $1)` — any role, current or past
(`left_at` ignored in the gate). *Rationale:* the `.tji` says "holds any
`session_participants` row"; the product goal is "get back to your sessions",
and a debater who stepped out (or a session that ended) is still one of *your*
sessions. This mirrors the existing `GET /api/sessions` `participant` branch
(`routes.ts:1566-1576`) verbatim, so the two endpoints share the
duplicate-suppression reasoning (`EXISTS`, not `JOIN`, so leave-and-rejoin's
multiple rows don't duplicate the parent session). *Alternative rejected:*
active-only (`left_at IS NULL`) membership — would silently drop ended/left
sessions from "My Sessions", contradicting the lifecycle-inclusion requirement
and surprising returning users.

**D2 — Dedicated `GET /api/sessions/mine` endpoint and a dedicated
`MySessionResponse` shape; do not overload `GET /api/sessions` or the shared
`SessionResponse`.**
Chosen: a new route plus a new response schema/mapper that extends the session
fields with `startedAt` and `role`. *Rationale:* (a) `GET /api/sessions`'
filters are AND-composed and gated by public visibility — it structurally
cannot express "host OR participant, my-sessions-only" (Why section); (b) the
shared `SessionResponse` (`routes.ts:306-355`) is consumed by four other
endpoints and carries neither `startedAt` nor `role` — widening it is scope
creep and risks those consumers. A purpose-built shape keeps the contract local
and lets `sd_join_live_link` rely on a stable per-row `role`. *Alternative
rejected:* add `mine=true` + `role` annotation onto `GET /api/sessions` —
conflates two visibility models (membership vs public gate) in one handler and
forces every other caller's response through an optional-role branch.

**D3 — Reuse the existing topic-search + pagination param caps verbatim.**
`topic` bounded by `MIN/MAX_TOPIC_SEARCH_LENGTH` (3..64), `limit` default 50 /
max 200, `offset` max `MAX_SESSION_LIST_OFFSET` (100 000), all from
`packages/shared-types/src/limits.ts`, `additionalProperties: false`.
*Rationale:* identical input-hardening posture to `GET /api/sessions` (closes
the same F-013 short-pattern and G-013 deep-offset review items); no reason to
diverge. Topic match is `topic ILIKE $N` with the `%…%` pattern passed as a
parameter (inherits sd_schema D4 — no trigram, no new index).

**D4 — Date filter is two optional ISO-8601 `date-time` bounds on `started_at`
(`startedAfter` / `startedBefore`); a date filter excludes lobby (NULL
`started_at`) rows.**
Chosen: `startedAfter` (`started_at >= $n`) and `startedBefore`
(`started_at < $n`), each `format: 'date-time'` (ajv-validated). When either
bound is present, lobby sessions (NULL `started_at`) fall out of the comparison
and are excluded. *Rationale:* the sort key and the public-list sibling both key
on `started_at`, so filtering on the same column is consistent and indexable;
pushing day-boundary/timezone interpretation to the client (which knows the
user's locale) keeps the server timezone-agnostic and the param shape trivial.
A date filter expresses "sessions that ran in this window", and lobby sessions
have not run — excluding them is the intuitive behavior (pinned by a Cucumber
scenario, documented in the endpoint schema). *Alternatives rejected:*
(a) `COALESCE(started_at, created_at)` date filter — would make lobby rows
filterable but muddies "start time" semantics and diverges from the public
sibling; (b) a single `YYYY-MM-DD` day param interpreted server-side — forces a
timezone assumption the server shouldn't make.

**D5 — `total` count query mirrors the page `WHERE` without ORDER/LIMIT/OFFSET,
sequential against the same pool.**
Chosen: replicate `GET /api/sessions`' two-query pattern
(`routes.ts:1597-1642`) — snapshot the params before appending limit/offset,
issue the page query then the `COUNT(*)::int` query, coerce a possible string
total defensively. *Rationale:* identical paging-UI contract ("showing 1-N of
M"); the benign concurrent-insert off-by-one note from the reference handler
applies unchanged. No need for a window-function `COUNT(*) OVER ()` — the
established two-query shape is what the codebase and its tests already assume.

**D6 — No new index; rely on `sessions_host_user_id_idx` + the
`session_participants` partial-unique indexes; in-memory sort over the
per-user set.**
Chosen: add nothing in this task. *Rationale:* the candidate set is bounded by
host/participant membership (a small per-user set), so the planner uses the
existing host index and the participants `(session_id, user_id)` indexes; the
`started_at DESC NULLS FIRST` sort runs in memory over that bounded set —
exactly the reasoning sd_schema D5 used to decline a my-sessions index. The
`sessions_public_started_idx` is privacy-public-scoped and irrelevant here.
*Alternative rejected:* a `(host_user_id, started_at)` covering index —
premature for an unproven, inherently small result set; if My-Sessions volume
ever justifies it, that's perf-gated work for the parking lot, not schema work
to front-load now (consistent with sd_schema D4's trigram stance).

**D7 — Single per-row `role` enum with precedence host > moderator >
debater-A/-B, preferring the active participant row.**
Chosen: emit one `role` field per row, computed as: `host` if
`s.host_user_id = caller`, else the caller's participant role from a correlated
subquery ordered `(left_at IS NULL) DESC, joined_at DESC LIMIT 1` (active row
preferred; most-recent historical otherwise). *Rationale:* "join live" routing
needs exactly one destination per row (`sd_join_live_link`): host/moderator →
`/m/*`, debater → `/p/*`. A single precedence-resolved enum is the minimal
contract that drives that deterministically; host wins because a host always
moderates their own session. Preferring the active row gives a current debater
who once moderated the role they hold *now*. *Alternative rejected:* return the
full set of the caller's roles per session and let the client resolve
precedence — more data, and it pushes the host-vs-moderator-vs-debater routing
rule into every consumer instead of settling it once at the seam.

**D8 — `ORDER BY started_at DESC NULLS FIRST, created_at DESC` for lobby-first,
stable pagination.**
Chosen: lobby rows (NULL `started_at`) sort to the top via `NULLS FIRST`;
started rows by descending start time; `created_at DESC` is the deterministic
tiebreak so offset pagination is stable across page fetches. *Rationale:* the
`.tji` mandates lobby-first ("the ones you most likely want back into"); an
explicit `NULLS FIRST` states intent even though Postgres' `DESC` default
already orders NULLs first, and the `created_at` tiebreak prevents row-shuffle
between pages when several rows share a `started_at` (or are all lobby/NULL).

**D9 — No anonymous-access, replay-visibility, or ADR change in this task.**
This endpoint is authenticated-only; ADR 0029 (anonymous public-session access)
and ADR 0045 (replay visibility) constrain the sibling
`sd_public_sessions_endpoint` and the replay surface, not this one. The role
annotation here merely *informs* the client's routing; it grants no access. No
ADR text is touched, so no amendment pass is owed (the `sd_docs` task handles
any discovery-surface ADR amendment).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- New route `GET /api/sessions/mine` registered in `apps/server/src/sessions/routes.ts` with `preHandler: app.authenticate`, membership-gate `WHERE host_user_id = $1 OR EXISTS(participant)`, no visibility gate.
- Role annotation via correlated subquery (precedence: host > active participant > historical participant); `ORDER BY started_at DESC NULLS FIRST, created_at DESC` (lobby-first, stable pagination).
- New types `MySessionResponse` / `MySessionListResponse`, querystring schema `myListSessionsQuerystringSchema`, mapper `mySessionRowToResponse`, and schema registration in `apps/server/src/sessions/routes.ts`.
- Two-query pagination (page + `COUNT(*)::int` total) with reused caps (`MIN/MAX_TOPIC_SEARCH_LENGTH`, `MAX_SESSION_LIST_OFFSET`, limit default 50 / max 200) from `packages/shared-types/src/limits.ts`.
- Vitest: 11 cases in `apps/server/src/sessions/routes.test.ts` under "GET /sessions/mine" — shape/mapping, host/moderator/debater roles, non-member absence, lobby-first ordering, role precedence, topic + `startedAfter` filtering, over-cap-offset 400, pagination/total, 401.
- Cucumber: 10 scenarios in `tests/behavior/backend/my-sessions.feature` + `tests/behavior/steps/backend-my-sessions.steps.ts` covering criteria 2–7.
- Note: unknown-query-key → 400 unit test dropped; `ajv` runs `removeAdditional: true` globally (unknown keys stripped, not rejected); over-cap-offset case covers criterion 5's 400 path.
