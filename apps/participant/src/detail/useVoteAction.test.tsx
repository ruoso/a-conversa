// Tests for `useVoteAction({ proposalId })` — the per-proposal vote-
// action hook.
//
// Refinement: `tasks/refinements/participant-ui/part_voting.md`
//             (`part_vote_button_per_facet` + `part_vote_single_tap`).
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Successful vote** — fires exactly one `vote` envelope with the
//      canonical payload shape (sessionId / expectedSequence /
//      proposalId / choice; NO participantId), awaits the `voted` ack,
//      removes the proposalId from the in-flight set.
//   2. **Engine rejection** — `WsRequestError({ code:
//      'proposal-already-committed', message: ... })` lands the error
//      in `useVoteActionStore.errors`, removes proposalId from
//      `voting`.
//   3. **Timeout** — `WsRequestTimeoutError` lands a `{ code:
//      'timeout', ... }` error with a localized fallback message.
//   4. **Concurrent re-entry** — a second `castVote()` call while the
//      first is in-flight is a no-op (no second envelope fires).
//   5. **`inFlight` reflects `useVoteActionStore.voting`** for the
//      proposalId argument; disjoint between different proposalIds.
//   6. **`expectedSequence` reads `lastAppliedSequence`** at vote-time
//      (the WS store can advance between mounts and clicks).
//   7. **Choice plumbing** — agree / dispute / withdraw all land in
//      `payload.choice` verbatim.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetVoteActionStore,
  useVoteAction,
  useVoteActionStore,
  type UseVoteActionResult,
  type VoteChoice,
} from './useVoteAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID_ALT = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface VoteCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['vote'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: VoteCall[];
  /** Resolve the next pending send call's promise with a `voted` envelope. */
  readonly resolveNext: (payload?: { sequence?: number; eventId?: string }) => void;
  /** Reject the next pending send call with the supplied error. */
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: VoteCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as VoteCall);
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
      const eventId = opts.eventId ?? '44444444-4444-4444-8444-444444444444';
      next.resolve({
        type: 'voted',
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
  result: UseVoteActionResult;
}

function Probe(props: {
  proposalId: string;
  onResult: (r: UseVoteActionResult) => void;
}): ReactElement {
  const result = useVoteAction({ proposalId: props.proposalId });
  props.onResult(result);
  return <span data-testid={`probe-${props.proposalId}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(client: WsClient, proposalId: string = PROPOSAL_ID): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      castVote: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseVoteActionResult): void => {
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
      <Probe proposalId={proposalId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetVoteActionStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useVoteAction — successful vote path', () => {
  it('fires exactly one vote envelope with the canonical payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposalId).toBe(PROPOSAL_ID);
    expect(payload?.choice).toBe('agree');
    // The payload has exactly four fields — no `participantId` (the
    // server reads it from the authenticated connection).
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      'choice',
      'expectedSequence',
      'proposalId',
      'sessionId',
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await votePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID)).toBe(false);
  });

  it.each<VoteChoice>(['agree', 'dispute', 'withdraw'])(
    'plumbs choice=%s verbatim into payload.choice',
    (choice) => {
      const fake = makeFakeClient();
      const probe = renderProbe(fake.client);
      act(() => {
        void probe.result.castVote(choice);
      });
      expect(fake.calls.length).toBe(1);
      expect(fake.calls[0]?.payload.choice).toBe(choice);
    },
  );

  it('expectedSequence reads lastAppliedSequence off useWsStore at vote-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 7 via a synthetic event
    // applied to the right session.
    act(() => {
      useWsStore.getState().applyEvent({
        id: '55555555-5555-4555-8555-000000000007',
        sessionId: SESSION_ID,
        sequence: 7,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '66666666-6666-4666-8666-666666666666',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(7);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await votePromise;
    });
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useVoteAction — error paths', () => {
  it('engine rejection → wire-error lands in useVoteActionStore.errors with the engine code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'proposal-already-committed',
          message: 'This proposal has already been committed.',
        }),
      );
    });
    await act(async () => {
      await votePromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'proposal-already-committed',
      message: 'This proposal has already been committed.',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('vote', 'req-id-1'));
    });
    await act(async () => {
      await votePromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message).toBe(
      'The vote request timed out. Check your connection and try again.',
    );
  });

  it('next castVote click clears the prior error for the same proposalId', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.castVote('agree');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'proposal-already-committed',
          message: 'Already committed.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    act(() => {
      void probe.result.castVote('dispute');
    });
    expect(useVoteActionStore.getState().errors.has(PROPOSAL_ID)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useVoteAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.castVote('dispute');
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-proposalId (disjoint between two rows)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, PROPOSAL_ID);
    const probeB = renderProbe(fake.client, PROPOSAL_ID_ALT);
    act(() => {
      void probeA.result.castVote('agree');
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID)).toBe(true);
    expect(useVoteActionStore.getState().voting.has(PROPOSAL_ID_ALT)).toBe(false);
  });
});
