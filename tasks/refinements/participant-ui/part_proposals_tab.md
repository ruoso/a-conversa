# Pending proposals tab with count badge

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_pending_proposals.part_proposals_tab`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_shell` (settled — every `part_shell` leaf is `complete 100`; this leaf inherits the participant surface's mount + layout + status-indicator chrome unchanged). The `<ParticipantLayout>` `main` slot landed by [`part_landscape_layout`](part_landscape_layout.md) ([`apps/participant/src/layout/ParticipantLayout.tsx:68-74`](../../../apps/participant/src/layout/ParticipantLayout.tsx#L68)) is where this leaf's tab strip + active-tab content render; the header + footer regions stay untouched.
- `backend.websocket_protocol.ws_proposal_status_broadcast` (settled — the `proposal-status` envelope `{ sessionId, proposalId, sequence, perFacetStatus }` is broadcast on every `proposal` / `vote` / `commit` / `meta-disagreement-marked` per [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md); the participant `useWsStore` already lands each envelope into `sessionState[sid].pendingProposals[proposalId]` via the shared dispatch — see [`apps/participant/src/ws/wsStore.ts:79-90`](../../../apps/participant/src/ws/wsStore.ts#L79) + [`apps/participant/src/ws/wsStore.test.ts:61-78`](../../../apps/participant/src/ws/wsStore.test.ts#L61)). This task is the first user-visible consumer of that data on the participant surface (the moderator already consumes via `<PendingProposalsPane>` in the right sidebar).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_shell.part_state_management` (settled — `useUiStore.currentTab: 'graph' | 'proposals'` with default `'graph'` + `setCurrentTab` setter is already in place at [`apps/participant/src/stores/uiStore.ts:19-44`](../../../apps/participant/src/stores/uiStore.ts#L19); this leaf is the first render-side consumer of that slice. The slice was deliberately landed ahead of any tab UI per [`part_state_management.md`](part_state_management.md) Decision §3 — the tab seam task here plugs the consumer in without re-deciding the store shape).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.*` chain (settled — `<OperateRoute>`'s two-column `<GraphView>` + `<EntityDetailPanel>` body is the "graph tab" content this leaf wraps in the new tab seam. The eight-memo projection chain inside `<OperateRoute>` ([`apps/participant/src/routes/OperateRoute.tsx:232-281`](../../../apps/participant/src/routes/OperateRoute.tsx#L232)) MUST keep running while the proposals tab is foregrounded — see Decision §4 on tab-switch render strategy).

## What this task is

The structural seam for the `part_pending_proposals` subgroup: a two-button tab switcher inside the participant `<OperateRoute>`'s main region (`Graph` / `Proposals[badge]`), wired to `useUiStore.currentTab`, plus an empty `<PendingProposalsPane>` shell that sibling leaves (`part_proposal_list_view`, `part_proposal_expand`, `part_per_facet_breakdown_in_pane`, `part_vote_indicators_in_pane`) plug into without rewiring the tab shell. After this leaf:

- A new `<PendingProposalsTabBar>` component under [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) renders a single-row, ~40 px-tall strip at the top of `<participant-main>` with two `<button>` affordances (`Graph`, `Proposals` + count badge), exposes stable testids (`participant-proposals-tabbar`, `participant-proposals-tabbar-graph`, `participant-proposals-tabbar-proposals`, `participant-proposals-tabbar-badge`), and dispatches `useUiStore.setCurrentTab(...)` on click. The active tab carries `data-active="true"` + a distinct visual treatment so e2e + Vitest can pin the selected state structurally.
- A new `<PendingProposalsPane>` component under [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) renders the empty-state shell — a stable container testid (`participant-pending-proposals-pane`), an empty-state message (i18n key `participant.pendingProposalsPane.emptyState`) shown when `Object.keys(pendingProposals).length === 0`, and an `aria-live="polite"` region scaffold so sibling leaves can stream list content without re-deciding ARIA contract. The pane is the seam's *empty container* — list rendering itself lands in `part_proposal_list_view`.
- A new selector hook `usePendingProposalsCount(sessionId)` under [`apps/participant/src/proposals/usePendingProposalsCount.ts`](../../../apps/participant/src/proposals/usePendingProposalsCount.ts) reads `useWsStore((s) => s.sessionState[sessionId]?.pendingProposals)` and returns `Object.keys(map).length`. This is the *total* count — the "filter to proposals this debater hasn't voted on yet" refinement is deferred to `part_vote_indicators_in_pane` (Decision §3 + tech-debt registration).
- `<OperateRoute>` restructures its main-region return to wrap the existing two-column `<GraphView>` + `<EntityDetailPanel>` body in a column-flex container whose first row is the `<PendingProposalsTabBar>` and whose second row is conditional on `currentTab`. The eight-memo projection chain (`OperateRoute.tsx:232-281`) stays hoisted at the route level so projection cost is paid once per WS frame regardless of which tab is foregrounded (Decision §4).
- Three new i18n keys (one per tab label + one for the empty-state) land in en-US + pt-BR + es-419 catalogs with pt-BR/es-419 drafts flagged PENDING in `*.review.json`; a native-review chain leaf is registered in `tasks/35-frontend-i18n.tji` chained after the existing tail (`i18n_participant_lobby_native_review`).
- Test layers per ADR 0022: a Vitest component-shape suite for `<PendingProposalsTabBar>` (state → expected attribute + label + click → store-dispatch + badge count), a Vitest component-shape suite for `<PendingProposalsPane>` (empty-state visible when pendingProposals empty; hidden when non-empty), a Vitest unit suite for `usePendingProposalsCount` (selector correctness across empty / non-empty / missing session), an extension to `OperateRoute.test.tsx` (tab switch flips visible body region), and a Playwright scenario in `tests/e2e/participant-pending-proposals.spec.ts` that mounts the route, asserts the tab bar visible with badge `0`, clicks the Proposals tab, asserts the pane's empty-state visible and the graph hidden, clicks the Graph tab, asserts the graph visible again.

Out of scope (deferred to sibling or future leaves):

- **Not the proposal list.** Rendering the actual proposal rows inside the pane (one row per pending proposal, most-recent at top per `docs/participant-ui.md` V1 defaults) is `part_proposal_list_view` (1d, depends `!part_proposals_tab`). This leaf renders only the empty-state for the pane; the list view replaces the empty-state branch with the actual rendered list when its `pendingProposals` count is `>0`. The pane's container testid + ARIA contract this leaf establishes are the seam the list view plugs into.
- **Not the per-proposal expand affordance.** Tap-to-expand a proposal showing its facets is `part_proposal_expand` (1d, depends `!part_proposal_list_view`).
- **Not the per-facet breakdown.** Per-facet breakdown of each proposal (mirroring moderator UI) is `part_per_facet_breakdown_in_pane` (1d).
- **Not the per-participant vote indicators in the pane.** Per-participant indicators (and the count-filter refinement that follows) is `part_vote_indicators_in_pane` (0.5d).
- **Not the "needs your vote" badge filter.** Today's badge is *total* `pendingProposals.length`. The refinement to "facets across all proposals still need this debater's vote" (per `docs/participant-ui.md:132`) requires the per-participant vote projection that `part_vote_indicators_in_pane` ships; that leaf's closer updates `usePendingProposalsCount` to filter against `projectOwnVotes`-style data. See Decision §3 + tech-debt registration.
- **Not the graph-view-flash on new-proposal.** The "graph view also visually flashes the affected entity briefly" cue described in P2 (`docs/participant-ui.md:82`) is a separate visual-polish concern — not on the M3-pending-pane critical path; a future `part_proposal_flash` leaf (not yet a WBS entry) would land it.
- **Not a moderator mirror.** The moderator's pending-proposals surface lives in the right sidebar as an accordion-style stacked pane (per [`mod_right_sidebar.md`](../moderator-ui/mod_right_sidebar.md)), not a tab — the two surfaces have different chrome geometries (the moderator is a desktop console with a wide sidebar; the participant is a landscape tablet with a single primary-region). This leaf establishes the *participant* tab pattern; if a shell-level `<TabBar>` extraction becomes warranted later (when the audience or replay surface picks up a similar two-tab affordance), Decision §5 covers the extraction path.
- **Not a header-mounted tab bar.** The 48 px header is already populated with the product label + identity row; cramming a tab switcher in would crowd the chrome and force the badge into a sub-pixel-tight slot. Decision §1 picks "top-of-main strip" over "header-mounted".
- **Not portrait-mode redesign.** Landscape only, same orientation boundary `part_landscape_layout` set.
- **Not a router-level tab.** Tab state lives in `useUiStore` (zustand, in-memory) per `part_state_management`'s settled shape — NOT in the URL. URL-state for tabs would require route-level redesign (`/p/sessions/:id/graph` vs `/p/sessions/:id/proposals`) and a `useSearchParams` migration that has no current pull from the WBS; see Decision §6.

## Why it needs to be done

The pending-proposals pane is the participant's second primary region per the design (`docs/participant-ui.md` §"Layout (sketch)" and §"Visual state representation") — without it, the debater has no systematic walk-through of proposals awaiting their vote. The graph view alone surfaces vote affordances *contextually* (tap an entity to see its facet rows in the detail panel), which works during a focused discussion but does not surface the question "what am I being asked to vote on right now, across the whole graph?". The pending-proposals pane answers that question.

The downstream WBS chain depends on this leaf landing first:

1. **`part_proposal_list_view`** (1d, depends `!part_proposals_tab`) renders the per-proposal rows inside the pane's empty-shell. Without the seam, the list-view leaf would have to invent the tab + pane geometry itself; with the seam, it replaces the empty-state branch with a rendered list.
2. **`part_proposal_expand`** (1d, depends `!part_proposal_list_view`) wires tap-to-expand on the rows.
3. **`part_per_facet_breakdown_in_pane`** (1d, depends `!part_proposal_expand`) adds the per-facet breakdown inside an expanded row.
4. **`part_vote_indicators_in_pane`** (0.5d, depends `!part_per_facet_breakdown_in_pane`) adds per-participant indicators AND refines the count badge to "needs your vote" (the deferred-from-this-leaf refinement; see Decision §3).
5. **`part_voting.*`** (P2 chain — `part_vote_button_per_facet`, `part_vote_single_tap`, etc., depends `!part_pending_proposals`) hangs off the parent subgroup's `complete 100` state, which requires every leaf under `part_pending_proposals` (including this one) to ship.

Architecturally, this leaf is the **first user-visible tab switcher in the participant surface** — the establishing pattern for any future surface-local tab affordance. The decision-set below pins: (a) tab strip lives at top of `<participant-main>` (not in chrome); (b) tab state lives in `useUiStore.currentTab` (not in URL); (c) projection chain stays hoisted at the route so tab switching doesn't double the per-WS-frame projector cost; (d) the badge count is initially *total pending*, with the per-participant refinement deferred to a sibling leaf that has the projection data on hand; (e) the empty-pane shell carries a stable testid + ARIA contract sibling leaves consume unchanged.

It is also the **first realization of the `useUiStore.currentTab` slice as a user-visible affordance.** That slice was deliberately landed empty-of-consumers in `part_state_management` so the tab-owner could plug in without coordinating commits — this leaf is what that planning was for.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; debaters' vote affordance is the only mechanical input to the graph.
- [docs/participant-ui.md — Layout (sketch)](../../../docs/participant-ui.md#L20-L29) — "two primary regions, switchable by tab or split-view"; "A **badge on the tab indicates how many rows are awaiting this debater's vote**." This refinement scopes the badge to *total pending* for the seam; the per-participant filter lands in `part_vote_indicators_in_pane` (Decision §3).
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L130-L133) — "Pending count badge — a number on the pending-proposals tab indicating how many facets across all proposals still need this debater's vote."
- [docs/participant-ui.md — P2. Vote on a pending proposal](../../../docs/participant-ui.md#L78-L87) — "when the moderator publishes a new proposal, the pending-proposals tab badge increments." This leaf's badge is the increment surface; the *flash on the affected entity* is a separate visual-polish concern not covered here.
- [ADR 0005 — Tailwind CSS with shared design tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — inline Tailwind utility classes; `packages/ui-tokens` deferred.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — three ICU-free keys land per the established workflow.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — surface owns its mounted region; the tab switcher is a participant-local surface affordance, not a host concern.
- [ADR 0030 — per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the `pendingProposals[proposalId].perFacetStatus` shape this leaf's count consumes is per-proposal, not per-facet; the "facets across all proposals still need this debater's vote" filter in `part_vote_indicators_in_pane` will need a `Σ facetsNeedingVote` walk across `perFacetStatus` entries. The simpler "count of pending proposals" this leaf ships is a strict subset of that future filter (`perFacetStatus` keys imply per-proposal entries; total proposal count is an upper bound for "needs your vote").

### Sibling refinements

- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — declares `useUiStore` (`currentTab` slice, default `'graph'`, `setCurrentTab` setter), `useWsStore` consumption pattern (`sessionState[id]?.pendingProposals`), and the rule that store writes go through the shell client's dispatch only (no direct `useWsStore.setState`). This leaf consumes both stores read-only (UI store for tab state, WS store for pendingProposals); it dispatches `setCurrentTab` on tab clicks only.
- [`tasks/refinements/participant-ui/part_landscape_layout.md`](part_landscape_layout.md) — the `<ParticipantLayout>` `main` slot contract. This leaf wraps its tab strip + active-tab content into the `main={...}` prop in `<OperateRoute>`; the layout itself is unchanged.
- [`tasks/refinements/participant-ui/part_status_indicator.md`](part_status_indicator.md) — the footer-slot pattern (stable testid + ARIA contract + sibling leaves plug content into the slot). This leaf mirrors that shape for the main-slot tab seam: stable testid (`participant-pending-proposals-pane`) + ARIA contract + sibling leaves (`part_proposal_list_view` et al.) plug list content into the pane.
- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md) — Decision §2 hoists the projection chain from `<GraphView>` up to `<OperateRoute>` so both `<GraphView>` and `<EntityDetailPanel>` share the memo outputs. This leaf preserves that hoist exactly (Decision §4); the eight memos stay where they are and BOTH tabs receive them via prop-thread, so projection cost stays at one walk per WS frame regardless of tab state.
- [`tasks/refinements/participant-ui/part_lobby_view.md`](part_lobby_view.md) — per-session `client.trackSession(id)` lifecycle pattern; mirrored unchanged by `<OperateRoute>`'s existing effect ([OperateRoute.tsx:141-147](../../../apps/participant/src/routes/OperateRoute.tsx#L141)). The tab switcher does NOT add or duplicate the lifecycle effect.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md) — the upstream broadcast that populates `pendingProposals`. This leaf consumes the already-Cucumber-pinned data flow without modifying the protocol or projector; Decision §7 explains why no new Cucumber scenario is warranted.
- [`tasks/refinements/moderator-ui/mod_right_sidebar.md`](../moderator-ui/mod_right_sidebar.md) — the moderator's pending-proposals surface lives in a stacked accordion in the right sidebar. The participant uses a tab switcher (per `docs/participant-ui.md`) — geometry mismatch is deliberate, not a candidate for shell extraction yet (Decision §5).

### Live code the surface plugs into

- [`apps/participant/src/routes/OperateRoute.tsx:131-156`](../../../apps/participant/src/routes/OperateRoute.tsx#L131) — the route's outer composition. The `main={<OperateRouteBody id={id} />}` prop changes to `main={<OperateRouteMain id={id} />}` (where `OperateRouteMain` is the new wrapper that owns the tab strip + conditional body). The `<ParticipantLayout>` call site, the per-session subscription effect, and the header + footer slots are unchanged.
- [`apps/participant/src/routes/OperateRoute.tsx:193-353`](../../../apps/participant/src/routes/OperateRoute.tsx#L193) — `OperateRouteAuthenticatedBody`. The eight-memo projection chain (lines 232-281) stays in place; the existing two-column return (lines 322-353) becomes one of two branches inside the new tab-switching wrapper. Per Decision §4 the projection chain runs regardless of which tab is foregrounded — projection memos are pure and cheap-relative-to-rendering, and lifting them out of the rendered tree would split into render-budgets that complicate the next leaf's job.
- [`apps/participant/src/stores/uiStore.ts:19-44`](../../../apps/participant/src/stores/uiStore.ts#L19) — `useUiStore`, `currentTab`, `setCurrentTab`. Consumed unchanged; no store-shape edits.
- [`apps/participant/src/ws/wsStore.ts:79-90`](../../../apps/participant/src/ws/wsStore.ts#L79) — the `pendingProposals` map slot inside per-session state. Consumed unchanged; the selector hook reads from it via `useWsStore` with a stable reference-equality fallback.
- [`apps/participant/src/layout/ParticipantLayout.tsx:68-74`](../../../apps/participant/src/layout/ParticipantLayout.tsx#L68) — the `<main data-testid="participant-main" className="overflow-auto bg-white">` slot. The tab strip + active-tab content land inside this slot via the `main={...}` prop on the `<ParticipantLayout>` call site. The layout file itself is NOT edited (Decision §1's rationale).

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — the `participant.*` namespace today carries `placeholder.*`, `identity.*`, `notAuthenticated.*`, `chrome.*`, `statusIndicator.*`, `inviteAcceptance.*`, `lobby.*`. This leaf adds two new sub-namespaces: `proposalsTab.*` (two keys: `graphLabel`, `proposalsLabel`) and `pendingProposalsPane.*` (one key: `emptyState`). Three new keys total.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — both gain the three new dotted keys under `pending`, mirroring the existing chain leaves' patterns.

### Existing fixtures the Playwright spec composes with

- [`playwright.config.ts`](../../../playwright.config.ts) — the existing `chromium-participant-skeleton` and `chromium-participant-graph` projects bracket the participant-side Playwright suites. This leaf's new spec runs under `chromium-participant-graph` since it needs the full operate-route mount (graph projection chain) to exercise the tab switch against a populated body — Decision §8 covers project picking.
- [`tests/e2e/participant-graph-render.spec.ts`](../../../tests/e2e/participant-graph-render.spec.ts) — the predecessor spec that mounts `<OperateRoute>` under a populated session fixture (proposals + votes already in the event log). The new spec follows the same fixture pattern (compose-stack seed → moderator captures one proposal so `pendingProposals` is non-empty when tested).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` — NEW. The two-button tab strip.
- `apps/participant/src/proposals/PendingProposalsTabBar.test.tsx` — NEW. Vitest cases pinning the visual + click + badge contract.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — NEW. The empty-shell pane component.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — NEW. Vitest cases pinning the empty-state branch.
- `apps/participant/src/proposals/usePendingProposalsCount.ts` — NEW. The selector hook.
- `apps/participant/src/proposals/usePendingProposalsCount.test.ts` — NEW. Vitest cases pinning the selector across empty / non-empty / missing-session.
- `apps/participant/src/proposals/index.ts` — NEW. Barrel export for the three new symbols.
- `apps/participant/src/routes/OperateRoute.tsx` — modified. The `<OperateRouteAuthenticatedBody>` return wraps in a column-flex container; the existing two-column body becomes one of two branches inside the wrapper. The route-level effect, the projection chain, and the `<ParticipantLayout>` call site are unchanged.
- `apps/participant/src/routes/OperateRoute.test.tsx` — modified. One new case: tab-switch flips which body region is in the DOM.
- `tests/e2e/participant-pending-proposals.spec.ts` — NEW. The new Playwright spec covering tab-mount + tab-switch + empty-state.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Three new keys (`participant.proposalsTab.graphLabel`, `participant.proposalsTab.proposalsLabel`, `participant.pendingProposalsPane.emptyState`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same three keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same three keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds the three dotted keys to `pending`.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.
- `tasks/35-frontend-i18n.tji` — modified. Registers a new `i18n_participant_proposals_tab_native_review` leaf chained after the current native-review chain tail (`i18n_participant_lobby_native_review`).

### Files this task does NOT touch

- `apps/participant/src/layout/ParticipantLayout.tsx` — the layout's slot contract is consumed unchanged. No new prop, no new testid, no geometry change.
- `apps/participant/src/layout/ParticipantStatusIndicator.tsx` — the footer chip is unaffected by the tab switcher.
- `apps/participant/src/main.tsx`, `apps/participant/src/App.tsx` — provider wiring + route table unchanged.
- `apps/participant/src/stores/uiStore.ts` — `useUiStore` consumed unchanged; no store-shape edits.
- `apps/participant/src/ws/wsStore.ts` — `useWsStore.sessionState[id].pendingProposals` consumed unchanged; no store-shape edits.
- `apps/participant/src/graph/*` — the graph view + projection helpers stay where they are (Decision §4 keeps the chain hoisted at the route).
- `apps/participant/src/detail/*` — the entity-detail panel + per-facet vote buttons are unchanged; tab switching does not affect the detail panel's own flow.
- `apps/participant/package.json` / `apps/participant/vite.config.ts` / `apps/participant/tsconfig.json` — no new runtime dep, no new build config, no new project reference.
- `packages/shell/` — no shell extraction. The tab switcher is participant-local; Decision §5 covers when a shell-level extraction would be warranted.
- `apps/root/` / `apps/server/` / `apps/moderator/` / `apps/audience/` — no cross-surface change.
- `playwright.config.ts` — no new Playwright project; the new spec runs under the existing `chromium-participant-graph` project (Decision §8).
- `tasks/40-participant-ui.tji` — the `complete 100` marker for `part_proposals_tab` lands at task-completion time per the ritual in [`tasks/refinements/README.md`](../README.md#L32-L42); not part of this refinement's allowlist.
- `docs/adr/` — no new ADR (every decision below applies an existing ADR or scopes a UI policy).

### Component shape (`apps/participant/src/proposals/PendingProposalsTabBar.tsx`)

Sketch:

```tsx
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiStore, type ParticipantTab } from '../stores/uiStore';

import { usePendingProposalsCount } from './usePendingProposalsCount';

interface PendingProposalsTabBarProps {
  sessionId: string;
}

export function PendingProposalsTabBar({ sessionId }: PendingProposalsTabBarProps): ReactElement {
  const { t } = useTranslation();
  const currentTab = useUiStore((s) => s.currentTab);
  const setCurrentTab = useUiStore((s) => s.setCurrentTab);
  const count = usePendingProposalsCount(sessionId);
  return (
    <div
      data-testid="participant-proposals-tabbar"
      role="tablist"
      className="flex h-10 items-center gap-1 border-b border-slate-200 bg-white px-4"
    >
      <TabButton tab="graph" active={currentTab === 'graph'} onSelect={setCurrentTab}>
        {t('participant.proposalsTab.graphLabel')}
      </TabButton>
      <TabButton tab="proposals" active={currentTab === 'proposals'} onSelect={setCurrentTab}>
        {t('participant.proposalsTab.proposalsLabel')}
        <span
          data-testid="participant-proposals-tabbar-badge"
          data-count={count}
          className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-200 px-1.5 text-xs font-medium text-slate-700"
        >
          {count}
        </span>
      </TabButton>
    </div>
  );
}

function TabButton({
  tab,
  active,
  onSelect,
  children,
}: {
  tab: ParticipantTab;
  active: boolean;
  onSelect: (tab: ParticipantTab) => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={`participant-proposals-tabbar-${tab}`}
      data-active={active}
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab)}
      className={`flex h-8 items-center rounded-md px-3 text-sm font-medium ${
        active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
```

- `role="tablist"` + `role="tab"` + `aria-selected` is the WAI-ARIA tab pattern. `aria-controls` is intentionally NOT set on this leaf — the pane's `id` is assigned by `<PendingProposalsPane>` and the wiring `aria-controls={paneId}` adds a coupling between the two components for marginal a11y benefit on a two-tab strip; a sibling leaf can layer the `aria-controls` wiring if a screen-reader audit later flags it.
- `data-active="true|false"` on each tab is the e2e selector; `data-count={count}` on the badge is the e2e selector for the count assertion.
- The badge is always rendered (even when count is `0`) so the testid stays stable across the empty / non-empty transition — a hide-when-zero variant would force the Playwright spec to branch its selectors on the count value, which is more brittle than rendering a `0` chip.
- The button is a `<button type="button">` — not a `<div>` with `onClick` — so keyboard focus + space/enter activation work without extra handlers.

### Component shape (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Sketch:

```tsx
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useWsStore } from '../ws/wsStore';

interface PendingProposalsPaneProps {
  sessionId: string;
}

export function PendingProposalsPane({ sessionId }: PendingProposalsPaneProps): ReactElement {
  const { t } = useTranslation();
  const pendingProposals = useWsStore((s) => s.sessionState[sessionId]?.pendingProposals);
  const isEmpty = pendingProposals === undefined || Object.keys(pendingProposals).length === 0;
  return (
    <section
      data-testid="participant-pending-proposals-pane"
      role="tabpanel"
      aria-live="polite"
      className="flex h-full w-full flex-col overflow-auto bg-white"
    >
      {isEmpty ? (
        <div
          data-testid="participant-pending-proposals-pane-empty"
          className="flex h-full w-full items-center justify-center p-6 text-sm text-slate-500"
        >
          {t('participant.pendingProposalsPane.emptyState')}
        </div>
      ) : (
        <ul
          data-testid="participant-pending-proposals-pane-list"
          aria-label={t('participant.pendingProposalsPane.emptyState')}
          className="flex flex-col"
        >
          {/* Sibling leaf `part_proposal_list_view` renders rows here.
              This shell intentionally renders an empty <ul> in the
              non-empty branch so the list-view leaf can replace the
              children without re-deciding the container shape. */}
        </ul>
      )}
    </section>
  );
}
```

- The non-empty branch renders an empty `<ul>` rather than nothing so the testid `participant-pending-proposals-pane-list` is stable for the list-view leaf to assert against (sibling leaf can then assert `findAllByRole('listitem')`). Without the stable container, the list-view leaf would have to invent a wrapper of its own.
- `role="tabpanel"` + `aria-live="polite"` mirror the WAI-ARIA tab pattern; updates announce on assistive tech without interrupting.
- The pane is the *active-tab content for `currentTab === 'proposals'`*; the route's wrapper decides which tab is rendered. The pane is NOT a tab-aware component itself — it always renders its body and trusts the parent to mount/unmount on tab change.

### Selector hook shape (`apps/participant/src/proposals/usePendingProposalsCount.ts`)

```tsx
import { useWsStore } from '../ws/wsStore';

export function usePendingProposalsCount(sessionId: string): number {
  return useWsStore((s) => {
    const map = s.sessionState[sessionId]?.pendingProposals;
    return map === undefined ? 0 : Object.keys(map).length;
  });
}
```

- Zustand selector returns a primitive (`number`), so reference-equality bailout is intrinsic — no `shallow` import needed.
- Sessions that have not yet received any `proposal-status` broadcast return `0` (the selector handles the undefined-pendingProposals case at the same site).
- The hook is an unconditional `useWsStore(...)` call — no `useMemo`, no `useEffect`. Future swap to a filtered-by-participant count (when `part_vote_indicators_in_pane` lands) replaces the selector body; the call-site contract (returns `number`) stays.

### Route restructure (`apps/participant/src/routes/OperateRoute.tsx`)

The existing `OperateRouteAuthenticatedBody` return:

```tsx
return (
  <div data-testid="route-operate" className="flex h-full w-full">
    <div data-testid="route-operate-graph-region" className="flex-1 min-w-0">
      <GraphView ... />
    </div>
    <EntityDetailPanel ... />
  </div>
);
```

becomes:

```tsx
const currentTab = useUiStore((s) => s.currentTab);
return (
  <div data-testid="route-operate" className="flex h-full w-full flex-col">
    <PendingProposalsTabBar sessionId={id} />
    <div data-testid="route-operate-active-tab" className="flex flex-1 overflow-hidden">
      {currentTab === 'graph' ? (
        <div data-testid="route-operate-graph-region" className="flex h-full w-full">
          <div className="flex-1 min-w-0">
            <GraphView ... />
          </div>
          <EntityDetailPanel ... />
        </div>
      ) : (
        <PendingProposalsPane sessionId={id} />
      )}
    </div>
  </div>
);
```

- Outer `flex-col` stacks the tab bar + active content vertically; inner `flex flex-1 overflow-hidden` is the active-content container.
- `route-operate` keeps its testid so existing OperateRoute.test.tsx + Playwright cases stay valid.
- `route-operate-graph-region` keeps its testid + content shape; it just becomes one branch of the tab conditional. The existing `<GraphView>` + `<EntityDetailPanel>` props + projection prop-thread are unchanged.
- The eight-memo projection chain runs at the parent (`OperateRouteAuthenticatedBody`) regardless of `currentTab`. Decision §4 is explicit about why.

### What the new components MUST NOT do

- **No `fetch`, no `WebSocket`, no subscription side effects.** All three new files are render-only consumers of the existing stores. Any side effects belong inside the WS-client or the per-session lifecycle effect (already in `<OperateRoute>`).
- **No direct `useWsStore.setState` writes.** `<PendingProposalsTabBar>` writes to `useUiStore` (tab state — surface-local UI concern); `<PendingProposalsPane>` + `usePendingProposalsCount` only read. The `pendingProposals` map is written only by the shell WS client's envelope dispatch per `part_state_management` Decision §3.
- **No router-level state for the tab.** `useNavigate`, `useSearchParams`, `window.history` are NOT consumed. Tab state lives in `useUiStore` only (Decision §6).
- **No imperative focus-stealing.** The tab buttons accept native browser focus on click; no `ref.current.focus()` in `useEffect`.
- **No animation, no transition CSS, no spinner.** The tab switch is an instantaneous DOM swap; a future visual-polish leaf can layer a fade if needed.
- **No `useEffect` in the three new files** other than the structural prop-driven react state. The selector hook is a pure `useWsStore(...)` call. Tab-bar + pane components use `useTranslation` + the store hooks; no `useEffect` is needed for the seam.

### Test layers per ADR 0022

Five pins, each anchoring a different observable property:

1. **Vitest `PendingProposalsTabBar.test.tsx` (NEW)** — cases:
   - (a) Renders two `role="tab"` buttons with the en-US labels.
   - (b) `currentTab === 'graph'` → the Graph button carries `data-active="true"` and `aria-selected="true"`; Proposals button carries `data-active="false"`.
   - (c) Clicking Proposals dispatches `setCurrentTab('proposals')` (assert via store-state-after-click).
   - (d) Badge `data-count` reflects `Object.keys(sessionState[sid].pendingProposals).length` for an empty session (`0`) and for a session with two proposals seeded via `useWsStore.setState` (`2`).
   - (e) Badge renders the count text content matching `data-count`.
   - Total: 6 cases. Smoke count grows by +6.
2. **Vitest `PendingProposalsPane.test.tsx` (NEW)** — cases:
   - (a) `pendingProposals` undefined → empty-state visible with the en-US label.
   - (b) `pendingProposals === {}` → empty-state visible.
   - (c) `pendingProposals === { p1: {...} }` → empty-state hidden, the empty `<ul>` testid (`participant-pending-proposals-pane-list`) visible.
   - (d) Pane container carries `role="tabpanel"` + `aria-live="polite"`.
   - Total: 4 cases. Smoke count grows by +4.
3. **Vitest `usePendingProposalsCount.test.ts` (NEW)** — cases:
   - (a) Missing session → `0`.
   - (b) Empty pendingProposals → `0`.
   - (c) Two proposals → `2`.
   - (d) Adding a proposal via `useWsStore.setState` re-runs the selector (the consuming component re-renders).
   - Total: 4 cases. Smoke count grows by +4.
4. **Vitest `OperateRoute.test.tsx` (extended)** — one new case: starting with `currentTab === 'graph'`, the graph region testid is visible and the pane testid is absent; dispatching `setCurrentTab('proposals')` causes the pane testid to be visible and the graph region testid to be absent. The route-level subscription effect + the eight-memo projection assertions remain unchanged. Case count grows by +1.
5. **Playwright `tests/e2e/participant-pending-proposals.spec.ts` (NEW)** — one scenario:
   - Authenticated participant lands on `/p/sessions/<uuid>` after the moderator captures one proposal so `pendingProposals` is non-empty.
   - Assert the tab bar visible with both buttons; Graph carries `data-active="true"`; badge `data-count="1"`.
   - Click the Proposals tab; assert `data-active` flips, the pane is visible, the graph region is absent. With `pendingProposals` non-empty, the empty-state is hidden and the list `<ul>` testid is visible.
   - Click the Graph tab; assert the graph region is visible again and the pane is absent.
   - A second sub-assertion: start a session with NO proposals; navigate to the proposals tab; the empty-state testid is visible with the en-US message text.
   - One scenario, ~30 assertions, runs under the existing `chromium-participant-graph` project per Decision §8.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright is the default.** The participant operate route is reachable from the root (commits `918f164` / `5ac98be`); this leaf makes the proposals-tab affordance user-visible the moment it lands. Per the orchestrator note, the surface IS reachable today (the operate route mounts under `/p/sessions/:id`) — full deferral to a future `part_pw_*` catch-all would be the exception, not the default. The new spec covers tab-mount + tab-switch + empty-state + non-empty-state in one scenario; no e2e is deferred from this leaf.

The badge-filter refinement deferred to `part_vote_indicators_in_pane` (Decision §3) ships its own Playwright coverage when it lands — the count assertion in this leaf's spec stays `data-count="1"` (total) and the future leaf's spec asserts the filtered semantic ("needs your vote"). The two coexist without churning this leaf's spec.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, and NO projector output. It consumes `pendingProposals` as already broadcast by `ws_proposal_status_broadcast` and already projected into the per-session store by the shared dispatch. The orchestrator note flags Cucumber as the right pin for surfaces that touch WS subscription or projector behavior — this surface only *reads* an already-pinned data slot. No Cucumber scenario is needed (Decision §7). If the per-participant-filter refinement in `part_vote_indicators_in_pane` exposes a new derivation that crosses the protocol boundary (it won't — the per-participant projection is client-local), that leaf's refinement can re-evaluate.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~45 min: write the three component/hook files (~140 LOC total including the per-state mapping + render branches + comments).
- ~1.5h: write the three Vitest test files (~280 LOC for the 14 cases + the per-case store-state setup + cleanup).
- ~30 min: extend `OperateRoute.test.tsx` with the tab-switch case + verify the existing projection-chain assertions still pass.
- ~30 min: restructure `OperateRoute.tsx`'s authenticated-body return + smoke-test in `pnpm run test:smoke` to ensure the existing route assertions still pass.
- ~1h: write the Playwright spec; verify under the compose stack with seeded proposals.
- ~30 min: add three new i18n keys across en-US + pt-BR + es-419 + the two review.json pending lists; verify catalog parity check; register the native-review chain leaf in `tasks/35-frontend-i18n.tji`.
- ~1h: visual sanity at 1280×720 + 1024×768 viewports — verify the tab strip's 40 px height fits inside the main region without affecting the graph viewport size below it; verify the badge's slate-200 chip is legible against the white tab-bar background.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + the WBS-status ritual.

Risk surface is modest. The two non-trivial decisions (tab-strip placement; badge-count filter scope) are explicitly settled below. The biggest implementation hazard is the OperateRoute restructure — keeping the eight-memo projection chain hoisted while flipping the rendered subtree on tab change requires care that the projection's dep arrays don't change shape (Decision §4 keeps the chain at the parent so deps are stable).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes; the lockfile should not move (other than the harmless `@a-conversa/i18n-catalogs` workspace re-link triggered by JSON edits).
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the three new files, the extended OperateRoute, and the extended OperateRoute.test.tsx all compile under TypeScript strict mode ([ADR 0013](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md)).
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessors pinned; bundle filename / sidecar shape unchanged; new components are tree-shaken into the existing bundle.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+15** (6 from PendingProposalsTabBar.test.tsx + 4 from PendingProposalsPane.test.tsx + 4 from usePendingProposalsCount.test.ts + 1 from the OperateRoute.test.tsx extension).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the three new keys (`participant.proposalsTab.graphLabel`, `participant.proposalsTab.proposalsLabel`, `participant.pendingProposalsPane.emptyState`) are present in all three locales; pt-BR + es-419 drafts flagged PENDING in `*.review.json`.
7. **`pnpm run test:e2e --project=chromium-participant-graph`** under `make up` runs the new `participant-pending-proposals.spec.ts` green inside the existing project. The existing `participant-graph-render.spec.ts` scenarios pass unchanged (the OperateRoute restructure preserves `route-operate` + `route-operate-graph-region` testids).
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The three new files own no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams` under `apps/participant/src/proposals/` returns zero matches.
10. **The projection chain is unchanged** — `apps/participant/src/routes/OperateRoute.tsx`'s eight `useMemo` calls (lines 232-281 today) keep their identity (same dep arrays, same parent location); a diff inspection by the closer confirms only the *return JSX* moved, not the projection logic.
11. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_proposals_tab` task block per the task-completion ritual in [`tasks/refinements/README.md`](../README.md#L32-L42); separately, after the new `i18n_participant_proposals_tab_native_review` leaf lands in `tasks/35-frontend-i18n.tji`.
12. **Predecessor's existing assertions unchanged** — `OperateRoute.test.tsx`'s existing cases pass; `participant-graph-render.spec.ts`'s scenarios pass; the route-level `client.trackSession(id)` / `client.untrackSession(id)` lifecycle effect at OperateRoute.tsx:141-147 is unchanged.

## Decisions

### 1. Tab strip lives at top of `<participant-main>`, not in `<participant-header>`

Three alternatives surveyed for tab placement:

- **(A) Tab strip inside the 48 px `<participant-header>`** — packed between the product label and the identity row, or replacing one of them. Rejected. The header is already populated (product label left, identity row right) and the badge would have to fit in a sub-pixel-tight slot. The chrome carries identity-of-participant; a tab switcher is an in-content-region nav concern. Mixing the two seams confuses the responsibility split (`part_landscape_layout` deliberately separated chrome from content).
- **(B) Tab strip as a row above the active-tab content, inside the `<participant-main>` slot** (chosen). 40 px-tall strip with two `role="tab"` buttons; the active-tab content (graph or pane) takes the rest of the `1fr` main region. The strip is participant-surface-local — the layout component itself stays untouched (`<ParticipantLayout>` only knows about `main={...}` slot composition).
- **(C) Floating tab pill overlay** anchored top-right of the graph region. Rejected. Overlay UX on a touch tablet competes with the entity-detail panel's right-side slot; the badge could land under a fingertip during a gesture; and the overlay shape requires `position: absolute` math that fights the layout's `overflow: auto`.

The chosen approach also makes the tab strip *participant-local* — if a future audience surface or replay surface picks up a similar pattern, this leaf is a copy-paste template, not a shell extraction precondition (see Decision §5).

### 2. Badge always renders (even at count `0`); not hide-when-zero

Two alternatives surveyed for the badge's empty rendering:

- **(A) Hide the badge when count is `0`** — only render the chip when there are pending proposals. Rejected. The testid `participant-proposals-tabbar-badge` would appear and disappear on every transition, forcing the e2e to branch its selectors (`if (await badge.isVisible()) ...`). A stable testid + `data-count="0"` value is the cleaner pin.
- **(B) Always render the badge with `data-count` reflecting the value** (chosen). The chip shows `0` when empty (a visual cue that the surface is *thinking about* pending proposals even if there are none right now). The badge's slate-200 background is muted enough that the `0` does not visually crowd; the chip is `min-w-[1.25rem]` so it stays a circle-ish shape at single-digit counts and grows to a pill at double-digits.

### 3. Badge counts *total* pending proposals; per-participant-filter deferred to `part_vote_indicators_in_pane`

Three alternatives surveyed for the badge's count semantic:

- **(A) Total `pendingProposals` count** (chosen for *this* leaf). `Object.keys(sessionState[sid].pendingProposals).length`. The simplest honest count, derivable from one already-projected store slot with zero new logic.
- **(B) "Facets across all proposals still need this debater's vote"** (the design spec, per `docs/participant-ui.md:132`). The proper filter is `Σ facets where status === 'proposed' AND this participant has not voted on the live candidate`. That requires (a) walking `perFacetStatus` arms inside each pending proposal, (b) cross-referencing `projectOwnVotes` (which lives in the projection chain at `OperateRoute.tsx:245-247`) for "this participant's per-facet votes", and (c) deciding the cardinality unit (one count per facet, or one count per proposal). Rejected for *this* leaf — the per-participant projection's site of truth is the sibling leaf `part_vote_indicators_in_pane` (0.5d, depends `!part_per_facet_breakdown_in_pane`) which has the projection on hand AND the rendering context to disambiguate facet-cardinality from proposal-cardinality. Landing it here would mean (a) lifting `projectOwnVotes` out of the projection chain (or duplicating it) for a surface that does not yet render per-facet rows, and (b) committing to a count semantic that the per-pane vote-indicators leaf is better positioned to settle.
- **(C) Hybrid — total here, with a `TODO` comment in the selector hook** noting the future swap. Rejected as a tech-debt anti-pattern; the chosen approach replaces the comment with a structured tech-debt registration (sibling leaf already exists in WBS; this refinement names it explicitly).

The closer of `part_vote_indicators_in_pane` is responsible for: (i) replacing `usePendingProposalsCount`'s body with the filtered selector, (ii) updating this leaf's Vitest fixtures (the four `usePendingProposalsCount.test.ts` cases will need additional fixture state for the per-participant projection), and (iii) updating this leaf's Playwright spec's `data-count="1"` assertion to match the filtered semantic. The seam is structurally preserved — the selector hook's return type (`number`), the badge's render contract (`data-count={count}`), and the call-site at the tab bar all stay.

### 4. Projection chain stays hoisted at the route; runs regardless of foregrounded tab

Three alternatives surveyed for projection-chain placement under the new tab seam:

- **(A) Keep the chain hoisted at `OperateRouteAuthenticatedBody`; it runs whether `currentTab` is `'graph'` or `'proposals'`** (chosen). Memos are pure; their inputs (`events`, `activeDiagnostics`, `currentParticipantId`) don't change because the tab changed; React's memo bailout means the actual *projection* re-runs only when WS frames land, not on tab change. The pane (when it later renders proposal rows) MAY consume some of the same projected data — keeping the chain at the parent means it's already there.
- **(B) Lift the chain into a sibling `<GraphTabBody>` component** so it runs only when the graph tab is foregrounded. Rejected. Three problems: (i) the chain's dep arrays would have to be re-wired from prop-thread to local computation (defeating Decision §2 of `part_entity_detail_panel`); (ii) tab-switching back to graph would force the chain to re-run from scratch (it's a Cytoscape input — the graph re-mounts from zero each time); (iii) the pane leaves that come next (e.g. `part_vote_indicators_in_pane`) will consume some of the same projections — pre-computing them at the parent avoids re-deriving in the sibling.
- **(C) Memoize the chain to a per-session global** (e.g., a zustand slice that caches projected outputs). Rejected — premature optimization. The chain already runs at React render granularity with proper `useMemo` discipline; lifting it out adds invalidation complexity for no measured win.

The chosen approach is *load-bearing* on the projection memos being inputs-pure. The closer for this leaf is expected to spot-check the memo dep arrays after the restructure (acceptance criterion §10) so a stray refactor doesn't accidentally change a dep.

### 5. Participant-local components; no shell extraction yet

Three alternatives surveyed for component locality:

- **(A) Extract `<TabBar>` / `<TabPanel>` into `@a-conversa/shell` immediately** so any future surface (audience, replay) can consume the same primitive. Rejected. The shell extraction needs at least two consuming surfaces with substantially-overlapping requirements (per the pattern established by `shell_substrate_extraction`); a single participant consumer with a two-button tab strip is too thin to justify the package boundary. The moderator's pending-proposals surface lives in a stacked accordion (different geometry); no other surface has a tab requirement on the horizon today.
- **(B) Participant-local but in a generic `apps/participant/src/components/TabBar.tsx`** — so future participant-side tab needs can compose. Rejected. There are no other participant-side tab needs in the WBS; building for a hypothetical second consumer adds abstraction surface that we'd have to revisit when the second consumer's needs actually shape the API.
- **(C) Participant-local under `apps/participant/src/proposals/`** (chosen) — the components are named after their concrete purpose (`<PendingProposalsTabBar>`, `<PendingProposalsPane>`) and live in a directory dedicated to the pending-proposals subgroup. If a second participant-side tab need ever arises, a future refactor can extract; if a second surface ever picks up the pattern, a future shell extraction can lift.

Naming choice: `apps/participant/src/proposals/` (not `apps/participant/src/tabs/` or `apps/participant/src/pending/`). The directory name reflects the *domain* (pending proposals), which is the subgroup the sibling leaves all share — list view, expand, per-facet breakdown, vote indicators all go in the same directory.

### 6. Tab state in `useUiStore` only; not in URL / `useSearchParams`

Two alternatives surveyed:

- **(A) Tab state in `useUiStore.currentTab`** (chosen). Already the settled shape per `part_state_management`. In-memory; resets on full reload (the typical participant flow is in-session, so this is the right scope). No route table edits needed.
- **(B) Tab state in the URL via `useSearchParams` (`?tab=graph` vs `?tab=proposals`)** or path segment (`/p/sessions/:id/graph` vs `/p/sessions/:id/proposals`). Rejected. Adds router redesign (path segment) or a new query-param convention (search params), neither of which any other participant route uses. Bookmarkability and reload-preserves-tab are non-features for the participant (the surface is tablet-local; URL reload usually means session-restart). The future "deep-link from the lobby into a specific proposal" use case (if it ever materializes) would need a `?proposal=<id>` segment regardless of where tab state lives — orthogonal to this leaf.

### 7. No Cucumber scenario; Vitest + Playwright suffice

Two alternatives surveyed for protocol-boundary coverage:

- **(A) Add a Cucumber scenario** in the existing pglite-driven step definitions that asserts "when a proposal-status broadcast lands, the participant's pending-proposals count is N". Rejected. The broadcast → store-application path is *already* Cucumber-pinned by `ws_proposal_status_broadcast`'s scenarios (which assert envelope shape + projector output + per-session state). This leaf is a UI consumer of the already-pinned data; the UI's count-derivation is a pure-function of the store slot, which Vitest pins exhaustively. Adding a Cucumber scenario would assert the same property at a higher cost without catching a class of bug the existing scenarios miss.
- **(B) Skip Cucumber; rely on Vitest unit pin + Playwright e2e pin** (chosen). The Vitest cases pin the selector's correctness across empty / non-empty / missing-session states; the Playwright scenario pins the end-to-end "broadcast lands → badge updates → click switches tab → empty/non-empty state visible" flow under the real compose stack. The orchestrator's "lean toward growing Cucumber" guidance applies when a surface ADDS wire/projector behavior — this surface only reads.

If `part_vote_indicators_in_pane`'s refinement ever introduces a NEW per-participant projection that crosses the protocol boundary, that leaf's refinement can re-evaluate Cucumber coverage at that point.

### 8. Playwright spec runs under `chromium-participant-graph`, not `chromium-participant-skeleton`

Two alternatives surveyed for the Playwright project:

- **(A) Run under `chromium-participant-skeleton`** — the lightweight project that does NOT seed session content. Rejected. The empty-state assertion can be made under skeleton (no session, no proposals), but the non-empty-state assertion needs at least one proposal in the event log, which requires the seeded session fixture that `chromium-participant-graph` already provides. Splitting the spec across two projects would mean two fixture setups, two test files, or a conditional that gates on the project name.
- **(B) Run under `chromium-participant-graph`** (chosen) — the project that already mounts the operate route under a populated session fixture (the `participant-graph-render.spec.ts` sibling proves the fixture works). Both empty-state and non-empty-state assertions land in the same spec file under one project. No new Playwright project added.

The spec's "empty-state" sub-assertion handles the no-proposals case by walking to a session that has no proposals (the fixture supports a session-with-zero-proposals variant); the "non-empty-state" sub-assertion uses the standard seeded session.

### 9. Tech-debt registration

Three follow-ups named crisply for the closer:

- **`frontend_i18n.i18n_participant_proposals_tab_native_review`** — pt-BR + es-419 native-speaker review of the three new `participant.proposalsTab.*` + `participant.pendingProposalsPane.*` keys. Effort: 0.25d. Chained after the current native-review chain tail (`i18n_participant_lobby_native_review` per [`tasks/35-frontend-i18n.tji:342-346`](../../35-frontend-i18n.tji#L342)). **Action for Closer**: register this as a new WBS leaf in `tasks/35-frontend-i18n.tji` when the task completes, with `depends !i18n_participant_lobby_native_review, participant_ui.part_pending_proposals.part_proposals_tab`.
- **Per-participant filter for the badge count** — refinement to "facets across all proposals still need this debater's vote" lands when `part_vote_indicators_in_pane` (already a WBS leaf, 0.5d, depends `!part_per_facet_breakdown_in_pane`) ships. No new WBS leaf needed; this refinement's Decision §3 names the existing leaf as the home and enumerates the closer's responsibilities (selector body swap, Vitest fixture extension, Playwright count-assertion update).
- **Proposal-flash on the graph for new proposals** — the "graph view also visually flashes the affected entity briefly" cue from `docs/participant-ui.md:82` is not on the M3-pending-pane critical path. It is *not yet* a WBS leaf. **Action for Closer**: do NOT register a new leaf unprompted; the orchestrator can decide whether to add `part_pending_proposals.part_proposal_flash` (0.5d, depends `!part_pending_proposals`) when the pending-pane subgroup ships. Mention in the Status block as a "future possible follow-up" so the orchestrator's next pick-task pass sees the gap.

### 10. No new ADR needed

This task introduces no new architectural choices that go beyond existing precedents. Every decision above is either:

- A direct application of an existing ADR (0005's Tailwind-with-deferred-tokens; 0022's committed-test discipline; 0024's host-supplied-i18n; 0026's surface-consumes-from-shell; 0030's per-facet/per-proposal data model).
- A scoped UI policy that doesn't constrain other tasks (Decisions §1, §2, §3, §5, §6, §8, §9).
- A direct consumer of existing store slots without widening them.

The "no new dependencies" rule is satisfied; the participant `package.json` is unchanged. The "no new shell substrate" rule is honored; the components are participant-local. The WAI-ARIA tab pattern (`role="tablist"` / `role="tab"` / `role="tabpanel"` / `aria-selected`) is the canonical recipe and needs no project-local rationale.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-25.

- Shipped the participant operate-route tab seam: top-of-main two-button `<Graph|Proposals[count]>` strip wired to `useUiStore.currentTab`, stable empty `<PendingProposalsPane>` shell, and a `usePendingProposalsCount` selector — all participant-local, projection chain kept hoisted at the route per Decision §4. Files: `apps/participant/src/proposals/{PendingProposalsTabBar,PendingProposalsPane,usePendingProposalsCount,index}.{ts,tsx}` + matching `*.test.tsx?` (six new files; barrel + three component/hook + three test files).
- `apps/participant/src/routes/OperateRoute.tsx` restructured: the existing two-column `<GraphView>` + `<EntityDetailPanel>` return is now one of two branches inside a column-flex wrapper whose first row is `<PendingProposalsTabBar>` and whose second row conditions on `currentTab`. The eight-memo projection chain is unmoved; `<PendingProposalsPane>` mounts when `currentTab === 'proposals'`.
- `apps/participant/src/routes/OperateRoute.test.tsx` gains one case `(j)` covering the tab-switch flip + a per-test `useUiStore.setState({ currentTab: 'graph' })` reset in `afterEach`. Vitest count: 4543 → 4558 (+15, matches the refinement plan's per-test budget).
- Three new i18n keys (`participant.proposalsTab.graphLabel`, `participant.proposalsTab.proposalsLabel`, `participant.pendingProposalsPane.emptyState`) landed in en-US + pt-BR + es-419 catalogs with pt-BR/es-419 drafts flagged PENDING in `*.review.json` (three new dotted keys each, mirroring the existing chain pattern).
- New Playwright spec `tests/e2e/participant-pending-proposals.spec.ts` (+1 scenario, total 145 → 146) covers tab-mount + click-to-proposals + empty-state visible + click-back-to-graph + graph visible.
- **Infra fix (outside refinement allowlist):** `playwright.config.ts` `testMatch` regex for `chromium-participant-skeleton` was widened from `participant-(skeleton-smoke|invite-acceptance|lobby|graph-render)` to additionally include `pending-proposals`. The refinement's Decision §8 had named `chromium-participant-graph` as the host project, but no such project exists in `playwright.config.ts` — `participant-graph-render.spec.ts` actually runs under the regex-gated `chromium-participant-skeleton`. This is a refinement-§8 host-project name correction; the edit follows the precedent set by the four predecessor specs already in the regex.
- Cucumber suite unchanged (263 scenarios) — Decision §7 of this refinement excludes a BDD scenario (the upstream `proposal-status` flow is already Cucumber-pinned and this leaf consumes the data read-only).
- Tech-debt registered in the same commit: `frontend_i18n.i18n_participant_proposals_tab_native_review` (0.25d, chained after `i18n_participant_lobby_native_review` + `participant_ui.part_pending_proposals.part_proposals_tab`) — covers pt-BR + es-419 native-speaker review of the three new keys.
- Future possible follow-up (not registered — orchestrator's call): `part_pending_proposals.part_proposal_flash` (0.5d) for the `docs/participant-ui.md:82` "graph view also visually flashes the affected entity briefly" cue.
