// Fastify plugin registering `@fastify/swagger` (OpenAPI 3.x generator)
// and `@fastify/swagger-ui` (HTML viewer) on the root scope.
//
// Refinement: tasks/refinements/backend/openapi_or_equivalent.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.openapi_or_equivalent
//
// **What this plugin does**:
//
//   1. Registers `@fastify/swagger` so every route registered AFTER
//      this plugin contributes its `schema` block to a generated
//      OpenAPI 3.x document. `@fastify/swagger` reads each route's
//      `schema` field at startup and assembles a single
//      `app.swagger()` document.
//   2. Registers `@fastify/swagger-ui` at `/docs`, which serves the
//      Swagger UI HTML and exposes the OpenAPI JSON at `/docs/json`
//      (the plugin's documented default for the JSON route under the
//      configured `routePrefix`). Frontends and external consumers
//      can fetch `/docs/json` to generate typed clients.
//   3. Pre-declares the canonical error envelope schema as
//      `components.schemas.ErrorEnvelope` so each route's
//      `schema.response.4xx` / `5xx` can reference a single shared
//      definition rather than repeating the shape inline. Mirrors
//      the runtime envelope the `error-handler.ts` plugin emits.
//   4. Declares the project-wide tag taxonomy (`meta`, `auth`,
//      `sessions`, `events`, `replay`). Each future route attaches
//      `tags: ['<tag>']` so Swagger UI groups them cleanly. The tag
//      list is fixed here so adding a new route doesn't accidentally
//      grow the taxonomy out of band.
//
// **Registration order matters.** `server.ts` registers this plugin
// AFTER `@fastify/sensible` / `@fastify/cors` / the error-handler
// plugin but BEFORE the route plugins (`healthzPlugin` etc.). Routes
// registered before `@fastify/swagger` are invisible to the generated
// document — the plugin only inspects routes that exist at the time
// it runs its onReady hook, and Fastify's plugin-encapsulation model
// means subsequent registrations are visible because this plugin is
// wrapped with `fastify-plugin` (skip-override) to attach to the root
// scope.
//
// **Schema mechanism: plain JSON Schema today.** The trivial routes
// (`GET /`, `GET /healthz`) describe responses with inline JSON
// Schema objects. The first route that needs request-body validation
// (likely session-management) will pick a type provider
// (`fastify-type-provider-zod` or TypeBox) per the refinement's
// Decisions. Today's JSON Schema is forward-compatible: the type
// provider's generated schemas plug into the same `schema` slot and
// `@fastify/swagger` reads them the same way.
//
// **No auth gate today.** The OpenAPI document and Swagger UI are
// served unauthenticated. Production deployments will likely want to
// gate them behind a feature flag or auth middleware once the auth
// surface lands — the refinement records this as a follow-up. The
// gate is a one-line `if (env.OPENAPI_PUBLIC === 'false') return;`
// added to the plugin once the production-config story is ready.

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { resolveServerVersion } from './version.js';

/**
 * The project-wide tag taxonomy. Every route's `schema.tags` field
 * must use one of these strings; the generated document declares
 * them at the top level so Swagger UI renders them in a stable
 * order with a one-line description.
 *
 * Tag descriptions are deliberately short — the route summaries
 * carry the real per-endpoint detail. Adding a new tag is a
 * deliberate cross-cutting decision (a new product surface), not
 * a per-route choice.
 *
 *   - `meta` — server-meta and operational routes (`/`, `/healthz`,
 *     future `/readyz`). Not part of the product API.
 *   - `auth` — OAuth callback, session-token issuance, screen-name
 *     collection. Owned by `backend.auth`.
 *   - `sessions` — debate-session lifecycle (create, list, fetch,
 *     end, toggle-privacy, participant assignment). Owned by
 *     `backend.session_management`.
 *   - `events` — event log inspection (paginated GET; the write
 *     path is over WebSocket, not HTTP). Owned by
 *     `backend.replay_endpoints.get_session_log`.
 *   - `replay` — projected state at log position, snapshot list +
 *     fetch. Owned by `backend.replay_endpoints`.
 */
export const OPENAPI_TAGS = [
  { name: 'meta', description: 'Server-meta and operational endpoints.' },
  { name: 'auth', description: 'Authentication and session-token issuance.' },
  { name: 'sessions', description: 'Debate-session lifecycle endpoints.' },
  { name: 'events', description: 'Event log inspection (write path is WebSocket).' },
  { name: 'replay', description: 'Replay and history (projected state, snapshots).' },
] as const;

/**
 * The list of tag NAMES, in declaration order. The Vitest suite asserts
 * the generated document carries exactly this set so a future addition
 * to `OPENAPI_TAGS` lands a corresponding test update — not a silent
 * vocabulary drift.
 */
export const OPENAPI_TAG_NAMES = OPENAPI_TAGS.map((t) => t.name);

/**
 * The canonical error envelope schema, mirroring the runtime shape the
 * `error-handler.ts` plugin emits: `{ error: { code, message, ... } }`.
 *
 * Exported as a plain JSON Schema object so route `schema.response.4xx`
 * / `5xx` slots can reference it via `{ $ref: '#/components/schemas/ErrorEnvelope' }`.
 * The `additionalProperties: true` under `error` honors the runtime
 * "spread structured details under the error key" behavior — clients
 * read `body.error.code` and `body.error.message` consistently, and
 * any extra fields (e.g. `issues` for validation errors, `kind` /
 * `issues` for `EventValidationError`) ride alongside without breaking
 * the schema.
 *
 * Kept as a top-level export (not just inline in the plugin) so
 * future route schemas in sibling tasks can import the same constant
 * — drift between the runtime envelope and the documented schema is
 * caught at compile time rather than at API-doc review time.
 */
