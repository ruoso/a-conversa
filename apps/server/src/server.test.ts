// Tests for the HTTP server bootstrap.
//
// Refinement: tasks/refinements/backend/http_server.md
// Also pins: tasks/refinements/backend-hardening/prod_cors_lockdown.md
//            (the dev-vs-prod CORS allowlist; closes
//            docs/security/m3-review/auth.md F-003).
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.http_server,
//              backend_hardening.auth_hardening.prod_cors_lockdown
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
//   6. `resolveCorsOptions` unit-level: dev returns `{ origin: true }`,
//      production reflects only `APP_BASE_URL`'s origin (plus an
//      optional `CORS_ORIGIN_ALLOWLIST`), and missing / malformed prod
//      env throws.
//   7. CORS dev-vs-prod boundary in-process: under
//      `NODE_ENV=production` + `APP_BASE_URL=https://app.example.com`,
//      a preflight from `https://attacker.example` is NOT echoed; a
//      preflight from `https://app.example.com` IS echoed. Under
//      `NODE_ENV=development`, any origin is echoed (dev default).
//
// Tests use Fastify's built-in `app.inject(...)` — no port is bound,
// no network round-trip, no race against the OS. The instance is
// constructed in `beforeAll` and closed in `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer, resolveCorsOptions } from './server.js';

/**
 * Helper that temporarily overrides keys on `process.env`, runs the
 * builder, restores the previous values, and returns the built app.
 * Used by the dev-vs-prod CORS tests so each scenario sees its own
 * env without leaking state across describe blocks (Vitest by default
 * runs files in parallel but tests within a file sequentially; the
 * restore is what keeps neighbouring `it` cases from inheriting the
 * mutation).
 */
async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    saved.set(key, process.env[key]);
    const v = overrides[key];
    if (v === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = v;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, prev] of saved) {
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}

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

// ---- CORS lockdown: closes docs/security/m3-review/auth.md F-003 ----
//
// The unit tests pin the pure helper; the integration tests pin the
// observable wire behavior of a built server. Per ADR 0022, the
// integration cases are the source of truth — they assert against
// the real preflight response, not a mock. The unit tests are kept
// because the boundary conditions (missing APP_BASE_URL in prod;
// malformed CORS_ORIGIN_ALLOWLIST entry) are cheaper to express
// against the function than against a full createServer roundtrip.

describe('resolveCorsOptions', () => {
  it('returns origin: true outside production (dev default)', () => {
    expect(resolveCorsOptions({ NODE_ENV: 'development' })).toEqual({
      origin: true,
      credentials: true,
    });
    expect(resolveCorsOptions({ NODE_ENV: 'test' })).toEqual({
      origin: true,
      credentials: true,
    });
    expect(resolveCorsOptions({})).toEqual({ origin: true, credentials: true });
  });

  it('restricts to APP_BASE_URL origin in production', () => {
    const opts = resolveCorsOptions({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://app.example.com',
    });
    expect(opts).toEqual({
      origin: ['https://app.example.com'],
      credentials: true,
    });
  });

  it('normalizes APP_BASE_URL by stripping path / trailing slash via URL().origin', () => {
    const opts = resolveCorsOptions({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://app.example.com/some/path',
    });
    // `new URL(...).origin` discards path; the allowlist is purely
    // <scheme>://<host>[:port].
    expect(opts).toEqual({
      origin: ['https://app.example.com'],
      credentials: true,
    });
  });

  it('appends CORS_ORIGIN_ALLOWLIST entries (deduped, normalized) in production', () => {
    const opts = resolveCorsOptions({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://app.example.com',
      // Includes a duplicate (post-normalization), a path-bearing entry,
      // and whitespace-padded entries — all normalize via URL().origin
      // and dedupe.
      CORS_ORIGIN_ALLOWLIST:
        'https://app.example.com, https://staging.example.com/, https://preview.example.com/foo',
    });
    expect(opts).toEqual({
      origin: [
        'https://app.example.com',
        'https://staging.example.com',
        'https://preview.example.com',
      ],
      credentials: true,
    });
  });

  it('throws when APP_BASE_URL is missing in production', () => {
    expect(() => resolveCorsOptions({ NODE_ENV: 'production' })).toThrow(
      /APP_BASE_URL must be set/,
    );
  });

  it('throws when APP_BASE_URL is malformed in production', () => {
    expect(() => resolveCorsOptions({ NODE_ENV: 'production', APP_BASE_URL: 'not-a-url' })).toThrow(
      /not a valid URL/,
    );
  });

  it('throws when a CORS_ORIGIN_ALLOWLIST entry is malformed', () => {
    expect(() =>
      resolveCorsOptions({
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://app.example.com',
        CORS_ORIGIN_ALLOWLIST: 'https://ok.example.com, not-a-url',
      }),
    ).toThrow(/CORS_ORIGIN_ALLOWLIST entry "not-a-url"/);
  });
});

describe('createServer — CORS dev-vs-prod boundary (auth.md F-003)', () => {
  it('production: rejects a preflight from an off-allowlist origin', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://app.example.com',
        CORS_ORIGIN_ALLOWLIST: undefined,
        // Auth env stays unset on purpose — the auth-routes plugin
        // is skipped in that case (see server.ts), which is fine
        // for a CORS-only test.
      },
      async () => {
        const app = await createServer({ logger: false });
        await app.ready();
        try {
          const response = await app.inject({
            method: 'OPTIONS',
            url: '/',
            headers: {
              origin: 'https://attacker.example',
              'access-control-request-method': 'GET',
            },
          });
          // `@fastify/cors` omits the `Access-Control-Allow-Origin`
          // header entirely when the inbound `Origin` is not on the
          // allowlist — the browser then refuses the cross-origin
          // response. The status code is still 204 (preflight ack);
          // the absence of the allow-origin header is what enforces
          // the policy.
          expect(response.headers['access-control-allow-origin']).toBeUndefined();
        } finally {
          await app.close();
        }
      },
    );
  });

  it('production: echoes the preflight from APP_BASE_URL origin', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://app.example.com',
        CORS_ORIGIN_ALLOWLIST: undefined,
      },
      async () => {
        const app = await createServer({ logger: false });
        await app.ready();
        try {
          const response = await app.inject({
            method: 'OPTIONS',
            url: '/',
            headers: {
              origin: 'https://app.example.com',
              'access-control-request-method': 'GET',
            },
          });
          expect(response.statusCode).toBe(204);
          expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
          // `credentials: true` survives the lockdown — the same-origin
          // frontend's session-cookie path keeps working.
          expect(response.headers['access-control-allow-credentials']).toBe('true');
        } finally {
          await app.close();
        }
      },
    );
  });

  it('development: echoes any origin (open dev default)', async () => {
    await withEnv(
      {
        NODE_ENV: 'development',
        APP_BASE_URL: undefined,
        CORS_ORIGIN_ALLOWLIST: undefined,
      },
      async () => {
        const app = await createServer({ logger: false });
        await app.ready();
        try {
          const response = await app.inject({
            method: 'OPTIONS',
            url: '/',
            headers: {
              origin: 'https://anything.test',
              'access-control-request-method': 'GET',
            },
          });
          expect(response.statusCode).toBe(204);
          expect(response.headers['access-control-allow-origin']).toBe('https://anything.test');
        } finally {
          await app.close();
        }
      },
    );
  });
});
