// Vitest + RTL cases for the cross-surface `<SnapshotList>` primitive.
//
// Refinement: tasks/refinements/replay_test/snapshot_list_ui.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications); 0024
//   (react-i18next).
//
// Covers each of the four load states the refinement makes first-class:
//  - ready: N records render as N rows in the given (ascending
//    `logPosition`) order, each showing label, `#logPosition`, createdAt;
//  - select: clicking a row fires `onSelect` with that row's snapshotId;
//  - empty: `[]` renders the explicit no-snapshots affordance, not a blank;
//  - loading / error: render their affordances; error exposes a working
//    `onRetry` control.
// Plus a cross-locale catalog-parity check on the new `snapshotList.*` keys.

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

import { createI18nInstance } from '../i18n/index.js';

import { SnapshotList } from './SnapshotList.js';
import type { SnapshotRecord } from './types.js';

// Wraps the synchronous testing-library render in `await act(async ...)`
// so the microtask-deferred `useTranslation()` subscription settles
// inside an act boundary (matching the shell's `AxiomMarkBadge.test.tsx`).
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const SNAP_1 = '00000000-0000-4000-8000-000000000a01';
const SNAP_2 = '00000000-0000-4000-8000-000000000a02';
const SNAP_3 = '00000000-0000-4000-8000-000000000a03';

// Deliberately authored in ascending `logPosition` order — the order the
// REST endpoint guarantees and the component renders verbatim.
const RECORDS: readonly SnapshotRecord[] = [
  { snapshotId: SNAP_1, label: 'Opening', logPosition: 4, createdAt: '2026-06-01T10:00:00.000Z' },
  { snapshotId: SNAP_2, label: 'Midpoint', logPosition: 17, createdAt: '2026-06-01T10:30:00.000Z' },
  { snapshotId: SNAP_3, label: 'Close', logPosition: 42, createdAt: '2026-06-01T11:00:00.000Z' },
];

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
});

describe('SnapshotList — ready', () => {
  it('renders one row per record in the given ascending-logPosition order', async () => {
    await render(<SnapshotList status="ready" snapshots={RECORDS} onSelect={() => undefined} />);

    const list = screen.getByTestId('snapshot-list');
    const rows = list.querySelectorAll('[data-snapshot-id]');
    expect(rows).toHaveLength(3);
    expect([...rows].map((r) => r.getAttribute('data-snapshot-id'))).toEqual([
      SNAP_1,
      SNAP_2,
      SNAP_3,
    ]);
  });

  it('shows the label, #logPosition, and createdAt for each row', async () => {
    await render(<SnapshotList status="ready" snapshots={RECORDS} onSelect={() => undefined} />);

    const row = screen.getByTestId(`snapshot-list-row-${SNAP_2}`);
    expect(row.textContent).toContain('Midpoint');
    expect(row.textContent).toContain('#17');
    expect(screen.getByTestId(`snapshot-list-row-${SNAP_2}-created-at`).textContent).toBe(
      '2026-06-01T10:30:00.000Z',
    );
  });
});

describe('SnapshotList — select', () => {
  it('fires onSelect with the clicked row snapshotId', async () => {
    const onSelect = vi.fn();
    await render(<SnapshotList status="ready" snapshots={RECORDS} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId(`snapshot-list-row-${SNAP_3}`));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(SNAP_3);
  });
});

describe('SnapshotList — empty', () => {
  it('renders the explicit no-snapshots affordance, not a blank node', async () => {
    await render(<SnapshotList status="ready" snapshots={[]} onSelect={() => undefined} />);

    const empty = screen.getByTestId('snapshot-list-empty');
    expect(empty.getAttribute('role')).toBe('status');
    expect(empty.textContent).toBe('No snapshots in this session yet.');
    expect(screen.queryByTestId('snapshot-list')).toBeNull();
  });
});

describe('SnapshotList — loading', () => {
  it('renders the loading affordance', async () => {
    await render(<SnapshotList status="loading" snapshots={[]} onSelect={() => undefined} />);

    const loading = screen.getByTestId('snapshot-list-loading');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.textContent).toBe('Loading snapshots…');
  });
});

describe('SnapshotList — error', () => {
  it('renders the error affordance with a working retry control', async () => {
    const onRetry = vi.fn();
    await render(
      <SnapshotList status="error" snapshots={[]} onSelect={() => undefined} onRetry={onRetry} />,
    );

    expect(screen.getByTestId('snapshot-list-error').getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByTestId('snapshot-list-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('SnapshotList — i18n catalog parity', () => {
  const KEYS = [
    'snapshotList.regionAriaLabel',
    'snapshotList.loading',
    'snapshotList.error',
    'snapshotList.retry',
    'snapshotList.empty',
    'snapshotList.rowAriaLabel',
  ] as const;

  it('resolves every new snapshotList key to a non-empty, non-literal string in each locale', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-419'] as const) {
      await i18next.changeLanguage(locale);
      for (const key of KEYS) {
        const value = i18next.t(key, { label: 'X', position: 1 });
        expect(value, `${locale}::${key} resolved`).toBeTruthy();
        expect(value, `${locale}::${key} not literal key`).not.toBe(key);
      }
    }
    await i18next.changeLanguage('en-US');
  });
});
