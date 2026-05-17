// Tests for `<InterpretiveSplitModeExitButton>` — interpretive-split-
// mode exit affordance + target-wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Sibling test file to `DecomposeModeExitButton.test.tsx`. The
// component is a thin wrapper over `<ProposalModeExitAffordance
// mode="interpretive-split">`; assertions mirror the decompose-side
// surface with the per-mode `data-testid`s + per-mode catalog keys.

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

import { InterpretiveSplitModeExitButton } from './InterpretiveSplitModeExitButton';
import { useCaptureStore } from '../stores/captureStore';
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
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

// Async `render(...)` shadow. `useTranslation()` schedules a
// microtask-deferred setState when its internal i18next subscription
// registers on mount; the deferred update fires AFTER the synchronous
// render's act() wrapper closes, so React emits "An update to
// <Component> was not wrapped in act(...)". `await act(async () =>
// { ... })` flushes pending microtasks before the act block resolves,
// absorbing the deferred update inside the wrapper.
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  // `act` takes the async (microtask-flushing) path when the callback
  // returns a thenable — `return Promise.resolve()` is enough; no
  // `async` keyword (which would trip `require-await` since the body
  // does not await anything).
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

async function renderWithRoute(): Promise<RenderResult> {
  function RouteHost(): ReactElement {
    return <InterpretiveSplitModeExitButton />;
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

describe('InterpretiveSplitModeExitButton — render gating', () => {
  it('renders null when mode is idle', async () => {
    const { container } = await renderWithRoute();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('interpretive-split-mode-exit')).toBeNull();
  });

  it('renders null when mode is decompose (does NOT cross-bleed across the two structural-restructure modes)', async () => {
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.queryByTestId('interpretive-split-mode-exit')).toBeNull();
  });

  it('renders the button + overlay when mode is interpretive-split and a matching node-created event exists', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode(NODE_A);
    });
    await renderWithRoute();

    const button = screen.getByTestId('interpretive-split-mode-exit');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Exit interpretive split mode');
    expect(button.getAttribute('title')).toBe('Cancel interpretive split (Esc)');
    const overlay = screen.getByTestId('interpretive-split-mode-target-wording');
    expect(overlay.textContent).toBe('Splitting parent wording');
  });
});

describe('InterpretiveSplitModeExitButton — exit gestures', () => {
  it('clicking the button calls exitInterpretiveSplitMode and unmounts the button', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.getByTestId('interpretive-split-mode-exit')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('interpretive-split-mode-exit'));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBeNull();
    expect(screen.queryByTestId('interpretive-split-mode-exit')).toBeNull();
  });

  it('Escape keypress fires exitInterpretiveSplitMode while mode is interpretive-split', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterInterpretiveSplitMode(NODE_A);
    });
    await renderWithRoute();
    expect(useCaptureStore.getState().mode).toBe('interpretive-split');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().interpretiveSplitTargetNodeId).toBeNull();
  });
});

describe('InterpretiveSplitModeExitButton — i18n locale parity', () => {
  const cases = [
    {
      locale: 'en-US',
      ariaLabel: 'Exit interpretive split mode',
      tooltip: 'Cancel interpretive split (Esc)',
      overlay: 'Splitting parent wording',
    },
    {
      locale: 'pt-BR',
      ariaLabel: 'Sair do modo de divisão interpretativa',
      tooltip: 'Cancelar divisão interpretativa (Esc)',
      overlay: 'Dividindo parent wording',
    },
    {
      locale: 'es-419',
      ariaLabel: 'Salir del modo de división interpretativa',
      tooltip: 'Cancelar división interpretativa (Esc)',
      overlay: 'Dividiendo parent wording',
    },
  ] as const;

  for (const { locale, ariaLabel, tooltip, overlay } of cases) {
    it(`${locale} — aria-label / tooltip / overlay resolve to localized strings`, async () => {
      await i18next.changeLanguage(locale);
      useWsStore
        .getState()
        .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
      act(() => {
        useCaptureStore.getState().enterInterpretiveSplitMode(NODE_A);
      });
      await renderWithRoute();

      const button = screen.getByTestId('interpretive-split-mode-exit');
      expect(button.getAttribute('aria-label')).toBe(ariaLabel);
      expect(button.getAttribute('title')).toBe(tooltip);
      expect(screen.getByTestId('interpretive-split-mode-target-wording').textContent).toBe(
        overlay,
      );
      // No trailing `await i18next.changeLanguage('en-US')` — `beforeEach`
      // already resets the language for the next case, and triggering a
      // language change on a still-mounted component here would fire a
      // setState outside an act(...) wrapper.
    });
  }
});
