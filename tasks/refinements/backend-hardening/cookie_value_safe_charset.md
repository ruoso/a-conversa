# Assert cookie-value safe charset in cookie builders

**Source finding**: [`docs/security/m3-review/auth.md` F-011](../../../docs/security/m3-review/auth.md) — `Set-Cookie` header composition does not URL-encode the cookie value; pending-cookie's `.`-separated base64url is safe but the discipline isn't enforced.

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.cookie_value_safe_charset`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — `buildSessionCookieHeader` lives in `apps/server/src/auth/session-token.ts`), `backend.auth.screen_name_collection` (settled — `buildPendingCookieHeader` lives in `apps/server/src/auth/pending-cookie.ts`).

## What this task is

Land a single shared assertion `assertSafeCookieValue(value: string): void` and wire it into the two `Set-Cookie`-header builders the platform owns (`buildSessionCookieHeader` and `buildPendingCookieHeader`). The assertion narrows the supplied value against the regex `/^[A-Za-z0-9._\-]+$/` — base64url's alphabet (`A-Za-z0-9-_`) plus the `.` separator that both producers use today. Failure throws a typed `InvalidCookieValueError`; success returns void.

The assertion is added to **both** set-the-cookie builders (the helpers that interpolate `${COOKIE_NAME}=${value}` into the header). The `build*CookieClearHeader` helpers are unchanged: they emit `name=` with no value, which is the intentional-clear shape, and adding the set-path's non-empty-value assertion there would break the clear semantics.

## Why it needs to be done

Per F-011, the two cookie builders today interpolate the value verbatim into the header:

```ts
`${COOKIE_NAME}=${token}`
```

The current producer paths (`signSessionToken` and `signPendingCookie`) emit values restricted to a safe charset by construction — a JWT (`<b64url>.<b64url>.<b64url>`) and a pending-cookie value (`<b64url>.<b64url>`). So there's no exploit today. But the builders **don't enforce** that property. A future caller passing an unsanitized value — a debug cookie carrying a CR, a feature-flag cookie carrying a `;`, anything that wasn't designed against header injection from day one — would produce a `Set-Cookie` with attacker-controlled attributes (`HttpOnly`, `Domain`, additional `Set-Cookie` lines after `\r\n`, etc.).

The fix is one assertion at the builder boundary. The latent regression is closed without any change to today's call sites.

## Inputs / context

From [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) (`buildSessionCookieHeader`, lines 278-294):

- Takes `token: string` and `{ secure, maxAgeSeconds? }`.
- First line of `parts` is `` `${SESSION_COOKIE_NAME}=${token}` `` — the verbatim interpolation.
- Returns the `Set-Cookie` header VALUE (caller adds the header name).

From [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts) (`buildPendingCookieHeader`, lines 255-271):

- Same shape — `value: string` + opts; verbatim interpolation; returns the header value.

From RFC 6265, §4.1.1:

```
cookie-octet      = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E
                    ; US-ASCII characters excluding CTLs,
                    ; whitespace DQUOTE, comma, semicolon,
                    ; and backslash
```

The RFC's `cookie-octet` charset is wider than the producers' actual surface. We pick the strict subset that matches both today's producers AND happens to be URL- / header-safe with no quoting: base64url alphabet plus `.`. The regex `/^[A-Za-z0-9._\-]+$/` captures exactly that surface.

The notable rejections (vs. RFC `cookie-octet`):

- **`\r`, `\n`, every CTL** — the primary header-injection vector. CR-LF terminates the `Set-Cookie` header and lets an attacker append additional headers (a second `Set-Cookie`, a `Content-Type` override, etc.).
- **`;`** — cookie-attribute separator. A `;` inside the value lets an attacker forge `HttpOnly`, `Domain`, `Path`, `Max-Age` attributes from inside the value field.
- **`=`** — confusing name=value parsing on the client; not strictly an injection, but breaks the round-trip.
- **`,`** — comma-separated cookie-list confusion (some legacy parsers split `Set-Cookie` on `,`).
- **space** — adjacent to header-folding (obsolete but still present in some intermediaries).
- **`"`, `\`** — quoted-pair / quoted-string confusion in cookie-pair parsing.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure-logic check; lands as Vitest. The two builder propagations also Vitest (same surface as the existing builder tests in `session-token.test.ts` / `screen-name.test.ts`).

## Constraints / requirements

