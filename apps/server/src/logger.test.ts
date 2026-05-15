// Vitest unit tests for the per-environment logger helper.
//
// Refinement: tasks/refinements/backend/request_logging.md
//             tasks/refinements/backend-hardening/pino_redact_config.md
// ADRs:        docs/adr/0023-web-framework-fastify.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.api_skeleton.request_logging
//              backend_hardening.auth_hardening.pino_redact_config
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
//   8. `redact` block is structurally pinned in both prod and dev
//      modes (and absent only from the test-mode `false` shape).
//   9. End-to-end log capture: build a Pino logger from the prod
//      options + a custom destination stream, log objects shaped
//      like a request with sensitive fields, and assert the values
//      are replaced by `'[redacted]'` while non-sensitive fields
//      pass through verbatim. Closes
//      `docs/security/m3-review/auth.md` F-012 and
//      `docs/security/m3-review/inputs.md` F-007.
//
// All tests are pure unit tests (no I/O, no DB) per ADR 0006's layer
// routing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';

import { createLoggerOptions } from './logger.js';
import { createServer } from './server.js';

// Narrowing shape used by the transport / redact assertions. The Pino
// options object accepted by Fastify has a `transport` field with
// `target` and `options` sub-fields; we only assert against `target`
// so the tests don't lock us in to specific `pino-pretty` option
// names beyond what the helper sets. `redact` is also asserted
// against the helper's pinned paths/censor.
interface PinoOptionsShape {
  level?: string;
  transport?: {
    target?: string;
    options?: Record<string, unknown>;
  };
  redact?: {
    paths?: readonly string[];
    censor?: string;
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

describe('createLoggerOptions redact structural pin', () => {
  // Source: docs/security/m3-review/auth.md F-012 +
  // docs/security/m3-review/inputs.md F-007.
  //
  // The `redact` block is the defense-in-depth guarantee that future
  // log calls cannot leak secret-bearing fields. These tests pin
  // (a) that the block is present in every non-test mode, and (b)
  // that the path list matches the agreed-upon set so a path
  // removal surfaces as a test failure, not as a silent log leak.

  const EXPECTED_PATHS = [
    'req.headers.cookie',
    'req.headers["set-cookie"]',
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]',
    'cookie',
    'token',
    'password',
    'secret',
    'authorization',
    '*.cookie',
    '*.token',
    '*.password',
    '*.secret',
    '*.authorization',
  ];

  it('pins the redact paths in production mode', () => {
    const opts = createLoggerOptions({ NODE_ENV: 'production' }) as PinoOptionsShape;
    expect(opts.redact?.paths).toEqual(EXPECTED_PATHS);
    expect(opts.redact?.censor).toBe('[redacted]');
  });

  it('pins the redact paths in development mode', () => {
    const opts = createLoggerOptions({ NODE_ENV: 'development' }) as PinoOptionsShape;
    expect(opts.redact?.paths).toEqual(EXPECTED_PATHS);
    expect(opts.redact?.censor).toBe('[redacted]');
  });

  it('pins the redact paths when NODE_ENV is unset (dev default)', () => {
    const opts = createLoggerOptions({}) as PinoOptionsShape;
    expect(opts.redact?.paths).toEqual(EXPECTED_PATHS);
    expect(opts.redact?.censor).toBe('[redacted]');
  });

  it('returns a fresh redact.paths array on each call (no shared-mutation footgun)', () => {
    const a = createLoggerOptions({ NODE_ENV: 'production' }) as PinoOptionsShape;
    const b = createLoggerOptions({ NODE_ENV: 'production' }) as PinoOptionsShape;
    expect(a.redact?.paths).not.toBe(b.redact?.paths);
    // The objects compare deeply equal but are distinct identities;
    // a caller pushing into `a.redact.paths` must not affect `b`.
    if (a.redact && Array.isArray(a.redact.paths)) {
      // Construct a mutable copy if the array is readonly at the
      // type level — we are exercising the runtime contract.
      const mutable = a.redact.paths as string[];
      mutable.push('*.SHOULD_NOT_LEAK_INTO_B');
      expect(b.redact?.paths).not.toContain('*.SHOULD_NOT_LEAK_INTO_B');
    }
  });
});

describe('Pino redact end-to-end log capture', () => {
  // Build a Pino logger from the helper's prod options + a custom
  // destination stream that buffers every written line. This is the
  // documented Pino pattern for tests (`pino(opts, dest)` where
  // `dest` is a `{ write(msg: string): void }` object). No external
  // mocks, no I/O, no DB.
  //
  // Each test logs an object that mirrors a realistic Fastify
  // request shape (or a custom log bag) and asserts:
  //   - the secret value does NOT appear in the output line;
  //   - the censor marker `'[redacted]'` DOES appear;
  //   - sibling non-sensitive fields appear verbatim.

  interface CaptureStream {
    write(msg: string): void;
    readonly lines: string[];
    clear(): void;
  }

  function createCaptureStream(): CaptureStream {
    const lines: string[] = [];
    return {
      write(msg: string): void {
        // Pino emits one JSON line per call (newline-terminated);
        // strip the trailing newline before buffering.
        lines.push(msg.replace(/\n$/, ''));
      },
      get lines(): string[] {
        return lines;
      },
      clear(): void {
        lines.length = 0;
      },
    };
  }

  function buildProdLogger(stream: CaptureStream): ReturnType<typeof pino> {
    const opts = createLoggerOptions({ NODE_ENV: 'production' });
    // Narrow away the `false | object` union: prod mode always
    // returns an object. A `false` return here would be a regression
    // in `createLoggerOptions` itself, separately pinned above.
    if (opts === false) {
      throw new Error(
        'createLoggerOptions(NODE_ENV=production) returned false — should be an options object',
      );
    }
    // Pino accepts `(options, destinationStream)`. The transport
    // field is undefined in prod mode (verified by the prod-options
    // test above), so the custom stream is the only sink.
    //
    // The helper's return type widens to `FastifyServerOptions['logger']`,
    // which is a Fastify-specific superset of Pino's `LoggerOptions`
    // (mixin generics differ on the `never` vs `string` axis). The
    // runtime shape is a plain Pino options object — Fastify forwards
    // it unchanged to `pino(...)` itself. We cast through `unknown` to
    // bridge the two declared types; the runtime correctness is the
    // structural-pin tests above + the assertions in this block.
    return pino(opts as unknown as Parameters<typeof pino>[0], stream);
  }

  it('redacts req.headers.cookie value, keeps non-sensitive fields verbatim', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/auth/me',
          headers: {
            cookie: 'aconversa-session=abc.def.ghi',
            'user-agent': 'vitest-client/1.0',
          },
        },
      },
      'request received',
    );

