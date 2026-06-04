# Refinement — `landing_page.walkthrough_demo_stepper`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:117-129`
(`task landing_page.walkthrough_demo_stepper`). Gates milestone M8-landing:
the downstream content/polish leaves all hang off it
(`walkthrough_demo_narration`, `landing_demo_mobile_fallback`,
`landing_responsive_a11y`, and the terminal `landing_e2e` — see
`tasks/47-landing-page.tji:131-179`).

## Effort estimate

`3d` (from the `.tji` block).

## Inherited dependencies

`depends !extract_readonly_graph_package, !landing_walkthrough_seed`. Both
predecessors are **Done (2026-06-03)**; everything this task builds on is on
disk and green.

**Settled by `extract_readonly_graph_package`**
(`tasks/refinements/landing_page/extract_readonly_graph_package.md`):

- **The renderer is a shared package.** `@a-conversa/graph-view` exists at
  `packages/graph-view/`; `apps/root` can consume it (apps cannot import each
  other — ADR 0026 — so the package boundary is the only way the landing demo
  gets the audience renderer).
- **Props-in, store-agnostic API.** `GraphView`'s public contract is
  `{ events: readonly Event[]; instanceKey: string; activeDiagnostics?:
  ReadonlyMap<string, DiagnosticPayload>; cyRef?: (cy: Core | null) => void }`
  (`packages/graph-view/src/GraphView.tsx:343-374`). It reads **no** store, WS,
  or session — the sole data source is the `events` prop
  (`packages/graph-view/src/GraphView.tsx:344-351`). A read-only consumer with
  no live diagnostic stream **omits** `activeDiagnostics`
  (`GraphView.tsx:333-341`, `EMPTY_ACTIVE_DIAGNOSTICS`).
- **`cyRef` is the sole observability seam.** The package deliberately exposes
  **no** `window.__aConversa*CyInstance` global (`GraphView.tsx:366-373`); the
  `cyRef` callback fires with the Cytoscape `Core` on mount, `null` on unmount.
- **Framing ships as the broadcast default, with an override seam.**
  `GraphView` lays out per render via `buildAudienceLayoutOptions(elements)`
  with `fit: false` and a **one-shot first-render auto-fit**
  (`GraphView.tsx:526`, `:533-541`); `PADDING`,
  `BROADCAST_DIMENSIONS`/`DEFAULT_BROADCAST_DIMENSIONS`, and the broadcast font
  constants are named package exports (`packages/graph-view/src/index.ts:14-40`).
  The root wrapper is `relative h-full w-full` — the renderer fills whatever
  container the host sizes (`GraphView.tsx:545-546`). Extract Decision §4
  explicitly left the non-broadcast framing override "for the landing demo to
  use later" — **this is that later**.

**Settled by `landing_walkthrough_seed`**
(`tasks/refinements/landing_page/landing_walkthrough_seed.md`):

