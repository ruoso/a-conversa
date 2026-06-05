# Refinement — `landing_page.landing_responsive_a11y`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:162-173`
(`task landing_page.landing_responsive_a11y`). Downstream: the terminal
`landing_e2e` leaf depends on it (`tasks/47-landing-page.tji:175-185`). This
task is the **whole-page polish** sibling of `landing_demo_mobile_fallback`
(`tasks/47-landing-page.tji:148-160`), which owns the demo's *small-screen
behaviour*; the cross-page breakpoint pass and the page-wide accessibility
audit are this task's job.

## Effort estimate

`1d` (from the `.tji` block).

## Inherited dependencies

`depends !landing_hero_and_method, !landing_opensource_and_cta,
!walkthrough_demo_stepper`. All three are **Done (2026-06-03)**, and the two
demo siblings this task also audits — `walkthrough_demo_narration` and
`landing_demo_mobile_fallback` — are **Done (2026-06-03)** as well; the entire
landing surface this task polishes is on disk and green.

**Settled by `landing_hero_and_method`**
(`tasks/refinements/landing_page/landing_hero_and_method.md`):

- **The hero + two narrative sections ship with correct landmark/heading
  semantics.** `HeroSection` renders the page's single `<h1>` inside a
  `<section aria-labelledby="landing-hero-title">`
  (`apps/root/src/landing/HeroSection.tsx:28-42`); `HowItWorksSection` and
  `WhatItSurfacesSection` each render an `<h2>`-titled
  `<section aria-labelledby=…>` with `<h3>` items and a `sm:grid-cols-3`
  three-up grid (`apps/root/src/landing/HowItWorksSection.tsx:26-37`,
  `apps/root/src/landing/WhatItSurfacesSection.tsx:26-37`).
- **The cross-breakpoint pass + the full a11y audit were explicitly deferred to
  *this* leaf.** That refinement's Decision D4: "Ship a coherent desktop layout
  with correct landmark/heading semantics; defer the cross-breakpoint pass and
  the full a11y audit to the existing `landing_responsive_a11y` leaf."

**Settled by `landing_opensource_and_cta`**
(`tasks/refinements/landing_page/landing_opensource_and_cta.md`):

- **The page chrome below the pitch.** `OpenSourceSection`
  (`<section aria-labelledby="landing-open-source-title">` with an honest GitHub
  link + LICENSE link, both `target="_blank" rel="noopener noreferrer"`,
  `apps/root/src/landing/OpenSourceSection.tsx:37-67`), `CallToActionSection`
  (`<section aria-labelledby="landing-cta-title">` hosting the relocated
  `root-start-session` affordance + `LoginButton`,
  `apps/root/src/landing/CallToActionSection.tsx:32-50`), and `LandingFooter`
  (`<footer>` landmark composing `LocaleSwitcher`,
  `apps/root/src/landing/LandingFooter.tsx:25-33`).
- **`LocaleSwitcher` is a native `<select>` with a wired `<label htmlFor>`**
  (`apps/root/src/landing/LocaleSwitcher.tsx:65-69`) — keyboard-operable by
  default; the locale-switch path is e2e-pinned
  (`tests/e2e/landing-demo.spec.ts:263-286`).
