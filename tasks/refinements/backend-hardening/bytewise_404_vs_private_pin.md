# `backend_hardening.protocol_test_pinning.bytewise_404_vs_private_pin`

Source: docs/security/m3-review/coverage.md G-014

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.bytewise_404_vs_private_pin`.
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.cross_session_permissions.privacy_field_enforcement` (settled — `canSeeSession` + `visibilityWhereFragment` live in `apps/server/src/sessions/visibility.ts`); `backend.session_management.get_session_endpoint` (settled — the 404-not-403 existence-non-leak decision is the canonical rule); `backend.session_management.session_privacy_toggle` (settled — same visibility-then-authority ordering); `backend.websocket_protocol.ws_subscribe_to_session` (settled — WS `subscribe` rejects non-visible with `code: not-found`); `backend.websocket_protocol.ws_error_message` (settled — canonical WS `error` envelope shape).

## What this task is

Closes finding **G-014** from the M3 coverage security review. The visibility predicate `canSeeSession` in `apps/server/src/sessions/visibility.ts` collapses "session doesn't exist" and "session exists but caller can't see it" at the SQL layer — both produce zero rows from `SELECT 1 FROM sessions WHERE id = $1 AND <visibility fragment>`. Every callsite that returns 404 on that zero-row outcome ends up with an identical response by construction. The reviewer's concern is that the no-leak invariant is **structural**, not **asserted**: a future refactor (adding a debug `details` field, splitting the two-row branch into separate handlers, replacing the single SELECT with a two-step exists-then-visible check that surfaces different errors per branch) could silently re-introduce the distinction. There's no test that fails if it does.

This task lands the negative test. For each surface the reviewer called out (HTTP `GET /sessions/:id`, HTTP `PATCH /sessions/:id/privacy`, WS `subscribe`), the test issues two requests from the same authenticated caller — one for a fully nonexistent session id, one for a private session id the caller has no relationship to — and asserts the **response is byte-equal** after stripping per-request varying fields. The assertion shape pins three properties at the same time: same HTTP status code (HTTP) or `error.type` (WS), same `error.code`, same `error.message`. The bodies are compared as full normalized JSON so a future addition of any new field to either branch surfaces as a test failure.

The artefacts:

