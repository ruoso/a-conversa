// Tests for `useProposeProposalAction({ mode })` — the parameterised
// propose-{decomposition,interpretive-split} hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
//
// The existing `useProposeDecompositionAction.test.tsx` exhaustively
// covers the decompose-mode body (via the thin-wrapper); these cases
// pin the per-mode parameterisation under `mode: 'interpretive-split'`
// — the envelope shape (kind + per-row field name), the
// optimistic-clear helper switch, the snapshot-restore-on-error
// switch, and the per-mode error-store separation.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  useProposeProposalAction,
  resetProposeDecompositionError,
  resetProposeInterpretiveSplitError,
  useProposeDecompositionErrorStore,
  useProposeInterpretiveSplitErrorStore,
  type UseProposeProposalActionResult,
} from './useProposeProposalAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_NODE_ID = '22222222-2222-4222-8222-222222222222';

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
  };
}

interface ProbeHandle {
  result: UseProposeProposalActionResult;
}

function ProbeFactory(mode: 'decompose' | 'interpretive-split') {
  return function Probe(props: {
    onResult: (r: UseProposeProposalActionResult) => void;
  }): ReactElement {
    const result = useProposeProposalAction({ mode });
    props.onResult(result);
    return (
      <span data-testid="probe" data-in-flight={result.inFlight ? '1' : '0'}>
        {result.inFlight ? 'in-flight' : 'idle'}
      </span>
    );
  };
}

function renderProbe(client: WsClient, mode: 'decompose' | 'interpretive-split'): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      propose: () => Promise.resolve(),
      canPropose: false,
      validationError: null,
      inFlight: false,
      lastError: undefined,
    },
  };
  const Probe = ProbeFactory(mode);
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
      <Probe
        onResult={(r) => {
          handle.result = r;
        }}
      />
    </Wrapper>,
  );
  return handle;
}