    expect(stream.lines).toHaveLength(1);
    const line = stream.lines[0]!;
    expect(line).not.toContain('aconversa-session=abc.def.ghi');
    expect(line).toContain('[redacted]');
    // Non-sensitive sibling fields must pass through.
    expect(line).toContain('"method":"GET"');
    expect(line).toContain('"url":"/api/auth/me"');
    expect(line).toContain('"user-agent":"vitest-client/1.0"');
  });

  it('redacts req.headers.authorization value', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info(
      {
        req: {
          method: 'POST',
          url: '/api/something',
          headers: {
            authorization: 'Bearer eyJ.SECRET_TOKEN_VALUE.sig',
          },
        },
      },
      'auth attempt',
    );

    const line = stream.lines[0]!;
    expect(line).not.toContain('SECRET_TOKEN_VALUE');
    expect(line).not.toContain('Bearer eyJ');
    expect(line).toContain('[redacted]');
    expect(line).toContain('"method":"POST"');
  });

  it('redacts a top-level token field via the *.token wildcard', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info({ token: 'TOP_LEVEL_SECRET_TOKEN', userId: 'u-123' }, 'minted token');

    const line = stream.lines[0]!;
    expect(line).not.toContain('TOP_LEVEL_SECRET_TOKEN');
    expect(line).toContain('[redacted]');
    // Non-sensitive sibling field must pass through.
    expect(line).toContain('"userId":"u-123"');
  });

  it('redacts a cookie field nested under an arbitrary binding via the *.cookie wildcard', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.warn({ debug: { cookie: 'SHOULD_NOT_LEAK_aconversa-session=xyz' } }, 'debugging');

    const line = stream.lines[0]!;
    expect(line).not.toContain('SHOULD_NOT_LEAK_aconversa-session=xyz');
    expect(line).toContain('[redacted]');
  });

  it('redacts res.headers["set-cookie"] (outbound cookie issuance)', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info(
      {
        res: {
          statusCode: 302,
          headers: {
            'set-cookie': 'aconversa-session=NEW_TOKEN_VALUE; HttpOnly; SameSite=Lax',
          },
        },
      },
      'redirect with cookie',
    );

    const line = stream.lines[0]!;
    expect(line).not.toContain('NEW_TOKEN_VALUE');
    expect(line).toContain('[redacted]');
    // Non-sensitive sibling field must pass through.
    expect(line).toContain('"statusCode":302');
  });

  it('leaves req.method verbatim (negative: NOT in the redact list)', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info({ req: { method: 'DELETE', url: '/api/sessions/abc' } }, 'request');

    const line = stream.lines[0]!;
    expect(line).toContain('"method":"DELETE"');
    expect(line).toContain('"url":"/api/sessions/abc"');
    // The line should not contain the censor marker — nothing was
    // redacted on this call.
    expect(line).not.toContain('[redacted]');
  });

  it('redacts password and secret via defensive wildcards', () => {
    const stream = createCaptureStream();
    const logger = buildProdLogger(stream);

    logger.info(
      { password: 'HUNTER2_PLAIN', secret: 'SHARED_HMAC_SECRET', user: 'alice' },
      'no-password-fields-today-but-just-in-case',
    );

    const line = stream.lines[0]!;
    expect(line).not.toContain('HUNTER2_PLAIN');
    expect(line).not.toContain('SHARED_HMAC_SECRET');
    expect(line).toContain('[redacted]');
    expect(line).toContain('"user":"alice"');
  });
});
