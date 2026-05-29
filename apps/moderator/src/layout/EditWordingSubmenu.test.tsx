// Tests for `<EditWordingSubmenu>` — the edit-wording submenu the
// node context menu's `propose-edit-wording` item opens.
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//
//   1. **Renders the pre-filled textarea + two radio choices + submit
//      button + (when set) the inline error region.**
//   2. **Click submit → propose(newWording, editKind)** — the hook
//      receives exactly the typed wording + selected edit kind.
//   3. **Inline error region** — surfaces on `lastError`; resolves
//      through the catalog.
//   4. **No default edit-kind** — submit stays disabled until the
//      moderator picks one; methodologically the choice must be explicit.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import i18next from 'i18next';

import { EditWordingSubmenu, resolveEditWordingErrorMessage } from './EditWordingSubmenu';
import {
  resetEditWordingStore,
  type UseEditWordingActionResult,
  type WireError,
} from './useEditWordingAction';
import { WsClientProvider } from '@a-conversa/shell';
import type { WsClient, WsClientStatus } from '@a-conversa/shell';
import { createI18nInstance } from '@a-conversa/shell';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NODE_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  await createI18nInstance('en-US');
});

beforeEach(async () => {
  await i18next.changeLanguage('en-US');
  resetEditWordingStore();
});

afterEach(() => {
  cleanup();
});

function makeStubClient(): WsClient {
  return {
    status: (): WsClientStatus => 'open',
    connect: (): void => undefined,
    close: (): void => undefined,
    killWebSocket: (): void => undefined,
    send: () => new Promise(() => undefined),
    trackSession: () => Promise.resolve(),
    untrackSession: () => Promise.resolve(),
    onEnvelope: () => () => undefined,
    url: '/api/ws',
  };
}

