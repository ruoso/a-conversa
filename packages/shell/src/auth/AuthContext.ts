// React context for the shell's auth subsystem.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//
// Split from `AuthProvider.tsx` + `useAuth.ts` so the no-profile-data
// audit greps only the two files that actually touch the response shape.
// The context is initialized to `undefined`; `useAuth()` throws if it
// observes that (consumer rendered outside the provider).

import { createContext } from 'react';

import type { AuthContextValue } from './types.js';

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
