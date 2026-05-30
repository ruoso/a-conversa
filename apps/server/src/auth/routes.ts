// Fastify plugin registering the OIDC handshake routes plus the
// screen-name collection endpoint. All routes below are served under
// `/api/*` — `createServer()` (and the `__buildTestAuthApp` test
// helper) register this plugin with `{ prefix: '/api' }`, so the
// route literals here remain bare `/auth/...` and Fastify prepends
// the prefix at registration time. Refinement:
//   tasks/refinements/backend/serve_static_frontends_path_collision_fix.md.
//
//   - GET  /api/auth/login        — initiate the authorization-code flow.
//   - GET  /api/auth/callback     — handle the issuer's redirect back.
//   - POST /api/auth/screen-name  — replace `<pending>` with the chosen name.
//   - POST /api/auth/logout       — revoke + clear the session cookie.
//   - GET  /api/auth/me           — return the current authenticated user.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md,
//             tasks/refinements/backend/screen_name_collection.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.oauth_callback_handler,
//              backend.auth.screen_name_collection
//
// **Plugin shape.** The plugin is parameterized on a small options
// bag so tests can inject a stubbed `Configuration` (no live Authelia
// round-trip), a stubbed `flowState` store (deterministic TTL), and a
// pglite-backed `pool` (no real Postgres). Production callers register
// the plugin with the empty options bag (`{}`); the plugin then reads
// `OIDC_*` env vars, calls `getOidcClient(config)` lazily on first
// request, and reaches for the singleton `pg.Pool`.
//
// **The pending-cookie bridge.** Real platform-session tokens come
// from the next sibling task `session_token_management`. Until that
// lands, the callback issues a short-lived (10-minute) signed
// `aconversa-auth-pending` cookie carrying `{ userId, exp }`. That
// cookie is consumed exclusively by `POST /auth/screen-name` (the
// screen-name collection endpoint) — the request that needs to
// authorize "is this the user who just finished OIDC?" without yet
// having a full platform session. When `session_token_management`
// lands, the pending cookie is cleared and replaced with the full
// platform session cookie. See `pending-cookie.ts` and
// `tasks/refinements/backend/screen_name_collection.md` for the
// rationale.
//
// **What this plugin does NOT do** — handoffs to sibling tasks:
//
//   - Mint or set a platform session cookie. The callback returns the
//     OIDC subject + the users-table row's `userId` in the response
//     body PLUS the pending cookie; `session_token_management`
//     replaces the body with a 302 + platform session cookie.
//   - Read any claim besides `sub` off the id_token. Audited by
//     `no_profile_data_policy`.
//   - Enforce auth on any other route. Owned by `auth_middleware`.
//   - Allow a user to change their screen name after first set. Once
//     `<pending>` is replaced, this endpoint refuses further edits
//     (409); future "rename" surface is out of scope.

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import {
  type Configuration,
  getOidcClient,
  loadOidcConfig,
  type OidcConfig,
  type OidcDiscoveryOptions,
} from './config.js';
import { ApiError } from '../errors.js';
import { errorEnvelopeRef } from '../openapi.js';
import { getDefaultPool, type DbPool } from '../db.js';
import {
  AuthStateMismatchError,
  beginAuthFlow,
  type BeginAuthFlowOptions,
  type CompleteAuthFlowOptions,
  completeAuthFlow,
} from './flow.js';
import {
  computeExpiresAt,
  createFlowStateStore,
  FlowStateCapacityError,
  getDefaultFlowStateStore,
  type FlowStateStore,
} from './flow-state.js';
import {
  PENDING_COOKIE_TTL_MS,
  buildPendingCookieClearHeader,
  buildPendingCookieHeader,
  readPendingCookieFromHeader,
  resolveSessionTokenSecret,
  signPendingCookie,
  verifyPendingCookie,
} from './pending-cookie.js';
import { validateScreenName } from './screen-name.js';
import {
  buildSessionCookieClearHeader,
  buildSessionCookieHeader,
  readSessionCookieFromHeader,
  signSessionToken,
  verifySessionToken,
} from './session-token.js';
import { addToDenylist } from './token-denylist.js';

/**
 * Options accepted by `authRoutesPlugin`. Every field is optional —
 * production callers pass `{}` and the plugin reaches for env-driven
 * defaults.
 */
