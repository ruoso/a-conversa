// Tests for `<NodeCardSubstanceAffordance>` — the inline per-node
// substance affordance mounted on `<StatementNode>`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_substance_affordance.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Render structure** — two `<button>` children in canonical
//      `agreed | disputed` order, each carrying the per-node testid
//      (`node-card-substance-affordance-button-<nodeId>-<value>`) and
//      a `data-value` + `data-node-id` attribute.
//   2. **Click-fires-propose** — clicking a button dispatches the
//      per-node set-node-substance propose envelope with the matching
//      value.
//   3. **In-flight disables every button** — while the hook reports
//      `inFlight === true`, every button is `disabled`.
//   4. **Wire error region** — when `lastError !== undefined` an
//      `role="alert"` paragraph mounts with the wire-supplied message.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { NodeCardSubstanceAffordance } from './NodeCardSubstanceAffordance';
import {
  resetSetNodeSubstanceStore,
  useSetNodeSubstanceStore,
} from '../layout/useProposeSetNodeSubstanceAction';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

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

function renderAffordance(client: WsClient, nodeId: string = NODE_ID): void {
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
      <NodeCardSubstanceAffordance nodeId={nodeId} />
    </Wrapper>,
  );
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetSetNodeSubstanceStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('NodeCardSubstanceAffordance — render structure', () => {
  it('renders the per-node container + the two value buttons in canonical order', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    // Container.
    expect(screen.getByTestId(`node-card-substance-affordance-${NODE_ID}`)).toBeTruthy();
    // Two value buttons.
    const expectedValues = ['agreed', 'disputed'] as const;
    for (const value of expectedValues) {
      const button = screen.getByTestId(
        `node-card-substance-affordance-button-${NODE_ID}-${value}`,
      );
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-value')).toBe(value);
      expect(button.getAttribute('data-node-id')).toBe(NODE_ID);
    }
  });

  it('mounts the localized aria-label for the role=group container', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    const group = screen
      .getByTestId(`node-card-substance-affordance-${NODE_ID}`)
      .querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('Set substance — does this claim hold?');
  });

  it('renders the "Holds" / "Doesn\'t hold" labels off the en-US catalog', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(
      screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-agreed`).textContent,
    ).toBe('Holds');
    expect(
      screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-disputed`).textContent,
    ).toBe("Doesn't hold");
  });

  it('renders no inline error region when lastError is undefined', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    expect(screen.queryByTestId(`node-card-substance-affordance-error-${NODE_ID}`)).toBeNull();
  });
});

describe('NodeCardSubstanceAffordance — click-fires-propose contract', () => {
  it('clicking the agreed button fires a set-node-substance propose envelope with value=agreed', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-agreed`));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      proposal: { kind: string; node_id: string; value: string };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal).toEqual({
      kind: 'set-node-substance',
      node_id: NODE_ID,
      value: 'agreed',
    });
  });

  it('clicking the disputed button carries value=disputed', () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    fireEvent.click(
      screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-disputed`),
    );
    const payload = fake.calls[0]?.payload as {
      proposal: { value: string };
    };
    expect(payload.proposal.value).toBe('disputed');
  });
});

describe('NodeCardSubstanceAffordance — in-flight disabling', () => {
  it('disables every button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-agreed`),
      );
    });
    // While in-flight every button is disabled.
    const VALUES = ['agreed', 'disputed'] as const;
    for (const value of VALUES) {
      const button = screen.getByTestId(
        `node-card-substance-affordance-button-${NODE_ID}-${value}`,
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
        `node-card-substance-affordance-button-${NODE_ID}-${value}`,
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('NodeCardSubstanceAffordance — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection', async () => {
    const fake = makeFakeClient();
    renderAffordance(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`node-card-substance-affordance-button-${NODE_ID}-agreed`),
      );
    });
    await act(async () => {
      fake.rejectNext(
        new WsRequestError({
          code: 'facet-sequence-out-of-order',
          message: 'propose set-node-substance refused: classification is proposed',
        }),
      );
      await Promise.resolve();
    });
    const region = screen.getByTestId(`node-card-substance-affordance-error-${NODE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('facet-sequence-out-of-order');
    expect(region.textContent).toContain(
      'propose set-node-substance refused: classification is proposed',
    );
    // Buttons re-enabled (the optimistic in-flight clears on error).
    expect(useSetNodeSubstanceStore.getState().inFlight.has(NODE_ID)).toBe(false);
  });
});
