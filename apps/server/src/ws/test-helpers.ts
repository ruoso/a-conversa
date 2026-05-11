// Test-only helpers shared between `connection.test.ts` and `auth.test.ts`.
//
// Refinement: tasks/refinements/backend/ws_auth_on_connect.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.websocket_protocol.ws_auth_on_connect
//
// **Why this module exists.** Both WS test files build the same shape:
//   - a memory-backed pool that knows about a fixed set of users,
//   - a deterministic session-token secret,
//   - a `__buildTestWsApp(...)`-built Fastify instance,
//   - a `signSessionToken({ sub }, secret)` cookie minted from a fixture user.
//
// Pulling the shared shape into one module keeps the test files
// focused on the assertions they own. No production code reaches for
// anything in here — the file's tsconfig include is `*.test.ts`'s
// sibling, so it ships only with tests.
//
// **Memory pool shape.** The auth middleware's `authenticateRequest`
// helper issues exactly one query against the pool:
//
//   SELECT id, screen_name FROM users WHERE id = $1 AND deleted_at IS NULL
//
// The memory pool below recognizes that SQL by substring and returns
// the matching row (or an empty `rows` array for "no such user" /
// "soft-deleted user" cases). The implementation mirrors the one in
// `auth/middleware.test.ts` — same SQL recognizer, same row shape —
// so the test layers exercise the same query surface.

import type { DbPool } from '../db.js';

/**
 * Per-row shape stored in the memory pool. `deleted_at` is non-null
 * for soft-deleted users; the SELECT filter mirrors production by
 * skipping those rows.
 */
export interface TestUserRow {
  /** UUID; matches what `signSessionToken({ sub })` puts in `sub`. */
  readonly id: string;
  /** Screen name attached to `request.authUser.screenName`. */
  readonly screenName: string;
  /** ISO timestamp for soft-deleted users; `null` for live users. */
  readonly deletedAt: string | null;
}

/**
 * Build a memory-backed `DbPool` shim that answers the single SELECT
 * `authenticateRequest` issues. Tests pass a fixed user list; the
 * shim returns the matching row when `id` is found and `deletedAt`
 * is null.
 */
export function makeMemoryPool(rows: ReadonlyArray<TestUserRow>): DbPool {
  const users = new Map<string, TestUserRow>();
  for (const row of rows) {
    users.set(row.id, row);
  }
  return {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        const row = users.get(id);
        if (row === undefined || row.deletedAt !== null) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        return Promise.resolve({
          rows: [{ id: row.id, screen_name: row.screenName }] as unknown as TRow[],
        });
      }
      return Promise.reject(new Error(`unexpected SQL in WS test memory pool: ${text}`));
    },
  };
}

/**
 * Canonical fixture user id used across the WS test files. Stable so
 * a Vitest case can mint a cookie for it without coordinating values
 * across files.
 */
export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000aa1';

/**
 * Canonical fixture screen name for the canonical fixture user.
 */
export const FIXTURE_SCREEN_NAME = 'alice-ws';

/**
 * Canonical test secret. Pinned so a cookie signed in one test layer
 * verifies against the secret the app under test uses.
 */
export const TEST_SESSION_SECRET = 'unit-test-ws-secret';
