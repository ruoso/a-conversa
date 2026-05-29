// Tests for `<ProposeDecompositionAction>` — the propose-decomposition
// button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. The five stable testids render (wrapper, button, key-chip,
//      validation-error region, wire-error region) and visibility
//      tracks the hook's state.
//   2. Localized button label + ariaLabel + key-chip glyph all
//      resolve (no `[t-missing]`).
//   3. The validation-error region renders the localized
//      components-invalid reason when rows are empty.
//   4. The wire-error region renders when `lastError !== undefined`
//      (driven via a failed propose round-trip).
//   5. The button is disabled during in-flight; the label switches to
//      "Proposing decomposition…".
//   6. Button click invokes the hook's `propose()`.
//   7. Per-locale parity — render in each of the three v1 locales and
//      assert no `[t-missing]` token nor raw catalog-key string is
//      visible.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import i18next from 'i18next';

import { ProposeDecompositionAction } from './ProposeDecompositionAction';
import { resetProposeDecompositionError } from './useProposeDecompositionAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '@a-conversa/shell';
import { WsRequestError } from '@a-conversa/shell';
import type { SendFn, WsClient, WsClientStatus } from '@a-conversa/shell';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_NODE_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await createI18nInstance('en-US');
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
      if (next === undefined) throw new Error('no pending send');
      next.resolve({
        type: 'proposed',
        id: 'ack',
        inResponseTo: 'req',
        payload: {
          sessionId: SESSION_ID,
          sequence: 1,
          eventId: '33333333-3333-4333-8333-333333333333',
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

function renderInRoute(
  client: WsClient,
  children: ReactNode = <ProposeDecompositionAction />,
): void {
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

function primeValidDecompose(): void {
  useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
  useCaptureStore.getState().setDecomposeComponentText(0, 'Workers should earn a living wage.');
  useCaptureStore.getState().setDecomposeComponentClassification(0, 'value');
  useCaptureStore.getState().setDecomposeComponentText(1, 'Workers should receive fair benefits.');
  useCaptureStore.getState().setDecomposeComponentClassification(1, 'normative');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeDecompositionError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('ProposeDecompositionAction — render structure', () => {
  it('renders the wrapper, button, key-chip when the validation gates pass + connected', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidDecompose();
    });
    renderInRoute(fake.client);
    expect(screen.getByTestId('propose-decomposition-action')).toBeTruthy();
    expect(screen.getByTestId('propose-decomposition-action-button')).toBeTruthy();
    expect(screen.getByTestId('propose-decomposition-action-key-chip')).toBeTruthy();
    // No validation-error region when gates pass.
    expect(screen.queryByTestId('propose-decomposition-action-validation-error')).toBeNull();
    // No wire-error region without a failed propose.
    expect(screen.queryByTestId('propose-decomposition-action-wire-error')).toBeNull();
  });

  it('localized button label + ariaLabel + key-chip glyph all resolve', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidDecompose();
    });
    renderInRoute(fake.client);
    const button = screen.getByTestId('propose-decomposition-action-button');
    expect(button.textContent).toContain('Propose decomposition');
    expect(button.getAttribute('aria-label')).toBe(
      'Propose the captured decomposition as a proposal on the graph',
    );
    const chip = screen.getByTestId('propose-decomposition-action-key-chip');
    expect(chip.textContent).toMatch(/Enter$/);
    expect(chip.textContent).not.toContain('[t-missing]');
    expect(screen.getByTestId('propose-decomposition-action').getAttribute('aria-label')).toBe(
      'Propose the captured decomposition as a proposal on the graph',
    );
  });
});

describe('ProposeDecompositionAction — validation-error region', () => {
  it('renders the localized components-invalid reason when rows are empty', () => {
    const fake = makeFakeClient();
    act(() => {
      // Enter decompose mode but leave the two seeded rows empty.
      useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
    });
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-decomposition-action-validation-error');
    expect(region.textContent).toContain('Cannot propose decomposition');
    expect(region.textContent).toContain('every component needs wording');
    expect(region.getAttribute('role')).toBe('status');
    // Button is disabled.
    expect(screen.getByTestId('propose-decomposition-action-button').hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      screen.getByTestId('propose-decomposition-action-button').getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('renders the localized target-missing reason when no parent is set', () => {
    const fake = makeFakeClient();
    // No enterDecomposeMode call — decomposeTargetNodeId stays null.
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-decomposition-action-validation-error');
    expect(region.textContent).toContain('no parent node selected');
  });
});

describe('ProposeDecompositionAction — wire-error region', () => {
  it('renders after a failed propose with the wire code + message', async () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidDecompose();
    });
    renderInRoute(fake.client);
    // Click the button to fire the propose.
    act(() => {
      fireEvent.click(screen.getByTestId('propose-decomposition-action-button'));
    });
    // Reject the in-flight send with a typed error.
    act(() => {
      fake.rejectNext(
        new WsRequestError({
          code: 'illegal-state-transition',
          message: 'parent already superseded',
        }),
      );
    });
    // Wait for the microtask flush so the catch block runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const region = screen.getByTestId('propose-decomposition-action-wire-error');
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.textContent).toContain('illegal-state-transition');
    expect(region.textContent).toContain('parent already superseded');
  });
});

describe('ProposeDecompositionAction — in-flight state', () => {
  it('button disables and label switches to the inFlightLabel during the round-trip', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidDecompose();
    });
    renderInRoute(fake.client);
    expect(screen.getByTestId('propose-decomposition-action-button').textContent).toContain(
      'Propose decomposition',
    );
    act(() => {
      fireEvent.click(screen.getByTestId('propose-decomposition-action-button'));
    });
    // Now in flight.
    const button = screen.getByTestId('propose-decomposition-action-button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toContain('Proposing decomposition…');
    // Resolve to clean up the pending promise.
    act(() => {
      fake.resolveNext();
    });
  });
});

describe('ProposeDecompositionAction — click fires propose', () => {
  it('button click sends a propose envelope through the injected WS client', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidDecompose();
    });
    renderInRoute(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId('propose-decomposition-action-button'));
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    // Resolve so the promise settles cleanly.
    act(() => {
      fake.resolveNext();
    });
  });
});

describe('ProposeDecompositionAction — per-locale parity', () => {
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;
  for (const locale of LOCALES) {
    it(`renders without [t-missing] tokens in ${locale}`, async () => {
      await i18next.changeLanguage(locale);
      cleanup();
      useCaptureStore.getState().reset();
      useWsStore.getState().reset();
      resetProposeDecompositionError();
      act(() => {
        useWsStore.getState().setConnectionStatus('open');
        // Enter decompose mode with empty rows so we surface both
        // chrome + reason strings in one render.
        useCaptureStore.getState().enterDecomposeMode(PARENT_NODE_ID);
      });
      const fake = makeFakeClient();
      renderInRoute(fake.client);
      const wrapper = screen.getByTestId('propose-decomposition-action');
      expect(wrapper.textContent).not.toContain('moderator.decompose.propose');
      expect(wrapper.textContent).not.toContain('[t-missing]');
      const region = screen.getByTestId('propose-decomposition-action-validation-error');
      expect(region.textContent).not.toContain('moderator.decompose.propose');
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
