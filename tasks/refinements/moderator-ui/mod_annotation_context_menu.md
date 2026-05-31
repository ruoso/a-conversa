# Dedicated annotation-node context menu with annotation-specific items

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_annotation_context_menu` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L766-L778). Embedded note: *"Source of debt: mod_propose_annotation_endpoint_gestures (2026-05-31) — the existing right-click context menu opens on annotation nodes (after handleNodeContextMenu widening) but shows unchanged items. A dedicated AnnotationContextMenu component with annotation-specific items (e.g. 'annotate this annotation', 'withdraw annotation') was deferred for v1 per Decision §6 of that task. Split out when annotation-specific items materialize."*

## Effort estimate

**1.5d** (revised up from the `.tji` 0.5d allocation per Decision §1 — closer adjusts the WBS). Rationale: the .tji estimate assumed wire-side support for annotation-targeted proposals would land in a separate task before this one, but no such wire task exists today (the `annotate` proposal schema accepts only `target_kind: 'node' | 'edge'` per [`proposals.ts:461`](../../../packages/shared-types/src/events/proposals.ts#L461)). Bundling the minimum-viable wire widening keeps the menu items real rather than stubs.

Breakdown:

- **Wire-side annotate widening** (~0.4d). Widen [`annotateProposalSchema` at `proposals.ts:459-466`](../../../packages/shared-types/src/events/proposals.ts#L459-L466)'s `target_kind` enum to `z.enum(['node', 'edge', 'annotation'])`. Widen [`validateAnnotateProposal` at `propose.ts:1080-1129`](../../../apps/server/src/methodology/handlers/propose.ts#L1080-L1129) with a third `targetKind === 'annotation'` arm: existence via `projection.getAnnotation(targetId)` (or the equivalent index lookup the projection layer already exposes for annotation-endpoint visibility checks); visibility via `entityIsVisible(projection, 'annotation', targetId)` (already imported at L260, used elsewhere at L1446 / L1465). Cucumber + Vitest cover for the new arm.
- **UI hook widening** (~0.15d). Widen [`AnnotateTargetKind` at `useAnnotateAction.ts:56`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L56) to `'node' | 'edge' | 'annotation'`. The proposal-build path at L228-234 threads `targetKind` verbatim into `target_kind` — no other change needed (the schema gate now accepts the new value).
- **Dedicated annotation menu factory + routing** (~0.35d). New `buildAnnotationMenuItems(target, onOpenAnnotateSubmenu, onOpenMetaDisagreeSubmenu)` factory exported from [`GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) (alongside the existing `buildNodeMenuItems` / `buildEdgeMenuItems` / `buildPaneMenuItems` factories). Widen `ContextMenuState.target.kind` from the current `'node' | 'edge' | 'pane'` to `'node' | 'edge' | 'pane' | 'annotation'`; widen [`GraphContextMenu`'s `targetKind` prop](../../../apps/moderator/src/graph/GraphContextMenu.tsx) to match. Branch the menu-item selection at the JSX mount site (~L1601-1609 today) on the four kinds. The existing [`handleNodeContextMenu` at `GraphCanvasPane.tsx:1033-1046`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1033-L1046) already discriminates annotation vs node via `endpointKindFromNodeType(node.type)` for the selection-dispatch — extend the same discriminator to set `contextMenu.target = { kind: 'annotation', id: node.id }` for annotation nodes instead of hardcoding `kind: 'node'`.
- **AnnotateSubmenu pass-through** (~0.1d). The existing [AnnotateSubmenu wiring at `GraphCanvasPane.tsx:1515-1520`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1515-L1520) sets `{ targetId, targetKind: 'node', x, y }` — widen the submenu state's `targetKind` and the open-callback signature to admit `'annotation'`. The submenu's downstream `useAnnotateAction(targetId, targetKind)` call (per the hook's signature) now binds to an annotation target without further change.
- **i18n keys + catalog parity** (~0.1d). New `moderator.contextMenu.annotation.{annotate, metaDisagree}` keys in all three locale catalogs (en-US / pt-BR / es-419). Native-speaker translation review is parked (Open questions §1; surfaced to parking lot).
- **Vitest cover** (~0.3d). Cases for: schema widening (one accepted-target-kind-annotation case + the rejected-no-target-id regression case); validator widening (annotation-target accepts visible-annotation, rejects unknown-id, rejects invisible-annotation); hook widening (a `useAnnotateAction(annotationId, 'annotation')` round-trip emits a proposal with `target_kind: 'annotation'`); menu factory (`buildAnnotationMenuItems` returns the documented 2 items in order); routing (`handleNodeContextMenu` on an annotation node sets `contextMenu.target.kind === 'annotation'`); menu mount (the annotation branch renders the annotation items).
- **Cucumber cover** (~0.1d). One scenario in `apps/server/src/test/methodology/methodology.feature` (or whichever feature owns annotate validation) for the annotate-targeting-annotation success + invisible-annotation rejection arm.
- **Playwright cover** (~0.0d — deferred per Decision §6). Reuses the existing [`tests/e2e/annotation-endpoint-gestures.spec.ts`](../../../tests/e2e/annotation-endpoint-gestures.spec.ts) seed seam; one new scenario right-clicks an annotation node, picks "Annotate this annotation", and asserts the round-trip mints an annotation-of-annotation per the existing rendering chain (see Decision §6 for the alternative considered — deferring to `mod_pw_full_session_run` was rejected; the gesture is the user-visible delta this task ships).

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_propose_annotation_endpoint_gestures`](./mod_propose_annotation_endpoint_gestures.md) (done — 2026-05-31). Decision §6 explicitly deferred this task with the wording "split out when annotation-specific items materialize." Shipped:
  - `handleNodeContextMenu` discriminates `endpointKindFromNodeType` for the SELECTION dispatch ([`GraphCanvasPane.tsx:1033-1046`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1033-L1046)) — today the selection becomes `{ kind: 'annotation', id }` but the `contextMenu.target.kind` is still hardcoded `'node'`. This task closes that asymmetry.
  - `<AnnotationNode>` exposes ReactFlow `Handle`s and `data-testid="annotation-node-<id>"` ([`AnnotationNode.tsx:72, 102-103`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L72)) — the test seam for the Playwright right-click.
  - `<GraphContextMenu>` accepts a kind-discriminated `targetKind` ([`GraphContextMenu.tsx:56-76`](../../../apps/moderator/src/graph/GraphContextMenu.tsx#L56-L76)) — the prop union widens by one variant.

- [`moderator_ui.mod_annotation_ui.mod_annotation_capture_auto_suggest`](./mod_annotation_capture_auto_suggest.md) (done — 2026-05-31). Established the kind-aware entity model (`selectMostRecentlyActiveEntity` returns `{kind, id}|null`; `setTargetEntity(kind, id)` atomic setter). This task reuses the same `EntityKind`-narrowed-to-`'node' | 'annotation'` discriminator at the menu layer.

- [`moderator_ui.mod_graph_rendering.mod_context_menus`](./mod_context_menus.md) (done — 2026-05-11). The original context-menu shell. Its decision "action handlers are stubs that downstream tasks replace" is the pattern this task extends — but per Decision §1 here, this task BUNDLES the wire so its v1 items are real, not stubs.

- [`moderator_ui.mod_annotation_ui.mod_propose_annotation_action`](./mod_propose_annotation_action.md) (done). Shipped `useAnnotateAction` + `AnnotateSubmenu`. The hook's `AnnotateTargetKind` widens; the submenu's `targetKind`-aware UX (kind-radio picker + content textarea) unchanged.

- [`moderator_ui.mod_annotation_ui.mod_annotation_kind_tagging`](./mod_annotation_kind_tagging.md) (done). Shipped the 4-option `AnnotationKind` picker on the submenu — reused as-is for annotation-targeting-annotation proposals.

- [`moderator_ui.mod_annotation_ui.mod_annotation_of_annotation_overlay_chain`](./mod_annotation_of_annotation_overlay_chain.md) (done — 2026-05-31). Shipped the RENDERING side of annotation-of-annotation overlays — `<AnnotationNode>` already renders a nested-annotations badge row when `data.annotations.length > 0` ([`AnnotationNode.tsx:116-122`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L116-L122)). This task is the GESTURE side that emits the annotation-on-annotation `annotate` proposal that flows into that renderer.

- [`data_and_methodology.methodology_engine.set_edge_substance_annotation_endpoint`](../data-and-methodology/set_edge_substance_annotation_endpoint.md) (done — 2026-05-30). Established `entityIsVisible(projection, 'annotation', id)` as a first-class visibility check — already consumed at [`propose.ts:1446` / `:1465`](../../../apps/server/src/methodology/handlers/propose.ts) for set-edge-substance annotation endpoints. The annotate validator's new arm consumes the same helper.

- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). Schema-on-write; the annotate envelope's enum widening is the first-line gate.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest + Cucumber + Playwright cover.

- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md). Two new keys in three locales; catalog parity check stays green.

- [ADR 0007 — Cucumber+pglite for methodology-engine tests](../../../docs/adr/0007-test-framework-cucumber.md). The validator's new arm gets a scenario.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

Today, right-clicking a `<AnnotationNode>` opens the regular **node** context menu, populated with items that semantically don't apply to annotations: `propose-vote`, `propose-decompose`, `propose-interpretive-split`, `propose-edit-wording`, `run-operationalization-test`, `run-warrant-elicitation-test`, `axiom-mark`. The items don't crash — they either no-op or fail-silent at validator-side checks (most key off `projection.getNode(targetId)` returning `undefined` for annotation ids) — but they clutter the menu with non-applicable actions and surface no annotation-specific affordances. The predecessor `mod_propose_annotation_endpoint_gestures` explicitly accepted this as a v1 UX gap (its Decision §6) and registered this task to close it.

This task:

1. **Routes annotation-node right-clicks to a dedicated annotation context menu**. `handleNodeContextMenu` already discriminates `endpointKindFromNodeType(node.type)` for the selection dispatch — the same discriminator extends to the menu's `contextMenu.target.kind`. The menu-mount branch in the JSX gains a fourth arm: `annotation` → renders the items returned by `buildAnnotationMenuItems`. `<GraphContextMenu>`'s `targetKind` prop union widens from `'node' | 'edge' | 'pane'` to also admit `'annotation'`.

2. **Ships two real v1 menu items** (Decision §2):
   - **"Annotate this annotation"** — opens the existing `AnnotateSubmenu` against the annotation target. The submenu's kind-radio (note / reframe / scope-change / stance) and content textarea operate verbatim; the submitted proposal is `{ kind: 'annotate', target_kind: 'annotation', target_id: <ann-id>, annotation_kind: <picked>, content: <text> }`. Renders into the existing annotation-of-annotation chain (predecessor `mod_annotation_of_annotation_overlay_chain` already wired the nested-annotation badge rendering).
   - **"Disagree with this annotation"** — opens the same submenu pre-set to `annotation_kind: 'meta-disagreement'`. Mirrors the node menu's `propose-meta-disagreement` item, which is itself an `annotate` proposal with `annotation_kind` defaulted to the meta-disagreement variant.

3. **Bundles the minimum wire-side widening** (Decision §1) to make those items real, not stubs. Specifically:
   - `annotateProposalSchema.target_kind` widens from `z.enum(['node', 'edge'])` to `z.enum(['node', 'edge', 'annotation'])`.
   - `validateAnnotateProposal` grows a third arm that checks annotation existence + visibility via `entityIsVisible(projection, 'annotation', targetId)`.
   - `useAnnotateAction.AnnotateTargetKind` widens from `'node' | 'edge'` to `'node' | 'edge' | 'annotation'`.

4. **Vitest + Cucumber + Playwright cover** pins each branch and the user-observable contract: right-clicking an annotation node opens the dedicated menu; picking "Annotate this annotation" + filling the submenu round-trips an annotation-of-annotation proposal; the wire schema accepts annotation-target annotates; the validator rejects unknown / invisible annotation targets.

Out of scope (registered under Decisions §3 + §7):

- **"Withdraw annotation" item**. The .tji note names this as an example item, but the wire-side prerequisite — annotation-retraction semantics — needs an architecture decision before it can be implemented (see Decision §3 and Open questions §2). Surfaced to parking lot; not registered as a WBS task today.
- **"Edit annotation content" item**. No existing proposal kind addresses annotation content; would require a fresh `edit-annotation-content` proposal type. Not currently demanded by any walkthrough scenario. Surfaced to parking lot.
- **Annotation-pane right-click on the empty annotation badge-list**. The badge-list inside `<AnnotationNode>` is not a separate ReactFlow node; right-click events bubble to the parent annotation node and route through `handleNodeContextMenu` correctly. No separate seam needed.
- **Cross-surface (participant / audience) analogues**. Read-only surfaces — no propose gestures, no context menus on annotation nodes there. No sibling task surfaces in those areas.

## Why it needs to be done

**The current UX is broken**, not just incomplete. After `mod_propose_annotation_endpoint_gestures` shipped, right-clicking an annotation opens a node menu listing actions that cannot apply to annotations. The items don't error visibly — they fail-silent at validator level — but the moderator sees a menu of irrelevant choices. The predecessor explicitly accepted this as a v1 gap, deferring its fix to this task.

**The annotation-of-annotation rendering chain is live but has no gesture path.** The predecessor `mod_annotation_of_annotation_overlay_chain` (done 2026-05-31) shipped `<AnnotationNode>` rendering of the nested-`annotations` badge row when `data.annotations.length > 0` — but there is no moderator gesture today that EMITS an `annotate` proposal targeting an annotation. The renderer waits for a proposal flavor the schema rejects. This task closes the loop: the menu's "Annotate this annotation" item is the gesture path that feeds the rendering chain.

**"Disagree with this annotation" is a real walkthrough need.** The methodology spec treats meta-disagreement as a first-class moderator action; disagreeing with an annotation (e.g., the moderator thinks a participant's `scope-change` annotation misrepresents the original claim) is a coherent move that the node menu's `propose-meta-disagreement` already supports for nodes. Extending it to annotations completes symmetry.

**The wire-side widening is one-and-done.** Today's `target_kind: z.enum(['node', 'edge'])` is a deliberate cutoff from when annotations weren't entities. Now that `EntityKind` is `'node' | 'edge' | 'annotation'` everywhere (selection, capture target, projection visibility, edge endpoints), the annotate enum is the last holdout. Widening it removes a special-case at every future entity-target check.

## Inputs / context

### The menu-routing seam

- [`apps/moderator/src/graph/GraphContextMenu.tsx:56-76`](../../../apps/moderator/src/graph/GraphContextMenu.tsx#L56-L76) — `GraphContextMenuProps` declares `targetKind: 'node' | 'edge' | 'pane'`. Widens to also admit `'annotation'`.
- [`apps/moderator/src/graph/GraphContextMenu.tsx:114-116`](../../../apps/moderator/src/graph/GraphContextMenu.tsx#L114-L116) — the `data-target-kind={targetKind}` attribute on the menu root. Picks up `'annotation'` for the new branch; existing Playwright/Vitest selectors continue to work for the other kinds.
- [`apps/moderator/src/graph/GraphContextMenu.tsx:41-54`](../../../apps/moderator/src/graph/GraphContextMenu.tsx#L41-L54) — `MenuItem = { id: string; labelKey: string; onSelect: () => void; disabled?: boolean }`. Shape stays; the annotation items reuse it verbatim.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1033-1046`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1033-L1046) — `handleNodeContextMenu` already calls `endpointKindFromNodeType(node.type)` for the selection dispatch (`{ kind: 'annotation', id }` on annotation nodes). Widening: the same discriminator threads into `setContextMenu({ target: { kind: <discriminated>, id: node.id }, x, y })`. The `ContextMenuState.target` type widens to admit `kind: 'annotation'`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1601-1609`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) (approximate mount-site line per the predecessor refinement) — the menu JSX. The `menuItems` derivation widens from a three-way `switch` (`'node' | 'edge' | 'pane'`) to a four-way `switch` including `'annotation' → buildAnnotationMenuItems(...)`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:326-406`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L326-L406) — `buildNodeMenuItems` is the precedent factory. `buildAnnotationMenuItems` follows the same shape (function returning `readonly MenuItem[]`, taking `(target, onOpenAnnotateSubmenu, onOpenMetaDisagreeSubmenu)`).

