# Stub: detect pending consequences (agreed-substance edges with unagreed-substance source)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.pending_consequences_stub`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.projection` (settled — including `per_facet_status_derivation` and `active_firing_computation`). Through it, `Projection.edges()`, `getNode`, `getEdge`, `visible` flags, `deriveFacetStatus`, and the `resolveSubstanceValue` helper pattern from `active-firing.ts`. Indirectly: the sibling diagnostics (`contradiction_detection`, `cycle_detection`, etc.) — this detector reuses their module-layout, pure-read shape, and barrel pattern.

## What this task is

Detect **pending consequences** in a session's visible graph. Per [`docs/data-model.md`](../../../docs/data-model.md) line 104:

> Future development: the system could surface "pending consequences" as a structural diagnostic — `agreed`-substance edges whose source substance is not yet agreed, signalling commitments that would fire if the source were established. Out of scope for v1; recorded as a possible future feature.

A pending consequence is the **inverse half** of active firing. `isEdgeActive` (per `docs/data-model.md` line 100) requires BOTH the edge's substance facet AND the source node's substance facet to be settled-agreed for the relation to take current effect; the methodology's defeater pattern (line 102) explicitly contemplates the asymmetric case where the edge substance has been agreed but the source has not — the `rebuts` "sits in the graph but does not currently fire. If the source ever becomes substantively established, the rebut activates." A pending consequence is exactly that asymmetric case generalized across every edge role: the participants have agreed the relation would hold conditional on the source, but they have not (yet) agreed the source.

The task delivers a **pure read function** over the projection: `detectPendingConsequences(projection: Projection): PendingConsequence[]` where `PendingConsequence = { edgeId: string; sourceNodeId: string; reason: 'source-substance-proposed' | 'source-substance-disputed' | 'source-substance-meta-disagreement' }`. The `reason` discriminator surfaces *why* the source is unagreed — three mutually exclusive cases drawn from `FacetStatus`'s non-settled values (`'proposed'`, `'disputed'`, `'meta-disagreement'`). The function lives in `apps/server/src/diagnostics/`, alongside `contradiction-detection.ts`.

## Why it needs to be done

The data-model doc explicitly defers this from v1 ("Out of scope for v1; recorded as a possible future feature"). The WBS note on the task captures the engineering case for landing it anyway: *"the detector is a small addition once the rest is in place."* With `isEdgeActive` already in place, `deriveFacetStatus` already derived, and a barrel of five sibling diagnostics already shipping, the detector itself is ~30 lines of filtering and tagging. Building it as a stub now means:

