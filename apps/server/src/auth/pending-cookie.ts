// Short-lived "auth-completion pending" cookie — bridge between the
// OIDC callback and the screen-name collection endpoint.
//
// Refinement: tasks/refinements/backend/screen_name_collection.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.screen_name_collection
//
// **What this module owns.** Two pure helpers + the cookie name + the
// TTL constant:
//
//   1. `signPendingCookie({ userId, expiresAt, secret })` — encodes
//      `{ userId, exp }` as `base64url(payload).base64url(hmac)` and
//      returns the cookie string to ship in a `Set-Cookie` header.
//   2. `verifyPendingCookie(cookieValue, { secret, now })` — decodes
//      and verifies the payload's signature in constant-time. Returns
//      either `{ ok: true, userId }` or `{ ok: false, reason }`.
//
// **Why a dedicated short-lived cookie instead of platform sessions.**
// The OIDC callback (`oauth_callback_handler`) writes a row with
// `screen_name = '<pending>'`; the user then needs to POST the chosen
// name back. The next sibling (`session_token_management`) mints the
// full platform session cookie that gates every protected endpoint —
// but that work hasn't landed yet. We need a way to authorize ONE
// specific endpoint (POST /auth/screen-name) for the user who just
// finished the OIDC dance. Three options were surveyed (A: pass the
// `userId` in the response body and trust it; B: extend `/auth/callback`
// with an optional `?screen_name=…`; C: a short-lived signed cookie
// scoped to the screen-name set). Option C is the chosen approach —
// see the refinement for the rationale. This module is option C's
// signing surface.
//
// **Cookie shape.**
//
//   Cookie name:     `aconversa-auth-pending`
//   Cookie value:    `<base64url-payload>.<base64url-hmac>`
//   Payload encoded: `{ "userId": "<uuid>", "exp": <ms-epoch> }` JSON
//   Signature:       HMAC-SHA256 over the base64url-payload bytes
//                    keyed by `SESSION_TOKEN_SECRET`
//   TTL:             10 minutes (PENDING_COOKIE_TTL_MS)
//   Attributes:      HttpOnly, SameSite=Lax, Path=/, Max-Age=<TTL/1000>;
//                    Secure attribute added when NODE_ENV=production.
//
// **What this module does NOT own.**
//   - Reading/writing the cookie on Fastify request/response — that's
//     the route plugin (`routes.ts`).
//   - Mint platform session tokens — `session_token_management`.
//   - Validate screen-name body — the route handler does that.
//   - Persist anything — pure cryptographic primitives only; no I/O.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { assertSafeCookieValue } from './cookie-charset.js';

/**
 * Cookie name for the short-lived pending-cookie. Constant so the
 * route handler reads / clears the same key the OIDC callback wrote.
 */
export const PENDING_COOKIE_NAME = 'aconversa-auth-pending';

/**
 * Default TTL for the pending cookie — 10 minutes, expressed in ms.
 * Generous enough that a user can take a moment to type their screen
 * name; short enough that an abandoned flow doesn't leave a
 * long-lived auth-bridge sitting on the device.
 */
export const PENDING_COOKIE_TTL_MS = 10 * 60 * 1000;

/**
 * Payload encoded into the pending cookie. Only two fields — the
 * users-table row id and the absolute expiry. Everything else the
 * screen-name handler needs comes from the DB row lookup keyed on
 * `userId`.
 */
export interface PendingCookiePayload {
  /** Users-table row id (UUID string). */
  readonly userId: string;
  /** Absolute expiry instant, milliseconds since epoch. */
  readonly expiresAt: number;
}

/**
 * Result of `verifyPendingCookie`. The ok-shape carries the userId;
 * the error-shape carries a discriminator the route plugin maps onto
 * a single 401 envelope (we never leak why the cookie was invalid).
 */
export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAt: number }
  | {
      readonly ok: false;
      readonly reason: 'malformed' | 'signature-invalid' | 'expired' | 'payload-invalid';
    };

/**
 * Base64url-encode a string of bytes. Uses Buffer + the URL-safe
 * variant of base64 (no padding). The pending cookie carries the
 * encoded payload in the URL-safe form so the cookie string is safe
 * to ship in a `Set-Cookie` header without quoting tricks.
 */
function b64urlEncode(input: Buffer): string {
  return input.toString('base64url');
}

/**
 * Base64url-decode. Returns `undefined` if the input is not a
 * well-formed base64url string. Both halves of the cookie are
 * decoded; a malformed input surfaces as a `'malformed'` verify
 * reason.
 */
