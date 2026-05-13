// Vitest unit tests for the `/healthz` route plugin.
//
// Refinement: tasks/refinements/backend/health_endpoint.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.health_endpoint
//
// Coverage:
//   1. `GET /healthz` returns 200.
//   2. The response body is `{ status: 'ok', version: <string> }`.
//   3. The `version` field is sourced from `npm_package_version` when
//      set; falls back to `'0.0.0'` when absent. The fallback matters
//      because the runtime image's `node` CMD launch does not set
//      `npm_package_version`.
//   4. The route registers via `createServer()` (integration with the
//      full bootstrap), not only via direct plugin registration —
//      catches a regression where `server.ts` forgets to wire the
//      plugin.
//
// Uses Fastify's built-in `app.inject(...)` — no port bind, no
// network. See ADR 0022: the route's behavior is a permanent
// regression test, not a one-shot probe.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../server.js';

describe('GET /healthz', () => {
  let app: FastifyInstance;
  // Captured at suite-start so per-test mutation of
  // `npm_package_version` doesn't leak across the suite.
  let originalVersion: string | undefined;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    originalVersion = process.env['npm_package_version'];
  });

  afterEach(() => {
    // Restore the original (or delete the key if it was unset). Both
    // shapes matter because `exactOptionalPropertyTypes` rejects
    // assigning `undefined`.
    if (originalVersion === undefined) {
      delete process.env['npm_package_version'];
    } else {
      process.env['npm_package_version'] = originalVersion;
    }
  });

  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
  });

  it('returns JSON with status="ok" and a version string', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['content-type']).toMatch(/application\/json/);

    // `response.json<T>()` is generic with `T = any` upstream; calling
    // it with an explicit type parameter narrows the return without
    // an `as` cast (which ESLint flags as redundant against `any`).
    const body = response.json<{ status?: unknown; version?: unknown }>();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.version === 'string' && body.version.length > 0).toBe(true);
  });

  it('reads version from npm_package_version when set', async () => {
    process.env['npm_package_version'] = '9.9.9-test';
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    const body = response.json<{ version?: unknown }>();
    expect(body.version).toBe('9.9.9-test');
  });

  it('falls back to "0.0.0" when npm_package_version is unset', async () => {
    delete process.env['npm_package_version'];
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    const body = response.json<{ version?: unknown }>();
    expect(body.version).toBe('0.0.0');
  });

  it('does NOT carry Cache-Control: no-store (negative pin for G-019)', async () => {
    // The `Cache-Control: no-store` directive lives on identity /
    // cookie-bearing endpoints (`/auth/me`, `/auth/logout`,
    // `/auth/callback`, `/auth/screen-name`) — see
    // docs/security/m3-review/coverage.md G-019 + the dedicated
    // describe block in apps/server/src/auth/session-token.test.ts.
    // `/healthz` is a public liveness probe and does NOT carry
    // per-user state, so it MUST NOT inherit the directive — a
    // future refactor that over-applies the header (e.g. via a global
    // `onSend` hook) would break healthcheck cacheability for
    // intermediate probes. This pin guards against that drift.
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
