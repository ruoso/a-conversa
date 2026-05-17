// Tests for `<WarrantElicitationCapturePanel>` — warrant-elicitation-
// mode capture surface.
//
// Refinement: tasks/refinements/moderator-ui/mod_warrant_elicitation_mode.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Pins the ICU-templated prompt-question (with `{nodeWording}`
// interpolation + generic-prompt fallback per Decision §D5) + guidance +
// target-wording overlay + the transcription textarea (with
// `MAX_METHODOLOGY_TEXT_LENGTH` clamp) + the three warrant-shape action
// chips (all disabled, all carrying the stable
// `data-warrant-elicitation-route` seam for the F2 / F4 / F7 wirings).

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
import { MAX_METHODOLOGY_TEXT_LENGTH, type Event } from '@a-conversa/shared-types';

import {
  WarrantElicitationCapturePanel,
  WARRANT_ELICITATION_ROUTES,
} from './WarrantElicitationCapturePanel';
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
    return <WarrantElicitationCapturePanel />;
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

describe('WarrantElicitationCapturePanel — render gating', () => {
  const nonMatchingModes: readonly CaptureMode[] = [
    'idle',
    'capture-statement',
    'decompose',
    'interpretive-split',
    'capture-defeater',
    'operationalization',
    'meta-move',
    'axiom-mark',
  ];
  for (const m of nonMatchingModes) {
    it(`renders null when mode is ${m}`, async () => {
      act(() => {
        useCaptureStore.setState({ mode: m });
      });
      const { container } = await renderWithRoute();
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId('warrant-elicitation-capture-panel')).toBeNull();
    });
  }

  it('renders the panel root with the target-node-id seam when mode is warrant-elicitation', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const root = screen.getByTestId('warrant-elicitation-capture-panel');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-warrant-elicitation-target-node-id')).toBe(NODE_A);
  });
});

describe('WarrantElicitationCapturePanel — prompt + guidance + target wording', () => {
  it('renders the ICU-templated prompt question header with the target wording interpolated when the events log carries a matching node-created event', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'the disputed claim' }));
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.getByTestId('warrant-elicitation-prompt-question').textContent).toBe(
      'What\'s the unstated bridge from "the disputed claim" to your conclusion?',
    );
  });

  it('falls back to the generic prompt question when the events log lacks a matching node-created event (resolver-tolerance, Decision §D5)', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.getByTestId('warrant-elicitation-prompt-question').textContent).toBe(
      "What's the unstated bridge from the target to your conclusion?",
    );
  });

  it('renders the localized guidance row', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const guidance = screen.getByTestId('warrant-elicitation-prompt-guidance');
    expect(guidance.textContent).toContain('bridges-from');
    expect(guidance.textContent).toContain('bridges-to');
  });

  it('renders the target-wording overlay when the events log carries a matching node-created event', async () => {
    useWsStore
      .getState()
      .applyEvent(makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'the disputed claim' }));
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const overlay = screen.getByTestId('warrant-elicitation-target-wording');
    expect(overlay.textContent).toBe('Eliciting warrant for: the disputed claim');
  });

  it('renders no target-wording overlay when the events log lacks a matching node-created event (resolver-tolerance)', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    expect(screen.queryByTestId('warrant-elicitation-target-wording')).toBeNull();
  });
});

describe('WarrantElicitationCapturePanel — transcription textarea', () => {
  it('typing into the textarea updates its value', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const textarea = screen.getByTestId<HTMLTextAreaElement>('warrant-elicitation-answer-textarea');
    expect(textarea.value).toBe('');
    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'the unstated bridge is: minimum-wage workers spend their wages locally' },
      });
    });
    expect(
      screen.getByTestId<HTMLTextAreaElement>('warrant-elicitation-answer-textarea').value,
    ).toBe('the unstated bridge is: minimum-wage workers spend their wages locally');
  });

  it('clamps over-long input to MAX_METHODOLOGY_TEXT_LENGTH (defensive paste-bypass)', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const textarea = screen.getByTestId<HTMLTextAreaElement>('warrant-elicitation-answer-textarea');
    const oversize = 'x'.repeat(MAX_METHODOLOGY_TEXT_LENGTH + 50);
    act(() => {
      fireEvent.change(textarea, { target: { value: oversize } });
    });
    expect(
      screen.getByTestId<HTMLTextAreaElement>('warrant-elicitation-answer-textarea').value.length,
    ).toBe(MAX_METHODOLOGY_TEXT_LENGTH);
  });
});

