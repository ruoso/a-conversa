# sd_e2e — Playwright e2e: discovery flows

## TaskJuggler entry

`session_discovery.sd_e2e`, defined in
[`tasks/75-session-discovery.tji:88`](../../75-session-discovery.tji).
Back-link `note` on that task points here.

## Effort estimate

2d (from the WBS).

## Inherited dependencies

`depends !sd_frontend` — every discovery surface, affordance, and the
endpoints behind them are already shipped. The whole feature is reachable
through real routes; this task drives it end-to-end against the compose stack.

**Settled (landed):**

- `sd_schema` — `sessions.started_at TIMESTAMPTZ NULL`; NULL ⟺ lobby,
  non-NULL ⟺ started. `ended_at` already existed (NULL ⟺ live, non-NULL ⟺
  ended). `POST /api/sessions/:id/start` stamps `started_at`.
- `sd_my_sessions_endpoint` — `GET /api/sessions/mine` (authenticated),
  rows carry `id`/`topic`/`startedAt`/`endedAt`/`role`
  (`host`|`moderator`|`debater-A`|`debater-B`), lobby + ended included.
- `sd_public_sessions_endpoint` — `GET /api/sessions/public` (anonymous),
  returns only `privacy='public' AND started_at IS NOT NULL` rows, no role,
  no participant data. The lobby-secrecy gate lives here.
- `sd_session_list_component` —
  [`apps/root/src/discovery/SessionList.tsx`](../../../apps/root/src/discovery/SessionList.tsx)
  is the shared list (search, date filter, pagination, status column,
  `renderRowActions` slot). Test ids enumerated under Inputs.
- `sd_my_sessions_page` —
  [`apps/root/src/routes/MySessionsRoute.tsx`](../../../apps/root/src/routes/MySessionsRoute.tsx)
  at `/sessions/mine` (auth-gated; unauthenticated → `/login` → OIDC IdP).
- `sd_public_sessions_page` —
  [`apps/root/src/routes/PublicSessionsRoute.tsx`](../../../apps/root/src/routes/PublicSessionsRoute.tsx)
  at `/sessions` (anonymous).
- `sd_join_live_link` —
  [`apps/root/src/discovery/joinLiveHref.ts`](../../../apps/root/src/discovery/joinLiveHref.ts)
  +
  [`apps/root/src/discovery/JoinLiveLink.tsx`](../../../apps/root/src/discovery/JoinLiveLink.tsx)
  (`data-testid="session-join-live-link"`). Routing matrix: host/moderator →
  `/m/sessions/:id/{lobby,operate}`; debater-A/-B → `/p/sessions/:id/lobby`
  (lobby) / `/p/sessions/:id` (live); anon public → `/a/sessions/:id`; ended →
  no link.
- `sd_see_replay_link` —
  [`apps/root/src/discovery/seeReplayHref.ts`](../../../apps/root/src/discovery/seeReplayHref.ts)
  +
  [`apps/root/src/discovery/SeeReplayLink.tsx`](../../../apps/root/src/discovery/SeeReplayLink.tsx)
  (`data-testid="session-see-replay-link"`). Ended rows only →
  `/a/replay/:id`.

**Inherited e2e debt — none deferred onto this task.** Both page tasks paid
their own reachability + auth-bounce + host-badge + lobby-secrecy + axe debt
inline (`sd_my_sessions_page` D9, `sd_public_sessions_page` D8). The two
affordance tasks (`sd_join_live_link`, `sd_see_replay_link`) explicitly
deferred their *cross-surface routing* coverage here — those two affordances
plus the multi-user role matrix are exactly what this task adds on top of the
single-page specs that already exist (see Decisions D5 for the precise scope
boundary).

## What this task is

A single Playwright spec that drives the assembled discovery feature against
the compose stack with the seeded user pool, covering the journeys no
single-page spec exercises:

- **My Sessions role matrix + join-live routing.** The signed-in user sees
  her own host session and a session where she holds a debater slot, with the
  correct role badge on each, and "join live" routes the host row to `/m/*`
  and the debater row to `/p/*`.
- **Public list lobby-secrecy + privacy gating + anon join-live → `/a`.** The
  anonymous public list shows a started public session, never an unstarted
  (lobby) one, never a private one; "join live" on a public row lands the
  signed-out visitor in `/a/*`.
- **See-replay → audience replay.** An ended session's "see replay" lands in
  the audience replay surface (`/a/replay/:id`).
