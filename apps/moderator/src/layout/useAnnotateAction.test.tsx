// Tests for `useAnnotateAction(targetId, targetKind)` — the per-target
// annotate hook.
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Successful annotate (node)** — fires exactly one `propose`
//      envelope with the canonical annotate payload shape (sessionId /
//      expectedSequence / proposal: { kind: 'annotate', target_kind,
//      target_id, annotation_kind: 'note', content }), awaits the
//      `proposed` ack, clears the in-flight slice.
//   2. **Successful annotate (edge)** — same but with target_kind:
//      'edge'; pins the per-target dispatch.
//   3. **Engine rejection** — `WsRequestError({ code:
//      'target-entity-not-found', message: '...' })` lands the wire-
//      error verbatim in `useAnnotateStore.errors`, removes the key
//      from `inFlight`.
//   4. **Timeout** — `WsRequestTimeoutError` maps to `{ code:
//      'timeout', message: <localized timeout text> }`.
//   5. **Unknown error** — a plain `Error` lands as `{ code:
//      'unknown', message: <error message> }`.
//   6. **Empty content guard** — `annotate('')` short-circuits with
//      `{ code: 'content-empty', ... }`; NO envelope fires.
//   7. **Over-cap content guard** — `annotate('x'.repeat(MAX+1))`
//      short-circuits with `{ code: 'content-too-long', ... }`; NO
//      envelope fires.
//   8. **Concurrent re-entry** — a second `annotate(...)` while the
//      first is in flight on the same key is a no-op (no second
//      envelope fires).
//   9. **Disjoint keys** — node and edge targets with the same id are
//      tracked under separate composite keys.
//  10. **Composite-key shape** — `annotateStoreKey(targetKind,
//      targetId)` uses the documented `${targetKind}|${targetId}` form.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import i18next from 'i18next';

import {
  annotateStoreKey,
  resetAnnotateStore,
  useAnnotateAction,
  useAnnotateStore,
  type AnnotateTargetKind,
  type UseAnnotateActionResult,
} from './useAnnotateAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';
const EDGE_ID = '33333333-3333-4333-8333-333333333333';
const ANNOTATION_ID = '44444444-4444-4444-8444-444444444444';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface ProposeCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['propose'];
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
      const eventId = opts.eventId ?? '55555555-5555-4555-8555-555555555555';
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
  result: UseAnnotateActionResult;
}

function Probe(props: {
  targetId: string;
  targetKind: AnnotateTargetKind;
  onResult: (r: UseAnnotateActionResult) => void;
}): ReactElement {
  const result = useAnnotateAction(props.targetId, props.targetKind);
  props.onResult(result);
  return <span data-testid={`probe-${props.targetKind}-${props.targetId}`}>ok</span>;
}

function renderProbe(
  client: WsClient,
  targetId: string = NODE_ID,
  targetKind: AnnotateTargetKind = 'node',
): ProbeHandle {
  const handle: ProbeHandle = {
    result: {
      annotate: () => Promise.resolve(),
      inFlight: false,
      lastError: undefined,
    },
  };
  const captureResult = (r: UseAnnotateActionResult): void => {
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
      <Probe targetId={targetId} targetKind={targetKind} onResult={captureResult} />
    </Wrapper>,
  );

  return handle;
}

