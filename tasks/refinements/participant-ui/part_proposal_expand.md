# Tap to expand a pending proposal row

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_pending_proposals.part_proposal_expand`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_pending_proposals.part_proposal_list_view` (settled — commit `a89265c` shipped the row renderer. The participant pane now mounts one `<li data-testid="participant-pending-proposal-row">` per surviving in-flight proposal with `data-proposal-id` keyed to `event.id`; four child cells carry `participant-pending-proposal-row-{kind,summary,author,timestamp}` testids; the rows are non-interactive in v1. The row source-of-truth is the event log walked by `derivePendingProposals` ([`apps/participant/src/proposals/derivePendingProposals.ts`](../../../apps/participant/src/proposals/derivePendingProposals.ts)); the renderer in [`apps/participant/src/proposals/PendingProposalsPane.tsx:91-138`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L91) is the seam this leaf wraps in a header/body split — the four cells stay as the collapsed-header content; a new sibling region inside the same `<li>` carries the expanded body.).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_pending_proposals.part_proposals_tab` (settled — Decision §3 / §4 anchored the tab-strip seam + the pane's container ARIA contract. This leaf preserves both unchanged; the badge count's `pendingProposals`-map source is also untouched per the predecessor's Decision §3 and the orchestrator's standing direction that badge-source-of-truth alignment belongs in `part_vote_indicators_in_pane`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_state_management` (settled — `useUiStore` already holds `currentTab` + `zoom` and exposes the pristine-snapshot reset idiom used by [`apps/participant/src/stores/stores.test.tsx:36-49`](../../../apps/participant/src/stores/stores.test.tsx#L36). This leaf extends the slice with one new slot + setter; the moderator's `mod_state_management` AC §3 mirror pattern is honored — re-render-on-update pinned in the test layer).

## What this task is

The participant pending-proposals row's tap-to-expand affordance: split the existing flat `<li>` row into a tappable header region + a conditionally-rendered expanded body region inside the same `<li>`, wire a single-open accordion model through a new `useUiStore.expandedProposalId` slot, and reserve the expanded body as the slot sibling task `part_per_facet_breakdown_in_pane` plugs the per-facet breakdown into. After this leaf:

- The `useUiStore` slice ([`apps/participant/src/stores/uiStore.ts`](../../../apps/participant/src/stores/uiStore.ts)) gains one new slot `expandedProposalId: string | null` (default `null` — every row collapsed at mount) plus one setter `setExpandedProposalId(id: string | null)` that overwrites the slot atomically. Single-open accordion semantics are enforced by the *slot shape itself* (`string | null` — one or none); no additional set-union math.
- The collapsed-row cells (`participant-pending-proposal-row-{kind,summary,author,timestamp}`) move from being top-level children of the `<li>` into a new `<button type="button" data-testid="participant-pending-proposal-row-header">` wrapper inside the `<li>`. The button is the toggle target — `onClick` flips `expandedProposalId` between this row's `proposalEventId` and `null`. `aria-expanded` reflects state; `aria-controls={bodyId}` couples to the body region; the existing cell testids stay byte-stable so the predecessor's Vitest cases (g) / (h) and the predecessor's Playwright assertions on `-summary` / `-author` continue to pass without selector edits.
- A new sibling region `<div data-testid="participant-pending-proposal-row-body" role="region" aria-labelledby={...}>` mounts inside the `<li>` *only when* `expandedProposalId === row.proposalEventId`. The body is the v1 disclosure surface and the slot sibling task `part_per_facet_breakdown_in_pane` populates. In v1 the body renders the proposal's full untruncated summary text (the same string the header's `-summary` cell carries, just without the `truncate` class) — see Decision §3 for why v1 ships *something* user-visible in the body rather than an empty shell.
- The `<li>`'s `data-expanded="true|false"` attribute mirrors the boolean state so Playwright can pin expansion via attribute without needing to assert region visibility. The `<li>`'s `title` attribute (the full summary tooltip from `part_proposal_list_view`) stays — it's the hover affordance for desktop testing; the touch-only flow uses tap-to-expand instead.
- Tapping a row that is *not* currently expanded sets `expandedProposalId` to that row's id (collapsing whichever was previously open). Tapping the currently expanded row sets `expandedProposalId` to `null` (collapses it). Tapping a different row in the same gesture sequence atomically swaps the open slot to the new id (single-open accordion).
- The Vitest suite [`PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) gains five new cases pinning the header-button shape + body-visibility + ARIA + single-open accordion + body content. The existing nine cases stay passing (the cell testids didn't move and the row's `<li>` testid is unchanged).
- The Playwright spec [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) gains a short step 6 (tap the row, assert `data-expanded="true"` on the `<li>`, assert the body is visible, tap again, assert collapse). One existing scenario extended; no new scenario file.
- One new i18n key lands in en-US + pt-BR + es-419 catalogs: `participant.pendingProposalsPane.rowBodyAriaLabel` (the expanded body region's accessible name, since the body's labelled-by link is to the header's summary cell, but a fallback aria-label is provided for assistive tech that doesn't resolve `aria-labelledby` reliably). pt-BR + es-419 drafts flagged PENDING in `*.review.json`; a native-review chain leaf is registered in `tasks/35-frontend-i18n.tji`.

Out of scope (deferred to sibling or future leaves):

- **Not the per-facet breakdown.** The expanded body shows the proposal's full summary string in v1 (Decision §3). Sibling leaf `part_per_facet_breakdown_in_pane` (1d, depends `!part_proposal_expand`) replaces or augments the body content with the per-facet breakdown table. The body region's testid + ARIA contract this leaf establishes is the seam.
- **Not the per-participant vote indicators on the header.** Sibling leaf `part_vote_indicators_in_pane` (0.5d, depends `!part_per_facet_breakdown_in_pane`) adds the indicator dots inside the header row's flex layout. The orchestrator's standing note: this leaf must leave the header layout extensible so the indicators can attach without redoing the row layout — Decision §4 covers the contract.
- **Not the badge-count alignment with the pane source.** Per the orchestrator's standing direction (carried forward from `part_proposal_list_view`'s Decision §3), the badge wire stays on `pendingProposals` map; the alignment lands when `part_vote_indicators_in_pane` ships its per-participant projection.
- **Not animation / transition / spinner.** The expand/collapse is an instantaneous DOM swap (mount the body on expand, unmount on collapse) matching the predecessor's "no transition" pattern. The future per-facet breakdown leaf is similarly unconstrained — if a fade-in becomes warranted, it can wrap the body content without disturbing the disclosure machinery.
- **Not a global "expand all" / "collapse all" affordance.** Single-open accordion is the v1 contract per Decision §2; a bulk affordance would require a different slot shape (`Set<string>`) and a UI button neither the WBS nor the design spec calls for.
- **Not URL-state for the expansion.** The `expandedProposalId` lives in `useUiStore` only (in-memory; resets on full reload). Reasoning mirrors `part_proposals_tab` Decision §6 — the participant surface is tablet-local and a bookmarkable expanded-row is not a feature.
- **Not a per-session scoping of the expansion slot.** One global `expandedProposalId` on `useUiStore` is sufficient because the participant tablet is single-session (Decision §5 enumerates the alternative). If the participant ever joins a new session in the same browser tab, the lingering `expandedProposalId` from the prior session renders as nothing (the row's `proposalEventId` no longer matches anything in the new session's derived list) — the next tap overwrites it. Harmless.
- **Not a row-keyed memoization split.** The collapsed-header cells are already inside a child component `PendingProposalRow` in [`PendingProposalsPane.tsx:91-138`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L91); adding a body sibling inside the same component keeps the render unit cohesive. A future `React.memo` wrap (when the per-facet breakdown lands with derived row-local data) is the right home for further memo discipline.
- **Not a moderator-side mirror.** The moderator pane's row is always-expanded inline (no disclosure affordance — the desktop sidebar has the vertical space; the moderator-side `<PendingProposalRow>` at [`apps/moderator/src/layout/PendingProposalsPane.tsx:293-484`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L293) renders the full breakdown unconditionally). The participant surface needs the disclosure because the tablet has less vertical room and the row count can reach tens at peak. The two surfaces' disclosure behavior is deliberately different (Decision §6).
- **Not a chevron / disclosure icon.** Decision §4 picks "whole-header-row is the toggle button" over "dedicated chevron + cells as siblings". Full-row tap is the touch-friendly choice; a future visual-polish leaf can layer a chevron without changing the disclosure mechanics.
- **Not a focus-management leaf.** When a row expands, the focus stays on the header button (the natural keyboard target). The body region does not auto-focus its first interactive child — there are no interactive children in v1 (the body's content is plain text). When the per-facet breakdown lands, that leaf's refinement re-evaluates focus management for the disclosure-on-expand pattern.
- **Not a new ADR.** Decision §7 enumerates why every architectural choice here applies an existing ADR or scopes a UI policy in the same idiom predecessor refinements established.
- **Not a Cucumber scenario.** Expansion state is purely client-local UI — no wire, no broadcast, no projector output. Decision §8 covers the rationale; the orchestrator's standing flat-Cucumber-count nudge is acknowledged but does not apply here because nothing crosses the protocol boundary.

## Why it needs to be done

`docs/participant-ui.md` line 150 (V1 defaults) names "list view with most-recent at top. **Tap to expand a proposal.**" as the multi-pending-proposal handling. The predecessor `part_proposal_list_view` shipped the list-view half; without the expand affordance, the debater cannot drill into a row to see what's actually being voted on without leaving the proposals tab and walking through the graph view's detail panel.

The downstream WBS chain depends on this leaf landing:

1. **`part_per_facet_breakdown_in_pane`** (1d, depends `!part_proposal_expand`) renders the per-facet breakdown inside the expanded body region. It needs the body region to exist as a stable DOM slot — without it, the breakdown leaf would have to invent the disclosure machinery + the slot + the per-facet rendering in one task.
2. **`part_vote_indicators_in_pane`** (0.5d, depends `!part_per_facet_breakdown_in_pane`) adds per-participant indicators inside the header layout and refines the badge count's source-of-truth. It needs the header to be a stable layout target that accepts new flex children without re-deciding the row geometry.
3. **`part_voting.*`** (P2 chain) hangs off the parent subgroup's `complete 100` state — every leaf under `part_pending_proposals` must ship.

Architecturally this leaf locks the **disclosure machinery for the participant pane** (single-open accordion via one `useUiStore` slot; header-as-button + body-as-region split inside the same `<li>`; instantaneous DOM swap; whole-header tap target). Both of the downstream sibling leaves bind to the seam this establishes — the breakdown leaf binds to the body region; the indicators leaf binds to the header layout.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; debaters vote on every pending proposal.
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L146-L155) — "list view with most-recent at top. **Tap to expand a proposal.**"
- [docs/participant-ui.md — Layout (sketch)](../../../docs/participant-ui.md#L20-L29) — the pane row content spec; "each row identifies what is being voted on".
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L127-L133) — per-facet states + per-participant indicators (the slot future leaves populate inside the expanded body).
- [docs/participant-ui.md — P2. Vote on a pending proposal](../../../docs/participant-ui.md#L78-L87) — "the detail panel expands showing all facet rows for that entity". The current detail-panel pattern is on the graph tab; this leaf brings the equivalent affordance to the proposals tab so the participant doesn't have to leave the tab to drill down.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — one new ICU-free key lands per the established workflow.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — surface owns its mounted region; expansion state is participant-local.
- [ADR 0030 — per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — informs the per-facet breakdown sibling that consumes this leaf's body slot.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_proposal_list_view.md`](part_proposal_list_view.md) — the predecessor. Its Decision §2 (event-log row source-of-truth), Decision §3 (badge stays on `pendingProposals` map), Decision §4 (`apps/participant/src/proposals/` directory location), and the row contract (`participant-pending-proposal-row` testid + `data-proposal-id` attribute + four child-cell testids) are all preserved by this leaf. The non-empty branch and the empty `<ul>` / populated `<ul>` semantics are unchanged.
- [`tasks/refinements/participant-ui/part_proposals_tab.md`](part_proposals_tab.md) — Decision §4 (projection chain stays hoisted at the route) is preserved; this leaf doesn't touch `OperateRoute`. Decision §6 (UI state in zustand, not URL) is the precedent for storing `expandedProposalId` in `useUiStore`.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — establishes `useUiStore`'s shape + the pristine-snapshot reset idiom + the "render-side consumers don't write directly to `useWsStore`" rule. This leaf extends `useUiStore` with one slot; the extension is conservative.
- [`tasks/refinements/moderator-ui/mod_proposal_list.md`](../moderator-ui/mod_proposal_list.md) — the moderator's analogous row. Its always-expanded inline layout is the prior-art *negative example* that motivates the participant's disclosure pattern (Decision §6).
- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md) — the participant's existing disclosure surface on the graph tab (selection-driven expand of an entity's facet rows). This leaf's accordion-like behavior on the proposals tab is the analog for a different drill-down axis (per-proposal instead of per-entity); the two coexist without interacting.

