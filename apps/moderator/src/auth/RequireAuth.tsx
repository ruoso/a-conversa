// Route-level auth gate for the moderator console.
//
// Refinement: tasks/refinements/moderator-ui/mod_route_auth_gate.md
//   (predecessors: tasks/refinements/moderator-ui/mod_auth_flow.md,
//    tasks/refinements/moderator-ui/mod_state_management.md)
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_shell.mod_route_auth_gate
//
// Discharges the hand-off promised in `mod_auth_flow.md:138` and
// `mod_auth_flow.md:87` — a `useAuth()`-driven `<Navigate>` that gates
// protected routes against the current auth state. `mod_state_management`
// shipped the Zustand slices but narrowed scope to local UI state and
// never picked up the redirect wiring; this component lands it.
//
// ────────────────────────────────────────────────────────────────────────
// Seam
// ────────────────────────────────────────────────────────────────────────
// The wrapper consumes ONLY `useAuth()`. No new `fetch`, no new state, no
// new context, no caching. `useAuth()` is the seam — when its internals
// later swap to a Zustand store subscription, the call site below does
// not change (the discriminated `status` field is the wire).
//
// ────────────────────────────────────────────────────────────────────────
// Modes
// ────────────────────────────────────────────────────────────────────────
//   - `'authenticated-only'`     — `/sessions/:id/lobby`,
//                                  `/sessions/:id/operate`. Renders
//                                  children when `status === 'authenticated'`;
//                                  redirects `'needs-screen-name'` to
//                                  `/screen-name` and `'unauthenticated'`
//                                  to `/login`.
//   - `'needs-screen-name-only'` — `/screen-name`. Renders children when
//                                  `status === 'needs-screen-name'`;
//                                  redirects `'unauthenticated'` and
//                                  `'authenticated'` to `/login`.
//
// `/login` is NOT wrapped — wrapping it would create a redirect cycle on
// `'unauthenticated'`. `Login.tsx` runs its own in-component four-state
// switch and is the universal redirect sink.
//
// ────────────────────────────────────────────────────────────────────────
// Loading-frame DOM
// ────────────────────────────────────────────────────────────────────────
// The `'loading'` branch renders the exact DOM shape `Login.tsx`:31–38
// uses (`<main data-testid="route-login">` + `<h1 data-testid="route-title">`
// + `<p data-testid="auth-checking">`). The e2e smoke spec at
// `tests/e2e/i18n-moderator-smoke.spec.ts:174` waits for `route-title`
// to be visible before the strict-text assertion at line 196; mirroring
// Login means the title is present immediately at bootstrap and the
// wrapper does not introduce a blank-frame gap between bootstrap and
// redirect. Reusing the existing `auth.login.title` / `auth.login.checking`
// i18n keys means no new catalog entries land in this task.
//
// ────────────────────────────────────────────────────────────────────────
// Exhaustive `switch`
// ────────────────────────────────────────────────────────────────────────
// The body uses `switch (status)` over the `AuthStatus` discriminator and
// returns from every branch. A future addition to the union would leave
// the switch non-exhaustive and trigger a compile error here, forcing the
// gate to acknowledge the new state explicitly rather than fall through
// to a default that might be wrong.

import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@a-conversa/shell';

export type RequireAuthMode = 'authenticated-only' | 'needs-screen-name-only';

export interface RequireAuthProps {
  readonly mode: RequireAuthMode;
  readonly children: ReactNode;
}

export function RequireAuth(props: RequireAuthProps): ReactElement {
  const { t } = useTranslation();
  const { status } = useAuth();

  switch (status) {
    case 'loading':
      // Mirror `Login.tsx`:31–38 exactly so the bootstrap frame carries
      // the same testids + localized title the e2e smoke spec asserts.
      return (
        <main data-testid="route-login">
          <h1 data-testid="route-title">{t('auth.login.title')}</h1>
          <p data-testid="auth-checking">{t('auth.login.checking')}</p>
        </main>
      );
    case 'unauthenticated':
      // Universal redirect sink — `/login` is the only route that can
      // render this status without further redirection.
      return <Navigate to="/login" replace />;
    case 'needs-screen-name':
      if (props.mode === 'needs-screen-name-only') {
        return <>{props.children}</>;
      }
      // `'authenticated-only'` mode: send the half-authed user to the
      // screen-name form (which accepts this status without bouncing).
      return <Navigate to="/screen-name" replace />;
    case 'authenticated':
      if (props.mode === 'authenticated-only') {
        return <>{props.children}</>;
      }
      // `'needs-screen-name-only'` mode: an authenticated user has
      // nothing to do on the screen-name form; land them on `/login`
      // (which then renders the welcome banner).
      return <Navigate to="/login" replace />;
    default: {
      // Exhaustiveness check — adding a new `AuthStatus` member without
      // updating this switch triggers a compile error on the assignment.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