beforeEach(async () => {
  // Reset i18next to en-US — other tests in the suite may have flipped
  // the language to pt-BR / es-419 and the singleton persists across
  // files. Without this, the localized timeout text would fall back to
  // the raw key.
  await i18next.changeLanguage('en-US');
  useWsStore.getState().reset();
  resetAnnotateStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('annotateStoreKey — composite key shape', () => {
  it('joins targetKind and targetId with `|` (UUID-safe separator)', () => {
    expect(annotateStoreKey('node', NODE_ID)).toBe(`node|${NODE_ID}`);
    expect(annotateStoreKey('edge', EDGE_ID)).toBe(`edge|${EDGE_ID}`);
  });

  it('produces distinct keys for node vs edge with the same UUID', () => {
    expect(annotateStoreKey('node', NODE_ID)).not.toBe(annotateStoreKey('edge', NODE_ID));
  });
});

describe('useAnnotateAction — successful annotate path', () => {
  it('fires exactly one propose envelope with the canonical annotate payload shape (node target)', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, NODE_ID, 'node');
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('a thought', 'note');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload;
    expect(payload?.sessionId).toBe(SESSION_ID);
    expect(payload?.expectedSequence).toBe(0);
    expect(payload?.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_ID,
      annotation_kind: 'note',
      content: 'a thought',
    });
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      'expectedSequence',
      'proposal',
      'sessionId',
    ]);

    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await annotatePromise;
    });
    const key = annotateStoreKey('node', NODE_ID);
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useAnnotateStore.getState().inFlight.has(key)).toBe(false);
  });

  it('fires exactly one propose envelope with target_kind: edge for an edge target', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, EDGE_ID, 'edge');
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('edge note', 'note');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'edge',
      target_id: EDGE_ID,
      annotation_kind: 'note',
      content: 'edge note',
    });
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await annotatePromise;
    });
    expect(probe.result.inFlight).toBe(false);
  });

  // Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
  // (the hook's third target arm — annotation-of-annotation gestures).
  it('fires exactly one propose envelope with target_kind: annotation for an annotation target', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client, ANNOTATION_ID, 'annotation');
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('disagree with this annotation', 'stance');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'annotation',
      target_id: ANNOTATION_ID,
      annotation_kind: 'stance',
      content: 'disagree with this annotation',
    });
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await annotatePromise;
    });
    const key = annotateStoreKey('annotation', ANNOTATION_ID);
    expect(probe.result.inFlight).toBe(false);
    expect(probe.result.lastError).toBeUndefined();
    expect(useAnnotateStore.getState().inFlight.has(key)).toBe(false);
  });

  it('expectedSequence reads lastAppliedSequence off useWsStore at annotate-time', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      useWsStore.getState().applyEvent({
        id: '66666666-6666-4666-8666-000000000004',
        sessionId: SESSION_ID,
        sequence: 7,
        kind: 'node-created',
        actor: '00000000-0000-4000-8000-0000000000aa',
        payload: {
          node_id: '77777777-7777-4777-8777-777777777777',
          wording: 'Seed node',
          created_by: '00000000-0000-4000-8000-0000000000aa',
          created_at: '2026-05-16T00:00:00.000Z',
        },
        createdAt: '2026-05-16T00:00:00.000Z',
      } as never);
    });
    act(() => {
      void probe.result.annotate('content', 'note');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.expectedSequence).toBe(7);
  });

  it('inFlight is true during the round-trip and false after the ack resolves', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    const key = annotateStoreKey('node', NODE_ID);
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('content', 'note');
    });
    expect(useAnnotateStore.getState().inFlight.has(key)).toBe(true);
    expect(probe.result.inFlight).toBe(true);
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await annotatePromise;
    });
    expect(useAnnotateStore.getState().inFlight.has(key)).toBe(false);
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useAnnotateAction — error paths', () => {
  it('target-entity-not-found rejection — wire-error lands verbatim in useAnnotateStore.errors', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('content', 'note');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'target-entity-not-found',
          message: 'propose annotate: target_id X (target_kind node) does not reference any node',
        }),
      );
    });
    await act(async () => {
      await annotatePromise;
    });
    const key = annotateStoreKey('node', NODE_ID);
    expect(probe.result.inFlight).toBe(false);
    expect(useAnnotateStore.getState().inFlight.has(key)).toBe(false);
    expect(probe.result.lastError).toEqual({
      code: 'target-entity-not-found',
      message: 'propose annotate: target_id X (target_kind node) does not reference any node',
    });
  });

  it('timeout — wire-error has code "timeout" + localized timeout message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('content', 'note');
    });
    act(() => {
      fake.rejectNext(new WsRequestTimeoutError('propose', 'req-id-1'));
    });
    await act(async () => {
      await annotatePromise;
    });
    const lastError = probe.result.lastError;
    expect(lastError?.code).toBe('timeout');
    expect(lastError?.message).toBe('The annotate request timed out — try again');
  });

  it('plain Error — wire-error has code "unknown" + the error message', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate('content', 'note');
    });
    act(() => {
      fake.rejectNext(new Error('socket closed'));
    });
    await act(async () => {
      await annotatePromise;
    });
    expect(probe.result.lastError).toEqual({
      code: 'unknown',
      message: 'socket closed',
    });
  });

  it('next annotate click on the same key clears the prior error before firing', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.annotate('first', 'note');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'target-entity-not-found',
          message: 'Not yet.',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    const key = annotateStoreKey('node', NODE_ID);
    expect(useAnnotateStore.getState().errors.has(key)).toBe(true);
    act(() => {
      void probe.result.annotate('second', 'note');
    });
    expect(useAnnotateStore.getState().errors.has(key)).toBe(false);
    expect(fake.calls.length).toBe(2);
  });
});