function b64urlDecode(input: string): Buffer | undefined {
  // base64url charset: `A-Za-z0-9-_`. Reject anything else early so
  // `Buffer.from(_, 'base64url')` doesn't silently strip characters.
  if (!/^[A-Za-z0-9_-]*$/.test(input)) {
    return undefined;
  }
  try {
    return Buffer.from(input, 'base64url');
  } catch {
    return undefined;
  }
}

/**
 * Compute the HMAC-SHA256 signature of a payload's base64url-encoded
 * bytes, using `secret` as the key. Returns the raw 32-byte digest.
 * Centralized so signing and verification share one computation.
 */
function hmacSign(payloadB64Url: string, secret: string): Buffer {
  const hmac = createHmac('sha256', secret);
  hmac.update(payloadB64Url);
  return hmac.digest();
}

/**
 * Sign a pending-cookie payload. Returns the cookie *value* (the
 * `<b64-payload>.<b64-hmac>` string); the route plugin composes it
 * into the full `Set-Cookie` header with attributes.
 *
 * @param payload - `{ userId, expiresAt }`. The route plugin computes
 *                  `expiresAt = now() + PENDING_COOKIE_TTL_MS`.
 * @param secret  - HMAC key. Production code passes the resolved
 *                  `SESSION_TOKEN_SECRET`; tests pass any non-empty
 *                  string. An empty secret throws — failing loud is
 *                  the right diagnostic when env wiring drifts.
 * @returns the cookie value string.
 */
export function signPendingCookie(payload: PendingCookiePayload, secret: string): string {
  if (secret.length === 0) {
    throw new Error('pending-cookie secret must be a non-empty string');
  }
  const json = JSON.stringify({ userId: payload.userId, exp: payload.expiresAt });
  const payloadB64Url = b64urlEncode(Buffer.from(json, 'utf8'));
  const sigB64Url = b64urlEncode(hmacSign(payloadB64Url, secret));
  return `${payloadB64Url}.${sigB64Url}`;
}

/**
 * Verify a pending-cookie value. Returns the ok-result with the
 * decoded payload, or an error-result discriminating the failure
 * reason. The route plugin maps every error-shape onto a single 401
 * envelope — the reason is for tests + structured logging, not for
 * the client.
 *
 * Steps:
 *
 *   1. Split on `.`; reject if not exactly two halves.
 *   2. Base64url-decode both halves; reject malformed.
 *   3. Recompute the HMAC over the encoded payload bytes and
 *      `timingSafeEqual` against the supplied signature.
 *   4. JSON.parse the decoded payload; type-check `userId` (string)
 *      and `exp` (number).
 *   5. Compare `exp` against `now()`; reject if expired.
 *
 * @param cookieValue - the raw cookie value (no Set-Cookie attrs).
 * @param options     - `{ secret, now? }`. `now` defaults to `Date.now`.
 * @returns `{ ok: true, userId, expiresAt }` or `{ ok: false, reason }`.
 */
export function verifyPendingCookie(
  cookieValue: string,
  options: { secret: string; now?: () => number },
): VerifyResult {
  const secret = options.secret;
  if (secret.length === 0) {
    throw new Error('pending-cookie secret must be a non-empty string');
  }
  const now = options.now ?? ((): number => Date.now());

  const dotIdx = cookieValue.indexOf('.');
  if (dotIdx <= 0 || dotIdx === cookieValue.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  // Reject multi-dot values defensively — exactly one separator allowed.
  if (cookieValue.indexOf('.', dotIdx + 1) !== -1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadB64Url = cookieValue.slice(0, dotIdx);
  const sigB64Url = cookieValue.slice(dotIdx + 1);
  const payloadBytes = b64urlDecode(payloadB64Url);
  const sigBytes = b64urlDecode(sigB64Url);
  if (payloadBytes === undefined || sigBytes === undefined) {
    return { ok: false, reason: 'malformed' };
  }

  // Constant-time signature check. `timingSafeEqual` requires equal
  // lengths; an unexpected-length signature is a signature failure,
  // not a malformed-payload failure (don't leak which half is wrong).
  const expectedSig = hmacSign(payloadB64Url, secret);
  if (sigBytes.length !== expectedSig.length) {
    return { ok: false, reason: 'signature-invalid' };
  }
  if (!timingSafeEqual(sigBytes, expectedSig)) {
    return { ok: false, reason: 'signature-invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload-invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'payload-invalid' };
  }
  const obj = parsed as Record<string, unknown>;
  const userId = obj['userId'];
  const exp = obj['exp'];
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, reason: 'payload-invalid' };
  }
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { ok: false, reason: 'payload-invalid' };
  }
  if (exp <= now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, userId, expiresAt: exp };
}

