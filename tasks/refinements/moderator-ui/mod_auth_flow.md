# Moderator login / OAuth-callback / screen-name / logout UI

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task `moderator_ui.mod_shell.mod_auth_flow`
**Effort estimate**: 1d
**Inherited dependencies**: `mod_app_skeleton` (settled — router, i18n bootstrap, `/login` placeholder route), `backend.auth.session_token_management` (settled — `GET /auth/login`, `GET /auth/callback`, `POST /auth/screen-name`, `GET /auth/me`, `POST /auth/logout`, the `aconversa-session` cookie and `aconversa-auth-pending` bridge cookie).

## What this task is

Lands the client-side auth UX for the moderator console. Four surfaces ship together:

- **Login button** on the `/login` route. A plain `<a href="/auth/login">` anchor — a full-page navigation, NOT a `fetch` — because the OIDC dance bounces the browser through Authelia and back. A `fetch` cannot follow a 302 onto a foreign origin.
- **OAuth-callback landing**. `GET /auth/callback` is owned by the backend; the backend either 302s the browser to `APP_BASE_URL` (returning user — the `aconversa-session` cookie is set on that response) OR responds with a 200 JSON body `{ sub, oauthSubject, userId, needsScreenName: true }` (new user — the `aconversa-auth-pending` cookie is set). The frontend's job: when it sees `needsScreenName: true` (because the backend's body is rendered directly by the browser as JSON OR because the browser navigates to a moderator route while still holding `<pending>`), surface the screen-name form.
- **Screen-name form** on a new `/screen-name` route. POSTs `{ screenName }` to `/auth/screen-name`; on 200 navigates to `/login` (which by that point re-checks `/auth/me` and sees the user is fully authed). On 409 / 400 / 401, renders the localized error.
- **Logout button**. POSTs to `/auth/logout` (a `fetch` with `credentials: 'include'`) and reloads to `/login`. The cookie is cleared by the backend's `Set-Cookie`; the reload bounces the user back through the unauthed branch of `/login`.

## Why it needs to be done

Without this task, the moderator console has a stub `/login` route that renders `chrome.hello` and no way to actually authenticate. Every downstream moderator UX (lobby, operate, capture flow, diagnostic flow) assumes a session — `/auth/me` returns 200 — and a way to render "you are alice" / "log out". This task is the auth glue between the backend's `auth/*` surface and the rest of the moderator UI.

Three downstream consumers wait on this:

- **`mod_state_management`** — the next sibling. It will lift the "who am I" + "am I authed" check into a Zustand slice so it's reactive across the app. Until that lands, this task exposes a `useAuth()` hook returning `{ status, user, login, logout }` from a single `useState` + `useEffect` (the seam — `mod_state_management` swaps the hook's internals for a store subscription without changing the call sites).
- **`mod_screen_name_setup`** — the immediate next sibling. The refinement explicitly factors out the first-login screen-name capture as its own 0.5d task; this one lands the form scaffolding (route, validation, POST + error rendering) so `mod_screen_name_setup` can add UX polish (input affordances, character-count helper, error-recovery hints) on top of working bones.
- **Every protected moderator surface** (lobby, operate, capture, etc.). They all consume `useAuth()` to gate render-or-redirect.

## Inputs / context

From [ADR 0002](../../../docs/adr/0002-auth-self-hosted-oidc-authelia.md):

> The platform reads no profile data — OAuth is purely an authentication signal. The only user-supplied datum stored is a screen name collected during connect.

The client invariant is symmetric: the moderator UI MUST NOT read, display, or store any OIDC profile data. The only fields the UI ever consumes from the auth surface are `userId` (UUID) and `screenName` (the user-supplied display name). The `/auth/me` response shape is exactly `{ userId, screenName }`; the `/auth/callback` body's `sub` / `oauthSubject` fields are NOT consumed by the moderator UI (the backend already namespaces and stores them; the client doesn't need them).

