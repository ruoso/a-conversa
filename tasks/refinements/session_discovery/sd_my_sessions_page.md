# sd_my_sessions_page — My Sessions page (authenticated)

## TaskJuggler entry

- WBS task: `session_discovery.sd_frontend.sd_my_sessions_page`
- Defined in [`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 58–63), under `sd_frontend`.
- Back-link note in the `.tji`: *"Authenticated route in the root app, linked from the signed-in chrome; unauthenticated visits bounce through the existing sign-in flow. Shows the caller's role per row (host/moderator/debater badge)."*

## Effort estimate

**1 day.** The shared list component, the authenticated endpoint, the i18n
`discovery.*` block, and the auth-gate / return-to machinery all already
exist; this task is a thin authenticated route component, a credentialed
fetcher adapter that also correlates each row's role, a small role-badge
element, an auth-gated landing entry link, locale string additions, and the
focused tests that pin all of it. It is the authenticated mirror of the
already-shipped [`sd_public_sessions_page`](sd_public_sessions_page.md).

## Inherited dependencies

`depends !sd_session_list_component` — which itself chains
`sd_session_list_component → sd_api → sd_schema`.

**Settled (all predecessors complete):**

- **`sd_schema`** (done) — `sessions.started_at TIMESTAMPTZ NULL`, backfilled,
  written on the lobby→operate transition; this is the column the list sorts
  on and the marker that distinguishes lobby (unstarted) from started rows.
- **`sd_my_sessions_endpoint`** (done) — `GET /api/sessions/mine`,
  **authenticated** (`preHandler: app.authenticate`), defined in
  `apps/server/src/sessions/routes.ts:2168`. Returns the caller's own
  sessions: those they host (`host_user_id = caller`) OR in which they hold /
  held a `session_participants` row. **No public-visibility gate** (the caller
  always sees their own sessions regardless of privacy); **includes lobby
  (unstarted) and ended** sessions. Each row is annotated with the caller's
  resolved **`role`** — one of `host | moderator | debater-A | debater-B`
  (precedence host > moderator > debater, active participant row preferred).
  Query params mirror the public endpoint: `topic` (ILIKE substring, 3–64
  chars), `startedAfter` / `startedBefore` (ISO-8601 `date-time` bounds),
  `limit` (default 50, max 200), `offset` (default 0). Response:
  `{ sessions: [{ id, hostUserId, privacy, topic, createdAt, startedAt, endedAt, role }], total }`,
  ordered `started_at DESC NULLS FIRST, created_at DESC` (lobby sessions sort
  to the top). Returns 401 `auth-required` when no valid session cookie is
  present. Schemas: `mySessionResponseSchema` (`routes.ts:463`),
  `MySessionListResponse` wrapper (`routes.ts:538`); querystring schema
  `routes.ts:1237`.
- **`sd_session_list_component`** (done) — `SessionList` at
  `apps/root/src/discovery/SessionList.tsx`. Props (lines 88–106):
  `fetchPage: SessionListFetcher` (required), `limit?`, `renderRowActions?`,
  `lobbyRowsPossible?` (default `true`), `debounceMs?`. View-model
  `SessionListRow` (lines 51–58): `{ id, topic, startedAt: string|null, endedAt: string|null }`
  — **no `role` field** (the component is deliberately endpoint-ignorant;
  per-row role badges + links arrive through `renderRowActions`, per the
  component comment at lines 46–58 and 93–97). Fetcher seam
  `SessionListFetcher = (query: SessionListQuery) => Promise<SessionListPage>`
  (lines 85–86); **must be referentially stable** across renders (lines
  80–86). The component owns debounced topic search, date filters, pagination,
  loading/empty/error, and accessibility.

**Pending (later siblings, not blockers):**

- **`sd_join_live_link`** and **`sd_see_replay_link`** (both
  `depends !sd_session_list_component`, not on this page) supply the per-row
  **navigation** affordances ("join live" → `/m`/`/p`/`/a`, "see replay" →
  audience replay) via the component's `renderRowActions` slot. This page
  populates that slot now with the **role badge** only; the link tasks add
  the navigation controls alongside it when they land (see Decisions D4).
- **`sd_e2e`** (`depends !sd_frontend`) owns the integrated cross-surface
  discovery journeys against the seeded compose stack — including the
  role-aware join-live **routing** matrix (host/moderator → `/m`, debater →
  `/p`) and the per-locale project sweep.

## What this task is

Add the authenticated **My Sessions** page to the root app: a route, gated
behind the existing sign-in flow, that mounts the shared `SessionList`
component fed by a fetcher hitting `GET /api/sessions/mine` (with the session
cookie), plus the entry link from the signed-in landing chrome that makes the
route reachable. The page renders the caller's own sessions — host,
moderator, and debater roles, lobby and started and ended — paginated,
searchable by topic, filterable by date, each row showing a **role badge**
derived from the endpoint's per-row `role` annotation. Per-row "join live" /
"see replay" navigation is out of scope here; the dedicated link tasks wire
those into the same render slot later.

## Why it needs to be done

`SessionList` and `GET /api/sessions/mine` exist but nothing renders them for
an authenticated user: no route mounts the component against the authenticated
endpoint and no surface drives it. This task is the **wiring task** that makes
the authenticated discovery surface reachable — the entry point that lets a
returning user get back to the sessions they host or debate in, including the
lobby they most likely want to re-enter. It also surfaces the endpoint's
`role` annotation at the UI (the badge the WBS note calls for), and it unblocks
the row-action link tasks (`sd_join_live_link`, `sd_see_replay_link`), which
need a mounted authenticated page to render their role-routed affordances into.

## Inputs / context

- **WBS + product constraints** — [`tasks/75-session-discovery.tji`](../../75-session-discovery.tji):
  header lines 10–20 fix the role-routing intent ("Join live routes by role")
  and note My Sessions has **no** started-only restriction ("you need to get
  back to your own lobby"); task block lines 58–63.
- **Authenticated endpoint contract** — `apps/server/src/sessions/routes.ts`:
  handler `:2168`, per-row schema `mySessionResponseSchema:463` (includes
  `role`), list wrapper `:538`, querystring schema `:1237`, row→response
  mapper `:1526`; refinement
  [`sd_my_sessions_endpoint.md`](sd_my_sessions_endpoint.md).
- **Shared component** — `apps/root/src/discovery/SessionList.tsx:88` (props),
  `:51` (`SessionListRow` — no `role`), `:85` (`SessionListFetcher`, stability
  contract), `:97` (`renderRowActions` slot), `:409` (the per-row actions cell
  that renders `renderRowActions?.(row)`); test patterns in
  `apps/root/src/discovery/SessionList.test.tsx`; refinement
  [`sd_session_list_component.md`](sd_session_list_component.md).
- **Sibling page (the pattern to mirror)** —
  `apps/root/src/routes/PublicSessionsRoute.tsx` (route shell + `<main>`
  chrome), `apps/root/src/discovery/publicSessionsFetcher.ts` (standalone
  fetcher: `buildPublicSessionsQueryString`, `PublicSessionResponse →
  SessionListRow` mapping, **no** `credentials`), and their tests
  `PublicSessionsRoute.test.tsx` / `PublicSessionsRoute.a11y.test.tsx` /
  `publicSessionsFetcher.test.ts`; refinement
  [`sd_public_sessions_page.md`](sd_public_sessions_page.md).
- **Auth gate + return-to machinery** — `apps/root/src/surfaces/SurfaceHost.tsx`:
  exported helpers `rememberReturnTo` (`:24`) and `takeRememberedReturnTo`
  (`:32`), `RETURN_TO_KEY = 'a-conversa:return-to'` (`:9`),
  `sanitizeReturnTo` (`:11`); the gate pattern at `:143` (loading →
  checking state), `:162` (unauthenticated → `rememberReturnTo` +
  `<Navigate to="/login" replace />`), `:167` (needs-screen-name →
  `<Navigate to="/screen-name" replace />`). `useAuth` from `@a-conversa/shell`
  (`packages/shell/src/auth/useAuth.ts:19`); `AuthStatus =
  'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated'`
  (`packages/shell/src/auth/types.ts:33`); `AuthUser = { userId, screenName }`
  (`types.ts:23`). Post-auth return is consumed by `LandingRoute.tsx:49–54`
  and `LoginRoute.tsx`.
- **Routing** — `apps/root/src/App.tsx:2` (`Navigate, Route, Routes`),
  `:43–55` (the `<Routes>` block; existing paths `/`, `/sessions`, `/login`,
  `/screen-name`, `/logout`, `/auth/callback`, `/m/*`, `/p/*`, `/a/*`,
  `/t/*`, and a `*` → `/` fallback). The authenticated `LogoutRoute`
  (`:12–39`) shows the in-app `credentials: 'include'` fetch convention.
- **Landing entry point** — `apps/root/src/landing/CallToActionSection.tsx`:
  `useAuth()` at `:33`, the authenticated branch (`auth.status ===
  'authenticated' && auth.user !== undefined`) at `:40` rendering the logout
  link (`:68–74`); the existing public link `<Link to="/sessions">`
  (`:60–66`, testid `root-browse-public-sessions`, key
  `landing.cta.browsePublicSessions`).
- **i18n catalog** — `packages/i18n-catalogs/src/catalogs/en-US.json`
  already has the `discovery.*` block (search, dateFilter, status, columns,
  list, pagination, loading, empty, error, notStarted, `publicSessions`).
  Locale siblings `pt-BR.json`, `es-419.json` in the same directory.
- **e2e harness** — `tests/e2e/fixtures/auth.ts:207` (`loginAs(page, { username })`,
  full OIDC handshake against the Authelia dev IdP, ADR 0017),
  `tests/e2e/fixtures/authed-context.ts:48` (`authedContext(browser, username)`,
  pre-seeded jar), `tests/e2e/fixtures/dev-users.ts:43` (`DEV_USER_POOL` —
  alice, ben, …), `tests/e2e/global-auth.setup.ts` (one-time per-user jar
  bootstrap); `tests/e2e/public-sessions-page.spec.ts` (the sibling spec:
  API-seeds sessions via `POST /api/sessions` + `/start`, then asserts at the
  UI; runs axe). `playwright.config.ts` (`chromium-public-sessions` project,
  `dependencies: ['setup-auth']`).
- **ADRs** —
  [0026](../../../docs/adr/0026-micro-frontend-root-app.md) (root-app layout),
  [0017](../../../docs/adr/0017-mock-oauth-authelia-users-file.md) (dev IdP / sign-in),
  [0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) (i18n),
  [0040](../../../docs/adr/0040-automated-accessibility-checks-axe-playwright.md) (axe),
  [0008](../../../docs/adr/0008-e2e-framework-playwright.md) (Playwright),
  [0006](../../../docs/adr/0006-unit-test-framework-vitest.md) (Vitest),
  [0022](../../../docs/adr/0022-no-throwaway-verifications.md) (test discipline).

## Constraints / requirements

1. **Authenticated, with the existing bounce.** The route renders only for an
   authenticated caller. An unauthenticated visit must `rememberReturnTo` the
   deep link and `<Navigate>` to `/login`; a `needs-screen-name` visit bounces
   to `/screen-name`; an in-flight `loading` status shows a checking state and
   does not flash the list. This reuses the `SurfaceHost` gate machinery —
   **no new auth seam**.
2. **Credentialed fetch.** The fetcher targets `GET /api/sessions/mine` with
   `credentials: 'include'` (the endpoint requires the session cookie). It
   must not assume the anonymous posture of the public fetcher.
3. **Reuse the shared component unchanged.** Drive everything through
   `SessionList`'s existing props; do not fork it or add a `role` field to
   `SessionListRow`. The role badge is supplied **from outside**, through the
   two seams this page owns (`fetchPage` + `renderRowActions`), per the
   component's design.
4. **Role badge per row, derived from the endpoint annotation.** Each row
   shows the caller's role (host / moderator / debater). Because
   `SessionListRow` carries no role, the page correlates `role` by session
   `id` across its own fetcher and its own `renderRowActions` (Decisions D3).
5. **Lobby rows are expected.** My Sessions includes unstarted sessions
   (`started_at IS NULL`), so `lobbyRowsPossible` stays at its default
   (`true`) — the date-filter lobby-exclusion note is meaningful here and must
   render when a date filter is active.
6. **Localized in all three locales** (en-US / pt-BR / es-419) per ADR 0024.
   New keys go under the existing `discovery.*` block and the landing CTA
   block; no hard-coded user-facing strings (including the role-badge labels).
7. **Accessible** per ADR 0040 — the route passes an axe scan; the page chrome
   (heading, landmarks) follows the existing route components' structure; the
   role badge carries an accessible label (it sits in a column otherwise read
   as "Actions").
8. **Reachable from the signed-in landing chrome** — the landing page gains a
   visible "My sessions" link in its **authenticated** branch; the route is
   registered in `App.tsx`.
9. Forward-only, no edits to the component, endpoint, or schema. No new
   runtime dependency (React Router, react-i18next, and `@a-conversa/shell`
   are already present).

## Acceptance criteria

All criteria land as committed tests at the right layer per ADR 0022 — no
throwaway probes.

**Vitest + React Testing Library** (`apps/root/src/routes/MySessionsRoute.test.tsx`,
`apps/root/src/discovery/mySessionsFetcher.test.ts`, and a small
`apps/root/src/discovery/SessionRoleBadge.test.tsx`):

1. **Auth gate.** With `auth.status === 'unauthenticated'`, the route renders
   nothing of the list and triggers the redirect to `/login` (and
   `rememberReturnTo` is invoked with the page path); with `needs-screen-name`
   it redirects to `/screen-name`; with `loading` it shows the checking state;
   with `authenticated` it mounts `SessionList` and renders the localized
   heading. (Tested by rendering the route under a stub `AuthProvider` /
   `useAuth` value at each status, within a `MemoryRouter`.)
2. **Credentialed fetcher.** `mySessionsFetcher` builds the correct
   querystring from a `SessionListQuery` (omitting absent optional params)
   against `/api/sessions/mine`, issues the fetch with
   `credentials: 'include'`, and maps the `{ sessions, total }` response into
   `{ rows: SessionListRow[], total }` **plus** the per-row `id → role`
   correlation. A test pins that the role annotation survives the mapping and
   that the credentialed posture is used.
3. **Role badge.** With a stub fetcher returning rows of each role, the
   rendered rows show the correct localized badge; `SessionRoleBadge` maps
   `host → host`, `moderator → moderator`, and **both** `debater-A` /
   `debater-B → debater` labels, and exposes an accessible label.
4. **Lobby rows surface.** The route leaves `lobbyRowsPossible` at default, so
   a lobby row (null `startedAt`) renders with the lobby status and the
   date-filter lobby-exclusion note appears when a date filter is active
   (the inverse of the public page's assertion).

**Accessibility** (`apps/root/src/routes/MySessionsRoute.a11y.test.tsx`,
mirroring `PublicSessionsRoute.a11y.test.tsx`): the rendered page (in its
authenticated state) has no axe violations (ADR 0040).

**Playwright e2e** (`tests/e2e/my-sessions-page.spec.ts`, new
`chromium-my-sessions` project against the seeded compose stack — ADR 0008;
this task pays down the component's deferred e2e debt for the authenticated
list and is **not** deferred, because the route is now reachable):

5. **Auth bounce.** A signed-out visit to the route lands in the sign-in flow
   (`/login`), not the list.
6. **Authenticated render.** A signed-in user (e.g. `alice`, seeding her
   sessions via `POST /api/sessions` + `/start`, mirroring the public spec's
   seeding) sees her own sessions, each carrying a **host** role badge, with a
   **lobby** (unstarted) session present in the list (the distinguishing
   My-Sessions behavior — lobby rows appear, unlike the public list).
7. **Search / pagination.** Topic search narrows the list; the pagination
   control is present; the empty state shows for a no-match search.
8. **Reachability.** The signed-in landing chrome shows a "My sessions" link
   that navigates to the route.
9. axe WCAG-AA scan on the rendered authenticated page.

**Scope split with `sd_e2e`:** this task's spec covers the authenticated
page in isolation — auth-bounce, host-role render, lobby-rows-appear,
search/pagination, reachability. The broader cross-surface journeys remain
with **`sd_e2e`** (already scoped there): the full **role matrix** (a user
who is moderator / debater in *another* host's session, requiring multi-user
seeding) with correct moderator/debater badges, the role-aware **join-live
routing** to `/m` / `/p` (which does not exist until `sd_join_live_link`
lands), see-replay landing, My-Sessions ↔ Public-Sessions interplay, and the
per-locale project sweep. No new future task is registered by this
refinement; the deferred coverage already has a home in `sd_e2e`.

## Decisions

- **D1 — Route path `/sessions/mine` (authenticated).** Sibling of the public
  `/sessions` (the path `sd_public_sessions_page` D1 explicitly reserved for
  this page), keeping the discovery surfaces under one prefix.
  *Alternatives:* `/my-sessions` (breaks the shared prefix), `/sessions?mine`
  (a query param is not a distinct route and complicates the gate). Rejected
  for the clean, collision-free sibling path.
- **D2 — Route component `apps/root/src/routes/MySessionsRoute.tsx`,
  registered in `App.tsx`.** Matches the existing route-component convention
  (`LandingRoute`, `PublicSessionsRoute`, …): a named-function default export
  returning a `<main>` with `useTranslation`. The **auth gate is inlined** in
  this component — it calls `useAuth()` and, before mounting the list, returns
  the loading / `<Navigate to="/login">` (after `rememberReturnTo`) /
  `<Navigate to="/screen-name">` branches exactly as `SurfaceHost` does, then
  renders `SessionList` only when `auth.status === 'authenticated'`.
  *Alternative:* extract a shared `<RequireAuth>` wrapper. Rejected for now —
  this is the **first** plain (non-surface) authenticated root route, so there
  is a single call site; `SurfaceHost` already inlines the same gate, so
  inlining here keeps one obvious pattern. Extracting a wrapper is the right
  move once a *second* authenticated root route appears, not before (YAGNI);
  this is a code-shape note, **not** a deferred WBS task.
- **D3 — Credentialed standalone fetcher
  `apps/root/src/discovery/mySessionsFetcher.ts` that also returns the
  `id → role` correlation.** Mirrors `publicSessionsFetcher.ts` (endpoint URL,
  querystring assembly, response→view-model mapping injected via `fetchPage`),
  but uses `credentials: 'include'` against `/api/sessions/mine`. Because
  `SessionListRow` deliberately has **no** `role` field and `renderRowActions`
  receives only the row, the page correlates role by `id`: the exported
  `fetchMySessions(query)` returns `{ rows, total, roles }` (where `roles` is
  the `id → role` pairing); the route holds a stable `roleById` map
  (`useRef`), records each page's roles into it inside a `useCallback`-wrapped
  adapter (preserving the `fetchPage` referential-stability contract), and
  returns `{ rows, total }` to the component. `renderRowActions={(row) =>
  <SessionRoleBadge role={roleById.current.get(row.id)} />}`. Roles are
  immutable per session id, so accumulating across pages (set, never clear) is
  safe and sidesteps any out-of-order-response races. *Alternatives:* (a) add
  `role?` to `SessionListRow` — rejected: it violates the component's
  endpoint-ignorant design (component comment lines 46–58) and edits a
  shipped shared component for one consumer; (b) a second fetch in the route
  to get roles — rejected as redundant, the annotation is already on every
  row. Keeping the mapping in a standalone module makes it unit-testable
  without rendering.
- **D4 — `renderRowActions` renders the role badge now; navigation links
  later.** The role badge **is** this task's deliverable (the WBS note), so
  the page populates the `renderRowActions` slot with `SessionRoleBadge` from
  the start — unlike the public page, which mounted the list with no row
  actions. The per-row "join live" / "see replay" **navigation** controls are
  the explicit deliverables of `sd_join_live_link` / `sd_see_replay_link`;
  those tasks extend this same slot to render their controls *alongside* the
  badge when they land. *Alternative:* leave the slot empty and add the badge
  in a later task — rejected: the badge is named in this task's WBS note and
  the endpoint already supplies the data.
- **D5 — `SessionRoleBadge` element at
  `apps/root/src/discovery/SessionRoleBadge.tsx`.** A small, non-interactive
  presentational element mapping the endpoint role string to a localized,
  accessibly-labelled badge: `host`, `moderator`, and `debater` (both
  `debater-A` and `debater-B` collapse to a single **debater** label — the A/B
  slot distinction is not meaningful to a user browsing their own sessions;
  it matters only to the live surface). Kept separate from the route so the
  role→label mapping is unit-testable in isolation. *Alternative:* distinct
  "Debater A" / "Debater B" labels — rejected as noise for this surface.
- **D6 — `lobbyRowsPossible` left at its default (`true`).** My Sessions
  includes unstarted sessions (the endpoint applies no started-only gate), so
  the date-filter lobby-exclusion note is correct here and must render — the
  exact inverse of the public page's `lobbyRowsPossible={false}` (its D5).
- **D7 — Landing entry link in the authenticated branch of
  `CallToActionSection.tsx`.** The "My sessions" `<Link to="/sessions/mine">`
  is added to the block that already renders only for
  `auth.status === 'authenticated'` (`:40`/`:68`), next to the existing logout
  link — signed-out visitors must not see it (the route would just bounce
  them). *Alternative:* a dedicated global signed-in nav/header — the root app
  has no such chrome today, so adding one is out of scope; the CTA section's
  authenticated branch is the established signed-in affordance.
- **D8 — New i18n keys under existing blocks.** Add
  `discovery.mySessions.title` (heading), `discovery.mySessions.subtitle`
  (intro), `discovery.mySessions.role.{host,moderator,debater}` (badge
  labels) and `discovery.mySessions.role.ariaLabel` (the badge's accessible
  prefix, ICU `{role}`), plus the landing-link label
  `landing.cta.viewMySessions` — to all three catalogs (`en-US`, `pt-BR`,
  `es-419`) per ADR 0024. The component's existing `discovery.*` strings cover
  the list internals; this task adds only the page chrome, the badge labels,
  and the link. The auth-gate checking state **reuses** the existing
  `auth.login.checking` key (as `SurfaceHost` does) — no new key.
- **D9 — Focused authenticated Playwright spec here, role-matrix + routing in
  `sd_e2e`.** Because the route is reachable, full e2e deferral is not allowed
  (UI-stream e2e policy); the page pays its own reachability + auth-bounce +
  host-badge + lobby-rows-appear debt with a thin compose-stack spec using the
  existing `loginAs` / `authedContext` fixtures, while the heavier multi-user
  role matrix and the not-yet-built join-live routing stay in the dedicated
  `sd_e2e` task. *Alternative:* defer everything to `sd_e2e` — rejected: it
  would leave this page's auth-gate and lobby-rows-appear behavior unverified
  at its own surface and pile more debt on the one catch-all task. *Alternative:*
  seed the full host/moderator/debater matrix inline here — rejected:
  multi-user cross-session seeding is exactly what `sd_e2e` is scoped (2d) to
  carry, and duplicating it here would be redundant fixture work.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- Added authenticated route `apps/root/src/routes/MySessionsRoute.tsx` at `/sessions/mine` with inlined auth gate (loading / unauthenticated→`/login` with `rememberReturnTo` / `needs-screen-name`→`/screen-name` / authenticated list) using `useAuth` and `SessionList`.
- Added credentialed fetcher `apps/root/src/discovery/mySessionsFetcher.ts` targeting `GET /api/sessions/mine` with `credentials: 'include'`; returns `{ rows, total, roles }` with per-row `id → role` correlation.
- Added `apps/root/src/discovery/SessionRoleBadge.tsx` — localized, accessible role badge mapping `host`, `moderator`, `debater-A`/`debater-B → debater`; driven through the `renderRowActions` slot.
- Wired route in `apps/root/src/App.tsx` and added authenticated "My sessions" link in `apps/root/src/landing/CallToActionSection.tsx`.
- Added i18n keys `discovery.mySessions.*` (title, subtitle, role labels + aria) and `landing.cta.viewMySessions` to all three catalogs: `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`.
- Added `chromium-my-sessions` Playwright project in `playwright.config.ts`.
- Tests: `apps/root/src/routes/MySessionsRoute.test.tsx` (auth gate × 4 statuses, credentialed fetch, role badges, lobby rows), `apps/root/src/routes/MySessionsRoute.a11y.test.tsx` (axe structural pins), `apps/root/src/discovery/mySessionsFetcher.test.ts` (querystring / credentialed / role-map), `apps/root/src/discovery/SessionRoleBadge.test.tsx` (mapping / labels / aria).
- e2e: `tests/e2e/my-sessions-page.spec.ts` — auth-bounce, host-badge + lobby-row render, search/empty/pagination, landing reachability, axe scan. Two fixes applied by fixer: bounded list with `h-screen overflow-y-auto` to prevent viewport overflow, and anonymous context made truly anonymous via explicit `storageState: { cookies: [], origins: [] }`.
