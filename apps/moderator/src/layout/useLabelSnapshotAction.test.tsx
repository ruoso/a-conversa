// Tests for `useLabelSnapshotAction()` — the F10 snapshot-label
// dispatch hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   (a) Initial state — `inFlight=false`, `lastError=undefined`.
//   (b) `submit('label')` flips `inFlight` true and calls
//       `client.send('label-snapshot', { sessionId, expectedSequence, label })`.
//   (c) On ack — `inFlight=false`, `lastError=undefined`,
//       `useSnapshotFlowStore.isLabelInputOpen=false`.
//   (d) On `WsRequestError` — `inFlight=false`, `lastError={code,message}`,
//       `isLabelInputOpen=true` (modal stays open).
//   (e) On `WsRequestTimeoutError` — `lastError.code='timeout'`.
//   (f) `submit()` while already in flight is a no-op (single send).
//   (g) `submit('  ')` (whitespace-only) is rejected client-side.
//   (h) Label is trimmed before send.
//   (i) `expectedSequence` reads `useWsStore.sessionState[sessionId].lastAppliedSequence`.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import {
  resetLabelSnapshotStore,
  useLabelSnapshotAction,
  useLabelSnapshotStore,
  type UseLabelSnapshotActionResult,
} from './useLabelSnapshotAction';
import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';
import { useWsStore } from '../ws/wsStore';
import {
  createI18nInstance,
  WsClientProvider,
  WsRequestError,
  WsRequestTimeoutError,
} from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface LabelSnapshotCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['label-snapshot'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: LabelSnapshotCall[];
  readonly resolveNext: (opts?: { snapshotId?: string }) => void;
  readonly rejectNext: (err: Error) => void;
  readonly pendingCount: () => number;
}

function makeFakeClient(): FakeClient {
  const calls: LabelSnapshotCall[] = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];

  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as LabelSnapshotCall);
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
    resolveNext: (opts: { snapshotId?: string } = {}): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      const snapshotId = opts.snapshotId ?? '66666666-6666-4666-8666-666666666666';
      next.resolve({
        type: 'snapshot-labeled',
        id: 'ack-id',
        inResponseTo: 'req-id',
        payload: { snapshotId },
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
  result: UseLabelSnapshotActionResult;
}

function Probe(props: { onResult: (r: UseLabelSnapshotActionResult) => void }): ReactElement {
  const result = useLabelSnapshotAction();
  props.onResult(result);
  return <span data-testid="probe">{result.inFlight ? '1' : '0'}</span>;
}

function renderProbe(client: WsClient): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      submit: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseLabelSnapshotActionResult): void => {
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
      <Probe onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetLabelSnapshotStore();
  resetSnapshotFlowStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
    useSnapshotFlowStore.getState().open();
  });
});

afterEach(() => {
  cleanup();
});

describe('useLabelSnapshotAction — initial state', () => {
  it('(a) renders with inFlight=false and lastError=undefined', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
  });
});

describe('useLabelSnapshotAction — successful submit', () => {
  it('(b) fires exactly one label-snapshot envelope with the canonical payload', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.submit('Segment 1 close');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('label-snapshot');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.label).toBe('Segment 1 close');
  });

  it('(c) on ack: inFlight=false, lastError=undefined, isLabelInputOpen=false', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = probe.result.submit('hello');
    });
    expect(useLabelSnapshotStore.getState().inFlight).toBe(true);
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
    act(() => {
      fake.resolveNext();
    });
    await act(async () => {
      await submitPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
  });
});

describe('useLabelSnapshotAction — error paths', () => {
  it('(d) WsRequestError lands as lastError; isLabelInputOpen stays true', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = probe.result.submit('hello');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'moderator-only',
          message: 'Only the moderator can label a snapshot.',
        }),
      );
    });
    await act(async () => {
      await submitPromise;
    });
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'moderator-only',
      message: 'Only the moderator can label a snapshot.',
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('(e) WsRequestTimeoutError lands with code "timeout"', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = probe.result.submit('hello');
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('label-snapshot', 'req-id-1'));
    });
    await act(async () => {
      await submitPromise;
    });
    expect(probe.result.lastError?.code).toBe('timeout');
    expect(probe.result.lastError?.message.length ?? 0).toBeGreaterThan(0);
  });

  it('(f) submit() while already in flight is a no-op (one send)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.submit('first');
    });
    act(() => {
      void probe.result.submit('second');
    });
    expect(fake.calls.length).toBe(1);
  });
});

describe('useLabelSnapshotAction — label validation + payload shaping', () => {
  it('(g) whitespace-only label is rejected client-side — no send fires', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.submit('   ');
    });
    expect(fake.calls.length).toBe(0);
    expect(useLabelSnapshotStore.getState().inFlight).toBe(false);
  });

  it('(h) label is trimmed before send', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.submit('  hello  ');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.label).toBe('hello');
  });

  it('(i) expectedSequence reads lastAppliedSequence at submit-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().applyEvent({
        id: '77777777-7777-4777-8777-000000000007',
        sessionId: SESSION_ID,
        sequence: 11,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '88888888-8888-4888-8888-888888888888',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-30T00:00:00.000Z',
        },
        createdAt: '2026-05-30T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.submit('hello');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(11);
  });
});
