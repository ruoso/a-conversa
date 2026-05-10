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

## Open questions

- **Which approach?**
  - **Tailwind CSS** — fastest DX once the team is fluent; great IDE support; slim runtime; lots of config flexibility for design tokens. Heavier ramp if not familiar with utility-first.
  - **CSS Modules** — simplest mental model; no new conventions to learn beyond plain CSS; tokens flow as CSS variables. Less expressive than Tailwind for compositional design systems.
  - **Vanilla Extract** — strongest typing; smaller community.
  - **My instinct: Tailwind CSS.** Best fit for a small team building four similar but slightly different surfaces — the utility-first approach makes consistent typography/spacing/state-styling cheap. Design tokens flow through `tailwind.config.ts` and a shared package. **Awaiting input.**
- **Where do design tokens live?**
  - **`packages/ui-tokens`** — a dedicated workspace shared across frontend apps.
  - Inside `packages/shared-types` — co-located with shared TS types.
  - **My instinct: dedicated `packages/ui-tokens`.** Tokens are not types and the conceptual separation is cleaner. **Awaiting input.**
