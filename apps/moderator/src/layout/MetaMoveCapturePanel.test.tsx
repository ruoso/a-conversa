// Tests for `<MetaMoveCapturePanel>` — meta-move-mode capture surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
//
// Pins: the mode-gated render contract; the slot composition (target
// chip + kind-selector placeholder + text input).

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

import { MetaMoveCapturePanel } from './MetaMoveCapturePanel';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { resetMetaMoveError } from './useMetaMoveAction';
import { WsClientProvider, createI18nInstance } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function makeFakeClient(): WsClient {
  const send: SendFn = <T extends WsMessageType>(
    _type: T,
    _payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => new Promise<WsEnvelopeUnion>(() => undefined);
  return {
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
}

async function renderPanel(client: WsClient): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={<MetaMoveCapturePanel />} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>,
    );
    return Promise.resolve();
  });
  return result;
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

describe('MetaMoveCapturePanel — render gating', () => {
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
      const { container } = await renderPanel(makeFakeClient());
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('meta-move-capture-pane')).toBeNull();
    });
  }

  it('renders the slot composition (target chip + kind selector + text input) when mode is meta-move', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
    });
    await renderPanel(makeFakeClient());
    expect(screen.getByTestId('meta-move-capture-pane')).toBeTruthy();
    expect(screen.getByTestId('capture-target-chip')).toBeTruthy();
    expect(screen.getByTestId('meta-move-kind-selector')).toBeTruthy();
    expect(screen.getByTestId('capture-text-input-textarea')).toBeTruthy();
  });
});
