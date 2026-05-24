// Tests for `useProposeSetEdgeSubstanceAction(edgeId)` — the per-edge
// set-edge-substance propose hook.
//
// Per ADR 0022 these are committed Vitest cases. Mirrors
// `useProposeSetNodeSubstanceAction.test.tsx` — same fake client,
// same probe-render-capture pattern. They lock in:
//
//   1. **Canonical envelope shape** — fires exactly one `propose`
//      envelope carrying
//      `{ kind: 'set-edge-substance', edge_id, value }`. The optional
//      `source_node_id` / `target_node_id` / `role` endpoint fields
//      from the schema are NOT populated — this hook targets an
//      EXTANT edge already on the canvas (see the hook's payload
//      decision comment).
//   2. **In-flight per-edgeId** — true during the round-trip, false
//      after the ack resolves. Disjoint across edgeIds.
//   3. **Engine rejection** — `WsRequestError` lands the wire-error
//      verbatim in `useSetEdgeSubstanceStore.errors`.
//   4. **Timeout** — `WsRequestTimeoutError` maps to
//      `{ code: 'timeout', message: <localized timeout text> }`.
//   5. **Concurrent re-call on the same edgeId is a no-op.**

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetSetEdgeSubstanceStore,
  useSetEdgeSubstanceStore,
  useProposeSetEdgeSubstanceAction,
  type UseProposeSetEdgeSubstanceActionResult,
  type SubstanceValue,
} from './useProposeSetEdgeSubstanceAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EDGE_A = '22222222-2222-4222-8222-222222222222';
const EDGE_B = '33333333-3333-4333-8333-333333333333';

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
  result: UseProposeSetEdgeSubstanceActionResult;
}

function Probe(props: {
  edgeId: string;
  onResult: (r: UseProposeSetEdgeSubstanceActionResult) => void;
}): ReactElement {
  const result = useProposeSetEdgeSubstanceAction(props.edgeId);
  props.onResult(result);
  return <span data-testid={`probe-${props.edgeId}`}>ok</span>;
}

function renderProbe(client: WsClient, edgeId: string = EDGE_A): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      propose: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseProposeSetEdgeSubstanceActionResult): void => {
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

beforeEach(() => {
  useWsStore.getState().reset();
  resetSetEdgeSubstanceStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeSetEdgeSubstanceAction — envelope shape', () => {
  it('fires exactly one propose envelope with the canonical set-edge-substance payload', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('agreed');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({
      kind: 'set-edge-substance',
      edge_id: EDGE_A,
      value: 'agreed',
    });
    // Exactly three fields on the proposal — the optional endpoint
    // fields (`source_node_id`, `target_node_id`, `role`) are NOT
    // populated because this hook targets an extant edge.
    expect(Object.keys((payload as { proposal: Record<string, unknown> }).proposal).sort()).toEqual(
      ['edge_id', 'kind', 'value'],
    );

    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_A)).toBe(false);
  });

  it('carries both SubstanceValue values verbatim onto the proposal payload', () => {
    const VALUES: readonly SubstanceValue[] = ['agreed', 'disputed'];
    for (const value of VALUES) {
      const fake = makeFakeClient();
      const probe = renderProbe(fake.client, `edge-${value}`);
      act(() => {
        void probe.result.propose(value);
      });
      expect(fake.calls.length).toBe(1);
      const payload = fake.calls[0]?.payload as { proposal: { value: string } };
      expect(payload.proposal.value).toBe(value);
      cleanup();
    }
  });
});

describe('useProposeSetEdgeSubstanceAction — in-flight per-edgeId', () => {
  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('agreed');
    });
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_A)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_A)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });

  it('different edgeIds have disjoint in-flight slices (cross-edge re-entry does not short-circuit)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, EDGE_A);
    const probeB = renderProbe(fake.client, EDGE_B);
    act(() => {
      void probeA.result.propose('agreed');
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_A)).toBe(true);
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_B)).toBe(false);
    act(() => {
      void probeB.result.propose('disputed');
    });
    expect(fake.calls.length).toBe(2);
    expect(probeB.result.inFlight).toBe(true);
  });

  it('concurrent re-call on the same edgeId while inFlight is a no-op (no second envelope)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.propose('agreed');
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.propose('disputed');
    });
    expect(fake.calls.length).toBe(1);
  });
});

describe('useProposeSetEdgeSubstanceAction — error paths', () => {
  it('engine rejection — wire-error lands verbatim in useSetEdgeSubstanceStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('agreed');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'facet-sequence-out-of-order',
          message: "propose set-edge-substance refused: edge X's shape facet is 'proposed'",
        }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_A)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'facet-sequence-out-of-order',
      message: "propose set-edge-substance refused: edge X's shape facet is 'proposed'",
    });
  });

  it('timeout — wire-error has code "timeout" + localized timeout message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose('agreed');
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await proposePromise;
    });
    const lastError = probe.result.lastError;
    expect(lastError?.code).toBe('timeout');
    expect(lastError?.message).toBe('The set-substance request timed out — try again');
  });

  it('successful re-attempt clears the prior error before firing', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.propose('agreed');
    });
    act(() => {
      fake.rejectNext(new WsRequestError({ code: 'facet-sequence-out-of-order', message: 'nope' }));
    });
    await act(async () => {
      await first;
    });
    expect(useSetEdgeSubstanceStore.getState().errors.has(EDGE_A)).toBe(true);
    // Re-click — in-flight flip clears the prior error BEFORE the
    // second envelope fires.
    act(() => {
      void probe.result.propose('agreed');
    });
    expect(useSetEdgeSubstanceStore.getState().errors.has(EDGE_A)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});
