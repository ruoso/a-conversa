// Tests for `<DecomposeModeExitButton>` — decompose-mode exit
// affordance + target-wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// The component renders nothing when the capture store is NOT in
// decompose mode. When it is, the button surfaces with a localized
// aria-label + tooltip + the target-wording overlay. Click and Escape
// both fire `exitDecomposeMode`.

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

import { DecomposeModeExitButton, resolveDecomposeTargetWording } from './DecomposeModeExitButton';
import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
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

/**
 * Local `render(...)` shadow that wraps every render in an
 * `await act(async () => { ... })`. `useTranslation()` (via
 * `ProposalModeExitAffordance`) schedules a microtask-deferred setState
 * when its internal i18next subscription registers on mount; the
 * deferred update fires AFTER a synchronous render's act() wrapper
 * closes, so React emits "An update to <Component> was not wrapped in
 * act(...)". `await act(async () => { ... })` flushes pending
 * microtasks before the act block resolves, absorbing the deferred
 * update inside the wrapper.
 */
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

/**
 * Render `<DecomposeModeExitButton>` inside a `<MemoryRouter>` that
 * pins the URL to `/sessions/<id>/operate` so the component's
 * `useParams<{ id: string }>` resolves to the seeded SESSION_ID.
 */
async function renderWithRoute(): Promise<RenderResult> {
  function RouteHost(): ReactElement {
    return <DecomposeModeExitButton />;
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

describe('resolveDecomposeTargetWording — events-log walk', () => {
  it('returns null when nodeId is null', () => {
    expect(resolveDecomposeTargetWording([], null)).toBeNull();
  });

  it('returns null when no matching node-created event exists', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'a wording' }),
    ];
    expect(resolveDecomposeTargetWording(events, NODE_B)).toBeNull();
  });

  it('returns the wording of the matching node-created event', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'first wording' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'second wording' }),
    ];
    expect(resolveDecomposeTargetWording(events, NODE_A)).toBe('first wording');
    expect(resolveDecomposeTargetWording(events, NODE_B)).toBe('second wording');
  });
});

describe('DecomposeModeExitButton — render gating', () => {
  it('renders null when mode is idle', async () => {
    const { container } = await renderWithRoute();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('decompose-mode-exit')).toBeNull();
  });

  it('renders the button + overlay when mode is decompose and a matching node-created event exists', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(NODE_A);
    });
    await renderWithRoute();

    const button = screen.getByTestId('decompose-mode-exit');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-label')).toBe('Exit decompose mode');
    expect(button.getAttribute('title')).toBe('Cancel decomposition (Esc)');
    const overlay = screen.getByTestId('decompose-mode-target-wording');
    expect(overlay.textContent).toBe('Decomposing parent wording');
  });

  it('renders the button with an empty overlay when no matching node-created event exists', async () => {
    // mode === 'decompose' AND decomposeTargetNodeId is set, but the
    // events log doesn't yet contain the matching node-created event
    // (the defended-against transient inconsistency).
    act(() => {
      useCaptureStore.getState().enterDecomposeMode('not-in-events');
    });
    await renderWithRoute();

    expect(screen.getByTestId('decompose-mode-exit')).toBeTruthy();
    const overlay = screen.getByTestId('decompose-mode-target-wording');
    expect(overlay.textContent).toBe('');
  });
});

describe('DecomposeModeExitButton — exit gestures', () => {
  it('clicking the button calls exitDecomposeMode and unmounts the button', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.getByTestId('decompose-mode-exit')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('decompose-mode-exit'));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();
    expect(screen.queryByTestId('decompose-mode-exit')).toBeNull();
  });

  it('Escape keypress fires exitDecomposeMode while mode is decompose', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'w' }));
    act(() => {
      useCaptureStore.getState().enterDecomposeMode(NODE_A);
    });
    await renderWithRoute();
    expect(useCaptureStore.getState().mode).toBe('decompose');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useCaptureStore.getState().mode).toBe('idle');
    expect(useCaptureStore.getState().decomposeTargetNodeId).toBeNull();
  });
});

describe('DecomposeModeExitButton — i18n locale parity', () => {
  const cases = [
    {
      locale: 'en-US',
      ariaLabel: 'Exit decompose mode',
      tooltip: 'Cancel decomposition (Esc)',
      overlay: 'Decomposing parent wording',
    },
    {
      locale: 'pt-BR',
      ariaLabel: 'Sair do modo de decomposição',
      tooltip: 'Cancelar decomposição (Esc)',
      overlay: 'Decompondo parent wording',
    },
    {
      locale: 'es-419',
      ariaLabel: 'Salir del modo de descomposición',
      tooltip: 'Cancelar descomposición (Esc)',
      overlay: 'Descomponiendo parent wording',
    },
  ] as const;

  for (const { locale, ariaLabel, tooltip, overlay } of cases) {
    it(`${locale} — aria-label / tooltip / overlay resolve to localized strings`, async () => {
      await i18next.changeLanguage(locale);
      useWsStore
        .getState()
        .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'parent wording' }));
      act(() => {
        useCaptureStore.getState().enterDecomposeMode(NODE_A);
      });
      await renderWithRoute();

      const button = screen.getByTestId('decompose-mode-exit');
      expect(button.getAttribute('aria-label')).toBe(ariaLabel);
      expect(button.getAttribute('title')).toBe(tooltip);
      expect(screen.getByTestId('decompose-mode-target-wording').textContent).toBe(overlay);

      // Restore en-US for downstream tests. Wrapped in act(...) because
      // the still-mounted `<ProposalModeExitAffordance>`'s `useTranslation()`
      // subscription schedules a setState in response to the language
      // change; without act() it would fire after `it` resolves but
      // before `afterEach` cleanup, surfacing as an act() warning.
      await act(async () => {
        await i18next.changeLanguage('en-US');
      });
    });
  }

  it('non-en-US strings differ from en-US for every leaf (sanity check on translation, not copy)', async () => {
    await i18next.changeLanguage('en-US');
    const enAria = i18next.t('moderator.decompose.exit.ariaLabel');
    const enTooltip = i18next.t('moderator.decompose.exit.tooltip');
    const enOverlay = i18next.t('moderator.decompose.banner.targetWording', { nodeWording: 'X' });
    for (const locale of ['pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      expect(i18next.t('moderator.decompose.exit.ariaLabel')).not.toBe(enAria);
      expect(i18next.t('moderator.decompose.exit.tooltip')).not.toBe(enTooltip);
      expect(i18next.t('moderator.decompose.banner.targetWording', { nodeWording: 'X' })).not.toBe(
        enOverlay,
      );
    }
    await i18next.changeLanguage('en-US');
  });
});