describe('useAnnotateAction — content validation guards', () => {
  it('empty content short-circuits with `content-empty` and fires no envelope', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    await act(async () => {
      await probe.result.annotate('', 'note');
    });
    expect(fake.calls.length).toBe(0);
    expect(probe.result.lastError?.code).toBe('content-empty');
  });

  it('over-cap content short-circuits with `content-too-long` and fires no envelope', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    const overCap = 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 1);
    await act(async () => {
      await probe.result.annotate(overCap, 'note');
    });
    expect(fake.calls.length).toBe(0);
    expect(probe.result.lastError?.code).toBe('content-too-long');
  });

  it('at-cap content (exactly MAX) DOES fire an envelope', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    const atCap = 'y'.repeat(MAX_METHODOLOGY_TEXT_LENGTH);
    let annotatePromise: Promise<void> | undefined;
    act(() => {
      annotatePromise = probe.result.annotate(atCap, 'note');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toMatchObject({
      kind: 'annotate',
      content: atCap,
    });
    act(() => {
      fake.resolveNext({ sequence: 1 });
    });
    await act(async () => {
      await annotatePromise;
    });
    expect(probe.result.inFlight).toBe(false);
  });
});

describe('useAnnotateAction — concurrency + key isolation', () => {
  it('concurrent re-call on the same key while inFlight is a no-op (no second envelope)', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.annotate('first', 'note');
    });
    expect(fake.calls.length).toBe(1);
    act(() => {
      void probe.result.annotate('second', 'note');
    });
    expect(fake.calls.length).toBe(1);
  });

  it('node vs edge targets with the same id have disjoint in-flight slices', () => {
    // Two hook mounts — one against a node target, one against an
    // edge target — share the module-scoped store but key under
    // distinct composite ids.
    const fake = makeFakeClient();
    const nodeProbe = renderProbe(fake.client, NODE_ID, 'node');
    cleanup();
    const edgeProbe = renderProbe(fake.client, NODE_ID, 'edge');
    const nodeKey = annotateStoreKey('node', NODE_ID);
    const edgeKey = annotateStoreKey('edge', NODE_ID);
    // Trigger via the edgeProbe (the only mounted probe after the
    // cleanup above). Whichever probe runs, the keys land disjointly.
    act(() => {
      void edgeProbe.result.annotate('edge content', 'note');
    });
    expect(useAnnotateStore.getState().inFlight.has(edgeKey)).toBe(true);
    expect(useAnnotateStore.getState().inFlight.has(nodeKey)).toBe(false);
    // The nodeProbe snapshot reads the (now-stale, post-unmount) hook
    // result — assert the key shape is what the store sees, which is
    // the load-bearing isolation guarantee.
    expect(nodeProbe.result).toBeDefined();
  });

  it('successful annotate clears any prior error for the same key', async () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    let first: Promise<void> | undefined;
    act(() => {
      first = probe.result.annotate('first', 'note');
    });
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'target-entity-not-found',
          message: 'rejected',
        }),
      );
    });
    await act(async () => {
      await first;
    });
    expect(probe.result.lastError).toBeDefined();
    let second: Promise<void> | undefined;
    act(() => {
      second = probe.result.annotate('second', 'note');
    });
    act(() => {
      fake.resolveNext({ sequence: 2 });
    });
    await act(async () => {
      await second;
    });
    expect(probe.result.lastError).toBeUndefined();
  });
});

describe('useAnnotateAction — annotation_kind threading (picker lift)', () => {
  it('reframe — annotationKind parameter lands as proposal.annotation_kind = "reframe"', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.annotate('a reframe thought', 'reframe');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_ID,
      annotation_kind: 'reframe',
      content: 'a reframe thought',
    });
  });

  it('scope-change — annotationKind parameter lands as proposal.annotation_kind = "scope-change"', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.annotate('a scope shift', 'scope-change');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_ID,
      annotation_kind: 'scope-change',
      content: 'a scope shift',
    });
  });

  it('stance — annotationKind parameter lands as proposal.annotation_kind = "stance"', () => {
    const fake = makeFakeClient();
    const probe = renderProbe(fake.client);
    act(() => {
      void probe.result.annotate('a stance read', 'stance');
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.payload.proposal).toEqual({
      kind: 'annotate',
      target_kind: 'node',
      target_id: NODE_ID,
      annotation_kind: 'stance',
      content: 'a stance read',
    });
  });
});
