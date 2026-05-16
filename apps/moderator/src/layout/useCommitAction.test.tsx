// Tests for `useCommitAction(proposalId)` — the per-row commit-action hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_commit_button.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Successful commit** — fires exactly one `commit` envelope with
//      the canonical payload shape (sessionId / expectedSequence /
//      proposalId; NO moderatorId), awaits the `committed` ack,
//      removes the proposalId from the in-flight set.
//   2. **Engine rejection** — `WsRequestError({ code:
//      'unanimous-agree-required', message: ... })` lands the error in
//      `useCommitStore.errors`, removes proposalId from `committing`.
//   3. **Timeout** — `WsRequestTimeoutError` lands a
//      `{ code: 'timeout', ... }` error.
//   4. **Concurrent re-entry** — a second `commit()` call while the
//      first is in-flight is a no-op (no second envelope fires).
//   5. **`inFlight` reflects `useCommitStore.committing`** for the
//      proposalId argument; disjoint between different proposalIds.
//   6. **`expectedSequence` reads `lastAppliedSequence`** at
//      commit-time (the WS store can advance between mounts and
//      clicks).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetCommitStore,
  useCommitAction,
  useCommitStore,
  type UseCommitActionResult,
} from './useCommitAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '../ws/WsClientProvider';
import { WsRequestError, WsRequestTimeoutError } from '../ws/client';
import type { SendFn, WsClient, WsClientStatus } from '../ws/client';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { initI18n } from '../i18n';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID_ALT = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  await initI18n('en-US');
});

interface CommitCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['commit'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: CommitCall[];
  /** Resolve the next pending send call's promise with a `committed` envelope. */
  readonly resolveNext: (payload?: { sequence?: number; eventId?: string }) => void;
  /** Reject the next pending send call with the supplied error. */
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: CommitCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as CommitCall);
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
        type: 'committed',
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
  result: UseCommitActionResult;
}

function Probe(props: {
  proposalId: string;
  onResult: (r: UseCommitActionResult) => void;
}): ReactElement {
  const result = useCommitAction(props.proposalId);
  props.onResult(result);
  return <span data-testid={`probe-${props.proposalId}`}>{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(
  client: WsClient,
  proposalId: string = PROPOSAL_ID,
  options: { sessionIdOverride?: string } = {},
): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      commit: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseCommitActionResult): void => {
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
      <Probe proposalId={proposalId} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetCommitStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('useCommitAction — successful commit path', () => {
  it('fires exactly one commit envelope with the canonical payload shape', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = probe.result.commit();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('commit');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposalId).toBe(PROPOSAL_ID);
    // The payload has exactly three fields — no `moderatorId` (the
    // server reads it from the authenticated connection).
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      'expectedSequence',
      'proposalId',
      'sessionId',
    ]);

    // Resolve the ack.
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await commitPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    // After the ack lands, the proposalId is removed from the
    // module-scoped in-flight set.
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID)).toBe(false);
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at commit-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    // Seed an existing `lastAppliedSequence` of 7 via a synthetic
    // event applied to the right session.
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
      void probe.result.commit();
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(7);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = probe.result.commit();
    });
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await commitPromise;
    });
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useCommitAction — error paths', () => {
  it('engine rejection → wire-error lands in useCommitStore.errors with the engine code + message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = probe.result.commit();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'unanimous-agree-required',
          message: 'A participant has not voted agree on every facet.',
        }),
      );
    });
    await act(async () => {
      await commitPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'unanimous-agree-required',
      message: 'A participant has not voted agree on every facet.',
    });
  });

  it('timeout → wire-error has code "timeout" + localized message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let commitPromise: Promise<void> | undefined;
    act(() => {
      commitPromise = probe.result.commit();
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('commit', 'req-id-1'));
    });
    await act(async () => {
      await commitPromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    // The localized timeout text is the en-US chrome string set at
    // `initI18n('en-US')` startup.
    expect(probe.result.lastError?.message).toBe(
      'The commit request timed out. Check your connection and try again.',
    );
  });

  it('next commit click clears the prior error for the same proposalId', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.commit();
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'unanimous-agree-required',
          message: 'Not yet.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    // Re-click — clears the error before firing the second envelope.
    act(() => {
      void probe.result.commit();
    });
    expect(useCommitStore.getState().errors.has(PROPOSAL_ID)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useCommitAction — concurrency + isolation', () => {
  it('concurrent re-call while inFlight is a no-op (no second envelope fires)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.commit();
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.commit();
    });
    expect(fake.calls.length).toBe(1);
  });

  it('inFlight is scoped per-proposalId (disjoint between two rows)', () => {
    const fake = makeFakeClient();
    const probeA = renderProbe(fake.client, PROPOSAL_ID);
    const probeB = renderProbe(fake.client, PROPOSAL_ID_ALT);
    act(() => {
      void probeA.result.commit();
    });
    expect(probeA.result.inFlight).toBe(true);
    expect(probeB.result.inFlight).toBe(false);
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID)).toBe(true);
    expect(useCommitStore.getState().committing.has(PROPOSAL_ID_ALT)).toBe(false);
  });
});
