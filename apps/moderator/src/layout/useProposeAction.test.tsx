// Tests for `useProposeAction()` — the propose-bundle hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
//             tasks/refinements/per-facet-refactor/pf_mod_capture_pane_wording_only.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §4)
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. Validation gates fire in the documented order; `canPropose` is
//      false unless every gate passes. Per
//      `pf_mod_capture_pane_wording_only` the `classification-missing`
//      gate is dropped (the capture-pane gesture is wording-only;
//      classification moves to the per-node card by a downstream
//      task).
//   2. The free-floating success path sends exactly ONE `propose`
//      envelope minting a `capture-node` proposal with the wording
//      inline, NOT the legacy `classify-node`-with-wording bundle
//      (per ADR 0030 §1).
//   3. The connecting-capture success path sends exactly ONE `propose`
//      envelope (no second envelope) minting a `capture-node`
//      proposal with the inline `edge` block carrying the edge id +
//      role + endpoints (per ADR 0030 §4). The `source_node_id`
//      equals the freshly-minted node id; the `target_node_id` equals
//      the existing node the moderator clicked.
//   4. Optimistic clear — the capture-store slices are reset BEFORE
//      the WS promise resolves.
//   5. Snapshot restore on `WsRequestError` — the slices are
//      re-populated from the pre-clear snapshot; `lastError` carries
//      the wire payload's code + message.
//   6. Snapshot restore on `WsRequestTimeoutError` — the localized
//      timeout message lands in `lastError`.
//   7. `inFlight` flips true during the round-trip and false on
//      resolve / reject.
//   8. Concurrent re-call is a no-op — calling `propose()` while
//      `inFlight === true` does not fire a second envelope.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  useProposeAction,
  resetProposeError,
  type UseProposeActionResult,
} from './useProposeAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

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
      const eventId = opts.eventId ?? '22222222-2222-4222-8222-222222222222';
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
  result: UseProposeActionResult;
}

function Probe(props: { onResult: (r: UseProposeActionResult) => void }): ReactElement {
  const result = useProposeAction();
  // Update the captured result on every render so the test reader
  // always sees the latest snapshot. `useEffect` would defer the
  // update one tick; calling synchronously during render is the
  // cheapest way to keep the handle live (the function does NOT
  // call any React APIs, so no commit-phase warning fires).
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
  const captureResult = (r: UseProposeActionResult): void => {
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

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeError();
  // Default: a healthy WS connection (the validation gate requires
  // `connectionStatus === 'open'`). Individual tests override.
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeAction — validation gates', () => {
  it('canPropose is false and validationError is text-empty on a fresh draft (connection open)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    expect(probe.result.canPropose).toBe(false);
    expect(probe.result.validationError).toBe('text-empty');
  });

  // Per `pf_mod_capture_pane_wording_only` the `classification-missing`
  // gate is gone — a non-empty wording with no other staged target is
  // sufficient for the capture-pane gesture. Classification moves to
  // the per-node card (downstream task).
  it('canPropose becomes true once text is set (free-floating wording-only capture)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Hello world');
    });
    expect(probe.result.validationError).toBeNull();
    expect(probe.result.canPropose).toBe(true);
  });

  it('validationError is target-without-role when target is staged but role is null', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Hello world');
      useCaptureStore.getState().setTargetEntityId('node-1');
    });
    expect(probe.result.validationError).toBe('target-without-role');
    expect(probe.result.canPropose).toBe(false);
  });

  it('validationError is not-connected when the WS status is anything but open', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().setConnectionStatus('reconnecting');
      useCaptureStore.getState().setText('Hello world');
    });
    expect(probe.result.validationError).toBe('not-connected');
  });
});

