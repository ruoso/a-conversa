# Per-node HTML rendering (`cytoscape-node-html-label`): compose the step pill, wording, and annotations in ONE component inside the node box — and redesign the pill into a per-facet "next step" indicator (graph-view; audience + landing)

**TaskJuggler entry**: [tasks/95-post-implementation-audits.tji](../../95-post-implementation-audits.tji) — task `post_implementation_audits.per_facet_step_pill`.

**Effort estimate**: 5d (rendering-model migration to per-node HTML + collapsing the per-node DOM overlays into it + the step-pill redesign + an ADR). Larger than a pill tweak because it changes how every node's content is rendered.

**Inherited dependencies / context**:

- `audience.aud_graph_rendering.aud_per_facet_visualization` (settled — shipped 2026-05-28, [`tasks/refinements/audience/aud_per_facet_visualization.md`](../audience/aud_per_facet_visualization.md)). The predecessor this task **replaces at the render layer**. It landed the DOM-overlay seam (`PerFacetPillOverlay`) painting a row of three `<FacetPill>` chips per node, one per facet, each carrying only the localized facet NAME (`Wording` / `Classification` / `Substance`) + a per-status border treatment. Its Decisions §1 (DOM-overlay sibling), §2 (anchor above the node box), §4 (rAF-batched subscription set), §5 (`cy` lifted to `useState`) carry over **verbatim** — this task changes WHAT each placement renders, not the overlay plumbing. Its Decision §3 (iterate `wording → classification → substance`) is reused as the step order, and its out-of-scope note "no `votes` prop on the audience `<FacetPill>`" is the exact decision this task **reverses** (per-participant attribution now lands on the broadcast/landing canvas).
- `landing_page.extract_readonly_graph_package` (settled — [`tasks/refinements/landing_page/extract_readonly_graph_package.md`](../landing_page/extract_readonly_graph_package.md); ADR 0039). The overlay + projection were lifted out of `apps/audience/src/graph/` into the shared `@a-conversa/graph-view` package after the predecessor shipped, so the files this task edits are now `packages/graph-view/src/PerFacetPillOverlay.tsx` and `packages/graph-view/src/projectGraph.ts`. **Editing the shared package means both the audience broadcast surface AND the landing walkthrough get the redesign from one change** — this is the explicit cross-surface requirement.
- `per_facet_refactor.*` (settled). The facet-keyed event model this task reads: `facetVotePayload` (`{ entity_id, facet, participant, choice: 'agree' | 'dispute' }`), the per-facet `commit`, and the per-facet `FacetStatus` enum. The shell helpers `computeFacetStatuses(events)`, `projectVotesByFacet(events)` (→ `VotesByFacetIndex = Map<entityId, Map<FacetName, Vote[]>>`), and `deriveSlotOccupants(events)` (role → `{ userId, screenName }`) all exist and are exported from the `@a-conversa/shell` barrel.
- Prose-only context: `moderator_ui.mod_per_facet_state_visualization` + `shell-package.extract_facet_pill`. The shared `<FacetPill>` at [`packages/shell/src/facet-pill/FacetPill.tsx`](../../../packages/shell/src/facet-pill/FacetPill.tsx) stays the moderator / participant / sidebar per-facet vocabulary **unchanged**. This task does NOT touch it — the redesigned step-pill is a new graph-view-local component (the audience/landing need diverges from the shared chip).

## What this task is

Replace the graph-view per-facet overlay's **row of three name-only pills** with a **single, content-rich "step" pill** per statement node that answers, at a glance on a non-interactive surface: *what is being decided on this statement right now, and where does each debater stand?*