describe('WarrantElicitationCapturePanel — action chips', () => {
  it('renders all three action chips in canonical order, each disabled + aria-disabled, each carrying the data-warrant-elicitation-route seam', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const actions = screen.getByTestId('warrant-elicitation-actions');
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((b) => b.getAttribute('data-warrant-elicitation-route'))).toEqual([
      'route-create-warrant-node',
      'route-decompose-claim',
      'route-defer',
    ]);
    // The exported canonical order matches the rendered DOM order.
    expect(buttons.map((b) => b.getAttribute('data-warrant-elicitation-route'))).toEqual([
      ...WARRANT_ELICITATION_ROUTES,
    ]);
    for (const button of buttons) {
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('clicking an action chip is a no-op (mode does not change — placeholder discipline)', async () => {
    act(() => {
      useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
    });
    await renderWithRoute();
    const before = useCaptureStore.getState().mode;
    expect(before).toBe('warrant-elicitation');
    for (const route of WARRANT_ELICITATION_ROUTES) {
      act(() => {
        fireEvent.click(screen.getByTestId(`warrant-elicitation-action-${route}`));
      });
      expect(useCaptureStore.getState().mode).toBe('warrant-elicitation');
    }
  });
});

describe('WarrantElicitationCapturePanel — i18n locale parity', () => {
  interface LocaleExpectations {
    locale: 'en-US' | 'pt-BR' | 'es-419';
    questionTemplated: string;
    questionGeneric: string;
    placeholder: string;
    actions: Record<(typeof WARRANT_ELICITATION_ROUTES)[number], string>;
  }

  const cases: readonly LocaleExpectations[] = [
    {
      locale: 'en-US',
      questionTemplated:
        'What\'s the unstated bridge from "the disputed claim" to your conclusion?',
      questionGeneric: "What's the unstated bridge from the target to your conclusion?",
      placeholder: "Type the participant's articulated bridge...",
      actions: {
        'route-create-warrant-node': 'Create warrant node',
        'route-decompose-claim': 'Decompose the claim',
        'route-defer': 'Defer — no clear bridge',
      },
    },
    {
      locale: 'pt-BR',
      questionTemplated:
        'Qual é a ponte não declarada de "the disputed claim" para a sua conclusão?',
      questionGeneric: 'Qual é a ponte não declarada do alvo para a sua conclusão?',
      placeholder: 'Digite a ponte articulada pelo participante...',
      actions: {
        'route-create-warrant-node': 'Criar nó de garantia',
        'route-decompose-claim': 'Decompor a alegação',
        'route-defer': 'Adiar — sem ponte clara',
      },
    },
    {
      locale: 'es-419',
      questionTemplated:
        '¿Cuál es el puente no declarado de "the disputed claim" hasta tu conclusión?',
      questionGeneric: '¿Cuál es el puente no declarado del objetivo hasta tu conclusión?',
      placeholder: 'Escribe el puente articulado por el participante...',
      actions: {
        'route-create-warrant-node': 'Crear nodo de garantía',
        'route-decompose-claim': 'Descomponer la afirmación',
        'route-defer': 'Aplazar — sin puente claro',
      },
    },
  ];

  for (const { locale, questionTemplated, questionGeneric, placeholder, actions } of cases) {
    it(`${locale} — prompts + placeholder + every action chip label resolve to localized strings`, async () => {
      await i18next.changeLanguage(locale);
      useWsStore
        .getState()
        .applyEvent(
          makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'the disputed claim' }),
        );
      act(() => {
        useCaptureStore.getState().enterWarrantElicitationMode(NODE_A);
      });
      await renderWithRoute();

      expect(screen.getByTestId('warrant-elicitation-prompt-question').textContent).toBe(
        questionTemplated,
      );
      const textarea = screen.getByTestId('warrant-elicitation-answer-textarea');
      expect(textarea.getAttribute('placeholder')).toBe(placeholder);
      expect(textarea.getAttribute('aria-label')).toBe(placeholder);
      for (const route of WARRANT_ELICITATION_ROUTES) {
        expect(screen.getByTestId(`warrant-elicitation-action-${route}`).textContent).toBe(
          actions[route],
        );
      }

      // Sanity: in non-en-US locales, the strings differ from the en-US
      // baselines (catches a missing per-locale translation).
      if (locale !== 'en-US') {
        expect(questionTemplated).not.toBe(
          'What\'s the unstated bridge from "the disputed claim" to your conclusion?',
        );
        expect(questionGeneric).not.toBe(
          "What's the unstated bridge from the target to your conclusion?",
        );
      }

      // No trailing `await i18next.changeLanguage('en-US')` — `beforeEach`
      // already resets the language for the next case, and triggering a
      // language change on a still-mounted component here would fire a
      // setState outside an act(...) wrapper.
    });
  }
});
