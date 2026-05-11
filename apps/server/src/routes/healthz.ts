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
 * Resolve the server's version string. Reads
 * `process.env.npm_package_version`, which pnpm and npm set when the
 * server is launched via a package script (`pnpm start`,
 * `pnpm --filter @a-conversa/server run start`). When the runtime
 * image's `CMD ["node", "/app/apps/server/dist/index.js"]` invokes
 * node directly, the env var is absent — fall back to the literal
 * `'0.0.0'` rather than trying to read package.json from disk, which
 * would require knowing the runtime layout and would be a separate
 * piece of infrastructure to maintain. The version stamp is a "which
 * build is this" diagnostic, not a load-bearing identifier; the
 * fallback is acceptable until `deployment.prod_container` wires a
 * build-time `APP_VERSION` env var.
 */
function resolveVersion(): string {
  return process.env['npm_package_version'] ?? '0.0.0';
}

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
    (): HealthzResponse => ({
      status: 'ok',
      version: resolveVersion(),
    }),
  );

  // FastifyPluginAsync demands a Promise return; the handler itself
  // is sync, so we resolve immediately. Wrapping in `Promise.resolve`
  // keeps the plugin-async contract without an unused `async`
  // keyword that would trigger require-await.
  return Promise.resolve();
};
