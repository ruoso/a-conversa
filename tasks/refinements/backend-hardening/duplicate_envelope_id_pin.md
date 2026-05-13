Source: docs/security/m3-review/coverage.md G-009

# Pin the duplicate-envelope-`id` wire behavior (no wire-layer dedupe)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.duplicate_envelope_id_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `backend.websocket_protocol.ws_message_envelope` (settled — produced the dispatcher this task pins behavior on); `backend.websocket_protocol.ws_propose_message` (settled — produced the `propose` handler whose append+sequence flow is what the second copy collides with).

## What this task is

A TEST-ONLY, limitation-pin task. Add one Vitest `it(...)` block to [`apps/server/src/ws/handlers/propose.test.ts`](../../../apps/server/src/ws/handlers/propose.test.ts) that pins the **current**, **documented limitation**: the server does NOT dedupe inbound envelopes by their `id` field — a client that sends the same `propose` envelope twice in succession sees:

1. **First copy**: succeeds (the appended `proposal` lands at `expectedSequence + 1`, the `proposed` ack arrives with `inResponseTo` = the shared envelope id, the `event-applied` broadcast fires).
2. **Second copy** (identical `id`, identical `expectedSequence`, identical payload): fails with a `sequence-mismatch` wire `error` — because the engine's optimistic-concurrency check sees MAX(sequence) has advanced past the carried `expectedSequence`.

The case lives inside a dedicated `describe('ws_propose_message — known trade-off: no wire-layer dedupe by envelope `id` (G-009)', ...)` block (or equivalently a leading-comment `it(...)` if the file's prevailing pattern prefers an inline pin — mirror the `actor_spoof_propose_pin` shape so the file stays consistent). The leading block comment is the auditor-readable record of:

- This pin documents **current** behavior, not desired behavior.
- This is an **accepted limitation** with one review reference: `docs/security/m3-review/coverage.md` G-009.
- **No wire-layer dedupe today.** The dispatcher (`apps/server/src/ws/dispatcher.ts`) trusts the inbound `id` and does not maintain a `(connectionId, envelope.id)` seen-set. Replay protection lives at the engine layer via `expectedSequence`: the first copy advances MAX(sequence); the second carries the stale `expectedSequence` and is rejected as `sequence-mismatch`.
- **Trade-off shape.** The methodology-engine reject is a server-side defense against replay-as-double-append, but it is not the *intended* dedupe surface — a future audit might want `(connectionId, envelope.id)` dedupe at the wire layer so the wire surface itself becomes idempotent (a clean `code: duplicate-envelope` envelope rather than the semantic `sequence-mismatch` overload). That future task is named `wire_dedupe` (see Decisions §"Future-task naming"); this test is the audit anchor that closes the **coverage** half of G-009 today.

## Why it needs to be done

G-009 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md):

> There is no test asserting the server's behaviour when a client sends two `propose` envelopes with the same `id` field — does it process both? Does it correlate `inResponseTo` correctly when a client forges `inResponseTo: <random-uuid>` on a C→S frame? The dispatcher trusts the inbound `id`; an attacker could replay a `propose` envelope and the server would process it twice (different proposals at sequence N+1, N+2). The sequence allocator catches the actual race, but the `proposed` ack on the second copy returns `sequence-mismatch` — what should be a server-side dedupe is instead a methodology-engine reject.
>
> **Adversarial scenario**: Replay attack against an idempotent-looking action: client sends `propose { id: X }`, network glitches, client retries with same `id`, attacker MITM injects a third copy. Without server-side dedupe by `(connectionId, envelope.id)`, the second-and-third arrive as fresh proposals.
>
> **Suggested test**: `dispatcher.test.ts` case — same envelope sent twice in succession. Today's behaviour should be pinned (likely "both processed; second gets sequence-mismatch"); the test makes the behaviour explicit so any future refactor sees the contract.

