// Fixture loader — truncate-then-validate-then-append.
//
// `loadFixture(name, client, options)` is idempotent: it truncates the
// tables the fixtures touch (in dependency order, via a single
// `TRUNCATE ... CASCADE` statement) and then INSERTs the named
// fixture's users, session, and participants rows, and replays the
// event log through the caller-injected `appendEvent` helper. Safe to
// call repeatedly.
//
// **Validate-then-append is the only mode for the event-log step.**
// The users / session / participants steps are always raw INSERTs
// (those rows have no per-row schema-on-write gate to share with
// production). For each fixture event the loader normalizes the
// snake-case on-disk record to a camelCase `Event` envelope, runs
// `validateEvent` (rejecting with `EventValidationError` from
// `@a-conversa/shared-types` on failure), then invokes the caller-
// supplied `appendEvent(client, validatedEvent)`. The callback is the
// injection seam — production callers wire it to `appendSessionEvent`
// from `apps/server/src/events/append.ts`, so every fixture replays
// through the same SQL the production write path runs. `created_at`
// is NOT passed to the append helper — it falls back to the DB default
// (`NOW()`), matching production. The fixture's encoded narrative
// timestamps remain on disk for human readers; they do not reach the
// DB on this path.
//
// **Why callback injection rather than importing `appendSessionEvent`
// directly.** `@a-conversa/test-fixtures` is a leaf workspace package
// whose only dep is `@a-conversa/shared-types`. Importing the helper
// directly would invert the apps → packages layering and drag the
// server's runtime transitive deps into a test-support package. The
// callback keeps the loader agnostic; callers wire the concrete
// helper (the same pattern this file already uses for the DB client).

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Event, validateEvent } from '@a-conversa/shared-types';

// We don't import the pg `Client` type directly — pulling
// `@types/pg` into the public types of this package would make every
// downstream consumer a transitive dependency on it. Instead, we declare
// the structural minimum we use and let consumers pass a `pg.Client`,
// `pg.PoolClient`, or any other shape that implements `query`.
export interface LoadFixtureClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
}

/**
 * Options bag for `loadFixture`. `appendEvent` is required: it is the
 * injection seam through which the loader replays each fixture event
 * (after `validateEvent`) through the caller's append helper —
 * production callers wire it to `appendSessionEvent` from
 * `apps/server/src/events/append.ts`.
 */
export interface LoadFixtureOptions {
  readonly appendEvent: (client: LoadFixtureClient, event: Event) => Promise<void>;
}

interface FixtureMeta {
  readonly name: string;
  readonly description: string;
}

interface FixtureUser {
  readonly id: string;
  readonly oauth_subject: string;
  readonly screen_name: string;
  readonly created_at: string;
}

interface FixtureSession {
  readonly id: string;
  readonly host_user_id: string;
  readonly privacy: 'public' | 'private';
  readonly topic: string;
  readonly created_at: string;
}

interface FixtureParticipant {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly role: 'moderator' | 'debater-A' | 'debater-B';
  readonly joined_at: string;
}

interface FixtureEvent {
  readonly id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// Tables `loadFixture` resets. `TRUNCATE ... CASCADE` lets Postgres
// figure out the FK ordering, but listing them explicitly here makes the
// surface area visible and matches what the README documents.
const TABLES_TO_TRUNCATE: readonly string[] = [
  'session_events',
  'session_annotations',
  'session_edges',
  'session_nodes',
  'session_participants',
  'sessions',
  'annotations',
  'edges',
  'nodes',
  'users',
];

export async function listFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function loadFixture(
  name: string,
  client: LoadFixtureClient,
  options: LoadFixtureOptions,
): Promise<void> {
  const known = await listFixtures();
  if (!known.includes(name)) {
    throw new Error(`Unknown fixture: ${name}. Known fixtures: ${known.join(', ') || '(none)'}`);
  }
  const fixtureDir = join(FIXTURES_DIR, name);

  const meta = await readJson<FixtureMeta>(join(fixtureDir, 'meta.json'));
  const users = await readJson<readonly FixtureUser[]>(join(fixtureDir, 'users.json'));
  const session = await readJson<FixtureSession>(join(fixtureDir, 'session.json'));
  const participants = await readJson<readonly FixtureParticipant[]>(
    join(fixtureDir, 'participants.json'),
  );
  const events = await readJson<readonly FixtureEvent[]>(join(fixtureDir, 'events.json'));

  // Sanity check the meta name matches the directory — catches a
  // copy-paste bug in fixture authoring.
  if (meta.name !== name) {
    throw new Error(`Fixture meta.name (${meta.name}) does not match directory name (${name})`);
  }

  await truncateAll(client);
  await insertUsers(client, users);
  await insertSession(client, session);
  await insertParticipants(client, participants);
  await insertEvents(client, events, options);
}

async function truncateAll(client: LoadFixtureClient): Promise<void> {
  // Single statement so Postgres handles ordering. RESTART IDENTITY is a
  // no-op for our UUID PKs but harmless and future-proof if a sequence
  // is ever added. CASCADE is belt-and-braces — TABLES_TO_TRUNCATE is
  // already complete, but CASCADE ensures we don't silently leave
  // orphaned rows in a future child table that's added without
  // updating this list.
  const list = TABLES_TO_TRUNCATE.join(', ');
  await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function insertUsers(
  client: LoadFixtureClient,
  users: readonly FixtureUser[],
): Promise<void> {
  for (const u of users) {
    await client.query(
      `INSERT INTO users (id, oauth_subject, screen_name, created_at)
       VALUES ($1, $2, $3, $4)`,
      [u.id, u.oauth_subject, u.screen_name, u.created_at],
    );
  }
}

async function insertSession(client: LoadFixtureClient, s: FixtureSession): Promise<void> {
  await client.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [s.id, s.host_user_id, s.privacy, s.topic, s.created_at],
  );
}

async function insertParticipants(
  client: LoadFixtureClient,
  participants: readonly FixtureParticipant[],
): Promise<void> {
  for (const p of participants) {
    await client.query(
      `INSERT INTO session_participants (id, session_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [p.id, p.session_id, p.user_id, p.role, p.joined_at],
    );
  }
}

// Snake-case on-disk record → camelCase `Event` envelope. Mirrors
// `rowToEnvelopeShape` in `tests/behavior/steps/projection-from-log
// .steps.ts` L130-146; duplicated here because this package is a leaf
// workspace dep and cannot reach into `tests/behavior/`. The transform
// is six lines and both copies validate the same envelope shape, so a
// drift in the envelope type would surface as a compile-time error
// in both places.
function fixtureEventToEnvelope(e: FixtureEvent): unknown {
  return {
    id: e.id,
    sessionId: e.session_id,
    sequence: e.sequence,
    kind: e.kind,
    actor: e.actor,
    payload: e.payload,
    createdAt: e.created_at,
  };
}

async function insertEvents(
  client: LoadFixtureClient,
  events: readonly FixtureEvent[],
  options: LoadFixtureOptions,
): Promise<void> {
  // Validate-then-append. Each event runs `validateEvent` (throws
  // `EventValidationError` from `@a-conversa/shared-types` on
  // failure, surfacing fixture-author slips at load time rather
  // than silently bypassing the schema gate) and then routes
  // through the caller-injected helper — which production wires
  // to `appendSessionEvent`, so the fixture and the production
  // write path share one SQL surface.
  const append = options.appendEvent;
  for (const e of events) {
    const validated = validateEvent(fixtureEventToEnvelope(e));
    await append(client, validated);
  }
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as T;
}
