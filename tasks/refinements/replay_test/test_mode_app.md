# Refinement — `replay_test.test_mode.test_mode_app`

**Test-mode app entry (separate URL / route).**

## TaskJuggler entry

- Task: `test_mode_app` — [`tasks/60-replay-and-test-mode.tji:72`](../../60-replay-and-test-mode.tji).
- Parent group: `test_mode` ([`tasks/60-replay-and-test-mode.tji:70`](../../60-replay-and-test-mode.tji)).
- Grandparent stream: `replay_test` ([`tasks/60-replay-and-test-mode.tji:22`](../../60-replay-and-test-mode.tji)).

## Effort estimate

**1d** ([`tasks/60-replay-and-test-mode.tji:73`](../../60-replay-and-test-mode.tji)). This is a surface-skeleton task — scaffold the workspace, wire the mount contract, register the bundle, render a placeholder. It carries no scrubber, no session-load, no graph render; those land in the downstream `test_mode_*` leaves.

## Inherited dependencies

`test_mode_app` declares no `depends` of its own. It inherits three edges through its ancestors:

- **`backend.backend_tests.be_e2e_tests.auth_flow_integration`** — *settled (Done)*. Inherited from the `replay_test` stream ([`tasks/60-replay-and-test-mode.tji:30`](../../60-replay-and-test-mode.tji); `complete 100` at [`tasks/20-backend.tji:447`](../../20-backend.tji)). The end-to-end OIDC handshake safety net the whole replay/test stream rides on. The test-mode surface is operator-facing and authenticated, so it sits behind that handshake.
- **`data_and_methodology.replay_primitive`** — *settled (Done)*. Inherited from the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji); children `project_at_position`, `position_navigation`, `snapshot_resolution` all `complete 100` at [`tasks/10-data-and-methodology.tji:573-587`](../../10-data-and-methodology.tji)). **Inherited but not consumed by this task.** The render-at-position primitive is consumed downstream by `test_mode_load_session` and `test_mode_timeline_scrubber`; the app-entry skeleton renders only a placeholder.
- **`audience.aud_graph_rendering`** — *settled (Done)*. Inherited from the `test_mode` group ([`tasks/60-replay-and-test-mode.tji:71`](../../60-replay-and-test-mode.tji); Cytoscape children `complete 100` at [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji)). **Inherited but not consumed by this task.** The graph renderer is consumed downstream once the scrubber drives a projected state into a viewport. The skeleton adds no graph dependency (no Cytoscape, no Zustand).

All inherited edges are settled; nothing this task needs is pending.

## What this task is

Create the **test-mode surface** as a new micro-frontend region under `apps/test-mode/`, mounted by the root host at the URL prefix `/t/*`, following the Vite-library-mode mount contract that ADR 0026 ([`docs/adr/0026-micro-frontend-root-app.md`](../../../docs/adr/0026-micro-frontend-root-app.md)) established and that the moderator, participant, and audience surfaces already implement. Concretely, the task delivers:

1. **The workspace** `apps/test-mode/` — `package.json` (`@a-conversa/test-mode`), `tsconfig`, `vite.config.ts` in library mode emitting a single hash-named ESM bundle + CSS sidecar (`test-mode-<hash>.js`, `assets/test-mode-<hash>.css`).
2. **The entrypoint** `apps/test-mode/src/main.tsx` — a `mount: MountFn` export and a default `SurfaceModule` whose `meta.requiredAuthLevel` is `'authenticated'`, bridging the host's `auth` + `i18n` into shell context inside a basename-scoped `<BrowserRouter basename={props.routerBasePath}>`, exactly mirroring [`apps/moderator/src/main.tsx:35-83`](../../../apps/moderator/src/main.tsx) and the participant surface.
3. **A placeholder `<App />`** (`apps/test-mode/src/App.tsx`) rendering a `data-testid="route-test-mode-placeholder"` element with an i18n title + body, so the surface is observably reachable but inert until the scrubber lands.
4. **Backend registration** — extend `resolveDefaultSurfaces()` in [`apps/server/src/routes/static-frontends.ts:269`](../../../apps/server/src/routes/static-frontends.ts) with a `test-mode` entry (plus the `TEST_MODE_DIST_DIR_ENV` constant + `resolveTestModeDistDir()` helper alongside the existing audience/participant helpers at [`static-frontends.ts:242-248`](../../../apps/server/src/routes/static-frontends.ts)), so `GET /_surfaces/manifest.json` exposes the bundle.
5. **Root dispatcher wiring** — add `<Route path="/t/*" element={<SurfaceHost surfaceId="test-mode" routerBasePath="/t" />} />` to [`apps/root/src/App.tsx:52`](../../../apps/root/src/App.tsx), after the `/a/*` audience route.
6. **i18n placeholder keys** in all three catalogs (`testMode.placeholder.title`, `testMode.placeholder.body`) plus the `.review.json` companions.
7. **Test layers** (per ADR 0022, below): a Vitest mount-boundary probe, a Vitest backend manifest regression pin, and a thin Playwright presence-smoke.
8. **Dockerfile** — a `COPY --from=build /app/apps/test-mode/dist ./apps/test-mode/dist` in the runtime stage.

