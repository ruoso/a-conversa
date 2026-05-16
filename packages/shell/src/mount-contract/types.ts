// Mount-contract types — the TypeScript surface every UI bundle (moderator,
// participant, audience, replay-test) exports and the root-app dispatcher
// consumes.
//
// Refinement: tasks/refinements/shell-package/shell_mount_contract.md
//   (initial placeholders) + tasks/refinements/shell-package/shell_substrate_extraction.md
//   (canonical types re-exported via the auth subsystem; the i18n + WS
//   shapes here are kept as structural floors that the canonical
//   `i18next.i18n` and `WsClient` types satisfy).
// ADRs:        docs/adr/0026-micro-frontend-root-app.md (decision 2 — Vite
//              library mode + the host-to-surface mount contract sketched on
//              lines 37-55), docs/adr/0022-no-throwaway-verifications.md
//              (the no-op-surface case in `./mount-contract.test.ts` pins
//              the minimum-viable shape).
//
// Pure types. No runtime code, no React imports, no DOM imports beyond
// `HTMLElement` (a built-in `lib.dom.d.ts` interface).
//
// After the substrate extraction, the canonical `AuthContextValue` lives
// in `../auth/types.ts` and is re-exported here verbatim — single source
// of truth, no drift. The `I18n` shape stays a structural floor (a
// `i18next.i18n` instance is assignable to it; a hand-rolled `{ t,
// language, changeLanguage }` stub still satisfies it for tests). The
// `WebSocketClient` shape stays a structural floor for the same reason
// — the canonical `WsClient` is richer but assignable.

// Single-source-of-truth re-export — the canonical type lives in the
// auth subsystem; the mount-contract floor stays assignable to it
// because the placeholder fields (status / refresh / logout) are
// required, `user` and `error` are optional.
export type { AuthContextValue } from '../auth/index.js';

/**
 * Structural floor for the host-supplied i18n instance. The canonical
 * type is `i18next.i18n` (re-exported from `../i18n/` as `I18nInstance`);
 * any `i18next.i18n` value is assignable to `I18n` because the three
 * methods listed here match the i18next surface. Consumers that need
 * the full `i18next.i18n` API import `I18nInstance` from the i18n
 * subsystem directly.
 */
export interface I18n {
  readonly t: (key: string, vars?: Record<string, unknown>) => string;
  readonly language: string;
  readonly changeLanguage: (lang: string) => Promise<unknown>;
}

/**
 * Structural floor for the host-supplied WebSocket client. The
 * canonical type is `WsClient` from `../ws/` (richer typed
 * request/response surface plus `trackSession` / `onEnvelope`); any
 * `WsClient` value is assignable to `WebSocketClient` via the
 * `onEnvelope` → subscribe-shape adapter consumers can write at the
 * call site. Surfaces that need the richer surface import `WsClient`
 * from the ws subsystem directly.
 *
 * `subscribe(kind, handler)` returns an unsubscribe function.
 * `send(kind, payload)` is fire-and-forget at the placeholder level.
 */
export interface WebSocketClient {
  readonly subscribe: (kind: string, handler: (event: unknown) => void) => () => void;
  readonly send: (kind: string, payload: unknown) => void;
}

/**
 * Optional surface-level metadata a dynamically-imported `SurfaceModule`
 * may expose alongside its `mount` export. Advisory only — the surface
 * and the backend still enforce per-route auth checks; this is the host's
 * pre-mount hint for nav rendering and auth-gate short-circuits.
 */
export interface SurfaceMeta {
  readonly displayName?: string;
  readonly requiredAuthLevel?: 'public' | 'authenticated';
}

import type { AuthContextValue } from '../auth/index.js';

/**
 * The dependency bag the host passes into a surface's `mount()`.
 *
 * Per ADR 0026 decision 2, the host owns the React DOM root, the URL
 * prefix dispatcher, the auth context, the i18n instance, and the WS
 * client; the surface owns its own `<BrowserRouter basename={routerBasePath}>`
 * and its own route tree under that base path.
 */
export interface MountProps {
  readonly container: HTMLElement;
  readonly auth: AuthContextValue;
  readonly i18n: I18n;
  readonly routerBasePath: string;
  readonly ws?: WebSocketClient;
  readonly locale?: string;
}

/**
 * The synchronous cleanup function `mount()` returns. The host invokes it
 * on prefix change to tear the surface down.
 */
export type UnmountFn = () => void;

/**
 * The canonical signature every surface's `mount` export conforms to.
 */
export type MountFn = (props: MountProps) => UnmountFn;

/**
 * The shape of the object a dynamically-imported surface bundle exposes
 * to the root-app dispatcher. `mount` is required; `meta` is an optional
 * slot for surface-level metadata the host can read without invoking
 * `mount()`.
 */
export interface SurfaceModule {
  readonly mount: MountFn;
  readonly meta?: SurfaceMeta;
}
