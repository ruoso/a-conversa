# Participant surface as a mountable library (entry, build, mount() export)

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_shell.part_app_skeleton`
**Effort estimate**: 1d
**Inherited dependencies**:

- `shell_package.shell_mount_contract` (settled — `MountProps`, `UnmountFn`, `MountFn`, and `SurfaceModule` already exist in `@a-conversa/shell`; see [packages/shell/src/mount-contract/types.ts](../../../packages/shell/src/mount-contract/types.ts#L78) and the refinement at [tasks/refinements/shell-package/shell_mount_contract.md](../shell-package/shell_mount_contract.md#L1)).
- `shell_package.shell_substrate_extraction` (settled — `AuthProvider`/`AuthValueProvider`, `useAuth`, `createI18nInstance`, `I18nProvider`, the WS client surface, the API-error mappers, and the `ScreenNameForm`/`LoginButton` chrome all live in `@a-conversa/shell`; this task consumes them but does not extend them).
- `root_app.root_pkg_skeleton` (settled — the `apps/root/` workspace exists, ships a `BrowserRouter` + `AuthProvider` + `I18nProvider` shell with a `SurfaceHost` dispatcher; this task adds a `/p/*` route to that dispatcher).
- `root_app.root_moderator_cutover` (settled — the moderator already runs through the root host as a mountable library; this task mirrors that pattern for the participant surface).
- `backend.api_skeleton.serve_static_frontends_multi_surface` (settled — the plugin already serves `/_surfaces/manifest.json` + per-surface bundles; this task adds the participant surface entry to `resolveDefaultSurfaces` per that refinement's Acceptance §8 explicit deferral).

## What this task is

Convert the placeholder participant workspace at [`apps/participant/`](../../../apps/participant/) into a **library-mode Vite bundle** that exports the [`@a-conversa/shell`](../../../packages/shell/src/index.ts) `mount(props): UnmountFn` contract, register the bundle with the backend static-frontends plugin so it is reachable through `/_surfaces/manifest.json`, and wire a `/p/*` route in [`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx) so the root host dispatches into the participant surface when a debater hits an invite link.

The deliverable is the **bootstrap workspace**, not the participant's real UI. Concretely:

- A library-mode `apps/participant/vite.config.ts` that emits `participant-<hash>.js` (+ a `participant-<hash>.css` sidecar) under `apps/participant/dist/`, matching the moderator's library-mode shape (see [`apps/moderator/vite.config.ts:34-59`](../../../apps/moderator/vite.config.ts#L34-L59)).
- An entrypoint at `apps/participant/src/main.tsx` that exports `mount: MountFn` plus a default `SurfaceModule` (mirroring [`apps/moderator/src/main.tsx:35-83`](../../../apps/moderator/src/main.tsx#L35-L83)).
- A small `<App />` component at `apps/participant/src/App.tsx` that mounts a `<BrowserRouter basename={props.routerBasePath}>` with one wildcard route that renders a `data-testid="route-participant-placeholder"` "Participant surface loading…" panel — enough to confirm the bundle reaches the DOM through the root host.
- A backend update: one entry in [`resolveDefaultSurfaces`](../../../apps/server/src/routes/static-frontends.ts#L259-L278) for the participant surface (matching the moderator entry's shape), one Dockerfile `COPY --from=build /app/apps/participant/dist ./apps/participant/dist`, one Vitest regression pin in [`apps/server/src/routes/static-frontends.test.ts`](../../../apps/server/src/routes/static-frontends.test.ts) asserting `/_surfaces/manifest.json` lists a `participant` entry with hash-busted URLs.
- A root host update: one `<Route path="/p/*" element={<SurfaceHost surfaceId="participant" routerBasePath="/p" />} />` line in [`apps/root/src/App.tsx`](../../../apps/root/src/App.tsx#L235) above the `*` catch-all.
- Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): a Vitest mount-boundary case at `apps/participant/src/mount.test.tsx` (mirroring [`apps/moderator/src/mount.test.tsx`](../../../apps/moderator/src/mount.test.tsx)), and **one Playwright spec** that authenticates a user, navigates to `/p/sessions/<uuid>/anything`, and asserts the placeholder testid renders.

Out of scope (deferred to existing sibling leaves under `part_shell` or `part_session_join`):

- The real participant landing UI (read-only graph view, voting controls, status indicator) — owned by `part_landscape_layout`, `part_status_indicator`, and the `part_graph_view` group.
- The invite-acceptance claim flow (`POST /api/sessions/:id/invite/claim`) — owned by `part_session_join.part_invite_acceptance`.
- The pre-debate lobby view the moderator sees mirror-images of — owned by `part_session_join.part_lobby_view`.
- The Zustand stores — owned by `part_state_management` (settled-pending; its own task).
- The shell `useAuth()` wiring beyond a status-gated render — `part_auth_flow` (0.25d, depends on this task).
- The shell WS-client wiring — `part_ws_client` (0.5d, depends on this task).

## Why it needs to be done

`m_manual_lobby_smoke` (M3-lobby, [`tasks/99-milestones.tji:42-46`](../../99-milestones.tji#L42-L46)) — the milestone at which a human can manually drive a session through invite-and-lobby — lists `participant_ui.part_shell.part_app_skeleton` as a direct dependency. The milestone's success criterion is "moderator creates session, generates invite URLs, two debaters open the URLs in browsers, authenticate, land in the lobby, and the moderator sees both joined." Today the moderator already emits invite URLs of shape `/p/sessions/:id/invite?role=debater-A` (see [`apps/moderator/src/routes/InviteParticipants.tsx:315`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L315)), but the root host's route table at [`apps/root/src/App.tsx:229-238`](../../../apps/root/src/App.tsx#L229-L238) has no `/p/*` handler — every participant invite link currently falls through to the `*` catch-all and redirects to `/`. Without this skeleton, the milestone's "two debaters open the URLs in browsers" step cannot land.

Downstream, this leaf is the unblocker for the rest of the `part_shell` group (`part_state_management`, `part_auth_flow`, `part_landscape_layout`, `part_status_indicator`, `part_ws_client` — each depends `!part_app_skeleton`) and for `part_session_join.part_invite_acceptance` (the route that turns the invite URL into a real claim POST). Without a library-mode bundle exporting `mount()`, none of those siblings have a workspace to land in. The skeleton is the seam that flips the participant surface from stub to mountable.

Architecturally, this is also the second concrete validation of the ADR 0026 micro-frontend contract (after the moderator cutover). A second surface that consumes `@a-conversa/shell`'s mount contract and registers with the static-frontends plugin proves the architecture generalizes — the audience surface's later `aud_app_skeleton` will follow the same shape.

## Inputs / context

### ADRs

- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md#L37) — the micro-frontend pivot. Decision 1 fixes the URL prefix table (`/p/*` → participant). Decision 2 fixes the surface build output (Vite library mode + `mount(props): UnmountFn` export + `SurfaceModule` default). Decision 3 fixes that surfaces own their own React DOM root and `<BrowserRouter basename={routerBasePath}>`. Decision 4 fixes the backend serving the surface bundle under `/_surfaces/{surface}/...` via the manifest.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md#L31) — every empirical verification of the new behavior is a committed test; the Vitest mount probe + the Playwright placeholder spec ARE the regression pins.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the participant bundle does NOT bootstrap its own i18next instance; the root host owns the `I18nProvider` and passes the live `i18n` value through `MountProps.i18n`.

### Moderator surface — the canonical precedent to mirror

The moderator workspace is the surface that already implements the contract; the participant skeleton mirrors it line-for-line where possible:

- [`apps/moderator/package.json`](../../../apps/moderator/package.json) — pins `@a-conversa/shell`, `@a-conversa/i18n-catalogs`, `@a-conversa/shared-types`, plus the React/i18next/react-router-dom runtime trio. Three scripts: `dev`/`build`/`typecheck`. Type `module`, version `0.0.0`, `private: true`. The participant `package.json` adopts the same shape minus the moderator-specific deps (`@dagrejs/dagre`, `reactflow`, `zustand` — none needed for the skeleton).
- [`apps/moderator/vite.config.ts`](../../../apps/moderator/vite.config.ts) — defines the library-mode build. Two load-bearing knobs: `lib.entry = 'src/main.tsx'` + `lib.formats = ['es']` (ESM only, per ADR 0026 Decision 2), and `rollupOptions.output.entryFileNames = 'moderator-[hash].js'` + `assetFileNames` branching `style.css → 'moderator-[hash].css'` else `'assets/[name]-[hash][extname]'`. `inlineDynamicImports: true` keeps the bundle a single ESM module (the root host dynamic-imports a single URL). `cssCodeSplit: false` ensures one CSS sidecar. `define: { 'process.env.NODE_ENV': JSON.stringify('production') }` because some peer-dep CJS modules (e.g. `react-dom`) read it.
- [`apps/moderator/src/main.tsx`](../../../apps/moderator/src/main.tsx#L20-L83) — the mount export. Imports `AuthValueProvider`, `I18nProvider`, `MountFn`, `SurfaceModule` from `@a-conversa/shell`. Builds the React tree: `<React.StrictMode><I18nProvider i18n={props.i18n}><AuthValueProvider value={props.auth}><BrowserRouter basename={props.routerBasePath}><App /></BrowserRouter></AuthValueProvider></I18nProvider></React.StrictMode>`. Returns `() => { root.unmount(); }`. The default export is a `SurfaceModule` with `mount` + `meta: { displayName: 'Moderator', requiredAuthLevel: 'authenticated' }`.
- [`apps/moderator/src/App.tsx`](../../../apps/moderator/src/App.tsx) — the route tree under the basename; the participant equivalent is a single wildcard route returning the placeholder.
- [`apps/moderator/src/index.css`](../../../apps/moderator/src/index.css) — `@import 'tailwindcss';` plus the `html, body, #root { height: 100%; margin: 0; }` reset. Participant inherits the same; Tailwind v4 + `@tailwindcss/vite` is the project standard ([ADR 0005](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md)).
- [`apps/moderator/src/mount.test.tsx`](../../../apps/moderator/src/mount.test.tsx) — the Vitest mount-boundary case. Constructs a minimum-viable `MountProps` (real `document.createElement('div')`, a real `i18n` via `createI18nInstance('en-US')`, a fake authenticated `auth`), pushes `window.history.replaceState(..., '/m/sessions/new')`, calls `mount(props)`, asserts a known testid (`route-create-session`) renders, then calls `unmount()` and asserts `container.innerHTML === ''`. The participant equivalent pushes `/p/sessions/<uuid>/anything` and asserts `route-participant-placeholder`.
- [`apps/moderator/tsconfig.json`](../../../apps/moderator/tsconfig.json) — extends `tsconfig.base.json`, sets `module: ESNext` + `moduleResolution: Bundler` + `jsx: react-jsx`, declares project references to `packages/shared-types`, `packages/i18n-catalogs`, `packages/shell`. The participant `tsconfig.json` already declares the first two but lacks the shell reference; this task adds it.

### Root host — the dispatcher this task wires into

- [`apps/root/src/App.tsx:227-239`](../../../apps/root/src/App.tsx#L227-L239) — the `Routes` table. The moderator route is `<Route path="/m/*" element={<SurfaceHost surfaceId="moderator" routerBasePath="/m" />} />`; the participant route lands immediately below it: `<Route path="/p/*" element={<SurfaceHost surfaceId="participant" routerBasePath="/p" />} />`. Order matters only that both sit above the `*` catch-all (line 236).
- [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) — already generic over `surfaceId` and `routerBasePath`. No code change needed here; the host pulls the manifest, dynamic-imports the bundle URL by `surfaceId`, and calls `mount({ container, auth, i18n, routerBasePath })`. If `auth.status` is `unauthenticated` or `needs-screen-name`, it remembers the deep link via `rememberReturnTo` (lines 142-150) and redirects to the root's auth chrome.
- [`apps/root/src/surfaces/manifest.ts`](../../../apps/root/src/surfaces/manifest.ts) — fetches `/_surfaces/manifest.json` and dynamic-`import()`s the advertised module URL. No code change needed; the participant surface populates the manifest server-side.

### Backend — the static-frontends plugin this task extends

- [`apps/server/src/routes/static-frontends.ts:259-278`](../../../apps/server/src/routes/static-frontends.ts#L259-L278) — `resolveDefaultSurfaces` returns the wired surface list. Today: one entry (`moderator`). After this task: two entries (`moderator` + `participant`), with the participant entry following the moderator's shape: `surfaceId: 'participant'`, `urlPrefix: '/_surfaces/participant/'`, `distDir: resolveParticipantDistDir(env)`, `moduleFilePattern: /^participant-[A-Za-z0-9_-]+\.js$/`, `styleFilePatterns: [/^assets\/participant-[A-Za-z0-9_-]+\.css$/]`, `label: 'participant'`.
- [`apps/server/src/routes/static-frontends.ts:184-185`](../../../apps/server/src/routes/static-frontends.ts#L184-L185) — env-override constants. This task adds `PARTICIPANT_DIST_DIR_ENV = 'PARTICIPANT_DIST_DIR'` alongside the existing `ROOT_DIST_DIR_ENV` and `MODERATOR_DIST_DIR_ENV`, plus a `resolveParticipantDistDir` helper sharing the existing `resolveWorkspaceDistDir(envKey, appName)` logic.
- [`apps/server/src/routes/static-frontends.test.ts`](../../../apps/server/src/routes/static-frontends.test.ts) — current Vitest suite. This task adds one regression pin: `GET /_surfaces/manifest.json` returns a body whose `surfaces` map contains a `participant` entry with a hash-busted `moduleUrl` and (optional) `styleUrls`. The serve-static-frontends-multi-surface refinement at [tasks/refinements/backend/serve_static_frontends_multi_surface.md](../backend/serve_static_frontends_multi_surface.md#L148-L153) Acceptance §8 explicitly defers this wiring + test pin to this task.
- [`Dockerfile`](../../../Dockerfile) — already has `COPY --from=build /app/apps/root/dist` and `COPY --from=build /app/apps/moderator/dist`. This task adds `COPY --from=build /app/apps/participant/dist ./apps/participant/dist` (the runtime stage; the build stage already runs `pnpm -r build` which picks up the participant workspace).

### Moderator invite URL — the entry point this skeleton makes reachable

[`apps/moderator/src/routes/InviteParticipants.tsx:313-316`](../../../apps/moderator/src/routes/InviteParticipants.tsx#L313-L316) builds invite URLs as:

```ts
return `${origin}/p/sessions/${sessionId}/invite?role=${role}`;
```

That URL currently falls through to the root's `*` catch-all and redirects to `/`. After this task lands, the same URL hits the new `/p/*` route, the `SurfaceHost` dispatcher checks auth (and bounces to `/login` with a remembered return-to if unauthenticated), then mounts the participant bundle inside the basename-scoped router. The participant surface's wildcard route renders the placeholder. The real claim UI lands later in `part_session_join.part_invite_acceptance` and uses `react-router-dom`'s `useParams` + `useSearchParams` to read `sessionId` + `role`.

### Existing stub at `apps/participant/`

- [`apps/participant/package.json`](../../../apps/participant/package.json) — package name `@a-conversa/participant` (the convention this task preserves). Today's `build` script is `echo 'no build yet (placeholder; bundler wiring lands with frontend tasks)'` — this task replaces it with `tsc -b && vite build`. Today's `dependencies` list (`@a-conversa/i18n-catalogs`, `i18next`, `i18next-icu`, `react-i18next`) is incomplete for the new shape; this task widens it.
- [`apps/participant/src/index.tsx`](../../../apps/participant/src/index.tsx) — current contents: `export {};`. Deleted by this task; replaced by `apps/participant/src/main.tsx` (the mount entrypoint) + `apps/participant/src/App.tsx` (the placeholder route tree) + `apps/participant/src/index.css` (Tailwind import + reset).
- [`apps/participant/src/i18n.ts`](../../../apps/participant/src/i18n.ts) — current contents: a standalone `initI18n(locale)` that bootstraps a participant-owned i18next instance. **Deleted by this task** — per ADR 0026 the i18n instance is host-supplied via `MountProps.i18n`, so the surface no longer bootstraps its own. This deletion matches the precedent from `apps/moderator/src/main.tsx`'s top-of-file comment ("`AuthProvider` + `I18nProvider` now come from `@a-conversa/shell`").
- [`apps/participant/tsconfig.json`](../../../apps/participant/tsconfig.json) — already extends `tsconfig.base.json`; this task adds `{ "path": "../../packages/shell" }` to `references` and adds `"types": ["vite/client"]` to `compilerOptions` (mirroring the moderator's tsconfig).

### Shell substrate the participant consumes

- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — the public barrel. The participant skeleton imports `AuthValueProvider`, `I18nProvider`, `MountFn`, `SurfaceModule`, and `I18nInstance` (as a cast target for the i18n bridge), matching the moderator's exact import set.
- [`packages/shell/src/mount-contract/types.ts:85-114`](../../../packages/shell/src/mount-contract/types.ts#L85-L114) — `MountProps` (the host-supplied dependency bag: `container`, `auth`, `i18n`, `routerBasePath`, optional `ws` + `locale`); `UnmountFn = () => void`; `MountFn = (props: MountProps) => UnmountFn`; `SurfaceModule = { mount: MountFn; meta?: SurfaceMeta }`.
- [`packages/shell/package.json:19-29`](../../../packages/shell/package.json#L19-L29) — React, react-dom, react-router-dom, react-i18next, i18next are `peerDependencies` of the shell; the participant workspace declares them as its own runtime `dependencies` (the same shape the moderator uses).

### Existing Playwright fixtures the spec relies on

- [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts) — provides the `authenticated` fixture that logs a Playwright `page` in via the OAuth handshake (or the screen-name-form workaround for new users) before the spec runs. The participant placeholder spec uses this directly — it does NOT need to also exercise the invite-claim flow; it only needs an authenticated user to satisfy the `SurfaceHost`'s `auth.status === 'authenticated'` precondition.
- Existing examples: [`tests/e2e/create-session-flow.spec.ts`](../../../tests/e2e/create-session-flow.spec.ts), [`tests/e2e/moderator-hover-details.spec.ts`](../../../tests/e2e/moderator-hover-details.spec.ts) — both use the auth fixture and assert testids inside the moderator surface mounted under `/m/*`. The participant placeholder spec follows the same pattern under `/p/*`.

## Constraints / requirements

### Workspace + build

- **Workspace location**: `apps/participant/` (already exists; this task replaces its contents). Package name `@a-conversa/participant`. Version `0.0.0`, `private: true`, `type: "module"`.
- **Build mode**: Vite library mode (`build.lib`) — ESM only (`formats: ['es']`). Bundle is a single file via `rollupOptions.output.inlineDynamicImports: true`. Single CSS sidecar via `cssCodeSplit: false`.
- **Output filenames**: `dist/participant-<hash>.js` (the entry bundle) + `dist/assets/participant-<hash>.css` (the style sidecar). Matches the moderator's pattern; the backend's `moduleFilePattern` / `styleFilePatterns` regexes in `resolveDefaultSurfaces` match these names.
- **Scripts** (`package.json`): `dev: vite`, `build: tsc -b && vite build`, `preview: vite preview`, `typecheck: tsc -b`.
- **No `index.html`** in `apps/participant/`. The surface is a library bundle, not an SPA; the root host renders the only `index.html` in the deploy.
- **No `apps/participant/src/main.tsx` `createRoot()` at module-load time.** All DOM bootstrapping happens inside `mount(props)` against `props.container`; the surface only acts when the host invokes it.

### Dependencies

- **Runtime `dependencies`**: `@a-conversa/shell` (workspace:*), `@a-conversa/i18n-catalogs` (workspace:*), `@a-conversa/shared-types` (workspace:^), `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@7.15.0`, `react-i18next@17.0.7`, `i18next@26.1.0`, `i18next-icu@2.4.3`. All version-pinned matching the moderator workspace ([`apps/moderator/package.json`](../../../apps/moderator/package.json#L12-L25)) — no new runtime dep is introduced beyond what the moderator already pulls in.
- **`devDependencies`**: `vite@8.0.12`, `@vitejs/plugin-react@6.0.1`, `tailwindcss@4.3.0`, `@tailwindcss/vite@4.3.0`. Same shape as the moderator workspace.
- **Removed dependencies** vs. the current stub: none — the stub's `i18next` / `i18next-icu` / `react-i18next` / `@a-conversa/i18n-catalogs` all stay (they are runtime peer-requirements of `@a-conversa/shell`'s React components, so the surface workspace's `node_modules` needs them resolvable at build time).
- **NOT added**: `zustand`, `@dagrejs/dagre`, `reactflow`, `cytoscape` — those land with the real participant UI in future leaves (`part_state_management`, `part_graph_view`, etc.). The skeleton stays narrow.

### Entrypoint shape (`apps/participant/src/main.tsx`)

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

const participantSurface: SurfaceModule = {
  mount,
  meta: {
    displayName: 'Participant',
    requiredAuthLevel: 'authenticated',
  },
};

export default participantSurface;
```

- `requiredAuthLevel: 'authenticated'` matches the moderator. The participant surface assumes an authenticated user; unauthenticated visitors are bounced to `/login` by the `SurfaceHost` before `mount()` is even called. (A future P-something feature for unauthenticated audience-style read of a public participant session would relax this, but is not in this leaf's scope.)
- The `props.i18n as I18nInstance` cast matches the moderator's pattern — the mount-contract's `I18n` interface is the structural floor; the canonical i18next type is wider, and the participant's `<I18nProvider>` needs the full type. Same single-line cast.
- The WS-store window-exposure trick from the moderator's `main.tsx` lines 36-55 is NOT replicated here. The participant has no Zustand store yet (state-management lands in `part_state_management`), and no Playwright spec needs a WS-store seed at this skeleton's e2e layer (the placeholder spec just confirms the bundle mounts).

### Placeholder UI (`apps/participant/src/App.tsx`)

```tsx
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function PlaceholderRoute(): ReactElement {
  const { t } = useTranslation();
  return (
    <main
      data-testid="route-participant-placeholder"
      className="mx-auto max-w-2xl p-6"
    >
      <h1 className="text-2xl font-semibold">{t('participant.placeholder.title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('participant.placeholder.body')}</p>
    </main>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="*" element={<PlaceholderRoute />} />
    </Routes>
  );
}
```

- The single wildcard route absorbs every URL inside `/p/*` (e.g. `/p/sessions/:id/invite?role=debater-A`, `/p/sessions/:id`, `/p/foo/bar`). Real participant routes replace this in `part_landscape_layout` / `part_session_join.part_invite_acceptance`.
- Two i18n keys: `participant.placeholder.title` ("Participant surface") + `participant.placeholder.body` ("Loading…"). Both land in en-US, pt-BR (PENDING), and es-419 (PENDING) catalogs; the latter two go in their `*.review.json` `pending` lists. A native-speaker review follow-up is registered (see "Tech-debt registration" below).
- The placeholder testid `route-participant-placeholder` is the Playwright + Vitest selector anchor — stable, surface-scoped name analogous to the moderator's `route-create-session`.

### Tailwind + index.css (`apps/participant/src/index.css`)

```css
/* Global stylesheet for the participant surface.
 *
 * Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
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

Identical to the moderator's reset; the participant inherits the same Tailwind v4 + `@tailwindcss/vite` build path.

### Backend wiring (`apps/server/src/routes/static-frontends.ts`)

Add (mirroring the moderator's existing entries):

```ts
const PARTICIPANT_DIST_DIR_ENV = 'PARTICIPANT_DIST_DIR';

function resolveParticipantDistDir(env: NodeJS.ProcessEnv): string {
  return resolveWorkspaceDistDir(env, PARTICIPANT_DIST_DIR_ENV, 'participant');
}

// inside resolveDefaultSurfaces():
{
  surfaceId: 'participant',
  urlPrefix: '/_surfaces/participant/',
  distDir: resolveParticipantDistDir(env),
  moduleFilePattern: /^participant-[A-Za-z0-9_-]+\.js$/,
  styleFilePatterns: [/^assets\/participant-[A-Za-z0-9_-]+\.css$/],
  label: 'participant',
},
```

- Same boot-time fail-fast applies (`discoverSingleFile` throws on zero or multiple matches). A misnamed participant bundle surfaces at server startup, not at first manifest fetch.
- The `discoverSingleFile` regression pins for zero-/multiple-match already exist (per the multi-surface refinement); this task does NOT duplicate them.

### Vitest regression pin (`apps/server/src/routes/static-frontends.test.ts`)

Append one new case (lower bound — author can add more if a specific behavior emerges during implementation):

- **`GET /_surfaces/manifest.json` lists the participant surface** — register the plugin with the default surface list (which, after this task, returns both moderator + participant), inject `GET /_surfaces/manifest.json`, parse the response body, assert `body.surfaces.participant.moduleUrl` matches `/_surfaces/participant/participant-<hash>.js` and `body.surfaces.participant.styleUrls[0]` (if present) matches `/_surfaces/participant/assets/participant-<hash>.css`. Uses `mkdtempSync` to build a fake participant dist tree (matching the moderator-fixture pattern).

### Vitest mount-boundary test (`apps/participant/src/mount.test.tsx`)

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('participant surface mount()', () => {
  it('mounts the participant route tree under the provided basename and returns an unmount fn', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: {
        userId: '00000000-0000-4000-8000-000000000002',
        screenName: 'ben',
      },
      refresh: () => undefined,
      logout: () => undefined,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.history.replaceState({}, '', '/p/sessions/00000000-0000-4000-8000-000000000099/invite?role=debater-A');

    const unmount = mount({
      container,
      auth,
      i18n: i18n as unknown as I18n,
      routerBasePath: '/p',
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-participant-placeholder')).toBeTruthy();
    });

    unmount();
    expect(container.innerHTML).toBe('');
  });
});
```

Mirrors [`apps/moderator/src/mount.test.tsx`](../../../apps/moderator/src/mount.test.tsx) exactly except for the surface name, the URL, and the testid.

### Root host route (`apps/root/src/App.tsx`)

One-line edit to the `<Routes>` block at lines 229-238, immediately above the `<Route path="*" element={<Navigate to="/" replace />} />` catch-all:

```tsx
<Route path="/p/*" element={<SurfaceHost surfaceId="participant" routerBasePath="/p" />} />
```

No other changes to `apps/root/src/App.tsx`. The `SurfaceHost` component already handles auth-gating + manifest loading + dynamic import + mount/unmount lifecycle.

### Files this task touches (the explicit allowlist)

- `apps/participant/package.json` (modified — widen deps, replace scripts).
- `apps/participant/vite.config.ts` (NEW — library-mode build config, mirroring the moderator's).
- `apps/participant/tsconfig.json` (modified — add the `packages/shell` project reference + `vite/client` types).
- `apps/participant/src/main.tsx` (NEW — the mount entrypoint).
- `apps/participant/src/App.tsx` (NEW — the placeholder route tree).
- `apps/participant/src/index.css` (NEW — Tailwind import + reset).
- `apps/participant/src/mount.test.tsx` (NEW — Vitest mount-boundary case).
- `apps/participant/src/index.tsx` (DELETED — current stub `export {};`).
- `apps/participant/src/i18n.ts` (DELETED — i18n is host-supplied per ADR 0026).
- `apps/root/src/App.tsx` (modified — one new `<Route path="/p/*" ...>` line).
- `apps/server/src/routes/static-frontends.ts` (modified — add `PARTICIPANT_DIST_DIR_ENV`, `resolveParticipantDistDir`, and the participant entry in `resolveDefaultSurfaces`).
- `apps/server/src/routes/static-frontends.test.ts` (modified — append one regression-pin case for the participant manifest entry).
- `Dockerfile` (modified — add `COPY --from=build /app/apps/participant/dist ./apps/participant/dist`).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — add `participant.placeholder.title` + `participant.placeholder.body`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` (modified — same, draft text).
- `packages/i18n-catalogs/src/catalogs/es-419.json` (modified — same, draft text).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` (modified — add the two dotted keys to `pending`).
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` (modified — same).
- `tasks/35-frontend-i18n.tji` (modified — register the `i18n_participant_placeholder_native_review` follow-up task).
- `tests/e2e/participant-skeleton-smoke.spec.ts` (NEW — Playwright placeholder spec).

### Files this task does NOT touch

- `.tji` files OTHER than `tasks/35-frontend-i18n.tji` — the `complete 100` marker for `part_app_skeleton` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42), not at refinement-write time.
- `docs/adr/` — no new ADR needed (every decision below is a direct application of an existing ADR or a scoped UI-implementation choice; see Decisions §6).
- `packages/shell/` — the shell substrate is consumed unchanged. Any widening of `AuthContextValue` / `MountProps` is the shell's own responsibility (its leaves under `shell_package`), not this task's.
- `apps/moderator/` / `apps/audience/` / `apps/root/src/surfaces/` (other than the one `App.tsx` route line) — the other surfaces and the `SurfaceHost` component itself stay as-is.
- `apps/server/src/server.ts` — registration order is unchanged; the static-frontends plugin's API stays the same.
- Any backend schema / migration / DB code — no DB story in this leaf.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

Three tiers, each pinning a different observable property:

1. **Vitest mount-boundary test** (`apps/participant/src/mount.test.tsx`) — proves the `mount()` export wires the React tree correctly under a host-supplied basename + auth + i18n, renders the placeholder testid, and the returned `UnmountFn` tears the container down. Catches regressions like "someone changed the mount signature and the moderator-mirrored shape silently broke."
2. **Vitest backend regression** (one new case in `apps/server/src/routes/static-frontends.test.ts`) — proves `GET /_surfaces/manifest.json` exposes the participant surface with the right URL shape after a `pnpm -F @a-conversa/participant build`. Catches "the surface entry was added to the plugin but the regex pattern doesn't match the actual filename."
3. **Playwright placeholder spec** (`tests/e2e/participant-skeleton-smoke.spec.ts`) — proves the end-to-end flow: a logged-in user navigates to a `/p/*` URL, the root host fetches the manifest, dynamic-imports the participant bundle, the surface mounts inside the basename-scoped router, the placeholder renders. This is the **UI-stream e2e per the policy in `ORCHESTRATOR.md`** — see "UI-stream e2e policy" below.

### UI-stream e2e policy

**E2e is in scope; scoped Playwright is the default.** The participant surface is **reachable** from a root route the moment this task lands its `/p/*` route + plugin entry, so the deferred-e2e exception in `ORCHESTRATOR.md` does NOT apply. The spec:

- Authenticates a Playwright `page` via the existing `authenticated` fixture from [`tests/e2e/fixtures/auth.ts`](../../../tests/e2e/fixtures/auth.ts).
- Navigates the page to `/p/sessions/<deterministic-uuid>/invite?role=debater-A` (the same URL shape the moderator's `InviteParticipants.tsx` emits).
- Asserts `data-testid="route-participant-placeholder"` is visible.
- Asserts the page title / first `<h1>` matches the en-US placeholder title ("Participant surface").
- One scenario, en-US only (cross-locale text is covered by the catalog parity check at the Vitest layer).

The spec uses the existing `make up` compose stack + the existing `pnpm run test:e2e` runner; no new Playwright project, no new fixture, no backend mock. It runs against the same Fastify server the moderator e2e specs hit.

A second Playwright scenario — "unauthenticated visitor on `/p/...` gets bounced to `/login` with the deep link remembered" — is NOT in this skeleton's scope; that behavior is `SurfaceHost`'s responsibility and is already pinned by the existing root-host e2e coverage (`tests/e2e/create-session-flow.spec.ts` exercises the same `rememberReturnTo` path under `/m/*`). Adding a `/p/*` mirror would duplicate coverage without pinning surface-specific behavior.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — the widened `apps/participant/package.json` deps resolve from the workspace lockfile; no new top-level pnpm install warnings beyond the pre-existing baseline.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — `tsc -b` from the workspace; the new `mount.tsx` / `App.tsx` / `mount.test.tsx` compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** and produces:
   - `apps/participant/dist/participant-<hash>.js` (single ESM bundle, hash-named).
   - `apps/participant/dist/assets/participant-<hash>.css` (CSS sidecar, hash-named, the Tailwind build output).
   - The `<hash>` is a non-empty base64-url string (`[A-Za-z0-9_-]+`), matching the backend's `moduleFilePattern` regex.
4. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new `.ts`/`.tsx` files are picked up by the existing `apps/**/*.{ts,tsx}` ESLint glob and the root tsconfig's project reference to `apps/participant`.
5. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+2** (one for the participant mount-boundary case, one for the manifest regression pin). The new Vitest cases match the cases-anchored shape described under Constraints → "Test layers."
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green after the catalog edits — the two new `participant.placeholder.*` keys are present in all three locales; pt-BR + es-419 land flagged PENDING.
7. **`pnpm -F @aconversa/root build` + `pnpm -F @a-conversa/moderator build` + `pnpm -F @a-conversa/participant build`** all green (preconditions for the e2e). The pre-commit hook's full build already runs the first two; this leaf adds the third.
8. **`pnpm run test:e2e`** under `make up` runs the new `tests/e2e/participant-skeleton-smoke.spec.ts` green. The spec completes in < 30s under the default Playwright timeout.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_app_skeleton` task block (and any milestone whose deps derive-complete) per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
10. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches."
11. **No backend route ambiguity introduced** — `GET /_surfaces/manifest.json` returns both `moderator` and `participant` entries; the existing moderator regression pins continue to pass unchanged.

