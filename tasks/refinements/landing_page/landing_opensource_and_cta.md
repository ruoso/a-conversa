# Refinement — `landing_page.landing_opensource_and_cta`

## TaskJuggler entry

Defined at `tasks/47-landing-page.tji:92-102`
(`task landing_opensource_and_cta` under `task landing_page`).
Back-link maintained by the closer.

```
task landing_opensource_and_cta "Open-source section, secondary call-to-action, footer" {
  effort 0.5d
  allocate team
  depends !split_public_and_home_routes
}
```

This task feeds milestone **M8-landing**. Its direct downstreams are
`landing_responsive_a11y` (`tasks/47-landing-page.tji:160-171`, whole-page
responsive + a11y polish, which `depends !landing_opensource_and_cta`) and the
terminal `landing_e2e` leaf (`tasks/47-landing-page.tji:173-183`), which asserts
an anonymous visit to `/` renders the narrative sections and the walkthrough
demo and that the public/home split holds.

## Effort estimate

`0.5d` (`effort 0.5d`, `allocate team`). The route shell, the section-component
convention, the i18n catalog workflow, the `persistLocale` / `SUPPORTED_LOCALES`
seam, and the `LoginButton` CTA primitive already exist. The work is: three more
co-located presentational components (open-source, secondary CTA, footer), a
small locale-switcher component, ~12 new localized strings (en-US authored +
machine pt-BR/es-419 + PENDING trackers), relocating the existing CTA affordances
out of the hero, and tests. No new architecture, no backend, no new dependency.

## Inherited dependencies

**`depends !split_public_and_home_routes`** — **Done (2026-06-03)**
(`tasks/refinements/landing_page/split_public_and_home_routes.md` § Status).
Everything this task builds on is on disk and green.

**Settled by `split_public_and_home_routes`:**

- `/` is the **public marketing surface**, anonymous-facing:
  `apps/root/src/routes/LandingRoute.tsx`. Its `<main>` carries
  `data-testid="route-landing"` (`LandingRoute.tsx:57`) and owns the page scroll
  region (`data-allow-scroll`, `:48-57`). The auth-state shepherding is in
  place: `loading → LoadingFrame` (`:26-28`), `needs-screen-name → /screen-name`
  (`:30-32`), `authenticated → /home` (`:41-43`); only the **unauthenticated**
  branch (`:45-96`) renders marketing content. This task adds sections to that
  branch's composition; it does **not** touch the auth-state branching.
- Authenticated users never see the public page (they are bounced to `/home`),
  so the open-source / CTA / footer chrome is written for the anonymous visitor
  only.

**Settled by `landing_hero_and_method` (Done 2026-06-03,
`tasks/refinements/landing_page/landing_hero_and_method.md` § Status):**

- The methodology narrative is composed into `LandingRoute`'s unauthenticated
  branch as three co-located presentational components in `apps/root/src/landing/`
  (`HeroSection.tsx`, `HowItWorksSection.tsx`, `WhatItSurfacesSection.tsx`),
  arranged around the `<section data-testid="landing-walkthrough">` demo embed
  (`LandingRoute.tsx:69-94`). This task adds **more** sections under the same
  convention; it does not modify the narrative sections' copy or the demo
  subtree.
- The hero **currently still carries the action affordances** —
  `root-start-session` link (→ `/m/sessions/new`) and `<LoginButton>` —
  (`HeroSection.tsx:46-55`). `landing_hero_and_method` Decision **D5** explicitly
  left them in the hero "so the page stays usable" and deferred **their final
  treatment as the page's *secondary* CTA to this task**
  (`landing_hero_and_method.md:359-368`). This task is where that final treatment
  is decided (Decision D2 below).
- The landing copy lives under one `landing.*` namespace in
  `packages/i18n-catalogs/src/catalogs/en-US.json` (`:11-106`), with machine
  pt-BR/es-419 and every dotted key tracked in the `pending` array of each
  `*.review.json` (the `landing.*` keys are already there —
  `pt-BR.review.json:390-440`). This task extends that namespace.

**Pending:** none — both dependencies are complete.

## What this task is

