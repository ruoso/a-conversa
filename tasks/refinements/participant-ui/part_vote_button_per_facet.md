# Agree/Dispute vote buttons per facet inside the pending-proposals pane

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_voting.part_vote_button_per_facet`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_pending_proposals` (settled — the parent subgroup rolls up after its last leaf `part_vote_indicators_in_pane` lands at commit `48cd2fe`. The chip strip + per-other-voter dot row inside each chip are the surface this leaf mounts vote buttons onto. The chip's testid contract (`data-testid="participant-pending-proposal-row-facet"` carrying `data-facet-name` + `data-facet-status`) is byte-stable from those leaves' perspective; the vote-button affordance mounts INSIDE the existing chip span as a sibling of the label text + the optional indicator row).
- `!backend.websocket_protocol.ws_vote_message` (settled — the `vote` envelope is fully wired end-to-end with handler at [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts), the per-arm payload schema in [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts), and post-commit `event-applied` broadcast → `voted` ack flow. Reuses the existing server seam; no wire change.
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.pf_part_vote_action_facet_keyed` (settled — the participant-side hook [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) already exposes the dual-arm `castVote(choice)` callback keyed per slot. The hook accepts either `{ entity_kind, entity_id, facet }` (facet-arm — for the four facet-targeting sub-kinds + `capture-node`'s inline-wording) or `{ proposal_id }` (proposal-arm — for the seven structural sub-kinds), constructs the matching `target`-discriminated wire payload, and dispatches via `useWsClient().send('vote', payload)`. Per-slot in-flight tracking, last-error surface, and pessimistic-wait posture are all in place. This leaf is a fresh consumer of that hook; no hook changes.
- Prose-only context (NOT a `.tji` edge): `!per_facet_refactor.pf_part_detail_panel_three_facet_rows` (settled — established the participant-side per-facet vote-affordance vocabulary in the entity detail panel via [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx). The per-status enablement rule (`proposed` / `disputed` / `withdrawn` → agree+dispute affordance; `agreed` / `committed` → withdraw affordance only; `awaiting-proposal` / `meta-disagreement` → no buttons), the `participant-vote-button-{agree,dispute,withdraw}` testid family, the i18n key namespace (`participant.voteButton.*`), the own-vote-indicator-replaces-buttons posture, and the wire-error inline display are all established there. This leaf ports the enablement rule + reuses the i18n keys for a SECOND surface — the pane chip — with pane-namespaced testids so Playwright selectors disambiguate the two surfaces).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_pending_proposals.part_vote_indicators_in_pane` (settled — commit `48cd2fe`). The chip-internal extensibility this leaf consumes is the same seam the indicator-row leaf extended: a chip span containing label text + optional indicator row + (NEW, this leaf) optional vote-button affordance. The buttons mount AFTER the label text + indicator row inside the chip, so the existing per-other-voter dots stay byte-stable.
- Prose-only context (NOT a `.tji` edge): ADR 0030 (settled — per-facet vote keying and sequential capture). The hook's two-arm vocabulary (`VoteChoice = 'agree' | 'dispute'`) and the wire payload's `target`-discriminated union are pinned. Withdraw is NOT a vote choice per ADR 0030 §3; the withdraw flow lives under `part_withdraw.*` and is out of scope here.

## What this task is

Mount per-facet Agree / Dispute affordances inside each per-facet chip the pending-proposals pane renders, so a debater can vote on a pending facet WITHOUT first navigating to the graph tab's entity detail panel. The chip already encodes the facet's status (predecessor `part_per_facet_breakdown_in_pane`) and the per-other-voter dot row (predecessor `part_vote_indicators_in_pane`); this leaf adds the action affordance that lets the debater express agree or dispute against the chip's facet from the proposals tab.

After this leaf, each pending-proposal row's expanded body renders the chip strip and, for each chip whose status admits a vote AND on which the current participant has not yet voted, two small buttons (`agree` / `dispute`) inside the chip. Clicking a button calls the existing `useVoteAction` hook for the chip's (entity_kind, entity_id, facet) target (facet arm) OR proposal_id (proposal arm, for structural sub-kinds); the hook handles the WS round-trip, the post-commit broadcast lands the `vote` event into the projector, the chip's `data-facet-status` re-derives, and either the button branch disappears (because the participant has now voted) or the status changes such that the buttons no longer apply (e.g. `proposed` → `agreed` if this vote was the unanimity-completing one).

Concretely:

- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) gains an optional `proposalEventId` carry-through on `ProposalFacetEntry`: the entry now exposes `voteTarget` carrying the discriminated union `{ kind: 'facet'; entity_kind: 'node' | 'edge'; entity_id: string; facet: FacetName } | { kind: 'proposal'; proposal_id: string }`. The selector populates `voteTarget` from the existing `facetTargetOf` result (facet arm) OR from the `proposalEventId` parameter (proposal arm, when `facetTargetOf` returns null AND `proposalEventId` is defined). Existing `votes` field stays as-is. Decision §1 — extend, don't introduce a parallel selector.
- A new presentational component lands at [`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`](../../../apps/participant/src/proposals/ProposalFacetVoteButtons.tsx) exporting `<ProposalFacetVoteButtons voteTarget={...} status={...} ownVote={...} />`. Decides whether to render the affordance based on `status` + `ownVote`; when rendered, dispatches to `useVoteAction(voteTarget)` and surfaces two `<button>` elements with testids `participant-pending-proposal-row-facet-vote-button-agree` + `participant-pending-proposal-row-facet-vote-button-dispute`. Inline wire-error region with the same i18n key the detail-panel surface uses (`participant.voteButton.wireError`). Decision §3 — single component encapsulates the "render affordance?" guard so the chip stays declarative.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) renders `<ProposalFacetVoteButtons>` inside each chip span, AFTER the optional indicator row. The component receives `voteTarget` from `entry.voteTarget` + `status` from `entry.status` + `ownVote` from a new `ownFacetVotes` index prop. The chip span grows the buttons as a third child slot: `{facetLabel}{voteIndicatorRow}{voteButtons}`. The existing testid + ARIA contract on the chip span is byte-stable.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) grows a new `useMemo` computing `ownFacetVotes` via the existing `projectOwnFacetVotes(events, currentParticipantId)` projector from [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts). The index is threaded into each `<PendingProposalRow>` and forwarded to `<PerProposalFacetBreakdown>`. No new pane prop — `currentParticipantId` is already in scope from the predecessor leaf.
- The participant Vitest suites grow: a new `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` (component — per-status render gate, own-vote-hides-buttons, button-click dispatches via the mocked hook, wire-error renders inline, button-disabled-while-in-flight, proposal-arm and facet-arm wiring both pinned); extensions to `perProposalFacets.test.ts` (the new `voteTarget` field across facet-targeting + structural sub-kinds + the `proposalEventId === undefined` default-path); extensions to `PerProposalFacetBreakdown.test.tsx` (chip renders the buttons inline when status admits, omits them otherwise, own-vote hides them); extensions to `PendingProposalsPane.test.tsx` (the pane threads `ownFacetVotes` end-to-end; an integrated click-vote-and-observe-status-flip case).
- The Playwright spec [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) gains a step 9 appended after the predecessor's step 8: with the row already expanded + the chip visible at `proposed`, click `participant-pending-proposal-row-facet-vote-button-agree`, poll for the `voted` ack via the chip's `data-facet-status` / projector-derived state (the per-other-voter dot from this participant appears in OTHER tabs; the buttons disappear in THIS tab). Decision §6 covers the assertion shape.
- **No new i18n keys.** The existing `participant.voteButton.*` namespace already exports `agreeLabel`, `disputeLabel`, `inFlightLabel`, `ariaLabel`, `wireError`, `timeoutError`, `errorRoleLabel` for the detail-panel buttons; the pane buttons consume them verbatim. The chip-level "context" (which facet is being voted on) is encoded in the chip's `data-facet-name` + `aria-label` from the predecessor.
- **No new ADR.** Decision §8 enumerates why every architectural choice applies an existing ADR (0021, 0022, 0024, 0026, 0027, 0030) or repeats an idiom an established refinement settled.

