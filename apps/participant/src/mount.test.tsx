// Vitest mount-boundary case for the participant surface.
//
// Refinement: tasks/refinements/participant-ui/part_app_skeleton.md
//              tasks/refinements/participant-ui/part_auth_flow.md
// ADRs:        0022 (no throwaway verifications — this case IS the
//                    regression pin for the moderator-mirrored shape).
//
// Mirrors `apps/moderator/src/mount.test.tsx` except for the surface
// name, the URL pushed into `window.history`, and the asserted testid.
// `part_auth_flow` extends the existing `authenticated` case with the
// `participant-identity` assertion and appends two new cases pinning
// the defensive in-component guard (unauthenticated mid-mount + the
// belt-and-suspenders `auth.user === undefined` malformed-provider
// edge).

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

    // `part_auth_flow`: the placeholder also surfaces the host-supplied
    // `screenName` under the stable `participant-identity` testid. The
    // assertion pins that the surface reads `auth.user.screenName`
    // through the shell's `useAuth()` and does not invent its own
    // identity source.
    const identity = screen.getByTestId('participant-identity');
    expect(identity.textContent).toContain('ben');
    // Conversely, the defensive `participant-not-authenticated` panel
    // must NOT render in the authenticated branch.
    expect(screen.queryByTestId('participant-not-authenticated')).toBeNull();

    // `part_landscape_layout`: the placeholder route renders inside a
    // landscape-grid chrome shell. The four named-region testids must
    // be visible end-to-end after mount, pinning the route-tree-to-
    // layout wiring (not just the layout in isolation).
    expect(screen.getByTestId('participant-layout-root')).toBeTruthy();
    expect(screen.getByTestId('participant-header')).toBeTruthy();
    expect(screen.getByTestId('participant-main')).toBeTruthy();
    expect(screen.getByTestId('participant-footer')).toBeTruthy();

    unmount();
    expect(container.innerHTML).toBe('');
  });

  it('renders the participant-not-authenticated panel when auth.status is unauthenticated', async () => {
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'unauthenticated',
      user: undefined,
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

    // The defensive panel must render and the identity row must NOT —
    // the surface refuses to read `auth.user.screenName` when the host's
    // provider value is not authenticated.
    expect(screen.getByTestId('participant-not-authenticated')).toBeTruthy();
    expect(screen.queryByTestId('participant-identity')).toBeNull();

    unmount();
    expect(container.innerHTML).toBe('');
  });

  it('renders the defensive panel when status is authenticated but user is undefined', async () => {
    const i18n = await createI18nInstance('en-US');
    // The shell's `AuthContextValue` types `user` as optional even on
    // `status: 'authenticated'`; this case pins the belt-and-suspenders
    // side of the in-component guard, so a future malformed-provider
    // regression cannot trip a runtime `.screenName` access on
    // `undefined`.
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: undefined,
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

    expect(screen.getByTestId('participant-not-authenticated')).toBeTruthy();
    expect(screen.queryByTestId('participant-identity')).toBeNull();

    unmount();
    expect(container.innerHTML).toBe('');
  });
});