## Why it needs to be done

`test_mode_app` is the root leaf of the entire `test_mode` group — every other test-mode leaf (`test_mode_load_session`, `test_mode_synthetic_session`, `test_mode_timeline_scrubber`, the inspectors, `test_mode_export_position`) declares `depends !test_mode_app` (directly or transitively, [`tasks/60-replay-and-test-mode.tji:76-111`](../../60-replay-and-test-mode.tji)). None of that downstream UI has a place to mount until this surface exists and is reachable at a URL. ADR 0026 anticipated exactly this surface (it reserved `apps/replay-test/` and a `/_surfaces/replay-test/` bundle slot in §2 + §4); this task realizes the seam under the more accurate `test-mode` name (see Decision §1).

The surface is the operator-side design-iteration / debugging / demoing tool — it lets one person scrub a recorded session's event log without three live participants. It is moderator-adjacent: an authenticated operator, not a public audience.

## Inputs / context

- **ADR 0026** — [`docs/adr/0026-micro-frontend-root-app.md`](../../../docs/adr/0026-micro-frontend-root-app.md). §1 (URL-prefix dispatch table — `/m`, `/p`, `/a`; the replay/test surface was named but not assigned a letter), §2 (Vite library-mode `mount(props): UnmountFn` + `SurfaceModule` contract), §3 (what lives in root vs shell vs surface), §4 (backend `serve_static_frontends` serves bundles + manifest under `/_surfaces/*`). The replay/test surface is listed as a planned region in §2 and reserved in the `/_surfaces/{…,replay-test}` enumeration in §4.
- **Mount contract + shell exports** — `@a-conversa/shell` re-exports `MountFn`, `MountProps`, `SurfaceModule`, `SurfaceMeta`, `AuthValueProvider`, `I18nProvider`, `I18nInstance`. Same imports the moderator entry uses ([`apps/moderator/src/main.tsx:23-29`](../../../apps/moderator/src/main.tsx)).
- **Reference entrypoint (authenticated)** — [`apps/moderator/src/main.tsx:35-83`](../../../apps/moderator/src/main.tsx): the `mount` closure creates its own React root, wraps `<I18nProvider>` → `<AuthValueProvider>` → `<BrowserRouter basename={props.routerBasePath}>` → `<App />`, returns an `UnmountFn`, and the default `SurfaceModule` sets `meta.requiredAuthLevel: 'authenticated'`. The participant surface mirrors this shape with no URL-locale read — the closest analog for test-mode.
- **Reference entrypoint (public + URL-locale)** — the audience surface (`apps/audience/src/main.tsx`, `apps/audience/src/App.tsx`) sets `requiredAuthLevel: 'public'` and reads locale from the URL prefix via `negotiateUrlLocale()`. Test-mode does **not** follow this; it follows the authenticated/cookie-negotiated pattern (Decision §3).
- **Root dispatcher** — [`apps/root/src/App.tsx:43-55`](../../../apps/root/src/App.tsx): the `<Routes>` table maps `/m/*`, `/p/*`, `/a/*` to `<SurfaceHost surfaceId=… routerBasePath=… />`. The new `/t/*` route goes here (line 52, after `/a/*`).
- **Surface host** — [`apps/root/src/surfaces/SurfaceHost.tsx:96-102`](../../../apps/root/src/surfaces/SurfaceHost.tsx) resolves `meta.requiredAuthLevel` after dynamic-import and, when `'authenticated'` and the user is not, deflects to `/login` / `/screen-name` ([`SurfaceHost.tsx:149-157`](../../../apps/root/src/surfaces/SurfaceHost.tsx)) before `mount()` is ever called. The mounted surface renders into the basename-scoped container `<div>` ([`SurfaceHost.tsx:179-185`](../../../apps/root/src/surfaces/SurfaceHost.tsx)). No `SurfaceHost` change is needed — `surfaceId: 'test-mode'` flows through the existing manifest path.
- **Manifest shape** — [`apps/root/src/surfaces/manifest.ts:3-10`](../../../apps/root/src/surfaces/manifest.ts): `SurfaceManifest = { surfaces: Record<string, { moduleUrl, styleUrls? }> }`, keyed by `surfaceId`.
- **Backend surface registry** — [`apps/server/src/routes/static-frontends.ts:269-312`](../../../apps/server/src/routes/static-frontends.ts): `resolveDefaultSurfaces()` returns a hardcoded array of `{ surfaceId, urlPrefix, distDir, moduleFilePattern, styleFilePatterns, label }`. Env-override dist-dir helpers at [`static-frontends.ts:242-248`](../../../apps/server/src/routes/static-frontends.ts). The plugin discovers the hashed filename at boot via the regex and fails fast on zero/multiple matches; the manifest endpoint is served at [`static-frontends.ts:639-645`](../../../apps/server/src/routes/static-frontends.ts).
- **Backend multi-surface task** — [`tasks/refinements/backend/serve_static_frontends_multi_surface.md`](../backend/serve_static_frontends_multi_surface.md) (Done 2026-05-16) established that adding a surface is "a one-line entry to `resolveDefaultSurfaces` once each workspace's `vite.config.ts` emits `<surface>-<hash>.js`." This task pays that single line.
- **Sibling skeletons (the template)** — [`tasks/refinements/audience/aud_app_skeleton.md`](../audience/aud_app_skeleton.md) and `tasks/refinements/participant-ui/part_app_skeleton.md`. They define the exact deliverable shape: workspace + vite lib config + `mount.tsx` + `SurfaceModule` + placeholder `App` + `mount.test.tsx` + `resolveDefaultSurfaces` entry + Vitest manifest regression + Dockerfile `COPY` + root `/x/*` route + a scoped Playwright presence-smoke. This refinement is the test-mode analog and follows them line-for-line.
- **Existing stub** — there is **no** `apps/test-mode/` or `apps/replay-test/` directory today; the workspace is created from scratch (copy the participant skeleton's shape).

## Constraints / requirements

1. **ADR 0026 mount contract, no deviation.** Library-mode Vite build, single hash-named ESM bundle + CSS sidecar, no own `index.html`, no own `createRoot` bootstrap outside the exported `mount`. `mount` returns an `UnmountFn` that calls `root.unmount()`.
2. **Authenticated surface.** `meta.requiredAuthLevel: 'authenticated'`. The `SurfaceHost` gates unauthenticated visitors to `/login` before `mount()` runs; the surface assumes an authenticated operator.
3. **No new runtime dependencies.** Pin `@a-conversa/shell`, `@a-conversa/i18n-catalogs`, `@a-conversa/shared-types`, `react`, `react-dom`, `react-router-dom`, `react-i18next`, `i18next`, `i18next-icu` at the exact versions the participant/audience workspaces use. **Not added**: `cytoscape`, `zustand`, `@dagrejs/dagre`, `reactflow` — those land with the real scrubber/graph leaves downstream.
4. **Backend registration is in-task, via `resolveDefaultSurfaces`** (not a caller-passed opt-in entry). Add `TEST_MODE_DIST_DIR_ENV`, `resolveTestModeDistDir()`, and the `test-mode` entry with `moduleFilePattern: /^test-mode-[A-Za-z0-9_-]+\.js$/` and `styleFilePatterns: [/^assets\/test-mode-[A-Za-z0-9_-]+\.css$/]`. The boot-time fail-fast on zero/multiple matches already exists; do not duplicate those pins.
5. **No backend route ambiguity.** `/t/*` is a fresh prefix; it collides with no API route (`/api/*`) and no existing surface prefix (`/m`, `/p`, `/a`).
6. **Placeholder is observable and localized.** The placeholder renders `data-testid="route-test-mode-placeholder"` and reads `testMode.placeholder.title` / `testMode.placeholder.body` from the catalog. Catalog parity (`pnpm --filter @a-conversa/i18n-catalogs run check`) must stay green after the key additions, including the `.review.json` companions.
7. **Locale via the host i18n instance, not URL prefix.** The surface consumes the `i18n` the host passes into `mount()` (authenticated negotiation already done upstream). It does **not** parse a `/{locale}/…` URL segment (Decision §3).
8. **Build green across the workspace set.** `pnpm -F @a-conversa/test-mode build` plus the existing root/moderator/participant/audience builds all stay green; `pnpm run check` (lint + format + typecheck) stays green.

## Acceptance criteria

Per ADR 0022, every empirical check below is a committed test — no throwaway verification.

1. **`pnpm install` clean**, and **`pnpm -F @a-conversa/test-mode typecheck`** exits zero.
2. **`pnpm -F @a-conversa/test-mode build`** exits zero and produces `apps/test-mode/dist/test-mode-<hash>.js` (single ESM bundle) and `apps/test-mode/dist/assets/test-mode-<hash>.css` (CSS sidecar), where `<hash>` is a non-empty `[A-Za-z0-9_-]+` string matching the backend `moduleFilePattern`.
3. **Vitest mount-boundary probe** (`apps/test-mode/src/mount.test.tsx`) — proves `mount()` wires the React tree under a host-supplied `routerBasePath` + `auth` + `i18n`, renders `data-testid="route-test-mode-placeholder"`, and the returned `UnmountFn` tears the container down. Mirrors `apps/moderator/src/mount.test.tsx`.
4. **Vitest backend manifest regression** (one new case in `apps/server/src/routes/static-frontends.test.ts`) — registers the plugin with the default surface list (now moderator + participant + audience + test-mode), injects `GET /_surfaces/manifest.json`, and asserts `body.surfaces['test-mode'].moduleUrl` matches `/_surfaces/test-mode/test-mode-<hash>.js` and the style URL (if present) matches `/_surfaces/test-mode/assets/test-mode-<hash>.css`. Uses `mkdtempSync` to build a fake dist tree, matching the audience/participant fixture pattern.
5. **`pnpm run test:smoke`** stays green; the smoke count grows by at least **+2** (the mount-boundary case + the manifest regression pin).
6. **Playwright presence-smoke** (`tests/e2e/test-mode-skeleton-smoke.spec.ts`) — **e2e is in scope, not deferred** (see Decision §4). Under `make up` + `pnpm run test:e2e`: (a) an authenticated user navigates to `/t/sessions/<deterministic-uuid>`, the root host fetches the manifest, dynamic-imports the test-mode bundle, mounts it in the basename-scoped router, and `data-testid="route-test-mode-placeholder"` is visible with the en-US placeholder title; (b) one assertion that an **unauthenticated** visit to `/t/sessions/<uuid>` deflects to `/login` (the `requiredAuthLevel: 'authenticated'` gate). One spec, en-US only, completes in < 30s, no new fixture or backend mock.
7. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity) green after the `testMode.placeholder.*` key additions.
8. **`pnpm -F @a-conversa/root build` + moderator + participant + audience + test-mode builds** all green; `GET /_surfaces/test-mode/test-mode-<hash>.js` reachable through the Fastify server.
9. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"`** silent after `complete 100` is added (closer step).
10. **No file modifications outside the explicit task allowlist**; no backend route ambiguity introduced.