### The AnnotateSubmenu seam

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:1515-1520`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L1515-L1520) — the `setAnnotateSubmenu({ targetId, targetKind: 'node', x, y })` callback wired into `buildNodeMenuItems`. Today its `targetKind` is union-typed `'node' | 'edge'`; widens to `'node' | 'edge' | 'annotation'`. The annotation menu's "Annotate this annotation" item calls `setAnnotateSubmenu({ targetId, targetKind: 'annotation', x, y })`.
- [`apps/moderator/src/layout/useAnnotateAction.ts:56`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L56) — `export type AnnotateTargetKind = 'node' | 'edge';`. Widens to `'node' | 'edge' | 'annotation'`.
- [`apps/moderator/src/layout/useAnnotateAction.ts:159-161`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L159-L161) — the hook signature `useAnnotateAction(targetId: string, targetKind: AnnotateTargetKind): UseAnnotateActionResult`. Verbatim; the widened type alias propagates through.
- [`apps/moderator/src/layout/useAnnotateAction.ts:228-234`](../../../apps/moderator/src/layout/useAnnotateAction.ts#L228-L234) — the proposal-build path. `target_kind: targetKind, target_id: targetId` threads the widened kind into the schema-gated envelope.

### The "disagree" pre-set seam

The node menu's `propose-meta-disagreement` item (per the existing `buildNodeMenuItems` precedent) opens the AnnotateSubmenu with the kind-radio pre-set to `'meta-disagreement'`. Search the existing buildNodeMenuItems implementation at [`GraphCanvasPane.tsx:326-406`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L326-L406) for the `propose-meta-disagreement` item — it sets an `initialAnnotationKind: 'meta-disagreement'` prop on the submenu (or equivalent — exact prop name is implementation-defined). The annotation menu's "Disagree with this annotation" item mirrors that.

### The wire-side seam

- [`packages/shared-types/src/events/proposals.ts:459-466`](../../../packages/shared-types/src/events/proposals.ts#L459-L466) — `annotateProposalSchema`. The `target_kind` enum widens by one variant.
- [`apps/server/src/methodology/handlers/propose.ts:1080-1129`](../../../apps/server/src/methodology/handlers/propose.ts#L1080-L1129) — `validateAnnotateProposal`. The existing `if (targetKind === 'node')` / `else` (edge) structure gets a third arm for `targetKind === 'annotation'`. The arm uses `entityIsVisible(projection, 'annotation', targetId)` (already imported at L260, used at L1446 / L1465 for set-edge-substance annotation-endpoint visibility). Existence check: there's no `projection.getAnnotation` today per the explore survey — the projection's annotation index is the source. Implementer reads the existing visibility-check pattern at L1446 / L1465 (it presumably handles existence + visibility together; if it only checks visibility, the validator falls back to an explicit "annotation does not exist in projection" pre-check via the same index).
- [`apps/server/src/methodology/handlers/propose.ts:260`](../../../apps/server/src/methodology/handlers/propose.ts#L260) — `entityIsVisible` import. Already in scope.

### Selection / target store contracts (already widened)

- [`apps/moderator/src/stores/selectionStore.ts:15-25`](../../../apps/moderator/src/stores/selectionStore.ts#L15-L25) — `Selection { kind: EntityKind; id: string }` where `EntityKind = 'node' | 'edge' | 'annotation'`. No shape change.
- [`apps/moderator/src/stores/recentlyActiveNode.ts:35-41`](../../../apps/moderator/src/stores/recentlyActiveNode.ts) — `selectMostRecentlyActiveEntity` already returns `{ kind: 'node' | 'annotation'; id } | null` (post-predecessor rename). Not consumed by this task, but confirms the canvas's kind-aware-entity stance.

### i18n catalogs

- `packages/i18n-catalogs/src/catalogs/en-US.json` already carries the `moderator.contextMenu.{node,edge,pane}.*` subtrees. The new `moderator.contextMenu.annotation.{annotate, metaDisagree}` keys land in all three locale catalogs (en-US / pt-BR / es-419). Native-speaker translation review for pt-BR / es-419 is parked (Open questions §1).

### Sibling precedent

- [`tasks/refinements/moderator-ui/mod_context_menus.md`](./mod_context_menus.md) — the original menu shell. Established the stub-then-replace pattern; this task uses real handlers from v1 (Decision §1) instead, because the wire prereq is small enough to bundle.
- [`tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md`](./mod_propose_annotation_endpoint_gestures.md) — Decision §6 deferred this task. Decision §4 of that refinement (rejected "stage as capture target" as a menu item) shapes the v1 item set here: the discoverable-only test wasn't appropriate for staging because the click-to-stage gesture covers it; the same test is what `annotate` / `meta-disagree` PASS — these are NOT redundantly reachable today; the menu is their first surface.
- [`tasks/refinements/moderator-ui/mod_propose_annotation_action.md`](./mod_propose_annotation_action.md) — the annotate gesture precedent. The hook + submenu shape this task widens.
- [`tasks/refinements/data-and-methodology/set_edge_substance_annotation_endpoint.md`](../data-and-methodology/set_edge_substance_annotation_endpoint.md) — the wire-side precedent for `entityIsVisible(projection, 'annotation', id)` becoming a first-class check. The annotate validator follows the same shape.

### Existing Playwright seed seam

- [`tests/e2e/annotation-endpoint-gestures.spec.ts`](../../../tests/e2e/annotation-endpoint-gestures.spec.ts) — the gesture-test spec from the predecessor. Reuses the WS-state seed seam at [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) which already supports annotation events. This task adds a new scenario (or a new spec file under `tests/e2e/annotation-context-menu.spec.ts`) using the same seed.

## Constraints / requirements

1. **The annotation menu's items must be real, not stubs.** Decision §1 bundles the minimum wire-side widening so v1 ships working items. The stub-then-replace pattern from `mod_context_menus` is appropriate when downstream tasks are clearly queued — here the wire is small enough to land alongside the UI.

2. **`handleNodeContextMenu`'s discrimination stays single-sourced.** The same `endpointKindFromNodeType(node.type)` call that resolves the selection-dispatch kind also resolves the `contextMenu.target.kind`. Two parallel calls would risk drift; one resolve-then-thread is the maintainable shape.

3. **`<GraphContextMenu>` shape is purely additive.** The widening adds one variant to the `targetKind` prop union; no field renames, no breaking changes to existing call sites. The component's render path, close-on-outside/Escape behavior, and test seams (`data-testid="graph-context-menu"`, `data-target-kind`, `data-target-id`) stay identical.

4. **The annotation menu items reuse the AnnotateSubmenu verbatim.** No new submenu component, no new kind-picker. The submenu's `targetKind` prop union widens; the rest of its UX is unchanged. Reduces both implementation cost and test surface duplication.

5. **The wire-side widening is along the existing polymorphic-endpoint seam.** `entityIsVisible(projection, 'annotation', id)` already exists and is consumed elsewhere. The annotate validator's new arm is a third `if/else` in the existing structure, not a new validation pipeline.

6. **No new ADR.** The architectural seams (`EntityKind` discriminated union, schema-on-write `target_kind` enums, kind-aware projection visibility checks) all exist. This task is a widening along established seams — no new dependency, no new abstraction.

7. **No projection layer change.** Annotation visibility and existence are already projected for set-edge-substance's polymorphic endpoints. The annotate validator's new arm consumes the existing projection surface.

8. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). The widened `AnnotateTargetKind`, `GraphContextMenuProps.targetKind`, and `ContextMenuState.target` unions satisfy `exactOptionalPropertyTypes` — they're required discriminators, not optional.

9. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). Two new keys (`moderator.contextMenu.annotation.annotate`, `moderator.contextMenu.annotation.metaDisagree`); the catalog-parity check stays green at +2 keys per locale. English strings: "Annotate this annotation" and "Disagree with this annotation". Native-speaker translation review for pt-BR / es-419 is parked.

10. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Each new branch + new helper + new prop ships pinned cover.

11. **Cucumber cover IS in scope** ([ADR 0007](../../../docs/adr/0007-test-framework-cucumber.md)). The annotate validator change crosses the methodology-engine seam; a Cucumber scenario pins the propose-annotate-on-annotation success + invisible-target rejection arm. Without it the validator extension would have only Vitest cover, which doesn't exercise the propose handler's full dispatch path.

12. **Playwright cover IS in scope** — the surface is reachable. A scoped new spec or scenario (per Decision §6) drives a moderator right-click on an annotation node, picks "Annotate this annotation" from the dedicated menu, fills the submenu, and asserts the round-trip mints the annotation-of-annotation per the existing renderer chain.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, a Cucumber scenario, a Playwright spec, or a CI script — no throwaway probes.

**Source edits — wire-side**

- [ ] `packages/shared-types/src/events/proposals.ts`:
  - `annotateProposalSchema.target_kind` widens from `z.enum(['node', 'edge'])` to `z.enum(['node', 'edge', 'annotation'])` (L461).
- [ ] `apps/server/src/methodology/handlers/propose.ts`:
  - `validateAnnotateProposal` (L1080-1129) gains a third arm for `targetKind === 'annotation'`. Existence: looks up the annotation via the projection's annotation index (the same lookup used by `entityIsVisible(projection, 'annotation', id)` internally — implementer reads the existing helper's source for the canonical access pattern). Visibility: `entityIsVisible(projection, 'annotation', targetId)`. Rejection reasons mirror the existing arms: `'target-entity-not-found'` for missing, `'illegal-state-transition'` for invisible.

**Source edits — moderator UI**

- [ ] `apps/moderator/src/layout/useAnnotateAction.ts`:
  - `AnnotateTargetKind` (L56) widens to `'node' | 'edge' | 'annotation'`.
- [ ] `apps/moderator/src/graph/GraphContextMenu.tsx`:
  - `GraphContextMenuProps.targetKind` (L56-76) widens from `'node' | 'edge' | 'pane'` to `'node' | 'edge' | 'pane' | 'annotation'`.
- [ ] `apps/moderator/src/graph/GraphCanvasPane.tsx`:
  - `ContextMenuState.target.kind` (~L100 — the existing type declaration for the context-menu state) widens to admit `'annotation'`.
  - `handleNodeContextMenu` (L1033-1046) uses `endpointKindFromNodeType(node.type)` (already called for the selection dispatch at L1035) to also set `contextMenu.target.kind` — not hardcoded `'node'`. The destructured kind value flows through to `setContextMenu`.
  - New `buildAnnotationMenuItems(target, onOpenAnnotateSubmenu, onOpenMetaDisagreeSubmenu): readonly MenuItem[]` factory, exported, mirroring the shape of `buildNodeMenuItems`. Returns two items in order:
    - `{ id: 'annotate', labelKey: 'moderator.contextMenu.annotation.annotate', onSelect: () => onOpenAnnotateSubmenu({ targetId: target.id, targetKind: 'annotation', x, y }) }`
    - `{ id: 'meta-disagree', labelKey: 'moderator.contextMenu.annotation.metaDisagree', onSelect: () => onOpenMetaDisagreeSubmenu({ targetId: target.id, targetKind: 'annotation', initialAnnotationKind: 'meta-disagreement', x, y }) }` (the `initialAnnotationKind` field reuses the existing node-side meta-disagree opener — if the existing opener differs in shape, the implementer reads `buildNodeMenuItems` at L326-406 to mirror the exact contract).
  - The `menuItems` derivation at the JSX mount site (~L1601-1609) gains an `'annotation' → buildAnnotationMenuItems(...)` arm in the kind-switch.
  - The `setAnnotateSubmenu` state shape widens its `targetKind` to admit `'annotation'`; the existing wire-up at L1515-1520 stays for the node case.
- [ ] `apps/moderator/src/graph/GraphCanvasPane.test.tsx` — gains the annotation-routing + factory cases.

**Source edits — i18n**

- [ ] `packages/i18n-catalogs/src/catalogs/en-US.json` — `moderator.contextMenu.annotation.annotate` = `"Annotate this annotation"`; `moderator.contextMenu.annotation.metaDisagree` = `"Disagree with this annotation"`.
- [ ] `packages/i18n-catalogs/src/catalogs/pt-BR.json` — placeholder translations (best-effort moderator-team-suggested); native-speaker review is parked (Open questions §1).
- [ ] `packages/i18n-catalogs/src/catalogs/es-419.json` — same.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `packages/shared-types/src/events/proposals.test.ts`:
  - `annotateProposalSchema` accepts `target_kind: 'annotation'` with a valid annotation-id UUID (regression cases for `'node'` and `'edge'` stay).
  - Schema rejects `target_kind: 'unknown'`.
- [ ] `apps/server/src/methodology/handlers/propose.test.ts`:
  - `validateAnnotateProposal` accepts annotation target when annotation exists + is visible.
  - Rejects with `'target-entity-not-found'` when annotation id is unknown.
  - Rejects with `'illegal-state-transition'` when annotation exists but is invisible (e.g., its host node has been broken / superseded — exact reachability depends on the projection's annotation-invisibility rules; the test fixture mirrors the set-edge-substance precedent's invisible-annotation setup).
- [ ] `apps/moderator/src/layout/useAnnotateAction.test.tsx`:
  - `useAnnotateAction(annotationId, 'annotation')` round-trip emits a proposal whose `target_kind === 'annotation'` and `target_id === annotationId`.
  - In-flight guard / lastError plumbing (existing) regresses for the annotation case.
- [ ] `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:
  - `handleNodeContextMenu` on an annotation node sets `contextMenu.target.kind === 'annotation'`.
  - `buildAnnotationMenuItems` returns exactly two items in the documented order with the documented `labelKey`s.
  - Right-clicking a rendered annotation node opens a menu with `data-target-kind="annotation"` containing both items.
  - Picking "annotate" opens the AnnotateSubmenu with `targetKind: 'annotation'`.
  - Picking "meta-disagree" opens the submenu with `targetKind: 'annotation'` and `initialAnnotationKind: 'meta-disagreement'`.
