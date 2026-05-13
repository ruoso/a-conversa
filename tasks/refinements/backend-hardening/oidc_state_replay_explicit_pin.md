Source: docs/security/m3-review/coverage.md G-012

# Test: pin OIDC state-replay rejection explicitly (`/auth/callback`)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.oidc_state_replay_explicit_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.auth.oauth_callback_handler` (settled — produced `GET /auth/callback` and the `flowState.take(...)` one-shot consume primitive this task pins); `backend.auth.session_token_management` (settled — produced the cookie-issuance surface the first-callback success leg traverses, so the test's success/replay distinction is exercised end-to-end through the same code path the production callback uses).

## What this task is

A TEST-ONLY task that closes coverage gap **G-012** from the M3 coverage review (`docs/security/m3-review/coverage.md`). The OIDC state-replay invariant — "a `state` value `take()`ed by one successful `/auth/callback` cannot be replayed against another `/auth/callback`" — is correct in production today (`apps/server/src/auth/flow-state.ts`'s `take(state)` removes the entry before returning it, and the route handler returns `auth-state-invalid` when `take()` yields `undefined`), and the one-shot semantic IS unit-tested at the store level (`apps/server/src/auth/flow.test.ts:268` — "take is one-shot — a second take of the same state returns undefined") and at the route level immediately adjacent to where this pin lands (`apps/server/src/auth/routes.test.ts:357` — "a replay against the same state after take() returns 400").

What G-012 calls out is that the **security framing** of the invariant — that the route-level rejection IS the defense against the browser-history / referer-leak / XSS-stolen-state replay attack class — is not visible to a reviewer reading the test file: the existing `routes.test.ts` case is grouped under `describe('GET /auth/callback')` alongside happy-path and bad-state cases, with no comment naming the threat model it pins. An auditor running `grep -r "G-012" apps/server` finds nothing; the audit-trail anchor is absent.

This task adds:

1. A new `describe('OIDC state replay protection (G-012)', ...)` block in `apps/server/src/auth/routes.test.ts`, with a leading block comment naming the three sibling threat shapes (browser-history attack, referer leak, XSS-stolen state) and cross-referencing `docs/security/m3-review/coverage.md` G-012.
2. A single `it(...)` case that drives the full round-trip: `/auth/login` mints a state → first `/auth/callback?state=...` succeeds (200) → second `/auth/callback?state=<same>` is rejected (400 + `auth-state-invalid`).
3. A bullet appended to the top-of-file `**Coverage**` block (around line 8) calling out the G-012 pin.

The case is structurally similar to the existing `'a replay against the same state after take() returns 400'` test (which lives in the standard `GET /auth/callback` describe), but lives in its own G-012-named describe so the audit-trail grep finds it. The two tests do NOT overlap in load-bearing assertion: the existing case verifies the in-process replay semantic; the new case wraps that semantic in the threat-model framing required by the audit trail per ADR 0022.

This is TEST-ONLY. Production behavior is unchanged — the rejection is already correct; the test pins the invariant under its security framing.

## Why it needs to be done

G-012 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

> No test for the case where the client retains the `Location` URL from `/auth/login` (containing the original `state` value) and re-uses it via a *different* `/auth/callback` request (e.g., via a forged-state attack with a stolen state value via referer header). The current test only verifies that the same `state` cannot be `take()`ed twice in-process; what about a state that was leaked via browser history + replayed AFTER a fresh state was issued?
>
> **Adversarial scenario**: Browser history attack — attacker reads the user's session-history (via XSS on a different site), finds the issuer redirect URL, replays the `state` against `/auth/callback` after the original state was already consumed. Should fail (it would — `flowState.take` returns undefined). But this scenario is the typical "state-fixation" attack class and would benefit from an explicit pinned test for the audit-trail reviewer.
>
> **Suggested test**: `routes.test.ts` — issue state, call `/auth/callback` with it (consume), call `/auth/callback` AGAIN with the same state. Today's behaviour is correct (rejected), but the test gives the auditor a one-line proof.

Per ADR 0022 (no throwaway verifications), every empirical claim about system behavior — including defensive claims like "state replay is rejected" — lands as a committed test. The store-level `take` one-shot test (`flow.test.ts:268`) verifies the primitive; the existing `routes.test.ts:357` case verifies the route's use of that primitive. Neither names the **attack class** being defended against. The new test makes the threat-to-defense mapping visible:

- **Browser-history attack** — attacker reads the user's session history (via XSS on a different site, a malicious browser extension, or shared-device snooping), recovers the OIDC redirect URL emitted by `/auth/login` (which carries `state` in its query), and replays it.
- **Referer leak** — the OIDC issuer's authorization page (Authelia) embeds the callback URL in its rendered HTML; if that page leaks via referer header to any third-party resource (analytics, ad pixel, OAuth provider error pages), the `state` value escapes.
- **XSS-stolen state** — a script running on a vulnerable subdomain reads `document.referrer` or the URL bar on the callback page, exfiltrates the `state` to an attacker-controlled endpoint, attacker replays.

All three reduce to the same wire-level attack: a `GET /auth/callback?code=...&state=<leaked>` request arriving AFTER the legitimate callback already consumed that state. The test pins that the server's response in that case is 400 `auth-state-invalid`, not 200, no token, no cookie. The audit trail then anchors:

- `grep -r "G-012" apps/server` → lands directly on the describe-block comment.
- A reviewer reading the test sees the three named threats AND the one-line proof.
- A future refactor that moves the `take()` call OR widens the consume-then-reject semantic (e.g., a misguided "retry-friendly" caching layer that preserves the entry on first read) breaks the test, flagged at PR review.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-012 — source coverage gap (Medium severity, "defensive — current behaviour is correct, but the security pinning is implicit").
- [`apps/server/src/auth/flow-state.ts`](../../../apps/server/src/auth/flow-state.ts) — the one-shot consume primitive. `take(state)` removes the entry from the map before returning it; a second `take(state)` returns `undefined`. The module's leading docblock states the invariant ("a replay against the same state fails on the second hit"); the new test makes that claim auditor-visible at the route layer.
- [`apps/server/src/auth/routes.ts`](../../../apps/server/src/auth/routes.ts):619-626 — the route handler's use of `flowState.take(inboundState)`. When `take` returns `undefined`, the handler throws `ApiError(400, 'auth-state-invalid', 'authorization state is missing, expired, or unrecognized')`. This is the exact response the new test asserts on replay.
- [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts):357 — the existing `'a replay against the same state after take() returns 400'` case inside `describe('GET /auth/callback')`. The new test does NOT replace this case (it remains the structural pin for the route's wiring of `take`); the new test sits in its own G-012-named describe so the auditor's grep lands on the threat-model framing.
- [`apps/server/src/auth/flow.test.ts`](../../../apps/server/src/auth/flow.test.ts):268 — the existing store-level `'take is one-shot'` test. Verifies the primitive; does NOT exercise the route.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — the discipline ADR. The threat-model framing IS the empirical claim; it lands as a committed test, not as commentary in a review thread.
- [`tasks/refinements/backend-hardening/README.md`](./README.md) — backend-hardening tasks each open with their source finding id; this refinement follows the same convention (G-012 in the first line).
- [`tasks/refinements/backend-hardening/logout_no_revocation_pin.md`](./logout_no_revocation_pin.md) — sibling protocol-test-pinning task with the same shape (auditor-readable describe block, leading comment naming the threat, single round-trip `it(...)`). The structural conventions in this refinement mirror that file.

## Constraints / requirements

- **TEST-ONLY.** No production code changes. `flow-state.ts`'s `take(...)`, `routes.ts`'s `GET /auth/callback` handler, and the existing `'a replay against the same state after take() returns 400'` case all stay intact. The new test is purely additive.
- **Dedicated G-012 describe block.** Lives at the bottom of `routes.test.ts` (after the existing `describe('namespacedOauthSubject', ...)` block) so it doesn't perturb the existing `GET /auth/callback` describe's structure. The describe title is exactly `OIDC state replay protection (G-012)` — the literal `G-012` substring is the audit-trail anchor.
- **Auditor-readable leading block comment.** Opens with:
  - A clear "this pins the security invariant" framing.
  - The three named threat shapes (browser-history attack, referer leak, XSS-stolen state) in a single paragraph.
  - A cross-reference to `docs/security/m3-review/coverage.md` G-012.
  - A note that the existing `routes.test.ts` case (line 357) covers the same in-process replay semantic from a different angle (structural-wiring pin vs. threat-model pin); the two co-exist by design.
- **Single `it(...)` case, end-to-end round-trip.** Driven through `app.inject(...)` against the same `buildApp(...)` harness the existing callback tests use:
  1. `GET /auth/login` — mint a state. Assert 302 (sanity, otherwise a setup bug masks the real signal).
  2. `GET /auth/callback?code=AUTHCODE&state=state-1` — first consume. Assert 200 + body shape matches the existing success-path test.
  3. `GET /auth/callback?code=AUTHCODE&state=state-1` — replayed state. Assert 400 + `error.code === 'auth-state-invalid'` + the error message contains `state` (mirroring the existing case's assertion).
- **Use the existing `buildApp(...)` harness and `makeAuthCodeGrantStub('alice')` fixture.** No new test plumbing, no new mock. The deterministic `randomState` returns `state-1` on the first `/auth/login` call so the state value is predictable across both callback requests.
- **No new exports, no new helpers.** Pure consumption of the existing test surface.
- **Verifications per ADR 0022.** Vitest unit test in the same file as the surface it pins; no ad-hoc probes.

## Acceptance criteria

- `apps/server/src/auth/routes.test.ts`:
  - New `describe('OIDC state replay protection (G-012)', ...)` block at the bottom of the file (after `describe('namespacedOauthSubject', ...)`).
  - Leading block comment names the three threat shapes (browser-history attack, referer leak, XSS-stolen state), cross-references `docs/security/m3-review/coverage.md` G-012, and acknowledges the adjacent existing case at `describe('GET /auth/callback')`.
  - A single `it(...)` case that: drives `/auth/login` (mint state), drives `/auth/callback` with that state (success — 200), drives `/auth/callback` AGAIN with the same state (replay — 400 + `auth-state-invalid`).
  - The top-of-file `**Coverage**` block (lines 8-29) is extended with a bullet describing the G-012 pin.
- `pnpm run check` clean (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` includes the new Vitest case; all pass. Net test delta: +1 `it(...)` in `routes.test.ts`.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit. The commit message follows the format in the task brief.

## Decisions

- **Two tests for the same in-process behavior, in two different describe blocks.** A reader might ask why both the existing `'a replay against the same state after take() returns 400'` case (inside `describe('GET /auth/callback')`) and the new G-012-named case need to exist. They serve different audiences. The existing case is a **structural-wiring** pin: it sits in the GET /auth/callback describe alongside other callback paths (missing state, unknown state, happy path), grouped by the surface being tested. The new case is a **threat-model** pin: it sits in its own describe whose title carries the `G-012` substring so an auditor's grep finds it, and whose leading comment names the three sibling attack classes. Collapsing into a single test would force a choice between the two audiences; keeping both keeps each readable for its reader. The runtime cost is one extra `app.inject(...)` round-trip — well under a millisecond.
- **Bottom-of-file placement (after `namespacedOauthSubject`), not interleaved.** Three options were considered: (a) inside the existing `describe('GET /auth/callback')` block, (b) immediately after that block but before `namespacedOauthSubject`, (c) at the bottom of the file. Option (a) collapses the threat-model framing into the wiring framing — see prior decision. Option (b) is plausible (the test IS about /auth/callback semantics) but breaks the reading flow: the F-008 origin-namespacing pin (`namespacedOauthSubject`) is structurally unrelated to the OIDC dance and reads better as a self-contained final block; tucking the threat-model pin between callback-wiring and namespace-pinning would interrupt that. Option (c) keeps the file structure: setup → login describe → cap-503 pin → callback describe → namespace pin → security pin. The G-012 block at the bottom mirrors the cap-503 pin's positioning (which is also a top-level security-named describe inside `routes.test.ts`).
- **Title contains the literal `G-012` substring.** The audit trail relies on `grep -r "G-012" apps/server` landing on this describe. The other M3 review references (`auth.md F-NNN`, `inputs.md F-NNN`, `coverage.md G-NNN`) are anchored the same way across the test surface (see `actor_spoof_propose_pin`, `logout_no_revocation_pin`, `s_to_c_type_rejection_pin`, `flow_state_map_bound` for prior art). Dropping the substring would break the cross-cutting search convention.
- **The three named threat shapes are listed in the leading comment, not in the `it(...)` description.** The describe's title is short and grep-friendly; the threats are in the comment so a reader gets the context once at the block boundary, not re-stated per case. The `it(...)` description focuses on the **wire-level behavior** being asserted ("rejects a replayed state value after the first callback consumed it") — what the test does, in one line.
- **Re-use the existing `buildApp(...)` and `makeAuthCodeGrantStub('alice')` fixtures.** The deterministic `randomState` already yields `state-1` on the first `/auth/login`, so the state value is predictable across the two callback requests without a custom harness. Building a fresh fixture (or threading a "controllable state" knob) would add surface for no benefit — the existing harness already exercises the exact code path.
- **Assert the success path's full body shape on the first callback, not just the status code.** Without the body assertion, a future refactor that returns 200 but emits an empty body, or that emits the body for a *different* user, would pass the status check while breaking the round-trip contract. The body assertion (`body.sub === 'alice'`, `body.oauthSubject === 'http://authelia:9091:alice'`) makes the "success-then-replay" semantic auditor-readable: the first callback DID issue a real session, then the replay was rejected — confirming that "the rejection is because of the take(), not because the success path was broken."
- **Assert the replay's error code AND message.** The existing case at line 357 only checks `error.code === 'auth-state-invalid'`. The new test additionally checks the message contains `state` (case-insensitive), mirroring the route handler's actual message string. Two-prong assertion catches a future refactor that changes the code (would break `error.code`) OR rewrites the message to omit the operative noun (would break the regex). The cost is one extra `expect(...)` line.
- **No cucumber scenario.** The replay defense is a route-level behavior with no DB / no compose-stack involvement; per ADR 0022's layer-routing rule, pure-route logic lands as Vitest. Adding a `tests/behavior/backend/oidc-replay.feature` would duplicate the assertion at a heavier layer without exercising additional integration surface. The integration path (issuer round-trip) is mocked at the `authorizationCodeGrant` boundary in production tests anyway; an end-to-end cucumber test would require a real OIDC issuer fixture, which is out of scope for a pinning task.
- **No production code change verification step.** Per the brief, this is TEST-ONLY. The handler at `routes.ts:619-626` is already correct by inspection (it threads `take`'s `undefined` return into a 400 `auth-state-invalid`); if a code-review discovery surfaces a real bug, STOP and surface separately rather than silently fixing under this task.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/src/auth/routes.test.ts`](../../../apps/server/src/auth/routes.test.ts) — added `describe('OIDC state replay protection (G-012)', ...)` block at the bottom of the file. The leading block comment names the three sibling threat shapes (browser-history attack, referer leak, XSS-stolen state), cross-references `docs/security/m3-review/coverage.md` G-012, and explains the co-existence with the adjacent `'a replay against the same state after take() returns 400'` structural-wiring case inside `describe('GET /auth/callback')`. The single `it(...)` case drives `/auth/login` (mint state) → `/auth/callback` (legitimate, 200 + body shape match + flowState empty) → `/auth/callback` with the SAME state (replay, 400 + `auth-state-invalid` + message contains `state` + no `Set-Cookie` header + user table unchanged).
- Top-of-file `**Coverage**` block extended with bullet `7a` describing the G-012 pin and naming the three threat shapes.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `oidc_state_replay_explicit_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (exit 1 from grep = no matches).

Test count delta: +1 `it(...)` in `routes.test.ts` (12 → 13 tests in the file). No production code changed — the rejection at `routes.ts:619-626` and the `take(...)` one-shot semantic at `flow-state.ts` were already correct by inspection; the test pins the security framing under its auditor-readable name.

`pnpm run check` clean. `pnpm run test:smoke` green (1441 tests pass).
