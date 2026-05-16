// Tests for `useAxiomMarkAction(nodeId)` — the per-node axiom-mark hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Successful mark** — fires exactly one `propose` envelope with
//      the canonical axiom-mark payload shape (sessionId /
//      expectedSequence / proposal: { kind: 'axiom-mark', node_id,
//      participant }), awaits the `proposed` ack, removes the composite
//      key from the in-flight set.
//   2. **Engine rejection** — `WsRequestError({ code:
//      'axiom-mark-not-self', message: '...' })` lands the wire-error
//      verbatim in `useAxiomMarkStore.errors`, removes the key from
//      `inFlight`. The localization of the message into a catalog-
//      resolved string is the SUBMENU's responsibility (see
//      `AxiomMarkSubmenu.test.tsx`); the hook stores the wire-error
//      surface unchanged.
//   3. **Timeout** — `WsRequestTimeoutError` maps to
//      `{ code: 'timeout', message: <localized timeout text> }`.
//   4. **Unknown error** — a plain `Error` lands as
//      `{ code: 'unknown', message: <error message> }`.
//   5. **Concurrent re-entry** — a second `markAxiom(participantId)`
//      while the first is in-flight on the same key is a no-op (no
//      second envelope fires).
//   6. **Disjoint keys** — `markAxiom(A)` and `markAxiom(B)` on the
//      same node both fire (their in-flight slices are keyed
//      independently); cross-key re-entry does not short-circuit.
//   7. **Cleanup** — after a successful mark, the per-key error slice
//      for that key is cleared; the in-flight slice has the key
//      removed.
//   8. **Composite-key shape** — `axiomMarkStoreKey(nodeId, participantId)`
//      uses the documented `${nodeId}|${participantId}` form (the
//      separator is safe because both ids are UUIDs).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  axiomMarkStoreKey,
  resetAxiomMarkStore,
  useAxiomMarkAction,
  useAxiomMarkStore,
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
const PARTICIPANT_A = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_B = '44444444-4444-4444-8444-444444444444';

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
  /** Resolve the next pending send call with a `proposed` envelope. */
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
  onResult: (r: UseAxiomMarkActionResult) => void;
}): ReactElement {
  const result = useAxiomMarkAction(props.nodeId);
  props.onResult(result);
  return <span data-testid={`probe-${props.nodeId}`}>ok</span>;
}

function renderProbe(client: WsClient, nodeId: string = NODE_ID): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      markAxiom: () => Promise.resolve(),
      inFlightFor: () => false,
      lastErrorFor: () => undefined,
    },
  };
  const captureResult = (r: UseAxiomMarkActionResult): void => {
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
  resetAxiomMarkStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('axiomMarkStoreKey — composite key shape', () => {
  it('joins nodeId and participantId with `|` (UUID-safe separator)', () => {
    expect(axiomMarkStoreKey(NODE_ID, PARTICIPANT_A)).toBe(`${NODE_ID}|${PARTICIPANT_A}`);
    expect(axiomMarkStoreKey(NODE_ID, PARTICIPANT_B)).toBe(`${NODE_ID}|${PARTICIPANT_B}`);
  });

  it('produces distinct keys for distinct (nodeId, participantId) pairs', () => {
    expect(axiomMarkStoreKey(NODE_ID, PARTICIPANT_A)).not.toBe(
      axiomMarkStoreKey(NODE_ID, PARTICIPANT_B),
    );
  });
});

describe('useAxiomMarkAction — successful mark path', () => {
  it('fires exactly one propose envelope with the canonical axiom-mark payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({
      kind: 'axiom-mark',
      node_id: NODE_ID,
      participant: PARTICIPANT_A,
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
    const key = axiomMarkStoreKey(NODE_ID, PARTICIPANT_A);
    expect(probe.result.inFlightFor(PARTICIPANT_A)).toBe(false);
    expect(probe.result.lastErrorFor(PARTICIPANT_A)).toBeUndefined();
    expect(useAxiomMarkStore.getState().inFlight.has(key)).toBe(false);
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at mark-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 4 via a synthetic event.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '66666666-6666-4666-8666-000000000004',
        sessionId: SESSION_ID,
        sequence: 4,
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
      void probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(4);
  });

  it('inFlightFor is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    const key = axiomMarkStoreKey(NODE_ID, PARTICIPANT_A);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(useAxiomMarkStore.getState().inFlight.has(key)).toBe(true);
    expect(probe.result.inFlightFor(PARTICIPANT_A)).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await markPromise;
    });
    expect(useAxiomMarkStore.getState().inFlight.has(key)).toBe(false);
    expect(probe.result.inFlightFor(PARTICIPANT_A)).toBe(false);
  });
});

