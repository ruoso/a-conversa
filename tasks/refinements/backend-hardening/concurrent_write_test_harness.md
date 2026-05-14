Source: docs/security/m3-review/coverage.md G-004 + G-018

# Concurrent-write test harness (pglite-spirit; deterministic interleaving)

**TaskJuggler entry**: [tasks/25-backend-hardening.tji](../../25-backend-hardening.tji) — task `backend_hardening.concurrency_safety.concurrent_write_test_harness`
**Effort estimate**: 2d
**Inherited dependencies**: `backend.websocket_protocol` (settled — provides the WS write handlers + the `appendSessionEvent` helper this harness drives) and `data_and_methodology.schema.session_events_table` (settled — provides the `UNIQUE(session_id, sequence)` constraint the test asserts is the second-line safety net).

## What this task is

Stand up an in-process test harness — a memory-backed `DbPool` that implements Postgres-shaped row-locking semantics (`FOR UPDATE` blocks other connections on the same row; `UNIQUE(session_id, sequence)` fires on duplicate INSERT) and exposes a controllable yield-point — and write 3 scenario tests that fire two concurrent write operations against the same resource and assert exactly one succeeds. Closes the G-004 (write-path races) and G-018 (no concurrent-write behavior coverage) gaps in `docs/security/m3-review/coverage.md`.

The harness is the deliverable, not the scenarios. Three scenarios is the scoped-down floor; the inventory in G-004 covers more surfaces (vote, commit, end-session, screen-name, include), and the harness is shaped so future tasks can add scenarios by composing the same primitives.

## Why it needs to be done

G-004 in [docs/security/m3-review/coverage.md](../../../docs/security/m3-review/coverage.md) is the source finding:

> ADR 0020 documents the FOR UPDATE + MAX(sequence) primary serialisation. Tests verify the BEGIN/COMMIT trace … No test fires two concurrent operations and asserts that exactly one wins. The FOR UPDATE + UNIQUE(session_id, sequence) safety net is unverified end-to-end.

G-018 is the Cucumber-layer mirror: no `tests/behavior/backend/concurrent-writes.feature` exists either. Together they leave every "exactly-one-writer-wins" security claim across the write surface uncovered by behavior tests.

Today the application invariant ("under contention, one writer wins, the other gets a typed error code") rests on three layers — application-managed `MAX(sequence)+1`, the `FOR UPDATE` row lock on `sessions`, and the `UNIQUE(session_id, sequence)` constraint — but no test exercises any of them under contention. A future refactor (e.g. moving the sequence allocator out of the transaction, dropping the FOR UPDATE clause "for performance", or changing the order of the role-availability check + INSERT) could silently break the invariant; the only signal would be a production incident.

The harness lets every future write-path change be validated against the contention surface as a one-line addition to the scenario file.

## Inputs / context

- [`docs/security/m3-review/coverage.md`](../../../docs/security/m3-review/coverage.md) G-004 + G-018 — source findings (High + Low; both Confirmed).
- [`apps/server/migrations/0010_session_events.sql`](../../../apps/server/migrations/0010_session_events.sql) — the `UNIQUE (session_id, sequence)` constraint. The migration's header documents the "safety net for concurrent writers" framing this harness validates.
- [`apps/server/src/events/append.ts`](../../../apps/server/src/events/append.ts) — the centralized append helper. Every write-path scenario routes through this; the harness intercepts the `INSERT INTO session_events` statement to enforce the UNIQUE constraint.
- [`apps/server/src/ws/handlers/propose.ts`](../../../apps/server/src/ws/handlers/propose.ts), `vote.ts`, `commit.ts`, `meta-disagreement.ts` — the WS write handlers and their `withTransaction(FOR UPDATE → MAX → INSERT)` shape.
- [`apps/server/src/sessions/routes.ts`](../../../apps/server/src/sessions/routes.ts) — the HTTP write surfaces (`POST /sessions/:id/end`, `POST /sessions/:id/participants`, `PATCH /sessions/:id/privacy`, `POST /sessions/:id/include`).
- [`apps/server/src/sessions/routes.test.ts`](../../../apps/server/src/sessions/routes.test.ts) — the existing memory-pool shim (sequential, no row-locking) the harness extends with locks + yield-points.
- [`apps/server/src/projection/cache.test.ts`](../../../apps/server/src/projection/cache.test.ts) — the deferred-promise pattern (manual `resolveLoader?.(...)`) used elsewhere for deterministic concurrency tests; the harness lifts the same idea.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — the tests land as committed Vitest cases per the unit-layer routing rule (pure JS + memory pool, no DB I/O).

## Constraints / requirements

