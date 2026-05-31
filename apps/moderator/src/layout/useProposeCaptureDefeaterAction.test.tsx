// Tests for `useProposeCaptureDefeaterAction()` — the
// propose-capture-defeater hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The six `canPropose` gates fire correctly (session-id empty /
//      WS not open / mode wrong / target null / wording empty / propose
//      in flight) — one assert per gate.
//   2. The success path sends exactly one `propose capture-node`
//      envelope whose payload carries the optional `edge` block with
//      `role='rebuts'`, the just-minted Y as `source_node_id`, and the
//      staged `captureDefeaterTargetNodeId` as `target_node_id`. The
//      annotation-endpoint slots are absent.
//   3. The success path calls `exitCaptureDefeaterMode` + `setText('')`
//      and clears `lastError`.
//   4. Snapshot restore on `WsRequestError` — `text` re-populates,
//      mode + target stay in place, `lastError` carries the wire code
//      + message, `proposing` flips back to false.
//   5. Snapshot restore on `WsRequestTimeoutError` — the F1
//      `moderator.proposeAction.timeoutError` localized message lands
//      in `lastError` (reused per Decision §D8).
//   6. After a failed propose, editing the `text` slice clears
//      `lastError` (the auto-dismiss `useEffect`).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  useProposeCaptureDefeaterAction,
  resetProposeCaptureDefeaterError,
  type UseProposeCaptureDefeaterActionResult,
} from './useProposeCaptureDefeaterAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_NODE_ID = '22222222-2222-4222-8222-222222222222';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface ProposeCall<T extends WsMessageType = 'propose'> {
  readonly type: T;
  readonly payload: WsMessagePayloadMap[T];
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
    callIndex: number;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as ProposeCall);
    const callIndex = calls.length - 1;
    return new Promise<WsEnvelopeUnion>((resolve, reject) => {
      pending.push({ resolve, reject, callIndex });
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
      const eventId = opts.eventId ?? '33333333-3333-4333-8333-333333333333';
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
  result: UseProposeCaptureDefeaterActionResult;
}

function Probe(props: {
  onResult: (r: UseProposeCaptureDefeaterActionResult) => void;
}): ReactElement {
  const result = useProposeCaptureDefeaterAction();
  props.onResult(result);
  return (
    <span data-testid="probe" data-in-flight={result.inFlight ? '1' : '0'}>
      {result.inFlight ? 'in-flight' : 'idle'}
    </span>
  );
}

function renderProbe(client: WsClient): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      propose: () => Promise.resolve(),
      canPropose: false,
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseProposeCaptureDefeaterActionResult): void => {
    handle.result = r;
  };

  const path = SESSION_ID;
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
      <Probe onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

/**
 * Bring the store into a "valid capture-defeater, ready to propose"
 * state: mode = 'capture-defeater', target node staged, wording set.
 */
function primeValidCaptureDefeater(): void {
  useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
  useCaptureStore.getState().setText('Cost-of-living adjustments fully cover all worker expenses.');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeCaptureDefeaterError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeCaptureDefeaterAction — canPropose gates', () => {
  it('canPropose is false on a fresh idle state (mode wrong + target null + text empty)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is false when the WS connection is not open', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().setConnectionStatus('reconnecting');
      primeValidCaptureDefeater();
    });
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is false when mode is not capture-defeater (e.g. idle)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setCaptureDefeaterTargetNodeId(TARGET_NODE_ID);
      useCaptureStore.getState().setText('some wording');
    });
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is false when no target node is staged', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
      useCaptureStore.getState().setCaptureDefeaterTargetNodeId(null);
    });
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is false when the wording trims to empty', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
      useCaptureStore.getState().setText('   ');
    });
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is false when a propose round-trip is already in flight', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
      useCaptureStore.getState().setProposing(true);
    });
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose is true when all six gates pass', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    expect(probe.result.canPropose).toBe(true);
  });
});

describe('useProposeCaptureDefeaterAction — success path', () => {
  it('sends exactly one capture-node-with-edge envelope (role=rebuts, Y=source, X=target)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      proposal: {
        kind: string;
        node_id: string;
        wording: string;
        edge: {
          edge_id: string;
          role: string;
          source_node_id?: string;
          target_node_id?: string;
          source_annotation_id?: string;
          target_annotation_id?: string;
        };
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal.kind).toBe('capture-node');
    expect(payload.proposal.wording).toBe(
      'Cost-of-living adjustments fully cover all worker expenses.',
    );
    expect(payload.proposal.node_id).toMatch(UUID_V4);
    // The new defeater node Y is the edge source; the staged target X
    // is the edge target. role='rebuts'. Annotation-endpoint slots
    // absent (defeater capture is always node-to-node).
    expect(payload.proposal.edge.edge_id).toMatch(UUID_V4);
    expect(payload.proposal.edge.edge_id).not.toBe(payload.proposal.node_id);
    expect(payload.proposal.edge.role).toBe('rebuts');
    expect(payload.proposal.edge.source_node_id).toBe(payload.proposal.node_id);
    expect(payload.proposal.edge.target_node_id).toBe(TARGET_NODE_ID);
    expect(payload.proposal.edge.source_annotation_id).toBeUndefined();
    expect(payload.proposal.edge.target_annotation_id).toBeUndefined();
  });

  it('on success: exits capture-defeater mode, clears text, releases in-flight, drops lastError', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // While in-flight, the slices have NOT yet been reset by the
    // success path (the post-success clear runs after the WS promise
    // resolves).
    expect(useCaptureStore.getState().proposing).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.captureDefeaterTargetNodeId).toBeNull();
    expect(state.text).toBe('');
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
  });
});

describe('useProposeCaptureDefeaterAction — error paths', () => {
  it('snapshot restore on WsRequestError; lastError carries wire code + message; mode + target stay in place', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({ code: 'illegal-state-transition', message: 'rejected by engine' }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('capture-defeater');
    expect(state.captureDefeaterTargetNodeId).toBe(TARGET_NODE_ID);
    expect(state.text).toBe('Cost-of-living adjustments fully cover all worker expenses.');
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError?.code).toBe('illegal-state-transition');
    expect(probe.result.lastError?.message).toBe('rejected by engine');
  });

  it('snapshot restore on WsRequestTimeoutError; localized F1 timeout message lands in lastError (Decision §D8 reuse)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id'));
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('capture-defeater');
    expect(state.text).toBe('Cost-of-living adjustments fully cover all worker expenses.');
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The propose request timed out. Check your connection and try again.',
    );
  });
});

describe('useProposeCaptureDefeaterAction — wire-error auto-dismissal', () => {
  it('lastError clears when the moderator edits text after a failure', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidCaptureDefeater();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(new WsRequestError({ code: 'foo', message: 'bar' }));
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.lastError?.code).toBe('foo');
    act(() => {
      useCaptureStore.getState().setText('a fresh edit by the moderator');
    });
    expect(probe.result.lastError).toBeUndefined();
  });
});
