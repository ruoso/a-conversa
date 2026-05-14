// @vitest-environment node
//
// G-017 pin — TOCTOU between POST /sessions/:id/include's source-side
// `canReference<Kind>` SELECT and a concurrent `PATCH /sessions/<source>
// /privacy` UPDATE on the source session row.
//
// Refinement: tasks/refinements/backend-hardening/inclusion_source_toctou_pin.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: backend_hardening.concurrency_safety.inclusion_source_toctou_pin
//
// **The race.** `canReference<Kind>` runs INSIDE the include handler's
// `withTransaction` against the same client that has FOR UPDATE'd the
// DESTINATION session row. The SOURCE session row referenced through
// `JOIN sessions ON sj.session_id = sessions.id` is NOT FOR UPDATE'd.
// A concurrent `PATCH /sessions/<source>/privacy` (a single
// non-transactional UPDATE in the production code) can interleave
// between the reference predicate's SELECT and the inclusion's COMMIT.
// The handler will succeed even if the source flipped to private a
// microsecond after the SELECT returned.
//
// **The v1 decision (Option A — accept + pin).** The render-policy
// refinement frames inclusion as "an explicit act of disclosure"; a
// milliseconds-wide race window doesn't change the security model
// materially. We pin the current behavior so an auditor sees the
// trade-off; a future tightening (e.g. FOR SHARE on the source row)
// would flip the assertion in one place.
//
// **What this file pins.** Two orderings, both deterministic:
//
//   1. **Wide-open ordering.** Alice's `canReferenceNode` SELECT runs
//      BEFORE Bob's privacy UPDATE commits. Alice's include lands 200
//      even though Bob's flip commits an instant later — the now-
//      included entity sits in the destination's event log forever.
//
//   2. **Closed-shut ordering.** Bob's privacy UPDATE commits BEFORE
//      Alice's `canReferenceNode` SELECT runs. Alice's include
//      surfaces 403 `entity-not-referenceable` — the predicate reads
//      the post-COMMIT value and short-circuits.
//
// Both orderings exercise the same code path; the difference is which
// side of the privacy flip Alice's SELECT lands on. Under READ
// COMMITTED that's a function of commit order, not of statement order
// — and the harness gives us deterministic commit order via the
// `gateOnInsert(destinationId)` API.

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../auth/session-token.js';
import { __buildTestSessionsApp } from '../sessions/routes.js';

import { makeConcurrentWritePool, type ConcurrentWriteHarness } from './concurrent-write-pool.js';

const TEST_SECRET = 'inclusion-source-toctou-test-secret';

const ALICE_ID = '00000000-0000-4000-8000-00000000c001';
const BOB_ID = '00000000-0000-4000-8000-00000000c002';
const SOURCE_SESSION_ID = '00000000-0000-4000-8000-00000000c003';
const DESTINATION_SESSION_ID = '00000000-0000-4000-8000-00000000c004';
const NODE_ID = '00000000-0000-4000-8000-00000000c005';

/**
 * Seed:
 *   - Alice (host of destination, public session A).
 *   - Bob (host of source, public session B — flippable to private).
 *   - Source session B is public, hosted by Bob, with node X already in
 *     the `session_nodes` join table.
 *   - Destination session A is public, hosted by Alice. Alice is the
 *     active moderator of A (the host's auto-join row).
 *   - Alice is NOT a participant of B. Alice's reference path to X
 *     depends ENTIRELY on whether B's privacy is 'public' at the
 *     moment of the `canReferenceNode` SELECT.
 *
 * No seeded events on the destination — the inclusion's
 * `MAX(sequence)+1` lands at sequence 1.
 */
