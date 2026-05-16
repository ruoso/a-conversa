// Tests for `useProposeDecompositionAction()` — the
// propose-decomposition hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. Validation gates fire in the documented order; `canPropose` is
//      false unless all four pass.
//   2. The success path sends exactly one `propose` envelope carrying
//      the decompose proposal shape — the `text → wording` rename
//      applied, `expectedSequence` read from `useWsStore`,
//      `parent_node_id` matching the target slice.
//   3. Optimistic clear via `exitDecomposeMode` — the decompose slices
//      are reset BEFORE the WS promise resolves.
//   4. Snapshot restore on `WsRequestError` — the slices are
//      re-populated via `enterDecomposeMode` + per-row setter replay;
//      `lastError` carries the wire payload's code + message.
//   5. Snapshot restore on `WsRequestTimeoutError` — the localized
//      timeout message lands in `lastError`.
//   6. `inFlight` flips true during the round-trip and false on
//      resolve / reject.
//   7. Concurrent re-call is a no-op — calling `propose()` while
//      `inFlight === true` does not fire a second envelope.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  useProposeDecompositionAction,
  resetProposeDecompositionError,
  type UseProposeDecompositionActionResult,
} from './useProposeDecompositionAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '../ws/WsClientProvider';
import { WsRequestError, WsRequestTimeoutError } from '../ws/client';
import type { SendFn, WsClient, WsClientStatus } from '../ws/client';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { initI18n } from '../i18n';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_NODE_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await initI18n('en-US');
});

interface ProposeCall<T extends WsMessageType = 'propose'> {
  readonly type: T;
  readonly payload: WsMessagePayloadMap[T];
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
  /** Latest snapshot of the hook result. */
  result: UseProposeDecompositionActionResult;
}

function Probe(props: {
  onResult: (r: UseProposeDecompositionActionResult) => void;
}): ReactElement {
  const result = useProposeDecompositionAction();
  props.onResult(result);
  return (
    <span data-testid="probe" data-in-flight={result.inFlight ? '1' : '0'}>
      {result.inFlight ? 'in-flight' : 'idle'}
    </span>
  );
}

function renderProbe(client: WsClient, options: { sessionIdOverride?: string } = {}): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      propose: () => Promise.resolve(),
      canPropose: false,
      validationError: null,
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseProposeDecompositionActionResult): void => {
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
      <Probe onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

/**
 * Set the store into a "valid decompose, ready to propose" pre-state:
 * `mode='decompose'`, `decomposeTargetNodeId=PARENT_NODE_ID`, two rows
 * with non-empty text + classification.
 */
function primeValidDecompose(): void {
  useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
  useCaptureStore.getState().setDecomposeComponentText(0, 'Workers should earn a living wage.');
  useCaptureStore.getState().setDecomposeComponentClassification(0, 'value');
  useCaptureStore.getState().setDecomposeComponentText(1, 'Workers should receive fair benefits.');
  useCaptureStore.getState().setDecomposeComponentClassification(1, 'normative');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeDecompositionError();
  // Default: a healthy WS connection (the validation gate requires
  // `connectionStatus === 'open'`). Individual tests override.
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeDecompositionAction — validation gates', () => {
  it('canPropose is false and validationError is target-missing on a fresh idle state', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    expect(probe.result.canPropose).toBe(false);
    expect(probe.result.validationError).toBe('target-missing');
  });

  it('validationError is components-invalid on the seeded empty-row state after entering decompose mode', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
    });
    // enterDecomposeMode seeds two empty rows; the validator returns
    // false because trimmed text is empty.
    expect(probe.result.validationError).toBe('components-invalid');
    expect(probe.result.canPropose).toBe(false);
  });

  it('canPropose becomes true once both rows have non-empty text + classification', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    expect(probe.result.validationError).toBeNull();
    expect(probe.result.canPropose).toBe(true);
  });

  it('validationError is not-connected when the WS status is anything but open', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().setConnectionStatus('reconnecting');
      primeValidDecompose();
    });
    expect(probe.result.validationError).toBe('not-connected');
  });
});

