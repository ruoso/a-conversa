// Fixture loader — truncate-then-insert implementation.
//
// `loadFixture(name, client)` is idempotent: it truncates the tables
// the fixtures touch (in dependency order, via a single `TRUNCATE ...
// CASCADE` statement) and then INSERTs the named fixture's users,
// session, participants, and event-log rows. Safe to call repeatedly.
//
// **Deferred R23 — replay through the application's event-append code.**
// The settled refinement decision (R23 in
// tasks/refinements/data-and-methodology/seed_data_for_tests.md) is
// that fixtures should be loaded by *replaying* their events through
// the same append API that production writes use, so per-kind payload
// validation runs against fixtures too. That API does not exist yet —
// it lives in `data_and_methodology.event_types.event_validation` and
// `backend.api_skeleton`. Today this loader uses raw INSERTs against
// `session_events`, which means a malformed payload in a fixture will
// not be caught at load time. See the TODO comment on
// `insertEvents` below; that is the call site that gets rewritten when
// the prerequisites land.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// We don't import the pg `Client` type directly — pulling
// `@types/pg` into the public types of this package would make every
// downstream consumer a transitive dependency on it. Instead, we declare
// the structural minimum we use and let consumers pass a `pg.Client`,
// `pg.PoolClient`, or any other shape that implements `query`.
export interface LoadFixtureClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
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

export async function loadFixture(name: string, client: LoadFixtureClient): Promise<void> {
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
  await insertEvents(client, events);
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

async function insertEvents(
  client: LoadFixtureClient,
  events: readonly FixtureEvent[],
): Promise<void> {
  // TODO(R23): replay through event-append code once it exists.
  // Today this is a raw INSERT, bypassing per-kind payload validation
  // (`data_and_methodology.event_types.event_validation`). When that
  // task and `backend.api_skeleton` land, rewrite this function to
  // drive the application's append API instead, so fixtures and
  // production share a single validation path.
  for (const e of events) {
    await client.query(
      `INSERT INTO session_events
         (id, session_id, sequence, kind, actor, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [e.id, e.session_id, e.sequence, e.kind, e.actor, JSON.stringify(e.payload), e.created_at],
    );
  }
}

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as T;
}