- The methodology semantics around defeaters (pre-committed `rebuts` whose source isn't yet substantively established) are testable structurally, not just narratively.
- The diagnostic event stream (`diagnostic_event_emission`, M2 sibling) does not need to surface this kind in v1; if user testing surfaces a need, the wiring is a one-liner — the detector already exists and is tested.
- A future v2 release can promote this from "stub" to "full diagnostic" by classifying it in `blocking_vs_advisory_classification` and wiring it into the event surface, without re-doing the detection logic.

Downstream consumers: the `diagnostic_event_emission` task may eventually consume this detector's output (the WBS pre-decision is that pending consequences are NOT wired into the v1 event stream — that's what makes this a "stub"). `blocking_vs_advisory_classification` will eventually need to classify pending consequences as advisory (per the doc's "signalling commitments" framing — pending consequences are informational, never blocking).

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) line 100 — active-firing rule (`edge.substance ∧ source.substance`, both settled-agreed). Pending consequences are the asymmetric case: edge-yes, source-no.
- [`docs/data-model.md`](../../../docs/data-model.md) line 102 — defeater pattern. A defeater has agreed substance on the `rebuts` edge but deliberately leaves the source substance unagreed. The defeater is the canonical worked example of a pending consequence.
- [`docs/data-model.md`](../../../docs/data-model.md) line 104 — the future-development paragraph that names this diagnostic and defers it from v1.
- [`apps/server/src/projection/active-firing.ts`](../../../apps/server/src/projection/active-firing.ts) — `isEdgeActive(projection, edgeId)`, plus the internal `statusEstablishesTruth` predicate and `resolveSubstanceValue` helper. The detector applies the same edge-substance check as `isEdgeActive`, then INVERTS the source-substance check (must NOT be settled-agreed).
- [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) — `deriveFacetStatus`. Returns one of `{'proposed', 'agreed', 'disputed', 'committed', 'withdrawn', 'meta-disagreement'}`. "Settled-agreed" is `status ∈ {'agreed', 'committed'}` AND effective value `'agreed'`; "not settled-agreed" is everything else.
- [`apps/server/src/diagnostics/contradiction-detection.ts`](../../../apps/server/src/diagnostics/contradiction-detection.ts) — sibling template. The module layout, pure-read shape, visibility-filter pattern, and `targetSubstanceFires` helper (a per-node firing check independent of `isEdgeActive`) all transfer here as a per-node *un*firing check.
- [`tasks/refinements/data-and-methodology/contradiction_detection.md`](./contradiction_detection.md) — sibling refinement. The "diagnostics module lives alongside projection," "no error type — empty graph → empty array," "filter in evaluation order," "no diagnostic event emission / classification (out of scope)" decisions all transfer.
- [`tasks/refinements/data-and-methodology/active_firing_computation.md`](./active_firing_computation.md) — companion. The defeater paragraph's structural shape (agreed `rebuts` substance, unagreed source substance) is the canonical pending-consequence example.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit + Cucumber+pglite integration.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Filter to visible edges only.** `edge.visible === true`. Broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate.
- **Edge substance MUST be settled-agreed.** `edge.substanceFacet`'s derived status must be in `{'agreed', 'committed'}` AND the effective substance value must be `'agreed'`. Same predicate as the first half of `isEdgeActive`; we don't reuse `isEdgeActive` directly because we want the source check to *fail* — calling `isEdgeActive` and negating would conflate "source unagreed" with "source missing / edge substance unagreed."
- **Source-node substance MUST NOT be settled-agreed.** The source's derived substance status is not in `{'agreed', 'committed'}`, OR it is but the effective value is `'disputed'`. In v1 the latter case (settled-but-value-disputed) is treated the same as the former — neither makes the consequence "pending" in the conventional sense (the source is settled, just settled-not-true) — and is excluded from the detector. See Decisions.
- **`reason` discriminator from `FacetStatus`.** `'source-substance-proposed'` when the source substance's derived status is `'proposed'`; `'source-substance-disputed'` when it is `'disputed'` (the unsettled disputed case — at least one participant has rejected the proposed value but no resolution has landed); `'source-substance-meta-disagreement'` when it is `'meta-disagreement'`. The three values cover the three non-settled `FacetStatus` outputs that the detector accepts. `'withdrawn'` is treated as `'disputed'` for reason-tagging purposes (a withdrawn-after-commit substance has returned to the disputed state per `data-model.md` line 80). See Decisions.
- **No agreed-source-with-disputed-value entries.** When the source substance is settled (`status ∈ {'agreed', 'committed'}`) but its value is `'disputed'`, the consequence is NOT pending — the methodology has agreed the source's content is not true, so the edge will never fire. Excluded.
- **Role-agnostic.** All edge roles participate (`supports`, `rebuts`, `qualifies`, `bridges-from`, `bridges-to`, `defines`, `contradicts`). The defeater is the worked example but every role has the same structural shape: edge substance agreed, source substance not yet agreed.
- **Self-loops included.** Unlike `contradicts` (where a self-loop is logically odd), a `supports` self-loop (a node supporting itself) is structurally representable and the pending-consequence rule applies the same way. v1 doesn't filter self-loops.
- **No memoization.** The function is pure; repeat calls are O(E) over the visible edges.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.** The eventual diagnostic event stream is the `diagnostic_event_emission` sibling and explicitly out of scope per the "stub" framing.
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/pending-consequences.test.ts` for the algorithm in isolation. Cucumber + pglite scenarios at `tests/behavior/diagnostics/pending-consequences.feature` with step defs in `tests/behavior/steps/diagnostics-pending-consequences.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/pending-consequences.ts` exports:
  - `detectPendingConsequences(projection: Projection): PendingConsequence[]`
  - `PendingConsequence` — interface `{ edgeId: string; sourceNodeId: string; reason: 'source-substance-proposed' | 'source-substance-disputed' | 'source-substance-meta-disagreement' }`.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `detectPendingConsequences` and the `PendingConsequence` type.
- Filter, in evaluation order:
  1. `edge.visible === true` — broken edges don't participate.
  2. Edge substance settled-agreed (status in `{'agreed', 'committed'}`, effective value `'agreed'`).
  3. Source-node present and visible.
  4. Source-node substance NOT settled-agreed.
     - If source substance status is `'agreed'` or `'committed'` AND effective value is `'agreed'` → exclude (this is an actively firing edge).
     - If source substance status is `'agreed'` or `'committed'` AND effective value is `'disputed'` → exclude (settled-not-true; the edge will never fire).
     - Otherwise (`'proposed'`, `'disputed'`, `'withdrawn'`, `'meta-disagreement'`) → include with the corresponding `reason`.
  5. `reason` mapping:
     - `'proposed'` → `'source-substance-proposed'`.
     - `'disputed'` or `'withdrawn'` → `'source-substance-disputed'`.
     - `'meta-disagreement'` → `'source-substance-meta-disagreement'`.
- Iteration order: `projection.edges()` insertion order (edge creation order). Deterministic for a given projection.
- `apps/server/src/diagnostics/pending-consequences.test.ts` covers:
  - Empty projection → no pending consequences.
  - Edge substance proposed → not a pending consequence (the relation itself isn't settled).
  - Edge substance agreed + source substance agreed → not a pending consequence (this is an active edge).
  - Edge substance agreed + source substance proposed → one pending consequence with `reason: 'source-substance-proposed'`.
  - Edge substance committed + source substance disputed → one pending consequence with `reason: 'source-substance-disputed'`.
  - Edge substance agreed + source substance meta-disagreed → one pending consequence with `reason: 'source-substance-meta-disagreement'`.
  - Non-visible edge (broken via committed `break-edge`) → excluded.
  - (Additional coverage: edge substance committed-disputed, source agreed → excluded; both substances settled with value disputed → excluded.)
- `tests/behavior/diagnostics/pending-consequences.feature` covers 2 DB-driven scenarios:
  1. **Pending consequence detected.** Build a session where the edge's substance is committed-agreed but the source node's substance is still in the proposed (uncommitted) state. Project; assert `detectPendingConsequences` returns one entry with the edge id, source node id, and `reason: 'source-substance-proposed'`.
  2. **Active edge, not a pending consequence.** Build a session where BOTH substances are committed-agreed. Project; assert `detectPendingConsequences` returns an empty list.
- Step defs in `tests/behavior/steps/diagnostics-pending-consequences.steps.ts`. Distinct UUID prefix (`c6...`) avoids scratch-state collision with the cycle-detection (`c1...`), contradiction-detection (`c2...`), multi-warrant (`c3...`), dangling-claim (`c4...`), coherency-hint (`c5...`), and other step files. Reuses `tests/behavior/support/event-rows.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `pending_consequences_stub` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; baseline preserved and extended.

