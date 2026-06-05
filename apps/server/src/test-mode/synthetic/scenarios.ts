// Server-side synthetic-scenario builders.
//
// Refinement: tasks/refinements/replay_test/test_mode_synthetic_session.md
// ADRs:        docs/adr/0041-synthetic-session-generation-dev-gated-seam.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0020-postgres-write-path-locking-and-event-ordering.md
// TaskJuggler: replay_test.test_mode.test_mode_synthetic_session
//
// A scenario builder is a **pure function** that, given a fresh session
// id, the operating host's user id, and an id factory, returns a fully-
// built `Event[]` log. The generator route appends each event through
// the production write path (`validateEvent` + `appendSessionEvent`) so
// a generated session is a real persisted session — flowing through the
// same `GET /api/sessions/:id/events` read path as a live one (Decision
// §2).
//
// **Purity / determinism (Acceptance §2).** Builders carry no clock and
// no randomness of their own: every timestamp is a fixed narrative ISO
// string (mirroring the on-disk fixtures), and every fresh id comes from
// the injected `idFactory`. So a builder invoked twice with the same
// `(sessionId, hostUserId, idFactory)` returns a deep-equal log, and two
// invocations with distinct fresh ids produce disjoint session / entity
// ids — the non-destructive re-runnability Constraint §2 requires.
//
// **Sequence allocation (Constraint §3).** Builders stamp contiguous
// ascending `sequence` values starting at `1`. The route appends in
// array order; the `(session_id, sequence)` UNIQUE constraint (ADR 0020)
// is satisfied because the session is brand-new.
//
// **Synthetic actors (Decision §3).** The two synthetic debaters are
// stable, clearly-marked users (`oauth_subject` prefixed `synthetic:`)
// the route upserts `ON CONFLICT DO NOTHING` under fixed ids before
// appending — so `session_events.actor`'s FK into `users(id)` resolves.
// The host (operator) is the moderator. Only the host + these two
// synthetic users ever appear as actors, so the route only has to ensure
// these two exist.

import type { Event } from '@a-conversa/shared-types';
import type { SyntheticScenarioDescriptor } from '@a-conversa/shared-types';

/**
 * A stable, clearly-marked synthetic debater user. Inserted by the
 * generator route `ON CONFLICT (oauth_subject) DO NOTHING` under the
 * fixed `id` below — this generator is the only writer of the
 * `synthetic:` oauth-subject namespace, so the id is stable across
 * generations and the events' `actor` references always resolve.
 */
export interface SyntheticUser {
  readonly id: string;
  readonly oauthSubject: string;
  readonly screenName: string;
}

export const SYNTHETIC_DEBATER_A: SyntheticUser = {
  id: '5a5a5a5a-0000-4000-8000-00000000000a',
  oauthSubject: 'synthetic:debater-a',
  screenName: 'Synthetic Debater A',
};

export const SYNTHETIC_DEBATER_B: SyntheticUser = {
  id: '5b5b5b5b-0000-4000-8000-00000000000b',
  oauthSubject: 'synthetic:debater-b',
  screenName: 'Synthetic Debater B',
};

/**
 * Every synthetic user the route must ensure exists before appending a
 * scenario log. Both bundled scenarios reference both debaters, so the
 * route upserts the whole set unconditionally.
 */
export const SYNTHETIC_USERS: readonly SyntheticUser[] = [SYNTHETIC_DEBATER_A, SYNTHETIC_DEBATER_B];

/**
 * Mints fresh ids (event ids, entity ids). The route passes
 * `randomUUID`; tests pass a deterministic sequence for the determinism
 * assertion.
 */
export type IdFactory = () => string;

/** A scenario builder — pure `(sessionId, hostUserId, idFactory) -> Event[]`. */
export type ScenarioBuilder = (
  sessionId: string,
  hostUserId: string,
  idFactory: IdFactory,
) => Event[];

// Fixed narrative timestamps — keep builders deterministic (no clock).
// `appendSessionEvent` does NOT persist the envelope `createdAt` (the DB
// default `NOW()` fills `session_events.created_at`); these strings only
// have to satisfy `validateEvent`'s ISO-8601 shape check and give human
// readers a plausible ordering.
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';
const T4 = '2026-01-01T00:00:04.000Z';
const T5 = '2026-01-01T00:00:05.000Z';
const T6 = '2026-01-01T00:00:06.000Z';
const T7 = '2026-01-01T00:00:07.000Z';
const T8 = '2026-01-01T00:00:08.000Z';
const T9 = '2026-01-01T00:00:09.000Z';

/** The topic stamped on a synthetic session's `session-created` event. */
const SYNTHETIC_TOPIC = 'Synthetic session (test mode)';

/**
 * Shared bootstrap: the `session-created` + three `participant-joined`
 * events every scenario opens with (moderator host + the two synthetic
 * debaters). Returns the events at sequences 1..4 so a scenario can
 * append its own structured events from sequence 5 onward.
 */
