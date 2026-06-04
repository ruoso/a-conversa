// End-to-end spec for the public landing walkthrough demo — drives the
// anonymous `/` marketing surface against the dev compose stack and pins
// that the interactive demo renders and steps.
//
// Refinement: tasks/refinements/landing_page/walkthrough_demo_stepper.md
// ADRs:        docs/adr/0008-e2e-framework-playwright.md
//              docs/adr/0026-root-app-micro-frontend.md
//              docs/adr/0039-graph-view-package-boundary.md
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: landing_page.walkthrough_demo_stepper
//
// **Why this spec lands inline (not deferred to `landing_e2e`).** Two
// predecessor refinements (`extract_readonly_graph_package`,
// `landing_walkthrough_seed`) already point their deferred coverage at the
// terminal `landing_e2e` leaf. Per the UI-stream e2e policy's "2+ inherited
// refinements → pay debt down, scope a small spec inline" guidance, this
// task lands a thin spec rather than deferring everything.
//
// **What this spec pins.** The demo is reachable today: it is embedded on
// `/`, which renders for anonymous visitors (an authenticated visitor is
// bounced to `/home` before the marketing body renders). This spec asserts
//   1. an anonymous visit to `/` renders the walkthrough demo (the
//      Cytoscape canvas container + the controls are visible), and
//   2. clicking / keyboard-activating **next** advances the step-status
//      indicator.
//
// Because the graph paints to a `<canvas>` (no DOM node-count seam, and no
// `window` cy hook by design — extract Decision §8), this spec asserts on
// the **step-status DOM** + control affordance-state, not canvas contents.
// The fuller end-to-end assertion (steps through to the final graph state
// with the matching localized caption) stays owned by `landing_e2e`, which
// depends on `walkthrough_demo_narration` (captions).

import { expect, test } from './fixtures/no-scrollbars';

