# Per-participant vote indicators inside the pane's per-facet chip strip

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_pending_proposals.part_vote_indicators_in_pane`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_pending_proposals.part_per_facet_breakdown_in_pane` (settled — commit `19ba7bb` shipped the chip strip inside the expanded-row body. The chip layout is intentionally left extensible by the predecessor's Decision §6: "this leaf leaves the chip layout extensible — adding a per-facet vote-indicator row inside the chip in the sibling is a chip-internal change". The chip's existing testid contract (`data-testid="participant-pending-proposal-row-facet"`, `data-facet-name="<facet>"`, `data-facet-status="<status>"`) is byte-stable from this leaf's perspective; the indicator row mounts INSIDE the existing chip span as a sibling of the chip's text label, mirroring the moderator's [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:158-185`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx#L158) JSX shape).
- Prose-only context (NOT a `.tji` edge): `!moderator_ui.mod_pending_proposals_pane.mod_vote_indicators_in_sidebar` (settled). The moderator's analogous in-chip indicator row already encodes every decision this leaf needs: the `<VoteIndicator>` (now exported from [`@a-conversa/shell`](../../../packages/shell/src/facet-pill/VoteIndicator.tsx)) is used inline per `Vote`; the row container carries its own `data-testid` distinct from the graph's `data-vote-indicator-row` so test selectors target one surface at a time; the inner `<VoteIndicator>` children carry the cross-surface `data-vote-indicator` sentinel + `data-participant-id` + `data-choice`. The selector signature the moderator settled on (`derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus, votesByFacetIndex, proposalEventId, votesByProposalIndex)`) is the shape this leaf grows the participant selector to.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_other_vote_indicators` (settled — `projectOtherVotes(events, currentParticipantId): OthersVoteIndex` lives at [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) and produces a per-entity rollup with dispute-wins tie-break, filtering self out). That projection's "filter self at the projection layer" idiom is the prior-art this leaf extends to a per-(entity, facet) shape; the participant's chip carries OTHER-voter dots only (Decision §3 below), so the new per-(entity, facet) and per-proposal projections this leaf adds filter self at insertion time the same way `projectOtherVotes` does.
- Prose-only context (NOT a `.tji` edge): `!data_and_methodology.projection.per_facet_status_derivation` + ADR 0030 (settled — per-facet keying + sequential capture). The vote projections this leaf ports walk the same per-(entity, facet) and per-proposal-id buckets the moderator's selectors walk; no wire change, no projector change.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_proposal_expand` (settled — the expanded body region is the reachable mount point for the indicator row via the predecessor `part_per_facet_breakdown_in_pane`'s chip strip).

## What this task is

Thread per-(entity, facet) per-other-voter dots into each per-facet chip the predecessor's `<PerProposalFacetBreakdown>` renders. After this leaf, a debater scanning the proposals tab sees on each chip:

- **The chip itself** — per-facet status (the predecessor's contract: `data-facet-name` + `data-facet-status` + the `PILL_STATUS_CLASSNAME` color branch).
- **An inline row of dots inside the chip** — one `<VoteIndicator>` per OTHER participant who has voted on that (entity, facet) pair (or on the proposal envelope, for structural sub-kinds). Each dot's outer ring is the per-participant deterministic color from `axiomMarkColorFor(participantId)`; inner fill is `bg-emerald-500` for agree, `bg-rose-500` for dispute. Empty-row omission when no other voters have arrived yet (the chip renders the bare label).

Concretely:

- A new pure projection lands at [`apps/participant/src/proposals/otherVotesByFacet.ts`](../../../apps/participant/src/proposals/otherVotesByFacet.ts) exporting `projectOtherVotesByFacet(events, currentParticipantId): OtherVotesByFacetIndex` where `OtherVotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>`. Ported from the moderator's [`apps/moderator/src/graph/selectors.ts:739`](../../../apps/moderator/src/graph/selectors.ts#L739) `projectVotesByFacet` with the participant idiom of filtering `vote.payload.participant === currentParticipantId` out at insertion time (Decision §2 — port-and-filter, mirroring the existing `projectOtherVotes` idiom from `part_other_vote_indicators`).
- A new pure projection lands at [`apps/participant/src/proposals/otherVotesByProposal.ts`](../../../apps/participant/src/proposals/otherVotesByProposal.ts) exporting `projectOtherVotesByProposal(events, currentParticipantId): OtherVotesByProposalIndex` where `OtherVotesByProposalIndex = ReadonlyMap<string, readonly Vote[]>`. Ported from the moderator's [`apps/moderator/src/graph/selectors.ts:877`](../../../apps/moderator/src/graph/selectors.ts#L877) `projectVotesByProposal`, same self-filter at insertion.
- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) grows three new optional parameters on `derivePerProposalFacets` — `votesByFacetIndex`, `proposalEventId`, `votesByProposalIndex` — and `ProposalFacetEntry` grows a `readonly votes: readonly Vote[]` field. The signature matches the moderator's selector verbatim modulo the absent `Vote[]` shape difference (none — `Vote` is shell-exported and identical). The defaults preserve the predecessor's no-votes posture (`EMPTY_VOTES_BY_FACET_INDEX` + `EMPTY_VOTES_BY_PROPOSAL_INDEX` module-scope frozen empties; `proposalEventId === undefined` collapses to no structural lookup).
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) renders a nested `<span data-testid="participant-pending-proposal-row-facet-vote-indicator-row">` inside each chip whose `entry.votes.length > 0`. Each `Vote` maps to one `<VoteIndicator participantId={...} choice={...} />` from `@a-conversa/shell`. The chip span's outer testid + ARIA contract from the predecessor is byte-stable; the indicator row mounts AFTER the label text inside the chip (same JSX shape as the moderator at [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:174-185`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx#L174)).
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) grows two new `useMemo` calls computing `votesByFacetIndex` + `votesByProposalIndex` (each keyed on `[events, currentParticipantId]`) and threads both into each `<PendingProposalRow>`. The pane gains a new required prop `currentParticipantId: string`; the row's prop surface grows by the same two indices + the proposal id (already on `row.proposalEventId`).
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) passes `currentParticipantId={currentParticipantId}` to `<PendingProposalsPane>` (it already threads the same value into `<GraphView>` + `<EntityDetailPanel>`; one new prop in one call site).
- The participant's Vitest suites grow: two new selector test files (`otherVotesByFacet.test.ts` + `otherVotesByProposal.test.ts`) pinning the self-filter + arm-overwrite position-stable semantics + the discriminated-union target arms; three new cases appended to [`perProposalFacets.test.ts`](../../../apps/participant/src/proposals/perProposalFacets.test.ts) covering the new `votes` field shape for facet-targeting + structural sub-kinds; three new cases appended to [`PerProposalFacetBreakdown.test.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx) covering the in-chip indicator row + empty-row omission + per-voter `data-participant-id` + `data-choice` wiring; two new cases appended to [`PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) pinning the pane's index threading + the self-filter at the pane integration layer.
- The Playwright spec [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) gains a step 8 appended after the predecessor's step 7 chip-strip assertion: with the row expanded and the chip visible, seed one `vote` event from a SECOND participant (not the test participant) on the seeded `capture-node` proposal's `wording` facet, poll for the indicator row to appear inside the chip, assert one `[data-vote-indicator][data-participant-id="<voter>"][data-choice="agree"]` dot. The test participant's own vote does NOT appear (self-filter).
- **No new i18n keys.** The `<VoteIndicator>` from the shell ships its own ICU template (`methodology.voteIndicator.label` + `methodology.voteIndicatorChoice.<arm>`) the moderator surface already pinned; the participant's chip dot consumes that template verbatim.
- **No new ADR.** Decision §8 enumerates why every architectural choice applies an existing ADR (0010, 0024, 0026, 0027, 0030) or repeats an idiom an established refinement settled.

