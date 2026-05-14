# Moderator three-pane layout shell

**TaskJuggler entry**: `moderator_ui.mod_layout.mod_layout_shell` — [tasks/30-moderator-ui.tji](../../30-moderator-ui.tji)
**Effort estimate**: 1d
**Inherited dependencies**: `moderator_ui.mod_shell.*` (all settled — app skeleton, state, ws, auth, screen-name).

## What this task is

Land the three-pane scaffold for the moderator's `/sessions/:id/operate` route — the structural skeleton inside which `mod_graph_canvas_pane`, `mod_right_sidebar`, and `mod_bottom_strip_capture` will plug their real surfaces. The shell owns the geometry (where the three regions live, how they share the viewport, what bounds them) and the styling chain (Tailwind v4 wired into the Vite bundle, a single global stylesheet, the per-app entry CSS file). The three sibling tasks each replace a placeholder region with their real implementation; the shell itself stays styling-only and contains no business logic.

## Why it needs to be done

[docs/moderator-ui.md](../../../docs/moderator-ui.md) describes the moderator surface as biased toward graph visibility: a graph canvas taking the majority of the screen, a right sidebar of stacked sub-panes, and a bottom-strip capture pane. Every downstream moderator-UI task renders into one of those three regions. Until the regions exist as named slots with real layout, each downstream task would have to re-decide where to mount itself; the three siblings would race on geometry; the bundler would not be running Tailwind, so utility classes wouldn't compile. This task settles the geometry and the styling chain so the next three tasks can plug in without re-deciding.

It also discharges the carryover from `mod_app_skeleton`'s Status block: *"Tailwind + UI tokens wiring -> picked up by `mod_layout.mod_layout_shell` when the three-pane scaffolding lands."*

## Inputs / context

