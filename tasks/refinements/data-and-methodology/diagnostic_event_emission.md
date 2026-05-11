# Emit diagnostic-fired events to subscribers

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.diagnostic_event_emission`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.diagnostics.cycle_detection`, `contradiction_detection`, `multi_warrant_detection`, `dangling_claim_detection`, `coherency_hint_detection` (all settled). Transitively: `data_and_methodology.projection.projection_caching` — the cache owns the projection mutation point that drives the diagnostic recomputation. Indirectly: `pending_consequences_stub` (settled — explicitly deferred from this task per the WBS note and its own refinement).

## What this task is

Make the diagnostic detectors *observable*. The five settled detectors (`detectSupportsCycles`, `detectContradictions`, `detectMultiWarrants`, `detectDanglingClaims`, `detectCoherencyHints`) all return pure-read result lists against the projection. After each mutation (each `applyEventIncremental`) the diagnostic set may change — a new cycle appears, an old contradiction goes away after a `break-edge`. This task delivers:

1. A **unified `DiagnosticEntry` discriminated union** (`kind: 'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'`) that wraps each detector's per-entry payload under a single envelope.
2. A **`computeAllDiagnostics(projection): DiagnosticEntry[]`** aggregator that calls all five detectors and concatenates their output in a fixed order.
3. A **`diffDiagnostics(prev, next): { fired: DiagnosticEntry[]; cleared: DiagnosticEntry[] }`** function that compares two snapshots by **stable identity keys** per diagnostic kind and emits "fired" entries (in `next` and not in `prev`) and "cleared" entries (in `prev` and not in `next`).
4. A **`DiagnosticBus`** class — an in-process pub/sub abstraction. Subscribers register via `on('fired' | 'cleared', listener)`; the bus's `notify(prev, next)` runs `diffDiagnostics` and dispatches the appropriate listeners. No network, no DB, no persistence.

The file lives at `apps/server/src/diagnostics/event-emission.ts` alongside the five detectors. The eventual WS broadcaster (`backend.ws_surface`, not yet landed) will subscribe to a `DiagnosticBus` and turn `fired` / `cleared` events into WS messages; that wiring is downstream. **`pending-consequences` is deliberately excluded** per its own refinement's "stub" framing — the detector exists and is callable, but it is NOT wired into this task's aggregator or `DiagnosticBus`.

## Why it needs to be done

The five detectors are pure read functions today; nothing fires them, nothing subscribes to changes in their output. Without this task:

