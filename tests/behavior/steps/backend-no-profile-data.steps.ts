// Step definitions for tests/behavior/backend/no-profile-data.feature.
//
// Refinement: tasks/refinements/backend/no_profile_data_policy.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend.auth.no_profile_data_policy
//
// **What this layer exercises.** End-to-end lock-in tests for the
// no-OAuth-profile-data policy. The Background hook builds a Fastify
// auth app whose stubbed `authorizationCodeGrant` returns an id_token
// carrying `sub` PLUS the full set of profile claims a real provider
// might emit (`email`, `name`, `picture`, etc.). The scenarios then
// drive the callback / `/auth/me` and assert NONE of those values
// reach any inspectable surface.
//
// What's stubbed:
//
//   - The `Configuration` is `__buildStubConfiguration`-built.
//   - `authorizationCodeGrant` is overridden to return the profile-
//     claim-bearing token response.
//
// What's real:
//
//   - Fastify routing, error envelope, the actual `completeAuthFlow`
//     reading off the claims — confirms the production reader only
//     touches `.sub` even when more is on offer.
//   - The PG pool is the pglite-backed shim used by the existing
//     oauth-callback scenarios.
//
// Per ADR 0022, this layer is the regression test against future
// drift; the Vitest layer (`apps/server/src/auth/no-profile-data.test.ts`)
// covers the same invariants at unit granularity.
//
// **Step reuse.** The Background here builds its own app (separate
// from `backend-oauth-callback.steps.ts`'s Background) because the
// scenario-driving stub returns a different claim shape. The
// scenarios reuse phrase steps from the other backend-auth step
// files where the shapes match:
//
//   - `When('I GET /auth/login', ...)` — owned by backend-oauth-callback.steps.ts.
//   - `When('I GET the callback URL with the stored state and a stubbed sub {string}', ...)` —
//     owned by backend-oauth-callback.steps.ts.
//   - `Then('the response status is {int}', ...)` — owned by http-server.steps.ts.
//   - `Given('a user with oauth_subject {string} exists with screen_name {string}', ...)` —
//     owned by backend-session-token.steps.ts.
//   - `Given('I have a valid session cookie for that user', ...)` —
//     owned by backend-session-token.steps.ts.
//   - `When('I GET /auth/me with the session cookie', ...)` —
//     owned by backend-session-token.steps.ts.
//
// Re-defining any of those phrases here would trip Cucumber's
// duplicate-step-definition guard. We add only the no-profile-data-
// specific phrases below.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { After, Given, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  __buildStubConfiguration,
  __buildTestAuthApp,
  createFlowStateStore,
  type AuthRoutesOptions,
} from '../../../apps/server/src/auth/index.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestAuthApp>>;

// Profile-claim values stuffed onto the synthetic id_token. The
// scenarios assert NONE of these values appear in downstream artifacts.
const PROFILE_DATA_VALUES = {
  email: 'alice@example.com',
  name: 'Alice Liddell',
  picture: 'https://example.com/avatars/alice.png',
  preferred_username: 'alice.liddell',
  given_name: 'Alice',
  family_name: 'Liddell',
  locale: 'en-GB',
} as const;

function profileValuesArray(): readonly string[] {
  return Object.values(PROFILE_DATA_VALUES);
}

// Local view onto the shared scratch state. The Cucumber world's
// scratch is `Record<string, unknown>`; the cast here narrows for
// this step file's uses. The field names overlap intentionally with
// `backend-oauth-callback.steps.ts` so the `I GET /auth/login` and
// `I GET the callback URL ...` steps owned by that file work against
// this Background's app.
interface NoProfileDataScratch {
  authApp?: FastifyAppInstance;
  flowState?: ReturnType<typeof createFlowStateStore>;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  capturedState?: string;
  stubSub?: string;
  sessionCookieValue?: string;
}

function scratch(world: AConversaWorld): NoProfileDataScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as NoProfileDataScratch;
}

