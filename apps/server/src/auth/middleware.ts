// Fastify auth middleware — gates protected endpoints by validating
// the platform session cookie and attaching the authenticated user to
// the request.
//
// Refinement: tasks/refinements/backend/auth_middleware.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.auth_middleware
//
// **What this module owns.**
//
// `authenticatePlugin(app, opts?)` — a Fastify plugin that:
//
//   1. Decorates the request with `authUser` (typed via the module
//      augmentation in `types.d.ts`). Pre-allocates the slot to `null`
//      so Fastify's per-request object shape stays monomorphic — a
//      well-known performance pattern in the Fastify docs.
//   2. Decorates the instance with `app.authenticate(request, reply)`,
//      the function each protected route attaches as its `preHandler`.
//
// `authenticate` performs the full chain:
//
//   1. Read the `Cookie` header off the request.
//   2. Extract the `aconversa-session` cookie via
//      `readSessionCookieFromHeader`.
//   3. Verify the JWT via `verifySessionToken` (HS256, payload-shape
//      audit, clock check).
//   4. SELECT the users row by `id = sub` AND `deleted_at IS NULL`.
//   5. Populate `request.authUser = { id, screenName }`.
//
// Any failure at any step → throw `ApiError(401, 'auth-required',
// ...)`. The centralized error-handler plugin (registered earlier in
// `server.ts`) renders the canonical envelope.
//
// **No `reply.send()` inline.** Throwing `ApiError` keeps the
// envelope shape consistent across every protected endpoint; the
// error handler is the single source of truth for response
// serialization.
//
// **No global hook.** The plugin attaches no `onRequest` /
// `preHandler` to the root scope. The ONLY way a request reaches the
// `authenticate` decorator is via a route's explicit
// `preHandler: app.authenticate` opt-in.
//
// **What this module does NOT do**:
//   - The JWT primitive itself (signing/verifying) — owned by
//     `session-token.ts`.
//   - The cookie-header parsing — owned by `session-token.ts`
//     (`readSessionCookieFromHeader`).
//   - Audit logging on failed auth attempts — deferred to the future
//     security-audit task.
//   - WebSocket-handshake authentication — owned by
//     `ws_auth_on_connect`. That task composes the same primitives
//     (`verifySessionToken` + user-lookup) via the
//     `authenticateRequest` helper this module exports.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from '../errors.js';
import { getDefaultPool, type DbPool } from '../db.js';
import { resolveSessionTokenSecret } from './pending-cookie.js';
import { readSessionCookieFromHeader, verifySessionToken } from './session-token.js';
import type { AuthUser } from './types.d.ts';

// Re-export the AuthUser shape from the module-augmentation file so
// runtime consumers (e.g. WS auth, future route handlers) can import a
// single type from one place. The `.d.ts` is the source of truth for
// the type; this re-export is the runtime ergonomics.
export type { AuthUser } from './types.d.ts';

/**
 * Per-row shape returned by the users-table SELECT the middleware
 * runs. Narrowed at the call site so the helper doesn't need to know
 * about the full users-table schema.
 */
interface UsersAuthRow extends Record<string, unknown> {
  readonly id: string;
  readonly screen_name: string;
}

/**
 * Options accepted by `authenticatePlugin`. Every field optional —
 * production callers pass `{}` (or nothing) and the plugin reaches for
 * env-driven defaults. Tests supply the secret + a stubbed pool +
 * (optionally) a fixed clock to keep the verification deterministic.
 */
export interface AuthMiddlewareOptions {
  /**
   * Database pool. When absent the plugin lazily calls
   * `getDefaultPool()` on the first authenticated request. Tests pass
   * a memory-backed shim or a pglite-backed adapter.
   */
  readonly pool?: DbPool;
  /**
   * HMAC key for verifying the platform session JWT. When absent the
   * plugin reads `SESSION_TOKEN_SECRET` via `resolveSessionTokenSecret`
   * lazily on first use. Tests pin a fixed string so the verification
   * is deterministic across runs.
   *
   * Shared with `session-token.ts` + `pending-cookie.ts` — the same
   * env var. See `tasks/refinements/backend/session_token_management.md`.
   */
  readonly sessionTokenSecret?: string;
  /**
   * Clock injection for hermetic tests. When absent verification uses
   * `Date.now`. Tests pass a controllable function so "now" can be
   * pinned for expired-token assertions without timer manipulation.
   */
  readonly now?: () => number;
}

/**
 * The standardized 401 envelope code emitted on every middleware
 * failure mode. Exported so step defs and unit tests can assert
 * against the same constant the runtime emits, catching drift
 * automatically.
 *
 * Rationale for the kebab string: per the refinement Decisions, this
 * code means "authentication is required for this endpoint" — a
 * broader semantic than `auth-session-invalid` (the `/auth/me`-only
 * code the middleware sunsets) and more discriminating than the
 * canonical `unauthorized` (which covers all 401s indiscriminately).
 */
export const AUTH_REQUIRED_CODE = 'auth-required';

/**
 * The standardized 401 envelope message. A single phrasing across
 * every failure mode preserves the no-information-leak property — a
 * caller can't distinguish "no cookie" from "expired cookie" from
 * "soft-deleted user" by the message alone.
 */