describe('useAxiomMarkAction — error paths', () => {
  it('axiom-mark-not-self rejection — wire-error lands verbatim in useAxiomMarkStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAxiom(PARTICIPANT_A);
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
    const key = axiomMarkStoreKey(NODE_ID, PARTICIPANT_A);
    expect(probe.result.inFlightFor(PARTICIPANT_A)).toBe(false);
    expect(useAxiomMarkStore.getState().inFlight.has(key)).toBe(false);
    expect(probe.result.lastErrorFor(PARTICIPANT_A)).toEqual({
      code: 'axiom-mark-not-self',
      message: 'propose axiom-mark: requester X cannot mark an axiom on behalf of participant Y',
    });
  });

  it('timeout — wire-error has code "timeout" + localized timeout message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAxiom(PARTICIPANT_A);
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await markPromise;
    });
    const lastError = probe.result.lastErrorFor(PARTICIPANT_A);
    expect(lastError?.code).toBe('timeout');
    // The localized timeout text is the en-US chrome string set at
    // `createI18nInstance('en-US')` startup.
    expect(lastError?.message).toBe('The mark request timed out — try again');
  });

  it('plain Error — wire-error has code "unknown" + the error message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let markPromise: Promise<void> | undefined;
    act(() => {
      markPromise = probe.result.markAxiom(PARTICIPANT_A);
    });
    act(() => {
      fake.rejectNext(new Error('socket closed'));
    });
    await act(async () => {
      await markPromise;
    });
    expect(probe.result.lastErrorFor(PARTICIPANT_A)).toEqual({
      code: 'unknown',
      message: 'socket closed',
    });
  });

  it('next mark click on the same key clears the prior error before firing', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.markAxiom(PARTICIPANT_A);
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'axiom-mark-not-self',
          message: 'Not yet.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    const key = axiomMarkStoreKey(NODE_ID, PARTICIPANT_A);
    expect(useAxiomMarkStore.getState().errors.has(key)).toBe(true);
    // Re-click — the in-flight flip clears the prior error BEFORE the
    // second envelope fires.
    act(() => {
      void probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(useAxiomMarkStore.getState().errors.has(key)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useAxiomMarkAction — concurrency + key isolation', () => {
  it('concurrent re-call on the same key while inFlight is a no-op (no second envelope)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(fake.calls.length).toBe(1);
  });

  it('different participantIds against the same node have disjoint in-flight slices', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    const keyA = axiomMarkStoreKey(NODE_ID, PARTICIPANT_A);
    const keyB = axiomMarkStoreKey(NODE_ID, PARTICIPANT_B);
    act(() => {
      void probe.result.markAxiom(PARTICIPANT_A);
    });
    expect(probe.result.inFlightFor(PARTICIPANT_A)).toBe(true);
    expect(probe.result.inFlightFor(PARTICIPANT_B)).toBe(false);
    expect(useAxiomMarkStore.getState().inFlight.has(keyA)).toBe(true);
    expect(useAxiomMarkStore.getState().inFlight.has(keyB)).toBe(false);
    // A concurrent mark on the other key DOES fire (no cross-key
    // short-circuit) — both envelopes go out.
    act(() => {
      void probe.result.markAxiom(PARTICIPANT_B);
    });
    expect(fake.calls.length).toBe(2);
    expect(probe.result.inFlightFor(PARTICIPANT_B)).toBe(true);
  });

  it('successful mark clears any prior error for the same key', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // First — fail with an error.
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.markAxiom(PARTICIPANT_A);
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'axiom-mark-not-self',
          message: 'rejected',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastErrorFor(PARTICIPANT_A)).toBeDefined();
    // Second — succeed; the error slice gets cleared in the success
    // arm.
    let second: Promise<void> | undefined;
    act(() => {
      second = probe.result.markAxiom(PARTICIPANT_A);
    });
    act(() => {
      fake.resolveNext({ sequence: 2 });
    });
    await act(async () => {
      await second;
    });
    expect(probe.result.lastErrorFor(PARTICIPANT_A)).toBeUndefined();
  });
});
