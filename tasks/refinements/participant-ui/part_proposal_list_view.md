# Pending proposals list view, most-recent at top

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_pending_proposals.part_proposal_list_view`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!participant_ui.part_pending_proposals.part_proposals_tab` (settled — commit `fcaf09d` landed the tab seam + count badge + empty `<PendingProposalsPane>` shell. The pane's stable container testid (`participant-pending-proposals-pane`) and its non-empty branch's stable `<ul data-testid="participant-pending-proposals-pane-list">` container ([`apps/participant/src/proposals/PendingProposalsPane.tsx:44-48`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L44)) are the seam this leaf plugs into. The empty-state branch (visible when `pendingProposals` is empty) is unchanged by this leaf; the non-empty branch's empty `<ul>` shell is replaced with a rendered list of rows).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_state_management` (settled — `useWsStore.sessionState[id].events: Event[]` is already maintained per-session via `applyEvent` ([`apps/participant/src/ws/wsStore.ts:121-140`](../../../apps/participant/src/ws/wsStore.ts#L121)). This leaf is the first participant-side consumer of the event log for list-rendering purposes; the diagnostic-highlight read at `<GraphView>` already consumes events transitively via the projection chain).
- Prose-only context (NOT a `.tji` edge): `backend.websocket_protocol.ws_proposal_status_broadcast` (settled — broadcast envelope and the `pendingProposals` map are upstream. This leaf does NOT consume the `pendingProposals` map for row rendering — it walks the event log instead, mirroring the moderator's pane source-of-truth choice; see Decision §2. The map is still the source for the count badge per `part_proposals_tab` Decision §3, and Decision §3 below holds that contract steady).
- Prose-only context (NOT a `.tji` edge): the moderator's [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) selector — the pure `derivePendingProposals(events)` walk that this leaf duplicates for participant use under Decision §1. The moderator selector is the prior art and the contract this leaf mirrors verbatim (proposalEventId / sequence / kind / proposal / actor / createdAt fields; sort newest-first by sequence; commit + meta-disagreement-marked terminate; per-facet vs per-proposal commit target disambiguation per ADR 0030 §9).

## What this task is

The participant pending-proposals pane's row-rendering leaf: replace the empty `<ul data-testid="participant-pending-proposals-pane-list">` shell with one `<li>` per surviving in-flight proposal, ordered newest-first by `event.sequence` descending, each row showing the proposal's kind chip + one-line summary + 8-char author prefix + relative-time timestamp. After this leaf:

- A new pure selector `derivePendingProposals(events)` under [`apps/participant/src/proposals/derivePendingProposals.ts`](../../../apps/participant/src/proposals/derivePendingProposals.ts) walks `useWsStore.sessionState[sessionId].events` once and returns `readonly PendingProposalRow[]` newest-first. The shape mirrors the moderator's selector exactly (same field names, same sort order, same termination rules) so a future shell extraction (when the audience or replay surface needs the same projection) can lift the single shared implementation without re-deciding the row contract. Decision §1 explains why this leaf duplicates rather than extracts.
- A new pure helper `summaryText(proposal)` under [`apps/participant/src/proposals/proposalSummary.ts`](../../../apps/participant/src/proposals/proposalSummary.ts) returns the one-line description rendered in each row's summary column. Mirrors the moderator's [`apps/moderator/src/graph/proposalSummary.ts`](../../../apps/moderator/src/graph/proposalSummary.ts) verbatim (eleven sub-kinds + a fall-through) so future shell extraction lifts both selectors together.
- `<PendingProposalsPane>` ([`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx)) is modified: the empty-branch / non-empty-branch test (currently keyed on the `pendingProposals` map — see [`PendingProposalsPane.tsx:27-28`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L27)) switches to keying on `derivePendingProposals(events).length === 0`. The empty `<ul>` shell is replaced with a populated `<ul>` rendering one `<PendingProposalRow>` per row. The pane keeps its `role="tabpanel"` + `aria-live="polite"` contract; the `participant-pending-proposals-pane-list` testid is preserved; the empty-state branch is preserved (it activates when the event log has zero surviving proposals).
- A new `<PendingProposalRow>` component co-located inside [`apps/participant/src/proposals/PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) (mirroring the moderator's [`PendingProposalsPane.tsx:293`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L293) co-location idiom — small enough not to warrant its own file in v1). Each row renders: `<li data-testid="participant-pending-proposal-row" data-proposal-id="...">` containing four `<span>` cells — kind chip, summary, author, timestamp — each carrying its own stable testid (`participant-pending-proposal-row-kind|summary|author|timestamp`). No interactivity: the row is a plain non-interactive list item. Tap-to-expand lands in `part_proposal_expand`; per-facet breakdown lands in `part_per_facet_breakdown_in_pane`; per-participant vote indicators land in `part_vote_indicators_in_pane`.
- Two new i18n keys land in en-US + pt-BR + es-419 catalogs: `participant.pendingProposalsPane.systemAuthor` (the "System" fallback for rows whose `event.actor === null`) and `participant.pendingProposalsPane.paneAriaLabel` (the `<section>` aria-label, replacing the implicit accessible name the empty-state branch carried). pt-BR + es-419 drafts are flagged PENDING in `*.review.json`; a native-review chain leaf is registered in `tasks/35-frontend-i18n.tji`.
- For the row's kind chip on `classify-node` proposals, the existing `methodology.kind.<classification>` catalog keys are reused (already present from moderator-side work — no new catalog keys for the chip). For every other sub-kind, the literal `proposal.kind` string renders (mirrors the moderator's deliberate v1 keep-the-catalog-footprint-proportional-to-reachability choice per `mod_proposal_list` Decision §7).
- Test layers per ADR 0022: a Vitest unit suite for `derivePendingProposals` (mirroring the moderator's [`pendingProposals.test.ts`](../../../apps/moderator/src/graph/pendingProposals.test.ts) test cases — empty log, single proposal, multi-proposal newest-first ordering, commit termination via proposal-arm + facet-arm, meta-disagreement-marked termination via proposal-arm + facet-arm, multi-facet supersession), a Vitest unit suite for `summaryText` (one case per sub-kind), an extension to `PendingProposalsPane.test.tsx` covering row rendering (empty event log → empty-state, single proposal → one row visible, two proposals → two rows newest-first, classify-node chip reuses `methodology.kind.*` keys, system-authored proposal → "System" label), and a Playwright assertion in the existing `tests/e2e/participant-pending-proposals.spec.ts` that the non-empty branch surfaces actual `<li data-testid="participant-pending-proposal-row">` rows ordered by `data-proposal-id` matching the seeded event sequence.

Out of scope (deferred to sibling or future leaves):

- **Not tap-to-expand.** Tapping a row to expand it showing its facets is `part_proposal_expand` (1d, depends `!part_proposal_list_view`). This leaf renders the rows as plain non-interactive `<li>`s; no `onClick`, no expanded state, no detail-panel coupling.
- **Not per-facet breakdown inside a row.** The per-facet status chips (mirrors the moderator's `<ProposalFacetBreakdown>` per-row) land in `part_per_facet_breakdown_in_pane` (1d).
- **Not per-participant vote indicators inside a row.** Per-participant indicators (and the count-filter refinement) land in `part_vote_indicators_in_pane` (0.5d).
- **Not commit / mark-meta-disagreement / withdraw buttons.** Those are moderator-only affordances; the participant surface never gains them. The row contract this leaf establishes is intentionally narrower than the moderator row.
- **Not screen-name resolution.** The author column renders the 8-char UUID prefix (mirroring the moderator's v1 choice per `mod_proposal_list` Decision §6); screen-name resolution remains a cross-surface follow-up.
- **Not the badge-count switch from `pendingProposals` to `derivePendingProposals(events).length`.** The badge's source-of-truth stays the `pendingProposals` map per `part_proposals_tab` Decision §3 (which counts via `usePendingProposalsCount(sessionId)` → `Object.keys(sessionState[sid].pendingProposals).length`). The pane's row source switches to events; the badge stays on the map. Decision §3 below explains the deliberate skew and the trigger that aligns them.
- **Not a new ADR.** Every architectural call below applies an existing ADR or scopes a UI policy in the same idiom as the moderator's `mod_proposal_list` refinement (the prior art this leaf mirrors).
- **Not a Cucumber scenario for the read path.** The event log + envelope shape is already Cucumber-pinned upstream by `ws_proposal_status_broadcast`'s scenarios; `derivePendingProposals` is a client-local pure function pinned by Vitest. Decision §6 explains why Cucumber adds no coverage here.
- **Not shell extraction of the selector / summary helpers.** Single participant consumer (with the moderator's parallel implementation) is not yet enough cross-surface mass to justify the package boundary; Decision §1 names the third-consumer trigger (audience or replay) that flips the call.
- **Not virtualization.** A live session realistically holds tens of pending proposals at peak; the moderator's pane (the prior art) does not virtualize either. If a future scale concern surfaces, both panes can be wrapped together when the shell extraction lands.

## Why it needs to be done

`docs/participant-ui.md` §"Layout (sketch)" line 25 specifies the pending-proposals pane as "list of in-flight proposals awaiting the debater's vote. Each row identifies what is being voted on: for facet-valued proposals, the `(entity, facet)` and the candidate value being named; for structural proposals (`decompose`, `interpretive-split`, `axiom-mark`, `annotate`, `meta-move`, `break-edge`) the proposal as a whole." V1 defaults (`docs/participant-ui.md` line 150) pin "list view with most-recent at top." This leaf is the first surface that fulfills both — the predecessor `part_proposals_tab` shipped the empty shell; without the rendered list, the debater has no walkable view of in-flight proposals.

The downstream WBS chain depends on this leaf landing:

1. **`part_proposal_expand`** (1d, depends `!part_proposal_list_view`) wires tap-to-expand on each row. It needs an actual rendered `<li>` to bind the gesture to.
2. **`part_per_facet_breakdown_in_pane`** (1d, depends `!part_proposal_expand`) adds the per-facet breakdown inside an expanded row. It needs the row to exist and to know how to derive the proposal's facet entries.
3. **`part_vote_indicators_in_pane`** (0.5d, depends `!part_per_facet_breakdown_in_pane`) adds per-participant indicators AND refines the badge count to "facets across all proposals still need this debater's vote" (the refinement deferred by `part_proposals_tab` Decision §3).
4. **`part_voting.*`** (P2 chain — `part_vote_button_per_facet`, etc.) hangs off the parent subgroup's `complete 100` state; that requires every leaf under `part_pending_proposals` to ship.

Architecturally this leaf locks the **row source-of-truth** for the participant pane (the event log, not the broadcast frame — Decision §2) and the **row container contract** sibling leaves bind to (`participant-pending-proposal-row` testid + `data-proposal-id` attribute, mirroring the moderator's per-row contract). Both choices are designed to parallel the moderator's pane without committing to a shell-extraction that no third consumer yet pulls.

## Inputs / context

### Design + ADRs

- [DESIGN.md](../../../DESIGN.md) — agreement-driven graph editing; debaters vote on every pending proposal.
- [docs/participant-ui.md — Layout (sketch)](../../../docs/participant-ui.md#L20-L29) — the pane row content spec.
- [docs/participant-ui.md — V1 defaults](../../../docs/participant-ui.md#L146-L155) — "list view with most-recent at top. Tap to expand a proposal." (Expand is deferred; the order-and-list-form pin lands here.)
- [docs/participant-ui.md — Visual state representation](../../../docs/participant-ui.md#L127-L133) — per-facet states + the per-participant indicators + the pending count badge. This leaf is the row carrier; the per-facet chips and the per-participant indicators land in sibling leaves.
- [ADR 0021 — event envelope](../../../docs/adr/0021-event-envelope.md) — the `Event` discriminated union the selector walks.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check below is a committed test.
- [ADR 0024 — frontend i18n](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — two new ICU-free keys land per the established workflow.
- [ADR 0026 — micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — surface owns its mounted region.
- [ADR 0030 — per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) — the per-facet vs per-proposal commit-target partition the selector handles when computing terminated-proposal ids.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_proposals_tab.md`](part_proposals_tab.md) — the predecessor. Decision §3 (badge counts *total* via `usePendingProposalsCount` reading the `pendingProposals` map; per-participant refinement deferred to `part_vote_indicators_in_pane`) defines the count-badge contract this leaf does NOT touch. Decision §4 (projection chain stays hoisted at the route) defines the chain location this leaf does NOT touch. The pane's container testid + ARIA contract this leaf consumes is from the predecessor's "What this task is" §3.
- [`tasks/refinements/participant-ui/part_state_management.md`](part_state_management.md) — `useWsStore.sessionState[id].events` is the event log; the participant store's `applyEvent` mirrors the moderator's. Read-only consumption.
- [`tasks/refinements/moderator-ui/mod_proposal_list.md`](../moderator-ui/mod_proposal_list.md) — the moderator's analogous leaf. The participant pane mirrors its decisions (event-log source of truth; newest-first by sequence; co-located row component; 8-char author prefix; `formatRelativeTime` at render time; reuse of `methodology.kind.*` catalog keys for `classify-node` chip; literal sub-kind fallback for structural kinds in v1). Decision §1 below explains why this leaf duplicates rather than imports from the moderator package.
- [`tasks/refinements/moderator-ui/mod_per_facet_breakdown.md`](../moderator-ui/mod_per_facet_breakdown.md) — the moderator's per-facet breakdown leaf. The participant's sibling (`part_per_facet_breakdown_in_pane`) will mirror this; the row contract this leaf establishes leaves room (a separate row inside the `<li>`) for the breakdown to plug into without re-deciding the row shell.
- [`tasks/refinements/backend/ws_proposal_status_broadcast.md`](../backend/ws_proposal_status_broadcast.md) — broadcast already Cucumber-pinned; this leaf only reads the event log it produces (transitively, via `applyEvent`).

### Live code the surface plugs into

- [`apps/participant/src/proposals/PendingProposalsPane.tsx:25-52`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx#L25) — the existing pane. Lines 27-28 (the empty-test selector reading `pendingProposals`) switch to reading the derived list (Decision §2). Lines 36-48 (the empty/non-empty branch JSX) extend: the empty-branch stays as-is; the non-empty branch's empty `<ul>` becomes a populated `<ul>` rendering rows.
- [`apps/participant/src/proposals/usePendingProposalsCount.ts`](../../../apps/participant/src/proposals/usePendingProposalsCount.ts) — the count selector. Untouched by this leaf (the badge stays on the `pendingProposals` map per Decision §3).
- [`apps/participant/src/proposals/index.ts`](../../../apps/participant/src/proposals/index.ts) — barrel export. Extended with the new selector + helper exports (Decision §4).
- [`apps/participant/src/ws/wsStore.ts:78-86`](../../../apps/participant/src/ws/wsStore.ts#L78) — `WsSessionState.events: Event[]` (inherited from `BaseWsSessionState`). The pane subscribes to this slot via `useWsStore((s) => s.sessionState[sessionId]?.events)` with reference-equality bailout (Zustand's default; the `applyEvent` reducer rewrites the array reference on each event apply per [`wsStore.ts:121-140`](../../../apps/participant/src/ws/wsStore.ts#L121)).
- [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) — the moderator's analogous selector. The participant's `derivePendingProposals` mirrors this verbatim (same fields, same sort, same termination logic; Decision §1).
- [`apps/moderator/src/graph/proposalSummary.ts`](../../../apps/moderator/src/graph/proposalSummary.ts) — the moderator's analogous summary helper. The participant's mirror is verbatim except for the (non-existent) module-local imports — both helpers consume only `ProposalPayload` from `@a-conversa/shared-types`.
- [`apps/moderator/src/graph/pendingProposals.test.ts`](../../../apps/moderator/src/graph/pendingProposals.test.ts) — the moderator's tests for the selector. The participant's mirror Vitest suite reuses the same scenario coverage adapted to the participant's import paths.
- [`apps/moderator/src/layout/PendingProposalsPane.tsx:293-484`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx#L293) — the moderator's row component. The participant row is a thinner version (no commit / mark-meta / withdraw / breakdown affordances; just kind / summary / author / timestamp cells).

### Existing i18n catalog state

- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `participant.pendingProposalsPane.*` today carries `emptyState` (from the predecessor `part_proposals_tab`). This leaf adds two keys: `systemAuthor` (the row's "System" author fallback) and `paneAriaLabel` (the section's accessible name, currently implicit). The existing `methodology.kind.*` keys (already present from moderator-side i18n work) are reused unchanged for the classify-node chip.
- [`packages/i18n-catalogs/src/catalogs/pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`packages/i18n-catalogs/src/catalogs/es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json) — both gain the two new dotted keys flagged PENDING.

### Existing fixtures the Playwright spec composes with

- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — the predecessor's spec. Its step 5 (the non-empty-branch assertion at lines 188-198) already calls `toBeAttached()` on `participant-pending-proposals-pane-list` (a structural pin given the empty `<ul>` shell). This leaf extends step 5 to: (a) seed a `proposal` event via `applyEvent`, (b) assert one `participant-pending-proposal-row` is visible, (c) assert the row's `data-proposal-id` matches the seeded event id, (d) assert the kind chip / summary / author / timestamp testids each render the expected text.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/proposals/derivePendingProposals.ts` — NEW. Pure selector mirroring the moderator's.
- `apps/participant/src/proposals/derivePendingProposals.test.ts` — NEW. Vitest cases mirroring the moderator's selector suite.
- `apps/participant/src/proposals/proposalSummary.ts` — NEW. Pure per-sub-kind summary mirror.
- `apps/participant/src/proposals/proposalSummary.test.ts` — NEW. Vitest cases pinning all eleven sub-kinds + the fall-through.
- `apps/participant/src/proposals/PendingProposalsPane.tsx` — modified. The empty/non-empty test switches to `derivePendingProposals(events).length === 0`; the non-empty branch renders the row list; the co-located `<PendingProposalRow>` is added.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — modified. Extends the existing four cases (empty / undefined / non-empty / role+aria) with row-rendering cases (one row visible / two rows newest-first / classify-node chip / system author fallback).
- `apps/participant/src/proposals/index.ts` — modified. Adds barrel exports for `derivePendingProposals` + `summaryText` + the `PendingProposalRow` type.
- `tests/e2e/participant-pending-proposals.spec.ts` — modified. Extends step 5's non-empty branch to seed a `proposal` event and assert the rendered row's cells.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — modified. Two new keys.
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` — modified. Same two keys, draft text.
- `packages/i18n-catalogs/src/catalogs/es-419.json` — modified. Same two keys, draft text.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` — modified. Adds the two dotted keys flagged PENDING.
- `packages/i18n-catalogs/src/catalogs/es-419.review.json` — modified. Same.
- `tasks/35-frontend-i18n.tji` — modified. Registers a new `i18n_participant_proposal_list_native_review` leaf chained after the current native-review chain tail (`i18n_participant_proposals_tab_native_review` from the predecessor).

### Files this task does NOT touch

- `apps/participant/src/proposals/usePendingProposalsCount.ts` — the count selector stays on the `pendingProposals` map per `part_proposals_tab` Decision §3 + Decision §3 below.
- `apps/participant/src/proposals/PendingProposalsTabBar.tsx` + its test — the tab strip is unchanged.
- `apps/participant/src/routes/OperateRoute.tsx` — the route's tab-conditional + projection chain is unchanged.
- `apps/participant/src/ws/wsStore.ts` — store shape unchanged; consumer-only.
- `apps/participant/src/layout/*` — unchanged.
- `apps/moderator/src/graph/pendingProposals.ts` + `proposalSummary.ts` — the moderator's selectors are NOT lifted into a shared package (Decision §1).
- `packages/shell/` — no shell extraction (Decision §1).
- `playwright.config.ts` — no project changes; the new assertion runs inside the existing spec.
- `tasks/40-participant-ui.tji` — the `complete 100` marker lands at task-completion ritual time per [`tasks/refinements/README.md`](../README.md#L32-L42).
- `docs/adr/` — no new ADR (Decision §7).

### Selector shape (`apps/participant/src/proposals/derivePendingProposals.ts`)

Mirror of [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) — copy the file content verbatim, retarget the file-level refinement reference to this refinement, and adjust the prose to drop moderator-side framing. The `PendingProposalRow` interface (`proposalEventId` / `sequence` / `kind: 'proposal'` / `proposal: ProposalPayload` / `actor: string | null` / `createdAt: string`) and the `derivePendingProposals(events: readonly Event[])` signature are copied unchanged. The termination logic (per-proposal-arm + per-facet-arm via the `currentProposalByFacet` map for `capture-node` / `classify-node` / `set-node-substance` / `set-edge-substance` / `edit-wording`) is copied unchanged.

The duplication is deliberate; the implementer must NOT cross-import from `apps/moderator/`. Decision §1 enumerates why.

### Summary helper shape (`apps/participant/src/proposals/proposalSummary.ts`)

Mirror of [`apps/moderator/src/graph/proposalSummary.ts`](../../../apps/moderator/src/graph/proposalSummary.ts). All eleven `proposal.kind` arms render the same one-line summary as the moderator (`capture-node` / `classify-node` fall back to `node <8-char-prefix>`; `set-node-substance` / `set-edge-substance` render `Set substance = <value> (<kind> <prefix>)`; `edit-wording` / `amend-node` / `meta-move` / `annotate` render their free-text fields; `decompose` / `interpretive-split` / `axiom-mark` / `break-edge` render the moderator's literal phrasing). The default arm returns the raw `kind` string. Hard-coded English strings are intentional in v1 — the moderator's `mod_proposal_list` Decision §7 deferred per-sub-kind summary keys until the capture-flow tasks for each sub-kind reach the wire; the participant inherits that policy. The two NEW i18n keys this leaf registers are the row's `systemAuthor` fallback and the pane's `paneAriaLabel`, NOT per-sub-kind summary strings (Decision §5).

### Pane restructure (`apps/participant/src/proposals/PendingProposalsPane.tsx`)

Before (current shell):

```tsx
const pendingProposals = useWsStore((s) => s.sessionState[sessionId]?.pendingProposals);
const isEmpty = pendingProposals === undefined || Object.keys(pendingProposals).length === 0;
return (
  <section data-testid="participant-pending-proposals-pane" role="tabpanel" aria-live="polite" ...>
    {isEmpty ? <div data-testid="...-empty">...</div> : <ul data-testid="...-list" />}
  </section>
);
```

After (this leaf):

```tsx
const events = useWsStore((s) => s.sessionState[sessionId]?.events);
const rows = useMemo(() => derivePendingProposals(events ?? []), [events]);
const nowMs = nowMsOverride ?? Date.now();
const { t } = useTranslation();
return (
  <section
    data-testid="participant-pending-proposals-pane"
    role="tabpanel"
    aria-live="polite"
    aria-label={t('participant.pendingProposalsPane.paneAriaLabel')}
    className="flex h-full w-full flex-col overflow-auto bg-white"
  >
    {rows.length === 0 ? (
      <div data-testid="participant-pending-proposals-pane-empty" ...>
        {t('participant.pendingProposalsPane.emptyState')}
      </div>
    ) : (
      <ul
        data-testid="participant-pending-proposals-pane-list"
        role="list"
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {rows.map((row) => (
          <PendingProposalRow
            key={row.proposalEventId}
            row={row}
            nowMs={nowMs}
            systemAuthorLabel={t('participant.pendingProposalsPane.systemAuthor')}
          />
        ))}
      </ul>
    )}
  </section>
);
```

- `useMemo` keyed on the `events` array reference keeps the derived list stable across renders that don't grow the log — the row's future `React.memo` wrap (when `part_proposal_expand` adds interactivity) stays cheap. The moderator's pane uses the same idiom.
- The optional `nowMsOverride` prop is the deterministic-time injection seam the moderator's pane already established for its relative-time tests. The participant pane currently has no `nowMs` prop — this leaf adds it with the same shape (`nowMs?: number`) so the new row tests have a stable "now".
- The `pendingProposals` map is no longer read by the pane; the import is removed. The `usePendingProposalsCount` hook (the badge's count source) is unchanged and continues to read the map (Decision §3).

### Row shape (co-located `<PendingProposalRow>` inside `PendingProposalsPane.tsx`)

```tsx
function PendingProposalRow({
  row,
  nowMs,
  systemAuthorLabel,
}: {
  readonly row: PendingProposalRow;
  readonly nowMs: number;
  readonly systemAuthorLabel: string;
}): ReactElement {
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
      <span data-testid="participant-pending-proposal-row-kind" className="inline-flex h-5 items-center rounded-sm bg-slate-100 px-2 text-xs font-medium text-slate-700">{chip}</span>
      <span data-testid="participant-pending-proposal-row-summary" className="flex-1 truncate text-sm text-slate-800">{summary}</span>
      <span data-testid="participant-pending-proposal-row-author" className="text-xs font-mono text-slate-500">{author}</span>
      <span data-testid="participant-pending-proposal-row-timestamp" className="text-xs text-slate-500">{ago}</span>
    </li>
  );
}

function kindChipText(proposal: ProposalPayload, t: (key: string) => string): string {
  if (proposal.kind === 'classify-node') {
    return t(`methodology.kind.${proposal.classification}`);
  }
  return proposal.kind;
}

function relativeTimeFor(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return createdAt;
  const secondsAgo = Math.round((nowMs - createdMs) / 1000);
  return formatRelativeTime(-secondsAgo, 'second');
}
```

- Cells are siblings in a flex row — kind chip (auto), summary (`flex-1 truncate`), author (auto), timestamp (auto). The `truncate` class handles long wordings without breaking the row.
- No `<button>`, no `onClick`, no `role="button"` — the row is plain non-interactive in v1. `part_proposal_expand` (the next leaf) will lift the row into a focusable + tappable affordance.
- Author is mono-spaced so 8-char prefixes from different actors are visually aligned. The moderator uses the same treatment.
- The `<li>`'s `title` attribute carries the full summary so a moderator-style tooltip works on hover; touch-only contexts don't surface it but it costs nothing.
- `formatRelativeTime` is imported from `@a-conversa/i18n-catalogs` (the moderator's import path, already proven by `apps/moderator/src/layout/PendingProposalsPane.tsx:56`).

### What the new components MUST NOT do

- **No `fetch`, no `WebSocket`, no `useEffect` side effects.** Selector + summary + row are pure renders / pure functions.
- **No direct `useWsStore.setState` writes.** The pane is a read-only consumer.
- **No router-level state.** No `useNavigate`, no `useSearchParams`.
- **No tap-to-expand wiring.** The row carries no `onClick`. Future leaves bind interactivity.
- **No animation, no transition.** The row's mount/unmount on event-log change is an instantaneous DOM swap.
- **No moderator-only affordances.** No commit / mark-meta-disagreement / withdraw / facet-breakdown / per-participant indicators inside the row.

### Test layers per ADR 0022

Five pins, each anchoring a different observable property:

1. **Vitest `derivePendingProposals.test.ts` (NEW)** — mirror of the moderator's coverage:
   - (a) Empty event log → empty array.
   - (b) Single `proposal` event → one row with the expected proposalEventId / sequence / proposal / actor / createdAt.
   - (c) Two `proposal` events at sequences `1` and `2` → rows ordered `[2, 1]` (newest first).
   - (d) `proposal` → `commit` (proposal-arm) → row terminated.
   - (e) `proposal` (set-node-substance) → `commit` (facet-arm with matching `(node, id, substance)`) → row terminated via the `currentProposalByFacet` map.
   - (f) `proposal` → `meta-disagreement-marked` (proposal-arm) → row terminated.
   - (g) `proposal` (classify-node) → `meta-disagreement-marked` (facet-arm) → row terminated.
   - (h) Two facet-valued proposals on the same `(node, facet)` triple in sequence → the second supersedes the first as the `currentProposalByFacet` target (a later facet-arm `commit` terminates only the second; the first remains pending unless also terminated separately).
   - (i) Mixed event kinds (`node-created`, `vote`, etc. interleaved) → ignored; only `proposal` / `commit` / `meta-disagreement-marked` participate.
   - Total: 9 cases.

2. **Vitest `proposalSummary.test.ts` (NEW)** — one case per sub-kind plus the fall-through:
   - (a) `capture-node` → `node <8-char>`.
   - (b) `classify-node` → `node <8-char>`.
   - (c) `set-node-substance` → `Set substance = <value> (node <8-char>)`.
   - (d) `set-edge-substance` → `Set substance = <value> (edge <8-char>)`.
   - (e) `edit-wording` → `new_wording` verbatim.
   - (f) `amend-node` → `new_content` verbatim.
   - (g) `meta-move` → `<meta_kind>: <content>`.
   - (h) `annotate` → `<annotation_kind>: <content>`.
   - (i) `decompose` → `Decompose into <n> components`.
   - (j) `interpretive-split` → `Split into <n> readings`.
   - (k) `axiom-mark` → `Axiom-mark (participant <8-char>)`.
   - (l) `break-edge` → `Break edge <8-char>`.
   - (m) Unknown sub-kind (cast hack) → raw `kind` string.
   - Total: 13 cases.

3. **Vitest `PendingProposalsPane.test.tsx` (extended)** — add five new cases on top of the existing four:
   - (e) Event log with one `proposal` event → one `participant-pending-proposal-row` visible; `data-proposal-id` matches the event id.
   - (f) Event log with two `proposal` events at sequences `1` and `2` → rows render in order `[2, 1]` (newest first); the first `<li>` in DOM order carries `data-proposal-id` matching sequence `2`.
   - (g) Event log with one `proposal` event of kind `classify-node` (classification `'fact'`) → the row's kind chip text is the `methodology.kind.fact` catalog string.
   - (h) Event log with one `proposal` event whose `actor === null` → the row's author cell renders the `participant.pendingProposalsPane.systemAuthor` catalog string.
   - (i) Event log with one `proposal` event followed by a matching `commit` event → the pane is back to the empty-state branch (no rows visible; `participant-pending-proposals-pane-empty` testid visible).
   - The existing four cases stay passing; the empty-state branch now activates on `derivePendingProposals(events).length === 0` instead of the old `pendingProposals` map test (cases (a) — undefined pendingProposals — and (b) — empty pendingProposals — are rewritten to seed undefined / empty events instead; the user-visible behavior is unchanged).
   - Total new: 5; total in suite after this leaf: 9. Smoke count growth: +5 (the existing 4 cases are preserved with adjusted fixtures, not duplicated).

4. **Playwright extension to `tests/e2e/participant-pending-proposals.spec.ts`** — the existing scenario's step 5 (the non-empty branch assertion) is extended:
   - Seed BOTH a `proposal` event (a `capture-node` of a new node id) AND the existing `proposal-status` envelope so the row source AND the badge source are both populated.
   - Assert exactly one `participant-pending-proposal-row` is visible.
   - Assert the row's `data-proposal-id` matches the seeded `proposal` event id.
   - Assert the row's `participant-pending-proposal-row-summary` testid renders the expected `node <8-char>` text.
   - Assert the row's `participant-pending-proposal-row-author` testid renders the 8-char prefix of the seeded actor.
   - The existing step 5 assertion that `participant-pending-proposals-pane-list` is attached + `participant-pending-proposals-pane-empty` has count 0 stays.
   - No new scenario; one existing scenario extended.

5. **No new Cucumber scenario** (Decision §6). The read path is event-log + client-local pure function; Cucumber adds no protocol-boundary coverage here.

### UI-stream e2e policy (apply)

**E2e is in scope; scoped Playwright extension is the default.** The pane is already reachable (commit `fcaf09d` mounted it under the operate route's proposals tab); this leaf makes the row content user-visible the moment it lands. The natural anchor is the existing `participant-pending-proposals.spec.ts` scenario, which already walks login → join → operate route → tab switch → pane visible. Extending step 5 to assert the rendered row cells lands the e2e coverage without a new scenario file.

No e2e is deferred from this leaf.

### Backend / WS / projector / methodology-engine policy (apply)

This leaf changes NO wire shape, NO broadcast envelope, NO projector output. It walks the already-Cucumber-pinned event log in a client-local pure function. Decision §6 enumerates why no new Cucumber scenario is warranted.

### Budget honesty (1d)

The 1d budget breaks down roughly:

- ~30 min: duplicate `derivePendingProposals.ts` + `proposalSummary.ts` into `apps/participant/src/proposals/` (verbatim port with retargeted refinement-reference prose).
- ~1h: write the two Vitest unit suites (9 + 13 cases ≈ 22 cases; copy-adapt fixtures from the moderator's existing tests).
- ~30 min: extend `PendingProposalsPane.tsx` — switch the empty/non-empty selector, add the row map, add the co-located `<PendingProposalRow>` component, wire `useMemo` + `useTranslation` + `nowMsOverride` prop.
- ~30 min: extend `PendingProposalsPane.test.tsx` — rewrite the existing 4 cases to seed `events` instead of `pendingProposals`; add the 5 new row-rendering cases.
- ~45 min: extend the Playwright spec's step 5 — add the `proposal` event to the seed `evaluate`; add the row assertions.
- ~30 min: add the two i18n keys across en-US / pt-BR / es-419 + the two review.json PENDING lists; register the native-review chain leaf in `tasks/35-frontend-i18n.tji`.
- ~45 min: visual sanity at the participant's landscape viewport — verify the four cells fit in the row at 1280×720 + 1024×768 without wrap or overflow; verify the kind chip + author + timestamp don't crowd a long summary's `truncate`.
- ~1h: full `pnpm run check` + `pnpm run test:smoke` + `pnpm run test:e2e` + the WBS-status ritual.
- ~30 min: buffer for chip-text / Tailwind-class adjustments after the visual sanity pass.

Risk surface is modest. The main hazard is the empty/non-empty selector switch — keeping the empty-state branch active when the event log has no `proposal` events (even if a stale `pendingProposals` map slot lingers) is the right behavior, but the predecessor's test fixtures seed via the map. Decision §2 below explains the deliberate switch; the rewritten existing 4 cases pin the new semantic. The Playwright spec's step 5 already seeds via `applyEvent` (line 159 of the predecessor's spec) so the extension is additive.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm install` clean** — no dep changes.
2. **`pnpm -F @a-conversa/participant typecheck` exits zero** — the two new files, the extended pane, and the extended tests all compile under TypeScript strict mode.
3. **`pnpm -F @a-conversa/participant build` exits zero** — same library-mode build the predecessors pin; bundle filename / sidecar shape unchanged; new exports tree-shaken into the existing bundle.
4. **`pnpm run check`** stays green (lint + format + typecheck + typecheck-tools + typecheck-tests).
5. **`pnpm run test:smoke`** stays green; smoke count grows by **+27** (9 from `derivePendingProposals.test.ts` + 13 from `proposalSummary.test.ts` + 5 from the extended `PendingProposalsPane.test.tsx`).
6. **`pnpm --filter @a-conversa/i18n-catalogs run check`** (parity-check) green — the two new keys (`participant.pendingProposalsPane.systemAuthor`, `participant.pendingProposalsPane.paneAriaLabel`) present in all three locales; pt-BR + es-419 drafts flagged PENDING.
7. **`pnpm run test:e2e --project=chromium-participant-skeleton`** under `make up` runs the extended `participant-pending-proposals.spec.ts` green. The extended scenario surfaces a rendered `participant-pending-proposal-row` in step 5 with the seeded `proposalEventId` matching the row's `data-proposal-id`; the predecessor's tab-switch + empty-state + non-empty-branch assertions pass unchanged.
8. **No file modifications outside the explicit allowlist** in Constraints → "Files this task touches".
9. **The new components own no side effects** — a grep for `fetch\|XMLHttpRequest\|WebSocket\|useEffect\|window\.\|useNavigate\|useSearchParams` under `apps/participant/src/proposals/derivePendingProposals.ts` + `proposalSummary.ts` returns zero matches; the pane's `PendingProposalsPane.tsx` continues to own only `useWsStore` + `useMemo` + `useTranslation` (no `useEffect`).
10. **The selector is pure and behaviorally identical to the moderator's** — a `diff apps/participant/src/proposals/derivePendingProposals.ts apps/moderator/src/graph/pendingProposals.ts` shows only file-header refinement-reference differences (the algorithm body is byte-for-byte identical). Same for `proposalSummary.ts`. Acceptance reviewer confirms by spot-diff.
11. **The badge count selector is unchanged** — `apps/participant/src/proposals/usePendingProposalsCount.ts` is byte-for-byte unchanged; its tests pass unchanged.
12. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on the `part_proposal_list_view` task block per the task-completion ritual; separately, after the new `i18n_participant_proposal_list_native_review` leaf lands in `tasks/35-frontend-i18n.tji`.
13. **Predecessor's existing assertions unchanged** — the predecessor's tab-strip + count-badge tests pass; the predecessor's Playwright scenario (the unmodified parts) passes; the `PendingProposalsTabBar.tsx` + `usePendingProposalsCount.ts` files are untouched.

## Decisions

### 1. Duplicate `derivePendingProposals` + `summaryText` into the participant; don't extract to a shared package yet

Three alternatives surveyed:

- **(A) Duplicate the two pure functions into `apps/participant/src/proposals/`** (chosen). Both files are small (the selector ~80 LOC, the summary ~43 LOC), both consume only `ProposalPayload` / `Event` from `@a-conversa/shared-types`, both are byte-for-byte target-identical to the moderator's. The duplication is bounded and the third-consumer trigger is named explicitly.
- **(B) Extract to `@a-conversa/shell` (or a new `@a-conversa/proposal-projections` package)** so the moderator + participant import the same. Rejected for this 1d leaf — the extraction needs (i) a new entry-point in `packages/shell/src/index.ts`, (ii) moderator-side import retargeting + re-test, (iii) participant-side import wiring, (iv) test-fixture coordination across packages, and (v) the closer's status block has to register the cross-app refactor. The combined effort is 1.5-2d. The predecessor `part_proposals_tab` Decision §5 set the pattern: "shell extraction needs at least two consuming surfaces with substantially-overlapping requirements" — two moderator + participant consumers with byte-identical needs IS the trigger, but in practice the extraction is a separate planning step that the audience surface (the third consumer) is better positioned to initiate. This is the same call `apps/participant/src/ws/wsStore.ts` made with the `activeDiagnostics` map per `part_diagnostic_highlights.md` Decision §2 path (b) — duplicate locally; wait for the third consumer to trigger extraction.
- **(C) Cross-app import from `apps/moderator/src/graph/`** via a workspace TypeScript path alias. Rejected as a monorepo anti-pattern — apps depend on packages, not on each other. The participant `package.json` does NOT name `@a-conversa/moderator` (or any other app) as a dependency, and adding one would couple bundle outputs across surfaces.

The chosen approach pays one-time duplication cost now (a small one — ~120 LOC total across the two files); the third consumer (audience or replay) is the natural extraction trigger. The implementer of this leaf MUST register the future extraction task crisply (see Decision §8 → tech-debt registration).

### 2. Row source-of-truth is the event log, not the `pendingProposals` broadcast frame

Three alternatives surveyed:

- **(A) Walk `useWsStore.sessionState[id].events` via `derivePendingProposals`** (chosen). The event log carries the full `ProposalPayload` (so the row can render the kind chip / summary), the `actor` UUID (so the row can render the author column), and the `createdAt` ISO timestamp (so the row can render the relative-time column). It also carries the `commit` / `meta-disagreement-marked` events that terminate proposals — without them, the row list would carry stale entries that the broadcast frame has already cleared via per-facet status updates. The moderator's pane already uses this source by deliberate choice (per `mod_proposal_list` Decision §2: "Reads only the event log... Coupling to the status frames would make the pane stop working when the server's `proposal-status` broadcast is rate-limited or temporarily silent.")
- **(B) Walk `useWsStore.sessionState[id].pendingProposals` (the broadcast frame map)** — the same source the count badge consumes. Rejected. The map's per-entry shape is `{ proposalId, sequence, perFacetStatus }` — it carries NO proposal payload, NO actor, NO createdAt. The row's kind chip / summary / author / timestamp cells would all be unreachable. Even if the per-entry shape were extended on the wire (a protocol-boundary change with Cucumber cost), the map is per-proposalId without a per-event ordering — the "most-recent at top" sort key would need a separate signal, and `sequence` from the broadcast frame is the same monotonic counter as `event.sequence` only because the projector emits them in lockstep (a fragile coupling).
- **(C) Hybrid — derive rows from events, but cross-check against `pendingProposals` and drop any row whose proposalId isn't in the broadcast frame.** Rejected. Two failure modes: (i) the broadcast frame is allowed to be silent for a window (per `mod_proposal_list` Decision §2's rationale); during that window the cross-check would erase real pending rows. (ii) The opposite case — broadcast frame entry without a matching `proposal` event — should not happen in well-formed logs, and the implicit invariant is already pinned upstream. Adding a defensive cross-check would mask bugs.

The chosen approach is mechanically identical to the moderator's pane, which is the right reference point — the rows the two surfaces show should be the same set (modulo per-surface filtering, none of which this leaf adds).

### 3. Badge count selector stays on the `pendingProposals` map; deliberate skew accepted

Two alternatives surveyed:

- **(A) Keep `usePendingProposalsCount` reading the `pendingProposals` map** (chosen). The predecessor `part_proposals_tab` Decision §3 settled the badge as "total pending proposals via the map", with the per-participant-filter deferred to `part_vote_indicators_in_pane`. The predecessor's Playwright spec pins `data-count="1"` after the `applyProposalStatus` seed; switching the badge to read events would break that pin (the predecessor's spec seeds a `node-created` event before the `applyProposalStatus` envelope, but NOT a `proposal` event — `derivePendingProposals(events)` on that fixture would return 0 rows). Keeping the badge on the map preserves the predecessor's contract.
- **(B) Switch both the pane and the badge to `derivePendingProposals(events).length`** so they share a source. Rejected. Two reasons: (i) breaks the predecessor's Playwright assertion (above); changing it would mean editing a file the predecessor owns, which violates the convention that each leaf owns its own seam. (ii) The per-participant-filter that `part_vote_indicators_in_pane` will install (per `part_proposals_tab` Decision §3) requires a different selector body anyway — switching the source now would be churn that the next leaf would re-switch.

The deliberate skew is bounded: in well-formed sessions the server emits a `proposal-status` broadcast on every `proposal` event (per `ws_proposal_status_broadcast`'s contract), so the badge count and the rendered row count converge within one WS frame. A transient skew of one frame is the worst case, and it's invisible at human timing (~50ms or less).

If the skew ever surfaces a visible UX bug, the resolution is to converge both sources in `part_vote_indicators_in_pane` when the per-participant filter lands — that leaf is the right home for the alignment (it's already updating the selector body per Decision §3 of the predecessor).

### 4. Place files under `apps/participant/src/proposals/`, mirror moderator naming

Two alternatives surveyed:

- **(A) Both selector + summary live in `apps/participant/src/proposals/`** (chosen) — alongside the existing `PendingProposalsTabBar.tsx`, `PendingProposalsPane.tsx`, `usePendingProposalsCount.ts`, `index.ts` from the predecessor. Mirrors the moderator's `apps/moderator/src/graph/` location only in spirit; the participant doesn't have a `graph/` projection directory of comparable scale (the participant's graph projection memos live in-line in `OperateRoute.tsx`). The `proposals/` directory is the right home — the predecessor's Decision §5 already named it: "the directory name reflects the *domain* (pending proposals), which is the subgroup the sibling leaves all share."
- **(B) Split into `apps/participant/src/proposals/projections/` (selectors) + `apps/participant/src/proposals/components/` (UI)**. Rejected — premature directory-splitting. Two more files in a flat `proposals/` directory is well under any complexity threshold.

The `index.ts` barrel exports `derivePendingProposals`, `summaryText`, and the `PendingProposalRow` type (the latter so future sibling tests can import the type without re-importing the file).

### 5. Hard-coded English summary strings in v1; only two new i18n keys

Three alternatives surveyed:

- **(A) Reuse `methodology.kind.<classification>` keys for the classify-node chip; hard-code the other ten sub-kinds' summaries in English; register two NEW keys — `systemAuthor` + `paneAriaLabel`** (chosen). Mirrors `mod_proposal_list` Decision §7 verbatim: "the structural sub-kinds keep a hard-coded English placeholder until their own capture-flow tasks register summary catalog keys. The literal sub-kind name is a defensible v1." The participant inherits the same policy by mirroring the moderator selector. The two NEW keys (`systemAuthor` + `paneAriaLabel`) are necessary — the row's "System" fallback needs to localize per ICU practice, and the pane's `aria-label` needs to be a localized accessible name for screen-reader compliance.
- **(B) Register a `participant.proposalsRow.summary.<subKind>` key per sub-kind** (~11 new keys). Rejected. The moderator did NOT register these — and the moderator-and-participant surfaces should mirror each other. Registering them on the participant alone would make the two surfaces drift; registering on both would inflate the catalog by ~22 entries with no observed need (the moderator has shipped without them). When the future per-sub-kind capture-flow tasks add user-visible affordances, they can register both surfaces' keys together.
- **(C) Hard-code the chip too; skip the `methodology.kind.*` reuse.** Rejected. The chip text appears in both the moderator's pane and the participant's pane; reusing the same key (already in the catalog) is the right call.

### 6. No Cucumber scenario for the read path

Two alternatives surveyed:

- **(A) Pin via Vitest (selector + pane) + Playwright (end-to-end row render)** (chosen). The read path is: WS frames → `applyEvent` → `useWsStore.events` → `derivePendingProposals(events)` → rendered `<li>`s. The WS-frame → store-application boundary is already Cucumber-pinned by `ws_proposal_status_broadcast`'s scenarios; `applyEvent` is unit-tested in `wsStore.test.ts`; `derivePendingProposals` is a client-local pure function pinned by the new Vitest suite (mirroring the moderator's pre-existing tests). The rendered-row pin is Playwright. The orchestrator's "Cucumber if a surface ADDS wire/projector behavior" guidance applies when a NEW envelope or projection crosses the boundary — this leaf only consumes already-pinned data and the projection is client-local.
- **(B) Add a Cucumber scenario** asserting "when a `proposal` event applies to the participant's event log, the pending list shows one row." Rejected. The assertion is structurally identical to the moderator-side equivalent that already exists (or is implicitly covered by the broadcast scenarios + UI tests). Adding a participant-side mirror would duplicate the pin at higher cost without catching a class of bug the existing scenarios miss.

The orchestrator's note flagged Cucumber's flat scenario count for 6+ commits. The flatness is a hint to look for missed protocol-boundary coverage — checked, and the boundary IS already covered upstream. This leaf doesn't add new protocol behavior; it consumes the boundary.

### 7. No new ADR

This leaf introduces no architectural choice that isn't already covered:

- Event-log source of truth (Decision §2) — established by the moderator's `mod_proposal_list` Decision §2 (which already constituted the pattern).
- Duplicate-not-extract (Decision §1) — established by the predecessor `part_proposals_tab` Decision §5 + the participant wsStore `activeDiagnostics` precedent.
- Hard-coded English summary strings in v1 (Decision §5) — established by `mod_proposal_list` Decision §7.
- Tailwind utility classes (no shared token) — established by ADR 0005.
- No router-level state (the predecessor `part_proposals_tab` Decision §6 already settled this for the parent surface).
- WAI-ARIA `role="list"` + `<li>` semantics — canonical recipe.

### 8. Tech-debt registration

Three follow-ups named crisply for the closer:

- **`frontend_i18n.i18n_participant_proposal_list_native_review`** — pt-BR + es-419 native-speaker review of the two new keys (`participant.pendingProposalsPane.systemAuthor`, `participant.pendingProposalsPane.paneAriaLabel`). Effort: 0.25d. **Action for Closer**: register as a new WBS leaf in `tasks/35-frontend-i18n.tji`, chained after the predecessor's native-review leaf `i18n_participant_proposals_tab_native_review` and after this task: `depends !i18n_participant_proposals_tab_native_review, participant_ui.part_pending_proposals.part_proposal_list_view`.

- **`shell.shell_proposal_projection_extraction`** (provisional name; orchestrator can re-name) — lift `derivePendingProposals` + `summaryText` into a shared package (`@a-conversa/shell` is the natural home given its existing role; alternatively a new `@a-conversa/proposal-projections` if scope grows). Effort: ~1.5d (moderator + participant import retargeting + cross-app test alignment). **Action for Closer**: do NOT register a new leaf unprompted — the third-consumer trigger (audience or replay surface) is the natural moment. Mention in the Status block as a "future follow-up when the third surface needs the projection" so the orchestrator's next pick-task pass sees the duplication signal. The duplication itself is acceptable until the trigger fires.

- **Badge-count source alignment with the pane** — deferred to `part_vote_indicators_in_pane` per Decision §3. NO new leaf needed; the existing WBS entry will absorb the alignment when its per-participant-filter ships. The closer of `part_vote_indicators_in_pane` is responsible for updating `usePendingProposalsCount`'s body to read events (or to read a filtered view consistent with the pane's row source).

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-25.

- Participant pending-proposals pane now renders one `<li data-testid="participant-pending-proposal-row">` per surviving in-flight proposal newest-first by `event.sequence`; rows carry kind / summary / author / timestamp cells with stable testids matching the predecessor's contract. Source-of-truth switched from the `pendingProposals` broadcast map to the event log per Decision §2; the badge count selector (`usePendingProposalsCount`) is unchanged per Decision §3 (deliberate skew accepted; convergence deferred to `part_vote_indicators_in_pane`).
- New pure selector [`apps/participant/src/proposals/derivePendingProposals.ts`](../../../apps/participant/src/proposals/derivePendingProposals.ts) + helper [`apps/participant/src/proposals/proposalSummary.ts`](../../../apps/participant/src/proposals/proposalSummary.ts) duplicate the moderator's [`pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts) + [`proposalSummary.ts`](../../../apps/moderator/src/graph/proposalSummary.ts) verbatim per Decision §1; co-located `<PendingProposalRow>` lives inside [`PendingProposalsPane.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx). [`index.ts`](../../../apps/participant/src/proposals/index.ts) barrel exports the new symbols.
- Two new i18n keys land in [`en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) / [`pt-BR.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.json) / [`es-419.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.json): `participant.pendingProposalsPane.systemAuthor` + `participant.pendingProposalsPane.paneAriaLabel`. pt-BR + es-419 drafts flagged PENDING in [`pt-BR.review.json`](../../../packages/i18n-catalogs/src/catalogs/pt-BR.review.json) + [`es-419.review.json`](../../../packages/i18n-catalogs/src/catalogs/es-419.review.json); native-review leaf `i18n_participant_proposal_list_native_review` already registered in [`tasks/35-frontend-i18n.tji`](../../35-frontend-i18n.tji).
- Vitest: 4558 → 4585 (+27 = 9 [derivePendingProposals] + 13 [proposalSummary] + 5 [PendingProposalsPane row rendering]). The existing 4 pane cases were rewritten to seed events instead of the `pendingProposals` map; user-visible behavior is unchanged. Cucumber 263 → 263 (unchanged per Decision §6; Cucumber has been flat for 7 consecutive commits — flagged here so the next picker can steer toward a protocol-boundary leaf where Cucumber actually carries weight). Playwright 146 → 146 (one existing scenario in [`participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) extended; no new scenario file).
- Tech-debt note (no new WBS leaf per Decision §8): when a third consumer of `derivePendingProposals` + `summaryText` materializes (audience or replay surface), lift both into a shared package (`@a-conversa/shell` or new `@a-conversa/proposal-projections`, ~1.5d). Both moderator + participant files are byte-identical today; the third consumer is the right moment to extract.