describe('useProposeAction — free-floating success path (capture-node, wording-only)', () => {
  it('sends exactly one propose envelope minting a capture-node with inline wording', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('The sky is blue');
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
        node_id: string;
        wording: string;
        edge?: unknown;
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.expectedSequence).toBe(0);
    // Per ADR 0030 §1 the capture-pane gesture is wording-only — the
    // proposal sub-kind is `capture-node`, NOT the legacy
    // `classify-node`-with-wording bundle. The classification facet
    // enters life as `awaiting-proposal` and is named later by the
    // per-node card (downstream task).
    expect(payload.proposal.kind).toBe('capture-node');
    expect(payload.proposal.wording).toBe('The sky is blue');
    expect(typeof payload.proposal.node_id).toBe('string');
    expect(payload.proposal.node_id.length).toBeGreaterThan(0);
    // No `edge` block on the free-floating gesture.
    expect(payload.proposal.edge).toBeUndefined();

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

  it('optimistically clears the capture store BEFORE the WS promise resolves', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Optimistic-clear test');
    });
    act(() => {
      void probe.result.propose();
    });
    // The store is reset synchronously; the promise has NOT resolved.
    const state = useCaptureStore.getState();
    expect(state.text).toBe('');
    expect(state.targetEntityId).toBeNull();
    expect(state.edgeRole).toBeNull();
    expect(state.proposing).toBe(true);
    expect(fake.pendingCount()).toBe(1);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Inflight test');
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // Read directly from the store — the `inFlight` flag is the
    // `proposing` slice (per `useProposeAction.ts`); the probe handle
    // updates on re-render but the store update is synchronous.
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
      useCaptureStore.getState().setText('Concurrent re-call test');
    });
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    // Set up a second valid draft so the validation gate would
    // otherwise pass — proves the in-flight guard, not the
    // text-empty gate, is what blocks the second call.
    act(() => {
      useCaptureStore.getState().setText('Second attempt');
    });
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
  });
});

describe('useProposeAction — connecting-capture success path (capture-node with inline edge)', () => {
  it('sends exactly one propose envelope minting capture-node with an inline edge block', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 5 so the envelope
    // reads it as `expectedSequence`.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '33333333-3333-4333-8333-000000000005',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '44444444-4444-4444-8444-444444444444',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-11T00:00:00.000Z',
        },
        createdAt: '2026-05-11T00:00:00.000Z',
      } as never);
      useCaptureStore.getState().setText('because Y');
      useCaptureStore.getState().setTargetEntityId('44444444-4444-4444-8444-444444444444');
      useCaptureStore.getState().setEdgeRole('supports');
    });
    expect(probe.result.canPropose).toBe(true);
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // Per ADR 0030 §4 the connecting-capture gesture is ONE
    // envelope, not two — the propose payload carries an optional
    // inline `edge` block.
    expect(fake.calls.length).toBe(1);
    expect(fake.pendingCount()).toBe(1);
    const payload = fake.calls[0]?.payload as {
      expectedSequence: number;
      proposal: {
        kind: string;
        node_id: string;
        wording: string;
        edge?: {
          edge_id: string;
          role: string;
          source_node_id: string;
          target_node_id: string;
        };
      };
    };
    expect(payload.expectedSequence).toBe(5);
    expect(payload.proposal.kind).toBe('capture-node');
    expect(payload.proposal.wording).toBe('because Y');
    expect(typeof payload.proposal.node_id).toBe('string');
    expect(payload.proposal.edge).toBeDefined();
    const edge = payload.proposal.edge!;
    expect(typeof edge.edge_id).toBe('string');
    expect(edge.edge_id.length).toBeGreaterThan(0);
    // Per ADR 0030 §4 + §5 the inline edge block carries the role +
    // endpoints. The source is the just-captured node; the target is
    // the node the moderator clicked.
    expect(edge.role).toBe('supports');
    expect(edge.source_node_id).toBe(payload.proposal.node_id);
    expect(edge.target_node_id).toBe('44444444-4444-4444-8444-444444444444');

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 6 });
    });
    await act(async () => {
      await proposePromise;
    });
    // No second envelope was queued.
    expect(fake.calls.length).toBe(1);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useProposeAction — error paths', () => {
  it('snapshot restore on WsRequestError; lastError carries wire code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Pre-restore text');
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // Confirm optimistic clear happened.
    expect(useCaptureStore.getState().text).toBe('');
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'not-a-participant',
          message: 'requester is not a participant in this session',
        }),
      );
    });
    await act(async () => {
      await proposePromise;
    });
    const state = useCaptureStore.getState();
    expect(state.text).toBe('Pre-restore text');
    expect(state.proposing).toBe(false);
    expect(probe.result.lastError?.code).toBe('not-a-participant');
    expect(probe.result.lastError?.message).toContain('not a participant');
  });

  it('snapshot restore on WsRequestTimeoutError; localized timeout message lands in lastError', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Timeout draft');
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
    expect(state.text).toBe('Timeout draft');
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The propose request timed out. Check your connection and try again.',
    );
  });
});

describe('useProposeAction — wire-error auto-dismissal', () => {
  it('lastError clears when the moderator edits the capture wording slice', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useCaptureStore.getState().setText('Edit-dismiss test');
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
    // Restore is sync — now type into the textarea (mutate the text
    // slice). The auto-dismiss effect should fire and clear lastError.
    act(() => {
      useCaptureStore.getState().setText('user is fixing it');
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
