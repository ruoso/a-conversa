// Unit coverage for the anonymous Public Sessions fetcher (acceptance
// criterion 2): the querystring it builds from a `SessionListQuery`, the path
// it hits, its anonymous posture (no credentials), and the
// `{ sessions, total } → { rows, total }` mapping.
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_page.md

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_SESSIONS_PATH,
  buildPublicSessionsQueryString,
  fetchPublicSessions,
} from './publicSessionsFetcher';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('buildPublicSessionsQueryString', () => {
  it('emits only limit + offset when the optional params are absent', () => {
    const qs = buildPublicSessionsQueryString({ limit: 20, offset: 0 });
    const params = new URLSearchParams(qs);
    expect([...params.keys()].sort()).toEqual(['limit', 'offset']);
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
    expect(params.has('topic')).toBe(false);
    expect(params.has('startedAfter')).toBe(false);
    expect(params.has('startedBefore')).toBe(false);
  });

  it('includes topic + date bounds when present', () => {
    const qs = buildPublicSessionsQueryString({
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

describe('fetchPublicSessions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: 'a1',
              topic: 'Live topic',
              startedAt: '2026-06-01T10:00:00.000Z',
              endedAt: null,
            },
            {
              id: 'b2',
              topic: 'Ended topic',
              startedAt: '2026-05-01T10:00:00.000Z',
              endedAt: '2026-05-01T11:00:00.000Z',
            },
          ],
          total: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('issues the GET to the anonymous public path with the assembled querystring', async () => {
    await fetchPublicSessions({ topic: 'climate', limit: 20, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url.startsWith(`${PUBLIC_SESSIONS_PATH}?`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('topic')).toBe('climate');
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
    // Anonymous endpoint (ADR 0029): no cookie is requested or sent.
    expect(init?.credentials).toBeUndefined();
  });

  it('maps the { sessions, total } envelope into { rows, total } with listing fields only', async () => {
    const page = await fetchPublicSessions({ limit: 20, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.rows).toEqual([
      { id: 'a1', topic: 'Live topic', startedAt: '2026-06-01T10:00:00.000Z', endedAt: null },
      {
        id: 'b2',
        topic: 'Ended topic',
        startedAt: '2026-05-01T10:00:00.000Z',
        endedAt: '2026-05-01T11:00:00.000Z',
      },
    ]);
    // No auth-only fields leak into the mapped view-model — exactly the four
    // listing fields the component consumes.
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(['endedAt', 'id', 'startedAt', 'topic']);
  });

  it('rejects when the endpoint returns a non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(fetchPublicSessions({ limit: 20, offset: 0 })).rejects.toThrow(/status 500/);
  });
});
