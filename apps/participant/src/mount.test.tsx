// Vitest mount-boundary case for the participant surface.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
// ADRs:        0022 (no throwaway verifications — this case IS the
//                    regression pin for the moderator-mirrored shape).
//
// Mirrors `apps/moderator/src/mount.test.tsx` except for the surface
// name, the URL pushed into `window.history`, and the asserted testid.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('participant surface mount()', () => {
  it('mounts the participant route tree under the provided basename and returns an unmount fn', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: {
        userId: '00000000-0000-4000-8000-000000000002',
        screenName: 'ben',
      },
      refresh: () => undefined,
      logout: () => undefined,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.history.replaceState(
      {},
      '',
      '/p/sessions/00000000-0000-4000-8000-000000000099/invite?role=debater-A',
    );

    const unmount = mount({
      container,
      auth,
      i18n: i18n as unknown as I18n,
      routerBasePath: '/p',
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-participant-placeholder')).toBeTruthy();
    });

    unmount();
    expect(container.innerHTML).toBe('');
  });
});