Out of scope (deferred to sibling or future leaves):

- **Not the per-(entity, facet) per-other-voter breakdown inside the entity-detail panel on the graph tab.** Sibling `part_entity_detail_panel_per_facet_other_voter_breakdown` (READY, separate refinement) owns that surface; the proposals tab + the graph tab are mutually exclusive per `part_proposals_tab` Decision §4, so the two leaves never render simultaneously and there's no shared component. The two surfaces' render shapes diverge (per-facet table inside the entity panel vs. per-facet chip row inside the pane). Predecessor's Decision §3 already documented the structural separation; this leaf inherits that posture.
- **Not the participant's OWN vote inside the chip.** Decision §3 explains the choice — for v1, the chip shows OTHER voters only (matching the canvas's "own = label-outline, others = dots" decomposition established by `part_own_vote_indicators` + `part_other_vote_indicators`). The participant's own vote is implicitly part of the per-facet status rollup the chip already encodes; surfacing it again as a self-dot would compete visually with the per-facet status without adding signal. A future leaf MAY add a dedicated "your vote" indicator in the chip if user testing reveals the gap — Decision §3 names the trigger.
- **Not a canvas-side per-(entity, facet) dot extension.** The graph canvas already renders per-entity-rollup `<VoteIndicator>`s via the existing `OthersVoteIndex` (DOM-mirror only in v0; canvas dots deferred to `part_other_vote_indicators_canvas_dots`). This leaf is scoped to the in-chip surface inside the proposals tab.
- **Not the shell extraction of proposal projection logic.** This leaf raises the participant-side duplicated proposal-projection helper count from three (`derivePendingProposals`, `summaryText`, `derivePerProposalFacets`) to FIVE (`projectOtherVotesByFacet` + `projectOtherVotesByProposal` added). The audience surface remains the third-application trigger for `shell.shell_proposal_projection_extraction` per the predecessor's Decision §9. This leaf raises visibility but does NOT register the extraction leaf — same reasoning as the predecessor (the third-application trigger has not arrived).
- **Not animation / transition on dot arrival.** Dots mount instantly on the next render pass when a new `vote` event lands; no fade-in, no count-up. The moderator pane's surface follows the same posture per `mod_vote_indicators_in_sidebar` Decision §6.
- **Not focus management on indicator interaction.** The `<VoteIndicator>` is a `<span role="img">` (non-interactive); no keyboard focus change. The predecessor's "focus stays on the header button" posture is preserved.
- **Not a Cucumber scenario.** The per-(entity, facet) vote bucket is already pinned at the protocol boundary by the upstream `ws_vote_message` scenarios + the per-facet-status derivation scenarios. This leaf is a pure client-side consumer of those already-pinned streams; Decision §7 covers the rationale.
- **Not new wire shape.** No `ProposalStatusPayload` extension, no new envelope type, no new projector field. The projection walks the existing event log.
- **Not new i18n keys** — see above.

## Why it needs to be done

`docs/participant-ui.md` lines 127-133 enumerate the per-facet visual states and call out that the per-facet state is the primary signal the participant needs to decide whether to keep voting. The predecessor chip strip shipped that signal at the per-facet status granularity (one chip per facet, status-colored). What the predecessor's chip strip does NOT yet surface is WHO has voted: the debater scanning the pane to decide what to vote on next benefits from seeing "Alice and Bob have already voted agree on `wording`; Carol disputed `substance`" at a glance — same scanning behavior the moderator gets from the moderator-pane's sidebar indicator row that landed in `mod_vote_indicators_in_sidebar`.

The downstream WBS chain depends on this leaf landing:

1. **`part_voting.*`** (P2 chain) hangs off the parent subgroup's `complete 100` state — this leaf is the LAST `part_pending_proposals.*` leaf, so its completion unlocks the parent's roll-up. The chip seam this leaf finalizes (chip span containing label + optional indicator row + per-voter `data-participant-id`/`data-choice` attributes) is what the in-pane vote-button leaves of `part_voting` will mount inside.
2. **Cross-surface visual coherence**: the moderator's chip + the participant's chip + the graph's `<FacetPill>` all use the shell-exported `<VoteIndicator>` with the same per-participant `axiomMarkColorFor` ring + the same per-choice fill. A debater glancing at the moderator's screen during a session debrief reads the same dot grammar on every surface — that's a methodology UX commitment the predecessor's Decision §4 (shell-exported `PILL_*_CLASSNAME`) established at the chip level; this leaf extends it to the indicator-row level.

