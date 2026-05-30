# Revisit per-diagnostic semantics for annotation-endpoint edges

**TaskJuggler entry**: `data_and_methodology.diagnostics.diagnostics_annotation_endpoint_semantics_audit` — [tasks/10-data-and-methodology.tji](../../10-data-and-methodology.tji) (block at lines 299-312). Embedded note: *"Source of debt: projection_edge_annotation_endpoint — each diagnostic conservatively skips annotation-endpoint edges by checking for null sourceNodeId or targetNodeId. Once the methodology resolves the structural meaning of annotation-endpoint edges, revisit whether cycle, dangling-claim, coherency-hint, multi-warrant, and pending-consequences detectors should surface findings on those edges. The default established by projection_edge_annotation_endpoint is skip; coherency-hint detection in particular may want per-rule annotation-endpoint handling."*

## Effort estimate

**1d** (per the `.tji` allocation). The work is almost entirely *audit + documentation + test-coverage broadening*; per-diagnostic source changes are at most a comment update + a back-link to this refinement. The cost is in writing down each diagnostic's per-rule rationale defensibly and in adding the mixed-role Vitest fixtures that pin the decision so a future regression couldn't quietly re-surface an annotation-endpoint finding.

Breakdown:

- **Per-diagnostic semantic write-up (~3h).** Five diagnostics × ~30min each: review the methodology citation, write the per-rule rationale, decide "keep skip" vs "surface" vs "split-rule", and (if "keep skip") name the candidate future-rule task that would change the answer.
- **Source-comment update across the five sites (~1h).** Each diagnostic's skip-guard comment today references `projection_edge_annotation_endpoint` D4. Per D2 we replace that with a back-link to this refinement's Decisions block so the rationale is co-located with the guard. No behaviour change.
- **Vitest mixed-role fixture broadening (~3h).** The predecessor's per-diagnostic skip cases each test ONE annotation-endpoint shape (per the predecessor's Acceptance criteria — "no findings for a projection containing only annotation-endpoint edges"). Per D5 this audit broadens each diagnostic's pin to cover all seven edge roles with both source-only-annotation, target-only-annotation, and both-annotation shapes — five diagnostics × three new cases ≈ ~15 new Vitest cases.
- **No Cucumber delta (~0h).** Per D6 the round-trip-through-JSONB surface is already pinned by the predecessor's `from-log.feature` annotation-endpoint scenario. The audit's per-diagnostic skip is unit-level (no findings emitted either way — no observable difference at the Cucumber-scenario level).
- **WBS housekeeping (~0.5h).** Register the named candidate-future-rule task(s) per Decisions; update `tasks/10-data-and-methodology.tji` complete-mark on close (closer's responsibility).

No source-behavioural change. No new ADR (per D7 — the audit confirms the established skip default rather than introducing a new architectural seam). No DB migration. No UI consumer change.

## Inherited dependencies

**Settled:**

- [`data_and_methodology.projection.projection_edge_annotation_endpoint`](./projection_edge_annotation_endpoint.md) (done — 2026-05-30). The predecessor that widened `ProjectedEdge` to polymorphic endpoints AND installed the skip-on-null-endpoint guards at each of the five diagnostic call sites. Its D4 established the v1 default ("diagnostics conservatively skip annotation-endpoint edges; active-firing throws as a category error"). This task's mandate is to *revisit* that default per diagnostic — keep it, replace it, or split it — and pin the chosen position with broader test cover.
- [`data_and_methodology.diagnostics.cycle_detection`](./cycle_detection.md), [`data_and_methodology.diagnostics.dangling_claim_detection`](./dangling_claim_detection.md), [`data_and_methodology.diagnostics.coherency_hint_detection`](./coherency_hint_detection.md), [`data_and_methodology.diagnostics.multi_warrant_detection`](./multi_warrant_detection.md), [`data_and_methodology.diagnostics.pending_consequences_stub`](./pending_consequences_stub.md) (all done; all carry the predecessor's skip guard).
- [`data_and_methodology.diagnostics.blocking_vs_advisory_classification`](./blocking_vs_advisory_classification.md) (done — 2026-05-25). The closest stylistic precedent: an audit-style refinement that scopes per-diagnostic classifications against `docs/methodology.md` without per-diagnostic payload variation. This refinement borrows that "per-diagnostic Decisions table with methodology citation" structure.
- [`data_and_methodology.event_types.edge_target_annotation_schema_extension`](./edge_target_annotation_schema_extension.md) (done — 2026-05-30). The wire-schema widening upstream of the predecessor.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The audit decision pins as committed Vitest cases (no out-of-tree thought experiment).
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md). Annotations are entity-layer; whether a diagnostic walks them is an entity-layer scoping decision.

**Pending:** (none — every load-bearing input is settled on `main`. The `.tji` note frames the trigger as "once the methodology resolves the structural meaning of annotation-endpoint edges" — per D1 below, methodology-side resolution has *not* materialised in `docs/methodology.md` or `DESIGN.md` for the diagnostic rules; the audit therefore runs against the current methodology and concludes "skip is correct for v1; here are the named follow-ups should methodology evolve.")

## What this task is

Audit each of the five named structural diagnostics — `cycle_detection`, `dangling_claim_detection`, `coherency_hint_detection`, `multi_warrant_detection`, `pending_consequences` — against the question *"should this diagnostic surface findings on annotation-endpoint edges?"* and pin the per-diagnostic answer.

The predecessor `projection_edge_annotation_endpoint` widened `ProjectedEdge` to carry polymorphic endpoints (`sourceNodeId: string | null` + `sourceAnnotationId: string | null`, symmetric target pair) and added conservative `if (edge.sourceNodeId === null || edge.targetNodeId === null) continue;` guards at every diagnostic edge-iteration site. The guard is honest but provisional — it pins behaviour without committing to *why*. This audit's deliverable is the *why*: per diagnostic, the rationale tied to the methodology's structural definition; whether that rationale survives if the rule is restated for annotation endpoints; if so, the candidate restatement; if not, the named follow-up that would change the answer once methodology evolves.

Concretely the deliverable is:

1. **A per-diagnostic decision table** (under Decisions D1–D5 below): for each diagnostic, the rule citation in `docs/methodology.md` / `docs/data-model.md`, the audit conclusion (keep-skip / surface / split-rule), the rationale, and any named candidate-future-rule task.

2. **Source-comment updates** at each diagnostic's skip-guard site, replacing the predecessor's `D4` reference with a back-link to this refinement's Decisions block. No control-flow change — the skip remains.

3. **Broader Vitest pins** for each diagnostic. The predecessor pins one shape per diagnostic; this audit pins all three (node-source/annotation-target, annotation-source/node-target, annotation-source/annotation-target) across every applicable role for that diagnostic. The expansion exists so a future regression that re-surfaces an annotation-endpoint finding under any of the three shapes is caught immediately at unit level.

4. **WBS follow-up registration.** Per D3 (coherency-hint sub-rules) and D4 (per-diagnostic methodology-evolution triggers), specific candidate-future-rule tasks are named under Tech-debt registration for the closer to record in WBS.

Out of scope:

- **`contradiction_detection`** — the `.tji` note explicitly enumerates five detectors and omits `contradiction_detection`. The predecessor *did* install the same skip guard at `contradiction-detection.ts:108-112`, but auditing whether to surface annotation-endpoint contradictions (the E15 case — N19 contradicts A2) requires methodology-side answers the current docs don't carry. Per D8 a separate follow-up task `contradiction_annotation_endpoint_semantics_audit` (~1d) is registered for the closer; it deserves its own slot because the answer is non-trivial and likely involves a methodology-doc edit, not just a code change.
- **`active_firing`** — not in the `.tji` note's list either. Its predecessor decision was "throw" (category error), not "skip" — substantively a different audit question. The predecessor's throw stands; no revisit warranted in v1.
- **Source-code rule additions for new annotation-endpoint findings.** Even if the audit *did* conclude a diagnostic should surface findings on an annotation-endpoint edge, the implementation belongs in the named candidate-future-rule task (so each is scoped, tested, and reviewed independently). This audit's deliverable is the *decision* and *test pins*, not the rule additions themselves.

## Why it needs to be done

**The skip-default is unwritten policy.** Today each diagnostic carries a one-line `// Per projection_edge_annotation_endpoint D4: ... skip.` comment. A reader following the breadcrumb lands in a *projection-layer* refinement whose Decisions block is about widening types — D4's rationale is given in three sentences. Per-diagnostic, the methodology rationale isn't written down. If a future contributor opens `coherency-hint-detection.ts` and asks "why doesn't this rule surface incomplete-warrant findings when the warrant is an annotation?", the answer today is "because the predecessor said so" — that's a project-debt time bomb.

**The methodology is silent on annotation-endpoint diagnostic semantics; the audit codifies the silent stance.** `docs/methodology.md` enumerates the five structural diagnostics in node-node vocabulary (cycles over the supports subgraph, multi-warrants over (data, claim) pairs, etc.) and does not address what those rules mean when one endpoint is an annotation. The audit's role is to make that silence explicit: skip is the right default *because the methodology hasn't specified otherwise*, and per-diagnostic this is the position because of these per-rule properties — not because the predecessor said so.

**The walkthrough fixture E15 refit will exercise the diagnostics on a realistic annotation-endpoint edge.** Once `walkthrough_e15_annotation_endpoint_refit` lands (already named, unblocked by the predecessor), the walkthrough projection will carry an `N19→contradicts→A2` edge. Diagnostic runs against that fixture will produce a defined-by-this-audit outcome (skip — no finding). Without this audit, the walkthrough's diagnostic surface would be observable without being decided.

**The predecessor named THIS task as the rule-by-rule pass.** Per the predecessor's L222 Tech-debt registration: *"Once moderator UI surfaces annotation-endpoint edges, revisit whether each diagnostic should also surface findings on those edges. The default established by this task is 'skip'. Coherency-hint detection in particular may want to surface 'annotation-endpoint edge of role X is unusual' type rules."* This refinement closes that registration with the audit's reasoned outcome, even if the UI-surfacing prerequisite hasn't shipped yet (per D1 the audit can run with the methodology-document and source-comment surfaces alone; UI surfacing is a separate concern).

## Inputs / context

**Design contract:**

- [`docs/methodology.md` lines 165-197 / lines 217-234](../../../docs/methodology.md) — the structural-diagnostic enumeration. Each rule is stated in node-node vocabulary; no rule addresses annotation endpoints. The audit's per-diagnostic Decisions cite the specific line numbers as the rule's authoritative statement.
- [`docs/data-model.md` lines 106](../../../docs/data-model.md) — pending consequences described as a "possible future feature"; the v1 stub stays node-source-only.
- [`docs/data-model.md` lines 171-177](../../../docs/data-model.md) — cycles defined over the supports subgraph.
- [`docs/data-model.md` lines 178-180](../../../docs/data-model.md) — contradictions defined node-node ("A `contradicts` edge between two nodes is itself a structural problem"). The wording supports the predecessor's contradicts-skip decision; out-of-scope here but cited as a coupled position.
- [`docs/data-model.md` lines 189-191](../../../docs/data-model.md) — multi-warrant defined over (data, warrant, claim) triples — all node entities.
- [`docs/data-model.md` lines 193-195](../../../docs/data-model.md) — dangling claim defined as a claim node lacking incoming `supports` / `rebuts` / `bridges-to`. Node-node.
- [`docs/data-model.md` lines 197-199](../../../docs/data-model.md) — coherency hints defined as advisory hints for unusual edge/kind configurations. Phrased generally; the V1 rule set is node-node per the rule registry; future rules MAY address annotation endpoints (per D3).
- [`docs/example-walkthrough.md` line 207 (turn 22)](../../../docs/example-walkthrough.md) — E15 narrative: "N19 contradicts A2 (Anna's reframe). Status: live disagreement." The walkthrough's diagnostic surface for E15 is `contradiction_detection`'s, which this audit explicitly defers to a separate follow-up.

**Architectural / engineering inputs:**

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the decision must ship as committed Vitest cases that pin the skip behaviour for every applicable role × endpoint-shape combination.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are entities; deciding whether a diagnostic walks them is an entity-layer scoping call.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/server/src/diagnostics/cycle-detection.ts:110-134`](../../../apps/server/src/diagnostics/cycle-detection.ts) `buildSupportsAdjacency` — skip-guard at L121 (per predecessor). Comment back-link update only.
- [`apps/server/src/diagnostics/dangling-claim-detection.ts:120-152`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) `detectDanglingClaims` — skip-guard at L135 (per predecessor). Comment back-link update only.
- [`apps/server/src/diagnostics/coherency-hint-detection.ts:162-268`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — three skip-guards at L178, L221, L257 (per predecessor). Comment back-link update only at each; PLUS per D3 a top-of-file comment that names the candidate-future per-rule annotation-endpoint hint(s).
- [`apps/server/src/diagnostics/multi-warrant-detection.ts:86-154`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) `detectMultiWarrants` — two skip-guards at L99 (bridges-from) and L116 (bridges-to) (per predecessor). Comment back-link update only.
- [`apps/server/src/diagnostics/pending-consequences.ts:135-158`](../../../apps/server/src/diagnostics/pending-consequences.ts) `detectPendingConsequences` — skip-guard at L135 (per predecessor). Comment back-link update only.
- [`apps/server/src/diagnostics/cycle-detection.test.ts`](../../../apps/server/src/diagnostics/cycle-detection.test.ts) — pin broadened (per D5).
- [`apps/server/src/diagnostics/dangling-claim-detection.test.ts`](../../../apps/server/src/diagnostics/dangling-claim-detection.test.ts) — pin broadened.
- [`apps/server/src/diagnostics/coherency-hint-detection.test.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.test.ts) — pin broadened, with one case per rule × shape.
- [`apps/server/src/diagnostics/multi-warrant-detection.test.ts`](../../../apps/server/src/diagnostics/multi-warrant-detection.test.ts) — pin broadened.
- [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts) — pin broadened.
- [`apps/server/src/diagnostics/contradiction-detection.ts:108-112`](../../../apps/server/src/diagnostics/contradiction-detection.ts) — *out of scope* per the `.tji` note's enumeration; the skip-guard stands but its comment is not touched by this task. Per D8 a separate follow-up audits it.
- [`apps/server/src/projection/active-firing.ts:135-138`](../../../apps/server/src/projection/active-firing.ts) — *out of scope*; the predecessor's throw stands.

