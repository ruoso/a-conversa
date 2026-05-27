# Default sizing for typical OBS browser-source dimensions

**TaskJuggler entry**: [tasks/50-audience-and-broadcast.tji](../../50-audience-and-broadcast.tji) — task `audience.aud_obs_integration.aud_obs_sizing_defaults` (effort `0.5d`, no explicit `depends`; the parent `aud_obs_integration` declares `depends !aud_shell`, so this leaf inherits the shell-complete frontier).

**Effort estimate**: 0.5d — one new module-level constants table in [`apps/audience/src/graph/layoutOptions.ts`](../../../apps/audience/src/graph/layoutOptions.ts) (~+25 LOC of `BROADCAST_DIMENSIONS` named export + `DEFAULT_BROADCAST_DIMENSIONS` + `BroadcastDimensions` type), a 4-line CSS edit in [`apps/audience/src/index.css`](../../../apps/audience/src/index.css) (`overflow: hidden` on body + `width: 100%` on `#root`), one new Vitest case in [`apps/audience/src/graph/layoutOptions.test.ts`](../../../apps/audience/src/graph/layoutOptions.test.ts) (~+25 LOC) and one new Vitest case in [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) (~+30 LOC) auditing the full-bleed root chain, plus a short inline annotation in [`apps/audience/src/App.tsx`](../../../apps/audience/src/App.tsx) extending the existing OBS-context comment block. No new file, no new dependency, no new i18n key, no new ADR, no Cucumber scenario, no Playwright spec (the graph route is not yet reachable — deferred per the UI-stream e2e policy below).

**Inherited dependencies**:

