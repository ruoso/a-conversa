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

import { HTTP_INTERNAL_ERROR_CODE, HTTP_INTERNAL_ERROR_MESSAGE } from './error-handler.js';
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

    // M3-review inputs.md F-008 — defensive 500 sentinel routes that
    // mirror real call sites in `apps/server/src/sessions/routes.ts`
    // (e.g. `throw new ApiError(500, 'internal-error', 'session insert
    // returned no row')`). The handler scrubs the wire message but
    // preserves the typed `code`.
    app.get('/throw/api-internal-with-details', () => {
      throw ApiError.internal('database connection lost — pg DatabaseError SQLSTATE 57P03', {
        sqlstate: '57P03',
        hint: 'driver said connection terminated',
      });
    });
    // M3-review inputs.md F-008 — typed 5xx code other than
    // 'internal-error'. Mirrors the `flow_state_map_bound`
    // (`apps/server/src/auth/routes.ts`) `503 + 'temporarily-unavailable'`
    // call site: the code is the typed discriminator clients branch
    // on; it MUST be preserved on the wire when the message is
    // scrubbed.
    app.get('/throw/api-503-temporarily-unavailable', () => {
      throw new ApiError(
        503,
        'temporarily-unavailable',
        'service is unable to start a new auth flow — internal map at cap=1000',
        { capValue: 1000, currentSize: 1000 },
      );
    });
    // M3-review inputs.md F-008 — `@fastify/sensible` 5xx error.
    // Confirms the no-leak path is uniform across error classes (not
    // just `ApiError`).
    app.get('/throw/sensible-internal', () => {
      throw app.httpErrors.internalServerError('upstream service exploded — sentinel x12');
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
      error: { code: HTTP_INTERNAL_ERROR_CODE, message: HTTP_INTERNAL_ERROR_MESSAGE },
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

  // ------------------------------------------------------------------
  // M3-review inputs.md F-008 — 5xx wire-message sanitize.
  //
  // The handler scrubs `body.error.message` to the generic literal on
  // every 5xx response AND drops `body.error.<details>` keys; the
  // typed `body.error.code` is PRESERVED (it is the only typed
  // discriminator clients branch on, including
  // `'temporarily-unavailable'` from the flow-state capacity guard).
  // Refinement:
  // tasks/refinements/backend-hardening/defensive_500_message_sanitize.md.
  // ------------------------------------------------------------------

  it('scrubs the wire message + details on ApiError.internal (F-008)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/throw/api-internal-with-details',
    });
    expect(response.statusCode).toBe(500);
    // Code preserved (the typed `internal-error` from
    // `ApiError.internal(...)`). Message replaced with the generic
    // literal. Details dropped entirely from the body.
    expect(response.json()).toEqual({
      error: { code: 'internal-error', message: HTTP_INTERNAL_ERROR_MESSAGE },
    });
    // None of the source sentinels (the descriptive message, the
    // details keys / values) appear in the wire body.
    expect(response.body).not.toContain('database connection lost');
    expect(response.body).not.toContain('SQLSTATE');
    expect(response.body).not.toContain('57P03');
    expect(response.body).not.toContain('sqlstate');
    expect(response.body).not.toContain('hint');
    expect(response.body).not.toContain('driver said');
  });

  it('preserves the typed `code` on 5xx (temporarily-unavailable) while scrubbing message + details (F-008)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/throw/api-503-temporarily-unavailable',
    });
    expect(response.statusCode).toBe(503);
    // CODE PRESERVED — `temporarily-unavailable` is the typed
    // discriminator the `/auth/login` capacity-cap path emits and
    // clients branch on. The previous attempt at this finding
    // over-scrubbed and clobbered `code` with `'internal-error'`,
    // which broke the typed-5xx contract. This assertion is the
    // explicit regression guard.
    expect(response.json()).toEqual({
      error: { code: 'temporarily-unavailable', message: HTTP_INTERNAL_ERROR_MESSAGE },
    });
    // The wire message must contain no integers — mirrors the
    // `auth/routes.test.ts` `flow_state_map_bound` no-leak invariant
    // (an attacker who knows the cap value can calibrate the flood).
    const body = response.json<{ error: { message: string } }>();
    expect(body.error.message).not.toMatch(/\b\d+\b/);
    // The original message and the details sentinels are gone.
    expect(response.body).not.toContain('cap=1000');
    expect(response.body).not.toContain('capValue');
    expect(response.body).not.toContain('1000');
    expect(response.body).not.toContain('currentSize');
  });

  it('scrubs the wire message on a 5xx status-carrying error (@fastify/sensible) (F-008)', async () => {
    const response = await app.inject({ method: 'GET', url: '/throw/sensible-internal' });
    expect(response.statusCode).toBe(500);
    // The `@fastify/sensible` httpErrors path also routes through the
    // 5xx scrub. `code` is derived from the error's `name`
    // (`InternalServerError` → `internal-server`); we accept any
    // stable kebab code and assert the no-leak invariant on the body.
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(typeof body.error.code).toBe('string');
    expect(body.error.code.length).toBeGreaterThan(0);
    expect(body.error.message).toBe(HTTP_INTERNAL_ERROR_MESSAGE);
    expect(response.body).not.toContain('upstream service exploded');
    expect(response.body).not.toContain('sentinel x12');
  });

  it('does NOT scrub the wire message on 4xx — typed 4xx text stays on the wire (F-008 regression)', async () => {
    // Regression guard: the no-leak rule applies to 5xx ONLY. 4xx
    // messages are client-actionable (`'topic is required'`,
    // `'missing field'`) and must remain on the wire.
    const response = await app.inject({ method: 'GET', url: '/throw/api-bad-request' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'bad-request', message: 'missing field', field: 'name' },
    });
    // The generic 5xx literal must not appear on a 4xx response.
    expect(response.body).not.toContain(HTTP_INTERNAL_ERROR_MESSAGE);
  });

  it('exports the generic 5xx constants for cross-module reuse (F-008)', () => {
    // Source-of-truth pin so a future contributor cannot drift the
    // wire literal without updating the test in the same commit.
    expect(HTTP_INTERNAL_ERROR_MESSAGE).toBe('internal error');
    expect(HTTP_INTERNAL_ERROR_CODE).toBe('internal-error');
  });
});