- **Deterministic interleaving — no timing assumptions.** No `setTimeout(50)`-style "probably long enough" delays. The harness exposes an explicit yield-point API: a test calls `harness.gateOnInsert(sessionId)` to install a one-shot gate that pauses the next `INSERT INTO session_events` for that session until the test calls `release()`. The two competing transactions are awaited with `Promise.all`; the test orchestrates which one runs first by ordering its `release()` calls relative to its `await` points.
- **Real row-locking semantics.** `SELECT … FOR UPDATE` on a `sessions` row from connection A blocks any subsequent `SELECT … FOR UPDATE` on the same row from connection B until A commits or rolls back. The harness's lock manager is per-row, FIFO-fair, and reentrant within a transaction (matching Postgres's exclusive-lock semantics; we model only the subset the production handlers actually use).
- **Real UNIQUE(session_id, sequence) enforcement.** The harness's `INSERT INTO session_events` recogniser checks for a pre-existing `(session_id, sequence)` row before appending; on collision it throws a `UNIQUE-constraint-violation` error matching what `pg` surfaces. The handler's catch chain maps that to an `internal-error` 500 today; tests assert against that mapping AS THE CURRENT PINNED BEHAVIOR — if a future task introduces a typed `concurrent-write` envelope code, the assertion changes by one line.
- **Per-connection client isolation.** The harness implements `pool.connect()` so the production `withTransaction` path (with `BEGIN`/`COMMIT`/`ROLLBACK` against a dedicated client) is the path under test. The shim is structurally compatible with `DbPool` and exposes `connect()` for transaction-bound clients — the same code path that runs in production against `pg.Pool`.
- **ADR 0022 — no throwaway probes.** The harness AND its scenarios live in committed Vitest files. The harness itself has a self-test (`concurrent-write-pool.test.ts`) that pins the locking + UNIQUE semantics the scenarios depend on; a regression in the harness fails loud rather than silently letting a scenario pass for the wrong reason.
- **Scope: 3 scenarios at the floor.** Per the task brief's "scope down if needed" clause:
  1. **Concurrent `propose` envelopes on the same session** — exactly one succeeds; the other surfaces `sequence-mismatch` (FOR UPDATE serialised path) or the UNIQUE-violation `internal-error` fallback. Drives the WS handler + the harness's row-locking.
  2. **Concurrent participant-join requests for the same role slot** — exactly one succeeds; the other receives `role-already-filled`. Drives the HTTP route + the partial-unique-index pre-check.
  3. **Concurrent `end_session` requests on the same session** — exactly one succeeds; the other receives `session-already-ended`. Drives the host-only authority + idempotency check inside the locked transaction.
  Each scenario is a single `it(...)` block under a `describe('concurrent writes — <surface>')`. Two further scenarios (concurrent commit on the same proposal; concurrent screen-name pick for the same pending user) are documented in this refinement as follow-up tasks — they exercise the same harness primitives.
- **No new ad-hoc dependency.** The harness is plain TypeScript on top of the existing memory-pool pattern. No real-Postgres, no pglite per scenario (pglite serialises everything internally — see Decisions below).
- **Use `pnpm`.** All commands.

## Acceptance criteria

- A new module `apps/server/src/test-support/concurrent-write-pool.ts` exports `makeConcurrentWritePool(initial)` returning `{ pool, store, gateOnInsert, releaseGate, locks }`. The pool's `query` and `connect` surfaces match `DbPool` (production-shape); the helper APIs are test-only and not consumed by production code.
- A self-test `apps/server/src/test-support/concurrent-write-pool.test.ts` covers:
  - FOR UPDATE on a `sessions` row blocks a second `FOR UPDATE` on the same row from a different connection until the first transaction commits.
  - Two `INSERT INTO session_events` rows with the same `(session_id, sequence)` raise a `UNIQUE-constraint-violation` error on the second.
  - A `gateOnInsert(sessionId)` gate pauses the next `INSERT INTO session_events` matching the session until released.
  - A connection's `release()` releases its held locks (FIFO-fair: the next waiter unblocks).
- A scenario file `apps/server/src/test-support/concurrent-writes.test.ts` covers the three scenarios above. Each scenario:
  - Builds two independent `app` instances OR two independent operations against the same app — whichever path exercises the surface end-to-end.
  - Fires both operations with `Promise.all([opA, opB])`.
  - Uses the harness's gate API to interleave deterministically (no timing assumptions).
  - Asserts (a) exactly one wire/HTTP success response, (b) the other has the expected typed error code, (c) the in-memory store ended in the expected state (single new event row OR single new participant row).
- `pnpm run check` clean.
- `pnpm run test:smoke` includes the new files; all pass.
- Task-completion ritual per [tasks/refinements/README.md](../README.md): `complete 100` on the `.tji` task, `## Status` block appended to this refinement, single commit.

## Decisions

