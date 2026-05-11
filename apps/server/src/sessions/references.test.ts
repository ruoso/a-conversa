// Vitest unit tests for `apps/server/src/sessions/references.ts` — the
// canonical "can this caller reference this entity into ANY session?"
// rule, per entity kind (node / edge / annotation).
//
// Refinement: tasks/refinements/backend/reference_permission_check.md
// ADRs:        docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.cross_session_permissions.reference_permission_check
//
// **What this layer covers** (pure, in-memory executor; the integration
// layer's Cucumber+pglite scenarios exercise the same predicates against
// the real migrated schema):
//
//   1. Node from a public origin → true for any user (host, participant,
//      stranger all pass).
//   2. Node from a private origin → true for host, true for current
//      participant, false for stranger.
//   3. Node in TWO origins (one private+invisible, one public) → true
//      for a stranger (the any-visible-origin rule).
//   4. Unknown node id → false.
//   5. Each predicate issues exactly one parameterized SELECT with
//      `[entityId, userId]` as params, against a `SELECT 1 ... LIMIT 1`
//      shape that joins the appropriate `session_<kind>s` table to
//      `sessions` AND-composed with the visibility fragment.
//   6. Edge variants — public-origin true, private-origin stranger
//      false, private-origin host true (parallel to node cases).
//   7. Annotation variants — public-origin true, private-origin stranger
//      false, private-origin host true (parallel to node cases).
//
// **Why a memory executor.** The functions under test are thin SQL
// builders + a `SELECT 1` predicate. The semantic claim is "the
// predicate's TRUE-set matches the architecture's any-visible-origin
// rule." A memory-backed executor that mirrors the SQL the functions
// emit is the cheapest possible regression-net at the unit layer; the
// pglite-backed Cucumber scenarios in `tests/behavior/backend/
// reference-permission.feature` exercise the same predicates against
// the real Postgres dialect.

import { describe, expect, it } from 'vitest';

import { canReferenceAnnotation, canReferenceEdge, canReferenceNode } from './references.js';
import type { VisibilityExecutor } from './visibility.js';

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: 'public' | 'private';
}

interface ParticipantRow {
  session_id: string;
  user_id: string;
  left_at: string | null;
}

interface JoinRow {
  session_id: string;
  entity_id: string;
}

interface MemoryDb {
  sessions: SessionRow[];
  participants: ParticipantRow[];
  sessionNodes: JoinRow[];
  sessionEdges: JoinRow[];
  sessionAnnotations: JoinRow[];
}

/**
 * In-memory executor that mirrors the SELECT each `canReference<Kind>`
 * helper issues. Recognises the exact SQL shape the helpers emit
 * (`SELECT 1 AS reachable FROM session_<kind>s sj JOIN sessions ON ...
 * WHERE sj.<entity>_id = $1 AND <visibility fragment with $2> LIMIT 1`);
 * rejects anything else so a refactor that changes the SQL surface
 * surfaces here as a clear error rather than silent mismatch.
 *
 * The recogniser keys off which join-table textually appears in the
 * SQL, then walks the in-memory join rows for that kind, joining
 * against `sessions` and applying the visibility OR-expression
 * (public OR host OR participant).
 */
function makeMemoryExecutor(db: MemoryDb): VisibilityExecutor {
  return {
    query: <TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> => {
      // Pin the canonical shape — every refactor that preserves
      // semantics keeps these substrings; any rewrite that drops one is
      // a flag.
      if (
        !text.includes('SELECT 1') ||
        !text.includes('JOIN sessions ON sj.session_id = sessions.id') ||
        !text.includes('LIMIT 1') ||
        !text.includes("privacy = 'public'") ||
        !text.includes('host_user_id = $2') ||
        !text.includes('sp.session_id = sessions.id') ||
        !text.includes('sp.user_id = $2')
      ) {
        return Promise.reject(new Error(`unexpected SQL in references memory executor: ${text}`));
      }
      const p = (params ?? []) as unknown[];
      const entityId = p[0] as string;
      const userId = p[1] as string;

      let joinRows: JoinRow[];
      if (text.includes('FROM session_nodes sj') && text.includes('sj.node_id = $1')) {
        joinRows = db.sessionNodes.filter((r) => r.entity_id === entityId);
      } else if (text.includes('FROM session_edges sj') && text.includes('sj.edge_id = $1')) {
        joinRows = db.sessionEdges.filter((r) => r.entity_id === entityId);
      } else if (
        text.includes('FROM session_annotations sj') &&
        text.includes('sj.annotation_id = $1')
      ) {
        joinRows = db.sessionAnnotations.filter((r) => r.entity_id === entityId);
      } else {
        return Promise.reject(
          new Error(`could not identify entity kind in references SQL: ${text}`),
        );
      }
      // Walk every origin session this entity is in; the first one
      // visible to the caller wins (the LIMIT-1 semantics — Postgres
      // would short-circuit; here we early-return at the first hit).
      for (const jr of joinRows) {
        const session = db.sessions.find((s) => s.id === jr.session_id);
        if (session === undefined) continue;
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        const isParticipant = db.participants.some(
          (sp) => sp.session_id === session.id && sp.user_id === userId,
        );
        if (isPublic || isHost || isParticipant) {
          return Promise.resolve({ rows: [{ reachable: 1 }] as unknown as TRow[] });
        }
      }
      return Promise.resolve({ rows: [] as TRow[] });
    },
  };
}