function seededHarness(): ConcurrentWriteHarness {
  return makeConcurrentWritePool({
    initial: {
      users: [
        { id: ALICE_ID, screen_name: 'alice', deleted_at: null },
        { id: BOB_ID, screen_name: 'bob', deleted_at: null },
      ],
      sessions: [
        {
          id: SOURCE_SESSION_ID,
          host_user_id: BOB_ID,
          privacy: 'public',
          topic: 'Source session — Bob is host',
          created_at: new Date('2026-05-11T10:00:00.000Z'),
          ended_at: null,
        },
        {
          id: DESTINATION_SESSION_ID,
          host_user_id: ALICE_ID,
          privacy: 'public',
          topic: 'Destination session — Alice is host',
          created_at: new Date('2026-05-11T10:00:01.000Z'),
          ended_at: null,
        },
      ],
      participants: [
        // Bob's moderator row on the source.
        {
          id: '00000000-0000-4000-9000-00000000c001',
          session_id: SOURCE_SESSION_ID,
          user_id: BOB_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-11T10:00:00.001Z'),
          left_at: null,
        },
        // Alice's moderator row on the destination.
        {
          id: '00000000-0000-4000-9000-00000000c002',
          session_id: DESTINATION_SESSION_ID,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-11T10:00:01.001Z'),
          left_at: null,
        },
      ],
      sessionNodes: [
        // Node X exists in the source session B; Alice's reference
        // path is: "B is public AND X is in B's session_nodes."
        {
          session_id: SOURCE_SESSION_ID,
          entity_id: NODE_ID,
          included_by: BOB_ID,
          included_at: new Date('2026-05-11T10:00:00.500Z'),
        },
      ],
    },
  });
}

async function buildApp(harness: ConcurrentWriteHarness): Promise<FastifyInstance> {
  return __buildTestSessionsApp({
    pool: harness.pool,
    sessionTokenSecret: TEST_SECRET,
  });
}

