// Vitest unit tests for the screen-name collection surface:
//
//   - pending-cookie sign / verify primitives in `pending-cookie.ts`,
//   - `POST /auth/screen-name` route handler in `routes.ts` exercised
//     via Fastify's `.inject(...)`.
//
// Refinement: tasks/refinements/backend/screen_name_collection.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.screen_name_collection
//
// **Coverage**
//
//   `pending-cookie.ts`:
//     1. Sign / verify round-trip — returns ok-result with the original userId.
//     2. Missing-secret throws at sign-time and verify-time.
//     3. Tampered payload → signature-invalid.
//     4. Tampered signature → signature-invalid.
//     5. Malformed cookie shape → malformed.
//     6. Payload missing fields → payload-invalid.
//     7. Expired cookie → expired.
//
//   `POST /auth/screen-name`:
//     8.  Valid cookie + valid name → 200, user updated.
//     9.  Missing cookie → 401.
//     10. Tampered cookie (signature-invalid) → 401.
//     11. Expired cookie → 401.
//     12. Pure-whitespace name → 400 + screen-name-invalid.
//     13. Empty body / missing screenName → 400 (Fastify schema).
//     14. Name > 64 chars (after trim) → 400 + screen-name-invalid.
//     15. Trims surrounding whitespace before persisting.
//     16. Second submission on the same userId (already-set) → 409.
//     17. Success clears the pending cookie via Set-Cookie Max-Age=0.

import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { __buildStubConfiguration } from './config.js';
import {
  buildPendingCookieHeader,
  PENDING_COOKIE_NAME,
  PENDING_COOKIE_TTL_MS,
  resolveSessionTokenSecret,
  SESSION_TOKEN_SECRET_DEV_DENYLIST,
  SESSION_TOKEN_SECRET_MIN_BYTES,
  SessionSecretRejectedError,
  signPendingCookie,
  verifyPendingCookie,
} from './pending-cookie.js';
import { authRoutesPlugin, PLACEHOLDER_SCREEN_NAME } from './routes.js';
import type { AuthRoutesOptions } from './routes.js';
import type { DbPool } from '../db.js';

const VALID_OIDC_CONFIG = {
  issuerUrl: new URL('http://authelia:9091'),
  clientId: 'aconversa-app-dev',
  clientSecret: 'aconversa-app-dev-secret',
  appBaseUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/auth/callback',
} as const;

const TEST_SECRET = 'unit-test-secret-key';

describe('pending-cookie sign / verify', () => {
  it('round-trips a payload through sign + verify', () => {
    const expiresAt = Date.now() + PENDING_COOKIE_TTL_MS;
    const cookie = signPendingCookie(
      { userId: '00000000-0000-4000-8000-000000000001', expiresAt },
      TEST_SECRET,
    );
    expect(cookie).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const verified = verifyPendingCookie(cookie, { secret: TEST_SECRET });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.userId).toBe('00000000-0000-4000-8000-000000000001');
      expect(verified.expiresAt).toBe(expiresAt);
    }
  });

  it('throws when the secret is empty (sign-time)', () => {
    expect(() =>
      signPendingCookie(
        { userId: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 1000 },
        '',
      ),
    ).toThrow(/non-empty/);
  });

  it('throws when the secret is empty (verify-time)', () => {
    expect(() => verifyPendingCookie('a.b', { secret: '' })).toThrow(/non-empty/);
  });

  it('rejects a tampered payload with signature-invalid', () => {
    const cookie = signPendingCookie(
      { userId: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 60_000 },
      TEST_SECRET,
    );
    const [, sig] = cookie.split('.');
    // Forge a fresh payload claiming a different userId, paired with
    // the original signature — the HMAC won't match.
    const forgedPayload = Buffer.from(
      JSON.stringify({ userId: 'attacker', exp: Date.now() + 60_000 }),
      'utf8',
    ).toString('base64url');
    const verified = verifyPendingCookie(`${forgedPayload}.${sig ?? ''}`, { secret: TEST_SECRET });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('signature-invalid');
  });

  it('rejects a cookie signed under a different secret', () => {
    const cookie = signPendingCookie(
      { userId: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 60_000 },
      'wrong-secret',
    );
    const verified = verifyPendingCookie(cookie, { secret: TEST_SECRET });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('signature-invalid');
  });

  it('rejects a cookie missing the separator (malformed)', () => {
    const verified = verifyPendingCookie('not-a-cookie-shape', { secret: TEST_SECRET });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('malformed');
  });

  it('rejects a payload that decodes to non-JSON (payload-invalid)', () => {
    // Build a cookie whose payload bytes decode to plain text, not
    // JSON, and re-sign so the signature passes.
    const payload = Buffer.from('not-json', 'utf8').toString('base64url');
    // Re-sign by signing the payload string directly via the real
    // primitive. Easiest: round-trip through a valid sign+verify, then
    // swap the payload only — but that breaks the HMAC. Instead, use
    // a sibling that signs an arbitrary payload string by reusing the
    // module's helper internally. We construct the cookie by calling
    // sign with a real JSON payload, splitting, then re-computing the
    // HMAC over our forged payload.
    const hmac = createHmac('sha256', TEST_SECRET);
    hmac.update(payload);
    const sig = hmac.digest().toString('base64url');
    const verified = verifyPendingCookie(`${payload}.${sig}`, { secret: TEST_SECRET });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('payload-invalid');
  });

  it('rejects an expired cookie with expired', () => {
    const cookie = signPendingCookie(
      { userId: '00000000-0000-4000-8000-000000000001', expiresAt: 1000 },
      TEST_SECRET,
    );
    const verified = verifyPendingCookie(cookie, {
      secret: TEST_SECRET,
      now: () => 999_999_999,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe('expired');
  });
});