## Decisions

- **Why "stub" — what is deferred per the WBS note.** Per `docs/data-model.md` line 104 the diagnostic is "out of scope for v1; recorded as a possible future feature." The WBS note ("Out of scope for v1 per data-model.md, but the detector is a small addition once the rest is in place") is honest about the v1 deferral while landing the detection logic. **What lands here**: the pure read function, its types, its unit tests, its integration tests, and its barrel re-export. **What does NOT land here**: wiring into the `diagnostic_event_emission` stream (sibling task, will choose whether to surface pending consequences in v1); inclusion in `blocking_vs_advisory_classification` (sibling task, will choose whether to classify pending consequences at all in v1); any UI surface (moderator console / audience broadcast) that renders pending consequences. The detector is callable and tested but is not currently consumed by any production code path. Re-promoting from "stub" to "full diagnostic" in a later release is wiring-only — no detection-logic work.
- **Where the diagnostics module lives.** `apps/server/src/diagnostics/pending-consequences.ts`, alongside `contradiction-detection.ts`. Same pattern as the sibling detectors: a pure read function, its own file, re-exported through the diagnostics barrel.
- **Public API.**
  - `detectPendingConsequences(projection: Projection): PendingConsequence[]` — single-call detector, returns the full set of pending consequences in the current projection.
  - `PendingConsequence = { edgeId: string; sourceNodeId: string; reason: 'source-substance-proposed' | 'source-substance-disputed' | 'source-substance-meta-disagreement' }`.
  - No error type. Empty projection → `[]`. Edges whose source node is missing → silently skipped (defensive, matching the sibling pattern).
