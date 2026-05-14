// Barrel for `apps/server/src/auth`.
//
// Refinement: tasks/refinements/backend/oauth_provider_config.md,
//             tasks/refinements/backend/oauth_callback_handler.md
// TaskJuggler: backend.auth.oauth_provider_config,
//              backend.auth.oauth_callback_handler
//
// Re-exports the OIDC config + flow + route surface for sibling tasks
// that wire screen-name collection, session-token issuance, and the
// auth middleware. Future siblings extend this barrel; they should not
// import from the per-file modules directly so the surface evolves in
// one place.

export {
  loadOidcConfig,
  getOidcClient,
  oidcEnvSchema,
  OidcConfigError,
  Configuration,
  __isOidcClientCached,
  __buildStubConfiguration,
  type OidcConfig,
  type OidcEnv,
  type OidcDiscoveryOptions,
} from './config.js';

export {
  beginAuthFlow,
  completeAuthFlow,
  AuthStateMismatchError,
  type BeginAuthFlowParams,
  type BeginAuthFlowResult,
  type BeginAuthFlowOptions,
  type CompleteAuthFlowExpected,
  type CompleteAuthFlowResult,
  type CompleteAuthFlowOptions,
} from './flow.js';

export {
  createFlowStateStore,
  getDefaultFlowStateStore,
  computeExpiresAt,
  DEFAULT_FLOW_STATE_TTL_MS,
  __resetDefaultFlowStateStore,
  type FlowStateStore,
  type FlowStateEntry,
  type FlowStateStoreOptions,
} from './flow-state.js';

export {
  authRoutesPlugin,
  namespacedOauthSubject,
  upsertUserByOauthSubject,
  updatePendingScreenName,
  PLACEHOLDER_SCREEN_NAME,
  __buildTestAuthApp,
  type AuthRoutesOptions,
} from './routes.js';

export {
  assertSafeCookieValue,
  InvalidCookieValueError,
  SAFE_COOKIE_VALUE_REGEX,
} from './cookie-charset.js';

export {
  PENDING_COOKIE_NAME,
  PENDING_COOKIE_TTL_MS,
  SESSION_TOKEN_SECRET_MIN_BYTES,
  SESSION_TOKEN_SECRET_DEV_DENYLIST,
  SessionSecretRejectedError,
  signPendingCookie,
  verifyPendingCookie,
  buildPendingCookieHeader,
  buildPendingCookieClearHeader,
  readPendingCookieFromHeader,
  resolveSessionTokenSecret,
  type PendingCookiePayload,
  type VerifyResult,
} from './pending-cookie.js';

export {
  SESSION_COOKIE_NAME,
  SESSION_TOKEN_TTL_MS,
  SESSION_TOKEN_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  buildSessionCookieHeader,
  buildSessionCookieClearHeader,
  readSessionCookieFromHeader,
  type SessionTokenPayload,
  type SignSessionTokenOptions,
} from './session-token.js';

export {
  authenticatePlugin,
  authenticateRequest,
  AUTH_REQUIRED_CODE,
  AUTH_REQUIRED_MESSAGE,
  type AuthMiddlewareOptions,
  type AuthUser,
} from './middleware.js';

export {
  addToDenylist,
  isJtiRevoked,
  sweepExpiredDenylistRows,
  startDenylistSweeper,
  getDefaultDenylistSweeper,
  resolveDenylistSweepIntervalMs,
  AUTH_DENYLIST_SWEEP_INTERVAL_ENV,
  DEFAULT_DENYLIST_SWEEP_INTERVAL_MS,
  __resetDefaultDenylistSweeper,
  type DenylistRow,
  type DenylistSweeperHandle,
} from './token-denylist.js';
