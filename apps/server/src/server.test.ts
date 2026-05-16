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
//   2. `GET /` returns the moderator SPA's `index.html` (200, HTML
//      content-type) — single-origin deployment per
//      `backend.api_skeleton.serve_static_frontends`. The previous
//      `{ status: 'ok' }` bootstrap smoke route has been removed.
//   3. CORS is wired — an `OPTIONS /healthz` preflight gets the
//      expected access-control-allow-* headers back, confirming
//      `@fastify/cors` is registered. (Was `OPTIONS /` before; `/` is
//      now an SPA route which @fastify/cors still preflights, but
//      `/healthz` is more semantically a CORS-relevant API surface.)
//   4. `@fastify/sensible` is wired — `app.httpErrors.notFound()` is
//      callable (the decoration that `error_handling` will build on).
//   5. Unknown JSON-Accept routes return the canonical 404 envelope
//      (the SPA fallback is asserted by static-frontends.test.ts).
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

import {
  BODY_LIMIT_ENV,
  createServer,
  DEFAULT_BODY_LIMIT_BYTES,
  resolveBodyLimit,
  resolveCorsOptions,
} from './server.js';

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

  it('GET / serves the root host index.html (single-origin deployment)', async () => {
    // The previous `{ status: 'ok' }` bootstrap smoke at `/` is gone
    // — `staticFrontendsPlugin` now mounts the root host's `dist/` at
    // the root. The compiled `index.html` shipped by Vite contains the
    // `<div id="root"></div>` mount point and a `<script type="module"
    // src="/assets/index-<hash>.js">` tag. Pin the structural markers
    // rather than the full HTML so a future bundler change (hash-suffix
    // tweak, Tailwind injection variant) doesn't flake the test.
    //
    // Detailed static-serving coverage (assets, Accept-discriminator
    // fallback, missing-dist boot failure) lives in
    // `routes/static-frontends.test.ts` per ADR 0022.
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    const body = response.body;
    expect(body).toContain('<div id="root"></div>');
    expect(body).toContain('A Conversa - Root');
  });

  it('OPTIONS /healthz advertises CORS via @fastify/cors', async () => {
    // A CORS preflight uses an `Origin` header plus
    // `Access-Control-Request-Method`. `@fastify/cors` reflects the
    // origin back (since we registered with `origin: true`) and adds
    // the access-control-allow-* family.
    //
    // We preflight `/healthz` (rather than `/` as before) because `/`
    // is now an SPA HTML route, and `/healthz` is the canonical
    // CORS-relevant API surface this test cares about exercising.
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/healthz',
      headers: {
        origin: 'http://example.test',
        'access-control-request-method': 'GET',
      },
    });

    // Preflight returns 204 by default with @fastify/cors.
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://example.test');
  });

  it('returns 404 envelope for unknown routes (JSON Accept)', async () => {
    // The static-frontends plugin's SPA-fallback handler returns the
    // SPA's `index.html` for `Accept: text/html` and the canonical
    // JSON 404 envelope otherwise. This test pins the JSON path; the
    // HTML fallback is asserted by `routes/static-frontends.test.ts`.
    const response = await app.inject({
      method: 'GET',
      url: '/this-route-does-not-exist',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
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

// ---- bodyLimit: closes docs/security/m3-review/inputs.md F-002 ----
//
// The unit tests pin the env-driven resolver; the integration tests
// pin the observable wire behavior of a built server. Per ADR 0022,
// the integration cases (POST a body that exceeds the limit → 413;
// POST a body under the limit → handler runs) are the source of
// truth; the resolver tests are the cheap boundary-condition pin.
//
// Refinement: tasks/refinements/backend-hardening/fastify_body_limit.md.

describe('resolveBodyLimit', () => {
  it('returns DEFAULT_BODY_LIMIT_BYTES (64 KiB) when BODY_LIMIT_BYTES is absent', () => {
    expect(DEFAULT_BODY_LIMIT_BYTES).toBe(64 * 1024);
    expect(resolveBodyLimit({})).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('returns the default when BODY_LIMIT_BYTES is the empty string', () => {
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: '' })).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('returns the default when BODY_LIMIT_BYTES is unparseable', () => {
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: 'NaN' })).toBe(DEFAULT_BODY_LIMIT_BYTES);
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: 'not-a-number' })).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('returns the default when BODY_LIMIT_BYTES is zero or negative', () => {
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: '0' })).toBe(DEFAULT_BODY_LIMIT_BYTES);
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: '-1' })).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('returns the parsed positive integer otherwise', () => {
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: '8192' })).toBe(8192);
    expect(resolveBodyLimit({ BODY_LIMIT_BYTES: '1048576' })).toBe(1048576);
  });

  it('exports BODY_LIMIT_ENV as the env var name the resolver consults', () => {
    expect(BODY_LIMIT_ENV).toBe('BODY_LIMIT_BYTES');
  });
});

