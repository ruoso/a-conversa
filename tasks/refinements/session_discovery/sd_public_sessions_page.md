# sd_public_sessions_page — Public Sessions page (anonymous)

## TaskJuggler entry

- WBS task: `session_discovery.sd_frontend.sd_public_sessions_page`
- Defined in [`tasks/75-session-discovery.tji`](../../75-session-discovery.tji) (lines 64–69), under `sd_frontend`.
- Back-link note in the `.tji`: *"Public route in the root app, linked from the landing page. No auth required (the endpoint is anonymous)."*

## Effort estimate

**1 day.** The shared list component, the public endpoint, and the i18n
`discovery.*` block already exist; this task is a thin route component, a
public fetcher adapter, a landing-page entry link, three locale string
additions, and the focused tests that pin all of it.

## Inherited dependencies

`depends !sd_session_list_component` — which itself chains
`sd_session_list_component → sd_api → sd_schema`.

**Settled (all predecessors complete):**

- **`sd_schema`** (done) — `sessions.started_at TIMESTAMPTZ NULL`, backfilled,
  written on the lobby→operate transition; partial index
  `sessions_public_started_idx ON sessions (started_at DESC) WHERE privacy = 'public' AND started_at IS NOT NULL`.
- **`sd_public_sessions_endpoint`** (done) — `GET /api/sessions/public`,
  anonymous, started-only. Defined in `apps/server/src/sessions/routes.ts`.
  Query params: `topic` (ILIKE substring, 3–64 chars), `startedAfter` /
  `startedBefore` (ISO-8601 `date-time` bounds on `started_at`), `limit`
  (default 50, max 200), `offset` (default 0, max 100 000). Response:
  `{ sessions: [{ id, topic, startedAt, endedAt }], total }`. Returns
  **only** `privacy='public' AND started_at IS NOT NULL`, sorted
  `started_at DESC, created_at DESC`; carries listing fields only — no
  participant/host data.
- **`sd_session_list_component`** (done) — `SessionList` at
  `apps/root/src/discovery/SessionList.tsx`. Props (lines 88–106):
  `fetchPage: SessionListFetcher` (required), `limit?`, `renderRowActions?`,
  `lobbyRowsPossible?`, `debounceMs?`. View-model `SessionListRow`
  (lines 51–58): `{ id, topic, startedAt: string|null, endedAt: string|null }`.
  Fetcher seam `SessionListFetcher = (query: SessionListQuery) => Promise<SessionListPage>`
  (lines 85–86). The component owns debounced topic search, date filters,
  pagination, loading/empty/error states, and accessibility; it is exercised
  by 14 Vitest specs in `apps/root/src/discovery/SessionList.test.tsx` through
  injected fetchers. Its Playwright + axe coverage was **deferred** to the
  page tasks (`sd_my_sessions_page`, this task) and the cross-flow `sd_e2e`.

**Pending (later siblings, not blockers):**

- **`sd_join_live_link`** and **`sd_see_replay_link`** (both
  `depends !sd_session_list_component`, not on this page) supply the per-row
  "join live" / "see replay" affordances via the component's
  `renderRowActions` slot. This page mounts the list **without** row actions
  until those tasks wire them in (see Decisions D4).
- **`sd_e2e`** (`depends !sd_frontend`) owns the integrated cross-surface
  discovery journeys against the seeded compose stack.

## What this task is

Add the anonymous **Public Sessions** page to the root app: a public route
that mounts the shared `SessionList` component fed by a fetcher hitting
`GET /api/sessions/public`, plus the entry link from the landing page that
makes the route reachable. The page renders the list of already-started
public sessions (paginated, searchable by topic, filterable by date) with no
authentication required. Per-row "join live" / "see replay" affordances are
out of scope here — they are wired by the dedicated link tasks into the
component's render slot.

## Why it needs to be done

`SessionList` and `GET /api/sessions/public` exist but nothing renders them:
no route mounts the component and no surface drives it. This task is the
**wiring task** that makes the public discovery surface reachable from the
landing page — the first user-facing entry point into session discovery for
signed-out visitors. It also discharges the component's deferred
Playwright/axe debt for the public list (the component refinement named this
task as one of its three e2e targets), and it unblocks the row-action link
tasks (`sd_join_live_link`, `sd_see_replay_link`), which need a mounted page
to render their affordances into.

