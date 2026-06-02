// Tests for `useBreakEdgeAction(edgeId)` — the per-edge break-edge hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_break_edge_resolution_action.md
//             (Acceptance §5, Decision §D4)
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Canonical envelope shape** — fires exactly one `propose` envelope
//      carrying `{ kind: 'break-edge', edge_id }`, the active `sessionId`,
//      and the current `expectedSequence` (the session's
//      `lastAppliedSequence`).
//   2. **In-flight per-edgeId** — true during the round-trip, false after
//      the ack resolves. Disjoint across edgeIds.
//   3. **Engine rejection** — `WsRequestError` lands the wire-error
//      verbatim in `useBreakEdgeStore.errors`.
//   4. **Timeout** — `WsRequestTimeoutError` maps to a `{ code: 'timeout' }`
//      wire error.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetBreakEdgeStore,
  useBreakEdgeAction,
  useBreakEdgeStore,
  type UseBreakEdgeActionResult,
} from './useBreakEdgeAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EDGE_A = '22222222-2222-4222-8222-222222222222';
const EDGE_B = '33333333-3333-4333-8333-333333333333';

interface ProposeCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['propose'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: ProposeCall[];
  readonly resolveNext: (payload?: { sequence?: number; eventId?: string }) => void;
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: ProposeCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as ProposeCall);
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
    resolveNext: (opts: { sequence?: number; eventId?: string } = {}): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      const sequence = opts.sequence ?? 1;
      const eventId = opts.eventId ?? '55555555-5555-4555-8555-555555555555';
      next.resolve({
        type: 'proposed',
        id: 'ack-id',
        inResponseTo: 'req-id',
        payload: { sessionId: SESSION_ID, sequence, eventId },
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
  result: UseBreakEdgeActionResult;
}

function Probe(props: {
  edgeId: string;
  onResult: (r: UseBreakEdgeActionResult) => void;
}): ReactElement {
  const result = useBreakEdgeAction(props.edgeId);
  props.onResult(result);
  return <span data-testid={`probe-${props.edgeId}`}>ok</span>;
}

function renderProbe(client: WsClient, edgeId: string = EDGE_A): ProbeHandle {
  const handle: ProbeHandle = {
    result: { propose: () => Promise.resolve(), inFlight: false, lastError: undefined },
  };
  const captureResult = (r: UseBreakEdgeActionResult): void => {
    handle.result = r;
  };

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
      <Probe edgeId={edgeId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

/** Seed the session's `lastAppliedSequence` via a synthetic node-created event. */
function seedSequence(sequence: number): void {
  act(() => {
    useWsStore.getState().applyEvent({
      id: '66666666-6666-4666-8666-666666666666',
      sessionId: SESSION_ID,
      sequence,
      kind: 'node-created',
      actor: '00000000-0000-4000-8000-0000000000aa',
      payload: {
        node_id: '77777777-7777-4777-8777-777777777777',
        wording: 'seed',
        created_by: '00000000-0000-4000-8000-0000000000aa',
        created_at: '2026-05-11T00:00:00.000Z',
      },
      createdAt: '2026-05-11T00:00:00.000Z',
    } as never);
  });
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetBreakEdgeStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useBreakEdgeAction — envelope shape', () => {
  it('fires exactly one propose envelope with the canonical break-edge payload', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({ kind: 'break-edge', edge_id: EDGE_A });
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
  });

  it('carries the session current expectedSequence (its lastAppliedSequence)', () => {
    seedSequence(7);
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls[0]?.payload.expectedSequence).toBe(7);
  });
});

describe('useBreakEdgeAction — in-flight', () => {
  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    expect(useBreakEdgeStore.getState().inFlight.has(EDGE_A)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(useBreakEdgeStore.getState().inFlight.has(EDGE_A)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });

  it('in-flight is disjoint across edgeIds', async () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, EDGE_A);
    let pA: Promise<void> | undefined;
    act(() => {
      pA = probeA.result.propose();
    });
    expect(useBreakEdgeStore.getState().inFlight.has(EDGE_A)).toBe(true);
    expect(useBreakEdgeStore.getState().inFlight.has(EDGE_B)).toBe(false);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await pA;
    });
  });
});

describe('useBreakEdgeAction — error surfacing', () => {
  it('engine rejection — wire-error lands verbatim in useBreakEdgeStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
          message: 'commit/break-edge: edge not present',
        }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.lastError).toEqual({
      code: 'illegal-state-transition',
      message: 'commit/break-edge: edge not present',
    });
    expect(probe.result.inFlight).toBe(false);
  });

  it('timeout — wire-error has code "timeout"', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.inFlight).toBe(false);
  });
});