describe('createServer — bodyLimit lockdown (inputs.md F-002)', () => {
  it('initialConfig.bodyLimit is DEFAULT_BODY_LIMIT_BYTES when BODY_LIMIT_BYTES is unset', async () => {
    await withEnv({ BODY_LIMIT_BYTES: undefined }, async () => {
      const app = await createServer({ logger: false });
      await app.ready();
      try {
        expect(app.initialConfig.bodyLimit).toBe(DEFAULT_BODY_LIMIT_BYTES);
      } finally {
        await app.close();
      }
    });
  });

  it('initialConfig.bodyLimit follows BODY_LIMIT_BYTES when set', async () => {
    // A tighter, valid value so the test can confirm the env actually
    // threads through to the factory. 8 KiB is well below the default
    // 64 KiB; if `resolveBodyLimit` weren't wired in, this would
    // assert against 64 * 1024 and fail.
    await withEnv({ BODY_LIMIT_BYTES: String(8 * 1024) }, async () => {
      const app = await createServer({ logger: false });
      await app.ready();
      try {
        expect(app.initialConfig.bodyLimit).toBe(8 * 1024);
      } finally {
        await app.close();
      }
    });
  });

  it('rejects an oversized POST with 413 under the canonical error envelope', async () => {
    // Drive against `/sessions` because it is a known POST route with
    // a JSON body. Auth is not configured in the test env, so the
    // request hits the auth gate at the schema layer first — but the
    // `bodyLimit` check fires BEFORE auth (it's part of Fastify's
    // content-type parser layer). The 413 surfaces regardless of
    // whether auth would have rejected the request.
    //
    // Why post a 64 KiB + 1 payload: the bodyLimit is set to 64 KiB,
    // so 64 KiB + 1 is the smallest payload that exceeds it.
    await withEnv({ BODY_LIMIT_BYTES: undefined }, async () => {
      const app = await createServer({ logger: false });
      await app.ready();
      try {
        const oversize = 'a'.repeat(DEFAULT_BODY_LIMIT_BYTES + 1);
        const response = await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: {
            'content-type': 'application/json',
            // `content-length` must be present for the limit check
            // to fire on the request body length; `inject` will set
            // it automatically from `payload.length`. Passing the
            // string directly keeps inject's bookkeeping correct.
          },
          payload: oversize,
        });
        expect(response.statusCode).toBe(413);
        // Canonical error envelope from the error-handler plugin.
        const body: { error?: { code?: unknown; message?: unknown } } = response.json();
        expect(typeof body.error?.code).toBe('string');
        expect(typeof body.error?.message).toBe('string');
      } finally {
        await app.close();
      }
    });
  });

  it('lets an under-limit POST through to the route handler (regression)', async () => {
    // Same route, but a payload well under the limit. The auth-gate
    // (or the schema validator) is the next thing in the pipeline; we
    // assert against "NOT 413" rather than a specific success code
    // because the request still trips other rejections (no auth
    // cookie present, the JSON body doesn't satisfy the route schema,
    // etc.). What this test pins is that the bodyLimit layer did NOT
    // reject — i.e. the under-limit case is structurally past the
    // 413 gate.
    await withEnv({ BODY_LIMIT_BYTES: undefined }, async () => {
      const app = await createServer({ logger: false });
      await app.ready();
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/sessions',
          headers: { 'content-type': 'application/json' },
          payload: '{}', // 2 bytes, well under 64 KiB
        });
        expect(response.statusCode).not.toBe(413);
      } finally {
        await app.close();
      }
    });
  });
});
