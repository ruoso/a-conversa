// Tests for `<RebutEdgePreCommitAffordance>` — the methodology-flavored
// per-edge substance affordance mounted on `<StatementEdge>`'s label
// container for rebut edges in F6 step 4 state.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_substance_precommit.md
//
// Per ADR 0022 these are committed Vitest cases. They mirror
// `EdgeCardSubstanceAffordance.test.tsx` with the methodology-flavored
// labels + the hint paragraph added on top.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { RebutEdgePreCommitAffordance } from './RebutEdgePreCommitAffordance';
import {
  resetSetEdgeSubstanceStore,
  useSetEdgeSubstanceStore,
} from '../layout/useProposeSetEdgeSubstanceAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EDGE_ID = '33333333-3333-4333-8333-333333333333';

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
  readonly resolveNext: () => void;
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
    resolveNext: (): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send to resolve');
      next.resolve({
        type: 'proposed',
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
      <RebutEdgePreCommitAffordance edgeId={edgeId} />
    </Wrapper>,
  );
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetSetEdgeSubstanceStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('RebutEdgePreCommitAffordance — render structure', () => {
  it('renders the per-edge container, the hint paragraph, and the two value buttons in canonical order', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    // Container with the rebut-specific data attributes.
    const container = screen.getByTestId(`rebut-edge-pre-commit-affordance-${EDGE_ID}`);
    expect(container).toBeTruthy();
    expect(container.getAttribute('data-edge-id')).toBe(EDGE_ID);
    expect(container.getAttribute('data-rebut')).toBe('true');
    // Hint paragraph carrying the methodology-flavored framing.
    const hint = screen.getByTestId(`rebut-edge-pre-commit-hint-${EDGE_ID}`);
    expect(hint.textContent).toBe(
      'Pre-commit the retraction: agreeing here records that if this condition holds, it would defeat the target.',
    );
    // Two value buttons in canonical `agreed | disputed` order with the
    // methodology-flavored labels.
    const expectedValues = ['agreed', 'disputed'] as const;
    const expectedLabels: Record<(typeof expectedValues)[number], string> = {
      agreed: 'Pre-commit as agreed',
      disputed: 'Mark disputed',
    };
    for (const value of expectedValues) {
      const button = screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-${value}`);
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-value')).toBe(value);
      expect(button.getAttribute('data-edge-id')).toBe(EDGE_ID);
      expect(button.textContent).toBe(expectedLabels[value]);
      // ICU substitution into the rebut-specific aria-label key.
      expect(button.getAttribute('aria-label')).toBe(
        `${expectedLabels[value]} substance for this rebut edge`,
      );
    }
    // No inline error region while lastError is undefined.
    expect(screen.queryByTestId(`rebut-edge-pre-commit-error-${EDGE_ID}`)).toBeNull();
  });
});

describe('RebutEdgePreCommitAffordance — click-fires-propose contract', () => {
  it('clicking the agreed button fires a set-edge-substance propose envelope with value=agreed', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-agreed`));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      proposal: { kind: string; edge_id: string; value: string };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal).toEqual({
      kind: 'set-edge-substance',
      edge_id: EDGE_ID,
      value: 'agreed',
    });
  });

  it('clicking the disputed button carries value=disputed (preserves the disputed path per Decision §D4)', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-disputed`));
    expect(fake.calls.length).toBe(1);
    const payload = fake.calls[0]?.payload as {
      proposal: { kind: string; edge_id: string; value: string };
    };
    expect(payload.proposal).toEqual({
      kind: 'set-edge-substance',
      edge_id: EDGE_ID,
      value: 'disputed',
    });
  });
});

describe('RebutEdgePreCommitAffordance — in-flight disabling', () => {
  it('disables every button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-agreed`));
    });
    const VALUES = ['agreed', 'disputed'] as const;
    for (const value of VALUES) {
      const button = screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-${value}`);
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    // Inline error region stays absent while inFlight (no prior error).
    expect(screen.queryByTestId(`rebut-edge-pre-commit-error-${EDGE_ID}`)).toBeNull();
    await act(async () => {
      fake.resolveNext();
      await Promise.resolve();
    });
    for (const value of VALUES) {
      const button = screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-${value}`);
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('RebutEdgePreCommitAffordance — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection and clears it on the next successful propose', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-agreed`));
    });
    await act(async () => {
      fake.rejectNext(
        new WsRequestError({
          code: 'facet-sequence-out-of-order',
          message: 'propose set-edge-substance refused: shape is proposed',
        }),
      );
      await Promise.resolve();
    });
    const region = screen.getByTestId(`rebut-edge-pre-commit-error-${EDGE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('facet-sequence-out-of-order');
    expect(region.textContent).toContain('propose set-edge-substance refused: shape is proposed');
    // Buttons re-enabled (optimistic in-flight clears on error).
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_ID)).toBe(false);
    // Re-fire — on success, lastError clears and the inline region unmounts.
    act(() => {
      fireEvent.click(screen.getByTestId(`rebut-edge-pre-commit-button-${EDGE_ID}-agreed`));
    });
    await act(async () => {
      fake.resolveNext();
      await Promise.resolve();
    });
    expect(screen.queryByTestId(`rebut-edge-pre-commit-error-${EDGE_ID}`)).toBeNull();
  });
});