The current overlay (the predecessor's output) paints `< WORDING >< CLASSIFICATION >< SUBSTANCE >` — three chips that just restate the static facet names with a border color per status. On the broadcast and landing canvases this is low-signal: it repeats the same three words on every node and carries no information about the candidate value being voted on or who has voted. This task turns the overlay into a live indicator of the methodology's sequential capture flow.

Per statement node, the pill shows the **current step** — the first facet, in the canonical `wording → classification → substance` order, that is not yet committed — as:

```
┌─────────────────────────┐
│ CLASSIFICATION: Fact     │   ← facet label + candidate VALUE (line 1)
│ Alice [✓]   Ben [ ]      │   ← one checkbox per debater (line 2)
└─────────────────────────┘
```

- **Line 1** is the facet label, plus — for `classification` and `substance` — the candidate value being voted on (`CLASSIFICATION: Fact`, `SUBSTANCE: Holds`). The `wording` step shows just `WORDING` (the wording text is already the node body on the canvas, so there is no separate candidate value to repeat).
- **Line 2** is one checkbox per debater (the two debater slots, e.g. Alice / Ben): `[ ]` = has not voted yet, `[✓]` = agreed (positive), `[✗]` = disputed (negative).

The pill advances through the flow as commits land: it starts at `WORDING`, then becomes `CLASSIFICATION: <kind>` once wording commits, then `SUBSTANCE: <value>` once classification commits. When **all three facets are committed** the statement is fully settled and the step pill is replaced by a **compact settled summary** — a single chip with the two decided values and a check, e.g. `< Fact · Holds ✓ >`.

**The enabling change is a rendering-model shift: each node renders as ONE HTML component bound to its Cytoscape node via `cytoscape-node-html-label`, instead of a canvas label plus a stack of floating DOM overlays.** Today the wording is a Cytoscape canvas label and the per-facet pills, annotation badges, and axiom-mark badges are separate DOM-overlay siblings, each positioned per-frame off `renderedBoundingBox()` and hand-scaled by `scale(cy.zoom())` (the zoom-scaling work landed across the earlier overlay commits). That stack floats in the canvas gutter between cards — colliding with neighbours and edge labels on a dense graph — and costs a lot of bounding-box-sync + zoom-math machinery to keep aligned.

With the html-label plugin, the node IS a React component: the step pill (header), the wording (body), and the annotation badges (footer) compose **inside one element that sits exactly on the node box**, and the plugin owns the pan / zoom / position tracking — so the per-node `PerFacetPillOverlay`, `AnnotationOverlay`, and `AxiomMarkOverlay` (and their `--halo-zoom` / `scale(zoom)` plumbing) collapse into that component and are deleted. The result reads as one self-contained card — *step pill on top, statement in the middle, annotations at the bottom* — with nothing floating in the gutters, and the codebase loses three positioned-overlay files plus the manual zoom-scaling. The node still content-sizes via `computeNodeDimensions` (now sized to the composed HTML's bands, not just the wording), and the box grows to hold all three regions. This is an ADR-level change (it amends ADR 0004's "Cytoscape draws to canvas" posture for these surfaces); see Decision §0.

After this task:

- `packages/graph-view/src/projectGraph.ts` is extended: `AudienceNodeData` gains a per-facet detail record carrying, for each facet, its candidate value (the localized-at-render kind/substance/`null`-for-wording) and the per-debater vote state, plus the node's debater roster (name + role) so empty checkboxes render before anyone votes. The projector derives all of this from the event log it already walks, reusing `projectVotesByFacet`, the existing `currentClassificationByNode` cache, a new substance-candidate cache (most-recent `set-node-substance` value), and `deriveSlotOccupants`.
- A new graph-view-local component (e.g. `FacetStepPill.tsx`) renders the step-pill / settled-summary from that data. The current `<FacetPill>` import in `PerFacetPillOverlay.tsx` is dropped; the overlay maps each placement to one `<FacetStepPill>` instead of a row of three `<FacetPill>`.
- `PerFacetPillOverlay.tsx` keeps its placement/zoom/anchor machinery (the zoom-scaling `scale(zoom)` + bottom-center anchor, the rAF-batched commit, the subscription set) — only the per-placement child and the data it reads change.
- The catalogs gain `methodology.substance.agreed` / `.disputed` (`"Holds"` / `"Doesn't hold"`, mirroring the moderator's existing `setNodeSubstanceAction.valueButton.*`) so the shared package resolves substance labels through a methodology-namespaced key rather than a moderator-namespaced one. `methodology.facet.*` and `methodology.kind.*` already exist.
- Both the audience broadcast graph and the landing walkthrough render the new pill (same shared overlay).

Out of scope (deferred / unchanged):

- **Edges.** Nodes only, same as the predecessor. Edge facet detail stays out (the existing edge rollup paint is unchanged).
- **The shared `<FacetPill>`** and the moderator / participant / sidebar surfaces that consume it. They keep the per-status chip; this redesign is graph-view-only (audience + landing).
- **Interactivity.** The overlay stays `pointer-events: none` — no hover, no click, no drill-in. Read-only on both surfaces.
- **The moderator's own per-facet visualization** adopting this step-pill model — a possible follow-up, not in this task.

## Why it needs to be done

The predecessor's three-name-pill row was the right first cut (it surfaced per-facet structure vs. the single whole-card rollup), but in practice on the broadcast and landing canvases it reads as noise: every node shows the same three words, and the viewer learns nothing about *what value* is on the table or *who agrees*. The methodology's actual drama is the **sequential capture flow** — wording is settled, then a classification is proposed and voted, then a substance value is proposed and voted — and the **per-debater positions** at each step. That is exactly what a broadcast viewer (or a landing-page visitor watching the scripted walkthrough) needs to follow the debate, and it is precisely what the current pill hides.

All the data is already in the event log and already projected nearby:

- **Per-participant per-facet votes** — `projectVotesByFacet(events)` (`packages/shell/src/votes-by-facet/votes-by-facet.ts`) returns `Map<entityId, Map<FacetName, Vote[]>>` with `Vote = { participantId, choice: 'agree' | 'dispute' }`. Already used by the moderator's `ProposalFacetBreakdown`.
- **Candidate values** — classification is cached in `projectGraph`'s existing `currentClassificationByNode` map; substance is the most-recent `set-node-substance` proposal's `value` (`'agreed'`/`'disputed'` → `Holds`/`Doesn't hold`); wording is the node body itself (no separate chip value).
- **Debater names** — `deriveSlotOccupants(events)` maps `debater-A` / `debater-B` roles to `{ userId, screenName }`.

So the cost is a projection extension + a new render component, not new wire protocol or server work.

## Inputs / context

### ADRs

- [ADR 0004 — ReactFlow + Cytoscape](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md): the audience/landing graph is a Cytoscape canvas; per-node React lands as a DOM overlay (predecessor's seam, reused).
- [ADR 0021 — Event envelope](../../../docs/adr/0021-event-envelope-discriminated-union.md): the projector narrows the discriminated union; this task adds reads for `vote` (facet-keyed) and `set-node-substance` proposal payloads.
- [ADR 0024 — react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md): labels resolve through `t('methodology.facet.*')`, `t('methodology.kind.*')`, and the new `t('methodology.substance.*')`. Consumers (audience + root) already load the shared catalog.
- [ADR 0027 — entity / facet layers strict separation](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md): the step-pill is the facet-layer surfacing above the node; the node body (wording) + frame rollup stay the entity layer.
- [ADR 0030 — per-facet vote keying + sequential capture](../../../docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md): the sequential `wording → classification → substance` capture this pill visualizes; the `FacetStatus` enum (incl. `awaiting-proposal`) that drives "which step is current".
- [ADR 0039 — shared read-only graph-view package](../../../docs/adr/0039-shared-read-only-graph-view-package.md): the overlay + projector live in `@a-conversa/graph-view`, consumed by both `apps/audience` and `apps/root`; one edit serves both surfaces. Consumers must provide the methodology i18n keys.

### Data sources (all derivable from the event log)

- `packages/shell/src/votes-by-facet/votes-by-facet.ts` — `projectVotesByFacet(events): VotesByFacetIndex`. Per-(entity, facet) `Vote[]`.
- `packages/shell/src/facet-status/facet-status.ts` — `computeFacetStatuses(events): FacetStatusIndex`. The `FacetStatus` per (entity, facet); already consumed by the projector for `data.facetStatuses`.
- `packages/shell/src/slots/slots.ts` — `deriveSlotOccupants(events): SlotOccupants`. Role → `{ userId, screenName }` for the debater roster.
- `packages/graph-view/src/projectGraph.ts` — `currentClassificationByNode` (existing classification-candidate cache) + the `proposal` arm where a parallel `currentSubstanceByNode` cache (most-recent `set-node-substance` `value`) is added.
- `packages/shared-types/src/events/proposals.ts` — `StatementKind` (`fact` | `predictive` | `value` | `normative` | `definitional`); `set-node-substance` `value: 'agreed' | 'disputed'`.

### i18n

- `methodology.facet.{wording,classification,substance}` — exist (`"Wording"` / `"Classification"` / `"Substance"`).
- `methodology.kind.{fact,…}` — exist (`"Fact"`, …).
- `methodology.substance.{agreed,disputed}` — **NEW**, mirroring the moderator's `moderator.setNodeSubstanceAction.valueButton.{agreed,disputed}` (`"Holds"` / `"Doesn't hold"`). Added to en-US / pt-BR / es-419 (pt-BR/es-419 reuse the moderator catalog's existing translations).

### Live code the task touches / creates

- `docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md` — AMENDED (or a new ADR). Records the per-node-HTML rendering model for the read-only Cytoscape surfaces and the retirement of the per-node DOM overlays (Decision §0).
- `packages/graph-view/package.json` — MODIFIED. Adds `cytoscape-node-html-label` (and `@types/...` if no bundled types).
- `packages/graph-view/src/StatementNodeHtml.tsx` (name TBD) — **NEW**. The per-node React/HTML component: header step pill, wording body, annotation + axiom-mark footer, composed inside the node box. Registered with the html-label plugin in `GraphView`.
- `packages/graph-view/src/StatementNodeHtml.test.tsx` — **NEW**. Render cases (current-step selection, candidate value, per-debater checkboxes, settled summary, annotation/axiom footer, empty states).
- `packages/graph-view/src/GraphView.tsx` — MODIFIED. Register `cytoscape-node-html-label` at mount; configure it to render the per-node component bound to each node; drop the wording from the Cytoscape canvas label (node becomes the HTML element's frame). Remove the per-node overlay mounts from the return JSX.
- `packages/graph-view/src/projectGraph.ts` — MODIFIED. `AudienceNodeData` widened with the per-facet detail record + debater roster (and whatever the HTML node component needs); the `node-created` / `proposal` / `commit` / `vote` arms populate it.
- `packages/graph-view/src/projectGraph.test.ts` — MODIFIED. New cases pin the emitted per-facet detail (candidate value, per-debater votes, roster).
- `packages/graph-view/src/nodeDimensions.ts` — MODIFIED. Size the node to the composed HTML's bands (pill + wording + footer), not the wording alone.
- `packages/graph-view/src/PerFacetPillOverlay.tsx` + `.test.tsx`, `packages/graph-view/src/AnnotationOverlay.tsx` + `.test.tsx`, `packages/graph-view/src/AxiomMarkOverlay.tsx` + `.test.tsx` — **DELETED**. Their content folds into the per-node HTML component; their positioning / zoom-scaling machinery is no longer needed.
- `packages/graph-view/src/stylesheet.ts` — MODIFIED. The node selector loses its `data(wording)` label + text styling (the HTML component carries the wording); it keeps the box frame / border-per-status paint (or that too moves to CSS — settle in implementation).
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — MODIFIED. Add `methodology.substance.*`.
- `packages/i18n-catalogs/src/methodology.test.ts` — MODIFIED. Pin the new keys across locales.
- The audience's overlay-animation CSS (`apps/audience/src/index.css` → the package's `overlays.css`) — REVISITED. The transient halo animations may stay as overlays or move to per-node CSS (Open questions); the per-node *static* decoration CSS folds into the node component.

### What the task MUST NOT do

- No edit to `packages/shell/src/facet-pill/**` (the shared `<FacetPill>` and `PILL_STATUS_CLASSNAME`). Moderator / participant / sidebar are unaffected.
- No edge facet detail (nodes only). Edge labels stay Cytoscape-canvas-rendered.
- No interactivity — the per-node HTML stays `pointer-events: none` (or click-through) so the read-only posture and the canvas pan/zoom are preserved.
- No server / wire-protocol / methodology-engine change — read-only projection over the existing event log.
- No switch of the *interactive moderator* surface off ReactFlow — the html-label model applies only to the read-only graph-view surfaces (audience + landing + replay).

## Constraints / requirements

- **The pill is one element per node**, not three. The overlay's placement loop emits exactly one `<FacetStepPill>` per node that has a non-empty per-facet record (same omission rule as today for nodes with no facets).
- **Current-step selection** is a pure function of the node's `FacetStatus` record: the first facet in `['wording','classification','substance']` whose status is NOT a closed/settled status (`committed` / `withdrawn` / `meta-disagreement`). If all three are settled, render the **compact settled summary** instead.
- **Candidate value** is shown for `classification` (the kind label) and `substance` (the substance label); `wording` shows the label alone. If the current facet has no candidate yet (`awaiting-proposal`), show the facet label + empty checkboxes (the "what's next" affordance), no value.
- **Debater checkboxes**: always render both debater slots present in the roster (so `[ ] [ ]` shows before any vote), in a stable order (role: `debater-A` then `debater-B`). Each box reflects that debater's vote on the current facet: empty / `✓` (agree) / `✗` (dispute). The screen name precedes the box.
- **Settled summary**: a single chip combining the committed classification value and substance value with a check (e.g. `Fact · Holds ✓`). (Wording has no value, so it is implied by the node body.)
- **Cross-surface**: the change is entirely inside `@a-conversa/graph-view`; rebuilding both apps picks it up. No per-app code.
- **Zoom + anchor behavior** (the `scale(zoom)` about the bottom-center anchor and the per-zoom offset) is preserved — the new pill is taller (two lines) but anchors and scales the same way.
- **Determinism / purity**: the projection extension stays a pure function of the event array (the audience/landing projector contract); `FacetStepPill` is a pure render of its props. Vitest pins both without a live Cytoscape mount where possible.

## Acceptance criteria

- The graph-view overlay renders **one** step-pill per statement node (not three name pills); a node with no facets renders none.
- The pill shows the correct current facet + candidate value + per-debater checkboxes for a representative event log, advancing on commit (`WORDING` → `CLASSIFICATION: <kind>` → `SUBSTANCE: <value>`), and the compact settled summary once all three commit. Pinned by Vitest over `projectGraph` (the emitted data) + `FacetStepPill` (the render).
- The two debaters always appear (empty boxes before voting); `✓`/`✗` reflect agree/dispute from `projectVotesByFacet`.
- Both `apps/audience` and `apps/root` build and render the new pill (shared package) — no per-app edit needed.
- `methodology.substance.{agreed,disputed}` exist in all three locales and are pinned in `methodology.test.ts`.
- The shared `<FacetPill>` and the moderator/participant/sidebar suites are untouched and green.
- `pnpm run build` clean; `pnpm run test:smoke` green; lint/format clean; `tj3 project.tjp` parse clean (the `complete 100` ritual + `.tji` marker land at task close).
- Per ADR 0022, no throwaway scripts — Vitest pins the projection and the render; Playwright pixel coverage routes to the existing audience/landing visual-regression destinations.

## Decisions

### §0 — Render per-node content as HTML via `cytoscape-node-html-label` (NOT canvas-label + floating overlays, NOT a switch to ReactFlow) (R: chosen)

Three ways to land rich per-node content (step pill + wording + annotations) "inside the box":

- **(A — chosen)** Add the `cytoscape-node-html-label` plugin. Each node binds one HTML element, composed as a React component (header pill / wording body / annotation footer), positioned and zoom-tracked by the plugin. The wording moves from a Cytoscape canvas label to HTML (CSS typography + wrapping, a rendering *improvement*). The per-node DOM overlays (`PerFacetPillOverlay`, `AnnotationOverlay`, `AxiomMarkOverlay`) and the hand-rolled `renderedBoundingBox()` anchoring + `scale(cy.zoom())` / `--halo-zoom` machinery collapse into the node component and are **deleted** — the plugin owns positioning. Cost: one new dependency and an ADR amendment.
- **(B)** Keep Cytoscape canvas nodes + DOM overlays, but anchor the overlays to reserved bands *inside* the node box. Achieves the visual without a dependency, but keeps (and complicates) all the bounding-box-sync + zoom-scaling code, and the content is still a positioned sibling, not part of a node component. Rejected — incremental but leaves the architecture that makes rich per-node content painful in place.
- **(C)** Switch the read-only surfaces to ReactFlow (native per-node React components, like the moderator). Cleanest component model, but directly contradicts ADR 0004's reason for Cytoscape on the broadcast / replay / landing surfaces (perf at node count, OBS compositing). Rejected — largest migration, undoes a deliberate ADR.

The earlier rejections of the plugin (`aud_per_facet_visualization` Decision §1 alt B; `participant.part_per_facet_state_styling` Decision §6) were made when there was ONE overlay feature and a detail-panel fallback. The calculus has flipped: there are now ~8 overlays and a rich step pill, no detail panel on these surfaces, and the manual zoom-scaling is a recurring maintenance cost (it drove several of the recent overlay commits). Consolidating to per-node HTML is now the simplifying move, not the speculative one.

**This change is recorded as an amendment to [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md)** (the 2026-06-06 Amendment). The library split (ReactFlow / Cytoscape) is unchanged, so an amendment — not a superseding ADR — is the right vehicle; it records that the read-only Cytoscape surfaces render per-node content as HTML via `cytoscape-node-html-label`, retiring the per-node DOM overlays, and flags the per-node-HTML PERFORMANCE validation as the gate before the migration lands (with overlays-anchored-inside as the documented fallback). The transient ANIMATION halos (`node-appear`, `withdrawal`, `decomposition`, `diagnostic-fire`) are a separate question (see Open questions) — they may stay as overlays or move to CSS on the node element.

Decisions §1–§9 below describe the step-pill content that this component renders; they are unchanged by §0 except that the component is now the per-node HTML element rather than a free-floating overlay child.

### §1 — Replace the three name-pills with a single content-rich step-pill (rendered in the per-node HTML component, §0)

The predecessor's three-pill row restates static facet names and carries no candidate/vote signal — low value on a read-only canvas. A single pill showing the *current step* + its candidate value + per-debater positions is the high-signal surface a broadcast viewer / landing visitor actually needs. The new pill diverges enough from the shared chip (two lines, candidate value, per-participant checkboxes, settled-summary mode) that it is a **new graph-view-local component**, not a variant of `<FacetPill>` — the shared chip stays the moderator/participant vocabulary, byte-unchanged.

### §2 — Current step = first non-settled facet in `wording → classification → substance`

The methodology captures facets sequentially; the pill mirrors that. The "current step" is the first facet in canonical order whose status is not closed (`committed` / `withdrawn` / `meta-disagreement`). This reuses the predecessor's reading order (its Decision §3) and the `FacetStatus` enum. When all three are closed, the node is settled (Decision §6).

### §3 — Per-participant checkmarks are the **two debaters only** (R: chosen)

Show `debater-A` and `debater-B` (both always listed, boxes fill as they vote); the moderator facilitates rather than votes on facets, matching the methodology's debater-vote model and the worked `Alice / Ben` example. The roster comes from `deriveSlotOccupants`; both slots render even before any vote so the "awaiting" state is visible. *(If a future need surfaces moderator votes, the roster is the single extension point.)*

### §4 — Candidate value: kind label for classification, substance label for substance, none for wording

`classification` → `t('methodology.kind.<kind>')` (`Fact`, …) from the current classification candidate. `substance` → `t('methodology.substance.<value>')` (`Holds` / `Doesn't hold`) from the most-recent `set-node-substance` value. `wording` → label only (the wording text is the node body; repeating it in the pill is redundant). No candidate yet (`awaiting-proposal`) → label + empty boxes.

### §5 — Vote glyphs: empty `[ ]` / positive `✓` / negative `✗`

Matches the worked example's `[ ]` notation. `[ ]` = no vote yet, `✓` = `agree`, `✗` = `dispute`. (Exact glyph rendering — bracketed box vs. styled checkbox, color coding — is a render detail to settle in implementation; the semantics are fixed here.)

### §6 — Settled state: compact summary (R: chosen)

Once all three facets are committed, replace the step pill with a one-line summary of the decided values + a check, e.g. `Fact · Holds ✓`. Keeps the fully-settled node annotated with its outcome without holding a now-static voting row. (Wording carries no value, so it is implied by the node body and omitted from the summary.)

### §7 — Extend the projection; derive everything from the event log (no wire/server change)

`AudienceNodeData` gains a per-facet detail record (`{ candidateValue, votes: Array<{ role, screenName, choice }> }` per facet) + the debater roster, populated in the projector's existing single-pass walk by composing `projectVotesByFacet`, the classification cache, a new substance cache, and `deriveSlotOccupants`. The projector stays a pure function of `events` (the audience/landing contract). No server, wire, or methodology-engine change.

### §8 — Ship in `@a-conversa/graph-view`; both audience and landing get it (R: confirmed)

The overlay + projector are shared (ADR 0039), so the redesign lands once and serves the audience broadcast and the landing walkthrough alike. No per-app code. The zoom-scaling / anchor / subscription machinery from the predecessor is preserved.

### §9 — Add methodology-namespaced substance labels rather than reuse the moderator key

The shared package should resolve substance values through `methodology.substance.*`, not a `moderator.*` key, to keep the dependency direction clean (graph-view does not reach into moderator i18n namespaces). Mirror the moderator catalog's existing `Holds` / `Doesn't hold` values across the three locales.

## Open questions

- **ADR scope (§0)**: RESOLVED — amended [ADR 0004](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) in place (2026-06-06 Amendment) rather than writing a fresh ADR: the library split is unchanged, so html-label is a rendering-technique refinement of the Cytoscape choice, not a reversal that would warrant superseding.
- **Transient animation halos under html-label**: the `node-appear` / `withdrawal` / `decomposition` / `diagnostic-fire` (node) halos are currently DOM overlays scaled by `--halo-zoom`. Under §0 they should become **CSS keyframes on the per-node HTML element** (no bounding-box sync needed — the element already tracks the node), which would also delete the `--halo-zoom` plumbing. The `diagnostic-fire` **edge** halo has no node element, so it stays a positioned overlay (or moves to an edge decoration). Confirm the halo migration plan as part of the ADR.
- **Performance (the original reason for canvas)**: html-label renders real DOM per node. ADR 0004 chose Cytoscape-canvas partly for node-count performance + OBS compositing. Validate that per-node HTML holds up at the audience's expected node counts and at the OBS 1080p baseline before committing the migration — if it regresses, fall back to Decision §0 option (B) (overlays anchored inside the box). This is the main risk the ADR must weigh.
- **Node frame / border-per-status**: keep the box frame + per-`rollupStatus` border as a Cytoscape `node` selector (HTML composited on top), or move the frame into the HTML component's CSS (`border` per status) and make the Cytoscape node transparent? Affects how much of `stylesheet.ts` survives. Settle in implementation.
- **Glyph + color treatment** (§5): bracket-box vs. filled checkbox, and whether `✓`/`✗` are color-coded (green/rose) for broadcast legibility, or monochrome for the read-as-one-show palette. Settle against the audience palette; semantics are fixed.
- **`meta-disagreement` mid-flow**: a facet can be in `meta-disagreement` (a closed status) without a "value". Treat it as settled-with-no-value for the settled summary, or surface a distinct marker? Default: treat as settled, show the facet's escalation marker in the summary (e.g. `Fact · ⚠`); revisit if the walkthrough exercises it.
- **Edge statements** remain out of scope; if broadcast feedback wants edge substance/shape on the step pill, that is a follow-up (`per_facet_step_pill_edges`).
