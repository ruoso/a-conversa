// Vitest unit tests for `verifyPendingCookie`'s clock semantics.
//
// Refinement: tasks/refinements/backend-hardening/pending_cookie_clock_skew_pin.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// Source:      docs/security/m3-review/coverage.md G-011
// TaskJuggler: backend_hardening.protocol_test_pinning.pending_cookie_clock_skew_pin
//
// **Coverage**
//
//   `verifyPendingCookie` clock-skew pin (G-011):
//     1. Baseline accept — verify at t+5min (mid-life), default-shaped
//        `now`. The verifier honors the cookie and returns the userId.
//     2. Baseline reject — verify at t+11.6min (post-expiry), default-
//        shaped `now`. The verifier rejects with `reason: 'expired'`.
//     3. Clock-skew accept (backward) — verify at the same mid-life
//        instant, but with `now` returning t-100s (server clock jumped
//        backward past sign-time). The verifier ACCEPTS the cookie:
//        `exp` is compared against the injected `now()`, NOT against
//        real wall time, NOT against any embedded sign-time, NOT
//        against any maximum-skew bound. THIS IS THE DELIBERATE
//        TRADE-OFF the test pins.
//     4. Clock-skew reject (forward) — verify at the wall-expired
//        instant with `now` returning t+200s (server clock ahead). The
//        verifier still rejects with `reason: 'expired'`: a forward-
//        skewed clock does not rescue an already-expired cookie either,
//        and the symmetric assertion catches a future comparison-flip
//        bug that would pass cases 1-3 alone.

import { describe, expect, it } from 'vitest';

import { signPendingCookie, verifyPendingCookie, PENDING_COOKIE_TTL_MS } from './pending-cookie.js';

describe('pending-cookie clock-skew (G-011)', () => {
  // This block pins the CURRENT behavior of `verifyPendingCookie`:
  // the verifier consults whatever `now` the caller hands it (or
  // `Date.now()` by default), compares the injected `now()` against
  // the cookie's signed `expiresAt`, and accepts iff `expiresAt > now()`.
  //
  // The trade-off — and the source-of-finding G-011 in
  // `docs/security/m3-review/coverage.md` — is that the verifier has
  // NO bound on acceptable clock skew. If the server's clock jumps
  // backward past `expiresAt` (NTP correction, container clock drift,
  // a multi-region deployment where one node lags the others), a
  // previously-expired cookie BECOMES VALID AGAIN. The verifier never
  // reads sign-time from the payload (no sign-time is embedded) and
  // never consults real wall time independently of the injected `now`.
  //
  // For v1, the deliberate choice is: trust the server clock. A future
  // hardening task — provisionally `pending_cookie_max_skew` — could
  // bound the acceptable skew by embedding `iat` in the payload and
  // rejecting `now() < iat - max_skew_ms`. That task may or may not
  // land; this test pins the v1 trade-off so an auditor sees the
  // choice as explicit-and-accepted rather than overlooked.
  //
  // The four cases below cover the four-corner table of (mid-life vs.
  // wall-expired) × (clock-correct vs. clock-skewed). Cases 3 and 4
  // are the load-bearing pins; cases 1 and 2 are the baseline that a
  // future refactor must not break.

  const SECRET = 'test-secret';
  const USER_ID = 'fixture-user-id';
  const T = 0;
  // 10 minutes — equal to `PENDING_COOKIE_TTL_MS`, but the test sets
  // the literal `T + PENDING_COOKIE_TTL_MS` for `expiresAt` rather
  // than computing from `Date.now()`, so the verify-side instants are
  // unambiguous.
  const EXPIRES_AT = T + PENDING_COOKIE_TTL_MS;

  it('baseline accept — verify mid-life (t+5min) with correct clock', () => {
    const cookie = signPendingCookie({ userId: USER_ID, expiresAt: EXPIRES_AT }, SECRET);
    const result = verifyPendingCookie(cookie, {
      secret: SECRET,
      now: (): number => T + 300_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(USER_ID);
      expect(result.expiresAt).toBe(EXPIRES_AT);
    }
  });

  it('baseline reject — verify post-expiry (t+11.6min) with correct clock', () => {
    const cookie = signPendingCookie({ userId: USER_ID, expiresAt: EXPIRES_AT }, SECRET);
    const result = verifyPendingCookie(cookie, {
      secret: SECRET,
      now: (): number => T + 700_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
    }
  });

  it('clock-skew accept (backward) — verify mid-life with `now` returning t-100s', () => {
    // The deliberate trade-off: a server clock that jumped backward
    // past sign-time accepts a cookie that — by the cookie's own
    // signed `expiresAt` — is still in the future relative to the
    // injected `now()`. The verifier honors the injected clock; there
    // is no max-skew bound, no embedded sign-time to consult, no real-
    // wall-time fallback. THIS IS THE G-011 PIN.
    const cookie = signPendingCookie({ userId: USER_ID, expiresAt: EXPIRES_AT }, SECRET);
    const result = verifyPendingCookie(cookie, {
      secret: SECRET,
      now: (): number => T - 100_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(USER_ID);
      expect(result.expiresAt).toBe(EXPIRES_AT);
    }
  });

  it('clock-skew reject (forward) — verify post-expiry with `now` returning t+200s past wall expiry', () => {
    // Symmetric pin: a forward-skewed clock does NOT rescue an
    // already-expired cookie. The wall-clock instant is t+900_000
    // (past the cookie's expiresAt of t+600_000); the injected `now`
    // pushes it further to t+1_100_000. A future comparison-flip bug
    // (`exp >= now()` instead of `exp <= now()`) would pass cases
    // 1-3 alone; this case catches it.
    const cookie = signPendingCookie({ userId: USER_ID, expiresAt: EXPIRES_AT }, SECRET);
    const result = verifyPendingCookie(cookie, {
      secret: SECRET,
      now: (): number => T + 900_000 + 200_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
    }
  });
});
