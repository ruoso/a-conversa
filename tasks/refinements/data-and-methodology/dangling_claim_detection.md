# Detect dangling claim-positioned nodes

**TaskJuggler entry**: [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) — task `data_and_methodology.diagnostics.dangling_claim_detection`
**Effort estimate**: 0.5d
**Inherited dependencies**: `data_and_methodology.projection` (settled). Through it, `Projection.nodes()`, `getEdgesByTarget(nodeId)`, `visible` flags on nodes and edges. Sibling: `cycle_detection`, `contradiction_detection`, `multi_warrant_detection` (settled — same diagnostics-module layout and pure-read pattern carry over). Indirectly: `coherency_hint_detection` (sibling, not yet landed) catches a different shape (incomplete warrants, unusual edge/kind combinations); this task strictly handles "node positioned as a claim with no incoming justification."

## What this task is

Detect **dangling claim-positioned nodes** in a session's visible graph. Per [`docs/data-model.md`](../../../docs/data-model.md) line 192 ("Dangling claims"):

> A node positioned as a claim (i.e., something a debater is defending) with no incoming `supports`, `rebuts`, or `bridges-to` is "dangling." Not an error — claims can stand briefly before being supported — but tracked as a state. A claim that remains dangling for long is either being implicitly accepted or implicitly conceded; the moderator can prompt for support or for explicit disposition.

The task delivers a **pure read function** over the projection: `detectDanglingClaims(projection: Projection): DanglingClaim[]` where `DanglingClaim = { nodeId: string }`. Each entry names a node that is structurally claim-positioned (something points at it — see "Claim-positioned definition" below) but has no incoming `supports`, `rebuts`, or `bridges-to` edges providing engagement. The function lives in `apps/server/src/diagnostics/`, alongside `cycle-detection.ts`, `contradiction-detection.ts`, and `multi-warrant-detection.ts`.

## Why it needs to be done

Per `docs/data-model.md` line 192: a dangling claim is "either being implicitly accepted or implicitly conceded." Without a read-side signal, the moderator UI can't surface this state — the moderator has no programmatic way to ask "are there nodes on the graph nobody has bothered to justify or push back on?" The diagnostic is a soft prompt for either solicitation of support (the typical case) or explicit disposition (concede / retract / axiom-mark).

Downstream consumers: `diagnostic_event_emission` (M2 sibling) wires the detector's output into the event-stream surface; `blocking_vs_advisory_classification` (M2 sibling) classifies dangling-claim diagnostics alongside cycles / contradictions / multi-warrant / coherency-hint diagnostics. Both are separate tasks; this one delivers the detection logic only.

The boundary with `coherency_hint_detection` (sibling, not yet landed): the coherency-hint detector flags **unusual edge/kind configurations** (e.g., a `defines` edge from a `definitional` node to a `value` node) and **incomplete warrants** (`bridges-from` without a matching `bridges-to`). That's about whether what's there is the right *shape*. This detector is about *absence* of incoming justification on a node that something is being said about. The two diagnostics partition the surface: dangling-claim fires on nodes; coherency-hint fires on edge/node combinations.

## Inputs / context

