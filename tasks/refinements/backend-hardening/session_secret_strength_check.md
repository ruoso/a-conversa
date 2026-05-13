Source: docs/security/m3-review/auth.md F-004

# Boot-time `SESSION_TOKEN_SECRET` strength enforcement

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.session_secret_strength_check`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — produced `resolveSessionTokenSecret` + the HS256 signing surface in `apps/server/src/auth/session-token.ts`); `backend.auth.screen_name_collection` (settled — `pending-cookie.ts` is where `resolveSessionTokenSecret` lives, alongside the pending-cookie HMAC helpers that share the same secret).

## What this task is

Replace the lone "present and non-empty" check on `SESSION_TOKEN_SECRET` with a fail-loud-at-boot strength gate. After this task lands, `resolveSessionTokenSecret(process.env)`:

1. Throws a typed `SessionSecretRejectedError` if the env var is missing or empty (regression of the prior check, but as a structured error rather than a plain `Error`).
2. Throws if the UTF-8 byte length is below `SESSION_TOKEN_SECRET_MIN_BYTES = 32`. **Test-env carve-out**: `NODE_ENV === 'test'` skips the length floor so existing test fixtures (`'unit-test-secret-key'`, `'test-secret'`, etc.) keep working without a mass-rewrite.
3. Throws if `NODE_ENV === 'production'` AND the value appears in `SESSION_TOKEN_SECRET_DEV_DENYLIST` (the two well-known committed dev placeholders). Dev and test environments accept the example value so contributors can `cp .env.example .env` and boot.

The resolver is then pre-flighted in `apps/server/src/index.ts`'s `main()` BEFORE `createServer()`, so a failed check writes the non-leaking message to stderr and `process.exit(1)`s before the port binds.

## Why it needs to be done

F-004 in [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) is the source finding (Medium severity, Confirmed):

> The shipped dev secret is the literal `"dev-session-secret-change-me"`. `resolveSessionTokenSecret` enforces "present and non-empty" only — no minimum length, no entropy check. The same secret is used for both the HS256 JWT (`session-token.ts`) and the pending-cookie HMAC (`pending-cookie.ts`), so a single compromise breaks both bridges. A developer who copies `.env.example` to `.env` and forgets to rotate ships a guessable secret to dev/staging; a deployment that forgets to set the env var fails-loud (good), but the loud failure happens at first OIDC callback, not at boot.

Two failure modes follow from the gap:

- **Low-entropy secret in production** — combined with F-001 (no revocation) and F-006 (no per-device binding), a forgeable cookie stays valid for 7 days with no mitigation.
- **Late-bound failure on missing var** — current behavior surfaces the missing-secret diagnostic at first `/auth/callback`. By that time the port is bound, the health endpoint reports green, and an operator has a deceptively-running server. A boot-time gate inverts the failure shape: either "schema + secrets are current AND server is up" or "operator sees the diagnostic AND no port is bound."

The check itself is cheap (three comparisons + a denylist lookup); the implementation cost is bounded; the marginal-cost-vs-marginal-benefit profile favors landing it.

## Inputs / context

- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md) F-004 — source finding.
- [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts) — already owns `resolveSessionTokenSecret`. The strength check + the typed error + the constants land here so the resolver remains a single import surface.
- [`apps/server/src/auth/index.ts`](../../../apps/server/src/auth/index.ts) — barrel; re-exports the two new constants (`SESSION_TOKEN_SECRET_MIN_BYTES`, `SESSION_TOKEN_SECRET_DEV_DENYLIST`) and the new error class (`SessionSecretRejectedError`) so `apps/server/src/index.ts` can `instanceof`-check the thrown error.
- [`apps/server/src/index.ts`](../../../apps/server/src/index.ts) — server entry; the pre-flight call lands at the top of `main()`, BEFORE `createServer()` and BEFORE the migration gate. Failed checks write to stderr (no Fastify logger yet) and exit non-zero.
- [`apps/server/src/auth/screen-name.test.ts`](../../../apps/server/src/auth/screen-name.test.ts) — already imports the pending-cookie surface and has a `describe('pending-cookie sign / verify')` block. The new `describe('resolveSessionTokenSecret strength gate')` block lands in the same file (siblings to the existing pending-cookie tests) so the resolver's tests sit next to the rest of the pending-cookie module's tests.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — pure-logic checks (no I/O) land as Vitest tests next to the code under test. Exactly this surface.
- [`.env.example`](../../../.env.example) line 95 (the committed dev placeholder `dev-session-secret-change-me`) — sourced into the denylist verbatim, plus the generic `change-me` to catch the conventional shorthand.

## Constraints / requirements

- **Pure logic.** No I/O. The check reads from a `Record<string, string | undefined>` (passed `process.env` in production, a literal in tests).
- **Minimum length: 32 UTF-8 bytes.** Matches the HS256 standard key length (the JWT signing primitive in `session-token.ts`). Shorter keys give a tractable offline brute-force; 32 bytes / 256 bits is the documented floor.
- **Test-env carve-out is opt-in via `NODE_ENV === 'test'` only.** Dev and prod both enforce the length floor. Tests that pin the rejection behavior pass an env record with `NODE_ENV: 'development'` or `NODE_ENV: 'production'` to bypass the carve-out.
- **Denylist is production-only.** `NODE_ENV === 'production'` is the gate; dev (and test) accept the example values. The denylist is small by design (two entries: the `.env.example` literal and the generic `change-me`) — the goal is "catch the operator who forgot to rotate," NOT "enforce password strength" (entropy is the byte-length check's job).
- **Typed error class**: `SessionSecretRejectedError extends Error` with a `reason: 'missing' | 'too-short' | 'matches-dev-placeholder'` discriminator for tests + structured logs. The `.name` is `'SessionSecretRejectedError'`.
- **Error message MUST NOT echo the rejected value.** Stderr and structured logs capture the message verbatim; echoing the partial secret would defeat the entire point. The message names the failure reason and the remediation, never the value.
- **Boot-path wiring**: pre-flight `resolveSessionTokenSecret(process.env)` at the top of `main()` in `apps/server/src/index.ts`, BEFORE `createServer()`. Catch `SessionSecretRejectedError` specifically; on hit, `process.stderr.write(...)` the message and `process.exit(1)`. Other errors re-throw. The boot-path placement guarantees no port binds and no Fastify logger initializes against a weak secret.
- **Verifications per ADR 0022.** Vitest unit tests in the same `screen-name.test.ts` file as the pending-cookie surface. No ad-hoc probes.

## Acceptance criteria

- `apps/server/src/auth/pending-cookie.ts` exports:
  - `SESSION_TOKEN_SECRET_MIN_BYTES = 32`,
  - `SESSION_TOKEN_SECRET_DEV_DENYLIST: readonly string[]` (frozen) — contains at minimum `'dev-session-secret-change-me'` and `'change-me'`,
  - `class SessionSecretRejectedError extends Error` with a `reason` discriminator.
- `resolveSessionTokenSecret(env)` throws `SessionSecretRejectedError` with reason:
  - `'missing'` — env unset or empty.
  - `'too-short'` — byte length below the floor. Not raised when `env['NODE_ENV'] === 'test'`.
  - `'matches-dev-placeholder'` — value in the denylist. Only raised when `env['NODE_ENV'] === 'production'`.
- The barrel `apps/server/src/auth/index.ts` re-exports the three new symbols.
- `apps/server/src/index.ts`'s `main()` calls `resolveSessionTokenSecret(process.env)` before `createServer()`. On `SessionSecretRejectedError` it writes a non-leaking diagnostic to stderr and `process.exit(1)`s. Other errors re-throw.
- Error message text NEVER contains the rejected secret value (asserted in tests for each rejection path).
- Vitest tests (in `apps/server/src/auth/screen-name.test.ts`) cover:
  - Empty / undefined env value rejected (regression).
  - 5-char secret rejected in prod AND dev (length floor enforced in both).
  - `NODE_ENV=test` carve-out: 5-char secret accepted (returns the value).
  - Prod-only denylist: `'dev-session-secret-change-me'` rejected when `NODE_ENV=production`.
  - Same denylist value accepted in dev (`NODE_ENV=development`).
  - A 32+-byte high-entropy value accepted in all three environments.
  - Each rejected-path message does NOT contain the rejected value as a substring.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest cases; all pass.
- Task-completion ritual per [tasks/refinements/README.md](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Min length: 32 UTF-8 bytes.** Matches HS256's documented key length and the JWT spec's recommendation. Stored as `SESSION_TOKEN_SECRET_MIN_BYTES` so a future operational tuning is a one-line change. Counted in `Buffer.byteLength(secret, 'utf8')` rather than `.length` — a 32-character ASCII string is 32 bytes, but a 32-character multibyte string would be more (the BYTE count is the entropy floor that matters to HMAC).
- **Test-env carve-out: `NODE_ENV === 'test'`.** The existing test surface (`screen-name.test.ts`, `session-token.test.ts`, others) uses short fixed secrets (`'unit-test-secret-key'`, `'test-secret'`). A mass-rewrite of every test to use a 32-byte fixture would be churn without security benefit — tests don't ship to production. The carve-out is opt-in via `NODE_ENV`, the standard discriminator the runtime already reads. Tests that specifically pin the rejection behavior bypass the carve-out by passing an env record with `NODE_ENV: 'development'` or `NODE_ENV: 'production'`.
- **Denylist contents.** Two entries: `'dev-session-secret-change-me'` (the literal in `.env.example` line 95) and `'change-me'` (the generic placeholder operators paste while testing config plumbing). Frozen via `Object.freeze` so the export can't be mutated by a stray import. The list is deliberately small — the goal is "catch the operator who forgot to rotate the example value," NOT "enforce password strength." Adding more entries is cheap if a future committed placeholder surfaces.
- **Denylist is production-only.** Dev contributors can `cp .env.example .env` and boot without rotating; staging/prod must rotate. The discriminator is `NODE_ENV === 'production'` (not "not dev"); test-env also skips the denylist (test-env already skips the length floor).
- **Check ordering: denylist first, length floor second.** The committed dev placeholder (`dev-session-secret-change-me`, 27 bytes) is itself below the 32-byte floor. If the length check ran first, the dev-convenience pass-through path could never accept the placeholder — devs would have to rotate just to boot, defeating the framing. Order resolves this: a value on the denylist short-circuits to either a prod rejection (with the specific `matches-dev-placeholder` reason) or a dev/test pass-through. A value NOT on the denylist still trips the length floor (so a random 5-char secret in dev still fails-loud).
- **Typed error class: `SessionSecretRejectedError`.** Not a discriminated-union return — the resolver was throwing already, and the boot path needs an `instanceof` check to separate "expected validation failure → exit 1 with message" from "genuinely unexpected error → re-throw and crash." The `reason` discriminator is for tests + structured logs; the `.message` is the human-readable diagnostic.
- **Boot-path wiring (not lazy).** Pre-flight runs at the top of `main()` in `apps/server/src/index.ts`, BEFORE `createServer()` and BEFORE the migration gate. Rationale: the failure shape is binary ("server is up AND secrets are vetted" / "operator sees the diagnostic AND no port is bound"). Lazy validation at first auth would let the port bind, the health endpoint go green, and the migration gate run against a weak secret — defeating the entire fail-loud framing.
- **Error message never echoes the rejected value.** The message names the reason ("SESSION_TOKEN_SECRET is too short", "SESSION_TOKEN_SECRET matches a known dev placeholder", "SESSION_TOKEN_SECRET is not set") and the remediation ("set the env var", "rotate to a high-entropy value supplied by the deployment secrets pipeline"). Echoing the value to stderr would leak partial-secret material into the operator's terminal scrollback and any captured log stream. Tests assert the value-absence explicitly.
- **No per-secret split into `PENDING_COOKIE_SECRET` vs `SESSION_TOKEN_SECRET`.** F-004's suggested fix (c) floats decoupling the two uses; this task scopes only to (a) and (b) — strength check + boot-time enforcement. The decoupling is a separate (heavier) task that would also require migration tooling for the rotation. Deferred to a future refinement if the threat model demands it.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:
- `apps/server/src/auth/pending-cookie.ts` — added `SESSION_TOKEN_SECRET_MIN_BYTES = 32`, `SESSION_TOKEN_SECRET_DEV_DENYLIST` (frozen list: `'dev-session-secret-change-me'`, `'change-me'`), and `class SessionSecretRejectedError extends Error` with `reason: 'missing' | 'too-short' | 'matches-dev-placeholder'`. Replaced the prior non-empty-only check in `resolveSessionTokenSecret` with: missing → denylist (production-rejects with `matches-dev-placeholder`; dev/test pass-through) → length floor (skipped under `NODE_ENV === 'test'`). Error messages name the reason + the remediation; the rejected value never appears in the message text.
- `apps/server/src/auth/index.ts` — barrel re-exports the new constants + error class so the boot path can `instanceof`-check.
- `apps/server/src/index.ts` — `main()` pre-flights `resolveSessionTokenSecret(process.env)` at the top, BEFORE `createServer()`. On `SessionSecretRejectedError` it writes the non-leaking message to stderr and `process.exit(1)`s. Other errors re-throw.
- `apps/server/src/auth/screen-name.test.ts` — added a new `describe('resolveSessionTokenSecret strength gate')` block with 10 `it(...)` cases: missing/empty rejection, prod+dev length-floor rejection, test-env carve-out acceptance, prod-only denylist rejection, dev-convenience denylist acceptance, 32-byte acceptance across all three envs, and two non-leaking-message assertions (one per rejection path that has a value to potentially leak).
- `tasks/25-backend-hardening.tji` — `complete 100` added to `session_secret_strength_check`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: 1018 → 1028 in the smoke suite (+10 new `it(...)` blocks in `screen-name.test.ts`). `pnpm run check` and `pnpm run test:smoke` both pass.

Implementation note: the original implementation on disk checked length BEFORE denylist, which made the documented dev-convenience pass-through of `dev-session-secret-change-me` (27 bytes, below the 32-byte floor) impossible — the length floor would trip first. The order was inverted as part of this task so the denylist short-circuits BEFORE the length check, preserving the intent (prod gets the specific `matches-dev-placeholder` reason; dev/test get the pass-through). Random short secrets not on the denylist still trip the length floor.
