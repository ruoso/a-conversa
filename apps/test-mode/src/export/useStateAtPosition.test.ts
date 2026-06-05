// Vitest cases for the `useStateAtPosition` on-demand export fetch hook.
//
// Refinement: tasks/refinements/replay_test/test_mode_export_position.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications).
//
// Stubs `global.fetch` (the shell's established hook-test idiom — see
// `useDiagnosticsAtPosition` / `useSessionEventLog`). Asserts: an explicit
// `requestExport()` for position N issues `GET /api/sessions/:id/state?
// position=N` (credentials + Accept) and transitions `idle → loading →
// ready` exposing the parsed envelope; no eager fetch before the request; a
// non-OK response and a malformed body each transition to `error` with a
// `retry` that re-issues for the captured position; a `position` change
// after `ready` resets to `idle`; and the per-effect `cancelled` guard drops
// a response that lands after a newer request/reset.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useStateAtPosition } from './useStateAtPosition';

const SESSION = '00000000-0000-4000-8000-000000000099';

function envelope(sequence: number): Record<string, unknown> {
  return {
    sessionId: SESSION,
    sequence,
    projection: { lastAppliedSequence: sequence, nodes: [], edges: [] },
  };
}

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
  global.fetch = ORIGINAL_FETCH;
});

describe('useStateAtPosition — request shape + on-demand fire', () => {
  it('issues no fetch until requestExport is called, then GETs the state endpoint', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope(7))));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useStateAtPosition(SESSION, 7));

    // No eager fetch — the clean state is idle (Decision §2).
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      result.current.requestExport();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/${SESSION}/state?position=7`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(result.current.state).toEqual(envelope(7));
  });
});

describe('useStateAtPosition — error + retry', () => {
  it('maps a non-OK response to error, then retry re-issues for the captured position', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'out of range' }, 400))
      .mockResolvedValueOnce(jsonResponse(envelope(3)));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useStateAtPosition(SESSION, 3));

    act(() => {
      result.current.requestExport();
    });
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
    // The retry re-issued for the same captured position.
    const [retryUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(retryUrl).toBe(`/api/sessions/${SESSION}/state?position=3`);
    expect(result.current.state).toEqual(envelope(3));
  });

  it('maps a malformed body to error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ nope: true })));

    const { result } = renderHook(() => useStateAtPosition(SESSION, 5));
    act(() => {
      result.current.requestExport();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('maps a network throw to error', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    const { result } = renderHook(() => useStateAtPosition(SESSION, 5));
    act(() => {
      result.current.requestExport();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });
});

describe('useStateAtPosition — position-change reset', () => {
  it('resets to idle (no stale state) when position changes after ready', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(envelope(8))));

    const { result, rerender } = renderHook(
      ({ position }) => useStateAtPosition(SESSION, position),
      { initialProps: { position: 8 } },
    );

    act(() => {
      result.current.requestExport();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    // Moving the scrubber clears the readout back to the clean idle state.
    rerender({ position: 7 });
    expect(result.current.status).toBe('idle');
    expect(result.current.state).toBeNull();
  });
});

describe('useStateAtPosition — stale-response guard', () => {
  it('drops a response that lands after a position-change reset', async () => {
    let resolveFirst!: (r: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(first);
    global.fetch = fetchMock;

    const { result, rerender } = renderHook(
      ({ position }) => useStateAtPosition(SESSION, position),
      { initialProps: { position: 5 } },
    );

    act(() => {
      result.current.requestExport();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('loading');
    });

    // Move the scrubber before the position-5 request resolves: the reset
    // returns the hook to idle and trips the effect cleanup.
    rerender({ position: 6 });
    expect(result.current.status).toBe('idle');

    // The superseded response now lands — it must be dropped, leaving idle.
    await act(async () => {
      resolveFirst(jsonResponse(envelope(5)));
      await first;
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.state).toBeNull();
  });
});