async function cookieFor(userId: string): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await signSessionToken({ sub: userId }, TEST_SECRET)}`;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

describe('include + source-privacy-flip TOCTOU (G-017 pin)', () => {
  let teardown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (teardown !== undefined) {
      await teardown();
      teardown = undefined;
    }
  });

  it('wide-open ordering — Alice canReferenceNode runs before Bob privacy flip commits; include lands 200 even though source ends up private', async () => {
    const harness = seededHarness();
    const app = await buildApp(harness);
    teardown = async (): Promise<void> => {
      await app.close();
    };

    const aliceCookie = await cookieFor(ALICE_ID);
    const bobCookie = await cookieFor(BOB_ID);

    // Install the gate on the DESTINATION's `INSERT INTO
    // session_events`. The handler's transaction shape is:
    //   BEGIN
    //   SELECT ... FROM sessions WHERE id = $destination FOR UPDATE
    //   SELECT id FROM session_participants ...  -- active check
    //   SELECT 1 AS reachable FROM session_nodes sj JOIN sessions ...
    //   INSERT INTO session_nodes ... ON CONFLICT DO NOTHING RETURNING
    //   SELECT COALESCE(MAX(sequence), 0) FROM session_events ...
    //   INSERT INTO session_events ...      <-- gate fires HERE
    //   COMMIT
    //
    // When the gate fires, `canReferenceNode` has already returned
    // true (B was public at that moment); the destination FOR UPDATE
    // is still held; the join-table INSERT has happened but the
    // event-log INSERT has not, and the transaction has NOT
    // committed. We then fire Bob's privacy UPDATE — it runs against
    // the source row, doesn't contend on Alice's destination lock,
    // and commits immediately. Releasing the gate lets Alice's
    // transaction commit.
    const gate = harness.gateOnInsert(DESTINATION_SESSION_ID);

    const includePromise = app.inject({
      method: 'POST',
      url: `/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: aliceCookie },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });

    // Wait until Alice's transaction is paused at the gate. At this
    // point `canReferenceNode` has already returned TRUE (the SELECT
    // saw B as public); the join-row was inserted; the event INSERT
    // is paused mid-transaction.
    await gate.whenHit;

    // Fire Bob's privacy flip on the SOURCE. The PATCH handler does
    // NOT use a transaction or FOR UPDATE; it issues a visibility-
    // gated row SELECT followed by an UPDATE — both against the
    // source row. Neither contends on Alice's destination lock.
    const flipResult = await app.inject({
      method: 'PATCH',
      url: `/sessions/${SOURCE_SESSION_ID}/privacy`,
      headers: { cookie: bobCookie },
      payload: { privacy: 'private' },
    });
    expect(flipResult.statusCode).toBe(200);

    // Confirm the source is now private in the store BEFORE Alice
    // commits her include.
    const sourceMid = harness.store.sessions.find((s) => s.id === SOURCE_SESSION_ID);
    expect(sourceMid?.privacy).toBe('private');

    // Release Alice's gate — her event INSERT lands; transaction
    // commits.
    gate.release();

    const includeResult = await includePromise;

    // **The pinned outcome.** Alice's include succeeded with 200 even
    // though the source ended up private. This is the v1 trade-off:
    // the canReferenceNode SELECT read 'public' under READ COMMITTED,
    // and the handler committed against that snapshot.
    expect(includeResult.statusCode).toBe(200);
    const includeBody = includeResult.json<{
      entityKind?: string;
      entityId?: string;
      sessionId?: string;
      includedBy?: string;
    }>();
    expect(includeBody.entityKind).toBe('node');
    expect(includeBody.entityId).toBe(NODE_ID);
    expect(includeBody.sessionId).toBe(DESTINATION_SESSION_ID);
    expect(includeBody.includedBy).toBe(ALICE_ID);

    // The join-table row landed on the destination.
    const destJoinRow = harness.store.sessionNodes.find(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === NODE_ID,
    );
    expect(destJoinRow).toBeDefined();
    expect(destJoinRow?.included_by).toBe(ALICE_ID);

    // The entity-included event landed at sequence 1 on the
    // destination.
    const inclusionEvent = harness.store.events.find(
      (e) => e.kind === 'entity-included' && e.session_id === DESTINATION_SESSION_ID,
    );
    expect(inclusionEvent).toBeDefined();
    expect(inclusionEvent?.sequence).toBe(1);

    // And — the load-bearing assertion for this pin — the source
    // session IS now private. The race exposed exactly what G-017
    // describes: the inclusion landed against a source that, by the
    // time Alice's transaction committed, was no longer visible to
    // Alice.
    const sourceAfter = harness.store.sessions.find((s) => s.id === SOURCE_SESSION_ID);
    expect(sourceAfter?.privacy).toBe('private');
  });

  it('closed-shut ordering — Bob privacy flip commits before Alice canReferenceNode runs; include 403 entity-not-referenceable', async () => {
    const harness = seededHarness();
    const app = await buildApp(harness);
    teardown = async (): Promise<void> => {
      await app.close();
    };

    const aliceCookie = await cookieFor(ALICE_ID);
    const bobCookie = await cookieFor(BOB_ID);

    // Fire Bob's privacy flip FIRST and wait for it to commit. No
    // gate — the PATCH runs to completion before Alice's include
    // even starts. This pins the "closed-shut" half of the race:
    // when the privacy UPDATE wins the commit-order race, the
    // canReferenceNode SELECT in Alice's transaction reads the
    // post-COMMIT value ('private') and rejects.
    const flipResult = await app.inject({
      method: 'PATCH',
      url: `/sessions/${SOURCE_SESSION_ID}/privacy`,
      headers: { cookie: bobCookie },
      payload: { privacy: 'private' },
    });
    expect(flipResult.statusCode).toBe(200);

    const sourceAfterFlip = harness.store.sessions.find((s) => s.id === SOURCE_SESSION_ID);
    expect(sourceAfterFlip?.privacy).toBe('private');

    // Now Alice's include. `canReferenceNode` reads B as 'private' +
    // host_user_id = BOB (not Alice) + no participant row for Alice
    // on B → no row returned → reachable = false → handler emits 403
    // `entity-not-referenceable`.
    const includeResult = await app.inject({
      method: 'POST',
      url: `/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: aliceCookie },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });

    expect(includeResult.statusCode).toBe(403);
    const errorBody = includeResult.json<ErrorEnvelope>();
    expect(errorBody.error?.code).toBe('entity-not-referenceable');

    // No join-row landed on the destination.
    const destJoinRow = harness.store.sessionNodes.find(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === NODE_ID,
    );
    expect(destJoinRow).toBeUndefined();

    // No entity-included event landed on the destination.
    const inclusionEvent = harness.store.events.find(
      (e) => e.kind === 'entity-included' && e.session_id === DESTINATION_SESSION_ID,
    );
    expect(inclusionEvent).toBeUndefined();
  });
});
