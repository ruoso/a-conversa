// Mount-contract barrel.
//
// Refinement: tasks/refinements/shell-package/shell_mount_contract.md
//
// Re-exports the four public type names (`MountProps`, `UnmountFn`,
// `MountFn`, `SurfaceModule`) plus the forward-declared placeholder
// interfaces (`AuthContextValue`, `I18n`, `WebSocketClient`, `SurfaceMeta`)
// later leaves widen with real implementations. Consumers import from
// `@a-conversa/shell` directly — they never reach into this subdir.

export type {
  AuthContextValue,
  I18n,
  MountFn,
  MountProps,
  SurfaceMeta,
  SurfaceModule,
  UnmountFn,
  WebSocketClient,
} from './types.js';