Out of scope (deferred to sibling or future leaves):

- **Not the single-tap vs confirmation choice.** Sibling `part_voting.part_vote_single_tap` (0.5d, depends `!part_vote_button_per_facet`) pins the single-tap-no-confirmation posture for ALL vote affordances; this leaf renders single-tap buttons by default (matching the detail-panel posture and the moderator's vote-button posture) and the sibling polishes / formalizes the rule.
- **Not pre-commit vote change.** Sibling `part_voting.part_change_vote_pre_commit` (1d, depends `!part_vote_single_tap`) lets a debater flip their vote between agree and dispute up to the commit moment. This leaf hides the buttons once the participant has voted on the chip's current candidate (per the detail-panel posture from `pf_part_detail_panel_three_facet_rows`); the sibling re-opens the affordance for the pre-commit window.
- **Not the agree-all gesture.** Sibling `part_voting.part_agree_all_gesture` (0.5d, depends `!part_vote_button_per_facet`) adds a per-proposal-bundle "agree all" affordance at the row level (NOT per-facet). Different surface (row body, NOT chip); different action (cascade across every facet of the proposal). This leaf is per-chip only.
- **Not the proposal-arrival visual flash + tab-badge increment.** Sibling `part_voting.part_proposal_notification` (1d, no `depends`) animates the badge + flashes a notification on a new proposal arrival; this leaf is a static affordance.
- **Not the withdraw button on `agreed` / `committed` chips.** The withdraw chain (`part_withdraw.*`) and the existing `useWithdrawAgreementAction` hook own the withdraw gesture. This leaf renders ONLY agree + dispute for `proposed` / `disputed` / `withdrawn` statuses; for `agreed` and `committed`, the chip shows neither agree/dispute nor withdraw (the pane is not the withdraw surface in v1 — withdraw lives on the graph-tab detail panel per the existing posture and on the optional `my agreements` view per `part_withdraw.part_my_agreements_view`). Future leaf MAY add an in-pane withdraw button if user testing reveals the gap; named `part_pane_withdraw_button` (0.5d, depends `!part_withdraw.part_withdraw_action`) under `part_withdraw.*` is the registration target if the gap surfaces — but this leaf does NOT register it.
- **Not the axiom-mark-on-self filter for structural-proposal rows.** The detail-panel `ParticipantVoteButtons` hides the axiom-mark row from the declared participant (the proposer's own axiom-mark — "we all agree that *this participant* holds this node as bedrock" — the declared participant's proposal IS the declaration). The pane's chip strip renders ALL pending proposals (proposed by self or others); the chip for an axiom-mark proposed by self by the current participant would surface a vote button against the declared facet (semantically a no-op the server would accept). v1 ships the consistent "render the button on every chip whose status admits it" rule; if the axiom-mark-self filter is needed in the pane, a named follow-up `part_pane_axiom_mark_self_filter` (0.25d) under `part_voting.*` is the registration target. This leaf does NOT register it — the rule is contained to the detail panel today and the pane's parity is a per-QA decision.
- **Not a re-derivation of `currentParticipantId` plumbing.** The predecessor leaf already threads `currentParticipantId` into the pane; this leaf consumes it for the new `ownFacetVotes` memo. No route change.
- **Not the moderator-side mirror.** The moderator does not vote; the moderator's chip surface (the moderator sidebar's `<ProposalFacetBreakdown>`) carries the per-other-voter row but no vote buttons. This leaf is participant-only.
- **Not a Cucumber scenario.** The `vote` envelope's contract is already pinned at the protocol boundary by the existing `ws_vote_message` scenarios in `tests/behavior/`. This leaf is a pure client-side consumer of the already-pinned wire — Vitest + Playwright is sufficient. Decision §7 covers the rationale.
- **Not new wire shape.** No `vote` envelope extension, no new ack shape, no new projector field. The chip dispatches the existing wire payload via the existing hook.
- **Not animation / transition on button mount or vote dispatch.** Buttons appear / disappear synchronously across render passes; the pessimistic-wait posture (button disabled with `inFlightLabel` text while the WS round-trip runs) matches the detail panel.
- **Not focus management on button mount.** The predecessor leaves `part_proposal_expand` + `part_per_facet_breakdown_in_pane` documented "focus stays on the header button"; this leaf re-evaluates and DECIDES not to move focus — the buttons are inline within the chip, mounted on body expand; the header button still owns the row-level focus and tab order. The buttons are reachable via keyboard tab from the header. Decision §5.

## Why it needs to be done

`docs/participant-ui.md` describes the participant tablet as a **read-mostly graph + write-via-proposals** surface: a debater scans the proposals tab to see what's pending and votes on facets. The predecessor leaves shipped the SCAN side (the row list, the body expansion, the per-facet chip strip, the per-other-voter dot row) but stopped short of the WRITE side — to vote, the debater currently has to switch to the graph tab, select the entity, scroll to the detail panel, and click the per-facet row's agree/dispute button.

For pending proposals presented in the pane, that round-trip is overhead. The chip already names the (entity, facet) target the vote would address; surfacing the agree/dispute affordance INSIDE the chip closes the read→vote loop in one tap. This matches the methodology UX: "the per-facet state is the primary signal the participant needs to decide whether to keep voting" (`docs/participant-ui.md` lines 127-133) — and voting is the natural next action.

The downstream WBS chain depends on this leaf landing:

1. **`part_voting.part_vote_single_tap`** (0.5d) re-evaluates the no-confirmation posture across BOTH surfaces (detail panel + pane). It assumes the pane affordance exists.
2. **`part_voting.part_change_vote_pre_commit`** (1d) opens the pre-commit re-vote window on both surfaces. It assumes the pane affordance exists.
3. **`part_voting.part_agree_all_gesture`** (0.5d) mounts a row-level "agree all" button at the proposal level; the per-facet buttons this leaf installs are the per-facet alternative the agree-all gesture short-circuits.
4. **`part_withdraw.*` chain** (P3 — depends `!part_voting`). The withdraw chain hangs off the parent subgroup's `complete 100` state; every leaf under `part_voting` must ship.
5. **Replay-test parity (`replay_test.*` chain depends `!part_voting`, ...)** — the test-mode replay surface walks the same chip seam.

