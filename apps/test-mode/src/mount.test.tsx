// Vitest mount-boundary case for the test-mode surface.
//
// Refinement: tasks/refinements/replay_test/test_mode_app.md
// ADRs:        0022 (no throwaway verifications — this case IS the
//                    regression pin for the moderator-mirrored shape).
//
// Mirrors `apps/moderator/src/mount.test.tsx` except for the surface
// name, the URL pushed into `window.history`, and the asserted testid.
// Proves `mount()` wires the React tree under a host-supplied
// `routerBasePath` + `auth` + `i18n`, renders the root synthetic gallery,
// and the returned `UnmountFn` tears the container down.
//
// The gallery fetches the scenario list on mount; we stub `fetch` with a
// never-resolving promise so the surface stays in its `loading` state for
// the lifetime of the test — no async `setState` fires after the `act()`
// boundary (which would surface as a React act warning → hard failure per
// `vitest.setup.ts`). The list-fetch behaviour itself is pinned by
// `SyntheticGallery.test.tsx`; this case only proves the mount wiring.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('test-mode surface mount()', () => {
  it('mounts the test-mode route tree under the provided basename and returns an unmount fn', async () => {
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
    window.history.replaceState({}, '', '/t/');

    let unmount!: () => void;
    act(() => {
      unmount = mount({
        container,
        auth,
        i18n: i18n as unknown as I18n,
        routerBasePath: '/t',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('test-mode-synthetic-gallery')).toBeTruthy();
    });

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });
});
