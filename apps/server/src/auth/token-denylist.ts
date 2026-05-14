// Auth token denylist — per-session JWT revocation surface.
//
// Refinement: tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md
// ADRs:        docs/adr/0020-postgres-migration-strategy.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.auth_hardening.jwt_revocation_jti_denylist
//
// **What this module owns.**
//
//   1. `addToDenylist({ jti, userId, expiresAtMs }, pool)` —
//      INSERTs one row into `auth_token_denylist`. Idempotent via
//      `ON CONFLICT (jti) DO NOTHING` — a double-logout silently
//      no-ops on the second pass.
//   2. `isJtiRevoked(jti, pool)` — the hot read path. SELECT 1 by
//      `jti`; returns boolean. Called from `authenticateRequest` after
//      JWT verify and before user-row lookup.
//   3. `sweepExpiredDenylistRows(pool)` — DELETE rows where
//      `expires_at <= NOW()`. Runs periodically; safe to call manually
//      from tests.
//   4. `getDefaultDenylistSweeper(pool)` — module-singleton periodic
//      sweeper. Mirrors `getDefaultFlowStateStore` shape.
//
// **Why denylist, not allowlist.** See migration header comment +
// refinement Decisions. TL;DR: revocation rate << sign rate, so the
// hot path is "is this jti in a (mostly small) set?"
//
// **Sweeper cadence: 60 minutes.** Faster cadence buys nothing because
// the denylist is in Postgres (not in-process) — rows being present
// past their expiry has zero correctness cost (the JWT's `exp` is
// rejected by the verifier first, and the denylist consult is only
// reached when the JWT verifies, which an expired JWT cannot). The
// cadence is env-tunable via `AUTH_DENYLIST_SWEEP_INTERVAL_MS` for
// hermetic tests; the timer is `.unref()`'d so graceful shutdown is
// not blocked.
//
// **What this module does NOT own**:
//   - Minting the `jti` — owned by `session-token.ts`'s
//     `signSessionToken` (a v4 UUID per sign).
//   - The route handler that writes the row — owned by `routes.ts`'s
//     `POST /auth/logout`.
//   - The middleware path that reads the denylist — owned by
//     `middleware.ts`'s `authenticateRequest`.

import type { DbPool } from '../db.js';

/**
 * Default sweep interval — 60 minutes, in milliseconds.
 *
 * Rationale: the denylist is on Postgres with an `expires_at` index;
 * rows being present past their expiry has zero correctness impact
 * (the JWT's `exp` is rejected by the verifier on the `exp` check
 * itself before the denylist consult would run). The cadence buys
 * physical-disk hygiene, not security; an hour is a reasonable
 * trade-off.
 */
export const DEFAULT_DENYLIST_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Env var name production reads to override the sweep cadence.
 * Exported so tests can assert against the same constant the
 * resolver consults.
 */
export const AUTH_DENYLIST_SWEEP_INTERVAL_ENV = 'AUTH_DENYLIST_SWEEP_INTERVAL_MS';

/**
 * Resolve the sweep interval from the environment. Falls back to
 * `DEFAULT_DENYLIST_SWEEP_INTERVAL_MS` on any non-positive integer
 * value (missing env, malformed value, zero, negative).
 *
 * @param env - the env record (defaults to `process.env`).
 * @returns the resolved positive-integer interval in milliseconds.
 */
export function resolveDenylistSweepIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[AUTH_DENYLIST_SWEEP_INTERVAL_ENV];
  if (raw === undefined || raw === '') {
    return DEFAULT_DENYLIST_SWEEP_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_DENYLIST_SWEEP_INTERVAL_MS;
  }
  return parsed;
}

/**
 * Row payload for `addToDenylist`. `expiresAtMs` is the JWT's `exp`
 * claim converted to milliseconds since epoch — the helper writes a
 * TIMESTAMPTZ derived from that value.
 */