- `apps/server/src/sessions/routes.test.ts` — adds two new `describe` blocks: (a) `GET /sessions/:id — bytewise-identical 404 response for nonexistent vs. private-not-visible (G-014)` and (b) `PATCH /sessions/:id/privacy — bytewise-identical 404 response for nonexistent vs. private-not-visible (G-014)`. Each block seeds a private-not-visible session AND issues a request for a separate fully-unknown UUID, then deep-compares the responses.
- `apps/server/src/ws/handlers/subscribe.test.ts` — adds one new `it(...)` case under the existing `ws_subscribe_to_session — handler integration` describe: `bytewise-identical error envelope for nonexistent vs. private-not-visible session (G-014)`. The case sends two `subscribe` envelopes (with deliberately equal `id` fields so `inResponseTo` doesn't vary) and asserts the two response envelopes are byte-equal after stripping the freshly-minted `id` field.

## Why it needs to be done

- **Pins a structural invariant before it drifts.** The no-existence-leak is the load-bearing property of the `404-not-403` decision (see `tasks/refinements/backend/get_session_endpoint.md`). Today it holds because the visibility predicate's SQL collapse makes it unavoidable; tomorrow a future contributor could replace the single SELECT with a "fetch row + then check visibility" pattern and accidentally emit different error messages on each branch. The test fails the moment that happens.
- **Cheap regression infrastructure.** All three surfaces already have 404-not-403 tests (`routes.test.ts:1786`, `routes.test.ts:2420`, `subscribe.test.ts:295`) that assert the status code AND error code match between the two cases — but not the full response body. The new tests extend the same fixtures with a bytewise-equality assertion. No new app builds, no new pool shapes; just a stronger assertion on the existing test surface.
- **Auditor-readable evidence.** The reviewer can grep for `G-014` in the test file and see exactly which surface the no-leak invariant covers, what fields are stripped before the bytewise compare, and why. The audit trail is bidirectional: the finding cites the test; the test cites the finding.
- **Anchors the same property for future endpoints.** The pattern (load two responses, strip varying fields, deep-equal) generalizes to `POST /sessions/:id/end`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`, and `POST /sessions/:id/include` — all of which inherit the same 404-on-invisible rule. This task pins the minimal three the reviewer named; a follow-up could broaden coverage if the residual surface is judged worth pinning. For v1 the three-surface coverage is sufficient to assert the discipline.

## Inputs / context

From [docs/security/m3-review/coverage.md](../../../docs/security/m3-review/coverage.md) G-014:

> **Surface**: WS `subscribe` handler (`apps/server/src/ws/handlers/subscribe.ts:93`)
>
> **Existing coverage**: `subscribe.test.ts:295` tests a "non-visible session" emits `code: not-found`. The handler comment at line 95 documents the existence-non-leak rule.
>
> **Gap**: There is no test asserting the wire response is BYTEWISE-IDENTICAL between "session doesn't exist" and "session exists but is private". The visibility predicate collapses them at the SQL layer, but a future refactor (e.g., adding a debug detail field) could leak the distinction. No test asserts the negative.
>
> **Adversarial scenario**: Information leak — an attacker iterates UUIDs and learns which UUIDs match real private sessions vs. random UUIDs by timing or response shape.
>
> **Suggested test**: `subscribe.test.ts` — two cases that should produce IDENTICAL envelopes (same `code`, same `message`, same shape; only `inResponseTo` differs because the request id differs). Diff the response payloads (after stripping `inResponseTo` and `id`) and assert equality.

Production-code surfaces this task pins (READ-ONLY — no modifications):

- HTTP `GET /sessions/:id` — `apps/server/src/sessions/routes.ts:1500` — emits `ApiError.notFound('session not found or not visible')` via the canonical `{ error: { code: 'not-found', message: 'session not found or not visible' } }` envelope at HTTP 404 for BOTH the "no row matches the id" case AND the "row matches the id but isn't visible" case.
- HTTP `PATCH /sessions/:id/privacy` — `apps/server/src/sessions/routes.ts:1778` — same `ApiError.notFound('session not found or not visible')` at HTTP 404 for both branches.
- WS `subscribe` — `apps/server/src/ws/handlers/subscribe.ts:93` — emits `sendWsError(..., { code: 'not-found', message: 'session not found', inResponseTo: envelope.id })` for both branches.

The visibility predicate at `apps/server/src/sessions/visibility.ts:167` (`canSeeSession`) is the source of the collapse — its docblock at line 141 names the invariant explicitly: "The function does NOT distinguish 'the session doesn't exist' from 'the session exists but the caller can't see it' — both return false."

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure unit-level surface (Fastify `.inject(...)` for HTTP, `app.injectWS(...)` for WS). Lands as Vitest extensions to the existing `routes.test.ts` and `subscribe.test.ts` — no new test file, no new infrastructure. The Cucumber+pglite layer is not needed because the assertion is on the wire-format symmetry, which is fully exercised by the existing memory-pool shims.

## Constraints / requirements

- **TEST-ONLY.** No production-code changes. If a test reveals a real existence-leak (which would mean the visibility predicate or a callsite is buggy), STOP and surface the finding rather than silently fixing it.
- **Three surfaces, minimum.** HTTP `GET /sessions/:id`, HTTP `PATCH /sessions/:id/privacy`, WS `subscribe`. These are the three the reviewer named in G-014 (the HTTP pair is implied by the WS gap — the same invariant rides every endpoint that returns 404 on invisible).
- **Bytewise equality after stripping varying fields.** The compare is a deep-equal on a *normalized copy* of each response body. The stripped fields:
  - HTTP: no per-request varying fields exist in the error envelope. The `{ error: { code, message } }` shape is the entire body (no `id`, no `timestamp`, no `request-id` in the envelope — Fastify's `setErrorHandler` writes only the canonical shape; see `apps/server/src/error-handler.ts:148-157`). The comparison is therefore on the unstripped body — every byte must match.
  - WS: the envelope carries a freshly-minted `id: randomUUID()` AND an `inResponseTo` field. The compare strips `id` (which is genuinely per-response). `inResponseTo` is held equal across the two requests by issuing both `subscribe` envelopes with the same client-supplied `id` so the server's `inResponseTo` is the same on both sides. The compare strips both for safety.
- **Two cases per surface, in one describe block.** Each new `describe` block reuses the existing seed helper, sets up two contexts in one fixture, makes both requests, and asserts the bytewise equality in a single `expect(strip(a)).toEqual(strip(b))` plus a status-code parity assertion. Keeping both cases in one test makes the regression obvious: a future split into two different responses fails one test, not two.
- **Status code parity is asserted separately.** HTTP: `expect(resA.statusCode).toBe(resB.statusCode)` AND `expect(resA.statusCode).toBe(404)`. WS: the envelope's `type` is asserted to be `'error'` on both sides; the `payload.code` is asserted to be `'not-found'` on both sides.
- **Distinct UUIDs for the two cases.** The nonexistent UUID is a fresh v4 UUID seeded nowhere in the memory store. The private-not-visible UUID is the id of a session seeded with `privacy: 'private'` and a host that isn't the caller (and the caller isn't a participant). The two UUIDs are deliberately distinct so the test doesn't accidentally pass via "same id → same response."
- **No throwaway probes (ADR 0022).** Every assertion lands as a Vitest case in a committed file. The first run of each test answers the question "does the no-leak property hold today?" and pins the answer for every future run.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run check` succeeds (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` (Vitest) green; net positive test delta of +3 cases:
  - 1 case in `routes.test.ts` for `GET /sessions/:id`.
  - 1 case in `routes.test.ts` for `PATCH /sessions/:id/privacy`.
  - 1 case in `subscribe.test.ts` for WS `subscribe`.
- For each of the three surfaces, the test asserts the bytewise-equality predicate AND the status-code/error-code parity. A future refactor that distinguishes the two branches breaks at least one assertion in at least one test.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Three surfaces, not five.** The reviewer called out WS `subscribe` explicitly and named HTTP `GET /sessions/:id` and `PATCH /sessions/:id/privacy` implicitly (via the suggested test's coverage shape). `POST /sessions/:id/end`, `POST /sessions/:id/participants`, `DELETE /sessions/:id/participants/:userId`, and `POST /sessions/:id/include` ALSO return 404 on invisible — but extending the bytewise-pin to all of them would treble the test count without adding load-bearing assertions: every one of those endpoints uses the same `ApiError.notFound('session not found or not visible')` literal as `GET /sessions/:id` does, so a refactor that breaks ONE endpoint's no-leak property would necessarily change a shared constant or copy-paste site and break the three surfaces this task already pins. The three-surface coverage is the minimum-viable assertion; broadening is optional and tracked as a future task if the residual surface is judged worth pinning.
- **Compare full bodies, not just `error.code` + `error.message`.** The reviewer's suggestion was to "diff the response payloads after stripping `inResponseTo` and `id`." The stronger assertion — `expect(stripVarying(bodyA)).toEqual(stripVarying(bodyB))` — catches the addition of ANY field (a future `details: { reason: 'session-private' }` would fail the test even if `code` and `message` are unchanged). The cost of the stronger compare is zero (Vitest's `toEqual` is the same primitive); the benefit is full coverage of the "any new field is a leak" class.
- **Stripped fields are: HTTP nothing, WS `id` + `inResponseTo`.** The HTTP error envelope (`{ error: { code, message } }` from `apps/server/src/error-handler.ts:148-157`) has no per-request varying fields — Fastify's `setErrorHandler` writes only `code` and `message`. The WS error envelope has `id` (a v4 UUID minted per response by `buildWsErrorEnvelope` in `apps/server/src/ws/error-envelope.ts:128`) and `inResponseTo` (the client envelope's id). Both are stripped before the compare: `id` because it's genuinely per-response varying, `inResponseTo` because it correlates back to the client request id (which the test holds equal by re-using the same message id — see the next decision).
- **Reuse the same client-supplied `id` for both WS `subscribe` envelopes.** The cleaner alternative is two distinct `id` values and strip `inResponseTo` from the compare. Holding the `id` equal across the two requests is slightly fragile (the dispatcher accepts duplicate ids today — see `coverage.md` G-009) but makes the test's "the responses should be identical" claim load-bearing: if a future refactor adds a server-side `request-id` to the envelope, the test still catches it because the only allowed variation is `id` (the server-minted per-response field). The `id` re-use is documented in the test with a code comment. Both `id` AND `inResponseTo` are stripped for belt-and-suspenders so the test still works if a future refactor mints a fresh `inResponseTo` from somewhere else.
- **HTTP responses asserted via `.json()` + `.statusCode`, not raw body bytes.** Fastify's `setErrorHandler` calls `reply.type('application/json').send(envelope)`, which serializes via Fastify's stable stringifier. The on-wire bytes are deterministic given the JSON object, so comparing parsed JSON is bytewise-equivalent and avoids brittle whitespace assertions. The contract Vitest pins is "the same JSON object" — which is the contract the client sees.
- **Two requests per test, one app fixture.** Each new test issues both requests against the same `built.app` fixture so the seed (users, sessions, participants, pool state) is identical for both branches. The only intentional difference is the path/sessionId. Anything else that differs between the two responses is the test's failure mode.
- **No `details` field on either response is the current invariant.** Both surfaces emit a two-field error (`code` + `message`) today. The test asserts the absence of `details` indirectly by comparing the full body — if either side grows a `details` field that the other side lacks, the deep-equal fails. The reviewer's suggested fix in G-014 explicitly warned about a future "debug detail field" as the leak vector; this is exactly what the bytewise compare catches.
- **WS uses `app.injectWS(...)` (no real port bind).** Mirrors the existing `subscribe.test.ts` infrastructure. The two `subscribe` envelopes are sent on a single connection (both branches are independent of connection state; the WS handler runs the visibility predicate per-message). The test drains the hello envelope first, then sends the two `subscribe` envelopes and reads the two `error` envelopes in order.
- **Surfaced findings, not silently-fixed bugs (per task constraints).** If the test reveals an existence-leak (which it shouldn't — the production code is correct today), STOP and report. The task is TEST-ONLY. No production code is in scope.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11. Landed as:

- HTTP `GET /sessions/:id` bytewise pin: [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — 1 new test inside the `GET /sessions/:id — visibility-gated fetch` describe block (`returns a bytewise-identical 404 response for a nonexistent id vs. a private session not visible to the caller (G-014)`).
- HTTP `PATCH /sessions/:id/privacy` bytewise pin: same file — 1 new test inside the `PATCH /sessions/:id/privacy — host toggles session privacy` describe block (same naming pattern).
- WS `subscribe` bytewise pin: [`apps/server/src/ws/handlers/subscribe.test.ts`](../../../apps/server/src/ws/handlers/subscribe.test.ts) — 1 new test inside the `ws_subscribe_to_session — handler integration` describe block (`emits bytewise-identical 'error' envelopes for a nonexistent session vs. a private not-visible session (G-014)`).
- Test count delta: routes.test.ts 76 → 78 (+2); subscribe.test.ts 4 → 5 (+1). Total +3 cases.
- No production-code changes — the no-existence-leak invariant is verified to hold today as-is.
- WBS: `complete 100` marker added to `bytewise_404_vs_private_pin` in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
