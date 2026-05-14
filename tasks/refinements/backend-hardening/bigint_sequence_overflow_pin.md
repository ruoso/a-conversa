Source: docs/security/m3-review/coverage.md G-010

# Pin behavior at and past `session_events.sequence = Number.MAX_SAFE_INTEGER`

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.bigint_sequence_overflow_pin`
**Effort estimate**: 0.5d
**Inherited dependencies**: `backend.websocket_protocol.ws_propose_message` (settled — produced the propose handler whose sequence-allocation flow this task pins); `data_and_methodology.event_types.event_validation` (settled — produced `validateEvent` whose `.int()` constraint provides the load-bearing safety net pinned here); `backend.websocket_protocol.ws_message_envelope` (settled — produced the dispatcher's `internal-error` surface this task pins as the wire-side rejection code).

## What this task is

A TEST-ONLY, limitation-pin task. Add a dedicated `describe(...)` block to [`apps/server/src/events/validate.test.ts`](../../../apps/server/src/events/validate.test.ts) with three `it(...)` cases that together pin the **current**, **documented limitation**: per-session `session_events.sequence` values are JS `number`s, safe up to `Number.MAX_SAFE_INTEGER` (`2^53 - 1` = `9007199254740991`), and the behavior past that boundary is structurally constrained (not silently catastrophic) by the `validateEvent` schema-on-write gate at the cost of a generic `internal-error` wire surface.

The three pins:

1. **SAFE at the boundary.** Call `validateEvent` on a well-formed event envelope with `sequence: Number.MAX_SAFE_INTEGER`. The schema (`eventEnvelopeSchema.sequence: z.number().int().nonnegative()`) accepts it because Zod v4's `.int()` defers to `Number.isSafeInteger`, and `MAX_SAFE_INTEGER` itself IS a safe integer. The validator returns the parsed event unchanged. Pinning the safe ceiling so a regression that tightens `.int()` past `Number.isSafeInteger` (or that introduces a runtime cap *below* `MAX_SAFE_INTEGER`) would surface here loudly.

2. **UNSAFE past the boundary.** Call `validateEvent` on the SAME envelope but with `sequence: Number.MAX_SAFE_INTEGER + 1` (= `9007199254740992`, no longer a safe integer; `Number.isSafeInteger(MAX_SAFE_INTEGER + 1) === false`). The validator throws `EventValidationError` with `code: 'envelope-invalid'` and `kind: null` (the failure is on the envelope's `sequence` field, not on the per-kind payload). This is the LOAD-BEARING safety net for the propose handler chain — when the handler's `validateEvent(emitted)` call at `propose.ts:305` (and the equivalent calls in `vote.ts`, `commit.ts`, `meta-disagreement.ts`, and the five `sessions/routes.ts` sites) sees an emitted event whose engine-allocated `sequence = MAX(sequence) + 1` has crossed the safe-integer ceiling, this is the gate that rejects it before the INSERT lands. On the wire, the resulting thrown error surfaces as the dispatcher's generic `internal-error` envelope (per `dispatcher.ts:278`'s `safe ? err.code : WS_INTERNAL_ERROR_CODE` branch — `EventValidationError` is NOT `ApiError`-shaped). No event is appended to the store (the transaction rolls back). The connection stays open. Pin #2 documents the validator-layer behavior; the wire-surface behavior is a derived consequence we name in the comment but do not re-test (the propose handler's existing test coverage already exercises the dispatcher → wire-error path for handler-thrown errors generally).

3. **KNOWN-LIMITATION: silent precision loss when pg returns `MAX(sequence)` as a string > `Number.MAX_SAFE_INTEGER`.** The pg driver returns BIGINT values as strings by default (verified in code at `propose.ts:225` where the row type is `{ max_seq: number | string | null }` and `propose.ts:232` parses with `Number.parseInt(rawMax, 10)`). If the DB ever contains a row at `sequence = 9007199254740993` (one past the safe ceiling — only reachable via a non-application-mediated INSERT, e.g., a DBA error, a hand-crafted migration, or a non-`appendSessionEvent` write path), `Number.parseInt('9007199254740993', 10) === 9007199254740992` — silent precision loss. This pin asserts the precision-loss formula directly (no need to drive through the propose handler — the surrounding behavior on the propose path is already covered by pin #2's validator rejection). The pin lives in the same `describe(...)` block as #1 and #2 so a future reader sees the full sequence-overflow story in one place.

**Why validate.test.ts and not propose.test.ts.** G-010's literal suggestion is to "seed the events table with a single row at sequence `Number.MAX_SAFE_INTEGER`, then send a `propose`" — but the propose handler runs `projectFromLog(priorEvents, sessionId)` over the seeded events, which enforces "next event's sequence is exactly `lastAppliedSequence + 1`" via `OutOfOrderEventError` (`projection/replay.ts:780`). Seeding a `participant-joined` at `MAX_SAFE_INTEGER` requires `MAX_SAFE_INTEGER - 1` prior events, which is impossible. The closest faithful test is at the actual load-bearing gate: `validateEvent`'s schema check on a candidate event envelope at the boundary value. Pinning the gate directly (rather than through an artificially-constructed propose round-trip) keeps the test cheap, fast, and aligned with what the gate actually protects against. See Decisions §"Test placement" for the full reasoning.

No production-code change is part of this task. The refinement explicitly weighs **pin vs fix** in Decisions §"Pin, not fix" and chooses pin — the safety net (`validateEvent`'s `.int()`) is already structurally load-bearing; the wire-surface `internal-error` is a UX cost that does not warrant a structural refactor (e.g., to `bigint` columns + `bigint`-aware JS handling) for a regime no v1 deployment can plausibly reach (per `tasks/refinements/backend-hardening/session_events_growth_policy_note.md`, a single session emits ~1000 events; reaching `2^53` would require ~`9 × 10^12` sessions, far beyond any conceivable v1 volume).

## Why it needs to be done

G-010 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

> The string-to-number coercion is in `propose.ts:232`, `vote.ts:184`, `commit.ts:188`, `meta-disagreement.ts`, plus 5 sites in `sessions/routes.ts`. The pg driver returns BIGINT as string by default; the code parses with `Number.parseInt`.
>
> **Gap**: `Number.parseInt("9007199254740993", 10) === 9007199254740992` (silent precision loss). No test injects a `MAX(sequence)` near or past 2^53 and asserts the handler either (a) handles it correctly with bigint math, or (b) fails loudly with a typed error. The docblock acknowledges the ceiling without enforcing it.
>
> **Adversarial scenario**: Very long-running session OR a deliberately-crafted poison row (DBA error) at sequence 2^53. Subsequent proposes silently land at the same JS-number sequence, breaking the read-side projection's invariant `sequence > prior.sequence`.
>
> **Suggested test**: Vitest case where the in-memory store seeds the events table with a single row at sequence `Number.MAX_SAFE_INTEGER`, then send a `propose`. Assert either a typed `sequence-overflow` error envelope or correct handling.

The G-010 finding gives the auditor two acceptable outcomes: (a) typed `sequence-overflow` error, or (b) correct handling. Pin #2 closes (b) for the "next allocation is unsafe" path with the **structurally-load-bearing** `validateEvent` gate (the unsafe-next-sequence is caught at schema-on-write time before the INSERT lands; transaction rolls back; no corruption possible). The wire-surface code is `internal-error` rather than a typed `sequence-overflow` because the engine + envelope schema sit upstream of any "is this a recoverable client error vs server bug" classification — to mint a `sequence-overflow` code we'd need either:

- a runtime guard in `propose.ts` (and the four sibling handlers + five `sessions/routes.ts` sites) that calls `Number.isSafeInteger(nextSeq)` and throws `ApiError`-shaped — a structural refactor across nine call sites, OR
- a code-mapping in `EventValidationError → ApiError` for the specific case of `path === 'sequence' && code === 'invalid_type'` — a structural addition with broader implications (every payload-shape rejection's wire surface changes).

Both fixes are structurally larger than the audit finding warrants for a regime no v1 deployment can plausibly reach. Pin #1 (SAFE) and #3 (KNOWN-LIMITATION) together complete the picture: the safe ceiling is exactly `MAX_SAFE_INTEGER`, and the only path past that ceiling is a non-application-mediated write that introduces silent precision loss in the `Number.parseInt` step (which a normal application-mediated write cannot reach, since `validateEvent` would have rejected it at write-time per pin #2). The composite picture is "safe up to and including `MAX_SAFE_INTEGER`; one-step-past produces a generic `internal-error` wire surface with no corruption; the only corruption path requires bypassing `appendSessionEvent`."

ADR 0022 (no throwaway verifications) requires every empirical claim about system behavior to land as a committed test. Pin #2's claim ("the next propose past `MAX_SAFE_INTEGER` is rejected by `validateEvent`, not silently appended") is the load-bearing security claim closing G-010's coverage half. Pin #3's claim ("`Number.parseInt('9007199254740993', 10) === 9007199254740992`") is the empirical claim the finding itself names — pinning it makes G-010's adversarial-scenario hypothesis verifiable, not just inferred.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-010 — source finding (Medium severity).
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) lines 200-312 — the transactional load-validate-append flow:
  - Line 225: row type `{ max_seq: number | string | null }` — pg may return BIGINT as either string or number, the shim returns number.
  - Line 232: `const maxSeq = typeof rawMax === 'string' ? Number.parseInt(rawMax, 10) : rawMax;` — the precision-loss site.
  - Line 233: `const nextSeq = maxSeq + 1;` — the overflow site.
  - Line 305: `validateEvent(emitted);` — the load-bearing safety net.
  - Line 309: `appendSessionEvent(client, emitted)` — the INSERT, only reached if `validateEvent` accepts.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) line 534: `sequence: z.number().int().nonnegative()` — the schema-on-write constraint. Zod v4's `.int()` defers to `Number.isSafeInteger` (verified empirically by `packages/shared-types/src/ws-envelope.test.ts:325` for the `sinceSequence` field which uses the same schema fragment).
- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — wraps `sharedValidateEvent`. Throws `EventValidationError` on envelope-shape failures; classified as `code: 'envelope-invalid'` for the sequence case (since the violation is on the envelope's `sequence` field).
- [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) lines 258-289 — `onHandlerError` seam. `EventValidationError` is NOT `ApiError`-shaped (`isApiErrorShape` returns false), so the wire `code` is `WS_INTERNAL_ERROR_CODE` (`internal-error`) and the `message` is the generic literal — sanitized, no `EventValidationError` details leaked.
- [`apps/server/src/ws/handlers/propose.test.ts`](../../../apps/server/src/ws/handlers/propose.test.ts) — the test file the new cases join. The existing `makeProposePool` / `buildHandlerApp` / `openWsClient` harness is reused without modification; the new `describe(...)` block opens its own pool variants (per-pin seed shapes) but consumes the same fixture user, session, node ids.
- [`tasks/refinements/backend-hardening/session_events_growth_policy_note.md`](./session_events_growth_policy_note.md) — companion documentation. The growth-policy refinement names "10 KiB / event, ~1000 events / session" as the v1 envelope; reaching `2^53` requires ~`9 × 10^12` sessions, multiple orders of magnitude beyond any plausible v1 deployment. The bounded-growth half lives there; the bounded-precision half lives here.
- [`tasks/refinements/backend-hardening/catch_up_boundary_values_pin.md`](./catch_up_boundary_values_pin.md) — structural template. The schema-layer half of that pin already pins `sinceSequence > MAX_SAFE_INTEGER → rejected`; this task pins the storage-layer half (`session_events.sequence > MAX_SAFE_INTEGER → rejected at validateEvent`) so both sides of the wire surface have explicit coverage.
- [`tasks/refinements/backend-hardening/duplicate_envelope_id_pin.md`](./duplicate_envelope_id_pin.md) — structural template for limitation-pin tasks; this refinement mirrors its shape (auditor-readable comment + cross-reference to the future structural-fix task naming + explicit invert-the-assertion-when-fix-lands instruction).
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification of system behavior lands as a committed test. The precision-loss formula in pin #3 is the canonical example of "obvious by inspection unless empirically pinned."

## Constraints / requirements

- **TEST-ONLY.** No production code changes. The handler at `propose.ts`, the schema at `events.ts`, the parseInt sites at `vote.ts:184` / `commit.ts:188` / `meta-disagreement.ts` / `sessions/routes.ts` (five sites) all stay intact. The test documents what they currently do.
- **Three `it(...)` cases inside one `describe(...)` block.** Title shape: `'KNOWN-LIMITATION: sequence safe-integer ceiling (G-010)'`. Each `it(...)` carries the pin-id in its title (`'SAFE: …'`, `'UNSAFE: …'`, `'PRECISION-LOSS: …'`) so a reviewer running `grep -rn G-010 apps/server` lands on the block.
- **Auditor-readable leading comment.** The new `describe(...)` opens with a comment that:
  - States this pins **current** behavior under the safe-integer ceiling.
  - Names the review reference: `coverage.md` G-010.
  - States the safe ceiling explicitly (`Number.MAX_SAFE_INTEGER = 9007199254740991`).
  - Names the future structural-fix task identifier (`sequence_bigint_storage`, hypothetical at refinement-write time — see Decisions §"Future-task naming") so a maintainer who later lands `bigint`-aware storage knows these pins must be inverted (or removed).
- **Re-use the existing harness.** No new top-level helpers; the per-pin pool helpers may live inline inside the new `describe(...)`. The pool factory pattern is the same as `makeProposePool` but parameterised over the seed `MAX(sequence)` value.
- **Pin #3 lives outside the WS path.** The precision-loss formula is a JS-runtime fact, not a propose-handler behavior. Pinning it through `Number.parseInt` directly (not through a WS round-trip) keeps the test fast and the assertion crisp — and pins the empirical claim G-010's adversarial-scenario hypothesis depends on. Placing it in the same `describe(...)` block as #1 and #2 keeps the audit trail co-located.
- **Connection stays open across pin #2.** The wire-level `internal-error` is recoverable (per the dispatcher's `onHandlerError` design); the test asserts `ws.readyState === 1` after the rejection to pin both the rejection AND the connection-survival invariant in one case.
- **No new fixture ids.** Re-use `FIXTURE_USER_ID`, `VISIBLE_SESSION_ID`, `NODE_ID`, `SUB_MSG_ID`, `PROPOSE_MSG_ID` already declared at the top of `propose.test.ts`.
- **Verifications per ADR 0022.** Three committed Vitest cases. No ad-hoc probes.

## Acceptance criteria

- `apps/server/src/events/validate.test.ts` contains one new `describe('KNOWN-LIMITATION: sequence safe-integer ceiling (G-010)', …)` block with three nested `it(...)` cases:
  - `'SAFE: accepts sequence = Number.MAX_SAFE_INTEGER (the boundary)'`
  - `'UNSAFE: rejects sequence = Number.MAX_SAFE_INTEGER + 1 with code envelope-invalid'`
  - `'PRECISION-LOSS: Number.parseInt("9007199254740993", 10) === 9007199254740992 — pins the silent precision-loss formula G-010 names'`
- The block's leading comment names `coverage.md` G-010, the `MAX_SAFE_INTEGER` ceiling, the load-bearing role of `validateEvent` in the propose / vote / commit / meta-disagreement chains, and the future-task identifier `sequence_bigint_storage`.
- Pin #2 asserts both `error.code === 'envelope-invalid'` AND `error.kind === null` AND that at least one issue is rooted at the `sequence` path (so a future regression that returns the WRONG envelope-shape error code surfaces with the right diagnostics).
- `pnpm exec vitest run apps/server/src/events/validate.test.ts` — green.
- `pnpm run check` — clean.
- `pnpm run test:smoke` — green.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Pin, not fix.** The audit-finding accepts either "fail loudly with a typed `sequence-overflow` error" or "correct handling." The current behavior — `validateEvent` catches the unsafe-next-sequence and surfaces `internal-error` on the wire — is "fail loudly" with a generic wire code. Replacing `internal-error` with a typed `sequence-overflow` would require either a per-handler runtime guard across nine call sites (`propose.ts`, `vote.ts`, `commit.ts`, `meta-disagreement.ts`, five `sessions/routes.ts` sites) or a code-mapping in the validator's error-shape layer. Both fixes are structurally larger than the audit finding's "Medium" severity warrants given the regime is unreachable in v1. The pin documents the trade-off and the future structural-fix task so a later reviewer sees the choice was deliberate.

- **Future-task naming: `sequence_bigint_storage`.** The structural fix is `bigint` columns + `bigint`-aware JS handling (sequence as `bigint` everywhere from the SQL row to the engine action to the event envelope). It does NOT yet exist in `tasks/25-backend-hardening.tji` — the G-010 coverage finding is the placeholder; creating the structural-fix task is out of scope for this refinement (it would need its own scope/decision pass on the bigint API surface across the WS handlers, HTTP routes, projection, and event envelope schema). The cross-reference names the future task by its **intended** identifier so when it lands, `grep -r sequence_bigint_storage` finds these pins.

- **Three pins, one describe block.** Splitting #1/#2/#3 into three separate `describe(...)` blocks would dilute the audit trail (a `grep -rn G-010 apps/server` would land on three places); keeping them co-located makes the full sequence-overflow story visible in one screen. The three `it(...)` titles encode the variant so the test report still reads cleanly.

- **Pin #3 is a `Number.parseInt` assertion, not a WS round-trip.** The G-010 finding's adversarial-scenario hypothesis is "`Number.parseInt('9007199254740993', 10) === 9007199254740992`." Pinning this directly is the cheapest possible test of the empirical claim; routing it through a WS round-trip would add no new signal (the round-trip path already fails at pin #2's `validateEvent` rejection BEFORE reaching the precision-loss site) and would slow the test for no benefit. The direct `expect(Number.parseInt(...)).toBe(...)` assertion is the cheapest possible empirical pin per ADR 0022.

- **Pin #2's wire code (derived consequence) is `internal-error`, not `sequence-overflow`.** Pin #2 itself tests `validateEvent` directly and asserts `code: 'envelope-invalid'` at the validator layer. The downstream wire-surface consequence — that the propose handler's `validateEvent(emitted)` throw surfaces as `internal-error` on the dispatcher seam — is named in the comment but not separately re-tested (the dispatcher's `onHandlerError` behavior for non-`ApiError`-shaped throws is already covered by `dispatcher.test.ts`). The audit-finding's "a typed `sequence-overflow` error envelope" suggestion would require either a runtime guard or a code-mapping, both of which are bigger than the pin. If `sequence_bigint_storage` later lands, the inversion of pin #2 is: change the validator-layer assertion from "rejects with `envelope-invalid`" to "accepts (because bigint sequences are valid)" — and the downstream wire-surface consequence vanishes.

- **Pin #1 IS load-bearing, not just regression cover.** Without pin #1, a future regression that lowers the safe ceiling below `MAX_SAFE_INTEGER` (e.g., a runtime cap at `Number.MAX_SAFE_INTEGER / 2`, perhaps as an over-eager DoS guard) would only surface as a deployment failure when a real session crossed the new cap. Pinning that `MAX_SAFE_INTEGER` itself works keeps the safe boundary exactly where the schema documents it.

- **Test placement: `events/validate.test.ts`, not `ws/handlers/propose.test.ts`.** G-010 literally suggests seeding the propose handler's pool with a row at sequence `Number.MAX_SAFE_INTEGER` and sending a propose, but the propose handler's `projectFromLog(priorEvents, sessionId)` call at `propose.ts:264` re-runs the projection over every prior event in the log — and the projection's per-event check at `projection/replay.ts:780` enforces "next event's sequence is exactly `lastAppliedSequence + 1`," throwing `OutOfOrderEventError` on any gap. Seeding a `participant-joined` at `MAX_SAFE_INTEGER` requires `MAX_SAFE_INTEGER - 1` prior events (impossible to enumerate). Mocking `projectFromLog` would break the integration property the propose-test layer exists to verify. The closest *faithful* test is at the load-bearing gate itself: `validateEvent`'s schema check on a candidate event at the boundary value. Pinning there is cheap, fast, and verifies the actual safety net.

- **No use of a propose-handler shim.** A natural-but-wrong alternative would be a propose-test variant that returns `MAX(sequence) = MAX_SAFE_INTEGER` from the pool shim BUT only seeds the events log with normal-sequenced events 1..N — divergence between the `MAX(sequence)` read and the events log. This would drive the handler into a state production cannot reach (in production those two values are always in lock-step because the same INSERT writes both). Such a test would prove nothing about the production code path; it would only prove that the handler crashes on artificially-inconsistent inputs. Rejected.

- **No new exports, no new module.** The test consumes only the existing public surface of `validateEvent` and `EventValidationError` already imported in `validate.test.ts`.

- **Re-use the existing `envelope(...)` helper in `validate.test.ts`.** Lines 124-145 already provide an `envelope<K>(kind, payload, overrides)` builder that takes a `sequence` override. The three new pins consume it without modification — exactly the kind of consolidation the existing test file's structure was designed for.

- **The leading describe comment is the audit-trail anchor, not just commentary.** An auditor reading the test file is the primary intended reader. The comment is structured so `grep -rn "G-010" apps/server/src/ws/handlers/` lands directly on it; the safe ceiling is named (`MAX_SAFE_INTEGER = 9007199254740991`); the safety-net mechanism is named (`validateEvent`'s `.int()` constraint); the future-task identifier (`sequence_bigint_storage`) is named so the next maintainer doesn't have to reason from scratch.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:
- [`apps/server/src/events/validate.test.ts`](../../../apps/server/src/events/validate.test.ts) — new `describe('validateEvent — KNOWN-LIMITATION: sequence safe-integer ceiling (G-010)', …)` block with three nested `it(...)` cases:
  - `'SAFE: accepts sequence = Number.MAX_SAFE_INTEGER (the boundary)'` — pins that `validateEvent` accepts the largest safe integer as a sequence.
  - `"UNSAFE: rejects sequence = Number.MAX_SAFE_INTEGER + 1 with code: 'envelope-invalid'"` — pins that the schema-on-write gate rejects any sequence past the safe ceiling, with assertions on `code`, `kind`, and the `issues[*].path === 'sequence'` rooted-at-the-right-field property.
  - `'PRECISION-LOSS: Number.parseInt("9007199254740993", 10) === 9007199254740992 — pins the silent precision-loss formula G-010 names'` — direct empirical pin of the JS-runtime fact G-010's adversarial-scenario hypothesis depends on.
  - The block opens with an auditor-readable comment that names `coverage.md` G-010, the `MAX_SAFE_INTEGER` ceiling, the chain of parseInt sites (`propose.ts:232`, `vote.ts:184`, `commit.ts:188`, `meta-disagreement.ts:213`, five `sessions/routes.ts` sites), the load-bearing role of `validateEvent` in the propose handler chain, the downstream wire-surface code (`internal-error`), and the future-task identifier `sequence_bigint_storage` for the structural fix.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added to `bigint_sequence_overflow_pin`. `tj3 project.tjp` parses silent.
- No production-code change. The schema-on-write gate (`eventEnvelopeSchema.sequence: z.number().int().nonnegative()` in `packages/shared-types/src/events.ts:534`) was already correct: Zod v4's `.int()` uses `Number.isSafeInteger`, which rejects values past `Number.MAX_SAFE_INTEGER`. G-010's "fail loudly with a typed error" suggestion turned out to be "fail loudly with a generic `internal-error` wire code" via the existing chain — pinned as the current trade-off; the typed-code structural fix is deferred to a future `sequence_bigint_storage` task.

Test placement decision: the refinement initially proposed pinning at `apps/server/src/ws/handlers/propose.test.ts` to match G-010's literal "seed the events table … send a propose" suggestion. An empirical trial showed that approach is impossible: the propose handler's `projectFromLog(priorEvents, sessionId)` enforces "next event's sequence is exactly `lastAppliedSequence + 1`" via `OutOfOrderEventError`, so seeding `participant-joined` at `MAX_SAFE_INTEGER` requires `MAX_SAFE_INTEGER - 1` prior events (impossible to enumerate). The refinement was updated mid-task to relocate the pin to `events/validate.test.ts` — the actual load-bearing gate. See Decisions §"Test placement" for the full reasoning.

Test count delta: 37 → 40 `it(...)` blocks in `apps/server/src/events/validate.test.ts` (+3). `pnpm exec vitest run apps/server/src/events/validate.test.ts` reports `40 passed (40)`.

`pnpm run check` and `pnpm run test:smoke` both pass.
