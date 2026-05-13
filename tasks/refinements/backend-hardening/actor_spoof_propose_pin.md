Source: docs/security/m3-review/coverage.md G-007

# Test: actor-spoof rejected on WS `propose` (parity with vote / commit / meta-disagreement)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.actor_spoof_propose_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.websocket_protocol.ws_propose_message` (settled — produced the `propose` handler this task pins) and `data_and_methodology.event_envelope_zod_schema` (settled — the closed-object Zod payload-parsing convention this task relies on).

## What this task is

A TEST-ONLY task. Add one Vitest `it(...)` block to [`apps/server/src/ws/handlers/propose.test.ts`](../../../apps/server/src/ws/handlers/propose.test.ts) that pins the **actor-spoof-rejected** invariant on the WS `propose` handler:

- A subscribed, visible-session client sends a well-formed `propose` envelope with EXTRA `proposerId`, `actor`, and `requester` fields on the payload, naming a different user id.
- The wire schema (`wsProposePayloadSchema`, a closed `z.object`) strips the extra keys at parse time.
- The handler at `propose.ts:280` reads `connection.user.id` for the methodology `action.actor` and never consults the payload for identity.
- Assert that the appended `proposal` event's `actor` is `FIXTURE_USER_ID` (the connection's authenticated user) — NOT the spoofed id.

The vote / commit / mark-meta-disagreement handlers already have this exact invariant pinned (`vote.test.ts:711-761`, `commit.test.ts:937-962`, `meta-disagreement.test.ts:975-985`). Propose is the lone gap. After this task lands, all four write handlers have parity coverage.

No production-code change. If the implementation review surfaces a real bug (i.e., the handler does read a payload field for identity), STOP and surface as a separate finding rather than silently fixing under a TEST-ONLY task.

## Why it needs to be done

G-007 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) is the source finding:

> `propose.test.ts` has no test for "client sends extra `proposerId` field on payload; server uses `connection.user.id` regardless." The handler at `propose.ts:280` uses `actor: userId` from the connection — but this invariant is not pinned by a regression test specific to propose, whereas every other writer handler IS pinned.
>
> **Adversarial scenario**: A future refactor moves `actor` derivation into a generic helper; a bug in that helper reads `payload.proposerId` instead of `connection.user.id`. Vote/commit/meta-disagreement tests catch it; propose drift slips through review.

The invariant is correct today by inspection — `propose.ts` builds the `MethodologyAction.propose` with `actor: userId` where `userId = connection.user?.id`. The risk is regression, not present-day breakage. ADR 0022 (no throwaway verifications) is explicit: behaviors with security weight live as committed tests, not "obvious-by-inspection" claims in review.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-007 — source finding (Medium severity).
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) lines 158-285 — the handler. `connection.user.id` is captured at line 160 (`const userId = connection.user?.id;`) and used at line 280 (`actor: userId`); the payload is destructured at line 159 (`const { sessionId, expectedSequence, proposal } = envelope.payload;`) — no spoof-prone field is read.
- [`apps/server/src/ws/handlers/vote.test.ts`](../../../apps/server/src/ws/handlers/vote.test.ts) lines 711-761 — the existing actor-spoof pin on `vote`. This task mirrors that pattern beat-for-beat: subscribe → send envelope with extra identity-named field on payload → drain ack+broadcast → assert the appended event's `actor` is the authenticated user.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) lines 294-298 — `wsProposePayloadSchema = z.object({ sessionId, expectedSequence, proposal })`. Zod's default `z.object` strips unknown keys; even if the handler DID read `payload.proposerId`, the parser would have removed it before the handler saw it. Two layers of defense; the test pins both.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification of system behavior lands as a committed test. The "obvious-by-inspection" defense doesn't survive a refactor; the regression test does.

## Constraints / requirements

