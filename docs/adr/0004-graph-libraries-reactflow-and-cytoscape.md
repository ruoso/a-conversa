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