// Strength gate for `SESSION_TOKEN_SECRET`. Closes docs/security/m3-review/auth.md F-004:
// the resolver is no longer a "non-empty string" check — it enforces a 32-byte
// floor (with a `NODE_ENV === 'test'` carve-out) and a production-only denylist of
// well-known dev placeholders. The boot path in `apps/server/src/index.ts`
// `instanceof`-checks the thrown `SessionSecretRejectedError` and exits non-zero
// before binding a port. Tests below pin all three rejection paths, the carve-out,
// the production-only denylist gate, the accepted-32+-byte happy path, and the
// non-leaking message invariant.
describe('resolveSessionTokenSecret strength gate', () => {
  // A 32+-byte fixture used wherever a test needs the resolver to ACCEPT in
  // every environment. The literal is human-readable for diff-review; entropy
  // doesn't matter in tests — the gate only cares about byte length + denylist.
  const STRONG_SECRET = 'a'.repeat(SESSION_TOKEN_SECRET_MIN_BYTES);
  // A 5-character secret used wherever a test needs the resolver to REJECT
  // under the length floor. Five characters is well below the 32-byte floor;
  // its exact contents are unimportant.
  const SHORT_SECRET = 'short';
  // The production-denylisted literal from `.env.example`. Sourced from the
  // exported constant so the test fixture can't drift from the runtime denylist.
  const DEV_PLACEHOLDER = SESSION_TOKEN_SECRET_DEV_DENYLIST[0];

  it('rejects an unset env var with reason=missing', () => {
    expect(() => resolveSessionTokenSecret({ NODE_ENV: 'production' })).toThrow(
      SessionSecretRejectedError,
    );
    try {
      resolveSessionTokenSecret({ NODE_ENV: 'production' });
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        expect(error.reason).toBe('missing');
        expect(error.name).toBe('SessionSecretRejectedError');
      }
    }
  });

  it('rejects an empty-string env var with reason=missing (regression)', () => {
    expect(() =>
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: '', NODE_ENV: 'production' }),
    ).toThrow(SessionSecretRejectedError);
    try {
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: '', NODE_ENV: 'production' });
    } catch (error) {
      if (error instanceof SessionSecretRejectedError) {
        expect(error.reason).toBe('missing');
      }
    }
  });

  it('rejects a 5-char secret in production with reason=too-short', () => {
    try {
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: SHORT_SECRET, NODE_ENV: 'production' });
      throw new Error('expected SessionSecretRejectedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        expect(error.reason).toBe('too-short');
      }
    }
  });

  it('rejects a 5-char secret in development with reason=too-short (floor applies outside test env)', () => {
    try {
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: SHORT_SECRET, NODE_ENV: 'development' });
      throw new Error('expected SessionSecretRejectedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        expect(error.reason).toBe('too-short');
      }
    }
  });

  it('accepts a 5-char secret under NODE_ENV=test (carve-out for existing fixtures)', () => {
    const value = resolveSessionTokenSecret({
      SESSION_TOKEN_SECRET: SHORT_SECRET,
      NODE_ENV: 'test',
    });
    expect(value).toBe(SHORT_SECRET);
  });

  it('rejects the .env.example placeholder in production with reason=matches-dev-placeholder', () => {
    try {
      resolveSessionTokenSecret({
        SESSION_TOKEN_SECRET: DEV_PLACEHOLDER,
        NODE_ENV: 'production',
      });
      throw new Error('expected SessionSecretRejectedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        expect(error.reason).toBe('matches-dev-placeholder');
      }
    }
  });

  it('accepts the .env.example placeholder in development (dev convenience)', () => {
    const value = resolveSessionTokenSecret({
      SESSION_TOKEN_SECRET: DEV_PLACEHOLDER,
      NODE_ENV: 'development',
    });
    expect(value).toBe(DEV_PLACEHOLDER);
  });

  it('accepts a 32-byte secret in production, development, and test', () => {
    expect(
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: STRONG_SECRET, NODE_ENV: 'production' }),
    ).toBe(STRONG_SECRET);
    expect(
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: STRONG_SECRET, NODE_ENV: 'development' }),
    ).toBe(STRONG_SECRET);
    expect(
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: STRONG_SECRET, NODE_ENV: 'test' }),
    ).toBe(STRONG_SECRET);
  });

  it('does not echo the rejected value in the too-short error message', () => {
    // Use a secret whose substring would be visually distinct in any captured
    // log line so the test fails clearly if the message ever leaks it.
    const distinctShort = 'nope!';
    try {
      resolveSessionTokenSecret({ SESSION_TOKEN_SECRET: distinctShort, NODE_ENV: 'production' });
      throw new Error('expected SessionSecretRejectedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        expect(error.message).not.toContain(distinctShort);
      }
    }
  });

  it('does not echo the rejected value in the matches-dev-placeholder error message', () => {
    try {
      resolveSessionTokenSecret({
        SESSION_TOKEN_SECRET: DEV_PLACEHOLDER,
        NODE_ENV: 'production',
      });
      throw new Error('expected SessionSecretRejectedError');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionSecretRejectedError);
      if (error instanceof SessionSecretRejectedError) {
        // The literal placeholder value must NOT appear in the message.
        // The message names the reason and points to remediation; the value
        // itself stays out of stderr / structured logs.
        expect(error.message).not.toContain(DEV_PLACEHOLDER ?? '');
      }
    }
  });
});