- **Search, date filter, pagination** narrow/walk both lists.

## Why it needs to be done

The unit, component, and page-level coverage each pins one slice in
isolation: the routing helpers are unit-tested over the wire shape, the link
components are RTL-tested for href/label, and each page spec proves its own
route renders. None of them proves the *whole* path — a real authenticated
user, real `session_participants` rows from the real claim flow, the real
endpoints, the real micro-frontend dispatch — actually carries a returning
user from a list row into the right surface. The lobby-secrecy rule
(`tasks/75-session-discovery.tji:13-17`) and the role-aware entry points
(`:18-20`) are the load-bearing product promises of the whole feature; this
task is where they are pinned at the system seam. It also gates `sd_docs`
(`tasks/75-session-discovery.tji:98`) and milestone M11
(`m_session_discovery`).

## Inputs / context

- WBS task + product constraints:
  [`tasks/75-session-discovery.tji:10-22,88-92`](../../75-session-discovery.tji).
- **Existing single-page specs this task complements (must not duplicate):**
  - [`tests/e2e/my-sessions-page.spec.ts`](../../../tests/e2e/my-sessions-page.spec.ts)
    — auth bounce, host-badge render, lobby-row-present, search/empty,
    pagination-control-present, landing reachability, page axe (en-US).
  - [`tests/e2e/public-sessions-page.spec.ts`](../../../tests/e2e/public-sessions-page.spec.ts)
    — landing reachability, started-vs-unstarted lobby-secrecy, search/empty,
    pagination-control-present, page axe (en-US).
- **`SessionList` test ids** (locale-agnostic; the routing assertions key on
  these, not on localized text):
  [`apps/root/src/discovery/SessionList.tsx`](../../../apps/root/src/discovery/SessionList.tsx)
  — `session-list`, `session-list-search`, `session-list-from`,
  `session-list-to` (date filter, lines 301/317), `session-list-row`,
  `session-list-status`, `session-list-summary`, `session-list-prev`,
  `session-list-next`, `session-list-empty`, `session-list-lobby-note`.
  Affordance ids: `session-join-live-link`, `session-see-replay-link`. Route
  chrome: `route-my-sessions`, `route-public-sessions`, `route-title`,
  `session-role-badge`; landing links `root-view-my-sessions`,
  `root-browse-public-sessions`.
- **Seeding endpoints (same-origin API, exercised as the real flow):**
  - `POST /api/sessions` `{ topic, privacy }` → `201 { id }` (caller becomes
    host **and** moderator;
    [`apps/server/src/sessions/routes.ts:1816-1939`](../../../apps/server/src/sessions/routes.ts)).
  - `POST /api/sessions/:id/start` → `200` (lobby→operate; stamps
    `started_at`;
    [`routes.ts:2775`](../../../apps/server/src/sessions/routes.ts)).
  - `POST /api/sessions/:id/end` → ended (operate→ended; stamps `ended_at`;
    [`routes.ts:2550`](../../../apps/server/src/sessions/routes.ts)).
  - `POST /api/sessions/:id/invite/claim` `{ role: 'debater-A'|'debater-B' }`
    → caller self-claims a debater slot in a session hosted by someone else
    ([`routes.ts:3672-3910`](../../../apps/server/src/sessions/routes.ts)).
    This is how the test user comes to hold a `debater-*` role for the `/p`
    routing leg.
- **E2e fixtures / conventions:**
  - [`tests/e2e/fixtures/authed-context.ts`](../../../tests/e2e/fixtures/authed-context.ts)
    — `authedContext(browser, username)` opens a context pre-loaded with a
    seeded auth jar (no per-test OIDC dance).
  - [`tests/e2e/global-auth.setup.ts`](../../../tests/e2e/global-auth.setup.ts)
    — `setup-auth` project seeds one jar per dev user;
    [`tests/e2e/fixtures/dev-users.ts`](../../../tests/e2e/fixtures/dev-users.ts)
    is the roster (`alice`, `ben`, `maria`, … on shared dev password).
  - [`tests/e2e/fixtures/no-scrollbars.ts`](../../../tests/e2e/fixtures/no-scrollbars.ts)
    — the `{ expect, test }` re-export every spec imports.
  - [`playwright.config.ts`](../../../playwright.config.ts) — per-feature
    Chromium projects with `dependencies: ['setup-auth']`, `locale: 'en-US'`,
    `ignoreHTTPSErrors: true`, `storageState: AUTH_STORAGE_STATE_PATH`; the
    cross-surface project (`chromium-cross-surface`) is the precedent for a
    multi-context, en-US journey spec
    ([`tests/e2e/cross-surface-lobby-start.spec.ts`](../../../tests/e2e/cross-surface-lobby-start.spec.ts)).
  - axe pattern: `new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze()`
    with `WCAG_AA_TAGS = ['wcag2a','wcag2aa','wcag21a','wcag21aa']`.
