// The canonical "can this user see this session?" rule, factored out
// of the five session-management endpoints that previously inlined it.
//
// Refinement: tasks/refinements/backend/privacy_field_enforcement.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.privacy_field_enforcement
//
// **The rule** (lifted verbatim from docs/architecture.md, "Cross-session
// reference permissions"):
//
//   Sessions are PUBLIC by default. The host may mark a session PRIVATE.
//   An authenticated user can see a session iff:
//     - the session's `privacy = 'public'`, OR
//     - the caller IS the session's host (`sessions.host_user_id = caller`), OR
//     - the caller is or was a participant (a row in `session_participants`
//       for `(session_id, caller)` — including historical rows where
//       `left_at IS NOT NULL`, because once you've seen a session you've
//       seen it).
//
// Five call sites used to inline this rule (GET /sessions list filter,
// GET /sessions/:id, POST /sessions/:id/end, PATCH /sessions/:id/privacy,
// POST /sessions/:id/participants and the participant DELETE). Each
// re-derived the same WHERE clause; a regression in any one would have
// drifted from the others silently. This module is the single source of
// truth.
//
// **Two exports, one rule.** The rule is expressed two ways:
//
//   1. `visibilityWhereFragment(userIdParamIndex)` — returns the SQL
//      fragment that goes inside a SELECT's WHERE clause. The caller
//      chooses the parameter slot; the participant-join shares the same
//      slot via two textual `$N` references inside the fragment. Used by
//      every handler that needs to combine the gate with additional
//      filters (the list endpoint composes status / host / participant /
//      privacy / topic on top; the per-id endpoints AND `id = $1`).
//
//   2. `canSeeSession(executor, sessionId, userId)` — runs a
//      parameterized `SELECT 1` with `id = $1 AND <fragment with $2>`
//      and returns the boolean. Used by handlers that need a yes/no
//      answer BEFORE issuing a separate row-fetch (none today; future
//      cross-session-reference handlers and future participant-list /
//      session-event endpoints are the consumers — see
//      tasks/refinements/backend/privacy_field_enforcement.md for the
//      anticipated call sites).
//
// **Scope.** This module answers ONLY "can this user see THIS session?"
// The sibling task `backend.cross_session_permissions.reference_permission_check`
// owns "can session B reference session A's entities?" — a different
// question (it's about WRITING entity-included events, not READING
// session metadata; it has additional rules about the writer being
// inside session B AND session A meeting the visibility gate). Keeping
// the two questions separate keeps the read-side gate cheap and the
// write-side rule isolatable.
//
// **No RLS.** The rule is enforced at the application layer (per the
// project's ADR set — no Postgres RLS policy). Every callsite that
// reads `sessions.privacy` either uses this module or is buggy; CI's
// test layers (Vitest unit + Cucumber+pglite integration) pin the
// rule's semantics so a future drift surfaces as a failing test, not
// as silent unauthorized access.

import type { DbPool } from '../db.js';

/**
 * Minimal executor surface — anything with a `query(text, params)`
 * method whose result has a `.rows` array. Matches `DbPool` (the
 * production `pg.Pool` shape) AND `pg.PoolClient` (used inside
 * `withTransaction` callbacks). Callers pass whichever they have;
 * the function doesn't care.
 */
export interface VisibilityExecutor {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }>;
}

/**
 * Build the SQL fragment that gates a SELECT against the
 * "public-or-host-or-participant" rule.
 *
 * The fragment is a single parenthesized OR expression with TWO textual
 * references to the same `$N` placeholder (one for `host_user_id` and
 * one for `EXISTS (... user_id = $N)`). The caller passes ONE param at
 * that slot; both references resolve to it.
 *
 * The `sessions` alias is HARD-CODED in the EXISTS subquery
 * (`sp.session_id = sessions.id`). Callers that alias the table to
 * something else (e.g. `FROM sessions s`) need to wrap or rewrite —
 * but every current callsite uses the unaliased table name, so this is
 * fine for v1.
 *
 * @param userIdParamIndex - the positional placeholder slot (1-based)
 *   for the caller's user id. The list endpoint uses 1 (the only
 *   parameter); the per-id endpoints use 2 (with `id = $1` taking
 *   slot 1).
 * @returns the SQL WHERE-fragment as a parenthesized expression.
 *
 * @example
 *   // GET /sessions — visibility-only WHERE clause:
 *   const where = visibilityWhereFragment(1);
 *   await pool.query(
 *     `SELECT ... FROM sessions WHERE ${where} ORDER BY created_at DESC`,
 *     [callerUserId],
 *   );
 *
 *   // GET /sessions/:id — visibility AND id match:
 *   const where = visibilityWhereFragment(2);
 *   await pool.query(
 *     `SELECT ... FROM sessions WHERE id = $1 AND ${where}`,
 *     [sessionId, callerUserId],
 *   );
 */
