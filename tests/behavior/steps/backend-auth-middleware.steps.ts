// Step definitions for tests/behavior/backend/auth-middleware.feature.
//
// Refinement: tasks/refinements/backend/auth_middleware.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.auth_middleware
//
// **What this layer exercises.** The auth middleware end-to-end
// against the real migrated `users` table:
//
//   1. Protected route without a cookie → 401 + `auth-required` envelope.
//   2. Protected route with a valid cookie → 200 + body carries the
//      user.
//   3. Protected route with an EXPIRED cookie → 401 + `auth-required`.
//
// What's real:
//   - The middleware's full chain: cookie read, JWT verify (HS256),
//     users-row lookup via pglite, request attachment.
//   - The 401 envelope shape, rendered by the centralized
//     error-handler plugin on the thrown `ApiError`.
//
// Most steps reuse the definitions already shared across
// `backend-oauth-callback.steps.ts`, `backend-session-token.steps.ts`,
// and `http-server.steps.ts`. The ONLY new step this layer
// contributes is the "expired session cookie" Given — sufficient to
// drive scenario 3 without depending on Date manipulation.
//
// Per ADR 0022, this Cucumber layer is the end-to-end regression net
// for the middleware; the Vitest layer covers pure-logic edge cases
// (tampered signature, malformed JWT, soft-deleted user row, public
// route opt-out) in isolation.

import { Given } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { signSessionToken } from '../../../apps/server/src/auth/index.js';
import type { AConversaWorld } from '../support/world.js';

// Local view onto the shared scratch — same shape used by
// `backend-session-token.steps.ts` for the session-cookie scratch.
interface AuthMiddlewareScratch {
  sessionCookieValue?: string;
}

function scratch(world: AConversaWorld): AuthMiddlewareScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as AuthMiddlewareScratch;
}

// The shared test secret pinned by `backend-oauth-callback.steps.ts`
// in the Background. We re-use it here so JWTs signed in test setup
// verify under the same key the server's middleware uses.
const TEST_SESSION_SECRET = 'test-session-secret';

/**
 * Mint a session JWT whose `exp` is in the past — the middleware's
 * `jwtVerify` rejects it with `JWTExpired`, which our wrapper
 * translates to a `null` payload, which the middleware translates to
 * `ApiError(401, 'auth-required', ...)`.
 *
 * The "deep past" `now = 1_000ms` (1970-01-01T00:00:01Z) is small
 * enough that even with `SESSION_TOKEN_TTL_SECONDS` added, `exp` is
 * still long before the real `Date.now()` the middleware uses for
 * verification — the rejection is deterministic across runs.
 */
Given('I have an expired session cookie for that user', async function (this: AConversaWorld) {
  const result = (await this.db.query('SELECT id FROM users ORDER BY created_at DESC LIMIT 1')) as {
    rows: Array<{ id: string }>;
  };
  const userId = result.rows[0]?.id;
  assert.ok(userId, 'no users row found to mint an expired session cookie for');
  const expiredToken = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET, {
    now: () => 1_000,
  });
  scratch(this).sessionCookieValue = expiredToken;
});
