# Detect agreed contradictions

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.contradiction_detection`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.projection` (settled — including `active_firing_computation`). Through it, `Projection.edges()`, `getNode`, `getEdge`, `visible` flags, and `isEdgeActive`. Indirectly: `methodology_engine.amend_node_logic` (one of the contradiction resolution paths; already landed — its existing primitive `nodeIsPartyToAgreedContradicts` in `apps/server/src/methodology/primitives.ts` is the per-node spec of the same filter this detector applies graph-wide).

## What this task is

Detect **agreed contradictions** in a session's visible graph. Per [`docs/data-model.md`](../../../docs/data-model.md) line 178 ("Contradictions"):

> A `contradicts` edge between two nodes is itself a structural problem: both cannot be true. Contradictions are treated uniformly — there is no special handling for "internal" (same owner) vs. "external" (different owners) contradictions; a contradiction is a contradiction.

A contradiction is a structural problem **once it actually fires** — that is, once both endpoints' substance is established as `agreed` and the edge's own substance facet is also `agreed`. A `contradicts` edge whose substance is still `proposed` is a claim by some participant that two nodes conflict; until the methodology agrees the conflict obtains, it is not yet a diagnostic. Per `docs/data-model.md` lines 100–102 the active-firing conjunction (`edge.substance ∧ source.substance`) is the read-side gate for "the relation actually obtains"; for the contradiction case the target-node substance also matters (see Decisions).

The task delivers a **pure read function** over the projection: `detectContradictions(projection: Projection): Contradiction[]` where `Contradiction = { nodeA: string; nodeB: string; edges: string[] }`. Each entry names an unordered pair of nodes that are mutually contradicting plus the edge id(s) that establish the contradiction (one in the asymmetric case, two in the symmetric A↔B case per `docs/data-model.md` line 120). The function lives in `apps/server/src/diagnostics/`, alongside `cycle-detection.ts`.

## Why it needs to be done

Per `docs/data-model.md` lines 177–185:

> A `contradicts` edge between two nodes is itself a structural problem: both cannot be true. … Resolution paths:
> - Decompose one or both nodes …
> - Amend one node so the conflict no longer holds.
> - The relevant participants each axiom-mark the position they hold; the `contradicts` edge stays. This accepts the contradiction as the bedrock disagreement of the debate (a primary success state, not a failure).
>
> A debate of substance will typically have at least one prominent contradiction at its center — that's the disagreement under discussion. Marking it explicitly makes the goal of the debate visible.

The amend-node propose-side gate (`amend_node_logic`, already landed) enforces that **amend-node only fires against a node party to an agreed contradicts edge** — its `nodeIsPartyToAgreedContradicts(projection, nodeId): boolean` walker is the per-node spec of the filter this detector applies graph-wide. Without the detector, the moderator UI has no read-side signal that a contradiction exists; the methodology can resolve a contradiction node-by-node but can't surface "here are the contradictions on the graph right now."

