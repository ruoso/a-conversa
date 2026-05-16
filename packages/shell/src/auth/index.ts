// Barrel for the shell's auth subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md

export { AuthProvider, type AuthProviderProps } from './AuthProvider.js';
export { useAuth } from './useAuth.js';
export type { AuthContextValue, AuthError, AuthStatus, AuthUser } from './types.js';