Add the **page chrome below the methodology pitch**: the open-source / "adopt
the format" section, the page's secondary call-to-action, and the footer with a
locale switcher. Concretely, three more co-located presentational components are
composed into `LandingRoute`'s unauthenticated branch after the narrative +
demo, plus a small locale-switcher in the footer:

1. **Open-source section** — a short "this is open source; adopt the format /
   self-host / read the code" pitch with a link to the public GitHub repository
   (`https://github.com/ruoso/a-conversa`) and the license
   (**AGPL-3.0-or-later**, the repo's actual license —
   `LICENSE` at repo root, SPDX header `AGPL-3.0-or-later`).
2. **Secondary call-to-action** — the "start a debate" / SSO-login affordances,
   presented as the page's *secondary* CTA (secondary because the page sells the
   methodology, not a sign-up funnel). This task **relocates** the existing
   `root-start-session` + `<LoginButton>` affordances out of the hero into a
   dedicated CTA section lower on the page (Decision D2), so the hero is pure
   pitch and the call-to-action follows the argument.
3. **Footer + locale switcher** — a `<footer>` landmark with the product line /
   license note and a control that lets the anonymous visitor switch the page
   language across the three supported locales (`en-US` / `pt-BR` / `es-419`),
   persisting the choice so it survives a reload.

All visible copy is localized through the catalog workflow (en-US authored,
machine pt-BR/es-419, PENDING review trackers). The real repo URL and license
identifier are content inputs, verified against the repo (see Inputs).

**Scope boundaries** (what this task does *not* own):

- **Cross-breakpoint responsive layout + the whole-page a11y audit** (landmarks,
  focus order, contrast, reduced-motion, keyboard operability) is
  `landing_responsive_a11y` (`tasks/47-landing-page.tji:160-171`), which
  `depends !landing_opensource_and_cta`. This task ships a sensible accessible
  baseline (a semantic `<footer>` landmark, labelled section headings, a labelled
  locale control) and a desktop-first layout — not the page-wide audit.
