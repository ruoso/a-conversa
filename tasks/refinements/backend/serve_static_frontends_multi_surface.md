# Extend static-frontends plugin to serve root app + per-surface bundles (ADR 0026)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji#L63) — task `backend.api_skeleton.serve_static_frontends_multi_surface`
**Effort estimate**: 0.5d (as registered in the WBS — most of the implementation already landed inside `root_app.root_moderator_cutover`; this leaf formalizes the contract, the regression-pin tests, and the deferred per-surface follow-ups).
**Inherited dependencies**:

- `backend.api_skeleton.serve_static_frontends` (settled — the `staticFrontendsPlugin`, the API-first / static-last ordering contract, the fail-fast-at-boot check, the `Accept`-discriminated SPA fallback, and the `MODERATOR_DIST_DIR` resolver all live in [apps/server/src/routes/static-frontends.ts](../../../apps/server/src/routes/static-frontends.ts) and are pinned by [apps/server/src/routes/static-frontends.test.ts](../../../apps/server/src/routes/static-frontends.test.ts)). The "list-of-frontends" shape (`{ urlPrefix, distDir, defaultIndex, label? }` with longest-prefix-wins matching) and the cache-control split (hash-named assets immutable; `index.html` `no-cache`) carry forward unchanged.

Related ADRs the leaf rides on:

- [ADR 0026](../../../docs/adr/0026-micro-frontend-root-app.md) — the micro-frontend pivot. Section 4 ("Backend changes") spells out exactly the four behaviors this leaf has to land: serve `apps/root/dist/index.html` for non-API + non-`/_surfaces/*` paths; serve `apps/root/dist/assets/*` for root's chunked assets; serve per-surface bundles under `/_surfaces/{surface}/[hash].js` (+ CSS sidecars) with long-lived cache headers; serve `/_surfaces/manifest.json` mapping each surface to its current hashed bundle URL.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every observable behavior added here lands behind a committed Vitest case, no ad-hoc smoke scripts.
- [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md) — Fastify route-registration-order semantics this leaf still relies on (API plugins register first; the static plugin registers LAST).

## What this task is

Extend the existing `staticFrontendsPlugin` so the Fastify server is the production-time host for the micro-frontend architecture introduced by ADR 0026. Concretely, after this leaf is closed the plugin:

1. **Serves the root app** (the thin host at `apps/root/`) for every non-API, non-`/_surfaces/*` GET — the root's `index.html` at `/`, its chunked `dist/assets/*` bundles under `/assets/...`, and (via the existing `Accept`-discriminated SPA-fallback) the same `index.html` for any client-routed root path (`/login`, `/screen-name`, `/m/sessions/:id/lobby`, etc.).
2. **Serves each surface as a content-hashed module bundle** under `/_surfaces/{surface}/...`. Today only the moderator surface has a library-mode `vite build`, so the wired list is one entry: `/_surfaces/moderator/moderator-<hash>.js` + `/_surfaces/moderator/assets/moderator-<hash>.css`. Each `@fastify/static` registration runs with `cacheControl: true, maxAge: '1y', immutable: true` so the browser caches each hash forever (safe because the URL changes on every build).
3. **Discovers the actual hashed filenames at boot** by scanning each surface's `distDir` against a `moduleFilePattern` + zero-or-more `styleFilePatterns`; one match per pattern is required (zero or multiple throws at registration), so a misnamed bundle or a stale dist surfaces as a startup error rather than a runtime 404.
4. **Emits a runtime manifest** at `GET /_surfaces/manifest.json` — `{ surfaces: { <surfaceId>: { moduleUrl, styleUrls } } }` — served with `Cache-Control: no-cache, must-revalidate` so a deploy's fresh URL reaches returning browsers on their next visit. The root reads this at boot (see [apps/root/src/surfaces/manifest.ts](../../../apps/root/src/surfaces/manifest.ts#L12-L29)) and dynamic-`import()`s the advertised module URL per dispatched URL prefix.