const OIDC_CONFIG = {
  issuerUrl: new URL('http://authelia:9091'),
  clientId: 'aconversa-app-dev',
  clientSecret: 'aconversa-app-dev-secret',
  appBaseUrl: 'http://localhost:3000',
  redirectUri: 'http://localhost:3000/auth/callback',
} as const;

// Stubbed `authorizationCodeGrant` whose claims() returns sub + every
// profile claim listed in PROFILE_DATA_VALUES. Production code reads
// only `.sub`; the lock-in scenarios confirm no other value leaks.
function makeProfileClaimAuthCodeGrant(world: AConversaWorld) {
  return (): Promise<{
    access_token: string;
    token_type: string;
    claims: () => {
      sub: string;
      iss: string;
      aud: string;
      iat: number;
      exp: number;
      email: string;
      name: string;
      picture: string;
      preferred_username: string;
      given_name: string;
      family_name: string;
      locale: string;
    };
  }> => {
    const sub = scratch(world).stubSub ?? 'alice';
    return Promise.resolve({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      claims: () => ({
        sub,
        iss: 'http://authelia:9091',
        aud: 'aconversa-app-dev',
        iat: 0,
        exp: 0,
        ...PROFILE_DATA_VALUES,
      }),
    });
  };
}

Given(
  'the auth server is built with a profile-claim-bearing stubbed OIDC client',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const flowState = createFlowStateStore({ ttlMs: 60_000 });
    s.flowState = flowState;

    // Deterministic random so /auth/login produces a predictable
    // state value the callback step can use. Mirrors the helper
    // in backend-oauth-callback.steps.ts so the `When('I GET /auth/login', ...)`
    // step owned by that file works against this app too.
    const beginFlowOptions = {
      randomState: (): string => 'TEST-STATE-1',
      randomNonce: (): string => 'TEST-NONCE-1',
      randomPKCECodeVerifier: (): string => 'TEST-VERIFIER-1',
      calculatePKCECodeChallenge: (_v: string): Promise<string> =>
        Promise.resolve('TEST-CHALLENGE-1'),
      buildAuthorizationUrl: (
        _cfg: unknown,
        params: URLSearchParams | Record<string, string>,
      ): URL => {
        const sp = params instanceof URLSearchParams ? params : new URLSearchParams(params);
        return new URL(`http://authelia:9091/auth?${sp.toString()}`);
      },
    } satisfies NonNullable<AuthRoutesOptions['beginFlowOptions']>;

    const completeFlowOptions = {
      authorizationCodeGrant: makeProfileClaimAuthCodeGrant(this) as never,
    } satisfies NonNullable<AuthRoutesOptions['completeFlowOptions']>;

    // pglite-backed pool adapter, mirroring backend-oauth-callback.steps.ts.
    const dbHandle = this.db;
    const pool = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };

    const app = await __buildTestAuthApp({
      oidcConfig: { ...OIDC_CONFIG },
      oidcClient: __buildStubConfiguration(
        OIDC_CONFIG.issuerUrl,
        OIDC_CONFIG.clientId,
        OIDC_CONFIG.clientSecret,
      ),
      flowState,
      pool,
      beginFlowOptions,
      completeFlowOptions,
      // Match `TEST_SESSION_SECRET` in backend-session-token.steps.ts
      // so the `I have a valid session cookie for that user` step
      // (owned by that file) mints a token the server here verifies.
      sessionTokenSecret: 'test-session-secret',
      cookieSecure: false,
    });
    s.authApp = app;
  },
);

// ============================================================
// Lock-in assertions
// ============================================================

Then(
  'the response body contains none of the profile-claim values',
  function (this: AConversaWorld) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured — When step missing');
    for (const value of profileValuesArray()) {
      assert.ok(
        !res.body.includes(value),
        `response body must not contain profile value ${JSON.stringify(value)}; got body=${res.body}`,
      );
    }
  },
);

