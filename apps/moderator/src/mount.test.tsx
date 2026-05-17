import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('moderator surface mount()', () => {
  it('mounts the moderator route tree under the provided basename and returns an unmount fn', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: {
        userId: '00000000-0000-4000-8000-000000000001',
        screenName: 'alice',
      },
      refresh: () => undefined,
      logout: () => undefined,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.history.replaceState({}, '', '/m/sessions/new');

    let unmount!: () => void;
    act(() => {
      unmount = mount({
        container,
        auth,
        i18n: i18n as unknown as I18n,
        routerBasePath: '/m',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-create-session')).toBeTruthy();
    });

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });
});