- [docs/moderator-ui.md — Layout (sketch)](../../../docs/moderator-ui.md#layout-sketch) — the three-pane description.
- [ADR 0005](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — Tailwind CSS is the styling system; `packages/ui-tokens` will feed both Tailwind and Cytoscape. The tokens package itself is still deferred (no `packages/ui-tokens` directory yet); the shell wires Tailwind v4 with an empty/inline theme so downstream tasks can fold tokens in when that package lands.
- [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md) — every verification of layout behavior lands as a committed Vitest test.
- `apps/moderator/src/routes/Operate.tsx` — current stub the layout replaces.
- `apps/moderator/src/stores/uiStore.ts` — already exposes `SidebarPane = 'pending-proposals' | 'change-history' | 'diagnostic-flags'`; the right sidebar slot is structured around that enum.
- `apps/moderator/src/stores/captureStore.ts` — `CaptureMode` enum; the bottom-strip slot will key its mode-banner copy off this once `mod_mode_banner` lands.

## Constraints / requirements

- **Three named regions.** A `<OperateLayout>` component renders three regions with stable `data-testid` selectors so downstream tasks can target them and tests can locate them: `operate-layout-root`, `operate-graph-pane`, `operate-right-sidebar`, `operate-bottom-strip`.
- **Geometry from `docs/moderator-ui.md`.** Graph canvas takes the majority of the viewport; right sidebar is a fixed-width column to the right of the graph; bottom strip is a fixed-height row across the full width below both. The exact proportions are a placeholder (CSS Grid `1fr` / `20rem` for the columns; `1fr` / `6rem` for the rows) — tokens for these widths will land with `packages/ui-tokens` and the three sibling tasks can override.
- **CSS Grid, not Flexbox.** The three-region layout is exactly what Grid expresses cleanly (named template areas: `graph sidebar` on the top row, `strip strip` on the bottom). Flexbox would require nested containers and an extra wrapper for the bottom row; Grid keeps the shell flat and reads top-to-bottom.
- **Tailwind v4 wired into the Vite bundle.** Add `@tailwindcss/vite` to the moderator's bundler config; add a global stylesheet `src/index.css` that imports Tailwind; import that stylesheet from `main.tsx` so the bundle picks it up. Version pinned (no `^`) per the project convention.
- **Full-viewport.** The layout fills 100% of the viewport (`h-screen w-screen`) with no scrolling at the outer level — each pane scrolls internally when its content overflows. Body and html get `h-full m-0` so the React root sees the real viewport height.
- **Empty placeholder regions** for the three child slots — each renders a single localized "coming soon" label (using the existing `chrome.hello` placeholder key; the per-region copy lands with each sibling task). No business logic; no store reads beyond what's already in `Operate.tsx` for backward compatibility with the existing AC from `mod_state_management`.
- **Backward compatibility with the existing `OperateRoute` tests.** `App.test.tsx` asserts `getByTestId('route-operate')` and `session-id`. The shell keeps both test ids (route-operate becomes the layout root's testid moves to `operate-layout-root`; `route-operate` stays as the outer `<main>` wrapper). The `chrome.hello` paragraph, `capture-mode`, `selected-entity`, and `active-sidebar-pane` paragraphs from the prior stub continue to render (inside the graph pane as a temporary placeholder) so the prior store-subscription AC remains satisfied until `mod_graph_canvas_pane` replaces them.

## Acceptance criteria

- `<OperateLayout>` component under `apps/moderator/src/layout/OperateLayout.tsx` renders the three regions with the four stable `data-testid` IDs.
- `OperateRoute` uses `<OperateLayout>` and renders the existing store-subscription content inside the graph pane placeholder.
- `@tailwindcss/vite@4.3.0` pinned in `apps/moderator/package.json`; `src/index.css` imports Tailwind; `main.tsx` imports the CSS file.
- A Tailwind utility class (`bg-slate-50`, `grid`, `h-screen`) compiles into the bundle — verified by a committed test (ADR 0022) that asserts the rendered layout has the expected `data-testid` regions and Tailwind class names on each region.
- `pnpm run check`, `pnpm run test:smoke`, and `pnpm -F @a-conversa/moderator build` all green.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

## Decisions

- **Layout primitive: CSS Grid** — see Constraints. Two rows (graph+sidebar / bottom-strip), two columns on the top row (graph / sidebar). Expressed with `grid-template-areas`.
- **Region IDs**: `operate-layout-root`, `operate-graph-pane`, `operate-right-sidebar`, `operate-bottom-strip`.
- **Tailwind wiring**: `@tailwindcss/vite` plugin + a single `src/index.css` import in `main.tsx`. No `@tailwindcss/postcss` (we are on Vite, not a generic PostCSS pipeline).
- **No tokens yet.** `packages/ui-tokens` is still deferred per ADR 0005's Consequences ("Workspace realization deferred"). Sizes (`20rem` sidebar width, `6rem` strip height) are inlined as Tailwind arbitrary values; the three sibling tasks (or the eventual tokens package) can swap them.
- **No store wiring in the layout itself.** The shell is structure-only. The placeholder content in the graph pane keeps reading the three stores so the `mod_state_management` AC stays satisfied transitively; that placeholder block is the first thing `mod_graph_canvas_pane` deletes.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-11.

- New `apps/moderator/src/layout/OperateLayout.tsx` — a CSS Grid scaffold with three named regions and stable `data-testid` selectors (`operate-layout-root`, `operate-graph-pane`, `operate-right-sidebar`, `operate-bottom-strip`). Renders children into each slot via three optional props (`graphPane`, `rightSidebar`, `bottomStrip`); each pane wraps its child in `overflow-auto` so the outer layout never scrolls.
- New `apps/moderator/src/layout/OperateLayout.test.tsx` — committed Vitest cases (ADR 0022) covering: (a) the four region test ids render, (b) each child render-prop lands in its labelled region, (c) the layout root carries the Tailwind grid utility classes (`grid`, `h-screen`, `w-screen`), (d) per-region content is reachable inside its labelled pane.
- `apps/moderator/src/routes/Operate.tsx` now composes `<OperateLayout>` and hands the existing store-subscription stub to the graph pane (`capture-mode`, `selected-entity`, `active-sidebar-pane`, `i18n-hello`, `session-id`, `route-title` test ids preserved so the prior `App.test.tsx` cases and the `mod_state_management` AC remain satisfied).
- New `apps/moderator/src/index.css` — `@import "tailwindcss";` plus a `html, body, #root { height: 100%; margin: 0; }` reset so the grid can claim full viewport height.
- `apps/moderator/src/main.tsx` — added `import './index.css';` at the top of the entry so Vite's `@tailwindcss/vite` plugin picks up the import and emits the compiled stylesheet.
- `apps/moderator/vite.config.ts` — added the `@tailwindcss/vite` plugin alongside `@vitejs/plugin-react`.
- `apps/moderator/package.json` — pinned `@tailwindcss/vite@4.3.0` and `tailwindcss@4.3.0` (workspace-local; matches the root devDependency version).
- Smoke tests: added 6 new Vitest cases under `apps/moderator/src/layout/OperateLayout.test.tsx`; baseline 1501 → 1507. `pnpm run test:smoke` green. `pnpm -F @a-conversa/moderator build` produces the bundled CSS containing the expected Tailwind utilities. `pnpm run check` clean. `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent.

Downstream consumers (`mod_graph_canvas_pane`, `mod_right_sidebar`, `mod_bottom_strip_capture`) replace the three placeholder children with their real implementations by passing a different child element into the matching render-prop slot — no shell changes required.
