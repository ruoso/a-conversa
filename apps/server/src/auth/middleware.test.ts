// Vitest unit tests for the auth middleware (`apps/server/src/auth/middleware.ts`).
//
// Refinement: tasks/refinements/backend/auth_middleware.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.auth_middleware
//
// **Coverage**
//
//   1. Protected route + valid cookie → handler runs and
//      `request.authUser` is populated with `{ id, screenName }`.
//   2. Missing cookie → 401 + `auth-required` envelope.
//   3. Tampered signature → 401 + `auth-required`.
//   4. Expired token → 401 + `auth-required`.
//   5. User missing in DB (soft-delete edge case) → 401.
//   6. Soft-deleted user (`deleted_at` present) → 401.
//   7. Public route (no `preHandler: app.authenticate`) → handler runs
//      regardless of cookie state; `request.authUser` is undefined.
//
// All tests use Fastify's `.inject(...)` — no port bind. The DB pool
// is a memory-backed shim. The session-token secret + clock are
// injected so the tests are hermetic across runs.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandlerPlugin } from '../error-handler.js';
import { errorEnvelopeSchema } from '../openapi.js';
import { authenticatePlugin, type AuthUser } from './middleware.js';
import { SESSION_COOKIE_NAME, signSessionToken } from './session-token.js';
import type { DbPool } from '../db.js';

const TEST_SECRET = 'unit-test-middleware-secret';

interface UserRow {
  id: string;
  oauth_subject: string;
  screen_name: string;
  deleted_at: string | null;
}

/**
 * Memory-backed `pg.Pool` shim. Supports the single SELECT the
 * middleware issues (by id + deleted_at IS NULL). The `deleted_at`
 * column is tracked here so the soft-delete case can be exercised
 * without a UPDATE — tests construct rows with `deleted_at` already
 * set.
 */
function makeMemoryPool(rows: UserRow[]): {
  pool: DbPool;
  users: Map<string, UserRow>;
} {
  const users = new Map<string, UserRow>();
  for (const row of rows) {
    users.set(row.id, row);
  }
  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        const row = users.get(id);
        // Mirror the production WHERE clause: `id = $1 AND deleted_at IS NULL`.
        if (row === undefined || row.deleted_at !== null) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        return Promise.resolve({
          rows: [{ id: row.id, screen_name: row.screen_name }] as unknown as TRow[],
        });
      }
      return Promise.reject(new Error(`unexpected SQL in middleware memory pool: ${text}`));
    },
  };
  return { pool, users };
}

interface BuiltApp {
  app: FastifyInstance;
  users: Map<string, UserRow>;
  // Per-request capture so the "handler runs and authUser is populated"
  // test can read what the preHandler attached.
  lastAuthUser: AuthUser | undefined;
}

/**
 * Build a Fastify app with:
 *   - the error-envelope schema + the error-handler plugin (so
 *     ApiError thrown from the middleware renders the canonical envelope),
 *   - the auth middleware plugin,
 *   - a single protected route `/protected` that returns
 *     `request.authUser` so tests can inspect what the preHandler set,
 *   - a single public route `/public` that does NOT attach the
 *     preHandler so the opt-in story is testable.
 */
async function buildApp(opts: { initialRows: UserRow[]; now?: () => number }): Promise<BuiltApp> {
  const app = Fastify({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  const { pool, users } = makeMemoryPool(opts.initialRows);
  const middlewareOpts: Parameters<typeof authenticatePlugin>[1] = {
    pool,
    sessionTokenSecret: TEST_SECRET,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  await app.register(authenticatePlugin, middlewareOpts);
  // Per-request capture for assertions.
  const captured: { value: AuthUser | undefined } = { value: undefined };
  app.get(
    '/protected',
    {
      preHandler: app.authenticate,
    },
    (request) => {
      captured.value = request.authUser;
      return { ok: true, authUser: request.authUser };
    },
  );
  app.get('/public', (request) => {
    // Public routes never run the middleware; authUser is undefined.
    captured.value = request.authUser;
    return { ok: true, authUser: request.authUser ?? null };
  });
  await app.ready();
  return {
    app,
    users,
    get lastAuthUser() {
      return captured.value;
    },
  };
}

const ALICE_ID = '00000000-0000-4000-8000-000000000010';

describe('auth middleware — protected route + valid cookie', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      initialRows: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('runs the handler and populates request.authUser with { id, screenName }', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; authUser: AuthUser }>();
    expect(body.ok).toBe(true);
    expect(body.authUser).toEqual({ id: ALICE_ID, screenName: 'alice' });
    // Sanity check that the per-request capture matches the body.
    expect(built.lastAuthUser).toEqual({ id: ALICE_ID, screenName: 'alice' });
  });
});

describe('auth middleware — failure modes all emit 401 auth-required', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      initialRows: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 401 + auth-required when no cookie is present', async () => {
    const response = await built.app.inject({ method: 'GET', url: '/protected' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string; message?: string } }>();
    expect(body.error?.code).toBe('auth-required');
    expect(body.error?.message).toMatch(/authentication is required/i);
  });

  it('returns 401 when the cookie is present but the signature is tampered', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const parts = token.split('.');
    const fakeSig = Buffer.alloc(32, 0xab).toString('base64url');
    const tampered = `${parts[0]}.${parts[1]}.${fakeSig}`;
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${tampered}` },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 401 when the cookie carries an expired token', async () => {
    // Sign with `now` far in the past so the token's exp is also in
    // the past relative to the real clock; the middleware's default
    // `Date.now`-based verify rejects it as expired.
    const past = 1_000;
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET, { now: () => past });
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 401 when the cookie carries a malformed JWT string', async () => {
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-jwt` },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 401 when the user row is missing from the DB', async () => {
    // Token is signed for an id the memory pool doesn't know about —
    // simulates a soft-delete that wiped the row before the cookie's
    // natural expiry.
    const ghostId = '00000000-0000-4000-8000-000000009999';
    const token = await signSessionToken({ sub: ghostId }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 401 when the user row is soft-deleted (deleted_at present)', async () => {
    // Re-build the app with a row that has `deleted_at` set — the
    // middleware's WHERE clause filters this row out exactly like
    // production's `deleted_at IS NULL`.
    await built.app.close();
    const softDeletedId = '00000000-0000-4000-8000-000000000020';
    built = await buildApp({
      initialRows: [
        {
          id: softDeletedId,
          oauth_subject: 'authelia:bob',
          screen_name: 'bob',
          deleted_at: '2026-05-01T00:00:00Z',
        },
      ],
    });
    const token = await signSessionToken({ sub: softDeletedId }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });
});

describe('auth middleware — public route opt-in story', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({ initialRows: [] });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('runs the handler on a public route regardless of cookie state', async () => {
    // No `preHandler: app.authenticate` on `/public` — the middleware
    // is never invoked. The route handler observes
    // `request.authUser === undefined` (the decorator pre-allocates
    // the slot to undefined; the middleware never ran to populate it).
    const response = await built.app.inject({ method: 'GET', url: '/public' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; authUser: AuthUser | null }>();
    expect(body.ok).toBe(true);
    expect(body.authUser).toBeNull();
  });

  it('does not populate request.authUser on a public route even with a valid cookie', async () => {
    // The cookie exists and is valid, but because the route doesn't
    // attach the preHandler, the middleware never runs. The point: the
    // opt-in convention is load-bearing — auth only happens where a
    // route asks for it.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/public',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ authUser: AuthUser | null }>();
    expect(body.authUser).toBeNull();
  });
});
