// Vitest + RTL cases for the connected `<SnapshotJumpList>` affordance.
//
// Refinement: tasks/refinements/replay_test/snapshot_jump_ui.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications); 0024
//   (react-i18next).
//
// Stubs `global.fetch` (the shell's hook-test idiom — see
// `useSessionSnapshots.test.tsx`) and drives the real `useSessionSnapshots` +
// `SnapshotList` + resolver composition. Asserts:
//  - jump: N snapshots render as N rows (ascending `logPosition`) and clicking
//    a row calls `onJump` exactly once with that row's **logPosition** (the
//    position, not the snapshotId);
//  - state pass-through: loading / error (+ working retry) / empty render their
//    affordances and never call `onJump`;
//  - miss is inert: a selection that fails to resolve performs no jump.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import i18next from 'i18next';
import { act, type ReactElement } from 'react';

import { createI18nInstance } from '../i18n/index.js';

import * as resolver from './resolveSnapshotPosition.js';
import { SnapshotJumpList } from './SnapshotJumpList.js';

// Wraps the synchronous testing-library render in `await act(async ...)` so
// the microtask-deferred `useTranslation()` subscription settles inside an act
// boundary (matching `SnapshotList.test.tsx`).
async function render(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  let result!: RenderResult;
  await act(() => {
    result = rtlRender(ui, options);
    return Promise.resolve();
  });
  return result;
}

const SESSION = '00000000-0000-4000-8000-000000000099';
const SNAP_1 = '00000000-0000-4000-8000-000000000a01';
const SNAP_2 = '00000000-0000-4000-8000-000000000a02';

const WELL_FORMED = {
  snapshots: [
    { snapshotId: SNAP_1, label: 'Opening', logPosition: 4, createdAt: '2026-06-01T10:00:00.000Z' },
    { snapshotId: SNAP_2, label: 'Close', logPosition: 42, createdAt: '2026-06-01T11:00:00.000Z' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(async () => {
  await createI18nInstance('en-US');
  await i18next.changeLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('SnapshotJumpList — jump', () => {
  it('renders N rows ascending and jumps to the clicked row’s logPosition', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(WELL_FORMED)));
    const onJump = vi.fn();

    await render(<SnapshotJumpList sessionId={SESSION} onJump={onJump} />);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-list')).toBeTruthy();
    });

    const rows = screen.getByTestId('snapshot-list').querySelectorAll('[data-snapshot-id]');
    expect([...rows].map((r) => r.getAttribute('data-snapshot-id'))).toEqual([SNAP_1, SNAP_2]);

    fireEvent.click(screen.getByTestId(`snapshot-list-row-${SNAP_2}`));

    expect(onJump).toHaveBeenCalledTimes(1);
    // The emitted value is the row's position (42), NOT its snapshotId.
    expect(onJump).toHaveBeenCalledWith(42);
  });
});

describe('SnapshotJumpList — state pass-through', () => {
  it('renders the loading affordance and does not jump', async () => {
    // A never-resolving fetch keeps the underlying hook in `loading`.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));
    const onJump = vi.fn();

    await render(<SnapshotJumpList sessionId={SESSION} onJump={onJump} />);

    expect(screen.getByTestId('snapshot-list-loading')).toBeTruthy();
    expect(onJump).not.toHaveBeenCalled();
  });

  it('renders the error affordance, retry re-issues the fetch, and does not jump', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404))
      .mockResolvedValueOnce(jsonResponse(WELL_FORMED));
    global.fetch = fetchMock;
    const onJump = vi.fn();

    await render(<SnapshotJumpList sessionId={SESSION} onJump={onJump} />);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-list-error')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('snapshot-list-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-list')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onJump).not.toHaveBeenCalled();
  });

  it('renders the empty affordance and does not jump', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ snapshots: [] })));
    const onJump = vi.fn();

    await render(<SnapshotJumpList sessionId={SESSION} onJump={onJump} />);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-list-empty')).toBeTruthy();
    });
    expect(onJump).not.toHaveBeenCalled();
  });
});

describe('SnapshotJumpList — miss is inert', () => {
  it('performs no jump when a selection fails to resolve', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(WELL_FORMED)));
    const onJump = vi.fn();
    // Force the (normally unreachable) miss path: the resolver returns null,
    // so the component's guard must swallow the selection.
    vi.spyOn(resolver, 'resolveSnapshotPosition').mockReturnValue(null);

    await render(<SnapshotJumpList sessionId={SESSION} onJump={onJump} />);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot-list')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`snapshot-list-row-${SNAP_1}`));

    expect(onJump).not.toHaveBeenCalled();
  });
});