/**
 * Compose the full `Set-Cookie` header value for the pending cookie.
 *
 * Centralized here so the route plugin doesn't sprinkle cookie
 * attribute strings inline. The Secure attribute is added when
 * `secure` is true (production); HttpOnly + SameSite=Lax + Path=/
 * are always present. `Max-Age` is in seconds per RFC 6265.
 *
 * @param value  - the signed cookie value (from `signPendingCookie`).
 * @param opts   - `{ maxAgeMs, secure }`. `maxAgeMs` is the TTL the
 *                 browser should remember the cookie for; the cookie
 *                 payload also carries `expiresAt` so the server's
 *                 verification is independent of the browser's clock.
 *                 `secure` flips the Secure attribute — true in
 *                 production (HTTPS-only), false in dev (Compose http).
 * @returns the `Set-Cookie` header VALUE (caller adds the header name).
 */
export function buildPendingCookieHeader(
  value: string,
  opts: { maxAgeMs: number; secure: boolean },
): string {
  // Defense against header injection at the builder boundary —
  // F-011 in `docs/security/m3-review/auth.md`. Today's caller path
  // (`signPendingCookie` → this builder) emits `<b64url>.<b64url>`
  // (safe charset by construction); the assertion locks the surface
  // against a future caller passing an unsanitized value. Throws
  // `InvalidCookieValueError` — programmer-error, never reaches user
  // input, so a typed throw is the right diagnostic.
  assertSafeCookieValue(value);
  const maxAgeSeconds = Math.max(0, Math.floor(opts.maxAgeMs / 1000));
  const parts = [
    `${PENDING_COOKIE_NAME}=${value}`,
    `Max-Age=${String(maxAgeSeconds)}`,
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
 * Compose a `Set-Cookie` header that clears the pending cookie.
 * Browsers delete a cookie when they see `Max-Age=0` with matching
 * name + path; emitting Secure conditionally keeps the production
 * shape identical to the live cookie (clearing requires matching
 * attributes in practice).
 */
export function buildPendingCookieClearHeader(opts: { secure: boolean }): string {
  const parts = [`${PENDING_COOKIE_NAME}=`, 'Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Minimum acceptable length of `SESSION_TOKEN_SECRET`, measured in
 * UTF-8 bytes. 32 bytes / 256 bits matches the HS256 standard key
 * length (the JWT signing primitive in `session-token.ts`). Shorter
 * keys give an attacker a tractable offline brute-force; longer is
 * fine (HMAC truncates internally).
 *
 * Source: docs/security/m3-review/auth.md F-004.
 */
export const SESSION_TOKEN_SECRET_MIN_BYTES = 32;

/**
 * Denylist of well-known dev-placeholder secrets. Any value matching
 * one of these strings is rejected in production. The list is
 * deliberately small — only literals that have shipped in this repo's
 * `.env.example` (or close variants thereof). Adding more entries is
 * cheap, but the goal is "catch the operator who forgot to rotate
 * the example value," NOT "enforce password strength" — entropy is
 * the byte-length check's job.
 *
 * Documented entries:
 *   - `dev-session-secret-change-me` — the literal in `.env.example`
 *     (line 95).
 *   - `change-me` — generic placeholder; matches the conventional
 *     pattern an operator might paste while testing config plumbing.
 *
 * In `NODE_ENV !== 'production'` the denylist is INACTIVE — devs can
 * use the example value locally without rotating it.
 */
export const SESSION_TOKEN_SECRET_DEV_DENYLIST: readonly string[] = Object.freeze([
  'dev-session-secret-change-me',
  'change-me',
]);

/**
 * Typed error thrown by `resolveSessionTokenSecret` when the resolved
 * value fails the strength / placeholder checks. Carries a `reason`
 * discriminator for tests + structured logs; the human-readable
 * `.message` names the failure mode but NEVER echoes the rejected
 * value (logs / stderr would otherwise leak the partial-secret).
 *
 * Three reasons:
 *   - `'missing'` — env var unset or empty (regression of prior
 *     "non-empty" check).
 *   - `'too-short'` — byte length below `SESSION_TOKEN_SECRET_MIN_BYTES`.
 *     Test env (`NODE_ENV === 'test'`) carve-out: this reason is NOT
 *     raised even for a 5-char secret, so existing test fixtures
 *     (which use short fixed strings like `'test-secret'`) keep
 *     working.
 *   - `'matches-dev-placeholder'` — value appears in
 *     `SESSION_TOKEN_SECRET_DEV_DENYLIST`. Only raised when
 *     `NODE_ENV === 'production'`; dev and test environments accept
 *     the example value so contributors can `cp .env.example .env`
 *     and boot without warnings.
 */
export class SessionSecretRejectedError extends Error {
  public readonly reason: 'missing' | 'too-short' | 'matches-dev-placeholder';

  public constructor(reason: 'missing' | 'too-short' | 'matches-dev-placeholder', message: string) {
    super(message);
    this.name = 'SessionSecretRejectedError';
    this.reason = reason;
  }
}

/**
 * Resolve `SESSION_TOKEN_SECRET` from a process-env-like record.
 * Throws a `SessionSecretRejectedError` if the value fails one of:
 *
 *   1. Present + non-empty (always enforced).
 *   2. Byte length ≥ `SESSION_TOKEN_SECRET_MIN_BYTES` (UTF-8 bytes).
 *      Carved out under `NODE_ENV === 'test'` so existing test
 *      fixtures keep working with short fixed secrets.
 *   3. Not on `SESSION_TOKEN_SECRET_DEV_DENYLIST`. Only enforced
 *      under `NODE_ENV === 'production'` so devs can use the
 *      example value locally.
 *
 * The error message names the failure reason ("too short" / "matches
 * known dev placeholder") but does NOT echo the rejected value —
 * stderr / structured logs would otherwise capture partial-secret
 * material.
 *
 * Source: docs/security/m3-review/auth.md F-004 (dev secret is
 * committed literal; no boot-time strength check).
 *
 * @param env - `process.env` (or a test double).
 * @returns the secret string.
 * @throws `SessionSecretRejectedError` if any check fails.
 */
export function resolveSessionTokenSecret(env: Record<string, string | undefined>): string {
  const secret = env['SESSION_TOKEN_SECRET'];
  if (secret === undefined || secret === '') {
    throw new SessionSecretRejectedError(
      'missing',
      'SESSION_TOKEN_SECRET is not set; cannot sign session tokens or pending-auth cookies. ' +
        'Set SESSION_TOKEN_SECRET in the environment.',
    );
  }
  const nodeEnv = env['NODE_ENV'];
  // Denylist check first. The denylisted dev placeholders are shorter
  // than `SESSION_TOKEN_SECRET_MIN_BYTES` by design (the `.env.example`
  // literal is 27 bytes); checking the denylist BEFORE the length floor
  // ensures:
  //   - Production gets the more-specific `matches-dev-placeholder`
  //     reason (clearer remediation for the operator).
  //   - Dev / test get the dev-convenience pass-through: a known
  //     placeholder bypasses the length floor so contributors can
  //     `cp .env.example .env` without rotating to a 32-byte value
  //     just to boot the server locally.
  // Random short secrets (not on the denylist) still trip the length
  // check below — the carve-out is for the KNOWN placeholders only.
  if (SESSION_TOKEN_SECRET_DEV_DENYLIST.includes(secret)) {
    if (nodeEnv === 'production') {
      throw new SessionSecretRejectedError(
        'matches-dev-placeholder',
        'SESSION_TOKEN_SECRET matches a known dev placeholder and must not be used in production. ' +
          'Rotate to a high-entropy value supplied by the deployment secrets pipeline.',
      );
    }
    return secret;
  }
  // Byte-length check. The test carve-out keeps existing fixtures
  // (short fixed secrets like `'test-secret'`) working without a
  // mass-rewrite. Tests that specifically pin the rejection behavior
  // bypass the carve-out by passing an env record with
  // `NODE_ENV: 'development'` or `NODE_ENV: 'production'`.
  if (nodeEnv !== 'test' && Buffer.byteLength(secret, 'utf8') < SESSION_TOKEN_SECRET_MIN_BYTES) {
    throw new SessionSecretRejectedError(
      'too-short',
      `SESSION_TOKEN_SECRET is too short; must be at least ${String(SESSION_TOKEN_SECRET_MIN_BYTES)} bytes (UTF-8). ` +
        'Generate a high-entropy value (e.g. `openssl rand -base64 48`) and set it in the environment.',
    );
  }
  return secret;
}

/**
 * Parse the request's `Cookie` header and extract the pending-cookie
 * value, if present. Returns `undefined` if the header is absent or
 * doesn't contain our cookie. Tolerates extra cookies in the header
 * (the browser concatenates every applicable cookie into one header).
 *
 * The parsing here is intentionally minimal — we only need to find
 * one named cookie, not handle the full RFC 6265 grammar. The cookie
 * VALUE is restricted to base64url charset + `.` by our own signing,
 * so even an attacker-controlled value can't break the parse.
 */
export function readPendingCookieFromHeader(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader === '') {
    return undefined;
  }
  // Cookie header is `name1=value1; name2=value2; ...`. Split on `; `,
  // trim each pair, look for our name.
  const pairs = cookieHeader.split(';');
  for (const raw of pairs) {
    const pair = raw.trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx);
    if (name === PENDING_COOKIE_NAME) {
      return pair.slice(eqIdx + 1);
    }
  }
  return undefined;
}
