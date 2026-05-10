# Pick graph rendering library

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.graph_lib_decision`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions.frontend_framework_decision` (settled — React)

## What this task is

Pick the graph-rendering library (or libraries) used across the four web surfaces — moderator, participant tablet, audience broadcast, replay viewer / test mode. Different surfaces have different needs; one library may serve all, or two may be required.

## Why it needs to be done

Every UI task that renders the debate graph depends on this. Per [docs/architecture.md — graph rendering](../../../docs/architecture.md#graph-rendering):

> Cytoscape.js for the audience view — strong layout algorithms, animation hooks, customizable styling for distinct facet/state rendering.
>
> ReactFlow likely for the moderator UI — better drag-to-create-edge ergonomics and direct-manipulation feel for the operator.
>
> One library if the cost of two is too high; revisit during prototyping.

## Inputs / context

Surfaces and their needs:

- **Moderator UI**: drag-to-create-edge, click-to-select, context menus, per-facet visualization within a single node, vote indicators on the graph, real-time updates as proposals come in. Direct manipulation matters.
- **Participant tablet**: read-only with own-vote indicators per facet; tap-to-detail; pinch/pan/touch interactions.
- **Audience / broadcast**: read-only, high-quality animations on commit (node appear, proposed→agreed transition, decomposition, withdrawal, axiom-mark land), clean typography for video, OBS-friendly sizing/transparency.
- **Replay / test mode**: same audience renderer but driven from event log instead of live stream; per-event scrubbing.

Library candidates:

- **Cytoscape.js** — mature, strong layout algorithms, animation hooks, programmatic styling. Not React-native (uses an imperative API), but `react-cytoscapejs` wraps it. Excellent for the audience surface (clean rendering, animations).
- **ReactFlow / xyflow** — React-native, edge-drag ergonomics, custom node components are React components. Excellent for the moderator's interactive editor.
- **D3** — maximum control, lots of code; not a "library" so much as a toolkit. Probably overkill.
- **vis-network**, **sigma.js** — niche, less active.

## Constraints / requirements

- Must support per-facet rendering within a single node (multiple states per node).
- Animation hooks for state transitions.
- Custom node components (so we can render axiom marks, vote indicators, etc.).
- Touch interaction support (for the participant tablet).
- Reasonable bundle size (audience surface is OBS browser source).
- Active maintenance, good docs, broad community.

## Acceptance criteria

- Library or libraries chosen.
- Rationale recorded in the ADR log.
- A "render N1, N2 with a supports edge" sketch works in each surface that uses the chosen library.

## Decisions

- **Two libraries** (R14):
  - **ReactFlow** for the **moderator UI** — drag-to-create-edge ergonomics, React-native custom-node components, direct-manipulation feel.
  - **Cytoscape.js** for **participant tablet + audience + replay**. Read-only surfaces share a renderer; participant tablet's visuals match the audience-broadcast renderer (which is what the format is "really" — the tablet shows the same thing the audience sees, plus per-facet vote indicators).
- The cost of two styling languages and two animation systems is accepted; the moderator's interactive needs are different enough from the read-only surfaces that a single library serves neither well.
- Design tokens (`packages/ui-tokens`) are shared across both libraries via stylesheet variables / Cytoscape style strings parameterized by tokens.

## Open questions

(none — all decided)
