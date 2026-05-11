// OIDC authorization-code flow primitives.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.oauth_callback_handler
//
// **What this module owns.** Two pure functions over an injected
// openid-client `Configuration`:
//
//   1. `beginAuthFlow(client, params)` — generates fresh PKCE
//      `code_verifier` + S256 `code_challenge`, fresh `state`, fresh
//      `nonce`, and builds the authorization URL. Returns the URL
//      and the trio of secrets the caller stores server-side keyed
//      by `state`. The caller is the route plugin's `/auth/login`
//      handler.
//   2. `completeAuthFlow(client, currentUrl, expected)` — exchanges
//      the inbound authorization code for tokens (via
//      `authorizationCodeGrant`), validates the id_token's signature
//      / audience / issuer / exp / nonce / state / PKCE in one call,
//      and returns `{ sub }` — the OIDC subject identifier and
//      nothing else (per the no-profile-data rule, ADR 0002). The
//      caller is the route plugin's `/auth/callback` handler.
//
// **Why these are pure functions.** Both take a `Configuration` as
// an explicit argument rather than reaching for the module-level
// `getOidcClient` singleton. The Fastify plugin layer composes the
// two — it acquires the Configuration via `getOidcClient(config)` at
// route-handler time and passes it down. Decoupling here means:
//
//   - Tests build a stub Configuration via `__buildStubConfiguration`
//     (or mock `authorizationCodeGrant`) without any module-mutation
//     ceremony.
//   - The eventual `session_token_management` sibling can re-use
//     `completeAuthFlow` to refresh tokens against the same shape
//     if the refresh-token flow lands in a different module.
//   - The no-profile-data audit can grep this file and confirm
//     exactly one `.claims()` call and exactly one `sub` read.
//
// **What this module does NOT own:**
//
//   - Generating the redirect URI string — that's `OidcConfig.redirectUri`,
//     derived once in `auth/config.ts`.
//   - Persisting state/nonce/verifier — that's `flow-state.ts`.
//   - The Fastify route handlers themselves — that's `routes.ts`.
//   - The users-table upsert — that's `routes.ts` reaching the DB
//     pool directly. (We deliberately keep this module DB-free so
//     the unit tests don't need a pglite fixture to exercise the
//     OIDC handshake.)
//   - Session-cookie issuance — `session_token_management`.

import {
  authorizationCodeGrant as defaultAuthorizationCodeGrant,
  buildAuthorizationUrl as defaultBuildAuthorizationUrl,
  calculatePKCECodeChallenge as defaultCalculatePKCECodeChallenge,
  randomNonce as defaultRandomNonce,
  randomPKCECodeVerifier as defaultRandomPKCECodeVerifier,
  randomState as defaultRandomState,
  type Configuration,
} from 'openid-client';

/**
 * Parameters the route layer hands to `beginAuthFlow`. The
 * `Configuration` carries the authorization endpoint URL via the
 * discovery document; this argument carries everything that varies
 * per-flow.
 */
export interface BeginAuthFlowParams {
  /**
   * Where the issuer should redirect the user after authentication.
   * Must match one of the `redirect_uris` registered with the
   * client. The value lives on `OidcConfig.redirectUri`; the route
   * plugin reads it once at startup and passes it here.
   */
  readonly redirectUri: string;
  /**
   * OIDC scopes to request. Defaults to `'openid'` (the minimum
   * required to receive an id_token). The handler does NOT request
   * `profile` or `email` — per ADR 0002, the platform reads no
   * profile data; requesting the scope at all would invite the
   * issuer to ship claim values we then must explicitly ignore. The
   * no-profile-data audit verifies the default is `openid` only.
   */
  readonly scope?: string;
}

/**
 * Result of `beginAuthFlow`. The caller stores `{ nonce, codeVerifier }`
 * (plus an expiry the caller controls) keyed by `state` in the
 * flow-state store, then sends `url` as a 302 Location.
 */
