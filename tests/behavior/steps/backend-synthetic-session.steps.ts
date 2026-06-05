// Cucumber steps for the test-mode synthetic-session generator.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
//              docs/adr/0007-cucumber-pglite.md,
//              docs/adr/0022-no-throwaway-verifications.md
//
// Builds the test-mode plugin (via `__buildTestTestModeApp`) over the
// per-scenario pglite handle, injects the list + generate requests, and
// asserts both response shape AND the persisted DB rows — the wire proof
// that generation writes the real event log other surfaces read.
//
// Reused shared steps (NOT redefined here, to avoid ambiguous-match):
//   - Given "a user with oauth_subject {string} exists with screen_name {string}"
//     and "I have a valid session cookie for that user"
//       → backend-session-token.steps.ts
//   - Then "the response status is {int}"   → http-server.steps.ts
//   - Then "the response body's error.code is {string}"
//       → backend-oauth-callback.steps.ts
// All of those read/write the same `this.scratch.{lastResponse,
// sessionCookieValue}` keys this file writes, so the cross-file seam
// lines up.

import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { SESSION_COOKIE_NAME } from '../../../apps/server/src/auth/index.js';
import { __buildTestTestModeApp } from '../../../apps/server/src/test-mode/routes.js';
import { walkthroughFixtureData } from '../../../apps/server/src/test-mode/synthetic/walkthrough.data.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

type FastifyAppInstance = Awaited<ReturnType<typeof __buildTestTestModeApp>>;

interface SyntheticScratch {
  testModeApp?: FastifyAppInstance;
  lastResponse?: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  };
  sessionCookieValue?: string;
  generatedSessionId?: string;
}

function scratch(world: AConversaWorld): SyntheticScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as SyntheticScratch;
}

const TEST_SESSION_SECRET = 'test-session-secret';

Given(
  'the test-mode server is built with the pglite-backed pool',
  async function (this: AConversaWorld) {
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
    const app = await __buildTestTestModeApp({ pool, sessionTokenSecret: TEST_SESSION_SECRET });
    scratch(this).testModeApp = app;
  },
);

When(
  'I GET \\/test-mode\\/synthetic-scenarios with the session cookie',
  async function (this: AConversaWorld) {
    const s = scratch(this);
    const app = s.testModeApp;
    assert.ok(app, 'test-mode app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'GET',
      url: '/api/test-mode/synthetic-scenarios',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/test-mode\\/synthetic-sessions with scenario {string}',
  async function (this: AConversaWorld, scenario: string) {
    const s = scratch(this);
    const app = s.testModeApp;
    assert.ok(app, 'test-mode app not initialized — Background step missing');
    const cookieValue = s.sessionCookieValue;
    assert.ok(cookieValue, 'no session cookie captured — preceding Given missing');
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-mode/synthetic-sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      payload: { scenario },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

When(
  'I POST \\/test-mode\\/synthetic-sessions with scenario {string} and no session cookie',
  async function (this: AConversaWorld, scenario: string) {
    const s = scratch(this);
    const app = s.testModeApp;
    assert.ok(app, 'test-mode app not initialized — Background step missing');
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-mode/synthetic-sessions',
      payload: { scenario },
    });
    s.lastResponse = {
      statusCode: response.statusCode,
      body: response.body,
      headers: response.headers,
    };
  },
);

Then(
  "the response body's scenarios include {string}",
  function (this: AConversaWorld, key: string) {
    const res = scratch(this).lastResponse;
    assert.ok(res, 'no response captured');
    const body = JSON.parse(res.body) as { scenarios?: Array<{ key?: string }> };
    const keys = (body.scenarios ?? []).map((d) => d.key);
    assert.ok(keys.includes(key), `expected scenarios to include "${key}"; got ${keys.join(', ')}`);
  },
);

Then('the response body carries a sessionId', function (this: AConversaWorld) {
  const res = scratch(this).lastResponse;
  assert.ok(res, 'no response captured');
  const body = JSON.parse(res.body) as { sessionId?: unknown };
  assert.equal(typeof body.sessionId, 'string', 'expected a string sessionId in the response body');
  scratch(this).generatedSessionId = body.sessionId as string;
});

Then('the generated session is owned by that user', async function (this: AConversaWorld) {
  const sessionId = scratch(this).generatedSessionId;
  assert.ok(sessionId, 'no generated sessionId captured — preceding Then missing');
  // "That user" is the Background caller, NOT a synthetic debater. The
  // generate route upserts the `synthetic:` users (with a LATER created_at)
  // before appending the log, so a bare `ORDER BY created_at DESC` would
  // resolve a synthetic debater rather than the authenticated operator.
  // Exclude the synthetic namespace to reliably pin the real caller.
  const userRes = (await this.db.query(
    "SELECT id FROM users WHERE oauth_subject NOT LIKE 'synthetic:%' ORDER BY created_at DESC LIMIT 1",
  )) as QueryResult<{ id: string }>;
  const userId = userRes.rows[0]?.id;
  assert.ok(userId, 'no users row found');
  const res = (await this.db.query('SELECT host_user_id FROM sessions WHERE id = $1', [
    sessionId,
  ])) as QueryResult<{ host_user_id: string }>;
  assert.equal(res.rows.length, 1, 'expected exactly one sessions row for the generated session');
  assert.equal(res.rows[0]?.host_user_id, userId);
});

Then(
  'the generated session has session_events at sequences {string}',
  async function (this: AConversaWorld, csv: string) {
    const sessionId = scratch(this).generatedSessionId;
    assert.ok(sessionId, 'no generated sessionId captured — preceding Then missing');
    const expected = csv.split(',').map((n) => Number(n.trim()));
    const res = (await this.db.query(
      'SELECT sequence FROM session_events WHERE session_id = $1 ORDER BY sequence ASC',
      [sessionId],
    )) as QueryResult<{ sequence: string | number }>;
    const actual = res.rows.map((r) => Number(r.sequence));
    assert.deepEqual(actual, expected);
  },
);

Then(
  'the generated session has more than {int} session_events',
  async function (this: AConversaWorld, floor: number) {
    const sessionId = scratch(this).generatedSessionId;
    assert.ok(sessionId, 'no generated sessionId captured — preceding Then missing');
    const res = (await this.db.query(
      'SELECT COUNT(*)::int AS count FROM session_events WHERE session_id = $1',
      [sessionId],
    )) as QueryResult<{ count: number }>;
    assert.ok(
      (res.rows[0]?.count ?? 0) > floor,
      `expected more than ${String(floor)} events; got ${String(res.rows[0]?.count)}`,
    );
  },
);

Then(
  'the generated session has the full walkthrough event log in ascending sequence',
  async function (this: AConversaWorld) {
    const sessionId = scratch(this).generatedSessionId;
    assert.ok(sessionId, 'no generated sessionId captured — preceding Then missing');
    const res = (await this.db.query(
      'SELECT sequence FROM session_events WHERE session_id = $1 ORDER BY sequence ASC',
      [sessionId],
    )) as QueryResult<{ sequence: string | number }>;
    const actual = res.rows.map((r) => Number(r.sequence));
    // The full rich log persisted — count matches the vendored fixture
    // (the wire proof), and sequences are contiguous ascending from 1.
    const expectedCount = walkthroughFixtureData.events.length;
    const expected = Array.from({ length: expectedCount }, (_, i) => i + 1);
    assert.deepEqual(actual, expected);
  },
);

After(async function (this: AConversaWorld) {
  const s = scratch(this);
  if (s.testModeApp) {
    await s.testModeApp.close();
    delete s.testModeApp;
  }
});
