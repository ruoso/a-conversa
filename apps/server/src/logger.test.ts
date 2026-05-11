// Vitest unit tests for the per-environment logger helper.
//
// Refinement: tasks/refinements/backend/request_logging.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.request_logging
//
// Coverage:
//
//   1. `NODE_ENV=test` → `false` (Fastify disables logging entirely).
//   2. `NODE_ENV=development` → pino-pretty transport at info level.
//   3. `NODE_ENV` unset → pino-pretty transport (dev-default fallback).
//   4. `NODE_ENV=production` → structured JSON (no transport) at info.
//   5. `LOG_LEVEL` is honored in dev and prod modes.
//   6. Invalid `LOG_LEVEL` falls back to `info`.
//   7. End-to-end: a Fastify route built from `createServer({ logger:
//      false })` reflects `request.id` on the response as
//      `x-request-id`. The helper itself is responsible for the
//      logger config; the `onRequest` hook lives in server.ts and is
//      where the response header originates — we exercise both at
//      once via `app.inject(...)` so a regression in either layer
//      surfaces here.
//
// All tests are pure unit tests (no I/O, no DB) per ADR 0006's layer
// routing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createLoggerOptions } from './logger.js';
import { createServer } from './server.js';

// Narrowing shape used by the transport assertions. The Pino options
// object accepted by Fastify has a `transport` field with `target`
// and `options` sub-fields; we only assert against `target` so the
// tests don't lock us in to specific `pino-pretty` option names
// beyond what the helper sets.
interface PinoOptionsShape {
  level?: string;
  transport?: {
    target?: string;
    options?: Record<string, unknown>;
  };
}

describe('createLoggerOptions', () => {
  it('returns false when NODE_ENV=test', () => {
    expect(createLoggerOptions({ NODE_ENV: 'test' })).toBe(false);
  });

  it('returns false when NODE_ENV=test even with LOG_LEVEL set', () => {
    // Test mode is unconditional — LOG_LEVEL doesn't bring the
    // logger back. Tests that want to capture logs pass an
    // explicit `{ logger: { stream } }` override on createServer.
    expect(createLoggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'debug' })).toBe(false);
  });

  it('returns pino-pretty transport when NODE_ENV=development', () => {
    const result = createLoggerOptions({ NODE_ENV: 'development' });
    expect(result).not.toBe(false);
    // Narrow to the options-object branch via runtime check.
    expect(typeof result).toBe('object');
    const opts = result as PinoOptionsShape;
    expect(opts.transport?.target).toBe('pino-pretty');
    expect(opts.level).toBe('info');
  });

  it('returns pino-pretty transport when NODE_ENV is unset (dev default)', () => {
    const result = createLoggerOptions({});
    expect(result).not.toBe(false);
    const opts = result as PinoOptionsShape;
    expect(opts.transport?.target).toBe('pino-pretty');
  });

  it('returns structured JSON (no transport) when NODE_ENV=production', () => {
    const result = createLoggerOptions({ NODE_ENV: 'production' });
    expect(result).not.toBe(false);
    const opts = result as PinoOptionsShape;
    expect(opts.transport).toBeUndefined();
    expect(opts.level).toBe('info');
  });

  it('honors LOG_LEVEL in dev mode', () => {
    const result = createLoggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'debug' });
    const opts = result as PinoOptionsShape;
    expect(opts.level).toBe('debug');
  });

  it('honors LOG_LEVEL in production mode', () => {
    const result = createLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' });
    const opts = result as PinoOptionsShape;
    expect(opts.level).toBe('warn');
  });

  it('falls back to info when LOG_LEVEL is invalid', () => {
    // A typo like `LOG_LEVEL=infor` would otherwise produce a
    // silently broken logger; we narrow to the standard Pino
    // levels and fall back to `'info'` for anything else.
    const result = createLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'infor' });
    const opts = result as PinoOptionsShape;
    expect(opts.level).toBe('info');
  });

  it('falls back to info when LOG_LEVEL is empty string', () => {
    const result = createLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: '' });
    const opts = result as PinoOptionsShape;
    expect(opts.level).toBe('info');
  });

  it('accepts the silent level', () => {
    // `silent` is a valid Pino level — useful in dev when an
    // operator wants pretty output suppressed but the transport
    // still wired (e.g. for a future fan-out plumbing).
    const result = createLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'silent' });
    const opts = result as PinoOptionsShape;
    expect(opts.level).toBe('silent');
  });
});

describe('createServer x-request-id reflection', () => {
  // The `onRequest` hook in server.ts echoes `request.id` (which
  // Fastify generates or reads from the inbound `x-request-id`
  // header per the `requestIdHeader` option) into the response as
  // `x-request-id`. This block exercises the wire-level behavior
  // end-to-end via `app.inject(...)`.

  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets x-request-id on a successful response', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    const header = response.headers['x-request-id'];
    expect(typeof header).toBe('string');
    expect(typeof header === 'string' && header.length > 0).toBe(true);
  });

  it('sets x-request-id on a 404 response (not-found path)', async () => {
    // The `onRequest` hook is registered before any route, so the
    // header propagates to the not-found path too — important for
    // tracing a misrouted request back to the server log.
    const response = await app.inject({ method: 'GET', url: '/no-such-route-ever' });
    expect(response.statusCode).toBe(404);
    const header = response.headers['x-request-id'];
    expect(typeof header).toBe('string');
    expect(typeof header === 'string' && header.length > 0).toBe(true);
  });

  it('reflects an inbound x-request-id header back on the response', async () => {
    // When a client (or upstream load balancer) sends an
    // `x-request-id` header, Fastify's `requestIdHeader: 'x-request-id'`
    // setting makes that value become `request.id`. Our `onRequest`
    // hook echoes it back unchanged — completing the
    // end-to-end-trace contract.
    const supplied = 'client-supplied-trace-12345';
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-request-id': supplied },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(supplied);
  });

  it('generates distinct x-request-id values across requests', async () => {
    // Two requests with no inbound header should each get a
    // freshly-generated id, and the two ids should differ. (The
    // default Fastify generator is a monotonic counter scoped to
    // the instance.)
    const first = await app.inject({ method: 'GET', url: '/' });
    const second = await app.inject({ method: 'GET', url: '/' });
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