export interface BeginAuthFlowResult {
  /** Authorization URL the user should be redirected to. */
  readonly url: URL;
  /** Fresh `state` value, to be carried back on the callback URL. */
  readonly state: string;
  /** Fresh `nonce` value, to be asserted against the id_token claim. */
  readonly nonce: string;
  /** PKCE `code_verifier` — kept server-side, sent on token exchange. */
  readonly codeVerifier: string;
}

/**
 * Injection points for the flow primitives. Production code paths
 * pass nothing (the function reaches for the real `openid-client`
 * exports); tests pass overrides to avoid network and to pin
 * deterministic random values.
 *
 * Each field is optional — tests typically override only the ones
 * the case needs.
 */
export interface BeginAuthFlowOptions {
  buildAuthorizationUrl?: typeof defaultBuildAuthorizationUrl;
  calculatePKCECodeChallenge?: typeof defaultCalculatePKCECodeChallenge;
  randomNonce?: typeof defaultRandomNonce;
  randomPKCECodeVerifier?: typeof defaultRandomPKCECodeVerifier;
  randomState?: typeof defaultRandomState;
}

/**
 * Initiate the OIDC authorization-code flow.
 *
 * Generates fresh entropy (PKCE verifier, state, nonce), derives the
 * S256 challenge, and builds the authorization URL with the
 * expected query parameters:
 *
 *   - `client_id` — taken from the Configuration's client metadata
 *     by `buildAuthorizationUrl` itself; not passed here.
 *   - `redirect_uri` — passed through from params.
 *   - `response_type=code`.
 *   - `scope=openid` (default; see `BeginAuthFlowParams.scope`).
 *   - `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.
 *
 * @param client - the configured OIDC `Configuration`.
 * @param params - per-flow inputs (redirect URI, scope).
 * @param options - test-only injection overrides.
 * @returns `{ url, state, nonce, codeVerifier }`. The caller persists
 *          the trio of secrets keyed by `state` and redirects to `url`.
 */