- **Test-only.** No edit to `propose.ts`, no edit to `wsProposePayloadSchema`, no edit to the dispatcher. If review surfaces a real spoof path, stop and report — don't fix under this task.
- **One Vitest case** placed inside the existing `describe('ws_propose_message — handler integration', ...)` block. Mirrors the structure of the four existing tests in the same file (memory pool, WS client plumbing, ack+broadcast drain).
- **Use the existing fixtures.** Re-use `FIXTURE_USER_ID` (the authenticated user), `OTHER_HOST_ID` (the spoofed id), `VISIBLE_SESSION_ID`, and `NODE_ID` already declared at the top of `propose.test.ts`. No new fixture ids.
- **Spoof EVERY plausible field name.** Add `proposerId`, `actor`, AND `requester` to the spoofed payload — a future refactor that names the helper variable any of those would otherwise slip past a narrowly-scoped test.
- **Mirror the vote test's structure exactly.** Same comment style, same drain-tolerant `for (let i = 0; i < 2; i++)` ack+broadcast read, same dual assertion (`actor === FIXTURE_USER_ID` AND `actor !== OTHER_HOST_ID`).
- **Verifications per ADR 0022.** One committed Vitest test. No ad-hoc probes.

## Acceptance criteria

- `apps/server/src/ws/handlers/propose.test.ts` contains one new `it('SECURITY: ignores any client-supplied …', …)` block, structurally identical to vote.test.ts's existing SECURITY case.
- Test count delta on the file: +1 (5 → 6).
- The test asserts both:
  - `appended.actor === FIXTURE_USER_ID` (the connection's authenticated user), AND
  - `appended.actor !== OTHER_HOST_ID` (NOT the spoofed id).
- `pnpm exec vitest run apps/server/src/ws/handlers/propose.test.ts` — green.
- `pnpm run check` — clean.
- `pnpm run test:smoke` — green.
- Task-completion ritual per [tasks/refinements/README.md](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Spoof field names: `proposerId`, `actor`, `requester` (three of them).** A future refactor's bug could read any of these; the vote test pins only `voterId` because the existing engine vocabulary uses that label, but for propose the parallel name `proposerId` is the obvious first guess and `actor` / `requester` are the methodology-engine field names. Spoofing all three is a one-line addition to the payload that catches a wider regression surface.
- **Asserting the appended event, not the engine action.** The engine's `validateAction` is exercised via the methodology unit tests; the WS-handler-integration test asserts the persisted side-effect (the row in `store.events`). The chain from `connection.user.id` → `action.actor` → `event.actor` runs through the engine; pinning the END of the chain catches any drift along it.
- **Mirroring vote.test.ts, not commit/meta-disagreement.** All three are equivalent for the pattern; `vote.test.ts:711-761` is the cleanest existing template (lowest surrounding-test-noise). The refinement explicitly mentions vote as the model so the diff is reviewable.
- **No new fixture ids.** `OTHER_HOST_ID` is already declared in `propose.test.ts` for the not-found gate test (where it hosts a private hidden session). Re-using it as the spoofed id is correct because we want the test to spoof a *real-looking* user id that the handler could in principle mistake for an authorized actor.
- **No production-code change.** The handler is already correct by inspection; the schema is already closed by default. This is purely the regression-pin G-007 calls for.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:
- `apps/server/src/ws/handlers/propose.test.ts` — one new `it('SECURITY: ignores any client-supplied `proposerId` / `actor` field on the payload …', …)` block. Mirrors the vote-handler's existing SECURITY case at `vote.test.ts:711-761`. The test sends a `propose` envelope with extra `proposerId` / `actor` / `requester` keys on the payload, drains the `proposed` ack + `event-applied` broadcast, and asserts the appended event's `actor` is `FIXTURE_USER_ID` (NOT the spoofed `OTHER_HOST_ID`).
- `tasks/25-backend-hardening.tji` — `complete 100` added to `actor_spoof_propose_pin`. `tj3 project.tjp` parses silent.
- No production-code change: `propose.ts` was already correct by inspection (`actor: userId` where `userId = connection.user?.id`); `wsProposePayloadSchema` strips unknown keys by default. The test pins both layers as a regression-defense.

Test count delta: 5 → 6 `it(...)` blocks in `propose.test.ts`. `pnpm run check` and `pnpm run test:smoke` both pass.
