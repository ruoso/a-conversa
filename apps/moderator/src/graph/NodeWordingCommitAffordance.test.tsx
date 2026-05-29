// Tests for `<NodeWordingCommitAffordance>` — the per-node inline
// commit affordance for the `wording` facet. Mirrors
// `EdgeShapeCommitAffordance.test.tsx`'s posture and locks in:
//
//   1. Render structure (per-node container + button testids).
//   2. Click-fires a single `commit` envelope with the
//      `(node, nodeId, 'wording')` facet triple.
//   3. In-flight disables the button + flips `data-commit-state`.
//   4. Wire-error region mounts as `role="alert"`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { NodeWordingCommitAffordance } from './NodeWordingCommitAffordance';
import { resetCommitStore, useCommitStore } from '../layout/useCommitAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface CommitCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['commit'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: CommitCall[];
  readonly resolveNext: () => void;
  readonly rejectNext: (err: Error) => void;
}

function makeFakeClient(): FakeClient {
  const calls: CommitCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as CommitCall);
    return new Promise<WsEnvelopeUnion>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };

  const client: WsClient = {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    killWebSocket: (): void => undefined,
    send,
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };

  return {
    client,
    calls,
    resolveNext: (): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      next.resolve({
        type: 'committed',
        id: 'ack-id',
        inResponseTo: 'req-id',
        payload: { sessionId: SESSION_ID, sequence: 1, eventId: 'evt-1' },
      } as unknown as WsEnvelopeUnion);
    },
    rejectNext: (err: Error): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to reject');
      next.reject(err);
    },
  };
}

function renderAffordance(client: WsClient, nodeId: string = NODE_ID): void {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={children} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>
    );
  }
  render(
    <Wrapper>
      <NodeWordingCommitAffordance nodeId={nodeId} />
    </Wrapper>,
  );
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetCommitStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('NodeWordingCommitAffordance — render structure', () => {
  it('renders the per-node container + the commit button with stable testids', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.getByTestId(`node-wording-commit-affordance-${NODE_ID}`)).toBeTruthy();
    const button = screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`);
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-node-id')).toBe(NODE_ID);
    expect(button.getAttribute('data-commit-state')).toBe('enabled');
  });

  it('renders no inline error region when lastError is undefined', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.queryByTestId(`node-wording-commit-affordance-error-${NODE_ID}`)).toBeNull();
  });
});

describe('NodeWordingCommitAffordance — click-fires-commit contract', () => {
  it('clicking the button fires a single facet-arm commit envelope on (node, nodeId, wording)', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('commit');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      target: string;
      entity_kind: string;
      entity_id: string;
      facet: string;
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.target).toBe('facet');
    expect(payload.entity_kind).toBe('node');
    expect(payload.entity_id).toBe(NODE_ID);
    expect(payload.facet).toBe('wording');
  });
});

describe('NodeWordingCommitAffordance — in-flight disabling', () => {
  it('disables the button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`));
    });
    const button = screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('data-commit-state')).toBe('in-flight');
    await act(async () => {
      fake.resolveNext();
      await Promise.resolve();
    });
    const buttonAfter = screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`);
    expect((buttonAfter as HTMLButtonElement).disabled).toBe(false);
    expect(buttonAfter.getAttribute('data-commit-state')).toBe('enabled');
  });
});

describe('NodeWordingCommitAffordance — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`node-wording-commit-affordance-button-${NODE_ID}`));
    });
    await act(async () => {
      fake.rejectNext(
        new WsRequestError({
          code: 'unanimous-agree-required',
          message: 'commit refused: not all participants agreed',
        }),
      );
      await Promise.resolve();
    });
    const region = screen.getByTestId(`node-wording-commit-affordance-error-${NODE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('unanimous-agree-required');
    expect(region.textContent).toContain('commit refused: not all participants agreed');
    expect(useCommitStore.getState().committing.has(`facet:node:${NODE_ID}:wording`)).toBe(false);
  });
});
