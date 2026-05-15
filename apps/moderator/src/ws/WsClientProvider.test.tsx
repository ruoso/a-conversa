// Smoke tests for `WsClientProvider` + `useWsClient`.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md
//
// The provider observes an auth-state shape and opens / closes a
// `WsClient` accordingly. Tests inject a fake client so the lifecycle
// is observable without mocking the browser WebSocket.
//
// Per ADR 0022 these are committed tests, not throwaway probes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { WsClientProvider, useWsClient } from './WsClientProvider.js';
import type { SendFn, WsClient, WsClientStatus } from './client.js';
import { useWsStore } from './wsStore.js';

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
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

  it('closes the client and resets the ws store on unmount when authenticated', () => {
    const { client, log } = makeFakeClient();
    useWsStore.getState().setConnectionId('test-conn-id');
    const { unmount } = render(
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <Probe />
      </WsClientProvider>,
    );
    expect(log.connects).toBe(1);
    expect(useWsStore.getState().connectionId).toBe('test-conn-id');
    unmount();
    expect(log.closes).toBe(1);
    expect(useWsStore.getState().connectionId).toBeUndefined();
  });

  it('useWsClient throws when called outside the provider', () => {
    // React 18 logs the error to console.error in development; silence it
    // so the negative-path expectation stays quiet.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Render Probe without the provider; the render should fail.
    expect(() => render(<Probe />)).toThrow(/useWsClient must be called inside/);
    errorSpy.mockRestore();
  });
});
