// Tests for `<GraphContextMenu>` — the right-click action menu on the
// moderator's graph canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_context_menus.md
//
// Per ADR 0022 these are committed Vitest cases, not throwaway probes.
// They lock in:
//
//   1. The menu renders at the requested `{ x, y }` cursor coordinates
//      via `position: fixed`.
//   2. Every item in the `items` array renders as a `<button>` carrying
//      `data-testid="graph-context-menu-item-<id>"` and the localized
//      label from `t(item.labelKey)`.
//   3. Clicking a menu item fires the item's `onSelect` THEN `onClose`
//      (the menu closes after the action).
//   4. Click-outside (a `mousedown` outside the menu element) calls
//      `onClose`.
//   5. Click-inside (a `mousedown` ON the menu) does NOT call `onClose`.
//   6. Escape calls `onClose`.
//   7. Each menu item's label resolves to the catalog-correct string for
//      en-US, pt-BR, and es-419 — the localized-label parity check.
//   8. The `data-target-kind` and `data-target-id` attributes are
//      stamped on the menu root so tests can assert what the open menu
//      targets.
//
// The component reads `useTranslation` for labels; tests bootstrap
// i18next via `createI18nInstance('en-US')` and switch locales with
// `i18next.changeLanguage` for the parity cases.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';

import { GraphContextMenu, type MenuItem } from './GraphContextMenu';
import { createI18nInstance } from '@a-conversa/shell';

// Async render shadow: `useTranslation()` schedules a microtask-deferred
// setState on mount; `await act(async () => ...)` flushes it inside the
// wrapper so React doesn't emit act() warnings.
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

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

function makeItems(onSelectSpy?: (id: string) => void): MenuItem[] {
  return [
    {
      id: 'propose-vote',
      labelKey: 'moderator.contextMenu.node.proposeVote',
      onSelect: () => onSelectSpy?.('propose-vote'),
    },
    {
      id: 'annotate',
      labelKey: 'moderator.contextMenu.node.annotate',
      onSelect: () => onSelectSpy?.('annotate'),
    },
  ];
}

describe('GraphContextMenu — rendering', () => {
  it('renders at the requested {x, y} via position: fixed', async () => {
    await render(
      <GraphContextMenu
        x={123}
        y={456}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={() => undefined}
      />,
    );
    const root = screen.getByTestId('graph-context-menu');
    expect(root.style.position).toBe('fixed');
    expect(root.style.top).toBe('456px');
    expect(root.style.left).toBe('123px');
  });

  it('stamps data-target-kind and data-target-id on the menu root', async () => {
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="edge"
        targetId="edge-42"
        items={makeItems()}
        onClose={() => undefined}
      />,
    );
    const root = screen.getByTestId('graph-context-menu');
    expect(root.getAttribute('data-target-kind')).toBe('edge');
    expect(root.getAttribute('data-target-id')).toBe('edge-42');
  });

  it('stamps an empty data-target-id when targetId is null (pane menu)', async () => {
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="pane"
        targetId={null}
        items={[
          {
            id: 'create-statement',
            labelKey: 'moderator.contextMenu.pane.createStatement',
            onSelect: () => undefined,
          },
        ]}
        onClose={() => undefined}
      />,
    );
    const root = screen.getByTestId('graph-context-menu');
    expect(root.getAttribute('data-target-kind')).toBe('pane');
    expect(root.getAttribute('data-target-id')).toBe('');
  });

  it('renders one button per item with the stable data-testid and localized label', async () => {
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={() => undefined}
      />,
    );
    const voteButton = screen.getByTestId('graph-context-menu-item-propose-vote');
    const annotateButton = screen.getByTestId('graph-context-menu-item-annotate');
    expect(voteButton.tagName).toBe('BUTTON');
    expect(annotateButton.tagName).toBe('BUTTON');
    expect(voteButton.textContent).toBe('Propose vote');
    expect(annotateButton.textContent).toBe('Annotate');
  });
});

