Source: docs/security/m3-review/coverage.md G-006

# Test: catch-up `sinceSequence` boundary values rejected at the envelope-parse boundary

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.catch_up_boundary_values_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — produced `parseWsEnvelopeJson` and `WsEnvelopeValidationError`) and `backend.websocket_protocol.ws_reconnection_handling` (settled — produced the `catch-up` payload schema this task pins).

## What this task is

A TEST-ONLY task. Pin (via committed tests) that the WS envelope parser rejects adversarial `sinceSequence` values on `catch-up` envelopes at the wire boundary. The Zod schema [`catchUpPayloadSchema`](../../../packages/shared-types/src/ws-envelope.ts) already enforces `sinceSequence: z.number().int().nonnegative()`; this task converts that "obvious by inspection" claim into a regression test so a future schema regression (e.g., switching `nonnegative()` to `min(-1)`, or replacing `.int()` with `.finite()`) is caught by CI.

Two layers receive tests:

1. **Pure-logic / schema layer** — [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts). Parameterised cases over the bad values, asserted via both the direct schema (`catchUpPayloadSchema.safeParse`) and the JSON-wire path (`parseWsEnvelopeJson` on a serialised envelope). Plus regression-pin cases for the accepted values (0, 100, `Number.MAX_SAFE_INTEGER`) so the test isn't trivially-passing.

2. **Dispatcher / wire-boundary layer** — [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts). One handler-integration case that sends each bad value through a real Fastify WS upgrade and asserts the dispatcher emits a canonical `malformed-envelope` error envelope (no `inResponseTo`, per the malformed-envelope contract — the inbound `id` isn't trusted because the envelope itself failed validation) and that the connection stays open across repeated parse failures.

## Why it needs to be done

G-006 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) is the source finding:

> The Zod schema rejects negative / fractional / NaN / Infinity at parse time — but there is NO test that the envelope-parser correctly rejects those values at the wire boundary. The Zod regression would silently allow them past the gate. Specifically: `sinceSequence: -1`, `sinceSequence: 9999999999999`, `sinceSequence: 0.5`, `sinceSequence: "0"` (string).
>
> **Adversarial scenario**: A regression in the shared-types schema (e.g., switching `nonnegative()` to `min(-1)`) would let a `sinceSequence: -1` request through; the SQL `WHERE sequence > $2 AND sequence <= $3` would still work, but a `Number.parseInt(maxSeq) - sinceSequence = positive number larger than threshold` triggers the snapshot path, leaking the full projection of a session via what should be a tiny replay.

The existing coverage at `catch-up.test.ts` lines 610-642 covers `sinceSequence > MAX(sequence)` (client-ahead, defensive — no replay, single ack). That pins the **handler arithmetic** for the well-formed-but-stale case. The complementary gate — the **parser** rejecting structurally-bad values — has no committed pin. This task closes that gap.

ADR 0022 (no throwaway verifications) is explicit: every empirical verification of system behavior lands as a committed test. The "obvious by inspection" defense doesn't survive a schema refactor; the regression test does.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-006 — source finding (Medium severity).
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) lines 806-809 — `catchUpPayloadSchema = z.object({ sessionId: z.string().uuid(), sinceSequence: z.number().int().nonnegative() })`. The closed `z.object` strips unknown keys; `.int()` defers to `Number.isSafeInteger` in Zod v4 (verified empirically by the schema-layer test for `9007199254740993`).
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) lines 1403-1414 — `parseWsEnvelopeJson`. Wraps `JSON.parse` failures and `parseWsEnvelope` failures into the same `WsEnvelopeValidationError`. The dispatcher catches this and emits a `malformed-envelope` error envelope.
- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) — existing handler-integration scaffolding (`makeCatchUpPool`, `openWsClient`, `catchUpFrame`, `subscribeFrame`). The new test reuses every helper.
- [`apps/server/src/ws/connection.test.ts`](../../../apps/server/src/ws/connection.test.ts) lines 253-290 — the existing `malformed-envelope`-on-bad-JSON pin. Establishes the wire shape this task asserts (no `inResponseTo`, `payload.code === 'malformed-envelope'`, connection stays open).
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification lives as a committed test.

