Source: docs/security/m3-review/coverage.md G-016

# Test: pin `DiagnosticBus` synchronous-dispatch contract

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.protocol_test_pinning.diagnostic_sync_dispatch_pin`
**Effort estimate**: 0.25d
**Inherited dependencies**: `data_and_methodology.diagnostics.diagnostic_event_emission` (settled — produced the `DiagnosticBus` whose dispatch contract this task pins) and `backend.websocket_protocol.ws_diagnostic_broadcast` (settled — produced the `WsDiagnosticBroadcast.notifyForSession` wrapper whose context-window correctness depends on the bus's sync contract).

## What this task is

A TEST-ONLY task. Add Vitest cases that pin the **current**, **load-bearing** synchronous-dispatch contract of `DiagnosticBus.notify(...)`:

> When `bus.notify(prev, next)` returns, every fired/cleared listener registered on the bus has FULLY EXECUTED — not just been scheduled. There is no microtask queue, no `await`, no `setImmediate` between the call and the listeners' completion.

Two test sites, one shared invariant:

1. **Bus-level** ([`apps/server/src/diagnostics/event-emission.test.ts`](../../../apps/server/src/diagnostics/event-emission.test.ts)) — pin the contract on the bus primitive. Register a listener that sets a sentinel `ran = true` and would, if dispatch were async, *also* schedule a microtask. Call `bus.notify(...)`. Assert the sentinel is set **synchronously**, i.e. immediately after `notify` returns and BEFORE any `await` / microtask drain. Use an `async ()` listener that internally awaits a `Promise.resolve()` after setting the sentinel: a sync bus IGNORES the returned promise and the sentinel is set + the test reads it synchronously; a hypothetical future async bus that did `await listener(entry)` would drain the microtask before returning, but the sentinel-set-time invariant is unchanged — so the test is strengthened with a second sentinel set INSIDE the awaited microtask, which a sync bus DOES NOT see set by `notify`'s return time (the microtask hasn't run yet) but an async-aware bus would. The combined assertions wedge the bus into "sync dispatch, ignore promise returns."

2. **Wrapper-level** ([`apps/server/src/ws/broadcast/diagnostic.test.ts`](../../../apps/server/src/ws/broadcast/diagnostic.test.ts)) — pin the context-window correctness this contract underwrites. Inside a `fired` listener, capture `wrapper.getActiveContext()`. Call `wrapper.notifyForSession(SESSION_A, 42, [], [entry])`. Assert: (a) the listener observed `{sessionId: SESSION_A, sequence: 42}` (set BEFORE `bus.notify` ran), and (b) `wrapper.getActiveContext()` returns `undefined` immediately after `notifyForSession` returns synchronously (cleared in `finally` BEFORE return). The two assertions together pin that the set/clear window is fully contained in the synchronous call.

The block's leading comment is the auditor-readable record of:

- This pins the **current** sync-dispatch contract on which `notifyForSession`'s context-window depends.
- The source finding is `docs/security/m3-review/coverage.md` G-016.
- **If a future refactor makes the bus async-aware** (e.g., `await listener(entry)` in `notify`'s loop, or queueing dispatch to a microtask), this test MUST be updated to assert the new contract — including a new test that the context-window is re-aligned with the new dispatch shape (the wrapper would need to switch to an async-local store or a per-call closure to preserve attribution). **The test IS the canonical doc**; updating it is the structural step that surfaces the cross-cutting change to reviewers.

No production-code change. If review surfaces a real async-leakage bug (i.e., the bus today already returns before listeners complete), STOP and surface as a separate finding rather than silently fixing under a TEST-ONLY task.

## Why it needs to be done

G-016 in [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) is the source finding:

> The `notifyForSession` wrapper sets active context, calls `bus.notify`, and clears in `finally`. If `bus.notify` invokes handlers asynchronously (today it's sync per the doc, but a future refactor could change this), the context would be cleared before the listeners read it. No test pins the synchronous-dispatch contract.
>
> **Adversarial scenario**: A future refactor of `DiagnosticBus.notify` to async would silently break the session-attribution; broadcasts for session A could be tagged with session B's context.

The contract is correct today by inspection — `DiagnosticBus.notify` in [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts) lines 401-419 iterates `firedListeners` / `clearedListeners` and calls each `listener(entry)` synchronously, ignoring any returned promise; `WsDiagnosticBroadcast.notifyForSession` in [`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts) lines 320-332 sets `#activeContext` BEFORE the call and clears it in `finally`. The risk is regression — a contributor adding `await` to support an async-emitting listener, or refactoring to queue dispatch through `Promise.resolve()` / `queueMicrotask`, would break the context-window in a way that no other test catches.