export interface AuthRoutesOptions {
  /**
   * Pre-loaded OIDC config. When absent the plugin reads `process.env`
   * via `loadOidcConfig(process.env)` at registration time. Tests
   * supply a pre-built config so they can pin the issuer URL / client
   * id / redirect URI without mutating `process.env`.
   */
  readonly oidcConfig?: OidcConfig;
  /**
   * Pre-resolved `Configuration`. When absent the plugin lazily calls
   * `getOidcClient(config)` on first request. Tests pass a stub
   * `Configuration` (built via `__buildStubConfiguration`) so the
   * route handlers never reach the network.
   */
  readonly oidcClient?: Configuration;
  /**
   * Options forwarded to `getOidcClient(config, options)`. Only used
   * when `oidcClient` is absent — gives tests a way to inject a
   * stubbed `discovery` function without pre-resolving the client.
   */
  readonly oidcDiscoveryOptions?: OidcDiscoveryOptions;
  /**
   * Flow-state store. When absent the plugin uses the process-wide
   * default singleton. Tests pass a fresh per-scenario store (often
   * with an injected clock for hermetic TTL assertions).
   */
  readonly flowState?: FlowStateStore;
  /**
   * Database pool. When absent the plugin lazily calls `getDefaultPool()`
   * on the first user-upsert. Tests pass a pglite-backed shim or a
   * Vitest mock so the upsert never hits real Postgres.
   */
  readonly pool?: DbPool;
  /**
   * Injection overrides for the flow primitives. Production callers
   * pass nothing; tests pass deterministic random generators and/or
   * a stubbed `authorizationCodeGrant`.
   */
  readonly beginFlowOptions?: BeginAuthFlowOptions;
  readonly completeFlowOptions?: CompleteAuthFlowOptions;
  /**
   * Clock injection for the flow-state expiry. When absent uses
   * `Date.now`. Tests pass a controllable function so they can advance
   * "time" without timer manipulation. Only used when constructing
   * the default flow-state store; passing `flowState` overrides this.
   */
  readonly now?: () => number;
  /**
   * HMAC key for signing + verifying the short-lived `aconversa-auth-pending`
   * cookie. When absent the plugin reads `SESSION_TOKEN_SECRET` from
   * `process.env` lazily on first use. Tests pass a fixed string so
   * the cookie shape is deterministic across runs.
   */
  readonly sessionTokenSecret?: string;
  /**
   * Whether to mark the pending cookie as `Secure`. When absent the
   * plugin reads `process.env.NODE_ENV === 'production'`. Tests pass
   * `false` so the cookie can be set over the in-process http inject
   * stream without browser-level Secure-only filtering tripping the
   * scenario.
   */
  readonly cookieSecure?: boolean;
  /**
   * Hook called from the logout path after the denylist row commits to
   * close every open WebSocket connection owned by the logging-out
   * user. Receives `(userId, reason)` and returns the number of
   * connections closed. Production wires
   * `closeUserConnections` from `ws/connection.ts`; tests pass a spy
   * so the assertion can verify `(userId, reason)` without standing
   * up a real WS upgrade.
   *
   * The hook is OPTIONAL — a test scenario that exercises only the
   * denylist write and the cookie-clear can omit it. When omitted, the
   * logout handler skips the WS close call. Refinement:
   * `tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`.
   */
  readonly closeUserConnectionsHook?: (userId: string, reason?: string) => number;
}

/**
 * Per-row shape returned from the users-upsert SQL. Narrowed at the
 * call site so the upsert helper doesn't need to know about the full
 * users-table schema.
 */
interface UsersUpsertRow extends Record<string, unknown> {
  readonly id: string;
  readonly oauth_subject: string;
  readonly screen_name: string;
}

/**
 * Compose the namespaced OIDC subject identifier — `${origin}:${sub}`.
 *
 * Per the users-table refinement's F2, `oauth_subject` is stored as
 * `provider:subject` to avoid cross-provider collisions. We use the
 * issuer URL's **origin** (`<protocol>//<hostname>[:port]`) as the
 * provider key — for the dev Authelia case that's
 * `http://authelia:9091` (yielding `http://authelia:9091:alice`);
 * production with an `https://auth.example.com` issuer yields
 * `https://auth.example.com:<sub>`. The origin is the
 * deployment-specific identifier the operator already controls via
 * `OIDC_ISSUER_URL`.
 *
 * Hardening note (M3-review F-008 in `docs/security/m3-review/auth.md`):
 * an earlier version used only `issuerUrl.hostname`, which collided
 * across two issuers sharing the same hostname on different ports
 * (e.g. `http://auth.example.com:9091` vs
 * `https://auth.example.com:443`) and across protocol differences
 * (http vs https). Switching to `.origin` distinguishes all three
 * dimensions (protocol, hostname, port).
 */
export function namespacedOauthSubject(issuerUrl: URL, sub: string): string {
  return `${issuerUrl.origin}:${sub}`;
}

/**
 * Placeholder screen name for freshly-inserted users. The
 * `screen_name_collection` sibling replaces this with the user-chosen
 * value via a separate endpoint. The angle brackets make the
 * placeholder visually distinct from any conceivable real screen name;
 * the literal stays within VARCHAR(64).
 */
export const PLACEHOLDER_SCREEN_NAME = '<pending>';

/**
 * Upsert by `oauth_subject` and return the user's row.
 *
 * **SQL shape.** Parameterized INSERT...ON CONFLICT DO NOTHING
 * RETURNING — when the INSERT lands a fresh row, the RETURNING clause
 * surfaces it; when the ON CONFLICT branch fires (the row already
 * existed), RETURNING is empty and we run a follow-up SELECT to load
 * the existing row. Both queries are parameterized; no string
 * concatenation, no SQL injection surface.
 *
 * Soft-deleted rows (`deleted_at IS NOT NULL`) are NOT returned by
 * the follow-up SELECT — a previously-deleted user re-authenticating
 * would conflict on `oauth_subject` (the UNIQUE constraint covers
 * deleted rows too) but the follow-up SELECT filters them out,
 * surfacing a "no row" result that the caller treats as an error. A
 * dedicated "reactivate soft-deleted user" path is out of scope here.
 *
 * @param pool - the DB pool (production singleton or test shim).
 * @param oauthSubject - the namespaced subject (`provider:sub`).
 * @returns the user row's `id`, `oauth_subject`, and `screen_name`.
 * @throws if no row can be located (soft-deleted user, race).
 */