The structural fix (wire-layer dedupe by `(connectionId, envelope.id)` + a clean `duplicate-envelope` error code) is a future task with non-trivial scope (registry per connection + LRU eviction policy + replay-window decision + integration with the dispatcher's `onUnknownType` / `onHandlerError` seams). This task is the cheap pin that closes the **coverage** half of G-009 today, so:

- An auditor running `grep -r "G-009" apps/server` finds the test, reads the leading comment, and learns the trade-off is documented and intentional rather than overlooked.
- The CI suite carries a positive signal that two identical `propose` envelopes produce a specific (succeed, sequence-mismatch) pair — so when `wire_dedupe` eventually lands and the SECOND copy should produce a `duplicate-envelope` error envelope (or be silently dropped, TBD by that task's refinement), the inverted assertion makes the regression obvious and the diff is mechanical.
- ADR 0022 requires every empirical claim about system behavior to land as a committed test; this test is the empirical claim "duplicate-id envelope: first succeeds, second rejects with `sequence-mismatch`."

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-009 — source coverage gap (Medium severity, "today's behaviour should be pinned").
- [`apps/server/src/ws/dispatcher.ts`](../../../apps/server/src/ws/dispatcher.ts) — the dispatcher. No `id`-keyed registry; no replay window; no per-connection seen-set. `dispatch(envelope, connection)` looks up the handler by `envelope.type` and calls it. The dispatcher's docblock explicitly does not mention dedupe; the absence is the surface this test pins.
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts) lines 200-312 — the transactional load-validate-append flow. `expectedSequence` is compared against the in-transaction MAX(sequence) at line 243; mismatch raises `rejectedToApiError({ ok: false, reason: 'sequence-mismatch', … })`, which the dispatcher's `onHandlerError` surfaces as a wire `error` envelope with `code: 'sequence-mismatch'`.
- [`apps/server/src/ws/handlers/propose.test.ts`](../../../apps/server/src/ws/handlers/propose.test.ts) — the test file the new case joins. The existing `'rejects a stale expectedSequence with a sequence-mismatch wire error'` case (lines 530-555) is the closest pattern — both pins assert the same `sequence-mismatch` code, but from different setups: the existing test simulates a stale client view by carrying `expectedSequence=2` against MAX=3; this new test simulates a client that retries the SAME envelope after its first copy already advanced MAX.
- [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts) — `wsEnvelopeSchema` validates the `id` as a UUID v4 string but does not enforce uniqueness; the parser passes two envelopes with identical `id` through identically.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical verification of system behavior lands as a committed test. The pinning of "no wire-layer dedupe" is the empirical claim.
- [`tasks/refinements/backend-hardening/README.md`](./README.md) — the backend-hardening refinement convention; the leading "Source: …" line is the audit-trail anchor.
- [`tasks/refinements/backend-hardening/logout_no_revocation_pin.md`](./logout_no_revocation_pin.md) — the structural template for limitation-pin tasks. This refinement mirrors its shape (auditor-readable leading comment + cross-reference to the future structural-fix task + explicit invert-the-assertion-when-fix-lands instruction).

## Constraints / requirements

- **TEST-ONLY.** No production code changes. The dispatcher at `dispatcher.ts` and the propose handler at `propose.ts` stay intact. The test only documents what they currently do.
- **Auditor-readable leading comment.** The new test (or its enclosing `describe`) opens with a comment that:
  - States this pins **current** behavior.
  - Names the review reference: `coverage.md` G-009.
  - States explicitly that there is NO wire-layer dedupe by `envelope.id` today; replay protection lives at the engine layer via `expectedSequence`.
  - Names the future structural-fix task (`wire_dedupe`, hypothetical at refinement-write time — see Decisions §"Future-task naming") so a maintainer who later lands wire-layer dedupe knows this test must be updated.
- **Use the existing fixtures.** Re-use `FIXTURE_USER_ID`, `VISIBLE_SESSION_ID`, `NODE_ID`, `SUB_MSG_ID`, `PROPOSE_MSG_ID` already declared at the top of `propose.test.ts`. No new fixture ids; the shared envelope id IS the contractual surface being pinned.
- **Use the existing `makeProposePool` + `buildHandlerApp` + `openWsClient` harness.** Same memory pool, same WS client plumbing, same drain-tolerant ack+broadcast read as every other `propose.test.ts` case. No new helper, no new mock.
- **Pin the WHOLE round-trip, not pieces.** A single `it(...)` that:
  1. Opens a WS connection, drains `hello`.
  2. Subscribes to `VISIBLE_SESSION_ID`, drains the `subscribed` ack.
  3. Sends a `propose` envelope with `id = PROPOSE_MSG_ID`, `expectedSequence = 3` (matches the seed's MAX).
  4. Drains the `proposed` ack + `event-applied` broadcast (tolerant of either order, mirroring the existing happy-path test). Asserts the `proposed` ack's `inResponseTo === PROPOSE_MSG_ID`.
  5. Sends **the EXACT same `propose` envelope** (identical `id = PROPOSE_MSG_ID`, identical `expectedSequence = 3`, identical proposal payload).
  6. Drains an `error` envelope. Asserts `inResponseTo === PROPOSE_MSG_ID` (the dispatcher correlates the error to the duplicate-id envelope) AND `payload.code === 'sequence-mismatch'`.
  7. Asserts the store has exactly ONE new `proposal` event for `VISIBLE_SESSION_ID` (sequence 4) — the second copy was rejected before the append.
- **Single test, one describe (or one inline `it`).** Splitting into multiple `it(...)`s would dilute the pin and require duplicate setup; the trade-off is a single behavior with a single set of assertions.
- **No new exports, no new module.** The test consumes only the existing public surface of `propose.ts` and the existing test harness.
- **Verifications per ADR 0022.** Vitest unit test under `apps/server/src/ws/handlers/`, in the same file as the surface it pins.

## Acceptance criteria

- `apps/server/src/ws/handlers/propose.test.ts`:
  - New `it(...)` block (preferred — matches the file's existing per-case structure) immediately following the existing `'rejects a stale expectedSequence with a sequence-mismatch wire error'` case. Title shape: `'KNOWN-LIMITATION: pins no wire-layer dedupe by envelope id — first copy succeeds, second copy fails with sequence-mismatch (G-009)'`.
  - Leading inline comment names `coverage.md` G-009, states "no wire-layer dedupe today," names `expectedSequence` as the replay-protection mechanism, and names the future `wire_dedupe` task as the structural fix.
  - A single `it(...)` case that: subscribes, sends `propose` with shared id, drains `proposed` ack + `event-applied` (asserting `proposed.inResponseTo === PROPOSE_MSG_ID`), re-sends the EXACT same envelope, drains the `error` envelope (asserting `inResponseTo === PROPOSE_MSG_ID` AND `payload.code === 'sequence-mismatch'`), asserts the event store contains exactly one new `proposal` for the session.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest case; all pass.
- Task-completion ritual per [`tasks/refinements/README.md`](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit. The commit message follows the convention specified in the task brief.

## Decisions

- **Intentional limitation-pin.** This task is a TEST that documents an **accepted** limitation, not a fix. The structural fix (wire-layer dedupe) lives in a separate `wire_dedupe` task (see "Future-task naming" below). Landing the pin first is the cheaper / faster half of G-009's two-part closure; the auditor's "is this overlooked or accepted?" question is answered today, the runtime behavior is changed when the dedupe task ships.
- **Future-task naming.** The structural-fix task is called `wire_dedupe` in the comment / refinement cross-references. It does NOT yet exist in `tasks/25-backend-hardening.tji` — the G-009 coverage finding is the placeholder; creating the structural-fix task is out of scope for this refinement (it would need its own scope/decision pass on the registry shape, LRU policy, and replay-window decisions). The cross-reference names the future task by its **intended** identifier so when it lands, `grep -r wire_dedupe` finds this pin.
- **Test placement: `propose.test.ts`, not `dispatcher.test.ts`.** The G-009 finding suggests `dispatcher.test.ts`, but the load-bearing assertion (second copy rejected with `sequence-mismatch`) is engine-layer behavior bubbling through the propose handler — placing the test next to the existing `'rejects a stale expectedSequence'` case keeps "what the propose handler does on stale sequence" and "what the propose handler does on duplicate-id replay" in the same cognitive frame. A reader of `propose.test.ts` sees both `sequence-mismatch` paths and the relationship between them. A dispatcher-level test could only assert "two envelopes were dispatched"; it couldn't assert the WHY-it-rejected-on-the-second.
- **Single test, not a parametrised matrix.** The trade-off has one shape — "duplicate id + duplicate expectedSequence: first succeeds, second hits sequence-mismatch." Splitting into "duplicate across different `type`s," "duplicate across same `type` different payload," "triplicate" etc. would multiply identical-shape assertions without adding signal. One `it(...)` keeps the invert-the-assertion future task to a one-line diff.
- **The leading comment is the audit-trail anchor, not just commentary.** An auditor reading the test file is the primary intended reader. The comment is structured so `grep -r "G-009" apps/server/src/ws/handlers/` lands directly on it; the trade-off is named ("no wire-layer dedupe today"); the replay-protection mechanism is named (`expectedSequence`); the future-task identifier (`wire_dedupe`) is named so the next maintainer doesn't have to reason from scratch.
- **Cross-reference the future task by name only (no tji path or refinement path).** Unlike `logout_no_revocation_pin` — which cross-references a task that ALREADY exists with both a tji path and a refinement path — the structural-fix task for G-009 does not yet exist. Naming only the identifier (`wire_dedupe`) is honest about the state of the world; once the structural-fix task lands, that task's refinement will cross-reference this pin in the reverse direction (the load-bearing direction is here-to-future via `grep`).
- **Assert `inResponseTo` on both the `proposed` ack AND the `error` envelope.** Today the dispatcher carries `envelope.id` through both the success path (handler builds the ack with `inResponseTo: envelope.id`) and the error path (`onHandlerError` builds the error envelope with `inResponseTo: envelope.id`). Asserting both pins the "correlation works even when two C→S envelopes carry the same id" property — a reader of the test sees that the client receives TWO server frames both bearing the same `inResponseTo`, one ack and one error. This is the auditor-readable proof that the duplicate id is propagated faithfully rather than mangled or de-duplicated server-side.
- **Assert exactly one new event in the store.** Without this assertion, a hypothetical future bug (e.g., the handler somehow appends twice for the duplicate id but the second `proposed` ack races with the second `sequence-mismatch` error) would still pass the wire-level checks. Pinning the store count gives the test a load-bearing assertion about the **persisted** side-effect, not just the wire-level reply shape.
- **No new constants, no helper extraction.** The test consumes `FIXTURE_USER_ID`, `VISIBLE_SESSION_ID`, `NODE_ID`, `SUB_MSG_ID`, `PROPOSE_MSG_ID`, `subscribeFrame`, `annotateProposeFrame` — all already imported / declared in this file. Adding a "sendDuplicateAndCollectFrames" helper would obscure the four-step round-trip; keeping it inline matches the file's prevailing style.
- **The invert-instruction lives in the test comment, not in the future-task refinement.** The future `wire_dedupe` task's refinement WILL also reference this test (acceptance criteria: "invert the G-009 pin"), but the load-bearing direction is here-to-future: a maintainer working on the dedupe task reads this test first (it appears in the diff that adds the dedupe registry), sees the inversion instruction, and updates accordingly. The reverse direction would require the maintainer to remember to come back, which is fragile.
- **No `inResponseTo`-forgery sub-test.** G-009's finding also names "forged `inResponseTo` on inbound frames" as an unexercised behavior, but `inResponseTo` is a C→S-direction concept only on `error` envelopes (today no C→S handler reads it). The dispatcher does not interpret a client-supplied `inResponseTo`; it would be a no-op-then-ignored field. Pinning that the field is ignored would require either a contrived handler or a parametrised-over-every-type test — out of scope for the cheap-pin variant. If the inResponseTo-forgery concern resurfaces in a future review, that's a separate task with its own refinement.

## Open questions

(none — all decided)

## Status