ADR 0022 (no throwaway verifications) is explicit: behaviors with security weight live as committed tests, not "obvious-by-inspection" claims in review. The sync-dispatch contract here is the foundation of the cross-session non-leak property already covered by [`tests/behavior/backend/ws-diagnostic.feature`](../../../tests/behavior/backend/ws-diagnostic.feature) — but that Cucumber scenario tests the END-TO-END isolation, not the FOUNDATION it rests on. An async refactor could PASS the Cucumber scenario in a single-listener single-call test universe and still race in production where two `notifyForSession` calls overlap. The bus-level pin catches the refactor at the primitive layer; the wrapper-level pin catches it at the context-window layer.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-016 — source coverage gap (Medium severity). Names both halves: the bus-level sync contract AND the wrapper-level context-window dependence on it.
- [`apps/server/src/diagnostics/event-emission.ts`](../../../apps/server/src/diagnostics/event-emission.ts) lines 332-419 — `DiagnosticBus` class. The leading comment (lines 332-346) explicitly states "Synchronous dispatch, no error handling. A throwing listener throws back to the `notify` caller. The bus is a low-level primitive; ergonomic concerns (async dispatch, error containment, per-listener filtering) belong on the broadcaster's wrapper, not here." The test pins this comment as executable contract.
- [`apps/server/src/ws/broadcast/diagnostic.ts`](../../../apps/server/src/ws/broadcast/diagnostic.ts) lines 270-333 — `WsDiagnosticBroadcast`. The class comment (lines 270-291) explicitly states "The wrapper's contract: 1. Set the active context… 2. Call `bus.notify(prev, next)` — synchronous dispatch fires the registered `fired` / `cleared` listeners… 3. Clear the active context in `finally`." Lines 41-56 of the module comment underscore: "The pattern is safe because `DiagnosticBus.notify(...)` dispatches SYNCHRONOUSLY. The `notifyForSession(...)` call returns AFTER the last listener finished; the active-context holder is cleared in a `finally` so a thrown listener doesn't leak context to a subsequent notify call."
- [`apps/server/src/diagnostics/event-emission.test.ts`](../../../apps/server/src/diagnostics/event-emission.test.ts) lines 524-603 — the existing `describe('DiagnosticBus', …)` block. The new bus-level case sits inside or adjacent to this block.
- [`apps/server/src/ws/broadcast/diagnostic.test.ts`](../../../apps/server/src/ws/broadcast/diagnostic.test.ts) lines 396-426 — the existing `describe('WsDiagnosticBroadcast — wrapper invariants', …)` block. The new wrapper-level case sits inside this block.
- [`tests/behavior/backend/ws-diagnostic.feature`](../../../tests/behavior/backend/ws-diagnostic.feature) — the cross-session non-leak Cucumber coverage that this pin underwrites. NOT modified by this task; named here so the reader can see why the foundation pin is load-bearing.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — the discipline ADR. The test is the verification, committed; no ad-hoc probe.
- [`tasks/refinements/backend-hardening/README.md`](./README.md) — the work-stream index. This task is one of the `protocol_test_pinning` leaves.