Architecturally this leaf **finalizes the participant's proposals-tab chip vocabulary**: the chip carries its status (predecessor) AND its per-other-voter row (this leaf), byte-equivalent to the moderator's modulo the self-filter. After this leaf, the chip is feature-complete for v1; subsequent extensions (own-vote dedicated marker, animation, hover prose) are future work.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; per-(entity, facet) vote tracking is the methodology-pinned shape.
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L127-L133) — per-facet states + their visual treatment.
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L146-L155) — list view + tap to expand; this leaf augments the chip strip the body region hosts.
- [ADR 0010 — pnpm workspaces](../../../docs/adr/0010-pnpm-workspaces.md) — moderator + participant are sibling apps with no cross-app import; the moderator's projections are PORTED, not imported (Decision §2).
- [ADR 0021 — Event envelope discriminated union with zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the projection's `switch (event.kind)` + the `vote` payload's `target`-arm discriminator are both structurally validated at envelope-parse time.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the `<VoteIndicator>`'s ICU label keys (shell-exported) are reused verbatim; no new key.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — each surface owns its mounted tree; no cross-app component reach.
- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-(entity, facet) vote bucket lives on the facet layer; the chip displays facet-layer state.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the projection consumes the `target`-discriminated `vote` payload; the `'facet'` arm carries `(entity_id, facet)`; the `'proposal'` arm carries `proposal_id`. Both arms feed the chip's indicator row depending on the proposal's sub-kind (facet-targeting → `'facet'` arm via `votesByFacetIndex`; structural → `'proposal'` arm via `votesByProposalIndex`).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md`](part_per_facet_breakdown_in_pane.md) — the predecessor. Its Decision §6 explicitly reserves chip-internal extensibility for THIS leaf; the chip's outer testid + ARIA contract this leaf preserves byte-stable.
- [`tasks/refinements/participant-ui/part_other_vote_indicators.md`](part_other_vote_indicators.md) — establishes the participant's self-filter idiom at the projection layer (`projectOtherVotes(events, currentParticipantId)` filters `vote.participant === currentParticipantId` out at insertion). This leaf extends the same idiom to the new per-(entity, facet) and per-proposal projections.
- [`tasks/refinements/participant-ui/part_own_vote_indicators.md`](part_own_vote_indicators.md) — establishes the participant's "own = special channel; others = dots" decomposition on the canvas (`OwnVoteIndex` for label-outline; `OthersVoteIndex` for dot stream). This leaf extends the same decomposition to the pane: the chip's status (already includes own votes via the per-facet rollup) is the own channel; the dot row is the other-voter channel.
- [`tasks/refinements/moderator-ui/mod_vote_indicators_in_sidebar.md`](../moderator-ui/mod_vote_indicators_in_sidebar.md) — the moderator's analogous in-chip indicator row. This leaf ports the moderator's selector signature + the chip JSX shape; testids are participant-namespaced (Decision §5).
- [`tasks/refinements/participant-ui/part_proposal_expand.md`](part_proposal_expand.md) — the disclosure machinery underneath; preserved byte-stable.

### Live code the surface plugs into

- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — the predecessor's component. The indicator row mounts INSIDE each chip's `<span data-testid="participant-pending-proposal-row-facet">` as a sibling of the label text. The component's prop surface grows by `votesByFacetIndex` + `votesByProposalIndex` (both optional with `EMPTY_*` defaults to keep the no-votes posture available to test fixtures + future call sites).
- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) — the predecessor's selector. The signature grows three new optional parameters; `ProposalFacetEntry` grows a `readonly votes: readonly Vote[]` field; the per-sub-kind switch threads the votes lookup at the entry-construction step. The status-precedence logic is unchanged.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the pane. Two new `useMemo` calls compute the two indices; both are passed through to each `<PendingProposalRow>` which forwards them to `<PerProposalFacetBreakdown>`. The pane gains one new required prop `currentParticipantId: string` from the route; the row's signature grows by the two indices.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) — one new line: `<PendingProposalsPane sessionId={id} currentParticipantId={currentParticipantId} />`. The value is already in scope from `OperateRouteAuthenticatedBody`'s prop list.
- [`apps/moderator/src/graph/selectors.ts:739-831`](../../../apps/moderator/src/graph/selectors.ts#L739) — the moderator's `projectVotesByFacet`. This leaf ports its body verbatim into `apps/participant/src/proposals/otherVotesByFacet.ts`, with one new line at the per-vote insertion step skipping `participant === currentParticipantId`.
- [`apps/moderator/src/graph/selectors.ts:877-922`](../../../apps/moderator/src/graph/selectors.ts#L877) — the moderator's `projectVotesByProposal`. Same port + self-filter pattern.
- [`packages/shell/src/facet-pill/VoteIndicator.tsx`](../../../packages/shell/src/facet-pill/VoteIndicator.tsx) — the shell-exported component. Reused verbatim; this leaf imports `VoteIndicator` from `@a-conversa/shell`.
- [`packages/shell/src/facet-pill/vote-indicator.ts`](../../../packages/shell/src/facet-pill/vote-indicator.ts) — the shell-exported `Vote` + `EMPTY_VOTES` types/value. The participant projections + the selector + the component all import `Vote` from `@a-conversa/shell`.
- [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) — the established self-filter idiom at the projection layer (the new per-(entity, facet) projection mirrors this one's filter step verbatim).
- [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) — extended with two new cases.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — extended with step 8.

### Existing fixtures the Playwright spec composes with

- The existing scenario seeds a `capture-node` proposal at step 4 (per the predecessor's refinement). The proposal targets the `wording` facet on the new node. Step 8 (NEW) seeds an additional `vote` envelope from a second participant (a UUID distinct from the test participant), targeting the same `(entity, facet)` pair, choice `'agree'`. The dot appears inside the chip; the test asserts one `[data-vote-indicator]` with the expected `data-participant-id` + `data-choice`. The seeded second participant id is a fresh fixture-local constant; no new compose-stack change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/otherVotesByFacet.ts` — new. Per-(entity, facet) per-other-voter projection.
- `apps/participant/src/proposals/otherVotesByFacet.test.ts` — new. Vitest cases.
- `apps/participant/src/proposals/otherVotesByProposal.ts` — new. Per-proposal-id per-other-voter projection (for structural sub-kinds).
- `apps/participant/src/proposals/otherVotesByProposal.test.ts` — new. Vitest cases.
- `apps/participant/src/proposals/perProposalFacets.ts` — modified. `ProposalFacetEntry` grows `votes: readonly Vote[]`; `derivePerProposalFacets` grows three new optional params (`votesByFacetIndex`, `proposalEventId`, `votesByProposalIndex`); per-entry construction threads the votes lookup.
- `apps/participant/src/proposals/perProposalFacets.test.ts` — modified. Three new cases.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — modified. New props (`votesByFacetIndex`, `votesByProposalIndex`); chip span renders the indicator row when `entry.votes.length > 0`.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` — modified. Three new cases.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — modified. Two new `useMemo` calls; new required prop `currentParticipantId`; row signature grows by the two indices.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — modified. Two new cases.
- `apps/participant/src/proposals/index.ts` — modified. Barrel exports the two new projection functions + their index types for downstream sibling consumption (the future `part_voting.*` leaves).
- `apps/participant/src/routes/OperateRoute.tsx` — modified. Threads `currentParticipantId` into `<PendingProposalsPane>` (one prop on one call site).
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. Step 8 (NEW).

### Files this task does NOT touch

- `apps/participant/src/graph/otherVotes.ts` + its test — the canvas-side per-entity rollup is unchanged; this leaf adds a per-(entity, facet) projection alongside it (NOT widening the existing one — the canvas surface still uses per-entity rollup).
- `apps/participant/src/graph/ownVotes.ts` + its test — the own channel is unchanged; the chip shows others only (Decision §3).
- `apps/participant/src/graph/GraphView.tsx` + `apps/participant/src/graph/projectGraph.ts` — unchanged; the canvas-side wiring is untouched.
- `apps/participant/src/proposals/derivePendingProposals.ts` + its test — the row selector is unchanged.
- `apps/participant/src/proposals/proposalSummary.ts` + its test — unchanged.
- `apps/participant/src/proposals/usePendingProposalsCount.ts` + its test — unchanged.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + its test — unchanged.
- `apps/participant/src/stores/uiStore.ts` + `apps/participant/src/stores/stores.test.tsx` — unchanged.
- `apps/participant/src/ws/wsStore.ts` + its test — unchanged.
- `apps/participant/src/graph/facetStatus.ts` + its test — unchanged.
- `apps/participant/src/detail/*` — unchanged.
- `apps/moderator/src/` — unchanged.
- `packages/shell/` — no new shell exports; `VoteIndicator` + `Vote` + `EMPTY_VOTES` are already exported.
- `packages/shared-types/` — no wire change.
- `packages/i18n-catalogs/src/catalogs/*.json` — no new keys.
- `tasks/35-frontend-i18n.tji` — no native-review entry.
- `playwright.config.ts` — no project changes.
- `tasks/40-participant-ui.tji` — `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (Decision §8).

### Projection shape (`apps/participant/src/proposals/otherVotesByFacet.ts`)

Mirrors the moderator's `projectVotesByFacet` walk minus `currentParticipantId` insertion. Sketch:

```ts
import type { Event } from '@a-conversa/shared-types';
import { type Vote } from '@a-conversa/shell';

import type { FacetName } from '../graph/facetStatus';

export type OtherVotesByFacetIndex = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;

export const EMPTY_OTHER_VOTES_BY_FACET_INDEX: OtherVotesByFacetIndex = new Map();

/**
 * Pure projection from a session's event log to a per-(entityId, facet)
 * `Vote[]` index, filtered to OTHER participants only (the current
 * participant is omitted at insertion time). Single-pass over `events`.
 *
 * Position semantics: first vote from each (entityId, facet, participant)
 * pins position; subsequent arm-switches overwrite in place. Mirrors
 * `apps/moderator/src/graph/selectors.ts:739` `projectVotesByFacet`
 * verbatim except for the self-filter.
 *
 * Pure: no closure over time, no Date.now, no Math.random.
 */
export function projectOtherVotesByFacet(
  events: readonly Event[],
  currentParticipantId: string,
): OtherVotesByFacetIndex {
  // … per-sub-kind switch + per-arm vote insertion + self-skip …
}
```

- **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.
- **Self-filter at insertion**: `if (vote.payload.participant === currentParticipantId) continue;` between target-resolution and accumulator-write, mirroring `projectOtherVotes`'s filter idiom.
- **`Vote` from `@a-conversa/shell`**: not a local type; uses the shell-exported shape (`{ participantId: string; choice: 'agree' | 'dispute' }`) so the chip's `<VoteIndicator>` consumes it without an adapter.
- **Discriminated-union dispatch on `vote.payload.target`**: the `'facet'` arm reads `entity_id` + `facet` directly; the `'proposal'` arm looks up the proposal id in the local `proposalTarget` map (built from earlier `proposal` events). Same shape as the moderator's selector.
- **`EMPTY_OTHER_VOTES_BY_FACET_INDEX`**: module-scope frozen empty map for stable reference equality + default-parameter use in tests / earlier render paths.

### Projection shape (`apps/participant/src/proposals/otherVotesByProposal.ts`)

Mirrors the moderator's `projectVotesByProposal`. Sketch:

```ts
import type { Event } from '@a-conversa/shared-types';
import { type Vote } from '@a-conversa/shell';

export type OtherVotesByProposalIndex = ReadonlyMap<string, readonly Vote[]>;

export const EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX: OtherVotesByProposalIndex = new Map();

export function projectOtherVotesByProposal(
  events: readonly Event[],
  currentParticipantId: string,
): OtherVotesByProposalIndex {
  // … known-proposals set + per-proposal-id vote accumulator +
  //   self-skip + arm-switch overwrite in place …
}
```

Same purity rules; same self-filter; same arm-switch overwrite semantics.

### Selector extension (`apps/participant/src/proposals/perProposalFacets.ts`)

Diff sketch:

```ts
+ import { EMPTY_VOTES, type Vote } from '@a-conversa/shell';
+
+ import type { OtherVotesByFacetIndex } from './otherVotesByFacet';
+ import { EMPTY_OTHER_VOTES_BY_FACET_INDEX } from './otherVotesByFacet';
+ import type { OtherVotesByProposalIndex } from './otherVotesByProposal';
+ import { EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX } from './otherVotesByProposal';

  export interface ProposalFacetEntry {
    readonly facet: LifecycleFacetName;
    readonly status: FacetStatus;
    readonly labelKey: string;
+   readonly votes: readonly Vote[];
  }

  export function derivePerProposalFacets(
    proposal: ProposalPayload,
    facetStatusIndex: FacetStatusIndex,
    serverPerFacetStatus: Record<string, string> | undefined,
+   votesByFacetIndex: OtherVotesByFacetIndex = EMPTY_OTHER_VOTES_BY_FACET_INDEX,
+   proposalEventId: string | undefined = undefined,
+   votesByProposalIndex: OtherVotesByProposalIndex = EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
  ): readonly ProposalFacetEntry[] {
    const target = facetTargetOf(proposal);
    if (target) {
      const status = resolveStatus(target.facet, target, facetStatusIndex, serverPerFacetStatus);
+     const votes = votesByFacetIndex.get(target.entityId)?.get(target.facet) ?? EMPTY_VOTES;
-     return [{ facet: target.facet, status, labelKey: labelKeyFor(target.facet) }];
+     return [{ facet: target.facet, status, labelKey: labelKeyFor(target.facet), votes }];
    }
    const status = resolveStatus('proposal', null, facetStatusIndex, serverPerFacetStatus);
+   const votes =
+     proposalEventId !== undefined
+       ? (votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES)
+       : EMPTY_VOTES;
-   return [{ facet: 'proposal', status, labelKey: labelKeyFor('proposal') }];
+   return [{ facet: 'proposal', status, labelKey: labelKeyFor('proposal'), votes }];
  }
```

- The three new parameters are **optional** with `EMPTY_*` defaults — existing test fixtures + call sites that haven't yet been updated continue compiling. The pane's call site IS updated to pass all three (Decision §4).
- The selector now imports `Vote` + `EMPTY_VOTES` from `@a-conversa/shell` (same as the moderator's selector).
- Structural sub-kinds get their indicators from `votesByProposalIndex.get(proposalEventId)`; facet-targeting sub-kinds from `votesByFacetIndex.get(entityId)?.get(facet)`. Same dispatch shape as the moderator.

### Component extension (`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`)

Diff sketch:

```tsx
+ import { VoteIndicator, type Vote } from '@a-conversa/shell';
+
+ import { EMPTY_OTHER_VOTES_BY_FACET_INDEX, type OtherVotesByFacetIndex } from './otherVotesByFacet';
+ import { EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX, type OtherVotesByProposalIndex } from './otherVotesByProposal';

  export interface PerProposalFacetBreakdownProps {
    readonly proposal: ProposalPayload;
    readonly facetStatusIndex: FacetStatusIndex;
    readonly serverPerFacetStatus: Record<string, string> | undefined;
    readonly proposalEventId: string;
+   readonly votesByFacetIndex?: OtherVotesByFacetIndex;
+   readonly votesByProposalIndex?: OtherVotesByProposalIndex;
  }

  // … inside the render body …

  const entries = useMemo(
-   () => derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus),
-   [proposal, facetStatusIndex, serverPerFacetStatus],
+   () =>
+     derivePerProposalFacets(
+       proposal,
+       facetStatusIndex,
+       serverPerFacetStatus,
+       votesByFacetIndex ?? EMPTY_OTHER_VOTES_BY_FACET_INDEX,
+       proposalEventId,
+       votesByProposalIndex ?? EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX,
+     ),
+   [
+     proposal,
+     facetStatusIndex,
+     serverPerFacetStatus,
+     votesByFacetIndex,
+     proposalEventId,
+     votesByProposalIndex,
+   ],
  );

  // … and per-chip render …
