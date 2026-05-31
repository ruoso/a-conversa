// Steps for tests/behavior/projection/cache.feature.
//
// The behavior-test layer for `ProjectionCache`. Vitest covers the
// cache lifecycle with an injected stub loader; these scenarios
// exercise the real-DB rehydration path: a pglite-driven
// `EventLoader` SELECTs `session_events` ORDER BY sequence and runs
// each row through the row→envelope mapping. The cache uses the
// loader for both initial hydration and post-eviction rehydration.
//
// Refinement: tasks/refinements/data-and-methodology/projection_caching.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import { loadFixture } from '../../../packages/test-fixtures/src/loader.js';
import {
  evId,
  insertEventRow,
  rowToEnvelopeShape,
  selectEvents,
  type EnvelopeShape,
} from '../support/event-rows.js';
import { type Event, type EventKind } from '../../../packages/shared-types/src/events.js';
import {
  appendSessionEvent,
  type SessionEventAppendClient,
} from '../../../apps/server/src/events/append.js';
import {
  ProjectionCache,
  type EventLoader,
  type Projection,
} from '../../../apps/server/src/projection/index.js';

// Bridge the loader's wider `LoadFixtureClient` to
// `appendSessionEvent`'s narrower `SessionEventAppendClient`. Both
// shapes are satisfied by the underlying pglite handle.
async function appendForFixture(
  client: { query: (text: string, params?: ReadonlyArray<unknown>) => Promise<unknown> },
  event: Event,
): Promise<void> {
  await appendSessionEvent(client as unknown as SessionEventAppendClient, event);
}

const EMPTY_FIXTURE_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const NEW_PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444';
const TS_NEW = '2026-01-01T00:00:10.000Z';

// The empty fixture's `session-created` payload pre-dates the
// tightened payload schemas (no `created_at`); `participant-joined`
// payloads carry an extra `participant_id` Zod would strip. Building
// envelopes by hand here mirrors the pattern in
// projection-from-log.steps.ts and projection-incremental.steps.ts —
// the on-disk fixture stays as-is; the loader tolerates the
// pre-tightened shape so the cache scenario can rebuild a projection
// from it.
function asEventKind(k: string): EventKind {
  return k as EventKind;
}

function envelopeToEvent(shape: EnvelopeShape): Event {
  return {
    id: shape.id,
    sessionId: shape.sessionId,
    sequence: shape.sequence,
    kind: asEventKind(shape.kind),
    actor: shape.actor,
    payload: shape.payload,
    createdAt: shape.createdAt,
  } as Event;
}

interface CacheScratch {
  cache: ProjectionCache;
  loaderCalls: { count: number };
}

function getCacheScratch(world: AConversaWorld): CacheScratch {
  const value = world.scratch['cacheScratch'];
  if (value === undefined) {
    throw new Error('cacheScratch not initialized — did the build step run?');
  }
  return value as CacheScratch;
}

Given('the empty fixture is loaded for cache tests', async function (this: AConversaWorld) {
  await loadFixture('empty', this.client, { appendEvent: appendForFixture });
});

When('I build a pglite-driven event loader and a ProjectionCache', function (this: AConversaWorld) {
  const loaderCalls = { count: 0 };
  const loader: EventLoader = async (sessionId: string): Promise<Event[]> => {
    loaderCalls.count += 1;
    const rows = await selectEvents(this, sessionId);
    return rows.map((row) => envelopeToEvent(rowToEnvelopeShape(row)));
  };
  const cache = new ProjectionCache({ loader });
  this.scratch['cacheScratch'] = { cache, loaderCalls } satisfies CacheScratch;
});

When('I getProjection the empty fixture session', async function (this: AConversaWorld) {
  const { cache } = getCacheScratch(this);
  const projection = await cache.getProjection(EMPTY_FIXTURE_SESSION_ID);
  this.scratch['cachedProjection'] = projection;
});

When('I getProjection the empty fixture session again', async function (this: AConversaWorld) {
  const { cache } = getCacheScratch(this);
  const projection = await cache.getProjection(EMPTY_FIXTURE_SESSION_ID);
  this.scratch['rehydratedProjection'] = projection;
});

When('I evict the empty fixture session from the cache', function (this: AConversaWorld) {
  const { cache } = getCacheScratch(this);
  cache.evict(EMPTY_FIXTURE_SESSION_ID);
});

When(
  'I insert a fresh participant-joined event at sequence {int}',
  async function (this: AConversaWorld, sequence: number) {
    // The actor must reference a user. The empty fixture's three
    // users all already have an open participant record; rather
    // than wrestle the projection's "already joined" invariant,
    // INSERT a fresh user row and use them as the late joiner. The
    // moderator (alice) is the actor on the event — matching how
    // a moderator typically welcomes a new participant.
    await this.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
      NEW_PARTICIPANT_ID,
      'fixture:late-joiner',
      'late-joiner',
    ]);
    await insertEventRow(this, EMPTY_FIXTURE_SESSION_ID, {
      id: evId(sequence * 10),
      sequence,
      kind: 'participant-joined',
      actor: '11111111-1111-4111-8111-111111111111',
      payload: {
        user_id: NEW_PARTICIPANT_ID,
        role: 'debater-A',
        screen_name: 'late-joiner',
        joined_at: TS_NEW,
      },
      createdAt: TS_NEW,
    });
    this.scratch['lateJoinerSequence'] = sequence;
  },
);

When('I apply that event through the cache', async function (this: AConversaWorld) {
  const { cache } = getCacheScratch(this);
  const sequence = this.scratch['lateJoinerSequence'] as number;
  // Re-SELECT the just-inserted row so we apply the same shape the
  // loader would have produced after an eviction-and-rehydrate.
  const rows = await selectEvents(this, EMPTY_FIXTURE_SESSION_ID);
  const row = rows.find((r) => Number(r.sequence) === sequence);
  assert.ok(row, `expected to find inserted event at sequence ${sequence}`);
  const event = envelopeToEvent(rowToEnvelopeShape(row));
  await cache.applyEvent(EMPTY_FIXTURE_SESSION_ID, event);
});

Then(
  'the cached projection has lastAppliedSequence {int}',
  function (this: AConversaWorld, n: number) {
    const projection = this.scratch['cachedProjection'] as Projection;
    assert.equal(projection.lastAppliedSequence, n);
  },
);

Then(
  'the cached projection has {int} current participants',
  function (this: AConversaWorld, n: number) {
    const projection = this.scratch['cachedProjection'] as Projection;
    assert.equal(projection.currentParticipants().length, n);
  },
);

Then(
  'the rehydrated projection has lastAppliedSequence {int}',
  function (this: AConversaWorld, n: number) {
    const projection = this.scratch['rehydratedProjection'] as Projection;
    assert.equal(projection.lastAppliedSequence, n);
  },
);

Then(
  'the rehydrated projection has {int} current participants',
  function (this: AConversaWorld, n: number) {
    const projection = this.scratch['rehydratedProjection'] as Projection;
    assert.equal(projection.currentParticipants().length, n);
  },
);

Then('the loader has been invoked {int} time', function (this: AConversaWorld, n: number) {
  const { loaderCalls } = getCacheScratch(this);
  assert.equal(loaderCalls.count, n);
});

Then('the loader has been invoked {int} times', function (this: AConversaWorld, n: number) {
  const { loaderCalls } = getCacheScratch(this);
  assert.equal(loaderCalls.count, n);
});
