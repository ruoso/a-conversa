Source: docs/security/m3-review/auth.md F-009

# Pin iat<exp + max-TTL invariant in `verifySessionToken`

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.auth_hardening.iat_exp_invariant_check`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.session_token_management` (settled — produced the current `signSessionToken` / `verifySessionToken` surface this task hardens).

## What this task is

Add two defense-in-depth invariant checks to `verifySessionToken` in `apps/server/src/auth/session-token.ts`. The signing path bounds `iat` and `exp - iat` by construction; the verifier did NOT historically re-bind those invariants on read, so a forged JWT (only feasible if `SESSION_TOKEN_SECRET` leaks) with `iat = far-past` and `exp = year 2100` would have verified happily. After this task lands:

1. `payload.iat <= now + CLOCK_SKEW_SECONDS` — reject tokens whose claimed issue-at instant is meaningfully in the future. Internal rejection label: `token-not-yet-valid`.
2. `(payload.exp - payload.iat) <= SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS` — reject tokens whose declared TTL window exceeds the policy ceiling. Internal rejection label: `token-ttl-out-of-policy`.

A new module-level constant `CLOCK_SKEW_SECONDS = 60` carries the slack tolerance both checks share.

## Why it needs to be done

F-009 in [docs/security/m3-review/auth.md](../../../docs/security/m3-review/auth.md) is the source finding:

> `verifySessionToken` accepts any token where `exp` is a finite number and not expired. There is no check that `exp <= iat + SESSION_TOKEN_TTL_SECONDS` or that `iat <= now`. An attacker who somehow obtains the signing secret (cf. F-004) could mint a token with `exp = year 2100`; the verifier would happily accept it. The signing path bounds the TTL, but the verifier does not re-bind on read.

The impact is bounded — "only matters if the secret is compromised — at which point the attacker has full impersonation anyway" — but the asymmetry between forge-once-keep-forever (exp=year 2100) and forge-once-keep-for-7-days is exactly what defense-in-depth is for. If F-004 (low-entropy committed dev secret) or any future leak lands a forged token, this task ensures that token still expires within the policy TTL.

The check is also cheap (two integer comparisons) and reads naturally next to the existing payload-shape audit; the marginal-cost-vs-marginal-benefit profile favors landing it.

## Inputs / context

- [`docs/security/m3-review/auth.md`](../../../docs/security/m3-review/auth.md) F-009 — source finding (Low severity, Confirmed).
- [`docs/security/m3-review/README.md`](../../../docs/security/m3-review/README.md) — review aggregation; this task is one of the `auth_hardening.*` leaves.
- [`apps/server/src/auth/session-token.ts`](../../../apps/server/src/auth/session-token.ts) — the verifier this task amends. `SESSION_TOKEN_TTL_SECONDS` is exported here (7 days); `verifySessionToken` currently performs signature verify, algorithm pin, expiry-against-clock, and a payload-shape audit. This task appends the two invariant checks after the shape audit.
- [`apps/server/src/auth/session-token.test.ts`](../../../apps/server/src/auth/session-token.test.ts) — Vitest unit suite for the same module; extended in this task with seven new `it(...)` blocks under the existing `signSessionToken / verifySessionToken` describe.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — pure-logic checks (no I/O) land as Vitest tests next to the code under test, which is exactly this surface.

## Constraints / requirements

- **Pure logic only.** No DB, no network, no I/O. The checks are integer comparisons against the verifier's clock.
- **Match the existing rejection convention.** `verifySessionToken` returns `null` on every failure mode; the two new rejections do the same. The "error codes" `token-not-yet-valid` and `token-ttl-out-of-policy` are internal labels in code comments and test names, NOT envelope error codes — clients still see the single 401 envelope the route handler emits. The "do not leak which sub-case fired" contract documented on the existing function is preserved.
- **Use the existing test-injection hook.** Tests pin `now` via `verifySessionToken`'s `options.now` and `signSessionToken`'s `options.now`; no real-time dependency, no `vi.useFakeTimers`.
- **Document the rationale in a code comment** that names F-009 explicitly and explains the defense-in-depth framing. The code comment should be readable without the reviewer having to chase the refinement.
- **Preserve every existing check intact.** Signature verify, algorithm pin (`HS256`), `exp`-against-clock, and the `{ sub, iat, exp }` payload-shape audit all stay; the new checks land after the shape audit so the verifier doesn't compute on un-validated `payload.iat` / `payload.exp`.
- **Slack tolerance is 60s.** Documented as `CLOCK_SKEW_SECONDS = 60` with a comment explaining the choice (NTP drift between pods; matches the "small slack" recommendation in F-009).
- **Verifications per ADR 0022.** Vitest unit tests in the same file. No ad-hoc probes.