test.describe('landing walkthrough demo', () => {
  test('anonymous / renders the walkthrough demo with its renderer and controls', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      // The marketing surface itself.
      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

      // The lazy-loaded demo subtree resolves; the shared renderer's
      // container and the control chrome paint.
      await expect(page.getByTestId('walkthrough-demo')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-prev')).toBeVisible();
      await expect(page.getByTestId('walkthrough-next')).toBeVisible();
      await expect(page.getByTestId('walkthrough-scrubber')).toBeVisible();
      await expect(page.getByTestId('walkthrough-step-status')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('next advances the step-status; the controls are keyboard-operable', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      const status = page.getByTestId('walkthrough-step-status');
      await expect(status).toBeVisible({ timeout: 15_000 });

      const before = Number(await status.getAttribute('data-position'));
      expect(Number.isFinite(before)).toBe(true);

      // Pointer activation increments the position.
      await page.getByTestId('walkthrough-next').click();
      await expect(status).toHaveAttribute('data-position', String(before + 1), {
        timeout: 5_000,
      });

      // Keyboard operability: focus the native button and activate with
      // the keyboard (Enter), which must advance the position again.
      const next = page.getByTestId('walkthrough-next');
      await next.focus();
      await expect(next).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(status).toHaveAttribute('data-position', String(before + 2), {
        timeout: 5_000,
      });
    } finally {
      await context.close();
    }
  });

  // Mobile-viewport coverage for `landing_demo_mobile_fallback`. The
  // compact variant is reachable today: an anonymous visit to `/` at a
  // phone-width viewport mounts it in place of the heavy interactive
  // stepper (the `matchMedia` gate in `WalkthroughDemoNarrated`). These
  // scenarios pin (5) that the compact demo renders with its renderer +
  // segment buttons + step-status and that the scrubber is *not* present
  // (proving the heavy variant was never instantiated), and (6) that
  // next-segment advances the step-status by a beat jump (6 → 27) and is
  // keyboard-operable. They assert on the step-status DOM + affordance
  // state, not on `<canvas>` contents (no DOM node-count seam; no `window`
  // cy hook by design — ADR 0039 / stepper Decision §8). The fuller
  // through-to-final-state + matching-caption journey stays owned by
  // `landing_e2e`.
  const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

  test('anonymous / at a phone viewport renders the compact demo without the scrubber', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: PHONE_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

      // The compact variant mounts: the shared renderer's container, the
      // segment buttons, and the step-status paint.
      await expect(page.getByTestId('walkthrough-demo-compact')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-prev')).toBeVisible();
      await expect(page.getByTestId('walkthrough-next')).toBeVisible();
      await expect(page.getByTestId('walkthrough-step-status')).toBeVisible();

      // The heavy interactive variant was NOT mounted: no scrubber, no
      // play-toggle, and not the full demo's section.
      await expect(page.getByTestId('walkthrough-scrubber')).toHaveCount(0);
      await expect(page.getByTestId('walkthrough-play-toggle')).toHaveCount(0);
      await expect(page.getByTestId('walkthrough-demo')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('next-segment advances the step-status by a beat jump and is keyboard-operable', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: PHONE_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      const status = page.getByTestId('walkthrough-step-status');
      await expect(status).toBeVisible({ timeout: 15_000 });

      // The compact variant opens on the first beat anchor (position 6).
      await expect(status).toHaveAttribute('data-position', '6', { timeout: 5_000 });

      // Pointer activation jumps a whole beat (6 → 27), not +1.
      await page.getByTestId('walkthrough-next').click();
      await expect(status).toHaveAttribute('data-position', '27', { timeout: 5_000 });

      // Keyboard operability: focus the native button and activate with the
      // keyboard (Enter), which advances to the next beat anchor (27 → 42).
      const next = page.getByTestId('walkthrough-next');
      await next.focus();
      await expect(next).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(status).toHaveAttribute('data-position', '42', { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  // Thin narrative-section assertion for `landing_hero_and_method`. The
  // three methodology sections (hero, "how it works", "what it surfaces")
  // render in `LandingRoute`'s unauthenticated branch and are reachable
  // today on the anonymous `/`. This pins that they compose around — and do
  // not displace — the walkthrough demo. The fuller stepped journey stays
  // owned by the terminal `landing_e2e` leaf.
  test('anonymous / renders the narrative sections alongside the walkthrough demo', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

      // The three methodology narrative sections.
      await expect(page.getByTestId('landing-hero')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('landing-how-it-works')).toBeVisible();
      await expect(page.getByTestId('landing-what-it-surfaces')).toBeVisible();

      // ...composed around the demo, which is still present.
      await expect(page.getByTestId('landing-walkthrough')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  // Thin caption assertion for `walkthrough_demo_narration`. Proves the
  // per-step caption is reachable on the anonymous `/` and tracks position
  // end-to-end through the real renderer (not just jsdom). The fuller
  // through-to-final-state + matching-localized-text journey stays owned by
  // the terminal `landing_e2e` leaf.
  test('the narration caption is visible on load and tracks position', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      // On load the caption shows the first beat (pos 6 = `opening` anchor).
      const caption = page.getByTestId('walkthrough-caption');
      await expect(caption).toBeVisible({ timeout: 15_000 });
      await expect(caption).toHaveAttribute('data-beat', 'opening', { timeout: 5_000 });

      // Scrubbing to a later anchor (pos 100 = `classification`) advances
      // the active beat — the caption follows the stepper's position.
      await page.getByTestId('walkthrough-scrubber').fill('100');
      await expect(caption).toHaveAttribute('data-beat', 'classification', { timeout: 5_000 });
    } finally {
      await context.close();
    }
  });

  // Thin chrome assertion for `landing_opensource_and_cta`. The page chrome
  // below the methodology pitch (open-source pitch, secondary CTA, footer) is
  // reachable today on the anonymous `/`. This pins that it renders with the
  // honest GitHub link and the relocated CTA affordance. The fuller journey
  // stays owned by the terminal `landing_e2e` leaf.
  test('anonymous / renders the open-source section, secondary CTA, and footer', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });

      // The open-source section with the honest GitHub link.
      await expect(page.getByTestId('landing-opensource')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('landing-opensource-repo-link')).toHaveAttribute(
        'href',
        'https://github.com/ruoso/a-conversa',
      );

      // The secondary CTA hosting the relocated start-session affordance.
      await expect(page.getByTestId('landing-cta')).toBeVisible();
      await expect(page.getByTestId('root-start-session')).toBeVisible();

      // The footer landmark with the locale switcher.
      await expect(page.getByTestId('landing-footer')).toBeVisible();
      await expect(page.getByTestId('landing-locale-switcher')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // Exercises the `changeLanguage` + `persistLocale` path end-to-end: picking
  // the `pt-BR` option re-renders a visible heading in Portuguese in place
  // (no navigation). The fuller responsive/locale journey stays owned by
  // `landing_e2e`.
  test('the locale switcher re-renders the page in Portuguese in place', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await page.goto('/');

      const switcher = page.getByTestId('landing-locale-switcher');
      await expect(switcher).toBeVisible({ timeout: 15_000 });

      // en-US baseline: the open-source heading reads in English.
      await expect(page.getByTestId('landing-opensource')).toContainText('Built in the open');

      const urlBefore = page.url();
      await switcher.selectOption('pt-BR');

      // The heading re-renders in Portuguese with no navigation.
      await expect(page.getByTestId('landing-opensource')).toContainText('Feito de forma aberta', {
        timeout: 5_000,
      });
      expect(page.url()).toBe(urlBefore);
    } finally {
      await context.close();
    }
  });
});
