// Shared step-level helpers — small, intentional surface.
//
// `expectQuery` runs a query and captures any thrown error onto the
// World's scratch under `lastError`, returning the result on success
// or `undefined` on failure. Step defs use this to write
// "When I insert a row that violates X" scenarios without each one
// reimplementing try/catch boilerplate.

import type { AConversaWorld } from './world.js';

export async function expectQuery(
  world: AConversaWorld,
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<unknown> {
  world.scratch['lastError'] = undefined;
  try {
    const res = await world.db.query(text, params as unknown[] | undefined);
    return res;
  } catch (err) {
    world.scratch['lastError'] = err;
    return undefined;
  }
}

export function lastError(world: AConversaWorld): Error | undefined {
  const e = world.scratch['lastError'];
  return e instanceof Error ? e : undefined;
}

// Stable test UUIDs so step definitions don't have to invent them.
// The `4` in position 13 and `8` in position 17 keep them v4-shaped
// so any UUID-validating CHECK or app-side parser is happy.
export const TEST_UUIDS = {
  alice: '11111111-1111-4111-8111-111111111111',
  ben: '22222222-2222-4222-8222-222222222222',
  maria: '33333333-3333-4333-8333-333333333333',
  session: '55555555-5555-4555-8555-555555555555',
  nodeA: '66666666-6666-4666-8666-666666666661',
  nodeB: '66666666-6666-4666-8666-666666666662',
  nodeC: '66666666-6666-4666-8666-666666666663',
  edgeA: '77777777-7777-4777-8777-777777777771',
  annA: '88888888-8888-4888-8888-888888888881',
} as const;

// Insert a baseline user row so other steps can FK to it without
// duplicating boilerplate. Returns the user's id.
export async function insertUser(
  world: AConversaWorld,
  id: string,
  oauthSubject: string,
  screenName = 'tester',
): Promise<string> {
  await world.db.query(`INSERT INTO users (id, oauth_subject, screen_name) VALUES ($1, $2, $3)`, [
    id,
    oauthSubject,
    screenName,
  ]);
  return id;
}

// Insert a session row owned by the given host user. Returns the
// session id.
export async function insertSession(
  world: AConversaWorld,
  id: string,
  hostUserId: string,
  privacy: 'public' | 'private' = 'public',
  topic = 'Test session',
): Promise<string> {
  await world.db.query(
    `INSERT INTO sessions (id, host_user_id, privacy, topic) VALUES ($1, $2, $3, $4)`,
    [id, hostUserId, privacy, topic],
  );
  return id;
}

// Insert a node row authored by the given user.
export async function insertNode(
  world: AConversaWorld,
  id: string,
  createdBy: string,
  wording = 'A node',
): Promise<string> {
  await world.db.query(`INSERT INTO nodes (id, wording, created_by) VALUES ($1, $2, $3)`, [
    id,
    wording,
    createdBy,
  ]);
  return id;
}
