// Tests for `useWithdrawAgreementAction(args)` — the per-target
// withdraw-agreement hook.
//
// Refinement: tasks/refinements/per-facet-refactor/
//             pf_part_withdraw_agreement_action.md.
//
// Per ADR 0022 these are committed Vitest cases. They lock in the
// hook's per-call contract:
//
//   1. **Successful withdraw** — fires exactly one `withdraw-agreement`
//      envelope with the canonical six-field payload (per
//      `wsWithdrawAgreementPayloadSchema`). Awaits the
//      `agreement-withdrawn` ack; removes the per-slot key from the
//      in-flight set.
//   2. **Engine rejection** — `WsRequestError` lands the error in
//      `useWithdrawAgreementActionStore.errors` keyed by the same
//      slot; the slot drops out of `withdrawing`.
//   3. **Timeout** — `WsRequestTimeoutError` lands a `{ code:
//      'timeout', ... }` error with a localized fallback message.
//   4. **Concurrent re-entry** — a second `withdraw()` call while
//      the first is in-flight is a no-op (no second envelope fires).
//   5. **`inFlight` reflects `useWithdrawAgreementActionStore.withdrawing`**
//      for the bound slot; disjoint between different
//      `(entity_kind, entity_id, facet)` triples.
//   6. **`expectedSequence` reads `lastAppliedSequence`** at click-
//      time (the WS store can advance between mounts and clicks).
//   7. **Per-slot keying isolation across the withdraw / vote
//      namespaces** — a withdraw in-flight on a facet does not
//      flip the vote-action store's in-flight slot for the same
//      `(entity_kind, entity_id, facet)` triple, and vice versa.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetWithdrawAgreementActionStore,
  useWithdrawAgreementAction,
  useWithdrawAgreementActionStore,
  slotKey,
  type UseWithdrawAgreementActionArgs,
  type UseWithdrawAgreementActionResult,
} from './useWithdrawAgreementAction';
import { useVoteActionStore, resetVoteActionStore } from './useVoteAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PARTICIPANT_ID = '00000000-0000-4000-8000-0000000000b1';

const ARGS_NODE_A_CLASSIFICATION: UseWithdrawAgreementActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_A_ID,
  facet: 'classification',
  participantId: PARTICIPANT_ID,
};

const ARGS_NODE_A_WORDING: UseWithdrawAgreementActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_A_ID,
  facet: 'wording',
  participantId: PARTICIPANT_ID,
};

