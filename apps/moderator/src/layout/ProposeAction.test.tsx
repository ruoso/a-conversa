// Tests for `<ProposeAction>` — the propose button + inline error
// region.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The four stable testids render (wrapper, button, key-chip,
//      validation-error region) when the validation gates pass +
//      connection is open.
//   2. Localized button label + ariaLabel + key-chip glyph all
//      resolve (no `[t-missing]`).
//   3. The validation-error region renders when classification is
//      missing.
//   4. The wire-error region renders when `lastError !== undefined`
//      (driven via a failed propose round-trip).
//   5. The button is disabled during in-flight; the label switches
//      to "Proposing…".
//   6. Button click invokes the hook's `propose()` (the calls land on
//      the injected WS client).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import i18next from 'i18next';

import { ProposeAction } from './ProposeAction';
import { resetProposeError } from './useProposeAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '../ws/WsClientProvider';
import { WsRequestError } from '../ws/client';
import type { SendFn, WsClient, WsClientStatus } from '../ws/client';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { initI18n } from '../i18n';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

interface FakeClient {
  readonly client: WsClient;
  readonly calls: Array<{ type: WsMessageType; payload: unknown }>;
  readonly resolveNext: () => void;
  readonly rejectNext: (err: Error) => void;
}

function makeFakeClient(): FakeClient {
  const calls: Array<{ type: WsMessageType; payload: unknown }> = [];
  const pending: Array<{
    resolve: (envelope: WsEnvelopeUnion) => void;
    reject: (err: Error) => void;
  }> = [];
  const send: SendFn = <T extends WsMessageType>(
    type: T,
    payload: WsMessagePayloadMap[T],
  ): Promise<WsEnvelopeUnion> => {
    calls.push({ type, payload });
    return new Promise((resolve, reject) => {
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
      if (next === undefined) throw new Error('no pending send');
      next.resolve({
        type: 'proposed',
        id: 'ack',
        inResponseTo: 'req',
        payload: {
          sessionId: SESSION_ID,
          sequence: 1,
          eventId: '22222222-2222-4222-8222-222222222222',
        },
      } as unknown as WsEnvelopeUnion);
    },
    rejectNext: (err: Error): void => {
      const next = pending.shift();
      if (next === undefined) throw new Error('no pending send');
      next.reject(err);
    },
  };
}

function renderInRoute(client: WsClient, children: ReactNode = <ProposeAction />): void {
  render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={client}>
        <Routes>
          <Route path="/sessions/:id/operate" element={children} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('ProposeAction — render structure', () => {
  it('renders the wrapper, button, key-chip when the validation gates pass + connected', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Some wording');
      useCaptureStore.getState().setClassification('fact');
    });
    renderInRoute(fake.client);
    expect(screen.getByTestId('propose-action')).toBeTruthy();
    expect(screen.getByTestId('propose-action-button')).toBeTruthy();
    expect(screen.getByTestId('propose-action-key-chip')).toBeTruthy();
    // No validation-error region when gates pass.
    expect(screen.queryByTestId('propose-action-validation-error')).toBeNull();
    // No wire-error region without a failed propose.
    expect(screen.queryByTestId('propose-action-wire-error')).toBeNull();
  });

  it('localized button label + ariaLabel + key-chip glyph all resolve', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Some wording');
      useCaptureStore.getState().setClassification('fact');
    });
    renderInRoute(fake.client);
    const button = screen.getByTestId('propose-action-button');
    expect(button.textContent).toContain('Propose');
    expect(button.getAttribute('aria-label')).toBe(
      'Propose the in-progress capture as a proposal on the graph',
    );
    const chip = screen.getByTestId('propose-action-key-chip');
    // Either "⌘+Enter" or "Ctrl+Enter" depending on platform — the
    // chip text must NOT be the raw catalog key.
    expect(chip.textContent).toMatch(/Enter$/);
    expect(chip.textContent).not.toContain('[t-missing]');
    // Outer wrapper carries the same ariaLabel.
    expect(screen.getByTestId('propose-action').getAttribute('aria-label')).toBe(
      'Propose the in-progress capture as a proposal on the graph',
    );
  });
});

