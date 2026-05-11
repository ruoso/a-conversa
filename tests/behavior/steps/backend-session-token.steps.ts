// Step definitions for tests/behavior/backend/session-token.feature.
//
// Refinement: tasks/refinements/backend/session_token_management.md
// ADRs:        docs/adr/0002-auth-self-hosted-oidc-authelia.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.auth.session_token_management
//
// **What this layer exercises.** The full session-cookie lifecycle
// end-to-end against a real pglite-backed users table:
//
//   1. OIDC callback → returning-user → 302 + session cookie set.
//   2. OIDC callback → new-user → 200 + pending cookie + needsScreenName.
//   3. POST /auth/screen-name on new-user row → session cookie set +
//      pending cookie cleared.
//   4. GET /auth/me with session cookie → 200; POST /auth/logout →
//      204 + cleared session cookie; GET /auth/me without cookie → 401.
//
// What's real:
//
//   - The JWT signing/verifying via `jose` (HS256).
//   - The users-table SELECT-by-id `/auth/me` issues — runs against
//     pglite via the world's PGlite handle.
//   - The cookie-header parsing on the in-process Fastify inject.
//
// Per ADR 0022, this Cucumber layer is the regression test for the
// end-to-end wiring; the Vitest layer covers pure-logic primitives
// in isolation.

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import {
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
} from '../../../apps/server/src/auth/index.js';
import type { AConversaWorld } from '../support/world.js';

// Local view onto the shared scratch state. Cucumber's step files
// share the `world.scratch` object via `Record<string, unknown>`;
// the cast at each call site narrows to the local view.
interface SessionTokenScratch {
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
  // Captured session cookie value — set by the explicit Given that
  // mints one OR by extracting it from a callback / screen-name
  // response Set-Cookie header.
  sessionCookieValue?: string;
  // Captured pending cookie value carried over from a prior callback,
  // re-used by the screen-name step.
  pendingCookieValue?: string;
  callbackUserId?: string;
  capturedState?: string;
  stubSub?: string;
}

function scratch(world: AConversaWorld): SessionTokenScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SessionTokenScratch;
}

/**
 * Normalize the Set-Cookie header into an array of cookie-line strings.
 * Fastify's inject can return either a single string or a string[]
 * depending on how many cookies the response set.
 */