function primeValidInterpretiveSplit(): void {
  useCaptureStore.getState().enterInterpretiveSplitMode(PARENT_NODE_ID);
  useCaptureStore
    .getState()
    .setInterpretiveSplitReadingText(0, 'Welfare deficits are our evidence for capacities.');
  useCaptureStore.getState().setInterpretiveSplitReadingClassification(0, 'fact');
  useCaptureStore
    .getState()
    .setInterpretiveSplitReadingText(1, 'Capability-frustration just is welfare loss.');
  useCaptureStore.getState().setInterpretiveSplitReadingClassification(1, 'value');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeDecompositionError();
  resetProposeInterpretiveSplitError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useProposeProposalAction — mode="interpretive-split" envelope shape', () => {
  it('constructs an envelope with kind: "interpretive-split" and a readings (NOT components) field; per-row text → wording rename applied; per-reading node_id minted client-side', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, 'interpretive-split');
    act(() => {
      primeValidInterpretiveSplit();
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
        readings?: Array<{ wording: string; classification: string; node_id: string }>;
        components?: unknown;
      };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal.kind).toBe('interpretive-split');
    expect(payload.proposal.parent_node_id).toBe(PARENT_NODE_ID);
    expect(payload.proposal.readings).toHaveLength(2);
    expect(payload.proposal.readings![0]!.wording).toBe(
      'Welfare deficits are our evidence for capacities.',
    );
    expect(payload.proposal.readings![0]!.classification).toBe('fact');
    expect(payload.proposal.readings![1]!.wording).toBe(
      'Capability-frustration just is welfare loss.',
    );
    expect(payload.proposal.readings![1]!.classification).toBe('value');
    // Per `mod_decompose_propose_time_canvas_visibility` D2, the
    // per-reading `node_id` is minted client-side at envelope-build
    // time. Pin the UUID-v4 shape (not a deterministic ID match)
    // because the mint strategy is not test-coupled.
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(payload.proposal.readings![0]!.node_id).toMatch(UUID_V4);
    expect(payload.proposal.readings![1]!.node_id).toMatch(UUID_V4);
    // The two readings must have DISTINCT ids (defensive against a
    // shared/stale-state regression in the mint loop).
    expect(payload.proposal.readings![0]!.node_id).not.toBe(payload.proposal.readings![1]!.node_id);
    expect(payload.proposal.components).toBeUndefined();
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    return act(async () => {
      await proposePromise;
    });
  });

  // Per `mod_decompose_propose_time_canvas_visibility` D2: a retry
  // after a failed propose mints FRESH ids — the per-row state
  // doesn't carry the ids (they're derived at envelope-build-time),
  // so a second invocation of buildProposal mints a new set. This
  // pins the "fresh ids per attempt" contract from D2's rationale.
  it('mints fresh per-reading node_id values on each propose call (no carry-over from prior invocations)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, 'interpretive-split');
    act(() => {
      primeValidInterpretiveSplit();
    });
    let firstPromise: Promise<void> | undefined;
    act(() => {
      firstPromise = probe.result.propose();
    });
    expect(fake.calls.length).toBe(1);
    const firstPayload = fake.calls[0]?.payload as {
      proposal: { readings?: Array<{ node_id: string }> };
    };
    const firstIds = firstPayload.proposal.readings!.map((r) => r.node_id);

    // Reject the first attempt — buildProposal's catch path restores
    // the per-row state + flips `proposing` back to false.
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
          message: 'retry me',
        }),
      );
    });
    await act(async () => {
      await firstPromise;
    });
    // Issue a second propose against the restored per-row state —
    // buildProposal mints a fresh set of ids.
    act(() => {
      void probe.result.propose();
    });
    expect(fake.calls.length).toBe(2);
    const secondPayload = fake.calls[1]?.payload as {
      proposal: { readings?: Array<{ node_id: string }> };
    };
    const secondIds = secondPayload.proposal.readings!.map((r) => r.node_id);
    expect(secondIds[0]).not.toBe(firstIds[0]);
    expect(secondIds[1]).not.toBe(firstIds[1]);
  });

  it('optimistic-clear under mode="interpretive-split" calls exitInterpretiveSplitMode (NOT exitDecomposeMode)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, 'interpretive-split');
    act(() => {
      primeValidInterpretiveSplit();
    });
    act(() => {
      void probe.result.propose();
    });
    const state = useCaptureStore.getState();
    expect(state.mode).toBe('idle');
    expect(state.interpretiveSplitTargetNodeId).toBeNull();
    expect(state.interpretiveSplitReadings).toEqual([]);
    expect(state.proposing).toBe(true);
  });

  it('snapshot-restore on error under mode="interpretive-split" calls enterInterpretiveSplitMode and replays per-row via the interpretive-split setters', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, 'interpretive-split');
    act(() => {
      primeValidInterpretiveSplit();
    });
    let proposePromise: Promise<void> | undefined;
    act(() => {
      proposePromise = probe.result.propose();
    });
    // Confirm optimistic clear.
    expect(useCaptureStore.getState().mode).toBe('idle');
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
    expect(state.mode).toBe('interpretive-split');
    expect(state.interpretiveSplitTargetNodeId).toBe(PARENT_NODE_ID);
    expect(state.interpretiveSplitReadings).toEqual([
      { text: 'Welfare deficits are our evidence for capacities.', classification: 'fact' },
      { text: 'Capability-frustration just is welfare loss.', classification: 'value' },
    ]);
    expect(probe.result.lastError?.code).toBe('illegal-state-transition');
  });
});

describe('useProposeProposalAction — per-mode error-store separation (Decision §6)', () => {
  it('a decompose-side error stays in its own module store and does NOT bleed into the interpretive-split-side store', () => {
    // Simulate a decompose-side error landing in the decompose store
    // directly via the test seam; assert the interpretive-split store
    // remains undefined (the two are independent module slices).
    useProposeDecompositionErrorStore.getState().setLastError({
      code: 'illegal-state-transition',
      message: 'decompose-side failure',
    });
    expect(useProposeInterpretiveSplitErrorStore.getState().lastError).toBeUndefined();
    expect(useProposeDecompositionErrorStore.getState().lastError?.code).toBe(
      'illegal-state-transition',
    );
  });

  it('a "decompose" probe sees only the decompose store; an "interpretive-split" probe sees only the interpretive-split store', () => {
    useProposeDecompositionErrorStore.getState().setLastError({
      code: 'illegal-state-transition',
      message: 'decompose-side failure',
    });
    useProposeInterpretiveSplitErrorStore.getState().setLastError({
      code: 'target-entity-not-found',
      message: 'interpretive-split-side failure',
    });
    const fakeA = makeFakeClient();
    const probeA = renderProbe(fakeA.client, 'decompose');
    expect(probeA.result.lastError?.message).toBe('decompose-side failure');
    cleanup();
    const fakeB = makeFakeClient();
    const probeB = renderProbe(fakeB.client, 'interpretive-split');
    expect(probeB.result.lastError?.message).toBe('interpretive-split-side failure');
  });
});

// Silence the act-warning console noise.
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) return;
  process.stderr.write(args.map((a) => String(a)).join(' ') + '\n');
});
