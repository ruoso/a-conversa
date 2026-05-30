# Playwright: per-component facet status in participant pending-proposals pane for a decompose proposal

**TaskJuggler entry**: `participant_ui.part_pending_proposals.part_pw_multi_component_decompose_per_component_breakdown` — [tasks/40-participant-ui.tji](../../40-participant-ui.tji) (block at L264–272). Registered as tech debt in the Status block of the predecessor [`participant_ui.part_pending_proposals.part_migrate_to_pending_proposal_facet_status`](./part_migrate_to_pending_proposal_facet_status.md) (Acceptance Criteria §Playwright — the deferred "multi-component decompose renders per-component facet status" sub-step). The Vitest regression cover lives at [`apps/participant/src/proposals/PendingProposalsPane.test.tsx:509–544`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) (case `(p3)`), but it pins the store-layer cell map only — `expect(facetStatus?.get('node:${COMPONENT_2}:classification')).toBe('proposed')` — without exercising the rendered chip strip. This task lifts the assertion to the browser via Playwright.

## Effort estimate

**0.5d** (per the `.tji` allocation). Breakdown:

- ~0.15d to extend [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) L106–129 (`facetTargetOf`) + L177–222 (`derivePerProposalFacets`) to walk `proposal.components` for `decompose` + `interpretive-split` and emit one entry per component keyed by `(entityKind: 'node', entityId: component.node_id, facet: 'classification')`, replacing the single synthetic `'proposal'` chip those two sub-kinds emit today. The other five structural sub-kinds (`axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) keep the synthetic-`'proposal'` chip behavior — they carry no per-component list on the wire (per [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts) L255–325).
- ~0.1d to extend [`apps/participant/src/proposals/PendingProposalsPane.test.tsx`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx)'s case `(p3)` (or sibling case) to assert the rendered chip strip carries N `participant-pending-proposal-row-facet` entries with `data-facet-status="proposed"` per component, NOT just the store-cell `expect`. The existing case-`(s)` "structural sub-kind" cover at [L566–579](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) stays valid for the other-five-structural-sub-kinds path; case `(p3)` becomes the per-component arm of that contract.
- ~0.25d to add a new sub-step inside the existing `test()` at [`tests/e2e/participant-pending-proposals.spec.ts:57`](../../../tests/e2e/participant-pending-proposals.spec.ts) that seeds a 2-component `decompose` proposal via the existing `__aConversaWsStore` test seam, then asserts both components' chips render `data-facet-status="proposed"`. The sub-step appends to the existing fixture's flow (kate creates a session, leo claims debater-A); no new test()/describe() block — Decision §3.

No moderator-side parity work is in scope. The moderator sidebar's [`derivePerProposalFacets`](../../../apps/moderator/src/graph/proposalFacets.ts) L252–304 keeps the single synthetic `'proposal'` chip for structural sub-kinds for now; lifting the per-component rendering to the moderator sidebar is registered as a follow-up task (see Decision §5 — `mod_per_component_decompose_sidebar_breakdown`, the closer registers in WBS).

## Inherited dependencies

**Settled:**

- [`participant_ui.part_pending_proposals.part_migrate_to_pending_proposal_facet_status`](./part_migrate_to_pending_proposal_facet_status.md) (done, commit `64c1d31` — **source of debt.** Its Acceptance Criteria §Playwright deferred the per-component-decompose e2e sub-step explicitly. Its D2 — `merge(eventsBasedIndex, buildFacetStatusIndexFromBroadcast(pendingProposalFacetStatus))` with broadcast winning per cell — is the merged index this task's per-component entries look up against. Its D1 (top-level `entityKind` + `entityId` on the wire) + D3 (the cell-keyed `pendingProposalFacetStatus` slot tightened to required) are the runtime invariants the new rendering arm consumes.)
- [`backend.websocket_protocol.facet_status_server_decompose_component_facets`](../../20-backend.tji) (done — `apps/server/src/ws/broadcast/proposal-status.ts`'s `facetTargetsForProposal(payload)` returns N per-component `FacetTarget[]` for pending `decompose` / `interpretive-split`; the snapshot-seed / catch-up handlers iterate and emit one envelope per target. The Playwright sub-step relies on the per-component cell-map state — when this task seeds via `state.applyProposalStatus(...)` twice (once per component) it mirrors the production server-emit shape verbatim.)
- [`backend.websocket_protocol.ws_proposal_status_broadcast`](../../20-backend.tji) (done — the `proposal-status` envelope schema carries the top-level `entityKind` + `entityId` per [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts)).
- [`participant_ui.part_pending_proposals.part_per_facet_breakdown_in_pane`](./part_per_facet_breakdown_in_pane.md) (done — established the chip strip's testids: `participant-pending-proposal-row-facets` (container) + `participant-pending-proposal-row-facet` (per-chip) + the `data-facet-name` / `data-facet-status` attribute contract at [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx:104–122`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx)).
- [`packages/shared-types`](../../../packages/shared-types) `decomposeProposalSchema` at [L303–309](../../../packages/shared-types/src/events/proposals.ts) — `components: z.array(proposalComponentSchema).min(2).max(10)`; each component carries `wording`, `classification`, and a REQUIRED `node_id` (UUID, minted client-side at envelope-build-time per ADR 0027). The per-component node id is the stable ref the per-component proposal-status envelope binds to.
- [ADR 0008 — Playwright + compose-stack layering](../../../docs/adr/0008-test-framework-playwright.md) — `page.evaluate(...)` is the canonical bridge for poking the same-origin `__aConversaWsStore` test seam (the existing fixture uses it at L142–224 to seed the steady-state row).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the chip-rendering wedge lands as committed production code with both Vitest cover (extended case `(p3)`) and Playwright cover (the new sub-step).
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-component `(entityKind: 'node', entityId: component.node_id, facet: 'classification')` cell is the facet-state surface 0027's decompose decision motivates.

