// Public type surface for the shell's auth subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md
//
// Hoisted from `apps/moderator/src/auth/useAuth.ts` lines 42–70 — the
// canonical shapes the moderator's hook returns. Re-exported via
// `../mount-contract/types.ts` so the mount-contract's `AuthContextValue`
// floor and the shell's auth ceiling are the same type.
//
// No-OIDC-profile-data discipline: the `AuthUser` shape is intentionally
// minimum-disclosure. Any other field on the backend's `/auth/me`
// response is dropped at the narrowing boundary inside the provider.
// The shell's `auth.test.ts` greps `AuthProvider.tsx`, `useAuth.ts`,
// `types.ts` for the forbidden OIDC identifier list and fails if any
// appear.

/**
 * The minimum-disclosure user shape the client ever holds. The backend's
 * `/auth/me` response is `{ userId, screenName }`; the provider narrows
 * to the same shape and discards anything else.
 */
export interface AuthUser {
  readonly userId: string;
  readonly screenName: string;
}

/**
 * The discriminated `status` field a renderer switches on. Exhaustive —
 * a `switch (status)` whose four branches all `return` is the canonical
 * use site.
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

/**
 * Canonical auth context value the provider supplies. Widens the
 * `mount-contract/types.ts` `AuthContextValue` placeholder: required
 * fields (`status`, `refresh`, `logout`) match; `user` and `error` are
 * optional additions consumers can read when present.
 *
 * The mount-contract placeholder's `error`-less / `user`-optional shape
 * stays assignable to this type so any consumer compiled against the
 * floor (per `mount-contract.test.ts`) keeps typechecking.
 */
export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user?: AuthUser | undefined;
  readonly error?: AuthError | undefined;
  readonly refresh: () => Promise<void> | void;
  readonly logout: () => Promise<void> | void;
}