## Inputs / context

- **WBS + product constraints** — [`tasks/75-session-discovery.tji`](../../75-session-discovery.tji):
  header lines 9–22 fix the lobby-secrecy rule ("Public Sessions lists ONLY
  public sessions that have already started"); task block lines 64–69.
- **Public endpoint contract** — `apps/server/src/sessions/routes.ts`
  (`publicListSessionsQuerystringSchema`, `PublicSessionResponse`,
  `publicSessionRowToResponse`); refinement
  [`sd_public_sessions_endpoint.md`](sd_public_sessions_endpoint.md).
- **Shared component** — `apps/root/src/discovery/SessionList.tsx:88` (props),
  `:51` (`SessionListRow`), `:85` (`SessionListFetcher`); test patterns in
  `apps/root/src/discovery/SessionList.test.tsx`; refinement
  [`sd_session_list_component.md`](sd_session_list_component.md).
- **Routing** — `apps/root/src/App.tsx:2` (`import { Navigate, Route, Routes } from 'react-router-dom'`),
  `:42–53` (the `<Routes>` block; existing paths `/`, `/login`,
  `/screen-name`, `/logout`, `/auth/callback`, `/m/*`, `/p/*`, `/a/*`,
  `/t/*`, and a `*` → `/` fallback).
- **Route component convention** — `apps/root/src/routes/` (e.g.
  `LandingRoute.tsx:26` `export function LandingRoute(): ReactElement`,
  imports `useTranslation` from `react-i18next`); a11y companion pattern
  `apps/root/src/routes/LandingRoute.a11y.test.tsx`.
- **Landing entry point** — `apps/root/src/landing/CallToActionSection.tsx:52–71`
  (the flex container holding the existing primary action `<Link>`s;
  `useTranslation` at `:22`/`:31`).
- **Fetch pattern** — direct `fetch()` with relative `/api/...` URLs; the
  authenticated example at `apps/root/src/App.tsx:21–24` uses
  `credentials: 'include'`. No centralized client module exists.
- **i18n catalog** — `packages/i18n-catalogs/src/catalogs/en-US.json:2–40`
  already has the `discovery.*` block (search, dateFilter, status, columns,
  list, pagination, loading, empty, error, notStarted). Locale siblings
  `pt-BR.json`, `es-419.json` in the same directory.
- **ADRs** —
  [0026](../../../docs/adr/0026-micro-frontend-root-app.md) (root-app layout),
  [0029](../../../docs/adr/0029-anonymous-ws-subscribe-for-public-sessions.md)
  (anonymous public-session access),
  [0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) (i18n),
  [0040](../../../docs/adr/0040-automated-accessibility-checks-axe-playwright.md) (axe),
  [0008](../../../docs/adr/0008-e2e-framework-playwright.md) (Playwright),
  [0006](../../../docs/adr/0006-unit-test-framework-vitest.md) (Vitest),
  [0022](../../../docs/adr/0022-no-throwaway-verifications.md) (test discipline).

## Constraints / requirements

1. **Anonymous.** No auth gate; the route renders for signed-out visitors.
   The fetcher targets the anonymous endpoint and must not require or assume
   a session cookie (ADR 0029).
2. **Lobby-secrecy is preserved by construction.** The page must not
   reintroduce any path that surfaces unstarted public sessions. It relies
   entirely on the endpoint's `started_at IS NOT NULL` gate — the page adds
   no client-side fetch that could leak lobby ids.
3. **Reuse the shared component unchanged.** Drive everything through
   `SessionList`'s existing props. Do not fork the component or add
   public-specific branches inside it; the public/private difference is
   data-source + affordances, supplied from outside (per the component
   refinement's design).
4. **`lobbyRowsPossible={false}`.** The public list is started-only, so the
   date-filter lobby-exclusion note must be suppressed (component prop D7).
5. **Localized in all three locales** (en-US / pt-BR / es-419) per ADR 0024.
   New keys go under the existing `discovery.*` block and the landing CTA
   block; no hard-coded user-facing strings.
6. **Accessible** per ADR 0040 — the route must pass an axe scan; the page
   chrome (heading, landmarks) follows the existing route components'
   structure.
7. **Reachable from the landing page** — the landing page gains a visible
   link to the route; the route is registered in `App.tsx`.
8. Forward-only, no edits to the component, endpoint, or schema. No new
   runtime dependency (React Router and react-i18next are already present).

## Acceptance criteria

All criteria land as committed tests at the right layer per ADR 0022 — no
throwaway probes.

**Vitest + React Testing Library** (`apps/root/src/routes/PublicSessionsRoute.test.tsx`
and `apps/root/src/discovery/publicSessionsFetcher.test.ts`):

1. The route component mounts `SessionList` and renders a localized page
   heading; with a stub fetcher returning rows, the rows render.
2. The public fetcher builds the correct querystring from a
   `SessionListQuery` (`topic`, `startedAfter`, `startedBefore`, `limit`,
   `offset` — omitting absent optional params) against `/api/sessions/public`,
   and maps the `{ sessions, total }` response into
   `{ rows: SessionListRow[], total }`. A test pins that the fetch is issued
   to the public path and that no auth-only fields are expected in the
   mapping.
3. The route passes `lobbyRowsPossible={false}` to the component (asserted
   via the absence of the lobby-exclusion note when a date filter is active).

**Accessibility** (`apps/root/src/routes/PublicSessionsRoute.a11y.test.tsx`,
mirroring `LandingRoute.a11y.test.tsx`): the rendered page has no axe
violations (ADR 0040).

**Playwright e2e** (`apps/root/` Playwright project, against the seeded
compose stack — ADR 0008; this task pays down the component's deferred e2e
debt for the public list and is **not** deferred, because the route is now
reachable):

4. The landing page shows a "Public sessions" link that navigates to the
   public route.
5. The route lists a seeded **started** public session.
6. **Lobby-secrecy UI pin:** a seeded **unstarted** public session does
   **not** appear in the list (the load-bearing constraint, observed at the
   UI layer).
7. Topic search narrows the list; the pagination control is present and the
   empty state shows for a no-match search.

**Scope split with `sd_e2e`:** this task's Playwright spec covers
page-reachability, the public-list render, the lobby-secrecy pin, and
search/pagination/empty for the public page in isolation. The broader
cross-surface journeys — role-aware join-live routing
(`/m` / `/p` / `/a`), signed-out join-live landing in `/a`, see-replay
landing in the audience replay surface, My Sessions interplay, and the
per-locale project sweep — remain with **`sd_e2e`** (already scoped there;
those affordances do not exist until `sd_join_live_link` /
`sd_see_replay_link` land). No new future task is registered by this
refinement.

## Decisions

- **D1 — Route path `/sessions` (public, anonymous).** The public discovery
  surface is the default, signed-out-reachable browse, so it takes the short
  canonical path linked from the landing page. *Alternatives:*
  `/sessions/public` (more explicit but verbose for the anonymous default),
  `/public-sessions`, `/browse`. Rejected in favor of `/sessions` for
  brevity and because the authenticated **My Sessions** page can sit at a
  sibling path (e.g. `/sessions/mine`, that task's call) without collision —
  `sd_my_sessions_page` decides its own route; this refinement does not
  constrain it.
- **D2 — Route component `apps/root/src/routes/PublicSessionsRoute.tsx`,
  registered in `App.tsx:42–53`.** Matches the existing route-component
  convention (`LandingRoute`, `LoginRoute`, …): a named-function default
  export returning a `<main>` with `useTranslation`. *Alternative:* a
  lazy-loaded route like `SurfaceHost` — unnecessary, the page is light and
  the discovery component is already in the root bundle.
- **D3 — Public fetcher as a standalone module
  `apps/root/src/discovery/publicSessionsFetcher.ts`.** Owns the endpoint
  URL, querystring assembly, and `PublicSessionResponse → SessionListRow`
  mapping, injected into `SessionList` via `fetchPage`. This keeps the
  data-access seam outside the component (its core design) and makes the
  mapping unit-testable without rendering. Uses a plain `fetch()` with
  relative `/api/sessions/public` and **no** `credentials: 'include'` (the
  endpoint is anonymous — ADR 0029 — so a cookie is neither needed nor sent);
  the authenticated My Sessions fetcher (separate task) will opt into
  credentials. *Alternative:* an inline fetcher closure in the route — harder
  to unit-test the mapping in isolation.
- **D4 — Mount `SessionList` without `renderRowActions` for now.** The
  per-row "join live" / "see replay" affordances are the explicit
  deliverables of `sd_join_live_link` and `sd_see_replay_link`, which
  `depend !sd_session_list_component` (not on this page). At this task's
  landing the slot is left empty (the component renders rows as data-only);
  the link tasks add the `renderRowActions` wiring into this page (and the My
  Sessions page) when they land. *Alternative:* synthesize provisional
  actions here from `startedAt`/`endedAt` — rejected as duplicated,
  throwaway work that the link tasks would immediately replace, and it would
  pre-empt their routing decisions.
- **D5 — `lobbyRowsPossible={false}`.** The public list is started-only by
  the endpoint's gate, so the lobby-exclusion note is meaningless here and is
  suppressed via the prop (component D7). The page does no client-side
  filtering of its own.
- **D6 — Landing entry link in `CallToActionSection.tsx:52–71`.** The new
  "Public sessions" `<Link to="/sessions">` joins the existing primary-action
  flex row, which is where the landing page already surfaces its main
  call-to-action links and where signed-out visitors look first. *Alternative:*
  a dedicated global nav/header — the root app has no such chrome today, so
  adding one is out of scope; the CTA row is the established affordance.
- **D7 — New i18n keys under existing blocks.** Add
  `discovery.publicSessions.title` (page heading) and, if an intro line is
  used, `discovery.publicSessions.subtitle`, plus a landing-link label
  (`landing.cta.browsePublicSessions`) — to all three catalogs (`en-US`,
  `pt-BR`, `es-419`) per ADR 0024. The component's `discovery.*` strings
  already cover the list internals; this task adds only the page chrome and
  link label.
- **D8 — Focused Playwright spec here, integrated journeys in `sd_e2e`.**
  Because the route is reachable, full e2e deferral is not allowed (UI-stream
  e2e policy); the page pays its own reachability + lobby-secrecy debt with a
  thin compose-stack spec, while the cross-surface routing stays in the
  dedicated `sd_e2e` task. *Alternative:* defer everything to `sd_e2e` —
  rejected: it would pile a third refinement's worth of debt on one catch-all
  and leave the page's load-bearing lobby-secrecy pin unverified at its own
  surface.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-12.

- `apps/root/src/discovery/publicSessionsFetcher.ts` — anonymous fetcher targeting `GET /api/sessions/public` with no `credentials: 'include'` (ADR 0029); builds querystring from `SessionListQuery` and maps `{ sessions, total }` → `{ rows: SessionListRow[], total }`.
- `apps/root/src/discovery/publicSessionsFetcher.test.ts` — Vitest specs pin querystring assembly, response mapping, anonymous posture (no auth-only fields expected).
- `apps/root/src/routes/PublicSessionsRoute.tsx` — anonymous route component at `/sessions`; mounts `SessionList` with `lobbyRowsPossible={false}` and no `renderRowActions` (D4); uses `useTranslation` for page heading.
- `apps/root/src/routes/PublicSessionsRoute.test.tsx` — Vitest specs: heading renders, rows render with stub fetcher, `lobbyRowsPossible={false}` confirmed by absence of lobby-exclusion note under active date filter.
- `apps/root/src/routes/PublicSessionsRoute.a11y.test.tsx` — structural axe scan (mirrors `LandingRoute.a11y.test.tsx`).
- `tests/e2e/public-sessions-page.spec.ts` — Playwright spec: landing link navigates to `/sessions`; started public session appears; unstarted public session absent (lobby-secrecy UI pin, D8); topic search narrows list; empty state shows for no-match; pagination control present; axe WCAG-AA scan.
- `apps/root/src/App.tsx` — `/sessions` route registered.
- `apps/root/src/landing/CallToActionSection.tsx` — "Browse public sessions" `<Link to="/sessions">` added to CTA row (D6); i18n key `landing.cta.browsePublicSessions`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — `discovery.publicSessions.{title,subtitle}` and `landing.cta.browsePublicSessions` added to all three locales.
- `playwright.config.ts` — `chromium-public-sessions` project added (deps on `setup-auth`).
