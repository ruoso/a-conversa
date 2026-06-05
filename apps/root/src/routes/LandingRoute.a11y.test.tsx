// Structural accessibility pins for the assembled public landing route
// (`landing_page.landing_responsive_a11y`, Decision §D3 / acceptance criteria
// 1-2). These are the fast jsdom half of the a11y audit: landmark count,
// single-`h1`, a monotonic heading outline, accessible-name presence on every
// landmark, and no focus-suppression / positive-tabindex structural defects.
// The computed-style facts a real browser is needed for — colour contrast (the
// axe scan), the visible focus indicator, focus order, reflow, and
// reduced-motion behaviour — are pinned in `tests/e2e/landing-demo.spec.ts`
// (Decisions §D2/§D3, ADR 0040), not here.
//
// In jsdom the lazy `WalkthroughDemoNarrated` never resolves (it pulls in the
// Cytoscape renderer), so the demo's own inner region is not mounted; the
// walkthrough area is represented by its named wrapper `<section>` (the
// `landing-walkthrough` embed, named via `landing.demo.embedRegionLabel`).

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { LandingRoute } from './LandingRoute';
import { getTestI18n, renderWithProviders } from '../testing/renderWithProviders';

beforeAll(async () => {
  await getTestI18n();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function HomeStub(): ReactElement {
  return <main data-testid="route-home-stub" />;
}

function ScreenNameStub(): ReactElement {
  return <main data-testid="route-screen-name-stub" />;
}

function renderAnonymousLanding() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/home" element={<HomeStub />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
    </Routes>,
    {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
      initialEntries: ['/'],
    },
  );
}

/** Map an `h1`..`h6` heading element to its numeric level. */
function headingLevel(el: HTMLElement): number {
  const explicit = el.getAttribute('aria-level');
  if (explicit !== null) return Number(explicit);
  return Number(el.tagName.slice(1));
}

describe('LandingRoute structural a11y', () => {
  it('exposes exactly one main landmark and exactly one level-1 heading (the hero title)', async () => {
    renderAnonymousLanding();
    await screen.findByTestId('landing-hero');

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toBe(screen.getByTestId('route-landing'));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toBe(screen.getByTestId('route-title'));
  });

  it('descends the heading outline monotonically with no skipped level', async () => {
    const { container } = renderAnonymousLanding();
    await screen.findByTestId('landing-hero');

    const headings = Array.from(
      container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    ).map(headingLevel);

    // There is at least the hero h1 plus the section h2s.
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(headings[0]).toBe(1);
    // Walking the outline top-to-bottom, a level may stay, drop, or rise by at
    // most one — never jump (e.g. h2 -> h4) past an intermediate level.
    let previous = headings[0] ?? 1;
    for (const level of headings.slice(1)) {
      expect(level - previous).toBeLessThanOrEqual(1);
      previous = level;
    }
    // The section headings are h2 and their items are h3 (no h4+ in the
    // jsdom-rendered chrome).
    expect(Math.max(...headings)).toBeLessThanOrEqual(3);
  });

  it('gives every landmark section and the footer a non-empty accessible name', async () => {
    const { container } = renderAnonymousLanding();
    await screen.findByTestId('landing-hero');

    // No `<section>` is a bare, unnamed landmark: each carries an
    // `aria-label` or an `aria-labelledby` that resolves to non-empty text.
    const sections = Array.from(container.querySelectorAll<HTMLElement>('section'));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const label = section.getAttribute('aria-label');
      const labelledBy = section.getAttribute('aria-labelledby');
      if (labelledBy !== null) {
        const target = container.querySelector(`[id="${labelledBy}"]`);
        expect(target?.textContent?.trim()).toBeTruthy();
      } else {
        expect(label?.trim()).toBeTruthy();
      }
    }

    // The footer is accessibly named. (It nests inside `<main>`, so it is a
    // generic rather than a `contentinfo` landmark, but it still carries a
    // localized `aria-label` so assistive tech can announce the region.)
    const footer = screen.getByTestId('landing-footer');
    expect(footer.tagName.toLowerCase()).toBe('footer');
    expect(footer.getAttribute('aria-label')?.trim()).toBeTruthy();
  });

  it('names the walkthrough wrapper region through i18n (resolves, not a raw key)', async () => {
    renderAnonymousLanding();
    const wrapper = await screen.findByTestId('landing-walkthrough');
    const name = wrapper.getAttribute('aria-label');
    expect(name).toBe('Walkthrough demonstration');
    // A missing catalog key would render the dotted path back instead.
    expect(name).not.toContain('landing.demo');
  });

  it('has no positive tabindex and exposes its controls as native focusable elements', async () => {
    const { container } = renderAnonymousLanding();
    const cta = await screen.findByTestId('landing-cta');

    // Constraint 3 structural half: nothing forces a positive tab order.
    const tabbables = Array.from(container.querySelectorAll<HTMLElement>('[tabindex]'));
    for (const el of tabbables) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }

    // The interactive affordances are real `a` / `button` / `select`
    // elements (reused native controls), not `div`/`span`-with-onClick.
    const NATIVE = new Set(['a', 'button', 'select', 'input', 'textarea']);
    const interactiveTestids = [
      'root-start-session',
      'auth-login-button',
      'landing-opensource-repo-link',
      'landing-opensource-license-link',
      'landing-locale-switcher',
    ];
    for (const testid of interactiveTestids) {
      const el = screen.getByTestId(testid);
      expect(NATIVE.has(el.tagName.toLowerCase())).toBe(true);
    }
    // The relocated CTA affordances live as native controls inside the CTA.
    expect(within(cta).getByTestId('root-start-session').tagName.toLowerCase()).toBe('a');
  });
});