- **Compose / make targets:**
  [`docs/dev-environment.md`](../../../docs/dev-environment.md) — `make up`
  (dev) / `make test:e2e` (suite vs running stack) / `make test:e2e:compose`
  (one-shot up → run → down). Make and docker runs need
  `dangerouslyDisableSandbox`.
- **Routing destinations (verbatim from each surface router):** moderator
  `/m/sessions/:id/{lobby,operate}`
  ([`apps/moderator/src/App.tsx:62,70`](../../../apps/moderator/src/App.tsx));
  participant `/p/sessions/:id/lobby`, `/p/sessions/:id`
  ([`apps/participant/src/App.tsx:133-135`](../../../apps/participant/src/App.tsx));
  audience live `/a/sessions/:id`
  ([`apps/audience/src/App.tsx:182`](../../../apps/audience/src/App.tsx)) and
  replay `/a/replay/:id`
  ([`apps/audience/src/App.tsx:195`](../../../apps/audience/src/App.tsx)).
- **ADRs:** **0008** (Playwright as the e2e layer, multi-context first-class),
  **0017** (dev Authelia users-file OIDC), **0026** (micro-frontend root app
  dispatches `/m`,`/p`,`/a` to `SurfaceHost`), **0029** (anonymous public
  access), **0040** (axe WCAG A/AA), **0022** (no throwaway verifications),
  **0045** (audience replay visibility gating).

## Constraints / requirements

1. **One new spec, against the live compose stack.** Add
   `tests/e2e/discovery-flows.spec.ts` and a `chromium-discovery-flows`
   project in `playwright.config.ts` (`dependencies: ['setup-auth']`,
   `locale: 'en-US'`, `ignoreHTTPSErrors: true`,
   `storageState: AUTH_STORAGE_STATE_PATH` so the default `page` is `alice`).
   No `webServer` block — the stack is brought up by `make`/CI, matching every
   existing spec.
2. **Seed through the real flow, not direct DB writes.** Sessions via
   `POST /api/sessions`; lifecycle via `/start` and `/end`; debater slots via
   `POST /api/sessions/:id/invite/claim` from the claimant's own
   `authedContext`. Every seeded session topic carries a unique
   `randomUUID().slice(0,8)` token so a search narrows to exactly this run's
   rows (the established page-spec convention; keeps the suite parallel-safe).
3. **Role matrix is host + debater + anonymous.** The test user (`alice`)
   appears as **host** in her own started session (→ `/m`) and as **debater-A**
   in a session hosted by a *different* user (`ben`) that `ben` then starts
   (→ `/p`); the anonymous public list row routes to `/a`. A standalone
   non-host **moderator** role is **not constructible in v1** — the host *is*
   the moderator and there is no add-second-moderator path
   (`POST /api/sessions/:id/participants` accepts only `debater-A`/`debater-B`).
   The `host`/`moderator` cells of the join-live matrix share the same `/m`
   destination and the host cell exercises it; this is a v1 product fact, not
   deferred coverage (see Decisions D6).
4. **Lobby-secrecy + privacy at the UI seam.** The anonymous public list must
   show a started public session and must **not** show (a) an unstarted
   (lobby) public session with the same search token, nor (b) a *private*
   started session. Both seeded with the shared token so a single search
   proves absence, not mere off-screen-ness.
5. **Assert destinations by URL, tolerant of lazy surface bundles.** Each
   join-live / see-replay click asserts the resulting `URL.pathname`
   (`page.waitForURL`) against the expected surface route. `/m` and `/p`
   targets are auth-gated by `SurfaceHost`; because `alice` is authenticated
   the navigation resolves to the surface — assert the pathname (and, where a
   stable landmark exists, one surface marker) rather than deep surface state,
   which other surfaces' specs own.
6. **Locate by `data-testid`, scope per row.** Affordances are per-row
   (`session-join-live-link`, `session-see-replay-link`); scope them within
   the `session-list-row` whose text contains the seeded topic before
   clicking, so the right row's link is exercised.
