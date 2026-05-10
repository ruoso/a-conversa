# Pick styling / CSS approach

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.stack_decisions.style_tooling_decision`
**Effort estimate**: 0.5d
**Inherited dependencies**: `foundation.stack_decisions.frontend_framework_decision` (settled — React)

## What this task is

Pick how CSS/styles are written in the React frontend. Affects the moderator UI, participant tablet UI, audience surface, and replay surfaces.

## Why it needs to be done

Every UI component will have styling. The approach affects bundle size, developer experience, naming conventions, and how design tokens (colors, fonts) flow.

## Inputs / context

Common React-ecosystem options:

- **Tailwind CSS** — utility-first; class names compose into styles; small runtime cost; widely adopted; great DX with editor support.
- **CSS Modules** — `*.module.css` files; classes scoped to components; vanilla CSS + a thin wrapper. Zero runtime; dirt-simple semantics.
- **Vanilla Extract** — type-safe CSS-in-TS at build time; zero runtime. Stronger types than CSS Modules; smaller community.
- **CSS-in-JS (styled-components / Emotion)** — runtime CSS-in-JS. Falling out of favor due to runtime cost and React Server Component friction.
- **Plain CSS / SCSS** — global stylesheets. Not great for component scoping in a multi-app monorepo.

Constraints from the project:

- Audience surface needs careful typography for video — full styling control matters.
- Participant tablet has touch targets sized for confident tapping during live debate — sizing tokens matter.
- Per-facet visual states (proposed dashed/faded, agreed solid, disputed marker, meta-disagreement split) need consistent rendering across surfaces — design-token-friendly approach helps.
- Open-source ethos — pick something with broad familiarity.

## Constraints / requirements

- Component-level scoping (no accidental cross-component bleed).
- Design tokens (colors, sizes, typography) shareable across the four frontend workspaces.
- Reasonable bundle size and runtime performance.
- TypeScript-friendly.
- Plays well with Cytoscape.js / ReactFlow styling (which use their own styling APIs internally).

## Acceptance criteria

- Approach chosen, recorded in the ADR log.
- A shared design-token module in `packages/shared-types` (or a sibling `packages/ui-tokens`) referenced from each frontend workspace.
- The first component renders correctly in each frontend workspace using the chosen approach.

## Decisions

- **Tailwind CSS** (R16). Utility-first, slim runtime, design tokens flow through `tailwind.config.ts`. Best fit for four similar-but-slightly-different surfaces with consistent typography / spacing / state-styling.
- **Design tokens live in a dedicated `packages/ui-tokens` workspace.** Tokens (colors, spacings, typography, per-facet state styles) export from this package; each frontend `apps/*` workspace imports its tokens via `tailwind.config.ts` and (where applicable) directly into Cytoscape style strings for the audience surface (R14 — Cytoscape uses its own styling API). Tokens-as-data flow naturally between the two graph libraries this way.

## Open questions

(none — all decided)

## Status

**Done** (2026-05-10) — settled in [docs/adr/0005-styling-tailwind-with-shared-tokens.md](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md), with stack-validation sketch at [scripts/hello-tailwind.ts](../../../scripts/hello-tailwind.ts) (run via `npm run smoke:tailwind`). The token-flow concept (`tokens` JS object → Tailwind `@theme` → emitted CSS) is proven inline.

The "shared `packages/ui-tokens` module referenced from each frontend workspace" and "first component renders in each frontend workspace" acceptance criteria are explicitly **deferred to `repo_skeleton.dir_layout`** (which owns workspace creation) and the per-surface scaffolding tasks under `moderator_ui.*`, `participant_ui.*`, `audience.*`, and `replay_test.*`. See the ADR's *Consequences* section for the carry-forward.