export interface DenylistRow {
  /** v4 UUID — the JWT's `jti` claim. */
  readonly jti: string;
  /** Owning users-table row id. */
  readonly userId: string;
  /** Effective expiry instant in milliseconds since epoch. */
  readonly expiresAtMs: number;
}

/**
 * Add a JWT to the denylist. Idempotent via
 * `ON CONFLICT (jti) DO NOTHING` — a double-logout no-ops on the
 * second pass rather than throwing a unique-violation. SQL is
 * parameterized; no injection surface.
 *
 * Returns the number of rows actually inserted (0 if the `jti` was
 * already present, 1 otherwise). Callers in v1 ignore the count —
 * the denylist is purely a write-and-forget surface from the route
 * handler's perspective.
 *
 * @param row  - the `(jti, userId, expiresAtMs)` triple.
 * @param pool - the DB pool.
 * @returns the count of rows inserted (0 or 1).
 */
export async function addToDenylist(row: DenylistRow, pool: DbPool): Promise<number> {
  // Convert the ms-since-epoch to an ISO timestamp Postgres accepts as
  // a TIMESTAMPTZ literal. Using `new Date(...).toISOString()` keeps
  // the precision at millisecond granularity (which is what `exp *
  // 1000` produces from the JWT) and lets pg's parameter binder do the
  // type-conversion without a custom serializer.
  const expiresAtIso = new Date(row.expiresAtMs).toISOString();
  const result = await pool.query<{ jti: string }>(
    `INSERT INTO auth_token_denylist (jti, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING
     RETURNING jti`,
    [row.jti, row.userId, expiresAtIso],
  );
  return result.rows.length;
}

/**
 * Check whether a `jti` is on the denylist. The hot read path.
 *
 * SQL: `SELECT 1 FROM auth_token_denylist WHERE jti = $1`. The
 * primary-key index makes this an O(log N) probe; the result set is
 * tiny (zero or one row). The caller treats the boolean as a single
 * predicate; the middleware collapses a positive result onto its
 * existing `auth-required` 401 envelope (no new error code, no
 * information leak about "revoked vs. expired vs. invalid").
 *
 * @param jti  - the JWT's `jti` claim.
 * @param pool - the DB pool.
 * @returns `true` if the `jti` appears in the denylist, `false` otherwise.
 */
export async function isJtiRevoked(jti: string, pool: DbPool): Promise<boolean> {
  // `SELECT 1 FROM ... LIMIT 1` is the canonical existence-only query
  // shape. Returning `1` (a constant) rather than `jti` keeps the
  // result narrow and lets pg's parser elide the column projection.
  const result = await pool.query<{ exists: number }>(
    `SELECT 1 AS exists FROM auth_token_denylist WHERE jti = $1 LIMIT 1`,
    [jti],
  );
  return result.rows.length > 0;
}

/**
 * Delete rows whose `expires_at` is in the past. Safe to call
 * concurrently — Postgres serializes the DELETE.
 *
 * Rows MUST live until `expires_at` because the corresponding JWT
 * remains structurally valid (signature + payload-shape) until that
 * instant; earlier removal would let a forged-replay slip past the
 * verifier (which would consult the denylist, find no row, and accept
 * the still-unexpired JWT). After `expires_at`, the verifier rejects
 * the JWT on its own `exp` check before the denylist consult fires.
 *
 * @param pool - the DB pool.
 * @returns the number of rows deleted.
 */
export async function sweepExpiredDenylistRows(pool: DbPool): Promise<number> {
  // `RETURNING jti` so the caller can count the deletions; the count
  // surfaces in the sweeper's log line so operators can see the
  // denylist's hygiene rate.
  const result = await pool.query<{ jti: string }>(
    `DELETE FROM auth_token_denylist WHERE expires_at <= NOW() RETURNING jti`,
  );
  return result.rows.length;
}

/**
 * Handle for a started denylist sweeper.
 */