## Constraints / requirements

- **TEST-ONLY.** No production code changes. `DiagnosticBus.notify` and `WsDiagnosticBroadcast.notifyForSession` stay intact. The tests only document what they currently do. If a real async-leak bug surfaces, STOP and report — don't fix under this task.
- **Two test sites, one shared invariant.** The bus-level pin lives in `event-emission.test.ts`; the wrapper-level pin lives in `diagnostic.test.ts`. Splitting reflects the layered ownership (bus owns sync dispatch; wrapper owns context-window) and keeps each test next to the surface it pins.
- **Auditor-readable leading comments.** Each new `describe`/`it` block opens with a comment that:
  - Names the source finding `coverage.md` G-016.
  - States the test pins **current** contract, not desired contract.
  - States explicitly that a future async-refactor of the bus must update this test to assert the new contract — and that the test IS the canonical doc of the dispatch shape.
- **The bus-level test must distinguish sync from async dispatch beyond a single sentinel.** A naive "set `ran = true` synchronously, await nothing" probe would pass under a hypothetical async-aware bus that `await`s each listener before returning — because the `await` resolves immediately and the sentinel IS set when `notify` returns. The discriminating shape is to register an `async` listener that sets a sync sentinel AND a microtask sentinel; after `notify` returns, assert the sync sentinel is set BUT the microtask sentinel is NOT yet set. A future async-aware bus that drains the listener's promise would set BOTH; the assertion would fail and the test would surface the refactor.
- **The wrapper-level test must capture the active context from INSIDE the listener.** Reading `wrapper.getActiveContext()` from outside the listener (after `notifyForSession` returns) only proves the clear half; the test must also prove the set half — i.e., that listeners observe the context during dispatch. A listener that captures `wrapper.getActiveContext()` into an outer-scoped variable, plus an assertion on that variable after `notifyForSession` returns, pins both halves.
- **Use existing fixtures + helpers.** Re-use `cycleEntry` / fixture session/connection ids in `diagnostic.test.ts`; re-use the existing helpers / fixtures in `event-emission.test.ts`. No new mocks, no new helper extractions.
- **Single `describe` per site is fine.** A new `describe('DiagnosticBus — synchronous-dispatch contract (G-016)', …)` block in `event-emission.test.ts` and a new `describe('WsDiagnosticBroadcast — synchronous-dispatch context window (G-016)', …)` block in `diagnostic.test.ts`. Keeps the G-016 anchor greppable from both files.
- **Verifications per ADR 0022.** Vitest unit tests under `apps/server/src/`, in the same files as the surfaces they pin.

## Acceptance criteria