- **The narrative sections + demo subtree** are owned by `landing_hero_and_method`
  and the demo leaves. This task composes *around* them and removes only the CTA
  buttons from the hero (per the predecessor's deferral, D2); it does not touch
  the hero's name/value-prop/hypothesis copy, the `<h1>`, the narrative sections,
  or `apps/root/src/walkthrough/*`.
- **Native-speaker translation sign-off** stays on the **parked
  translation-review item** — not a WBS leaf (`tasks/47-landing-page.tji:87-88`,
  the same parking-lot item the narrative leaves used). This task authors en-US
  and ships machine pt-BR/es-419 with PENDING trackers.
- **The full end-to-end journey** (narrative + stepping the demo + public/home
  split + mobile/responsive) stays owned by the terminal `landing_e2e` leaf
  (`tasks/47-landing-page.tji:173-183`), which already `depends
  !landing_opensource_and_cta`. This task pays down a thin slice of that coverage
  inline (see Acceptance) rather than deferring everything to the catch-all.

## Why it needs to be done

The landing page exists to **sell the methodology** — "why better debate needs
this platform" — and to be *channel-agnostic*, "for anyone interested in debate
and how to make debates better" (`tasks/47-landing-page.tji:1-12`). Two of the
three pieces here are core to that framing:

- **Open source / adopt the format.** The pitch is the *method*, not a product
  funnel; the open-source section is where "adopt the format yourself / read and
  self-host the code" lands. Without it the page implies a closed product, which
  contradicts the channel-agnostic, method-first thesis. The repo is real and
  public (`git@github.com:ruoso/a-conversa.git`) under a copyleft license
  (AGPL-3.0-or-later), so the link and license statement are honest content, not
  placeholders.
- **Secondary CTA.** The page still needs a path to action — but *secondary*, so
  the methodology argument leads and the "start a debate / sign in" affordances
  follow it rather than dominating the hero.
- **Footer + locale switcher.** The page is localized in three locales
  (ADR 0024); an anonymous visitor with no account has no other way to pick a
  language (the cookie/navigator negotiation runs at bootstrap but offers no
  in-page control). The switcher is the visitor-facing control ADR 0024's
  negotiation seam explicitly anticipated ("the locale-selector control",
  `packages/i18n-catalogs/src/negotiation.ts:219-221,236-237`).

M8-landing gates M9 (Deployment ready): `a-conversa.org` must not ship with a
half-built marketing page (`tasks/47-landing-page.tji:9-12`). This task and the
narrative leaf together replace the developer placeholder with the full pitch;
`landing_responsive_a11y` then polishes the layout both lay down, and
`landing_e2e` pins the whole anonymous journey.

## Inputs / context

- **WBS block:** `tasks/47-landing-page.tji:92-102` (this task), content brief in
  its `note` (`:96-101`); architecture note `tasks/47-landing-page.tji:1-20`.
- **The route to edit:** `apps/root/src/routes/LandingRoute.tsx`.
  - `:45-96` — the unauthenticated marketing render; `:58` the centered
    `mx-auto … max-w-3xl flex flex-col … gap-6` column the new sections slot
    into, after `<WhatItSurfacesSection />` (`:94`).
  - `:26-43` — loading / needs-screen-name / authenticated branches — **left
    intact**.
  - `:48-57` — the `<main data-testid="route-landing" data-allow-scroll>`
    scroll-region idiom (the e2e no-scrollbars harness depends on it —
    `tests/e2e/fixtures/no-scrollbars.ts`); **do not regress it**.
- **The hero whose CTA affordances move here:** `apps/root/src/landing/HeroSection.tsx`.
  - `:46-55` — the `<div>` holding the `root-start-session` `<Link to="/m/sessions/new">`
    (label `moderator.createSession.title`) and `<LoginButton>`. Decision D2
    relocates this block into the new CTA section; the hero keeps its eyebrow /
    `<h1>` / hypothesis (`:35-45`).
  - `landing_hero_and_method`'s Vitest "CTA-affordances" case
    (`apps/root/src/routes/LandingRoute.test.tsx`) asserts these are present;
    it moves with the affordances (Constraint 6).
- **The CTA primitive:** `packages/shell/src/login-logout/LoginButton.tsx` —
  renders `<a href="/api/auth/login" role="button">` (a full-page OIDC redirect),
  text from i18n key `auth.login.button` ("Sign in with SSO"), props
  `className?` + `data-testid?` (default `auth-login-button`). Exported from
  `@a-conversa/shell`. Reused as-is for the secondary CTA.
- **The locale-switch seam** (`packages/i18n-catalogs/src`, exported from
  `@a-conversa/i18n-catalogs`):
  - `config.ts:55` — `SUPPORTED_LOCALES = ['en-US', 'pt-BR', 'es-419'] as const`
    (display order); `SupportedLocale` type.
  - `negotiation.ts:201-216` — `persistLocale(locale)` writes the
    `aconversa_locale` cookie (`LOCALE_COOKIE_NAME`, one-year Max-Age, `Lax`,
    `Secure` over HTTPS); `:222-227` — `clearLocaleCookie()` for a future "use
    browser default" affordance. The bootstrap negotiation reads this cookie
    first (`negotiateAuthenticatedLocale`, `:251-254`), so a persisted choice
    survives reload.
  - **Runtime switch precedent:** the audience surface re-configures the shared
    i18n via `i18n.changeLanguage(locale)` inside a `useEffect`
    (`apps/audience/src/App.tsx:~78-86`, "First production consumer of
    `negotiateUrlLocale`"). The switcher here is the **first production caller of
    `persistLocale`** (the helper shipped 2026-05-11 with no caller — the
    landing switcher is exactly its intended consumer).
  - i18n is wired app-wide via `apps/root/src/main.tsx` (`createI18nInstance`),
    so `i18n.changeLanguage` re-renders every `useTranslation()` consumer for
    free; no per-component re-wiring.
- **i18n catalogs (where new copy lands):**
  - en-US source: `packages/i18n-catalogs/src/catalogs/en-US.json` — extend the
    `landing.*` namespace (`:11-106`) with `landing.openSource.*` /
    `landing.cta.*` / `landing.footer.*` keys, beside `landing.demo.*` /
    `landing.hero.*` / `landing.howItWorks.*` / `landing.surfaces.*`.
  - Machine translations: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.json`.
  - PENDING trackers: `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json`
    — append every new dotted key to the `pending` array (the existing
    `landing.*` keys at `pt-BR.review.json:390-440` show the shape).
  - Parity gate: `packages/i18n-catalogs/scripts/check-parity.ts` enforces
    key-set parity across the three primary catalogs and ignores `*.review.json`
    by filename.
- **Content inputs (verified against the repo, not invented):**
  - GitHub repository URL: `https://github.com/ruoso/a-conversa` (from
    `git remote -v` → `git@github.com:ruoso/a-conversa.git`). Not a translated
    string — a module constant (Decision D4).
  - License: **AGPL-3.0-or-later** (`LICENSE` at repo root, SPDX
    `AGPL-3.0-or-later`; `package.json` `"license": "AGPL-3.0-or-later"`). The
    license link target is the GitHub `LICENSE` file
    (`https://github.com/ruoso/a-conversa/blob/main/LICENSE`).
- **Test conventions:**
  - Vitest: `apps/root/src/routes/LandingRoute.test.tsx` (the route composition
    test) + co-located component tests; render helpers `renderWithProviders` /
    `getTestI18n` from `apps/root/src/testing/renderWithProviders.tsx`.
  - Playwright: `tests/e2e/landing-demo.spec.ts` (the existing public-`/` spec —
    the natural place for thin chrome assertions, per `landing_hero_and_method`).
- **ADRs:** 0024 (react-i18next + ICU + per-locale catalogs — the i18n/catalog
  workflow + the locale-negotiation seam), 0026 (root-app micro-frontend — route
  ownership), 0005 (Tailwind — styling), 0008 (Playwright), 0022 (no throwaway
  verifications).
- **Predecessor / sibling refinements:**
  `tasks/refinements/landing_page/split_public_and_home_routes.md`,
  `tasks/refinements/landing_page/landing_hero_and_method.md`.

## Constraints / requirements

1. **Anonymous-only chrome; auth branching untouched.** The new sections render
   only in `LandingRoute`'s unauthenticated branch (`LandingRoute.tsx:45-96`).
   The loading / needs-screen-name / authenticated-→-`/home` branches
   (`:26-43`) are preserved verbatim — authenticated users still never see the
   marketing page.
2. **Three semantic, labelled sections.** Open-source (a labelled `<section>`),
   secondary CTA (a labelled `<section>`), and the footer (a `<footer>`
   landmark), each with a stable `data-testid`. Composed after the narrative +
   demo in the existing `<main>` column.
3. **Real, honest content.** The GitHub link points at
   `https://github.com/ruoso/a-conversa` and opens in a new tab with
   `rel="noopener noreferrer"`; the license is stated as **AGPL-3.0-or-later**
   and links to the repo's `LICENSE`. No placeholder URLs / licenses.
4. **All copy localized via the catalog workflow.** New strings are authored
   en-US under the `landing.*` namespace, machine-translated to pt-BR/es-419, and
   every new dotted key is appended to both `*.review.json` `pending` arrays.
   `scripts/check-parity.ts` must pass with the new keys present in all three
   primary catalogs. No marketing string is hard-coded in a component (the
   catalog is the one source of truth — the narrative leaves' rule). URLs and the
   SPDX identifier are *not* translated strings and live as module constants
   (Decision D4).
5. **The CTA is genuinely secondary.** The action affordances are presented below
   the methodology pitch, not in the hero. Reuse the existing `LoginButton`
   primitive and a `<Link to="/m/sessions/new">`; do not add a new auth path or
   duplicate the affordances in two places.
6. **Preserve affordance testids when relocating.** Moving `root-start-session`
   and `auth-login-button` out of the hero must keep those exact `data-testid`s
   so the auth-flow Playwright scenarios that select them stay green
   (`tests/e2e/auth-flow.spec.ts` scenario 5 `landing-to-lobby` selects
   `root-start-session`; selection is position-independent). The
   `landing_hero_and_method` Vitest CTA-affordances assertion moves to the new
   CTA section's test rather than being deleted.
7. **Locale switch persists and re-renders in place.** Selecting a locale calls
   `i18n.changeLanguage(tag)` (re-renders every `useTranslation()` consumer) and
   `persistLocale(tag)` (cookie, so the choice survives reload). The control is
   driven by `SUPPORTED_LOCALES` (no hard-coded locale list) and is a labelled,
   keyboard-operable control. It must not navigate or reload the page.
8. **Desktop-first accessible baseline, not the responsive audit.** Ship correct
   landmark/heading semantics (a real `<footer>`, labelled sections, a labelled
   locale control) and a clean desktop arrangement; defer the cross-breakpoint
   pass + full a11y audit to `landing_responsive_a11y`. Do not regress the
   `<main>` scroll-region idiom / `data-allow-scroll` marker
   (`LandingRoute.tsx:48-57`).
9. **No `.tji` edits, no commit, no backend.** The implementer lands components +
   strings + tests; the closer updates the WBS. This task reuses existing seams
   only (Decision D5).

## Acceptance criteria

Per **ADR 0022** (no throwaway verifications) every check below is a durable,
committed test artifact.

**Vitest (component — `apps/root`):** co-located component tests +
`apps/root/src/routes/LandingRoute.test.tsx` (updated) pin, for an
**unauthenticated** render:

1. **Open-source section renders** (`data-testid` e.g. `landing-opensource`) with
   its heading, the GitHub link resolving to `https://github.com/ruoso/a-conversa`
   (assert the `href` and `rel="noopener noreferrer"`), and the license stated as
   AGPL-3.0-or-later linking to the repo `LICENSE` — copy resolving from the new
   `landing.openSource.*` keys.
2. **Secondary CTA section renders** (`data-testid` e.g. `landing-cta`) with the
   relocated `root-start-session` link (`href` → `/m/sessions/new`) and the
   `auth-login-button` (`LoginButton`), and its heading/body from
   `landing.cta.*`. This is the migrated `landing_hero_and_method`
   CTA-affordances assertion (Constraint 6).
3. **Hero no longer renders the CTA affordances** — update
   `landing_hero_and_method`'s hero assertions: the hero still renders its
   eyebrow / `<h1>` / hypothesis, but `root-start-session` / `auth-login-button`
   are no longer inside `landing-hero` (they now live in `landing-cta`).
4. **Footer renders** (`<footer data-testid="landing-footer">`) containing the
   locale switcher and the product/license line, copy from `landing.footer.*`.
5. **Locale switcher behavior** (`data-testid` e.g. `landing-locale-switcher`):
   it offers one option per `SUPPORTED_LOCALES`; selecting a non-active locale
   calls `i18n.changeLanguage(tag)` **and** `persistLocale(tag)` (assert via a
   spy / by reading the rendered language or the `aconversa_locale` cookie), and
   a visible string (e.g. a heading) re-renders in the chosen locale. The control
   does not navigate.
6. **Composition + auth branching preserved** (`LandingRoute.test.tsx`): for an
   unauthenticated visit, hero + narrative + demo + the three new sections all
   render; the `loading → LoadingFrame`, `needs-screen-name → /screen-name`,
   `authenticated → Navigate('/home')` branches are retained (no chrome rendered
   for non-anonymous states).

**Playwright (e2e — inline in `tests/e2e/landing-demo.spec.ts`, NOT deferred):**
the new chrome is **reachable today** (it renders in `LandingRoute`'s
unauthenticated branch at `/`). Following `landing_hero_and_method`'s precedent —
when the terminal catch-all `landing_e2e` already inherits coverage from several
leaves, pay debt down with a thin inline spec rather than deferring — extend the
existing public-`/` spec with:

7. An anonymous visit to `/` shows the footer (`landing-footer`), the open-source
   GitHub link (assert its `href`), and the secondary CTA (`landing-cta` with
   `root-start-session` visible).
8. Clicking the locale switcher's `pt-BR` option re-renders a visible heading in
   Portuguese (the page language changes in place, no navigation), exercising the
   `changeLanguage` + `persistLocale` path end-to-end.

The **fuller** journey — narrative + stepping the demo to the final graph state +
the public/home split + mobile/responsive behavior — remains owned by
`landing_e2e` (`tasks/47-landing-page.tji:173-183`), which already depends on
this task. **No new e2e task is registered.**

**i18n / parity gate:** `packages/i18n-catalogs/scripts/check-parity.ts` passes
with the new `landing.openSource.*` / `landing.cta.*` / `landing.footer.*` keys
present in all three primary catalogs and every new key appended to both
`*.review.json` `pending` arrays.

**No Cucumber scenario is in scope:** this task changes no wire behavior,
broadcast shape, or projector output — it is pure client-side presentational
content + a client-only locale switch (the cookie write is a browser-local
preference, not a protocol or replay seam).

**Full-suite gate (per the global build/test rule):** the workspace build
succeeds; `apps/root`'s Vitest suite (existing + new) stays green; the
`i18n-catalogs` parity test passes; lint / typecheck clean. (Doc-only? No — this
task ships source + strings + tests, so the full build/test gate applies.)

**No new follow-up WBS tasks are spawned by this refinement.** The only deferred
items are human-judgment, not agent-implementable work, and stay off the WBS:
the **native-speaker translation review** (parked translation-review item,
`tasks/47-landing-page.tji:87-88`) and the question of whether the locale
switcher should later be **lifted into `@a-conversa/shell`** for reuse at
screen-name capture (Decision D3 — surfaced to the parking lot, not a WBS leaf).

## Decisions

**D1 — Three more co-located presentational components + one locale-switcher,
composed into `LandingRoute`.** Add
`apps/root/src/landing/OpenSourceSection.tsx`, `CallToActionSection.tsx`, and
`LandingFooter.tsx` (each a pure `useTranslation()`-driven component), plus
`apps/root/src/landing/LocaleSwitcher.tsx` rendered inside the footer; compose
the three sections in `LandingRoute`'s unauthenticated branch after
`<WhatItSurfacesSection />`.
*Rationale:* mirrors the one-component-per-concern convention the narrative leaf
established (`HeroSection`, `HowItWorksSection`, `WhatItSurfacesSection`) and
keeps `LandingRoute` a thin composition root; each piece is independently
unit-testable, and `landing_responsive_a11y` later restyles them without touching
the route's auth logic. *Alternative rejected:* inlining the chrome as raw JSX in
`LandingRoute` — it bloats the route file and gives the responsive/a11y leaf a
tangled blob instead of clean section seams.

**D2 — Relocate the action affordances from the hero into a dedicated secondary
CTA section; do not duplicate them.** `landing_hero_and_method` D5 explicitly
deferred the CTA's "final treatment" here. The final treatment is: the hero
becomes pure pitch (eyebrow + `<h1>` + hypothesis), and the
`root-start-session` `<Link>` + `<LoginButton>` move into
`CallToActionSection.tsx` placed below the narrative + demo. The affordance
testids (`root-start-session`, `auth-login-button`) are preserved exactly
(Constraint 6).
*Rationale:* this is the cleanest realization of "secondary because the page
sells the method, not a sign-up funnel" (`tasks/47-landing-page.tji:97-99`) — the
call-to-action follows the argument rather than competing with the hypothesis at
the top of the page. Preserving the testids means the auth-flow Playwright
scenarios (which select by testid, position-independent) stay green; only the
hero's own CTA-affordances Vitest assertion moves to the CTA section's test.
*Alternative rejected:* keeping the buttons in the hero AND adding a second CTA
block at the bottom — it duplicates the same affordances in two places (and two
`auth-login-button` testids), muddying both the DOM and the "secondary" framing.
*Alternative rejected:* leaving the buttons in the hero and making this task's
"CTA" purely the open-source/footer chrome — it would ignore the predecessor's
explicit deferral of the CTA's final treatment to this task and leave the
top-of-funnel framing the `.tji` argues against.

**D3 — The locale switcher lives in `apps/root/src/landing/` (one call site),
not in `@a-conversa/shell`.** Build it as a landing-local component now.
*Rationale:* the simpler abstraction with a single call site today (the
predecessors' bar — `split_public_and_home_routes` D6,
`landing_hero_and_method` D6); it reuses the shared `persistLocale` /
`SUPPORTED_LOCALES` / `i18n.changeLanguage` seam without inventing a package
boundary. ADR 0024's negotiation comments anticipate a *second* future consumer —
"the locale-selector control at screen-name capture"
(`negotiation.ts:236-237`). If and when that screen-name control is built,
lifting the switcher into `shell` is a defensible extraction *at that point*
(two call sites). That is a future product/refactor decision, **not** an
ADR-level seam and **not** a WBS leaf I can pre-commit — surfaced to the parking
lot. *Alternative rejected:* building it in `shell` now for a hypothetical second
consumer — speculative generality for a call site that doesn't exist yet.

**D4 — URLs and the SPDX license identifier are module constants, not catalog
strings; only the visible *labels* are localized.** The GitHub repo URL
(`https://github.com/ruoso/a-conversa`), the `LICENSE` link, and the literal
SPDX tag `AGPL-3.0-or-later` live as `const`s in `OpenSourceSection.tsx`; the
link text and surrounding prose come from `landing.openSource.*` catalog keys.
*Rationale:* a URL is not translated content — putting it in three catalogs would
invite drift and a parity hazard for a value that is identical across locales.
The SPDX identifier is a stable machine token; the human sentence around it
("Licensed under …") is the localized part. This keeps the "no hard-coded
*copy*" rule (Constraint 4) intact while not abusing the catalog for invariant
data. *Alternative rejected:* the full "Licensed under AGPL-3.0-or-later"
sentence as one catalog string with the tag baked in — fine, but keeping the tag
as a constant lets the license note and any future `package.json`-driven check
share one source of truth.

**D5 — No ADR.** This task reuses existing seams only: the `LandingRoute` mount
point and route ownership (ADR 0026), the `react-i18next` + ICU catalog workflow
and parity/PENDING-tracker convention (ADR 0024), the locale-negotiation
helpers `persistLocale` / `SUPPORTED_LOCALES` / `i18n.changeLanguage` that
ADR 0024 already governs (and whose comments anticipate exactly this
locale-selector control), the `LoginButton` CTA primitive from `@a-conversa/shell`,
and Tailwind styling (ADR 0005). No new dependency, no new architectural
boundary, no security trade-off (the `aconversa_locale` cookie is non-`HttpOnly`,
host-only, `SameSite=Lax` by design — a pre-existing, ADR-0024-sanctioned client
preference, not introduced here).
*Rationale:* the same bar the predecessors applied
(`split_public_and_home_routes` D6, `landing_hero_and_method` D6) — content +
chrome built on existing seams does not clear the ADR threshold. Task-scope
decisions are recorded here.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-03.

- `apps/root/src/landing/OpenSourceSection.tsx` — open-source section with real GitHub link (`https://github.com/ruoso/a-conversa`) and AGPL-3.0-or-later license pointer.
- `apps/root/src/landing/CallToActionSection.tsx` — secondary CTA section; hosts relocated `root-start-session` link + `<LoginButton>` (affordance testids preserved).
- `apps/root/src/landing/LandingFooter.tsx` — `<footer data-testid="landing-footer">` with product/license line and `<LocaleSwitcher>`.
- `apps/root/src/landing/LocaleSwitcher.tsx` — `SUPPORTED_LOCALES`-driven `<select>` calling `i18n.changeLanguage` + `persistLocale`; keyboard-operable, labelled.
- `apps/root/src/landing/{OpenSourceSection,CallToActionSection,LandingFooter}.test.tsx` — co-located Vitest tests (3 + 2 + 4 cases).
- `apps/root/src/landing/HeroSection.tsx` — CTA affordances removed (relocated); hero is now pure pitch.
- `apps/root/src/routes/LandingRoute.tsx` — three new sections composed after `<WhatItSurfacesSection />`; auth branching untouched.
- `apps/root/src/routes/LandingRoute.test.tsx` — updated: hero-no-CTA assertion + new section/footer presence assertions.
- `packages/i18n-catalogs/src/catalogs/{en-US,pt-BR,es-419}.json` — 10 new `landing.openSource.*` / `landing.cta.*` / `landing.footer.*` keys; en-US authored, pt-BR/es-419 machine.
- `packages/i18n-catalogs/src/catalogs/{pt-BR,es-419}.review.json` — 10 new keys appended to `pending`.
- `tests/e2e/landing-demo.spec.ts` — 2 inline Playwright specs: footer/GitHub link/CTA visibility + locale switcher re-renders in Portuguese in place.
