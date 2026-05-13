// Cookie-value safe-charset assertion — header-injection defense for
// the platform's `Set-Cookie` builders.
//
// Refinement: tasks/refinements/backend-hardening/cookie_value_safe_charset.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// Source:      docs/security/m3-review/auth.md F-011
// TaskJuggler: backend_hardening.auth_hardening.cookie_value_safe_charset
//
// **What this module owns.** One typed error + one assertion:
//
//   1. `InvalidCookieValueError` — thrown when a cookie value is
//      rejected. Programmer-error path; no user-input reaches here so
//      the throw is the correct shape (a 400 would imply user input).
//   2. `assertSafeCookieValue(value)` — narrows the supplied value
//      against the allow-listed charset. `void` return on success;
//      throws `InvalidCookieValueError` on failure.
//
// **Allowed charset.** `/^[A-Za-z0-9._\-]+$/` — base64url's
// `A-Za-z0-9-_` plus `.` (the JWT and pending-cookie separator).
// This is exactly the surface both production callers emit today:
//
//   - `session-token.ts` emits a JWT (`<b64url-header>.<b64url-payload>.<b64url-sig>`).
//   - `pending-cookie.ts` emits `<b64url-payload>.<b64url-hmac>`.
//
// **Why this assertion exists.** Per F-011, the two cookie builders
// interpolate the value verbatim into the `Set-Cookie` header
// (`${COOKIE_NAME}=${token}`). Today the producers happen to emit
// values restricted to the safe charset; the builders don't enforce
// that property. A future caller passing an unsanitized value (e.g. a
// debug cookie carrying a CR or `;`) would header-inject. This
// assertion closes the latent regression at the builder boundary — no
// user-input today, but the surface is locked against drift.
//
// **Why throw, not return a 400.** This is a programmer-error path —
// no user-controlled string ever reaches a `build*CookieHeader` call
// site. Both today's producers (`signSessionToken`, `signPendingCookie`)
// emit values from a constrained charset by construction. A failure
// here means a caller in `apps/server/src/...` synthesised a
// non-conforming value; that's a code bug, not a request rejection.
// The right diagnostic is a typed throw that fails the boot path or
// the failing test, not a 400 envelope on the wire.

/**
 * The regex pinning the safe charset. Exported so tests and future
 * callers can reference the exact source of truth; do not duplicate
 * this pattern elsewhere.
 *
 * Charset: `A-Z`, `a-z`, `0-9`, `.`, `_`, `-`. One or more characters
 * required (empty values are rejected). The character set is a strict
 * subset of RFC 6265's `cookie-octet` grammar (which permits more, but
 * we restrict further so the value is also URL- and header-safe
 * without quoting). Notable rejections that would otherwise be
 * cookie-octet-legal: space, comma, semicolon, equals, double-quote,
 * backslash, and every CTL — including `\r` and `\n`, which is the
 * header-injection vector this assertion exists to close.
 */
export const SAFE_COOKIE_VALUE_REGEX = /^[A-Za-z0-9._-]+$/;

/**
 * Thrown when `assertSafeCookieValue` rejects its input. The
 * `actualLength` field is non-leaking diagnostic detail (the length
 * of the rejected value); the value itself is NOT included on the
 * error so a programmer-error log line doesn't leak partial token
 * bytes. The `message` is a fixed literal — the discriminator is the
 * error class, not the text.
 */
export class InvalidCookieValueError extends Error {
  /**
   * Length of the rejected value in UTF-16 code units. Useful for
   * differentiating "empty string" from "had CR at offset N" without
   * including the value itself. Empty rejection sets this to `0`.
   */
  public readonly actualLength: number;

  public constructor(actualLength: number) {
    super('cookie value contains characters outside the safe charset');
    this.name = 'InvalidCookieValueError';
    this.actualLength = actualLength;
  }
}

/**
 * Assert that `value` matches the safe cookie-value charset.
 *
 * Returns `void` on success; throws `InvalidCookieValueError` on
 * failure. Called by `buildSessionCookieHeader` and
 * `buildPendingCookieHeader` immediately before interpolation, so a
 * misbehaving caller fails loud at the builder boundary instead of
 * silently emitting a header-injected `Set-Cookie`.
 *
 * The check is purely structural — no I/O, no clock, no secret. Safe
 * to call in hot paths (the regex match on a typical JWT is a few
 * hundred nanoseconds in V8).
 *
 * @param value - the cookie value string about to be interpolated
 *                into a `Set-Cookie` header.
 * @throws `InvalidCookieValueError` if `value` is empty or contains
 *         any character outside `[A-Za-z0-9._\-]`.
 */
export function assertSafeCookieValue(value: string): void {
  // Empty values are rejected defensively: a builder asked to emit
  // `name=` with no value would produce a header that LOOKS like a
  // cookie-clear, conflating set-with-value and clear semantics. The
  // dedicated `build*CookieClearHeader` helpers handle the
  // intentional-clear case; this assertion guards the set path.
  if (value.length === 0) {
    throw new InvalidCookieValueError(0);
  }
  if (!SAFE_COOKIE_VALUE_REGEX.test(value)) {
    throw new InvalidCookieValueError(value.length);
  }
}