function setCookieLines(setCookie: unknown): string[] {
  if (Array.isArray(setCookie)) {
    return setCookie.filter((s): s is string => typeof s === 'string');
  }
  if (typeof setCookie === 'string') {
    // Fastify may join multiple Set-Cookies with a comma. We can't
    // naively split on `,` because cookie values themselves can carry
    // commas in attributes (e.g. `Expires=Wed, 09 Jun 2021 ...`). The
    // safer split is on `, name=` patterns; but our own cookie names
    // are simple, so we split on `, ` only when followed by our cookie
    // name. Best-effort: most modern Fastify versions return an array
    // already, so the array branch above usually wins.
    return setCookie
      .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

/**
 * Extract a cookie's value from a Set-Cookie header by cookie name.
 * Returns `undefined` if the cookie isn't present in any line.
 */
function extractCookieValue(setCookie: unknown, cookieName: string): string | undefined {
  for (const line of setCookieLines(setCookie)) {
    const firstSemi = line.indexOf(';');
    const head = firstSemi === -1 ? line : line.slice(0, firstSemi);
    const eqIdx = head.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = head.slice(0, eqIdx);
    if (name === cookieName) {
      return head.slice(eqIdx + 1);
    }
  }
  return undefined;
}

/**
 * Look for a Set-Cookie line that EXISTS and is NOT a Max-Age=0
 * clearing line. Returns the matching cookie value or undefined.
 */
function findSetCookieValue(setCookie: unknown, cookieName: string): string | undefined {
  for (const line of setCookieLines(setCookie)) {
    if (!line.startsWith(`${cookieName}=`)) continue;
    if (/Max-Age=0\b/.test(line)) continue;
    const firstSemi = line.indexOf(';');
    const head = firstSemi === -1 ? line : line.slice(0, firstSemi);
    const eqIdx = head.indexOf('=');
    if (eqIdx <= 0) continue;
    return head.slice(eqIdx + 1);
  }
  return undefined;
}

// The shared test secret pinned by `backend-oauth-callback.steps.ts`
// in the Background. We re-use it here so the JWT we mint client-side
// (for the "I have a valid session cookie" step) is signed under the
// same key the server uses to verify.
const TEST_SESSION_SECRET = 'test-session-secret';

// ============================================================
// Givens
// ============================================================

Given(
  'a user with oauth_subject {string} exists with screen_name {string}',
  async function (this: AConversaWorld, oauthSubject: string, screenName: string) {
    await this.db.query(
      `INSERT INTO users (oauth_subject, screen_name) VALUES ($1, $2) RETURNING id`,
      [oauthSubject, screenName],
    );
  },
);

Given('I have a valid session cookie for that user', async function (this: AConversaWorld) {
  // Look up the most-recently-created users row's id and mint a
  // JWT that the server-side verifier (using the same shared
  // secret) will accept.
  const result = (await this.db.query('SELECT id FROM users ORDER BY created_at DESC LIMIT 1')) as {
    rows: Array<{ id: string }>;
  };
  const userId = result.rows[0]?.id;
  assert.ok(userId, 'no users row found to mint a session cookie for');
  const token = await signSessionToken({ sub: userId }, TEST_SESSION_SECRET);
  scratch(this).sessionCookieValue = token;
});

// ============================================================
// Whens — augmenting the existing oauth-callback flow steps with
// session-cookie-specific endpoints.
// ============================================================

When('I GET \\/auth\\/me with the session cookie', async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = s.authApp;
  assert.ok(app, 'auth app not initialized');
  const cookieValue = s.sessionCookieValue;
  assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
  const response = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

When('I GET \\/auth\\/me without any session cookie', async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = s.authApp;
  assert.ok(app, 'auth app not initialized');
  const response = await app.inject({ method: 'GET', url: '/auth/me' });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

When('I POST \\/auth\\/logout with the session cookie', async function (this: AConversaWorld) {
  const s = scratch(this);
  const app = s.authApp;
  assert.ok(app, 'auth app not initialized');
  const cookieValue = s.sessionCookieValue;
  assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
  const response = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
  });
  s.lastResponse = {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
});

// ============================================================
// Thens — Set-Cookie assertions specific to the session cookie
// ============================================================

Then(
  'the response sets a aconversa-session cookie carrying a valid JWT',
  async function (this: AConversaWorld) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const token = findSetCookieValue(res.headers['set-cookie'], SESSION_COOKIE_NAME);
    assert.ok(
      token,
      `expected a ${SESSION_COOKIE_NAME}=<jwt> Set-Cookie; got ${JSON.stringify(setCookieLines(res.headers['set-cookie']))}`,
    );
    // The JWT must verify under the shared test secret. We don't
    // assert the sub here — the surrounding scenario already covers
    // identity propagation; this step proves "what came back is a
    // real, current JWT" — i.e. signature valid + not expired.
    const payload = await verifySessionToken(token, TEST_SESSION_SECRET);
    assert.ok(payload, 'session cookie value did not verify as a valid JWT');
    // Stash the cookie for downstream steps that re-use it.
    scratch(this).sessionCookieValue = token;
  },
);

Then('the response does NOT set a aconversa-session cookie', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const token = findSetCookieValue(res.headers['set-cookie'], SESSION_COOKIE_NAME);
  assert.equal(
    token,
    undefined,
    `expected NO ${SESSION_COOKIE_NAME} Set-Cookie; got ${JSON.stringify(setCookieLines(res.headers['set-cookie']))}`,
  );
});

Then('the response sets a aconversa-auth-pending cookie', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const value = findSetCookieValue(res.headers['set-cookie'], 'aconversa-auth-pending');
  assert.ok(
    value,
    `expected an aconversa-auth-pending Set-Cookie; got ${JSON.stringify(setCookieLines(res.headers['set-cookie']))}`,
  );
  scratch(this).pendingCookieValue = value;
});

Then('the response does NOT set a aconversa-auth-pending cookie', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const value = findSetCookieValue(res.headers['set-cookie'], 'aconversa-auth-pending');
  assert.equal(
    value,
    undefined,
    `expected NO aconversa-auth-pending Set-Cookie; got ${JSON.stringify(setCookieLines(res.headers['set-cookie']))}`,
  );
});

Then('the response sets a cleared aconversa-session cookie', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const cleared = setCookieLines(res.headers['set-cookie']).find(
    (line) => line.startsWith(`${SESSION_COOKIE_NAME}=`) && /Max-Age=0/.test(line),
  );
  assert.ok(
    cleared,
    `expected a cleared ${SESSION_COOKIE_NAME} Set-Cookie (Max-Age=0); got ${JSON.stringify(setCookieLines(res.headers['set-cookie']))}`,
  );
});

Then("the response body's needsScreenName is true", function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { needsScreenName?: unknown };
  assert.equal(body.needsScreenName, true);
});

Then(
  "the response body's screenName is {string}",
  function (this: AConversaWorld, expected: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { screenName?: unknown };
    assert.equal(body.screenName, expected);
  },
);

// Note: `the Location header points at {string}` is owned by
// backend-oauth-callback.steps.ts. The existing definition checks the
// Location header starts with the expected prefix — for the
// returning-user scenario, the Location is exactly `APP_BASE_URL`
// (= "http://localhost:3000"), which `startsWith` accepts.

// Note: `the response body's error.code is {string}` is owned by
// backend-oauth-callback.steps.ts. The `auth-session-invalid` envelope
// asserts via that step unchanged.

// Note: `extractCookieValue` is used only for non-set-cookie reads
// elsewhere; today's session-token scenarios don't need it. Exported
// shape kept minimal — `findSetCookieValue` does the work for Set-Cookie
// assertions and the session cookie is the only Set-Cookie the scenarios
// inspect by value.
export { extractCookieValue };