## Decisions

### 1. Mirror the moderator workspace's library-mode shape exactly

Three alternatives surveyed:

- **(A) Bespoke library-mode config tuned for the participant's expected smaller bundle** (e.g. a different `entryFileNames` template, a different CSS strategy) — rejected. The moderator's `vite.config.ts` is the precedent that the static-frontends plugin's discovery patterns are already tuned for; deviating without cause would force a parallel discovery shape and bisect the architecture. The participant skeleton's bundle today is tiny — the placeholder is a few lines of JSX — so any optimization is premature.
- **(B) Custom shell wiring** (e.g. a thinner version of `AuthValueProvider` / `I18nProvider`) — rejected. The shell substrate is the canonical reuse seam ADR 0026 was written to enable; rolling a thinner local copy duplicates code and breaks the architecture's "single substrate" promise.
- **(C) Mirror the moderator (chosen).** Same `vite.config.ts` (renamed `moderator-` → `participant-`); same `main.tsx` (minus the WS-store window-exposure trick, which has no participant-side analog yet); same shell-provider stack; same Tailwind reset; same `tsconfig.json` (with the shell reference added). The mirror is faithful — the only intentional divergences are the surface name and the missing WS-store (because the participant has no Zustand store at this skeleton tier).

Cost of the mirror: ~80 lines of duplicated boilerplate (the vite config + the main.tsx scaffold). Benefit: each surface is independently auditable and the architecture stays uniform across surfaces; a future shared "surface-bootstrap" abstraction can be extracted later if the duplication compounds (e.g. when the audience surface lands).

