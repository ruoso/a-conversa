# Detect multi-warrant patterns on the same (data, claim) pair

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.multi_warrant_detection`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.projection` (settled). Through it, `Projection.edges()`, `getNode`, `getEdge`, `visible` flags. Sibling: `cycle_detection` and `contradiction_detection` (settled — same diagnostics-module layout and pure-read pattern carry over). Indirectly: `coherency_hint_detection` (sibling, not yet landed) catches the **incomplete-warrant** shape (a `bridges-from` without a matching `bridges-to`, or vice versa); this task strictly handles the **two-or-more complete warrants on the same (D, C)** shape.

## What this task is

Detect **multi-warrant patterns** in a session's visible graph. Per [`docs/data-model.md`](../../../docs/data-model.md) line 187 ("Multiple competing warrants on one data→claim move"):

> When two or more warrants both bridge the same (data, claim) pair, and they assert different bridges, this is a strong signal that the claim is bundling multiple things. Each warrant is anchoring on a different aspect of the claim. The system highlights this pattern as a likely-decomposition prompt; the typical resolution is to decompose the claim into its components, after which each warrant attaches to a different component.

Per `docs/data-model.md` lines 122–131 ("Warrants and bridging"), a warrant `W` is an ordinary node that licenses the inference from data `D` to claim `C` through **two ordinary directed edges from the warrant**:

- An edge with role `bridges-from` from `W` to `D` (the data node).
- An edge with role `bridges-to` from `W` to `C` (the claim node).

The task delivers a **pure read function** over the projection: `detectMultiWarrants(projection: Projection): MultiWarrant[]` where `MultiWarrant = { dataNodeId: string; claimNodeId: string; warrantNodeIds: string[] }`. Each entry names a (data, claim) pair plus the list of warrant node ids that all bridge that pair. The function lives in `apps/server/src/diagnostics/`, alongside `cycle-detection.ts` and `contradiction-detection.ts`.

## Why it needs to be done

