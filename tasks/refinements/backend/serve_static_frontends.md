# Serve frontend SPAs from the API server

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.serve_static_frontends`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — Fastify factory + plugin chain landed 2026-05-10)

## What this task is

Wire the Fastify server to serve the frontend apps' built `dist/` directories so the deployment is a **single origin** — one hostname + port answers both the JSON API (`/sessions`, `/auth/*`, `/ws`, `/healthz`, `/docs`) and the SPA HTML (`/` → moderator's `index.html`, `/assets/<hash>.js` → bundle).

Today the Fastify server owns only the API surface; the moderator (and the eventual participant / audience / replay) SPA is built by Vite into `apps/<app>/dist/` and has no production-time serving story. After this task lands, the same Docker image that ships the API also ships the bundles, and a single `http://localhost:3000` is the entire deployment.

## Why it needs to be done

- **Single-origin deployment.** With API and SPA on the same origin, browsers see one domain — no CORS preflights for fetch, no third-party-cookie pain (the session cookie is same-origin everywhere), no second TLS cert. Production wants this; local dev gets it for free.
- **Playwright e2e prerequisite.** The upcoming Playwright e2e infrastructure (deferred under `backend.backend_tests.be_e2e_tests`) needs to load the real moderator UI in a real browser pointed at a real server. Today there is no single URL that yields both the SPA and the API; a Playwright config would have to juggle the Vite dev server AND the Fastify server, with proxying glue. Serving the bundle from Fastify removes that complication entirely — `http://localhost:3000` is both.
- **Mirrors ADR 0015's "single image serves all surfaces" intent.** ADR 0015 already committed to one Docker image carrying the entire app; this task realizes that commitment for the moderator surface. Participant / audience / replay are stubs today; the plumbing here is shaped to extend to them as one-line additions when their bundlers land.

Downstream consumers:

- `backend.backend_tests.be_e2e_tests` (Playwright suites) — loads `http://localhost:3000/` and exercises the moderator UI end-to-end.
- `deployment.prod_container` — ships the single-origin image to production; no separate static-asset CDN needed for v1.
- Future participant / audience / replay app-skeleton tasks — register their `dist/` under a new frontend entry.

## Inputs / context

From [docs/architecture.md](../../../docs/architecture.md) ("Frontend surfaces"):

> V1 ships four distinct surfaces, sharing a TypeScript codebase and connecting to the same backend:
>
> - Moderator — full operator UI.
> - Debaters (×2) — agreement controls on each pending facet.
> - Audience / broadcast — read-only, designed for video.
> - Producer / director — change-history scrubbing, segment-snapshot triggers, possibly OBS scene-switching cues.

And from the same doc ("Deployment"):

> Single Docker image for the application + a managed PostgreSQL.

The architecture intent — one image, four surfaces — drives the "list-of-frontends" shape below.

From [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md) (Consequences):

> The trivial `GET /` route stays. It returns `{ status: 'ok' }` — not a real healthcheck — and exists purely as a smoke endpoint for `curl http://localhost:3000/` against the running compose stack.

ADR 0023 anticipated `/` as a smoke endpoint. This task supersedes that — `/` is now the moderator SPA. The compose healthcheck and the human-facing smoke both target `/healthz` (already wired by `health_endpoint`).

From [apps/moderator/vite.config.ts](../../../apps/moderator/vite.config.ts):

```ts
build: {
  outDir: 'dist',
  sourcemap: true,
},
```

Vite emits `dist/index.html` referencing `/assets/index-<hash>.js` (and `.css`). The hashed filenames mean assets can be cached aggressively; `index.html` itself must NOT be cached (a new deploy ships a new hash, and `index.html` must reach the browser to see it).

From [Dockerfile](../../../Dockerfile) (build stage):

```
RUN pnpm -r build
```

The build stage already runs `pnpm -r build`, which now produces `apps/moderator/dist/` as a side effect of the moderator's `vite build`. Adding the runtime-stage `COPY --from=build` to ship the dist into the alpine image is the only new wiring at the Docker layer.

## Constraints / requirements

- **API routes take precedence — unambiguously.** Fastify matches routes in registration order; the static plugin must register LAST so its wildcard never shadows `/healthz`, `/auth/*`, `/sessions/*`, `/ws`, `/docs`, or any future API surface.
- **SPA fallback discriminates by `Accept`.** Unknown paths with `Accept: text/html` (browser hitting a client-routed SPA path like `/sessions/abc/lobby`) get the SPA's `index.html` at 200 so React Router can render the route. Unknown paths with `Accept: application/json` (or no Accept header — default to JSON for safety) get the canonical `{ error: { code: 'not-found', message: 'Route not found' } }` envelope.
- **SPA fallback applies to GET/HEAD only.** A `POST /sessions/typo` from an API consumer is a wrong URL, not a routing-aware SPA request — JSON envelope regardless of Accept.
- **Fail-fast at boot.** A missing or unreadable `dist/` (or its `index.html`) throws at plugin registration, BEFORE `app.listen(...)`. Better to see "moderator dist missing" in the startup log than 404s on every HTML request.
- **Extensible to participant / audience / replay.** The plugin takes a list of `{ urlPrefix, distDir, defaultIndex }` entries. Today only the moderator at `/` is wired; adding participant at `/participant` (or another root prefix) is a one-line change once their `vite build` exists.
- **Env-overridable `distDir`.** `MODERATOR_DIST_DIR` lets a deployment lay the bundle anywhere; the default resolves relative to the server's compiled location so a vanilla local run or a vanilla Docker run both work.
- **Test layers per ADR 0022**:
  - Pure logic (resolver for the env override, `prefersHtml` discriminator, fail-fast at boot) → Vitest unit tests under `apps/server/src/routes/static-frontends.test.ts`.
  - Wire behavior (GET / returns HTML, GET /healthz still 200 JSON, SPA fallback for HTML Accept, JSON envelope for JSON Accept, dist-missing throws) → also under `static-frontends.test.ts` via `app.inject(...)` — no port bind, no network.
- **No ad-hoc probes.** Every empirical check is a committed test; no `node -e`, no `curl` scripts.

## Acceptance criteria

- `pnpm install` clean.
- `pnpm -F @a-conversa/moderator build` produces `apps/moderator/dist/index.html` (the precondition the Vitest suite relies on).
- `pnpm -F @a-conversa/server build` produces.
- `pnpm run check` (`lint && format:check && typecheck && typecheck:tools && typecheck:tests`) green.
- `pnpm run test:smoke` green; new `routes/static-frontends.test.ts` cases land alongside the updated `server.test.ts` (its `GET /` test now expects HTML, not JSON; its OPTIONS preflight uses `/healthz`) and the updated `error-handler.test.ts` / `openapi.test.ts` (the latter no longer asserts a `/` path in the OpenAPI doc).
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the `complete 100` marker lands.

## Decisions

- **`GET /` is repurposed; the bootstrap smoke route is removed.** Three alternatives surveyed:
  - **(A) Move the smoke to `/api/status`** (rejected). Adds a new API path with no consumer. `/healthz` already covers the "is the server up" probe (compose healthcheck targets it; human smoke is `curl http://localhost:3000/healthz`).
  - **(B) Mount the moderator at `/moderator/*` instead of `/`** (rejected). Single-origin deployment wants the moderator as the default landing page; `/moderator/*` is awkward for the user-facing URL bar and forces a separate redirect from `/`.
  - **(C) Remove `GET /` outright; mount the moderator at `/`** (chosen). The `{ status: 'ok' }` route was always a "proof the bootstrap works" leftover from the initial `http_server` task; once the SPA owns `/`, the role is filled by the actual product UI. `/healthz` is the JSON liveness probe; the human-facing smoke is now "load `/` in a browser, see the moderator."
- **Route precedence: API first, static last.** Fastify routes match in registration order. `server.ts` registers all API routes (`error_handler`, `openapi`, `healthz`, `auth`, `sessions`, `ws*`) BEFORE the `staticFrontendsPlugin` so the wildcard static handler never shadows them. Reviewers reading `server.ts` see the plugin registration block ending in `app.register(staticFrontendsPlugin)` — placement is the only thing keeping the contract.
- **SPA fallback via `setNotFoundHandler` with `Accept` discriminator.** The previous `errorHandlerPlugin` installed `setNotFoundHandler` at the root scope; that responsibility now lives in `staticFrontendsPlugin`. `errorHandlerPlugin` exports `sendNotFoundEnvelope` which the static plugin calls for the JSON branch — single source of truth for the JSON 404 envelope shape. Fastify allows only one not-found handler per prefix scope; this refactor avoids the double-set conflict.
- **`Accept: text/html` → SPA; everything else → JSON.** The discriminator looks for `text/html` (or `application/xhtml+xml`) anywhere in the inbound Accept header. Missing Accept defaults to JSON — safer for headless / scripting clients that omit Accept by accident. The exact rule is a substring check, not a full RFC-7231 q-value parser: real browsers send `text/html` first; real curl invocations send `application/json` or no header at all. The simple rule covers both cleanly.
- **GET/HEAD only for SPA fallback.** A `POST /sessions/typo` is an API consumer with a wrong URL, not a client-routed SPA request. Returning HTML there would confuse JSON parsers. The handler explicitly checks `method` and returns the JSON envelope for everything except `GET` and `HEAD`.
- **Env override: `MODERATOR_DIST_DIR`.** Absolute path wins; relative paths anchor to `process.cwd()`. Default falls back to the symmetric source/compiled path (three `..` segments up from `<this-file>` into `moderator/dist`). The default works under both `apps/server/src/routes/...` (Vitest) and `apps/server/dist/routes/...` (compiled runtime) because both layouts share the same three-up-then-into-moderator topology.
- **List-of-frontends shape.** The plugin's options are `{ frontends: readonly FrontendEntry[] }`, with `FrontendEntry = { urlPrefix, distDir, defaultIndex, label? }`. Today the list has one entry — the moderator at `/`. Adding participant at `/participant` is a one-line entry once `apps/participant/dist/` is real. The SPA-fallback handler does longest-prefix-wins matching across the list so a `/participant/anything` request goes to the participant SPA before falling through to the root moderator.
- **Cache control: hash-named assets immutable, `index.html` revalidate-required.** `@fastify/static`'s plugin options set `cacheControl: true, maxAge: '1y', immutable: true` for the served files (Vite emits hash-named bundles, so they're safe to cache forever). The SPA-fallback handler explicitly emits `Cache-Control: no-cache, must-revalidate` for `index.html` so a new deploy's `index.html` (referencing new hash-named bundles) reaches the browser on the next request.
- **`schemaHide: true` on the static plugin.** The wildcard static route would otherwise clutter the generated OpenAPI doc with a `GET /*` entry. The static surface is not API surface; hiding it from the doc keeps the API surface readable.
- **Fail-fast on missing dist.** The plugin's `validateFrontend` check runs at registration time: `distDir` must exist and be a directory; `<distDir>/<defaultIndex>` must be a readable file. A failure throws with a clear message ("moderator distDir does not exist") and the server never binds the port. The runtime image's Dockerfile copies the dist; a stripped image would fail at boot rather than silently serving 404s.
- **Dockerfile: copy the moderator dist into the runtime image.** A single `COPY --from=build /app/apps/moderator/dist ./apps/moderator/dist` line in the runtime stage suffices — the build stage already runs `pnpm -r build` which produces the dist. The forward-only Dockerfile commitment (ADR 0015) is preserved; the change is additive.

## Open questions

- **Compression.** `@fastify/static` doesn't gzip/brotli on the fly. The moderator bundle is ~528 KiB uncompressed; over a slow link this is noticeable. Two options for a follow-up:
  - **Pre-compress** during the build (Vite has a brotli plugin) and let `@fastify/static`'s `preCompressed: true` serve the `.br` / `.gz` variant automatically.
  - **Add an `@fastify/compress` plugin** that compresses HTML / JS / CSS at request time.

  Deferred to a sibling task; not load-bearing for the single-origin deployment shape this task settles.

- **CSP / security headers.** Serving HTML opens the door for content-security-policy work — a follow-up task (`backend-hardening.csp_headers` or similar) should set `Content-Security-Policy`, `Strict-Transport-Security`, etc. Out of scope here; tracked separately.

- **Participant / audience / replay timing.** Their stubbed `apps/<name>/` directories have no `vite build` story today. The plugin's list-of-frontends shape is intentionally forward-compatible: when their bundlers land, the additions are one line in the resolver and one `COPY --from=build` in the Dockerfile.

- **404 leakage for SPA-fallback paths.** The current SPA fallback returns 200 + `index.html` for any unknown HTML-Accept GET. A future enhancement could maintain a list of valid SPA routes (read from React Router's route config) and 404 anything else even under HTML Accept. Not done today — the SPA's own `<Route path="*">` catch-all handles unknown routes inside the SPA, which is the standard pattern.

## Status

**Done** — 2026-05-11. Landed as:

- Plugin: [`apps/server/src/routes/static-frontends.ts`](../../../apps/server/src/routes/static-frontends.ts) (`staticFrontendsPlugin` + `resolveModeratorDistDir` + `MODERATOR_DIST_DIR_ENV`).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) registers the plugin LAST in the factory; the previous trivial `GET /` smoke route was removed.
- Error-handler refactor: [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) exports `sendNotFoundEnvelope` and no longer installs `setNotFoundHandler` (the static plugin owns it; the JSON branch delegates to the same exported function).
- Vitest: [`apps/server/src/routes/static-frontends.test.ts`](../../../apps/server/src/routes/static-frontends.test.ts) (+13 cases: SPA at `/`, `/assets/<bundle>`, API-precedence regression for `/healthz` + `/auth/me`, SPA fallback for HTML Accept, JSON envelope for JSON Accept / no Accept, non-GET → JSON, fail-fast at boot for missing dist + missing index, env-override resolver).
- Existing-test updates: [`apps/server/src/server.test.ts`](../../../apps/server/src/server.test.ts) — `GET /` now expects HTML (single-origin), the CORS preflight smoke uses `/healthz`. [`apps/server/src/openapi.test.ts`](../../../apps/server/src/openapi.test.ts) — `/` is no longer documented in the OpenAPI doc.
- Dockerfile: [`Dockerfile`](../../../Dockerfile) — adds `COPY --from=build /app/apps/moderator/dist ./apps/moderator/dist` to the runtime stage so the single-origin image ships the SPA bundle.
- Dependency: `@fastify/static@8.2.0` pinned in [`apps/server/package.json`](../../../apps/server/package.json).
- WBS: [`tasks/20-backend.tji`](../../20-backend.tji) — task `backend.api_skeleton.serve_static_frontends` added with `complete 100`; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
