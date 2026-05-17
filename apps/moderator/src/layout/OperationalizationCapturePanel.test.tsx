// Tests for `<OperationalizationCapturePanel>` — operationalization-
// mode capture surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_operationalization_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Pins the prompt-question + guidance + target-wording overlay + the
// transcription textarea (with `MAX_METHODOLOGY_TEXT_LENGTH` clamp) +
// the five action chips (all disabled, all carrying the stable
// `data-operationalization-route` seam for the F5 / F6 / F7 wirings).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { MAX_METHODOLOGY_TEXT_LENGTH, type Event } from '@a-conversa/shared-types';

import {
  OperationalizationCapturePanel,
  OPERATIONALIZATION_ROUTES,
} from './OperationalizationCapturePanel';
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
      created_at: '2026-05-11T00:00:00.000Z',
    },
    createdAt: '2026-05-11T00:00:00.000Z',
  };
}

function renderWithRoute(): ReturnType<typeof render> {
  function RouteHost(): ReactElement {
    return <OperationalizationCapturePanel />;
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

describe('OperationalizationCapturePanel — render gating', () => {
  const nonMatchingModes: readonly CaptureMode[] = [
    'idle',
    'capture-statement',
    'decompose',
    'interpretive-split',
    'capture-defeater',
    'warrant-elicitation',
    'meta-move',
    'axiom-mark',
  ];
  for (const m of nonMatchingModes) {
    it(`renders null when mode is ${m}`, () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      const { container } = renderWithRoute();
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('operationalization-capture-panel')).toBeNull();
    });
  }

  it('renders the panel root with the target-node-id seam when mode is operationalization', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const root = screen.getByTestId('operationalization-capture-panel');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-operationalization-target-node-id')).toBe(NODE_A);
  });
});

describe('OperationalizationCapturePanel — prompt + guidance + target wording', () => {
  it('renders the localized prompt question header', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    expect(screen.getByTestId('operationalization-prompt-question').textContent).toBe(
      'What evidence would change your mind on this?',
    );
  });

  it('renders the localized guidance row', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const guidance = screen.getByTestId('operationalization-prompt-guidance');
    expect(guidance.textContent).toContain('Empirical evidence');
    expect(guidance.textContent).toContain('axiom-mark');
  });

  it('renders the target-wording overlay when the events log carries a matching node-created event', () => {
    useWsStore
      .getState()
      .applyEvent(
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'the disputed wording' }),
      );
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const overlay = screen.getByTestId('operationalization-target-wording');
    expect(overlay.textContent).toBe('Operationalizing: the disputed wording');
  });

  it('renders no target-wording overlay when the events log lacks a matching node-created event (resolver-tolerance)', () => {
    // The resolver returns `null` when there is no matching event; the
    // panel renders no overlay (mirrors `<ProposalModeExitAffordance>`
    // tolerance — the staleness window between the moderator entering
    // the mode and the events log catching up is rendered as silence).
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    expect(screen.queryByTestId('operationalization-target-wording')).toBeNull();
  });
});

describe('OperationalizationCapturePanel — transcription textarea', () => {
  it('typing into the textarea updates its value', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const textarea = screen.getByTestId<HTMLTextAreaElement>('operationalization-answer-textarea');
    expect(textarea.value).toBe('');
    act(() => {
      fireEvent.change(textarea, { target: { value: 'the participant said: nothing' } });
    });
    expect(
      screen.getByTestId<HTMLTextAreaElement>('operationalization-answer-textarea').value,
    ).toBe('the participant said: nothing');
  });

  it('clamps over-long input to MAX_METHODOLOGY_TEXT_LENGTH (defensive paste-bypass)', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const textarea = screen.getByTestId<HTMLTextAreaElement>('operationalization-answer-textarea');
    const oversize = 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 50);
    act(() => {
      fireEvent.change(textarea, { target: { value: oversize } });
    });
    expect(
      screen.getByTestId<HTMLTextAreaElement>('operationalization-answer-textarea').value.length,
    ).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
  });
});