export async function upsertUserByOauthSubject(
  pool: DbPool,
  oauthSubject: string,
): Promise<UsersUpsertRow> {
  const insertResult = await pool.query<UsersUpsertRow>(
    `INSERT INTO users (oauth_subject, screen_name)
     VALUES ($1, $2)
     ON CONFLICT (oauth_subject) DO NOTHING
     RETURNING id, oauth_subject, screen_name`,
    [oauthSubject, PLACEHOLDER_SCREEN_NAME],
  );
  if (insertResult.rows.length > 0) {
    return insertResult.rows[0] as UsersUpsertRow;
  }
  // ON CONFLICT branch fired — load the existing row. The
  // `deleted_at IS NULL` clause skips soft-deleted users; the caller
  // surfaces the empty-result case as a 500 because a row should
  // exist whenever we got here.
  const selectResult = await pool.query<UsersUpsertRow>(
    `SELECT id, oauth_subject, screen_name
     FROM users
     WHERE oauth_subject = $1 AND deleted_at IS NULL`,
    [oauthSubject],
  );
  if (selectResult.rows.length === 0) {
    // Either the row was soft-deleted between INSERT...ON CONFLICT
    // and the SELECT, or some other process raced us. Either way,
    // surface a typed error the route handler turns into a 500.
    throw new Error(
      `users row for oauth_subject=${oauthSubject} could not be located after upsert`,
    );
  }
  return selectResult.rows[0] as UsersUpsertRow;
}

/**
 * The `/auth/login` request query schema. Empty by design — there's
 * no input the user supplies on the GET. Declared explicitly so
 * `@fastify/swagger` includes the route's parameter set (zero) in
 * the generated document.
 */
const loginQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/**
 * The `/auth/callback` request query schema. Open-ended on the
 * additional-properties side because the issuer may include
 * extra fields (`session_state`, `iss`, etc.) we don't read here but
 * shouldn't reject. The two required fields (`code`, `state`) are
 * what the handler actually consumes.
 */
const callbackQuerystringSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['code', 'state'],
  properties: {
    code: {
      type: 'string',
      description: 'Authorization code returned by the issuer.',
    },
    state: {
      type: 'string',
      description:
        'State value the login leg generated; the callback handler ' +
        'matches it against the server-side flow-state store.',
    },
  },
} as const;

/**
 * Path + query the new-user branch of `/auth/callback` redirects the
 * browser to. The root SPA mounts `ScreenNameRoute` here and reads
 * `from=callback` as the gate to render the screen-name form even
 * though `/api/auth/me` returns 401 (the pending cookie is not the
 * platform session cookie). See
 * `tasks/refinements/backend/auth_callback_new_user_browser_redirect.md`.
 */
const NEW_USER_SCREEN_NAME_PATH = '/screen-name?from=callback';

/**
 * Row shape returned from the screen-name UPDATE. Only the
 * post-update `screen_name` is read by the handler; `id` is included
 * for completeness so the response body can echo the verified pair
 * without a follow-up SELECT.
 */
interface UsersScreenNameRow extends Record<string, unknown> {
  readonly id: string;
  readonly screen_name: string;
}

/**
 * Apply the screen-name update to the users row.
 *
 * Idempotency / first-write semantics live entirely in the WHERE
 * clause: the UPDATE matches only the row whose current
 * `screen_name = '<pending>'` AND `deleted_at IS NULL`. If the row's
 * screen name was previously set, the UPDATE matches zero rows and
 * RETURNING is empty — the caller treats the empty result as the
 * "already set" 409 case. The condition also blocks soft-deleted
 * users from getting their name overwritten (consistent with the
 * upsert's SELECT side).
 *
 * SQL is fully parameterized — no string concatenation.
 *
 * @param pool       - the DB pool (production singleton or test shim).
 * @param userId     - users-table row id (verified via pending cookie).
 * @param screenName - the validated, trimmed candidate string.
 * @returns the updated row, or `undefined` if no row matched the
 *          first-write condition (already-set / soft-deleted / not-found).
 */
export async function updatePendingScreenName(
  pool: DbPool,
  userId: string,
  screenName: string,
): Promise<UsersScreenNameRow | undefined> {
  const result = await pool.query<UsersScreenNameRow>(
    `UPDATE users
     SET screen_name = $2
     WHERE id = $1
       AND screen_name = $3
       AND deleted_at IS NULL
     RETURNING id, screen_name`,
    [userId, screenName, PLACEHOLDER_SCREEN_NAME],
  );
  return result.rows[0];
}

/**
 * Request body schema for `POST /auth/screen-name`. The frontend POSTs
 * a single field; the handler trims + validates per `validateScreenName`.
 */
const screenNameBodySchema = {
  type: 'object',
  required: ['screenName'],
  additionalProperties: false,
  properties: {
    screenName: {
      type: 'string',
      description: 'The user-chosen display name. Trimmed; max 64 characters; must be non-empty.',
      // Defensive upper bound — the handler's `validateScreenName`
      // already enforces 64 post-trim, but a giant payload (megabytes
      // of whitespace) is rejected at the schema layer before the
      // handler allocates the trim copy.
      maxLength: 256,
    },
  },
} as const;

/**
 * 200 response body for `POST /auth/screen-name`. Echoes the verified
 * `userId` + the persisted `screenName` so the frontend can read both
 * without a follow-up GET.
 */
const screenNameResponseSchema = {
  type: 'object',
  required: ['userId', 'screenName'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string', format: 'uuid' },
    screenName: { type: 'string' },
  },
} as const;

/**
 * The plugin body. Wires the three routes onto the parent scope (via
 * `fastify-plugin`'s skip-override marker) so the routes appear in
 * the generated OpenAPI document and the existing error-handler
 * plugin sees their thrown errors.
 */