- The moderator UI cannot react when a new cycle appears mid-debate without polling each detector after every event.
- The eventual WS broadcaster has no abstraction to subscribe to — it would need to either know about each detector individually or open-code the diff-then-broadcast logic.
- The `blocking_vs_advisory_classification` sibling (last diagnostics task, depends on this one's output indirectly) has no unified entry shape to classify.

Per `docs/data-model.md` line 165 ("Structural diagnostics") the diagnostics are how the methodology engine surfaces structural problems back to the moderator. The data model says nothing about *how* those surface — that is this task's call.

The WBS calls these "events," which raised the architectural question below. The chosen answer (Option B — in-process pub/sub, NOT persisted as a new `session_events.kind`) keeps the event log focused on *authored* events (state changes by participants) and treats diagnostics as a *derived view* of the projection — they are re-computable on replay and don't need their own event-log row.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) line 165 ("Structural diagnostics") — the umbrella heading. The five sibling refinements each cite their specific paragraph.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 100–104 — the active-firing rule and the explicit "pending consequences out of scope for v1" deferral that motivates excluding pending-consequences from this aggregator.
- [`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts) — `detectSupportsCycles(projection): SupportsCycle[]`. Per-entry shape: `{ nodes: string[] }`.
- [`apps/server/src/diagnostics/contradiction-detection.ts`](../../../apps/server/src/diagnostics/contradiction-detection.ts) — `detectContradictions(projection): Contradiction[]`. Per-entry: `{ nodeA: string; nodeB: string; edges: string[] }` (canonical-lexicographic-ordered pair).
- [`apps/server/src/diagnostics/multi-warrant-detection.ts`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — `detectMultiWarrants(projection): MultiWarrant[]`. Per-entry: `{ dataNodeId: string; claimNodeId: string; warrantNodeIds: string[] }` (warrant ids sorted lexicographically).
- [`apps/server/src/diagnostics/dangling-claim-detection.ts`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) — `detectDanglingClaims(projection): DanglingClaim[]`. Per-entry: `{ nodeId: string }`.
- [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — `detectCoherencyHints(projection): CoherencyHint[]`. A discriminated union over `HintKind`; per-variant payloads differ (`incomplete-warrant-missing-bridges-to` carries `warrantNodeId + dataNodeId`; `incomplete-warrant-missing-bridges-from` carries `warrantNodeId + claimNodeId`; `self-contradicts` carries `edgeId + nodeId`).
- [`apps/server/src/diagnostics/pending-consequences.ts`](../../../apps/server/src/diagnostics/pending-consequences.ts) — `detectPendingConsequences(projection): PendingConsequence[]`. **Deliberately excluded** from this task's aggregator per its own refinement's stub-framing.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — the `Projection` class the aggregator reads.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectionChange` discriminated union. **Not extended** by this task — diagnostic emission is a side-channel, not a `ProjectionChange` variant. See Decisions for the rationale.
- [`apps/server/src/projection/cache.ts`](../../../apps/server/src/projection/cache.ts) — the cache is where the WS broadcaster will eventually call `notify(prev, next)` after each `applyEvent`. This task does NOT modify the cache; it delivers the `DiagnosticBus` the cache (or its caller) will eventually wire into.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `eventKinds` enum. **Not extended** — no `'diagnostic-fired'` event kind lands in the session event log (Option A rejection, see Decisions).
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest unit tests for the in-memory algorithm (diff, aggregator, bus); Cucumber + pglite scenarios for the round-tripped event-log path.

## Constraints / requirements

- **Pure functions only**, except for `DiagnosticBus` which holds subscriber state. The aggregator and diff functions are pure reads.
- **`DiagnosticEntry` is a discriminated union over `kind`.** Each variant wraps the corresponding detector's per-entry shape under a `kind` discriminator + a `payload` field (or by inlining the payload fields — chosen below). Downstream consumers narrow on `kind` and access the per-variant payload.
- **No new `ProjectionChange` discriminators.** The change feed is for state mutations; diagnostics are derived and live on a separate channel.
- **No new `session_events.kind` values.** Diagnostics are NOT persisted as events. See Option A rejection in Decisions.
- **No modification of the projection layer.** The aggregator and diff read `Projection` through its existing public surface and the five detectors through their existing exports.
- **No modification of the cache.** The bus is a stand-alone abstraction; the cache wiring is deliberately deferred to a downstream task (`backend.api_skeleton` / `backend.ws_surface`) so this task doesn't pre-empt the broadcaster's interface choices.
- **`pending-consequences` excluded.** The aggregator does NOT call `detectPendingConsequences`; the `DiagnosticEntry.kind` union does NOT include `'pending-consequence'`. Per the pending-consequences-stub refinement: "Re-promoting it to a full diagnostic in a later release is wiring-only — no detection-logic work."
- **Stable identity keys per diagnostic kind.** The diff's correctness depends on a deterministic equality predicate; pointer equality is not safe (detectors return fresh objects each call). Each kind specifies its identity-key shape — see Decisions.
- **Order-independence.** `diffDiagnostics(prev, next)` does not care about list order — two `prev` lists with the same entries in different orders produce the same diff against the same `next`.
- **`DiagnosticBus` is a synchronous in-process EventEmitter-style abstraction.** No async, no queue, no backpressure. Listeners are invoked synchronously from `notify`; the bus catches no errors (a throwing listener propagates to the `notify` caller, who chose to register it).
- **Verifications per ADR 0022.** Vitest unit at `apps/server/src/diagnostics/event-emission.test.ts`; Cucumber + pglite scenarios at `tests/behavior/diagnostics/event-emission.feature` with step defs at `tests/behavior/steps/diagnostics-event-emission.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/event-emission.ts` exports:
  - `DiagnosticEntry` — discriminated union with `kind: 'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'`. Each variant inlines the detector's per-entry fields under the same envelope (see Decisions for the shape choice).
  - `DiagnosticKind` — string-literal type alias for the discriminator.
  - `computeAllDiagnostics(projection: Projection): DiagnosticEntry[]` — aggregator. Calls the five detectors in the fixed order: cycle, contradiction, multi-warrant, dangling-claim, coherency-hint. Concatenates the wrapped entries. Pure function; deterministic given a fixed projection.
  - `diffDiagnostics(prev: DiagnosticEntry[], next: DiagnosticEntry[]): { fired: DiagnosticEntry[]; cleared: DiagnosticEntry[] }` — by-identity-key diff. `fired` = entries in `next` whose identity key is NOT in `prev`. `cleared` = entries in `prev` whose identity key is NOT in `next`. Order-independent on the input lists; output order matches the input list's insertion order (fired follows `next`'s order; cleared follows `prev`'s order). Pure function.
  - `identityKeyFor(entry: DiagnosticEntry): string` — public helper exposing the per-kind identity-key (useful for tests and downstream consumers that want to deduplicate by identity outside the diff).
  - `DiagnosticBus` class:
    - `on(event: 'fired' | 'cleared', listener: (entry: DiagnosticEntry) => void): () => void` — register a listener; returns an unsubscribe function.
    - `notify(prev: DiagnosticEntry[], next: DiagnosticEntry[]): void` — run the diff, dispatch each `fired` entry to every `'fired'` listener and each `cleared` entry to every `'cleared'` listener. Listeners are invoked in registration order.
    - `listenerCount(event: 'fired' | 'cleared'): number` — introspection getter for tests.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `DiagnosticEntry`, `DiagnosticKind`, `computeAllDiagnostics`, `diffDiagnostics`, `identityKeyFor`, and `DiagnosticBus`.
- **Identity keys** (the diff's equality predicate):
  - `cycle`: the cycle's sorted node-id sequence joined with `\0` (canonical regardless of adjacency-walk start point). Two `SupportsCycle` entries with the same node set in any order are the same cycle.
  - `contradiction`: `{nodeA}\0{nodeB}` (the entries already carry canonical-lexicographic order via the detector). The `edges` array is informational only; identity is the node pair.
  - `multi-warrant`: `{dataNodeId}\0{claimNodeId}\0{sorted warrantNodeIds joined with \0}`. The (D, C) pair plus the warrant set. A multi-warrant entry that grows or shrinks its warrant set is a different diagnostic (cleared + fired).
  - `dangling-claim`: the node id directly.
  - `coherency-hint`: depends on the variant. For `incomplete-warrant-missing-bridges-to`: `incomplete-warrant-missing-bridges-to\0{warrantNodeId}\0{dataNodeId}`. For `incomplete-warrant-missing-bridges-from`: `incomplete-warrant-missing-bridges-from\0{warrantNodeId}\0{claimNodeId}`. For `self-contradicts`: `self-contradicts\0{edgeId}`. The leading `kind` substring keys the variant so two different hint kinds with overlapping ids can't collide.
- The kind prefix is also folded into every diagnostic's full identity key (`cycle\0...`, `contradiction\0...`, etc.) so an identity-key collision across kinds is impossible.
- Vitest tests at `apps/server/src/diagnostics/event-emission.test.ts` cover:
  - **`computeAllDiagnostics` — empty projection** → empty list.
  - **`computeAllDiagnostics` — one cycle** → one entry of `kind: 'cycle'`.
  - **`computeAllDiagnostics` — one cycle + one multi-warrant** → two entries; ordering matches the aggregator's fixed order (cycle before multi-warrant).
  - **`computeAllDiagnostics` excludes pending-consequences.** A projection that would produce a `PendingConsequence` (agreed edge with unagreed source) is NOT surfaced in the aggregator output.
  - **`diffDiagnostics([], [cycleA])`** → `fired = [cycleA]`, `cleared = []`.
  - **`diffDiagnostics([cycleA], [])`** → `cleared = [cycleA]`, `fired = []`.
  - **`diffDiagnostics([cycleA], [cycleA])`** (same identity) → both empty.
  - **`diffDiagnostics([cycleA], [cycleB])`** (different node sets) → `cleared = [cycleA]`, `fired = [cycleB]`.
  - **Identity-key cycle canonicalization.** Two `SupportsCycle` entries with the same node set in different adjacency-walk orders (`[A, B, C]` vs `[B, C, A]`) diff as identical.
  - **Multi-warrant identity is sensitive to the warrant set.** Adding or removing a warrant from the (D, C) group produces a cleared + fired pair.
  - **Contradiction identity is the node pair.** A contradiction whose `edges` array grows (the reverse-direction edge lands) is the same diagnostic — no spurious fired/cleared.
  - **Coherency-hint identity per variant.** Two different `incomplete-warrant-missing-bridges-to` hints (different `dataNodeId`) are different diagnostics; identical pairs are the same.
  - **`DiagnosticBus` — fired listener fires for each fired entry.**
  - **`DiagnosticBus` — cleared listener fires for each cleared entry.**
  - **`DiagnosticBus` — unsubscribed listener does not fire.**
  - **`DiagnosticBus` — multiple listeners on the same event are dispatched in registration order.**
  - **`DiagnosticBus` — `listenerCount` reflects the current registration set.**
- Cucumber + pglite scenarios at `tests/behavior/diagnostics/event-emission.feature` (2 scenarios):
  1. **Session progresses from no-diagnostic to having a cycle → diff reports the cycle fired.** Build a session where a cycle is constructed across events that round-trip through pglite's `session_events`. Project at the pre-cycle position and the post-cycle position; assert `diffDiagnostics(pre, post).fired` contains exactly one `kind: 'cycle'` entry whose node set matches.
  2. **Session has a cycle, then a `break-edge` is committed → diff reports the cycle cleared.** Build the same cycle; insert + apply a `break-edge` event sequence; project before and after. Assert `diffDiagnostics(withCycle, postBreak).cleared` contains exactly one `kind: 'cycle'` entry; `fired` is empty.
- Step defs at `tests/behavior/steps/diagnostics-event-emission.steps.ts`. UUID prefix `c7...` (free; the existing diagnostics step files cover `c1` through `c6`).
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `diagnostic_event_emission` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; the existing 536-vitest / 104-cucumber baseline is preserved and extended.

## Decisions

- **Architectural option: Option B (in-process subscription side channel). Option A (persist as `session_events.kind = 'diagnostic-fired'`) rejected.**
  The WBS calls these "events," which is consistent with two architectures: (A) a new `session_events.kind = 'diagnostic-fired'` row written each time a detector's output changes, with replay emitting the events from the log; or (B) an in-memory side channel that recomputes diagnostics after each `applyEventIncremental`, diffs against the previous set, and emits `fired` / `cleared` notifications to subscribers.

  **Option A is wrong** for two reasons. First, **diagnostics are derived, not authored.** They are a pure function of the projection state; they don't represent a state change a participant made. Persisting them to the event log would conflate "what happened" (authored events) with "what the system inferred from what happened" (derived diagnostics). The two have different invariants — the former is the canonical history that replay must round-trip exactly; the latter is recomputable. Putting derived data in the canonical log breaks the round-trip property (does the replay re-emit the diagnostic-fired events, or re-compute them?). Second, **Option A would require an `eventKinds` enum extension, a Zod payload schema for the diagnostic-fired row, a SQL CHECK constraint extension on `session_events.kind`, and a migration** — a major change for a derived view. The right home for derived views is the read side, not the write side.

  **Option B fits the existing primitives.** `computeAllDiagnostics` is a pure read; `diffDiagnostics` is a pure read; `DiagnosticBus` is a pub/sub side channel. The WS broadcaster (downstream task) will subscribe to the bus and emit per-client WS messages. Replay just re-computes the diagnostic set against the projection — no extra log rows to replay, no schema change.

- **`DiagnosticEntry` shape: inline payload fields under a single discriminator, not nested under `payload`.**
  Two shape options surveyed:
  - **Nested**: `{ kind: 'cycle'; payload: SupportsCycle }`. Consistent across kinds; the per-kind payload type is unchanged.
  - **Inlined**: `{ kind: 'cycle'; nodes: string[] }`. The detector's per-entry fields are members of the union variant.
  Chosen: **inlined.** Reason: the `CoherencyHint` discriminated union already inlines its per-variant payload (each variant has its own fields at the top level, not under `.payload`). The `ProjectionChange` discriminated union in `projection/types.ts` does the same. Inlining matches the existing house style and avoids a `entry.payload.nodes` indirection on the cycle variant. The kind discriminator is the top-level field; everything else is the per-variant payload.

- **Identity keys are strings, joined with `\0`.**
  Strings make `Map<string, DiagnosticEntry>` the natural diff implementation. The `\0` separator is unambiguous (UUID v4 strings never contain `\0`; the kind discriminator strings are ASCII). The cycle's identity is canonicalized by sorting the node-id list before joining — the adjacency-walk order varies test-to-test but the node set is stable, and the diff needs to recognize "same cycle, different walk" as identical.

- **Aggregator order: cycle → contradiction → multi-warrant → dangling-claim → coherency-hint.**
  Fixed order, declarative, matches the order the five sibling refinements landed in. The eventual UI may sort hints by severity (a downstream classifier task — `blocking_vs_advisory_classification`); the aggregator delivers a stable order that the classifier can re-rank.

- **Identity vs. content: the contradiction's `edges` array, the multi-warrant's `warrantNodeIds`, and the cycle's adjacency order are *content*, not *identity*.**
  - **Contradiction.** The `(nodeA, nodeB)` pair is identity; the `edges` array records which specific edges established the pair. A contradiction that gains its reverse-direction edge (one → two entries in `edges`) is the same diagnostic — the *pair is contradicting* hasn't changed, only the *redundancy* of the evidence. Without this, every reverse-direction edge would spuriously fire a "different contradiction" event.
  - **Cycle.** The node set is identity; the adjacency-walk order is one valid presentation of that set. Two cycles whose adjacency walks start at different nodes are the same SCC.
  - **Multi-warrant.** The (D, C) pair plus the warrant set is identity. Adding a warrant to a (D, C) group genuinely is a different diagnostic — the moderator UI should show "now W1, W2, AND W3 all warrant D → C" as an updated entry; emitting cleared + fired is the cleanest way to signal that, and downstream consumers can present it as an update if they want.

- **`DiagnosticBus` is synchronous, no error handling.**
  Listeners run inline; a throwing listener throws back to the `notify` caller. The bus is a low-level primitive — the WS broadcaster (or whatever subscribes) is responsible for its own error containment. An async / queued / catch-all bus would couple the abstraction to one specific consumer's needs; the broadcaster task can wrap the bus in whatever ergonomic shape it needs.

- **No internal "previous snapshot" state on the `DiagnosticBus`.**
  The bus's `notify(prev, next)` takes both snapshots explicitly. The caller (eventually the projection cache or the methodology engine) is responsible for tracking the previous diagnostic set. Stateless bus = trivially testable, no hidden cleanup obligations on session-end. The trade-off is that callers need to remember to thread the snapshot; that's a small cost compared to the alternative (a bus with a `Map<sessionId, DiagnosticEntry[]>` that leaks on session-end if the caller forgets to evict).

- **No cache-wiring in this task.** The cache currently exposes `applyEvent` which returns `ProjectionChange[]`. The natural place for the diagnostic recomputation is "after `applyEventIncremental`, before returning the change feed" — but that's a code change in the cache and pre-empts the broadcaster's interface decision (does the bus live on the cache? on a separate `MethodologyService`?). The bus is delivered as a stand-alone abstraction; the cache wiring lands with `backend.api_skeleton` or `backend.ws_surface`, whichever wires the bus first.

- **`pending-consequences` is excluded from the aggregator and the `DiagnosticEntry` union.** Per the pending-consequences-stub refinement: "in v1 it is NOT wired into `diagnostic_event_emission`." The detector remains callable for any future caller; re-promoting it is a one-line append to the aggregator's detector list and a new variant in the union.

- **Test layout (Vitest).** `apps/server/src/diagnostics/event-emission.test.ts`. Reuses the same TS-literal-event seeding pattern as the sibling detectors' tests. Tests build minimal projections via `applyEvent` and compare `computeAllDiagnostics` / `diffDiagnostics` output.

- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/event-emission.feature` + `tests/behavior/steps/diagnostics-event-emission.steps.ts`. Two scenarios per Acceptance criteria. UUID prefix `c7...`.

## Open questions

- **Does the bus belong on the projection cache or on a separate `MethodologyService`?** Open. Both are valid wiring locations; the broadcaster task will decide. This task delivers the bus as a stand-alone abstraction so the wiring decision is downstream.
- **Should `DiagnosticEntry` carry a `firedAt` / `clearedAt` timestamp?** Out of scope for v1. The bus passes the entry through to listeners; the broadcaster (or whoever else subscribes) can attach a timestamp at dispatch time. Folding timestamps into the entry would make the entries non-pure-from-projection (two `computeAllDiagnostics` calls would return entries with different timestamps), defeating the diff's structural-equality basis.
- **Should the bus deduplicate identical entries within the same `notify` call?** No. Each detector returns a deduped list (per its own refinement); the aggregator concatenates them; identity keys are unique across kinds (the kind prefix). If a detector ever returned duplicates the diff would treat them as a single key — that's the right behavior.
- **Severity / advisory grouping.** Out of scope. `blocking_vs_advisory_classification` (sibling task, last in the diagnostics work stream) classifies each `DiagnosticEntry` post-emission. The entry shape doesn't carry severity today; the classifier can attach it downstream without modifying this task's contract.
- **Re-promoting pending-consequences.** When v1.x decides to surface pending consequences, the work is: (a) append `detectPendingConsequences` to the aggregator's detector list; (b) add a `'pending-consequence'` variant to the `DiagnosticEntry` union; (c) define the identity key (`{edgeId}\0{sourceNodeId}` or similar — TBD by the future task). The current shape is forward-compatible.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/diagnostics/event-emission.ts` — new file. Exports the unified `DiagnosticEntry` discriminated union (kinds: `'cycle' | 'contradiction' | 'multi-warrant' | 'dangling-claim' | 'coherency-hint'`; per-variant payloads inlined under the kind discriminator, matching the existing house style for `CoherencyHint` and `ProjectionChange`), the `DiagnosticKind` type alias, the per-variant interfaces (`CycleDiagnosticEntry`, `ContradictionDiagnosticEntry`, `MultiWarrantDiagnosticEntry`, `DanglingClaimDiagnosticEntry`, `CoherencyHintDiagnosticEntry`), and the four operational primitives: `computeAllDiagnostics(projection)` (fixed-order aggregator over the five settled detectors; pending-consequences excluded per stub-framing), `diffDiagnostics(prev, next)` (identity-key-based set difference returning `{ fired, cleared }`), `identityKeyFor(entry)` (public per-kind canonical string key), and `DiagnosticBus` (stateless in-process pub/sub with `on('fired'|'cleared', listener)` → unsubscribe handle, `notify(prev, next)`, and `listenerCount(event)`). The bus snapshots its listener list before dispatch so a listener that unsubscribes itself doesn't disturb the iteration; new registrations from within a listener fire on the next `notify`.
- `apps/server/src/diagnostics/index.ts` — barrel re-exports the new public surface alongside the existing five detector exports.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `diagnostic_event_emission`.

Architectural choice (Option B, in-process subscription side channel) recorded in Decisions; Option A (persist as `session_events.kind = 'diagnostic-fired'`) rejected with the rationale documented (diagnostics are derived not authored; persisting derived data conflates "what happened" with "what was inferred"; would require schema/Zod/CHECK migration for a recomputable view).

Identity keys per diagnostic kind (canonicalization summary, per Acceptance criteria):

- `cycle`: `cycle\0<sorted node ids joined with \0>` — sorting canonicalizes adjacency-walk start point.
- `contradiction`: `contradiction\0<nodeA>\0<nodeB>` — the detector already returns canonical-lexicographic pair order; the `edges` array is content not identity.
- `multi-warrant`: `multi-warrant\0<dataNodeId>\0<claimNodeId>\0<sorted warrant ids joined with \0>` — adding/removing a warrant yields different identity.
- `dangling-claim`: `dangling-claim\0<nodeId>`.
- `coherency-hint`: `coherency-hint\0<hint kind literal>\0<per-variant fields>` — the hint kind literal disambiguates variants whose ids would otherwise overlap.

Every key carries the kind prefix so identity-key collisions across kinds are impossible.

Tests:

- `apps/server/src/diagnostics/event-emission.test.ts` — 21 Vitest cases across four groups. **`computeAllDiagnostics`** (4 cases): empty projection → empty list; one cycle → one entry; one cycle + one multi-warrant → at least two entries with cycle preceding multi-warrant in the aggregator's fixed order (the multi-warrant pattern incidentally surfaces a dangling-claim entry for the data node — the test asserts cycle and multi-warrant presence + relative order rather than total count, documenting the detector-interaction as expected); pending-consequences excluded (a projection that would produce a `PendingConsequence` produces no `'pending-consequence'`-kind entry — the union doesn't include that kind). **`diffDiagnostics` basics** (4 cases): empty→one fired; one→empty cleared; one→one no change; A→B clears A + fires B. **`diffDiagnostics` identity canonicalization** (5 cases): cycle walks over the same node set diff as identical; multi-warrant set-addition fires + clears; multi-warrant set-removal fires + clears; contradiction with one or two edges is the same diagnostic; coherency-hint variants are independent. **`DiagnosticBus`** (6 cases): fired listener fires per entry; cleared listener fires per entry; unsubscribed listener does not fire; multiple listeners dispatched in registration order; fired and cleared dispatched independently; `listenerCount` reflects current registration set; notify-with-no-changes dispatches no listeners.
- `tests/behavior/diagnostics/event-emission.feature` — 2 Cucumber + pglite scenarios. (1) A session that progresses from no-diagnostic to having a cycle: project partial chain → snapshot → add closing edge + substance commits → project full → diff reports one fired cycle entry covering {A, B, C} and no cleared entries. (2) A session that breaks a cycle: project closed cycle → snapshot → commit `break-edge` against C→A → project post-break → diff reports one cleared cycle entry covering {A, B, C} and no fired entries.
- `tests/behavior/steps/diagnostics-event-emission.steps.ts` — step defs. UUID prefix `c7...` (free; the existing diagnostics step files cover `c1` through `c6`). Lifecycle event ids live in the `900xxx` band to stay clear of the per-sequence `seq * 1000 + N` scheme (which can grow up to ~50_005 with the cycle scenario's proposal-vote-commit cycles per facet). Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`).

Test deltas:

- Vitest: 557 passed (was 536; +21 new event-emission cases).
- Cucumber: 106 scenarios passed (was 104; +2 new event-emission scenarios), 533 steps total.
- Playwright smoke: 1 passed (unchanged).

`pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green; `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent (clean parse).

The bus is delivered as a stand-alone abstraction; the cache wiring (where `bus.notify(prev, next)` will eventually be called after each `applyEvent`) is deliberately deferred to the broadcaster task (`backend.api_skeleton` / `backend.ws_surface`) so the interface choice (does the bus live on the cache? on a separate `MethodologyService`?) stays with that task.
