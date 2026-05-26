# Per-facet breakdown inside the expanded pending-proposal row

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_pending_proposals.part_per_facet_breakdown_in_pane`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_pending_proposals.part_proposal_expand` (settled — commit `7d3d765` shipped tap-to-expand. The pane now mounts a `<div data-testid="participant-pending-proposal-row-body" role="region" aria-label={...}>` sibling inside each `<li>` exactly when `useUiStore.expandedProposalId === row.proposalEventId`. The v1 body content is one `<p data-testid="participant-pending-proposal-row-body-summary" className="whitespace-pre-wrap break-words">{summary}</p>` — see [`apps/participant/src/proposals/PendingProposalsPane.tsx:228-240`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L228). The predecessor's Decision §3 specifically reserved that body slot for this leaf to augment: "When `part_per_facet_breakdown_in_pane` lands, that leaf's content sits inside the same body container (the sibling can either replace the `<p>` or render alongside it — that leaf's refinement decides)."
- Prose-only context (NOT a `.tji` edge): `!moderator_ui.mod_pending_proposals_pane.mod_per_facet_breakdown` (settled — 2026-05-16, commit chain landed `apps/moderator/src/graph/proposalFacets.ts` + `apps/moderator/src/layout/ProposalFacetBreakdown.tsx`). The moderator's pure selector `derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus, votesByFacetIndex?, proposalEventId?, votesByProposalIndex?): readonly ProposalFacetEntry[]` plus the matching `<ProposalFacetBreakdown>` chip component already encode every decision this leaf needs: the per-sub-kind facet map (the four facet-targeting sub-kinds + seven structural sub-kinds → synthetic `'proposal'` lifecycle entry), the status precedence (server frame → client mirror → default `'proposed'`), the chip vocabulary (`<FacetPill>`-mirrored Tailwind branches), the i18n contract (`methodology.facet.<facet>` + `methodology.facetState.<status>` + `methodology.facet.proposal` + the two closed-lifecycle keys `committed` / `withdrawn`). This leaf ports the selector + the component into the participant surface; Decision §1 below explains why "port, don't yet extract".
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_pending_proposals.part_proposal_list_view` (settled). Its Decision §1 (duplicate the moderator's projection helpers under `apps/participant/src/proposals/` rather than extract to shell) is the prior-art idiom this leaf follows for `derivePerProposalFacets`. The moderator + participant pair carries two duplicated proposal-projection helpers today (`derivePendingProposals`, `summaryText`); this leaf raises the count to three. The audience surface is still the extraction trigger (Decision §1 / §9 below).
- Prose-only context (NOT a `.tji` edge): `!data_and_methodology.projection.per_facet_status_derivation` + `!backend.websocket_protocol.ws_proposal_status_broadcast` (settled — both supply the per-`FacetName` status the participant already mirrors locally via [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) and consumes from the wire via the per-session `pendingProposals` map [`apps/participant/src/ws/wsStore.ts:84`](../../../apps/participant/src/ws/wsStore.ts#L84) + the `applyProposalStatus` writer at [`apps/participant/src/ws/wsStore.ts:155-168`](../../../apps/participant/src/ws/wsStore.ts#L155). No backend / projector / WS changes in this leaf.

## What this task is

Render the per-facet status breakdown of a pending proposal inside the existing expanded-row body slot the predecessor (`part_proposal_expand`) reserved. The body slot's full untruncated `<p>` summary is replaced (Decision §2) by a small per-facet chip strip — one chip per facet the proposal exposes, each carrying the per-facet status visual the participant already sees on the graph via `<FacetPill>`. After this leaf:

- A new pure selector module lands at `apps/participant/src/proposals/perProposalFacets.ts` exporting `derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus): readonly ProposalFacetEntry[]`. Same shape and same per-sub-kind facet map as the moderator's [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts) (Decision §1 — port, don't yet extract). The participant variant omits the optional `votesByFacetIndex` / `proposalEventId` / `votesByProposalIndex` parameters the moderator's selector accepts — per-participant vote indicators are out of scope for this leaf (sibling `part_vote_indicators_in_pane` is the home; Decision §6).
- A new presentational component lands at `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` exporting `<PerProposalFacetBreakdown proposal={...} facetStatusIndex={...} serverPerFacetStatus={...} proposalEventId={...} />`. Renders `<div data-testid="participant-pending-proposal-row-facets" data-proposal-id="<id>">` containing one `<span data-testid="participant-pending-proposal-row-facet" data-facet-name="<facet>" data-facet-status="<status>">` per facet. Chip styling reuses the shell-exported `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` from [`@a-conversa/shell`](../../../packages/shell/src/) (the moderator's `<ProposalFacetBreakdown>` does the same; the Status block of [`mod_per_facet_breakdown.md`](../moderator-ui/mod_per_facet_breakdown.md) records that those constants were widened to named exports for cross-app consumption).
- `<PendingProposalRow>` in [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) replaces the v1 `<p data-testid="participant-pending-proposal-row-body-summary">{summary}</p>` body content with the new `<PerProposalFacetBreakdown>` mount (Decision §2). The body region's outer `<div data-testid="participant-pending-proposal-row-body">` + ARIA contract from the predecessor is untouched; the swap is on the body's inner content only.
- `<PendingProposalsPane>` grows a second `useWsStore` selector reading `state.sessionState[sessionId]?.pendingProposals` alongside the existing `events` read, computes `facetStatusIndex` once via the existing [`computeFacetStatuses(events)`](../../../apps/participant/src/graph/facetStatus.ts) (memoized on the events reference, same pattern the moderator's pane uses), and threads both into each `<PendingProposalRow>`. The pane's existing testids + ARIA contract from `part_proposals_tab` are unchanged.
- The participant's Vitest suites grow: a new `apps/participant/src/proposals/perProposalFacets.test.ts` (selector — purity, all eleven proposal sub-kinds round-trip, server-vs-client precedence, default-to-proposed) and a new `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` (component — chip shape, per-status className branches mirror `PILL_STATUS_CLASSNAME`, server frame wins, structural sub-kind renders the synthetic `proposal` chip). `PendingProposalsPane.test.tsx` gains three new cases pinning the breakdown integration (multi-facet render across two rows, server precedence via store push, header cells unaffected).
- The Playwright spec [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) gains a step 7 appended after the predecessor's expand-assertion step 6: with the row expanded (step 6 already taps the header), assert `participant-pending-proposal-row-facets` is visible, assert one `participant-pending-proposal-row-facet[data-facet-name="classification"]` chip with `data-facet-status="proposed"` (matching the seeded `classify-node` proposal at the predecessor's step 4 — Decision §7 explains the test seeding stays unchanged).
- **No new i18n keys.** The moderator's leaf already shipped the three new keys this leaf needs (`methodology.facet.proposal`, `methodology.facetState.committed`, `methodology.facetState.withdrawn`) in all three locales. The labels the chip renders (`methodology.facet.<facet>`) all exist (Decision §5).
- **No new ADR.** Decision §9 enumerates why every architectural choice applies an existing ADR or repeats an idiom the predecessor refinements already established.

Out of scope (deferred to sibling or future leaves):

- **Not the per-participant vote indicators inside each facet chip.** The moderator's selector + component carries per-facet votes (`votes: readonly Vote[]`) and renders a `<VoteIndicator>` row inside each chip; this leaf does NOT thread that surface in. Sibling leaf `part_vote_indicators_in_pane` (0.5d, depends `!part_per_facet_breakdown_in_pane`) is the home. This leaf leaves the chip layout extensible — adding a per-facet vote-indicator row inside the chip in the sibling is a chip-internal change. Decision §6 enumerates the contract.
- **Not the per-facet per-other-voter breakdown for the graph-view detail panel.** Sibling task `participant_ui.part_graph_view.part_entity_detail_panel_per_facet_other_voter_breakdown` (0.5d, READY) renders a per-other-voter table inside the entity detail panel on the GRAPH tab. Different surface (graph-tab detail panel, not proposals-tab row body), different intent (per-(entity, facet) per-other-voter dictionary, not per-proposal per-facet status), different data shape (the entity-detail leaf walks `OthersVoteIndex` widened with per-facet per-voter information; this leaf walks the proposal's targeted facets + the `FacetStatusIndex`). Decision §3 explains why they stay separate — no shared component, no tech-debt leaf for unification.
- **Not the badge-count alignment.** Per the standing orchestrator direction (carried from `part_proposal_list_view` Decision §3 + `part_proposal_expand` Out of Scope §3), the badge wire stays on `pendingProposals` map; alignment lands when `part_vote_indicators_in_pane` ships its per-participant projection.
- **Not the shell extraction of proposal projection logic.** This leaf does NOT reach into the shell to project the per-facet view; it ports the moderator's selector verbatim into `apps/participant/src/proposals/`. The shell-extraction trigger (`shell.shell_proposal_projection_extraction`, ~1.5d, not yet a WBS leaf per the orchestrator) is the moment a THIRD application (audience) starts wanting the same projection. This leaf adds a third duplicated proposal-projection helper between moderator + participant (alongside the predecessor's `derivePendingProposals` + `summaryText`), but stays inside the existing two-app duplication idiom; the cost of pre-extracting now without the audience's concrete shape is higher than the cost of porting again later. Decision §1 + Decision §9 cover the trigger.
- **Not a single shared `<PerFacetBreakdown>` component between participant + moderator surfaces.** Decision §1 explicitly chooses port-and-duplicate today; the orchestrator's "if the two surfaces want the same visualization, extract a shared `<PerFacetBreakdown>` component" hint was evaluated and rejected against the predecessor's established duplication idiom. The two surfaces' chips will be byte-equivalent in v1; extraction lands when audience makes it the third consumer.
- **Not new i18n keys.** The moderator leaf shipped the closed-lifecycle status labels (`committed` / `withdrawn`) and the synthetic lifecycle facet label (`proposal`); every label this leaf renders is already in catalog. The pt-BR / es-419 PENDING flags on those keys belong to the moderator leaf's own native-review chain (`i18n_per_facet_breakdown_native_review`) — this leaf does NOT register a new native-review chain entry. Decision §5 covers this.
- **Not animation / transition on the breakdown.** The body slot mounts instantly per the predecessor's "no transition" rule; chip render is synchronous off the same render pass that mounts the body.
- **Not focus management on body mount.** The predecessor explicitly left focus on the header button; this leaf preserves that — no `ref.current.focus()` on the chip strip. Predecessor's Decision §9 anticipated this leaf may re-evaluate; v1 has no interactive children inside the chip strip (the chips are visual-display only — the future vote-indicator dots remain non-interactive), so focus stays on the header button. The contract is re-evaluated again when `part_voting.part_vote_button_per_facet` lands, at which point in-pane voting may want focus management.
- **Not a moderator-side mirror.** The moderator surface already ships its always-expanded inline breakdown; this leaf does not touch it.
- **Not a Cucumber scenario.** The per-facet status derivation is already pinned at the protocol boundary by the upstream `ws_proposal_status_broadcast` scenarios and the per-facet-status derivation scenarios. This leaf is a pure client-side consumer of those already-pinned streams; Decision §8 covers the rationale.

## Why it needs to be done

`docs/participant-ui.md` lines 127-133 enumerate the per-facet visual states (`proposed`, `agreed`, `disputed`, `meta-disagreement`, `committed`) and call out that "the per-facet state is the primary signal the participant needs to decide whether to keep voting on a given proposal". The predecessor `part_proposal_expand` shipped the disclosure machinery — tap a row, reveal the body — but the body's v1 content is the proposal's full summary text, which is **what** is being proposed, not **how close it is to commit-readiness**. A debater scanning the proposals tab to decide what to vote on next needs the per-facet status at a glance: a proposal whose every facet is `'agreed'` is one ack away from commit; a proposal whose `wording` is agreed but `substance` is disputed needs more discussion.

The downstream WBS chain depends on this leaf landing:

1. **`part_vote_indicators_in_pane`** (0.5d, depends `!part_per_facet_breakdown_in_pane`) adds per-participant vote-indicator dots **inside** each per-facet chip the breakdown renders (mirroring how the graph's `<FacetPill>` hosts the `<VoteIndicator>` row inside the pill, and how the moderator's sidebar chip does the same per `mod_vote_indicators_in_sidebar`). It needs the per-facet chip seam (`data-testid="participant-pending-proposal-row-facet"` + `data-facet-name` + `data-facet-status`) this leaf establishes — without it, the indicator leaf would have to invent the chip strip + the indicator dots in one task.
2. **`part_voting.*`** (P2 chain) hangs off the parent subgroup's `complete 100` state — every leaf under `part_pending_proposals` must ship.

Architecturally this leaf locks **the per-facet visualization vocabulary in the participant's proposals-tab**: the chip strip's testid contract, the shared className map (via `PILL_STATUS_CLASSNAME` from the shell), the server-frame-first status precedence. Both of those decisions are byte-identical to the moderator's so a debater who has glanced at the moderator's screen during a session debrief reads the same chip the same way.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; per-facet commit-readiness is what every participant needs to track per proposal.
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L127-L133) — per-facet states + their visual treatment.
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L146-L155) — list view + tap to expand; this leaf's chip strip is the v1 content inside the body the predecessor reserved.
- [docs/participant-ui.md — Layout (sketch)](../../../docs/participant-ui.md#L20-L29) — pane row content spec.
- [ADR 0021 — Event envelope as discriminated union with zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — `proposal.payload.proposal` is structurally valid by construction so the selector's `switch (proposal.kind)` is total.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the chip labels flow through the existing react-i18next contract; no new keys.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the surface owns its mounted region; no cross-app component import (mod and part each carry their own component).
- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — facet-layer events flow independently of entity-layer; the per-facet status the chip surfaces is the facet-layer status the existing `computeFacetStatuses` mirrors.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the per-(entity, facet) status surface the selector reads from the client mirror; structural sub-kinds map to the synthetic `'proposal'` lifecycle facet (Decision §1).

### Sibling refinements

- [`tasks/refinements/participant-ui/part_proposal_expand.md`](part_proposal_expand.md) — the predecessor. Its Decision §3 explicitly reserves the body slot for this leaf's content; the body region's testid + ARIA contract this leaf preserves byte-stable.
- [`tasks/refinements/participant-ui/part_proposal_list_view.md`](part_proposal_list_view.md) — establishes the "port and duplicate; extract to shell when audience becomes third caller" idiom for proposal-projection helpers (Decision §1 there). This leaf extends the pattern to `derivePerProposalFacets`.
- [`tasks/refinements/participant-ui/part_proposals_tab.md`](part_proposals_tab.md) — the projection chain stays hoisted at `OperateRoute`; this leaf doesn't touch the route.
- [`tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`](../moderator-ui/mod_per_facet_breakdown.md) — the moderator's analogous breakdown. This leaf ports the selector + the component shape; the moderator's Decisions §1 / §4 / §5 / §10 are inherited as-is. Critically, the moderator leaf's Status block records that `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` were widened from module-local constants to named exports of `<FacetPill>` and the shell extracted them; this leaf consumes those exports rather than re-defining them.
- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md) — the existing participant disclosure surface on the graph tab. Decision §11 there deferred per-facet per-other-voter breakdown to the now-READY sibling `part_entity_detail_panel_per_facet_other_voter_breakdown` (a DIFFERENT surface from this leaf); Decision §3 below explains why the two surfaces stay separate.

### Live code the surface plugs into

- [`apps/participant/src/proposals/PendingProposalsPane.tsx:228-240`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L228) — the existing body region's inner content (`<p data-testid="participant-pending-proposal-row-body-summary">{summary}</p>`). This leaf replaces the inner `<p>` with `<PerProposalFacetBreakdown>`; the outer `<div data-testid="participant-pending-proposal-row-body" role="region" aria-label={...}>` is unchanged.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the pane container. The existing `useWsStore` read of `events` is supplemented with a second selector reading `state.sessionState[sessionId]?.pendingProposals`. The pane computes `facetStatusIndex` once per render via `useMemo([events], () => computeFacetStatuses(events))` and threads both into each `<PendingProposalRow>`.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — the existing client-side per-(entity, facet) status derivation (`FacetStatusIndex`, `FacetStatus`, `FacetName`, `computeFacetStatuses`). The selector reuses these types unchanged. No changes to this module.
- [`apps/participant/src/ws/wsStore.ts:84`](../../../apps/participant/src/ws/wsStore.ts#L84) — `pendingProposals` already lives on the participant's `WsSessionState` (initialized to `{}` on session ensure); [`apps/participant/src/ws/wsStore.ts:155-168`](../../../apps/participant/src/ws/wsStore.ts#L155) — `applyProposalStatus` is already wired to land `proposal-status` envelopes into the map. This leaf is the first participant-side consumer of `pendingProposals`; the existing writer + slice are sufficient.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts) — the moderator's selector. This leaf ports its `derivePerProposalFacets` body minus the optional vote-projection parameters (`votesByFacetIndex`, `proposalEventId`, `votesByProposalIndex`). The per-sub-kind facet map (lines 100-200ish of the moderator's file) is copied verbatim per Decision §1.
- [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx) — the moderator's component. This leaf ports its render body minus the in-chip `<VoteIndicator>` row (per-participant indicators are out of scope; Decision §6). The testid renaming: moderator's `data-testid="proposal-facet-breakdown"` → participant's `data-testid="participant-pending-proposal-row-facets"`; moderator's `data-testid="proposal-facet-row"` → participant's `data-testid="participant-pending-proposal-row-facet"` (participant-namespaced for unambiguous Playwright addressing across both apps' test specs).
- [`packages/shell/src/`](../../../packages/shell/src/) — `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` are already exported from the shell (per the moderator leaf's Status block at [`mod_per_facet_breakdown.md`](../moderator-ui/mod_per_facet_breakdown.md) line ~1025). This leaf imports them from `@a-conversa/shell`.
- [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) — extends with three new cases pinning the breakdown integration.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — the existing scenario already seeds a `proposal` event of sub-kind `capture-node` (per the predecessor's step 4 + the moderator leaf's e2e step that reuses the seeded `classify-node` shape). Step 7 (NEW, after the predecessor's step 6) asserts the chip strip surfaces.

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `methodology.facet.*` carries `wording` / `classification` / `substance` / `proposal` (the last shipped by the moderator leaf). `methodology.facetState.*` carries `proposed` / `agreed` / `disputed` / `meta-disagreement` / `committed` / `withdrawn` (the last two shipped by the moderator leaf). Every key this leaf needs is already in catalog (Decision §5).
- The pt-BR + es-419 native-review on the three keys the moderator leaf added belongs to the moderator leaf's chain (`i18n_per_facet_breakdown_native_review`). This leaf does NOT register a new native-review entry.

### Existing fixtures the Playwright spec composes with

- The existing `participant-pending-proposals.spec.ts` scenario seeds a `capture-node` proposal at step 4 (per the predecessor's refinement). Step 7 (NEW) reuses that seeded proposal's `wording` facet as the per-facet chip — `capture-node` is the second proposal sub-kind in the per-sub-kind map (Decision §1) that targets the `wording` facet. The chip renders at status `'proposed'` (no votes have arrived yet). No new fixture; no new compose-stack change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/perProposalFacets.ts` — new. The pure selector module.
- `apps/participant/src/proposals/perProposalFacets.test.ts` — new. Vitest cases for the selector.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — new. The presentational component.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` — new. Vitest cases for the component.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — modified. The pane adds the second `useWsStore` selector for `pendingProposals`, computes `facetStatusIndex` once via `useMemo`, threads both into each row; `<PendingProposalRow>` swaps the body's inner `<p>` for `<PerProposalFacetBreakdown>`.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — modified. Adds three new cases (multi-facet render across two rows, server precedence via store push, header cells unaffected).
- `apps/participant/src/proposals/index.ts` — modified. Barrel adds `PerProposalFacetBreakdown` and `derivePerProposalFacets` named exports for downstream sibling consumption (the vote-indicators sibling threads votes into the chip).
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. Step 7 (NEW) asserts the chip strip after the row is expanded.

### Files this task does NOT touch

- `apps/participant/src/proposals/derivePendingProposals.ts` + its test — the row selector is unchanged; the chip uses `row.proposal` which the row selector already projects.
- `apps/participant/src/proposals/proposalSummary.ts` + its test — the per-sub-kind summary helper is unchanged; the body's `<p>` summary is REPLACED by the chip strip per Decision §2, so the helper is no longer called from the body (it stays called from the header's `-summary` cell + the `<li>`'s `title` attribute).
- `apps/participant/src/proposals/usePendingProposalsCount.ts` + its test — the badge count selector stays on the `pendingProposals` map per the standing direction; not touched.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + its test — unchanged.
- `apps/participant/src/stores/uiStore.ts` + `apps/participant/src/stores/stores.test.tsx` — unchanged; the chip strip reads zero `useUiStore` state.
- `apps/participant/src/ws/wsStore.ts` + its test — unchanged; `pendingProposals` slice + `applyProposalStatus` writer already exist.
- `apps/participant/src/graph/facetStatus.ts` + its test — unchanged; reused.
- `apps/participant/src/routes/OperateRoute.tsx` + its test — unchanged.
- `apps/participant/src/layout/*` — unchanged.
- `apps/participant/src/detail/*` — unchanged. The sibling task `part_entity_detail_panel_per_facet_other_voter_breakdown` owns any changes inside `EntityDetailPanel.tsx`.
- `apps/moderator/src/` — unchanged.
- `packages/shell/` — no new shell exports (Decision §1 — port-and-duplicate; shell extraction lands when audience joins).
- `packages/i18n-catalogs/src/catalogs/*.json` — unchanged. The keys this leaf renders are already in catalog (Decision §5).
- `tasks/35-frontend-i18n.tji` — unchanged. No new native-review chain entry (Decision §5).
- `playwright.config.ts` — no project changes.
- `tasks/40-participant-ui.tji` — the `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (Decision §9).

### Selector shape (`apps/participant/src/proposals/perProposalFacets.ts`)

Mirrors the moderator's `apps/moderator/src/graph/proposalFacets.ts` minus the vote projection. Sketch:

```ts
import type { ProposalPayload } from '@a-conversa/shared-types';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus.js';

export type LifecycleFacetName = FacetName | 'proposal';

export interface ProposalFacetEntry {
  readonly facet: LifecycleFacetName;
  readonly status: FacetStatus;
  readonly labelKey: string; // 'methodology.facet.<facet>'
}

/**
 * Pure decoder + per-facet status resolver.
 * Status precedence: server frame → client mirror → 'proposed' (default).
 *
 * Per-sub-kind facet map (copied verbatim from
 * apps/moderator/src/graph/proposalFacets.ts):
 *   - classify-node           → { facet: 'classification' } (on node_id)
 *   - set-node-substance      → { facet: 'substance'      } (on node_id)
 *   - set-edge-substance      → { facet: 'substance'      } (on edge_id)
 *   - edit-wording (reword | restructure) → { facet: 'wording' } (on node_id)
 *   - capture-node            → { facet: 'wording'        } (on node_id; inline candidate)
 *   - decompose | interpretive-split | axiom-mark | meta-move |
 *     break-edge | amend-node | annotate → { facet: 'proposal' } (synthetic lifecycle)
 */
export function derivePerProposalFacets(
  proposal: ProposalPayload,
  facetStatusIndex: FacetStatusIndex,
  serverPerFacetStatus: Record<string, string> | undefined,
): readonly ProposalFacetEntry[] {
  // … per-sub-kind switch (total against the discriminated union) …
}
```

- **Pure**: no `Date.now()`, no `Math.random()`, no closure over time.
- **TypeScript narrowing on `proposal.kind`** makes the switch total against `ProposalPayload`; a default branch is the runtime safety net for callers that bypass TypeScript.
- **Status precedence**: `serverPerFacetStatus[facetName]` → `facetStatusIndex.{nodes,edges}.get(entityId)?.[facet]` (facet-targeting sub-kinds only) → `'proposed'`. Identical to the moderator's selector at [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts).
- **Structural sub-kinds** (decompose, interpretive-split, axiom-mark, meta-move, break-edge, amend-node, annotate) emit one synthetic `{ facet: 'proposal' }` entry. Status defaults to `'proposed'`; server-broadcast precedence applies if the server emits a `proposal`-keyed entry in `perFacetStatus`.
- **Output is a `readonly` array of `{ facet, status, labelKey }` triples.** No votes. The vote-indicator sibling threads its own vote walk into the component when it lands.

### Component shape (`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`)

Sketch:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { PILL_BASE_CLASSNAME, PILL_STATUS_CLASSNAME } from '@a-conversa/shell';
import type { ProposalPayload } from '@a-conversa/shared-types';

import type { FacetStatusIndex } from '../graph/facetStatus.js';
import { derivePerProposalFacets } from './perProposalFacets.js';

export interface PerProposalFacetBreakdownProps {
  readonly proposal: ProposalPayload;
  readonly facetStatusIndex: FacetStatusIndex;
  readonly serverPerFacetStatus: Record<string, string> | undefined;
  readonly proposalEventId: string;
}

export const PerProposalFacetBreakdown = React.memo(function PerProposalFacetBreakdown({
  proposal,
  facetStatusIndex,
  serverPerFacetStatus,
  proposalEventId,
}: PerProposalFacetBreakdownProps) {
  const { t } = useTranslation();
  const entries = React.useMemo(
    () => derivePerProposalFacets(proposal, facetStatusIndex, serverPerFacetStatus),
    [proposal, facetStatusIndex, serverPerFacetStatus],
  );
  return (
    <div
      data-testid="participant-pending-proposal-row-facets"
      data-proposal-id={proposalEventId}
      className="flex flex-row flex-wrap gap-1"
    >
      {entries.map((entry) => (
        <span
          key={entry.facet}
          data-testid="participant-pending-proposal-row-facet"
          data-facet-name={entry.facet}
          data-facet-status={entry.status}
          className={`${PILL_BASE_CLASSNAME} ${PILL_STATUS_CLASSNAME[entry.status]}`}
          aria-label={`${t(entry.labelKey)} ${t(`methodology.facetState.${entry.status}`)}`}
        >
          {t(entry.labelKey)}
        </span>
      ))}
    </div>
  );
});
```

- **`React.memo`** so prop-stable re-renders skip the chip render pass.
- **`useMemo` on the selector** keyed on `[proposal, facetStatusIndex, serverPerFacetStatus]` matches the moderator's pattern.
- **Chip styling** imports `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` from `@a-conversa/shell`. The same constants drive the graph's `<FacetPill>` and the moderator's sidebar chip; a state-styling refinement that touches them updates this surface automatically (Decision §4 mid-commit drift guard via test).
- **Chip `aria-label`** reads the facet name + status word per [Decision §6 of `mod_per_facet_breakdown`](../moderator-ui/mod_per_facet_breakdown.md) — same idiom: visual encodes status; `aria-label` carries the prose for screen readers. No new keys (every status word is in catalog).
- **`flex flex-wrap gap-1`** matches the moderator's chip strip wrapper; the participant's body region has more horizontal room than the moderator's sidebar, so wrapping is rarer but the safety is the same.

### Row body integration (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Before (current — from `part_proposal_expand`):

```tsx
{isExpanded ? (
  <div
    id={bodyId}
    data-testid="participant-pending-proposal-row-body"
    role="region"
    aria-label={bodyAriaLabel}
    className="border-t border-slate-100 px-3 py-2 text-sm text-slate-700"
  >
    <p data-testid="participant-pending-proposal-row-body-summary" className="whitespace-pre-wrap break-words">
      {summary}
    </p>
  </div>
) : null}
```

After (this leaf):

```tsx
{isExpanded ? (
  <div
    id={bodyId}
    data-testid="participant-pending-proposal-row-body"
    role="region"
    aria-label={bodyAriaLabel}
    className="border-t border-slate-100 px-3 py-2 text-sm text-slate-700"
  >
    <PerProposalFacetBreakdown
      proposal={row.proposal}
      facetStatusIndex={facetStatusIndex}
      serverPerFacetStatus={pendingProposals[row.proposalEventId]?.perFacetStatus}
      proposalEventId={row.proposalEventId}
    />
  </div>
) : null}
```

- The outer body region's testid + ARIA contract is byte-stable (predecessor's contract preserved).
- The `<p data-testid="participant-pending-proposal-row-body-summary">` is **replaced** (not augmented — Decision §2). The header's `-summary` cell still carries the truncated summary; the `<li>`'s `title` attribute still carries the full summary tooltip; the chip strip is the new body content.
- `facetStatusIndex` + `pendingProposals` are threaded from the pane via component props (the pane reads them; the row consumes them). The chip's `serverPerFacetStatus` is `undefined` when the server hasn't yet broadcast for this proposal; the selector falls back to the client mirror via `facetStatusIndex`.

