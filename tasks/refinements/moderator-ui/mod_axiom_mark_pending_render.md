# Moderator pending axiom-mark decoration (proposed-state axiom dot before commit)

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_axiom_mark_flow.mod_axiom_mark_pending_render`.

```
task mod_axiom_mark_pending_render "Pending axiom-mark decoration" {
  effort 0.5d
  allocate team
  depends !mod_axiom_mark_action
}
```

## Effort estimate

**0.5d.** Confirmed. This is the **last open leaf of `mod_axiom_mark_flow`** —
closing it derives-completes the F5 subgroup. The work is small: the committed-
side rendering already lands the badge surface (`mod_axiom_mark_decoration`
complete 100 — `AxiomMarkBadge` + `projectAxiomMarks` + per-participant color
palette + `data-participant-id` / `axiom-mark-badge-{nodeId}-{participantId}`
testid seams), so this task adds **one parallel projection helper** (pending
proposals + counter-proposals filter), **one parallel render row** on the node
card (above the committed-marks row), and **one ICU substitution** on the
existing `methodology.axiomMark` namespace (new keys: `pendingTooltip` /
`pendingSrLabel`). The proposed-state visual language is already pinned by
`mod_proposed_state_styling` (dashed border + faded fill) and
`mod_per_facet_state_visualization`'s `PILL_STATUS_CLASSNAME['proposed']`
(`border-dashed border-slate-400 text-slate-500 opacity-60`); this task mirrors
the same dashed-faded contract on the axiom-mark dot.

Concretely the deliverable is:

- **One new selector** `projectPendingAxiomMarks(events) → PendingAxiomMark[]`
  added to `apps/moderator/src/graph/selectors.ts` alongside the existing
  `projectAxiomMarks`. Walks the event log once: for each `proposal` event with
  inner `kind: 'axiom-mark'`, records `(proposalEventId, nodeId, participantId,
  proposedAt)`; on each `commit` / `meta-disagreement-marked` event referencing
  one of those proposal ids, removes it (mirrors `derivePendingProposals`'s
  terminator handling). The surviving set is the **pending** axiom-marks.
- **One new bucketing helper** `groupPendingAxiomMarksByNode(marks) → Map<string,
  PendingAxiomMark[]>` — same shape as `groupAxiomMarksByNode`.
- **`StatementNodeData` extension** — adds `pendingAxiomMarks: readonly
  PendingAxiomMark[]` (default `EMPTY_PENDING_AXIOM_MARKS`).
- **`projectNodes` enrichment** in `GraphCanvasPane.tsx` — does a single up-front
  pass `groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events))` and
  attaches each node's matching subset.
- **One new component** `apps/moderator/src/graph/PendingAxiomMarkBadge.tsx` —
  mirrors `AxiomMarkBadge` (same rounded-square shape, same per-participant
  color palette via `axiomMarkColorFor`, same centered "A" glyph) but with the
  proposed-state styling applied (`border-dashed border-slate-400 opacity-60`
  composed with the participant color ring; the participant-color background
  stays so per-participant attribution remains visible at a glance). Localized
  tooltip + aria-label use the new `methodology.axiomMark.pendingTooltip` /
  `pendingSrLabel` keys with ICU `{participantId}` substitution.
- **`StatementNode` render-row extension** — adds a `pending-axiom-mark-list-
  node-{id}` decoration row IMMEDIATELY ABOVE the existing
  `axiom-mark-list-node-{id}` row (rationale Decision §4: pending marks read
  visually as "the dots that will fill in" — they sit above the committed
  marks so the eye scans "what is being proposed" before "what is on record").
- **Two new i18n catalog keys** under `methodology.axiomMark.*` in all three v1
  catalogs (en-US / pt-BR / es-419):
  - `methodology.axiomMark.pendingTooltip` — `"Pending axiom mark by
    {participantId}"` / `"Marca de axioma pendente por {participantId}"` /
    `"Marca de axioma pendiente por {participantId}"`.
  - `methodology.axiomMark.pendingSrLabel` — `"Pending axiom mark from
    participant {participantId} — not yet committed"` / pt-BR / es-419 drafts.
- **One follow-up native-review task** registered in `tasks/35-frontend-i18n.tji`
  — `i18n_axiom_mark_pending_render_native_review` (effort 0.5d, `depends
  !i18n_axiom_mark_action_native_review` — tail of the existing native-review
  chain).
- **Vitest cases**: `selectors.test.ts` extended with pending-axiom-mark
  selector + bucketing cases; new `PendingAxiomMarkBadge.test.tsx`;
  `StatementNode.test.tsx` extended with pending-row rendering + ordering
  cases; `GraphCanvasPane.test.tsx` extended with the projection-enrichment
  cases.
- **One new Playwright e2e block** under `tests/e2e/moderator-capture.spec.ts`
  — uses the same `__aConversaWsStore` seed seam the predecessor's e2e cover
  uses (Decision §7): seeds a node + a *participant-as-actor* axiom-mark
  proposal directly into the WS store (the predecessor's moderator-driven
  envelope can't produce a pending state in v1 — engine rule 3 always
  rejects), then asserts the pending badge surfaces on the node card with
  the correct `data-pending="true"` attribute.

## Inherited dependencies

Settled (this task plugs into pre-existing seams without changing their public
contracts):

- **`moderator_ui.mod_axiom_mark_flow.mod_axiom_mark_action`** (parent dep —
  done — 2026-05-16, commit `5a9b6de`). Lands the moderator-side action that
  builds the propose envelope. Two relevant inheritances:
  1. The `useAxiomMarkAction` hook + the `AxiomMarkSubmenu` component
     produce `propose` envelopes with `proposal: { kind: 'axiom-mark', node_id,
     participant }`. Those envelopes are STRUCTURALLY correct end-to-end against
     the WS, but the moderator-side action ALWAYS hits engine rule 3
     (`axiom-mark-not-self`) per the predecessor's Status block + Decision §1c
     — so **no pending axiom-mark ever lands in the projection from the
     moderator-side flow in v1.**
  2. The submenu's inline `notSelf` error message already surfaces the rule-3
     rejection to the moderator. This task does NOT replicate that surface;
     the pending render is for the *participant-driven* path that will
     eventually let debaters propose their own axiom-marks.

