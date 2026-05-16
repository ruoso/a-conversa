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
});
