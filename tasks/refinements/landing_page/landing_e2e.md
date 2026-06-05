# landing_page.landing_e2e — refinement

## TaskJuggler

- WBS leaf: `task landing_e2e` in [`tasks/47-landing-page.tji:176`](../../47-landing-page.tji).
- Title: "Playwright cover for the public landing + walkthrough demo".
- This is the **terminal leaf** of the `m_public_landing` milestone — every
  other landing-page leaf is a `depends` predecessor of it.

## Effort estimate

`1d` (from the `.tji` block). This is a test-only task: it writes Playwright
assertions against an already-built, already-reachable surface. The full
landing page exists (hero/method, open-source/CTA, demo stepper + narration,
mobile fallback, responsive/a11y pass); nothing new is rendered here.

## Inherited dependencies

`depends !landing_hero_and_method, !landing_opensource_and_cta,
!walkthrough_demo_narration, !landing_demo_mobile_fallback,
!landing_responsive_a11y` (`tasks/47-landing-page.tji:179`).

All five predecessors are **settled** and have shipped inline Playwright
coverage into `tests/e2e/landing-demo.spec.ts`. Each one explicitly deferred
exactly one scenario to this leaf — the **fuller stepped journey through to
the final graph state with the matching localized caption** — and pinned the
rest inline. The deferred-debt ledger this task pays down:

| Predecessor refinement | Deferred to `landing_e2e` (quoted) |
| --- | --- |
| `landing_hero_and_method` | "the fuller journey — narrative + stepping the demo through to the final graph state with the matching caption … remains owned by `landing_e2e`" |
| `landing_opensource_and_cta` | "the fuller journey — narrative + stepping the demo to the final graph state … remains owned by the terminal `landing_e2e` leaf" |
| `walkthrough_demo_narration` | "the fuller assertion — stepping the demo *through to the final graph state with the matching localized caption text* — remains owned by `landing_e2e`" |
| `walkthrough_demo_stepper` | "the fuller end-to-end assertion — anonymous `/` steps the demo *through to the final graph state with the matching localized caption* — remains owned by the existing `landing_e2e` leaf" |
| `landing_demo_mobile_fallback` | "the fuller through-to-final-state + matching-localized-caption journey (across both desktop and mobile) stays owned by the terminal `landing_e2e` leaf" |
| `landing_responsive_a11y` | "the fuller stepped through-to-final-state + matching-localized-caption journey (across desktop and mobile) stays owned by the terminal `landing_e2e` leaf" |

