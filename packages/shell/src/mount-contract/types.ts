// Mount-contract types — the TypeScript surface every UI bundle (moderator,
// participant, audience, replay-test) exports and the root-app dispatcher
// consumes.
//
// Refinement: tasks/refinements/shell-package/shell_mount_contract.md
// ADRs:        docs/adr/0026-micro-frontend-root-app.md (decision 2 — Vite
//              library mode + the host-to-surface mount contract sketched on
//              lines 37-55), docs/adr/0022-no-throwaway-verifications.md
//              (the no-op-surface case in `./mount-contract.test.ts` pins
//              the minimum-viable shape).
//
// Pure types. No runtime code, no React imports, no DOM imports beyond
// `HTMLElement` (a built-in `lib.dom.d.ts` interface). Every concrete
// implementation downstream — `shell_auth_context`, `shell_i18n_bootstrap`,
// `shell_ws_client` — widens the placeholder interfaces here; the placeholder
// is the FLOOR consumers can count on, not the ceiling.

/**
 * Forward-declared placeholder for the host-supplied auth state.
 *
 * Real implementation lands in `shell_auth_context`. The placeholder lists
 * the bare-minimum shape every surface consumes:
 *
 * - `status` — exhaustive discriminant matching the moderator's existing
 *   `AuthStatus` (`apps/moderator/src/auth/useAuth.ts` line 52).
 * - `user` — optional, populated when `status === 'authenticated'` (and
 *   `needs-screen-name` while the screen-name form is open). Two fields
 *   only — userId + screenName — symmetric with the no-OIDC-profile-data
 *   audit in the backend.
 * - `refresh` / `logout` — accept `Promise<void> | void` so the real impl
 *   can be async (moderator's `useAuth.ts` returns `Promise<void>`) without
 *   forcing every consumer to `await`.
 *
 * Consumers that need richer fields (e.g. a typed `error` surface) cast at
 * the call site when `shell_auth_context` widens; the contract here stays
 * minimum-disclosure.
 */
export interface AuthContextValue {
  readonly status: 'loading' | 'unauthenticated' | 'needs-screen-name' | 'authenticated';
  readonly user?: {
    readonly userId: string;
    readonly screenName: string;
  };
  readonly refresh: () => Promise<void> | void;
  readonly logout: () => Promise<void> | void;
}

/**
 * Forward-declared placeholder for the host-supplied i18n instance.
 *
 * Real implementation lands in `shell_i18n_bootstrap` and will likely
 * re-export `i18next`'s `i18n` type directly. The placeholder lists the
 * bare-minimum subset of `i18next.i18n` surfaces actually invoke so the
 * contract does NOT pull in the `i18next` dependency itself. Consumers
 * that need the richer surface cast at the call site
 * (`props.i18n as unknown as i18next.i18n`).
 */
export interface I18n {
  readonly t: (key: string, vars?: Record<string, unknown>) => string;
  readonly language: string;
  readonly changeLanguage: (lang: string) => Promise<void>;
}

/**
 * Forward-declared placeholder for the host-supplied WebSocket client.
 *
 * Real implementation lands in `shell_ws_client`; the moderator's existing
 * `apps/moderator/src/ws/client.ts` is the reference shape. The placeholder
 * lists only the methods surfaces use day-to-day:
 *
 * - `subscribe(kind, handler)` returns an unsubscribe function.
 * - `send(kind, payload)` is fire-and-forget at the placeholder level; the
 *   real `WsClient` widens to a typed request/response shape.
 *
 * `event` and `payload` are typed `unknown` (not the moderator's typed
 * `WsEnvelopeUnion`) because this leaf does not depend on
 * `@a-conversa/shared-types` — that dependency is `shell_ws_client`'s job.
 * Consumers narrow at the call site.
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

/**
 * The dependency bag the host passes into a surface's `mount()`.
 *
 * Per ADR 0026 decision 2, the host owns the React DOM root, the URL
 * prefix dispatcher, the auth context, the i18n instance, and the WS
 * client; the surface owns its own `<BrowserRouter basename={routerBasePath}>`
 * and its own route tree under that base path.
 *
 * Fields:
 *
 * - `container` — the `HTMLElement` the surface renders into. The host
 *   creates and tears down this node around each mount/unmount cycle.
 * - `auth` — the host-supplied auth state. Placeholder shape; real impl
 *   in `shell_auth_context`.
 * - `i18n` — the host-supplied i18n instance. Placeholder shape; real impl
 *   in `shell_i18n_bootstrap`.
 * - `routerBasePath` — the URL prefix the surface mounts under (e.g. `'/m'`
 *   for moderator). The surface does
 *   `<BrowserRouter basename={props.routerBasePath}>` so the route
 *   definitions inside stay relative and the prefix is the host's concern.
 * - `ws` — optional. The audience surface may not need WS for v1
 *   (unauthenticated read-only views); the replay-test surface ships
 *   without one.
 * - `locale` — optional BCP-47 string (e.g. `'pt-BR'`). Denormalized
 *   convenience for surfaces that want the resolved locale at mount time
 *   without reading `i18n.language`.
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
 *
 * Per ADR 0026 decision 2, unmount is intentionally synchronous — the
 * host's contract is "I tear down your container now; you have a
 * synchronous chance to clean up React state and event listeners." Surfaces
 * that need to drain async work (outgoing WS sends, in-flight fetches)
 * own the drain themselves and the host does not await.
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
