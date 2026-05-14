Source: docs/security/m3-review/coverage.md G-005

# Pin the logout-doesn't-revoke trade-off (until `jwt_revocation_jti_denylist` lands)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.logout_no_revocation_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — produced the stateless HS256 JWT + cookie surface this task pins); `backend.auth.auth_middleware` (settled — produced the `app.authenticate` preHandler the `/auth/me` route opts into, which is the surface this test replays against).

## What this task is

Add a single Vitest case to [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) that pins the **current**, **documented limitation** of `POST /auth/logout`:

1. Authenticate (mint a session JWT directly via `signSessionToken`).
2. Capture the cookie value.
3. POST `/auth/logout` with the cookie. Assert the response's `Set-Cookie` clears the browser-side cookie (`Max-Age=0`).
4. **Replay the EXACT same cookie value** against `GET /auth/me`. Assert it **still returns 200**: the JWT is structurally valid, the secret hasn't rotated, and the server holds NO denylist — so the "logged-out" cookie continues to authenticate.

The case lives inside a dedicated `describe('POST /auth/logout — known trade-off: no server-side revocation (G-005)')` block whose leading block comment is the auditor-readable record of:

- This pin documents **current** behavior, not desired behavior.
- This is an **accepted limitation** with three review references: `docs/security/m3-review/auth.md` F-001 (logout is unauthenticated and accepts anonymous POSTs; JWT remains valid until expiry), F-006 (JWT is a portable bearer credential with no per-device binding), and `docs/security/m3-review/coverage.md` G-005 (the trade-off has no committed test pinning it).
- When the structural fix — task `backend_hardening.auth_hardening.jwt_revocation_jti_denylist`, refinement `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md` — lands, **this test MUST be inverted** to assert `expect(response.statusCode).toBe(401)` and the `describe` rename should drop the "known trade-off" suffix (the surface will then enforce revocation, not document its absence).

## Why it needs to be done

G-005 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

> The logout endpoint clears the browser cookie but the JWT remains structurally valid until its 7-day `exp`. There is NO test that the same JWT, replayed after logout (e.g., recovered from browser cache, server log, or proxy), is rejected. The `session-token.ts` module's docblock acknowledges deferring revocation; no audit test pins the trade-off (so a reviewer wouldn't realise this is an explicit accepted risk).

The structural fix (denylist) is a separate task with non-trivial scope (migration + per-verify lookup + cache strategy + WS connection refresh). This task is the cheap pin that closes the **coverage** half of G-005 today, so:

- An auditor running `grep -r "G-005" apps/server` finds the test, reads the leading block comment, and learns the trade-off is documented and intentional rather than overlooked.
- The CI suite carries a positive signal that the JWT round-trips after logout — so when `jwt_revocation_jti_denylist` lands and the cookie *should* be rejected, the inverted assertion makes the regression obvious and the diff is mechanical (`toBe(200)` → `toBe(401)`).
- ADR 0022 requires every empirical claim about system behavior to land as a committed test; this test is the empirical claim "after logout, the replayed cookie still authenticates."

The pin is also the audit-trail anchor for F-001 and F-006, which name the same residual risk from different angles (logout endpoint, token shape). One test covers both findings.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-005 — source coverage gap (High severity, "acknowledged limitation should be pinned by a test per ADR 0022").
- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md) F-001 — `/auth/logout` is unauthenticated and accepts anonymous POSTs; JWT remains valid until expiry (no server-side revocation). F-006 — `verifySessionToken` does not bind the JWT to anything other than the secret; cookie copied between devices/browsers is fully portable.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts):829 — the `POST /auth/logout` handler. Clears the cookie via `buildSessionCookieClearHeader` and emits a 204. No `app.authenticate` preHandler; no token lookup, no denylist write, no DB touch.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts):857 — the `GET /auth/me` handler. Uses `preHandler: authMePreHandler` which chains `app.authenticate`. The middleware calls `verifySessionToken` on the cookie, looks up the user row, and either resolves `request.authUser` or throws `ApiError(401, 'auth-required', ...)`. There is no denylist consultation — verification is HMAC + payload-shape + clock only.
- [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) — `signSessionToken` mints `{ sub, iat, exp }`, `verifySessionToken` accepts any signature-valid + payload-shape-valid + unexpired token. No per-token state.
- [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) — the test file the new case joins. The existing `describe('POST /auth/logout', ...)` block (lines 684-730) already covers cookie-clear on the no-cookie / valid-cookie / invalid-cookie paths via the same `buildApp(...)` helper; the new describe sits adjacent so a reader sees the three "what logout does" pins next to the one "what logout does NOT do" pin.
- [`tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`](./jwt_revocation_jti_denylist.md) — the future structural-fix task. Its acceptance criteria will include "invert the assertion in `session-token.test.ts`'s `POST /auth/logout — known trade-off: no server-side revocation (G-005)` describe to expect 401." Cross-referenced by file path in the test's leading comment.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — the discipline ADR. The test is the verification, committed; no ad-hoc probe.
- [`tasks/refinements/backend-hardening/README.md`](./README.md) §"JWT revocation" — explicitly names this pin as the placeholder that should land FIRST (cheap, pins current behavior) and then be UPDATED by the denylist task.