**Pending:** (none — every input the task touches is settled on `main`.)

## What this task is

Pay down the deferred-e2e debt left by [`part_migrate_to_pending_proposal_facet_status`](./part_migrate_to_pending_proposal_facet_status.md)'s Acceptance Criteria §Playwright — the "multi-component decompose renders per-component facet status" sub-step that was deferred because the participant pane's chip-rendering arm at [`apps/participant/src/proposals/perProposalFacets.ts:204–221`](../../../apps/participant/src/proposals/perProposalFacets.ts) collapses every structural sub-kind to a SINGLE synthetic `'proposal'` chip, and the e2e was waiting on a per-component chip-rendering pass.

The deliverable touches three source files plus their tests:

1. **`apps/participant/src/proposals/perProposalFacets.ts`** — extend `derivePerProposalFacets` to fan out per-component entries for `decompose` + `interpretive-split` (the two structural sub-kinds that carry a `components` / `readings` list on the wire). Each entry uses `facet: 'classification'`, `labelKey: 'methodology.facet.classification'`, status resolved via the merged `facetStatusIndex` keyed by `(entityKind: 'node', entityId: component.node_id, facet: 'classification')`. The vote target stays `kind: 'proposal'` keyed by the proposal envelope id (NOT per-component facet arm) — see Decision §4.

2. **`apps/participant/src/proposals/PendingProposalsPane.test.tsx`** — extend case `(p3)` to assert the rendered DOM chips, not just the store cells. After `renderPane()`, expand the row and assert two `participant-pending-proposal-row-facet` entries, each `data-facet-name="classification"` + `data-facet-status="proposed"`. The store-cell assertions stay (they pin the migration contract); the new DOM assertions pin the per-component rendering arm this task introduces.

