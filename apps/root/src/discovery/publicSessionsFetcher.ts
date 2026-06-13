// The data-access seam (D3) for the anonymous Public Sessions page: it owns
// the endpoint URL, the querystring assembly, and the
// `PublicSessionResponse → SessionListRow` mapping, and is injected into the
// shared `SessionList` via its `fetchPage` prop. Keeping it a standalone module
// (rather than an inline closure in the route) keeps the mapping unit-testable
// without rendering, and keeps the data-access concern outside the component —
// its core design.
//
// Refinement: tasks/refinements/session_discovery/sd_public_sessions_page.md
// TaskJuggler: session_discovery.sd_frontend.sd_public_sessions_page
// ADR:        0026 (micro-frontend root app), 0024 (i18n),
//             0029 (anonymous public-session access).
//
// The endpoint is anonymous (ADR 0029): a plain `fetch()` against the relative
// `/api/sessions/public` path with NO `credentials: 'include'` — a session
// cookie is neither needed nor sent. The authenticated My Sessions fetcher (a
// separate task) opts into credentials instead. The endpoint already enforces
// `privacy = 'public' AND started_at IS NOT NULL` server-side, so this fetcher
// adds no client-side filtering that could leak lobby ids.

import type {
  SessionListFetcher,
  SessionListPage,
  SessionListQuery,
  SessionListRow,
} from './SessionList';

/** The anonymous, started-only public-sessions listing endpoint. */
export const PUBLIC_SESSIONS_PATH = '/api/sessions/public';

/**
 * One row of `GET /api/sessions/public`'s response. Listing fields only — no
 * host/participant/role data (the endpoint narrows the select), so the mapping
 * below assumes none.
 */
interface PublicSessionResponseRow {
  readonly id: string;
  readonly topic: string;
  /** Never null — the endpoint gates on `started_at IS NOT NULL`. */
  readonly startedAt: string;
  /** Null while the session is still live. */
  readonly endedAt: string | null;
}

/** The `GET /api/sessions/public` response envelope. */
interface PublicSessionsResponse {
  readonly sessions: readonly PublicSessionResponseRow[];
  readonly total: number;
}

/**
 * Build the endpoint querystring from a {@link SessionListQuery}. Optional
 * params (`topic` / `startedAfter` / `startedBefore`) are omitted entirely when
 * absent rather than sent empty; `limit` / `offset` are always present.
 */
export function buildPublicSessionsQueryString(query: SessionListQuery): string {
  const params = new URLSearchParams();
  if (query.topic !== undefined) {
    params.set('topic', query.topic);
  }
  if (query.startedAfter !== undefined) {
    params.set('startedAfter', query.startedAfter);
  }
  if (query.startedBefore !== undefined) {
    params.set('startedBefore', query.startedBefore);
  }
  params.set('limit', String(query.limit));
  params.set('offset', String(query.offset));
  return params.toString();
}

/**
 * The injected fetcher for the public list. Issues the anonymous GET and maps
 * the `{ sessions, total }` envelope into the component's
 * `{ rows: SessionListRow[], total }` page shape.
 */
export const fetchPublicSessions: SessionListFetcher = async (
  query: SessionListQuery,
): Promise<SessionListPage> => {
  const response = await fetch(`${PUBLIC_SESSIONS_PATH}?${buildPublicSessionsQueryString(query)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GET ${PUBLIC_SESSIONS_PATH} failed with status ${String(response.status)}`);
  }
  const body = (await response.json()) as PublicSessionsResponse;
  const rows: SessionListRow[] = body.sessions.map((session) => ({
    id: session.id,
    topic: session.topic,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  }));
  return { rows, total: body.total };
};

export default fetchPublicSessions;