export const ERROR_ENVELOPE_SCHEMA_ID = 'ErrorEnvelope';

export const errorEnvelopeSchema = {
  $id: ERROR_ENVELOPE_SCHEMA_ID,
  type: 'object',
  required: ['error'],
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      additionalProperties: true,
      properties: {
        code: {
          type: 'string',
          description:
            'Kebab-case error discriminator. Stable across releases; clients may switch on it.',
        },
        message: {
          type: 'string',
          description: 'Human-readable summary safe to render to an end user.',
        },
      },
    },
  },
};

/**
 * `$ref` to the shared error envelope. Route handlers attach this to
 * `schema.response.4xx` / `5xx` so every endpoint documents the same
 * error shape without duplicating the schema body. The string form
 * (`'ErrorEnvelope#'`) targets Fastify's schema store — the openapi
 * plugin registers `errorEnvelopeSchema` via `app.addSchema(...)` at
 * startup, and `@fastify/swagger` resolves the ref into the generated
 * document's `components.schemas.ErrorEnvelope` entry.
 */
export const errorEnvelopeRef = { $ref: `${ERROR_ENVELOPE_SCHEMA_ID}#` };

/**
 * Build the OpenAPI metadata block. Keeps the title / version / tags
 * in one place; `version` is sourced from the server's
 * `npm_package_version` (with `'0.0.0'` fallback) via the shared
 * `resolveServerVersion` helper, so a published API doc matches the
 * deployed build.
 *
 * Shared schemas (the error envelope) are registered separately via
 * `app.addSchema(...)` rather than inlined here; `@fastify/swagger`
 * lifts the addSchema entries into `components.schemas` automatically,
 * so the document still carries the `ErrorEnvelope` entry that route
 * `$ref: 'ErrorEnvelope#'` references.
 */
function buildSwaggerOptions(): Parameters<typeof swagger>[1] {
  return {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'a-conversa API',
        description:
          'HTTP and operational surface for the a-conversa debate platform. ' +
          'The realtime event-write path is WebSocket, not HTTP — see the ' +
          'WebSocket protocol documentation for the propose/vote/commit ' +
          'message envelope. This OpenAPI document covers session lifecycle, ' +
          'authentication, event-log inspection, replay/snapshot endpoints, ' +
          'and operational routes.',
        version: resolveServerVersion(),
      },
      tags: [...OPENAPI_TAGS],
    },
    // Preserve the `$id` of `addSchema`-registered schemas as the
    // `components.schemas` key. The plugin's default resolver names
    // every shared schema `def-${i}` and merely copies the `$id` into
    // a `title` field — which means `ErrorEnvelope` (registered via
    // `addSchema({ $id: 'ErrorEnvelope', ... })`) would appear as
    // `components.schemas.def-0` in the document. Overriding the
    // resolver here keeps the schema name stable so consumers (typed
    // client generators, hand-written client code) can reference
    // `#/components/schemas/ErrorEnvelope` without depending on
    // generation order.
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        // `json.$id` is what `addSchema` puts on the schema; fall back
        // to the plugin's default (`def-${i}`) for any unnamed shared
        // schema so the resolver still produces a unique reference.
        const id = typeof json['$id'] === 'string' ? json['$id'] : null;
        return id ?? `def-${String(i)}`;
      },
    },
  };
}

/**
 * Build the Swagger-UI mount options. `routePrefix: '/docs'` puts the
 * UI at `/docs` and the OpenAPI JSON at `/docs/json` (the plugin's
 * default JSON path under the configured prefix).
 *
 * `staticCSP: true` adds a Content-Security-Policy header tight enough
 * for the bundled assets — no inline scripts beyond what swagger-ui
 * itself needs. Production may want to override this once a
 * site-wide CSP lands; today's value is safe-by-default.
 */
function buildSwaggerUiOptions(): Parameters<typeof swaggerUi>[1] {
  return {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: {
      // Tag groups expanded by default; route blocks collapsed. Matches
      // the "scan the API surface" reading pattern; per-route detail is
      // one click away.
      docExpansion: 'list',
      // Display the request body schema in addition to the example.
      // The default ('example') hides the schema unless toggled — for
      // a contract-first API doc the schema is the load-bearing view.
      defaultModelRendering: 'model',
    },
  };
}

/**
 * The plugin body. Wrapped by `fastify-plugin` below so the swagger /
 * swagger-ui registrations attach to the root scope and pick up every
 * route registered after this plugin (including those inside other
 * plugins).
 *
 * Order inside the plugin:
 *
 *   1. Register the shared error-envelope schema via `addSchema(...)`
 *      so route `$ref: 'ErrorEnvelope#'` resolves at handler-attach
 *      time (Fastify uses its built-in schema store to satisfy refs;
 *      `@fastify/swagger` lifts the registered schemas into the
 *      generated `components.schemas` entry).
 *   2. Register `@fastify/swagger` so the OpenAPI generator is
 *      armed for the routes registered after this plugin.
 *   3. Register `@fastify/swagger-ui` so `/docs` + `/docs/json`
 *      come online.
 */
const openapiPluginAsync: FastifyPluginAsync = async (app: FastifyInstance, _opts) => {
  app.addSchema(errorEnvelopeSchema);
  await app.register(swagger, buildSwaggerOptions());
  await app.register(swaggerUi, buildSwaggerUiOptions());
};

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * swagger / swagger-ui decorations attach to the parent scope rather
 * than the plugin's encapsulation child. Named via the plugin
 * metadata so `app.printPlugins()` shows it under a stable label.
 */
export const openapiPlugin = fp(openapiPluginAsync, {
  name: 'a-conversa-openapi',
  fastify: '5.x',
});
