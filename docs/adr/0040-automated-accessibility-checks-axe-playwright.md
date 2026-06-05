# 0040 — Automated accessibility checks via `@axe-core/playwright`

## Status

Accepted

## Context

The public landing page (`landing_page.*` work-stream) is the project's first
fully-anonymous, marketing-facing surface, and the WBS carries a dedicated
whole-page accessibility leaf (`landing_page.landing_responsive_a11y`,
`tasks/47-landing-page.tji:162-173`). Its `.tji` note explicitly scopes
"landmarks, headings, focus order, contrast, the demo's keyboard operability
and reduced-motion handling."

Most of that list is pinnable with the seams we already have:

- **Landmarks / headings / ARIA roles** — `@testing-library/react` role queries
  in Vitest (ADR 0006) already assert structure in jsdom, the dominant pattern
  across the landing component suites.
- **Focus order / keyboard operability / reduced-motion behaviour** — Playwright
  (ADR 0008) drives the real browser, presses keys, reads focus, and emulates
  `prefers-reduced-motion`.

**Contrast is the gap.** WCAG colour-contrast is a function of *computed* colour
against *computed* background at render time. jsdom has no layout and no
computed colour, so a Vitest assertion cannot evaluate it; a one-off manual
eyeball check is exactly the throwaway verification ADR 0022 forbids. The only
durable way to pin contrast is to evaluate it in a real browser against the
rendered page — which is where Playwright already runs.

A second, smaller gap: a structural Vitest test pins the *handful of landmark /
heading invariants we think to assert*, but does not catch the long tail of
WCAG issues (orphaned form controls, duplicate landmark roles without names,
invalid ARIA attribute combinations, list/heading nesting). An audited
rule-engine run is a stronger net than hand-rolled role queries for that tail.

`axe-core` is the de-facto standard accessibility rule engine; `@axe-core/playwright`
is its thin, officially-maintained Playwright integration that injects the
engine into a live page and returns violations. It runs only in the e2e harness
(dev/CI), ships nothing to production, and reuses the compose-stack e2e layer we
already operate (ADR 0008).

## Decision

Adopt **`@axe-core/playwright`** as a dev-only dependency and use it to run an
`axe` analysis of the live, real-browser-rendered page inside Playwright specs,
asserting zero violations for the **WCAG 2.0/2.1 Level A and AA** rule tags
(`['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']`).

- The axe scan is the **durable contrast (and broad WCAG-AA) gate**. It is the
  e2e-layer complement to, not a replacement for, the structural Vitest role
  queries and the behavioural Playwright focus/keyboard/reduced-motion scenarios
  — both of which stay.
- The first consumer is the public landing surface
  (`landing_page.landing_responsive_a11y`), scanning anonymous `/` at desktop
  and phone viewports. The seam is general: future authenticated surfaces
  (moderator console, participant tablet, audience broadcast) may adopt the same
  scan, scoped to their reachable routes, when their own a11y leaves land.
- Scans assert against a **declared, reviewed rule-tag set**, not "every rule."
  Best-practice / experimental tags are out of scope unless a later refinement
  opts in, so the gate stays deterministic and a green run means "no Level A/AA
  violation," not "axe found nothing to mention."

## Consequences

- **New dev dependency.** `@axe-core/playwright` (and its `axe-core` peer) join
  the workspace's dev dependencies, installed via pnpm (ADR 0010). No runtime
  bundle impact — it is never imported by app code.
- **Contrast becomes a committed, CI-enforced check** rather than a manual pass,
  satisfying ADR 0022 for the one a11y dimension jsdom cannot reach.
- **Determinism risk is bounded** by pinning the rule-tag set. If axe's bundled
  ruleset changes across a version bump and surfaces a new Level A/AA finding, CI
  goes red on the upgrade PR — the intended behaviour (a real regression surfaced
  at upgrade time), handled like any other dependency bump.
- **Not a substitute for human a11y judgement.** axe catches machine-checkable
  WCAG failures; it cannot judge whether alt text is *meaningful* or focus order
  is *sensible*. Those stay covered by the behavioural Playwright scenarios and,
  where a human call is genuinely required, the parking lot — not a WBS "audit"
  leaf.
- **Visual-regression and axe are orthogonal.** A `*_vr_*` snapshot pins pixels;
  axe pins WCAG conformance. Neither subsumes the other.
