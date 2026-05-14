# `backend_hardening.data_hygiene.defensive_500_message_sanitize`

Source: docs/security/m3-review/inputs.md F-008

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.data_hygiene.defensive_500_message_sanitize`.
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.api_skeleton.error_handling` (settled — the central Fastify error-handler plugin + the canonical `ApiError` envelope live in `apps/server/src/error-handler.ts` and `apps/server/src/errors.ts`); `backend_hardening.resource_limits_and_dos.flow_state_map_bound` (settled — establishes the typed-5xx contract via `ApiError(503, 'temporarily-unavailable', ...)`).

## What this task is

Closes finding **F-008** from the M3 inputs security review. Several "unreachable" defensive 500s in `apps/server/src/sessions/routes.ts` (and one in `apps/server/src/ws/handlers/catch-up.ts`) are constructed as `ApiError(500, 'internal-error', '<descriptive sentinel>')`. The previous wire envelope echoed the descriptive `message` verbatim — strings like `'session insert returned no row'`, `'session_participants UPDATE returned no row or null left_at'`, `'auth middleware did not populate request.authUser'` — which, if any branch ever fired, would tell an attacker exactly which internal wiring just broke.

This task scrubs the wire `message` on every 5xx response (and drops `details`) at the central error handler, so individual route call sites don't need per-site care. The typed `code` field is **preserved** verbatim — it is the only typed discriminator clients branch on, including `'temporarily-unavailable'` from the `flow_state_map_bound` 503 path. The original `message` and `details` continue to reach the server log via `request.log.error({ err }, ...)`, so operators retain full visibility.

The artefacts:

- `apps/server/src/error-handler.ts` — exports two constants (`HTTP_INTERNAL_ERROR_MESSAGE = 'internal error'`, `HTTP_INTERNAL_ERROR_CODE = 'internal-error'`). Adds `scrubFiveHundredEnvelope(statusCode, envelope)` helper invoked from `sendEnvelope(...)` — the single chokepoint every error response funnels through. The 5xx `ApiError` and 5xx status-carrying branches now also log via `request.log.error({ err }, ...)` so the original `message` + `details` reach the server log on the no-leak path.
- `apps/server/src/error-handler.test.ts` — +5 new cases (`ApiError.internal` with details: code preserved + message + details scrubbed; `ApiError(503, 'temporarily-unavailable', ...)` with details: typed code preserved on 5xx; `@fastify/sensible` 5xx: scrub message; 4xx regression: typed message stays on the wire; constants source-pin).

## Why it needs to be done

- **Cross-cutting fix, not per-site care.** The reviewer's suggested fix was per-site: "Change defensive paths to throw a plain `Error` (not `ApiError`); the catch-all then renders the generic literal." That works but rebuilds the no-leak invariant at every defensive site — a future contributor who adds a new `ApiError(500, '...', '<sentinel>')` re-opens the same leak. Centralizing the scrub in the error handler makes the invariant uniform: every 5xx, every error class, every route gets the same treatment.
- **Preserves typed 5xx discrimination.** The structural alternative the previous attempt at this task adopted — replace BOTH `code` and `message` — broke `flow_state_map_bound`'s `temporarily-unavailable` 503 path. Clients branch on `code`; replacing it with `internal-error` collapses every typed 5xx (`temporarily-unavailable`, future `bad-gateway`, future `gateway-timeout`) into a single unbranded bucket. The right shape is **message-only scrub**: codes are typed contracts, messages are free text that may carry leaks.
- **Operator log surface unchanged.** The original `err.message` + `err.details` still ride the `request.log.error({ err }, ...)` call. Operators investigating a 5xx see the same diagnostic detail they always did; only the wire is sanitized. This mirrors the [`wire_error_no_echo`](./wire_error_no_echo.md) discipline (sanitize wire, keep log) and the WS-side `WS_INTERNAL_ERROR_MESSAGE` constant in `apps/server/src/ws/error-envelope.ts`.

## Inputs / context

