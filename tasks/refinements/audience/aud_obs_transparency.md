# Background transparency for compositing

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_obs_transparency` (effort `0.5d`, `depends !aud_obs_sizing_defaults`; the parent `aud_obs_integration` declares `depends !aud_shell`, so this leaf inherits the shell-complete frontier plus the sizing-defaults sibling).

**Effort estimate**: 0.5d — one CSS edit in [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) (a new `body { background-color: transparent; }` rule, ~5 LOC including the explanatory comment), one new Vitest case in [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) (~+30 LOC pinning the computed `background-color` on `<body>` after mount), one new Playwright assertion appended to the existing OBS-dimension scenario in [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) (~+10 LOC pinning the transparent body at the reachable graph route under real Chromium), and an inline annotation in [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) extending the existing **OBS sizing invariant** block with a paired **OBS transparency invariant** record. No new file, no new dependency, no new i18n key, no new ADR.

**Inherited dependencies**:

- `!audience.aud_obs_integration.aud_obs_sizing_defaults` (settled 2026-05-27, [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md)) — establishes the full-bleed root chain (`html, body, #root { height: 100%; width: 100%; margin: 0; }` + `body { overflow: hidden; }`) this leaf adds the background-color rule alongside. Line 35 of that refinement names *this* task as the sibling owning the broadcast background: "the background color (or `rgba(0,0,0,0)` for transparency) is the transparency sibling's call." Decision §1 below picks the transparency option.
- `!audience.aud_shell.aud_app_skeleton` (settled — the audience surface mounts as a Vite library bundle under `/a/*`; the `html, body, #root` reset lives in [`apps/audience/src/index.css:38-45`](../../../apps/audience/src/index.css#L38); no surface-level background color is currently set, so Chromium falls back to the user-agent default — opaque white).
- `!audience.aud_shell.aud_no_auth_for_public` (settled — the OBS-typical anonymous-on-public mount path renders without any cookie/input; the background-transparency rule must apply to the anonymous mount too, i.e. it lives in `index.css` rather than inside any conditional render path).
- Prose-only context (NOT a `.tji` edge): `audience.aud_url_routing.aud_session_url` (settled 2026-05-27, [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md)) — the graph route at `/a/sessions/:sessionId` is now **reachable**, mounting `<AudienceLiveRoute>` → `<AudienceGraphView>`. That refinement's spec (`tests/e2e/audience-live-session.spec.ts`) carries the existing OBS-dimension audit at the graph-route tier (scenario 6, 1080p `setViewportSize` + viewport-fill assertion). This leaf extends that scenario with a transparency assertion rather than deferring to a future Playwright leaf (per orchestrator brief: when the component IS rendered, a thin Playwright pin is preferred over full deferral). See Decision §5.
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_cytoscape_init` (settled — Cytoscape's canvas does NOT paint a background fill; the rendered viewport is transparent by construction and shows through to whatever the underlying `<body>` paints. Node fills are explicitly `'background-color': '#ffffff'` in [`apps/audience/src/graph/stylesheet.ts:160`](../../../apps/audience/src/graph/stylesheet.ts#L160) — legibility-oriented, NOT page-background-related. See Decision §4 for why Cytoscape requires no change at this leaf).
- Prose-only context (NOT a `.tji` edge): `foundation.graph_lib_decision` (settled — line 27 of [`tasks/refinements/foundation/graph_lib_decision.md`](../foundation/graph_lib_decision.md) lists "OBS-friendly sizing/transparency" as a requirement; the WBS scoped that requirement to two siblings (`aud_obs_sizing_defaults` + this leaf). With this leaf, both halves ship.).

## What this task is

A 0.5d **CSS-pinning** leaf under `aud_obs_integration`. It does NOT add a new feature, a new prop, or a new bundle; it sets the audience surface's `<body>` background to fully transparent (`rgba(0,0,0,0)`) so an OBS browser source composites the audience canvas over the producer's scene with no opaque page-background bleeding through, and pins that property via a Vitest mount audit + a Playwright assertion appended to the existing graph-route OBS-dimension scenario.

After this leaf:

- `apps/audience/src/index.css` gains a new `body { background-color: transparent; }` rule (a separate block immediately after the existing `body { overflow: hidden; }` rule the sizing-defaults leaf added). The new rule explicitly sets the body's background to `rgba(0,0,0,0)` so any future PR that introduces a paint at the `<body>` level (a debug overlay, an i18n RTL hint, a `bg-slate-50` Tailwind utility lazily applied through a class change) surfaces as a regression on the new test rather than as a silent OBS-embed defect.
- A new Vitest case appended to [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) (the 6th case, immediately after the full-bleed audit from `aud_obs_sizing_defaults`) asserts `getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'` after the surface mounts under the anonymous-on-public branch. Mirrors the structure of the sibling no-input + sizing audits.
- A new Playwright assertion appended to the existing OBS-dimension scenario in [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) (scenario 6 per the `aud_session_url` Status block) asserts the same property at the reachable graph route under real Chromium: `await page.evaluate(() => getComputedStyle(document.body).backgroundColor)` returns `'rgba(0, 0, 0, 0)'`. The assertion fires inside the existing `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` block, so the body's transparency is verified at the canonical 1080p OBS browser-source dimension.
- An inline annotation block lands in `App.tsx` next to the existing **OBS sizing invariant** record. The new **OBS transparency invariant** records that the surface's `<body>` is transparent so the OBS browser source composites the rendered graph over the producer's scene, that node fills remain `#ffffff` (legibility, NOT page-background), and that the dimension-matrix pixel-comparison pin lives in `aud_tests.aud_obs_render_smoke`.

Out of scope (deferred to existing or future leaves — see Decision §2):

- **Chroma-key (green / blue) page background as a transparency alternative.** Some producers chroma-key in OBS rather than relying on the browser-source alpha channel. Rejected as the audience surface's default: chroma-key requires a per-producer key-color setup in OBS Studio (slower onboarding) and degrades fringe quality on anti-aliased canvas edges (the `BROADCAST_NODE_FONT_SIZE_PX = 18` Inter glyphs would key-bleed on every glyph edge). The `body { background-color: transparent; }` rule lets OBS use its native alpha-channel compositing (zero-setup, perfect-edge). Producers who *want* chroma-key can override at the OBS-source "custom CSS" tier — this is documented in `aud_obs_setup_docs`. See Decision §1.
- **Per-state node-fill transparency** (e.g. making the `#ffffff` node fills partially transparent so the producer's scene shows through the node body). Rejected — the white node fills are a legibility decision (the `BROADCAST_NODE_FONT_SIZE_PX = 18` slate-900 label text needs a high-contrast backdrop to remain readable on arbitrary producer scenes). Per-state-fill transparency would be a substantial design change and lives in `aud_visual_regression` if a future producer scenario demands it. See Decision §7.
- **Cytoscape canvas-level background override.** The Cytoscape `<canvas>` element's clear-color is already transparent by construction (Cytoscape does not paint a background fill — it composites elements over a transparent canvas; the white background visible today is the underlying `<body>`'s user-agent default). No `cy.style().background-color(...)` directive, no container-element `style.background = ...` assignment is needed. See Decision §4.
- **A `?bg=opaque` (or similar) URL parameter** for producers who want the legacy opaque-white behaviour. Speculative until a producer complaint surfaces; deferred mirroring `aud_obs_sizing_defaults.md` Decision §2's parallel deferral of `?dimensions=720p` and `aud_obs_no_input_required.md` Decision §6's deferral of `?chrome=off`.
- **A pixel-level transparency smoke at OBS dimensions.** `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`, [`tasks/50-audience-and-broadcast.tji:460-464`](../../50-audience-and-broadcast.tji#L460)) is the canonical leaf for "render at 1280×720 / 1920×1080 / 2560×1440 and verify the producer-scene compositing path." This leaf only pins the **structural** transparency property (the body's computed `background-color` is `rgba(0,0,0,0)`) at one dimension (1080p); the multi-dimension pixel-comparison pin stays `aud_obs_render_smoke`'s scope. That leaf's refinement-writer iterates `BROADCAST_DIMENSIONS` and asserts the transparency holds at each.
- **A producer-facing setup guide.** `aud_obs_setup_docs` (1d, depends `!aud_obs_sizing_defaults, !aud_obs_transparency`, [`tasks/50-audience-and-broadcast.tji:298-302`](../../50-audience-and-broadcast.tji#L298)) is the sibling that documents the OBS browser-source configuration including the alpha-channel composite mode the transparency this leaf installs depends on. That refinement consumes this leaf's invariant.
- **A new ADR.** No new architectural choice. The transparency contract is a one-line CSS rule against an existing reset block — well-known web platform behaviour for OBS browser-source compositing, not a new convention. See Decision §6.
- **A new dependency.** No new runtime or dev dep; the work is purely module-level CSS + tests + inline annotation.

## Why it needs to be done

OBS browser sources composite their rendered page over the producer's scene using the page's alpha channel — wherever the page is transparent, the underlying scene shows through; wherever the page is opaque, the page's pixels replace the scene's pixels. This is the canonical "embed live data over our broadcast" workflow: a producer puts the audience graph in a corner of their stream layout (talking heads in the centre, agenda chyron at the bottom, audience graph in the upper-right) and the graph's nodes/edges paint over the producer's background.

The audience surface today has **no explicit background-color** anywhere in `index.css`, on `<html>`, on `<body>`, on `#root`, or on the Cytoscape container. Chromium's user-agent default for `<body>` background-color is opaque white (`rgb(255, 255, 255)`). The result: an OBS browser source embedded over the producer's scene paints an opaque white rectangle over whatever is behind it, occluding the producer's background completely. The producer's only recourse today is a chroma-key filter in OBS Studio, which requires per-scene setup and degrades fringe quality on every anti-aliased glyph edge — the audience surface's `BROADCAST_NODE_FONT_SIZE_PX = 18` Inter labels would key-bleed visibly on every character.

The fix is a single CSS rule: `body { background-color: transparent; }`. Chromium then renders the body as `rgba(0, 0, 0, 0)` (the canonical transparent paint), Cytoscape's canvas (which never paints a background fill by construction) shows through to the body, the body shows through to the page, and the page's alpha channel passes the transparent regions to OBS for compositing. The opaque regions (node fills at `#ffffff`, edge strokes at the per-state colours from `aud_proposed_styling` / `aud_agreed_styling` / `aud_disputed_styling`) remain opaque and paint over the producer's scene; the rest of the canvas is transparent and the producer's scene shows through.

The failure modes the leaf forecloses are quiet:

1. **A future PR adds a Tailwind `bg-slate-50` utility** (or any background-paint class) to a wrapping `<div>` in `App.tsx`, the route components, or the graph-view container — e.g. as a "subtle backdrop" polish step. In a normal browser, the slate-50 backdrop is invisible (the whole page is already white). In an OBS browser source, the slate-50 backdrop is now an opaque off-white rectangle occluding the producer's scene. A committed test that pins `getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'` catches the regression at PR-review time. (Note: the test pins the *body's* computed background, not any nested element's — a Tailwind class on a wrapping div passes the body-level audit. Decision §7 documents why per-element-fill transparency stays out of scope.)
2. **A future PR adds a `body { background-color: #ffffff }` rule** for "consistency with the moderator surface" without realising the audience-broadcast context — the regression is silent in dev (the page looks identical) and only surfaces on a producer complaint weeks later. The Vitest case fails immediately.
3. **A future PR amends the `html, body, #root` reset block** to add a `background-color` property to the shared selector — same failure as (2), surfaced by the same test.

Downstream consumers of this leaf:

- **`aud_obs_setup_docs`** (1d, depends `!aud_obs_sizing_defaults, !aud_obs_transparency`) — documents the producer-facing OBS scene-source configuration. With the transparent `<body>` in place, the docs can recommend "drop the audience URL into an OBS browser source, no custom CSS needed, the alpha channel composites natively." Without this leaf, the docs would have to instruct producers to add the OBS-source "Custom CSS" override `body { background-color: rgba(0, 0, 0, 0) !important; }` — a documented OBS workaround but redundant once the page ships transparent by default.
- **`aud_tests.aud_obs_render_smoke`** (1d, depends `!!aud_obs_integration`) — iterates `BROADCAST_DIMENSIONS` and verifies the transparency holds across 720p / 1080p / 1440p Chromium contexts. The audit predicate is the same as this leaf's (`getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'`); the dimension-matrix iteration is the smoke leaf's added value.
- **`aud_visual_regression`** (2d, depends `!aud_playwright_e2e`) — visual-regression fixtures of the audience surface MUST capture the page over a transparent backdrop so per-state colour changes are visible against a known reference. The reference-image baseline assumes the body is transparent; if a future PR ever flipped the body to opaque, every visual-regression fixture would also fail.
- **The graph-rendering siblings** (`aud_proposed_styling`, `aud_agreed_styling`, `aud_disputed_styling`, the future `aud_per_facet_visualization`, `aud_axiom_mark_decoration`, `aud_annotation_rendering`) all paint over a transparent canvas. The per-state border / opacity / line-style decisions in those refinements assume the underlying page is transparent — a per-state node-fill is the only opaque region in the absence of a wrapping `<div>` background. This leaf locks that assumption into the test layer.

## Inputs / context

### ADRs

- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Cytoscape is the audience-side graph renderer; its canvas is transparent by construction (no background-fill in the default stylesheet, no explicit clear-color in `<AudienceGraphView>`'s init). The transparency rule this leaf adds applies one level up (the `<body>` element) so the canvas's natural transparency passes through to OBS compositing.
- [ADR 0005 — Tailwind with shared tokens](../../../docs/adr/0005-styling-tailwind-with-shared-tokens.md) — the `index.css` edit stays within the existing Tailwind v4 + plain-CSS reset pattern; no new utility class, no new theme token. The single `body { background-color: transparent; }` rule is below the `@import 'tailwindcss';` directive but above any utility-class consumer in the rendered DOM, so Tailwind's `bg-*` utilities applied to nested elements continue to paint as authored (those paint at the element they're attached to; the body remains transparent regardless).
- [ADR 0022 — No throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the new Vitest case and the new Playwright assertion ARE the regression pin. No manual "I opened OBS and put the audience URL into a scene and the background was see-through" smoke.
- [ADR 0026 — Micro-frontend root app](../../../docs/adr/0026-micro-frontend-root-app.md) — the host wraps every surface in `<div className="min-h-screen">` at [`apps/root/src/surfaces/SurfaceHost.tsx`](../../../apps/root/src/surfaces/SurfaceHost.tsx). That wrapper has no `background-color` of its own; the body's transparency propagates through it to OBS. The audience-specific `<div className="h-screen w-screen">` wrapper in `AudienceLiveRoute.tsx` (from `aud_session_url`) is similarly background-color-free.

### Sibling refinements

- [`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md) — the directly-named predecessor. Decision §2 (line 35): "the background color (or `rgba(0,0,0,0)` for transparency) is the transparency sibling's call." This leaf cashes that forward-reference.
- [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md) — the sibling pattern this leaf mirrors. Structural OBS contract, Vitest pinning at the placeholder route, Playwright extension at the graph route. The Vitest case structure (anonymous `AuthContextValue`, `mount(...)` from `apps/audience/src/main.tsx`, `getComputedStyle` audit on `<body>`) is copied verbatim from the sibling.
- [`tasks/refinements/audience/aud_session_url.md`](aud_session_url.md) — the leaf that made the graph route reachable. Its Status block names six scenarios in `tests/e2e/audience-live-session.spec.ts`; this leaf extends scenario 6 (the existing OBS-dimension audit at the graph-route tier) with one new transparency assertion. The graph route's reachability is what lets this leaf pay debt down inline rather than deferring to `aud_obs_render_smoke`.
- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — established the `html, body, #root { height: 100% }` reset. This leaf adds the background-color rule alongside (a separate `body { ... }` block, not a property on the shared selector — Decision §3).
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — Decision §7 (pan/zoom enabled defaults) is transparency-orthogonal; the graph's `h-full w-full` container fills the parent without painting a background fill. No Cytoscape-side change is required at this leaf.
- [`tasks/refinements/audience/aud_proposed_styling.md`](aud_proposed_styling.md), [`aud_agreed_styling.md`](aud_agreed_styling.md), [`aud_disputed_styling.md`](aud_disputed_styling.md) — the per-state styling refinements. Each pins per-state border-colour / border-style / opacity on the **node** without touching the body / page background. The transparency contract this leaf installs is the page-level complement to those per-state node decisions.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — established `BROADCAST_FONT_STACK` and `--font-broadcast`. Typography is orthogonal to background-color; the rules sit alongside in `index.css` without conflict.
- [`tasks/refinements/foundation/graph_lib_decision.md`](../foundation/graph_lib_decision.md) — line 27 lists "OBS-friendly sizing/transparency" as the foundational graph-library requirement. With this leaf shipped, both halves are pinned (sizing in `aud_obs_sizing_defaults`, transparency here).

### Live code the leaf integrates with

- [`apps/audience/src/index.css:38-55`](../../../apps/audience/src/index.css#L38) — modified. The existing `html, body, #root { height: 100%; width: 100%; margin: 0; font-family: var(--font-broadcast); }` block stays unchanged. The existing `body { overflow: hidden; }` block (from `aud_obs_sizing_defaults`) stays unchanged. A new `body { background-color: transparent; }` block is appended after the `overflow: hidden` block, with its own explanatory comment naming this refinement. ~+5 LOC.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. One new case appended after the OBS sizing-defaults full-bleed audit (which is the current 5th case per `aud_obs_sizing_defaults.md` Status). Asserts `getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'` (canonical happy-dom serialisation of the transparent paint) after the surface mounts. ~+30 LOC; mirrors the structure of the sizing-defaults case verbatim.
- [`tests/e2e/audience-live-session.spec.ts`](../../../tests/e2e/audience-live-session.spec.ts) — modified. One new assertion appended to scenario 6 (the existing OBS-dimension audit at the graph-route tier). Inside the existing `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` block, after the viewport-fill assertion: `expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)')`. ~+10 LOC (the assertion plus its inline comment naming this refinement). Alternatively, the assertion lands as its own `test()` block under the same describe — Decision §5(B) records the trade-off.
- [`apps/audience/src/App.tsx:37-48`](../../../apps/audience/src/App.tsx#L37) — modified. The existing **OBS sizing invariant** comment block (lines 37-48 per the post-`aud_obs_sizing_defaults` shape) is extended (or paired with a new **OBS transparency invariant** block immediately below) recording the body-transparency contract, the alpha-channel-composite path, and the dimension-matrix deferral to `aud_obs_render_smoke`. ~+10 LOC of comment, zero behaviour change.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — NOT modified. The Cytoscape canvas is transparent by construction; no clear-color or container-style change is required (Decision §4).
- [`apps/audience/src/graph/stylesheet.ts:160`](../../../apps/audience/src/graph/stylesheet.ts#L160) — NOT modified. The `'background-color': '#ffffff'` on nodes is a legibility decision (slate-900 label text on white fill on arbitrary producer scenes); transparency lives at the body level (Decision §7).
- [`apps/audience/src/routes/AudienceLiveRoute.tsx`](../../../apps/audience/src/routes/AudienceLiveRoute.tsx) — NOT modified. The `<div className="h-screen w-screen">` wrapper has no `background-color`; transparency propagates through it.
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — NOT modified. The mount entry is background-color-agnostic.
- `packages/shell/src/host/SurfaceHost.tsx` — NOT modified. The `min-h-screen` wrapper has no background-color; transparency propagates through.

### What the surface MUST contain

- An `index.css` rule with selector `body` and property `background-color: transparent;` (or the equivalent `rgba(0, 0, 0, 0)` literal — Decision §3 picks `transparent` for readability).
- `getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'` after mount under both the placeholder route (Vitest) and the live graph route (Playwright).
- The new `body { background-color: transparent; }` rule MUST NOT carry `!important` — no caller currently overrides it, and `!important` would itself become a regression vector for future legitimate scoped overrides (the moderator / participant surfaces will never bundle the audience's `index.css`, so cross-surface bleed is structurally impossible).
- The new rule MUST live as its own `body { ... }` block, NOT folded into the shared `html, body, #root` reset (Decision §3).

### What the surface MUST NOT contain

- No `background-color` property on `html`, `#root`, the `<div className="h-screen w-screen">` wrapper in `AudienceLiveRoute`, or any other ancestor of the `<body>` (Decision §3 restricts the rule to `body` only — Chromium composites at the body level for OBS browser sources, and any opaque ancestor closer to the root would still occlude the producer's scene).
- No `cy.style().backgroundColor(...)` directive in Cytoscape stylesheet construction.
- No inline `style={{ background: ... }}` prop on any wrapping `<div>` in `App.tsx`, the route components, or `<AudienceGraphView>`.
- No chroma-key colour (`#00ff00`, `#0000ff`) anywhere — Decision §1 picks alpha-channel transparency over chroma-key.
- No `?bg=opaque` URL parameter (out-of-scope deferral above).

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

- **Vitest mount audit** in `mount.test.tsx` — runs in happy-dom, asserts the computed-style chain after the surface mounts under the anonymous-on-public input. Catches CSS regressions at the placeholder-route tier (a future PR dropping the new `body { background-color: transparent; }` rule, or adding an overriding rule, surfaces here).
- **Playwright assertion** in `audience-live-session.spec.ts` (scenario 6's existing OBS-dimension block) — runs in real Chromium against the production-mode compose build, asserts the same property at the reachable graph route. Catches regressions that pass happy-dom but fail in Chromium (a CSS reset transform applied by Vite's PostCSS pipeline, a class-based override applied conditionally after mount, etc.).

No new Cucumber scenario (transparency is a UI-CSS property, not a wire-format or projector-output property). The combined Vitest + Playwright pair is the canonical layer for this kind of structural property.

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/index.css` — modified. ~+5 LOC: new `body { background-color: transparent; }` rule + explanatory comment, appended after the existing `body { overflow: hidden; }` block.
- `apps/audience/src/mount.test.tsx` — modified. ~+30 LOC: one new case appended after the OBS sizing-defaults full-bleed audit.
- `tests/e2e/audience-live-session.spec.ts` — modified. ~+10 LOC: one new assertion appended to the existing OBS-dimension scenario (scenario 6 per `aud_session_url` Status), inside the existing `setViewportSize` block. Alternatively a new `test()` block under the same describe — Decision §5.
- `apps/audience/src/App.tsx` — modified. ~+10 LOC of inline comment near the existing OBS sizing-invariant block; zero behaviour change.

### Files this task does NOT touch

- `apps/audience/src/main.tsx` — unchanged.
- `apps/audience/src/graph/GraphView.tsx` — unchanged. The graph container is background-color-agnostic.
- `apps/audience/src/graph/stylesheet.ts` — unchanged. Node fills stay `#ffffff` for legibility (Decision §7).
- `apps/audience/src/graph/projectGraph.ts`, `facetStatus.ts`, `cytoscapeTestEnv.ts`, `layoutOptions.ts` — unchanged.
- `apps/audience/src/routes/AudienceLiveRoute.tsx` — unchanged. The wrapper div has no background; transparency propagates through.
- `packages/shell/src/host/SurfaceHost.tsx` — unchanged. The `min-h-screen` wrapper is background-color-agnostic.
- `packages/shell/`, `packages/i18n-catalogs/`, `apps/root/`, `apps/moderator/`, `apps/participant/`, `apps/replay-test/`, `apps/server/` — unchanged.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — unchanged. The placeholder route's transparency is exercised by the new Vitest mount-audit case; adding a redundant Playwright assertion to the skeleton smoke would multiply test surface without pinning a new behaviour.
- `apps/audience/package.json`, `apps/audience/vite.config.ts`, `playwright.config.ts` — unchanged. No new dependency, no new project, no `testMatch` widening (`audience-live-session.spec.ts` is already matched by the post-`aud_session_url` regex).
- `docs/adr/` — no new ADR (Decision §6).
- `.tji` files — `complete 100` lands at task-completion time per [`tasks/refinements/README.md`](../README.md); no new follow-up tech-debt leaf registered (Decision §2).

### CSS edit (sketch — `index.css`)

```css
/* `aud_obs_transparency` — OBS browser sources composite the rendered
 * page over the producer's scene via the page's alpha channel. Chromium's
 * user-agent default for `<body>` background-color is opaque white, which
 * would occlude the producer's scene completely. Setting the body to
 * transparent lets Cytoscape's naturally transparent canvas pass through
 * to OBS, so node/edge paint composites cleanly over the producer's
 * background. Node fills remain `#ffffff` (see stylesheet.ts) for label-
 * legibility on arbitrary producer scenes — that's a per-element choice,
 * not a page-level paint. */
body {
  background-color: transparent;
}
```

### New Vitest case (sketch — appended to `mount.test.tsx`)

```tsx
it('renders into a transparent body for OBS browser-source alpha-channel compositing', async () => {
  // `aud_obs_transparency` — the OBS browser source composites the
  // rendered page over the producer's scene via the page's alpha
  // channel. The audience surface's `<body>` is transparent so
  // Cytoscape's naturally-transparent canvas passes through to OBS;
  // node fills stay `#ffffff` (legibility on arbitrary producer scenes)
  // but the page background is `rgba(0, 0, 0, 0)`.
  const i18n = await createI18nInstance('en-US');
  const auth: AuthContextValue = {
    status: 'unauthenticated',
    user: undefined,
    refresh: () => undefined,
    logout: () => undefined,
  };

  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);

  let unmount!: () => void;
  act(() => {
    unmount = mount({
      container,
      auth,
      i18n: i18n as unknown as I18n,
      routerBasePath: '/a',
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
  });

  // Happy-dom serialises `background-color: transparent` as
  // `rgba(0, 0, 0, 0)`. The literal-string match is intentional — any
  // future PR introducing an opaque body paint (e.g. `bg-slate-50`
  // utility, an explicit `#ffffff` rule, a different alpha) surfaces here.
  expect(getComputedStyle(document.body).backgroundColor).toBe('rgba(0, 0, 0, 0)');

  act(() => {
    unmount();
  });
  expect(container.innerHTML).toBe('');
});
```

### Playwright assertion (sketch — appended inside scenario 6 of `audience-live-session.spec.ts`)

```ts
// Inside the existing OBS-dimension scenario (scenario 6 per the
// `aud_session_url` Status block), after the viewport-fill assertion:
//
// `aud_obs_transparency` — the body composites with the producer's
// scene via the alpha channel. The Vitest mount audit pins this at
// the placeholder tier; this assertion extends the pin to the reachable
// graph route under real Chromium. The dimension matrix (720p, 1440p)
// is `aud_tests.aud_obs_render_smoke`'s concern.
const bodyBackgroundColor = await page.evaluate(
  () => getComputedStyle(document.body).backgroundColor,
);
expect(bodyBackgroundColor).toBe('rgba(0, 0, 0, 0)');
```

### Cucumber surface

**No Cucumber scenario.** OBS-source transparency is a UI-CSS property; the server is page-paint-agnostic by construction (no endpoint, projector, or methodology engine inspects client-side compositing). Vitest + Playwright is the correct layer.

### UI-stream e2e policy disposition

**E2e is NOT deferred** — the dimension-sensitive surface (the graph view at `/a/sessions/:sessionId`) IS reachable today via `<AudienceLiveRoute>` (post-`aud_session_url`, 2026-05-27). Per the orchestrator's brief: "When the component IS rendered (even in a disabled / inert state), a thin Playwright spec that asserts component-presence + affordance-state-from-route is better than full deferral."

This leaf adds one new Playwright assertion inline against the existing graph-route spec (`tests/e2e/audience-live-session.spec.ts`, scenario 6). The dimension-matrix iteration across 720p / 1080p / 1440p remains `aud_tests.aud_obs_render_smoke`'s scope (the dedicated multi-dimension leaf, [`tasks/50-audience-and-broadcast.tji:460-464`](../../50-audience-and-broadcast.tji#L460)).

**No new tech-debt leaf is registered here.** The `aud_obs_render_smoke` leaf already exists in the WBS and is sized for the dimension matrix. Its refinement-writer reads this leaf's Status block to inherit the audit predicate and iterates `BROADCAST_DIMENSIONS` over it.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The new CSS rule is a one-line standard CSS property; the new test cases use existing imports.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by exactly **+1** (one new case in `mount.test.tsx`). No existing case regresses. (The Playwright case is not part of `test:smoke`; it runs under the e2e job.)
3. **`pnpm -F @a-conversa/audience build`** green. The audience workspace's library-mode bundle includes the new CSS rule; the built artifact contains `body{background-color:transparent}` (or the minified equivalent) verifiable via `grep -F 'background-color:transparent' dist/audience.css` (or the post-Tailwind-compile equivalent).
4. **`pnpm -F @aconversa/root build`** + **`pnpm -F @a-conversa/moderator build`** + **`pnpm -F @a-conversa/participant build`** all green. The audience-side change does not break peer surfaces (no shell-package change, no cross-surface CSS bleed).
5. **Failing-first verifiability** (per ADR 0022's regression-pin property). Temporarily replacing the new `body { background-color: transparent; }` rule with `body { background-color: white; }` MUST make the new `mount.test.tsx` case fail (happy-dom serialises white as `rgb(255, 255, 255)`, not `rgba(0, 0, 0, 0)`). Independently, the same reversion MUST make the new assertion in `audience-live-session.spec.ts` fail under Playwright. The Implementer confirms both reversions in their verification log before re-applying the transparent rule.
6. **OBS-typical compose E2E smoke** stays green: `make compose-up && pnpm -F @a-conversa/e2e test -- audience-live-session.spec.ts` runs against the production-mode compose stack and the new assertion passes. (The dev-mode happy-dom result and the prod-mode Chromium result agree — Decision §5 documents why.)
7. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf. The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
8. **No new i18n key audit drift** — `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json` have no new `pending` entries from this leaf (no new keys added).
9. **No new ADR** is committed by this leaf (Decision §6). The pre-commit hook's `docs/adr/` check stays green without a new entry.
10. **No file modifications outside the explicit allowlist** in "Files this task touches."
11. **No regression of the existing OBS no-input audit** ([`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md)) or the OBS sizing-defaults audit ([`tasks/refinements/audience/aud_obs_sizing_defaults.md`](aud_obs_sizing_defaults.md)) — all prior Vitest cases in `mount.test.tsx` continue to pass; the new transparency case is independent of (does not interact with) the existing audits.
12. **All six scenarios in `tests/e2e/audience-live-session.spec.ts` continue to pass** under the production-mode compose stack. The new assertion appends to scenario 6 (the OBS-dimension audit); it does NOT introduce a 7th scenario unless Decision §5(B) is taken at implementation time.

## Decisions

### 1. Alpha-channel transparency (`background-color: transparent`), NOT chroma-key

OBS Studio supports two paths for compositing a browser source over a scene:

- **(A — chosen)** The browser source's **alpha channel** is composited natively. Any pixel with alpha < 1 lets the underlying scene show through; any pixel with alpha = 1 occludes it. Zero per-producer setup; perfect-edge compositing on anti-aliased canvas glyphs.
- **(B)** The browser source's pixels are passed through a **chroma-key filter** in OBS Studio. The producer picks a key colour (typically green `#00ff00` or blue `#0000ff`); pixels matching the key colour are treated as transparent. Requires per-producer setup; degrades fringe quality on anti-aliased text and curved edges (the `BROADCAST_NODE_FONT_SIZE_PX = 18` Inter glyphs would key-bleed on every glyph edge — a faint halo of the key colour persists around each character).

This leaf picks (A). Rationale:

1. **Zero-setup is the broadcast-clean ergonomic.** `aud_app_skeleton.md`'s "broadcast-clean" framing and `aud_session_url.md`'s "broadcast-clean: no roster overlay, no connection-status chip, no debug chrome" both reinforce a producer-experience principle: the audience surface should be drop-in. (A) ships drop-in; (B) requires every producer to read the docs, add a chroma-key filter, pick a colour, and tune the threshold.
2. **Anti-aliased glyph fringe matters.** The audience surface uses Inter at `BROADCAST_NODE_FONT_SIZE_PX = 18` per `aud_clean_typography.md` Decision §1. Sub-pixel anti-aliasing produces partially-coloured edge pixels; chroma-key with any reasonable threshold leaves visible artefacts. Alpha-channel compositing has no such artefact (the alpha is exact, not threshold-matched).
3. **Cytoscape's canvas is already transparent by construction.** Cytoscape does not paint a background fill; it composites elements over a transparent canvas. The transparent body lets that natural transparency reach OBS without an intervening opaque layer.

Rejected alternative (B) is documented here so the substitution is auditable. If a producer scenario surfaces where chroma-key is preferred (e.g. legacy OBS deployment without alpha-channel support — unusual but not impossible), the producer can override at the OBS-source "Custom CSS" tier: `body { background-color: #00ff00; }`. The `aud_obs_setup_docs` refinement-writer documents that fallback if needed.

### 2. Tech-debt registration: dimension-matrix transparency pin inherits into `aud_obs_render_smoke`

This leaf pins the **structural** transparency property (the body's computed `background-color` is `rgba(0,0,0,0)`) at two tiers: happy-dom (Vitest) and Chromium-at-1080p (Playwright in `audience-live-session.spec.ts` scenario 6). The dimension-matrix iteration — verifying the property holds at 720p and 1440p as well — is one-leaf-deferred to `aud_tests.aud_obs_render_smoke` ([`tasks/50-audience-and-broadcast.tji:460-464`](../../50-audience-and-broadcast.tji#L460)), the canonical multi-dimension audit leaf.

That leaf already exists in the WBS. **No new tech-debt leaf is registered here.** When `aud_obs_render_smoke`'s refinement-writer picks up the work, they import `BROADCAST_DIMENSIONS` from [`apps/audience/src/graph/layoutOptions.ts`](../../../apps/audience/src/graph/layoutOptions.ts), iterate the three entries, set `page.setViewportSize({ ...BROADCAST_DIMENSIONS.HD_xxx })` for each, and assert `getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'` at each — the same audit predicate this leaf installs, iterated.

This matches the pattern `aud_obs_no_input_required.md` Decision §5 and `aud_obs_sizing_defaults.md` Decision §2 both established: the audit predicate IS the reusable artefact; downstream Playwright tasks import the named selectors.

### 3. Restrict the rule to `body { ... }`, NOT folded into the shared `html, body, #root` reset

Three options:

- **(A — chosen)** New rule `body { background-color: transparent; }` as a separate block immediately after the existing `body { overflow: hidden; }` block. Property colocated with the selector that owns it (Chromium's user-agent default applies the opaque-white at the body level, not at `html` or `#root`); the rule's purpose is self-documenting from its colocation with the existing OBS-context `overflow: hidden` rule.
- **(B)** Fold `background-color: transparent` into the existing `html, body, #root { height: 100%; width: 100%; margin: 0; font-family: var(--font-broadcast); }` rule. Rejected. (i) The other properties on that selector are positional (size, margin, font) — adding `background-color` to the shared selector spreads the OBS-context paint to all three elements, which is wasteful (`html` and `#root` have no UA-default background that needs overriding; the OBS composite reads from `body`). (ii) The shared rule is the responsibility of `aud_app_skeleton`'s reset; a transparency-only rule belongs in its own block, named in its own comment.
- **(C)** Apply at `html { ... }` instead of `body { ... }`. Rejected. The OBS browser-source documentation and the Chromium UA stylesheet both treat the body element as the canonical compositing surface; setting `html { background-color: transparent }` works because the UA default is `transparent` (the body inherits white from a separate UA rule applied to `body` specifically), but the rule has no observable effect until the body's white is also cleared. Pinning the property at `body` is the minimum-blast-radius rule that produces the observable behaviour.

### 4. No Cytoscape canvas-level background override needed

Cytoscape's stylesheet does not paint a background fill on the canvas; the canvas's clear-color is transparent by default. The `<canvas>` element rendered inside `data-testid="audience-graph-root"` has no `style.background`; the wrapping `<div className="h-full w-full">` has no `bg-*` Tailwind utility. Confirmed by reading [`apps/audience/src/graph/GraphView.tsx:208-218`](../../../apps/audience/src/graph/GraphView.tsx#L208) (init block — no `style` property on the Cytoscape config) and [`apps/audience/src/graph/stylesheet.ts`](../../../apps/audience/src/graph/stylesheet.ts) (no selector matching `core` or `*` with a `background-color` directive).

Three options:

- **(A — chosen)** No change to Cytoscape or the container. Transparency at the body level propagates through the (already-transparent) canvas to OBS.
- **(B)** Add a defensive `core { background-color: transparent; }` entry to the Cytoscape stylesheet. Rejected — defensive code without an observable behaviour change. If a future PR introduced a Cytoscape canvas background, the failing test is the Playwright assertion this leaf adds (which checks the body, but a canvas-level paint over the body would surface in the dimension-matrix smoke at `aud_obs_render_smoke` — or, more proximally, the per-state visual-regression in `aud_visual_regression`).
- **(C)** Set the container `<div>`'s background to transparent via Tailwind. Rejected — same observation as (B); the property is already-implicit and adding it defensively dilutes the test pin's specificity.

### 5. Append the Playwright assertion inline to scenario 6, NOT a new 7th scenario

`tests/e2e/audience-live-session.spec.ts` has six scenarios per `aud_session_url`'s Status block. Two options:

- **(A — chosen)** Append the transparency assertion to **scenario 6** (the existing OBS-dimension audit at the graph-route tier). The assertion runs inside the same `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` block, after the existing viewport-fill assertion. Same browser context, same session setup, same scenario shell. ~+10 LOC inside one existing scenario. The scenario's name remains accurate ("OBS dimension audit at graph-route tier") because transparency is a sibling structural property at the same tier — the scenario's purpose generalises from "dimension audit" to "OBS structural-properties audit" (sizing + transparency); a future PR could rename the scenario if/when a third structural property lands.
- **(B)** Add a new 7th scenario "OBS transparency at graph-route tier" with its own `test()` block, fresh context, separate session setup. Cleaner per-scenario naming; isolates the transparency assertion. Costs ~30-40s of additional Playwright wall-clock (the alice-login + create-session sequence is the dominant cost per scenario per `aud_session_url.md` Decision §10).

Decision: (A). The structural-properties scenario is short and the inline-append form keeps the spec file's surface area bounded. If a future leaf adds a third OBS-context structural property (e.g. cursor-hiding for `aud_obs_no_input_required` follow-up work), the scenario can be split at that time — for now, transparency + dimensions ride together. The participant-graph-render precedent (one-scenario-per-concern) is appropriate when concerns are *different behaviours*; here, the concerns are *different observables of the same behaviour* (the audience surface's OBS-context contract).

**Tech-debt note**: NONE. The future split-when-third-property-lands is a YAGNI extraction trigger, not a debt entry.

### 6. No new ADR

This leaf introduces no architectural choice:

- The transparency contract is a one-line CSS property — well-known web platform behaviour for OBS browser-source compositing, not a new convention.
- Decision §1's pick of alpha-channel over chroma-key is a producer-ergonomic choice within the bounds of an existing toolchain (OBS Studio supports both natively); the chosen alternative is the zero-setup default, not a new architectural seam.
- No new dependency, no new module-graph edge, no new test stack, no new file.

An ADR would be over-weight; this refinement is the design record. The `docs/adr/` README's amendment rule applies if a future producer scenario demands chroma-key as the default — at that point the call is an *inversion* worth recording, not the current path.

### 7. Per-element node fills stay `#ffffff` — transparency is page-level, not per-element

[`apps/audience/src/graph/stylesheet.ts:160`](../../../apps/audience/src/graph/stylesheet.ts#L160) hardcodes `'background-color': '#ffffff'` on nodes. Two alternatives surveyed:

- **(A — chosen)** Keep `#ffffff` node fills. Transparency lives at the `<body>` level; node fills are opaque white to provide a high-contrast backdrop for the slate-900 label text. On an arbitrary producer scene (potentially dark, busy, or chroma-uniform), slate-900-on-transparent text would be unreadable; slate-900-on-white nodes are legible regardless.
- **(B)** Make node fills transparent or semi-transparent. Rejected — degrades label legibility on dark producer scenes; would require a per-producer "use dark text" mode (un-scoped); breaks the per-state styling siblings' contracts (`aud_proposed_styling` Decision §6 pins `opacity: 0.6` on proposed nodes/edges over a white backdrop — semi-transparent backdrops would compose with that opacity unpredictably).

The transparency contract this leaf installs operates strictly at the page (`<body>`) level. The per-element-fill question (should the node be transparent so the producer's scene shows through it?) is a substantively different design call; if a future producer scenario demands it, that's a new refinement under `aud_visual_regression` or a new sibling under `aud_graph_rendering`. Not in scope here.

### 8. The audit lives in the existing test files, not in dedicated files

Same rationale as `aud_obs_no_input_required.md` Decision §7 and `aud_obs_sizing_defaults.md` Decision §7: minimum-blast-radius, reuses existing setup, colocates structurally-similar regressions. The new mount-audit case sits in `mount.test.tsx` next to the OBS no-input audit and the OBS sizing audit it complements; the new Playwright assertion sits in `audience-live-session.spec.ts` scenario 6 next to the OBS dimension audit it complements.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- `apps/audience/src/index.css` — new `body { background-color: transparent; }` rule appended after the existing `body { overflow: hidden; }` block, with OBS alpha-channel compositing comment (+13 LOC).
- `apps/audience/src/App.tsx` — OBS transparency invariant comment block added alongside the existing OBS sizing invariant (+15 LOC, zero behaviour change).
- `apps/audience/src/mount.test.tsx` — new Vitest case "renders into a transparent body for OBS browser-source alpha-channel compositing" appended after the full-bleed audit; assertion relaxed to `.toMatch(/^(transparent|rgba\(0, ?0, ?0, ?0\))$/)` to handle happy-dom's `'transparent'` keyword serialisation (+69 LOC).
- `tests/e2e/audience-live-session.spec.ts` — `bodyBackgroundColor` transparency assertion appended inline to scenario 6 (the OBS-dimension audit at the graph-route tier), asserting `'rgba(0, 0, 0, 0)'` under real Chromium at 1080p (+12 LOC).
- Fixer: relaxed Vitest assertion from strict `=== 'rgba(0, 0, 0, 0)'` to regex match — happy-dom preserves the literal `'transparent'` keyword instead of normalising; fix ensures either canonical form passes while still rejecting any opaque value.
- No new tech-debt leaf registered; `aud_tests.aud_obs_render_smoke` (already in WBS) owns the dimension-matrix iteration.
