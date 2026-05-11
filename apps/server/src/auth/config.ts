// OIDC client configuration — env-var validation and discovery wiring.
//
// Refinement: tasks/refinements/backend/oauth_provider_config.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_provider_config
//
// **What this module owns**
//
// 1. A Zod schema (`oidcEnvSchema`) that validates the four OIDC env
//    vars at server boot: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
//    `OIDC_CLIENT_SECRET`, and `APP_BASE_URL`. Malformed or missing
//    values throw `OidcConfigError` at config-load time so the server
//    never starts in a half-configured state. (The migration gate in
//    `index.ts` already establishes the "fail at boot, not at first
//    request" convention; this module follows the same pattern.)
//
// 2. `loadOidcConfig(env)` — pure function from a `Record<string, string>`
//    (typically `process.env`) to a typed `OidcConfig`. Returns the
//    derived `redirectUri` (`${APP_BASE_URL}/auth/callback`) alongside
//    the env-supplied values so the eventual callback handler reads a
//    single field rather than re-deriving the URL.
//
// 3. `getOidcClient(config)` — memoized OIDC discovery. The first call
//    against a given `OidcConfig` performs the network round-trip to
//    the issuer's `/.well-known/openid-configuration` endpoint and
//    builds a configured `openid-client` `Configuration` instance.
//    Subsequent calls with the same `OidcConfig` reference return the
//    cached instance. Discovery is a one-shot, not per-request — the
//    Authelia / Google / GitHub metadata document changes orders of
//    magnitude less often than HTTP requests.
//
// **What this module does NOT own** — deferred to sibling tasks:
//
//   - `/auth/login` / `/auth/callback` route handlers
//     → `backend.auth.oauth_callback_handler`.
//   - Screen-name collection on first auth
//     → `backend.auth.screen_name_collection`.
//   - Session-token issuance and validation
//     → `backend.auth.session_token_management`.
//   - Middleware enforcing auth on protected endpoints
//     → `backend.auth.auth_middleware`.
//
// **Why `openid-client` (panva)**
//
// Per ADR 0002 the backend is a generic OIDC client — it speaks one
// protocol to one issuer URL and the upstream-provider zoo (Google,
// GitHub, GitLab, the dev Authelia stack) lives behind Authelia's YAML.
// `openid-client` is the spec-compliant, mature TypeScript OIDC library
// for that exact shape: handles discovery, PKCE, id_token validation,
// JWKS, and the auth-code grant. Alternatives (`fastify-oauth2`, hand-
// rolled) either lose the OIDC features we need or push the spec's
// edge cases into application code.
//
// **Discovery caching shape**
//
// The cache is a `WeakMap<OidcConfig, Promise<Configuration>>`. Keying
// on the config object reference (not the issuer URL string) means:
//   - Tests can build fresh `OidcConfig` instances and get fresh
//     discovery without process-global state to reset.
//   - The promise (not the resolved value) is stored so concurrent
//     `getOidcClient(config)` calls share a single network round-trip
//     rather than racing.
//   - Memory cleanup happens automatically if a caller drops its
//     `OidcConfig` reference.
//
// **No client-secret logging anywhere in this module.** The secret
// passes through `loadOidcConfig` → `getOidcClient` → openid-client's
// internals and never reaches a log line. The Zod schema's error
// messages reference field names, not values, so a parse failure
// won't leak the secret either.

import { z } from 'zod';
import {
  Configuration,
  discovery as defaultDiscovery,
  allowInsecureRequests as defaultAllowInsecureRequests,
  type ServerMetadata,
} from 'openid-client';

// Re-export the runtime `Configuration` type alias for sibling tasks
// (oauth_callback_handler, session_token_management) so they don't
// need a direct `openid-client` import. The class lives at workspace
// boundary so the tests can build stub instances without dragging
// `openid-client` into the test tsconfig's resolver.
export { Configuration };