## Acceptance criteria

- `apps/server/src/auth/session-token.ts` exports `CLOCK_SKEW_SECONDS = 60` alongside the existing `SESSION_TOKEN_TTL_*` constants.
- `verifySessionToken` rejects (returns `null`) when:
  - `payload.iat > now + CLOCK_SKEW_SECONDS`, OR
  - `(payload.exp - payload.iat) > SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS`.
- The rejections happen AFTER the existing payload-shape audit (so the verifier doesn't read `payload.iat` / `payload.exp` before confirming they are finite numbers).
- A code comment names `docs/security/m3-review/auth.md F-009` and the two internal labels (`token-not-yet-valid`, `token-ttl-out-of-policy`).
- Vitest tests at `apps/server/src/auth/session-token.test.ts` cover:
  - **Future `iat` past slack** — sign with `now + 3600s`; verify with `now`; expect `null`.
  - **One-year TTL** — forge a token directly via `jose` with `iat = now`, `exp = iat + 365 * 86400`; expect `null`.
  - **TTL exactly at `SESSION_TOKEN_TTL_SECONDS`** (boundary, inside) — normal `signSessionToken` output verifies.
  - **TTL one second over `SESSION_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS`** (boundary, outside) — forged token rejected.
  - **`iat` 30s in the future** (within slack) — accepted.
  - **`iat` 90s in the future** (outside slack) — rejected.
  - **Regression**: a freshly-minted normal token still round-trips.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest cases; all pass.
- Task-completion ritual per [tasks/refinements/README.md](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Slack value: 60 seconds.** Matches the F-009 suggestion ("e.g. 60s"). Large enough to swallow ordinary NTP drift between a horizontally-scaled signer pod and a verifier pod; small enough that a token with a meaningfully-future `iat` or a meaningfully-long TTL is rejected promptly. Encoded as a single module-level constant so a future operational tuning is a one-line change.
- **Rejection convention: `null` return, not a new error type.** `verifySessionToken` already returns `null` on every failure mode and the route handler maps null onto a single 401 envelope. Introducing a discriminated-union return for two new sub-cases would force every caller to update; the cost outweighs the benefit. The internal labels `token-not-yet-valid` / `token-ttl-out-of-policy` exist in code comments + test names for code-review readability.
- **Invariant placement: after the payload-shape audit, before the success return.** Reading `payload.iat` / `payload.exp` before confirming they are finite numbers (the shape audit) would risk `NaN` propagation through the comparisons. The shape audit narrows them to finite numbers first.
- **Clock source: `options.now` for tests, `Date.now()` for production.** Mirrors the existing pattern in `signSessionToken` and the `currentDate` passing for `jose.jwtVerify` inside the same function. No new test-injection surface.
- **No change to the wire / route contract.** The 401 envelope stays the same; clients see no behavior difference. The change is observable only by an attacker holding a leaked secret.
- **No `iat <= exp` separate check.** F-009's title mentions "`iat < exp` invariant" but the more useful pin is the TTL ceiling: `(exp - iat) <= TTL + skew`. If `exp <= iat`, then `exp - iat <= 0 < TTL + skew`, so the TTL check passes — but the `exp`-against-clock check that already lives in `jose.jwtVerify` will reject any such token as expired. The combination covers the case; an explicit `iat < exp` check would be redundant.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:
- `apps/server/src/auth/session-token.ts` — added `CLOCK_SKEW_SECONDS = 60` constant and the two post-shape-audit invariant checks (`payload.iat <= now + slack`, `(exp - iat) <= SESSION_TOKEN_TTL_SECONDS + slack`). Both return `null` to match the established rejection convention; code comments name F-009 and the internal labels `token-not-yet-valid` / `token-ttl-out-of-policy`.
- `apps/server/src/auth/session-token.test.ts` — added seven Vitest `it(...)` blocks under the existing `signSessionToken / verifySessionToken` describe: future-`iat` rejection (1h past slack), one-year-TTL rejection, TTL boundary inside (`exactly TTL_SECONDS`, accepted), TTL boundary outside (`TTL_SECONDS + skew + 1`, rejected), `iat` 30s-in-future (within skew, accepted), `iat` 90s-in-future (past skew, rejected), regression on the canonical happy path.
- `tasks/25-backend-hardening.tji` — `complete 100` added to `iat_exp_invariant_check`. `tj3 project.tjp` parses clean.

Test count delta: 33 → 40 `it(...)` blocks in `session-token.test.ts`. `pnpm run check` and `pnpm run test:smoke` both pass.
