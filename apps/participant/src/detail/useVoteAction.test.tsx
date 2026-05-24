// Tests for `useVoteAction(args)` — the per-target vote-action hook.
//
// Refinement: tasks/refinements/per-facet-refactor/
//             pf_part_vote_action_facet_keyed.md (the dual-arm rewrite);
//             tasks/refinements/participant-ui/part_voting.md (the
//             original per-proposal shape; do not edit).
//
// Per ADR 0022 these are committed Vitest cases. They lock in the
// post-refactor dual-arm shape per ADR 0030 §2 + §9:
//
//   1. **Facet-arm successful vote** — fires exactly one `vote`
//      envelope with `{ sessionId, expectedSequence, target: 'facet',
//      entity_kind, entity_id, facet, choice }`. Awaits the `voted`
//      ack; removes the per-slot key from the in-flight set.
//   2. **Proposal-arm successful vote** — fires exactly one `vote`
//      envelope with `{ sessionId, expectedSequence, target:
//      'proposal', proposalId, choice }`. Awaits the `voted` ack;
//      removes the per-slot key from the in-flight set.
//   3. **Engine rejection** — `WsRequestError` lands the error in
//      `useVoteActionStore.errors` keyed by the same slot; the slot
//      drops out of `voting`. Covered on both arms.
//   4. **Timeout** — `WsRequestTimeoutError` lands a `{ code:
//      'timeout', ... }` error with a localized fallback message.
//   5. **Concurrent re-entry** — a second `castVote()` call while the
//      first is in-flight is a no-op (no second envelope fires).
//   6. **`inFlight` reflects `useVoteActionStore.voting`** for the
//      bound slot; disjoint between different slots (facet vs.
//      proposal, and different triples / proposal ids within each).
//   7. **`expectedSequence` reads `lastAppliedSequence`** at vote-time
//      (the WS store can advance between mounts and clicks).
//   8. **Choice plumbing** — `'agree'` / `'dispute'` both land in
//      `payload.choice` verbatim on both arms. `'withdraw'` is no
//      longer in the hook's vocabulary per ADR 0030 §3.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetVoteActionStore,
  useVoteAction,
  useVoteActionStore,
  type UseVoteActionArgs,
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
const NODE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID_ALT = '33333333-3333-4333-8333-333333333333';

const FACET_ARGS_CLASSIFY: UseVoteActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_A_ID,
  facet: 'classification',
};

const FACET_ARGS_WORDING: UseVoteActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_A_ID,
  facet: 'wording',
};

const FACET_ARGS_OTHER_NODE: UseVoteActionArgs = {
  entity_kind: 'node',
  entity_id: NODE_B_ID,
  facet: 'classification',
};

