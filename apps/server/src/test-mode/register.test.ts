// Vitest cover for the test-mode registration env-gate.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0006-test-framework-vitest.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0041-synthetic-session-generation-dev-gated-seam.md
//
// Pins Constraint §1 without an e2e: `registerTestModeRoutes` mounts the
// synthetic routes when `NODE_ENV !== 'production'` and skips them when
// `NODE_ENV === 'production'`. The gate is the single enforcement of the
// participant-authorization bypass (ADR 0041).

import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerTestModeRoutes } from './register.js';

const SCENARIOS_ROUTE = { method: 'GET', url: '/api/test-mode/synthetic-scenarios' } as const;
const GENERATE_ROUTE = { method: 'POST', url: '/api/test-mode/synthetic-sessions' } as const;

/**
 * Build a minimal app with the error-handler + auth middleware wired
 * (the test-mode routes' `preHandler: app.authenticate` resolves the
 * decorator at registration time), then run the gate against it.
 */
async function buildAppWithGate(
  nodeEnv: string,
): Promise<{ app: FastifyInstance; mounted: boolean }> {
  const { default: fastifyFactory } = await import('fastify');
  const { errorHandlerPlugin } = await import('../error-handler.js');
  const { errorEnvelopeSchema } = await import('../openapi.js');
  const { authenticatePlugin } = await import('../auth/middleware.js');

  const app = fastifyFactory({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  await app.register(authenticatePlugin, { sessionTokenSecret: 'test-secret' });
  const mounted = await registerTestModeRoutes(app, { nodeEnv });
  await app.ready();
  return { app, mounted };
}

describe('registerTestModeRoutes — env gate', () => {
  it('mounts the synthetic routes when NODE_ENV !== production', async () => {
    const { app, mounted } = await buildAppWithGate('development');
    try {
      expect(mounted).toBe(true);
      expect(app.hasRoute(SCENARIOS_ROUTE)).toBe(true);
      expect(app.hasRoute(GENERATE_ROUTE)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('mounts the synthetic routes under NODE_ENV=test too', async () => {
    const { app, mounted } = await buildAppWithGate('test');
    try {
      expect(mounted).toBe(true);
      expect(app.hasRoute(SCENARIOS_ROUTE)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('skips the synthetic routes when NODE_ENV === production', async () => {
    const { app, mounted } = await buildAppWithGate('production');
    try {
      expect(mounted).toBe(false);
      expect(app.hasRoute(SCENARIOS_ROUTE)).toBe(false);
      expect(app.hasRoute(GENERATE_ROUTE)).toBe(false);
    } finally {
      await app.close();
    }
  });
});