### 2. The placeholder UI is a single wildcard route, not multiple stub routes

Two alternatives surveyed:

- **Pre-stub the planned participant routes** (`/sessions/:id/invite`, `/sessions/:id/lobby`, `/sessions/:id`) with separate placeholder components, so the route tree is already laid out — rejected. Pre-stubbing routes that don't have agreed shapes wastes effort and risks pinning incorrect path templates (the real `part_session_join.part_invite_acceptance` may use `useSearchParams` for `role` differently than I'd guess). The bootstrap's job is to prove the bundle mounts; the route shape is the next task's design decision.
- **One wildcard route rendering one placeholder** (chosen). Every URL under `/p/*` renders the same placeholder; future tasks replace the `<Routes>` body when they know their route shapes. The wildcard absorbs `/p/sessions/:id/invite?role=...` (the moderator's emit shape) without needing the skeleton to know the URL grammar.

Future tasks (`part_session_join.part_invite_acceptance`, `part_landscape_layout`) will replace the wildcard with their real route table. The data-testid `route-participant-placeholder` will disappear at that point (the e2e spec this task lands either gets updated by the consuming task or remains as a strict-regression pin against the no-placeholder change — author-choice during that task's implementation).

### 3. The participant surface registers via `resolveDefaultSurfaces`, not as an opt-in caller-passed entry

Two alternatives surveyed:

- **Caller-passed surface entry** — the server bootstrap (`apps/server/src/server.ts`) registers the static-frontends plugin with an explicit surfaces list that includes the participant. Rejected: the `serve_static_frontends_multi_surface` refinement made `resolveDefaultSurfaces` the canonical source of wired surfaces; opt-in lists are for tests that need bespoke fixtures, not for the production registration path. Bypassing the default-resolver would force a parallel registration channel for every new surface.
- **Add to `resolveDefaultSurfaces`** (chosen). Mirrors the moderator entry's shape. The plugin's default code path picks up the new entry without any server-bootstrap changes. The `serve_static_frontends_multi_surface` refinement's Acceptance §8 explicitly defers this wiring (and its regression pin) to this task; this decision honors the deferral.

### 4. No `participant.placeholder.*` keys land in the shell catalog; they land in the participant surface's catalog space

Two alternatives surveyed:

- **Land the placeholder keys under `shell.*` or `chrome.*`** (the shell already owns auth-chrome i18n keys) — rejected. Surface-specific UI text should live under the surface's namespace, not the shell's; otherwise the shell's catalog grows linearly with every per-surface placeholder.
- **Land under `participant.placeholder.*`** (chosen). The `participant.*` top-level namespace is a new sibling of the existing `moderator.*` namespace; it will grow as the participant surface's UI lands. Starting the namespace with two placeholder keys is fine — the namespace exists either way once the real UI lands.

The retired key from the predecessor moderator-lobby task (`moderator.invite.enterSession.hint`) is unrelated; this task does NOT touch the `moderator.*` namespace.

### 5. The e2e spec uses the existing `authenticated` fixture; no separate participant-auth fixture

Two alternatives surveyed:

- **Build a debater-specific Playwright fixture** that logs in as a debater Authelia user and lands them on a participant deep link — rejected. The skeleton's e2e only needs an authenticated user (any user); the role-specific claim flow is `part_session_join.part_invite_acceptance`'s concern, not this task's. The existing `authenticated` fixture covers the precondition.
- **Reuse the existing `authenticated` fixture** (chosen). Any Authelia-seeded user (alice, ben, etc.) satisfies `SurfaceHost`'s `auth.status === 'authenticated'` precondition; the placeholder doesn't care which user. The spec stays narrow and doesn't introduce new fixture coupling.

When `part_session_join.part_invite_acceptance` lands the real claim flow, a debater-specific fixture (or a moderator-creates-invite-then-debater-claims helper) may be useful then; the skeleton doesn't need it.

### 6. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- **A direct application of an existing ADR** — ADR 0026's library-mode + mount-contract + URL-prefix dispatch; ADR 0010's pnpm-workspaces shape; ADR 0022's no-throwaway-verifications.
- **A direct mirror of the moderator workspace** — same vite config, same main.tsx scaffold, same tsconfig project references, same Tailwind reset.
- **A scoped UI policy that doesn't constrain other tasks** — wildcard placeholder route (Decision §2), placeholder-keys namespace (Decision §4), reuse of the existing auth fixture (Decision §5).

The "no new dependencies" rule is satisfied: every runtime dep added to the participant `package.json` already exists in the moderator workspace. No new ADR is triggered.

### 7. Tech-debt registration

- **`frontend_i18n.i18n_participant_placeholder_native_review`** — pt-BR + es-419 native-speaker review of the two new `participant.placeholder.*` keys. Effort: 0.25d. Depends: `!i18n_session_lobby_native_review` (the immediate predecessor in the native-review chain). Mirrors the existing `i18n_session_lobby_native_review` task shape. **Action for Closer**: register this as a new WBS leaf in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) when the task completes.
- **No other follow-ups need registration.** The remaining `part_shell` group leaves (`part_state_management`, `part_landscape_layout`, `part_status_indicator`, `part_auth_flow`, `part_ws_client`) already exist as open WBS leaves with `depends !part_app_skeleton`; they pick up automatically. The `part_session_join.part_invite_acceptance` leaf already exists and will replace the wildcard placeholder route with the real claim flow when it lands.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Participant surface now builds as a library-mode Vite bundle (`apps/participant/vite.config.ts`) exporting the `MountFn`/`SurfaceModule` contract from `apps/participant/src/main.tsx`; dist emits `participant-<hash>.js` + `assets/participant-<hash>.css` matching the backend's discovery regexes.
- Placeholder route tree at `apps/participant/src/App.tsx` renders the `data-testid="route-participant-placeholder"` panel for every URL under `/p/*`; the stub `apps/participant/src/index.tsx` and the surface-owned `apps/participant/src/i18n.ts` are deleted in favor of host-supplied i18n per ADR 0026.
- Root host now dispatches `/p/*` to the participant surface via `<SurfaceHost surfaceId="participant" routerBasePath="/p" />` in `apps/root/src/App.tsx`; the same URL grammar the moderator emits from `InviteParticipants.tsx` now lands on the placeholder instead of redirecting to `/`.
- Backend registers the participant surface in `apps/server/src/routes/static-frontends.ts` (`PARTICIPANT_DIST_DIR_ENV`, `resolveParticipantDistDir`, new entry in `resolveDefaultSurfaces`); regression pin added in `apps/server/src/routes/static-frontends.test.ts` asserting the `participant` entry in `/_surfaces/manifest.json`; Dockerfile copies the participant dist into the runtime stage.
- Three test layers all green per ADR 0022: Vitest mount-boundary case at `apps/participant/src/mount.test.tsx` + manifest regression pin (3428 → 3430, +2); Playwright spec at `tests/e2e/participant-skeleton-smoke.spec.ts` under the new `chromium-participant-skeleton` project (46/46 passing, 594ms); all workspace builds (`@a-conversa/participant`, `@a-conversa/root`, `@a-conversa/moderator`, `@a-conversa/server`) green.
- Two new i18n keys (`participant.placeholder.title`, `participant.placeholder.body`) land in en-US, pt-BR, es-419; pt-BR + es-419 drafts flagged PENDING in `*.review.json`; native-speaker review registered as follow-up `frontend_i18n.i18n_participant_placeholder_native_review` in `tasks/35-frontend-i18n.tji`.