From [docs/security/m3-review/inputs.md](../../../docs/security/m3-review/inputs.md) F-008:

> **Location**: `apps/server/src/sessions/routes.ts:1118-1123, 1154, 1226, 1693-1697, 1899, 2120, 2235-2238, 2342, 2491-2497`; `apps/server/src/ws/handlers/catch-up.ts:192` (`throw new Error('ws-catch-up: connection.user is undefined — auth gate bypassed')`).
>
> **Description**: Several "unreachable" defensive 500s are thrown as `ApiError(500, 'internal-error', '<descriptive>')`. Per `error-handler.ts`, `ApiError`-branded throws have their `message` echoed in the response body. Likewise the dispatcher's `onHandlerError` seam echoes `ApiError.code` + `ApiError.message` over WS. Strings like `'auth middleware did not populate request.authUser'`, `'session insert returned no row'`, `'session_participants UPDATE returned no row or null left_at'` would leak operational/internal-state details if any of these branches ever fired.
>
> **Impact**: Modest info leak — would tell an attacker which internal wiring just broke. Not currently triggerable, but the "defensive but actually reachable under cascading failure" class of bug is a known footgun.
>
> **Suggested fix**: Change defensive paths to throw a plain `Error` (not `ApiError`); the catch-all then renders the generic literal. Keep the descriptive text in the log line only.
>
> **Confidence**: Confirmed.

Pre-change shape of `sendEnvelope(...)` in [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) (lines 164-166):

```ts
function sendEnvelope(reply: FastifyReply, statusCode: number, envelope: ErrorEnvelope): void {
  reply.status(statusCode).type('application/json').send(envelope);
}
```

Pre-change ApiError branch (lines 175-179):

```ts
if (err instanceof ApiError) {
  sendEnvelope(reply, err.statusCode, buildEnvelope(err.code, err.message, err.details));
  return;
}
```

The typed 5xx contract this task must preserve lives at [`apps/server/src/auth/routes.ts:548-553`](../../../apps/server/src/auth/routes.ts):

```ts
if (err instanceof FlowStateCapacityError) {
  throw new ApiError(
    503,
    'temporarily-unavailable',
    'service is temporarily unable to start a new auth flow; please retry shortly',
  );
}
```

And the test that pins it — `apps/server/src/auth/routes.test.ts:285-308`'s "returns 503 + temporarily-unavailable when the cap is reached" — must STILL PASS after this task. The test asserts `body.error?.code` equals `'temporarily-unavailable'` and that the message contains no integers. Both invariants are unchanged: the code is preserved (this task's load-bearing decision); the new generic message `'internal error'` contains no integers.

The WS surface already follows the same discipline — see `apps/server/src/ws/error-envelope.ts:175-188`:

```ts
export const WS_INTERNAL_ERROR_MESSAGE = 'internal error';
export const WS_INTERNAL_ERROR_CODE = 'internal-error';
```

The HTTP constants this task introduces (`HTTP_INTERNAL_ERROR_MESSAGE`, `HTTP_INTERNAL_ERROR_CODE`) are the symmetric counterpart.

From [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md):

- Pure-logic change at the central handler; tests land as Vitest in `error-handler.test.ts`. No cucumber or playwright surface required — the wire-message shape is best asserted at the unit boundary via `app.inject(...)`.

## Constraints / requirements

