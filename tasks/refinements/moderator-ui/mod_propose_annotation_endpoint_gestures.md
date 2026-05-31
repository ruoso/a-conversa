# Wire moderator draw-edge and capture-with-edge gestures to emit annotation-endpoint proposals

**TaskJuggler entry**: `moderator_ui.mod_annotation_ui.mod_propose_annotation_endpoint_gestures` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji) (block at L694-L708). Embedded note: *"Source of debt: set_edge_substance_annotation_endpoint (2026-05-30) — the proposal-schema widening and validator polymorphic threading landed; the moderator UI gesture that mints annotation-endpoint edges from the canvas (endpoint-carriage picker picking an annotation node, capture-with-edge targeting an annotation) requires annotations to be canvas-renderable click-targets first (mod_render_annotation_endpoint_edges). Includes Playwright cover: a spec where the moderator targets an annotation when minting an edge via set-edge-substance and capture-with-edge. The closer may choose to bundle or split the two gestures depending on whether the design surfaces differ enough to warrant separate tasks."*

## Effort estimate

**2d** (per the `.tji` allocation). Bundled — both gestures stay in one task (rationale in Decisions §1). Roughly:

- **Annotation-aware selection** (~0.2d). Widen [`handleNodeClick` at `GraphCanvasPane.tsx:202-204`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L202-L204) and the matching right-click handler at L982-L995 to read the ReactFlow `node.type` and dispatch `select({ kind: 'annotation', id })` for `ANNOTATION_NODE_TYPE`. The `EntityKind` union already includes `'annotation'` per [`packages/shared-types/src/events/enums.ts:47-49`](../../../packages/shared-types/src/events/enums.ts#L47-L49) — no new shape.
- **Draw-edge picker kind disambiguation** (~0.4d). Widen `<DrawEdgeRolePicker>` props with `sourceKind: 'node' | 'annotation'` and `targetKind: 'node' | 'annotation'`. Resolve each kind in `handleConnect` at [`GraphCanvasPane.tsx:904-910`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L904-L910) by looking up the ReactFlow `Node` via the existing `nodes` array (the canvas pane already has the projected `nodes` in scope). At proposal-build time in [`DrawEdgeRolePicker.tsx:103-114`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx#L103-L114), route each id to either `source_node_id`/`source_annotation_id` (and symmetric target slot) based on `sourceKind` / `targetKind`.
- **Capture-store target-kind slice** (~0.3d). Add a new `targetEntityKind: 'node' | 'annotation'` slice paired with `targetEntityId` on `useCaptureStore` (Decision §3). Default `'node'`; auto-suggest writes `'node'` only; explicit-stage gestures on annotation nodes write `'annotation'`. The four-reset call sites in [`captureStore.ts:507, 576, 641, 662`](../../../apps/moderator/src/stores/captureStore.ts) (the `reset()`-equivalents and per-mode entry helpers) restore the default. The chip's `handleClear` at [`CaptureTargetChip.tsx:145-157`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L145-L157) extends to reset `targetEntityKind` to `'node'` alongside the existing slices.
- **Click-to-stage on annotation nodes** (~0.3d). Wire a new `setCaptureTarget(kind, id)` capture-store action (or a small `onAnnotationNodeClick` callback threaded through `<AnnotationNode>`) so that clicking an annotation node during capture stages it as the capture target with `kind: 'annotation'`. The simplest cut threads the canvas-level click through `useSelectionStore` (already widened above) plus a `useCaptureStore` effect that watches for `state.selected.kind === 'annotation'` and stages it as an explicit-override target (bypassing auto-suggest). Decision §4 records the chosen seam.
- **Proposal-builder threading** (~0.3d). Widen [`buildCaptureNodeProposal` at `useProposeAction.ts:203-227`](../../../apps/moderator/src/layout/useProposeAction.ts#L203-L227) so the `edge.otherNodeId` argument becomes `edge.otherEntity: { kind: 'node' | 'annotation', id: string }`; the new-node-is-source check then routes the other-entity's id into `source_annotation_id` / `target_annotation_id` per the direction. `useProposeAction`'s call site at L408-L413 passes the staged kind through. Returns a `capture-node` envelope whose `edge` block carries the polymorphic-endpoint shape per [`captureNodeEdgeShapeSchema` at `proposals.ts:137-144`](../../../packages/shared-types/src/events/proposals.ts#L137-L144).
- **Vitest cover** (~0.4d). Per-helper cases for the click-handler kind discrimination, the picker's payload-routing across the four kind permutations (node→node, node→annotation, annotation→node, annotation→annotation), the capture-store target-kind slice, `buildCaptureNodeProposal` polymorphic-endpoint shape, and `useProposeAction` round-trip wiring.
- **Playwright cover** (~0.3d). Two scoped specs (or one spec with two scenarios) per the source-of-debt note: one drives the draw-edge gesture from an annotation node, one drives the capture-with-edge gesture targeting an annotation. Both use the existing WS-state seed seam established by `mod_render_annotation_endpoint_edges`'s `annotation-endpoint-rendering.spec.ts`.

## Inherited dependencies

**Settled:**

- [`moderator_ui.mod_annotation_ui.mod_render_annotation_endpoint_edges`](./mod_render_annotation_endpoint_edges.md) (done — 2026-05-30). The blocker: annotations are now canvas-renderable graph nodes per [`AnnotationNode.tsx`](../../../apps/moderator/src/graph/AnnotationNode.tsx) — they expose ReactFlow `Handle`s (source bottom + target top per [`AnnotationNode.tsx:102-103`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L102-L103)), they carry a stable `data-testid="annotation-node-<id>"` seam, and dagre lays them out alongside statement nodes. Decision §1 of that refinement pinned the hybrid promotion rule (annotation participates as edge endpoint → promoted to `AnnotationNode`; otherwise stays a badge). This task is the propose-side counterpart that *causes* the promotion to occur via a fresh `edge-created` event.

- [`data_and_methodology.methodology_engine.set_edge_substance_annotation_endpoint`](../data-and-methodology/set_edge_substance_annotation_endpoint.md) (done — 2026-05-30). Shipped the wire-side widening THIS task fires payloads against:
  - `setEdgeSubstanceProposalSchema` at [`packages/shared-types/src/events/proposals.ts:202-209`](../../../packages/shared-types/src/events/proposals.ts#L202-L209) gained `source_annotation_id` + `target_annotation_id`; per-endpoint `.refine()` blocks enforce AT-MOST-ONE per pair (substance-only re-vote sets zero endpoint slots).
  - `captureNodeEdgeShapeSchema` at [`proposals.ts:137-144`](../../../packages/shared-types/src/events/proposals.ts#L137-L144) gained the same four fields; per-endpoint `.refine()` enforces EXACTLY-ONE per pair (capture-with-edge always carries fully-specified pairs).
  - `validateSetEdgeSubstanceProposal` at [`apps/server/src/methodology/handlers/propose.ts:1216-1314`](../../../apps/server/src/methodology/handlers/propose.ts) widened Phase 1 cross-side symmetry, Phase 2a/2b visibility via `entityIsVisible(projection, kind, id)`, Phase 2c agreement against the polymorphic triple.
  - `validateCaptureNodeProposal` at [`propose.ts:1355-1411`](../../../apps/server/src/methodology/handlers/propose.ts) rule 3 widened analogously; self-reference guard stays for the node-id case only.
  - Structural-event builders at L1862-1894 (capture-with-edge arm) and L1897-1948 (set-edge-substance connecting arm) thread the four polymorphic fields through the emitted `edge-created` payload.

- [`moderator_ui.mod_capture_flow.mod_draw_edge_flow` / `mod_propose_action`](./mod_draw_edge_flow.md) (done) — the existing draw-edge gesture chain this task widens. [`<DrawEdgeRolePicker>`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx) emits the connecting-case `set-edge-substance` proposal today (node endpoints only); the ReactFlow `onConnect` handler chain at [`GraphCanvasPane.tsx:904-935`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L904-L935) is unchanged structurally — only the picker's payload-routing changes.

- [`moderator_ui.mod_capture_flow.mod_propose_action`](./mod_propose_action.md) (done) — the capture-with-edge proposal builder this task widens. [`buildCaptureNodeProposal` at `useProposeAction.ts:203-227`](../../../apps/moderator/src/layout/useProposeAction.ts#L203-L227) currently routes `otherNodeId` into either `source_node_id` or `target_node_id` based on `direction`; the widening adds an `otherEntity.kind` branch that picks the annotation-id slot instead.

- [ADR 0021 — Event envelope discriminated union with Zod](../../../docs/adr/0021-event-envelope-discriminated-union-with-zod.md). Schema-on-write; the propose envelope's per-endpoint `.refine()` is the first-line gate.

- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md). Vitest + Playwright cover.

- [ADR 0024 — Frontend i18n: react-i18next with ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md). The picker reuses the existing `methodology.edgeRole.<role>` keys; no new strings.

- [ADR 0030 — Per-facet vote keying and sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md) §1 + §4. The capture gesture stays single-envelope; the inline `edge` block carries the polymorphic-endpoint shape.

**Pending:** (none — every load-bearing input is settled on `main`.)

## What this task is

The moderator console can already *render* annotation-endpoint edges (predecessor `mod_render_annotation_endpoint_edges`) and the wire schema + validator already *accept* propose payloads addressing annotation endpoints (predecessor `set_edge_substance_annotation_endpoint`). What is missing is the moderator-side gesture that *emits* such a payload: drawing an edge whose source or target handle terminates on an annotation node, or staging an annotation node as the capture target during capture-with-edge. This task wires both.

Concretely:

1. **Annotation-aware selection**. `handleNodeClick` and `handleNodeContextMenu` in [`GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) discriminate on the ReactFlow `node.type` and route annotation-node clicks to `select({ kind: 'annotation', id })`. The `EntityKind` union already supports it; the right-click context menu opens on annotation nodes too (with the existing items — no new menu work in v1, per Decision §6).

2. **Draw-to-create-edge widened**. ReactFlow's `onConnect` already fires when the moderator drags between any two nodes that expose `Handle`s — including annotation nodes (handles wired in [`AnnotationNode.tsx:102-103`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L102-L103)). The `handleConnect` callback at [`GraphCanvasPane.tsx:904-910`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L904-L910) looks up each endpoint's kind from the `nodes` array; `<DrawEdgeRolePicker>` receives `{source, sourceKind, target, targetKind, x, y}` and at proposal-build time routes each id to its kind-appropriate schema slot (`source_node_id` vs `source_annotation_id`; same for target).

3. **Capture-with-edge widened**. The capture store gains a `targetEntityKind: 'node' | 'annotation'` slice paired with `targetEntityId`. Auto-suggest (via `selectMostRecentlyActiveNodeId`) continues to stage only statement nodes (kind `'node'`); annotation staging is an explicit-override action driven by clicking an annotation node on the canvas. `buildCaptureNodeProposal` at [`useProposeAction.ts:203-227`](../../../apps/moderator/src/layout/useProposeAction.ts#L203-L227) widens the `otherEntity` argument to a discriminated `{ kind, id }`; the new-node-is-source check routes the other-entity's id into `source_annotation_id` or `target_annotation_id` accordingly (the captured node remains a node id on the opposite slot — captures mint a node, not an annotation, per the schema constraint that capture-with-edge always names one endpoint as the just-minted node id).

4. **Vitest + Playwright cover**. Pins each new branch and the user-observable contract: drawing from/to an annotation node mints an annotation-endpoint edge; capturing-with-edge targeting an annotation mints a capture-node envelope whose inline edge block carries the annotation endpoint.

Out of scope (registered under Tech-debt):

- **Annotation-to-annotation auto-suggest**. Auto-suggest stays node-scoped per Decision §5. A future polish could widen the recently-active selector to also surface annotation nodes — deferred.
- **Annotation-specific context-menu items**. The existing context menu opens unchanged on annotation right-click; widening the *items* (e.g. "annotate this annotation" — though `mod_annotation_of_annotation_overlay_chain` may already cover this rendering-side) is a separate v.next concern.
- **Participant + audience analogues**. Read-only surfaces — no propose gestures. Confirmed: no sibling `*_propose_annotation_endpoint_*` task exists in either area.

## Why it needs to be done

**The wire-side is hot; the moderator UI is the last unwired surface.** Two predecessor tasks shipped end-to-end annotation-endpoint plumbing: the projection layer accepts and stores annotation-endpoint edges (`projection_edge_annotation_endpoint`, done 2026-05-30); the proposal schema + validator accept and route annotation-endpoint payloads (`set_edge_substance_annotation_endpoint`, done 2026-05-30); the moderator canvas renders them (`mod_render_annotation_endpoint_edges`, done 2026-05-30). Today the moderator can SEE an annotation-endpoint edge on the canvas if one arrives via replay or via the participant/audience-side widening, but they cannot MINT one — the draw-edge picker only routes to `source_node_id` / `target_node_id`, and the capture-with-edge flow only stages node targets. THIS task closes that loop.

**The walkthrough fixture refit depends on it.** `walkthrough_e15_annotation_endpoint_refit` (data-and-methodology) re-encodes E15 ("N19 contradicts A2") with the annotation-endpoint shape. Its Playwright assertions read against the moderator canvas; once those land, the canonical narrative requires a moderator-driven gesture path that ends in an annotation-endpoint `edge-created`. This task is the only pre-existing WBS task that *emits* such a payload from the moderator side.

**The defensive guard in the validator is now load-bearing only because of the UI gap.** Phase 2a/2b of `validateSetEdgeSubstanceProposal` correctly rejects proposals targeting invisible annotations — but in practice no such proposal can reach the validator from the moderator console today because no gesture *can* construct one. Landing this task makes the validator's polymorphic checks observable from the moderator-driven seam, not just from server-side unit tests and replay-mode injections.

## Inputs / context

### The draw-edge gesture surface

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:904-935`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L904-L935) — the `handleConnect` → `handleConnectEnd` chain that stashes `(source, target)` in `pendingConnectionRef` and opens `<DrawEdgeRolePicker>` at the drop coordinates. The id strings the handler receives are ReactFlow node ids — including annotation node ids since `mod_render_annotation_endpoint_edges` registered the `annotation` node type.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:885-897`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L885-L897) — the `drawEdgePicker` state shape. Widens to also carry `sourceKind` and `targetKind` per Decision §2.
- [`apps/moderator/src/graph/DrawEdgeRolePicker.tsx`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx) — the role-picker popover. Today builds the proposal at [`L103-L114`](../../../apps/moderator/src/graph/DrawEdgeRolePicker.tsx#L103-L114) hardcoding `source_node_id: source` + `target_node_id: target`. Widens to read `sourceKind` / `targetKind` and route into the appropriate schema slot.
- [`apps/moderator/src/graph/AnnotationNode.tsx:102-103`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L102-L103) — annotation nodes already expose ReactFlow `Handle` source + target. ReactFlow's `onConnect` fires naturally; no per-node-type wiring change.
- [`apps/moderator/src/graph/AnnotationNode.tsx:72`](../../../apps/moderator/src/graph/AnnotationNode.tsx#L72) — `ANNOTATION_NODE_TYPE = 'annotation'`. The kind-discriminator constant the handler matches on.

### The capture-with-edge gesture surface

- [`apps/moderator/src/stores/captureStore.ts:153, 161, 179`](../../../apps/moderator/src/stores/captureStore.ts) — current capture slices: `targetEntityId: string | null`, `edgeDirection: EdgeDirection`, no kind discriminator. The widening adds `targetEntityKind: 'node' | 'annotation'` with default `'node'`.
- [`apps/moderator/src/stores/captureStore.ts:474, 492, 507, 576, 641, 662`](../../../apps/moderator/src/stores/captureStore.ts) — initial state, the `setTargetEntityId` setter, and the four reset/transition call sites that re-initialize the slice. Each lands a `targetEntityKind: 'node'` in symmetry with the existing slice resets.
- [`apps/moderator/src/layout/CaptureTargetChip.tsx:118-289`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx) — staged-target chip. The auto-suggest effect at L177-L210 stays node-scoped (Decision §5). `handleClear` at L145-L157 also resets `targetEntityKind` to `'node'`. The wording-lookup at L215-L222 needs a tiny extension when the staged entity is an annotation: resolve the label from the annotation's `content` (via a new `selectAnnotationContentById` selector) rather than the node-wording selector, per Decision §7.
- [`apps/moderator/src/layout/useProposeAction.ts:203-227`](../../../apps/moderator/src/layout/useProposeAction.ts#L203-L227) — `buildCaptureNodeProposal`. The `edge` argument's `otherNodeId: string` widens to `otherEntity: { kind: 'node' | 'annotation'; id: string }`; the new-node-source/target check routes the id into the kind-appropriate slot.
- [`apps/moderator/src/layout/useProposeAction.ts:343-420`](../../../apps/moderator/src/layout/useProposeAction.ts#L343-L420) — the `propose()` async handler. Reads `targetEntityKind` from the store at call time alongside `targetEntityId` / `edgeRole` / `edgeDirection`; passes the kind through to `buildCaptureNodeProposal`.

### The selection-store wiring

- [`apps/moderator/src/graph/GraphCanvasPane.tsx:202-208`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L202-L208) — `handleNodeClick` and `handleEdgeClick` currently hardcode `kind: 'node'` / `kind: 'edge'`. The widening: `handleNodeClick` reads the second-arg `Node`'s `.type` and dispatches `kind: 'annotation'` when it matches `ANNOTATION_NODE_TYPE`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx:982-995`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx#L982-L995) — `handleNodeContextMenu`. Mirrors the same discrimination so a right-click on an annotation node selects with `kind: 'annotation'`.
- [`apps/moderator/src/stores/selectionStore.ts:15-25`](../../../apps/moderator/src/stores/selectionStore.ts#L15-L25) — `Selection { kind: EntityKind; id: string }`; `EntityKind` already includes `'annotation'`. No store-shape change.
- [`apps/moderator/src/stores/recentlyActiveNode.ts:31-35`](../../../apps/moderator/src/stores/recentlyActiveNode.ts#L31-L35) — `selectMostRecentlyActiveNodeId` filters to `kind === 'node'`. Stays unchanged (auto-suggest stays node-scoped per Decision §5).

### The proposal schema this task fires against

- [`packages/shared-types/src/events/proposals.ts:137-144, 202-209`](../../../packages/shared-types/src/events/proposals.ts) — `captureNodeEdgeShapeSchema` (EXACTLY-ONE per endpoint pair) and `setEdgeSubstanceProposalSchema` (AT-MOST-ONE per endpoint pair). The first-line schema gate at envelope-parse time.

### Sibling precedent

- [`tasks/refinements/data-and-methodology/set_edge_substance_annotation_endpoint.md`](../data-and-methodology/set_edge_substance_annotation_endpoint.md) — the engine-side counterpart. Names this task as its proposal-side UI gesture follow-up.
- [`tasks/refinements/moderator-ui/mod_render_annotation_endpoint_edges.md`](./mod_render_annotation_endpoint_edges.md) — the rendering predecessor. Decisions §1 (hybrid promotion) and §10 (StatementEdgeData.sourceId/targetId widened to annotation ids) shape the moderator's mental model this task plugs into.
- [`tasks/refinements/moderator-ui/mod_propose_action.md`](./mod_propose_action.md) — the capture-with-edge proposal-building precedent.
- [`tasks/refinements/moderator-ui/mod_draw_edge_flow.md`](./mod_draw_edge_flow.md) — the draw-to-create-edge predecessor. The picker shape this task widens.

### Existing Playwright precedent

- [`tests/e2e/annotation-endpoint-rendering.spec.ts`](../../../tests/e2e/annotation-endpoint-rendering.spec.ts) — the rendering predecessor's Playwright spec; reuses the WS-state seed seam (the `tests/e2e/fixtures/wsStoreSeed.ts` extension landed by `mod_render_annotation_endpoint_edges`). This task's specs reuse the seam but drive a gesture (drag + drop, or capture-pane fill + propose click) rather than asserting an already-seeded surface.
- [`tests/e2e/fixtures/wsStoreSeed.ts`](../../../tests/e2e/fixtures/wsStoreSeed.ts) — extended by `mod_render_annotation_endpoint_edges` with `SeedAnnotation` + polymorphic edge endpoint kinds. The seed shape this task's spec consumes.

## Constraints / requirements

1. **Kind discrimination at the ReactFlow-node layer**. The handler reads `node.type` (the ReactFlow `Node`'s discriminator) and maps `STATEMENT_NODE_TYPE` → `'node'`, `ANNOTATION_NODE_TYPE` → `'annotation'`. Any other node type (a future addition) defaults to `'node'` with a TypeScript exhaustiveness check to surface the gap (a `never` assertion in the default arm).

2. **At-most-one + exactly-one per endpoint pair stays a schema concern**. The propose payload sets either `source_node_id` OR `source_annotation_id` (not both); the schema's per-endpoint `.refine()` is the final guard. The proposal-builder code respects this by writing to ONE of the two slots per endpoint and leaving the other `undefined`.

3. **Capture-store target shape stays string-based for `targetEntityId`**. The new `targetEntityKind` slice is paired with the existing `targetEntityId` slice (Decision §3). Resets, setters, validation, and consumers extend in lockstep — there is no intermediate state where `targetEntityId !== null` and `targetEntityKind` is undefined.

4. **Auto-suggest stays node-scoped**. `selectMostRecentlyActiveNodeId` is unchanged; the capture-target auto-stages only when a statement node is the recently-active selection. Annotation staging is explicit-override via a fresh click-handler path (Decision §5).

5. **No new ADR**. The architectural seams (ReactFlow custom node types, discriminated `EntityKind`, schema-on-write proposal envelopes, single-envelope capture-with-edge per ADR 0030) are all in place. The widening is a moderator-UI extension along these seams — no new dependency, no new abstraction.

6. **No schema, projection, validator, or methodology-engine change**. All wire-side work landed in `set_edge_substance_annotation_endpoint`. This task only emits payloads the validator already accepts.

7. **TypeScript strict + ESLint flat config compliance** ([ADR 0013](../../../docs/adr/0013-typescript-strict.md), [ADR 0011](../../../docs/adr/0011-eslint.md)). The widened `DrawEdgeRolePickerProps` and `buildCaptureNodeProposal` argument shape satisfy `exactOptionalPropertyTypes` (the new kind discriminator is required, not optional).

8. **i18n** ([ADR 0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)). No new strings. The chip's annotation-staged label reuses `methodology.annotationKind.<kind>` (the same key the badge + node consume); the chip's truncated content body reads from the annotation's `content` field (participant-supplied text — not translated, per the existing wording-truncation rule at [`CaptureTargetChip.tsx:53-56`](../../../apps/moderator/src/layout/CaptureTargetChip.tsx#L53-L56)).

9. **Vitest discipline** ([ADR 0006](../../../docs/adr/0006-test-framework-vitest.md), [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)). Each new branch + new helper + new prop ships pinned cover.

10. **Playwright cover IS in scope** (explicit in the .tji note). Two scenarios: draw-edge from an annotation node; capture-with-edge targeting an annotation. Full deferral to a `mod_pw_*` catch-all is rejected (Decision §8 of `mod_render_annotation_endpoint_edges` already paid this debt down for the rendering side; the gesture side warrants the same focused-spec treatment).

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check is a committed Vitest case, an updated Playwright spec, or a CI script — no throwaway probes.

**Source edits**

- [ ] `apps/moderator/src/graph/GraphCanvasPane.tsx`:
  - `handleNodeClick` (L202-204) reads `node.type` and dispatches `select({ kind: 'annotation', id: node.id })` when the type matches `ANNOTATION_NODE_TYPE`; falls back to `kind: 'node'` for `STATEMENT_NODE_TYPE` and any other (with an exhaustiveness assertion).
  - `handleNodeContextMenu` (L982-995) applies the same discrimination so the right-click selection is annotation-aware.
  - `drawEdgePicker` state at L891-896 widens to carry `sourceKind: 'node' | 'annotation'` and `targetKind: 'node' | 'annotation'`.
  - `handleConnect` (L904-910) resolves each endpoint id's kind by looking up the matching `Node` in the canvas's `nodes` array (already in scope as `projectedNodes` / `nodes`).
  - The `<DrawEdgeRolePicker>` mount site (~L1587-1595) passes the resolved kinds through props.
- [ ] `apps/moderator/src/graph/DrawEdgeRolePicker.tsx`:
  - `DrawEdgeRolePickerProps` gains `sourceKind: 'node' | 'annotation'` and `targetKind: 'node' | 'annotation'` fields.
  - `handlePick` at L96-131 builds the proposal payload routing each id to the kind-appropriate slot. For `sourceKind === 'node'` → `source_node_id: source`; else `source_annotation_id: source`. Symmetric for target. The absent slot is omitted (per schema's per-endpoint `.refine()`).
  - The picker's `data-source-id` and `data-target-id` attributes (L138-139) gain sibling `data-source-kind` + `data-target-kind` attributes for test-pinning.
- [ ] `apps/moderator/src/stores/captureStore.ts`:
  - New `targetEntityKind: 'node' | 'annotation'` slice with default `'node'`.
  - New `setTargetEntity(kind, id)` action that writes both slices atomically (so a transition from "node staged" to "annotation staged" cannot land in an intermediate inconsistent state).
  - The existing `setTargetEntityId(id)` setter keeps its signature and forces `targetEntityKind: 'node'` (preserves the existing call-site contract — auto-suggest only stages nodes).
  - All four reset / mode-transition sites (initial state at L474; reset at L507; `enterDecomposeMode` / `enterInterpretiveSplitMode` etc. at L576, L641, L662) restore `targetEntityKind: 'node'`.
- [ ] `apps/moderator/src/layout/CaptureTargetChip.tsx`:
  - Reads `targetEntityKind` from the store alongside `targetEntityId`.
  - `handleClear` (L145-157) resets `targetEntityKind` to `'node'`.
  - The wording-lookup at L215-222 dispatches: kind `'node'` → `selectNodeWordingById(events, id)` (today's path); kind `'annotation'` → a new `selectAnnotationContentById(events, id)` selector that walks the events for the annotation's `content`. Falls back to the id when not found.
  - The chip's `data-testid="capture-target-chip"` gains a sibling `data-target-kind` attribute for test-pinning.
- [ ] `apps/moderator/src/graph/selectors.ts`:
  - Add `selectAnnotationContentById(events, annotationId): string | null` mirroring `selectNodeWordingById`.
- [ ] `apps/moderator/src/layout/useProposeAction.ts`:
  - `buildCaptureNodeProposal` (L203-227) widens the `edge` argument's `otherNodeId: string` to `otherEntity: { kind: 'node' | 'annotation'; id: string }`. The new-node-is-source check picks the slot for the OTHER entity: `kind === 'node'` → the existing `source_node_id` / `target_node_id` path; `kind === 'annotation'` → `source_annotation_id` / `target_annotation_id`. The captured node always lands in its corresponding `*_node_id` slot (the capture mints a node — never an annotation).
  - `useProposeAction.propose()` (L343-420) reads `targetEntityKind` from the store at call time; passes `{ kind: targetEntityKindNow, id: targetEntityIdNow }` into `buildCaptureNodeProposal`'s `otherEntity` field.
- [ ] `apps/moderator/src/stores/captureStore.ts` (continued):
  - The selection-bridge effect — when `useSelectionStore.selected.kind === 'annotation'` AND capture mode is active, the moderator's annotation-node click stages the annotation as the capture target via `setTargetEntity('annotation', selectedId)`. The effect path is documented in Decision §4. The auto-suggest's no-stomp ref at `CaptureTargetChip.tsx:135` (lastAutoStagedRef) interacts: an explicit annotation stage sets the override flag the same way an explicit node-id write does today.

**Vitest coverage** (committed cases, ADR 0022)

- [ ] `apps/moderator/src/graph/GraphCanvasPane.test.tsx`:
  - `handleNodeClick` on a statement node → selection `{ kind: 'node', id }`.
  - `handleNodeClick` on an annotation node → selection `{ kind: 'annotation', id }`.
  - `handleConnect` resolving an annotation-source / annotation-target / both-annotation pair → `drawEdgePicker` state carries the correct kinds.
- [ ] `apps/moderator/src/graph/DrawEdgeRolePicker.test.tsx` (extends existing):
  - Four-case picker cover: node→node (regression), node→annotation, annotation→node, annotation→annotation. Each case asserts the dispatched `propose` payload's endpoint slots.
  - The `data-source-kind` / `data-target-kind` attribute pins.
- [ ] `apps/moderator/src/stores/captureStore.test.ts`:
  - `setTargetEntity('node', id)` and `setTargetEntity('annotation', id)` write both slices atomically.
  - `setTargetEntityId(id)` continues to write `kind: 'node'` (regression).
  - All four reset / mode-entry sites restore `targetEntityKind: 'node'`.
- [ ] `apps/moderator/src/layout/CaptureTargetChip.test.tsx`:
  - Annotation-staged: chip renders the annotation's truncated content (via `selectAnnotationContentById`).
  - `handleClear` resets `targetEntityKind` back to `'node'`.
  - The chip's `data-target-kind` attribute reflects the staged kind.
- [ ] `apps/moderator/src/graph/selectors.test.ts`:
  - `selectAnnotationContentById`: empty log → null; one annotation-created event → content string; non-matching id → null.
- [ ] `apps/moderator/src/layout/useProposeAction.test.tsx`:
  - Capture-with-edge with `targetEntityKind: 'annotation'` and `direction: 'targets'` → emitted proposal has `edge.source_node_id: <new-node-id>, edge.target_annotation_id: <staged-id>`, no `target_node_id`, no `source_annotation_id`.
  - Capture-with-edge with `targetEntityKind: 'annotation'` and `direction: 'targeted-by'` → emitted proposal has `edge.source_annotation_id: <staged-id>, edge.target_node_id: <new-node-id>`, symmetric absent slots.
  - Capture-with-edge with `targetEntityKind: 'node'` continues to emit the existing node-endpoint shape (regression).

**Playwright coverage** — the surface is reachable; the existing WS-state seed seam supports gesture-driven scenarios

- [ ] `tests/e2e/annotation-endpoint-gestures.spec.ts` (new file). Two scenarios:
  - **Draw-edge from an annotation**. Seed: `session-created` + `node-created` (N1) + `annotation-created` (A1 targeting N1) + `edge-created` (A1 promoted via an existing annotation-endpoint edge). Gesture: ReactFlow drag from `[data-testid="annotation-node-A1"]`'s source handle to `[data-testid="statement-node-N1"]`'s target handle. Picker opens with `data-source-kind="annotation"` + `data-target-kind="node"`. Click the `contradicts` role button. Assert: the WS propose round-trip fires with `source_annotation_id: A1, target_node_id: N1, role: 'contradicts'`; the canvas shows a fresh annotation-endpoint edge after the round-trip's `edge-created` arrives.
  - **Capture-with-edge targeting an annotation**. Seed: `session-created` + `node-created` (N1) + `annotation-created` (A1 targeting N1) + `edge-created` promoting A1. Gesture: click `[data-testid="annotation-node-A1"]` (stages A1 as capture target with `kind: 'annotation'`); the `[data-testid="capture-target-chip"]` shows `data-target-kind="annotation"` with the annotation's content as the label. Type wording into the capture text input; pick edge role `contradicts`; click propose. Assert: the WS propose round-trip fires with `kind: 'capture-node'` and the `edge` block carrying `source_node_id: <fresh-node-id>, target_annotation_id: A1, role: 'contradicts'` (per default `direction: 'targets'`); the canvas shows the new node + new annotation-endpoint edge after the round-trip lands.
- [ ] `tests/e2e/fixtures/wsStoreSeed.ts` — no shape change needed; the existing seed seam already supports annotation events + polymorphic edge endpoints. The new spec uses it as-is.
- [ ] `playwright.config.ts` — add a `chromium-moderator-annotation-endpoint-gestures` project mirroring the rendering predecessor's project entry.

**Build + scheduler**

- [ ] `pnpm run check` clean (typecheck + lint + format + i18n-catalogs validator).
- [ ] `pnpm run test:smoke` green (Vitest test count rises by ~20 cases — handler discrimination, picker × 4 permutations, capture-store target-kind slice, chip wording-dispatch, content selector, useProposeAction × 3 permutations).
- [ ] `pnpm -F @a-conversa/moderator build` succeeds.
- [ ] `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent after `complete 100` lands on the task block at L694-708.

**Refinement closure**

- [ ] `tasks/30-moderator-ui.tji` task block `mod_propose_annotation_endpoint_gestures` gains `complete 100` after the `allocate team` line, plus a `note "Refinement: tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md"` line.
- [ ] A `## Status` block is appended to this refinement on completion per [`tasks/refinements/README.md`](../README.md) ritual.

## Decisions

### §1. **Bundle both gestures in one 2d task** rather than splitting into two ~1d tasks.

The .tji note explicitly invites the bundle-or-split call. The strongest alternative is **split**:

- Primary task (~1.5d): draw-to-create-edge with annotation endpoints.
- Follow-up (~0.5d): capture-with-edge with annotation endpoints.

**Rejected** because the two gestures share too much infrastructure to split cleanly:

- **Both require annotation-aware selection wiring** (`handleNodeClick` kind discrimination, the selection-store wiring). Splitting would either duplicate this seam across two tasks or strand it half-built in the first one.
- **Both require the proposal-builder to discriminate kinds** when routing endpoint ids — the draw-edge case in `DrawEdgeRolePicker.handlePick`, the capture-with-edge case in `buildCaptureNodeProposal`. The discriminator pattern (`kind === 'annotation' ? annotation_id_slot : node_id_slot`) is the same shape; building it twice is duplicate work.
- **The Playwright fixture infrastructure (WS-state seed + annotation-endpoint events) is shared**. One spec file with two scenarios costs less than two spec files with mostly-overlapping setup.
- **The 2d effort estimate already accommodates both**. Splitting at 1.5d + 0.5d preserves total cost but adds task-management overhead (closer ritual × 2, two PR cycles, two refinements).

The split alternative would be defensible if the two gestures had fundamentally different design surfaces — but they don't. Both are "moderator UI gesture mints a proposal payload addressing an annotation endpoint"; the differences are purely in *which* gesture surface (drag-handle vs capture-pane). Bundling preserves cohesion.

### §2. **Discriminate endpoint kinds via ReactFlow `node.type`**, not via a separate id-space prefix.

The strongest alternative is to encode the kind into the id string (e.g. prefix annotation ids with `ann:` and node ids with `node:`). **Rejected** because:

- **ReactFlow's id space is already flat-keyed across both node types** per `mod_render_annotation_endpoint_edges` Decision §1 (UUID collision space is effectively zero; both node types coexist as same-keyspace ReactFlow nodes). Adding a prefix would require unprefixing at the proposal-emit layer and re-prefixing on every selector that reads back — friction with no payoff.
- **The schema layer already discriminates via separate field names** (`source_node_id` vs `source_annotation_id`). The kind is observable from which schema field is set; the prefix would be redundant.
- **`node.type` is the canonical ReactFlow discriminator** — the same field the `nodeTypes` registry keys off. Reading it at the handler is one property access.

### §3. **Two parallel slices for the capture target** (`targetEntityId: string | null` + `targetEntityKind: 'node' | 'annotation'`), not a discriminated-union shape.

The strongest alternative is to widen `targetEntityId` to a discriminated `{ kind: 'node' | 'annotation'; id: string } | null` (mirroring `useSelectionStore`'s `Selection` shape). **Rejected** because:

- **The existing `targetEntityId: string | null` slice is wired through ~14 files** (per the grep survey: the chip, the selectors, useProposeAction, EdgeRoleSelector, ClassificationPalette, captureKeymap, stores tests, etc.). Each consumer would need to unpack `{kind, id}` to get the id-string they actually consume — a wide, mechanical, low-value refactor.
- **Auto-suggest writes the id only** (the kind is implicitly `'node'`). A discriminated shape would force the auto-suggest to write `{kind: 'node', id}` instead of `id`, requiring a wrapper or coercion at every write site.
- **Parallel slices keep the validation gate-shape stable**: the existing `validationError === 'role-without-target'` / `'target-without-role'` rules read `targetEntityId !== null` as the truthy check; the new slice doesn't change that predicate.

The cost of two parallel slices is the invariant "if `targetEntityId !== null`, `targetEntityKind` must reflect the entity kind". This invariant is enforced by:

- The new `setTargetEntity(kind, id)` action — atomic write of both slices.
- The legacy `setTargetEntityId(id)` setter — forces `targetEntityKind: 'node'` (the auto-suggest contract).
- All four reset / mode-entry sites — reset both slices to defaults.
- Vitest pin: a case asserting no path can land `targetEntityId !== null` with `targetEntityKind` mismatched.

A discriminated-union refactor remains a future-polish option if the parallel-slice invariant proves fragile. Today it isn't fragile — the three writer paths are small and easy to audit.

### §4. **Annotation-node click stages the annotation via an explicit-override path**, bridging selection → capture-target via a `useCaptureStore` effect.

The alternatives:

- **Auto-suggest reads `selected.kind` and admits annotations**. Rejected per Decision §5 — auto-suggest stays node-scoped.
- **Annotation-node click writes the capture target directly from `handleNodeClick`**. Rejected because the click handler is generic (every node-click routes through it); coupling capture-target staging into the click handler bleeds capture-flow knowledge into the canvas pane.
- **A new context-menu item on annotation nodes ("stage as capture target")**. Rejected for v1 because the gesture is too discoverable-only — moderators wouldn't find it.

The chosen path: a small `useCaptureStore`-side effect (or a thin coupling helper) watches `useSelectionStore.selected`. When the selection is `{ kind: 'annotation', id }` AND capture mode is active AND `userHasClearedRef` is not asserting cleared state, `setTargetEntity('annotation', id)` fires. The path mirrors the existing auto-suggest's override-precedence rules (Case 1/2/3 of `CaptureTargetChip`'s effect) — an annotation-stage IS an override (it doesn't match the most-recently-active node id), so the `lastAutoStagedRef` correctly DOESN'T match and Case 3 (override) holds. Subsequent statement-node selections continue to not stomp the annotation override.

The effect can live either inside `CaptureTargetChip` (alongside the existing auto-suggest effect) or as a free-function helper hooked from `OperateRoute`. Implementer's choice; both shapes pass the same Vitest assertions.

### §5. **Auto-suggest stays node-scoped**; annotations are explicit-stage only.

The alternative is to widen `selectMostRecentlyActiveNodeId` (or add a sibling selector) so the auto-suggest considers the most-recently-active *entity* (node or annotation). **Rejected** because:

- **Annotations don't drive the moderator's "what am I responding to" mental model the way statement nodes do**. The auto-suggest exists to short-circuit a routine: "I'm building on the node I just looked at." Annotations are meta-commentary; a freshly-clicked annotation doesn't predict that the moderator's next statement extends from THAT annotation rather than from the underlying entity.
- **Annotation-staging is rarer than node-staging**. The walkthrough fixture exercises one annotation-endpoint edge across an entire session; making the gesture explicit-only keeps the common-case node-targeting flow fast.
- **The explicit-stage path is honest about the user's intent**: clicking an annotation node IS a deliberate action (annotations are visually distinct via the amber card style); the click is a clear-enough signal to stage.

A future amendment can widen auto-suggest if walkthrough usage shows annotation-staging is common — deferred follow-up `mod_annotation_capture_auto_suggest` registered under Tech-debt (Decision §11).

### §6. **No new context-menu items for annotation nodes in v1**.

The existing right-click context menu opens on annotation nodes (after the `handleNodeContextMenu` widening), reusing the existing items where they make sense. Items that semantically don't apply to annotations (e.g. "decompose this node", "interpretive split", "axiom mark") may behave oddly when right-clicked on an annotation — but the v1 cut is: open the menu unchanged; let the items' internal validation guards (most of which key off the projection's `getNode(id)` returning null for annotation ids) short-circuit naturally.

The alternative is to either:

- Suppress the context menu entirely on annotation nodes. Rejected because a future addition (annotate-an-annotation, etc.) might want it.
- Build a separate `<AnnotationContextMenu>` with annotation-specific items. Rejected for v1 as out of scope; the right-click surface stays implementation-stable.

A future task — `mod_annotation_context_menu` — can split out a dedicated annotation-context-menu component if/when annotation-specific items materialize. Registered under Tech-debt (Decision §11).

### §7. **Chip wording-lookup branches on `targetEntityKind`**; annotations show their content, not their id.

For `targetEntityKind === 'annotation'`, the chip's label resolves via a new `selectAnnotationContentById(events, id)` selector that mirrors `selectNodeWordingById`'s shape (one pass over events; returns the annotation's `content` field; falls back to `null` when not found). The chip truncates the content to `WORDING_TRUNCATE_AT` (32 chars) for layout consistency with node-staged labels.

The alternative is to show the annotation's kind (e.g. "reframe", "stance") as the chip label. **Rejected** because the moderator's mental model is "I'm targeting THIS annotation" — the content distinguishes one annotation from another more than the kind does (a node may have several reframe annotations).

### §8. **Direction toggle on the chip stays meaningful** for annotation targets.

The `edgeDirection: 'targets' | 'targeted-by'` slice continues to apply when the staged target is an annotation. For `direction: 'targets'`, the captured node is the edge SOURCE and the staged annotation is the edge TARGET (`source_node_id: <new-node>, target_annotation_id: <annotation>`). For `direction: 'targeted-by'`, the roles invert (`source_annotation_id: <annotation>, target_node_id: <new-node>`).

The validator's rule 3 (capture-node, `validateCaptureNodeProposal` at `propose.ts:1355-1411`) accepts either endpoint as the just-captured node id — confirmed in the predecessor's Acceptance criteria. The self-reference guard stays node-scoped: the captured node can't appear on both sides of the edge, but an annotation appearing opposite to the captured node is fine.

### §9. **No mid-drag preview of the prospective annotation endpoint**.

The alternative is to render an in-progress drag-line styled per the annotation-endpoint vs node-endpoint distinction during the `onConnect`-in-progress window. **Rejected** for v1 because:

- ReactFlow's mid-drag rendering is opaque — the drag-line is drawn by ReactFlow's internal pipeline, not by application code. Customizing it per-endpoint-kind would require a non-trivial override.
- The picker opens *after* the drop lands; the moderator confirms the endpoint pair at that point via the visible source/target attributes. The mid-drag UX gap is small.

Future polish — `mod_annotation_drag_preview` — can revisit if moderator feedback warrants. Not registered as a follow-up (no concrete demand).

### §10. **`set-edge-substance` connecting-case fires from `<DrawEdgeRolePicker>` only**; no parallel capture-pane path for set-edge-substance.

The capture-with-edge gesture mints `capture-node` (a fresh node + inline edge); it does NOT mint `set-edge-substance` (which addresses an existing edge with optional connecting-edge minting). The two gestures have different proposal kinds, different validators, different fresh-edge predicates. This task touches both — the draw-edge gesture (`set-edge-substance` connecting-case) AND the capture gesture (`capture-node` with inline `edge`) — but they remain distinct code paths.

A potential future "set-edge-substance from capture pane" gesture (no equivalent today) would be a third path — out of scope.

### §11. **Tech-debt registration**: name follow-ups crisply.

The following follow-ups surface during this task's scope but are out of scope:

- **`mod_annotation_capture_auto_suggest`** (future task — ~0.5d, UI-stream, moderator). Widen the auto-suggest to consider annotation nodes as capture targets when they're the most-recently-active selection. Decision §5 above defers this. Belongs in `moderator_ui.mod_annotation_ui.*` under M7 (the moderator-canvas milestone container that hosts this task). Closer registers in WBS.

- **`mod_annotation_context_menu`** (future task — ~0.5d, UI-stream, moderator). Split a dedicated annotation-node context-menu component with annotation-specific items (e.g. "annotate this annotation", "withdraw annotation"). Decision §6 above defers this. Belongs in `moderator_ui.mod_annotation_ui.*` under M7. Closer registers in WBS.

The pre-existing follow-ups `walkthrough_e15_annotation_endpoint_refit`, `part_render_annotation_endpoint_edges`, `aud_render_annotation_endpoint_edges` are NOT re-registered — they exist in WBS already.

## Open questions

(none — all decided in §1–§11.)

## Status

**Done** — 2026-05-31.

- `apps/moderator/src/graph/DrawEdgeRolePicker.tsx` — `sourceKind`/`targetKind` props added; `handlePick` routes each endpoint id into the kind-appropriate schema slot (`source_node_id` vs `source_annotation_id`, symmetric for target); `data-source-kind`/`data-target-kind` attrs added for test-pinning.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — `endpointKindFromNodeType` helper; `handleNodeClick`/`handleNodeContextMenu` discriminate on `node.type` and dispatch `select({ kind: 'annotation', id })` for annotation nodes; `handleConnect`/`handleConnectEnd` resolve endpoint kinds and pass them to the picker; picker mount site widened to carry `sourceKind`/`targetKind`.
- `apps/moderator/src/graph/selectors.ts` — new `selectAnnotationContentById` selector mirroring `selectNodeWordingById`.
- `apps/moderator/src/stores/captureStore.ts` — `CaptureTargetKind` type; `targetEntityKind` slice (default `'node'`); new `setTargetEntity(kind, id)` atomic setter; legacy `setTargetEntityId` forces `'node'`; all four mode-entry/reset sites restore the default.
- `apps/moderator/src/layout/CaptureTargetChip.tsx` — annotation-staging bridge effect (respects clear); wording-lookup branches on `targetEntityKind`; `data-target-kind` attr for test-pinning.
- `apps/moderator/src/layout/useProposeAction.ts` — `buildCaptureNodeProposal` `edge.otherEntity: {kind, id}` replaces `otherNodeId`; kind-routed slot selection; `propose()` reads and passes `targetEntityKind` from store.
- `tests/e2e/annotation-endpoint-gestures.spec.ts` — new Playwright spec: draw-edge annotation→node scenario + capture-staging annotation-click scenario.
- `playwright.config.ts` — `chromium-moderator-annotation-endpoint-gestures` project entry added.
- Vitest: 329 tests passing; new cases cover `DrawEdgeRolePicker` (4 permutations + kind attrs), `captureStore` (`targetEntityKind` slice + reset sites), `CaptureTargetChip` (annotation staging, override no-stomp, clear), `selectors` (`selectAnnotationContentById`), `useProposeAction` (annotation-endpoint capture × 2 directions + node regression), `GraphCanvasPane` (`handleNodeClick` kind discrimination).
- Tech-debt registered: `mod_annotation_capture_auto_suggest` and `mod_annotation_context_menu` added to `moderator_ui.mod_annotation_ui` and wired to M7.