- **Why we don't compose `!isEdgeActive`.** Negating `isEdgeActive` would catch four distinct cases: (a) edge substance not settled-agreed, (b) edge substance settled-agreed but source missing, (c) edge substance settled-agreed and source unagreed (the target case), (d) edge substance settled-agreed and source settled-disputed. The detector wants only case (c) — the "pending" framing means the consequence *would* fire if the source were agreed, which requires the edge to already be agreed. We pull apart the two halves of the conjunction so the edge-side check uses `isEdgeActive`'s edge-half predicate and the source-side check is the *inverse* of `isEdgeActive`'s source-half predicate. Internally this reuses the same `statusEstablishesTruth` and `resolveSubstanceValue` helper shape as `active-firing.ts` and `contradiction-detection.ts` (small duplication; deliberately — the helpers are 5 lines each and the alternative was a refactor of `active-firing.ts` to export them, out of scope for a stub).
- **Reason discriminator: `FacetStatus`-derived three-value enum.** Alternatives considered:
  - **Single boolean.** Loses the moderator-UI signal of *why* the consequence is pending (a proposed-but-not-yet-voted source is different from a disputed source with active rejection from a sibling refinement under-the-line of "advisory" / "block-resolution-needed"). The three-value form is information that costs nothing.
  - **Carry the raw `FacetStatus`.** Exposes `'withdrawn'` and `'agreed'` and `'committed'` as nominal possibilities that the detector by construction can never emit, broadening the type surface for downstream consumers. The narrower enum is cleaner.
  - **Per-participant breakdown.** Out of scope for a stub. The moderator UI could later read the per-participant facet state directly when rendering a pending consequence — the detector entry is the pointer.
