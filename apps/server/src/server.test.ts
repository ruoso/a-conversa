// Tests for the HTTP server bootstrap.
//
// Refinement: tasks/refinements/backend/http_server.md
// ADRs:        docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.api_skeleton.http_server
//
// Coverage:
//   1. `createServer()` resolves with a Fastify instance.
//   2. The trivial `GET /` route returns 200 + `{ status: 'ok' }`.
//   3. CORS is wired — an `OPTIONS /` preflight gets the expected
//      access-control-allow-* headers back, confirming `@fastify/cors`
//      is registered.
//   4. `@fastify/sensible` is wired — `app.httpErrors.notFound()` is
//      callable (the decoration that `error_handling` will build on).
//   5. Unknown routes return 404 (Fastify default 404 handler is in
//      place and not accidentally overridden).
//
// Tests use Fastify's built-in `app.inject(...)` — no port is bound,
// no network round-trip, no race against the OS. The instance is
// constructed in `beforeAll` and closed in `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from './server.js';

describe('createServer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a Fastify instance', () => {
    // Two function decorations Fastify always provides — and one
    // (`httpErrors`) that only appears once `@fastify/sensible` is
    // registered. Checking the trio confirms both the framework and
    // the plugin are in place.
    expect(typeof app.inject).toBe('function');
    expect(typeof app.listen).toBe('function');
    expect(typeof app.httpErrors).toBe('object');
    expect(typeof app.httpErrors.notFound).toBe('function');
  });

  it('GET / returns 200 and { status: "ok" }', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('OPTIONS / advertises CORS via @fastify/cors', async () => {
    // A CORS preflight uses an `Origin` header plus
    // `Access-Control-Request-Method`. `@fastify/cors` reflects the
    // origin back (since we registered with `origin: true`) and adds
    // the access-control-allow-* family.
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: {
        origin: 'http://example.test',
        'access-control-request-method': 'GET',
      },
    });

    // Preflight returns 204 by default with @fastify/cors.
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://example.test');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/this-route-does-not-exist' });

    expect(response.statusCode).toBe(404);
  });

  it('exposes @fastify/sensible httpErrors helpers', () => {
    // `error_handling` will build on these. `notFound()` returning a
    // truthy Error instance is enough to confirm the decoration is
    // wired; deeper coverage belongs to that sibling task.
    const err = app.httpErrors.notFound('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
  });
});