Most of the implementation landed inside the larger `root_app.root_moderator_cutover` commit (because the cutover is atomic per its own refinement); this leaf's scope is to formalize the multi-surface contract in the plugin (the `SurfaceEntry` type, the `discoverSingleFile` discovery scan, the `validateAndResolveSurface` fail-fast, the `buildSurfaceManifest` builder, the `/_surfaces/manifest.json` route), pin the manifest + per-surface-bundle behavior with regression tests, register the `ROOT_DIST_DIR` env override alongside the existing `MODERATOR_DIST_DIR`, and explicitly defer the participant / audience / replay-test additions until each one has a buildable library-mode `dist/`.

## Why it needs to be done

ADR 0026 chose URL-prefix dispatch with Vite-library-mode surface bundles loaded by a thin root host through a runtime manifest. The root cannot know which hashed filename to `import()` unless the server tells it, and the server cannot tell it unless the surface bundles are addressable URLs with stable cache semantics. Without this leaf:

- The root would have to hard-code the moderator bundle URL at build time, defeating the per-deploy hash-bust story that ADR 0026's "Backend changes" section relies on.
- New surfaces (participant tablet, audience/broadcast, replay/test) could not be added without rebuilding and redeploying the root, which inverts the micro-frontend isolation the pivot was meant to enable.
- The existing `staticFrontendsPlugin` would still be moderator-shaped (its default `frontends` list would point at `apps/moderator/dist`), but the moderator is no longer an entry SPA — it is a mountable region. A direct `GET /` against `apps/moderator/dist/index.html` would render the moderator's pre-cutover bootstrap, not the root.

Downstream consumers:

