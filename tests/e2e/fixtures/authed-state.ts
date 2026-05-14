// Helper that mints a signed `aconversa-session` JWT for Playwright
// tests that need a "signed-in" page context.
//
// Refinement: tasks/refinements/frontend-i18n/i18n_testing.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// **Why this helper exists.** The i18n smoke specs in this iteration
// run unauthenticated — they assert on the SPA's login route's
// localized strings, which renders before any auth handshake. The
// helper is kept here because:
//
//   1. The next class of cross-locale smoke (post-screen-name routes,
//      the lobby view, the operator console) will need a real session
//      cookie. Signing it deterministically here means future specs
//      don't reach for the OIDC flow.
//   2. ADR 0022 says "verifications land as committed tests" — a
//      utility shipped without a consumer is acceptable iff it is
//      structurally needed for an imminent spec. The shape is pinned
//      by the existing server-side `signSessionToken` contract, so
//      this file's correctness is verified by the server-side tests
//      that exercise `signSessionToken` against `verifySessionToken`.
//
// The function imports the server's signer directly via a relative
// path. The runtime image lays the server out under
// `apps/server/dist/`, but Playwright loads this file through `tsx`
// at source-resolution time, so we import the `.ts` source and let
// TypeScript's `paths` resolve it.

import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

/**
 * Defaults match `apps/server/src/auth/session-token.ts`. Kept inline
 * here so the helper has zero runtime dependency on the server tree
 * besides the `jose` library (the server depends on `jose` too; both
 * sides use the same algorithm).
 */
const SESSION_COOKIE_NAME = 'aconversa-session';
const SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Options for `mintSessionCookie`.
 */
export interface MintSessionCookieOptions {
  /**
   * The `sub` claim — `users.id` UUID. The route handler's `/auth/me`
   * looks the user up in Postgres on every request, so this UUID must
   * be a real row for the cookie to authenticate against the
   * compose-stack database. For the v1 spec set (unauthed login
   * smoke), the cookie is only useful in tests that have seeded a
   * matching row first.
   */
  readonly userId: string;
  /**
   * Session-token signing secret. Production resolves this from
   * `SESSION_TOKEN_SECRET` env. The compose stack writes the same
   * value into `.env` (see `make up` / `.env.example`); the helper
   * can be passed it directly.
   */
  readonly secret: string;
  /** Optional issue-at clock override (ms since epoch). Defaults to `Date.now()`. */
  readonly nowMs?: number;
  /** Optional `jti` override. Defaults to `crypto.randomUUID()`. */
  readonly jti?: string;
}

/**
 * Mint a signed session JWT and return it plus the cookie name. The
 * caller assembles the `Cookie` header / `storageState` entry — this
 * helper does NOT compose the `Set-Cookie` attributes because
 * Playwright's cookie API expects discrete fields, not a serialized
 * header.
 *
 * Matches `signSessionToken` in
 * `apps/server/src/auth/session-token.ts` byte-for-byte (same alg,
 * same TTL, same claim shape). The server's verifier accepts the
 * minted token as long as the secret matches.
 */
export async function mintSessionToken(options: MintSessionCookieOptions): Promise<{
  cookieName: string;
  token: string;
  iat: number;
  exp: number;
  jti: string;
}> {
  if (options.secret.length === 0) {
    throw new Error('mintSessionToken: secret must be non-empty');
  }
  if (options.userId.length === 0) {
    throw new Error('mintSessionToken: userId must be non-empty');
  }
  const nowMs = options.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + SESSION_TOKEN_TTL_SECONDS;
  const jti = options.jti ?? randomUUID();
  const key = new TextEncoder().encode(options.secret);
  const token = await new SignJWT({ sub: options.userId, iat, exp, jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(key);
  return { cookieName: SESSION_COOKIE_NAME, token, iat, exp, jti };
}