- [`docs/data-model.md`](../../../docs/data-model.md) line 192 ("Dangling claims") — the diagnostic definition.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 110–120 — edge-role catalog: `supports`, `rebuts`, `qualifies`, `bridges-from`, `bridges-to`, `defines`, `contradicts`. The justification triplet `{supports, rebuts, bridges-to}` is enumerated in the dangling-claim paragraph itself.
- [`docs/data-model.md`](../../../docs/data-model.md) lines 287–293 ("Edge visibility") — invisible edges and edges with invisible endpoints don't participate in any structural reasoning. The visibility filter is the standard.
- [`apps/server/src/projection/projection.ts`](../../../apps/server/src/projection/projection.ts) — `Projection.nodes()`, `getEdgesByTarget(nodeId)`. The detector uses `getEdgesByTarget(nodeId)` to look up each node's incoming edges efficiently (O(1) target-index lookup); without it, the detector would re-walk `edges()` per node.
- [`apps/server/src/projection/types.ts`](../../../apps/server/src/projection/types.ts) — `ProjectedEdge` (`role`, `sourceNodeId`, `targetNodeId`, `visible`), `ProjectedNode` (`visible`).
- [`apps/server/src/diagnostics/cycle-detection.ts`](../../../apps/server/src/diagnostics/cycle-detection.ts), [`contradiction-detection.ts`](../../../apps/server/src/diagnostics/contradiction-detection.ts), [`multi-warrant-detection.ts`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — sibling templates. The module layout, pure-read shape, visibility filter, and barrel pattern carry over directly.
- [`tasks/refinements/data-and-methodology/multi_warrant_detection.md`](./multi_warrant_detection.md) — sibling refinement. The "structural-only filter (no `isEdgeActive` gate)" decision applies here too: a dangling claim is a structural absence, not a function of substance agreement.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md) — every empirical check is a committed test. Two layers: Vitest unit + Cucumber+pglite integration.

## Constraints / requirements