Per `docs/data-model.md` line 187: a multi-warrant pattern is "a strong signal that the claim is bundling multiple things." The pattern is methodologically informative — either two warrants redundantly anchor the same inference (in which case decomposition isn't called for, but the moderator can flag the redundancy) or each warrant anchors on a different aspect of the claim (the typical case, which is the decomposition prompt). Without the detector, the moderator UI has no read-side signal that the pattern exists; the methodology has no way to surface "look — there are two warrants here."

Downstream consumers: `diagnostic_event_emission` (M2 sibling) wires the detector's output into the event-stream surface; `blocking_vs_advisory_classification` (M2 sibling) classifies multi-warrant diagnostics alongside cycles / contradictions / dangling-claim / coherency-hint diagnostics. Both are separate tasks; this one delivers the detection logic only.

The boundary with `coherency_hint_detection` (sibling, not yet landed): the coherency-hint detector catches **incomplete** warrants — a warrant node with a `bridges-from` edge but no `bridges-to` (or vice versa). That's a shape problem that wants a "did you mean to finish wiring this warrant?" prompt. This detector handles **complete** warrants only (both edges present and visible). A warrant counted here has BOTH a `bridges-from` and a `bridges-to`; incomplete warrants are dropped from the (D, C) group on this pass.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) lines 122–131 ("Warrants and bridging") — the structural definition of a warrant: a regular node plus two outgoing edges from W (`bridges-from` to D, `bridges-to` to C). The "Toulmin step" is detected as a structural pattern when these three nodes and two edges co-occur.
- [`docs/data-model.md`](../../../docs/data-model.md) line 187 ("Multiple competing warrants on one data→claim move") — the diagnostic definition.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 110–120 — edge-role catalog including `bridges-from` and `bridges-to`. All edge roles are directed (source → target).
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection.edges()`, `getNode`, `getEdge`, `getEdgesBySource`. The detector uses `getEdgesBySource(warrantNodeId)` to look up the warrant's outgoing edges efficiently (the source-index lookup is O(1) per warrant; without it, the detector would re-walk `edges()`).
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge` (`role`, `sourceNodeId`, `targetNodeId`, `visible`), `ProjectedNode`.
- [`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts) and [`contradiction-detection.ts`](../../../apps/server/src/diagnostics/contradiction-detection.ts) — sibling templates. The module layout, pure-read shape, visibility filter, and barrel pattern carry over. The visibility filter pattern (skip edges whose endpoints are absent or invisible) directly applies.
- [`tasks/refinements/data-and-methodology/cycle_detection.md`](./cycle_detection.md) and [`tasks/refinements/data-and-methodology/contradiction_detection.md`](./contradiction_detection.md) — sibling refinements. The "diagnostics module lives alongside projection," "no error type — empty graph → empty array," "no diagnostic event emission / classification (out of scope)" decisions all transfer.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit + Cucumber+pglite integration.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Structural-only filter — no substance-agreement gate.** Per `docs/data-model.md` line 187, the diagnostic fires on the **structural pattern** of two or more warrants on a (D, C) pair. Unlike cycle and contradiction detection (which gate on `isEdgeActive` because cycles in unagreed-substance supports edges aren't "circular reasoning" yet and contradicts edges have to actually fire), the multi-warrant signal is about argument structure: even if the warrants' substance is still being debated, the participants are anchoring multiple bridging rules on the same data→claim move, which is exactly the methodological signal worth surfacing. See the Decisions section for the full rationale and citation.
- **Filter to visible edges only.** `edge.visible === true`. Broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate. Per `docs/data-model.md` lines 287–293 invisible edges don't participate in any structural reasoning.
- **Filter to complete warrants only.** A warrant `W` counts toward the (D, C) group iff it has BOTH a visible `bridges-from` edge to D AND a visible `bridges-to` edge to C. Incomplete warrants (only one of the two edges visible) are dropped on this pass; the `coherency_hint_detection` sibling task surfaces those.
- **A warrant with multiple `bridges-from` or multiple `bridges-to` edges.** A warrant can in principle have several `bridges-from` edges (it bridges from multiple data nodes) or several `bridges-to` edges (it bridges to multiple claims). The detector treats each (data, claim) combination separately: warrant W with edges `bridges-from W→D1`, `bridges-from W→D2`, `bridges-to W→C1`, `bridges-to W→C2` participates in four groups: (D1, C1), (D1, C2), (D2, C1), (D2, C2). Within each (D, C) group W is one warrant. Multiple warrants on the same (D, C) trigger the pattern.
- **Endpoint-node visibility.** Both endpoint nodes of each warrant edge (W, D, C) must be visible. The projection's visibility derivation cascades endpoint visibility onto edges (a node going invisible flips its incident edges invisible too), so a visible edge with an invisible endpoint shouldn't happen — but the detector defensively skips that case rather than throwing, matching the sibling detectors' pattern.
- **(D, C) groups with ≥ 2 warrants are emitted.** A single warrant on a (D, C) pair is the normal Toulmin shape — not a diagnostic. The pattern needs at least two warrants on the same pair to fire.
- **Warrant-node-id list is sorted lexicographically.** For stable output (test determinism, UI snapshot consistency). Pair iteration order is `Map.values()` insertion order — deterministic for a given projection.
- **Self-bridging warrants.** A warrant W whose `bridges-from` and `bridges-to` both point to the same node (D == C) is technically representable. The v1 detector still processes it: W has a (D, D) group. Two warrants on the same (D, D) pair would still trigger the pattern. The case is structurally odd but not excluded; if user testing surfaces it as noise, add a filter later.
- **No memoization.** The function is pure; repeat calls walk the visible bridge edges. The sibling `projection_caching` task addresses whole-projection caching.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.**
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/multi-warrant-detection.test.ts` for the algorithm in isolation. Cucumber + pglite scenarios at `tests/behavior/diagnostics/multi-warrant-detection.feature` with step defs in `tests/behavior/steps/diagnostics-multi-warrant-detection.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/multi-warrant-detection.ts` exports:
  - `detectMultiWarrants(projection: Projection): MultiWarrant[]`
  - `MultiWarrant` — interface `{ dataNodeId: string; claimNodeId: string; warrantNodeIds: string[] }`. `warrantNodeIds` is sorted lexicographically for stable output.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `detectMultiWarrants` and the `MultiWarrant` type.
- Filter, in evaluation order:
  1. `edge.visible === true` AND `edge.role === 'bridges-from'` — each surviving edge identifies a warrant candidate `W = edge.sourceNodeId` and a data node `D = edge.targetNodeId`.
  2. Both endpoint nodes (W, D) must exist on the projection and be visible.
  3. For each such (W, D), look up W's outgoing edges via `getEdgesBySource(W)` and find every visible `bridges-to` edge `W → C`. Both endpoints must again exist and be visible.
  4. For each (D, C) found this way, record W under the (D, C) group.
  5. After walking all `bridges-from` edges, emit each (D, C) group whose warrant set has size >= 2; sort `warrantNodeIds` lexicographically.
- Iteration order: `Map.values()` insertion order — deterministic for a given projection.
- `apps/server/src/diagnostics/multi-warrant-detection.test.ts` covers:
  - Empty projection → no multi-warrants.
  - Single complete warrant on (D, C) → no multi-warrant (only one warrant).
  - Two complete warrants on the same (D, C) → one multi-warrant entry with both warrant ids.
  - Two warrants on different (D, C) pairs → no multi-warrants.
  - One complete + one incomplete warrant (missing `bridges-to`) on (D, C) → no multi-warrant (incomplete doesn't count).
  - One complete + one incomplete warrant (missing `bridges-from`) on (D, C) → no multi-warrant.
  - Three complete warrants on (D, C) → one multi-warrant entry with all three warrant ids, sorted.
  - Non-visible `bridges-from` edge → excluded.
  - Non-visible `bridges-to` edge → excluded.
  - Warrant with multiple `bridges-to` to different claims → contributes to each (D, C) group separately.
- `tests/behavior/diagnostics/multi-warrant-detection.feature` covers 2 DB-driven scenarios:
  1. **Two warrants on the same (D, C) detected.** Build a session with data node D, claim node C, warrant nodes W1 and W2, plus four `bridges` edges (W1→D `bridges-from`, W1→C `bridges-to`, W2→D `bridges-from`, W2→C `bridges-to`); include all entities. Project; assert `detectMultiWarrants` returns one entry with `dataNodeId === D`, `claimNodeId === C`, `warrantNodeIds === [W1, W2]` (sorted).
  2. **Single warrant — no detection.** Same setup but only W1 (no W2). Project; assert `detectMultiWarrants` returns no entries.
- Step defs in `tests/behavior/steps/diagnostics-multi-warrant-detection.steps.ts`. Distinct UUID prefix (`c3...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), and all other step files. Reuses `tests/behavior/support/event-rows.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `multi_warrant_detection` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; existing 487 vitest + 96 cucumber baseline preserved and extended.

## Decisions

- **Where the diagnostics module lives.** `apps/server/src/diagnostics/multi-warrant-detection.ts`, alongside `cycle-detection.ts` and `contradiction-detection.ts`. Same pattern as the siblings: a pure read function, its own file, re-exported through the diagnostics barrel.
- **Public API.**
  - `detectMultiWarrants(projection: Projection): MultiWarrant[]` — single-call detector, returns the full set of multi-warrant patterns in the current projection.
  - `MultiWarrant = { dataNodeId: string; claimNodeId: string; warrantNodeIds: string[] }` — the (D, C) pair plus the sorted list of warrant node ids. The naming uses `dataNodeId` / `claimNodeId` rather than `nodeA` / `nodeB` (as in `Contradiction`) because the pair is **directed**: D and C have distinct roles (data vs claim). Swapping them changes the meaning.
  - No error type. Empty graph → `[]`. Unknown projection state → propagates whatever the underlying primitives raise.
- **No substance-agreement filter (structural-only detection).** Per `docs/data-model.md` line 187:
  > When two or more warrants both bridge the same (data, claim) pair, and they assert different bridges, this is a strong signal that the claim is bundling multiple things.
  The signal is the **structural co-occurrence** of two warrants on a (D, C) pair — it doesn't depend on whether the bridging edges' substance facets have been agreed. The methodological prompt ("decompose the claim") is worth surfacing as soon as the structure forms, not only after the participants have agreed each bridging edge fires. Contrast cycle and contradiction detection, both of which gate on `isEdgeActive`: a cycle in unagreed-substance supports edges isn't yet circular reasoning (lines 100–104 — active firing requires agreed substance), and a contradicts edge has to actually fire for "both cannot be true" to be a real problem. The multi-warrant case is different: even competing warrants whose substance is still being debated are a methodological signal — the participants are anchoring multiple bridging rules on the same data→claim move, and that's exactly what the decomposition prompt addresses.
  - **What we DO require:** edge `visible === true` (broken edges and edges whose endpoints were superseded by decompose / restructure don't participate — per the projection's visibility derivation).
  - **What we don't require:** `isEdgeActive`, substance facet agreement on bridges-from / bridges-to / D / C, or any per-participant agreement state. The pattern is purely structural.
  - This is recorded as a deliberate divergence from the sibling detectors, citing data-model.md line 187 explicitly.
- **Filter to complete warrants only (both bridge edges present).** Per `docs/data-model.md` lines 122–131, a warrant licenses inference D→C **via TWO edges** (`bridges-from` to D, `bridges-to` to C). A node with only one of the two isn't a complete warrant; it's an incomplete bridging shape that the `coherency_hint_detection` sibling task catches. The two detectors partition the warrant-shape space: this one handles `count >= 2` over complete warrants; the sibling handles count==1 over warrants with a missing bridge edge. Pre-empting the sibling's territory here would conflate two diagnostics.
- **A warrant with multiple bridge edges contributes to multiple (D, C) groups.** A warrant W with two `bridges-from` (to D1, D2) and two `bridges-to` (to C1, C2) participates in groups (D1, C1), (D1, C2), (D2, C1), (D2, C2) — Cartesian product. Within each group, W is one warrant. This is the structurally honest reading: the warrant licenses each of the four data→claim moves. If the methodology decides this case is rare or noisy, a future refinement can collapse it.
- **Algorithm.**
  1. Iterate `projection.edges()` once.
  2. For each visible `bridges-from` edge `W → D`: skip if either endpoint is missing or invisible.
  3. Look up W's outgoing edges via `getEdgesBySource(W)`. For each visible `bridges-to` edge `W → C` (skipping missing/invisible endpoints), record W under the (D, C) group.
  4. After the walk, emit each (D, C) group with `warrantNodeIds.length >= 2`; sort `warrantNodeIds` lexicographically.
  - **Why not walk `bridges-to` edges first.** The two are symmetric — either direction works. Walking `bridges-from` first and looking up `bridges-to` via the source index is the same cost as the reverse. The chosen direction matches how a debater would think about the pattern: "for each piece of data that participates in a Toulmin step, who's bridging from it, and where to?"
  - **Complexity.** O(E_bridges-from) for the outer walk; per warrant, O(E_W) for the source-index lookup where E_W is the warrant's outgoing-edge count. Total: O(E) where E is bridges-from edge count + sum of outgoing bridges-to per warrant, bounded by total visible bridge-edge count.
- **Pair key encoding.** `"${dataNodeId} ${claimNodeId}"` (null-byte separator) — same pattern as the contradiction detector's canonical-pair key. UUID v4 strings never contain `\0`, so the join is unambiguous. Unlike contradiction, the pair is directed (no canonical reordering) — the data and claim sides are distinct.
- **Warrant-id sort: lexicographic, ascending.** Stable test-to-test output regardless of edge-insertion order. Map iteration over the (D, C) groups stays in insertion order (Map preserves insertion order), so two runs against the same projection emit the same sequence of multi-warrant entries.
- **No diagnostic event emission.** Out of scope. `diagnostic_event_emission` (M2 sibling) consumes this detector's output.
- **No blocking-vs-advisory classification.** Out of scope. `blocking_vs_advisory_classification` (M2 sibling) classifies each diagnostic kind.
- **Test layout (Vitest).** `apps/server/src/diagnostics/multi-warrant-detection.test.ts`. Reuses the same TS-literal-event seeding pattern as `cycle-detection.test.ts` and `contradiction-detection.test.ts`. Helpers inlined per the sibling-file pattern. Tests construct minimal projections (no commit-substance — purely structural).
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/multi-warrant-detection.feature` + `tests/behavior/steps/diagnostics-multi-warrant-detection.steps.ts`. Two scenarios per Acceptance criteria. UUID prefix `c3...`.

## Open questions

- **Self-bridging warrants (D == C).** A warrant whose `bridges-from` and `bridges-to` both point to the same node is structurally representable but semantically odd (it licenses inference from a node to itself). v1 processes them normally (two such warrants on (D, D) would trigger the pattern). If user testing surfaces this as noise, add a filter (`source !== target` on the (D, C) pair) later.
- **Substance-agreed multi-warrant — separate diagnostic.** A possible future detector reports only multi-warrant patterns where all four bridging edges and both nodes (D, C) have committed-agreed substance — i.e. the structurally-firing version of this detector. Out of scope here. The current detector's structural-only choice is the right v1 default per data-model.md line 187. The hypothetical sibling would have a different name (`detectFiringMultiWarrants`) so the two surfaces stay separate.
- **Warrants with their own backing.** A warrant `W` may have an incoming `supports` edge from another node (the warrant's backing). The detector doesn't look at backing — only at W's outgoing `bridges-from` and `bridges-to`. Backing is unrelated to the multi-warrant pattern; it's the warrant's own justification, not part of the bridging relation.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/diagnostics/multi-warrant-detection.ts` — new file. Exports `detectMultiWarrants(projection): MultiWarrant[]` and the `MultiWarrant` interface (`{ dataNodeId: string; claimNodeId: string; warrantNodeIds: string[] }`). Pure read function over the projection. Walks `projection.edges()` once for `bridges-from` edges (W→D). For each, looks up W's outgoing edges via `getEdgesBySource(W)` and pairs each visible `bridges-to` (W→C) with the data node. Accumulates into a `Map<dataId\0claimId, MultiWarrant>` keyed by `${dataNodeId} ${claimNodeId}`. Filters to groups with `>= 2` warrants and sorts each `warrantNodeIds` lexicographically. Structural-only filter — visibility only, no `isEdgeActive` gate, no substance-agreement check on any of the bridging edges or (D, C) nodes (per `docs/data-model.md` line 187 — a deliberate divergence from the cycle / contradiction sibling detectors).
- `apps/server/src/diagnostics/index.ts` — barrel now also re-exports `detectMultiWarrants` and `MultiWarrant`. Third detector in the diagnostics module alongside `cycle-detection.ts` and `contradiction-detection.ts`.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `multi_warrant_detection`.

Tests:

- `apps/server/src/diagnostics/multi-warrant-detection.test.ts` — 10 cases organized into two groups. No-multi-warrants: empty projection, single complete warrant on (D, C), two warrants on different pairs, one complete + one missing-bridges-to, one complete + one missing-bridges-from, non-visible bridges-from / bridges-to edges. Multi-warrants detected: two complete warrants on the same (D, C) (sorted ids), three complete warrants on the same (D, C) (sort across insertion order), one warrant participating in multiple (D, C) groups via multiple bridges-to (Cartesian-product expansion). Each test seeds a fresh projection via TS-literal events through `applyEvent`; helpers (`seedSession`, `createNode`, `createBridgesFromEdge`, `createBridgesToEdge`, `buildCompleteWarrant`) follow the pattern from the sibling test files. Substance facets are deliberately NOT committed-agreed — the multi-warrant detection is structural-only.
- `tests/behavior/diagnostics/multi-warrant-detection.feature` — 2 DB-driven scenarios. (1) Two complete warrants on the same (D, C) detected after round-tripping events through pglite's `session_events` table. (2) Single warrant on (D, C) — no detection.
- Step defs in `tests/behavior/steps/diagnostics-multi-warrant-detection.steps.ts`. Distinct UUID prefix (`c3...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), active-firing (`88...`), and other step files. Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`).

`pnpm run test:smoke` green (497 tests, +10 over the prior 487 baseline). `pnpm run test:behavior:smoke` green (98 scenarios, +2 over the prior 96 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
