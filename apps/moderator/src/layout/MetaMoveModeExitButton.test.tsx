// Tests for `<MetaMoveModeExitButton>` — meta-move-mode exit
// affordance.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
//
// Pins: the mode-gated render contract; the localized aria-label +
// tooltip; the click → exit + Esc → exit gestures.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';

import { MetaMoveModeExitButton } from './MetaMoveModeExitButton';
import { useCaptureStore, type CaptureMode } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

async function render(ui: ReactElement): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui);
    return Promise.resolve();
  });
  return result;
}

async function renderWithRoute(): Promise<RenderResult> {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <Routes>
        <Route path="/sessions/:id/operate" element={<MetaMoveModeExitButton />} />
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

describe('MetaMoveModeExitButton — render gating', () => {
  it('renders null when mode is idle', async () => {
    const { container } = await renderWithRoute();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('meta-move-mode-exit')).toBeNull();
  });

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
    it(`renders null when mode is ${m} (does NOT cross-bleed across modes)`, async () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      await renderWithRoute();
      expect(screen.queryByTestId('meta-move-mode-exit')).toBeNull();
    });
  }

  it('renders the button with localized aria-label + tooltip when mode is meta-move', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
    });
    await renderWithRoute();

    const button = screen.getByTestId('meta-move-mode-exit');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Exit meta-move mode');
    expect(button.getAttribute('title')).toBe('Exit meta-move mode (Esc)');
  });
});

describe('MetaMoveModeExitButton — exit gestures', () => {
  it('clicking the button exits meta-move mode and unmounts the button', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
    });
    await renderWithRoute();
    expect(screen.getByTestId('meta-move-mode-exit')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('meta-move-mode-exit'));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(screen.queryByTestId('meta-move-mode-exit')).toBeNull();
  });

  it('Escape keypress fires exitMetaMoveMode while mode is meta-move', async () => {
    act(() => {
      useCaptureStore.getState().enterMetaMoveMode();
    });
    await renderWithRoute();
    expect(useCaptureStore.getState().mode).toBe('meta-move');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
  });
});
