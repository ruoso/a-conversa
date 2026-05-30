# Re-audit pending-consequences annotation-endpoint skip when stub graduates

**TaskJuggler entry**: `data_and_methodology.diagnostics.pending_consequences_annotation_endpoint_revisit` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 351-361). Embedded note: *"Source of debt: diagnostics_annotation_endpoint_semantics_audit D5. When pending_consequences graduates from v1 stub to full implementation, re-audit the annotation-endpoint skip. Pre-stated answer: skip still holds (annotations carry no substance facet). Register to prevent future implementer from re-deriving the call."*

## Effort estimate

**0.25d** (per the `.tji` allocation). The task is a *pre-decided re-audit*: the answer is already worked out in [`diagnostics_annotation_endpoint_semantics_audit`](./diagnostics_annotation_endpoint_semantics_audit.md) D5. Most of the 0.25d is mechanical — re-running the per-rule skip check against whatever new walk shape the stub's graduation introduces, updating the skip-guard's back-link comment to cite both audits, and broadening the Vitest annotation-endpoint case if the graduation adds new walks (e.g., target-node substance, transitive walks) that need their own pin.

Breakdown:

- **Re-walk the structural check (~0.5h).** Read whatever pending-consequences-full-implementation task ships, identify each new substance-facet walk it introduces, and confirm none of them can read substance from an annotation entity. The check is mechanical: `ProjectedAnnotation` has no `substanceFacet` field (see [`apps/server/src/projection/types.ts:240-251`](../../../apps/server/src/projection/types.ts)); any walk that reads substance must short-circuit on annotation endpoints regardless of which walk it is.
- **Comment-update at the skip-guard site (~0.25h).** Replace the current single-audit back-link with a two-audit back-link (`Per diagnostics_annotation_endpoint_semantics_audit D5 + pending_consequences_annotation_endpoint_revisit Dn: …`) so the rationale chain is visible inline.
- **Vitest broadening (~1h).** Add one Vitest case per *new* walk the full implementation introduces, asserting the skip holds. Existing annotation-endpoint cases (already in [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts)) stay.
- **WBS housekeeping (~0.25h).** `complete 100` on this task block; if the graduation task's refinement bundles this re-audit (see D3), reflect that in this Status block.

No DB migration, no UI delta, no Cucumber delta (per D2 — the skip is unit-observable; the predecessor audit's D6 reasoning carries over).

## Inherited dependencies

**Settled:**

- [`data_and_methodology.diagnostics.diagnostics_annotation_endpoint_semantics_audit`](./diagnostics_annotation_endpoint_semantics_audit.md) (done — 2026-05-30). The audit's D5 is the load-bearing input: "pending_consequences: keep skip on source-NODE walk; record a re-audit slot for when the stub graduates to a full implementation. Annotation entities lack substance facets (per the ProjectedAnnotation type — no substanceFacet field). The skip survives any rule restatement that operates on source substance." This refinement closes that registration.
- [`data_and_methodology.diagnostics.pending_consequences_stub`](./pending_consequences_stub.md) (done — 2026-05-10). The v1 stub that this task's trigger graduates. The stub walks edge-substance + source-node-substance only; the skip lives at [`apps/server/src/diagnostics/pending-consequences.ts:134-138`](../../../apps/server/src/diagnostics/pending-consequences.ts).
- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). Established the polymorphic `ProjectedEdge` shape with `sourceNodeId / sourceAnnotationId` as a `null`-XOR pair, and the conservative skip-on-null-endpoint default the audit confirmed.
- [`docs/adr/0022-no-throwaway-verifications.md`](../../../docs/adr/0022-no-throwaway-verifications.md). The re-audit's broadened pins ship as committed Vitest cases.
- [`docs/adr/0027-entity-and-facet-layers-strict-separation.md`](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). Annotations are entity-layer; whether a diagnostic walks them is an entity-layer scoping decision and is bounded by what substance facets exist where.

**Pending:**

