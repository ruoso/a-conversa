// Tests for `<EdgeCardSubstanceAffordance>` — the inline per-edge
// substance affordance mounted on `<StatementEdge>`'s label container.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_card_substance_affordance.md
//
// Per ADR 0022 these are committed Vitest cases. Mirrors
// `NodeCardSubstanceAffordance.test.tsx` — they lock in:
//
//   1. **Render structure** — two `<button>` children in canonical
//      `agreed | disputed` order, each carrying the per-edge testid
//      (`edge-card-substance-affordance-button-<edgeId>-<value>`) and
//      a `data-value` + `data-edge-id` attribute.
//   2. **Click-fires-propose** — clicking a button dispatches the
//      per-edge set-edge-substance propose envelope with the matching
//      value.
//   3. **In-flight disables every button** — while the hook reports
//      `inFlight === true`, every button is `disabled`.
//   4. **Wire error region** — when `lastError !== undefined` an
//      `role="alert"` paragraph mounts with the wire-supplied message.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { EdgeCardSubstanceAffordance } from './EdgeCardSubstanceAffordance';
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
const EDGE_ID = '22222222-2222-4222-8222-222222222222';

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
      <EdgeCardSubstanceAffordance edgeId={edgeId} />
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

describe('EdgeCardSubstanceAffordance — render structure', () => {
  it('renders the per-edge container + the two value buttons in canonical order', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    // Container.
    expect(screen.getByTestId(`edge-card-substance-affordance-${EDGE_ID}`)).toBeTruthy();
    // Two value buttons.
    const expectedValues = ['agreed', 'disputed'] as const;
    for (const value of expectedValues) {
      const button = screen.getByTestId(
        `edge-card-substance-affordance-button-${EDGE_ID}-${value}`,
      );
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-value')).toBe(value);
      expect(button.getAttribute('data-edge-id')).toBe(EDGE_ID);
    }
  });

  it('mounts the localized aria-label for the role=group container', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    const group = screen
      .getByTestId(`edge-card-substance-affordance-${EDGE_ID}`)
      .querySelector('[role="group"]');
    expect(group).not.toBeNull();
    // Reuses the node-side namespace per refinement Decisions.
    expect(group?.getAttribute('aria-label')).toBe('Set substance — does this claim hold?');
  });

  it('renders the "Holds" / "Doesn\'t hold" labels off the en-US catalog', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(
      screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-agreed`).textContent,
    ).toBe('Holds');
    expect(
      screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-disputed`).textContent,
    ).toBe("Doesn't hold");
  });

  it('renders no inline error region when lastError is undefined', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.queryByTestId(`edge-card-substance-affordance-error-${EDGE_ID}`)).toBeNull();
  });
});

describe('EdgeCardSubstanceAffordance — click-fires-propose contract', () => {
  it('clicking the agreed button fires a set-edge-substance propose envelope with value=agreed', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-agreed`));
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

  it('clicking the disputed button carries value=disputed', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(
      screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-disputed`),
    );
    const payload = fake.calls[0]?.payload as {
      proposal: { value: string };
    };
    expect(payload.proposal.value).toBe('disputed');
  });
});

describe('EdgeCardSubstanceAffordance — in-flight disabling', () => {
  it('disables every button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-agreed`),
      );
    });
    // While in-flight every button is disabled.
    const VALUES = ['agreed', 'disputed'] as const;
    for (const value of VALUES) {
      const button = screen.getByTestId(
        `edge-card-substance-affordance-button-${EDGE_ID}-${value}`,
      );
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    // Resolve the ack.
    await act(async () => {
      fake.resolveNext();
      // Yield a microtask so the React state flip lands.
      await Promise.resolve();
    });
    for (const value of VALUES) {
      const button = screen.getByTestId(
        `edge-card-substance-affordance-button-${EDGE_ID}-${value}`,
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('EdgeCardSubstanceAffordance — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`edge-card-substance-affordance-button-${EDGE_ID}-agreed`),
      );
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
    const region = screen.getByTestId(`edge-card-substance-affordance-error-${EDGE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('facet-sequence-out-of-order');
    expect(region.textContent).toContain('propose set-edge-substance refused: shape is proposed');
    // Buttons re-enabled (the optimistic in-flight clears on error).
    expect(useSetEdgeSubstanceStore.getState().inFlight.has(EDGE_ID)).toBe(false);
  });
});