function wrap(children: ReactNode): ReactElement {
  return (
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/operate`]}>
      <WsClientProvider auth={{ status: 'authenticated' }} client={makeStubClient()}>
        <Routes>
          <Route path="/sessions/:id/operate" element={children} />
        </Routes>
      </WsClientProvider>
    </MemoryRouter>
  );
}

function makeHookOverride(opts?: {
  propose?: (newWording: string, editKind: 'reword' | 'restructure') => Promise<void>;
  inFlight?: boolean;
  lastError?: WireError | undefined;
}): UseEditWordingActionResult {
  return {
    propose: opts?.propose ?? (() => Promise.resolve()),
    inFlight: opts?.inFlight ?? false,
    lastError: opts?.lastError,
  };
}

describe('resolveEditWordingErrorMessage — error-code mapping', () => {
  const t = (key: string): string => `T:${key}`;

  it('maps target-entity-not-found → catalog targetNotFound message', () => {
    expect(
      resolveEditWordingErrorMessage({ code: 'target-entity-not-found', message: 'raw' }, t),
    ).toBe('T:moderator.editWordingAction.errorBanner.targetNotFound');
  });

  it('maps illegal-state-transition → catalog illegalStateTransition message', () => {
    expect(
      resolveEditWordingErrorMessage({ code: 'illegal-state-transition', message: 'raw' }, t),
    ).toBe('T:moderator.editWordingAction.errorBanner.illegalStateTransition');
  });

  it('maps timeout → catalog timeout message', () => {
    expect(resolveEditWordingErrorMessage({ code: 'timeout', message: 'whatever' }, t)).toBe(
      'T:moderator.editWordingAction.errorBanner.timeout',
    );
  });

  it('unmapped code with a non-empty message → message verbatim', () => {
    expect(
      resolveEditWordingErrorMessage({ code: 'unknown', message: 'something went wrong' }, t),
    ).toBe('something went wrong');
  });

  it('unmapped code with an empty message → catalog unknown message', () => {
    expect(resolveEditWordingErrorMessage({ code: 'unknown', message: '' }, t)).toBe(
      'T:moderator.editWordingAction.errorBanner.unknown',
    );
  });
});

describe('EditWordingSubmenu — render shape', () => {
  it('renders the header from the catalog', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="The current wording"
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.getByTestId('edit-wording-submenu-header').textContent).toBe('Edit wording');
  });

  it('renders the textarea pre-filled with the current wording', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="The current wording"
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('edit-wording-submenu-input');
    expect(textarea.value).toBe('The current wording');
  });

  it('renders both edit-kind radio buttons with no default selection', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const reword = screen.getByTestId('edit-wording-submenu-edit-kind-reword');
    const restructure = screen.getByTestId('edit-wording-submenu-edit-kind-restructure');
    expect(reword.getAttribute('aria-checked')).toBe('false');
    expect(restructure.getAttribute('aria-checked')).toBe('false');
    expect(reword.getAttribute('data-selected')).toBe('false');
    expect(restructure.getAttribute('data-selected')).toBe('false');
  });

  it('renders the submit button (disabled until an edit kind is picked)', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="some text"
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const submit = screen.getByTestId<HTMLButtonElement>('edit-wording-submenu-submit');
    expect(submit.disabled).toBe(true);
  });

  it('stamps the bound nodeId on the menu root for downstream tests', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const root = screen.getByTestId('edit-wording-submenu');
    expect(root.getAttribute('data-node-id')).toBe(NODE_ID);
  });
});

describe('EditWordingSubmenu — submit behavior', () => {
  it('clicking submit fires propose with the typed wording + selected edit kind (reword)', () => {
    const propose = vi.fn(() => Promise.resolve());
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="The original"
          onClose={() => undefined}
          hookOverride={makeHookOverride({ propose })}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('edit-wording-submenu-input');
    fireEvent.change(textarea, { target: { value: 'A clearer wording' } });
    fireEvent.click(screen.getByTestId('edit-wording-submenu-edit-kind-reword'));
    fireEvent.click(screen.getByTestId('edit-wording-submenu-submit'));
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith('A clearer wording', 'reword');
  });

  it('clicking submit fires propose with restructure when restructure is picked', () => {
    const propose = vi.fn(() => Promise.resolve());
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="The original"
          onClose={() => undefined}
          hookOverride={makeHookOverride({ propose })}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('edit-wording-submenu-input');
    fireEvent.change(textarea, { target: { value: 'A different claim' } });
    fireEvent.click(screen.getByTestId('edit-wording-submenu-edit-kind-restructure'));
    fireEvent.click(screen.getByTestId('edit-wording-submenu-submit'));
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith('A different claim', 'restructure');
  });

  it('trims surrounding whitespace from the wording before forwarding it', () => {
    const propose = vi.fn(() => Promise.resolve());
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride({ propose })}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('edit-wording-submenu-input');
    fireEvent.change(textarea, { target: { value: '   padded text   ' } });
    fireEvent.click(screen.getByTestId('edit-wording-submenu-edit-kind-reword'));
    fireEvent.click(screen.getByTestId('edit-wording-submenu-submit'));
    expect(propose).toHaveBeenCalledWith('padded text', 'reword');
  });

  it('submit stays disabled while inFlight is true', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording="The original"
          onClose={() => undefined}
          hookOverride={makeHookOverride({ inFlight: true })}
        />,
      ),
    );
    const submit = screen.getByTestId<HTMLButtonElement>('edit-wording-submenu-submit');
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('data-edit-wording-state')).toBe('in-flight');
  });

  it('submit stays disabled when only whitespace is in the textarea', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('edit-wording-submenu-input');
    fireEvent.change(textarea, { target: { value: '    ' } });
    fireEvent.click(screen.getByTestId('edit-wording-submenu-edit-kind-reword'));
    const submit = screen.getByTestId<HTMLButtonElement>('edit-wording-submenu-submit');
    expect(submit.disabled).toBe(true);
  });
});

describe('EditWordingSubmenu — inline error region', () => {
  it('renders the error region with the localized illegalStateTransition message', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride({
            lastError: { code: 'illegal-state-transition', message: 'raw wire' },
          })}
        />,
      ),
    );
    const errorRegion = screen.getByTestId('edit-wording-submenu-error');
    expect(errorRegion.textContent).toBe(
      'Cannot edit this wording right now — another edit / decompose / split may be pending',
    );
    expect(errorRegion.getAttribute('data-error-code')).toBe('illegal-state-transition');
  });

  it('does not render the error region when lastError is undefined', () => {
    render(
      wrap(
        <EditWordingSubmenu
          nodeId={NODE_ID}
          x={100}
          y={200}
          currentWording=""
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.queryByTestId('edit-wording-submenu-error')).toBeNull();
  });
});