- **Preserve `code` on 5xx.** The typed `ApiError.code` (or the `deriveCode(err)` output for status-carrying errors) MUST appear verbatim in the wire `body.error.code` for every 5xx response. This is the load-bearing structural difference vs. the previous reverted attempt. Specifically the existing `temporarily-unavailable` 503 test in `apps/server/src/auth/routes.test.ts` must continue to pass with no test edit.
- **Scrub `message` on 5xx.** Replace `body.error.message` with the exported constant `HTTP_INTERNAL_ERROR_MESSAGE = 'internal error'`. The literal mirrors `WS_INTERNAL_ERROR_MESSAGE` in `ws/error-envelope.ts` so the HTTP and WS surfaces emit the same generic text on the no-leak path.
- **Drop `details` on 5xx.** The scrubbed envelope is `{ error: { code, message } }` with no extra keys — any `details` that `buildEnvelope(...)` may have spread under `error` are discarded.
- **Don't touch 4xx.** Status `< 500` is passed through unchanged. Typed 4xx messages (`'topic is required'`, `'missing field'`) are client-actionable and stay on the wire. Their `details` keys (`field`, `issues`) also stay.
- **Single chokepoint.** The scrub happens inside `sendEnvelope(...)` (every branch routes through it). The handler cannot accidentally bypass the scrub in any branch — including future branches added by sibling tasks.
- **Operator-log preservation.** 5xx `ApiError` and 5xx status-carrying errors must reach `request.log.error({ err }, ...)` so the original `message` + `details` land in the server log. (Previously only the raw-Error fallback branch logged; the typed 5xx branch silently scrubbed without any log line. After this change, every 5xx path logs.)
- **No throwaway probes (ADR 0022).** Every assertion lands as a Vitest case in `error-handler.test.ts`. New test routes are added before `app.ready()` in the existing `beforeAll(...)` so the existing real-bootstrap pattern is reused.

## Acceptance criteria

- `pnpm --filter @a-conversa/server run build` succeeds.
- `pnpm run check` succeeds (lint + format + typecheck + tools + tests typecheck).
- `pnpm run test:smoke` (Vitest) green; +5 cases in `error-handler.test.ts` (7 → 12).
- `ApiError.internal('database connection lost', { sqlstate: '57P03' })` → wire body `{ error: { code: 'internal-error', message: 'internal error' } }`. No source-string fragment (`'database'`, `'SQLSTATE'`, `'57P03'`, `'sqlstate'`) appears anywhere in the response body.
- `ApiError(503, 'temporarily-unavailable', '...', { capValue: 1000 })` → wire body `{ error: { code: 'temporarily-unavailable', message: 'internal error' } }`. **`code` PRESERVED**; message + details scrubbed; no integers in the message.
- `app.httpErrors.internalServerError('upstream service exploded — sentinel x12')` → wire body has `message: 'internal error'`, `code` is some stable kebab string (`deriveCode(...)` output). No source-string fragment appears.
- `ApiError.badRequest('missing field', { field: 'name' })` → wire body `{ error: { code: 'bad-request', message: 'missing field', field: 'name' } }` — **4xx untouched**.
- The existing `flow_state_map_bound` 503 test (`apps/server/src/auth/routes.test.ts:285-308`) STILL PASSES with no edit. This is the explicit regression guard for the "preserve typed code" decision.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

## Decisions

- **Centralize the scrub in the handler, not per-site.** The reviewer's option ("change defensive paths to throw a plain `Error`") works but distributes the no-leak rule across every defensive 500 site (today 8+ sites in `sessions/routes.ts` alone). A future contributor who adds a new `ApiError(500, '...', '<sentinel>')` re-opens the same leak unless they remember the convention. Centralizing in `sendEnvelope(...)` makes the invariant uniform: the message-scrub is a property of the central handler, not of every call site. The route layer stays free to use `ApiError(500, '...', '<sentinel>')` for its own readability — the sentinel only appears in the server log.
- **Preserve `code`; scrub `message` + `details`.** This is the load-bearing structural difference vs. the previous reverted attempt. Rationale:
  - **`code` is a typed contract.** The closed `WsMessageType`-style discipline applies: clients branch on `code` (`'temporarily-unavailable'`, `'internal-error'`, future `'bad-gateway'`); scrubbing it collapses every typed 5xx into a single bucket and breaks client logic.
  - **`message` is free text.** It may carry DB driver fragments, defensive sentinels, internal-state hints; no client should branch on it; scrubbing has no behavioral cost.
  - **`details` is structured but not typed.** The `ApiErrorDetails` shape is `Readonly<Record<string, unknown>>` — open-ended on the value side. The same leak vector applies (SQLSTATE codes, hint strings, cap values), so it goes in the scrub set.
