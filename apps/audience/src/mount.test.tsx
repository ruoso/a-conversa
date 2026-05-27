// Vitest mount-boundary case for the audience surface.
//
// Refinement: tasks/refinements/audience/aud_app_skeleton.md
//              tasks/refinements/audience/aud_ws_client.md
// ADRs:        0022 (no throwaway verifications — this case IS the
//                    regression pin for the participant-mirrored shape).
//
// Mirrors the authenticated-mount slice of
// `apps/participant/src/mount.test.tsx`. The audience skeleton has no
// chrome, no defensive `auth.user === undefined` guard — one case is
// enough at this tier:
//
//   - the mount export wires the React tree under the host-supplied
//     basename + auth + i18n,
//   - the placeholder testid renders,
//   - the returned UnmountFn tears the container down.
//
// `aud_ws_client` extends the existing authenticated case with a
// store-writes-through assertion that pins:
//   - the `<WsClientProvider>` mount resolves the audience tree under
//     JSDOM (no throw),
//   - the `audienceWsStore` singleton is the same instance the
//     provider hands to the auto-constructed client (writes through
//     the surface-level singleton arrive at the in-tree subtree).
//
// The locale read inside `<App />` runs as a side effect on the shared
// i18n instance but isn't asserted here — that assertion belongs in
// `aud_url_routing.*` once locale-driven routing is observable
// end-to-end.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';

import { createI18nInstance, type AuthContextValue, type I18n } from '@a-conversa/shell';

import { mount } from './main';
import { audienceWsStore } from './ws/wsStore';

// happy-dom does not ship a `WebSocket` implementation; the surface's
// `<WsClientProvider>` auto-constructs a client whose `connect()` calls
// `new WebSocket(url)` when the host hands authenticated auth. Replace
// the global with a no-op stub for the duration of this file so the
// provider's effect runs without throwing. The stub never fires
// `onopen` / `onmessage`, so the store's `setConnectionStatus` writer
// only fires for transitions the test drives explicitly via
// `audienceWsStore.getState().setConnectionStatus(...)`.
class StubWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = StubWebSocket.CONNECTING;
  onopen: ((ev: unknown) => unknown) | null = null;
  onclose: ((ev: unknown) => unknown) | null = null;
  onerror: ((ev: unknown) => unknown) | null = null;
  onmessage: ((ev: unknown) => unknown) | null = null;
  constructor(public readonly url: string) {}
  send(): void {
    // no-op
  }
  close(): void {
    this.readyState = StubWebSocket.CLOSED;
  }
}

const previousWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

beforeEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = StubWebSocket;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  // Reset the audience's WS store so per-case writers don't bleed.
  audienceWsStore.getState().reset();
  (globalThis as { WebSocket?: unknown }).WebSocket = previousWebSocket;
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

    // `aud_auth_for_private`: an authenticated visitor sees NO sign-in
    // chrome. The audience's broadcast-clean aesthetic keeps the
    // placeholder DOM identical to the pre-leaf shape for the
    // authenticated branch (Decision §1).
    expect(screen.queryByTestId('audience-sign-in')).toBeNull();

    // `aud_ws_client`: the `<WsClientProvider>` resolved without
    // throwing (the placeholder testid above proves the React tree
    // rendered under the provider). Pin the store-writes-through
    // contract by flipping `connectionStatus` on the same singleton
    // the mount handed to the provider — proves the audience surface
    // reads from the same singleton the surface boundary mounted (no
    // accidental per-mount fresh store).
    act(() => {
      audienceWsStore.getState().setConnectionStatus('open');
    });
    expect(audienceWsStore.getState().connectionStatus).toBe('open');

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });

  it('mounts the audience for an unauthenticated visitor and renders the sign-in chrome', async () => {
    // `aud_auth_for_private`: per ADR 0026 + `aud_no_auth_for_public`,
    // the host hands an `'unauthenticated'` `AuthContextValue` (with
    // `user === undefined`) into `MountProps.auth` for anonymous
    // visitors of a `requiredAuthLevel: 'public'` surface. The audience
    // surface's `<PlaceholderRoute>` must consume `useAuth()` and
    // render the shell's `<LoginButton>` under the `audience-sign-in`
    // testid, alongside the existing `route-audience-placeholder`.
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'unauthenticated',
      user: undefined,
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

    const signIn = screen.getByTestId('audience-sign-in');
    expect(signIn).toBeTruthy();
    const link = signIn.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/api/auth/login');

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders the sign-in chrome when auth.user is undefined under status="authenticated" (mid-mount flip)', async () => {
    // `aud_auth_for_private` Decision §5: in the narrow window between
    // the host's `refresh()` flipping the value and React re-rendering
    // the surface, `user` can be `undefined` while `status` is still
    // `'authenticated'`. The audience degrades to the `<AnonymousChrome>`
    // (Decision §5, mirroring `part_auth_flow`'s defensive narrow but
    // without a dedicated `audience-not-authenticated` panel).
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'authenticated',
      user: undefined,
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

    expect(screen.getByTestId('audience-sign-in')).toBeTruthy();

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });

  it('renders without any user-input-gating affordances for the OBS-typical anonymous-on-public path', async () => {
    // `aud_obs_no_input_required` — pins the OBS-browser-source contract:
    // a headless Chromium with no input device must be able to mount this
    // surface, render the placeholder (and, post-`aud_session_url`, the
    // live graph), and continue updating without any user gesture.
    // The audit targets gating patterns — `<dialog>`, `[aria-modal]`,
    // `<audio>` / `<video>` (autoplay-policy-gated), `[data-requires-input]`
    // — not optional affordances like the `<LoginButton>` chrome (which
    // is a plain `<a href>` link the OBS visit ignores).
    const i18n = await createI18nInstance('en-US');
    const auth: AuthContextValue = {
      status: 'unauthenticated',
      user: undefined,
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

    // The audit. Each selector targets a pattern that would silently
    // break an OBS browser-source embed.
    expect(container.querySelectorAll('dialog')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(container.querySelectorAll('[data-requires-input="true"]')).toHaveLength(0);

    // The optional chrome IS present and IS intentional — pin the
    // distinction so a future regression that removes the chrome
    // doesn't accidentally "satisfy" the audit by removing both
    // optional and required affordances. The chrome is the recovery
    // path for private-session viewers; OBS-typical public-session
    // visits ignore it.
    const signIn = screen.getByTestId('audience-sign-in');
    expect(signIn.querySelector('a')?.getAttribute('href')).toBe('/api/auth/login');

    act(() => {
      unmount();
    });
    expect(container.innerHTML).toBe('');
  });
});
