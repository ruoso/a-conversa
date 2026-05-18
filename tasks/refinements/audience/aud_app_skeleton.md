# Audience surface as a mountable library (entry, build, mount() export)

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_shell.aud_app_skeleton`
**Effort estimate**: 1d
**Inherited dependencies**:

- `shell_package.shell_mount_contract` (settled — `MountProps`, `UnmountFn`, `MountFn`, and `SurfaceModule` already exist in `@a-conversa/shell`; see [`packages/shell/src/mount-contract/types.ts:85-114`](../../../packages/shell/src/mount-contract/types.ts#L85-L114) and the refinement at [`tasks/refinements/shell-package/shell_mount_contract.md`](../shell-package/shell_mount_contract.md)).
- `frontend_i18n.i18n_locale_negotiation` (settled — `negotiateUrlLocale(pathname)` + `negotiateAuthenticatedLocale()` live in [`packages/i18n-catalogs/src/negotiation.ts`](../../../packages/i18n-catalogs/src/negotiation.ts#L321-L354); the refinement at [`tasks/refinements/frontend-i18n/i18n_locale_negotiation.md`](../frontend-i18n/i18n_locale_negotiation.md) names this skeleton as the consumer that lands the audience URL-prefix locale read).
- `shell_package.shell_substrate_extraction` (settled — `AuthValueProvider`/`AuthValueProvider`, `useAuth`, `createI18nInstance`, `I18nProvider`, the WS client surface, and the chrome components all live in `@a-conversa/shell`; this task consumes them but does not extend them).
- `root_app.root_pkg_skeleton` (settled — the `apps/root/` workspace exists, ships a `BrowserRouter` + `AuthProvider` + `I18nProvider` shell with a `SurfaceHost` dispatcher; this task adds an `/a/*` route to that dispatcher).
- `root_app.root_moderator_cutover` (settled — the moderator already runs through the root host as a mountable library; `part_app_skeleton` mirrored that pattern for the participant surface and this task mirrors it again for the audience).
- `backend.api_skeleton.serve_static_frontends_multi_surface` (settled — the plugin already serves `/_surfaces/manifest.json` + per-surface bundles; this task adds the audience surface entry to `resolveDefaultSurfaces` mirroring the participant entry's shape).

## What this task is

Convert the placeholder audience workspace at [`apps/audience/`](../../../apps/audience/) into a **library-mode Vite bundle** that exports the [`@a-conversa/shell`](../../../packages/shell/src/index.ts) `mount(props): UnmountFn` contract, register the bundle with the backend static-frontends plugin so it is reachable through `/_surfaces/manifest.json`, and wire an `/a/*` route in [`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx) so the root host dispatches into the audience surface when a producer points OBS (or a human visitor) at an audience session URL.

The deliverable is the **bootstrap workspace**, not the audience's real graph viewer. Concretely:

- A library-mode `apps/audience/vite.config.ts` that emits `audience-<hash>.js` (+ an `assets/audience-<hash>.css` sidecar) under `apps/audience/dist/`, matching the participant + moderator library-mode shape (see [`apps/participant/vite.config.ts`](../../../apps/participant/vite.config.ts) and [`apps/moderator/vite.config.ts:34-59`](../../../apps/moderator/vite.config.ts#L34-L59)).
- An entrypoint at `apps/audience/src/main.tsx` that exports `mount: MountFn` plus a default `SurfaceModule` (mirroring [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx)).
- A small `<App />` component at `apps/audience/src/App.tsx` that mounts a `<BrowserRouter basename={props.routerBasePath}>` with one wildcard route that renders a `data-testid="route-audience-placeholder"` "Audience surface loading…" panel — enough to confirm the bundle reaches the DOM through the root host.
- A backend update: one entry in [`resolveDefaultSurfaces`](../../../apps/server/src/routes/static-frontends.ts#L264-L295) for the audience surface (matching the participant entry's shape), one Dockerfile `COPY --from=build /app/apps/audience/dist ./apps/audience/dist`, one Vitest regression pin in [`apps/server/src/routes/static-frontends.test.ts`](../../../apps/server/src/routes/static-frontends.test.ts) asserting `/_surfaces/manifest.json` lists an `audience` entry with hash-busted URLs.
- A root host update: one `<Route path="/a/*" element={<SurfaceHost surfaceId="audience" routerBasePath="/a" />} />` line in [`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx#L237) above the `*` catch-all.
- Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): a Vitest mount-boundary case at `apps/audience/src/mount.test.tsx` (mirroring [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx)), and **one Playwright spec** that authenticates a user, navigates to `/a/sessions/<uuid>`, and asserts the placeholder testid renders.

Out of scope (deferred to existing sibling leaves under `aud_shell` and downstream `aud_*` groups):

- The read-only WS subscription wiring — owned by `aud_ws_client` (the next sibling, `0.5d`, depends `!aud_app_skeleton`).
- The Zustand-backed live event-stream state — owned by `aud_state_management`.
- The unauthenticated public-session viewer path (`SurfaceHost` widening so audience can mount without `auth.status === 'authenticated'`, plus the `GET /sessions/:id/meta` probe) — owned by `aud_no_auth_for_public` (0.5d, depends `!aud_app_skeleton`). See [`tasks/refinements/audience/aud_no_auth_for_public.md`](aud_no_auth_for_public.md).
- The private-session auth gate against the shell's `useAuth()` — owned by `aud_auth_for_private` (0.5d, depends `!aud_no_auth_for_public`).
- Cytoscape initialization, per-state styling, animations, axiom-mark decoration, annotations, segment markers, OBS sizing, layout tuning — owned by the dedicated subgroups (`aud_graph_rendering.*`, `aud_animations.*`, `aud_obs_integration.*`, `aud_segment_markers.*`).
- The URL-position query parameter for replay deep-linking — owned by `aud_url_routing.aud_url_position_param`.
- Cucumber audience-stream behaviour scenarios — see "Cucumber surface" in Constraints below; the audience subscribe-only wire path is owned by `aud_ws_client` once the read-only subscription lands and is observable end-to-end.

## Why it needs to be done

`m_audience_mvp` (M6, [`tasks/99-milestones.tji`](../../99-milestones.tji)) — the milestone at which a producer can point OBS at an audience URL and see the live debate graph — has every leaf under `audience.*` as a direct or transitive dependency, and **every audience leaf inherits** the `audience` task's `depends backend.backend_tests.be_e2e_tests.auth_flow_integration` line (see [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji)). This skeleton is the unblocker for the rest of the `aud_shell` group (`aud_ws_client`, `aud_state_management`, `aud_no_auth_for_public`, `aud_auth_for_private`) and transitively for the four downstream subgroups (`aud_graph_rendering`, `aud_animations`, `aud_obs_integration`, `aud_segment_markers`, `aud_url_routing`, `aud_tests`). Without a library-mode bundle exporting `mount()`, none of those siblings have a workspace to land in.

Today the root host's route table at [`apps/root/src/App.tsx:229-238`](../../../apps/root/src/App.tsx#L229-L238) has `/m/*` (moderator) and `/p/*` (participant) routes but no `/a/*` handler. Any audience URL therefore falls through to the root host's `*` catch-all and redirects to `/`. After this task lands, the same `/a/sessions/:id` URL hits the new `/a/*` route, the `SurfaceHost` dispatcher checks auth (and bounces to `/login` with a remembered return-to if unauthenticated, until `aud_no_auth_for_public` widens that gate), then mounts the audience bundle inside the basename-scoped router. The audience surface's wildcard route renders the placeholder. The real graph viewer lands later in the `aud_graph_rendering.*` group.

Architecturally, this is the **third** concrete validation of the ADR 0026 micro-frontend contract (after the moderator cutover and the participant skeleton). A third surface that consumes `@a-conversa/shell`'s mount contract and registers with the static-frontends plugin proves the architecture generalises — every remaining `apps/*` workspace (only `apps/replay-test/` is left) now has a precedent it can copy.

## Inputs / context

### ADRs

- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md#L37) — the micro-frontend pivot. Decision 1 fixes the URL prefix table (`/a/*` → audience). Decision 2 fixes the surface build output (Vite library mode + `mount(props): UnmountFn` export + `SurfaceModule` default). Decision 3 fixes that surfaces own their own React DOM root and `<BrowserRouter basename={routerBasePath}>`. Decision 4 fixes the backend serving the surface bundle under `/_surfaces/{surface}/...` via the manifest.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md#L31) — every empirical verification of the new behaviour is a committed test; the Vitest mount probe + the manifest regression pin + the Playwright placeholder spec ARE the regression pins.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the audience bundle does NOT bootstrap its own i18next instance; the root host owns the `I18nProvider` and passes the live `i18n` value through `MountProps.i18n`. The audience's URL-prefix locale rule (per `i18n_locale_negotiation`) is implemented inside the audience surface's basename-scoped routes by reading `negotiateUrlLocale(pathname)` against `window.location.pathname` and re-configuring the shared i18n via `i18n.changeLanguage(...)` — see "Locale negotiation" in Constraints below.
- [ADR 0005](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — Tailwind v4 + `@tailwindcss/vite` is the project standard; the audience surface inherits the same Tailwind reset every other surface uses.
- [ADR 0010](../../../docs/adr/0010-directory-layout-pnpm-workspaces.md) — `apps/audience/` is already a pnpm-workspaces member (the stub workspace already exists; see [`apps/audience/package.json`](../../../apps/audience/package.json) and the Dockerfile's existing copy of `apps/audience/package.json` in both deps and runtime stages).

### Participant surface — the canonical precedent to mirror

The participant workspace is the surface that most recently implemented the contract; the audience skeleton mirrors it line-for-line where possible because the participant is the closest analogue (read-mostly surface, no own state-management yet at the skeleton tier):

- [`apps/participant/package.json`](../../../apps/participant/package.json) — pins `@a-conversa/shell`, `@a-conversa/i18n-catalogs`, `@a-conversa/shared-types`, plus the React/i18next/react-router-dom runtime trio. Four scripts: `dev`/`build`/`preview`/`typecheck`. Type `module`, version `0.0.0`, `private: true`. The audience `package.json` adopts the same shape minus the participant-specific deps (`@a-conversa/moderator`, `cytoscape`, `zustand` — none needed for the skeleton; `cytoscape` lands later with `aud_cytoscape_init`).
- [`apps/participant/vite.config.ts`](../../../apps/participant/vite.config.ts) — defines the library-mode build. Two load-bearing knobs: `lib.entry = 'src/main.tsx'` + `lib.formats = ['es']` (ESM only, per ADR 0026 Decision 2), and `rollupOptions.output.entryFileNames = 'participant-[hash].js'` + `assetFileNames` branching `style.css → 'participant-[hash].css'` else `'assets/[name]-[hash][extname]'`. `inlineDynamicImports: true` keeps the bundle a single ESM module (the root host dynamic-imports a single URL). `cssCodeSplit: false` ensures one CSS sidecar. `define: { 'process.env.NODE_ENV': JSON.stringify('production') }` because some peer-dep CJS modules (e.g. `react-dom`) read it. The audience config swaps `participant-` for `audience-` throughout.
- [`apps/participant/src/main.tsx`](../../../apps/participant/src/main.tsx) — the mount export. Imports `AuthValueProvider`, `I18nProvider`, `MountFn`, `SurfaceModule` from `@a-conversa/shell`. Builds the React tree: `<React.StrictMode><I18nProvider i18n={props.i18n}><AuthValueProvider value={props.auth}><BrowserRouter basename={props.routerBasePath}><App /></BrowserRouter></AuthValueProvider></I18nProvider></React.StrictMode>`. Returns `() => { root.unmount(); }`. The default export is a `SurfaceModule` with `mount` + `meta: { displayName: 'Participant', requiredAuthLevel: 'authenticated' }`. The audience equivalent renames to `Audience` and uses `requiredAuthLevel: 'public'` — see Decision §5 below for why the meta hint differs even though `SurfaceHost` does not yet read it.
- [`apps/participant/src/App.tsx`](../../../apps/participant/src/App.tsx) — the route tree under the basename. The skeleton landed with a single wildcard route (Decision §2 of `part_app_skeleton`); subsequent leaves (`part_invite_acceptance`, `part_lobby_view`, `part_graph_render`) added specific routes above the wildcard. The audience equivalent starts with a single wildcard route returning the placeholder; `aud_graph_rendering.*` will replace the wildcard with the real `<AudienceViewRoute>` later.
- [`apps/participant/src/index.css`](../../../apps/participant/src/index.css) — `@import 'tailwindcss';` plus the `html, body, #root { height: 100%; margin: 0; }` reset. Audience inherits the same.
- [`apps/participant/src/mount.test.tsx`](../../../apps/participant/src/mount.test.tsx) — the Vitest mount-boundary case. Constructs a minimum-viable `MountProps` (real `document.createElement('div')`, a real `i18n` via `createI18nInstance('en-US')`, a fake authenticated `auth`), pushes `window.history.replaceState(..., '/a/sessions/<uuid>')`, calls `mount(props)`, asserts the audience placeholder testid renders, then calls `unmount()` and asserts `container.innerHTML === ''`. The audience case is narrower than the participant's three-case file: the audience skeleton has no defensive `auth.user === undefined` branch, no chrome regions to assert, no per-test WS store to seed. One case (the authenticated mount) is enough at this tier — the no-auth public path is `aud_no_auth_for_public`'s test surface, not this skeleton's.
- [`apps/participant/tsconfig.json`](../../../apps/participant/tsconfig.json) — extends `tsconfig.base.json`, sets `module: ESNext` + `moduleResolution: Bundler` + `jsx: react-jsx`, declares project references to `packages/shared-types`, `packages/i18n-catalogs`, `packages/shell`. The audience `tsconfig.json` already declares the first two; this task adds the shell reference and `"types": ["vite/client"]` plus `rootDir: src` so the new test file under `src/` is included.

### Moderator surface — the second precedent

The moderator workspace is the original ADR-0026 cutover; it predates the participant skeleton by several days. Some patterns the moderator carries — the WS-store window-exposure trick at [`apps/moderator/src/main.tsx:35-55`](../../../apps/moderator/src/main.tsx#L35-L55), the per-route Zustand store wiring — are NOT replicated in the audience skeleton because the audience has no Zustand store yet (state-management lands in `aud_state_management`). The moderator's `vite.config.ts` is otherwise identical to the participant's after the surface-name swap.

### Root host — the dispatcher this task wires into

- [`apps/root/src/App.tsx:227-239`](../../../apps/root/src/App.tsx#L227-L239) — the `Routes` table. The moderator route is `<Route path="/m/*" element={<SurfaceHost surfaceId="moderator" routerBasePath="/m" />} />`; the participant route is the same shape under `/p/*`. The audience route lands immediately below the participant route: `<Route path="/a/*" element={<SurfaceHost surfaceId="audience" routerBasePath="/a" />} />`. Order matters only that all three sit above the `*` catch-all (line 237).
- [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) — already generic over `surfaceId` and `routerBasePath`. **One important nuance**: today's host hard-gates on `auth.status === 'authenticated'` (lines 56-58 + 122-130), bouncing unauthenticated visitors to `/login`. The audience surface needs public access for public sessions; that gate widening is `aud_no_auth_for_public`'s job, not this task's. For the skeleton, the audience surface inherits the moderator/participant behaviour: an authenticated user can reach `/a/sessions/<uuid>` and see the placeholder; an unauthenticated user is redirected to `/login`. That's fine for the skeleton — the placeholder spec authenticates first; the public-session path is fully addressed in the sibling task.
- [`apps/root/src/surfaces/manifest.ts`](../../../apps/root/src/surfaces/manifest.ts) — fetches `/_surfaces/manifest.json` and dynamic-`import()`s the advertised module URL. No code change needed; the audience surface populates the manifest server-side.

### Backend — the static-frontends plugin this task extends

- [`apps/server/src/routes/static-frontends.ts:264-295`](../../../apps/server/src/routes/static-frontends.ts#L264-L295) — `resolveDefaultSurfaces` returns the wired surface list. Today: two entries (`moderator` + `participant`). After this task: three entries, with the audience entry following the participant's shape: `surfaceId: 'audience'`, `urlPrefix: '/_surfaces/audience/'`, `distDir: resolveAudienceDistDir(env)`, `moduleFilePattern: /^audience-[A-Za-z0-9_-]+\.js$/`, `styleFilePatterns: [/^assets\/audience-[A-Za-z0-9_-]+\.css$/]`, `label: 'audience'`.
- [`apps/server/src/routes/static-frontends.ts:190-192`](../../../apps/server/src/routes/static-frontends.ts#L190-L192) — env-override constants. This task adds `AUDIENCE_DIST_DIR_ENV = 'AUDIENCE_DIST_DIR'` alongside the existing `ROOT_DIST_DIR_ENV`, `MODERATOR_DIST_DIR_ENV`, and `PARTICIPANT_DIST_DIR_ENV`, plus a `resolveAudienceDistDir` helper sharing the existing `resolveWorkspaceDistDir(envKey, appName)` logic at [`apps/server/src/routes/static-frontends.ts:221-231`](../../../apps/server/src/routes/static-frontends.ts#L221-L231).
- [`apps/server/src/routes/static-frontends.test.ts`](../../../apps/server/src/routes/static-frontends.test.ts) — current Vitest suite. This task adds one regression pin: `GET /_surfaces/manifest.json` returns a body whose `surfaces` map contains an `audience` entry with a hash-busted `moduleUrl` and (optional) `styleUrls`. Same fixture-tree shape (`mkdtempSync` + a fake audience dist) the existing participant pin uses.
- [`Dockerfile`](../../../Dockerfile) — already has `COPY --from=build /app/apps/root/dist`, `COPY --from=build /app/apps/moderator/dist`, and `COPY --from=build /app/apps/participant/dist` at lines 168-170. This task adds `COPY --from=build /app/apps/audience/dist ./apps/audience/dist` (the runtime stage; the build stage already runs `pnpm -r build` which picks up the audience workspace). The Dockerfile already copies `apps/audience/package.json` in both the deps stage (line 51) and the runtime stage (line 126), so no further manifest plumbing is needed.

### Locale negotiation — the audience-specific URL-prefix rule

- [`packages/i18n-catalogs/src/negotiation.ts:321-354`](../../../packages/i18n-catalogs/src/negotiation.ts#L321-L354) — `negotiateUrlLocale(pathname?)` parses the leading URL segment and returns `{ locale, residualPath }`. The audience surface is the **first** consumer of this helper; the helper has shipped since `frontend_i18n.i18n_locale_negotiation` landed (2026-05-11) but no caller existed yet. Per [`i18n_locale_negotiation.md`](../frontend-i18n/i18n_locale_negotiation.md) lines 27 + 67-68, the audience surface uses the URL-prefix path (not the cookie/navigator chain the authenticated surfaces use) because the surface may render inside an OBS browser source that doesn't represent a human user.
- **Important interaction with ADR 0026's `/a/*` prefix**: the URL grammar the producer types into OBS is `/a/{locale}/sessions/{id}` (per the `.tji` note on this task). The root's outer `<Route path="/a/*">` strips the `/a` segment when matching; the audience surface receives the residual path inside its basename-scoped router. So the audience surface's own `<Routes>` sees the URL as `/{locale}/sessions/{id}`, and `negotiateUrlLocale(window.location.pathname)` after the basename strip parses the `{locale}` segment correctly.

  The shell's `<I18nProvider>` passes the host-supplied i18n instance into the surface; the audience surface calls `i18n.changeLanguage(negotiatedLocale)` inside a `useEffect` that runs once on mount (and re-runs if the pathname changes locale segment). This re-configures the shared i18n instance — which is a deliberate side effect: the audience surface OWNS the locale for the duration of its mount (per the i18n negotiation refinement, the audience locale is producer-controlled, not user-controlled).
- For the **skeleton**, the locale read is a thin call: `const { locale } = negotiateUrlLocale(window.location.pathname);` at the top of `<App />`, followed by `useEffect(() => { void i18n.changeLanguage(locale); }, [i18n, locale]);`. The placeholder text the route renders uses the canonical `t('audience.placeholder.title')` + `t('audience.placeholder.body')` keys, which resolve under whatever locale the changeLanguage call settled.

### Existing stub at `apps/audience/`

- [`apps/audience/package.json`](../../../apps/audience/package.json) — package name `@a-conversa/audience` (the convention this task preserves). Today's `build` script is `echo 'no build yet (placeholder; bundler wiring lands with frontend tasks)'` — this task replaces it with `tsc -b && vite build`. Today's `dependencies` list (`@a-conversa/i18n-catalogs`, `i18next`, `i18next-icu`, `react-i18next`) is incomplete for the new shape; this task widens it.
- [`apps/audience/src/index.tsx`](../../../apps/audience/src/index.tsx) — current contents: `export {};`. Deleted by this task; replaced by `apps/audience/src/main.tsx` (the mount entrypoint) + `apps/audience/src/App.tsx` (the placeholder route tree) + `apps/audience/src/index.css` (Tailwind import + reset).
- [`apps/audience/src/i18n.ts`](../../../apps/audience/src/i18n.ts) — current contents: a standalone `initI18n(locale)` that bootstraps an audience-owned i18next instance. **Deleted by this task** — per ADR 0026 the i18n instance is host-supplied via `MountProps.i18n`, so the surface no longer bootstraps its own. This deletion matches the precedent from [`apps/participant/src/i18n.ts`'s deletion](../participant-ui/part_app_skeleton.md#L90).
- [`apps/audience/tsconfig.json`](../../../apps/audience/tsconfig.json) — already extends `tsconfig.base.json`; this task adds `{ "path": "../../packages/shell" }` to `references` and adds `"types": ["vite/client"]` to `compilerOptions` (mirroring the participant tsconfig).
- [`apps/audience/README.md`](../../../apps/audience/README.md) — the stub's one-line description ("Scaffolded by `foundation.repo_skeleton.dir_layout`; real code lands with subsequent tasks"). This task can lightly amend the README to point at this refinement, but the README is not load-bearing for the skeleton — keep the touch minimal (one sentence saying the workspace now builds as a library bundle).

### Shell substrate the audience consumes

- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — the public barrel. The audience skeleton imports `AuthValueProvider`, `I18nProvider`, `MountFn`, `SurfaceModule`, and `I18nInstance` (as a cast target for the i18n bridge), matching the participant's exact import set.
- [`packages/shell/src/mount-contract/types.ts:85-114`](../../../packages/shell/src/mount-contract/types.ts#L85-L114) — `MountProps` (the host-supplied dependency bag: `container`, `auth`, `i18n`, `routerBasePath`, optional `ws` + `locale`); `UnmountFn = () => void`; `MountFn = (props: MountProps) => UnmountFn`; `SurfaceModule = { mount: MountFn; meta?: SurfaceMeta }`; `SurfaceMeta = { displayName?: string; requiredAuthLevel?: 'public' | 'authenticated' }`.
- [`packages/shell/package.json`](../../../packages/shell/package.json) — React, react-dom, react-router-dom, react-i18next, i18next are `peerDependencies` of the shell; the audience workspace declares them as its own runtime `dependencies` (the same shape the participant + moderator both use).

### Existing Playwright fixtures the spec relies on

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — provides the `authenticated` fixture that logs a Playwright `page` in via the OAuth handshake (or the screen-name-form workaround for new users) before the spec runs. The audience placeholder spec uses this directly — it does NOT need to also exercise the public-session no-auth flow; it only needs an authenticated user to satisfy the `SurfaceHost`'s `auth.status === 'authenticated'` precondition. The public-session unauthenticated path is `aud_no_auth_for_public`'s test surface (its own Playwright scenarios pair authenticated + unauthenticated visits to a public session metadata fixture, per [`aud_no_auth_for_public.md`](aud_no_auth_for_public.md) lines 20-23).
- [`playwright.config.ts:285-308`](../../../playwright.config.ts#L285-L308) — the participant-skeleton project (`chromium-participant-skeleton`) is the template. The audience equivalent (`chromium-audience-skeleton`) adopts the same shape: `dependencies: ['setup-auth']`, single locale en-US, `ignoreHTTPSErrors: true` (kept for parity even though the bootstrap auth jar short-circuits the OIDC redirect), `storageState: AUTH_STORAGE_STATE_PATH`, `testMatch: /audience-skeleton-smoke\.spec\.ts$/`.

## Constraints / requirements

### Workspace + build

- **Workspace location**: `apps/audience/` (already exists; this task replaces its contents). Package name `@a-conversa/audience`. Version `0.0.0`, `private: true`, `type: "module"`.
- **Build mode**: Vite library mode (`build.lib`) — ESM only (`formats: ['es']`). Bundle is a single file via `rollupOptions.output.inlineDynamicImports: true`. Single CSS sidecar via `cssCodeSplit: false`.
- **Output filenames**: `dist/audience-<hash>.js` (the entry bundle) + `dist/assets/audience-<hash>.css` (the style sidecar). Matches the participant + moderator pattern; the backend's `moduleFilePattern` / `styleFilePatterns` regexes in `resolveDefaultSurfaces` match these names.
- **Scripts** (`package.json`): `dev: vite`, `build: tsc -b && vite build`, `preview: vite preview`, `typecheck: tsc -b`.
- **No `index.html`** in `apps/audience/`. The surface is a library bundle, not an SPA; the root host renders the only `index.html` in the deploy.
- **No `apps/audience/src/main.tsx` `createRoot()` at module-load time.** All DOM bootstrapping happens inside `mount(props)` against `props.container`; the surface only acts when the host invokes it.

### Dependencies

- **Runtime `dependencies`**: `@a-conversa/shell` (workspace:*), `@a-conversa/i18n-catalogs` (workspace:*), `@a-conversa/shared-types` (workspace:^), `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@7.15.0`, `react-i18next@17.0.7`, `i18next@26.1.0`, `i18next-icu@2.4.3`. All version-pinned matching the participant workspace ([`apps/participant/package.json`](../../../apps/participant/package.json)) — no new runtime dep is introduced beyond what the participant already pulls in.
- **`devDependencies`**: `vite@8.0.13`, `@vitejs/plugin-react@6.0.1`, `tailwindcss@4.3.0`, `@tailwindcss/vite@4.3.0`. Same shape as the participant workspace.
- **Removed dependencies** vs. the current stub: none — the stub's `i18next` / `i18next-icu` / `react-i18next` / `@a-conversa/i18n-catalogs` all stay (they are runtime peer-requirements of `@a-conversa/shell`'s React components, so the surface workspace's `node_modules` needs them resolvable at build time).
- **NOT added**: `cytoscape` (lands with `aud_cytoscape_init`), `zustand` (lands with `aud_state_management`), `@a-conversa/moderator` (the participant's awkward dep that `shell_pkg.extract_facet_pill` exists to remove — audience starts clean, no `<FacetPill>` import; the FacetPill arrives with `aud_proposed_styling` / `aud_per_facet_visualization`, at which point the consuming task makes the decision on whether to import from moderator or wait for `extract_facet_pill` — this skeleton does NOT force that decision).

### Entrypoint shape (`apps/audience/src/main.tsx`)

The `mount` export MUST conform to `MountFn` from `@a-conversa/shell`. The implementation:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  AuthValueProvider,
  I18nProvider,
  type I18nInstance,
  type MountFn,
  type SurfaceModule,
} from '@a-conversa/shell';

import './index.css';
import { App } from './App';

export const mount: MountFn = (props) => {
  const root = ReactDOM.createRoot(props.container);
  root.render(
    <React.StrictMode>
      <I18nProvider i18n={props.i18n as I18nInstance}>
        <AuthValueProvider value={props.auth}>
          <BrowserRouter basename={props.routerBasePath}>
            <App />
          </BrowserRouter>
        </AuthValueProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
  return () => {
    root.unmount();
  };
};

const audienceSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Audience',
    requiredAuthLevel: 'public',
  },
};

export default audienceSurface;
```

- `requiredAuthLevel: 'public'` declares the audience's eventual contract — most audience views (for public sessions) need no auth — even though today's `SurfaceHost` does not yet read the meta hint. Encoding the intent at the contract layer makes the `aud_no_auth_for_public` widening a one-place change (host reads `meta.requiredAuthLevel`) instead of a contract change.
- The `props.i18n as I18nInstance` cast matches the participant's pattern — the mount-contract's `I18n` interface is the structural floor; the canonical i18next type is wider, and the audience's `<I18nProvider>` needs the full type. Same single-line cast.
- The WS-store window-exposure trick from the participant's `main.tsx` lines 35-55 is NOT replicated here. The audience has no Zustand store yet (state-management lands in `aud_state_management`), and no Playwright spec needs a WS-store seed at this skeleton's e2e layer (the placeholder spec just confirms the bundle mounts).
- `<WsClientProvider>` is NOT mounted here either. The audience's WS subscription wiring is `aud_ws_client`'s job; this skeleton's `<App />` tree does not call `useWsClient()` or `useWsStore()` and therefore needs no provider.

### Placeholder UI (`apps/audience/src/App.tsx`)

```tsx
import { useEffect, type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { negotiateUrlLocale } from '@a-conversa/i18n-catalogs';

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main
      data-testid="route-audience-placeholder"
      className="mx-auto max-w-2xl p-6"
    >
      <h1 className="text-2xl font-semibold">{t('audience.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('audience.placeholder.body')}</p>
    </main>
  );
}

export function App(): ReactElement {
  const { i18n } = useTranslation();
  // Per ADR 0024 + i18n_locale_negotiation.md, the audience surface
  // reads its locale from the URL prefix (`/{locale}/sessions/:id`
  // under the audience basename, i.e. `/a/{locale}/sessions/:id`
  // globally). The basename strip happens at the root's `<Route
  // path="/a/*">`; window.location.pathname under React Router 7's
  // `BrowserRouter basename={"/a"}` still returns the full
  // /a/-prefixed path, so the surface strips its own basename before
  // parsing.
  const pathnameWithoutBasename = (() => {
    const full = typeof window !== 'undefined' ? window.location.pathname : '/';
    return full.startsWith('/a') ? full.substring(2) || '/' : full;
  })();
  const { locale } = negotiateUrlLocale(pathnameWithoutBasename);
  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [i18n, locale]);

  return (
    <Routes>
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
```

- The single wildcard route absorbs every URL inside `/a/*` (e.g. `/a/sessions/:id`, `/a/en-US/sessions/:id`, `/a/foo/bar`). Real audience routes replace this in `aud_graph_rendering.*` / `aud_url_routing.aud_session_url`.
- Two i18n keys: `audience.placeholder.title` ("Audience surface") + `audience.placeholder.body` ("Loading…"). Both land in en-US, pt-BR (PENDING), and es-419 (PENDING) catalogs; the latter two go in their `*.review.json` `pending` lists. A native-speaker review follow-up is registered (see "Tech-debt registration" below).
- The placeholder testid `route-audience-placeholder` is the Playwright + Vitest selector anchor — stable, surface-scoped name analogous to the participant's `route-participant-placeholder` and the moderator's `route-create-session`.
- The URL-prefix locale read is the **third** structural pin (along with the mount-contract conformance and the manifest entry) that turns this skeleton into the first real consumer of `negotiateUrlLocale` — see Decision §4 below for why the locale read lives in the skeleton instead of being deferred to a sibling task.

### Tailwind + index.css (`apps/audience/src/index.css`)

```css
/* Global stylesheet for the audience surface.
 *
 * Refinement: tasks/refinements/audience/aud_app_skeleton.md
 * ADRs:       0005 (Tailwind with shared tokens), 0026 (micro-frontend pivot).
 */

