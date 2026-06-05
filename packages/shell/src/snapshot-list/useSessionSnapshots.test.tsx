// Vitest cases for the `useSessionSnapshots` REST-fetch hook.
//
// Refinement: tasks/refinements/replay_test/snapshot_list_ui.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications).
//
// Stubs `global.fetch` (the shell's established hook-test idiom — see
// `screen-name-form.test.tsx`); no MSW dependency. Asserts: the request
// targets `/api/sessions/:id/snapshots` with `credentials: 'include'`; a
// well-formed 200 yields `ready` + the narrowed records in endpoint order;
// a non-200 yields `error` and `retry` re-issues the request; a malformed
// body is rejected by the narrowing guard (→ `error`, no throw).

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useSessionSnapshots } from './useSessionSnapshots.js';

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

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSessionSnapshots — request shape', () => {
  it('GETs /api/sessions/:id/snapshots with credentials: include', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(WELL_FORMED)));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionSnapshots(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/${SESSION}/snapshots`);
    expect(init.credentials).toBe('include');
  });
});

describe('useSessionSnapshots — well-formed 200', () => {
  it('yields ready with the parsed, narrowed snapshots in endpoint order', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(WELL_FORMED)));

    const { result } = renderHook(() => useSessionSnapshots(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.snapshots).toEqual(WELL_FORMED.snapshots);
  });
});

describe('useSessionSnapshots — non-200', () => {
  it('yields error, and retry re-issues the request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404))
      .mockResolvedValueOnce(jsonResponse(WELL_FORMED));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionSnapshots(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.snapshots).toEqual(WELL_FORMED.snapshots);
  });
});

describe('useSessionSnapshots — malformed body', () => {
  it('rejects a garbage record via the narrowing guard (error, no throw)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ snapshots: [{ snapshotId: 7, label: null }] })),
    );

    const { result } = renderHook(() => useSessionSnapshots(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.snapshots).toEqual([]);
  });

  it('rejects a body whose snapshots field is not an array', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ snapshots: 'not-an-array' })));

    const { result } = renderHook(() => useSessionSnapshots(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });
});