Two non-`depends` siblings also point coverage here but are already settled by
existing leaves and need nothing new from this task: `walkthrough_narration_script`
("exercised end-to-end by the `landing_e2e` Playwright spec") and
`split_public_and_home_routes` ("the broader landing narrative + walkthrough-demo
e2e … is already owned by the existing WBS leaf `landing_e2e`").

**Pending:** none. Every predecessor has landed.

## What this task is

Land the **golden-path Playwright spec** that walks the public landing demo
end-to-end and pays down the single deferred scenario the five predecessors all
pointed here. Concretely: from an anonymous visit to `/`, step the interactive
walkthrough demo from the first beat (`opening`, position 6) **through every
beat to the finale** (`finale`, position 266), asserting at each beat anchor
that the step-status position lands on the anchor, the caption's active beat
(`data-beat`) is the expected slug, and the caption's **visible localized text**
matches the en-US narration catalog for that slug. The same through-to-final
walk is asserted on the mobile compact variant (segment-by-segment beat jumps
`6 → 27 → … → 266`). The spec also pins the **public/home split** at the
landing seam — an anonymous `/` renders the marketing surface and never
bounces.

These assertions land **inline in the existing `tests/e2e/landing-demo.spec.ts`**
(same file, same `chromium-landing` Playwright project), not in a new file —
the predecessors' thin pins already live there and the golden path is their
natural capstone.

## Why it needs to be done

The five predecessors each landed a *thin* inline pin (the demo renders, one
control advances, the caption tracks one scrub, the chrome renders, axe is
clean) and deferred the *fuller* journey to this terminal leaf — the
deliberate UI-stream-e2e-policy pattern of "pay debt down inline where the
surface is reachable, defer only the one capstone scenario to the catch-all."
Until this leaf lands, no committed test asserts that the demo actually drives
the graph through **all nine** methodology beats to the final state with the
**correct localized caption at each**, which is the whole pitch of the public
page (the walkthrough is the product demo). It is also the leaf that closes the
`m_public_landing` milestone, so its Status block + `complete 100` is what lets
the milestone propagate.

## Inputs / context

- **WBS block + embedded note:** `tasks/47-landing-page.tji:176-186`. The note
  spells the spec: "an anonymous visit to `/` renders the narrative sections
  and the walkthrough demo; stepping the demo advances the graph through to the
  final state with the matching caption; `/home` requires auth (anonymous is
  routed to login). Asserts the public/home split holds."
- **The existing spec (extend this):** `tests/e2e/landing-demo.spec.ts:1-498`.
  Thirteen tests already cover: demo + controls render (`:44`), next advances
  one step + keyboard (`:68`), mobile compact renders without scrubber (`:115`),
  mobile next-segment beat jump (`:146`), narrative sections (`:185`), caption
  visible + tracks one scrub to `classification` (`:212`), open-source/CTA/footer
  (`:237`), locale switcher re-renders pt-BR in place (`:270`), axe WCAG-AA
  desktop (`:313`) + phone (`:341`), Tab order + focus ring (`:372`), no
  horizontal overflow (`:437`), reduced-motion disables auto-advance (`:478`).
  This task adds the **through-to-finale beat walk** the file's own comments
  repeatedly say "stays owned by `landing_e2e`" (e.g. `:30-32`, `:111-112`,
  `:210-211`, `:301-302`).
- **Beat table (the walk's anchors + slugs):**
  `apps/root/src/walkthrough/narration.ts:33-41` — `WALKTHROUGH_BEATS`:
  `opening`(6), `decompose`(27), `consensus`(42), `counter`(56),
  `contradiction`(86), `classification`(100), `axiom`(147),
  `interpretive_split`(196), `finale`(266). Activation rule
  (`narration.ts:46-47`): the active beat is the last beat whose anchor ≤
  position; below position 6 there is no active beat.
- **Caption element + seam:** `apps/root/src/walkthrough/WalkthroughCaption.tsx`
  — `data-testid="walkthrough-caption"`, `data-beat={slug ?? ''}`, title from
  `landing.demo.caption.<slug>.title`.
- **Stepper controls:** `apps/root/src/walkthrough/WalkthroughDemo.tsx:189-253`
  — `walkthrough-next` / `walkthrough-prev` buttons, `walkthrough-scrubber`
  (`<input type=range>`), `walkthrough-step-status` (`role=status`,
  `data-position`, `data-total`). Compact-variant controls (mobile):
  `walkthrough-next` / `walkthrough-prev` advance whole beats; no scrubber, no
  play-toggle (`WalkthroughDemoCompact.tsx`).
- **Localized-string lookup fixture (reuse this):**
  `tests/e2e/fixtures/locales.ts:17,41-56` — reads `CATALOGS[locale]` from
  `@a-conversa/i18n-catalogs` via a dotted-key `lookup()`, so a translation
  edit can never silently drift from the assertion. The `chromium-landing`
  project runs locale `en-US` (`playwright.config.ts:473-482`), so caption-text
  assertions resolve against `CATALOGS['en-US']`.
- **Public/home split, already pinned:** `tests/e2e/auth-flow.spec.ts` —
  scenario 6 `root-landing-new-user` (`:327`, authenticated lands on `/home`;
  anonymous `/home` routed to login) and scenario 7 `home-requires-auth`
  (`:404`, anonymous `/home` deflected into SSO, never renders the dashboard).
  `LandingRoute.tsx:44-46` redirects an authenticated visitor off `/` to
  `/home`; `App.tsx:41-56` is the route table.
- **Run harness:** `playwright.config.ts` (no `webServer` block —
  tests run against the live compose stack at `PLAYWRIGHT_BASE_URL` /
  `http://localhost:3000`); `make test:e2e:compose` brings the stack up, runs,
  and guarantees teardown; `pnpm run test:e2e` against an already-running
  stack. Per-locale projects pre-seed the `aconversa_locale` cookie.
- **ADRs:** [0008](../../../docs/adr/0008-e2e-framework-playwright.md)
  (Playwright is the browser/full-stack e2e layer against the compose stack),
  [0022](../../../docs/adr/0022-no-throwaway-verifications.md) (every empirical
  verification is a committed test in the right layer; browser-touching →
  Playwright under `tests/e2e/`), [0039](../../../docs/adr/0039-graph-view-package-boundary.md)
  (the graph paints to `<canvas>` with no `window.cy` hook — assert on the
  step-status / caption DOM, never canvas contents),
  [0024](../../../docs/adr/0024-frontend-i18n-react-i18next-with-icu.md)
  (catalogs + the `aconversa_locale` cookie).

## Constraints / requirements

1. **Extend, don't duplicate.** Add the golden-path test(s) to
   `tests/e2e/landing-demo.spec.ts` in the same `landing walkthrough demo`
   describe block, reusing the `no-scrollbars` fixture import and the existing
   anonymous-context pattern (`browser.newContext({ ignoreHTTPSErrors: true })`
   → `try { … } finally { context.close() }`). Do **not** re-assert what the
   thirteen existing tests already pin (single-step advance, chrome presence,
   axe, focus order, overflow, reduced-motion) — only the through-to-finale
   walk is new.
2. **Assert on the DOM seam, never the canvas** (ADR 0039). The walk reads
   `walkthrough-step-status`'s `data-position` and `walkthrough-caption`'s
   `data-beat` + visible title text. Canvas contents are out of bounds — there
   is no `window.cy` hook by design.
3. **Caption text is catalog-backed, not hardcoded.** Resolve the expected
   per-beat title from `CATALOGS['en-US']` (`landing.demo.caption.<slug>.title`)
   the way `tests/e2e/fixtures/locales.ts` does, so a copy edit updates the
   assertion automatically rather than reddening a stale literal. Promote/extend
   the `lookup` helper (or add a small caption-lookup helper alongside it) if a
   reusable seam is cleaner than inlining.
4. **Drive the walk through the public control surface**, not by poking
   internals: use the scrubber (`fill('<anchor>')`) and/or repeated
   `walkthrough-next` activation on desktop, and repeated `walkthrough-next`
   (beat-jump) on the mobile compact variant. The walk must reach
   `data-position="266"` with `data-beat="finale"`.
5. **Anonymous context only.** The landing surface renders for anonymous
   visitors; an authenticated context would be bounced to `/home`
   (`LandingRoute.tsx:44-46`). Use a fresh `browser.newContext()` with no auth
   storage state — matching every existing test in the file.
6. **No new app-source changes.** The selectors and seams this spec needs
   (`data-position`, `data-beat`, the control testids, the catalog keys) all
   exist. If a genuinely-missing seam surfaces, that is a defect in a
   predecessor, not new scope here — surface it rather than adding ad-hoc
   instrumentation.
7. **Test runs against the compose stack** (ADR 0008) and must pass under
   `make test:e2e:compose`. Keep the per-step `timeout` budget consistent with
   the file's existing `15_000` (first paint / lazy demo) and `5_000`
   (attribute settle) conventions.

## Acceptance criteria

All criteria are committed Playwright tests in
`tests/e2e/landing-demo.spec.ts`, run on the `chromium-landing` project against
the compose stack (ADR 0008, ADR 0022 — these are the deferred-debt scenarios
made permanent, not throwaway probes):

1. **Desktop through-to-finale beat walk.** From an anonymous `/`, walk the
   demo across all nine beat anchors in order (6, 27, 42, 56, 86, 100, 147, 196,
   266). At each anchor assert: (a) `walkthrough-step-status` `data-position`
   equals the anchor; (b) `walkthrough-caption` `data-beat` equals the expected
   slug; (c) the caption's visible title text equals
   `CATALOGS['en-US'].landing.demo.caption.<slug>.title`. The final assertion
   lands on `finale` / position 266 — the "final graph state with the matching
   caption" the WBS note names. (Pays down the deferred scenario from
   `landing_hero_and_method`, `landing_opensource_and_cta`,
   `walkthrough_demo_narration`, `walkthrough_demo_stepper`,
   `landing_responsive_a11y`.)
2. **Mobile compact through-to-finale beat walk.** At the `390×844` phone
   viewport, from an anonymous `/`, repeatedly activate `walkthrough-next` on
   the compact variant; assert the step-status advances anchor-to-anchor
   (`6 → 27 → … → 266`) and that at the terminal beat `data-beat="finale"` with
   its matching localized caption title. (Pays down the cross-desktop-and-mobile
   deferral from `landing_demo_mobile_fallback` and `landing_responsive_a11y`.)
3. **Public side of the public/home split.** An anonymous `/` renders
   `route-landing` (the marketing surface) and does **not** redirect to `/login`
   or `/home` — the page settles on `/`. This is the positive counterpart of the
   split named in the WBS note.
4. The full file (existing thirteen tests + the new walk tests) passes under
   `make test:e2e:compose`; no existing assertion is weakened or removed.

**The negative side of the public/home split is already pinned and is NOT
re-implemented here** — `auth-flow.spec.ts` scenario 6 (`root-landing-new-user`,
authenticated → `/home`; anonymous `/home` → login) and scenario 7
(`home-requires-auth`, anonymous `/home` deflected into SSO). The refinement
delegates to those rather than driving a second OIDC dance, per ADR 0022's
no-redundant-verification spirit (see Decision D3).

**No new WBS task is registered.** This leaf consumes the deferred debt; it does
not create any. There is no follow-on Playwright task downstream of it.

## Decisions

- **D1 — Extend `tests/e2e/landing-demo.spec.ts`, don't create a new spec
  file.** *Chosen* over a fresh `landing-golden-path.spec.ts`. The five
  predecessors landed their thin pins in this one file and its comments
  repeatedly name `landing_e2e` as the owner of the capstone walk; adding the
  walk beside them keeps all public-landing coverage in one project
  (`chromium-landing`, en-US) reusing the `no-scrollbars` fixture and the
  anonymous-context idiom. A separate file would fragment the surface's coverage
  and duplicate the fixture wiring for no benefit. *Rejected:* new file.
- **D2 — Assert the caption's visible localized text against the i18n catalog,
  not a hardcoded literal and not only the `data-beat` slug.** The deferral
  language is specific: "matching *localized caption text*." The existing
  narration test already pins the `data-beat` slug at two positions; the new
  contribution is asserting the *rendered words* match the script. Reusing
  `CATALOGS['en-US']` via the `locales.ts` `lookup` pattern (ADR 0024) keeps the
  assertion honest under copy edits — the rationale `locales.ts` itself states.
  *Rejected:* hardcoding nine English strings (brittle; drifts on any copy
  edit); asserting only `data-beat` (does not satisfy the "matching localized
  caption text" deferral — the slug is an internal id, not the user-visible
  pitch).
- **D3 — Delegate the negative public/home split (anonymous `/home` → login;
  authenticated `/` → `/home`) to the existing `auth-flow.spec.ts` scenarios;
  assert only the positive side (anonymous `/` renders, no bounce) here.**
  *Chosen* over re-driving the split in this spec. `auth-flow.spec.ts` already
  pins both directions crisply (scenarios 6 + 7) with the real OIDC dance via
  the `loginAs` fixture; re-implementing the redirect-to-login here would mean a
  second Authelia handshake for a contract already covered, which ADR 0022's
  no-redundant-verification spirit argues against. The WBS note's "asserts the
  public/home split holds" is honored: the positive side (anonymous gets the
  marketing page, never a redirect) lands inline, and the refinement names the
  canonical negative-side pins so the contract is demonstrably covered end-to-end.
  *Rejected:* duplicating the `/home`-requires-auth flow inside
  `landing-demo.spec.ts`.