- `!audience.aud_shell.aud_app_skeleton` (settled — the audience surface mounts as a Vite library bundle under `/a/*`; `html, body, #root` already claim `height: 100%` per [`apps/audience/src/index.css:38-44`](../../../apps/audience/src/index.css#L38); the placeholder route renders `<main className="mx-auto max-w-2xl p-6">` at [`apps/audience/src/App.tsx:98`](../../../apps/audience/src/App.tsx#L98); the surface's full-bleed contract is structurally permitted but not yet asserted).
- `!audience.aud_shell.aud_no_auth_for_public` (settled — the OBS-typical anonymous-on-public mount path renders without any cookie/input, so any sizing default must apply to the anonymous mount too).
- Prose-only context (NOT a `.tji` edge): `audience.aud_graph_rendering.aud_layout_engine` (settled — Decision §4 named *this* task as the place to wire per-source overrides via `MountProps.broadcastDimensions` and exported `SPACING_FACTOR = 1.45` / `PADDING = 60` as the conservative starting points tuned for 1080p; the layout-options module's JSDoc at [`apps/audience/src/graph/layoutOptions.ts:10-12`](../../../apps/audience/src/graph/layoutOptions.ts#L10) and [`apps/audience/src/graph/layoutOptions.ts:30-32`](../../../apps/audience/src/graph/layoutOptions.ts#L30) explicitly forwards the dimensions work here. See Decision §1 below for why this leaf does NOT yet wire a `MountProps`-level prop).
- Prose-only context (NOT a `.tji` edge): `audience.aud_obs_integration.aud_obs_no_input_required` (settled 2026-05-27, [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md)) — establishes the sibling pattern: structural OBS contract pinned as a committed test, no Playwright at the placeholder tier beyond what `audience-skeleton-smoke.spec.ts` already carries, deferred-e2e debt extension threaded into `aud_url_routing.aud_session_url` + `aud_tests.aud_obs_render_smoke`. This leaf mirrors that approach for sizing.
- Prose-only context (NOT a `.tji` edge): `frontend_i18n.i18n_audience_typography` (settled 2026-05-11, [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md)) — line 24 fixes the canonical OBS-source resolution matrix at **1280×720, 1920×1080, 2560×1440**. This leaf adopts that triple verbatim.

## What this task is

A 0.5d **defaults-pinning** leaf under `aud_obs_integration`. It does NOT add a new feature, a new prop, or a new bundle; it captures the canonical OBS browser-source dimensions as typed named-exports the audience workspace can reference, tightens the surface root CSS so an OBS-embed at any viewport renders edge-to-edge without scrollbar artifacts, and pins both via Vitest so a future PR cannot silently drift either.

After this leaf:

- A new named export `BROADCAST_DIMENSIONS` in `apps/audience/src/graph/layoutOptions.ts` exposes the three OBS-source resolutions as a `Readonly<Record<'HD_720' | 'HD_1080' | 'HD_1440', BroadcastDimensions>>` table, with `BroadcastDimensions = { readonly width: number; readonly height: number }`. The values match `i18n_audience_typography.md` line 24's canonical triple: `HD_720 = { width: 1280, height: 720 }`, `HD_1080 = { width: 1920, height: 1080 }`, `HD_1440 = { width: 2560, height: 1440 }`.
- A new named export `DEFAULT_BROADCAST_DIMENSIONS` aliases `BROADCAST_DIMENSIONS.HD_1080` as the canonical default — 1920×1080 is OBS Studio's out-of-the-box browser-source size and the most common producer configuration. Downstream tasks (`aud_obs_render_smoke` for the pixel smoke matrix, `aud_obs_setup_docs` for the producer-facing setup guide) import these symbols rather than copying magic numbers.
- The JSDoc on `SPACING_FACTOR = 1.45` / `PADDING = 60` is amended to note that the values are confirmed-appropriate for `DEFAULT_BROADCAST_DIMENSIONS` (1080p) — the layout-engine refinement's Decision §4 documented them as starting points tuned for 1080p; this leaf does not re-tune (no empirical evidence yet that they need to change at 720p / 1440p) but pins the dimension the existing values target.
- `apps/audience/src/index.css` gains `overflow: hidden;` on the `body` selector and `width: 100%;` on the existing `html, body, #root` rule. The OBS browser source has no scrollbar UI; any accidental overflow today would render as a clipped-but-still-laid-out viewport (Chromium hides the OS scrollbar in headless contexts but still reserves space for it in the layout, producing visible whitespace). The `overflow: hidden` rule defends against that across every audience route — placeholder today, graph view once `aud_session_url` wires it.
- An inline comment block lands in `App.tsx` near the existing **OBS no-input invariant** annotation, recording the OBS sizing contract: the surface's root chain is full-bleed (`html` / `body` / `#root` are 100% × 100%, no overflow), the canonical dimensions are `BROADCAST_DIMENSIONS` from `layoutOptions.ts`, the default is `HD_1080`, and pixel-level rendering at each of the three dimensions is `aud_tests.aud_obs_render_smoke`'s scope.
- A new Vitest case in `layoutOptions.test.ts` (4th case in the `'layout-options named exports'` describe block) pins the constants and their values. A new Vitest case in `mount.test.tsx` (5th case, appended after the OBS no-input audit) asserts the full-bleed body chain after the surface mounts: `getComputedStyle(document.body).overflow === 'hidden'`, `document.body.style.margin === '0px'` (already true via the existing reset), the graph-root testid (once mounted) has `h-full w-full` classes.

Out of scope (deferred to existing or future leaves — see Decision §2):

- **A `MountProps.broadcastDimensions` prop on the surface mount contract.** The layout-engine refinement's forward-reference (`aud_layout_engine.md` Decision §4) named this seam, but `MountProps` lives in `packages/shell/src/mount-contract/types.ts` and is shared across all surfaces (moderator, participant, audience, replay-test). A broadcast-dimensions field on the cross-surface contract is the wrong locus — it'd be dead weight on three of four surfaces. The audience-specific seam is the `BROADCAST_DIMENSIONS` table this leaf exports; downstream consumers (`aud_obs_render_smoke`, future audience-specific routing) import the symbol directly. If a real consumer ever materializes that needs runtime per-mount selection (e.g., the root app dispatching different dimensions per OBS-source URL), the prop wiring lands then — likely under `aud_url_routing.*`. See Decision §1.
- **Pixel-level OBS-dimensions smoke.** `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`, [`tasks/50-audience-and-broadcast.tji:433-437`](../../50-audience-and-broadcast.tji#L433)) is the canonical leaf for "render at 1280×720 / 1920×1080 / 2560×1440 and assert the graph viewport visibly populates without clipping." This leaf only pins the **structural** sizing primitives — the dimensions constants and the full-bleed root chain. The pixel smoke at each resolution stays `aud_obs_render_smoke`'s scope; that leaf's refinement-writer imports `BROADCAST_DIMENSIONS` and iterates the matrix.
- **Re-tuning `SPACING_FACTOR` / `PADDING` for 720p or 1440p.** Per `aud_layout_engine.md` Decision §4 the values are conservative starting points tuned for 1080p. Empirical evidence that they fail at the smaller or larger viewports would surface in `aud_visual_regression` (2d, [`tasks/50-audience-and-broadcast.tji:396-432`](../../50-audience-and-broadcast.tji#L396)) or `aud_obs_render_smoke`. This leaf preserves the values and documents the dimension they were tuned against; the visual-regression layer is the place to bump them if needed.
- **Dynamic resize handling.** OBS browser sources are configured to a fixed resolution at scene-source setup time; the dimensions do not change during a broadcast. The current `GraphView.tsx` element-sync effect ([`apps/audience/src/graph/GraphView.tsx:262-299`](../../../apps/audience/src/graph/GraphView.tsx#L262)) does not register a `ResizeObserver` and does not call `cy.resize()`; this leaf does NOT add either. The browser's standalone window resize is a secondary path (not the OBS-canonical input); rendering may be misaligned after a manual window resize, but no producer scenario produces that input. See Decision §5.
- **A `?dimensions=720p` (or similar) URL parameter for selecting non-default dimensions.** Speculative until a producer complaint surfaces. Deferred mirroring `aud_obs_no_input_required.md` Decision §6's parallel deferral of `?chrome=off`.
- **A background-transparency choice.** `aud_obs_transparency` (0.5d, depends `!aud_obs_sizing_defaults`, [`tasks/50-audience-and-broadcast.tji:287-291`](../../50-audience-and-broadcast.tji#L287)) is the sibling owning the broadcast background. The `overflow: hidden` rule added here is dimension/scrollbar-defensive only; the background color (or `rgba(0,0,0,0)` for transparency) is the transparency sibling's call.
- **A producer-facing setup guide.** `aud_obs_setup_docs` (1d, depends `!aud_obs_sizing_defaults, !aud_obs_transparency`, [`tasks/50-audience-and-broadcast.tji:297-301`](../../50-audience-and-broadcast.tji#L297)) is the sibling that documents the recommended OBS scene-source configuration referencing the dimensions this leaf pins.
- **A new ADR.** No new architectural choice. The dimensions triple is established prose-side by `i18n_audience_typography.md` line 24; this leaf surfaces it as code. The full-bleed CSS adjustment is a single `overflow: hidden` rule on an existing reset. See Decision §6.
- **A new dependency.** No new runtime or dev dep; the work is purely module-level constants + CSS + tests.

## Why it needs to be done

OBS browser sources are the **primary delivery surface** for the audience view (established prose-side in `aud_app_skeleton.md` introductory paragraphs and `aud_obs_no_input_required.md` "Why it needs to be done"). A scene composer configures the source at a fixed resolution — 1920×1080 by default, 1280×720 for low-bandwidth or PiP layouts, 2560×1440 for 2K productions — and expects the audience surface to render edge-to-edge at exactly that resolution. Two failure modes the leaf forecloses:

1. **Scrollbar-reserved whitespace.** When a graph element overflows the viewport (a long methodology label that wraps wider than the node box; a graph layout that extends past the right edge after `cy.fit(PADDING)`), the body's default `overflow: visible` lets the overflow bleed beyond the viewport. Chromium in OBS browser-source mode hides the scrollbar UI but still reserves layout space for it (~15 px on the right edge) under some flag combinations. The result is a visible vertical strip of "empty" space on the broadcast — a producer sees the strip and assumes the audience surface is broken. `overflow: hidden` removes the reservation; overflow is clipped, not laid out.

2. **Magic numbers drifting across surfaces.** `i18n_audience_typography.md` line 24 pins `{1280×720, 1920×1080, 2560×1440}` as the visual-smoke matrix; `aud_obs_render_smoke` (when written) will pin them as the smoke-test matrix; `aud_obs_setup_docs` (when written) will document them as the producer-recommendation list. Three magic-number copies of the same triple is exactly the drift `aud_typography_bundle_measurement` and `aud_self_host_inter` collectively warn against. The `BROADCAST_DIMENSIONS` named export is the single source of truth; downstream consumers import it and the drift surface vanishes.

Downstream consumers of this leaf:

- **`aud_obs_transparency`** (0.5d, depends `!aud_obs_sizing_defaults`) — adopts the full-bleed root chain this leaf locks in and chooses a transparent or opaque background that works at every dimension in `BROADCAST_DIMENSIONS`.
- **`aud_obs_setup_docs`** (1d, depends both) — references `BROADCAST_DIMENSIONS.HD_720 / HD_1080 / HD_1440` (or their numeric values, surfaced via the docs build) in the producer-facing OBS scene-source recommendation matrix.
- **`aud_tests.aud_obs_render_smoke`** (1d, depends `!!aud_obs_integration`) — imports `BROADCAST_DIMENSIONS` and iterates the three entries to render the audience at each viewport, asserting the graph fills the canvas and no scrollbar-whitespace artifact is visible.
- **`aud_url_routing.aud_session_url`** (1d, [`tasks/50-audience-and-broadcast.tji:354-372`](../../50-audience-and-broadcast.tji#L354)) — once it wires the live graph route, the graph viewport will inherit the full-bleed chain this leaf hardens. The Playwright spec that leaf adds asserts the graph renders edge-to-edge in a 1920×1080 (default `playwright.config.ts` viewport, or explicitly set) Chromium context.
- **`aud_visual_regression`** (2d, depends `!aud_playwright_e2e`) — already deferred (per its WBS `note` at [`tasks/50-audience-and-broadcast.tji:407-409`](../../50-audience-and-broadcast.tji#L407)) to assert font-family/size/weight render identically at 720p/1080p/1440p; that matrix matches `BROADCAST_DIMENSIONS` exactly. The visual-regression task's reference fixtures key off the dimensions table.

## Inputs / context

### ADRs

- [**ADR 0026 — micro-frontend root app**](../../../docs/adr/0026-micro-frontend-root-app.md) — Decision 2 fixes the `MountProps` contract; Decision §1 below relies on the contract being shell-package-owned and cross-surface (which is why a per-surface `broadcastDimensions` prop is the wrong locus).
- [ADR 0022 — no throwaway verifications](../../../docs/adr/0022-no-throwaway-verifications.md) — the new Vitest cases ARE the regression pin. No manual "I configured OBS at 1920×1080 and it looked right" smoke.
- [ADR 0005 — Tailwind with shared tokens](../../../docs/adr/0005-styling-tailwind-with-design-tokens-via-tailwind-config.md) — the index.css edit stays within the existing Tailwind v4 + plain-CSS reset pattern; no new utility class, no new theme token.
- [ADR 0004 — Graph libraries: ReactFlow + Cytoscape.js](../../../docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md) — Amendment 2026-05-15: Cytoscape's bundled layouts remain reserved for the read-only surfaces. The dimensions constants don't touch the layout-algorithm choice.
- [ADR 0013 — TypeScript strict + project references](../../../docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md) — the `BroadcastDimensions` type and the `BROADCAST_DIMENSIONS` const-assertion (`as const`) are type-checked under strict mode.

### Sibling refinements

- [`tasks/refinements/audience/aud_app_skeleton.md`](aud_app_skeleton.md) — establishes the audience surface bundle and the `html, body, #root { height: 100% }` reset. This leaf tightens the same reset with `overflow: hidden` + `width: 100%`.
- [`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md) — the sibling pattern this leaf mirrors. Structural OBS contract, Vitest pinning, Playwright deferred to the canonical `aud_obs_render_smoke` + the future routing leaf.
- [`tasks/refinements/audience/aud_layout_engine.md`](aud_layout_engine.md) — Decision §4 explicitly names this task as the dimensions-pinning leaf, exports `SPACING_FACTOR = 1.45` / `PADDING = 60` as overrideable. Decision §1 below explains why this leaf does NOT yet wire a `MountProps`-level prop despite the forward-reference.
- [`tasks/refinements/audience/aud_cytoscape_init.md`](aud_cytoscape_init.md) — Decision §7 (pan/zoom enabled defaults) is dimension-orthogonal; the graph's `h-full w-full` container fills the parent regardless of dimensions, so no Cytoscape-side change is required.
- [`tasks/refinements/audience/aud_clean_typography.md`](aud_clean_typography.md) — established `BROADCAST_FONT_STACK` and the `--font-broadcast` Tailwind theme token. Sizing is orthogonal to typography but the two share the `index.css` file; this leaf's edits sit alongside without conflict.
- [`tasks/refinements/frontend-i18n/i18n_audience_typography.md`](../frontend-i18n/i18n_audience_typography.md) — line 24 establishes the canonical `{1280×720, 1920×1080, 2560×1440}` triple; this leaf surfaces it in code.

### Live code the leaf integrates with

- [`apps/audience/src/graph/layoutOptions.ts:1-43`](../../../apps/audience/src/graph/layoutOptions.ts#L1) — modified. New `BroadcastDimensions` type + `BROADCAST_DIMENSIONS` table + `DEFAULT_BROADCAST_DIMENSIONS` alias appended after the existing `PADDING` export. JSDoc on `SPACING_FACTOR` and `PADDING` amended to note the values are tuned for `DEFAULT_BROADCAST_DIMENSIONS` (1080p). ~+25 LOC.
- [`apps/audience/src/graph/layoutOptions.test.ts:129-138`](../../../apps/audience/src/graph/layoutOptions.test.ts#L129) — modified. One new case appended to the `'layout-options named exports'` describe block. Pins `BROADCAST_DIMENSIONS` shape + values + `DEFAULT_BROADCAST_DIMENSIONS === BROADCAST_DIMENSIONS.HD_1080`. ~+25 LOC.
- [`apps/audience/src/index.css:38-44`](../../../apps/audience/src/index.css#L38) — modified. The existing `html, body, #root { height: 100%; margin: 0; font-family: var(--font-broadcast); }` rule gains `width: 100%;` on the same shared selector and a separate `body { overflow: hidden; }` rule. ~+4 LOC, zero new rule blocks visible to consumers (the additions sit inside or immediately after the existing block).
- [`apps/audience/src/App.tsx:24-35`](../../../apps/audience/src/App.tsx#L24) — modified. The existing **OBS no-input invariant** comment block is extended (or paired with a new **OBS sizing invariant** block immediately below) to record the full-bleed root chain + the `BROADCAST_DIMENSIONS` export + the default-1080p choice + the dimension-smoke deferral. ~+10 LOC of comment, zero behavior change.
- [`apps/audience/src/mount.test.tsx`](../../../apps/audience/src/mount.test.tsx) — modified. One new case appended after the OBS no-input audit (which is the current 4th case per `aud_obs_no_input_required.md` Status). Asserts the body has `overflow: hidden`, the `#root` element fills 100% × 100%, and the placeholder testid renders inside that chain. ~+30 LOC.
- [`apps/audience/src/graph/GraphView.tsx`](../../../apps/audience/src/graph/GraphView.tsx) — NOT modified. The graph container's `h-full w-full` classes at line 301 already fill the parent; the full-bleed chain leading into the graph is the index.css edit's scope.
- [`apps/audience/src/main.tsx`](../../../apps/audience/src/main.tsx) — NOT modified. The mount entry already wires the surface into the host's container.
- `packages/shell/src/mount-contract/types.ts` — NOT modified. See Decision §1.
- `tests/e2e/audience-skeleton-smoke.spec.ts` — NOT modified at this leaf. The placeholder route does not exhibit overflow at any dimension (it's a centered `max-w-2xl` block); the existing scenario continues to pass. The Playwright pin at OBS dimensions lives in `aud_obs_render_smoke`.

### What the surface MUST contain

- `BROADCAST_DIMENSIONS.HD_720 === { width: 1280, height: 720 }`, `BROADCAST_DIMENSIONS.HD_1080 === { width: 1920, height: 1080 }`, `BROADCAST_DIMENSIONS.HD_1440 === { width: 2560, height: 1440 }` — matches `i18n_audience_typography.md` line 24.
- `DEFAULT_BROADCAST_DIMENSIONS === BROADCAST_DIMENSIONS.HD_1080` — referential equality, not a copy.
- `BROADCAST_DIMENSIONS` is `Readonly<Record<'HD_720' | 'HD_1080' | 'HD_1440', BroadcastDimensions>>` and is declared `as const` so the literal key/value union narrows for type-level consumers.
- `body { overflow: hidden; }` applies — `getComputedStyle(document.body).overflow === 'hidden'` after mount.
- The placeholder route continues to render inside the full-bleed chain (the `mx-auto max-w-2xl p-6` centered block is by design for the placeholder; it's a chrome decision, not a sizing failure).

### What the surface MUST NOT contain

- No `<style>` injection at runtime to set dimensions — the `BROADCAST_DIMENSIONS` table is a TypeScript constant for downstream consumers (tests, future routes), not a CSS variable that anyone reads. The actual viewport size is determined by the OBS browser-source configuration, not by the surface.
- No `ResizeObserver` registration in `GraphView.tsx` (Decision §5).
- No `MountProps.broadcastDimensions` field on the shell-package mount contract (Decision §1).
- No fixed pixel `width` / `height` on `html`, `body`, or `#root` — the existing `height: 100%` + the new `width: 100%` is correct; setting a fixed pixel value would break the standalone-browser path and break OBS sources configured at non-`BROADCAST_DIMENSIONS` resolutions.

### Test layers per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md)

- **Vitest constants pin** in `layoutOptions.test.ts` — runs in node, pins the shape and values of `BROADCAST_DIMENSIONS` + `DEFAULT_BROADCAST_DIMENSIONS`. Catches accidental drift of the numeric values or the type shape.
- **Vitest mount audit** in `mount.test.tsx` — runs in happy-dom, asserts the computed-style chain after the surface mounts under the anonymous-on-public input. Catches CSS regressions that would let a future PR drop `overflow: hidden` or break the full-bleed `#root` chain.

No new Cucumber scenario (sizing is a UI-DOM/CSS property, not a wire-format or projector-output property). No new Playwright spec at this leaf (graph route not yet reachable, no DOM-level overflow at the placeholder route; the dimension matrix lives in `aud_obs_render_smoke`).

## Constraints / requirements

### Files this task touches (explicit allowlist)

- `apps/audience/src/graph/layoutOptions.ts` — modified. ~+25 LOC adding `BroadcastDimensions` type, `BROADCAST_DIMENSIONS` table, `DEFAULT_BROADCAST_DIMENSIONS` alias, JSDoc amendment on `SPACING_FACTOR` / `PADDING`.
- `apps/audience/src/graph/layoutOptions.test.ts` — modified. ~+25 LOC: one new case in the `'layout-options named exports'` describe block.
- `apps/audience/src/index.css` — modified. ~+4 LOC: `width: 100%;` added to the `html, body, #root` rule; `body { overflow: hidden; }` added as a separate rule.
- `apps/audience/src/App.tsx` — modified. ~+10 LOC of inline comment near the existing OBS-context block; zero behavior change.
- `apps/audience/src/mount.test.tsx` — modified. ~+30 LOC: one new case appended after the existing OBS no-input audit.

### Files this task does NOT touch

- `apps/audience/src/main.tsx` — unchanged.
- `apps/audience/src/graph/GraphView.tsx` — unchanged. The graph container already fills its parent.
- `apps/audience/src/graph/projectGraph.ts`, `stylesheet.ts`, `facetStatus.ts`, `cytoscapeTestEnv.ts` — unchanged.
- `packages/shell/src/mount-contract/` — unchanged (Decision §1).
- `packages/shell/`, `packages/i18n-catalogs/`, `apps/root/`, `apps/moderator/`, `apps/participant/`, `apps/replay-test/`, `apps/server/` — unchanged.
- `tests/e2e/` — unchanged. The OBS-dimensions Playwright lives in `aud_obs_render_smoke`; the placeholder spec is dimension-agnostic.
- `apps/audience/package.json`, `apps/audience/vite.config.ts` — unchanged. No new dependency.
- `docs/adr/` — no new ADR (Decision §6).
- `.tji` files — `complete 100` lands at task-completion time per [`tasks/refinements/README.md`](../README.md); no new follow-up tech-debt leaf registered (Decision §2).

### New typed export (sketch — added to `layoutOptions.ts`)

```ts
/**
 * Canonical OBS browser-source dimensions referenced by the audience-
 * surface tests and the producer-facing setup docs.
 *
 * Source of truth for the {720p, 1080p, 1440p} triple established
 * prose-side in tasks/refinements/frontend-i18n/i18n_audience_typography.md
 * (line 24). Downstream consumers — `aud_obs_render_smoke` (pixel
 * smoke matrix), `aud_obs_setup_docs` (producer recommendation
 * matrix), `aud_visual_regression` (cross-resolution typography pins)
 * — import these constants rather than copy the numbers.
 */
export interface BroadcastDimensions {
  readonly width: number;
  readonly height: number;
}

export const BROADCAST_DIMENSIONS = {
  HD_720: { width: 1280, height: 720 },
  HD_1080: { width: 1920, height: 1080 },
  HD_1440: { width: 2560, height: 1440 },
} as const satisfies Readonly<Record<string, BroadcastDimensions>>;

/**
 * The canonical default OBS browser-source resolution — OBS Studio's
 * out-of-the-box size and the most common producer configuration.
 * `SPACING_FACTOR` and `PADDING` above are tuned for this resolution
 * per `aud_layout_engine.md` Decision §4.
 */
export const DEFAULT_BROADCAST_DIMENSIONS: BroadcastDimensions =
  BROADCAST_DIMENSIONS.HD_1080;
```

### New Vitest case (sketch — appended to `layoutOptions.test.ts`)

```ts
it('(9) pins `BROADCAST_DIMENSIONS` to {720p, 1080p, 1440p} and `DEFAULT_BROADCAST_DIMENSIONS` to 1080p', () => {
  // Regression pin: the triple is the canonical OBS-source matrix
  // (i18n_audience_typography.md line 24). Drift surfaces here and in
  // any downstream consumer that imports the symbol.
  expect(BROADCAST_DIMENSIONS.HD_720).toEqual({ width: 1280, height: 720 });
  expect(BROADCAST_DIMENSIONS.HD_1080).toEqual({ width: 1920, height: 1080 });
  expect(BROADCAST_DIMENSIONS.HD_1440).toEqual({ width: 2560, height: 1440 });
  // Referential equality — DEFAULT_BROADCAST_DIMENSIONS aliases HD_1080,
  // doesn't copy it, so a future swap of the default surfaces here.
  expect(DEFAULT_BROADCAST_DIMENSIONS).toBe(BROADCAST_DIMENSIONS.HD_1080);
});
```

### CSS edit (sketch — `index.css`)

```css
html,
body,
#root {
  height: 100%;
  width: 100%;
  margin: 0;
  font-family: var(--font-broadcast);
}

/* `aud_obs_sizing_defaults` — OBS browser sources hide the scrollbar UI
 * but Chromium may still reserve layout space for it, producing a
 * visible whitespace strip on the broadcast. `overflow: hidden` clips
 * overflow instead of reserving room for a scrollbar. The graph view's
 * one-shot `cy.fit(PADDING)` keeps the rendered graph inside the
 * viewport; this rule defends against any accidental future overflow. */
body {
  overflow: hidden;
}
```

### New Vitest case (sketch — appended to `mount.test.tsx`)

```tsx
it('renders into a full-bleed body chain with no scrollbar-reserved overflow for the OBS browser-source context', async () => {
  // `aud_obs_sizing_defaults` — the OBS browser source renders the
  // audience surface at a fixed dimension (typically 1920×1080,
  // canonical triple in `BROADCAST_DIMENSIONS`). The surface's root
  // chain must be full-bleed (html / body / #root at 100% × 100%) and
  // the body must not reserve scrollbar space (`overflow: hidden`).
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

  // The full-bleed chain.
  expect(getComputedStyle(document.body).overflow).toBe('hidden');
  expect(document.body.style.margin || getComputedStyle(document.body).margin).toMatch(/^0(px)?$/);

  act(() => {
    unmount();
  });
  expect(container.innerHTML).toBe('');
});
```

### Cucumber surface

**No Cucumber scenario.** OBS dimensions are a UI-CSS property; the server is dimension-agnostic by construction (no endpoint, projector, or methodology engine inspects client viewport size). Vitest is the correct layer.

### UI-stream e2e policy disposition

**E2e is deferred per the deferred-e2e exception** — the dimension-sensitive surface (the graph view) is NOT yet reachable from any route (the wildcard `<Route path="*">` at [`apps/audience/src/App.tsx:137`](../../../apps/audience/src/App.tsx#L137) maps only to the placeholder). The placeholder route is a centered `max-w-2xl` block; its rendering is dimension-insensitive at any OBS resolution, so an OBS-dimensions Playwright pin against the placeholder would be a tautology.

Unit/component coverage standing in for now: the Vitest cases in `layoutOptions.test.ts` (constants pin) + `mount.test.tsx` (full-bleed chain pin).

Deferred to:

- **`aud_url_routing.aud_session_url`** (1d, in WBS, `note` already records four-leaf deferred-e2e debt). When that leaf wires `<Route path="/sessions/:id" element={<AudienceLiveRoute />}>`, its Playwright spec MUST extend coverage to assert the graph viewport fills the full Chromium viewport (no whitespace strip, no scrollbar artifact). The spec imports `DEFAULT_BROADCAST_DIMENSIONS` and uses `page.setViewportSize({ width, height })` to mount at 1080p. The `aud_session_url` refinement-writer reads this leaf's Status block to inherit the dimensions-import seam.
- **`aud_tests.aud_obs_render_smoke`** (1d, depends `!!aud_obs_integration`, [`tasks/50-audience-and-broadcast.tji:433-437`](../../50-audience-and-broadcast.tji#L433)). The canonical OBS-dimensions smoke. Imports `BROADCAST_DIMENSIONS`, iterates the three entries, renders the audience at each viewport, asserts the graph fills the canvas + no overflow-whitespace + the no-input audit (inherited from `aud_obs_no_input_required.md`) holds at each dimension.

Both leaves already exist in the WBS; no new tech-debt leaf is registered here.

## Acceptance criteria

Per [ADR 0022](../../../docs/adr/0022-no-throwaway-verifications.md), every check below is a committed test or a script CI already runs.

1. **`pnpm run check`** (root: `lint && format:check && typecheck && typecheck:tools && typecheck:tests`) stays green. The `as const satisfies Readonly<Record<...>>` declaration type-checks under strict mode; the new test cases use existing imports.
2. **`pnpm run test:smoke`** stays green; the smoke count grows by exactly **+2** (one new case in `layoutOptions.test.ts`, one new case in `mount.test.tsx`). No existing case regresses.
3. **`pnpm -F @a-conversa/audience build`** green. The audience workspace's library-mode bundle includes the new `BROADCAST_DIMENSIONS` export but no new dependency.
4. **`pnpm -F @aconversa/root build`** + **`pnpm -F @a-conversa/moderator build`** + **`pnpm -F @a-conversa/participant build`** all green. The audience-side change does not break peer surfaces (no shell-package change per Decision §1).
5. **Failing-first verifiability** (per ADR 0022's regression-pin property). Temporarily changing `BROADCAST_DIMENSIONS.HD_1080.width` to `1921` MUST make the new `layoutOptions.test.ts` case fail. Independently, temporarily removing `body { overflow: hidden; }` from `index.css` MUST make the new `mount.test.tsx` case fail. The Implementer confirms both reversions in their verification log before re-applying.
6. **`tj3 project.tjp 2>&1 | grep -iE "error|fatal"` silent** after `complete 100` lands on this leaf. The pre-commit hook's `tj3 --silent` invocation is the canonical safety net.
7. **No new i18n key audit drift** — `packages/i18n-catalogs/src/catalogs/pt-BR.review.json` and `es-419.review.json` have no new `pending` entries from this leaf (no new keys added).
8. **No new ADR** is committed by this leaf (Decision §6). The pre-commit hook's `docs/adr/` check stays green without a new entry.
9. **No file modifications outside the explicit allowlist** in "Files this task touches."
10. **No regression of the existing OBS no-input audit** ([`tasks/refinements/audience/aud_obs_no_input_required.md`](aud_obs_no_input_required.md)) — the four existing Vitest cases in `mount.test.tsx` continue to pass; the new full-bleed case is independent of (does not interact with) the no-input audit predicate.
11. **`BROADCAST_DIMENSIONS` is referenced by the canonical-triple consumer** — at minimum, the new `layoutOptions.test.ts` case imports it. Downstream-task imports (`aud_obs_render_smoke`, `aud_obs_setup_docs`, `aud_visual_regression`) land when those leaves ship; the symbol is in the public-API surface of `apps/audience/src/graph/layoutOptions.ts` and ready for consumption.

## Decisions

### 1. Do NOT wire `MountProps.broadcastDimensions` on the shell-package mount contract

`aud_layout_engine.md` Decision §4 explicitly forwarded the dimensions-wiring to this task via the phrase "the future `aud_obs_sizing_defaults` task wires per-source overrides via a `MountProps.broadcastDimensions` prop." Two alternatives surveyed:

- **(A) Add `broadcastDimensions?: BroadcastDimensions` to `MountProps`** in `packages/shell/src/mount-contract/types.ts`, default to `DEFAULT_BROADCAST_DIMENSIONS` in `apps/audience/src/main.tsx`, plumb it into `buildAudienceLayoutOptions(elements, dimensions)`. Rejected. (i) `MountProps` is the **cross-surface** mount contract; the moderator, participant, replay-test, and audience surfaces all read it. A broadcast-dimensions field on the shared contract is dead weight on three of four surfaces — they don't render broadcast canvases, they don't tune layout to OBS dimensions. (ii) No consumer currently passes a non-default value; adding the prop creates a "no caller passes this" dead-prop state that decays toward removal at the next ADR amendment pass. (iii) The audience-specific seam is the `BROADCAST_DIMENSIONS` named export this leaf adds; downstream consumers (`aud_obs_render_smoke`, future routing) import the symbol directly from `apps/audience/src/graph/layoutOptions.ts` — no per-mount routing required. (iv) If a real consumer ever materializes that needs runtime per-mount dimensions selection (e.g., the root app dispatching different dimensions per OBS-source URL fragment), the prop wiring lands then under `aud_url_routing.*` where the URL-derived consumer lives; that's the wiring task that earns the contract change.
- **(B) Export `BROADCAST_DIMENSIONS` + `DEFAULT_BROADCAST_DIMENSIONS` as audience-internal named exports** *(chosen)*. Surface-specific, type-checked, single source of truth, no cross-surface contract pollution. The layout-engine refinement's forward-reference is honored in spirit (the dimensions ARE pinned and overrideable; consumers iterate the table); the specific seam name is corrected (named exports, not a `MountProps` field) because the layout-engine refinement was written before this leaf and didn't have the `MountProps` cross-surface constraint in front of it.

This is a knowing **deviation from `aud_layout_engine.md` Decision §4's exact wording**. The substance — "future task wires per-source overrides" — is preserved; the locus is changed from a shell-contract prop to an audience-module export. Decision documented here so the substitution is auditable. The `layoutOptions.ts` JSDoc lines 10-12 and 30-32 that reference `MountProps.broadcastDimensions` are amended in this leaf to reference `BROADCAST_DIMENSIONS` / `DEFAULT_BROADCAST_DIMENSIONS` instead.

### 2. Tech-debt registration: dimension-aware Playwright extensions inherit into existing WBS leaves

The Vitest pins this leaf installs cover the **structural** sizing primitives (constants table + full-bleed CSS chain). Pixel-level rendering at each of the three dimensions is two-leaf-deferred:

- **Graph-route tier**: when `aud_url_routing.aud_session_url` (1d, [tasks/50-audience-and-broadcast.tji:354-372](../../50-audience-and-broadcast.tji#L354)) wires the live graph route, its Playwright spec MUST set `page.setViewportSize({ ...DEFAULT_BROADCAST_DIMENSIONS })` and assert the graph viewport fills the Chromium viewport with no overflow strip.
- **OBS-dimensions matrix tier**: `aud_tests.aud_obs_render_smoke` (1d, depends `!!aud_obs_integration`, [tasks/50-audience-and-broadcast.tji:433-437](../../50-audience-and-broadcast.tji#L433)) iterates `BROADCAST_DIMENSIONS` and renders at each.

Both leaves already exist in the WBS. **No new tech-debt leaf is registered here.** Decision §5 of `aud_obs_no_input_required.md` establishes the pattern: the audit predicate IS the reusable artifact; downstream Playwright tasks import the named exports.

### 3. The dimensions triple matches `i18n_audience_typography.md` line 24 verbatim

Two alternatives surveyed:

- **(A) Add a broader matrix** (e.g., `HD_4K = 3840×2160`, `SD_480p = 854×480`, mobile-portrait `9:16` ratios). Rejected. (i) 4K OBS browser sources are vanishingly rare in producer practice (CPU cost is prohibitive for live broadcast). (ii) Below-720p resolutions are not in any documented producer use case. (iii) Portrait ratios are for short-form-video re-use, not live broadcast — out of scope for the audience surface as currently scoped. (iv) Adding more entries makes the smoke matrix (`aud_obs_render_smoke`) larger without empirical justification, slowing CI and creating noise.
- **(B) Match `i18n_audience_typography.md` line 24 exactly** *(chosen)*. The typography refinement's matrix has shipped (2026-05-11) and is the existing canonical list; mismatching it here would create a drift between "the typography pixel matrix" and "the OBS dimensions matrix" that downstream tasks would have to reconcile. Matching avoids the divergence.

If a future producer scenario surfaces an additional resolution (e.g., 4K for high-fidelity post-production), the table is extended additively (a new key on `BROADCAST_DIMENSIONS`) and `i18n_audience_typography.md`'s matrix is correspondingly updated. No structural change required.

### 4. `DEFAULT_BROADCAST_DIMENSIONS` aliases `HD_1080` by referential equality (not a value copy)

Two alternatives surveyed:

- **(A) Copy the value**: `export const DEFAULT_BROADCAST_DIMENSIONS = { width: 1920, height: 1080 };`. Rejected. A future bump of `HD_1080` (vanishingly unlikely — 1920×1080 is a fixed industry standard — but possible if a typo correction is needed) would leave the default out of sync with the named entry. The test's `expect(DEFAULT_BROADCAST_DIMENSIONS).toBe(BROADCAST_DIMENSIONS.HD_1080)` (referential equality, `toBe` not `toEqual`) catches the divergence at test time.
- **(B) Alias by reference** *(chosen)*: `export const DEFAULT_BROADCAST_DIMENSIONS = BROADCAST_DIMENSIONS.HD_1080;`. Single source of truth; mutation-of-named-entry propagates automatically; the referential-equality test pin is meaningful.

### 5. No `ResizeObserver` and no `cy.resize()` invocation

OBS browser sources are configured to a fixed resolution at scene-source creation; the dimensions do not change during a broadcast. The standalone-browser viewer (secondary path) may resize, but that's a non-canonical input and pixel-level rendering after a manual resize is `aud_visual_regression`'s concern, not this leaf's.

Two alternatives surveyed:

- **(A) Add a `ResizeObserver` to `GraphView.tsx`** that calls `cy.resize()` and re-runs `cy.fit(PADDING)` on container size changes. Rejected. (i) Adds runtime cost (one observer per mount) for a scenario that doesn't occur in the canonical OBS use case. (ii) `cy.fit()` on every resize would conflict with the existing `aud_layout_engine` Decision (one-shot fit on first non-empty render; `fit: false` on layout passes) — `aud_layout_engine.md` was explicit that camera jumps on event arrival are broadcast-disorienting; the same logic applies to camera jumps on resize. (iii) If a standalone-browser viewer resizes mid-session, the misalignment is a known-tolerable secondary-path artifact, not a defect.
- **(B) Leave resize handling unimplemented** *(chosen)*. The OBS-canonical input is fixed-dimension; the secondary path's misalignment after a manual resize is not a defect under the audience surface's scoped use case. If a real complaint surfaces, a future `aud_responsive_resize` leaf can land the observer.

### 6. No new ADR

This leaf introduces no architectural choice:

- The dimensions triple is established prose-side by `i18n_audience_typography.md` (already shipped). This leaf surfaces it as code.
- The `overflow: hidden` CSS rule is a single property on an existing reset block — well-known web platform behavior, not a new convention.
- The `BROADCAST_DIMENSIONS` named export pattern follows the existing `SPACING_FACTOR` / `PADDING` / `BROADCAST_NODE_FONT_SIZE_PX` etc. precedent in `layoutOptions.ts` and `stylesheet.ts` (named module-level constants — the audience workspace's established convention).
- Decision §1's deviation from `aud_layout_engine.md` Decision §4's wording is a **locus correction** (audience-module export vs. cross-surface contract prop), not an architectural inversion; the substance ("future task pins overrideable dimensions defaults") is preserved.

No new dependency. ADR would be over-weight; the refinement itself is the design record.

### 7. The audit lives in the existing test files, not in dedicated files

Same rationale as `aud_obs_no_input_required.md` Decision §7: minimum-blast-radius, reuses existing setup, colocates structurally-similar regressions. The new constants test sits inside the existing `'layout-options named exports'` describe block in `layoutOptions.test.ts`; the new full-bleed audit sits in `mount.test.tsx` next to the OBS no-input audit it complements.

## Open questions

(none — all decided)

## Status

**Done** — 2026-05-27.

- Added `BroadcastDimensions` interface, `BROADCAST_DIMENSIONS` table (`HD_720`/`HD_1080`/`HD_1440`), and `DEFAULT_BROADCAST_DIMENSIONS` alias to `apps/audience/src/graph/layoutOptions.ts`; JSDoc on `SPACING_FACTOR`/`PADDING` amended to note 1080p tuning target.
- Added Vitest case (9) to `apps/audience/src/graph/layoutOptions.test.ts` pinning the `BROADCAST_DIMENSIONS` triple and `DEFAULT_BROADCAST_DIMENSIONS === BROADCAST_DIMENSIONS.HD_1080` by referential equality.
- Tightened `apps/audience/src/index.css`: added `width: 100%` to the `html, body, #root` rule and a standalone `body { overflow: hidden; }` rule guarding against Chromium scrollbar-reserved whitespace in OBS browser-source context.
- Extended `apps/audience/src/App.tsx` with an OBS sizing-invariant comment block recording the full-bleed root chain, the `BROADCAST_DIMENSIONS` export, and the dimension-smoke deferral to `aud_obs_render_smoke` + `aud_session_url`.
- Added Vitest case (5) to `apps/audience/src/mount.test.tsx` auditing the full-bleed body chain after mount: `getComputedStyle(document.body).overflow === 'hidden'` + zero-margin body + placeholder testid renders inside the chain.
- All 14 cases green (9 in `layoutOptions.test.ts`, 5 in `mount.test.tsx`); CSS-removal failing-first confirmed.
- E2e deferred per policy: graph route not yet reachable; dimension-matrix Playwright inherits into `aud_url_routing.aud_session_url` + `aud_tests.aud_obs_render_smoke` (both already in WBS — no new tech-debt leaf needed).