// In-memory `pg.Pool` shim for screen-name tests. Tracks a single
// row keyed by userId; supports the UPDATE the handler issues and
// (for arrangement steps) raw INSERTs.
interface UserRow {
  id: string;
  oauth_subject: string;
  screen_name: string;
}
function makeMemoryPool(initialRows: UserRow[] = []): {
  pool: DbPool;
  users: Map<string, UserRow>;
} {
  const users = new Map<string, UserRow>();
  for (const row of initialRows) {
    users.set(row.id, row);
  }
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('UPDATE users') && text.includes('SET screen_name')) {
        const id = p[0] as string;
        const newName = p[1] as string;
        const currentName = p[2] as string;
        const row = users.get(id);
        if (row === undefined) return Promise.resolve({ rows: [] as TRow[] });
        if (row.screen_name !== currentName) return Promise.resolve({ rows: [] as TRow[] });
        const next: UserRow = { ...row, screen_name: newName };
        users.set(id, next);
        return Promise.resolve({
          rows: [{ id: next.id, screen_name: next.screen_name }] as unknown as TRow[],
        });
      }
      return Promise.reject(new Error(`unexpected SQL in screen-name memory pool: ${text}`));
    },
  };
  return { pool, users };
}

function makeStubClient(): ReturnType<typeof __buildStubConfiguration> {
  return __buildStubConfiguration(
    VALID_OIDC_CONFIG.issuerUrl,
    VALID_OIDC_CONFIG.clientId,
    VALID_OIDC_CONFIG.clientSecret,
  );
}