### Pane plumbing (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

The pane gains a second `useWsStore` selector subscription (idiomatic — keeps each cell narrow):

```tsx
const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);
const pendingProposals = useWsStore(
  (s) => s.sessionState[sessionId]?.pendingProposals ?? EMPTY_PENDING_PROPOSALS,
);
const facetStatusIndex = React.useMemo(() => computeFacetStatuses(events), [events]);
```

Both are passed into each `<PendingProposalRow>`. The row component's signature grows two new props (`facetStatusIndex`, `pendingProposals`). `EMPTY_PENDING_PROPOSALS` is a module-level frozen empty object for stable reference equality on empty sessions (same pattern as the existing `EMPTY_EVENTS` reference).

### What the new code MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects** inside `<PerProposalFacetBreakdown>` or the selector.
- **No direct `useWsStore.setState` writes.** The chip is consumer-only.
- **No new store slices.** Zero `useUiStore` reads inside the chip.
- **No reaching into `@a-conversa/shell` for proposal projection logic.** The shell does not currently export proposal projection helpers; the participant ports the moderator's selector verbatim into `apps/participant/src/proposals/`. Decision §1 + Decision §9.
- **No in-chip `<VoteIndicator>` row.** The sibling task `part_vote_indicators_in_pane` is the home; this leaf leaves the chip layout extensible.
- **No cross-app import.** `import … from '../../moderator/...'` is forbidden by the workspace boundary; the moderator's selector + component are PORTED (re-defined in the participant tree), not imported.
- **No new ADR.** Decision §9.

