// Tests for `useProposeClassifyNodeAction(nodeId)` — the per-node
// classify-node propose hook.
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Canonical envelope shape** — fires exactly one `propose`
//      envelope carrying
//      `{ kind: 'classify-node', node_id, classification }`.
//   2. **In-flight per-nodeId** — true during the round-trip, false
//      after the ack resolves. Disjoint across nodeIds.
//   3. **Engine rejection** — `WsRequestError` lands the wire-error
//      verbatim in `useClassifyNodeStore.errors`.
//   4. **Timeout** — `WsRequestTimeoutError` maps to
//      `{ code: 'timeout', message: <localized timeout text> }`.
//   5. **Concurrent re-call on the same nodeId is a no-op.**
//
// Mirrors the shape of `useEditWordingAction.test.tsx` — same fake
// client, same probe-render-capture pattern.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetClassifyNodeStore,
  useClassifyNodeStore,
  useProposeClassifyNodeAction,
  type UseProposeClassifyNodeActionResult,
} from './useProposeClassifyNodeAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A = '22222222-2222-4222-8222-222222222222';
const NODE_B = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

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
  result: UseProposeClassifyNodeActionResult;
}

function Probe(props: {
  nodeId: string;
  onResult: (r: UseProposeClassifyNodeActionResult) => void;
}): ReactElement {
  const result = useProposeClassifyNodeAction(props.nodeId);
  props.onResult(result);
  return <span data-testid={`probe-${props.nodeId}`}>ok</span>;
}

function renderProbe(client: WsClient, nodeId: string = NODE_A): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      propose: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseProposeClassifyNodeActionResult): void => {
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
      <Probe nodeId={nodeId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetClassifyNodeStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeClassifyNodeAction — envelope shape', () => {
  it('fires exactly one propose envelope with the canonical classify-node payload', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('fact');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({
      kind: 'classify-node',
      node_id: NODE_A,
      classification: 'fact',
    });
    // Exactly three fields on the proposal — no legacy `wording`.
    expect(Object.keys((payload as { proposal: Record<string, unknown> }).proposal).sort()).toEqual(
      ['classification', 'kind', 'node_id'],
    );

    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_A)).toBe(false);
  });

  it('carries each MethodologyKind verbatim onto the proposal payload', () => {
    const KINDS = ['fact', 'predictive', 'value', 'normative', 'definitional'] as const;
    for (const kind of KINDS) {
      const fake = makeFakeClient();
      const probe = renderProbe(fake.client, `node-${kind}`);
      act(() => {
        void probe.result.propose(kind);
      });
      expect(fake.calls.length).toBe(1);
      const payload = fake.calls[0]?.payload as { proposal: { classification: string } };
      expect(payload.proposal.classification).toBe(kind);
      cleanup();
    }
  });
});

describe('useProposeClassifyNodeAction — in-flight per-nodeId', () => {
  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('fact');
    });
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_A)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_A)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });

  it('different nodeIds have disjoint in-flight slices (cross-node re-entry does not short-circuit)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, NODE_A);
    const probeB = renderProbe(fake.client, NODE_B);
    act(() => {
      void probeA.result.propose('fact');
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_A)).toBe(true);
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_B)).toBe(false);
    act(() => {
      void probeB.result.propose('value');
    });
    expect(fake.calls.length).toBe(2);
    expect(probeB.result.inFlight).toBe(true);
  });

  it('concurrent re-call on the same nodeId while inFlight is a no-op (no second envelope)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.propose('fact');
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.propose('value');
    });
    expect(fake.calls.length).toBe(1);
  });
});

describe('useProposeClassifyNodeAction — error paths', () => {
  it('engine rejection — wire-error lands verbatim in useClassifyNodeStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('fact');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'facet-sequence-out-of-order',
          message: "propose classify-node refused: node X's wording facet is 'proposed'",
        }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_A)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'facet-sequence-out-of-order',
      message: "propose classify-node refused: node X's wording facet is 'proposed'",
    });
  });

  it('timeout — wire-error has code "timeout" + localized timeout message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('fact');
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await proposePromise;
    });
    const lastError = probe.result.lastError;
    expect(lastError?.code).toBe('timeout');
    expect(lastError?.message).toBe('The classify request timed out — try again');
  });

  it('successful re-attempt clears the prior error before firing', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.propose('fact');
    });
    act(() => {
      fake.rejectNext(new WsRequestError({ code: 'facet-sequence-out-of-order', message: 'nope' }));
    });
    await act(async () => {
      await first;
    });
    expect(useClassifyNodeStore.getState().errors.has(NODE_A)).toBe(true);
    // Re-click — in-flight flip clears the prior error BEFORE the
    // second envelope fires.
    act(() => {
      void probe.result.propose('fact');
    });
    expect(useClassifyNodeStore.getState().errors.has(NODE_A)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});