describe('ProposeAction — validation-error region', () => {
  it('renders the localized text-empty reason when the textarea is empty', () => {
    const fake = makeFakeClient();
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-action-validation-error');
    expect(region.textContent).toContain('Cannot propose');
    expect(region.textContent).toContain('type the wording first');
    expect(region.getAttribute('role')).toBe('status');
    // Button is disabled.
    expect(screen.getByTestId('propose-action-button').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('propose-action-button').getAttribute('aria-disabled')).toBe('true');
  });

  it('renders the localized classification-missing reason after the text is filled', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Has text');
    });
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-action-validation-error');
    expect(region.textContent).toContain('pick a classification');
  });

  it('renders the target-without-role reason when target is staged but role is null', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Some wording');
      useCaptureStore.getState().setClassification('fact');
      useCaptureStore.getState().setTargetEntityId('node-1');
    });
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-action-validation-error');
    expect(region.textContent).toContain('pick an edge role');
  });
});

describe('ProposeAction — wire-error region', () => {
  it('renders after a failed propose with the wire code + message', async () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Wire-error test');
      useCaptureStore.getState().setClassification('fact');
    });
    renderInRoute(fake.client);
    // Click the button to fire the propose.
    act(() => {
      fireEvent.click(screen.getByTestId('propose-action-button'));
    });
    // Reject the in-flight send with a typed error.
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'not-a-participant',
          message: 'requester is not a participant in this session',
        }),
      );
    });
    // Wait for the microtask flush so the catch block runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const region = screen.getByTestId('propose-action-wire-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.textContent).toContain('not-a-participant');
    expect(region.textContent).toContain('requester is not a participant');
  });
});

describe('ProposeAction — in-flight state', () => {
  it('button disables and label switches to the inFlightLabel during the round-trip', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Inflight UI test');
      useCaptureStore.getState().setClassification('fact');
    });
    renderInRoute(fake.client);
    expect(screen.getByTestId('propose-action-button').textContent).toContain('Propose');
    act(() => {
      fireEvent.click(screen.getByTestId('propose-action-button'));
    });
    // Now in flight.
    const button = screen.getByTestId('propose-action-button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toContain('Proposing…');
    // Resolve to clean up the pending promise.
    act(() => {
      fake.resolveNext();
    });
  });
});

describe('ProposeAction — click fires propose', () => {
  it('button click sends a propose envelope through the injected WS client', () => {
    const fake = makeFakeClient();
    act(() => {
      useCaptureStore.getState().setText('Click-fires-propose');
      useCaptureStore.getState().setClassification('fact');
    });
    renderInRoute(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId('propose-action-button'));
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    // Resolve so the promise settles cleanly.
    act(() => {
      fake.resolveNext();
    });
  });
});

describe('ProposeAction — per-locale parity', () => {
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;
  for (const locale of LOCALES) {
    it(`renders without [t-missing] tokens in ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      cleanup();
      useCaptureStore.getState().reset();
      useWsStore.getState().reset();
      resetProposeError();
      act(() => {
        useWsStore.getState().setConnectionStatus('open');
        // Trigger the validation-error region too so we cover both
        // chrome + reason strings in one render.
      });
      const fake = makeFakeClient();
      renderInRoute(fake.client);
      const wrapper = screen.getByTestId('propose-action');
      expect(wrapper.textContent).not.toContain('moderator.proposeAction');
      expect(wrapper.textContent).not.toContain('[t-missing]');
      // The validation-error region renders the text-empty reason.
      const region = screen.getByTestId('propose-action-validation-error');
      expect(region.textContent).not.toContain('moderator.proposeAction');
      expect(region.textContent).not.toContain('[t-missing]');
      await i18next.changeLanguage('en-US');
    });
  }
});

// Silence one console.error noise pattern that fires on the strict-mode
// double-mount the test harness exhibits — keeps the test output clean.
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) return;
  process.stderr.write(args.map((a) => String(a)).join(' ') + '\n');
});