+ const voteIndicatorRow =
+   entry.votes.length > 0 ? (
+     <span
+       data-testid="participant-pending-proposal-row-facet-vote-indicator-row"
+       className="ml-1 inline-flex items-center gap-0.5"
+     >
+       {entry.votes.map((vote) => (
+         <VoteIndicator
+           key={vote.participantId}
+           participantId={vote.participantId}
+           choice={vote.choice}
+         />
+       ))}
+     </span>
+   ) : null;
  return (
    <span
      key={entry.facet}
      data-testid="participant-pending-proposal-row-facet"
      data-facet-name={entry.facet}
      data-facet-status={entry.status}
      className={className}
      aria-label={`${facetLabel} ${statusLabel}`}
    >
      {facetLabel}
+     {voteIndicatorRow}
    </span>
  );
```

- The new row testid is `participant-pending-proposal-row-facet-vote-indicator-row` — participant-namespaced to disambiguate from the moderator's `proposal-facet-vote-indicator-row` and from the graph's `data-vote-indicator-row`. The inner `<VoteIndicator>` children carry the cross-surface `data-vote-indicator` sentinel + per-voter attributes — those are stable across all surfaces (shell-exported).
- Empty-row omission: `entry.votes.length > 0 ? <span> … </span> : null`. Same shape as the moderator's at `apps/moderator/src/layout/ProposalFacetBreakdown.tsx:159-173`.
- The indicator row is INSIDE the chip span (sibling of the label text), NOT a sibling of the chip span. This keeps the chip's outer flex-wrap rules unaffected and matches the moderator's JSX shape.

### Pane plumbing (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Diff sketch:

```tsx
+ import { projectOtherVotesByFacet } from './otherVotesByFacet';
+ import { projectOtherVotesByProposal } from './otherVotesByProposal';

  export interface PendingProposalsPaneProps {
    readonly sessionId: string;
+   readonly currentParticipantId: string;
    readonly nowMsOverride?: number;
  }

  export function PendingProposalsPane({
    sessionId,
+   currentParticipantId,
    nowMsOverride,
  }: PendingProposalsPaneProps): ReactElement {
    // …
    const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
    // …
    const facetStatusIndex = useMemo(() => computeFacetStatuses(events), [events]);
+   const votesByFacetIndex = useMemo(
+     () => projectOtherVotesByFacet(events, currentParticipantId),
+     [events, currentParticipantId],
+   );
+   const votesByProposalIndex = useMemo(
+     () => projectOtherVotesByProposal(events, currentParticipantId),
+     [events, currentParticipantId],
+   );
    // …
    {rows.map((row) => (
      <PendingProposalRow
        key={row.proposalEventId}
        row={row}
        nowMs={nowMs}
        systemAuthorLabel={systemAuthorLabel}
        facetStatusIndex={facetStatusIndex}
        serverPerFacetStatus={pendingProposals[row.proposalEventId]?.perFacetStatus}
+       votesByFacetIndex={votesByFacetIndex}
+       votesByProposalIndex={votesByProposalIndex}
      />
    ))}
```

- Both projections are memoized on `[events, currentParticipantId]` — they re-walk only when a new event lands or the participant identity changes (the latter never changes mid-session in practice but the dependency is correct).
- The row component's prop signature grows by the two indices; both are forwarded into `<PerProposalFacetBreakdown>`.

### Route plumbing (`apps/participant/src/routes/OperateRoute.tsx`)

```tsx
- <PendingProposalsPane sessionId={id} />
+ <PendingProposalsPane sessionId={id} currentParticipantId={currentParticipantId} />
```

One prop on one call site. `currentParticipantId` is already in scope from `OperateRouteAuthenticatedBody`'s parameter at [`apps/participant/src/routes/OperateRoute.tsx:197-200`](../../../apps/participant/src/routes/OperateRoute.tsx#L197).

### What the new code MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects** inside `<PerProposalFacetBreakdown>` or either projection.
- **No `useWsStore.setState` writes.** The chip + the projections are consumer-only.
- **No new store slices.** Zero `useUiStore` reads inside the chip / projections.
- **No reaching into `@a-conversa/shell` for proposal projection logic.** The shell does not export proposal projection helpers; the projections are PORTED into the participant tree (Decision §2).
- **No cross-app import.** `import … from '../../moderator/...'` is forbidden by ADR 0010 — the moderator's `projectVotesByFacet` + `projectVotesByProposal` are PORTED (re-defined in the participant tree), not imported.
- **No widening of the canvas-side `projectOtherVotes(events, currentParticipantId)`** to a per-facet shape. The canvas's per-entity rollup stays as-is; this leaf adds a SEPARATE per-(entity, facet) projection. Decision §6 enumerates why.
- **No filter inside the chip.** The self-filter lives in the projection (`projectOtherVotesByFacet` / `projectOtherVotesByProposal`); the chip renders whatever votes the entry's `votes` array contains. Same idiom as `projectOtherVotes` at the canvas layer.
- **No new ADR.** Decision §8.

### Test layers per ADR 0022

Six pins, each anchoring a different observable property:

1. **Vitest `otherVotesByFacet.test.ts` (new)** — projection. Eight cases mirroring the moderator's `projectVotesByFacet` test scenarios + the self-filter:
   - (a) Empty event log → empty `Map`.
   - (b) One `proposal` + one matching `vote` (facet-arm) from a non-self participant → one entry at `Map.get(entityId).get(facet)` with the voter's `{ participantId, choice }`.
   - (c) Self vote on the same proposal → projection emits NO entry for self (filter pins).
   - (d) Same participant switches arm (`agree` → `dispute` → `agree`) → final entry reflects last choice; position is stable (length === 1 in the array, same array index for first + final).
   - (e) Two participants on the same facet → both appear in arrival order (first vote pins position).
   - (f) Vote arrives BEFORE its referenced proposal → silently dropped (`projectVotesByFacet` shape).
   - (g) Proposal-arm vote on a facet-targeting proposal → resolves via `proposalTarget` lookup to `(entityId, facet)` and inserts.
   - (h) Vote on an unknown proposal id (proposal-arm) → silently dropped.
   - (i) Edge-facet vote (`set-edge-substance`) → inserts under the edge id's `Map.get(edgeId).get('substance')`.

2. **Vitest `otherVotesByProposal.test.ts` (new)** — projection. Five cases:
   - (a) Empty log → empty `Map`.
   - (b) Structural proposal + non-self vote (proposal-arm) → one entry at `Map.get(proposalId)` with the voter.
   - (c) Self vote on the same structural proposal → projection emits NO entry for self.
   - (d) Facet-arm vote → silently ignored (this projection is proposal-arm only).
   - (e) Arm-switch by same participant → last-write-wins, position stable.

3. **Vitest `perProposalFacets.test.ts` (extended)** — three new cases:
   - (g) Facet-targeting sub-kind (`capture-node`) with two votes in `votesByFacetIndex` for the (entity, 'wording') key → `entries[0].votes` has length 2 with both voters' `{ participantId, choice }` (arrival order preserved). The existing six predecessor cases re-anchor by adding `votes: EMPTY_VOTES` to their expected output (one-line change per case).
   - (h) Structural sub-kind (`decompose`) with two votes in `votesByProposalIndex` for the `proposalEventId` → `entries[0].votes` has length 2; `entries[0].facet === 'proposal'`.
   - (i) `proposalEventId === undefined` AND structural sub-kind → `entries[0].votes === EMPTY_VOTES` (default-param path).

4. **Vitest `PerProposalFacetBreakdown.test.tsx` (extended)** — three new cases:
   - (f) When a facet-targeting proposal's entry carries two votes (passed via `votesByFacetIndex`), the chip renders one `[data-testid="participant-pending-proposal-row-facet-vote-indicator-row"]` containing two `[data-vote-indicator]` elements, each with the expected `data-participant-id` + `data-choice` (`'agree'` / `'dispute'`).
   - (g) When `entry.votes.length === 0`, the indicator row is OMITTED — the chip renders only the label text, no `*-vote-indicator-row` testid in the DOM.
   - (h) Structural sub-kind (`decompose`) with one vote in `votesByProposalIndex` for the passed `proposalEventId` → indicator row mounts inside the synthetic `'proposal'` chip with one dot.

5. **Vitest `PendingProposalsPane.test.tsx` (extended)** — two new cases appended after the predecessor's (q):
   - (r) Pane receives `currentParticipantId={ME}`; seed two votes on the seeded proposal's `wording` facet (one from ME, one from OTHER); expand the row; assert exactly one `[data-vote-indicator]` inside the chip, with `data-participant-id="<OTHER>"` (self filtered out at the projection layer; the pane's threading + the projection's filter both contribute to this property).
   - (s) Pane receives a structural-sub-kind seeded proposal (`decompose`); seed a proposal-arm vote from OTHER; expand the row; assert one indicator inside the synthetic `'proposal'` chip.

6. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — append step 8 after the predecessor's step 7:
   - Seed one `vote` envelope from a second participant (UUID distinct from the test participant) targeting the seeded `capture-node` proposal's `wording` facet, choice `'agree'`.
   - With the row already expanded, poll for the indicator row inside the chip (`participant-pending-proposal-row-facet[data-facet-name="wording"]` → its `participant-pending-proposal-row-facet-vote-indicator-row` child).
   - Assert one `[data-vote-indicator][data-participant-id="<seeded-uuid>"][data-choice="agree"]` dot is visible.
   - `expect.poll` budget matches the predecessor's pattern.

7. **No new Cucumber scenario** (Decision §7). Pure client-side derivation off already-pinned WS streams.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright extension is the default.** The chip is reachable via the predecessor's expand path; the indicator row is a chip-internal extension. Extending the existing scenario with one step that seeds a non-self vote + asserts the dot is the right anchor — no new scenario file, no compose-stack change, no e2e deferral.

The chip already mounts in a reachable surface (step 7 of `participant-pending-proposals.spec.ts` already asserts the chip strip after expansion), so even a "no votes yet" state of this leaf would be reachable. Full deferral is NOT justified.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, NO projector output. The two new projections walk the existing event log via the existing `vote` event shape (ADR 0030 §2 + §9 — the discriminated-union `target` arms are already settled and pinned by upstream Cucumber). Decision §7 enumerates why no new Cucumber scenario is warranted.

### Budget honesty (0.5d)

- ~30 min: port `projectVotesByFacet` from the moderator → `apps/participant/src/proposals/otherVotesByFacet.ts`; add the self-filter line; sanity-check the discriminated-union arm dispatch.
- ~20 min: port `projectVotesByProposal` → `otherVotesByProposal.ts`; same self-filter.
- ~15 min: extend `derivePerProposalFacets` signature + `ProposalFacetEntry` shape; add the per-entry votes lookup at the two construction points (facet-targeting + structural).
- ~15 min: extend `<PerProposalFacetBreakdown>` — new optional props, the in-chip indicator-row JSX, the empty-row omission.
- ~20 min: edit `<PendingProposalsPane>` — new prop, two new `useMemo` calls, row props plumbing.
- ~5 min: edit `OperateRoute.tsx` — one new prop on one call site.
- ~30 min: write `otherVotesByFacet.test.ts` (9 cases).
- ~20 min: write `otherVotesByProposal.test.ts` (5 cases).
- ~20 min: extend `perProposalFacets.test.ts` (3 new cases + 6 one-line predecessor re-anchors).
- ~25 min: extend `PerProposalFacetBreakdown.test.tsx` (3 new cases + minor predecessor re-anchors).
- ~20 min: extend `PendingProposalsPane.test.tsx` (2 new cases + minor predecessor re-anchors for `currentParticipantId` prop wiring).
- ~20 min: extend `participant-pending-proposals.spec.ts` (step 8 — seed non-self vote + assert the dot).
- ~15 min: visual sanity at the participant's landscape viewports — chip layout with the dot row, wrap behavior, the dot ring colors look right next to the chip status color.
- ~30 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + WBS-status ritual.
- ~15 min: buffer for Tailwind / aria fixups after visual sanity.

Risk surface is modest. The main hazard is the `EMPTY_OTHER_VOTES_*` reference-stability dance — both `EMPTY_*` indices must be module-scope frozen empties so pane re-renders on empty sessions don't churn the chip's `useMemo`. Same pattern the predecessor used for `EMPTY_PENDING_PROPOSALS` and `EMPTY_EVENTS`. The second hazard is the discriminated-union arm dispatch: the projection must handle BOTH `target === 'facet'` and `target === 'proposal'` arms; the test cases (b) + (g) of `otherVotesByFacet.test.ts` cover both.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the two new projections, the extended selector, the extended component, the extended pane, the extended route, and the extended e2e all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — library-mode build green; bundle shape unchanged.
4. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke` stays green; smoke count grows by +16** (9 from `otherVotesByFacet.test.ts` + 5 from `otherVotesByProposal.test.ts` + 3 from `perProposalFacets.test.ts` extension + 3 from `PerProposalFacetBreakdown.test.tsx` extension + 2 from `PendingProposalsPane.test.tsx` extension; total may shift slightly if predecessor cases need re-anchoring but the new-case count is the target).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new keys.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. Step 8 seeds one non-self vote on the seeded proposal's `wording` facet and asserts one `[data-vote-indicator][data-participant-id="<seeded-uuid>"][data-choice="agree"]` is visible inside the chip's `participant-pending-proposal-row-facet-vote-indicator-row`. Predecessor steps 1-7 unchanged.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The two projections own no side effects** — `grep` for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|Date\.now\|Math\.random` inside `otherVotesByFacet.ts` + `otherVotesByProposal.ts` returns zero matches.
10. **Self-filter pin** — both `otherVotesByFacet.test.ts` case (c) and `otherVotesByProposal.test.ts` case (c) seed a self vote and assert the projection's output for that voter is absent. The pane integration test (r) re-pins the filter at the pane layer.
11. **Chip's outer testid + ARIA contract preserved** — `<span data-testid="participant-pending-proposal-row-facet">` still carries `data-facet-name` + `data-facet-status` + the `aria-label` from the predecessor; the indicator row mounts INSIDE the span as a sibling of the label text. `PerProposalFacetBreakdown.test.tsx` case (f) pins the structural relationship.
12. **`<VoteIndicator>` from the shell is consumed verbatim** — no participant-local re-implementation of the dot. The drift-guard comes for free: any future shell-side change to the dot propagates to the chip via the existing dependency.
13. **`currentParticipantId` is threaded from `OperateRoute` to `PendingProposalsPane`** — the new required prop appears at the single call site; the route's existing `auth.user.userId`-sourced value is reused.
14. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_vote_indicators_in_pane` task block per the task-completion ritual.
15. **Predecessor's assertions unchanged** — `PendingProposalsPane.test.tsx` cases (a)-(q) pass (minor re-anchor for the new `currentParticipantId` prop wiring); `PerProposalFacetBreakdown.test.tsx` cases (a)-(e) pass; `perProposalFacets.test.ts` cases (a)-(f) pass with the one-line `votes: EMPTY_VOTES` re-anchor; the Playwright steps 1-7 pass unchanged.

## Decisions

### 1. Render the indicator row inside the chip span; mirror the moderator's JSX shape verbatim

Three alternatives surveyed:

- **(A) Mount the indicator row INSIDE each chip span as a sibling of the label text, after the label** (chosen). Mirrors `apps/moderator/src/layout/ProposalFacetBreakdown.tsx:174-185` byte-for-byte modulo the testid namespace. Keeps the chip's outer flex-wrap rules unaffected (the wrap unit is the chip; the indicator row never causes mid-chip wraps because the row is `inline-flex` inside a `flex-wrap` chip group). Same scanning grammar across moderator + participant surfaces.
- **(B) Mount the indicator row as a SIBLING of the chip span, outside it, inside the breakdown container.** Rejected. Would change the wrap unit from "the chip" to "the chip + the dots, separately" — visually disconnects dots from their facet. Also breaks the moderator + participant scanning parity.
- **(C) Render the dots as a BELOW-CHIP row, vertically stacked.** Rejected. Increases body region height; chip strip is meant to be compact. Moderator surface chose the in-chip horizontal row; participant follows.

### 2. Port the moderator's `projectVotesByFacet` + `projectVotesByProposal`; do not extract to shell yet

Three alternatives surveyed:

- **(A) Port both moderator selectors into the participant tree under `apps/participant/src/proposals/`, filtering self at insertion** (chosen). Mirrors the predecessor's Decision §1 idiom (port-and-duplicate for two-consumer proposal projection helpers; audience is the third-application trigger for shell extraction). The participant-port adds a self-filter at the insertion line — same idiom `projectOtherVotes` (the existing per-entity rollup) uses. The drift cost is real but small: the per-arm dispatch + the position-stable arm-overwrite logic is settled by ADR 0030 §2 + §9; both selectors are ~50 LOC each.
- **(B) Cross-app import: `import { projectVotesByFacet } from '../../moderator/src/graph/selectors.js'`.** Rejected — ADR 0010 forbids cross-app imports.
- **(C) Extract both selectors to `@a-conversa/shell` now.** Rejected. The predecessor's Decision §9 already pinned `shell.shell_proposal_projection_extraction` as audience-surface triggered (the third application, not the third helper). This leaf raises the duplicated-helper count from three to five but stays inside the established two-app duplication idiom. The shape of the audience-surface's per-(entity, facet) consumer is not yet known — pre-extracting would freeze an interface the audience may need to renegotiate.

The "port + filter self at insertion" idiom matches `projectOtherVotes`'s existing pattern at [`apps/participant/src/graph/otherVotes.ts`](../../../apps/participant/src/graph/otherVotes.ts) — same one-line insertion-time filter; same `(events, currentParticipantId)` signature.

### 3. The chip shows OTHER voters only; the participant's own vote is not surfaced as a self-dot in v1

Three alternatives surveyed:

- **(A) Other voters only — self-filter at the projection layer** (chosen). Matches the orchestrator's hint ("the participant already knows their own vote state from the projection; the indicator likely also shows aggregate vote counts or other-voter presence per facet"). Matches the participant-canvas decomposition (own = label-outline / chip status; others = dot stream). The participant's own vote is implicitly part of the per-facet status rollup the chip's color already encodes — surfacing it again as a self-dot competes with the status color and adds no signal. The participant already knows what they voted (they cast it seconds ago).
- **(B) Show ALL voters in the chip (matching the moderator's surface verbatim)**. Rejected for v1. The moderator's surface has no "own vs other" decomposition — the moderator's own votes are not differentiated because the moderator doesn't VOTE in the same surface. For the participant, "own" is a distinct channel (`projectOwnVotes` exists for exactly this reason); using the dot row as the channel that surfaces OTHER voters lets the chip's status color carry the "everyone's votes including mine" rollup signal and the dot row carry the "who else has voted" signal — two channels for two questions.
- **(C) Show a dedicated "your vote" marker (e.g., a self-colored bar at the chip's left edge or a checkmark glyph)**. Rejected for v1 — adds a new visual primitive without a settled need. A future leaf MAY add this if user testing shows debaters lose track of their own per-facet vote state; the chip's outer testid + ARIA contract this leaf finalizes leaves room for such an extension as a sibling element inside the chip.

The orchestrator's "the indicator should reflect per-facet vote state (who voted which way on each facet) rather than a single aggregate" is honored — the dot row IS per-(entity, facet) and per-voter (not collapsed). The "rather than aggregate" guidance pushes against options like "show a count" (rejected implicitly — dots are the per-voter shape).

Future-leaf trigger: if a user-testing pass reveals debaters scan the chip's dot row looking for THEIR own vote (because they forgot they voted), file a `part_pending_proposals.part_own_vote_chip_marker` leaf (0.25d effort, depends on this leaf) to add a self-marker inside the chip. NOT registered now (speculative).

### 4. Threading shape: `currentParticipantId` flows route → pane; both indices computed in the pane

Three alternatives surveyed:

- **(A) Pass `currentParticipantId` as a prop on `<PendingProposalsPane>`; compute both indices in the pane via `useMemo`; forward into rows** (chosen). Matches the predecessor's `facetStatusIndex` + `pendingProposals` threading pattern verbatim. The route already has `currentParticipantId` in scope (it threads the same value into `<GraphView>` + `<EntityDetailPanel>`); the pane is the natural memoization site (one pane render, N row renders).
- **(B) Hoist both indices to `<OperateRouteAuthenticatedBody>` (matching `ownVoteIndex` + `othersVoteIndex` for the canvas surfaces).** Rejected — those canvas-side indices are USED on the canvas (via `projectGraph(events, …, ownVoteIndex, othersVoteIndex)`). The proposal-side indices are usable ONLY on the proposals tab; computing them on every route render even when the graph tab is foregrounded wastes a per-frame walk. The pane-local memoization sites only fire when the proposals tab is rendered (the pane mounts/unmounts on tab switch per `part_proposals_tab` Decision §4) — the projection cost is paid only when needed.
- **(C) Compute the indices INSIDE the row component (`useMemo` per row).** Rejected — would re-walk the event log N times per pane render (one per row), defeating the point of `useMemo`. The pane is the right level (one walk shared across all rows).

The pane-local approach also keeps the route's prop surface unchanged for `<GraphView>` + `<EntityDetailPanel>` (no new index threaded into them; those keep their existing `ownVoteIndex` + `othersVoteIndex` per-entity rollups).

### 5. Testid namespace: `participant-pending-proposal-row-facet-vote-indicator-row`

Two alternatives surveyed:

- **(A) Namespace under the existing chip testid** (chosen). The chip's testid is `participant-pending-proposal-row-facet`; the indicator row inside it is `participant-pending-proposal-row-facet-vote-indicator-row`. Mirrors the moderator's `proposal-facet-vote-indicator-row` naming scheme (chip testid + `-vote-indicator-row` suffix) with the participant-namespacing prefix. Lets Playwright selectors target one surface unambiguously (the moderator's row id starts with `proposal-facet-`; the participant's starts with `participant-pending-proposal-row-facet-`).
- **(B) Reuse the moderator's `proposal-facet-vote-indicator-row` testid verbatim.** Rejected. Playwright selectors that match `proposal-facet-vote-indicator-row` would conflict if a future test renders both surfaces simultaneously (e.g., a moderator + participant compose scenario). The participant-namespace was settled by the predecessor for the chip itself (`participant-pending-proposal-row-facet`); extending it to the inner row matches the established convention.

The inner `<VoteIndicator>` children carry the SHARED `data-vote-indicator` sentinel (without namespacing) — that's the cross-surface dot identity from the shell. So `[data-vote-indicator][data-participant-id="<uuid>"]` hits dots on ALL surfaces; the row-container namespacing targets the chip-strip surface specifically.

### 6. Add a new per-(entity, facet) projection; do NOT widen `projectOtherVotes`

Two alternatives surveyed:

- **(A) Add a separate `projectOtherVotesByFacet` projection alongside the existing `projectOtherVotes`** (chosen). The canvas-side per-entity rollup is still used by `<GraphView>` + `<EntityDetailPanel>` and shouldn't be churned by a chip-strip-driven shape extension. The two projections have different consumers + different return shapes (per-entity `OtherVote[]` rollup vs. per-(entity, facet) `Vote[]` bucket); they're cleaner as siblings than as one omnibus selector with a discriminator parameter.
- **(B) Widen `projectOtherVotes` to return both the per-entity rollup AND the per-(entity, facet) bucket** (single-pass over events). Rejected — would change the existing projection's return shape, requiring updates to every existing canvas-side consumer for no benefit (the per-(entity, facet) data is not used by the canvas). A single-pass cost is small; if a future profile shows the double-walk is a hotspot, the merge can land as a tech-debt leaf.

The cost of one extra `O(events)` walk per pane render is acceptable (the pane only mounts when the proposals tab is foregrounded, and `events` typically has hundreds of entries per session — sub-millisecond).

### 7. No Cucumber scenario for the indicator row render path

Two alternatives surveyed:

- **(A) Pin via Vitest (projections + selector + component + pane integration) + Playwright (end-to-end dot visibility under the compose stack)** (chosen). The chip's indicator row is purely client-side derivation off three already-pinned data sources: the event log (pinned by upstream Cucumber for each event kind), the `vote` payload's discriminated-union arms (pinned by `pf_facet_keyed_vote_payload`'s Cucumber + the `ws_vote_message` scenarios), and the `pendingProposals` map (pinned by `ws_proposal_status_broadcast`'s Cucumber). Adding a Cucumber scenario for the dot render path would re-assert behavior the upstream tests already pin.
- **(B) Add a Cucumber scenario** asserting "given a session with pending proposal P and a vote from participant V on P's facet F, when the participant expands the row, the chip's indicator row surfaces one dot for V." Rejected. Structurally a UI render contract, not a protocol-boundary contract; Playwright + Vitest is the right pin.

### 8. Tech-debt registration

Three follow-ups named crisply for the closer:

- **Watch the proposal-projection-helper duplication count.** This leaf raises the moderator+participant duplicated proposal-projection helper count from three (`derivePendingProposals`, `summaryText`, `derivePerProposalFacets`) to **five** (`projectOtherVotesByFacet` + `projectOtherVotesByProposal` added — though these are participant-specific ports with the self-filter, so they're not byte-equivalent to the moderator's, just structurally analogous). **Action for Closer**: do NOT register `shell.shell_proposal_projection_extraction` from this leaf — it remains the audience-surface trigger per the predecessor's standing posture. When the audience surface lands and its first proposal-consuming task reaches for these helpers, that task's closer registers the extraction leaf at effort ~2.0d (raised from the predecessor's ~1.5d estimate since the count is now 5).

- **Potential future leaf: `part_pending_proposals.part_own_vote_chip_marker` (0.25d).** Per Decision §3, if user-testing reveals debaters lose track of their own per-facet vote inside the chip, a future leaf can add a self-marker (a small bar, glyph, or distinct visual primitive) inside the chip. **NOT registered now** — speculative, no concrete user-testing signal yet. The chip's outer contract this leaf finalizes leaves room for the extension when needed.

- **Focus management re-evaluation defers to `part_voting.part_vote_button_per_facet`** per the predecessor's Decision §9 — when in-pane voting lands, the first vote button per chip may want focus management. NOT a new WBS leaf; the voting leaf is the home.

No new ADR. Every architectural choice above applies an existing ADR or repeats an idiom an established refinement settled:

- Port-and-duplicate idiom (Decision §2) — applies the predecessor's Decision §1 + `part_other_vote_indicators`'s self-filter idiom.
- Chip-internal extension (Decision §1) — applies the predecessor's Decision §6 + the moderator's `mod_vote_indicators_in_sidebar` JSX shape.
- Own-vs-other channel split (Decision §3) — applies the participant-canvas decomposition (`part_own_vote_indicators` + `part_other_vote_indicators`).
- Pane-local threading (Decision §4) — applies the predecessor's `facetStatusIndex` + `pendingProposals` pattern.
- Testid namespacing (Decision §5) — applies the predecessor's `participant-pending-proposal-row-facet` chip namespace.
- Per-(entity, facet) projection added separately (Decision §6) — applies the consumer-driven shaping principle (don't reshape a settled projection for one new consumer).
- Cucumber scope (Decision §7) — restates the established "Cucumber for protocol-boundary; Vitest + Playwright for pure client" rule.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-26.

- New pure projection `projectOtherVotesByFacet` at `apps/participant/src/proposals/otherVotesByFacet.ts` — per-(entityId, facet) other-voter index with self-filter at insertion time; mirrored from moderator's `projectVotesByFacet`.
- New pure projection `projectOtherVotesByProposal` at `apps/participant/src/proposals/otherVotesByProposal.ts` — per-proposal-id other-voter index for structural sub-kinds; mirrored from moderator's `projectVotesByProposal`.
- Extended `derivePerProposalFacets` in `apps/participant/src/proposals/perProposalFacets.ts` — three new optional params (`votesByFacetIndex`, `proposalEventId`, `votesByProposalIndex`); `ProposalFacetEntry` gains `readonly votes: readonly Vote[]`.
- Extended `<PerProposalFacetBreakdown>` in `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — new optional props; chip renders `<span data-testid="participant-pending-proposal-row-facet-vote-indicator-row">` with one `<VoteIndicator>` per non-self voter when `entry.votes.length > 0`.
- Extended `<PendingProposalsPane>` in `apps/participant/src/proposals/PendingProposalsPane.tsx` — new required prop `currentParticipantId`; two new `useMemo` calls computing both indices; forwarded into each row.
- Route updated at `apps/participant/src/routes/OperateRoute.tsx` — passes `currentParticipantId={currentParticipantId}` to `<PendingProposalsPane>`.
- Barrel updated at `apps/participant/src/proposals/index.ts` — exports both new projections and their index types.
- Vitest: 9 new cases in `otherVotesByFacet.test.ts`, 5 new cases in `otherVotesByProposal.test.ts`, 3 new cases in `perProposalFacets.test.ts`, 3 new cases in `PerProposalFacetBreakdown.test.tsx`, 2 new cases in `PendingProposalsPane.test.tsx`.
- Playwright: step 8 appended to `tests/e2e/participant-pending-proposals.spec.ts` — seeds a non-self vote on the seeded proposal's `wording` facet and asserts one `[data-vote-indicator]` dot with the expected `data-participant-id` and `data-choice`.
- Build fix in `package.json`: `--workspace-concurrency=1` added to the `build` script to prevent a race condition where parallel `tsc -b` processes wrote to `packages/i18n-catalogs/dist/` simultaneously.
