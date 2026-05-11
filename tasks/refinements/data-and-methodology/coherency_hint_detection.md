# Detect unusual edge/kind configurations (coherency hints)

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.coherency_hint_detection`
**Effort estimate**: 1d
**Inherited dependencies**: `data_and_methodology.projection` (settled). Through it, `Projection.edges()`, `getNode`, `getEdge`, `getEdgesBySource`, `visible` flags on nodes and edges. Siblings: `cycle_detection`, `contradiction_detection`, `multi_warrant_detection`, `dangling_claim_detection` (all settled — same diagnostics-module layout and pure-read pattern carry over). Indirectly: `multi_warrant_detection` explicitly carves out its boundary with this task — multi-warrant counts only **complete** warrants (both bridge edges present); this task catches the **incomplete-warrant** case.

## What this task is

Detect **unusual edge/kind configurations** in a session's visible graph. Per [`docs/data-model.md`](../../../docs/data-model.md) lines 143–151 ("Coherency guidance") and 195–197 ("Coherency violations"):

> Some edge/node configurations are typical; others are unusual. The system provides advisory hints when an unusual configuration is created. … The list of typical/unusual patterns will grow with experience. The system never blocks; it nudges.

The task delivers a **pure read function** over the projection: `detectCoherencyHints(projection: Projection): CoherencyHint[]`. Each `CoherencyHint` is a member of a **discriminated union** keyed on a `HintKind` enum — different rules produce different shapes, but they share the discriminator. Internally the detector is a **list of rule functions**, each owning one `HintKind` and emitting hints for the conditions it owns; the public detector composes the rule list. New rules can be added by appending a rule function — the canonical example (per the `multi_warrant_detection` refinement and the WBS note) is "small rule set; rules can be added over time."

v1 ships three rules: two for the **incomplete-warrant** shapes (the canonical example) and one for **self-contradicts** (the doc-grounded oddity from the data-model.md catalog). The file lives in `apps/server/src/diagnostics/coherency-hint-detection.ts`, alongside the other detectors.

## Why it needs to be done

Per `docs/data-model.md` lines 143–151 and 195–197: coherency guidance is a primary part of how the methodology helps the moderator. Without a read-side signal, the moderator UI has no way to flag "this warrant has only a `bridges-from` — did you mean to wire the `bridges-to` too?" or "this `contradicts` edge points at the same node it came from — that's structurally odd." The data-model treats these as advisory, not blocking ("the system never blocks; it nudges") — exactly what a `CoherencyHint` is.

The `multi_warrant_detection` refinement (settled) explicitly **carves out the boundary** with this task: multi-warrant fires only on **complete** warrants (both `bridges-from` and `bridges-to` present); incomplete warrants are dropped from that detector's pass and are this detector's responsibility. Without coherency_hint_detection, incomplete warrants surface in no diagnostic at all — they fall through both detectors.

Downstream consumers: `diagnostic_event_emission` (M2 sibling) wires the detector's output into the event-stream surface; `blocking_vs_advisory_classification` (M2 sibling) classifies coherency hints alongside cycles / contradictions / multi-warrant / dangling-claim diagnostics. Per the doc's "advisory hints" framing, coherency hints are expected to land as advisory in that downstream classification. Both are separate tasks; this one delivers the detection logic only.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) lines 143–151 ("Coherency guidance") — the advisory-hints framing. "The list of typical/unusual patterns will grow with experience. The system never blocks; it nudges."
- [`docs/data-model.md`](../../../docs/data-model.md) lines 195–197 ("Coherency violations") — surfaces unusual configurations as advisory hints.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 122–131 ("Warrants and bridging") — the structural definition of a warrant: a regular node with two outgoing edges (`bridges-from` to D, `bridges-to` to C). An incomplete warrant — only one of the two — is structurally meaningless: there is no Toulmin step to detect. The doc's framing makes the incomplete case the canonical "did you mean to finish this?" prompt.
- [`docs/data-model.md`](../../../docs/data-model.md) line 120 (`contradicts` role) — "If a contradiction is genuinely symmetric (each rules out the other in the same way), it is represented as **two** `contradicts` edges in opposite directions; this avoids special-casing symmetric edges in storage and rendering." A `contradicts` edge with the same source and target is structurally odd: "this node conflicts with itself" is either a representation mistake (the author meant a different node) or a degenerate self-loop the moderator should examine.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection.edges()`, `getNode`, `getEdge`, `getEdgesBySource`. The detector uses `getEdgesBySource(warrantId)` to look up the warrant's outgoing edges efficiently (O(1) source-index lookup) — the same access pattern as `multi_warrant_detection`.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge` (`role`, `sourceNodeId`, `targetNodeId`, `visible`), `ProjectedNode` (`visible`).
- [`apps/server/src/diagnostics/multi-warrant-detection.ts`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — the explicit boundary partner. Its file header calls out "`coherency_hint_detection` (sibling task, not yet landed) catches **incomplete** warrants — a `bridges-from` without a matching `bridges-to`, or vice versa. This detector counts only **complete** warrants (both edges present and visible)." This task fills in the complementary half.
- [`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts), [`contradiction-detection.ts`](../../../apps/server/src/diagnostics/contradiction-detection.ts), [`dangling-claim-detection.ts`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) — sibling templates. Module layout, pure-read shape, visibility filter, and barrel pattern carry over.
- [`tasks/refinements/data-and-methodology/multi_warrant_detection.md`](./multi_warrant_detection.md) — the sibling refinement that explicitly hands off the incomplete-warrant case to this task. Quoted: "`coherency_hint_detection` (sibling, not yet landed) catches the **incomplete-warrant** shape (a `bridges-from` without a matching `bridges-to`, or vice versa); this task strictly handles the **two-or-more complete warrants on the same (D, C)** shape."
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit + Cucumber+pglite integration.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Rule-registry pattern.** Internally the detector is a list of **rule functions**, each `(projection) => CoherencyHint[]`. The public `detectCoherencyHints` concatenates each rule's output. A new rule is added by writing a new function and appending it to the rule list — this is the explicit extensibility model the WBS note calls out ("small rule set; rules can be added over time").
- **Discriminated union shape.** `CoherencyHint` is a discriminated union keyed on `HintKind`. Different rules emit different payload shapes; the `kind` field is always the discriminator. The discriminator enum is exported alongside the union so downstream consumers (the eventual moderator UI and `diagnostic_event_emission`) can switch on it.
- **v1 rule set.** Three rules, all doc-grounded:
  1. `'incomplete-warrant-missing-bridges-to'` — for each node W that has at least one visible `bridges-from` outgoing edge AND zero visible `bridges-to` outgoing edges, emit one hint per `bridges-from` carrying `{ warrantNodeId, dataNodeId }`. The canonical "warrant wired to data but not to a claim" case.
  2. `'incomplete-warrant-missing-bridges-from'` — the mirror. For each node W that has at least one visible `bridges-to` outgoing edge AND zero visible `bridges-from` outgoing edges, emit one hint per `bridges-to` carrying `{ warrantNodeId, claimNodeId }`.
  3. `'self-contradicts'` — for each visible `contradicts` edge where `sourceNodeId === targetNodeId`, emit one hint carrying `{ edgeId, nodeId }`. Doc-grounded per line 120 (the symmetric-contradicts case is supposed to be represented as **two opposite-direction** edges; a self-loop is the degenerate case that doesn't fit that representation).
- **Filter to visible edges only.** `edge.visible === true`. Broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate. Per `docs/data-model.md` lines 287–293 invisible edges don't participate in any structural reasoning.
- **Filter to visible endpoint nodes.** For every edge consulted, both endpoint nodes must exist on the projection and be visible. The projection cascades endpoint visibility, but the detector mirrors the sibling detectors' defensive guard.
- **No substance-agreement gate.** Per `docs/data-model.md` lines 143–151 the coherency hints are about **structure** ("Some edge/node configurations are typical; others are unusual"). They don't depend on whether any node's or edge's substance facet has been agreed. This mirrors the multi-warrant and dangling-claim detectors' structural-only stance. Contrast cycle and contradiction detection, both of which gate on `isEdgeActive`.
- **No memoization.** The function is pure; repeat calls walk visible edges. The sibling `projection_caching` task addresses whole-projection caching.
- **Hints from one rule do not suppress hints from another rule.** A node that is both an incomplete warrant AND has a self-contradicts edge produces hints from both rules. The rules are independent.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.** The detector reads `Projection` and `EdgeRole` only.
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/coherency-hint-detection.test.ts` for the algorithm in isolation. Cucumber + pglite scenarios at `tests/behavior/diagnostics/coherency-hint-detection.feature` with step defs in `tests/behavior/steps/diagnostics-coherency-hint-detection.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/coherency-hint-detection.ts` exports:
  - `detectCoherencyHints(projection: Projection): CoherencyHint[]`
  - `CoherencyHint` — discriminated union over `HintKind`.
  - `HintKind` — string-literal union type (or const-object) covering the v1 rules: `'incomplete-warrant-missing-bridges-to' | 'incomplete-warrant-missing-bridges-from' | 'self-contradicts'`.
  - Each variant of `CoherencyHint`:
    - `IncompleteWarrantMissingBridgesToHint = { kind: 'incomplete-warrant-missing-bridges-to'; warrantNodeId: string; dataNodeId: string }`
    - `IncompleteWarrantMissingBridgesFromHint = { kind: 'incomplete-warrant-missing-bridges-from'; warrantNodeId: string; claimNodeId: string }`
    - `SelfContradictsHint = { kind: 'self-contradicts'; edgeId: string; nodeId: string }`
- `apps/server/src/diagnostics/index.ts` barrel re-exports `detectCoherencyHints`, `CoherencyHint`, `HintKind`, and the three per-rule hint types.
- Filter, in evaluation order, for each rule:
  - **Incomplete-warrant rules.** For each visible node `W` (skip invisible), use `getEdgesBySource(W.id)` to enumerate W's outgoing edges. Count visible `bridges-from` and `bridges-to` outgoing edges (only with visible endpoint nodes). Emit one hint per `bridges-from` (with no `bridges-to`) or per `bridges-to` (with no `bridges-from`) accordingly.
  - **Self-contradicts rule.** For each visible `contradicts` edge with `sourceNodeId === targetNodeId` and a visible endpoint node, emit one hint.
- Iteration order: rules run in declaration order; within each rule, the iteration order is the projection's natural order (`nodes()` insertion order for the warrant rules; `edges()` insertion order for the self-contradicts rule). Deterministic for a given projection.
- `apps/server/src/diagnostics/coherency-hint-detection.test.ts` covers:
  - Empty projection → no hints (the registry composes to `[]`).
  - **Complete warrant → no hints** (positive case for the incomplete rules — both bridge edges present means neither incomplete rule fires).
  - **Warrant with only `bridges-from`** → one `incomplete-warrant-missing-bridges-to` hint with the correct `warrantNodeId` and `dataNodeId`.
  - **Warrant with only `bridges-to`** → one `incomplete-warrant-missing-bridges-from` hint with the correct `warrantNodeId` and `claimNodeId`.
  - **Warrant with multiple `bridges-from` and no `bridges-to`** → one hint per `bridges-from` (the warrant is incomplete with respect to each data node).
  - **Warrant with only `bridges-from` whose `bridges-to` exists but is invisible** → one `incomplete-warrant-missing-bridges-to` hint (visibility filter).
  - **Isolated node** (no outgoing edges) → no hints (the warrant rules require at least one bridge edge to consider the node a warrant candidate).
  - **Self-`contradicts` edge** (source === target) → one `self-contradicts` hint.
  - **Non-self `contradicts` edge** (source !== target) → no `self-contradicts` hint.
  - **Self-`contradicts` edge that is invisible** → no hint.
  - **Multiple hints in one projection.** A projection containing one incomplete warrant AND one self-contradicts produces two hints — one of each kind.
  - **Two incomplete warrants of different kinds in one projection** produce two hints, one of each kind, in rule-declaration order.
- `tests/behavior/diagnostics/coherency-hint-detection.feature` covers 2 DB-driven scenarios:
  1. **Incomplete warrant detected.** Build a session with data node D, warrant node W, and a `W → D bridges-from` edge but no `bridges-to`; include all entities. Project; assert `detectCoherencyHints` returns one `incomplete-warrant-missing-bridges-to` entry naming W and D.
  2. **Complete warrant — no hint.** Same setup with W, D, C and both bridge edges (`W → D bridges-from`, `W → C bridges-to`). Project; assert `detectCoherencyHints` returns no `incomplete-warrant-*` entries (and no entries at all, since neither rule fires).
- Step defs in `tests/behavior/steps/diagnostics-coherency-hint-detection.steps.ts`. Distinct UUID prefix (`c5...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), multi-warrant-detection (`c3...`), dangling-claim-detection (`c4...`), and other step files. Reuses `tests/behavior/support/event-rows.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `coherency_hint_detection` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; existing 513 vitest + 100 cucumber baseline preserved and extended.

## Decisions

- **Where the diagnostics module lives.** `apps/server/src/diagnostics/coherency-hint-detection.ts`, alongside the four sibling detectors. Same pattern: a pure read function, its own file, re-exported through the diagnostics barrel.
- **Public API.**
  - `detectCoherencyHints(projection: Projection): CoherencyHint[]` — single-call detector, returns the concatenated rule output.
  - `CoherencyHint` — discriminated union over `kind: HintKind`. Each variant has a distinct payload; downstream code switches on `kind`.
  - `HintKind` — the `kind` discriminator: `'incomplete-warrant-missing-bridges-to' | 'incomplete-warrant-missing-bridges-from' | 'self-contradicts'`. Exported as a string-literal type alias so downstream code can use it in `switch` statements with exhaustive checking.
  - No error type. Empty graph → `[]`.
- **Rule-registry composition.** Internally the file declares one function per rule (`detectIncompleteWarrantsMissingBridgesTo(projection)`, `detectIncompleteWarrantsMissingBridgesFrom(projection)`, `detectSelfContradicts(projection)`) and a module-level `RULES: ReadonlyArray<(p: Projection) => CoherencyHint[]>` list. `detectCoherencyHints` reduces the rules list with `flatMap`. This is the registry pattern the WBS note describes — a new rule is one function plus one append. The rule functions are not exported individually (the public surface is one detector; the rules are an implementation detail).
- **v1 rule set: three rules, all doc-grounded.** Picked from the data-model.md catalog with rationale:
  - **`incomplete-warrant-missing-bridges-to`** and **`incomplete-warrant-missing-bridges-from`** — per `docs/data-model.md` lines 122–131. A warrant is defined as a node with TWO outgoing edges (`bridges-from` + `bridges-to`); one without the other is structurally meaningless. The `multi_warrant_detection` refinement explicitly hands off this case to coherency_hint_detection ("incomplete warrants are dropped from the (D, C) group on this pass; the `coherency_hint_detection` sibling task surfaces those" — refinement, Constraints section). Skipping these rules would leave incomplete warrants undetected by any diagnostic.
  - **`self-contradicts`** — per `docs/data-model.md` line 120. The data model is explicit that genuinely-symmetric contradictions are encoded as **two opposite-direction edges**, not as a single self-loop. A `contradicts` edge whose source equals its target is the degenerate case the encoding doesn't anticipate; the moderator should examine it (typo? intended self-conflict?). Simple, structural, no extra dependencies — a clean second seed-rule for the registry.
- **What v1 does NOT ship (deferred to future rules):**
  - **Cross-kind oddities** (e.g., `supports` from a `value` node to a `fact` node, per the doc's coherency-guidance examples). These require reading `node.classificationFacet.value`, which means the classification has to be committed to be detectable. The dependency on committed-classification state pulls in `per_facet_status_derivation`'s output semantics, which a v1 detector can take as given, but the per-rule wording would need careful spec ("typical" vs "unusual" enumerations come from the data-model catalog; that catalog is sparse today). Deferred until the doc enumerates a denser typical/unusual catalog, or until user testing surfaces specific cross-kind patterns that come up in real debates.
  - **`definitional` receiving `supports`** — was considered, but the doc's example `defines from a definitional node to a claim node` is listed as **typical**; the doc doesn't enumerate the inverse as unusual. Adding it would require an editorial call beyond the doc, which is what the registry pattern lets a future rule do without disrupting v1.
  - **Adjusting `defines` directionality assumptions** — out of scope; the data model treats `defines` as a directed edge (source defines target). The detector doesn't second-guess direction.
- **No substance-agreement gate (structural-only detection).** Per `docs/data-model.md` lines 143–151 the coherency hints are about **structure** — "edge/node configurations." A warrant with only one bridge edge is structurally incomplete whether or not the substance of either edge is agreed. A self-`contradicts` edge is structurally odd whether or not anyone has agreed it actually contradicts. This mirrors the multi-warrant and dangling-claim detectors' structural-only stance.
  - **What we DO require:** edge `visible === true` and both endpoint nodes visible (defensive guard).
  - **What we don't require:** `isEdgeActive`, substance facet agreement, any per-participant agreement state.
- **Iteration order.** Rules run in declaration order. Within each rule, the rule iterates the projection's natural order (`nodes()` insertion order for the warrant rules; `edges()` insertion order for self-contradicts). Two runs against the same projection emit the same sequence of hints.
- **A node with multiple `bridges-from` (but no `bridges-to`) emits multiple hints.** Each `bridges-from` edge represents a (warrant, data) pair that lacks the corresponding bridges-to; reporting one hint per data node lets the UI render each pair individually. The mirror case for multiple `bridges-to` is symmetric. The alternative — emit one hint per warrant node, regardless of how many bridge edges — would lose the data-node-id payload that downstream code needs. The current shape mirrors the data-model.md's per-edge framing.
- **Self-contradicts is per-edge, not per-node.** A node can in principle have multiple visible `contradicts` self-edges (different `edgeId`s with the same source = target). The rule emits one hint per such edge, carrying both `edgeId` (so the moderator UI can highlight the specific edge) and `nodeId` (so it can highlight the node).
- **No diagnostic event emission.** Out of scope. `diagnostic_event_emission` (M2 sibling) consumes this detector's output.
- **No blocking-vs-advisory classification.** Out of scope. `blocking_vs_advisory_classification` (M2 sibling) classifies each diagnostic kind. Per the doc's "advisory hints" framing, coherency hints are expected to land as advisory.
- **Test layout (Vitest).** `apps/server/src/diagnostics/coherency-hint-detection.test.ts`. Reuses the same TS-literal-event seeding pattern as the sibling detectors. Helpers inlined per the sibling-file pattern. Tests construct minimal projections (no commit-substance — purely structural).
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/coherency-hint-detection.feature` + `tests/behavior/steps/diagnostics-coherency-hint-detection.steps.ts`. Two scenarios per Acceptance criteria. UUID prefix `c5...`.

## Open questions

- **`HintKind` as string literals vs. enum.** Chose string-literal union (no runtime enum) for the same reasons the rest of the codebase uses string-literal unions on event `kind` discriminators (per `shared-types/src/events.ts` style): smaller bundle, simpler discriminated-union narrowing, no enum-import overhead. If future surfaces want a runtime listing of all hint kinds, an `ALL_HINT_KINDS` const-array can be added without changing the type.
- **Per-hint severity / advisory grouping.** Out of scope here. `blocking_vs_advisory_classification` (M2 sibling) is the home for severity. The detector emits hints as-is; severity is applied downstream. If a future hint kind is genuinely error-level rather than advisory, it can land as a different `HintKind` value and the downstream classifier handles the routing.
- **A warrant with zero outgoing bridge edges.** A node that isn't yet a warrant at all — no bridges-from, no bridges-to — is not a warrant candidate and emits no hint. The rules require at least one bridge edge to consider the node. (Alternative: emit a "node tagged as warrant but no edges" hint, but there's no "tagged as warrant" facet today — warrants are identified structurally by the bridge edges. The current shape is the right v1 reading.)
- **Self-`bridges-from` or self-`bridges-to` (warrant bridging to itself).** Structurally representable. The current v1 rules don't single these out; if the warrant has both edges (even self-referential ones), no incomplete-warrant hint fires. The `multi_warrant_detection` refinement Open Questions section notes this as a possible filter to add later; this detector mirrors the choice — neither detector special-cases self-bridges.
- **Future rules from a denser doc catalog.** `docs/data-model.md` lines 143–151 enumerates a few examples (value-to-fact `supports`, definitional-to-value `rebuts`) but explicitly says "the list will grow with experience." When that list grows, each new pattern becomes a new rule appended to the registry — that's the explicit extension point this task delivers.

(All other questions settled.)

## Status

**Done** 2026-05-10.

Implementation:

- `apps/server/src/diagnostics/coherency-hint-detection.ts` — new file. Exports `detectCoherencyHints(projection): CoherencyHint[]` plus the `CoherencyHint` discriminated union, the `HintKind` discriminator type, and the three per-rule hint interfaces (`IncompleteWarrantMissingBridgesToHint`, `IncompleteWarrantMissingBridgesFromHint`, `SelfContradictsHint`). Pure read function over the projection. Internally, the file declares three rule functions (one per `HintKind`) and a module-private `RULES` registry; `detectCoherencyHints` reduces the registry with `flatMap`. v1 rules: (1) `incomplete-warrant-missing-bridges-to` — walks `projection.nodes()`, uses `getEdgesBySource(node.id)`, emits one hint per dangling `bridges-from` when the node has zero visible `bridges-to`; (2) `incomplete-warrant-missing-bridges-from` — symmetric mirror; (3) `self-contradicts` — walks `projection.edges()`, emits one hint per visible `contradicts` edge where `sourceNodeId === targetNodeId`. Structural-only filter — visibility only, no `isEdgeActive` gate, no substance-agreement check (per `docs/data-model.md` lines 143–151 — a deliberate divergence from the cycle / contradiction sibling detectors, matching the multi-warrant and dangling-claim detectors' stance).
- `apps/server/src/diagnostics/index.ts` — barrel now re-exports `detectCoherencyHints`, `CoherencyHint`, `HintKind`, and the three per-variant hint interfaces. Fifth detector in the diagnostics module alongside `cycle-detection.ts`, `contradiction-detection.ts`, `multi-warrant-detection.ts`, `dangling-claim-detection.ts`.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `coherency_hint_detection`.

Tests:

- `apps/server/src/diagnostics/coherency-hint-detection.test.ts` — 13 cases organized into four groups. No hints: empty projection, complete warrant (both bridge edges), isolated node, non-self contradicts, invisible self-contradicts. Incomplete-warrant hints: warrant with only bridges-from, warrant with only bridges-to, warrant with two bridges-from no bridges-to (two hints), warrant with bridges-to made invisible (still incomplete via visibility filter), two warrants of different incomplete kinds (rule-declaration order). Self-contradicts hints: self-loop, self-loop plus a non-self contradicts (only the self-loop emits). Multiple-rule composition: incomplete warrant + self-contradicts → both kinds emitted in rule-declaration order. Each test seeds a fresh projection via TS-literal events through `applyEvent`; helpers (`seedSession`, `createNode`, `createEdge`) follow the pattern from the sibling test files. Substance facets are deliberately NOT committed-agreed — the coherency-hint detection is structural-only.
- `tests/behavior/diagnostics/coherency-hint-detection.feature` — 2 DB-driven scenarios. (1) An incomplete warrant with only a `bridges-from` is detected as `incomplete-warrant-missing-bridges-to` after round-tripping events through pglite's `session_events` table. (2) A complete warrant (both bridge edges present) yields no hint.
- Step defs in `tests/behavior/steps/diagnostics-coherency-hint-detection.steps.ts`. Distinct UUID prefix (`c5...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), multi-warrant-detection (`c3...`), dangling-claim-detection (`c4...`), active-firing (`88...`), and other step files. Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`). Per-seq event-row ids use the 10xxxx band (`100000 + seq * 10 + N`) so the `seq * N` formula never collides with the lifecycle's fixed 9xxx ids.

`pnpm run test:smoke` green (526 tests, +13 over the prior 513 baseline). `pnpm run test:behavior:smoke` green (102 scenarios, +2 over the prior 100 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
