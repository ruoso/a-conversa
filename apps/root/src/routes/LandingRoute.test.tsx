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

function HomeStub(): ReactElement {
  return <main data-testid="route-home-stub" />;
}

function renderLanding(initialPath: string, options: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/home" element={<HomeStub />} />
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

  it('redirects an authenticated visitor to /home without rendering the dashboard or consuming return-to', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('route-home-stub')).toBeTruthy();
    });
    // `/` no longer renders the dashboard card...
    expect(screen.queryByTestId('route-home')).toBeNull();
    expect(screen.queryByTestId('root-open-moderator')).toBeNull();
    // ...and no longer consumes the return-to — that is `/home`'s job.
    expect(window.sessionStorage.getItem('a-conversa:return-to')).toBe('/m/sessions/new');
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
    // The hero retains a functional CTA (Decision §D5) — the start-a-session
    // link plus the SSO login button.
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
