# 0003 — Frontend framework: React

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four distinct browser surfaces — moderator, debater tablet, audience/broadcast, replay/test — all sharing a single TypeScript codebase per [docs/architecture.md — frontend surfaces](../architecture.md#frontend-surfaces). The framework picked here is the substrate for every UI workspace and constrains the next round of decisions: `graph_lib_decision`, `style_tooling_decision`, the frontend test-framework picks, and every UI task downstream.

The architectural facts that constrain the choice:

- **One framework, four surfaces.** A shared TS codebase across moderator, debaters, audience, and replay rules out picking a different framework per surface.
- **Real-time, event-driven.** State updates stream over WebSockets; rendering must stay efficient under frequent updates.
- **Audience surface is an OBS browser source.** Bundle size matters there more than on the operator-facing surfaces.
- **Graph rendering is the next decision.** Cytoscape.js (audience) and ReactFlow (moderator) are the two leading candidates; ReactFlow is React-native and unusable from a non-React framework.
- **Open-source ethos.** Pick a framework with a broad contributor pool so outside contributors can be productive quickly.

The candidates surveyed were React, Svelte, and Solid. All three meet the hard constraints (TypeScript-first, reactive, Playwright-friendly, mature component-test tooling).

## Decision

The frontend framework is **React**.

Build tooling, styling system, and test framework are deliberately deferred to their own foundation tasks (`repo_skeleton.*`, `style_tooling_decision`, `test_unit_framework_decision`) — this ADR settles only the framework choice.

## Consequences

- **Widest contributor pool.** React is the most broadly known of the three; an outside contributor cloning the repo is most likely to be productive immediately.
- **ReactFlow stays on the table.** The moderator surface can use ReactFlow directly without an interop shim. `graph_lib_decision` is now free to pick Cytoscape, ReactFlow, or both, instead of being forced away from ReactFlow by the framework choice.
- **Largest ecosystem.** Component libraries, testing tools (React Testing Library, Playwright component testing), and integration recipes (WebSocket hooks, OIDC clients) are all well-trodden ground.
- **Bundle size is an accepted tradeoff.** React is heavier than Svelte or Solid. For the audience surface (the bundle-sensitive one), this is mitigated downstream by the chosen build tooling (code splitting, tree shaking, production minification) — not by the framework choice.
- **Reactivity discipline is an accepted tradeoff.** React's re-render model is coarser than Svelte's or Solid's signal-based reactivity. Streaming event updates will require care (memoization, stable references, structural sharing) to stay efficient under high event rates. Acceptable; this is well-understood territory with established patterns.
- **Downstream tasks now constrained to the React ecosystem**: `style_tooling_decision` picks among React-compatible styling approaches; `test_unit_framework_decision` picks a React-aware component test runner; `repo_skeleton.*` configures a React-aware bundler; UI tasks across moderator-ui, participant-ui, audience, and replay-test all build against React.

## Stack-validation smoke test

A minimal React component and server-side render check live at [`scripts/hello-react.tsx`](../../scripts/hello-react.tsx). It uses `react-dom/server`'s `renderToString` to mount `<Hello />` and print the resulting HTML. The file is throwaway and will be removed when the real frontend workspace lands as part of the repo-skeleton work.

Run with:

```sh
pnpm install   # one-time
pnpm run smoke:react
```

Expected output: `<p>hello, react</p>`.

## Amendments

- **2026-05-10** — Replaced the original transient `npx --yes ... tsx` + `NODE_PATH` invocation with a project-local `package.json` + `npm install` setup. `react`, `react-dom`, `tsx`, and their types now live under `devDependencies`; the smoke test is invoked via `npm run smoke:react`. The decision (React) is unchanged.
- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run commands above are now `pnpm install` / `pnpm run smoke:react`. The decision (React) is unchanged.
