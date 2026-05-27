# "My agreements" history view — a read-only retrospective audit pane

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_withdraw.part_my_agreements_view` (lines 296-299, declared **Optional** by the WBS author).
**Effort estimate**: 1d.
**Inherited dependencies**:

- `!participant_ui.part_voting` (parent edge, settled via the per-facet refactor chain — every leaf under `part_voting.*` shipped through the per-facet refactor including `part_proposal_notification` at commit `38bf660`).
- `!data_and_methodology.methodology_engine.withdrawal_logic` (settled at 2026-05-10 per [`tasks/refinements/data-and-methodology/withdrawal_logic.md` line 113](../data-and-methodology/withdrawal_logic.md#L113); the projection rule "an `agreed` facet may flip back to `disputed` via `withdraw-agreement`" is what makes the my-agreements view's per-row status column non-trivial — rows can show `agreed` / `committed` / `withdrawn` / `disputed` depending on the post-walk facet state).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_withdraw.part_find_agreed_facet` (settled 2026-05-26 — closed as superseded by ADR 0030 + per-facet refactor chain). Decision §3 of that refinement explicitly preserves `part_my_agreements_view` as **independently scoped** (a distinct *retrospective audit* surface, not a find-for-withdraw affordance), with the framing: *"the history view is a retrospective audit surface — a chronologically-ordered list of 'all facets I've agreed to and their current status, including those since committed or since withdrawn.' Useful for end-of-session review, not for the in-flow find-then-withdraw gesture."* This refinement honors that framing — Decision §3 below pins read-only audit semantics (no inline withdraw button; the detail panel remains the canonical withdraw surface per ADR 0030 + `pf_part_withdraw_agreement_action`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_pending_proposals.part_proposal_list_view` (settled 2026-05-25 per [`tasks/refinements/participant-ui/part_proposal_list_view.md`](part_proposal_list_view.md)). The proposals-pane pattern (pure selector `derivePendingProposals(events)` + co-located `<PendingProposalRow>` + barrel exports in `apps/participant/src/proposals/index.ts` + event-log-as-source-of-truth) IS the precedent this leaf mirrors. Decision §1 below adopts the same shape.
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_proposals_tab` (settled — `<PendingProposalsTabBar>` ships the tab-strip shell that this leaf extends with a third tab; the `ParticipantTab` literal union at [`apps/participant/src/stores/uiStore.ts:19`](../../../apps/participant/src/stores/uiStore.ts#L19) explicitly reserves room for "future tabs (e.g. a my-agreements view) add as literal members here" — Decision §4 cashes that reservation).
- Prose-only context (NOT a `.tji` edge): [ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) (accepted 2026-05-23 — per-facet vote keying + sequential-capture; the `withdraw-agreement` event kind that the selector consumes; the per-facet status enum (`agreed` / `committed` / `withdrawn` / etc.) that the row's status badge reads off).

## What this task is

Add a new top-of-main tab — **"My agreements"** — to the participant tablet. The tab renders `<MyAgreementsPane>`, a read-only chronologically-ordered list of `(entity, facet)` pairs the current participant has voted `agree` on, with a per-row status badge reflecting the facet's *current* status (`agreed` / `committed` / `withdrawn` / `disputed`). Each row is tappable: tapping navigates the user to the entity in the graph view (sets selection + switches back to the graph tab so the detail panel surfaces the per-facet rows, where the canonical withdraw affordance lives).

After this leaf:

- A new pure selector `derivePersonalAgreements(events, currentParticipantId, facetStatusIndex)` under [`apps/participant/src/proposals/derivePersonalAgreements.ts`](../../../apps/participant/src/proposals/derivePersonalAgreements.ts) walks the event log once and returns `readonly PersonalAgreementRow[]` newest-first by `vote` event sequence. Each row carries: `voteEventId`, `agreedAtSequence`, `agreedAtCreatedAt`, `entityKind`, `entityId`, `facet`, `candidateValue` (the value the participant voted agree on, sourced from the proposal payload), and `currentStatus` (the facet's status as of the end of the walk, read off the supplied `facetStatusIndex`). Filtering rules: include rows whose `currentStatus` ∈ {`'agreed'`, `'committed'`, `'withdrawn'`, `'disputed'`}; exclude `'proposed'` (the proposal is still in-flight — vote isn't a settled agreement yet) and `'meta-disagreement'` / `'awaiting-proposal'` (those statuses don't represent any prior agreement). Decision §2 enumerates the filter rationale.
- A new `<MyAgreementsPane>` component under [`apps/participant/src/proposals/MyAgreementsPane.tsx`](../../../apps/participant/src/proposals/MyAgreementsPane.tsx) (alongside the predecessor's `<PendingProposalsPane>`). The pane subscribes to `useWsStore.sessionState[sessionId]?.events`, recomputes rows via `useMemo` keyed on the events reference + the supplied `facetStatusIndex` + `currentParticipantId`, renders an empty-state branch when rows are empty, otherwise renders a `<ul>` of `<MyAgreementsRow>`s. Co-located `<MyAgreementsRow>` (same idiom as `<PendingProposalRow>`) renders each row as a `<button type="button">` with cells: status badge + entity-name snippet + facet kind + candidate value + relative-time stamp. Tapping the row sets selection + switches tab.
- The tab strip extends. [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) gains a third `<TabButton tab="my-agreements">` between the existing graph + proposals tabs. The button label uses a new i18n key `participant.proposalsTab.myAgreementsLabel`; no count badge on this tab (Decision §5). The `ParticipantTab` literal union at [`uiStore.ts:19`](../../../apps/participant/src/stores/uiStore.ts#L19) extends to `'graph' | 'proposals' | 'my-agreements'`. The component file keeps its `PendingProposalsTabBar` name in v1 — Decision §6 explains why a rename is intentionally deferred to a follow-up.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx#L346-L386) (lines 346-386) extends its tab-conditional render from a binary `currentTab === 'graph' ? graph : proposals` ternary into a three-arm `switch` (or equivalent) that mounts `<MyAgreementsPane>` when `currentTab === 'my-agreements'`. The projection chain at the route is unchanged — `<MyAgreementsPane>` consumes `events` (via `useWsStore`) + `facetStatusIndex` (via props, sourced from the same `computeFacetStatuses` memo the graph + detail panel already share) + `currentParticipantId` (via props). The pane reuses the route's already-paid-per-frame projection cost; no new projector invocation lands.
- Tap-to-navigate. The row's `onClick` calls `useSelectionStore.setState({ selection: {kind: entityKind, id: entityId} })` then `useUiStore.setState({ currentTab: 'graph' })`. The graph view's existing selection-driven detail-panel mount surfaces the entity at frame one of the user's next render. The selection sentinel for a `'meta-edge'` is currently absent from the selection-store schema; this pane targets only `node` + `edge` entities (the only two entity-kind values the `PersonalAgreementRow.entityKind` field carries), so the existing schema covers it.
- Four new i18n keys land in en-US + pt-BR + es-419 catalogs: `participant.proposalsTab.myAgreementsLabel` (the tab-button label, e.g. "My agreements"), `participant.myAgreementsPane.paneAriaLabel` (the `<section>` accessible name), `participant.myAgreementsPane.emptyState` (the empty-branch body text, e.g. "You haven't agreed to any facets yet."), and `participant.myAgreementsPane.facetLabel.{wording,classification,substance,shape}` (the four facet-kind labels — wait, these may already exist; see Decision §7 for the catalog-reuse audit). pt-BR + es-419 drafts are flagged PENDING in `*.review.json`; a native-review chain leaf is registered in `tasks/35-frontend-i18n.tji`.
- Status-badge styling reuses the existing per-facet-status palette established by `pf_part_detail_panel_three_facet_rows` (the same `agreed` / `committed` / `withdrawn` / `disputed` color treatment the detail panel uses for its facet-status pills). The pane imports a small `<FacetStatusBadge>` shared component if one exists, or duplicates the inline-class palette (~8 lines) if it doesn't — Decision §7 documents the audit.
- Test layers per ADR 0022: a Vitest unit suite for `derivePersonalAgreements` (10 cases — empty log, single agree-then-committed, agree-then-withdrawn, agree-then-back-to-disputed via meta-disagreement, agree by other participant filtered out, agree on still-`proposed` facet filtered out, multiple agrees newest-first, agree across all four facet kinds, `withdraw-agreement` event by this participant transitions a prior agree's row to `withdrawn`, structural-arm vote without `(entity, facet)` target filtered out), a Vitest component suite for `<MyAgreementsPane>` (7 cases — empty state, single row visible, multiple rows newest-first, status-badge text per status, tap-row → selection + tab change, row's `data-vote-event-id` matches the event, row's testid contract). The existing `PendingProposalsTabBar.test.tsx` gains 2 new cases (third tab visible + clicking it sets `currentTab` to `'my-agreements'`). A new Playwright spec `tests/e2e/participant-my-agreements.spec.ts` exercises the full flow (login → join → operate → switch to my-agreements tab → seed `proposal` + `vote agree` + `commit` events → assert one row visible with `agreed` or `committed` status badge → tap row → assert graph tab is active + entity is selected + detail panel is visible).

Out of scope (deferred to sibling or future leaves):

- **Not a withdraw affordance on rows.** The detail panel is the canonical withdraw surface per ADR 0030 + `pf_part_withdraw_agreement_action`; the my-agreements rows are read-only audit. Decision §3 covers this in detail.
- **Not a count badge on the my-agreements tab.** The proposals tab badge counts pending proposals (work-to-do); a my-agreements badge would count cumulative history with no actionable signal. Decision §5 explains the omission.
- **Not a filter / search / sort affordance.** v1 ships the unfiltered newest-first list. Future affordances (filter by status, search by entity name, sort by timestamp asc/desc) are deferred to a named follow-up (Decision §8).
- **Not an export / save-history affordance.** No CSV / JSON download, no "share my agreements" button. v1 is an in-app surface only.
- **Not a rename of `PendingProposalsTabBar.tsx`.** The component now hosts three tabs (graph + proposals + my-agreements), making its name a misnomer. The rename is registered as tech-debt (Decision §6 + Decision §8) — out of scope here to keep the leaf focused.
- **Not a new ADR.** ADR 0030 already settled the per-facet vote keying + status enum + withdraw-agreement event kind; this leaf consumes existing seams. Decision §10 enumerates why no architectural seam crosses the threshold.
- **Not a Cucumber scenario.** The read path is event-log + client-local pure function; no wire shape, no broadcast envelope, no projector output changes. Decision §9 explains.
- **Not a virtualization concern.** A session realistically produces tens of personal agreements at peak (a debater agreeing to several facets per node × dozens of nodes); plain `<ul>` rendering is fine. If a future scale concern surfaces, the moderator's same-pattern panes can be virtualized together.
- **Not shell extraction of the selector.** Single consumer in v1 (the participant pane); the moderator surface has no parallel "my agreements" pane (the moderator audits per-participant via different scopes). Decision §1 documents the trigger.
- **Not a per-participant-axis decoration on the graph canvas.** A "highlight all my agreed facets" overlay on the graph would duplicate the per-facet status colors that already paint `agreed` / `committed` facets via `<FacetPill>` (per `part_per_facet_state_styling`). The my-agreements pane is the list-view affordance; the graph canvas keeps its existing per-facet status painting.

## Why it needs to be done

The orchestrator's pick-task pass selected this leaf — it is the next available task under the participant-UI work-stream. The leaf is declared **Optional** in the WBS, and the prior `part_find_agreed_facet` refinement explicitly preserved it as such with the note "may genuinely ship later as a separate read-only audit affordance, or may stay deferred indefinitely." The refinement-writer pass must therefore either (a) scope a buildable implementation or (b) close as deferred. Decision §1 lays out the choice: scope the implementation. The optional marker means "v1 doesn't require this for the withdraw flow to work" — which is true (the detail panel ships the find-then-withdraw flow) — NOT "this feature has no user value." The retrospective audit surface IS valuable for end-of-session review, and the 1d budget is small enough that the implementation cost is bounded.

The downstream chain:

1. **`part_withdraw` parent rollup.** With the three prior `part_withdraw.*` leaves all closed (superseded or completed via per-facet refactor — `part_find_agreed_facet` 2026-05-26, `part_withdraw_dialog` 2026-05-26, `part_withdraw_action` 2026-05-26), this is the last remaining leaf under the parent. Shipping this leaf with `complete 100` clears the parent's `complete 100` gate.
2. **`part_tests` depends on `!part_withdraw`** ([`tasks/40-participant-ui.tji` line 367](../../40-participant-ui.tji#L367)). Closing the withdraw parent unblocks the participant-tests roll-up leaf's scheduling.
3. **Milestone propagation.** The P3 withdraw flow contributes to whichever milestone aggregates the participant-UI work (per [`tasks/99-milestones.tji`](../../99-milestones.tji)).
4. **Architectural anchor for future audit surfaces.** The pattern this leaf establishes (per-participant projection from event log into a chronologically-ordered list of facet-status-aware rows) is the natural template for any future "my X" audit surfaces — e.g., "my proposals" (proposals I authored) or "my disputes" (facets I voted dispute on). Naming the selector + row + pane in line with the proposals pattern makes the next audit-surface leaf cheaper.

Architecturally this leaf locks the **per-participant projection seam** in `apps/participant/src/proposals/` (mirroring the proposals selector + summary pattern at one consumer; shell extraction deferred per Decision §1) and the **tap-to-navigate hand-off contract** between the my-agreements pane and the graph view (`useSelectionStore.setState` + `useUiStore.setState` two-step; Decision §4 documents why no router-level state). Both choices apply existing patterns without inventing new seams.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — the canonical evolving design doc.
- [docs/participant-ui.md L93-L101 — P3. Withdraw agreement](../../../docs/participant-ui.md#L93-L101) — the canonical P3 sketch: *"1. Find the facet — either via the graph view (tap the entity, find the facet) or via a 'my agreements' history view."* The "my agreements view" naming originates here. Per the prior `part_find_agreed_facet` refinement, the *find* purpose is now served by the always-on detail panel; the my-agreements surface scoped by this leaf is the **alternate** retrospective-audit affordance the design sketch named.
- [docs/participant-ui.md L42-L45 — Per-facet voting](../../../docs/participant-ui.md#L42-L45) — `agreed` / `committed` status semantics. The status enum the row badge displays.
- [docs/participant-ui.md L127 — Visual state representation](../../../docs/participant-ui.md#L127) — broader history-view context within the participant UX.
- [docs/methodology.md L25](../../../docs/methodology.md#L25) — *"A participant may withdraw agreement they previously gave. An `agreed` facet transitions back to `disputed`."* The post-withdraw status row carries.
- [ADR 0021 — event envelope](../../../docs/adr/0021-event-envelope.md) — the `Event` discriminated union the selector walks.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the new ICU-free keys land per the established workflow.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — surface owns its mounted region.
- [ADR 0030 — per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the per-facet status enum + the dedicated `withdraw-agreement` event kind. §2 (the per-facet vote keying) + §3 (`withdraw-agreement` becomes a first-class event kind) + §10 (always-on per-facet row block on detail panel) are the load-bearing pins for this leaf's read model.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_proposal_list_view.md`](part_proposal_list_view.md) — the closest precedent. Decision §1 (duplicate pure selector + summary into the participant tree; defer shell extraction to third-consumer trigger), Decision §2 (event log as row source-of-truth, not the broadcast frame), Decision §4 (file location in `apps/participant/src/proposals/`), and Decision §7 (no new ADR) all apply to this leaf verbatim.
- [`tasks/refinements/participant-ui/part_proposals_tab.md`](part_proposals_tab.md) — the tab-strip shell. Decision §1 (top-of-main tab strip lives in `<PendingProposalsTabBar>`) is the seam this leaf extends with a third tab.
- [`tasks/refinements/participant-ui/part_find_agreed_facet.md`](part_find_agreed_facet.md) — the immediately-prior `part_withdraw.*` leaf. Decision §3 explicitly preserves this leaf as independently scoped: *"the history view UX is a distinct affordance from the find-for-withdraw flow"* + *"the per-facet refactor supersedes only the first. The second remains genuinely Optional — it may be scoped later as a read-only retrospective surface."* This refinement cashes that reservation.
- [`tasks/refinements/per-facet-refactor/pf_part_detail_panel_three_facet_rows.md`](../per-facet-refactor/pf_part_detail_panel_three_facet_rows.md) — the always-on per-facet row block on the detail panel. The withdraw affordance lives there; the my-agreements pane is intentionally NOT a second withdraw surface (Decision §3).
- [`tasks/refinements/per-facet-refactor/pf_part_withdraw_agreement_action.md`](../per-facet-refactor/pf_part_withdraw_agreement_action.md) — the wired withdraw button on `agreed` / `committed` facet rows + the `useWithdrawAgreementAction` hook. The canonical withdraw surface this pane navigates to (via the graph tab + selection-driven detail panel) rather than duplicates.
- [`tasks/refinements/participant-ui/part_pan_zoom_tap.md`](part_pan_zoom_tap.md) — the existing graph-tap → `useSelectionStore.setState` pattern. The my-agreements row tap-to-navigate reuses the same selection-store seam.

### Live code the surface plugs into

- [`apps/participant/src/stores/uiStore.ts:19`](../../../apps/participant/src/stores/uiStore.ts#L19) — `ParticipantTab` literal union. Line 19 explicitly anticipates this leaf: *"future tabs (e.g. a my-agreements view) add as literal members here."* The union becomes `'graph' | 'proposals' | 'my-agreements'`.
- [`apps/participant/src/stores/selectionStore.ts`](../../../apps/participant/src/stores/selectionStore.ts) — the `useSelectionStore` whose `setState` accepts a `{kind: 'node' | 'edge', id: string}` selection target. The row tap action writes here.
- [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) — the tab-strip component. The third `<TabButton>` lands inline between the existing two; the file's `<TabButton>` helper is reusable as-is.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the architectural precedent (event-log selector + co-located row + `useMemo` + `useTranslation` + ARIA contract).
- [`apps/participant/src/proposals/derivePendingProposals.ts`](../../../apps/participant/src/proposals/derivePendingProposals.ts) — the pure-selector pattern this leaf mirrors. The new `derivePersonalAgreements` adopts the same shape (single-pass walk, newest-first by sequence, pure function consuming `readonly Event[]`).
- [`apps/participant/src/proposals/index.ts`](../../../apps/participant/src/proposals/index.ts) — the barrel export. Extended with the new selector + pane + types.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — `computeFacetStatuses(events)` returns the per-facet status index. The selector reads off this projection for the per-row `currentStatus` column.
- [`apps/participant/src/graph/ownVotes.ts`](../../../apps/participant/src/graph/ownVotes.ts) — `projectOwnFacetVotes(events, currentParticipantId)` walks per-participant facet votes. The new `derivePersonalAgreements` is conceptually similar but tracks the *vote-event source* (the `voteEventId` + `agreedAtSequence` + `agreedAtCreatedAt` triple) needed for the chronological history view, which `projectOwnFacetVotes` discards. Decision §1 explains why this leaf writes a fresh selector rather than reusing `projectOwnFacetVotes`.
- [`apps/participant/src/routes/OperateRoute.tsx:346-386`](../../../apps/participant/src/routes/OperateRoute.tsx#L346-L386) — the tab-conditional render. Extended from binary ternary to three-arm conditional (Decision §4).
- [`apps/participant/src/ws/wsStore.ts:78-86`](../../../apps/participant/src/ws/wsStore.ts#L78) — `WsSessionState.events: Event[]` (the event log the pane subscribes to via the same Zustand selector pattern the proposals pane uses).
- [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — the panel whose mount on selection surfaces the always-on per-facet row block + the canonical withdraw button. The my-agreements row's tap action delivers the participant *here* (via selection + tab switch); no duplication of the withdraw affordance.
- [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts) — `Event` discriminated union including the `'vote'` and `'withdraw-agreement'` arms the selector walks.

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `participant.proposalsTab.*` carries `graphLabel` + `proposalsLabel` today. This leaf adds `myAgreementsLabel`. The `participant.myAgreementsPane.*` namespace is new — keys: `paneAriaLabel`, `emptyState`. Facet-kind labels (`participant.detailPanel.facetLabel.{wording,classification,substance,shape}` or equivalent — Decision §7 documents the audit) are reused if present; new keys are registered only for missing ones.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) + [`packages/i18n-catalogs/src/catalogs/es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json) — both gain the same new dotted keys, draft text.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — both gain the new dotted keys flagged PENDING.

### Existing fixtures the new Playwright spec composes with

- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — the closest precedent for the participant operate-route spec shape (login + join + operate route + tab switch + seed event + assert row visible). The new spec mirrors the login + join + operate-route skeleton; the seeded event sequence is different (the my-agreements spec seeds `proposal` + `vote agree` + `commit` to populate one `committed` agreement row).
- [`tests/e2e/helpers/sessionFixtures.ts`](../../../tests/e2e/helpers/sessionFixtures.ts) (if it exists in current form) — any test-fixture helpers for seeding events into the participant store. The spec reuses whatever pattern the proposals spec uses.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/derivePersonalAgreements.ts` — NEW. Pure selector.
- `apps/participant/src/proposals/derivePersonalAgreements.test.ts` — NEW. Vitest cases.
- `apps/participant/src/proposals/MyAgreementsPane.tsx` — NEW. Pane component + co-located `<MyAgreementsRow>`.
- `apps/participant/src/proposals/MyAgreementsPane.test.tsx` — NEW. Vitest cases.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` — modified. Add the third `<TabButton tab="my-agreements">`.
- `apps/participant/src/proposals/PendingProposalsTabBar.test.tsx` — modified. Add the two new cases (third tab visible + click activates it).
- `apps/participant/src/proposals/index.ts` — modified. Barrel exports for the new selector + pane + types.
- `apps/participant/src/stores/uiStore.ts` — modified. Extend `ParticipantTab` literal to `'graph' | 'proposals' | 'my-agreements'`. Drop the stale "future tabs" comment from line 14-17 (or update it to reflect that the future tab is now this leaf's `'my-agreements'`).
- `apps/participant/src/routes/OperateRoute.tsx` — modified. Extend the lines 348-386 tab-conditional from binary ternary to three-arm `switch` (or `if/else if/else`). Mount `<MyAgreementsPane>` when `currentTab === 'my-agreements'`. Pass `facetStatusIndex` + `currentParticipantId` + `sessionId` as props.
- `apps/participant/src/routes/OperateRoute.test.tsx` (if it exists) — modified. Add cases pinning the three-arm conditional (currently 1-2 cases for the binary ternary; extend to cover `my-agreements` arm).
- `tests/e2e/participant-my-agreements.spec.ts` — NEW. Playwright scenario.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. New keys (Decision §7 catalog audit decides exact count, baseline 3 new dotted paths: `participant.proposalsTab.myAgreementsLabel`, `participant.myAgreementsPane.paneAriaLabel`, `participant.myAgreementsPane.emptyState`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. New keys flagged PENDING.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.
- `tasks/35-frontend-i18n.tji` — modified. Register a new `i18n_participant_my_agreements_native_review` leaf chained after the prior native-review tail.

### Files this task does NOT touch

- `apps/participant/src/proposals/derivePendingProposals.ts` + `.test.ts` — the proposals-pane selector stays as-is; the new selector is a separate file.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` + `.test.tsx` — the proposals pane stays as-is.
- `apps/participant/src/proposals/usePendingProposalsCount.ts` — the count selector is unchanged; the my-agreements tab does NOT carry a count badge (Decision §5).
- `apps/participant/src/detail/ParticipantVoteButtons.tsx` + `useWithdrawAgreementAction.ts` — the canonical withdraw surface is unchanged (Decision §3).
- `apps/participant/src/graph/facetStatus.ts` + `ownVotes.ts` + any other projector — the selector consumes their existing output via props; no projector change.
- `apps/participant/src/stores/selectionStore.ts` — the selection store is unchanged; the row tap action calls existing `setState` (no schema change).
- `apps/participant/src/ws/wsStore.ts` — store shape unchanged; consumer-only.
- `apps/participant/src/layout/*` — unchanged.
- `apps/moderator/src/` — moderator surface is untouched.
- `apps/audience/src/` + `apps/server/src/` — out of scope.
- `packages/shell/` + `packages/shared-types/` — no extraction, no envelope change.
- `playwright.config.ts` — no project changes; the new spec lands inside an existing project.
- `tasks/40-participant-ui.tji` — the `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42), driven by the closer.
- `docs/adr/` — no new ADR (Decision §10).
- `docs/participant-ui.md` — already documents the "my agreements" view at L93-L101 + L127; no edit needed.

### Selector shape (`apps/participant/src/proposals/derivePersonalAgreements.ts`)

```ts
import type { Event, ProposalPayload } from '@a-conversa/shared-types';
import type { FacetName, FacetStatus, FacetStatusIndex } from '../graph/facetStatus';

export interface PersonalAgreementRow {
  readonly voteEventId: string;
  readonly agreedAtSequence: number;
  readonly agreedAtCreatedAt: string;
  readonly entityKind: 'node' | 'edge';
  readonly entityId: string;
  readonly facet: FacetName;
  readonly candidateValue: string;
  readonly currentStatus: FacetStatus;
}

export function derivePersonalAgreements(
  events: readonly Event[],
  currentParticipantId: string,
  facetStatusIndex: FacetStatusIndex,
): readonly PersonalAgreementRow[];
```

Walk:

- Single-pass over `events`.
- `proposal` events targeting an `(entityKind, entityId, facet)` triple via the same `voteTargetOf` logic in [`apps/participant/src/graph/ownVotes.ts:108-126`](../../../apps/participant/src/graph/ownVotes.ts#L108-L126) are recorded in a proposal-id → `{target, candidateValue}` map. Structural-arm proposals (no facet target) are skipped.
- `vote` events by the current participant with `choice === 'agree'`:
  - Resolve the `(entityKind, entityId, facet)` triple via the proposal-id map (or directly off the facet-keyed arm per ADR 0030 §2).
  - Capture `candidateValue` from the proposal payload (the value the participant is voting agree on).
  - Record a candidate row keyed by `(entityKind, entityId, facet)`. If a prior agree exists on the same key (e.g., the participant voted agree on an earlier proposal that was committed, then a *new* proposal on the same facet emerged and they voted agree again), the *latest* (highest sequence) agree wins for the row's `voteEventId` + `agreedAtSequence` + `agreedAtCreatedAt` fields. Rationale: the history view shows "your most recent agreement on this facet" — the prior agreement is rolled into the same row, since the facet's *current* status is what matters and historical re-agreements on the same facet would clutter the list.
- `vote` events by the current participant with `choice === 'dispute'` are NOT recorded as their own row, but they DO invalidate any prior `agree` row on the same `(entityKind, entityId, facet)` (the participant changed their mind — they no longer hold an agreement on this facet; remove from the candidate set).
- `withdraw-agreement` events by the current participant: the candidate row for the matching `(entityKind, entityId, facet)` is kept in the result (the history view shows that the participant DID agree, then withdrew — the row's `currentStatus` will reflect `'withdrawn'` because the projector's status walk records the post-withdraw state). The row is NOT dropped from the result.
- Votes by OTHER participants are silently dropped.
- After the walk, the candidate rows are filtered by their `currentStatus` (read off the supplied `facetStatusIndex.get(entityKind === 'node' ? 'nodes' : 'edges').get(entityId)?.[facet]`): keep rows where `currentStatus` ∈ {`'agreed'`, `'committed'`, `'withdrawn'`, `'disputed'`}; drop rows with `currentStatus` ∈ {`'proposed'`, `'meta-disagreement'`, `'awaiting-proposal'`} per Decision §2.
- The result is sorted by `agreedAtSequence` descending (newest first; same convention as `derivePendingProposals`).
- Return `readonly PersonalAgreementRow[]`. The empty result reuses a frozen `EMPTY_PERSONAL_AGREEMENTS` reference for reference-equality bailout (same `EMPTY_*` idiom as `EMPTY_PENDING_PROPOSALS` etc.).

Pure function: no I/O, no `Date.now()`, no random state. Time enters as the supplied `nowMs` to the pane's renderer (for relative-time formatting), not the selector.

### Pane shape (`apps/participant/src/proposals/MyAgreementsPane.tsx`)

```tsx
export interface MyAgreementsPaneProps {
  readonly sessionId: string;
  readonly currentParticipantId: string;
  readonly facetStatusIndex: FacetStatusIndex;
  readonly nowMsOverride?: number;
}

export function MyAgreementsPane({
  sessionId,
  currentParticipantId,
  facetStatusIndex,
  nowMsOverride,
}: MyAgreementsPaneProps): ReactElement {
  const { t } = useTranslation();
  const events = useWsStore((s) => s.sessionState[sessionId]?.events);
  const rows = useMemo(
    () => derivePersonalAgreements(events ?? EMPTY_EVENTS, currentParticipantId, facetStatusIndex),
    [events, currentParticipantId, facetStatusIndex],
  );
  const nowMs = nowMsOverride ?? Date.now();
  const setSelection = useSelectionStore((s) => s.setSelection);
  const setCurrentTab = useUiStore((s) => s.setCurrentTab);
  const onRowTap = useCallback((entityKind, entityId) => {
    setSelection({ kind: entityKind, id: entityId });
    setCurrentTab('graph');
  }, [setSelection, setCurrentTab]);
  return (
    <section
      data-testid="participant-my-agreements-pane"
      role="tabpanel"
      aria-live="polite"
      aria-label={t('participant.myAgreementsPane.paneAriaLabel')}
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {rows.length === 0 ? (
        <div data-testid="participant-my-agreements-pane-empty" className="...">
          {t('participant.myAgreementsPane.emptyState')}
        </div>
      ) : (
        <ul
          data-testid="participant-my-agreements-pane-list"
          role="list"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {rows.map((row) => (
            <MyAgreementsRow key={row.voteEventId} row={row} nowMs={nowMs} onTap={onRowTap} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

- The `useMemo` keyed on `(events, currentParticipantId, facetStatusIndex)` keeps the row list stable across renders that don't change the inputs.
- The `onRowTap` two-step (setSelection + setCurrentTab) is the navigation hand-off; same pattern as any future "go to entity X" action.
- The pane subscribes to the events array via the same Zustand selector idiom as `<PendingProposalsPane>` (reference-equality bailout).

### Row shape (co-located `<MyAgreementsRow>` inside `MyAgreementsPane.tsx`)

```tsx
function MyAgreementsRow({
  row,
  nowMs,
  onTap,
}: {
  readonly row: PersonalAgreementRow;
  readonly nowMs: number;
  readonly onTap: (entityKind: 'node' | 'edge', entityId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <li
      data-testid="participant-my-agreements-row"
      data-vote-event-id={row.voteEventId}
      data-entity-kind={row.entityKind}
      data-entity-id={row.entityId}
      data-facet={row.facet}
      data-facet-status={row.currentStatus}
      className="..."
    >
      <button
        type="button"
        onClick={() => onTap(row.entityKind, row.entityId)}
        className="flex w-full flex-row items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2 text-left"
      >
        <span data-testid="participant-my-agreements-row-status" className="...">
          {t(`participant.facetStatus.${row.currentStatus}`)}
        </span>
        <span data-testid="participant-my-agreements-row-entity" className="...">
          {row.entityKind === 'node' ? `node ${row.entityId.slice(0, 8)}` : `edge ${row.entityId.slice(0, 8)}`}
        </span>
        <span data-testid="participant-my-agreements-row-facet" className="...">
          {t(`participant.facetLabel.${row.facet}`)}
        </span>
        <span data-testid="participant-my-agreements-row-value" className="flex-1 truncate">
          {row.candidateValue}
        </span>
        <span data-testid="participant-my-agreements-row-timestamp" className="...">
          {relativeTimeFor(row.agreedAtCreatedAt, nowMs)}
        </span>
      </button>
    </li>
  );
}
```

- The row is a `<button type="button">` so keyboard focus + space/enter activate the tap action.
- The `data-*` attributes give the Playwright spec stable filters (`[data-facet-status='agreed']`, etc.).
- The 8-char entity-id prefix mirrors `mod_proposal_list` Decision §6 + `part_proposal_list_view` Decision §5's name-resolution policy.
- Facet labels reuse existing catalog keys if available (Decision §7); status badge labels reuse the `participant.facetStatus.*` namespace per Decision §7.
- `relativeTimeFor(createdAt, nowMs)` mirrors `apps/participant/src/proposals/PendingProposalsPane.tsx` line 230-235.

### Tab bar shape change (`apps/participant/src/proposals/PendingProposalsTabBar.tsx`)

Insert a third `<TabButton tab="my-agreements" active={currentTab === 'my-agreements'} onSelect={setCurrentTab}>` between the existing graph + proposals buttons, with the label sourced from `t('participant.proposalsTab.myAgreementsLabel')`. No count badge (Decision §5).

The `<TabButton>` helper at lines 77-93 is reusable as-is — the `tab: ParticipantTab` parameter already accepts any member of the union, so extending the union flows through.

### What the new components MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects.** Selector + pane + row are pure renders / pure functions.
- **No direct `useWsStore.setState` writes.** Read-only consumer.
- **No router-level state.** No `useNavigate`, no `useSearchParams` (Decision §4).
- **No withdraw action on rows.** No `useWithdrawAgreementAction` import (Decision §3).
- **No second projector invocation.** The pane consumes `facetStatusIndex` via prop; no second `computeFacetStatuses` call.
- **No animation, no transition.** The row's mount/unmount on event-log change is an instantaneous DOM swap.
- **No moderator-style affordances.** No commit / mark-meta-disagreement / promote action — those are moderator-only.

### Test layers per ADR 0022

Five pins, each anchoring a different observable property:

1. **Vitest `derivePersonalAgreements.test.ts` (NEW)** — 10 cases:
   - (a) Empty event log → empty array.
   - (b) Single `proposal` → `vote agree` (by current participant) → one row; `currentStatus` reads off the supplied `facetStatusIndex`.
   - (c) `proposal` → `vote agree` → `commit` → one row with `currentStatus === 'committed'`.
   - (d) `proposal` → `vote agree` → `commit` → `withdraw-agreement` (by current participant) → one row with `currentStatus === 'withdrawn'`.
   - (e) `proposal` → `vote agree` → meta-disagreement-marked → one row with `currentStatus === 'disputed'` (the facet reverts to disputed when the proposal is meta-disagreement-marked, per the facet-status walk).
   - (f) `proposal` → `vote agree` by OTHER participant → empty result (filter applies).
   - (g) `proposal` → `vote agree` (by current) → still `'proposed'` status (no commit yet) → empty result (filter excludes `'proposed'`).
   - (h) Two `proposal` + `vote agree` (by current) events on different facets → two rows ordered newest-first by `agreedAtSequence`.
   - (i) `proposal` → `vote agree` (by current) → later `vote dispute` (by current) on the same `(entity, facet)` → empty result (dispute invalidates the prior agree).
   - (j) Structural-arm `proposal` (e.g., `decompose`) + `vote agree` (by current) → empty result (no facet target).
   - Plus a sanity case: agree across all four facet kinds (`wording`, `classification`, `substance`, `shape`) → four rows.
   - Total: 11 cases.

2. **Vitest `MyAgreementsPane.test.tsx` (NEW)** — 7 cases:
   - (a) No events → empty state branch (`participant-my-agreements-pane-empty` visible).
   - (b) Single agreement → one row visible; `data-vote-event-id` matches; `data-facet-status` matches.
   - (c) Multiple agreements → multiple rows in DOM newest-first; first `<li>` matches highest `agreedAtSequence`.
   - (d) Row with `currentStatus === 'committed'` → status cell renders the `committed` catalog label.
   - (e) Row tap → `useSelectionStore.setSelection` called with `(entityKind, entityId)`; `useUiStore.setCurrentTab` called with `'graph'`.
   - (f) Row's `data-entity-kind` + `data-entity-id` + `data-facet` + `data-facet-status` attrs all populated correctly.
   - (g) ARIA contract: `<section role="tabpanel" aria-live="polite" aria-label="...">` + `<ul role="list">`.
   - Total: 7 cases.

3. **Vitest `PendingProposalsTabBar.test.tsx` (extended)** — add 2 new cases:
   - The third `<TabButton tab="my-agreements">` is visible with the correct label.
   - Clicking the my-agreements tab sets `useUiStore.currentTab` to `'my-agreements'`.
   - Existing cases stay passing.
   - Total new: 2.

4. **Playwright `tests/e2e/participant-my-agreements.spec.ts` (NEW)** — one scenario:
   - Login as participant; join session.
   - Navigate to `/sessions/:id` (operate route).
   - Seed events into the participant store via `applyEvent`: a `proposal` (e.g., `set-node-substance` on a node), a `vote agree` (by the current participant), and a `commit` event.
   - Click the my-agreements tab.
   - Assert `participant-my-agreements-pane` is visible.
   - Assert exactly one `participant-my-agreements-row` visible.
   - Assert the row's `data-facet-status === 'committed'`.
   - Assert the row's `data-entity-id` matches the seeded node id.
   - Click the row.
   - Assert the graph tab is now active (`[data-active='true']` on the graph TabButton).
   - Assert the entity detail panel is visible (the panel mounts on selection).
   - Assert the panel's testid attributes indicate the seeded entity is selected.
   - No new scenario fixture file; the spec uses the existing helpers.

5. **No new Cucumber scenario** (Decision §9). The read path is event-log + client-local pure function; Cucumber adds no protocol-boundary coverage here.

### UI-stream e2e policy (apply)

**E2e is in scope; a new Playwright spec is the right pin.** The pane is reachable the moment this leaf lands — the third tab is visible, clicking it mounts the pane, and seeded events render rows. No deferral. The new spec exercises the user-visible behavior (navigate to my-agreements tab → see agreements → tap row → arrive at graph + selected entity) end-to-end. The choice of a *new* spec file (rather than extending `participant-pending-proposals.spec.ts`) reflects that the my-agreements pane is a distinct surface from the proposals pane — coupling their assertions would muddy both specs.

### Backend / WS / projector / methodology-engine policy (apply)

No wire shape change. No broadcast envelope change. No projector output change. No new Cucumber scenario. The read path is the already-Cucumber-pinned event log; the selector is client-local pure.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~45 min: write `derivePersonalAgreements.ts` — selector body + the `PersonalAgreementRow` interface + `voteTargetOf` reuse from `ownVotes.ts`. Mostly a copy-adapt from `derivePendingProposals.ts`'s walk shape + the facet-status filter.
- ~1h: write the 11-case Vitest unit suite for the selector. Fixture-heavy; mostly minted `Event` objects.
- ~30 min: write `MyAgreementsPane.tsx` — pane + co-located row + `useMemo` + `useTranslation` + `useCallback`. Mirror of `PendingProposalsPane.tsx` shape.
- ~45 min: write the 7-case `MyAgreementsPane.test.tsx`. Each case mints a small event log + facet-status index + asserts DOM.
- ~15 min: extend `PendingProposalsTabBar.tsx` (add 3rd `<TabButton>`) + 2 new test cases.
- ~15 min: extend `ParticipantTab` union in `uiStore.ts` + drop the stale "future tabs" comment.
- ~30 min: extend `OperateRoute.tsx` (binary ternary → three-arm switch) + extend its test cases if `OperateRoute.test.tsx` exists.
- ~45 min: write the new Playwright spec `participant-my-agreements.spec.ts`. Reuses login + join helpers; seeds events via `evaluate`; asserts the row + tap-to-navigate flow.
- ~20 min: register the new i18n keys across en-US / pt-BR / es-419 + the two review.json PENDING lists. Audit existing facet-label + facet-status catalog keys (Decision §7); register only missing keys.
- ~15 min: register `i18n_participant_my_agreements_native_review` leaf in `tasks/35-frontend-i18n.tji`.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + visual sanity in browser.
- ~30 min: buffer for Tailwind / chip-text adjustments after the visual sanity pass.

Total: ~6.5h (within the 1d budget).

Risk surface is modest. The main hazard is the selector's filter rule for `currentStatus` — if the projector's facet-status enum gains a new variant in a future ADR, this filter MUST be updated to decide whether the new variant counts as "still an agreement" or not. Decision §2 documents the v1 filter explicitly so the reader sees the intent. A secondary hazard is the tap-to-navigate's interaction with the auto-selection logic (per `apps/participant/src/graph/autoSelect.ts`): when the user taps a my-agreements row, the selection is set explicitly; subsequent `proposal` events arriving via WS should NOT override that explicit selection. The existing selection-store contract is "explicit setSelection wins until cleared"; the auto-select logic only applies when selection is null. The Playwright spec's "after tap, panel visible for seeded entity" assertion pins this.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the new selector, pane, row, extended tab bar, extended `ParticipantTab` union, extended OperateRoute, and extended tests all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — library-mode build clean; bundle filename / sidecar shape unchanged.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+20** (11 from `derivePersonalAgreements.test.ts` + 7 from `MyAgreementsPane.test.tsx` + 2 from extended `PendingProposalsTabBar.test.tsx`). Net total includes whatever extensions land in `OperateRoute.test.tsx` (0-2 cases depending on its current shape).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — every new key present in all three locales; pt-BR + es-419 drafts flagged PENDING.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the new `tests/e2e/participant-my-agreements.spec.ts` scenario green: tab visible → click activates the pane → seeded agreement row renders with correct status → tap row → graph tab active + entity selected + detail panel visible.
8. **All other Playwright projects pass unchanged** — no regression of `participant-pending-proposals.spec.ts` or any other participant spec; the third tab is additive.
9. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
10. **The new components own no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams` under `apps/participant/src/proposals/derivePersonalAgreements.ts` + `MyAgreementsPane.tsx` returns zero matches (modulo `useCallback` / `useMemo` / `useTranslation` / `useWsStore` / `useSelectionStore` / `useUiStore` which are reactive hooks, not side effects).
11. **The selector is pure** — `derivePersonalAgreements` consumes only its three arguments + returns a value; no closures over module state. Acceptance reviewer confirms by inspection.
12. **The canonical withdraw surface is unchanged** — `apps/participant/src/detail/ParticipantVoteButtons.tsx` + `useWithdrawAgreementAction.ts` are byte-for-byte unchanged; their tests pass unchanged. The my-agreements pane does NOT import `useWithdrawAgreementAction` (a grep across `apps/participant/src/proposals/MyAgreementsPane.tsx` returns zero matches for `useWithdrawAgreementAction`).
13. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_my_agreements_view` task block per the task-completion ritual; separately, after the new `i18n_participant_my_agreements_native_review` leaf lands in `tasks/35-frontend-i18n.tji`.
14. **`part_withdraw` parent rolls up.** With this leaf's `complete 100` landing, all four leaves under `part_withdraw` are now `complete 100` (the three superseded ones + this implementation). The closer's task-completion-ritual pass marks the parent `complete 100` per the convention in [`tasks/refinements/README.md`](../README.md#L32-L42).
15. **Predecessor assertions unchanged** — `PendingProposalsPane.test.tsx`, `derivePendingProposals.test.ts`, `proposalSummary.test.ts`, the `usePendingProposalsCount.ts` slot all pass unchanged; their files are untouched.

## Decisions

### 1. Scope an implementation; do NOT close as deferred

Three alternatives surveyed:

- **(A) Scope a buildable implementation as a 1d leaf** (chosen). The orchestrator's pick-task pass selected this leaf; the implementation cost is small; the design is clear (precedent in `part_proposal_list_view.md`); the user-value is real (retrospective audit). The Optional marker in the WBS reflects "v1's withdraw flow doesn't *require* this" — NOT "this feature has no value." Shipping the leaf cashes the reserved tab slot at `uiStore.ts:19`.
- **(B) Close as deferred indefinitely** by writing a refinement that says "do not implement" and adding `complete 100` with a "deferred" Status block. Rejected. The orchestrator's pick selected this leaf as ready; closing it as deferred-without-implementation would leave the parent's `complete 100` gate clear but the participant UX missing the audit surface the design sketch named (`docs/participant-ui.md` L93-L101). The "Optional" marker is read as "may stay deferred"; but with the find-then-withdraw flow done via the per-facet refactor, deferring this would leave the my-agreements affordance permanently un-shipped without an explicit reason. Implementing is the more defensible v1 call.
- **(C) Close as superseded by the per-facet refactor chain** (mirroring `part_find_agreed_facet`). Rejected. The prior `part_find_agreed_facet` refinement explicitly preserved this leaf as independently scoped — *"the history view UX is a distinct affordance from the find-for-withdraw flow"*. The per-facet refactor solved the find-then-withdraw flow on a single panel surface; it did NOT solve the retrospective-audit affordance (which surfaces facets one-entity-at-a-time only, requiring N taps for N entities — exactly what a list view solves). Re-closing this leaf as superseded would erase the real difference the prior refinement preserved.

The chosen approach honors the prior refinement's preservation + cashes the reserved tab slot + ships a small surface with named follow-ups (Decision §8).

### 2. Filter rows by `currentStatus`; include `agreed` / `committed` / `withdrawn` / `disputed`; exclude `proposed` / `meta-disagreement` / `awaiting-proposal`

Three alternatives surveyed:

- **(A) Include `agreed` / `committed` / `withdrawn` / `disputed`; exclude the three "no settled agreement" statuses** (chosen). Rationale per status:
  - `agreed` — the participant's current agreement is active, awaiting commit. Include.
  - `committed` — the participant's prior agreement was committed by the moderator. Include.
  - `withdrawn` — the participant agreed, then withdrew. Include — this IS retrospective audit's core use case ("show me agreements I've since withdrawn").
  - `disputed` — the participant agreed, but the facet reverted to disputed via meta-disagreement OR a third party's later dispute. Include — the participant DID hold an agreement at some point; surfacing the row lets them re-engage if they want.
  - `proposed` — the proposal is still in-flight; the participant's vote isn't a settled agreement yet. EXCLUDE — surfacing this would conflate "I'm currently voting agree on a pending proposal" (which the proposals pane already shows) with "I've agreed in the past."
  - `meta-disagreement` — the facet is in meta-disagreement state; no participant's vote on the underlying proposal counts as a current agreement. EXCLUDE.
  - `awaiting-proposal` — there is no proposal on this facet; the participant CANNOT have voted agree on it. Vacuously excluded.
- **(B) Include only `agreed` + `committed`; exclude `withdrawn` + `disputed`** (the "active agreements only" framing). Rejected. The history view's user-value is the retrospective audit — being able to see "what have I agreed to, including agreements that no longer hold." Hiding withdrawn agreements would make the surface a dead-letter inbox (rows disappear silently after withdrawal), defeating the audit purpose. Decision §3 of `part_find_agreed_facet.md` framed this view as "all facets I've agreed to and their current status, including those since committed or since withdrawn" — that framing pins the include-all-four-history-bearing-statuses rule.
- **(C) Include everything that touches a participant's `vote agree` event** (no filtering by current status). Rejected. Surfacing rows whose `currentStatus === 'proposed'` would mean any in-flight proposal the participant voted agree on appears in BOTH the proposals pane AND the my-agreements pane (the same row in two surfaces). The proposals pane is the right surface for in-flight pending work; the my-agreements pane is the right surface for *settled* historical agreements. The filter draws the boundary.

The v1 filter is encoded in the selector body explicitly; future status-enum extensions (e.g., a new ADR adds a `pending-commit` or similar variant) MUST update the filter consciously. Decision §8 names a future follow-up to revisit the filter if status-enum churn warrants.

### 3. Read-only rows; no inline withdraw button

Three alternatives surveyed:

- **(A) Rows are tap-to-navigate only; no inline withdraw button** (chosen). The canonical withdraw surface is the detail panel per ADR 0030 + `pf_part_withdraw_agreement_action`. Tapping a row sets selection + switches to the graph tab; the detail panel mounts on the selected entity; the participant sees the per-facet row block including the withdraw button on `agreed` / `committed` facet rows. One canonical surface; no duplication; no drift risk.
- **(B) Inline withdraw button on `agreed` / `committed` rows** (a second withdraw surface). Rejected. Two withdraw surfaces means two confirmation gestures, two slot-bookkeeping models (the `useWithdrawAgreementAction` hook's per-slot `inFlight` map vs. an analogous per-row map), two i18n strings, and two test paths. The per-facet refactor's `pf_part_withdraw_agreement_action` Status block records the canonical surface; duplicating here would create maintenance debt against zero observed user need.
- **(C) Tap a row → open an inline confirmation popover, fire `withdraw-agreement` directly** (skipping the graph-tab navigation). Rejected. Skips the detail-panel context, hiding from the participant the rest of the facet rows (what's the current value, what other facets are agreed/committed, etc.) — context the panel surfaces. Also requires inventing a popover component that nothing else uses, vs. reusing the existing panel-with-withdraw-button affordance.

The chosen approach treats the my-agreements pane as a *navigation aid* into the canonical withdraw surface, not a parallel one. A future `part_my_agreements_view_inline_withdraw` follow-up is registered in Decision §8 in case observed usage suggests the second surface is worth the cost.

### 4. Tap-to-navigate via `useSelectionStore.setSelection` + `useUiStore.setCurrentTab`; no router-level state

Two alternatives surveyed:

- **(A) Use the existing selection-store + ui-store seams** (chosen). The `useSelectionStore` already accepts `{kind, id}` selection targets; the `useUiStore.setCurrentTab` already changes the foregrounded tab. Both stores are global (Zustand) — the my-agreements pane's tap action calls `setState` on each and the route re-renders. The graph view's existing selection-driven detail-panel mount fires automatically. No new state, no new prop drilling.
- **(B) Use router-level state** (e.g., `useNavigate('/sessions/:id?selected=node:abc')`). Rejected. The participant routes don't carry selection in the URL today; adding a `?selected=...` query param would (i) require parsing on every route mount, (ii) couple URL syntax to the selection-store schema (causing drift risk on schema change), (iii) introduce a URL-mutation that breaks the back button (the user's "back" should leave the session, not undo a row tap). The store-only approach matches the existing graph-tap pattern in `part_pan_zoom_tap`.

### 5. No count badge on the my-agreements tab

Two alternatives surveyed:

- **(A) No badge on the my-agreements tab** (chosen). The proposals tab badge counts pending proposals (work-to-do — an actionable signal). A my-agreements badge would count cumulative history (a passive number that only grows). Cumulative-count badges train the user to ignore the surface — they grow monotonically and don't indicate when attention is needed. The tab label "My agreements" without a number is clearer signaling.
- **(B) Badge counts personal agreements with `currentStatus === 'agreed'` (i.e., your active uncommitted agreements)**. Rejected as feature-creep — this leaf already commits to a 1d budget; adding a per-tab badge with a selector behind it (the badge needs to re-derive from the selector output on every WS frame) would compound the test surface. If observed usage suggests the badge helps, it's a separate follow-up.

### 6. Keep the file name `PendingProposalsTabBar.tsx`; register rename as tech-debt

Three alternatives surveyed:

- **(A) Keep the existing file + component name; add the third tab inline** (chosen). The component currently hosts graph + proposals tabs; adding a third tab makes the name a misnomer, but the renaming work has cross-cutting fallout (import sites, test file rename, barrel-export update, refinement-document citation drift). Folding the rename into this leaf would inflate the diff; deferring it as a named follow-up keeps this leaf focused.
- **(B) Rename `PendingProposalsTabBar` → `ParticipantTopTabBar` (or similar) in this leaf**. Rejected for the above churn-vs-focus reason.
- **(C) Leave the name as-is permanently**. Rejected — the misnomer is real and will mislead future readers. Decision §8 registers the rename follow-up.

### 7. i18n catalog audit — reuse existing facet-label + facet-status keys; register only missing ones

Three alternatives surveyed:

- **(A) Audit + reuse existing `participant.facetLabel.*` and `participant.facetStatus.*` keys; register only the new my-agreements-specific keys (`proposalsTab.myAgreementsLabel`, `myAgreementsPane.paneAriaLabel`, `myAgreementsPane.emptyState`)** (chosen). The detail panel already renders facet labels + facet status badges per `pf_part_detail_panel_three_facet_rows`; those keys exist in the catalog. The implementer's first step is to grep the en-US catalog for the existing facet-label + facet-status namespaces and reuse whichever path is already established. If the existing namespace is `participant.detailPanel.facetLabel.*` or similar, the my-agreements row uses the same keys (NOT a parallel `participant.myAgreementsPane.facetLabel.*` namespace). Catalog footprint stays proportional to surface.
- **(B) Register a parallel `participant.myAgreementsPane.facetLabel.*` + `participant.myAgreementsPane.facetStatus.*` namespace** for surface-specific overrides. Rejected — proliferates keys with the same source-of-truth value; surface-specific override is a YAGNI feature.
- **(C) Hard-code English facet labels + status names** in the row. Rejected — violates the i18n discipline per ADR 0024 + the precedent at `mod_proposal_list` Decision §7 (which only hard-coded summary strings; the facet *labels* and *status names* have always been catalog keys).

The implementer audits + reuses; the closer's Status block lists the *new* keys actually registered (post-audit).

### 8. Tech-debt registration

Three follow-ups named crisply for the closer:

- **`frontend_i18n.i18n_participant_my_agreements_native_review`** — pt-BR + es-419 native-speaker review of the new keys registered by this leaf. Effort: 0.25d. **Action for Closer**: register as a new WBS leaf in `tasks/35-frontend-i18n.tji`, chained after the prior participant-side native-review tail and after this task: `depends !<prior native-review tail>, participant_ui.part_withdraw.part_my_agreements_view`.

- **`participant_ui.part_participant_tab_bar_rename`** — rename `PendingProposalsTabBar.tsx` → `ParticipantTopTabBar.tsx` (or similar) and update all import sites + test file + barrel exports. Effort: 0.5d (touches ~6-8 files in `apps/participant/src/` + 1 test rename + 1 barrel update). **Action for Closer**: register as a new WBS leaf in `tasks/40-participant-ui.tji` under a "naming hygiene" subtree (or under the participant-ui parent directly), with no dependencies (it can land at any time post-this-leaf). The rename is purely mechanical; no semantic change.

- **`participant_ui.part_my_agreements_view_filter_revisit`** (provisional name; orchestrator can re-name) — revisit the filter rules in Decision §2 if the facet-status enum grows in a future ADR. Effort: 0.25d (audit + update the selector's filter + add Vitest case for the new status). **Action for Closer**: do NOT register a new leaf unprompted — register only if a future ADR ADDS a new facet-status variant. The closer of THAT ADR is responsible for scheduling this revisit.

A fourth potential follow-up — an inline withdraw button on my-agreements rows (Decision §3 alternative B) — is NOT registered today. The chosen read-only posture is the right v1; a second withdraw surface is a feature, not a maintenance debt. If observed usage warrants it, the orchestrator can register it in a future pass with explicit user direction.

### 9. No Cucumber scenario for the read path

Two alternatives surveyed:

- **(A) Pin via Vitest (selector + pane) + Playwright (end-to-end row render + tap-to-navigate)** (chosen). The read path is: WS frames → `applyEvent` → `useWsStore.events` → `derivePersonalAgreements(events, ...)` → rendered `<li>`s. The WS-frame → store-application boundary is already Cucumber-pinned upstream (`ws_proposal_status_broadcast` + `ws_withdraw_agreement_message` + the vote-message scenarios). The selector is client-local pure. The orchestrator's "Cucumber if a surface ADDS wire/projector behavior" guidance applies when a NEW envelope or projection crosses the boundary — this leaf only consumes already-pinned data.
- **(B) Add a Cucumber scenario** asserting "when a participant's `vote agree` and a subsequent `commit` apply to the event log, the my-agreements selector returns one row with `currentStatus === 'committed'`." Rejected. The assertion is structurally testable in Vitest (the unit suite case (c)); Cucumber would duplicate the pin at higher cost without catching a class of bug the existing scenarios miss.

### 10. No new ADR

This leaf introduces no architectural choice that isn't already covered:

- Event-log source of truth (the selector's input) — established by `part_proposal_list_view` Decision §2.
- Pure selector + co-located row component pattern — established by `part_proposal_list_view` Decision §1 + Decision §4.
- Tab-strip extension via the existing literal-union seam — anticipated by `part_state_management` (the `ParticipantTab` union) + `part_proposals_tab` Decision §1.
- Tap-to-navigate via existing selection-store + ui-store seams — established by `part_pan_zoom_tap` (selection store usage) + the existing tab-switching pattern.
- Read-only audit posture vs. inline withdraw — addressed by ADR 0030 + `pf_part_withdraw_agreement_action` (which made the detail panel the canonical surface).
- Tailwind utility classes — ADR 0005.
- React-i18next + ICU-free keys — ADR 0024.
- No router-level state — established by Decision §4 above mirroring `part_proposals_tab` Decision §6.

The ADR convention's "amendment-pass rule" ([`docs/adr/README.md`](../../../docs/adr/README.md)) does not fire because no architectural seam is added or amended.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- New pure selector `apps/participant/src/proposals/derivePersonalAgreements.ts` — single-pass walk returning `readonly PersonalAgreementRow[]` newest-first; filters by `currentStatus` ∈ {`agreed`, `committed`, `withdrawn`, `disputed`}; drops `proposed` / `meta-disagreement` / `awaiting-proposal`.
- New pane + co-located row component `apps/participant/src/proposals/MyAgreementsPane.tsx` — subscribes to `useWsStore` events, memoises rows, renders empty-state or `<ul>` of tappable `<MyAgreementsRow>`s; tap-to-navigate fires `setSelection` + `setCurrentTab('graph')`.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` — third `<TabButton tab="my-agreements">` added; no count badge (Decision §5).
- `apps/participant/src/stores/uiStore.ts` — `ParticipantTab` union extended to `'graph' | 'proposals' | 'my-agreements'`; stale "future tabs" comment removed.
- `apps/participant/src/routes/OperateRoute.tsx` — binary ternary extended to three-arm conditional; mounts `<MyAgreementsPane>` when `currentTab === 'my-agreements'`.
- i18n catalogs (`en-US` / `pt-BR` / `es-419`) — 3 new keys: `participant.proposalsTab.myAgreementsLabel`, `participant.myAgreementsPane.paneAriaLabel`, `participant.myAgreementsPane.emptyState`; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
- `tasks/35-frontend-i18n.tji` — `i18n_participant_my_agreements_native_review` leaf registered (already wired by implementer).
- Tests: 11 Vitest cases in `derivePersonalAgreements.test.ts`, 7 in `MyAgreementsPane.test.tsx`, 2 new cases in `PendingProposalsTabBar.test.tsx`, 1 new case in `OperateRoute.test.tsx`; new Playwright spec `tests/e2e/participant-my-agreements.spec.ts`.
- Tech-debt registered: `participant_ui.part_participant_tab_bar_rename` added to `tasks/40-participant-ui.tji` (rename `PendingProposalsTabBar.tsx`, effort 0.5d, no deps).