// Stable UUID-shaped ids for deterministic assertions. The predicates
// don't parse these; they're opaque strings throughout.
const ALICE = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CARL = '33333333-3333-4333-8333-333333333333';
const PUBLIC_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIVATE_SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PUBLIC_SESSION_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NODE_A = '66666666-6666-4666-8666-666666666661';
const NODE_UNKNOWN = '66666666-6666-4666-8666-666666666669';
const EDGE_A = '77777777-7777-4777-8777-777777777771';
const EDGE_UNKNOWN = '77777777-7777-4777-8777-777777777779';
const ANN_A = '88888888-8888-4888-8888-888888888881';
const ANN_UNKNOWN = '88888888-8888-4888-8888-888888888889';

function emptyDb(): MemoryDb {
  return {
    sessions: [],
    participants: [],
    sessionNodes: [],
    sessionEdges: [],
    sessionAnnotations: [],
  };
}

describe('canReferenceNode', () => {
  it('returns true when the node is in a public origin session, regardless of caller', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionNodes.push({ session_id: PUBLIC_SESSION, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    // Stranger (BEN), host (ALICE), and a third party (CARL) all see it.
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(true);
    expect(await canReferenceNode(executor, NODE_A, ALICE)).toBe(true);
    expect(await canReferenceNode(executor, NODE_A, CARL)).toBe(true);
  });

  it('returns true when the node is in a private origin and the caller is the host', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionNodes.push({ session_id: PRIVATE_SESSION, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, ALICE)).toBe(true);
  });

  it('returns true when the node is in a private origin and the caller is a current participant', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionNodes.push({ session_id: PRIVATE_SESSION, entity_id: NODE_A });
    db.participants.push({ session_id: PRIVATE_SESSION, user_id: BEN, left_at: null });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(true);
  });

  it('returns false when the node is in a private origin and the caller is a stranger', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionNodes.push({ session_id: PRIVATE_SESSION, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(false);
  });

  it('returns true for a multi-origin node when ANY origin is visible to the caller', async () => {
    // The any-visible-origin rule — N is in a private session BEN cannot see,
    // AND in a public session BEN trivially can see. BEN's reference is
    // allowed because the public origin alone is enough.
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessions.push({ id: PUBLIC_SESSION_2, host_user_id: CARL, privacy: 'public' });
    db.sessionNodes.push({ session_id: PRIVATE_SESSION, entity_id: NODE_A });
    db.sessionNodes.push({ session_id: PUBLIC_SESSION_2, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(true);
  });

  it('returns false for a node that exists only in sessions invisible to the caller', async () => {
    // Negative-control for the multi-origin rule — every origin is
    // private and BEN is in none of them.
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionNodes.push({ session_id: PRIVATE_SESSION, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(false);
  });

  it('returns false for an unknown node id', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionNodes.push({ session_id: PUBLIC_SESSION, entity_id: NODE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_UNKNOWN, BEN)).toBe(false);
  });

  it('returns false for a node with NO origin sessions at all (no join rows)', async () => {
    // Edge case: an entity row that exists in `nodes` but has no row in
    // `session_nodes` is unreachable. Production shouldn't produce this
    // shape (entities are inserted into the join during the creation
    // event), but the predicate handles it correctly via the join.
    const db = emptyDb();
    // No join rows for NODE_A at all.
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceNode(executor, NODE_A, BEN)).toBe(false);
  });

  it('issues exactly one parameterized SELECT against the executor', async () => {
    const calls: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
    const tracingExecutor: VisibilityExecutor = {
      query: <TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> => {
        calls.push({ text, ...(params !== undefined ? { params } : {}) });
        return Promise.resolve({ rows: [{ reachable: 1 }] as unknown as TRow[] });
      },
    };
    await canReferenceNode(tracingExecutor, NODE_A, BEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([NODE_A, BEN]);
    expect(calls[0]?.text).toContain('SELECT 1');
    expect(calls[0]?.text).toContain('FROM session_nodes sj');
    expect(calls[0]?.text).toContain('JOIN sessions ON sj.session_id = sessions.id');
    expect(calls[0]?.text).toContain('sj.node_id = $1');
    expect(calls[0]?.text).toContain('LIMIT 1');
    // Visibility fragment substrings — verify we reuse the shared
    // fragment rather than inlining a divergent OR-expression.
    expect(calls[0]?.text).toContain("privacy = 'public'");
    expect(calls[0]?.text).toContain('host_user_id = $2');
    expect(calls[0]?.text).toContain('session_participants');
  });
});

describe('canReferenceEdge', () => {
  it('returns true when the edge is in a public origin session, regardless of caller', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionEdges.push({ session_id: PUBLIC_SESSION, entity_id: EDGE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceEdge(executor, EDGE_A, BEN)).toBe(true);
  });

  it('returns false when the edge is in a private origin and the caller is a stranger', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionEdges.push({ session_id: PRIVATE_SESSION, entity_id: EDGE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceEdge(executor, EDGE_A, BEN)).toBe(false);
  });

  it('returns true when the edge is in a private origin and the caller is the host', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionEdges.push({ session_id: PRIVATE_SESSION, entity_id: EDGE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceEdge(executor, EDGE_A, ALICE)).toBe(true);
  });

  it('returns true for a multi-origin edge via the public origin', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessions.push({ id: PUBLIC_SESSION_2, host_user_id: CARL, privacy: 'public' });
    db.sessionEdges.push({ session_id: PRIVATE_SESSION, entity_id: EDGE_A });
    db.sessionEdges.push({ session_id: PUBLIC_SESSION_2, entity_id: EDGE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceEdge(executor, EDGE_A, BEN)).toBe(true);
  });

  it('returns false for an unknown edge id', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionEdges.push({ session_id: PUBLIC_SESSION, entity_id: EDGE_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceEdge(executor, EDGE_UNKNOWN, BEN)).toBe(false);
  });

  it('targets the session_edges join table with the edge_id column', async () => {
    const calls: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
    const tracingExecutor: VisibilityExecutor = {
      query: <TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> => {
        calls.push({ text, ...(params !== undefined ? { params } : {}) });
        return Promise.resolve({ rows: [] as TRow[] });
      },
    };
    await canReferenceEdge(tracingExecutor, EDGE_A, BEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM session_edges sj');
    expect(calls[0]?.text).toContain('sj.edge_id = $1');
    expect(calls[0]?.params).toEqual([EDGE_A, BEN]);
  });
});

describe('canReferenceAnnotation', () => {
  it('returns true when the annotation is in a public origin session, regardless of caller', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionAnnotations.push({ session_id: PUBLIC_SESSION, entity_id: ANN_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceAnnotation(executor, ANN_A, BEN)).toBe(true);
  });

  it('returns false when the annotation is in a private origin and the caller is a stranger', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionAnnotations.push({ session_id: PRIVATE_SESSION, entity_id: ANN_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceAnnotation(executor, ANN_A, BEN)).toBe(false);
  });

  it('returns true when the annotation is in a private origin and the caller is the host', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessionAnnotations.push({ session_id: PRIVATE_SESSION, entity_id: ANN_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceAnnotation(executor, ANN_A, ALICE)).toBe(true);
  });

  it('returns true for a multi-origin annotation via the public origin', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PRIVATE_SESSION, host_user_id: ALICE, privacy: 'private' });
    db.sessions.push({ id: PUBLIC_SESSION_2, host_user_id: CARL, privacy: 'public' });
    db.sessionAnnotations.push({ session_id: PRIVATE_SESSION, entity_id: ANN_A });
    db.sessionAnnotations.push({ session_id: PUBLIC_SESSION_2, entity_id: ANN_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceAnnotation(executor, ANN_A, BEN)).toBe(true);
  });

  it('returns false for an unknown annotation id', async () => {
    const db = emptyDb();
    db.sessions.push({ id: PUBLIC_SESSION, host_user_id: ALICE, privacy: 'public' });
    db.sessionAnnotations.push({ session_id: PUBLIC_SESSION, entity_id: ANN_A });
    const executor = makeMemoryExecutor(db);
    expect(await canReferenceAnnotation(executor, ANN_UNKNOWN, BEN)).toBe(false);
  });

  it('targets the session_annotations join table with the annotation_id column', async () => {
    const calls: Array<{ text: string; params?: ReadonlyArray<unknown> }> = [];
    const tracingExecutor: VisibilityExecutor = {
      query: <TRow extends Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<{ rows: TRow[] }> => {
        calls.push({ text, ...(params !== undefined ? { params } : {}) });
        return Promise.resolve({ rows: [] as TRow[] });
      },
    };
    await canReferenceAnnotation(tracingExecutor, ANN_A, BEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('FROM session_annotations sj');
    expect(calls[0]?.text).toContain('sj.annotation_id = $1');
    expect(calls[0]?.params).toEqual([ANN_A, BEN]);
  });
});
