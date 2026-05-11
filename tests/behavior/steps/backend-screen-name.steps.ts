// Step definitions for tests/behavior/backend/screen-name.feature.
//
// Refinement: tasks/refinements/backend/screen_name_collection.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.screen_name_collection
//
// **What this layer exercises.** `POST /auth/screen-name` end-to-end
// against a real pglite-backed users table. The path the scenarios
// drive:
//
//   1. Build the auth app (shared `Given` step from
//      `backend-oauth-callback.steps.ts`).
//   2. Run `/auth/login` → capture the state → `/auth/callback` to
//      land a real row with `screen_name = '<pending>'` AND a real
//      signed `aconversa-auth-pending` cookie on `Set-Cookie`.
//   3. POST `/auth/screen-name` carrying that cookie back.
//
// What's real:
//
//   - The cookie signing key (`'test-session-secret'` per the
//     callback-step `Given`), the cookie HMAC, the cookie parser.
//   - The users-table UPDATE — runs against pglite via the world's
//     PGlite handle.
//
// Per ADR 0022, this Cucumber layer is the regression test for the
// end-to-end wiring; the Vitest layer covers pure-logic primitives
// in isolation.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { PENDING_COOKIE_NAME } from '../../../apps/server/src/auth/index.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

// Local view onto the shared scratch state created by
// `backend-oauth-callback.steps.ts`. Re-declared here as a structural
// shape rather than imported because Cucumber's step files share the
// `world.scratch` object via `Record<string, unknown>`; the cast at
// each call site narrows to the local view.
interface ScreenNameScratch {
  authApp?: {
    inject(options: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: unknown;
    }): Promise<{
      statusCode: number;
      body: string;
      headers: Record<string, unknown>;
    }>;
    close?(): Promise<void>;
  };
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  // The cookie value extracted from `/auth/callback`'s Set-Cookie
  // response header — what the screen-name POST replays back.
  pendingCookieValue?: string;
  // User-id from the callback response body — used by the "already
  // set" scenario to issue the UPDATE directly.
  callbackUserId?: string;
  // Carried from `backend-oauth-callback.steps.ts` so we don't
  // duplicate the deterministic-state plumbing.
  capturedState?: string;
  stubSub?: string;
}

function scratch(world: AConversaWorld): ScreenNameScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as ScreenNameScratch;
}

/**
 * Pull the pending-cookie value out of a `Set-Cookie` header. The
 * header can be a string or string[] depending on how many cookies
 * the response set; we look at every entry and return the first
 * value matching our cookie name.
 */
function extractPendingCookieValue(setCookie: unknown): string | undefined {
  const lines: string[] = Array.isArray(setCookie)
    ? setCookie.filter((line): line is string => typeof line === 'string')
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  for (const line of lines) {
    // Each `Set-Cookie` line is `name=value; attr1; attr2; ...`.
    const firstSemi = line.indexOf(';');
    const head = firstSemi === -1 ? line : line.slice(0, firstSemi);
    const eqIdx = head.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = head.slice(0, eqIdx);
    if (name === PENDING_COOKIE_NAME) {
      return head.slice(eqIdx + 1);
    }
  }
  return undefined;
}

