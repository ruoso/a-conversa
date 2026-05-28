# Defer the `projectVotesByFacet` lift into `@a-conversa/shell` — preconditions remain unmet at refinement time

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.extract_votes_by_facet_projector` (lines 131-150).
**Effort estimate**: 0.5d (WBS budget — the precondition-audit deliverable consumes a fraction; the lift itself does not land until the triggers fire).

## Inherited dependencies

- `shell_package.extract_cytoscape_projectors` (settled 2026-05-28 — [`tasks/refinements/shell-package/extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md)). The strict `!`-edge predecessor and the source-of-debt. Decision §3 there narrowed the cytoscape-projector lift to the annotation trio and pre-registered this leaf with explicit trigger semantics: *"fires when the participant's per-facet vote projector converges shape with the moderator's AND when an audience caller materializes"* ([`extract_cytoscape_projectors.md` Decision §3](extract_cytoscape_projectors.md), citing `extract_cytoscape_projectors.md` line 48 verbatim). The WBS task note at [`tasks/27-shell-package.tji:131-150`](../../27-shell-package.tji#L131) restates both preconditions in identical language. The trigger semantics are inherited unchanged; this refinement audits whether the triggers have fired at its own commit time and, if not, records the structural reason the deferral remains correct.
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_facet_pill` (settled — [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md)). Source of the **three-caller policy** that every shell-package successor inherits (Decision §2 there). One-caller and two-caller helpers stay per-workspace; lift when the third caller materializes with a convergent shape. The participant's "two callers with diverging shapes is YAGNI" framing in [`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4 is the shape-divergence corollary the same policy invokes.
- Prose-only context (NOT a `.tji` edge): `shell_package.extract_facet_status_rules` (settled 2026-05-28 — [`tasks/refinements/shell-package/extract_facet_status_rules.md`](extract_facet_status_rules.md)). The four-caller variant of the same policy (a larger, load-bearing rule walker waited for four implementations before the lift fired). The methodology-bedrock framing there (Decision §1) is the reason vote-projection convergence is treated as a methodology question, not a refactor — same standard of evidence: divergent client mirrors of methodology-bearing helpers don't get lifted by carving an `<T extends ...>` callback API; they get lifted after the underlying methodology is aligned.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md)). Establishes the `packages/shell/src/<area>/` directory layout + root-re-export convention this leaf would inherit when (later) it does fire.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_other_vote_indicators` (settled — [`tasks/refinements/participant-ui/part_other_vote_indicators.md`](../participant-ui/part_other_vote_indicators.md)). The participant leaf that landed [`apps/participant/src/proposals/otherVotesByFacet.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.ts) as the participant's local projector, with the self-filter at insertion and the `OtherVotesByFacetIndex` `ReadonlyMap` shape (Decision §3 there).
- Prose-only context (NOT a `.tji` edge): ADR 0030 (per-facet vote keying). Authority for the per-`(entity, facet)` vote-bucketing semantics both projectors implement; the divergence this refinement audits is in the **proposal-kind → facet-target mapping**, not in the bucketing semantics or the vote arm — those are byte-identical across both surfaces and ADR 0030 §2 unchanged.

## What this task is

The half-day precondition-audit deliverable for the **deferred** `projectVotesByFacet` shell-extraction. The WBS task was registered by [`extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md) Decision §3 with two explicit firing preconditions:

1. The participant's per-facet vote projector (`apps/participant/src/proposals/otherVotesByFacet.ts`) **converges shape** with the moderator's `projectVotesByFacet`.
2. **An audience caller materializes** — i.e., a third surface lands per-facet-vote rendering against the same projection.

This refinement audits both preconditions at refinement time (2026-05-28) and confirms **both remain unmet**:

- Precondition (1) is unmet for a **structural reason** the original deferral note did not fully characterize: the divergence between [`apps/moderator/src/graph/selectors.ts:556-648`](../../../apps/moderator/src/graph/selectors.ts#L556) and [`apps/participant/src/proposals/otherVotesByFacet.ts:59-125`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L59) is not cosmetic (naming, mutability) but **methodology-shaped** — the two `facetTargetOf` / `voteTargetOf` helpers handle **different proposal-kind vocabularies** ([`apps/moderator/src/graph/selectors.ts:517-535`](../../../apps/moderator/src/graph/selectors.ts#L517) vs [`apps/participant/src/proposals/otherVotesByFacet.ts:31-46`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31)): the moderator's projector handles `amend-node` but NOT `capture-node`; the participant's handles `capture-node` but NOT `amend-node`. Both omissions silently drop legitimate vote events when those proposal kinds appear in the session log. Cross-surface alignment of the vocabularies is **methodology work**, not a pure refactor, and there is no settled refinement, ADR, or open task that has aligned them yet (Decision §1).
- Precondition (2) is unmet because no audience surface today renders per-facet votes. The audience graph view ([`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts), [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx)) projects nodes + edges + annotations + axiom-marks but does NOT project per-facet votes; the audience's [`AudiencePerFacetPillOverlay`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) paints rolled-up facet *status* pills (drawn from `computeFacetStatuses`), not per-voter vote dots. No `aud_*_vote_*` task exists in the WBS today that would materialize a third caller (Decision §2).

