// Tests for `useAxiomMarkAction({ nodeId, participantId })` — the
// participant's per-node axiom-mark action hook.
//
// Refinement: tasks/refinements/participant-ui/part_axiom_mark.md
//             (sibling to `part_voting` — the participant-side
//             wire-action pattern).
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Successful mark** — fires exactly one `propose` envelope with
//      the canonical axiom-mark payload shape
//      (sessionId / expectedSequence / proposal: {
//          kind: 'axiom-mark', node_id, participant }), awaits the
//      `proposed` ack, removes the nodeId from the in-flight set.
//   2. **`participant` field carries `participantId` arg verbatim** —
//      the participant surface passes `connection.user.id`, so the
//      engine's `axiom-mark-not-self` rule passes naturally.
//   3. **Engine rejection** — `WsRequestError` lands the error in
//      `useAxiomMarkActionStore.errors`, removes nodeId from
//      `marking`. We exercise `axiom-mark-not-self` (the headline
//      rejection — never expected on this surface but the hook must
//      surface it cleanly if the wire ever sends one).
//   4. **Timeout** — `WsRequestTimeoutError` lands a
//      `{ code: 'timeout', ... }` error with a localized fallback
//      message.
//   5. **Concurrent re-entry** — a second `markAsAxiom()` call while
//      the first is in-flight is a no-op (no second envelope fires).
//   6. **Per-node isolation** — two different nodeIds have disjoint
//      in-flight slices; both marks fire concurrently.
//   7. **`expectedSequence` reads `lastAppliedSequence`** at mark-time.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetAxiomMarkActionStore,
  useAxiomMarkAction,
  useAxiomMarkActionStore,
  type UseAxiomMarkActionResult,
} from './useAxiomMarkAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID_ALT = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444';

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
  /** Resolve the next pending send call's promise with a `proposed` envelope. */
  readonly resolveNext: (payload?: { sequence?: number; eventId?: string }) => void;
  /** Reject the next pending send call with the supplied error. */
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
  /** Latest snapshot of the hook result. */
  result: UseAxiomMarkActionResult;
}

function Probe(props: {
  nodeId: string;
  participantId: string;
  onResult: (r: UseAxiomMarkActionResult) => void;
}): ReactElement {
  const result = useAxiomMarkAction({
    nodeId: props.nodeId,
    participantId: props.participantId,
  });
  props.onResult(result);
  return <span data-testid={`probe-${props.nodeId}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(
  client: WsClient,
  nodeId: string = NODE_ID,
  participantId: string = PARTICIPANT_ID,
): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      markAsAxiom: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseAxiomMarkActionResult): void => {
    handle.result = r;
  };

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id" element={children} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>
    );
  }

  render(
    <Wrapper>
      <Probe nodeId={nodeId} participantId={participantId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetAxiomMarkActionStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useAxiomMarkAction — successful mark path', () => {
  it('fires exactly one propose envelope with the canonical axiom-mark payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAsAxiom();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({
      kind: 'axiom-mark',
      node_id: NODE_ID,
      participant: PARTICIPANT_ID,
    });
    // The payload has exactly three fields — no client-minted event id.
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      'expectedSequence',
      'proposal',
      'sessionId',
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await markPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID)).toBe(false);
  });

  it('participant field on the wire matches the hook argument verbatim', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, NODE_ID, PARTICIPANT_ID);
    act(() => {
      void probe.result.markAsAxiom();
    });
    // The participant-side hook passes the AUTHENTICATED user id —
    // making `axiom-mark-not-self` unreachable on this surface (the
    // engine compares `connection.user.id` against
    // `proposal.participant`).
    expect(fake.calls[0]?.payload.proposal.kind).toBe('axiom-mark');
    if (fake.calls[0]?.payload.proposal.kind === 'axiom-mark') {
      expect(fake.calls[0]?.payload.proposal.participant).toBe(PARTICIPANT_ID);
      expect(fake.calls[0]?.payload.proposal.node_id).toBe(NODE_ID);
    }
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at mark-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 5 via a synthetic event.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '66666666-6666-4666-8666-000000000005',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '77777777-7777-4777-8777-777777777777',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.markAsAxiom();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(5);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAsAxiom();
    });
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await markPromise;
    });
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useAxiomMarkAction — error paths', () => {
  it('axiom-mark-not-self rejection — wire-error lands verbatim in useAxiomMarkActionStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAsAxiom();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'axiom-mark-not-self',
          message:
            'propose axiom-mark: requester X cannot mark an axiom on behalf of participant Y',
        }),
      );
    });
    await act(async () => {
      await markPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'axiom-mark-not-self',
      message: 'propose axiom-mark: requester X cannot mark an axiom on behalf of participant Y',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAsAxiom();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await markPromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The axiom-mark request timed out. Check your connection and try again.',
    );
  });

  it('next markAsAxiom click clears the prior error for the same nodeId', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.markAsAxiom();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'axiom-mark-not-self',
          message: 'Rejected.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    act(() => {
      void probe.result.markAsAxiom();
    });
    expect(useAxiomMarkActionStore.getState().errors.has(NODE_ID)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useAxiomMarkAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.markAsAxiom();
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.markAsAxiom();
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-nodeId (disjoint between two nodes)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, NODE_ID);
    const probeB = renderProbe(fake.client, NODE_ID_ALT);
    act(() => {
      void probeA.result.markAsAxiom();
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID)).toBe(true);
    expect(useAxiomMarkActionStore.getState().marking.has(NODE_ID_ALT)).toBe(false);
    // A concurrent mark on the other node DOES fire (no cross-key
    // short-circuit) — both envelopes go out.
    act(() => {
      void probeB.result.markAsAxiom();
    });
    expect(fake.calls.length).toBe(2);
    expect(probeB.result.inFlight).toBe(true);
  });
});
