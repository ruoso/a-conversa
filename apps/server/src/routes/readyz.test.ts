// Vitest unit tests for the `/readyz` route plugin + the readiness
// state module.
//
// Refinement: tasks/refinements/deployment/health_and_readiness_endpoints.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.health_and_readiness_endpoints
//
// Coverage:
//   1. Ready path: gate completed + db ping ok → 200 with both
//      checks 'ok'.
//   2. DB ping failure (query rejects) → 503, checks.db = 'failed'.
//   3. DB ping timeout (query never settles) → 503 within the
//      2s budget (fake timers).
//   4. Gate not-run → 503, checks.migrations = 'failed', even with
//      a healthy db.
//   5. Explicit operator skip (SKIP_STARTUP_MIGRATIONS) counts as
//      migrations-ok; missing-DATABASE_URL skip does not.
//   6. Throwing pool resolution (no DATABASE_URL → getDefaultPool
//      throws) is a failed db check, not a 500.
//   7. Integration via `createServer()`: the route is wired by the
//      bootstrap; a test instance (gate never ran, no DB) reports
//      503 — catches a regression where server.ts forgets the
//      plugin.
//
// Uses Fastify's built-in `app.inject(...)` — no port bind, no real
// Postgres (ADR 0022).

import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import type { DbPool } from '../db.js';
import {
  __resetMigrationGateState,
  getMigrationGateState,
  isMigrationGateReady,
  markMigrationGateCompleted,
  markMigrationGateSkipped,
} from '../readiness.js';
import { createServer } from '../server.js';
import { readyzPlugin, READYZ_DB_PING_TIMEOUT_MS } from './readyz.js';

/** A pool whose SELECT 1 always succeeds. */
const okPool: DbPool = {
  // The empty rows array satisfies the generic `query<TRow>` return
  // shape without pinning a concrete row type; the handler only cares
  // that the promise resolves.
  query: () => Promise.resolve({ rows: [] }),
};

/** A pool whose SELECT 1 always rejects (DB unreachable). */
const failingPool: DbPool = {
  query: () => Promise.reject(new Error('connection refused')),
};

/** A pool whose SELECT 1 never settles (hung connection). */
const hangingPool: DbPool = {
  query: () => new Promise(() => undefined),
};

async function buildApp(pool?: DbPool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(readyzPlugin, pool === undefined ? {} : { pool });
  await app.ready();
  return app;
}

interface ReadyzBody {
  status?: unknown;
  version?: unknown;
  checks?: { db?: unknown; migrations?: unknown };
}

describe('readiness state module', () => {
  afterEach(() => {
    __resetMigrationGateState();
  });

  it('defaults to not-run, which is not ready', () => {
    expect(getMigrationGateState()).toEqual({ kind: 'not-run' });
    expect(isMigrationGateReady()).toBe(false);
  });

  it('completed gate is ready and records the applied count', () => {
    markMigrationGateCompleted(3);
    expect(getMigrationGateState()).toEqual({ kind: 'completed', appliedCount: 3 });
    expect(isMigrationGateReady()).toBe(true);
  });

  it('explicit operator skip is ready (the escape hatch must stay usable)', () => {
    markMigrationGateSkipped('explicit-skip');
    expect(isMigrationGateReady()).toBe(true);
  });

  it('missing-DATABASE_URL skip is NOT ready', () => {
    markMigrationGateSkipped('no-database-url');
    expect(isMigrationGateReady()).toBe(false);
  });
});

describe('GET /readyz', () => {
  afterEach(() => {
    __resetMigrationGateState();
    vi.useRealTimers();
  });

  it('returns 200 with both checks ok when gate completed and db pings', async () => {
    markMigrationGateCompleted(0);
    const app = await buildApp(okPool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);

    const body = response.json<ReadyzBody>();
    expect(body.status).toBe('ready');
    expect(typeof body.version).toBe('string');
    expect(body.checks).toEqual({ db: 'ok', migrations: 'ok' });

    await app.close();
  });

  it('returns 503 with checks.db=failed when the db ping rejects', async () => {
    markMigrationGateCompleted(0);
    const app = await buildApp(failingPool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);

    const body = response.json<ReadyzBody>();
    expect(body.status).toBe('unavailable');
    expect(body.checks).toEqual({ db: 'failed', migrations: 'ok' });

    await app.close();
  });

  it('returns 503 when the db ping hangs past the timeout', async () => {
    vi.useFakeTimers();
    markMigrationGateCompleted(0);
    const app = await buildApp(hangingPool);

    const pending = app.inject({ method: 'GET', url: '/readyz' });
    // Advance past the ping budget so the timeout branch fires; the
    // hung query promise stays pending forever, which is the point.
    await vi.advanceTimersByTimeAsync(READYZ_DB_PING_TIMEOUT_MS + 1);
    const response = await pending;

    expect(response.statusCode).toBe(503);
    const body = response.json<ReadyzBody>();
    expect(body.checks).toEqual({ db: 'failed', migrations: 'ok' });

    await app.close();
  });

  it('returns 503 with checks.migrations=failed when the gate never ran', async () => {
    // No mark* call — the default not-run state.
    const app = await buildApp(okPool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);

    const body = response.json<ReadyzBody>();
    expect(body.status).toBe('unavailable');
    expect(body.checks).toEqual({ db: 'ok', migrations: 'failed' });

    await app.close();
  });

  it('treats the explicit operator skip as migrations-ok', async () => {
    markMigrationGateSkipped('explicit-skip');
    const app = await buildApp(okPool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json<ReadyzBody>().checks).toEqual({ db: 'ok', migrations: 'ok' });

    await app.close();
  });

  it('treats the missing-DATABASE_URL skip as migrations-failed', async () => {
    markMigrationGateSkipped('no-database-url');
    const app = await buildApp(okPool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json<ReadyzBody>().checks).toEqual({ db: 'ok', migrations: 'failed' });

    await app.close();
  });

  it('counts a throwing pool resolution as a failed db check, not a 500', async () => {
    markMigrationGateCompleted(0);
    // No injected pool → the handler reaches for getDefaultPool(),
    // which throws without DATABASE_URL. Guard the env so the test
    // is deterministic regardless of the outer environment.
    const original = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    const { __resetDefaultPool } = await import('../db.js');
    __resetDefaultPool();

    try {
      const app = await buildApp();
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);
      expect(response.json<ReadyzBody>().checks).toEqual({ db: 'failed', migrations: 'ok' });
      await app.close();
    } finally {
      if (original === undefined) {
        delete process.env['DATABASE_URL'];
      } else {
        process.env['DATABASE_URL'] = original;
      }
      __resetDefaultPool();
    }
  });
});

describe('GET /readyz via createServer() (bootstrap integration)', () => {
  afterEach(() => {
    __resetMigrationGateState();
  });

  it('is wired by the bootstrap and reports 503 on a bare test instance', async () => {
    // A test-constructed server never runs the migration gate and has
    // no reachable DB — /readyz must say so (and the route existing
    // at all pins that server.ts registers the plugin).
    const original = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    const { __resetDefaultPool } = await import('../db.js');
    __resetDefaultPool();

    try {
      const app = await createServer({ logger: false });
      await app.ready();

      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);

      const body = response.json<ReadyzBody>();
      expect(body.status).toBe('unavailable');
      expect(body.checks).toEqual({ db: 'failed', migrations: 'failed' });

      await app.close();
    } finally {
      if (original === undefined) {
        delete process.env['DATABASE_URL'];
      } else {
        process.env['DATABASE_URL'] = original;
      }
      __resetDefaultPool();
    }
  });
});
