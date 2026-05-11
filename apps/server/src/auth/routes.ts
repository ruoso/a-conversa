// Fastify plugin registering the OIDC handshake routes:
//
//   - GET /auth/login   — initiate the authorization-code flow.
//   - GET /auth/callback — handle the issuer's redirect back.
//
// Refinement: tasks/refinements/backend/oauth_callback_handler.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0017-mock-oauth-authelia-users-file.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.oauth_callback_handler
//
// **Plugin shape.** The plugin is parameterized on a small options
// bag so tests can inject a stubbed `Configuration` (no live Authelia
// round-trip), a stubbed `flowState` store (deterministic TTL), and a
// pglite-backed `pool` (no real Postgres). Production callers register
// the plugin with the empty options bag (`{}`); the plugin then reads
// `OIDC_*` env vars, calls `getOidcClient(config)` lazily on first
// request, and reaches for the singleton `pg.Pool`.
//
// **What this plugin does NOT do** — handoffs to sibling tasks:
//
//   - Mint or set a platform session cookie. The callback returns the
//     OIDC subject + the users-table row's `userId` in the response
//     body; `session_token_management` replaces this body with a
//     cookie-set + 302 to the post-login landing.
//   - Collect a screen name. Freshly inserted users get
//     `screen_name = '<pending>'`; `screen_name_collection` swaps in
//     the user-chosen value via a separate endpoint.
//   - Read any claim besides `sub` off the id_token. Audited by
//     `no_profile_data_policy`.
//   - Enforce auth on any other route. Owned by `auth_middleware`.

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
  getDefaultFlowStateStore,
  type FlowStateStore,
} from './flow-state.js';

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
 * Compose the namespaced OIDC subject identifier — `${hostname}:${sub}`.
 *
 * Per the users-table refinement's F2, `oauth_subject` is stored as
 * `provider:subject` to avoid cross-provider collisions. We use the
 * issuer URL's hostname as the provider key — for the dev Authelia
 * case that's `authelia` (yielding `authelia:alice`); production with
 * an `auth.example.com` issuer yields `auth.example.com:<sub>`. The
 * hostname is the deployment-specific identifier the operator already
 * controls via `OIDC_ISSUER_URL`.
 */
export function namespacedOauthSubject(issuerUrl: URL, sub: string): string {
  return `${issuerUrl.hostname}:${sub}`;
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
 * 200 response body for `/auth/callback`. PROVISIONAL — the
 * `session_token_management` sibling replaces this with a cookie-set
 * + 302. Documented as such in the description so the OpenAPI surface
 * tracks the planned evolution.
 */
const callbackResponseSchema = {
  type: 'object',
  required: ['sub', 'oauthSubject', 'userId'],
  additionalProperties: false,
  properties: {
    sub: {
      type: 'string',
      description: "OIDC subject identifier (the id_token's `sub` claim).",
    },
    oauthSubject: {
      type: 'string',
      description: 'Namespaced subject stored on the users row (`provider:sub`).',
    },
    userId: {
      type: 'string',
      format: 'uuid',
      description:
        'Application-side users-table row id. Provisional surface — ' +
        '`session_token_management` will issue a platform session cookie ' +
        'instead of returning this id in the body.',
    },
  },
} as const;

/**
 * The plugin body. Wires both routes onto the parent scope (via
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

  // Resolve the flow-state store. Production uses the singleton; tests
  // pass a fresh per-scenario store. We resolve eagerly at registration
  // time because the store has no constructor cost.
  const flowState: FlowStateStore = opts.flowState ?? getDefaultFlowStateStore();

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

  app.get(
    '/auth/login',
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
      flowState.put(state, {
        nonce,
        codeVerifier,
        expiresAt: computeExpiresAt(computeOpts),
      });
      return reply.redirect(url.toString(), 302);
    },
  );

  app.get(
    '/auth/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Handle the OIDC callback redirect',
        description:
          'Validates the inbound `state` against the server-side flow-state ' +
          'store, exchanges the authorization code for tokens via the issuer’s ' +
          'token endpoint, validates the id_token (signature, audience, issuer, ' +
          'expiry, nonce), and upserts the users row keyed on the namespaced ' +
          'OIDC subject (`<issuer-host>:<sub>`). Returns ' +
          '`{ sub, oauthSubject, userId }`. **Provisional shape** — the ' +
          '`session_token_management` sibling task will replace this body with ' +
          'a session-cookie issuance + redirect to the post-login landing.',
        querystring: callbackQuerystringSchema,
        response: {
          200: callbackResponseSchema,
          '4xx': errorEnvelopeRef,
          '5xx': errorEnvelopeRef,
        },
      },
    },
    async (request) => {
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

      const stored = flowState.take(inboundState);
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

      // Provisional response shape. The `session_token_management`
      // sibling will replace this with a cookie issuance + 302.
      return {
        sub,
        oauthSubject,
        userId: row.id,
      };
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
  const app = fastifyFactory({ logger: false });
  app.addSchema(errorEnvelopeSchema);
  await app.register(errorHandlerPlugin);
  await app.register(authRoutesPlugin, options);
  await app.ready();
  return app;
}