From [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts) (the predecessor's deliverable):

- `GET /auth/login` — 302 to the issuer's authorization endpoint. The client triggers this with a full-page navigation.
- `GET /auth/callback` — 302 to `APP_BASE_URL` (returning user, session cookie set) OR 200 with `{ sub, oauthSubject, userId, needsScreenName: true }` (new user, pending cookie set).
- `POST /auth/screen-name` — body `{ screenName }`. 200 with `{ userId, screenName }` and Set-Cookies BOTH the platform session AND a cleared pending cookie. 400 / 401 / 409 on validation, missing-cookie, already-set.
- `GET /auth/me` — 200 `{ userId, screenName }` for an authed caller. 401 `auth-required` on missing/invalid/expired/soft-deleted-user.
- `POST /auth/logout` — 204, idempotent. Clears the platform session cookie.

From [`apps/server/src/auth/no-profile-data.test.ts`](../../../apps/server/src/auth/no-profile-data.test.ts): the backend audit. The client-side symmetric audit lives in `App.test.tsx`'s auth section — the test renders the screen-name form, mounts the auth hook, drives the logout button, and asserts the rendered DOM contains none of the OIDC profile values (email, picture, given_name, etc.).

From [`tasks/refinements/moderator-ui/mod_app_skeleton.md`](mod_app_skeleton.md) "Decisions":

> **Auth flow**: redirect to Authelia on `/login`, capture session token, store in memory (or sessionStorage) — never localStorage to keep tokens out of long-lived storage.

Implementation note: the platform session cookie is HttpOnly per the backend's `buildSessionCookieHeader` — the moderator JS never reads it directly. "Store in memory" in the original skeleton decision is a no-op given the cookie architecture; the in-memory state the moderator holds is the user identity (`userId`, `screenName`) from `/auth/me`, not the token itself.

## The login-navigation question — two options surveyed

- **Option A — Full-page navigation (`<a href="/auth/login">` or `window.location.assign('/auth/login')`)**. The browser follows the 302 to Authelia, posts the user's password to Authelia, follows Authelia's 302 back to `/auth/callback`, and lands on the app shell with the cookies in place. **Chosen.**
- **Option B — `fetch('/auth/login')` + manual redirect tracking**. The `fetch` Spec follows redirects, but only same-origin and only when the response is fetched as a navigation (which `fetch` doesn't do). For a cross-origin redirect to Authelia, `fetch` either errors (CORS) or returns an opaque response that can't be inspected. **Rejected.**

Option A's rationale: the OIDC handshake is inherently a navigation. Authelia renders its own login UI; the browser MUST visit that origin and submit form data to it. A `fetch`-based approach would require either an OIDC implicit flow (insecure) or a popup window with `postMessage` plumbing (complex, fragile across browsers). The plain anchor is the canonical implementation.

## The screen-name-detection question — two options surveyed

After `/auth/callback` returns its 200 JSON body for a new user, how does the moderator UI know to render the screen-name form?

- **Option A — Backend 302 redirects to `/screen-name` for new users.** The frontend's `/screen-name` route runs `useAuth()` (which calls `/auth/me`); `/auth/me` returns 401 (the pending cookie is NOT the platform session cookie). The frontend can't render "you are <pending>" because there's no session yet. **Considered but mismatched** — the redirect would land on a route whose only useful behavior is to POST `/auth/screen-name`, but the route can't display "you are X" without a session.
- **Option B — Backend returns 200 JSON; frontend reads `needsScreenName: true` and renders the form.** The backend's body is rendered by the browser as JSON. The frontend needs to be the renderer instead — the SPA fetches `/auth/callback`'s response itself OR the frontend installs a small landing-page handler at a client-side `/auth-callback` route that does the fetch. **Chosen via a hybrid.**

The hybrid chosen here:

1. The backend keeps its current contract: `/auth/callback` is a backend endpoint, not a frontend route.
2. The frontend adds a `/screen-name` route. The flow for a NEW user is:
   - The user clicks the login button. Browser navigates to `/auth/login` → Authelia → `/auth/callback`.
   - The backend's `/auth/callback` responds with `{ sub, oauthSubject, userId, needsScreenName: true }` and sets the pending cookie. The browser renders this as raw JSON — which is not the desired UX, but it's the documented contract.
   - **To improve this UX, this refinement adds a backend-side change**: when the `/auth/callback` user-agent indicates a browser (Accept: text/html), respond with a 302 to `/screen-name` on the frontend origin instead of the JSON body. The pending cookie is still set. The JSON shape is preserved for non-browser callers (CI scripts, future API clients).

**Decision deferral**: rather than coupling the moderator client to a backend change in this task, the chosen implementation:

- **Frontend Side**: the `/screen-name` route is reachable directly (e.g., via a "Continue" button on the JSON-body landing for now, or via manual navigation in dev). The route POSTs `/auth/screen-name` using the pending cookie that's already set on the browser, validates the response, then navigates to `/login` (which then sees `/auth/me` returning 200 and bounces to a default protected route — for this task, that default is `/login` rendering a "welcome, <name>" message; the actual moderator app routing lands later).
- **Documented gap**: the "raw JSON renders in the browser after a new-user callback" UX is acknowledged as an open question. A follow-up task (`moderator_ui.mod_shell.mod_screen_name_setup`'s 0.5d slot, or a separate small task) lands the backend Accept-header branching. This refinement does NOT block on that change.

## Constraints / requirements

- **Files under `apps/moderator/src/`**:
  - `auth/useAuth.ts` — the auth hook. Returns `{ status: 'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated', user?: { userId, screenName }, error?: { code, message }, refresh, logout }`. Internally: one `useState` + one `useEffect` that calls `GET /auth/me` on mount. Re-checks on `refresh()`. The hook IS the seam — `mod_state_management` will swap the internals for a Zustand subscription later; the call-site API stays the same.
  - `routes/Login.tsx` — updated. Renders one of three states:
    - **`loading`**: a localized "Checking session…" string.
    - **`unauthenticated`**: a login button (an `<a href="/auth/login">` anchor styled as a button).
    - **`authenticated`**: a welcome banner with `{user.screenName}` plus a logout button. (The future moderator app will redirect away from `/login` when authed; for this task the welcome render is the smoke surface.)
    - **`needs-screen-name`**: a `<Navigate to="/screen-name" replace />`.
  - `routes/ScreenName.tsx` — new. Renders the screen-name form: one text input (trimmed, max 64 chars on the client; the server re-validates), a submit button, an inline error region. On submit: POSTs `/auth/screen-name`, on 200 calls `auth.refresh()` and `<Navigate to="/login" replace />`. On 400/409 displays the error message; on 401 falls back to "please log in again" + a link to `/auth/login`.
  - `App.tsx` — updated. Adds the `/screen-name` route to the `<Routes>`. No other route gets gated in this task — the lobby / operate routes remain reachable directly (gating lands with `mod_state_management`'s store-driven redirect).
- **The auth hook MUST**:
  - Use `fetch` with `credentials: 'include'` so the browser sends the `aconversa-session` cookie. The cookie is HttpOnly + SameSite=Lax + same-origin (the Vite dev server proxies `/auth/*` to the backend); the include credential is still needed for the browser to attach the cookie to the XHR.
  - On `GET /auth/me` 401: set `status = 'unauthenticated'`. The hook does NOT differentiate "no cookie" vs "cookie expired" vs "user soft-deleted" — they all read as unauthenticated, matching the backend's leak-resistant 401 envelope.
  - On `GET /auth/me` 200: read `{ userId, screenName }` ONLY. Any other field on the response is ignored. If `screenName === '<pending>'`, set `status = 'needs-screen-name'` (defensive — the backend should not issue a session cookie before screen-name is set, but the audit-friendly client checks anyway).
  - On `POST /auth/logout`: fire the request, then call `window.location.reload()`. The cookie is gone; the reload re-runs the auth bootstrap and lands in `unauthenticated`. The `reload()` (not `Navigate`) ensures no Zustand store retains stale `userId` data.
- **The screen-name form MUST**:
  - Trim leading/trailing whitespace on submit (mirroring the backend's `validateScreenName`).
  - Disable submit when the trimmed input is empty.
  - Limit input length to 256 characters at the `<input maxLength={256}>` boundary — the backend's defensive schema cap. The handler-level validation (≤ 64 after trim) is server-side; the client's `maxLength` keeps the request payload small.
  - Render server-returned error messages localized — i.e., the error message field surfaces a localization KEY (`auth.screenName.errors.empty`, `auth.screenName.errors.tooLong`, `auth.screenName.errors.whitespaceOnly`, `auth.screenName.errors.alreadySet`, `auth.screenName.errors.pendingCookieInvalid`, `auth.screenName.errors.generic`). The mapping from server `code` to localization key lives in the form component.
- **No OIDC profile data**:
  - Audit-friendly: the hook never reads `sub`, `oauthSubject`, `email`, `picture`, `given_name`, `family_name`, `name`, `preferred_username`, `locale`, or any other OIDC claim field name. A client-side test asserts the auth hook source contains no such identifiers.
  - The `/auth/me` response is type-narrowed at the hook boundary to `{ userId: string; screenName: string }` — even if the backend grew to send extra fields, the hook discards them.
- **i18n strings** (new keys, added to all three locale catalogs):
  - `auth.login.title` — "Sign in" / "Entrar" / "Iniciar sesión"
  - `auth.login.button` — "Sign in with SSO" / "Entrar com SSO" / "Iniciar sesión con SSO"
  - `auth.login.checking` — "Checking session…" / "Verificando sessão…" / "Verificando sesión…"
  - `auth.login.welcome` — "Welcome, {name}" / "Bem-vinda(o), {name}" / "Bienvenida(o), {name}" (ICU MessageFormat — `{name}` is the screen name)
  - `auth.login.logout` — "Sign out" / "Sair" / "Cerrar sesión"
  - `auth.screenName.title` — "Choose your display name" / "Escolha seu nome de exibição" / "Elige tu nombre de pantalla"
  - `auth.screenName.label` — "Display name" / "Nome de exibição" / "Nombre de pantalla"
  - `auth.screenName.submit` — "Continue" / "Continuar" / "Continuar"
  - `auth.screenName.errors.empty` — "Please enter a display name." / "Por favor, informe um nome de exibição." / "Por favor, ingresa un nombre de pantalla."
  - `auth.screenName.errors.whitespaceOnly` — "Display name cannot be only whitespace." / "O nome de exibição não pode conter apenas espaços." / "El nombre no puede contener solo espacios."
  - `auth.screenName.errors.tooLong` — "Display name must be at most 64 characters." / "O nome de exibição deve ter no máximo 64 caracteres." / "El nombre debe tener como máximo 64 caracteres."
  - `auth.screenName.errors.alreadySet` — "This account already has a display name." / "Esta conta já tem um nome de exibição." / "Esta cuenta ya tiene un nombre de pantalla."
  - `auth.screenName.errors.pendingCookieInvalid` — "Your sign-in expired. Please sign in again." / "Sua sessão expirou. Entre novamente." / "Tu inicio de sesión expiró. Vuelve a iniciar sesión."
  - `auth.screenName.errors.generic` — "Could not save your display name. Please try again." / "Não foi possível salvar seu nome. Tente novamente." / "No se pudo guardar tu nombre. Inténtalo de nuevo."
- **Test layers per ADR 0022**:
  - **Vitest + Testing Library** in `apps/moderator/src/App.test.tsx` (extended) — auth states render the expected DOM (login button, welcome, logout, screen-name form), the screen-name form's submit-disabled logic respects whitespace-only / empty / valid input, the form POSTs the trimmed value, the form maps server error codes to localized strings, the auth hook discards extra fields from the `/auth/me` body, and the auth hook source contains no OIDC profile-claim identifiers.
  - `fetch` is replaced with a Vitest stub at suite scope. No real network.

## Acceptance criteria

- `pnpm install` clean.
- `pnpm run check` (lint + format + typecheck + tools + tests) green.
- `pnpm run test:smoke` (Vitest) green. New auth tests add ≥ 12 cases to the moderator suite. Baseline 1160 → ≥ 1172.
- `pnpm -F @a-conversa/moderator build` produces `apps/moderator/dist/index.html` + the assets.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` is added to `mod_auth_flow`.

## Decisions

- **Full-page navigation for `/auth/login`.** Rationale in the "two options" section above. The OIDC dance is inherently a navigation; a `fetch` cannot follow a cross-origin 302.
- **Hook-based auth (`useAuth()`), seam-marked for state-management swap.** Rationale: `mod_state_management` is the next sibling and will lift this into Zustand. The hook's call-site contract (`{ status, user, refresh, logout }`) survives the lift; only the internals (one `useState` + one `useEffect` today → a Zustand subscription later) change. Keeping today's implementation hook-shaped means the call sites in `Login.tsx` and `ScreenName.tsx` won't need rewriting.
- **`/auth/me` for "am I authed".** Rationale: there's no other source of truth — the HttpOnly cookie is unreadable from JS by design, and any client-side cached state (e.g., "I logged in 30 seconds ago") could be stale. `/auth/me` is the only definitive check. The cost is one HTTP round-trip on mount, which is acceptable.
- **`fetch` with `credentials: 'include'`.** Same-origin in production (Vite dev proxies `/auth/*` to the backend). The `credentials: 'include'` is harmless on same-origin and essential on cross-origin (a future deployment that splits the API and the frontend). Defaulting to `include` is the more robust posture.
- **Logout: POST + reload, not Navigate.** Rationale: a full reload tears down every React-side cache (Zustand stores once they land, in-memory `useState`). After logout, the user should look identical to a never-logged-in user; partial state pruning is more error-prone than a hard reset.
- **Screen-name form: client-side trim + length check, server-side authority.** The client trims on submit and disables the button on empty; the server runs the full validation and returns the canonical error codes. The client renders the localized message keyed off the server's `code` field. Two-tier validation is the standard pattern; the client tier is for UX responsiveness, not security.
- **Auth hook returns `{ status, user, refresh, logout }`, not `{ user, loading, error }`.** A discriminated `status` makes the four cases (loading / unauthenticated / needs-screen-name / authenticated) exhaustive — a TypeScript `switch` over `status` catches "I forgot to handle case X" at compile time. Renderers gate on `status` first, then narrow `user` accordingly.
- **The `/auth/me` response is narrowed at the hook boundary.** Even though the backend's `/auth/me` schema is `{ userId, screenName }` exactly today, the hook extracts only those two fields. Any future drift on the backend (the audit-suite would block it, but the client should also self-defend) is transparently ignored.
- **One callback redirect destination — `APP_BASE_URL`.** A returning user's backend callback 302s to `APP_BASE_URL`. The frontend lands on `/` (which the router then redirects to `/login` via the wildcard); `/login` sees `/auth/me` return 200 and renders the welcome. The flow does NOT yet redirect to the moderator's actual operating UI (lobby / operate) — that's `mod_state_management`'s job (introduce a `useAuth`-driven `<Navigate>` after the store lands).
- **The "raw JSON renders in browser after new-user callback" UX gap.** Acknowledged in the "screen-name-detection question" section. Two follow-up options are sketched (backend Accept-header branching to 302 to `/screen-name`, or a frontend `/auth-callback` route that fetches). Neither is on this task's plate; the workaround for the moderator developer is to navigate to `/screen-name` manually in dev. Production callers shouldn't hit this — the backend can land the 302 in a follow-up before the moderator UI ships to real users.

## Open questions

- **New-user callback UX**. The "raw JSON renders in browser" gap. Tracked as a follow-up; see Decisions.
- **Where does an authed user land after `/login`?** Today: the welcome render. Future: `mod_state_management` adds the `<Navigate to="/sessions">` (or wherever the dashboard lives) when authed.
- **Session-cookie refresh on long-lived sessions**. The cookie is HttpOnly + 7-day TTL; a moderator running a 3-hour debate is well within the window. A "refresh the cookie partway through" path is out of scope; if/when needed, the backend can land a `POST /auth/refresh` endpoint that the frontend pings periodically.
- **Cross-tab logout sync**. If a user logs out in tab A, tab B still has a stale `authenticated` state until it next polls `/auth/me`. The `mod_state_management` Zustand store can listen on `storage` events to sync; today's hook does not. Deferred.

## Status

**Done** — 2026-05-11.

Landed:

- `apps/moderator/src/auth/useAuth.ts` — the hook + the `AuthStatus` discriminated union + the `User` shape + the seam comment for `mod_state_management`'s future swap.
- `apps/moderator/src/routes/Login.tsx` — rewritten. Renders the four-state switch (loading / unauthenticated / needs-screen-name / authenticated) with localized strings.
- `apps/moderator/src/routes/ScreenName.tsx` — new. Screen-name form with client-side validation, POSTs `/auth/screen-name`, maps server error codes to localized strings.
- `apps/moderator/src/App.tsx` — adds the `/screen-name` route.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — added the `auth.*` namespace (login + screenName keys per the refinement spec).
- `apps/moderator/src/App.test.tsx` — extended with the auth suite (login button, welcome banner, logout, screen-name form validation, server-error mapping, no-profile-data audit).
- `tasks/30-moderator-ui.tji` — `complete 100` added to `mod_auth_flow`.

Test totals: Vitest 1160 → 1182 (+22). All green. `pnpm run check` + `pnpm -F @a-conversa/moderator build` + `tj3 project.tjp` clean.
