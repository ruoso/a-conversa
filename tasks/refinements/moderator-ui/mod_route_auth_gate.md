# Route auth gate — unauthenticated redirect for protected moderator routes

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_shell.mod_route_auth_gate`
**Effort estimate**: 0.5d
**Inherited dependencies**: `mod_auth_flow` (settled — ships `useAuth()` returning the `'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated'` discriminator and the four-state switch pattern in `Login.tsx`), `mod_screen_name_setup` (settled — the `/screen-name` form route is the redirect target for the `needs-screen-name` branch and must NOT be gated itself), `mod_state_management` (settled — three Zustand slices under `apps/moderator/src/stores/` ship, but no Navigate wiring; see the "Inherited dependencies" hand-off note below).

## What this task is

Lands the per-route auth gate the moderator console has been missing since `mod_auth_flow` first shipped. Three protected routes today (`/screen-name`, `/sessions/:id/lobby`, `/sessions/:id/operate`) need a wrapper that consumes `useAuth()` and renders the route content only when the auth state permits it — otherwise renders a `<Navigate>` to the appropriate fallback. The existing `/login` route already does its own four-state switch in-component and stays as-is. The deliverable is one new component (`apps/moderator/src/auth/RequireAuth.tsx`), an `App.tsx` change that wraps each protected route's `element`, and the Vitest cases that pin the redirect rules.

## Why it needs to be done — the unfinished hand-off

`mod_auth_flow.md` was explicit that route gating would land later, not in that task:

> The lobby / operate routes remain reachable directly (gating lands with `mod_state_management`'s store-driven redirect). — `mod_auth_flow.md:87`

And in its Decisions:

> The flow does NOT yet redirect to the moderator's actual operating UI (lobby / operate) — that's `mod_state_management`'s job (introduce a `useAuth`-driven `<Navigate>` after the store lands). — `mod_auth_flow.md:138`

`mod_state_management.md` then shipped three Zustand slices (`captureStore`, `selectionStore`, `uiStore`) but never picked up the gating piece — its Status section enumerates the slices and the `OperateRoute` re-renders that satisfied its AC, with no `<Navigate>` wiring. The "store-driven redirect" promise was dropped on the floor when the state-management round narrowed its scope to local UI state (capture / selection / UI toggles). The hand-off is still real — protected routes today render their content regardless of `/auth/me`'s answer — and this task discharges it.

The two follow-on observations from `mod_auth_flow.md` Open Questions ("Where does an authed user land after /login? Future: mod_state_management adds the <Navigate>...") and the fact that `tests/e2e/i18n-moderator-smoke.spec.ts:147` ("renders the localized login title (the auth gate's redirect target)") already encodes the expected behavior into the e2e suite mean the work is not optional: the e2e suite asserts the redirect lands, and today only the SPA fallback's `Login` render happens to satisfy it incidentally (because `/screen-name` rendered without a session would itself reach for `useAuth()` and show its own title; the spec at line 196 specifically asserts `toBe(expected.loginTitle)`). The gate makes the assertion intentional rather than accidental.

## Inputs / context

- [`apps/moderator/src/App.tsx`](../../../apps/moderator/src/App.tsx) — current router wiring. Four routes (`/login`, `/screen-name`, `/sessions/:id/lobby`, `/sessions/:id/operate`) plus a wildcard `<Navigate to="/login" replace />`. No auth gate today.
- [`apps/moderator/src/auth/useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) — the existing seam. The gate consumes `useAuth().status` (the `'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated'` discriminator). The hook IS the seam — `mod_state_management`'s future Zustand swap of its internals does not change the call-site contract.
- [`apps/moderator/src/routes/Login.tsx`](../../../apps/moderator/src/routes/Login.tsx), lines 31–38 — the four-state switch's loading branch (the placeholder DOM with `data-testid="route-title"` rendering `t('auth.login.title')` and `data-testid="auth-checking"` rendering `t('auth.login.checking')`). The gate reuses this exact DOM shape during its own `'loading'` frame so the existing e2e assertion still holds during bootstrap.
- [`apps/moderator/src/routes/ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx), [`apps/moderator/src/routes/Lobby.tsx`](../../../apps/moderator/src/routes/Lobby.tsx), [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) — the three protected route components that get wrapped.
- [`apps/moderator/src/App.test.tsx`](../../../apps/moderator/src/App.test.tsx) — the Vitest + Testing Library + `MemoryRouter` verification pattern in use for the moderator routes. The existing `describe('moderator router')` block at line 82 and `describe('Login route — auth states')` at line 137 are the templates this task's new cases mirror.
- [`tests/e2e/i18n-moderator-smoke.spec.ts`](../../../tests/e2e/i18n-moderator-smoke.spec.ts), line 147 — the spec named `'GET /screen-name renders the SPA shell (client-side route)'` whose narrative comment (lines 156–160) already documents the expected behavior: "the screen-name route falls back to the auth gate, which in turn redirects unauthenticated users back to `/login`. Whichever path runs, the bundle must still render a localized title." The assertion at line 196 (`expect(titleText, ...).toBe(expected.loginTitle)`) is the authoritative pin that the gate redirects an unauthenticated visit to `/screen-name` to the login title.
- [`tests/e2e/i18n-moderator-smoke.spec.ts`](../../../tests/e2e/i18n-moderator-smoke.spec.ts), lines 55 + 92 — the two pre-existing specs that load `/` and assert the login title; the gate must not regress them (an unauthenticated landing on `/` falls through to the wildcard `<Navigate to="/login" replace />` which then renders the Login route; the gate change does not touch that path).
- [`tasks/refinements/frontend-i18n/i18n_testing.md`](../frontend-i18n/i18n_testing.md), line 61 — the bullet enumerating the three smoke specs in the deliverables, including the `/screen-name` case explicitly framed as "the auth gate's redirect target." Line 71 then notes the e2e suite is the authoritative verification (the local runner did not have docker; CI is the real check).
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification of the new behavior is a committed test. The added cases for the four-state branch behavior on each protected route ARE the probes.

## Per-route auth contract

The gate's behavior, route-by-route:

- **`/login`** — no wrapper. The route renders the four-state switch in-component (`Login.tsx`:31–74). Adding a wrapper would create a redirect cycle (`unauthenticated` → `/login` → wrapper → `unauthenticated` → `/login` → …). Leave it alone. The existing `Login.tsx` is the canonical four-state renderer; the wrapper component lifts that shape for routes that don't need to render every state themselves.
- **`/screen-name`** — wrap with the `'needs-screen-name-only'` mode. The route accepts only `status === 'needs-screen-name'`; rejects `'unauthenticated'` to `/login`; rejects `'authenticated'` to `/login` (the user has nothing to do on the screen-name form once their name is set). On `'loading'`, render the placeholder DOM described below.
- **`/sessions/:id/lobby`** and **`/sessions/:id/operate`** — wrap with the `'authenticated-only'` mode. The routes accept only `status === 'authenticated'`; reject `'unauthenticated'` to `/login`; reject `'needs-screen-name'` to `/screen-name` (so a half-authed user lands on the form rather than seeing an empty operate canvas). On `'loading'`, render the same placeholder DOM.

The `'loading'` branch render mirrors `Login.tsx`:31–38 exactly:

```tsx
<main data-testid="route-login">
  <h1 data-testid="route-title">{t('auth.login.title')}</h1>
  <p data-testid="auth-checking">{t('auth.login.checking')}</p>
</main>
```

Rationale: the smoke spec at `tests/e2e/i18n-moderator-smoke.spec.ts:147` calls `getByTestId('route-title').toBeVisible()` (line 174) before the strict text assertion at line 196. If the gate renders its own placeholder with a `route-title` H1 carrying `t('auth.login.title')`, the title is present immediately at bootstrap and the spec's "is visible" precondition holds during the brief `loading` frame; the wrapper then re-renders to `<Navigate to="/login" replace />` once `status` settles to `'unauthenticated'`, the router lands on `/login`, and `Login.tsx` renders the same title text — so the strict-text assertion at line 196 passes both during the bootstrap frame AND after the redirect resolves. Reusing the exact DOM shape (testid names + i18n keys) means the wrapper doesn't introduce a new "blank frame" gap that flickers between bootstrap and redirect.

## Design choices to settle (with rationale)

### 1. Wrapper component vs. per-route in-component switch

Two options:

- **Option A — In-component switch in every protected route.** Each of `ScreenName.tsx`, `Lobby.tsx`, `Operate.tsx` grows its own four-state `switch (auth.status)` block at the top of the function, just like `Login.tsx`. The wrapper is just a code-folding convention; no new component lands.
- **Option B — Shared `RequireAuth` wrapper component.** A new `apps/moderator/src/auth/RequireAuth.tsx` exports a component that takes a `mode: 'authenticated-only' | 'needs-screen-name-only'` prop, runs the four-state switch internally, and renders `children` only when the mode-mode-matched branch resolves. `App.tsx` wraps each protected route's `element` with `<RequireAuth mode="…">…</RequireAuth>`.

**Chosen: Option B.** Three protected routes today, but the lobby and operate routes will grow real content in `mod_session_lobby` / `mod_session_setup` / `mod_capture_flow.*` / etc.; every one of those future surfaces inherits "I am authenticated" as a precondition. Duplicating the four-state switch in each route component means future routes either re-implement the switch (DRY violation, easy to drift) or wrap themselves in something — at which point the wrapper-shaped-thing exists in the codebase anyway and we wish it had been named `RequireAuth` from the start. Lifting it now, with the three call sites currently in flight, is cheap and avoids the rewrite later. The wrapper also makes the `App.tsx` route table self-documenting: a glance at `App.tsx` says which routes are gated and in which mode, rather than requiring the reader to open each route component to find out.

The wrapper itself runs `useAuth()` once and contains the same `switch (status)` block; the per-route components consume the wrapper's children-slot, which is only rendered on the matching branch. The wrapper does NOT call `useAuth` more than once per route render — React's component identity guarantees one hook instance per `<RequireAuth>` element, so the bootstrap fetch happens exactly once per route mount (same cost as today's `Login.tsx`).

### 2. Where the wrapper lands in `App.tsx`

Wrap each `element={...}` for the three protected routes. Keep `/login` and the wildcard untouched:

```tsx
<Routes>
  <Route path="/login" element={<LoginRoute />} />
  <Route
    path="/screen-name"
    element={
      <RequireAuth mode="needs-screen-name-only">
        <ScreenNameRoute />
      </RequireAuth>
    }
  />
  <Route
    path="/sessions/:id/lobby"
    element={
      <RequireAuth mode="authenticated-only">
        <LobbyRoute />
      </RequireAuth>
    }
  />
  <Route
    path="/sessions/:id/operate"
    element={
      <RequireAuth mode="authenticated-only">
        <OperateRoute />
      </RequireAuth>
    }
  />
  <Route path="*" element={<Navigate to="/login" replace />} />
</Routes>
```

The wrapper sits at the route level, not as a top-level layout component (which would force `Login.tsx` through the same code path). The two-mode discriminator keeps the API small — three modes (`'public'`, `'authenticated-only'`, `'needs-screen-name-only'`) was considered but `'public'` is degenerate (no wrapper needed); two modes is the minimum that expresses both protected-route shapes the moderator console has today.

### 3. Loading-state UX — mirror `Login.tsx`

The placeholder render during `status === 'loading'` reuses `Login.tsx`'s exact DOM shape (testids + i18n keys, see the contract section above). Two reasons:

1. The e2e smoke spec at `tests/e2e/i18n-moderator-smoke.spec.ts:174` waits for `route-title` to be visible before the strict-text assertion at line 196; matching the Login DOM shape means the title is present during the loading frame and the wait resolves immediately.
2. The user perception of a "checking session…" placeholder is identical regardless of which route triggered it — there's no need for a per-route loading variant. Centralizing the placeholder in the wrapper means future routes inherit the consistent UX automatically.

The i18n keys used (`auth.login.title`, `auth.login.checking`) already exist in all three locale catalogs (shipped by `mod_auth_flow`); no new strings land in this task.

### 4. Redirect loops — the rule

A `'needs-screen-name'` user landing on `/screen-name` MUST NOT redirect. The mode-mode-matched contract enforces this: `'needs-screen-name-only'` accepts `'needs-screen-name'` (renders children — the form), rejects `'unauthenticated'` (to `/login`), rejects `'authenticated'` (to `/login`). Symmetric for `'authenticated-only'`: accepts `'authenticated'`, rejects `'unauthenticated'` (to `/login`), rejects `'needs-screen-name'` (to `/screen-name` — that route's wrapper accepts the state, so no further redirect happens).

The redirect graph, written out:

| state \ route          | `/screen-name`              | `/sessions/:id/lobby` | `/sessions/:id/operate` |
| ---------------------- | --------------------------- | --------------------- | ----------------------- |
| `'loading'`            | placeholder                 | placeholder           | placeholder             |
| `'unauthenticated'`    | → `/login`                  | → `/login`            | → `/login`              |
| `'needs-screen-name'`  | render children (form)      | → `/screen-name`      | → `/screen-name`        |
| `'authenticated'`      | → `/login`                  | render children       | render children         |

No state on any route loops back to itself. The `/login` route renders its own four-state switch and is the universal redirect sink for `'unauthenticated'`, so any redirect into `/login` terminates at a renderable state (the login button for `'unauthenticated'`, the welcome banner for `'authenticated'`, the form-redirect chain for `'needs-screen-name'`, the placeholder for `'loading'`).

### 5. No new auth surface

The wrapper consumes only `useAuth()`. It MUST NOT introduce a new `fetch` call, a new state slice, a new context provider, or a new Zustand store. The hand-off promise in `mod_auth_flow.md:138` was "a `useAuth`-driven `<Navigate>`"; the wrapper keeps that contract exact. The `useAuth()` hook is the seam — when `mod_state_management`'s future Zustand swap of its internals lands (it didn't in the round that shipped, but the seam is preserved), the wrapper's call site does not change.

Specifically: no `useEffect` inside the wrapper that fires its own request; no `useState` for "have we checked"; no caching of the auth status. The wrapper is a pure-render component over `useAuth()`.

## Constraints / requirements

- **Files under `apps/moderator/src/`**:
  - `auth/RequireAuth.tsx` — new. Exports `function RequireAuth(props: { mode: 'authenticated-only' | 'needs-screen-name-only'; children: ReactNode }): ReactElement`. Runs `useAuth()`. Renders the loading placeholder on `'loading'`, `<Navigate to="/login" replace />` or `<Navigate to="/screen-name" replace />` per the redirect table above on the rejecting states, and `children` on the accepting state. Uses the existing `auth.login.title` / `auth.login.checking` i18n keys; no new strings.
  - `App.tsx` — updated. Wrap each protected route's `element` per the snippet above. The wildcard route and `/login` route stay unchanged.
- **The wrapper MUST**:
  - Render the loading placeholder using the exact DOM shape `Login.tsx` uses (`<main data-testid="route-login">` + `<h1 data-testid="route-title">{t('auth.login.title')}</h1>` + `<p data-testid="auth-checking">{t('auth.login.checking')}</p>`). Yes, the `main` element gets `data-testid="route-login"` even on a non-Login route during the loading frame — the e2e smoke does not assert on `route-login` directly (only on `route-title`'s text content); reusing the testid keeps the DOM shape identical and any future spec that does check `route-login` during a loading frame continues to find it.
  - Render `<Navigate to="/login" replace />` on `'unauthenticated'`, regardless of mode.
  - Render `<Navigate to="/login" replace />` on `'authenticated'` in `'needs-screen-name-only'` mode.
  - Render `<Navigate to="/screen-name" replace />` on `'needs-screen-name'` in `'authenticated-only'` mode.
  - Render `props.children` on `'needs-screen-name'` in `'needs-screen-name-only'` mode.
  - Render `props.children` on `'authenticated'` in `'authenticated-only'` mode.
  - Use a TypeScript `switch (status)` (or equivalent exhaustive shape) so a future addition to the `AuthStatus` union triggers a compile-time error in the wrapper.
- **Test layers per ADR 0022**: Vitest + Testing Library cases under `apps/moderator/src/App.test.tsx` (extended) OR a new sibling file `apps/moderator/src/auth/RequireAuth.test.tsx` (the agent's choice — both layouts are valid; the existing `App.test.tsx` is already 906 lines, so a sibling file keeps it from growing unboundedly). The cases MUST cover, for each protected route × each `AuthStatus`:
  - `(/screen-name, 'unauthenticated')` → router lands on `/login` (assert `route-login` rendered).
  - `(/screen-name, 'needs-screen-name')` → form renders (assert `route-screen-name` rendered).
  - `(/screen-name, 'authenticated')` → router lands on `/login`.
  - `(/screen-name, 'loading')` → placeholder renders (`route-title` + `auth-checking` testids visible).
  - `(/sessions/abc/lobby, 'unauthenticated')` → `/login`.
  - `(/sessions/abc/lobby, 'needs-screen-name')` → `/screen-name` (assert `route-screen-name` rendered).
  - `(/sessions/abc/lobby, 'authenticated')` → lobby renders (assert `route-lobby` rendered).
  - `(/sessions/abc/lobby, 'loading')` → placeholder.
  - Same five cases for `/sessions/abc/operate`. Total: 12 cases (3 routes × 4 states).
  - Plus one regression case per existing acceptance route: `/login` remains reachable on every status (the wrapper is NOT applied; the in-component switch handles all four branches in `Login.tsx`). The existing `Login route — auth states` block in `App.test.tsx` already covers this — the gate's tests don't duplicate, but a single "the gate does not wrap /login" case asserting the absence is fine.
- **`fetch` stubbing**: same pattern as the existing auth tests. Per-suite `beforeEach` installs a `vi.fn()` that resolves `/auth/me` with a `Response` matching the target `AuthStatus`:
  - 401 → `'unauthenticated'`.
  - 200 + `{ userId, screenName: '<pending>' }` → `'needs-screen-name'` (the placeholder-detection branch in `useAuth.ts`:163).
  - 200 + `{ userId, screenName: 'alice' }` → `'authenticated'`.
  - A pending promise that never resolves → `'loading'` (the test asserts on the rendered DOM during the in-flight frame, without `await waitFor`).
- **No e2e changes in this task**: the existing `tests/e2e/i18n-moderator-smoke.spec.ts:147` case continues to pass after the gate lands (the unauthenticated visit to `/screen-name` redirects to `/login` and renders `auth.login.title`, which is what the spec already asserts). The case's comment block lines 156–160 already describes the post-gate behavior; no spec edit is needed.

## Acceptance criteria

1. **The e2e smoke `tests/e2e/i18n-moderator-smoke.spec.ts:147` case (three locales × the `/screen-name` path) passes against `make up` + a fresh moderator dist.** The assertion at line 196 (`expect(titleText, …).toBe(expected.loginTitle)`) is the load-bearing pin: with the gate in place, the unauthenticated visit to `/screen-name` deterministically redirects to `/login` and renders `auth.login.title` in the project's locale.
2. **The two existing e2e smoke cases keep passing** — `tests/e2e/i18n-moderator-smoke.spec.ts:55` (the `/` landing renders the login title) and `:92` (the login button navigates to `/auth/login`). The gate change does not touch the `/` → wildcard → `Login` path, so this is a non-regression assertion rather than a behavior change.
3. **`pnpm run check` (lint + format + 3× `tsc -b` + tools + tests) stays green** with the gate added.
4. **`pnpm run test:smoke` (Vitest) stays green** with the new gate cases added. The new cases land in `apps/moderator/src/auth/RequireAuth.test.tsx` (or under the existing `App.test.tsx` if the implementing agent prefers) and follow ADR 0022 (the cases pin observable redirect behavior, not throwaway sanity checks): each `(route, status)` cell of the redirect table is a separate Vitest case asserting the rendered DOM contains the expected route's testid. New cases: ≥ 13 (12 cells + the "/login is not wrapped" assertion).
5. **`pnpm -F @a-conversa/moderator build` produces `apps/moderator/dist/index.html` + the assets.**
6. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent** after `complete 100` is added to `mod_route_auth_gate`.

## Decisions

- **Shared `RequireAuth` wrapper component, not in-component switches.** Rationale in the "Design choices" section above. Three protected routes today and more tomorrow; the wrapper is the abstraction that survives the growth, the in-component switch is the abstraction that gets duplicated.
- **Two-mode discriminator (`'authenticated-only' | 'needs-screen-name-only'`).** The minimum API that expresses both protected-route shapes today. A `'public'` mode would be degenerate; a per-status-list mode would be over-general. Two modes also makes a future "I'm a route that wants to be reachable in both states" case visible — at which point a third mode is the right answer, not an escape hatch.
- **Reuse `Login.tsx`'s loading-frame DOM shape exactly.** Rationale in the "Loading-state UX" section above. The e2e smoke spec at line 174's "is visible" precondition needs `route-title` to be present at bootstrap; mirroring Login means the title is already there. No new i18n strings land.
- **`'authenticated'` on `/screen-name` redirects to `/login`, not to a "no-op" render.** Rationale: an authenticated user has nothing to do on the screen-name form; landing them on `/login` (which then renders the welcome banner per `Login.tsx`:44) is the right next step. The alternative — render an empty page or a "you're already set" notice — adds UX surface for a corner case that should rarely happen (the user typed `/screen-name` into the URL bar after already setting their name).
- **The wrapper does NOT wrap `/login`.** Rationale: `Login.tsx` already runs the four-state switch in-component. Wrapping it would create a redirect cycle on `'unauthenticated'`. Keeping `/login` unwrapped is the canonical sink the rest of the system redirects INTO; the in-component switch makes that sink renderable for every status.
- **No new fetch / state / context.** The wrapper consumes only `useAuth()` and is a pure-render component over its result. This preserves the seam contract from `mod_auth_flow.md:138`: "a `useAuth`-driven `<Navigate>`." When `mod_state_management`'s future Zustand swap of the hook's internals lands, the wrapper's call site does not change.
- **Vitest cases in a sibling file `RequireAuth.test.tsx`, or extending `App.test.tsx`** — the implementing agent decides. The existing `App.test.tsx` is 906 lines; splitting keeps it from growing unboundedly, but co-locating with the existing router cases is also defensible. Either layout satisfies ADR 0022's "the probe IS the test" discipline; the new cases pin observable redirect behavior, not throwaway sanity checks.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-15.

- New component `apps/moderator/src/auth/RequireAuth.tsx` lifts the four-state switch into a route-level wrapper consuming only `useAuth()`. Two modes (`'authenticated-only'`, `'needs-screen-name-only'`); exhaustive `switch (status)` with a `never`-typed default to compile-fail any future `AuthStatus` addition that skips the gate; `'loading'` branch renders Login's exact DOM (`route-login`/`route-title`/`auth-checking` testids + the existing `auth.login.title` / `auth.login.checking` keys — no new catalog entries).
- `apps/moderator/src/App.tsx` wraps `<ScreenNameRoute />` in `'needs-screen-name-only'` and both `<LobbyRoute />` + `<OperateRoute />` in `'authenticated-only'`. `/login` and the wildcard stay unwrapped.
- Vitest verification: new `apps/moderator/src/auth/RequireAuth.test.tsx` pins all 12 cells of the (3 routes × 4 statuses) redirect table plus a `/login is not wrapped` regression case — 13 cases. `apps/moderator/src/App.test.tsx` extended where the pre-existing router cases assumed the gate's absence (the lobby + operate router cases now stub `/auth/me` as `'authenticated'`; the screen-name form cases use a `stubAuthMeNeedsScreenName` helper that returns a fresh `Response` per call so the gate's `useAuth` and the route's `useAuth` can each consume one).
- e2e verification (compose-driven, `make up` + `pnpm run test:e2e`): all 10 cases green, including the three locale-parameterised runs of `tests/e2e/i18n-moderator-smoke.spec.ts:147` that were red before this task (each was asserting `route-title === expected.loginTitle` at `/screen-name`; the gate now redirects unauthenticated → `/login` deterministically).
- `pnpm run check` (lint + format + 3× `tsc -b`) green; `pnpm run test:smoke` 2380 passing (was 2367; +13 from the new file).
- `pnpm -F @a-conversa/moderator build` produces the dist; no new bundle warnings beyond the pre-existing chunk-size note.

Artifacts:

- `apps/moderator/src/auth/RequireAuth.tsx` (new).
- `apps/moderator/src/auth/RequireAuth.test.tsx` (new — 13 cases).
- `apps/moderator/src/App.tsx` (route wrappers + header-comment update).
- `apps/moderator/src/App.test.tsx` (test-fixture adaptations for the new gate's wiring; existing test intent unchanged).
- `tasks/30-moderator-ui.tji` (`complete 100` on `mod_route_auth_gate`).
