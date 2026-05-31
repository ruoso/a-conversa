// Tests for `<CaptureDefeaterModeExitButton>` — capture-defeater-mode
// exit affordance + target-wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_capture_defeater_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Sibling test file to `OperationalizationModeExitButton.test.tsx` /
// `DecomposeModeExitButton.test.tsx` /
// `InterpretiveSplitModeExitButton.test.tsx` /
// `WarrantElicitationModeExitButton.test.tsx`. The component is a thin
// wrapper over `<ProposalModeExitAffordance mode="capture-defeater">`;
// assertions mirror the sibling-side surface with the per-mode
// `data-testid`s + per-mode catalog keys. The cases here also cover the
// 5th-mode branch of `<ProposalModeExitAffordance>` (no separate test
// file exists for the affordance — each per-mode wrapper test covers
// its arm of the shared body).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';
import type { Event } from '@a-conversa/shared-types';

import { CaptureDefeaterModeExitButton } from './CaptureDefeaterModeExitButton';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-31T00:00:00.000Z',
    },
    createdAt: '2026-05-31T00:00:00.000Z',
  };
}

async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

async function renderWithRoute(): Promise<RenderResult> {
  function RouteHost(): ReactElement {
    return <CaptureDefeaterModeExitButton />;
  }
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <Routes>
        <Route path="/sessions/:id/operate" element={<RouteHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  useWsStore.getState().reset();
  useCaptureStore.getState().reset();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  useWsStore.getState().reset();
  useCaptureStore.getState().reset();
});

describe('CaptureDefeaterModeExitButton — render gating', () => {
  it('renders null when mode is idle', async () => {
    const { container } = await renderWithRoute();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('capture-defeater-mode-exit')).toBeNull();
  });

  // Parametric coverage: the button must NOT render for any of the
  // eight non-matching `CaptureMode` values. Pinning each mode keeps
  // a future CaptureMode extension from accidentally rendering the
  // exit button outside its proper mode.
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
    it(`renders null when mode is ${m} (does NOT cross-bleed across modes)`, async () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      await renderWithRoute();
      expect(screen.queryByTestId('capture-defeater-mode-exit')).toBeNull();
    });
  }

  it('renders the button + overlay when mode is capture-defeater and a matching node-created event exists', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(NODE_A);
    });
    await renderWithRoute();

    const container = screen.getByTestId('capture-defeater-mode-exit-container');
    expect(container).toBeTruthy();
    const button = screen.getByTestId('capture-defeater-mode-exit');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Exit capture-defeater mode');
    expect(button.getAttribute('title')).toBe('Exit capture-defeater mode (Esc)');
    const overlay = screen.getByTestId('capture-defeater-mode-target-wording');
    expect(overlay.textContent).toBe('Defeating parent wording');
  });

  it('renders the button with an empty overlay when the events log is missing the target node-created event', async () => {
    // Mode flips but the node has not (yet) reached the projection.
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(NODE_A);
    });
    await renderWithRoute();
    const button = screen.getByTestId('capture-defeater-mode-exit');
    expect(button).toBeTruthy();
    expect(screen.getByTestId('capture-defeater-mode-target-wording').textContent).toBe('');
  });
});

describe('CaptureDefeaterModeExitButton — exit gestures', () => {
  it('clicking the button calls exitCaptureDefeaterMode and unmounts the button', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.getByTestId('capture-defeater-mode-exit')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('capture-defeater-mode-exit'));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().captureDefeaterTargetNodeId).toBeNull();
    expect(screen.queryByTestId('capture-defeater-mode-exit')).toBeNull();
  });

  it('Escape keypress fires exitCaptureDefeaterMode while mode is capture-defeater', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterCaptureDefeaterMode(NODE_A);
    });
    await renderWithRoute();
    expect(useCaptureStore.getState().mode).toBe('capture-defeater');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().captureDefeaterTargetNodeId).toBeNull();
  });
});

describe('CaptureDefeaterModeExitButton — i18n locale parity', () => {
  const cases = [
    {
      locale: 'en-US',
      ariaLabel: 'Exit capture-defeater mode',
      tooltip: 'Exit capture-defeater mode (Esc)',
      overlay: 'Defeating parent wording',
    },
    {
      locale: 'pt-BR',
      ariaLabel: 'Sair do modo de captura de refutação',
      tooltip: 'Sair do modo de captura de refutação (Esc)',
      overlay: 'Refutando parent wording',
    },
    {
      locale: 'es-419',
      ariaLabel: 'Salir del modo de captura de refutación',
      tooltip: 'Salir del modo de captura de refutación (Esc)',
      overlay: 'Refutando parent wording',
    },
  ] as const;

  for (const { locale, ariaLabel, tooltip, overlay } of cases) {
    it(`${locale} — aria-label / tooltip / overlay resolve to localized strings`, async () => {
      await i18next.changeLanguage(locale);
      useWsStore
        .getState()
        .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
      act(() => {
        useCaptureStore.getState().enterCaptureDefeaterMode(NODE_A);
      });
      await renderWithRoute();

      const button = screen.getByTestId('capture-defeater-mode-exit');
      expect(button.getAttribute('aria-label')).toBe(ariaLabel);
      expect(button.getAttribute('title')).toBe(tooltip);
      expect(screen.getByTestId('capture-defeater-mode-target-wording').textContent).toBe(overlay);

      // The aria-label / tooltip / overlay each resolve to a non-key
      // string (i.e. translation succeeded — i18next did not fall
      // through to returning the literal catalog key).
      expect(button.getAttribute('aria-label')).not.toBe(
        'moderator.captureDefeater.exit.ariaLabel',
      );
      expect(button.getAttribute('title')).not.toBe('moderator.captureDefeater.exit.tooltip');
      expect(screen.getByTestId('capture-defeater-mode-target-wording').textContent).not.toBe(
        'moderator.captureDefeater.banner.targetWording',
      );
    });
  }
});
