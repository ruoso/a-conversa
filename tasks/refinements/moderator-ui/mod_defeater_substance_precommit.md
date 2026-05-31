# Moderator defeater-substance-precommit — methodology-flavored substance affordance on the rebut edge that fires F6 step 4

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_defeater_flow.mod_defeater_substance_precommit` (see
`mod_defeater_flow` group at line 544 and this leaf at line 559).

```tji
task mod_defeater_substance_precommit "Pre-commit edge substance as agreed; source substance proposed" {
  effort 1d
  allocate team
  depends !mod_defeater_node_creation
}
```

## Effort estimate

**1d.** Confirmed. Every wire-level seam is already in place; this task ships
a thin methodology-flavored affordance variant + the F6 end-to-end Playwright
pin.

- **Wire shape exists and is unchanged.** Step 4's propose payload is the
  substance-only re-vote shape of `set-edge-substance` —
  `{ kind: 'set-edge-substance', edge_id, value }` with NO endpoint
  carriage (per
  [packages/shared-types/src/events/proposals.ts L247–269](../../../packages/shared-types/src/events/proposals.ts#L247)
  and the canonical doc-block at L192–245). The endpoint-carriage
  branch shipped by
  [`mod_set_edge_substance_endpoint_carriage.md`](mod_set_edge_substance_endpoint_carriage.md)
  is for FRESH-edge cases; F6's rebut edge was emitted at propose-time
  in step 3 (per ADR 0027), so by step 4 the edge already lives in
  projection and the substance-only shape applies (Decision §D6).
- **Propose hook exists and is unchanged.** The generic per-edge
  `useProposeSetEdgeSubstanceAction(edgeId)` at
  [apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts](../../../apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts)
  already mints the substance-only re-vote envelope. F6 step 4 is one
  more call site (Decision §D2).
- **Per-edge affordance scaffold exists.** The generic
  `<EdgeCardSubstanceAffordance>` at
  [apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx](../../../apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx)
  mounts inside `<StatementEdge>`'s label container with the existing
  shape-settled + substance-awaiting-proposal gate
  ([StatementEdge.tsx L147–160, L307](../../../apps/moderator/src/graph/StatementEdge.tsx#L147)).
  This task adds a parallel `<RebutEdgePreCommitAffordance>` (Decision
  §D3) and switches `<StatementEdge>` to render the rebut-specific
  affordance when `edge.role === 'rebuts'`.
- **Server sequencing is already enforced.** The F6 step-3 → step-4
  ordering — capture-node propose commits → edge.shape facet reaches
  `agreed`/`committed` → set-edge-substance propose passes the gate —
  is the server's responsibility per
  [propose.ts L1635–1660](../../../apps/server/src/methodology/handlers/propose.ts#L1635).
  The UI mirrors the same predicate
  (`isShapeSettled && substanceStatus === 'awaiting-proposal'`) on
  `<StatementEdge>` L160 to avoid premature affordance surfacing; this
  task inherits the predicate (Decision §D7).
- **Engine-side pin exists.** The Cucumber feature
  [`tests/behavior/methodology/defeater-capture.feature`](../../../tests/behavior/methodology/defeater-capture.feature)
  already pins the projection-side behavior of F6 step 4: the rebut
  edge's substance committing to `agreed` while Y's substance facet
  stays `'proposed'` and the firing predicate computes `false`. The
  Vitest pin
  [`apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts`](../../../apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts)
  pins the propose-handler arm. This task does NOT modify either; it
  pins the **UI-side path** to the same wire envelope.

Concrete deliverable:

- **New file `apps/moderator/src/graph/RebutEdgePreCommitAffordance.tsx`**
  — a thin methodology-flavored variant of `<EdgeCardSubstanceAffordance>`
  that mounts on rebut edges in F6-step-4 state. Renders the same
  two-button picker (`agreed` / `disputed`) but with defeater-flavored
  labels + an explanatory hint citing methodology F6 §4
  ("Pre-commit retraction as agreed"). Reuses
  `useProposeSetEdgeSubstanceAction(edgeId)` unchanged (Decision §D2);
  the disputed button is preserved (Decision §D4) so moderators retain
  the option to reject the participant's prescribed-pre-commit framing.
- **`<StatementEdge>` switch logic** — when
  `showSubstanceAffordance && edge.role === 'rebuts'`, render
  `<RebutEdgePreCommitAffordance edgeId={id} />`; otherwise the existing
  `<EdgeCardSubstanceAffordance edgeId={id} />`. One conditional
  branch, no other behavioral change.
- **4 new i18n catalog keys** under `moderator.rebutEdgePreCommit.*`
  (×3 locales = 12 catalog entries) — see Constraints / requirements
  § i18n.
- **1 follow-up tech-debt task** registered in
  `tasks/35-frontend-i18n.tji` for native-speaker review of the new
  pt-BR / es-419 draft entries
  (`i18n_rebut_edge_pre_commit_native_review`, effort 0.5d,
  `depends !<current tail of the native-review chain>` — Closer reads
  the tail at register time).
- **Vitest cases** across the new affordance test file + `<StatementEdge>`
  switch coverage (see Acceptance criteria § 4).
- **Playwright e2e** in `tests/e2e/moderator-capture.spec.ts` extending
  the F6 capture-defeater block with the post-step-3 chain:
  shape-facet vote+commit → rebut affordance becomes visible →
  click "Pre-commit as agreed" → assert substance facet flips through
  `proposed` → vote+commit → assert end state (`agreed` substance,
  Y's substance facet `'proposed'`, edge inert per the engine pin).
- **No new propose hook, no new propose component on the bottom strip,
  no new wire schema, no methodology engine change, no new ADR.**

## Inherited dependencies

Parent (`mod_defeater_flow`) declares
`depends !mod_capture_flow, root_app.root_moderator_cutover,
data_and_methodology.methodology_engine.defeater_capture_logic`.

Direct dep: `!mod_defeater_node_creation` (see WBS line 562).

Settled (every gating dep is done):

- **`moderator_ui.mod_defeater_flow.mod_defeater_node_creation`** (done
  2026-05-31 — [`mod_defeater_node_creation.md`](mod_defeater_node_creation.md)).
  Shipped the capture pane + propose action that mints Y + the rebut
  edge Y→X via a single `capture-node`-with-edge envelope (role
  `'rebuts'`, direction `'targets'`). On success the predecessor
  hook calls `exitCaptureDefeaterMode()` + `setText('')`; the rebut
  edge is left in projection with substance facet `'awaiting-proposal'`
  awaiting THIS task's pre-commit propose. Predecessor §D6 deliberately
  did NOT pre-stash the rebut edge id — this task picks it up via the
  natural UI seam (the moderator selects the rebut edge on the canvas;
  the affordance is per-edge-keyed via `<StatementEdge>`'s mount),
  not via a transient store slice (Decision §D5 records this).
- **`moderator_ui.mod_defeater_flow.mod_capture_defeater_mode`**
  (done — commit `0bed258`,
  [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md)).
  Indirect ancestor — established the F6 mode-entry seam this whole
  flow inherits.
- **`data_and_methodology.methodology_engine.defeater_capture_logic`**
  (done 2026-05-10 —
  [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)).
  Settled the **Option B** layering: defeater capture is a UI-level
  macro built on existing event primitives — no defeater-specific
  proposal sub-kind. F6 step 4 is a regular `set-edge-substance`
  propose against the rebut edge with `value: 'agreed'`; the
  propose-handler arm is the existing universal-pass path tightened
  by `mod_set_edge_substance_endpoint_carriage`'s shape-facet gate.
- **`moderator_ui.mod_defeater_flow.mod_set_edge_substance_endpoint_carriage`**
  (settled — wire shape pinned).
  Pinned the two-arm `setEdgeSubstanceProposalSchema`: (a) endpoint-
  carriage shape for fresh edges, (b) substance-only re-vote shape
  for extant edges. F6 step 4 uses (b) — the rebut edge already
  exists in projection from step 3's propose-time `edge-created`
  emission per ADR 0027. Decision §D6 records this.
- **`moderator_ui.per_facet_refactor.pf_mod_edge_card_substance_affordance`**
  (settled — the generic per-edge substance affordance shipped).
  Pinned the per-edge substance-pick gesture surface: the
  two-button picker mounted inside `<StatementEdge>`'s label
  container, gated on
  `isShapeSettled && substanceStatus === 'awaiting-proposal'`,
  fires `propose set-edge-substance(edge_id, value)` via the
  per-edge keyed hook with no shared store coupling.
- **`moderator_ui.per_facet_refactor.pf_sequence_gate_server_enforced`**
  (settled — server is the integrity boundary).
  Pinned: the server's propose-handler refuses
  `set-edge-substance` against an edge whose shape facet is not
  `'agreed'` / `'committed'`. The UI mirrors the same predicate
  on the affordance gate to eliminate premature flash; THIS task
  inherits that predicate unchanged.
- **`moderator_ui.per_facet_refactor.pf_mod_edge_shape_commit_affordance`**
  (settled — moderator can advance an edge's shape facet).
  Settled: the per-edge inline shape-commit affordance at
  `<StatementEdge>` L306 lets the moderator vote and commit the edge
  shape facet. The F6 step-3 → step-4 gap (between capture-node
  commit and set-edge-substance propose) is bridged by the moderator
  driving the shape-commit affordance on the rebut edge — same path
  any other edge takes.
- **[ADR 0027](../../../docs/adr/0027-structural-events-emit-at-propose-time.md)**
  — structural entity events emit at propose time. The rebut edge
  exists in projection as soon as the step-3 capture-node propose
  envelope lands (before any vote/commit), so by step 4 the edge is
  retrievable via the projection or via natural canvas selection
  (Decision §D5 + D6).
- **[ADR 0030](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md)**
  — per-facet vote-keying and sequential capture. §1 + §8 + §10 are
  the relevant clauses: (a) the edge facet sequence is
  `shape → substance` (substance is the next-awaiting facet only
  after shape settles); (b) the propose-handler refuses
  set-edge-substance against an unsettled shape facet; (c) the
  affordance gates on the same predicate.
- **[ADR 0021](../../../docs/adr/0021-event-envelope.md)** — the
  envelope shape; Zod validation at the server boundary.
- **[ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)** —
  every empirical check ships as committed Vitest / Cucumber /
  Playwright.
- **[ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)**
  — `useTranslation()` for catalog access; ICU interpolation for the
  affordance's value-button aria-label and the explanatory hint.
- **`moderator_ui.mod_state_management`** (settled — no store change
  needed). This task adds NO captureStore slice and NO module-scoped
  Zustand slice — the existing `useSetEdgeSubstanceStore` (already
  shipped under the generic affordance) is reused unchanged via the
  shared hook.
- **`tests/behavior/methodology/defeater-capture.feature`** (settled
  engine pin). The Gherkin scenarios 1 + 2 pin the F6 step-4
  end-state across two end states (Y's substance proposed → edge
  inert vs. Y's substance committed-agreed → edge active). THIS task's
  UI Playwright spec exercises the wire path that lands the
  proposal events the Cucumber scenarios already verify in
  isolation.

Pending edges this task FEEDS (NOT depends on):

- **`milestones.M6` (or equivalent F6-complete milestone)** — this is
  the last leaf of `mod_defeater_flow`; completing it closes the F6
  flow. The Closer propagates `complete 100` per the README ritual.
- **`frontend_i18n.i18n_rebut_edge_pre_commit_native_review`**
  (registered by this task — see Acceptance criteria / Decisions).
  pt-BR / es-419 drafts of the 4 new keys land flagged PENDING; the
  follow-up replaces them with native-speaker-reviewed text.

## What this task is

Land the **F6 step 4 user surface** — the methodology-prescribed
pre-commit of the rebut edge's substance to `'agreed'`. The
user-visible promise: after F6 step 3 (defeater capture commits and
the rebut edge's shape facet settles to `'committed'` via the existing
shape-commit affordance + voting round), a methodology-flavored
substance-picker affordance becomes visible on the rebut edge label
on the canvas. The moderator clicks "Pre-commit as agreed", which
fires `propose set-edge-substance(rebut_edge_id, 'agreed')` via the
existing per-edge propose hook. A standard vote+commit round then
advances the rebut edge's substance facet to `'agreed'`.

The end state is the F6 flow's completed structural shell: a defeater
node Y in projection with substance facet `'proposed'`, a rebut edge
Y→X with shape facet `'committed'` and substance facet `'agreed'`,
and an inert firing predicate (per
[docs/data-model.md L100–102](../../../docs/data-model.md#L100):
"the rebut sits in the graph but does not currently fire... if the
source ever becomes substantively established, the rebut activates").

Two coordinated surfaces ship in this task:

1. **`<RebutEdgePreCommitAffordance>`** — a per-edge inline affordance
   parallel to `<EdgeCardSubstanceAffordance>`, mounting on rebut
   edges only. Renders a two-button picker (`agreed` / `disputed`)
   with defeater-flavored labels + a one-line explanatory hint
   citing the methodology recommendation. The `agreed` button is
   visually prominent (methodology default); the `disputed` button
   is preserved as a secondary affordance so a moderator who
   rejects the participant's pre-commit framing can still surface
   that disagreement through the normal substance-proposal path
   (Decision §D4).

2. **`<StatementEdge>` switch logic** — replaces the generic
   `<EdgeCardSubstanceAffordance>` with `<RebutEdgePreCommitAffordance>`
   when the edge's role is `'rebuts'` AND the existing affordance
   visibility predicate
   (`isShapeSettled && substanceStatus === 'awaiting-proposal'`)
   holds. One conditional branch; no behavioral change for non-rebut
   edges.

**Out of scope** (sibling-task / downstream / out-of-flow ownership):

- **An active propose-set-node-substance gesture for Y.** Per
  Decision §D5, Y's substance facet status enters `'proposed'`
  naturally via the entity-included carriage when step 3's
  capture-node lands (this is what the Cucumber pin's step
  "the defeater node Y's substance facet is proposed" asserts —
  L349–356 of
  [tests/behavior/steps/methodology-defeater-capture.steps.ts](../../../tests/behavior/steps/methodology-defeater-capture.steps.ts#L349)).
  No active gesture by THIS task is needed for Y's substance; the
  task title's "source substance proposed" describes the resulting
  facet status, not an action.
- **Y's classification.** Y enters with classification facet
  `'awaiting-proposal'` per ADR 0030 (capture is wording-only).
  Naming Y's classification is a separate moderator gesture on Y's
  node card — out of scope for F6 and for this task.
- **A chained / auto-fired propose-set-edge-substance immediately
  after step 3's capture-node propose succeeds.** The shape-facet
  gate (server-enforced per
  [propose.ts L1653–1660](../../../apps/server/src/methodology/handlers/propose.ts#L1653))
  rejects substance proposals against an unsettled shape — a chain
  fired in the same round as step 3 would land in `'awaiting-proposal'`
  shape state and be rejected. The natural sequencing — a vote+commit
  round on the rebut edge's shape between step 3 and step 4 — is the
  existing UX (Decision §D7).
- **The vote + commit rounds themselves.** Voting on the substance
  proposal AND committing it through to `'agreed'` is the existing
  per-facet vote/commit infrastructure shipped under the
  `pf_*_facet_*` chain. This task only ships the propose-fire
  surface; the round-trip is already in place.
- **Server / projection / methodology engine changes.** None — the
  propose-handler arm for set-edge-substance is already tightened
  via `mod_set_edge_substance_endpoint_carriage`; the projection
  applies `edge.substanceFacet` updates via the existing facet
  pipeline; the firing predicate `isEdgeActive` is pinned by the
  engine-side Cucumber scenarios.
- **A "find me the rebut edge" automatic-lookup hook.** The natural
  UI seam is canvas selection: the moderator clicks the rebut edge
  to surface the per-edge label and affordance. No
  "find-rebut-by-predicate" hook is shipped (Decision §D5).

## Why it needs to be done

Three reasons, in priority order:

1. **F6 is incomplete without it.** The two predecessors shipped
   mode entry (step 1) + capture pane (steps 2–3, minting Y + the
   rebut edge). The methodology's F6 flow (per
   [docs/methodology.md L110–121](../../../docs/methodology.md#L110)
   and
   [docs/moderator-ui.md L108–119](../../../docs/moderator-ui.md#L108))
   has the substance pre-commit as step 4 — the structural
   handshake that turns the rebut from a wording-only structural
   shell into a methodology-meaningful "if Y holds, Y defeats X"
   commitment. Without this task the F6 promise (per
   [docs/data-model.md L100–102](../../../docs/data-model.md#L100):
   "a defeater is a regular node plus a `rebuts` edge whose substance
   is `agreed` but whose source's substance is not yet `agreed`")
   isn't reachable in the live UI.

2. **The engine-side pin has no UI-side counterpart yet.** The
   Cucumber feature
   [`defeater-capture.feature`](../../../tests/behavior/methodology/defeater-capture.feature)
   pins the engine-side three-event sequence (node-created,
   edge-created, propose-set-edge-substance) and the projection
   end-state. The Vitest pin
   [`proposeDefeaterPreCommit.test.ts`](../../../apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts)
   pins the propose-handler arm. Neither verifies that the
   moderator-UI emits the right wire envelope in response to the
   right user gesture in the F6 flow — this task's Playwright spec
   closes that gap.

3. **Discoverability of the methodology-prescribed default.** The
   generic `<EdgeCardSubstanceAffordance>` already lets the
   moderator pick `agreed` on any edge — including the rebut.
   The new `<RebutEdgePreCommitAffordance>` does NOT change the
   wire path; it changes the framing. Surfacing the
   methodology's "pre-commit the retraction" language on rebut
   edges makes F6 step 4 discoverable for a moderator who is in
   the F6 flow for the first time. The disputed button is
   preserved (Decision §D4) so a moderator who disagrees retains
   the ordinary path.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- [apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx](../../../apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx)
  — the canonical per-edge substance affordance this task's new
  variant mirrors. Pinned the two-button picker layout, the per-edge
  data-testid pattern (`edge-card-substance-affordance-${edgeId}`),
  the `event.stopPropagation()` posture that isolates the affordance
  click from ReactFlow's edge-selection chain, the inline error
  region keyed on `lastError`, the reuse of the
  `moderator.setNodeSubstanceAction.*` namespace for shared labels.
  The new variant follows the same shape with rebut-flavored
  labels + a leading hint paragraph (Decision §D3).
- [apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts L160–227](../../../apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts#L160)
  — the per-edge propose hook the new affordance consumes
  unchanged. Returns `propose(value: SubstanceValue): Promise<void>`
  + `inFlight: boolean` + `lastError: WireError | undefined`. The
  hook's module-scoped `useSetEdgeSubstanceStore` already tracks
  per-edge in-flight state and per-edge wire errors; the rebut
  affordance shares it transparently — two affordances on two
  different rebut edges observe disjoint state.
- [apps/moderator/src/graph/StatementEdge.tsx L147–160, L307](../../../apps/moderator/src/graph/StatementEdge.tsx#L147)
  — the visibility predicate + the mount site for the existing
  substance affordance. The new switch arm goes at L307: when
  `showSubstanceAffordance && edge.role === 'rebuts'`, render
  `<RebutEdgePreCommitAffordance edgeId={id} />`; otherwise the
  existing `<EdgeCardSubstanceAffordance edgeId={id} />`. The
  `showSubstanceAffordance` predicate (L160) and its rationale
  (L147–157) are inherited unchanged.
- [apps/moderator/src/graph/selectors.ts](../../../apps/moderator/src/graph/selectors.ts)
  — the `StatementEdgeData` selector that feeds `<StatementEdge>`
  the `role`, `facetStatuses`, `substanceStatus` props. No change;
  `role` is already on the data shape (it drives the existing
  visual styling per edge kind).
- [packages/shared-types/src/events/proposals.ts L191–269](../../../packages/shared-types/src/events/proposals.ts#L191)
  — `setEdgeSubstanceProposalSchema`. The substance-only re-vote
  shape is `{ kind, edge_id, value }` (no endpoint carriage). The
  hook builds exactly this shape; no schema change.
- [packages/shared-types/src/events/enums.ts L23](../../../packages/shared-types/src/events/enums.ts#L23)
  — `edgeRoleSchema` includes `'rebuts'` as one of the seven
  values. The role-discriminator on the switch arm reads this
  value off `StatementEdgeData`.
- [apps/server/src/methodology/handlers/propose.ts L1615–1661](../../../apps/server/src/methodology/handlers/propose.ts#L1615)
  — the server's propose-handler arm for `set-edge-substance`.
  Two cases: (a) fresh-edge (skip shape gate, the carriage IS the
  shape) — not this task's path; (b) extant-edge (require
  shape facet `'agreed'` / `'committed'`) — THIS task's path. The
  arm's doc-block at L1644–1652 explicitly names F6: "F6 operates
  against an edge whose shape was committed in a prior round, and
  `'committed'` is an accepting predecessor here."
- [apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts L180–212](../../../apps/server/src/methodology/handlers/proposeDefeaterPreCommit.test.ts#L180)
  — the seed sequence for the Vitest pin: votes + commits on
  (edge, 'shape') facet to advance shape to committed BEFORE
  proposing set-edge-substance. This is the canonical
  step-3 → step-4 sequence. The UI mirrors it: the shape-commit
  affordance owns the in-between round, then this task's affordance
  fires.
- [tests/behavior/methodology/defeater-capture.feature L28–63](../../../tests/behavior/methodology/defeater-capture.feature#L28)
  — the engine-side pin for F6's three-event sequence + the
  end-state firing predicate. Two scenarios cover (1) Y's substance
  stays proposed → edge inert; (2) Y's substance is later
  committed-agreed → edge active. This task's UI spec exercises
  the wire path that produces scenario 1's pre-commit event.
- [tests/behavior/steps/methodology-defeater-capture.steps.ts L289–305, L349–356](../../../tests/behavior/steps/methodology-defeater-capture.steps.ts#L289)
  — the Gherkin step that drives the rebut-substance commit
  (L289–305) and the assertion that Y's substance facet status is
  `'proposed'` post-include (L349–356). The latter confirms
  Decision §D5: no active gesture for Y's substance is needed; the
  facet status is `'proposed'` from the entity-included event
  alone.
- [apps/moderator/src/layout/useProposeSetNodeSubstanceAction.ts](../../../apps/moderator/src/layout/useProposeSetNodeSubstanceAction.ts)
  — the node-side parallel hook for set-node-substance. NOT used
  by this task (Y's substance is NOT proposed here); cross-referenced
  for shape symmetry with the edge-side hook the new affordance
  consumes.
- [apps/moderator/src/graph/NodeCardSubstanceAffordance.tsx](../../../apps/moderator/src/graph/NodeCardSubstanceAffordance.tsx)
  — the node-side parallel affordance. NOT used by this task;
  cross-referenced for shape symmetry with the new rebut
  affordance.
- [packages/i18n-catalogs/src/catalogs/en-US.json L329 (`setNodeSubstanceAction`) + L489 (`captureDefeater`)](../../../packages/i18n-catalogs/src/catalogs/en-US.json#L329)
  — the existing namespaces. The new keys land under
  `moderator.rebutEdgePreCommit.*`, sibling to
  `moderator.captureDefeater.*`.
- [tests/e2e/moderator-capture.spec.ts](../../../tests/e2e/moderator-capture.spec.ts)
  — the e2e spec already extended by `mod_capture_defeater_mode`
  + `mod_defeater_node_creation`. This task adds a new
  `test()` block under the same `test.describe` covering the
  post-step-3 chain (shape vote+commit → rebut affordance appears →
  click pre-commit → substance vote+commit → end-state assertions).
- [`docs/moderator-ui.md` L108–119](../../../docs/moderator-ui.md#L108)
  — F6 flow specification step 4 ("The participant pre-commits to
  the rebut: the moderator proposes the rebuts edge's substance as
  agreed").
- [`docs/methodology.md` L110–121](../../../docs/methodology.md#L110)
  — the methodology framing for F6 step 4 and its rationale (the
  conditional reading of edge substance).
- [`docs/data-model.md` L95–110](../../../docs/data-model.md#L95)
  — the structural shape of a defeater (regular node + `rebuts`
  edge with `substance=agreed` and source `substance != agreed`).
  The end-state this task's UI helps reach.

Refinements consulted for style + decision continuity:

- [`mod_defeater_node_creation.md`](mod_defeater_node_creation.md) —
  predecessor; carries the F6 framing, the capture-defeater state
  slices, the i18n namespace convention (`moderator.captureDefeater.*`).
- [`mod_capture_defeater_mode.md`](mod_capture_defeater_mode.md) —
  the predecessor's predecessor; the mode-entry seam.
- [`mod_set_edge_substance_endpoint_carriage.md`](mod_set_edge_substance_endpoint_carriage.md)
  — the wire-shape settle for set-edge-substance.
- [`pf_mod_edge_card_substance_affordance.md`](../per-facet-refactor/pf_mod_edge_card_substance_affordance.md)
  — the generic per-edge substance affordance this task's variant
  parallels. The new affordance's posture (per-edge keyed, no
  shared store coupling, two-button picker, in-flight + error
  region) inherits directly.
- [`pf_mod_edge_shape_commit_affordance.md`](../per-facet-refactor/pf_mod_edge_shape_commit_affordance.md)
  — the shape-commit affordance the F6 step-3 → step-4 round-bridge
  uses.
- [`defeater_capture_logic.md`](../data-and-methodology/defeater_capture_logic.md)
  — engine-side Option B layering.

No new ADR is required (see Decision §D9). No new dependency lands.
No public type signature changes — the new affordance accepts a
single `edgeId` prop, mirroring the generic one. No cross-workspace
contract changes. No methodology engine, projection, wire envelope,
or proposal schema changes.

## Constraints / requirements

### `<RebutEdgePreCommitAffordance>` (`apps/moderator/src/graph/RebutEdgePreCommitAffordance.tsx`)

- **New file.** Accepts a single prop `edgeId: string` (the rebut
  edge's id); identical surface to `<EdgeCardSubstanceAffordance>`.
- **Mount-time gate is `<StatementEdge>`'s responsibility** — the
  component itself does NOT self-gate on role / facet state. By the
  time it's mounted, the caller has already verified
  `edge.role === 'rebuts'` and the existing
  `showSubstanceAffordance` predicate.
- **Consumes `useProposeSetEdgeSubstanceAction(edgeId)`** unchanged —
  same hook the generic affordance uses; per-edge keyed in-flight +
  error state via the existing module-scoped
  `useSetEdgeSubstanceStore`.
- **Renders an explanatory hint paragraph** ABOVE the button row
  citing the methodology's F6 §4 framing. Hint text is from
  `t('moderator.rebutEdgePreCommit.hint')` ("Pre-commit the
  retraction: agreeing here records that if this condition holds,
  it would defeat the target."). The hint's `data-testid` is
  `rebut-edge-pre-commit-hint-${edgeId}`.
- **Renders a two-button picker** (same order as the generic
  affordance: `'agreed'` first, `'disputed'` second). Button labels:
  - `agreed`: `t('moderator.rebutEdgePreCommit.valueButton.agreed')`
    ("Pre-commit as agreed").
  - `disputed`: `t('moderator.rebutEdgePreCommit.valueButton.disputed')`
    ("Mark disputed").
  - Per-button aria-label uses
    `t('moderator.rebutEdgePreCommit.valueButtonAriaLabel',
    { label })`.
- **Click dispatch**: the click handler calls
  `event.stopPropagation()` (same posture as the generic affordance)
  then `void proposeRef.current(value)`. The proposeRef holds the
  hook's `propose` callback in a `useRef` updated by `useEffect` so
  the click handler is stable across renders — identical pattern to
  the generic affordance.
- **In-flight visual** — buttons `disabled={inFlight}` (the hook's
  `inFlight` boolean keyed on the bound edgeId).
- **Inline error region** — when `lastError !== undefined`, renders
  a `<p role="alert">` with the wire error message. `data-testid`
  is `rebut-edge-pre-commit-error-${edgeId}`. Reuses the existing
  `moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel`
  i18n key (Decision §D8 cross-module reuse).
- **Container `data-testid`** is
  `rebut-edge-pre-commit-affordance-${edgeId}`; the container also
  carries `data-edge-id={edgeId}` and `data-rebut="true"` for
  selector clarity in the Playwright spec.
- **Per-value `data-testid`** on each button:
  `rebut-edge-pre-commit-button-${edgeId}-${value}`. Same naming
  shape as the generic affordance.

### `<StatementEdge>` switch logic (`apps/moderator/src/graph/StatementEdge.tsx`)

- **Read `role`** from the edge data (already on `StatementEdgeData`).
- **Replace L307** (the existing
  `{showSubstanceAffordance ? <EdgeCardSubstanceAffordance edgeId={id} /> : null}`)
  with:
  ```jsx
  {showSubstanceAffordance ? (
    role === 'rebuts' ? (
      <RebutEdgePreCommitAffordance edgeId={id} />
    ) : (
      <EdgeCardSubstanceAffordance edgeId={id} />
    )
  ) : null}
  ```
- **No change** to the `showSubstanceAffordance` predicate (L160) or
  the surrounding mount logic — the role-discriminator only chooses
  the variant.
- **No change** to the shape-commit affordance at L306; the
  pre-commit affordance is gated on substance + shape-settled, so
  the two never co-render.

### i18n catalog keys

| Key | en-US | pt-BR (draft) | es-419 (draft) |
| --- | --- | --- | --- |
| `moderator.rebutEdgePreCommit.hint` | "Pre-commit the retraction: agreeing here records that if this condition holds, it would defeat the target." | "Pré-comprometa a refutação: concordar aqui registra que, se esta condição se sustentar, ela refutaria o alvo." | "Pre-comprométete a la refutación: aceptar aquí registra que, si esta condición se sostiene, refutaría el objetivo." |
| `moderator.rebutEdgePreCommit.valueButton.agreed` | "Pre-commit as agreed" | "Pré-comprometer como concordado" | "Pre-comprometer como aceptado" |
| `moderator.rebutEdgePreCommit.valueButton.disputed` | "Mark disputed" | "Marcar como contestado" | "Marcar como disputado" |
| `moderator.rebutEdgePreCommit.valueButtonAriaLabel` | "{label} substance for this rebut edge" | "{label} substância para esta refutação" | "{label} sustancia para esta refutación" |

**Count: 4 keys × 3 locales = 12 catalog entries.** pt-BR / es-419
drafts land flagged PENDING in `pt-BR.review.json` +
`es-419.review.json` (8 PENDING entries total). The
predecessor's existing `moderator.captureDefeater.*` keys + the
generic `moderator.setNodeSubstanceAction.*` keys are unchanged.

**Reuses** for cross-module keys that would otherwise inflate the count:

- **Wire-error inline-region label reuses
  `moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel`**
  (already shipped by the generic affordance). Same wording
  prefix, no rebut-specific phrasing. Consistent with ADR 0024's
  "reuse before mint" principle and with the generic affordance's
  cross-module reuse pattern (Decision §D8).
- **Wire-timeout fallback message reuses
  `moderator.setNodeSubstanceAction.errorBanner.timeout`** — the
  generic per-edge hook already routes through this key
  ([useProposeSetEdgeSubstanceAction.ts L215](../../../apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts#L215));
  the rebut-specific affordance consumes the same hook so the
  timeout text is inherited transparently.

**Total new keys: 4** (consistent with the predecessor's count of
4, per the orchestrator's i18n-pattern guidance).

### Files this task touches (explicit allowlist)

- `apps/moderator/src/graph/RebutEdgePreCommitAffordance.tsx` (new file).
- `apps/moderator/src/graph/RebutEdgePreCommitAffordance.test.tsx` (new file).
- `apps/moderator/src/graph/StatementEdge.tsx` (modified — role-discriminator
  switch around the existing substance affordance mount).
- `apps/moderator/src/graph/StatementEdge.test.tsx` (modified — new
  cases asserting the switch on rebut vs non-rebut roles).
- `packages/i18n-catalogs/src/catalogs/en-US.json` (modified — 4 new keys).
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` /
  `es-419.json` (modified — same).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` /
  `es-419.review.json` (modified — 4 PENDING entries per locale).
- `tests/e2e/moderator-capture.spec.ts` (modified — extend the
  F6 capture-defeater `test.describe` with the substance-precommit
  block).

### Files this task does NOT touch

- `.tji` files — `complete 100` for `mod_defeater_substance_precommit`
  lands at task-completion time per the README ritual. The Closer
  also adds the new `i18n_rebut_edge_pre_commit_native_review` task
  to `tasks/35-frontend-i18n.tji` per tech-debt registration AND
  evaluates milestone propagation in `tasks/99-milestones.tji` (this
  is the last leaf of `mod_defeater_flow`).
- `docs/adr/` — no new ADR (Decision §D9).
- `apps/server/src/` — no server-side change. The propose-handler
  arm for set-edge-substance is already in place and accepts the
  substance-only re-vote shape against an extant rebut edge with
  shape facet `'agreed'`/`'committed'`.
- `packages/shared-types/src/events/proposals.ts` — schema unchanged.
- `apps/moderator/src/stores/captureStore.ts` — no captureStore slice
  change. The capture-defeater state slices are entirely owned by
  the predecessors; this task operates after `exitCaptureDefeaterMode`
  has fired.
- `apps/moderator/src/layout/useProposeSetEdgeSubstanceAction.ts` —
  unchanged. The new affordance consumes the existing per-edge hook
  via the same `(edgeId)` interface the generic affordance uses.
- `apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx` —
  unchanged. The generic affordance continues to mount on non-rebut
  edges (and on rebut edges whose shape isn't yet settled — i.e.,
  never, since the gate eliminates that case).
- `tests/behavior/methodology/defeater-capture.feature` /
  `tests/behavior/steps/methodology-defeater-capture.steps.ts` —
  unchanged. The engine-side pin already covers the propose +
  projection behavior this task's UI envelope produces.
- `apps/moderator/src/layout/useProposeSetNodeSubstanceAction.ts` /
  `apps/moderator/src/graph/NodeCardSubstanceAffordance.tsx` —
  unchanged. Y's substance is NOT proposed by this task (Decision §D5).

### Build / type / test gates

- `pnpm run check` clean (lint + format + typecheck).
- `pnpm run test:smoke` green; the moderator-workspace test count
  rises by the new Vitest cases (≥ 7 across the new test file +
  the extended `StatementEdge.test.tsx`).
- `pnpm --filter @a-conversa/i18n-catalogs run check` (parity
  check) green after the catalog edits.
- `pnpm -F @a-conversa/moderator build` succeeds.
- `pnpm exec playwright test` green; the new
  capture-defeater-substance-precommit e2e scenario passes.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after the
  Closer adds `complete 100` on `mod_defeater_substance_precommit`
  AND the new `i18n_rebut_edge_pre_commit_native_review` task
  block AND propagates the milestone marker if this leaf closes
  `mod_defeater_flow` / its parent milestone.

### UI-stream e2e scoping (per ORCHESTRATOR.md)

The full F6 step-4 flow is reachable from a real user flow as of
this task: log in → create session → seed node X → enter capture-
defeater mode on X → capture Y + rebut edge (step 3) → vote and
commit the rebut edge's shape facet via the existing shape-commit
affordance → the new `<RebutEdgePreCommitAffordance>` mounts on
the rebut edge → click "Pre-commit as agreed" → vote and commit
the substance facet → assert end state. Per the UI-stream e2e
default, the Playwright spec is **scoped under Acceptance criteria,
NOT deferred** (see § 5). No prior refinement has deferred F6
step-4 coverage against a future Playwright task; the engine-side
behavior is the only sub-system with a sibling pin, and that pin
is the Cucumber + Vitest pair already in place.

## Acceptance criteria

### 1. `<RebutEdgePreCommitAffordance>` component

- Accepts a single `edgeId: string` prop; renders unconditionally
  (the visibility gate is `<StatementEdge>`'s responsibility).
- Container has `data-testid="rebut-edge-pre-commit-affordance-${edgeId}"`,
  `data-edge-id={edgeId}`, and `data-rebut="true"`.
- Renders the hint paragraph above the button row with
  `data-testid="rebut-edge-pre-commit-hint-${edgeId}"` and text from
  `moderator.rebutEdgePreCommit.hint`.
- Renders two buttons in order
  (`agreed`, `disputed`) each with:
  - `data-testid="rebut-edge-pre-commit-button-${edgeId}-${value}"`.
  - `data-value={value}`.
  - Label from `moderator.rebutEdgePreCommit.valueButton.${value}`.
  - `aria-label` from
    `moderator.rebutEdgePreCommit.valueButtonAriaLabel` with
    `{ label }` ICU substitution.
- Click on a value button:
  1. Calls `event.stopPropagation()` (prevents canvas selection
     bubbling).
  2. Calls `useProposeSetEdgeSubstanceAction(edgeId).propose(value)`
     via the ref-stable proposeRef.
- `disabled={inFlight}` on both buttons (hook's per-edge `inFlight`
  boolean).
- Renders inline `[role="alert"]` error region when
  `lastError !== undefined`, with
  `data-testid="rebut-edge-pre-commit-error-${edgeId}"`,
  `data-error-code={lastError.code}`, and `lastError.message` text.

### 2. `<StatementEdge>` switch

- When `showSubstanceAffordance && edge.role === 'rebuts'`:
  `<RebutEdgePreCommitAffordance>` renders inside the edge label
  container; `<EdgeCardSubstanceAffordance>` does NOT render.
- When `showSubstanceAffordance && edge.role !== 'rebuts'` (e.g.,
  `'supports'`, `'amends'`, `'decomposes-into'`): the existing
  `<EdgeCardSubstanceAffordance>` renders; `<RebutEdgePreCommitAffordance>`
  does NOT render.
- When `!showSubstanceAffordance`: neither renders (predicate
  unchanged).

### 3. Wire envelope

- Clicking the `'agreed'` button on the rebut affordance calls
  `client.send('propose', envelope)` exactly once with a payload
  whose `proposal` is:
  ```ts
  {
    kind: 'set-edge-substance',
    edge_id: <the rebut edge id>,
    value: 'agreed',
  }
  ```
  (No endpoint carriage — substance-only re-vote shape per
  Decision §D6.)
- Clicking the `'disputed'` button produces the same payload with
  `value: 'disputed'`.
- The envelope's `sessionId` and `expectedSequence` are populated
  by `useProposeSetEdgeSubstanceAction` per its existing posture
  (L196–201 of the hook).
- On `client.send` resolving successfully: `inFlight` flips back to
  `false`; `lastError` is cleared; the affordance's buttons re-enable.
- On `client.send` rejecting with a `WsRequestError`: `inFlight`
  flips back to `false`; `lastError` is `{ code, message }` from the
  error; the inline error region surfaces with the message text.
- On `client.send` timing out with a `WsRequestTimeoutError`:
  `lastError` is `{ code: 'timeout', message: <localized timeout text> }`
  with the timeout text from
  `moderator.setNodeSubstanceAction.errorBanner.timeout`.

### 4. Vitest cases (per ADR 0022)

Minimum 7 new cases across the new + extended test files:

**`apps/moderator/src/graph/RebutEdgePreCommitAffordance.test.tsx`** (new file, ≥ 5 cases):

1. Renders the hint paragraph + two buttons in the canonical order
   (`agreed` first, `disputed` second) with localized labels.
2. Clicking `agreed` calls `useProposeSetEdgeSubstanceAction(edgeId).propose('agreed')`
   exactly once, with `stopPropagation` invoked on the click event.
3. Clicking `disputed` calls `propose('disputed')`; symmetric to (2).
4. When `inFlight === true`, both buttons are `disabled`; the
   inline error region remains absent if `lastError` is undefined.
5. When `lastError !== undefined`, the inline error region renders
   with `role="alert"`, `data-error-code`, and the error message
   text; the next successful `propose` clears it (re-render with
   `lastError === undefined`).

**`apps/moderator/src/graph/StatementEdge.test.tsx`** (extended, ≥ 2 cases):

6. Edge with `role === 'rebuts'` AND shape settled AND substance
   awaiting-proposal: `<RebutEdgePreCommitAffordance>` renders;
   `<EdgeCardSubstanceAffordance>` does NOT.
7. Edge with `role === 'supports'` (or other non-rebut role) AND
   shape settled AND substance awaiting-proposal: the generic
   `<EdgeCardSubstanceAffordance>` renders;
   `<RebutEdgePreCommitAffordance>` does NOT. (Regression pin: the
   switch does not change behavior for non-rebut edges.)

### 5. Playwright e2e (extend `moderator-capture.spec.ts`)

Add a new `test()` under the existing F6 `test.describe` (or
sibling to the `mod_defeater_node_creation` block):

```ts
test('F6 step 4: pre-commit rebut edge substance as agreed', async ({ page }) => {
  // 1. Setup: login + create session + seed node X (reuse the
  //    predecessor test block's setup helpers).

  // 2. Run the F6 step-3 path (right-click X → "Capture defeater" →
  //    type wording → click "Capture defeater"). After this, the
  //    canvas shows Y + the rebut edge in proposed shape state.

  // 3. Vote on the rebut edge's shape facet through the
  //    shape-commit affordance + commit. Use the existing
  //    EdgeShapeCommitAffordance test-id pattern.
  //    (After commit, the rebut edge's shape facet is 'committed'.)

  // 4. Assert the rebut affordance is now mounted on the rebut edge.
  const rebutEdgeId = await page.locator('[data-edge-role="rebuts"]')
    .first().getAttribute('data-edge-id');
  await expect(
    page.getByTestId(`rebut-edge-pre-commit-affordance-${rebutEdgeId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`rebut-edge-pre-commit-hint-${rebutEdgeId}`),
  ).toContainText('Pre-commit'); // English fixture run

  // 5. Click "Pre-commit as agreed".
  await page.getByTestId(
    `rebut-edge-pre-commit-button-${rebutEdgeId}-agreed`,
  ).click();

  // 6. Assert the rebut edge's substance facet moves to 'proposed'
  //    state (a proposal lands in the pending-proposals pane).
  await expect(
    page.locator(`[data-edge-id="${rebutEdgeId}"] [data-substance-facet-status]`),
  ).toHaveAttribute('data-substance-facet-status', 'proposed');

  // 7. Run the standard substance-facet vote + commit cycle through
  //    the existing per-facet vote / commit UI.

  // 8. Assert the end state: the rebut edge's substance facet is
  //    'agreed'; the affordance unmounts (substance is no longer
  //    awaiting-proposal); the defeater node Y's substance facet
  //    remains 'proposed' (no active gesture in this task — per
  //    Decision §D5).
  await expect(
    page.locator(`[data-edge-id="${rebutEdgeId}"] [data-substance-facet-status]`),
  ).toHaveAttribute('data-substance-facet-status', 'agreed');
  await expect(
    page.getByTestId(`rebut-edge-pre-commit-affordance-${rebutEdgeId}`),
  ).toHaveCount(0);
});
```

The spec exercises the full F6 step-4 chain at the UI layer; the
engine-side projection behavior (firing predicate, end-state Y
substance status `'proposed'`, edge inert) is pinned by the
existing Cucumber scenarios.

### 6. WBS updates (per `tasks/refinements/README.md` ritual)

- `tasks/30-moderator-ui.tji`: `mod_defeater_substance_precommit`
  block gets `complete 100` after the `allocate team` line plus a
  `note "Refinement: tasks/refinements/moderator-ui/mod_defeater_substance_precommit.md"`
  line.
- `tasks/35-frontend-i18n.tji`: a new task block
  `i18n_rebut_edge_pre_commit_native_review` is added (effort
  0.5d; `depends !<current tail of the native-review chain>` —
  Closer reads the tail at register time).
- `tasks/99-milestones.tji`: if this leaf closes `mod_defeater_flow`
  (it does — it is the last of three siblings, and the prior two
  are at `complete 100`) and the parent milestone depends on the
  flow, the Closer adds `complete 100` to the milestone per the
  README ritual.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

New native-review task template (Closer registers mechanically):

```
task i18n_rebut_edge_pre_commit_native_review "Native-speaker review of pt-BR + es-419 rebut-edge-pre-commit strings (4 keys: moderator.rebutEdgePreCommit.{hint,valueButton.agreed,valueButton.disputed,valueButtonAriaLabel})" {
  effort 0.5d
  allocate team
  depends !<current native-review tail>
  note "Source of debt: mod_defeater_substance_precommit (this commit) — pt-BR and es-419 drafts of the 4 new keys landed flagged PENDING in the *.review.json trackers; replace with native-speaker-reviewed text and sign off the review trackers. UI prose translation (methodology-flavored substance affordance hint + button labels). Check the 'pre-commit' / 'pré-comprometer' / 'pre-comprometer' framing matches the existing capture-defeater strings (moderator.captureDefeater.*) for tone consistency."
  note "Surfaced via tech-debt registration policy in ORCHESTRATOR.md."
}
```

### 7. Build / type / test gates

All gates listed under "Build / type / test gates" pass.

## Decisions

### D1. Scope: methodology-flavored affordance on rebut edges; no new wire path

This task adds ONE new UI surface (`<RebutEdgePreCommitAffordance>`)
mounted by `<StatementEdge>` only on rebut edges. It does NOT add a
new propose hook, schema, or envelope shape — the wire path is the
substance-only re-vote arm of `set-edge-substance` shipped by
`mod_set_edge_substance_endpoint_carriage`. The methodology-prescribed
"pre-commit as agreed" gesture is the existing per-edge propose
with `value: 'agreed'`; the new affordance just reframes the
gesture's UI surface in F6-flow language.

Considered alternatives:

- **(a) Ship NOTHING new at the UI layer.** The existing
  `<EdgeCardSubstanceAffordance>` already mounts on rebut edges in
  F6-step-4 state and already lets the moderator pick `'agreed'`.
  Methodology-flavored framing could be deferred. *Rejected.* The
  task's title explicitly names "Pre-commit edge substance as
  agreed" — a methodology-prescribed gesture deserves a methodology-
  flavored surface for discoverability. Pinning the engine-side
  behavior is not enough; the user needs to know that the
  moderator's F6 step 4 is THIS click on the rebut edge.
- **(b) Add a dedicated propose action component on the bottom strip**
  (a "Pre-commit rebut substance" button outside the canvas).
  *Rejected.* The button would need to identify the rebut edge by
  some mechanism (Decision §D5 below covers why projection lookup
  is the wrong abstraction); per-edge affordances mounted on the
  canvas are the established pattern from `pf_mod_edge_card_substance_affordance`.
- **(c) Auto-fire propose-set-edge-substance(agreed) from
  `useProposeCaptureDefeaterAction`'s success path** (chained
  envelope from step 3). *Rejected* — the server's shape-facet
  gate (propose.ts L1653–1660) rejects substance proposals against
  an unsettled shape facet. The natural sequencing — a vote+commit
  round on the rebut edge's shape between step 3 and step 4 — is
  the existing UX (Decision §D7).
- **(d) A defeater-flavored affordance mounted alongside the
  generic affordance (both visible at once).** *Rejected.* Two
  affordances on the same edge label is visually noisy and
  confusing; the role-discriminator switch (one OR the other,
  never both) is cleaner.
- **(e) A defeater-flavored affordance replacing the generic on
  rebut edges, sharing the wire hook unchanged.** **Chosen.**
  Reframes the UI surface for F6 step 4 without duplicating wire
  infrastructure; the disputed button is preserved (Decision §D4).

### D2. Reuse `useProposeSetEdgeSubstanceAction(edgeId)` unchanged

The existing per-edge propose hook already produces the exact wire
envelope F6 step 4 needs:
`{ kind: 'set-edge-substance', edge_id, value }` (substance-only
re-vote shape, no endpoint carriage). Its per-edge keying via
`useSetEdgeSubstanceStore` means two affordances on two different
rebut edges observe disjoint in-flight + error state for free.

Considered alternative: a new `useProposeDefeaterPreCommitAction()`
that pre-binds `value: 'agreed'` and exposes a single
`propose(): Promise<void>` callback. *Rejected* — the new affordance
preserves the disputed button (Decision §D4), so a single-value
hook would be too narrow; using the existing two-value hook keeps
the symmetry with the generic affordance and avoids a third
parallel wire seam.

### D3. New `<RebutEdgePreCommitAffordance>` distinct from `<EdgeCardSubstanceAffordance>`

Considered alternatives:

- **(a) Parameterize `<EdgeCardSubstanceAffordance>`** with optional
  hint-text + custom-label props, swap props based on edge role.
  *Rejected.* The generic affordance is used for ALL edges
  (supports, rebuts, decomposes-into, amends, etc.); adding
  per-role parameterization couples the generic component to F6
  flow specifics. Every future role-specific affordance (e.g., F8
  meta-move's reframe) would add another parameter set.
- **(b) Distinct `<RebutEdgePreCommitAffordance>` thin wrapper.**
  **Chosen.** Mirrors the prior single-role per-affordance pattern;
  the wrapper is ~50 lines including imports. `<StatementEdge>`'s
  role-discriminator switch keeps the generic affordance pure for
  the non-rebut path. A future de-duplication (e.g., a `<SubstanceAffordanceBase>`
  shared by generic + rebut + future role-specific variants) is
  available as a refactor when a third per-role variant lands.

### D4. Preserve the disputed button — do NOT ship a single-button affordance

Methodology recommends `agreed` for F6 step 4, but a moderator who
rejects the participant's pre-commit framing must retain the option
to surface that disagreement. The generic two-button picker
(`agreed` / `disputed`) is the right shape for the substance-proposal
gesture regardless of edge role. The methodology framing is in the
button LABELS + the hint paragraph, not in removing options.

Considered: shipping a one-button affordance (`'agreed'` only) on
rebut edges, with disputed available only via a context-menu
fallback. *Rejected.* The "make the recommended path easier"
ergonomics argument is real, but burying disputed in a context
menu adds discoverability friction for a legitimate gesture. The
two-button picker with prominent `agreed` framing achieves the
same ergonomic goal without removing the disputed path.

### D5. No automatic "find the rebut edge" lookup — natural canvas selection is the UI seam

Predecessor `mod_defeater_node_creation` Decision §D6 noted: "This
task does NOT pre-stash the rebut edge id — the sibling task reads
it from the projection by the standard 'find the edge whose source
= Y, target = X, role = 'rebuts', substance = awaiting-proposal'
predicate, or via a transient capture-store slice the sibling adds."

This task chose **neither** of those alternatives. The natural UI
seam is canvas selection: the moderator looks at the canvas, sees
the new rebut edge with the (now methodology-flavored) substance
affordance, and clicks. The per-edge affordance is keyed by the
edge id at mount time — `<StatementEdge>` passes `id` as a prop, so
the affordance always knows which edge it operates on.

Considered alternatives:

- **(a) A `pendingDefeaterPreCommit` transient capture-store slice**
  populated by `useProposeCaptureDefeaterAction` on success,
  consumed by a bottom-strip "Pre-commit rebut substance" button.
  *Rejected.* The slice would need to be populated BEFORE
  `exitCaptureDefeaterMode()` fires — modifying the predecessor's
  shipped hook. Even if we wrap it in a new hook, the bottom-strip
  surface is the wrong abstraction (Decision §D1 alt (b)).
- **(b) A `findRecentRebutEdge(projection)` selector** that walks
  the projection looking for the most recent rebut edge in
  awaiting-proposal substance authored by the current moderator.
  *Rejected.* The predicate is non-deterministic — if the moderator
  captured TWO defeaters in succession, the lookup ambiguously
  picks one. Per-edge canvas affordances avoid this entirely.
- **(c) Per-edge affordance mounted by `<StatementEdge>`** that
  inherits the edge id from the mount context. **Chosen.** Zero
  state, zero predicate ambiguity, leverages the existing
  ReactFlow integration.

### D6. Wire shape: substance-only re-vote (no endpoint carriage)

The `setEdgeSubstanceProposalSchema` has two arms (per
`mod_set_edge_substance_endpoint_carriage`):

- **(a) Endpoint-carriage shape** —
  `{ edge_id, value, source_node_id, target_node_id, role }` — for
  proposing substance on a FRESH edge the propose handler will mint
  alongside the proposal (server emits `edge-created` +
  `entity-included(edge)` + `proposal`).
- **(b) Substance-only re-vote shape** — `{ edge_id, value }` — for
  an extant edge already in projection.

F6 step 4 uses **(b)**. The rebut edge already exists in projection
from step 3's propose-time `edge-created` emission (per ADR 0027);
the substance-only shape applies. The existing
`useProposeSetEdgeSubstanceAction(edgeId)` already builds shape (b)
unchanged.

Considered alternative: use shape (a) and re-mint the rebut edge as
a fresh-edge propose carriage (bypassing the shape-facet gate).
*Rejected* — would create a duplicate rebut edge Y→X; the step-3
edge already lives in projection.

### D7. Architectural sequencing — shape facet commit between step 3 and step 4

The propose-handler's existing-edge arm refuses
`set-edge-substance` against an edge whose shape facet is not
`'agreed'`/`'committed'` (per
[propose.ts L1635–1660](../../../apps/server/src/methodology/handlers/propose.ts#L1635)).
After step 3's `capture-node`-with-edge propose, the rebut edge's
shape facet enters `'awaiting-proposal'` (the carriage is its
candidate, awaiting vote per ADR 0030 §5). Step 4's propose
therefore cannot fire in the same round as step 3.

The natural sequencing — the moderator drives the rebut edge's
shape facet through vote + commit (via the existing
`<EdgeShapeCommitAffordance>` at
[StatementEdge.tsx L306](../../../apps/moderator/src/graph/StatementEdge.tsx#L306))
BETWEEN steps 3 and 4 — is the existing UX. The UI mirrors the
server gate on the affordance: `<StatementEdge>` L160's
`showSubstanceAffordance` predicate requires
`isShapeSettled && substanceStatus === 'awaiting-proposal'`. The
new rebut affordance is mounted by the same predicate, so it
becomes visible only after the moderator commits the shape facet.

Considered alternatives:

- **(a) Auto-fire the substance propose immediately after step 3
  in the same round.** *Rejected* — server rejects (shape gate),
  and even if it didn't, the UX skips the participants' shape-vote
  ratification of the rebut's structural shape.
- **(b) Have the rebut affordance surface a "waiting for shape
  commit" hint until shape settles.** *Considered for future polish*
  but rejected as over-engineering for v1. The existing
  shape-commit affordance is already prominent on the same edge
  label; a moderator who's in F6 will see it.
- **(c) Inherit the existing affordance gate predicate** unchanged.
  **Chosen.** The strict gate (`isShapeSettled && substance ===
  'awaiting-proposal'`) already pins the UI to the server's
  authoritative sequencing; reusing it keeps the visibility logic
  one-for-one with the server boundary (the same reason the gate
  was tightened in the per-facet refactor — see
  `pf_mod_facet_name_widen_shape`).

### D8. Cross-module key reuse to keep the new-key count at 4

The new affordance shares the wire hook with the generic affordance,
so it inherits the error-region label + the timeout fallback text
for free:

- **Wire-error inline-region role label reuses
  `moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel`**
  — the generic affordance already consumes this key
  ([EdgeCardSubstanceAffordance.tsx L167](../../../apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx#L167)).
  Same shape, same prefix wording. Consistent with ADR 0024's
  "reuse before mint" principle.
- **Wire-timeout fallback message reuses
  `moderator.setNodeSubstanceAction.errorBanner.timeout`** — the
  hook routes through this key at L215 of
  `useProposeSetEdgeSubstanceAction.ts`. The new affordance
  consumes the same hook, so the timeout message is inherited
  transparently.

**Total new keys: 4** (matches the per-task i18n cadence the
predecessor refinements established).

### D9. No new ADR

Five potential triggers, all dispatched:

- **"A rebut-specific affordance variant is ADR-worthy."** No —
  the role-discriminator switch is a localized UI choice; no
  cross-cutting architectural seam is introduced. The generic
  affordance + the new variant share the wire hook unchanged.
- **"Pinning F6's step-4 UI path is ADR-worthy."** No — the
  methodology + projection + engine pin (Cucumber + Vitest) are
  already in place; this task adds the UI layer that completes
  the existing contract.
- **"The shape-facet gate-then-substance sequencing is ADR-worthy."**
  No — ADR 0030 §1 + §8 + §10 already cover the per-facet
  sequence and the gate behavior; the per-facet refactor chain
  pinned the moderator's facet-status mirror.
- **"Reusing the substance-only re-vote shape for F6 step 4 is
  ADR-worthy."** No — `mod_set_edge_substance_endpoint_carriage`
  already settled the two-arm contract; F6 step 4 is one more
  call site for arm (b), explicitly anticipated by the
  propose-handler doc-block at L1644–1652.
- **"Preserving the disputed button on the methodology-flavored
  affordance is ADR-worthy."** No — preserving moderator
  optionality is a UX choice, not an architectural one; the
  decision rationale lives in §D4 of this refinement and is the
  appropriate level of granularity.

The architectural choices this task implements were all settled by
prior tasks or are localized implementation details.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-31.

- `apps/moderator/src/graph/RebutEdgePreCommitAffordance.tsx` (new) — methodology-flavored substance affordance for rebut edges; renders hint paragraph + two-button picker (`agreed`/`disputed`), reuses `useProposeSetEdgeSubstanceAction(edgeId)` unchanged.
- `apps/moderator/src/graph/RebutEdgePreCommitAffordance.test.tsx` (new) — 5 Vitest cases covering render, click dispatch (agreed + disputed), in-flight disabled state, and error region.
- `apps/moderator/src/graph/StatementEdge.tsx` (modified) — role-discriminator switch: when `showSubstanceAffordance && edge.role === 'rebuts'` renders `<RebutEdgePreCommitAffordance>`; otherwise the existing `<EdgeCardSubstanceAffordance>`.
- `apps/moderator/src/graph/StatementEdge.test.tsx` (modified) — 3 new cases covering rebut-role switch, non-rebut regression pin, and a third switch case.
- `packages/i18n-catalogs/src/catalogs/en-US.json` / `pt-BR.json` / `es-419.json` (modified) — 4 new `moderator.rebutEdgePreCommit.*` keys per locale.
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` / `es-419.review.json` (modified) — 4 PENDING entries each for native-speaker review.
- `tests/e2e/moderator-capture.spec.ts` (modified) — new F6-step-4 baseline test; full shape-vote+commit → rebut-affordance → substance-vote+commit chain is `test.skip` pending `seedWsStore` facet-event synthesis (tracked as `playwright_f6_substance_precommit_full_chain`).
- Verification: `pnpm run check`, `pnpm run test:smoke`, `pnpm run test:behavior:smoke`, `make test:e2e:compose` — all green (driver-run, deterministic chain).
