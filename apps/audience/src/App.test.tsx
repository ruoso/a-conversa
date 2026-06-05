// Vitest routing cases for the audience surface `<App>` route table.
//
// Refinement: tasks/refinements/replay_test/replay_mode_audience_surface.md
//   (Acceptance criterion 3 — the replay routes mount `<AudienceReplayRoute>`
//   for both the bare and locale-prefixed shapes; non-replay paths still
//   resolve to the live session routes / placeholder; the wildcard stays
//   the fallback.)
// ADRs:        0022 (no throwaway verifications).
//
// The two route leaf components are mocked to sentinels so this file pins
// the *route table* (which path maps to which component) without standing
// up the WS client (`AudienceLiveRoute`) or the REST log loader
// (`AudienceReplayRoute`) — those are pinned by their own component tests.

import { type ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  AuthValueProvider,
  I18nProvider,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
} from '@a-conversa/shell';

vi.mock('./routes/AudienceLiveRoute.js', () => ({
  AudienceLiveRoute: (): ReactElement => <div data-testid="live-route-sentinel" />,
}));
vi.mock('./routes/AudienceReplayRoute.js', () => ({
  AudienceReplayRoute: (): ReactElement => <div data-testid="replay-route-sentinel" />,
}));

const { App } = await import('./App');

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

const authenticatedAuth: AuthContextValue = {
  status: 'authenticated',
  user: { userId: '00000000-0000-4000-8000-000000000003', screenName: 'maria' },
  refresh: () => undefined,
  logout: () => undefined,
};

let i18nInstance: I18nInstance;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
});

function renderAt(path: string): void {
  render(
    <I18nProvider i18n={i18nInstance}>
      <AuthValueProvider value={authenticatedAuth}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthValueProvider>
    </I18nProvider>,
  );
}

describe('App route table — replay routes', () => {
  it('mounts <AudienceReplayRoute> at the bare /replay/:sessionId shape', () => {
    renderAt(`/replay/${SESSION_ID}`);
    expect(screen.getByTestId('replay-route-sentinel')).toBeTruthy();
  });

  it.each([['en-US'], ['pt-BR']])(
    'mounts <AudienceReplayRoute> at the locale-prefixed shape (%s)',
    (locale) => {
      renderAt(`/${locale}/replay/${SESSION_ID}`);
      expect(screen.getByTestId('replay-route-sentinel')).toBeTruthy();
    },
  );

  it('non-replay session URL still resolves to <AudienceLiveRoute>', () => {
    renderAt(`/sessions/${SESSION_ID}`);
    expect(screen.getByTestId('live-route-sentinel')).toBeTruthy();
    expect(screen.queryByTestId('replay-route-sentinel')).toBeNull();
  });

  it('a non-session, non-replay path falls through to the placeholder', () => {
    renderAt('/foo/bar');
    expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('replay-route-sentinel')).toBeNull();
    expect(screen.queryByTestId('live-route-sentinel')).toBeNull();
  });

  it('the wildcard remains the fallback at the surface root', () => {
    renderAt('/');
    expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
  });
});
