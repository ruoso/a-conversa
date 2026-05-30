# Per-component classification chip fan-out in the moderator sidebar's pending-proposals pane (decompose + interpretive-split)

**TaskJuggler entry**: `moderator_ui.mod_graph_rendering.mod_per_component_decompose_sidebar_breakdown` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L351–359). Registered as tech debt in the Status block / Decision §5 / Acceptance-criteria-Deferred bullet of the predecessor [`participant_ui.part_pending_proposals.part_pw_multi_component_decompose_per_component_breakdown`](../participant-ui/part_pw_multi_component_decompose_per_component_breakdown.md). The participant pane now fans out one classification chip per component of a `decompose` / `interpretive-split` proposal; the moderator's right-sidebar `<ProposalFacetBreakdown>` still collapses both sub-kinds to a single synthetic `'proposal'` chip ([`apps/moderator/src/graph/proposalFacets.ts:277–303`](../../../apps/moderator/src/graph/proposalFacets.ts)). This task ports the same `componentTargetsOf` fan-out arm to the moderator sidebar selector.

## Effort estimate

**0.5d** (per the `.tji` allocation). Breakdown:

- ~0.15d to extend [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts) — add a `componentTargetsOf(proposal)` helper alongside the existing [`facetTargetOf`](../../../apps/moderator/src/graph/proposalFacets.ts) (L124–160), and insert a per-component dispatch arm in [`derivePerProposalFacets`](../../../apps/moderator/src/graph/proposalFacets.ts) between the facet-targeting arm (L259–276) and the synthetic-`'proposal'` arm (L277–303). The helper is byte-equivalent to the participant's [`componentTargetsOf` at L148–165](../../../apps/participant/src/proposals/perProposalFacets.ts) — same two cases (`decompose` walks `components`, `interpretive-split` walks `readings`), same per-component triple `(entityKind: 'node', entityId: <node_id>, facet: 'classification')`.
- ~0.05d to flip the React key in [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:168`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx) from `key={entry.facet}` to a composite `${entry.facet}-${index}` so per-component chips sharing `data-facet-name="classification"` don't collide on React reconciliation (mirrors the participant fix landed at [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) under the predecessor task).
- ~0.15d to extend [`apps/moderator/src/graph/proposalFacets.test.ts`](../../../apps/moderator/src/graph/proposalFacets.test.ts) — exclude `decompose` / `interpretive-split` from the existing structural-synthetic group (currently at L150–231, which today asserts a single `'proposal'` chip for all seven structural sub-kinds), retarget displaced structural cases onto `axiom-mark`, and add three new per-component cases (2-component decompose both-absent, 2-component decompose one-cell-committed-in-payload-order, 3-reading interpretive-split). Mirrors the participant's case set (m)/(n)/(o) at [`apps/participant/src/proposals/perProposalFacets.test.ts:380–466`](../../../apps/participant/src/proposals/perProposalFacets.test.ts).
- ~0.15d to add a Playwright sub-step inside [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) Phase 6 (decompose, around the proposal-vote block at L1260–1310) that asserts the moderator's right-sidebar `<ProposalFacetBreakdown>` renders **two** `proposal-facet-row` chips at `data-facet-name="classification"` (one per component) for the in-flight decompose row, rather than the single `data-facet-name="proposal"` chip the spec currently asserts on the participant detail panel. The vote-target assertion stays proposal-arm — the chips surface STATUS, not a per-component vote target.

The vote target stays proposal-arm. Only the chip-fan-out and the per-component status-resolution arm change. The moderator's `ProposalFacetEntry` shape ([proposalFacets.ts:68–101](../../../apps/moderator/src/graph/proposalFacets.ts)) does NOT carry a `voteTarget` field at all (it's a read-only console-side view; the participant tablet is the voter), so the participant's Decision §4 manifests on the moderator side as "per-component chips share the per-proposal `votes` bucket from `votesByProposalIndex`" — exactly what the existing structural-synthetic arm at L291–295 does today.

## Inherited dependencies

**Settled:**

- [`participant_ui.part_pending_proposals.part_pw_multi_component_decompose_per_component_breakdown`](../participant-ui/part_pw_multi_component_decompose_per_component_breakdown.md) (done, commit `38f0619` — **source of debt.** Its Decision §5 explicitly deferred the moderator-side parity to this task; its Status block lists the participant-side `componentTargetsOf` helper + the composite-React-key fix as the reference implementation. The selector arm and React-key fix this task lands are byte-equivalent ports.)
- [`moderator_ui.mod_pw_reconnect_seed_visible_styling`](./mod_pw_reconnect_seed_visible_styling.md) (done, commit `ecb70df` — direct predecessor per [TJI L354](../../30-moderator-ui.tji); installed `window.__testHooks.killWebSocket()` on the moderator console + extended Scenario 3 with a reconnect-mid-decompose sub-step. This task does NOT touch reconnect plumbing — only the sidebar's per-component chip rendering — but the predecessor confirms the moderator's decompose-proposal canvas state is stable through the reconnect path the per-component chips read against.)
- [`moderator_ui.mod_graph_rendering.mod_per_facet_breakdown`](./mod_per_facet_breakdown.md) (done — established the sidebar chip strip's testid contract: container `data-testid="proposal-facet-breakdown"` + `data-proposal-id`; per-chip `data-testid="proposal-facet-row"` + `data-facet-name` + `data-facet-status`. Its Decision §1 partitioned the eleven proposal sub-kinds into four facet-targeting vs seven structural — this task narrows the structural group, splitting `decompose` + `interpretive-split` out into a new per-component arm while the other five (`axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) keep the synthetic `'proposal'` chip.)
- [`moderator_ui.mod_graph_rendering.mod_vote_indicators_in_sidebar`](./mod_vote_indicators_in_sidebar.md) (done — added `votesByFacetIndex` + `votesByProposalIndex` parameters to `derivePerProposalFacets` and the per-chip vote-indicator row. Per-component chips reuse the proposal-arm `votesByProposalIndex.get(proposalEventId)` lookup exactly the way the synthetic `'proposal'` chip does at L292–295 today, so the vote-indicator row continues to render correctly without per-component bucketing.)
- [`backend.websocket_protocol.facet_status_server_decompose_component_facets`](../../20-backend.tji) (done — `apps/server/src/ws/broadcast/proposal-status.ts`'s `facetTargetsForProposal(payload)` returns one `FacetTarget` per component of a pending `decompose` / `interpretive-split`; snapshot-seed / catch-up handlers emit one envelope per target keyed by `(entityKind: 'node', entityId: component.node_id, facet: 'classification')`. The moderator console reads the merged `facetStatusIndex` built from these envelopes via `apps/moderator/src/graph/facetStatus.ts`; the new per-component arm looks up cells the server already emits.)
- [`backend.websocket_protocol.ws_proposal_status_broadcast`](../../20-backend.tji) (done — the `proposal-status` envelope carries the top-level `entityKind` + `entityId` per [`packages/shared-types/src/ws-envelope.ts`](../../../packages/shared-types/src/ws-envelope.ts)).
- [`packages/shared-types`](../../../packages/shared-types) `decomposeProposalSchema` at [L287–309](../../../packages/shared-types/src/events/proposals.ts) and `interpretiveSplitProposalSchema` at L317–323 — each component / reading carries `wording`, `classification`, and a REQUIRED `node_id: z.string().uuid()` minted client-side at envelope-build-time per [ADR 0027](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md).
- [ADR 0006 — Vitest](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0008 — Playwright + compose-stack layering](../../../docs/adr/0008-test-framework-playwright.md), [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the chip-rendering wedge lands as committed production code with both Vitest cover (extended/new cases) and Playwright cover (the new sub-step inside the existing `methodology-full-flow` decompose phase).
- [ADR 0027 — Entity and facet layers strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-component `(entityKind: 'node', entityId: component.node_id, facet: 'classification')` cell is the facet-state surface 0027's decompose decision motivates; the per-component chip is its console-side reading.

**Pending:** (none — every input the task touches is settled on `main`.)

## What this task is

Port the participant-side per-component classification chip fan-out to the moderator sidebar's pending-proposals pane, so the moderator console surfaces the same per-component status the participant tablet does for in-flight `decompose` + `interpretive-split` proposals.

The deliverable touches two production files and three test files:

1. **`apps/moderator/src/graph/proposalFacets.ts`** — add a `componentTargetsOf(proposal)` helper (byte-equivalent to the participant's L148–165) and a per-component dispatch arm in `derivePerProposalFacets`. The arm sits between the existing facet-targeting arm (`facetTargetOf` returns non-null → single facet entry) and the synthetic-`'proposal'` fallback (other five structural sub-kinds → single `'proposal'` entry). For each per-component target it emits `{ facet: 'classification', status: resolveStatus(componentTarget, facetStatusIndex), labelKey: labelKeyFor('classification'), votes: <proposal-arm bucket> }`. The `votes` field reads from the same `votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES` lookup the synthetic-`'proposal'` arm uses (Decision §3 — per-component chips share the proposal-arm vote bucket because the methodology votes per-proposal for structural sub-kinds; the chips surface status, not a per-component vote target).

2. **`apps/moderator/src/layout/ProposalFacetBreakdown.tsx`** — change the entry-list React key from `key={entry.facet}` (line 168) to a composite `key={`${entry.facet}-${entryIndex}`}`. Today's key is safe because each proposal emits at most one entry per facet name; this task makes multiple entries share `facet: 'classification'`, so the key must include the entry index to avoid React-reconciliation collisions (mirrors the participant fix landed by the predecessor).

3. **`apps/moderator/src/graph/proposalFacets.test.ts`** — narrow the existing structural-synthetic group at L150–231 to exclude `decompose` + `interpretive-split` (retarget any displaced cases onto `axiom-mark`, which keeps the synthetic chip and has no per-component payload); add three new cases mirroring the participant's (m)/(n)/(o) at [`perProposalFacets.test.ts:380–466`](../../../apps/participant/src/proposals/perProposalFacets.test.ts).

4. **`apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`** (if it exists — sibling Vitest cover for the React component) — extend with a 2-component-decompose render case asserting two `proposal-facet-row` chips both at `data-facet-name="classification"` + `data-facet-status="proposed"`.

5. **`tests/e2e/methodology-full-flow.spec.ts`** — add a sub-step inside the existing Phase 6 decompose block (around L1260–1310, where the participant detail-panel already asserts `data-facet-name="proposal"` for the in-flight decompose) that asserts the **moderator's right-sidebar** `<ProposalFacetBreakdown>` for the same in-flight decompose row renders 2 chips at `data-facet-name="classification"`, both `data-facet-status="proposed"`. This is Phase 6's existing scenario — no new `test()` block, no new fixture setup.

The participant pane keeps its existing `componentTargetsOf` arm; the participant-side rendering and tests are out of scope here (the predecessor task pinned them).

## Why it needs to be done

The participant pane fans out per-component classification chips so the debater can read "C1 proposed, C2 disputed" before voting agree/disagree on the proposal arm. The moderator's right-sidebar `<ProposalFacetBreakdown>` is the moderator's console-side mirror of that signal — but today it collapses every multi-component decompose to a single `'proposal'` chip whose `data-facet-status` reflects the proposal-level lifecycle, not the per-component cell state. The moderator running the session cannot see, from the sidebar, which component of a 2-component decompose is blocking commit when one component is in `'disputed'` while the other is `'proposed'`.

The methodology already requires per-component agreement gating for structural sub-kinds with a `components` / `readings` list (per [`docs/methodology.md`](../../../docs/methodology.md) decompose / interpretive-split semantics, and per ADR 0027's strict entity/facet separation: each component IS a `node` with its own `classification` facet). The server emits per-component proposal-status envelopes per `backend.facet_status_server_decompose_component_facets`. The participant tablet renders per-component chips. Only the moderator sidebar lags. This task closes that gap.

Without it, three concrete problems persist:

1. **Moderator running the session has incomplete visibility.** Today the moderator sees one chip per decompose; the methodology says the readiness of each component is the relevant per-cell state. The synthetic `'proposal'` chip aggregates by hiding the per-component breakdown.

2. **The moderator-side test surface has no DOM cover for per-component sidebar rendering.** The existing structural-sub-kind Vitest cases at [`proposalFacets.test.ts:150–231`](../../../apps/moderator/src/graph/proposalFacets.test.ts) all assert the synthetic `'proposal'` chip — a future change to `derivePerProposalFacets` (or the chip strip's render loop) that broke per-component fan-out would land green on every moderator-side test today.

3. **Cross-surface parity drift.** The participant pane and moderator sidebar emit divergent test-attribute shapes for the same decompose envelope. Any cross-surface scenario (e.g. methodology-full-flow Phase 6) that asserts only the participant arm hides moderator-side regressions; the new e2e sub-step pins both surfaces in one phase.

The downstream consumer is the moderator's read of per-component agreement gating during a live session — the same R28 signal the participant chips surface, mirrored on the console side.

## Inputs / context

The relevant file/line refs (no invented references):

- **Moderator sidebar selector — facet-targeting arm**: [`apps/moderator/src/graph/proposalFacets.ts:124–160`](../../../apps/moderator/src/graph/proposalFacets.ts) (`facetTargetOf`). Returns non-null for `capture-node` / `classify-node` / `set-node-substance` / `set-edge-substance` / `edit-wording`; returns `null` for the seven structural sub-kinds.
- **Moderator sidebar selector — current dispatch + synthetic arm**: [`apps/moderator/src/graph/proposalFacets.ts:252–304`](../../../apps/moderator/src/graph/proposalFacets.ts) (`derivePerProposalFacets`). L259–276 is the facet-targeting arm (1 entry); L277–303 is the synthetic-`'proposal'` fallback (1 entry, `votes` from `votesByProposalIndex` when `proposalEventId` is threaded).
- **Moderator sidebar entry shape**: [`apps/moderator/src/graph/proposalFacets.ts:68–101`](../../../apps/moderator/src/graph/proposalFacets.ts). `ProposalFacetEntry` has `{ facet: LifecycleFacetName, status: FacetStatus, labelKey: string, votes: readonly Vote[] }` — no `voteTarget` field. The moderator sidebar is read-only.
- **Moderator chip strip render loop + React key**: [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:135–178`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx). Container carries `data-testid="proposal-facet-breakdown"` + `data-proposal-id`; the loop at L140 emits one chip per entry with `data-testid="proposal-facet-row"` + `data-facet-name={entry.facet}` + `data-facet-status={entry.status}`. Line 168 is the offending `key={entry.facet}` — collides when multiple per-component entries share `facet: 'classification'`.
- **Moderator sidebar Vitest cover**: [`apps/moderator/src/graph/proposalFacets.test.ts:150–231`](../../../apps/moderator/src/graph/proposalFacets.test.ts) — the structural-sub-kind test array currently covers all seven structural sub-kinds (decompose at L153–170, interpretive-split at L172–189, plus axiom-mark / meta-move / break-edge / amend-node / annotate) and asserts each emits one synthetic `'proposal'` chip (L225 common: `expect(out[0]?.facet).toBe('proposal')`). After this task, decompose + interpretive-split must move to a per-component arm; the other five stay.
- **Participant reference — `componentTargetsOf` helper**: [`apps/participant/src/proposals/perProposalFacets.ts:148–165`](../../../apps/participant/src/proposals/perProposalFacets.ts). Two cases — `decompose` walks `components`, `interpretive-split` walks `readings`. Per-component triple is hardcoded `(entityKind: 'node', facet: 'classification')`.
- **Participant reference — dispatch in `derivePerProposalFacets`**: [`apps/participant/src/proposals/perProposalFacets.ts:213–281`](../../../apps/participant/src/proposals/perProposalFacets.ts). Order is facetTargetOf → componentTargetsOf → synthetic fallback. Per-component arm at L245–262 maps each component target to `{ facet: 'classification', status: resolveStatus(componentTarget, facetStatusIndex), labelKey: labelKeyFor('classification'), votes: proposalVotes, voteTarget: proposalVoteTarget }`.
- **Participant reference — composite React key**: [`apps/participant/src/proposals/PerProposalFacetBreakdown.tsx`](../../../apps/participant/src/proposals/PerProposalFacetBreakdown.tsx) (the predecessor flipped the key to `${facet}-${index}`).
- **Participant reference — per-component Vitest cases (m)/(n)/(o)**: [`apps/participant/src/proposals/perProposalFacets.test.ts:380–466`](../../../apps/participant/src/proposals/perProposalFacets.test.ts).
- **Participant Vitest fixture component UUIDs**: case (m) uses `COMPONENT_1 = '00000000-0000-4000-8000-00000000f001'` etc — the moderator cases will reuse the same UUID literal style for consistency.
- **Decompose payload schema**: [`packages/shared-types/src/events/proposals.ts:287–309`](../../../packages/shared-types/src/events/proposals.ts) — `components: ProposalComponent[]` with `min(2).max(10)`; each component has `wording`, `classification`, REQUIRED `node_id`.
- **Interpretive-split payload schema**: [`packages/shared-types/src/events/proposals.ts:317–323`](../../../packages/shared-types/src/events/proposals.ts) — same shape, field named `readings` semantically.
- **Per-component proposal-status emit on the server**: `apps/server/src/ws/broadcast/proposal-status.ts` (`facetTargetsForProposal(payload)` walks the payload's component list).
- **Methodology-full-flow Phase 6 decompose**: [`tests/e2e/methodology-full-flow.spec.ts:1221–1310`](../../../tests/e2e/methodology-full-flow.spec.ts) — Phase 6 already drives a real 2-component decompose end-to-end (alicePage → `graph-context-menu-item-propose-decompose`, fills `decompose-component-text-0`/`1` + classification `fact`/`fact`, broadcasts, asserts the participant detail-panel `data-facet-name="proposal"` row at L1267). This is where the moderator-sidebar sub-step plugs in — append to the same phase, assert the moderator's right-sidebar `[data-testid="proposal-facet-breakdown"]` for the decompose-row.
- **Moderator sidebar testid pattern in e2e**: [`tests/e2e/moderator-capture.spec.ts:1010–1107`](../../../tests/e2e/moderator-capture.spec.ts) — established the `getByTestId('proposal-facet-row').and(page.locator('[data-facet-name="..."]'))` selector composition. The new sub-step will reuse the same pattern with `data-facet-name="classification"` + a `[data-testid="proposal-facet-breakdown"][data-proposal-id="..."]` parent scope to disambiguate from other rows.

## Constraints / requirements

- **Selector arm dispatch order: facet-targeting → per-component → synthetic.** The new `componentTargetsOf` check sits AFTER `facetTargetOf` (which already returns `null` for all seven structural sub-kinds, so the new arm only ever fires for the two it cares about) and BEFORE the synthetic-`'proposal'` fallback (which catches the other five structural sub-kinds plus the runtime safety-net `default` case). Mirrors the participant's three-arm dispatch verbatim (Decision §1).
- **Per-component entries use `facet: 'classification'`, NOT a new `LifecycleFacetName` arm.** Aligns the moderator chip's `data-facet-name` with the wire-level cell-map key the broadcast envelope writes. No new i18n key needed — `methodology.facet.classification` already exists. Mirrors the participant's Decision §2.
- **Per-component entries share the proposal-arm `votes` bucket.** Use `votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES` for every per-component entry — identical to today's synthetic-`'proposal'` arm at L292–295. Per-component vote-bucketing under `(component.node_id, 'classification')` is NOT a thing the methodology models for structural sub-kinds; the per-proposal vote-arm is the methodology's commit-gate signal. Per `mod_vote_indicators_in_sidebar`'s Decision §1, the structural-arm `votes` field is what the engine's `checkUnanimousAgreeStructural` walks.
- **Per-component entries default to `'proposed'` when the cell is absent.** The existing `resolveStatus(target, facetStatusIndex)` at [proposalFacets.ts:193–211](../../../apps/moderator/src/graph/proposalFacets.ts) already returns `'proposed'` on cell-miss; the per-component arm calls it once per component target. No new defaulting machinery.
- **Per-component entries preserve payload order.** `proposal.components.map(...)` / `proposal.readings.map(...)` preserves the wire-order. The chip strip renders entries in array order; the Vitest case (n)-equivalent pins this explicitly (one chip `'proposed'`, one `'committed'`, in payload order, NOT sorted by status).
- **The five non-componented structural sub-kinds (`axiom-mark`, `meta-move`, `break-edge`, `amend-node`, `annotate`) keep the synthetic `'proposal'` chip.** Their payloads have no components list and the methodology has no per-component status for them. The narrowed structural-synthetic Vitest group continues to assert the existing contract for those five.
- **React key change is single-line, scoped to the entry-list `.map(...)` callback.** Do NOT propagate `index` into any other key in the component; only the per-entry `<span>` key needs it.
- **Moderator React component's testid contract is unchanged.** Container still `proposal-facet-breakdown` + `data-proposal-id`; chips still `proposal-facet-row` + `data-facet-name` + `data-facet-status`. Cross-surface parity with the participant: same attribute names, same values per cell — only the chip COUNT changes for `decompose` / `interpretive-split`.
- **No change to `<ProposalFacetVoteIndicatorRow>` or the engine's commit-gate predicate.** Per-component chips render the same vote-indicator row as the synthetic chip does today (proposal-arm votes, same bucket). The commit-gate's `deriveAllAgree` predicate ([proposalFacets.ts:306+](../../../apps/moderator/src/graph/proposalFacets.ts)) walks the entries' `votes` field; since all per-component chips for one decompose row share one `votes` array, the predicate's behavior is identical to today's (one proposal-arm vote-bucket counts once per proposal).
- **Methodology-full-flow Phase 6 setup is unchanged.** The new sub-step appends an assertion inside the existing phase block — no extra fixture setup, no new participant joins, no extra propose-time WebSocket round-trip. The decompose is already broadcast at L1252–1259; the moderator page is already open (`alicePage` is the moderator console in Phase 6 per [docblock at L52–55](../../../tests/e2e/methodology-full-flow.spec.ts)).

## Acceptance criteria

**Vitest (per ADR 0022):**

- [ ] [`apps/moderator/src/graph/proposalFacets.test.ts`](../../../apps/moderator/src/graph/proposalFacets.test.ts) structural-synthetic group narrowed: `decompose` and `interpretive-split` removed from the existing test array at L150–231; any cases that were specifically structural-axiom-targeted (vs decompose-targeted) stay; new sibling group covers the per-component arm.
- [ ] Three new per-component cases (mirroring the participant's (m)/(n)/(o)):
  - [ ] `decompose` with 2 components, both cells absent from `facetStatusIndex` → returns 2 entries, each `facet: 'classification'`, each `status: 'proposed'`, each `labelKey: 'methodology.facet.classification'`.
  - [ ] `decompose` with 2 components, one cell carries `'committed'` in `facetStatusIndex.nodes` → returns 2 entries in payload order, statuses `['proposed', 'committed']` (NOT sorted), each `facet: 'classification'`.
  - [ ] `interpretive-split` with 3 readings → returns 3 entries, each `facet: 'classification'`, each `status` resolved against `facetStatusIndex.nodes.get(<reading.node_id>)`.
- [ ] When `proposalEventId` + `votesByProposalIndex` are threaded, per-component entries' `votes` field carries the proposal-arm bucket (same as today's synthetic-`'proposal'` arm). One new case pins this — 2-component decompose with a populated `votesByProposalIndex.get(proposalEventId)` returns 2 entries whose `votes` arrays are the SAME reference (or at least share identical contents in order).
- [ ] If [`apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx) exists, add a React-render case: 2-component decompose proposal renders two `proposal-facet-row` chips, both `data-facet-name="classification"`, both `data-facet-status="proposed"`, no React key-collision warnings in test output. (If the file does not yet exist, skip — the selector cover above is sufficient; the e2e pins the rendered DOM.)
- [ ] All existing moderator Vitest cases stay green — `pnpm -F @a-conversa/moderator test` clean.

**Playwright (per UI-stream e2e policy):**

- [ ] **Existing Phase 6 of [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) stays green.** All participant detail-panel assertions at L1265–1310 (the `data-facet-name="proposal"` row, the per-participant vote-agree loop, the commit-button enablement) unchanged.
- [ ] **New sub-step appended inside Phase 6 (around L1265, before the participant vote-agree loop runs):** after the moderator's decompose proposal broadcasts, query the moderator-side (`alicePage`) right-sidebar `<ProposalFacetBreakdown>` for the in-flight decompose row and assert:
  - `[data-testid="proposal-facet-breakdown"][data-proposal-id="<decompose-id>"] [data-testid="proposal-facet-row"]` count is exactly **2** (one per component).
  - Both rows match `[data-facet-name="classification"]`.
  - Both rows match `[data-facet-status="proposed"]`.
  - No `[data-facet-name="proposal"]` row exists inside that container (the synthetic chip must NOT render for the per-component arm).
- [ ] **Interpretive-split coverage is NOT required in this task** — Phase 6 does not currently drive an interpretive-split; the Vitest case (o)-equivalent covers the selector arm, and the e2e sub-step covers the 2-component decompose. If a future task adds a Phase 6b / Phase 7 interpretive-split scenario it can pin the chip-count there.
- [ ] Phase 6 wall-clock budget: the appended sub-step is a synchronous DOM-query against state the moderator page already has open — < 1s additional. Do not introduce a new `waitFor*` loop unless the chip-strip render is observed to lag the canvas state under the compose stack.

**Build + test gate** (per CLAUDE.md "always build and test before committing"):

- [ ] `pnpm -w build` clean.
- [ ] `pnpm -w lint` clean.
- [ ] `pnpm -w test` clean (Vitest across all packages).
- [ ] `pnpm -F @a-conversa/e2e test -- methodology-full-flow.spec.ts` clean (Playwright; the extended Phase 6 lands green under the compose stack — `make e2e` if the host stack needs a refresh).

**WBS:**

- [ ] `complete 100` added immediately after `allocate team` in [`tasks/30-moderator-ui.tji`](../../30-moderator-ui.tji) at the `mod_per_component_decompose_sidebar_breakdown` block (L351).
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` returns silent.
- [ ] Status block appended to this refinement on commit per the [task-completion ritual](../README.md#task-completion-ritual).

**Deferred:**

- [ ] (none) — every contract this refinement opens is closed within the 0.5d scope. The participant-side `componentTargetsOf` shipped under the predecessor; the moderator side closes the cross-surface gap. No outstanding follow-ups are spawned.

## Decisions

### D1 — Extend `derivePerProposalFacets` with a per-component arm rather than fork a new selector

**Chosen:** Add `componentTargetsOf(proposal)` alongside the existing `facetTargetOf(proposal)` in [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts). Dispatch becomes: `facetTargetOf` non-null → one-entry facet-targeting arm (unchanged); else if `componentTargetsOf` returns non-empty → N-entry per-component arm (new); else → one-entry synthetic `'proposal'` arm (unchanged for the five non-componented structural sub-kinds).

**Alternatives:**

- **Fork a new selector** (`derivePerComponentFacets`) and dispatch at the call site in `<ProposalFacetBreakdown>`. Rejected — would duplicate the `resolveStatus` + `votesByProposalIndex` + `labelKeyFor` plumbing; the chip-strip component would need a sub-kind branch to pick which selector to call. The single-selector-three-arm-dispatch keeps the consumer flat (`<ProposalFacetBreakdown>` continues to call one selector and iterate its output, unchanged).
- **Change the chip-strip component to handle per-component rendering directly** (skip the selector). Rejected — moves proposal-payload destructuring into the React component, defeats the pure-selector pattern `mod_per_facet_breakdown` established, complicates the Vitest cover (would need a React render for what is currently a pure-function selector unit test).
- **Diverge from the participant's dispatch shape** (e.g. emit per-component AND synthetic `'proposal'` chips together). Rejected — cross-surface parity matters: the participant pane emits per-component chips only (no synthetic chip for decompose/interpretive-split), and a moderator side that emits both would render a 3-chip strip the participant doesn't, confusing the cross-surface mental model. Per-component XOR synthetic is the right partition.

**Rationale:** Mirrors the participant's three-arm dispatch exactly. The moderator-side cross-surface parity is the explicit goal; matching the participant's selector shape minimizes the risk of subtle divergence (e.g. status defaulting, payload-order preservation). The `componentTargetsOf` helper is symmetric with the existing `facetTargetOf` — same partition shape, just N targets instead of zero-or-one.

### D2 — Per-component `facet: 'classification'`, same as the participant side

**Chosen:** Each per-component entry uses `facet: 'classification'` — the existing `FacetName` arm. Label key is `methodology.facet.classification`, already in the i18n catalog.

**Alternatives:**

- **Introduce a new `LifecycleFacetName` arm** like `'component'`. Rejected — same rationale as the participant's Decision §2: methodology doesn't model components as a distinct facet; a decompose component IS a node-with-classification, and the server's per-component proposal-status envelope keys on `classification`. Inventing a new facet name would create a moderator-side concept with no wire counterpart AND diverge from the participant side.
- **Use `facet: 'wording'`** (since each component also carries a wording). Rejected — the server's per-component proposal-status envelope keys on `classification`, not `wording`; the status lookup would silently mis-resolve.

**Rationale:** Aligns the moderator chip's `data-facet-name` with the wire-level cell-map key the broadcast envelope writes AND with the participant chip's `data-facet-name`. Cross-surface attribute parity makes cross-surface e2e assertions trivial — the same `[data-facet-name="classification"]` selector matches both surfaces for the same decompose envelope.

### D3 — Per-component entries share the proposal-arm `votes` bucket, NOT a per-component facet-arm vote bucket

**Chosen:** Each per-component entry's `votes` field reads `votesByProposalIndex.get(proposalEventId) ?? EMPTY_VOTES` — identical to today's synthetic-`'proposal'` arm at [proposalFacets.ts:292–295](../../../apps/moderator/src/graph/proposalFacets.ts). All per-component chips for one decompose row share one `votes` array (by reference).

**Alternatives:**

- **Look up per-component votes** under `votesByFacetIndex.get(component.node_id)?.get('classification') ?? EMPTY_VOTES`. Rejected — the methodology's `checkUnanimousAgreeStructural` keys on per-proposal votes for structural sub-kinds (per the engine's commit-handler, referenced in the existing synthetic-arm docblock at L278–290). Per-component facet-arm vote-buckets don't exist on the wire today; the lookup would return `EMPTY_VOTES` for every cell, making the per-component chips' vote-indicator rows silently empty even when the methodology has registered agree votes against the proposal arm.
- **Read votes from BOTH the facet-arm AND proposal-arm buckets and union them.** Rejected — adds a special-case union the predicate at L306+ (`deriveAllAgree`) would have to understand; today the predicate counts one vote-array per entry. The cross-entity-id-with-same-votes-by-reference pattern (Decision §3 as written) gives the predicate the same effective input it has today for structural sub-kinds, so the commit-gate behavior is unchanged.

**Rationale:** Preserves the wire-level vote semantics (proposal-arm votes for structural sub-kinds). Keeps the commit-gate predicate's behavior identical. Matches the participant's Decision §4 ("Per-component chips keep proposal-arm vote target, NOT per-component facet arm") on the moderator side — the moderator entry has no `voteTarget` field, but the same proposal-vs-facet-arm partition manifests through the `votes` field's source bucket.

### D4 — React key flips to composite `${facet}-${index}` (single-line change)

**Chosen:** In [`apps/moderator/src/layout/ProposalFacetBreakdown.tsx:168`](../../../apps/moderator/src/layout/ProposalFacetBreakdown.tsx), change `key={entry.facet}` to `key={`${entry.facet}-${entryIndex}`}` (binding the `entries.map(...)` callback signature to `(entry, entryIndex)`).

**Alternatives:**

- **Use a stable per-entry id derived from the component node UUID** (e.g. read `entry.entityId` if it were added to `ProposalFacetEntry`). Rejected — would extend the entry shape with a field only this rendering case needs, leaking the per-component node UUID into the chip's prop surface for no observable benefit. The index is sufficient because the entries list is rebuilt from a stable-ordered selector on every render — React doesn't need a stable cross-render identity for chips that don't unmount/remount; it only needs uniqueness within the entry list.
- **Use the entry's `labelKey`** as the key. Rejected — same problem as `entry.facet`: per-component entries all share `'methodology.facet.classification'`.
- **Add the entry's `status` to the key.** Rejected — would force React to remount the chip on every status flip (which has its own vote-indicator + Tailwind animation costs); status changes are common in a live session.

**Rationale:** Mirrors the participant fix exactly. Composite `facet-index` is the smallest-diff change that satisfies React's key-uniqueness rule without churning the chip's identity on status flips.

### D5 — E2E sub-step appends to `methodology-full-flow.spec.ts` Phase 6 rather than a new `moderator-pending-proposals.spec.ts` file or a new `test()` block

**Chosen:** Append the moderator-sidebar assertion inside Phase 6 of [`tests/e2e/methodology-full-flow.spec.ts`](../../../tests/e2e/methodology-full-flow.spec.ts) (around L1265), in the same `test()` block that already drives the real decompose end-to-end. The assertion reads from `alicePage` (the moderator console) and runs after the decompose proposal broadcasts but before the participant vote-agree loop kicks off.

**Alternatives:**

- **New top-level `tests/e2e/moderator-pending-proposals.spec.ts` modeled on the participant equivalent.** Rejected — the moderator has no equivalent "pending-proposals pane" e2e spec today, and standing up a fresh fixture (kate login, createSession, leo invite-acceptance, moderator console open) would cost ~15s of setup for a 1s assertion. Phase 6 of `methodology-full-flow` already drives the real decompose flow with both moderator and participant pages open — the assertion plugs in for free.
- **New sibling `tests/e2e/methodology-full-flow-decompose-sidebar.spec.ts`.** Rejected — fragments decompose coverage across two files; Phase 6 IS the decompose-coverage spec.
- **Add the assertion to the existing `moderator-capture.spec.ts`.** Rejected — that spec covers the moderator's capture-flow (single-statement proposals), not multi-component decompose; a decompose assertion would mismatch the spec's documented scope and require fresh setup of a 2-component proposal that no other case in the file needs.
- **Add a `mod_pw_*` follow-up task and defer the e2e there.** Rejected — the predecessor task `mod_pw_reconnect_seed_visible_styling` already shipped, and the existing `mod_pw_decompose_flow` (TJI L?) is a separate Playwright scope (it doesn't exist as a focused decompose-sidebar task; the closest analog is the broad `mod_pw_decompose_flow` placeholder at the moderator-pw catch-all). The moderator sidebar's per-component chip rendering IS reachable now (the route renders the sidebar; the decompose proposal flows through to the sidebar via the existing broadcast chain), so per the [UI-stream e2e policy](../README.md), full deferral to a `mod_pw_*` catch-all is the exception not the default — extend the existing Phase 6 inline.

**Rationale:** Phase 6 already pays the full setup cost for the decompose scenario; the new assertion is a 5-line sub-step inside the existing block. Lowest wall-clock cost; consistent with the existing spec's scope (multi-phase end-to-end methodology drive); avoids planning debt on the `mod_pw_*` catch-all line.

### D6 — Per-component chips identified in Playwright by row-relative DOM order, NOT by a per-component data-attribute

**Chosen:** The two per-component chips render with identical `data-facet-name="classification"` (Decision §2). The Playwright sub-step distinguishes them by counting `[data-testid="proposal-facet-row"]` within the `[data-testid="proposal-facet-breakdown"][data-proposal-id="..."]` container (count = 2) and asserting both chips' `data-facet-status="proposed"` via `.locator(...).nth(0)` and `.nth(1)`. Order matches payload order per the selector arm's preservation (Decision §1).

**Alternatives:**

- **Add a `data-entity-id` attribute to the chip** so the e2e can distinguish components by component node id. Rejected — same rationale as the participant's Decision §6: extends the chip's data-attribute contract for one case; the entity-id is implicit in payload order + the `data-proposal-id` scope; adding it would leak per-component node UUIDs into the DOM the methodology doesn't require the UI to expose.
- **Distinguish by classification label text.** Rejected — Phase 6 currently seeds both components as `'fact'` (per `decompose-component-classification-0-button-fact` + `decompose-component-classification-1-button-fact` at L1245+1249); the labels are identical. Switching to `fact` + `inference` would shift Phase 6's scope and add test setup for an axis the assertion doesn't need to pin.

**Rationale:** Matches the chip-strip's existing rendering contract (one chip per entry, in entry-list order); preserves the data-attribute surface; keeps the e2e assertion simple; mirrors the participant's Decision §6.

### D7 — Existing structural-synthetic Vitest cases retargeted onto `axiom-mark` rather than deleted

**Chosen:** When narrowing the structural-synthetic group at [`proposalFacets.test.ts:150–231`](../../../apps/moderator/src/graph/proposalFacets.test.ts) to exclude `decompose` + `interpretive-split`, any case whose specific assertion was scoped to the synthetic `'proposal'` chip (which is the entire L150–231 block today) is retargeted onto `axiom-mark` (which keeps the synthetic chip and has no per-component payload) rather than deleted outright. The decompose + interpretive-split cells in the existing array are replaced by per-component cases (the new (m)/(n)/(o)-equivalents).

**Alternatives:**

- **Delete the decompose + interpretive-split cells from the structural array entirely** without retargeting onto `axiom-mark`. Rejected — narrows the structural-synthetic coverage from "7 sub-kinds tested" to "5 sub-kinds tested" silently. Retargeting preserves the coverage shape and ensures the synthetic-chip path stays exercised by an explicit case in the new array.
- **Leave the decompose + interpretive-split cells in the structural array AND add the new per-component cases.** Rejected — the structural array's existing assertion is `expect(out[0]?.facet).toBe('proposal')` (single chip), which will FAIL after this task lands the per-component arm for decompose / interpretive-split. The cases must move.

**Rationale:** Preserves the synthetic-chip Vitest coverage shape; mirrors the participant's case (s) retarget from `decompose` to `axiom-mark` documented in the predecessor refinement's Status block. Keeps the test array's narrative intact ("here are the seven structural sub-kinds — five emit a synthetic chip, two fan out per-component").

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-29.

- `apps/moderator/src/graph/proposalFacets.ts` — added `componentTargetsOf` helper + per-component dispatch arm inserted between `facetTargetOf` and synthetic-`'proposal'` fallback in `derivePerProposalFacets`.
- `apps/moderator/src/layout/ProposalFacetBreakdown.tsx` — flipped React key from `entry.facet` to composite `${entry.facet}-${entryIndex}` to avoid reconciliation collisions when multiple chips share `facet: 'classification'`.
- `apps/moderator/src/graph/proposalFacets.test.ts` — narrowed structural-synthetic group (removed `decompose` + `interpretive-split`), retargeted displaced case onto `axiom-mark`, added per-component describe block with (m)/(n)/(o) cases + shared-`votes`-bucket pin.
- `apps/moderator/src/layout/ProposalFacetBreakdown.test.tsx` — replaced decompose-renders-synthetic-`'proposal'`-chip case with 2-component decompose-renders-2-`'classification'`-chips case.
- `tests/e2e/methodology-full-flow.spec.ts` — appended moderator-sidebar sub-step at start of Phase 6.2 asserting 2 `[data-facet-name="classification"][data-facet-status="proposed"]` chips + zero `[data-facet-name="proposal"]` chip in the in-flight decompose row's breakdown.
