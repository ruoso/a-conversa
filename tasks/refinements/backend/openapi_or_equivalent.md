# Document API surface (OpenAPI via `@fastify/swagger`)

**TaskJuggler entry**: [tasks/20-backend.tji](../../20-backend.tji) — task `backend.api_skeleton.openapi_or_equivalent`
**Effort estimate**: 1d
**Inherited dependencies**: `backend.api_skeleton.http_server` (settled — `createServer()` + `index.ts` landed 2026-05-10), `backend.api_skeleton.error_handling` (settled — canonical `{ error: { code, message, ... } }` envelope landed 2026-05-10), `backend.api_skeleton.request_logging` (settled), `backend.api_skeleton.health_endpoint` (settled). This task is the last sibling under `api_skeleton`; closing it closes the milestone-leaf.

## What this task is

Wire the OpenAPI generator that documents the HTTP API surface so the four frontends (audience, moderator, participant, and the eventual public-facing entry) plus external consumers have a single contract to code against. Fastify ships `@fastify/swagger` (the OpenAPI 3.x generator that reads each route's `schema` block) and `@fastify/swagger-ui` (the HTML viewer mounted at `/docs`); both land as one plugin so the bootstrap order ("openapi before routes") is enforced in one place.

Three sub-deliverables ship together because they share a single plugin:

1. **OpenAPI metadata + tag taxonomy.** The plugin declares `info.title`, `info.description`, `info.version` (sourced from `npm_package_version` via a shared `resolveServerVersion` helper) and a fixed five-tag taxonomy (`meta`, `auth`, `sessions`, `events`, `replay`) so future-route work attaches `tags: ['<tag>']` and Swagger UI groups them cleanly.
2. **Shared error-envelope schema.** The canonical envelope `{ error: { code, message, ... } }` (emitted at runtime by `error-handler.ts`) is registered via `app.addSchema({ $id: 'ErrorEnvelope', ... })` so every route's `schema.response.4xx` / `5xx` can reference it via `{ $ref: 'ErrorEnvelope#' }` instead of repeating the shape. A custom `refResolver.buildLocalReference` keeps the schema name stable in `components.schemas` (the plugin's default would rename it `def-0`).
3. **Schemas on the two existing routes.** `GET /` and `GET /healthz` get `schema` blocks with `tags: ['meta']`, a `summary` / `description`, a typed 200 response shape, and the shared error ref on `5xx`. Future routes (sessions, replay, auth) follow the same pattern.

This task does **not** pre-empt the type-provider decision (Zod-via-`fastify-type-provider-zod` vs TypeBox). Today's two routes have no request body — plain JSON Schema is the simplest forward-compatible choice; the first session/replay/auth route that needs request-body validation will pick the provider then.

## Why it needs to be done

- **The four frontends need a stable contract.** Audience, moderator, participant — and the eventual external API consumers — code against the HTTP surface. Without a published OpenAPI document, each consumer hand-writes its client and the contract drifts between code and reality. With it, consumers either read the document by eye in `/docs` or auto-generate a typed client from `/docs/json`.
- **The `api_skeleton` siblings already pre-assumed this surface.** The error-handler refinement records "the OpenAPI spec gets a single shared error component sourced from this task"; the route-schema slots have been waiting since `health_endpoint` shipped. Landing it now means the next session-management task can attach a schema block from day one rather than retrofitting.
- **Documentation drift is cheaper to prevent than to fix.** Every route added without a schema block is a future audit pass. With the plugin in place, "add a route" and "document a route" are the same step — the schema block is the documentation.

Downstream consumers:

- `backend.auth.*` — OAuth callback, screen-name collection, session-token routes; attach `tags: ['auth']` and their request/response schemas to the same instance.
- `backend.session_management.*` — `POST /sessions`, `GET /sessions`, etc.; `tags: ['sessions']`; will likely be the first task that picks a type provider for request-body validation.
- `backend.replay_endpoints.*` — `GET /sessions/:id/events`, `GET /sessions/:id/state?position=...`, snapshots; `tags: ['events']` / `tags: ['replay']`.
- Frontend client-generation — `apps/audience`, `apps/moderator`, `apps/participant`, and any external SDK can run `openapi-typescript /docs/json` (or similar) to generate typed clients. Today's surface is small but the wiring exists so generation works from the first real route onward.

## Inputs / context

From [ADR 0023](../../../docs/adr/0023-web-framework-fastify.md) (Decision, plugins explicitly deferred):

> `@fastify/swagger` + `@fastify/swagger-ui` — owned by `backend.api_skeleton.openapi_or_equivalent`.

This task lands the deferral.

From [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts):

```ts
interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}
```

The shape we document. The runtime emits exactly this; the documented schema mirrors it.

From [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) — current plugin order at task-start:

```
sensible → cors → onRequest(x-request-id) → errorHandler → GET / → healthzPlugin
```

The openapi plugin slots in after `errorHandler` and before the route registrations (`GET /` and `healthzPlugin`) so `@fastify/swagger`'s `onRoute` hook fires for every route schema.

From [`apps/server/node_modules/@fastify/swagger/lib/util/add-hook.js`](../../../apps/server/node_modules/@fastify/swagger/lib/util/add-hook.js) (read for understanding, not modified):

The plugin captures routes via Fastify's `onRoute` hook and `addSchema`-registered schemas via `getSchemas()` at the `onReady` hook. Schemas referenced by routes are pulled into `components.schemas` automatically; the default name is `def-${i}` unless a custom `refResolver.buildLocalReference` returns the `$id`.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md): empirical verifications must be committed tests. The plugin ships with Vitest unit tests (`.inject(...)`-based) and a Cucumber scenario round-tripping the documented surface.

## Constraints / requirements

- **Plugins**: `@fastify/swagger@9.7.0` + `@fastify/swagger-ui@5.2.6` (current stable as of 2026-05-10). Pinned exact, matching the project-wide dependency-pin policy in ADR 0023.
- **Module shape**:
  - `apps/server/src/openapi.ts` — exports `openapiPlugin` (a `fastify-plugin`-wrapped async function so swagger / swagger-ui attach to the root scope), the `OPENAPI_TAGS` array (with descriptions) and `OPENAPI_TAG_NAMES` (names only, for tests), the `errorEnvelopeSchema` constant, the `ERROR_ENVELOPE_SCHEMA_ID` string, and the `errorEnvelopeRef` `$ref` object.
  - `apps/server/src/version.ts` — extracts the existing `resolveVersion()` from `routes/healthz.ts` into a shared `resolveServerVersion()` helper so the OpenAPI `info.version` and the `/healthz` response body draw from a single source of truth.
- **Plugin registration order in `server.ts`**: after `sensible`, `cors`, the `onRequest(x-request-id)` hook, and `errorHandlerPlugin`, BEFORE `GET /` and `healthzPlugin`. The openapi plugin's `onRoute` hook only sees routes registered after it, so order matters.
- **Docs URL**: `/docs` for the Swagger UI HTML (mounted by `@fastify/swagger-ui` via `routePrefix: '/docs'`); the plugin also serves `/docs/json` (OpenAPI 3.x JSON) and `/docs/yaml` (same content, YAML serialization). Future-route generated clients fetch `/docs/json`.
- **Schema mechanism today**: plain JSON Schema objects for the trivial routes. Each route's `schema` is a plain object with `tags`, `summary`, `description`, `response.200`, `response.5xx`. The first request-body-validating route (likely session-management) will pick a type provider then.
- **Shared error envelope**: registered via `app.addSchema({ $id: 'ErrorEnvelope', ... })` inside `openapiPlugin`. Routes reference it as `{ $ref: 'ErrorEnvelope#' }` exported as `errorEnvelopeRef`. A custom `refResolver.buildLocalReference` in the swagger config returns `json.$id` (falling back to the default `def-${i}` for unnamed schemas) so the document carries `components.schemas.ErrorEnvelope` rather than `components.schemas.def-0`.
- **Tag taxonomy**: a fixed five-tag list declared in `OPENAPI_TAGS` (with one-line descriptions):
  - `meta` — server-meta and operational (`/`, `/healthz`, future `/readyz`).
  - `auth` — OAuth callback, session-token issuance, screen-name collection.
  - `sessions` — debate-session lifecycle.
  - `events` — event log inspection (write path is WebSocket, not HTTP).
  - `replay` — projected state at log position, snapshot list + fetch.

  Order is meaningful — Swagger UI renders tags in declaration order. The Vitest suite and Cucumber scenario both pin the exact list so adding a new tag requires a deliberate update across three files (`openapi.ts`, the Vitest assertion, the Cucumber scenario).
- **Auth gate**: the OpenAPI document and Swagger UI are served **unauthenticated** today. The refinement records this as a future toggle — production deployments will likely want to gate them behind a feature flag or auth middleware once the auth surface lands. The gate is a one-line env-flag check (`if (env.OPENAPI_PUBLIC === 'false') return;`) inside the plugin; deliberate non-decision today because auth doesn't exist yet to hide behind.
- **Test layers per ADR 0022**:
  - Pure logic (the generated document's shape, schema presence, tag order) → Vitest `apps/server/src/openapi.test.ts` exercising `.inject(...)` against `createServer()`. Eight cases covering: HTML at `/docs`, JSON at `/docs/json`, info block, healthz path, root path, tag taxonomy, ErrorEnvelope schema, 5xx response on each route.
  - DB-touching scenario (none today — the OpenAPI surface doesn't read the DB) → Cucumber `tests/behavior/backend/openapi.feature`. Two scenarios: `/docs/json` returns a parseable OpenAPI doc with the healthz path + tag taxonomy; `/docs` returns Swagger UI HTML.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run test:smoke` (Vitest) green; the new `apps/server/src/openapi.test.ts` adds 8 cases to the existing 630, totaling 638.
- `pnpm run test:behavior:smoke` (Cucumber) green; the new `tests/behavior/backend/openapi.feature` adds 2 scenarios to the existing 114, totaling 116.
- `GET /docs/json` returns a parseable OpenAPI 3.x document with `/` and `/healthz` paths, the five-tag taxonomy, and `components.schemas.ErrorEnvelope`.
- `GET /docs` returns the Swagger UI HTML.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Schema mechanism: plain JSON Schema today.** Three alternatives surveyed:
  - **(A) Plain JSON Schema** (chosen). The two existing routes have no request body; the response shapes are tiny (`status` enum, `version` string). Plain JSON Schema is forward-compatible with whichever type provider lands later — both Zod and TypeBox emit JSON Schema that plugs into the same `schema` slot. Picking a type provider today would lock in a vocabulary before the first real route exists to drive the choice.
  - **(B) `fastify-type-provider-zod`** (deferred). The eventual obvious choice — `zod` is already a project dep (ADR 0021's event-envelope work). Defer until a session-management or auth route needs request-body validation; that's when the Zod-vs-TypeBox trade-off has actual constraints to weigh against.
  - **(C) `fastify-type-provider-typebox`** (deferred). TypeBox is the Fastify-blessed default, slightly more idiomatic in pure-Fastify codebases. Same deferral as (B) — pick once a real route needs it.

- **Docs URL: `/docs`.** Two alternatives surveyed:
  - **`/docs`** (chosen). Short, conventional, matches `@fastify/swagger-ui`'s documented default. Sibling URLs (`/docs/json`, `/docs/yaml`, `/docs/static/*`) follow naturally.
  - **`/api/docs`**. Considered for namespace cleanliness once the API surface grows. Rejected today because there is no `/api/*` prefix on any other route; introducing one only for docs creates an inconsistency. If the API later adopts a `/api/v1/*` prefix the docs URL can move with it.

- **Version source: `resolveServerVersion()` helper, fed from `npm_package_version`.** The `/healthz` route already uses this fallback (`'0.0.0'` when the env var is absent); the OpenAPI `info.version` should match so a live-stack diagnostic ("which build is this?") and a generated client ("which contract version was this generated against?") agree. The helper is extracted to `apps/server/src/version.ts` so a future `deployment.prod_container` task can swap the source (e.g., a build-time `APP_VERSION` env var) in one place.

- **Tag taxonomy: fixed five tags.** Three alternatives surveyed:
  - **Fixed list with explicit descriptions** (chosen). Each tag is declared once with a description; the test suite pins the exact ordered list. Adding a tag requires updating `OPENAPI_TAGS`, the Vitest assertion, and the Cucumber scenario — friction by design, because a new product surface deserves the conversation.
  - **Inferred from `schema.tags`**. Swagger would generate the tag list from whichever strings the routes use. Rejected because (a) typos would proliferate silently (`'session'` vs `'sessions'`), and (b) tag descriptions would be impossible without a parallel structure.
  - **Per-feature tag namespaces** (`backend.auth.*`, `backend.sessions.*`). Rejected as over-engineering — the project's audience is one team plus four frontends, not a public marketplace of consumers; flat tag names are enough.

- **Shared error envelope: `addSchema` + custom `refResolver`.** Two implementation paths considered:
  - **`addSchema({ $id: 'ErrorEnvelope', ... })` + custom `refResolver.buildLocalReference`** (chosen). Routes reference the schema as `{ $ref: 'ErrorEnvelope#' }` (the form Fastify's built-in schema store understands). The custom `buildLocalReference` returns `json.$id` so the document carries `components.schemas.ErrorEnvelope` rather than the plugin's default `components.schemas.def-0`. This is the idiomatic Fastify pattern — `addSchema` is the canonical surface for shared schemas, and the plugin lifts them automatically.
  - **Inline `components.schemas` in the swagger options**. Considered — would put the schema in one place without touching the schema store. Rejected because (a) routes would have to reference the schema via the longer `#/components/schemas/ErrorEnvelope` path rather than the short `ErrorEnvelope#` form, (b) Fastify's schema validator wouldn't see the schema so future `assertResponse` or ajv-based validation against the shared shape wouldn't work without duplicating the schema, and (c) the `addSchema` form is what subsequent sibling tasks (session-management, replay) will want for their own shared schemas — using it here sets the template.

- **Auth gate on `/docs` in production: deferred toggle.** Two alternatives surveyed:
  - **Defer with a documented future flag** (chosen). Today there is no auth middleware to gate behind, no production deployment to hide from, and the API surface contains no secrets. The plugin records the future-toggle shape in its header comment (`OPENAPI_PUBLIC=false` env flag) so when the auth surface lands the gate is a one-line addition rather than a new design pass.
  - **Land the flag now, default-on**. Rejected — adding a feature flag for a behavior that has no real production today produces a flag with no test coverage and no operational story. The deferred decision is honest about the gap.

- **Plugin file lives alongside the routes, not inside `routes/`.** `openapi.ts` is at `apps/server/src/openapi.ts` (peer to `server.ts`, `error-handler.ts`) rather than `apps/server/src/routes/openapi.ts`. Rationale: the plugin is bootstrap-level wiring (configures the entire HTTP-doc surface), not a route plugin. The `routes/` folder is for route-owning plugins (`healthzPlugin`); openapi is closer to `error-handler.ts` in structural role.

- **Cucumber step-defs reuse the existing http-server carrier.** No new World fields, no new teardown hook — the `Given an HTTP server built from createServer` step from `http-server.steps.ts` is reused; new step-defs only add OpenAPI-specific assertions (parseable doc, path present, tag list, content-type). Matches the pattern `error-handling.steps.ts` already established.

## Open questions

- **When does the type provider land?** Most likely as part of `backend.session_management.create_session_endpoint` (the first route with a request body to validate). Zod-vs-TypeBox to be picked then with a short ADR; this refinement deliberately does not pre-empt the choice.
- **Production auth gate.** The flag shape (env var name, default value, who exempts what) settles when the auth surface lands.
- **External-documentation file refs.** If a future route's schema grows large enough to want a separate file (e.g., `apps/server/openapi/sessions.yaml`), `@fastify/swagger-ui`'s `baseDir` option supports it. Not exercised today; called out so future readers know the path.
- **Generated-client tooling for the frontends.** Once the API surface is non-trivial the frontends will likely run `openapi-typescript` or `openapi-fetch` against `/docs/json` to generate typed clients. The tooling pick is a frontend-side decision tracked separately.

## Status

**Done** — 2026-05-10. Landed as:

- Plugin: [`apps/server/src/openapi.ts`](../../../apps/server/src/openapi.ts) (exports `openapiPlugin`, `OPENAPI_TAGS`, `OPENAPI_TAG_NAMES`, `errorEnvelopeSchema`, `errorEnvelopeRef`, `ERROR_ENVELOPE_SCHEMA_ID`).
- Shared version helper: [`apps/server/src/version.ts`](../../../apps/server/src/version.ts) (consumed by `routes/healthz.ts` and `openapi.ts`).
- Server wiring: [`apps/server/src/server.ts`](../../../apps/server/src/server.ts) (registers `openapiPlugin` after `errorHandlerPlugin`, before route plugins; attaches a `schema` block to `GET /`).
- Route schema: [`apps/server/src/routes/healthz.ts`](../../../apps/server/src/routes/healthz.ts) (now imports `errorEnvelopeRef` + `resolveServerVersion`; attaches a `schema` block with `tags: ['meta']`).
- Vitest: [`apps/server/src/openapi.test.ts`](../../../apps/server/src/openapi.test.ts) (+8 tests covering HTML / JSON serving, info block, healthz / root path documentation, tag taxonomy, ErrorEnvelope component, 5xx response).
- Cucumber: [`tests/behavior/backend/openapi.feature`](../../../tests/behavior/backend/openapi.feature) (+2 scenarios), step defs at [`tests/behavior/steps/backend-openapi.steps.ts`](../../../tests/behavior/steps/backend-openapi.steps.ts).
- Dependency pins: `@fastify/swagger@9.7.0`, `@fastify/swagger-ui@5.2.6` added to [`apps/server/package.json`](../../../apps/server/package.json).
- `complete 100` marker added in [tasks/20-backend.tji](../../20-backend.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
