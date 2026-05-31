// Tests for `useMetaMoveAction()` — the propose-meta-move hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The canPropose gate chain fires in order (session-missing →
//      not-connected → content-missing → target-missing →
//      target-kind-invalid → kind-missing) — one assert per gate.
//   2. The success path sends exactly one `propose meta-move` envelope
//      whose payload mirrors `metaMoveProposalSchema`: { kind:
//      'meta-move', meta_kind, content, target_kind: 'node',
//      target_id }.
//   3. The success path clears `text` + `targetEntityId` optimistically
//      and leaves mode + metaMoveKind in place so the moderator can
//      compose another meta-move without re-pressing F8.
//   4. Snapshot restore on `WsRequestError` — `text`, `targetEntityId`,
//      `metaMoveKind` re-populate; mode stays in meta-move; lastError
//      carries the wire code + message; proposing flips back to false.
//   5. Snapshot restore on `WsRequestTimeoutError` — the localized
//      meta-move timeout message lands in `lastError`.
//   6. After a failed propose, editing the `text` slice clears
//      `lastError` (the auto-dismiss `useEffect`).
//   7. The in-flight guard rejects a concurrent re-entry.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  useMetaMoveAction,
  resetMetaMoveError,
  type UseMetaMoveActionResult,
} from './useMetaMoveAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_NODE_ID = '22222222-2222-4222-8222-222222222222';

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
  result: UseMetaMoveActionResult;
}

function Probe(props: { onResult: (r: UseMetaMoveActionResult) => void }): ReactElement {
  const result = useMetaMoveAction();
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
      proposeMetaMove: () => Promise.resolve(),
      canPropose: false,
      validationError: null,
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseMetaMoveActionResult): void => {
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
 * Bring the store into a "valid meta-move, ready to propose" state:
 * mode = 'meta-move', target node staged, content set, metaMoveKind
 * defaulted to 'reframe'.
 */
function primeValidMetaMove(): void {
  useCaptureStore.getState().enterMetaMoveMode();
  useCaptureStore.getState().setTargetEntityId(TARGET_NODE_ID);
  useCaptureStore
    .getState()
    .setText('The netting question is the operational form of the deeper dispute.');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetMetaMoveError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useMetaMoveAction — validation gates', () => {
  it('validationError is content-missing on a fresh idle state with WS open (text empty wins over target gate)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    expect(probe.result.canPropose).toBe(false);
    expect(probe.result.validationError).toBe('content-missing');
  });

  it('validationError is not-connected when the WS connection is not open', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().setConnectionStatus('reconnecting');
      primeValidMetaMove();
    });
    expect(probe.result.validationError).toBe('not-connected');
    expect(probe.result.canPropose).toBe(false);
  });

  it('validationError is content-missing when text trims to empty', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setTargetEntityId(TARGET_NODE_ID);
      useCaptureStore.getState().setText('   ');
    });
    expect(probe.result.validationError).toBe('content-missing');
  });

  it('validationError is target-missing when no target is staged', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setText('Some content.');
    });
    expect(probe.result.validationError).toBe('target-missing');
  });

  it('validationError is target-kind-invalid when the staged target is an annotation', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setText('Some content.');
      useCaptureStore.getState().setTargetEntity('annotation', 'a-1');
    });
    expect(probe.result.validationError).toBe('target-kind-invalid');
  });

  it('validationError is kind-missing when metaMoveKind is null', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
      useCaptureStore.getState().setMetaMoveKind(null);
    });
    expect(probe.result.validationError).toBe('kind-missing');
  });

  it('canPropose is true when all gates pass', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    expect(probe.result.canPropose).toBe(true);
    expect(probe.result.validationError).toBeNull();
  });
});

describe('useMetaMoveAction — success path', () => {
  it('sends exactly one meta-move envelope with kind=meta-move, target_kind=node, default meta_kind=reframe', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    act(() => {
      void probe.result.proposeMetaMove();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      proposal: {
        kind: string;
        meta_kind: string;
        content: string;
        target_kind: string;
        target_id: string;
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal.kind).toBe('meta-move');
    expect(payload.proposal.meta_kind).toBe('reframe');
    expect(payload.proposal.content).toBe(
      'The netting question is the operational form of the deeper dispute.',
    );
    expect(payload.proposal.target_kind).toBe('node');
    expect(payload.proposal.target_id).toBe(TARGET_NODE_ID);
  });

  it('honors metaMoveKind="scope-change" when set explicitly', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
      useCaptureStore.getState().setMetaMoveKind('scope-change');
    });
    act(() => {
      void probe.result.proposeMetaMove();
    });
    const payload = fake.calls[0]?.payload as { proposal: { meta_kind: string } };
    expect(payload.proposal.meta_kind).toBe('scope-change');
  });

  it('on success: clears text + targetEntityId, leaves mode + metaMoveKind in place, drops lastError', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.proposeMetaMove();
    });
    expect(useCaptureStore.getState().proposing).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('meta-move');
    expect(state.text).toBe('');
    expect(state.targetEntityId).toBeNull();
    expect(state.metaMoveKind).toBe('reframe');
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
  });
});

describe('useMetaMoveAction — error paths', () => {
  it('snapshot restore on WsRequestError; lastError carries wire code + message; mode + target stay in place', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.proposeMetaMove();
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
    expect(state.mode).toBe('meta-move');
    expect(state.targetEntityId).toBe(TARGET_NODE_ID);
    expect(state.text).toBe('The netting question is the operational form of the deeper dispute.');
    expect(state.metaMoveKind).toBe('reframe');
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError?.code).toBe('illegal-state-transition');
    expect(probe.result.lastError?.message).toBe('rejected by engine');
  });

  it('snapshot restore on WsRequestTimeoutError; localized meta-move timeout message lands in lastError', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.proposeMetaMove();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id'));
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('meta-move');
    expect(state.text).toBe('The netting question is the operational form of the deeper dispute.');
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The meta-move propose request timed out. Check your connection and try again.',
    );
  });

  it('snapshot restore on a generic Error; lastError code is "unknown"', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.proposeMetaMove();
    });
    act(() => {
      fake.rejectNext(new Error('something broke'));
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.lastError?.code).toBe('unknown');
    expect(probe.result.lastError?.message).toBe('something broke');
  });
});

describe('useMetaMoveAction — wire-error auto-dismissal', () => {
  it('lastError clears when the moderator edits text after a failure', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.proposeMetaMove();
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

describe('useMetaMoveAction — in-flight guard', () => {
  it('concurrent proposeMetaMove() during an in-flight round-trip is a no-op (no second send)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidMetaMove();
    });
    let firstPromise: Promise<void> | undefined;
    act(() => {
      firstPromise = probe.result.proposeMetaMove();
    });
    // While in-flight, fire again — the guard rejects re-entry silently.
    act(() => {
      void probe.result.proposeMetaMove();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.pendingCount()).toBe(1);
    // Resolve so the test cleans up.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await firstPromise;
    });
  });
});
