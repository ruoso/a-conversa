// The data-access seam (D3) for the authenticated My Sessions page: it owns the
// endpoint URL, the querystring assembly, and the
// `MySessionResponse → SessionListRow` mapping, and additionally surfaces the
// per-row `id → role` correlation the page needs to render its role badges.
// Keeping it a standalone module (rather than an inline closure in the route)
// keeps the mapping unit-testable without rendering, and keeps the data-access
// concern outside the shared component — its core design.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_page.md
// TaskJuggler: session_discovery.sd_frontend.sd_my_sessions_page
// ADR:        0026 (micro-frontend root app), 0024 (i18n).
//
// Unlike the anonymous `publicSessionsFetcher` (ADR 0029, no credentials), this
// fetcher targets the AUTHENTICATED `/api/sessions/mine` endpoint with
// `credentials: 'include'` — the endpoint requires the session cookie and
// returns the caller's own sessions (host / moderator / debater, lobby +
// started + ended), each annotated with the caller's resolved `role`.
//
// `SessionListRow` deliberately carries NO `role` field (the shared component is
// endpoint-ignorant), so the role annotation cannot ride along on the rows. The
// fetcher therefore returns the rows AND a separate `id → role` map; the route
// accumulates that map into a stable `roleById` ref and renders the badge from
// the `renderRowActions` slot (D3, D5).

import type { SessionListPage, SessionListQuery, SessionListRow } from './SessionList';

/** The authenticated, role-annotated my-sessions listing endpoint. */
export const MY_SESSIONS_PATH = '/api/sessions/mine';

/**
 * The caller's resolved role for a session, per the endpoint's annotation
 * (precedence host > moderator > debater; A/B debater slot preserved here and
 * collapsed to a single "debater" badge at the {@link SessionRoleBadge}).
 */
export type MySessionRole = 'host' | 'moderator' | 'debater-A' | 'debater-B';

/** The `id → role` correlation a page consumes (roles are immutable per id). */
export type MySessionRoleMap = Readonly<Record<string, MySessionRole>>;

/**
 * One row of `GET /api/sessions/mine`'s response. The endpoint returns more
 * fields than the list view-model consumes (`hostUserId`, `privacy`,
 * `createdAt`); only the listing fields plus `role` are read here.
 */
interface MySessionResponseRow {
  readonly id: string;
  readonly topic: string;
  /** `null` while the session is still in lobby (unstarted). */
  readonly startedAt: string | null;
  /** `null` while the session has not ended. */
  readonly endedAt: string | null;
  /** The caller's resolved role for this session. */
  readonly role: MySessionRole;
}

/** The `GET /api/sessions/mine` response envelope. */
interface MySessionsResponse {
  readonly sessions: readonly MySessionResponseRow[];
  readonly total: number;
}

/**
 * A page of the my-sessions list: the component's `{ rows, total }` plus the
 * per-row `id → role` correlation the page renders its badges from.
 */
export interface MySessionsPage extends SessionListPage {
  readonly roles: MySessionRoleMap;
}

/**
 * Build the endpoint querystring from a {@link SessionListQuery}. Optional
 * params (`topic` / `startedAfter` / `startedBefore`) are omitted entirely when
 * absent rather than sent empty; `limit` / `offset` are always present.
 */
export function buildMySessionsQueryString(query: SessionListQuery): string {
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
 * The credentialed fetcher for the my-sessions list. Issues the authenticated
 * GET (`credentials: 'include'`) and maps the `{ sessions, total }` envelope
 * into the component's `{ rows, total }` page shape PLUS the `id → role`
 * correlation. Not directly a `SessionListFetcher` (the extra `roles` field):
 * the route wraps it in a `useCallback` adapter that records the roles and
 * returns the bare `{ rows, total }` to the component.
 */
export async function fetchMySessions(query: SessionListQuery): Promise<MySessionsPage> {
  const response = await fetch(`${MY_SESSIONS_PATH}?${buildMySessionsQueryString(query)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GET ${MY_SESSIONS_PATH} failed with status ${String(response.status)}`);
  }
  const body = (await response.json()) as MySessionsResponse;
  const rows: SessionListRow[] = body.sessions.map((session) => ({
    id: session.id,
    topic: session.topic,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  }));
  const roles: Record<string, MySessionRole> = {};
  for (const session of body.sessions) {
    roles[session.id] = session.role;
  }
  return { rows, total: body.total, roles };
}

export default fetchMySessions;
