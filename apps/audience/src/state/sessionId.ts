// `sessionId.ts` — audience-side URL helpers for resolving the
// currently-viewed session id from the browser pathname.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §3 — duplicate `stripAudienceBasename` of the inline
//   logic in apps/audience/src/App.tsx:61-69; the App-level read is
//   for locale negotiation, this read is for session-id parsing.
//   Consolidation is deferred to aud_url_routing.aud_session_url
//   when that leaf lands a real <Route path="/:locale?/sessions/:id">
//   pattern that supersedes both reads.)
//
// Canonical audience URL grammar (per aud_app_skeleton.md §"Locale
// negotiation"): `/a/{locale}?/sessions/{uuid}`. The root host strips
// `/a` when matching the SurfaceHost route; this helper expects the
// already-stripped path under the audience basename (or strips it
// itself via stripAudienceBasename for window.location.pathname reads).

/**
 * RFC 4122 v1-5 UUID matcher. The session-id grammar produced by the
 * server is v4 today; the matcher accepts v1-5 to stay forward-compatible
 * with whichever version the server emits at the time of broadcast. The
 * regex rejects malformed candidates so a typo in the address bar
 * (`/sessions/foo`) returns `null` instead of a faux session id that
 * would later 404 deep in the WS subscribe path.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Strip the audience surface's `/a` basename from a pathname. Returns
 * `/` for the bare `/a`, the suffix for `/a/...`, and the pathname
 * unchanged for anything else (which is the safe fallback if the
 * surface is ever mounted under a different basename or if a caller
 * passes an already-stripped path).
 */
export function stripAudienceBasename(pathname: string): string {
  if (pathname === '/a') return '/';
  if (pathname.startsWith('/a/')) return pathname.substring(2);
  return pathname;
}

/**
 * Parse a session id out of an audience-basename-stripped pathname.
 * Returns the canonical UUID string for a valid `/sessions/<uuid>` or
 * `/{locale}/sessions/<uuid>` pathname; returns `null` for any
 * pathname missing the `/sessions/` marker, missing the trailing UUID,
 * or carrying a malformed (non-UUID) tail.
 *
 * The helper takes the already-stripped pathname rather than reading
 * `window.location.pathname` so the projector stays pure and trivially
 * testable. The subscription wrapper around `popstate` lives in
 * `useAudienceSessionId.ts`.
 */
export function sessionIdFromPathname(pathname: string): string | null {
  // The pathname can be `/sessions/<uuid>` or `/{locale}/sessions/<uuid>`.
  // Split on `/sessions/` and take the trailing segment up to the next
  // boundary; reject anything that's not a strict UUID.
  const marker = '/sessions/';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const tail = pathname.substring(idx + marker.length);
  const candidate = tail.split('/')[0]?.split('?')[0];
  if (candidate === undefined || candidate === '') return null;
  if (!UUID_REGEX.test(candidate)) return null;
  return candidate;
}
