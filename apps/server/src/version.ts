// Shared "what's the server version" helper.
//
// Refinement: tasks/refinements/backend/openapi_or_equivalent.md
// ADRs:        docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.api_skeleton.openapi_or_equivalent
//
// Two callers want the same string today:
//
//   1. `routes/healthz.ts` stamps the version onto the `/healthz`
//      response body so a live-stack diagnostic can answer "which
//      build is answering this probe?"
//   2. `openapi.ts` stamps the version onto the OpenAPI document's
//      `info.version` so a generated client knows which build it
//      was generated against.
//
// Both want the same source of truth — when `deployment.prod_container`
// wires a build-time `APP_VERSION`, both call sites pick up the new
// source via this single helper. Today both fall back to
// `npm_package_version` (set by pnpm / npm at script launch) with
// `'0.0.0'` as the final fallback for direct-`node` invocations from
// the runtime image.

/**
 * Resolve the server's version string.
 *
 * Source precedence:
 *   1. `process.env.npm_package_version` — set by pnpm / npm when the
 *      server is launched via a package script (`pnpm start`,
 *      `pnpm --filter @a-conversa/server run start`).
 *   2. `'0.0.0'` — fallback when the env var is absent. The runtime
 *      image's `CMD ["node", "/app/apps/server/dist/index.js"]`
 *      invokes node directly, which does not set the env var; the
 *      fallback keeps the route / document working without requiring
 *      build-time wiring (deferred to `deployment.prod_container`).
 *
 * The version stamp is a "which build is this" diagnostic, not a
 * load-bearing identifier — the fallback is acceptable.
 */
export function resolveServerVersion(): string {
  return process.env['npm_package_version'] ?? '0.0.0';
}