- **Generic literal is `'internal error'`, mirroring `WS_INTERNAL_ERROR_MESSAGE`.** Lowercase / unpunctuated by design — the HTTP and WS surfaces emit the same generic text on the no-leak path. The pre-change `'Internal server error'` (capitalized, "server") was Fastify-conventional but not aligned with the WS-side constant; aligning them lets a single test assertion check both surfaces if they ever need to (today they don't).
- **Exported constants — `HTTP_INTERNAL_ERROR_MESSAGE`, `HTTP_INTERNAL_ERROR_CODE`.** A source-pin test asserts the exact string values so a future contributor who drifts the literal cannot do so without updating both this refinement and the test in the same commit. Tests use the constants by import, not by literal — keeps the test brittle to intentional changes and immune to typos.
- **5xx `ApiError` and 5xx status-carrying errors now log via `request.log.error({ err }, ...)`.** Pre-change, only the raw-Error fallback branch logged; 5xx `ApiError` was silently scrubbed at the wire and never reached the log. After this change every 5xx path logs — operators retain visibility on every 5xx, not just the unexpected ones. This is a strict improvement: the log surface grows, the wire surface narrows.
- **`@fastify/sensible` 5xx flows through the same scrub.** The status-carrying-error branch (path 4 in the handler dispatch) routes through `sendEnvelope(...)` exactly like the `ApiError` branch, so `app.httpErrors.internalServerError('...')` gets the same treatment. The test asserts only that `code` is some stable kebab string (the `deriveCode(err)` output) rather than pinning a specific value — `deriveCode`'s output for `InternalServerError` is `'internal-server'`, but pinning that would couple the test to a `deriveCode` implementation detail.
- **No change to the canonical 404 / 422 / 400 / 409 paths.** 4xx is unaffected; the EventValidationError 422 path still spreads `kind` + `issues` under `error`; the validation-error 400 path still spreads `issues`. Only the 5xx-status arm hits the scrub.
- **Single source of "what's a 5xx?" — `statusCode >= 500`.** Not a switch over known codes; not a per-class branch. The simple numeric check matches every current and future 5xx (501, 502, 503, 504, 507, ...) without enumeration. The `< 500` short-circuit at the top of `scrubFiveHundredEnvelope(...)` keeps the 4xx path zero-cost.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- Implementation: [`apps/server/src/error-handler.ts`](../../../apps/server/src/error-handler.ts) — added `HTTP_INTERNAL_ERROR_MESSAGE` + `HTTP_INTERNAL_ERROR_CODE` exported constants, `scrubFiveHundredEnvelope(statusCode, envelope)` helper invoked from the (now wrap-and-forward) `sendEnvelope(...)` chokepoint. The 5xx `ApiError` and 5xx status-carrying branches additionally `request.log.error({ err }, ...)` so operators see the original message + details. The raw-Error fallback branch now uses the two exported constants in place of inline literals.
- Tests: [`apps/server/src/error-handler.test.ts`](../../../apps/server/src/error-handler.test.ts) — +5 cases (`scrubs the wire message + details on ApiError.internal (F-008)`, `preserves the typed 'code' on 5xx (temporarily-unavailable) while scrubbing message + details (F-008)`, `scrubs the wire message on a 5xx status-carrying error (@fastify/sensible) (F-008)`, `does NOT scrub the wire message on 4xx — typed 4xx text stays on the wire (F-008 regression)`, `exports the generic 5xx constants for cross-module reuse (F-008)`). Test count: 7 → 12.
- Regression guard: the existing `apps/server/src/auth/routes.test.ts:285-308` `flow_state_map_bound` 503 + `temporarily-unavailable` test PASSES UNCHANGED. The wire `code` is preserved; the new generic `message = 'internal error'` contains no integers, so the no-cap-leak invariant still holds.
- WBS: `complete 100` added to the `defensive_500_message_sanitize` task in [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji); `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