- **Pure read function** over the projection; no DB access, no side effects, no event emission. Repeated calls are well-defined.
- **Claim-positioned definition.** A node is **claim-positioned** iff at least one visible edge has it as `targetNodeId` (i.e., the node appears in `getEdgesByTarget(nodeId)` with `edge.visible === true` and the edge's source is also visible). See the Decisions section for the reading-of-the-doc rationale: "positioned as a claim (i.e., something a debater is defending)" is operationalized as "something else points at this node in the current visible graph." An isolated node (no incoming edges at all) is **not** claim-positioned — nobody is asserting anything about it. A node that only has outgoing edges (it points at others, nothing points at it) is also **not** claim-positioned.
- **Dangling criterion.** A claim-positioned node is **dangling** iff none of its visible incoming edges have role in `{supports, rebuts, bridges-to}`. The justification triplet is enumerated literally in `docs/data-model.md` line 192. The doc's wording — "no incoming `supports`, `rebuts`, or `bridges-to`" — counts both `supports` (positive engagement) and `rebuts` (negative engagement / pushback) as engagement that takes a node out of the dangling state. The diagnostic is about **absence of engagement at all**, not about absence of positive support.
- **Edge roles that DO NOT lift a node out of dangling.** `defines`, `qualifies`, `bridges-from`, `contradicts`. The Decisions section records the reasoning for each:
  - `defines` — definitional relationship, not justification. A node being defined is having its meaning fixed, not its truth defended.
  - `qualifies` — hedges scope of the target. Doesn't justify the target's content.
  - `bridges-from` — outgoing from a warrant *to its data node*. The data node is being identified as data, not justified as a claim. (Note: the data node is "claim-positioned" if the warrant's `bridges-from` is its only incoming edge — something points at it — but it's not justified.)
  - `contradicts` — explicitly listed in the doc's enumeration as NOT in the justification triplet. The Open Questions section documents that we follow the doc literally: `contradicts` makes a node claim-positioned but does not lift it out of dangling. The doc's wording at line 192 names the triplet `{supports, rebuts, bridges-to}` and excludes `contradicts`. A node whose only incoming edge is `contradicts` is structurally being "engaged with" but no debater has yet either supported it, rebutted it, or warranted it — the prompt to justify or dispose of it still applies.
- **Filter to visible nodes only.** `node.visible === true` on the candidate; invisible nodes don't participate in current reasoning.
- **Filter to visible edges only on the incoming side.** `edge.visible === true`. Broken edges (per committed `break-edge`) and edges whose endpoints were superseded by decompose / restructure don't participate. The source endpoint must also be visible (the projection cascades visibility but the defensive guard mirrors the sibling detectors).
- **No substance-agreement gate.** Per `docs/data-model.md` line 192 the diagnostic is purely **structural** — a node being claim-positioned with no incoming justification is the signal, regardless of whether anyone has agreed any facet of any node or edge. Even a brand-new proposed node that another participant has pointed a `bridges-from` edge at (without yet adding a `bridges-to` or a `supports`) qualifies as dangling. This mirrors the multi-warrant detector's structural-only stance.
- **No memoization.** The function is pure; repeat calls walk visible nodes. The sibling `projection_caching` task addresses whole-projection caching.
- **No new event payloads, no `ProjectionChange` discriminators, no shared-types schemas.**
- **No modification of the projection layer.** The detector reads `Projection` through its existing public surface.
- **Verifications per ADR 0022.** Vitest unit tests at `apps/server/src/diagnostics/dangling-claim-detection.test.ts` for the algorithm in isolation. Cucumber + pglite scenarios at `tests/behavior/diagnostics/dangling-claim-detection.feature` with step defs in `tests/behavior/steps/diagnostics-dangling-claim-detection.steps.ts`.

## Acceptance criteria

- `apps/server/src/diagnostics/dangling-claim-detection.ts` exports:
  - `detectDanglingClaims(projection: Projection): DanglingClaim[]`
  - `DanglingClaim` — interface `{ nodeId: string }`. v1 keeps the entry minimal (just the node id); a future enhancement might carry the incoming-edge ids that make the node claim-positioned (for the UI to render "Anna has a `contradicts` against this but nobody has supported, rebutted, or warranted it"). The current entry shape is documented as deliberately minimal.
- `apps/server/src/diagnostics/index.ts` barrel re-exports `detectDanglingClaims` and the `DanglingClaim` type.
- Filter, in evaluation order:
  1. `node.visible === true` — invisible nodes are skipped.
  2. For each visible node, walk `getEdgesByTarget(nodeId)`.
  3. Filter incoming edges to `edge.visible === true` AND `getNode(edge.sourceNodeId)?.visible === true`.
  4. If the visible incoming edge set is empty → node is NOT claim-positioned → skip.
  5. If any visible incoming edge has `role ∈ {'supports', 'rebuts', 'bridges-to'}` → node is justified → skip.
  6. Otherwise: claim-positioned AND unjustified → emit `{ nodeId }`.
- Iteration order: insertion order of `projection.nodes()` (i.e., node creation order). Deterministic for a given projection.
- `apps/server/src/diagnostics/dangling-claim-detection.test.ts` covers:
  - Empty projection → no dangling claims.
  - Isolated node (no edges at all) → not claim-positioned → not detected.
  - Node with only outgoing edges → not claim-positioned → not detected.
  - Node with incoming `defines` only → claim-positioned but unjustified → dangling, detected. (Records the call: `defines` is not justification per the doc's triplet.)
  - Node with incoming `qualifies` only → dangling, detected. (Same reasoning.)
  - Node with incoming `contradicts` only → dangling, detected. (Open-question decision: follow the doc literally; `contradicts` is engagement but not justification.)
  - Node with incoming `bridges-from` only (the data side of a warrant pattern) → dangling, detected. (`bridges-from` points at the data node; the data node is not "claimed" in the Toulmin sense, but per our claim-positioned definition something points at it. The doc lists only `bridges-to` in the justification triplet, so `bridges-from` does not justify.)
  - Node with incoming `supports` only → not dangling.
  - Node with incoming `rebuts` only → not dangling. (`rebuts` IS engagement per the doc's enumeration.)
  - Node with incoming `bridges-to` only → not dangling. (The target of a warrant's `bridges-to` — i.e., a claim that has a warrant — is justified.)
  - Node with mixed incoming: `defines` + `supports` → not dangling (at least one justification edge).
  - Node with mixed incoming: `contradicts` + `defines` → dangling (neither is justification).
  - Node whose incoming `supports` edge is invisible (broken) → falls back to whatever other incoming edges remain; if none are in the triplet, dangling.
  - Node whose only incoming edge has an invisible source → not claim-positioned (defensive filter).
  - Multiple dangling nodes → multiple entries.
- `tests/behavior/diagnostics/dangling-claim-detection.feature` covers 2 DB-driven scenarios:
  1. **Dangling claim detected.** Build a session with two nodes A, B and one `A → B contradicts` edge (B is claim-positioned via the contradicts but has no `supports` / `rebuts` / `bridges-to` incoming). Project; assert `detectDanglingClaims` returns one entry naming B. (A has no incoming at all — not claim-positioned — not in result.)
  2. **Justified claim — no detection.** Same setup but the incoming edge is `supports` instead of `contradicts`. Project; assert `detectDanglingClaims` returns no entries.
- Step defs in `tests/behavior/steps/diagnostics-dangling-claim-detection.steps.ts`. Distinct UUID prefix (`c4...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), multi-warrant-detection (`c3...`), and other step files. Reuses `tests/behavior/support/event-rows.ts`.
- `tasks/10-data-and-methodology.tji` carries `complete 100` for `dangling_claim_detection` and a `note "Refinement: ..."` line. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent.
- `make test` end-to-end green; existing 497 vitest + 98 cucumber baseline preserved and extended.

## Decisions

- **Where the diagnostics module lives.** `apps/server/src/diagnostics/dangling-claim-detection.ts`, alongside `cycle-detection.ts`, `contradiction-detection.ts`, `multi-warrant-detection.ts`. Same pattern as the siblings: a pure read function, its own file, re-exported through the diagnostics barrel.
- **Public API.**
  - `detectDanglingClaims(projection: Projection): DanglingClaim[]` — single-call detector, returns the full set of dangling claim-positioned nodes in the current projection.
  - `DanglingClaim = { nodeId: string }` — minimal entry. A future enhancement could include the incoming-edge ids that make the node claim-positioned without justifying it; v1 keeps the surface small to mirror the doc's "just track the state" framing.
  - No error type. Empty graph → `[]`.
- **Claim-positioned reading of the doc.** The doc says "A node positioned as a claim (i.e., something a debater is defending)" (line 192). The most faithful operationalization is "something else points at it on the visible graph." Two readings were considered:
  - **Strict warrant-only reading.** A node is only claim-positioned if there's a `bridges-to` edge ending at it — the warrant's "claim" target. Rejected: would only catch nodes that already have a warrant pattern partially built, missing the typical case where a debater asserts something and someone else has only contradicted it (or, more commonly, no one has touched it yet — but if no one has touched it, the "dangling" framing doesn't apply either; the node isn't being "defended").
  - **Any-incoming-edge reading (adopted).** A node is claim-positioned if at least one visible edge has it as target. This is the reading the implementation uses. It captures the spirit of "something is being asserted about this node" — even a `contradicts` says "this node is being engaged with," which is the precondition for "is anyone going to defend it?"
  - The doc's enumeration of the justification triplet (`supports` / `rebuts` / `bridges-to`) is then the second axis: of the things that make a node claim-positioned, which ones also justify it? Answer: those three. Anything else (`defines`, `qualifies`, `bridges-from`, `contradicts`) makes the node claim-positioned but does not justify it → dangling.
- **`rebuts` counts as justification (engagement, not absence-of-engagement).** Per the doc's literal enumeration. `rebuts` is push-back on a node; it doesn't support the node but it engages with it as a claim. The doc explicitly includes `rebuts` in the "lifts out of dangling" set. A node being rebutted is not implicitly being conceded — it's actively being argued against. The diagnostic is about "no one has bothered to engage at all (positively or negatively)," which `rebuts` precludes.
- **`bridges-to` counts as justification.** Per the doc's literal enumeration. The target of a `bridges-to` is the warrant's claim — it has at least one warrant licensing inference to it.
- **`contradicts` does NOT count as justification.** Per the doc's literal enumeration. The doc's triplet is `{supports, rebuts, bridges-to}` — `contradicts` is omitted. A node with only an incoming `contradicts` edge is being engaged with (claim-positioned) but no debater has either supported it, rebutted it, or warranted it. The contradicts edge participates in a different diagnostic (contradiction-detection) — for *that* diagnostic to fire, the contradicts edge's substance and both endpoints' substance must be agreed. For dangling-claim, the asymmetric framing is intentional: the node is being said to conflict with another, but nothing yet defends it. The Open Questions section records this as "follow the doc literally; revisit if user testing surfaces noise."
- **`bridges-from` makes a node claim-positioned but does NOT justify it.** A `bridges-from` edge points from a warrant to a data node. The data node is being identified as the data side of a Toulmin step, not being justified as a claim. Two warrants both `bridges-from` a node still doesn't justify that node — the warrants are saying "I draw inference from this," not "this is true." The doc's triplet excludes `bridges-from`. The detector follows the doc.
- **`defines` and `qualifies` do NOT count as justification.** Neither is in the doc's triplet. `defines` is definitional ("the meaning of this term is..."); `qualifies` hedges the target's scope ("usually, in most cases"). Neither asserts the target is true; neither justifies the target as a claim.
- **No substance-agreement gate (structural-only detection).** Per `docs/data-model.md` line 192 the diagnostic fires on the **structural absence** of incoming `supports` / `rebuts` / `bridges-to`. It doesn't depend on whether any node's or edge's substance facet has been agreed. The signal is "structurally, this node has nothing justifying it" — a brand-new proposed node with only a `contradicts` proposed against it is dangling. Contrast cycle and contradiction detection, both of which gate on `isEdgeActive` because those diagnostics are about firing relations. Dangling-claim is about argument structure: even ungrounded-substance edges count as engagement (or non-engagement) for the structural read. This mirrors the multi-warrant detector's structural-only stance.
- **Algorithm.**
  1. Iterate `projection.nodes()`.
  2. Skip if `!node.visible`.
  3. Walk `projection.getEdgesByTarget(node.id)`.
  4. Filter to `edge.visible === true` AND `getNode(edge.sourceNodeId)?.visible === true`.
  5. If the filtered list is empty → not claim-positioned → skip (no entry).
  6. If any filtered edge has `role ∈ {'supports', 'rebuts', 'bridges-to'}` → justified → skip.
  7. Otherwise → emit `{ nodeId: node.id }`.
  - **Complexity.** O(N + E) where N = visible nodes, E = sum of incoming-edge counts per visible node = total visible edges. `getEdgesByTarget` is a `Map<targetId, Set<edgeId>>` lookup so per-node it's O(in-degree).
- **Self-loop on the target side.** A node with a single edge whose target equals source (e.g., `A → A contradicts`) is claim-positioned (it has an incoming edge — itself). Whether the source-side is "the same node" doesn't change the claim-positioned predicate. v1 processes it normally: such a node has `contradicts` as its only visible incoming → dangling. If user testing surfaces this as noise, the detector can add a `source !== target` filter (the contradiction detector does this for its own reasons; for dangling-claim the structural reading is intact).
- **Iteration order.** `projection.nodes()` insertion order. The projection's underlying `Map` preserves insertion order; two runs against the same projection emit the same sequence of entries.
- **No diagnostic event emission.** Out of scope. `diagnostic_event_emission` (M2 sibling) consumes this detector's output.
- **No blocking-vs-advisory classification.** Out of scope. `blocking_vs_advisory_classification` (M2 sibling) classifies each diagnostic kind. Per the doc's "Not an error" framing, dangling-claim is expected to land as advisory.
- **Test layout (Vitest).** `apps/server/src/diagnostics/dangling-claim-detection.test.ts`. Reuses the same TS-literal-event seeding pattern as the sibling detectors. Helpers inlined per the sibling-file pattern. Tests construct minimal projections (no commit-substance — purely structural).
- **Test layout (Cucumber + pglite).** `tests/behavior/diagnostics/dangling-claim-detection.feature` + `tests/behavior/steps/diagnostics-dangling-claim-detection.steps.ts`. Two scenarios per Acceptance criteria. UUID prefix `c4...`.

## Open questions

- **`contradicts` framing.** v1 follows the doc literally: an incoming `contradicts` makes a node claim-positioned but does not lift it out of dangling. A reasonable alternative reading would be "contradicts IS engagement; the moderator can already see the contradiction; this node isn't dangling, it's contested." If user testing surfaces dangling-claim diagnostics on every contradicts-only node as noise, the resolution is to add `contradicts` to the justification triplet in this detector (a one-line change). The current choice errs on the side of more prompts: a node with only a contradicts and nothing else IS the kind of thing the moderator might want to ask "does anyone want to support this, or are we conceding it?"
- **`DanglingClaim` carrying incoming-edge ids.** v1's entry is `{ nodeId }` only. A future enhancement could include `incomingEdgeIds: string[]` so the moderator UI can render "this node has only a `contradicts` from B — does anyone want to defend it?" without re-walking the projection. Out of scope here; the minimal shape mirrors the doc's "tracked as a state" framing.
- **Time-based dangling.** The doc says "a claim that remains dangling for long" — implying a temporal threshold. The detector here is stateless: it reports the current set of dangling claim-positioned nodes. The temporal threshold is a UI / moderator-engine concern (when to prompt the participants), not a detector concern. Out of scope.

(All other questions settled.)

## Status

**Done** 2026-05-11.

Implementation:

- `apps/server/src/diagnostics/dangling-claim-detection.ts` — new file. Exports `detectDanglingClaims(projection): DanglingClaim[]` and the `DanglingClaim` interface (`{ nodeId: string }`). Pure read function over the projection. Walks `projection.nodes()`; for each visible node, walks `getEdgesByTarget(node.id)` filtering to visible edges with visible sources. A node is claim-positioned iff at least one such incoming edge exists; dangling iff none of those edges have role in `{supports, rebuts, bridges-to}`. Justification triplet enumerated literally from `docs/data-model.md` line 192. Structural-only filter — no `isEdgeActive` gate, no substance-agreement check (deliberate divergence from the cycle / contradiction sibling detectors; mirrors the multi-warrant detector's structural-only stance per `docs/data-model.md` line 192). Short-circuits on the first justification edge seen.
- `apps/server/src/diagnostics/index.ts` — barrel now also re-exports `detectDanglingClaims` and `DanglingClaim`. Fourth detector in the diagnostics module alongside `cycle-detection.ts`, `contradiction-detection.ts`, `multi-warrant-detection.ts`.
- `tasks/10-data-and-methodology.tji` — `complete 100` and `note "Refinement: ..."` added to `dangling_claim_detection`.

Tests:

- `apps/server/src/diagnostics/dangling-claim-detection.test.ts` — 16 cases organized into two groups. Not detected: empty projection, isolated node, outgoing-only node, supports-only, rebuts-only, bridges-to-only, mixed defines+supports, invisible-source-only edge. Detected: defines-only, qualifies-only, contradicts-only (the doc-literal triplet choice), bridges-from-only (data side of a warrant pattern), mixed contradicts+defines, broken-supports falls back to defines (committed `break-edge` flip), multiple dangling nodes in insertion order, two parallel unjustifying edges into a single node yield one entry. Each test seeds a fresh projection via TS-literal events through `applyEvent`; helpers (`seedSession`, `createNode`, `createEdge`, `commitBreakEdge`) follow the pattern from the sibling test files. Substance facets are deliberately NOT committed-agreed — the dangling-claim detection is structural-only.
- `tests/behavior/diagnostics/dangling-claim-detection.feature` — 2 DB-driven scenarios. (1) A claim-positioned node with only an incoming contradicts is detected as dangling (the doc-triplet decision, exercised on a DB-round-tripped projection). (2) A claim-positioned node with an incoming supports is not detected.
- Step defs in `tests/behavior/steps/diagnostics-dangling-claim-detection.steps.ts`. Distinct UUID prefix (`c4...`) avoids scratch-state collision with cycle-detection (`c1...`), contradiction-detection (`c2...`), multi-warrant-detection (`c3...`), active-firing (`88...`), and other step files. Reuses `tests/behavior/support/event-rows.ts` (`insertEventRow`, `rowToValidatedEvent`, `selectEvents`, `evId`).

`pnpm run test:smoke` green (513 tests, +16 over the prior 497 baseline). `pnpm run test:behavior:smoke` green (100 scenarios, +2 over the prior 98 baseline). `make test` end-to-end green (vitest + cucumber + playwright). `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` is silent. `pnpm run typecheck` clean.
