// Tests for `<ProposeInterpretiveSplitAction>` — the
// propose-interpretive-split button + inline error region.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// Sibling: ProposeDecompositionAction.test.tsx
//
// Cases:
//
//   1. The five stable testids render with the per-mode prefix
//      (`propose-interpretive-split-action*`).
//   2. Localized button label + ariaLabel resolve to en-US.
//   3. Button click invokes the hook's `propose()` — exactly one
//      `propose` envelope of kind `interpretive-split` fires through
//      the injected WS client.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import i18next from 'i18next';

import { ProposeInterpretiveSplitAction } from './ProposeInterpretiveSplitAction';
import { resetProposeInterpretiveSplitError } from './useProposeProposalAction';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { WsClientProvider } from '../ws/WsClientProvider';
import type { SendFn, WsClient, WsClientStatus } from '../ws/client';
import type { WsEnvelopeUnion, WsMessagePayloadMap, WsMessageType } from '@a-conversa/shared-types';
import { initI18n } from '../i18n';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_NODE_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await initI18n('en-US');
  await i18next.changeLanguage('en-US');
});

interface FakeClient {
  readonly client: WsClient;
  readonly calls: Array<{ type: WsMessageType; payload: unknown }>;
  readonly resolveNext: () => void;
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
          eventId: '33333333-3333-4333-8333-333333333333',
        },
      } as unknown as WsEnvelopeUnion);
    },
  };
}

function renderInRoute(
  client: WsClient,
  children: ReactNode = <ProposeInterpretiveSplitAction />,
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

function primeValidInterpretiveSplit(): void {
  useCaptureStore.getState().enterInterpretiveSplitMode(PARENT_NODE_ID);
  useCaptureStore
    .getState()
    .setInterpretiveSplitReadingText(0, 'Welfare deficits are our evidence for capacities.');
  useCaptureStore.getState().setInterpretiveSplitReadingClassification(0, 'fact');
  useCaptureStore
    .getState()
    .setInterpretiveSplitReadingText(1, 'Capability-frustration just is welfare loss.');
  useCaptureStore.getState().setInterpretiveSplitReadingClassification(1, 'value');
}

beforeEach(() => {
  useCaptureStore.getState().reset();
  useWsStore.getState().reset();
  resetProposeInterpretiveSplitError();
  act(() => {
    useWsStore.getState().setConnectionStatus('open');
  });
});

afterEach(() => {
  cleanup();
});

describe('ProposeInterpretiveSplitAction — render structure', () => {
  it('renders the wrapper, button, key-chip with the per-mode testids when the validation gates pass + connected', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidInterpretiveSplit();
    });
    renderInRoute(fake.client);
    expect(screen.getByTestId('propose-interpretive-split-action')).toBeTruthy();
    expect(screen.getByTestId('propose-interpretive-split-action-button')).toBeTruthy();
    expect(screen.getByTestId('propose-interpretive-split-action-key-chip')).toBeTruthy();
    // No decompose-side testids should leak.
    expect(screen.queryByTestId('propose-decomposition-action')).toBeNull();
  });

  it('localized button label + ariaLabel resolve to en-US strings', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidInterpretiveSplit();
    });
    renderInRoute(fake.client);
    const button = screen.getByTestId('propose-interpretive-split-action-button');
    expect(button.textContent).toContain('Propose interpretive split');
    expect(button.getAttribute('aria-label')).toBe(
      'Propose the captured interpretive split as a proposal on the graph',
    );
    // Reachable via role-name lookup per Acceptance criterion §6. The
    // accessible name is the `aria-label` (the
    // "Propose the captured interpretive split…" form); the visible
    // <span> label resolves to "Propose interpretive split".
    expect(
      screen.getByRole('button', {
        name: 'Propose the captured interpretive split as a proposal on the graph',
      }),
    ).toBeTruthy();
  });

  it('the validation-error region renders the localized readings-invalid reason when rows are empty', () => {
    const fake = makeFakeClient();
    act(() => {
      // Enter interpretive-split mode but leave the two seeded rows empty.
      useCaptureStore.getState().enterInterpretiveSplitMode(PARENT_NODE_ID);
    });
    renderInRoute(fake.client);
    const region = screen.getByTestId('propose-interpretive-split-action-validation-error');
    expect(region.textContent).toContain('Cannot propose interpretive split');
    expect(region.textContent).toContain('every reading needs wording');
    expect(region.getAttribute('role')).toBe('status');
    expect(
      screen.getByTestId('propose-interpretive-split-action-button').hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('ProposeInterpretiveSplitAction — click fires propose', () => {
  it('button click sends one propose envelope of kind: interpretive-split through the injected WS client', () => {
    const fake = makeFakeClient();
    act(() => {
      primeValidInterpretiveSplit();
    });
    renderInRoute(fake.client);
    act(() => {
      fireEvent.click(screen.getByTestId('propose-interpretive-split-action-button'));
    });
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.type).toBe('propose');
    const payload = fake.calls[0]?.payload as { proposal: { kind: string } };
    expect(payload.proposal.kind).toBe('interpretive-split');
    act(() => {
      fake.resolveNext();
    });
  });
});

vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) return;
  process.stderr.write(args.map((a) => String(a)).join(' ') + '\n');
});