describe('GraphContextMenu — item activation', () => {
  it('clicking a menu item fires onSelect then onClose', async () => {
    const onSelectSpy = vi.fn<(id: string) => void>();
    const onClose = vi.fn<() => void>();
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems(onSelectSpy)}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('graph-context-menu-item-propose-vote'));
    expect(onSelectSpy).toHaveBeenCalledOnce();
    expect(onSelectSpy).toHaveBeenCalledWith('propose-vote');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('GraphContextMenu — close behavior', () => {
  it('a window mousedown outside the menu calls onClose', async () => {
    const onClose = vi.fn<() => void>();
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={onClose}
      />,
    );
    // Dispatch a mousedown on document.body — outside the menu. The
    // window-level listener should fire `onClose`.
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a mousedown inside the menu does NOT call onClose', async () => {
    const onClose = vi.fn<() => void>();
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={onClose}
      />,
    );
    // mousedown on the menu root itself — `contains()` returns true,
    // listener should NOT fire onClose.
    fireEvent.mouseDown(screen.getByTestId('graph-context-menu'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape key calls onClose', async () => {
    const onClose = vi.fn<() => void>();
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a non-Escape key does NOT call onClose', async () => {
    const onClose = vi.fn<() => void>();
    await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes window listeners on unmount', async () => {
    const onClose = vi.fn<() => void>();
    const { unmount } = await render(
      <GraphContextMenu
        x={0}
        y={0}
        targetKind="node"
        targetId="n-1"
        items={makeItems()}
        onClose={onClose}
      />,
    );
    unmount();
    // After unmount, neither a window-level mousedown nor an Escape
    // keypress should reach `onClose` — the effect's cleanup must have
    // removed the listeners.
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GraphContextMenu — localized labels (catalog parity)', () => {
  // Per-locale expected labels for each item. Owning these strings here
  // (rather than importing from `@a-conversa/i18n-catalogs`) is the
  // regression assertion — if a catalog entry drifts, this test is
  // what fails. Same pattern as `StatementNode.test.tsx` for the
  // methodology-kind catalog parity check.
  const EXPECTED: Record<string, { 'en-US': string; 'pt-BR': string; 'es-419': string }> = {
    'moderator.contextMenu.node.proposeVote': {
      'en-US': 'Propose vote',
      'pt-BR': 'Propor votação',
      'es-419': 'Proponer votación',
    },
    'moderator.contextMenu.node.proposeDecompose': {
      'en-US': 'Propose decompose',
      'pt-BR': 'Propor decomposição',
      'es-419': 'Proponer descomposición',
    },
    'moderator.contextMenu.node.proposeMetaDisagreement': {
      'en-US': 'Propose meta-disagreement',
      'pt-BR': 'Propor meta-desacordo',
      'es-419': 'Proponer meta-desacuerdo',
    },
    'moderator.contextMenu.node.annotate': {
      'en-US': 'Annotate',
      'pt-BR': 'Anotar',
      'es-419': 'Anotar',
    },
    'moderator.contextMenu.node.axiomMark': {
      'en-US': 'Mark as axiom',
      'pt-BR': 'Marcar como axioma',
      'es-419': 'Marcar como axioma',
    },
    'moderator.contextMenu.edge.proposeVote': {
      'en-US': 'Propose vote',
      'pt-BR': 'Propor votação',
      'es-419': 'Proponer votación',
    },
    'moderator.contextMenu.edge.proposeMetaDisagreement': {
      'en-US': 'Propose meta-disagreement',
      'pt-BR': 'Propor meta-desacordo',
      'es-419': 'Proponer meta-desacuerdo',
    },
    'moderator.contextMenu.edge.annotate': {
      'en-US': 'Annotate',
      'pt-BR': 'Anotar',
      'es-419': 'Anotar',
    },
    'moderator.contextMenu.pane.createStatement': {
      'en-US': 'Create new statement',
      'pt-BR': 'Criar nova afirmação',
      'es-419': 'Crear nueva afirmación',
    },
  };

  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const [labelKey, expectedPerLocale] of Object.entries(EXPECTED)) {
      it(`resolves ${labelKey} to "${expectedPerLocale[locale]}" in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        // Encode the labelKey as a stable test id — strip the dots so
        // it's a safe data-testid suffix.
        const id = `lbl-${labelKey.replace(/\./g, '_')}`;
        await render(
          <GraphContextMenu
            x={0}
            y={0}
            targetKind="node"
            targetId="n-1"
            items={[{ id, labelKey, onSelect: () => undefined }]}
            onClose={() => undefined}
          />,
        );
        const button = screen.getByTestId(`graph-context-menu-item-${id}`);
        expect(button.textContent).toBe(expectedPerLocale[locale]);
        await act(async () => {
          await i18next.changeLanguage('en-US');
        });
      });
    }
  }
});
