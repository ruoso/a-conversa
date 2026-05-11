// Step definitions for tests/behavior/backend/session-visibility.feature.
//
// Refinement: tasks/refinements/backend/privacy_field_enforcement.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.privacy_field_enforcement
//
// **What this layer exercises.** The canonical `canSeeSession`
// predicate from `apps/server/src/sessions/visibility.ts`, run against
// the migrated schema in pglite. The `sessions` and
// `session_participants` tables are real; the predicate's parameterized
// SELECT runs through the production module against the pglite-backed
// DbPool adapter (the same adapter the create-session / list-session /
// get-session scenarios use, registered in
// backend-create-session.steps.ts's "the sessions server is built with
// the pglite-backed pool" Given).
//
// What's covered:
//   1. Public session → true for non-participant non-host.
//   2. Private session → true for host.
//   3. Private session → true for active participant (`left_at IS NULL`).
//   4. Private session → true for historical participant (`left_at IS NOT NULL`).
//   5. Private session → false for stranger.
//   6. Unknown session id → false.
//
// What's reused (defined elsewhere — Cucumber globs all step files):
//   - "the sessions server is built with the pglite-backed pool"
//     → tests/behavior/steps/backend-create-session.steps.ts.
//   - "a user with oauth_subject {string} exists with screen_name {string}"
//     → tests/behavior/steps/backend-session-token.steps.ts.
//   - "a private session with topic {string} exists for user {string}"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "user {string} is a participant in that private session"
//     → tests/behavior/steps/backend-list-sessions.steps.ts.
//   - "a public session with topic {string} exists for user {string}"
//     → tests/behavior/steps/backend-list-sessions-filters.steps.ts.
//
// New steps defined here:
//   - Given: "user {string} is a historical (left) participant in that private session"
//     (parallel to the active-participant Given; sets `left_at` to a
//     fixed past timestamp so the row is historical, not active).
//   - When: "I ask whether user {string} can see the most recently created session"
//   - When: "I ask whether user {string} can see the session with id {string}"
//   - Then: "the visibility predicate returns true"
//   - Then: "the visibility predicate returns false"

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';

import { canSeeSession } from '../../../apps/server/src/sessions/visibility.js';
import type { AConversaWorld, QueryResult } from '../support/world.js';

interface VisibilityScratch {
  lastVisibility?: boolean;
}

function scratch(world: AConversaWorld): VisibilityScratch {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return world.scratch as VisibilityScratch;
}

// ============================================================
// Givens — seed sessions / participation rows specific to this feature.
// (The historical-participant variant is the only NEW Given; the others
// are reused from sibling step files — see the header comment.)
// ============================================================

Given(
  'user {string} is a historical \\(left) participant in that private session',
  async function (this: AConversaWorld, screenName: string) {
    // Variant of `user "X" is a participant in that private session`
    // (from backend-list-sessions.steps.ts), but with `left_at` set to
    // a fixed past timestamp so the row is historical, not active. The
    // visibility rule must still let this user see the session (the
    // architecture's "once you've seen it, you've seen it" framing).
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const sessionRes = (await this.db.query(
      "SELECT id FROM sessions WHERE privacy = 'private' ORDER BY created_at DESC LIMIT 1",
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'no private session found to seed a historical participant into');
    await this.db.query(
      `INSERT INTO session_participants (session_id, user_id, role, joined_at, left_at)
       VALUES ($1, $2, 'debater-A', '2026-04-01T10:00:00.000Z', '2026-04-02T10:00:00.000Z')`,
      [sessionId, userId],
    );
  },
);

// ============================================================
// Whens — invoke `canSeeSession` directly. The predicate is the
// canonical "can this user see this session?" surface; this feature
// exercises it head-on (the sibling endpoint features cover the same
// rule WHERE-clause-style through the routes plugin).
// ============================================================

When(
  'I ask whether user {string} can see the most recently created session',
  async function (this: AConversaWorld, screenName: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const sessionRes = (await this.db.query(
      'SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1',
    )) as QueryResult<{ id: string }>;
    const sessionId = sessionRes.rows[0]?.id;
    assert.ok(sessionId, 'no sessions row found to test visibility against');
    // Adapter — translate the pglite handle's `query` onto the
    // `VisibilityExecutor` shape `canSeeSession` consumes. Same
    // pattern the create-session step file's "sessions server is
    // built ..." Given uses to feed the routes plugin.
    const dbHandle = this.db;
    const executor = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };
    scratch(this).lastVisibility = await canSeeSession(executor, sessionId, userId);
  },
);

When(
  'I ask whether user {string} can see the session with id {string}',
  async function (this: AConversaWorld, screenName: string, sessionId: string) {
    const userRes = (await this.db.query('SELECT id FROM users WHERE screen_name = $1 LIMIT 1', [
      screenName,
    ])) as QueryResult<{ id: string }>;
    const userId = userRes.rows[0]?.id;
    assert.ok(userId, `no users row found for screen_name ${screenName}`);
    const dbHandle = this.db;
    const executor = {
      async query<TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> {
        const result = await dbHandle.query<TRow>(text, params as unknown[] | undefined);
        return { rows: result.rows };
      },
    };
    scratch(this).lastVisibility = await canSeeSession(executor, sessionId, userId);
  },
);

// ============================================================
// Thens — assert the captured visibility boolean.
// ============================================================

Then('the visibility predicate returns true', function (this: AConversaWorld) {
  const visible = scratch(this).lastVisibility;
  assert.equal(visible, true, 'expected the visibility predicate to return true');
});

Then('the visibility predicate returns false', function (this: AConversaWorld) {
  const visible = scratch(this).lastVisibility;
  assert.equal(visible, false, 'expected the visibility predicate to return false');
});