const ARGS_NODE_B_CLASSIFICATION: UseWithdrawAgreementActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_B_ID,
  facet: 'classification',
  participantId: PARTICIPANT_ID,
};

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface SendCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['withdraw-agreement'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: SendCall[];
  /** Resolve the next pending send call with an `agreement-withdrawn` envelope. */
  readonly resolveNext: (payload?: { sequence?: number; eventId?: string }) => void;
  /** Reject the next pending send call with the supplied error. */
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: SendCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as SendCall);
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
      const eventId = opts.eventId ?? '44444444-4444-4444-8444-444444444444';
      next.resolve({
        type: 'agreement-withdrawn',
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
  result: UseWithdrawAgreementActionResult;
}

function Probe(props: {
  args: UseWithdrawAgreementActionArgs;
  onResult: (r: UseWithdrawAgreementActionResult) => void;
}): ReactElement {
  const result = useWithdrawAgreementAction(props.args);
  props.onResult(result);
  const key = JSON.stringify(props.args);
  return <span data-testid={`probe-${key}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(client: WsClient, args: UseWithdrawAgreementActionArgs): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      withdraw: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseWithdrawAgreementActionResult): void => {
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
      <Probe args={args} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetWithdrawAgreementActionStore();
  resetVoteActionStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useWithdrawAgreementAction — successful withdraw', () => {
  it('fires exactly one withdraw-agreement envelope with the canonical six-field payload', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('withdraw-agreement');
    const payload = fake.calls[0]?.payload as Record<string, unknown>;
    expect(payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
      participant: PARTICIPANT_ID,
    });
    // The payload has exactly six fields per
    // `wsWithdrawAgreementPayloadSchema` — no client-side
    // `withdrawn_at`, no proposalId.
    expect(Object.keys(payload).sort()).toEqual([
      'entity_id',
      'entity_kind',
      'expectedSequence',
      'facet',
      'participant',
      'sessionId',
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    const slot = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slot)).toBe(false);
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at click-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    // Seed an existing `lastAppliedSequence` of 9 via a synthetic
    // event applied to the right session.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '55555555-5555-4555-8555-000000000009',
        sessionId: SESSION_ID,
        sequence: 9,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '66666666-6666-4666-8666-666666666666',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-22T00:00:00.000Z',
        },
        createdAt: '2026-05-22T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    expect((fake.calls[0]?.payload as { expectedSequence?: unknown }).expectedSequence).toBe(9);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    const slot = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slot)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slot)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useWithdrawAgreementAction — error paths', () => {
  it('engine rejection → wire-error lands in useWithdrawAgreementActionStore.errors with the engine code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'no-prior-agree',
          message: 'You can only withdraw a vote you previously agreed to.',
        }),
      );
    });
    await act(async () => {
      await withdrawPromise;
    });
    const slot = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slot)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'no-prior-agree',
      message: 'You can only withdraw a vote you previously agreed to.',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    let withdrawPromise: Promise<void> | undefined;
    act(() => {
      withdrawPromise = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('withdraw-agreement', 'req-id-1'));
    });
    await act(async () => {
      await withdrawPromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The withdraw request timed out. Check your connection and try again.',
    );
  });

  it('next withdraw click clears the prior error for the same slot', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.withdraw();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'no-prior-agree',
          message: 'You can only withdraw a vote you previously agreed to.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    act(() => {
      void probe.result.withdraw();
    });
    const slot = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    expect(useWithdrawAgreementActionStore.getState().errors.has(slot)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useWithdrawAgreementAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.withdraw();
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-slot — disjoint between two rows of different (entity, facet) triples', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    const probeB = renderProbe(fake.client, ARGS_NODE_B_CLASSIFICATION);
    act(() => {
      void probeA.result.withdraw();
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    const slotA = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    const slotB = slotKey({
      entity_kind: 'node',
      entity_id: NODE_B_ID,
      facet: 'classification',
    });
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slotA)).toBe(true);
    expect(useWithdrawAgreementActionStore.getState().withdrawing.has(slotB)).toBe(false);
  });

  it('inFlight is scoped per-slot — disjoint between two rows of the same entity but different facets', () => {
    const fake = makeFakeClient();
    const probeClassify = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    const probeWording = renderProbe(fake.client, ARGS_NODE_A_WORDING);
    act(() => {
      void probeClassify.result.withdraw();
    });
    expect(probeClassify.result.inFlight).toBe(true);
    expect(probeWording.result.inFlight).toBe(false);
  });

  it('withdraw namespace is disjoint from the vote namespace — a withdraw in-flight on a facet does not affect the vote slot for the same triple', () => {
    // A vote on the facet uses key `facet:node:<id>:classification`;
    // a withdraw on the same facet uses key
    // `withdraw:node:<id>:classification`. Cross-namespace
    // isolation: a withdraw in-flight does not flip the vote store's
    // in-flight slot.
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ARGS_NODE_A_CLASSIFICATION);
    act(() => {
      void probe.result.withdraw();
    });
    expect(probe.result.inFlight).toBe(true);
    expect(useVoteActionStore.getState().voting.has(`facet:node:${NODE_A_ID}:classification`)).toBe(
      false,
    );
  });
});

describe('slotKey', () => {
  it('packs the triple into a single string under the `withdraw:` namespace', () => {
    expect(
      slotKey({
        entity_kind: 'node',
        entity_id: NODE_A_ID,
        facet: 'classification',
      }),
    ).toBe(`withdraw:node:${NODE_A_ID}:classification`);
  });

  it('keeps the namespace disjoint from the vote-store keys (`facet:` / `proposal:`)', () => {
    const key = slotKey({
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
    });
    expect(key.startsWith('withdraw:')).toBe(true);
    expect(key.startsWith('facet:')).toBe(false);
    expect(key.startsWith('proposal:')).toBe(false);
  });

  it('keys the edge `shape` facet correctly', () => {
    expect(
      slotKey({
        entity_kind: 'edge',
        entity_id: NODE_A_ID,
        facet: 'shape',
      }),
    ).toBe(`withdraw:edge:${NODE_A_ID}:shape`);
  });
});
