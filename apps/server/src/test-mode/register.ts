// Non-production registration gate for the test-mode plugin.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
// TaskJuggler: replay_test.test_mode.test_mode_synthetic_session
//
// `createServer()` calls `registerTestModeRoutes(app)`; the routes are
// mounted ONLY when `NODE_ENV !== 'production'`. In production the
// helper is a no-op and the routes 404 like any unknown path. This is
// the single enforcement of the participant-authorization bypass
// synthetic generation inherently requires (ADR 0041, Decision §1) — the
// same `NODE_ENV` gate the server already uses for CORS lockdown.
//
// The gate keys off an injectable `nodeEnv` (defaulting to
// `process.env.NODE_ENV`) so a unit test can assert "registers when
// non-production, skips when production" without spawning the full
// server (Acceptance §3) — mirroring the `resolveCorsOptions(env)`
// pattern in `server.ts`.

import type { FastifyInstance } from 'fastify';

import { testModeRoutesPlugin, type TestModeRoutesOptions } from './routes.js';

export interface RegisterTestModeOptions extends TestModeRoutesOptions {
  /**
   * The mode discriminator. Defaults to `process.env.NODE_ENV`.
   * `'production'` skips registration; anything else mounts the routes.
   */
  readonly nodeEnv?: string | undefined;
}

/**
 * Register the test-mode routes iff `nodeEnv !== 'production'`.
 *
 * @returns `true` when the routes were registered, `false` when the
 *          production gate skipped them.
 */
export async function registerTestModeRoutes(
  app: FastifyInstance,
  options: RegisterTestModeOptions = {},
): Promise<boolean> {
  const nodeEnv = options.nodeEnv ?? process.env['NODE_ENV'];
  if (nodeEnv === 'production') {
    return false;
  }
  const pluginOpts: TestModeRoutesOptions = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
  };
  await app.register(testModeRoutesPlugin, pluginOpts);
  return true;
}
