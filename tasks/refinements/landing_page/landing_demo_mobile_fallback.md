# Refinement — `landing_page.landing_demo_mobile_fallback`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:148-159`
(`task landing_page.landing_demo_mobile_fallback`). Downstream: the terminal
`landing_e2e` leaf depends on it (`tasks/47-landing-page.tji:174-184`); the
whole-page `landing_responsive_a11y` pass is a **sibling** (it depends on the
stepper, not on this task — `tasks/47-landing-page.tji:161-172`), so the
small-screen *demo behaviour* is this task's job and the cross-page breakpoint /
a11y polish is its.

## Effort estimate

`1d` (from the `.tji` block).

## Inherited dependencies

`depends !walkthrough_demo_stepper`. The stepper is **Done (2026-06-03)**;
everything this task builds on is on disk and green. The narration layer
(`walkthrough_demo_narration`, also **Done 2026-06-03**) is not a declared
`depends` but is already shipped and is the component this task actually
gates behind a viewport check (the narrated wrapper is what `/` mounts) — see
Inputs.

**Settled by `walkthrough_demo_stepper`**
(`tasks/refinements/landing_page/walkthrough_demo_stepper.md`):

- **The interactive demo is `apps/root/src/walkthrough/WalkthroughDemo.tsx`** —
  a single persistent `GraphView` mount fed `walkthroughEvents.slice(0, pos)`,
  with prev/next single-event buttons, a range **scrubber** (`type="range"`,
  0..266), and a **play/pause auto-advance** (default-paused, reduced-motion
  gated) (`WalkthroughDemo.tsx:199-251`). Position is local state; the heaviest
  motion sources are the continuous scrubber drag and the 1.2 s-interval
  auto-advance, each firing an animated Cytoscape re-layout + re-fit.
- **`DEFAULT_INITIAL_POSITION = 6`** (`WalkthroughDemo.tsx:54`) — the first
  narration anchor, so the first paint already shows the topic, not a blank
  canvas.
- **The re-fit seam.** The demo keeps the growing prefix framed consumer-side:
  it captures the Cytoscape `Core` via `GraphView`'s `cyRef` and re-fits on
  `layoutstop` with `cy.fit(undefined, PADDING)` (`WalkthroughDemo.tsx:135-149`)
  — **no** package fork, **no** new `GraphView` prop (stepper Decision §3, which
  explicitly rejected adding an `autoFit`/`fitMode` prop to the shared
  renderer).
- **The position + narration seams.** `WalkthroughDemo` exposes
  `onPositionChange(position, event)` (`WalkthroughDemo.tsx:91-98,151-154`) and a
  machine-readable `data-testid="walkthrough-step-status"` element carrying
  `data-position` / `data-total` (`WalkthroughDemo.tsx:241-250`). The
  reduced-motion baseline is the local `usePrefersReducedMotion()` matchMedia
  hook (`WalkthroughDemo.tsx:71-89`).
- **Control-chrome strings are localized under `landing.demo.*`** in all three
  primary catalogs, with PENDING review-tracker entries for the machine pt-BR /
  es-419 strings (`packages/i18n-catalogs/src/catalogs/en-US.json:12-66`; the
  `pt-BR.review.json` / `es-419.review.json` `pending` arrays already list the
  full `landing.demo.*` key set).

**Settled by `walkthrough_demo_narration`**
(`tasks/refinements/landing_page/walkthrough_demo_narration.md`):

- **`/` mounts the narrated wrapper, not the bare stepper.**
  `apps/root/src/routes/LandingRoute.tsx:23` lazy-loads
  `WalkthroughDemoNarrated`, which owns the demo position and renders the
  caption beside the graph (`WalkthroughDemoNarrated.tsx:25-48`, a
  `lg:grid-cols-[…]` two-column grid). It drives the bare `WalkthroughDemo` via
  `onPositionChange` and feeds the computed beat to `<WalkthroughCaption>`.
