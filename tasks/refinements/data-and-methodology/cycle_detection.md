# Detect cycles in supports edges

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.cycle_detection`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.projection` (settled — the full projection sub-tree, including `active_firing_computation`). Through it, the projection's read surface: `Projection.edges()`, `getNode`, `getEdge`, `visible` flags, and the read-side `isEdgeActive` primitive. Indirectly: `methodology_engine.break_edge_logic` (the resolution path for any cycle the detector surfaces; already landed).

## What this task is

Detect **cycles in the `supports` edges** of a session's visible graph. Per `docs/data-model.md` line 170 ("Cycles in support"), any cycle in `supports` edges indicates circular reasoning — A supports B, B supports C, C supports A — a closed loop of justification that doesn't bottom out. The detection is a structural diagnostic: cycles are surfaced so the moderator can offer a resolution path (`break-edge`, `decompose`, `axiom-mark` — per the data-model paragraph's resolution-path list).

The task delivers a **pure read function** over the projection: `detectSupportsCycles(projection: Projection): SupportsCycle[]` where `SupportsCycle = { nodes: string[] }` is the cycle as an ordered list of node ids. The function lives in a new `apps/server/src/diagnostics/` module alongside the projection — diagnostics consume the projection but don't extend it. Today, no event-stream wiring; the downstream `diagnostic_event_emission` task is the WBS-defined home for that.

## Why it needs to be done

Per `docs/data-model.md` line 157:

> The debate graph is a full directed graph — cycles are permitted. Cycles in `supports` chains are circular reasoning, which is a logical error; the system surfaces them so they can be explicitly resolved.

And lines 170–175 enumerate the three resolution paths the moderator offers once a cycle has fired:

> - Break one of the `supports` edges (the participants acknowledge it doesn't actually hold).
> - Decompose one of the nodes in the cycle (the apparent loop turns out to be about different aspects of the node).
> - A participant axiom-marks one of the nodes in the cycle (the chain terminates at that participant's foundational commitment, so it doesn't need further support from inside the cycle).

The methodology engine's commit-side resolution for break-edge (`break_edge_logic`, already landed) flips the broken `supports` edge to invisible, after which the projection naturally drops it from the graph. But the detector that surfaces the cycle for the moderator UI to highlight is upstream of all three resolution paths — without it, the moderator has no read-side signal that a cycle exists.

Downstream consumers: `diagnostic_event_emission` (M2, sibling task) wires the detector's output into the event-stream surface for subscribers; `blocking_vs_advisory_classification` (M2, sibling task) classifies cycle diagnostics alongside contradiction / multi-warrant / dangling-claim / coherency-hint diagnostics. Both are separate tasks and not pre-empted here.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) lines 156–175 — "Graph properties" and "Cycles in support" sections. The graph is a full directed graph with cycles permitted. The cycle diagnostic targets cycles in `supports` chains specifically (not other edge roles).
- [`docs/data-model.md`](../../../docs/data-model.md) lines 100–108 — active-firing rule. The detection consumes the read-side `isEdgeActive` primitive: an edge "participates in active reasoning" only when its substance facet AND its source node's substance facet are both settled-agreed.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge` (the `role`, `visible`, `sourceNodeId`, `targetNodeId` fields used to filter), `ProjectedNode`.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection.edges()`, `getNode`, `getEdge`, `nodes()`.
- [`apps/server/src/projection/active-firing.ts`](../../../apps/server/src/projection/active-firing.ts) — `isEdgeActive(projection, edgeId): boolean`. The detector composes this primitive rather than re-implementing the firing rule.
- [`apps/server/src/projection/index.ts`](../../../apps/server/src/projection/index.ts) — the projection barrel; the diagnostics module imports from here.
- [`tasks/refinements/data-and-methodology/active_firing_computation.md`](./active_firing_computation.md) — settles `isEdgeActive` semantics: an edge fires iff both its substance facet's derived status is `'agreed'`/`'committed'` with value `'agreed'` AND its source node's substance facet satisfies the same condition. The cycle detector consumes this primitive.
- [`tasks/refinements/data-and-methodology/break_edge_logic.md`](./break_edge_logic.md) — the cycle-resolution path. A committed break-edge flips the edge's `visible` flag to `false`; downstream calls to the cycle detector then see one fewer participant in the supports adjacency. The detector relies on this without any direct coupling: it filters on `edge.visible === true`.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit tests for the in-memory algorithm; Cucumber + pglite scenarios for at least one DB-driven path.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Filter to `supports` edges only.** The data-model doc's "Cycles in support" section is explicit: cycles in `supports` chains are the diagnostic. A cycle that mixes `supports` and `rebuts` (or any other role) is not a supports-cycle; this detector ignores it. Other diagnostics (contradiction detection, etc.) handle their own role filters.
- **Filter to visible edges only.** An edge whose `visible === false` (broken by a committed `break-edge`, or its endpoint was decomposed away) is not currently part of the graph. Per the data-model derivation (lines 287–293), invisible edges don't participate in any structural reasoning.
- **Filter to active-firing edges only.** Per the active-firing primitive: an edge fires iff its substance facet and its source node's substance facet are both settled-agreed (status in `{'agreed', 'committed'}` with effective value `'agreed'`). An edge whose substance is still `proposed` / `disputed` / `meta-disagreement` does not participate in current reasoning; including it would surface a "cycle" that the participants haven't even agreed exists. Same rationale for source-node substance — until the source is established as settled-true, the chain it would extend isn't load-bearing.
- **Self-loops are cycles of length 1.** An active visible `supports` edge from a node to itself (A supports A) is the smallest possible supports cycle. The detector returns it as a single-node cycle `{ nodes: ['A'] }`.
- **Multiple disjoint cycles are reported separately.** Two cycles that share no node produce two entries in the result list.
- **Multiple overlapping cycles.** The v1 algorithm (Tarjan's SCC-decomposition) returns each non-trivial strongly-connected component as one cycle entry: every node in an SCC is in a cycle within that SCC, and the SCC's node set is exactly what the moderator UI needs to highlight. Two cycles that share a node are reported as one SCC. The data-model doc doesn't require enumeration of every simple cycle (the moderator's resolution actions — `break-edge`, `decompose`, `axiom-mark` — operate on a single edge or node, so highlighting the whole SCC is the actionable surface). Johnson's algorithm (which enumerates simple cycles) is recorded as a possible future extension if user testing surfaces a need.
- **No memoization.** The function is pure; repeat calls are O(N + E) where N is the visible node count and E the active-supports edge count. The sibling `projection_caching` task addresses whole-projection caching; this primitive stays simple.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.** The eventual diagnostic event stream is the `diagnostic_event_emission` sibling task; the cycle detector is the read-side primitive that task will consume.
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/cycle-detection.test.ts` for the algorithm in isolation (events constructed as TS literals, no DB). Cucumber + pglite scenarios at `tests/behavior/diagnostics/cycle-detection.feature` with step defs in `tests/behavior/steps/diagnostics-cycle-detection.steps.ts` for the DB-round-trip path.

## Acceptance criteria

- `apps/server/src/diagnostics/cycle-detection.ts` exports:
  - `detectSupportsCycles(projection: Projection): SupportsCycle[]`
  - `SupportsCycle` — interface `{ nodes: string[] }`. The `nodes` array is the cycle's node ids in adjacency order (each `nodes[i]` has an active visible `supports` edge to `nodes[i+1]`, and `nodes[length-1]` has an active visible `supports` edge to `nodes[0]`).
- `apps/server/src/diagnostics/index.ts` — new barrel re-exports `detectSupportsCycles` and the `SupportsCycle` type.
- The algorithm: **Tarjan's strongly-connected components**, run over the pre-filtered adjacency map. Each SCC of size ≥ 2 is one supports-cycle. Self-loops (an SCC of size 1 whose node has an edge to itself) are also reported. SCCs of size 1 without a self-loop are not cycles.
- Pre-filter: only edges where `edge.visible === true` AND `edge.role === 'supports'` AND `isEdgeActive(projection, edge.id) === true`.
- Build adjacency from filtered edges: `source → list of target node ids`.
- Run Tarjan's SCC over the visible node set; for each SCC of size ≥ 2, emit one `SupportsCycle` with the SCC's node ids in adjacency-walk order; for each size-1 SCC whose node has an active supports edge to itself, emit one `SupportsCycle` with just that node.
- `apps/server/src/diagnostics/cycle-detection.test.ts` covers:
  - Empty projection → no cycles.
  - Graph with no supports edges (only `rebuts` etc.) → no cycles.
  - Linear supports chain (A → B → C) → no cycles.
  - Self-loop (A → A, supports, active, visible) → one cycle `{ nodes: ['A'] }`.
  - Two-node cycle (A → B, B → A) → one cycle of 2 nodes.
  - Three-node cycle (A → B → C → A) → one cycle of 3 nodes.
  - Two independent (disjoint) cycles → two cycle entries.
  - Cycle involving a non-active edge (substance not committed-agreed on one edge) → not detected.
  - Cycle involving a non-active edge because of an unagreed source node → not detected.
  - Cycle involving a non-visible edge (broken by committed break-edge) → not detected.
  - Cycle involving non-`supports` edges mixed with supports — only `supports` participates; if removing the non-supports edges destroys the cycle, no detection.
  - Overlapping cycles (two cycles sharing one node) → single SCC reported as one cycle entry whose node list covers all nodes in the SCC.
- `tests/behavior/diagnostics/cycle-detection.feature` covers 3 DB-driven scenarios:
  1. **Cycle exists.** Build a session with 3 nodes A, B, C, three `supports` edges A→B, B→C, C→A, each with substance committed-agreed and each source node's substance committed-agreed. Project; assert `detectSupportsCycles` returns one cycle containing all three nodes.
  2. **No cycle.** Same setup but a chain (A → B → C, no C → A). Project; assert `detectSupportsCycles` returns no cycles.
  3. **Cycle broken.** Same setup as (1), then a `break-edge` proposal against C → A is voted-agreed and committed. The committed break-edge flips that edge to invisible. Project; assert `detectSupportsCycles` returns no cycles.
- Step defs in `tests/behavior/steps/diagnostics-cycle-detection.steps.ts`. Reuses `tests/behavior/support/event-rows.ts` for inserts / selects / envelope mapping. Uses a distinct UUID prefix (`c1...`) to avoid scratch-state collision with the projection / methodology step files.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `cycle_detection` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; existing 463 vitest + 90 cucumber baseline preserved and extended.

## Decisions

- **Where the diagnostics module lives.** New directory `apps/server/src/diagnostics/`. Same shape as `apps/server/src/projection/`: a small set of pure read functions over the projection, each in its own file, with a barrel `index.ts`. Diagnostics live alongside the projection (peer modules) — they consume it but don't extend it. Naming follows the WBS sub-stream: the cycle detector is `cycle-detection.ts`; future siblings (`contradiction-detection.ts`, `multi-warrant-detection.ts`, etc.) are separate files in the same directory. The barrel re-exports each detector's public surface.
- **Public API.**
  - `detectSupportsCycles(projection: Projection): SupportsCycle[]` — single-call detector, returns the full set of cycles in the current projection.
  - `SupportsCycle = { nodes: string[] }` — the cycle as an ordered list of node ids. The `nodes` array describes the adjacency walk: every consecutive pair (including the wrap from `nodes[length-1]` back to `nodes[0]`) is connected by an active visible `supports` edge. For SCCs the walk is one valid traversal of the component (Tarjan emits nodes in finish-order; for the cycle case, that order is suitable for the moderator UI to highlight).
  - No error type. Empty graph → empty array. Unknown projection / corrupted state → propagates whatever the underlying primitives (`isEdgeActive`, `getNode`) raise; the detector doesn't translate. The active-firing primitive throws `ActiveFiringComputationError` only for missing source-node references — a projection-invariant violation, which is the right "loud" surface.
- **Cycle representation: list of node ids, not edges.** The moderator UI highlights nodes (the cycle's vertices) and renders the implied edges by walking the projection. Returning node ids is the smaller, more stable surface — edge ids would couple the diagnostic to specific edge instances, which is unhelpful when overlapping cycles share edges and confuses the UI's "which cycle does this node belong to?" question.
- **The "only supports / only active / only visible" filter, in evaluation order.** Per the data-model doc's cycle-in-supports section and the active-firing primitive's contract:
  1. `edge.visible === true` — broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate. The projection's visibility derivation is the source of truth.
  2. `edge.role === 'supports'` — only `supports` cycles are the diagnostic. Other edge roles (`rebuts`, `qualifies`, `bridges-from`, `bridges-to`, `defines`, `contradicts`) don't form supports-cycles.
  3. `isEdgeActive(projection, edge.id) === true` — only actively-firing edges count. The primitive handles the conjunction `edge.substance ∧ source.substance` (both settled-agreed) per the active-firing refinement.
- **Why active-firing matters for cycle detection.** A `supports` edge whose substance is still `proposed` is not yet a load-bearing relation; the participants haven't agreed it holds. Reporting a cycle involving such an edge would surface "circular reasoning" before any reasoning has been agreed. The diagnostic should fire only when the cycle is structurally present in the agreed graph — that's the "primary success state" surface the moderator can act on. The active-firing filter is the same one downstream diagnostics will use (contradiction detection, multi-warrant detection), keeping the family consistent.
- **Algorithm choice: Tarjan's SCC.** Pre-filter the edges to active visible `supports`, build adjacency `source → [targets]`, run Tarjan over the visible nodes. Each non-trivial SCC (size ≥ 2) is a cycle; self-loops are detected separately for size-1 SCCs.
  - **Why Tarjan over Johnson's.** Johnson's algorithm enumerates every *simple* cycle (the cyclic permutations are distinguished); Tarjan emits one entry per SCC. For the moderator UI's purpose ("highlight the nodes in the cycle so the user can decide which edge to break, which node to decompose, or which node to axiom-mark"), the SCC is the actionable unit: any node in the SCC is in some cycle, so axiom-marking it or decomposing it resolves the diagnostic. Johnson's would surface N cycles for an SCC that has N simple cycles, which is moderator UI noise. If a future feature requires per-simple-cycle enumeration, swap Tarjan for Johnson's at the detector boundary; the public API stays the same (just more entries).
  - **Why Tarjan over plain DFS-with-visited-set.** A naive DFS can detect that a cycle exists but doesn't cleanly partition cycle membership; Tarjan does in one linear pass.
  - **Complexity.** O(N + E) over the filtered graph. For the projection sizes we expect (sessions with hundreds of nodes/edges at most), this is well under any user-perceptible threshold.
- **Self-loops are reported.** An active visible `supports` edge from A to A is a size-1 SCC whose node has a self-edge. The detector emits `{ nodes: ['A'] }` for this case. Tarjan handles self-loops as a special case (the recursion's "back-edge to self" branch); the implementation explicitly checks for the self-edge case to avoid Tarjan's default behavior of reporting size-1 SCCs without self-loops (which are not cycles).
- **Multiple cycles: each SCC is one entry.** Two disjoint cycles produce two SCCs and two entries. Two cycles that share a node form one SCC (the shared node connects both), reported as a single entry whose `nodes` list covers all nodes in the SCC. This is the v1 contract; the moderator UI can handle "highlight all nodes in this SCC" uniformly. If user testing surfaces a need for per-simple-cycle enumeration, switch to Johnson's algorithm (the public API doesn't change — more entries, each smaller).
- **Order of cycles in the returned array.** Insertion order from Tarjan's DFS; the algorithm visits nodes in `Projection.nodes()` iteration order (insertion order — the Map preserves it). The order is deterministic for a given projection state. The moderator UI doesn't depend on a specific order; the determinism is for test stability.
- **Order of nodes within a cycle.** For SCCs of size ≥ 2 the implementation re-walks the SCC to produce an adjacency-ordered list (start at the first node Tarjan emitted, follow active visible supports edges within the SCC until the start repeats). For self-loops the single-node list is trivially adjacency-ordered.
- **No diagnostic event emission.** Out of scope. The `diagnostic_event_emission` sibling task (M2) consumes this detector's output and wires it into the event-stream surface. This task delivers the read-side primitive only.
- **No blocking-vs-advisory classification.** Out of scope. The `blocking_vs_advisory_classification` sibling task (M2) classifies each diagnostic kind. The cycle detector returns the cycle list; the classifier consumes it.
- **Test layout (Vitest).** `apps/server/src/diagnostics/cycle-detection.test.ts`. Reuses the `seedSession` / `proposeSetEdgeSubstance` / `proposeSetNodeSubstance` / `castVote` / `commit` helper pattern from `active-firing.test.ts` (events constructed as TS literals, `applyEvent` to a fresh projection). The helpers are inlined per the pattern of sibling test files (each test file owns its own seed helpers); no shared test fixture extraction. Cases listed under Acceptance criteria.
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/cycle-detection.feature` + `tests/behavior/steps/diagnostics-cycle-detection.steps.ts`. Three scenarios:
  - Scenario 1 (cycle exists): session + 3 participants + 3 nodes (A, B, C) + 3 `supports` edges (A→B, B→C, C→A) + 3 entity-included for nodes + 3 entity-included for edges + 3 `set-node-substance` proposals (one per node, value `'agreed'`) each voted-agree by all and committed + 3 `set-edge-substance` proposals (one per edge, value `'agreed'`) each voted-agree by all and committed. Project via `projectFromLog`; assert `detectSupportsCycles` returns one cycle containing all three node ids.
  - Scenario 2 (no cycle): same setup but only A→B and B→C edges (no C→A). Project; assert empty result.
  - Scenario 3 (cycle broken): same setup as scenario 1, then a `break-edge` proposal against the C→A edge is voted-agree by all and committed (flipping the edge's `visible` flag to `false` via the replay's `break-edge` arm). Project; assert empty result.

  Both scenarios reuse `tests/behavior/support/event-rows.ts` for inserts / selects / envelope mapping. Step ids use a distinct UUID prefix (`c1...`) to avoid scratch-state collision with the projection (`88...`), methodology (`b3...`, `e0...`, `f0...`, `a1...`, `b2...`), and other step files.

## Open questions

- **Per-SCC vs. per-simple-cycle enumeration.** The v1 choice is per-SCC (Tarjan). If user testing surfaces a need for per-simple-cycle enumeration (e.g., the moderator wants to see "this 3-node SCC contains 4 distinct simple cycles, here they are"), switch to Johnson's algorithm at the detector boundary. The public API doesn't change — just more entries. Recorded here so a future task can pick it up without re-deciding.
- **Pending-cycle detection.** A cycle formed by `supports` edges whose substance is still `proposed` (not yet agreed) is not flagged by this detector — the active-firing filter excludes those edges. The data-model doc's "Future development" paragraph at line 104 mentions a "pending consequences" diagnostic for `agreed`-substance edges whose source is not yet agreed; an analogous "pending cycle" diagnostic could surface cycles forming in the proposed-but-not-agreed graph. Out of scope for v1; the `pending_consequences_stub` sibling task is the WBS-defined home for the pending family. The cycle detector here covers the agreed-graph case only.
- **Cycle-on-cycle (nested SCCs).** Tarjan's standard output handles nested cases correctly — each SCC is reported once. No special handling needed.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/diagnostics/cycle-detection.ts` — new file. Exports `detectSupportsCycles(projection): SupportsCycle[]` and the `SupportsCycle` interface (`{ nodes: string[] }`). Pure read function over the projection. Pre-filters edges (`visible === true` AND `role === 'supports'` AND `isEdgeActive` true; both endpoint nodes must be visible) into an adjacency map `source → Set<target>`. Runs an iterative form of Tarjan's strongly-connected components over the visible node set. Each non-trivial SCC (size >= 2) is one cycle entry; size-1 SCCs are cycles only when the node has a self-edge in the filtered adjacency. SCCs of size >= 2 are re-walked in adjacency order (start at the first node Tarjan emitted, follow intra-SCC supports edges until the start repeats) so the returned `nodes` list describes a consecutive walk.
- `apps/server/src/diagnostics/index.ts` — new barrel re-exports `detectSupportsCycles` and the `SupportsCycle` type. First file under the new `apps/server/src/diagnostics/` directory; future detectors (contradiction-detection, multi-warrant-detection, etc.) extend it.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `cycle_detection`.

Tests:

- `apps/server/src/diagnostics/cycle-detection.test.ts` — 13 cases organized into three groups. No-cycles: empty projection, no-supports-only-rebuts cycle, linear chain. Cycles-detected: self-loop, two-node cycle, three-node cycle (with explicit adjacency-order assertion), two disjoint cycles, overlapping cycles (single SCC). Filter rules: edge-substance unagreed → not detected, source-node-substance unagreed → not detected, broken edge (committed break-edge) → not detected, non-supports edge mixed with supports breaks the cycle, non-supports back-edge doesn't contribute to a supports cycle. Each test seeds a fresh projection via TS-literal events through `applyEvent`; helpers (`seedSession`, `createNode`, `createEdge`, `commitNodeAgreed`, `commitEdgeAgreed`, `commitBreakEdge`) follow the pattern from `active-firing.test.ts`.
- `tests/behavior/diagnostics/cycle-detection.feature` — 3 DB-driven scenarios. (1) Three-node supports cycle (A->B->C->A) detected after committing substance:agreed on all nodes and edges. (2) Three-node supports chain (A->B->C, no C->A) yields no cycles. (3) Three-node cycle disappears after a break-edge proposal against C->A is voted-agree by all and committed (flipping that edge's visible flag to false via the replay's break-edge arm).
- Step defs in `tests/behavior/steps/diagnostics-cycle-detection.steps.ts`. Distinct UUID prefix (`c1...`) avoids scratch-state collision with the active-firing (`88...`), methodology (`b3...`, `e0...`, `f0...`, `a1...`, `b2...`), and other step files. Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`).

`pnpm run test:smoke` green (476 tests, +13 over the prior 463 baseline). `pnpm run test:behavior:smoke` green (93 scenarios, +3 over the prior 90 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
