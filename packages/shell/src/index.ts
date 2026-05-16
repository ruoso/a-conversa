// Public surface of `@a-conversa/shell`.
//
// Refinement: tasks/refinements/shell-package/shell_pkg_skeleton.md
// ADR:        docs/adr/0026-micro-frontend-root-app.md
//
// This package is the shared substrate consumed by the root app
// (`apps/root/`) and every UI surface (`apps/moderator/`, `apps/participant/`,
// `apps/audience/`, `apps/replay-test/`) under the micro-frontend pivot.
// The eventual surface area — mount-contract types, auth context,
// screen-name form, login/logout components, i18n bootstrap, WS client,
// error mapper — lands in its own per-leaf commit. This file is the
// skeleton barrel; each downstream leaf adds a `src/<subsystem>/` tree
// and re-exports its public bits here.
//
// `SHELL_PACKAGE_VERSION` is the existence proof for the empty skeleton:
// per ADR 0022, the package needs at least one observable behavior pinned
// by a committed test (see `./index.test.ts`). The constant is the
// package's own version literal; bumping it is intentional and forces the
// test to update in lockstep.

// Mount-contract types — see `./mount-contract/` and
// tasks/refinements/shell-package/shell_mount_contract.md.
export type {
  AuthContextValue,
  I18n,
  MountFn,
  MountProps,
  SurfaceMeta,
  SurfaceModule,
  UnmountFn,
  WebSocketClient,
} from './mount-contract/index.js';

export const SHELL_PACKAGE_VERSION = '0.1.0' as const;