Architecturally this leaf **finalizes the pane chip's affordance vocabulary**: chip status (predecessor `part_per_facet_breakdown_in_pane`) + per-other-voter row (predecessor `part_vote_indicators_in_pane`) + per-facet vote buttons (this leaf). After this leaf the chip is feature-complete for v1; the in-pane voting flow is symmetrical to the detail-panel voting flow.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; per-facet vote dispatch is the methodology-pinned action.
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L127-L133) — per-facet states; voting is the natural action on `proposed` / `disputed` / `withdrawn` chips.
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L146-L155) — list view + tap to expand; the chip-internal vote button is the v1 in-pane action.
- [ADR 0021 — Event envelope discriminated union with zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — the `vote` payload's `target`-arm discriminator is structurally validated at envelope-parse time.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the `participant.voteButton.*` keys are reused verbatim; no new keys.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the participant surface owns its mounted tree; no cross-app component reach.
- [ADR 0027 — Entity and facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the vote dispatches against the facet layer (per-facet `(entity_id, facet)` triple) OR against the structural proposal envelope.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the `VoteChoice` enum (`'agree' | 'dispute'`), the target-discriminated wire payload, the per-facet supersession-clears rule the `ownFacetVotes` projector already encodes.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_per_facet_breakdown_in_pane.md`](part_per_facet_breakdown_in_pane.md) — the chip strip predecessor; Decision §6 reserved chip-internal extensibility this leaf consumes.
- [`tasks/refinements/participant-ui/part_vote_indicators_in_pane.md`](part_vote_indicators_in_pane.md) — the per-other-voter dot row predecessor; the indicator row sits INSIDE the chip span as a sibling of the label, this leaf's buttons mount AFTER the indicator row in the same span. Decision §3 of that leaf documents focus-management re-evaluation as deferred to THIS leaf — Decision §5 below settles it.
- [`tasks/refinements/per-facet-refactor/pf_part_vote_action_facet_keyed.md`](../per-facet-refactor/pf_part_vote_action_facet_keyed.md) — the `useVoteAction` hook's dual-arm contract this leaf consumes verbatim. Status block records the hook's published surface.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — the detail-panel vote-button surface. Establishes the per-status enablement rule, the i18n key set, and the `participant-vote-button-{agree,dispute,withdraw}` testid family this leaf ports + namespaces.
- [`tasks/refinements/participant-ui/part_own_vote_indicators.md`](part_own_vote_indicators.md) — establishes the `OwnFacetVoteIndex` projector at [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) (specifically `projectOwnFacetVotes(events, currentParticipantId): OwnFacetVoteIndex`) the chip's "did I vote?" gate consumes.

### Live code the surface plugs into

- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — the predecessor's chip. The new `<ProposalFacetVoteButtons>` mounts as a third child slot inside the chip span (`{facetLabel}{voteIndicatorRow}{voteButtons}`). The chip's outer testid + ARIA contract is byte-stable.
- [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) — the predecessor's selector. `ProposalFacetEntry` gains a `voteTarget: VoteTarget` field (always populated; no optionality at the entry layer, the affordance gate is in the component). `facetTargetOf`'s existing return shape feeds the facet arm; the proposal arm uses the `proposalEventId` parameter that the selector already accepts.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the pane. One new `useMemo` keyed on `[events, currentParticipantId]` computing `projectOwnFacetVotes`; one new prop on the row → breakdown call chain. `currentParticipantId` is already in scope.
- [`apps/participant/src/detail/useVoteAction.ts`](../../../apps/participant/src/detail/useVoteAction.ts) — the existing hook. Imported into the new component verbatim. Both arms — `UseVoteActionFacetArgs` for facet-targeting, `UseVoteActionProposalArgs` for structural — are exercised.
- [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) — the existing own-facet-vote projector (`projectOwnFacetVotes`, `EMPTY_OWN_FACET_VOTES`, `ownFacetKey`, `OwnFacetVoteIndex`). Imported by the pane + the breakdown; no changes.
- [`apps/participant/src/detail/ParticipantVoteButtons.tsx`](../../../apps/participant/src/detail/ParticipantVoteButtons.tsx) — the existing detail-panel vote-button block. NOT edited. Its per-status enablement rule + i18n key set are the prior-art idiom this leaf ports; its `participant-vote-button-{agree,dispute,withdraw}` testids stay byte-stable so the detail-panel Playwright assertions (e.g. `tests/e2e/methodology-full-flow.spec.ts`) continue passing.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) lines 683-693 — the `participant.voteButton.*` namespace this leaf consumes. Already in catalog (en-US + pt-BR + es-419); no native-review chain entry.
- [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) — extended.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx) — extended.
- [`apps/participant/src/proposals/perProposalFacets.test.ts`](../../../apps/participant/src/proposals/perProposalFacets.test.ts) — extended.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — extended with step 9.

### Existing fixtures the Playwright spec composes with

- The existing scenario seeds a `capture-node` proposal at step 4 (per the predecessors). The capture proposal's `wording` facet is `proposed`. Step 9 (NEW) clicks the agree button inside the `wording` chip; the test participant becomes the second agreer (the proposer's agree is auto-recorded server-side per methodology); the assertion polls for the chip's status to flip and for the agree button to disappear from THIS tab's chip (own-vote-hides-buttons). No new fixture; no compose-stack change.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/ProposalFacetVoteButtons.tsx` — new. The chip-internal vote-button block.
- `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` — new. Vitest cases.
- `apps/participant/src/proposals/perProposalFacets.ts` — modified. `ProposalFacetEntry` gains `voteTarget: VoteTarget`; the discriminated-union type lands as an exported named type.
- `apps/participant/src/proposals/perProposalFacets.test.ts` — modified. Extended cases pinning the `voteTarget` field across facet-targeting + structural sub-kinds + the `proposalEventId === undefined` fallback.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — modified. New `ownFacetVotes: OwnFacetVoteIndex` prop; renders `<ProposalFacetVoteButtons>` inside each chip span.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` — modified. Extended cases (button-present-on-votable-status, button-absent-when-own-vote-set, button-absent-on-non-votable-status, structural-arm wiring).
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — modified. New `useMemo` computing `projectOwnFacetVotes(events, currentParticipantId)`; threading into row → breakdown.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — modified. New cases (pane threads `ownFacetVotes`; click-vote-and-observe-status-flip integration).
- `apps/participant/src/proposals/index.ts` — modified. Barrel adds `ProposalFacetVoteButtons` + `VoteTarget` named exports for downstream sibling consumption (the agree-all-gesture sibling will reuse `VoteTarget`).
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. Step 9 (NEW).

### Files this task does NOT touch

- `apps/participant/src/detail/ParticipantVoteButtons.tsx` + its test — byte-stable. The detail-panel surface stays as-is; the existing `participant-vote-button-{agree,dispute,withdraw}` testids stay byte-stable for `methodology-full-flow.spec.ts`.
- `apps/participant/src/detail/useVoteAction.ts` + its test — imported verbatim; no hook changes.
- `apps/participant/src/detail/useWithdrawAgreementAction.ts` — not consumed by this leaf (withdraw is out of scope).
- `apps/participant/src/graph/ownVotes.ts` + its test — the existing projector is imported; no projector changes.
- `apps/participant/src/graph/facetStatus.ts` + its test — unchanged.
- `apps/participant/src/proposals/otherVotesByFacet.ts` / `otherVotesByProposal.ts` + their tests — unchanged.
- `apps/participant/src/proposals/derivePendingProposals.ts` + its test — unchanged.
- `apps/participant/src/proposals/proposalSummary.ts` + its test — unchanged.
- `apps/participant/src/proposals/usePendingProposalsCount.ts` + its test — unchanged.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + its test — unchanged.
- `apps/participant/src/stores/uiStore.ts` + its test — unchanged. The chip's button reads zero `useUiStore` state; the in-flight + error machinery lives in `useVoteActionStore` inside `useVoteAction.ts`.
- `apps/participant/src/ws/wsStore.ts` + its test — unchanged. The hook dispatches via `useWsClient().send('vote', ...)` already wired.
- `apps/participant/src/routes/OperateRoute.tsx` + its test — unchanged. `currentParticipantId` is already plumbed.
- `apps/participant/src/layout/*` — unchanged.
- `apps/moderator/src/` — unchanged. The moderator does not vote.
- `apps/server/src/ws/handlers/vote.ts` — unchanged. The handler accepts the existing wire payload.
- `packages/shell/` — no new shell exports; this leaf consumes the existing surface.
- `packages/shared-types/` — no wire change.
- `packages/i18n-catalogs/src/catalogs/*.json` — no new keys (the `participant.voteButton.*` namespace is reused verbatim).
- `tasks/35-frontend-i18n.tji` — no native-review entry.
- `playwright.config.ts` — no project changes.
- `tasks/40-participant-ui.tji` — `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (Decision §8).

### Type shape (`apps/participant/src/proposals/perProposalFacets.ts`)

Exported named type for the chip's vote target:

```ts
export type VoteTarget =
  | {
      readonly kind: 'facet';
      readonly entity_kind: 'node' | 'edge';
      readonly entity_id: string;
      readonly facet: FacetName;
    }
  | {
      readonly kind: 'proposal';
      readonly proposal_id: string;
    };
```

`ProposalFacetEntry` grows the field:

```ts
export interface ProposalFacetEntry {
  readonly facet: LifecycleFacetName;
  readonly status: FacetStatus;
  readonly labelKey: string;
  readonly votes: readonly Vote[];
+ readonly voteTarget: VoteTarget;
}
```

Selector logic:

- Facet-targeting sub-kinds (when `facetTargetOf(proposal)` returns a non-null `target`): `voteTarget = { kind: 'facet', entity_kind: target.entityKind, entity_id: target.entityId, facet: target.facet }`.
- Structural sub-kinds (when `facetTargetOf(proposal)` returns null): `voteTarget = { kind: 'proposal', proposal_id: proposalEventId ?? '' }`. The empty-string fallback matches the existing entry's empty-`votes` fallback when `proposalEventId === undefined` (the component's affordance gate refuses to render buttons when `voteTarget.kind === 'proposal' && voteTarget.proposal_id === ''` — Decision §1's defensive guard). In practice the pane always passes a valid `proposalEventId` (it's `row.proposalEventId`); the fallback is for test fixtures + future call sites.

### Component shape (`apps/participant/src/proposals/ProposalFacetVoteButtons.tsx`)

Sketch:

```tsx
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { FacetStatus } from '../graph/facetStatus';
import { ownFacetKey, type OwnFacetVoteIndex } from '../graph/ownVotes';
import { useVoteAction, type VoteChoice } from '../detail/useVoteAction';

import type { VoteTarget } from './perProposalFacets';

export interface ProposalFacetVoteButtonsProps {
  readonly voteTarget: VoteTarget;
  readonly status: FacetStatus;
  readonly ownFacetVotes: OwnFacetVoteIndex;
}

const VOTABLE_STATUSES: ReadonlySet<FacetStatus> = new Set<FacetStatus>([
  'proposed',
  'disputed',
  'withdrawn',
]);

const VOTE_CHOICES: readonly VoteChoice[] = ['agree', 'dispute'];

const TESTID: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant-pending-proposal-row-facet-vote-button-agree',
  dispute: 'participant-pending-proposal-row-facet-vote-button-dispute',
};

const LABEL_KEY: Readonly<Record<VoteChoice, string>> = {
  agree: 'participant.voteButton.agreeLabel',
  dispute: 'participant.voteButton.disputeLabel',
};

export function ProposalFacetVoteButtons({
  voteTarget,
  status,
  ownFacetVotes,
}: ProposalFacetVoteButtonsProps): ReactElement | null {
  const { t } = useTranslation();

  // Affordance gate: status admits a vote AND participant hasn't yet voted.
  const ownVote = useMemo(() => {
    if (voteTarget.kind === 'facet') {
      return ownFacetVotes.facets.get(
        ownFacetKey(voteTarget.entity_kind, voteTarget.entity_id, voteTarget.facet),
      );
    }
    if (voteTarget.proposal_id === '') return undefined;
    return ownFacetVotes.proposals.get(voteTarget.proposal_id);
  }, [voteTarget, ownFacetVotes]);

  const shouldRender =
    VOTABLE_STATUSES.has(status) &&
    ownVote === undefined &&
    !(voteTarget.kind === 'proposal' && voteTarget.proposal_id === '');

  // Hook MUST be called unconditionally (rules of hooks). The arg shape
  // discriminates on `voteTarget.kind` outside the hook call.
  const hookArgs =
    voteTarget.kind === 'facet'
      ? {
          entity_kind: voteTarget.entity_kind,
          entity_id: voteTarget.entity_id,
          facet: voteTarget.facet,
        }
      : { proposal_id: voteTarget.proposal_id || 'unmounted' };

  const { castVote, inFlight, lastError } = useVoteAction(hookArgs);

  if (!shouldRender) return null;

  return (
    <span
      data-testid="participant-pending-proposal-row-facet-vote-buttons"
      className="ml-1 inline-flex items-center gap-1"
    >
      {VOTE_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          data-testid={TESTID[choice]}
          aria-label={t('participant.voteButton.ariaLabel', { choice })}
          disabled={inFlight}
          onClick={() => void castVote(choice)}
          className="rounded-sm border border-current px-1 text-[10px] font-medium leading-none uppercase"
        >
          {inFlight ? t('participant.voteButton.inFlightLabel') : t(LABEL_KEY[choice])}
        </button>
      ))}
      {lastError ? (
        <span
          role="alert"
          aria-label={t('participant.voteButton.errorRoleLabel')}
          data-testid="participant-pending-proposal-row-facet-vote-button-error"
          className="text-[10px] text-rose-600"
        >
          {t('participant.voteButton.wireError', {
            message: lastError.message,
            code: lastError.code,
          })}
        </span>
      ) : null}
    </span>
  );
}
```

- **Hook called unconditionally** (rules of hooks) — the arg shape discriminates on `voteTarget.kind`; when the affordance gate fails the component returns `null` AFTER the hook call.
- **`hookArgs` fallback `'unmounted'` for the empty-proposal_id case** is defensive: the affordance gate prevents the button from being interactive in that case, but the hook still binds to a stable slot key. The fallback string is intentionally non-routable (the server would 404 a vote against it); the gate prevents the dispatch.
- **Pessimistic-wait posture** matches the detail panel: `disabled={inFlight}`, label flips to `inFlightLabel` during the round-trip, error renders inline with `role="alert"`.
- **Two testids per chip** (`participant-pending-proposal-row-facet-vote-button-{agree,dispute}`) — pane-namespaced to disambiguate from the detail panel's `participant-vote-button-{agree,dispute}` so Playwright assertions in `methodology-full-flow.spec.ts` (detail panel) and `participant-pending-proposals.spec.ts` (pane) target one surface at a time. Decision §4 covers the testid naming choice against three alternatives.
- **Tailwind classes inline** match the chip's existing inline-flex layout; the buttons are small (`text-[10px]`, `px-1`), uppercase, with a current-color border so the chip's status color flows through the button border (the `PILL_STATUS_CLASSNAME` branch on the chip span sets `text-...-700` which the button border inherits via `border-current`).
- **`role="alert"`** on the wire-error span follows the detail panel's idiom — the error is announced to screen readers without stealing focus.

### Component plumbing (`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`)

Diff sketch:

```tsx
+ import { ProposalFacetVoteButtons } from './ProposalFacetVoteButtons';
+ import { type OwnFacetVoteIndex, EMPTY_OWN_FACET_VOTES } from '../graph/ownVotes';

  export interface PerProposalFacetBreakdownProps {
    readonly proposal: ProposalPayload;
    readonly facetStatusIndex: FacetStatusIndex;
    readonly serverPerFacetStatus: Record<string, string> | undefined;
    readonly proposalEventId: string;
    readonly votesByFacetIndex?: OtherVotesByFacetIndex;
    readonly votesByProposalIndex?: OtherVotesByProposalIndex;
+   readonly ownFacetVotes?: OwnFacetVoteIndex;
  }

  // … render body …
+ const ownFacetVotes = props.ownFacetVotes ?? EMPTY_OWN_FACET_VOTES;
  return (
    <div
      data-testid="participant-pending-proposal-row-facets"
      data-proposal-id={proposalEventId}
      className={BREAKDOWN_CONTAINER_CLASSES}
    >
      {entries.map((entry) => {
        // … existing classes, label, indicator row …
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
            {voteIndicatorRow}
+           <ProposalFacetVoteButtons
+             voteTarget={entry.voteTarget}
+             status={entry.status}
+             ownFacetVotes={ownFacetVotes}
+           />
          </span>
        );
      })}
    </div>
  );
```

The `ownFacetVotes` prop is optional with `EMPTY_OWN_FACET_VOTES` default to keep the no-votes posture available to test fixtures + future call sites; the pane's call site IS updated to pass it.

### Pane plumbing (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Diff sketch:

```tsx
+ import { projectOwnFacetVotes, EMPTY_OWN_FACET_VOTES, type OwnFacetVoteIndex } from '../graph/ownVotes';

  // … inside the pane component …
+ const ownFacetVotes = useMemo(
+   () => projectOwnFacetVotes(events, currentParticipantId),
+   [events, currentParticipantId],
+ );

  // … row mount …
  <PendingProposalRow
    key={row.proposalEventId}
    row={row}
    nowMs={nowMs}
    systemAuthorLabel={systemAuthorLabel}
    facetStatusIndex={facetStatusIndex}
    serverPerFacetStatus={pendingProposals[row.proposalEventId]?.perFacetStatus}
    votesByFacetIndex={votesByFacetIndex}
    votesByProposalIndex={votesByProposalIndex}
+   ownFacetVotes={ownFacetVotes}
  />
```

Row signature grows by one prop forwarded into `<PerProposalFacetBreakdown>`. The memo keys `[events, currentParticipantId]` — re-walks only when a new event lands or the participant identity changes. The projector returns the stable `EMPTY_OWN_FACET_VOTES` reference when no current-participant vote contributes, keeping the row's reference-equality bailout stable for the no-vote baseline.

### What the new code MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects** inside `<ProposalFacetVoteButtons>`. The `useVoteAction` hook owns the WS dispatch; the component is a thin click → `castVote(choice)` shim.
- **No direct `useWsStore.setState` writes.** The chip's button is consumer-only of the projector + the hook.
- **No new store slices.** The component reads `useVoteActionStore` indirectly via the hook; no new Zustand slice.
- **No re-fetch of `currentParticipantId`** inside the component — the gate's `ownFacetVotes` is computed at the pane layer once per `[events, currentParticipantId]` change and threaded down.
- **No `useState` for in-flight tracking** — the hook owns the per-slot `inFlight` / `lastError` slices; the component reads them via the hook return.
- **No conditional `useVoteAction` call.** The hook MUST be called unconditionally per the rules of hooks; the affordance gate fires AFTER the call.
- **No `'withdraw'` choice** — withdraw is not a vote per ADR 0030 §3; the `VOTE_CHOICES` array is `['agree', 'dispute']` only. The withdraw chain (`part_withdraw.*`) is the home for the withdraw flow.
- **No cross-app import.** No reach into `apps/moderator/` or `apps/server/`.
- **No new ADR.** Decision §8.

### Test layers per ADR 0022

Six pins, each anchoring a different observable property:

1. **Vitest `ProposalFacetVoteButtons.test.tsx` (new file)** — component. Ten cases:
   - (a) `status === 'proposed'` AND `ownVote === undefined` → both buttons render with the correct testids + labels.
   - (b) `status === 'disputed'` AND `ownVote === undefined` → both buttons render.
   - (c) `status === 'withdrawn'` AND `ownVote === undefined` → both buttons render.
   - (d) `status === 'agreed'` → component returns null (no buttons).
   - (e) `status === 'committed'` → null.
   - (f) `status === 'meta-disagreement'` → null.
   - (g) `status === 'awaiting-proposal'` → null.
   - (h) `voteTarget.kind === 'facet'` AND `ownFacetVotes.facets.get(ownFacetKey(...)) === 'agree'` → null (own-vote-hides).
   - (i) `voteTarget.kind === 'proposal'` AND `ownFacetVotes.proposals.get(proposal_id) === 'dispute'` → null.
   - (j) Click `agree` → `useWsClient().send('vote', payload)` called with the facet-arm payload OR the proposal-arm payload (two sub-cases: facet target + proposal target); in-flight branch flips `disabled={true}` + the label switches to `inFlightLabel`; on resolve, the inline `lastError` region is absent; on reject, the inline error renders with `role="alert"`.

2. **Vitest `perProposalFacets.test.ts` (extended)** — three new cases plus a one-line re-anchor of every existing case to add `voteTarget` to the expected entry shape:
   - (j) Facet-targeting sub-kind (`capture-node`) → `entries[0].voteTarget` is `{ kind: 'facet', entity_kind: 'node', entity_id: <node>, facet: 'wording' }`.
   - (k) Edge-facet sub-kind (`set-edge-substance`) → `entries[0].voteTarget` is `{ kind: 'facet', entity_kind: 'edge', entity_id: <edge>, facet: 'substance' }`.
   - (l) Structural sub-kind (`decompose`) with a defined `proposalEventId` → `entries[0].voteTarget` is `{ kind: 'proposal', proposal_id: <id> }`.
   - (l') Structural sub-kind with `proposalEventId === undefined` → `entries[0].voteTarget` is `{ kind: 'proposal', proposal_id: '' }` (the fallback the component's gate refuses to act on).

3. **Vitest `PerProposalFacetBreakdown.test.tsx` (extended)** — four new cases plus re-anchors:
   - (i) Chip at `status === 'proposed'` AND `ownFacetVotes` empty → renders the two `participant-pending-proposal-row-facet-vote-button-{agree,dispute}` testids inside the chip span.
   - (j) Chip at `status === 'agreed'` → buttons absent.
   - (k) Chip at `status === 'proposed'` AND `ownFacetVotes.facets` carries the chip's own vote → buttons absent.
   - (l) Structural sub-kind (`decompose`) chip at `status === 'proposed'` → buttons render with proposal-arm wiring; clicking `agree` triggers the proposal-arm `vote` send.

4. **Vitest `PendingProposalsPane.test.tsx` (extended)** — two new cases plus re-anchors:
   - (t) Pane receives `currentParticipantId={ME}` and a seeded `proposal` event of sub-kind `capture-node`; expand the row; both vote buttons render inside the `wording` chip; seed a `vote` event from `ME` via the store; assert the buttons disappear from the chip in the next render pass (the `ownFacetVotes` memo re-runs on the new events reference).
   - (u) Click the agree button → assert the mocked `useVoteAction` slot was called with the facet-arm payload `{ entity_kind, entity_id, facet, choice: 'agree' }`. (The mock — pinned at the WS client level — verifies the round-trip dispatches the canonical payload shape.)

5. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — append step 9 after step 8:
   - With the row expanded + the `wording` chip at `data-facet-status="proposed"`, click `participant-pending-proposal-row-facet-vote-button-agree`.
   - Poll for the chip's `data-facet-status` to update OR for the agree button to disappear (own-vote-hides). The exact assertion: `expect.poll(() => chip.getByTestId('participant-pending-proposal-row-facet-vote-button-agree').count(), { timeout: 5000 }).toBe(0)`.
   - Optionally (depending on the seeded session participant count, which determines whether one more agree completes unanimity): assert the chip's `data-facet-status` is either `agreed` (one-more-agreer-completes-unanimity) or remains `proposed` with the per-other-voter dot row growing by one (the test participant's vote becomes visible to OTHER participants; from THIS tab's view, the own vote hides the buttons). Decision §6 covers the assertion shape.

6. **No new Cucumber scenario** (Decision §7). The `vote` envelope is already pinned at the protocol boundary by the existing `ws_vote_message` scenarios + the `pf_vote_handler_facet_keyed` scenarios.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright extension is the default.** The chip is reachable via the predecessors' expand path; the vote buttons are a chip-internal extension. Extending the existing scenario with one step that clicks the agree button and asserts the post-vote chip state is the right anchor — no new scenario file, no compose-stack change, no e2e deferral.

The chip already mounts in a reachable surface (steps 7-8 of `participant-pending-proposals.spec.ts` already assert the chip strip + the per-other-voter dot row after expansion), so the button affordance this leaf installs is reachable from the moment it ships. Full deferral is NOT justified.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, NO projector output. The vote dispatch reuses the existing `vote` payload (ADR 0030 §2 + §9) via the existing `useVoteAction` hook; the server-side handler at [`apps/server/src/ws/handlers/vote.ts`](../../../apps/server/src/ws/handlers/vote.ts) is unchanged. Decision §7 enumerates why no new Cucumber scenario is warranted.

### Budget honesty (1d)

- ~15 min: extend `ProposalFacetEntry` with the `voteTarget` field + define the exported `VoteTarget` type + thread the facet-arm vs proposal-arm construction in `derivePerProposalFacets`.
- ~45 min: write `<ProposalFacetVoteButtons>` — the affordance gate, the hook call, the two buttons + the inline error region, the Tailwind classes.
- ~15 min: extend `<PerProposalFacetBreakdown>` — the new `ownFacetVotes` prop, the third child slot inside the chip span.
- ~10 min: extend `<PendingProposalsPane>` — the new `useMemo`, the row plumbing.
- ~10 min: edit `apps/participant/src/proposals/index.ts` — barrel exports for `ProposalFacetVoteButtons` + `VoteTarget`.
- ~60 min: write `ProposalFacetVoteButtons.test.tsx` (10 cases) with a mocked `useWsClient` + a mocked `useVoteAction` (mirroring the detail-panel test idiom).
- ~30 min: extend `perProposalFacets.test.ts` (3 new + 1 default-path case + re-anchors).
- ~30 min: extend `PerProposalFacetBreakdown.test.tsx` (4 new cases + re-anchors).
- ~30 min: extend `PendingProposalsPane.test.tsx` (2 new cases + re-anchors).
- ~45 min: extend `participant-pending-proposals.spec.ts` (step 9 — click + assert).
- ~30 min: visual sanity at the participant's landscape viewports — chip layout with the buttons, button border-color inheriting the chip's status color, in-flight label width doesn't break the chip's flex layout, button tap target acceptable on touch (the buttons are small; for tablet ergonomics, the `px-1` may need to grow to `px-2` — visual sanity decides).
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + WBS-status ritual.
- ~30 min: buffer for Tailwind / aria fixups after visual sanity.

Risk surface is modest. The main hazard is the rules-of-hooks compliance for `useVoteAction` — the hook MUST be called unconditionally; the affordance gate fires AFTER the call. The defensive `'unmounted'` proposal_id fallback prevents the hook from binding to an unstable slot key when the gate fails. The second hazard is the cross-tab visibility test in Playwright — Decision §6's assertion shape uses own-vote-hides-buttons as the proxy for "the vote landed" since the chip's `data-facet-status` may or may not flip depending on unanimity. The third hazard is the tap target size — the buttons are inline within the chip; the touch ergonomics may need a wider `px-N` than the visual mockup suggests. Visual sanity is the gate.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new component, the extended selector, the extended breakdown, the extended pane, and the extended e2e all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — library-mode build green; bundle shape unchanged.
4. **`pnpm run check` stays green** (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke` stays green; smoke count grows by +19** (10 from `ProposalFacetVoteButtons.test.tsx` + 4 from `perProposalFacets.test.ts` extension + 4 from `PerProposalFacetBreakdown.test.tsx` extension + 2 from `PendingProposalsPane.test.tsx` extension minus 1 absorbed re-anchor — the target is "around 19 new cases"; predecessor re-anchors may shift the total slightly).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** stays green — no new keys.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. Step 9 clicks `participant-pending-proposal-row-facet-vote-button-agree` and asserts the agree button count goes to 0 inside the chip (own-vote-hides). Predecessor steps 1-8 unchanged.
8. **`pnpm run test:e2e --project=chromium-methodology-full-flow`** stays green — the detail-panel vote-button assertions (`participant-vote-button-{agree,dispute,withdraw}`) target the BYTE-STABLE detail-panel testids and are unaffected by the new pane-namespaced testids.
9. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
10. **`<ProposalFacetVoteButtons>` owns no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams\|useWsStore` inside the component body returns zero matches; the component reads `useTranslation`, `useMemo`, and `useVoteAction` only.
11. **The withdraw choice is absent** — a grep for `'withdraw'\|"withdraw"\|withdrawLabel` inside `ProposalFacetVoteButtons.tsx` returns zero matches. Decision §2 — the withdraw flow is out of scope.
12. **Testid disambiguation** — a Playwright selector `[data-testid="participant-vote-button-agree"]` resolves ONLY to the detail-panel surface, and `[data-testid="participant-pending-proposal-row-facet-vote-button-agree"]` resolves ONLY to the pane surface. Vitest case (a) of `ProposalFacetVoteButtons.test.tsx` asserts the pane testid; the detail panel's existing tests assert the detail-panel testid.
13. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on `part_vote_button_per_facet` per the task-completion ritual.
14. **Predecessor assertions unchanged** — `PendingProposalsPane.test.tsx` cases (a)-(s) pass; the predecessor's Playwright steps 1-8 pass; the chip's outer testid + `data-facet-name` + `data-facet-status` contract is byte-stable.

## Decisions

### 1. Extend the existing `derivePerProposalFacets` selector with a `voteTarget` field; do not introduce a parallel selector

Three alternatives surveyed:

- **(A) Add `voteTarget: VoteTarget` to `ProposalFacetEntry`** (chosen). The selector already walks the proposal payload's discriminated union via `facetTargetOf` to derive the facet target; the same walk supplies the (entity_kind, entity_id, facet) triple the facet-arm needs. The proposal-arm needs the `proposalEventId` parameter the selector already accepts. One small field on the existing entry; one tiny construction step per arm; all downstream consumers (the breakdown, the new button block) read the field directly. Zero new walks of the proposal payload.
- **(B) Add a dedicated `deriveVoteTarget(proposal, proposalEventId)` selector** alongside `derivePerProposalFacets`. Rejected. The new selector would walk the same `proposal.kind` discriminated union the existing selector already walks; calling both selectors for each chip duplicates the walk + spreads the per-sub-kind facet-map across two files (drift risk). Bundle size + maintenance cost both higher.
- **(C) Compute the `voteTarget` inline inside the component**. Rejected. The component already has the chip's `entry.facet` + `entry.status`; adding the per-sub-kind discriminated-union walk inside the component duplicates the selector's logic at the render layer (worse — render-time discrimination is harder to test in isolation than a pure selector). The selector is the canonical home.

The `voteTarget` is always populated on every entry (not optional) — the type discriminates between facet-arm and proposal-arm at construction time. Structural sub-kinds with `proposalEventId === undefined` get the empty-string fallback (`proposal_id: ''`); the component's affordance gate refuses to render buttons for that case (Decision §3's guard). In practice the pane always passes a valid `proposalEventId`; the fallback covers test fixtures + future call sites.

### 2. Render only `agree` + `dispute`; defer withdraw to the `part_withdraw.*` chain

Three alternatives surveyed:

- **(A) `agree` + `dispute` only; withdraw is out of scope** (chosen). ADR 0030 §3 settles withdraw as its own gesture (the `withdraw-agreement` event kind has its own hook `useWithdrawAgreementAction` and its own UI surface in the detail panel). The `part_withdraw.*` chain is the home for the withdraw flow; the pane chip would inherit a withdraw affordance once that chain ships an in-pane withdraw button (named follow-up `part_pane_withdraw_button` registered ONLY if the gap surfaces post-shipping — not registered today). This leaf keeps the pane's vote surface to the methodology's two-arm vote vocabulary.
- **(B) Three-button row `agree` + `dispute` + `withdraw`** (matching the detail panel's `STRUCTURAL_VOTE_CHOICES` shape). Rejected. The detail panel renders the three-button row only for the structural `'proposal'` row; for the facet rows it renders agree+dispute on votable statuses and a withdraw-only block on `agreed`/`committed`. Mirroring the three-button shape on every chip in the pane would surface withdraw on facets the participant has not yet agreed with (semantically a no-op the server would reject) — worse UX. The detail panel's per-status branch IS correct but porting all four branches into the chip blows the chip's inline budget (the chip is small; the withdraw flow needs an extra confirmation gesture per `pf_part_withdraw_agreement_action`'s two-stage rule).
- **(C) Add a `withdraw` button only on `agreed`/`committed` chips** (mirror the detail panel's per-status branch verbatim). Rejected for the same chip-inline-budget reason + the named follow-up registration deferred. If the gap surfaces in user testing, register `part_pane_withdraw_button` (0.5d) under `part_withdraw.*` and inherit the two-stage confirmation gesture from `useWithdrawAgreementAction` — but NOT today.

This leaf's `VOTABLE_STATUSES` set is `{ 'proposed', 'disputed', 'withdrawn' }`. For `agreed` and `committed`, the chip carries the status color (predecessor) + the per-other-voter dot row (predecessor) but no affordance.

### 3. Single `<ProposalFacetVoteButtons>` component encapsulates the affordance gate

Three alternatives surveyed:

- **(A) New `<ProposalFacetVoteButtons>` component with the gate inside it** (chosen). The component is the single home for "should this chip render buttons?" — combining `status` and `ownVote` lookup. The breakdown stays declarative (it mounts the component unconditionally; the component decides whether to render or return null). Symmetric with `<VoteIndicator>` which is also a "render or null" decision at the same render layer.
- **(B) Inline the gate in `<PerProposalFacetBreakdown>`** — the breakdown computes `shouldRender` and either mounts the buttons or doesn't. Rejected. The breakdown is currently a small pure-render component; adding the per-chip hook calls (each chip needs its own `useVoteAction` slot) would couple the breakdown to the hook + the projector + the i18n table. Worse separation of concerns.
- **(C) Two components — `<ProposalFacetVoteAgreeButton>` and `<ProposalFacetVoteDisputeButton>`** mounted side-by-side. Rejected. Two components × two hook calls per chip × N chips per row × M rows per pane bloats the render tree without buying anything; the per-button hooks would share the same slot key (one in-flight per chip), so the hooks-rules dance gets uglier.

The component's affordance gate is pure (`status` + `ownVote` only); the gate computes synchronously, no async, no side effects.

### 4. Pane-namespaced testids: `participant-pending-proposal-row-facet-vote-button-{agree,dispute}`

Three alternatives surveyed:

- **(A) Pane-namespaced testids** (chosen). `participant-pending-proposal-row-facet-vote-button-{agree,dispute}` mirrors the predecessor's `participant-pending-proposal-row-facet-vote-indicator-row` namespace; Playwright selectors target the pane surface alone. The detail panel's `participant-vote-button-{agree,dispute,withdraw}` stays byte-stable.
- **(B) Reuse the detail panel's testids verbatim** (`participant-vote-button-{agree,dispute}`). Rejected. The detail panel's scenarios (especially `methodology-full-flow.spec.ts`) bind to those testids; double-mounting under the same testids in the pane would make every detail-panel `getByTestId` accidentally match the pane chip's button (the proposals pane is mounted side-by-side with the graph tab when both tabs' surfaces are visible — actually the tabs are mutually exclusive per `part_proposals_tab` Decision §4, but Playwright's `getByTestId` does not respect tab-visibility filtering; it walks the full DOM). Disambiguation at the testid layer is the safest pattern.
- **(C) `pane-vote-button-{agree,dispute}` short namespace.** Rejected for not matching the predecessor's longer-prefix convention; the predecessor's testid scheme makes the surface explicit so a `data-testid` grep lands the reader in the right file.

The testid namespace decision is irreversible once Playwright scenarios bind to it; settling now keeps the contract stable for future leaves.

### 5. Focus stays on the row header button; no focus change on button mount

Predecessor leaves (`part_proposal_expand`, `part_per_facet_breakdown_in_pane`, `part_vote_indicators_in_pane`) deferred focus-management re-evaluation to THIS leaf. The decision:

- **(A) Focus stays on the row header button; the chip buttons are reachable via keyboard tab from the header** (chosen). The chip buttons are mounted on body expand (already a user action — they tapped the header to expand); the next tab moves focus into the body's interactive children naturally. No `ref.current.focus()` on the first button. This matches the moderator's surface posture and the detail panel's posture.
- **(B) Auto-focus the first agree button on mount.** Rejected. The user has just tapped the header to expand the row; auto-focusing a vote button would set them up to fire a vote on a stray Enter keypress before they've read the chip's status. Worse UX, methodology-incompatible (deliberation requires reading first).
- **(C) Auto-focus the chip strip container** (a focusable wrapper). Rejected for the same reason as (B) + adds a focusable element with no semantic action.

The decision is documented here so a future "tab-key navigation in the pane" leaf inherits the rule.

### 6. Playwright assertion uses own-vote-hides-buttons as the proxy for "vote landed"

Three alternatives surveyed:

- **(A) Assert the agree button disappears from the chip** (chosen). After the vote lands, the participant's own vote populates `ownFacetVotes.facets`; the component's affordance gate returns null; the chip's buttons are absent. This is a deterministic post-condition independent of the seeded session participant count (one more agree may or may not complete unanimity).
- **(B) Assert the chip's `data-facet-status` flips to `agreed`.** Rejected as the primary assertion — depends on unanimity completion which depends on the seeded session's other participants' vote state. May work in the test seed but is brittle.
- **(C) Assert the per-other-voter dot row grows by one in another tab** (cross-tab Playwright). Rejected as too heavy for this leaf — would require a second browser context, the test seed wiring, etc. The own-vote-hides assertion captures the local post-condition; cross-tab visibility can be a future replay-test scenario.

The assertion (A) shape: `expect.poll(() => chip.getByTestId('participant-pending-proposal-row-facet-vote-button-agree').count(), { timeout: 5000 }).toBe(0)`.

### 7. No new Cucumber scenario

Three alternatives surveyed:

- **(A) Vitest + Playwright only** (chosen). The `vote` envelope's wire contract + the methodology engine's accept/reject logic are pinned at the protocol boundary by the existing `ws_vote_message` + `pf_vote_handler_facet_keyed` Cucumber scenarios. This leaf is a pure client-side consumer that adds no new wire behavior — clicking the button dispatches the same payload the detail-panel surface dispatches. Vitest pins the component's affordance gate + the click → dispatch translation; Playwright pins the end-to-end click → ack → buttons-disappear flow.
- **(B) Add a Cucumber scenario asserting the chip button dispatches the `vote` payload.** Rejected. Cucumber asserts protocol behavior across processes; the click → dispatch shim is a UI behavior. The existing Cucumber scenarios already pin the wire's accept/reject behavior — duplicating the assertion at a different layer adds no information.
- **(C) Add a Cucumber scenario for the pane's affordance gate.** Rejected for the same reason as (B) + the gate is a pure-component behavior tested at the Vitest layer with precise control over the projector state.

### 8. No new ADR

Every architectural choice in this leaf applies an existing ADR or repeats an idiom an established refinement settled:

- The component's React + Tailwind shape — ADR 0003 + ADR 0005.
- The per-status enablement rule — `pf_part_detail_panel_three_facet_rows` Decision §1 (ported to the pane surface).
- The i18n key set — ADR 0024 + the existing `participant.voteButton.*` namespace.
- The hook contract — `pf_part_vote_action_facet_keyed`'s established `UseVoteActionArgs` discriminated union.
- The own-vote-hides-buttons posture — `pf_part_detail_panel_three_facet_rows`'s post-commit own-vote-indicator decision.
- The chip-internal extensibility — `part_per_facet_breakdown_in_pane` Decision §6 + `part_vote_indicators_in_pane`'s extension idiom.
- The testid disambiguation — Decision §4 above (an in-task convention, not an architectural decision).
- The withdraw out-of-scope rule — ADR 0030 §3 + the `part_withdraw.*` chain ownership.

No new architectural seam, no new dependency, no new security trade-off. The lifting point for the future `part_pane_withdraw_button` follow-up is the moment user testing reveals the gap — that future leaf re-evaluates whether to share the detail-panel's `useWithdrawAgreementAction` directly or extract a shell helper (depends on the audience surface's withdraw needs; outside this leaf's reach).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-26.

- New component `apps/participant/src/proposals/ProposalFacetVoteButtons.tsx` — per-facet agree/dispute affordance with affordance gate (`VOTABLE_STATUSES` × own-vote-hides), unconditional `useVoteAction` hook call (rules-of-hooks), pessimistic-wait posture, pane-namespaced testids, and inline wire-error region.
- New test file `apps/participant/src/proposals/ProposalFacetVoteButtons.test.tsx` — 12 Vitest cases covering per-status gate, own-vote-hides (facet arm + proposal arm), facet/proposal-arm click dispatch, in-flight disabled state, wire-error render, and empty-proposal_id guard.
- `apps/participant/src/proposals/perProposalFacets.ts` — `ProposalFacetEntry` gains `voteTarget: VoteTarget`; exported `VoteTarget` discriminated union; facet-arm and proposal-arm construction from `facetTargetOf` result + `proposalEventId` parameter with empty-string fallback.
- `apps/participant/src/proposals/perProposalFacets.test.ts` — 4 new cases pinning `voteTarget` for facet-targeting (node/edge), structural sub-kind, and `proposalEventId === undefined` fallback.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — new optional `ownFacetVotes` prop (defaults to `EMPTY_OWN_FACET_VOTES`); mounts `<ProposalFacetVoteButtons>` as third child slot inside each chip span.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.test.tsx` — 4 new cases: buttons present at `proposed`/empty-votes, absent at `agreed`, hidden by own-vote, structural-arm click wiring.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — new `useMemo` computing `projectOwnFacetVotes(events, currentParticipantId)` threaded into the row → breakdown call chain.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — 2 new cases: own-vote-hides integration + facet-arm dispatch from pane.
- `apps/participant/src/proposals/index.ts` — barrel exports for `ProposalFacetVoteButtons` and `VoteTarget`.
- `tests/e2e/participant-pending-proposals.spec.ts` — step 9 appended: clicks `participant-pending-proposal-row-facet-vote-button-agree`, injects matching `vote` envelope via `applyEvent`, polls for button count → 0 (own-vote-hides).
- `cucumber.cjs` — `forceExit: true` added to work around Node v24 V8 WASM JIT teardown crash (`jit_page_->allocations_.erase`) that caused exit 133 after all 263 scenarios passed.