const PROPOSAL_ARGS: UseVoteActionArgs = { proposal_id: PROPOSAL_ID };
const PROPOSAL_ARGS_ALT: UseVoteActionArgs = { proposal_id: PROPOSAL_ID_ALT };

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
  args: UseVoteActionArgs;
  onResult: (r: UseVoteActionResult) => void;
}): ReactElement {
  const result = useVoteAction(props.args);
  props.onResult(result);
  const key = JSON.stringify(props.args);
  return <span data-testid={`probe-${key}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(client: WsClient, args: UseVoteActionArgs): ProbeHandle {
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
      <Probe args={args} onResult={captureResult} />
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

describe('useVoteAction — facet-arm successful vote', () => {
  it('fires exactly one vote envelope with `target: facet` and the canonical facet-arm payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    const payload = fake.calls[0]?.payload as Record<string, unknown>;
    expect(payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'facet',
      entity_kind: 'node',
      entity_id: NODE_A_ID,
      facet: 'classification',
      choice: 'agree',
    });
    // The payload has exactly seven fields — no `proposalId`, no
    // `voted_at` (the server sets it from its authoritative clock).
    expect(Object.keys(payload).sort()).toEqual([
      'choice',
      'entity_id',
      'entity_kind',
      'expectedSequence',
      'facet',
      'sessionId',
      'target',
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
    // The per-slot store key for the facet arm.
    expect(useVoteActionStore.getState().voting.has(`facet:node:${NODE_A_ID}:classification`)).toBe(
      false,
    );
  });

  it.each<VoteChoice>(['agree', 'dispute'])(
    'plumbs choice=%s verbatim into payload.choice on the facet arm',
    (choice) => {
      const fake = makeFakeClient();
      const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
      act(() => {
        void probe.result.castVote(choice);
      });
      expect(fake.calls.length).toBe(1);
      expect((fake.calls[0]?.payload as { choice?: unknown }).choice).toBe(choice);
    },
  );

  it('expectedSequence reads lastAppliedSequence off useWsStore at vote-time (facet arm)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
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
    expect((fake.calls[0]?.payload as { expectedSequence?: unknown }).expectedSequence).toBe(7);
  });

  it('inFlight is true during the round-trip and false after the ack resolves (facet arm)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    const slotKey = `facet:node:${NODE_A_ID}:classification`;
    expect(useVoteActionStore.getState().voting.has(slotKey)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await votePromise;
    });
    expect(useVoteActionStore.getState().voting.has(slotKey)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useVoteAction — proposal-arm successful vote', () => {
  it('fires exactly one vote envelope with `target: proposal` and the canonical proposal-arm payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, PROPOSAL_ARGS);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('vote');
    const payload = fake.calls[0]?.payload as Record<string, unknown>;
    expect(payload).toEqual({
      sessionId: SESSION_ID,
      expectedSequence: 0,
      target: 'proposal',
      proposalId: PROPOSAL_ID,
      choice: 'agree',
    });
    // The payload has exactly five fields — no facet triple, no
    // `voted_at`.
    expect(Object.keys(payload).sort()).toEqual([
      'choice',
      'expectedSequence',
      'proposalId',
      'sessionId',
      'target',
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
    expect(useVoteActionStore.getState().voting.has(`proposal:${PROPOSAL_ID}`)).toBe(false);
  });

  it.each<VoteChoice>(['agree', 'dispute'])(
    'plumbs choice=%s verbatim into payload.choice on the proposal arm',
    (choice) => {
      const fake = makeFakeClient();
      const probe = renderProbe(fake.client, PROPOSAL_ARGS);
      act(() => {
        void probe.result.castVote(choice);
      });
      expect(fake.calls.length).toBe(1);
      expect((fake.calls[0]?.payload as { choice?: unknown }).choice).toBe(choice);
    },
  );
});

describe('useVoteAction — error paths', () => {
  it('engine rejection on the facet arm → wire-error lands in useVoteActionStore.errors with the engine code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    let votePromise: Promise<void> | undefined;
    act(() => {
      votePromise = probe.result.castVote('agree');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
          message: 'This facet is already committed.',
        }),
      );
    });
    await act(async () => {
      await votePromise;
    });
    const slotKey = `facet:node:${NODE_A_ID}:classification`;
    expect(probe.result.inFlight).toBe(false);
    expect(useVoteActionStore.getState().voting.has(slotKey)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'illegal-state-transition',
      message: 'This facet is already committed.',
    });
  });

  it('engine rejection on the proposal arm → wire-error lands in useVoteActionStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, PROPOSAL_ARGS);
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
    expect(useVoteActionStore.getState().voting.has(`proposal:${PROPOSAL_ID}`)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'proposal-already-committed',
      message: 'This proposal has already been committed.',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
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

  it('next castVote click clears the prior error for the same slot', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.castVote('agree');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
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
    const slotKey = `facet:node:${NODE_A_ID}:classification`;
    expect(useVoteActionStore.getState().errors.has(slotKey)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useVoteAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    act(() => {
      void probe.result.castVote('agree');
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.castVote('dispute');
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-slot — disjoint between two facet rows of different (entity, facet) triples', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    const probeB = renderProbe(fake.client, FACET_ARGS_OTHER_NODE);
    act(() => {
      void probeA.result.castVote('agree');
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useVoteActionStore.getState().voting.has(`facet:node:${NODE_A_ID}:classification`)).toBe(
      true,
    );
    expect(useVoteActionStore.getState().voting.has(`facet:node:${NODE_B_ID}:classification`)).toBe(
      false,
    );
  });

  it('inFlight is scoped per-slot — disjoint between facet and proposal arms even when ids would otherwise collide', () => {
    const fake = makeFakeClient();
    const probeFacet = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    const probeProposal = renderProbe(fake.client, PROPOSAL_ARGS);
    act(() => {
      void probeFacet.result.castVote('agree');
    });
    expect(probeFacet.result.inFlight).toBe(true);
    expect(probeProposal.result.inFlight).toBe(false);
  });

  it('inFlight is scoped per-slot — disjoint between two proposal-arm slots', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, PROPOSAL_ARGS);
    const probeB = renderProbe(fake.client, PROPOSAL_ARGS_ALT);
    act(() => {
      void probeA.result.castVote('agree');
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
  });

  it('inFlight is scoped per-slot — disjoint between two facet rows of the same entity but different facets', () => {
    const fake = makeFakeClient();
    const probeClassify = renderProbe(fake.client, FACET_ARGS_CLASSIFY);
    const probeWording = renderProbe(fake.client, FACET_ARGS_WORDING);
    act(() => {
      void probeClassify.result.castVote('agree');
    });
    expect(probeClassify.result.inFlight).toBe(true);
    expect(probeWording.result.inFlight).toBe(false);
  });
});