- [`apps/root/src/surfaces/manifest.ts`](../../../apps/root/src/surfaces/manifest.ts#L12-L37) — fetches `/_surfaces/manifest.json` and dynamic-`import()`s `moduleUrl`. Without the manifest endpoint, the root cannot dispatch.
- [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx) — calls `loadSurfaceManifest()` and `importSurfaceModule(moduleUrl)` per URL-prefix match; relies on the per-surface bundle URLs being immutable-cached so repeat visits don't re-download.
- `audience.aud_app_skeleton`, `participant_ui.part_app_skeleton`, `replay_test.*` — each adds a surface entry once its workspace produces a library-mode `vite build` (see "Open questions" → "Per-surface follow-ups").
- `deployment.prod_container` — the same single-image, single-origin contract from `serve_static_frontends` continues to hold; the Dockerfile additions are `COPY --from=build /app/apps/root/dist ./apps/root/dist` (and per-surface dists as each lands).

## Inputs / context

### Current plugin shape

[apps/server/src/routes/static-frontends.ts](../../../apps/server/src/routes/static-frontends.ts) already implements most of the multi-surface behavior — see:

- `FrontendEntry` ([line 93](../../../apps/server/src/routes/static-frontends.ts#L93-L118)) — unchanged from the parent task. The default `frontends` list now points at the root, not the moderator: see `resolveDefaultFrontends` ([line 240](../../../apps/server/src/routes/static-frontends.ts#L240-L251)).
- `SurfaceEntry` ([line 142](../../../apps/server/src/routes/static-frontends.ts#L142-L157)) + `ResolvedSurface` ([line 164](../../../apps/server/src/routes/static-frontends.ts#L164-L168)) + `SurfaceManifest` ([line 175](../../../apps/server/src/routes/static-frontends.ts#L175-L177)) — new types that model a surface as a `surfaceId` + `urlPrefix` + a `moduleFilePattern` regex (+ optional `styleFilePatterns`). Patterns are matched against POSIX-relative paths under `distDir`; exactly one match per pattern is required.
- `ROOT_DIST_DIR_ENV` + `MODERATOR_DIST_DIR_ENV` ([line 184-185](../../../apps/server/src/routes/static-frontends.ts#L184-L185)) — both env overrides exist; the resolvers ([line 226](../../../apps/server/src/routes/static-frontends.ts#L226-L232)) share the same `resolveWorkspaceDistDir` helper so the absolute-vs-relative + cwd-anchor semantics are identical for the root and every surface.
- `resolveDefaultSurfaces` ([line 253](../../../apps/server/src/routes/static-frontends.ts#L253-L272)) — today returns a one-entry list for the moderator surface; participant / audience / replay-test additions are commented in the task note but explicitly NOT wired (their `vite.config.ts` does not yet produce a library-mode build).
- `discoverSingleFile` ([line 339](../../../apps/server/src/routes/static-frontends.ts#L339-L359)) — the boot-time scan that finds the actual hashed filename. Zero matches throws (`pattern did not match any file under <dist>`); multiple matches throws (the dist holds bundles from two different commits).
- `validateAndResolveSurface` ([line 361](../../../apps/server/src/routes/static-frontends.ts#L361-L380)) — fail-fast for surfaces, structurally identical to the existing `validateFrontend` for frontends.
- `buildSurfaceManifest` ([line 382](../../../apps/server/src/routes/static-frontends.ts#L382-L391)) — pure function that builds the `{ surfaces: { ... } }` shape from a list of `ResolvedSurface`.
- Plugin body ([line 504](../../../apps/server/src/routes/static-frontends.ts#L504-L636)) — registers `@fastify/static` for each frontend, then for each surface, then mounts the `/_surfaces/manifest.json` route, then installs the SPA-fallback `setNotFoundHandler` (unchanged from the parent task).

### Moderator surface vite config (the canonical library-mode shape)

[apps/moderator/vite.config.ts](../../../apps/moderator/vite.config.ts#L34-L59) declares:

```ts
build: {
  outDir: 'dist',
  sourcemap: true,
  cssCodeSplit: false,
  lib: {
    entry: 'src/main.tsx',
    formats: ['es'],
    fileName: () => 'moderator.js',
  },
  rollupOptions: {
    output: {
      inlineDynamicImports: true,
      entryFileNames: 'moderator-[hash].js',
      assetFileNames: (assetInfo) =>
        assetInfo.name === 'style.css' ? 'moderator-[hash].css' : 'assets/[name]-[hash][extname]',
    },
  },
},
```

Two things land-bear on the plugin's discovery patterns: (a) the entry file lands at the dist ROOT as `moderator-<hash>.js`; (b) the stylesheet lands under `assets/moderator-<hash>.css` (the asset-name branch of `assetFileNames`). The `moduleFilePattern` is `/^moderator-[A-Za-z0-9_-]+\.js$/` and the single `styleFilePatterns` entry is `/^assets\/moderator-[A-Za-z0-9_-]+\.css$/` — see [resolveDefaultSurfaces](../../../apps/server/src/routes/static-frontends.ts#L267-L268).

### Root app vite config (standard SPA shape, NOT library mode)

[apps/root/vite.config.ts](../../../apps/root/vite.config.ts#L25-L29) keeps the default Vite SPA build:

```ts
build: {
  outDir: 'dist',
  sourcemap: true,
},
```

The root emits `index.html` at the dist root (referencing `/assets/index-<hash>.js` + `.css`), which is exactly what `@fastify/static` wants for an SPA — no library-mode treatment needed. The root is the only frontend in `resolveDefaultFrontends`; every other workspace is a surface, not a frontend, after ADR 0026.

### Dev server proxying (out of scope but informative)

[apps/root/vite.config.ts](../../../apps/root/vite.config.ts#L7-L23) proxies `/api`, `/_surfaces`, and `/ws` to `http://localhost:3000` so `pnpm -F @aconversa/root dev` against `make up` behaves the same as a production single-origin deploy — surface bundles fetched through `/_surfaces/*` flow through to Fastify, the manifest endpoint included. This leaf does not change the dev proxy; it does confirm that the `/_surfaces/*` prefix is a stable contract both the dev and production paths rely on.

### Existing Vitest coverage

[apps/server/src/routes/static-frontends.test.ts](../../../apps/server/src/routes/static-frontends.test.ts) already exercises (lines cited against the current file):

- `GET /` returns the root `index.html` ([line 69-77](../../../apps/server/src/routes/static-frontends.test.ts#L69-L77)).
- `GET /assets/<bundle.js>` returns the root's chunked asset with `max-age=` caching ([line 79-96](../../../apps/server/src/routes/static-frontends.test.ts#L79-L96)).
- `GET /_surfaces/manifest.json` returns the surface manifest with hash-busted URLs + `no-cache` ([line 98-126](../../../apps/server/src/routes/static-frontends.test.ts#L98-L126)).
- `GET <discovered moderator module URL>` returns the surface bundle with `max-age=` ([line 128-148](../../../apps/server/src/routes/static-frontends.test.ts#L128-L148)).
- `GET /healthz` still returns the canonical JSON envelope (API-precedence regression pin, [line 150-159](../../../apps/server/src/routes/static-frontends.test.ts#L150-L159)).
- `GET /api/auth/me` without auth returns JSON 401/404 (API-precedence regression pin, [line 161-177](../../../apps/server/src/routes/static-frontends.test.ts#L161-L177)).
- SPA-fallback HTML / JSON-envelope / non-GET behavior unchanged ([line 179-234](../../../apps/server/src/routes/static-frontends.test.ts#L179-L234)).
- Fail-fast for missing `distDir` / missing entry document ([line 237-288](../../../apps/server/src/routes/static-frontends.test.ts#L237-L288)).
- Resolver coverage for `ROOT_DIST_DIR` + `MODERATOR_DIST_DIR` env overrides ([line 290-315](../../../apps/server/src/routes/static-frontends.test.ts#L290-L315)).

### What is NOT yet covered

The discovery layer added by this leaf needs two regression pins the existing tests do not yet assert:

- **Multiple matches throw at registration.** A dist that holds bundles from two builds (`moderator-aaaa.js` + `moderator-bbbb.js`) should fail-fast rather than picking one indeterministically. The plugin throws `... matched N files ...` in `discoverSingleFile` ([line 352-357](../../../apps/server/src/routes/static-frontends.ts#L352-L357)) but no test exercises the path.
- **Zero matches throws at registration.** A dist that lacks a matching bundle (the surface workspace's build emitted to a different name) should fail-fast rather than serve 404s for every manifest fetch. The plugin throws `... did not match any file under <dist>` ([line 346-351](../../../apps/server/src/routes/static-frontends.ts#L346-L351)) but no test exercises the path.

These two cases land as part of this leaf's acceptance criteria (see below) — they are the only NET new behavior the leaf adds on top of what the cutover already shipped.

## Constraints / requirements

- **Reuse the parent task's contracts.** API routes register first; static last. The SPA-fallback `setNotFoundHandler` keeps the `Accept`-discriminator + GET/HEAD-only shape. The `Cache-Control` story splits hash-named assets (immutable / `max-age=1y`) from the SPA `index.html` (`no-cache, must-revalidate`). Per-surface bundles join the immutable-cached side; `/_surfaces/manifest.json` joins the `no-cache` side (so the next deploy's fresh URLs reach returning browsers).
- **Default `frontends` list points at the root, not the moderator.** After this leaf, `resolveDefaultFrontends` returns one entry: `{ urlPrefix: '/', distDir: resolveRootDistDir(env), defaultIndex: 'index.html', label: 'root' }`. The moderator no longer mounts at `/` — it mounts as a surface module dynamically `import()`-ed by the root.
- **Surface entries discovered, not statically named.** Each `SurfaceEntry` carries `moduleFilePattern` + `styleFilePatterns?` regexes, NOT literal filenames. The plugin scans `distDir` at boot via `discoverSingleFile` and the resolved name flows into the manifest. This is what makes the hash-bust story work: a deploy that changes the moderator's code produces a new `moderator-<newhash>.js`, the plugin discovers it at boot, the manifest advertises the new URL, returning browsers fetch `/_surfaces/manifest.json` (`no-cache`), see the new URL, and `import()` it.
- **Exactly one match per pattern.** Zero matches and multiple matches both throw at registration so a missing or stale dist surfaces in the startup log, not as a 404 storm after traffic arrives.
- **`/_surfaces/manifest.json` is served `no-cache`.** The whole hash-bust story collapses if the manifest is cached.
- **Per-surface bundles served with the same immutable cache headers as root assets.** `cacheControl: true, maxAge: '1y', immutable: true` — the same `@fastify/static` block as the root frontends, only `decorateReply: false` (since the first frontend registration already decorated `reply.sendFile`).
- **Only one frontend (`root`) and one surface (`moderator`) wired today.** Participant, audience, and replay-test workspaces exist as stubs but have no library-mode `vite build`. Adding them is a one-line entry to `resolveDefaultSurfaces` once each workspace's `vite.config.ts` emits `<surface>-<hash>.js` (+ optional CSS sidecar). See "Open questions" → "Per-surface follow-ups."
- **`ROOT_DIST_DIR` env override mirrors `MODERATOR_DIST_DIR`.** Same absolute-vs-relative + cwd-anchor semantics, same compile-time fallback path (three `..` segments up into the workspace).
- **Dockerfile updated to copy the root dist.** The runtime stage already copies the moderator dist for the surface; the root dist also has to be copied so the plugin's fail-fast at boot does not trip. Confirmed against [Dockerfile](../../../Dockerfile) during implementation — the change is additive to the existing single-image story.
- **Test layers per ADR 0022**. The two new regression pins (multiple-matches / zero-matches) land as Vitest unit cases in `static-frontends.test.ts` via `app.register(staticFrontendsPlugin, { ... })` with bespoke `distDir` fixtures built in `mkdtempSync` (the same pattern the existing fail-fast cases use). No `node -e` smokes; no ad-hoc curl scripts.
- **No e2e requirement at the backend layer.** The user-visible micro-frontend behavior (root host loads the manifest, dispatches by URL prefix, mounts the moderator) is the responsibility of `root_app.root_tests` (Playwright) and `root_moderator_cutover` (which already added Playwright coverage for the root-hosted public contract — see [tests/e2e/create-session-flow.spec.ts](../../../tests/e2e/create-session-flow.spec.ts), [tests/e2e/moderator-hover-details.spec.ts](../../../tests/e2e/moderator-hover-details.spec.ts), etc.). This backend leaf's behavior is fully observable at the HTTP layer and pinned via Vitest `app.inject`.

## Acceptance criteria

1. **`pnpm install` clean** — no new dependencies. The leaf uses only types and helpers already imported by the parent task (`@fastify/static`, Node `fs`/`path`/`url` builtins).
2. **`pnpm -F @aconversa/root build`** and **`pnpm -F @a-conversa/moderator build`** both produce their respective `dist/` trees (preconditions the Vitest suite relies on). The pre-commit hook's full build already runs these.
3. **`pnpm run check`** (lint + format + typecheck) green.
4. **`pnpm run test:smoke`** green, including the two new regression pins added to `apps/server/src/routes/static-frontends.test.ts`:
   - A `validateAndResolveSurface` case where `distDir` holds two files matching the same `moduleFilePattern` — the plugin registration throws with `matched ... files`.
   - A case where `distDir` is empty (or holds no file matching the pattern) — the plugin registration throws with `did not match any file under`.
5. **Existing test invariants still hold** — `GET /` returns the ROOT `index.html` (not the moderator's), `GET /_surfaces/manifest.json` returns a `{ surfaces: { moderator: { moduleUrl, styleUrls } } }` body with hash-busted URLs and `Cache-Control: no-cache`, `GET <moduleUrl>` returns the bundle with `max-age=` immutable caching, `GET /healthz` + `GET /api/auth/me` continue to return JSON (API-precedence regression pins), and the SPA-fallback handler still returns the root's `index.html` for any non-`/api/*` HTML-Accept GET.
6. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the task block in `tasks/20-backend.tji` per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).
7. **No Cucumber scenario required.** The manifest + per-surface-bundle behavior is fully observable through Fastify's `app.inject(...)` at the HTTP layer; the existing Vitest harness covers it without the Cucumber pglite ceremony. The user-visible micro-frontend handoff (root mounts moderator) is owned by `root_app.root_tests` and exercised by the Playwright specs already updated under `root_moderator_cutover`. Adding a Cucumber scenario here would not pin any behavior the Vitest cases miss.
8. **Per-surface follow-ups deferred to real leaves.** When the participant / audience / replay-test workspaces land their library-mode `vite build`, each gets its own one-line entry in `resolveDefaultSurfaces`. The deferrals are:
   - Participant surface wiring → folded into `participant_ui.part_app_skeleton` (which already exists in [tasks/40-participant-ui.tji](../../40-participant-ui.tji) as a real leaf; its scope expands to include the `resolveDefaultSurfaces` entry + Dockerfile `COPY` + a Vitest regression pin for `/_surfaces/participant/...`).
   - Audience surface wiring → folded into `audience.aud_app_skeleton` (already a real leaf in [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji); same expansion).
   - Replay-test surface wiring → folded into the replay-test workspace's app-skeleton task in [tasks/60-replay-and-test-mode.tji](../../60-replay-and-test-mode.tji) (when that workspace gets a buildable surface; today it is a stub).

   No new WBS leaves need to be registered by the Closer — the expansions ride on the existing app-skeleton leaves for each surface (the per-surface workspace's own task is the right place to wire its dist into the plugin, because the workspace can be built and tested at the same time the plugin entry is added). The wording "deferred to `<task_name>` (see Closer task-registration in ORCHESTRATOR.md)" is intentionally NOT used here because the deferrals reuse already-registered leaves rather than creating new ones.

## Decisions

### 1. Hash-bust per-surface bundles; serve manifest `no-cache`

Three alternatives surveyed:

- **(A) Fixed bundle names (`moderator.js`), no manifest, root hard-codes the URL.** Rejected: a user with a cached `moderator.js` from a previous deploy is pinned to stale code for up to a year (the immutable cache header is what makes the bundle cheap to fetch). Removing immutable caching to fix this defeats the static-asset story.
- **(B) Hash-bust bundles, serve manifest with the same immutable headers.** Rejected: identical problem one layer up — a user with a cached `manifest.json` sees the old hashed URLs and never discovers the new bundle. The manifest is the seam where the cache invalidation has to live.
- **(C) Hash-bust bundles + manifest served `no-cache` (chosen).** The bundle URLs change every build, so the URL identity guarantees the browser sees fresh code without a stale-cache window. The manifest is small (~200 bytes for one surface, ~800 bytes for four), `no-cache` round-trip cost is negligible, and it is the only thing the browser revalidates on every visit. This is the conventional CDN pattern (Vite's own build emits the same shape for `index.html` vs `assets/*`).

The plugin lands (C). Vite's library-mode `entryFileNames: '<surface>-[hash].js'` produces the hash; `discoverSingleFile` reads the resulting name at boot; `buildSurfaceManifest` assembles the URLs; the `GET /_surfaces/manifest.json` handler emits `Cache-Control: no-cache, must-revalidate`.

### 2. Discovery via regex pattern, not literal filename

Two alternatives surveyed:

- **(A) Hard-code the surface bundle filename per entry (the dist is expected to have exactly `moderator-<hash>.js` for some known hash).** Rejected: the hash changes every build; nobody can pin a literal filename. The alternative is to pass the hash as a build-time env, but that couples build invocation to plugin configuration and breaks parity between local-dev and Docker-build invocations.
- **(B) Pattern-match the filename at boot via regex (chosen).** The pattern accepts any base64-url hash (`[A-Za-z0-9_-]+`) suffix and the scan asserts exactly-one-match per pattern. A misnamed bundle, a stale dist holding two builds' worth of files, or a build that emitted to the wrong name all surface at registration time with a specific error message.

The plugin lands (B). The patterns are intentionally tolerant of Rollup's hash-length tuning (`[A-Za-z0-9_-]+`, not a fixed length).

### 3. Exactly-one-match is required; zero or multiple throws

Surveyed the three behaviors:

- **(A) Zero matches → empty `moduleUrl` in the manifest (a missing entry).** Rejected: the root's dispatcher would fail on dynamic-`import()` with a confusing "module not found" inside a deeply-nested dispatch path, far from the actual misconfiguration (the surface workspace didn't build).
- **(B) Multiple matches → pick lexicographically first (or last, or by mtime).** Rejected: indeterminism. A stale dist that holds two builds' bundles would silently serve one of them; subsequent traffic would race against partial deploys.
- **(C) Throw on zero or multiple (chosen).** Both states are bugs (the build is broken, or the dist was not cleaned between builds); fail-fast at registration gives the operator a single-line, actionable error in the startup log.

The plugin lands (C); the two new regression pins under "Acceptance criteria" exercise both throw paths.

### 4. `ROOT_DIST_DIR` env override mirrors `MODERATOR_DIST_DIR`

Two alternatives surveyed:

- **(A) Single `STATIC_DIST_ROOT` env override that anchors all frontends + surfaces below it.** Rejected: it conflates concerns (the root's dist is structurally different from a surface's dist — different `vite.config.ts`, different file layout) and ties operational flexibility (laying the bundles wherever) to a directory layout convention. Different bundles can be laid out in different places (e.g. on a CDN-backed mount) and the env split lets each be addressed independently.
- **(B) One env var per workspace (chosen).** `ROOT_DIST_DIR`, `MODERATOR_DIST_DIR`, future `PARTICIPANT_DIST_DIR` / `AUDIENCE_DIST_DIR` / `REPLAY_TEST_DIST_DIR`. The naming is symmetric and the resolver helper (`resolveWorkspaceDistDir`) takes (env-key, app-name) so the boilerplate is one line per workspace.

The plugin lands (B); the resolver tests pin both `ROOT_DIST_DIR` and `MODERATOR_DIST_DIR` overrides explicitly.

### 5. The root mounts at `/`, not at `/_root/` or behind any prefix

Two alternatives surveyed:

- **(A) Mount the root under a dedicated prefix (`/_root/`) like the surfaces are under `/_surfaces/`.** Rejected: the root IS the SPA the browser loads first; mounting it under a prefix means `GET /` returns nothing useful, and a separate redirect-from-`/`-to-`/_root/` rule has to live somewhere. The whole point of the root host is that it owns the public landing.
- **(B) Mount the root at `/` (chosen).** The root's `index.html` is the SPA the browser fetches; everything else is loaded under the root. The `/_surfaces/*` prefix is reserved for the dynamically-imported surface bundles; everything outside `/_surfaces/*` + `/api/*` + `/healthz` falls through to the root via the SPA-fallback handler.

The plugin lands (B); `resolveDefaultFrontends` returns one entry with `urlPrefix: '/'`.

### 6. No Cucumber scenario; Vitest `app.inject` is sufficient

The behavior added by this leaf is HTTP-observable: the manifest endpoint returns a specific shape, the surface bundle URLs return the bundle, the SPA fallback still works. Every assertion runs against `app.inject(...)` without binding a port. ADR 0007 (Cucumber + pglite) is the right harness for behaviors that span the data layer (DB events, projection state) and the HTTP layer; the multi-surface plugin has no DB story. Adding a Cucumber scenario would duplicate Vitest coverage without pinning any behavior the inject cases miss.

The micro-frontend handoff (root mounts moderator in a real browser) is the responsibility of `root_app.root_tests` (Playwright) and is already exercised by the Playwright specs `root_moderator_cutover` shipped (see [tests/e2e/create-session-flow.spec.ts](../../../tests/e2e/create-session-flow.spec.ts), [tests/e2e/invite-participants-flow.spec.ts](../../../tests/e2e/invite-participants-flow.spec.ts), [tests/e2e/moderator-hover-details.spec.ts](../../../tests/e2e/moderator-hover-details.spec.ts), etc.). This backend leaf's responsibility ends at the HTTP contract.

### 7. No new ADR needed

ADR 0026's "Backend changes" section (sub-decision 4) prescribes exactly the four behaviors this leaf lands. The choice of regex-based discovery (Decision 2), the exactly-one-match invariant (Decision 3), the per-workspace env override naming (Decision 4), and the `/`-mount for the root (Decision 5) are implementation-level decisions that flesh out the ADR's contract without changing it. None crosses a workspace boundary or introduces a new dependency. The ADR convention in [docs/adr/README.md](../../../docs/adr/README.md#L1) reserves ADRs for architectural choices among alternatives; the choices here are inside the seam ADR 0026 already opened.

### 8. Most of the implementation rode the `root_moderator_cutover` commit

The plugin updates (root as the default frontend; `SurfaceEntry` + discovery + manifest; the moderator surface entry; the `/_surfaces/manifest.json` route; the `ROOT_DIST_DIR` env override; the existing Vitest cases under "What is NOT yet covered" → "Existing Vitest coverage" above) all landed inside `root_app.root_moderator_cutover` because that commit had to be atomic (per its own Decisions §1 — a staged commit would have left the public route contract in a broken intermediate state with the root not yet mounted).

This leaf's commit scope is the narrow remainder:

- Two new regression tests in `static-frontends.test.ts` (multiple-matches throws + zero-matches throws).
- This refinement document under `tasks/refinements/backend/`.
- `complete 100` marker on the `tasks/20-backend.tji` task block.
- A short Status section appended to this refinement at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42).

The split is faithful to the WBS shape — the task entry exists as a separate leaf in the backend tree (rather than as a sub-task of `root_moderator_cutover`) because the multi-surface plugin behavior is a backend concern and the WBS organizes work by area. Implementation atomicity led the cutover; documentation + regression-pin atomicity lives here.

## Open questions

- **Per-surface follow-ups.** Participant, audience, and replay-test surface entries are NOT wired by this leaf. Each will be wired by the corresponding workspace's app-skeleton task (`participant_ui.part_app_skeleton`, `audience.aud_app_skeleton`, the replay-test app skeleton inside `replay_test`) when its `vite.config.ts` produces a library-mode build. The expansion per surface is mechanical: one entry in `resolveDefaultSurfaces`, one `COPY --from=build` in the Dockerfile, one regression-pin in `static-frontends.test.ts`. Reusing the existing app-skeleton leaves rather than registering a new "wire the surface into the plugin" leaf per surface is the right scope split — each per-surface workspace can build, run its own tests, and verify its plugin wiring in a single commit.
- **Pre-compression (`@fastify/compress` or Vite brotli plugin).** Carried forward unchanged from the parent task. The surface bundles are typically larger than the root (the moderator carries React-Flow + Zustand + Dagre). Pre-compression would help; not load-bearing for this leaf's contract. Deferred (same as the parent — no separate leaf today; will register one if a CSP/perf hardening task picks it up).
- **CSP headers for the surface bundles.** Loading a third-party surface bundle via dynamic `import()` interacts with `script-src` if a future CSP includes `'self'`-only constraints. Inline `import()` of a same-origin URL is allowed without `'unsafe-eval'` under modern CSP rules, but a future CSP-hardening task should explicitly add `'self'` to `script-src` and any surface origins (today: same origin). Tracked under the same `backend-hardening` group as the parent task's CSP open question.
- **Manifest schema versioning.** The manifest shape (`{ surfaces: { <id>: { moduleUrl, styleUrls } } }`) has no version field. A future change to the shape (e.g. adding `dependencies` or `peerVersions`) would break the root's parser. Not a today-problem (the root parses what the server emits in the same atomic deploy), but worth flagging if the surface contract ever has to be backward-compatible across deploys. Punted until a real consumer needs it.

## Status

**Done** — 2026-05-16.

- Formalized the multi-surface plugin contract by adding an opt-in `surfaces?: readonly SurfaceEntry[]` field to `StaticFrontendsPluginOptions` in [apps/server/src/routes/static-frontends.ts](../../../apps/server/src/routes/static-frontends.ts); when the caller omits it the plugin falls back to `resolveDefaultSurfaces` (the moderator-only one-entry default), preserving the contract the `root_moderator_cutover` commit shipped while letting Vitest fixtures inject bespoke surfaces against `mkdtempSync` dist trees.
- Landed the two missing regression pins for `discoverSingleFile`'s fail-fast paths in [apps/server/src/routes/static-frontends.test.ts](../../../apps/server/src/routes/static-frontends.test.ts) — a multiple-matches case (two `moderator-<hash>.js` files in one dist throws at registration with `matched ... files`) and a zero-matches case (empty dist for a surface throws with `did not match any file under`). The two paths existed but were unexercised; this leaf's net new behavior is just the test pins (Decision 8 — the plugin code itself rode the cutover commit).
- Vitest test-count delta on `static-frontends.test.ts`: 16 → 18; full smoke suite 3411 passing across 152 files.
- e2e not run: refinement's Acceptance criteria §7 scopes coverage to Vitest only; the user-visible micro-frontend handoff is owned by `root_app.root_tests` and `root_moderator_cutover` (the Playwright specs already exist).
- No new dependencies, no i18n keys, no Dockerfile churn — the `COPY --from=build /app/apps/root/dist` line that this leaf would have added already landed inside the cutover commit (per Decision 8).
- Per-surface follow-ups (participant / audience / replay-test) remain deferred to the existing `*_app_skeleton` leaves per Acceptance criterion §8 — no new WBS leaf needs registration today.
- Verifications green: `pnpm run check`, `pnpm run test:smoke`, `pnpm -F @aconversa/root build`, `pnpm -F @a-conversa/moderator build`, and `tj3 project.tjp` all clean.
