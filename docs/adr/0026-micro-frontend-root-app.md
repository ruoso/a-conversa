# 0026 — Micro-frontend root app with lazy-loaded surface bundles

- **Date**: 2026-05-16
- **Status**: Accepted

## Context

`a-conversa` plans four React/TypeScript UI surfaces — moderator, participant tablet, audience/broadcast, and replay/test — each currently scoped (per [ADR 0003](0003-frontend-framework-react.md) + [ADR 0010](0010-directory-layout-pnpm-workspaces.md)) as a standalone single-page application under `apps/<surface>/`, with its own `index.html`, its own React DOM bootstrap, its own auth chrome (login + OAuth callback + screen-name capture + logout), and its own server static-serve fallback (per `backend.api_skeleton.serve_static_frontends`). The moderator surface landed first under this shape; the participant + audience + replay surfaces have not yet been built but were planned as parallel standalone SPAs.

Three pressures cracked the implicit assumption:

1. **Auth chrome is shared.** Every surface needs `/login`, the OAuth round-trip, the first-time `/screen-name` capture, and `/logout`. Building each surface's chrome independently means writing — and translating, and theming, and securing — the same flow four times. The first reuse seam came up during the just-landed `mod_invite_participants` work, where the participant surface (not yet built) will need an auth-then-claim flow on the same domain as the moderator's invite URL; copying the moderator's auth code into the participant app at build time is the wrong reuse mechanic.
2. **A thin unauthenticated landing surface is on the roadmap.** A future visitor browsing `https://a-conversa.example/` (no path) should see a marketing-thin landing page that loads quickly — ideally without paying the bundle cost of the moderator's full React-Flow + Zustand + Dagre stack or the audience's full Cytoscape build. Under the "every surface is its own SPA" architecture there is no surface for `/` at all; whichever surface the static-serve plugin happens to fall back to renders.
3. **The server-side static-serve plugin needs to know which `index.html` to send for a given path.** With four SPAs each owning their own routes, the plugin's "fall through to SPA index.html" path is ambiguous — `/sessions/:id/lobby` could be a moderator route or a participant route. The just-landed `serve_static_frontends_path_collision_fix` workaround (forcing `/sessions/new/setup` instead of `/sessions/new` because the API's `GET /sessions/:id` UUID-validator caught `new`) is a symptom of the same shape problem: there is no architectural seam between "where backend API routes live" and "where surface routes live."

The four sub-decisions below settle the architecture; the alternatives surveyed are documented under "Alternatives considered."

## Decision

The frontend pivots to a **micro-frontend architecture** with a thin root app at `apps/root/` that dynamically imports surface bundles by URL prefix. The four sub-decisions:

### 1. Dispatch trigger: URL prefix

A short URL prefix per surface, dispatched by the root app on first paint:

| Path prefix | Surface |
| --- | --- |
| `/`, `/login`, `/screen-name`, `/logout` | Root app (auth chrome + landing) |
| `/m/sessions/:id/*` | Moderator |
| `/p/sessions/:id/*` | Participant |
| `/a/sessions/:id/*` | Audience |

Prefix dispatch is bookmarkable (the URL identifies the surface), cacheable (the server can hint long-lived bundle caching keyed on the surface manifest), and avoids a per-navigation role-lookup round trip to the server (the URL declares the surface; the server validates the session-role match once at API call time). The existing moderator routes — `/sessions/new`, `/sessions/:id/setup`, `/sessions/:id/invite`, `/sessions/:id/lobby` — all move under `/m/*` (becoming `/m/sessions/new`, `/m/sessions/:id/setup`, etc.).

The just-landed `mod_invite_participants` refinement bakes in unprefixed invite URLs (`/sessions/:id/invite?role=debater-A`); that gets corrected as part of the moderator-refactor task created alongside this ADR. New invite links land under `/p/sessions/:id/invite?role=debater-A` (the invite is a participant-facing entry point, so the prefix is `/p/*`).

### 2. Surface build output: Vite library mode