Downstream consumers: `diagnostic_event_emission` (M2 sibling) wires the detector's output into the event-stream surface; `blocking_vs_advisory_classification` (M2 sibling) classifies contradictions alongside cycles / multi-warrant / dangling-claim / coherency-hint diagnostics. Both are separate tasks; this one delivers the detection logic only.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) lines 100–108 — active-firing rule (`edge.substance ∧ source.substance`, both settled-agreed) and the defeater-pattern paragraph that motivates **why target-node substance is NOT in the generic `isEdgeActive` primitive**.
- [`docs/data-model.md`](../../../docs/data-model.md) line 120 — `contradicts` edge role: "Directed. If a contradiction is genuinely symmetric (each rules out the other in the same way), it is represented as **two** `contradicts` edges in opposite directions; this avoids special-casing symmetric edges in storage and rendering."
- [`docs/data-model.md`](../../../docs/data-model.md) lines 177–185 — the "Contradictions" structural-diagnostic section. Treated uniformly regardless of owner; the three resolution paths (decompose, amend, axiom-mark on each side).
- [`apps/server/src/projection/active-firing.ts`](../../../apps/server/src/projection/active-firing.ts) — `isEdgeActive(projection, edgeId): boolean`. Composes `edge.substance` AND `source.substance` (both settled-agreed). Target-node substance is **NOT** in the generic primitive (the defeater pattern requires `rebuts` to fire against an unsettled target).
- [`apps/server/src/methodology/primitives.ts`](../../../apps/server/src/methodology/primitives.ts) — `nodeIsPartyToAgreedContradicts(projection, nodeId)`. The per-node spec of the same filter. Reads `edge.visible`, `edge.role === 'contradicts'`, `edge.substanceFacet.status ∈ {'agreed', 'committed'}` with value `'agreed'`. The graph-wide detector applies the same predicate to each visible contradicts edge AND adds the target-node-substance check (rule below).
- [`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts) and [`index.ts`](../../../apps/server/src/diagnostics/index.ts) — sibling template. The module layout, pure-read shape, `isEdgeActive` composition, visibility filter, and barrel pattern all carry over directly.
- [`tasks/refinements/data-and-methodology/cycle_detection.md`](./cycle_detection.md) — sibling refinement. The "diagnostics module lives alongside projection," "no error type — empty graph → empty array," "filter in evaluation order," "no diagnostic event emission / classification (out of scope)" decisions all transfer.
- [`tasks/refinements/data-and-methodology/amend_node_logic.md`](./amend_node_logic.md) — companion task. Its rule 4 uses the same per-node walker; this detector applies the same filter at graph scope.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit + Cucumber+pglite integration.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Filter to visible `contradicts` edges only.** `edge.visible === true` AND `edge.role === 'contradicts'`. Broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate.
- **Active firing per the data-model rule: BOTH endpoints' substance must be agreed.** `isEdgeActive(projection, edge.id)` already enforces `edge.substance ∧ source.substance` settled-agreed. The detector composes that AND adds an explicit target-node-substance check — for contradictions, both endpoints' substance need to fire, per `docs/data-model.md` line 178 ("both cannot be true"). The asymmetric defeater rationale that justifies excluding target substance from the generic `isEdgeActive` (line 102) does NOT apply to contradicts: the contradicts role is symmetric in meaning even when directed in storage.
- **Symmetric pair deduplication.** A pair (A, B) connected by an `A → B contradicts` edge AND a `B → A contradicts` edge (the storage representation of a symmetric contradiction per line 120) MUST be reported as a single entry — not two. The detector orders the pair canonically (`[min(nodeId), max(nodeId)]` by lexicographic order on the UUID strings) and deduplicates on the ordered pair. The single entry's `edges` field carries both edge ids in input-iteration order.
- **Edge ids carried in the entry.** Each `Contradiction` includes the edge id(s) that establish the pair. One edge in the asymmetric case (`A → B` with target-substance not yet agreed → not detected; only when both substances fire does the edge participate, but then it's still one edge if no reverse exists). Two edges in the symmetric case. Downstream resolution (`break-edge`, `amend-node`, `axiom-mark`) operates on edges and nodes; carrying the edge ids lets the moderator UI offer "break this edge" without re-walking the projection.
- **Self-loops excluded.** A `contradicts` edge from A to A would mean "A contradicts itself" — a logical absurdity if it actually fires, but technically representable. For v1 the detector skips self-loops (`source === target`); they're not a meaningful "pair." Recorded as an open question if it becomes user-visible.
- **No memoization.** The function is pure; repeat calls are O(E) over the visible contradicts edges. The sibling `projection_caching` task addresses whole-projection caching.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.** The eventual diagnostic event stream is the `diagnostic_event_emission` sibling.
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/contradiction-detection.test.ts` for the algorithm in isolation. Cucumber + pglite scenarios at `tests/behavior/diagnostics/contradiction-detection.feature` with step defs in `tests/behavior/steps/diagnostics-contradiction-detection.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/contradiction-detection.ts` exports:
  - `detectContradictions(projection: Projection): Contradiction[]`
  - `Contradiction` — interface `{ nodeA: string; nodeB: string; edges: string[] }`. `nodeA` < `nodeB` lexicographically (canonical ordering). `edges` lists the edge id(s) establishing the contradiction.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `detectContradictions` and the `Contradiction` type.
- Filter, in evaluation order:
  1. `edge.visible === true` — broken edges don't participate.
  2. `edge.role === 'contradicts'` — only that role is the diagnostic.
  3. `isEdgeActive(projection, edge.id) === true` — edge substance AND source-node substance both settled-agreed.
  4. The **target node's substance** is settled-agreed (status in `{'agreed', 'committed'}`, effective value `'agreed'`) — the contradiction-specific rule. We compose `deriveFacetStatus` + the substance value of the target node, mirroring the source-node check inside `isEdgeActive`.
  5. Skip self-loops (`source === target`).
- For each surviving edge, form the canonical pair `[min(source, target), max(source, target)]` and accumulate into a `Map<canonicalKey, Contradiction>`. The first edge for a key creates the entry; a subsequent edge with the same pair (the reverse-direction edge for a symmetric pair) appends its id to the entry's `edges` array.
- Iteration order: `Map.values()` insertion order — deterministic for a given projection.
- `apps/server/src/diagnostics/contradiction-detection.test.ts` covers:
  - Empty projection → no contradictions.
  - A pair with a non-active contradicts edge (edge substance not committed-agreed) → no contradictions.
  - A pair with a non-active contradicts edge (source-node substance not committed-agreed) → no contradictions.
  - A pair with an active contradicts edge but target-node substance unagreed → no contradictions (the contradiction-specific rule).
  - A pair with an active contradicts edge whose endpoints' substance is fully agreed → one contradiction detected.
  - Symmetric pair (`A → B` + `B → A`, both active, both endpoints settled-agreed) → one contradiction entry whose `edges` carries both edge ids.
  - Non-contradicts edge (a `supports` edge) between an agreed-substance pair → no contradictions.
  - Broken contradicts edge (committed `break-edge`) → not detected.
  - Multiple independent contradictions (two disjoint pairs) → two entries.
  - Self-loop (`A → A`, role contradicts) → not detected.
  - Canonical pair ordering — assert `nodeA < nodeB` lexicographically.
- `tests/behavior/diagnostics/contradiction-detection.feature` covers 3 DB-driven scenarios:
  1. **Contradiction exists.** Build a session with two nodes A, B, one `A → B contradicts` edge, all three substances (A, B, edge) committed-agreed. Project; assert `detectContradictions` returns one entry containing both nodes and the one edge id.
  2. **Pending contradiction.** Build a session with two nodes A, B and an `A → B contradicts` edge, with A and B substances committed-agreed but the contradicts edge's substance still pending (proposal exists, no commit). Project; assert `detectContradictions` returns no contradictions.
  3. **Amend-node leaves the agreed contradiction in the graph (open call documented below).** Same setup as (1), then an `amend-node` proposal against A is voted-agree by all and committed. The commit updates A's wording in place but does NOT flip the contradicts edge's visible flag or its substance value. Project; assert `detectContradictions` STILL returns one contradiction. This documents the v1 contract: amend-node is a wording-side move; resolving the contradiction structurally (so the detector goes silent) requires a follow-up `break-edge` against the contradicts edge or a withdrawal of edge-substance agreement.
- Step defs in `tests/behavior/steps/diagnostics-contradiction-detection.steps.ts`. Distinct UUID prefix (`c2...`) avoids scratch-state collision with the cycle-detection (`c1...`), active-firing (`88...`), facet-status / methodology (`b3...`, `e0...`, `f0...`, `a1...`, `b2...`, `c4...`), and other step files. Reuses `tests/behavior/support/event-rows.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `contradiction_detection` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; baseline preserved and extended.

## Decisions

- **Where the diagnostics module lives.** `apps/server/src/diagnostics/contradiction-detection.ts`, alongside `cycle-detection.ts`. Same pattern as the cycle detector: a pure read function, its own file, re-exported through the diagnostics barrel.
- **Public API.**
  - `detectContradictions(projection: Projection): Contradiction[]` — single-call detector, returns the full set of agreed contradictions in the current projection.
  - `Contradiction = { nodeA: string; nodeB: string; edges: string[] }` — `nodeA < nodeB` lexicographically. `edges` lists the edge id(s) establishing the pair (one in the asymmetric storage case, two when both directions exist).
  - No error type. Empty graph → `[]`. Unknown projection state → propagates whatever the underlying primitives raise (the generic primitive's `ActiveFiringComputationError` is the loud surface).
- **Pair representation: node ids + edge ids.** Unlike the cycle detector (which returns nodes only because the cycle could span many edges and the moderator UI re-walks the projection to render them), a contradiction is a pair plus 1–2 specific edges. Carrying the edge ids in the entry lets the resolution UI offer "break this edge," "amend this node," "axiom-mark this side" without an extra walk. The cycle detector's "we don't carry edge ids" rationale doesn't apply here — a contradiction is exactly the pair-plus-edge(s) tuple by construction.
- **Symmetric-pair deduplication: canonical lexicographic ordering on the pair.** For each visible active contradicts edge, sort the two endpoints `[min(source, target), max(source, target)]` and key a `Map` by `"${nodeA} ${nodeB}"` (the null-byte separator avoids ambiguity if a node id ever contained the joining character — UUID v4 strings won't, but the pattern is defensive). The first edge for a key creates the entry; subsequent edges for the same key append to `edges[]`. Alternatives considered:
  - **Order by edge id.** Loses the canonical-pair property — `(A, B)` and `(B, A)` would have different keys depending on which edge is iterated first.
  - **Order by direction of the first edge encountered.** Iteration-order-dependent — the result wouldn't be deterministic for a given projection state (the projection's edge insertion order matters).
  - **Store as a `Set<{a: string; b: string}>` and post-deduplicate.** Object-identity sets don't deduplicate structurally; we'd need a `Map<string, ...>` anyway. The chosen approach is the simpler form.
- **Target-node substance counts for contradictions.** Per `docs/data-model.md` line 178: "A `contradicts` edge between two nodes is itself a structural problem: **both cannot be true**." For the contradiction to actually obtain in the graph, the methodology has to have established that both endpoints ARE true (substance agreed). A contradicts edge between an agreed node A and an unagreed node B isn't yet a fired contradiction — B might never end up agreed-true, and the contradiction wouldn't materialize. This is the contradiction-specific rule. It diverges from the defeater pattern at line 102, where the target's substance is deliberately NOT required (the defeater pre-commits an inactive `rebuts` that activates later when the source establishes). The defeater rationale is about role `rebuts`, not `contradicts`; the two roles read differently.
  - **Why we don't extend `isEdgeActive` to handle this.** `isEdgeActive` is a generic primitive that supports the defeater case (the source-only check). Folding role-specific target-substance behavior into it would conflate two semantics. The diagnostics call site composes the extra rule explicitly — same shape as the active-firing primitive itself, just one more line.
- **The "only contradicts / only active / only visible / target-agreed / no self-loop" filter, in evaluation order.**
  1. `edge.visible === true` — visibility derivation is the source of truth.
  2. `edge.role === 'contradicts'` — only this role.
  3. `isEdgeActive(projection, edge.id) === true` — `edge.substance ∧ source.substance` settled-agreed.
  4. Target-node substance settled-agreed (status in `{'agreed', 'committed'}`, value `'agreed'`).
  5. `source !== target` — skip self-loops.
- **Self-loops excluded.** `source === target` with role `contradicts` would mean a node contradicts itself. v1 skips these; if user testing surfaces them as a real failure mode they can be added as a separate diagnostic (the detector returns a `selfContradictions` field, or a sibling detector covers them).
- **Edge ids order within an entry.** Input iteration order from `projection.edges()` (a `Map` preserves insertion order — the order edges were created). Deterministic; not user-meaningful but stable for tests.
- **No diagnostic event emission.** Out of scope. `diagnostic_event_emission` (M2 sibling) consumes this detector's output.
- **No blocking-vs-advisory classification.** Out of scope. `blocking_vs_advisory_classification` (M2 sibling) classifies each diagnostic kind.
- **Amend-node and the contradiction's projection-level visibility.** An amend-node commit (per `replay.ts/applyCommittedProposal`'s `amend-node` arm) updates the target node's wording in place; it does NOT flip the contradicts edge invisible nor change its substance facet's value. Therefore, after an amend-node commits, this detector STILL reports the pair as a contradiction — the agreed `contradicts` edge is still in the graph at agreed substance, and both endpoints' substance is still agreed. This is the v1 contract:
  - The methodology says amend-node is the wording-side path that "removes the conflict" (data-model.md line 219). Semantically, with the amended wording, the contradiction is gone.
  - The projection has no read-side signal of that semantic shift — the edge stays.
  - The participants can complete the resolution by following up with a `break-edge` against the contradicts edge (per data-model.md line 183's third resolution path is axiom-mark on each side, which leaves the edge in place; amend-node's natural follow-up is break-edge or a withdrawal of edge-substance agreement).
  - This is documented in the Cucumber scenario 3 explicitly so the contract is committed to a test, not just a note. A future task could enhance `amend-node` to optionally auto-break the contradicts edge it resolves; out of scope here.
- **Test layout (Vitest).** `apps/server/src/diagnostics/contradiction-detection.test.ts`. Reuses the same TS-literal-event seeding pattern as `cycle-detection.test.ts` (`seedSession`, `createNode`, `createEdge`, `commitNodeAgreed`, `commitEdgeAgreed`, `commitBreakEdge`). Helpers inlined per the sibling-file pattern.
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/contradiction-detection.feature` + `tests/behavior/steps/diagnostics-contradiction-detection.steps.ts`. Three scenarios per Acceptance criteria. UUID prefix `c2...`.

## Open questions

- **Self-loop contradiction.** A `contradicts` self-edge (A contradicts A) is structurally representable but semantically odd. v1 skips it. If user testing surfaces a case where this matters, add a sibling detector or extend the entry shape.
- **Amend-node and follow-up resolution.** v1 leaves the contradicts edge in place after an amend-node. A future enhancement might auto-propose a `break-edge` for the contradicts edge when an amend-node against one of its endpoints commits. Out of scope; recorded for a future task.
- **Mixed-direction pairs with different edge owners.** Per `docs/data-model.md` lines 179–185, contradictions are treated uniformly regardless of owner. The detector reports the pair without owner attribution; the moderator UI can read owner from `projection.getEdge(edgeId).createdBy` if it wants to render "A's contradicts" vs "B's contradicts" differently. No change to the detector API.

(All other questions settled.)
