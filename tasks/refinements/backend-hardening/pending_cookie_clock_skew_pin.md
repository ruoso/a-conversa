Source: docs/security/m3-review/coverage.md G-011

# Pin the pending-cookie behavior under server clock skew

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.pending_cookie_clock_skew_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.screen_name_collection` (settled — produced `signPendingCookie` / `verifyPendingCookie` plus the `now`-injection point this task pins).

## What this task is

A TEST-ONLY task. Add a Vitest unit-test file [`apps/server/src/auth/pending-cookie.test.ts`](../../../apps/server/src/auth/pending-cookie.test.ts) — the module had no dedicated unit test before this task (only indirect coverage in `routes.test.ts` and `cookie-charset.test.ts`) — and inside it a `describe('pending-cookie clock-skew (G-011)', ...)` block that pins the current, **deliberate** behavior of `verifyPendingCookie`:

1. **Baseline (mid-life accept)** — sign at `t=0` with `expiresAt = t + 600_000` (10 min). Verify at `t = 300_000` (5 min in): succeeds with `ok: true` and the round-tripped `userId` / `expiresAt`.
2. **Baseline (post-expiry reject)** — same cookie, verify at `t = 700_000` (after the cookie expired): rejects with `reason: 'expired'`.
3. **Clock-skew accept** — same cookie, verify at `t = 300_000` with `now = () => t - 100_000` (server clock jumped backward 100 s **past** sign-time). Succeeds: the verifier compares `exp` against the injected `now()`, NOT against real wall time, NOT against any embedded sign-time, NOT against any maximum-skew bound. This pins the trade-off: the verifier trusts whatever clock the caller hands it.
4. **Clock-skew reject** — same cookie, verify at `t = 900_000` (truly expired by wall clock) with `now = () => t + 200_000` (server clock ahead 200 s). Rejects with `reason: 'expired'`: a forward-skewed clock cannot rescue an already-expired cookie either, and an attacker who somehow injected a future `now` would only make their replay easier to reject.

The block's leading comment names this as **current** behavior, points the auditor at the trade-off (a node whose clock jumped backward past `expiresAt` will accept a previously-expired cookie), and names the speculative future hardening task (`pending_cookie_max_skew`) that would bound the acceptable skew if v2 wanted to harden the surface. For v1, the deliberate choice is "trust the server clock."

## Why it needs to be done

G-011 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) is the source coverage gap:

> The pending-cookie's `expiresAt` is server-clock-checked, but the cookie ITSELF carries the `expiresAt` value in its signed payload. If `Date.now()` on the server jumps backward (NTP correction, container clock drift), an expired cookie becomes valid again. No test pins the "cookie that was valid at sign-time but the server's clock is now BEHIND its `expiresAt`" case as a deliberate accept/reject decision.
>
> **Adversarial scenario**: Multi-region deployment where one node's clock is 20 minutes behind. Attacker steals a pending cookie that expired on the fast node; replays against the slow node; succeeds.
>
> **Suggested test**: `pending-cookie.test.ts` — sign a cookie at t=0 with `expiresAt=t+600000`, verify at t=300000 with `now=() => t-100000` (clock went backward). Today: succeeds. Pin the behavior explicitly.

The verifier at [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts):234 reads:

```ts
if (exp <= now()) {
  return { ok: false, reason: 'expired' };
}
```

There is no sign-time embedded in the payload, no max-skew bound, and no real-wall-time fallback. The verifier honors whatever `now` the caller hands it. That's the deliberate choice, and the trade-off is real — a clock that drifts backward past an `expiresAt` accepts the cookie again.

ADR 0022 (no throwaway verifications) is explicit: every empirical claim about system behavior — including the deliberately-accepted limitations — lives as a committed test, not a comment that the next maintainer might miss. This test is that pinned claim.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-011 — source coverage gap (Medium severity).
- [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts):179-238 — `verifyPendingCookie`. The `now` parameter defaults to `Date.now` (line 187) and is consulted exactly once (line 234, `exp <= now()`). Sign-time is NOT embedded in the payload — only the absolute `expiresAt`.
- [`apps/server/src/auth/pending-cookie.ts`](../../../apps/server/src/auth/pending-cookie.ts):148-156 — `signPendingCookie`. Accepts `expiresAt` directly from the caller (no `now`-injection on the sign side; the caller is responsible for computing `expiresAt = now + TTL`).
- [`apps/server/src/auth/cookie-charset.test.ts`](../../../apps/server/src/auth/cookie-charset.test.ts) — sister Vitest unit-test for an auth-module primitive. Matches the file-header / `**Coverage**` comment shape this task should adopt.
- [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts):968, 1089 — existing integration-level usage of `signPendingCookie` through the screen-name route. The new test sits at the unit layer (no Fastify, no DB, no route plugin) — purely the cryptographic primitive's clock semantics.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical claim lands as a committed test. The trade-off claim "verifier honors injected `now`, not real wall time" needs a test, not a comment.
- [`tasks/refinements/backend-hardening/logout_no_revocation_pin.md`](./logout_no_revocation_pin.md) — sister "pin a deliberately-accepted limitation" task. Same shape (leading comment names the trade-off + speculative future hardening + auditor anchor) and same file-organisation pattern (the pin lives at the unit-test layer adjacent to the production surface).

## Constraints / requirements

- **TEST-ONLY.** No production-code change. `verifyPendingCookie` stays as-is — the test pins what it currently does, it does not bound the skew. If the implementation needs hardening, that's the future `pending_cookie_max_skew` task, not this one.
- **Single test file, single `describe`.** Create the new file `apps/server/src/auth/pending-cookie.test.ts`. Inside, one `describe('pending-cookie clock-skew (G-011)', …)` block with four `it(...)` cases covering the four scenarios above. No baseline coverage for malformed / signature-invalid / payload-invalid cases — those land separately if/when needed; this task is the G-011 pin, not a comprehensive verify-path suite.
- **Use the existing public surface.** Import `signPendingCookie`, `verifyPendingCookie`, and the result-shape types from `./pending-cookie.js`. No new exports, no new helpers, no fixture extraction.
- **Inject `now` explicitly.** Every `verifyPendingCookie` call in the test passes a `now: () => …` function returning the test's chosen instant. No `Date.now` mocking, no `vi.useFakeTimers` — the module already accepts `now` as a parameter and the test uses that injection point exclusively. This keeps the test free of global state and matches the production injection point a maintainer would reach for first.
- **Leading block comment names the trade-off + the speculative future hardening.** The auditor reading this test must learn:
  - This pins **current** behavior (the verifier trusts whatever `now` the caller hands it).
  - The trade-off is a known accept: backward clock jump past `expiresAt` re-validates an "expired" cookie.
  - The speculative future task name — `pending_cookie_max_skew` — that would bound acceptable skew if v2 wanted to harden the surface. The task name is provisional and may never land; the comment marks it as a candidate hardening, not a committed plan.
  - The source-finding anchor (`coverage.md` G-011) so `grep -r "G-011" apps/server/src/auth/` lands directly on this test.
- **Verifications per ADR 0022.** Vitest unit test under `apps/server/src/auth/`, adjacent to the surface it pins.

## Acceptance criteria

- `apps/server/src/auth/pending-cookie.test.ts` exists with:
  - File-header comment matching the sister `cookie-charset.test.ts` shape (refinement / ADR / source / TaskJuggler anchors + `**Coverage**` block).
  - One `describe('pending-cookie clock-skew (G-011)', …)` block whose leading comment names the trade-off, the source anchor (`coverage.md` G-011), and the speculative future task (`pending_cookie_max_skew`).
  - Four `it(...)` cases — baseline accept, baseline reject, clock-skew accept (backward), clock-skew reject (forward + truly expired).
  - All four cases call `signPendingCookie` once with `expiresAt = t + 600_000` and `verifyPendingCookie` with explicit `now: () => …` injection.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the four new Vitest cases; all pass.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Unit-test layer, not integration.** The G-011 trade-off is at the cryptographic-primitive layer (`verifyPendingCookie`'s clock comparison), not at the route layer. A route-level test would have to fake the OIDC callback's clock too, multiplying setup without adding signal. The primitive's `now` injection point is exactly the right surface to pin.
- **Inject `now` via the function parameter, not via `vi.useFakeTimers`.** The module's signature is `verifyPendingCookie(value, { secret, now? })`. A fake-timers approach would have to mock `Date.now` globally, which (a) introduces global state that other tests in the file would inherit, and (b) doesn't pin the public-API contract that `now` is honored — it would pass even if the implementation accidentally read `Date.now()` directly. Passing `now: () => …` exercises the documented injection point exclusively.
- **Four cases, not two.** The G-011 finding's suggested test is just the backward-skew accept. Adding the baseline accept + baseline reject + forward-skew reject gives the auditor a four-corner table they can read top-to-bottom: "what happens at the four combinations of mid-life vs. wall-expired × clock-correct vs. clock-skewed." The forward-skew reject (case 4) is the symmetric pin to case 3 — without it, a future bug that flipped the comparison direction (`exp >= now()` instead of `exp <= now()`) would pass three of four cases.
- **Sign-time is NOT embedded in the payload.** The verify path has no way to know what `now` was at sign-time; the only time fact in the payload is `expiresAt`. The test names this in the leading comment so an auditor doesn't waste time hunting for a sign-time fact that doesn't exist.
- **Speculative future task name is provisional.** The comment calls it `pending_cookie_max_skew` if it lands. It may never land — the v1 trade-off may stay forever. The comment marks the hardening as a candidate, not a commitment, so a future maintainer doesn't think they need to chase a ghost task.
- **No new test fixture id, no new constants.** The test uses inline literals (`'fixture-user-id'`, `'test-secret'`, `t = 0`, `expiresAt = 600_000`) — extracting them as module-level constants would imply they're shared with future tests; they're not. Keeping them inline matches the cookie-charset.test.ts style and keeps the four cases readable independently.
- **No baseline tests for malformed / signature-invalid / payload-invalid in this file.** Those failure modes are exercised indirectly via the route tests in `routes.test.ts` and the route's behavior tests. Pulling them into this new file would expand scope beyond G-011's specific pin. If a future task wants comprehensive `verifyPendingCookie` coverage at the unit layer, it lands as a separate refinement.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/src/auth/pending-cookie.test.ts`](../../../apps/server/src/auth/pending-cookie.test.ts) — new Vitest unit-test file (the module had no dedicated unit tests before). One `describe('pending-cookie clock-skew (G-011)', …)` block with the four-corner table: (1) baseline accept at t+5min with correct clock, (2) baseline reject at t+11.6min with correct clock, (3) clock-skew accept at t+5min with `now = () => t-100s` (the load-bearing G-011 pin — verifier honors the injected clock, no max-skew bound), (4) symmetric clock-skew reject at t+18.3min with `now = () => t+200s past wall expiry` (catches a future comparison-flip bug). Block-level leading comment names the trade-off, the source-finding anchor (`coverage.md` G-011), and the speculative future hardening task (`pending_cookie_max_skew`) that may or may not land in v2.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `pending_cookie_clock_skew_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- No production-code change: `verifyPendingCookie` is already correct by inspection (`exp <= now()` against the injected `now`). The test pins the deliberate trade-off as committed regression coverage per ADR 0022.

Test count delta: +4 `it(...)` cases in a new `apps/server/src/auth/pending-cookie.test.ts` file (suite total 1440 → 1444). `pnpm run check` and `pnpm run test:smoke` both pass.