- **Single source of truth for the regex.** `SAFE_COOKIE_VALUE_REGEX` exported from the new `cookie-charset.ts` module. The pattern is documented inline (allowed charset + rejected characters with rationale). Tests pin `regex.source` so a future drift requires updating both the refinement and the test in the same commit.
- **Typed throw, not a 400.** No user-input ever reaches `buildSessionCookieHeader` / `buildPendingCookieHeader`. The producers are server-side helpers (`signSessionToken`, `signPendingCookie`); their output charset is constrained by construction. A failure here is a code bug. The right diagnostic is `InvalidCookieValueError` — a typed `Error` subclass — propagated to the test or the boot path. Returning a 400 would imply user-input validation, which this is NOT.
- **Empty value rejected.** A `name=` with no value is the intentional-clear shape and is owned by the dedicated `build*CookieClearHeader` helpers. The set-path's assertion rejects empty defensively so a misconfigured caller doesn't conflate set-with-value and clear semantics.
- **Both `build*CookieHeader` builders propagate.** Both call sites call the assertion as the first statement of the body, immediately before the verbatim interpolation. The `build*CookieClearHeader` helpers are unchanged.
- **No-leak diagnostic.** `InvalidCookieValueError` carries `actualLength` (the rejected value's string length) but NOT the value itself. A log line emitted from a programmer-error path shouldn't leak partial token bytes.
- **No throwaway probes (ADR 0022).** Every assertion behavior we pin lands as a Vitest case. The test file (`cookie-charset.test.ts`) covers: positive accepts (typical JWT, typical pending value, bare alphabet, single `.`); negative rejects (empty, CR, LF, `;`, space, `=`, `,`, injected-CR-in-middle); the typed-error shape (`InvalidCookieValueError` instance + `actualLength`); propagation through both builders (regression + four rejection vectors per builder).

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run check` succeeds (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` (Vitest) green; net positive test delta from `cookie-charset.test.ts`.
- A reader of the test file can map every assertion to a documented header-injection vector or producer-charset regression.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Allowed charset is base64url + `.`** (`/^[A-Za-z0-9._\-]+$/`). Rationale: this is exactly what both production callers emit today (JWT and pending-cookie); restricting further keeps the cookie value URL- and header-safe without any quoting, and the `+` quantifier is the empty-rejection.
- **One helper, two builder call sites.** `assertSafeCookieValue` lives in a new module `apps/server/src/auth/cookie-charset.ts` (alongside `session-token.ts` and `pending-cookie.ts`). The two builders import it. Pulling it into a new module rather than co-locating in one builder avoids a circular-feeling dep (each builder is currently independent; sharing through a third module preserves that).
- **Typed throw via `InvalidCookieValueError extends Error`.** Programmer-error path → typed throw is the project's pattern (cf. `OidcConfigError`, `AuthStateMismatchError`, `EventValidationError`). The error carries `actualLength: number` for diagnostic logging; the value itself is NOT included to avoid leaking partial token bytes.
- **Empty string rejected defensively.** Even though no current caller passes empty, rejecting empty in the set-path prevents conflation with the clear-path. `build*CookieClearHeader` helpers are the intentional-clear surface and remain untouched.
- **No effect on `build*CookieClearHeader`.** The clear helpers emit `name=` (empty value) by design; gating them on the same assertion would break the cookie-clear semantics. The set/clear split is the design boundary.
- **Pin the regex literal in tests.** A test asserts `SAFE_COOKIE_VALUE_REGEX.source === '^[A-Za-z0-9._\\-]+$'` so a future drift (someone adds `/` or relaxes the pattern) breaks the test and forces an update to the refinement.
- **The assertion runs in hot paths.** `buildSessionCookieHeader` runs once per `/auth/callback`, once per `/auth/screen-name`, and once per `/auth/logout` (the clear path); `buildPendingCookieHeader` runs once per pending-cookie set. None is per-WS-message, none is per-broadcast. Cost: a few hundred ns of regex match. Negligible.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- New module: [`apps/server/src/auth/cookie-charset.ts`](../../../apps/server/src/auth/cookie-charset.ts) — `SAFE_COOKIE_VALUE_REGEX`, `InvalidCookieValueError`, `assertSafeCookieValue`.
- Wiring (1 line of import + 1 call): [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) `buildSessionCookieHeader` now calls `assertSafeCookieValue(token)` before interpolation.
- Wiring (1 line of import + 1 call): [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts) `buildPendingCookieHeader` now calls `assertSafeCookieValue(value)` before interpolation.
- Barrel: [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) re-exports `assertSafeCookieValue`, `InvalidCookieValueError`, `SAFE_COOKIE_VALUE_REGEX`.
- Tests: [`apps/server/src/auth/cookie-charset.test.ts`](../../../apps/server/src/auth/cookie-charset.test.ts) — 22 cases covering the regex pin, accepts (typical JWT / typical pending / full alphabet / single dot), rejects (empty / CR / LF / `;` / space / `=` / `,` / injected-CR-mid-value), the typed-error shape (`InvalidCookieValueError` + `actualLength`), and propagation through both builders.
- WBS: `complete 100` marker added to `cookie_value_safe_charset` in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