@import 'tailwindcss';

html,
body,
#root {
  height: 100%;
  margin: 0;
}
```

Identical to the participant's reset; the audience inherits the same Tailwind v4 + `@tailwindcss/vite` build path.

### Backend wiring (`apps/server/src/routes/static-frontends.ts`)

Add (mirroring the participant's existing entries):

```ts
export const AUDIENCE_DIST_DIR_ENV = 'AUDIENCE_DIST_DIR';

export function resolveAudienceDistDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveWorkspaceDistDir(AUDIENCE_DIST_DIR_ENV, 'audience', env);
}

// inside resolveDefaultSurfaces():
{
  surfaceId: 'audience',
  urlPrefix: '/_surfaces/audience/',
  distDir: resolveAudienceDistDir(env),
  moduleFilePattern: /^audience-[A-Za-z0-9_-]+\.js$/,
  styleFilePatterns: [/^assets\/audience-[A-Za-z0-9_-]+\.css$/],
  label: 'audience',
},
```

- Same boot-time fail-fast applies (`discoverSingleFile` throws on zero or multiple matches). A misnamed audience bundle surfaces at server startup, not at first manifest fetch.
- The `discoverSingleFile` regression pins for zero-/multiple-match already exist (per the multi-surface refinement); this task does NOT duplicate them.

### Vitest regression pin (`apps/server/src/routes/static-frontends.test.ts`)

Append one new case (lower bound — author can add more if a specific behavior emerges during implementation):

- **`GET /_surfaces/manifest.json` lists the audience surface** — register the plugin with the default surface list (which, after this task, returns moderator + participant + audience), inject `GET /_surfaces/manifest.json`, parse the response body, assert `body.surfaces.audience.moduleUrl` matches `/_surfaces/audience/audience-<hash>.js` and `body.surfaces.audience.styleUrls[0]` (if present) matches `/_surfaces/audience/assets/audience-<hash>.css`. Uses `mkdtempSync` to build a fake audience dist tree (matching the participant-fixture pattern).

### Vitest mount-boundary test (`apps/audience/src/mount.test.tsx`)

```tsx
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('audience surface mount()', () => {
  it('mounts the audience route tree under the provided basename and returns an unmount fn', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: {
        userId: '00000000-0000-4000-8000-000000000003',
        screenName: 'maria',
      },
      refresh: () => undefined,
      logout: () => undefined,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.history.replaceState(
      {},
      '',
      '/a/sessions/00000000-0000-4000-8000-000000000099',
    );

    let unmount!: () => void;
    act(() => {
      unmount = mount({
        container,
        auth,
        i18n: i18n as unknown as I18n,
        routerBasePath: '/a',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
    });

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });
});
```

Narrower than the participant's three-case file (which pins three auth shapes + chrome regions + WS chip) — the audience skeleton has no chrome, no defensive guard, no WS store. The one case pins the mount contract + the placeholder rendering + the basename-scoped router wiring + the unmount tear-down. The locale read inside `<App />` runs but isn't asserted (it's a side effect on the shared `i18n.language`; the assertion belongs in `aud_url_routing.*` once locale-driven routing is observable end-to-end).

### Root host route (`apps/root/src/App.tsx`)

One-line edit to the `<Routes>` block at lines 229-238, immediately above the `<Route path="*" element={<Navigate to="/" replace />} />` catch-all and below the participant route:

```tsx
<Route path="/a/*" element={<SurfaceHost surfaceId="audience" routerBasePath="/a" />} />
```

No other changes to `apps/root/src/App.tsx`. The `SurfaceHost` component already handles auth-gating + manifest loading + dynamic import + mount/unmount lifecycle.

### Playwright project (`playwright.config.ts`)

Add a new project below `chromium-participant-skeleton`:

```ts
{
  name: 'chromium-audience-skeleton',
  testMatch: /audience-skeleton-smoke\.spec\.ts$/,
  dependencies: ['setup-auth'],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    ignoreHTTPSErrors: true,
    storageState: AUTH_STORAGE_STATE_PATH,
  },
},
```

Same browser profile as `chromium-participant-skeleton`. Future audience leaves widen the `testMatch` (the way `chromium-participant-skeleton` widened to accept `participant-invite-acceptance` / `participant-lobby` / `participant-graph-render` over successive refinements).

### Cucumber surface

**No Cucumber scenario in this skeleton.** The audience-specific wire-format surface — a read-only subscription that does not authorize publish — is owned by `aud_ws_client` (the next sibling, depends `!aud_app_skeleton`). The skeleton has no observable behaviour at the protocol or replay seam: the placeholder route reads no WS events and emits no envelopes. Per the "Behavior + e2e coverage growth" trend the orchestrator watches, this is a justified flat-Cucumber commit: the audience subscribe-only contract IS Cucumber territory, but it lives one task away. The `aud_ws_client` refinement MUST scope at least one Cucumber scenario covering "audience client subscribes; server delivers per-session envelopes; audience publish attempt is rejected" — that's the natural pin once the subscribe path is wired. Recording the deferral here so the next refinement-writer pass for `aud_ws_client` sees the expectation.

### UI-stream e2e policy

**E2e is in scope; scoped Playwright is the default.** The audience surface is **reachable** from a root route the moment this task lands its `/a/*` route + plugin entry, so the deferred-e2e exception in `ORCHESTRATOR.md` does NOT apply. The spec:

- Authenticates a Playwright `page` via the existing `authenticated` fixture from [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts).
- Navigates the page to `/a/sessions/<deterministic-uuid>` (the canonical audience URL shape).
- Asserts `data-testid="route-audience-placeholder"` is visible.
- Asserts the page title / first `<h1>` matches the en-US placeholder title ("Audience surface").
- One scenario, en-US only (cross-locale text is covered by the catalog parity check at the Vitest layer).

The spec uses the existing `make up` compose stack + the existing `pnpm run test:e2e` runner; no new fixture, no backend mock. It runs against the same Fastify server the moderator + participant e2e specs hit.

A second Playwright scenario — "unauthenticated visitor on `/a/...` gets bounced to `/login` with the deep link remembered" — is NOT in this skeleton's scope; that behaviour is `SurfaceHost`'s responsibility and is already pinned by the existing root-host e2e coverage (`tests/e2e/create-session-flow.spec.ts` exercises the same `rememberReturnTo` path under `/m/*`). Adding a `/a/*` mirror would duplicate coverage without pinning surface-specific behaviour. **The public-session unauthenticated path** (a separate concern from the SurfaceHost's authenticated gate) is `aud_no_auth_for_public`'s test surface, not this skeleton's.

### Files this task touches (the explicit allowlist)

- `apps/audience/package.json` (modified — widen deps, replace scripts).
- `apps/audience/vite.config.ts` (NEW — library-mode build config, mirroring the participant's).
- `apps/audience/tsconfig.json` (modified — add the `packages/shell` project reference + `vite/client` types + `rootDir`).
- `apps/audience/src/main.tsx` (NEW — the mount entrypoint).
- `apps/audience/src/App.tsx` (NEW — the placeholder route tree with URL-prefix locale read).
- `apps/audience/src/index.css` (NEW — Tailwind import + reset).
- `apps/audience/src/mount.test.tsx` (NEW — Vitest mount-boundary case).
- `apps/audience/src/index.tsx` (DELETED — current stub `export {};`).
- `apps/audience/src/i18n.ts` (DELETED — i18n is host-supplied per ADR 0026).
- `apps/audience/README.md` (modified — one-sentence pointer at this refinement; optional but low-cost).
- `apps/root/src/App.tsx` (modified — one new `<Route path="/a/*" ...>` line).
- `apps/server/src/routes/static-frontends.ts` (modified — add `AUDIENCE_DIST_DIR_ENV`, `resolveAudienceDistDir`, and the audience entry in `resolveDefaultSurfaces`).
- `apps/server/src/routes/static-frontends.test.ts` (modified — append one regression-pin case for the audience manifest entry).
- `Dockerfile` (modified — add `COPY --from=build /app/apps/audience/dist ./apps/audience/dist` in the runtime stage).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add `audience.placeholder.title` + `audience.placeholder.body`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same, draft text).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same, draft text).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — add the two dotted keys to `pending`).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `playwright.config.ts` (modified — add the `chromium-audience-skeleton` project).
- `tasks/35-frontend-i18n.tji` (modified — register the `i18n_audience_placeholder_native_review` follow-up task).
- `tests/e2e/audience-skeleton-smoke.spec.ts` (NEW — Playwright placeholder spec).

### Files this task does NOT touch

- `.tji` files OTHER than `tasks/35-frontend-i18n.tji` — the `complete 100` marker for `aud_app_skeleton` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42), not at refinement-write time.
- `docs/adr/` — no new ADR needed (every decision below is a direct application of an existing ADR or a scoped UI-implementation choice; see Decision §7).
- `packages/shell/` — the shell substrate is consumed unchanged. No widening of `AuthContextValue` / `MountProps` / `SurfaceMeta`; the `requiredAuthLevel: 'public'` meta is a value the contract already accepts, not a new field.
- `apps/root/src/surfaces/SurfaceHost.tsx` — the host's auth gate is NOT widened in this skeleton (that's `aud_no_auth_for_public`'s job). The skeleton works under the existing authenticated-only gate.
- `apps/moderator/` / `apps/participant/` — the other surfaces stay as-is.
- `apps/server/src/server.ts` — registration order is unchanged; the static-frontends plugin's API stays the same.
- Any backend schema / migration / DB code — no DB story in this leaf.
- `infra/authelia/users.yml` — the existing 12-user pool is enough; the audience placeholder spec reuses any pool user via the shared `setup-auth` storage state. No new audience-specific Authelia user or group is added — the audience role is a session-relative concept (anyone watching a public stream), not an Authelia group.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest mount-boundary test** (`apps/audience/src/mount.test.tsx`) — proves the `mount()` export wires the React tree correctly under a host-supplied basename + auth + i18n, renders the placeholder testid, and the returned `UnmountFn` tears the container down. Catches regressions like "someone changed the mount signature and the participant-mirrored shape silently broke."
2. **Vitest backend regression** (one new case in `apps/server/src/routes/static-frontends.test.ts`) — proves `GET /_surfaces/manifest.json` exposes the audience surface with the right URL shape after a `pnpm -F @a-conversa/audience build`. Catches "the surface entry was added to the plugin but the regex pattern doesn't match the actual filename."
3. **Playwright placeholder spec** (`tests/e2e/audience-skeleton-smoke.spec.ts`) — proves the end-to-end flow: a logged-in user navigates to a `/a/*` URL, the root host fetches the manifest, dynamic-imports the audience bundle, the surface mounts inside the basename-scoped router, the placeholder renders. This is the **UI-stream e2e per the policy in `ORCHESTRATOR.md`**.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — the widened `apps/audience/package.json` deps resolve from the workspace lockfile; no new top-level pnpm install warnings beyond the pre-existing baseline.
2. **`pnpm -F @a-conversa/audience typecheck` exits zero** — `tsc -b` from the workspace; the new `main.tsx` / `App.tsx` / `mount.test.tsx` compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/audience build` exits zero** and produces:
   - `apps/audience/dist/audience-<hash>.js` (single ESM bundle, hash-named).
   - `apps/audience/dist/assets/audience-<hash>.css` (CSS sidecar, hash-named, the Tailwind build output).
   - The `<hash>` is a non-empty base64-url string (`[A-Za-z0-9_-]+`), matching the backend's `moduleFilePattern` regex.
4. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new `.ts`/`.tsx` files are picked up by the existing `apps/**/*.{ts,tsx}` ESLint glob and the root tsconfig's project reference to `apps/audience`.
5. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+2** (one for the audience mount-boundary case, one for the manifest regression pin). The new Vitest cases match the cases-anchored shape described under Constraints → "Test layers."
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green after the catalog edits — the two new `audience.placeholder.*` keys are present in all three locales; pt-BR + es-419 land flagged PENDING.
7. **`pnpm -F @aconversa/root build` + `pnpm -F @a-conversa/moderator build` + `pnpm -F @a-conversa/participant build` + `pnpm -F @a-conversa/audience build`** all green (preconditions for the e2e). The pre-commit hook's full build already runs the first three; this leaf adds the fourth.
8. **`pnpm run test:e2e`** under `make up` runs the new `tests/e2e/audience-skeleton-smoke.spec.ts` green via the new `chromium-audience-skeleton` Playwright project. The spec completes in < 30s under the default Playwright timeout.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `aud_app_skeleton` task block (and any milestone whose deps derive-complete) per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42). The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
10. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches."
11. **No backend route ambiguity introduced** — `GET /_surfaces/manifest.json` returns moderator, participant, AND audience entries; the existing moderator + participant regression pins continue to pass unchanged.
12. **`/_surfaces/audience/audience-<hash>.js` is reachable** through the Fastify server when the audience dist is present (already implied by the manifest pin + the `discoverSingleFile` fail-fast, but called out so the implementer confirms the actual HTTP path resolves in the e2e environment).

## Decisions

### 1. Mirror the participant workspace's library-mode shape (not the moderator's)

Three alternatives surveyed:

- **(A) Mirror the moderator workspace directly.** Rejected — the moderator's `main.tsx` carries the WS-store window-exposure trick + the moderator-specific `<App />` route table; the audience skeleton has neither. Mirroring moderator forces the implementer to delete trick-specific lines, increasing the chance of accidental retention.
- **(B) Build a bespoke audience-tuned config** (different rollup output, different CSS strategy). Rejected — the static-frontends plugin's discovery patterns are tuned for the participant + moderator shape; deviating without cause would force a parallel discovery shape and bisect the architecture. The audience skeleton's bundle today is tiny — the placeholder is a few lines of JSX — so any optimisation is premature.
- **(C) Mirror the participant (chosen).** The participant is the most recent surface to land the skeleton shape; its `vite.config.ts`, `tsconfig.json`, `main.tsx`, `App.tsx`, `index.css`, and `mount.test.tsx` are the latest precedent. The audience adopts the participant's shape with three intentional divergences: (i) surface name swap (`participant-` → `audience-`), (ii) `requiredAuthLevel: 'public'` instead of `'authenticated'` (Decision §5), (iii) URL-prefix locale read inside `<App />` (Decision §4). Everything else is line-for-line identical.

Cost of the mirror: ~80 lines of duplicated boilerplate (the vite config + the main.tsx scaffold). Benefit: each surface is independently auditable and the architecture stays uniform across surfaces; the orchestrator's future "shared surface-bootstrap abstraction" could be extracted later if the duplication compounds (three surfaces is the inflection point where extraction starts paying off; this skeleton lands the third copy without preempting that extraction — it's a future infrastructure leaf, not this leaf's scope).

### 2. The placeholder UI is a single wildcard route, not pre-stubbed audience routes

Two alternatives surveyed:

- **Pre-stub the planned audience routes** (`/sessions/:id` for live, `/sessions/:id?position=N` for replay deep-link, the `/{locale}/sessions/{id}` URL-prefix variant) with separate placeholder components — rejected. Pre-stubbing routes that don't have agreed shapes wastes effort and risks pinning incorrect path templates. The bootstrap's job is to prove the bundle mounts; the route shape is the next task's design decision (`aud_url_routing.aud_session_url`).
- **One wildcard route rendering one placeholder** (chosen). Every URL under `/a/*` renders the same placeholder; future tasks replace the `<Routes>` body when they know their route shapes. The wildcard absorbs `/a/sessions/:id`, `/a/en-US/sessions/:id`, etc. without needing the skeleton to know the URL grammar.

Future tasks (`aud_url_routing.aud_session_url`, `aud_url_routing.aud_url_position_param`, `aud_graph_rendering.aud_cytoscape_init`) will replace the wildcard with their real route table. The data-testid `route-audience-placeholder` will disappear at that point (the e2e spec this task lands either gets updated by the consuming task or remains as a strict-regression pin against the no-placeholder change — author-choice during that task's implementation, matching the participant precedent).

### 3. The audience surface registers via `resolveDefaultSurfaces`, not as an opt-in caller-passed entry

Two alternatives surveyed:

- **Caller-passed surface entry** — the server bootstrap (`apps/server/src/server.ts`) registers the static-frontends plugin with an explicit surfaces list that includes the audience. Rejected: the `serve_static_frontends_multi_surface` refinement made `resolveDefaultSurfaces` the canonical source of wired surfaces; opt-in lists are for tests that need bespoke fixtures, not for the production registration path. Bypassing the default-resolver would force a parallel registration channel for every new surface.
- **Add to `resolveDefaultSurfaces`** (chosen). Mirrors the participant entry's shape. The plugin's default code path picks up the new entry without any server-bootstrap changes. This is the direct precedent the participant skeleton established.

### 4. The URL-prefix locale read lives in `<App />`, not deferred to a sibling task

Three alternatives surveyed:

- **Defer the locale read to `aud_url_routing.aud_session_url`** — only land the placeholder + mount contract here, hardcoding to whatever locale the host's i18n instance was bootstrapped with. Rejected: `frontend_i18n.i18n_locale_negotiation` is settled and explicitly names this skeleton as the consumer that lands the audience URL-prefix locale read (see the refinement's Status block at lines 67-68: "Audience + participant `main.tsx` files do not exist yet (those app skeletons are pending under `aud_app_skeleton` / `part_app_skeleton`); the helpers are exported and documented so those tasks can consume them directly"). Deferring would leave the helper unused for an unbounded interval and force the next refinement-writer to re-discover the consumer expectation.
- **Land the locale read inside `<PlaceholderRoute>`** — call `negotiateUrlLocale` per-render. Rejected: `useEffect` semantics — the locale change is a side effect on the shared i18n instance and shouldn't fire on every placeholder render. Mounting it in `<App />` with the pathname-derived `locale` as the dep array gives the right "fires on initial mount + on locale-segment change" semantics.
- **Land in `<App />` with the basename-strip + `useEffect`** (chosen). Three properties: (i) the locale read sits at the surface's outer-most React tree level, where it should; (ii) the dep array (`[i18n, locale]`) re-runs `changeLanguage` only when the locale segment changes, not on every render; (iii) the basename strip is one line and self-documenting (a comment cites why it's needed under React Router 7's `BrowserRouter basename={...}` behaviour).

The locale read is the **first** production consumer of `negotiateUrlLocale`. It exercises the helper end-to-end and surfaces any integration bug (e.g. the basename-strip interaction) at the skeleton tier — before the more complex `aud_url_routing.*` tasks land and would have to debug it against a richer route table.

### 5. `requiredAuthLevel: 'public'` even though `SurfaceHost` does not yet read it

Two alternatives surveyed:

- **`requiredAuthLevel: 'authenticated'` to match what `SurfaceHost` currently enforces.** Rejected: the meta field is the contract layer's declaration of the surface's eventual policy. The audience's MOST common case (a public-session viewer with no auth) is `'public'`; declaring `'authenticated'` now would force `aud_no_auth_for_public` to widen the meta as well as the host, doubling the change surface. The meta hint is advisory until the host reads it; declaring the real intent costs nothing today and saves a contract change tomorrow.
- **Omit `meta` entirely.** Rejected — the moderator and participant both declare `meta`; the audience omitting it creates a visible inconsistency across the three surfaces, and the `displayName` (`'Audience'`) is genuinely useful for any future host nav UI even without the requiredAuthLevel read.
- **`requiredAuthLevel: 'public'`** (chosen). Encodes the audience's eventual policy; declares `displayName: 'Audience'` for any host that wants to display surface metadata. The `SurfaceHost` reading the hint is `aud_no_auth_for_public`'s widening (one read in the host, one branch added — small, localised change), not a contract migration.

### 6. The e2e spec uses the existing `authenticated` fixture; no separate audience-specific fixture

Two alternatives surveyed:

- **Build a dedicated audience-public Playwright fixture** that drives an unauthenticated context against a seeded public session. Rejected: the skeleton's e2e only needs to prove the bundle mounts; the public-session no-auth flow is `aud_no_auth_for_public`'s concern, not this task's. Building a public-fixture seam in this skeleton would couple two tasks' scope.
- **Reuse the existing `authenticated` fixture / `setup-auth` storage state** (chosen). Any Authelia-seeded user (alice, ben, etc.) satisfies `SurfaceHost`'s `auth.status === 'authenticated'` precondition; the placeholder doesn't care which user. The spec stays narrow and doesn't introduce new fixture coupling. When `aud_no_auth_for_public` lands its anonymous-session e2e, that spec brings its own setup pattern (likely `test.use({ storageState: { cookies: [], origins: [] } })` to opt out of the shared auth jar, mirroring the participant skeleton's documented unauthenticated-deflection pattern).

### 7. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- **A direct application of an existing ADR** — ADR 0026's library-mode + mount-contract + URL-prefix dispatch; ADR 0010's pnpm-workspaces shape; ADR 0022's no-throwaway-verifications; ADR 0024's URL-prefix locale rule for audience.
- **A direct mirror of the participant workspace** — same vite config, same main.tsx scaffold, same tsconfig project references, same Tailwind reset, same Playwright project shape.
- **A scoped UI policy that doesn't constrain other tasks** — wildcard placeholder route (Decision §2), placeholder-keys namespace, reuse of the existing auth fixture (Decision §6), `requiredAuthLevel: 'public'` meta hint (Decision §5).

The "no new dependencies" rule is satisfied: every runtime dep added to the audience `package.json` already exists in the participant workspace. No new ADR is triggered.

### 8. Tech-debt registration

- **`frontend_i18n.i18n_audience_placeholder_native_review`** — pt-BR + es-419 native-speaker review of the two new `audience.placeholder.*` keys. Effort: 0.25d. Depends: the most recent native-review task in the chain (currently `i18n_participant_placeholder_native_review` per `part_app_skeleton`'s Status; if that has already been signed off, the chain shifts forward — Closer to read the current state). Mirrors the existing review-task shape. **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes.
- **No other follow-ups need registration in this refinement.** The remaining `aud_shell` group leaves (`aud_ws_client`, `aud_state_management`, `aud_no_auth_for_public`, `aud_auth_for_private`) already exist as open WBS leaves with `depends !aud_app_skeleton`; they pick up automatically.
- **Deferred-Cucumber expectation forwarded to `aud_ws_client`.** This refinement's "Cucumber surface" section above documents that the audience subscribe-only wire contract is the natural Cucumber pin and lives in `aud_ws_client`'s scope. No new task to register — the leaf already exists. The expectation is recorded in this refinement's body so the next refinement-writer pass for `aud_ws_client` reads it.
- **FacetPill import decision deferred to `aud_proposed_styling` / `aud_per_facet_visualization`.** This skeleton does NOT import `<FacetPill>` (the moderator-side component the participant's `package.json` awkwardly depends on). Whether the audience eventually imports from `@a-conversa/moderator` (the awkward path the participant uses) or waits for `shell_pkg.extract_facet_pill` is a decision the consuming task makes; this skeleton leaves audience clean of moderator deps so either option remains open.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-18.

- Vite library-mode build per ADR 0026 lands `apps/audience/vite.config.ts` + `apps/audience/src/main.tsx`; production artifacts match the expected `audience-<hash>.js` + `assets/audience-<hash>.css` shape (verified `dist/audience-WCArqwdR.js` + `dist/assets/audience-D1XVaLuq.css`).
- Mount contract honored: `apps/audience/src/main.tsx` exports `mount(props): UnmountFn` and a `SurfaceModule` with `requiredAuthLevel: 'public'`, consumed by the shell's host plumbing without any audience-side DOM bootstrap.
- Root host integration: `apps/root/src/App.tsx` gains a `/a/*` Route delegating to the audience surface, and `apps/server/src/routes/static-frontends.ts` registers the audience entry in `resolveDefaultSurfaces` (with the pin regression in `static-frontends.test.ts` and the runtime stage `COPY` in `Dockerfile`).
- First production consumer of `negotiateUrlLocale`: `apps/audience/src/App.tsx` reads the URL-prefix locale after the SurfaceHost-provided basename is stripped, closing the loop on `frontend_i18n.i18n_locale_negotiation`.
- i18n: 6 new entries land for the 2 keys × 3 locales (`audience.placeholder.title`, `audience.placeholder.body`) in `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`; pt-BR ("Painel da audiência" / "Carregando…") and es-419 ("Panel de la audiencia" / "Cargando…") drafts are flagged `PENDING` in the `*.review.json` trackers and registered as the new `frontend_i18n.i18n_audience_placeholder_native_review` tech-debt leaf.
- Playwright pipeline grows a new `chromium-audience-skeleton` project in `playwright.config.ts` plus `tests/e2e/audience-skeleton-smoke.spec.ts` (login + landing renders, 1.1s); `chromium-participant-skeleton` re-runs green with no regression.
- ADR 0022 failing-first verification confirmed by the Implementer: Vitest 4037 → 4039 (+2: `apps/audience/src/mount.test.tsx` mount-boundary + the static-frontends manifest regression pin), Cucumber unchanged, Playwright +1 project / +1 scenario.
