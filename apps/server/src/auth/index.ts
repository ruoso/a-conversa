// Barrel for `apps/server/src/auth`.
//
// Refinement: tasks/refinements/backend/oauth_provider_config.md
// TaskJuggler: backend.auth.oauth_provider_config
//
// Re-exports the OIDC config surface for sibling tasks that wire the
// callback handler, session-token management, and the auth middleware.
// Future siblings extend this barrel; they should not import from the
// per-file modules directly so the surface evolves in one place.

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
