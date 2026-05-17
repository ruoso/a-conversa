// Vitest case for the lobby placeholder destination route.
//
// Refinement: tasks/refinements/participant-ui/part_invite_acceptance.md
//              (Decision §1 — the placeholder owns the canonical
//              `/sessions/${id}/lobby` URL after the post-claim
//              navigation; the future `part_lobby_view` replaces it).
// ADR:         0022 (no throwaway verifications — pins the testid
//              surface that the happy-path Playwright spec relies on).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  AuthValueProvider,
  I18nProvider,
  createI18nInstance,
  type AuthContextValue,
  type I18nInstance,
} from '@a-conversa/shell';

import { LobbyPlaceholderRoute } from './LobbyPlaceholderRoute';

let i18nInstance: I18nInstance;

beforeAll(async () => {
  i18nInstance = await createI18nInstance('en-US');
});

afterEach(() => {
  cleanup();
});

// The placeholder mounts `<ParticipantChrome>` in the header slot,
// which reads `useAuth()` for the identity row. The route does NOT
// itself touch auth — but the chrome does, so the test wraps in an
// AuthValueProvider with a stub authenticated user.
const stubAuth: AuthContextValue = {
  status: 'authenticated',
  user: {
    userId: '00000000-0000-4000-8000-000000000003',
    screenName: 'ben',
  },
  refresh: () => undefined,
  logout: () => undefined,
};

describe('LobbyPlaceholderRoute', () => {
  it('renders the lobby-placeholder testid and surfaces the session id from useParams', () => {
    const sessionId = '00000000-0000-4000-8000-0000000000aa';

    render(
      <I18nProvider i18n={i18nInstance}>
        <AuthValueProvider value={stubAuth}>
          <MemoryRouter initialEntries={[`/sessions/${sessionId}/lobby`]}>
            <Routes>
              <Route path="/sessions/:id/lobby" element={<LobbyPlaceholderRoute />} />
            </Routes>
          </MemoryRouter>
        </AuthValueProvider>
      </I18nProvider>,
    );

    // The dedicated `lobby-placeholder` testid is the removal target
    // for `part_lobby_view`; pinning it here keeps the migration
    // contract explicit.
    expect(screen.getByTestId('lobby-placeholder')).toBeTruthy();
    // The path's `:id` round-trips through `useParams()` into the
    // `session-id` testid; the Playwright happy-path asserts on the
    // same testid end-to-end.
    expect(screen.getByTestId('session-id').textContent).toBe(sessionId);
  });
});