Then(
  'the users row for {string} carries only id, oauth_subject, screen_name, created_at, deleted_at',
  async function (this: AConversaWorld, oauthSubject: string) {
    // Pull the row's full column set via information_schema. The
    // assertion is on the column NAMES of the table, not just the
    // selected row — a future migration adding `email` would change
    // the column list even if no row populates it yet.
    const colsResult = (await this.db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users'
       ORDER BY ordinal_position`,
    )) as QueryResult<{ column_name: string }>;
    const columns = colsResult.rows.map((r) => r.column_name).sort();
    // The set of allowed columns. Any extra column (especially
    // profile-data ones like `email`/`name`/`picture`) trips this.
    assert.deepEqual(
      columns,
      ['created_at', 'deleted_at', 'id', 'oauth_subject', 'screen_name'],
      `users table columns must be exactly the no-profile-data set; got ${JSON.stringify(columns)}`,
    );

    // And confirm the row carrying the claimed oauthSubject exists.
    const rowResult = (await this.db.query(
      `SELECT id, oauth_subject, screen_name FROM users WHERE oauth_subject = $1`,
      [oauthSubject],
    )) as QueryResult<{ id: string; oauth_subject: string; screen_name: string }>;
    assert.ok(rowResult.rows.length > 0, `expected a users row with oauth_subject=${oauthSubject}`);
    const row = rowResult.rows[0];
    assert.ok(row, 'row should be defined');
    // No profile value can have leaked into either column.
    for (const value of profileValuesArray()) {
      assert.ok(
        !row.oauth_subject.includes(value),
        `oauth_subject must not contain ${value}; got ${row.oauth_subject}`,
      );
      assert.ok(
        !row.screen_name.includes(value),
        `screen_name must not contain ${value}; got ${row.screen_name}`,
      );
    }
  },
);

Then(
  'the users row for {string} has screen_name {string}',
  async function (this: AConversaWorld, oauthSubject: string, expectedScreenName: string) {
    const result = (await this.db.query(`SELECT screen_name FROM users WHERE oauth_subject = $1`, [
      oauthSubject,
    ])) as QueryResult<{ screen_name: string }>;
    assert.equal(result.rows[0]?.screen_name, expectedScreenName);
  },
);

Then(
  'the response body has exactly the keys {string}',
  function (this: AConversaWorld, expectedKeysCsv: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    const expected = expectedKeysCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .sort();
    const actual = Object.keys(parsed).sort();
    assert.deepEqual(
      actual,
      expected,
      `response body must have exactly the keys ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  },
);

Then('the users migration file contains no profile-data column names', async function () {
  // Resolve the migration relative to this step file. The step file
  // lives at tests/behavior/steps/; the migration at
  // apps/server/migrations/.
  const here = fileURLToPath(import.meta.url);
  const migrationPath = resolve(
    here,
    '..',
    '..',
    '..',
    '..',
    'apps',
    'server',
    'migrations',
    '0001_users.sql',
  );
  const sql = await readFile(migrationPath, 'utf8');

  // Same forbidden patterns as the Vitest sibling. Word-bounded so
  // an inline comment mentioning the rule doesn't trip the check.
  const forbidden = [
    /\bemail\b/i,
    /\bgiven_name\b/i,
    /\bfamily_name\b/i,
    /\bpicture\b/i,
    /\blocale\b/i,
    /\bpreferred_username\b/i,
    /\bfull_name\b/i,
    /\bavatar(_url)?\b/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(sql), `users migration must not contain ${pattern.source}; failed`);
  }
  // And the canonical columns ARE there (guard against a future PR
  // that nukes the migration without us noticing).
  for (const name of ['id', 'oauth_subject', 'screen_name', 'created_at', 'deleted_at']) {
    const pattern = new RegExp(`\\b${name}\\b`);
    assert.ok(pattern.test(sql), `users migration must declare column ${name}; not found`);
  }
});

After(async function (this: AConversaWorld) {
  const s = scratch(this);
  if (s.authApp) {
    await s.authApp.close();
    delete s.authApp;
  }
});
