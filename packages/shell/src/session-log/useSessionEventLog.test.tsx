// Vitest cases for the `useSessionEventLog` REST paging-fetch hook.
//
// Refinement: tasks/refinements/replay_test/test_mode_load_session.md
// ADRs:        0006 (Vitest); 0022 (no throwaway verifications).
//
// Stubs `global.fetch` (the shell's established hook-test idiom — see
// `useSessionSnapshots.test.tsx`); no MSW dependency. Asserts: the request
// shape; a single-page 200 → `ready` in ascending `sequence` order;
// **multi-page paging** assembled in order (pins Constraint §1); an empty
// log → `ready` + `[]`; a 404 → `not-found`; a non-200 and a network throw
// → `error` with a working `retry`; a malformed element dropped by the
// narrowing guard while siblings survive; an unmount mid-flight that never
// `setState`s a torn-down component.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useSessionEventLog } from './useSessionEventLog.js';

const SESSION = '00000000-0000-4000-8000-000000000099';

function evt(sequence: number, kind = 'node-created'): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-0000000${String(100 + sequence)}`,
    sessionId: SESSION,
    sequence,
    kind,
    actor: '00000000-0000-4000-8000-000000000001',
    payload: {},
    createdAt: `2026-06-01T10:00:0${String(sequence % 10)}.000Z`,
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
});

describe('useSessionEventLog — request shape', () => {
  it('GETs /api/sessions/:id/events?after=0&limit=100 with credentials + Accept', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ events: [evt(1)], nextCursor: null })),
    );
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/${SESSION}/events?after=0&limit=100`);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });
});

describe('useSessionEventLog — single-page 200', () => {
  it('yields ready with the events in ascending sequence order', async () => {
    const events = [evt(1), evt(2), evt(3)];
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events, nextCursor: null })));

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });
});

describe('useSessionEventLog — multi-page paging', () => {
  it('pages through nextCursor and concatenates all pages in order', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ events: [evt(1), evt(2)], nextCursor: 2 }))
      .mockResolvedValueOnce(jsonResponse({ events: [evt(3)], nextCursor: null }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(secondUrl).toBe(`/api/sessions/${SESSION}/events?after=2&limit=100`);
    expect(result.current.events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });
});

describe('useSessionEventLog — empty log', () => {
  it('yields ready with an empty events array', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events: [], nextCursor: null })));

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.events).toEqual([]);
  });
});

describe('useSessionEventLog — 404', () => {
  it('maps a 404 to not-found, distinct from error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ message: 'nope' }, 404)));

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('not-found');
    });
  });
});

describe('useSessionEventLog — failures + retry', () => {
  it('maps a non-200 to error, and retry re-runs the load to ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ events: [evt(1)], nextCursor: null }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionEventLog(SESSION));
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
  });

  it('maps a network throw to error, and retry recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ events: [evt(1)], nextCursor: null }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
  });
});

describe('useSessionEventLog — malformed element', () => {
  it('drops a malformed element while well-formed siblings survive', async () => {
    const events = [evt(1), { id: 7, kind: null }, evt(3)];
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ events, nextCursor: null })));

    const { result } = renderHook(() => useSessionEventLog(SESSION));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.events.map((e) => e.sequence)).toEqual([1, 3]);
  });
});

describe('useSessionEventLog — unmount mid-flight', () => {
  it('does not setState after unmount (cancelled flag)', async () => {
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn(() => pending);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, unmount } = renderHook(() => useSessionEventLog(SESSION));
    expect(result.current.status).toBe('loading');

    unmount();
    resolveFetch(jsonResponse({ events: [evt(1)], nextCursor: null }));
    await Promise.resolve();
    await Promise.resolve();

    // A setState on a torn-down component would emit a React act warning
    // through console.error; its absence proves the cancelled guard held.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