## Constraints / requirements

- **Test-only.** No edit to `catchUpPayloadSchema`, no edit to `parseWsEnvelopeJson`, no edit to the dispatcher. The schema is already correct; this task pins it.
- **Two test layers, one logical surface.** The schema-level vocabulary is enumerated in `ws-envelope.test.ts` (pure-logic per ADR 0022's layer routing — Vitest unit tests). The handler-integration layer gets ONE case that exercises the dispatcher → parser → error-envelope path end-to-end.
- **Cover every bad value G-006 calls out**, plus the realistic JSON wire-form image of `NaN` / `Infinity` (which `JSON.stringify` writes as `null`):
  - `sinceSequence: -1` (negative)
  - `sinceSequence: 0.5` (fractional)
  - `sinceSequence: "0"` (string)
  - `sinceSequence: null` (the wire image of NaN / Infinity)
  - `sinceSequence: NaN` / `Infinity` / `-Infinity` (in-memory only — for the direct schema test)
  - `sinceSequence: 9007199254740993` (above `Number.MAX_SAFE_INTEGER`)
  - `sinceSequence: undefined` (missing field)
  - Boolean / array / object as `sinceSequence` (negative-control rejections)
- **Pin the accepted values too.** `sinceSequence: 0`, `sinceSequence: 100`, and `sinceSequence: Number.MAX_SAFE_INTEGER` (the boundary itself) — so a regression that makes the schema reject too aggressively also fails this suite.
- **Verifications per ADR 0022.** Every empirical claim about schema behavior is a committed test. No `node -e`, no ad-hoc probe.

## Acceptance criteria

- `packages/shared-types/src/ws-envelope.test.ts` contains a new top-level `describe('catch-up `sinceSequence` boundary values (G-006)', …)` block with two nested describes — one for the schema-level rejections, one for the JSON-wire rejections — plus the regression-accepted cases.
- `apps/server/src/ws/handlers/catch-up.test.ts` contains one new `it('SECURITY (G-006): …')` case inside the existing handler-integration describe block.
- `pnpm exec vitest run packages/shared-types/src/ws-envelope.test.ts` — green.
- `pnpm exec vitest run apps/server/src/ws/handlers/catch-up.test.ts` — green.
- `pnpm run check` — clean.
- `pnpm run test:smoke` — green.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **No schema tightening for the MAX_SAFE_INTEGER case — the existing schema already rejects it.** Zod v4's `z.number().int()` validates with `Number.isSafeInteger` (not the looser `Number.isInteger`), which returns `false` for values past `2^53 - 1`. The schema-level test for `sinceSequence: 9007199254740993` confirms this empirically — `catchUpPayloadSchema.safeParse({ ..., sinceSequence: 9007199254740993 }).success === false`. No `.max(Number.MAX_SAFE_INTEGER)` clause is needed; the existing `.int()` already enforces the ceiling. G-006's suggested test ("Number.MAX_SAFE_INTEGER+1") is therefore a regression pin on a behavior the schema already has, not a new bound.

- **Two test layers, not one.** ADR 0022's layer-routing puts schema-shape questions in Vitest unit tests (`packages/shared-types/src/*.test.ts`) — pure logic, no I/O, fast. The wire-boundary question (does the dispatcher actually surface the parse failure as `malformed-envelope` on the catch-up surface?) is an I/O-shaped question that lives in the handler-integration tests (`apps/server/src/ws/handlers/catch-up.test.ts`). Splitting them avoids one giant handler test that exercises every bad value through a real WS upgrade (slow); one handler test verifies the wire-boundary contract, and the schema-layer test exhaustively enumerates the rejection vocabulary (fast).

- **Parameterise the bad-value cases.** A `for (const c of cases)` loop generates an `it(…)` per case in the schema-layer test, so a future addition (e.g., bigint, `Symbol`) is a one-line array entry rather than a copy-paste of the assertion block. The dispatcher-layer test uses an inline array because the test body is the same for every value (send the wire form, assert `malformed-envelope`).

- **The dispatcher-layer test asserts the connection stays open.** Per the `malformed-envelope` contract (`connection.test.ts` line 253-290), a per-frame parse failure is a client bug recoverable by re-sending. Iterating five bad values on a single connection AND asserting `readyState === 1` after the last failure pins both the rejection AND the recovery invariant in one test — exactly the kind of multi-claim density ADR 0022 supports.

- **`null` instead of `NaN` / `Infinity` on the wire.** `JSON.stringify(NaN) === 'null'`; `JSON.stringify(Infinity) === 'null'`. An attacker sending `NaN` as `sinceSequence` would see it normalised to `null` before the server's parser even sees it. The wire-boundary tests therefore use the literal `null` token; the in-memory `safeParse` tests cover the JS-side `Number.NaN` / `Number.POSITIVE_INFINITY` constants separately for completeness (in case a future binary-WS protocol bypasses JSON serialisation).

- **Subscribed before adversarial frames.** The new dispatcher-level test subscribes the client to a real session before sending bad envelopes. The parse failure fires upstream of the subscribe-before-act gate, so the subscribe is belt-and-suspenders; without it, a future regression that moves the parse downstream of the gate would still surface a wire error but with code `forbidden` — and this test would fail loudly on that exact regression. The check is intentional, not redundant.

- **No new fixture ids.** Reuses `SEEDED_SESSION_ID`, `SUB_MSG_ID`, `CATCH_MSG_ID` already declared at the top of `catch-up.test.ts`. New tests on existing surfaces should consume existing fixtures.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:
- [`packages/shared-types/src/ws-envelope.test.ts`](../../../packages/shared-types/src/ws-envelope.test.ts) — new `describe('catch-up sinceSequence boundary values (G-006)', …)` block with 28 new `it(…)` cases across two nested describes: schema-level (`catchUpPayloadSchema.safeParse` direct) and JSON-wire (`parseWsEnvelopeJson` end-to-end). Bad values pinned: negative, fractional, string-as-number, `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, boolean, array, object, and `Number.MAX_SAFE_INTEGER + 2`. Regression-accepted values pinned: 0, 100, and `Number.MAX_SAFE_INTEGER` (boundary).
- [`apps/server/src/ws/handlers/catch-up.test.ts`](../../../apps/server/src/ws/handlers/catch-up.test.ts) — one new `it('SECURITY (G-006): wire-boundary rejection of adversarial sinceSequence values → malformed-envelope', …)` case inside the existing handler-integration describe block. Iterates five bad values (`-1`, `0.5`, `"0"`, `null`, `9007199254740993`) on a single WS connection, asserts each surfaces a `malformed-envelope` error envelope with no `inResponseTo`, and asserts the connection stays open across all five failures.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `catch_up_boundary_values_pin`. `tj3 project.tjp` parses silent.
- No production-code change. The schema (`catchUpPayloadSchema`) was already correct: Zod v4's `.int()` uses `Number.isSafeInteger`, which rejects values past `Number.MAX_SAFE_INTEGER`. G-006's suggested test for "Number.MAX_SAFE_INTEGER+1" turned out to be a regression pin on existing schema behavior, not a new bound — documented in Decisions.

Test count delta:
- `ws-envelope.test.ts`: 17 → 45 `it(…)` blocks (+28).
- `catch-up.test.ts`: 13 → 14 `it(…)` blocks (+1).
- Total: +29 new committed tests.

`pnpm run check` and `pnpm run test:smoke` both pass.