## Constraints / requirements

- **TEST-ONLY.** No production code changes. The handler at `routes.ts:829` and the verifier at `session-token.ts` stay intact. The test only documents what they currently do.
- **Auditor-readable leading comment.** The `describe` block opens with a comment that:
  - States this pins **current** behavior.
  - Names the three review references: `auth.md` F-001 + F-006 + `coverage.md` G-005.
  - Names the future task by **tji path** (`backend_hardening.auth_hardening.jwt_revocation_jti_denylist`) AND by refinement path (`tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`).
  - States explicitly that the test MUST be **inverted** when the denylist lands — `expect(...statusCode).toBe(200)` → `expect(...statusCode).toBe(401)` — and the describe title should drop the "known trade-off" suffix.
- **Use the existing `buildApp` harness.** Same Map-backed pool, same `signSessionToken` + `SESSION_COOKIE_NAME` primitives, same Fastify `.inject(...)` shape as every other `/auth/me` and `/auth/logout` test in the file. No new helper, no new mock.
- **Pin the WHOLE round-trip, not pieces.** A single `it(...)` that:
  1. Mints a token with `signSessionToken`.
  2. Verifies the cookie is accepted by `/auth/me` (pre-logout sanity: 200).
  3. Calls `POST /auth/logout` with the cookie; asserts 204 + `Max-Age=0` on the response's `Set-Cookie` (parity with the cookie-clear pins above).
  4. **Replays the original cookie value** against `/auth/me`; asserts 200 — the JWT still authenticates.
  5. Asserts the response body still names the same user (regression on the "JWT carries `sub`" contract — if a future refactor accidentally rewrites the `sub` claim on logout, the body comparison would catch it).
- **Single test, one describe.** Splitting into multiple `it(...)`s would dilute the pin and require duplicate setup; the trade-off is a single behavior with a single set of assertions.
- **No new exports, no new module.** The test consumes only the existing public surface of `session-token.ts` and the existing route plugin.
- **Verifications per ADR 0022.** Vitest unit test under `apps/server/src/auth/`, in the same file as the surface it pins.

## Acceptance criteria

- `apps/server/src/auth/session-token.test.ts`:
  - New `describe('POST /auth/logout — known trade-off: no server-side revocation (G-005)', ...)` block immediately following the existing `POST /auth/logout` describe (around line 730).
  - Leading block comment names `auth.md` F-001, F-006, `coverage.md` G-005, the future task by tji path AND refinement path, and the "invert this test when denylist lands" instruction.
  - A single `it(...)` case that: mints a token, sanity-checks `/auth/me` → 200, POSTs `/auth/logout` + asserts 204 + `Max-Age=0`, **replays the same cookie value** to `/auth/me` + asserts 200, asserts the response body still carries the same `userId` and `screenName`.
- The test file's coverage comment (the top-of-file `**Coverage**` block) is extended with a new bullet describing the G-005 pin.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest case; all pass.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit. The commit message follows the convention specified in the task brief.

## Decisions