Each surface (`apps/moderator/`, `apps/participant/`, `apps/audience/`, `apps/replay-test/`) builds via **Vite library mode** to a single ESM bundle plus its CSS sidecar. No own `index.html`. No own React DOM `createRoot()` bootstrap. No own surface-level router instance. Each bundle exports a `mount(props): UnmountFn` function plus a default `SurfaceModule` shape:

```ts
type MountProps = {
  container: HTMLElement;
  basename: string;        // the prefix the root mounted us at, e.g. "/m"
  authContext: AuthContextValue;  // the root's auth instance, passed in
  i18n: i18n;              // shared i18next instance
  wsClient: WsClient;      // shared WS client
};

type UnmountFn = () => void;

type SurfaceModule = {
  mount(props: MountProps): UnmountFn;
};
```

The root reads a runtime manifest (`/_surfaces/manifest.json`) and dynamic-imports the bundle URL by prefix; the bundle exports its `mount()`; the root calls it with a basename-scoped router and the shared service handles. On URL change to a different prefix, the root calls the returned `UnmountFn` then mounts the next surface. No module-federation tooling — plain ESM + manifest.

### 3. What lives where

- **`apps/root/`** (new) — the thin root app:
  - Auth chrome routes (`/login`, `/screen-name`, `/logout`).
  - Landing route at `/` (authenticated + unauthenticated states).
  - The URL-prefix dispatcher (the React tree that mounts on a prefix match and calls the surface's `mount()`).
  - Top-level providers: `BrowserRouter`, `AuthProvider` (from shell), `I18nextProvider` (from shell).
  - The asset-manifest loader for surface bundles.
  - `/auth/callback` handling that reads a `return_to` query parameter and routes accordingly post-auth (so a participant clicking an invite link lands back at their invite page after auth).

- **`packages/shell/`** (new) — the shared substrate consumed by both the root and every surface:
  - Mount-contract types (`MountProps`, `UnmountFn`, `SurfaceModule`).
  - `useAuth` hook + `AuthContext` provider + `LoginButton` + `logout()` helper + `<ScreenNameForm>` component (all extracted from `apps/moderator/src/auth/` + `apps/moderator/src/routes/`).
  - Shared i18next instance bootstrap (consumes `@aconversa/i18n-catalogs`).
  - Shared WebSocket client (extracted from `apps/moderator/src/ws/client.ts`).
  - Shared `ApiError` code → i18n-key mapper (extracted from the moderator's existing `errorCodeToI18nKey` helpers in `apps/moderator/src/routes/CreateSession.tsx` and `apps/moderator/src/routes/ScreenName.tsx`).

  Both `apps/root/` and every `apps/<surface>/` depend on `@aconversa/shell` via the pnpm workspace ([ADR 0010](0010-directory-layout-pnpm-workspaces.md)).

- **`apps/moderator/`, `apps/participant/`, `apps/audience/`, `apps/replay-test/`** — each becomes a "region" / mountable library. No own `index.html`, no own `main.tsx` DOM bootstrap, no own auth code. Each imports auth + i18n + WS context from `@aconversa/shell`, declares routes relative to the basename the root passes in, and mounts a region-scoped React subtree.

### 4. Backend changes

- The Fastify `serve_static_frontends` plugin extends to:
  - Serve `apps/root/dist/index.html` for all non-API, non-`/_surfaces/*` paths (replacing today's per-surface fallback).
  - Serve `apps/root/dist/assets/*` for root's chunked assets.
  - Serve surface bundles under `/_surfaces/{moderator,participant,audience,replay-test}/[hash].js` (and their CSS sidecars) with long-lived cache headers.
  - Serve `/_surfaces/manifest.json` mapping each surface to its current hashed bundle URL. The root reads this at boot.

- `/auth/callback`'s post-auth redirect target becomes the root's `/` with a `return_to=<url>` query parameter so a debater clicking an invite link returns to their invite page after authenticating. The participant surface reads `return_to` and routes accordingly.

## Consequences

- **Auth chrome single-sources.** Login, OAuth-callback, screen-name capture, and logout exist once (in `packages/shell/` + `apps/root/`) instead of being re-implemented per surface. Participant and audience get auth "for free" by depending on `@aconversa/shell` — no auth code in their bundles.
- **Existing moderator routes change shape.** All moderator paths migrate from unprefixed `/sessions/:id/*` to `/m/sessions/:id/*`. The just-landed `mod_invite_participants` refinement (`tasks/refinements/moderator-ui/mod_invite_participants.md`) bakes in unprefixed invite URLs and gets corrected as part of the moderator-refactor task added by this restructure pass (`moderator_ui.mod_extract_to_mountable_library`). All moderator Playwright tests update for the new prefix.
- **Net code change is meaningful but bounded.** The moderator's existing `apps/moderator/src/auth/useAuth.ts`, `routes/ScreenName.tsx`, `routes/Login.tsx`, the `RequireAuth` wrapper, and the relevant chunk of `App.tsx` get deleted from the moderator workspace and moved into `packages/shell/`. The moderator's `apps/moderator/src/ws/client.ts` similarly moves. Net new code (root + shell scaffolding) is small; net code-change including the refactor pass is meaningful (~3d of moderator restructure + ~3d of shell + ~3d of root, planned under the new task groups).
- **Code-splitting at the surface boundary becomes structural.** Adding a new surface — a future unauthenticated landing, a marketing page, an admin surface — is now a matter of adding a `packages/landing-page/`-shaped bundle + a manifest entry, not refactoring discipline inside a unified SPA. The structural seam enforces the bundle isolation.
- **Backend `serve_static_frontends` plugin needs a small update.** A new leaf task `backend.api_skeleton.serve_static_frontends_multi_surface` extends the plugin to serve the root for non-API paths + the surface bundles + the manifest under `/_surfaces/*`. The existing `serve_static_frontends_path_collision_fix` workaround becomes obsolete-but-harmless (the `/sessions/new` collision goes away once the moderator routes move under `/m/*`); no removal is forced.
- **Server-side path ambiguity goes away.** The server knows that `/m/*` is the moderator surface and `/p/*` is the participant surface; the `/sessions/:id` API endpoint lives at `/api/sessions/:id` (or stays at its current path under a different surface's prefix — settled in the multi-surface task's refinement). The "is this a SPA route or an API route?" question is answered by the URL prefix.
- **No new ADR-tier dependencies.** The root, shell, and surface workspaces all reuse existing top-level dependencies (React, react-router-dom, react-i18next per [ADR 0024](0024-frontend-i18n-react-i18next-with-icu.md), Vite). No module-federation library, no new build tool. The Vite library-mode build is a configuration of an existing build tool.
- **Tested through committed Vitest + Playwright cases** per [ADR 0022](0022-no-throwaway-verifications.md). The shell package gets a vitest suite (`shell_tests` leaf); the root app gets vitest + a Playwright smoke (`root_tests` leaf) exercising `/login` → `/screen-name` → `/` for a new user; the moderator's existing Playwright suite updates for the new path prefix as part of the refactor task.
- **Two ADRs receive Amendment lines** (per the amendment-pass rule in [docs/adr/README.md](README.md)): ADR 0003 (frontend framework) and ADR 0010 (pnpm workspaces) — each gets a 2026-05-16 Amendment entry pointing here. Decision and Context sections remain untouched.

## Alternatives considered

- **Shape A — auth-only root app, surfaces keep current paths.** A root app at `/login`/`/screen-name`/`/logout` only, with each surface staying at its current unprefixed path (`/sessions/:id` belongs to moderator). Rejected: doesn't solve the future-bundling problem (no surface for `/`), doesn't solve the server-side path-ambiguity problem (still need a per-surface fallback), and loses the architectural seam that makes adding new surfaces tractable. The root-app-with-only-auth has all the cost of building a root app and almost none of the benefit.
- **Shape C1 — single SPA, role-dispatched at component level.** One `apps/web/` SPA containing all four surfaces' code, dispatching to the right component tree based on the authenticated user's role for the current session. Rejected: code-splitting discipline rarely holds long-term in a unified SPA without structural enforcement; the audience surface's bundle-sensitivity ([ADR 0024](0024-frontend-i18n-react-i18next-with-icu.md) Consequences) makes "audience visitor accidentally loads the moderator's Zustand store" a real risk; and a future unauthenticated landing visitor would still pull at least one surface's React tree into memory. Structural boundary at the surface level is more enforceable than discipline.
- **Shape C3 — server-side dispatch on `/sessions/:id/*`.** The server inspects the authenticated user's role for the session at the `/sessions/:id` URL and 302s them to the right surface bundle. Rejected: per-navigation role lookup is a round trip on every link click; bookmarks are ambiguous (the same URL renders differently depending on the user's role at that moment in time); and the audience case — which is unauthenticated for public sessions — has no role-lookup path at all.
- **Module federation (Webpack 5 / Vite federation plugin) instead of plain Vite-library + manifest.** Federation tooling that lets the root dynamically discover and load surface bundles. Rejected: federation tooling overhead is unjustified for in-monorepo bundles that all build and deploy together; the runtime manifest + ESM `import()` pattern is simpler, has no extra build-tool dependency, and is debuggable with browser devtools alone. Federation makes sense when bundles ship from independent origins (different teams, different deploy cadences); not our shape.
- **Shared package only, no root app (the original "extract auth into a package" suggestion).** Just create `packages/shell/` and have each surface depend on it; no root app. Rejected: doesn't solve "what mounts at `/` for an unauthenticated visitor?" or "which app's HTML does the server send for `/sessions/:id`?" The package-only path settles the code-reuse problem but leaves both the bundling and the routing problems open.

## Stack-validation tests

Per [ADR 0022](0022-no-throwaway-verifications.md), no throwaway smoke script lands at the ADR layer. The architecture lands behind the real wiring inside `packages/shell/`, `apps/root/`, and the moderator-refactor task, with the test contracts spelled out in the per-leaf refinements under `tasks/refinements/shell-package/`, `tasks/refinements/root-app/`, and the updated `tasks/refinements/moderator-ui/mod_extract_to_mountable_library.md`. Coverage shape:

- `packages/shell/` — Vitest unit tests for the auth context, screen-name form, login/logout helpers, i18n bootstrap, WS client, and error mapper. No browser tests at the package layer; each consumer's Playwright suite exercises the shell in-browser.
- `apps/root/` — Vitest unit tests for the dispatcher, manifest loader, and providers; a Playwright smoke for `/login` → `/screen-name` → `/` for a new user.
- `apps/moderator/` (refactor) — the existing Playwright suite migrates to the `/m/*` path prefix and exercises the root → moderator mount handoff.

## Amendments

- **2026-06-06 — `/home` folded back into `/`.** Decision §3 listed the root's landing route at `/` as serving "authenticated + unauthenticated states", but the `split_public_and_home_routes` refinement split the authenticated state into a separate `/home` dashboard. That dashboard offered only what `/` already carries — the create-session affordance (in `CallToActionSection`) — so `/home` was removed and its sole non-visual job (read-and-clear of the `SurfaceHost` deep-link return-to) moved into `LandingRoute`'s authenticated branch. `LoginRoute`/`ScreenNameRoute`'s `resolvePostAuthTarget` fallback changed from `/home` to `/`, and `CallToActionSection` now renders an auth-appropriate secondary action (SSO `LoginButton` for anonymous, `/logout` link for authenticated). The route table in `apps/root/src/App.tsx` drops the `/home` route; a stale `/home` bookmark falls through the catch-all `*` route to `/`. This restores Decision §3's original "`/` serves both states" intent; the operational route table above is updated in place. A future authenticated-only home enrichment (e.g. a past-sessions list) lands on `/` rather than re-introducing a second route.