describe('OperationalizationCapturePanel — action chips', () => {
  it('renders all five action chips in canonical order, each disabled + aria-disabled, each carrying the data-operationalization-route seam', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const actions = screen.getByTestId('operationalization-actions');
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((b) => b.getAttribute('data-operationalization-route'))).toEqual([
      'route-axiom-mark',
      'route-defeater',
      'route-reclassify',
      'route-decompose',
      'route-no-signal',
    ]);
    // The exported canonical order matches the rendered DOM order.
    expect(buttons.map((b) => b.getAttribute('data-operationalization-route'))).toEqual([
      ...OPERATIONALIZATION_ROUTES,
    ]);
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('clicking an action chip is a no-op (mode does not change — placeholder discipline)', () => {
    act(() => {
      useCaptureStore.getState().enterOperationalizationMode(NODE_A);
    });
    renderWithRoute();
    const before = useCaptureStore.getState().mode;
    expect(before).toBe('operationalization');
    for (const route of OPERATIONALIZATION_ROUTES) {
      act(() => {
        fireEvent.click(screen.getByTestId(`operationalization-action-${route}`));
      });
      expect(useCaptureStore.getState().mode).toBe('operationalization');
    }
  });
});

describe('OperationalizationCapturePanel — i18n locale parity', () => {
  interface LocaleExpectations {
    locale: 'en-US' | 'pt-BR' | 'es-419';
    question: string;
    placeholder: string;
    actions: Record<(typeof OPERATIONALIZATION_ROUTES)[number], string>;
  }

  const cases: readonly LocaleExpectations[] = [
    {
      locale: 'en-US',
      question: 'What evidence would change your mind on this?',
      placeholder: "Type the participant's verbal answer...",
      actions: {
        'route-axiom-mark': 'Mark as axiom',
        'route-defeater': 'Capture as defeater',
        'route-reclassify': 'Re-classify',
        'route-decompose': 'Decompose',
        'route-no-signal': 'No signal yet',
      },
    },
    {
      locale: 'pt-BR',
      question: 'Que evidência mudaria sua opinião sobre isso?',
      placeholder: 'Digite a resposta verbal do participante...',
      actions: {
        'route-axiom-mark': 'Marcar como axioma',
        'route-defeater': 'Capturar como refutação',
        'route-reclassify': 'Reclassificar',
        'route-decompose': 'Decompor',
        'route-no-signal': 'Sem sinal ainda',
      },
    },
    {
      locale: 'es-419',
      question: '¿Qué evidencia cambiaría tu opinión sobre esto?',
      placeholder: 'Escribe la respuesta verbal del participante...',
      actions: {
        'route-axiom-mark': 'Marcar como axioma',
        'route-defeater': 'Capturar como refutación',
        'route-reclassify': 'Reclasificar',
        'route-decompose': 'Descomponer',
        'route-no-signal': 'Sin señal aún',
      },
    },
  ];

  for (const { locale, question, placeholder, actions } of cases) {
    it(`${locale} — prompt + placeholder + every action chip label resolve to localized strings`, async () => {
      await i18next.changeLanguage(locale);
      act(() => {
        useCaptureStore.getState().enterOperationalizationMode(NODE_A);
      });
      renderWithRoute();

      expect(screen.getByTestId('operationalization-prompt-question').textContent).toBe(question);
      const textarea = screen.getByTestId('operationalization-answer-textarea');
      expect(textarea.getAttribute('placeholder')).toBe(placeholder);
      expect(textarea.getAttribute('aria-label')).toBe(placeholder);
      for (const route of OPERATIONALIZATION_ROUTES) {
        expect(screen.getByTestId(`operationalization-action-${route}`).textContent).toBe(
          actions[route],
        );
      }

      // Sanity: in non-en-US locales, the strings differ from the en-US
      // baselines (catches a missing per-locale translation).
      if (locale !== 'en-US') {
        expect(question).not.toBe('What evidence would change your mind on this?');
      }

      await i18next.changeLanguage('en-US');
    });
  }
});
