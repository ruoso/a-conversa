// `useAuth` — the shell-supplied context consumer hook.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//
// Reads the `AuthContextValue` off the surrounding `<AuthProvider>`.
// Throws if called outside the provider — surfaces programming errors
// at the call site rather than silently returning `undefined`. Symmetric
// with the existing `useWsClient` shape (see `../ws/WsClientProvider.tsx`).
//
// No-OIDC-profile-data discipline: this file is part of the shell's
// auth subsystem; the audit test (`./auth.test.ts`) greps this source
// for the forbidden OIDC identifier list.

import { useContext } from 'react';

import { AuthContext } from './AuthContext.js';
import type { AuthContextValue } from './types.js';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === undefined) {
    throw new Error('useAuth must be called inside <AuthProvider>');
  }
  return value;
}
