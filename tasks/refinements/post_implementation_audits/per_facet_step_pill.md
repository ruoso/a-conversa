# Per-node HTML rendering (`cytoscape-node-html-label`): compose the step pill, wording, and annotations in ONE component inside the node box — and redesign the pill into a per-facet "next step" indicator (graph-view; audience + landing)

**TaskJuggler entry**: [tasks/95-post-implementation-audits.tji](../../95-post-implementation-audits.tji) — task `post_implementation_audits.per_facet_step_pill`.

**Effort estimate**: 5d total. **~3.5d of it has already landed on `main`** (see *Where this stands*); the remaining scope is ≈ 1.5d (the Playwright behavior pin + the dense-graph OBS audit + the footer-band sizing fix + closing the halo decision).

## Where this stands (read this first)

The rendering migration and the step-pill redesign were implemented out-of-band on 2026-06-06 — the same day the task was parked — in five commits tagged `[per_facet_step_pill]`, all on `main`:

| Commit | What landed |
|---|---|
| `37c6c851` | Projection + i18n foundation: `facetCandidates` / `facetVotes` / `debaters` stamped on node data; `currentSubstanceByNode` cache; `methodology.substance.*` in all three locales; the `cytoscape-node-html-label` dependency added (not yet wired). |
| `58985e40` | Pure step-pill view-model (`statementStepModel.ts`) + HTML string builder (`statementNodeHtml.ts`), both Vitest-pinned. |
| `4a6b53b6` | The rendering migration (ADR 0004 2026-06-06 amendment): plugin registered, statement nodes render as one HTML element, canvas wording label hidden, header band reserved in node height, **`PerFacetPillOverlay` deleted**. |
| `dece13b0` | Axiom marks + node-targeted annotations fold into the node HTML footer; **`AxiomMarkOverlay` deleted**; `AnnotationOverlay` slimmed to edge-targeted + non-statement-node annotations only. |
| `f1e9c338` | Two live-surface fixes: single-root tpl (the plugin's live-`HTMLCollection` append silently dropped the middle of three root divs) and the step-selection rule corrected to *deepest-started facet* (see Decision §2). |

The [ADR 0004 2026-06-06 amendment](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) (lines 63–67) records the rendering-model change and points back at this refinement for the performance gate and the transient-halo decision — both now resolved below (Decisions §10, and the *Acceptance criteria* OBS-audit item).

**What remains** (the implementable scope of this task today):

1. **Playwright behavior pin of the step pill** on both reachable surfaces (audience live session + landing walkthrough). The per-node HTML makes graph-canvas content DOM-assertable for the first time — no e2e spec currently touches `.gv-node` / `.gv-pill`. See Acceptance criteria + Decision §13.
2. **Dense-graph OBS-1080p audit scenario** — the agent-checkable half of the ADR's performance gate (Decision §11).
3. **Footer band sizing** — node height reserves the 64 px header band but nothing for the axiom/annotation footer, so footer content overflows the painted frame on decorated nodes (Decision §12).
4. **Close the halo question** — resolved here as *retain the halo overlays* (Decision §10); no code change, the decision is the deliverable.

## Inherited dependencies / context

- `audience.aud_graph_rendering.aud_per_facet_visualization` (settled — shipped 2026-05-28, [`tasks/refinements/audience/aud_per_facet_visualization.md`](../audience/aud_per_facet_visualization.md)). The predecessor whose render layer this task **replaced**: its `PerFacetPillOverlay` (three name-only `<FacetPill>` chips per node) is now deleted; its Decision §3 reading order (`wording → classification → substance`) survives as the step order (as corrected in Decision §2); its "no `votes` prop on the audience `<FacetPill>`" out-of-scope note is the exact decision this task reversed.
- `landing_page.extract_readonly_graph_package` (settled — [`tasks/refinements/landing_page/extract_readonly_graph_package.md`](../landing_page/extract_readonly_graph_package.md); ADR 0039). The overlay + projection live in the shared `@a-conversa/graph-view` package, so the landed change serves the audience broadcast surface AND the landing walkthrough from one edit — confirmed working on both (the `f1e9c338` bugs surfaced on the live landing/audience surfaces).
- `per_facet_refactor.*` (settled). The facet-keyed event model the projection reads: `facetVotePayload`, per-facet `commit`, the `FacetStatus` enum, and the shell helpers `computeFacetStatuses` / `projectVotesByFacet` / `deriveSlotOccupants` (all consumed by the landed projection — see Inputs).
- `landing_page.walkthrough_representative_log` (settled — [`tasks/refinements/landing_page/walkthrough_representative_log.md`](../landing_page/walkthrough_representative_log.md)). Lists this task's graph-view work as its own inherited dependency: the representative walkthrough log exercises facet rounds the step pill renders. The landing e2e (`landing-demo.spec.ts`) derives positions from the narration table, so the landing-side pill assertion (Decision §13) slots in without re-plumbing.
- Prose-only context: the shared `<FacetPill>` at [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) stays the moderator / participant / sidebar per-facet vocabulary, byte-unchanged — confirmed: the landed work never touched `packages/shell/src/facet-pill/**`.

## What this task is

Replace the graph-view per-facet overlay's **row of three name-only pills** with a **single, content-rich "step" pill** per statement node that answers, at a glance on a non-interactive surface: *what is being decided on this statement right now, and where does each debater stand?*

Per statement node, the pill shows the **current step** as:

```
┌─────────────────────────┐
│ CLASSIFICATION: Fact     │   ← facet label + candidate VALUE (line 1)
│ Alice [✓]   Ben [ ]      │   ← one checkbox per debater (line 2)
└─────────────────────────┘
```

- **Line 1** is the facet label, plus — for `classification` and `substance` — the candidate value being voted on (`CLASSIFICATION: Fact`, `SUBSTANCE: Holds`). The `wording` step shows just `WORDING` (the wording text is already the node body).
- **Line 2** is one checkbox per debater: `[ ]` = has not voted, `✓` = agreed, `✗` = disputed.

The pill advances as the capture flow deepens (`WORDING` → `CLASSIFICATION: <kind>` → `SUBSTANCE: <value>`); once classification AND substance are committed the pill is replaced by a **compact settled summary** (`Fact · Holds ✓`).

**The enabling change is a rendering-model shift**: each statement node renders as ONE HTML element bound to its Cytoscape node via `cytoscape-node-html-label` — header step pill, wording body, axiom-mark + annotation footer composed inside the node box, with the plugin owning pan/zoom positioning. The per-node DOM overlays (`PerFacetPillOverlay`, `AxiomMarkOverlay`, the statement-node arm of `AnnotationOverlay`) and their `renderedBoundingBox()` anchoring + `scale(zoom)` machinery are deleted. Recorded as the ADR 0004 2026-06-06 amendment.

**All of the above is implemented and on `main`.** The task's remaining deliverables are the e2e behavior pin, the dense-graph audit, the footer-band fix, and the documented halo resolution (see *Where this stands*).

Out of scope (unchanged from the original refinement):

- **Edges.** Nodes only; the edge rollup paint and edge-targeted annotation badges stay as they are.
- **The shared `<FacetPill>`** and the moderator / participant / sidebar surfaces that consume it.
- **Interactivity.** The per-node HTML is `pointer-events: none` throughout — read-only on both surfaces.
- **The interactive moderator** stays on ReactFlow; the html-label model applies only to the read-only graph-view surfaces.

## Why it needs to be done

The predecessor's three-name-pill row restated the same three static words on every node and carried no candidate/vote signal — low value on a broadcast or landing canvas. The methodology's actual drama is the **sequential capture flow** and the **per-debater positions** at each step; that is what the step pill surfaces, and it is now live on both surfaces.

The remaining work matters because:

- **The behavior has no e2e pin.** The unit layer pins the model and the HTML builder, but nothing asserts the pill on a real surface — and `f1e9c338` is the cautionary tale: *both* of its bugs (wording silently dropped; pill frozen on `WORDING`) were invisible to the unit pins and only surfaced on live surfaces, precisely the gap a Playwright spec closes. The per-node HTML is real DOM now, so the audience/landing canvas content is e2e-assertable for the first time.
- **The ADR's performance gate was never discharged in a recorded form.** The migration landed validated only by live-surface eyeballing during the `f1e9c338` debugging. The dense-graph OBS-audit scenario records the agent-checkable half.
- **Decorated nodes overflow their frame.** Node height accounts for the header band only; axiom/annotation footers spill below the painted per-status border.

## Inputs / context

### ADRs

- [ADR 0004 — ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md): the 2026-06-06 amendment (lines 63–67) IS this task's rendering-model decision; it names the performance gate and defers the halo handling to this refinement.
- [ADR 0021 — Event envelope](../../../docs/adr/0021-event-envelope-discriminated-union.md): the projector narrows the discriminated union; the landed projection reads facet-keyed `vote` and `set-node-substance` payloads.
- [ADR 0024 — react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md): labels resolve through `t('methodology.facet.*')` / `t('methodology.kind.*')` / `t('methodology.substance.*')` at the GraphView projection memo (Decision §14).
- [ADR 0027 — entity / facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md): the step pill is the facet layer surfacing inside the node card; the wording body + frame rollup stay the entity layer.
- [ADR 0030 — per-facet vote keying + sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the sequential capture the pill visualizes; the `FacetStatus` enum driving step selection.
- [ADR 0039 — shared read-only graph-view package](../../../docs/adr/0039-shared-read-only-graph-view-package.md): one edit serves both surfaces; consumers provide the methodology i18n keys.
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md): every remaining deliverable lands as a committed Vitest/Playwright pin, not a manual check.

### Landed implementation (the files the remaining work touches)

- `packages/graph-view/src/projectGraph.ts` — `AudienceNodeData` (lines 203–298) carries `facetCandidates` (:286), `facetVotes` (:291), `debaters` (:297); caches `currentClassificationByNode` (:436) + `currentSubstanceByNode` (:440); roster derived from `projectVotesByFacet` + `deriveSlotOccupants` (:387–389). **`STEP_PILL_BAND_PX = 64`** (:179) is added to measured node height at :475 / :507 — the seam the footer-band fix (Decision §12) extends.
- `packages/graph-view/src/statementStepModel.ts` — the pure view-model: deepest-first facet order (:15–18), `isStarted` (:26–28), `selectStepFacet` (:90–102), `buildStatementStepModel` (:104–142) → `{ kind: 'step', facet, facetLabel, valueLabel, debaters }` | `{ kind: 'settled', classificationLabel, substanceLabel }`.
- `packages/graph-view/src/statementNodeHtml.ts` — pure HTML string builder (the html-label `tpl`, not React): glyphs (:56–66), header (:68–98), footer (:108–130), **single-root `.gv-node` wrapper** (:146–159 — load-bearing, see Decision §9).
- `packages/graph-view/src/GraphView.tsx` — plugin import (:305), `cytoscape.use(nodeHtmlLabel)` (:340), `statementNodeTpl` (:348), per-mount binding for `node[nodeKind = "statement"]` (:476–485), `stepLabels` t()-resolver closures (:520) feeding `buildStatementStepModel` in the projection memo (:541).
- `packages/graph-view/src/nodeDimensions.ts` — `computeNodeDimensions(wording, options?)` (:163–193) measures the wording only; bands are added by the caller (projectGraph).
- `packages/graph-view/src/overlays.css` — `.gv-node` / `.gv-pill` / `.gv-axiom` / `.gv-anno` styles (:353–519, all `pointer-events: none`); the three surviving node-halo animations (`aud-node-appear` :109–171, `aud-withdrawal` :213–270, diagnostic fire :272–351) still use overlay spans with the `--halo-zoom` inline var — retained per Decision §10.
- Surviving overlays: `AnnotationOverlay.tsx` (edge-targeted + non-statement-node annotations only), `NodeAppearOverlay.tsx`, `WithdrawalHaloOverlay.tsx`, `DiagnosticFireOverlay.tsx`, `DiagnosticEdgeFireOverlay.tsx`.

### Data sources (all derivable from the event log)

- `packages/shell/src/votes-by-facet/votes-by-facet.ts:189` — `projectVotesByFacet(events): VotesByFacetIndex`.
- `packages/shell/src/facet-status/facet-status.ts:285` — `computeFacetStatuses(events): FacetStatusIndex`; the `FacetStatus` union (:81–88).
- `packages/shell/src/slots/slots.ts:85` — `deriveSlotOccupants(events): SlotOccupants`.
- `packages/shared-types/src/events/proposals.ts` — `StatementKind` (:66); `set-node-substance` payload with `value: 'agreed' | 'disputed'` (:183–189).

### i18n (all landed)

- `methodology.facet.*`, `methodology.kind.*`, and `methodology.substance.{agreed,disputed}` exist in en-US / pt-BR / es-419 (`packages/i18n-catalogs/src/catalogs/*.json` — substance keys at :298–299) and are pinned in `methodology.test.ts`.

### E2e seams (for the remaining Playwright work)

- `tests/e2e/audience-live-session.spec.ts` — the primary audience e2e; seeds events through the `window.__aConversaWsStore` dev seam via `tests/e2e/fixtures/wsStoreSeed.ts` (`seedNodeCreated`, `seedEdgeCreated`, …). **No proposal/vote/commit seed helpers exist yet** — the store's `applyEvent` is generic, so the new spec adds the missing sugar helpers alongside the existing ones.
- `tests/e2e/landing-demo.spec.ts` — the landing walkthrough e2e; positions derive from the app's narration table (`apps/root/src/walkthrough/narration.ts`), so a pill-content assertion at a known facet-round position is stable against fixture edits.
- `playwright.config.ts` — per-spec chromium projects; a new audience spec needs its own project entry (follow the `chromium-audience-*` pattern).

### What the task MUST NOT do

- No edit to `packages/shell/src/facet-pill/**`. Moderator / participant / sidebar are unaffected.
- No edge facet detail (nodes only).
- No interactivity — the per-node HTML stays `pointer-events: none`.
- No server / wire-protocol / methodology-engine change.
- No switch of the interactive moderator off ReactFlow.

## Constraints / requirements

- **One pill per node** — the html-label tpl emits one `.gv-node` per statement node; nodes without a `stepModel` render nothing (`GraphView.tsx:350`).
- **Current-step selection** per Decision §2 (deepest-started facet); settled summary when classification AND substance are committed.
- **Debater checkboxes**: both roster slots always render (stable `debater-A`, `debater-B` order), `''` / `✓` / `✗` per that debater's vote on the current facet.
- **Single-root tpl invariant**: everything the tpl emits stays inside the one `.gv-node` root (Decision §9) — the plugin's live-collection append drops extra roots.
- **Cross-surface**: changes stay inside `@a-conversa/graph-view` + the e2e layer; no per-app code.
- **Determinism / purity**: `projectGraph` stays a pure function of `events`; `statementStepModel` / `statementNodeHtml` stay pure and i18n-agnostic (labels injected as resolver closures).
- **Footer-band fix** must keep `computeNodeDimensions` wording-only (it is a copied-not-shared module under the third-caller rule, `nodeDimensions.ts:17–20`) — band arithmetic belongs in `projectGraph` where `STEP_PILL_BAND_PX` already lives.

## Acceptance criteria

Already pinned (landed, regression-guarded — listed so the implementer doesn't redo them):

- Step selection, candidate values, per-debater marks, settled summary: `statementStepModel.test.ts` (cases a–j).
- HTML composition, escaping, glyphs, footer ordering, single-root invariant: `statementNodeHtml.test.ts` (cases a–h).
- Projection fields (`facetCandidates` / `facetVotes` / `debaters`), position-invariance with roster: `projectGraph.test.ts`.
- Memo→html-label wiring (`data.stepModel` stamped): `GraphView.test.tsx` (kk).
- `methodology.substance.*` across locales: `methodology.test.ts`.

Remaining (this task's deliverables):

- **Playwright step-pill spec** (`tests/e2e/audience-step-pill.spec.ts`, new project entry in `playwright.config.ts`), seeding through `wsStoreSeed.ts` (adding proposal/vote/commit seed helpers):
  - (a) a seeded statement node renders `.gv-node` with the `WORDING` pill and two empty debater boxes;
  - (b) after a classification proposal + one agree + one dispute vote, the pill reads `Classification: Fact` with `✓` / `✗` marks against the right debater names;
  - (c) after wording/classification/substance all commit, the settled chip (`Fact · Holds ✓`, `.gv-pill--settled`) replaces the step pill;
  - (d) **dense-graph OBS audit**: ~40 seeded statement nodes with step pills at 1920×1080 — all `.gv-node` elements render, no scrollbars (the `no-scrollbars` fixture), no console errors. This is the recorded, agent-checkable half of the ADR 0004 performance gate.
- **Landing assertion**: extend `tests/e2e/landing-demo.spec.ts` with one scenario (or assertion in the desktop scenario) that at a known facet-round walkthrough position the canvas shows a `.gv-pill` with the expected facet label — proving the shared renderer carries the pill on the public surface.
- **Footer band sizing**: decorated nodes (axiom marks and/or node-targeted annotations) no longer overflow the painted frame — `projectGraph` adds a footer band when footer content exists (Decision §12); pinned in `projectGraph.test.ts`.
- The shared `<FacetPill>` and the moderator/participant/sidebar suites remain untouched and green.
- `pnpm run build` clean; `pnpm run test:smoke` green; lint/format clean; `tj3 project.tjp` parse clean (the `complete 100` ritual + `.tji` marker land at task close).
- Per ADR 0022, no throwaway scripts — every check above is a committed Vitest or Playwright pin.

Note for the closer: the *subjective* half of the performance gate — OBS compositing smoothness on real streaming hardware — is a human checkpoint, not WBS work; it goes to `tasks/parking-lot.md` (surfaced in this refinement's return summary), not to a follow-up task.

## Decisions

### §0 — Render per-node content as HTML via `cytoscape-node-html-label` (R: chosen — LANDED `4a6b53b6`)

Three ways to land rich per-node content (step pill + wording + annotations) inside the box:

- **(A — chosen, landed)** The `cytoscape-node-html-label` plugin: each statement node binds one HTML element (header pill / wording body / decoration footer); the plugin owns positioning; the per-node overlays and their `renderedBoundingBox()` + `scale(zoom)` machinery are deleted. Cost: one dependency + the ADR 0004 amendment (in place, lines 63–67).
- **(B)** Keep canvas nodes + DOM overlays anchored to bands inside the node box. Rejected — keeps all the sync machinery; remains the documented *fallback* if the performance gate fails.
- **(C)** Switch the read-only surfaces to ReactFlow. Rejected — contradicts ADR 0004's reason for Cytoscape on these surfaces (node-count perf, OBS compositing).

The earlier plugin rejections (`aud_per_facet_visualization` §1B; `participant.part_per_facet_state_styling` §6) were made with one overlay feature and a detail-panel fallback; with ~8 overlays, a rich pill, and recurring zoom-scaling maintenance, consolidation became the simplifying move. Implementation detail that diverged from the original sketch: the per-node component is a **pure string-template builder** (`statementNodeHtml.ts`), not a mounted React component — the plugin consumes a `tpl(data) → string`, and a string builder keeps the unit pins DOM-light and the happy-dom mount tests green.

### §1 — Single content-rich step pill replaces the three name-pills (LANDED)

The new pill diverges enough from the shared chip (two lines, candidate value, per-participant checkboxes, settled mode) that it is graph-view-local; the shared `<FacetPill>` stays the moderator/participant vocabulary, byte-unchanged.

### §2 — Current step = **deepest-started** facet in `substance → classification → wording` (CORRECTED in `f1e9c338`)

The original rule ("first non-settled facet in wording → classification → substance") was wrong in practice: **wording never reaches a closed status** (a node's wording sits at `proposed`/`agreed`/`disputed` forever), so a first-not-closed scan pins the pill on `WORDING` permanently — exactly the frozen-pill bug `f1e9c338` fixed. The landed rule: the current step is the **deepest facet that has started** (status defined and ≠ `awaiting-proposal`), scanning `substance → classification → wording`; the node is settled (summary mode) only when classification AND substance are both `committed`. Same visual progression, correct semantics. Pinned by `statementStepModel.test.ts` (a–f).

### §3 — Per-participant checkmarks are the two debaters only (R: chosen — LANDED)

`debater-A` / `debater-B` from `deriveSlotOccupants`, both always listed, boxes fill as votes land. The moderator facilitates rather than votes. The roster array is the single extension point if that ever changes.

### §4 — Candidate value: kind label for classification, substance label for substance, none for wording (LANDED)

`classification` → `t('methodology.kind.<kind>')`; `substance` → `t('methodology.substance.<value>')`; `wording` → label only. No candidate yet → label + empty boxes.

### §5 — Vote glyphs: empty box / `✓` / `✗` (LANDED)

`✓` U+2713 for agree, `✗` U+2717 for dispute, CSS-bordered empty box for no vote (`statementNodeHtml.ts:56–66`, `overlays.css:432–441`). Monochrome-on-tint per the audience palette — settled by implementation.

### §6 — Settled state: compact summary (R: chosen — LANDED)

Both deep facets committed → `gv-pill--settled` chip joining the two decided values with a check (`Fact · Holds ✓`). Either label can be absent (renders what exists; degenerate case just `✓`) — which also resolves the old meta-disagreement question: a facet closed without a value simply contributes no label. The pill otherwise **pins on a meta-disagreement facet** (it is "started" but never `committed`), which is the right broadcast signal: the pill points at exactly where the debate is stuck.

### §7 — Extend the projection; derive everything from the event log (LANDED `37c6c851`)

`facetCandidates` + `facetVotes` + `debaters` stamped in a post-walk pass composing `projectVotesByFacet`, the classification cache, the new `currentSubstanceByNode` cache, and `deriveSlotOccupants`. Pure function of `events`; no server/wire change.

### §8 — Ship in `@a-conversa/graph-view`; both audience and landing get it (R: confirmed — LANDED)

One edit served both surfaces, as ADR 0039 promised; the `f1e9c338` fixes were verified on both.

### §9 — Single-root tpl wrapper (LANDED `f1e9c338` — load-bearing)

`cytoscape-node-html-label` parses `tpl(data)` with DOMParser and appends the parsed body's children **while iterating a live `HTMLCollection`** — with multiple root elements the iteration skips every other child, silently dropping content (the wording body, in the original bug). Everything the tpl emits therefore lives inside one `.gv-node` root; pinned by a DOMParser-based single-root test. Any future edit to the tpl must preserve this invariant.

### §10 — Transient halos stay DOM overlays; no CSS-on-element migration (R: chosen)

The original open question proposed moving the node-halo animations (`node-appear`, `withdrawal`, `diagnostic-fire`) onto the per-node HTML element as CSS keyframes, deleting the `--halo-zoom` plumbing. Resolved as **keep the overlays**:

- Halos fire on entities that have **no HTML element**: annotation nodes (the html-label binding is `node[nodeKind = "statement"]` only) and edge midpoints (`DiagnosticEdgeFireOverlay`). A CSS-on-element migration would cover statement nodes only, splitting byte-identical keyframes across two code paths while the overlay seam survives regardless for edges/annotation nodes.
- The machinery §0 retired was the *per-frame bounding-box sync for persistent content*; the halos are 450 ms fire-and-forget transients whose positioning cost is negligible, and `--halo-zoom` is a one-line inline var, not the retired `scale(zoom)` content machinery.
- Alternative (migrate statement-node halos, retain the rest): rejected — two render paths for one animation family, nothing deleted.

This discharges the halo clause the ADR 0004 amendment delegated to this refinement; no ADR edit needed (the amendment already names "a retained … overlay" as one of the two outcomes and links here for the resolution).

### §11 — The performance gate is discharged by a recorded dense-graph audit + a human OBS checkpoint

ADR 0004's amendment required validating per-node HTML "at the audience's expected node counts and the OBS baseline before the migration lands". The migration landed validated only informally (live-surface debugging). Rather than un-land it, the gate is discharged in two parts: **(a)** the dense-graph OBS-audit Playwright scenario (Acceptance criteria d) — functional correctness at ~40 nodes at 1920×1080, committed and re-runnable; **(b)** subjective compositing smoothness on real OBS hardware — a human checkpoint routed to `tasks/parking-lot.md`, NOT a WBS task (per the no-audit-task rule). Frame-time assertions in Playwright were considered and rejected as flaky-by-construction. If the human checkpoint fails, the documented fallback remains Decision §0 (B).

### §12 — Footer band: reserve height in `projectGraph` when footer content exists (R: chosen)

Node height = measured wording box + `STEP_PILL_BAND_PX` (64) — nothing for the axiom/annotation footer, so decorated nodes overflow their painted frame. Fix: `projectGraph` adds a `FOOTER_BAND_PX` to `height` **only when** the node has axiom marks or node-targeted annotations (both counts already known at projection time, same call sites :475/:507). Alternatives: (i) status quo overflow — rejected, the frame is the entity-layer paint and content spilling past it reads as broken on a broadcast; (ii) putting band arithmetic into `computeNodeDimensions` — rejected, that module is a wording-measurer copied under the third-caller rule and shouldn't grow graph-view-specific band knowledge.

### §13 — E2e lands now, in this task (no deferral)

The UI-stream e2e policy defers Playwright only when the surface is unreachable. The step pill is rendered on two public routes today (`/a/sessions/:id` and `/`), and the per-node HTML is precisely what makes canvas content assertable — plus the `f1e9c338` episode proves the unit pins structurally cannot catch tpl/live-DOM integration bugs. Scoping: a dedicated `audience-step-pill.spec.ts` (seeded flow, scenarios a–d) rather than growing the already-1290-line `audience-live-session.spec.ts`, and one landing assertion riding the existing `landing-demo.spec.ts` narration-table machinery. No deferred-e2e debt is created, and none was found pointing at this task (the WBS carries no `deferred e2e` markers naming `per_facet_step_pill`).

### §14 — Localization at the GraphView projection memo, not in the projector (LANDED — recording the seam)

`projectGraph` stays i18n-agnostic (raw enum values in `facetCandidates`); `GraphView` builds `stepModel` in its projection memo by passing `t()`-wrapping resolver closures (`stepLabels`, `GraphView.tsx:520–524`) to the pure `buildStatementStepModel`. Locale change re-runs the memo and re-renders the pills. This keeps the projector pure/deterministic (the replay + landing contract) while labels still live-switch.

## Open questions

(none — all decided. The single human checkpoint — OBS compositing smoothness on real streaming hardware, Decision §11b — is routed to `tasks/parking-lot.md` via the closer, not held open here.)

## Status

**Done** — 2026-06-11.

- **Footer-band height fix** (`packages/graph-view/src/projectGraph.ts`): conditional `FOOTER_BAND_PX = 28` via `footerBandPx()` added to node height at both call sites (node-created pass at `:475` and reword re-measure at `:507`); decorated nodes (axiom marks / node-targeted annotations) no longer overflow their painted frame.
- **Vitest `projectGraph (audience baseline)` cases (fb1)–(fb4)** (`packages/graph-view/src/projectGraph.test.ts`): footer band on axiom-marked and annotated nodes, no stacking, survives reword. Suite green: 62/62.
- **Playwright `audience-step-pill.spec.ts`** (`tests/e2e/audience-step-pill.spec.ts`, new file): scenarios (a) wording pill + empty debater boxes, (b) `Classification: Fact` with ✓/✗ against correct debater names, (c) settled chip `Fact · Holds ✓`, (d) dense-graph OBS-1080p audit at ~40 nodes — all `.gv-node` elements render, no scrollbars, no console errors. Discharges the ADR 0004 agent-checkable performance gate half (Decision §11a).
- **`playwright.config.ts`**: new `chromium-audience-step-pill` project entry for the dedicated spec.
- **Landing classification-beat assertion** (`tests/e2e/landing-demo.spec.ts`): `.gv-pill` assertion in the desktop beat walk confirms the shared renderer carries the pill on the public surface.
- **Halo decision closed** (Decision §10): transient halos retained as DOM overlays — no code change; the decision is the deliverable. ADR 0004 amendment halo clause discharged.
- **Parking lot**: subjective OBS compositing smoothness checkpoint (Decision §11b) routed to `tasks/parking-lot.md` — human-only verification, not WBS work.
