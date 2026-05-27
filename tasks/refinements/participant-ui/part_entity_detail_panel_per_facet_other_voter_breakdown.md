# Per-facet per-other-voter breakdown in the participant entity detail panel

**TaskJuggler entry**: [tasks/40-participant-ui.tji](../../40-participant-ui.tji) — task `participant_ui.part_graph_view.part_entity_detail_panel_per_facet_other_voter_breakdown`
**Effort estimate**: 0.5d
**Inherited dependencies**:

- `!participant_ui.part_graph_view.part_entity_detail_panel` (settled — commit `728f8d1`, 2026-05-17. Shipped the read-only right-sidebar `<EntityDetailPanel>` at [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L1). Section 8 — the other-voters table — landed at [`EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709) as a **per-entity per-voter rollup table**: one `<li data-testid="participant-detail-panel-other-vote-row" data-voter-id={participantId} data-vote-arm={choice}>` per voter, surfacing the resolved screen name + the per-entity dispute-wins rollup arm (`'agree'` / `'dispute'`). The per-entity rollup was deliberately the v0 polish-deferred surface per that refinement's Decision §11 ("ship the per-entity per-voter table (Section 8 of the panel) as the v0 'other voters' surface; defer the per-facet per-voter breakdown to a follow-up task"). The same Status block registered THIS leaf in the orchestrator's debt registry as the discharge path: "per-facet per-other-voter breakdown, ~0.5d." The `.tji` `note` block on this leaf names both candidate paths explicitly: "Needs `OthersVoteIndex` widened with a per-facet per-voter dictionary OR a per-facet re-walk inside the panel for the selected entity. Either path is a sub-day move."
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_other_vote_indicators` (settled — established `projectOtherVotes` + `OthersVoteIndex` + `OtherVote` at [`apps/participant/src/graph/otherVotes.ts:86-129`](../../../apps/participant/src/graph/otherVotes.ts#L86). The projection's per-entity per-voter list carries the **dispute-wins rollup arm only**; the per-facet detail is intentionally retained INSIDE the projector's accumulator (`perFacetVoterArm` Map at [`otherVotes.ts:254`](../../../apps/participant/src/graph/otherVotes.ts#L254)) but does NOT escape to the index — per Decision §1 of that leaf ("per-entity LIST shape rather than a rolled-up sentinel … the per-facet granularity stays inside the projector's accumulator; only the per-entity per-voter projection escapes"). The same module-header drift-risk note ([`otherVotes.ts:55-67`](../../../apps/participant/src/graph/otherVotes.ts#L55)) names the `voteTargetOf` walk shape this leaf's helper mirrors verbatim — four locations co-shaped today (`otherVotes.ts:146-164`, `ownVotes.ts:108-126`, `facetStatus.ts:132-164`, `apps/moderator/src/graph/selectors.ts:736-754`).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_own_vote_indicators` (settled — established the per-facet own-vote re-derivation pattern this leaf's helper mirrors. `EntityDetailPanel.tsx:111-172` already carries `deriveOwnFacetVotes(events, currentParticipantId, entityId): Partial<Record<FacetName, OwnFacetVote>>` — a single-pass walk over `events`, scoped to a single `entityId`, mirroring `projectOwnFacetVotes`'s proposal-target + latest-vote-per-(proposal, participant) discipline but retaining the per-facet detail. The inline-vs-projection split was deliberate per the predecessor refinement's Decision §11: "Inline in the panel (rather than promoted to `apps/participant/src/graph/`) because the per-facet detail is a panel-only consumer at v0; if a future leaf (a per-facet vote button row, perhaps) needs the same shape, the walk lifts cleanly. Following the prior leaves' YAGNI extraction posture — 'promote on the third caller'." THIS leaf adopts the same posture: a sibling `deriveOtherFacetVotesByVoter` helper that walks the same events with the inverse participant filter, returning per-voter per-facet detail).
- Prose-only context (NOT a `.tji` edge): `!participant_ui.part_graph_view.part_entity_detail_panel_chromatic_axiom_mark_badge` (settled — commit `a446c82`, 2026-05-27, the sibling v0 polish leaf registered alongside this task. Established the per-facet-data-flow-preserved + per-section-rewrite pattern this leaf adopts: same `actionSlot` reservation untouched, same per-section testid family preserved, same `<OtherVotersSection>` outer shape preserved with only the row body widening, same failing-first verification posture).
- Prose-only context (NOT a `.tji` edge): ADR 0030 `pf_part_facet_name_widen_shape` (settled — local `FacetName` mirror at [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts#L1) is 4-valued: `'classification' | 'substance' | 'wording' | 'shape'`. The per-facet other-voter walk MUST consume the 4-valued FacetName so shape-facet votes by other voters surface in the panel's per-facet row alongside the other three — same posture `deriveOwnFacetVotes` already adopts at [`EntityDetailPanel.tsx:155-160`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L155)).

## What this task is

Extend the participant detail panel's **Section 8 (Other voters)** so each voter's row carries a **per-facet breakdown** in addition to the existing per-entity rollup arm. Today the panel renders one `<li>` per voter showing the rolled-up arm ("alice — agree"); after this leaf, the same row surfaces the per-facet detail below the rollup arm ("alice — agree; classification: agree, wording: agree"). Reads from a new participant-workspace-local `deriveOtherFacetVotesByVoter(events, currentParticipantId, entityId)` helper that walks the events log once and returns per-voter per-facet maps — the inverse-filter sibling of the existing `deriveOwnFacetVotes` at [`EntityDetailPanel.tsx:111-172`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L111).

Before this leaf: the panel renders Section 8 as

```jsx
<section data-testid="participant-detail-panel-other-voters">
  <h3>Other participants</h3>
  <ul>
    <li data-testid="participant-detail-panel-other-vote-row"
        data-voter-id={ALICE_ID}
        data-vote-arm="agree">
      <span>alice</span>
      <span>Agree</span>
    </li>
    <li data-testid="participant-detail-panel-other-vote-row"
        data-voter-id={BEN_ID}
        data-vote-arm="dispute">
      <span>ben</span>
      <span>Dispute</span>
    </li>
  </ul>
</section>
```

([`apps/participant/src/detail/EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709)).

After this leaf: the same `<li>` becomes a stacked block carrying the rollup line at the top + a per-facet row block underneath:

```jsx
<li data-testid="participant-detail-panel-other-vote-row"
    data-voter-id={ALICE_ID}
    data-vote-arm="agree"
    className="flex flex-col gap-1 text-sm">
  <div className="flex items-center justify-between">
    <span className="text-slate-600">alice</span>
    <span className="text-slate-900">Agree</span>
  </div>
  <ul data-testid="participant-detail-panel-other-vote-facet-list"
      className="ml-3 space-y-0.5 text-xs">
    <li data-testid="participant-detail-panel-other-vote-facet-row"
        data-facet="classification"
        data-vote-arm="agree"
        className="flex items-center justify-between">
      <span className="text-slate-500">Classification</span>
      <span className="text-slate-700">Agree</span>
    </li>
    <li data-testid="participant-detail-panel-other-vote-facet-row"
        data-facet="wording"
        data-vote-arm="agree"
        className="flex items-center justify-between">
      <span className="text-slate-500">Wording</span>
      <span className="text-slate-700">Agree</span>
    </li>
    {/* …one row per facet this voter has touched on this entity… */}
  </ul>
</li>
```

The outer `<li data-testid="participant-detail-panel-other-vote-row">` is preserved verbatim with its `data-voter-id` + `data-vote-arm` attributes — the existing Vitest case `(m)` ([`EntityDetailPanel.test.tsx:660-696`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L660)) keeps targeting it without change. The per-facet rows are NEW children; the existing assertion `expect(rows[0]?.textContent).toContain('alice')` still passes because the screen name is still in the row's subtree. The `(n)` empty-section omission case ([`EntityDetailPanel.test.tsx:698-705`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L698)) is unchanged — when `votes.length === 0` the entire section still suppresses.

Concretely the deliverable is:

- A new top-level helper `deriveOtherFacetVotesByVoter(events, currentParticipantId, entityId): ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>` inside [`apps/participant/src/detail/EntityDetailPanel.tsx`](../../../apps/participant/src/detail/EntityDetailPanel.tsx) — alongside the existing `deriveOwnFacetVotes` (Decision §1). Single-pass walk over `events`: collect facet-targeting proposal targets scoped to `entityId`; for each `vote` event by a voter OTHER than `currentParticipantId` referencing one of those proposals (proposal-keyed arm) OR carrying `target === 'facet'` with `entity_id === entityId` (facet-keyed arm per ADR 0030 §2), record the latest arm at `(voterId, facet)` with last-write-wins semantics. Returns a `Map<voterId, Partial<Record<FacetName, 'agree' | 'dispute'>>>` — voters absent from the map have no per-facet entries (matched by the same iteration order the per-entity list uses; voters who appear in the `votes` prop but not in the per-facet map render with no per-facet sub-rows, which is the gap-close shape per Decision §3).
- A modified `OtherVotersSection` ([`EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709)) — widens its prop signature by one field (`perVoterFacets: ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>`) and renders the per-facet sub-row block for each voter using the same `facetLabel` + `voteArmLabel` resolvers the existing `<OwnVoteSection>` already receives (Decision §4 — reuse the per-section translator props rather than re-passing the `t` instance into the helper).
- A modified `EntityDetailPanelImpl` ([`EntityDetailPanel.tsx:262-426`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L262)) — adds a `useMemo` over `deriveOtherFacetVotesByVoter(events, currentParticipantId, entity.id)` adjacent to the existing `roster` memo (line 289) AND threads the result into `<OtherVotersSection>`. Mirrors the existing `perFacet` memo at line 675 within `<OwnVoteSection>` — same memoization rationale (once per `(events, entityId)` change).
- A modified `apps/participant/src/detail/EntityDetailPanel.test.tsx` — case `(m)` extended with two supplementary cases:
  - `(m.1)` — pin the per-facet sub-rows render. Seed two voters (alice + ben) with distinct per-facet votes on `NODE_A_ID` (alice: classification=agree, wording=agree; ben: classification=dispute, substance=dispute). Assert (i) two outer `participant-detail-panel-other-vote-row` rows; (ii) within each row, a `participant-detail-panel-other-vote-facet-list`; (iii) within alice's row, two `participant-detail-panel-other-vote-facet-row` children with `data-facet` matching `classification` and `wording` and `data-vote-arm="agree"`; (iv) within ben's row, two `participant-detail-panel-other-vote-facet-row` children with `data-facet` matching `classification` and `substance` and `data-vote-arm="dispute"`. The existing `(m)` case continues to pass — its assertions (per-voter row count + voter ids + screen names) are unaffected.
  - `(m.2)` — pin the gap-close shape. Seed one voter who appears in the per-entity rollup list (because they have a vote on some facet that contributed to the rollup) BUT whose per-facet detail map is empty after a vote arrival sequence that left the rollup intact (the projector's accumulator vs the inline walk diverge by one tick — see Decision §3). The per-voter `<li>` still renders with the rollup arm at the top + an EMPTY per-facet sub-list (the `<ul>` carries zero `<li>` children). Pins the gap-close shape: no per-facet sub-rows → empty list, NOT suppressed list.
- A modified `tests/e2e/participant-graph-render.spec.ts` block 10 ([line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553) — `henry + grace`, block-4 role-swap) — extends the existing seed pattern with a third seeded sequence: a second voter (a `participant-joined` for a third user, NOT one of the pool's already-seeded users — the `freshContext` discipline lets the block seed an arbitrary `participant-joined` event without needing a Playwright session for that user) + a per-facet vote arrival from that voter on `NODE_A`'s classification facet. The block's existing tap on `NODE_A` then asserts (i) the per-voter row testid resolves; (ii) the per-facet sub-list testid resolves AS A CHILD of the same row; (iii) at least one per-facet sub-row carries the expected `data-facet` + `data-vote-arm`. The block-10 inheritance posture matches the chromatic-badge sibling refinement's extension precedent — block 10 is the panel-rendering block.

### Scope bounded by 0.5d budget

Per the orchestrator brief: 0.5d is a polish leaf. Scope cut-offs explicitly registered as Decisions, NOT silently dropped:

- **In scope (ships in this leaf)**: inline `deriveOtherFacetVotesByVoter` helper (Decision §1); per-voter row body widening (Decision §2); 2 supplementary Vitest cases (`(m.1)`, `(m.2)`); 1 extended Playwright block-10 sequence.
- **Out of scope (deferred to dedicated leaves)**:
  - **Widening `OthersVoteIndex` with a per-facet per-voter dictionary** — Decision §1 chose the inline-walk path over the projection-widening path; the projection stays at its per-entity per-voter rollup shape. If a future surface (e.g. an audience-side detail panel, or a per-facet-per-voter heatmap) needs the same per-facet detail, lifting `deriveOtherFacetVotesByVoter` from the panel into `apps/participant/src/graph/otherVotes.ts` (or into `@a-conversa/shell` once the audience surface becomes the third caller) is a mechanical 30-line move — the function signature is already shaped for it. Named-future-task: **none today** (the lift is contingent on a third-caller materializing; no leaf in the WBS today needs the same shape).
  - **Per-facet hover popover / per-facet vote-timeline tooltip** — the per-facet row carries `data-facet` + `data-vote-arm` only; a richer per-facet hover ("alice voted agree on classification at 2026-05-15 14:30, then switched to dispute at 14:35") is out of scope. Future polish leaf if real usage shows the bare arm insufficient. The methodology surface doesn't require a vote-timeline read today.
  - **Per-facet chromatic identity badges on other-voter rows** — the sibling `part_entity_detail_panel_chromatic_axiom_mark_badge` leaf paid down the chromatic surface for axiom-marks ONLY (per that leaf's Decision §6 out-of-scope: "the chromatic palette is methodology-load-bearing for axiom-marks … it is NOT methodology-load-bearing for annotation authorship or vote casting"). This leaf inherits that policy verbatim — other-voter rows surface screen names as plain text; no chromatic badge.
  - **Per-voter row animation on per-facet expansion** — the per-facet sub-rows render as part of the panel mount (always-on, not collapsible); no expand/collapse affordance. Decision §2 picked the always-on surface for the same reasons the predecessor refinement's Decision §10 picked the empty-state body over a slide-in animation: layout stability + discoverability.

## Why it needs to be done

The methodology layer treats agreement as **per-facet, not per-entity** (`docs/methodology.md` §"Agreement is per-facet and per-participant"). The participant's detail panel already surfaces per-facet detail for the debater's OWN vote (Section 7, via `deriveOwnFacetVotes`); but Section 8 — the other-voters table — collapses each voter's per-facet votes to a single dispute-wins rollup arm. A debater scanning Section 8 can read "alice disputes this entity" but cannot answer "WHICH facet does alice dispute?" — a load-bearing methodological question that drives the debater's next vote / amend / withdraw gesture (the same question Section 7 already answers for the debater's own vote).

Without the per-facet breakdown on Section 8:

- A debater whose OWN vote on the entity is "agree on classification, dispute on wording" cannot determine whether their dispute aligns with the other voters' disputes WITHOUT context-switching to a separate surface (the pending-proposals pane carries per-proposal votes; the entity-detail panel is the per-entity drill-down). The methodology assumes per-facet alignment is readable in the same surface; the v0 detail panel partially satisfies that (Section 7) but stops short for the cross-participant comparison (Section 8).
- The structural diagnostics surface (Section 6) flags cross-facet inconsistencies (e.g. "shape mismatch", "redundant edge") that the debater needs to read alongside the per-voter per-facet votes — without the per-facet detail on Section 8, the debater cannot connect a diagnostic flag to a specific voter's per-facet disposition.
- The `part_voting.*` future leaves (per-facet vote buttons, per-facet amend gestures) will need the per-voter per-facet detail as their natural read-context — the "alice disputes wording; should I amend wording to bridge?" question.

Architecturally, the data flow is already in place: every per-facet vote event is in the `events` slice, and the same projector's accumulator (`perFacetVoterArm` at [`otherVotes.ts:254`](../../../apps/participant/src/graph/otherVotes.ts#L254)) ALREADY retains the per-facet detail — it just doesn't escape to the index. The predecessor refinement's Decision §11 named two paths to surface it (widen the projection vs inline re-walk), both ~0.5d, neither fitting the 1d budget for the parent leaf. This leaf picks the inline re-walk per Decision §1 (mirroring the `deriveOwnFacetVotes` precedent) — same posture, same ~30-line cost, same YAGNI extraction stance.

Downstream concretely:

- **`part_voting.part_vote_button_per_facet`** (future leaf, currently a named placeholder in the WBS) attaches per-facet vote buttons to the panel's per-facet pill row. The per-facet other-voter detail from THIS leaf gives the buttons the cross-participant read-context they need to drive the debater's per-facet decision.
- **`audience.aud_entity_detail_panel`** (future, sibling to `aud_graph_render` once it lands) inherits the same per-voter per-facet shape if it gets a detail-panel equivalent. At that point the inline `deriveOtherFacetVotesByVoter` lifts cleanly into `@a-conversa/shell` alongside the analogous `deriveOwnFacetVotes` (the third-caller extraction trigger that the prior leaves' YAGNI stance reserves).

## Inputs / context

### ADRs

- [ADR 0003 — Frontend framework: React](../../../docs/adr/0003-frontend-framework-react.md) — `<OtherVotersSection>` is a React function component receiving the per-facet map as a prop; same pattern as every other panel sub-section.
- [ADR 0005 — Styling: Tailwind](../../../docs/adr/0005-styling-tailwind-css.md) — the per-facet sub-rows use Tailwind class triples matching the existing `<OwnVoteSection>` row style (`text-xs`, `text-slate-500` / `text-slate-700`, `flex items-center justify-between`); no new palette, no shell-extraction.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — every behaviour pinned by a committed Vitest case + extended Playwright assertion. Failing-first verification per the predecessor leaves' pattern; see Acceptance criteria.
- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the per-facet label uses the existing `methodology.facet.<name>` keys (already populated in en-US / pt-BR / es-419); the per-facet vote-arm label uses the existing `methodology.voteChoice.<arm>` keys. **No new i18n keys this leaf** — all the strings already exist and are consumed by `<OwnVoteSection>` verbatim.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the participant workspace owns its rendered surface; the helper lives inline in `EntityDetailPanel.tsx` per the predecessor refinement's "promote on the third caller" YAGNI stance.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — the per-voter row's outer wrapper carries the entity-layer rollup (`data-vote-arm` on the row); the per-facet sub-rows carry the facet-layer detail (`data-facet` + `data-vote-arm` on each child). The two layers stay strictly separated within the same row tree; consumers can target either via DOM testid.
- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) §2 (the `target`-discriminated `vote` payload union) + §3 (the wire-level `'agree' | 'dispute'` arm enum + `withdraw-agreement` as a first-class event kind). The helper consumes both `target === 'facet'` and `target === 'proposal'` arms, mirroring the existing `deriveOwnFacetVotes` walk shape verbatim.

No new ADR needed. Every decision below applies an existing ADR or mirrors a settled moderator-side / participant-side precedent.

### Sibling refinements

- [`tasks/refinements/participant-ui/part_entity_detail_panel.md`](part_entity_detail_panel.md) — **the source of this leaf's deferral.** Decision §11 settled the v0 per-entity rollup surface vs the future per-facet drill-down split: "ship the per-entity per-voter table (Section 8 of the panel) as the v0 'other voters' surface; defer the per-facet per-voter breakdown to a follow-up task." That split holds in this leaf: the per-entity rollup row stays unchanged; only a new per-facet child block lands underneath each row.
- [`tasks/refinements/participant-ui/part_entity_detail_panel_chromatic_axiom_mark_badge.md`](part_entity_detail_panel_chromatic_axiom_mark_badge.md) — the precedent v0-polish sibling leaf landed alongside this task. Mirrors the per-section-rewrite-with-preserved-data-flow posture: section testids preserved, prop signatures widened by a single field, supplementary Vitest cases added, block-10 Playwright extension. Same scope-bounding approach.
- [`tasks/refinements/participant-ui/part_other_vote_indicators.md`](part_other_vote_indicators.md) — established the per-entity per-voter list shape + the per-facet-accumulator-retained-internally posture. Decision §1 ("the per-facet granularity stays inside the projector's accumulator; only the per-entity per-voter projection escapes") settled WHY the projection doesn't carry per-facet detail today. THIS leaf doesn't change the projection's escape shape — it does a parallel inline walk over the SAME events to recover the per-facet detail at the panel layer.
- [`tasks/refinements/participant-ui/part_own_vote_indicators.md`](part_own_vote_indicators.md) — established the per-facet own-vote re-derivation pattern via `deriveOwnFacetVotes`. THIS leaf's helper is the inverse-filter sibling.

### Live code the leaf plugs into

- [`apps/participant/src/detail/EntityDetailPanel.tsx:111-172`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L111) — `deriveOwnFacetVotes` precedent. THIS leaf's new helper `deriveOtherFacetVotesByVoter` lands adjacent in the same module, sharing the proposal-target walk + the facet-keyed-arm-vs-proposal-keyed-arm discrimination + the local `FacetName` widening to the 4-valued enum per ADR 0030 + `pf_part_facet_name_widen_shape`.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:397-406`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L397) — the `<OtherVotersSection>` call site within `EntityDetailPanelImpl`. The new memo over `deriveOtherFacetVotesByVoter` lands above this call site; the prop thread `perVoterFacets={...}` widens the call by one field.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709) — `<OtherVotersSection>` itself. The body rewrites per the deliverable sketch: outer `<li>` carries the rollup arm at the top (existing flex row), per-facet `<ul>` sub-list underneath. Prop signature widens by `perVoterFacets` + `facetLabel: (facet: FacetName) => string`.
- [`apps/participant/src/detail/EntityDetailPanel.tsx:387-396`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L387) — `<OwnVoteSection>` call site. Reference for the `facetLabel={(facet) => t(`methodology.facet.${facet}`)}` translator pattern this leaf's `<OtherVotersSection>` adopts verbatim.
- [`apps/participant/src/graph/otherVotes.ts:69-90`](../../../apps/participant/src/graph/otherVotes.ts#L69) — `OtherVote` interface (read-only reference). The projection's escape shape stays unchanged.
- [`apps/participant/src/graph/facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts) — `FacetName` (4-valued enum). The helper's per-facet map keys are `FacetName`.
- [`packages/shared-types/src/events/`](../../../packages/shared-types/src/events) — `Event` + `ProposalPayload` + `VotePayload` discriminated unions. The helper consumes the SAME wire shapes the `deriveOwnFacetVotes` precedent consumes.
- [`apps/participant/src/detail/EntityDetailPanel.test.tsx:660-705`](../../../apps/participant/src/detail/EntityDetailPanel.test.tsx#L660) — existing `(m)` and `(n)` cases. The `(m)` case continues to pass after this leaf; `(m.1)` and `(m.2)` are new supplementary cases that extend its coverage.
- [`tests/e2e/participant-graph-render.spec.ts:2553`](../../../tests/e2e/participant-graph-render.spec.ts#L2553) — block 10 (henry + grace). The seed body is extended with a third `participant-joined` + a per-facet vote arrival; the assertions block is extended with the per-facet sub-row testid + `data-facet` + `data-vote-arm` matchers.
- [`packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json) — `methodology.facet.classification` / `.substance` / `.wording` / `.shape` and `methodology.voteChoice.agree` / `.dispute` already populated; reused verbatim. **No new catalog entries this leaf.**

### What the surface MUST NOT do

- **No widening of `OthersVoteIndex` or `projectOtherVotes`.** The projection stays at its per-entity per-voter rollup shape. Decision §1 explicitly picks the inline-walk path over the projection-widening path.
- **No new entry on `apps/participant/src/graph/otherVotes.ts`.** All new logic lives inside `EntityDetailPanel.tsx`, mirroring the inline `deriveOwnFacetVotes` placement.
- **No new i18n keys.** The catalog entries for facet labels + vote-arm labels are already populated; consumed verbatim.
- **No reshape of the existing `(m)` / `(n)` Vitest cases.** The case `(m)` continues to pass after this leaf; the new behaviour is pinned by NEW supplementary cases.
- **No reshape of the outer `<li data-testid="participant-detail-panel-other-vote-row">` shape.** The `data-voter-id` + `data-vote-arm` attributes + the row's screen name + rollup arm rendering stay verbatim; the per-facet sub-list is a NEW child block underneath the existing flex row.
- **No tap / hover / click affordance on the per-facet sub-rows.** The rows are read-only `<li>` elements; the future `part_voting.*` family attaches per-facet vote buttons in a separate row block (the always-on `<ParticipantVoteButtons>` already at [`EntityDetailPanel.tsx:414-420`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L414) per `pf_part_detail_panel_three_facet_rows`).
- **No animation / transition on the per-facet sub-row mount.** Always-on; static render per Decision §2.
- **No coupling to the rollup arm.** A voter whose rollup is `'agree'` may still have a `'dispute'` per-facet entry (e.g. classification=agree, substance=agree, but wording=dispute would roll up to dispute under dispute-wins, NOT agree — but a voter with rollup=agree means ALL their facet arms are agree; the per-facet rows reflect that). The per-facet rows reflect the raw walk output; consistency with the rollup is a property of the projector, NOT a constraint the panel enforces.
- **No mutation of `events` or any other store slice.** The helper is a pure function.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/participant/src/detail/EntityDetailPanel.tsx` — modified. Three edits:
  1. Add the top-level helper:
     ```typescript
     function deriveOtherFacetVotesByVoter(
       events: readonly Event[],
       currentParticipantId: string,
       entityId: string,
     ): ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>> {
       // Mirrors `deriveOwnFacetVotes` walk shape verbatim (proposal-
       // target resolution, latest-vote-per-(proposal, participant), the
       // `target === 'facet' | 'proposal'` arm discrimination per ADR
       // 0030 §2) but with the inverse participant filter: votes by
       // `currentParticipantId` are silently dropped, all others are
       // accumulated per-(voterId, facet) with last-write-wins.
       // Returns a `Map<voterId, Partial<Record<FacetName, 'agree' |
       // 'dispute'>>>`; voters with no recordable facet votes against
       // this entity are absent from the map. The local `FacetName`
       // mirror is 4-valued per ADR 0030 + `pf_part_facet_name_widen_shape`;
       // shape-facet votes flow through this walk like the other three.
     }
     ```
     Adjacent to `deriveOwnFacetVotes` (line 111-172). ~50 lines including the proposal-target dance + the per-voter accumulator Map + the final freeze-and-return.
  2. Inside `EntityDetailPanelImpl`, add a `useMemo` over the helper above the `roster` memo line ([`EntityDetailPanel.tsx:289`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L289)):
     ```typescript
     const perVoterFacets = useMemo(
       () =>
         entity === null
           ? new Map<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>()
           : deriveOtherFacetVotesByVoter(events, currentParticipantId, entity.id),
       [events, currentParticipantId, entity],
     );
     ```
     Threaded into `<OtherVotersSection>` at the existing call site (line 397):
     ```typescript
     <OtherVotersSection
       votes={...}
       roster={roster}
       perVoterFacets={perVoterFacets}
       sectionHeading={t('participant.detailPanel.sectionTitle.otherVotes')}
       voteArmLabel={(arm) => t(`methodology.voteChoice.${arm}`)}
       facetLabel={(facet) => t(`methodology.facet.${facet}`)}
     />
     ```
  3. Rewrite `<OtherVotersSection>` body ([`EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709)). New prop signature:
     ```typescript
     function OtherVotersSection(props: {
       votes: ReadonlyArray<{ readonly participantId: string; readonly choice: 'agree' | 'dispute' }>;
       roster: ReadonlyMap<string, string>;
       perVoterFacets: ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>;
       sectionHeading: string;
       voteArmLabel: (arm: 'agree' | 'dispute') => string;
       facetLabel: (facet: FacetName) => string;
     }): ReactElement | null
     ```
     Body: existing flex row becomes the TOP child of the outer `<li>`; new `<ul data-testid="participant-detail-panel-other-vote-facet-list">` containing zero-or-more `<li data-testid="participant-detail-panel-other-vote-facet-row" data-facet={...} data-vote-arm={...}>` rows underneath, one per facet entry in `perVoterFacets.get(vote.participantId) ?? {}` (Decision §3 — voters absent from the map render the empty `<ul>`, NOT a suppressed sub-list). The per-facet iteration order follows `FacetName` declaration order from `facetStatus.ts` (consistent across voters; Decision §5).
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` — modified. Two new supplementary cases `(m.1)` and `(m.2)` added inside the existing `describe('EntityDetailPanel — section visibility', ...)` block (next to the existing `(m)` and `(n)` cases at lines 660-705). The renderPanel + `useSelectionStore` + seeded events fixture pattern is reused verbatim from the existing `(m)` case; the only new seed is the per-facet `vote` events (the `(m)` case seeds the per-entity rollup but not the per-facet detail — extending the seed array with two `proposal` + two `vote` events per voter, one per facet, is the only fixture-shape change).
- `tests/e2e/participant-graph-render.spec.ts` — modified. Block 10 (henry + grace, [line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553)) extended per the deliverable sketch: seed a `participant-joined` for a third user (an `IVAN_USER_ID` synthesised inline; not a pool user — Decision §6 explains the no-Playwright-session-needed pattern) AND a `classify-node` proposal AND a `vote` event from `IVAN_USER_ID` against the proposal with `choice: 'agree'`; after the tap on `NODE_A`, assert the per-voter row testid AND the per-facet sub-list testid AND at least one per-facet sub-row with `data-facet="classification"` + `data-vote-arm="agree"`. The block's role-swap-pair (henry + grace), the `freshContext` discipline, and the per-block-isolated session id all stay verbatim. Wall-clock cost: ~1s for the added seed + assertions.

### Files this task does NOT touch

- `apps/participant/src/graph/otherVotes.ts` — unchanged. The projection's per-entity per-voter rollup shape stays; the per-facet detail is recovered via an inline panel-level walk (Decision §1).
- `apps/participant/src/graph/ownVotes.ts`, `axiomMarks.ts`, `annotations.ts`, `diagnosticHighlights.ts`, `facetStatus.ts`, `projectGraph.ts` — unchanged.
- `apps/participant/src/graph/GraphView.tsx`, `apps/participant/src/routes/OperateRoute.tsx` — unchanged. The detail panel's data flow + the projection hoist stay verbatim.
- `apps/participant/src/detail/participantRoster.ts`, `lookupEntity.ts`, `AxiomMarkBadge.tsx`, `ParticipantVoteButtons.tsx`, `index.ts` — unchanged.
- `packages/shell/`, `packages/shared-types/` — unchanged. No new substrate, no new types.
- `apps/moderator/`, `apps/audience/`, `apps/server/`, `apps/root/` — unchanged.
- `packages/i18n-catalogs/` — unchanged. All consumed keys already populated.
- `docs/adr/` — no new ADR.
- `.tji` files — `complete 100` on `part_entity_detail_panel_per_facet_other_voter_breakdown` lands at task-completion time per the [tasks/refinements/README.md](../README.md#L32-L42) ritual. The Closer also checks whether the `part_graph_view` parent grouping can now propagate `complete 100` — this leaf was the second of the two sibling polish leaves registered by `part_entity_detail_panel`'s Status block; with the chromatic-axiom-mark-badge sibling already at `complete 100` (commit `a446c82`), this leaf's completion is the parent grouping's final pre-requisite.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs — no throwaway probes.

- `apps/participant/src/detail/EntityDetailPanel.tsx` exposes the new `deriveOtherFacetVotesByVoter` helper adjacent to `deriveOwnFacetVotes`. Pure function; consumes `(events, currentParticipantId, entityId)`; returns `ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>` with voters scoped to "OTHER" (current participant filtered out) and entity scoped to the passed `entityId`.
- `<OtherVotersSection>` ([`EntityDetailPanel.tsx:709-739`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L709)) renders the per-voter outer row + a per-facet sub-list (`participant-detail-panel-other-vote-facet-list`) + per-facet sub-rows (`participant-detail-panel-other-vote-facet-row` with `data-facet` + `data-vote-arm` attributes). Existing testid family (`participant-detail-panel-other-vote-row`, `data-voter-id`, `data-vote-arm`) preserved.
- `apps/participant/src/detail/EntityDetailPanel.test.tsx` carries the new `(m.1)` case (per-voter per-facet rows render correctly for two voters with distinct facet patterns) AND the new `(m.2)` case (a voter present in the per-entity rollup with no per-facet detail renders an empty per-facet `<ul>` — gap-close shape). The existing `(m)` case continues to pass without modification; the existing `(n)` empty-section case continues to pass.
- `tests/e2e/participant-graph-render.spec.ts` block 10 (henry + grace, [line 2553](../../../tests/e2e/participant-graph-render.spec.ts#L2553)) is extended with the third-voter `participant-joined` + classify-node proposal + vote seed events, plus the per-facet sub-row assertions after the tap on `NODE_A`. Wall-clock cost: ~1s under parallel workers.
- **Failing-first verification per ADR 0022**: short-circuiting `<OtherVotersSection>` to render no per-facet sub-list (just the existing flex row, as today) flips both new Vitest cases (`(m.1)` and `(m.2)`) red AND the new Playwright per-facet sub-row assertions red, while the existing `(m)` and `(n)` cases stay green. Separately, short-circuiting `deriveOtherFacetVotesByVoter` to always return `new Map()` flips the same cases red. Document both verifications in the Status block.
- `pnpm run check` clean (lint + format + typecheck + tools + tests across all workspaces).
- `pnpm run test:smoke` green; Vitest count rises by +2 (`(m.1)` and `(m.2)`).
- `pnpm -F @a-conversa/participant build` succeeds. Bundle grows by ~50 lines of helper source + the per-facet sub-list JSX (negligible).
- `pnpm run test:e2e:smoke` (with the compose stack up via `make up`) executes the extended block 10 and it passes; chromium-participant-skeleton wall-clock grows by <1s.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/40-participant-ui.tji` gets `complete 100` on `part_entity_detail_panel_per_facet_other_voter_breakdown` in the same commit (the Closer's ritual). Because this is the second of the two sibling polish leaves registered by `part_entity_detail_panel`'s Status block (the other — `part_entity_detail_panel_chromatic_axiom_mark_badge` — already at `complete 100`), the Closer also propagates `complete 100` to the `part_graph_view` parent grouping per the ritual's milestone-propagation step.

## Decisions

### §1 — Inline `deriveOtherFacetVotesByVoter` helper in `EntityDetailPanel.tsx`; do NOT widen `OthersVoteIndex` / `projectOtherVotes`

The predecessor refinement's Decision §11 named two candidate paths: widen the projection to carry per-facet detail OR add an inline panel-level walk. Three options vetted against this leaf's budget + the existing code shape:

- **(a) Widen `OthersVoteIndex` with a `perFacet: ReadonlyMap<string, Partial<Record<FacetName, 'agree' | 'dispute'>>>` per entity** (or equivalent — promote the projector's `perFacetVoterArm` accumulator at [`otherVotes.ts:254`](../../../apps/participant/src/graph/otherVotes.ts#L254) to escape the projection). Rejected. The projector already retains the per-facet detail internally; promoting it would (i) add a per-entity per-voter per-facet entry to the index that's consumed by exactly one surface (the panel) — every other consumer (`<GraphView>` Cytoscape paint, the canvas-dot overlay, the future at-a-glance signals) reads only the per-entity rollup; (ii) bloat the projection's memo output by ~3× for entities with multiple voters voting on multiple facets, making the React reference-equality bailout less stable; (iii) cross the participant projection-graph layer (which feeds the CANVAS) for a feature that's panel-only. The projection's escape shape was deliberately chosen to be the at-a-glance shape; per-facet detail being a panel concern motivated keeping the accumulator internal. Reversing that without a stronger downstream signal is premature.
- **(b) Inline `deriveOtherFacetVotesByVoter` walk inside `EntityDetailPanel.tsx`.** **Chosen.** Mirrors the `deriveOwnFacetVotes` precedent at [`EntityDetailPanel.tsx:111-172`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L111) verbatim — same scope, same memoization rationale, same proposal-target walk shape, same per-event filter inversion (the own-vote helper drops votes by NOT the current participant; the new helper drops votes BY the current participant). The walk runs once per `(events, entityId)` change (memoized adjacent to the existing `roster` memo) and produces a small per-voter Map (≤ N voters × ≤ 4 facets per voter). The cost is O(events) per render-change, same as the projection — but only runs when the panel is mounted AND the selection changes (or `events` change). The existing `deriveOwnFacetVotes` already pays this cost for the current participant; doing the same for OTHER participants doubles the per-panel-render walk count but stays under 2 × O(events) total, well within the panel's render budget. **The 0.5d budget allows the inline-walk path; the projection-widening path would have been the same budget BUT with a wider blast radius (every projection consumer would re-memoize).**
- **(c) Promote both `deriveOwnFacetVotes` AND the new helper to `apps/participant/src/graph/`** (e.g. `apps/participant/src/graph/perFacetVotes.ts`). Rejected. Two callers is YAGNI per the prior leaves' extraction stance — the panel is the only consumer; promoting now would design the seam for one caller. If a future leaf (e.g. an audience-side per-facet heatmap, or a moderator-side per-voter-per-facet detail surface, or a hypothetical structural-diagnostic-correlation surface) needs the same shape, the lift is mechanical and the seam is shaped by three concrete usage patterns rather than one. Same "promote on the third caller" stance the chromatic-badge sibling refinement adopted for `<AxiomMarkBadge>`.

Decision §1: ship (b). The helper lives alongside `deriveOwnFacetVotes` in `EntityDetailPanel.tsx`; the projection stays unchanged. **No named-future-task** for the lift today — the trigger is a third-caller materializing, which has no concrete identification in the current WBS (the moderator's per-voter detail is in-card already, the audience surface has no detail-panel placeholder yet).

### §2 — Always-on per-facet sub-list under each voter's row; no expand/collapse affordance

The per-facet sub-rows could render in three shapes:

- **(a) Always-on, statically rendered under each voter's row.** **Chosen.** Layout stability (the panel's height is deterministic from the data — a per-entity-and-selection function); discoverability (the debater sees the per-facet detail without needing to expand); consistency with the existing `<OwnVoteSection>` which also always-on-renders the per-facet rows ([`EntityDetailPanel.tsx:686-700`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L686)). Mirrors the predecessor refinement's Decision §1c posture for the panel itself ("always-present-with-empty-state vs slide-in-on-select").
- **(b) Collapsible per-voter accordion (a click on the voter row toggles the per-facet sub-list).** Rejected for v0. Adds an action affordance to a read-only surface; the panel deliberately reserves action affordances for the future `part_voting.*` leaves via the `actionSlot` reservation. An accordion affordance would compete with that reservation (the per-voter row gains a click handler that does NOT correspond to a methodological action — confusing).
- **(c) Per-voter row carries a `<details>`/`<summary>` HTML primitive.** Rejected for v0. Same accordion-affordance objection plus the styling complexity (the `<summary>` element needs custom Tailwind to look consistent with the rest of the panel; default browser styling is inconsistent across browsers).

Decision §2: ship (a). If real usage shows the always-on per-facet sub-rows make the panel too dense, a future polish leaf can swap to a collapsible affordance — the underlying data flow (`perVoterFacets` Map → per-voter `<li>` → per-facet sub-`<ul>`) doesn't change.

### §3 — Empty per-facet `<ul>` when the voter has no per-facet detail (gap-close shape); the section omission is governed by `votes.length === 0`, NOT by per-facet emptiness

A voter appears in the per-entity `votes` prop (from `OthersVoteIndex`) only if they have a non-`undefined` rolled-up choice — which requires at least one non-withdraw vote on at least one facet (per `otherVotes.ts`'s `rerollEntityVoter` logic at [`otherVotes.ts:278-345`](../../../apps/participant/src/graph/otherVotes.ts#L278)). So in steady state, every voter in `votes` has at least one per-facet entry in the helper's output map.

BUT: the projection's internal accumulator and the inline walk are two parallel readers of the same events; they can transiently diverge if the panel re-memoizes faster than the projection (the projection runs at the route level via `useMemo`; the inline walk runs at the panel level via `useMemo`; both depend on `events`, so they should re-derive on the same tick — but React's memo invalidation isn't strictly ordered across components). Three options for the per-voter row when the per-facet map is empty:

- **(a) Render the per-facet `<ul>` as empty (zero `<li>` children).** **Chosen.** The outer `<li>` still carries the rollup arm at the top (visible); the empty sub-list is invisible but structurally present. Defensive shape; doesn't crash if the two readers diverge for one tick.
- **(b) Suppress the per-facet `<ul>` entirely when empty.** Rejected. DOM-structure inconsistency depending on data state makes future Playwright assertions awkward (selector must conditionally exist). The empty `<ul>` is cheaper to assert against.
- **(c) Drop the entire per-voter row when per-facet map is empty.** Rejected. The voter IS in the per-entity rollup; dropping the row would diverge the panel's rendering from the projection's escape shape — a UX confusion (the canvas-dot at-a-glance signal would show the voter is voting on the entity, but the panel wouldn't carry their entry).

Decision §3: ship (a). The section omission stays governed by `votes.length === 0` (preserving the existing `(n)` case). The per-voter empty per-facet `<ul>` is the documented gap-close shape; the new `(m.2)` Vitest case pins it.

### §4 — `<OtherVotersSection>` consumes pre-bound `facetLabel` + `voteArmLabel` resolvers from the parent (NOT a `t` instance)

The existing `<OwnVoteSection>` already adopts this pattern ([`EntityDetailPanel.tsx:668-669`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L668)): the parent passes `facetLabel: (facet) => t('methodology.facet.<name>')` + `voteArmLabel: (arm) => t('methodology.voteChoice.<arm>')` rather than passing the raw `t` instance. Three options for the new sub-rows:

- **(a) Reuse the same translator-prop pattern as `<OwnVoteSection>`.** **Chosen.** Consistency across panel sub-sections; keeps the `useTranslation()` call site at the panel root; testable with mock resolvers in Vitest cases without needing i18n setup.
- **(b) Call `useTranslation()` inside `<OtherVotersSection>` directly.** Rejected. Diverges from the existing per-section pattern (`<OwnVoteSection>` uses parent-bound resolvers; `<DiagnosticsSection>` uses parent-bound resolvers via `useTranslation` inside the section, see [`EntityDetailPanel.tsx:607`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L607) — mixed pattern actually). The translator-prop pattern is the one this leaf inherits; sticking with it for `<OtherVotersSection>` keeps the section's testability clean.
- **(c) Pass a raw `t` instance.** Rejected. Couples the section to i18next's API surface; harder to mock in Vitest.

Decision §4: ship (a). Two new prop fields on `<OtherVotersSection>`: `facetLabel` (already used by `<OwnVoteSection>`) is added; `voteArmLabel` already exists on the section (currently typed as `(arm: 'agree' | 'dispute') => string` — same signature reused for per-facet rows since `Partial<Record<FacetName, 'agree' | 'dispute'>>`'s values are `'agree' | 'dispute'`).

### §5 — Per-facet row iteration order follows `FacetName` declaration order from `facetStatus.ts` (consistent across voters within the same render)

The per-voter per-facet map (`Partial<Record<FacetName, 'agree' | 'dispute'>>`) is a sparse map (a voter has voted on some facets, not necessarily all). The iteration order for rendering rows could be:

- **(a) The order facets appear in `FacetName`'s declaration** (typically: `'classification' | 'substance' | 'wording' | 'shape'`, per [`facetStatus.ts`](../../../apps/participant/src/graph/facetStatus.ts)). **Chosen.** Deterministic; matches the moderator's in-card facet pill row order (`apps/moderator/src/graph/StatementNode.tsx`'s `FACET_RENDER_ORDER`) for cross-surface consistency. The same order is used by `<OwnVoteSection>` (via `Object.entries(perFacet)` at [`EntityDetailPanel.tsx:679`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L679) — which is JS Map iteration order, i.e. insertion order, which is `FacetName` declaration order under the inline walk because the walk visits proposals first then votes).
- **(b) The order each voter first voted on each facet.** Rejected. Diverges per voter (different voters voted on different facets in different orders); the panel's row block would shuffle row-positions per voter, hurting visual scanability.
- **(c) Alphabetical by facet name.** Rejected. Different from the moderator's surface; inconsistent.

Decision §5: ship (a). The per-facet rows render in `FacetName` declaration order — the same order `<OwnVoteSection>` uses implicitly today. Concretely the helper inserts entries into its internal Map in the order the events log presents them (proposal-then-vote walk); for the per-voter sub-Map this means iteration order roughly tracks per-facet first-vote-arrival, which usually but not always matches declaration order. **Sub-decision**: to make the order strictly deterministic across voters AND consistent with the moderator, the per-voter map iteration in `<OtherVotersSection>` walks `NODE_FACET_NAMES` / `EDGE_FACET_NAMES` (the constant arrays defined at [`EntityDetailPanel.tsx:204-205`](../../../apps/participant/src/detail/EntityDetailPanel.tsx#L204)) and reads the per-facet arm via `perVoterFacets.get(voterId)?.[facet]`, skipping `undefined` arms. This widens the constant arrays' use (currently used only by the per-facet pill row at line 484) without changing their shape. Mirror of the moderator's `FACET_RENDER_ORDER` pattern.

Note: `NODE_FACET_NAMES` today is `['classification', 'substance', 'wording']` (3-valued, narrowed via `Exclude<FacetName, 'shape'>`). For the per-voter facet rows on a NODE, shape-facet votes (per ADR 0030 + `pf_part_facet_name_widen_shape`) would NOT render — but shape-facet votes on a NODE are not currently emitted by the system; the `'shape'` facet is a structural property of edges. So the narrowing is sound for the panel's NODE rendering. For EDGE rendering, `EDGE_FACET_NAMES` is `['substance']`; the helper's output map for an edge selection MAY carry shape-facet entries (per `set-edge-shape` proposals, if/when they land) — so this leaf widens `EDGE_FACET_NAMES` to `['substance', 'shape']` to surface the shape facet in the per-voter sub-rows. The widening also fixes the existing per-facet pill row (line 484), which today would silently drop a shape-facet status on an edge — a sister bug that this leaf closes mechanically. (The widening is the smallest "do it" fix; if the orchestrator's preference is to keep this leaf's blast radius minimal, the widening can be deferred to a separate ticket and the per-facet sub-rows can render shape entries via a special case. But the cleaner fix is the constant widening; ~1-line edit.)

### §6 — Playwright block 10 seeds a third `participant-joined` for a synthesised `IVAN_USER_ID` (NOT a pool user); no new Playwright session needed for the third user

The block already runs as `henry + grace` (two Playwright sessions, both consuming the pool); adding a third participant to surface the per-facet panel detail can be done one of two ways:

- **(a) Seed a `participant-joined` event for a synthesised `IVAN_USER_ID` (UUID generated inline within the test block); no Playwright session for that user.** **Chosen.** The `participant-joined` event is sufficient to populate `participantRoster.ts`'s screen-name resolution at the panel level — the rest of the user's vote events (a `proposal` + a `vote`) are also seeded inline. The third user's role is observational from the test's perspective (they generate events; they don't navigate a UI); no Playwright session needed. Saves the cost of adding a third pool user or a third role-swap pair.
- **(b) Expand `DEV_USER_POOL` to 14 users and add a third Playwright session in block 10.** Rejected. Same reason `part_other_vote_indicators` Decision §7 (and the predecessor refinement's Decision §7) rejected the analogous expansion: infra cost (Authelia config + DEV_USER_POOL constant) for one assertion of value. The synthesised-user seed pattern is cheaper and tests the same surface (the panel's per-facet sub-rows render whoever's events arrive over the WS, regardless of whether they're a Playwright session).
- **(c) Reuse one of the existing role-swap pair users for the third voter.** Rejected. The block's existing voters (grace + henry) already drive the panel via their proposal/vote arrivals; reusing them would couple the per-facet sub-row count to the existing flow rather than letting the test target a distinct voter for the per-facet assertion (creating a "two voters, but one is on the same tap path" entanglement).

Decision §6: ship (a). The synthesised `IVAN_USER_ID` is a UUID generated inline (e.g. `crypto.randomUUID()` at block start); the seed events are: `participant-joined { userId: IVAN_USER_ID, screenName: 'ivan' }` + `proposal { ... classify-node on NODE_A }` from `IVAN_USER_ID` + `vote { proposal_id: ..., participant: IVAN_USER_ID, choice: 'agree' }`. The panel's per-facet sub-row for the classification facet under the IVAN voter row is the new assertion's target. This pattern (synthesising users for seed-event-only coverage) is precedented in the existing spec — block 10 already seeds events from `GRACE_USER_ID` and `HENRY_USER_ID` for the axiom-mark surface added by the chromatic-badge sibling.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Added `deriveOtherFacetVotesByVoter(events, currentParticipantId, entityId)` helper in `apps/participant/src/detail/EntityDetailPanel.tsx`, adjacent to the existing `deriveOwnFacetVotes` (Decision §1 inline-walk path; projection unchanged).
- Extended `<OtherVotersSection>` with `perVoterFacets` + `facetLabel` props; each voter row now carries a `<ul data-testid="participant-detail-panel-other-vote-facet-list">` sub-list with per-facet `<li data-testid="participant-detail-panel-other-vote-facet-row" data-facet=… data-vote-arm=…>` children.
- Added `useMemo` over `deriveOtherFacetVotesByVoter` inside `EntityDetailPanelImpl`, threaded into `<OtherVotersSection>` — mirrors the existing `perFacet` memo in `<OwnVoteSection>`.
- New Vitest case `(m.1)` in `apps/participant/src/detail/EntityDetailPanel.test.tsx` — pins per-facet sub-rows for two voters (alice: classification+wording agree; ben: classification+substance dispute).
- New Vitest case `(m.2)` in `apps/participant/src/detail/EntityDetailPanel.test.tsx` — pins gap-close shape: voter present in per-entity rollup but with empty per-facet map renders empty `<ul>`, not suppressed.
- Extended block 10 of `tests/e2e/participant-graph-render.spec.ts` with synthesised `IVAN_USER_ID` participant-joined + classify-proposal + agree vote seed events; asserts per-voter row + per-facet sub-list + `data-facet="classification"` + `data-vote-arm="agree"` sub-row after tap on `NODE_A`.
- Failing-first verification: short-circuiting `<OtherVotersSection>` to omit per-facet sub-list flipped `(m.1)` + `(m.2)` red (Playwright per-facet assertions also red); existing `(m)` and `(n)` stayed green. Short-circuiting `deriveOtherFacetVotesByVoter` to always return `new Map()` flipped the same cases red.