export function visibilityWhereFragment(userIdParamIndex: number): string {
  if (!Number.isInteger(userIdParamIndex) || userIdParamIndex < 1) {
    throw new Error(
      `visibilityWhereFragment: userIdParamIndex must be a positive integer; got ${String(userIdParamIndex)}`,
    );
  }
  const slot = `$${String(userIdParamIndex)}`;
  // Indentation matches the SQL formatting the inlined callsites used
  // historically — a code search for `privacy = 'public'` in routes.ts
  // surfaces the same shape both before and after the refactor, which
  // keeps git-blame and the in-memory test-shim's textual recognisers
  // working. The recognisers look for these literal strings:
  //   - `privacy = 'public'`
  //   - `host_user_id = $N` (any N)
  //   - `EXISTS (SELECT 1 FROM session_participants sp`
  //   - `sp.session_id = sessions.id AND sp.user_id = $N`
  return `(\n             privacy = 'public'\n             OR host_user_id = ${slot}\n             OR EXISTS (\n                  SELECT 1 FROM session_participants sp\n                  WHERE sp.session_id = sessions.id AND sp.user_id = ${slot}\n                )\n           )`;
}

/**
 * Boolean predicate — does this caller see this session?
 *
 * Issues a parameterized `SELECT 1 FROM sessions WHERE id = $1 AND
 * <visibility fragment>` and returns true iff at least one row matches.
 *
 * The function does NOT distinguish "the session doesn't exist" from
 * "the session exists but the caller can't see it" — both return false.
 * Callers that need the distinction (none today) should run their own
 * SELECT. The existence-non-leak rule (see
 * `tasks/refinements/backend/get_session_endpoint.md`'s 404-not-403
 * decision) is exactly why this collapse is correct for the consumers
 * this predicate exists for.
 *
 * **Soft-deleted users.** The auth middleware filters
 * `users.deleted_at IS NOT NULL` rows at the cookie-verification step
 * (`apps/server/src/auth/middleware.ts`'s `SELECT ... WHERE id = $1
 * AND deleted_at IS NULL`); a soft-deleted user never has a valid
 * session cookie and never reaches this predicate. We do NOT re-check
 * `users.deleted_at` here — the caller's id was already validated to
 * belong to an active user upstream. If a soft-deleted user's id is
 * passed directly (test-time bypass of the middleware), this function
 * still answers truthfully based on the `sessions` and
 * `session_participants` tables — soft-delete is a USER concern, not
 * a SESSIONS concern. See the refinement's "soft-deleted user"
 * decision.
 *
 * @param executor - a query-runner (the request's pool, or a
 *   transaction client inside `withTransaction`).
 * @param sessionId - the session id under question (UUID).
 * @param userId - the caller's user id (UUID).
 * @returns `true` iff the session exists AND is visible to the user.
 */
export async function canSeeSession(
  executor: VisibilityExecutor,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const fragment = visibilityWhereFragment(2);
  const result = await executor.query<{ visible: number }>(
    `SELECT 1 AS visible FROM sessions WHERE id = $1 AND ${fragment} LIMIT 1`,
    [sessionId, userId],
  );
  return result.rows.length > 0;
}

/**
 * Boolean predicate — can an ANONYMOUS (no authenticated user) caller
 * see this session?
 *
 * Sibling to `canSeeSession`. Per ADR 0029, the anonymous-WS-subscribe
 * path widened the WS auth gate so a cookie-less upgrade is no longer
 * a 401; the audience surface can subscribe to public sessions
 * anonymously. This predicate encodes the strict "public AND
 * not-ended" rule for null-user callers:
 *
 *   `SELECT 1 FROM sessions WHERE id = $1 AND privacy = 'public' AND ended_at IS NULL`
 *
 * The fragment is strictly stricter than `canSeeSession`'s
 * "public OR host OR participant" — the OR-host / OR-participant
 * branches collapse to false for a null user, and an anonymous viewer
 * additionally cannot see an ENDED session (the authenticated path
 * does not gate on `ended_at` because hosts + participants retain
 * read access after end-of-session).
 *
 * The existence-non-leak rule is preserved: the predicate does NOT
 * distinguish "doesn't exist" from "exists but not public / ended" —
 * both return `false`. The subscribe handler renders both as the
 * canonical `not-found` wire error (see
 * `apps/server/src/ws/handlers/subscribe.ts`'s existence-non-leak
 * docblock).
 *
 * **No `users.deleted_at` consideration.** Anonymous callers have no
 * users row to soft-delete; the predicate's null-user input is
 * structural (the WS auth gate set `request.authUser = undefined`),
 * not derived from a user lookup.
 *
 * @param executor - a query-runner (the request's pool, or a
 *   transaction client inside `withTransaction`).
 * @param sessionId - the session id under question (UUID).
 * @returns `true` iff the session exists AND has `privacy = 'public'`
 *   AND has `ended_at IS NULL`.
 */
export async function canSeeSessionAnonymously(
  executor: VisibilityExecutor,
  sessionId: string,
): Promise<boolean> {
  const result = await executor.query<{ visible: number }>(
    `SELECT 1 AS visible FROM sessions WHERE id = $1 AND privacy = 'public' AND ended_at IS NULL LIMIT 1`,
    [sessionId],
  );
  return result.rows.length > 0;
}

/**
 * Re-export the `DbPool` type so consumers of this module don't need a
 * second import to type the executor argument when they already have a
 * pool in hand. Equivalent to importing `DbPool` from `../db.js`
 * directly.
 */
export type { DbPool };