export interface DenylistSweeperHandle {
  /** Stop the periodic sweeper. Idempotent — safe to call twice. */
  stop(): void;
  /** Run the sweep once, synchronously from the caller's perspective.
   *  Tests use this to exercise the sweep step without waiting for the timer. */
  sweepNow(): Promise<number>;
}

/**
 * Start a periodic-sweeper timer. Returns a handle so the caller can
 * stop the timer at server shutdown OR a test can dispose of it.
 *
 * The timer is `.unref()`'d so it does not keep the Node event loop
 * alive past graceful shutdown — same posture as the flow-state
 * sweeper.
 *
 * Errors thrown by the sweep are caught and logged to stderr (the
 * sweeper does not carry a logger reference; the cost of a misformed
 * log line is rounded down to "operator sees a one-line stderr blip
 * once per hour"). A persistently-failing sweep does NOT block the
 * server boot or the verify hot path.
 *
 * @param pool         - the DB pool.
 * @param intervalMs   - the periodic interval. Defaults to the
 *                       resolved env value or 60 minutes.
 * @returns a handle exposing `stop()` and `sweepNow()`.
 */
export function startDenylistSweeper(pool: DbPool, intervalMs?: number): DenylistSweeperHandle {
  const interval = intervalMs ?? resolveDenylistSweepIntervalMs(process.env);
  const sweepOnce = async (): Promise<number> => {
    try {
      return await sweepExpiredDenylistRows(pool);
    } catch (err) {
      // A failing sweep is non-fatal — the next sweep will catch up.
      // Surface to stderr so operators see the pattern if it persists;
      // the cost of a misformed log line vs. crashing the process is
      // a clear win. The structured logger isn't threaded into this
      // module — Pino lives at the Fastify-instance level and the
      // sweeper is a module singleton with no app reference.
      console.error('[auth_token_denylist sweep failed]', err);
      return 0;
    }
  };
  // Fire-and-forget the periodic sweep. `setInterval` returns a
  // `NodeJS.Timeout` whose `.unref()` allows graceful shutdown.
  const timer = setInterval((): void => {
    void sweepOnce();
  }, interval);
  timer.unref();
  return {
    stop(): void {
      clearInterval(timer);
    },
    sweepNow(): Promise<number> {
      return sweepOnce();
    },
  };
}

/**
 * Process-wide default sweeper. Lazily constructed on first call so
 * tests that build their own (or that never authenticate) don't arm
 * an idle timer.
 *
 * Mirrors `getDefaultFlowStateStore` — the production server reaches
 * for this once at first authenticated route; tests build per-scenario
 * sweepers with injected pools.
 */
let defaultSweeper: DenylistSweeperHandle | undefined;

/**
 * Return the process-wide default sweeper. Lazily constructs it on
 * first call against the supplied pool.
 *
 * Subsequent calls return the SAME handle even if the pool argument
 * differs — the default sweeper is bound to its first pool. This is
 * the right behavior for production (one server, one pool); tests
 * that need a fresh sweeper should call `startDenylistSweeper`
 * directly and manage the handle themselves.
 *
 * @param pool - the DB pool bound to the default sweeper.
 * @returns the process-wide default sweeper handle.
 */
export function getDefaultDenylistSweeper(pool: DbPool): DenylistSweeperHandle {
  if (defaultSweeper !== undefined) {
    return defaultSweeper;
  }
  defaultSweeper = startDenylistSweeper(pool);
  return defaultSweeper;
}

/**
 * Test-only helper — reset the default sweeper and stop its timer.
 * Vitest tests that exercise the default singleton (rare; most tests
 * build their own via `startDenylistSweeper`) use this to start
 * fresh.
 */
export function __resetDefaultDenylistSweeper(): void {
  if (defaultSweeper !== undefined) {
    defaultSweeper.stop();
    defaultSweeper = undefined;
  }
}
