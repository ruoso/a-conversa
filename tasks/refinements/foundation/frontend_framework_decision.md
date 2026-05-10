# Pick frontend framework

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.frontend_framework_decision`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions.lang_decision` (settled — TypeScript on Node)

## What this task is

Pick the frontend framework for the moderator UI, participant tablet UI, audience surface, replay viewer, and test mode. All four web surfaces share a TypeScript codebase.

## Why it needs to be done

The framework choice gates `graph_lib_decision`, `style_tooling_decision`, all `repo_skeleton.*` configs that involve frontend builds, the `test_unit_framework_decision` for the frontend, and every UI task in moderator-ui, participant-ui, audience, and replay-test.

## Inputs / context

From [docs/architecture.md — open architectural questions](../../../docs/architecture.md#open-architectural-questions):

> Frontend framework. React, Svelte, Solid — pick during prototyping. Must play well with the chosen graph-rendering library.

From [docs/architecture.md — frontend surfaces](../../../docs/architecture.md#frontend-surfaces):

> V1 ships four distinct surfaces, sharing a TypeScript codebase ...

Architectural facts that constrain:

- **All web surfaces share a TS codebase.** One framework, used everywhere.
- **Real-time event-driven** — frequent state updates streamed over WebSockets. Reactivity primitives matter.
- **Graph rendering library is the next decision** (`graph_lib_decision`) — the framework needs to pair cleanly with whatever's chosen there. Cytoscape.js (audience) and ReactFlow (moderator) are the leading candidates; ReactFlow is React-native.
- **Open-source ethos** — pick a framework with broad contributor familiarity.

## Constraints / requirements

- TypeScript-first (or first-class TypeScript support).
- Reactive — efficient updates as event streams land.
- Reasonable bundle size (audience surface is an OBS browser source; budget matters).
- Tooling for component testing (unit), behavior testing, and Playwright E2E.
- Good ergonomics for a small team.

## Acceptance criteria

- Framework chosen and recorded in the ADR log.
- A "hello, world" component runs in the chosen framework, served from the dev compose stack.
- Choice unblocks `graph_lib_decision`, `style_tooling_decision`, and the frontend test-framework picks.

## Open questions

- **Which framework?** Live candidates per architecture.md:
  - **React** — broadest ecosystem; ReactFlow (a candidate graph library) is React-native; widest contributor pool. Bigger bundle, more churn.
  - **Svelte / SvelteKit** — smaller bundles, less ceremony, reactive primitives that suit live event streams well. Smaller graph-library ecosystem; ReactFlow won't work — would need Cytoscape across all surfaces.
  - **Solid** — React-like but with fine-grained reactivity; small bundle. Smaller ecosystem still; same ReactFlow issue as Svelte.
  - **Awaiting input.**
- **Implication for graph library.** If React: keep both Cytoscape (audience) and ReactFlow (moderator) on the table. If Svelte or Solid: collapse to Cytoscape across all surfaces.
