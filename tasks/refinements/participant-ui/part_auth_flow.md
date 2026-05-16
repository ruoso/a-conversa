# Wire participant surface to shell's AuthContext

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_auth_flow`
**Effort estimate**: 0.25d
**Inherited dependencies**:

- `!participant_ui.part_shell.part_app_skeleton` (settled — the participant workspace builds as a Vite library bundle exporting the `MountFn` / `SurfaceModule` contract, the root host dispatches `/p/*` into it through `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`, and `apps/participant/src/main.tsx` already wraps the surface's React tree in `<AuthValueProvider value={props.auth}>` — i.e. `useAuth()` is already callable from any participant component; see [`apps/participant/src/main.tsx:33-50`](../../../apps/participant/src/main.tsx#L33) and the refinement at [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L168)).
- `shell_package.shell_substrate_extraction` (settled — `AuthValueProvider`, `useAuth`, the canonical `AuthContextValue`/`AuthStatus`/`AuthUser` types, and the `requiredAuthLevel` slot on `SurfaceMeta` all live in `@a-conversa/shell`; see [`packages/shell/src/auth/index.ts`](../../../packages/shell/src/auth/index.ts) and [`packages/shell/src/auth/types.ts`](../../../packages/shell/src/auth/types.ts#L23-L61)).
- Prose-only context (NOT a `.tji` edge): `root_app.root_moderator_cutover` (settled — the root host owns `BrowserRouter`, `AuthProvider`, the OIDC login chrome routes, the `/auth/callback` deep-link bridge, and the `SurfaceHost` dispatcher; the host's `SurfaceHost` is the upstream that auth-gates the surface BEFORE it ever calls `mount()` and that hands the live `auth` value into `MountProps`; see [`apps/root/src/surfaces/SurfaceHost.tsx:75-150`](../../../apps/root/src/surfaces/SurfaceHost.tsx#L75) and the refinement at [`tasks/refinements/root-app/root_moderator_cutover.md`](../root-app/root_moderator_cutover.md#L96-L104)).
- Prose-only context (NOT a `.tji` edge): `backend.auth.auth_callback_new_user_browser_redirect` (settled — the new-user OIDC callback now 302s to `/screen-name?from=callback` instead of dead-ending on raw JSON, so a debater clicking an invite URL on first login lands in the root's screen-name form and only reaches `/p/*` once they're fully authenticated; see [`tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`](../backend/auth_callback_new_user_browser_redirect.md#L52-L58)).

## What this task is

The 0.25d wire-up that gives the participant surface its first useful read of the host-supplied auth state. After this leaf:

- The participant surface's `<App>` consumes [`useAuth()`](../../../packages/shell/src/auth/useAuth.ts) and renders the current user's `screenName` inside the placeholder DOM under a stable, surface-scoped testid (`participant-identity`). This is the seam every downstream participant UI (invite-acceptance, lobby, operate, status indicator) reads to know "who am I in this debate".
- The surface defends against the narrow window where the host-supplied auth value flips out of `'authenticated'` *after* `SurfaceHost` initially handed control to the surface (e.g. another tab POSTs `/api/auth/logout` and a parent `auth.refresh()` flips status to `'unauthenticated'` before the host's gate re-evaluates). On that signal the participant returns a `data-testid="participant-not-authenticated"` panel rather than rendering with `auth.user === undefined`.
- The placeholder testid (`route-participant-placeholder`) from `part_app_skeleton` stays as the outer wrapper so the existing Playwright spec [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) keeps passing unchanged; the identity surface is a *child* of the placeholder, not a replacement.

Explicitly out of scope (mirrors `mod_auth_flow`'s scope-bound; see [`tasks/refinements/moderator-ui/mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md#L9-L25) for the analogous moderator boundary):

- No new OIDC handshake, no new login button, no new screen-name capture form, no new logout button inside the participant surface. All of that lives in the root host + `@a-conversa/shell` already; the participant is a consumer, not a re-implementer (ADR 0026 Decision 3, ADR 0026 Consequences §1).
- No re-implementation of the four-state `AuthStatus` switch as a route-level gate (the moderator's [`RequireAuth`](../../../apps/moderator/src/auth/RequireAuth.tsx) at `apps/moderator/src/auth/RequireAuth.tsx`). The participant's basename-scoped router has one wildcard route today; the gate at the surface boundary is just the host's `SurfaceHost` precondition plus the defensive in-component check below. A participant-side `RequireAuth` equivalent lands later if and only if the participant grows public-or-mixed-auth routes (`part_session_join.part_invite_acceptance` is the first leaf that might force the issue; that's its scope to settle).
- No role-gating (debater-A vs debater-B). The URL carries `?role=...` per the moderator's invite emit shape ([`apps/moderator/src/routes/InviteParticipants.tsx:313-316`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L313)) and the claim flow that turns the role into a server-side participant-row is `part_session_join.part_invite_acceptance`'s job; this leaf only surfaces `screenName`, which is role-independent.
- No global `useAuth()` consolidation pattern (single `AuthProvider` at the surface root). The surface already receives the host's provider value through `<AuthValueProvider value={props.auth}>` in `main.tsx` — that's the consolidation. Consumers anywhere in the participant tree call `useAuth()` and read the same host-supplied value.

## Why it needs to be done

This leaf is the seam that turns the participant surface from "bundle that mounts" into "bundle that knows who the user is" — the precondition for every M3-lobby user step that follows.

**M3-lobby smoke** ([`tasks/99-milestones.tji`](../../99-milestones.tji)) is the milestone at which a human drives `moderator → invite → debater login → lobby`. The chain a real debater hits today (after the just-landed [`bdd8427`](../../../apps/root/src/App.tsx) start-session work and the [`f93e80b`](../../../apps/server/src/auth/routes.ts) new-user callback redirect):

1. Debater clicks moderator-emitted invite URL `https://app/p/sessions/<uuid>/invite?role=debater-A`.
2. Root host's `/p/*` route renders `<SurfaceHost surfaceId="participant" routerBasePath="/p" />`. The host's effect ([`apps/root/src/surfaces/SurfaceHost.tsx:75-150`](../../../apps/root/src/surfaces/SurfaceHost.tsx#L75)) checks `auth.status`. If `'unauthenticated'` or `'needs-screen-name'`, the host calls `rememberReturnTo(<the invite URL>)` and bounces to `/login` (existing returning-user OIDC dance) or `/screen-name` (new-user, post-`f93e80b` flow). After auth completes, the user lands back at the remembered invite URL.
3. With `auth.status === 'authenticated'`, the host dynamic-imports the participant bundle, injects the CSS sidecar, and calls `surface.mount({ container, auth, i18n, routerBasePath: '/p' })`. The participant surface's `main.tsx` wraps the React tree in the host-supplied auth + i18n providers.
4. **Today**: the surface's placeholder renders generic "Participant surface" / "Loading…" text. The user is in but the surface doesn't know — or display — their identity.
5. **After this leaf**: the same placeholder also renders `Signed in as <screenName>` under `data-testid="participant-identity"`. The next leaf (`part_session_join.part_invite_acceptance`) reads the same `useAuth()` result to (a) pre-fill the claim POST with the authenticated user's `userId`, (b) decide whether to show "claim this role" vs "you are already claimed in this session", and (c) surface "logged in as <screenName>; not you? <logout link>" affordances.

Downstream concretely:

- **`part_session_join.part_invite_acceptance`** — calls `useAuth()` to read `user.userId` for the `POST /api/sessions/:id/participants/self-claim` payload and `user.screenName` for the pre-claim "you'll join as <name>" hint.
- **`part_status_indicator`** — the persistent role + screen-name + pending-count chip is the moderator-mirror of [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx); it reads `screenName` from the same `useAuth()` and overlays the per-session role from the session-state store (`part_state_management`).
- **`part_landscape_layout`** — the operate-view chrome's "who am I" banner.

Architecturally, this leaf is also the **structural validation that ADR 0026 Decision 3 ("each surface consumes auth from the host via `MountProps.auth`, not by re-running OIDC") holds for the participant** the same way it already holds for the moderator. The moderator validated the contract through `mod_auth_flow`'s extraction of the auth hook into the shell (later landed by `shell_substrate_extraction`); the participant validates it by simply consuming the same `useAuth()` without bringing along any auth machinery of its own. This is the no-double-OAuth invariant in action.

## Inputs / context

### ADRs

- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md#L37-L76) — Decision 2 fixes the surface mount contract (`mount(props): UnmountFn` + `MountProps.auth`); Decision 3 fixes that the root owns auth chrome and surfaces own only their mounted region; Consequences §1 makes "auth chrome single-sources" the architectural promise this leaf honors.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest mount-boundary cases below and the additional Playwright scenarios are the regression pins; no manual "I clicked it and the name was right" smoke.
- [ADR 0002 — auth: self-hosted OIDC + Authelia](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md) — no-OIDC-profile-data invariant. The participant surface's source MUST NOT introduce any reference to `email`, `picture`, `given_name`, `oauthSubject`, etc. (the audit list pinned by the shell's `auth.test.ts` per [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md#L139)). The shell's `AuthUser` shape (`{ userId, screenName }`) is the only auth-derived datum the participant ever reads.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_app_skeleton.md`](part_app_skeleton.md#L141-L172) — the predecessor. The provider wiring this leaf consumes (`<I18nProvider><AuthValueProvider value={props.auth}><BrowserRouter basename={props.routerBasePath}><App /></BrowserRouter></AuthValueProvider></I18nProvider>`) was landed by that task; the `requiredAuthLevel: 'authenticated'` declaration on `SurfaceModule.meta` was also landed there. **Acceptance §3.7** of that refinement explicitly defers "the shell `useAuth()` wiring beyond a status-gated render" to this leaf.
- [`tasks/refinements/moderator-ui/mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md) — the canonical pattern this leaf mirrors *where reasonable*. The mirror is necessarily partial: the moderator's `mod_auth_flow` (1d, pre-ADR-0026) built the OIDC handshake + screen-name form + logout button from scratch inside the moderator workspace; ADR 0026 then moved every one of those into `@a-conversa/shell` + `apps/root/`. The participant's equivalent task is therefore the *minimum* the moderator's was: just the consumer-side wire-up. What carries over verbatim: the discriminated-`status` switch shape (the participant uses the same `AuthStatus` from the shell), the "no profile data" audit invariant, the `data-testid="route-title"` / `route-*` selector discipline, and the principle that the in-component switch returns from every branch.
- [`tasks/refinements/moderator-ui/mod_route_auth_gate.md`](../moderator-ui/mod_route_auth_gate.md) — the moderator's per-route gate. **Deliberately not mirrored** at this leaf — the participant has one wildcard route today and the upstream `SurfaceHost` already does the gate; replicating `RequireAuth` here would be parallel logic with no caller. The defensive in-component check this leaf does add is *narrower* than `RequireAuth`: it handles the mid-mount status flip, not the route-level redirect.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](../shell-package/shell_substrate_extraction.md#L20-L31) — the canonical `useAuth()` + `AuthContextValue` contract. Note especially the "single-fetch consolidation" — the participant's `useAuth()` reads from the host's provider, which fired exactly one `GET /api/auth/me` at the root's boot; the participant adds zero auth-bootstrap fetches.
- [`tasks/refinements/root-app/root_moderator_cutover.md`](../root-app/root_moderator_cutover.md#L96-L104) — the host upstream. The `SurfaceHost` dispatcher's auth-gate (lines 142-150) plus the `MountProps.auth` hand-off (lines 105-110) are the two seams this leaf plugs into.
- [`tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`](../backend/auth_callback_new_user_browser_redirect.md#L52-L58) — the just-landed (commit `f93e80b`) fix that makes the unauth-debater → host-login → back-to-`/p/...` chain actually complete for a first-time debater. This leaf does not interact with the redirect itself; it relies on it as the precondition for the "authenticated visit → identity surfaced" Playwright scenario below.

### Live code the surface plugs into

- [`apps/participant/src/main.tsx:33-50`](../../../apps/participant/src/main.tsx#L33) — the mount entrypoint. Already wraps the React tree in `<AuthValueProvider value={props.auth}>`; this leaf does NOT modify the entrypoint.
- [`apps/participant/src/App.tsx:1-42`](../../../apps/participant/src/App.tsx#L1) — the placeholder route tree. The `<PlaceholderRoute>` component currently reads only `useTranslation()`; this leaf adds the `useAuth()` consumption and the identity surface inside the same placeholder DOM.
- [`apps/participant/src/mount.test.tsx:1-58`](../../../apps/participant/src/mount.test.tsx#L1) — the existing mount-boundary case. Today asserts only that the placeholder testid renders for an `authenticated` auth value. This leaf extends the file with two new cases (see Acceptance criteria) and the existing case grows one assertion (the identity testid is visible inside the placeholder for the authenticated input).
- [`apps/root/src/surfaces/SurfaceHost.tsx:75-150`](../../../apps/root/src/surfaces/SurfaceHost.tsx#L75) — the host's auth-gated dispatch. Two load-bearing properties for this leaf:
  - The `useEffect` early-returns when `auth.status !== 'authenticated'` (line 76) AND the post-effect branches at lines 142-150 perform the `rememberReturnTo + <Navigate>` deflection. Together they guarantee `mount()` is never called with a non-authenticated `auth.status` at first hand-off.
  - The effect deps include `auth` (line 129), so a status change after mount triggers cleanup → re-effect. The cleanup path calls `cleanup?.()` (the returned `UnmountFn`) and clears `container.innerHTML`. **However**: between the moment `auth` flips out of `'authenticated'` and the moment React schedules + runs the cleanup, the surface continues to render with the stale auth value still inside its own `<AuthValueProvider>`. That's the narrow window the in-component defensive switch covers — it does NOT race the host's gate, it complements it for a sub-paint interval.
- [`packages/shell/src/auth/AuthValueProvider.tsx`](../../../packages/shell/src/auth/AuthValueProvider.tsx) — the value-only provider the participant's `main.tsx` uses (as opposed to `AuthProvider`, which owns the `useState` + `/api/auth/me` fetch). The value-only provider is exactly what surfaces want: it doesn't second-source the auth state; it republishes the host's value into context for the surface's tree.
- [`packages/shell/src/auth/types.ts:23-61`](../../../packages/shell/src/auth/types.ts#L23) — the canonical `AuthUser` (`{ userId, screenName }` only), `AuthStatus` discriminator, and `AuthContextValue` shape.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — the `authenticated` fixture / `setup-auth` Playwright project. Drives the OIDC dance once (now including the form-based new-user path per the `auth_callback_new_user_browser_redirect` fix), persists the cookie jar to `AUTH_STORAGE_STATE_PATH`. Any spec in the `chromium-participant-skeleton` project ([`playwright.config.ts`](../../../playwright.config.ts)) starts with `aconversa-session` already in `page.context()`. The participant `screenName` carried into the surface is whichever Authelia user the fixture seeded (`alice`, `ben`, etc.) — the spec asserts on `getByTestId('participant-identity')` containing the seeded user's name without hardcoding which one (read it back from `/api/auth/me` via `page.request` to avoid coupling to fixture-internal naming).
- [`tests/e2e/participant-skeleton-smoke.spec.ts`](../../../tests/e2e/participant-skeleton-smoke.spec.ts) — the predecessor's e2e. **This leaf extends it** (new test cases added to the same `test.describe`) rather than creating a sibling spec; the file's already-scoped Playwright project + comment block already document the participant surface's contract surface.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/App.tsx` — modified. Adds the `useAuth()` consumption, the in-component `AuthStatus` switch, and the identity / not-authenticated DOM beneath the existing placeholder wrapper.
- `apps/participant/src/mount.test.tsx` — modified. Extends the existing case with one new assertion (identity testid + screenName text); appends two new cases (mid-mount status flip → not-authenticated surface; `auth.user === undefined` while `status === 'authenticated'` defensive guard).
- `tests/e2e/participant-skeleton-smoke.spec.ts` — modified. Appends two new scenarios to the existing `test.describe`: (a) authenticated visit asserts `data-testid="participant-identity"` renders the seeded user's `screenName`; (b) unauthenticated visit to `/p/...` deflects to `/login` with the deep link remembered. Scenario (b) is included here (in contrast to `part_app_skeleton.md`'s deliberate exclusion of the mirror) because **this leaf's contract is specifically about auth surfacing**; without scenario (b) the leaf has no e2e pin on the "unauth'd visitor reaches the participant surface URL" branch, which is the user-visible half of the contract.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Two new keys: `participant.identity.signedInAs` (ICU `Signed in as {name}`) and `participant.notAuthenticated.body` ("You appear to have signed out. Refresh the page to sign in again.").
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same two keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same two keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds both new dotted keys to the `pending` list.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.

### Files this task does NOT touch

- `apps/participant/src/main.tsx` — the provider wiring is already correct; no change.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep (`@a-conversa/shell` and `react-i18next` are already pinned); no new build config; no new project reference.
- `packages/shell/` — the substrate is consumed unchanged. Any widening of `AuthContextValue` belongs to the shell's own leaves.
- `apps/root/` — the host already implements the upstream gate; no change.
- `apps/server/` — no backend change.
- `.tji` files — the `complete 100` marker for `part_auth_flow` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42), not at refinement-write time.
- `docs/adr/` — no new ADR (every decision below is a direct application of existing ADRs 0026 / 0022 / 0002).

### Component shape (`apps/participant/src/App.tsx`)

The new `<PlaceholderRoute>` body, sketched:

```tsx
function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  // Mid-mount defensive guard. SurfaceHost's effect-level gate is the
  // primary defense (it tears the surface down and bounces to /login
  // on a status change), but between the auth value flipping and the
  // host's cleanup callback firing there is a sub-paint interval where
  // the surface re-renders with the stale provider value. Returning
  // an explicit not-authenticated surface (rather than rendering with
  // auth.user === undefined and crashing on `.screenName`) keeps the
  // window safe.
  if (auth.status !== 'authenticated' || auth.user === undefined) {
    return (
      <main data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
        <p
          data-testid="participant-not-authenticated"
          className="mt-2 text-sm text-slate-600"
        >
          {t('participant.notAuthenticated.body')}
        </p>
      </main>
    );
  }

  return (
    <main data-testid="route-participant-placeholder" className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('participant.placeholder.body')}</p>
      <p
        data-testid="participant-identity"
        className="mt-4 text-sm text-slate-700"
      >
        {t('participant.identity.signedInAs', { name: auth.user.screenName })}
      </p>
    </main>
  );
}
```

- The outer `route-participant-placeholder` testid stays on both branches so the existing `part_app_skeleton` Playwright spec keeps matching.
- `participant-identity` is the new stable selector downstream tasks read.
- `participant-not-authenticated` is the defensive-guard testid; the mount-boundary test pins it for the status-flip case.
- The component is intentionally not exported / not a separate file — it stays inline in `App.tsx` as the sibling of the `Routes` block, mirroring the structure `part_app_skeleton` landed.

### What the surface MUST NOT do

- **No `fetch('/api/auth/me')` from inside the participant surface.** That fetch lives exactly once in the root's `AuthProvider`; the surface reads through context only. A grep over `apps/participant/src/` for `/api/auth/me` must return zero matches (audit-friendly; pinned by the no-profile-data extension below).
- **No `window.location` writes** for auth flow control. Logout, login, screen-name capture are the root's chrome routes; the surface never `assign`s or `replace`s `window.location` to an auth route. A redirect *back to the host login* on an unauth state is the `SurfaceHost`'s job, not the surface's. The defensive surface DOM tells the user to refresh; it does NOT auto-redirect (auto-redirecting would race the host's `<Navigate>` and could land in a loop if the host's `auth.status` re-resolves to `authenticated` between paints).
- **No OIDC claim identifiers anywhere in the diff.** Audit list reuses the shell's: `email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`, `sub` (as a free identifier — `userId` is fine). Grep-asserted by the no-profile-data extension below.

### Test layers per ADR 0022

Three pins, each anchoring a different observable property:

1. **Vitest mount-boundary (extended)** — `apps/participant/src/mount.test.tsx`. Three cases after this leaf:
   - The existing `authenticated` case grows one assertion: `screen.getByTestId('participant-identity').textContent` contains `'ben'` (or whatever `screenName` the test's `auth` value carries). Pins that the surface reads the host-provided `user.screenName` correctly.
   - New case: `mount()` with `auth.status === 'unauthenticated'` (and `user === undefined`) renders `getByTestId('participant-not-authenticated')` and does NOT render `participant-identity`. Pins the defensive in-component guard.
   - New case: `mount()` with `auth.status === 'authenticated'` but `auth.user === undefined` (the malformed-provider edge) also routes through the not-authenticated branch (no `.screenName` crash). Pins the `auth.user === undefined` belt-and-braces side of the guard.
2. **Vitest no-profile-data extension** — extends whichever existing audit suite already greps `apps/participant/src/` (or adds one to `apps/participant/src/no-profile-data.test.ts` mirroring [`apps/server/src/auth/no-profile-data.test.ts`](../../../apps/server/src/auth/no-profile-data.test.ts)) to assert the forbidden-identifier list does not appear under `apps/participant/src/`. If a shell-side audit already covers this transitively (per `shell_substrate_extraction`'s pin), a single new case in `mount.test.tsx` that greps `App.tsx` for the same list suffices; author-choice.
3. **Playwright (extended)** — `tests/e2e/participant-skeleton-smoke.spec.ts`. Two new scenarios appended to the existing `test.describe`:
   - **Scenario "authenticated visit surfaces identity"**: the existing `chromium-participant-skeleton` project already seeds a fixture-authenticated `page.context()`. The new scenario `await page.goto('/p/sessions/<uuid>/invite?role=debater-A')`, reads the expected `screenName` via `page.request.get('/api/auth/me')`, then asserts `getByTestId('participant-identity')` is visible AND its text contains the screen name. Same fixture, same project; no new infrastructure.
   - **Scenario "unauthenticated visit deflects to host login with deep link remembered"**: a fresh `test.describe` block (or a `test` with `test.use({ storageState: undefined })` per the existing Playwright project precedent) navigates to `/p/sessions/<uuid>/invite?role=debater-A` with no cookie jar, asserts the browser lands on `/login` (not `/p/*`), and asserts `window.sessionStorage.getItem('a-conversa:return-to')` equals the original invite URL. Pins the upstream-gate contract from the surface's caller-perspective.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default per `ORCHESTRATOR.md`.** The participant surface is reachable from the root (`/p/*` lands in `SurfaceHost` per `part_app_skeleton`), and the two new Playwright scenarios above cover (a) authenticated-visit identity surfacing and (b) unauthenticated-visit deflection — i.e. both halves of "the participant surface gets the user's identity from the host". The skeleton-smoke spec is the natural home; no new spec file, no new fixture, no new Playwright project. The scenarios run under the same `make up` compose stack the predecessor's spec already targets.

No e2e is deferred from this leaf.

### Budget honesty (0.25d)

The 0.25d budget is honest because the substrate already exists end-to-end:

- The provider wiring (~10 LOC) is done in `main.tsx`; no change.
- The auth-gate (`SurfaceHost`'s `<Navigate to="/login">` with remembered return-to) is done in the host; no change.
- The new-user redirect-to-screen-name path is done in the backend; no change.
- The `useAuth()` hook + `AuthContextValue` type + the four-state `AuthStatus` switch are done in the shell; no change.

This leaf is the ~15 LOC of `App.tsx` diff + ~30 LOC of test additions + 4 i18n catalog edits + 2 review.json edits. The risk surface is correspondingly small: no new fetch, no new state, no new effect, no new route. The Playwright scenarios add ~30 LOC inside an existing spec file.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move (other than the harmless `@a-conversa/i18n-catalogs` workspace re-link triggered by JSON edits).
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new `useAuth()` consumption, the discriminated-`status` narrowing on `auth.user`, and the JSX type-flow under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)) all compile.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessor pinned; bundle filename / sidecar shape unchanged; no new asset.
4. **`pnpm run check`** stays green (lint + format + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+2** for the two new mount-boundary cases (the existing case's added assertion does not change the count). If the no-profile-data audit lands as its own case, count grows by **+3**.
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the two new `participant.identity.signedInAs` + `participant.notAuthenticated.body` keys present in all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e`** under `make up` runs the two new participant-skeleton scenarios green inside the existing `chromium-participant-skeleton` project. Total scenarios in the spec grow from 1 to 3.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **No new `fetch` / `XMLHttpRequest` / `window.location` write** under `apps/participant/src/` — a grep over the participant source must remain free of these identifiers (other than what the predecessor already shipped, which is none).
10. **No OIDC profile-claim identifier** under `apps/participant/src/` — the forbidden list (`email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`) returns zero grep matches.
11. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_auth_flow` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
12. **Predecessor's existing assertions unchanged** — `tests/e2e/participant-skeleton-smoke.spec.ts`'s original scenario (placeholder testid visible, `<h1>` text "Participant surface") still passes; the predecessor's mount-boundary case still passes with one extra assertion appended.

## Decisions

### 1. Consume `useAuth()`; do not re-implement any auth machinery

Two alternatives surveyed:

- **(A) Build a participant-local `AuthProvider` shim** that re-fetches `/api/auth/me` from the surface itself (defensive: "what if the host's auth value goes stale?"). Rejected. Hard-violates ADR 0026 Consequences §1 ("auth chrome single-sources") and the "single-fetch consolidation" promise of `shell_substrate_extraction.md`. The host's `AuthProvider` is the canonical single fetcher; the surface re-fetching would be a second source of truth that drifts. The defensive shim's only theoretical win — "the surface can render auth-aware content even if the host's provider value is stale" — is solved instead by the in-component `auth.status !== 'authenticated'` guard described in Decision §3 (the host's effect cleanup will tear the surface down anyway; the guard just covers the sub-paint window).
- **(B) Consume `useAuth()` from `@a-conversa/shell` only** (chosen). The surface's `main.tsx` already wraps the tree in `<AuthValueProvider value={props.auth}>`; calling `useAuth()` inside `<App>` reads the host-supplied value. Zero new fetches, zero new state, zero auth-bootstrap code in the participant workspace.

Cost of the chosen approach: ~3 lines in `App.tsx` (the `useAuth()` call + the destructure). Benefit: the no-double-OAuth invariant is structural, not policy.

### 2. Mirror the moderator's auth-flow consumption shape where reasonable

The moderator's `mod_auth_flow` is the canonical precedent. What this leaf mirrors verbatim:

- The discriminated-`status` switch shape — when narrowing `auth.user`, switch on `auth.status === 'authenticated'` first; never read `auth.user.screenName` without first checking `auth.status` is `'authenticated'` AND `auth.user !== undefined`. (The canonical `AuthContextValue` types `user` as optional; even on `'authenticated'` the provider could theoretically supply `undefined`, and the no-profile-data audit pin assumes that defense.)
- The "no OIDC claim identifiers in the source" audit. The shell's audit transitively covers the shell-side handling; the participant's audit covers the surface's source.
- The `data-testid`-first selector discipline — every auth-derived rendered element gets a stable testid the Vitest + Playwright layers pin against. Names follow the moderator's pattern (`route-*` for route DOM, `*-identity` / `*-not-authenticated` for surface-specific affordances).

What this leaf *deliberately does not* mirror (mirror would be wrong here):

- **A four-state `LoginRoute`-style switch component.** The moderator's `Login.tsx` renders one of four DOMs based on `auth.status`; that's because the moderator's `Login.tsx` is *itself* the auth chrome's home, and the moderator pre-ADR-0026 owned that chrome. Post-ADR-0026, the auth chrome is the root host's responsibility. The participant has nothing equivalent to render — its only branch is "authenticated → identity surface; everything else → not-authenticated fallback (which only paints inside the host's gate-cleanup window)".
- **A `RequireAuth` route wrapper.** The moderator's `RequireAuth` exists because the moderator owns multiple protected routes inside one bundle and one of them (`/screen-name`) needs a different auth-status gate than the others. The participant has one wildcard route today; a one-route `RequireAuth` would be parallel logic to the host's `SurfaceHost` gate with no caller. When `part_session_join.part_invite_acceptance` lands the real claim flow, that leaf decides whether to introduce a participant-side gate; deciding it now would pre-commit a shape we don't have evidence to justify.
- **An imperative `logout()` button.** The moderator's `Login.tsx`'s `authenticated` branch renders a logout button; the participant's user-visible logout affordance is in the root host's chrome ([`apps/root/src/App.tsx:75-80`](../../../apps/root/src/App.tsx#L75)). A participant-internal logout button would either duplicate the host's chrome or trigger a chrome-aware navigation away from `/p/*`; both are out of scope for "surface identity wire-up". A participant-surface logout affordance can land later if user research demands it (a possible `part_status_indicator` consideration).

### 3. In-component defensive guard, not auto-redirect, on mid-mount status flip

Three alternatives surveyed for "what happens if `auth.status` flips out of `'authenticated'` after the surface is mounted":

- **(A) Do nothing in the surface; rely entirely on the host's effect cleanup.** The host's `SurfaceHost` effect deps include `auth` ([`apps/root/src/surfaces/SurfaceHost.tsx:129`](../../../apps/root/src/surfaces/SurfaceHost.tsx#L129)), so a status change re-runs the effect → calls `cleanup()` → unmounts the surface. Rejected: there's a sub-paint interval between the auth-value flip and the host's React-scheduled effect re-run where the surface's `<App>` re-renders with the new `useAuth()` value (the surface's `AuthValueProvider` updates synchronously). During that interval, naively reading `auth.user.screenName` could throw if `user` flipped to `undefined`. Not catastrophic (React boundary catches it), but a runtime error is a poor UX vs. an explicit fallback DOM.
- **(B) Auto-redirect from the surface to `/login`** (e.g. via `window.location.assign('/login')` or a router `<Navigate>` to a non-`/p/*` path). Rejected: races the host's own `<Navigate to="/login">` (lines 142-150); could compound into a redirect loop if the host's `auth.status` re-resolves to `authenticated` between the surface's nav and the host's. Also: the surface's router has basename `/p`, so a `<Navigate to="/login">` from inside the surface goes to `/p/login` (a non-existent route inside the participant), not the host's `/login`. A `window.location` write would work but violates "no `window.location` writes from the surface" (Constraints).
- **(C) Render an explicit `participant-not-authenticated` panel inside the surface** (chosen). The DOM tells the user what happened; the host's effect cleanup will tear the surface down on the next React tick and the user lands on the host's `/login` from the host's normal flow. The fallback DOM is a transient single-paint surface in practice, but it guarantees the surface never crashes on `auth.user.screenName` and gives Vitest a stable testid to pin the contract. The fallback's body text ("Refresh the page to sign in again.") is conservative because the user shouldn't typically see it.

The chosen approach is the *minimum* defense compatible with the host's gate being the primary mechanism. The surface trusts the host but doesn't depend on a specific scheduling guarantee from React.

### 4. The identity DOM lives inside the existing placeholder, not as a new route

Two alternatives surveyed:

- **Land identity in a separate route** (e.g. add `/me` or `/identity` to the surface's router). Rejected: the participant's router has one wildcard route by design today; adding a second route just to display identity is over-structured for the 0.25d budget and the identity surface is contextual (every participant page needs to know who the user is), not navigational.
- **Embed identity in the existing placeholder DOM** (chosen). The placeholder is the only surface today; embedding identity there means every URL under `/p/*` surfaces the user's name once they're authenticated. When `part_session_join.part_invite_acceptance` and `part_landscape_layout` replace the placeholder, they each carry their own identity affordance (mirroring `part_status_indicator`'s contract) — the placeholder's identity row is intentionally not the canonical "status indicator", just the bootstrap surface for "the user can see their identity here today".

### 5. No new ADR needed

This leaf introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0026's mount-contract + host-owns-chrome; 0022's committed-test discipline; 0002's no-profile-data).
- A direct mirror of the moderator's auth-flow consumption shape (Decision §2 above).
- A scoped UI policy that doesn't constrain other tasks (Decisions §3 + §4).

The "no new dependencies" rule is satisfied; the package.json is unchanged.

### 6. Tech-debt registration

- **`frontend_i18n.i18n_participant_identity_native_review`** — pt-BR + es-419 native-speaker review of the two new `participant.identity.signedInAs` + `participant.notAuthenticated.body` keys. Effort: 0.25d. Mirrors the existing `i18n_participant_placeholder_native_review` task shape landed by `part_app_skeleton`'s closer. **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes, chained after `!i18n_participant_placeholder_native_review` to keep the native-review chain linear.
- **No other follow-ups need registration.** Every sibling leaf this work feeds (`part_session_join.part_invite_acceptance`, `part_status_indicator`, `part_landscape_layout`) already exists as open WBS leaves with the appropriate `depends` edges; they pick up `useAuth()` consumption from the shell directly. A potential future participant-side `RequireAuth` wrapper, if it lands at all, lands as a sub-concern of whichever leaf first needs a multi-route participant router; no proactive registration.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Participant `<App>` now consumes `useAuth()` from `@a-conversa/shell` and renders the host-supplied `screenName` inside the existing placeholder under stable `data-testid="participant-identity"`; outer `route-participant-placeholder` testid retained on both branches so the `part_app_skeleton` Playwright pin keeps matching ([apps/participant/src/App.tsx](../../../apps/participant/src/App.tsx)).
- Sub-paint defensive guard added: when `auth.status !== 'authenticated'` or `auth.user === undefined` the surface renders a `data-testid="participant-not-authenticated"` panel rather than crashing on `.screenName`; the host's `SurfaceHost` effect cleanup remains the primary mechanism for status-flip teardown (matches Decision §3).
- Mount-boundary Vitest spec ([apps/participant/src/mount.test.tsx](../../../apps/participant/src/mount.test.tsx)) extended: existing authenticated case grew one assertion (identity testid + `screenName`); +2 new cases pin the not-authenticated branch and the `auth.user === undefined` belt-and-braces branch. Smoke count 3430 → 3432.
- Playwright spec ([tests/e2e/participant-skeleton-smoke.spec.ts](../../../tests/e2e/participant-skeleton-smoke.spec.ts)) gained two scenarios under `chromium-participant-skeleton`: (a) authenticated visit surfaces the fixture-seeded `screenName` under `participant-identity`; (b) unauthenticated visit to `/p/...` deflects to `/login` with `a-conversa:return-to` remembered. E2e count 46/46 → 48/48.
- Two new i18n keys (`participant.identity.signedInAs` ICU, `participant.notAuthenticated.body`) landed across all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`. Parity check confirms 303 keys across the three locales.
- No-fetch / no-OIDC-claim audit on `apps/participant/src/` returns zero matches; no `window.location` writes, no new dependency, no change to `main.tsx` or to the surface mount contract.
- Tech-debt registered: `frontend_i18n.i18n_participant_identity_native_review` (0.25d) chained after `i18n_participant_placeholder_native_review` in [tasks/35-frontend-i18n.tji](../../35-frontend-i18n.tji), per Decision §6.
