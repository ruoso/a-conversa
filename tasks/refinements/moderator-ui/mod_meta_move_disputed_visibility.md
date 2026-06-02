# Moderator meta-move disputed visibility — render contested meta-move annotations with disputed styling

**TaskJuggler entry**: [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) — task
`moderator_ui.mod_meta_move_flow.mod_meta_move_disputed_visibility`.

```
task mod_meta_move_disputed_visibility "Render contested meta-move as disputed annotation" {
  effort 0.5d
  allocate team
  depends !mod_meta_move_action
}
```

## Effort estimate

**0.5d.** Confirmed. This is the third leaf of `mod_meta_move_flow`, sitting on
top of the action spine that
[`mod_meta_move_action`](./mod_meta_move_action.md) landed on 2026-05-31. The
work is small and pattern-bound — it extends one rendering component and one
render-data type along the existing disputed-state precedent that
`mod_disputed_state_styling` already settled for `<StatementNode>` and
`<StatementEdge>`:

- The disputed-state visual recipe is already in place
  ([apps/moderator/src/graph/StatementNode.tsx L267–268](../../../apps/moderator/src/graph/StatementNode.tsx#L267),
  L325) — `border-solid border-rose-600 ring-2 ring-rose-500 opacity-100` +
  the `data-facet-status="disputed"` test seam. This task lifts the same
  recipe onto the annotation badge.
- The roll-up function is already in place
  ([packages/shell/src/facet-status/facet-status.ts L636–644](../../../packages/shell/src/facet-status/facet-status.ts#L636)
  — `cardRollupStatus(facetStatuses)`). The task consumes it; no new helper.
- The badge component is small
  ([apps/moderator/src/graph/AnnotationBadge.tsx](../../../apps/moderator/src/graph/AnnotationBadge.tsx)
  — 55 lines, three mount sites: `StatementNode.tsx:529`,
  `StatementEdge.tsx:328`, `AnnotationNode.tsx:119`).
- The render-data carrier is already on the path
  ([apps/moderator/src/graph/selectors.ts L83–98](../../../apps/moderator/src/graph/selectors.ts#L83)
  — `projectAnnotations`); the task extends the carrier with an optional
  `facetStatuses` field, threaded through the existing selector wrappers.
- The `Annotation` interface lives in the shell
  ([packages/shell/src/annotations/annotations.ts L56–64](../../../packages/shell/src/annotations/annotations.ts#L56));
  the optional facet-statuses field rides on a sibling **render-data**
  type so the wire-payload shape (and replay invariants) stay untouched —
  see Decision §1.
- The e2e behaviour the F8 narrative names ("a contested meta-move stays
  visible as `disputed`") is **not yet reachable end-to-end**: commit-time
  annotation creation for meta-moves is still an open question on the
  server side (per
  [meta_move_logic.md L104–106](../data-and-methodology/meta_move_logic.md#L104)),
  and there is no engine path that flows per-participant votes on a
  meta-move proposal into a per-facet status on the resulting annotation.
  This task ships the **frontend rendering surface and selector seam**;
  the wiring task that makes the disputed state visible through real
  events is named under Acceptance §8 / §9 (Decision §4).

Concretely the deliverable is:

- **`<AnnotationBadge>` styling branch** — adds an optional
  `facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>` prop
  and applies the disputed visual treatment (`border-solid border-rose-600
  ring-2 ring-rose-500` + `data-facet-status="disputed"`) when
  `cardRollupStatus(facetStatuses) === 'disputed'`. The default (no
  `facetStatuses` passed, or rollup not disputed) preserves today's
  unchanged amber pill — no regression to the four existing annotation
  kinds.
- **Render-data extension** — adds `facetStatuses?` to the annotation
  render shape consumed by `<AnnotationBadge>`. To keep the wire/shell
  `Annotation` type pure (Decision §1), the field rides on a new render
  carrier (`AnnotationRenderData`) — a thin wrapper that the selector
  yields and the badge accepts. Selector consumers thread the field
  through unchanged in the no-status case.
- **Selector seam (no behaviour change today)** —
  `projectAnnotations(events)` continues to return today's `Annotation[]`
  shape; a new selector layer
  (`enrichAnnotationsWithFacetStatuses(annotations, facetStatusIndex)`)
  produces `AnnotationRenderData[]`. The index is `Map<annotationId,
  Partial<Record<FacetName, FacetStatus>>>`. Today the index is **always
  empty** (no engine path populates it for annotations); the seam exists
  so a future wiring task can drop in the populated index without
  touching the render layer. Decision §2 records this two-layer split.
- **Vitest cover** —
  `apps/moderator/src/graph/AnnotationBadge.test.tsx` gains rendering
  cases for (a) no `facetStatuses` (unchanged baseline), (b)
  `facetStatuses` present but rollup not disputed (e.g. `'committed'` →
  baseline styling preserved), (c) rollup `'disputed'` → rose-marker
  applied + `data-facet-status="disputed"` stamped, (d) all four
  annotation kinds × disputed (cartesian — pins that styling composes
  with kind across `note` / `reframe` / `scope-change` / `stance`).
  A second test file
  `apps/moderator/src/graph/enrichAnnotationsWithFacetStatuses.test.ts`
  pins the selector seam: empty index → input passes through unchanged;
  populated index → matching annotations receive their `facetStatuses`
  field; non-matching annotations pass through unchanged.
- **No new i18n keys** — the badge label still comes from
  `methodology.annotationKind.<kind>` (already shipped). The disputed
  state is conveyed visually and via the `data-facet-status` attribute;
  the `aria-label` augments per Decision §3 (one new chrome key
  `moderator.annotation.disputedAriaSuffix` × 3 locales = 3 entries).
- **One follow-up native-review task registered** in
  `tasks/35-frontend-i18n.tji` —
  `i18n_meta_move_disputed_visibility_native_review` (effort 0.5d,
  depends on the tail of the existing native-review chain).
- **No `captureKeymap` / no `captureStore` / no `WsClient` changes.**
  This task does not propose, capture, or send any wire message. It
  reads projection state and renders.

## Inherited dependencies

Settled:

- **`moderator_ui.mod_meta_move_flow.mod_meta_move_action`** (done —
  2026-05-31). Ships the F8 propose-side spine: `metaMoveKind` slice with
  `'reframe'` default, `useMetaMoveAction()` hook, propose envelope,
  `<MetaMoveCapturePanel>`, F8 key binding. This task does not extend
  the capture flow; it only renders projection state that — eventually
  — flows from a committed meta-move proposal.

- **`moderator_ui.mod_graph_rendering.mod_render_annotations`** (done —
  2026-05-11). Ships `<AnnotationBadge>` with `data-annotation-kind`
  seam, the three mount sites (`StatementNode.tsx:529`,
  `StatementEdge.tsx:328`,
  [apps/moderator/src/graph/AnnotationNode.tsx L119](../../../apps/moderator/src/graph/AnnotationNode.tsx#L119)),
  the `methodology.annotationKind.<kind>` catalog keys, and the existing
  Vitest cover at
  [apps/moderator/src/graph/AnnotationBadge.test.tsx](../../../apps/moderator/src/graph/AnnotationBadge.test.tsx)
  that this task extends.

- **`moderator_ui.mod_graph_styling.mod_disputed_state_styling`** (done —
  2026-05-11). Ships the rose-600 ring + `data-facet-status="disputed"`
  prior art on `<StatementNode>` / `<StatementEdge>` that this task
  mirrors onto `<AnnotationBadge>`. The visual recipe and the
  `cardRollupStatus(facetStatuses)` dispatch were settled in that task;
  this task reuses both verbatim.

- **`packages/shell/src/facet-status/facet-status.ts`** — `FacetName`,
  `FacetStatus`, `cardRollupStatus()`, and the `ROLLUP_PRIORITY` order
  ([line 636](../../../packages/shell/src/facet-status/facet-status.ts#L636))
  are the contract this task consumes.

Pending (the e2e end-to-end semantics depend on these, BUT the rendering
surface this task ships does not — see Decision §4):

- **Server-side commit-time annotation creation for meta-moves.** Open
  question in
  [meta_move_logic.md L104–106](../data-and-methodology/meta_move_logic.md#L104):
  `replay.ts`'s `applyCommittedProposal` meta-move arm (lines 687–706
  per that refinement) is a structural no-op today — it synthesises an
  annotation id but does not emit the `annotation-created` event. Until
  this lands, no meta-move-derived annotation exists in projection
  state. Decision §4 registers `meta_move_commit_logic` as the named
  follow-up.

- **Per-annotation facet-status routing on the engine side.** Today's
  `computeFacetStatuses` (per the Explore report) operates on
  node-/edge-targeting events; it does not route per-participant votes
  on a meta-move proposal into per-facet status on the resulting
  annotation. Decision §4 registers `annotation_facet_status_logic` as
  the named follow-up. The frontend seam this task ships
  (`enrichAnnotationsWithFacetStatuses`) is exactly the drop-in point
  for the engine output.

## What this task is

The visual half of the F8 disputed-visibility commitment in
[docs/moderator-ui.md L132–141](../../../docs/moderator-ui.md#L132): "A
contested meta-move stays visible as `disputed` — it cannot be quietly
absorbed." When a meta-move proposal commits to an annotation on the
target entity and that annotation is in a disputed state (at least one
participant disputes one of its facets), the annotation badge renders
with the same red-marker styling already used for disputed nodes and
edges (`border-rose-600 ring-2 ring-rose-500`), and stamps a
`data-facet-status="disputed"` test seam that downstream verifications
(and the deferred Playwright spec) can pin.

The task is purely **render-layer**:

- It does not touch the wire payload or the `Annotation` shell type.
- It does not change capture flow, propose handlers, or commit handlers.
- It does not extend the methodology engine.
- It extends `<AnnotationBadge>` with an optional `facetStatuses` prop
  and the disputed-styling branch, lifts the annotation render data to
  a new `AnnotationRenderData` carrier, and lands a selector seam
  (`enrichAnnotationsWithFacetStatuses`) that the future engine-side
  wiring task can populate without touching this task's code.

The frontend surface the task ships is exhaustively pinned by Vitest.
Playwright is deferred because the end-to-end conditions that produce a
disputed meta-move annotation (commit-time annotation creation +
per-annotation facet-status routing) are still server-side open
questions — and a forced-state Playwright spec that fakes those
conditions would only re-cover what Vitest already pins. The deferral
is registered against the same future tasks that will resolve the
open questions.

## Why it needs to be done

Three reasons:

1. **The F8 narrative is not whole without it.** The docs commit:
   "contested meta-move stays visible as `disputed`." Without this
   task, the moderator's eye has no visual cue distinguishing a
   committed-but-disputed meta-move annotation from a quietly-absorbed
   one — exactly the failure mode the methodology language warns
   against.

2. **The selector seam unblocks the upstream commit-time / facet-status
   tasks.** Without `enrichAnnotationsWithFacetStatuses` in place, the
   future wiring task has to land both the engine-side per-annotation
   status computation AND the frontend render integration in one
   commit. Splitting the frontend half off now means the future
   backend task drops into a defined surface.

3. **It closes `mod_meta_move_flow`.** The flow declares three leaves
   (`mod_meta_move_action`, `mod_meta_move_kind_selector`,
   `mod_meta_move_disputed_visibility`); landing this task — together
   with the already-registered edge-/annotation-target follow-ups —
   marks the flow's frontend surface done. Backend gaps then belong to
   data-and-methodology tasks named in Decision §4.

## Inputs / context

Code seams the implementation plugs into (real file paths, all
verified against the working tree):

- [apps/moderator/src/graph/AnnotationBadge.tsx L1–55](../../../apps/moderator/src/graph/AnnotationBadge.tsx)
  — the component this task extends. Today: one amber pill, `kind`
  label via `t('methodology.annotationKind.<kind>')`, `data-annotation-kind`
  seam, `title={content}`. After this task: optional `facetStatuses`
  prop, `data-facet-status` seam, disputed styling branch.
- [apps/moderator/src/graph/StatementNode.tsx L267–268, L325, L520–532](../../../apps/moderator/src/graph/StatementNode.tsx#L267)
  — prior-art for the disputed visual recipe and the `data-facet-status`
  attribute. Lines 526–532 host the annotation-badge list on the node;
  no change needed there (the disputed styling lives inside the badge,
  not on the surrounding container).
- [apps/moderator/src/graph/StatementEdge.tsx](../../../apps/moderator/src/graph/StatementEdge.tsx)
  — mounts `<AnnotationBadge>` at line 328 inside the edge-label
  overlay. No call-site change needed; the badge picks up the
  `facetStatuses` from the render-data carrier.
- [apps/moderator/src/graph/AnnotationNode.tsx L119](../../../apps/moderator/src/graph/AnnotationNode.tsx#L119)
  — mounts `<AnnotationBadge>` for annotation-of-annotation meta-layer
  rendering. Same as above; no call-site change.
- [packages/shell/src/annotations/annotations.ts L56–64](../../../packages/shell/src/annotations/annotations.ts#L56)
  — `Annotation` interface. NOT extended (Decision §1). The new render
  carrier wraps this type.
- [packages/shell/src/facet-status/facet-status.ts L636–644](../../../packages/shell/src/facet-status/facet-status.ts#L636)
  — `cardRollupStatus()`. Reused as-is.
- [apps/moderator/src/graph/selectors.ts L83–98, L121–170, L200–220](../../../apps/moderator/src/graph/selectors.ts#L83)
  — `projectAnnotations`, `groupAnnotationsByNode` / `groupAnnotationsByEdge`,
  `selectAnnotations`. The new `enrichAnnotationsWithFacetStatuses`
  layer sits between projection and grouping/selection. Today the
  index is empty; the engine-side follow-up will populate it.
- [apps/moderator/src/graph/AnnotationBadge.test.tsx L1–121](../../../apps/moderator/src/graph/AnnotationBadge.test.tsx)
  — existing 12-case test (4 kinds × 3 locales). This task extends it
  with the disputed-state branches; existing cases stay green.
- [tasks/refinements/moderator-ui/mod_meta_move_action.md](./mod_meta_move_action.md)
  — Decision §3 (kind defaults to `'reframe'`), Decision §4
  (v1 narrows `target_kind` to `'node'`), and the **note in
  Constraints "No commit-time effects"** that explicitly flags the
  open question this task inherits.
- [tasks/refinements/data-and-methodology/meta_move_logic.md L104–106](../data-and-methodology/meta_move_logic.md#L104)
  — the open question this task does not resolve. Registers
  `meta_move_commit_logic` as the named successor (Decision §4).
- [docs/moderator-ui.md L132–141](../../../docs/moderator-ui.md#L132)
  — the F8 narrative this task implements the visual half of.
- [docs/methodology.md](../../../docs/methodology.md) — the
  methodological meaning of "contested" / "disputed" the visual must
  honour.
- [docs/data-model.md](../../../docs/data-model.md) — meta-move commits
  produce annotations on the target.
- [docs/adr/0022-no-throwaway-verifications.md](../../../docs/adr/0022-no-throwaway-verifications.md)
  — drives the Vitest layering of acceptance.
- [docs/adr/0024-frontend-i18n-react-i18next-with-icu.md](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  — i18n catalog workflow for the new `disputedAriaSuffix` key.

## Constraints / requirements

- **Wire / event shape unchanged.** This task adds no wire envelopes
  and no event kinds. The `annotation-created` event payload schema is
  not extended; the shell `Annotation` interface is not extended
  (Decision §1).
- **Render-data carrier, not type widening.** The new optional
  `facetStatuses?` field lives on `AnnotationRenderData` — a thin
  wrapper consumed by `<AnnotationBadge>` and produced by the selector
  layer. Shell projectors that the audience / replay surfaces share
  keep returning the strict `Annotation` shape.
- **No regressions to existing annotation rendering.** Annotations
  without `facetStatuses` (today's universal case) render exactly as
  before — same amber pill, same testids, same `data-annotation-kind`
  seam, same `title` attribute, same label. Vitest's existing 12 cases
  stay green untouched.
- **Disputed visual recipe matches prior art verbatim.**
  `border-solid border-rose-600 ring-2 ring-rose-500` and
  `data-facet-status="disputed"` are taken from
  `StatementNode.tsx:267–268, 325` and applied to the badge's outer
  `<span>`. No new colour tokens, no opacity changes (the badge is
  already opaque), no per-kind variation (Decision §3).
- **`cardRollupStatus` is the dispatch.** The badge does not
  re-implement priority order; it calls `cardRollupStatus(facetStatuses)`
  and branches on the return. Other rollup states (`'agreed'`,
  `'committed'`, `'withdrawn'`, etc.) preserve the baseline amber
  styling — only `'disputed'` activates the rose-marker branch. The
  `'meta-disagreement'` case is **also** rendered with the
  rose-marker branch + `data-facet-status="meta-disagreement"` (mirrors
  `StatementNode`'s behaviour at L325; the disputed-state styling task
  treats meta-disagreement as visually equivalent to disputed for the
  rollup) — see Decision §5.
- **`aria-label` augmentation when disputed.** When the rollup is
  `'disputed'` or `'meta-disagreement'`, the badge appends a
  localized suffix (`moderator.annotation.disputedAriaSuffix`) onto
  `aria-label` so screen-reader users hear "Reframe (disputed)" rather
  than just "Reframe". Decision §3.
- **No commit-time wiring in scope.** The task does NOT extend the
  server's `applyCommittedProposal` meta-move arm and does NOT add a
  per-annotation facet-status computer. Both are explicitly registered
  as follow-up backend tasks (Decision §4).
- **No new `captureKeymap` route, no `captureStore` slice.** The task
  is render-only.
- **Selector seam is type-safe but inert today.** The
  `enrichAnnotationsWithFacetStatuses` selector takes an
  `AnnotationFacetStatusIndex` (a `Map<string, Readonly<Partial<Record<FacetName,
  FacetStatus>>>>`) and, if non-empty, attaches per-annotation
  statuses; today the index passed in by `selectAnnotations` is empty
  (`new Map()`). The selector is exported from
  `apps/moderator/src/graph/selectors.ts` so the future wiring task
  can populate the index.
- **i18n catalog parity** must remain green after the one new chrome
  key lands. en-US authoritative; pt-BR / es-419 ride flagged PENDING
  in `*.review.json`.
- **No regressions** to `<StatementNode>` / `<StatementEdge>` /
  `<AnnotationNode>` rendering — all three mount sites continue to
  pass an `Annotation`-shaped record; the carrier widening is
  backward-compatible (`facetStatuses` is optional).

## Acceptance criteria

(Reference [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)
— each layer below pins durable behavior; no throwaway scripts.)

1. **`<AnnotationBadge>` extension shipped.** Component at
   `apps/moderator/src/graph/AnnotationBadge.tsx` accepts an optional
   `facetStatuses?: Readonly<Partial<Record<FacetName, FacetStatus>>>`
   prop. When `cardRollupStatus(facetStatuses) === 'disputed'` (or
   `'meta-disagreement'` per Decision §5), the badge renders with
   `border-solid border-rose-600 ring-2 ring-rose-500` appended to the
   existing classnames AND stamps `data-facet-status="<rollup>"` on
   the `<span>`. When `facetStatuses` is undefined or the rollup
   resolves to any other status, the existing amber pill renders
   unchanged.

2. **`AnnotationRenderData` carrier shipped.** A new type
   `AnnotationRenderData = Annotation & { readonly facetStatuses?:
   Readonly<Partial<Record<FacetName, FacetStatus>>> }` lives in
   `apps/moderator/src/graph/selectors.ts` (moderator-side only;
   not promoted to the shell — Decision §1). `<AnnotationBadge>`'s
   `annotation` prop is widened to accept the carrier; existing
   `Annotation`-typed values flow through unchanged because the new
   field is optional.

3. **`enrichAnnotationsWithFacetStatuses` selector shipped.** A new
   pure function in
   `apps/moderator/src/graph/selectors.ts` with the signature
   `(annotations: readonly Annotation[], index:
   AnnotationFacetStatusIndex) => readonly AnnotationRenderData[]`.
   For each input annotation: if `index.get(annotation.id)` returns a
   record, attach it as `facetStatuses`; else return the annotation
   widened (no `facetStatuses` field set). The function is total,
   stable, and pure.

4. **`selectAnnotations` wired to the new selector.** The existing
   `selectAnnotations(state, sessionId)` wrapper at
   `apps/moderator/src/graph/selectors.ts` (lines 200–220) now passes
   its `projectAnnotations(session.events)` result through
   `enrichAnnotationsWithFacetStatuses(annotations, EMPTY_INDEX)`
   where `EMPTY_INDEX = new Map()` (or the equivalent empty index
   constant). Today's behaviour is preserved (no annotation receives
   `facetStatuses`); the seam is in place for the future wiring task
   to swap in a populated index.

5. **Vitest cover for `<AnnotationBadge>`.** Extends
   `apps/moderator/src/graph/AnnotationBadge.test.tsx` with:
   - One case per annotation kind × disputed-rollup combination
     (4 kinds × 1 disputed-rollup = 4 cases) asserting the rose
     marker is applied AND `data-facet-status="disputed"` is stamped
     AND the aria-label suffix is rendered.
   - One case per annotation kind × meta-disagreement rollup
     (4 kinds × 1 rollup = 4 cases) asserting the rose marker is
     applied AND `data-facet-status="meta-disagreement"` is stamped.
   - One case asserting `facetStatuses` with rollup `'agreed'`
     preserves the baseline amber styling and does NOT stamp
     `data-facet-status`.
   - One case asserting `facetStatuses` with rollup `'committed'`
     preserves the baseline amber styling.
   - Existing 12 cases (no `facetStatuses`) untouched and green.

6. **Vitest cover for `enrichAnnotationsWithFacetStatuses`.** New file
   `apps/moderator/src/graph/enrichAnnotationsWithFacetStatuses.test.ts`
   pins: (a) empty index → every input annotation flows through with
   `facetStatuses === undefined`; (b) index hit on one annotation in a
   multi-annotation input → only that one carries `facetStatuses`,
   others pass through; (c) index entry for an unknown id is ignored;
   (d) function is referentially pure (does not mutate inputs).

7. **i18n catalog key landed.** One new key
   `moderator.annotation.disputedAriaSuffix` × three locales lands in
   `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`.
   en-US authoritative ("(disputed)"); pt-BR / es-419 flagged PENDING
   in the `*.review.json` trackers. The catalog-parity Vitest stays
   green. (No new annotation-kind label keys; the existing
   `methodology.annotationKind.<kind>` keys carry the kind label.)

8. **Native-review follow-up registered.**
   `tasks/35-frontend-i18n.tji` carries a new
   `i18n_meta_move_disputed_visibility_native_review` task (effort 0.5d,
   depends on the tail of the existing native-review chain — currently
   `!i18n_meta_move_kind_selector_native_review`). Closer registers in
   the WBS under the i18n-translation milestone.

9. **Playwright e2e — deferred** because the end-to-end conditions
   that produce a disputed meta-move annotation are not yet reachable
   through the event stream (no commit-time annotation creation for
   meta-moves; no per-annotation facet-status routing). The component
   IS rendered (the three existing badge mount sites), but a
   Playwright spec that asserts disputed styling would have to
   fabricate projection state directly (bypassing events), which only
   re-covers what Vitest already pins — no marginal value. The
   deferral is registered against two named backend follow-ups under
   §10 and §11; the Playwright cover lands as part of the second of
   those tasks (which is the wiring step the e2e exercises).

10. **Backend follow-up — `meta_move_commit_logic` — registered.** A
    new task `data_and_methodology.methodology_engine.meta_move_commit_logic`
    (effort 1.5d, depends on
    `!data_and_methodology.methodology_engine.meta_move_logic`,
    `!data_and_methodology.methodology_engine.commit_logic`; home
    milestone: the same milestone that hosts `meta_move_logic`) is
    registered by the closer in `tasks/10-data-and-methodology.tji`.
    Scope: extends `replay.ts`'s `applyCommittedProposal` meta-move
    arm (lines 687–706 per `meta_move_logic.md`) to emit an
    `annotation-created` event with the synthesised annotation id when
    a meta-move proposal commits; flips `commit_logic`'s rule 4
    rejection of `meta-move` commits to an accept; covers via Cucumber
    + pglite (`tests/behavior/methodology/commit-meta-move.feature`).
    Surfaced here as concrete agent-implementable work, NOT as a
    "revisit" / "audit" task.

11. **Backend follow-up — `annotation_facet_status_logic` —
    registered.** A new task
    `data_and_methodology.methodology_engine.annotation_facet_status_logic`
    (effort 1d, depends on `!meta_move_commit_logic`; same milestone)
    is registered by the closer. Scope: extends `computeFacetStatuses`
    (or the projection layer) to route per-participant votes on a
    meta-move proposal into per-facet status on the resulting
    annotation, exposes the result as an
    `AnnotationFacetStatusIndex: Map<string,
    Readonly<Partial<Record<FacetName, FacetStatus>>>>` through the
    moderator's session-state shape, and wires `selectAnnotations` to
    pass the populated index into `enrichAnnotationsWithFacetStatuses`
    (the seam this task shipped under §4). Also lands the Playwright
    e2e block in `tests/e2e/moderator-capture.spec.ts` that drives a
    full F8 → commit → dispute round-trip and asserts the
    `[data-facet-status="disputed"]` selector matches an annotation
    badge for the committed meta-move's target.

12. **Build + test green.** `make build && make test` clean; the
    catalog-parity, Vitest, and (untouched) Cucumber / Playwright
    suites all pass.

13. **Refinement `## Status`** block appended on landing, per the
    task-completion ritual ([tasks/refinements/README.md L32–42](../README.md#L32)).

## Decisions

### §1 — Keep `Annotation` (shell) pure; widen on a moderator-side render carrier

The optional `facetStatuses?` field lands on a **new moderator-side**
`AnnotationRenderData` type that wraps the shell's `Annotation`
interface; the shell type itself stays untouched at
`packages/shell/src/annotations/annotations.ts:56–64`.

**Rationale.** The shell's `Annotation` interface is consumed by the
audience surface, the replay surface, the moderator surface, and the
WS-projection layer (it is the projection of `annotation-created`
events). Adding a render-time field to the shell type would either
force every consumer to handle a field they don't use OR force a
parallel `AnnotationView` type anyway. A moderator-only render
carrier keeps the shell projection pure (which the audience / replay
share) and confines the new field to the surface that needs it.

**Alternative rejected.** Widen `Annotation` directly with the
optional field. Bleeds render-layer concerns into the wire-projection
type; the audience / replay surfaces (which today render annotations
without disputed state) would inherit a field they have no source
for. The shell projection should describe the wire payload, not the
render-time enrichment.

**Alternative rejected.** Land a parallel `AnnotationView` type with
no inheritance from `Annotation`. Forces a manual field-by-field
copy at the selector boundary; the `& {...}` widening of
`Annotation` keeps the shared fields single-sourced. Future
additions to `Annotation` (e.g. a `revision` field) automatically
propagate to `AnnotationRenderData` without re-syncing.

### §2 — Two-layer selector split (`projectAnnotations` → `enrichAnnotationsWithFacetStatuses`)

The annotation pipeline now reads `projectAnnotations(events) →
enrichAnnotationsWithFacetStatuses(annotations, index) →
groupAnnotationsByNode/Edge(rendered)`. The enrich step takes an
**externally-supplied** index — `Map<annotationId, facetStatuses>` —
rather than computing it inline from events.

**Rationale.** The data the enrich step needs (per-participant votes
on the originating proposal, rolled up per facet) is **not** trivially
derivable from `annotation-created` events alone — it requires walking
the proposal / vote / withdrawal stream, applying current-participant
filtering, and applying the agreement-layer lifecycle. That logic is
the methodology engine's job, not the render layer's. Splitting the
index-build out of the enrich step lets the engine populate the index
once (via `computeFacetStatuses`-style machinery) and lets the render
layer remain a pure mechanical join.

For this task the index is **always empty** (no engine path produces
it for annotations today). The seam exists so the future
`annotation_facet_status_logic` follow-up can drop in the populated
index without touching `<AnnotationBadge>` or the existing selector
wrappers.

**Alternative rejected.** Compute the index inside the enrich step by
walking events directly. Duplicates the engine's facet-status logic in
the moderator's render layer; the audience / replay surfaces would
either re-implement the duplication or diverge from the moderator's
view of disputed state. Single-sourcing the computation in the engine
and letting renderers consume the index keeps the three surfaces
aligned by construction.

**Alternative rejected.** Inline the disputed-state branch in
`<AnnotationBadge>` and hard-code today's "no annotation is ever
disputed" assumption. Wouldn't ship the renderer at all (the styling
branch would be dead code), and would require both the styling AND
the selector seam to land in the future backend task — exactly the
coupling this split exists to avoid.

### §3 — `aria-label` suffix instead of a separate `aria-description`

When the rollup is `'disputed'` or `'meta-disagreement'`, the badge
appends a localized `(disputed)` suffix onto its `aria-label` (via
`moderator.annotation.disputedAriaSuffix`). The visual treatment plus
the `data-facet-status` attribute serve sighted users and tests; the
aria-suffix serves screen-reader users.

**Rationale.** The kind label is a `text-[10px] uppercase` pill — it
is the entire visible content of the badge. Without an aria-label
augmentation, a screen reader hears the same string for an agreed
reframe and a disputed reframe. Folding the disputed state into the
aria-label is the smallest accessibility delta that closes the gap;
splitting into `aria-description` would require either an
`aria-describedby` referent (a hidden `<span>` per badge — extra DOM
per annotation, multiplied across the canvas) or platform-uneven
`aria-description` support.

**Alternative rejected.** Add an icon next to the kind label
(e.g. a small dispute marker). Icon shipment requires a per-kind icon
component, a colour token negotiation, and a sizing decision against
the `text-[10px]` baseline — all out of scope for a 0.5d task and
better left to a dedicated icon-pass refinement. The
border + ring + `data-facet-status` attribute carries the visual
weight today.

**Alternative rejected.** Re-localize the disputed marker as a longer
sentence in the aria-label (e.g. "Reframe — this annotation is
contested by at least one participant"). Verbose; the methodology
vocabulary is intentionally terse. Three-character `(disputed)`
matches the existing terse register.

### §4 — Defer Playwright; register `meta_move_commit_logic` AND `annotation_facet_status_logic` as the wiring tasks

The Playwright e2e for disputed-meta-move visibility is deferred to
`annotation_facet_status_logic` (Acceptance §11), which itself
depends on `meta_move_commit_logic` (Acceptance §10). Vitest takes
the place of e2e for this task's deliverables.

**Rationale.** The e2e the F8 narrative implies — "propose meta-move
→ commit → dispute → see disputed annotation on the graph" — requires
three things that today's stack does not provide:

1. **Commit-time annotation creation for meta-moves** (open question
   in `meta_move_logic.md:104–106`). Without this, no annotation
   exists in projection state when a meta-move commits; the
   moderator never sees a meta-move annotation at all (disputed or
   otherwise).

2. **Per-annotation facet-status routing**. Even if (1) lands,
   `computeFacetStatuses` does not route per-participant votes on
   structural proposals (meta-move is one) into per-facet status on
   the resulting annotation. Without this, the disputed signal
   doesn't reach the render layer.

3. **Frontend rendering surface** (this task). The render-side
   surface this task ships.

Items (1) and (2) are server-side. Splitting (3) off now and
deferring the Playwright cover until (1) AND (2) land is the
debt-minimising sequence: this task's Vitest pins the rendering
contract; the wiring task naturally inherits the e2e because that's
the step where the surface becomes user-reachable through events. The
brief's deferred-e2e exception rule applies: the surface IS rendered
(badges mount today), but the **conditions** that produce a disputed
annotation are not yet reachable through the event stream. A
forced-state Playwright spec would only re-cover Vitest's render-side
pins.

**Alternative rejected.** Land a Playwright spec that seeds an
annotation projection directly (bypassing the event stream) with a
pre-set `facetStatuses` field. Tests the rendering surface — but so
does Vitest, more cheaply. A Playwright spec that doesn't exercise
the event-stream path has weak regression value (it can't catch a
selector or projection-layer break) and would have to be deleted /
rewritten when the real wiring lands. The deferred-e2e exception
exists for exactly this case.

**Alternative rejected.** Land `meta_move_commit_logic` AND
`annotation_facet_status_logic` as part of this 0.5d task. Scope
inflation by an order of magnitude; both are non-trivial backend
extensions with their own Cucumber covers and their own follow-up
considerations. The clean split is: this task ships the render-side
surface (0.5d, Vitest-covered); the backend tasks ship the wiring
(separately scoped, separately reviewed, Cucumber-covered).

**Why not a single `meta_move_disputed_e2e` Playwright task?**
The Playwright cover IS the natural deliverable of
`annotation_facet_status_logic` (which is the step where the
end-to-end path becomes reachable). Splitting it into a dedicated
task would be the right move only if the wiring task were close to
shipping — at which point the e2e author needs the wired surface
anyway. Folding the e2e into the wiring task's Acceptance criteria
keeps the responsibility unfragmented.

### §5 — Meta-disagreement renders with the rose marker too

When `cardRollupStatus(facetStatuses) === 'meta-disagreement'`, the
badge renders with the same rose marker as `'disputed'`, AND stamps
`data-facet-status="meta-disagreement"` (not `"disputed"`) so the
test surface can still tell the two apart.

**Rationale.** The disputed-state styling task that landed for nodes
and edges treats meta-disagreement as the same visual class as
disputed (both signal "unsettled, attention required"); diverging
here would fragment the moderator's mental model — a node and its
annotation could be rolling up to the same status but show
different markers. Stamping the precise rollup on
`data-facet-status` keeps tests and downstream styling work able to
discriminate even though today's visual is unified.

**Alternative rejected.** Render meta-disagreement with a distinct
visual (e.g. amber-with-rose-border) to differentiate from
disputed-proper. Adds a third visual class for a state that the
existing node/edge styling already collapses; the moderator already
treats the two states as equivalent for triage. Introducing a
divergent annotation visual now would be a styling-debt seed
without a product driver.

### §6 — No per-kind disputed colour theming

The disputed visual treatment is uniform across the four annotation
kinds (`note`, `reframe`, `scope-change`, `stance`): the same
rose-600 ring goes around every kind's badge. The existing
`data-annotation-kind` seam continues to expose the kind for future
per-kind styling.

**Rationale.** Per-kind colour theming was already deferred to
`packages/ui-tokens` by `mod_annotation_rendering`'s base styling
decision (the comment at `AnnotationBadge.tsx:14–17` records the
seam). Adding per-kind disputed variants would multiply the styling
surface from one new class to four — out of scope for a 0.5d task
and forks the per-kind theming question across two refinements. The
rose marker over the kind-uniform amber base reads as "the kind is
[whichever], and the kind-coloured base is disputed" — which is the
intent.

**Alternative rejected.** Vary the rose intensity per kind (e.g.
`rose-400` for `note`, `rose-700` for `stance`). Decorates without a
methodological signal; the four kinds are equally disputable.

### §7 — `EMPTY_INDEX` lives at module scope, not constructed per call

`enrichAnnotationsWithFacetStatuses` is invoked from
`selectAnnotations` with a module-level `EMPTY_INDEX = new Map()`
singleton (or the equivalent empty index constant). Allocating a new
`Map` per selector call would churn through GC pressure on every
re-render of the moderator graph (the selectors are memoised, but a
new identity per call defeats the memoisation downstream).

**Rationale.** The selector layer is on the hot path of every graph
re-render. Stable module-level identities are the moderator's
existing pattern (`EMPTY_ANNOTATIONS`, `EMPTY_FACET_STATUSES`, etc.
already live at module scope across the codebase). Following the
pattern keeps memo identity stable until the future wiring task
populates a real index.

**Alternative rejected.** Construct the empty index inline at each
call site. Trivially wrong for the hot path; would break memoisation
of any downstream React selector that depends on referential equality.

### §8 — No `useCaptureStore` participant-list extension

Like the action and kind-selector siblings, this task does NOT consult
the participants store. It reads annotation projection state and
renders.

**Rationale.** The disputed signal is computed upstream (in the future
backend wiring task) from the methodology engine's per-participant
vote aggregation; the render layer is downstream of that computation.
The badge does not need to know about participants directly. Mirrors
Decision §6 of `mod_meta_move_kind_selector.md` and Decision §8 of
`mod_meta_move_action.md`.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-01.

- `apps/moderator/src/graph/AnnotationBadge.tsx` — extended with optional `facetStatuses` prop; rose-marker disputed branch (`border-solid border-rose-600 ring-2 ring-rose-500`) + `data-facet-status` seam + localized `aria-label` suffix (`moderator.annotation.disputedAriaSuffix`) for both `'disputed'` and `'meta-disagreement'` rollups.
- `apps/moderator/src/graph/selectors.ts` — added `AnnotationRenderData` carrier type, `AnnotationFacetStatusIndex`, module-level `EMPTY_INDEX`, and `enrichAnnotationsWithFacetStatuses` selector; `selectAnnotations` wired to thread through the empty index (no-op today; seam for the backend wiring task).
- `apps/moderator/src/graph/AnnotationBadge.test.tsx` — 10 new cases: 4 × disputed-rollup (per kind) + 4 × meta-disagreement-rollup (per kind) + 2 baseline-preservation cases (agreed, committed); existing 12 cases untouched.
- `apps/moderator/src/graph/enrichAnnotationsWithFacetStatuses.test.ts` (new) — 4 cases: empty-index pass-through, matching-hit enrichment, unknown-id ignored, no-mutation.
- `packages/i18n-catalogs/src/catalogs/en-US.json` — `moderator.annotation.disputedAriaSuffix` key added ("(disputed)").
- `packages/i18n-catalogs/src/catalogs/pt-BR.json` + `es-419.json` — key added (PENDING native review, covered by the 2026-05-30 parking-lot entry).
- `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` + `es-419.review.json` — PENDING markers added for the new disputed aria suffix key.
- Playwright e2e deferred (Decision §4); lands with `annotation_facet_status_logic` (see WBS entry `data_and_methodology.methodology_engine.annotation_facet_status_logic` registered in this commit).
- Backend follow-ups registered in `tasks/10-data-and-methodology.tji`: `meta_move_commit_logic` (1.5d) and `annotation_facet_status_logic` (1d), both wired to M7.
