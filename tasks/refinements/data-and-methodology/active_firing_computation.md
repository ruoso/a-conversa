# Compute active firing for each edge (`edge.substance ∧ source.substance`)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.projection.active_firing_computation`
**Effort estimate**: 0.5d
**Inherited dependencies**: `per_facet_status_derivation` (settled — `deriveFacetStatus` exists and is the read-side complement of `replay.ts`'s tightened vote/commit/meta-disagreement-marked handlers). Through that, also depends on `projection_data_structure`, `project_from_log`, `project_incrementally`.

## What this task is

Expose **active firing** for edges as a small, pure read function over the projection. An edge "fires" — does work in the visible graph (a `supports` actually supports, a `contradicts` actually obtains, a `rebuts` actually defeats) — iff **both** the edge's `substance` facet *and* its source node's `substance` facet are settled in a way that establishes truth. The function is `isEdgeActive(projection, edgeId): boolean`, with a sibling bulk variant `getActiveFiring(projection): Map<string, boolean>` for whole-graph walks.

This task is a primitive. The structural-diagnostics task family (`cycle_detection`, `contradiction_detection`, `multi_warrant_detection` — M2) consumes it to filter the graph to actively-firing edges before running their checks. This task does **not** detect cycles, contradictions, or multi-warrant patterns; those are downstream consumers.

## Why it needs to be done

[`docs/data-model.md`](../../../docs/data-model.md) paragraph at line 100:

> Whether the relation is **actively firing** on the graph right now — whether the data actually supports, whether the contradiction actually obtains, whether the warrant actually licenses the inference — is the conjunction `edge.substance ∧ source.substance`. Both must be `agreed` for the relation to take current effect.

And paragraph at line 102 (the defeater pattern):

> a defeater is a regular node (the retraction condition, with its own `wording`, `classification`, `substance` facets) plus a `rebuts` edge to the defeated target whose substance is `agreed` but whose source's substance is not yet `agreed`. The pre-commitment is structural; the rebut sits in the graph but does not currently fire. If the source ever becomes substantively established, the rebut activates.

The active-firing concept is what distinguishes the **visible structure** of the graph (an edge exists between two nodes with a recorded role) from the **logical force** of that structure (the edge currently does work in the methodology). Without a primitive that answers "is this edge currently firing?", every downstream consumer that wants to reason about the active graph (the cycle detector, the contradiction detector, the moderator-UI "active edges" overlay, the audience-broadcaster "what's currently in force") would re-implement the conjunction at its call site and drift.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) lines 88–108 (edges section: facets, conditional reading, active firing, defeaters).
- [`docs/methodology.md`](../../../docs/methodology.md) — agreement / commit / withdrawal lifecycle (settled in `per_facet_status_derivation`).
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge`, `ProjectedNode`, `FacetState`, the widened `FacetStatus` union (`'proposed' | 'agreed' | 'disputed' | 'committed' | 'withdrawn' | 'meta-disagreement'`).
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection.getEdge`, `getNode`, `edges()`.
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatus(projection, entityKind, entityId, facet): FacetStatus`. The read-side primitive this task composes.
- [`tasks/refinements/data-and-methodology/per_facet_status_derivation.md`](./per_facet_status_derivation.md) — the prior task's refinement. Especially the seven-rule decision table: `'agreed'` means every current participant has voted agree (no commit yet); `'committed'` means agreed-plus-moderator-commit; `'withdrawn'` means commit-then-withdraw.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest for the in-memory computation; Cucumber + pglite for at least one DB-driven scenario.

## Constraints / requirements

- Pure read function; no DB access; no side effects on the projection. Composes `deriveFacetStatus` rather than re-reading per-participant state directly — keeps the "what counts as settled?" logic in one place.
- Active firing depends on the **edge's** substance facet AND the **source node's** substance facet. Per the data-model paragraph it does **not** depend on the target node's substance — this is the asymmetry that gives defeaters their semantics (a rebut on a not-yet-agreed source sits inert; once the source becomes agreed, the rebut activates against its target regardless of target state). The implementation must reflect this asymmetry.
- "Settled in a way that establishes truth" for active firing covers `'agreed'` and `'committed'` (both are positive-truth derived statuses that mean every current participant agrees, with or without the moderator's commit having landed yet). `'withdrawn'`, `'disputed'`, `'proposed'`, `'meta-disagreement'` do **not** establish truth and therefore do **not** fire. The data-model doc says "Both must be `agreed`" in literal terms; per the agreement-then-commit progression in `docs/methodology.md` and the per_facet_status_derivation decision table, `'committed'` is `'agreed'`-plus-commit (the same truth content, stronger commitment) — both qualify. `'withdrawn'` is explicitly the case where a previously-committed facet has been overturned and therefore no longer establishes truth; it is **not** firing. (Verification path: the active-firing tests assert both `'agreed'` and `'committed'` substance facets fire; `'withdrawn'` does not.)
- Additionally, the edge's substance **value** must be `'agreed'` (not `'disputed'`) — `set-edge-substance` proposals can propose either value; an edge whose substance facet is `'committed'` with value `'disputed'` represents a settled rejection ("the relation does not hold") and must **not** fire. Same for the source node's substance facet value: a committed `'disputed'` substance on the source means the source's content is settled-false and does not establish truth. The function checks the **effective** substance value is `'agreed'` in addition to status being `'agreed' | 'committed'`. Post-commit, `FacetState.value` is the authoritative value (the commit handler writes it). Pre-commit, `FacetState.value` is `null` (the dispatcher only stores the value at commit time) — for the pre-commit `'agreed'` case the implementation resolves the value by reading any one of the `perParticipant` entries' `proposalEventId` and looking the proposal up in `projection.getPendingProposal` (or `getCommittedProposal` as a fallback) for its payload's `value`. All per-participant entries reference the same proposal in the all-agree case, so any of them suffices.
- If the edge id is unknown to the projection: throw `ActiveFiringComputationError` (mirroring `FacetStatusDerivationError` in shape). The consumer is expected to know the edge exists; a typo should fail loudly. If the source node referenced by the edge is unknown to the projection: throw `ActiveFiringComputationError` (this would be a projection-invariant violation — the dispatcher would have rejected the edge-created event — but the read function defends against the case anyway).
- Lazy / not memoized. Each call is O(participants) — `deriveFacetStatus` is O(participants), and `isEdgeActive` calls it twice (edge substance + source-node substance). For a session of plausible size this is negligible. The sibling `projection_caching` task (M2) addresses whole-projection memoization; this function stays pure and re-derives on each call.
- No new event payloads, `ProjectionChange` discriminators, or shared-types schemas. The eventual WS broadcaster (downstream task) may want to surface an `EdgeActiveChanged` event on transitions, but that's not this task — adding to the change-feed enum has compatibility implications and the broadcaster doesn't exist yet.
- Verifications per ADR 0022: Vitest unit tests at `apps/server/src/projection/active-firing.test.ts` for the in-memory computation; one Cucumber + pglite feature at `tests/behavior/projection/active-firing.feature` with step defs in `tests/behavior/steps/projection-active-firing.steps.ts` for the DB-round-trip path.

## Acceptance criteria

- `apps/server/src/projection/active-firing.ts` exports:
  - `isEdgeActive(projection, edgeId): boolean`
  - `getActiveFiring(projection): Map<string, boolean>` — whole-graph variant; returns one entry per edge in the projection. Useful for diagnostics and downstream bulk processing.
  - `ActiveFiringComputationError` (class extending `Error`, mirroring `FacetStatusDerivationError`).
- `apps/server/src/projection/index.ts` re-exports `isEdgeActive`, `getActiveFiring`, `ActiveFiringComputationError`.
- The implementation calls `deriveFacetStatus(projection, 'edge', edgeId, 'substance')` and `deriveFacetStatus(projection, 'node', sourceNodeId, 'substance')`; returns `true` iff both statuses are in `{'agreed', 'committed'}` AND both facet values are `'agreed'`.
- `apps/server/src/projection/active-firing.test.ts` covers (see Decisions for the full list): proposed → not active; partial agree → not active; edge agreed + source proposed → not active; both agreed → active; both committed → active; one withdrawn → not active; either meta-disagreement → not active; substance value `'disputed'` (even when status is committed) → not active; missing edge → throws; missing source node → throws (constructed by surgery on the projection state since the dispatcher won't let this happen organically); `getActiveFiring` round-trip vs. `isEdgeActive`; property-style random projection vs. a hand-rolled reference.
- `tests/behavior/projection/active-firing.feature` covers: an edge becomes active after both endpoints' substance commits (positive case); same setup but skip the source-node-substance commit → inactive.
- `pnpm run test:smoke` green; `pnpm run test:behavior:smoke` green; `make test` end-to-end green.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `active_firing_computation` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.

## Decisions

- **Where the computation lives.** New file `apps/server/src/projection/active-firing.ts`. Same module shape as `facet-status.ts` — pure read function, no DB, single small export surface.
- **Function signatures.**
  - `isEdgeActive(projection: Projection, edgeId: string): boolean` — single-edge query.
  - `getActiveFiring(projection: Projection): Map<string, boolean>` — bulk variant. Returns a `Map<edgeId, boolean>` with one entry per edge in `projection.edges()`. Iteration order matches `projection.edges()` (insertion order — the Map preserves it). For diagnostics: walk the whole graph in one pass; the consumer can filter `.entries()` to active-only.
  - `ActiveFiringComputationError extends Error` — thrown on missing edge or missing source node.
- **The firing rule (final).** An edge fires iff:
  1. `deriveFacetStatus(projection, 'edge', edgeId, 'substance')` returns `'agreed'` or `'committed'`, AND the edge's `substanceFacet.value === 'agreed'`.
  2. `deriveFacetStatus(projection, 'node', edge.sourceNodeId, 'substance')` returns `'agreed'` or `'committed'`, AND the source node's `substanceFacet.value === 'agreed'`.

  Both conditions must hold. Target-node substance does NOT participate (per the data-model doc paragraph 100 and the defeater paragraph 102 — defeater semantics specifically require target state to NOT block firing once the source is agreed).
- **Why `'agreed'` and `'committed'` both qualify; `'withdrawn'` does not.** Per the per_facet_status_derivation decision table:
  - `'agreed'` = every current participant has voted agree, no commit yet. This is the methodology's pre-commit "everyone-voted-agree" state. The truth content is settled by the participants; the moderator's commit is the next ritual step. The data-model doc's literal wording ("Both must be `agreed`") was written before the per_facet_status_derivation refinement split agreement-status from derived-status; in the post-derivation vocabulary, `'agreed'` and `'committed'` are both the truth-establishing states.
  - `'committed'` = `'agreed'` + moderator commit. Strictly stronger than `'agreed'`. Fires.
  - `'withdrawn'` = was committed, then a participant withdrew. The withdrawal supersedes the commit; the facet no longer establishes truth. Does NOT fire.
  - `'disputed'`, `'proposed'`, `'meta-disagreement'`: truth not established. Do NOT fire.
- **Why the value matters in addition to the status.** A `set-edge-substance` proposal carries a `value: 'agreed' | 'disputed'` — participants can propose-and-commit that the relation does NOT hold ("we agree this rebut does not actually rebut"). Such a facet reaches derived status `'committed'` but with `value: 'disputed'` — the relation is settled-not-holding; it must not fire. Same for nodes: a `set-node-substance` with `value: 'disputed'` reaches `'committed'` status but means "the content is settled-false." The active-firing check inspects both the derived status AND `substanceFacet.value` to distinguish settled-true from settled-false.
- **Target node substance does NOT participate.** Per the data-model paragraph 100, firing is `edge.substance ∧ source.substance`. The target's substance is independent — a `supports` edge can fire when the target is `proposed` (the supports relation is now actively pushing toward the target; whether the target itself is settled is the next thing to debate). The defeater pattern in paragraph 102 explicitly relies on this: a `rebuts` edge with `agreed` substance, `agreed` source, `not-yet-agreed` target fires (the source rebuts the target, even if the target hasn't been substantively established). If a future feature requires target-substance participation for a specific edge role, that's a downstream extension; this task implements the doc's exact rule.
- **Errors.**
  - Edge id not in `projection.edges()` → throw `ActiveFiringComputationError` with `edge ${id} not present in projection`.
  - Edge's `sourceNodeId` not in `projection.nodes()` → throw `ActiveFiringComputationError` with `edge ${id}: source node ${sourceId} not present in projection`. (Defensive — the dispatcher's `edge-created` handler validates source/target nodes exist; this throw catches a corrupted projection or a hand-constructed test case.)
  - `deriveFacetStatus` may itself throw `FacetStatusDerivationError` for an unknown entity; we wrap that by validating presence up-front so the active-firing error message is more specific.
- **`getActiveFiring` semantics.** Walks `projection.edges()` and calls `isEdgeActive` for each edge id. If `isEdgeActive` throws (which would mean a missing source node — every edge from `projection.edges()` is present by definition), the throw propagates: this is a real projection-invariant violation; surfacing it is the right behavior. Consumers that want a graceful per-edge handling can catch and recover; the default is loud.
- **No memoization.** The function is pure; repeat calls are well-defined. O(participants) per call. `projection_caching` (sibling task, downstream) is the right home for whole-projection caches; this primitive stays simple.
- **No `ProjectionChange` discriminator for active-edge transitions.** The eventual WS broadcaster may want to surface `EdgeActiveChanged` events when an edge transitions in/out of firing; that's not this task. Adding to the change-feed enum is a downstream concern with compatibility implications, and the broadcaster doesn't exist yet.
- **Test layout (Vitest).** `apps/server/src/projection/active-firing.test.ts`. Reuses the `seedSession` / `castVote` / `commit` pattern from `facet-status.test.ts` (events constructed as TS literals, `applyEvent` to a fresh projection). Cases:
  1. Edge with proposed substance, source proposed → not active.
  2. Edge agreed (no commit), source proposed → not active.
  3. Edge agreed, source agreed → **active** (both pre-commit, all-agree).
  4. Edge committed, source committed → **active**.
  5. Edge committed, source committed, then a participant withdraws the edge substance → not active.
  6. Edge committed, source committed, then a participant withdraws the source substance → not active.
  7. Meta-disagreement on the edge → not active.
  8. Meta-disagreement on the source node substance → not active.
  9. Edge `set-edge-substance` proposes value `'disputed'`, all agree + commit (derived status `'committed'`, value `'disputed'`) → not active (the relation is settled-not-holding).
  10. Same for the source node — committed disputed substance → not active.
  11. Property test: build a random projection with random edge / source-substance vote sequences against a fixed participant set; walk every edge; assert `isEdgeActive(...) === referenceImpl(...)` where the reference replicates the conjunction directly.
  12. `getActiveFiring(projection)` round-trip: produces a `Map<edgeId, boolean>` whose entries match `isEdgeActive(projection, edgeId)` for every edge.
  13. Throws `ActiveFiringComputationError` on an unknown edge id.
  14. Target-node substance does NOT affect firing — edge agreed, source agreed, target proposed → active; target disputed → still active.
- **Test layout (Cucumber + pglite).** `tests/behavior/projection/active-firing.feature` + `tests/behavior/steps/projection-active-firing.steps.ts`. Two scenarios:
  - Scenario 1 (positive): session-created + 3 participants + 2 nodes (source + target) + 1 `supports` edge + entity-included × 3 + `set-node-substance` proposal on the source node (value `'agreed'`) + 3 votes + commit + `set-edge-substance` proposal on the edge (value `'agreed'`) + 3 votes + commit. Project; assert `isEdgeActive(edgeId)` returns `true`.
  - Scenario 2 (negative): same as scenario 1 but the source-node-substance proposal is NOT committed (votes stop at 2 of 3 agree). Project; assert `isEdgeActive(edgeId)` returns `false`.

  Both scenarios reuse `tests/behavior/support/event-rows.ts` for inserts / selects / envelope mapping. Step ids use a distinct UUID prefix (`88888888-...`) to avoid scratch-state collision with the from-log, incremental, and facet-status step files.

## Open questions

(none — all decided)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/projection/active-firing.ts` — new file. Exports `isEdgeActive(projection, edgeId): boolean`, `getActiveFiring(projection): Map<string, boolean>`, and `ActiveFiringComputationError`. Pure read function over the projection; composes `deriveFacetStatus` for both the edge's substance facet and the source node's substance facet, plus a `resolveSubstanceValue` helper that reads the effective substance value from `FacetState.value` post-commit (set by the commit handler) or from the underlying proposal payload pre-commit (looked up via any `perParticipant` entry's `proposalEventId` in `pendingProposals` / `committedProposals`). An edge fires iff both facets' derived statuses are in `{'agreed', 'committed'}` AND both effective values are `'agreed'`. Target-node substance does not participate.
- `apps/server/src/projection/index.ts` — barrel re-exports `isEdgeActive`, `getActiveFiring`, `ActiveFiringComputationError`.

Tests:

- `apps/server/src/projection/active-firing.test.ts` — 19 cases. Coverage: edge with no proposal / partial-agree / agreed-only-on-edge / agreed-only-on-source → not active; both agreed (pre-commit) / both committed / edge agreed + source committed → active; withdrawal on either side → not active; meta-disagreement on either side → not active; committed with value `'disputed'` on either side → not active (settled rejection does not fire); target-node substance is irrelevant (still active when target is proposed or committed-disputed); `getActiveFiring` round-trips with `isEdgeActive` for every edge; throws `ActiveFiringComputationError` on unknown edge id; property-style test running a deterministic mulberry32 PRNG over six seeds, generating up to 30 random actions per seed (propose, vote, commit, meta-disagreement on either facet) and cross-checking `isEdgeActive` against a hand-rolled reference implementation that walks the simulated per-participant state directly.
- `tests/behavior/projection/active-firing.feature` — 2 scenarios, step defs in `tests/behavior/steps/projection-active-firing.steps.ts`. Coverage: an edge becomes active after both endpoints' substance commits (positive case, full round through pglite-stored events); the same setup with the source-node substance only partially voted (not committed) leaves the edge inactive. Both scenarios round-trip events through pglite's `session_events` (JSONB / TIMESTAMPTZ / BIGINT) and call `isEdgeActive` against the resulting projection.

`pnpm run test:smoke` green (283 tests, +19 over the prior baseline of 264). `pnpm run test:behavior:smoke` green (49 scenarios, +2 over the prior baseline of 47). `make test` end-to-end green (283 unit + 49 cucumber + 1 playwright). `tj3 project.tjp` parses clean.

`tasks/10-data-and-methodology.tji` updated: `complete 100` and `note "Refinement: ..."` added to `active_firing_computation`.
