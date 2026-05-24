// Tests for `<EdgeShapeCommitAffordance>` — the per-edge inline commit
// affordance for the inline `shape` facet, mounted on `<StatementEdge>`'s
// label container.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_shape_commit_affordance.md
//
// Per ADR 0022 these are committed Vitest cases. They mirror
// `EdgeCardSubstanceAffordance.test.tsx`'s posture and lock in:
//
//   1. **Render structure** — the per-edge container + the commit button
//      carry the per-edge testids
//      (`edge-shape-commit-affordance-${edgeId}` /
//       `edge-shape-commit-affordance-button-${edgeId}`) plus the
//      `data-edge-id` attribute. The aria-label resolves off the
//      reused `moderator.commitButton.*` catalog scope.
//   2. **Click-fires-commit** — clicking the button dispatches a single
//      `commit` envelope with `target: 'facet'` + the `(edge, edgeId,
//      'shape')` triple per ADR 0030 §2.
//   3. **In-flight disables the button** — while the round-trip is in
//      flight the button is `disabled` and its `data-commit-state` is
//      `"in-flight"`. The latch flips back on success.
//   4. **Wire-error region** — when the engine rejects the commit, an
//      `role="alert"` paragraph mounts with the wire-supplied message
//      and the matching `data-error-code` attribute.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { EdgeShapeCommitAffordance } from './EdgeShapeCommitAffordance';
import { resetCommitStore, useCommitStore } from '../layout/useCommitAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EDGE_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

interface CommitCall {
  readonly type: WsMessageType;
  readonly payload: WsMessagePayloadMap['commit'];
}

interface FakeClient {
  readonly client: WsClient;
  readonly calls: CommitCall[];
  readonly resolveNext: () => void;
  readonly rejectNext: (err: Error) => void;
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
    resolveNext: (): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      next.resolve({
        type: 'committed',
        id: 'ack-id',
        inResponseTo: 'req-id',
        payload: { sessionId: SESSION_ID, sequence: 1, eventId: 'evt-1' },
      } as unknown as WsEnvelopeUnion);
    },
    rejectNext: (err: Error): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to reject');
      next.reject(err);
    },
  };
}

function renderAffordance(client: WsClient, edgeId: string = EDGE_ID): void {
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
      <EdgeShapeCommitAffordance edgeId={edgeId} />
    </Wrapper>,
  );
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

describe('EdgeShapeCommitAffordance — render structure', () => {
  it('renders the per-edge container + the commit button with stable testids', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.getByTestId(`edge-shape-commit-affordance-${EDGE_ID}`)).toBeTruthy();
    const button = screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`);
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-edge-id')).toBe(EDGE_ID);
    expect(button.getAttribute('data-commit-state')).toBe('enabled');
  });

  it('renders no inline error region when lastError is undefined', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.queryByTestId(`edge-shape-commit-affordance-error-${EDGE_ID}`)).toBeNull();
  });

  it('exposes the commit button aria-label off the en-US catalog', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    const button = screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`);
    // Reuses `moderator.commitButton.ariaLabel` per the refinement
    // Decisions; the catalog string is the same as the pending-pane
    // commit button.
    expect(button.getAttribute('aria-label')).toMatch(/commit/i);
  });
});

describe('EdgeShapeCommitAffordance — click-fires-commit contract', () => {
  it('clicking the button fires a single facet-arm commit envelope on (edge, edgeId, shape)', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('commit');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      target: string;
      entity_kind: string;
      entity_id: string;
      facet: string;
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.target).toBe('facet');
    expect(payload.entity_kind).toBe('edge');
    expect(payload.entity_id).toBe(EDGE_ID);
    expect(payload.facet).toBe('shape');
  });
});

describe('EdgeShapeCommitAffordance — in-flight disabling', () => {
  it('disables the button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`));
    });
    const button = screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('data-commit-state')).toBe('in-flight');
    await act(async () => {
      fake.resolveNext();
      await Promise.resolve();
    });
    const buttonAfter = screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`);
    expect((buttonAfter as HTMLButtonElement).disabled).toBe(false);
    expect(buttonAfter.getAttribute('data-commit-state')).toBe('enabled');
  });
});

describe('EdgeShapeCommitAffordance — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`edge-shape-commit-affordance-button-${EDGE_ID}`));
    });
    await act(async () => {
      fake.rejectNext(
        new WsRequestError({
          code: 'unanimous-agree-required',
          message: 'commit refused: not all participants agreed',
        }),
      );
      await Promise.resolve();
    });
    const region = screen.getByTestId(`edge-shape-commit-affordance-error-${EDGE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('unanimous-agree-required');
    expect(region.textContent).toContain('commit refused: not all participants agreed');
    // The in-flight latch cleared on rejection; the button is enabled again.
    expect(useCommitStore.getState().committing.has(`facet:edge:${EDGE_ID}:shape`)).toBe(false);
  });
});
