// Tiny helper that conditionally wraps a Zustand state-creator with the
// `devtools` middleware in dev builds and is a no-op in production.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
// (Decision §1: Zustand mirrors `mod_state_management`; Decision §4:
// participant-local — the wrapper is copied verbatim from the moderator's
// `apps/moderator/src/stores/devtools.ts` because cross-surface extraction
// is premature.)
//
// Vite exposes `import.meta.env.DEV` as a compile-time boolean; the
// production bundle therefore tree-shakes the devtools import.

import type { StateCreator } from 'zustand';
import { devtools, type DevtoolsOptions } from 'zustand/middleware';

/**
 * Wrap a state-creator with `devtools` when running in a Vite dev build,
 * otherwise return it unchanged. The `name` shows up in the Redux
 * DevTools store list and is also threaded through as the default
 * action label.
 */
export function withDevtools<T>(
  name: string,
  initializer: StateCreator<T, [], []>,
  options: Omit<DevtoolsOptions, 'name' | 'enabled'> = {},
): StateCreator<T, [], []> {
  if (!import.meta.env.DEV) {
    return initializer;
  }
  // The `devtools` middleware adds a `['zustand/devtools', never]` mutator
  // to the state creator type. We cast back to the bare-mutator shape so
  // call-sites can keep the simple `create<State>()(...)` signature
  // regardless of build mode.
  return devtools(initializer, { ...options, name, enabled: true }) as unknown as StateCreator<
    T,
    [],
    []
  >;
}