const authRoutesPluginAsync: FastifyPluginAsync<AuthRoutesOptions> = (
  app: FastifyInstance,
  opts,
) => {
  // Resolve the OIDC config. Production reads `process.env`; tests
  // pass a pre-built `oidcConfig`.
  const oidcConfig: OidcConfig = opts.oidcConfig ?? loadOidcConfig(process.env);

  // Resolve the flow-state store. Production uses the Postgres-backed
  // singleton. Tests normally inject a deterministic per-scenario store;
  // older DB-pool-injection fixtures inherit an in-memory store so their
  // narrow user/session pool shims do not need to emulate auth_flow_state SQL.
  const flowState: FlowStateStore =
    opts.flowState ??
    (opts.pool === undefined ? getDefaultFlowStateStore() : createFlowStateStore());

  // Resolve the OIDC client lazily — only when the first request
  // arrives. Production callers don't pass `oidcClient`; tests pass
  // a pre-built stub via `__buildStubConfiguration`.
  let resolvedClient: Configuration | undefined = opts.oidcClient;
  const ensureClient = async (): Promise<Configuration> => {
    if (resolvedClient !== undefined) {
      return resolvedClient;
    }
    resolvedClient = await getOidcClient(oidcConfig, opts.oidcDiscoveryOptions ?? {});
    return resolvedClient;
  };

  // Resolve the DB pool lazily — only the callback uses it. The
  // login handler doesn't touch the DB, so a deployment with no DB
  // can still serve `/auth/login` (it'd fail on `/auth/callback`,
  // but that's expected behaviour for a partially-configured stack).
  // Lazy resolution also keeps `createServer({ logger: false })`
  // working in Vitest suites that test bootstrap shape without
  // setting `DATABASE_URL`.
  let resolvedPool: DbPool | undefined = opts.pool;
  const ensurePool = (): DbPool => {
    if (resolvedPool !== undefined) {
      return resolvedPool;
    }
    resolvedPool = getDefaultPool();
    return resolvedPool;
  };

  // Resolve the pending-cookie HMAC secret lazily. Production reads
  // `SESSION_TOKEN_SECRET` off `process.env`; tests pass a fixed
  // value via options so cookie strings stay deterministic.
  let resolvedSecret: string | undefined = opts.sessionTokenSecret;
  const ensureSecret = (): string => {
    if (resolvedSecret !== undefined) {
      return resolvedSecret;
    }
    resolvedSecret = resolveSessionTokenSecret(process.env);
    return resolvedSecret;
  };

  // Compute the Secure-attribute toggle once. Production sets it via
  // `NODE_ENV === 'production'`; tests can override.
  const cookieSecure: boolean = opts.cookieSecure ?? process.env['NODE_ENV'] === 'production';

  // Clock injection for cookie expiry — defaults to Date.now; tests
  // pass a controllable function. Reuses the same `now` field as
  // flow-state expiry so a single override controls both.
  const cookieNow = (): number => (opts.now !== undefined ? opts.now() : Date.now());

  app.get(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Begin the OIDC authorization-code flow',
        description:
          'Generates fresh PKCE / state / nonce values, persists them ' +
          'server-side keyed by `state` (5-minute TTL), and 302-redirects ' +
          'the user to the OIDC issuer’s authorization endpoint. The ' +
          'issuer redirects back to `/auth/callback` with the authorization ' +
          'code and the original state.',
        querystring: loginQuerystringSchema,
        response: {
          302: {
            type: 'null',
            description:
              "Redirect to the OIDC issuer's authorization endpoint. The `Location` " +
              'header carries the authorization URL.',
          },
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (_request, reply) => {
      const client = await ensureClient();
      const { url, state, nonce, codeVerifier } = await beginAuthFlow(
        client,
        { redirectUri: oidcConfig.redirectUri },
        opts.beginFlowOptions ?? {},
      );
      const computeOpts: { now?: () => number } = {};
      if (opts.now !== undefined) computeOpts.now = opts.now;
      try {
        await flowState.put(state, {
          nonce,
          codeVerifier,
          expiresAt: computeExpiresAt(computeOpts),
        });
      } catch (err) {
        // M3-review F-006: the flow-state map is capped at
        // `MAX_FLOW_STATE_ENTRIES` (env-overridable via
        // `FLOW_STATE_MAX_ENTRIES`); when full *and* an eager sweep
        // could not free space, `put(...)` throws the typed
        // `FlowStateCapacityError`. Surface as a 503 with code
        // `temporarily-unavailable`. The message intentionally does
        // NOT include the cap value or the current map size — an
        // attacker who knew the cap could calibrate a flood against
        // it. See refinement
        // `tasks/refinements/backend-hardening/flow_state_map_bound.md`.
        if (err instanceof FlowStateCapacityError) {
          throw new ApiError(
            503,
            'temporarily-unavailable',
            'service is temporarily unable to start a new auth flow; please retry shortly',
          );
        }
        throw err;
      }
      return reply.redirect(url.toString(), 302);
    },
  );

  app.get(
    '/api/auth/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Handle the OIDC callback redirect',
        description:
          'Validates the inbound `state` against the server-side flow-state ' +
          'store, exchanges the authorization code for tokens via the issuer’s ' +
          'token endpoint, validates the id_token (signature, audience, issuer, ' +
          'expiry, nonce), and upserts the users row keyed on the namespaced ' +
          'OIDC subject (`<issuer-host>:<sub>`). Both branches respond with a ' +
          '302 redirect (no body) so the browser navigates onward without ever ' +
          'rendering a JSON response.\n\n' +
          '**Returning user** (the upserted row has a non-`<pending>` `screen_name`): ' +
          'sets the platform session cookie `aconversa-session` (HS256 JWT, 7-day TTL) ' +
          'and 302-redirects to `APP_BASE_URL`.\n\n' +
          '**New user** (the upserted row has `screen_name = <pending>`): sets the ' +
          'short-lived `aconversa-auth-pending` cookie and 302-redirects to ' +
          '`APP_BASE_URL` + `' +
          NEW_USER_SCREEN_NAME_PATH +
          '`, where the root SPA renders the screen-name form. The form POSTs ' +
          '`/auth/screen-name`, which validates the pending cookie and issues the ' +
          'platform session cookie.',
        querystring: callbackQuerystringSchema,
        response: {
          302: {
            type: 'null',
            description:
              'Redirect after the OIDC code exchange. Target is `APP_BASE_URL` ' +
              '(returning user, session cookie attached) or `APP_BASE_URL` + `' +
              NEW_USER_SCREEN_NAME_PATH +
              '` (new user, pending cookie attached).',
          },
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Build the full request URL — `authorizationCodeGrant` reads
      // the query string from it. Fastify's `request.url` is the
      // path + query; we re-host it under the configured app base
      // so openid-client's redirect-URI cross-check matches the
      // value the login leg sent.
      const currentUrl = new URL(request.url, oidcConfig.appBaseUrl);

      // Pull the inbound `state` early — needed to look up the
      // expected nonce / verifier. The querystring schema above
      // already required `state`, but we re-check here defensively
      // because the schema is not active in test scenarios that
      // bypass schema validation.
      const inboundState =
        typeof (request.query as Record<string, unknown>)['state'] === 'string'
          ? (request.query as Record<string, string>)['state']
          : currentUrl.searchParams.get('state');
      if (inboundState === null || inboundState === undefined || inboundState === '') {
        throw new ApiError(
          400,
          'auth-state-invalid',
          'authorization state is missing, expired, or unrecognized',
        );
      }

      const stored = await flowState.take(inboundState);
      if (stored === undefined) {
        throw new ApiError(
          400,
          'auth-state-invalid',
          'authorization state is missing, expired, or unrecognized',
        );
      }

      const client = await ensureClient();
      let sub: string;
      try {
        const result = await completeAuthFlow(
          client,
          currentUrl,
          {
            expectedState: inboundState,
            expectedNonce: stored.nonce,
            codeVerifier: stored.codeVerifier,
          },
          opts.completeFlowOptions ?? {},
        );
        sub = result.sub;
      } catch (err) {
        if (err instanceof AuthStateMismatchError) {
          throw new ApiError(
            400,
            'auth-state-invalid',
            'authorization state is missing, expired, or unrecognized',
          );
        }
        throw err;
      }

      const oauthSubject = namespacedOauthSubject(oidcConfig.issuerUrl, sub);
      const row = await upsertUserByOauthSubject(ensurePool(), oauthSubject);

      // Split on the upserted row's screen_name. A returning user
      // already has a non-placeholder name; we hand them the full
      // platform session cookie and redirect them at the app shell.
      // A brand-new user has the placeholder; we set the short-lived
      // pending cookie so `POST /auth/screen-name` can verify the
      // request, and redirect the browser to the SPA's screen-name
      // form (the `?from=callback` query parameter is the gate the
      // SPA reads to render the form despite `/api/auth/me` returning
      // 401 with only the pending cookie present). See
      // tasks/refinements/backend/auth_callback_new_user_browser_redirect.md.
      if (row.screen_name !== PLACEHOLDER_SCREEN_NAME) {
        // Returning-user branch. Issue the platform session JWT and
        // redirect. Tests inject `now` for deterministic `iat` / `exp`;
        // production uses Date.now via the signSessionToken default.
        const signOpts = opts.now !== undefined ? { now: opts.now } : {};
        const token = await signSessionToken({ sub: row.id }, ensureSecret(), signOpts);
        reply.header('Set-Cookie', buildSessionCookieHeader(token, { secure: cookieSecure }));
        // Closes docs/security/m3-review/coverage.md G-019 — this 302
        // carries the platform session `Set-Cookie`. Even though the
        // response body is empty, a CDN that caches the headers would
        // replay the cookie at every cache hit (catastrophic). The
        // `no-store` directive forbids any cache from storing this
        // response. The login-leg redirect to the IdP at `/auth/login`
        // is deliberately NOT marked — that redirect carries no
        // user-identifying state (the `state` value is per-flow not
        // per-user).
        reply.header('Cache-Control', 'no-store');
        // No open-redirect surface today: `oidcConfig.appBaseUrl` is a
        // server-side fixed value read from the environment, never
        // user-controllable. If a future feature adds a `?next=<url>`
        // parameter to remember where the user was trying to go, that
        // value MUST be validated against `new URL(appBaseUrl).origin`
        // before reaching `reply.redirect` — same-origin only, never
        // an unvalidated pass-through. See
        // tasks/refinements/backend-hardening/auth_callback_next_param_note.md
        // (closes docs/security/m3-review/auth.md F-013).
        return reply.redirect(oidcConfig.appBaseUrl, 302);
      }

      // New-user branch. Issue the short-lived pending cookie that
      // exclusively authorizes `POST /auth/screen-name`. The cookie's
      // `expiresAt` field is checked server-side on verification —
      // the `Max-Age` attribute is for browser-side housekeeping only.
      const expiresAt = cookieNow() + PENDING_COOKIE_TTL_MS;
      const cookieValue = signPendingCookie({ userId: row.id, expiresAt }, ensureSecret());
      reply.header(
        'Set-Cookie',
        buildPendingCookieHeader(cookieValue, {
          maxAgeMs: PENDING_COOKIE_TTL_MS,
          secure: cookieSecure,
        }),
      );
      // Closes docs/security/m3-review/coverage.md G-019 — this 302
      // carries the pending `Set-Cookie`. A CDN that cached the headers
      // would replay the cookie at every cache hit; `no-store` forbids
      // any cache layer from storing this response. Mirrors the
      // returning-user branch above.
      reply.header('Cache-Control', 'no-store');

      // Same open-redirect note as the returning-user branch above:
      // the URL is built from the server-side `appBaseUrl` plus a
      // fixed path; no user-controllable component reaches
      // `reply.redirect`. The same future-`?next=` constraint applies.
      const target = new URL(NEW_USER_SCREEN_NAME_PATH, oidcConfig.appBaseUrl).toString();
      return reply.redirect(target, 302);
    },
  );

  app.post(
    '/api/auth/screen-name',
    {
      schema: {
        tags: ['auth'],
        summary: 'Replace the placeholder screen name after first auth',
        description:
          'Consumes the short-lived `aconversa-auth-pending` cookie set by ' +
          '`/auth/callback`, validates the supplied screen name (≤ 64 chars, ' +
          'non-empty after trim), and writes it onto the user’s row only when ' +
          'the row currently has the placeholder `<pending>`. On success clears ' +
          'the pending cookie AND sets the platform session cookie ' +
          '`aconversa-session` (HS256 JWT, 7-day TTL); the next request from the ' +
          'frontend can carry that cookie alone. This endpoint never allows ' +
          'resetting an already-chosen screen name (409 on second attempt); a ' +
          'future rename surface is out of scope.',
        body: screenNameBodySchema,
        response: {
          200: screenNameResponseSchema,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // 1. Pull + verify the pending cookie. Any malformed / missing
      //    / expired / signature-invalid path produces the same 401
      //    envelope — we deliberately don't leak which subcase fired.
      const rawHeader = request.headers['cookie'];
      const cookieHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
      const cookieValue = readPendingCookieFromHeader(cookieHeader);
      if (cookieValue === undefined) {
        throw new ApiError(
          401,
          'auth-pending-cookie-invalid',
          'authorization is missing or has expired; complete the OIDC login again',
        );
      }
      const verify = verifyPendingCookie(cookieValue, {
        secret: ensureSecret(),
        now: cookieNow,
      });
      if (!verify.ok) {
        throw new ApiError(
          401,
          'auth-pending-cookie-invalid',
          'authorization is missing or has expired; complete the OIDC login again',
        );
      }

      // 2. Validate the body. The schema already covers shape +
      //    `screenName` presence; this layer applies the
      //    refinement-driven rules (trim, length, whitespace-only).
      const body = request.body as { screenName?: unknown };
      const validated = validateScreenName(body.screenName);
      if (!validated.ok) {
        // The four rejection reasons share the `screen-name-invalid`
        // envelope code; the message differs per reason so the
        // frontend can render a useful hint. The `invalid-character`
        // reason intentionally does NOT echo which specific character
        // tripped the policy — that would oracle the reject rule to a
        // probing attacker. Closes docs/security/m3-review/auth.md F-010.
        const messageByReason: Record<typeof validated.reason, string> = {
          empty: 'screenName must be a non-empty string',
          'whitespace-only': 'screenName must contain non-whitespace characters',
          'too-long': 'screenName must be at most 64 characters after trimming',
          'invalid-character':
            'screenName contains a disallowed character (control / bidi-override / non-printable)',
        };
        throw new ApiError(400, 'screen-name-invalid', messageByReason[validated.reason]);
      }

      // 3. Apply the first-write UPDATE. Zero matched rows means the
      //    row already has a non-placeholder screen name (or is
      //    soft-deleted / missing). Surface that as a 409 — the
      //    cookie is valid but the request conflicts with current
      //    state.
      const updated = await updatePendingScreenName(ensurePool(), verify.userId, validated.value);
      if (updated === undefined) {
        throw new ApiError(
          409,
          'screen-name-already-set',
          'this account already has a screen name; rename is not supported in this surface',
        );
      }

      // 4. Clear the pending cookie AND issue the platform session
      //    cookie. The bridge has served its purpose; the session
      //    cookie is the credential every protected endpoint and the
      //    WebSocket handshake will consume from here on. We emit two
      //    Set-Cookie headers (Fastify accepts an array under one
      //    header name and emits them as separate Set-Cookie lines).
      const signOpts = opts.now !== undefined ? { now: opts.now } : {};
      const sessionToken = await signSessionToken({ sub: updated.id }, ensureSecret(), signOpts);
      reply.header('Set-Cookie', [
        buildPendingCookieClearHeader({ secure: cookieSecure }),
        buildSessionCookieHeader(sessionToken, { secure: cookieSecure }),
      ]);
      // Closes docs/security/m3-review/coverage.md G-019 — this 200 body
      // carries the user's `userId` and the freshly-set `screenName`,
      // plus the platform session `Set-Cookie`. A CDN that caches this
      // would replay one user's session cookie + identity to another.
      reply.header('Cache-Control', 'no-store');

      return { userId: updated.id, screenName: updated.screen_name };
    },
  );

  // ---------------------------------------------------------------
  // `POST /auth/logout` — clear the platform session cookie AND
  // revoke the JWT server-side.
  //
  // M3-review hardening — closes `docs/security/m3-review/auth.md`
  // F-001 + F-006 and `docs/security/m3-review/coverage.md` G-005.
  // Before the `jwt_revocation_jti_denylist` task landed, this handler
  // only cleared the browser-side cookie; the JWT remained
  // structurally valid until its 7-day `exp`. The handler now:
  //   1. Reads the cookie + verifies the JWT (HS256 + payload-shape +
  //      `exp`). On any failure mode (no cookie / malformed /
  //      tampered / expired), the handler still returns 204 with the
  //      cookie-clear — the user "is" logged out from their
  //      perspective; rejecting the request would be a UX footgun.
  //   2. On verify success, INSERTs `(jti, user_id, expires_at)` into
  //      the denylist. ON CONFLICT DO NOTHING — double-logout is
  //      idempotent.
  //   3. AFTER the denylist commit, calls
  //      `closeUserConnectionsHook(userId, 'auth-revoked')` to close
  //      every open WS owned by the user. Order matters: writing the
  //      denylist row FIRST means a concurrent reconnect after the
  //      close still fails at the upgrade gate via the denylist
  //      consult.
  //   4. Returns 204 + cookie-clear. The 204 shape is unchanged.
  // ---------------------------------------------------------------
  app.post(
    '/api/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Clear the platform session cookie and revoke the JWT',
        description:
          'Clears the `aconversa-session` cookie AND, when the inbound cookie carries a ' +
          'verified JWT, adds the JWT’s `jti` claim to the `auth_token_denylist` table + ' +
          'closes every open WebSocket connection owned by the logging-out user (with ' +
          'WS close code 4401 and reason `auth-revoked`). Idempotent — always 204, ' +
          'regardless of whether the inbound cookie was present, valid, or expired. The ' +
          'denylist write happens only on a successfully-verified cookie; an invalid/' +
          'missing cookie remains a no-op cookie-clear. Refinement: ' +
          '`tasks/refinements/backend-hardening/jwt_revocation_jti_denylist.md`.',
        response: {
          204: {
            type: 'null',
            description: 'Cookie cleared (no body).',
          },
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request, reply) => {
      // Always emit the cookie-clear + no-store. These run regardless
      // of the cookie's verification result so the 204 shape stays
      // identical to the pre-M3-review behaviour.
      reply.header('Set-Cookie', buildSessionCookieClearHeader({ secure: cookieSecure }));
      // Closes docs/security/m3-review/coverage.md G-019 — the 204 carries
      // the cookie-clearing `Set-Cookie` header. A CDN that cached this
      // response would log out every user it served from the cached
      // entry (a different kind of cross-user leak — the clear-cookie
      // is per-user state too). `no-store` keeps every logout response
      // unique to the requester.
      reply.header('Cache-Control', 'no-store');

      // Try to verify the cookie's JWT so we can extract the `jti` +
      // `userId` + `exp` for the denylist row. Missing cookie /
      // malformed cookie / tampered signature / expired token all
      // surface as `payload === null`; we silently skip the denylist
      // write in those cases (rationale in the handler-block comment
      // above + the refinement's Decisions).
      const rawHeader = request.headers['cookie'];
      const cookieHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
      const cookieValue = readSessionCookieFromHeader(cookieHeader);
      if (cookieValue !== undefined) {
        const verifyOpts = opts.now !== undefined ? { now: opts.now } : {};
        const payload = await verifySessionToken(cookieValue, ensureSecret(), verifyOpts);
        if (payload !== null) {
          // Write the denylist row FIRST, then close WS connections.
          // Order matters: a concurrent reconnect attempt between the
          // close call and the denylist commit must still fail at
          // the upgrade gate. The denylist consult in
          // `authenticateRequest` is the load-bearing check — the
          // close call is the propagation onto already-open sockets.
          try {
            await addToDenylist(
              {
                jti: payload.jti,
                userId: payload.sub,
                expiresAtMs: payload.exp * 1000,
              },
              ensurePool(),
            );
          } catch (err) {
            // A failed denylist write is non-fatal for the cookie
            // clear (the user gets their cookie cleared regardless),
            // but it IS the failure mode that allows the replayed
            // cookie to slip through. Log + bubble up — the
            // centralized error-handler renders the 500 envelope and
            // the operator's monitoring catches the regression.
            request.log.error(
              { err, userId: payload.sub },
              'auth_token_denylist write failed during /auth/logout',
            );
            throw err;
          }
          // Close any open WS owned by this user. The hook is wired
          // in `server.ts` to `closeUserConnections` from
          // `ws/connection.ts`. Tests pass a spy; a test that omits
          // the hook simply skips the close call.
          if (opts.closeUserConnectionsHook !== undefined) {
            try {
              opts.closeUserConnectionsHook(payload.sub, 'auth-revoked');
            } catch (err) {
              // The hook closing one bad socket must not break the
              // logout response — log + continue. The denylist row is
              // already committed, so the cache invariant
              // (denylist-write-first) is preserved even if a single
              // socket close throws.
              request.log.warn(
                { err, userId: payload.sub },
                'closeUserConnectionsHook threw during /auth/logout (denylist row already committed)',
              );
            }
          }
        }
      }

      // Empty 204 — Fastify needs `.send()` to flush headers + status
      // when the handler returns nothing meaningful.
      reply.code(204).send();
      return reply;
    },
  );

  // ---------------------------------------------------------------
  // `GET /auth/me` — return the current user identified by the
  // platform session cookie.
  //
  // The cookie-validation + user-lookup chain that used to live inline
  // here moved to `auth/middleware.ts`'s `authenticatePlugin` when the
  // `auth_middleware` task landed. The route now opts in via
  // `preHandler: app.authenticate`; on success the preHandler sets
  // `request.authUser = { id, screenName }`, and the handler simply
  // maps that onto the public response shape `{ userId, screenName }`.
  // On any failure the middleware throws `ApiError(401, 'auth-required',
  // ...)` and the centralized error-handler renders the canonical
  // envelope — the handler below never runs in that case.
  //
  // The OpenAPI `security: [{ cookieAuth: [] }]` attribute below
  // documents the cookie requirement; `apps/server/src/openapi.ts`
  // declares the corresponding `securitySchemes.cookieAuth` entry.
  // Refinement: tasks/refinements/backend/auth_middleware.md.
  // ---------------------------------------------------------------
  // Combined preHandler for `GET /auth/me`. Stamps `Cache-Control:
  // no-store` FIRST (so it is present on every response including the
  // middleware's 401 throw path), then defers to `app.authenticate`.
  // Closes docs/security/m3-review/coverage.md G-019.
  //
  // The auth-middleware decorator (`app.authenticate`) is registered by
  // the sibling `authenticatePlugin`. The dedicated screen-name unit
  // test builds the route plugin without the middleware (it never
  // hits `/auth/me`), so `app.authenticate` may be undefined at
  // registration; the function-typeof check keeps the chain valid in
  // both wiring topologies.
  const authMePreHandler = async function authMePreHandler(
    this: FastifyInstance,
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    if (typeof app.authenticate === 'function') {
      await app.authenticate.call(this, request, reply);
    }
  };

  app.get(
    '/api/auth/me',
    {
      preHandler: authMePreHandler,
      schema: {
        tags: ['auth'],
        summary: 'Return the current authenticated user',
        description:
          'Reads the `aconversa-session` cookie (via the auth middleware), validates the ' +
          'JWT (HS256 signature + `exp`), looks up the users row by `id = sub`, and ' +
          'returns `{ userId, screenName }`. 401 with code `auth-required` on missing / ' +
          'invalid / expired cookie or on a soft-deleted user — single envelope regardless ' +
          'of which sub-case fired (no information leak).',
        security: [{ cookieAuth: [] }],
        response: {
          200: {
            type: 'object',
            required: ['userId', 'screenName'],
            additionalProperties: false,
            properties: {
              userId: { type: 'string', format: 'uuid' },
              screenName: { type: 'string' },
            },
          },
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    (request) => {
      // `Cache-Control: no-store` is stamped by the `setNoStoreHeader`
      // preHandler that runs before `app.authenticate` — see the chain
      // assembled above. Closes docs/security/m3-review/coverage.md G-019.
      // The middleware guarantees `authUser` is defined here — it
      // throws otherwise, bypassing the handler. The non-null
      // assertion is a static-analysis necessity (the augmentation
      // types `authUser` as optional because public routes never set
      // it) and a runtime invariant (the preHandler either set it or
      // we never got here).
      const user = request.authUser;
      if (user === undefined) {
        // Defensive — should be unreachable, but the type system
        // doesn't know the preHandler invariant. A surfaced 500 here
        // means a wiring regression (e.g. the preHandler was removed
        // from the route options); failing loud is the right
        // diagnostic.
        throw new ApiError(
          500,
          'internal-error',
          'auth middleware did not populate request.authUser',
        );
      }
      return { userId: user.id, screenName: user.screenName };
    },
  );

  // The plugin body is synchronous — `app.get(...)` returns the
  // FastifyInstance, not a Promise — but `FastifyPluginAsync` demands
  // a Promise<void> return. Mirrors the `healthzPlugin` convention
  // in `routes/healthz.ts` and avoids the `require-await` lint rule.
  return Promise.resolve();
};

/**
 * The wrapped plugin. `fastify-plugin` adds `skip-override` so the
 * routes attach to the parent scope rather than the plugin's
 * encapsulation child. `@fastify/swagger` then sees them in the
 * generated document and the error-handler plugin classifies their
 * thrown errors under the canonical envelope.
 */
export const authRoutesPlugin = fp(authRoutesPluginAsync, {
  name: 'a-conversa-auth-routes',
  fastify: '5.x',
});

// Re-export the createFlowStateStore helper so tests of the plugin
// can build per-scenario stores without reaching into flow-state.js
// directly. Production code uses the singleton via the no-options
// registration path.
export { createFlowStateStore };

/**
 * Test-only convenience — build a minimal Fastify instance with the
 * shared error-envelope schema, the error-handler plugin, and the
 * auth-routes plugin all wired. Hides the `fastify` import behind
 * the workspace boundary so the test tsconfig (which doesn't
 * resolve `fastify` directly — the dep lives under
 * `apps/server/node_modules`) can build the integration app without
 * an extra import path.
 *
 * Production code does NOT use this helper. Use `createServer()`
 * (in `server.ts`) which wires the full stack including the openapi
 * plugin and the rest of the middleware.
 *
 * @param options - the same shape as `AuthRoutesOptions`.
 * @returns the configured Fastify instance, ready for `.inject(...)`.
 */
export async function __buildTestAuthApp(
  options: AuthRoutesOptions,
): Promise<import('fastify').FastifyInstance> {
  // Importing dynamically inside the function so the test tsconfig
  // doesn't need to statically resolve `fastify`. The dynamic import
  // is resolved at runtime by Node's module resolver using
  // `apps/server/node_modules/fastify` since this module lives
  // there.
  const { default: fastifyFactory } = await import('fastify');
  const { errorHandlerPlugin } = await import('../error-handler.js');
  const { errorEnvelopeSchema } = await import('../openapi.js');
  const { authenticatePlugin } = await import('./middleware.js');
  const app = fastifyFactory({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  // Register the auth middleware BEFORE the routes plugin so
  // `/auth/me`'s `preHandler: app.authenticate` resolves at
  // route-registration time. The middleware reuses the same pool +
  // secret + clock injections the routes plugin already accepts —
  // we re-thread the relevant fields through.
  const middlewareOpts: Parameters<typeof authenticatePlugin>[1] = {
    ...(options.pool !== undefined ? { pool: options.pool } : {}),
    ...(options.sessionTokenSecret !== undefined
      ? { sessionTokenSecret: options.sessionTokenSecret }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  };
  await app.register(authenticatePlugin, middlewareOpts);
  await app.register(authRoutesPlugin, options);
  await app.ready();
  return app;
}
