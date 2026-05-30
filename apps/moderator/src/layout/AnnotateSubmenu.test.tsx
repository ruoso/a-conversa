// Tests for `<AnnotateSubmenu>` — the annotate submenu the node/edge
// context menu's `annotate` item opens.
//
// Per ADR 0022 these are committed Vitest cases pinning the
// `mod_annotation_kind_tagging` picker lift:
//
//   1. Initial render: the four kind radios are present and the `'note'`
//      default is selected (mirrors the v1 implicit default).
//   2. Click a non-default kind radio — selection flips, only one is
//      checked at a time.
//   3. Submit threads the selected kind into the hook callback.
//   4. Each radio's label resolves through the
//      `methodology.annotationKind.<kind>` catalog (reused — no
//      per-surface duplication).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import i18next from 'i18next';

import { AnnotateSubmenu } from './AnnotateSubmenu';
import {
  resetAnnotateStore,
  type UseAnnotateActionResult,
  type WireError,
} from './useAnnotateAction';
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
  resetAnnotateStore();
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
  annotate?: UseAnnotateActionResult['annotate'];
  inFlight?: boolean;
  lastError?: WireError | undefined;
}): UseAnnotateActionResult {
  return {
    annotate: opts?.annotate ?? (() => Promise.resolve()),
    inFlight: opts?.inFlight ?? false,
    lastError: opts?.lastError,
  };
}

describe('AnnotateSubmenu — kind picker default + selection', () => {
  it('initial render: the `note` radio is aria-checked + data-selected, the other three are not', () => {
    render(
      wrap(
        <AnnotateSubmenu
          targetId={NODE_ID}
          targetKind="node"
          x={100}
          y={200}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const note = screen.getByTestId('annotate-submenu-kind-note');
    const reframe = screen.getByTestId('annotate-submenu-kind-reframe');
    const scope = screen.getByTestId('annotate-submenu-kind-scope-change');
    const stance = screen.getByTestId('annotate-submenu-kind-stance');
    expect(note.getAttribute('aria-checked')).toBe('true');
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(reframe.getAttribute('aria-checked')).toBe('false');
    expect(reframe.getAttribute('data-selected')).toBe('false');
    expect(scope.getAttribute('aria-checked')).toBe('false');
    expect(scope.getAttribute('data-selected')).toBe('false');
    expect(stance.getAttribute('aria-checked')).toBe('false');
    expect(stance.getAttribute('data-selected')).toBe('false');
  });

  it('clicking the `reframe` radio flips selection (only one is checked at a time)', () => {
    render(
      wrap(
        <AnnotateSubmenu
          targetId={NODE_ID}
          targetKind="node"
          x={100}
          y={200}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    const note = screen.getByTestId('annotate-submenu-kind-note');
    const reframe = screen.getByTestId('annotate-submenu-kind-reframe');
    fireEvent.click(reframe);
    expect(reframe.getAttribute('aria-checked')).toBe('true');
    expect(reframe.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('aria-checked')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('false');
  });
});

describe('AnnotateSubmenu — submit threading', () => {
  it('after typing content + clicking the `reframe` radio + Submit, the hook is called with (content, "reframe")', () => {
    const annotate = vi.fn(() => Promise.resolve());
    render(
      wrap(
        <AnnotateSubmenu
          targetId={NODE_ID}
          targetKind="node"
          x={100}
          y={200}
          onClose={() => undefined}
          hookOverride={makeHookOverride({ annotate })}
        />,
      ),
    );
    const textarea = screen.getByTestId<HTMLTextAreaElement>('annotate-submenu-input');
    fireEvent.change(textarea, { target: { value: 'a reframe thought' } });
    fireEvent.click(screen.getByTestId('annotate-submenu-kind-reframe'));
    fireEvent.click(screen.getByTestId('annotate-submenu-submit'));
    expect(annotate).toHaveBeenCalledTimes(1);
    expect(annotate).toHaveBeenCalledWith('a reframe thought', 'reframe');
  });
});

describe('AnnotateSubmenu — kind label catalog binding', () => {
  it('each radio renders the matching methodology.annotationKind.<kind> catalog string (en-US)', () => {
    render(
      wrap(
        <AnnotateSubmenu
          targetId={NODE_ID}
          targetKind="node"
          x={100}
          y={200}
          onClose={() => undefined}
          hookOverride={makeHookOverride()}
        />,
      ),
    );
    expect(screen.getByTestId('annotate-submenu-kind-note').textContent).toBe('Note');
    expect(screen.getByTestId('annotate-submenu-kind-reframe').textContent).toBe('Reframe');
    expect(screen.getByTestId('annotate-submenu-kind-scope-change').textContent).toBe(
      'Scope change',
    );
    expect(screen.getByTestId('annotate-submenu-kind-stance').textContent).toBe('Stance');
    expect(screen.getByTestId('annotate-submenu-kind-legend').textContent).toBe('Kind');
  });
});