- **The seed is a typed prod module.** `apps/root/src/walkthrough/index.ts`
  exports `walkthroughEvents: readonly Event[]` (266 events, the full "Should
  zoos exist?" log, canonical order) — both a named and a **default** export so
  it is `await import()`-friendly
  (`apps/root/src/walkthrough/index.ts:71-84`). The outer envelope is already
  normalized to the camelCase `Event` shape `GraphView` consumes, so it passes
  **straight to the `events` prop with no cast** at the call site. A drift guard
  + `validateEvent` sweep pin the copy (`apps/root/src/walkthrough/index.test.ts`).
- **`@a-conversa/shared-types` is already a direct `apps/root` dependency**
  (promoted by the seed task) — the `Event` type resolves non-phantom.

**Pending:** none.

## What this task is

Build the interactive walkthrough demo — the centrepiece of the public landing
page — and embed it on `/`. The component loads the seed event log and lets a
visitor **step / scrub** through it: at each scrubber position `pos` it feeds
`walkthroughEvents.slice(0, pos)` to the shared `@a-conversa/graph-view`
`GraphView`, which projects and re-renders the graph for that prefix. Controls:
previous / next (single-event step), a range scrubber (jump to any position),
and an optional play / pause auto-advance. No server, no auth, no session, no
replay endpoints, no live diagnostics — a self-contained client component over
a frozen asset (`tasks/47-landing-page.tji:14-20`, the architecture note).

Scope boundaries with the sibling tasks:

- **Per-step captions / narration copy** are **not** here — they are
  `walkthrough_demo_narration` (`tasks/47-landing-page.tji:131-141`), driven by
  the `walkthrough_narration_script` beats. This task renders the graph + the
  control chrome; it leaves a clean seam (current position + the event at that
  position) for narration to hang captions on.
- **Small-screen / reduced demo mode** is `landing_demo_mobile_fallback`
  (`tasks/47-landing-page.tji:143-154`); this task builds the full interactive
  demo and the desktop-first layout.
- **Whole-page responsive + a11y polish** is `landing_responsive_a11y`
  (`tasks/47-landing-page.tji:156-167`); this task ships keyboard-operable
  controls and the reduced-motion default for auto-advance, but the
  cross-breakpoint layout pass is downstream.

## Why it needs to be done

The landing page is built around "a walkthrough of what it looks like"
(`tasks/47-landing-page.tji:117-128`). Both predecessors exist **specifically**
to unblock this component: the renderer was extracted into a shared package so
`apps/root` could mount it, and the seed was shipped as a prod asset so the
demo had a production-safe event log. This is the task that finally renders a
real debate graph on the public surface — replacing the developer placeholder
that must not ship to production (`tasks/47-landing-page.tji:9-12`). It is the
last structural piece before the landing milestone's content/polish leaves
(narration, mobile fallback, responsive/a11y) and the terminal `landing_e2e`
can run, and M8-landing gates M9 (Deployment).

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:117-129` (this task);
  architecture note `tasks/47-landing-page.tji:14-20`.
- **Consumer contract (the renderer):**
  - `packages/graph-view/src/index.ts:12` — `export { GraphView, type
    GraphViewProps }`.
  - `packages/graph-view/src/GraphView.tsx:343-374` — `GraphViewProps`
    (`events`, `instanceKey`, optional `activeDiagnostics`, optional `cyRef`).
  - `packages/graph-view/src/GraphView.tsx:526`, `:533-541` — the per-render
    layout + one-shot fit (`fit: false` thereafter): the behavior this task's
    re-fit decision works around.
  - `packages/graph-view/src/GraphView.tsx:544-546` — root wrapper
    `relative h-full w-full` (host sizes the container).
  - `packages/graph-view/src/index.ts:26` — `PADDING` export (used by the
    demo's re-fit call; see Decision §3).
- **The seed:** `apps/root/src/walkthrough/index.ts:71-84` — `walkthroughEvents:
  readonly Event[]` (named + default export); 266 events; envelope already
  camelCase-normalized so it is a drop-in `events` value.
- **Embed site:** `apps/root/src/routes/LandingRoute.tsx:32-57` — the public `/`
  marketing `<main data-testid="route-landing">` (today a placeholder card);
  this is where the demo mounts. The route is anonymous-facing post
  `split_public_and_home_routes` (Done): authenticated visitors are bounced to
  `/home` before the marketing body renders (`LandingRoute.tsx:28-30`), so the
  demo only ever renders for anonymous visitors.
- **apps/root i18n wiring:** `apps/root/src/main.tsx` wraps the app in
  `@a-conversa/shell`'s `<I18nProvider>` bound to the **full** shared catalog
  (all namespaces via `buildInitOptions`), so `useTranslation()` resolves
  everywhere under `App`. The renderer's `methodology.kind.*` /
  `methodology.edgeRole.*` labels (`packages/i18n-catalogs/src/catalogs/en-US.json:35-123`)
  are therefore available to the demo **for free** — no extra registration.
- **apps/root dependency wiring (what to add):**
  `apps/root/package.json` dependencies (currently `@a-conversa/i18n-catalogs`,
  `@a-conversa/shared-types`, `@a-conversa/shell`, react, react-dom,
  react-router-dom — all `workspace:*` for the @a-conversa ones) and
  `apps/root/tsconfig.json` `references`
  (`../../packages/{i18n-catalogs,shared-types,shell}`). Add
  `@a-conversa/graph-view` to both (extract constraint §5 left this consumption
  wiring to this task).
- **i18n catalog workflow (for the control-chrome strings):**
  `tasks/refinements/frontend-i18n/i18n_catalog_workflow.md` — en-US authored
  first; pt-BR / es-419 machine-translated with a **PENDING review tracker** in
  the sibling `*.review.json` files
  (`packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json`, a `pending`
  array of dotted keys; the parity check ignores `*.review.json`).
  `scripts/check-parity.ts` enforces key-set parity across the three primary
  catalogs.
- **Playwright e2e layout:** specs live in `tests/e2e/*.spec.ts`, run against a
  running compose stack (`playwright.config.ts`, `baseURL`
  `http://localhost:3000`; CI owns `make up`/`make down-v`). Pattern reference:
  `tests/e2e/auth-flow.spec.ts` (header narrative + scenarios; scenario 5
  already drives anonymous `/`). ADR 0008 (Playwright as the e2e layer).
- **ADRs:** 0039 (the graph-view package boundary — props-in, no store);
  0026 (root-app micro-frontend, route table ownership, no cross-app import);
  0004 (Cytoscape for read-only surfaces); 0024 (react-i18next + ICU);
  0027 (propose-time rendering); 0008 (Playwright); 0022 (no throwaway
  verifications).
- **Predecessor refinements:**
  `tasks/refinements/landing_page/extract_readonly_graph_package.md`,
  `tasks/refinements/landing_page/landing_walkthrough_seed.md`,
  `tasks/refinements/landing_page/split_public_and_home_routes.md`.

## Constraints / requirements

1. **Self-contained client component.** No server call, no auth, no session, no
   WS, no replay endpoint, no `@a-conversa/test-fixtures` import. The only data
   source is the seed module (`apps/root/src/walkthrough/index.ts`); the only
   renderer is `@a-conversa/graph-view`. `activeDiagnostics` is **omitted**
   (the demo has no live diagnostic stream).
2. **Projects a prefix per position.** At scrubber position `pos ∈ [0, N]`
   (`N = walkthroughEvents.length`, 266) the component renders
   `walkthroughEvents.slice(0, pos)` through `GraphView`. Stepping forward grows
   the graph monotonically; scrubbing backward shrinks it; the rendered graph at
   any `pos` is exactly the projection of that prefix (no demo-side reordering,
   filtering, or content mutation of the seed).
3. **Controls.** Previous / next (single-event step, disabled at the `0` / `N`
   bounds), a range scrubber bound to `pos` (jump to any position), and an
   optional play / pause auto-advance. All controls are real keyboard-operable
   buttons / a native range input (focusable, Enter/Space-activated, labelled);
   no div-with-onClick affordances.
4. **Add `@a-conversa/graph-view` as a direct `apps/root` dependency**
   (`package.json` `workspace:*` + `tsconfig.json` project reference), mirroring
   the existing `@a-conversa/shell` wiring. No phantom dependency; no cross-app
   import (ADR 0026).
5. **Keep the growing graph framed.** As the prefix grows, later nodes must stay
   in view — the package's one-shot-fit-then-`fit:false` default would leave the
   camera zoomed on the tiny first prefix and let later nodes drift off-frame.
   The demo keeps the graph fit **without forking the renderer or adding a
   package prop** (see Decision §3).
6. **Reduced-motion respected for auto-advance.** Auto-advance defaults to
   **paused**, and when `prefers-reduced-motion: reduce` is set the component
   does not auto-play (the visitor still steps manually). The whole-page motion
   audit is `landing_responsive_a11y`; this is the demo's own baseline.
7. **A machine-readable position seam.** The component exposes the current
   position as observable DOM (a step-status element, e.g.
   `data-testid="walkthrough-step-status"`, carrying the 1-based position and
   total) so tests can assert advancement without reading the Cytoscape canvas,
   and so `walkthrough_demo_narration` has a stable hook to render the caption
   for the current beat. The component also accepts an optional
   `onPositionChange(pos, event)` (or equivalent) callback seam for narration —
   shaped now, consumed later; default no-op.
8. **Control-chrome strings localized via the catalog workflow.** Button / aria
   labels (previous, next, play, pause, scrubber label, step-status text) are
   new keys authored en-US under a `landing.demo.*` namespace, with machine
   pt-BR / es-419 + **PENDING** entries in the `*.review.json` trackers
   (`tasks/refinements/frontend-i18n/i18n_catalog_workflow.md`). Caption copy is
   **not** added here (that is narration). Native-speaker sign-off stays on the
   parked translation-review item — **not** a WBS leaf.
9. **No `.tji` edits, no commit, no ADR.** The implementer lands code; the
   closer updates the WBS. This task reuses existing seams only (see
   Decision §6).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):** a new
`apps/root/src/walkthrough/WalkthroughDemo.test.tsx` pins:

1. **Mount renders the renderer.** The demo mounts `GraphView` (the
   `audience-graph-root` container is present) and renders the control chrome
   (prev / next buttons, the range scrubber, the step-status element).
2. **Prefix projection wiring.** Capturing the Cytoscape `Core` via the
   demo's `cyRef` path, `cy.nodes().length` at an early position is **strictly
   less** than at a later position — i.e. next/scrub feeds a longer
   `events.slice(0, pos)` and the graph grows. (Pins the slice→`events`→render
   contract, the heart of constraint 2.)
3. **Bounds.** Previous is disabled at `pos = 0`; next is disabled at `pos = N`;
   the step-status element reports the current position and total `N`.
4. **Scrubber jump.** Setting the range input to an arbitrary position re-renders
   the graph for that prefix and updates the step-status (forward **and**
   backward — backward shrinks the node count, proving the prefix is recomputed,
   not appended).
5. **Reduced-motion gate.** With `prefers-reduced-motion: reduce` mocked,
   auto-advance does not start automatically; manual stepping still works.
   (Pins constraint 6.)

**Playwright (e2e — `tests/e2e/landing-demo.spec.ts`, inline — NOT deferred):**
the demo is **reachable today** (embedded on `/`, which renders for anonymous
visitors), and two predecessor refinements (`extract_readonly_graph_package`,
`landing_walkthrough_seed`) already point their deferred coverage at the
terminal `landing_e2e` leaf. Per the UI-stream e2e policy's "2+ inherited
refinements → pay debt down, scope a small spec inline" guidance, this task
lands a **thin** Playwright spec rather than deferring everything to
`landing_e2e`:

6. An anonymous visit to `/` renders the walkthrough demo (the Cytoscape canvas
   container + the controls are visible).
7. Clicking **next** advances the step-status indicator (position increments);
   the controls are keyboard-operable (Tab to a control, Enter/Space activates).
   Because the graph paints to a `<canvas>` (no DOM node-count seam, and no
   `window` cy hook by design — extract Decision §8), this spec asserts on the
   **step-status DOM** and control affordance-state, not on canvas contents.

The **fuller** end-to-end assertion — anonymous `/` steps the demo *through to
the final graph state with the matching localized caption* — remains owned by
the existing `landing_e2e` leaf (`tasks/47-landing-page.tji:169-179`), which
depends on `walkthrough_demo_narration` (captions) and the mobile / responsive
leaves and is the proper place for the full-journey + caption assertion. **No
new e2e task is registered** (`landing_e2e` already exists and already depends,
transitively, on this task).

**Full-suite gate (per the global build/test rule):** the workspace build
(`apps/root` Vite build with the new `@a-conversa/graph-view` dependency)
succeeds; `apps/root`'s existing Vitest suite plus the new component suite stay
green; lint / typecheck clean; `scripts/check-parity.ts` passes with the new
`landing.demo.*` keys present in all three primary catalogs.

No Cucumber scenario is in scope: this task changes no wire behavior, broadcast
shape, or projector output — it is a pure client consumer of a frozen asset and
the already-tested `@a-conversa/graph-view` projector.

## Decisions

**D1 — Co-locate the demo in `apps/root/src/walkthrough/`, do not create a new
package.** The stepper is `apps/root/src/walkthrough/WalkthroughDemo.tsx`
(alongside the seed module the same task-area shipped). *Rationale:* one
consumer (the landing page); bias toward the simpler abstraction with one call
site — the same call `landing_walkthrough_seed` D1 made for the seed. A
workspace package + boundary is justified by shared consumption, which the demo
does not have. *Rejected:* a `@a-conversa/walkthrough-demo` package — premature
for a single-surface component.

**D2 — Single persistent `GraphView` mount, fed `slice(0, pos)`; do not remount
per step.** Position is local component state; each render passes
`walkthroughEvents.slice(0, pos)` to one continuously-mounted `GraphView` with a
constant `instanceKey` (e.g. `"landing-walkthrough"`) and **no**
`activeDiagnostics`. *Rationale:* the package re-projects and diff-syncs
elements on every `events` change (`GraphView.tsx:526`), so a stable mount
gets correct incremental rendering and preserves node positions / overlay
animation continuity across steps. *Rejected:* keying `GraphView` on `pos` to
force a remount each step — throws away the position cache and overlay state,
re-runs a full layout every step, and is visually jarring; it would also be the
only way the package's one-shot fit re-fires, which D3 solves more cheaply.

**D3 — Keep the graph framed via the `cyRef` seam, not a new package prop.** The
demo captures the Cytoscape `Core` through `GraphView`'s `cyRef` callback and,
on layout completion (`cy.on('layoutstop', …)`), calls `cy.fit(undefined,
PADDING)` (`PADDING` imported from `@a-conversa/graph-view`) so the growing
prefix stays in view. *Rationale:* `cyRef` is the package's deliberate, sole
observability seam (extract Decision §8); re-fitting is exactly the
"non-broadcast framing override" extract Decision §4 anticipated the landing
demo would need — and doing it consumer-side means **zero** change to the
shared renderer (no new prop, no fork, no risk to the audience surface that also
consumes the package). *Rejected:* adding an `autoFit` / `fitMode` prop to
`GraphView` — touches the shared package and the audience surface for a need
only the demo has, when the existing `cyRef` already exposes the `Core`.
*Rejected:* accepting the package's fit-once default unchanged — the demo
starts at a tiny prefix, so the camera would lock zoomed-in and later nodes
would drift off-frame, making the centrepiece look broken.

**D4 — Event-granular stepping (0..266); full play/pause auto-advance included
but default-paused.** Prev/next move one event; the scrubber jumps to any
position; auto-advance is a simple interval that increments `pos` to `N` then
stops. *Rationale:* the `.tji` describes "step / scrub through it" with
"play/pause/auto-advance optional" — event granularity is the faithful,
simplest model and gives narration the finest hook. *Rejected:* coarse,
beat-granular stepping (advancing only to narration pause points) — the pause
beats are authored by `walkthrough_narration_script` and consumed by
`walkthrough_demo_narration`; baking beat indices in here would couple this
component to content it must not own. Narration can drive the existing
position seam (constraint 7) to jump between beats without changing this
component's model. Auto-advance default-paused + reduced-motion-aware
(constraint 6) keeps the heavy animated re-layout opt-in.

**D5 — Default initial position shows the topic, not a blank canvas.** The demo
mounts at a small non-zero `pos` so the first paint already shows the debate's
topic root rather than an empty graph. *Rationale:* the demo is the page's
hero artifact; a blank canvas on load reads as broken. *Rejected:* `pos = 0`
(empty) — poor first impression. The exact default beat is a minor UX detail
`walkthrough_demo_narration` may retune via the position seam; this task picks a
sensible non-blank default.

**D6 — Lazy-load the demo subtree to keep Cytoscape + the seed off the initial
paint.** `LandingRoute` mounts the demo via `React.lazy(() =>
import('../walkthrough/WalkthroughDemo'))` inside `<Suspense>` with a
lightweight fallback. *Rationale:* the seed is a ~4k-line JSON blob and
Cytoscape is heavy; the seed module was deliberately shaped to be
`await import()`-friendly (`landing_walkthrough_seed` Decision §3) precisely so
the demo could be code-split off the hero. *Rejected:* eagerly importing the
demo into the `/` bundle — bloats the first paint of the marketing page for an
interactive widget the visitor may never touch. (Initial-bundle perf budgets
and the small-screen variant are further refined by
`landing_demo_mobile_fallback` / `landing_responsive_a11y`; this task takes the
already-prepared lazy seam.)

**D7 — This task embeds the demo on `/` (it does not merely create a detached
component).** The `.tji` calls it "the interactive demo component embedded in
the landing page," and `landing_e2e` asserts the demo renders on an anonymous
`/`. Although the WBS `depends` lists only the renderer + seed (not
`split_public_and_home_routes`), that split is already Done, so `/` is the
public `LandingRoute` and the demo mounts into its `<main>`
(`LandingRoute.tsx:32-57`). *Rationale:* embedding is what makes the demo
reachable and the inline Playwright meaningful, and there is no other task that
"places the demo on the page" — `landing_hero_and_method` owns narrative copy,
not the demo widget. *Note:* final page composition / ordering of the demo
relative to the hero and narrative sections, and cross-breakpoint layout, are
owned by `landing_hero_and_method` + `landing_responsive_a11y`; this task slots
the demo in with a desktop-first layout that those tasks compose around.

**D8 — Control-chrome strings localized here; captions deferred to narration.**
New `landing.demo.*` keys (button + aria + step-status labels) are authored
en-US with machine pt-BR / es-419 and PENDING review-tracker entries per the
catalog workflow. *Rationale:* the control chrome is this component's surface;
the catalog-parity check requires all three primary catalogs carry the keys, and
the PENDING tracker is the established way to ship machine translations awaiting
native review (`i18n_catalog_workflow`). *Rejected:* leaving the demo's own
controls unlocalized or English-only — breaks parity and the i18n contract
(ADR 0024). Caption copy stays out (it is `walkthrough_demo_narration`'s
content, keyed off the position seam).

**D9 — No ADR.** This task reuses existing seams only — the `@a-conversa/graph-view`
public API (props-in + `cyRef`, ADR 0039), the seed module, the `LandingRoute`
mount point (ADR 0026), `React.lazy`, the i18n catalog workflow (ADR 0024). It
adds no new dependency (graph-view is an existing workspace package), no new
architectural boundary, and no security trade-off. *Rationale:* same bar as
`landing_walkthrough_seed` D5 / `split_public_and_home_routes` D6 — a consumer
built on existing seams does not clear the ADR threshold. The decisions above
are recorded here, where task-scope decisions belong.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- `apps/root/src/walkthrough/WalkthroughDemo.tsx` — interactive stepper component: single persistent `GraphView` mount fed `walkthroughEvents.slice(0, pos)`; prev/next buttons; range scrubber; play/pause auto-advance (default paused); `cyRef` + `layoutstop` re-fit via `PADDING`; reduced-motion gate; `onPositionChange` callback seam; `data-testid="walkthrough-step-status"` narration hook.
- `apps/root/src/walkthrough/WalkthroughDemo.test.tsx` — Vitest suite (5 tests): mount renders renderer, prefix-growth, bounds, scrubber forward/backward, reduced-motion gate.
- `tests/e2e/landing-demo.spec.ts` — inline Playwright spec (2 tests): anonymous `/` renders demo + controls; next advances step-status (pointer + keyboard).
- `apps/root/src/routes/LandingRoute.tsx` — demo embedded via `React.lazy` / `<Suspense>` on `/`; `<main>` made viewport-bounded (`h-screen overflow-y-auto` + `data-allow-scroll`) to keep `<html>` scroll-free and avoid tripping the no-scrollbars harness.
- `apps/root/package.json` — added `@a-conversa/graph-view workspace:*` and `cytoscape@3.33.3` (peer-dep parity with `apps/audience`); root build script kept as plain `tsc -b && vite build` (compatible with Node 20 in compose e2e Docker).
- `apps/root/tsconfig.json` — added `graph-view` project reference.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — `landing.demo.*` control-chrome keys (button / aria / step-status labels); `pt-BR.review.json`, `es-419.review.json` — PENDING entries for machine-translated strings.
- `pnpm-lock.yaml` — lockfile updated for new `@a-conversa/graph-view` + `cytoscape` wiring.
