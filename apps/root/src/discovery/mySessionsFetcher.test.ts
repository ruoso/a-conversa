// Unit coverage for the authenticated My Sessions fetcher (acceptance criterion
// 2): the querystring it builds from a `SessionListQuery`, the path it hits, its
// CREDENTIALED posture (`credentials: 'include'`), and the
// `{ sessions, total } → { rows, total, roles }` mapping (the per-row
// `id → role` correlation surviving the mapping).
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MY_SESSIONS_PATH, buildMySessionsQueryString, fetchMySessions } from './mySessionsFetcher';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('buildMySessionsQueryString', () => {
  it('emits only limit + offset when the optional params are absent', () => {
    const qs = buildMySessionsQueryString({ limit: 20, offset: 0 });
    const params = new URLSearchParams(qs);
    expect([...params.keys()].sort()).toEqual(['limit', 'offset']);
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
    expect(params.has('topic')).toBe(false);
    expect(params.has('startedAfter')).toBe(false);
    expect(params.has('startedBefore')).toBe(false);
  });

  it('includes topic + date bounds when present', () => {
    const qs = buildMySessionsQueryString({
      topic: 'climate',
      startedAfter: '2026-06-01T00:00:00.000Z',
      startedBefore: '2026-06-30T23:59:59.999Z',
      limit: 50,
      offset: 40,
    });
    const params = new URLSearchParams(qs);
    expect(params.get('topic')).toBe('climate');
    expect(params.get('startedAfter')).toBe('2026-06-01T00:00:00.000Z');
    expect(params.get('startedBefore')).toBe('2026-06-30T23:59:59.999Z');
    expect(params.get('limit')).toBe('50');
    expect(params.get('offset')).toBe('40');
  });
});

describe('fetchMySessions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: 'lobby1',
              hostUserId: 'me',
              privacy: 'private',
              topic: 'Lobby topic',
              createdAt: '2026-06-02T09:00:00.000Z',
              startedAt: null,
              endedAt: null,
              role: 'host',
            },
            {
              id: 'mod2',
              hostUserId: 'other',
              privacy: 'public',
              topic: 'Moderated topic',
              createdAt: '2026-06-01T09:00:00.000Z',
              startedAt: '2026-06-01T10:00:00.000Z',
              endedAt: null,
              role: 'moderator',
            },
            {
              id: 'deb3',
              hostUserId: 'other',
              privacy: 'public',
              topic: 'Debated topic',
              createdAt: '2026-05-01T09:00:00.000Z',
              startedAt: '2026-05-01T10:00:00.000Z',
              endedAt: '2026-05-01T11:00:00.000Z',
              role: 'debater-B',
            },
          ],
          total: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('issues the credentialed GET to the my-sessions path with the assembled querystring', async () => {
    await fetchMySessions({ topic: 'climate', limit: 20, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url.startsWith(`${MY_SESSIONS_PATH}?`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('topic')).toBe('climate');
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
    // Authenticated endpoint: the session cookie MUST ride along.
    expect(init?.credentials).toBe('include');
  });

  it('maps the envelope into { rows, total } with listing fields only', async () => {
    const page = await fetchMySessions({ limit: 20, offset: 0 });

    expect(page.total).toBe(3);
    expect(page.rows).toEqual([
      { id: 'lobby1', topic: 'Lobby topic', startedAt: null, endedAt: null },
      {
        id: 'mod2',
        topic: 'Moderated topic',
        startedAt: '2026-06-01T10:00:00.000Z',
        endedAt: null,
      },
      {
        id: 'deb3',
        topic: 'Debated topic',
        startedAt: '2026-05-01T10:00:00.000Z',
        endedAt: '2026-05-01T11:00:00.000Z',
      },
    ]);
    // The role annotation does NOT leak onto the rows — those are exactly the
    // four listing fields the shared component consumes.
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(['endedAt', 'id', 'startedAt', 'topic']);
  });

  it('surfaces the per-row id → role correlation alongside the rows', async () => {
    const page = await fetchMySessions({ limit: 20, offset: 0 });

    expect(page.roles).toEqual({
      lobby1: 'host',
      mod2: 'moderator',
      deb3: 'debater-B',
    });
  });

  it('rejects when the endpoint returns a non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));

    await expect(fetchMySessions({ limit: 20, offset: 0 })).rejects.toThrow(/status 401/);
  });
});