Given(
  'a user with oauth_subject {string} was inserted via the OIDC callback',
  async function (this: AConversaWorld, oauthSubject: string) {
    const s = scratch(this);
    const app = s.authApp;
    assert.ok(app, 'auth app not initialized — Background Given step missing');

    // Run /auth/login to populate the deterministic flow state.
    const loginResp = await app.inject({ method: 'GET', url: '/auth/login' });
    assert.equal(loginResp.statusCode, 302, 'expected /auth/login to redirect');
    const loc = loginResp.headers['location'];
    assert.equal(typeof loc, 'string', 'no Location header on /auth/login');
    const stateParam = new URL(String(loc)).searchParams.get('state');
    assert.ok(stateParam, 'no state param in /auth/login Location');
    s.capturedState = stateParam;

    // Configure the stubbed token-grant to carry the requested sub.
    // The oauth_subject argument is `provider:sub`; we extract the
    // sub half so the namespaced subject the callback computes
    // (issuer-hostname:sub) matches what the scenario asks for.
    const sub = oauthSubject.split(':')[1];
    assert.ok(sub, 'expected oauth_subject of shape "provider:sub"');
    s.stubSub = sub;

    // Run /auth/callback — this inserts the user with the
    // <pending> placeholder AND issues the pending cookie.
    const callbackResp = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=AUTHCODE&state=${encodeURIComponent(stateParam)}`,
    });
    assert.equal(callbackResp.statusCode, 200, `callback failed: ${callbackResp.body}`);
    const body = JSON.parse(callbackResp.body) as { userId?: string };
    assert.ok(body.userId, 'callback response missing userId');
    s.callbackUserId = body.userId;

    // Pull the pending-cookie value off Set-Cookie so the
    // screen-name POST can replay it.
    const cookieValue = extractPendingCookieValue(callbackResp.headers['set-cookie']);
    assert.ok(cookieValue, 'no aconversa-auth-pending cookie set by callback');
    s.pendingCookieValue = cookieValue;
  },
);

Given(
  "the user's screen name has been set to {string}",
  async function (this: AConversaWorld, screenName: string) {
    const s = scratch(this);
    const userId = s.callbackUserId;
    assert.ok(userId, 'no callback userId captured — preceding Given step missing');
    // Apply the same UPDATE the screen-name handler would. Using a
    // direct DB write here keeps the scenario focused on the
    // "second-submit" path rather than re-running the POST twice
    // (which would also work but couples the arrangement to the
    // exact handler shape).
    await this.db.query(
      `UPDATE users SET screen_name = $2 WHERE id = $1 AND screen_name = '<pending>'`,
      [userId, screenName],
    );
  },
);

When(
  'I POST \\/auth\\/screen-name with screenName {string} and the pending cookie',
  async function (this: AConversaWorld, screenName: string) {
    const s = scratch(this);
    const app = s.authApp;
    assert.ok(app, 'auth app not initialized');
    const cookieValue = s.pendingCookieValue;
    assert.ok(cookieValue, 'no pending-cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: {
        cookie: `${PENDING_COOKIE_NAME}=${cookieValue}`,
        'content-type': 'application/json',
      },
      payload: { screenName },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/auth\\/screen-name with screenName {string} and NO pending cookie',
  async function (this: AConversaWorld, screenName: string) {
    const s = scratch(this);
    const app = s.authApp;
    assert.ok(app, 'auth app not initialized');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/screen-name',
      headers: { 'content-type': 'application/json' },
      payload: { screenName },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

Then('the response sets a cleared aconversa-auth-pending cookie', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const setCookie = res.headers['set-cookie'];
  // Set-Cookie header carrier is `string | string[] | undefined`
  // — normalize to a flat string[] of well-typed lines.
  const lines: string[] = Array.isArray(setCookie)
    ? setCookie.filter((line): line is string => typeof line === 'string')
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  const cleared = lines.find(
    (line) => line.startsWith(`${PENDING_COOKIE_NAME}=`) && /Max-Age=0/.test(line),
  );
  assert.ok(
    cleared,
    `expected a cleared ${PENDING_COOKIE_NAME} Set-Cookie (Max-Age=0); got ${JSON.stringify(lines)}`,
  );
});

// Note: `Then('the response status is {int}', ...)`, the
// `Then('the response body's error.code is {string}', ...)`, and the
// `Then('the users row's screen_name is {string}', ...)` steps are
// already defined in sibling step files (`http-server.steps.ts`,
// `backend-oauth-callback.steps.ts`). Cucumber's step library is
// shared across files; redefining a step regex throws on load. We
// reuse the existing definitions here.

// The `users row's screen_name is {string}` step in
// backend-oauth-callback.steps.ts checks the most recent row by
// `created_at DESC LIMIT 1` — which is the row this scenario just
// inserted, so it works for our first-auth scenario unchanged.

// Avoid unused-import flag on `QueryResult` — used by the
// reusable users-table assertion the OAuth callback step file owns.
// We expose the type-only import here so dependent step files can
// see the shape if they want to extend.
export type { QueryResult };