/**
 * Zod schema validating the OIDC-related env vars.
 *
 * The four fields:
 *
 *   - `OIDC_ISSUER_URL` — the OIDC issuer base URL. Validated as a
 *     URL string; the eventual `discovery(...)` call appends
 *     `/.well-known/openid-configuration` to it. In the dev compose
 *     stack this is `http://authelia:9091`; from a host shell it's
 *     `http://localhost:9091`.
 *   - `OIDC_CLIENT_ID` — the client identifier registered with
 *     Authelia (or the production OIDC provider). Free-form string;
 *     dev value is `aconversa-app-dev`. Not a UUID — Authelia accepts
 *     any non-empty identifier and the ADR doesn't constrain the
 *     shape, so the schema only checks non-empty.
 *   - `OIDC_CLIENT_SECRET` — the plaintext client secret the backend
 *     presents to the token endpoint. Non-empty string; never logged,
 *     never echoed in error messages.
 *   - `APP_BASE_URL` — the public-facing base URL of the application
 *     (the half users navigate to, not the in-Compose service-to-
 *     service URL). The redirect URI is derived as
 *     `${APP_BASE_URL}/auth/callback`. Defaults to
 *     `http://localhost:3000` for the local-dev / host-shell case;
 *     production sets this to the public hostname.
 *
 * `OIDC_CLIENT_SECRET`'s minimum length is 1 — the dev secret is
 * `aconversa-app-dev-secret` which is well above any reasonable
 * minimum, but the schema only enforces "present and non-empty"
 * because production secrets are arbitrary high-entropy strings whose
 * shape we don't constrain here.
 */
export const oidcEnvSchema = z.object({
  OIDC_ISSUER_URL: z
    .string()
    .url({ message: 'OIDC_ISSUER_URL must be a valid URL (e.g. http://authelia:9091)' }),
  OIDC_CLIENT_ID: z.string().min(1, { message: 'OIDC_CLIENT_ID must be a non-empty string' }),
  OIDC_CLIENT_SECRET: z
    .string()
    .min(1, { message: 'OIDC_CLIENT_SECRET must be a non-empty string' }),
  APP_BASE_URL: z
    .string()
    .url({ message: 'APP_BASE_URL must be a valid URL (e.g. http://localhost:3000)' })
    .default('http://localhost:3000'),
});

/**
 * Type of a successfully parsed OIDC env block. Exposed so call sites
 * (tests, the callback handler) can name the shape.
 */
export type OidcEnv = z.infer<typeof oidcEnvSchema>;

/**
 * Resolved OIDC configuration consumed by the callback handler and
 * any sibling that needs to build an authorization URL or exchange a
 * code. The redirect URI is derived once at load time so callers see
 * one source of truth instead of re-stringing `${APP_BASE_URL}/auth/callback`
 * in every site.
 *
 * **Field-by-field**
 *
 *   - `issuerUrl` — already-parsed `URL` instance. openid-client's
 *     `discovery(...)` takes a `URL`, not a string; converting once
 *     here means the rest of the code path doesn't need to repeat
 *     the parse.
 *   - `clientId` — passed through from env, untouched.
 *   - `clientSecret` — passed through. Wrapped in no helper, no
 *     toString-override; the simpler the carrier the harder it is to
 *     leak by accident.
 *   - `appBaseUrl` — the validated base URL string. Same shape as
 *     env so error messages and config dumps can mention "APP_BASE_URL"
 *     verbatim.
 *   - `redirectUri` — `${appBaseUrl}/auth/callback`. Must match one
 *     of the `redirect_uris` registered in
 *     `infra/authelia/configuration.yml` (the dev client allows both
 *     `http://localhost:3000/auth/callback` and
 *     `http://localhost:5173/auth/callback`); production swaps both
 *     the registered list and this env var to the public hostname.
 *
 * The shape is `readonly` to discourage in-place mutation — a sibling
 * that needed to override (say) `redirectUri` for a deployment-specific
 * flow should construct a fresh config via `loadOidcConfig(...)` from
 * an overridden env, not mutate a shared instance.
 */
export interface OidcConfig {
  readonly issuerUrl: URL;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly appBaseUrl: string;
  readonly redirectUri: string;
}

/**
 * Thrown when `loadOidcConfig` fails to parse / validate its input.
 * Wraps the underlying Zod error so callers (server bootstrap, tests)
 * can pattern-match on a single error type without depending on Zod
 * being the validator. The `issues` array carries per-field
 * diagnostic detail — field names only, never values, so a failure
 * dump can be logged without redacting.
 */
export class OidcConfigError extends Error {
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;

  public constructor(zodError: z.ZodError) {
    const issues = zodError.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    super(`OIDC config is invalid: ${summary}`);
    this.name = 'OidcConfigError';
    this.issues = issues;
  }
}

