# Migrate participant `usePendingProposalsCount` + `PendingProposalsPane` off legacy `pendingProposals` slot onto per-`(entityKind, entityId, facet)` broadcast-derived map

**TaskJuggler entry**: `participant_ui.part_pending_proposals.part_migrate_to_pending_proposal_facet_status` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji) (block at L244–252). Registered as tech debt in the Status block of the predecessor [`moderator_ui.mod_graph_rendering.migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`](../moderator-ui/migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md) (the moderator migration kept the legacy `pendingProposals` slot in `BaseWsSessionState` because participant consumers still read it; removing the slot without migrating those consumers would have broken participant Vitest fixtures). This task is the deferred follow-up.

## Effort estimate

**1d** (per the `.tji` allocation). The new per-entity slot (`pendingProposalFacetStatus`), the cell-to-`FacetStatusIndex` adapter (`buildFacetStatusIndexFromBroadcast`), and the broadcast-derived-merge pattern already exist on `main` from the predecessor — the moderator's `PendingProposalsPane.tsx:646–663` is the canonical reference shape this task mirrors. Work splits into: (a) re-wire `apps/participant/src/proposals/usePendingProposalsCount.ts` to derive from `derivePendingProposals(events)` (same source as the participant pane's row list, so badge count == row count by construction); (b) re-wire `apps/participant/src/proposals/PendingProposalsPane.tsx` to merge broadcast-derived facet status over the events-derived `FacetStatusIndex` (mirrors moderator L646–663) and drop the per-row `serverPerFacetStatus` prop pass; (c) remove the `pendingProposals: Record<string, ProposalStatusPayload>` slot from `packages/shell/src/ws/store-contract.ts` and its initialization + write paths from `packages/shell/src/ws/defaultStore.ts`; (d) update Vitest fixtures + add a participant Playwright re-pin that exercises the broadcast-derived rendering path.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_graph_rendering.migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`](../moderator-ui/migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md) (done — **source of debt.** Its Status block L236 names this task explicitly: "Participant migration deferred: `usePendingProposalsCount` + participant `PendingProposalsPane` still consume the legacy `pendingProposals` slot." Its D1 (top-level `entityKind` + `entityId` on the wire), D2 (cell-keyed `Map<${entityKind}:${entityId}:${facetName}, FacetStatus>` slot), D3 (`entity-removed` clears matching cells), D5 (`buildFacetStatusIndexFromBroadcast` adapter shape), and D7 (reconnect-seed envelopes on the requesting connection only, after `snapshot-state`) are runtime invariants this task relies on. Encoded as a hard `depends` in the `.tji` block.)
- [`participant_ui.part_pending_proposals.part_proposals_tab`](./part_proposals_tab.md) (done — its D3 established the `usePendingProposalsCount` hook as a broadcast-derived count, deliberately skewed from the events-derived row list to keep the selector lightweight. **That rationale is invalidated by the moderator migration:** the `pendingProposals` broadcast frame is no longer the receive-side source — the per-entity `pendingProposalFacetStatus` cell map is. The hook source switches per D1.)
- [`participant_ui.part_pending_proposals.part_proposal_list_view`](./part_proposal_list_view.md) (done — pane's `derivePendingProposals(events)` + row testid + ARIA contract. Pane row source stays untouched; the per-row facet-status source changes.)
- [`participant_ui.part_pending_proposals.part_per_facet_breakdown_in_pane`](./part_per_facet_breakdown_in_pane.md) (done — `PerProposalFacetBreakdown` + `derivePerProposalFacets` + the three-tier `resolveStatus` precedence (server frame → client mirror → `'proposed'` default) at [`apps/participant/src/proposals/perProposalFacets.ts:149–172`](../../../apps/participant/src/proposals/perProposalFacets.ts). The migration collapses precedence to "merged-index → `'proposed'`" because the merged index already carries the server-frame data.)
- [`shell_package.shell_facet_status_extract`](../shell-package/shell_facet_status_extract.md) (done — `FacetStatusIndex` shape + `computeFacetStatuses` + the new `buildFacetStatusIndexFromBroadcast` adapter live in [`packages/shell/src/facet-status/facet-status.ts`](../../../packages/shell/src/facet-status/facet-status.ts) (adapter at L662–685).)
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — projectors / broadcast subscribers as facet-state consumers; the participant's pending-proposal surface joins the moderator as one of those subscribers post-task.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every check ships as a committed test (Vitest at hook + pane level; Playwright at the participant surface).

**Pending (acknowledged-but-not-blocking):**

- [`moderator_ui.mod_graph_rendering.mod_pw_reconnect_seed_visible_styling`](../moderator-ui/) — the moderator-side reconnect Playwright re-pin the predecessor deferred (no `killWebSocket()` harness hook existed at the time; the predecessor's Status block L235 names it). That task lands a `window.__testHooks?.killWebSocket?.()` shim; once landed, this refinement's participant reconnect sub-step can reuse it. NOT a hard depend per D6 — if the shim isn't in yet, this refinement's e2e covers the steady-state seed-on-initial-connect path only and acknowledges the reconnect sub-step as inherited from `mod_pw_reconnect_seed_visible_styling` when that ships.

## What this task is

Move the participant's two remaining `pendingProposals` consumers — the `usePendingProposalsCount` badge selector and the per-row `serverPerFacetStatus` prop pass in `PendingProposalsPane` — onto the broadcast-derived per-entity slot landed by the moderator migration, then delete the legacy `pendingProposals: Record<string, ProposalStatusPayload>` slot from `BaseWsSessionState` entirely.

Concretely, the deliverable touches five source files plus their Vitest siblings:

1. **`apps/participant/src/proposals/usePendingProposalsCount.ts`** — replace the current `Object.keys(s.sessionState[sid]?.pendingProposals).length` body with a count derived from `derivePendingProposals(events)` (the same source the participant pane's row list uses). Per D1 — the badge count and the pane row count then converge by construction. The hook's return type (`number`) and the call-site contract at [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) stay unchanged.

2. **`apps/participant/src/proposals/PendingProposalsPane.tsx`** L77–82 + L126 — replace the legacy `pendingProposals` selector + the per-row `serverPerFacetStatus={pendingProposals[row.proposalEventId]?.perFacetStatus}` prop pass with the moderator's broadcast-derived-merge pattern (mirror [`apps/moderator/src/layout/PendingProposalsPane.tsx:626–663`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx)):
   - Subscribe to `pendingProposalFacetStatus` via `useWsStore((s) => s.sessionState[sessionId]?.pendingProposalFacetStatus)`.
   - Build `facetStatusIndex` as `merge(eventsBasedIndex, buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus))` with broadcast winning per `(entityKind, entityId, facet)` cell.
   - Drop the `serverPerFacetStatus` prop from `PendingProposalRow` and its forwarding into `PerProposalFacetBreakdown`. The merged index already carries the server-frame data; the three-tier precedence in `resolveStatus` collapses to two tiers per D2.

3. **`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`** + **`apps/participant/src/proposals/perProposalFacets.ts`** L149–172 — remove the `serverPerFacetStatus: Record<string, string> | undefined` parameter from `derivePerProposalFacets` + the corresponding precedence branch in `resolveStatus`. The function's effective precedence becomes `facetStatusIndex.nodes.get(id)?.[facet]` → `'proposed'` default. Per D2 — the merged-index branch covers both prior sources (broadcast frame + events-derived mirror) with broadcast winning.

4. **`packages/shell/src/ws/store-contract.ts`** L50–70 — delete the `pendingProposals: Record<string, ProposalStatusPayload>` slot from `BaseWsSessionState`. The comment block at L55–69 collapses to nothing (the slot is gone; the per-entity slot at L71–95 stays and absorbs the comment's intent reference).

5. **`packages/shell/src/ws/defaultStore.ts`** L106–119 + the session-init factory — remove `pendingProposals: {}` from the default session shape, and remove the `pendingProposals[payload.proposalId] = payload` write inside `applyProposalStatus` (the per-entity-cell write the predecessor added stays). `applyProposalStatus`'s remaining body is the per-`${entityKind}:${entityId}:${facetName}` cell write only.

6. **Test fixtures + tests** —
   - **Rewrite** [`apps/participant/src/ws/wsStore.test.ts`](../../../apps/participant/src/ws/wsStore.test.ts) L59–82 — the "applyProposalStatus populates `sessionState[sid].pendingProposals[pid]`" case is rewritten to assert the per-entity cell write (`session.pendingProposalFacetStatus.get('node:N1:classification') === 'proposed'`). Payload fixture gains `entityKind: 'node'` + `entityId` per the predecessor's D1.
   - **Rewrite** [`apps/participant/src/proposals/usePendingProposalsCount.test.ts`](../../../apps/participant/src/proposals/usePendingProposalsCount.test.ts) — cases (a)–(d) re-source from event-log seeds (one `proposal-made` event surfaces as one pending proposal via `derivePendingProposals`). The "missing session" + "empty" branches collapse to "no events / no pending proposals" (still distinguishable: the missing-session path returns `0` via the optional-chain; the no-pending-proposals path returns `0` via `derivePendingProposals.length === 0`).
   - **Extend** [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) (and the perProposalFacets sibling) — assert that a row's facet status renders from the broadcast-derived cell map even when the events-derived mirror would have returned `'proposed'`; assert the merge-precedence (broadcast wins) for the case where both surfaces carry differing values for the same cell (the predecessor's Case D transition `'proposed' → 'committed'`).
   - **Playwright** — see Acceptance criteria for the participant-side re-pin.

## Why it needs to be done

**Closes the partial-migration gap from the predecessor.** The moderator migration intentionally left `pendingProposals: Record<string, ProposalStatusPayload>` in `BaseWsSessionState` (with the slot's docstring at `store-contract.ts:55–69` flagging the carry-over as tech debt) because removing it would have broken `apps/participant/src/ws/wsStore.test.ts:73` and the participant pane's L126 lookup. Until this task lands, the shell store carries two parallel facet-status surfaces — the legacy per-proposal map AND the new per-entity cell map — with the receive-side `applyProposalStatus` writing into both on every envelope. That's wasted work per envelope + a shape-evolution liability (any new field on `ProposalStatusPayload` has to be threaded through both surfaces).

**Single-source-of-truth, end-to-end.** The predecessor's "Why it needs to be done" rationale (single-source-of-truth invariant, predecessor commit's deferred lockstep, wire-shape gap exposed by multi-envelope-per-proposal) applies symmetrically to the participant surface. The participant's per-row breakdown today has the SAME multi-envelope-per-proposal silent-loss bug the moderator had pre-migration: `pendingProposals[proposalId]` is keyed by proposalId, so a 2-component decompose's two `proposal-status` envelopes overwrite each other; the second component's status wins, the first is lost. The migration fixes this for the participant alongside the moderator's fix.

**Cell-keyed broadcast naturally fits the participant's per-(entity, facet) UI.** The participant pane already renders per-row, per-facet chips (per `part_per_facet_breakdown_in_pane`). The per-`(entityKind, entityId, facetName)` cell map maps 1:1 onto what the chips render. The legacy per-proposal `Record<proposalId, Record<facetName, status>>` indirection forced every chip to first look up the proposal, then the facet, then resolve which entity-id within the proposal payload the chip was about — three hops where one suffices.

**Eliminates the deliberate badge/pane skew.** Per `part_proposals_tab.md` D3, the badge count came from the broadcast frame and the pane row count from the event log; the predecessor rationalized the skew as "convergent within one WS frame." Post-migration, the broadcast frame's per-proposalId slot doesn't exist — the badge MUST re-source. Switching to `derivePendingProposals(events)` makes the badge and pane rows the same source by construction; the skew is no longer a tolerated drift but an algebraic identity.

**Unlocks downstream tasks.** [`participant_ui.part_voting.part_vote_button_per_facet`](../../40-participant-ui.tji) and successors continue to read facet status off the per-entity map (already settled; no rework). The audience (`audience.aud_graph_rendering`) inherits the same broadcast-derived shape transitively. The shell-package consumers (methodology engine, `apps/moderator/src/graph/selectors.ts`) still read `computeFacetStatuses(events)` — out of scope for this task per the predecessor's `.tji` "the rest of the mirror may stay" clause.

## Inputs / context

**Design contract (canonical):**

- [`docs/methodology.md`](../../../docs/methodology.md) L57 — visible-status `proposed` contract. Preserved through the source-of-truth swap; the participant chip color contract per `part_per_facet_state_styling` is unchanged.
- [`docs/methodology.md`](../../../docs/methodology.md) L84 — multi-component decompose contract; this task makes the participant pane's per-component facet rendering correct under multi-component proposals (where it silently lost data today; see Why §3).
- [`docs/data-model.md`](../../../docs/data-model.md) L84–87 — facets-of-resulting-entities-start-`proposed` contract.

**Architectural / engineering inputs:**

- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — participant pane becomes a broadcast subscriber.
- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md) — wire-shape contract; this task doesn't extend the schema (the predecessor already added `entityKind` + `entityId`).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — Vitest + Playwright cover.
- [ADR 0006 — Vitest](../../../docs/adr/0006-test-framework-vitest.md) — pure-logic unit cover.
- [ADR 0008 — Playwright + compose for participant e2e](../../../docs/adr/0008-test-framework-playwright.md) — UI-stream e2e cover.

**Runtime inputs (real file references the implementer reads + edits):**

- [`apps/participant/src/proposals/usePendingProposalsCount.ts:13–18`](../../../apps/participant/src/proposals/usePendingProposalsCount.ts) — selector body to re-source. Result: `useWsStore((s) => derivePendingProposals(s.sessionState[sessionId]?.events ?? []).length)` (or equivalent with a `useMemo`-wrapped pattern at the call-site; see D1 for the cost reasoning).
- [`apps/participant/src/proposals/PendingProposalsPane.tsx:77–82,126`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — the legacy `pendingProposals` selector + the per-row `serverPerFacetStatus` prop pass.
- [`apps/participant/src/proposals/PendingProposalsPane.tsx:50`](../../../apps/participant/src/proposals/PendingProposalsPane.tsx) — `EMPTY_PENDING_PROPOSALS` sentinel is deleted alongside the slot.
- [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) — `serverPerFacetStatus` prop drops; component re-types accordingly.
- [`apps/participant/src/proposals/perProposalFacets.ts:149–172`](../../../apps/participant/src/proposals/perProposalFacets.ts) — `resolveStatus` precedence collapses from three tiers to two.
- [`apps/participant/src/proposals/PendingProposalsTabBar.tsx`](../../../apps/participant/src/proposals/PendingProposalsTabBar.tsx) — call-site for `usePendingProposalsCount`. UNCHANGED — the hook return shape stays `number`.
- [`apps/moderator/src/layout/PendingProposalsPane.tsx:626–663`](../../../apps/moderator/src/layout/PendingProposalsPane.tsx) — canonical reference shape for the broadcast-derived-merge pattern this task lifts to the participant.
- [`packages/shell/src/ws/store-contract.ts:50–70`](../../../packages/shell/src/ws/store-contract.ts) — `BaseWsSessionState.pendingProposals` slot to delete.
- [`packages/shell/src/ws/store-contract.ts:71–95`](../../../packages/shell/src/ws/store-contract.ts) — `pendingProposalFacetStatus` slot stays. Its current `?:` optional marker (added per the predecessor for test-fixture compat) is upgraded to required on the type — every store now ships this slot since the legacy slot is gone. See D3 for the rationale on tightening the type.
- [`packages/shell/src/ws/defaultStore.ts:106–119`](../../../packages/shell/src/ws/defaultStore.ts) — `applyProposalStatus` reducer. Remove the `pendingProposals[payload.proposalId] = payload` write; keep the per-entity-cell write.
- [`packages/shell/src/ws/defaultStore.ts`](../../../packages/shell/src/ws/defaultStore.ts) (session-init factory) — `pendingProposals: {}` initialization drops.
- [`packages/shell/src/facet-status/facet-status.ts:662–685`](../../../packages/shell/src/facet-status/facet-status.ts) — `buildFacetStatusIndexFromBroadcast` adapter. Reused as-is.
- [`apps/participant/src/proposals/derivePendingProposals.ts`](../../../apps/participant/src/proposals/derivePendingProposals.ts) — pure events-walker that surfaces the surviving pending proposals (the pane already uses it for row derivation; the badge selector adopts the same).
- [`apps/participant/src/ws/wsStore.test.ts:59–82`](../../../apps/participant/src/ws/wsStore.test.ts) — test case to rewrite.
- [`apps/participant/src/proposals/usePendingProposalsCount.test.ts`](../../../apps/participant/src/proposals/usePendingProposalsCount.test.ts) — test cases to re-source.
- [`tests/e2e/participant-pending-proposals.spec.ts`](../../../tests/e2e/participant-pending-proposals.spec.ts) — existing Playwright cover for participant pending-proposals; the re-pin target. The new sub-step exercises the broadcast-derived rendering path for a multi-component proposal.

## Constraints / requirements

- **No wire-shape change.** The predecessor already added `entityKind` + `entityId` to `proposalStatusPayloadSchema`. This task is purely receive-side rewiring + slot removal.
- **No new envelope kind.** Receivers still consume the existing `proposal-status` envelope and the existing reconnect-seed envelopes — landed by the predecessor.
- **`pendingProposals` slot is removed in this commit, not deprecated.** Per D3 — no `// @deprecated` window, no parallel writes. The atomic removal forces the test/fixture migration in the same commit (mirrors the predecessor's atomic removal of the `computeFacetStatuses` decompose / interpretive-split arm).
- **`pendingProposalFacetStatus` becomes required on `BaseWsSessionState`.** The `?:` optional marker added by the predecessor (because some legacy test fixtures pre-dated the slot) is removed. The default-store factory always populates `new Map()`; the test-fixture compat path (per the predecessor's docstring) is no longer needed because this task migrates the fixtures in the same commit. See D3.
- **`usePendingProposalsCount` derives from events.** Per D1 — the badge's source becomes `derivePendingProposals(s.sessionState[sessionId]?.events ?? []).length`. The hook subscribes to `events` reference (not the cell map), so the badge re-renders when the event log changes — `useMemo`-stable inside the call-site if needed.
- **Pane's `facetStatusIndex` becomes the merge of `(eventsBasedIndex, broadcastIndex)` with broadcast winning per cell.** Per D2 — mirrors the moderator pattern at `PendingProposalsPane.tsx:646–663`. The merge is `useMemo`-keyed on the broadcast Map reference + the events array reference; both update by reducer-replacement on the writer side, so referential equality is reliable.
- **`PerProposalFacetBreakdown.serverPerFacetStatus` prop is dropped.** Per D2 — the merged index carries the same data; passing a per-proposal `Record<string, string>` alongside is redundant + a stale-derivation hazard.
- **Test-fixture migration is in scope.** Per D5 — `wsStore.test.ts:59–82` and `usePendingProposalsCount.test.ts` are rewritten in the same commit. Fixtures that synthesize `BaseWsSessionState` literals omit `pendingProposals` (it's gone) and ship `pendingProposalFacetStatus: new Map()` (now required).
- **Per ADR 0022 test cover.** Pure-logic shell-store behaviour and selector behaviour → Vitest. Cross-surface end-to-end (the participant-visible behaviour the migration preserves + the multi-component-decompose case that was silently broken pre-migration) → Playwright re-pin of `participant-pending-proposals.spec.ts`.
- **Per ADR 0027 layer separation.** The participant becomes a broadcast subscriber for facet status; no events-stream derivation of facet status replaces the broadcast as source-of-truth (the events-derived fallback in the merge is a snapshot-seed → first-render-window guard only, mirroring the moderator).

## Acceptance criteria

**Pinned per ADR 0022 — every check ships as a committed test.** This IS a UI-stream task (participant-ui area); the UI-stream e2e policy applies. The existing Playwright spec `tests/e2e/participant-pending-proposals.spec.ts` is the right re-pin target (the participant pending-proposals tab + pane are reachable from the participant route + the spec already exercises the user-visible behavior the migration preserves) — NOT a deferral to a future `part_pw_*` task. The reconnect sub-step inherits debt from `mod_pw_reconnect_seed_visible_styling` and is included if that task's harness shim is already on `main`; otherwise scoped as a follow-on note inside that task per D6.

Shell-store Vitest (per ADR 0022 — in `packages/shell/src/ws/defaultStore.test.ts` and the predecessor's `defaultStore.test.ts` cases):

- [ ] **`pendingProposals` slot is gone.** Every test in `defaultStore.test.ts` that read `session.pendingProposals` either is deleted (the predecessor's "backward-compat skip" case) or rewritten to read `session.pendingProposalFacetStatus` (the per-entity write cases).
- [ ] **`pendingProposalFacetStatus` is always populated.** A freshly materialized session has `pendingProposalFacetStatus instanceof Map` and `pendingProposalFacetStatus.size === 0`. (Tightens the predecessor's "optional slot, defensive-narrow" pattern per D3.)
- [ ] **`applyProposalStatus` writes only the per-entity cell.** Asserting via direct store inspection: after applying a single envelope, `session.pendingProposalFacetStatus.get(cellKey)` is set; no other slot mutated.

Participant Vitest (per ADR 0022 — in `apps/participant/src/ws/wsStore.test.ts` + `apps/participant/src/proposals/usePendingProposalsCount.test.ts` + `apps/participant/src/proposals/PendingProposalsPane.test.tsx` + `apps/participant/src/proposals/perProposalFacets.test.ts`):

- [ ] **`wsStore.test.ts` "applyProposalStatus populates per-entity cell"** — rewritten case asserts `session.pendingProposalFacetStatus.get('node:<entityId>:classification') === 'proposed'`; payload fixture carries `entityKind: 'node'` + `entityId` per predecessor D1.
- [ ] **`usePendingProposalsCount` counts surviving pending proposals from events.** Cases:
  - (a) no events → 0.
  - (b) missing session → 0 (still distinct from (a); the optional-chain in the selector covers it).
  - (c) one `proposal-made` event + no commit / withdraw → 1.
  - (d) two `proposal-made` events → 2; after a `proposal-committed` for one of them, count drops to 1.
  - (e) re-renders when `events` reference updates via `applyEvent` (asserted via `act`-wrapped store mutation + DOM probe re-read, mirroring the existing (d) re-render pin).
- [ ] **Pane merges broadcast over events.** A pane fixture that synthesizes a node `N1`, an events-derived `'proposed'` cell at `N1:classification`, and a broadcast-derived `'committed'` cell at `N1:classification` renders the chip with the `'committed'` style. The merge precedence assertion mirrors moderator-side test `PendingProposalsPane.test.tsx` for the same case.
- [ ] **Pane renders multi-component decompose correctly.** Fixture: a 2-component pending decompose with `proposal-status` envelopes emitted per component (per predecessor D2 — distinct envelope UUIDs, same proposalId + sequence, differing entityId). The pane's `PerProposalFacetBreakdown` renders BOTH components' facet status — not just the last-write-wins single value the legacy `pendingProposals[proposalId]` lookup returned. This is the participant-side regression cover for the silent-loss bug the migration fixes.
- [ ] **`resolveStatus` precedence collapses to "merged-index → `'proposed'`".** The `perProposalFacets.test.ts` cases that asserted the three-tier precedence are rewritten to assert two tiers. Cases for "server frame absent + events-derived present" become "merged-index present" (same observable output). The `serverPerFacetStatus`-only fixture path is deleted alongside the prop.

Playwright (per UI-stream e2e policy — `tests/e2e/participant-pending-proposals.spec.ts`):

- [ ] **Existing chromium tests stay green.** The pane's row testid, chip color, and per-facet breakdown contracts are unchanged on the steady-state happy path; assertion shapes don't change.
- [ ] **New sub-step: multi-component decompose renders per-component facet status.** Within the existing fixture's flow, after a moderator-side decompose proposal is made (yielding 2 component nodes), the participant's pane row for that proposal exposes per-component `data-facet-status="proposed"` for BOTH components' breakdown entries. Pre-migration this scenario silently rendered only the last component's status; the e2e pins the post-migration correctness.
- [ ] **(Conditional) Reconnect-mid-decompose sub-step** — if `mod_pw_reconnect_seed_visible_styling` has landed the `window.__testHooks?.killWebSocket?.()` harness shim by the time this task ships, include a reconnect sub-step (kill WS, force reconnect, assert per-component styling re-appears within the snapshot-seed envelope round). If the shim is NOT yet on `main`, the sub-step is omitted and the inherited-debt line under `mod_pw_reconnect_seed_visible_styling` is extended to mention the participant pane (the closer of that task gains a participant assertion alongside the moderator one). Per D6.

Existing tests stay green:

- [ ] All existing Vitest suites pass. The `defaultStore.test.ts` "backward-compat skip" case (the predecessor's name) is deleted alongside the slot; tests that read `pendingProposals` are migrated.
- [ ] Existing Playwright suites (`moderator-proposed-entity-canvas-visibility`, `participant-*`, etc.) stay green — only `participant-pending-proposals.spec.ts` gains the new sub-step.

Build + scheduler:

- [ ] `pnpm -F @a-conversa/participant build` succeeds.
- [ ] `pnpm -F @a-conversa/shell build` succeeds.
- [ ] `pnpm run check` clean.
- [ ] `pnpm run test:smoke` green.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100`.

WBS:

- [ ] `tasks/40-participant-ui.tji` gets `complete 100` on `part_migrate_to_pending_proposal_facet_status` (closer applies the marker per the ritual).

## Decisions

- **D1 — `usePendingProposalsCount` derives from `derivePendingProposals(events)`, the same source as the pane row list.** The hook becomes `useWsStore((s) => derivePendingProposals(s.sessionState[sessionId]?.events ?? []).length)` (the call-site memoization is local to the WS-store selector, which is fine — the events array reference is reducer-stable). Badge count == pane row count by construction; the predecessor's "deliberate skew converges within one WS frame" rationale (`part_proposals_tab` D3) is moot because the broadcast frame's `pendingProposals` slot no longer exists for the badge to read. Rationale:
  - **Algebraic identity over deliberate skew.** "Badge equals row count" is a stronger invariant than "they converge within one WS frame"; the algebraic identity removes a class of badge/row-divergence bugs entirely.
  - **No new store slot needed.** The `events` array is already on every session record; the selector pulls from a slot every other participant surface already subscribes to.
  - **`derivePendingProposals` is pure + bounded.** It walks the event log once per render where the selector fires (Zustand re-runs the selector on each store change). The walk is O(events). For a typical session (≪ 10k events), this is sub-millisecond. The pane already pays this cost for row derivation; the badge selector is an additional walk per render. Acceptable per the predecessor refinement's similar reasoning at the moderator pane.
  - **Alternatives considered:**
    - **(B) Add `pendingProposalIds: ReadonlySet<string>` to `BaseWsSessionState`, written by `applyProposalStatus`.** Rejected — adds a parallel slot to maintain (the same pattern this migration is removing), and the set's deletion contract on commit / withdraw mirrors `pendingProposalFacetStatus`'s clear contract: now we have two parallel cleanup paths to keep in sync.
    - **(C) Count distinct entity-ids in `pendingProposalFacetStatus.keys()`.** Rejected — counts entities, not proposals. Structural sub-kinds without facet targets (`agree-with-axiom-mark` — none today, but the partition is per `facetTargetsForProposal`) would be undercounted; a decompose with 2 components would be counted as 2 even though it's one proposal.
    - **(D) Keep the broadcast-frame count by retaining a thin `pendingProposalIds: Set<string>` slot just for the badge.** Rejected — the thin slot is itself the legacy `pendingProposals` slot rebadged, with the same multi-envelope ordering caveats and the same parallel-write burden.

- **D2 — Pane `facetStatusIndex` merges broadcast over events (broadcast wins per cell); `PerProposalFacetBreakdown.serverPerFacetStatus` prop is dropped.** Mirrors the moderator pattern at `apps/moderator/src/layout/PendingProposalsPane.tsx:646–663`. Rationale:
  - **The merged index covers both prior sources.** Pre-migration, the three-tier precedence was `serverPerFacetStatus[facet]` → `facetStatusIndex.nodes.get(id)?.[facet]` → `'proposed'`. Post-migration, the merge fuses tiers 1 and 2 into the merged index (broadcast wins per cell); the precedence collapses cleanly to "merged-index → `'proposed'`". The `'proposed'` default fires for the same snapshot-seed → first-render window the predecessor's D4 documented.
  - **Drops the per-row `serverPerFacetStatus` prop pass.** A per-proposal `Record<string, string>` is a stale-derivation hazard — the merged index is the canonical source, and threading a per-proposal subset through the prop creates two ways to ask the same question. Worse, it's the wrong shape for multi-component proposals (the per-proposal record loses the per-component dimension; the merged index is per-entity).
  - **`derivePerProposalFacets` shrinks.** Its `serverPerFacetStatus` parameter drops; its body simplifies; its tests shrink by N cases.
  - **Alternatives considered:**
    - **(B) Keep the three-tier precedence and synthesize `serverPerFacetStatus` from the broadcast Map.** Rejected — duplicates the merge logic per row; tier-1 lookup becomes a Map walk; readers have to remember which tier wins.
    - **(C) Drop the events-derived tier entirely; broadcast is sole source.** Rejected — leaves a visible `'proposed'`-default flash during the snapshot-seed → first-render window (the predecessor's D4 documented this guard). The events-derived branch is the snapshot's pre-seed cover; keep it as the merge's lower priority.
    - **(D) Make `PerProposalFacetBreakdown` subscribe to the broadcast map itself.** Rejected — adds a per-row subscription where one per-pane subscription suffices; the merge is shared across all rows.

- **D3 — Remove the `pendingProposals` slot in the same commit; tighten `pendingProposalFacetStatus` from optional to required on `BaseWsSessionState`.** No deprecation window, no parallel-write phase. Rationale:
  - **Atomic migration is cheaper than two-phase.** The shell store's two consumers are the moderator (already migrated) and the participant (this task). Removing the slot in one commit, alongside the participant rewire + fixture updates, is a small contained diff. A two-phase deprecation would require a `// @deprecated` comment + a future cleanup task + a new tech-debt registration — three artifacts for the same outcome.
  - **The fixture compat reason for the `?:` optional marker is gone.** The predecessor made `pendingProposalFacetStatus?:` optional so synthetic `BaseWsSessionState` literals (test fixtures pre-dating the slot) kept compiling. This task touches and migrates those fixtures, so the optional marker can be removed; the type tightens to `pendingProposalFacetStatus: ReadonlyMap<string, FacetStatus>`. Tighter types catch slot omissions at compile time in any future fixture.
  - **Alternatives considered:**
    - **(B) Two-phase: stop writing to `pendingProposals` first, delete the slot later.** Rejected — wasted commit + tracked-debt artifact for no observable benefit; the participant test cases must change anyway in the deletion commit.
    - **(C) Keep `pendingProposalFacetStatus` optional indefinitely.** Rejected — the optional marker is a fixture-compat scaffold, not a contract. The migration removes the reason for the scaffold; the scaffold should follow.

- **D4 — Reuse the moderator's `buildFacetStatusIndexFromBroadcast` adapter as-is; do not introduce a participant-local helper.** The adapter lives at `packages/shell/src/facet-status/facet-status.ts:662–685` and is already exported from `@a-conversa/shell`. Rationale:
  - **Shape is identical.** The participant pane consumes the same `FacetStatusIndex` (`{ nodes, edges }`) the moderator does; the adapter's output is reusable verbatim.
  - **Single shared adapter prevents drift.** Two parallel adapters would risk diverging on edge cases (annotation cells, malformed keys, edge buckets); one adapter, one test suite at the shell layer.
  - **Alternative considered: a thinner participant-side helper that returns only the `nodes` bucket.** Rejected — the pane's downstream lookups go through `.nodes.get(id)?.[facet]` anyway; the `edges` bucket is empty for node-targeted proposals and the cost of carrying an empty map is negligible.

- **D5 — Test-fixture migration is in scope; fixture-only test files are rewritten in the same commit.** `apps/participant/src/ws/wsStore.test.ts:59–82` and `apps/participant/src/proposals/usePendingProposalsCount.test.ts` are rewritten; new participant-pane cases pin the multi-component-decompose regression cover (per Acceptance criteria). Rationale:
  - **The fixture migration unblocks D3.** Without rewriting the fixtures, the optional-marker tightening would re-introduce the same TypeScript breakages the predecessor's `?:` marker was put in to avoid. The fixture migration is the prerequisite for the type tightening.
  - **Test cover stays at parity or strengthens.** Pre-migration, `wsStore.test.ts` had one case asserting the legacy slot write; post-migration, one case asserts the per-entity cell write (parity). `usePendingProposalsCount.test.ts` had 4 cases (missing-session / empty / non-empty / re-render) against the legacy slot; post-migration, 5 cases against `derivePendingProposals` (missing-session / no-events / one / two-then-commit / re-render). Pane tests gain the multi-component case (net new cover).
  - **Alternative considered: deferred fixture cleanup to a follow-on task.** Rejected — the fixtures are touched by the build (the optional-marker tightening fails the build otherwise); the migration must land them together.

- **D6 — Reconnect-mid-decompose sub-step is contingent on `mod_pw_reconnect_seed_visible_styling`'s harness shim landing first; if not yet on `main`, the participant reconnect sub-step is deferred to that task's scope.** The predecessor's Status block L235 documents that `window.__testHooks?.killWebSocket?.()` did not exist in the shell `WsClient` harness at the time of the predecessor commit; the follow-on `mod_pw_reconnect_seed_visible_styling` task owns landing it. This task checks the harness state at implementation time. Rationale:
  - **Test surface alignment with available harness.** The reconnect sub-step needs the shim; without it, the only way to simulate a reconnect is to close the browser context, which loses the participant's pending state entirely (not a reconnect; a fresh subscribe).
  - **Inherited-debt-on-the-wiring-task policy.** Per [tasks/refinements/README.md](../README.md) and the UI-stream e2e policy section of this refinement-writer's prompt: when a future task lands the wiring that makes a deferred test reachable, that task's refinement scopes the missed coverage. `mod_pw_reconnect_seed_visible_styling` is the wiring task for the WS-kill harness; if it ships first, this task picks up the participant reconnect sub-step. If this task ships first, the moderator task's refinement gains a participant-side assertion alongside the moderator one.
  - **NOT a hard depend.** The participant migration's correctness (the multi-component-decompose fix, the badge/row-source unification, the legacy slot removal) is independent of the reconnect harness; sequencing this task before `mod_pw_reconnect_seed_visible_styling` is fine.
  - **Alternative considered: scope a participant-local `killWebSocket()` shim.** Rejected — duplicates the shell-level work the moderator task is already chartered for; better to wait one wiring task than to fork the harness.

- **D7 — No Cucumber scenario added.** The wire shape doesn't change (the predecessor already extended the schema); the broadcast-listener tests at `apps/server/src/ws/broadcast/proposal-status.test.ts` already pin the broadcast envelope shape. The reconnect-seed handler tests at `apps/server/src/ws/handlers/snapshot.test.ts` + `catch-up.test.ts` already pin the seed contract. The participant migration is observable at the UI layer (pane, badge, breakdown) and at the receiver-side shell-store layer — both Vitest. The protocol/replay-boundary criterion from the refinement-writer's prompt does NOT fire (no projector output change; no wire envelope change). Rationale:
  - **Cucumber is not the right layer for receive-side rewires.** The Cucumber suite covers server-side facet-state transitions per ADR 0007's pglite-backed model. The participant's `usePendingProposalsCount` source switch is purely client.
  - **Alternative considered: a Cucumber scenario asserting "after `proposal-status` envelope arrives at a participant, the pending count badge shows N."** Rejected — that's an integration assertion across the server + the participant UI; Playwright is the right harness (and the existing `participant-pending-proposals.spec.ts` already asserts the user-visible behavior).

## Open questions

(none — all decided in D1–D7. The reconnect sub-step is conditionally scoped via D6 against `mod_pw_reconnect_seed_visible_styling`'s sequencing; no new debt is registered because the wiring task already exists. The remaining legacy `computeFacetStatuses(events)` consumers in `apps/moderator/src/graph/selectors.ts` and the methodology engine are explicitly out-of-scope per the predecessor's `.tji` "rest of the mirror may stay" clause; this task does not widen that scope.)

## Status

**Done** — 2026-05-29.

- Re-sourced `usePendingProposalsCount` from `derivePendingProposals(events)` (badge count equals pane row count by construction): `apps/participant/src/proposals/usePendingProposalsCount.ts`, `usePendingProposalsCount.test.ts`
- Migrated `PendingProposalsPane` to broadcast-derived-merge pattern (mirrors moderator shape), dropped per-row `serverPerFacetStatus` prop pass: `apps/participant/src/proposals/PendingProposalsPane.tsx`, `PendingProposalsPane.test.tsx`
- Collapsed `derivePerProposalFacets` / `resolveStatus` from three-tier to two-tier precedence (merged-index → `'proposed'`); removed `serverPerFacetStatus` parameter: `apps/participant/src/proposals/perProposalFacets.ts`, `perProposalFacets.test.ts`, `PerProposalFacetBreakdown.tsx`, `PerProposalFacetBreakdown.test.tsx`
- Deleted `pendingProposals` slot from `BaseWsSessionState`; tightened `pendingProposalFacetStatus` from optional to required: `packages/shell/src/ws/store-contract.ts`, `defaultStore.ts`, `defaultStore.test.ts`, `ws-client.test.ts`
- Migrated participant and moderator WS-store test fixtures to new cell-map shape: `apps/participant/src/ws/wsStore.test.ts`, `apps/moderator/src/layout/PendingProposalsPane.test.tsx`
- Completed moderator-side cleanup in lockstep (missed by predecessor): `apps/moderator/src/graph/proposalFacets.ts`, `proposalFacets.test.ts`, `proposalFilter.ts`, `proposalFilter.test.ts`, `GraphCanvasPane.tsx`, `GraphCanvasPane.test.tsx`, `selectors.test.ts`, `ProposalFacetBreakdown.tsx`, `ProposalFacetBreakdown.test.tsx`, `CaptureTargetChip.test.tsx`
- Updated Playwright seed to post-D1 envelope shape (added `entityKind`/`entityId`): `tests/e2e/participant-pending-proposals.spec.ts`
- Deferred: participant Operate route `window.__testHooks.killWebSocket` install + reconnect-mid-decompose sub-step → `participant_ui.part_pending_proposals.part_pw_reconnect_seed_visible_styling`; per-component facet chip e2e → `participant_ui.part_pending_proposals.part_pw_multi_component_decompose_per_component_breakdown`
