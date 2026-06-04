# Refinement — `landing_page.landing_hero_and_method`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:73-89`
(`task landing_hero_and_method` under `task landing_page`).
Back-link maintained by the closer.

```
task landing_hero_and_method "Hero + 'how it works' + 'what it surfaces' narrative sections" {
  effort 2d
  allocate team
  depends !split_public_and_home_routes
}
```

This task feeds milestone **M8-landing**. Its direct downstreams are
`landing_responsive_a11y` (`tasks/47-landing-page.tji:159-170`, whole-page
responsive + a11y polish) and the terminal `landing_e2e` leaf
(`tasks/47-landing-page.tji:172-182`), which asserts an anonymous visit to `/`
"renders the narrative sections and the walkthrough demo."

## Effort estimate

`2d` (`effort 2d`, `allocate team`). The route shell, the demo embed, and the
i18n catalog workflow already exist; the work is the marketing copy (authored
en-US + machine pt-BR/es-419 + PENDING trackers), three presentational section
components, their composition into `LandingRoute`, and tests. No new
architecture, no backend, no new dependency.

## Inherited dependencies

**`depends !split_public_and_home_routes`** — **Done (2026-06-03)**
(`tasks/refinements/landing_page/split_public_and_home_routes.md` § Status).
Everything this task builds on is on disk and green.

**Settled by `split_public_and_home_routes`:**

- `/` is the **public marketing surface**, anonymous-facing:
  `apps/root/src/routes/LandingRoute.tsx`. Its `<main>` carries
  `data-testid="route-landing"` (`LandingRoute.tsx:54`). The auth-state
  shepherding is in place: `loading → LoadingFrame` (`:23-25`),
  `needs-screen-name → /screen-name` (`:27-29`), `authenticated → /home`
  (`:38-40`); only the **unauthenticated** branch (`:42-98`) renders marketing
  content. This task rewrites that branch's content; it does **not** touch the
  auth-state branching.
- The authenticated dashboard moved to `/home` (`HomeRoute.tsx`); the public
  page is now solely top-of-funnel acquisition. Authenticated users never see
  it (they are bounced to `/home`), so the narrative is written for the
  anonymous visitor only.
- The deep-link return-to seam (`SurfaceHost.tsx`) and the `/login` ↔
  `/screen-name` ↔ `/logout` auth chrome are untouched by content work.

**Settled by the demo leaves (already complete, composed into `/` today):**

- `walkthrough_demo_stepper` + `walkthrough_demo_narration` (both Done
  2026-06-03) mounted the interactive narrated demo in `LandingRoute`:
  `apps/root/src/routes/LandingRoute.tsx:83-96` lazy-loads
  `<WalkthroughDemoNarrated />` inside `<section
  data-testid="landing-walkthrough">`. **This task arranges narrative copy
  around that demo; it must not modify the demo subtree**
  (`apps/root/src/walkthrough/*`).
- The demo's caption copy already lives in the catalog under
  `landing.demo.caption.*` (`en-US.json:20-66`) and articulates the same
  methodology concepts this task's narrative sells in prose — "one shared
  graph", "nothing lands until everyone agrees", internal contradictions,
  category mismatches, bedrock axioms, talking past each other. The
  `walkthrough_narration_script` refinement explicitly flagged its caption copy
  as **provisional pending editorial reconciliation with this task's hero
  wording**, with **no code dependency** between them
  (`walkthrough_demo_narration.md:63-65`). This task is where that prose voice
  is fixed; the captions are not edited here (reconciliation, if any, is a later
  catalog-only touch).

**Pending:** none — the dependency is complete.

## What this task is

Replace the developer placeholder at the top of the public `/` page with the
real **methodology pitch**, as three localized narrative sections composed
around the already-mounted interactive demo:

1. **Hero** — product name + a one-line value proposition + the core
   **hypothesis**: most disagreements are either people contradicting
   themselves, or people talking past each other by treating the same statement
   as a different *kind* of thing.
2. **"How it works"** — two debaters and one moderator working on a single,
   shared, live-growing graph, where nothing lands until everyone agrees.
3. **"What it surfaces"** — the three diagnostic goals: internal
   contradictions, category mismatches, and bedrock axioms.

Today `LandingRoute`'s unauthenticated branch renders a placeholder card:
eyebrow `root.landing.eyebrow` ("a-conversa"), title `auth.login.title`
("Sign in"), body `root.landing.body` ("Micro-frontend host app"), plus a
`root-start-session` link and a `<LoginButton>` (`LandingRoute.tsx:56-74`).
This task replaces the placeholder *content* with the hero + the two narrative
sections, localized via the catalog workflow. The demo embed (`:83-96`) stays
exactly as composed by the demo leaves; this task slots the narrative sections
around it in a desktop-first layout that `landing_responsive_a11y` later polishes
across breakpoints.