- **No `pending_consequences` full-implementation task is on the WBS today.** Per [`docs/data-model.md` line 104](../../../docs/data-model.md), pending-consequences is a "possible future feature" deferred from v1; the stub exists per `pending_consequences_stub` (M2) but the graduation task hasn't been authored. This re-audit is a *registered slot* — it only becomes runnable when the graduation task lands. Per D3 the closer of the graduation task (whichever it is) MAY fold this re-audit into its own scope; if so, this refinement's role becomes the prepared answer the graduation refinement cites.

## What this task is

A **conditional re-audit slot**. The task only becomes runnable when `pending_consequences` is graduated from its v1 stub to a full implementation. The audit's question is identical to the predecessor's per-diagnostic question: *"should pending-consequences surface findings on annotation-endpoint edges?"* — but applied to whatever new walks the full implementation introduces.

The deliverable is:

1. **A re-confirmation** that the skip survives the graduation, per the pre-stated answer (D1). For each new substance-facet walk the full implementation introduces (e.g., the target node's substance, a transitive source-of-source walk, etc.), the audit checks: does the walk read substance from an annotation? If no annotation-substance read is reachable, the skip remains correct by construction (annotations have no substance facet). If a new annotation-substance read *would* be reachable, the audit becomes substantive and may surface an ADR-level question (per D4 — that would be a methodology-evolution moment, not a routine re-audit).

2. **A comment update** at [`apps/server/src/diagnostics/pending-consequences.ts:134-138`](../../../apps/server/src/diagnostics/pending-consequences.ts) replacing the single-audit back-link with a two-audit back-link (`// Per diagnostics_annotation_endpoint_semantics_audit D5 + pending_consequences_annotation_endpoint_revisit Dn: …`), so a future reader sees that the call was re-checked under the full implementation.

3. **Broader Vitest pins** for each new walk the full implementation introduces. The existing annotation-endpoint cases at [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts) (per the predecessor audit's Acceptance) stay; the re-audit adds one negative-pin per new walk, asserting `detectPendingConsequences(projection).length === 0` against fixtures whose ONLY substance-facet read crosses an annotation endpoint of the relevant new shape.

Out of scope:

- **Graduating the stub itself.** That belongs in the prerequisite task (`pending_consequences_full_implementation` or however the WBS names it); this slot only re-audits the annotation-endpoint skip under that graduation, not the graduation's correctness more broadly.
- **Lifting the skip.** Even if a hypothetical methodology change made annotations carry substance, lifting the skip would be a new rule addition with its own methodology citation step (per D4 — that's an ADR-level moment, not a re-audit conclusion).
- **Re-auditing other diagnostics' annotation-endpoint skips.** Those are each their own registered slot or settled per the predecessor audit's D1–D5; this re-audit is scoped to `pending_consequences` only.
- **Contradiction-detection's annotation-endpoint audit.** Tracked under the separately-registered `contradiction_annotation_endpoint_semantics_audit` per the predecessor audit's D8.

## Why it needs to be done

**The pre-stated answer needs a registered slot, not just prose.** Per the refinement README's task-completion ritual and the predecessor audit's D5: the call has been made, but it lives in the audit's Decisions block. A future implementer who picks up the pending-consequences graduation may not read the audit's D5 — particularly if the WBS shape has shifted by then. Registering the re-audit as its own task ensures the call surfaces in the WBS pick-task pass when the graduation lands.

**The graduation's exact shape is not yet pinned.** The current stub walks edge-substance + source-node-substance. A full implementation may add target-node-substance, transitive walks across `bridges-from`/`bridges-to`, or wired participation in `diagnostic_event_emission` / `blocking_vs_advisory_classification`. Each of those *may* introduce a new substance-facet read; the re-audit's mechanical check is "does any new read cross an annotation endpoint, and if so, does annotation-substance exist there?" Today we know the answer is no on the second half; the re-audit re-confirms it under whatever new walks the graduation introduces.

**The Vitest pin layer needs widening at the moment of graduation.** Today the test surface pins one negative case per existing walk (source-substance skip). Each new walk the graduation introduces deserves its own negative pin so a future regression that silently widens an annotation-endpoint walk catches at unit level. This is the predecessor audit's D5 broadened-pin convention applied to the graduation moment.

## Inputs / context

**Design contract:**

- [`docs/data-model.md` line 104](../../../docs/data-model.md) — the future-development paragraph that defers pending-consequences from v1. The graduation task that triggers this re-audit will quote this line as its own motivation.
- [`docs/data-model.md` lines 80-95](../../../docs/data-model.md) — annotation metadata definition. Annotations carry an anchor and a content payload but no substance facet (the entity layer's substance pertains to nodes and edges only — confirmed in the `ProjectedAnnotation` type).
- [`docs/data-model.md` line 100](../../../docs/data-model.md) — active-firing rule (`edge.substance ∧ source.substance`, both settled-agreed). Pending consequences are the asymmetric case the stub already detects.

**Architectural / engineering inputs:**

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the re-audit's broadened pins ship as committed Vitest cases.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are entities; deciding whether a diagnostic reads their (absent) substance is an entity-layer scoping call.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/diagnostics/pending-consequences.ts:123-169`](../../../apps/server/src/diagnostics/pending-consequences.ts) — `detectPendingConsequences`. The skip-guard at L138 (`if (edge.sourceNodeId === null) continue;`) and its back-link comment at L134-137 are the comment-update target.
- [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts) — annotation-endpoint section (added by the predecessor audit). New negative pins added here, one per new walk the graduation introduces.
- [`apps/server/src/projection/types.ts:240-260`](../../../apps/server/src/projection/types.ts) — `ProjectedAnnotation`. Inspect at re-audit time to confirm no `substanceFacet` field has been added since (the structural ground for the skip-survives-graduation answer).
- **The future graduation task's source file(s)** — whichever module(s) the graduation introduces, the re-audit walks each new substance-facet read site and confirms it either (a) is unreachable from an annotation endpoint, or (b) short-circuits on annotation endpoints with its own skip guard. The current single-file shape may or may not survive graduation.

## Constraints / requirements

- **Trigger-gated.** This task is not runnable until a `pending_consequences` full-implementation task lands. The closer who opens the graduation task is responsible for either (a) scheduling this re-audit immediately after, or (b) folding it into the graduation refinement per D3.
- **Pre-stated answer is the default.** Per D1 the audit's conclusion is *"keep skip; annotations carry no substance facet"*. Deviating from this conclusion requires identifying a methodology-doc edit that has added substance to annotations, which would be ADR-level (per D4) — not a routine re-audit outcome.
- **Methodology-citation-first.** Per the predecessor audit's convention, the re-confirmation cites `docs/data-model.md` (lines 80-95 for annotation shape, line 104 for pending-consequences) and the `ProjectedAnnotation` type as the authoritative grounds.
- **Comment back-link convention.** Per D2 the skip-guard's comment becomes a two-audit back-link rather than a single-audit one, so the rationale chain (predecessor audit → this re-audit) is visible inline.
- **Test pin shape.** Per D2 each new negative pin asserts `detectPendingConsequences(projection).length === 0` against a fixture whose ONLY edges-of-interest are annotation-endpoint edges of the new walk's shape. Negative pins — same convention as the predecessor audit's broadened cover.
- **No source-behaviour change unless the graduation introduces one.** This re-audit does NOT lift any skip guard. If the graduation introduces new walks whose annotation-endpoint behaviour is ambiguous, the re-audit either re-confirms skip (the default) or escalates to an ADR; it does not silently lift.
- **No new ADR by default.** Per D4 the audit confirms a default already established. An ADR would only be warranted if the graduation surfaces an architectural shift (e.g., annotations gain a substance facet, or pending-consequences becomes a transitive walk that crosses entity layers).
- **No DB migration, no UI change, no Cucumber delta.** Per D2 the per-diagnostic skip is unit-observable only; the predecessor audit's D6 reasoning applies unchanged.
- **Test discipline per ADR 0022.** Every re-audit conclusion ships as committed Vitest cases.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as committed test cover.** Per D2 the test layer here is Vitest unit; the predecessor audit's D6 reasoning carries over (no Cucumber delta because no event-stream observable change). Per the refinement README's test-layer policy, this is a methodology-engine / projection-adjacent task — UI-stream Playwright cover does not apply.

Trigger condition (verified at the start of the re-audit):

- [ ] The `pending_consequences` full-implementation task has landed (or is landing in the same commit cluster). If neither holds, this task remains pending; the closer of this task confirms the trigger before doing the work.

Skip-guard comment update at the source site (per D2):

- [ ] [`apps/server/src/diagnostics/pending-consequences.ts:134-138`](../../../apps/server/src/diagnostics/pending-consequences.ts) — comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D5 + pending_consequences_annotation_endpoint_revisit D1: pending-consequences walks substance facets; annotations carry no substance facet (data-model.md L80-95; ProjectedAnnotation type). Re-confirmed under the full-implementation graduation.`

Per-new-walk re-audit (one bullet per new substance-facet read introduced by the graduation):

- [ ] For each new substance-facet read site introduced by the graduation, the re-audit confirms either (a) the read is unreachable from an annotation endpoint, or (b) the read carries its own annotation-endpoint skip guard with a back-link to this refinement's D1.

Broadened Vitest pins:

- [ ] [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts) — one new negative case per new substance-facet walk introduced by the graduation. Each case asserts `detectPendingConsequences(projection).length === 0` against a fixture whose ONLY edges-of-interest are annotation-endpoint edges of the new walk's shape. The predecessor audit's existing annotation-endpoint cases stay.
- [ ] If the graduation introduces no new substance-facet walks (the graduation is wiring-only — e.g., classifying the existing stub output as advisory, hooking the existing detector into the event stream), then no new Vitest cases are required; the re-audit's deliverable is just the comment update plus this refinement's Status block confirming the re-confirmation.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the predecessor audit's per-diagnostic skip cases for pending-consequences and the v1 stub's coverage.
- [ ] Every existing Cucumber feature passes.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `pending_consequences_annotation_endpoint_revisit`.
- [ ] If the graduation task's closer folded this re-audit into the graduation refinement per D3, this task's Status block reflects that and points at the graduation refinement's Status block as the audit record.

Tech-debt registration:

- [ ] *(none expected)* — the pre-stated answer is "skip survives". If the re-audit *does* escalate to an ADR (per D4 — annotations have somehow gained substance semantics by the time the graduation lands), the closer registers the resulting ADR work as a separate task; this re-audit itself does not pre-register it because the conditions for the escalation are not foreseeable today.

## Decisions

- **D1 — Pre-stated answer: keep skip. Annotations carry no substance facet, by construction.** Rationale:
  - **The `ProjectedAnnotation` type has no `substanceFacet` field.** Per [`apps/server/src/projection/types.ts:240-260`](../../../apps/server/src/projection/types.ts), nodes and edges carry `substanceFacet: FacetState<…>`; annotations don't. The pending-consequences rule's structural input is substance facets on nodes (today) and may grow to substance facets on edges or transitive sources (under graduation) — but every substance read terminates in an entity that has the facet. Annotations don't, so any path that would read substance through an annotation is malformed by construction.
  - **`docs/data-model.md` line 104 frames pending-consequences as "agreed-substance edges whose source substance is not yet agreed".** The grammar of the rule is *(source is settled-agreed-or-not)* — the source must HAVE a settle-able substance state. Annotations have no such state; the rule's predicate is not applicable.
  - **Predecessor audit D5 already wrote this down.** This refinement's role is to register the conclusion as a runnable slot for the graduation moment — the conclusion itself is held by the predecessor audit.
  - **Alternative considered: have the graduation refinement absorb this re-audit inline.** Rejected at this layer (deferred to D3) — keeping a registered slot makes the audit's coverage explicit in the WBS pick-task pass; the graduation refinement's closer may still choose to fold per D3.
  - **Alternative considered: lift the skip preemptively, treating annotation-source edges as automatically pending.** Rejected — would conflate the metadata layer with the substance layer (ADR 0027 violation). An annotation-source edge has no source substance to be unagreed; "pending" doesn't apply.

- **D2 — Test pin shape and comment back-link convention follow the predecessor audit.** Rationale:
  - **The predecessor audit established the per-diagnostic comment back-link convention** (`// Per diagnostics_annotation_endpoint_semantics_audit Dn: …`). The re-audit extends it to a two-audit back-link rather than replacing it — both audits are load-bearing (the predecessor states the skip; this re-audit re-confirms under graduation), and both should be reachable inline.
  - **The predecessor audit established negative-pin Vitest cover** for annotation-endpoint skips. The re-audit's new pins follow the same shape — one negative pin per new walk, fixture has ONLY annotation-endpoint edges-of-interest, assert zero findings.
  - **No Cucumber delta** (predecessor audit's D6 carries over): the skip is unit-observable; no event-stream surface change.
  - **Alternative considered: replace the predecessor's back-link with this re-audit's only.** Rejected — the predecessor audit is the foundational rationale; truncating the chain hides where the rule's grounding lives.

- **D3 — The graduation task's closer MAY fold this re-audit into the graduation refinement.** Rationale:
  - **Two valid shapes for the re-audit's execution.** (a) Standalone: the graduation lands first, then this task runs and updates the comment + adds pins. (b) Folded: the graduation refinement absorbs this re-audit's deliverable inline, citing this refinement as the pre-stated answer and producing the comment update + broadened pins in the graduation commit cluster.
  - **The folded shape is operationally simpler** when the graduation is small and the new walks are few — separating the comment update across two commit clusters is bureaucratic when the graduation refinement is already touching the file.
  - **The standalone shape is operationally clearer** when the graduation is large enough that bundling would dilute the graduation's commit cluster — keeping the re-audit's surface (this refinement) as the audit record is preferable to embedding it inside a graduation refinement that has other concerns.
  - **Either way, the audit record is in one place.** When folded, the graduation refinement's Status block notes "annotation-endpoint re-audit folded; see [`pending_consequences_annotation_endpoint_revisit.md`](./pending_consequences_annotation_endpoint_revisit.md) for the pre-stated answer", and this task's Status block notes "folded into [`<graduation>.md`](./...) — see its Status block".
  - **Alternative considered: mandate the standalone shape.** Rejected — premature; the graduation task's shape isn't known yet and the closer should choose the cleaner execution path at that moment.
  - **Alternative considered: mandate the folded shape.** Rejected — making this slot non-runnable as a standalone task would force the graduation closer to make the call inline even when the graduation is large and would benefit from a separate audit pass.

- **D4 — A new ADR is warranted only if the graduation surfaces an architectural shift; the re-audit itself does not produce one.** Rationale:
  - **The default conclusion (keep skip) is not architectural.** It confirms an established default per the predecessor audit and is grounded in the existing `ProjectedAnnotation` shape. No new seam.
  - **An architectural shift would warrant an ADR.** Plausible shifts: annotations gain a substance facet (a methodology + types-layer change), pending-consequences becomes a transitive walk across multiple entity types, or the rule's scope widens to include relationships-between-annotations. Each of those introduces a new architectural seam that an ADR should capture.
  - **The re-audit's role is to detect the shift, not to author the ADR.** If the re-audit identifies one, the closer registers an ADR-writing task as separate follow-up; this refinement does not pre-author it because the trigger is not foreseeable today.
  - **Alternative considered: pre-author a placeholder ADR.** Rejected — premature decision-making; ADRs capture choices among alternatives at the moment of choosing, not slots reserved for future shifts.

## Open questions

(none — all decided in D1–D4.)

## Status

**Pending** — 2026-05-30.

- Trigger condition unmet: no `pending_consequences` full-implementation task exists on the WBS or in git history (`pending_consequences_stub` is `complete 100` at 11841ef; no graduation commit found via `git log`).
- Per the refinement's first acceptance criterion ("If neither holds, this task remains pending; the closer of this task confirms the trigger before doing the work") — task remains pending. No source/test changes landed.
- Gating sentinel `data_and_methodology.diagnostics.pending_consequences_annotation_endpoint_revisit_trigger_gate` registered in `tasks/10-data-and-methodology.tji` to prevent the orchestrator from re-picking this slot before the trigger fires.
- `pending_consequences_annotation_endpoint_revisit` gains `depends !pending_consequences_annotation_endpoint_revisit_trigger_gate` so the gate is tj3-enforceable.
- Gate flip protocol: when `pending_consequences` graduation lands, the closing commit flips `pending_consequences_annotation_endpoint_revisit_trigger_gate` to `complete 100`; the orchestrator will then surface this re-audit slot on the next pick-task pass.
