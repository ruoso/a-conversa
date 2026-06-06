import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
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

function ScreenNameStub(): ReactElement {
  return <main data-testid="route-screen-name-stub" />;
}

function DeepLinkStub(): ReactElement {
  return <main data-testid="route-deep-link-stub" />;
}

function renderLanding(initialPath: string, options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/m/sessions/new" element={<DeepLinkStub />} />
      <Route path="/screen-name" element={<ScreenNameStub />} />
    </Routes>,
    { ...(options ?? {}), initialEntries: [initialPath] },
  );
}

describe('LandingRoute', () => {
  it('renders the LoadingFrame while auth is resolving and does not render route-landing', async () => {
    renderLanding('/', {
      auth: {
        status: 'loading',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-landing')).toBeNull();
  });

  it('navigates to /screen-name when status is needs-screen-name', async () => {
    renderLanding('/', {
      auth: {
        status: 'needs-screen-name',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-screen-name-stub')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-landing')).toBeNull();
  });

  it('consumes a remembered return-to for an authenticated visitor and navigates to it, clearing the slot', async () => {
    window.sessionStorage.setItem('a-conversa:return-to', '/m/sessions/new');

    renderLanding('/', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000010',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    // `/` is where the OIDC callback's returning-user 302 lands, so it is
    // now the single consumer of the remembered deep-link return-to.
    await waitFor(() => {
      expect(screen.getByTestId('route-deep-link-stub')).toBeTruthy();
    });
    expect(screen.queryByTestId('route-landing')).toBeNull();
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBeNull();
  });

  it('renders the landing surface as the home for an authenticated visitor with no return-to', async () => {
    renderLanding('/', {
      auth: {
        status: 'authenticated',
        user: {
          userId: '00000000-0000-4000-8000-000000000011',
          screenName: 'alice',
        },
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-landing')).toBeTruthy();
    });
    // The authenticated home keeps the start-session affordance and swaps
    // the secondary action to a logout link (no anonymous SSO button).
    expect(screen.getByTestId('root-start-session')).toBeTruthy();
    expect(screen.getByTestId('root-logout-link')).toBeTruthy();
    expect(screen.queryByTestId('auth-login-button')).toBeNull();
  });

  it('keeps the functional CTA affordances and the public testid for anonymous visitors', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('root-start-session')).toBeTruthy();
    });
    // The functional CTA affordances (start-a-session link + SSO login) are
    // still on the page — relocated into the secondary CTA section, not the
    // hero (`landing_opensource_and_cta` Decision §D2).
    expect(screen.getByTestId('auth-login-button')).toBeTruthy();
    // The public surface uses the new `route-landing` testid, not `route-home`.
    expect(screen.queryByTestId('route-landing')).toBeTruthy();
    expect(screen.queryByTestId('route-home')).toBeNull();
  });

  it('renders the hero with the product name, value-prop, and hypothesis under a single h1', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const hero = await screen.findByTestId('landing-hero');
    // Exactly one `<h1>` on the page, and it is the hero's value-prop title.
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(screen.getByTestId('route-title')).toBe(h1s[0]);
    // i18n-resolved en-US strings — a missing key would render the dotted
    // path back instead of these.
    expect(hero.textContent).toContain('a-conversa');
    expect(hero.textContent).toContain('See exactly where a disagreement actually is.');
    expect(hero.textContent).toContain('talking past each other');
    // The hero is now pure pitch: the CTA affordances were relocated into the
    // secondary CTA section, so they no longer live inside `landing-hero`
    // (`landing_opensource_and_cta` Decision §D2).
    expect(hero.querySelector('[data-testid="root-start-session"]')).toBeNull();
    expect(hero.querySelector('[data-testid="auth-login-button"]')).toBeNull();
  });

  it('renders the open-source section with the GitHub link and the AGPL license', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const section = await screen.findByTestId('landing-opensource');
    expect(section.textContent).toContain('Built in the open');
    expect(section.textContent).toContain('AGPL-3.0-or-later');

    const repoLink = screen.getByTestId('landing-opensource-repo-link');
    expect(repoLink.getAttribute('href')).toBe('https://github.com/ruoso/a-conversa');
    expect(repoLink.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the secondary CTA section hosting the relocated affordances', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const cta = await screen.findByTestId('landing-cta');
    expect(cta.textContent).toContain('Start a debate');
    // The relocated affordances live inside the CTA section now.
    expect(cta.querySelector('[data-testid="root-start-session"]')).not.toBeNull();
    expect(cta.querySelector('[data-testid="auth-login-button"]')).not.toBeNull();
  });

  it('renders the footer landmark with the locale switcher', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const footer = await screen.findByTestId('landing-footer');
    expect(footer.tagName.toLowerCase()).toBe('footer');
    expect(footer.querySelector('[data-testid="landing-locale-switcher"]')).not.toBeNull();
  });

  it('renders the "how it works" section with its heading and three points', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const section = await screen.findByTestId('landing-how-it-works');
    expect(section.textContent).toContain('How it works');
    expect(section.textContent).toContain('Two debaters, one moderator');
    expect(section.textContent).toContain('One shared, living graph');
    expect(section.textContent).toContain('Nothing lands until everyone agrees');
  });

  it('renders the "what it surfaces" section with its heading and three diagnostic goals', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    const section = await screen.findByTestId('landing-what-it-surfaces');
    expect(section.textContent).toContain('What it surfaces');
    expect(section.textContent).toContain('Internal contradictions');
    expect(section.textContent).toContain('Category mismatches');
    expect(section.textContent).toContain('Bedrock axioms');
  });

  it('keeps the walkthrough demo embed composed alongside the narrative sections', async () => {
    renderLanding('/', {
      auth: {
        status: 'unauthenticated',
        refresh: () => undefined,
        logout: () => undefined,
      },
    });

    // The narrative composition must not displace the demo embed.
    expect(await screen.findByTestId('landing-walkthrough')).toBeTruthy();
  });
});