The audit's deliverable is this refinement document itself: a recorded confirmation that the deferral remains correct, the trigger semantics are unchanged, and the path to firing is named crisply enough that a future orchestrator pass picks the lift back up when the triggers do fire. No code lands. No shell directory is created. No imports rewire. The `## Status` block records the audit outcome (Decision §3).

After this leaf:

- [`tasks/refinements/shell-package/extract_votes_by_facet_projector.md`](extract_votes_by_facet_projector.md) (this file) exists as the audit record.
- The two projectors stay where they are: [`apps/moderator/src/graph/selectors.ts:556-648`](../../../apps/moderator/src/graph/selectors.ts#L556) (canonical moderator shape) and [`apps/participant/src/proposals/otherVotesByFacet.ts:59-125`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L59) (participant's self-filtered variant). Neither is touched.
- The WBS task is marked `complete 100` by the closer (the audit IS the deliverable for this leaf's budget; the lift is a separate future leaf — see Decision §4 for the registration shape). The closer registers a follow-up named-future-task in `tasks/27-shell-package.tji` with the audit's findings folded into its trigger conditions (Decision §4 names it).
- The next time the third-caller trigger appears to fire (an audience per-facet vote rendering refinement reaches its source-of-debt stage), the implementer reads this audit first and acts on the named-future-task — not on this leaf, which is closed.

Out of scope (explicitly NOT done here):

- **The lift itself.** No `packages/shell/src/votes-by-facet/` directory is created. No `projectVotesByFacet` is moved. No callers rewire imports. The shell substrate gains no new symbol.
- **Cross-surface methodology alignment** of the proposal-kind vocabulary (the `amend-node` / `capture-node` divergence in `voteTargetOf` / `facetTargetOf`). That work is a separate refinement (named in Decision §4) belonging to the data-and-methodology work-stream, not the shell-package work-stream. This audit identifies the gap; the alignment task is what closes it.
- **A parametric / callback-shaped projector** that takes the proposal-kind → facet-target mapping as a caller argument. Rejected as a path forward (Decision §1, alternative C) — same reasoning as `part_graph_render.md` Decision §4: a callback-shaped indirection for two callers with diverging vocabularies is more code than the duplication and lifts an under-pressure-tested API into the shell.
- **A union-vocabulary projector** that handles `amend-node` AND `capture-node` (both surfaces import the same shell-lifted projector). Rejected as a path forward without prior methodology alignment (Decision §1, alternative B) — silently expanding both surfaces' vote-count display is a behavior change, not a refactor, and requires methodology-side sign-off + a Cucumber pin per `extract_facet_status_rules` Decision §1's bedrock-divergence framing.
- **Audience-side vote rendering.** Out of scope — the trigger that would make precondition (2) fire is the audience leaf that would create the third caller. That leaf does not exist yet; this audit names it as a precondition (Decision §2) but does not specify it.
- **Server-side `deriveFacetStatus` / projection pipeline.** Untouched. The server's per-(entity, facet) status deriver in [`apps/server/src/projection/facet-status.ts`](../../../apps/server/src/projection/facet-status.ts) is a different consumer of the same vote events; it stays out of scope for any client-side per-facet-vote projector consolidation.
- **`Vote` type.** Already lifted to the shell via [`packages/shell/src/facet-pill/vote-indicator.ts`](../../../packages/shell/src/facet-pill/vote-indicator.ts) (per `shell_package.extract_facet_pill`); both projectors import it from `@a-conversa/shell`. No movement needed.
- **`projectVotesByProposal`** ([`selectors.ts:779`](../../../apps/moderator/src/graph/selectors.ts#L779)). Moderator-only single-caller helper. Out of this leaf's name list (per `extract_cytoscape_projectors.md` Out-of-scope §49). Not registered as a named-future-task.
- **`EMPTY_OTHER_VOTES_BY_FACET_INDEX`** ([`otherVotesByFacet.ts:23`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L23)). Participant-local frozen empty index. Single caller; tied to the participant's `ReadonlyMap` variant. Not extracted here; would move alongside the projector if and when the lift fires.

## Why it needs to be done

The deferred-task registration in [`extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md) Decision §3 named two firing preconditions and noted that the WBS closer would register this task with effort + one-line description so the orchestrator pick-task pass would surface it. The pick-task pass did surface it, on cadence. The orchestrator pass cannot itself verify whether the named preconditions are actually met at refinement time — that's a refinement-stage activity. This audit is that activity.

Two observations make the audit valuable (rather than a no-op formality):

1. **The shape divergence was characterized as cosmetic / soft.** The original deferral language in [`extract_cytoscape_projectors.md` line 48](extract_cytoscape_projectors.md) reads "the participant uses a different output shape via `apps/participant/src/proposals/otherVotesByFacet.ts`" — phrasing that suggests the divergence is at the return-type level (mutable vs read-only `Map`) and could close with a simple `Readonly` widen or a constructor refactor. The actual divergence at code-read time is **methodology-shaped**: the two surfaces handle different proposal-kind vocabularies in their `facetTargetOf` / `voteTargetOf` helpers. Recording this in an audit prevents a future implementer (or a future orchestrator pass) from picking the lift back up under the mistaken assumption that the convergence is a one-hour cleanup.

2. **No audience caller has been scheduled.** The audience surface today renders facet *status* pills (drawn from `computeFacetStatuses`) but not per-facet *vote dots*. No `aud_*_vote_indicator` / `aud_*_other_votes` leaf exists in [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) that would materialize the third caller. The closer's follow-up task registration (Decision §4) folds this gap into the named-future-task's trigger condition so that the lift, when it does fire, fires against a real third caller — not against a speculative one.

The follow-on benefit of the audit:

- **Prevents premature ossification.** The three-caller policy's whole point is to wait until empirical convergence rather than to design-shape-and-hope. Lifting `projectVotesByFacet` into the shell today (as a parametric callback or a vocabulary-union) would lock in a shape that has not yet been pressure-tested by either a third caller or by methodology-side alignment of the vocabularies. The audit defers that ossification and identifies what evidence the future lift wants to see before firing.
- **Records the named-future-task path crisply.** The orchestrator brief's tech-debt registration policy asks every deferred task to be named with effort + description; Decision §4 supplies both.
- **Closes a stale WBS leaf cleanly.** Leaving the `extract_votes_by_facet_projector` leaf open on the orchestrator's pick-task queue without an audit means every orchestrator pass picks it up and re-refines it. The closer marks this leaf complete; the future-trigger work is held by the named-future-task and does not block the queue.

## Inputs / context

### ADRs

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). The Vitest layer for both projectors stays where it is — the moderator's [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) cases 1281, 1299, 1326, 1358, 1391, 1426, 1444, 1469, 1506 and the participant's [`apps/participant/src/proposals/otherVotesByFacet.test.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.test.ts) cases 124, 133, 144, 155, 167, 179, 188, 198, 207 are the regression pin for each surface's local behavior. No throwaway smoke script is introduced here; this audit produces no executable artifact.
- [ADR 0030 — Per-facet vote keying](../../../docs/adr/0030-per-facet-vote-keying.md). §2 (the `target`-discriminated union for vote payloads) is what both `projectVotesByFacet` and `projectOtherVotesByFacet` resolve through; the divergence audited here is upstream of §2 (in proposal-kind → target mapping), not in §2's vote-arm handling.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md). When the lift does fire, the shell's `packages/shell/src/votes-by-facet/` directory is the architecturally-correct home per the ADR's substrate posture (every UI surface already depends on `@a-conversa/shell` at runtime).

### Prior shell-package decisions this audit is bound by

- [`extract_cytoscape_projectors.md`](extract_cytoscape_projectors.md) Decision §3 — the registration of THIS task, with the two firing preconditions verbatim.
- [`extract_facet_pill.md`](extract_facet_pill.md) Decision §2 — the three-caller policy that subsequent shell-package leaves inherit.
- [`extract_facet_status_rules.md`](extract_facet_status_rules.md) Decision §1 — bedrock-divergence framing: load-bearing methodology-shaped helpers don't lift via callback API; they wait for cross-surface alignment + a real third caller.
- [`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4 — "two callers with diverging shapes is YAGNI"; cited verbatim in the deferral note.
- [`part_other_vote_indicators.md`](../participant-ui/part_other_vote_indicators.md) Decision §3 — established the participant's `OtherVotesByFacetIndex` `ReadonlyMap` shape + the self-filter-at-insertion posture.

### Live code at refinement time

#### Moderator surface — canonical `projectVotesByFacet`

[`apps/moderator/src/graph/selectors.ts:556-648`](../../../apps/moderator/src/graph/selectors.ts#L556) defines:

```typescript
export function projectVotesByFacet(events: readonly Event[]): Map<string, Map<FacetName, Vote[]>>
```

The internal `voteTargetOf` proposal-kind dispatcher at [`apps/moderator/src/graph/selectors.ts:517-535`](../../../apps/moderator/src/graph/selectors.ts#L517) handles five proposal kinds:

- `classify-node` → `{node, classification}`
- `set-node-substance` → `{node, substance}`
- `set-edge-substance` → `{edge, substance}`
- `edit-wording` → `{node, wording}`
- `amend-node` → `{node, wording}`

Default branch (lines 530-534) explicitly excludes `decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `annotate` — and (silently, by omission) `capture-node`. The header comment at [`selectors.ts:456-554`](../../../apps/moderator/src/graph/selectors.ts#L456) names the five handled kinds but does not flag the `capture-node` omission as deliberate.

Callers:

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:119`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L119) (import) + [`:534`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L534) (call site).
- [`apps/moderator/src/layout/PendingProposalsPane.tsx:64`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L64) (import) + [`:633`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L633) (call site, `useMemo`-wrapped).

Test coverage: [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) — nine `projectVotesByFacet` cases at lines 1281, 1299, 1326, 1358, 1391, 1426, 1444, 1469, 1506.

#### Participant surface — `projectOtherVotesByFacet`

[`apps/participant/src/proposals/otherVotesByFacet.ts:59-125`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L59) defines:

```typescript
export function projectOtherVotesByFacet(
  events: readonly Event[],
  currentParticipantId: string,
): OtherVotesByFacetIndex
```

with [`otherVotesByFacet.ts:21`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L21):

```typescript
export type OtherVotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;
```

The internal `facetTargetOf` proposal-kind dispatcher at [`apps/participant/src/proposals/otherVotesByFacet.ts:31-46`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31) handles five proposal kinds:

- `capture-node` → `{node, wording}`
- `classify-node` → `{node, classification}`
- `set-node-substance` → `{node, substance}`
- `set-edge-substance` → `{edge, substance}`
- `edit-wording` → `{node, wording}`

Default branch (lines 43-45) silently excludes `amend-node` — and every other proposal kind.

The self-filter is at [`otherVotesByFacet.ts:76`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L76): `if (participantId === currentParticipantId) continue;` — dropped at insertion, not as a post-filter pass.

The module header at [`otherVotesByFacet.ts:48-58`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L48) claims: *"Mirrors the moderator's `projectVotesByFacet` verbatim except for the self-filter."* The audit observes this claim is **inaccurate** at refinement time — the proposal-kind vocabulary is also divergent (Decision §1).

Caller: [`apps/participant/src/proposals/PendingProposalsPane.tsx:39`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L39) (import) + [`:80`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L80) (call site, `useMemo`-wrapped). Re-exported as a public symbol from [`apps/participant/src/proposals/index.ts:34-36`](../../../apps/participant/src/proposals/index.ts#L34).

Test coverage: [`apps/participant/src/proposals/otherVotesByFacet.test.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.test.ts) — nine cases at lines 124, 133, 144, 155, 167, 179, 188, 198, 207.

#### Audience surface — no caller exists

[`apps/audience/src/graph/`](../../../apps/audience/src/graph/) at refinement time contains: `GraphView.tsx`, `projectGraph.ts`, `projectGraph.test.ts`, `annotations.ts` (deleted by `extract_cytoscape_projectors` — now imports from `@a-conversa/shell`), `facetStatus.ts` (deleted by `extract_facet_status_rules` — now imports from `@a-conversa/shell`), `axiomMarks.ts` (deleted by `shell_axiom_marks_extraction` — now imports from `@a-conversa/shell`), `PerFacetPillOverlay.tsx` (facet-status pill row, not per-voter dots), `AnnotationOverlay.tsx`, `AudienceAnnotationOverlay.tsx`, plus their `.test.tsx` siblings. There is no `votesByFacet.ts`, no `OtherVotesOverlay.tsx`, no `PerVoterDotRow.tsx`, no caller of either projector. No WBS leaf in [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) names per-facet vote rendering as in-scope work.

#### Existing shell substrate — `Vote` already lifted; no votes-by-facet home yet

[`packages/shell/src/`](../../../packages/shell/src/) at refinement time hosts: `annotations/`, `axiom-marks/`, `facet-pill/` (carrying `Vote` + `EMPTY_VOTES` at `vote-indicator.ts`, plus `<VoteIndicator>` + `<FacetPill>` + `FacetName` + `FacetStatus` types), `facet-status/` (lifted 2026-05-28), `ws/`, etc. No `votes-by-facet/` directory exists. The `Vote` type both projectors return is already canonical at [`packages/shell/src/facet-pill/vote-indicator.ts`](../../../packages/shell/src/facet-pill/vote-indicator.ts); both surfaces import it from `@a-conversa/shell`. The hosting infrastructure (sibling-directory layout + root re-export pattern) is ready when the lift fires.

## Constraints / requirements

- **Do not lift anything.** Both preconditions in the deferral note must be met before any shell directory is created or any caller is rewired. Both are unmet at this leaf's commit time (Decisions §1, §2). The audit is the entire deliverable.
- **Do not introduce a callback-shaped or vocabulary-union projector now.** Either path lifts an under-pressure-tested API into the shell and contradicts the three-caller policy that this leaf inherits (Decision §1, alternatives B and C).
- **Do not silently align the two vocabularies.** Closing the `amend-node` / `capture-node` gap at either surface is a methodology decision that requires its own refinement + Cucumber pin (per the `extract_facet_status_rules` bedrock-divergence standard). This audit identifies the gap; it does not close it.
- **Do not edit the two existing projectors.** No header-comment correction, no `Readonly` widen, no signature change. The participant module's inaccurate "verbatim except for the self-filter" claim is recorded in this audit but not edited in code — that's part of the alignment-task scope.
- **Do not edit any `.tji` file.** Per the refinement-writer brief, the orchestrator / closer own WBS shape. Decision §4 names the follow-up task crisply (effort + one-line description) so the closer can register it mechanically.
- **Audit findings stay in this refinement document.** No new ADR is needed — the methodology question (which proposal kinds should each surface count as per-facet votes) is the alignment-task's job to resolve via its own refinement, possibly with an ADR amendment to 0030 §2 if the resolution warrants it. This audit only records the gap.
- **No Playwright / Cucumber coverage added.** Pure documentation deliverable; no protocol seam crossed, no projector output changed, no user-visible behavior shift.

## Acceptance criteria

- [`tasks/refinements/shell-package/extract_votes_by_facet_projector.md`](extract_votes_by_facet_projector.md) (this file) lands in the same commit as the `complete 100` marker. The file contains: the audit of both preconditions, the structural reason precondition (1) is unmet (vocabulary divergence), the absence of any audience caller satisfying precondition (2), the rejection rationale for parametric / union-vocabulary alternatives, and the crisp registration of the follow-up named-future-tasks Decision §4 names.
- **No new code in `packages/shell/src/`.** A `grep` of [`packages/shell/src/`](../../../packages/shell/src/) for `votesByFacet` / `projectVotesByFacet` / `OtherVotesByFacetIndex` returns zero results.
- **No edits to the two existing projectors.** `git diff HEAD` on [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) and [`apps/participant/src/proposals/otherVotesByFacet.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.ts) is empty for this commit.
- **No edits to `packages/shell/src/index.ts`.** No new `// ─── votes-by-facet ───` re-export block.
- **Two follow-up named-future-tasks are crisply named in Decision §4**, each with effort + one-line description, ready for the closer to register in `tasks/27-shell-package.tji` and `tasks/10-data-and-methodology.tji` respectively (deferred to: `shell_package.extract_votes_by_facet_projector_v2` and `data_and_methodology.align_vote_facet_target_vocabulary` — closer registers both in WBS).
- **TaskJuggler validity preserved.** `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` returns silent after the closer's `complete 100` + named-future-task registrations.
- **No throwaway verification scripts.** Per ADR 0022, this audit's deliverable is the refinement document itself; both projectors' existing Vitest suites (moderator's `selectors.test.ts`, participant's `otherVotesByFacet.test.ts`) continue to pin each surface's local behavior unchanged. No new test, no smoke script, no executable artifact.
- **No Playwright / Cucumber scoped.** Pure documentation; no behavior change at any seam. The UI-stream e2e policy does not apply (this is not a UI-stream leaf and creates no new component / event surface).
- **Status block records audit outcome.** When the closer appends the `## Status` block, it records: "audit complete; preconditions unmet; lift deferred to `shell_package.extract_votes_by_facet_projector_v2`; vocabulary-alignment debt registered as `data_and_methodology.align_vote_facet_target_vocabulary`." Prior sections (Decisions, Inputs/context) stay untouched per the refinements/README.md ritual.

## Decisions

### §1 — Preconditions are unmet; the participant/moderator divergence is methodology-shaped, not cosmetic

The original deferral note in [`extract_cytoscape_projectors.md` line 48](extract_cytoscape_projectors.md) and the WBS task note at [`tasks/27-shell-package.tji:138-140`](../../27-shell-package.tji#L138) both characterize the participant/moderator divergence as a *"shape"* divergence. At code-read time the divergence is more specifically a **proposal-kind vocabulary divergence in the internal target-dispatcher helpers**:

- The moderator's [`voteTargetOf`](../../../apps/moderator/src/graph/selectors.ts#L517) handles: `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`, `amend-node`. It does NOT handle `capture-node` (silently null-returned via the default branch).
- The participant's [`facetTargetOf`](../../../apps/participant/src/proposals/otherVotesByFacet.ts#L31) handles: `capture-node`, `classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`. It does NOT handle `amend-node` (silently null-returned via the default branch).

The shared kinds (`classify-node`, `set-node-substance`, `set-edge-substance`, `edit-wording`) project identically. The divergent kinds — `amend-node` (moderator-only) and `capture-node` (participant-only) — represent observable behavior gaps: a vote on an `amend-node` proposal that lands in the session log is counted in the moderator's per-facet pill but NOT in the participant's; a vote on a `capture-node` proposal is counted in the participant's pill but NOT in the moderator's. Whether that is intended methodology or oversight is **a methodology question**, not a refactor question.

Three options for handling the divergence:

- **(A — chosen)** Treat the divergence as methodology-shaped; defer the lift; register a methodology-side alignment task (`data_and_methodology.align_vote_facet_target_vocabulary`, Decision §4) whose own refinement decides whether both surfaces should count both kinds, only the surface-native kinds, or some other rule, and lands matching Cucumber + Vitest pins. The shell-extract lift fires only after the alignment task lands AND the audience caller materializes. Reasoning: this is the same standard `extract_facet_status_rules` Decision §1 applied to a bedrock-divergence question; methodology-shaped helpers don't lift via API tricks. Honors three-caller policy and the "diverging shapes is YAGNI" rule simultaneously.
- **(B)** Lift now with a vocabulary-union projector: a single `projectVotesByFacet(events, options?)` whose `voteTargetOf` handles all six kinds (`amend-node` + `capture-node` + the four shared). Both surfaces import the union. Cost: silently expands both surfaces' vote-display behavior without methodology-side sign-off. Adding `amend-node` to the participant means the participant suddenly displays a vote it never displayed; adding `capture-node` to the moderator suddenly displays a vote it never displayed. That is a behavior change masquerading as a refactor — exactly what ADR 0022's "no throwaway verifications" + the `extract_facet_status_rules` bedrock-divergence framing exist to prevent. Additionally, only two callers — third-caller policy is not satisfied; this is the "two callers with diverging shapes is YAGNI" case from `part_graph_render.md` Decision §4. Rejected.
- **(C)** Lift now as a parametric projector: `projectVotesByFacet(events, voteTargetOf, options?)` where each caller passes its own proposal-kind dispatcher. Cost: ossifies a callback-shaped indirection in the shell substrate for a code body whose mechanical skeleton is ~50 lines; net more code than the duplication; each future caller has to author its own `voteTargetOf`. The audience-caller third-caller event would arrive as "audience passes its own dispatcher too" — three dispatchers in three workspaces feeding one shell skeleton, which is the abstraction the `extract_facet_status_rules` Decision §5 framing explicitly rejected ("zero workspace-local helpers in any facetStatus.ts"). Rejected.

Chosen: (A). The methodology question (which proposal kinds count as per-facet votes at which surface) is what the alignment task answers; the answer is what makes the lift's API shape empirically chosen rather than designed. Both predecessor shell-package leaves followed this pattern (`extract_facet_pill.md` Decision §2; `extract_facet_status_rules.md` Decision §1).

### §2 — No audience caller exists; precondition (2) cannot be satisfied without a new audience leaf

The audience graph view at [`apps/audience/src/graph/`](../../../apps/audience/src/graph/) projects nodes, edges, annotations (via `@a-conversa/shell`), axiom-marks (via `@a-conversa/shell`), and facet-statuses (via `@a-conversa/shell`'s `computeFacetStatuses`). It paints facet-status pills via [`PerFacetPillOverlay`](../../../apps/audience/src/graph/PerFacetPillOverlay.tsx) — those pills show the per-facet *rolled-up status* (proposed / agreed / disputed / etc.), NOT the per-voter dot row that `projectVotesByFacet` projects.

A WBS scan of [`tasks/50-audience-and-broadcast.tji`](../../50-audience-and-broadcast.tji) reveals no leaf named `aud_other_vote_*`, `aud_per_voter_*`, `aud_vote_indicator*`, or similar. The audience surface has no scheduled per-voter rendering work. Precondition (2) is therefore not just "not yet fired" — it has no candidate WBS leaf that would fire it.

Three options:

- **(A — chosen)** Defer; register the precondition as gating the future lift; do NOT preemptively scope an audience leaf here (audience work belongs to the audience work-stream's own design pass, not to a shell-package precondition-audit). Reasoning: scoping audience work from a shell-package refinement inverts the dependency direction the WBS deliberately enforces (`shell_package.*` depends on audience leaves materializing, not vice versa). When (and if) the audience design adds per-voter rendering, the natural source-of-debt path is identical to `aud_annotation_rendering` → `extract_cytoscape_projectors`: the audience leaf verbatim-ports the moderator's projector (with whatever alignment §1 settled), the third-caller trigger fires, and the deferred `extract_votes_by_facet_projector_v2` (Decision §4) is picked up.
- **(B)** Speculatively scope `aud_per_voter_vote_indicators` here so precondition (2) has a named candidate. Cost: design-by-shell-package; the audience surface's per-voter design is not a settled question (the audience may legitimately not want per-voter dots, preferring rolled-up status pills only — which is exactly its current shape). Rejected.
- **(C)** Reframe precondition (2) as "audience OR replay-test OR root-app composite," widening the third-caller surface. Cost: dilutes the trigger; the original deferral note named "audience" specifically for a reason (the audience is the natural third-Cytoscape-caller per `extract_cytoscape_projectors.md` Decision §3). Rejected.

Chosen: (A). The audit records the absence of an audience caller as a true precondition; the future-lift task's trigger condition is updated to reflect "audience caller AND vocabulary alignment" (Decision §4 wording).

### §3 — The audit IS the leaf's deliverable; the leaf closes complete 100

The `extract_votes_by_facet_projector` WBS leaf was registered at 0.5d effort with the expectation that lift work would consume it. The audit deliverable is smaller (~0.25d) but is what's actually warranted at refinement time. Three options for what the closer does:

- **(A — chosen)** Mark this leaf `complete 100`. The audit's content (this refinement document) IS the leaf's output; the lift work is held by a new named-future-task (Decision §4) whose trigger conditions reflect the audit's findings. The orchestrator pick-task queue moves on; the future-lift task waits for its triggers without re-refining this leaf each pass.
- **(B)** Leave this leaf incomplete; let the orchestrator re-pick it next pass. Cost: every pass would re-discover the same audit findings; refinement-document churn; the audit's value (frozen documentation of the gap + the alignment-task registration) is lost to "in progress" status.
- **(C)** Mark `complete 100` AND rename this leaf to `audit_votes_by_facet_extraction_preconditions`. Cost: WBS leaf-renaming churn; the existing name is searchable across `extract_cytoscape_projectors.md` Decision §3 references and the WBS note's prose; rename would invalidate those references for marginal clarity gain. Rejected.

Chosen: (A). Honors the orchestrator's tech-debt registration policy (the future-lift is registered crisply per Decision §4); closes this leaf cleanly; keeps the audit findings in a single, citable place.

### §4 — Register two follow-up named-future-tasks: one methodology, one shell-package

The audit identifies two distinct workstreams the lift waits on. Each is a separate WBS leaf; conflating them into one task would tangle methodology with refactor scope. The closer registers both.

**Task 1 (methodology workstream, prerequisite):**
- **Name**: `data_and_methodology.align_vote_facet_target_vocabulary`
- **Effort**: 0.5d (Vitest + Cucumber pins for whichever vocabulary the alignment refinement selects; matching one-line edits in `voteTargetOf` + `facetTargetOf`).
- **Description**: "Decide whether `projectVotesByFacet` (moderator) + `projectOtherVotesByFacet` (participant) should agree on a single proposal-kind → facet-target vocabulary; today the moderator handles `amend-node`-without-`capture-node` and the participant handles `capture-node`-without-`amend-node`. Land the agreed vocabulary in both surfaces' helpers + add a Cucumber scenario pinning the vote-count behavior at the cross-surface seam."
- **Home**: [`tasks/10-data-and-methodology.tji`](../../10-data-and-methodology.tji) (methodology surface).
- **Trigger**: ripe immediately (the misalignment exists today; closing it is independent of audience work).
- **Source of debt**: this refinement, Decision §1.

**Task 2 (shell-package workstream, deferred):**
- **Name**: `shell_package.extract_votes_by_facet_projector_v2`
- **Effort**: 0.5d (the lift itself: create `packages/shell/src/votes-by-facet/`, lift the now-aligned projector + Vitest suite, rewire all three callers' imports; same shape `extract_cytoscape_projectors` followed for the annotation trio).
- **Description**: "Lift the aligned `projectVotesByFacet` into `@a-conversa/shell` once `data_and_methodology.align_vote_facet_target_vocabulary` lands AND a third caller (audience per-voter rendering) materializes. The participant's `projectOtherVotesByFacet` collapses to a thin wrapper that adds the self-filter on top of the shell-lifted projector (or both projectors land in the shell — alignment-task decides the shape)."
- **Home**: [`tasks/27-shell-package.tji`](../../27-shell-package.tji) (shell-package surface).
- **Trigger**: fires when **both** of the following hold: (a) `data_and_methodology.align_vote_facet_target_vocabulary` is `complete 100`, AND (b) a third caller (audience surface, or replay-test, or root-app composite) lands per-facet-vote rendering against the now-aligned projector.
- **Depends on**: `data_and_methodology.align_vote_facet_target_vocabulary` (`!`-edge), plus the future audience leaf that creates the third caller (the audience leaf does not exist yet; the future-task's dependency edge against it is added when it does).
- **Source of debt**: this refinement, Decisions §1–§3.

Two reasons for the v2-suffix rather than a single follow-up task:

- The original `extract_votes_by_facet_projector` leaf has a fixed identity in the WBS history (it was registered by `extract_cytoscape_projectors` Decision §3; its `complete 100` closes the audit). Reusing the same name for the lift would be ambiguous in `tj3` history and in cross-refinement citations.
- The two preconditions are non-trivially split: the methodology-alignment task can fire today; the shell-lift task waits for the audience caller. Naming them separately gives each its own trigger semantics.

Three rejected alternatives:

- **One combined task** that handles both alignment + lift. Cost: tangles methodology decisions with refactor scope; the alignment task may pick an outcome (e.g., "each surface keeps its native vocabulary by design") that makes the lift inappropriate, in which case the combined task would have to be retroactively split. Rejected.
- **No new tasks** — let the existing `extract_votes_by_facet_projector` stay open with updated trigger semantics. Cost: orchestrator pick-task queue keeps re-picking this leaf; the audit's value is lost to "in progress" status; closer ritual cannot fire `complete 100`. Rejected (same reasoning as Decision §3 alternative B).
- **Defer audience-leaf creation into a third named-future-task** (`audience.aud_per_voter_vote_indicators`). Cost: shell-package-refinement-scoping-audience-work, inverts dependency direction (per Decision §2 alternative B). Rejected.

Chosen: two named-future-tasks, named and effort-estimated as above, ready for the closer to register mechanically.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- Audit confirmed both preconditions for lifting `projectVotesByFacet` into `@a-conversa/shell` remain unmet at this leaf's commit time.
- Precondition (1) unmet: vocabulary divergence between `apps/moderator/src/graph/selectors.ts:517-535` (`voteTargetOf`) and `apps/participant/src/proposals/otherVotesByFacet.ts:31-46` (`facetTargetOf`) is methodology-shaped, not cosmetic — moderator handles `amend-node` but not `capture-node`; participant handles `capture-node` but not `amend-node`.
- Precondition (2) unmet: no audience caller renders per-facet votes; `apps/audience/src/graph/` contains no `votesByFacet.ts`, no per-voter overlay, and no WBS leaf schedules audience per-voter rendering.
- No code landed: `packages/shell/src/` has no `votes-by-facet/` directory; both projectors (`selectors.ts:556-648`, `otherVotesByFacet.ts:59-125`) untouched; no `packages/shell/src/index.ts` re-export added.
- Lift deferred to `shell_package.extract_votes_by_facet_projector_v2`; vocabulary-alignment debt registered as `data_and_methodology.align_vote_facet_target_vocabulary`.
- Both follow-up tasks registered in WBS (`tasks/27-shell-package.tji`, `tasks/10-data-and-methodology.tji`) per Decision §4.
- Refinement document itself is the deliverable; existing Vitest suites (`apps/moderator/src/graph/selectors.test.ts`, `apps/participant/src/proposals/otherVotesByFacet.test.ts`) continue pinning each surface's local behavior unchanged.