export const AUTH_REQUIRED_MESSAGE =
  'authentication is required for this endpoint; sign in to continue';

/**
 * Internal helper — runs the full "read cookie, verify JWT, look up
 * user" chain and returns the resulting `AuthUser` on success.
 * Returns `null` on every failure mode (no cookie / malformed token /
 * tampered signature / expired / payload-shape rejected / user row
 * missing / soft-deleted).
 *
 * Exported so `ws_auth_on_connect` (sibling task) can compose the
 * same primitive against the WebSocket upgrade request — that path
 * isn't a Fastify route lifecycle, so it can't use the
 * `app.authenticate` preHandler directly, but it CAN call this
 * helper with the upgrade request's cookie header + the same pool +
 * secret to get the same `AuthUser` shape.
 *
 * @param cookieHeader - the raw `Cookie` header value (or undefined).
 * @param pool - the DB pool used for the user-row lookup.
 * @param secret - HMAC key for JWT verification.
 * @param now - optional clock override for hermetic tests.
 * @returns the `AuthUser` on success, `null` on any failure.
 */
export async function authenticateRequest(
  cookieHeader: string | undefined,
  pool: DbPool,
  secret: string,
  now?: () => number,
): Promise<AuthUser | null> {
  const token = readSessionCookieFromHeader(cookieHeader);
  if (token === undefined) {
    return null;
  }
  const verifyOpts = now !== undefined ? { now } : {};
  const payload = await verifySessionToken(token, secret, verifyOpts);
  if (payload === null) {
    return null;
  }
  // SELECT the users row by id. The `deleted_at IS NULL` clause skips
  // soft-deleted users — the cookie may be technically valid (signed
  // before the soft-delete) but the account is gone. Treating that as
  // an auth failure prevents a ghost-user from accessing the system
  // until their token's natural expiry.
  const result = await pool.query<UsersAuthRow>(
    `SELECT id, screen_name
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [payload.sub],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return { id: row.id, screenName: row.screen_name };
}

/**
 * The plugin body. Wraps the lazy DB-pool / secret resolution and
 * exposes the `authenticate` decorator on the parent scope (via
 * `fastify-plugin`'s skip-override marker).
 */
const authenticatePluginAsync: FastifyPluginAsync<AuthMiddlewareOptions> = (
  app: FastifyInstance,
  opts,
) => {
  // Pre-allocate the `authUser` slot so Fastify's per-request object
  // shape stays monomorphic across requests. The default value is
  // `undefined` — the request decoration pattern Fastify documents.
  // Calling `decorateRequest('authUser', null)` would set the default
  // to `null`; `undefined` is the more accurate "not yet populated"
  // sentinel and aligns with the optional-property typing in
  // `types.d.ts`.
  //
  // Wrapped in a try/catch so a re-registration of the plugin (which
  // would re-decorate the same request property) doesn't fail loudly.
  // Production registers the plugin exactly once; tests that build
  // multiple Fastify instances per scenario each get their own
  // decorator stack.
  if (!app.hasRequestDecorator('authUser')) {
    app.decorateRequest('authUser', undefined);
  }

  // Resolve the DB pool lazily. The first authenticated request
  // triggers the resolution; tests that never hit a protected route
  // don't pay the cost.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  // Resolve the HMAC secret lazily. Production reads
  // `SESSION_TOKEN_SECRET`; tests pin a fixed string via options.
  let resolvedSecret: string | undefined = opts.sessionTokenSecret;
  const ensureSecret = (): string => {
    if (resolvedSecret !== undefined) {
      return resolvedSecret;
    }
    resolvedSecret = resolveSessionTokenSecret(process.env);
    return resolvedSecret;
  };

  // Clock override for hermetic tests.
  const nowOverride = opts.now;

  // Decorate the instance with the `authenticate` function. Each
  // protected route attaches this as its `preHandler` — Fastify runs
  // preHandlers before the route handler; throwing from a preHandler
  // bypasses the handler and lands the thrown value at the error
  // handler.
  app.decorate('authenticate', async function authenticate(request, _reply): Promise<void> {
    const rawHeader = request.headers['cookie'];
    const cookieHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
    const authUser = await authenticateRequest(
      cookieHeader,
      ensurePool(),
      ensureSecret(),
      nowOverride,
    );
    if (authUser === null) {
      throw new ApiError(401, AUTH_REQUIRED_CODE, AUTH_REQUIRED_MESSAGE);
    }
    // Attach the authenticated user. The handler reads this off
    // `request.authUser` (typed via the module augmentation in
    // `types.d.ts`).
    request.authUser = authUser;
  });

  return Promise.resolve();
};

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * instance decoration (`app.authenticate`) attaches to the parent
 * scope rather than the plugin's encapsulation child. Without this,
 * routes registered in sibling plugins would not see
 * `app.authenticate`.
 *
 * Named via the plugin metadata so `app.printPlugins()` shows it
 * under a stable label.
 */
export const authenticatePlugin = fp(authenticatePluginAsync, {
  name: 'a-conversa-auth-middleware',
  fastify: '5.x',
});
