// Vitest tests for the centralized error-handler plugin.
//
// Refinement: tasks/refinements/backend/error_handling.md
// TaskJuggler: backend.api_skeleton.error_handling
//
// Each test builds a real Fastify instance via `createServer({ logger:
// false })`, registers an ad-hoc test route that throws the error
// class under test, and asserts the serialized response via
// `app.inject(...)`. Using the real bootstrap (rather than a
// hand-rolled Fastify instance) verifies the plugin is wired into
// `server.ts` correctly — encapsulation regressions would surface as
// the handler not firing.
//
// The logger is silenced (`{ logger: false }`) for all cases EXCEPT
// the raw-Error case, which wants to verify the stack lands in the
// log. That one passes a tiny in-memory logger stream to capture
// what's logged.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { ApiError } from './errors.js';
import { EventValidationError } from './events/validate.js';
import { createServer } from './server.js';

describe('error-handler plugin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });

    // Test routes — added before `ready()` so `inject(...)` sees them.
    // Each route throws a specific kind of error to exercise one
    // branch of the handler's dispatch.
    app.get('/throw/api-bad-request', () => {
      throw ApiError.badRequest('missing field', { field: 'name' });
    });
    app.get('/throw/api-not-found', () => {
      throw ApiError.notFound('user not found');
    });
    app.get('/throw/raw-error', () => {
      throw new Error('boom — should not leak to client');
    });
    app.get('/throw/event-validation', () => {
      throw new EventValidationError('payload shape mismatch', {
        code: 'payload-invalid',
        kind: 'proposal',
        issues: [{ path: 'payload.statement_text', message: 'required', code: 'invalid_type' }],
      });
    });
    app.get('/throw/sensible-not-found', () => {
      // `@fastify/sensible` `httpErrors.notFound()` returns a status-
      // carrying Error subclass; throwing it routes the error
      // through `setErrorHandler` rather than Fastify's built-in
      // 404 path. The handler's `isStatusCarryingError` branch
      // passes the 404 through with the canonical envelope.
      throw app.httpErrors.notFound('resource missing');
    });
    app.get('/throw/sensible-conflict', () => {
      throw app.httpErrors.conflict('state conflict');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializes ApiError.badRequest with details under the envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/api-bad-request' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.json()).toEqual({
      error: {
        code: 'bad-request',
        message: 'missing field',
        field: 'name',
      },
    });
  });

  it('serializes ApiError.notFound at status 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/api-not-found' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not-found', message: 'user not found' },
    });
  });

  it('returns the generic 500 envelope for raw Error and never leaks the stack', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/raw-error' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'internal-error', message: 'Internal server error' },
    });
    // The raw error's message must not appear in the response body
    // anywhere — sanitization is part of the contract.
    expect(response.body).not.toContain('boom');
    // No stack frames in the body (`at ` is the standard V8 stack
    // prefix; conservative grep across the raw body string).
    expect(response.body).not.toMatch(/\bat\s+\/?[A-Za-z]/);
  });

  it('serializes EventValidationError at 422 with kind + issues', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/event-validation' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: 'payload-invalid',
        message: 'payload shape mismatch',
        kind: 'proposal',
        issues: [{ path: 'payload.statement_text', message: 'required', code: 'invalid_type' }],
      },
    });
  });

  it('passes through @fastify/sensible httpErrors with the canonical envelope (notFound)', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/sensible-not-found' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not-found', message: 'resource missing' },
    });
  });

  it('passes through @fastify/sensible httpErrors with the canonical envelope (conflict)', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/sensible-conflict' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'conflict', message: 'state conflict' },
    });
  });

  it('routes unknown paths through the not-found handler with the canonical envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-such-route-at-all' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.json()).toEqual({
      error: { code: 'not-found', message: 'Route not found' },
    });
  });
});
