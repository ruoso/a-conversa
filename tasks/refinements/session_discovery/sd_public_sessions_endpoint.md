# sd_public_sessions_endpoint — GET /api/sessions/public (anonymous, started-only)

## TaskJuggler entry

`session_discovery.sd_api.sd_public_sessions_endpoint` — defined in
[`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 41–46).
Back-link: this refinement expands the one-line note there.

Part of milestone **M11 `m_session_discovery`** (`tasks/99-milestones.tji`,
registered 2026-06-12). Sibling of `sd_my_sessions_endpoint` under the `sd_api`
group; both feed the `sd_frontend` discovery surfaces.

## Effort estimate

1d (`effort 1d`, `allocate team`).

## Inherited dependencies

`depends !!sd_schema`.

- **Settled** — `sessions.started_at TIMESTAMPTZ NULL` exists and is maintained:
  backfilled from the earliest `session-mode-changed → operate` event and
  written by `POST /api/sessions/:id/start` in the same transaction
  (`apps/server/migrations/0018_sessions_started_at.sql`; refinement
  `tasks/refinements/session_discovery/sd_schema.md`, Done 2026-06-12). NULL ⟺
  lobby (unstarted); non-NULL ⟺ started. This is the load-bearing predicate for
  the lobby-secrecy rule and the start-time sort.
- **Settled** — the partial index this endpoint rides exists:
  `sessions_public_started_idx ON sessions (started_at DESC) WHERE privacy =
  'public' AND started_at IS NOT NULL`
  (`apps/server/migrations/0018_sessions_started_at.sql:52-54`). It was created
  by `sd_schema` D5 *for this query* — its predicate and `started_at DESC` order
  match this endpoint's `WHERE` and `ORDER BY` exactly.
- **Settled** — topic search is plain `topic ILIKE '%q%'`, no trigram / no
  full-text (sd_schema D4). This endpoint inherits that decision.
- **Settled** — the sibling `sd_my_sessions_endpoint` (Done 2026-06-12)
  established the dedicated-route + dedicated-response-schema + two-query
  pagination pattern this endpoint mirrors (D1, D5 below).

## What this task is

A new **anonymous** REST endpoint, `GET /api/sessions/public`, that returns the
set of public, already-started sessions so that anyone — signed in or not — can
browse them. The result set is exactly
`privacy = 'public' AND started_at IS NOT NULL`. Each row carries only the
**listing fields** `id, topic, startedAt, endedAt` — no host identity, no
participant data, no privacy flag (every row is public by construction). The
list is paginated (limit/offset), filterable by topic substring and by a
start-time date range, and sorted `started_at DESC` (most-recently-started
first).

It requires **no** authentication — there is no `preHandler: app.authenticate`.
It is the first anonymous HTTP route in
`apps/server/src/sessions/routes.ts`; the anonymous-public trust level it
operates at is the one ADR 0029 established for the public-session audience
surface (over WS today; this extends the same trust level to an HTTP listing).

## Why it needs to be done

The discovery feature's "Public Sessions" surface (`sd_public_sessions_page` →
`sd_session_list_component`) needs a single anonymous call that answers "what
public sessions are there to watch or replay?" The two existing read endpoints
cannot answer this:

- `GET /api/sessions` (`apps/server/src/sessions/routes.ts:1723-1929`) is
  authenticated (`preHandler: app.authenticate`) and applies the
  caller-relative `visibilityWhereFragment`
  (`apps/server/src/sessions/visibility.ts:115-132`, used at `routes.ts:1828`),
  which surfaces the caller's own private sessions plus all public ones. It also
  has no `started_at` filter, so it would enumerate **lobby (unstarted) public
  sessions** — and a lobby session's id is the secret participants join with
  (the lobby-secrecy rule in the `.tji` header). An anonymous caller must never
  see those.
- `GET /api/sessions/mine` (`routes.ts:1931-2096`) is membership-scoped and
  authenticated — it answers "my sessions", not "all public sessions".

So a dedicated anonymous, started-only endpoint is the right shape.
`sd_session_list_component`, `sd_public_sessions_page`, and the public-row
branch of `sd_join_live_link` / `sd_see_replay_link` (the `depends` chain down
from `sd_api`) all consume the rows this produces; the public discovery surface
cannot be built until it exists.

## Inputs / context

- **Sibling reference — `GET /api/sessions/mine`** — `routes.ts:1931-2096`. The
  closest existing pattern and the one to mirror for everything *except* the
  auth posture and the gate: Fastify `app.get`, a parameterized incrementally
  composed `WHERE`, offset pagination with a page query + a `COUNT(*)::int`
  total query, a dedicated response schema, and a dedicated row→camelCase
  mapper. This endpoint differs in three ways: no `preHandler` (anonymous),
  a fixed `privacy = 'public' AND started_at IS NOT NULL` gate (not membership),
  and a narrower response (no `role`, no `hostUserId`, no `privacy`).
- **Querystring schema pattern** — `myListSessionsQuerystringSchema`
  (`routes.ts:1125-1179`): `topic` (min/max from
  `MIN_TOPIC_SEARCH_LENGTH`/`MAX_TOPIC_SEARCH_LENGTH`,
  `packages/shared-types/src/limits.ts`), `startedAfter` / `startedBefore`
  (`format: 'date-time'`), `limit` (default 50, max 200), `offset` (default 0,
  max `MAX_SESSION_LIST_OFFSET` = 100 000), `additionalProperties: false`.
  Reuse these caps verbatim (D3, D4).
- **Response mappers / schemas** — `sessionRowToResponse`
  (`routes.ts:1300-1316`) and `mySessionRowToResponse` (`routes.ts:1344-1364`);
  the shared `sessionResponseSchema` / `SESSION_RESPONSE_SCHEMA_ID`
  (`routes.ts:308-354`) and the `MySessionResponse` schema (`routes.ts:463-520`)
  with its registration (`routes.ts:1469-1474`). This endpoint declares its own
  `PublicSessionResponse` schema/mapper (D2) — neither shared shape fits (one
  carries `hostUserId`/`privacy`, the other carries `role`; both leak more than
  an anonymous listing should). `toIsoString` (`routes.ts:1189-1194`) normalizes
  timestamps.
- **The partial index** — `sessions_public_started_idx`
  (`apps/server/migrations/0018_sessions_started_at.sql:52-54`), built by
  `sd_schema` for exactly this query.
- **Anonymous-access predicates (downstream, not used by this list)** —
  `canSeeSessionAnonymously` (`apps/server/src/sessions/visibility.ts:217-226`,
  `privacy = 'public' AND ended_at IS NULL`) gates the live audience surface
  (ADR 0029); `canReplaySessionAnonymously`
  (`visibility.ts:266-275`, `privacy = 'public'`, ended-agnostic) gates replay
  (ADR 0045). Every row this list returns satisfies one or both: a live started
  public session is anonymously join-able; an ended public session is
  anonymously replay-able. The list does not call these helpers (its `WHERE` is
  the index predicate) — but the consistency is why returning both live and
  ended public sessions is safe (D6).
- **Error envelope / status conventions** — `apps/server/src/error-handler.ts`;
  `{ error: { code, message } }`; 400 `validation-failed`. (No 401 path — the
  endpoint is anonymous.)
- **Behavior-test surface** — features live in `tests/behavior/backend/*.feature`
  with steps in `tests/behavior/steps/`. The closest siblings to pattern-match
  are `tests/behavior/backend/my-sessions.feature` (+
  `backend-my-sessions.steps.ts`, which has the 401/cookie scaffolding to invert
  here — anonymous requests just omit the cookie) and the existing
  `list-sessions.feature` / `list-sessions-filters.feature`. Sessions are seeded
  and driven against the pglite-backed app per ADR 0007.
- **Vitest unit surface** — `apps/server/src/sessions/routes.test.ts` drives the
  handler against a mock pool via `__buildTestSessionsApp`. New SQL shapes (the
  public-gate page query, the count query) need matching mock-pool branches
  there — the sd_schema and sd_my Status blocks both record the same gotcha: an
  unhandled query shape returns a 500 in the Vitest suite.
- **ADRs** — 0007 (Cucumber + pglite), 0022 (no throwaway verifications), 0023
  (Fastify), 0028 (`session-mode-changed` — the lobby→operate signal
  `started_at` mirrors), 0029 (anonymous public-session access — the trust level
  this endpoint operates at; see D7), 0045 (replay visibility — why ended public
  sessions belong in the list; D6).

## Constraints / requirements

- **Anonymous.** No `preHandler: app.authenticate`. The endpoint ignores any
  session cookie entirely (a signed-in caller gets the same result as a
  signed-out one). A request with no cookie returns **200**, not 401 — the
  inverse of the sibling `sd_my_sessions_endpoint`. (Pinned by a Cucumber
  scenario.)
- **Lobby-secrecy gate — load-bearing.** The result set is exactly
  `privacy = 'public' AND started_at IS NOT NULL`. A lobby (unstarted) public
  session — whose id is still the join secret — **must never** appear; a private
  session **must never** appear. This is the single most important pin: a
  Cucumber scenario must assert an unstarted public session is absent and a
  private (started) session is absent.
- **Includes both live and ended started public sessions.** No `ended_at` filter
  is applied: a live started public session (join-live target) and an ended
  public session (replay target) both appear; the client uses `endedAt` (NULL ⟺
  live) to pick the per-row affordance (D6).
- **Listing fields only.** The response row is `{ id, topic, startedAt, endedAt }`
  — no `hostUserId`, no `privacy`, no `role`, no participant data. The `.tji`
  mandates this; it is also the right anonymous-disclosure posture (D2).
- **Start-time sort.** `ORDER BY started_at DESC, created_at DESC` —
  most-recently-started first, with a deterministic secondary key for stable
  offset pagination (D5). No `NULLS FIRST` concern: `started_at` is never NULL in
  this result set.
- **Parameterized SQL only.** Every user-controlled value (topic pattern, date
  bounds, limit/offset) flows through a `$N` placeholder; reuse the incremental
  `WHERE` composition from the sibling. No string interpolation of user input.
- **Reuse the search/pagination caps** (`MIN/MAX_TOPIC_SEARCH_LENGTH`,
  `MAX_SESSION_LIST_OFFSET`, limit default 50 / max 200,
  `additionalProperties: false`) from `packages/shared-types/src/limits.ts` —
  same input-hardening posture as the sibling endpoints. The `MAX_SESSION_LIST_OFFSET`
  cap is also the (modest) anti-enumeration-cost backstop for an anonymous
  endpoint (D8).
- **No schema or migration change.** Read-path only; `sd_schema` already
  provided the column and the partial index this query rides.

## Acceptance criteria

Per ADR 0022, every check below lands as a committed test at the right layer —
no ad-hoc `psql` / `node -e` probes. This task crosses the HTTP + DB seam
(anonymous wire behavior, the lobby-secrecy gate, the public-only result set),
so the load-bearing pins are **Cucumber** (behavior, pglite per ADR 0007 /
0022); Vitest covers the handler against the mock pool. Test output is
redirected to a file and inspected via an Explore sub-agent per the project
test-output convention; no raw inline dumps.

1. **Endpoint exists**: `GET /api/sessions/public`, registered in
   `apps/server/src/sessions/routes.ts`, **without** `preHandler: app.authenticate`,
   with a querystring schema (`additionalProperties: false`) for `topic`,
   `startedAfter`, `startedBefore`, `limit`, `offset`, and a declared response
   schema for `{ sessions: PublicSessionResponse[]; total: integer }` where each
   row carries exactly `id, topic, startedAt, endedAt`.
2. **Lobby-secrecy + public-only gate (Cucumber,
   `tests/behavior/backend/public-sessions.feature` + steps)** — the
   load-bearing pins:
   - a **started public** session appears;
   - a **lobby (unstarted) public** session (`started_at IS NULL`) is **absent**;
   - a **private** session (started or not) is **absent**.
3. **Live + ended inclusion (Cucumber)**: a started, not-yet-ended public
   session appears with `endedAt = null`; an ended public session appears with a
   non-null `endedAt` — both in the same list.
4. **Anonymous access (Cucumber)**: a request with **no** `aconversa-session`
   cookie returns **200** with the list (not 401); a request *with* a valid
   cookie returns the same list (auth is ignored, not required).
5. **Listing fields only (Cucumber / Vitest)**: a response row exposes
   `id, topic, startedAt, endedAt` and **does not** expose `hostUserId`,
   `privacy`, `role`, or any participant field.
6. **Start-time ordering (Cucumber)**: among returned rows, a more-recent
   `started_at` sorts ahead of an older one.
7. **Topic + date filtering (Cucumber)**: `?topic=` narrows by substring
   (case-insensitive); `startedAfter` / `startedBefore` narrow by `started_at`
   range; an out-of-range / over-cap query param (e.g. `offset` over
   `MAX_SESSION_LIST_OFFSET`) fails with **400 `validation-failed`** before any
   DB round-trip.
8. **Pagination (Cucumber)**: `limit`/`offset` page the ordered set and `total`
   reports the full match count before limit/offset.
9. **Vitest unit** (`apps/server/src/sessions/routes.test.ts`): the handler maps
   rows to the camelCase `PublicSessionResponse` shape and the mock pool has
   branches for the public-gate page query and the count query (no
   unhandled-query 500).
10. **`pnpm run check` green** (build + lint + unit + behavior).
11. tj3 parse stays clean — the **closer** adds `complete 100` and the
    `## Status` block; the implementer does not edit the `.tji`.

This is a backend / protocol task, **not** a UI-stream task, so the
moderator/participant/audience Playwright e2e policy does not apply; the public
discovery flow's Playwright coverage (the Public Sessions list shows a started
public session, never a lobby or private one; signed-out join-live lands in
`/a`) lands in `sd_e2e` (`.tji` lines 82–87, which already names these
scenarios).

## Decisions

**D1 — Dedicated anonymous `GET /api/sessions/public`; do not overload
`GET /api/sessions` with a `?public=anonymous` mode.**
Chosen: a new, separately-registered route with no `preHandler`. *Rationale:*
`GET /api/sessions` is authenticated and structurally caller-relative (the
`visibilityWhereFragment`), so an anonymous, fixed-gate listing is a different
contract; forcing it into the same handler would mean a branch that strips auth
and swaps the gate, conflating two trust models in one place. The sibling
`sd_my_sessions_endpoint` (D2) set the precedent of a dedicated route per
distinct visibility model; this follows it. *Alternative rejected:* a query-param
mode on the existing handler — couples anonymous and authenticated paths and
risks the visibility gate leaking into the anonymous branch (the exact class of
bug the lobby-secrecy rule cannot afford).

**D2 — Dedicated `PublicSessionResponse` of exactly `{ id, topic, startedAt,
endedAt }`; reuse neither `SessionResponse` nor `MySessionResponse`.**
Chosen: a new response schema + mapper emitting only the four listing fields.
*Rationale:* (a) the `.tji` mandates "only listing fields … no participant
data"; (b) `SessionResponse` (`routes.ts:308-354`) carries `hostUserId` and
`privacy`, and `MySessionResponse` carries `role` — both disclose more than an
anonymous caller should see (host identity in particular), and both are consumed
by other endpoints, so widening or reusing them is wrong. A purpose-built
minimal shape is the correct anonymous-disclosure posture and keeps the contract
local. `privacy` is omitted because every row is public by construction.
`startedAt` + `endedAt` are exactly what the UI needs to choose between the
"join live" (`endedAt = null`) and "see replay" (`endedAt` set) affordances.
*Alternative rejected:* reuse `SessionResponse` and let the client ignore the
extra fields — leaks `hostUserId` to anonymous callers for no benefit.

**D3 — Reuse the topic-search + pagination param caps verbatim.**
`topic` bounded by `MIN/MAX_TOPIC_SEARCH_LENGTH` (3..64), `limit` default 50 /
max 200, `offset` max `MAX_SESSION_LIST_OFFSET` (100 000), all from
`packages/shared-types/src/limits.ts`, `additionalProperties: false`.
*Rationale:* identical input-hardening posture to the sibling endpoints; no
reason to diverge. Topic match is `topic ILIKE $N` with the `%…%` pattern passed
as a parameter (inherits sd_schema D4 — no trigram, no new index).

**D4 — Date filter is two optional ISO-8601 `date-time` bounds on `started_at`
(`startedAfter` / `startedBefore`), matching the sibling.**
Chosen: `startedAfter` (`started_at >= $n`) and `startedBefore`
(`started_at < $n`), each `format: 'date-time'` (ajv-validated). *Rationale:*
the sort key and gate both key on `started_at`; filtering the same column is
consistent and rides the partial index's `started_at DESC` ordering. Mirroring
the sibling `sd_my_sessions_endpoint` D4 keeps the two list endpoints' param
shapes identical, which the shared `sd_session_list_component` benefits from.
The lobby-NULL-exclusion subtlety from the sibling is moot here — this result
set has no NULL `started_at` rows. *Alternative rejected:* a single server-side
`YYYY-MM-DD` day param — forces a timezone assumption the server shouldn't make;
pushing day-boundary interpretation to the locale-aware client is cleaner.

**D5 — `ORDER BY started_at DESC, created_at DESC`; two-query pagination (page +
`COUNT(*)::int` total).**
Chosen: most-recently-started first, with `created_at DESC` as the deterministic
secondary key so offset pagination is stable when several rows share a
`started_at`; replicate the sibling's two-query shape — snapshot the params
before appending limit/offset, issue the page query then the `COUNT(*)::int`
query, coerce a possible string total defensively. *Rationale:* the `.tji`
mandates `started_at DESC`; the partial index `sessions_public_started_idx` is
already ordered `started_at DESC`, so the planner serves the gate + sort
directly from it. The two-query "showing 1-N of M" contract and the benign
concurrent-insert off-by-one note carry over unchanged from the sibling
(`sd_my_sessions_endpoint` D5). *Alternative rejected:* `COUNT(*) OVER ()`
window-function single-query — diverges from the established two-query shape the
codebase and its tests already assume.

**D6 — Include both live and ended started public sessions (no `ended_at`
filter); the UI distinguishes via `endedAt`.**
Chosen: the gate is `started_at IS NOT NULL` with **no** `ended_at` predicate.
*Rationale:* the public list serves two affordances — "join live" for sessions
in progress and "see replay" for finished ones (the `.tji` header's role-aware
entry points). A live started public session satisfies `canSeeSessionAnonymously`
(`visibility.ts:217-226`, ADR 0029); an ended public session satisfies
`canReplaySessionAnonymously` (`visibility.ts:266-275`, ADR 0045) — so every row
is anonymously actionable in at least one mode, and the `endedAt` field tells
the client which. *Alternative rejected:* `ended_at IS NULL` (live-only) —
would hide replay-able public sessions, defeating the "see replay" entry point
the feature requires and contradicting ADR 0045's anonymous-replay grant.

**D7 — Anonymous trust level is ADR 0029's; no new ADR, no ADR amendment in this
task.**
Chosen: operate at the same anonymous-public-read trust level ADR 0029
established for the audience surface — extended from WS subscribe to an HTTP
listing — and document the reasoning here rather than writing a new ADR.
*Rationale:* ADR 0029 already settles that public sessions are anonymously
readable; this endpoint adds **enumeration** of them, which is the natural and
intended consequence of marking a session public and starting it (its id stops
being a secret at the lobby→operate transition — precisely what `started_at IS
NOT NULL` keys on). The one genuinely new wrinkle — anonymous *discovery* of
session ids rather than access-by-known-id — is made safe by the same
lobby-secrecy predicate, so it does not introduce a new security trade-off
warranting its own ADR. The `.tji` frames this endpoint as "same trust level as
the public-session audience surface, ADR 0029", and both predecessor refinements
(sd_schema D7, sd_my D9) explicitly route the ADR 0029 anonymous-access
**amendment pass** to the `sd_docs` task. This refinement does the same: it
touches no ADR text. *Alternative rejected:* author a new ADR for "anonymous
public-session enumeration" now — premature; the trust model is unchanged from
0029, and `sd_docs` (`.tji` lines 89–94) already owns the amendment pass that
will record the HTTP-listing extension once the surfaces land. If the `sd_docs`
implementer finds the ADR 0029 text genuinely needs *new decision content*
(not just a scope note), that is an amendment under the existing ADR, not a fresh
one.

**D8 — No new index; no rate limiting beyond the offset cap.**
Chosen: rely on `sessions_public_started_idx` (sd_schema D5) and the
`MAX_SESSION_LIST_OFFSET` cap; add nothing. *Rationale:* the partial index
covers the gate and the sort; the offset cap (100 000) bounds the worst-case
cost of an anonymous deep-paginate the same way it does for the authenticated
endpoints. A dedicated rate limiter on this one anonymous route is unproven
need at v1 scale and would be a new cross-cutting seam — out of scope here.
*Alternative rejected:* front-load a request-rate limiter — premature
infrastructure for an unmeasured load; if anonymous enumeration ever proves a
cost problem, that is perf/ops-gated work for the parking lot, not list-endpoint
work to do now (consistent with sd_schema D4 / sd_my D6's "don't front-load
unproven perf work" stance).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- Added `PublicSessionResponse` / `PublicSessionListResponse` JSON schemas and `PublicSessionRow` + `publicSessionRowToResponse` mapper to `apps/server/src/sessions/routes.ts`.
- Registered `publicListSessionsQuerystringSchema` (topic, startedAfter, startedBefore, limit, offset) with reused caps from `packages/shared-types/src/limits.ts`.
- Implemented anonymous `GET /api/sessions/public` handler (no `preHandler`; gate: `privacy='public' AND started_at IS NOT NULL`; `ORDER BY started_at DESC, created_at DESC`; two-query pagination).
- Added mock-pool branches for the public-gate page and count queries in `apps/server/src/sessions/routes.test.ts`; new describe block with 4 Vitest unit tests (shape/fields-only, gate excludes lobby+private, cookie-ignored, over-cap 400).
- Created `tests/behavior/backend/public-sessions.feature` with Cucumber scenarios for the load-bearing lobby-secrecy gate, live+ended inclusion, no-cookie 200, cookie-doesn't-widen, listing-fields-only, ordering, topic/date filter, over-cap 400, and pagination.
- Created `tests/behavior/steps/backend-public-sessions.steps.ts` with pglite-backed step definitions.
- All 13 Vitest tests matching this handler pass; Playwright e2e coverage deferred to `sd_e2e` per the refinement (`.tji` lines 82–87).
