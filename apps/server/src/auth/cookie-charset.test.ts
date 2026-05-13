// Vitest unit tests for the cookie-value safe-charset assertion +
// its propagation through the two cookie-header builders.
//
// Refinement: tasks/refinements/backend-hardening/cookie_value_safe_charset.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// Source:      docs/security/m3-review/auth.md F-011
// TaskJuggler: backend_hardening.auth_hardening.cookie_value_safe_charset
//
// **Coverage**
//
//   `assertSafeCookieValue` / `InvalidCookieValueError`:
//     1. Accepts a typical HS256 JWT (`<b64>.<b64>.<b64>`).
//     2. Accepts a typical pending-cookie value (`<b64>.<b64>`).
//     3. Accepts the bare base64url alphabet (A-Z, a-z, 0-9, `-`, `_`).
//     4. Accepts a single `.` (pure separator) — degenerate but valid.
//     5. Rejects the empty string.
//     6. Rejects CR (`\r`) — primary header-injection vector.
//     7. Rejects LF (`\n`) — primary header-injection vector.
//     8. Rejects `;` — cookie-attribute separator (forged attributes).
//     9. Rejects ` ` (space) — header-folding adjacent.
//    10. Rejects `=` — cookie-name/value confusion.
//    11. Rejects `,` — comma-separated cookie list confusion.
//    12. Rejects a CR injected anywhere inside an otherwise valid value.
//    13. Throws `InvalidCookieValueError` (typed) and exposes
//        `actualLength` for diagnostic logs.
//    14. Throws with `actualLength === 0` on empty.
//
//   Propagation through `buildSessionCookieHeader`:
//    15. Regression — a typical JWT still builds the canonical header.
//    16. Rejects empty value.
//    17. Rejects a value with CR.
//    18. Rejects a value with `;`.
//
//   Propagation through `buildPendingCookieHeader`:
//    19. Regression — a typical pending-cookie value still builds.
//    20. Rejects empty value.
//    21. Rejects a value with LF.
//    22. Rejects a value with space.

import { describe, expect, it } from 'vitest';

import {
  assertSafeCookieValue,
  InvalidCookieValueError,
  SAFE_COOKIE_VALUE_REGEX,
} from './cookie-charset.js';
import { buildPendingCookieHeader, PENDING_COOKIE_NAME } from './pending-cookie.js';
import { buildSessionCookieHeader, SESSION_COOKIE_NAME } from './session-token.js';

// A representative HS256 JWT. Real `jose`-signed token captured from a
// `signSessionToken` round-trip — content is irrelevant here, only the
// charset shape matters.
const TYPICAL_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiJ1c2VyLTAwMSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwNjA0ODAwfQ' +
  '.signature-bytes-base64url_AB-CD';

// A representative pending-cookie value: `<b64url-payload>.<b64url-hmac>`.
const TYPICAL_PENDING = 'eyJ1c2VySWQiOiJ1LTAwMSJ9.abcdefABCDEF0123456789-_';

describe('SAFE_COOKIE_VALUE_REGEX', () => {
  it('is the exported source of truth for the safe charset', () => {
    // Pin the exact pattern so a future drift requires updating the
    // refinement + this test together.
    expect(SAFE_COOKIE_VALUE_REGEX.source).toBe('^[A-Za-z0-9._-]+$');
  });
});

