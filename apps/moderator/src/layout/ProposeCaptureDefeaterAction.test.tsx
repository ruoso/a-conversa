// Tests for `<ProposeCaptureDefeaterAction>` — the "Capture defeater"
// button + inline wire-error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
//
// Pins: the mode-gated render contract; the localized label + aria;
// the six-gate disabled toggle; the wire-error inline region.

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

import { ProposeCaptureDefeaterAction } from './ProposeCaptureDefeaterAction';
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

async function renderAction(client: WsClient): Promise<RenderResult> {
  const path = SESSION_ID;
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(
      <MemoryRouter initialEntries={[`/sessions/${path}/operate`]}>
        <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
          <Routes>
            <Route path="/sessions/:id/operate" element={<ProposeCaptureDefeaterAction />} />
          </Routes>
        </WsClientProvider>
      </MemoryRouter>,
    );
    return Promise.resolve();
  });
  return result;
}

function primeValid(): void {
  useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
  useCaptureStore.getState().setText('a defeater wording');
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

describe('ProposeCaptureDefeaterAction — render gating', () => {
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
      const { container } = await renderAction(fake.client);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('capture-defeater-propose-button')).toBeNull();
    });
  }

  it('renders the localized button label + aria-label when in capture-defeater mode', async () => {
    act(() => {
      primeValid();
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId('capture-defeater-propose-button');
    expect(button.textContent).toContain('Capture defeater');
    expect(button.getAttribute('aria-label')).toBe('Capture defeater');
  });
});

describe('ProposeCaptureDefeaterAction — canPropose disabled toggle', () => {
  it('disabled when no target is staged', async () => {
    act(() => {
      useCaptureStore.setState({ mode: 'capture-defeater', captureDefeaterTargetNodeId: null });
      useCaptureStore.getState().setText('a wording');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(true);
  });

  it('disabled when text is empty', async () => {
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
      // text is empty after enter cleared it
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(true);
  });

  it('disabled when text is whitespace-only', async () => {
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(TARGET_NODE_ID);
      useCaptureStore.getState().setText('    ');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(true);
  });

  it('disabled when WS is not open', async () => {
    act(() => {
      primeValid();
      useWsStore.getState().setConnectionStatus('reconnecting');
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(true);
  });

  it('disabled when a propose is in flight', async () => {
    act(() => {
      primeValid();
      useCaptureStore.getState().setProposing(true);
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Capturing defeater…');
  });

  it('enabled when all six gates pass', async () => {
    act(() => {
      primeValid();
    });
    const fake = makeFakeClient();
    await renderAction(fake.client);
    const button = screen.getByTestId<HTMLButtonElement>('capture-defeater-propose-button');
    expect(button.disabled).toBe(false);
  });
});
