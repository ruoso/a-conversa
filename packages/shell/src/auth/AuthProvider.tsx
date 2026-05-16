// `AuthProvider` — the shell-supplied auth provider.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// Owns the `useState`-backed auth state and fires the `GET /api/auth/me`
// bootstrap fetch exactly once per provider mount. Provides the live
// `AuthContextValue` down through `AuthContext`. The one-fetch-per-provider
// behavior is the consolidation win over the moderator's prior shape
// (where every `useAuth()` consumer fired its own `/auth/me`).
//
// Reads exactly two fields off the `/auth/me` response: `userId` and
// `screenName`. Any other field is discarded at the narrowing boundary.
// This file is the audit boundary for the client-side no-profile-data
// invariant — the `./auth.test.ts` suite greps this source plus
// `useAuth.ts` + `types.ts` for the forbidden OIDC identifier list.

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { AuthContext } from './AuthContext.js';
import type { AuthContextValue, AuthError, AuthStatus, AuthUser } from './types.js';

/**
 * The placeholder screen-name string the backend writes for freshly
 * authenticated users. Mirrors `PLACEHOLDER_SCREEN_NAME` in
 * `apps/server/src/auth/routes.ts`. Defensive — the backend should not
 * issue a session cookie before the placeholder is replaced (the
 * returning-user callback path is the only one that sets the session
 * cookie, and it explicitly skips for `<pending>` rows), but the client
 * checks anyway. If the placeholder is ever observed on a logged-in
 * `/auth/me` response, the provider transitions to `needs-screen-name`
 * so the user lands on the form rather than a "Welcome, <pending>" banner.
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
 * Any other field is dropped — the provider is the audit boundary for
 * the client-side no-profile-data invariant.
 */
function narrowAuthUser(value: unknown): AuthUser | undefined {
  if (!isAuthUser(value)) return undefined;
  return { userId: value.userId, screenName: value.screenName };
}

export interface AuthProviderProps {
  readonly children: ReactNode;
}

export function AuthProvider(props: AuthProviderProps): ReactElement {
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
      // to.
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
    // stores included. After logout, the user should look identical to
    // a never-logged-in user; partial pruning is more error-prone than
    // a hard reset.
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: AuthContextValue = { status, user, error, refresh, logout };
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}