- [ ] `apps/moderator/src/graph/GraphContextMenu.test.tsx`:
  - Rendering with `targetKind="annotation"` stamps `data-target-kind="annotation"` (parity check for the new variant).
  - Existing node/edge/pane cases continue to pass.

**Cucumber coverage** (committed scenarios, ADR 0007)

- [ ] `apps/server/src/test/methodology/methodology.feature` (or the file owning annotate validation) — one new scenario: "Moderator proposes annotate targeting an annotation"; given a session with a visible annotation A1, when the moderator emits an annotate proposal with `target_kind: 'annotation', target_id: A1`, then the proposal is accepted and an `annotation-created` event is committed for the new annotation A2 with `target_kind: 'annotation', target_id: A1` per the existing annotation-created event shape (the event shape is verified by the predecessor `mod_annotation_of_annotation_overlay_chain`'s renderer — it already consumes annotation-of-annotation data).
- [ ] Same feature file — second scenario: "Moderator's annotate-on-annotation rejects when target annotation is invisible"; the validator returns `'illegal-state-transition'`.

**Playwright coverage** — surface is reachable; new scenario in the existing annotation spec

- [ ] `tests/e2e/annotation-context-menu.spec.ts` (new file) — one scenario: Seed: `session-created` + `node-created` (N1) + `annotation-created` (A1 targeting N1) + the promotion `edge-created` so A1 is a materialized canvas node. Gesture: right-click `[data-testid="annotation-node-A1"]`; assert the menu has `data-target-kind="annotation"` and shows both `graph-context-menu-item-annotate` + `graph-context-menu-item-meta-disagree`. Click `annotate`; assert the AnnotateSubmenu opens with `data-target-kind="annotation"` and `data-target-id="A1"`. Pick `reframe` (or any kind), type content, click submit; assert the WS propose round-trip fires with `kind: 'annotate', target_kind: 'annotation', target_id: 'A1', annotation_kind: 'reframe', content: <typed>`; assert the canvas's A1 annotation node gains a badge in the nested-annotations row (per the predecessor's rendering chain).
- [ ] `playwright.config.ts` — add a `chromium-moderator-annotation-context-menu` project mirroring the predecessor's project entry.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator with new keys).
- [ ] `pnpm run test:smoke` green (Vitest count rises by ~12 cases — schema × 2, validator × 3, hook × 1, canvas pane × 5, context menu × 1).
- [ ] `pnpm -F @a-conversa/server build` succeeds (the validator widening could regress server typing if `target_kind` consumers exhaustiveness-check on the union).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L766-L778.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_annotation_context_menu` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md"` line.
- [ ] If the closer accepts the effort revision per Decision §1, the `effort 0.5d` line updates to `effort 1.5d`. (Or the closer leaves it as-is and notes the under-estimate in the Status block — implementer's choice driven by site conventions.)
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual.

## Decisions

### §1. **Bundle the minimum wire-side annotate widening** with the menu shell, rather than ship UI-only stubs.

The .tji note positions this task as a v1 split-out "when annotation-specific items materialize," implying that wire-side work would precede this task. In reality no wire task has been queued: `annotateProposalSchema.target_kind` is still `z.enum(['node', 'edge'])` (L461), and `useAnnotateAction.AnnotateTargetKind` is still `'node' | 'edge'` (L56). The two paths forward:

- **Bundle (chosen)**: widen the schema + validator + hook in this task. v1 items are real. Effort rises from 0.5d to ~1.5d.
- **Split**: ship the menu shell with stub items (the `mod_context_menus` stub-then-replace pattern); register a `wire_annotate_annotation_targets` task for the wire widening + a `mod_annotation_context_menu_activate_items` task for replacing the stubs. Effort stays at 0.5d for this task but introduces two follow-ups.

The split alternative has two concrete costs that outweigh its effort discipline:

- **Stubs in a context menu are bad UX, and the stub pattern from `mod_context_menus` was a v0 expedient that has long since been replaced by real handlers everywhere.** Re-introducing stubs on a new annotation menu in 2026 (when the surface around it is fully wired) would be a regression in UI maturity. A user right-clicking an annotation, picking "Annotate this annotation," and getting a `console.info` no-op is worse than no menu at all.
- **The wire widening is genuinely small** — one schema enum value, one validator arm following an existing shape (`entityIsVisible(projection, 'annotation', id)` already exists). Splitting it into a separate task adds planning overhead (two refinements, two PRs, two closer rituals) for ~0.4d of mechanical extension along established seams.

Bundling preserves cohesion: this task's deliverable is "moderators can act on annotations via right-click," which requires both the menu shell and the wire. Splitting would deliver "moderators can right-click an annotation and see a menu that does nothing yet" — which is not a useful intermediate state.

The closer adjusts the .tji `effort` line (or accepts the under-estimate in the Status block; either is consistent with how prior tasks reconciled estimate drift).

### §2. **Two v1 items**: "Annotate this annotation" and "Disagree with this annotation".

The .tji note's named candidates are "annotate this annotation" and "withdraw annotation." Withdraw is deferred (Decision §3); the second v1 item is "Disagree with this annotation" instead — a meta-disagreement-on-annotation, mirroring the node menu's `propose-meta-disagreement` item.

The strongest alternatives:

- **Ship only "Annotate this annotation"** (one v1 item). Rejected because meta-disagreement-on-annotation comes free from the same wire widening — the annotate validator's new arm accepts ANY `annotation_kind`, including `'meta-disagreement'`. The marginal cost of a second menu item is one i18n key + one menu-factory entry + one Vitest case. Two items also better matches the node menu's vocabulary (which separates `annotate` from `propose-meta-disagreement` as distinct items even though they emit the same proposal kind).
- **Bundle "Withdraw annotation" too** (three v1 items). Rejected because withdraw needs an architectural call first (Decision §3 + Open questions §2).
- **Bundle "Use as edge endpoint" affordances** (drag-handle / capture-pane shortcuts). Rejected because the underlying gestures (drag-edge from annotation handle; capture-with-annotation-target) are already discoverable via direct manipulation per `mod_propose_annotation_endpoint_gestures`; a menu item would duplicate without adding affordance.

### §3. **"Withdraw annotation" is NOT in scope**; surfaced to parking lot as a human-decision item.

The .tji note names withdraw as a v1 example item, but the wire-side prerequisite is non-trivial: today, annotations do NOT mint structural entities at propose-time (per the comment at `apps/server/src/ws/handlers/withdraw.ts:577-583`, the `withdraw-proposal` handler's retraction switch has no `annotate` arm because there's nothing structural to retract — annotations only materialize as `annotation-created` events at commit time, and the existing withdraw machinery operates on pre-commit retraction of structural events).

The architectural question: **do annotations need post-commit withdrawal semantics?** Two answers, both defensible:

- **Yes, annotations are withdrawable**: introduce a new `withdraw-annotation` proposal kind that mints an `annotation-withdrawn` event; the renderer hides withdrawn annotations; the projection's annotation index excludes them from `entityIsVisible` checks. This is the heaviest cut.
- **No, annotations are append-only**: an annotation, once committed, stays. A moderator who regrets an annotation must annotate it ("scope-change: I misread this") or live with it. This is the lightest cut and matches the methodology spec's framing of annotations as commentary rather than first-class entities.

This is a human-judgment architectural call, not an agent-implementable task. Per the brief's rule against "audit/revisit" deferrals, this task DOES NOT register a `withdraw_annotation_architecture` WBS task. Instead, the question is surfaced under Open questions §2 and routed to the closer for inclusion in `tasks/parking-lot.md`. Once the human decides, a properly-scoped WBS task can be written.

### §4. **Reuse the existing AnnotateSubmenu verbatim**, no new submenu component.

The existing `<AnnotateSubmenu>` (per `mod_propose_annotation_action` + `mod_annotation_kind_tagging`) ships the kind-radio picker (note / reframe / scope-change / stance / meta-disagreement) and the content textarea. The submenu's `targetKind` prop union widens by one variant — that's the entire submenu-side change.

The alternative is a new `<AnnotationAnnotateSubmenu>` tailored to annotation targets. **Rejected** because:

- **The submenu's UX doesn't change based on target kind.** Whether the target is a node, edge, or annotation, the moderator picks an annotation kind + types content. No new fields, no new validation, no new affordances are annotation-specific.
- **Duplicating the submenu would fork two surfaces that drift over time.** Future kind additions (e.g., a fifth annotation kind) would need to land in both submenus.
- **The submenu's `targetKind` widening is one-line.** Cost is negligible.

### §5. **`handleNodeContextMenu` discrimination uses the SAME `endpointKindFromNodeType(node.type)` call** that already resolves the selection-dispatch kind.

The alternative is to call `endpointKindFromNodeType` twice — once for the selection and once for the menu state — or to factor out a `discriminateNodeKind(node)` helper that returns both. **Rejected** because the existing structure at L1033-1046 already has `endpointKindFromNodeType(node.type)` called once for the selection; the resolved kind value is in scope for the subsequent `setContextMenu` call. Threading the same value into both dispatches is one-line and avoids both the double-call and the helper-extraction.

### §6. **Ship a focused Playwright spec** rather than deferring to `mod_pw_full_session_run`.

Per the brief's UI-stream e2e policy and the precedent from `mod_propose_annotation_endpoint_gestures` (which paid down deferred-e2e debt with a focused spec), the gesture is the user-visible delta this task adds — full deferral to the catch-all `mod_pw_full_session_run` would inherit annotation-context-menu coverage onto a task that's already inheriting from many predecessors. A scoped new spec mirrors the predecessor's `annotation-endpoint-gestures.spec.ts` pattern and adds one Playwright project entry.

The alternative — folding the scenario into `tests/e2e/annotation-endpoint-gestures.spec.ts` rather than a new spec file — is acceptable too; the implementer chooses based on file size after the addition. Either path discharges the e2e responsibility without deferral.

### §7. **No new ADR** for the annotate widening.

The widening extends an existing polymorphic-target pattern (`set-edge-substance`'s `source_kind` / `target_kind` already discriminate annotation endpoints; `entityIsVisible(projection, 'annotation', id)` is already first-class). The annotate schema's `target_kind` enum is the last remaining holdout to the kind-aware-entity model. No new architectural surface, no new dependency, no security-relevant trade-off — this is a refactor along the established `EntityKind` seam.

The decision to bundle wire + UI in one task (Decision §1) is a planning call, not an architectural one; it lives in this refinement, not an ADR.

### §8. **No tech-debt registration**; the parking lot picks up the withdraw question.

This task is the resolution of the predecessor's Decision §6 deferral. The new wire widening (annotate-targets-annotation) is fully consumed by this task's v1 items; no follow-up activator is needed. The only outstanding item is "withdraw annotation," which is a human architectural call (Decision §3 + Open questions §2) routed to the parking lot — not a WBS task per the brief's no-revisit rule.

Future items that may eventually surface (`mod_edit_annotation_content_action`, `mod_withdraw_annotation_action`, `aud_render_annotation_context_for_annotation_chain`) are NOT registered preemptively — they require concrete wire/spec/UX work to materialize, and registration without that materialization would create the kind of speculative-task surface this project avoids.

## Open questions

### §1. Native-speaker translation review for `moderator.contextMenu.annotation.{annotate, metaDisagree}` in pt-BR / es-419.

Placeholder translations land in the catalogs as "best-effort moderator-team-suggested" strings (per the existing convention for new keys); native-speaker review and sign-off is a human-only task and is NOT an agent-implementable WBS leaf. Surface to parking lot for the moderator team to schedule with their localization reviewers.

### §2. **Should annotations be withdrawable post-commit?**

Per Decision §3, this is an architectural question with two defensible answers (yes → new `withdraw-annotation` proposal kind + `annotation-withdrawn` event + visibility integration; no → annotations are append-only). The decision shapes whether a future `mod_withdraw_annotation_action` task can be specced. Surface to parking lot for the methodology / data-model owner to decide; do NOT register as a WBS task per the no-revisit rule.

## Status

**Done** — 2026-05-31.

- `packages/shared-types/src/events/proposals.ts`: widened `annotateProposalSchema.target_kind` from `z.enum(['node', 'edge'])` to `z.enum(['node', 'edge', 'annotation'])`.
- `apps/server/src/methodology/handlers/propose.ts`: added third `targetKind === 'annotation'` arm to `validateAnnotateProposal` using `entityIsVisible(projection, 'annotation', targetId)`.
- `apps/server/src/methodology/handlers/commit.ts`: widened annotation-created emission to map `target_kind: 'annotation'` into `target_node_id` (shared-keyspace mechanism).
- `apps/server/src/projection/replay.ts`: fixed `entity-removed(annotation)` no-op arm — now calls `setAnnotationVisible(false)` to mirror node/edge arms.
- `apps/moderator/src/layout/useAnnotateAction.ts`: widened `AnnotateTargetKind` from `'node' | 'edge'` to `'node' | 'edge' | 'annotation'`.
- `apps/moderator/src/layout/AnnotateSubmenu.tsx`: added `initialAnnotationKind?` prop for pre-selecting annotation kind.
- `apps/moderator/src/graph/GraphContextMenu.tsx`: widened `targetKind` prop union to include `'annotation'`.
- `apps/moderator/src/graph/GraphCanvasPane.tsx`: widened `ContextMenuState.target.kind`, added `buildAnnotationMenuItems` factory (2 items: annotate + meta-disagree), routed annotation nodes to dedicated menu via `endpointKindFromNodeType`.
- `apps/participant/src/proposals/proposalTargetEntity.ts`: short-circuited `target_kind === 'annotation'` to `null` (participant graph doesn't render annotations as flashable cytoscape entities).
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json`: added `moderator.contextMenu.annotation.{annotate,metaDisagree}` keys in all three locales.
- `playwright.config.ts`: added `chromium-moderator-annotation-context-menu` project entry.
- Tests: Vitest cover for schema widening, validator arms, hook round-trip, canvas-pane factory + routing, context-menu prop variant; Cucumber scenarios for annotation-target accept + invisible-target reject; Playwright spec `tests/e2e/annotation-context-menu.spec.ts` (3 scenarios).
- Notable interpretation: `initialAnnotationKind: 'stance'` pre-selects the closest semantic match for "disagree" (the enum `'meta-disagreement'` is a facet-state, not a valid `AnnotationKind`). Parked the architectural call whether `'meta-disagreement'` should become a proper `AnnotationKind` variant.
- Wire items are real, not stubs, per Decision §1 (bundled minimum wire-side widening).
- Withdraw annotation item deferred per Decision §3 + Open questions §2 → parking lot.
