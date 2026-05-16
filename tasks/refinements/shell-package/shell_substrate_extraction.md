# Extract auth + screen-name + login/logout + i18n + WS + error-mapper substrate into `@a-conversa/shell`

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.shell_substrate_extraction`
**Effort estimate**: 7d
**Inherited dependencies**:

- `!shell_package.shell_pkg_skeleton` (settled — `@a-conversa/shell` workspace + Vite library build + `SHELL_PACKAGE_VERSION` pin shipped 2026-05-16 in commit `9035d9d`; see [`shell_pkg_skeleton.md`](shell_pkg_skeleton.md)).
- `!shell_package.shell_mount_contract` (settled — mount-contract types + four placeholder interfaces (`AuthContextValue`, `I18n`, `WebSocketClient`, `SurfaceMeta`) + the no-op-surface regression pin shipped 2026-05-16 in commit `275865a`; see [`shell_mount_contract.md`](shell_mount_contract.md)).
- `backend.auth.session_token_management` (settled — `GET /api/auth/me`, `POST /api/auth/screen-name`, `POST /api/auth/logout`, the `aconversa-session` + `aconversa-auth-pending` cookies; the moderator's existing `useAuth` is the live consumer).
- `frontend_i18n.i18n_catalog_workflow` (settled — `@a-conversa/i18n-catalogs` ships `buildInitOptions(locale)` and the per-locale resource bundles; see [`packages/i18n-catalogs/src/config.ts`](../../../packages/i18n-catalogs/src/config.ts)).
- `frontend_i18n.i18n_error_code_catalog` (settled — the `auth.screenName.errors.*` + `moderator.createSession.errors.*` namespaces already exist and are the localization keys the error mapper resolves into).
- `backend.websocket_protocol.ws_message_envelope` (settled — `@a-conversa/shared-types` exports `parseWsEnvelopeJson` + `serializeWsEnvelope` + `WsEnvelopeUnion` + the per-message payload map the moderator's existing client consumes).

## What this task is

The single **atomic transition** that moves the moderator's auth chrome, screen-name form, login-button + logout helper, i18n bootstrap, WebSocket client, and ApiError → i18n-key mapper out of `apps/moderator/src/` and into `packages/shell/src/`, rewires the moderator's imports to consume from `@a-conversa/shell`, wraps the moderator's `main.tsx` bootstrap in a shell-supplied provider tree, and updates the moderator's test wrappers in lockstep so the existing Vitest + Playwright suites stay green. Per [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) lines 69–76, all six subsystems are the shared substrate that downstream surfaces (`apps/participant/`, `apps/audience/`, `apps/replay-test/`) and the root app (`apps/root/`) consume; doing the move in one commit avoids six staggered moderator-side rewires (each subsystem would otherwise need its own "delete the moderator copy + retarget every importer + keep tests green" cycle, with the same auth-fetch consolidation reasoning playing out as a 6-way back-and-forth).

Eight sub-sections follow: six per substrate subsystem, one for the moderator-side rewire (including the provider-tree wrap and the test-wrapper consolidation), one for the shell-side test landings.

### 1. Auth context

Land a provider-based auth substrate at `packages/shell/src/auth/`:

- **`AuthProvider`** — a React provider component. Owns the one `useState`-backed auth state today (the same internals as the moderator's [`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 117–215) and fires the `GET /api/auth/me` bootstrap fetch **exactly once** per provider mount. The provider passes the live `UseAuthResult` value down through a `React.createContext` instance.
- **`useAuth()`** — the consumer hook. Reads from the provider's context. Calling `useAuth()` outside an `AuthProvider` throws (`"useAuth must be called inside <AuthProvider>"`) — same pattern as the moderator's existing `useWsClient` (see [`WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx) lines 92–98).
- **Canonical `AuthContextValue`** — widens the placeholder shape declared in [`packages/shell/src/mount-contract/types.ts`](../../../packages/shell/src/mount-contract/types.ts) lines 38–46. The real value retains the placeholder's required fields (`status`, `user`, `refresh`, `logout`) and adds the `error: AuthError | undefined` slot the moderator's hook already carries (see [`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 59–62). The real `AuthContextValue` MUST stay assignable to the placeholder so `MountProps.auth` consumers compiled against the floor keep typechecking — checked at compile time by the mount-contract test ([`mount-contract.test.ts`](../../../packages/shell/src/mount-contract/mount-contract.test.ts) lines 35–39).
- **The single-fetch consolidation.** The moderator's current shape is provider-less: every component that calls `useAuth()` runs its own `useState` + `useEffect` and fires its own `GET /api/auth/me`. The first paint of a protected route mounts the `RequireAuth` gate AND the wrapped route, each calling `useAuth` independently — that's the two-consumer pattern [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) lines 91–98 explicitly works around with per-call `Response` construction. With the provider, the bootstrap fetch fires once at the provider's mount; every `useAuth()` consumer reads the same context value. This is the **one** place the extraction is more than a code move: the shell consolidates N parallel `/auth/me` fetches per render to one.

Source layout: `packages/shell/src/auth/{AuthProvider.tsx, useAuth.ts, types.ts, index.ts}`. Re-exported through `packages/shell/src/index.ts`. The mount-contract types module ([`packages/shell/src/mount-contract/types.ts`](../../../packages/shell/src/mount-contract/types.ts)) is updated to re-export the canonical `AuthContextValue` from the auth module so the contract's floor and the auth subsystem's ceiling are the same type — eliminating drift between the two declarations.

The no-OIDC-profile-data invariant carries over verbatim. The provider's source MUST NOT reference `email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`, or any other OIDC claim identifier — the audit test (currently at [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) lines 1108–1133) moves to the shell's test suite and grep-asserts the shell's source files.

### 2. Screen-name form

Land `<ScreenNameForm>` at `packages/shell/src/screen-name/ScreenNameForm.tsx`. Extracted from [`apps/moderator/src/routes/ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) lines 181–335 — the **form body**, NOT the route wrapper. The route wrapper (`<ScreenNameRoute>`) stays in the moderator workspace and becomes a thin shim: it pulls `useAuth()` from `@a-conversa/shell`, renders `<ScreenNameForm onSuccess={() => navigate('/login', { replace: true })} />`, and is otherwise empty. The form owns:

- The client-side validation mirror of the backend's `screen-name.ts` pipeline ([`ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) lines 86–159): NFKC normalize + re-trim + length + control-char + format-codepoint + printable-class checks.
- The error-key mapping for both server envelope `code` values and the client-side `ClientValidationResult.reason` discriminant ([`ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) lines 46–59 + 166–179).
- The `POST /api/auth/screen-name` fetch + the success → `auth.refresh()` call + the `onSuccess` callback the route wrapper supplies for post-success navigation.
- The accessibility wiring (`aria-invalid` + `aria-describedby` + `aria-live` + focus-on-mount via `useRef` + `useEffect` + focus-on-error return).

`onSuccess` is the only public prop. The form keeps its data-testids (`screen-name-form`, `screen-name-input`, `screen-name-helper`, `screen-name-error`, `screen-name-submit`, `screen-name-label`) verbatim so the moderator's existing Vitest + Playwright assertions continue to query the same selectors. The `route-screen-name` testid stays on the **wrapper** `<main>` in the moderator (so `RequireAuth.test.tsx` lines 142–154 + the wrapper-level e2e assertions still pass).

### 3. Login / logout

Land `<LoginButton>` + `logout()` at `packages/shell/src/login-logout/`:

- **`<LoginButton>`** — extracted from [`apps/moderator/src/routes/Login.tsx`](../../../apps/moderator/src/routes/Login.tsx) lines 67–74 (the `<a href="/api/auth/login">` anchor styled as a button). Public props: `className?: string` (so consumers can pass through styling without the shell owning theme tokens), `'data-testid'?: string` defaulting to `auth-login-button` (so the moderator's existing assertion at [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) line 138 keeps working). The link target is the canonical `/api/auth/login` — full-page navigation, NOT a `fetch` — per the rationale in [`mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md) lines 51–55 (the OIDC handshake is inherently a cross-origin navigation; `fetch` cannot follow the 302 onto a foreign origin).
- **`logout()` helper** — the imperative function the moderator's `useAuth.logout` callback wraps ([`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 184–208). Signature `logout(): Promise<void>`. POSTs `/api/auth/logout` with `credentials: 'include'`, then calls `window.location.reload()` (the full reload tears down every in-memory React state — Zustand stores included — so the post-logout user is indistinguishable from a never-logged-in one). The helper is exposed on the canonical `AuthContextValue` (the provider wires `value.logout = logout` at construction time).

The moderator's `LoginRoute` (the four-state switch component at [`Login.tsx`](../../../apps/moderator/src/routes/Login.tsx) lines 27–75) stays in the moderator workspace — it owns the route's full DOM (the `<main data-testid="route-login">` + `<h1 data-testid="route-title">` + the welcome banner + the logout button + the per-state branching). It consumes `<LoginButton>` from `@a-conversa/shell` for the unauthenticated branch and `useAuth()` for everything else. The route's existing testids (`route-login`, `route-title`, `auth-checking`, `auth-welcome`, `auth-login-button`, `auth-logout-button`) stay verbatim.

### 4. i18n bootstrap

Land `createI18nInstance()` + `<I18nProvider>` at `packages/shell/src/i18n/`. Extracted from [`apps/moderator/src/i18n.ts`](../../../apps/moderator/src/i18n.ts) lines 18–26 — the entire moderator-local module is a 26-line wrapper around `i18next.use(ICU).use(initReactI18next).init(buildInitOptions(locale))` and moves wholesale:

- **`createI18nInstance(locale: SupportedLocale): Promise<I18nInstance>`** — the factory. Same plugin chain (`i18next-icu` for ICU MessageFormat per [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md), plus `initReactI18next` so React components consume the bound `t`), same canonical config from `@a-conversa/i18n-catalogs`. The function is renamed from `initI18n` to `createI18nInstance` to make the "this returns an instance, you bind it to a provider" semantics explicit — the moderator's old name suggested side-effect-only behavior even though it always returned the instance.
- **`<I18nProvider>`** — a thin `<I18nextProvider i18n={instance}>` wrapper. The shell exposes its own provider name (rather than asking consumers to import `I18nextProvider` from `react-i18next`) so the moderator's `main.tsx` consumes a uniform provider-trio surface from one package.

The moderator's existing `initI18n` re-exports get retargeted to the shell's `createI18nInstance` — every test file under `apps/moderator/src/` that calls `initI18n('en-US')` in a `beforeAll` (about 23 files per the grep earlier in this refinement's research pass — see [`packages/i18n-catalogs/src/config.ts`](../../../packages/i18n-catalogs/src/config.ts) and the `grep -l "from '\\../i18n'"` survey) keeps the same call shape but imports from `@a-conversa/shell` instead of `./i18n` / `../i18n`. The moderator's [`apps/moderator/src/i18n.ts`](../../../apps/moderator/src/i18n.ts) file is **deleted** in this commit; the test files update in lockstep.

Source layout: `packages/shell/src/i18n/{createI18nInstance.ts, I18nProvider.tsx, index.ts}`.

### 5. WebSocket client

Land the typed WS client + the provider + the Zustand store at `packages/shell/src/ws/`. Extracted from [`apps/moderator/src/ws/`](../../../apps/moderator/src/ws/) — the whole directory moves except for two file types: the per-feature test files inside the moderator (e.g. [`useProposeAction.test.tsx`](../../../apps/moderator/src/layout/useProposeAction.test.tsx)) that import `WsClientProvider` + `WsClient` + `SendFn` + `WsClientStatus` types stay where they are; only their import paths flip to `@a-conversa/shell`. Files that move:

- **[`client.ts`](../../../apps/moderator/src/ws/client.ts)** (532 lines) — the full `createWsClient` + `WsClient` + `WsRequestError` + `WsRequestTimeoutError` + reconnect-with-backoff + per-request correlation surface.
- **[`WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx)** (98 lines) — the React provider + `useWsClient` consumer hook. The narrow `WsClientAuthState` interface ([`WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx) lines 33–35) stays as the public auth-coupling boundary (the provider accepts the narrow shape so tests can wire it without the full auth provider).
- **[`wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts)** (241 lines) — the Zustand server-state slice fed by the client. Imports `diagnosticIdentityKey` from `../graph/diagnosticHighlights.js` and `withDevtools` from `../stores/devtools.js` today; both helpers stay in the moderator (they're moderator-graph-specific projections). In the shell, the store imports those helpers from `@a-conversa/moderator`? **No** — that would invert the dependency direction. Instead, the store is parameterized: see Decisions §"WsStore extraction shape" below for the chosen approach.
- **[`index.ts`](../../../apps/moderator/src/ws/index.ts)** (29 lines) — the barrel. Re-exports get hoisted to the shell's root barrel.

The canonical `WebSocketClient` placeholder ([`packages/shell/src/mount-contract/types.ts`](../../../packages/shell/src/mount-contract/types.ts) lines 80–83) widens here too: the real `WsClient` interface ships richer types (`connect`, `close`, `trackSession`, `untrackSession`, `onEnvelope`, typed `send`) and is re-exported by the mount-contract module so `MountProps.ws?: WsClient` resolves to the real type at consumer compile time. The placeholder's minimal `subscribe` + `send` shape stays assignable.

The two test seams that already exist in the moderator's client — `makeSocket: WsFactory` injection ([`client.ts`](../../../apps/moderator/src/ws/client.ts) lines 66–67) and the per-test `scheduleTimeout`/`cancelTimeout` overrides ([`client.ts`](../../../apps/moderator/src/ws/client.ts) lines 99–102) — carry over verbatim. The shell's own test suite uses them; the moderator's existing `ws/client.test.ts` (21 cases) translates to a shell test file that exercises the same surface against the same seams.

### 6. ApiError → i18n-key mapper

Land an `errorCodeToI18nKey` helper at `packages/shell/src/error-mapper/`. Two near-identical mappers exist in the moderator today:

- [`ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) lines 46–59 — auth-domain codes (`screen-name-invalid`, `screen-name-already-set`, `auth-pending-cookie-invalid`, `validation-failed`) → `auth.screenName.errors.*` keys.
- [`CreateSession.tsx`](../../../apps/moderator/src/routes/CreateSession.tsx) lines 60–77 — session-domain codes (`validation-failed`, `auth-required`) plus status-code-based fallbacks (401, 400) → `moderator.createSession.errors.*` keys.

The shell ships **two scoped mappers** rather than one mega-table: `mapScreenNameError(code: string): string` and `mapCreateSessionError(code: string, status: number): string`. Both return localization keys (the caller's `t()` resolves the key to the localized message). A third helper, `mapGenericApiError(code: string, status: number, fallbackKey: string): string`, encodes the shared status-code fallback pattern (401 → unauthenticated, 400 → validation, else → caller's fallback) so future domains compose without copy-pasting the table. The choice between one mapper and three is discussed in Decisions §"Scoped mappers vs one table".

The two `errorCodeToI18nKey` helpers in the moderator's source are **deleted** in this commit; the moderator's `ScreenName.tsx` + `CreateSession.tsx` import the shell's mappers and pass them through.

Source layout: `packages/shell/src/error-mapper/{index.ts, mapScreenNameError.ts, mapCreateSessionError.ts, mapGenericApiError.ts, types.ts}`.

### 7. Moderator-side rewire

Once the six shell subsystems are in place, the moderator workspace updates in one atomic pass:

- **Delete the moderator-local sources.** Six files (or seven, counting the `ws/` barrel):
  - [`apps/moderator/src/auth/useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts)
  - [`apps/moderator/src/i18n.ts`](../../../apps/moderator/src/i18n.ts)
  - [`apps/moderator/src/ws/client.ts`](../../../apps/moderator/src/ws/client.ts)
  - [`apps/moderator/src/ws/WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx)
  - [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) (subject to the dependency-direction question — see Decisions)
  - [`apps/moderator/src/ws/index.ts`](../../../apps/moderator/src/ws/index.ts)
  - The two `errorCodeToI18nKey` definitions inside `ScreenName.tsx` + `CreateSession.tsx` (in-file deletions, not whole-file).
  - The screen-name form body inside `ScreenName.tsx` (in-file deletion — the route becomes a shim).

  [`apps/moderator/src/auth/RequireAuth.tsx`](../../../apps/moderator/src/auth/RequireAuth.tsx) and [`apps/moderator/src/auth/RequireAuth.test.tsx`](../../../apps/moderator/src/auth/RequireAuth.test.tsx) STAY — `RequireAuth` is a moderator-internal gate composed of `useAuth()` + `<Navigate>` + the four-state switch, with moderator-specific redirect targets (`/login`, `/screen-name`). The participant and audience surfaces will write their own gates against their own redirect targets when they land. The moderator's RequireAuth just retargets its `useAuth` import to `@a-conversa/shell`.

- **Update the moderator-side imports.** Surveyed consumer counts per subsystem:
  - **`useAuth`** — 5 consumer files: [`RequireAuth.tsx`](../../../apps/moderator/src/auth/RequireAuth.tsx) line 68, [`routes/Login.tsx`](../../../apps/moderator/src/routes/Login.tsx) line 25, [`routes/ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) line 30, [`routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) line 56, [`routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) line 62.
  - **WS subsystem** (`useWsClient` / `useWsStore` / `WsClientProvider` / type imports of `WsClient`/`SendFn`/`WsClientStatus`) — 19 source-tree files matched by the `from '\\.\\./ws/` + `from '\\./ws/'` grep: a mix of layout components ([`PendingProposalsPane.tsx`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx), [`ProposalModeExitAffordance.tsx`](../../../apps/moderator/src/layout/ProposalModeExitAffordance.tsx), [`useProposeProposalAction.ts`](../../../apps/moderator/src/layout/useProposeProposalAction.ts)), test files (the `useProposeAction.test.tsx` + `useCommitAction.test.tsx` + `useProposeProposalAction.test.tsx` + `useProposeDecompositionAction.test.tsx` + `ProposeInterpretiveSplitAction.test.tsx` + `AxiomMarkSubmenu.test.tsx` + `PendingProposalsPane.test.tsx` cluster), the two route consumers ([`InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 57–58, [`Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) line 82), the `main.tsx` bootstrap (line 23), and the moderator's [`stores/index.ts`](../../../apps/moderator/src/stores/index.ts) re-export line 19. All imports retarget to `@a-conversa/shell`.
  - **`initI18n` → `createI18nInstance`** — 23 importer files (the `grep -l "from '\\../i18n'"` survey). The mass rename is a single sed-equivalent pass plus a function-name rename. Every test file that does `await initI18n('en-US')` in its `beforeAll` becomes `await createI18nInstance('en-US')` (or the shell may re-export a backward-compat `initI18n` alias to reduce churn — see Decisions).
  - **`errorCodeToI18nKey`** — 2 in-file definitions to delete + 2 in-file call sites to retarget at the shell's imports. Self-contained.
  - **`<ScreenNameForm>`** — 1 consumer (the moderator's [`ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) route shim).
  - **`<LoginButton>`** — 1 consumer (the moderator's [`Login.tsx`](../../../apps/moderator/src/routes/Login.tsx) route's unauthenticated branch).

- **Wrap the moderator's `main.tsx` in the shell provider tree.** Current bootstrap ([`main.tsx`](../../../apps/moderator/src/main.tsx) lines 25–60): `initI18n(...)` then `ReactDOM.createRoot(...).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)`. After the rewire, the bootstrap becomes:

  ```tsx
  const i18n = await createI18nInstance(negotiateAuthenticatedLocale());
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
  ```

  Provider order rationale: i18n outermost (auth error messages localize off `t`; the auth provider's children — including `RequireAuth`'s loading-frame DOM — render localized strings); then auth (the WS connection's open-or-not gate is driven by `auth.status === 'authenticated'`); then BrowserRouter (route components consume both providers). The existing **WS provider** stays where it is in [`InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 146–151 and [`Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) lines 93–98 — both routes mount `<WsClientProvider auth={{ status: auth.status }}>` scoped to themselves so the WS connection lifetime is route-bounded (the `/login`, `/screen-name`, `/sessions/new`, `/sessions/:id/lobby` routes don't open WS; see [`Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) lines 38–46 for the explicit rationale). No top-level `<WsProvider>` wrap in `main.tsx` — the per-route mount is intentional and stays. The `window.__aConversaWsStore` exposure ([`main.tsx`](../../../apps/moderator/src/main.tsx) lines 30–47) stays in the moderator's bootstrap (it's a moderator-side test seam for the existing Playwright graph specs); after the rewire, it imports `useWsStore` from `@a-conversa/shell` instead of `./ws/wsStore`.

- **Update the moderator's test wrappers.** The two test files that render `<App />` at the router level — [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) and [`auth/RequireAuth.test.tsx`](../../../apps/moderator/src/auth/RequireAuth.test.tsx) — currently render the bare `App` inside `<MemoryRouter>` and rely on each component's own `useAuth()` consumption to fire the fetch stub against `global.fetch`. Under the new provider model the `<AuthProvider>` becomes the fetch consumer (one call per render tree) and the tests must wrap `App` in `<AuthProvider>` for `useAuth()` to resolve at all (the bare hook now throws outside the provider per the moderator's own `useWsClient` precedent).

  Add a **shared test helper** at `apps/moderator/src/testing/renderWithProviders.tsx` (new directory) that wraps a render call in `<I18nProvider><AuthProvider><MemoryRouter initialEntries={[path]}>...</MemoryRouter></AuthProvider></I18nProvider>`. Both [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) and [`auth/RequireAuth.test.tsx`](../../../apps/moderator/src/auth/RequireAuth.test.tsx) consume the helper. Inline-wrapping every `render(...)` call site (44 in `App.test.tsx`, 13 in `RequireAuth.test.tsx`) is the alternative; the helper wins on maintenance cost.

  The fetch-stub helpers in both files (`stubAuthMeNeedsScreenName`, `fetchUnauthenticated`, `fetchAuthenticated`, `fetchNeedsScreenName`, `fetchPendingForever`) stay where they are; under the provider model they now satisfy exactly one `/api/auth/me` call per `render` (rather than two for protected-route renders), so the `vi.fn(() => ...)` per-call response construction is no longer strictly required — but it stays in place for safety (the mock's per-call shape doesn't hurt the single-consumer case and protects against drift if a test stops using the provider helper).

- **Delete the obsolete `describe('no-profile-data audit on the moderator client', ...)` block** at [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) lines 1108–1133. The block greps `apps/moderator/src/auth/useAuth.ts`, which no longer exists after this commit. The equivalent audit moves to `packages/shell/src/auth/auth.test.ts` and grep-asserts the shell's source files (`AuthProvider.tsx`, `useAuth.ts`, `types.ts`) for the same forbidden-identifier list. The moderator's audit is gone; the invariant is now the shell's.

### 8. Tests

The shell ships Vitest suites under `packages/shell/src/<subsystem>/` per [ADR 0006](../../../docs/adr/0006-unit-test-framework-vitest.md) + [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md). Per-subsystem coverage targets (translated from the moderator's existing suites plus the new provider-consolidation pin):

- **auth** (`packages/shell/src/auth/auth.test.ts`, est. 18–24 cases):
  - Bootstrap matrix: 200 OK with `{ userId, screenName: 'alice' }` → `status='authenticated'`; 200 OK with `{ screenName: '<pending>' }` → `status='needs-screen-name'`; 401 → `status='unauthenticated'`; non-OK 5xx → `status='unauthenticated'` + `error.code='auth-me-failed'`; malformed body → `status='unauthenticated'` + `error.code='auth-me-malformed'`; thrown fetch (network error) → `status='unauthenticated'` + `error.code='network-error'`.
  - Refresh: `refresh()` re-fires `/api/auth/me` and re-resolves the status.
  - Logout: `logout()` POSTs `/api/auth/logout` with `credentials: 'include'` and calls `window.location.reload()`.
  - No-profile-data audit: grep over `AuthProvider.tsx`, `useAuth.ts`, `types.ts` for the forbidden-identifier list (the same list as [`App.test.tsx`](../../../apps/moderator/src/App.test.tsx) lines 1118–1129).
  - **One-fetch-per-provider pin** (the consolidation regression-pin): mount `<AuthProvider>` with N children each calling `useAuth()` (say N=4), assert `fetch` was called exactly once with `/api/auth/me`. This is the new test the moderator's per-consumer-fetch shape never carried; it pins the consolidation property the extraction adds.
  - `useAuth()` outside provider throws.

- **screen-name form** (`packages/shell/src/screen-name/screen-name-form.test.tsx`, est. 14–18 cases):
  - Disables submit when empty / whitespace-only after trim.
  - POSTs the NFKC-normalized trimmed value to `/api/auth/screen-name`.
  - Maps server `code` envelopes to the expected i18n keys: `screen-name-invalid` → `auth.screenName.errors.invalidCharacter`, `screen-name-already-set` → `auth.screenName.errors.alreadySet`, `auth-pending-cookie-invalid` → `auth.screenName.errors.pendingCookieInvalid`, unknown → `auth.screenName.errors.generic`.
  - Client-side mirror rejections: bidi-override (RLO U+202E), zero-width joiner (U+200D), C0 control (U+0000) without POSTing.
  - On 200 success: calls `auth.refresh()` then `onSuccess`.
  - Accessibility wiring: `aria-invalid` toggles, `aria-describedby` is stable, focus returns to input on server-side error.
  - The ICU helper-text `{used}/{max}` formatting (a single case in moderator's suite).

- **login/logout** (`packages/shell/src/login-logout/login-logout.test.tsx`, est. 4–6 cases):
  - `<LoginButton>` renders an `<a href="/api/auth/login" data-testid="auth-login-button">` (default testid).
  - `<LoginButton className="custom">` passes className through.
  - `logout()` POSTs `/api/auth/logout` with `credentials: 'include'`.
  - `logout()` calls `window.location.reload()` after the POST resolves.
  - `logout()` swallows fetch rejections (logs to the auth provider's `error` slot) but still calls `reload()` — same shape as [`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 191–207.

- **i18n bootstrap** (`packages/shell/src/i18n/i18n.test.ts`, est. 5–7 cases):
  - `createI18nInstance('en-US')` resolves with an i18next instance whose `language === 'en-US'`.
  - `createI18nInstance('pt-BR')` resolves with `language === 'pt-BR'`; the instance resolves the canary `chrome.hello` key from the pt-BR catalog.
  - `createI18nInstance('es-419')` mirror.
  - ICU interpolation works: `i18n.t('auth.login.welcome', { name: 'alice' })` → "Welcome, alice".
  - `<I18nProvider i18n={instance}>` wraps `<I18nextProvider>` correctly — a child using `useTranslation()` resolves `t('chrome.hello')` to the localized string.

- **ws client** (`packages/shell/src/ws/ws-client.test.ts`, est. 21 cases — direct translation of the moderator's existing [`ws/client.test.ts`](../../../apps/moderator/src/ws/client.test.ts)):
  - The 21 existing moderator cases in [`client.test.ts`](../../../apps/moderator/src/ws/client.test.ts) covering: connect + hello (3 cases), send + correlation + acks (4 cases), inbound dispatch + store writes (6 cases), reconnection + catch-up (5 cases), trackSession / untrackSession (2 cases), backoff escalation + reset (1 case).
  - Plus the 3 `WsClientProvider` tests from [`WsClientProvider.test.tsx`](../../../apps/moderator/src/ws/WsClientProvider.test.tsx): opens on auth flip, closes + resets on unmount, throws outside provider.

- **error mapper** (`packages/shell/src/error-mapper/error-mapper.test.ts`, est. 10–14 cases):
  - `mapScreenNameError` against each known auth-domain code (`screen-name-invalid`, `screen-name-already-set`, `auth-pending-cookie-invalid`, `validation-failed`); each maps to the documented key.
  - `mapScreenNameError('unknown-code')` returns the generic fallback key.
  - `mapCreateSessionError` against each known session-domain code + status (validation-failed, auth-required, 401 status without recognized code, 400 status without recognized code, generic fallback).
  - `mapGenericApiError` composition test against arbitrary domains.

**Net expected delta.** Counting conservatively: 18+14+4+5+21+3+10 = 75 shell cases. Net `pnpm run test:smoke` count delta: positive — the shell adds 75 new cases, the moderator drops only the 1 obsolete no-profile-data block. Net add of roughly +60 to +75 cases is in line with the brief's "+30 to +60" guideline (the brief was conservative; the WS suite alone moves 24 cases). The moderator's [`ws/client.test.ts`](../../../apps/moderator/src/ws/client.test.ts) + [`ws/WsClientProvider.test.tsx`](../../../apps/moderator/src/ws/WsClientProvider.test.tsx) files are **deleted** in this commit (the shell's translated suites replace them); the moderator's other test files (auth/RequireAuth, App, routes/*, layout/*, graph/*) stay intact except for the import-path retargeting. The moderator's `wsStore.test.ts` file goes with the store extraction — see Decisions §"WsStore extraction shape" for the contingent path.

## Why it needs to be done

Two reasons interlock:

**Atomic transition vs six staggered transitions.** The original WBS held seven separate shell-package leaves (`shell_auth_context`, `shell_screen_name_form`, `shell_login_logout_components`, `shell_i18n_bootstrap`, `shell_ws_client`, `shell_error_mapper`, `shell_tests`) plus the tests leaf. Each one of them would have required its own moderator-side rewire — the moderator's `useAuth` consumers can't be retargeted at `@a-conversa/shell`'s auth context until the auth context exists; the WS consumers can't be retargeted until the WS client moves; etc. With six staggered transitions, every one of them spends 30%-50% of its scope re-explaining "delete the moderator copy of X, retarget the importers, keep tests green." Collapsing to one transition (per user redirect 2026-05-16, captured in commit `b314160`) does the rewire once.

**Provider-consolidation win for auth.** The single more-than-code-move change is the auth provider. The moderator's current pattern (every component calls `useAuth()` independently, each one runs its own `/auth/me` fetch) was a deliberate `mod_auth_flow` posture — the comment in [`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 13–22 marks the hook as a future-seam for `mod_state_management`'s Zustand swap that never happened (the Zustand slice narrowed to local UI state instead, per `mod_state_management`'s actual landed scope). Under the shell, the seam graduates to a provider: one fetch per render tree, all consumers read from context. The downstream surfaces (`apps/root/`, `apps/participant/`, `apps/audience/`) inherit the consolidated shape for free.

This task unblocks: `moderator_ui.mod_extract_to_mountable_library` (which needs `@a-conversa/shell` to host the substrate before the moderator can ship as a `mount()`-exporting library), every `root_app.*` leaf (the root's `<AuthProvider>` + `<I18nProvider>` + dispatcher all consume the shell's substrate), and every milestone-leaf in `m_manual_lobby_smoke`'s `depends` chain that reaches through the new architecture.

## Inputs / context

- [`docs/adr/0026-micro-frontend-root-app.md`](../../../docs/adr/0026-micro-frontend-root-app.md) lines 69–76 — declares `packages/shell/` as the home for the auth context + screen-name form + login/logout helpers + i18n bootstrap + WS client + error mapper; this task is the concrete extraction. Lines 110–117 "Stack-validation tests" explicitly defer end-to-end coverage of the shell to its downstream consumers (the shell ships Vitest-only at the package layer).
- [`apps/moderator/src/auth/useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 1–215 — the canonical auth implementation. Lines 42–70 declare the `AuthUser` / `AuthStatus` / `AuthError` / `UseAuthResult` shapes that widen the mount-contract placeholder; lines 91–105 declare the `narrowAuthUser` guard that pins the no-profile-data invariant at the response boundary; lines 122–182 own the `refresh()` body the provider's bootstrap re-uses verbatim; lines 184–208 own the `logout()` body.
- [`apps/moderator/src/auth/RequireAuth.tsx`](../../../apps/moderator/src/auth/RequireAuth.tsx) lines 1–117 — the first `useAuth()` consumer; the gate stays in the moderator (moderator-specific redirect targets) but its `useAuth` import retargets to `@a-conversa/shell`.
- [`apps/moderator/src/auth/RequireAuth.test.tsx`](../../../apps/moderator/src/auth/RequireAuth.test.tsx) lines 27–304 — 13-case test surface; renders use `<MemoryRouter>` + `<App />` directly today and need `<AuthProvider>` wrapping under the new model. The shared test helper (Decision below) is the single touchpoint.
- [`apps/moderator/src/routes/Login.tsx`](../../../apps/moderator/src/routes/Login.tsx) lines 67–74 — the `<LoginButton>` extraction source. Lines 31–60 are the route wrapper (stays in the moderator).
- [`apps/moderator/src/routes/ScreenName.tsx`](../../../apps/moderator/src/routes/ScreenName.tsx) lines 46–59 (the auth-error mapper extraction source), lines 86–159 (the client-side validation mirror), lines 161–179 (the `clientReasonToI18nKey` mirror), lines 181–335 (the `<ScreenNameForm>` body — extracted whole; the wrapper becomes a shim).
- [`apps/moderator/src/routes/CreateSession.tsx`](../../../apps/moderator/src/routes/CreateSession.tsx) lines 60–77 (the session-error mapper extraction source), lines 124–148 (the consumer of that mapper). The route otherwise stays moderator-side.
- [`apps/moderator/src/routes/InviteParticipants.tsx`](../../../apps/moderator/src/routes/InviteParticipants.tsx) lines 56–58 (`useAuth` + `WsClientProvider` + `useWsClient` imports — retargeted to `@a-conversa/shell`), lines 139–151 (the `<WsClientProvider>` mount that stays at the route level), lines 178–184 (the `trackSession` / `untrackSession` lifecycle that stays).
- [`apps/moderator/src/routes/Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) lines 62 (auth import), 82–98 (the `<WsClientProvider>` mount), 129–135 (the per-route session lifecycle), 38–46 (the comment explaining why WS is route-scoped rather than `main.tsx`-scoped — this rationale carries into the post-rewire moderator unchanged).
- [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx) lines 15–62 — the bootstrap that gets wrapped in `<I18nProvider><AuthProvider><BrowserRouter>...</BrowserRouter></AuthProvider></I18nProvider>` after the rewire. The `window.__aConversaWsStore` exposure (lines 28–47) stays; its import retargets to `@a-conversa/shell`.
- [`apps/moderator/src/App.tsx`](../../../apps/moderator/src/App.tsx) lines 39–95 — unchanged by this task (no provider lives in `App.tsx` today; the rewire targets `main.tsx` instead).
- [`apps/moderator/src/App.test.tsx`](../../../apps/moderator/src/App.test.tsx) lines 30–32 (the `beforeAll` calling `initI18n` — retargeted to `createI18nInstance` from `@a-conversa/shell`); lines 91–98 (the per-call `Response` workaround for the double-consumer pattern — survives, just rarely triggered now); lines 1108–1133 (the obsolete no-profile-data audit block — deleted in this commit; the equivalent lands in `packages/shell/src/auth/auth.test.ts`). The 44 `it(...)` cases in this file (per the line-count grep) all stay, with `render(<MemoryRouter>...<App />...</MemoryRouter>)` call sites wrapped in the shared `renderWithProviders` helper.
- [`apps/moderator/src/i18n.ts`](../../../apps/moderator/src/i18n.ts) lines 18–26 — the entire moderator-local i18n bootstrap. Moves wholesale to `packages/shell/src/i18n/createI18nInstance.ts`; the moderator file is deleted.
- [`apps/moderator/src/ws/client.ts`](../../../apps/moderator/src/ws/client.ts) lines 1–532 — the typed WS client. Moves wholesale to `packages/shell/src/ws/client.ts`. Lines 31–37 (`@a-conversa/shared-types` imports) carry over; line 39 (`./wsStore.js` import) becomes `./wsStore.js` inside the shell.
- [`apps/moderator/src/ws/WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx) lines 1–98 — moves wholesale. The narrow `WsClientAuthState` interface (lines 33–35) stays as the boundary.
- [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) lines 1–241 — the Zustand store. Two moderator-internal imports complicate the move: line 31 imports `diagnosticIdentityKey` from `../graph/diagnosticHighlights.js` (a moderator-side projection function), and line 32 imports `withDevtools` from `../stores/devtools.js` (a moderator-side devtools wrapper). See Decisions §"WsStore extraction shape" for the chosen path.
- [`packages/shell/src/mount-contract/types.ts`](../../../packages/shell/src/mount-contract/types.ts) lines 38–46 (`AuthContextValue` placeholder — widens), 58–62 (`I18n` placeholder — widens to the real `i18next.i18n` type), 80–83 (`WebSocketClient` placeholder — widens to `WsClient`). After the widening, the mount-contract test ([`mount-contract.test.ts`](../../../packages/shell/src/mount-contract/mount-contract.test.ts) lines 29–58) MUST still pass — the no-op-surface shape is preserved as the **floor**, and the real implementations are assignable to it.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) lines 1–34 — the barrel. Gains per-subsystem re-exports above the existing `SHELL_PACKAGE_VERSION` line.
- [`packages/shell/package.json`](../../../packages/shell/package.json) lines 1–26 — needs its `peerDependencies` expanded (see Constraints). NO `dependencies` are added.
- [`packages/i18n-catalogs/src/config.ts`](../../../packages/i18n-catalogs/src/config.ts) lines 128–160 — `buildInitOptions(locale)` is the source the new `createI18nInstance` factory consumes (same as the moderator's `initI18n` does today).
- [`packages/i18n-catalogs/package.json`](../../../packages/i18n-catalogs/package.json) lines 27–33 — `i18next@26.1.0`, `i18next-icu@2.4.3`, `react-i18next@17.0.7` are the runtime deps the shell needs as peer-deps after this task.
- [`docs/adr/0024-frontend-i18n-react-i18next-with-icu.md`](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — i18next-icu plugin chain rationale; carries over.
- [`docs/adr/0010-directory-layout-pnpm-workspaces.md`](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) lines 60–65 — the `source` / `default` dual-export pattern; the shell follows it.
- [`docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md`](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — TypeScript strict per the shared `tsconfig.base.json`.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every new behavior ships with a committed test.
- [`tasks/refinements/shell-package/shell_pkg_skeleton.md`](shell_pkg_skeleton.md) + [`tasks/refinements/shell-package/shell_mount_contract.md`](shell_mount_contract.md) — sibling refinements; mirror their style (real line numbers, ADR cites with sub-decisions, alternatives + rationale in Decisions).
- [`tasks/refinements/moderator-ui/mod_auth_flow.md`](../moderator-ui/mod_auth_flow.md) — the moderator's existing auth design. Most of it carries over; the route + form decisions (full-page navigation, hook seam, `/auth/me` for "am I authed", `fetch` with `credentials: 'include'`, logout + reload, screen-name client-side trim + length check) all stay.

## Constraints / requirements

- **No new top-level dependencies.** The shell consumes React + i18next + react-i18next + i18next-icu as peer-deps. Their root-level versions are already pinned in [`apps/moderator/package.json`](../../../apps/moderator/package.json) lines 13–22 and [`packages/i18n-catalogs/package.json`](../../../packages/i18n-catalogs/package.json) lines 27–33; the shell uses `peerDependencies` (not `dependencies`) so consumers own the version.
- **`packages/shell/package.json` `peerDependencies` widens** to: `react`, `react-dom`, `react/jsx-runtime` (already present via the `*` pin), plus `i18next` (`^26.1.0`), `react-i18next` (`^17.0.7`), `i18next-icu` (`^2.4.3`), `zustand` (`^5.0.13`), `@a-conversa/i18n-catalogs` (`workspace:*`), `@a-conversa/shared-types` (`workspace:^`). The `@a-conversa/*` workspace peers reflect that the shell consumes the i18n catalog config and the WS envelope schema at runtime; the consumer (moderator, root, future surfaces) provides the workspace install.
- **NO `dependencies` entries land in `packages/shell/package.json`.** Every cross-package use is a peer, not a bundled dep. The shell is a library; its consumers own the resolved version.
- **Every type widened from the mount-contract placeholder MUST stay assignable to the placeholder.** The mount-contract module re-exports the real types from the new subsystem modules so `MountProps.auth: AuthContextValue` (etc.) resolves to the canonical type, and the no-op-surface regression pin ([`mount-contract.test.ts`](../../../packages/shell/src/mount-contract/mount-contract.test.ts) lines 29–58) continues to pass without modification. The test's stub `AuthContextValue` (`{ status: 'loading', refresh: () => {}, logout: () => {} }`) MUST remain a valid `AuthContextValue` — `error` is optional, `user` is optional, the discriminant set is unchanged.
- **All existing moderator Vitest tests stay green.** Net moderator test count: lose the 1-case no-profile-data block (lines 1108–1133), lose the 21 `ws/client.test.ts` cases + 3 `ws/WsClientProvider.test.tsx` cases (subsumed by the shell's translated suites — the shell's test suite is the new home for "the WS client behaves correctly"; the moderator no longer needs a duplicate). Net moderator delta: −25 cases. The shell gains ~75 cases. Net `pnpm run test:smoke` delta: roughly +50 (substantial positive net per the brief's "+30 to +60" target with room to spare).
- **The moderator's Playwright suites stay green.** Substrate change shouldn't affect user-visible behavior — the auth flow, screen-name flow, login/logout, route gating, and WS-driven UI surfaces all behave identically. The Playwright suite under `tests/e2e/` runs in the compose stack; the Implementer brings the stack up (`make up`), runs the suite, tears down (`make down-v`).
- **Tj3 hook is not triggered.** No `.tji` changes in this commit (the Closer adds `complete 100` to the leaf after the Implementer is done; that's a separate commit cycle's concern from the refinement). The lint + typecheck + format pre-commit checks ([ADR 0014](../../../docs/adr/0014-pre-commit-hooks-husky-lint-staged.md)) run normally.
- **Test seams preserved.** Every test-injection seam the moderator's WS client carries (`makeSocket`, `randomId`, `scheduleTimeout`, `cancelTimeout`, `onEnvelope`, `onStatusChange`, the per-`WsClientProvider` `client` prop override) survives the move. The shell's `ws/client.test.ts` uses the same seams; the moderator's deep test files (`useProposeAction.test.tsx`, `useCommitAction.test.tsx`, `useProposeProposalAction.test.tsx`, `useProposeDecompositionAction.test.tsx`, `PendingProposalsPane.test.tsx`, `ProposeInterpretiveSplitAction.test.tsx`, `AxiomMarkSubmenu.test.tsx`) keep their `<WsClientProvider auth={...} client={fakeClient}>` wraps verbatim — only the import path changes (`from '../ws/WsClientProvider'` → `from '@a-conversa/shell'`).
- **`@a-conversa/shell` consumes `@a-conversa/i18n-catalogs` + `@a-conversa/shared-types` as workspace peers.** The shell does NOT bundle either — both already build to `dist/` and the moderator's existing import patterns (`from '@a-conversa/shared-types'`, `from '@a-conversa/i18n-catalogs'`) carry over verbatim into the shell's source.
- **ESLint clean.** The flat config at the root (`eslint.config.js`) covers `packages/**/*.{ts,tsx}` automatically (line 47); no per-workspace config.
- **TypeScript strict.** Per [ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md). The shell's existing `tsconfig.json` extends `../../tsconfig.base.json`; the new source files inherit `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Vite library-mode build.** The shell's existing [`vite.config.ts`](../../../packages/shell/vite.config.ts) needs `rollupOptions.external` widened to include `i18next`, `react-i18next`, `i18next-icu`, `zustand`, `@a-conversa/i18n-catalogs`, `@a-conversa/shared-types` so the bundle doesn't double-bundle the consumer's versions. Same `external` pattern as React's existing entry on lines 32.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script the CI already runs.

- `pnpm -F @a-conversa/shell build` exits zero and produces a `dist/` tree containing per-subsystem `.d.ts` exports plus the bundled ESM `index.js`. `dist/index.d.ts` exports `AuthProvider`, `useAuth`, `AuthContextValue`, `AuthUser`, `AuthStatus`, `AuthError`, `ScreenNameForm`, `LoginButton`, `logout`, `createI18nInstance`, `I18nProvider`, `createWsClient`, `WsClient`, `WsClientProvider`, `useWsClient`, `useWsStore`, `WsRequestError`, `WsRequestTimeoutError`, `mapScreenNameError`, `mapCreateSessionError`, `mapGenericApiError`, plus the mount-contract names that already shipped.
- `pnpm -F @a-conversa/shell typecheck` exits zero under TypeScript strict.
- `pnpm -F @a-conversa/shell test` runs the new test suites (auth, screen-name, login-logout, i18n, ws, error-mapper) — expect ~75 cases new in the shell.
- `pnpm -F @a-conversa/moderator build` exits zero and produces a valid moderator bundle (Vite SPA mode; the library-mode conversion is `mod_extract_to_mountable_library`'s job, not this one). The bundle imports from `@a-conversa/shell` resolve via pnpm workspace.
- `pnpm -F @a-conversa/moderator typecheck` exits zero.
- `pnpm -F @a-conversa/moderator test` stays green. Net case count delta: −25 (the obsolete no-profile-data block + the moderator's `ws/client.test.ts` + `ws/WsClientProvider.test.tsx` are deleted; the equivalents now live in the shell). No other moderator test drops.
- `pnpm run check` (lint + format + typecheck + tools + tests) green across all workspaces.
- `pnpm run test:smoke` total count goes UP by roughly +50 (the shell's +75 minus the moderator's −25).
- `pnpm run test:e2e` (Playwright; runs under `make up`/`make down-v`) stays green for the moderator suites. **This is a hard criterion** — the rewire touches moderator UI code (provider wrap in `main.tsx`, every `useAuth` import retargeted) and the existing user-visible flows MUST continue to work.
- Audit greps confirm the moderator-local implementations are gone:
  - `grep -rn "from '\\./auth/useAuth'" apps/moderator/src/` returns zero matches.
  - `grep -rn "from '\\.\\./auth/useAuth'" apps/moderator/src/` returns zero matches.
  - `grep -rn "from '\\./ws/client'" apps/moderator/src/` returns zero matches (other than test files that explicitly import from `@a-conversa/shell`'s `ws/client` re-export — which is fine, the path is `from '@a-conversa/shell'`).
  - `find apps/moderator/src/auth/useAuth.ts apps/moderator/src/i18n.ts apps/moderator/src/ws/client.ts apps/moderator/src/ws/WsClientProvider.tsx apps/moderator/src/ws/index.ts` returns "no such file" for all five paths.
- The shell's no-profile-data audit case (in `packages/shell/src/auth/auth.test.ts`) asserts the source files `AuthProvider.tsx`, `useAuth.ts`, `types.ts` contain none of: `email`, `picture`, `given_name`, `givenName`, `family_name`, `familyName`, `preferred_username`, `preferredUsername`, `oauthSubject`, `fetchUserInfo`. Symmetric with the moderator's deleted block.
- The mount-contract regression pin ([`mount-contract.test.ts`](../../../packages/shell/src/mount-contract/mount-contract.test.ts)) passes unchanged — `MountProps` + `SurfaceModule` + the no-op-surface stub still compile with the widened placeholder interfaces.
- The new one-fetch-per-provider pin in the auth test suite asserts that mounting `<AuthProvider>` with N children each calling `useAuth()` (N=4 in the test) fires `/api/auth/me` exactly once.

### UI-stream e2e policy

`shell_substrate_extraction` is **substrate**, not a UI-stream task per the categorization in [`ORCHESTRATOR.md`](../../../ORCHESTRATOR.md) lines 220–231. **No new Playwright spec lands in the shell** — per [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) lines 113–117 ("Stack-validation tests"), end-to-end coverage of the shell happens through the shell's downstream consumers (moderator, future participant/audience/root). The shell ships Vitest-only at the package layer.

**However**: this task DOES touch moderator UI code (rewires imports + wraps providers + retargets the test helpers + deletes the moderator's local auth/i18n/WS sources). The moderator's existing Playwright suites under `tests/e2e/` MUST stay green — running them is a **hard acceptance criterion**. The Implementer brings the compose stack up (`make up`), runs `pnpm run test:e2e`, and tears down with `make down-v` per the standard cycle. Any user-visible behavior change in the auth flow, screen-name flow, login/logout, route gating, or WS-driven UI that breaks a Playwright assertion is a rewire regression that must be fixed before commit.

## Decisions

- **Atomic transition (one commit) vs the original seven separate leaves.** Alternatives:
  - *Keep the seven separate leaves and ship them one at a time.* Rejected per user redirect 2026-05-16 (commit `b314160`). Each separate leaf would have spent 30%–50% of its scope on the moderator-side rewire boilerplate — "delete the moderator's local X, retarget the imports, keep tests green" — and the moderator's provider tree would have churned six times as new providers landed and got integrated. The redirect's reasoning ("duplicate plumbing 6× for no benefit") is the cleanest path.
  - *Two-commit split: ship the shell first as a side-by-side package, then rewire the moderator second.* Rejected — a "shell ships but moderator hasn't rewired" interim state means the shell has zero consumers in the moderator workspace, so the shell's tests are the only thing keeping it honest. The moderator workspace also briefly carries DOUBLE implementations (its own + the shell's), which violates the no-throwaway-verifications spirit (the moderator's tests pin the moderator's implementation; the shell's tests pin the shell's; for one commit, both exist and disagree on which is authoritative). The single-commit move keeps the authority single-sourced at every commit boundary.
  - *Chosen:* one atomic commit. The Implementer lands the six shell subsystems, the moderator-side rewire (deletions + import retargeting + provider wrap), the test-helper consolidation, the obsolete-block deletion, and runs the full verification cycle before committing.

- **AuthProvider + useAuth() triad (provider-based) vs the moderator's current provider-less hook.** Alternatives:
  - *Provider-less: ship `useAuth()` as-is, every consumer fires its own `/auth/me` fetch.* Rejected — the consolidation IS the value-add. The provider-less shape is documented as a future-seam in [`useAuth.ts`](../../../apps/moderator/src/auth/useAuth.ts) lines 13–22 (the Zustand-swap that never came); the shell formalizes the seam as a real provider.
  - *Zustand-store backed, no React context.* Rejected — context is the React-native idiom for "shared subtree-scoped value" and the moderator's existing `useWsClient` pattern ([`WsClientProvider.tsx`](../../../apps/moderator/src/ws/WsClientProvider.tsx) lines 92–98) already uses the throw-outside-provider pattern. Symmetry with the existing pattern wins; both auth and WS use providers, both throw outside.
  - *Chosen:* React context + provider + consumer hook. The provider owns the `useState` + `useEffect` lifecycle the moderator's hook owns today; `useAuth()` is the context consumer.

- **Provider order in `main.tsx`: i18n outermost, then auth, then BrowserRouter.** Alternatives:
  - *Auth outermost.* Considered — auth doesn't need i18n at construction time (the bootstrap fetch is non-localized JSON). But auth's `error` slot carries server-error envelope messages the renderer wants to localize, and `RequireAuth`'s loading-frame DOM (`<p data-testid="auth-checking">{t('auth.login.checking')}</p>`) renders inside the auth provider's subtree and demands `useTranslation()` resolve. i18n outermost is the safer ordering.
  - *BrowserRouter outermost.* Rejected — the providers wrap App, not the Router (routing decisions happen inside App, providers supply ambient services).
  - *Chosen:* `<I18nProvider><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></I18nProvider>`. WS provider stays per-route (Operate + InviteParticipants) per the explicit moderator rationale at [`Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) lines 38–46.

- **WS provider per-route (status quo) vs a top-level `<WsProvider>` wrap in `main.tsx`.** Alternatives:
  - *Top-level wrap.* Rejected — the moderator's existing design explicitly scopes WS to the routes that need it ([`Operate.tsx`](../../../apps/moderator/src/routes/Operate.tsx) lines 38–46). Hoisting it would open a WS connection on `/login` + `/screen-name` + `/sessions/new` + `/sessions/:id/lobby` where no WS-driven UI exists, wasting a socket per session.
  - *Chosen:* per-route mount stays. The shell ships `WsClientProvider` + `useWsClient` for any consumer that wants the moderator's existing pattern; consumers (moderator, future participant) decide their own mount scope.

- **WsStore extraction shape — keep the store in the shell vs leave it in the moderator vs move the helpers too.** The complication: [`apps/moderator/src/ws/wsStore.ts`](../../../apps/moderator/src/ws/wsStore.ts) imports `diagnosticIdentityKey` from `../graph/diagnosticHighlights.js` (a moderator-side projection helper) and `withDevtools` from `../stores/devtools.js` (a moderator-side devtools wrapper). The store can't move while it imports moderator-internal helpers — that inverts the dependency direction (shell would depend on moderator). Three resolution paths:
  - *A. Move the store AND the two helpers (`diagnosticIdentityKey`, `withDevtools`) into the shell.* Rejected for `diagnosticIdentityKey` — the helper is moderator-graph-specific (it encodes the moderator's diagnostic-rendering identity rule) and pulling it into the shell would force every future surface to carry the moderator's graph projection logic. Rejected for `withDevtools` — it's a thin Zustand devtools wrapper, but the wrapper currently encodes the moderator's "moderator/ws" devtools-store-name convention.
  - *B. Move the store into the shell with the moderator-side helper imports **inverted via a parameter**.* The shell's `useWsStore` accepts a `createWsStore({ diagnosticIdentityKey?, devtoolsWrapper? })` factory at provider construction time. The moderator's bootstrap supplies its own helpers; future surfaces supply theirs (or pass undefined for a vanilla store). Workable, but heavier than option C and leaks moderator-shaped extension points into the shell API.
  - *C. Leave `wsStore.ts` in the moderator** and have the shell's `WsClientProvider` accept a `store: StoreLike` prop (the moderator passes its existing `useWsStore`). The shell's `client.ts` becomes parameterized over the store (replacing the direct `useWsStore.getState()` calls at lines 186–217, 268, 365–366 with calls through an injected store handle). Decouples the client from the moderator's store shape; future surfaces (participant, audience) can supply their own slice with their own projection rules.
  - *Chosen:* **Option C, with a default**. The shell's `client.ts` is refactored to take an injected `StoreLike` interface (the methods `client.ts` uses: `setConnectionStatus`, `setConnectionId`, `trackSubscription`, `untrackSubscription`, `applyEvent`, `applySnapshot`, `applyProposalStatus`, `applyDiagnostic`, `recordError`). The shell ships a **default minimal store** (`createDefaultWsStore()`) the audience + replay-test + root + tests can use without re-implementing; the moderator continues to use its own `useWsStore` (kept in `apps/moderator/src/ws/wsStore.ts`) which now imports its base types from `@a-conversa/shell` and adds the moderator-specific `activeDiagnostics` + `diagnosticIdentityKey` projection on top. The moderator's `wsStore.test.ts` stays in the moderator. The shell's default store gets its own small test in `packages/shell/src/ws/`. This is the cleanest dependency-direction-preserving choice; the alternative B's parameter-injection-at-construction is less ergonomic for the common case.

- **Scoped error mappers (`mapScreenNameError`, `mapCreateSessionError`, `mapGenericApiError`) vs one mega-table mapper.** Alternatives:
  - *One mapper `errorCodeToI18nKey(domain, code, status)` with a per-domain switch inside.* Rejected — adding a new domain (`createProposal`, future participant flows, audience errors) means editing the shell's central table for every consumer. The scoped pattern lets each domain ship its own mapper without coordinating with the others.
  - *Chosen:* three scoped functions plus the `mapGenericApiError` composition helper. The two existing call sites (`ScreenName.tsx`, `CreateSession.tsx`) get a one-line import each; future domains add their own scoped mapper without touching the existing ones.

- **Test helper `renderWithProviders` vs inline provider wraps in every test.** Alternatives:
  - *Inline wraps.* Rejected — 44 `it()` cases in `App.test.tsx` + 13 in `RequireAuth.test.tsx` is 57 sites that would each grow a 3-deep provider stack. Maintenance cost: every future provider added to the moderator (Zustand store provider, future-tier providers) means touching 57 sites.
  - *A single global `<TestApp>` wrapper that takes children + path.* Considered — would also work, but the convention in Testing-Library-land is the `renderWithProviders(ui, options)` shape (the `wrapper` option on `@testing-library/react`'s `render`). Easier for new contributors to recognize.
  - *Chosen:* `apps/moderator/src/testing/renderWithProviders.tsx` — a thin function `renderWithProviders(ui, { initialEntries })` that wraps `ui` in `<I18nProvider i18n={testInstance}><AuthProvider><MemoryRouter initialEntries={...}>{ui}</MemoryRouter></AuthProvider></I18nProvider>`. The helper bootstraps the test-scope i18n instance once (in a module-level `beforeAll`) and reuses it across cases. Both `App.test.tsx` and `RequireAuth.test.tsx` consume the helper. Future test files (e.g., when the moderator adds more provider-consuming components) consume it too.

- **Delete the obsolete `describe('no-profile-data audit on the moderator client', ...)` block in `App.test.tsx` vs retarget it at `@a-conversa/shell`'s source.** Alternatives:
  - *Retarget the moderator's audit at the shell's source files.* Rejected — would mean the moderator's test suite reaches into `node_modules/@a-conversa/shell/src/` (or worse, into `../../packages/shell/src/` via a path traversal). The audit belongs with the code it audits.
  - *Chosen:* delete the moderator's block; land an equivalent block at `packages/shell/src/auth/auth.test.ts` that grep-asserts the shell's source files (`AuthProvider.tsx`, `useAuth.ts`, `types.ts`). The invariant moves with the code.

- **`peerDependencies` widening (not `dependencies`).** Alternatives:
  - *Add `i18next` + `react-i18next` + `zustand` to `dependencies` so the shell bundles its own copies.* Rejected — the shell is a library; its consumers (moderator, root, future surfaces) already pin those packages, and dual-bundling would mean two i18next instances at runtime (the shell's + the consumer's), each with its own resource state. i18next's resource registration is global per instance; two instances means localized strings in one wouldn't resolve in the other.
  - *Chosen:* peer-deps. The shell declares the contract ("I work with i18next^26.1.0 and react-i18next^17.0.7"); the consumer satisfies it. Same pattern as React's existing peer-dep entry on [`packages/shell/package.json`](../../../packages/shell/package.json) lines 19–22.

- **`createI18nInstance` vs preserving the moderator's `initI18n` name.** Alternatives:
  - *Keep the name `initI18n`.* Mild advantage: zero churn across the 23 importer files. Disadvantage: the name suggests side-effect-only initialization, even though the function always returned the instance (the moderator just didn't use the return value for anything).
  - *Rename to `createI18nInstance`, no compat alias.* The 23 importer files all change in this commit; mass-update is mechanical.
  - *Rename, ship a deprecated `initI18n` alias for one commit.* Adds noise to the shell's public surface.
  - *Chosen:* rename, no alias. The 23 importer files all update in this commit; the moderator's [`apps/moderator/src/i18n.ts`](../../../apps/moderator/src/i18n.ts) is deleted, so the old `initI18n` symbol is gone — every import had to change anyway to swap the path from `./i18n` to `@a-conversa/shell`. Renaming the function at the same time costs nothing extra.

- **Mount-contract module re-exports the canonical types from the new subsystem modules.** Alternatives:
  - *Mount-contract module keeps its placeholder declarations; subsystem modules ship their own widened types separately.* Rejected — two declarations of `AuthContextValue` is a drift hazard. The subsystem widens, the mount-contract module re-exports the widened type, the placeholder declaration disappears (the JSDoc that documented the "this is a placeholder; real impl in shell_auth_context" goes too).
  - *Chosen:* the mount-contract module's `types.ts` re-exports `AuthContextValue` from `../auth/`, `I18n` from `../i18n/`, `WebSocketClient` from `../ws/`. Single source of truth per type. The `SurfaceMeta` declaration stays where it is (no subsystem widens it; the metadata shape is mount-contract-internal).

- **Shell's default minimal WS store ships alongside the client.** Alternative: ship the client without a default store and force every consumer to bring their own. Rejected — the future participant/audience/replay-test/root surfaces will want a baseline store; making them re-derive it from scratch would mean the moderator's store-shape conventions get re-discovered four times. The shell's `createDefaultWsStore()` ships the union of the methods the client uses, with no projection-specific extensions. Consumers that want richer projections (the moderator's `activeDiagnostics` map, future participant-specific projections) ship their own store and pass it to `WsClientProvider`.

## Open questions

- **Should the moderator's `wsStore.ts` extend a shell-supplied base store type?** The Decisions §"WsStore extraction shape" chose to keep `wsStore.ts` in the moderator with the shell parameterized over a `StoreLike` interface. The moderator's store could either (a) re-declare the methods the shell needs, or (b) extend a `BaseWsStore` interface the shell ships. Path (b) is more maintainable (single source of truth for the surface the client consumes) but creates a typed coupling between the moderator's store shape and the shell's expectations. **Recommendation: ship path (b).** The base interface lives in `packages/shell/src/ws/store-contract.ts`; the moderator's `useWsStore` declares `StoreState extends BaseWsStoreState` and adds `activeDiagnostics`. This is a minor implementation choice the Implementer can settle without revisiting the refinement; flagging it here so the Implementer is aware.

## Status

**Done** — 2026-05-16.

- Extracted shared substrate modules into `packages/shell/src/` (auth, screen-name, login/logout, i18n, ws, error-mapper) and wired package exports through `packages/shell/src/index.ts`.
- Rewired moderator imports from local substrate files to `@a-conversa/shell`, including auth + route consumers in `apps/moderator/src/routes/` and WS/auth surfaces in `apps/moderator/src/ws/`.
- Updated provider composition at moderator bootstrap to consume shell-owned providers and keep route-level behavior intact in `apps/moderator/src/main.tsx`.
- Removed or replaced moderator-local substrate implementations/tests that moved to shell ownership, including prior local auth/ws helper surfaces under `apps/moderator/src/auth/` and related test fixtures.
- Updated workspace/package integration to support the extracted shell surface (package metadata + lockfile updates in `packages/shell/package.json` and `pnpm-lock.yaml`).
- Preserved and verified propose-side e2e behavior contract by accepting the two valid server-side typed rejections (`target-entity-not-found` and `sequence-mismatch`) in `tests/e2e/moderator-capture.spec.ts`.
