# Lift the cross-surface `Annotation` projection trio into `@a-conversa/shell` (third-caller trigger fired by audience annotation rendering)

**TaskJuggler entry**: [tasks/27-shell-package.tji](../../27-shell-package.tji) — task `shell_package.extract_cytoscape_projectors` (lines 101-108).
**Effort estimate**: 1d
**Inherited dependencies**:

- `shell_package.extract_facet_pill` (settled — [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md)). The source-of-debt. Decision §8 there pre-registered this leaf alongside `shell_package.extract_facet_status_rules`: "lifts `projectAnnotations`/`projectAxiomMarks`/`projectPendingAxiomMarks`/`projectVotesByFacet`/`groupAnnotationsBy*` when audience graph rendering becomes the third caller" ([`extract_facet_pill.md` line 226](extract_facet_pill.md#L226)). The `!` strict-predecessor edge in the `.tji` enforces commit-order: this leaf cannot land before `extract_facet_pill`. Done — `extract_facet_pill` landed and established the cross-Cytoscape projector extraction trigger.
- `audience.aud_graph_rendering` (settled umbrella — [`tasks/refinements/audience/aud_graph_rendering.md`](../audience/aud_graph_rendering.md) and its decomposed leaves). The third-caller trigger. Two of its leaves are the source-of-debt for this extraction:
  - `audience.aud_graph_rendering.aud_annotation_rendering` (settled — [`tasks/refinements/audience/aud_annotation_rendering.md`](../audience/aud_annotation_rendering.md)). Ported `projectAnnotations` + `groupAnnotationsByNode` + `EMPTY_ANNOTATIONS` + the `Annotation` interface verbatim from the participant's `apps/participant/src/graph/annotations.ts` into [`apps/audience/src/graph/annotations.ts`](../../../apps/audience/src/graph/annotations.ts); Decision §3 there explicitly named `shell_package.extract_cytoscape_projectors` as the now-fired extraction trigger and noted "no new WBS entry" because this task was already registered.
  - `audience.aud_graph_rendering.aud_annotation_rendering_edges` (settled 2026-05-28 — [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](../audience/aud_annotation_rendering_edges.md)). Added `groupAnnotationsByEdge` to the same audience-local module as a verbatim port of the participant's symmetric helper, and explicitly stated in its source-of-debt note that "the `extract_cytoscape_projectors` shell-extract has NOT landed at this leaf's commit time, so the bucketer lives here alongside `groupAnnotationsByNode`; once the extract lands, callers re-point their imports to `@a-conversa/shell` and this module is deleted" ([`aud_annotation_rendering_edges.md` lines 15-24](../audience/aud_annotation_rendering_edges.md#L15)).
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_axiom_marks_extraction` (settled 2026-05-28 — [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md)). The immediate shape-precedent. Already consolidated the parallel axiom-mark trio (`projectAxiomMarks` + `groupAxiomMarksByNode` + `AxiomMark` interface + `EMPTY_AXIOM_MARKS`) plus the `<AxiomMarkBadge>` component into `packages/shell/src/axiom-marks/`; reduces the WBS task description's name list by two projectors (`projectAxiomMarks` + `groupAxiomMarksByNode` are NOT in scope here — already shipped). The leaf's structural decisions (sibling-directory layout, root re-export, participant shim, atomic transition, Vitest consolidation, no new Playwright/Cucumber) are the direct template this refinement inherits.
- Prose-only context (NOT a `.tji` edge): `shell_package.shell_substrate_extraction` (settled — [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md)). Established the `packages/shell/src/<area>/` directory layout, the root re-export convention via [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts), and the Vitest-coverage posture for lifted helpers.
- Prose-only context (NOT a `.tji` edge): `participant_ui.part_graph_view.part_annotation_render` (settled — [`tasks/refinements/participant-ui/part_annotation_render.md`](../participant-ui/part_annotation_render.md)). The second caller of the annotation trio. Decision §2 there documented why the participant ports rather than lifts (two callers is YAGNI; lift when audience becomes the third). Decision §1 there established `nodeHasAnnotation` / `edgeHasAnnotation` / `annotationCountFor` as participant-local boolean+count helpers — the participant's at-a-glance card layer collapses the per-annotation list to a single presence boolean + count per target (neither the moderator nor the audience consumes this collapse; both render the full per-annotation list).
- Prose-only context (NOT a `.tji` edge): `moderator_ui.mod_annotation_rendering` (settled — [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](../moderator-ui/mod_annotation_rendering.md)). The first caller. Established the canonical `Annotation` interface shape (`id` / `kind` / `content` / `targetNodeId` / `targetEdgeId` / `createdBy` / `createdAt`), `EMPTY_ANNOTATIONS = Object.freeze<readonly Annotation[]>([])` posture, single-pass `projectAnnotations(events)` walk, and the `Map<id, Annotation[]>` bucketer shape.

## What this task is

The 1d mechanical refactor that lifts the **annotation projection trio** — the `Annotation` interface, the `EMPTY_ANNOTATIONS` frozen empty array, the `projectAnnotations(events)` pure walk, the `groupAnnotationsByNode(annotations)` bucketer, and the `groupAnnotationsByEdge(annotations)` bucketer — out of three client workspaces (`apps/moderator/`, `apps/participant/`, `apps/audience/`) into a single canonical home at `packages/shell/src/annotations/`, then rewires every client-side caller to import from `@a-conversa/shell` and deletes / shims the three local copies.

This refinement **narrows the WBS description's name list**. The original `.tji` description ([`tasks/27-shell-package.tji:101`](../../27-shell-package.tji#L101)) names five families: `projectAnnotations` + `projectAxiomMarks` + `projectPendingAxiomMarks` + `projectVotesByFacet` + `groupAnnotationsBy*`. Two reductions apply at this leaf's commit time:

1. **`projectAxiomMarks` + `groupAxiomMarksByNode` are already in the shell.** [`shell_axiom_marks_extraction`](shell_axiom_marks_extraction.md) landed 2026-05-28 and consolidated them into `packages/shell/src/axiom-marks/`. They are out of scope here — already done, with their own dedicated home and Vitest suite.
2. **`projectPendingAxiomMarks` + `groupPendingAxiomMarksByNode` and `projectVotesByFacet` are still single-caller (moderator-only)** at this leaf's commit time. The third-caller policy that drives every shell extraction (per [`extract_facet_pill.md`](extract_facet_pill.md) Decision §2, re-invoked by every shell-package successor) does NOT fire for one-caller helpers. The participant Cytoscape projector intentionally re-implements vote-by-facet with a different output shape (`apps/participant/src/proposals/otherVotesByFacet.ts` — see [`mod_axiom_mark_pending_render.md`](../moderator-ui/mod_axiom_mark_pending_render.md) and [`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4 for the "two callers with diverging shapes is YAGNI" reasoning); the audience has not yet landed vote-by-facet rendering or pending-axiom-mark rendering. Lifting one-caller helpers into the shell would prematurely ossify shapes that have not yet been pressure-tested by a third caller. Both extractions get **named-future-tasks** registered in the WBS by the closer (Decision §3).

The **trigger is the third-caller policy**. The audience's `aud_annotation_rendering` + `aud_annotation_rendering_edges` leaves landed verbatim ports of the annotation trio (with `EMPTY_ANNOTATIONS` + the `Annotation` interface) — the third copy of each — which is the explicit trigger documented in both source-of-debt refinements.

After this leaf:

- A new directory `packages/shell/src/annotations/` lands with: `annotations.ts` (the canonical `Annotation` interface + `EMPTY_ANNOTATIONS` + `projectAnnotations` + `groupAnnotationsByNode` + `groupAnnotationsByEdge` from the moderator's [`selectors.ts:58-66, 154-274`](../../../apps/moderator/src/graph/selectors.ts#L58) block, lifted verbatim with the participant's `annotations.ts` header comment as the docstring); `annotations.test.ts` (the union Vitest coverage from the moderator + participant + audience suites — the participant's boolean/count helper cases stay participant-side, see Decision §1); `index.ts` barrel that re-exports the five public symbols.
- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) re-exports the new symbols (`Annotation`, `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`) under a new `// ─── annotations ───` block, alongside the existing `axiom-marks` / `facet-pill` / etc. re-exports, preserving the root-import convention every prior shell extraction established.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) loses the annotation block: the `Annotation` interface (lines 58-66), `EMPTY_ANNOTATIONS` (line 160), `projectAnnotations` (lines 214-229), `groupAnnotationsByNode` (lines 239-253), `groupAnnotationsByEdge` (lines 260-274). The `selectAnnotations(state, sessionId)` wrapper (lines 169-173) is rewritten as a thin local helper that re-uses the shell-lifted `projectAnnotations` (or is deleted entirely — see Decision §4). Other helpers in `selectors.ts` (the pending-axiom-mark + votes-by-facet + edge-selection blocks) stay untouched; the file shrinks from ~829 lines to ~700 lines. The internal uses at line 430 (`groupAnnotationsByEdge(projectAnnotations(session.events))` inside `selectEdgesForSession`) and line 451 (`EMPTY_ANNOTATIONS` fallback) re-import the symbols from `@a-conversa/shell`.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) at lines 115/118/120 rewires the existing `EMPTY_ANNOTATIONS` / `groupAnnotationsByNode` / `projectAnnotations` imports to `@a-conversa/shell`. The call site at line 499 (`groupAnnotationsByNode(projectAnnotations(events))`) and line 534 (`EMPTY_ANNOTATIONS` fallback) are unchanged in behavior.
- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) loses the annotation cases (the `projectAnnotations` block around lines 27-35 + the `groupAnnotationsBy{Node,Edge}` describe block at line 842, plus the `selectAnnotations` block). The consolidated suite at `packages/shell/src/annotations/annotations.test.ts` carries the coverage union. The `selectAnnotations` cases either move to a thin moderator-local replacement test (if the wrapper is retained per Decision §4) or are subsumed.
- [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts) collapses to a re-export shim: the five lifted names re-exported from `@a-conversa/shell`; the participant-local boolean+count helpers (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`) stay defined in this file (their call sites in [`apps/participant/src/graph/projectGraph.ts:103-105, 486-487, 513-514`](../../../apps/participant/src/graph/projectGraph.ts#L103) are unchanged). This is the same shape `shell_axiom_marks_extraction` Decision §5 chose for the participant's `axiomMarks.ts`.
- [`apps/participant/src/graph/annotations.test.ts`](../../../apps/participant/src/graph/annotations.test.ts) loses the `projectAnnotations` / `groupAnnotationsBy{Node,Edge}` describe blocks (subsumed by the shell suite); the `nodeHasAnnotation + edgeHasAnnotation` + `annotationCountFor` describe blocks stay (their helpers are still participant-local).
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) at lines 72-74 either continues to import via the shim (no change) or — per Decision §5 — retargets directly at `@a-conversa/shell`. The chosen shape is "continue importing via the shim" to keep the diff blast radius minimal; the shim is the contract that lets in-workspace imports keep working unchanged.
- [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) at line 38 continues to import via the shim (the test imports `groupAnnotationsByEdge` / `groupAnnotationsByNode` / `projectAnnotations` from `./annotations`, which resolve through the re-export shim).
- [`apps/audience/src/graph/annotations.ts`](../../../apps/audience/src/graph/annotations.ts) is **deleted entirely**. The audience module carries NONE of the boolean/count helpers (per its own Decision §3: "verbatim inline port of the projection helpers minus the unused boolean/count helpers"); no leftover symbols remain to host a shim. The audience's own header comment at lines 19-24 anticipates this: "once the extract lands, callers re-point their imports to `@a-conversa/shell` and this module is deleted."
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) at lines 108-111 rewires the import (`EMPTY_ANNOTATIONS` / `groupAnnotationsByEdge` / `groupAnnotationsByNode` / `projectAnnotations` from `./annotations`) to `@a-conversa/shell`.
- [`apps/audience/src/graph/AnnotationOverlay.test.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.test.tsx) at line 40 (`import { EMPTY_ANNOTATIONS, type Annotation } from './annotations'`) rewires to `@a-conversa/shell`.
- [`apps/audience/src/graph/annotations.test.ts`](../../../apps/audience/src/graph/annotations.test.ts) is deleted; the consolidated `packages/shell/src/annotations/annotations.test.ts` carries the coverage union.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) at lines 741+ continues to use `EMPTY_ANNOTATIONS` via the rewired import (the test file is not a target for rewiring as it doesn't import `EMPTY_ANNOTATIONS` directly — it asserts the constant's identity through `projectGraph`'s output; if it does import directly, the import path is updated to `@a-conversa/shell`).

Out of scope (kept local; deferred; or already settled):

- **`projectAxiomMarks` + `groupAxiomMarksByNode` + the `AxiomMark` interface + `EMPTY_AXIOM_MARKS`.** Already in `packages/shell/src/axiom-marks/` since 2026-05-28 (via `shell_axiom_marks_extraction`). No work here.
- **`projectPendingAxiomMarks` + `groupPendingAxiomMarksByNode` + the `PendingAxiomMark` interface + `EMPTY_PENDING_AXIOM_MARKS`.** Single caller (moderator only, [`apps/moderator/src/graph/selectors.ts:295-422`](../../../apps/moderator/src/graph/selectors.ts#L295)); no participant or audience port exists. Deferred to a future task `shell_package.extract_pending_axiom_mark_projector` (~0.5d, closer registers in WBS — Decision §3) which fires when the second caller materializes (likely the participant's pending-axiom-mark rendering, currently unscoped) AND the third caller (audience pending-axiom-mark rendering, currently unscoped) lands.
- **`projectVotesByFacet`.** Single caller in the moderator's `selectors.ts:641-777`; the participant uses a different output shape via `apps/participant/src/proposals/otherVotesByFacet.ts` (per [`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4 — "two callers with diverging shapes is YAGNI"); the audience has not yet landed vote-by-facet rendering. Deferred to a future task `shell_package.extract_votes_by_facet_projector` (~0.5d, closer registers in WBS — Decision §3) which fires when the participant's per-facet vote projector converges shape with the moderator's AND when an audience caller materializes.
- **`projectVotesByProposal`.** Not in the original WBS description list; moderator-only ([`selectors.ts:779`](../../../apps/moderator/src/graph/selectors.ts#L779)); follows the same single-caller exclusion rule. Not registered as a named-future-task here — surfaces only if a second caller appears.
- **Participant boolean+count helpers** (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`). Stay in [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts) (after the file collapses to a re-export shim around the lifted symbols, these three helpers remain defined locally). Single-workspace call sites; boolean+count collapse shape that neither the moderator nor the audience consumes — both surfaces render the full per-annotation list. Lifting them would force the moderator + audience to take helpers they don't call. This is the same per-workspace-local pattern `shell_axiom_marks_extraction` Decision §1 used for `nodeHasAxiomMark`.
- **`selectAnnotations(state, sessionId)`.** A moderator-side thin wrapper that pulls the events slice off `WsState` and delegates to `projectAnnotations`. The wrapper is moderator-internal (depends on `WsState` from `@a-conversa/shell`'s ws subsystem) and has a single in-workspace call site. Decision §4 documents whether the wrapper stays in `selectors.ts` (as a thin call-through to the shell-lifted projector) or is deleted; either choice keeps the moderator-only `selectAnnotations` shape out of the shell.
- **`StatementEdgeData` / `StatementNode` typing concerns.** Moderator-specific ReactFlow data shape that consumes `Annotation[]` as one of its fields (line 76 of `selectors.ts`); the moderator's data-shape interfaces stay in the moderator workspace. The shell-lifted `Annotation` type satisfies the moderator's existing field declarations by structural typing.
- **Wire format / projection output / methodology semantics.** This is a pure file-location refactor. `Annotation` interface fields stay byte-identical (`id` / `kind` / `content` / `targetNodeId` / `targetEdgeId` / `createdBy` / `createdAt`); `projectAnnotations` walks the same `annotation-created` envelopes; both bucketers produce the same `Map<id, Annotation[]>` shape with the same null-target-skip semantics. No shared-types change. No projector output change.
- **`AnnotationKind`.** Already in [`packages/shared-types/src/events.ts`](../../../packages/shared-types/src/events.ts); imported as a type by every annotation-projector caller including the shell-lifted one. No movement.
- **Per-annotation badge / chromatic / aria-label.** The audience surface paints per-annotation amber badges via [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx); the moderator's per-annotation badge / hover-detail surface is its own component tree; the participant's at-a-glance overlay is a boolean+count collapse. None of those surfaces' React component code is in scope here — those are surface-specific consumers of the lifted projection trio. The badge consolidation (if and when it's warranted by a third React consumer with matching prop shape) is a separate future task; this leaf consolidates the data layer only.
- **Subpath export entries in `packages/shell/package.json` (`"./annotations"`).** Not required — every prior shell substrate re-exports from `index.ts` root (per Decision §6); consumers import `{ projectAnnotations, groupAnnotationsByEdge } from '@a-conversa/shell'` directly.
- **Audience routing / placeholder unwiring.** Unchanged. The audience surface remains at its current routing state; `aud_session_url` is a separate future task. This leaf does not change reachability for any surface.
- **Playwright / Cucumber coverage.** This is a pure refactor with no user-visible behavior change, no protocol seam crossed, no projector output shift. Per ADR 0022 the Vitest layer (consolidated into the shell) plus the existing client-tier integration tests (continuing to pass after the import-path rewire) are the regression pin. Decision §7 documents why no new e2e is scoped.

## Why it needs to be done

Three near-identical copies of the same ~100-line annotation projection block (`Annotation` interface + `EMPTY_ANNOTATIONS` + `projectAnnotations` + `groupAnnotationsByNode` + `groupAnnotationsByEdge`) live in three workspaces today:

- [`apps/moderator/src/graph/selectors.ts:58-274`](../../../apps/moderator/src/graph/selectors.ts#L58) (canonical, ~100 lines for the block; the broader file holds non-annotation helpers).
- [`apps/participant/src/graph/annotations.ts:56-146`](../../../apps/participant/src/graph/annotations.ts#L56) (verbatim port from the moderator; lines 148-193 are participant-local boolean+count helpers that stay).
- [`apps/audience/src/graph/annotations.ts:59-147`](../../../apps/audience/src/graph/annotations.ts#L59) (verbatim port from the participant minus the boolean/count helpers).

The duplication is not load-bearing — every copy is structurally byte-identical for the five lifted symbols. The cost of leaving the duplication in place is the standard cross-surface drift risk: a methodology change to annotation semantics (e.g. adding an `annotation-edited` or `annotation-removed` event kind per ADR 0021's envelope discriminated union; changing the `Annotation` interface shape to carry an `editedAt` timestamp; refining the per-target XOR enforcement) has to be applied in three files in three different apps with three different test suites, and any update that fails to land in all three sites silently desynchronizes the surfaces' rendering of methodology bedrock.

The third-caller policy (from [`extract_facet_pill.md`](extract_facet_pill.md) Decision §2) exists for this case: at two callers the API shape is still under negotiation; at three callers the convergence point is empirical. The audience's `aud_annotation_rendering` + `aud_annotation_rendering_edges` leaves shipped verbatim ports that confirmed the five-name surface (interface + frozen empty + projection walk + two bucketers) is exactly what every caller needs. The participant's outlier boolean+count helpers (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`) are an example of where the third-caller-policy correctly excludes single-caller code from the shell lift — those helpers stay participant-local (Decision §1).

The follow-on benefits:

- **One source of truth for annotation methodology surfacing.** A future ADR or refinement that touches annotation semantics edits one `packages/shell/src/annotations/` block instead of three workspaces. The next surface to land annotation rendering (replay-test, OBS composite, future per-session per-edge timeline) imports from `@a-conversa/shell` directly — no cross-workspace ports, no fourth-caller-extraction registration.
- **Reduced client-side bundle work.** The shell package is already a runtime dependency of every UI surface (per ADR 0026 / `shell_substrate_extraction`); moving the annotation code there does not add a new dependency edge — it consolidates code that's already shipped to every client into a single chunk that participates in the shell's build output.
- **Test consolidation.** Three Vitest suites covering the same projection rules collapse into one. Cross-surface contract regressions (e.g. the audience and participant reading a different XOR-handling semantics from the moderator) become structurally impossible because there is only one implementation to test against.
- **Pattern continuity.** The leaf is the second of (at least) three planned cross-Cytoscape-projector extractions on the `aud_graph_rendering`-third-caller cadence: `shell_axiom_marks_extraction` shipped 2026-05-28, this leaf is next, and the deferred `extract_pending_axiom_mark_projector` + `extract_votes_by_facet_projector` follow when their own third callers materialize. Each follows the same recipe; consistency reduces review friction.

This leaf is registered against the trigger fired by the two audience annotation rendering leaves per the orchestrator brief's tech-debt registration policy; both source-of-debt refinements explicitly named it.

## Inputs / context

### ADRs

- [ADR 0021 — Event envelope discriminated union](../../../docs/adr/0021-event-envelope-discriminated-union.md) — `projectAnnotations` narrows on the `annotation-created` envelope; the lift preserves the existing narrowing rule. No envelope-shape change. The future `annotation-edited` / `annotation-removed` extensions (when they land) edit the shell-side projector once; this leaf is the consolidation that makes that future edit a single-site change.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest consolidation pins both the projection walk and the bucketer behavior once, at the canonical home. The three client-tier integration test suites (moderator `GraphCanvasPane`, participant `OperateRoute` + `GraphView`, audience `AnnotationOverlay` + `projectGraph`) continue to pass against the lifted symbols; that is the regression pin for the import-path rewire.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the shell package is the canonical shared substrate for every UI surface; lifting the annotation vocabulary here is the architecturally-correct destination per the ADR.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — annotations are first-class methodology entities that sit alongside facet state but in a separate layer. The `packages/shell/src/annotations/` directory sits as a sibling to `packages/shell/src/facet-pill/` (facet layer) and `packages/shell/src/axiom-marks/` (entity-disposition layer) — the directory split makes the layer boundary visible at the file system level.

No new ADR. The architectural seams (third-caller extraction policy, root-export shell convention, sibling-directory layout under `packages/shell/src/`, participant-shim collapse pattern) are all settled by prior shell-package refinements + ADR 0026.

### Sibling refinements

- [`tasks/refinements/shell-package/shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md) — the direct shape-precedent. Same shape: third-caller-fired cross-Cytoscape projector lift; sibling shell subdirectory; root re-export; participant collapses to re-export shim + local helpers; audience module deleted; consolidated Vitest suite; no new Playwright/Cucumber.
- [`tasks/refinements/shell-package/shell_substrate_extraction.md`](shell_substrate_extraction.md) — the foundational precedent for the `packages/shell/src/<area>/` directory layout and the root re-export convention via `packages/shell/src/index.ts`.
- [`tasks/refinements/shell-package/extract_facet_pill.md`](extract_facet_pill.md) — Decision §2 codifies the third-caller rule; Decision §8 pre-registers this leaf and explains why a partial co-move (annotations only, not the whole `selectors.ts`) is the correct surgery.
- [`tasks/refinements/audience/aud_annotation_rendering.md`](../audience/aud_annotation_rendering.md) — Decision §3 is the source-of-debt; the audience's verbatim port of the node-target projection helpers fired the trigger condition.
- [`tasks/refinements/audience/aud_annotation_rendering_edges.md`](../audience/aud_annotation_rendering_edges.md) — Decision §2 + the audience module header at [`apps/audience/src/graph/annotations.ts:15-24`](../../../apps/audience/src/graph/annotations.ts#L15) explicitly anticipate this extraction.
- [`tasks/refinements/participant-ui/part_annotation_render.md`](../participant-ui/part_annotation_render.md) — Decision §1 explains the participant's boolean+count collapse (the local-only helpers that stay participant-side); Decision §2 explains why two callers wasn't enough to extract.
- [`tasks/refinements/moderator-ui/mod_annotation_rendering.md`](../moderator-ui/mod_annotation_rendering.md) — establishes the canonical `Annotation` interface shape and the projection-walk contract every later port mirrored.

### Live code the leaf modifies / creates / deletes

**Creates** (canonical home):

- `packages/shell/src/annotations/annotations.ts` — **NEW**. Verbatim lift of the annotation block from [`apps/moderator/src/graph/selectors.ts:58-66, 154-274`](../../../apps/moderator/src/graph/selectors.ts#L58) (the `Annotation` interface, `EMPTY_ANNOTATIONS = Object.freeze<readonly Annotation[]>([])`, `projectAnnotations(events: readonly Event[]): Annotation[]`, `groupAnnotationsByNode(annotations: readonly Annotation[]): Map<string, Annotation[]>`, `groupAnnotationsByEdge(annotations: readonly Annotation[]): Map<string, Annotation[]>`). Header comment names this as the third-caller consolidation, links back to the three predecessor port refinements (moderator / participant / audience), notes the parallel pattern with [`shell_axiom_marks_extraction.md`](shell_axiom_marks_extraction.md), and links to [`docs/methodology.md`](../../../docs/methodology.md) §"Annotations" for methodology context. Imports `AnnotationKind` and `Event` from `@a-conversa/shared-types` (existing dependency).
- `packages/shell/src/annotations/index.ts` — **NEW**. Barrel re-export: `Annotation` (type), `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`.
- `packages/shell/src/annotations/annotations.test.ts` — **NEW**. Consolidates the moderator + participant + audience projection coverage. ≥9 Vitest cases (matching the union of the three predecessor suites, modulo the participant's boolean/count helper cases which stay participant-side):
  - empty log → `[]`;
  - one node-targeted `annotation-created` → one `Annotation` with the right `id` / `kind` / `content` / `targetNodeId` / `createdBy` / `createdAt`, and `targetEdgeId: null`;
  - one edge-targeted `annotation-created` → one `Annotation` with `targetEdgeId` populated and `targetNodeId: null`;
  - multiple annotations preserve arrival order;
  - mixed log — non-annotation event kinds are ignored;
  - all `AnnotationKind` variants round-trip through the projector;
  - `groupAnnotationsByNode` buckets node-targeted annotations + skips edge-targeted ones;
  - `groupAnnotationsByEdge` buckets edge-targeted annotations + skips node-targeted ones;
  - both bucketers produce O(1) `Map` lookups + return empty `Map` for an empty annotations input.

**Modifies**:

- [`packages/shell/src/index.ts`](../../../packages/shell/src/index.ts) — adds the new `// ─── annotations ───` block (or equivalent named re-exports matching the prevailing pattern in the file); re-exports `Annotation` (type), `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`.
- [`apps/moderator/src/graph/selectors.ts`](../../../apps/moderator/src/graph/selectors.ts) — the annotation block is deleted: the `Annotation` interface (lines 58-66), `EMPTY_ANNOTATIONS` (line 160), `projectAnnotations` (lines 214-229), `groupAnnotationsByNode` (lines 239-253), `groupAnnotationsByEdge` (lines 260-274). The `selectAnnotations` wrapper (lines 169-173) either stays as a thin call-through importing `projectAnnotations` from `@a-conversa/shell` (Decision §4 option A) or is deleted with its single call site rewritten (option B). The `StatementEdgeData` interface (lines 69-152) keeps its `annotations: readonly Annotation[]` field; the `Annotation` type now comes from `@a-conversa/shell` via an in-file import. The internal use at line 430 (`groupAnnotationsByEdge(projectAnnotations(session.events))`) and line 451 (`EMPTY_ANNOTATIONS` fallback) re-import from `@a-conversa/shell`. The other in-file references at the comment lines (14, 15, 258, 416, 579) are documentation-only and need no change.
- [`apps/moderator/src/graph/GraphCanvasPane.tsx`](../../../apps/moderator/src/graph/GraphCanvasPane.tsx) — lines 115/118/120's imports of `EMPTY_ANNOTATIONS` / `groupAnnotationsByNode` / `projectAnnotations` rewire to `@a-conversa/shell`. Call sites at lines 499 + 534 unchanged.
- [`apps/moderator/src/graph/selectors.test.ts`](../../../apps/moderator/src/graph/selectors.test.ts) — the annotation cases are deleted (the `projectAnnotations` describe block + the `groupAnnotationsByNode / groupAnnotationsByEdge` describe block at line 842, plus the `selectAnnotations` block). Other (non-annotation) cases in this file stay untouched. The consolidated suite at `packages/shell/src/annotations/annotations.test.ts` carries the coverage.
- [`apps/moderator/src/graph/diagnosticHighlights.ts`](../../../apps/moderator/src/graph/diagnosticHighlights.ts) — line 169's comment reference (`EMPTY_*` pattern citation) is unchanged (it's a passing comment, not an import); no rewire.
- [`apps/participant/src/graph/annotations.ts`](../../../apps/participant/src/graph/annotations.ts) — collapses to a re-export shim. The lines that define the lifted symbols (the `Annotation` interface lines 56-64, `EMPTY_ANNOTATIONS` line 73, `projectAnnotations` lines 84-99, `groupAnnotationsByNode` lines 111-125, `groupAnnotationsByEdge` lines 132-146) are deleted. The file's top-of-file becomes `export { Annotation, EMPTY_ANNOTATIONS, projectAnnotations, groupAnnotationsByNode, groupAnnotationsByEdge } from '@a-conversa/shell';` (or the namespace re-export equivalent matching the file's TypeScript posture). The participant-local helpers `nodeHasAnnotation` (lines 155-160), `edgeHasAnnotation` (lines 169-174), `annotationCountFor` (lines 188-193) stay defined in this file. Decision §5 documents why the shim shape is preferred over deletion + scattering.
- [`apps/participant/src/graph/annotations.test.ts`](../../../apps/participant/src/graph/annotations.test.ts) — the `projectAnnotations` describe block (lines 192-307) + the `groupAnnotationsByNode` describe block (lines 310-350) + the `groupAnnotationsByEdge` describe block (lines 352-391) are deleted (subsumed by the shell suite). The `nodeHasAnnotation + edgeHasAnnotation` block (lines 394-421) and the `annotationCountFor` block (lines 424-464) stay (the helpers are still participant-local).
- [`apps/participant/src/graph/projectGraph.ts`](../../../apps/participant/src/graph/projectGraph.ts) — line 103-105's imports of `annotationCountFor` / `edgeHasAnnotation` / `nodeHasAnnotation` from `./annotations` are preserved (still resolve through the local definitions inside the shim file); no code change needed.
- [`apps/participant/src/routes/OperateRoute.tsx`](../../../apps/participant/src/routes/OperateRoute.tsx) — line 72-74's imports of `groupAnnotationsByEdge` / `groupAnnotationsByNode` / `projectAnnotations` from `./annotations` (or wherever the source path is) continue to resolve through the shim. Per Decision §5, no rewire is required.
- [`apps/participant/src/graph/GraphView.tsx`](../../../apps/participant/src/graph/GraphView.tsx) — comment-only references on lines 28, 784, 786 are unchanged. If the file imports `Annotation` as a type (per the surrounding code), that import resolves through the shim.
- [`apps/participant/src/graph/GraphView.test.tsx`](../../../apps/participant/src/graph/GraphView.test.tsx) — line 38's `import { groupAnnotationsByEdge, groupAnnotationsByNode, projectAnnotations } from './annotations'` continues to resolve through the shim.
- [`apps/participant/src/graph/projectGraph.test.ts`](../../../apps/participant/src/graph/projectGraph.test.ts) — comment-only reference at line 139 unchanged.
- [`apps/participant/src/detail/participantRoster.ts`](../../../apps/participant/src/detail/participantRoster.ts) — comment-only reference at line 39 unchanged.
- [`apps/audience/src/graph/projectGraph.ts`](../../../apps/audience/src/graph/projectGraph.ts) — lines 108-111's imports of `EMPTY_ANNOTATIONS` / `groupAnnotationsByEdge` / `groupAnnotationsByNode` / `projectAnnotations` from `./annotations` rewire to `@a-conversa/shell`. Call sites at lines 230-232, 257, 279 unchanged.
- [`apps/audience/src/graph/AnnotationOverlay.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.tsx) — if the file imports `Annotation` or `EMPTY_ANNOTATIONS` from `./annotations`, those imports rewire to `@a-conversa/shell`. (The grep showed `AnnotationOverlay.test.tsx` carries this dependency; the non-test source file may or may not.)
- [`apps/audience/src/graph/AnnotationOverlay.test.tsx`](../../../apps/audience/src/graph/AnnotationOverlay.test.tsx) — line 40's `import { EMPTY_ANNOTATIONS, type Annotation } from './annotations'` rewires to `@a-conversa/shell`. The ~11 in-file `EMPTY_ANNOTATIONS` references in test bodies are unchanged in behavior.
- [`apps/audience/src/graph/projectGraph.test.ts`](../../../apps/audience/src/graph/projectGraph.test.ts) — if the test file imports `EMPTY_ANNOTATIONS` directly from `./annotations`, that import rewires to `@a-conversa/shell`. The ~2 in-test references at lines 741+ are unchanged in behavior.

**Deletes**:

- [`apps/audience/src/graph/annotations.ts`](../../../apps/audience/src/graph/annotations.ts) — entire file removed (no participant-style local helpers to preserve).
- [`apps/audience/src/graph/annotations.test.ts`](../../../apps/audience/src/graph/annotations.test.ts) — entire file removed (coverage moves to the shell suite).

**Unchanged**:

- `packages/shell/src/axiom-marks/**`, `packages/shell/src/facet-pill/**`, all other shell substrates — UNCHANGED (sibling areas).
- `packages/shared-types/**` — UNCHANGED (no wire change; `AnnotationKind` and `Event` continue to live there).
- `packages/i18n-catalogs/**` — UNCHANGED (annotation i18n keys exist for the surfaces' own components; this leaf doesn't move components).
- `apps/server/**`, `apps/root/**` — UNCHANGED.
- `apps/moderator/src/graph/selectors.ts` non-annotation blocks (the `PendingAxiomMark` projector at lines 295-422, `selectEdgesForSession` at lines 423+, `projectVotesByFacet` at lines 641+, `projectVotesByProposal` at lines 779+, `selectNodeWordingById` at lines 196-204) — UNCHANGED.
- All routes, providers, mount-effects — UNCHANGED.
- `apps/moderator/package.json`, `apps/participant/package.json`, `apps/audience/package.json` — UNCHANGED (`@a-conversa/shell` already in each `dependencies`).
- `packages/shell/package.json` — UNCHANGED. The new `annotations/` directory ships under the existing `"."` (root) export; no subpath export entry needed (Decision §6).
- `docs/adr/**` — UNCHANGED. No new ADR.
- `playwright.config.ts` / `tests/e2e/**` / Cucumber feature files — UNCHANGED (Decision §7).
- `.tji` files at task-write time. Two updates land at task-completion time per the [README ritual](../README.md): `complete 100` on `shell_package.extract_cytoscape_projectors`, plus closer-side registration of the two named-future-tasks `shell_package.extract_pending_axiom_mark_projector` and `shell_package.extract_votes_by_facet_projector` (Decision §3).

### What this task MUST NOT do

- **No wire-schema change.** The `Annotation` interface shape lifts byte-for-byte; the field set (`id`, `kind`, `content`, `targetNodeId`, `targetEdgeId`, `createdBy`, `createdAt`) stays exactly as it is across all three current copies. No shared-types churn.
- **No methodology change.** `projectAnnotations` semantics are byte-for-byte preserved; the `annotation-created` narrowing stays as-is. No event-handling rule change.
- **No new dependency.** `@a-conversa/shared-types` is already on `packages/shell`'s path; no other dependencies are added.
- **No new ADR.** Every architectural seam (third-caller extraction, root-export convention, sibling-directory layout, participant-shim collapse) is settled.
- **No lift of participant boolean+count helpers.** `nodeHasAnnotation` / `edgeHasAnnotation` / `annotationCountFor` stay participant-local per Decision §1.
- **No lift of `projectAxiomMarks` / `groupAxiomMarksByNode`.** Already in the shell since 2026-05-28 — do NOT re-extract or move.
- **No lift of `projectPendingAxiomMarks` / `projectVotesByFacet`.** Single-caller; deferred to two named-future-tasks per Decision §3.
- **No subpath export entry in `packages/shell/package.json`** (e.g. `"./annotations"`). Root-export only — Decision §6.
- **No full deletion of `apps/participant/src/graph/annotations.ts`.** The file collapses to a re-export shim + the three participant-local helpers; full deletion is rejected per Decision §5.
- **No movement of `selectAnnotations`.** Stays moderator-internal (its `WsState` dependency is moderator-coupled); see Decision §4.
- **No movement of `AnnotationKind`.** Already in `@a-conversa/shared-types`.
- **No edit to badge / overlay React components.** This leaf consolidates the data layer; surface-specific React components stay in their workspaces.
- **No Playwright / Cucumber scope.** Pure refactor — Decision §7.
- **No edit to `apps/server/**`, `apps/root/**`, or any non-client / non-shell file.**

## Constraints / requirements

### Files this task touches (explicit allowlist)

**Creates**:

- `packages/shell/src/annotations/annotations.ts` — **NEW**. The five lifted names verbatim from `apps/moderator/src/graph/selectors.ts`. Header docstring links to the three predecessor port refinements (moderator + participant + audience) + the two audience source-of-debt refinements + `docs/methodology.md` §"Annotations".
- `packages/shell/src/annotations/index.ts` — **NEW**. Barrel re-export of the public surface (`Annotation` type, `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`).
- `packages/shell/src/annotations/annotations.test.ts` — **NEW**. ≥9 Vitest cases (union coverage of moderator + participant + audience projection suites, minus the participant's local-helper cases; specific case list under "Live code the leaf modifies / creates" above).

**Modifies**:

- `packages/shell/src/index.ts` — adds the re-export block.
- `apps/moderator/src/graph/selectors.ts` — deletes the annotation block; preserves `selectAnnotations` as a thin call-through (Decision §4 option A) or deletes it (option B).
- `apps/moderator/src/graph/selectors.test.ts` — deletes the annotation cases; keeps the (non-annotation) rest.
- `apps/moderator/src/graph/GraphCanvasPane.tsx` — rewires annotation imports to `@a-conversa/shell`.
- `apps/participant/src/graph/annotations.ts` — collapses to re-export shim + retains the three participant-local helpers (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`).
- `apps/participant/src/graph/annotations.test.ts` — deletes the projection / bucketer cases; keeps the local-helper cases.
- `apps/audience/src/graph/projectGraph.ts` — rewires annotation imports to `@a-conversa/shell`.
- `apps/audience/src/graph/AnnotationOverlay.tsx` — rewires `Annotation` / `EMPTY_ANNOTATIONS` imports to `@a-conversa/shell` (if present).
- `apps/audience/src/graph/AnnotationOverlay.test.tsx` — rewires `Annotation` / `EMPTY_ANNOTATIONS` imports to `@a-conversa/shell`.
- `apps/audience/src/graph/projectGraph.test.ts` — rewires direct `EMPTY_ANNOTATIONS` import to `@a-conversa/shell` (if present).

**Deletes**:

- `apps/audience/src/graph/annotations.ts`
- `apps/audience/src/graph/annotations.test.ts`

### Files this task does NOT touch

- `apps/server/**`, `apps/root/**` — UNCHANGED.
- `packages/shared-types/**`, `packages/i18n-catalogs/**` — UNCHANGED.
- `packages/shell/src/axiom-marks/**`, `packages/shell/src/facet-pill/**`, `packages/shell/src/auth/**`, etc. — UNCHANGED.
- `apps/moderator/src/graph/selectors.ts` non-annotation blocks — UNCHANGED.
- All routes, providers, mount-effects, WS handlers, projector outputs — UNCHANGED.
- `apps/{moderator,participant,audience}/package.json`, `packages/shell/package.json` — UNCHANGED.
- `docs/adr/**` — UNCHANGED.
- `playwright.config.ts` / `tests/e2e/**` / Cucumber feature files — UNCHANGED.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md); the closer also registers the two named-future-tasks per Decision §3.

## Acceptance criteria

The check that says "done":

- `packages/shell/src/annotations/annotations.ts` exists and exports `Annotation` (type), `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge`. The interface field set, the frozen-empty array reference, the projection-walk semantics, and the bucketer behavior are byte-for-byte identical to the three predecessor copies (the moderator's `selectors.ts:58-274` block is the canonical source; the participant + audience copies were verbatim ports of it).
- `packages/shell/src/annotations/index.ts` re-exports the public surface; `packages/shell/src/index.ts` adds a re-export block for the new symbols.
- `packages/shell/src/annotations/annotations.test.ts` exists with ≥9 cases as listed above.
- `apps/audience/src/graph/annotations.ts` and `apps/audience/src/graph/annotations.test.ts` are removed from the working tree.
- `apps/moderator/src/graph/selectors.ts` no longer carries the annotation block (the five names are absent); the file's remaining (non-annotation) content is byte-identical to before, modulo the `selectAnnotations` wrapper's status per Decision §4.
- `apps/participant/src/graph/annotations.ts` is a re-export shim for the five lifted names + the three participant-local helper definitions (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`); the helpers' call sites in `projectGraph.ts` continue to compile.
- Every client-side consumer of the lifted symbols imports from `@a-conversa/shell`:
  - Moderator: `GraphCanvasPane.tsx`, the rewritten internal uses inside `selectors.ts`.
  - Participant: imports continue to resolve through the shim (no consumer rewire) per Decision §5.
  - Audience: `projectGraph.ts`, `AnnotationOverlay.tsx` (if it has the imports), `AnnotationOverlay.test.tsx`, `projectGraph.test.ts` (if it has the imports).
- `grep -rE "(projectAnnotations|groupAnnotationsByNode|groupAnnotationsByEdge|EMPTY_ANNOTATIONS)" apps/ packages/` shows only:
  - Consumers (with `from '@a-conversa/shell'` import OR — for the participant — via the local shim).
  - The participant shim re-exporting them from `@a-conversa/shell`.
  - The shell's own definition + test file + barrel.
  - No third-workspace local definition (no `apps/audience/src/graph/annotations.ts`; no in-line definition in `apps/moderator/src/graph/selectors.ts`).
- `grep -rE "interface Annotation\b" apps/ packages/` shows only the canonical shell definition; no per-workspace duplicate interface declaration.
- `pnpm run check` clean (strict TS pass; no new dep declared; the lifted types match the three client-tier consumers byte-for-byte).
- `pnpm run test:smoke` green. The Vitest count net-change: ≥9 new cases land in `packages/shell/src/annotations/**`; the moderator + participant + audience projection cases for the lifted symbols are deleted (subsumed); the participant local-helper cases stay; the moderator + audience integration tests (`GraphCanvasPane.test.tsx`, `AnnotationOverlay.test.tsx`, `projectGraph.test.ts`) continue passing against the lifted symbols. The net Vitest count should not regress (the consolidated suite is the union of the predecessor projection coverage, minus the participant-local helper coverage which stays in place).
- `pnpm -F @a-conversa/shell build` succeeds. `pnpm -F @a-conversa/moderator build`, `pnpm -F @a-conversa/participant build`, `pnpm -F @a-conversa/audience build` each succeed.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/27-shell-package.tji` gets `complete 100` on `shell_package.extract_cytoscape_projectors` in the same commit (the closer's ritual).
- The closer registers two named-future-tasks in `tasks/27-shell-package.tji` per Decision §3:
  - `shell_package.extract_pending_axiom_mark_projector` (~0.5d) — "Lift `projectPendingAxiomMarks` + `groupPendingAxiomMarksByNode` + `PendingAxiomMark` + `EMPTY_PENDING_AXIOM_MARKS` from `apps/moderator/src/graph/selectors.ts` into `packages/shell/src/pending-axiom-marks/` once a second + third caller materialize (likely participant + audience pending-axiom-mark rendering)."
  - `shell_package.extract_votes_by_facet_projector` (~0.5d) — "Lift `projectVotesByFacet` from `apps/moderator/src/graph/selectors.ts` into `packages/shell/src/votes-by-facet/` once the participant's `proposals/otherVotesByFacet.ts` converges shape with the moderator's projector (per [`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4) AND an audience caller materializes."
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer (consolidated at the canonical shell home) plus the three client-tier integration test suites continuing to pass after the import-path rewire are the full regression pin. No new Playwright / Cucumber scope (Decision §7).

## Decisions

### §1 — Participant boolean+count helpers stay participant-local; not lifted

The participant's [`annotations.ts:155-193`](../../../apps/participant/src/graph/annotations.ts#L155) defines three boolean+count helpers — `nodeHasAnnotation(grouped, nodeId): boolean`, `edgeHasAnnotation(grouped, edgeId): boolean`, `annotationCountFor(grouped, id): number` — consumed by [`projectGraph.ts:486-487, 513-514`](../../../apps/participant/src/graph/projectGraph.ts#L486) to stamp `hasAnnotation: boolean` + `annotationCount: number` on every projected node + edge data record. The participant's Cytoscape canvas drives `node[?hasAnnotation]` / `edge[?hasAnnotation]` selectors off these stamps to paint the at-a-glance overlay (per [`part_annotation_render.md`](../participant-ui/part_annotation_render.md) Decision §1).

Neither the moderator nor the audience consumes these helpers — both surfaces render the full per-annotation `Annotation[]` list (the moderator paints per-annotation badges in its detail surfaces; the audience's `AnnotationOverlay` paints amber badges per annotation per target). A boolean+count collapse would discard load-bearing data they need to keep.

Three options:

- **(A — chosen)** Leave the three helpers defined in the participant's local `annotations.ts` (which collapses to a re-export shim around the five lifted names per Decision §5). Single-workspace call sites, single-workspace tests. Direct parallel with `shell_axiom_marks_extraction` Decision §1's treatment of `nodeHasAxiomMark`.
- **(B)** Lift the three helpers into `packages/shell/src/annotations/` alongside the five canonical symbols. Cost: introduces shell-side symbols with single-workspace callers; future readers see them in the shell and may assume cross-surface use; the moderator and audience reviewers would have to justify why they don't call the apparent "correct" boolean+count helpers. The orchestrator brief's "name the future task crisply" applies inversely: don't introduce shell-side symbols that exist solely for one caller.
- **(C)** Inline the boolean+count logic at the call sites; delete the helpers entirely. Cost: the participant's test suite loses three small dedicated coverage blocks; the projector grows three inline one-liners that the named helpers already abstract. Marginal cost; the existing helpers aren't broken.

Chosen: (A). Honors the third-caller policy mechanically (the helpers have one workspace caller; the policy doesn't fire). The pattern matches `shell_axiom_marks_extraction` Decision §1 for `nodeHasAxiomMark` — same shape, same rationale, same shim arrangement.

### §2 — `packages/shell/src/annotations/` sibling directory (not folded into `axiom-marks/` or `facet-pill/`)

The shell already carries two near-sibling projector areas: `packages/shell/src/axiom-marks/` (the parallel projection trio for axiom-marks) and `packages/shell/src/facet-pill/` (facet-layer vocabulary). Two options for where the lifted annotation code lands:

- **(A — chosen)** A new sibling directory `packages/shell/src/annotations/` with the five lifted names + the barrel. Sibling to `axiom-marks/` and `facet-pill/`.
- **(B)** Fold the lifted code into `packages/shell/src/axiom-marks/` (rename to `entity-projections/` or similar). Cost: the directory's name (`axiom-marks/`) reads as the axiom-mark-specific container; conflating two distinct entity-layer projections under one name blurs the per-vocabulary grouping the shell substrate established. Annotations and axiom-marks have different methodology semantics (per ADR 0027's layer-separation principle, both sit in the entity-disposition layer but they are independent vocabularies). The current directory naming is per-vocabulary; this leaf should follow that pattern.
- **(C)** Fold the lifted code into `packages/shell/src/facet-pill/`. Cost: facet-pill is facet-layer code per ADR 0027; annotations sit in the entity-disposition layer; mixing the two would obscure the layer boundary the directory split makes visible.

Chosen: (A). Same sibling-directory rationale as `shell_axiom_marks_extraction` Decision §2 — the file-tree layout makes the per-vocabulary grouping visible, and future shell extractions (pending-axiom-marks, votes-by-facet) follow the same one-directory-per-vocabulary shape.

### §3 — Narrow the WBS scope to the annotation trio; defer pending-axiom-marks and votes-by-facet to two named-future-tasks

The original WBS description ([`tasks/27-shell-package.tji:101-108`](../../27-shell-package.tji#L101)) names five projector families: `projectAnnotations` + `projectAxiomMarks` + `projectPendingAxiomMarks` + `projectVotesByFacet` + `groupAnnotationsBy*`. Two reductions apply at this leaf's commit time:

1. `projectAxiomMarks` + `groupAxiomMarksByNode` are already in `packages/shell/src/axiom-marks/` (via `shell_axiom_marks_extraction`, 2026-05-28). Out of scope here.
2. `projectPendingAxiomMarks` + `groupPendingAxiomMarksByNode` and `projectVotesByFacet` are **single-caller** at this leaf's commit time (moderator-only). The third-caller policy does not fire.

Three options for handling the single-caller leftovers:

- **(A)** Lift them anyway, "since the WBS description named them." Cost: violates the third-caller policy that every shell extraction inherits; premature ossification of shapes the participant has already chosen to diverge from ([`part_graph_render.md`](../participant-ui/part_graph_render.md) Decision §4 explicitly says the participant's vote-by-facet shape diverges from the moderator's because "two callers with diverging shapes is YAGNI"). The lifted code would sit unused by two of three workspaces.
- **(B — chosen)** Narrow this leaf's scope to the annotation trio only (the three-caller convergent surface); register two named-future-tasks for the deferred extractions. Each future task lists its trigger condition (the second + third caller materializing with convergent shape). The closer adds these to `tasks/27-shell-package.tji` at task-completion time. Names:
  - `shell_package.extract_pending_axiom_mark_projector` (~0.5d)
  - `shell_package.extract_votes_by_facet_projector` (~0.5d)
- **(C)** Defer the entire leaf to "when all four families have three callers." Cost: indefinitely delays consolidation of the annotation trio (which has its three callers TODAY); the audience's `aud_annotation_rendering` + `aud_annotation_rendering_edges` already shipped verbatim ports anticipating this extraction; the duplication cost compounds the longer the wait.

Chosen: (B). Lifting the annotation trio honors the trigger fired by the audience leaves; registering the two named-future-tasks honors the third-caller policy for the not-yet-convergent helpers. The orchestrator brief's tech-debt registration policy (name the future task crisply, with an effort estimate and a one-line description) is satisfied by both registrations.

### §4 — Moderator's `selectAnnotations(state, sessionId)` wrapper stays moderator-local (thin call-through OR deleted)

The moderator's [`selectors.ts:169-173`](../../../apps/moderator/src/graph/selectors.ts#L169) defines a thin wrapper `selectAnnotations(state: WsState, sessionId: string): Annotation[]` that pulls the events slice off `state.sessionState[sessionId]?.events` and delegates to `projectAnnotations(session.events)`. The wrapper has a `WsState` dependency (moderator-coupled — `WsState` comes from `@a-conversa/shell`'s ws subsystem but the wrapper's signature is a moderator-internal pattern) and is consumed within `selectors.ts` itself (e.g. by `selectEdgesForSession` at line 430, which inlines the `projectAnnotations(session.events)` call rather than going through `selectAnnotations`). It's also used by the moderator's `selectors.test.ts` test fixtures.

Three options:

- **(A — chosen)** Keep `selectAnnotations` defined in `selectors.ts` as a thin call-through that imports `projectAnnotations` from `@a-conversa/shell` and continues to delegate. The wrapper stays moderator-internal; its `WsState` coupling stays where the rest of the moderator's `WsState`-keyed wrappers live (e.g. `selectNodeWordingById` at line 196).
- **(B)** Delete `selectAnnotations`; rewrite the test fixtures and any in-workspace callers to call `projectAnnotations(state.sessionState[sessionId]?.events ?? [])` inline. Cost: a small in-workspace cleanup; the inline shape is slightly noisier than the wrapper at each call site; the wrapper isn't strictly necessary but does carry a small ergonomic benefit (`null`-safe handling of the session lookup) that consumers would otherwise duplicate.
- **(C)** Lift `selectAnnotations` to the shell. Cost: introduces a `WsState`-coupled wrapper into the shell that has no participant or audience caller (both surfaces consume events from their own WS clients with different routing patterns); violates the third-caller policy for the wrapper.

Chosen: (A). Preserves the existing `selectors.ts` wrapper-collection pattern; minimizes diff blast radius; keeps the `WsState` coupling moderator-side where the rest of the `Ws`-keyed wrappers already live. The wrapper becomes a one-line call-through to the shell-lifted projector — its existence is justified by the in-file convention and the null-safe convenience.

### §5 — Participant `annotations.ts` collapses to a re-export shim (not deleted; helpers stay in place)

The participant's `annotations.ts` carries eight symbols today: the five canonical projection names (which lift to the shell) plus three participant-local boolean+count helpers (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`). Three options for what happens to the file:

- **(A — chosen)** Collapse to a re-export shim: the file re-exports the five lifted names from `@a-conversa/shell` and continues to define the three local helpers locally. Existing in-workspace imports (e.g. `import { Annotation, nodeHasAnnotation, projectAnnotations } from './annotations'`) continue to resolve through the shim without rewiring.
- **(B)** Delete the file; move the three local helpers next to their call sites (e.g. inline into `projectGraph.ts` or to a new sibling file `apps/participant/src/graph/annotationHelpers.ts`); rewrite every participant-side caller to import the five lifted names directly from `@a-conversa/shell`. Cost: every in-workspace import path needs rewriting; the helper test file needs relocation or merging; the cleanup is mechanical but its blast radius is much larger than the shim option's zero churn outside the lifted-block deletion.
- **(C)** Delete the file; rewrite every caller; collapse the three helpers to inline boolean+count expressions at their call sites. Cost: drops three small helpers entirely (option (C) of Decision §1, applied at the same time); broader import-path rewrite than necessary.

Chosen: (A). Preserves the participant's existing import paths inside the workspace; keeps the three helpers colocated with the annotation vocabulary they depend on; minimizes the diff blast radius. The shim is six lines (`export { ... } from '@a-conversa/shell';` plus the three existing helper definitions); no future reader is misled because the file's purpose remains "participant-local annotation utilities, sourced from shell where canonical".

This is the direct parallel of `shell_axiom_marks_extraction` Decision §5 for `axiomMarks.ts` — same shape, same rationale.

### §6 — Root re-export from `@a-conversa/shell`, not a subpath export

Same call as `shell_axiom_marks_extraction` Decision §4 and every prior shell extraction. Two options:

- **(A — chosen)** Re-export `Annotation`, `EMPTY_ANNOTATIONS`, `projectAnnotations`, `groupAnnotationsByNode`, `groupAnnotationsByEdge` from `packages/shell/src/index.ts`. Consumers import via `import { projectAnnotations, groupAnnotationsByEdge } from '@a-conversa/shell'`.
- **(B)** Add a subpath export entry `"./annotations"` to `packages/shell/package.json`'s `exports` map. Cost: introduces a manifest-maintenance edge that no prior shell extraction needed; the consumer's import path becomes verbose for no offsetting benefit.

Chosen: (A). Honors the convention every prior shell extraction established; keeps the consumer import path uniform across all shell-provided symbols.

### §7 — No new Playwright / Cucumber coverage (Vitest + existing integration tests are sufficient)

Same call as `shell_axiom_marks_extraction` Decision §6. Three observations frame this:

1. This task is a pure file-location refactor. No user-visible behavior changes; no protocol seam crossed; no projector output shifts. The three client-tier integration test suites that exercise the annotation projector + bucketers (`apps/moderator/src/graph/GraphCanvasPane.test.tsx` and any node-rendering tests; `apps/participant/src/graph/GraphView.test.tsx`; `apps/audience/src/graph/AnnotationOverlay.test.tsx` + `projectGraph.test.ts`) continue passing against the lifted symbols — that is the structural regression pin for the import-path rewire.
2. The task lives under `shell_package.*`, not under any of the UI-stream groups that the orchestrator brief's UI-stream e2e policy applies to. No reachability change for any surface; no new route, no new event surface.
3. The cross-surface Cucumber rule applies to wire / broadcast / projector changes observable at the system seam. `projectAnnotations` is an internal client-side projector consumed by graph-renderers, not a wire / broadcast surface. Vitest is the architecturally-correct pin.

Three options:

- **(A — chosen)** Vitest at the canonical home (`packages/shell/src/annotations/**`) plus the existing client-tier integration tests continuing to pass. No new Playwright. No new Cucumber.
- **(B)** Scope a Playwright spec that renders the audience overlay / participant overlay / moderator card to pin the visual contract post-lift. Cost: redundant with the predecessor refinements' own Playwright + visual-regression coverage; the lift does not change the badge/overlay visual contract.
- **(C)** Scope a Cucumber scenario for the projection logic. Cost: Cucumber pins wire/broadcast/projector-system-seam behavior per ADR 0021 + ADR 0030; `projectAnnotations` is an internal client-side projector, not a wire/broadcast surface. Vitest is correct.

Chosen: (A). The Vitest layer is already at full coverage from the three predecessor suites' union; consolidating it at the shell home preserves coverage and centralizes future-maintenance work. The client-tier integration tests continuing to pass post-rewire is the structural regression pin; no new e2e scope is owed.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-28.

- Created `packages/shell/src/annotations/annotations.ts` — canonical home for `Annotation` + `EMPTY_ANNOTATIONS` + `projectAnnotations` + `groupAnnotationsByNode` + `groupAnnotationsByEdge`.
- Created `packages/shell/src/annotations/index.ts` — barrel re-export of the public surface.
- Created `packages/shell/src/annotations/annotations.test.ts` — 10 consolidated Vitest cases (projection a–f, by-node g, by-edge h–i, empty-input j).
- Added `// ─── annotations ───` re-export block to `packages/shell/src/index.ts`.
- `apps/moderator/src/graph/selectors.ts` — annotation block deleted; `selectAnnotations` retained as thin call-through (Decision §4A); all internal consumers repointed to `@a-conversa/shell`.
- `apps/moderator/src/graph/selectors.test.ts` — projection/bucketer cases removed; 3 `selectAnnotations` wrapper-pinning cases retained.
- `apps/moderator/src/graph/{GraphCanvasPane.tsx, AnnotationBadge.tsx, AnnotationBadge.test.tsx, HoverPopover.test.tsx, StatementEdge.test.tsx, StatementNode.tsx, StatementNode.test.tsx}` — six moderator consumers retargeted from `./selectors` → `@a-conversa/shell` for the `Annotation` type.
- `apps/participant/src/graph/annotations.ts` — collapsed to re-export shim; three local helpers retained (`nodeHasAnnotation`, `edgeHasAnnotation`, `annotationCountFor`) per Decision §1.
- `apps/participant/src/graph/annotations.test.ts` — trimmed to helper cases only (i + j); projection/bucketer cases subsumed by shell suite.
- `apps/audience/src/graph/{projectGraph.ts, AnnotationOverlay.tsx, AnnotationOverlay.test.tsx, AnnotationBadge.tsx, AnnotationBadge.test.tsx}` — all rewired to `@a-conversa/shell`.
- Deleted `apps/audience/src/graph/annotations.ts` and `apps/audience/src/graph/annotations.test.ts`; no local helpers to preserve; coverage moved to shell suite.
- Two tech-debt tasks registered in `tasks/27-shell-package.tji`: `extract_pending_axiom_mark_projector` + `extract_votes_by_facet_projector` (Decision §3).