### Test layers per ADR 0022

Five pins, each anchoring a different observable property:

1. **Vitest `perProposalFacets.test.ts` (new file)** — selector. Six cases:
   - (a) Each of the four facet-targeting sub-kinds emits one entry with the expected `facet` value (`classify-node` → `classification`; `set-node-substance` → `substance`; `set-edge-substance` → `substance`; `edit-wording` reword/restructure → `wording`). Plus `capture-node` → `wording` (inline candidate; same mapping as the moderator's selector handles).
   - (b) Each of the seven structural sub-kinds emits one entry with `facet: 'proposal'`.
   - (c) Server `serverPerFacetStatus[facet]` overrides the client mirror.
   - (d) Client mirror value used when `serverPerFacetStatus` is undefined OR does not carry the facet.
   - (e) Default-to-`'proposed'` when neither surface carries the facet.
   - (f) Pure (calling twice with the same inputs returns deep-equal outputs).

2. **Vitest `PerProposalFacetBreakdown.test.tsx` (new file)** — component. Five cases:
   - (a) A `capture-node` proposal renders one chip with `data-facet-name="wording"`, the resolved facet label ("Wording"), the `proposed` className branch.
   - (b) Per-status className for each of the six `FacetStatus` values matches `PILL_STATUS_CLASSNAME[status]` (drift-guard against the shell's exported map).
   - (c) A structural sub-kind (`decompose`) renders one chip with `data-facet-name="proposal"` and the `methodology.facet.proposal` label ("Proposal").
   - (d) When `serverPerFacetStatus[facetName]` is present, the chip's `data-facet-status` reflects the server value (not the client mirror).
   - (e) The breakdown container carries `data-proposal-id` matching the prop.

3. **Vitest `PendingProposalsPane.test.tsx` (extended)** — three new cases appended after the predecessor's case (n):
   - (o) Two proposals seeded of distinct sub-kinds; expand row A → assert one chip with the expected facet name; collapse, expand row B → assert one chip with the row B facet name. Pane reads `pendingProposals` AND `events`.
   - (p) Server precedence: push a `proposal-status` payload via `useWsStore.getState().applyProposalStatus({...})`; expand the row; assert the chip's `data-facet-status` updates to the server-broadcast value.
   - (q) The existing header cells (`participant-pending-proposal-row-{kind,summary,author,timestamp}`) are unaffected after the body content swap; the body's `participant-pending-proposal-row-body` region is still mounted with the correct ARIA contract; the predecessor's `participant-pending-proposal-row-body-summary` is GONE (its testid is absent — the chip strip replaced it).

4. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — append step 7 to the existing scenario after the predecessor's step 6:
   - With the row already expanded from step 6, locate `participant-pending-proposal-row-facets` inside the body region; assert it's visible.
   - Filter by `participant-pending-proposal-row-facet[data-facet-name="wording"]`; assert count 1; assert `data-facet-status="proposed"` (the seeded `capture-node` from step 4 has no votes yet).
   - `expect.poll` budget — match the predecessor's polling pattern.

5. **No new Cucumber scenario** (Decision §8). Pure client-side derivation off a WS log; Vitest + Playwright is sufficient.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright extension is the default.** The body region is already reachable via the predecessor's expand path (step 6 of `participant-pending-proposals.spec.ts` taps the header and asserts the body is visible); this leaf augments the body's content. Extending the existing scenario with one step that asserts the chip strip is the right anchor — no new scenario file, no compose-stack change, no e2e deferral. The orchestrator's standing direction ("the row-body region is already reachable via part_proposal_expand's Playwright path, so deferral is NOT justified") is honored.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, NO projector output. The pane reads `pendingProposals` from the participant's existing `useWsStore` slice (which has been populated by `applyProposalStatus` since the WS client was wired). Decision §8 enumerates why no new Cucumber scenario is warranted.

### Budget honesty (1d)

- ~30 min: port `derivePerProposalFacets` from the moderator → `apps/participant/src/proposals/perProposalFacets.ts`; strip vote-projection parameters; sanity-check the per-sub-kind switch against `ProposalPayload`.
- ~30 min: port `<ProposalFacetBreakdown>` → `<PerProposalFacetBreakdown>` (participant naming, no in-chip `<VoteIndicator>` row, participant testids).
- ~30 min: edit `<PendingProposalsPane>` — add the second `useWsStore` selector, the `facetStatusIndex` `useMemo`, the props plumbing through `<PendingProposalRow>`. Swap the body's inner `<p>` for `<PerProposalFacetBreakdown>`.
- ~45 min: write `perProposalFacets.test.ts` (6 cases) covering the per-sub-kind map + status precedence + purity.
- ~45 min: write `PerProposalFacetBreakdown.test.tsx` (5 cases) covering chip shape, per-status className drift-guard, structural sub-kind, server precedence, `data-proposal-id` wiring.
- ~30 min: extend `PendingProposalsPane.test.tsx` (3 new cases — multi-facet, server precedence via store push, header cells unaffected).
- ~30 min: extend `participant-pending-proposals.spec.ts` (step 7 — assert chip strip after expansion).
- ~30 min: visual sanity at the participant's landscape viewports (1280×720 + 1024×768) — chip wrap behavior, the chip-strip border-top of the body region looks right, the chips' uppercase text-[10px] doesn't shrink awkwardly on the wider participant viewport.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + WBS-status ritual.
- ~30 min: buffer for Tailwind / aria-attribute fixups after the visual sanity pass.

Risk surface is modest. The main hazard is the `pendingProposals` reference equality on empty sessions — the `EMPTY_PENDING_PROPOSALS` frozen-object pattern (mirroring the existing `EMPTY_EVENTS` reference) is the safety net so that an empty pane doesn't churn re-renders. The second hazard is the per-sub-kind facet map staying byte-equal with the moderator's — Decision §1's drift-guard test (a direct port from the moderator's `proposalFacets.test.ts` of all eleven sub-kinds with the same expected facets) catches drift.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new selector, the new component, the extended pane, and the extended e2e all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build; bundle filename / sidecar shape unchanged.
4. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke` stays green; smoke count grows by +14** (6 from `perProposalFacets.test.ts` + 5 from `PerProposalFacetBreakdown.test.tsx` + 3 from `PendingProposalsPane.test.tsx`).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new keys, no catalog edits.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. The new step 7 asserts the chip strip `participant-pending-proposal-row-facets` is visible after expansion and one `participant-pending-proposal-row-facet[data-facet-name="wording"]` chip carries `data-facet-status="proposed"` for the seeded `capture-node`. Predecessor's steps 1-6 pass unchanged.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **`<PerProposalFacetBreakdown>` owns no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams` inside the component body returns zero matches; the component reads `useTranslation` + dispatches `derivePerProposalFacets` only.
10. **Chip styling drift-guard test** — a Vitest case in `PerProposalFacetBreakdown.test.tsx` asserts the per-status className map equals `PILL_STATUS_CLASSNAME` from `@a-conversa/shell` for each of the six `FacetStatus` values; a future state-styling refinement that touches the shell-exported constants automatically propagates here, and any local override surfaces as a test failure.
11. **Body region contract preserved** — the outer `<div data-testid="participant-pending-proposal-row-body" role="region" aria-label={...}>` is byte-stable; only the inner content (one `<p>` → one `<PerProposalFacetBreakdown>` mount) changes. Vitest case (q) pins the contract; the predecessor's Playwright body-visibility assertion at step 6 still resolves.
12. **`pendingProposals` is a participant `useWsStore` selector subscription, not a `useState`** — the pane subscribes via the standard Zustand selector pattern; reference-equality re-renders the pane the moment a new `proposal-status` envelope lands. Vitest case (p) pins server-precedence by pushing through `applyProposalStatus` and asserting the chip's `data-facet-status` updates.
13. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_per_facet_breakdown_in_pane` task block per the task-completion ritual.
14. **Predecessor's assertions unchanged** — the predecessor's `PendingProposalsPane.test.tsx` cases (a)-(n) pass; the predecessor's Playwright steps 1-6 pass; the disclosure machinery (header button + `aria-expanded` + `data-expanded` + body mount/unmount) is untouched.

## Decisions

### 1. Port the moderator's selector + component into the participant tree; do not extract to shell yet

Three alternatives surveyed:

- **(A) Port `derivePerProposalFacets` and `<ProposalFacetBreakdown>` from the moderator into the participant tree** (chosen). Mirrors the predecessor's `part_proposal_list_view` Decision §1 idiom verbatim: two-consumer duplication is the established trigger threshold; the third consumer (audience) is the extraction moment. The participant's selector + component live under `apps/participant/src/proposals/` (matching the predecessor's location choice); each helper is byte-equivalent to the moderator's modulo the participant-namespaced testids + the omitted vote-projection parameters. The drift cost is real (when a per-sub-kind facet map change lands, both copies must update in the same commit) but is the same cost the predecessor accepted for `derivePendingProposals` + `summaryText` — and the per-sub-kind facet map is settled by `data_and_methodology.event_types.proposal_events`, so churn is rare.
- **(B) Cross-app import: `import { derivePerProposalFacets } from '../../moderator/src/graph/proposalFacets.js'`**. Rejected — the workspace boundary forbids cross-app imports (ADR 0010 — pnpm workspaces; the moderator + participant apps are sibling packages, neither depends on the other). The lift point for sharing would be a shared package (`@a-conversa/shell` or a new `@a-conversa/proposals-projection`), not a direct cross-app import.
- **(C) Extract `derivePerProposalFacets` to `@a-conversa/shell` now** (early extraction trigger). Rejected. The predecessor explicitly held off on extracting `derivePendingProposals` + `summaryText` to shell pending the audience surface; this leaf's helper joins them as the third duplicated proposal-projection helper between moderator + participant. The orchestrator's hint ("if this task becomes that 3rd consumer (i.e. you find yourself reaching into shell to project the per-facet view directly), call it out so the closer registers `shell.shell_proposal_projection_extraction`") implies the trigger is "this task reaches into shell", not "this task adds a third duplicated helper" — and this task does NOT reach into shell. The audience surface is the moment to lift all three helpers together; pre-extracting now without the audience's concrete shape would commit to an interface that the audience may need to renegotiate. Tech-debt visibility is still raised — Decision §9 enumerates the registration condition.

The participant's `derivePerProposalFacets` is a byte-equivalent port of the moderator's selector (minus the optional vote-projection parameters); the `<PerProposalFacetBreakdown>` component is a byte-equivalent port of the moderator's component (minus the in-chip `<VoteIndicator>` row + with participant-namespaced testids).

### 2. Replace the body's `<p>` summary with the chip strip; don't render both

Three alternatives surveyed:

- **(A) The body region renders the chip strip ONLY; the predecessor's `<p>` summary is removed** (chosen). The chip strip communicates the actionable per-facet status — the primary signal the debater needs to decide whether to vote next on this proposal. The header's `-summary` cell still carries the truncated summary; the `<li>`'s `title` attribute still carries the full summary tooltip; the user-visible information density of the row is unchanged at the cost of one redundant rendered string. The body region's outer `<div>` + ARIA contract is preserved byte-stable, so the predecessor's Playwright body-visibility assertion at step 6 still resolves.
- **(B) Render the chip strip ABOVE the existing `<p>` summary** (additive). Rejected. The body region was reserved by the predecessor as a single content slot; adding a second piece of content stacks two rendered representations of the same proposal (chips + prose) which the user reads twice. The predecessor's Decision §3 said "the breakdown leaf can either render alongside the summary `<p>` or replace it — that leaf's refinement decides" — this leaf decides REPLACE. The chip strip is denser, scannable, and is what the moderator surface shows in its analogous breakdown.
- **(C) Render the chip strip BELOW the `<p>` summary** (additive). Rejected for the same reason as (B); also visually awkward — the chip strip's vertical compactness wants to sit at the top of the body region, not below a multi-line prose paragraph.

The header's `-summary` cell + the `<li>`'s `title` tooltip together carry the proposal's text content at two zoom levels (truncated + full); the body region is the place for the per-facet status chips. A user who wants to read the full text of a long wording uses the tooltip; the body region is for actionable signal. If a future leaf wants prose AND chips in the body, that leaf re-evaluates this decision.

### 3. Surface stays separate from `part_entity_detail_panel_per_facet_other_voter_breakdown`

The sibling task `part_entity_detail_panel_per_facet_other_voter_breakdown` (0.5d, READY, per [tasks/40-participant-ui.tji](../../40-participant-ui.tji) lines 183-189) renders a per-facet per-other-voter breakdown inside the entity detail panel on the graph tab. Three structural differences from this leaf:

1. **Different surface.** That leaf lives on the **graph tab**'s entity detail panel; this leaf lives on the **proposals tab**'s expanded row body. The two tabs are mutually exclusive — only one mounts at a time per `part_proposals_tab` Decision §4.
2. **Different intent.** That leaf surfaces "who voted what on each facet for this *selected entity*" — answering the debater's question "have my co-debaters voted on this entity's facets?". This leaf surfaces "what is the per-facet status of *this specific pending proposal*" — answering "is this proposal close to commit-readiness?".
3. **Different data shape.** That leaf walks the `OthersVoteIndex` (per-(entity, facet) per-voter dictionary; per its refinement Decision §11 the leaf widens the projection or re-walks inside the panel) for the selected entity. This leaf walks the proposal's targeted facets (per the per-sub-kind facet map) + the `FacetStatusIndex` for the per-facet status. The two walks have no overlapping inputs.

Three alternatives surveyed for unification:

- **(A) Keep the two surfaces separate; no shared `<PerFacetBreakdown>` component** (chosen). The three structural differences above make a shared component an over-abstraction: the participant entity-detail breakdown will be a per-voter table (rows = other voters; columns = facets, or similar); this leaf is a per-status chip strip (rows = facets; status encoded visually). Forcing a shared abstraction over those two render shapes would mean either inventing a configurable matrix-vs-chip-strip layer (a layer with one user today) or shipping two thin sibling components that happen to share a name. The cost of duplication is bounded by the small surface area of the chip strip (~50 LOC plus tests); the cost of premature unification is the wrong abstraction frozen in.
- **(B) Extract a shared `<PerFacetBreakdown>` component into `apps/participant/src/proposals/`** (or `apps/participant/src/detail/`). Rejected — the two consumers' render shapes diverge significantly (chip strip vs voter table), and the data shapes diverge (proposal-payload-driven vs other-voter-index-driven). Pre-shared component would require a discriminated-union prop surface (which collapses to "render mode A or render mode B") that's strictly worse than two co-located components.
- **(C) Register a tech-debt leaf `shared_per_facet_breakdown_component_extraction`** to revisit after both sibling leaves ship. Rejected as planning debt that adds no value. If the two surfaces' render shapes turn out to converge (they likely won't, given the divergent data + interaction model), a future refactoring leaf can be filed against the post-sibling state of the code — but pre-registering now is speculative.

The orchestrator's "if the two surfaces want the same visualization, extract a shared `<PerFacetBreakdown>` component and register a tech-debt leaf rather than duplicating; if the surfaces diverge (different density / interaction), keep them separate and say so" is honored by the "keep them separate and say so" branch. The two surfaces diverge sufficiently to warrant separation.

### 4. Chip styling reuses `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` from the shell

Two alternatives surveyed:

- **(A) Import `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` from `@a-conversa/shell`** (chosen). The moderator leaf's Status block records that those constants were widened from `<FacetPill>` module-local to named exports of the shell so cross-surface consumers (moderator sidebar chip, participant pane chip, future audience chip, future graph-side variants) all derive their per-status visual from the same source. A drift-guard test in `PerProposalFacetBreakdown.test.tsx` asserts the per-status className map matches the shell exports verbatim; if a future state-styling refinement updates the shell constants, the participant chip automatically follows; any local override surfaces as a test failure.
- **(B) Define a participant-local `PILL_STATUS_CLASSNAME` constant in `PerProposalFacetBreakdown.tsx`** (literal copy of the shell constant). Rejected as silently fragile — would mean drift between the moderator sidebar chip + the participant pane chip would only be caught by visual sanity review, not by CI. The shell-exported constants exist precisely so cross-surface consumers don't drift.

### 5. No new i18n keys; the moderator leaf already shipped them

Three alternatives surveyed:

- **(A) Reuse the existing keys** (chosen). `methodology.facet.<wording|classification|substance|proposal>` and `methodology.facetState.<proposed|agreed|disputed|meta-disagreement|committed|withdrawn>` are all in catalog. The chip's rendered label is `t('methodology.facet.<facet>')`; the chip's `aria-label` is `t('methodology.facet.<facet>') + ' ' + t('methodology.facetState.<status>')`. Zero new keys, zero new native-review chain entries.
- **(B) Add a participant-specific namespace for the chip label** (e.g., `participant.pendingProposalsPane.facetBreakdown.facet.<facet>`). Rejected — the per-facet labels are domain methodology vocabulary, not participant-surface-specific UX prose; reusing the shared `methodology.*` namespace keeps the translation consistent across surfaces.
- **(C) Add a participant-specific `aria-label` ICU template key** (e.g., `participant.pendingProposalsPane.facetBreakdown.chipAriaLabel`). Rejected — the moderator chip already uses the same concatenation idiom and ships no such template; the cost of one ICU template per status word is higher than the value (the screen reader reads the two words sequentially, which is acceptable). If a future a11y review wants a properly composed prose label, that's a one-key addition then.

The moderator leaf's `i18n_per_facet_breakdown_native_review` already covers the pt-BR + es-419 PENDING flags on the three new keys; this leaf adds nothing to that chain.

### 6. Per-participant vote indicators inside chips are out of scope

The moderator's chip carries an in-chip `<VoteIndicator>` row when `entry.votes.length > 0` (per the moderator's `<ProposalFacetBreakdown>` + the in-chip `<VoteIndicator>` wiring from `mod_vote_indicators_in_sidebar`). This leaf's chip does **not** carry a `<VoteIndicator>` row:

- The selector's output (`ProposalFacetEntry`) intentionally omits the `votes: readonly Vote[]` field the moderator's `ProposalFacetEntry` carries. Sibling `part_vote_indicators_in_pane` will add either (a) an extension of `derivePerProposalFacets` to accept the `votesByFacetIndex` projection (mirroring the moderator's parameter shape) or (b) a sibling component that wraps `<PerProposalFacetBreakdown>` and threads vote indicators in. Either path is a chip-internal change; this leaf leaves the chip layout extensible.
- The chip's `data-facet-name` + `data-facet-status` testid contract is established here so the sibling indicator leaf can address each chip precisely when it threads in the indicator dots.

The sibling leaf is **0.5d**, half the budget of this leaf — appropriately scoped given the per-participant vote walk is the next logical extension off the chip seam this leaf establishes.

### 7. Test seeding stays unchanged; Playwright reuses the predecessor's `capture-node` seed

The existing `participant-pending-proposals.spec.ts` scenario seeds one `proposal` event of sub-kind `capture-node` at step 4 (per the predecessor's refinement). The step 7 (NEW) extension does NOT seed a second proposal — it asserts the chip strip surfaces for the already-seeded `capture-node`. The `capture-node` sub-kind maps to `{ facet: 'wording' }` per the per-sub-kind map (Decision §1), so the chip's `data-facet-name="wording"` is the expected value. The chip's `data-facet-status="proposed"` is the default (no votes have arrived in the test fixture). The polling budget matches the predecessor's pattern.

If a future test wants to assert the chip strip for a structural sub-kind (e.g., `decompose` → synthetic `'proposal'` chip), that leaf adds a new seeded scenario; not this one.

### 8. No Cucumber scenario for the chip strip render path

Two alternatives surveyed:

- **(A) Pin via Vitest (selector + component + pane integration) + Playwright (end-to-end chip visibility under the compose stack)** (chosen). The chip strip is purely client-side derivation off two already-pinned data sources: the event log (pinned at the protocol boundary by upstream Cucumber scenarios for each proposal sub-kind) and the per-`proposalId` `perFacetStatus` map (pinned by the `ws_proposal_status_broadcast` Cucumber scenarios). Adding a Cucumber scenario for the chip render path would re-assert behavior the upstream tests already pin; the orchestrator's "Cucumber if a surface ADDS wire/projector behavior" guidance applies when something crosses the boundary — this leaf doesn't.
- **(B) Add a Cucumber scenario** asserting "given a session with a pending proposal of sub-kind X, when the participant expands the row, the body's chip strip surfaces one chip with facet Y at status Z". Rejected. The assertion is structurally a UI render contract, not a protocol-boundary contract; pglite-driven Cucumber steps would have to drive the React render tree, which is what Playwright + Vitest already do better.

The orchestrator's standing note that Cucumber count has been flat is acknowledged. This leaf is a UI-stream task; the chip strip exposes no new wire / broadcast behavior; the flatness is not a coverage gap this leaf could fill.

### 9. Tech-debt registration

Two follow-ups named crisply for the closer:

- **Watch the proposal-projection-helper duplication count.** This leaf raises the moderator+participant duplicated proposal-projection helper count from two (`derivePendingProposals`, `summaryText`) to three (`derivePerProposalFacets` added). The audience surface is the trigger for `shell.shell_proposal_projection_extraction` (~1.5d, NOT a WBS leaf today per the orchestrator). **Action for Closer**: do NOT register `shell.shell_proposal_projection_extraction` from this leaf — it remains the audience-surface trigger per the orchestrator's stated rule ("registered when the 3rd consumer of the shell proposal projection logic appears" — i.e., the 3rd application, not the 3rd helper). When the audience surface's first proposal-consuming task lands and reaches for these helpers, that task's closer registers the extraction leaf with effort ~1.5d, depending on the audience app skeleton being in place, and the extraction lifts all three duplicated helpers together. This leaf raises visibility but does not register.

- **Focus management re-evaluation.** The predecessor's Decision §9 anticipated this leaf may need to re-evaluate focus management on body mount. v1 has no interactive children inside the chip strip (the chips are visual-display only), so focus stays on the header button — no focus change. The contract is re-evaluated again when `part_voting.part_vote_button_per_facet` lands (in-pane voting may want focus management on the first vote button). No new WBS leaf — the existing voting leaf is the home.

No new ADR. Every architectural choice above applies an existing ADR or repeats an idiom the predecessor refinements established:

- Selector + component portability (Decision §1) — applies the predecessor's `part_proposal_list_view` Decision §1 idiom (duplicate-don't-extract for two-consumer proposal projection helpers).
- Body content swap (Decision §2) — the predecessor's Decision §3 explicitly authorized this leaf to "either render alongside the summary `<p>` or replace it"; replace is the choice.
- Surface separation from entity-detail leaf (Decision §3) — restates established surface-boundary asymmetry (graph tab vs proposals tab; entity-driven vs proposal-driven).
- Chip styling sharing (Decision §4) — applies the moderator leaf's Status block decision to widen `PILL_*_CLASSNAME` to shell exports for cross-surface drift-guard.
- i18n reuse (Decision §5) — applies the moderator leaf's i18n shipment.
- Test layout (ADR 0022 + the predecessor's pattern).
- Cucumber scope (Decision §8) — restates the established "Cucumber for protocol-boundary; Vitest + Playwright for pure client" rule.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-26.

- New pure selector lands at [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) — ported from the moderator's `derivePerProposalFacets` minus the vote-projection parameters (Decision §1 / §6). Per-sub-kind facet map is byte-equivalent to [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts); status precedence is server frame → client mirror → `'proposed'`.
- New presentational component lands at [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — renders `<div data-testid="participant-pending-proposal-row-facets" data-proposal-id={...}>` with one `<span data-testid="participant-pending-proposal-row-facet" data-facet-name=... data-facet-status=...>` per facet. Reuses shell-exported `PILL_BASE_CLASSNAME` + `PILL_STATUS_CLASSNAME` (Decision §4).
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) grows a second `useWsStore` selector for `pendingProposals` + a memoized `facetStatusIndex` via `computeFacetStatuses(events)`; both are threaded into `<PendingProposalRow>`. The expanded body's inner `<p data-testid="participant-pending-proposal-row-body-summary">` is REPLACED by `<PerProposalFacetBreakdown>` (Decision §2); the outer body region + ARIA contract from `part_proposal_expand` is byte-stable.
- [`apps/participant/src/proposals/index.ts`](../../../apps/participant/src/proposals/index.ts) barrel adds `PerProposalFacetBreakdown` + `derivePerProposalFacets` + related types for downstream sibling consumption.
- Vitest suites grow +14: 6 new selector cases ([`perProposalFacets.test.ts`](../../../apps/participant/src/proposals/perProposalFacets.test.ts)) + 5 new component cases ([`PerProposalFacetBreakdown.test.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx)) + 3 new pane cases appended to [`PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) (cases o/p/q — multi-facet across two rows, server precedence via `applyProposalStatus`, header cells unaffected after body-content swap). Existing case (k) re-anchored to the chip strip.
- Playwright [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) gains step 7 asserting the chip strip is visible with one `[data-facet-name="wording"][data-facet-status="proposed"]` chip for the seeded `capture-node` proposal (Decision §7); step 6's body-summary text assertion is dropped per Decision §2 (testid is gone). Scenario count unchanged (146 total; 32/32 participant).
- No tech-debt registered. Per Decision §9, `shell.shell_proposal_projection_extraction` remains the audience-surface trigger (this leaf raises the duplicated-helper count from 2 to 3 but is not the 3rd-application threshold). Focus-management re-evaluation defers to `part_voting.part_vote_button_per_facet`.
