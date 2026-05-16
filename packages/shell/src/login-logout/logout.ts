// Imperative `logout()` helper used by the auth provider.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// Extraction source: apps/moderator/src/auth/useAuth.ts lines 184–208.
//
// POSTs `/api/auth/logout` with `credentials: 'include'`, then calls
// `window.location.reload()` — the full reload tears down every
// in-memory React state (Zustand stores included) so the post-logout
// user is indistinguishable from a never-logged-in one. The helper
// swallows fetch rejections (the server-side logout is idempotent) but
// still calls `reload()` regardless.
//
// The shell's `AuthProvider` wraps this in the `logout` field of its
// `AuthContextValue` so consumers can do `auth.logout()` without
// importing the helper directly. The standalone export here is for
// surfaces / tests that want the bare imperative behavior.

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Logout is idempotent on the server side; a network error here
    // means the cookie may NOT have been cleared. Proceed to reload
    // regardless — the next page load will hit `/auth/me` and discover
    // the real state.
  }
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
