// Platform session-token primitives — HS256 JWT signing/verification
// + cookie-header composition for the long-lived `aconversa-session`
// cookie.
//
// Refinement: tasks/refinements/backend/session_token_management.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.session_token_management
//
// **What this module owns.** Four pure helpers + the cookie name + the
// TTL constants + the typed payload shape:
//
//   1. `signSessionToken({ sub }, secret)` — issues a JWT carrying
//      EXACTLY `{ sub, iat, exp }`. `iat` is set to "now"; `exp` is
//      set to `iat + SESSION_TOKEN_TTL_SECONDS`. Signed with HS256
//      using the supplied secret.
//   2. `verifySessionToken(token, secret)` — verifies signature,
//      `exp`, and the payload shape. Returns the decoded
//      `SessionTokenPayload` on success, `null` on every failure mode
//      (bad shape, bad signature, expired, wrong-algorithm, malformed).
//   3. `buildSessionCookieHeader(token, opts)` — composes the
//      `Set-Cookie` header value with the canonical attribute set
//      (HttpOnly, SameSite=Lax, Path=/, Max-Age, conditional Secure).
//   4. `buildSessionCookieClearHeader(opts)` — composes the cleanup
//      `Set-Cookie` (empty value, Max-Age=0, matching attributes).
//
// **Why JWT (HS256) and not a DB-backed opaque token.** Statelessness
// fits the WebSocket model — the upgrade handshake reads the cookie
// once, validates it via HMAC-only (no DB round-trip), and the
// long-lived connection is authenticated for thousands of subsequent
// messages without any DB lookup. A DB-backed token would either force
// per-message lookups (latency disaster) or a per-connection cache
// (an invalidation problem). The granular-revocation gap was closed
// in M3-review (per
// `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`):
// the JWT now carries a `jti` (v4 UUID) claim that the auth middleware
// consults against a small `auth_token_denylist` Postgres table once
// per upgrade / once per HTTP request. The WS path's per-connection
// cache of the resolved `AuthUser` keeps the denylist consult to one
// DB hit per connection's lifetime; revocation propagation onto an
// open WS connection runs via `closeUserConnections(userId,
// 'auth-revoked')` from the logout path — closing the connection IS
// the cache invalidation.
// See `tasks/refinements/backend/session_token_management.md` and
// `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`
// for the full rationale.
//
// **Why `jose`.** Production-grade audited JWT library, native ESM,
// TypeScript-first, no algorithm-confusion vulnerabilities. Pinned at
// 6.x in `apps/server/package.json` alongside the existing dep set.
//
// **Claim minimalism.** Per ADR 0002, the platform reads no profile
// data; the token MUST carry only the `users.id` (as `sub`), the
// JWT-standard `iat` / `exp`, and the per-session `jti` (v4 UUID,
// added in M3-review per
// `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`).
// NO `iss`, NO `aud`, NO `screen_name`. The verify helper's
// payload-shape check enumerates the four allowed keys and rejects
// any token carrying additional claims so future drift is caught.
//
// **What this module does NOT own.**
//   - Reading/writing the cookie on Fastify request/response —
//     that's the route plugin (`routes.ts`).
//   - The users-row lookup `/auth/me` issues — that's the route
//     handler.
//   - The pending-cookie bridge — separate concern, owned by
//     `pending-cookie.ts`.
//   - The auth middleware that gates protected routes — sibling task
//     `auth_middleware`.

import { randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { assertSafeCookieValue } from './cookie-charset.js';

/**
 * Cookie name for the platform session token. Constant so every
 * caller (route handler, eventual auth middleware, eventual WebSocket
 * upgrade) reads / writes the same key.
 *
 * The `aconversa-` prefix matches the pending-cookie's namespace and
 * avoids collisions with `authelia_session` (Authelia's own cookie)
 * or any other origin-shared cookie.
 */
export const SESSION_COOKIE_NAME = 'aconversa-session';

/**
 * TTL for the platform session token — 7 days, in milliseconds. The
 * cookie's `Max-Age` and the JWT's `exp` both derive from this; they
 * agree by construction so the browser and the server invalidate the
 * cookie at the same moment.
 *
 * Rationale: matches the typical "stay logged in for a week" UX. Long
 * enough for a moderator running a multi-hour debate session; short
 * enough that a stolen cookie has a hard expiry without per-session
 * revocation infrastructure.
 */
export const SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Same TTL in seconds — what JWT `exp` and `Set-Cookie`'s `Max-Age`
 * both want.
 */
export const SESSION_TOKEN_TTL_SECONDS = SESSION_TOKEN_TTL_MS / 1000;

/**
 * Clock-skew tolerance applied to the verifier's `iat <= now` and
 * `(exp - iat) <= TTL` invariant checks. 60 seconds covers reasonable
 * NTP drift between a horizontally-scaled signer pod and a verifier
 * pod, and matches the "small slack" recommendation in F-009 of the
 * M3 security review (`docs/security/m3-review/auth.md`).
 *
 * The slack is deliberately narrow: 60s is large enough that ordinary
 * cross-pod clock disagreement never trips a legitimate token, and
 * small enough that a forged token claiming a wildly-future `iat` or
 * a wildly-long TTL is rejected promptly.
 */
export const CLOCK_SKEW_SECONDS = 60;

/**
 * The exact claim shape the platform session token carries.
 *
 *   * `sub` — the `users.id` UUID.
 *   * `iat` — issue-at instant, seconds since epoch.
 *   * `exp` — expiry instant, seconds since epoch.
 *   * `jti` — per-session v4 UUID (M3-review, refinement
 *     `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`).
 *     Used by the auth middleware to consult the `auth_token_denylist`
 *     table on every verify; logout writes one row per `jti` so a
 *     replayed cookie no longer authenticates.
 *
 * NO other field. NO `iss`, NO `aud`, NO `screenName`. Adding a field
 * here would require updating `verifySessionToken`'s payload-shape
 * check; the test suite pins the current shape.
 */
export interface SessionTokenPayload {
  /** Users-table row id (UUID string). */
  readonly sub: string;
  /** Issue-at instant, seconds since epoch. */
  readonly iat: number;
  /** Expiry instant, seconds since epoch. */
  readonly exp: number;
  /** Per-session v4 UUID. The denylist's primary key. */
  readonly jti: string;
}

/**
 * Options forwarded to `signSessionToken` for test-time overrides.
 * Production callers pass nothing; tests pin `now` so `iat` / `exp`
 * are deterministic across runs, and (rarely) pin `jti` so the
 * minted token's denylist key is predictable.
 */
export interface SignSessionTokenOptions {
  /**
   * Clock override. Returns milliseconds since epoch (matching
   * `Date.now`'s shape). Defaults to `Date.now`. The signed token's
   * `iat` is `Math.floor(now() / 1000)`; `exp` is `iat + SESSION_TOKEN_TTL_SECONDS`.
   */
  readonly now?: () => number;
  /**
   * `jti` generator. Returns a v4 UUID string. Defaults to
   * `crypto.randomUUID()`. Tests pin a deterministic generator so the
   * minted token's `jti` is predictable across runs; the denylist
   * tests assert against the exact UUID.
   */
  readonly randomJti?: () => string;
}

/**
 * Sign a platform session token. Returns the compact JWT string ready
 * to be assigned as the cookie value.
 *
 * @param payload - the user-identifying claim. Today this is just
 *                  `{ sub: <users.id> }`; the `iat` / `exp` claims are
 *                  computed and added by this function so the caller
 *                  can't accidentally pass a stale issue-time.
 * @param secret  - HMAC key. Production code passes the resolved
 *                  `SESSION_TOKEN_SECRET`. An empty secret throws —
 *                  failing loud is the right diagnostic when env
 *                  wiring drifts.
 * @param options - optional clock injection for hermetic tests.
 * @returns the compact JWT string.
 */
export async function signSessionToken(
  payload: { readonly sub: string },
  secret: string,
  options: SignSessionTokenOptions = {},
): Promise<string> {
  if (secret.length === 0) {
    throw new Error('session-token secret must be a non-empty string');
  }
  if (payload.sub.length === 0) {
    throw new Error('session-token sub must be a non-empty string');
  }
  const now = options.now ?? ((): number => Date.now());
  const iat = Math.floor(now() / 1000);
  const exp = iat + SESSION_TOKEN_TTL_SECONDS;
  // Mint a v4 UUID `jti` per sign. Production uses Node's built-in
  // `crypto.randomUUID()` (RFC 4122 v4); tests inject a deterministic
  // generator so the `jti` is predictable across runs. The `jti` is
  // the primary key of the `auth_token_denylist` table; logout
  // writes one row per `jti` so a replayed cookie is rejected.
  const generateJti = options.randomJti ?? ((): string => randomUUID());
  const jti = generateJti();
  const key = new TextEncoder().encode(secret);
  // `jose`'s `SignJWT` builder. We set `iat` / `exp` ourselves rather
  // than calling `.setIssuedAt()` / `.setExpirationTime(...)` so the
  // clock override in `options.now` is the single source of truth for
  // both fields — `jose`'s setters would consult its internal clock
  // for `iat` and produce a mismatch. `jti` is set as a payload claim
  // for the same reason — `.setJti(...)` would work but the explicit
  // payload-claim shape mirrors `sub` / `iat` / `exp` and keeps the
  // payload-shape audit's enumeration in `verifySessionToken`
  // straightforward.
  const jwt = await new SignJWT({ sub: payload.sub, iat, exp, jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(key);
  return jwt;
}

/**
 * Verify a platform session token.
 *
 * Steps performed by `jose.jwtVerify`:
 *   1. Parse the compact JWT shape (`header.payload.signature`).
 *   2. Verify the protected header's `alg` matches the expected `HS256`
 *      (we pass `algorithms: ['HS256']` so a `none` or RS256 token is
 *      rejected — closes the algorithm-confusion class of bug).
 *   3. Recompute the HMAC over the header+payload bytes; reject on
 *      mismatch.
 *   4. Check the `exp` claim against the clock; reject if expired.
 *
 * On success we then assert the payload shape — `{ sub, iat, exp }`
 * and nothing else — so a token forged with extra claims (e.g. an
 * elevated-privilege marker) is rejected.
 *
 * After the shape audit we pin two defense-in-depth invariants
 * (F-009 in `docs/security/m3-review/auth.md`):
 *   - `iat <= now + CLOCK_SKEW_SECONDS` (token not from the future).
 *   - `exp - iat <= SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS`
 *     (declared TTL within policy). A forged token with
 *     `exp = year 2100` is rejected even if the signing secret
 *     leaks.
 *
 * Returns `null` on every failure mode. The route handler maps the
 * null result onto a single 401 envelope; per the refinement we don't
 * leak which sub-case fired.
 *
 * @param token   - the JWT string read off the session cookie.
 * @param secret  - the same HMAC key used at signing time.
 * @param options - optional clock injection for hermetic tests.
 * @returns the decoded payload on success, `null` on any failure.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  options: { readonly now?: () => number } = {},
): Promise<SessionTokenPayload | null> {
  if (secret.length === 0) {
    throw new Error('session-token secret must be a non-empty string');
  }
  if (token.length === 0) {
    return null;
  }
  const key = new TextEncoder().encode(secret);
  // `jose`'s `jwtVerify` accepts a `currentDate` to override the
  // expiry-comparison clock. We pass it when the caller supplies
  // `options.now` so hermetic tests can advance "time" without timer
  // manipulation.
  const verifyOpts: { algorithms: string[]; currentDate?: Date } = {
    algorithms: ['HS256'],
  };
  if (options.now !== undefined) {
    verifyOpts.currentDate = new Date(options.now());
  }
  let result: { payload: Record<string, unknown> };
  try {
    // Narrow the call's return type to the subset we read. `jose`'s
    // `jwtVerify` overload that returns `ResolvedKey` fires when the
    // key-resolution callback shape is in play; we pass a raw Uint8Array
    // key so the simpler overload applies — but the inference can pick
    // either, so we land on the wider read shape via a cast.
    const verified = (await jwtVerify(token, key, verifyOpts)) as {
      payload: Record<string, unknown>;
    };
    result = verified;
  } catch {
    // `jose` throws a typed error per failure mode (JWTExpired,
    // JWSSignatureVerificationFailed, JWTInvalid, etc.). The route
    // handler doesn't need the discriminator — a single 401 envelope
    // covers them all. The operator-side log captures the rejection
    // via `request.log.debug` in the route handler if it wants to.
    return null;
  }
  const payload = result.payload;
  // Payload-shape audit — exactly `{ sub, iat, exp }`. Reject any
  // extra claim so a future forged token with elevated privilege
  // markers is caught here rather than downstream.
  if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0) {
    return null;
  }
  if (typeof payload['iat'] !== 'number' || !Number.isFinite(payload['iat'])) {
    return null;
  }
  if (typeof payload['exp'] !== 'number' || !Number.isFinite(payload['exp'])) {
    return null;
  }
  // `jti` is REQUIRED on every token minted by `signSessionToken`
  // after M3-review's `jwt_revocation_jti_denylist` task. A legacy
  // token minted before this change carried no `jti`; such tokens are
  // now rejected here (the user re-authenticates and the next sign
  // mints a fresh `jti`). The shape is "v4 UUID string"; we check
  // string-typeness + non-empty-length here and let the denylist
  // consult at the call site decide whether the value is on the
  // revocation list.
  if (typeof payload['jti'] !== 'string' || payload['jti'].length === 0) {
    return null;
  }
  // Enumerate the keys so an unexpected claim trips the check. We
  // intentionally include the algorithm-header keys jose injects on
  // the payload (none — jose puts them in the `protectedHeader`,
  // not the payload). The payload should be exactly four fields:
  // `sub`, `iat`, `exp`, `jti`. The `jti` claim was added by the
  // M3-review `jwt_revocation_jti_denylist` task; relaxing the audit
  // here preserves the defense-in-depth posture against forged
  // elevated-privilege claims (any OTHER unknown claim still trips
  // rejection).
  const allowedKeys = new Set(['sub', 'iat', 'exp', 'jti']);
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }
  // Defense-in-depth invariant pins on `iat` and `exp - iat`.
  // Source: docs/security/m3-review/auth.md F-009.
  //
  // The signing path (`signSessionToken`) bounds `iat` to "now" and
  // `exp` to `iat + SESSION_TOKEN_TTL_SECONDS` by construction; the
  // verifier did NOT historically re-bind those invariants on read,
  // so a token forged with `iat = far-past` and `exp = year 2100`
  // (only feasible if the signing secret is compromised) would have
  // verified. We now reject:
  //
  //   1. `payload.iat > now + CLOCK_SKEW_SECONDS` — token claims it
  //      was issued in the future. (Internal rejection label:
  //      `token-not-yet-valid`.)
  //   2. `(payload.exp - payload.iat) > SESSION_TOKEN_TTL_SECONDS +
  //      CLOCK_SKEW_SECONDS` — token's declared TTL exceeds the
  //      policy ceiling. (Internal rejection label:
  //      `token-ttl-out-of-policy`.)
  //
  // Both rejections collapse to the same `null` return as every
  // other failure mode, matching the established "single 401
  // envelope, no sub-case leak" contract documented above. The
  // labels exist for code-review readability and for the test names
  // in `session-token.test.ts`; they are not emitted to clients.
  const nowMs = options.now !== undefined ? options.now() : Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  if (payload['iat'] > nowSeconds + CLOCK_SKEW_SECONDS) {
    // token-not-yet-valid: signed `iat` is meaningfully in the future.
    return null;
  }
  if (payload['exp'] - payload['iat'] > SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS) {
    // token-ttl-out-of-policy: declared TTL window exceeds the policy ceiling.
    return null;
  }
  return {
    sub: payload['sub'],
    iat: payload['iat'],
    exp: payload['exp'],
    jti: payload['jti'],
  };
}

/**
 * Compose the full `Set-Cookie` header value for the platform session
 * cookie.
 *
 * Centralized so the route plugin doesn't sprinkle cookie attribute
 * strings inline. The Secure attribute is added when `secure` is true
 * (production); HttpOnly + SameSite=Lax + Path=/ are always present.
 * `Max-Age` defaults to the session TTL but can be overridden for
 * tests; the value is in seconds per RFC 6265.
 *
 * @param token  - the signed JWT string (from `signSessionToken`).
 * @param opts   - `{ secure, maxAgeSeconds? }`. `maxAgeSeconds`
 *                 defaults to `SESSION_TOKEN_TTL_SECONDS`; tests can
 *                 override. `secure` flips the `Secure` attribute —
 *                 true in production, false in dev (Compose http).
 * @returns the `Set-Cookie` header VALUE (caller adds the header name).
 */
export function buildSessionCookieHeader(
  token: string,
  opts: { secure: boolean; maxAgeSeconds?: number },
): string {
  // Defense against header injection at the builder boundary —
  // F-011 in `docs/security/m3-review/auth.md`. Today's caller path
  // (`signSessionToken` → this builder) emits a JWT (safe charset by
  // construction); the assertion locks the surface against a future
  // caller passing an unsanitized value (CR / LF / `;` / space / `=`
  // would all enable Set-Cookie injection). Throws
  // `InvalidCookieValueError` — programmer-error, never reaches user
  // input, so a typed throw is the right diagnostic.
  assertSafeCookieValue(token);
  const maxAge = opts.maxAgeSeconds ?? SESSION_TOKEN_TTL_SECONDS;
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAge)))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Compose a `Set-Cookie` header that clears the session cookie.
 *
 * Browsers delete a cookie when they see `Max-Age=0` with matching
 * name + path; emitting Secure conditionally keeps the production
 * shape identical to the live cookie (clearing requires matching
 * attributes in practice — a cookie set with Secure can only be
 * cleared by a Set-Cookie that ALSO carries Secure).
 */
export function buildSessionCookieClearHeader(opts: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Parse the request's `Cookie` header and extract the session token,
 * if present. Returns `undefined` if the header is absent or doesn't
 * contain our cookie. Tolerates extra cookies in the header (the
 * browser concatenates every applicable cookie into one header).
 *
 * Mirrors `readPendingCookieFromHeader` in `pending-cookie.ts`. We
 * keep the helpers separate (rather than a single parametric helper)
 * because the two cookies coexist briefly during the screen-name
 * set's response and a single helper would force callers to
 * disambiguate by name at every read site — the named helpers are
 * clearer.
 */
export function readSessionCookieFromHeader(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader === '') {
    return undefined;
  }
  const pairs = cookieHeader.split(';');
  for (const raw of pairs) {
    const pair = raw.trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx);
    if (name === SESSION_COOKIE_NAME) {
      return pair.slice(eqIdx + 1);
    }
  }
  return undefined;
}
