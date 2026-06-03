# split_public_and_home_routes

## TaskJuggler entry

`tasks/47-landing-page.tji` → `task landing_page` → `task split_public_and_home_routes`
("Split the public marketing landing (`/`) from the authenticated dashboard (`/home`)").

## Effort estimate

1d (`effort 1d`, `allocate team`).

## Inherited dependencies

- **`depends root_app`** (the whole `apps/root/` work-stream — `tasks/45-root-app.tji`).
  - **Settled** by `root_app`:
    - The route table lives in `apps/root/src/App.tsx:42-52` — top-level
      `<Routes>` owned by root, under `BrowserRouter` + `AuthProvider` +
      `I18nProvider` (ADR 0026 — micro-frontend root-app architecture).
    - The four auth-chrome routes (`/login`, `/screen-name`, `/logout`,
      `/auth/callback`) and the surface dispatcher (`/m/*`, `/p/*`, `/a/*`)
      are extracted and pinned in Vitest
      (`tasks/refinements/root-app/root_moderator_cutover.md`,
      `root_landing.md`, `root_tests.md`).
    - The **remembered-return-to** deep-link mechanism is built and
      sanitised: `rememberReturnTo` / `takeRememberedReturnTo` /
      `sanitizeReturnTo` in
      `apps/root/src/surfaces/SurfaceHost.tsx:9-39`. Today three routes
      consume it (`LandingRoute`, `LoginRoute`, `ScreenNameRoute`); the
      writer is `AuthCallbackRoute` + `SurfaceHost`'s deflection path.
    - Playwright smoke for the auth chrome lives in
      `tests/e2e/auth-flow.spec.ts` (a `test.describe.serial` block;
      scenarios 5 `landing-to-lobby` and 6 `root-landing-new-user` already
      exercise the `/` landing behaviour this task changes).
- **No pending dependencies.** Everything this task touches is already on
  disk and green.

## What this task is

Today `/` is a single route (`apps/root/src/routes/LandingRoute.tsx`) doing
two jobs in one component:

1. **Public placeholder** for anonymous visitors — eyebrow / title / body
   + a "start a session" CTA + a login button (lines 73-98).
2. **Authenticated app home** — personalised welcome + "open moderator"
   (start-a-session) + logout (lines 36-70).

Plus the auth-state plumbing that shepherds OIDC returnees who land back on
`/` (= `APP_BASE_URL`): `loading → LoadingFrame`, `needs-screen-name →
/screen-name`, and `authenticated → consume remembered return-to` (lines
14-35).

This task **splits the two jobs into two routes**:

- `/` becomes the **public marketing page** (anonymous-facing). For this
  task it keeps rendering the existing placeholder content — the real hero /
  "how it works" / walkthrough demo are built by the downstream content
  tasks that `depends !split_public_and_home_routes`
  (`landing_hero_and_method`, `landing_opensource_and_cta`,
  `walkthrough_demo_stepper`, …). This task is the **routing split /
  scaffold**, not the content.
- `/home` becomes the **authenticated dashboard** (welcome +
  start-a-session + logout), reachable only when authenticated.

The remembered-return-to deep-link handling and the symmetry of the
`/login` ↔ `/screen-name` ↔ `/logout` auth chrome must be preserved across
the split.

## Why it needs to be done

- M8-landing (the public landing milestone) needs `/` to be a real public
  marketing surface, not a route that also doubles as the logged-in home.
  Every downstream content task (`landing_hero_and_method`,
  `landing_opensource_and_cta`, `walkthrough_demo_stepper`, …) hangs off
  this split (`depends !split_public_and_home_routes`) — they assume `/` is
  the anonymous marketing surface and the authenticated dashboard lives
  elsewhere.
- The landing milestone gates M9 (Deployment ready): `a-conversa.org` must
  not ship the developer placeholder currently served at `/`
  (`tasks/47-landing-page.tji:9-12`). Splitting the routes is the
  prerequisite that lets the marketing content replace the placeholder at
  `/` without disturbing the logged-in dashboard.
