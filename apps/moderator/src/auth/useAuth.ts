// `useAuth` — the client-side auth seam for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_auth_flow.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md (no profile
//              data ever read on the client), docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_shell.mod_auth_flow
//
// Reads the `aconversa-session` cookie indirectly via `GET /auth/me`. The
// cookie is HttpOnly so the JS never touches it directly; the hook holds
// only the derived `{ userId, screenName }` shape the server returns.
//
// ────────────────────────────────────────────────────────────────────────
// Seam for `mod_state_management`
// ────────────────────────────────────────────────────────────────────────
// `mod_state_management` (the next sibling task) will lift this hook's
// internals into a Zustand slice so the auth state is reactive across
// the whole app without each consumer running its own `fetch`. The
// call-site contract documented here — `{ status, user, error, refresh,
// logout }` — is the seam. When the Zustand swap lands, the internals
// (one `useState` + one `useEffect` today) become `useAuthStore(s =>
// ({ status: s.status, ... }))`; the call sites in `Login.tsx` and
// `ScreenName.tsx` do not change.
//
// ────────────────────────────────────────────────────────────────────────
// No OIDC profile data — symmetric with the backend's no-profile-data
// audit (apps/server/src/auth/no-profile-data.test.ts)
// ────────────────────────────────────────────────────────────────────────
// The hook reads exactly two fields off the /auth/me response: the
// user id (UUID string) and the screen name (user-supplied display
// name). Any other field on the response is discarded at the boundary.
// The hook source MUST NOT reference any of the OIDC profile claim
// identifiers — the audit-friendly test in App.test.tsx greps this
// file for those identifiers and fails the build if any appear.

import { useCallback, useEffect, useState } from 'react';

/**
 * The minimum-disclosure user shape the client ever holds. The backend's
 * `/auth/me` response is `{ userId, screenName }`; the hook narrows to
 * the same shape and discards anything else.
 */
export interface AuthUser {
  readonly userId: string;
  readonly screenName: string;
}

/**
 * The discriminated `status` field a renderer switches on. Exhaustive —
 * a `switch (status)` whose four branches all `return` is the canonical
 * use site (see `Login.tsx`).
 */
export type AuthStatus = 'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated';

/**
 * Optional error surface — populated when a `refresh` or `logout` call
 * blows up unexpectedly (network failure, 5xx). 401s from `/auth/me`
 * are NOT errors; they transition status to `unauthenticated`.
 */
export interface AuthError {
  readonly code: string;
  readonly message: string;
}

export interface UseAuthResult {
  readonly status: AuthStatus;
  readonly user: AuthUser | undefined;
  readonly error: AuthError | undefined;
  readonly refresh: () => Promise<void>;
  readonly logout: () => Promise<void>;
}

/**
 * The placeholder screen-name string the backend writes for freshly
 * authenticated users. Mirrors `PLACEHOLDER_SCREEN_NAME` in
 * `apps/server/src/auth/routes.ts`. Defensive — the backend should not
 * issue a session cookie before the placeholder is replaced (the
 * returning-user callback path is the only one that sets the session
 * cookie, and it explicitly skips for `<pending>` rows), but the client
 * checks anyway. If the placeholder is ever observed on a logged-in
 * `/auth/me` response, the hook transitions to `needs-screen-name` so
 * the user lands on the form rather than a "Welcome, <pending>" banner.
 */
const PLACEHOLDER_SCREEN_NAME = '<pending>';

/**
 * Type guard for the narrow `{ userId, screenName }` shape. Reading off
 * `unknown` (the `await response.json()` return type) plus narrowing
 * here means a backend that grew to send extra fields would have those
 * fields ignored at the boundary.
 */
function isAuthUser(value: unknown): value is AuthUser {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['userId'] === 'string' && typeof record['screenName'] === 'string';
}

/**
 * Narrow whatever the backend returns to exactly `{ userId, screenName }`.
 * Any other field is dropped — the hook is the audit boundary for the
 * client-side no-profile-data invariant.
 */
function narrowAuthUser(value: unknown): AuthUser | undefined {
  if (!isAuthUser(value)) return undefined;
  return { userId: value.userId, screenName: value.screenName };
}

/**
 * The hook. Calls `GET /auth/me` on mount; transitions `status` per the
 * response. Returns `refresh` and `logout` so call sites can re-check
 * the server state after a write (e.g., after `POST /auth/screen-name`
 * succeeds) or kick the user out.
 *
 * The hook intentionally does NOT trigger the login redirect — that is
 * a navigation, which the `Login.tsx` component owns via its `<a>`
 * element. Hooks should not navigate; that's the renderer's job.
 */
export function useAuth(): UseAuthResult {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | undefined>(undefined);
  const [error, setError] = useState<AuthError | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    setError(undefined);
    try {
      // `credentials: 'include'` makes the browser attach the
      // `aconversa-session` cookie. Same-origin in production (Vite
      // dev proxies `/api/*` to the backend); the include credential
      // is still cheap and the cross-origin-safe default.
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401) {
        setUser(undefined);
        setStatus('unauthenticated');
        return;
      }
      if (!response.ok) {
        setUser(undefined);
        setStatus('unauthenticated');
        setError({
          code: 'auth-me-failed',
          message: `unexpected status ${String(response.status)} from /api/auth/me`,
        });
        return;
      }
      const body: unknown = await response.json();
      const narrowed = narrowAuthUser(body);
      if (narrowed === undefined) {
        setUser(undefined);
        setStatus('unauthenticated');
        setError({
          code: 'auth-me-malformed',
          message: '/api/auth/me returned an unexpected body shape',
        });
        return;
      }
      // Defensive: if the placeholder ever leaks through, route the
      // user to the screen-name form instead of rendering "Welcome,
      // <pending>". The backend should not put us here, but the
      // client-side guard is cheap.
      if (narrowed.screenName === PLACEHOLDER_SCREEN_NAME) {
        setUser(narrowed);
        setStatus('needs-screen-name');
        return;
      }
      setUser(narrowed);
      setStatus('authenticated');
    } catch (err) {
      // Network error / fetch rejected. Surface as unauthenticated with
      // an error so the UI can render a retry affordance if it wants
      // to. Today's Login route renders the login button regardless,
      // so an offline user can still see the call-to-action.
      setUser(undefined);
      setStatus('unauthenticated');
      setError({
        code: 'network-error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setError(undefined);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      // Logout is idempotent on the server side; a network error here
      // means the cookie may NOT have been cleared. Surface the error
      // but still proceed to reload — the next page load will hit
      // `/auth/me` and discover the real state.
      setError({
        code: 'logout-network-error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    // A full reload tears down every in-memory React state — Zustand
    // stores once they land, in-memory `useState`. After logout, the
    // user should look identical to a never-logged-in user; partial
    // pruning is more error-prone than a hard reset.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, user, error, refresh, logout };
}