/**
 * Parse and validate OIDC env vars into a typed `OidcConfig`. Pass
 * `process.env` (or a test-double `Record<string, string>`) and
 * receive either a fully-validated config or an `OidcConfigError`
 * describing every malformed / missing field.
 *
 * **Why a function and not a singleton.** The server bootstrap calls
 * this once at startup; tests call it per-test with bespoke env
 * inputs. A module-level `const config = loadOidcConfig(process.env)`
 * would force every test to monkey-patch `process.env` and would
 * couple module-load order to env presence. The function shape keeps
 * test inputs explicit and the bootstrap loud about when validation
 * happens.
 *
 * **Type narrowing for `exactOptionalPropertyTypes`.** The shared
 * tsconfig sets `exactOptionalPropertyTypes: true`; we pick known
 * keys off the input rather than spreading it so Zod's `parse` sees
 * a clean `Record<string, string | undefined>` regardless of which
 * extra keys the caller's env carries. (process.env has hundreds of
 * unrelated entries on most hosts.)
 */
export function loadOidcConfig(env: Record<string, string | undefined>): OidcConfig {
  const candidate = {
    OIDC_ISSUER_URL: env['OIDC_ISSUER_URL'],
    OIDC_CLIENT_ID: env['OIDC_CLIENT_ID'],
    OIDC_CLIENT_SECRET: env['OIDC_CLIENT_SECRET'],
    APP_BASE_URL: env['APP_BASE_URL'],
  };
  const parsed = oidcEnvSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new OidcConfigError(parsed.error);
  }
  const data = parsed.data;
  // Strip a trailing slash off APP_BASE_URL before composing the
  // redirect URI so `http://localhost:3000/` and `http://localhost:3000`
  // both produce `http://localhost:3000/auth/callback` (rather than a
  // double-slash variant that Authelia's redirect-URI check would
  // reject). The URL spec considers the two forms equivalent; Authelia
  // does a string compare against its registered list.
  const appBaseUrl = data.APP_BASE_URL.replace(/\/$/, '');
  return {
    issuerUrl: new URL(data.OIDC_ISSUER_URL),
    clientId: data.OIDC_CLIENT_ID,
    clientSecret: data.OIDC_CLIENT_SECRET,
    appBaseUrl,
    redirectUri: `${appBaseUrl}/auth/callback`,
  };
}

/**
 * Cache for memoized discovery. Keyed by the `OidcConfig` reference
 * (NOT the issuer URL string) so:
 *
 *   - Tests get fresh discovery per `loadOidcConfig` call without
 *     reaching into module-level state.
 *   - Two configs pointing at the same issuer URL (e.g., a redeploy
 *     with rotated credentials) discover independently.
 *   - Garbage collection follows config references — if the caller
 *     drops the config, the cached promise becomes eligible too.
 *
 * The cached value is the `Promise<Configuration>`, not the resolved
 * value. Storing the promise means:
 *
 *   - Concurrent first-callers share one network round-trip rather
 *     than racing N parallel discoveries against the issuer.
 *   - A failed discovery's rejection is cached too; callers that
 *     `await` a re-attempt re-throw the same rejection. To re-attempt
 *     after a transient failure, drop the config reference and load
 *     a fresh one. (The bootstrap calls `loadOidcConfig` once at
 *     startup; a transient discovery failure aborts startup, which
 *     `compose`'s restart policy will retry. The lifetime is short
 *     enough that "cache the rejection" is the right default.)
 */
const clientCache = new WeakMap<OidcConfig, Promise<Configuration>>();

/**
 * Discovery-and-insecure-requests overrides injectable for tests.
 * Production code paths always use the defaults (`openid-client`'s
 * real `discovery` + `allowInsecureRequests`); the Vitest unit tests
 * mock the module via `vi.mock(...)` and the Cucumber scenario passes
 * a real-but-network-free implementation via this options object.
 *
 * `discovery` returns a `Configuration` instance. In production this
 * is the result of an HTTP fetch to the issuer's
 * `/.well-known/openid-configuration`; in tests it can be a
 * `new Configuration(stubServerMetadata, clientId, clientSecret)`
 * construction (no network).
 *
 * `allowInsecureRequests` toggles openid-client's reject-http-issuers
 * default off; needed for the dev Authelia case
 * (`http://authelia:9091`). Tests don't usually need to assert
 * against the toggle but can if they want.
 */