async function buildApp(opts: {
  initialRows?: UserRow[];
  now?: () => number;
}): Promise<{ app: FastifyInstance; users: Map<string, UserRow>; now: () => number }> {
  const app = Fastify({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const { pool, users } = makeMemoryPool(opts.initialRows ?? []);
  const now = opts.now ?? ((): number => Date.now());
  const pluginOpts: AuthRoutesOptions = {
    oidcConfig: { ...VALID_OIDC_CONFIG },
    oidcClient: makeStubClient(),
    pool,
    sessionTokenSecret: TEST_SECRET,
    cookieSecure: false,
    now,
  };
  await app.register(authRoutesPlugin, pluginOpts);
  await app.ready();
  return { app, users, now };
}

function makeCookieHeaderValue(userId: string, expiresAt: number): string {
  const value = signPendingCookie({ userId, expiresAt }, TEST_SECRET);
  return `${PENDING_COOKIE_NAME}=${value}`;
}

describe('POST /auth/screen-name', () => {
  let app: FastifyInstance;
  let users: Map<string, UserRow>;
  const userId = '00000000-0000-4000-8000-000000000010';

  beforeEach(async () => {
    const built = await buildApp({
      initialRows: [
        {
          id: userId,
          oauth_subject: 'authelia:alice',
          screen_name: PLACEHOLDER_SCREEN_NAME,
        },
      ],
    });
    app = built.app;
    users = built.users;
  });

  afterEach(async () => {
    await app.close();
  });

  it('replaces the placeholder when given a valid cookie + valid name', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: 'alice' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId: string; screenName: string }>();
    expect(body.userId).toBe(userId);
    expect(body.screenName).toBe('alice');
    expect(users.get(userId)?.screen_name).toBe('alice');
  });

  it('clears the pending cookie on success', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: 'alice' },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(',') : String(setCookie);
    expect(setCookieStr).toContain(`${PENDING_COOKIE_NAME}=`);
    expect(setCookieStr).toMatch(/Max-Age=0/);
  });

  it('trims leading and trailing whitespace before persisting', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: '  alice  ' },
    });
    expect(response.statusCode).toBe(200);
    expect(users.get(userId)?.screen_name).toBe('alice');
  });

  it('rejects a request with no cookie (401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      payload: { screenName: 'alice' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-pending-cookie-invalid');
  });

  it('rejects a tampered cookie (401)', async () => {
    const validValue = signPendingCookie({ userId, expiresAt: Date.now() + 60_000 }, TEST_SECRET);
    // Replace the entire signature half with a different (valid-shape
    // but wrong-value) signature so the verifier rejects on the
    // signature-invalid branch.
    const [payloadHalf] = validValue.split('.');
    const fakeSig = Buffer.alloc(32, 0xab).toString('base64url');
    const tampered = `${PENDING_COOKIE_NAME}=${payloadHalf ?? ''}.${fakeSig}`;
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: tampered },
      payload: { screenName: 'alice' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired cookie (401)', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, 1000); // far past
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: 'alice' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a pure-whitespace screen name (400)', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: '   ' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('screen-name-invalid');
  });

  it('rejects a screen name longer than 64 chars after trim (400)', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const tooLong = 'x'.repeat(65);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: tooLong },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('screen-name-invalid');
  });

  it('rejects a missing screenName field via schema (400)', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    // Fastify's schema validator surfaces `validation-failed` per the
    // canonical envelope; our own validator surfaces
    // `screen-name-invalid`. Either is acceptable as a 400.
    expect(body.error?.code).toMatch(/validation-failed|screen-name-invalid/);
  });

  it('rejects a second submission on an already-set user (409)', async () => {
    const cookieHeader = makeCookieHeaderValue(userId, Date.now() + 60_000);
    const first = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: 'alice' },
    });
    expect(first.statusCode).toBe(200);
    // Same cookie still valid (10 min TTL), but the underlying row is
    // no longer at the placeholder.
    const second = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { cookie: cookieHeader },
      payload: { screenName: 'alice-renamed' },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('screen-name-already-set');
    // Original value untouched.
    expect(users.get(userId)?.screen_name).toBe('alice');
  });
});

describe('buildPendingCookieHeader', () => {
  it('includes HttpOnly, SameSite=Lax, Path=/, Max-Age', () => {
    const header = buildPendingCookieHeader('v.s', { maxAgeMs: 600_000, secure: false });
    expect(header).toContain(`${PENDING_COOKIE_NAME}=v.s`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=600');
    expect(header).not.toContain('Secure');
  });

  it('adds Secure when secure=true', () => {
    const header = buildPendingCookieHeader('v.s', { maxAgeMs: 60_000, secure: true });
    expect(header).toContain('Secure');
  });
});
