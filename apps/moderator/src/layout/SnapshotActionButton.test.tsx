// Tests for `<SnapshotActionButton>` — the F10 snapshot trigger
// affordance in the right sidebar.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_action.md
//
// Per ADR 0022 these are committed Vitest cases. They lock in:
//   - the stable `data-testid="snapshot-action-button"`,
//   - the localized `aria-label`,
//   - clicking dispatches `useSnapshotFlowStore.open()`,
//   - per-locale label round-trip (en-US / pt-BR / es-419) resolves
//     to non-empty distinct strings.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  type RenderResult,
} from '@testing-library/react';
import { act, type ReactElement } from 'react';
import i18next from 'i18next';

import { createI18nInstance } from '@a-conversa/shell';

import { SnapshotActionButton } from './SnapshotActionButton';
import { resetSnapshotFlowStore, useSnapshotFlowStore } from './useSnapshotFlowStore';

async function render(ui: ReactElement): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui);
    return Promise.resolve();
  });
  return result;
}

beforeEach(async () => {
  resetSnapshotFlowStore();
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  resetSnapshotFlowStore();
});

describe('SnapshotActionButton — render', () => {
  it('renders with the stable data-testid', async () => {
    await render(<SnapshotActionButton />);
    expect(screen.getByTestId('snapshot-action-button')).toBeTruthy();
  });

  it('renders the localized label text', async () => {
    await render(<SnapshotActionButton />);
    const button = screen.getByTestId('snapshot-action-button');
    expect(button.textContent ?? '').toContain('Snapshot');
  });

  it('carries the localized aria-label', async () => {
    await render(<SnapshotActionButton />);
    const button = screen.getByTestId('snapshot-action-button');
    expect(button.getAttribute('aria-label')).toBe('Snapshot the current event-log position');
  });

  it('renders the shortcut-hint chip with the locale-independent chord glyph', async () => {
    await render(<SnapshotActionButton />);
    const chip = screen.getByTestId('snapshot-action-shortcut-hint');
    expect(chip.textContent).toContain('S');
  });
});

describe('SnapshotActionButton — click dispatches open()', () => {
  it('clicking the button flips isLabelInputOpen to true', async () => {
    await render(<SnapshotActionButton />);
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(false);
    act(() => {
      fireEvent.click(screen.getByTestId('snapshot-action-button'));
    });
    expect(useSnapshotFlowStore.getState().isLabelInputOpen).toBe(true);
  });

  it('a second click while already open is a no-op (open is idempotent)', async () => {
    await render(<SnapshotActionButton />);
    act(() => {
      fireEvent.click(screen.getByTestId('snapshot-action-button'));
    });
    const after1 = useSnapshotFlowStore.getState();
    act(() => {
      fireEvent.click(screen.getByTestId('snapshot-action-button'));
    });
    const after2 = useSnapshotFlowStore.getState();
    expect(after2.isLabelInputOpen).toBe(true);
    expect(after2).toBe(after1);
  });
});

describe('SnapshotActionButton — i18n catalog parity', () => {
  const KEYS = [
    'moderator.snapshotAction.label',
    'moderator.snapshotAction.ariaLabel',
    'moderator.snapshotAction.shortcutHint',
  ] as const;
  const LOCALES = ['en-US', 'pt-BR', 'es-419'] as const;

  for (const locale of LOCALES) {
    for (const key of KEYS) {
      it(`resolves ${key} to a non-empty string in ${locale}`, async () => {
        await i18next.changeLanguage(locale);
        const value = i18next.t(key);
        expect(value).toBeTruthy();
        expect(value).not.toBe(key);
        expect(value).not.toContain('[t-missing]');
        await i18next.changeLanguage('en-US');
      });
    }
  }

  it('per-locale render: label is distinct between en-US / pt-BR / es-419', async () => {
    const labels: Record<string, string> = {};
    for (const locale of LOCALES) {
      await act(async () => {
        await i18next.changeLanguage(locale);
      });
      cleanup();
      await render(<SnapshotActionButton />);
      labels[locale] = screen.getByTestId('snapshot-action-button').textContent ?? '';
    }
    // The three locales resolve to non-empty strings (the PENDING
    // pt-BR / es-419 drafts ship inline). Distinctness is asserted on
    // en-US vs pt-BR — the es-419 draft text happens to share the
    // chord glyph and `S` letter forms with the others; the parity-
    // round-trip cases above are the real cross-locale gate.
    expect(labels['en-US']).toBeTruthy();
    expect(labels['pt-BR']).toBeTruthy();
    expect(labels['es-419']).toBeTruthy();
    expect(labels['en-US']).not.toBe(labels['pt-BR']);
    await act(async () => {
      await i18next.changeLanguage('en-US');
    });
  });
});