- **D4 — Drive the walk through the public control surface (scrubber + next
  buttons), asserting on the step-status/caption DOM; never read the canvas.**
  Mandated by ADR 0039 (the graph paints to `<canvas>` with no `window.cy`
  hook). The step-status `data-position` and caption `data-beat`/title are the
  intended observable seams and are already how the file's existing tests assert.
  *Rejected:* any approach that inspects graph node counts or reaches for a cy
  instance — there is no such hook by design.
- **D5 — No new ADR.** This task introduces no new dependency, architectural
  seam, or security-relevant trade-off. It writes Playwright assertions in the
  established layer (ADR 0008) using the established catalog-lookup pattern (ADR
  0024) against existing seams (ADR 0039). The applicable decisions are all
  already recorded.

## Open questions

(none — all decided)

## Status

**Done** — 2026-06-04.

- Added three Playwright tests inside the `landing walkthrough demo` describe block in `tests/e2e/landing-demo.spec.ts`.
- Desktop golden-path test: scrubs all nine beat anchors (6→27→42→56→86→100→147→196→266), asserting `data-position`, `data-beat`, and visible `#walkthrough-caption-title` text against `CATALOGS['en-US']` at each step (AC1).
- Mobile compact test: phone viewport (`390×844`), repeated `walkthrough-next` beat-jumps through all anchors 6→266, same per-beat assertions (AC2).
- Public/home split pin: anonymous `/` renders `route-landing` and pathname settles on `/`, never bounces to `/login` or `/home` (AC3).
- Exported the `lookup` helper from `tests/e2e/fixtures/locales.ts` so caption-title assertions resolve catalog-backed rather than hardcoded strings (constraint 3 / D2).
- Closes the `m_public_landing` milestone — `landing_e2e` was the terminal leaf all five predecessors deferred the capstone through-to-finale walk to.