- **Intentional limitation-pin.** This task is a TEST that documents an **accepted** limitation, not a fix. The structural fix lives in the separate `jwt_revocation_jti_denylist` task. Landing the pin first is the cheaper / faster half of G-005's two-part closure; the auditor's "is this overlooked or accepted?" question is answered today, the runtime behavior is changed when the denylist task ships.
- **Single test, not a parametrised matrix.** The trade-off has one shape — "replayed cookie still works." Splitting into "valid cookie replayed", "valid cookie replayed N times", "valid cookie replayed after delay" would multiply identical-shape assertions without adding signal. One `it(...)` keeps the invert-the-assertion future task to a one-line diff.
- **Location: `session-token.test.ts`, not a new file.** The existing `POST /auth/logout` describe lives there; placing the trade-off pin adjacent keeps "what logout does" and "what logout does NOT do" in one cognitive frame. A separate file would force a reader to chase the assertion across two locations.
- **The leading comment is the audit-trail anchor, not just commentary.** An auditor reading the test file is the primary intended reader. The comment is structured so `grep -r "G-005" apps/server/src/auth/` lands directly on it, the three review references are listed in a single paragraph, and the inversion instruction names the future task explicitly so the next maintainer doesn't have to reason from scratch.
- **Cross-reference the future task by both names.** Test comment names both the tji path (`backend_hardening.auth_hardening.jwt_revocation_jti_denylist`) AND the refinement file path. The tji path is what `tj3`'s dependency graph reads; the refinement path is what a maintainer opens to see the scope. Both anchors keep the cross-link resilient against either filename being renamed.
- **The pre-logout `/auth/me` 200 is a sanity assertion, not the load-bearing one.** Without it, a setup bug (e.g., a token mint that's rejected by the verifier) would mask the real signal. The load-bearing assertion is step 4: the **same** cookie value replayed **after** logout still resolves to 200.
- **Assert the response body, not just the status code, on the post-logout `/auth/me`.** Status 200 alone doesn't pin "the JWT still names this user" — a future refactor that returns 200 with an empty body, or 200 with a different user's body, would pass the status check while breaking the contract. Asserting `body.userId === aliceId` + `body.screenName === 'alice'` makes the contract auditor-readable.
- **No new constants, no helper extraction.** The test consumes `SESSION_COOKIE_NAME`, `signSessionToken`, and `buildApp` — all already imported in this file. Adding a "replayCookieAgainstAuthMe" helper would obscure the four-line round-trip; keeping it inline matches the file's prevailing style.
- **The invert-instruction lives in the test comment, not in the future-task refinement.** The future-task refinement WILL also reference this test (acceptance criteria: "invert the G-005 pin"), but the load-bearing direction is here-to-future: a maintainer working on the denylist task reads this test first (it appears in the diff that adds the denylist), sees the inversion instruction, and updates accordingly. The reverse direction (future task says "go invert this") would require the maintainer to remember to come back, which is fragile.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) — added `describe('POST /auth/logout — known trade-off: no server-side revocation (G-005)', ...)` block immediately following the existing `POST /auth/logout` describe. One `it(...)` case: mint a token via `signSessionToken`, sanity-check `/auth/me` 200 + body match, POST `/auth/logout` + assert 204 + `Max-Age=0`, replay the EXACT same cookie value to `/auth/me` + assert 200 + body still resolves to the same user. The block's leading comment names `auth.md` F-001 + F-006, `coverage.md` G-005, and the future task's tji path (`backend_hardening.auth_hardening.jwt_revocation_jti_denylist`) AND refinement path (`tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`), with explicit invert-the-assertion instructions for when the denylist lands.
- Top-of-file `**Coverage**` block extended with bullet `22a` describing the G-005 pin.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `logout_no_revocation_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: +1 `it(...)` in `session-token.test.ts` (47 → 48). `pnpm run check` and `pnpm run test:smoke` both pass.

**Note for the maintainer landing `jwt_revocation_jti_denylist`**: this test's `describe` title contains the substring `— known trade-off`. The denylist task's diff will need to (a) flip `expect(replay.statusCode).toBe(200)` to `toBe(401)`, (b) remove the post-replay body equality assertions (the 401 envelope has no `userId` / `screenName`), and (c) rename the describe to drop the trade-off suffix. The test's leading comment lays out these three steps explicitly so the inversion is mechanical.

**INVERSION LANDED — 2026-05-11.**

The `jwt_revocation_jti_denylist` task shipped on 2026-05-11 (see [`tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`](./jwt_revocation_jti_denylist.md)'s Status block). The pin test was inverted as planned:

- The `describe` block title is now `'POST /auth/logout — server-side revocation via jti + denylist (G-005)'` (dropped the `— known trade-off: no server-side revocation` suffix).
- The `it(...)` body now expects `expect(replay.statusCode).toBe(401)` on the post-logout replay and asserts the `auth-required` envelope code via the response body's `error.code` field. The previous body equality assertions on `userId` + `screenName` were removed (the 401 envelope has no such fields).
- The leading block comment was rewritten to record the inversion + the source findings (`auth.md` F-001 + F-006, `coverage.md` G-005) that the structural fix closes. The substring `INVERT TO 401` is gone — the inversion has landed and the maintainer-facing instructions in the original pin are now history.

The pin's audit-trail role is preserved: an auditor running `grep -r "G-005" apps/server/src/auth/` still lands on the same test (now asserting the correct behavior), and the test's leading comment still references `auth.md` F-001 + F-006 + `coverage.md` G-005 so the cross-link to the source findings survives.