export async function beginAuthFlow(
  client: Configuration,
  params: BeginAuthFlowParams,
  options: BeginAuthFlowOptions = {},
): Promise<BeginAuthFlowResult> {
  const randomStateFn = options.randomState ?? defaultRandomState;
  const randomNonceFn = options.randomNonce ?? defaultRandomNonce;
  const randomPKCECodeVerifierFn = options.randomPKCECodeVerifier ?? defaultRandomPKCECodeVerifier;
  const calculatePKCECodeChallengeFn =
    options.calculatePKCECodeChallenge ?? defaultCalculatePKCECodeChallenge;
  const buildAuthorizationUrlFn = options.buildAuthorizationUrl ?? defaultBuildAuthorizationUrl;

  const state = randomStateFn();
  const nonce = randomNonceFn();
  const codeVerifier = randomPKCECodeVerifierFn();
  const codeChallenge = await calculatePKCECodeChallengeFn(codeVerifier);
  const scope = params.scope ?? 'openid';

  // `buildAuthorizationUrl(config, parameters)` accepts a `Record<string, string>`
  // and constructs the URL using the Configuration's discovered
  // `authorization_endpoint`. The client_id is sourced from the
  // Configuration's client metadata automatically — we don't pass
  // it explicitly here.
  const url = buildAuthorizationUrlFn(client, {
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url, state, nonce, codeVerifier };
}

/**
 * Expected values the callback handler asserts against. The route
 * plugin pulls these from the flow-state store using the inbound
 * `state` as the key.
 */
export interface CompleteAuthFlowExpected {
  /** State value the login redirect carried. Must match the inbound state. */
  readonly expectedState: string;
  /** Nonce value to assert against the id_token claim. */
  readonly expectedNonce: string;
  /** PKCE verifier to send on the token-exchange. */
  readonly codeVerifier: string;
}

/**
 * Result of a successful callback. Carries ONLY the OIDC subject
 * identifier — no other claim is read off the id_token per ADR 0002.
 * The `no_profile_data_policy` audit verifies this surface.
 */
export interface CompleteAuthFlowResult {
  /** OIDC subject identifier (the issuer's `sub` claim verbatim). */
  readonly sub: string;
}

/**
 * Test injection points for `completeAuthFlow`. Production callers
 * pass nothing.
 */
export interface CompleteAuthFlowOptions {
  authorizationCodeGrant?: typeof defaultAuthorizationCodeGrant;
}

/**
 * Thrown when the inbound callback's `state` doesn't match the
 * expected value. The route plugin catches this and surfaces a 400
 * `auth-state-invalid` envelope; tests assert against the class.
 *
 * Distinct from `openid-client`'s internal validation errors (which
 * surface as plain `Error` subclasses from inside
 * `authorizationCodeGrant`) so the route plugin can distinguish
 * "we already knew this was bad before calling the library" from
 * "the library rejected the token exchange."
 */
export class AuthStateMismatchError extends Error {
  override readonly name = 'AuthStateMismatchError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Complete the OIDC authorization-code flow.
 *
 * Validates that the inbound `state` matches `expected.expectedState`,
 * then hands `currentUrl` + the expected nonce + the PKCE verifier
 * to `authorizationCodeGrant`. The library:
 *
 *   1. Extracts the authorization code from `currentUrl`'s query.
 *   2. POSTs to the token endpoint with code + `code_verifier`.
 *   3. Validates the returned id_token's signature against the issuer's
 *      JWKS, the audience against the client_id, the issuer claim, the
 *      expiration, AND the nonce claim against `expectedNonce`.
 *   4. Returns the parsed `TokenEndpointResponse` with `.claims()`
 *      yielding the id_token's payload.
 *
 * From the returned claims we read **only** `sub`. The
 * `no_profile_data_policy` audit greps this file and confirms exactly
 * one `.sub` reference.
 *
 * @param client - the configured OIDC `Configuration`.
 * @param currentUrl - the request URL with the callback's query params
 *                     (`code`, `state`, etc.).
 * @param expected - state / nonce / verifier the login leg stored.
 * @param options - test-only injection overrides.
 * @returns `{ sub }` on success.
 * @throws `AuthStateMismatchError` if `currentUrl.searchParams.get('state')`
 *         doesn't match `expected.expectedState`.
 * @throws any error openid-client throws on token-exchange / id_token
 *         validation failure.
 */
export async function completeAuthFlow(
  client: Configuration,
  currentUrl: URL,
  expected: CompleteAuthFlowExpected,
  options: CompleteAuthFlowOptions = {},
): Promise<CompleteAuthFlowResult> {
  const inboundState = currentUrl.searchParams.get('state');
  if (inboundState !== expected.expectedState) {
    throw new AuthStateMismatchError(
      'authorization state on callback does not match the expected value',
    );
  }

  const authorizationCodeGrantFn = options.authorizationCodeGrant ?? defaultAuthorizationCodeGrant;

  // `authorizationCodeGrant(config, url, checks)` performs the token
  // exchange AND id_token validation in one call. The `checks` argument
  // names every assertion the library makes:
  //   - `expectedState`: re-asserts state inside the library too (we
  //     check above for early rejection; the library check is the
  //     defense-in-depth).
  //   - `expectedNonce`: cross-checks the id_token's `nonce` claim.
  //   - `pkceCodeVerifier`: sent to the token endpoint as the PKCE
  //     verifier, matched against the challenge the auth endpoint
  //     remembers.
  const tokens = await authorizationCodeGrantFn(client, currentUrl, {
    expectedState: expected.expectedState,
    expectedNonce: expected.expectedNonce,
    pkceCodeVerifier: expected.codeVerifier,
  });

  // The library only resolves the promise when an id_token was issued
  // AND validated successfully. `tokens.claims()` returns the parsed
  // id_token payload; we read ONLY `sub`. Reading any other field
  // would violate the no-profile-data rule audited by the sibling
  // task. The single `.sub` access on the next line is the canonical
  // read site the audit greps for.
  const claims = tokens.claims();
  if (claims === undefined) {
    // Shouldn't happen — `expectedNonce` forces an id_token in the
    // response per the library's contract. Guard defensively so a
    // future library version that loosens the contract surfaces here
    // rather than as a downstream NPE.
    throw new Error('OIDC token response did not include id_token claims');
  }
  const sub = claims.sub;
  return { sub };
}