- **`moderator_ui.mod_graph_rendering.mod_axiom_mark_decoration`** (done —
  2026-05-11). The committed-side badge surface this task mirrors. Pinned
  contributions reused here:
  - `AxiomMark` interface shape (`{ nodeId, participantId, committedAt }`) and
    the parallel `projectAxiomMarks` / `groupAxiomMarksByNode` selector pair.
    The pending selector mirrors the shape exactly (substituting `proposedAt`
    for `committedAt`) so the two render paths share the same per-node
    enrichment style.
  - `axiomMarkColorFor(participantId)` deterministic 6-bucket hash. The
    pending badge reuses this verbatim — same participant gets the same color
    on both their pending and their committed marks, so the visual transition
    "pending → committed" is "dashed-faded dot → solid dot of the same color"
    rather than a color shift (color is a stable participant-identity property
    per `mod_axiom_mark_decoration` Decision §"Per-participant color via
    deterministic hash").
  - `AXIOM_MARK_PALETTE` and the rounded-square shape (`rounded-sm`) +
    centered "A" glyph + ring-1 halo. The pending badge keeps every visual
    constant EXCEPT the dashed-border + opacity-60 overlay (Decision §3
    records the styling delta).
  - `data-testid="axiom-mark-badge-{nodeId}-{participantId}"` and
    `data-participant-id="{participantId}"` seams. The pending badge uses
    PARALLEL testids (`pending-axiom-mark-badge-…` — Decision §5 records the
    distinct-testid choice) so tests can target pending vs committed without
    DOM-walking, but keeps `data-participant-id` for per-participant selector
    parity.

- **`moderator_ui.mod_graph_rendering.mod_proposed_state_styling`** (done —
  2026-05-11). Pinned the proposed-state visual contract: dashed border +
  faded fill (60% opacity) for in-flight entities. This task mirrors that
  contract on the per-participant dot.

- **`moderator_ui.mod_graph_rendering.mod_per_facet_state_visualization`**
  (done — 2026-05-11). Exports `PILL_STATUS_CLASSNAME` with the canonical
  proposed-status string (`border-dashed border-slate-400 text-slate-500
  opacity-60`). The pending badge does NOT reuse this constant directly
  (Decision §3: the pill is a text chip; the axiom dot is a colored square,
  so only the border-dashed + opacity-60 portion transfers) but the visual
  vocabulary is consistent — a moderator who has internalized "dashed = not
  yet committed" reads pending axiom-marks correctly on first glance.

- **`data_and_methodology.methodology_engine.axiom_mark_logic`** (done —
  2026-05-10). The propose-side validator. Rule 3 (participant-equals-
  requester → `'axiom-mark-not-self'`) is load-bearing here: it is WHY the
  moderator-side path can't produce a pending axiom-mark in v1, and WHY
  this task's e2e cover must inject the proposal directly into the WS
  store rather than driving it through the moderator-side action chain
  (Decision §7).

- **`frontend_i18n.i18n_methodology_glossary`** (done). The
  `methodology.axiomMark.*` namespace already carries `label` / `tooltip` /
  `srLabel` keys for the committed badge. This task EXTENDS the same
  namespace with `pendingTooltip` / `pendingSrLabel` (Decision §6 — same
  namespace, parallel keys, not a separate `pendingAxiomMark.*` namespace).

Pending (none — every gating dep is done).

## What this task is

Render **pending** axiom-marks — proposed but not yet committed — as
proposed-state per-participant dots on the node card. The methodology
(`docs/methodology.md` §"Axioms / terminal values") models the axiom-mark
lifecycle as "proposed → committed by the moderator once everyone has
agreed"; the committed-side rendering (`mod_axiom_mark_decoration`) lands the
post-commit "Anna holds N9 as bedrock" badge. This task lands the pre-commit
"Anna is *proposing* to declare N9 her bedrock; the vote is in flight" visual,
mirroring the committed surface in every aspect EXCEPT the proposed-state
overlay (dashed border + faded opacity).

The task delivers:

- **`PendingAxiomMark` interface** at `apps/moderator/src/graph/selectors.ts` —
  parallel to `AxiomMark` but keyed on the proposal-event id rather than the
  commit-event id:
  ```ts
  export interface PendingAxiomMark {
    readonly proposalEventId: string;
    readonly nodeId: string;
    readonly participantId: string;
    readonly proposedAt: string;
  }
  ```
  `proposalEventId` is included so future per-row vote / tooltip detail tasks
  can join back to the proposal envelope without re-walking the log
  (mirrors `mod_axiom_mark_decoration` Decision: "carry `committedAt` so future
  per-mark sorting / tooltip-detail tasks have the timestamp without re-walking
  the log").

- **`projectPendingAxiomMarks(events) → PendingAxiomMark[]`** pure selector
  added to `selectors.ts`. Walks the log once. For each `proposal` event with
  inner `kind: 'axiom-mark'`, records `(eventId, nodeId, participantId,
  createdAt)` in a `Map<proposalEventId, …>`. For each `commit` or
  `meta-disagreement-marked` event whose `proposal_id` matches one of those
  proposal ids, removes the entry (the two terminators per
  `derivePendingProposals` Step 1). Returns the surviving entries in proposal-
  arrival order (the typical scenario: A proposes their axiom-mark, then B
  proposes theirs — A's pending dot renders first).

- **`groupPendingAxiomMarksByNode(marks) → Map<string, PendingAxiomMark[]>`**
  bucketing helper. Mirrors `groupAxiomMarksByNode` (same `Map` vs `Object`
  rationale: UUID keys + `O(1)` `get`).

- **`EMPTY_PENDING_AXIOM_MARKS`** module-scope frozen array exported alongside
  `EMPTY_AXIOM_MARKS` for stable-reference identity in the empty case.

- **`StatementNodeData` extension** — adds:
  ```ts
  readonly pendingAxiomMarks: readonly PendingAxiomMark[];
  ```
  Default `EMPTY_PENDING_AXIOM_MARKS` when no pending axiom-marks reference
  the node.

- **`projectNodes` enrichment** (`GraphCanvasPane.tsx`) — does a single up-
  front pass `groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events))`
  and reads `pendingIndex.get(nodeId) ?? EMPTY_PENDING_AXIOM_MARKS` to
  populate each emitted node's `data.pendingAxiomMarks`. Same pattern as
  the existing committed enrichment.

- **`PendingAxiomMarkBadge` component** at
  `apps/moderator/src/graph/PendingAxiomMarkBadge.tsx`:
  - Memo'd React component accepting `{ mark: PendingAxiomMark }`.
  - Per-participant color via `axiomMarkColorFor(mark.participantId)` —
    same palette / hash / bucket selection as the committed badge.
  - Renders a `<span>` with `role="img"`, the centered "A" glyph, the
    rounded-square shape (`rounded-sm h-5 w-5`), and the per-participant
    `bg-${color}-100 text-${color}-900 ring-${color}-300` triple.
  - Adds the proposed-state overlay: `border border-dashed
    border-slate-400 opacity-60`. The participant-color background +
    ring stay (so per-participant attribution is still readable through
    the fade); the dashed slate border + opacity overlay communicate
    "this is in flight." (Decision §3 records why this composition is
    preferred over a pure-grey badge.)
  - `data-testid="pending-axiom-mark-badge-{nodeId}-{participantId}"`,
    `data-participant-id="{participantId}"`,
    `data-pending="true"` (the new stable seam for "this is the pending
    variant, not the committed one" — Decision §5).
  - `title` and `aria-label` resolved via the new
    `methodology.axiomMark.pendingTooltip` / `pendingSrLabel` keys with
    ICU `{participantId}` substitution.

- **`StatementNode` render-row extension** — adds a new decoration row
  IMMEDIATELY ABOVE the existing committed `axiom-mark-list-node-{id}` row:
  ```tsx
  {pendingAxiomMarks.length > 0 ? (
    <div data-testid={`pending-axiom-mark-list-node-${id}`} className="mt-1 flex flex-wrap gap-1">
      {pendingAxiomMarks.map((mark) => (
        <PendingAxiomMarkBadge key={`${mark.proposalEventId}`} mark={mark} />
      ))}
    </div>
  ) : null}
  ```
  - Container omitted from the DOM when the list is empty (mirrors the
    existing committed / annotation / facet-pill row pattern — no empty
    container).
  - Key uses `proposalEventId` (NOT `participantId`) because — per Decision §2
    — a participant could in principle have multiple pending axiom-marks
    against the same node mid-test (the propose-side validator's rule 4
    only rejects when a *committed* duplicate exists; two pending proposals
    from the same participant on the same node both render as separate
    dots until the engine commits one).

- **Two new i18n catalog keys** under the existing `methodology.axiomMark.*`
  namespace in en-US / pt-BR / es-419:
  - `methodology.axiomMark.pendingTooltip` — `"Pending axiom mark by
    {participantId}"` / `"Marca de axioma pendente por {participantId}"` /
    `"Marca de axioma pendiente por {participantId}"`.
  - `methodology.axiomMark.pendingSrLabel` — `"Pending axiom mark from
    participant {participantId} — not yet committed"` /
    `"Marca de axioma pendente do participante {participantId} — ainda
    não confirmada"` / `"Marca de axioma pendiente del participante
    {participantId} — aún no confirmada"`.
  - pt-BR + es-419 drafts ride flagged PENDING in the existing
    `*.review.json` trackers per the catalog workflow.

- **One follow-up native-review task** registered in
  `tasks/35-frontend-i18n.tji`:
  `i18n_axiom_mark_pending_render_native_review` (effort 0.5d, `allocate
  team`, `depends !i18n_axiom_mark_action_native_review`). Source-of-debt
  + tech-debt-policy `note` lines per the existing native-review precedent.

- **Tests** (committed, per ADR 0022):
  - **Vitest** — `selectors.test.ts` extended with `projectPendingAxiomMarks`
    + `groupPendingAxiomMarksByNode` cases (empty log; one pending; one
    pending + one committed on same node; two pending from different
    participants on same node; commit-terminator removes entry;
    meta-disagreement-marked terminator removes entry; bucketing). New
    `PendingAxiomMarkBadge.test.tsx` (data-attribute seams; per-status
    classNames + proposed overlay; cross-locale tooltip / aria-label
    resolution). `StatementNode.test.tsx` extended with pending-row
    rendering + DOM-ordering cases (pending row above committed row).
    `GraphCanvasPane.test.tsx` extended with `projectNodes` enrichment
    cases (pending proposal in WS store enriches `data.pendingAxiomMarks`;
    committed proposal removes pending entry).
  - **Playwright e2e** — `tests/e2e/moderator-capture.spec.ts` extended
    with one new `test()` block (Decision §7). Seeds a node + a synthetic
    axiom-mark proposal whose `actor` is one of the seeded debaters'
    user ids (NOT the moderator's) into the WS store via the
    `__aConversaWsStore` seam — sidesteps the engine's rule 3 by
    bypassing the propose handler entirely (the seam injects directly
    into the projection-derived event list, so the moderator-UI render
    chain runs against a "what if rule 3 were lifted" event log). Asserts
    the `[data-pending="true"][data-participant-id="{seededDebaterId}"]`
    selector resolves on the node card. The test gates on
    `window.__aConversaWsStore` reachability identically to the
    predecessor's seeded-graph cases (`test.skip(true, …)` when the dev-
    only attachment hasn't fired).

This task is **rendering only**. The proposal-side action ships from the
predecessor (`mod_axiom_mark_action`); the participant-tablet action that
will *actually* produce pending axiom-marks in normal v1 use ships from
the participant-ui work-stream's `part_axiom_mark_from_tablet` task (M5
dep — see Decision §1).

## Why it needs to be done

Closing this task **derives-completes the `mod_axiom_mark_flow` subgroup** —
it is the last open leaf (the parent's three other tasks: `mod_axiom_mark_action`
done 2026-05-16, `mod_axiom_mark_decoration` done 2026-05-11, plus no other
siblings). The F5 axiom-mark capture flow's moderator surface is otherwise
complete; without the pending render the canvas surfaces an axiom-mark as a
binary event (nothing visible → committed badge appears) rather than the
methodology's actual three-stage lifecycle (nothing → proposed dot → committed
badge).

Two consumer trajectories drive the work even though the moderator-side action
can't reach the pending state in v1:

1. **Participant-tablet axiom-mark action.** The participant-ui work-stream's
   `part_axiom_mark_from_tablet` task (M5 dep) WILL produce real pending
   axiom-marks the moderator must see on their canvas. Without the pending
   render landing here, the participant's tablet would surface "I am
   proposing an axiom-mark" but the moderator's canvas would show nothing
   until the vote round completes and the commit lands. That mismatch
   defeats the F5 flow's "moderator-mediated agreement" framing — the
   moderator drives the commit decision, and they can only drive it if
   they see what's pending.

2. **Future relaxation of engine rule 3.** If a future ADR relaxes rule 3
   to let the moderator propose axiom-marks on behalf of debaters (with
   an attribution audit trail — flagged as a candidate evolution in
   `mod_axiom_mark_action` Decision §1c), the moderator-driven action
   ships pending axiom-marks immediately. The pending render needs to be
   in place before that relaxation lands, not after.

A third reason is the **visual completeness of the methodology's lifecycle
model on the moderator's canvas.** The committed-state badge currently
"appears from nowhere" once the commit lands; with this task, the
methodology's "proposed → committed" lifecycle for axiom-marks becomes
visible end-to-end as "dashed-faded dot → solid dot" — matching the
proposed-state visual vocabulary the moderator has already internalized
from the per-facet state-styling tasks (dashed border on the card frame +
dashed pill in the facet row both mean "in flight").

## Inputs / context

- [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md)
  — ReactFlow on the moderator surface; the custom node component is the
  explicit extension point for in-card decoration rows.
- [ADR 0021](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md)
  — the `Event` envelope's camelCased fields and the `proposal` payload's
  snake-cased `node_id` / `participant` for the axiom-mark sub-kind.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every
  empirical check ships as a committed Vitest case; the e2e cover ships as a
  committed Playwright spec.
- [ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) —
  every user-facing label resolves via `useTranslation` against the catalog
  namespace.
- [`docs/methodology.md`](../../../docs/methodology.md) §"Axioms / terminal
  values" lines 192–200 — "an axiom mark goes through the standard agreement
  lifecycle (proposed → committed by the moderator once everyone has agreed)."
  The proposed-state of the lifecycle is what this task surfaces.
- [`tasks/refinements/data-and-methodology/axiom_mark_logic.md`](../data-and-methodology/axiom_mark_logic.md)
  — the propose-side validator. Rule 3 is the load-bearing constraint that
  blocks the moderator-side path from producing a pending axiom-mark in v1
  (Decision §1).
- [`tasks/refinements/moderator-ui/mod_axiom_mark_action.md`](mod_axiom_mark_action.md)
  — the predecessor. The action that builds the propose envelope. The
  predecessor's Status block + Decision §1c explain why the moderator-driven
  path always errors with `axiom-mark-not-self` in v1.
- [`tasks/refinements/moderator-ui/mod_axiom_mark_decoration.md`](mod_axiom_mark_decoration.md)
  — the committed-side rendering this task mirrors. The 6-color palette +
  rounded-square shape + centered "A" glyph + per-participant color seam +
  `data-participant-id` attribute are inherited verbatim.
- [`tasks/refinements/moderator-ui/mod_proposed_state_styling.md`](mod_proposed_state_styling.md)
  — the proposed-state visual contract (dashed border + faded fill / 60%
  opacity). The pending badge mirrors the same `border-dashed` +
  `opacity-60` overlay.
- [`tasks/refinements/moderator-ui/mod_per_facet_state_visualization.md`](mod_per_facet_state_visualization.md)
  — `PILL_STATUS_CLASSNAME['proposed']` is the canonical Tailwind string for
  proposed-state. The pending badge does NOT reuse it directly (the pill is a
  text chip; the badge is a color square — Decision §3) but the visual
  vocabulary is consistent.
- [`apps/moderator/src/graph/AxiomMarkBadge.tsx`](../../../apps/moderator/src/graph/AxiomMarkBadge.tsx)
  lines 1–78 — the template the pending badge mirrors. Same `useTranslation`
  hook, same `axiomMarkColorFor` color resolution, same `role="img"`
  semantics, same shape / glyph. The pending variant adds the dashed-faded
  overlay + a distinct testid + the `data-pending="true"` attribute.
- [`apps/moderator/src/graph/StatementNode.tsx`](../../../apps/moderator/src/graph/StatementNode.tsx)
  lines 350–443 — where node decorations attach. Specifically:
  - Lines 416–433: the existing `axiom-mark-list-node-{id}` committed row.
    The new `pending-axiom-mark-list-node-{id}` row inserts immediately
    above this (Decision §4 — pending dots above committed dots).
  - The pattern `axiomMarks.length > 0 ? <div>…</div> : null` is the
    "no empty container" rule the pending row mirrors verbatim.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts)
  lines 286–449 — the existing `AxiomMark` interface, `projectAxiomMarks`,
  `groupAxiomMarksByNode`, `EMPTY_AXIOM_MARKS`, and the `axiomMarkColorFor`
  palette family. The new pending selector + interface + bucket helper +
  empty constant land alongside.
- [`apps/moderator/src/graph/proposalFacets.ts`](../../../apps/moderator/src/graph/proposalFacets.ts)
  lines 119–148 — `facetTargetOf`: confirms `axiom-mark` is in the
  "structural sub-kind" bucket that returns `null` from `facetTargetOf` (so
  axiom-mark proposals get the synthetic `'proposal'` lifecycle chip in the
  sidebar breakdown, NOT a per-facet entry). This is why the right-sidebar
  pending-proposals pane already lists axiom-mark proposals correctly
  without modification (Decision §8 — the sidebar surface is out of scope
  for this task; graph-side render only).
- [`apps/moderator/src/graph/pendingProposals.ts`](../../../apps/moderator/src/graph/pendingProposals.ts)
  lines 115–144 — `derivePendingProposals`'s terminator handling
  (`commit` + `meta-disagreement-marked` events remove proposals from the
  pending list). The new pending-axiom-mark selector mirrors this two-
  terminator logic.
- [`apps/server/src/methodology/handlers/propose.ts`](../../../apps/server/src/methodology/handlers/propose.ts)
  lines 489–540 — `validateAxiomMarkProposal`. Rule 3 (participant-equals-
  requester → `'axiom-mark-not-self'`) is the engine rule that blocks the
  moderator-side path from producing pending axiom-marks in v1.
- [`apps/server/src/projection/replay.ts`](../../../apps/server/src/projection/replay.ts)
  lines 667–686 — `applyCommittedProposal` axiom-mark arm. The commit-side
  fan-out that produces the committed projection entry. The new selector
  needs no equivalent — pending state is derived from the raw event log,
  not from any commit-side projection slice.
- [`packages/shared-types/src/events/proposals.ts`](../../../packages/shared-types/src/events/proposals.ts)
  lines 196–202 — `axiomMarkProposalSchema`. The structural shape the
  pending selector consumes off the `proposal` event envelope.
- [`packages/i18n-catalogs/src/catalogs/en-US.json`](../../../packages/i18n-catalogs/src/catalogs/en-US.json)
  lines 92–96 — the existing `methodology.axiomMark` namespace. The two
  new keys (`pendingTooltip`, `pendingSrLabel`) extend this namespace
  per Decision §6.
- [`tests/e2e/moderator-capture.spec.ts`](../../../tests/e2e/moderator-capture.spec.ts)
  lines 800–841 — the `__aConversaWsStore` probe pattern + the
  `expect.poll(...)` assertion shape. The new e2e block in this task
  follows the same template (Decision §7).

## Constraints / requirements

- **Pending = proposed-axiom-mark-event minus terminators.** The selector
  walks the log once. A `proposal` event with `proposal.kind === 'axiom-mark'`
  records `(eventId, nodeId, participantId, createdAt)`. A subsequent
  `commit` or `meta-disagreement-marked` event whose `proposal_id` matches
  removes the entry. Two terminator kinds (not just `commit`) — mirrors
  `derivePendingProposals` Step 1. Per-participant uniqueness is NOT
  enforced at the selector level (Decision §2 — two pending proposals from
  the same participant on the same node both render as separate dots).

- **Color: `axiomMarkColorFor(participantId)` — same as committed.** Reuse
  the existing palette so the visual transition "pending → committed" is
  "dashed-faded dot → solid dot of the same color." A separate proposed-state
  palette (e.g. all grey) was considered and rejected (Decision §3) —
  losing the per-participant attribution would erase the methodology's
  per-participant invariant in the most attention-demanding state.

- **Composition: per-participant color stays + dashed slate border +
  opacity-60 overlay.** Specifically:
  ```ts
  className={`inline-flex h-5 w-5 items-center justify-center rounded-sm
    ${color.bg} ${color.text}
    border border-dashed border-slate-400
    ring-1 ${color.ring}
    opacity-60
    text-[11px] font-semibold leading-none`}
  ```
  Per Decision §3. The participant-color `ring-1 ${color.ring}` stays
  underneath the dashed slate `border`; both render at 60% opacity. The
  net visual: participant-color square with a dashed slate outline that
  fades to ~36% perceived color saturation — readable as "this dot
  belongs to Anna (sky) but is not yet ratified."

- **Container: separate row above the committed row.** The pending row
  has its own `data-testid="pending-axiom-mark-list-node-{id}"` container,
  rendered immediately above the existing `axiom-mark-list-node-{id}`
  container. Decision §4 records the placement rationale. The pending
  row is omitted from the DOM when `pendingAxiomMarks.length === 0`
  (mirrors the committed-row + annotation-row + facet-pill-row "no empty
  container" rule).

- **Data attribute: `data-pending="true"` on every pending badge.** New
  stable seam for the "this is the pending variant" boolean. Decision §5
  records the choice over reusing `data-facet-status` (which is reserved
  for the per-facet state machine — axiom-marks don't flow through
  `computeFacetStatuses`, per `mod_axiom_mark_decoration` Decision §"No
  update to `cardRollupStatus`").

- **testid: `pending-axiom-mark-badge-{nodeId}-{participantId}`.** Distinct
  from the committed `axiom-mark-badge-{nodeId}-{participantId}` so tests
  can target pending vs committed without DOM-walking. Decision §5 records
  the distinct-testid choice (vs an over-generalized
  `axiom-mark-badge-{kind}-{nodeId}-{participantId}` shape that would break
  every existing committed test).

- **Key: `proposalEventId` (NOT `participantId`).** A participant can in
  principle have multiple pending axiom-marks against the same node (the
  propose-side validator's rule 4 only rejects when a *committed*
  duplicate exists). Decision §2 records the choice. The committed row's
  key is `participantId` — different reasoning, different invariant.

- **i18n keys: extend `methodology.axiomMark.*`** (not a new
  `methodology.pendingAxiomMark.*` namespace). Decision §6. The keys are
  `methodology.axiomMark.pendingTooltip` and
  `methodology.axiomMark.pendingSrLabel`; ICU substitution shape matches
  the existing `tooltip` / `srLabel` (both take `{participantId}`).

- **Native-review follow-up registered.** New task in
  `tasks/35-frontend-i18n.tji`:
  `i18n_axiom_mark_pending_render_native_review` (effort 0.5d, `allocate
  team`, `depends !i18n_axiom_mark_action_native_review`), with two
  `note` lines per the existing native-review precedent (source-of-debt
  + tech-debt-policy reference).

- **No regressions to the committed-side decoration.** The existing
  `AxiomMarkBadge`, `projectAxiomMarks`, `groupAxiomMarksByNode`,
  `EMPTY_AXIOM_MARKS`, the `axiom-mark-list-node-{id}` row, every test
  asserting against the committed surface — all stay untouched.

- **No `cardRollupStatus` change.** Per
  `mod_axiom_mark_decoration` Decision §"No update to `cardRollupStatus`":
  axiom-marks are not a facet (they live on `node.axiomMarks: Map<…>`,
  separate from the three facets), so they don't flow through
  `computeFacetStatuses`. The pending render is purely additive — it
  composes with whatever the facet-status rollup produces for the card
  frame.

- **No sidebar work in this task.** The pending-proposals pane already
  lists all in-flight proposals via `derivePendingProposals` (including
  axiom-mark proposals — they appear with the synthetic `'proposal'`
  lifecycle chip per `proposalFacets.ts:facetTargetOf` returning `null`
  for `axiom-mark`). The row's chip + actor + relative-time surface is
  sufficient for axiom-mark proposals as-is. Decision §8 records the
  out-of-scope determination.

- **i18n catalog parity** — `pnpm --filter @a-conversa/i18n-catalogs run
  check` must remain green after the two new keys land.

- **e2e coverage** — Decision §7. The new Playwright block under
  `tests/e2e/moderator-capture.spec.ts` injects a synthetic axiom-mark
  proposal directly into the WS store (bypassing the engine's rule 3),
  then asserts the pending badge surfaces. Gated on
  `window.__aConversaWsStore` reachability (`test.skip(true, …)` when
  the dev-only attachment hasn't fired — identical to the predecessor's
  pattern at lines 800–806).

- **Vitest cases** (committed, per ADR 0022):
  - `apps/moderator/src/graph/selectors.test.ts` extended with a new
    `projectPendingAxiomMarks` describe block:
    - Empty event log → `[]`.
    - One axiom-mark proposal with no commit → one `PendingAxiomMark`
      with the right `proposalEventId` / `nodeId` / `participantId` /
      `proposedAt`.
    - One axiom-mark proposal + matching commit → `[]` (the terminator
      removes the entry).
    - One axiom-mark proposal + matching `meta-disagreement-marked` → `[]`
      (the second terminator).
    - Two axiom-mark proposals from different participants on the same
      node → both surface as separate `PendingAxiomMark` entries.
    - Two pending proposals from the SAME participant on the same node
      → both surface as separate entries (Decision §2 — the selector
      does not enforce per-participant uniqueness).
    - Mixed log — non-axiom-mark proposals are ignored.
    - Emission order matches proposal-event arrival order.
  - New `groupPendingAxiomMarksByNode` cases (parallel to the existing
    `groupAxiomMarksByNode` cases): bucketing correctness.
  - `apps/moderator/src/graph/PendingAxiomMarkBadge.test.tsx` (new file):
    - 3 cases × 3 locales (9 cases): the badge's `title` and `aria-label`
      resolve to the matching localized string for each locale.
    - `data-pending="true"` attribute pin.
    - `data-participant-id` attribute matches the prop.
    - `data-testid` matches `pending-axiom-mark-badge-{nodeId}-{participantId}`.
    - Same `participantId` across two badge renders produces the same
      Tailwind background class (deterministic color via
      `axiomMarkColorFor`).
    - className includes `border-dashed` AND `opacity-60` (the proposed-
      state overlay).
    - className includes the per-participant `bg-…-100` AND `ring-…-300`
      (the participant-color attribution survives the overlay).
  - `apps/moderator/src/graph/StatementNode.test.tsx` extended with new
    pending-row describe block:
    - Node with no pending axiom-marks renders no
      `pending-axiom-mark-list-node-{id}` container.
    - Node with one pending axiom-mark renders the badge with the right
      testid + `data-pending="true"`.
    - Node with two pending axiom-marks (two participants) renders both
      badges in proposal-arrival order.
    - Pending row sits ABOVE the committed `axiom-mark-list-node-{id}`
      row (DOM order pinned via `compareDocumentPosition`).
    - Node with both a pending AND a committed axiom-mark from the same
      participant renders both badges (one in each row) — the moderator
      sees "Anna has a committed mark on this node AND has a second
      proposal pending" (an edge case in v1 since the engine's rule 4
      rejects a second-from-same-participant once a commit lands, but
      the rendering must handle the pre-engine-validation transient).
  - `apps/moderator/src/graph/GraphCanvasPane.test.tsx` extended:
    - `projectNodes` enriches a node's `data.pendingAxiomMarks` from a
      pending axiom-mark proposal in the WS store.
    - `projectNodes` leaves `data.pendingAxiomMarks` empty for a node
      with only a committed axiom-mark (the commit terminator removes
      the pending entry).
    - End-to-end through the canvas — applying a `node-created` + a
      synthetic-actor axiom-mark proposal to the WS store renders the
      pending badge inside the node's card.

- **Playwright e2e** — `tests/e2e/moderator-capture.spec.ts` extended:
  - One new `test()` block under the existing `test.describe('moderator
    capture flow', …)` group.
  - Seeds two participants via `seedInviteParticipantsForGate` (the
    existing helper). Seeds a node + a synthetic axiom-mark proposal
    (actor = one of the seeded debater user-ids, NOT the moderator's)
    directly into the WS store via the `__aConversaWsStore` seam.
    The synthetic actor sidesteps engine rule 3 because we bypass the
    propose handler entirely — the seed writes directly into the event
    list the projection consumes.
  - Asserts `[data-pending="true"][data-participant-id="<debaterId>"]`
    resolves under the node card; asserts the badge is positioned
    inside the `pending-axiom-mark-list-node-{nodeId}` container.
  - Skip-gates on `window.__aConversaWsStore` reachability via the same
    `test.skip(true, …)` pattern as the predecessor's seeded-graph
    cases (lines 800–806).

## Acceptance criteria

- `apps/moderator/src/graph/selectors.ts` exports `PendingAxiomMark`,
  `projectPendingAxiomMarks`, `groupPendingAxiomMarksByNode`, and
  `EMPTY_PENDING_AXIOM_MARKS`. The existing `AxiomMark` / `projectAxiomMarks`
  / `groupAxiomMarksByNode` / `EMPTY_AXIOM_MARKS` exports are unchanged.
- `apps/moderator/src/graph/PendingAxiomMarkBadge.tsx` exists; exports a
  memo'd `PendingAxiomMarkBadge` component with the per-status overlay
  classes and the `data-pending="true"` / `data-participant-id` /
  `data-testid="pending-axiom-mark-badge-…"` seams.
- `apps/moderator/src/graph/StatementNode.tsx` `StatementNodeData` carries
  `pendingAxiomMarks: readonly PendingAxiomMark[]`; the component renders
  the `pending-axiom-mark-list-node-{id}` decoration row immediately above
  the existing `axiom-mark-list-node-{id}` committed row when the list is
  non-empty. The committed row + every other existing decoration row
  (axiom-mark / annotation / facet-pill) stays untouched.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`'s `projectNodes` enriches
  each node's `data.pendingAxiomMarks` via `groupPendingAxiomMarksByNode(
  projectPendingAxiomMarks(events)).get(nodeId) ?? EMPTY_PENDING_AXIOM_MARKS`.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` carry the
  two new keys (`methodology.axiomMark.pendingTooltip`,
  `methodology.axiomMark.pendingSrLabel`). pt-BR / es-419 drafts ride flagged
  PENDING in the existing `*.review.json` trackers; the catalog-parity check
  passes.
- `tasks/35-frontend-i18n.tji` carries a new task block
  `i18n_axiom_mark_pending_render_native_review` (effort 0.5d, allocate team,
  `depends !i18n_axiom_mark_action_native_review`) plus two `note` lines
  (source-of-debt + tech-debt-policy reference). `tj3 project.tjp 2>&1 |
  grep -iE "error|fatal"` is silent.
- All Vitest cases land green; baseline test count rises by the new cases
  (~15–20 new cases across the four touched test files).
- The new Playwright spec block in `tests/e2e/moderator-capture.spec.ts`
  passes against the dev compose stack; on environments where
  `window.__aConversaWsStore` is not reachable, the test skips via the same
  `test.skip(true, …)` pattern as the predecessor's seeded-graph cases.
- `pnpm run check` clean. `pnpm run test:smoke` green. `pnpm -F
  @a-conversa/moderator build` succeeds. `pnpm --filter @a-conversa/i18n-
  catalogs run check` green. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"`
  silent. `tasks/30-moderator-ui.tji` gets `complete 100` on
  `mod_axiom_mark_pending_render` plus a `note "Refinement: tasks/refinements
  /moderator-ui/mod_axiom_mark_pending_render.md"` line on completion (Closer
  step). Closing this leaf derives-completes `mod_axiom_mark_flow`.

## Decisions

1. **What "pending axiom-mark" means.** Between the moment a participant
   proposes an axiom-mark and the moment all current participants vote
   `agree` and the moderator commits, the mark is in proposed/pending state.
   In v1 the moderator-side action ALWAYS hits engine rule 3
   (`axiom-mark-not-self` — per `axiom_mark_logic.md` Decisions and
   `mod_axiom_mark_action.md` Decision §1c) and so produces no pending
   axiom-marks; the participant-tablet task (`part_axiom_mark_from_tablet`,
   M5 dep) will eventually let debaters propose their own axiom-marks at
   which point this pending render becomes user-visible. This task lands
   the rendering surface in advance of that consumer so the participant-
   side task is "wire up the action; the moderator's canvas already
   surfaces the pending state."

   Considered alternatives:
   - **(a) Defer the entire task until `part_axiom_mark_from_tablet`
     lands.** *Rejected.* The TaskJuggler dependency
     (`depends !mod_axiom_mark_action`, no `part_*` dep) places this
     task on the moderator-ui critical path, not the participant-ui
     one; deferring would leave the F5 subgroup permanently
     uncompletable and would couple the moderator-ui WBS to the
     participant-ui WBS through an undocumented runtime invariant. It
     would also leave a future participant-ui implementer guessing
     "do I need to land the moderator render too?"
   - **(b) Land just the selector + projection enrichment now; defer
     the badge component + StatementNode row to `part_axiom_mark_from_tablet`.**
     *Rejected.* Half-finished rendering surfaces are harder to test
     than complete ones — without the render the projection enrichment
     can't be e2e-verified. The selector + projection + badge + row are
     a single unit of work; splitting them would distribute the work
     across two tasks without making the second task meaningfully
     smaller.
   - **(c) Land the full rendering surface now; cover with a unit-test
     suite + a synthetic-actor e2e cover; let `part_axiom_mark_from_tablet`
     consume the surface as-is.** *Chosen.* Closes the F5 subgroup on
     schedule, gives the participant-ui implementer a complete render
     target, and the synthetic-actor e2e cover exercises the full chain
     (event → projection → render → DOM seam) without depending on
     either the moderator-side action's engine-blocked path or the
     unimplemented participant-tablet surface.

2. **Pending dot key: `proposalEventId`, not `participantId`.** Two
   pending axiom-mark proposals from the same participant on the same node
   *can* coexist mid-test (the propose-side validator's rule 4 only rejects
   when a *committed* duplicate exists — two uncommitted proposals from the
   same `(node, participant)` both pass propose-side validation). Keying
   by `participantId` would collide; keying by `proposalEventId` (the
   stable per-envelope id from the event log) is unique by construction.
   Considered alternatives:
   - **Composite `${participantId}-${proposalEventId}` key.** *Rejected.*
     `proposalEventId` is unique on its own; composite adds noise without
     buying disambiguation.
   - **Per-participant deduplication in the selector (keep the latest
     pending proposal per `(node, participant)` pair).** *Rejected.* The
     rendering should reflect the projection truth — if two pending
     proposals exist, two dots render. Hiding the second proposal would
     defeat the "show what's in flight" semantics; a future propose-side
     tightening that adds a "no duplicate pending" rule (currently absent
     — `axiom_mark_logic.md` Open Questions touches the broader
     "duplicate pending vs duplicate committed" question) would naturally
     collapse this case to one without any selector change.

3. **Visual composition: per-participant color + dashed slate border +
   opacity-60 overlay.** Mirrors the committed badge's color attribution
   plus the proposed-state overlay from `mod_proposed_state_styling`. The
   participant color stays so the moderator can identify whose mark is
   pending; the dashed border + 60% opacity communicate "not yet on
   record." Considered alternatives:
   - **(a) Pure grey badge (drop participant color entirely).**
     *Rejected.* Strips the per-participant attribution at exactly the
     moment it matters most — the moderator scanning a busy canvas needs
     to know "who is proposing this" to anticipate the vote-flow. The
     methodology models per-participant axiom-marks as the load-bearing
     unit; the visual must carry that attribution through every lifecycle
     state.
   - **(b) Reuse `PILL_STATUS_CLASSNAME['proposed']` verbatim.**
     *Rejected.* That constant is shaped for a text chip (`text-slate-500`
     foreground color, no participant-color background), not a colored
     square. Importing it would either (i) clash with the participant-color
     background (foreground slate-500 over `bg-sky-100` reads as washed-out)
     or (ii) force a refactor of `PILL_STATUS_CLASSNAME` to factor out the
     border/opacity portion from the foreground portion — over-scope for
     this task.
   - **(c) Per-participant color + dashed slate border + opacity-60
     overlay (the chosen composition).** *Chosen.* Keeps the participant-
     color identity; layers the proposed-state visual vocabulary the
     moderator has internalized; the dashed slate border is the universal
     "not yet committed" signal across every state-styling decision the
     graph has made. The 60% opacity matches `mod_proposed_state_styling`'s
     pinned value verbatim — the moderator perceives a consistent fade
     across the card frame, the facet pills, and the axiom-mark dots.

4. **Pending row sits ABOVE the committed row (not below, not in the
   same row).** Visual placement reads as "the dots that will fill in" —
   pending dots on top, committed dots beneath. Considered alternatives:
   - **(a) Same row as committed marks, sorted by `proposalEventId`.**
     *Rejected.* Mixing pending and committed in the same row erases the
     visual lifecycle distinction; the moderator would have to read each
     dot's dashed-vs-solid border to tell which is which. The two-row
     split makes the lifecycle distinction the dominant visual signal.
   - **(b) Below the committed row.** *Rejected.* The committed row is the
     "what is on record" surface; the pending row is the "what is being
     proposed" surface. Reading left-to-right / top-to-bottom in Western
     locales, the methodology's narrative is "first the proposal, then
     the vote, then the commit" — pending precedes committed
     temporally, so pending should precede committed visually.
   - **(c) Above the committed row (chosen).** Pending is the forward-
     looking signal; committed is the backward-looking record. Eye-scan
     order: facet pills → wording → kind label → pending axiom-marks
     (forward-looking decoration) → committed axiom-marks (backward-looking
     decoration) → annotations (commentary). This positions the *lifecycle
     in motion* before the *lifecycle on record*, matching how the
     moderator's attention flows when scanning a card mid-debate.

5. **Distinct testid + new `data-pending="true"` attribute (not reuse
   `data-facet-status` or composite-key the existing committed testid).**
   Considered alternatives:
   - **(a) Reuse `data-facet-status="proposed"` on the dot.** *Rejected.*
     `data-facet-status` is reserved for the per-facet state machine
     (`mod_proposed_state_styling` / `mod_per_facet_state_visualization`).
     Axiom-marks are NOT a facet — `mod_axiom_mark_decoration` Decision
     §"No update to `cardRollupStatus`" explicitly pinned axiom-marks
     OUTSIDE the facet pipeline. Reusing the attribute would conflate
     the two surfaces; future facet-status assertions could accidentally
     match pending axiom-mark badges.
   - **(b) Composite testid:
     `axiom-mark-badge-{kind:pending|committed}-{nodeId}-{participantId}`.**
     *Rejected.* Would break every existing committed-side test (the
     `axiom-mark-badge-{nodeId}-{participantId}` testid is asserted in
     `mod_axiom_mark_decoration`'s 13 cases + downstream e2e selectors).
     Stability is the dominant value for committed seams.
   - **(c) Distinct testid `pending-axiom-mark-badge-…` + new
     `data-pending="true"` attribute (chosen).** Distinct testid keeps
     existing committed tests stable; the boolean `data-pending` attribute
     is the stable seam for "give me every pending axiom-mark on this
     node" without per-participant DOM-walking. Both seams compose with
     the inherited `data-participant-id` (per-participant selectors keep
     working across both lifecycles).

6. **i18n keys extend `methodology.axiomMark.*` (not a new
   `methodology.pendingAxiomMark.*` namespace).** Considered alternatives:
   - **(a) Separate `methodology.pendingAxiomMark.*` namespace.**
     *Rejected.* The methodology's "axiom-mark" is one concept with a
     lifecycle; the namespace is the *concept*, not the *lifecycle stage*.
     A separate namespace would invite future "what about a
     `methodology.withdrawnAxiomMark.*` namespace? a
     `methodology.disputedAxiomMark.*`?" — proliferation without
     conceptual gain.
   - **(b) Extend existing namespace with parallel `pendingTooltip` /
     `pendingSrLabel` keys (chosen).** Mirrors how the per-facet pill
     refinement extended `methodology.facet.*` with the three facet
     names rather than carving out a `methodology.committedFacet.*`
     namespace. The translator sees both the committed and pending
     forms side-by-side in the catalog, making the lifecycle-stage
     vocabulary consistent across translations ("axiom marked by" vs
     "pending axiom mark by" — the second drafted to read as a clear
     proposed-state extension of the first).

7. **e2e via synthetic-actor WS-store seed (not via the moderator-side
   action chain).** The moderator-side action always errors per rule 3 in
   v1; driving the e2e through the action chain would assert only that the
   error surfaces, not that the pending render works. Considered
   alternatives:
   - **(a) WS-store seed with synthetic debater actor (chosen).** Bypass
     the propose handler entirely; inject the proposal envelope directly
     into the event list with `actor` set to a seeded debater's user id.
     The projection consumes the event the same as it would consume any
     real proposal; the render chain produces the pending badge as it
     would for a real participant-driven proposal. Asserts the full
     chain (event → projection → render → DOM seam) end-to-end without
     depending on either the moderator-side action's engine-blocked path
     or the unimplemented participant-tablet surface. The same seam
     (`__aConversaWsStore`) the predecessor's e2e cover already uses
     (lines 800–841), so no new test infrastructure.
   - **(b) Defer the e2e cover entirely to
     `part_axiom_mark_from_tablet`.** *Rejected.* The pending render is a
     moderator-ui surface; its e2e cover belongs in the moderator-ui
     suite. Deferring would couple this task's coverage to the
     participant-ui WBS through an undocumented dependency.
   - **(c) WS-store seed via a moderator-driven envelope that doesn't
     hit the engine (e.g., temporarily disable rule 3 in the test
     environment).** *Rejected.* Disabling engine validation in tests
     creates a test environment that diverges from production
     semantics; per the ADR-0022 spirit of "tests document real
     behaviour" this would be backwards — the e2e should exercise the
     real projection → render path, which is exactly what (a) does.

8. **Sidebar surface is OUT OF SCOPE.** The right-sidebar pending-
   proposals pane already lists all in-flight proposals via
   `derivePendingProposals` (`pendingProposals.ts:115`), including
   axiom-mark proposals. The per-proposal facet-breakdown selector
   (`proposalFacets.ts:facetTargetOf`) returns `null` for
   `axiom-mark` — the proposal is "structural" in the breakdown's
   classification — so it gets one synthetic `'proposal'` lifecycle
   chip rather than a per-facet breakdown. This is the correct
   behavior: axiom-marks have no facet-level decomposition (they are
   a per-participant disposition on the whole node, not on one of its
   three facets). No sidebar change needed.

9. **No `cardRollupStatus` update.** Per `mod_axiom_mark_decoration`
   Decision §"No update to `cardRollupStatus`": axiom-marks live OUTSIDE
   the per-facet state machine. A pending axiom-mark on a node should not
   flip the card frame to dashed-faded (that signal is reserved for
   per-facet `proposed` state). The card frame stays whatever the facet
   rollup produces; the pending axiom-mark dot is purely additive
   decoration. A reader scanning the canvas sees the card frame for
   per-facet state and the per-participant dots for axiom-mark state,
   layered without competing.

10. **Per-participant uniqueness handling: deferred to engine /
    natural collapse.** Two pending proposals from the same `(node,
    participant)` pair both render as separate dots. Once one commits,
    engine rule 4 rejects any further propose from that participant on
    that node — so the steady state in v1 is "one or zero pending +
    one or zero committed" per `(node, participant)`. The transient
    "two pending + zero committed" state is rare but possible (two
    simultaneous proposals before either reaches the engine); the
    rendering handles it gracefully by surfacing both dots. If a future
    propose-side tightening adds a "no duplicate pending" rule (currently
    open in `axiom_mark_logic.md` Open Questions), the transient
    collapses automatically without selector change.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-16.

- Closes the `mod_axiom_mark_flow` subgroup: this is the second and last leaf (after `mod_axiom_mark_action` done 2026-05-16, `5a9b6de`); the F5 subgroup is now derives-complete.
- New shared selector seam in `apps/moderator/src/graph/selectors.ts`: `PendingAxiomMark` interface, `projectPendingAxiomMarks(events) → PendingAxiomMark[]`, `groupPendingAxiomMarksByNode(marks) → Map<…>`, and `EMPTY_PENDING_AXIOM_MARKS`, parallel to the committed `projectAxiomMarks` / `groupAxiomMarksByNode` / `EMPTY_AXIOM_MARKS` family; both `commit` and `meta-disagreement-marked` terminators remove pending entries (mirrors `derivePendingProposals` Step 1).
- New memo'd component `apps/moderator/src/graph/PendingAxiomMarkBadge.tsx` mirrors `AxiomMarkBadge` (same per-participant `axiomMarkColorFor` palette, rounded-square shape, centered "A" glyph) with the proposed-state overlay (`border-dashed border-slate-400 opacity-60`); exposes `data-pending="true"`, `data-participant-id`, and the distinct `pending-axiom-mark-badge-{nodeId}-{participantId}` testid (Decisions §3, §5).
- `apps/moderator/src/graph/StatementNode.tsx` `StatementNodeData` gains `pendingAxiomMarks: readonly PendingAxiomMark[]`; the component renders the new `pending-axiom-mark-list-node-{id}` decoration row immediately above the existing committed `axiom-mark-list-node-{id}` row (Decision §4 — pending dots above committed dots) and stays "no empty container" when the list is empty. `apps/moderator/src/graph/GraphCanvasPane.tsx` enriches each node via `groupPendingAxiomMarksByNode(projectPendingAxiomMarks(events))`.
- Two new i18n keys under the existing `methodology.axiomMark.*` namespace across all three v1 catalogs — `pendingTooltip` and `pendingSrLabel` (en-US / pt-BR / es-419) with ICU `{participantId}` substitution; pt-BR / es-419 drafts ride flagged PENDING in the `*.review.json` trackers. Follow-up `i18n_axiom_mark_pending_render_native_review` (effort 0.5d, depends `!i18n_axiom_mark_action_native_review`) registered in `tasks/35-frontend-i18n.tji`.
- Playwright e2e cover in `tests/e2e/moderator-capture.spec.ts` uses the synthetic-debater-actor `__aConversaWsStore` seed shortcut (Decision §7) — seeds an axiom-mark proposal with `actor` set to a seeded debater's user id directly into the WS store, sidestepping engine rule 3 (`axiom-mark-not-self`) so the moderator's canvas can be verified end-to-end. In v1 the full chain only becomes user-driven once `part_axiom_mark_from_tablet` (M5 dep on the participant-ui work-stream) ships.
- Vitest count rose ~3202 → 3236 (+34 across `selectors.test.ts`, new `PendingAxiomMarkBadge.test.tsx`, `StatementNode.test.tsx`, `GraphCanvasPane.test.tsx`, plus a compile-side `HoverPopover.test.tsx` helper fix providing the new `pendingAxiomMarks: []` default). `pnpm run check` and `pnpm run test:smoke` green; `chromium-create-session` Playwright project passing including the new pending-axiom-mark spec block.
- **Process flag** — the implementer touched `tasks/35-frontend-i18n.tji` directly (third consecutive rule violation: Closer is responsible for tech-debt task registration). Closer verified the added `i18n_axiom_mark_pending_render_native_review` block is well-formed (effort 0.5d, `allocate team`, `depends !i18n_axiom_mark_action_native_review`, two `note` lines, no premature `complete 100`; `tj3` silent) and left it in place. Flagged here for future audits.