- **Same deferral language** ("defer the cross-breakpoint pass and the a11y
  audit to `landing_responsive_a11y`") and the catch-all guidance: when
  `landing_e2e` already inherits coverage from multiple leaves, pay debt down
  with a thin inline spec rather than deferring everything.

**Settled by `walkthrough_demo_stepper` / `walkthrough_demo_narration` /
`landing_demo_mobile_fallback`** (the demo subtree this task audits but does not
restructure):

- **The interactive demo already carries a strong a11y/reduced-motion
  baseline.** `WalkthroughDemo` is a `<section aria-label=…>` with native
  `<button>` controls, an `aria-pressed` play toggle, an `aria-label`led range
  scrubber, and a `role="status" aria-live="polite"` step indicator
  (`apps/root/src/walkthrough/WalkthroughDemo.tsx:190-243`). Auto-advance is
  default-paused and **gated off under `prefers-reduced-motion`** via the local
  `usePrefersReducedMotion()` matchMedia hook, which also disables the play
  button (`WalkthroughDemo.tsx:71-89,159,222`).
- **The compact small-screen variant** (`WalkthroughDemoCompact`,
  `aria-label`led `<section>`, native segment buttons, `role="status"
  aria-live="polite"`, no scrubber/auto-advance,
  `apps/root/src/walkthrough/WalkthroughDemoCompact.tsx:128-159`) and the
  **runtime `matchMedia` viewport gate** in `WalkthroughDemoNarrated`
  (`max-width: 767.98px`, mounts exactly one variant,
  `apps/root/src/walkthrough/WalkthroughDemoNarrated.tsx:50-90`) are this task's
  *given*, not its scope. The demo's small-screen *behaviour* is
  `landing_demo_mobile_fallback`; this task audits the page **around** it.
- **The caption** is an `<aside>` landmark with a conditional `aria-labelledby`
  and an `<h3>` when a beat is active
  (`apps/root/src/walkthrough/WalkthroughCaption.tsx:38-49`).

**Pending:** none — every predecessor is Done.

## What this task is

A **whole-page responsive-layout pass and accessibility audit** over the public
landing page, fixing what the per-section tasks deliberately deferred. Per the
`.tji` note (`tasks/47-landing-page.tji:166-171`): "General responsive layout
(narrative sections, hero, footer) across breakpoints and an accessibility pass
(landmarks, headings, focus order, contrast, the demo's keyboard operability and
reduced-motion handling)."

Concretely, two strands:

1. **Responsive layout across breakpoints** for the page *chrome* — the hero,
   the two methodology grids, the open-source section, the CTA, and the footer —
   so the page reads well from a ~360 px phone up through desktop with no
   horizontal overflow, sensible line lengths, and grids/button-rows that stack
   and wrap. (The demo's own small-screen behaviour is *already* handled by
   `landing_demo_mobile_fallback`'s viewport gate — this strand does **not**
   restyle the demo internals.)

2. **An accessibility audit** of the assembled `/`: confirm one `<main>`, one
   `<h1>`, a monotonic heading outline (no skipped levels), every landmark
   `<section>` accessibly named, a sensible Tab/focus order through the whole
   page, a visible focus indicator on every interactive control, page-wide
   `prefers-reduced-motion` respect, and **colour contrast meeting WCAG 2.1 AA**.
   The baseline (Inherited dependencies) is already good; this task verifies it
   end-to-end, fills the gaps it finds, and — crucially — lands the **durable
   tests** that keep it from regressing.

It introduces **no new copy and no new components**; it restyles existing
elements (Tailwind classes), adds any missing accessible names / focus styles,
and adds the test artifacts. The one piece of genuinely-new tooling is an
automated WCAG checker for the e2e layer (see Decisions / ADR 0040).

## Why it needs to be done

`/` is the project's only fully-public, anonymous, marketing-facing surface —
it is what an unauthenticated visitor (on whatever device, with whatever
assistive tech or motion preference) sees first. The per-section tasks each
shipped a coherent desktop layout and correct local semantics but *by design*
left the cross-breakpoint reflow and the page-level a11y audit to a single
consolidating leaf so the whole page is tuned together rather than piecemeal.
This is that leaf. It is also a hard `depends` of the terminal `landing_e2e`
leaf, which asserts the full anonymous `/` journey — so the page-wide polish and
its pins must exist before that end-to-end assertion lands.

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:162-173` (this task); the downstream
  `landing_e2e` `depends` at `:178`; sibling `landing_demo_mobile_fallback` at
  `:148-160`.
- **The composition root (the page under audit):**
  `apps/root/src/routes/LandingRoute.tsx` — the single `<main
  data-testid="route-landing" data-allow-scroll="">` landmark and the centred
  `mx-auto max-w-3xl … gap-6` column that wraps every section
  (`LandingRoute.tsx:60-61`); the `data-testid="landing-walkthrough"` demo
  section + `<Suspense>` lazy-load (`LandingRoute.tsx:82-95`); the anonymous-only
  render branch (`LandingRoute.tsx:29-46` — an authenticated visitor is bounced
  to `/home` before the marketing body renders).
- **The chrome sections (responsive + landmark targets):**
  `apps/root/src/landing/HeroSection.tsx:28-42`,
  `HowItWorksSection.tsx:26-37`, `WhatItSurfacesSection.tsx:26-37`,
  `OpenSourceSection.tsx:37-67`, `CallToActionSection.tsx:32-50`,
  `LandingFooter.tsx:25-33`, `LocaleSwitcher.tsx:65-69`.
- **The demo subtree (a11y baseline to verify, not restructure):**
  `apps/root/src/walkthrough/WalkthroughDemo.tsx:71-89` (the
  `usePrefersReducedMotion` hook), `:159,:222` (auto-advance gate + play-button
  disable), `:190-243` (region label, `aria-pressed`, scrubber label,
  `role="status" aria-live="polite"`); `WalkthroughDemoCompact.tsx:128-159`;
  `WalkthroughDemoNarrated.tsx:50-90` (viewport gate); `WalkthroughCaption.tsx:38-49`.
- **Existing component tests (the Vitest pattern to extend):**
  `apps/root/src/routes/LandingRoute.test.tsx`,
  `apps/root/src/landing/CallToActionSection.test.tsx`,
  `OpenSourceSection.test.tsx`, `LandingFooter.test.tsx`, and the walkthrough
  suites — all using `renderWithProviders` / `getTestI18n` from
  `apps/root/src/testing/renderWithProviders.tsx`. ADR 0006.
- **Existing landing e2e (the inline spec this task extends):**
  `tests/e2e/landing-demo.spec.ts` — drives anonymous `/` against the compose
  stack (`baseURL http://localhost:3000`), imports the
  `./fixtures/no-scrollbars` fixture (which depends on `data-allow-scroll` on
  `<main>` — **do not regress**), and already pins desktop + phone-viewport demo
  behaviour, the narrative/chrome sections, the caption, and the locale switch
  (`landing-demo.spec.ts:34-287`). ADR 0008.
- **i18n catalog workflow (for any new accessible-name strings):**
  `tasks/refinements/frontend-i18n/i18n_catalog_workflow.md` — en-US authored
  first; pt-BR / es-419 machine-translated with **PENDING** entries in the
  sibling `*.review.json` `pending` arrays; `scripts/check-parity.ts` enforces
  key-set parity across the three primary catalogs (the `*.review.json` files
  are ignored). Existing `landing.*` keys live in
  `packages/i18n-catalogs/src/catalogs/en-US.json`. ADR 0024.
- **ADRs:** **0040** (this task's new seam — `@axe-core/playwright` for
  automated WCAG-AA checks, written under this task), 0005 (Tailwind — the
  styling vocabulary for the breakpoint pass), 0006 (Vitest), 0008 (Playwright),
  0022 (no throwaway verifications), 0024 (react-i18next + ICU), 0026 (root-app
  micro-frontend — route ownership), 0039 (graph-view boundary — the demo
  renderer is frozen; this task adds no prop to it).
- **Predecessor refinements:**
  `tasks/refinements/landing_page/landing_hero_and_method.md`,
  `landing_opensource_and_cta.md`, `walkthrough_demo_stepper.md`,
  `walkthrough_demo_narration.md`, `landing_demo_mobile_fallback.md`.

## Constraints / requirements

1. **One `<main>`, one `<h1>`, a monotonic heading outline.** The assembled `/`
   exposes exactly one `main` landmark and exactly one `h1` (the hero title);
   the heading sequence descends without skipping a level (h1 → h2 per section →
   h3 per item / caption). Where the audit finds a section landmark without an
   accessible name (e.g. the `data-testid="landing-walkthrough"` wrapper in
   `LandingRoute.tsx:82`, or the lazy-load `<Suspense>` fallback), give it one —
   an `aria-label` / `aria-labelledby` sourced from the i18n catalog
   (constraint 7), not a hard-coded string.
2. **Responsive chrome across breakpoints; no horizontal overflow.** From a
   ~360 px phone width up through desktop, the hero, the two methodology grids,
   the open-source section, the CTA, and the footer reflow cleanly: grids stack
   below their `sm`/`lg` breakpoints, button/link rows wrap (`flex-wrap`),
   padding/line-length stay readable, and the document never scrolls
   horizontally. Use Tailwind responsive utilities (ADR 0005); do **not**
   restyle the demo internals (the `matchMedia` viewport gate already owns the
   demo's small-screen form — constraint touches the page *around* it). Preserve
   the `data-allow-scroll` marker on `<main>` (the e2e no-scrollbars fixture
   depends on it).
3. **Sensible focus order + a visible focus indicator on every control.** Tab
   order follows visual/DOM order through hero → narrative → demo controls →
   open-source links → CTA → footer locale switcher, with no keyboard trap and
   no positive `tabIndex`. Every interactive element (links, buttons, the demo's
   prev/next/play/scrubber, the locale `<select>`) shows a clearly visible focus
   indicator — a consistent `focus-visible:` ring/outline — that is **not**
   suppressed by a global `outline-none`. Reuse native focusable elements (the
   page already uses real `<a>`/`<button>`/`<select>`); add no `div`-with-onClick
   affordances.
4. **Page-wide `prefers-reduced-motion` respect.** The demo's reduced-motion
   gating is already shipped (`WalkthroughDemo.tsx:159,222`); this task verifies
   it end-to-end **in a real browser** and ensures no other decorative
   animation/transition on the page ignores the preference (any such case is
   guarded with Tailwind's `motion-reduce:` variant or the existing hook). No new
   autoplaying motion is introduced.
5. **Colour contrast meets WCAG 2.1 AA.** All text, interactive-control, and
   focus-indicator colour pairs meet the AA contrast ratio. Because contrast is a
   function of *computed* colour and cannot be evaluated in jsdom, it is pinned
   by an automated `axe` scan in the real-browser e2e layer (Decision D2 /
   ADR 0040), not by a manual eyeball pass.
6. **The demo renderer is frozen.** This task adds **no** prop to
   `@a-conversa/graph-view` and does not fork it (ADR 0039); any demo-side a11y
   fix lives in the `apps/root` consumer components, not the shared package.
7. **Any new accessible-name strings go through the catalog workflow.** Screen
   reader-visible text (a new `aria-label` for the walkthrough section or the
   Suspense fallback, a skip-link label if one is added) is authored en-US under
   the existing `landing.*` namespace with machine pt-BR / es-419 + **PENDING**
   `*.review.json` entries; `scripts/check-parity.ts` must stay green. Reuse an
   existing key where one fits rather than minting a near-duplicate.
   Native-speaker sign-off stays on the **parked** translation-review item —
   **not** a WBS leaf.
8. **No `.tji` edits, no commit.** The implementer lands code + tests + ADR 0040;
   the closer updates the WBS and Status block.

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):**

1. **Structural a11y of the assembled route.** A new
   `apps/root/src/routes/LandingRoute.a11y.test.tsx` (or an extension of
   `LandingRoute.test.tsx`) renders the anonymous `/` via `renderWithProviders`
   and asserts, with role queries: exactly one `main` landmark; exactly one
   `heading` at level 1 (the hero title); the section headings are level 2 and
   their items level 3 (no skipped level — assert the ordered set of heading
   levels is non-decreasing-by-more-than-one); and every landmark `region`
   (`<section aria-labelledby/aria-label>`) and the `contentinfo` (`<footer>`)
   has a non-empty accessible name. If the walkthrough wrapper section gains an
   `aria-label` (constraint 1), assert it is present and resolves through i18n.
2. **No focus suppression / no positive tabindex.** A test asserts the rendered
   tree contains no element with a positive `tabIndex` and that the interactive
   controls are natively focusable elements (`a`/`button`/`select`/`input`), not
   `div`/`span` with click handlers — pinning constraint 3's structural half (the
   *visible-indicator* and *order* halves are the real-browser checks below).

**Playwright (e2e — extends `tests/e2e/landing-demo.spec.ts`, inline — NOT
deferred):** the whole page is **reachable today** (an anonymous visit to `/`
renders it), and `landing_e2e` already inherits coverage from five leaves, so per
the UI-stream e2e policy ("component rendered, not inert → thin reachable
spec beats deferral; pay debt down rather than pile onto the catch-all") this
task lands its page-wide a11y pins inline:

3. **Automated WCAG-AA scan, desktop viewport.** Run `@axe-core/playwright`
   against anonymous `/` (after `route-landing` is visible and the lazy demo has
   resolved), restricted to tags
   `['wcag2a','wcag2aa','wcag21a','wcag21aa']`, and assert **zero violations**.
   This is the durable contrast + broad-WCAG gate (ADR 0040).
4. **Automated WCAG-AA scan, phone viewport.** The same scan at the
   `390×844` phone viewport (where the **compact** demo variant is mounted),
   asserting zero violations — so the small-screen assembly is held to the same
   bar.
5. **Focus order + visible focus.** From a fresh load, repeated `Tab` presses
   move focus through the page in DOM order — reaching (in order) a hero/CTA
   affordance, the demo's `walkthrough-next` control, and the footer locale
   `<select>` — with no keyboard trap; assert each lands on the expected
   `data-testid`/role and that the focused control has a non-empty computed focus
   outline/ring (constraint 3). (Keyboard *activation* of the demo controls is
   already pinned at `landing-demo.spec.ts:61-91,139-170`; this adds the *order*
   + *indicator* assertion.)
6. **No horizontal overflow across breakpoints.** At a narrow phone width
   (e.g. `360×740`) and at a desktop width, assert `document.scrollingElement`'s
   `scrollWidth <= clientWidth` (no horizontal scroll) and that the key sections
   (`landing-hero`, `landing-how-it-works`, `landing-opensource`, `landing-cta`,
   `landing-footer`) are visible — pinning constraint 2. (The `no-scrollbars`
   fixture already guards stray scroll containers; this asserts the page-level
   reflow.)
7. **Reduced-motion respected end-to-end.** With
   `context.newPage()` under `reducedMotion: 'reduce'` (or
   `page.emulateMedia({ reducedMotion: 'reduce' })`), an anonymous visit to `/`
   at a desktop viewport renders the full demo with auto-advance **off** — the
   `walkthrough-play-toggle` is `disabled` (real-browser pin of the behaviour
   unit-tested at `WalkthroughDemo.tsx:222`) — confirming the page honours the
   preference, not just jsdom.

The **fuller** stepped through-to-final-state + matching-localized-caption
journey (across desktop and mobile) stays owned by the terminal `landing_e2e`
leaf (`tasks/47-landing-page.tji:175-185`), which already depends on this task.
**No new e2e task is registered.**

**Full-suite gate (per the global build/test rule):** the `apps/root` Vite build
succeeds; the existing `apps/root` Vitest suite plus the new a11y suite stay
green; lint / typecheck clean; `scripts/check-parity.ts` passes with any new
`landing.*` accessible-name keys present in all three primary catalogs; the
`@axe-core/playwright` dev dependency installs via pnpm (ADR 0010) and the new
Playwright scenarios pass against the compose stack.

No Cucumber scenario is in scope: this task changes no wire behaviour, broadcast
shape, or projector output — it is pure client-side presentation polish over a
frozen renderer and already-tested components.

## Decisions

**D1 — This task is page chrome + audit only; the demo's small-screen behaviour
is out of scope.** The responsive strand restyles the hero, narrative grids,
open-source/CTA chrome, and footer; the a11y strand audits the *assembled* page.
The demo's small-screen form is already owned by `landing_demo_mobile_fallback`'s
`matchMedia` viewport gate (`WalkthroughDemoNarrated.tsx:50-90`), and the demo's
internal a11y/reduced-motion baseline is already shipped
(`WalkthroughDemo.tsx:71-89,159,190-243`). *Rationale:* the WBS deliberately
split "the demo on a phone" from "the whole page polish" (the `.tji` note says so
outright); re-touching the demo internals here would duplicate and risk
regressing shipped-and-green work. This task *verifies* the demo's a11y
end-to-end (criteria 5,7) and fixes only page-level gaps. *Rejected:* folding the
demo's mobile behaviour into this pass — already done by the sibling.

**D2 — Pin contrast (and broad WCAG-AA) with an automated `axe` scan in the e2e
layer; write ADR 0040.** Colour contrast is a function of computed colour and
background, which jsdom does not have, so a Vitest assertion cannot evaluate it
and a manual eyeball check is exactly the throwaway verification ADR 0022
forbids. The only durable seam is a real-browser run, which is where Playwright
already operates. `@axe-core/playwright` is the standard, dev-only way to inject
the `axe-core` rule engine into the live page and assert zero WCAG-AA violations.
*Rationale:* it makes the one a11y dimension jsdom can't reach (contrast) a
committed, CI-enforced gate, and nets the long tail of machine-checkable WCAG
issues for free; it ships nothing to production and reuses the existing compose
e2e stack. Because it adds a dependency and a new test seam it clears the ADR
bar — hence **ADR 0040**, written under this task. *Rejected:* documenting the
chosen Tailwind colour tokens with a manual contrast check and no test —
throwaway, regresses silently. *Rejected:* `jest-axe` in jsdom for everything —
jsdom has no computed colour, so it still cannot check contrast (the named
requirement), and structural landmark/heading checks are already covered by the
plain role-query Vitest tests (criterion 1) without a new dependency. *Rejected:*
a `*_vr_*` visual-regression snapshot — pins pixels, not WCAG conformance, and is
not a substitute for an a11y check (per the e2e policy).

**D3 — Structural a11y stays pinned in fast Vitest role queries; axe is the
real-browser complement, not a replacement.** Landmark count, single-`h1`,
heading-outline monotonicity, accessible-name presence, and no-positive-tabindex
are asserted in jsdom with `@testing-library` role queries (criteria 1-2) — the
established landing-suite pattern — while the axe scan + focus/reflow/reduced-
motion scenarios cover what only a real browser can. *Rationale:* the two layers
are complementary: Vitest is fast and pins structure deterministically; the
browser layer pins computed-style and behavioural facts. Asserting structure in
the slow e2e layer alone would be wasteful and flakier. *Rejected:* moving all
a11y assertions into Playwright — slower, and discards the fast structural net
the component suites already provide.

**D4 — No skip-link is added; document the call.** A "skip to main content"
link's value is letting a keyboard user bypass a *repeated navigation block* that
precedes the main content. `LandingRoute` renders `<main>` as effectively the
first focusable region — there is no persistent nav/header chrome above it for a
visitor to skip past (`LandingRoute.tsx:60-61`) — so a skip-link would point from
the top of the page to ~the top of the page. *Rationale:* adding chrome with no
real affordance is noise; the WCAG bypass-blocks criterion is satisfied because
the landmarks themselves (one `main`, named `region`s, `contentinfo`) already let
AT users jump by landmark. *Rejected:* adding a skip-link reflexively — it would
be a no-op affordance here and the axe landmark checks already cover bypass via
structure. If a future task introduces a persistent top nav on `/`, that task
revisits this (it is not deferred work today).

**D5 — Reuse the existing `landing.*` namespace + catalog workflow for any new
accessible-name strings; mint nothing parallel.** Any new `aria-label` (e.g. for
the walkthrough wrapper section or a Suspense fallback) is an en-US key under
`landing.*` with machine pt-BR / es-419 + PENDING `*.review.json` entries, reusing
an existing key where the wording fits. *Rationale:* aria-labels are
screen-reader-visible text and must be localized like any other copy; the parity
+ PENDING-tracker workflow (ADR 0024) is the established path. *Rejected:*
hard-coded English aria-labels — untranslated, breaks the localized-surface
contract and `check-parity` discipline.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-04.

- `apps/root/src/index.css` — page-wide `:focus-visible` ring added (consistent visible focus indicator on every interactive control).
- `apps/root/src/routes/LandingRoute.tsx` — responsive outer padding and `aria-label` (via i18n) added to the `data-testid="landing-walkthrough"` section wrapper.
- `apps/root/src/landing/HeroSection.tsx`, `HowItWorksSection.tsx`, `WhatItSurfacesSection.tsx`, `OpenSourceSection.tsx`, `CallToActionSection.tsx` — `p-6 sm:p-8` responsive padding applied to all chrome sections.
- `apps/root/src/landing/LandingFooter.tsx` — `aria-label` (via i18n) added to the `<footer>` landmark.
- `packages/i18n-catalogs/src/catalogs/en-US.json`, `pt-BR.json`, `es-419.json` + `pt-BR.review.json`, `es-419.review.json` — new keys `landing.demo.embedRegionLabel` and `landing.footer.regionLabel` authored en-US; machine pt-BR/es-419 drafts with PENDING entries in review trackers.
- `playwright.config.ts` — new `chromium-landing` Playwright project added (fixing a bug where prior landing e2e pins never executed against the compose stack).
- `tests/e2e/landing-demo.spec.ts` — 5 new scenarios: axe WCAG-A/AA scan (desktop + phone viewports), Tab focus-order + visible-focus + no-trap, no-horizontal-overflow (360/1280 px), and reduced-motion play-toggle-disabled.
- `package.json` + `pnpm-lock.yaml` — `@axe-core/playwright` added as dev dependency (ADR 0040).
- `apps/root/src/routes/LandingRoute.a11y.test.tsx` — new Vitest file: 5 structural a11y tests (single main/h1, monotonic heading outline, every section + footer named, walkthrough region resolves via i18n, no positive tabindex / native controls).
