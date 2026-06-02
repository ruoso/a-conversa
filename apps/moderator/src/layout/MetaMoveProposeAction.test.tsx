// Tests for `<MetaMoveProposeAction>` — the "Propose meta-move"
// button + inline validation / wire-error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
//
// Pins: the mode-gated render contract; the localized label + aria;
// the canPropose disabled toggle; the validation-error region
// rendering; the wire-error inline region.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  act,
  cleanup,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';

import { MetaMoveProposeAction } from './MetaMoveProposeAction';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { resetMetaMoveError } from './useMetaMoveAction';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_NODE_ID = '22222222-2222-4222-8222-222222222222';

interface ProposeCall<T extends WsMessageType = 'propose'> {
  readonly type: T;
  readonly payload: WsMessagePayloadMap[T];
}

function makeFakeClient(): { client: WsClient; calls: ProposeCall[] } {
  const calls: ProposeCall[] = [];
  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload } as unknown as ProposeCall);
    return new Promise<WsEnvelopeUnion>(() => undefined);
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
  return { client, calls };
}

async function renderAction(client: WsClient): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={<MetaMoveProposeAction />} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>,
    );
    return Promise.resolve();
  });
  return result;
}

function primeValid(): void {
  useCaptureStore.getState().enterMetaMoveMode();
  useCaptureStore.getState().setTargetEntityId(TARGET_NODE_ID);
  useCaptureStore.getState().setText('a meta-move content');
}

beforeAll(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

beforeEach(() => {
  useWsStore.getState().reset();
  useCaptureStore.getState().reset();
  resetMetaMoveError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useCaptureStore.getState().reset();
});

describe('MetaMoveProposeAction — render gating', () => {
  const nonMatchingModes: readonly CaptureMode[] = [
    'idle',
    'capture-statement',
    'decompose',
    'interpretive-split',
    'operationalization',
    'warrant-elicitation',
    'capture-defeater',
    'axiom-mark',
  ];
  for (const m of nonMatchingModes) {
    it(`renders null when mode is ${m}`, async () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      const fake = makeFakeClient();
      const { container } = await renderAction(fake.client);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('meta-move-propose-button')).toBeNull();
    });
  }

  it('renders the localized button label + aria-label when in meta-move mode', async () => {
    act(() => {
      primeValid();
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId('meta-move-propose-button');
    expect(button.textContent).toBe('Propose meta-move');
    expect(button.getAttribute('aria-label')).toBe(
      'Propose a meta-move (reframe / scope-change / stance) about the selected target',
    );
  });
});

describe('MetaMoveProposeAction — canPropose disabled toggle', () => {
  it('disabled when content is empty (validation-error region surfaces the content-missing reason)', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setTargetEntityId(TARGET_NODE_ID);
      // text is empty after enter cleared it
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('meta-move-propose-validation-error').textContent).toContain(
      'type the meta-move content first',
    );
  });

  it('disabled when no target is staged (validation-error region surfaces target-missing)', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setText('content here');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('meta-move-propose-validation-error').textContent).toContain(
      'pick a target node',
    );
  });

  it('disabled when target kind is annotation (validation-error region surfaces target-kind-invalid)', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
      useCaptureStore.getState().setText('content here');
      useCaptureStore.getState().setTargetEntity('annotation', 'a-1');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('meta-move-propose-validation-error').textContent).toContain(
      'meta-moves target nodes or edges — clear the annotation target and pick a node or edge',
    );
  });

  it('disabled when WS is not open', async () => {
    act(() => {
      primeValid();
      useWsStore.getState().setConnectionStatus('reconnecting');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(true);
  });

  it('disabled with the in-flight label when a propose is in flight', async () => {
    act(() => {
      primeValid();
      useCaptureStore.getState().setProposing(true);
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Proposing meta-move…');
  });

  it('enabled when all gates pass (validation-error region absent)', async () => {
    act(() => {
      primeValid();
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('meta-move-propose-button');
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId('meta-move-propose-validation-error')).toBeNull();
  });
});