**Scope boundaries** (what this task does *not* own):

- **The CTA / open-source / footer chrome** is `landing_opensource_and_cta`
  (`tasks/47-landing-page.tji:91-101`): the secondary "start a debate" / login
  CTA, the open-source section, the footer + locale switcher. This task does
  **not** redesign or relocate the call-to-action; it leaves the existing
  `root-start-session` + `<LoginButton>` affordances in place so the page stays
  functional, and lets `landing_opensource_and_cta` own their final treatment
  (see Decision D5).
- **Cross-breakpoint responsive layout + the a11y audit** (landmarks, focus
  order, contrast, reduced-motion) is `landing_responsive_a11y`
  (`tasks/47-landing-page.tji:159-170`). This task ships a sensible accessible
  baseline (semantic `<section>` landmarks, one `<h1>` + section headings) and a
  desktop-first layout, not the page-wide audit.
- **Native-speaker translation sign-off** stays on the **parked
  translation-review item** — not a WBS leaf (`tasks/47-landing-page.tji:86-87`).
  This task authors en-US and ships machine pt-BR/es-419 with PENDING trackers.

## Why it needs to be done

The landing page exists to **sell the methodology** — "why better debate needs
this platform" (`tasks/47-landing-page.tji:1-12`). The interactive demo shows
*what it looks like*; the narrative sections are the *argument for why it
matters* — the hypothesis, the format, and the three things the format
surfaces. Without them the page is a graph toy with no thesis.