- **`'withdrawn'` source substance → `'source-substance-disputed'` reason.** Per `docs/data-model.md` line 80, a withdrawn agreement returns the facet to a `disputed` state. The detector treats the two cases identically for reason-tagging (both are "the participants have not agreed on a substance value"); a downstream consumer that needs to distinguish withdrawn-from-committed vs. never-agreed can read the facet state directly via the edge id and source node id in the entry. The three-value discriminator is the minimal informative surface; we don't add a fourth `'source-substance-withdrawn'` value because (a) it's an instance of the disputed state per the doc, and (b) `'withdrawn'` is `deriveFacetStatus`-output-only — the dispatcher never writes it to `FacetState.status` — and surfacing it in the public type would create an externally visible derived-vs-stored distinction that the rest of the diagnostics API doesn't make.
- **Agreed-source-with-disputed-value → excluded.** When the source substance is `committed` with `value: 'disputed'`, the methodology has agreed the source's content is not true. The agreed-substance `supports` edge can never fire (its source will never establish), and the agreed-substance `rebuts` edge would activate against an already-settled-as-false target — neither qualifies as "pending" in the doc's framing ("would fire if the source were established"). Excluded; the same exclusion applies if the source's status is `'agreed'` with effective value `'disputed'` (pre-commit). Matches the symmetry of `isEdgeActive`'s value check.
- **Self-loops included.** Unlike `contradiction_detection`, where a `contradicts` self-edge is filtered (a logical absurdity), a `supports` self-edge with agreed substance and unagreed source is structurally a pending consequence by the same rule as a non-self-loop. v1 doesn't filter self-loops; if user testing surfaces them as noise, a sibling rule can be added later.
- **All edge roles included.** The defeater pattern motivates the diagnostic but doesn't limit it. A `supports` edge whose substance has been agreed but whose source's substance hasn't been agreed is symmetric in structure: "if the source were established, this support would activate." Filter to role would amount to "only detect pending consequences for `rebuts`," which the doc does not say.
- **Iteration order: `projection.edges()` insertion order.** Deterministic for a given projection, matches sibling detectors. Not user-meaningful but stable for tests.
- **No diagnostic event emission.** Out of scope. `diagnostic_event_emission` (M2 sibling) will choose whether to consume this detector's output in v1; the data-model doc's v1-deferral framing suggests it will not.
- **No blocking-vs-advisory classification.** Out of scope. `blocking_vs_advisory_classification` (M2 sibling) will classify pending consequences if and when they're surfaced; the doc's "signalling commitments" framing suggests advisory.
- **Test layout (Vitest).** `apps/server/src/diagnostics/pending-consequences.test.ts`. Reuses the same TS-literal-event seeding pattern as `contradiction-detection.test.ts` and `active-firing.test.ts` (`seedSession`, `createNode`, `createEdge`, `commitNodeAgreed`, `commitEdgeAgreed`, `commitBreakEdge`, plus a new `markSourceMetaDisagreement` helper inlined per the sibling-file pattern).
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/pending-consequences.feature` + `tests/behavior/steps/diagnostics-pending-consequences.steps.ts`. Two scenarios per Acceptance criteria. UUID prefix `c6...`.

## Open questions

- **Whether v1 surfaces pending consequences at all.** Decided "no" by the data-model doc's deferral, but the detector is built so the answer can change without re-doing detection work. If `diagnostic_event_emission` chooses to surface pending consequences in v1, this refinement does not need to be re-opened — the detector is ready to be wired in.
- **Per-participant reason granularity.** A `'source-substance-disputed'` consequence could carry "Anna disputes, others agreed" granularity; v1 returns the role-agnostic discriminator only. Recorded for a future enhancement.

(All other questions settled.)

## Status

**Done — 2026-05-10.** Stub diagnostic landed per the WBS note's "small addition once the rest is in place" framing.

Artifacts:
- `apps/server/src/diagnostics/pending-consequences.ts` — `detectPendingConsequences(projection): PendingConsequence[]` plus the `PendingConsequence` type.
- `apps/server/src/diagnostics/index.ts` — barrel re-exports `detectPendingConsequences` and `PendingConsequence`.
- `apps/server/src/diagnostics/pending-consequences.test.ts` — 10 Vitest cases covering the seven Acceptance-criteria scenarios plus three boundary checks (committed-disputed edge, settled-not-true source, defeater-style `rebuts`).
- `tests/behavior/diagnostics/pending-consequences.feature` — 2 Cucumber scenarios (one positive: edge committed-agreed + source still proposed → pending consequence with reason `source-substance-proposed`; one negative: both substances committed-agreed → empty list).
- `tests/behavior/steps/diagnostics-pending-consequences.steps.ts` — step defs with UUID prefix `c6...` (free; no scratch-key collisions with existing diagnostics step files at `c1`–`c5`).

What ships per "stub" framing: the detector is callable and tested but is NOT wired into `diagnostic_event_emission` or classified by `blocking_vs_advisory_classification` in v1. Re-promoting to full diagnostic in a later release is wiring-only — no detection-logic work. See Decisions for the deferral rationale.

Test counts:
- Vitest: 536 passed (was 526; +10 new pending-consequences cases).
- Cucumber: 104 scenarios passed (was 102; +2 new pending-consequences scenarios), 511 steps total.
- Playwright smoke: 1 passed (unchanged).

WBS bookkeeping: `tasks/10-data-and-methodology.tji` carries `complete 100` for `pending_consequences_stub` plus the `note "Refinement: ..."` link. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent (clean parse). `make test` end-to-end green.

### Note for the future full-implementation (annotation-endpoint skip)

When this stub is promoted to a full diagnostic, the **annotation-endpoint skip carries forward unchanged**: pending-consequences must not surface findings on annotation-endpoint edges (N→A, A→N, A→A), because annotations carry no substance facet (`ProjectedAnnotation` has no `substanceFacet` field) — there is no source substance for an annotation endpoint to be "unagreed" about. This holds for any new substance-facet walk the full implementation adds (target-node substance, transitive source-of-source, etc.). Decided in [`diagnostics_annotation_endpoint_semantics_audit`](./diagnostics_annotation_endpoint_semantics_audit.md) D5; the skip lives at `apps/server/src/diagnostics/pending-consequences.ts`. This note replaces the former standing `pending_consequences_annotation_endpoint_revisit` task + trigger-gate, which were descoped 2026-05-30 (a pre-decided one-sentence conclusion does not warrant a gated re-audit slot) — see [`pending_consequences_annotation_endpoint_revisit.md`](./pending_consequences_annotation_endpoint_revisit.md) Status.