- `landing_e2e` (the milestone's terminal Playwright task) asserts exactly
  this split holds: "an anonymous visit to `/` renders the narrative
  sections … `/home` requires auth (anonymous is routed to login)"
  (`tasks/47-landing-page.tji:167-177`).

## Inputs / context

- `apps/root/src/routes/LandingRoute.tsx:1-99` — the route being split.
  - `:14-20` — `loading → LoadingFrame`; `needs-screen-name →
    Navigate('/screen-name')`.
  - `:22-35` — authenticated branch consumes `takeRememberedReturnTo()`
    and `Navigate(remembered)` (the deep-link return-to). The comment at
    `:24-30` documents *why*: the OIDC returning-user branch 302s back to
    `APP_BASE_URL` (`/`), so `/` is where returnees land.
  - `:36-70` — authenticated dashboard card: `root-authenticated-eyebrow`,
    `route-title` (`auth.login.welcome` with `screenName`),
    `root-open-moderator` link → `/m/sessions/new`, `root-logout-link` →
    `/logout`. Root element `data-testid="route-home"`.
  - `:73-98` — unauthenticated placeholder: eyebrow (`root.landing.eyebrow`),
    `route-title` (`auth.login.title`), body (`root.landing.body`),
    `root-start-session` link → `/m/sessions/new`, `<LoginButton>`. Root
    element `data-testid="route-home"`.
- `apps/root/src/App.tsx:42-52` — the route table. `/` → `LandingRoute`;
  `*` → `Navigate('/')`. The `/home` route is added here.
- `apps/root/src/surfaces/SurfaceHost.tsx:9-39` — `RETURN_TO_KEY`
  (`'a-conversa:return-to'`), `sanitizeReturnTo` (rewrites `/login`,
  `/screen-name`, `/logout` → `/`; rejects non-`/` and `//`),
  `rememberReturnTo`, `takeRememberedReturnTo` (read-and-clear). The
  deflection path (`rememberReturnTo(location…)` + `Navigate('/login')`)
  is what stores a deep link when an anonymous visitor hits `/m/*` or
  `/p/*`.
- `apps/root/src/routes/LoginRoute.tsx:11-13,40-42` —
  `resolvePostAuthTarget()` returns `takeRememberedReturnTo() ?? '/'`;
  authenticated → `Navigate(resolvePostAuthTarget())`. The `?? '/'`
  fallback target moves to `/home` under this task.
- `apps/root/src/routes/ScreenNameRoute.tsx:10-12,37-39` — same
  `resolvePostAuthTarget()` with `?? '/'` fallback (the race-avoidance
  comment at `:46-54` explains why only the route's `Navigate` consumes the
  return-to, not `onSuccess`). The `?? '/'` fallback moves to `/home`.
- `apps/root/src/routes/AuthCallbackRoute.tsx:6-13` — reads `?return_to`,
  `rememberReturnTo`, then `Navigate('/login')`. Unchanged by this task.
- Existing tests that pin the behaviour being split:
  - `apps/root/src/routes/LandingRoute.test.tsx:37-131` — five cases
    (loading; `needs-screen-name`; consume return-to; authenticated card;
    unauthenticated card).
  - `apps/root/src/App.test.tsx:19-130` — the `/` start-session link
    (`:30-39`), the authenticated landing handoff (`:56-73`), the `/m`
    deflect+remember (`:75-103`).
  - `tests/e2e/auth-flow.spec.ts` scenarios 5 (`landing-to-lobby`, ~lines
    230-316) and 6 (`root-landing-new-user`, ~lines 321-391).
- i18n: `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` —
  `root.landing.eyebrow` / `root.landing.body` already exist; the
  authenticated card reuses `auth.login.welcome`,
  `moderator.createSession.title`, `auth.login.logout`. **No new i18n keys
  are needed** for this scaffold split (new marketing strings are owned by
  `landing_hero_and_method`).
- ADR 0026 — root-app micro-frontend architecture (route table ownership,
  the return-to contract). ADR 0022 — no-throwaway verifications (test
  contract this task's acceptance references).

## Constraints / requirements

1. **`/` is the public marketing surface.** Anonymous visitors render the
   public placeholder content (the existing `:73-98` card, unchanged) — this
   task does not author new marketing copy.
2. **`/home` is the authenticated dashboard.** It renders the existing
   authenticated card (welcome + `root-open-moderator` + `root-logout-link`)
   and is the post-auth home.
3. **Anonymous `/home` requires auth.** An unauthenticated visit to `/home`
   must route into login (`Navigate('/login')`, which kicks off SSO) — never
   render the dashboard to an anonymous user. This is the "`/home` requires
   auth" contract `landing_e2e` asserts.
4. **Preserve the deep-link return-to.** A returning user who deep-linked
   into `/m/sessions/new` (deflected → remembered → OIDC) must still be
   carried to `/m/sessions/new` after auth, not stranded on a card. The
   return-to is consumed exactly once.
5. **OIDC returnees land at `/`.** The returning-user OIDC branch 302s to
   `APP_BASE_URL` (`/`) — **do not change `APP_BASE_URL` or the OIDC
   redirect target** (backend concern, out of scope). `/` must shepherd
   authenticated and `needs-screen-name` returnees onward rather than
   stranding them on marketing content.
6. **Keep the auth chrome symmetric.** `/login`, `/screen-name`, `/logout`,
   `/auth/callback` keep their current shape; only their post-auth *fallback
   target* changes from `/` to `/home` (the logged-in home moved).
7. **No new dependencies, no cross-app imports** (ADR 0026). Reuse the
   existing return-to seam in `SurfaceHost.tsx`; do not duplicate it.
8. **`needs-screen-name` continuity.** A mid-onboarding user landing on `/`
   or `/home` is redirected to `/screen-name` (parity with today's
   `LandingRoute:18-20`) so onboarding completes.

## Acceptance criteria

All checks are durable test artifacts per **ADR 0022** (no throwaway
verifications) — they live in the suites below and run in CI.

**Vitest (component / integration — `apps/root`):**

1. New `apps/root/src/routes/HomeRoute.test.tsx` pins `/home`:
   - `loading` → `LoadingFrame` (`auth-checking`), no dashboard.
   - `needs-screen-name` → redirect to `/screen-name`.
   - `unauthenticated` → redirect to `/login` (no `route-home` rendered).
   - `authenticated`, no remembered return-to → dashboard card
     (`root-open-moderator`, `root-logout-link`, `route-title` contains the
     screen name, `root-authenticated-eyebrow` = `a-conversa`).
   - `authenticated`, remembered return-to `/m/sessions/new` → `Navigate`
     there; sessionStorage entry cleared (return-to consumed once).
2. `apps/root/src/routes/LandingRoute.test.tsx` is updated for the public
   `/`:
   - `unauthenticated` → public placeholder (`root-start-session`,
     `auth-login-button`, i18n eyebrow/body), root testid is the new public
     testid (see Decisions), **not** `route-home`.
   - `authenticated` → redirect to `/home` (assert a `/home` stub renders);
     `/` no longer renders the dashboard card and no longer consumes
     return-to.
   - `loading` → `LoadingFrame`; `needs-screen-name` → `/screen-name`
     (retained).
3. `apps/root/src/App.test.tsx` updated: the authenticated-`/`-handoff case
   now asserts the redirect to `/home`; a new/`updated` case asserts
   `/home` renders the dashboard for an authenticated user; the
   `/m`-deflect+remember case is unchanged.
4. `apps/root/src/routes/LoginRoute.test.tsx` and `ScreenNameRoute.test.tsx`
   updated so the no-remembered-return-to fallback navigates to `/home`
   (was `/`).

**Playwright (e2e — `tests/e2e/auth-flow.spec.ts`):** this task changes the
*observable routing* the existing scenarios assert, and the routes are
reachable today, so the pin is updated **inline** (not deferred):

5. Scenario 6 (`root-landing-new-user`): after OIDC the URL settles on
   `/home` (was `/`) and the authenticated dashboard
   (`root-open-moderator`, `route-title` = the user's name) renders there;
   an anonymous visit to `/home` is routed to login.
6. Scenario 5 (`landing-to-lobby`): unchanged in intent — anonymous `/` →
   `root-start-session` → deflect → OIDC → carried to `/m/sessions/new`
   (the deep-link return-to still resolves across the split). Adjust only
   if the public-page testid rename touches its selectors.

**Full-suite gate (per global build/test rule):** `pnpm run test:smoke`
(`pnpm run build && vitest run tests/smoke packages apps`) stays green, and
`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent after the closer's
`.tji` edits.

**The broader landing narrative + walkthrough-demo e2e is NOT in scope
here** — it is already owned by the existing WBS leaf `landing_e2e`
(`tasks/47-landing-page.tji:167-177`), which depends on this task plus the
content/demo tasks. No new deferred task is created; this task only updates
the auth-flow scenarios whose assertions its routing change invalidates.

## Decisions

**D1 — Two route files: `/` keeps `LandingRoute`, `/home` gets a new
`HomeRoute`.** Extract the authenticated dashboard branch
(`LandingRoute.tsx:36-70`) into `apps/root/src/routes/HomeRoute.tsx`; leave
the public placeholder branch in `LandingRoute.tsx` at `/`.
*Rationale:* matches the one-file-per-route convention root_app established
(`LoginRoute.tsx`, `ScreenNameRoute.tsx`, …) and keeps each route's auth
posture readable. *Alternative rejected:* one component branching on a
`mode` prop — it re-creates the very "one route, two jobs" coupling this
task exists to remove.

**D2 — Authenticated visit to `/` redirects to `/home`; only `/home`
consumes the remembered return-to.** `/`'s logic becomes: `loading →
LoadingFrame`; `needs-screen-name → /screen-name`; `authenticated →
Navigate('/home', replace)`; `unauthenticated →` public placeholder. `/`
**no longer** calls `takeRememberedReturnTo()`. `/home`'s authenticated
branch consumes the return-to (`takeRememberedReturnTo()` → `Navigate`) and
otherwise renders the dashboard.
*Rationale:* OIDC returnees land at `/` (`APP_BASE_URL`, constraint 5).
Keeping a single consumer at `/home` (the logged-in home) keeps consumption
unambiguous: the `/ → /home` bounce is a `replace` navigation (no history
pollution), and `/home` is the one place the dashboard-or-deep-link
decision is made. A returning deep-linker still reaches their target:
`OIDC → / → /home → takeRememberedReturnTo() → /m/sessions/new`. *Alternative
rejected:* having `/` consume the return-to *before* redirecting — it
splits the single read-and-clear across two routes and risks the dashboard
and `/` both touching sessionStorage; concentrating it at `/home` is
simpler and mirrors the existing `LoginRoute`/`ScreenNameRoute` pattern of
"the post-auth landing route is the consumer."

**D3 — Authenticated users do not see the public marketing page (they are
bounced to `/home`).** *Rationale:* the methodology pitch is a top-of-funnel
acquisition surface; a logged-in user's home is the dashboard, and bouncing
them prevents a flash of marketing before the redirect resolves. *Alternative
rejected:* render marketing at `/` for everyone with a "go to dashboard"
affordance for logged-in users — defensible product-wise, but it would
strand OIDC returnees (and `needs-screen-name` users) on marketing content
and break the return-to/onboarding continuity that lands at `/`. If product
later wants logged-in users to browse the marketing page, that is a content
decision for the narrative tasks (e.g. an "About" link), not a routing
change here — surfaced to the parking lot, **not** a WBS leaf.

**D4 — Auth-chrome post-auth fallback target moves from `/` to `/home`.**
`LoginRoute`/`ScreenNameRoute`'s `resolvePostAuthTarget()` fallback
`takeRememberedReturnTo() ?? '/'` becomes `?? '/home'`.
*Rationale:* after the split the logged-in home is `/home`; falling back to
`/` would just bounce through the `/ → /home` redirect anyway (D2).
Pointing the fallback straight at `/home` keeps the chrome symmetric and
avoids the extra hop. Deep-link returns are unaffected (they resolve the
remembered value before the fallback).

**D5 — Distinct root `data-testid`s for the two surfaces.** `/home`'s
dashboard `<main>` keeps `data-testid="route-home"` (now semantically
accurate — it *is* the home); the public `/` `<main>` gets a new
`data-testid="route-landing"`. Affordance testids stay stable and move with
their content: `root-start-session` + `auth-login-button` stay on `/`;
`root-open-moderator`, `root-logout-link`, `root-authenticated-eyebrow`
move to `/home`.
*Rationale:* lets Vitest and Playwright distinguish "public landing" from
"home dashboard" without brittle text matching, and keeps downstream
content/e2e selectors stable (only the renamed public-root testid churns).

**D6 — No ADR required.** This task reuses existing seams (the route table,
the `SurfaceHost` return-to mechanism, the auth-state branches) and adds no
dependency, no new architectural boundary, and no security trade-off beyond
preserving the existing auth gating (constraint 3). ADR 0026 already governs
the route table and return-to contract; this is an application of it, not a
new decision. *(If, during implementation, the `/home` gating turns out to
need a shared `RequireAuth`-style wrapper reused by future routes, that is
an ADR-worthy seam — but with one call site today the inline branch is the
simpler, defensible choice.)*

**D7 — No backend / `APP_BASE_URL` / OIDC change.** The `/ → /home` bounce
absorbs the fact that OIDC returnees land at `/`. *Rationale:* keeps the
task purely front-end and 1d-sized; touching the OIDC redirect target is a
backend concern outside this task's scope (constraint 5).

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- `apps/root/src/routes/HomeRoute.tsx` (new) — authenticated `/home` dashboard; gates anonymous → `/login`, consumes `takeRememberedReturnTo()`, renders welcome/start-session/logout card with `data-testid="route-home"`.
- `apps/root/src/routes/LandingRoute.tsx` — slimmed to public-only `/`; authenticated → `Navigate('/home', replace)`; no longer calls `takeRememberedReturnTo()`; root testid is now `route-landing`.
- `apps/root/src/App.tsx` — added `/home` route wired to `HomeRoute`.
- `apps/root/src/routes/LoginRoute.tsx`, `ScreenNameRoute.tsx` — post-auth fallback `?? '/'` → `?? '/home'`.
- `apps/root/src/routes/HomeRoute.test.tsx` (new) — 5 Vitest cases: loading/needs-screen-name/unauthenticated→login/dashboard/return-to-consumed.
- `apps/root/src/routes/LandingRoute.test.tsx` — updated: public `route-landing` testid, authenticated → `/home`, no return-to consume.
- `apps/root/src/App.test.tsx` — new `/home` dashboard case + `/` → `/home` handoff assertion.
- `apps/root/src/routes/LoginRoute.test.tsx`, `ScreenNameRoute.test.tsx` — fallback navigates to `/home`.
- `tests/e2e/auth-flow.spec.ts` — scenario 6 settles on `/home`; new scenario 7 (`home-requires-auth`) asserts anonymous `/home` → SSO.
- `Dockerfile`, `cucumber.cjs` — supporting changes from the implementation.