- `apps/server/src/diagnostics/event-emission.test.ts`:
  - New `describe('DiagnosticBus — synchronous-dispatch contract (G-016)', ...)` block (appended at the file's end, after the existing `DiagnosticBus` describe).
  - Leading block comment names `coverage.md` G-016 and the "this test IS the canonical doc; update on async refactor" instruction.
  - One `it(...)` case covering the discriminating-sentinel pattern: an `async` listener that sets `syncSentinel = true` synchronously then `await`s a microtask that sets `microtaskSentinel = true`. After `bus.notify(...)` returns, assert `syncSentinel === true` AND `microtaskSentinel === false`. Then `await Promise.resolve()` (or a tiny `setTimeout`) to drain the microtask queue and assert `microtaskSentinel === true` as a positive control (so the test doesn't pass by accident if the listener never runs).
  - A second `it(...)` case asserts that when listeners return promises, those promises are NOT awaited by `bus.notify`: register two listeners that resolve different sentinels at different microtask depths; after `notify` returns, neither microtask sentinel is set. (This is the "ignore returned promise" half of the sync contract.)

- `apps/server/src/ws/broadcast/diagnostic.test.ts`:
  - New `describe('WsDiagnosticBroadcast — synchronous-dispatch context window (G-016)', ...)` block (appended after the existing `WsDiagnosticBroadcast — wrapper invariants` describe).
  - Leading block comment names `coverage.md` G-016 + the same "canonical doc / async-refactor" instruction.
  - One `it(...)` case that registers a `fired` listener that captures `wrapper.getActiveContext()` into an outer-scoped slot, calls `wrapper.notifyForSession(SESSION_A, 42, [], [cycleEntry()])`, and asserts:
    1. The captured-during-dispatch context is `{sessionId: SESSION_A, sequence: 42}`.
    2. `wrapper.getActiveContext()` after the call returns `undefined` (cleared in `finally`).
    3. The full window — set → fire → clear — happened synchronously (i.e., the captured context is available at assertion time WITHOUT awaiting anything).
  - A second `it(...)` case that registers an `async` listener (which returns a promise) and asserts that `notifyForSession` STILL clears the context before returning — pinning that an async-RETURNING listener does not stretch the context window past `notifyForSession`'s sync return. (This is the wrapper-level mirror of the bus-level "ignore returned promise" pin.)

- `tasks/25-backend-hardening.tji`: `complete 100` added on `diagnostic_sync_dispatch_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.
- `## Status` block appended to this refinement on completion.
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new Vitest cases; all pass.

## Decisions

- **Two test sites, not one.** The contract has two layers — the bus's "I dispatch synchronously" and the wrapper's "I set + clear the context inside the sync window." Pinning only the bus leaves the wrapper's context-window dependence unstated; pinning only the wrapper depends on the bus's contract without asserting it. Two tests, two layers, two greppable G-016 anchors — a maintainer touching either file sees the constraint.

- **Discriminating-sentinel pattern, not a single boolean.** A naive sentinel ("did the listener run before `notify` returned") passes under both sync dispatch AND a hypothetical async-aware bus that `await`s listeners — because `await listener()` of an immediately-resolving function returns in the same microtask tick. The discriminator is the GAP between "the listener body started executing" and "every promise the listener returned has resolved." Sync dispatch sees the former but not the latter at `notify`'s return time; async-aware dispatch sees both. The test pins that distinction explicitly.

- **A positive-control microtask drain at the end of the bus test.** Without it, a refactor that simply DOESN'T CALL THE LISTENER would also make `microtaskSentinel === false` pass. Asserting the microtask sentinel flips to `true` after a microtask drain proves the listener body actually ran end-to-end.

- **Capture context from INSIDE the listener, not outside.** The wrapper test must prove the set-half AND the clear-half. Reading `wrapper.getActiveContext()` after `notifyForSession` returns only proves the clear. The set-half is the load-bearing one — without it, the listener could read `undefined` and the fan-out would log a "missing context" warn (per the defensive missing-context path already tested at lines 428-447 of `diagnostic.test.ts`). The combined assertion (captured-during-dispatch + cleared-after) pins both halves.

- **The async-RETURNING listener test is a pin on what the wrapper does NOT promise.** Some readers may assume `notifyForSession` waits for async listeners (it doesn't — the bus ignores the returned promise, so the wrapper does too transitively). Documenting this explicitly forecloses a future "I'll just make my listener async" pitfall that would silently leave the context cleared before the async work completes.

- **The test IS the canonical doc; the comment names this explicitly.** The two ADRs the test references (0022 + the bus's source comment) live in two locations; the dispatch contract lives in one comment block in `event-emission.ts`. A future maintainer changing the bus's dispatch shape MUST update this test — that's the structural surface that forces the cross-cutting change into reviewers' field of view. Naming this in the leading comment is what converts "obvious-by-inspection" into "you cannot land the refactor without dealing with this assertion."

- **No production-code change today, even if review surfaces an opportunity.** This task is scoped to pin current behavior; if a real bug or refactor opportunity surfaces, file it as a separate task. Keeping TEST-ONLY tasks TEST-ONLY keeps the audit-trail clean (the commit's diff is regression-only; the security review can verify "no behavioral change shipped in this audit-closure pass" by reading file types alone).

- **No new Cucumber scenarios.** `ws-diagnostic.feature` already covers the end-to-end cross-session non-leak. Adding a "sync dispatch" Cucumber scenario would duplicate the unit-test coverage at higher cost. The bus's dispatch shape is pure-logic per ADR 0022 layer routing → Vitest, not Cucumber.

- **Use vitest's `async ()` test wrapper for the bus-level test, but assert synchronously.** The two-sentinel pattern requires `await Promise.resolve()` at the end to drain the microtask queue for the positive control. That makes the `it(...)` function itself `async`, but the load-bearing assertions (sync sentinel set, microtask sentinel NOT set) happen IMMEDIATELY after `bus.notify(...)` returns, BEFORE any `await`. The shape is `bus.notify(...)` → assertSync → `await Promise.resolve()` → assertDrained. This is the only place an `await` is allowed and it's strictly for the positive control.

## Open questions

(none — all decided)

## Status

**Done — 2026-05-11.**

Artifacts:

- [`apps/server/src/diagnostics/event-emission.test.ts`](../../../apps/server/src/diagnostics/event-emission.test.ts) — appended `describe('DiagnosticBus — synchronous-dispatch contract (G-016)', ...)` with the auditor-readable leading comment naming the source finding and the "this test IS the canonical doc; update on async refactor" instruction. Two `it(...)` cases: (1) the discriminating-sentinel pattern — an `async` listener sets a sync sentinel then awaits a microtask that sets a second sentinel; after `bus.notify(...)` returns, the sync sentinel is set, the microtask sentinel is NOT, then a `await Promise.resolve()` drains the queue as a positive control; (2) two `async` listeners at different microtask depths, asserting neither microtask sentinel is set at `notify`'s return but both flip after a drain.
- [`apps/server/src/ws/broadcast/diagnostic.test.ts`](../../../apps/server/src/ws/broadcast/diagnostic.test.ts) — appended `describe('WsDiagnosticBroadcast — synchronous-dispatch context window (G-016)', ...)` with the parallel leading comment. Two `it(...)` cases: (1) a fired listener captures `wrapper.getActiveContext()` into an outer-scoped slot at fire time; after `notifyForSession(SESSION_A, 42, ...)` returns synchronously the slot is `{sessionId: SESSION_A, sequence: 42}` AND the wrapper's context is cleared — pinning both the set-half and the clear-half of the window in one synchronous boundary; (2) an `async` listener captures the context twice (during dispatch and after a microtask) — sync capture shows the set context, post-microtask capture shows `undefined`, pinning that the wrapper's context window does NOT extend to cover async-listener continuations. Added `type DiagnosticBroadcastActiveContext` import.
- [`tasks/25-backend-hardening.tji`](../../25-backend-hardening.tji) — `complete 100` added on `diagnostic_sync_dispatch_pin`. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Test count delta: `event-emission.test.ts` 21 → 23 `it(...)` blocks (+2); `diagnostic.test.ts` 16 → 18 (+2). Total +4. `pnpm install && npx vitest run apps/server/src/diagnostics/event-emission.test.ts apps/server/src/ws/broadcast/diagnostic.test.ts` → 41/41 passing.

**Note for the maintainer landing a future async-refactor of `DiagnosticBus`**: the bus-level test's second sentinel (`microtaskSentinel === false` at `notify`'s return) is the load-bearing assertion that fails first under any refactor that awaits listener promises. The wrapper-level test's `duringDispatch` capture is the load-bearing assertion that fails first under any refactor that defers `bus.notify`'s listener calls past a microtask boundary. Both tests' leading comments name the next-step structural work (re-aligning the wrapper's single-slot context holder with an async-local store or per-call closure) so the refactor's diff surfaces the cross-cutting change to reviewers — that's the load-bearing role of this pin.
