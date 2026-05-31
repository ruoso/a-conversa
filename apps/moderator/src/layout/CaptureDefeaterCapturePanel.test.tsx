// Tests for `<CaptureDefeaterCapturePanel>` — capture-defeater-mode
// capture surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
//
// Per ADR 0022 these pin: the mode-gated render contract; the
// textarea's `text`-slice round-trip + paste-clamp; the Cmd/Ctrl+Enter
// submit wiring (same convention as `<CaptureTextInput>`).

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import { CaptureDefeaterCapturePanel } from './CaptureDefeaterCapturePanel';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { resetProposeCaptureDefeaterError } from './useProposeCaptureDefeaterAction';
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

async function renderPanel(client: WsClient): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={<CaptureDefeaterCapturePanel />} />
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
  resetProposeCaptureDefeaterError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useCaptureStore.getState().reset();
});

describe('CaptureDefeaterCapturePanel — render gating', () => {
  const nonMatchingModes: readonly CaptureMode[] = [
    'idle',
    'capture-statement',
    'decompose',
    'interpretive-split',
    'operationalization',
    'warrant-elicitation',
    'meta-move',
    'axiom-mark',
  ];
  for (const m of nonMatchingModes) {
    it(`renders null when mode is ${m}`, async () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      const fake = makeFakeClient();
      const { container } = await renderPanel(fake.client);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('capture-defeater-capture-pane')).toBeNull();
    });
  }

  it('renders the panel with the wording textarea bound to s.text when mode is capture-defeater', async () => {
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
      useCaptureStore.getState().setText('a defeater wording draft');
    });
    const fake = makeFakeClient();
    await renderPanel(fake.client);
    const root = screen.getByTestId('capture-defeater-capture-pane');
    expect(root).toBeTruthy();
    const textarea = screen.getByTestId<HTMLTextAreaElement>(
      'capture-defeater-capture-pane-wording',
    );
    expect(textarea.value).toBe('a defeater wording draft');
    // Localized strings: aria-label + placeholder resolve from the
    // catalog (proves the new i18n keys wired through).
    expect(textarea.getAttribute('aria-label')).toBe(
      'Defeater wording — what would defeat the selected statement?',
    );
    expect(textarea.getAttribute('placeholder')).toBe(
      'Type the retraction condition that defeats this statement…',
    );
  });

  it('writes through s.setText on every keystroke and clamps paste-bypass past MAX_METHODOLOGY_TEXT_LENGTH', async () => {
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
    });
    const fake = makeFakeClient();
    await renderPanel(fake.client);
    const textarea = screen.getByTestId('capture-defeater-capture-pane-wording');
    act(() => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });
    expect(useCaptureStore.getState().text).toBe('hello');

    // Paste-bypass: change-event with a value past the cap. The
    // defensive `slice` in the panel's onChange clamps it.
    const oversized = 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 64);
    act(() => {
      fireEvent.change(textarea, { target: { value: oversized } });
    });
    expect(useCaptureStore.getState().text.length).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
  });

  it('Cmd+Enter fires propose (no newline inserted); plain Enter / Shift+Enter do NOT submit', async () => {
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
      useCaptureStore.getState().setText('a defeater wording');
    });
    const fake = makeFakeClient();
    await renderPanel(fake.client);
    const textarea = screen.getByTestId('capture-defeater-capture-pane-wording');

    // Plain Enter — no submit, default newline behavior allowed.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    expect(fake.calls.length).toBe(0);

    // Shift+Enter — same: no submit.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    });
    expect(fake.calls.length).toBe(0);

    // Cmd+Enter — submit fires. The propose envelope lands.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
  });
});