### Live code the surface plugs into

- [`apps/participant/src/proposals/PendingProposalsPane.tsx:91-138`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L91) — the existing `PendingProposalRow` co-located inside the pane file. The four cell renders inside the `<li>` move into a `<button>` wrapper; the body region mounts as a sibling. The `<li>`'s `data-testid` / `data-proposal-id` / `className` / `title` attributes stay byte-stable; the `<li>` gains `data-expanded`.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx:140-152`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L140) — `kindChipText` + `relativeTimeFor` helpers stay byte-stable; the row's chip/summary/author/timestamp derivations are unchanged.
- [`apps/participant/src/stores/uiStore.ts:25-46`](../../../apps/participant/src/stores/uiStore.ts#L25) — `UiState` interface + `useUiStore` factory. Extended with one slot (`expandedProposalId: string | null`) + one setter (`setExpandedProposalId`). The `withDevtools` wrapper + the `clampZoom` helper are unchanged.
- [`apps/participant/src/stores/stores.test.tsx:36-49`](../../../apps/participant/src/stores/stores.test.tsx#L36) — the pristine-snapshot reset idiom (`useUiStore.setState(uiInitial, true)`) already in place; the new slot resets automatically via the same line, no test-side edit needed.
- [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) — extends with five new cases (header button shape; tap to expand; tap to collapse; tap a different row swaps the open slot; expanded body renders the full summary).
- [`tests/e2e/participant-pending-proposals.spec.ts:188-245`](../../../tests/e2e/participant-pending-proposals.spec.ts#L188) — the existing step 5 (non-empty branch row assertions) is followed by a NEW step 6 that taps the row, asserts `data-expanded="true"`, asserts the body is visible, taps again, asserts collapse. The seeded `proposal` event from step 4 is reused.

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `participant.pendingProposalsPane.*` carries `emptyState`, `systemAuthor`, `paneAriaLabel` after the predecessor leaves. This leaf adds one key: `rowBodyAriaLabel` (the expanded body region's `aria-label`, since the header's summary cell carries the proposal text and the body is its disclosure region).
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — both gain the one new dotted key flagged PENDING.

### Existing fixtures the Playwright spec composes with

- The existing `participant-pending-proposals.spec.ts` scenario already seeds a single `proposal` event and asserts step 5 surfaces one `participant-pending-proposal-row` with `data-proposal-id` matching the envelope. Step 6 (NEW) reuses that same row to assert the tap-to-expand affordance — no new fixture, no new scenario, no compose-stack changes.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/stores/uiStore.ts` — modified. `UiState` gains `expandedProposalId: string | null` + `setExpandedProposalId(id: string | null) => void`; the factory's default state gains `expandedProposalId: null`.
- `apps/participant/src/stores/stores.test.tsx` — modified. Adds one new `describe('useUiStore — expandedProposalId', ...)` block with three cases (default null; set + read; set null clears).
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — modified. The co-located `PendingProposalRow` component splits the row into header + body; consumes `useUiStore.expandedProposalId` + `setExpandedProposalId`; the `<li>` gains `data-expanded`.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — modified. Adds five new cases pinning the disclosure machinery (header button + ARIA; tap to expand; tap same row to collapse; tap different row swaps the open slot; expanded body content renders the full untruncated summary).
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. Step 6 added after step 5: tap the row, assert `data-expanded="true"` on the `<li>` and visible body region; tap again, assert collapse.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. One new key (`participant.pendingProposalsPane.rowBodyAriaLabel`).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same key, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same key, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds the new dotted key flagged PENDING.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.
- `tasks/35-frontend-i18n.tji` — modified. Registers a new `i18n_participant_proposal_expand_native_review` leaf chained after the current native-review chain tail (`i18n_participant_proposal_list_native_review` from the predecessor).

### Files this task does NOT touch

- `apps/participant/src/proposals/derivePendingProposals.ts` + its test — the pure selector is unchanged; expansion state is purely a render-side concern.
- `apps/participant/src/proposals/proposalSummary.ts` + its test — the per-sub-kind summary helper is unchanged; the body region reuses the same `summaryText(proposal)` call.
- `apps/participant/src/proposals/usePendingProposalsCount.ts` + its test — the badge count selector stays on the `pendingProposals` map per the standing orchestrator direction; this leaf does not touch the badge wire.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + its test — the tab strip is unchanged.
- `apps/participant/src/proposals/index.ts` — the barrel exports stay; no new exported symbol (the row + helpers are co-located inside `PendingProposalsPane.tsx`).
- `apps/participant/src/routes/OperateRoute.tsx` + its test — the route's tab-conditional + projection chain is unchanged.
- `apps/participant/src/ws/wsStore.ts` — store shape unchanged; consumer-only.
- `apps/participant/src/layout/*` — unchanged.
- `apps/moderator/src/` — the moderator pane's always-expanded layout is the prior-art negative example; not touched.
- `packages/shell/` — no shell extraction.
- `playwright.config.ts` — no project changes; the new step runs inside the existing spec under the existing project.
- `tasks/40-participant-ui.tji` — the `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (Decision §7).

### `useUiStore` extension shape (`apps/participant/src/stores/uiStore.ts`)

Sketch:

```ts
export interface UiState {
  currentTab: ParticipantTab;
  zoom: number;
  /**
   * Single-open accordion slot for the pending-proposals tab row
   * disclosure: the `event.id` of the currently-expanded proposal row,
   * or `null` when every row is collapsed. The slot shape itself
   * enforces the "at most one open" contract.
   */
  expandedProposalId: string | null;
  setCurrentTab: (tab: ParticipantTab) => void;
  setZoom: (zoom: number) => void;
  /** Overwrite the open-row slot atomically. Passing `null` collapses. */
  setExpandedProposalId: (id: string | null) => void;
}

export const useUiStore = create<UiState>()(
  withDevtools('participant/ui', (set) => ({
    currentTab: 'graph',
    zoom: 1,
    expandedProposalId: null,
    setCurrentTab: (currentTab) => set({ currentTab }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    setExpandedProposalId: (expandedProposalId) => set({ expandedProposalId }),
  })),
);
```

- Single slot (`string | null`) — enforces single-open semantics by construction (Decision §2).
- Setter overwrites atomically — no merge math; tapping row B while row A is open emits one `set({ expandedProposalId: 'B' })` which both opens B and closes A in one transition.
- Default `null` — every row collapsed at mount.
- `withDevtools` wrap stays; the new slot + setter surface in Redux DevTools under the existing `participant/ui` channel.
- The pristine-snapshot reset idiom in `stores.test.tsx:36-49` resets the new slot automatically via `useUiStore.setState(uiInitial, true)`; no per-test cleanup needed.

### Row restructure (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Before (current — from `part_proposal_list_view`):

```tsx
function PendingProposalRow({ row, nowMs, systemAuthorLabel }) {
  const { t } = useTranslation();
  const chip = kindChipText(row.proposal, t);
  const summary = summaryText(row.proposal);
  const author = row.actor === null ? systemAuthorLabel : row.actor.slice(0, 8);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  return (
    <li
      data-testid="participant-pending-proposal-row"
      data-proposal-id={row.proposalEventId}
      className="flex flex-row items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2"
      title={summary}
    >
      <span data-testid="participant-pending-proposal-row-kind" ...>{chip}</span>
      <span data-testid="participant-pending-proposal-row-summary" ...>{summary}</span>
      <span data-testid="participant-pending-proposal-row-author" ...>{author}</span>
      <span data-testid="participant-pending-proposal-row-timestamp" ...>{ago}</span>
    </li>
  );
}
```

After (this leaf):

```tsx
function PendingProposalRow({ row, nowMs, systemAuthorLabel }) {
  const { t } = useTranslation();
  const expandedProposalId = useUiStore((s) => s.expandedProposalId);
  const setExpandedProposalId = useUiStore((s) => s.setExpandedProposalId);
  const chip = kindChipText(row.proposal, t);
  const summary = summaryText(row.proposal);
  const author = row.actor === null ? systemAuthorLabel : row.actor.slice(0, 8);
  const ago = relativeTimeFor(row.createdAt, nowMs);
  const isExpanded = expandedProposalId === row.proposalEventId;
  const bodyId = `participant-pending-proposal-row-body-${row.proposalEventId}`;
  const bodyAriaLabel = t('participant.pendingProposalsPane.rowBodyAriaLabel');
  const toggle = (): void => {
    setExpandedProposalId(isExpanded ? null : row.proposalEventId);
  };
  return (
    <li
      data-testid="participant-pending-proposal-row"
      data-proposal-id={row.proposalEventId}
      data-expanded={isExpanded}
      className="flex flex-col rounded-md border border-slate-100 bg-white"
      title={summary}
    >
      <button
        type="button"
        data-testid="participant-pending-proposal-row-header"
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        onClick={toggle}
        className="flex w-full flex-row items-center gap-2 px-3 py-2 text-left"
      >
        <span data-testid="participant-pending-proposal-row-kind" className="...">{chip}</span>
        <span data-testid="participant-pending-proposal-row-summary" className="flex-1 truncate ...">{summary}</span>
        <span data-testid="participant-pending-proposal-row-author" className="...">{author}</span>
        <span data-testid="participant-pending-proposal-row-timestamp" className="...">{ago}</span>
      </button>
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
    </li>
  );
}
```

- `<li>` shifts from `flex flex-row` to `flex flex-col` so the header + body stack vertically when expanded. When collapsed, the body is unmounted and the `<li>`'s visible height matches the predecessor's single-row appearance.
- The header `<button>` carries the four existing cell testids as children — every Vitest case (g) / (h) and every Playwright `.locator('[data-testid="participant-pending-proposal-row-summary"]')` from the predecessor continues to resolve (descendant search).
- `aria-expanded` is the WAI-ARIA disclosure pattern; `aria-controls` couples to the body region.
- `data-expanded` mirrors the boolean for e2e attribute pinning (Playwright's `toHaveAttribute('data-expanded', 'true')` is cleaner than asserting `aria-expanded="true"`, which is the *semantic* contract; both stay in sync because they derive from the same boolean).
- The body's `<p data-testid="...-body-summary">` is the v1 content. `whitespace-pre-wrap break-words` ensures multi-line wordings (which truncate in the header) render fully in the body. When the per-facet breakdown sibling lands, its content sits inside the same body container (the sibling can either replace the `<p>` or render alongside it — that leaf's refinement decides).
- The body's `aria-label` (via the new i18n key) is the fallback accessible name; the more-specific `aria-controls` link from the header button is the primary association.
- The button's `text-left` class undoes the browser default `text-align: center` on `<button>` so the cell layout matches the predecessor's flex row appearance.

### What the new code MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects in `<PendingProposalRow>`.** Expansion is pure local state (zustand read + setter); the row stays render-only.
- **No direct `useWsStore.setState` writes.** The expansion slot is in `useUiStore`, not `useWsStore`; the rule from `part_state_management` (no consumer-side writes to the WS store) is honored.
- **No router-level state.** No `useNavigate`, no `useSearchParams`. Expansion is in-memory only.
- **No animation, no transition, no spinner.** Instantaneous DOM swap on mount/unmount of the body region.
- **No focus management on expand/collapse.** Focus stays on the header button (the natural keyboard-activated toggle target). The body region does not auto-focus; no `ref.current.focus()` in `useEffect`.
- **No additional store slices.** The single new `useUiStore` slot is sufficient; resist the temptation to add a per-row local React state or a session-scoped slot (Decision §5).

### Test layers per ADR 0022

Five pins, each anchoring a different observable property:

1. **Vitest `stores.test.tsx` extension (NEW `describe` block)** — three cases on the new `useUiStore` slot:
   - (a) Default `expandedProposalId === null`.
   - (b) `setExpandedProposalId('proposal-1')` → state slot reflects the value; reading via `useUiStore.getState()` returns `'proposal-1'`.
   - (c) `setExpandedProposalId(null)` clears the slot back to `null`.
   - Total new: 3 cases.

2. **Vitest `PendingProposalsPane.test.tsx` extension (five new cases on top of the existing nine)** — appended after case (i):
   - (j) Default state: one proposal seeded; the header button is rendered, `aria-expanded="false"`, `<li>` has `data-expanded="false"`; the body testid is absent.
   - (k) Tap the header button (fireEvent.click) → `aria-expanded="true"` on the button; `data-expanded="true"` on the `<li>`; the body testid `participant-pending-proposal-row-body` is visible; the body's `-body-summary` cell renders the same string as the header's `-summary` cell.
   - (l) Tap the same header button again → collapse: `aria-expanded="false"`, `data-expanded="false"`, body absent.
   - (m) Two proposals seeded; tap row A → row A expanded, row B not; tap row B → row B expanded, row A collapsed (single-open accordion via the `expandedProposalId` slot).
   - (n) The header button carries `aria-controls` whose value matches the body's `id` attribute (the disclosure-region linkage assertion).
   - Total new: 5; total in suite after this leaf: 14.

3. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — append step 6 to the existing scenario after step 5 (which already seeded one proposal and asserted the row's cells):
   - Locate the row via `data-testid="participant-pending-proposal-row"` (already in scope).
   - Locate the header via `participant-pending-proposal-row-header` inside the row.
   - Assert `data-expanded="false"` on the `<li>` and `aria-expanded="false"` on the button.
   - Click the header.
   - Assert `data-expanded="true"`, `aria-expanded="true"`, and the body region (`participant-pending-proposal-row-body`) is visible.
   - Assert the body's summary cell renders the seeded `capture-node`'s summary text (matches the header's summary).
   - Click the header again.
   - Assert `data-expanded="false"`, body absent.
   - One existing scenario extended; no new spec file.

4. **No Vitest unit suite for a new selector hook** — there's no new selector (the row reads `useUiStore` directly; one boolean comparison is not selector-shaped logic).

5. **No new Cucumber scenario** (Decision §8). Expansion state is purely client-local UI.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright extension is the default.** The pane is already reachable (commits `fcaf09d` + `a89265c` mounted the tab seam and the row renderer); this leaf makes the disclosure affordance user-visible the moment it lands. The natural anchor is the existing `participant-pending-proposals.spec.ts` scenario, which already walks login → join → operate route → tab switch → row visible. Extending step 6 to assert the disclosure machinery lands the e2e coverage without a new scenario file. No e2e is deferred from this leaf.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, NO projector output. Expansion state lives in `useUiStore`, in-memory only, never serialized over the wire. Decision §8 enumerates why no new Cucumber scenario is warranted.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~20 min: extend `useUiStore` with the new slot + setter; verify the existing `stores.test.tsx` pristine-snapshot reset covers it; add three new cases.
- ~30 min: restructure `PendingProposalRow` — split into header `<button>` + conditional body region; wire the `useUiStore` reads + the `onClick` toggle; add `data-expanded` to the `<li>`.
- ~45 min: extend `PendingProposalsPane.test.tsx` with the five new cases (j) — (n); verify the existing nine cases still pass (cell testids didn't move).
- ~30 min: extend the Playwright spec's step 6 — tap header, assert expanded; tap again, assert collapsed; verify the body content matches the header summary.
- ~20 min: add one i18n key (`participant.pendingProposalsPane.rowBodyAriaLabel`) across en-US / pt-BR / es-419 + the two review.json PENDING lists; register the native-review chain leaf in `tasks/35-frontend-i18n.tji`.
- ~30 min: visual sanity at the participant's landscape viewports (1280×720 + 1024×768) — verify the expanded body renders below the header without horizontal overflow; verify the `whitespace-pre-wrap break-words` handles a long wording without breaking the row's container; verify the border-top on the body visually separates it from the header.
- ~45 min: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + the WBS-status ritual.
- ~30 min: buffer for Tailwind / aria-attribute fixups after the visual sanity pass.

Risk surface is modest. The main hazard is the `<button>` wrap around the cells — if the four cell `<span>`s' computed styles change (e.g. flex alignment quirks inside a `<button>` vs a flex `<li>`), the row's visual layout could shift. The `text-left` class on the button is the known-needed override; the `flex w-full flex-row items-center gap-2 px-3 py-2` classes mirror the predecessor's `<li>` flex layout. Visual sanity pass at the two landscape viewports is the safety net. The second hazard is forgetting to keep the existing Vitest cases passing — they assert on the cell testids which still resolve via descendant search, but the `(d) role="tabpanel" + aria-live="polite"` case asserts on the pane container (unchanged) and is safe.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the `useUiStore` extension, the restructured `PendingProposalRow`, the extended pane test, and the extended e2e spec all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build; bundle filename / sidecar shape unchanged.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+8** (3 from `stores.test.tsx` + 5 from `PendingProposalsPane.test.tsx`).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the new key (`participant.pendingProposalsPane.rowBodyAriaLabel`) present in all three locales; pt-BR + es-419 drafts flagged PENDING.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. The new step 6 surfaces `data-expanded="true"`, the body region, and the click-to-collapse return. Predecessor's steps 1-5 pass unchanged.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **`<PendingProposalRow>` owns no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams` inside the row component body returns zero matches; the row reads `useUiStore` + dispatches `setExpandedProposalId` only.
10. **Cell testids are byte-stable** — a diff of `PendingProposalsPane.tsx` shows the four cell `<span>` declarations moved inside the new `<button>` wrapper but the `data-testid` / `data-proposal-id` strings are unchanged; the predecessor's Playwright assertions on `-summary` / `-author` resolve unchanged via descendant search.
11. **`useUiStore`'s pre-existing slots / setters are unchanged** — `currentTab` / `zoom` / `setCurrentTab` / `setZoom` behave identically; the existing `stores.test.tsx` cases pass unchanged.
12. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_proposal_expand` task block per the task-completion ritual; separately, after the new `i18n_participant_proposal_expand_native_review` leaf lands in `tasks/35-frontend-i18n.tji`.
13. **Predecessor's assertions unchanged** — the predecessor's `PendingProposalsPane.test.tsx` cases (a)-(i) pass; the predecessor's Playwright steps 1-5 pass; the `derivePendingProposals` selector + the `proposalSummary` helper + the `usePendingProposalsCount` selector are untouched.

## Decisions

### 1. Expansion state lives in `useUiStore`, not per-row React `useState`

Three alternatives surveyed:

- **(A) New `expandedProposalId: string | null` slot + setter on `useUiStore`** (chosen). Survives tab-switch (the participant who expanded row X, flipped to the graph tab, flipped back to proposals — expects row X still expanded). Survives event-log updates that don't terminate the expanded proposal. Co-locates with the existing `currentTab` slot in the same store (both are participant-surface-local view preferences). Naturally enforces single-open accordion by slot shape (Decision §2).
- **(B) `useState<boolean>` per `<PendingProposalRow>`** for an independent isExpanded slot per row. Rejected. Tab-switch unmounts the pane subtree (per `part_proposals_tab` Decision §4: the tab conditional only mounts one branch at a time — see the e2e step 3 assertion at [`tests/e2e/participant-pending-proposals.spec.ts:130-132`](../../../tests/e2e/participant-pending-proposals.spec.ts#L130)), which would reset every row's local state. The "expanded across tab switch" contract would be silently broken. Also, single-open accordion requires cross-row coordination — local state per row can't enforce it without lifting state up, which is exactly what the store accomplishes.
- **(C) A new dedicated store slice `useProposalDisclosureStore`** with `Set<string>` for multi-open or `string | null` for single-open. Rejected as premature splitting. The existing `useUiStore` already holds participant-surface-local view preferences (`currentTab`, `zoom`); adding one more slot is in scope. A dedicated store would require an extra file, an extra barrel export, and an extra reset-snapshot entry in `stores.test.tsx` for no observed benefit.

The chosen approach is conservative — one slot, one setter, one default value. The store reset idiom in `stores.test.tsx:36-49` already handles the new slot via `useUiStore.setState(uiInitial, true)`.

### 2. Single-open accordion semantics, not multi-open

Three alternatives surveyed:

- **(A) `expandedProposalId: string | null` — at most one row open at a time** (chosen). Slot shape itself enforces the contract; no set-union math; the setter is a single `set({ expandedProposalId: id })` which atomically opens one row and closes any previously-open row in one transition. Mirrors `currentTab`'s single-value shape. Mirrors the participant's entity-detail panel pattern (one entity selected at a time) per [`part_entity_detail_panel.md`](part_entity_detail_panel.md). Tablet vertical real estate is limited; with multi-open the user can quickly fill the visible viewport with expanded bodies and lose track of what they're looking at.
- **(B) `expandedProposalIds: ReadonlySet<string>` — multiple rows expandable** with toggle semantics on each row's button. Rejected. The design spec at `docs/participant-ui.md:150` says "Tap to expand **a** proposal" (singular). Multi-open would also complicate the future per-facet breakdown's UX — multiple breakdowns on screen at once on a tablet, scrolling between them, looking for the one to vote on. Single-open keeps the focus on the proposal the debater is examining.
- **(C) `expandedProposalIds: ReadonlySet<string>` with a single-open *invariant* enforced by the setter** (semantic single-open via API shape). Rejected — `string | null` is the clearer representation. If the design ever shifts to multi-open, the slot shape changes from `string | null` to `ReadonlySet<string>` in one focused edit; we don't have to undo a fake-multi-open API.

The chosen single-open shape commits to a specific UX. If the design ever shifts to multi-open the migration is a focused store-slot retype plus a row-component edit; the testid contract and the disclosure machinery stay unchanged.

### 3. Expanded body renders the full untruncated summary in v1; not an empty shell

Three alternatives surveyed:

- **(A) The body renders the proposal's full untruncated summary text** (chosen). `whitespace-pre-wrap break-words` handles multi-line wordings the header's `truncate` class hides. The v1 expansion is *user-visible-useful* — the debater taps a row with a clipped summary, the body reveals the full text. When `part_per_facet_breakdown_in_pane` lands, that leaf's content sits inside the same body region (the breakdown leaf can either render alongside the summary `<p>` or replace it; that leaf's refinement decides).
- **(B) The body renders an empty placeholder shell + "Coming soon" / "Loading…" text** (anti-pattern). Rejected. An expansion affordance that opens an empty pane is broken UX. Even for an internal "this slot is waiting for the breakdown" message, the QA test would see it as a bug; users would see it as a defect.
- **(C) The body renders a hidden DOM container (always mounted, `display: none` when collapsed)** to keep the disclosure-region linkage stable. Rejected. Two reasons: (i) `aria-controls={bodyId}` works fine pointing at a sometimes-mounted region; modern screen readers handle the dynamic mount. (ii) Mounting a hidden region keeps reconciliation cost on rows the user never expands, for no observable benefit.

The chosen approach is consistent with how the row already shows information progressively — the collapsed header shows the truncated summary + a hover tooltip via the `<li>`'s `title` attribute; the expanded body shows the full text. Both stay valid; the per-facet breakdown leaf augments rather than replaces.

### 4. Whole-header-row is the toggle button; not a dedicated chevron

Three alternatives surveyed:

- **(A) The four cells (kind / summary / author / timestamp) are children of one `<button type="button">` that toggles expansion** (chosen). Large touch target across the entire row width — appropriate for a tablet. Native keyboard accessibility (`tab` + `enter` / `space`) without extra handlers. The cell testids stay nested inside the button; descendant-selector searches from the predecessor's tests resolve unchanged. The future `part_vote_indicators_in_pane` leaf can add new flex children inside the button — the orchestrator's note "vote indicators can attach to the collapsed row without redoing the layout" is preserved (the indicators are visual-display dots per `docs/participant-ui.md:127-133`, non-interactive, safe inside a button).
- **(B) A dedicated chevron icon button at the right end of the row + the cells as siblings of the button at the `<li>` level**. Rejected. Smaller touch target, more visual clutter, requires a new icon asset, and the layout has to reserve room for the chevron that competes with the timestamp cell. Also, the future vote-indicators leaf would then have to negotiate position with the chevron.
- **(C) The `<li>` itself carries `onClick` + `role="button"`**. Rejected. `role="button"` on a non-button element requires explicit `onKeyDown` handlers for space/enter activation (no free keyboard a11y); also adds a `tabIndex={0}` requirement; and the existing children include `<span>` cells whose styling presumes a non-button parent.

If a future a11y audit ever calls for a chevron *as well as* the row-wide tap target (visual disclosure cue for sighted users), that leaf adds a chevron `<span>` inside the same button without changing the disclosure mechanics.

### 5. Single global `expandedProposalId` slot; not per-session scoping

Two alternatives surveyed:

- **(A) `expandedProposalId: string | null` — one global slot** (chosen). The participant tablet flow is single-session (the participant joins one session, debates, leaves). If the participant ever navigates to a different session in the same browser tab, the lingering `expandedProposalId` from the prior session renders as nothing (the row whose `proposalEventId` matches isn't in the new session's derived list). Harmless. Subsequent taps overwrite the slot to the new session's row ids. The simpler slot shape mirrors `currentTab` (also non-session-scoped).
- **(B) `expandedProposalIdBySession: Record<string, string | null>`** — per-session scoping. Rejected. Adds map-management overhead (entries for sessions the participant has navigated to in the past leak indefinitely; a cleanup-on-untrack hook would be needed); requires the row to read `useUiStore.expandedProposalIdBySession[sessionId]` instead of a primitive; and solves a problem that doesn't manifest in real usage (the cross-session leakage is harmless render-time behavior). Mirrors `useWsStore.sessionState` scoping unnecessarily — `useWsStore` is per-session because it holds per-session *data*; the disclosure slot holds per-tablet *view state*.

The single-slot choice is the lightest representation that satisfies the UX contract.

### 6. Participant has a disclosure affordance; moderator does not

The moderator pane (in the right sidebar, per [`mod_right_sidebar.md`](../moderator-ui/mod_right_sidebar.md)) renders rows always-expanded inline — every row carries its per-facet breakdown + commit/mark/withdraw buttons in one flat layout, no disclosure. The desktop sidebar has the vertical real estate to absorb the cost; the per-row commit-button is an action the moderator may want to take on any visible row, so hiding the row's body behind an expand affordance would add a tap before every commit gesture.

The participant has different constraints:

- Tablet vertical room is scarcer than a desktop sidebar.
- The participant doesn't have per-row commit affordances (no moderator-only buttons; the row is informational + reveal-to-read).
- The peak row count can reach tens during a busy session; a flat always-expanded layout would push the most-recent rows off-screen.
- The design spec explicitly calls for "Tap to expand" (per `docs/participant-ui.md:150`).

The two surfaces diverge by design. This leaf does NOT introduce a moderator-side disclosure; the moderator pane's contract is unchanged.

### 7. No new ADR

Every architectural choice above applies an existing ADR or scopes a UI policy in the same idiom predecessor refinements established:

- Expansion-state-in-zustand (Decision §1) — established by `part_state_management` (zustand for participant-local view state).
- Single-open-accordion (Decision §2) — design spec at `docs/participant-ui.md:150` already says "expand a proposal" (singular); no new architectural call.
- User-visible v1 body content (Decision §3) — applies the "ship something useful, replace as siblings extend" idiom from `part_proposals_tab` Decision §5.
- Whole-header-row toggle (Decision §4) — standard WAI-ARIA disclosure pattern; no project-local rationale needed.
- Global slot vs per-session scope (Decision §5) — applies the `currentTab` precedent.
- Surface divergence from moderator (Decision §6) — restates established geometry asymmetry already documented in `part_proposals_tab` Out of Scope §6.
- Tailwind utility classes (no shared token) — established by ADR 0005.

The "no new dependencies" rule is satisfied; no `package.json` is modified.

### 8. No Cucumber scenario for the expansion path

Two alternatives surveyed:

- **(A) Pin via Vitest (`useUiStore` slot + pane component) + Playwright (end-to-end click-to-expand)** (chosen). The expansion state is purely client-local UI — no wire, no broadcast, no projector output, no protocol boundary crossed. The Vitest store cases pin the slot's setter behavior; the Vitest pane cases pin the disclosure machinery's render contract; the Playwright extension pins the end-to-end user gesture under the real compose stack. The orchestrator's "Cucumber if a surface ADDS wire/projector behavior" guidance applies when something crosses the boundary — this leaf doesn't.
- **(B) Add a Cucumber scenario** asserting "when a participant expands a pending-proposal row, the row's body content surfaces". Rejected. The assertion is structurally a UI gesture, not a protocol-boundary contract; pglite-driven Cucumber steps would have to drive the React render tree, which is what Playwright + Vitest already do better.

The orchestrator's standing note that Cucumber count has been flat for 7 commits is acknowledged. This leaf is a UI-stream task and the orchestrator's prompt explicitly says "this is a UI-stream task so Playwright is the in-scope coverage". Nothing in the expand toggle exposes new wire / broadcast behavior; the flatness is not because of a coverage gap this leaf could fill.

### 9. Tech-debt registration

Two follow-ups named crisply for the closer:

- **`frontend_i18n.i18n_participant_proposal_expand_native_review`** — pt-BR + es-419 native-speaker review of the one new key (`participant.pendingProposalsPane.rowBodyAriaLabel`). Effort: 0.25d. **Action for Closer**: register as a new WBS leaf in `tasks/35-frontend-i18n.tji`, chained after the predecessor's native-review leaf `i18n_participant_proposal_list_native_review` and after this task: `depends !i18n_participant_proposal_list_native_review, participant_ui.part_pending_proposals.part_proposal_expand`.

- **Focus management on expand (the body's per-facet breakdown leaf re-evaluates)** — when `part_per_facet_breakdown_in_pane` lands and the body region carries interactive children (the per-facet vote indicators may or may not be interactive; the breakdown table rows may want to be tabbable), that leaf's refinement re-evaluates whether the disclosure-on-expand pattern should auto-focus the body's first interactive child. No new WBS leaf needed; the existing `part_per_facet_breakdown_in_pane` is the home.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-25.

- Participant pending-proposals row gains tap-to-expand disclosure: the existing `<li data-testid="participant-pending-proposal-row">` now stacks a `<button data-testid="participant-pending-proposal-row-header">` (carrying the four byte-stable cell testids `participant-pending-proposal-row-{kind,summary,author,timestamp}`) above a conditionally-rendered `<div data-testid="participant-pending-proposal-row-body" role="region">` sibling. The `<li>` mirrors expansion via `data-expanded="true|false"` for Playwright attribute pinning; the header carries `aria-expanded` + `aria-controls={bodyId}` per the WAI-ARIA disclosure pattern. v1 body content renders the proposal's full untruncated summary (`whitespace-pre-wrap break-words`) per Decision §3. Refinement: [`tasks/refinements/participant-ui/part_proposal_expand.md`](part_proposal_expand.md).
- Single-open accordion semantics enforced by slot shape: new `expandedProposalId: string | null` slot + atomic `setExpandedProposalId(id)` setter on [`apps/participant/src/stores/uiStore.ts`](../../../apps/participant/src/stores/uiStore.ts) (Decision §1 / §2). Default `null` (every row collapsed at mount); the pristine-snapshot reset idiom in [`apps/participant/src/stores/stores.test.tsx`](../../../apps/participant/src/stores/stores.test.tsx) covers the new slot via `useUiStore.setState(uiInitial, true)` with no per-test cleanup. `<PendingProposalRow>` in [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) consumes the slot directly; no new selector hook.
- One new i18n key lands in [`en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) / [`pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) / [`es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json): `participant.pendingProposalsPane.rowBodyAriaLabel` (the expanded body region's fallback accessible name). pt-BR + es-419 drafts flagged PENDING in [`pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json); native-review leaf `i18n_participant_proposal_expand_native_review` registered in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji) chained after `i18n_participant_proposal_list_native_review` per Decision §9.
- Vitest: 4585 → 4593 (+8 = 3 new `useUiStore — expandedProposalId` cases in [`stores.test.tsx`](../../../apps/participant/src/stores/stores.test.tsx) + 5 new cases (j)-(n) in [`PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) pinning the header-button shape, tap-to-expand, tap-same-row collapse, single-open swap across rows, and the `aria-controls`↔body-`id` linkage). The existing nine pane cases pass unchanged (cell testids did not move; descendant search through the new `<button>` wrapper resolves them).
- Playwright: 146 → 146 specs (unchanged scenario count); the existing [`participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) scenario gains a step 6 that taps the row, asserts `data-expanded="true"` + body visible + `-body-summary` matches the header summary, taps again, and asserts collapse. Cucumber 263 → 263 (unchanged per Decision §8 — expansion is purely client-local UI; no wire / broadcast / projector boundary crossed).
- Infra note for future investigation (not registered as a tech-debt leaf this iter — orchestrator will route separately if it recurs): during initial `pnpm run test:smoke`, stale `packages/shared-types/dist/index.js` artifacts caused the audience-app build to fail with three missing-export errors (`WsEnvelopeValidationError` / `parseWsEnvelopeJson` / `serializeWsEnvelope`). Rebuilding `@a-conversa/shared-types` (`pnpm -F @a-conversa/shared-types build`) cleared it. `pnpm -r build` apparently did not eagerly refresh shared-types' dist before downstream apps consumed it.
