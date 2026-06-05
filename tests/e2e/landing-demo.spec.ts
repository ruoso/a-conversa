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

import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures/no-scrollbars';

// The declared WCAG rule-tag set the axe scan asserts against (ADR 0040):
// Level A + AA for WCAG 2.0 and 2.1. Best-practice / experimental tags are
// deliberately excluded so a green run means "no Level A/AA violation."
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

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

  // ---------------------------------------------------------------------------
  // Page-wide accessibility + responsive pins for `landing_responsive_a11y`
  // (acceptance criteria 3-7). These land inline rather than deferring to the
  // terminal `landing_e2e` leaf: the whole page is reachable today (an
  // anonymous visit to `/` renders it) and `landing_e2e` already inherits
  // coverage from five leaves, so per the UI-stream e2e policy we pay the debt
  // down here. The fuller stepped-through-to-final-state journey stays owned by
  // `landing_e2e`.
  // ---------------------------------------------------------------------------

  const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
  const AXE_PHONE_VIEWPORT = { width: 390, height: 844 } as const;
  const NARROW_PHONE_VIEWPORT = { width: 360, height: 740 } as const;

  // Criterion 3: automated WCAG-AA scan at a desktop viewport. This is the
  // durable colour-contrast + broad-WCAG gate (ADR 0040 / Decision §D2) — the
  // one a11y dimension jsdom cannot evaluate. Scanned after the lazy demo has
  // resolved so the real, fully-painted page is audited.
  test('axe reports no WCAG 2.0/2.1 A/AA violations on anonymous / (desktop)', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: DESKTOP_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-demo')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
      // Map to `id (nodeCount)` so a failure names the rule(s) instead of
      // dumping the full violation objects.
      const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
      expect(summary).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // Criterion 4: the same WCAG-AA scan at the phone viewport, where the
  // **compact** demo variant is mounted — so the small-screen assembly is held
  // to the same bar.
  test('axe reports no WCAG 2.0/2.1 A/AA violations on anonymous / (phone)', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: AXE_PHONE_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-demo-compact')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('audience-graph-root')).toBeVisible({ timeout: 15_000 });

      const results = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
      const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);
      expect(summary).toEqual([]);
    } finally {
      await context.close();
    }
  });

  // Criterion 5: focus order + visible focus indicator. Repeated Tab presses
  // move focus through the page in DOM order — the demo controls (which precede
  // the chrome below the methodology pitch) are reached before the footer
  // locale switcher — with no keyboard trap, and each control shows a non-empty
  // computed focus outline (constraint 3; the page-wide `:focus-visible` ring is
  // not suppressed by any `outline-none`). Keyboard *activation* of the demo
  // controls is already pinned above; this adds the *order* + *indicator*
  // assertion.
  test('Tab order flows in DOM order with a visible focus indicator and no trap', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: DESKTOP_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-demo')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-next')).toBeVisible();

      const MAX_TABS = 40;
      const order: string[] = [];
      const focusByTestid = new Map<string, { outlineWidth: string; outlineStyle: string }>();

      for (let i = 0; i < MAX_TABS; i += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null) return null;
          const style = window.getComputedStyle(el);
          return {
            testid: el.getAttribute('data-testid'),
            outlineWidth: style.outlineWidth,
            outlineStyle: style.outlineStyle,
          };
        });
        if (focused?.testid != null && focused.testid !== '') {
          order.push(focused.testid);
          focusByTestid.set(focused.testid, {
            outlineWidth: focused.outlineWidth,
            outlineStyle: focused.outlineStyle,
          });
          if (focused.testid === 'landing-locale-switcher') break;
        }
      }

      // No keyboard trap: tabbing reaches the footer locale switcher.
      expect(order).toContain('landing-locale-switcher');
      // DOM order: the demo's next control precedes the footer switcher.
      expect(order).toContain('walkthrough-next');
      expect(order.indexOf('walkthrough-next')).toBeLessThan(
        order.indexOf('landing-locale-switcher'),
      );

      // Each expected control showed a non-empty, visible focus indicator —
      // a real outline (style !== none, width !== 0), not `outline-none`.
      for (const id of ['walkthrough-next', 'root-start-session', 'landing-locale-switcher']) {
        const focus = focusByTestid.get(id);
        expect(focus, `${id} should have been a keyboard tab stop`).toBeDefined();
        expect(focus?.outlineStyle).not.toBe('none');
        expect(focus?.outlineWidth).not.toBe('0px');
      }
    } finally {
      await context.close();
    }
  });

  // Criterion 6: no horizontal overflow across breakpoints. At a narrow phone
  // width and at a desktop width the document never scrolls horizontally, and
  // the key sections are present — pinning the page-level reflow (constraint 2).
  test('the assembled page has no horizontal overflow at phone or desktop widths', async ({
    browser,
  }) => {
    for (const viewport of [NARROW_PHONE_VIEWPORT, DESKTOP_VIEWPORT]) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
      const page = await context.newPage();
      try {
        await page.goto('/');

        await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });
        for (const id of [
          'landing-hero',
          'landing-how-it-works',
          'landing-opensource',
          'landing-cta',
          'landing-footer',
        ]) {
          await expect(page.getByTestId(id)).toBeVisible();
        }

        const metrics = await page.evaluate(() => {
          const el = document.scrollingElement ?? document.documentElement;
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        });
        // 1 px tolerance matches the no-scrollbars fixture (fractional-pixel
        // layout rounding can report scrollWidth one pixel larger than client).
        expect(
          metrics.scrollWidth,
          `horizontal overflow at ${viewport.width}px (scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth})`,
        ).toBeLessThanOrEqual(metrics.clientWidth + 1);
      } finally {
        await context.close();
      }
    }
  });

  // Criterion 7: reduced motion respected end-to-end. Under
  // `prefers-reduced-motion: reduce` an anonymous desktop visit renders the
  // full demo with auto-advance off — the play toggle is `disabled` — confirming
  // the page honours the preference in a real browser, not just in jsdom (the
  // behaviour unit-tested in `WalkthroughDemo`).
  test('under prefers-reduced-motion the desktop demo loads with auto-advance disabled', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: DESKTOP_VIEWPORT,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    try {
      await page.goto('/');

      await expect(page.getByTestId('route-landing')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('walkthrough-demo')).toBeVisible({ timeout: 15_000 });

      await expect(page.getByTestId('walkthrough-play-toggle')).toBeDisabled();
    } finally {
      await context.close();
    }
  });
});
