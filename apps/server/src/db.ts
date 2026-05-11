// Singleton `pg.Pool` for the application — lazily instantiated from
// `DATABASE_URL` on first use.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.oauth_callback_handler (introduces this module),
//              consumed by every future DB-touching route plugin.
//
// **Why a singleton.** Connection pooling at the application layer is
// a single-process concern; one Pool per process owns the upstream
// connection limit and the idle-connection lifecycle. Routes import
// `getDefaultPool()` rather than constructing their own Pool so the
// process never opens N pools-of-the-same-DSN against a single
// Postgres instance.
//
// **Why lazy.** Constructing the Pool at module-load time would
// connect to `DATABASE_URL` (or fail loudly if unset) before
// `createServer()` ever runs, defeating the test-time pattern where
// `apps/server/src/server.ts` is exercised via `.inject(...)` with no
// DB at all. Lazy construction on first `getDefaultPool()` call means
// no Pool is opened unless a handler actually reaches for it.
//
// **Injection for tests.** Route plugins that touch the DB accept an
// optional `{ pool }` option (a structural subtype: `{ query, connect }`).
// The Cucumber integration layer passes a pglite-backed adapter; the
// Vitest unit layer passes mocks. The singleton is for production
// code paths; the injection points are how the test layers bypass it
// without monkey-patching this module.
//
// **Cleanup.** A future `closeDefaultPool()` (registered on Fastify's
// `onClose`) will drain the pool on graceful shutdown. Today's
// `index.ts` shutdown path closes the Fastify instance; adding a
// `app.addHook('onClose', ...)` to wire pool drainage is a one-line
// follow-up once the first real DB-touching route lands. The
// oauth-callback handler is the trigger — once `app.close()` cascades
// through the hook chain, the pool releases its connections.

import pg from 'pg';

/**
 * The structural subtype every DB-touching route consumes. Production
 * code passes the real `pg.Pool`; tests pass a pglite-backed adapter
 * or a Vitest mock. Keeping this open-ended (rather than typing as
 * `pg.Pool` directly) means the test layers don't have to satisfy
 * `pg.Pool`'s full surface — just the two methods routes actually
 * call.
 */
export interface DbPool {
  /**
   * Run a parameterized query and return the result. Matches `pg.Pool`'s
   * `query(text, params)` signature; the structural form means a
   * pglite-backed adapter can implement just this method.
   */
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

/**
 * Cached singleton pool. `undefined` until the first `getDefaultPool()`
 * call constructs it from `DATABASE_URL`.
 */
let cachedPool: pg.Pool | undefined;

/**
 * Construct (or return the cached) singleton `pg.Pool`. Reads
 * `DATABASE_URL` from `process.env` on the first call; subsequent
 * calls return the same instance.
 *
 * Throws if `DATABASE_URL` is unset on the first call — the lazy
 * singleton can't materialize without a connection string, and
 * silently producing a pool against `undefined` would surface as an
 * obscure pg error at the first query. Failing loud means the
 * operator sees the missing-env diagnostic at the moment the first
 * handler tries to reach the DB.
 *
 * Production callers are route handlers (and only route handlers —
 * the server bootstrap itself never reaches for the pool). Tests
 * either never call this (they pass an injected pool to the route
 * plugin's options) or call it after setting `process.env.DATABASE_URL`
 * to a test-DB URL.
 */
export function getDefaultPool(): pg.Pool {
  if (cachedPool !== undefined) {
    return cachedPool;
  }
  const dsn = process.env['DATABASE_URL'];
  if (dsn === undefined || dsn === '') {
    throw new Error(
      'DATABASE_URL is not set; cannot construct the default pg.Pool. ' +
        'Set DATABASE_URL in the environment or pass an injected `pool` option to the route plugin.',
    );
  }
  cachedPool = new pg.Pool({ connectionString: dsn });
  return cachedPool;
}

/**
 * Test-only helper — reset the cached pool so the next `getDefaultPool()`
 * call constructs a fresh one. Vitest tests that toggle `DATABASE_URL`
 * between cases use this to avoid stale-pool reuse across the toggle.
 *
 * Not part of the production API surface. The `__` prefix signals
 * "test-only" — production code should never call this.
 */
export function __resetDefaultPool(): void {
  cachedPool = undefined;
}