- **The narration beat table is reusable, typed, and pure.** `narration.ts`
  exports `WALKTHROUGH_BEATS` (nine beats anchored at the strictly-increasing
  prefix positions `6, 27, 42, 56, 86, 100, 147, 196, 266`,
  `narration.ts:32-42`) and `activeBeatFor(position)` ("last beat with anchor ≤
  position", `narration.ts:51-61`). These anchors are exactly the "per-segment"
  positions this task's coarse stepping needs.

**Pending:** none.

## What this task is

Give the public landing demo a **reduced/fallback mode for small viewports** so
that a phone visitor gets a graph that degrades gracefully instead of the
full heavy interactive Cytoscape scrubber. Per the `.tji` note
(`tasks/47-landing-page.tji:152-157`): "Interactive Cytoscape on a phone is
heavy … show the final (or per-segment) graph with simple step buttons and skip
animated re-layout." Decision R (2026-05-30, recorded in the note) made this
**first-class scope, not an afterthought**.

Concretely: on small viewports `/` mounts a **compact** variant of the demo —
`WalkthroughDemoCompact` — that renders the same `@a-conversa/graph-view`
`GraphView` (one mount) but steps **coarsely between the nine narration beat
anchors** with plain prev-segment / next-segment buttons, and **drops the two
continuous-motion sources** (the range scrubber and the play/pause
auto-advance). The selection is a runtime `matchMedia` gate so that a phone
**never instantiates** the full interactive stepper. The narration caption still
renders (it is already beat-driven), so the methodology story is intact on a
phone — just told in nine taps instead of a 266-step scrub.

Scope boundaries with the siblings:

- **Whole-page responsive layout + the a11y audit** (landmarks, headings, focus
  order, contrast, cross-breakpoint section restyling) are
  `landing_responsive_a11y` (`tasks/47-landing-page.tji:161-172`). This task owns
  only the **demo's** small-screen behaviour; it does not restyle the hero,
  narrative sections, or footer.
- **The full stepped + caption end-to-end journey** stays owned by `landing_e2e`
  (`tasks/47-landing-page.tji:174-184`); this task pins the compact-variant
  *behaviour* inline (see Acceptance criteria).

## Why it needs to be done

The walkthrough demo is the centrepiece of the marketing page, and the page is
public — anonymous, mobile traffic included. The full demo is a continuously
re-laid-out Cytoscape graph driven by a 266-step scrubber and an animated
auto-advance; on a phone that is janky at best and a battery/Jank "bug report"
at worst. The 2026-05-30 decision elevated this to first-class scope precisely
so the small-screen experience is *designed* rather than discovered. It is also
a hard `depends` of the terminal `landing_e2e` leaf, which asserts the public `/`
journey — so `landing_e2e` cannot run until the small-screen behaviour exists
and is pinned.

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:148-159` (this task); the downstream
  `landing_e2e` `depends` at `:177`; sibling `landing_responsive_a11y` at
  `:161-172`.
- **The full interactive demo (what the compact variant replaces on small
  screens):** `apps/root/src/walkthrough/WalkthroughDemo.tsx`
  — props/seams `:91-108`; `usePrefersReducedMotion` `:71-89`;
  `DEFAULT_INITIAL_POSITION = 6` `:54`; the `cyRef` + `layoutstop` re-fit
  `:135-149`; the controls (prev/next/play/scrubber/step-status) `:199-251`.
- **The composition root that selects + mounts the demo:**
  `apps/root/src/walkthrough/WalkthroughDemoNarrated.tsx:25-48` (owns position;
  drives the stepper via `onPositionChange`; renders `<WalkthroughCaption>`).
  This is the seam the viewport gate lives in (Decision §D5).
- **The embed site:** `apps/root/src/routes/LandingRoute.tsx:23` (lazy-loads the
  narrated wrapper), `:82-95` (the `data-testid="landing-walkthrough"` section +
  `<Suspense>`). The `/` route renders for anonymous visitors only
  (`LandingRoute.tsx:44-46`).
- **The "per-segment" anchors:** `apps/root/src/walkthrough/narration.ts:32-42`
  (`WALKTHROUGH_BEATS`, anchors `6, 27, 42, 56, 86, 100, 147, 196, 266`),
  `:51-61` (`activeBeatFor`). The compact stepper steps between these exact
  positions — reusing the narration design, not re-deriving segment boundaries.
- **The renderer contract (unchanged here):**
  `packages/graph-view/src/GraphView.tsx:343-374` (`GraphViewProps` — props-in,
  no store, optional `cyRef`); `:526,:533-541` (per-render layout + one-shot
  first-render fit, `fit:false` thereafter — the behaviour the re-fit works
  around); `:544-546` (root wrapper `relative h-full w-full`, host-sized);
  `packages/graph-view/src/index.ts:26` (`PADDING` export). ADR 0039 froze this
  boundary — **do not** add a demo-only prop to it.
- **i18n catalog workflow (for any new control strings):**
  `tasks/refinements/frontend-i18n/i18n_catalog_workflow.md` — en-US authored
  first; pt-BR / es-419 machine-translated with PENDING entries in the sibling
  `*.review.json` `pending` arrays; `scripts/check-parity.ts` enforces key-set
  parity across the three primary catalogs (the `*.review.json` files are
  ignored by the parity check). Existing `landing.demo.*` keys:
  `packages/i18n-catalogs/src/catalogs/en-US.json:12-66`.
- **Playwright e2e layout:** specs live in `tests/e2e/*.spec.ts` and run against
  the compose stack (`baseURL http://localhost:3000`). The demo's existing
  inline spec is `tests/e2e/landing-demo.spec.ts` (it imports the
  `./fixtures/no-scrollbars` test fixture and drives anonymous `/` against the
  real renderer). New mobile-viewport scenarios extend this spec. ADR 0008.
- **ADRs:** 0039 (graph-view boundary — props-in, no store, `cyRef` the sole
  seam), 0026 (root-app micro-frontend, no cross-app import), 0004 (Cytoscape for
  read-only surfaces), 0024 (react-i18next + ICU), 0005 (Tailwind), 0008
  (Playwright), 0022 (no throwaway verifications).
- **Predecessor refinements:**
  `tasks/refinements/landing_page/walkthrough_demo_stepper.md`,
  `tasks/refinements/landing_page/walkthrough_demo_narration.md`.

## Constraints / requirements

1. **A phone never instantiates the full interactive stepper.** Variant
   selection is a **runtime** `matchMedia` gate that mounts *exactly one* of the
   full demo or the compact variant — not a CSS `hidden` toggle over two mounted
   subtrees (that would instantiate two Cytoscape cores, the opposite of the
   goal). The gate reads its initial value synchronously at mount (apps/root is a
   client-rendered SPA — no SSR/hydration mismatch concern) and updates on the
   media-query `change` event, mirroring the existing
   `usePrefersReducedMotion()` idiom (`WalkthroughDemo.tsx:71-89`).
2. **Compact variant renders the same renderer, coarsely.** It mounts one
   `GraphView` from `@a-conversa/graph-view` fed `walkthroughEvents.slice(0,
   pos)` — same prefix-projection contract as the full demo (no demo-side
   reordering / filtering / mutation of the seed). `activeDiagnostics` is
   **omitted**. `pos` is restricted to the nine `WALKTHROUGH_BEATS` anchors
   (`narration.ts:32-42`).
3. **Simple step buttons; no scrubber, no auto-advance.** The compact controls
   are prev-segment / next-segment buttons only (disabled at the first / last
   beat). The continuous range scrubber and the play/pause auto-advance are
   **absent** from the compact variant — they are the two sources of repeated
   animated re-layout the `.tji` note ("skip animated re-layout") targets. All
   controls are real keyboard-operable `<button>`s (focusable,
   Enter/Space-activated, labelled).
4. **Reuse the existing renderer + narration seams; no package change.** The
   compact variant keeps the prefix framed via the **same** `cyRef` +
   `layoutstop` `cy.fit(undefined, PADDING)` pattern the full demo uses
   (`WalkthroughDemo.tsx:135-149`); it adds **no** prop to `GraphView` and does
   **not** fork the package (ADR 0039 / stepper Decision §3). It reuses
   `WALKTHROUGH_BEATS` / `activeBeatFor` from `narration.ts` rather than
   re-deriving segment boundaries.
5. **Position-seam parity with the full demo.** The compact variant exposes the
   same observable contract: an `onPositionChange(position, event)` callback and
   a `data-testid="walkthrough-step-status"` element with `data-position` /
   `data-total`, so the narrated wrapper drives the caption identically and tests
   assert advancement without reading the `<canvas>`. The narrated wrapper feeds
   **the same** position state and `onPositionChange` to whichever variant is
   mounted (the wrapper owns position; the variants are interchangeable on that
   seam).
6. **The caption still renders on small screens.** Because the wrapper keeps
   driving `<WalkthroughCaption>` off the (now coarse) position, the methodology
   narration is intact on a phone; the compact layout stacks caption below graph
   rather than the desktop two-column grid (`WalkthroughDemoNarrated.tsx:42`).
7. **New control strings localized via the catalog workflow.** Any new labels
   the compact controls need (e.g. prev-/next-segment button + aria text, a
   compact region label) are authored en-US under the existing `landing.demo.*`
   namespace with machine pt-BR / es-419 + **PENDING** `*.review.json` entries;
   `scripts/check-parity.ts` must stay green. Where an existing key already fits
   (`landing.demo.previous` / `landing.demo.next` / `landing.demo.stepStatus`),
   reuse it rather than minting a near-duplicate. Native-speaker sign-off stays
   on the **parked** translation-review item — **not** a WBS leaf.
8. **No `.tji` edits, no commit, no ADR.** The implementer lands code; the closer
   updates the WBS. This task reuses existing seams only (Decision §D8).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):**

1. **Compact variant renders the renderer + coarse controls.** A new
   `apps/root/src/walkthrough/WalkthroughDemoCompact.test.tsx` mounts the compact
   variant and asserts: the `GraphView` container (`audience-graph-root`) is
   present; prev-segment / next-segment buttons are present; the **scrubber**
   (`walkthrough-scrubber`) and **play/pause** (`walkthrough-play-toggle`)
   controls are **absent**; the step-status element reports position + total.
2. **Coarse beat stepping.** Capturing the Cytoscape `Core` via the variant's
   `cyRef` path, next-segment advances the rendered position from one beat anchor
   to the next (`6 → 27 → …`), and `cy.nodes().length` at a later beat is
   **strictly greater** than at an earlier beat (pins the prefix-projection
   contract over the coarse anchors). Prev-segment is disabled at the first beat;
   next-segment is disabled at the last (`finale`, position 266).
3. **Position-seam parity.** The compact variant fires `onPositionChange` with
   the beat-anchor position and exposes the same `walkthrough-step-status`
   `data-position`/`data-total` attributes the full demo exposes (so the narrated
   wrapper and the caption work unchanged).
4. **Viewport gate selects exactly one variant.** A test over the
   selection seam (in the narrated wrapper, see Decision §D5) with `matchMedia`
   mocked: at a **small** viewport it mounts the compact variant (compact
   controls present, no scrubber); at a **large** viewport it mounts the full
   demo (scrubber present). Assert exactly one `GraphView`/`audience-graph-root`
   is mounted in each case (no double Cytoscape instantiation — constraint 1).

**Playwright (e2e — extends `tests/e2e/landing-demo.spec.ts`, inline — NOT
deferred):** the compact variant is **reachable today** — an anonymous visit to
`/` at a phone viewport renders it. Per the UI-stream e2e policy (component is
rendered, not inert → a thin reachable-behaviour spec beats deferral) and the
"pay debt down rather than pile onto `landing_e2e`" guidance, this task adds
mobile-viewport scenarios inline:

5. At a **phone viewport** (e.g. a `browser.newContext({ viewport: { width:
   390, height: 844 } })` or a Playwright device descriptor), an anonymous visit
   to `/` renders the **compact** demo: the `GraphView` container + the segment
   buttons + the step-status are visible, and the **scrubber** is **not** present
   (proving the heavy interactive variant was not mounted).
6. Next-segment advances the step-status `data-position` by a **beat jump**
   (`6 → 27`, not `+1`), and the control is keyboard-operable (focus, then
   Enter/Space activates). Asserts on the step-status DOM + affordance state, not
   on `<canvas>` contents (no DOM node-count seam; no `window` cy hook by design
   — ADR 0039 / stepper Decision §8).

The fuller through-to-final-state + matching-localized-caption journey (across
both desktop and mobile) stays owned by the terminal `landing_e2e` leaf
(`tasks/47-landing-page.tji:174-184`), which already depends, transitively and
directly, on this task. **No new e2e task is registered.**

**Full-suite gate (per the global build/test rule):** the `apps/root` Vite build
succeeds; the existing `apps/root` Vitest suite plus the new compact-variant +
selection suites stay green; lint / typecheck clean; `scripts/check-parity.ts`
passes with any new `landing.demo.*` keys present in all three primary catalogs.

No Cucumber scenario is in scope: this task changes no wire behaviour, broadcast
shape, or projector output — it is a pure client consumer of a frozen asset and
the already-tested `@a-conversa/graph-view` projector.

## Decisions

**D1 — Ship a `WalkthroughDemoCompact` variant, do not branch the existing
stepper.** The compact behaviour lives in a new
`apps/root/src/walkthrough/WalkthroughDemoCompact.tsx`, co-located with its
siblings; `WalkthroughDemo.tsx` ships unchanged. *Rationale:* the two variants
share almost no control chrome (the compact one drops the scrubber + auto-advance
entirely and replaces 266-step granularity with 9-beat granularity), so threading
a `compact` boolean through the existing component would balloon it with
conditionals and risk regressing the shipped-and-green desktop demo. Two small,
focused components on a shared seam (`onPositionChange` + step-status) is the
simpler abstraction. *Rejected:* a `mode` prop on `WalkthroughDemo` — couples two
genuinely different interaction models in one file. *Rejected:* a new
`@a-conversa/walkthrough-demo` package — no shared consumption (one surface),
same call `walkthrough_demo_stepper` D1 made.

**D2 — "Per-segment" = the nine narration beat anchors; reuse `narration.ts`.**
The compact stepper steps between `WALKTHROUGH_BEATS` positions
(`narration.ts:32-42`), not arbitrary chunk sizes. *Rationale:* those anchors are
the *designed* segment boundaries — each is the prefix at which a methodology
concept becomes visible and a caption fires — so coarse stepping over them tells
the same story the narration already authored, and the caption stays meaningful
at every compact stop. Re-deriving segment boundaries would duplicate (and could
drift from) that design. *Rejected:* fixed-stride chunks (e.g. every 30 events) —
arbitrary, would land between captions, and duplicates a decision narration
already owns. *Rejected:* final-graph-only (jump straight to `pos = 266`) — the
note allows it ("the final … graph"), but it forfeits the per-segment story *and*
forces the single heaviest layout (all 266 events) on the phone's first paint;
beat-stepping from the first anchor is both lighter on load and keeps the
narrative.

**D3 — "Skip animated re-layout" is honoured by removing the continuous-motion
controls, not by adding a no-animation prop to the renderer.** The compact
variant drops the range scrubber (continuous drag → a re-layout per integer step)
and the play/pause auto-advance (a re-layout every 1.2 s), leaving only
discrete, user-initiated beat jumps. *Rationale:* the heaviness the note calls
out is the *repeated* animated re-layout from scrubbing/auto-advancing across
hundreds of positions on a phone; reducing to ≤9 explicit, infrequent jumps
removes that. Truly disabling Cytoscape's *internal* layout animation would
require a new `GraphView` prop — which ADR 0039 / stepper Decision §3 explicitly
rejected adding for a demo-only need, because it touches the shared renderer the
audience broadcast surface also consumes. Keeping the change consumer-side is the
defensible call. *Rejected:* an `animate:false` / `fitMode` prop on `GraphView` —
forks risk onto the audience surface for a need only the landing demo has.

**D4 — Keep using `GraphView` (one Cytoscape mount); do not render a static
image/snapshot.** The compact variant renders the live renderer at coarse
positions, reusing the `cyRef` + `layoutstop` re-fit. *Rationale:* a pre-rendered
static graph image would need a snapshot-generation pipeline and a committed image
asset that silently rots when the seed or renderer styling changes — new
machinery and a maintenance burden, for a surface the existing `GraphView`
already serves correctly with one mount and a handful of layouts. Reusing the
existing seam is the simpler, test-pinnable path. *Rejected:* static
per-segment PNG/SVG snapshots — introduces an asset pipeline + drift risk and is
not cleanly pinned by a durable behavioural test.

**D5 — The viewport gate lives in `WalkthroughDemoNarrated`, the existing
composition root.** The narrated wrapper already owns the demo's position and
chooses what renders beside the caption; it gains a `matchMedia` gate
(`useMediaQuery`-style hook, modelled on `usePrefersReducedMotion`) and mounts
`WalkthroughDemo` **or** `WalkthroughDemoCompact`, passing the **same**
`onPositionChange` to either. *Rationale:* this keeps the selection at the one
place that already brokers position + caption, so the caption and position seam
behave identically regardless of variant; `LandingRoute` stays a thin
lazy-loading host and needs no change. Selecting in JS (not CSS) satisfies
constraint 1 — only one variant, hence one Cytoscape core, is ever instantiated.
*Rejected:* selecting in `LandingRoute` — would push viewport logic into the route
and split position ownership across two files. *Rejected:* a CSS `lg:hidden` /
`hidden lg:block` pair over two mounted variants — instantiates two Cytoscape
cores on every visit, defeating the whole purpose.

**D6 — Small-viewport breakpoint: `max-width: 767.98px` (below Tailwind `md`),
exposed through a mockable `matchMedia` hook.** Below this width the compact
variant mounts; at/above it the full interactive demo mounts. *Rationale:* the
heaviness concern is phones (and phone-width portrait); Tailwind's `md` (768px)
is the conventional phone/tablet boundary and the demo's own two-column caption
grid only engages at `lg` anyway (`WalkthroughDemoNarrated.tsx:42`), so `md` is a
clean, already-meaningful cut. The exact value is a documented call, not a deep
invariant — `landing_responsive_a11y` may retune the page's breakpoints around it,
and because the gate is a single mockable hook the threshold is trivially
adjustable and trivially testable. *Rejected:* gating at `lg` (1024px) — would
hand the reduced experience to capable small tablets unnecessarily. *Rejected:*
`sm` (640px) — leaves larger phones in landscape on the heavy variant.

**D7 — Reuse the existing `landing.demo.*` keys where they fit; add only the
genuinely-new compact labels.** The step-status (`landing.demo.stepStatus`) and,
where the wording fits, the prev/next labels are reused; any compact-specific
label (e.g. a "next section" / "previous section" phrasing or a compact region
label, if the desktop wording reads wrong for beat-jumps) is a new en-US key
under `landing.demo.*` with machine pt-BR / es-419 + PENDING `*.review.json`
entries. *Rationale:* parity + the PENDING-tracker workflow is the established way
to ship machine translations awaiting native review (ADR 0024 /
`i18n_catalog_workflow`); reusing fitting keys avoids near-duplicate copy.
*Rejected:* minting a parallel `landing.demoCompact.*` namespace — needless
duplication of strings that are mostly identical.

**D8 — No ADR.** This task reuses existing seams only — the `@a-conversa/graph-view`
public API (props-in + `cyRef`, ADR 0039) with **no** package change, the
narration beat table, the seed module, the narrated-wrapper composition root
(ADR 0026), `matchMedia` (the same idiom the stepper already uses), and the i18n
catalog workflow (ADR 0024). It adds no new dependency, no new architectural
boundary, and no security trade-off. *Rationale:* same bar as the predecessor
demo tasks — a consumer built on existing seams does not clear the ADR threshold;
the task-scope decisions are recorded here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Created `apps/root/src/walkthrough/WalkthroughDemoCompact.tsx` — coarse beat-stepper variant with prev/next-segment buttons, one `GraphView` mount, no scrubber or auto-advance; steps through the nine `WALKTHROUGH_BEATS` anchors (positions 6, 27, 42, 56, 86, 100, 147, 196, 266).
- Created `apps/root/src/walkthrough/WalkthroughDemoCompact.test.tsx` — Vitest suite: renderer + coarse controls present, scrubber/play absent, beat stepping 6→27 with strictly-growing node count, first/last button disable, `onPositionChange` parity; non-null assertions (`!`) on beat-array accesses to satisfy `noUncheckedIndexedAccess` (matching `narration.test.ts` convention).
- Created `apps/root/src/walkthrough/WalkthroughDemoNarrated.test.tsx` — viewport gate test: `matchMedia` mocked small→compact (compact controls, no scrubber), large→full (scrubber present), exactly one `audience-graph-root` in each case.
- Edited `apps/root/src/walkthrough/WalkthroughDemoNarrated.tsx` — added runtime `matchMedia` gate (`max-width: 767.98px`, Decision §D5/D6) that mounts `WalkthroughDemoCompact` or `WalkthroughDemo` exclusively, passing the same `onPositionChange`; caption remains active on small screens via stacked layout.
- Edited `tests/e2e/landing-demo.spec.ts` — two new phone-viewport Playwright scenarios: (5) anonymous `/` at 390×844 renders compact demo without scrubber; (6) next-segment button advances `data-position` by beat jump (6→27), keyboard-operable via Enter/Space.
- Edited `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` — added `compactRegionLabel`, `previousSegment`, `nextSegment` keys under `landing.demo.*`.
- Edited `packages/i18n-catalogs/src/catalogs/pt-BR.review.json`, `es-419.review.json` — added PENDING entries for the three new keys awaiting native-speaker sign-off (parked translation-review item, not a WBS leaf).