3. **`tests/e2e/participant-pending-proposals.spec.ts`** — append a new sub-step at the end of the existing `test()` at L57 that:
   - Seeds a `proposal` event (`kind: 'decompose'`, two `components` each with a fresh `node_id`) via `__aConversaWsStore.applyEvent(...)`.
   - Seeds two `proposal-status` envelopes via `__aConversaWsStore.applyProposalStatus(...)`, one per component, each `perFacetStatus: { classification: 'proposed' }`, `entityKind: 'node'`, `entityId: <component.node_id>`.
   - Expands the new row's header and asserts `participant-pending-proposal-row-facet` count is 2 inside the row, both `data-facet-status="proposed"`, both `data-facet-name="classification"`, distinguished by their `data-facet-name` parent locator's `aria-label` (or the row's structural data-attributes — see Decision §6).

The seed contract for the decompose envelope follows the predecessor case `(p3)`'s shape verbatim ([`PendingProposalsPane.test.tsx:518–537`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx)) — two per-component proposal-status envelopes carrying the SAME `proposalId` + `sequence` but differing `entityId`. This is the production server-emit shape (post-`facet_status_server_decompose_component_facets`); the e2e re-pins the participant browser's receive-side rendering against that shape.

## Why it needs to be done

The participant migration's `(p3)` Vitest case pinned the **store-layer** correctness (`pendingProposalFacetStatus` carries both component cells; no last-write-wins data loss). But the rendering arm at `derivePerProposalFacets` SILENTLY DROPS the per-component cells today — it returns one synthetic `'proposal'` chip regardless of how many components live in the store. A debater looking at the participant pane for a 2-component decompose sees one chip and cannot tell which component is in which state (proposed vs disputed vs withdrawn).

This is silent for two reasons:

1. **The Vitest cover walks the store, not the DOM.** Case `(p3)` `expect(facetStatus?.get(...))` would still pass even if `derivePerProposalFacets` returned `[]` — the rendering arm is unobserved.
2. **The Playwright cover at the steady state today only exercises `capture-node`.** The existing fixture seeds a single-facet `wording` chip ([L196–199](../../../tests/e2e/participant-pending-proposals.spec.ts)) and asserts one chip at `'proposed'`; it has no decompose scenario.

Without this task, the participant pane's per-component decompose styling has zero observable coverage at the browser surface. A future change to `derivePerProposalFacets` (or the `facetStatusIndex` build chain, or the chip strip's render loop) that breaks per-component rendering would land green on every existing test.

The downstream consumer is **R28 — Per-component agreement gating** (methodology contract per [`docs/methodology.md`](../../../docs/methodology.md)): the debater needs to see per-component proposed/disputed state to decide whether to vote `agree` on the proposal arm of a multi-component decompose. Without per-component chip rendering the debater cannot distinguish "all 4 components proposed, ready to commit" from "3 components proposed + 1 disputed, blocked on the 4th." The vote target itself stays proposal-arm (Decision §4), but the chips need to surface the per-component status the methodology requires the debater to read.

## Inputs / context

The relevant file/line refs (no invented references):

- **Current rendering arm — synthetic `'proposal'` chip for structural sub-kinds**: [`apps/participant/src/proposals/perProposalFacets.ts:106–129`](../../../apps/participant/src/proposals/perProposalFacets.ts) (`facetTargetOf` returns `null` for `decompose`, `interpretive-split`, `axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) + L204–221 (the `null` arm returns a single `{ facet: 'proposal', ... }` entry).
- **Chip strip render loop** — [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx:79–124`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx). Iterates `entries` and emits one `<span data-testid="participant-pending-proposal-row-facet" data-facet-name={entry.facet} data-facet-status={entry.status}>` per entry. **No change needed** to this component — extending the entry list per-component is sufficient.
- **Decompose payload shape** — [`packages/shared-types/src/events/proposals.ts:287–309`](../../../packages/shared-types/src/events/proposals.ts) (`decomposeProposalSchema` carries `components: ProposalComponent[]`; each `ProposalComponent` has `wording`, `classification` (`StatementKind`), and REQUIRED `node_id: z.string().uuid()`).
- **Interpretive-split payload shape** — [`packages/shared-types/src/events/proposals.ts:317–323`](../../../packages/shared-types/src/events/proposals.ts) (same shape as decompose; the `components` field is named `readings` semantically but the schema also names it `components` — see the file for the exact field name).
- **Per-component proposal-status emit on the server** — [`apps/server/src/ws/broadcast/proposal-status.ts`](../../../apps/server/src/ws/broadcast/proposal-status.ts) (per `backend.facet_status_server_decompose_component_facets`'s closure — `facetTargetsForProposal(payload)` walks the payload's component list and returns one `FacetTarget` per component keyed by `classification`).
- **Vitest seed pattern for decompose** — [`apps/participant/src/proposals/PendingProposalsPane.test.tsx:509–544`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) (case `(p3)`).
- **Vitest synthetic-`'proposal'` chip pattern (the other-five-structural-sub-kinds path)** — [`apps/participant/src/proposals/PendingProposalsPane.test.tsx:566–579`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) (case `(s)`).
- **Playwright seed pattern** — [`tests/e2e/participant-pending-proposals.spec.ts:142–224`](../../../tests/e2e/participant-pending-proposals.spec.ts) (the existing `state.applyEvent({...kind: 'proposal'...})` + `state.applyProposalStatus({...})` chain inside `page.evaluate`).
- **Existing single-facet chip assertion to pattern-match** — [`tests/e2e/participant-pending-proposals.spec.ts:272–286`](../../../tests/e2e/participant-pending-proposals.spec.ts) (asserts `participant-pending-proposal-row-facet[data-facet-name="wording"]` at `data-facet-status="proposed"`).

