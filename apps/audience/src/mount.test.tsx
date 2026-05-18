// Vitest mount-boundary case for the audience surface.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
// ADRs:        0022 (no throwaway verifications — this case IS the
//                    regression pin for the participant-mirrored shape).
//
// Mirrors the authenticated-mount slice of
// `apps/participant/src/mount.test.tsx`. The audience skeleton has no
// chrome, no defensive `auth.user === undefined` guard, no WS store —
// one case is enough at this tier:
//
//   - the mount export wires the React tree under the host-supplied
//     basename + auth + i18n,
//   - the placeholder testid renders,
//   - the returned UnmountFn tears the container down.
//
// The locale read inside `<App />` runs as a side effect on the shared
// i18n instance but isn't asserted here — that assertion belongs in
// `aud_url_routing.*` once locale-driven routing is observable
// end-to-end.

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

describe('audience surface mount()', () => {
  it('mounts the audience route tree under the provided basename and returns an unmount fn', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: {
        userId: '00000000-0000-4000-8000-000000000003',
        screenName: 'maria',
      },
      refresh: () => undefined,
      logout: () => undefined,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    window.history.replaceState({}, '', '/a/sessions/00000000-0000-4000-8000-000000000099');

    let unmount!: () => void;
    act(() => {
      unmount = mount({
        container,
        auth,
        i18n: i18n as unknown as I18n,
        routerBasePath: '/a',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-audience-placeholder')).toBeTruthy();
    });

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });
});
