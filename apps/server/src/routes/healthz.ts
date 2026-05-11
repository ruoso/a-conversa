// Fastify plugin registering `GET /healthz` — the liveness probe the
// compose `app` service healthcheck targets.
//
// Refinement: tasks/refinements/backend/health_endpoint.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0020-migrations-node-pg-migrate-forward-only.md
//              (the migrations-on-startup gate is wired in
//              apps/server/src/index.ts, not in this route — see
//              the refinement's "Decisions" section)
// TaskJuggler: backend.api_skeleton.health_endpoint
//
// **Semantics: liveness-only.** A 200 here says "the server process is
// running and able to serve HTTP traffic" — nothing more. Specifically
// it does **not** ping the database, validate OIDC reachability, or
// re-check migration state. Those concerns are owned elsewhere:
//
//   - Migration state is gated at startup in `index.ts` via
//     `applyMigrationsOnStartup()`; if migrations are pending and
//     can't be applied, the process aborts before ever binding the
//     port, so `/healthz` cannot return 200 with stale schema.
//   - Database / OIDC readiness is deliberately out of scope for v1.
//     A future `/readyz` (or a `?ready=1` query) can layer that on
//     without breaking the liveness contract — that's tracked as an
//     open question in the refinement.
//
// The compose healthcheck (per ADR 0018 / compose.yaml) execs
// `node -e "http.get('http://localhost:3000/healthz', …)"` against
// this route. Liveness-only is what flips the service from
// `(unhealthy)` to `healthy`; the deeper checks would over-couple the
// healthcheck to dependency availability and cause spurious restarts
// during transient DB blips.

import type { FastifyPluginAsync } from 'fastify';

import { errorEnvelopeRef } from '../openapi.js';
import { resolveServerVersion } from '../version.js';

/**
 * Response shape for `GET /healthz`. Kept explicit so the unit and
 * Cucumber tests assert against the same contract and so a future
 * `/readyz` (which would add `checks: { db, oidc, … }`) is clearly
 * differentiated from this one.
 */
export interface HealthzResponse {
  /** Always the literal `'ok'` when the route returns 200. */
  readonly status: 'ok';
  /**
   * The server's package.json `version`. Identifies which build is
   * answering the probe — useful when chasing "is the rolling deploy
   * done yet?" against a live stack. Sourced from
   * `process.env.npm_package_version` (set by pnpm/npm at script
   * launch) with a `'0.0.0'` fallback for direct-`node` invocations.
   */
  readonly version: string;
}

/**
 * JSON Schema describing the 200 response body. `@fastify/swagger`
 * reads this off the route's `schema.response[200]` slot and renders
 * it in the generated OpenAPI document. Future-route work (sessions,
 * replay, auth) will pick a type provider (Zod or TypeBox) per the
 * `openapi_or_equivalent` refinement; plain JSON Schema is the
 * simplest forward-compatible choice for today's tiny surface.
 */
const healthzResponseSchema = {
  type: 'object',
  required: ['status', 'version'],
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['ok'],
      description: 'Always the literal "ok" when the route returns 200.',
    },
    version: {
      type: 'string',
      description: "The server's package.json version (or '0.0.0' fallback).",
    },
  },
} as const;

/**
 * Fastify plugin that registers `GET /healthz`. Encapsulated as a
 * plugin (rather than an inline `app.get(...)` in `server.ts`) so
 * future readers find the route's full context — semantics, refinement
 * link, sibling ownership — in one file. Pattern matches what the
 * other `api_skeleton` siblings (`error_handling`, `request_logging`,
 * `openapi_or_equivalent`) will use when they land.
 */
export const healthzPlugin: FastifyPluginAsync = (app, _opts) => {
  // Sync handler — there's nothing to await and the lint rule
  // `@typescript-eslint/require-await` would flag a gratuitous `async`.
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['meta'],
        summary: 'Liveness probe',
        description:
          'Returns 200 whenever the server process is running and serving HTTP traffic. ' +
          'Does NOT ping the database or OIDC; readiness is a separate (future) concern. ' +
          'The compose `app` service healthcheck targets this route.',
        response: {
          200: healthzResponseSchema,
          // Liveness-only — the route does not throw under normal
          // operation, but the canonical envelope is still documented
          // here so consumers writing typed clients see the same
          // 5xx shape they would see from any other endpoint that
          // unexpectedly faults.
          '5xx': errorEnvelopeRef,
        },
      },
    },
    (): HealthzResponse => ({
      status: 'ok',
      version: resolveServerVersion(),
    }),
  );

  // FastifyPluginAsync demands a Promise return; the handler itself
  // is sync, so we resolve immediately. Wrapping in `Promise.resolve`
  // keeps the plugin-async contract without an unused `async`
  // keyword that would trigger require-await.
  return Promise.resolve();
};