## Constraints / requirements

- **Per-component entries for `decompose` + `interpretive-split` only.** The other five structural sub-kinds (`axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) keep the synthetic `'proposal'` chip; their payloads have no `components` list and the methodology has no per-component status for them.
- **Vote target stays proposal-arm.** Each per-component entry's `voteTarget` is `{ kind: 'proposal', proposal_id: proposalEventId }` — NOT a per-component facet arm. Voting on a decompose is per-proposal (the debater votes once on the whole decomposition); the per-component chips surface STATUS, not a vote target. See Decision §4.
- **Status defaults to `'proposed'` when the cell is absent.** The two-tier resolveStatus contract from [`perProposalFacets.ts:141–156`](../../../apps/participant/src/proposals/perProposalFacets.ts) extends naturally — per-component lookups fall back to `'proposed'` if the broadcast cell hasn't arrived yet (consistent with the merge-broadcast-over-events contract from D2 of the predecessor).
- **No new `LifecycleFacetName` arm.** The per-component entries use `facet: 'classification'` — a `FacetName` arm that already exists. The synthetic `'proposal'` arm of `LifecycleFacetName` stays for the other five structural sub-kinds.
- **Vitest case `(p3)` must keep its store-layer assertions.** The case was added by the predecessor specifically to pin the store-layer correctness against the legacy last-write-wins bug; deleting those assertions would orphan the regression cover. The extension adds DOM assertions ALONGSIDE the existing store assertions, not in place of.
- **Playwright sub-step appends to the existing test, not a new test.** Per the spec's docblock at L1–18, the fixture seeds the test seam directly and pins UI consumers in one scenario. Adding a `test.describe.serial` sibling test would re-pay the `loginAs(kate)` + `createSession` + `loginAs(leo)` + `invite-acceptance` chain (~15s); appending costs ~2s.

## Acceptance criteria

**Vitest (per ADR 0022):**

- [ ] `apps/participant/src/proposals/perProposalFacets.test.ts` extended (or new sibling cases) — three new cases pin the per-component entries:
  - [ ] `decompose` proposal with 2 components, both cells absent from `facetStatusIndex` → returns 2 entries, each `facet: 'classification'`, both `status: 'proposed'`, distinct `voteTarget.proposal_id` matches the proposal envelope id.
  - [ ] `decompose` proposal with 2 components, one cell carries `'committed'` in `facetStatusIndex.nodes` → returns 2 entries, one `'proposed'` one `'committed'`, in the order the payload lists components (NOT sorted by status).
  - [ ] `interpretive-split` proposal with 3 readings → returns 3 entries, each `facet: 'classification'`.
- [ ] `apps/participant/src/proposals/PendingProposalsPane.test.tsx` case `(p3)` extended to assert the rendered DOM after `renderPane()` — two `participant-pending-proposal-row-facet` chips visible, both `data-facet-name="classification"` + `data-facet-status="proposed"`. The existing store-cell `expect`s stay.
- [ ] Case `(s)` "structural sub-kind with synthetic 'proposal' chip" stays green — the other-five-structural-sub-kinds path still emits the single synthetic chip (the case seeds a `decompose` today; if the chip surface changes, retarget case `(s)` to one of the five non-componented structural sub-kinds — e.g. `axiom-mark` — to preserve that contract).
- [ ] All other existing cases in `PendingProposalsPane.test.tsx`, `PerProposalFacetBreakdown.test.tsx`, `perProposalFacets.test.ts` stay green.

**Playwright (per UI-stream e2e policy — `tests/e2e/participant-pending-proposals.spec.ts`):**

- [ ] **Existing chromium scenario stays green.** Steps 1–8 (tab strip, badge, empty/non-empty branches, capture-node row, expand/collapse, single `wording` chip at `'proposed'`, OTHER-voter indicator) are unchanged.
- [ ] **New sub-step: 2-component decompose row renders per-component classification chips at `'proposed'`.** Appended after step 8 inside the same `test()`. Seeds via `__aConversaWsStore.applyEvent({...kind: 'proposal', payload: { proposal: { kind: 'decompose', parent_node_id: <existing seeded node>, components: [{wording, classification: 'fact', node_id: C1}, {wording, classification: 'fact', node_id: C2}] } }})` + two `applyProposalStatus({...entityKind: 'node', entityId: C1, perFacetStatus: {classification: 'proposed'}})` + symmetric for `C2`. Expands the new row and asserts:
  - `participant-pending-proposal-row-facet` count = 2 inside the new row's body.
  - Both chips: `data-facet-name="classification"` + `data-facet-status="proposed"`.
- [ ] **New sub-step: per-component statuses diverge correctly when only one cell arrives.** Within the same `test()`, after the both-`'proposed'` assertion: apply one more `applyProposalStatus` envelope flipping component `C1` to `'committed'` (`perFacetStatus: { classification: 'committed' }`, same `entityKind/entityId`). Re-assert: one chip at `data-facet-status="committed"`, one at `data-facet-status="proposed"`, both `data-facet-name="classification"`, in the order the payload listed components.

**Build + test gate** (per CLAUDE.md "always build and test before committing"):

- [ ] `pnpm -w build` clean.
- [ ] `pnpm -w lint` clean.
- [ ] `pnpm -w test` clean (Vitest across all packages; expect the extended `(p3)` + the three new `perProposalFacets.test.ts` cases to land green).
- [ ] `pnpm -F @a-conversa/e2e test -- participant-pending-proposals.spec.ts` clean (Playwright; the extended chromium scenario lands green under the compose stack — `make e2e` if the host stack needs a refresh).

**WBS:**

- [ ] `complete 100` added immediately after `allocate team` in [`tasks/40-participant-ui.tji`](../../40-participant-ui.tji) at the `part_pw_multi_component_decompose_per_component_breakdown` block (L264).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` returns silent.
- [ ] Status block appended to this refinement on commit per the [task-completion ritual](../README.md#task-completion-ritual).

**Deferred** (closer registers in WBS):

- [ ] **Moderator-sidebar parity** — extend [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts)'s `derivePerProposalFacets` to fan out per-component entries for `decompose` + `interpretive-split` the same way, with the moderator's existing sidebar `<ProposalFacetBreakdown>` testid contract. Defer to follow-up task `mod_per_component_decompose_sidebar_breakdown` (0.5d — closer registers in WBS under `moderator_ui.mod_graph_rendering`). The moderator-side `<GraphCanvasPane>` already styles per-component canvas nodes via the per-entity `computeFacetStatuses` walk (per `mod_decompose_propose_time_canvas_visibility`); only the sidebar's chip strip would change. Out of scope here per Decision §5 — the participant tablet is the per-component-status consumer the methodology requires; the moderator sidebar is a console-side mirror that can land independently.

## Decisions

### D1 — Extend `derivePerProposalFacets` rather than fork a new selector

**Chosen:** Extend the existing `derivePerProposalFacets(proposal, facetStatusIndex, ...)` in [`apps/participant/src/proposals/perProposalFacets.ts`](../../../apps/participant/src/proposals/perProposalFacets.ts) by adding a `componentTargetsOf(proposal)` helper alongside the existing `facetTargetOf(proposal)`. The dispatch becomes: if `facetTargetOf` returns non-null → one-entry facet-targeting arm (unchanged); else if `componentTargetsOf` returns non-empty → N-entry per-component arm (new); else → one-entry synthetic `'proposal'` arm (unchanged for the five non-componented structural sub-kinds).

**Alternatives:**

- **Fork a new selector** (`derivePerComponentFacets`) and dispatch at the call site in `<PerProposalFacetBreakdown>`. Rejected — would duplicate the merged-facetStatusIndex lookup contract + the `EMPTY_OTHER_VOTES_BY_PROPOSAL_INDEX` defaulting machinery; the chip-strip component would need a sub-kind branch to pick which selector to call. The single-selector-with-three-arm-dispatch keeps the consumer flat (`<PerProposalFacetBreakdown>` continues to call one selector and iterate its output).
- **Change the chip-strip component to handle per-component rendering directly** (skip the selector). Rejected — moves the proposal-payload destructuring into the React component, defeats the pure-selector pattern the predecessor refinements established, and complicates the Vitest cover (would need a React render + DOM assertions for what should be a 5-line selector unit test).

**Rationale:** The selector is the documented home for "decode a proposal payload into the breakdown's entry list" (per the docblock at [L1–17](../../../apps/participant/src/proposals/perProposalFacets.ts)); extending it preserves the selector-stays-pure invariant and keeps the consumer one-liner. The new `componentTargetsOf` helper is symmetric with the existing `facetTargetOf` — same partition shape, just N targets instead of zero-or-one.

### D2 — Per-component `facet: 'classification'`, NOT a new `LifecycleFacetName` arm

**Chosen:** Each per-component entry uses `facet: 'classification'` (a `FacetName` arm that already exists, per the methodology — every node has a classification facet that takes a `StatementKind` value: `fact`, `inference`, etc.). The chip's label key is `methodology.facet.classification`, which is already in the i18n catalog (per the per-facet-breakdown predecessor refinement).

**Alternatives:**

- **Introduce a new `LifecycleFacetName` arm** like `'component'` or `'decompose-component'` and a new label key. Rejected — the methodology doesn't model components as a distinct facet; a decompose component IS a node-with-classification, and the per-component status the server emits is keyed by the node's `classification` facet. Inventing a new facet name would create an in-app concept that has no wire-level counterpart and would force a new i18n key.
- **Use `facet: 'wording'`** (since each component also carries a wording). Rejected — the server's per-component proposal-status envelope keys on `classification`, not `wording` (per `facet_status_server_decompose_component_facets`'s closure). The chip's status would silently mis-resolve.

**Rationale:** Aligns the chip's facet name with the wire-level facet name the broadcast envelope keys on. The chip's `data-facet-status` lookup against the merged `facetStatusIndex` uses the same `(entityKind, entityId, facet)` triple the broadcast envelope writes, so the chip and the cell map share one schema.

### D3 — Playwright sub-step appends to the existing `test()`, not a new test

**Chosen:** The new sub-step appends at the bottom of the existing `test()` at [`tests/e2e/participant-pending-proposals.spec.ts:57`](../../../tests/e2e/participant-pending-proposals.spec.ts), inside the same `try { ... } finally { context.close() }` block. Seeds the decompose proposal via the same `__aConversaWsStore` test seam the existing fixture uses.

**Alternatives:**

- **New `test.describe.serial` block with a fresh fixture**. Rejected — would re-pay the `loginAs(kate)` + `createSession` + `loginAs(leo)` + `invite-acceptance-join-button` chain (~15s of setup) for an assertion that takes ~2s. The participant-pending-proposals spec's docblock at L1–18 explicitly says it "pins ... badge-count derivation, AND both empty-state + non-empty-state branches inside ONE scenario per the refinement's e2e plan" — extending the same scenario matches the established pattern.
- **A separate spec file `tests/e2e/participant-pending-proposals-decompose.spec.ts`**. Rejected — same setup-tax argument; also fragments the participant pane's e2e coverage across two files for no clarity gain.
- **Cross-surface fixture** (moderator browser drives a real decompose propose; participant browser observes). Rejected here — the existing spec's contract is "seed the test seam directly, leave the protocol-boundary guarantees to `ws_proposal_status_broadcast`'s scenarios" (per L14–18). The cross-surface coverage is the sibling [`tests/e2e/participant-reconnect-seed-visible-styling.spec.ts`](../../../tests/e2e/participant-reconnect-seed-visible-styling.spec.ts)'s job; this task pins the rendering arm specifically.

**Rationale:** Lowest wall-clock cost; consistent with the spec's stated scope; the seed-the-test-seam pattern is the established way to pin UI consumers without spinning the full WS-subscription chain.

### D4 — Per-component chips keep proposal-arm vote target, NOT per-component facet arm

**Chosen:** Each per-component entry's `voteTarget` is `{ kind: 'proposal', proposal_id: proposalEventId }` — identical to the synthetic `'proposal'` chip's vote target today. The chip displays per-component STATUS, but voting on a multi-component decompose remains a single proposal-arm vote.

**Alternatives:**

- **Per-component facet-arm vote target** (`{ kind: 'facet', entity_kind: 'node', entity_id: component.node_id, facet: 'classification' }`). Rejected — the methodology's decompose vote is per-proposal (the debater either accepts the entire decomposition or doesn't); per-component facet-arm voting would change the wire contract for `vote` envelopes and is out of scope. The methodology engine's commit handler keys on per-proposal proposal-arm votes for structural sub-kinds (per [`apps/server/src/ws/handlers/checkUnanimousAgreeStructural`](../../../apps/server/src/ws/handlers/) — see commit `421353f` history in [`apps/moderator/src/graph/proposalFacets.ts:278–290`](../../../apps/moderator/src/graph/proposalFacets.ts)).
- **No vote target at all** (mark per-component entries as read-only chips). Rejected — the `<ProposalFacetVoteButtons>` component at [`PerProposalFacetBreakdown.tsx:115–119`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) always renders against `entry.voteTarget`; an `undefined` arm would force a new union variant. Keeping the proposal-arm target means the per-component chips' vote buttons all drive the SAME proposal-arm vote — semantically identical to the synthetic chip's behavior today.