function bootstrapEvents(sessionId: string, hostUserId: string, idFactory: IdFactory): Event[] {
  return [
    {
      id: idFactory(),
      sessionId,
      sequence: 1,
      kind: 'session-created',
      actor: hostUserId,
      payload: {
        host_user_id: hostUserId,
        privacy: 'public',
        topic: SYNTHETIC_TOPIC,
        created_at: T0,
      },
      createdAt: T0,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 2,
      kind: 'participant-joined',
      actor: hostUserId,
      payload: {
        user_id: hostUserId,
        role: 'moderator',
        screen_name: 'Operator',
        joined_at: T0,
      },
      createdAt: T0,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 3,
      kind: 'participant-joined',
      actor: SYNTHETIC_DEBATER_A.id,
      payload: {
        user_id: SYNTHETIC_DEBATER_A.id,
        role: 'debater-A',
        screen_name: SYNTHETIC_DEBATER_A.screenName,
        joined_at: T1,
      },
      createdAt: T1,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 4,
      kind: 'participant-joined',
      actor: SYNTHETIC_DEBATER_B.id,
      payload: {
        user_id: SYNTHETIC_DEBATER_B.id,
        role: 'debater-B',
        screen_name: SYNTHETIC_DEBATER_B.screenName,
        joined_at: T2,
      },
      createdAt: T2,
    },
  ];
}

/**
 * `empty` — the minimal shape: `session-created` + three
 * `participant-joined` (moderator + two debaters), mirroring the `empty`
 * test fixture. No structure to scrub; the smallest persisted log a
 * downstream leaf can load.
 */
const buildEmptyScenario: ScenarioBuilder = (sessionId, hostUserId, idFactory) =>
  bootstrapEvents(sessionId, hostUserId, idFactory);

/**
 * `structured` — a small but varied log so the scrubber and inspectors
 * have something to exercise: the bootstrap, then a node captured by
 * debater-A and included into the session, a `classify-node` proposal
 * naming its classification facet, both debaters voting `agree` on that
 * facet, and the moderator committing it.
 *
 * Every reference resolves within the builder's own emitted ids: the
 * proposal, votes, and commit all key off `nodeId` (the node minted at
 * sequence 5), so there is no dangling reference (Acceptance §2).
 */
const buildStructuredScenario: ScenarioBuilder = (sessionId, hostUserId, idFactory) => {
  const events = bootstrapEvents(sessionId, hostUserId, idFactory);
  const nodeId = idFactory();

  events.push(
    {
      id: idFactory(),
      sessionId,
      sequence: 5,
      kind: 'node-created',
      actor: SYNTHETIC_DEBATER_A.id,
      payload: {
        node_id: nodeId,
        wording: 'Zoos should not exist.',
        created_by: SYNTHETIC_DEBATER_A.id,
        created_at: T3,
      },
      createdAt: T3,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 6,
      kind: 'entity-included',
      actor: hostUserId,
      payload: {
        entity_kind: 'node',
        entity_id: nodeId,
        included_by: hostUserId,
        included_at: T4,
      },
      createdAt: T4,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 7,
      kind: 'proposal',
      actor: SYNTHETIC_DEBATER_A.id,
      payload: {
        proposal: {
          kind: 'classify-node',
          node_id: nodeId,
          classification: 'value',
        },
      },
      createdAt: T5,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 8,
      kind: 'vote',
      actor: SYNTHETIC_DEBATER_A.id,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: nodeId,
        facet: 'classification',
        participant: SYNTHETIC_DEBATER_A.id,
        choice: 'agree',
        voted_at: T6,
      },
      createdAt: T6,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 9,
      kind: 'vote',
      actor: SYNTHETIC_DEBATER_B.id,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: nodeId,
        facet: 'classification',
        participant: SYNTHETIC_DEBATER_B.id,
        choice: 'agree',
        voted_at: T7,
      },
      createdAt: T7,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 10,
      kind: 'vote',
      actor: hostUserId,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: nodeId,
        facet: 'classification',
        participant: hostUserId,
        choice: 'agree',
        voted_at: T8,
      },
      createdAt: T8,
    },
    {
      id: idFactory(),
      sessionId,
      sequence: 11,
      kind: 'commit',
      actor: hostUserId,
      payload: {
        target: 'facet',
        entity_kind: 'node',
        entity_id: nodeId,
        facet: 'classification',
        committed_by: hostUserId,
        committed_at: T9,
      },
      createdAt: T9,
    },
  );

  return events;
};

/**
 * One registry entry per scenario — the builder plus the descriptor the
 * read endpoint advertises. Keeping the descriptor next to the builder
 * means a scenario the server cannot build can never be advertised
 * (Decision §1 / ADR 0041 point 4).
 */
interface ScenarioEntry {
  readonly descriptor: SyntheticScenarioDescriptor;
  readonly build: ScenarioBuilder;
}

const SCENARIO_ENTRIES: readonly ScenarioEntry[] = [
  {
    descriptor: {
      key: 'empty',
      title: 'Empty session',
      description:
        'A bare session: created, with the moderator and two debaters joined. No structure.',
    },
    build: buildEmptyScenario,
  },
  {
    descriptor: {
      key: 'structured',
      title: 'Structured session',
      description:
        'A small worked log: a captured statement, a classification proposal, agreeing votes, and a commit.',
    },
    build: buildStructuredScenario,
  },
];

/** The scenario keys, in advertised order. */
export const SYNTHETIC_SCENARIO_KEYS: readonly string[] = SCENARIO_ENTRIES.map(
  (entry) => entry.descriptor.key,
);

/** The descriptors the read endpoint returns, in advertised order. */
export const SYNTHETIC_SCENARIO_DESCRIPTORS: readonly SyntheticScenarioDescriptor[] =
  SCENARIO_ENTRIES.map((entry) => entry.descriptor);

/**
 * Look up a scenario builder by key. Returns `undefined` for an unknown
 * key so the route can map it to a `400`.
 */
export function getScenarioBuilder(key: string): ScenarioBuilder | undefined {
  return SCENARIO_ENTRIES.find((entry) => entry.descriptor.key === key)?.build;
}