## Constraints / requirements

- **Audit-only scope; no diagnostic rule additions.** Per D2 the audit's deliverable is the per-diagnostic decision + rationale + test pin. Even where the conclusion would be "this diagnostic *should* surface a finding on this annotation-endpoint shape", the implementation belongs in a named follow-up — kept separate so each rule addition gets its own review and methodology-citation check.
- **Methodology-citation-first.** Each per-diagnostic decision in Decisions cites a `docs/methodology.md` or `docs/data-model.md` line range. A decision without a methodology citation is rejected — the audit's value is precisely that it grounds each per-rule call against the docs.
- **Comment back-link convention.** Each touched site replaces `// Per projection_edge_annotation_endpoint D4: ...` with `// Per diagnostics_annotation_endpoint_semantics_audit D<n>: ...` plus a brief restatement of the per-rule reason. Keeps the inline comment self-contained for a reader who lands on the line without context.
- **Test pin shape.** Per D5 each broadened Vitest case asserts the diagnostic returns *zero findings* on a fixture whose ONLY edges are annotation-endpoint edges of the role(s) the diagnostic considers. The pin is in the negative — "no finding emerges" — which a regression that lifts the skip would immediately violate.
- **No source-behaviour change.** This refinement does NOT lift any skip guard. Code-behaviour delta is comment-only across the five touched source files.
- **No new ADR.** Per D7 the audit confirms a default already established; no new architectural seam.
- **No DB migration, no UI change, no Cucumber delta.** Per D6 the per-diagnostic skip is unit-observable only; the round-trip-through-JSONB surface is already pinned by the predecessor's `from-log.feature` scenario.
- **Test discipline per ADR 0022.** Every per-diagnostic skip conclusion ships as a committed Vitest pin; no out-of-tree thought experiment.

