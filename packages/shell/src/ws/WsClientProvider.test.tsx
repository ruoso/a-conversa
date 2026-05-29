// Smoke tests for the shell's WsClientProvider + useWsClient.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADR:        docs/adr/0022-no-throwaway-verifications.md
//
// Ported from `apps/moderator/src/ws/WsClientProvider.test.tsx`. The
// behaviors are identical; the shell-side version threads its store
// through the provider's `store` prop so on-unmount reset() is
// observable.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { createDefaultWsStore } from './defaultStore.js';
import { useWsClient, WsClientProvider } from './WsClientProvider.js';
import type { SendFn, WsClient, WsClientStatus } from './client.js';

afterEach(() => {
  cleanup();
});

interface FakeClientLog {
  connects: number;
  closes: number;
}

function makeFakeClient(): { client: WsClient; log: FakeClientLog } {
  const log: FakeClientLog = { connects: 0, closes: 0 };
  let status: WsClientStatus = 'idle';
  const send: SendFn = () => Promise.reject(new Error('not used in this test'));
  const client: WsClient = {
    status: (): WsClientStatus => status,
    connect: (): void => {
      log.connects += 1;
      status = 'connecting';
    },
    close: (): void => {
      log.closes += 1;
      status = 'closed';
    },
    killWebSocket: (): void => {
      // Provider tests don't exercise the kill-hook seam; the fake
      // satisfies the interface so the type check passes.
    },
    send,
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
  return { client, log };
}

function Probe(): ReactElement {
  const client = useWsClient();
  return <span data-testid="probe-url">{client.url}</span>;
}

describe('WsClientProvider', () => {
  it('opens the injected client when auth.status flips to authenticated', () => {
    const { client, log } = makeFakeClient();
    const { rerender } = render(
      <WsClientProvider auth={{ status: 'loading' }} client={client}>
        <Probe />
      </WsClientProvider>,
    );
    expect(log.connects).toBe(0);
    rerender(
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <Probe />
      </WsClientProvider>,
    );
    expect(log.connects).toBe(1);
  });

  it('closes the client and resets the supplied store on unmount when authenticated', () => {
    const { client, log } = makeFakeClient();
    const store = createDefaultWsStore();
    store.getState().setConnectionId('test-conn-id');
    const { unmount } = render(
      <WsClientProvider auth={{ status: 'authenticated' }} client={client} store={store}>
        <Probe />
      </WsClientProvider>,
    );
    expect(log.connects).toBe(1);
    expect(store.getState().connectionId).toBe('test-conn-id');
    unmount();
    expect(log.closes).toBe(1);
    expect(store.getState().connectionId).toBeUndefined();
  });

  it('useWsClient throws when called outside the provider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/useWsClient must be called inside/);
    errorSpy.mockRestore();
  });

  // -- Anonymous-WS opt-in (per ADR 0029 / aud_anonymous_ws_subscribe) --
  //
  // The audience surface opts into the anonymous-WS path by passing
  // `allowAnonymous`. The provider's effect must open the socket
  // under `auth.status === 'unauthenticated'` when the flag is set,
  // and must NOT open under the same status when the flag is absent
  // (moderator + participant surfaces' default posture).

  it('does NOT open the socket under unauthenticated when allowAnonymous is the default (false)', () => {
    const { client, log } = makeFakeClient();
    render(
      <WsClientProvider auth={{ status: 'unauthenticated' }} client={client}>
        <Probe />
      </WsClientProvider>,
    );
    // Default behavior preserved for moderator/participant call sites.
    expect(log.connects).toBe(0);
  });

  it('opens the socket under unauthenticated when allowAnonymous is true (audience opt-in)', () => {
    const { client, log } = makeFakeClient();
    render(
      <WsClientProvider auth={{ status: 'unauthenticated' }} client={client} allowAnonymous>
        <Probe />
      </WsClientProvider>,
    );
    // The audience surface's mount in `apps/audience/src/main.tsx`
    // passes `allowAnonymous`; the server-side anonymous-WS-upgrade
    // path (ADR 0029) is what makes this connect succeed in
    // production.
    expect(log.connects).toBe(1);
  });

  it('closes the client on unmount when opened anonymously via allowAnonymous', () => {
    const { client, log } = makeFakeClient();
    const { unmount } = render(
      <WsClientProvider auth={{ status: 'unauthenticated' }} client={client} allowAnonymous>
        <Probe />
      </WsClientProvider>,
    );
    expect(log.connects).toBe(1);
    unmount();
    // Same teardown semantics as the authenticated path — the
    // anonymous viewer's disconnect must release the singleton.
    expect(log.closes).toBe(1);
  });
});