**Rationale:** Preserves the wire contract; keeps `<ProposalFacetVoteButtons>` unchanged; matches the methodology's per-proposal voting semantics for structural sub-kinds.

### D5 — Defer moderator-sidebar parity to a follow-up task

**Chosen:** This task scopes the participant pane only. The moderator sidebar's [`derivePerProposalFacets`](../../../apps/moderator/src/graph/proposalFacets.ts) at L252–304 keeps the synthetic `'proposal'` chip for structural sub-kinds for now. A follow-up task `mod_per_component_decompose_sidebar_breakdown` (registered by the closer in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji)) lifts the same per-component fan-out to the moderator sidebar.

**Alternatives:**

- **Land both surfaces in this task.** Rejected — doubles the source-files-touched count (the moderator sidebar's `derivePerProposalFacets` has a sibling consumer at [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx) with its own testid contract + its own Vitest cover + its own Playwright cover inside [`tests/e2e/methodology-full-flow.spec.ts:1265–1310`](../../../tests/e2e/methodology-full-flow.spec.ts)); the 0.5d effort would balloon to ~1d+, exceeding the `.tji` allocation. The TJI block scopes this task to the participant pane explicitly.
- **Defer ad-hoc without a named follow-up.** Rejected — the [tech-debt registration rule](../README.md#tech-debt-registration) requires deferrals surface as named WBS leaves, not Status-block prose.

**Rationale:** Matches the TJI scope; respects the effort allocation; the moderator's canvas already surfaces per-component status via the node colors (per `mod_decompose_propose_time_canvas_visibility`'s closure), so the moderator's sidebar is informational redundancy rather than a methodology-required surface. The participant pane is the methodology-required consumer because the debater has no canvas to read.

### D6 — Selector identifies per-component chips by `(data-facet-name, parent row's data-proposal-id, chip's row-relative DOM order)`

**Chosen:** Both per-component chips render with `data-facet-name="classification"` (Decision §2), so they cannot be distinguished by `data-facet-name` alone. The Playwright sub-step distinguishes them by their row-relative DOM order — `facets.locator('[data-testid="participant-pending-proposal-row-facet"]').nth(0)` vs `.nth(1)` — and the order matches the proposal payload's `components` array order (Decision §1 preserves payload order in `componentTargetsOf`).

**Alternatives:**

- **Add a per-component `data-entity-id` attribute on the chip.** Rejected — would extend the chip's data-attribute contract for this one case; the entity-id is already implicit in the parent row's `data-proposal-id` + the chip's payload-order index. Adding `data-entity-id` would also leak the per-component node UUID into the DOM, which is information the methodology doesn't require the UI to expose.
- **Distinguish by the chip's rendered text** (the classification label). Rejected — both components carry `classification: 'fact'` in the e2e fixture's seeded payload (the simplest two-component case); the rendered labels would be identical. Choosing different classifications per component (`fact` + `inference`) to force label-diff would add test setup overhead for an axis the assertion doesn't actually need to pin.

**Rationale:** Matches the chip-strip component's existing rendering contract (one chip per entry, in entry-list order); preserves the data-attribute surface; keeps the e2e assertion simple.

### D7 — Vitest case `(p3)` extension preserves existing store-cell assertions

**Chosen:** Extend case `(p3)` at [`PendingProposalsPane.test.tsx:509–544`](../../../apps/participant/src/proposals/PendingProposalsPane.test.tsx) to assert the rendered DOM chips AFTER the existing `expect(facetStatus?.get(...)).toBe('proposed')` store-cell assertions. The two assertion bundles coexist — store-cell first (predecessor's regression cover), DOM-chip second (this task's new contract).

**Alternatives:**

- **Replace the store-cell assertions with DOM assertions.** Rejected — orphans the predecessor's deliberate regression cover against last-write-wins data loss; if a future refactor re-introduces the bug at the store layer, the DOM assertion alone might still pass (e.g., if the chip-rendering fell back to per-payload-component iteration without reading the store cells).
- **Add a sibling case `(p3-dom)`.** Rejected — splits the per-component-decompose contract across two cases that share fixture setup; the case-comment for `(p3)` would need to point at `(p3-dom)` and vice-versa.

**Rationale:** Single case keeps the per-component-decompose contract atomic; both surfaces (store-layer + DOM-layer) are pinned by one test that fails clearly if either arm regresses.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/participant/src/proposals/perProposalFacets.ts` — added `componentTargetsOf` helper + per-component fan-out arm in `derivePerProposalFacets` for `decompose` + `interpretive-split`; status resolved via merged `facetStatusIndex` keyed by `(entityKind: 'node', entityId: component.node_id, facet: 'classification')`.
- `apps/participant/src/proposals/PerProposalFacetBreakdown.tsx` — React key changed to composite `${facet}-${index}` so per-component chips sharing `facet: 'classification'` don't collide.
- `apps/participant/src/proposals/perProposalFacets.test.ts` — excluded `decompose`/`interpretive-split` from structural-synthetic group; retargeted cases (h) + (l) to `axiom-mark`; added per-component cases (m), (n), (o) covering 2-component decompose (both absent, one committed) and 3-reading interpretive-split.
- `apps/participant/src/proposals/PendingProposalsPane.test.tsx` — added `axiomMarkProposalEvent` helper; retargeted case (s) from `decompose` to `axiom-mark`; extended case (p3) with DOM-chip assertions (two `classification` chips, both `proposed`).
- `tests/e2e/participant-pending-proposals.spec.ts` — appended sub-step 10b: seeds a 2-component decompose + per-component proposal-status envelopes, asserts 2 classification chips at `proposed`, then flips C1 to `committed` and re-asserts per-component divergence in payload order.
- Tech-debt follow-up registered in WBS: `moderator_ui.mod_graph_rendering.mod_per_component_decompose_sidebar_breakdown` (0.5d) — port per-component fan-out to moderator sidebar `derivePerProposalFacets`.