- **Harness shape: memory pool with row-locking, NOT pglite per scenario.** PGlite serialises every transaction internally (single global mutex); two `pool.transaction(...)` calls on the same handle queue, they don't interleave. So even though pglite gives us "real Postgres" SQL behavior, it can't produce real concurrent transactions — the second transaction simply waits. A pglite-backed harness would either (a) appear to test concurrency while only testing serial execution, or (b) require running TWO PGlite handles against independent in-memory DBs, which doesn't share state between the racers and so doesn't test the race surface either. A purpose-built memory pool with explicit per-row locks gives us real interleaving + deterministic control; the SQL-recogniser pattern is the same one `routes.test.ts` already uses.
- **Gate placement: `INSERT INTO session_events`, not `SELECT MAX(sequence)`.** The brief suggested injecting the delay between `SELECT MAX` and `INSERT`. We gate ON the INSERT instead: the FOR UPDATE row lock already serialises the MAX-then-INSERT pair within a single transaction (so a delay between them WITHIN one transaction doesn't open a race window — the second transaction is blocked at the FOR UPDATE). The race we want to expose is "transaction A holds the lock, runs MAX, computes nextSeq, calls INSERT — between INSERT and COMMIT, transaction B tries FOR UPDATE and waits — A commits — B unblocks, runs MAX, sees the NEW max, fails the optimistic-concurrency check." Gating ON the INSERT lets us pause A inside its transaction (after MAX, before INSERT) while B queues at the FOR UPDATE, then release A, let it commit, and watch B's optimistic check trip. This is the actual production race the FOR UPDATE protects against.
- **Test placement: Vitest, not Cucumber.** Per ADR 0007's layer-mapping (database-touching → Cucumber against pglite) the natural home is Cucumber. But pglite serialises every transaction (see decision 1), so a Cucumber backing doesn't test the race surface either. Vitest with the memory-locking pool is the only layer that gives us the assertion. G-018 calls for Cucumber coverage explicitly — we land the Vitest scenarios first (this task) and document a follow-up to lift them to Cucumber once a multi-connection pglite backing exists OR the test infra moves to compose Postgres for these specific scenarios.
- **Expected error code on the loser: `sequence-mismatch` (preferred path), `internal-error` (fallback path).** Per the propose handler's optimistic-concurrency check, the FOR UPDATE-serialised loser surfaces `sequence-mismatch`. The UNIQUE-constraint-violation path is the second-line safety net that fires if the FOR UPDATE were somehow bypassed; today it surfaces as `internal-error` (the catch chain maps unknown pg errors to a generic 500). The scenarios assert the preferred path (because FOR UPDATE works); a future task that introduces a typed `concurrent-write` code would invert the assertion in one line.
- **Two scenarios deferred to follow-up tasks** (under the same `concurrency_safety` parent in `25-backend-hardening.tji` or as defensive-pin entries): concurrent `commit` on the same proposal (proposal-state machine prevents double-commit; pinning needs a fixture that primes a proposal); concurrent screen-name pick for the same pending user (the conditional UPDATE's `WHERE screen_name = '<pending>'` is the natural mutex; exercising it needs the pending-cookie infrastructure). Both are tracked in the Open questions section. The 3 scenarios shipped cover the highest-value surfaces (the WS write path, the multi-step HTTP transaction, the host-only idempotent endpoint).
- **No `setTimeout` in the harness or scenarios.** Every "waiting" point is an `await` on a deferred Promise the test owns. The harness's gate API returns the resolver; the scenario's flow is `harness.gateOnInsert(id); const p1 = startWriteA(); await harness.waitForGate(); const p2 = startWriteB(); await harness.untilWaitingForLock(); harness.releaseGate(); const [resA, resB] = await Promise.all([p1, p2]);`. No clocks, no flakes.

## Open questions

- **Concurrent commit on the same proposal** — follow-up. Needs the proposal-priming fixture (a proposed event already in the store, both racers send `commit` for the same proposal). Mechanically straightforward against the harness; defers because the methodology-engine commit handler's invariant set is broader than what this task scopes.
- **Concurrent screen-name pick for the same pending user** — follow-up. The conditional UPDATE's `WHERE screen_name = '<pending>'` is the natural mutex; the second UPDATE matches zero rows and the handler returns `409 already-set`. The pattern doesn't need the row-locking harness — it's a straight UPDATE race. A simpler in-memory-row harness scenario covers it; the bigger harness here is overkill for that surface and the task's effort budget points us at the higher-value writers first.

## Status

**Done — 2026-05-11.**

Artifacts:
- `apps/server/src/test-support/concurrent-write-pool.ts` — the harness pool with per-row FOR UPDATE locking, per-connection client isolation, `UNIQUE(session_id, sequence)` enforcement on the events table, and a one-shot gate API (`gateOnInsert(sessionId)` + `releaseGate()` + `untilWaitingForLock()`).
- `apps/server/src/test-support/concurrent-write-pool.test.ts` — self-tests for the harness pinning: FOR UPDATE blocks; UNIQUE fires; the gate pauses + releases deterministically; lock release on COMMIT/ROLLBACK is FIFO-fair.
- `apps/server/src/test-support/concurrent-writes.test.ts` — three scenarios:
  1. Two concurrent `propose` envelopes for the same session → exactly one `proposed` ack, the other `sequence-mismatch`.
  2. Two concurrent `POST /sessions/:id/participants` for the same role slot → exactly one 200, the other 409 `role-already-filled`.
  3. Two concurrent `POST /sessions/:id/end` for the same session → exactly one 200, the other 409 `session-already-ended`.
- `tasks/25-backend-hardening.tji` — `complete 100` added to `concurrent_write_test_harness`. `tj3 project.tjp` parses clean.

Test count delta: the harness self-test added one new file (4 `it(...)` blocks); the scenarios added one new file (3 `it(...)` blocks). `pnpm run check` and `pnpm run test:smoke` both pass.
