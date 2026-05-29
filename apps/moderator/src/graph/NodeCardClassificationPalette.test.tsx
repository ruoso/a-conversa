// Tests for `<NodeCardClassificationPalette>` — the inline per-node
// classification affordance mounted on `<StatementNode>`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_classification_affordance.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Render structure** — five `<button>` children in canonical
//      `METHODOLOGY_KINDS` order, each carrying the per-node testid
//      (`node-card-classification-palette-button-<nodeId>-<kind>`) and
//      a `data-kind` + `data-node-id` attribute.
//   2. **Click-fires-propose** — clicking a button dispatches the
//      per-node classify-node propose envelope with the matching
//      classification.
//   3. **In-flight disables every button** — while the hook reports
//      `inFlight === true`, every button is `disabled`.
//   4. **Wire error region** — when `lastError !== undefined` an
//      `role="alert"` paragraph mounts with the wire-supplied message.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { NodeCardClassificationPalette } from './NodeCardClassificationPalette';
import {
  resetClassifyNodeStore,
  useClassifyNodeStore,
} from '../layout/useProposeClassifyNodeAction';
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

function renderPalette(client: WsClient, nodeId: string = NODE_ID): void {
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
      <NodeCardClassificationPalette nodeId={nodeId} />
    </Wrapper>,
  );
}

beforeEach(() => {
  useWsStore.getState().reset();
  resetClassifyNodeStore();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('NodeCardClassificationPalette — render structure', () => {
  it('renders the per-node container + the five kind buttons in canonical order', () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    // Container.
    expect(screen.getByTestId(`node-card-classification-palette-${NODE_ID}`)).toBeTruthy();
    // Five kind buttons.
    const expectedKinds = ['fact', 'predictive', 'value', 'normative', 'definitional'] as const;
    for (const kind of expectedKinds) {
      const button = screen.getByTestId(
        `node-card-classification-palette-button-${NODE_ID}-${kind}`,
      );
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-kind')).toBe(kind);
      expect(button.getAttribute('data-node-id')).toBe(NODE_ID);
    }
  });

  it('mounts the localized aria-label for the role=group container', () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    const group = screen
      .getByTestId(`node-card-classification-palette-${NODE_ID}`)
      .querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('Classify this statement — pick a kind');
  });

  it('renders no inline error region when lastError is undefined', () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    expect(screen.queryByTestId(`node-card-classification-palette-error-${NODE_ID}`)).toBeNull();
  });
});

describe('NodeCardClassificationPalette — click-fires-propose contract', () => {
  it('clicking the fact button fires a classify-node propose envelope with classification=fact', () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    fireEvent.click(screen.getByTestId(`node-card-classification-palette-button-${NODE_ID}-fact`));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as {
      sessionId: string;
      proposal: { kind: string; node_id: string; classification: string };
    };
    expect(payload.sessionId).toBe(SESSION_ID);
    expect(payload.proposal).toEqual({
      kind: 'classify-node',
      node_id: NODE_ID,
      classification: 'fact',
    });
  });

  it('clicking the value button carries classification=value', () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    fireEvent.click(screen.getByTestId(`node-card-classification-palette-button-${NODE_ID}-value`));
    const payload = fake.calls[0]?.payload as {
      proposal: { classification: string };
    };
    expect(payload.proposal.classification).toBe('value');
  });
});

describe('NodeCardClassificationPalette — in-flight disabling', () => {
  it('disables every button while the round-trip is in flight; re-enables on success', async () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`node-card-classification-palette-button-${NODE_ID}-fact`),
      );
    });
    // While in-flight every button is disabled.
    const KINDS = ['fact', 'predictive', 'value', 'normative', 'definitional'] as const;
    for (const kind of KINDS) {
      const button = screen.getByTestId(
        `node-card-classification-palette-button-${NODE_ID}-${kind}`,
      );
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    // Resolve the ack.
    await act(async () => {
      fake.resolveNext();
      // Yield a microtask so the React state flip lands.
      await Promise.resolve();
    });
    for (const kind of KINDS) {
      const button = screen.getByTestId(
        `node-card-classification-palette-button-${NODE_ID}-${kind}`,
      );
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

describe('NodeCardClassificationPalette — wire-error region', () => {
  it('mounts the role="alert" region carrying the wire-error message on rejection', async () => {
    const fake = makeFakeClient();
    renderPalette(fake.client);
    act(() => {
      fireEvent.click(
        screen.getByTestId(`node-card-classification-palette-button-${NODE_ID}-fact`),
      );
    });
    await act(async () => {
      fake.rejectNext(
        new WsRequestError({
          code: 'facet-sequence-out-of-order',
          message: 'propose classify-node refused: wording is proposed',
        }),
      );
      await Promise.resolve();
    });
    const region = screen.getByTestId(`node-card-classification-palette-error-${NODE_ID}`);
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.getAttribute('data-error-code')).toBe('facet-sequence-out-of-order');
    expect(region.textContent).toContain('propose classify-node refused: wording is proposed');
    // Buttons re-enabled (the optimistic in-flight clears on error).
    expect(useClassifyNodeStore.getState().inFlight.has(NODE_ID)).toBe(false);
  });
});