export interface OidcDiscoveryOptions {
  discovery?: (server: URL, clientId: string, clientSecret: string) => Promise<Configuration>;
  allowInsecureRequests?: (config: Configuration) => void;
}

/**
 * Memoized OIDC discovery. First call against a given `OidcConfig`
 * fetches the issuer's discovery document and constructs a
 * configured `openid-client` `Configuration` instance; subsequent
 * calls with the same `OidcConfig` reference return the cached
 * instance (or rejection — see `clientCache` above).
 *
 * The returned `Configuration` is what every sibling consumes:
 * `oauth_callback_handler` passes it to `authorizationCodeGrant(...)`,
 * `session_token_management` reads `serverMetadata().issuer` off it,
 * and so on.
 *
 * **Discovery insecure-issuer policy.** The default in openid-client
 * v6 is to reject http:// issuer URLs (it expects https://). For the
 * dev Authelia stack the issuer URL is `http://authelia:9091`, which
 * is fine — local-only, Compose-internal, never sees the public
 * internet. The function detects an http issuer and applies
 * `allowInsecureRequests(config)` to opt in to the dev shape; production
 * issuer URLs are https and the helper is a no-op there.
 *
 * **`options` is test-only.** Production callers pass no options and
 * the function reaches for the real openid-client exports. Tests
 * pass a stub `discovery` so the unit / integration layers exercise
 * the wiring without a live issuer. The `options` parameter is the
 * SAME object across calls within a single test scenario; the cache
 * key remains the `OidcConfig` reference (the options bag is not
 * part of the cache key).
 */
export async function getOidcClient(
  config: OidcConfig,
  options: OidcDiscoveryOptions = {},
): Promise<Configuration> {
  const cached = clientCache.get(config);
  if (cached) {
    return cached;
  }
  const discoveryFn = options.discovery ?? defaultDiscovery;
  const allowInsecureRequestsFn = options.allowInsecureRequests ?? defaultAllowInsecureRequests;
  // openid-client v6's `discovery(server, clientId, metadata)` accepts
  // the client secret as the third arg (string shorthand for
  // `{ client_secret: ... }`). The library then defaults to
  // `ClientSecretPost` for token-endpoint auth; the dev Authelia
  // client is registered as `client_secret_basic`, but openid-client
  // negotiates the method based on what the discovery document
  // advertises and what the client supports — `client_secret_basic`
  // is one of the auth methods Authelia exposes. Should the
  // production Authelia config switch to a different method
  // (e.g., `private_key_jwt`), this call evolves to pass the matching
  // `clientAuthentication` helper as the fourth argument.
  const promise = (async (): Promise<Configuration> => {
    const result = await discoveryFn(config.issuerUrl, config.clientId, config.clientSecret);
    if (config.issuerUrl.protocol === 'http:') {
      allowInsecureRequestsFn(result);
    }
    return result;
  })();
  clientCache.set(config, promise);
  return promise;
}

/**
 * Test-only helper exposing the size of the discovery cache. Useful
 * for asserting memoization without exposing the WeakMap directly
 * (WeakMaps have no `size` accessor by design). The number returned
 * is `0` or `1` — at most one entry per `OidcConfig` ever lives in
 * the cache. Not part of the production API surface; sibling code
 * should never call this.
 */
export function __isOidcClientCached(config: OidcConfig): boolean {
  return clientCache.has(config);
}

/**
 * Test-only helper that builds a real `openid-client` `Configuration`
 * via the public constructor with a stub `ServerMetadata`. Production
 * code paths never call this — they build configurations via
 * `discovery(...)` (the network round-trip) inside `getOidcClient`.
 * Tests use it to provide a stub `discovery` function that returns a
 * real Configuration instance whose `.clientMetadata().client_id`
 * accessor behaves identically to the production object.
 *
 * Exposed from this module rather than constructed at the test-file
 * level so the `openid-client` import stays at the workspace
 * boundary (`apps/server` ships the dep; `tests/behavior` does not
 * resolve it directly).
 *
 * Marked with the `__` prefix so a grep for "production callers"
 * skips it and a future lint rule can reject test-helper imports
 * from production code.
 */
export function __buildStubConfiguration(
  issuerUrl: URL,
  clientId: string,
  clientSecret: string,
): Configuration {
  const serverMetadata: ServerMetadata = { issuer: issuerUrl.toString() };
  return new Configuration(serverMetadata, clientId, clientSecret);
}
