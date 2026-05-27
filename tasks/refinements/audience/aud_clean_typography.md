# Clean typography for video legibility on the audience surface

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_graph_rendering.aud_clean_typography`
**Effort estimate**: 1d
**Inherited dependencies**:

- `!audience.aud_graph_rendering.aud_cytoscape_init` (settled — shipped 2026-05-27, `complete 100` at [`tasks/50-audience-and-broadcast.tji:90`](../../50-audience-and-broadcast.tji#L90). The viewport this leaf restyles: a one-shot `cytoscape({ ... })` mount inside `<div data-testid="audience-graph-root">` at [`apps/audience/src/graph/GraphView.tsx:127`](../../../apps/audience/src/graph/GraphView.tsx#L127). The module-scope `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:80-114`](../../../apps/audience/src/graph/GraphView.tsx#L80) is the seam this leaf extends — Decision §1 explicitly forwarded font / size / weight tuning to "sibling tasks (`aud_clean_typography`, `aud_proposed_styling`, …) that extend this stylesheet in their own commits.")
- Prose-only context (NOT a `.tji` edge): `frontend_i18n.i18n_audience_typography` shipped 2026-05-11 (refinement [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md), Status block). That task landed the **typography policy** as data — `BROADCAST_FONT_STACK`, `BROADCAST_PRIMARY_FONT`, `BROADCAST_FALLBACK_FONTS`, codepoint-coverage validators, and 23 Vitest cases pinning Latin Extended-A diacritic coverage at [`packages/i18n-catalogs/src/typography.ts`](../../../packages/i18n-catalogs/src/typography.ts) and [`packages/i18n-catalogs/src/typography.test.ts`](../../../packages/i18n-catalogs/src/typography.test.ts) — and **deferred the wiring** to this task. The Status block names three deferred halves: (a) wiring the font stack into the audience surface (Cytoscape stylesheet + page CSS), (b) bundle-size measurement (now feasible since `aud_app_skeleton` and `aud_cytoscape_init` shipped a real Vite bundle), (c) reference-image fixtures at 720p/1080p/1440p (further re-deferred to `aud_visual_regression` per Decision §6 below). This leaf owns (a); (b) and (c) re-defer per Decision §6.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` shipped 2026-05-27 ([`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md)) — pinned `SPACING_FACTOR = 1.45` and `PADDING = 60` plus node `width: 200` / `height: 80` / `text-max-width: 180px`. The fixed node bounding box constrains the size envelope typography can claim — Decision §3 explains how the chosen sizes fit inside.

## What this task is

The 1d leaf that turns the typography **policy data** (`BROADCAST_FONT_STACK` + the diacritic-coverage validators) shipped early by `i18n_audience_typography` into a **wired audience surface** — Inter (with system-stack fallback) renders both inside the Cytoscape canvas (node labels, edge labels) and outside it (the audience surface's HTML chrome — placeholder route, future per-session page, sign-in chrome). Sizes, weights, and contrast tuned for broadcast legibility at OBS canvas resolutions (1080p baseline, with 720p / 1440p in the budget).

After this leaf:

- A new `@font-face`-equivalent wiring in [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) imports Inter from Google Fonts (`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')`), registers `--font-broadcast` under Tailwind v4's `@theme` block as `BROADCAST_FONT_STACK`, and sets `html, body, #root { font-family: var(--font-broadcast); }`. The placeholder route's existing `text-2xl font-semibold` classes inherit Inter automatically; future per-session chrome (`aud_session_url`) does too.
- The module-scope `STYLESHEET` at [`apps/audience/src/graph/GraphView.tsx:80-114`](../../../apps/audience/src/graph/GraphView.tsx#L80) gains `'font-family': BROADCAST_FONT_STACK` on both `node` and `edge` selectors (Cytoscape canvases do NOT inherit CSS `font-family` from the page — Cytoscape paints text to canvas/SVG with its own measurement step, so the family must be set in the stylesheet too). Node `font-size` bumps from `12` → `14`; edge `font-size` bumps from `10` → `11`. Both selectors gain explicit `font-weight` (`600` semibold on nodes, `500` medium on edges) so a fallback face that defaults to a different default weight (Arial regular, Helvetica Neue Light) does not silently downgrade the broadcast emphasis.
- Three named constants — `BROADCAST_NODE_FONT_SIZE_PX = 14`, `BROADCAST_EDGE_FONT_SIZE_PX = 11`, `BROADCAST_NODE_FONT_WEIGHT = 600`, `BROADCAST_EDGE_FONT_WEIGHT = 500` — land as named exports from `GraphView.tsx` alongside the existing `STYLESHEET` export so future siblings (per-facet styling, axiom-mark decoration, annotation rendering) can key off the numeric values rather than rediscovering them. The Vitest cases pin both the constants and their incorporation into the stylesheet.
- `apps/audience/src/graph/GraphView.test.tsx` gains 6 new Vitest cases pinning the stylesheet's typography surface — `font-family` on node + edge selectors equals `BROADCAST_FONT_STACK`; `font-size` matches the named constants; `font-weight` matches the named constants. Existing 16 cases (12 from `aud_cytoscape_init` + 4 from `aud_layout_engine`) continue to pass.

Out of scope (deferred to existing or future leaves):

- **Per-facet styling, axiom-mark decoration, annotation overlays.** Owned by `aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, `aud_meta_disagreement_split`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`, `aud_per_facet_visualization`. Each task extends `STYLESHEET` with its own selectors; this leaf only owns the baseline typography fields (`font-family`, `font-size`, `font-weight`) — color and shape stay unchanged from the `aud_cytoscape_init` baseline.
- **Layout geometry (spacing, padding, root selection, auto-fit).** Owned by `aud_layout_engine` (shipped). Typography fits inside the existing node/edge geometry; this leaf does NOT revisit `SPACING_FACTOR` / `PADDING` / `width` / `height` / `text-max-width`.
- **Self-hosted Inter `.woff2` assets vs Google Fonts `@import`.** Decision §2 picks the Google Fonts `@import` path for the 1d budget. A future broadcast-polish task can swap to self-hosting if production OBS hosts demonstrate latency / availability issues against `fonts.googleapis.com`.
- **Reference-image fixtures at 720p / 1080p / 1440p.** Re-deferred from `i18n_audience_typography`'s Status block to `aud_visual_regression` (per Decision §6); the codepoint-coverage tests at `packages/i18n-catalogs/src/typography.test.ts` are the algorithmic regression pin, and the Vitest cases below pin the stylesheet's claimed values.
- **Bundle-size measurement (pre / post i18n + active-locale catalog).** Re-deferred from `i18n_audience_typography`'s Status block to a follow-up under `aud_visual_regression` or `aud_obs_render_smoke` — the audience surface bundles but the bundle-size impact of Inter is dominated by the lazy-loaded woff2 fetched by Google Fonts at runtime, not by the build artifact this leaf produces. A `@font-face`-self-host pass would change that math.
- **A Playwright spec exercising the audience typography.** Per the deferred-e2e exception (`ORCHESTRATOR.md` UI-stream e2e policy): the component this leaf restyles is still not reachable through any user-flow route — `apps/audience/src/App.tsx:124` still maps every path to the placeholder. Full deferral applies; Decision §6 places it on `aud_visual_regression`, not `aud_session_url`.
- **`packages/ui-tokens` re-export of `--font-broadcast`.** That workspace is still deferred per ADR 0005's "Workspace realization deferred" consequence. `typography.ts` in `@a-conversa/i18n-catalogs` remains the canonical source; when `packages/ui-tokens` materializes, the `--font-broadcast` Tailwind token migrates under `tokens.typography.broadcast.fontFamily` per the `typography.ts` module comment at lines 74-77.

## Why it needs to be done

The `m_audience_mvp` milestone in [`tasks/99-milestones.tji`](../../99-milestones.tji) names the entire `aud_graph_rendering` group transitively. The audience surface's reason to exist is broadcast-output to OBS, and the typography choice is one of two things (the other being layout — already settled by `aud_layout_engine`) that distinguishes a broadcast surface from a tablet surface. Without this leaf the audience renders in whatever default sans-serif the host browser picks — typically Roboto on Chrome / Linux, Helvetica Neue on Safari / macOS — at the participant's 12px / 10px sizes tuned for a hand-held tablet. On a 1080p broadcast canvas that produces visibly small, weight-inconsistent text that varies per producer machine, defeating both the "this is the show" framing and the codepoint-coverage work `i18n_audience_typography` already paid for.

Downstream concretely:

- **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259)) is the pixel-comparison testing task. Without a pinned font family, every visual-regression run would render against whatever fallback the test host has installed — Linux CI machines (no Inter installed) would produce different fixtures than the developer's macOS box. This leaf turning Inter into the on-the-wire fallback chain primary IS the prerequisite for stable cross-host visual comparison.
- **`aud_proposed_styling` / `aud_agreed_styling` / `aud_disputed_styling`** all extend `STYLESHEET` with per-facet selectors that ride on top of the baseline. They inherit `font-family` / `font-size` / `font-weight` from the baseline node selector unless they explicitly override; this leaf landing those baseline values means the per-facet siblings only differ on the dimensions they actually want to vary (color, border, shape).
- **`frontend_i18n.i18n_audience_typography`** already shipped the codepoint-coverage tests and the font policy as data. Without this leaf wiring the policy in, the v1 catalogs render in a different face than the policy data claims, and the next time a maintainer reads the deferred-wiring note in `i18n_audience_typography.md`'s Status block they have to backtrack to figure out what changed. Wiring closes that loop.
- **`aud_session_url`** (1d, [`tasks/50-audience-and-broadcast.tji:217`](../../50-audience-and-broadcast.tji#L217)) lands the route that makes `<AudienceGraphView>` reachable for the first time. Once that ships, Playwright specs hit the canvas — and they hit it with the typography this leaf chose. The Playwright route assertions (cumulatively inherited from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init`) all assert "the canvas mounts and a node renders" — they would assert against the wrong text rendering if typography were still at the participant's defaults.

Architecturally, this is the **second audience-specific divergence from the participant's pattern** (after `aud_layout_engine`'s layout-options tuning). The pattern of divergence is consistent: the audience layer takes the participant's tablet-tuned defaults and re-derives them for the broadcast-output context, leaving the participant's tuning untouched. Future Cytoscape consumers will pick whichever profile fits their context; the third consumer is the trigger for shell-extraction of these settings (per `aud_cytoscape_init.md` Decision §4 + `aud_layout_engine.md` Decision §3).

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — the audience surface uses Cytoscape's stylesheet for all rendering; `font-family` must be set in the stylesheet (Cytoscape paints to canvas with its own text-measurement step, no CSS inheritance).
- [ADR 0005 — Styling: Tailwind v4 + shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the audience surface uses `@tailwindcss/vite`; Tailwind v4's `@theme` block is the canonical place to register a custom `--font-broadcast` token. The `packages/ui-tokens` workspace is deferred per Consequences, so the token lives in the audience surface's local stylesheet until that workspace materializes.
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the Vitest cases below ARE the regression coverage; no "I ran the audience and eyeballed the legibility" smoke.
- [ADR 0024 — Frontend i18n: react-i18next + ICU](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md) — the audience surface consumes `methodology.kind.*` and `methodology.edgeRole.<role>.label` keys; the rendered glyphs include every diacritic the v1 catalogs ship, validated by `typography.test.ts` codepoint-coverage cases. This leaf does NOT add or modify i18n keys.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the audience surface is a mounted library; its `index.css` ships as part of its build artifact and applies inside its `<Outlet>`. The font import is local to the audience artifact; the root app's own font choice (if any) does NOT bleed into the audience canvas.
- [ADR 0027 — Entity and facet layers are strictly separate](../../../docs/adr/0027-entity-and-facet-layers-strict-separation.md) — orthogonal but worth naming: typography settings apply uniformly to entity-layer nodes; facet-state-specific text styling is a future sibling task's scope.

### Sibling refinements

- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — the foundation this leaf modifies. Decision §1 (Cytoscape consumed directly) and Decision §2 (module-scope stylesheet with numeric width/height) named typography as a sibling-task concern; the comment at [`apps/audience/src/graph/GraphView.tsx:73-78`](../../../apps/audience/src/graph/GraphView.tsx#L73) explicitly forwards font work to this leaf.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Decision §3 (one-shot fit on first non-empty render) and Decision §4 (broadcast-tuned spacing constants) pin the canvas geometry typography has to fit inside. The 200×80 node box with 180px text-max-width is the size envelope typography may claim.
- [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md) — the upstream policy task. Status block enumerates the three pieces deferred to this leaf: wiring the font stack, bundle measurement, reference-image fixtures. Decisions §1-§3 of that refinement (lazy locale loading, 720p/1080p/1440p smoke matrix, ~50 KB i18n cost budget) constrain the trade-offs this leaf may pick from.
- [`tasks/refinements/participant-ui/part_graph_render.md`](../participant-ui/part_graph_render.md) — orthogonal but instructive: the participant's stylesheet does NOT set `font-family` because the tablet inherits the device's system UI font, which is the right choice for a participant-owned device but the wrong choice for a producer-owned broadcast composer.

### Live code the leaf modifies

- [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) — currently 18 lines (Tailwind v4 import + `@source` for shell + viewport-height reset). Extended with a Google Fonts `@import` for Inter (weights 400/500/600/700), a Tailwind v4 `@theme` block registering `--font-broadcast` as `BROADCAST_FONT_STACK`, and an updated `html, body, #root` rule setting `font-family: var(--font-broadcast)`.
- [`apps/audience/src/graph/GraphView.tsx:80-114`](../../../apps/audience/src/graph/GraphView.tsx#L80) — the `STYLESHEET` constant. Extended with `'font-family': BROADCAST_FONT_STACK` on both `node` and `edge` selectors; `font-size` bumped from `12` → `14` (node) and `10` → `11` (edge); explicit `font-weight: 600` (node) and `font-weight: 500` (edge) added.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) gains four new module-scope named exports — `BROADCAST_NODE_FONT_SIZE_PX`, `BROADCAST_EDGE_FONT_SIZE_PX`, `BROADCAST_NODE_FONT_WEIGHT`, `BROADCAST_EDGE_FONT_WEIGHT` — adjacent to `STYLESHEET`. The stylesheet entries reference the constants by name so a future sibling task that adjusts one of the values lands a single source-diff.
- [`apps/audience/src/graph/GraphView.test.tsx`](../../../apps/audience/src/graph/GraphView.test.tsx) — gains 6 new Vitest cases pinning the typography surface.

### What the surface MUST NOT do

- **No edit to `STYLESHEET` shape, color, or geometry.** Only `font-family`, `font-size`, `font-weight` change. Border, background, shape, dimensions, color values are all UNCHANGED.
- **No self-hosted `.woff2` assets, no `@font-face` rules in this leaf.** Decision §2 picks the Google Fonts `@import` for the 1d budget; self-hosting is a separately-scoped follow-up.
- **No edit to `apps/audience/src/App.tsx`.** The placeholder route stays; the new typography surface is exercised by the placeholder's existing `<h1>` + `<p>` chrome and by the (still-unreachable) `<AudienceGraphView>`.
- **No edit to `projectGraph.ts` / `layoutOptions.ts` / `cytoscapeTestEnv.ts`.** Typography is a stylesheet concern; projection, layout, and test-env are separate seams.
- **No edit to participant or moderator surfaces.** Typography is audience-specific; the participant tablet keeps its system-font inheritance, the moderator console its own ReactFlow / dagre stack.
- **No new i18n key, no edit to `packages/i18n-catalogs/src/typography.ts`.** The policy data is settled; this leaf consumes it. If the wiring surfaces a finding (a specific diacritic kerns poorly in Inter on a specific OS), the finding goes into `aud_visual_regression`'s scope, not back into the policy module.
- **No `font-style: italic` / `text-decoration: underline` / `letter-spacing` / `line-height` overrides.** Conservative scope: pick family + size + weight only. Other typography dimensions stay at Cytoscape defaults so any future sibling that wants italic facet labels, underlined diagnostic captions, etc., owns its own selector additions.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/index.css` — MODIFIED. Three additions to the current 18-line file:
  - `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');` after the `@import 'tailwindcss';` line (Google Fonts loads asynchronously; the `display=swap` policy means the fallback chain renders immediately while Inter loads, then swaps in once available — correct behaviour for a broadcast surface that cannot afford a render block).
  - A Tailwind v4 `@theme` block registering `--font-broadcast` as the full `BROADCAST_FONT_STACK` string. Per the typography module's comment at [`packages/i18n-catalogs/src/typography.ts:94-104`](../../../packages/i18n-catalogs/src/typography.ts#L94), the stack value is serialized as a single CSS-ready string specifically so a Tailwind `@theme` block can splice it in verbatim.
  - The existing `html, body, #root` rule gains `font-family: var(--font-broadcast);`.
- `apps/audience/src/graph/GraphView.tsx` — MODIFIED. Six diff hunks (all small):
  - New import: `import { BROADCAST_FONT_STACK } from '@a-conversa/i18n-catalogs';` (the constant is already re-exported from the package barrel per [`packages/i18n-catalogs/src/index.ts:66`](../../../packages/i18n-catalogs/src/index.ts#L66)).
  - Four new module-scope named exports above `STYLESHEET`: `BROADCAST_NODE_FONT_SIZE_PX = 14`, `BROADCAST_EDGE_FONT_SIZE_PX = 11`, `BROADCAST_NODE_FONT_WEIGHT = 600`, `BROADCAST_EDGE_FONT_WEIGHT = 500`. Each constant typed `as const`.
  - `STYLESHEET` node selector: replace `'font-size': 12` with `'font-size': BROADCAST_NODE_FONT_SIZE_PX`; add `'font-family': BROADCAST_FONT_STACK` and `'font-weight': BROADCAST_NODE_FONT_WEIGHT`.
  - `STYLESHEET` edge selector: replace `'font-size': 10` with `'font-size': BROADCAST_EDGE_FONT_SIZE_PX`; add `'font-family': BROADCAST_FONT_STACK` and `'font-weight': BROADCAST_EDGE_FONT_WEIGHT`.
  - Update the JSDoc block at [`apps/audience/src/graph/GraphView.tsx:61-79`](../../../apps/audience/src/graph/GraphView.tsx#L61) to add a sentence on the typography source (sibling refinement reference + `BROADCAST_FONT_STACK` import).
  - Extend the header comment block (lines 16-44) with the new "Refinement: tasks/refinements/audience/aud_clean_typography.md" entry alongside the existing `aud_cytoscape_init.md` and `aud_layout_engine.md` references, summarizing the typography decisions in the same one-line-per-decision style the surrounding header uses.
- `apps/audience/src/graph/GraphView.test.tsx` — MODIFIED. Add 6 new Vitest cases (totalling 22); existing 16 cases continue to pass:
  1. `STYLESHEET` node selector's `font-family` equals `BROADCAST_FONT_STACK`.
  2. `STYLESHEET` edge selector's `font-family` equals `BROADCAST_FONT_STACK`.
  3. `STYLESHEET` node selector's `font-size` equals `BROADCAST_NODE_FONT_SIZE_PX` (14).
  4. `STYLESHEET` edge selector's `font-size` equals `BROADCAST_EDGE_FONT_SIZE_PX` (11).
  5. `STYLESHEET` node selector's `font-weight` equals `BROADCAST_NODE_FONT_WEIGHT` (600).
  6. `STYLESHEET` edge selector's `font-weight` equals `BROADCAST_EDGE_FONT_WEIGHT` (500).

  These are structural-equality assertions on the exported `STYLESHEET` constant — no Cytoscape mount required. They mirror the pattern `aud_layout_engine.md`'s Decision §6 used for `selectDeterministicRoots` (exported-helper + isolated assertion).

### Files this task does NOT touch

- `apps/audience/src/graph/projectGraph.ts` — UNCHANGED.
- `apps/audience/src/graph/projectGraph.test.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.ts` — UNCHANGED.
- `apps/audience/src/graph/layoutOptions.test.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.ts` — UNCHANGED.
- `apps/audience/src/graph/cytoscapeTestEnv.test.ts` — UNCHANGED.
- `apps/audience/src/App.tsx` — UNCHANGED. The placeholder route's existing `text-2xl font-semibold` and `text-sm text-slate-*` classes inherit `--font-broadcast` automatically via the cascade from `html, body, #root`.
- `apps/audience/src/main.tsx` — UNCHANGED. The font loader is purely a CSS import.
- `apps/audience/src/state/*`, `apps/audience/src/ws/*` — UNCHANGED.
- `apps/audience/package.json` — UNCHANGED. `@a-conversa/i18n-catalogs` is already a dependency at [`apps/audience/package.json:13`](../../../apps/audience/package.json#L13).
- `apps/participant/**`, `apps/moderator/**`, `apps/root/**`, `apps/server/**` — UNCHANGED. Typography is audience-specific.
- `packages/i18n-catalogs/src/typography.ts` — UNCHANGED. Already the canonical policy source.
- `packages/shell/**` — UNCHANGED. No shared-shell extraction at this scale; per Decision §4 below, the third Cytoscape consumer is the extraction trigger, mirroring `aud_layout_engine.md` Decision §3.
- `docs/adr/**` — UNCHANGED. No new ADR (Decision §1 below).
- `playwright.config.ts` / `tests/e2e/**` — UNCHANGED. Playwright deferral inherits the disposition: defer to `aud_visual_regression` per Decision §6.
- `.tji` files — `complete 100` lands at task-completion time per the [README ritual](../README.md).

## Acceptance criteria

The check that says "done":

- `apps/audience/src/index.css` carries the Google Fonts `@import` for Inter (weights 400/500/600/700 with `display=swap`), a Tailwind v4 `@theme` block registering `--font-broadcast` as `BROADCAST_FONT_STACK`, and an updated `html, body, #root` rule setting `font-family: var(--font-broadcast);`.
- `apps/audience/src/graph/GraphView.tsx` exports four new module-scope constants — `BROADCAST_NODE_FONT_SIZE_PX` (14), `BROADCAST_EDGE_FONT_SIZE_PX` (11), `BROADCAST_NODE_FONT_WEIGHT` (600), `BROADCAST_EDGE_FONT_WEIGHT` (500) — and the `STYLESHEET` constant carries `'font-family': BROADCAST_FONT_STACK`, `'font-size': BROADCAST_NODE_FONT_SIZE_PX`, `'font-weight': BROADCAST_NODE_FONT_WEIGHT` on the node selector and the corresponding edge-side values on the edge selector. All other `STYLESHEET` fields are byte-identical to the post-`aud_cytoscape_init` baseline.
- `apps/audience/src/graph/GraphView.test.tsx` carries 22 cases total (16 baseline + 6 new). The 6 new cases pin font-family / font-size / font-weight per Constraints.
- `apps/audience/package.json` is UNCHANGED — no new dependency added (`@a-conversa/i18n-catalogs` is already declared).
- `apps/audience/src/App.tsx` is UNCHANGED. The component remains not-yet-reachable through any URL.
- Per `ORCHESTRATOR.md`'s deferred-e2e exception ("component not yet reachable"), Playwright coverage for this leaf is **deferred to `aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259); inherits this leaf via the `!aud_graph_rendering` umbrella). The closer registers this deferral as a `note` on `aud_visual_regression`'s WBS entry alongside the existing `aud_layout_engine` deferral note. Decision §6 explains why this is the right destination and why `aud_session_url` is wrong.
- The deferred-from-`i18n_audience_typography` bundle-size measurement (b in that task's Status block) is re-deferred — named-future-task `aud_typography_bundle_measurement` (~0.25d) which the closer registers under `aud_visual_regression`'s scope or as a standalone sibling under `aud_obs_integration.*` if a separate leaf surfaces. The deferral is recorded by reference here so the closer can find it; this leaf does NOT register it in the WBS directly.
- The deferred-from-`i18n_audience_typography` reference-image fixtures (c in that task's Status block) re-defer fully to `aud_visual_regression`, which already inherits `aud_layout_engine`'s pixel-stability deferral; the closer extends that task's existing note to cover typography too.
- `pnpm run check` clean (the strict TS pass typechecks the new constants; no new dep declared).
- `pnpm run test:smoke` green (Vitest count rises by **6** new cases in `GraphView.test.tsx`).
- `pnpm -F @a-conversa/audience build` succeeds. Bundle-size delta is essentially zero for the JavaScript path (4 numeric constants + 2 string-literal references); the font itself loads at runtime via Google Fonts, not at build time.
- `tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent (pre-commit hook enforces this).
- `tasks/50-audience-and-broadcast.tji` gets `complete 100` on `aud_clean_typography` in the same commit (the Closer's ritual).
- Per ADR 0022, no throwaway smoke scripts. The Vitest layer pins the stylesheet values; `aud_visual_regression` will land the pixel-level rendering pin once the route is reachable.

## Decisions

### §1 — Wire `BROADCAST_FONT_STACK` from the existing policy module; no new ADR

Three approaches to wiring the typography:

- **(A — chosen)** Consume `BROADCAST_FONT_STACK` from `@a-conversa/i18n-catalogs` and reference it in both `STYLESHEET` (Cytoscape) and `--font-broadcast` (Tailwind v4 `@theme`). Cost: a single import and a CSS token registration. Benefit: the policy source of truth stays in `packages/i18n-catalogs/src/typography.ts` (where `i18n_audience_typography` already placed it for exactly this consumer), the 23 codepoint-coverage tests already pin its correctness, and the audience surface picks up future policy changes for free (the `ui-tokens` migration named in the `typography.ts` module comment is purely a re-export move).
- **(B)** Hard-code the font stack string in `apps/audience/src/index.css` and again in `STYLESHEET`. Cost: two copies of a long string that must stay in sync. Benefit: no cross-package import. Rejected — duplicating the policy data forfeits the codepoint-coverage tests' guarantee and creates two places to forget to update.
- **(C)** Add a `font-broadcast` Tailwind utility class (`font-family: Inter, …`) and a Tailwind `font-` class to every text element. Cost: every text rendering site has to opt in via a class. Benefit: visible at every call site. Rejected — Cytoscape stylesheets are NOT Tailwind class consumers; setting the family on `html, body, #root` is the smaller, more uniform pattern.

No new ADR is required. The choice between A and B does not rise to an architectural-decision threshold (no new dependency, no new pattern, no security implication — it's a wiring decision the existing ADRs and refinements already constrain). The "policy data in `@a-conversa/i18n-catalogs`, wiring in consumers" pattern was established by `i18n_audience_typography` and reaffirmed in [`typography.ts` lines 14-25](../../../packages/i18n-catalogs/src/typography.ts#L14).

### §2 — Google Fonts `@import` over self-hosted `.woff2` for the 1d budget

Two approaches to loading Inter:

- **(A — chosen)** Google Fonts `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')`. Cost: one CSS line; a runtime request to `fonts.googleapis.com` on first audience-surface load per browser cache; production OBS hosts need outbound HTTPS to Google. Benefit: well-understood, smallest possible source-tree footprint, no asset binary to commit, `display=swap` ensures the fallback chain renders immediately while Inter loads. Inter from Google Fonts is automatically subsetted; the audience pulls only the codepoints in the Latin Extended-A range (which is exactly what the v1 catalogs need, per `V1_LOCALE_CODEPOINT_RANGES`).
- **(B)** Self-host `.woff2` via `@font-face`. Cost: commit binary `.woff2` files to the repo (one per weight); configure Vite to ship them; bundle-size measurement gets more involved. Benefit: no third-party runtime dependency; OBS hosts behind restrictive networks work; first-load is faster (no cross-origin fetch). Rejected for the 1d budget — and rejected as the right answer for v1 broadcast: if production OBS hosts demonstrate latency or availability issues against `fonts.googleapis.com`, a follow-up `aud_self_host_inter` task (~0.5d, would commit the `.woff2` assets under `apps/audience/public/fonts/`) is the right place to land it. The fallback chain (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`) covers the case where Google Fonts fails entirely — every entry is full-Latin-Extended-A-safe per the typography module's comment block.
- **(C)** Ship NO font load at all; rely entirely on the fallback chain. Cost: every viewer sees the system font; cross-host appearance varies (macOS produces San Francisco, Windows produces Segoe UI, Linux produces whatever's installed). Benefit: zero new runtime dep. Rejected — the entire point of `i18n_audience_typography`'s policy work was to pin Inter as the broadcast face; bypassing it would forfeit that work and produce variable broadcasts.

The named-future-task (if production demands it): `aud_self_host_inter` — "Self-host Inter `.woff2` for broadcast resilience," ~0.5d, would commit Inter's woff2 files (Regular 400, Medium 500, SemiBold 600, Bold 700) under `apps/audience/public/fonts/` and replace the Google Fonts `@import` with `@font-face` rules. The closer does NOT register this in the WBS today; it lands only if production evidence (Sentry errors from `fonts.googleapis.com`, OBS-host complaints) surfaces.

### §3 — Sizes (14 / 11) and weights (600 / 500) fit the existing geometry

The current `STYLESHEET` baseline ships node `font-size: 12, width: 200, height: 80, text-max-width: 180px` and edge `font-size: 10`. The chosen bumps (12 → 14 for nodes, 10 → 11 for edges) are conservative:

- **Why bump at all.** Broadcast canvases render at 1080p typical (per `aud_obs_sizing_defaults` placeholder); a 12px node label is ~1.1% of canvas height, which is below the threshold for crisp small-text rendering on consumer TV / streaming compression. 14px is ~1.3%, still small relative to titlecards but legible at the typical OBS-source compositing scale.
- **Why not larger.** The node bounding box is 200×80 with text-max-width 180px; bumping node font to 16px+ would force most multi-word labels to wrap to 3-4 lines, which `text-wrap: wrap` would then either overflow vertically or clip. 14px keeps typical labels (per the methodology glossary in `i18n_methodology_glossary.md`) at 2 lines maximum. Edge labels are smaller because the edge selector applies in-line on the edge path (no bounding box); 11px maintains contrast against the 1.45 spacing-factor edge length without crowding adjacent nodes.
- **Why weight 600 / 500.** Inter Regular (400) is optically light on a 1080p video frame, especially after streaming compression which can blur stem thickness; SemiBold (600) for nodes pulls them forward as the primary information layer, Medium (500) for edges keeps them visible without competing with node labels for emphasis. Bold (700) is reserved for the future per-facet styling siblings (a "disputed" node may want to use the heavier weight, for instance).
- **Why pin via named exports.** Future sibling tasks (`aud_per_facet_visualization`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`) will introduce derived text — facet sub-states, axiom-mark badges, annotation overlays — whose typography wants to live in proportion to the baseline. Naming the constants lets those tasks key off `BROADCAST_NODE_FONT_SIZE_PX - 2` rather than rediscover "is the baseline 12 or 14?" via reading the stylesheet.

Alternative — pick larger values (16 / 13 / weight 700 / 600). Rejected as too aggressive for the 1d budget without empirical evidence; `aud_visual_regression` is the place to bump them if a producer-machine smoke test shows the 14 / 11 baseline is too thin.

Alternative — pick smaller values (13 / 10 / weight 500 / 400). Rejected as too close to the participant tablet baseline to justify a separate leaf.

Alternative — set `line-height` and `letter-spacing` too. Rejected per the "What the surface MUST NOT do" constraint above — conservative scope, family + size + weight only. Future tuning is a separate sibling's scope.

### §4 — Named-export constants over a stylesheet-tokens module

The constants land as named exports from `GraphView.tsx` alongside the existing `STYLESHEET` export, NOT in a new `apps/audience/src/graph/stylesheet.ts` (or `tokens.ts`) module.

Three approaches:

- **(A — chosen)** Named exports from `GraphView.tsx`. Cost: nothing — the file already exports `STYLESHEET`. Benefit: future siblings (per-facet styling, axiom-mark, annotation) consume the constants via a single import line from the same module they're already extending. The pattern mirrors how `aud_layout_engine.md` Decision §4 exposed `SPACING_FACTOR` and `PADDING` as named exports from `layoutOptions.ts`.
- **(B)** Extract `STYLESHEET` + constants to a new `apps/audience/src/graph/stylesheet.ts` module. Cost: a new module + import-graph shuffle. Benefit: a clearer separation of "the stylesheet" from "the React component." Rejected as premature — the stylesheet is one consumer (the GraphView's Cytoscape mount), and the per-facet styling siblings will likely each contribute a small selector array that gets concatenated into `STYLESHEET`. Extracting today forces every sibling to import from the new module while the current single-file layout still does the job; the extraction trigger is "3+ selector contributors" (mirroring the shell-extraction trigger of "3+ Cytoscape consumers" from `aud_cytoscape_init.md` Decision §4).
- **(C)** Inline magic numbers (no constants at all). Cost: future siblings re-discover the values by reading the stylesheet. Rejected per `aud_layout_engine.md` Decision §4's precedent — named constants are autocomplete-discoverable and pin the regression intent.

The named-future-task (if 3+ siblings layer selectors on): `aud_stylesheet_module_extraction` (~0.25d) — would move `STYLESHEET` and its constants into a new `apps/audience/src/graph/stylesheet.ts` with named selector arrays per facet state, concatenated into the final `STYLESHEET` export. The closer does NOT register this in the WBS; the trigger is empirical (third sibling task lands and the file gets unwieldy).

### §5 — `font-family` on both node and edge selectors (not just node), no cascade reliance

Cytoscape's stylesheet supports selector inheritance via the `core` selector — setting `'font-family'` on `core` would apply to all child elements. The chosen approach sets `'font-family'` on both `node` and `edge` selectors explicitly:

- **Why.** Cytoscape's selector inheritance is narrow (the `core` selector applies to canvas-wide settings like `outside-texture-bg-color`, not to text styling on elements). The per-element selectors (`node`, `edge`) are where text styles take effect. Setting `'font-family'` on `core` does NOT propagate to `node` / `edge` text rendering — Cytoscape's text-style resolver keys on the per-element selectors.
- **Alternative — set on `core` only.** Tested empirically (during `aud_cytoscape_init` development per its Decision §2 comment about the `width: 'label'` deviation): Cytoscape 3.33's text rendering ignores `core`-level `font-family`. Rejected as not functional.
- **Alternative — set on `node` only and rely on edge labels inheriting via the CSS-style cascade.** Cytoscape does NOT have a CSS cascade in this sense — stylesheets are flat selector-→-style maps with explicit per-element resolution. Edge labels render in the system default if the edge selector does not set `font-family`. Rejected as not functional.

The duplication (two copies of `'font-family': BROADCAST_FONT_STACK` in the stylesheet) is intentional and pinned by Vitest cases 1 and 2 below.

### §6 — Playwright deferral lands on `aud_visual_regression`, NOT `aud_session_url`

Per `ORCHESTRATOR.md`'s deferred-e2e exception: this leaf modifies a component / a CSS file that affects rendering inside an audience-surface region that is still not reachable through any user-flow route (`apps/audience/src/App.tsx:124` still maps every path to the placeholder; the per-session route lands in `aud_url_routing.aud_session_url`). The placeholder route IS reachable (and exercises the new `--font-broadcast` token via the existing `<h1>` + `<p>` chrome), but the typography decisions this leaf makes are dominated by the Cytoscape canvas — and the canvas is not reachable.

`aud_session_url`'s inherited deferred-e2e debt is already at the threshold flagged by `ORCHESTRATOR.md` (cumulative debt from `aud_ws_client`, `aud_state_management`, `aud_anonymous_ws_subscribe`, `aud_cytoscape_init` per `aud_cytoscape_init.md` Decision §9). `aud_layout_engine.md` Decision §5 already redirected layout-engine pixel-stability to `aud_visual_regression` to avoid adding a fifth dependent; typography pixel-stability is the same case — same audience surface, same not-yet-reachable canvas, same destination.

The right destination is **`aud_visual_regression`** (2d, [`tasks/50-audience-and-broadcast.tji:259`](../../50-audience-and-broadcast.tji#L259)): the visual-regression task already inherits the layout-engine's deterministic-roots + first-mount-fit pixel-stability work, and typography is exactly the same kind of "the rendered pixels match across runs" assertion. The closer extends `aud_visual_regression`'s existing note to cover typography (font-family / size / weight render identically across Chrome / Firefox / WebKit at 720p / 1080p / 1440p, codepoint coverage from `typography.test.ts` confirmed visually via reference fixtures).

The typography-stylesheet correctness (font-family, font-size, font-weight on both selectors; exported constants matching the stylesheet values) is fully pinned at the Vitest layer below — `aud_visual_regression` is for the *visible* rendering, not the stylesheet shape. Per ADR 0022 the Vitest cases are the regression coverage; the visual-regression task layers pixel-stability on top.

Alternative — defer to `aud_session_url`. Rejected per the "2+ refinements, pay down" rule (this would be the 5th dependent) and per the scope mismatch (route-mount assertions are not typography assertions).

Alternative — scope a thin Playwright spec inline that asserts the placeholder route's chrome renders in Inter. Rejected — would prove that the `@import` URL works, not that the broadcast font renders crisply in the Cytoscape canvas (where it matters); the assertion would also require Inter to be installed on the CI host or the test to detect the swap-in fallback flicker. The Vitest assertions pin the stylesheet values; the visual-regression task is the right place for "what the browser actually paints."

Alternative — register a new `aud_pw_typography_smoke` task. Rejected — planning-debt for no architectural reason; `aud_visual_regression` already exists with the right scope.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/index.css` — adds Google Fonts `@import` for Inter (400/500/600/700, display=swap), a Tailwind v4 `@theme` block registering `--font-broadcast` as `BROADCAST_FONT_STACK`, and `font-family: var(--font-broadcast)` on `html, body, #root`.
- `apps/audience/src/graph/GraphView.tsx` — imports `BROADCAST_FONT_STACK` from `@a-conversa/i18n-catalogs`; exports four new constants (`BROADCAST_NODE_FONT_SIZE_PX = 14`, `BROADCAST_EDGE_FONT_SIZE_PX = 11`, `BROADCAST_NODE_FONT_WEIGHT = 600`, `BROADCAST_EDGE_FONT_WEIGHT = 500`); extends `STYLESHEET` node + edge selectors with `font-family` / `font-size` / `font-weight`; extends header refinement block.
- `apps/audience/src/graph/GraphView.test.tsx` — adds 6 structural Vitest cases (q–v) pinning the typography surface on both selectors against the exported constants; 22 cases total (16 baseline + 6 new).
- Playwright deferred to `aud_visual_regression` per Decision §6 (component not yet reachable; `apps/audience/src/App.tsx` still maps every path to the placeholder).
- `aud_typography_bundle_measurement` (~0.25d) registered in WBS under `aud_obs_integration` (re-deferred from `i18n_audience_typography` Status block (b)).
- `aud_visual_regression` note extended to cover typography pixel-stability (font-family/size/weight render identically across Chrome/Firefox/WebKit at 720p/1080p/1440p; reference-image fixtures cover codepoint coverage confirmed by `typography.test.ts`).
