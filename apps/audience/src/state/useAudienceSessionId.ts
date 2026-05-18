// Audience-side URL hook — derive the currently-viewed session id from
// the browser pathname.
//
// Refinement: tasks/refinements/audience/aud_state_management.md
//   (Decision §3 — `useSyncExternalStore` over `popstate` rather than
//   React Router's `useParams()` because the audience surface today
//   has a single wildcard route; the helper is forward-compatible with
//   `aud_url_routing.aud_session_url`'s eventual real route table.)
//
// ADRs:
//   - 0022 (no throwaway verifications — pinned by
//           `useAudienceSessionId.test.tsx`).

import { useSyncExternalStore } from 'react';

import { sessionIdFromPathname, stripAudienceBasename } from './sessionId.js';

/**
 * Read `window.location.pathname`, strip the audience basename, then
 * parse the session id. Returns `null` in a non-browser environment
 * (defensive — the audience surface only ever renders in a browser,
 * but the SSR-safe shape keeps the snapshot signature symmetric).
 */
function snapshotSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionIdFromPathname(stripAudienceBasename(window.location.pathname));
}

/**
 * Subscribe to `popstate` so back/forward navigation (or any
 * `history.go(...)` call) re-derives the session id. React Router's
 * `useNavigate(...)` triggers a `popstate` indirectly through its
 * history wrapper; the subscription stays forward-compatible with the
 * eventual real route table.
 */
function subscribeToPathname(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

/**
 * `useSyncExternalStore`-backed hook returning the canonical session
 * id parsed from the audience's URL, or `null` for any pathname that
 * does not include `/sessions/<uuid>`. The third argument (the SSR
 * snapshot) is the same as the client snapshot because the audience
 * surface only ever runs in a browser; the symmetry keeps React-18's
 * tearing detection happy without a separate SSR shape.
 */
export function useAudienceSessionId(): string | null {
  return useSyncExternalStore(subscribeToPathname, snapshotSessionId, snapshotSessionId);
}