**No Cucumber scenario.** The placeholder route reads no WS events and emits no envelopes — there is no observable behavior at the protocol or replay seam for this skeleton (the backend replay endpoints it will eventually call already have their own Cucumber/Vitest coverage). The Vitest backend manifest case is the right pin for the one backend-observable change (the new manifest entry).

## Decisions

### §1 — Surface name `test-mode` (prefix `/t/*`), not ADR 0026's reserved `replay-test`

ADR 0026 reserved the name `replay-test` for a single combined surface (`apps/replay-test/`, `/_surfaces/replay-test/`). The WBS that crystallized afterward splits the stream into two groups with different homes: the **replay viewer** (`replay_test.replay_ui.replay_mode_audience_surface`) is explicitly "a replay-mode *variant of the audience surface*" served at `/{locale}/replay/{id}` "mirroring the audience surface" ([`tasks/60-replay-and-test-mode.tji:33-41`](../../60-replay-and-test-mode.tji)) — i.e., it folds into the audience bundle and its `/a` prefix, reusing the same Cytoscape renderer with a log-replay input. That leaves **test-mode** as the only *standalone* surface this stream needs.

**Chosen:** name the new surface `test-mode`, mount it at `/t/*`, register it as `surfaceId: 'test-mode'`. **Rejected — `replay-test`:** the combined name is now misleading (replay lives in the audience surface, not here) and would imply a bundle that hosts replay too. **Rejected — reuse `/a` for test-mode:** the audience surface is public (`requiredAuthLevel: 'public'`); test-mode is an authenticated operator tool with a different auth gate and a different (scrubber-driven, not live-stream) interaction model. A distinct prefix keeps the auth contract and the bundle boundary clean.