## Acceptance criteria

**Pinned per ADR 0022 — every empirical check ships as committed test cover.** Per D6 the test layer here is Vitest unit (the skip is unit-observable; the Cucumber JSONB-roundtrip layer is already pinned by the predecessor). Per the refinement README's test-layer policy, this is a methodology-engine / projection-adjacent task — UI-stream Playwright cover does not apply.

Per-diagnostic comment back-link update (no control-flow change):

- [ ] [`apps/server/src/diagnostics/cycle-detection.ts:121`](../../../apps/server/src/diagnostics/cycle-detection.ts) — skip-guard comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D1: cycles are over the node-supports subgraph (data-model.md L171-177); annotation endpoints are entity-layer metadata, not part of the supports subgraph.`
- [ ] [`apps/server/src/diagnostics/dangling-claim-detection.ts:135`](../../../apps/server/src/diagnostics/dangling-claim-detection.ts) — skip-guard comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D2: a claim's justification requirement (data-model.md L193-195) is satisfied by incoming supports/rebuts/bridges-to from NODE sources; annotation-source edges don't carry substantive justification.`
- [ ] [`apps/server/src/diagnostics/coherency-hint-detection.ts:178,221,257`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) — each skip-guard comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D3: v1 coherency-hint rules (incomplete-warrant, self-contradicts) are node-node (data-model.md L197-199); candidate annotation-endpoint rules are named under that refinement's Tech-debt registration.`
- [ ] [`apps/server/src/diagnostics/multi-warrant-detection.ts:99,116`](../../../apps/server/src/diagnostics/multi-warrant-detection.ts) — each skip-guard comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D4: warrants are nodes (data-model.md L189-191); an annotation cannot play the warrant role.`
- [ ] [`apps/server/src/diagnostics/pending-consequences.ts:135`](../../../apps/server/src/diagnostics/pending-consequences.ts) — skip-guard comment updated to `// Per diagnostics_annotation_endpoint_semantics_audit D5: pending-consequences walks source-NODE substance (data-model.md L106 — possible-future-feature stub); an annotation has no substance facet to read.`
- [ ] [`apps/server/src/diagnostics/coherency-hint-detection.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.ts) top-of-file docblock — one additional paragraph naming the two candidate-future annotation-endpoint rules from D3 (self-referential-annotation-contradicts; annotation-of-annotation chain) as future-task slots; explicit "v1: skip".

Vitest cover (broadened pins — each on a fixture mixing all three annotation-endpoint shapes):

- [ ] [`apps/server/src/diagnostics/cycle-detection.test.ts`](../../../apps/server/src/diagnostics/cycle-detection.test.ts) — new case `'annotation-endpoint supports edges produce no cycles regardless of annotation shape'` over a fixture with three would-be-cycles (node→ann→node, ann→node→ann, ann→ann→ann), each via `supports` role: assert `detectCycles(projection).length === 0`.
- [ ] [`apps/server/src/diagnostics/dangling-claim-detection.test.ts`](../../../apps/server/src/diagnostics/dangling-claim-detection.test.ts) — new case `'a node with only annotation-source incoming edges still surfaces as dangling'` over a fixture where a claim node has incoming `supports`/`rebuts`/`bridges-to` whose sources are ALL annotations: assert the node IS surfaced as dangling (the annotation incomings don't satisfy the justification requirement). PLUS a complementary case `'annotation-target edges don't suppress an otherwise-satisfied claim'` — a claim with a valid node-source `supports` incoming AND annotation-target outgoing: assert NOT dangling.
- [ ] [`apps/server/src/diagnostics/coherency-hint-detection.test.ts`](../../../apps/server/src/diagnostics/coherency-hint-detection.test.ts) — per rule:
  - incomplete-warrant rules (L162-220) — new case asserting no finding on a fixture whose ONLY warrants are reached via annotation-endpoint `bridges-from` / `bridges-to`.
  - self-contradicts rule (L222-268) — new case asserting no finding on a fixture whose ONLY self-loop-shaped contradicts edges are annotation-endpoint (e.g., node→`contradicts`→ann-on-same-node).
- [ ] [`apps/server/src/diagnostics/multi-warrant-detection.test.ts`](../../../apps/server/src/diagnostics/multi-warrant-detection.test.ts) — new case `'annotation-endpoint bridges-from/bridges-to are never counted toward multi-warrant'` over a fixture where two annotation-source warrants reach the same (data, claim) pair: assert `detectMultiWarrants(projection).length === 0`.
- [ ] [`apps/server/src/diagnostics/pending-consequences.test.ts`](../../../apps/server/src/diagnostics/pending-consequences.test.ts) — new case `'annotation-source edges are never pending consequences regardless of source-annotation state'`: fixture has an `agreed`-substance edge whose source is an annotation; assert `detectPendingConsequences(projection).length === 0`.

Existing tests stay green:

- [ ] Every existing Vitest suite passes — including the predecessor's per-diagnostic skip cases (the broadened cases are additive, not replacements).
- [ ] Every existing Cucumber feature passes.
- [ ] Every existing Playwright suite passes.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/server build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green; Vitest baseline rises by ~6 (one or two per diagnostic).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/10-data-and-methodology.tji` gets `complete 100` on `diagnostics_annotation_endpoint_semantics_audit`.

Tech-debt registration:

- [ ] **`coherency_self_referential_annotation_contradicts_rule` (future task — ~0.5d).** A coherency-hint rule that surfaces `node→contradicts→annotation` edges where the annotation's target is the same node — semantically the user is contradicting their own metadata, which structurally means the annotation should be withdrawn rather than the relationship resolved. Conditional on methodology-doc enumeration of the pattern (per D3 the rule is candidate-only; the audit does not add it without a methodology citation). Closer registers under `data_and_methodology.diagnostics.*`. Includes Vitest cover; no Cucumber.
- [ ] **`coherency_annotation_of_annotation_chain_rule` (future task — ~0.5d).** A coherency-hint rule that surfaces `annotation→<role>→annotation` chains of depth ≥ 2 — annotations annotating annotations is itself a structural smell (the methodology favours surfacing meta-discussion via the annotation system; arbitrarily deep recursion suggests the conversation has migrated off the substance graph). Conditional on methodology-doc enumeration. Closer registers under `data_and_methodology.diagnostics.*`. Includes Vitest cover; no Cucumber.
- [ ] **`contradiction_annotation_endpoint_semantics_audit` (future task — ~1d).** Out of this task's `.tji`-defined scope: revisit whether `contradiction_detection` should surface findings on annotation-endpoint contradicts edges (the E15 case — `N19 contradicts A2`). The current skip at `contradiction-detection.ts:108-112` is the predecessor's default; deciding to surface implies methodology-side work specifying what "an agreed contradiction targeting an annotation" means structurally (does it block, advise, or trigger an annotation-withdrawal pathway?). The audit covers `contradiction_detection` separately from this task per the `.tji` note's explicit enumeration. Closer registers under `data_and_methodology.diagnostics.*`.
- [ ] **`pending_consequences_annotation_endpoint_revisit` (future task — ~0.25d).** The current `pending_consequences` is a v1 stub (per data-model.md L106 — "possible future feature"). When that stub graduates to a full implementation, the annotation-endpoint skip should be re-audited under the full rule. The follow-up's effort is small because the answer is already prepared: per D5 annotation sources can't carry substance, so the skip survives the graduation. Registering the slot so a future implementer doesn't have to re-derive the call. Closer registers under `data_and_methodology.diagnostics.*` paired with whatever pending-consequences-full-implementation task is opened.

The other follow-ups the predecessor already named (`mod_render_annotation_endpoint_edges`, `part_render_annotation_endpoint_edges`, `aud_render_annotation_endpoint_edges`, `edges_table_polymorphic_endpoint_migration`, `set_edge_substance_annotation_endpoint`, `walkthrough_e15_annotation_endpoint_refit`) are NOT re-registered here.

## Decisions

- **D1 — `cycle_detection`: keep skip. Cycles are over the supports-subgraph, which is node-node by construction.** Rationale:
  - **`docs/data-model.md` L171-177 defines cycles as a node-supports-walk condition** ("a cycle in the visible `supports` subgraph"). The subgraph's vertices are nodes; edges are visible `supports` instances between nodes. Annotation endpoints aren't in the subgraph's vertex set, so a `supports` edge with an annotation endpoint isn't part of the cycle-detection input.
  - **Semantic check:** could a cycle through an annotation endpoint be a "real" cycle? Consider `node A → supports → annotation X` where `annotation X` annotates `node A`. There's no cycle here — `supports` carries argument-justification semantics that an annotation doesn't participate in. The annotation's anchor is a metadata pointer (data-model.md L82-95), not an argument relationship. Pretending the anchor closes a cycle would conflate the metadata layer with the argument layer.
  - **Test pin:** the broadened Vitest case asserts cycle detection emits no finding for fixtures with annotation-endpoint `supports` edges arranged in would-be-cycle shapes across all three endpoint configurations.
  - **No candidate-future-rule:** the methodology's cycle semantics are tightly coupled to node-substance — no plausible methodology evolution would reframe annotations as supports-graph vertices without changing what `supports` *means*. Skip is permanent absent a new role.
  - **Alternative considered: surface a coherency-hint-style "annotation-endpoint supports edge" warning.** Rejected — that's a `coherency_hint_detection` concern, not `cycle_detection`. Cross-rule responsibilities stay separate (per the diagnostics' single-rule-per-file convention).

- **D2 — `dangling_claim_detection`: keep skip on the inner edge-walk; pin the outer dangling-classification behaviour.** Rationale:
  - **`docs/data-model.md` L193-195 defines a dangling claim as a node positioned as a claim (≥1 visible incoming) with no incoming `supports`, `rebuts`, or `bridges-to`** — phrased entity-agnostically on the wire but operationally restricted to NODE incomings by the existing implementation. The methodology's intent is "the claim isn't justified by the argument graph". An annotation incoming isn't justification — it's metadata commentary about the claim.
  - **Semantic check on the operationally-load-bearing edge case:** a claim node N with one incoming `annotation→supports→N`. Is N dangling? Per the methodology, yes — the annotation source doesn't carry substantive support. The audit therefore pins: dangling-classification ignores annotation-source incomings entirely; only NODE incomings of role `supports`/`rebuts`/`bridges-to` satisfy the justification requirement. The skip guard at L135 already implements this; the audit confirms and writes down the rationale.
  - **Complementary pin:** a claim node N with a node-source `supports` incoming AND an annotation-source `supports` incoming is NOT dangling. The valid node-incoming is sufficient; the annotation incoming is invisible to the diagnostic. The broadened Vitest case pins both shapes.
  - **No candidate-future-rule:** treating annotation-source incomings as satisfying the justification requirement would invert the methodology (annotations would become justifications, conflating layers per ADR 0027).
  - **Alternative considered: surface a dangling-claim finding even when annotation-source incomings exist (i.e., treat annotation incomings as non-justifying but visible).** Rejected — the operational behaviour is identical to the skip, and the wording-change buys nothing.

- **D3 — `coherency_hint_detection`: keep skip on the three v1 rules; name two candidate-future rules with methodology-citation conditionality.** Rationale:
  - **`docs/data-model.md` L197-199 phrases coherency hints generically** ("advisory hints for unusual structural configurations"). The v1 rule set per `coherency_hint_detection.md` Decisions is node-node (incomplete-warrant, self-contradicts); the methodology doc does NOT enumerate annotation-endpoint patterns. The audit therefore keeps the skip for v1 rules.
  - **Two candidate-future-rules surface naturally** from the audit's reading:
    1. **Self-referential-annotation-contradicts** — `node N → contradicts → annotation A` where `A` annotates `N`. The user is contradicting their own annotation; structurally this points at "withdraw the annotation" as the resolution, not "resolve the contradiction". A coherency hint here would surface the pattern as advisory.
    2. **Annotation-of-annotation chain** — `annotation A → role X → annotation B` of depth ≥ 2. The methodology's annotation layer is for metadata-on-substance; arbitrarily deep annotation-on-annotation chains may indicate the meta-discussion has migrated off the substance graph (a smell worth surfacing).
  - **Both rules are conditional on methodology-doc enumeration.** The audit names them as candidate-future tasks (under Tech-debt registration); each is conditional on `docs/methodology.md` adding the pattern to its coherency-hint catalogue. Adding them without a methodology citation would be speculation per the established "structural diagnostics cite a methodology rule" convention.
  - **Source-comment scope.** Per Acceptance criteria, the top-of-file docblock in `coherency-hint-detection.ts` is updated with one paragraph naming the two candidate-future rules so a future contributor reading the file sees the pre-named slots; the per-rule inline guards just get the back-link.
  - **Alternative considered: implement at least the self-referential-annotation-contradicts rule in this task.** Rejected — the audit is the decision layer; rule additions belong in their own task with their own methodology citation step. The pattern is plausible but not yet docs-enumerated; implementing now would force the docs to be amended *after* the rule, inverting the dependency.
  - **Alternative considered: don't name any candidate rules — leave annotation-endpoint coherency entirely as "no skip" follow-up.** Rejected — the .tji note explicitly calls out coherency-hint detection as "may want per-rule annotation-endpoint handling". The audit's value-add is identifying *which* candidate rules and what would need to happen for them to land. Leaving it open-ended is the path-of-least-information.

- **D4 — `multi_warrant_detection`: keep skip. Warrants are node entities by definition.** Rationale:
  - **`docs/data-model.md` L189-191 defines multi-warrant over (data, warrant, claim) triples.** Each of the three is a node with a `kind` facet — `data` / `warrant` / `claim` are values of `kind`, an entity-layer attribute that only applies to NODES (annotations have no `kind` facet — see `ProjectedAnnotation` at `apps/server/src/projection/types.ts:240-251`, no `kind` field).
  - **Semantic check:** an annotation cannot be a warrant because it cannot carry the `warrant` kind. A `bridges-from` edge with an annotation source therefore can't be a "warrant-from-data" edge in the rule's vocabulary. The audit confirms the skip on this strict ontological ground.
  - **No candidate-future-rule:** unlike coherency-hint (where annotation-endpoint patterns are at least plausible), multi-warrant is by-definition node-node. No plausible methodology evolution would invert this without redefining what "warrant" means.
  - **Alternative considered: count any incoming `bridges-from` toward the multi-warrant cardinality regardless of source.** Rejected — methodology rule violation; methodology specifies warrants are nodes.

- **D5 — `pending_consequences`: keep skip on source-NODE walk; record a re-audit slot for when the stub graduates to a full implementation.** Rationale:
  - **`docs/data-model.md` L106 frames pending-consequences as "possible future feature"** and the v1 implementation is a stub per `pending_consequences_stub.md`. The stub walks source-node substance; annotation sources have no substance facet to walk.
  - **Semantic check:** even when the stub graduates to a full implementation, the rule's input is the source's substance facet. Annotation entities lack substance facets (per the ProjectedAnnotation type — no substanceFacet field). The skip survives any rule restatement that operates on source substance.
  - **One open question is recorded as a future re-audit task** (`pending_consequences_annotation_endpoint_revisit`, ~0.25d) so the call is re-checked alongside any pending-consequences full implementation. Pre-stating the answer ("skip still holds") keeps the future task's work minimal but documents that the audit happened.
  - **Alternative considered: bundle the future re-audit into the pending-consequences-full-implementation task itself.** Rejected mildly — keeping it separate makes the audit's coverage explicit (every diagnostic on the .tji-named list has a recorded decision, and pending-consequences' re-check has its own slot). Closer may choose to fold the two if the WBS shape warrants.

- **D6 — Cucumber delta is zero; Vitest is the right pin layer.** Rationale:
  - **The per-diagnostic skip is unit-observable.** No findings emitted means no event-stream surface delta means no observable Cucumber-scenario behaviour. Adding a Cucumber scenario that asserts "no event fires" against an annotation-endpoint fixture would pin the same property the Vitest case pins, with higher per-case cost.
  - **The round-trip-through-JSONB surface is already pinned** by the predecessor's `from-log.feature` annotation-endpoint scenario (`projection_edge_annotation_endpoint` Acceptance L197). The audit doesn't add a new persistence-boundary concern.
  - **ADR 0022 compliance.** Every claim ships as committed test cover; the Vitest pins satisfy this. ADR 0022 doesn't mandate Cucumber for every check — only that empirical claims have committed tests.
  - **Alternative considered: add per-diagnostic-rule Cucumber scenarios (e.g., `cycle-detection.feature` extending with annotation-endpoint coverage).** Rejected per the predecessor's D8 reasoning — "the skip is unit-level: the diagnostic's `for (const edge of ...) if (skip) continue;` line has no observable difference at the Cucumber-layer scenario level".

- **D7 — No new ADR.** Rationale:
  - **The audit confirms an established default** (the predecessor's D4 skip default). Confirming is a refinement-level activity, not an architectural-decision-level one — the seam was already chosen.
  - **Each per-diagnostic decision cites a methodology-doc line range** for its rule statement; the citations are the audit's authoritative grounding. No new architectural alternative is being chosen.
  - **Candidate-future-rules are pre-named in Tech-debt registration** with conditionality on methodology-doc updates. When a follow-up rule lands, *that* refinement may surface an ADR if it introduces a new architectural seam (e.g., "annotations now carry a substance facet" would be ADR-level). The audit itself does not.
  - **Alternative considered: an ADR titled "annotation-endpoint edges do not participate in v1 structural diagnostics".** Rejected — the position is fully captured by the per-diagnostic Decisions block in this refinement; ADR-isation adds no architectural specificity. ADRs capture choices among alternatives at the architectural seam — the audit's per-rule calls are operational refinements within an already-chosen seam (the projection-layer's polymorphic-endpoint shape per predecessor).

- **D8 — `contradiction_detection` is out of scope; register `contradiction_annotation_endpoint_semantics_audit` as a separate follow-up.** Rationale:
  - **The `.tji` note explicitly enumerates five detectors and omits `contradiction_detection`.** The enumeration is authoritative — the task block is the WBS surface, and re-scoping it without authority would conflict with the orchestrator's task-shape ownership.
  - **The omission is principled, not accidental.** `contradiction_detection`'s `.tji`-level audit needs methodology-doc input the current docs don't carry: the E15 case (`N19 contradicts A2`) is in the walkthrough as a *narrative* (turn 22) but is NOT yet annotated with what the diagnostic surface should show. Auditing this requires a methodology-doc edit specifying "an agreed contradiction targeting an annotation" semantics (does it block? advise? trigger annotation-withdrawal?). That's a different decision-shape from the audit-the-skip pattern the other five share.
  - **The follow-up is registered with explicit effort estimate** (~1d) and explicit dependency (a methodology-doc edit specifying the annotation-endpoint contradiction semantics).
  - **Alternative considered: include contradiction_detection in this audit's scope.** Rejected — would expand scope beyond the `.tji` note and would force a half-formed methodology call (or a "keep skip pending methodology" answer that exactly mirrors what a properly-scoped follow-up would record more cleanly).

## Open questions

(none — all decided in D1–D8.)

## Status

**Done** — 2026-05-30.

- `apps/server/src/diagnostics/cycle-detection.ts` — skip-guard comment back-linked to D1 (cycles are over the node-supports subgraph; annotation endpoints are not vertices).
- `apps/server/src/diagnostics/dangling-claim-detection.ts` — skip-guard comment back-linked to D2 (annotation-source incomings don't satisfy the claim-justification requirement).
- `apps/server/src/diagnostics/coherency-hint-detection.ts` — three skip-guard comments back-linked to D3; top-of-file docblock paragraph added naming the two candidate-future annotation-endpoint rules (`coherency_self_referential_annotation_contradicts_rule`, `coherency_annotation_of_annotation_chain_rule`).
- `apps/server/src/diagnostics/multi-warrant-detection.ts` — two skip-guard comments back-linked to D4 (warrants are node entities; annotations carry no `kind` facet).
- `apps/server/src/diagnostics/pending-consequences.ts` — skip-guard comment back-linked to D5 (annotation sources carry no substance facet to walk).
- `apps/server/src/diagnostics/cycle-detection.test.ts` — section heading added; 1 new Vitest case covering all three annotation-endpoint shapes for would-be-cycle supports edges.
- `apps/server/src/diagnostics/dangling-claim-detection.test.ts` — section heading added; 2 new Vitest cases (annotation-source-only incomings still dangling; annotation-target outgoing doesn't suppress a satisfied claim).
- `apps/server/src/diagnostics/coherency-hint-detection.test.ts` — section heading added; 2 new Vitest cases (incomplete-warrant and self-contradicts rules each produce no findings on annotation-endpoint-only fixtures).
- `apps/server/src/diagnostics/multi-warrant-detection.test.ts` — section heading added; 1 new Vitest case (annotation-endpoint bridges-from/bridges-to never counted toward multi-warrant).
- `apps/server/src/diagnostics/pending-consequences.test.ts` — section heading added; 1 new Vitest case (annotation-source edges never surface as pending consequences).
- Tech-debt tasks registered in WBS: `coherency_self_referential_annotation_contradicts_rule`, `coherency_annotation_of_annotation_chain_rule`, `contradiction_annotation_endpoint_semantics_audit`, `pending_consequences_annotation_endpoint_revisit`.
