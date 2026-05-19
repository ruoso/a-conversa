// Tests for `useWithdrawProposalAction(proposalEventId)` — the per-row
// withdraw-proposal action hook.
//
// Wire schema: packages/shared-types/src/ws-envelope.ts
//              (`wsWithdrawProposalPayloadSchema`)
// Server handler: apps/server/src/ws/handlers/withdraw.ts
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Canonical envelope shape** — fires exactly one
//      `withdraw-proposal` envelope with `{ sessionId, expectedSequence,
//      proposalEventId }`; no `proposerId` (the server reads it off the
//      authenticated connection per `withdraw.ts`).
//   2. **Engine `forbidden` rejection** — `WsRequestError({ code:
//      'forbidden', message: ... })` lands the error in
//      `useWithdrawProposalStore.errors`, removes proposalEventId from
//      `withdrawing`. This is the proposer-only-gate failure mode the
//      task description calls out.
//   3. **Timeout** — `WsRequestTimeoutError` lands a
//      `{ code: 'timeout', ... }` error.
//   4. **Concurrent re-entry** — a second `withdraw()` call while the
//      first is in-flight is a no-op (no second envelope fires).
//   5. **`inFlight` reflects `useWithdrawProposalStore.withdrawing`**
//      for the proposalEventId argument; disjoint between different
//      proposalEventIds.
//   6. **`expectedSequence` reads `lastAppliedSequence`** at
//      withdraw-time (the WS store can advance between mounts and
//      clicks).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetWithdrawProposalStore,
  useWithdrawProposalAction,
  useWithdrawProposalStore,
  type UseWithdrawProposalActionResult,
} from './useWithdrawProposalAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_EVENT_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_EVENT_ID_ALT = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface WithdrawCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['withdraw-proposal'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: WithdrawCall[];
  /** Resolve the next pending send call's promise with a `proposal-withdrawn` envelope. */
  readonly resolveNext: (payload?: { removedEventCount?: number }) => void;
  /** Reject the next pending send call with the supplied error. */
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: WithdrawCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as WithdrawCall);
    return new Promise<WsEnvelopeUnion>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };

  const client: WsClient = {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    send,
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };

  return {
    client,
    calls,
    resolveNext: (opts: { removedEventCount?: number } = {}): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      const removedEventCount = opts.removedEventCount ?? 0;
      next.resolve({
        type: 'proposal-withdrawn',
        id: 'ack-id',
        inResponseTo: 'req-id',
        payload: {
          sessionId: SESSION_ID,
          proposalEventId: PROPOSAL_EVENT_ID,
          removedEventCount,
        },
      } as unknown as WsEnvelopeUnion);
    },
    rejectNext: (err: Error): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to reject');
      next.reject(err);
    },
    pendingCount: (): number => pending.length,
  };
}

interface ProbeHandle {
  /** Latest snapshot of the hook result. */
  result: UseWithdrawProposalActionResult;
}

function Probe(props: {
  proposalEventId: string;
  onResult: (r: UseWithdrawProposalActionResult) => void;
}): ReactElement {
  const result = useWithdrawProposalAction(props.proposalEventId);
  props.onResult(result);
  return <span data-testid={`probe-${props.proposalEventId}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(
  client: WsClient,
  proposalEventId: string = PROPOSAL_EVENT_ID,
  options: { sessionIdOverride?: string } = {},
): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      withdraw: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseWithdrawProposalActionResult): void => {
    handle.result = r;
  };

  const path = options.sessionIdOverride ?? SESSION_ID;
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[`/sessions/${path}/operate`]}>
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
      <Probe proposalEventId={proposalEventId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetWithdrawProposalStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useWithdrawProposalAction — successful withdraw path', () => {
  it('fires exactly one withdraw-proposal envelope with the canonical payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('withdraw-proposal');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposalEventId).toBe(PROPOSAL_EVENT_ID);
    // The payload has exactly three fields — no `proposerId` (the
    // server reads it from the authenticated connection).
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      'expectedSequence',
      'proposalEventId',
      'sessionId',
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ removedEventCount: 1 });
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    // After the ack lands, the proposalEventId is removed from the
    // module-scoped in-flight set.
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID)).toBe(false);
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at withdraw-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 9 via a synthetic
    // event applied to the right session.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '55555555-5555-4555-8555-000000000009',
        sessionId: SESSION_ID,
        sequence: 9,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '66666666-6666-4666-8666-666666666666',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-17T00:00:00.000Z',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(9);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext();
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useWithdrawProposalAction — error paths', () => {
  it('engine forbidden rejection → wire-error lands in store.errors with the engine code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'forbidden',
          message: 'User aa is not the proposer of proposal 22; only the proposer may withdraw it.',
        }),
      );
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'forbidden',
      message: 'User aa is not the proposer of proposal 22; only the proposer may withdraw it.',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('withdraw-proposal', 'req-id-1'));
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The withdraw request timed out. Check your connection and try again.',
    );
  });

  it('next withdraw click clears the prior error for the same proposalEventId', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'forbidden',
          message: 'Not the proposer.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    // Re-click — clears the error before firing the second envelope.
    act(() => {
      void probe.result.withdraw();
    });
    expect(useWithdrawProposalStore.getState().errors.has(PROPOSAL_EVENT_ID)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useWithdrawProposalAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-proposalEventId (disjoint between two rows)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, PROPOSAL_EVENT_ID);
    const probeB = renderProbe(fake.client, PROPOSAL_EVENT_ID_ALT);
    act(() => {
      void probeA.result.withdraw();
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID)).toBe(true);
    expect(useWithdrawProposalStore.getState().withdrawing.has(PROPOSAL_EVENT_ID_ALT)).toBe(false);
  });
});
