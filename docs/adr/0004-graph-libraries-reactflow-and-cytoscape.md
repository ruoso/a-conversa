# 0004 — Graph libraries: ReactFlow (moderator) and Cytoscape.js (read-only surfaces)

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four browser surfaces that all render the debate graph: moderator, participant tablet, audience/broadcast, and replay/test. Their interaction profiles diverge sharply, per [docs/architecture.md — graph rendering](../architecture.md#graph-rendering) and the refinement at [tasks/refinements/foundation/graph_lib_decision.md](../../tasks/refinements/foundation/graph_lib_decision.md):

- **Moderator** is direct-manipulation: drag to create edges, click to select, context menus, custom node components rendering per-facet vote indicators, real-time updates. The operator's productivity hinges on edge-drag ergonomics.
- **Participant tablet, audience/broadcast, and replay** are read-only. The participant tablet surfaces own-vote indicators per facet on top of an otherwise audience-shaped view; audience and replay share the same renderer (replay just drives it from the event log instead of the live stream). All three need clean typography for video, animation hooks for state transitions (proposed→agreed, decomposition, axiom-mark land), and OBS-friendly sizing for the broadcast.

ReactFlow is React-native, with first-class custom React components for nodes and the strongest drag-to-create-edge story among the candidates. Cytoscape.js is imperative-API but has the strongest layout algorithms, the cleanest animation hooks, and renders crisply at broadcast scale. Neither library serves both interaction profiles well: ReactFlow's read-only animation story is weaker than Cytoscape's, and Cytoscape's interactive-edit ergonomics are weaker than ReactFlow's.

## Decision

Use **two graph libraries**:

- **ReactFlow** for the **moderator UI**.
- **Cytoscape.js** for the **participant tablet**, **audience/broadcast**, and **replay/test** surfaces.

Design tokens live in a shared package (`packages/ui-tokens`, scoped by a downstream task) and feed both libraries — CSS custom properties for ReactFlow, parameterized Cytoscape style strings for the read-only surfaces — so the visual language stays unified across the divergence.

## Consequences

- **Each surface gets the right tool.** The moderator's interactive editor uses the library built for it; the read-only surfaces share a renderer optimized for animations and broadcast-quality output.
- **Two styling languages.** ReactFlow styling is CSS / React-component-driven; Cytoscape styling is its own selector-and-property language. Both must be kept in sync with shared design tokens.
- **Two animation systems.** ReactFlow leans on CSS transitions and React state; Cytoscape uses its own animation API. State-transition visuals (proposed→agreed, decomposition, axiom-mark land) are authored twice — once for the moderator, once for the read-only surfaces.
- **Read-only surfaces share one renderer.** Participant tablet, audience, and replay all build on Cytoscape, so visual fixes propagate across three of the four surfaces from one place.
- **Two bundles to track.** The moderator workspace pulls ReactFlow; the read-only workspaces pull Cytoscape. The audience surface (the bundle-sensitive one, OBS browser source) is unaffected by ReactFlow's weight.
- **Accepted cost.** The duplication is the explicit price of letting each surface use the library that fits it — settled in refinement R14 and reaffirmed here.

## Stack-validation smoke tests

Two minimal sketches prove each library renders "N1, N2 with a supports edge":

- [`scripts/hello-reactflow.tsx`](../../scripts/hello-reactflow.tsx) — builds a ReactFlow tree with two nodes and one edge, server-renders via `react-dom/server`. ReactFlow defers most rendering until a DOM mount measures the viewport, so the SSR output is intentionally sparse; the goal is proving the import resolves and the React tree constructs.

  ```sh
  pnpm install   # one-time
  pnpm run smoke:reactflow
  ```

  Expected output: `reactflow ok: rendered <N> chars of markup`.

- [`scripts/hello-cytoscape.ts`](../../scripts/hello-cytoscape.ts) — constructs a headless `cytoscape({ ... })` instance with two nodes and one edge, logs the element count.

  ```sh
  pnpm run smoke:cytoscape
  ```

  Expected output: `cytoscape ok: 3 elements (2 nodes, 1 edges)`.

Both files are throwaway and will be removed when the real workspaces land as part of the repo-skeleton work.

## Amendments

- **2026-05-10** — Replaced the original transient `npx --yes ... tsx` + `NODE_PATH` invocations with a project-local `package.json` + `npm install` setup. `reactflow`, `cytoscape`, and their peer deps now live under `devDependencies`; both smoke tests are invoked via `npm run smoke:*`. The decision (ReactFlow + Cytoscape.js) is unchanged.
- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run commands above are now `pnpm install` / `pnpm run smoke:*`. The decision (ReactFlow + Cytoscape.js) is unchanged.
- **2026-05-15** — [ADR 0025](0025-graph-layout-engine-dagre.md) pins `@dagrejs/dagre` as the moderator surface's auto-layout engine; ReactFlow does not ship a layout pass and the moderator surface needed one. Cytoscape's bundled layouts remain reserved for the read-only surfaces (audience / participant tablet / replay) — the split surface profile from this ADR is unchanged. The moderator workspace now carries one additional runtime dependency (`@dagrejs/dagre`); the read-only surfaces' Cytoscape bundling is unaffected.
- **2026-06-03** — [ADR 0039](0039-shared-read-only-graph-view-package.md) realizes this ADR's "read-only surfaces share one renderer" promise as a real package boundary: the Cytoscape read-only renderer (projector + `GraphView` + layout + stylesheet + the eight DOM overlays) now lives in the `@a-conversa/graph-view` workspace package, consumed by both `apps/audience` (via a thin `AudienceGraphView` store adapter) and the M8-landing walkthrough demo. The library choice (Cytoscape.js for read-only surfaces, ReactFlow for the moderator) is unchanged; only Cytoscape-bundling surfaces depend on the new package, so the moderator/ReactFlow bundle still avoids Cytoscape.

- **2026-06-06** — **Read-only surfaces render per-node content as HTML (`cytoscape-node-html-label`), not as a canvas label plus a stack of floating DOM overlays.** The library split below was a sane choice and stands — Cytoscape.js remains the read-only renderer — but the rendering *technique* it implied produced a poor result, and that technique is hereby amended. Cytoscape draws nodes to a `<canvas>` with no per-node DOM, so every piece of per-node content beyond the wording (the per-facet pills, annotation badges, axiom-mark badges, and the state-transition halos) became a separate absolutely-positioned DOM overlay, each re-synced per frame off `renderedBoundingBox()` and hand-scaled by `scale(cy.zoom())`. Eight such overlays accreted; the bounding-box sync + zoom-scaling turned into a recurring maintenance cost (several commits chased pills and badges that ballooned or drifted as the viewport zoomed), and the content floated in the gutters between cards — visually detached from the statement it described — instead of sitting inside the node box.

  **Amended approach.** The read-only Cytoscape surfaces render each node's content as a single **HTML element bound to the node via the `cytoscape-node-html-label` plugin** (a new dependency on `@a-conversa/graph-view`). One React component per node composes the wording, the per-facet step pill, and the annotation / axiom-mark decorations *inside the node box*; the plugin owns pan / zoom / position tracking, so the per-node DOM overlays (`PerFacetPillOverlay`, `AnnotationOverlay`, `AxiomMarkOverlay`) and their `renderedBoundingBox()` anchoring + `scale(zoom)` / `--halo-zoom` machinery are retired. This refines only *how* per-node content is painted on the Cytoscape surfaces — the library choice (ReactFlow for the interactive moderator; Cytoscape.js for the read-only audience / participant / replay / landing surfaces) is **unchanged**, and the moderator (ReactFlow custom nodes, already HTML) is untouched. Earlier refinements rejected this plugin (`aud_per_facet_visualization` Decision §1 alt B; `participant.part_per_facet_state_styling` Decision §6) when there was a single overlay feature and a detail-panel fallback; with ~8 overlays, a rich step pill, and the zoom-scaling maintenance above, consolidating to per-node HTML is now the simplifying move.

  **Accepted cost / validation gate.** `cytoscape-node-html-label` renders real DOM per node, and this ADR chose Cytoscape-canvas partly for node-count performance and OBS 1080p compositing (Context above). The per-node-HTML approach must therefore be validated at the audience's expected node counts and the OBS baseline before the migration lands; if it regresses there, the documented fallback is to keep the overlays but anchor them inside the node box (no plugin). The migration, the performance gate, and the transient-halo handling (CSS-on-element vs. a retained edge-only overlay) are scoped by [`tasks/refinements/post_implementation_audits/per_facet_step_pill.md`](../../tasks/refinements/post_implementation_audits/per_facet_step_pill.md) (M8-audits). Per ADR 0039 the renderer is the shared `@a-conversa/graph-view` package, so this amendment serves the audience broadcast surface and the landing walkthrough from one change.