describe('useProposeDecompositionAction — success path', () => {
  it('sends exactly one propose envelope with the decompose payload shape (text → wording rename applied)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      expectedSequence: number;
      proposal: {
        kind: string;
        parent_node_id: string;
        components: Array<{ wording: string; classification: string }>;
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.expectedSequence).toBe(0);
    expect(payload.proposal.kind).toBe('decompose');
    expect(payload.proposal.parent_node_id).toBe(PARENT_NODE_ID);
    expect(payload.proposal.components).toEqual([
      { wording: 'Workers should earn a living wage.', classification: 'value' },
      { wording: 'Workers should receive fair benefits.', classification: 'normative' },
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
  });

  it('optimistically clears the decompose slices via exitDecomposeMode BEFORE the WS promise resolves', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    act(() => {
      void probe.result.propose();
    });
    // The store is reset synchronously; the promise has NOT resolved.
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.decomposeTargetNodeId).toBeNull();
    expect(state.decomposeComponents).toEqual([]);
    expect(state.proposing).toBe(true);
    expect(fake.pendingCount()).toBe(1);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    expect(useCaptureStore.getState().proposing).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await proposePromise;
    });
    expect(useCaptureStore.getState().proposing).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });

  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    // Set up a second valid draft so the validation gate would
    // otherwise pass — proves the in-flight guard, not the
    // target-missing gate, is what blocks the second call.
    act(() => {
      primeValidDecompose();
    });
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
  });

  it('reads expectedSequence from the WS store at call-time', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 5 so the envelope
    // reads it.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '44444444-4444-4444-8444-000000000005',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '55555555-5555-4555-8555-555555555555',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      } as never);
      primeValidDecompose();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    const payload = fake.calls[0]?.payload as { expectedSequence: number };
    expect(payload.expectedSequence).toBe(5);
    act(() => {
      fake.resolveNext({ sequence: 6 });
    });
    await act(async () => {
      await proposePromise;
    });
  });
});

describe('useProposeDecompositionAction — error paths', () => {
  it('snapshot restore on WsRequestError; lastError carries wire code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // Confirm optimistic clear happened.
    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().decomposeComponents).toEqual([]);
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
          message: 'parent already superseded',
        }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('decompose');
    expect(state.decomposeTargetNodeId).toBe(PARENT_NODE_ID);
    expect(state.decomposeComponents).toEqual([
      { text: 'Workers should earn a living wage.', classification: 'value' },
      { text: 'Workers should receive fair benefits.', classification: 'normative' },
    ]);
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError?.code).toBe('illegal-state-transition');
    expect(probe.result.lastError?.message).toBe('parent already superseded');
  });

  it('snapshot restore re-populates more than two rows via per-row replay', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
      useCaptureStore.getState().addDecomposeComponent();
      useCaptureStore.getState().setDecomposeComponentText(0, 'Row 0');
      useCaptureStore.getState().setDecomposeComponentClassification(0, 'fact');
      useCaptureStore.getState().setDecomposeComponentText(1, 'Row 1');
      useCaptureStore.getState().setDecomposeComponentClassification(1, 'value');
      useCaptureStore.getState().setDecomposeComponentText(2, 'Row 2');
      useCaptureStore.getState().setDecomposeComponentClassification(2, 'normative');
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(new WsRequestError({ code: 'methodology-rejection', message: 'rejected' }));
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('decompose');
    expect(state.decomposeComponents).toEqual([
      { text: 'Row 0', classification: 'fact' },
      { text: 'Row 1', classification: 'value' },
      { text: 'Row 2', classification: 'normative' },
    ]);
  });

  it('snapshot restore on WsRequestTimeoutError; localized timeout message lands in lastError', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
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
    expect(state.mode).toBe('decompose');
    expect(state.decomposeTargetNodeId).toBe(PARENT_NODE_ID);
    expect(state.decomposeComponents.length).toBe(2);
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The propose decomposition request timed out. Check your connection and try again.',
    );
  });
});

describe('useProposeDecompositionAction — wire-error auto-dismissal', () => {
  it('lastError clears when the moderator edits a per-row textarea after a failure', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      primeValidDecompose();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    act(() => {
      fake.rejectNext(new WsRequestError({ code: 'methodology-rejection', message: 'rejected' }));
    });
    await act(async () => {
      await proposePromise;
    });
    expect(probe.result.lastError?.code).toBe('methodology-rejection');
    // Now type into row 0 — the dismissal effect should fire because
    // the `decomposeComponents` array reference changed.
    act(() => {
      useCaptureStore.getState().setDecomposeComponentText(0, 'user is fixing it');
    });
    expect(probe.result.lastError).toBeUndefined();
  });
});

// Silence the act-warning console.error noise during the noop console
// hits the unrelated React internals could trigger. Reset between cases
// is implicit (each `renderProbe` mounts a fresh subtree).
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) return;
  // Re-emit other errors so test failures stay visible.
  process.stderr.write(args.map((a) => String(a)).join(' ') + '\n');
});