This is a naming refinement *within* ADR 0026's existing micro-frontend seam — no new dependency, no new architectural seam — so it is documented here rather than in a new ADR. ADR 0026's incidental `replay-test` reservation is superseded by this split; reconciling that wording into ADR 0026 (an Amendment line) is a doc-hygiene call surfaced for the parking lot, not encoded as a WBS task.

### §2 — New micro-frontend surface, not a route inside an existing app

**Chosen:** a standalone `apps/test-mode/` library-mode bundle, dynamically imported by the root host. **Rejected — a route inside `apps/moderator/`:** test-mode would pull the moderator's full React-Flow + Zustand + Dagre stack into a tool that doesn't need the live operator console, and would muddy the moderator's auth/route surface. ADR 0026's whole thesis is that the surface boundary is the enforceable code-splitting seam (Consequences + Alternative C1); a separate bundle keeps the scrubber's eventual graph stack isolated from the moderator's.

### §3 — Authenticated locale negotiation, no URL-prefix locale segment

The audience/replay surfaces read locale from the URL (`/{locale}/…`) because they may render inside a cookie-less OBS browser source representing no human user. Test-mode is the opposite: an authenticated operator with a session and a negotiated locale already resolved by the host. **Chosen:** consume the host-passed `i18n` instance directly (the moderator/participant pattern), no `negotiateUrlLocale()` call, no `/{locale}/…` route. **Rejected — URL-prefix locale:** adds a route variant and a basename-strip dance for zero benefit; the operator's locale is already negotiated via cookie/`navigator.languages` upstream.