M8-landing gates M9 (Deployment ready): `a-conversa.org` must not ship the
developer placeholder currently served at `/`
(`tasks/47-landing-page.tji:9-12`). Replacing that placeholder hero with the
real pitch is the core of that milestone. The terminal `landing_e2e` leaf
asserts exactly this — "an anonymous visit to `/` renders the narrative
sections and the walkthrough demo" (`tasks/47-landing-page.tji:176-181`) — and
`landing_responsive_a11y` polishes the layout this task lays down.

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:73-89` (this task), with the content
  brief in its `note` (`:77-88`); architecture note `tasks/47-landing-page.tji:1-20`.
- **The route to edit:** `apps/root/src/routes/LandingRoute.tsx`.
  - `:42-98` — the unauthenticated marketing render (the JSX this task rewrites).
  - `:56-74` — the placeholder hero card (`root.landing.eyebrow` /
    `auth.login.title` / `root.landing.body` + `root-start-session` +
    `<LoginButton>`) — replaced with the real hero.
  - `:83-96` — the `<section data-testid="landing-walkthrough">` `<Suspense>`
    demo embed — **left intact**; narrative sections compose around it.
  - `:23-40` — the loading / needs-screen-name / authenticated branches —
    **left intact**.
  - `:42-54` — the `<main data-testid="route-landing" data-allow-scroll>` scroll
    region idiom and the centered `min-h-full` wrapper — reused; the comment at
    `:42-53` documents why `<main>` owns the scroll.
- **i18n catalogs (where the new copy lands):**
  - en-US source: `packages/i18n-catalogs/src/catalogs/en-US.json` — extend the
    `landing` namespace (`:11-68`) with the new narrative keys, beside the
    existing `landing.demo.*` block.
  - Machine translations: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json`.
  - PENDING trackers: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json`
    — append the new dotted keys to the `pending` array (`pt-BR.review.json:5`
    onward shows the established shape; the demo's `landing.demo.*` keys are
    already tracked there).
  - Parity gate: `packages/i18n-catalogs/scripts/check-parity.ts` enforces
    key-set parity across the three primary catalogs and ignores `*.review.json`
    by filename.
  - Consumption: `useTranslation()` from `react-i18next`; `t('landing.hero.…')`.
    i18n is wired app-wide via `apps/root/src/main.tsx`, so new keys resolve for
    free.
- **The demo's caption copy (the prose to reconcile against, editorial only):**
  `packages/i18n-catalogs/src/catalogs/en-US.json:20-66`
  (`landing.demo.caption.*`).
- **Test conventions:**
  - Vitest: `apps/root/src/routes/LandingRoute.test.tsx` (the existing route
    test updated by `split_public_and_home_routes`); render helpers
    `renderWithProviders` / `getTestI18n` from
    `apps/root/src/testing/renderWithProviders.tsx`.
  - Playwright: `tests/e2e/landing-demo.spec.ts` (the existing public-`/` spec
    — the natural place to extend with thin narrative-section assertions).
- **ADRs:** 0024 (react-i18next + ICU — the i18n/catalog workflow), 0026
  (root-app micro-frontend — route ownership), 0008 (Playwright), 0022 (no
  throwaway verifications), 0005 (Tailwind — styling).
- **Predecessor / sibling refinements:**
  `tasks/refinements/landing_page/split_public_and_home_routes.md`,
  `tasks/refinements/landing_page/walkthrough_demo_narration.md`,
  `tasks/refinements/landing_page/walkthrough_narration_script.md`.

## Constraints / requirements

1. **Anonymous-only narrative; auth branching untouched.** The new content
   renders only in `LandingRoute`'s unauthenticated branch. The loading /
   needs-screen-name / authenticated-→-`/home` branches (`LandingRoute.tsx:23-40`)
   are preserved verbatim — authenticated users still never see the marketing
   page.
2. **Three sections, semantic and labelled.** Hero (a single `<h1>`), "how it
   works", and "what it surfaces" each render as a semantic `<section>` with a
   heading and a stable `data-testid`. The hero carries the product name, a
   one-line value proposition, and the hypothesis statement. "How it works"
   conveys: two debaters + one moderator, one shared live-growing graph, nothing
   lands until everyone agrees. "What it surfaces" conveys the three diagnostic
   goals (internal contradictions, category mismatches, bedrock axioms).
3. **Do not modify the demo subtree.** The `<section
   data-testid="landing-walkthrough">` embed (`LandingRoute.tsx:83-96`) and
   everything under `apps/root/src/walkthrough/*` are left exactly as the demo
   leaves shipped them. This task only positions the narrative sections relative
   to the demo within `<main>`.
4. **All copy localized via the catalog workflow.** New narrative keys are
   authored en-US, machine-translated to pt-BR/es-419, and every new dotted key
   is appended to the `pending` array of each `*.review.json` tracker.
   `scripts/check-parity.ts` must pass with the new keys present in all three
   primary catalogs. No marketing string is hard-coded in the component (the
   one-source-of-truth-is-the-catalog rule the demo leaves followed).
   Native-speaker sign-off stays parked — not a WBS leaf.
5. **Replace, don't accrete, placeholder strings.** The placeholder
   `root.landing.body` ("Micro-frontend host app") and the title's reuse of
   `auth.login.title` ("Sign in") no longer fit a marketing hero. The hero's
   title/body come from new `landing.hero.*` keys; the now-unused
   `root.landing.body` placeholder is removed (and `root.landing.eyebrow` is
   either reused as the hero eyebrow or superseded by a `landing.hero.eyebrow`
   key — see Decision D2). Any catalog key this task orphans is deleted from all
   three primary catalogs so parity stays clean.
6. **Desktop-first accessible baseline, not the responsive audit.** Ship a
   coherent desktop layout with correct landmark/heading semantics; defer the
   cross-breakpoint pass and the full a11y audit to the existing
   `landing_responsive_a11y` leaf. Do not regress the `<main>` scroll-region
   idiom or its `data-allow-scroll` marker (`LandingRoute.tsx:42-54`), which the
   e2e no-scrollbars harness depends on.
7. **No `.tji` edits, no commit, no ADR, no backend.** The implementer lands
   components + strings + tests; the closer updates the WBS. This task reuses
   existing seams only (Decision D6).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):** `apps/root/src/routes/LandingRoute.test.tsx`
(updated) and/or co-located section-component tests pin, for an **unauthenticated**
render:

1. **The hero renders** with the product name, the value-prop, and the
   hypothesis copy — asserted via a stable `data-testid` (e.g.
   `landing-hero`) and the resolved en-US strings from the new `landing.hero.*`
   keys (a single `<h1>` is present).
2. **"How it works" renders** (`data-testid` e.g. `landing-how-it-works`) with
   its heading and the three points (two debaters + moderator; one shared graph;
   consensus-gated) resolving from their catalog keys.
3. **"What it surfaces" renders** (`data-testid` e.g. `landing-what-it-surfaces`)
   with its heading and the three diagnostic goals (contradictions, category
   mismatches, axioms) resolving from their catalog keys.
4. **The demo embed is still present** (`data-testid="landing-walkthrough"`),
   proving the narrative composition did not displace the demo.
5. **Auth branching preserved** (retained from `split_public_and_home_routes`'s
   suite): `loading → LoadingFrame`; `needs-screen-name → /screen-name`;
   `authenticated → Navigate('/home')` (no narrative rendered); the new
   sections render only for the unauthenticated visitor.

**Playwright (e2e — inline in `tests/e2e/landing-demo.spec.ts`, NOT deferred):**
the narrative sections are **reachable today** (they render in `LandingRoute`'s
unauthenticated branch at `/`, which `split_public_and_home_routes` already made
the anonymous public surface). Per the e2e-policy guidance — when the terminal
catch-all leaf (`landing_e2e`) already inherits coverage from multiple leaves
(hero/method, open-source, mobile, responsive, demo-narration), pay debt down
with a thin inline spec rather than deferring everything — this task extends the
existing public-`/` spec:

6. An anonymous visit to `/` renders the three narrative sections
   (`landing-hero`, `landing-how-it-works`, `landing-what-it-surfaces` all
   visible) alongside the walkthrough demo (`landing-walkthrough` visible).

The **fuller** journey — narrative + stepping the demo through to the final
graph state with the matching caption, plus the public/home split and the
mobile/responsive behavior — remains owned by `landing_e2e`
(`tasks/47-landing-page.tji:172-182`), which depends on this task plus the
remaining content/demo/polish leaves and is the proper home for the end-to-end
assertion. **No new e2e task is registered** (`landing_e2e` already exists and
already depends on this task).

**i18n / parity gate:** `packages/i18n-catalogs/scripts/check-parity.ts` passes
with the new narrative keys present in all three primary catalogs, every new key
appended to both `*.review.json` `pending` arrays, and no orphaned placeholder
key left behind (constraint 5).

**Full-suite gate (per the global build/test rule):** the workspace build
succeeds; `apps/root`'s Vitest suite (existing + new) stays green; lint /
typecheck clean. (Doc-only? No — this task ships source + strings + tests, so
the full build/test gate applies.)

**No Cucumber scenario is in scope:** this task changes no wire behavior,
broadcast shape, or projector output — it is pure client-side presentational
content rendering localized strings.

No new follow-up WBS tasks are spawned by this refinement. The only deferred
item is the **native-speaker translation review**, which is human-judgment work
and stays on the parked translation-review item (surfaced to the parking lot,
**not** a WBS leaf — `tasks/47-landing-page.tji:86-87`).

## Decisions

**D1 — Three co-located presentational section components composed into
`LandingRoute`.** Add `apps/root/src/landing/HeroSection.tsx`,
`HowItWorksSection.tsx`, and `WhatItSurfacesSection.tsx` (a new `landing/`
sibling to `walkthrough/`), each a pure `useTranslation()`-driven component, and
compose them in `LandingRoute`'s unauthenticated branch around the existing
`<section data-testid="landing-walkthrough">`.
*Rationale:* mirrors the one-component-per-concern convention the demo leaves
used (`WalkthroughCaption`, `WalkthroughDemoNarrated`) and keeps `LandingRoute`
a thin composition root; each section is an independent, easily-unit-tested
unit, and `landing_responsive_a11y` later restyles them without disturbing the
route's auth logic. *Alternative rejected:* inlining all three sections as raw
JSX inside `LandingRoute` — it bloats the route file, mixes content with
auth-state branching, and gives the responsive/a11y leaf one tangled blob to
work against instead of clean section seams.

**D2 — New copy lives under a `landing.hero.*` / `landing.howItWorks.*` /
`landing.surfaces.*` key shape, extending the existing `landing.*` namespace.**
Suggested concrete keys (implementer may refine the leaf names, but the
namespace and en-US-authored + PENDING-tracked workflow are fixed):
`landing.hero.{eyebrow,title,hypothesis}`;
`landing.howItWorks.title` + `landing.howItWorks.items.{participants,sharedGraph,consensus}.{title,body}`;
`landing.surfaces.title` + `landing.surfaces.items.{contradictions,categories,axioms}.{title,body}`.
The placeholder `root.landing.body` is removed; `root.landing.eyebrow` is either
reused as `landing.hero.eyebrow` or replaced by it (one product-name string, not
two).
*Rationale:* keeps all landing-page copy under one `landing.*` namespace
alongside `landing.demo.*` (the demo leaves' precedent), so the catalog reads as
one coherent surface; the nested `items.<slug>.{title,body}` shape matches the
`landing.demo.caption.<slug>.{…}` shape the narration leaf established, so parity
tooling and translators see a familiar structure. *Alternative rejected:* a new
top-level `marketing.*` namespace — needless fragmentation; the landing page is
one surface and its strings belong together.

**D3 — The narrative copy is the canonical methodology prose; the demo captions
are reconciled to it (catalog-only), never the reverse, and not in this task.**
`walkthrough_narration_script` declared its caption copy provisional pending this
task's hero wording, with no code dependency. This task authors the hero/method
prose freely; if a later editorial pass wants the captions to echo the hero's
exact phrasing, that is a catalog-string touch in a future polish pass, not a
code change and not a blocker here.
*Rationale:* the two surfaces were deliberately decoupled at the code level
(`walkthrough_demo_narration.md:63-65`); forcing them to share strings now would
couple unrelated components. Keeping captions and narrative as independent
catalog entries lets each be tuned for its context (a one-line caption beside a
graph vs. a prose section). *Alternative rejected:* sharing catalog keys between
the demo captions and the narrative sections — they read in different contexts
and at different lengths; sharing would force a compromise wording that serves
neither.

**D4 — Desktop-first layout; cross-breakpoint + a11y audit deferred to the
existing `landing_responsive_a11y` leaf (no new task).** This task ships correct
landmark/heading semantics and a clean desktop arrangement (hero above the demo,
"how it works" / "what it surfaces" around it) and preserves the `<main>`
scroll-region idiom.
*Rationale:* `landing_responsive_a11y` already exists and `depends
!landing_hero_and_method` (`tasks/47-landing-page.tji:162`) precisely to own the
whole-page responsive + accessibility polish; duplicating that scope here would
double-own it. The semantic baseline this task ships is what that leaf refines.
*Alternative rejected:* doing the full responsive/a11y pass inline — it would
overrun the 2d estimate and collide with the leaf chartered for it.

**D5 — Leave the existing CTA affordances in place; do not redesign them (owned
by `landing_opensource_and_cta`).** The hero retains a functional
`root-start-session` link and `<LoginButton>` so the page stays usable, but
their final placement/treatment as the page's *secondary* CTA is
`landing_opensource_and_cta`'s job (`tasks/47-landing-page.tji:91-101`).
*Rationale:* the `.tji` deliberately splits "sell the method" (this task) from
"the CTA / open-source / footer" (`landing_opensource_and_cta`) so the page sells
the methodology rather than a sign-up funnel; redesigning the CTA here would
straddle that boundary and risk churn when the CTA leaf lands. *Alternative
rejected:* dropping the CTA entirely from the hero now — it would leave the page
with no path to action between this task and the CTA leaf, a needless regression.

**D6 — No ADR.** This task reuses existing seams only: the `LandingRoute` mount
point and route ownership (ADR 0026), the `react-i18next` + ICU catalog workflow
and parity/PENDING-tracker convention (ADR 0024), Tailwind styling (ADR 0005),
and the demo embed shipped by the demo leaves. No new dependency, no new
architectural boundary, no security trade-off.
*Rationale:* the same bar the predecessors applied
(`split_public_and_home_routes` D6, `walkthrough_demo_narration` D5) — content
built on existing seams does not clear the ADR threshold. Task-scope decisions
are recorded here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- Replaced the developer placeholder at public `/` with a localized hero + methodology narrative composed around the existing walkthrough demo (`apps/root/src/routes/LandingRoute.tsx`).
- Added three co-located presentational section components: `apps/root/src/landing/HeroSection.tsx`, `HowItWorksSection.tsx`, `WhatItSurfacesSection.tsx`.
- Authored 17 new en-US copy keys under `landing.{hero,howItWorks,surfaces}.*` in `packages/i18n-catalogs/src/catalogs/en-US.json`; machine-translated to `pt-BR.json` and `es-419.json`; all 17 keys appended to `pending` arrays in `pt-BR.review.json` and `es-419.review.json`.
- Parity gate (`scripts/check-parity.ts`) passes; `root.landing.*` keys retained (consumed by `HomeRoute.tsx:55,60`) per deviation note below.
- Constraint 5 / D2 deviation: `root.landing.body` and `root.landing.eyebrow` were not orphaned — `HomeRoute.tsx` still consumes both. Retained them and added a fresh `landing.hero.eyebrow` key for the marketing hero instead of deleting.
- Updated `apps/root/src/routes/LandingRoute.test.tsx` with 5 new Vitest cases (hero h1, "how it works", "what it surfaces", demo-embed-preserved, CTA-affordances) + 3 preserved auth-branch tests.
- Extended `tests/e2e/landing-demo.spec.ts` with an anonymous-visit narrative-sections assertion (criterion 6).
- Fixer pass: updated `tests/e2e/fixtures/locales.ts` and `tests/e2e/i18n-moderator-smoke.spec.ts` to assert `landing.hero.title` (instead of the stale `auth.login.title` placeholder) as the public `/` H1 across all three locales.
