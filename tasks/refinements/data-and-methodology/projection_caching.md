# Cache active projections per session; release on idle

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.projection_caching`
**Effort estimate**: 1d
**Inherited dependencies**: `project_incrementally` (settled — `applyEventIncremental`, `OutOfOrderEventError`, the `ProjectionChange` change-feed contract, and the per-projection `lastAppliedSequence` field all landed). `project_from_log` (settled — `projectFromLog(events, sessionId)` is the rehydration entry point).

## What this task is

Implement the per-session in-memory cache of active projections. The server holds one live `Projection` per open session. Sessions that haven't been touched recently get evicted; the next call rehydrates from `session_events` via `projectFromLog`. The cache itself is plumbing — the interesting decisions are lifecycle (when to evict), concurrency (don't double-hydrate on simultaneous first calls), and dependency-injection shape (the cache class doesn't import `pg`; the loader is passed in).

The cache is the seam between two downstream consumers: the methodology engine writes events and asks the cache to apply them; the WS broadcaster reads the resulting `ProjectionChange[]` and emits per-client deltas. Both wires land in their own tasks. This task delivers the cache they share.

## Why it needs to be done

[architecture.md — Storage](../../../docs/architecture.md#storage):

> In-memory graph projection per active session, rebuilt from the session's event log (joined against the global node/edge tables) on session load and updated as events stream in.

`projectFromLog` builds the projection on session load. `applyEventIncremental` updates it as events stream in. Neither tells you *which* projections are live in memory, when to release them, or how to recover from a release. That's this task. Without it, every WS connect would either (a) load the projection from scratch (wasteful, slow) or (b) leak — every session ever loaded stays resident forever.

## Inputs / context

- [`docs/architecture.md` — Storage](../../../docs/architecture.md#storage) — "in-memory projection per active session, rebuilt from the log on session load" is the spec.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts) — `projectFromLog(events, sessionId)` builds the projection from a sequence-ordered event log.
- [`apps/server/src/projection/incremental.ts`](../../../apps/server/src/projection/incremental.ts) — `applyEventIncremental(projection, event)` updates a live projection and returns a `ProjectionChange[]`.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — the `Projection` class; the cached value type.
- [`apps/server/src/events/validate.ts`](../../../apps/server/src/events/validate.ts) — `validateEvent` is what the loader runs each row through to type DB-shaped events.
- [`tests/behavior/support/event-rows.ts`](../../../tests/behavior/support/event-rows.ts) — the `rowToValidatedEvent` + `selectEvents` helpers the Cucumber scenario reuses to build a real-DB `EventLoader`.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — two committed test layers: Vitest with an injected stub loader for the cache lifecycle, Cucumber + pglite for the real-DB rehydration scenarios.
- Prior round-7 refinement entries that flag downstream consumers (methodology engine, WS broadcaster) as separate tasks.

## Constraints / requirements

- Lives at `apps/server/src/projection/cache.ts`; re-exported from `apps/server/src/projection/index.ts`.
- The cache class does NOT import `pg` directly. It takes an `EventLoader: (sessionId: string) => Promise<Event[]>` callback in its constructor. The production wiring (a `pg`-driven `EventLoader`) is delivered by `backend.api_skeleton`; the Cucumber scenarios here build a thin pglite-driven loader for their own use.
- The cache's public surface is:
  - `getProjection(sessionId): Promise<Projection>` — return the cached entry, hydrating from the loader if absent; update `lastAccessedAt`.
  - `applyEvent(sessionId, event): Promise<ProjectionChange[]>` — hydrate (if needed), apply via `applyEventIncremental`, return the change feed, update `lastAccessedAt`.
  - `evict(sessionId): void` — drop the entry. Subsequent `getProjection` rehydrates.
  - `evictIdle(now: Date): void` — drop entries whose `lastAccessedAt` is more than `idleTimeoutMs` before `now`. Pull-shaped — callers schedule the periodic invocation themselves.
  - `size: number` — getter, for tests and introspection.
- Two internal maps:
  - `entries: Map<sessionId, { projection: Projection; lastAccessedAt: Date }>`.
  - `inFlight: Map<sessionId, Promise<Projection>>` — concurrent first-load deduplication.
- Constructor takes `{ loader: EventLoader; idleTimeoutMs?: number }`. Default `idleTimeoutMs` is `5 * 60 * 1000` (5 minutes).
- A failed hydration MUST NOT leave a poisoned `inFlight` entry. The `inFlight` Promise rejects; the next call retries. (Implementation: `try/finally` deletes the in-flight entry whether the hydration resolves or rejects.)
- No `setInterval` timer inside the cache class. `evictIdle(now)` is pull-shaped; a future `backend.api_skeleton` task wires the periodic call. The class stays test-friendly (deterministic, time injected via `now`) and free of teardown obligations.
- Tests per ADR 0022: Vitest at `apps/server/src/projection/cache.test.ts` with stub loaders; Cucumber at `tests/behavior/projection/cache.feature` with step defs at `tests/behavior/steps/projection-cache.steps.ts` using pglite.
- No comments beyond non-obvious WHY (per house style).
- Don't pre-empt: the methodology engine writes events; the WS broadcaster reads the change feed; both consume this cache, neither's wiring lives here.

## Acceptance criteria

- `apps/server/src/projection/cache.ts` exports `ProjectionCache` and `EventLoader`.
- `apps/server/src/projection/index.ts` re-exports both.
- Vitest tests at `apps/server/src/projection/cache.test.ts` cover:
  - First `getProjection` triggers the loader; second uses the cached entry without invoking it.
  - Two concurrent `getProjection` calls de-duplicate to one loader invocation.
  - `applyEvent` after `getProjection` advances `lastAppliedSequence` without re-loading, and returns the change feed.
  - `applyEvent` on an un-cached session hydrates first.
  - `evict(sessionId)` removes the entry; the next `getProjection` re-invokes the loader.
  - `evictIdle(now)` drops idle entries and preserves fresh ones (boundary + both sides).
  - `size` reflects active entries.
  - A slow loader: concurrent `applyEvent` waits for the in-flight hydration.
  - A throwing loader: the `inFlight` entry is cleared on rejection; the next call retries.
  - Property-style: a randomized sequence of `getProjection` / `applyEvent` / `evict` / `evictIdle` keeps the cache invariant ("every entry's projection has been hydrated to a known sequence; the cache size equals the number of entries that haven't been evicted").
- Cucumber + pglite scenarios at `tests/behavior/projection/cache.feature`:
  - Scenario: rehydrate from a real DB after eviction (load `empty` fixture; build a `pg`-shaped loader against pglite; `getProjection`; assert 4 events applied; `evict`; `getProjection` again; equivalent projection re-issued).
  - Scenario: `applyEvent` updates the cached projection without reload (instrumented loader proves no extra invocation; one inserted participant-joined event applied; participant count +1).
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp` parses clean.
- `tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added.

## Decisions

- **Eviction policy: idle-timeout only for v1; default 5 minutes.** A pragmatic minimum. LRU + max-size could land later, but the timeout is enough to bound resident memory for a server with bursty session activity. Five minutes balances "evict promptly when no one is looking" against "don't evict mid-debate when activity is paused for a moderator decision". The constant is a constructor option so tests override it (sub-second timeouts) and the production wiring can tune it without a code change.
- **Pull-shaped eviction (`evictIdle(now)`), no internal timer.** A `setInterval` inside the class makes the class harder to test (a hidden timer that needs cleanup), couples lifecycle to module load order, and forces a teardown contract on the cache. The pull shape stays deterministic — tests call `evictIdle(now)` with an injected `now`; the server task that consumes the cache schedules the periodic call. This mirrors the same shape `applyEventIncremental` chose for its sequence-gap check (caller-driven, no hidden background work).
- **Concurrent hydration deduplication via `inFlight: Map<sessionId, Promise<Projection>>`.** First caller's `getProjection` for an absent session creates a hydration Promise and registers it in `inFlight`. Concurrent callers find the in-flight Promise and await it. On resolution the cache entry is set; the `inFlight` entry is deleted (in a `finally`, so a rejected hydration also clears it). This avoids two simultaneous loader calls — wasteful even when the loader is cheap — and avoids the more dangerous case where both calls successfully load AND both successfully call `applyEvent` (racing each other to update `lastAppliedSequence`).
- **Failed hydration clears `inFlight` and propagates.** The `try { ... } finally { inFlight.delete(sessionId) }` pattern ensures a thrown loader (or a validation error during the per-row `validateEvent` walk) leaves no poisoned entry. The next call retries cleanly. The rejection itself propagates to the caller — recovery is the caller's call.
- **Dependency-injected `EventLoader`.** `EventLoader = (sessionId: string) => Promise<Event[]>` is the only dependency the cache class takes. The cache does not know about `pg`, pglite, transactions, or SQL. Production wiring (a `pg`-driven loader that runs `SELECT ... FROM session_events WHERE session_id = $1 ORDER BY sequence ASC` and runs each row through `validateEvent`) lands with `backend.api_skeleton`. The Cucumber tests here write a thin pglite-flavoured loader for their own use; that loader is not exported as production code.
- **`applyEvent` returns the change feed; no EventEmitter here.** The pragmatic minimum is "return the `ProjectionChange[]` and let the caller (the methodology engine) hand it to the broadcaster." An EventEmitter-style `onEvent(sessionId, listener)` is a clean shape, but it's the broadcaster's seam, not the cache's — adding it now would pre-empt that task's interface choices. The change feed is the contract; the cache passes it through.
- **The cache hydrates synchronously-on-demand, not pre-emptively.** A session-open event does not warm the cache; the first `getProjection` call does. The eventual moderator-and-debater-join handshake will produce a `getProjection` (to render the initial state) at the moment the cache needs the projection anyway. Pre-emptive warming would couple the cache to lifecycle signals it doesn't need.
- **The cache stores `Projection` instances by reference.** No copying, no immutable snapshots. The cache hands the same `Projection` object back on every `getProjection` call until it's evicted. The methodology engine and the WS broadcaster both work against this single live instance; `applyEventIncremental` mutates it in place. (The replay primitive — `data_and_methodology.replay_primitive.project_at_position` — needs a separate, throwaway projection at a specific log position; that task does its own `projectFromLog` against a sliced log and does NOT go through the cache. Document is enough; no code coupling needed today.)
- **`getProjection` returns the cached projection even if `lastAppliedSequence` doesn't equal the latest DB sequence.** The cache is a memo, not a synchronizer. The methodology engine is the only writer to the cache: it appends an event to `session_events` AND calls `applyEvent` on the cache. The two stay in lockstep because the methodology engine is the single owner of the write order. If a separate process inserts an event into `session_events` directly (e.g. a maintenance script), the cache is stale — but that is a "don't do that" constraint, not a "the cache must detect drift" requirement. (Re-fetching the log on every `getProjection` would defeat the cache's purpose.)
- **Cucumber scenarios use a thin pglite-shaped `EventLoader` defined in the step file.** The loader runs `selectEvents` (shared helper) against the World's pglite handle and maps each row through `rowToValidatedEvent`. The fixture's pre-tightened payloads need a tolerance path: the empty fixture's `participant-joined` events carry an extra `participant_id` field that the current `validateEvent` strips (Zod's default is `passthrough`), so each row validates cleanly. (If a future fixture stopped validating, the loader would surface the error at hydration time — which is the correct failure mode.)

## Open questions

- **LRU + max-size eviction.** Not in v1. The idle-timeout alone bounds memory under predictable session-count loads; once we have empirical data on how many sessions stay live concurrently, we can add a max-size cap and an LRU eviction policy on top. Additive; not load-bearing for the methodology engine or the broadcaster. (Judgment call: ship the timeout; revisit when we have a real workload to size against.)
- **EventEmitter-style `onEvent` on the cache.** Cleaner than threading change feeds through the methodology engine to the broadcaster, but the broadcaster doesn't exist yet. Whether the seam lives on the cache or the engine is the broadcaster task's call; the cache exposes the change feed today, which works for either future. (Judgment call: defer to `backend.ws_surface` / `backend.api_skeleton`.)
- **Cache warming on snapshot resolution.** When `replay_primitive.snapshot_resolution` runs, it produces a throwaway projection at a snapshot's log position. We could warm the cache with that projection — but the snapshot projection is at an older log position than the live one, and warming the cache with it would create staleness. Best policy: snapshot resolution and live cache stay independent. (Judgment call: settled, no work needed here.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/projection/cache.ts` — `ProjectionCache` class + `EventLoader` type. Public surface: `getProjection(sessionId)`, `applyEvent(sessionId, event)`, `evict(sessionId)`, `evictIdle(now)`, `size` getter. Internal `Map<sessionId, CachedEntry>` for the live projections; `Map<sessionId, Promise<Projection>>` for in-flight hydrations. Default `idleTimeoutMs = 5 * 60 * 1000` (5 minutes). The `try { ... } finally { inFlight.delete(sessionId) }` pattern in `#hydrate` ensures a failed loader doesn't poison subsequent calls.
- `apps/server/src/projection/index.ts` — barrel re-exports `ProjectionCache`, `EventLoader`, `ProjectionCacheOptions`.

