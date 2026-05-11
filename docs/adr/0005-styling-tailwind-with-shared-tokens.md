# 0005 — Styling: Tailwind CSS with shared design tokens

- **Date**: 2026-05-10
- **Status**: Accepted

## Context

`a-conversa` ships four browser surfaces — moderator, participant tablet, audience/broadcast, replay/test — each with its own interaction profile but a shared visual language for statement classification, per-facet vote states, and edge roles (see [docs/architecture.md — frontend surfaces](../architecture.md#frontend-surfaces) and the refinement at [tasks/refinements/foundation/style_tooling_decision.md](../../tasks/refinements/foundation/style_tooling_decision.md)). [ADR 0003](./0003-frontend-framework-react.md) settled React as the framework; [ADR 0004](./0004-graph-libraries-reactflow-and-cytoscape.md) settled ReactFlow + Cytoscape.js for the graph layer and noted explicitly that two styling languages must be kept in sync via shared design tokens.

The candidates surveyed:

- **Tailwind CSS** — utility-first; build-time CSS generation; theme is data, which is exactly the shape needed to feed both Tailwind and Cytoscape style strings from one source.
- **CSS Modules** — vanilla CSS scoped per file; zero runtime; no native token system, so every workspace would re-import a tokens module by hand.
- **Vanilla Extract** — type-safe CSS-in-TS at build time; smaller community; tokens are first-class but the ecosystem around Tailwind (editor tooling, examples, contributor familiarity) is stronger.
- **CSS-in-JS (styled-components, Emotion)** — runtime cost on every surface, including the bundle-sensitive audience view; React Server Component friction; falling out of favor.

The constraints from the project rule the choice. Four surfaces sharing a visual language want a tokens-as-data substrate. Cytoscape.js takes its styling as a JS-side selector-and-property language — it cannot consume CSS classes, so whatever token format the React surfaces use must also be readable as plain JS values. The audience surface is an OBS browser source, so build-time CSS generation is preferable to a runtime style engine.

Utility-first is also a good fit for the data shape this app renders: per-facet state visuals (proposed dashed/faded, agreed solid, disputed marker, meta-disagreement split) compose naturally as small sets of classes selected by state, rather than as bespoke CSS rules per component. State changes are class swaps; the design-system vocabulary lives in the tokens package, not scattered across component stylesheets.

## Decision

The frontend uses **Tailwind CSS** as the styling system.

**Design tokens live in a dedicated package.** A `packages/ui-tokens` workspace exports tokens (colors, spacings, typography, per-facet state styles) as plain TypeScript data. Each frontend `apps/*` workspace consumes that package twice: once to feed Tailwind's theme (so React/ReactFlow surfaces get utility classes like `bg-facet-agreed`), and once as raw values fed into Cytoscape style strings on the audience / participant / replay surfaces (per ADR 0004). One source of truth, two consumers.

The realization of this in the repo — creating `packages/ui-tokens` and wiring it into per-app Tailwind configs — waits on `repo_skeleton.dir_layout`, which owns the workspace structure. This ADR settles only the styling approach and the token-distribution shape.

## Consequences

- **One visual language across four surfaces.** Tokens flow from one package into both Tailwind and Cytoscape, so a per-facet color change happens in one file and propagates everywhere.
- **Build-time CSS, near-zero runtime.** The audience surface (the bundle-sensitive one) pays no runtime style cost. Generated CSS is static and tree-shakable.
- **Utility-class verbosity.** Component JSX gets noisier than CSS Modules or Vanilla Extract. Accepted; the gain in cross-surface consistency and the editor tooling around Tailwind classes outweighs the line-noise cost.
- **Build-time dependency.** Every frontend workspace's bundler must run Tailwind's compiler over its content. `repo_skeleton.dir_layout` and the bundler choice will wire this in; the smoke test below proves the chain works in isolation.
- **Cytoscape gets tokens-as-data, not classes.** Cytoscape's styling API does not consume CSS classes, so the audience / participant / replay surfaces import token values directly and interpolate them into Cytoscape style strings. ReactFlow surfaces get the Tailwind classes. Both paths read from the same `packages/ui-tokens` source.
- **Workspace realization deferred.** The acceptance-criteria items "shared design-token module in `packages/ui-tokens`" and "first component renders correctly in each frontend workspace" cannot land until `repo_skeleton.dir_layout` creates the workspace structure. They are explicitly carried forward and will be marked done as part of the per-surface scaffolding tasks (`moderator_ui.*`, `participant_ui.*`, `audience.*`, `replay_test.*`).
- **Downstream tasks now constrained.** `repo_skeleton.dir_layout` must include `packages/ui-tokens`. Each frontend workspace's bundler config must run Tailwind. Future component-library or design-system tasks build on top of the tokens package, not parallel to it.

## Stack-validation smoke test

A minimal sketch at [`scripts/hello-tailwind.ts`](../../scripts/hello-tailwind.ts) proves the chain end-to-end without needing the workspace structure: a JS `tokens` object → Tailwind v4's `@theme` block → utility-class compilation → emitted CSS that contains the token value. Tailwind v4's `compile(css)` API takes the candidate utility classes directly, so no content-scanning or filesystem config is needed for the demo.

```sh
pnpm install   # one-time
pnpm run smoke:tailwind
```

Expected output includes `--color-facet-agreed: #1f7a3a;` on `:root`, a `.bg-facet-agreed` rule using `var(--color-facet-agreed)`, and a final `tailwind ok:` confirmation line. The token value (`#1f7a3a`) is checked literally in the emitted CSS so the test fails loudly if the token-to-CSS chain breaks. The sketch is throwaway and will be removed when the real `packages/ui-tokens` and per-app Tailwind configs land.

## Amendments

- **2026-05-10** — Switched the package manager from npm to pnpm as part of [ADR 0010](0010-directory-layout-pnpm-workspaces.md). Run command above is now `pnpm install` / `pnpm run smoke:tailwind`. The decision (Tailwind CSS) is unchanged.
- **2026-05-10** — The pattern of a shared `packages/ui-tokens` workspace feeding all four surfaces is now mirrored by `packages/i18n-catalogs` per [ADR 0024](0024-frontend-i18n-react-i18next-with-icu.md). Text-direction (RTL) is NOT in scope for v1 — `en-US`, `pt-BR`, `es-419` are all LTR — but Tailwind's `dir-*` utilities remain available if a future locale forces it. The decision (Tailwind + tokens) is unchanged.
