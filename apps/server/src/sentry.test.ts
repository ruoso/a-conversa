// Vitest unit tests for the Sentry init + Fastify error-capture
// module.
//
// Refinement: tasks/refinements/deployment/error_tracking.md
// ADRs:        docs/adr/0033-production-observability-railway-sentry.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: deployment.observability.error_tracking
//
// Coverage:
//   1. DSN-absent no-op: `initSentry({})` and `initSentry({ SENTRY_DSN: '' })`
//      return false and leave the SDK uninitialized — the structural
//      guarantee that dev / CI / test stacks never arm Sentry.
//   2. DSN present: the SDK initializes with the agreed options —
//      environment from NODE_ENV (with the 'development' fallback),
//      release from resolveServerVersion(), tracing left disabled.
//   3. End-to-end capture: with the SDK armed via a `beforeSend`
//      that records-and-drops events (nothing leaves the process),
//      `attachSentryErrorCapture` enrolls a thrown route error into
//      Sentry while the HTTP response keeps the canonical
//      `{ error: { code, message } }` envelope.
//
// **Ordering matters in this file.** The SDK is a process-global
// singleton with no public de-init; the no-op tests MUST run before
// any test that calls `Sentry.init`. Vitest executes describe blocks
// in source order, so the file's layout is the mechanism.
//
// No network: the fake DSN points at an .invalid hostname AND every
// armed test drops events in `beforeSend` before the transport ever
// sees them (ADR 0022 — assertions run against the captured event).

import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from './error-handler.js';
import { attachSentryErrorCapture, initSentry } from './sentry.js';
import { resolveServerVersion } from './version.js';

/**
 * Syntactically valid DSN that can never resolve (`.invalid` is
 * reserved, RFC 2606). Belt-and-suspenders: `beforeSend` already
 * drops every event before the transport runs.
 */
const FAKE_DSN = 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.invalid/1';

describe('initSentry — DSN-absent no-op (must run before any armed test)', () => {
  it('returns false and stays uninitialized when SENTRY_DSN is unset', () => {
    expect(initSentry({})).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
  });

  it('returns false and stays uninitialized when SENTRY_DSN is empty', () => {
    expect(initSentry({ SENTRY_DSN: '' })).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
  });

  it('attachSentryErrorCapture is a no-op on an unarmed process', async () => {
    // Pin the guard: with the SDK uninitialized, attaching must not
    // throw and must not alter the instance's error behavior.
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    attachSentryErrorCapture(app);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ error?: { code?: string } }>();
    expect(typeof body.error?.code).toBe('string');

    await app.close();
  });
});

describe('initSentry — armed options', () => {
  afterAll(async () => {
    await Sentry.close(0);
  });

  it('initializes with environment from NODE_ENV and release from resolveServerVersion', () => {
    expect(initSentry({ SENTRY_DSN: FAKE_DSN, NODE_ENV: 'production' })).toBe(true);
    expect(Sentry.isInitialized()).toBe(true);

    const options = Sentry.getClient()?.getOptions();
    expect(options?.environment).toBe('production');
    expect(options?.release).toBe(resolveServerVersion());
    // Error tracking only (ADR 0033): tracing stays disabled because
    // neither tracesSampleRate nor tracesSampler is configured.
    expect(options?.tracesSampleRate).toBeUndefined();
    expect(options?.tracesSampler).toBeUndefined();
  });

  it("falls back to environment='development' when NODE_ENV is unset", () => {
    expect(initSentry({ SENTRY_DSN: FAKE_DSN })).toBe(true);
    expect(Sentry.getClient()?.getOptions().environment).toBe('development');
  });
});

describe('attachSentryErrorCapture — route errors enroll, envelope intact', () => {
  afterAll(async () => {
    await Sentry.close(0);
  });

  it('captures a thrown route error while the canonical 5xx envelope still serves', async () => {
    const captured: Sentry.ErrorEvent[] = [];
    expect(
      initSentry(
        { SENTRY_DSN: FAKE_DSN, NODE_ENV: 'test' },
        {
          beforeSend: (event) => {
            captured.push(event);
            // Returning null drops the event before the transport —
            // nothing leaves the process.
            return null;
          },
        },
      ),
    ).toBe(true);

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    attachSentryErrorCapture(app);
    app.get('/boom', () => {
      throw new Error('sentry-e2e-kaboom');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom' });

    // The envelope handler still owns the response shape.
    expect(response.statusCode).toBe(500);
    const body = response.json<{ error?: { code?: string; message?: string } }>();
    expect(typeof body.error?.code).toBe('string');
    expect(typeof body.error?.message).toBe('string');

    // Event processing is async; flush drains it through beforeSend.
    await Sentry.flush(2_000);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const values = captured.flatMap((event) => event.exception?.values ?? []);
    expect(values.some((v) => v.value === 'sentry-e2e-kaboom')).toBe(true);

    await app.close();
  });
});
