// Public surface of `@a-conversa/shell`.
//
// Refinement: tasks/refinements/shell-package/shell_pkg_skeleton.md
//   (skeleton) + tasks/refinements/shell-package/shell_substrate_extraction.md
//   (the six substrate subsystems land here)
// ADR:        docs/adr/0026-micro-frontend-root-app.md
//
// This package is the shared substrate consumed by the root app
// (`apps/root/`) and every UI surface (`apps/moderator/`, `apps/participant/`,
// `apps/audience/`, `apps/replay-test/`) under the micro-frontend pivot.

// ─── auth ───────────────────────────────────────────────────────────────
export {
  AuthProvider,
  AuthValueProvider,
  useAuth,
  type AuthContextValue,
  type AuthError,
  type AuthValueProviderProps,
  type AuthProviderProps,
  type AuthStatus,
  type AuthUser,
} from './auth/index.js';

// ─── screen-name ─────────────────────────────────────────────────────────
export { ScreenNameForm, type ScreenNameFormProps } from './screen-name/index.js';

// ─── login / logout ──────────────────────────────────────────────────────
export { LoginButton, logout, type LoginButtonProps } from './login-logout/index.js';

// ─── i18n ────────────────────────────────────────────────────────────────
export {
  createI18nInstance,
  I18nProvider,
  type I18nInstance,
  type I18nProviderProps,
} from './i18n/index.js';

// ─── ws ──────────────────────────────────────────────────────────────────
export {
  createDefaultWsStore,
  createWsClient,
  useWsClient,
  WsClientProvider,
  WsRequestError,
  WsRequestTimeoutError,
  type BaseWsSessionState,
  type BaseWsStoreState,
  type CreateWsClientOptions,
  type EnvelopeHandler,
  type SendFn,
  type SendOptions,
  type WsClient,
  type WsClientAuthState,
  type WsClientProviderProps,
  type WsClientStatus,
  type WsConnectionStatus,
  type WsFactory,
  type WsLike,
  type WsStoreLike,
} from './ws/index.js';

// ─── error-mapper ────────────────────────────────────────────────────────
export {
  mapCreateSessionError,
  mapGenericApiError,
  mapScreenNameError,
} from './error-mapper/index.js';

// ─── mount-contract ──────────────────────────────────────────────────────
// (Canonical `AuthContextValue` already exported above from `./auth`; the
// mount-contract re-exports the same type via `./mount-contract/types.ts`.)
export type {
  I18n,
  MountFn,
  MountProps,
  SurfaceMeta,
  SurfaceModule,
  UnmountFn,
  WebSocketClient,
} from './mount-contract/index.js';

// ─── facet-pill ──────────────────────────────────────────────────────────
export {
  FacetPill,
  PILL_BASE_CLASSNAME,
  PILL_STATUS_CLASSNAME,
  VoteIndicator,
  axiomMarkColorFor,
  AXIOM_MARK_PALETTE_SIZE,
  EMPTY_VOTES,
  type FacetPillProps,
  type VoteIndicatorProps,
  type AxiomMarkColor,
  type FacetName,
  type FacetStatus,
  type Vote,
} from './facet-pill/index.js';

// ─── axiom-marks ─────────────────────────────────────────────────────────
export {
  AxiomMarkBadge,
  EMPTY_AXIOM_MARKS,
  groupAxiomMarksByNode,
  projectAxiomMarks,
  type AxiomMark,
  type AxiomMarkBadgeProps,
} from './axiom-marks/index.js';

// ─── annotations ─────────────────────────────────────────────────────────
export {
  EMPTY_ANNOTATIONS,
  groupAnnotationsByEdge,
  groupAnnotationsByNode,
  projectAnnotations,
  type Annotation,
} from './annotations/index.js';

export const SHELL_PACKAGE_VERSION = '0.1.0' as const;