describe('assertSafeCookieValue', () => {
  it('accepts a typical HS256 JWT', () => {
    expect(() => assertSafeCookieValue(TYPICAL_JWT)).not.toThrow();
  });

  it('accepts a typical pending-cookie value', () => {
    expect(() => assertSafeCookieValue(TYPICAL_PENDING)).not.toThrow();
  });

  it('accepts the bare base64url alphabet plus dot', () => {
    expect(() =>
      assertSafeCookieValue('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.'),
    ).not.toThrow();
  });

  it('accepts a single dot (degenerate but in-charset)', () => {
    expect(() => assertSafeCookieValue('.')).not.toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => assertSafeCookieValue('')).toThrow(InvalidCookieValueError);
  });

  it('rejects CR (\\r) — primary header-injection vector', () => {
    expect(() => assertSafeCookieValue('abc\rdef')).toThrow(InvalidCookieValueError);
  });

  it('rejects LF (\\n) — primary header-injection vector', () => {
    expect(() => assertSafeCookieValue('abc\ndef')).toThrow(InvalidCookieValueError);
  });

  it('rejects `;` — cookie-attribute separator (forged attributes)', () => {
    expect(() => assertSafeCookieValue('abc;HttpOnly')).toThrow(InvalidCookieValueError);
  });

  it('rejects space — adjacent to header folding', () => {
    expect(() => assertSafeCookieValue('abc def')).toThrow(InvalidCookieValueError);
  });

  it('rejects `=` — cookie name/value confusion', () => {
    expect(() => assertSafeCookieValue('abc=def')).toThrow(InvalidCookieValueError);
  });

  it('rejects `,` — comma-separated cookie list confusion', () => {
    expect(() => assertSafeCookieValue('abc,def')).toThrow(InvalidCookieValueError);
  });

  it('rejects CR injected anywhere in an otherwise valid value', () => {
    const injected = `${TYPICAL_JWT}\r\nSet-Cookie: evil=1`;
    expect(() => assertSafeCookieValue(injected)).toThrow(InvalidCookieValueError);
  });

  it('throws a typed InvalidCookieValueError with actualLength populated', () => {
    try {
      assertSafeCookieValue('abc def');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCookieValueError);
      const typed = err as InvalidCookieValueError;
      expect(typed.name).toBe('InvalidCookieValueError');
      expect(typed.actualLength).toBe('abc def'.length);
    }
  });

  it('throws with actualLength === 0 on empty input', () => {
    try {
      assertSafeCookieValue('');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCookieValueError);
      expect((err as InvalidCookieValueError).actualLength).toBe(0);
    }
  });
});

describe('buildSessionCookieHeader propagates the assertion', () => {
  it('regression — a typical JWT still builds the canonical header', () => {
    const header = buildSessionCookieHeader(TYPICAL_JWT, { secure: true });
    expect(header).toContain(`${SESSION_COOKIE_NAME}=${TYPICAL_JWT}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
  });

  it('rejects an empty value', () => {
    expect(() => buildSessionCookieHeader('', { secure: false })).toThrow(InvalidCookieValueError);
  });

  it('rejects a value containing CR', () => {
    expect(() => buildSessionCookieHeader('abc\r\nSet-Cookie: evil=1', { secure: false })).toThrow(
      InvalidCookieValueError,
    );
  });

  it('rejects a value containing `;`', () => {
    expect(() => buildSessionCookieHeader('abc;Path=/admin', { secure: false })).toThrow(
      InvalidCookieValueError,
    );
  });
});

describe('buildPendingCookieHeader propagates the assertion', () => {
  it('regression — a typical pending-cookie value still builds', () => {
    const header = buildPendingCookieHeader(TYPICAL_PENDING, {
      maxAgeMs: 600_000,
      secure: false,
    });
    expect(header).toContain(`${PENDING_COOKIE_NAME}=${TYPICAL_PENDING}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=600');
  });

  it('rejects an empty value', () => {
    expect(() => buildPendingCookieHeader('', { maxAgeMs: 600_000, secure: false })).toThrow(
      InvalidCookieValueError,
    );
  });

  it('rejects a value containing LF', () => {
    expect(() =>
      buildPendingCookieHeader('abc\ninject', { maxAgeMs: 600_000, secure: false }),
    ).toThrow(InvalidCookieValueError);
  });

  it('rejects a value containing space', () => {
    expect(() => buildPendingCookieHeader('abc def', { maxAgeMs: 600_000, secure: false })).toThrow(
      InvalidCookieValueError,
    );
  });
});