7. **Anonymous legs use a cookie-free context.** The public-list and
   anon-join-live legs run in `browser.newContext({ ignoreHTTPSErrors: true,
   storageState: { cookies: [], origins: [] } })` (the page-spec precedent) so
   the project's default `alice` jar does not leak authentication in.
8. **No-scrollbars + en-US.** Import `{ expect, test }` from
   `./fixtures/no-scrollbars`; single-locale en-US (Decisions D4).

## Acceptance criteria

All verifications are **committed tests per ADR 0022** — `discovery-flows.spec.ts`
ships with this task; no throwaway probes. Each scenario below is a `test(...)`
in that spec, green against the compose stack.

1. **My Sessions role matrix + join-live routing.** With `alice` hosting a
   started session S_host and holding `debater-A` in `ben`-hosted started
   session S_deb (claimed via `/invite/claim`, then started by `ben`),
   `/sessions/mine` (searched to this run's token) shows both rows with a
   **Host** badge on S_host and a **debater** badge on S_deb; clicking
   join-live on S_host navigates to `/m/sessions/<S_host>/operate`, and on
   S_deb to `/p/sessions/<S_deb>`.
2. **Lobby-mode join-live routing (host + debater).** A lobby host row routes
   join-live to `/m/sessions/:id/lobby`; a lobby debater row (alice claimed
   debater-A in a `ben`-hosted *unstarted* session) routes to
   `/p/sessions/:id/lobby`. (Pins the lobby cells of the matrix that the
   started cells in #1 do not.)
3. **Public list lobby-secrecy + privacy gating.** Anonymous `/sessions`,
   searched to a shared token, shows a started public session and shows
   **neither** an unstarted public session **nor** a private started session
   with the same token (`toHaveCount(0)` on each).
4. **Signed-out join-live on a public row → `/a`.** In the anonymous context,
   clicking join-live on the started public row navigates to
   `/a/sessions/<id>`.
5. **See-replay → audience replay.** An ended session (created → started →
   ended) shows a see-replay link (and **no** join-live link) on `/sessions/mine`;
   clicking it navigates to `/a/replay/<id>`. The same ended-row affordance is
   asserted present on the public list for an ended *public* session.
6. **Date filter + pagination walk.** On `/sessions/mine`, the date-filter
   inputs (`session-list-from`/`session-list-to`) narrow the list to a started
   session and exclude a lobby (NULL `started_at`) one (the
   `session-list-lobby-note` appears); and with enough seeded rows, clicking
   `session-list-next` advances to a second page (`session-list-summary`
   reflects the new offset) and `session-list-prev` returns. (Page specs prove
   the controls are *present*; this proves they *function*.)
7. **axe on an ended-row list.** One `AxeBuilder` WCAG A/AA scan on a list
   containing an **ended** row (so the `session-see-replay-link` DOM is in
   scope — the one affordance state no existing page-spec axe run covers,
   since both page specs seed only started/lobby rows). Reports zero
   violations.

No new e2e debt is deferred — the discovery feature is fully reachable and
this spec closes the cross-surface and ended-row gaps. No future task to
register in the WBS.

## Decisions

- **D1 — One multi-context spec + one `chromium-discovery-flows` project.**
  A single `discovery-flows.spec.ts` driven by a project mirroring
  `chromium-cross-surface` (en-US, `setup-auth` dependency, `alice` jar as
  default storage). *Alternatives rejected:* (a) folding these scenarios back
  into the two page specs — they need *multiple* authenticated contexts
  (`alice` + `ben`) for the role matrix, which the page specs deliberately do
  not set up; (b) one spec per journey — fragments shared seeding helpers
  across files for no isolation benefit.

- **D2 — Seed roles through the real claim flow, not DB fixtures.** The
  debater leg uses `POST /api/sessions/:id/invite/claim` from `ben`'s
  `authedContext`, exactly as `cross-surface-lobby-start.spec.ts` does. This
  exercises the production path that *writes* `session_participants`, so the
  `role` the `/mine` endpoint annotates is real, not hand-stamped.
  *Alternative rejected:* the `seedParticipants` WS-store injector
  (`tests/e2e/fixtures/wsStoreSeed.ts`) — it injects synthetic events into the
  *moderator's* client store only and never touches the DB, so the `/mine`
  endpoint would not return the row; wrong tool for an endpoint-backed list.

- **D3 — Assert on `URL.pathname`, not deep surface state.** Each affordance
  click is verified by `page.waitForURL` against the expected surface route
  (plus a single surface landmark where one is stable). The point of this task
  is *routing correctness* — that the right role lands on the right surface
  prefix — not re-testing each surface's internals, which their own specs own.
  *Alternative rejected:* asserting full surface render (lobby roster, operate
  console) — couples this spec to three other surfaces' DOM and duplicates
  their coverage.

- **D4 — Single-locale (en-US), with one ended-row axe scan.** The discovery
  *behaviors* under test — lobby-secrecy, privacy gating, role-aware routing,
  pagination — are locale-invariant and located by locale-agnostic test ids;
  the *localized* affordance strings (`discovery.joinLive.*`,
  `discovery.seeReplay.*`) already have per-locale coverage via the
  i18n-catalog parity test and the `JoinLiveLink`/`SeeReplayLink` RTL tests,
  and the two page specs run their axe at en-US. So this spec runs en-US,
  consistent with both sibling page specs and the `chromium-cross-surface`
  precedent. It *does* add one axe scan the page specs miss: a list containing
  an **ended** row, so the see-replay affordance DOM is scanned at least once
  (AC 7). *Alternative rejected — per-locale projects for the full journeys:*
  the WBS note reads "per-locale projects + axe per the established e2e
  conventions," and the *established* convention is that behavior/cross-surface
  specs run en-US while per-locale is reserved for the i18n smoke specs;
  tripling the suite's most expensive multi-context spec ×3 locales buys no
  signal the catalog-parity + RTL + page-axe layers don't already provide.

- **D5 — Scope boundary: this spec owns what no single-page spec can.** It
  does **not** re-assert auth-bounce, host-badge-render, landing reachability,
  or the started-vs-unstarted single-page lobby-secrecy check — those are
  green in `my-sessions-page.spec.ts` / `public-sessions-page.spec.ts`. It owns
  exactly: the multi-user **role matrix** (host→`/m`, debater→`/p`), the
  **anonymous join-live → `/a`** leg, the **see-replay → `/a/replay`** leg,
  the **private-session absence** from the public list, and the **functional**
  (not merely present) date-filter + pagination-walk. *Alternative rejected:*
  re-running the page-level pins here for "defence in depth" — duplicate
  wall-clock on already-pinned behavior; ADR 0022 favors one authoritative
  pin per behavior.

- **D6 — `/m` routing is exercised via the host role; non-host moderator is a
  v1 non-feature, not deferred coverage.** In v1 `host === moderator`
  structurally and there is no path to grant a *second*, non-host moderator
  (`POST /api/sessions/:id/participants` accepts only debater roles). The
  join-live matrix maps `host` and `moderator` to the same `/m/*` destination;
  the host row in AC 1/2 exercises that destination. The matrix's `moderator`
  cell is unit-tested exhaustively in `joinLiveHref.test.ts` already.
  *Alternative rejected:* registering a future task to e2e the non-host
  moderator path — it is unbuildable today (no API to create that state); the
  separate-moderator capability is a known backend-hardening item, not
  discovery e2e debt, so nothing is registered here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-13.

- Created `tests/e2e/discovery-flows.spec.ts` — one Playwright spec with 8 `test()` cases covering the entire discovery-flows cross-surface journey against the compose stack.
- Added `chromium-discovery-flows` project to `playwright.config.ts` with `dependencies: ['setup-auth']`, `locale: 'en-US'`, `ignoreHTTPSErrors: true`, and `storageState: AUTH_STORAGE_STATE_PATH` (alice jar as default, matching the `chromium-cross-surface` precedent).
- AC1: My Sessions role matrix — alice as host (→ `/m/sessions/:id/operate`) and debater-A (→ `/p/sessions/:id`) for a ben-hosted session, each row showing the correct badge.
- AC2: Lobby-mode routing — host lobby → `/m/sessions/:id/lobby`, debater lobby → `/p/sessions/:id/lobby`.
- AC3: Public list lobby-secrecy + privacy gating — started public row visible; unstarted public and private started both assert `toHaveCount(0)`.
- AC4: Anon join-live on a public row → `/a/sessions/:id` (cookie-free context).
- AC5: See-replay → `/a/replay/:id`; ended row present on public list; no join-live link on ended rows.
- AC6: Date-filter narrows/excludes lobby (lobby-note appears); pagination next/prev walk confirmed via `session-list-summary`.
- AC7: axe WCAG A/AA scan on a list containing an ended row (the affordance state the page-spec axe runs don't cover) — zero violations.