### §4 — E2e is in scope (scoped Playwright presence-smoke), not deferred

The UI-stream e2e policy's deferral exception applies only when *no route renders the component and no event surface drives it*. The moment this task lands the `/t/*` route + the manifest entry + the placeholder, the surface **is reachable** — a logged-in user hitting `/t/sessions/:id` mounts it. So per the policy ("Read 'not yet reachable' strictly"), a thin Playwright presence-smoke asserting placeholder-presence + the auth-gate redirect is the correct call, exactly as the audience and participant skeletons did. Full deferral to a future `*_pw_*` task is **not** warranted here.

**Snapshot-list e2e debt does not land on this task.** `snapshot_list_ui` and `snapshot_jump_ui` forwarded their deferred list-render→click→jump Playwright debt to the first surfaces that *mount the snapshot list* — `replay_test.replay_ui.replay_chapter_jumping` and `replay_test.test_mode.test_mode_timeline_scrubber`, **not** the bare app entry. This skeleton mounts no snapshot list, so it inherits none of that debt; the debt remains correctly aimed at `test_mode_timeline_scrubber`.

### §5 — Backend registration in-task via `resolveDefaultSurfaces`

**Chosen:** add the `test-mode` entry to `resolveDefaultSurfaces()` (plus its env-override helper), in this task. **Rejected — defer to a backend follow-up:** the multi-surface plugin task ([`serve_static_frontends_multi_surface.md`](../backend/serve_static_frontends_multi_surface.md)) explicitly designed surface-add as a one-line registry extension; splitting it into a separate backend leaf would leave the surface unreachable (no manifest entry) and the e2e un-runnable. The audience and participant skeletons both registered their own backend entry in-task; test-mode matches.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-05.

- Created `apps/test-mode/` workspace: `package.json` (`@a-conversa/test-mode`), `tsconfig.json`, `vite.config.ts` (library mode, hash-named ESM bundle + CSS sidecar).
- Added `apps/test-mode/src/main.tsx` (`mount: MountFn` + `SurfaceModule` with `requiredAuthLevel: 'authenticated'`, `BrowserRouter basename`) and `apps/test-mode/src/App.tsx` (placeholder rendering `data-testid="route-test-mode-placeholder"` with i18n title/body).
- Extended `apps/server/src/routes/static-frontends.ts` with `TEST_MODE_DIST_DIR_ENV`, `resolveTestModeDistDir()`, and `test-mode` entry in `resolveDefaultSurfaces()` (moduleFilePattern + styleFilePatterns).
- Added `/t/*` route wiring `<SurfaceHost surfaceId="test-mode" routerBasePath="/t" />` in `apps/root/src/App.tsx`.
- Added i18n keys `testMode.placeholder.title` / `testMode.placeholder.body` to `en-US.json`, `pt-BR.json`, `es-419.json`, plus `.review.json` companions for pt-BR and es-419.
- Vitest: `apps/test-mode/src/mount.test.tsx` (mount-boundary probe) + new manifest regression case in `apps/server/src/routes/static-frontends.test.ts`; smoke count +2.
- Playwright: `tests/e2e/test-mode-skeleton-smoke.spec.ts` — authenticated placeholder-presence + unauthenticated `/login` deflection.
- Updated `Dockerfile` to copy `apps/test-mode/package.json` in `deps`/`runtime` stages and `apps/test-mode/dist` in runtime stage; added `apps/test-mode` project reference to root `tsconfig.json`; added `chromium-test-mode-skeleton` project to `playwright.config.ts`.