Tests:

- `apps/server/src/projection/cache.test.ts` — 14 cases. Coverage: hydration on first access; cached return on subsequent access; concurrent first-load deduplication (exactly one loader call); concurrent applyEvent waits on in-flight hydration; applyEvent advances `lastAppliedSequence` without re-loading; applyEvent on un-cached session hydrates first; OutOfOrderEventError propagates and cache state survives; evict drops entry, next get re-hydrates; evict on absent session is a no-op; `evictIdle` boundary (far-future drops; recent access survives; refreshed-by-getProjection survives the same `now`); throwing loader rejects + cleans `inFlight`; concurrent calls during throwing hydration share the rejection; randomized property invariant over 200 ops with two sessions (cache size never exceeds session count; lastAppliedSequence equals tracked apply count after every op).
- `tests/behavior/projection/cache.feature` — 2 scenarios + step defs in `tests/behavior/steps/projection-cache.steps.ts`. Coverage: rehydrate from real DB after eviction (loader invoked twice across hydration + rehydration; equivalent participant set); applyEvent updates the cached projection without reload (loader invoked exactly once; participant count goes 3 → 4 after a fresh participant-joined event is INSERT-then-applied).

Test deltas:

- Vitest: +14 (283 → 297). 10 test files, 297 passed.
- Cucumber: +2 (49 → 51). 51 scenarios, 234 steps, all passed.
- Playwright: 1 (unchanged).

`pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `projection_caching`. Per `tasks/refinements/README.md` the projection sub-stream is now fully `complete 100`-marked; the parent `projection` task and the `data_and_methodology` milestone in `tasks/99-milestones.tji` are not the closing dependents (other sub-streams remain), so no further milestone propagation needed in this commit.
