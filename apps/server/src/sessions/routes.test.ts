// Vitest unit tests for `POST /sessions` and `GET /sessions`
// (apps/server/src/sessions/routes.ts).
//
// Refinements: tasks/refinements/backend/create_session_endpoint.md,
//              tasks/refinements/backend/list_sessions_endpoint.md
// ADRs:        docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0023-web-framework-fastify.md
// TaskJuggler: backend.session_management.create_session_endpoint,
//              backend.session_management.list_sessions_endpoint
//
// **Coverage for `POST /sessions`** (per the create-endpoint refinement):
//
//   1. Valid body + authenticated user → 201 + camelCase response
//      shape; the memory-backed DB shim records BOTH the sessions row
//      AND the session_events row (sequence=1, kind='session-created',
//      payload mirrors the row), so the atomic write contract is
//      verified.
//   2. No auth cookie → 401 + `auth-required` envelope (verifies the
//      middleware wiring is intact).
//   3. Body missing `topic` → 400 + `validation-failed` envelope.
//   4. Body `topic` too long (≥257 chars) → 400.
//   5. Body `privacy` outside the enum → 400.
//
// **Coverage for `GET /sessions`** (per the list-endpoint refinement):
//
//   1. Authenticated → 200 + ordered list (created_at DESC).
//   2. No auth cookie → 401.
//   3. Public-only visibility for a user with no participation history.
//   4. Public + private-where-participant visible to a participant.
//   5. Private-where-not-a-participant is hidden.
//   6. `?status=active` filters out ended sessions.
//   7. `?status=ended` returns only ended sessions.
//
// **Coverage for `GET /sessions/:id`** (per the get-endpoint refinement):
//
//   1. Authenticated + visible → 200 + SessionResponse shape.
//   2. No auth cookie → 401.
//   3. Unknown id → 404 not-found.
//   4. Private session not visible to caller → 404 (NOT 403; the
//      existence-leak rule).
//   5. Private session visible to host → 200.
//   6. Private session visible to participant → 200.
//   7. Bad UUID path param → 400 validation-failed.
//
// **Coverage for `POST /sessions/:id/end`** (per the end-endpoint refinement):
//
//   1. Host ends an active session → 200 + endedAt populated; BOTH the
//      UPDATE and the session-ended event INSERT recorded via the
//      memory shim; transaction trace is BEGIN…COMMIT (no ROLLBACK).
//   2. Non-host (visible but not host) → 403 `not-a-moderator`; no
//      writes; trace ends with ROLLBACK.
//   3. Non-participant on a private session → 404 `not-found` (the
//      existence-non-leak rule fires BEFORE the authority check).
//   4. Already-ended session (host re-attempts) → 409
//      `session-already-ended`; no new writes; trace ends with ROLLBACK.
//   5. Unknown id → 404 `not-found`.
//   6. Bad UUID path param → 400 `validation-failed`.
//   7. No auth cookie → 401 `auth-required`.
//
// **Coverage for `PATCH /sessions/:id/privacy`** (per the privacy-toggle refinement):
//
//   1. Host toggles public → private → 200 + the new privacy in the
//      response; the in-memory row's privacy reflects the new value.
//   2. Non-host (visible but not host) → 403 `not-a-moderator`; the
//      row's privacy is unchanged.
//   3. Non-participant on a private session → 404 `not-found` (the
//      existence-non-leak rule fires BEFORE the authority check).
//   4. Ended session → 409 `session-already-ended`; the row's privacy
//      is unchanged.
//   5. Unknown id → 404 `not-found`.
//   6. Setting the same value the row already has → 200 (idempotent
//      no-op); the response carries the unchanged privacy.
//   7. Bad body (missing privacy / invalid enum) → 400 `validation-failed`.
//   8. No auth cookie → 401 `auth-required`.
//
// All tests use Fastify's `.inject(...)` — no port bind. The pool is a
// memory shim that mimics the production `pg.Pool` surface (BEGIN /
// COMMIT / ROLLBACK + the INSERTs) so the transactional shape is
// exercised in unit-layer isolation; the Cucumber+pglite layer covers
// the end-to-end write against the real migrated schema.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  MAX_SESSION_LIST_OFFSET,
  MAX_TOPIC_SEARCH_LENGTH,
  MIN_TOPIC_SEARCH_LENGTH,
} from '@a-conversa/shared-types';

import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/session-token.js';
import type { DbPool } from '../db.js';
import { __buildTestSessionsApp } from './routes.js';

const TEST_SECRET = 'unit-test-sessions-secret';

interface UserRow {
  id: string;
  oauth_subject: string;
  screen_name: string;
  deleted_at: string | null;
}

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: string;
  topic: string;
  created_at: Date;
  ended_at: Date | null;
  // Denormalized session-start read-model column (sd_schema), nullable
  // until the lobby -> operate transition stamps it. Optional in the
  // test interface so seeders that predate the column keep working.
  started_at?: Date | null;
}

interface SessionEventRow {
  id: string;
  session_id: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface SessionParticipantRow {
  // Per-row shape mirroring the `session_participants` table. The
  // create-session amendment (Option A — implicit moderator) writes a
  // row here; the participant-assignment endpoints both read and
  // write here. `id` / `joined_at` / `left_at` are nullable in the
  // test interface so legacy seeders (the list-endpoint suite's
  // shorthand) that only stamp `session_id` + `user_id` keep working.
  session_id: string;
  user_id: string;
  id?: string;
  role?: string;
  joined_at?: Date;
  left_at?: Date | null;
}

interface InclusionRow {
  // Shape of a row in `session_nodes` / `session_edges` /
  // `session_annotations`. The test fixture stores all three kinds in
  // separate arrays keyed by the join-table name; the entity-id field
  // is named uniformly (`entity_id`) for ergonomics — the production
  // SQL uses the per-kind column name (`node_id` / `edge_id` /
  // `annotation_id`) but the shim normalises so the test code can
  // assert against a single field name.
  session_id: string;
  entity_id: string;
  included_by: string;
  included_at: Date;
}

interface MemoryStore {
  users: Map<string, UserRow>;
  sessions: SessionRow[];
  events: SessionEventRow[];
  // Participation rows — visibility-gate join target for `GET /sessions`.
  // The list-endpoint tests seed this directly to model "user X is a
  // participant in session Y" without going through a participant-
  // assignment endpoint (which is a sibling task, not landed yet).
  participants: SessionParticipantRow[];
  // Join-table rows for the cross-session inclusion endpoint and its
  // source-side reachability predicates (`canReference<Kind>`). The
  // inclusion endpoint's tests seed source-side rows directly to model
  // "entity E lives in session A"; the endpoint's INSERT lands the
  // destination-side row here too.
  sessionNodes: InclusionRow[];
  sessionEdges: InclusionRow[];
  sessionAnnotations: InclusionRow[];
  // Transaction-control trace — the test's atomicity claim rests on
  // the handler emitting BEGIN → INSERT(sessions) → INSERT(session_events) → COMMIT
  // in order. Failure paths emit ROLLBACK instead of COMMIT. The
  // tests assert against this trace to pin the contract.
  trace: string[];
}

/**
 * In-memory `pg.Pool` shim. Implements `query(text, params)` plus an
 * optional `connect()` that returns a client with the same `query`
 * method and a `release()` no-op — this exercises the
 * `withTransaction` helper's "pool with connect()" branch (the
 * production code path).
 *
 * The shim recognises:
 *
 *   - `BEGIN` / `COMMIT` / `ROLLBACK` — recorded in `trace`.
 *   - The users SELECT the auth middleware issues (mirrors the
 *     production WHERE clause).
 *   - The sessions INSERT ... RETURNING.
 *   - The session_events INSERT.
 *
 * Anything else throws — a regression that changes the SQL surface
 * shows up here, not as a silent mismatch.
 */
function makeMemoryPool(initialUsers: UserRow[]): {
  pool: DbPool;
  store: MemoryStore;
} {
  const store: MemoryStore = {
    users: new Map(initialUsers.map((u) => [u.id, u])),
    sessions: [],
    events: [],
    participants: [],
    sessionNodes: [],
    sessionEdges: [],
    sessionAnnotations: [],
    trace: [],
  };

  let nextSessionId = 1;
  let nextParticipantId = 1;
  const synthesizeUuid = (n: number): string => {
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
  const synthesizeParticipantUuid = (n: number): string => {
    // Distinct UUID space from sessions so a stray cross-reference
    // fails loudly. Same shape (v4-like) as `synthesizeUuid`.
    const hex = n.toString(16).padStart(12, '0');
    return `00000000-0000-4000-9000-${hex}`;
  };

  function runQuery<TRow extends Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: TRow[] }> {
    const p = (params ?? []) as unknown[];
    const trimmed = text.trim();
    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      store.trace.push(trimmed);
      return Promise.resolve({ rows: [] as TRow[] });
    }
    if (text.includes('SELECT id, screen_name') && text.includes('FROM users')) {
      const id = p[0] as string;
      const row = store.users.get(id);
      if (row === undefined || row.deleted_at !== null) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.resolve({
        rows: [{ id: row.id, screen_name: row.screen_name }] as unknown as TRow[],
      });
    }
    if (text.includes('INSERT INTO sessions')) {
      const [hostUserId, privacy, topic] = p as [string, string, string];
      const row: SessionRow = {
        id: synthesizeUuid(nextSessionId++),
        host_user_id: hostUserId,
        privacy,
        topic,
        created_at: new Date('2026-05-10T12:00:00.000Z'),
        ended_at: null,
      };
      store.sessions.push(row);
      return Promise.resolve({ rows: [row] as unknown as TRow[] });
    }
    if (text.includes('INSERT INTO session_participants')) {
      // The session-participants INSERT — covers both the create-
      // session amendment (host as moderator, role literal 'moderator'
      // in the SQL) and the participant-assignment POST endpoint (role
      // supplied via $3). We disambiguate by checking the column-list
      // shape: if the SQL has three placeholders ($1,$2,$3) the third
      // is the role; otherwise the role is the literal 'moderator'.
      const id = synthesizeParticipantUuid(nextParticipantId++);
      const sessionId = p[0] as string;
      const userId = p[1] as string;
      const role = text.includes('$3') ? (p[2] as string) : 'moderator';
      const row: SessionParticipantRow = {
        id,
        session_id: sessionId,
        user_id: userId,
        role,
        joined_at: new Date('2026-05-10T12:00:00.500Z'),
        left_at: null,
      };
      store.participants.push(row);
      return Promise.resolve({ rows: [row] as unknown as TRow[] });
    }
    if (
      text.includes('FROM session_participants') &&
      text.includes('WHERE session_id = $1') &&
      text.includes('role = $2') &&
      text.includes('left_at IS NULL')
    ) {
      // The role-availability pre-check from the assign endpoint.
      const targetSessionId = p[0] as string;
      const targetRole = p[1] as string;
      const matches = store.participants.filter(
        (sp) =>
          sp.session_id === targetSessionId &&
          sp.role === targetRole &&
          (sp.left_at === null || sp.left_at === undefined),
      );
      return Promise.resolve({
        rows: matches.map((sp) => ({ id: sp.id })) as unknown as TRow[],
      });
    }
    if (
      text.includes('FROM session_participants') &&
      text.includes('WHERE session_id = $1') &&
      text.includes('user_id = $2') &&
      text.includes('left_at IS NULL')
    ) {
      // The user-availability pre-check (assign) and the
      // active-participant lookup (remove) — both share the same
      // WHERE shape. The remove-endpoint asks for the full row;
      // the assign-endpoint only checks length. Returning the full
      // row covers both since the assign-endpoint's `LIMIT 1`
      // truncates the test fixture to ≤1 row anyway.
      const targetSessionId = p[0] as string;
      const targetUserId = p[1] as string;
      const matches = store.participants.filter(
        (sp) =>
          sp.session_id === targetSessionId &&
          sp.user_id === targetUserId &&
          (sp.left_at === null || sp.left_at === undefined),
      );
      return Promise.resolve({
        rows: matches as unknown as TRow[],
      });
    }
    if (
      text.includes('FROM session_participants') &&
      text.includes('WHERE session_id = $1') &&
      text.includes('ORDER BY joined_at ASC, id ASC') &&
      !text.includes('left_at IS NULL') &&
      !text.includes('role = $2') &&
      !text.includes('user_id = $2')
    ) {
      // The `GET /sessions/:id/participants` SELECT. Returns ALL rows
      // for the session (active + historical) sorted by `joined_at ASC,
      // id ASC` — implicit-moderator row first, then debater rows in
      // join order. The shim mirrors the production WHERE: every row
      // whose `session_id` matches, no `left_at` filter.
      const targetSessionId = p[0] as string;
      const matches = store.participants
        .filter((sp) => sp.session_id === targetSessionId)
        .sort((a, b) => {
          const aJ = (a.joined_at ?? new Date(0)).getTime();
          const bJ = (b.joined_at ?? new Date(0)).getTime();
          if (aJ !== bJ) return aJ - bJ;
          return (a.id ?? '').localeCompare(b.id ?? '');
        });
      return Promise.resolve({ rows: matches as unknown as TRow[] });
    }
    if (text.includes('UPDATE session_participants') && text.includes('SET left_at = NOW()')) {
      // The participant-DELETE UPDATE. Flip `left_at` on the
      // matching row to a deterministic timestamp; RETURNING
      // surfaces the post-update row.
      const targetParticipantId = p[0] as string;
      const idx = store.participants.findIndex((sp) => sp.id === targetParticipantId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const original = store.participants[idx] as SessionParticipantRow;
      const updated: SessionParticipantRow = {
        ...original,
        left_at: new Date('2026-05-10T12:00:02.000Z'),
      };
      store.participants[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (
      text.includes('INSERT INTO session_nodes') ||
      text.includes('INSERT INTO session_edges') ||
      text.includes('INSERT INTO session_annotations')
    ) {
      // The entity-inclusion endpoint's join-table INSERT. The
      // production statement is `INSERT INTO session_<kind>s
      // (session_id, <entity>_id, included_by) VALUES ($1, $2, $3)
      // ON CONFLICT DO NOTHING RETURNING ...`. We mirror the
      // composite-PK uniqueness check in JS: if a row with the same
      // (session_id, entity_id) already exists, return zero rows
      // (the production ON CONFLICT DO NOTHING path); otherwise
      // append and return the inserted row.
      const targetArray = text.includes('INSERT INTO session_nodes')
        ? store.sessionNodes
        : text.includes('INSERT INTO session_edges')
          ? store.sessionEdges
          : store.sessionAnnotations;
      const [sessionId, entityId, includedBy] = p as [string, string, string];
      const existing = targetArray.find(
        (r) => r.session_id === sessionId && r.entity_id === entityId,
      );
      if (existing !== undefined) {
        // ON CONFLICT DO NOTHING — no row returned.
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const row: InclusionRow = {
        session_id: sessionId,
        entity_id: entityId,
        included_by: includedBy,
        included_at: new Date('2026-05-10T12:00:03.000Z'),
      };
      targetArray.push(row);
      // The production RETURNING projects `session_id,
      // <entity>_id, included_by, included_at`. The shim mirrors
      // that shape; the per-kind column name is normalised back to
      // the SQL surface (e.g. `node_id`) so the handler's
      // destructure works. We look up the column name from the
      // SQL text directly.
      const entityIdColumn = text.includes('INSERT INTO session_nodes')
        ? 'node_id'
        : text.includes('INSERT INTO session_edges')
          ? 'edge_id'
          : 'annotation_id';
      const returnedRow = {
        session_id: row.session_id,
        [entityIdColumn]: row.entity_id,
        included_by: row.included_by,
        included_at: row.included_at,
      };
      return Promise.resolve({ rows: [returnedRow] as unknown as TRow[] });
    }
    if (
      (text.includes('FROM session_nodes sj') ||
        text.includes('FROM session_edges sj') ||
        text.includes('FROM session_annotations sj')) &&
      text.includes('JOIN sessions ON sj.session_id = sessions.id')
    ) {
      // The source-side reference-permission predicate (`canReference
      // <Kind>` from `apps/server/src/sessions/references.ts`). The
      // production SELECT joins `session_<kind>s sj` to `sessions` and
      // filters by `sj.<entity>_id = $1` AND the visibility fragment.
      // We mirror the predicate in JS — picking the right join array
      // from the SQL text and applying the same any-visible-origin
      // rule from the production module.
      const sourceArray = text.includes('FROM session_nodes sj')
        ? store.sessionNodes
        : text.includes('FROM session_edges sj')
          ? store.sessionEdges
          : store.sessionAnnotations;
      const targetEntityId = p[0] as string;
      const userId = p[1] as string;
      const reachable = sourceArray.some((r) => {
        if (r.entity_id !== targetEntityId) return false;
        const originSession = store.sessions.find((s) => s.id === r.session_id);
        if (originSession === undefined) return false;
        // Same visibility predicate as `visibilityWhereFragment`:
        // public, OR host, OR past-or-current participant.
        return (
          originSession.privacy === 'public' ||
          originSession.host_user_id === userId ||
          store.participants.some(
            (sp) => sp.session_id === originSession.id && sp.user_id === userId,
          )
        );
      });
      return Promise.resolve({
        rows: reachable ? ([{ reachable: 1 }] as unknown as TRow[]) : ([] as TRow[]),
      });
    }
    if (text.includes('INSERT INTO session_events')) {
      const [id, sessionId, sequence, kind, actor, payloadJson] = p as [
        string,
        string,
        number,
        string,
        string | null,
        string,
      ];
      store.events.push({
        id,
        session_id: sessionId,
        sequence,
        kind,
        actor,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        created_at: new Date('2026-05-10T12:00:00.001Z'),
      });
      return Promise.resolve({ rows: [] as TRow[] });
    }
    if (
      text.includes('FROM sessions') &&
      text.includes('WHERE id = $1') &&
      text.includes("privacy = 'public'") &&
      text.includes('host_user_id = $2') &&
      text.includes('session_participants')
    ) {
      // The `GET /sessions/:id` visibility-gated SELECT (with or
      // without FOR UPDATE — `POST /sessions/:id/end` uses the same
      // predicate plus the row lock). Mirrors the production WHERE
      // clause: id matches AND (public OR host OR participant). The
      // shim implements the same predicate in JS so the test's
      // assertion is against the row set the production SQL would
      // return — not a re-derivation.
      //
      // `FOR UPDATE` is a no-op in the shim — the single-threaded
      // test runtime can't observe the lock semantics. The presence
      // of the clause is enough to route the query here.
      const targetId = p[0] as string;
      const userId = p[1] as string;
      const visible = store.sessions.filter(
        (s) =>
          s.id === targetId &&
          (s.privacy === 'public' ||
            s.host_user_id === userId ||
            store.participants.some((sp) => sp.session_id === s.id && sp.user_id === userId)),
      );
      return Promise.resolve({ rows: visible as unknown as TRow[] });
    }
    if (text.includes('UPDATE sessions') && text.includes('SET privacy = $1')) {
      // The `PATCH /sessions/:id/privacy` UPDATE. Flip the row's
      // privacy column to the desired value and RETURN the full row
      // in the same shape the create / end endpoints use. The shim's
      // mutate-in-place mirrors what Postgres does under the hood —
      // RETURNING surfaces the post-update value.
      const [desiredPrivacy, targetId] = p as [string, string];
      const idx = store.sessions.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const updated: SessionRow = {
        ...(store.sessions[idx] as SessionRow),
        privacy: desiredPrivacy,
      };
      store.sessions[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (text.includes('UPDATE sessions') && text.includes('SET ended_at = NOW()')) {
      // The `POST /sessions/:id/end` UPDATE. Flip the row's
      // `ended_at` to a deterministic timestamp (pinned for hermetic
      // tests; production reads NOW() from the DB clock). RETURNING
      // surfaces the full row in the same shape the create endpoint
      // returns.
      const targetId = p[0] as string;
      const idx = store.sessions.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const updated: SessionRow = {
        ...(store.sessions[idx] as SessionRow),
        ended_at: new Date('2026-05-10T12:00:01.000Z'),
      };
      store.sessions[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (text.includes('UPDATE sessions') && text.includes('SET started_at = NOW()')) {
      // The `POST /sessions/:id/start` denormalized read-model write
      // (sd_schema). Sets `started_at` once on the lobby -> operate
      // transition, in the same transaction as the operate event. The
      // handler ignores the result (no RETURNING), so we mutate the
      // store row in place — pinned to a deterministic timestamp for
      // hermetic tests; production reads NOW() from the DB clock.
      const targetId = p[0] as string;
      const idx = store.sessions.findIndex((s) => s.id === targetId);
      if (idx < 0) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      const updated: SessionRow = {
        ...(store.sessions[idx] as SessionRow),
        started_at: new Date('2026-05-10T12:00:01.000Z'),
      };
      store.sessions[idx] = updated;
      return Promise.resolve({ rows: [updated] as unknown as TRow[] });
    }
    if (
      text.includes('FROM session_events') &&
      text.includes('WHERE session_id = $1') &&
      text.includes('AND kind = $2') &&
      text.includes('ORDER BY sequence DESC') &&
      text.includes('LIMIT 1') &&
      !text.includes('MAX(sequence)')
    ) {
      // The `POST /sessions/:id/start` idempotency check: read the
      // latest event of a given kind (e.g. 'session-mode-changed') to
      // determine the current mode without re-walking the full log.
      const sessionId = p[0] as string;
      const kind = p[1] as string;
      const matches = store.events
        .filter((e) => e.session_id === sessionId && e.kind === kind)
        .sort((a, b) => b.sequence - a.sequence);
      const latest = matches[0];
      if (latest === undefined) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.resolve({
        rows: [{ payload: latest.payload }] as unknown as TRow[],
      });
    }
    if (
      text.includes('FROM session_events') &&
      text.includes('MAX(sequence)') &&
      text.includes('WHERE session_id = $1')
    ) {
      // The MAX(sequence) read inside the end-session transaction
      // (ADR 0020 application-managed monotonic sequence allocator).
      // The shim returns the highest sequence currently stored for
      // the session, or 0 when no events exist (the production
      // `COALESCE(MAX(sequence), 0)` produces the same value).
      const sessionId = p[0] as string;
      const sequences = store.events
        .filter((e) => e.session_id === sessionId)
        .map((e) => e.sequence);
      const maxSeq = sequences.length === 0 ? 0 : Math.max(...sequences);
      return Promise.resolve({ rows: [{ max_seq: maxSeq }] as unknown as TRow[] });
    }
    if (
      text.includes('FROM sessions s') &&
      text.includes("s.privacy = 'public'") &&
      text.includes('s.started_at IS NOT NULL') &&
      !text.includes('session_participants') &&
      (text.includes('COUNT(*)') || text.includes('ORDER BY s.started_at DESC'))
    ) {
      // The anonymous `GET /sessions/public` query — covers BOTH the
      // page query (`ORDER BY s.started_at DESC, s.created_at DESC
      // LIMIT/OFFSET`, selecting only the listing columns) and the
      // total-count query. Distinguished from the `GET /sessions/mine`
      // branch (no `privacy = 'public'` gate, has `session_participants`)
      // and the `GET /sessions` branch (has `host_user_id = $1` +
      // `session_participants`) by the fixed public-gate with no
      // membership predicate. The gate is the partial index's predicate:
      // `privacy = 'public' AND started_at IS NOT NULL` — lobby and
      // private sessions are excluded here, before any filter.
      let filtered = store.sessions.filter((s) => s.privacy === 'public' && s.started_at != null);
      // Topic filter — `AND s.topic ILIKE $N`; the param is `%...%`.
      const topicMatch = text.match(/s\.topic ILIKE \$(\d+)/);
      if (topicMatch !== null) {
        const idx = Number.parseInt(topicMatch[1] ?? '0', 10) - 1;
        const needle = (p[idx] as string).replace(/^%/, '').replace(/%$/, '').toLowerCase();
        filtered = filtered.filter((s) => s.topic.toLowerCase().includes(needle));
      }
      // Date bounds — `AND s.started_at >= $N` / `AND s.started_at < $N`.
      const afterMatch = text.match(/s\.started_at >= \$(\d+)/);
      if (afterMatch !== null) {
        const idx = Number.parseInt(afterMatch[1] ?? '0', 10) - 1;
        const bound = new Date(p[idx] as string).getTime();
        filtered = filtered.filter((s) => s.started_at != null && s.started_at.getTime() >= bound);
      }
      const beforeMatch = text.match(/s\.started_at < \$(\d+)/);
      if (beforeMatch !== null) {
        const idx = Number.parseInt(beforeMatch[1] ?? '0', 10) - 1;
        const bound = new Date(p[idx] as string).getTime();
        filtered = filtered.filter((s) => s.started_at != null && s.started_at.getTime() < bound);
      }
      if (text.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: filtered.length }] as unknown as TRow[] });
      }
      // Page query: ORDER BY started_at DESC, created_at DESC, then
      // slice by LIMIT/OFFSET (the last two params). No NULLS handling —
      // the gate guarantees a non-null `started_at`.
      const sorted = [...filtered].sort((a, b) => {
        const diff = (b.started_at?.getTime() ?? 0) - (a.started_at?.getTime() ?? 0);
        if (diff !== 0) {
          return diff;
        }
        return b.created_at.getTime() - a.created_at.getTime();
      });
      const limitMatch = text.match(/LIMIT \$(\d+)/);
      const offsetMatch = text.match(/OFFSET \$(\d+)/);
      let pageStart = 0;
      let pageEnd = sorted.length;
      if (offsetMatch !== null) {
        const idx = Number.parseInt(offsetMatch[1] ?? '0', 10) - 1;
        pageStart = (p[idx] as number) ?? 0;
      }
      if (limitMatch !== null) {
        const idx = Number.parseInt(limitMatch[1] ?? '0', 10) - 1;
        const lim = (p[idx] as number) ?? sorted.length;
        pageEnd = Math.min(sorted.length, pageStart + lim);
      }
      // Select only the listing columns — no host identity, no privacy,
      // no role (matches the production SELECT and the anonymous
      // disclosure posture).
      const page = sorted.slice(pageStart, pageEnd).map((s) => ({
        id: s.id,
        topic: s.topic,
        started_at: s.started_at ?? null,
        ended_at: s.ended_at,
      }));
      return Promise.resolve({ rows: page as unknown as TRow[] });
    }
    if (
      text.includes('FROM sessions s') &&
      text.includes('session_participants') &&
      !text.includes("privacy = 'public'") &&
      (text.includes('COUNT(*)') || text.includes('NULLS FIRST'))
    ) {
      // The `GET /sessions/mine` membership query — covers BOTH the
      // page query (`ORDER BY started_at DESC NULLS FIRST, created_at
      // DESC LIMIT/OFFSET`, with the role CASE/subquery) and the
      // total-count query. Distinguished from the `GET /sessions`
      // branch below by the ABSENCE of the `privacy = 'public'`
      // visibility gate (this endpoint has none) and the membership
      // alias `sessions s`. The membership gate is host OR ANY (current
      // or historical) participant row — `left_at` ignored (D1).
      const callerId = p[0] as string;
      let filtered = store.sessions.filter(
        (s) =>
          s.host_user_id === callerId ||
          store.participants.some((sp) => sp.session_id === s.id && sp.user_id === callerId),
      );
      // Topic filter — `AND s.topic ILIKE $N`; the param is `%...%`.
      const topicMatch = text.match(/s\.topic ILIKE \$(\d+)/);
      if (topicMatch !== null) {
        const idx = Number.parseInt(topicMatch[1] ?? '0', 10) - 1;
        const needle = (p[idx] as string).replace(/^%/, '').replace(/%$/, '').toLowerCase();
        filtered = filtered.filter((s) => s.topic.toLowerCase().includes(needle));
      }
      // Date bounds — `AND s.started_at >= $N` / `AND s.started_at <
      // $N`. A NULL `started_at` (lobby) never satisfies a comparison,
      // so either bound excludes lobby rows (D4).
      const afterMatch = text.match(/s\.started_at >= \$(\d+)/);
      if (afterMatch !== null) {
        const idx = Number.parseInt(afterMatch[1] ?? '0', 10) - 1;
        const bound = new Date(p[idx] as string).getTime();
        filtered = filtered.filter((s) => s.started_at != null && s.started_at.getTime() >= bound);
      }
      const beforeMatch = text.match(/s\.started_at < \$(\d+)/);
      if (beforeMatch !== null) {
        const idx = Number.parseInt(beforeMatch[1] ?? '0', 10) - 1;
        const bound = new Date(p[idx] as string).getTime();
        filtered = filtered.filter((s) => s.started_at != null && s.started_at.getTime() < bound);
      }
      if (text.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: filtered.length }] as unknown as TRow[] });
      }
      // Resolve the per-row `role` mirroring the production CASE +
      // correlated subquery (D7): `host` when the caller hosts the
      // session; otherwise the caller's participant role, the active
      // row preferred (`left_at IS NULL` DESC), most-recent
      // (`joined_at` DESC) otherwise.
      const resolveRole = (s: SessionRow): string | null => {
        if (s.host_user_id === callerId) {
          return 'host';
        }
        const rows = store.participants
          .filter((sp) => sp.session_id === s.id && sp.user_id === callerId)
          .sort((a, b) => {
            const aActive = a.left_at === null || a.left_at === undefined ? 1 : 0;
            const bActive = b.left_at === null || b.left_at === undefined ? 1 : 0;
            if (aActive !== bActive) {
              return bActive - aActive;
            }
            const aJoined = a.joined_at?.getTime() ?? 0;
            const bJoined = b.joined_at?.getTime() ?? 0;
            return bJoined - aJoined;
          });
        return rows[0]?.role ?? null;
      };
      // Page query: ORDER BY started_at DESC NULLS FIRST, created_at
      // DESC, then slice by LIMIT/OFFSET (the last two params).
      const sorted = [...filtered].sort((a, b) => {
        const aNull = a.started_at == null;
        const bNull = b.started_at == null;
        if (aNull !== bNull) {
          return aNull ? -1 : 1;
        }
        if (!aNull && !bNull) {
          const diff = b.started_at!.getTime() - a.started_at!.getTime();
          if (diff !== 0) {
            return diff;
          }
        }
        return b.created_at.getTime() - a.created_at.getTime();
      });
      const limitMatch = text.match(/LIMIT \$(\d+)/);
      const offsetMatch = text.match(/OFFSET \$(\d+)/);
      let pageStart = 0;
      let pageEnd = sorted.length;
      if (offsetMatch !== null) {
        const idx = Number.parseInt(offsetMatch[1] ?? '0', 10) - 1;
        pageStart = (p[idx] as number) ?? 0;
      }
      if (limitMatch !== null) {
        const idx = Number.parseInt(limitMatch[1] ?? '0', 10) - 1;
        const lim = (p[idx] as number) ?? sorted.length;
        pageEnd = Math.min(sorted.length, pageStart + lim);
      }
      const page = sorted.slice(pageStart, pageEnd).map((s) => ({
        id: s.id,
        host_user_id: s.host_user_id,
        privacy: s.privacy,
        topic: s.topic,
        created_at: s.created_at,
        started_at: s.started_at ?? null,
        ended_at: s.ended_at,
        role: resolveRole(s),
      }));
      return Promise.resolve({ rows: page as unknown as TRow[] });
    }
    if (
      text.includes('FROM sessions') &&
      text.includes("privacy = 'public'") &&
      text.includes('host_user_id = $1') &&
      text.includes('session_participants') &&
      (text.includes('COUNT(*)') || text.includes('ORDER BY created_at DESC'))
    ) {
      // The `GET /sessions` visibility-gated SELECT — covers BOTH the
      // page query (`ORDER BY created_at DESC LIMIT $N OFFSET $M`) and
      // the total-count query (`SELECT COUNT(*)::int AS total ...`).
      // Both share the same WHERE clause (visibility gate + composed
      // filters); the page query additionally orders and slices. The
      // shim mirrors the production WHERE clause: public OR host OR
      // participant, then AND-composed filters from `?status`, `?host`,
      // `?participant`, `?privacy`, `?topic`.
      //
      // ALL filter values flow through positional `$N` parameters in
      // the production handler; the shim resolves the placeholders by
      // textual matching on the WHERE fragments and reading the
      // corresponding param slot.
      const userId = p[0] as string;
      const visible = store.sessions.filter(
        (s) =>
          s.privacy === 'public' ||
          s.host_user_id === userId ||
          store.participants.some((sp) => sp.session_id === s.id && sp.user_id === userId),
      );
      // The remaining params after $1 are consumed in the order the
      // handler appends them. We track a cursor into `p` to read
      // values as we recognise the matching WHERE fragments.
      let filtered = visible;
      let paramIdx = 1;
      // Lifecycle filter — enum-branched, no parameter consumed.
      if (text.includes('AND ended_at IS NULL')) {
        filtered = filtered.filter((s) => s.ended_at === null);
      } else if (text.includes('AND ended_at IS NOT NULL')) {
        filtered = filtered.filter((s) => s.ended_at !== null);
      }
      // Host filter — `AND host_user_id = $N`. The next param slot
      // carries the host UUID.
      const hostMatch = text.match(/AND host_user_id = \$(\d+)/);
      if (hostMatch !== null) {
        const idx = Number.parseInt(hostMatch[1] ?? '0', 10) - 1;
        const hostValue = p[idx] as string;
        filtered = filtered.filter((s) => s.host_user_id === hostValue);
        paramIdx = Math.max(paramIdx, idx + 1);
      }
      // Participant filter — `AND EXISTS (... sp2.user_id = $N)`.
      const participantMatch = text.match(/sp2\.user_id = \$(\d+)/);
      if (participantMatch !== null) {
        const idx = Number.parseInt(participantMatch[1] ?? '0', 10) - 1;
        const participantValue = p[idx] as string;
        filtered = filtered.filter((s) =>
          store.participants.some(
            (sp) => sp.session_id === s.id && sp.user_id === participantValue,
          ),
        );
        paramIdx = Math.max(paramIdx, idx + 1);
      }
      // Privacy filter — `AND privacy = $N`.
      const privacyMatch = text.match(/AND privacy = \$(\d+)/);
      if (privacyMatch !== null) {
        const idx = Number.parseInt(privacyMatch[1] ?? '0', 10) - 1;
        const privacyValue = p[idx] as string;
        filtered = filtered.filter((s) => s.privacy === privacyValue);
        paramIdx = Math.max(paramIdx, idx + 1);
      }
      // Topic filter — `AND topic ILIKE $N`; the param is wrapped in
      // `%...%` by the handler. We strip the wrappers and do a
      // case-insensitive substring match in JS.
      const topicMatch = text.match(/AND topic ILIKE \$(\d+)/);
      if (topicMatch !== null) {
        const idx = Number.parseInt(topicMatch[1] ?? '0', 10) - 1;
        const topicPattern = p[idx] as string;
        // Strip the leading and trailing `%` to recover the substring.
        const needle = topicPattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
        filtered = filtered.filter((s) => s.topic.toLowerCase().includes(needle));
        paramIdx = Math.max(paramIdx, idx + 1);
      }
      // Reference paramIdx so static analysis doesn't flag it; the
      // value is the next-unread-slot, used implicitly by the
      // recognisers above.
      void paramIdx;
      if (text.includes('COUNT(*)')) {
        // The count query — return the filtered length as `total`.
        return Promise.resolve({
          rows: [{ total: filtered.length }] as unknown as TRow[],
        });
      }
      // The page query. ORDER BY created_at DESC, then slice by
      // LIMIT/OFFSET (the LAST two parameters in the array).
      const sorted = [...filtered].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      const limitMatch = text.match(/LIMIT \$(\d+)/);
      const offsetMatch = text.match(/OFFSET \$(\d+)/);
      let pageStart = 0;
      let pageEnd = sorted.length;
      if (offsetMatch !== null) {
        const idx = Number.parseInt(offsetMatch[1] ?? '0', 10) - 1;
        pageStart = (p[idx] as number) ?? 0;
      }
      if (limitMatch !== null) {
        const idx = Number.parseInt(limitMatch[1] ?? '0', 10) - 1;
        const limit = (p[idx] as number) ?? sorted.length;
        pageEnd = Math.min(sorted.length, pageStart + limit);
      }
      const page = sorted.slice(pageStart, pageEnd);
      return Promise.resolve({ rows: page as unknown as TRow[] });
    }
    // `auth_token_denylist` consult (post-`jwt_revocation_jti_denylist`).
    // Default-empty: no jti is on the denylist; the session-routes
    // tests don't exercise revocation paths.
    if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.reject(new Error(`unexpected SQL in sessions memory pool: ${text}`));
  }

  const pool: DbPool & {
    connect(): Promise<{
      query: typeof runQuery;
      release: () => void;
    }>;
  } = {
    query: runQuery,
    connect() {
      return Promise.resolve({
        query: runQuery,
        release: () => undefined,
      });
    },
  };

  return { pool, store };
}

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BEN_ID = '22222222-2222-4222-8222-222222222222';

interface BuiltApp {
  app: FastifyInstance;
  store: MemoryStore;
}

async function buildApp(opts: { users: UserRow[]; now?: () => number }): Promise<BuiltApp> {
  const { pool, store } = makeMemoryPool(opts.users);
  const appOpts: Parameters<typeof __buildTestSessionsApp>[0] = {
    pool,
    sessionTokenSecret: TEST_SECRET,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  };
  const app = await __buildTestSessionsApp(appOpts);
  return { app, store };
}

describe('POST /sessions — successful creation', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 201 + the camelCase session shape for a valid body', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Is the moon made of cheese?' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('Is the moon made of cheese?');
    expect(typeof body.createdAt).toBe('string');
    expect(body.endedAt).toBeNull();
  });

  it('writes the sessions row, the session-created event, the participant-joined event, and the moderator participant row atomically', async () => {
    // Per the `participant_assignment` refinement's Option A — the
    // create-session transaction now writes four rows in a single
    // BEGIN/COMMIT: the sessions row, the session-created event at
    // sequence=1, the session_participants row for the host as
    // moderator, AND the participant-joined event at sequence=2.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'A debate', privacy: 'private' },
    });
    expect(response.statusCode).toBe(201);

    // Sessions row landed with the supplied values.
    expect(built.store.sessions).toHaveLength(1);
    const sessionRow = built.store.sessions[0];
    expect(sessionRow?.host_user_id).toBe(ALICE_ID);
    expect(sessionRow?.privacy).toBe('private');
    expect(sessionRow?.topic).toBe('A debate');

    // Two session_events rows: session-created at sequence=1 and
    // participant-joined (for the host as moderator) at sequence=2.
    expect(built.store.events).toHaveLength(2);
    const createdEvent = built.store.events.find((e) => e.kind === 'session-created');
    expect(createdEvent?.session_id).toBe(sessionRow?.id);
    expect(createdEvent?.sequence).toBe(1);
    expect(createdEvent?.actor).toBe(ALICE_ID);
    const createdPayload = createdEvent?.payload as Record<string, unknown>;
    expect(createdPayload?.['host_user_id']).toBe(ALICE_ID);
    expect(createdPayload?.['privacy']).toBe('private');
    expect(createdPayload?.['topic']).toBe('A debate');
    expect(typeof createdPayload?.['created_at']).toBe('string');

    const joinedEvent = built.store.events.find((e) => e.kind === 'participant-joined');
    expect(joinedEvent?.session_id).toBe(sessionRow?.id);
    expect(joinedEvent?.sequence).toBe(2);
    expect(joinedEvent?.actor).toBe(ALICE_ID);
    const joinedPayload = joinedEvent?.payload as Record<string, unknown>;
    expect(joinedPayload?.['user_id']).toBe(ALICE_ID);
    expect(joinedPayload?.['role']).toBe('moderator');
    expect(joinedPayload?.['screen_name']).toBe('alice');
    expect(typeof joinedPayload?.['joined_at']).toBe('string');

    // Exactly one session_participants row: the host as moderator.
    expect(built.store.participants).toHaveLength(1);
    const participantRow = built.store.participants[0];
    expect(participantRow?.session_id).toBe(sessionRow?.id);
    expect(participantRow?.user_id).toBe(ALICE_ID);
    expect(participantRow?.role).toBe('moderator');
    expect(participantRow?.left_at ?? null).toBeNull();

    // Transaction shape: BEGIN, the four writes, then COMMIT. NO
    // ROLLBACK on the success path.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('defaults privacy to public when the body omits it', async () => {
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Hello' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ privacy?: string }>();
    expect(body.privacy).toBe('public');
    expect(built.store.sessions[0]?.privacy).toBe('public');
    const createdEvent = built.store.events.find((e) => e.kind === 'session-created');
    expect(createdEvent?.payload?.['privacy']).toBe('public');
  });
});

describe('POST /sessions — auth gate', () => {
  let built: BuiltApp;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { topic: 'No cookie here' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // Critical: nothing is written when auth fails. The middleware
    // throws before the handler runs, so the transaction never opens.
    expect(built.store.sessions).toHaveLength(0);
    expect(built.store.events).toHaveLength(0);
    expect(built.store.trace).toHaveLength(0);
  });

  it('returns 401 when the cookie refers to a user the DB does not know', async () => {
    // Sign a JWT for a user id the memory pool doesn't carry — the
    // middleware's `SELECT id, screen_name FROM users WHERE id = $1
    // AND deleted_at IS NULL` returns zero rows; the middleware throws
    // 401 auth-required and the handler never runs.
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'Ghost user' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });
});

describe('POST /sessions — body validation', () => {
  let built: BuiltApp;
  let token: string;

  beforeEach(async () => {
    built = await buildApp({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
    });
    token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
  });

  afterEach(async () => {
    await built.app.close();
  });

  it('returns 400 when the body omits topic', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    // The handler never runs on a body-validation failure — nothing
    // lands in the DB.
    expect(built.store.sessions).toHaveLength(0);
    expect(built.store.events).toHaveLength(0);
  });

  it('returns 400 when topic exceeds the 256-character cap', async () => {
    const tooLong = 'x'.repeat(257);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: tooLong },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    expect(built.store.sessions).toHaveLength(0);
  });

  it('returns 400 when privacy is outside the enum', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: 'OK topic', privacy: 'secret' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
    expect(built.store.sessions).toHaveLength(0);
  });

  it('returns 400 when topic is an empty string', async () => {
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { topic: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

describe('GET /sessions — visibility gate and lifecycle filter', () => {
  // Helper: seed N sessions and a participant set, then build the
  // app. Each test seeds the exact shape it needs so the assertions
  // are local.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const PUBLIC_OLD: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Older public debate',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_NEW: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Newer public debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ALICE: SessionRow = {
    id: '00000000-0000-4000-8000-bbbbbbbb0001',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: "Alice's private debate",
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A finished public debate',
    created_at: new Date('2026-05-07T10:00:00.000Z'),
    ended_at: new Date('2026-05-07T11:00:00.000Z'),
  };

  it('returns 200 + the sessions list in created_at DESC order for an authenticated caller', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_OLD, PUBLIC_NEW],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; topic?: string }> }>();
    expect(body.sessions).toHaveLength(2);
    // DESC: newer first.
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[1]?.id).toBe(PUBLIC_OLD.id);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW],
    });
    const response = await built.app.inject({ method: 'GET', url: '/api/sessions' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns ONLY public sessions for a user with no participation history', async () => {
    // Ben is a fresh user — not the host, not a participant in any
    // private session. Alice owns a private session. Ben must NOT see it.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; privacy?: string }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[0]?.privacy).toBe('public');
  });

  it('returns public + private-where-participant for a participant', async () => {
    // Ben is a participant in Alice's private session.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE],
      participants: [{ session_id: PRIVATE_ALICE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }> }>();
    const ids = body.sessions?.map((s) => s.id) ?? [];
    expect(ids).toContain(PUBLIC_NEW.id);
    expect(ids).toContain(PRIVATE_ALICE.id);
    expect(ids).toHaveLength(2);
  });

  it('hides private-where-not-a-participant from a non-participant', async () => {
    // Same shape as the "no participation history" case but more
    // explicit — Ben has SOME participant history (in a different
    // private session he won't be a participant of). The endpoint
    // must NOT leak Alice's private session.
    const OTHER_PRIVATE: SessionRow = {
      id: '00000000-0000-4000-8000-bbbbbbbb0002',
      host_user_id: BEN_ID,
      privacy: 'private',
      topic: "Ben's own private session",
      created_at: new Date('2026-05-09T12:00:00.000Z'),
      ended_at: null,
    };
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PRIVATE_ALICE, OTHER_PRIVATE],
      participants: [{ session_id: OTHER_PRIVATE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }> }>();
    const ids = body.sessions?.map((s) => s.id) ?? [];
    expect(ids).toContain(PUBLIC_NEW.id);
    // Ben sees OTHER_PRIVATE because he is host + participant. He
    // does NOT see Alice's PRIVATE_ALICE.
    expect(ids).toContain(OTHER_PRIVATE.id);
    expect(ids).not.toContain(PRIVATE_ALICE.id);
  });

  it('filters out ended sessions when ?status=active', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?status=active',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; endedAt?: string | null }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_NEW.id);
    expect(body.sessions?.[0]?.endedAt).toBeNull();
  });

  it('returns only ended sessions when ?status=ended', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_NEW, PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?status=ended',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; endedAt?: string | null }> }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(PUBLIC_ENDED.id);
    expect(typeof body.sessions?.[0]?.endedAt).toBe('string');
  });
});

describe('GET /sessions — filters and pagination', () => {
  // Filter-and-pagination tests for the `session_listing_filters` task.
  // The visibility gate stays in place; the filters narrow within it.
  // The wrapper now carries `{ sessions, total }`; clients can page
  // by combining `?limit` + `?offset` and trust `total` for the
  // pagination-UI denominator.
  //
  // Refinement: tasks/refinements/backend/session_listing_filters.md.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded fixtures — distinct from the
  // visibility-gate suite's ids so a stray cross-suite reference fails
  // loudly. Sessions are ordered by `created_at` so the DESC ordering
  // assertions are deterministic.
  const CAROL_ID = '33333333-3333-4333-8333-333333333333';
  const SESSION_ALICE_PUB: SessionRow = {
    id: '00000000-0000-4000-8000-f1f1f1f10001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Climate is changing',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const SESSION_ALICE_PRIV: SessionRow = {
    id: '00000000-0000-4000-8000-f1f1f1f10002',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'A private climate debate',
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };
  const SESSION_BEN_PUB: SessionRow = {
    id: '00000000-0000-4000-8000-f1f1f1f10003',
    host_user_id: BEN_ID,
    privacy: 'public',
    topic: 'Should robots have rights',
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    ended_at: null,
  };
  const SESSION_CAROL_PUB: SessionRow = {
    id: '00000000-0000-4000-8000-f1f1f1f10004',
    host_user_id: CAROL_ID,
    privacy: 'public',
    topic: 'Cooking with steam',
    created_at: new Date('2026-05-09T13:00:00.000Z'),
    ended_at: null,
  };

  const seededUsers: UserRow[] = [
    {
      id: ALICE_ID,
      oauth_subject: 'authelia:alice',
      screen_name: 'alice',
      deleted_at: null,
    },
    {
      id: BEN_ID,
      oauth_subject: 'authelia:ben',
      screen_name: 'ben',
      deleted_at: null,
    },
    {
      id: CAROL_ID,
      oauth_subject: 'authelia:carol',
      screen_name: 'carol',
      deleted_at: null,
    },
  ];

  it('?host filters to sessions hosted by the supplied user id', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_BEN_PUB, SESSION_CAROL_PUB],
    });
    // Alice asks for sessions hosted by Ben. The visibility gate
    // admits the row (public) AND the filter narrows to the host
    // match — only SESSION_BEN_PUB should land.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?host=${BEN_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<{ id?: string; hostUserId?: string }>;
      total?: number;
    }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_BEN_PUB.id);
    expect(body.sessions?.[0]?.hostUserId).toBe(BEN_ID);
    expect(body.total).toBe(1);
  });

  it('?participant filters to sessions where the user is/was a participant', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_BEN_PUB, SESSION_CAROL_PUB],
      // Carol is a participant in Ben's public session.
      participants: [{ session_id: SESSION_BEN_PUB.id, user_id: CAROL_ID }],
    });
    // Alice asks for sessions where Carol has participated. The
    // visibility gate admits all three (public sessions all visible);
    // the participant filter narrows to Ben's session only.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?participant=${CAROL_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_BEN_PUB.id);
    expect(body.total).toBe(1);
  });

  it('?privacy=private narrows to the private bucket (visibility still applies)', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_ALICE_PRIV],
    });
    // Alice (the host of the private session) asks for her private
    // bucket. The visibility gate admits both rows; the privacy
    // filter narrows to PRIV only.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?privacy=private',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<{ id?: string; privacy?: string }>;
      total?: number;
    }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_ALICE_PRIV.id);
    expect(body.sessions?.[0]?.privacy).toBe('private');
    expect(body.total).toBe(1);
  });

  it('?topic substring match is case-insensitive (ILIKE)', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_ALICE_PRIV, SESSION_BEN_PUB, SESSION_CAROL_PUB],
    });
    // Alice searches for "CLIMATE" (uppercase). Both her sessions
    // carry the substring (one public, one private; both visible to
    // her as the host). ILIKE is case-insensitive.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=CLIMATE',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    const ids = body.sessions?.map((s) => s.id) ?? [];
    expect(ids).toContain(SESSION_ALICE_PUB.id);
    expect(ids).toContain(SESSION_ALICE_PRIV.id);
    expect(ids).not.toContain(SESSION_BEN_PUB.id);
    expect(ids).not.toContain(SESSION_CAROL_PUB.id);
    expect(body.total).toBe(2);
  });

  it('combines ?host AND ?privacy with AND semantics', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_ALICE_PRIV, SESSION_BEN_PUB],
    });
    // Alice asks for HER public sessions only. Both filters narrow:
    // host=ALICE narrows to her two sessions; privacy=public narrows
    // to her one public session.
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?host=${ALICE_ID}&privacy=public`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<{ id?: string; hostUserId?: string; privacy?: string }>;
      total?: number;
    }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_ALICE_PUB.id);
    expect(body.sessions?.[0]?.hostUserId).toBe(ALICE_ID);
    expect(body.sessions?.[0]?.privacy).toBe('public');
    expect(body.total).toBe(1);
  });

  it('combines ?topic AND ?limit (filter narrows, then page slices)', async () => {
    // Three sessions carry "climate"; capping limit at 1 returns
    // only the most-recent one and `total` reflects the full match.
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [
        SESSION_ALICE_PUB,
        SESSION_ALICE_PRIV,
        {
          id: '00000000-0000-4000-8000-f1f1f1f10009',
          host_user_id: CAROL_ID,
          privacy: 'public',
          topic: 'climate science update',
          created_at: new Date('2026-05-09T14:00:00.000Z'),
          ended_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=climate&limit=1',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.total).toBe(3);
  });

  it('?limit + ?offset paginates: total counts the full visibility-gated set, page slices', async () => {
    // Four public sessions all visible to Alice. With limit=2 &
    // offset=0, the first page returns the two newest; total=4.
    // With offset=2 the next page returns the two oldest.
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_ALICE_PRIV, SESSION_BEN_PUB, SESSION_CAROL_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const firstPage = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?limit=2&offset=0',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json<{
      sessions?: Array<{ id?: string }>;
      total?: number;
    }>();
    expect(firstBody.sessions).toHaveLength(2);
    expect(firstBody.total).toBe(4);
    // DESC order — the two newest sessions are CAROL_PUB (13:00) and
    // BEN_PUB (12:00).
    expect(firstBody.sessions?.[0]?.id).toBe(SESSION_CAROL_PUB.id);
    expect(firstBody.sessions?.[1]?.id).toBe(SESSION_BEN_PUB.id);

    const secondPage = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?limit=2&offset=2',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json<{
      sessions?: Array<{ id?: string }>;
      total?: number;
    }>();
    expect(secondBody.sessions).toHaveLength(2);
    expect(secondBody.total).toBe(4);
    // The two oldest — SESSION_ALICE_PRIV (11:00) and
    // SESSION_ALICE_PUB (10:00).
    expect(secondBody.sessions?.[0]?.id).toBe(SESSION_ALICE_PRIV.id);
    expect(secondBody.sessions?.[1]?.id).toBe(SESSION_ALICE_PUB.id);
  });

  it('returns total=0 + empty sessions when filters match nothing', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB, SESSION_BEN_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=zzz-no-match',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: unknown[]; total?: number }>();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns 400 validation-failed when ?host is not a UUID', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?host=not-a-uuid',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when ?limit exceeds the 200 cap', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?limit=999',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  // `?offset` cap — closes docs/security/m3-review/coverage.md G-013.
  // The pre-task schema only enforced `minimum: 0`, so a request like
  // `GET /sessions?offset=999999999999` was well-formed and reached
  // Postgres as a valid `OFFSET 999999999999`. Postgres returns empty
  // correctly but burns I/O / CPU scanning past the offset; an
  // authenticated client could multiply that with parallel requests.
  // The cap is `MAX_SESSION_LIST_OFFSET = 100_000` — 500 pages at
  // `?limit=200`, orders of magnitude beyond any human pagination
  // need. Over-cap requests fail at the schema layer (400
  // `validation-failed`) before any DB round-trip.

  it('?offset exactly at the cap (100_000) is accepted', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?offset=${MAX_SESSION_LIST_OFFSET}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // At-cap is accepted; the offset is far past any seeded row, so
    // the body is empty but `total` still reflects the visibility-
    // gated count.
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: unknown[]; total?: number }>();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(1);
  });

  it('returns 400 validation-failed when ?offset exceeds the 100_000 cap (cap + 1)', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?offset=${MAX_SESSION_LIST_OFFSET + 1}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when ?offset is a far-over-cap integer (DoS scenario)', async () => {
    // The G-013 adversarial scenario: `GET /sessions?offset=1e18`.
    // The schema rejects it before any DB round-trip.
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?offset=999999999999999',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('?offset=0 (the default) still works — regression', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?offset=0',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_ALICE_PUB.id);
  });

  it('returns 400 validation-failed when ?privacy is outside the enum', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?privacy=hidden',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  // `?topic` SEARCH-string length bounds — closes
  // docs/security/m3-review/inputs.md F-013. The pre-task schema
  // accepted `?topic` 1..256 chars; `sessions.topic` has no GIN/
  // trigram index, so each `?topic=` filter triggers a full
  // sequential scan and the per-row ILIKE cost scales with the
  // pattern length. The tightening: minimum 3 chars (below that,
  // patterns match nearly every row and force a near-full scan
  // worst case), maximum 64 chars (caps per-row comparison cost
  // — distinct from the storage cap `MAX_TOPIC_LENGTH=256`).
  // The structural fix (a `gin_trgm_ops` index on `sessions.topic`)
  // is deferred to a future migration; the schema caps are the
  // cheap first line of defense. Over-cap and below-min requests
  // are rejected at the validator layer (400 `validation-failed`)
  // before any DB round-trip.

  it('returns 400 validation-failed when ?topic is empty', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 400 validation-failed when ?topic is below the minimum length (2 chars)', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=ab',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('?topic exactly at the minimum length (3 chars) is accepted', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // `abc` is the at-min query. SESSION_ALICE_PUB's topic
    // ('Climate is changing') doesn't contain 'abc', so the result
    // is an empty page — but the request must succeed at the
    // schema layer.
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=abc',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: unknown[]; total?: number }>();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('?topic exactly at the maximum length (64 chars) is accepted', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const atCap = 'a'.repeat(MAX_TOPIC_SEARCH_LENGTH);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?topic=${atCap}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // At-cap is accepted at the schema layer; the seeded topic
    // doesn't match the pattern, so the body is empty.
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: unknown[]; total?: number }>();
    expect(body.sessions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns 400 validation-failed when ?topic exceeds the 64-character cap (cap + 1)', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const overCap = 'a'.repeat(MAX_TOPIC_SEARCH_LENGTH + 1);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions?topic=${overCap}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('?topic=climate (typical short query) still works — regression', async () => {
    // Regression on the typical happy path — the caps must NOT
    // interfere with normal substring search. SESSION_ALICE_PUB's
    // topic is 'Climate is changing'; the case-insensitive ILIKE
    // match should land it in the response.
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [SESSION_ALICE_PUB],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions?topic=climate',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.sessions?.[0]?.id).toBe(SESSION_ALICE_PUB.id);
  });

  it('cap constants from shared-types match the schema-layer expectations', () => {
    // Pin the constants themselves so a future change to the
    // shared-types module surfaces here too. The min and max
    // bracket the legitimate-search-string range; the min equals 3
    // (trigram length) and the max equals 64 (per the refinement).
    expect(MIN_TOPIC_SEARCH_LENGTH).toBe(3);
    expect(MAX_TOPIC_SEARCH_LENGTH).toBe(64);
    expect(MIN_TOPIC_SEARCH_LENGTH).toBeLessThan(MAX_TOPIC_SEARCH_LENGTH);
  });
});

describe('GET /sessions/:id — visibility-gated fetch', () => {
  // Re-uses the same seed helper shape as the list-endpoint suite —
  // seed users + sessions + (optionally) participation rows into the
  // shared memory pool, then build the Fastify app on top.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from the
  // list-suite ids so a stray cross-suite reference fails loudly.
  const PUBLIC_SESSION: SessionRow = {
    id: '00000000-0000-4000-8000-dddddddd0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A public debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ALICE: SessionRow = {
    id: '00000000-0000-4000-8000-eeeeeeee0001',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: "Alice's private debate",
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };

  it('returns 200 + SessionResponse for an authenticated, visible session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PUBLIC_SESSION.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    // Bare SessionResponse — NOT wrapped in `{ session: ... }`.
    expect(body.id).toBe(PUBLIC_SESSION.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('A public debate');
    expect(typeof body.createdAt).toBe('string');
    expect(body.endedAt).toBeNull();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PUBLIC_SESSION.id}`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [], // no sessions seeded
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff0001';
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${unknownId}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // The existence-leak rule: Ben must not be able to tell whether
    // Alice's private session exists. The response must be 404,
    // identical in shape to the unknown-id case above.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
      participants: [],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // CRITICAL — 404, not 403. Asserting the exact status here is
    // the load-bearing test for the existence-leak rule.
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 200 for the host on their own private session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id?: string; privacy?: string; hostUserId?: string }>();
    expect(body.id).toBe(PRIVATE_ALICE.id);
    expect(body.privacy).toBe('private');
    expect(body.hostUserId).toBe(ALICE_ID);
  });

  it('returns 200 for a participant on a private session they are part of', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ALICE],
      participants: [{ session_id: PRIVATE_ALICE.id, user_id: BEN_ID }],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_ALICE.id}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id?: string; privacy?: string }>();
    expect(body.id).toBe(PRIVATE_ALICE.id);
    expect(body.privacy).toBe('private');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_SESSION],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/not-a-uuid',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns a bytewise-identical 404 response for a nonexistent id vs. a private session not visible to the caller (G-014)', async () => {
    // Source: docs/security/m3-review/coverage.md G-014
    // Refinement: tasks/refinements/backend-hardening/bytewise_404_vs_private_pin.md
    //
    // The visibility predicate collapses "session doesn't exist" and
    // "session exists but caller can't see it" at the SQL layer (zero
    // rows in both cases). The handler returns the same 404 +
    // `ApiError.notFound('session not found or not visible')` for
    // both. This test pins the no-existence-leak invariant — a future
    // refactor that distinguishes the two (e.g. by adding a
    // `details.reason` field, by changing the message, by switching
    // to a different status) breaks this assertion.
    //
    // Compare strategy: issue both requests against a single app
    // fixture seeded with a private session Alice can NOT see (Ben is
    // the host; Alice is not a participant) and a fully-unknown UUID
    // not seeded anywhere. Both requests are authenticated as Alice.
    // Deep-equal the full JSON bodies — the canonical HTTP error
    // envelope has no per-request varying fields (no id, no
    // timestamp, no request-id; see apps/server/src/error-handler.ts:148-157).
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      // PRIVATE_BEN is Ben's private session; Alice cannot see it.
      sessions: [
        {
          id: '00000000-0000-4000-8000-cccc00000001',
          host_user_id: BEN_ID,
          privacy: 'private',
          topic: "Ben's invisible-to-Alice debate",
          created_at: new Date('2026-05-09T12:00:00.000Z'),
          ended_at: null,
        },
      ],
      participants: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // A fully-unknown UUID, distinct from the private-not-visible id.
    const UNKNOWN_ID = '00000000-0000-4000-8000-cccc99999999';
    const PRIVATE_NOT_VISIBLE_ID = '00000000-0000-4000-8000-cccc00000001';

    const resPrivate = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_NOT_VISIBLE_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const resUnknown = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${UNKNOWN_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    // Status-code parity (load-bearing — 404 on both sides).
    expect(resPrivate.statusCode).toBe(404);
    expect(resUnknown.statusCode).toBe(404);
    expect(resPrivate.statusCode).toBe(resUnknown.statusCode);

    // error.code + error.message parity (asserted explicitly so a
    // regression on either field surfaces with a readable message).
    const bodyPrivate = resPrivate.json<{ error?: { code?: string; message?: string } }>();
    const bodyUnknown = resUnknown.json<{ error?: { code?: string; message?: string } }>();
    expect(bodyPrivate.error?.code).toBe('not-found');
    expect(bodyUnknown.error?.code).toBe('not-found');
    expect(bodyPrivate.error?.code).toBe(bodyUnknown.error?.code);
    expect(bodyPrivate.error?.message).toBe(bodyUnknown.error?.message);

    // Full-body deep-equal — the canonical error envelope has no
    // per-request varying fields, so the full JSON must match. Any
    // future addition of a discriminating field (e.g. `details.reason`)
    // on one branch and not the other fails this assertion.
    expect(bodyPrivate).toEqual(bodyUnknown);

    // Headers parity for the content-type — the same `application/json`
    // is emitted on both sides (Fastify's setErrorHandler routes
    // through `reply.type('application/json')`). A future divergence
    // here would also be a leak vector.
    expect(resPrivate.headers['content-type']).toBe(resUnknown.headers['content-type']);
  });
});

describe('POST /sessions/:id/end — moderator ends the session', () => {
  // Seed helper — same shape as the list / get suites. Each test seeds
  // the exact users + sessions + (optional) participants + (optional)
  // pre-existing session_events the scenario needs, then drives a
  // POST /sessions/:id/end against the resulting app.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from the list /
  // get-suite ids so a stray cross-suite reference fails loudly.
  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate to end',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ALREADY_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Already ended',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };
  const PRIVATE_BENS: SessionRow = {
    id: '00000000-0000-4000-8000-eeee00000003',
    host_user_id: BEN_ID,
    privacy: 'private',
    topic: "Ben's private session",
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    ended_at: null,
  };

  // Pre-existing `session-created` event for ALICE's public session.
  // The endpoint's MAX(sequence) read sees this as the highest
  // existing sequence, so `nextSeq = 2` for the session-ended event.
  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '99999999-9999-4999-8999-999999999001',
    session_id: PUBLIC_ACTIVE.id,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A debate to end',
      created_at: '2026-05-09T10:00:00.000Z',
    },
    created_at: new Date('2026-05-09T10:00:00.001Z'),
  };

  it('returns 200 + the camelCase session shape with endedAt populated when the host ends an active session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('public');
    expect(body.topic).toBe('A debate to end');
    expect(typeof body.endedAt).toBe('string');
    // Same iso the shim's UPDATE handler pinned.
    expect(body.endedAt).toBe('2026-05-10T12:00:01.000Z');
  });

  it('writes BOTH the UPDATE and the session-ended event atomically at the next sequence', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);

    // The UPDATE: the in-memory session row now carries a non-null
    // ended_at. The shim's UPDATE handler mutates in place, so the
    // store's sessions array has the new ended_at value.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.ended_at).not.toBeNull();

    // The INSERT: the session-ended event landed at sequence=2 (the
    // pre-existing session-created sat at sequence=1, so MAX+1 = 2).
    const endedEvent = built.store.events.find(
      (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-ended',
    );
    expect(endedEvent).toBeDefined();
    expect(endedEvent?.sequence).toBe(2);
    expect(endedEvent?.actor).toBe(ALICE_ID);
    const payload = endedEvent?.payload as Record<string, unknown>;
    expect(typeof payload?.['ended_at']).toBe('string');
    // The payload's ended_at mirrors the column's value (the shim's
    // UPDATE handler pinned both to the same iso string).
    expect(payload?.['ended_at']).toBe('2026-05-10T12:00:01.000Z');

    // Transaction shape: BEGIN, the SELECT + UPDATE + MAX + INSERT
    // run inside, then COMMIT. NO ROLLBACK on the success path.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 403 not-a-moderator when the caller is visible but is not the host', async () => {
    // Public session — Ben can see it (it's public), but Alice is the
    // host, so Ben's attempt to end it must be rejected with 403.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    // No write side-effects: the session remains active, no new event
    // landed, the transaction rolled back.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.ended_at).toBeNull();
    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-ended',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // Alice tries to end Ben's private session — she can't even see
    // it. Visibility-non-leak rule fires BEFORE the authority check:
    // 404, not 403, NOT some other distinguishable status. The
    // session's existence isn't leaked.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PRIVATE_BENS.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');

    // No write side-effects.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_BENS.id);
    expect(sessionAfter?.ended_at).toBeNull();
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 session-already-ended when the host re-attempts on an already-ended session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ALREADY_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ALREADY_ENDED.id}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');

    // The row's ended_at is unchanged (still the original timestamp,
    // not the shim's UPDATE-handler pin), and no new session-ended
    // event landed. The transaction rolled back.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ALREADY_ENDED.id);
    expect(sessionAfter?.ended_at?.toISOString()).toBe('2026-05-08T11:00:00.000Z');
    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ALREADY_ENDED.id && e.kind === 'session-ended',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff0009';
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${unknownId}/end`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions/not-a-uuid/end',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/end`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // No write side-effects whatsoever — the middleware threw before
    // the handler ran, so no BEGIN.
    expect(built.store.trace).toHaveLength(0);
    expect(built.store.events.filter((e) => e.kind === 'session-ended')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /sessions/:id/start — moderator advances the session out of the
// lobby. Per ADR 0028 the transition is signalled by a dedicated
// `session-mode-changed` wire event; the participant lobby's auto-
// navigation `useEffect` consumes the event as its primary trigger
// for the lobby → operate handoff.
//
// Coverage (per part_session_start_handoff_dedicated_event.md →
// Acceptance criteria §3):
//   - Host starts an active session → 200 + session row; the
//     session-mode-changed event lands at MAX(sequence)+1; the
//     transaction trace is BEGIN…COMMIT.
//   - Non-host (visible but not host) → 403 `not-a-moderator`; no
//     writes; trace ends with ROLLBACK.
//   - Non-participant on a private session → 404 `not-found`
//     (existence-non-leak rule).
//   - Ended session → 422 `session-already-ended`.
//   - Idempotent re-POST against an already-started session → 200
//     with NO second event emitted (Decision §5).
//   - Unknown id → 404 `not-found`.
// ─────────────────────────────────────────────────────────────────────
describe('POST /sessions/:id/start — moderator starts the session', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate to start',
    created_at: new Date('2026-05-15T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Already ended',
    created_at: new Date('2026-05-14T10:00:00.000Z'),
    ended_at: new Date('2026-05-14T11:00:00.000Z'),
  };
  const PRIVATE_BENS: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000003',
    host_user_id: BEN_ID,
    privacy: 'private',
    topic: "Ben's private session",
    created_at: new Date('2026-05-15T12:00:00.000Z'),
    ended_at: null,
  };

  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '99999999-9999-4999-8999-99999999f001',
    session_id: PUBLIC_ACTIVE.id,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A debate to start',
      created_at: '2026-05-15T10:00:00.000Z',
    },
    created_at: new Date('2026-05-15T10:00:00.001Z'),
  };

  it('returns 200 + the camelCase session shape and emits a session-mode-changed event at MAX(sequence)+1', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.endedAt).toBeNull();

    // The session-mode-changed event landed at sequence=2 (the
    // pre-existing session-created sat at sequence=1, so MAX+1 = 2).
    const modeChangedEvents = built.store.events.filter(
      (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-mode-changed',
    );
    expect(modeChangedEvents).toHaveLength(1);
    const event = modeChangedEvents[0];
    expect(event?.sequence).toBe(2);
    expect(event?.actor).toBe(ALICE_ID);
    const payload = event?.payload as Record<string, unknown>;
    expect(payload?.['previous_mode']).toBe('lobby');
    expect(payload?.['new_mode']).toBe('operate');
    expect(payload?.['changed_by']).toBe(ALICE_ID);
    expect(typeof payload?.['changed_at']).toBe('string');

    // Transaction shape: BEGIN …work… COMMIT, no ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 403 not-a-moderator when the caller is visible but is not the host', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-mode-changed',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PRIVATE_BENS.id}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 422 session-already-ended when the host attempts to start an ended session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ENDED.id}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');
    expect(
      built.store.events.filter(
        (e) => e.session_id === PUBLIC_ENDED.id && e.kind === 'session-mode-changed',
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('is idempotent on re-POST: a second start against an already-started session returns 200 with NO second event', async () => {
    // Seed an already-started session by pre-loading a
    // session-mode-changed event at sequence=2. The endpoint reads
    // the per-session event log inside the transaction; finding the
    // `new_mode: 'operate'` short-circuits the event append.
    const ALREADY_STARTED_EVENT: SessionEventRow = {
      id: '99999999-9999-4999-8999-99999999f002',
      session_id: PUBLIC_ACTIVE.id,
      sequence: 2,
      kind: 'session-mode-changed',
      actor: ALICE_ID,
      payload: {
        previous_mode: 'lobby',
        new_mode: 'operate',
        changed_by: ALICE_ID,
        changed_at: '2026-05-15T10:30:00.000Z',
      },
      created_at: new Date('2026-05-15T10:30:00.001Z'),
    };
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      events: [SESSION_CREATED_EVENT, ALREADY_STARTED_EVENT],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ id?: string }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    // Crucial: no second session-mode-changed event landed; the
    // total count stays at 1 (the seeded one).
    const modeChangedEvents = built.store.events.filter(
      (e) => e.session_id === PUBLIC_ACTIVE.id && e.kind === 'session-mode-changed',
    );
    expect(modeChangedEvents).toHaveLength(1);
    expect(modeChangedEvents[0]?.id).toBe(ALREADY_STARTED_EVENT.id);
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffffff09';
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${unknownId}/start`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: '/api/sessions/not-a-uuid/start',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/start`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    expect(built.store.trace).toHaveLength(0);
    expect(built.store.events.filter((e) => e.kind === 'session-mode-changed')).toHaveLength(0);
  });
});

describe('PATCH /sessions/:id/privacy — host toggles session privacy', () => {
  // Seed helper — same shape as the list / get / end suites. Each
  // test seeds the exact users + sessions + (optional) participants
  // needed and drives a PATCH /sessions/:id/privacy.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded session rows. Distinct from every
  // other suite's ids so a stray cross-suite reference fails loudly.
  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate to privatize',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000002',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'A private debate to publish',
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000003',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Already finished',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };
  const PRIVATE_BENS: SessionRow = {
    id: '00000000-0000-4000-8000-ffff00000004',
    host_user_id: BEN_ID,
    privacy: 'private',
    topic: "Ben's private session",
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    ended_at: null,
  };

  it('returns 200 + the new privacy in the response when the host toggles public to private', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      hostUserId?: string;
      privacy?: string;
      topic?: string;
      createdAt?: string;
      endedAt?: string | null;
    }>();
    expect(body.id).toBe(PUBLIC_ACTIVE.id);
    expect(body.hostUserId).toBe(ALICE_ID);
    expect(body.privacy).toBe('private');
    expect(body.topic).toBe('A debate to privatize');
    expect(body.endedAt).toBeNull();

    // The in-memory row reflects the new value — the UPDATE landed.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('private');

    // No event landed — Option B (no `session-privacy-changed` kind).
    expect(built.store.events).toHaveLength(0);
  });

  it('returns 200 with the unchanged privacy when the host sets the same value (idempotent)', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // The row is already public; set it to public again.
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ privacy?: string }>();
    expect(body.privacy).toBe('public');
    // Row's privacy still public — no-op write at the DB layer.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 403 not-a-moderator when the caller is visible but is not the host', async () => {
    // Public session — Ben can see it, but Alice is the host. Ben's
    // attempt to toggle privacy must be rejected with 403.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // Alice tries to toggle Ben's private session — she can't even
    // see it. Visibility-non-leak rule fires BEFORE the authority
    // check: 404, not 403. Identical response to nonexistent-id.
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PRIVATE_BENS.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_BENS.id);
    expect(sessionAfter?.privacy).toBe('private');
  });

  it('returns 409 session-already-ended when the host attempts to toggle an ended session', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ENDED],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ENDED.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');

    // Row's privacy unchanged.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ENDED.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns 404 not-found when the id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff000a';
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${unknownId}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 400 validation-failed when the body omits privacy or carries an invalid enum', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ACTIVE],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);

    // Missing privacy.
    const missing = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PRIVATE_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Invalid enum.
    const bad = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PRIVATE_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'secret' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Row's privacy unchanged through both attempts.
    const sessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('private');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');

    // No write side-effects.
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('public');
  });

  it('returns a bytewise-identical 404 response for a nonexistent id vs. a private session not visible to the caller (G-014)', async () => {
    // Source: docs/security/m3-review/coverage.md G-014
    // Refinement: tasks/refinements/backend-hardening/bytewise_404_vs_private_pin.md
    //
    // Mirrors the GET /sessions/:id bytewise-pin test on the PATCH
    // surface — same visibility predicate collapse, same `ApiError
    // .notFound('session not found or not visible')` literal. The
    // visibility-then-authority ordering at routes.ts:1855-1860
    // surfaces 404 (NOT 403) BEFORE the host-only authority check
    // fires, regardless of whether the row exists.
    //
    // Compare strategy: Alice (the authenticated caller) attempts to
    // toggle privacy on (a) Ben's private session — invisible to Alice
    // by the visibility predicate — and (b) a fully-unknown UUID. Both
    // responses must be byte-equal modulo no per-request varying
    // fields (the canonical error envelope is just `{ error: { code,
    // message } }`).
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_BENS],
      participants: [],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    // A fully-unknown UUID, distinct from PRIVATE_BENS.id.
    const UNKNOWN_ID = '00000000-0000-4000-8000-ffff99999999';

    const resPrivate = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PRIVATE_BENS.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });
    const resUnknown = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${UNKNOWN_ID}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });

    // Status-code parity — both branches must collapse into 404, never
    // 403 (the existence-non-leak rule).
    expect(resPrivate.statusCode).toBe(404);
    expect(resUnknown.statusCode).toBe(404);
    expect(resPrivate.statusCode).toBe(resUnknown.statusCode);

    // error.code + error.message parity, asserted explicitly.
    const bodyPrivate = resPrivate.json<{ error?: { code?: string; message?: string } }>();
    const bodyUnknown = resUnknown.json<{ error?: { code?: string; message?: string } }>();
    expect(bodyPrivate.error?.code).toBe('not-found');
    expect(bodyUnknown.error?.code).toBe('not-found');
    expect(bodyPrivate.error?.code).toBe(bodyUnknown.error?.code);
    expect(bodyPrivate.error?.message).toBe(bodyUnknown.error?.message);

    // Full-body deep-equal — any future addition of a discriminating
    // field on one branch (and not the other) fails here.
    expect(bodyPrivate).toEqual(bodyUnknown);

    // Headers parity for the content-type.
    expect(resPrivate.headers['content-type']).toBe(resUnknown.headers['content-type']);

    // Neither response modified state — Ben's private session stays
    // private; the unknown id never landed anywhere.
    const benSessionAfter = built.store.sessions.find((s) => s.id === PRIVATE_BENS.id);
    expect(benSessionAfter?.privacy).toBe('private');
    expect(built.store.sessions.find((s) => s.id === UNKNOWN_ID)).toBeUndefined();
  });
});

describe('PATCH /sessions/:id/privacy — subscription prune on flip to private (G-001)', () => {
  // Source: docs/security/m3-review/coverage.md G-001
  // Refinement: tasks/refinements/backend-hardening/privacy_flip_subscription_prune.md
  //
  // The handler post-UPDATE prune walks `app.wsSubscriptions.connectionsForSession(sessionId)`,
  // looks up each connection's userId, runs `canSeeSession`, and
  // evicts every subscriber whose user can no longer see the session.
  // Tests below register fake senders on `app.wsConnectionSenders` to
  // collect server-initiated `unsubscribed` envelopes, then assert
  // both the wire shape and the post-prune registry state.

  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const PUBLIC_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff77770001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A public debate that will go private',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-ffff77770002',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'A private debate going public',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };

  // A non-participant stranger.
  const STRANGER_ID = '44444444-4444-4444-8444-444444444444';
  const STRANGER_CONN = '00000000-0000-4000-8000-0000cccc0001';
  const PARTICIPANT_CONN = '00000000-0000-4000-8000-0000cccc0002';

  it('evicts a non-participant stranger when the host flips public to private (sends unsubscribed envelope + registry pruned)', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: STRANGER_ID,
          oauth_subject: 'authelia:stranger',
          screen_name: 'stranger',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      participants: [],
    });

    // Pre-populate the subscription registry: the stranger was
    // subscribed while the session was still public. The userId
    // binding is the production three-arg shape.
    built.app.wsSubscriptions.subscribe(STRANGER_CONN, PUBLIC_ACTIVE.id, STRANGER_ID);
    // Register a sender that captures the envelopes the prune helper
    // sends.
    const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
    built.app.wsConnectionSenders.register(STRANGER_CONN, (env) => {
      // Read the payload as a plain record — every WsEnvelopeUnion
      // payload is an object literal of `string -> unknown` for these
      // assertion purposes; the discriminator (`env.type`) carries the
      // structural identity.
      sent.push({ type: env.type, payload: { ...env.payload } });
    });

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(200);

    // The stranger's registry entry is gone.
    expect(built.app.wsSubscriptions.connectionsForSession(PUBLIC_ACTIVE.id)).toEqual([]);

    // The stranger's sender received exactly one `unsubscribed`
    // envelope with `reason: 'privacy-flipped'`. The inResponseTo
    // field is absent (this is server-initiated, not an ack).
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('unsubscribed');
    expect(sent[0]?.payload['sessionId']).toBe(PUBLIC_ACTIVE.id);
    expect(sent[0]?.payload['reason']).toBe('privacy-flipped');
  });

  it('keeps a participant subscribed when the host flips public to private', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
      // Ben is a participant — `canSeeSession` returns true for him
      // regardless of privacy.
      participants: [{ session_id: PUBLIC_ACTIVE.id, user_id: BEN_ID }],
    });
    built.app.wsSubscriptions.subscribe(PARTICIPANT_CONN, PUBLIC_ACTIVE.id, BEN_ID);
    const sent: Array<{ type: string }> = [];
    built.app.wsConnectionSenders.register(PARTICIPANT_CONN, (env) => {
      sent.push({ type: env.type });
    });

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(200);

    // Ben (participant) is still subscribed.
    expect(built.app.wsSubscriptions.connectionsForSession(PUBLIC_ACTIVE.id)).toEqual([
      PARTICIPANT_CONN,
    ]);
    // No server-initiated frame was sent to Ben.
    expect(sent).toEqual([]);
  });

  it('is a no-op for pruning when the host flips private to public (visibility widens, nobody loses access)', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
        {
          id: BEN_ID,
          oauth_subject: 'authelia:ben',
          screen_name: 'ben',
          deleted_at: null,
        },
      ],
      sessions: [PRIVATE_ACTIVE],
      participants: [{ session_id: PRIVATE_ACTIVE.id, user_id: BEN_ID }],
    });
    // Both Alice (host) and Ben (participant) are subscribed.
    built.app.wsSubscriptions.subscribe(PARTICIPANT_CONN, PRIVATE_ACTIVE.id, BEN_ID);
    const sent: Array<{ type: string }> = [];
    built.app.wsConnectionSenders.register(PARTICIPANT_CONN, (env) => {
      sent.push({ type: env.type });
    });

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PRIVATE_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'public' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ privacy?: string }>().privacy).toBe('public');

    // Registry untouched — flip to public skips the pruner entirely.
    expect(built.app.wsSubscriptions.connectionsForSession(PRIVATE_ACTIVE.id)).toEqual([
      PARTICIPANT_CONN,
    ]);
    // No envelopes sent — the pruner doesn't run on a public-flip.
    expect(sent).toEqual([]);
  });

  it('is a no-op when public-to-private flips a session with zero subscribers (empty walk does not crash)', async () => {
    built = await buildWithSeed({
      users: [
        {
          id: ALICE_ID,
          oauth_subject: 'authelia:alice',
          screen_name: 'alice',
          deleted_at: null,
        },
      ],
      sessions: [PUBLIC_ACTIVE],
    });
    // No subscriptions, no senders. The pruner's empty-walk path is
    // exercised — the test asserts the handler still returns 200 and
    // the row's privacy did flip.

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'PATCH',
      url: `/api/sessions/${PUBLIC_ACTIVE.id}/privacy`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { privacy: 'private' },
    });
    expect(response.statusCode).toBe(200);
    const sessionAfter = built.store.sessions.find((s) => s.id === PUBLIC_ACTIVE.id);
    expect(sessionAfter?.privacy).toBe('private');
  });
});

// =============================================================
// POST /sessions/:id/participants — host-only debater assignment
// + DELETE /sessions/:id/participants/:userId — host or self removal
// =============================================================
//
// Refinement: tasks/refinements/backend/participant_assignment.md.
//
// Coverage (12 cases):
//   POST cases:
//     1. Host assigns debater-A → 200 + new participants row + event
//        at next sequence.
//     2. Body role='moderator' → 400 (schema enum rejection).
//     3. Role already filled → 409 role-already-filled.
//     4. User already an active participant → 409 user-already-joined.
//     5. Non-host caller → 403 not-a-moderator (no writes; ROLLBACK).
//     6. Unknown userId → 404 user-not-found.
//     7. Ended session → 409 session-already-ended.
//   DELETE cases:
//     8. Host removes a debater → 200 + UPDATE left_at + event.
//     9. Participant removes themselves → 200.
//    10. Non-host non-self caller → 403 not-a-moderator.
//    11. Host tries to remove themselves (moderator) → 403
//        cannot-remove-moderator (the host is bound to the session
//        for its lifetime; the refinement chose 403 as the
//        authority-failure mapping).
//    12. User not currently in session → 404 not-found.

describe('POST /sessions/:id/participants — host-only debater assignment', () => {
  // Seed helper — same shape as the sibling suites; adds optional
  // pre-existing participant rows so the conflict scenarios (role
  // already filled / user already an active participant) can start
  // from a populated table.
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Reusable fixtures — Alice is the host (and the implicit moderator
  // from the create-session amendment); Ben is the user being invited
  // to a debater seat; Carol is a third party for the "two debaters
  // already assigned" scenario.
  const CAROL_ID = '33333333-3333-4333-8333-333333333333';

  const SESSION_ID = '00000000-0000-4000-8000-1111pppp0001'.replace('pppp', 'aaaa');
  const PUBLIC_ACTIVE: SessionRow = {
    id: SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-1111aaaa0002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'An ended debate',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };

  // The host's pre-existing moderator participant + session-created
  // and participant-joined events. Mirrors what the create-session
  // transaction would have produced (post-amendment).
  const MODERATOR_PARTICIPANT: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-100000000001',
    session_id: SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T10:00:00.001Z'),
    left_at: null,
  };
  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '99999999-9999-4999-8999-999999999001',
    session_id: SESSION_ID,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A debate',
      created_at: '2026-05-09T10:00:00.000Z',
    },
    created_at: new Date('2026-05-09T10:00:00.001Z'),
  };
  const PARTICIPANT_JOINED_EVENT: SessionEventRow = {
    id: '99999999-9999-4999-8999-999999999002',
    session_id: SESSION_ID,
    sequence: 2,
    kind: 'participant-joined',
    actor: ALICE_ID,
    payload: {
      user_id: ALICE_ID,
      role: 'moderator',
      screen_name: 'alice',
      joined_at: '2026-05-09T10:00:00.001Z',
    },
    created_at: new Date('2026-05-09T10:00:00.002Z'),
  };

  function aliceBenSeed(): {
    users: UserRow[];
    sessions: SessionRow[];
    participants: SessionParticipantRow[];
    events: SessionEventRow[];
  } {
    return {
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PUBLIC_ACTIVE],
      participants: [MODERATOR_PARTICIPANT],
      events: [SESSION_CREATED_EVENT, PARTICIPANT_JOINED_EVENT],
    };
  }

  it('returns 200 + new participant row + participant-joined event when the host assigns debater-A', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: BEN_ID, role: 'debater-A' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      sessionId?: string;
      userId?: string;
      role?: string;
      joinedAt?: string;
      leftAt?: string | null;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.userId).toBe(BEN_ID);
    expect(body.role).toBe('debater-A');
    expect(typeof body.joinedAt).toBe('string');
    expect(body.leftAt).toBeNull();

    // Two participants now in the session: Alice as moderator + Ben as
    // debater-A.
    const activeParticipants = built.store.participants.filter(
      (p) => p.session_id === SESSION_ID && (p.left_at === null || p.left_at === undefined),
    );
    expect(activeParticipants).toHaveLength(2);
    const benRow = activeParticipants.find((p) => p.user_id === BEN_ID);
    expect(benRow?.role).toBe('debater-A');

    // The participant-joined event lands at sequence=3 (sequence=1 is
    // session-created, sequence=2 is the host's participant-joined from
    // the create-session amendment).
    const benJoinedEvent = built.store.events.find(
      (e) => e.kind === 'participant-joined' && e.payload?.['user_id'] === BEN_ID,
    );
    expect(benJoinedEvent).toBeDefined();
    expect(benJoinedEvent?.sequence).toBe(3);
    expect(benJoinedEvent?.actor).toBe(ALICE_ID);
    const payload = benJoinedEvent?.payload as Record<string, unknown>;
    expect(payload['role']).toBe('debater-A');
    expect(payload['screen_name']).toBe('ben');
    expect(typeof payload['joined_at']).toBe('string');

    // Transaction shape — no ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 400 validation-failed when the body role is "moderator"', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: BEN_ID, role: 'moderator' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');

    // No new participant rows or events landed.
    expect(built.store.participants.filter((p) => p.user_id === BEN_ID)).toHaveLength(0);
  });

  it('returns 409 role-already-filled when debater-A is already taken by another active user', async () => {
    const seed = aliceBenSeed();
    // Carol already holds debater-A.
    seed.users.push({
      id: CAROL_ID,
      oauth_subject: 'authelia:carol',
      screen_name: 'carol',
      deleted_at: null,
    });
    seed.participants.push({
      id: '00000000-0000-4000-9000-100000000002',
      session_id: SESSION_ID,
      user_id: CAROL_ID,
      role: 'debater-A',
      joined_at: new Date('2026-05-09T10:00:01.000Z'),
      left_at: null,
    });
    built = await buildWithSeed(seed);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: BEN_ID, role: 'debater-A' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('role-already-filled');

    // Ben was NOT inserted; transaction rolled back.
    expect(built.store.participants.filter((p) => p.user_id === BEN_ID)).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 user-already-joined when the user is already an active participant', async () => {
    const seed = aliceBenSeed();
    // Ben already holds debater-A; the new attempt would assign him
    // debater-B — same session, different role; the partial unique
    // user index forbids two active rows for the same user.
    seed.participants.push({
      id: '00000000-0000-4000-9000-100000000003',
      session_id: SESSION_ID,
      user_id: BEN_ID,
      role: 'debater-A',
      joined_at: new Date('2026-05-09T10:00:01.000Z'),
      left_at: null,
    });
    built = await buildWithSeed(seed);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: BEN_ID, role: 'debater-B' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('user-already-joined');

    // No new row; transaction rolled back.
    expect(
      built.store.participants.filter((p) => p.user_id === BEN_ID && p.role === 'debater-B'),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 403 not-a-moderator when a non-host caller tries to assign a participant', async () => {
    built = await buildWithSeed(aliceBenSeed());
    // Ben is visible (it's a public session) but is NOT the host —
    // 403 fires.
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: CAROL_ID, role: 'debater-A' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 user-not-found when the body userId does not resolve to a non-deleted users row', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownUserId = '00000000-0000-4000-8000-ffffffff0099';
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: unknownUserId, role: 'debater-A' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('user-not-found');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 session-already-ended when the session has ended', async () => {
    const seed = aliceBenSeed();
    seed.sessions.push(PUBLIC_ENDED);
    built = await buildWithSeed(seed);

    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ENDED.id}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { userId: BEN_ID, role: 'debater-A' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');
    expect(built.store.trace).toContain('ROLLBACK');
  });
});

describe('DELETE /sessions/:id/participants/:userId — host or self removal', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const SESSION_ID = '00000000-0000-4000-8000-2222aaaa0001';
  const PUBLIC_ACTIVE: SessionRow = {
    id: SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const MODERATOR_PARTICIPANT: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-200000000001',
    session_id: SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T10:00:00.001Z'),
    left_at: null,
  };
  const BEN_DEBATER: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-200000000002',
    session_id: SESSION_ID,
    user_id: BEN_ID,
    role: 'debater-A',
    joined_at: new Date('2026-05-09T10:00:01.000Z'),
    left_at: null,
  };
  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '88888888-8888-4888-8888-888888888001',
    session_id: SESSION_ID,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A debate',
      created_at: '2026-05-09T10:00:00.000Z',
    },
    created_at: new Date('2026-05-09T10:00:00.001Z'),
  };
  const HOST_JOINED_EVENT: SessionEventRow = {
    id: '88888888-8888-4888-8888-888888888002',
    session_id: SESSION_ID,
    sequence: 2,
    kind: 'participant-joined',
    actor: ALICE_ID,
    payload: {
      user_id: ALICE_ID,
      role: 'moderator',
      screen_name: 'alice',
      joined_at: '2026-05-09T10:00:00.001Z',
    },
    created_at: new Date('2026-05-09T10:00:00.002Z'),
  };
  const BEN_JOINED_EVENT: SessionEventRow = {
    id: '88888888-8888-4888-8888-888888888003',
    session_id: SESSION_ID,
    sequence: 3,
    kind: 'participant-joined',
    actor: ALICE_ID,
    payload: {
      user_id: BEN_ID,
      role: 'debater-A',
      screen_name: 'ben',
      joined_at: '2026-05-09T10:00:01.000Z',
    },
    created_at: new Date('2026-05-09T10:00:01.001Z'),
  };

  function aliceBenSeed(): {
    users: UserRow[];
    sessions: SessionRow[];
    participants: SessionParticipantRow[];
    events: SessionEventRow[];
  } {
    return {
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PUBLIC_ACTIVE],
      participants: [MODERATOR_PARTICIPANT, BEN_DEBATER],
      events: [SESSION_CREATED_EVENT, HOST_JOINED_EVENT, BEN_JOINED_EVENT],
    };
  }

  it('returns 200 + the updated participant row with leftAt set when the host removes a debater', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'DELETE',
      url: `/api/sessions/${SESSION_ID}/participants/${BEN_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      userId?: string;
      role?: string;
      leftAt?: string | null;
    }>();
    expect(body.userId).toBe(BEN_ID);
    expect(body.role).toBe('debater-A');
    expect(typeof body.leftAt).toBe('string');

    // The row's left_at is non-null in the in-memory store.
    const benRow = built.store.participants.find(
      (p) => p.session_id === SESSION_ID && p.user_id === BEN_ID,
    );
    expect(benRow?.left_at).not.toBeNull();

    // A participant-left event landed at sequence=4 (sequence=3 was
    // Ben's join).
    const leftEvent = built.store.events.find((e) => e.kind === 'participant-left');
    expect(leftEvent?.sequence).toBe(4);
    expect(leftEvent?.actor).toBe(ALICE_ID);
    const payload = leftEvent?.payload as Record<string, unknown>;
    expect(payload['user_id']).toBe(BEN_ID);
    expect(typeof payload['left_at']).toBe('string');

    // Transaction shape — no ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 200 when the participant removes themselves', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'DELETE',
      url: `/api/sessions/${SESSION_ID}/participants/${BEN_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId?: string; leftAt?: string | null }>();
    expect(body.userId).toBe(BEN_ID);
    expect(typeof body.leftAt).toBe('string');

    const benRow = built.store.participants.find(
      (p) => p.session_id === SESSION_ID && p.user_id === BEN_ID,
    );
    expect(benRow?.left_at).not.toBeNull();

    // The actor on the event is the participant themselves (Ben), not
    // the host.
    const leftEvent = built.store.events.find((e) => e.kind === 'participant-left');
    expect(leftEvent?.actor).toBe(BEN_ID);
  });

  it('returns 403 not-a-moderator when a non-host non-self caller tries to remove a participant', async () => {
    // Carol is a third user, not the host, not the target. She can
    // see the public session but cannot eject Ben.
    const CAROL_ID = '33333333-3333-4333-8333-333333333333';
    const seed = aliceBenSeed();
    seed.users.push({
      id: CAROL_ID,
      oauth_subject: 'authelia:carol',
      screen_name: 'carol',
      deleted_at: null,
    });
    built = await buildWithSeed(seed);

    const token = await signSessionToken({ sub: CAROL_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'DELETE',
      url: `/api/sessions/${SESSION_ID}/participants/${BEN_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');

    // Ben's row is unchanged.
    const benRow = built.store.participants.find((p) => p.user_id === BEN_ID);
    expect(benRow?.left_at ?? null).toBeNull();
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 403 cannot-remove-moderator when the host tries to remove themselves', async () => {
    // The host IS the moderator at v1; this endpoint cannot eject
    // them. Refinement decision: 403 (authority failure), not 422.
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'DELETE',
      url: `/api/sessions/${SESSION_ID}/participants/${ALICE_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('cannot-remove-moderator');

    // The moderator row is unchanged.
    const modRow = built.store.participants.find(
      (p) => p.session_id === SESSION_ID && p.role === 'moderator',
    );
    expect(modRow?.left_at ?? null).toBeNull();
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 not-found when the user is not currently a participant', async () => {
    // Carol exists as a user but is not a participant.
    const CAROL_ID = '33333333-3333-4333-8333-333333333333';
    const seed = aliceBenSeed();
    seed.users.push({
      id: CAROL_ID,
      oauth_subject: 'authelia:carol',
      screen_name: 'carol',
      deleted_at: null,
    });
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'DELETE',
      url: `/api/sessions/${SESSION_ID}/participants/${CAROL_ID}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
    expect(built.store.trace).toContain('ROLLBACK');
  });
});

// =============================================================
// POST /sessions/:id/invite/claim — debater self-claims a slot
// =============================================================
//
// Refinement: tasks/refinements/backend/session_invite_self_claim_endpoint.md.
//
// Coverage (11 cases):
//   1. Authenticated + visible public session + valid debater-A role
//      → 200 + SessionParticipantResponse with userId === caller.id
//      and role === 'debater-A'; the participant-joined event lands at
//      the next sequence with actor === caller.id.
//   2. No auth cookie → 401 auth-required.
//   3. Unknown id → 404 not-found.
//   4. Private session NOT visible to caller → 404 not-found (existence-
//      non-leak: identical envelope to unknown-id).
//   5. Private session VISIBLE to caller as a historical participant
//      → 200 (re-join succeeds via F5 — old row's left_at is set, so
//      both partial unique indexes are released).
//   6. Host attempts to self-claim a debater slot → 403 not-a-moderator.
//   7. Ended session → 409 session-already-ended.
//   8. Role already filled by another debater → 409 role-already-filled.
//   9. Caller already holds the OTHER debater slot (active) → 409
//      user-already-joined.
//  10. Body shape errors (3 sub-assertions): missing role / body
//      includes userId / role is 'moderator' → 400 validation-failed.
//  11. Non-UUID path param → 400 validation-failed.

describe('POST /sessions/:id/invite/claim — debater self-claims a slot', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Reusable fixtures — Alice is the host (the implicit moderator from
  // the create-session amendment); Ben is the debater self-claiming a
  // slot; Carol is a third party for "role already filled by someone
  // else" scenarios.
  const CAROL_ID = '33333333-3333-4333-8333-333333333333';

  const SESSION_ID = '00000000-0000-4000-8000-3333aaaa0001';
  const PUBLIC_ACTIVE: SessionRow = {
    id: SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A claimable debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-3333aaaa0002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'An ended debate',
    created_at: new Date('2026-05-08T10:00:00.000Z'),
    ended_at: new Date('2026-05-08T11:00:00.000Z'),
  };
  const PRIVATE_ACTIVE: SessionRow = {
    id: '00000000-0000-4000-8000-3333aaaa0003',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'A private debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };

  // The host's pre-existing moderator participant + the create-session
  // events. Mirrors what the create-session transaction would produce.
  const MODERATOR_PARTICIPANT: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000001',
    session_id: SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T10:00:00.001Z'),
    left_at: null,
  };
  const SESSION_CREATED_EVENT: SessionEventRow = {
    id: '77777777-7777-4777-8777-777777777001',
    session_id: SESSION_ID,
    sequence: 1,
    kind: 'session-created',
    actor: ALICE_ID,
    payload: {
      host_user_id: ALICE_ID,
      privacy: 'public',
      topic: 'A claimable debate',
      created_at: '2026-05-09T10:00:00.000Z',
    },
    created_at: new Date('2026-05-09T10:00:00.001Z'),
  };
  const MODERATOR_JOINED_EVENT: SessionEventRow = {
    id: '77777777-7777-4777-8777-777777777002',
    session_id: SESSION_ID,
    sequence: 2,
    kind: 'participant-joined',
    actor: ALICE_ID,
    payload: {
      user_id: ALICE_ID,
      role: 'moderator',
      screen_name: 'alice',
      joined_at: '2026-05-09T10:00:00.001Z',
    },
    created_at: new Date('2026-05-09T10:00:00.002Z'),
  };

  function aliceBenSeed(): {
    users: UserRow[];
    sessions: SessionRow[];
    participants: SessionParticipantRow[];
    events: SessionEventRow[];
  } {
    return {
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PUBLIC_ACTIVE],
      participants: [MODERATOR_PARTICIPANT],
      events: [SESSION_CREATED_EVENT, MODERATOR_JOINED_EVENT],
    };
  }

  it('returns 200 + the new participant row + a participant-joined event when an authenticated debater claims debater-A on a visible public session', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      id?: string;
      sessionId?: string;
      userId?: string;
      role?: string;
      joinedAt?: string;
      leftAt?: string | null;
    }>();
    expect(typeof body.id).toBe('string');
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.userId).toBe(BEN_ID);
    expect(body.role).toBe('debater-A');
    expect(typeof body.joinedAt).toBe('string');
    expect(body.leftAt).toBeNull();

    // The new active row landed for Ben.
    const benRow = built.store.participants.find(
      (p) =>
        p.session_id === SESSION_ID &&
        p.user_id === BEN_ID &&
        (p.left_at === null || p.left_at === undefined),
    );
    expect(benRow?.role).toBe('debater-A');

    // The participant-joined event lands at sequence=3 with the
    // caller (Ben) as the actor — ADR 0021's self-action shape.
    const benJoinedEvent = built.store.events.find(
      (e) => e.kind === 'participant-joined' && e.payload?.['user_id'] === BEN_ID,
    );
    expect(benJoinedEvent).toBeDefined();
    expect(benJoinedEvent?.sequence).toBe(3);
    expect(benJoinedEvent?.actor).toBe(BEN_ID);
    const payload = benJoinedEvent?.payload as Record<string, unknown>;
    expect(payload['role']).toBe('debater-A');
    expect(payload['screen_name']).toBe('ben');
    expect(typeof payload['joined_at']).toBe('string');

    // Transaction shape — no ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 401 auth-required when no session cookie is supplied', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
    // No participant row landed.
    expect(built.store.participants.filter((p) => p.user_id === BEN_ID)).toHaveLength(0);
  });

  it('returns 404 not-found when the session id is unknown', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-ffffffff0099';
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${unknownId}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 404 not-found when a private session is not visible to the caller (existence-non-leak)', async () => {
    const seed = aliceBenSeed();
    // Add the private session and its host moderator row (so the
    // session exists in the store) but DO NOT make Ben a participant —
    // he can't see it.
    seed.sessions = [PRIVATE_ACTIVE];
    seed.participants = [
      {
        id: '00000000-0000-4000-9000-300000000010',
        session_id: PRIVATE_ACTIVE.id,
        user_id: ALICE_ID,
        role: 'moderator',
        joined_at: new Date('2026-05-09T10:00:00.001Z'),
        left_at: null,
      },
    ];
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PRIVATE_ACTIVE.id}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
    // No new row landed.
    expect(
      built.store.participants.filter(
        (p) => p.session_id === PRIVATE_ACTIVE.id && p.user_id === BEN_ID,
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 200 when the caller is a historical participant on a private session (F5 re-join via fresh row)', async () => {
    const seed = aliceBenSeed();
    // Private session; Ben WAS a participant (left_at set) so he can
    // still see it via the visibility predicate — and per F5 he can
    // self-claim again via a fresh INSERT.
    seed.sessions = [PRIVATE_ACTIVE];
    seed.participants = [
      {
        id: '00000000-0000-4000-9000-300000000020',
        session_id: PRIVATE_ACTIVE.id,
        user_id: ALICE_ID,
        role: 'moderator',
        joined_at: new Date('2026-05-09T10:00:00.001Z'),
        left_at: null,
      },
      {
        id: '00000000-0000-4000-9000-300000000021',
        session_id: PRIVATE_ACTIVE.id,
        user_id: BEN_ID,
        role: 'debater-A',
        joined_at: new Date('2026-05-09T10:00:01.000Z'),
        left_at: new Date('2026-05-09T10:00:05.000Z'),
      },
    ];
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PRIVATE_ACTIVE.id}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ userId?: string; role?: string; leftAt?: string | null }>();
    expect(body.userId).toBe(BEN_ID);
    expect(body.role).toBe('debater-A');
    expect(body.leftAt).toBeNull();

    // Both rows exist — the historical row (left_at set) plus the
    // fresh active row.
    const benRows = built.store.participants.filter(
      (p) => p.session_id === PRIVATE_ACTIVE.id && p.user_id === BEN_ID,
    );
    expect(benRows.length).toBeGreaterThanOrEqual(2);
    const activeBenRow = benRows.find((p) => p.left_at === null || p.left_at === undefined);
    expect(activeBenRow).toBeDefined();
  });

  it('returns 403 not-a-moderator when the host attempts to self-claim a debater slot', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-moderator');
    // The host gained no debater row.
    expect(
      built.store.participants.filter(
        (p) =>
          p.session_id === SESSION_ID &&
          p.user_id === ALICE_ID &&
          (p.role === 'debater-A' || p.role === 'debater-B'),
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 session-already-ended when the session has ended', async () => {
    const seed = aliceBenSeed();
    seed.sessions.push(PUBLIC_ENDED);
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${PUBLIC_ENDED.id}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 role-already-filled when another debater holds the requested role', async () => {
    const seed = aliceBenSeed();
    seed.users.push({
      id: CAROL_ID,
      oauth_subject: 'authelia:carol',
      screen_name: 'carol',
      deleted_at: null,
    });
    seed.participants.push({
      id: '00000000-0000-4000-9000-300000000030',
      session_id: SESSION_ID,
      user_id: CAROL_ID,
      role: 'debater-A',
      joined_at: new Date('2026-05-09T10:00:01.000Z'),
      left_at: null,
    });
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('role-already-filled');
    expect(built.store.participants.filter((p) => p.user_id === BEN_ID)).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 user-already-joined when the caller already holds an active role in this session', async () => {
    const seed = aliceBenSeed();
    // Ben already holds debater-A (active); his attempt to claim
    // debater-B trips the user-availability pre-check.
    seed.participants.push({
      id: '00000000-0000-4000-9000-300000000040',
      session_id: SESSION_ID,
      user_id: BEN_ID,
      role: 'debater-A',
      joined_at: new Date('2026-05-09T10:00:01.000Z'),
      left_at: null,
    });
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-B' },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('user-already-joined');
    // No new debater-B row landed.
    expect(
      built.store.participants.filter((p) => p.user_id === BEN_ID && p.role === 'debater-B'),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 400 validation-failed for malformed bodies (missing role / role=moderator) and silently strips smuggled userId fields', async () => {
    // Three sub-assertions on the body schema's failure modes:
    //   1. Body missing `role` → 400 validation-failed (Ajv required-
    //      property check).
    //   2. Body with `role: 'moderator'` → 400 validation-failed (Ajv
    //      enum-violation check).
    //   3. Body with a smuggled `userId` field → the platform's
    //      Fastify-Ajv default is `removeAdditional: true`
    //      (`@fastify/ajv-compiler`'s default), so unknown fields are
    //      stripped silently rather than rejected. The
    //      `additionalProperties: false` declaration on
    //      `selfClaimParticipantBodySchema` documents intent at the
    //      schema layer; the actual security property (the caller
    //      cannot smuggle another user's id) is enforced by the
    //      handler always using `request.authUser.id` (never the body).
    //      We pin this by asserting that a request with a smuggled
    //      `userId` still succeeds — and the resulting row's `userId`
    //      is the CALLER's id (BEN), NOT the smuggled value (ALICE).
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);

    // Sub-assertion 1: body missing role entirely.
    const missing = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Sub-assertion 2: body's role is 'moderator' — outside the enum.
    const mod = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'moderator' },
    });
    expect(mod.statusCode).toBe(400);
    expect(mod.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // No participant row landed for either 400 sub-case.
    expect(built.store.participants.filter((p) => p.user_id === BEN_ID)).toHaveLength(0);

    // Sub-assertion 3: smuggled `userId` is stripped; the caller (Ben)
    // is the one who lands in the participants table, NOT Alice (whose
    // id was smuggled). This pins the security property the schema's
    // `additionalProperties: false` documents — the caller can never
    // claim a slot on behalf of another user via this endpoint.
    const smuggled = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A', userId: ALICE_ID },
    });
    expect(smuggled.statusCode).toBe(200);
    const smuggledBody = smuggled.json<{ userId?: string }>();
    expect(smuggledBody.userId).toBe(BEN_ID);
    // Confirm the inserted row carries Ben's id (caller), not Alice's
    // (the smuggled value).
    const benRow = built.store.participants.find(
      (p) =>
        p.session_id === SESSION_ID &&
        p.user_id === BEN_ID &&
        p.role === 'debater-A' &&
        (p.left_at === null || p.left_at === undefined),
    );
    expect(benRow).toBeDefined();
    // No row landed for Alice as a debater (she remains only as the
    // implicit moderator from the seed).
    expect(
      built.store.participants.filter(
        (p) =>
          p.session_id === SESSION_ID &&
          p.user_id === ALICE_ID &&
          (p.role === 'debater-A' || p.role === 'debater-B'),
      ),
    ).toHaveLength(0);
  });

  it('returns 400 validation-failed when the :id path param is not a UUID', async () => {
    built = await buildWithSeed(aliceBenSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/not-a-uuid/invite/claim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { role: 'debater-A' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

// =============================================================
// GET /sessions/:id/participants — list a session's participants
// =============================================================
//
// Refinement: tasks/refinements/backend/list_session_participants_endpoint.md.
//
// Coverage (6 cases):
//   1. Authenticated + visible public session → 200 + array including
//      the implicit-moderator row.
//   2. No auth cookie → 401 auth-required.
//   3. Unknown id → 404 not-found.
//   4. Private session NOT visible to caller → 404 not-found
//      (existence-non-leak: same envelope as unknown-id).
//   5. Private session visible to a non-host participant → 200 + array
//      containing that participant's row.
//   6. Non-UUID path param → 400 validation-failed.

describe('GET /sessions/:id/participants — list a session participants', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Fixed UUIDs for the seeded fixtures. Distinct from sibling-suite
  // ids so a stray cross-suite reference fails loudly.
  const SESSION_ID = '00000000-0000-4000-8000-3333aaaa0001';
  const PRIVATE_SESSION_ID = '00000000-0000-4000-8000-3333eeee0001';

  const PUBLIC_SESSION: SessionRow = {
    id: SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'A public debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_ALICE: SessionRow = {
    id: PRIVATE_SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: "Alice's private debate",
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    ended_at: null,
  };

  // Implicit-moderator row Alice gets at session creation.
  const ALICE_MODERATOR: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000001',
    session_id: SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T10:00:00.001Z'),
    left_at: null,
  };
  const BEN_DEBATER: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000002',
    session_id: SESSION_ID,
    user_id: BEN_ID,
    role: 'debater-A',
    joined_at: new Date('2026-05-09T10:00:01.000Z'),
    left_at: null,
  };
  const ALICE_MODERATOR_PRIVATE: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000003',
    session_id: PRIVATE_SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T11:00:00.001Z'),
    left_at: null,
  };
  const BEN_DEBATER_PRIVATE: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000004',
    session_id: PRIVATE_SESSION_ID,
    user_id: BEN_ID,
    role: 'debater-A',
    joined_at: new Date('2026-05-09T11:00:01.000Z'),
    left_at: null,
  };

  it('returns 200 + the participants list including the implicit-moderator row for an authenticated visible session', async () => {
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PUBLIC_SESSION],
      // Two rows: the implicit moderator (Alice) and a debater (Ben).
      // Both rows are active (`leftAt: null`).
      participants: [ALICE_MODERATOR, BEN_DEBATER],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      participants?: Array<{
        id?: string;
        sessionId?: string;
        userId?: string;
        role?: string;
        joinedAt?: string;
        leftAt?: string | null;
      }>;
    }>();
    expect(Array.isArray(body.participants)).toBe(true);
    expect(body.participants).toHaveLength(2);
    // Ordering: joined_at ASC → moderator (Alice) first, then debater
    // (Ben). The implicit-moderator-first invariant is pinned here.
    const [first, second] = body.participants ?? [];
    expect(first?.userId).toBe(ALICE_ID);
    expect(first?.role).toBe('moderator');
    expect(first?.sessionId).toBe(SESSION_ID);
    expect(typeof first?.joinedAt).toBe('string');
    expect(first?.leftAt).toBeNull();
    expect(second?.userId).toBe(BEN_ID);
    expect(second?.role).toBe('debater-A');
    expect(second?.leftAt).toBeNull();
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
      ],
      sessions: [PUBLIC_SESSION],
      participants: [ALICE_MODERATOR],
    });
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}/participants`,
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });

  it('returns 404 not-found when the session id does not exist', async () => {
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
      ],
      sessions: [], // no sessions seeded
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const unknownId = '00000000-0000-4000-8000-3333ffff0099';
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${unknownId}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 404 (NOT 403) when the session is private and the caller is not host/participant', async () => {
    // Existence-non-leak: Ben must not be able to tell whether Alice's
    // private session exists. The response is 404, identical to the
    // unknown-id case above.
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PRIVATE_ALICE],
      // Ben is NOT seeded as a participant — the private session is
      // invisible to him.
      participants: [ALICE_MODERATOR_PRIVATE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    // CRITICAL — 404, not 403. Asserting the exact status here is the
    // load-bearing test for the existence-leak rule (mirrors the
    // `GET /sessions/:id` 404-not-403 invariant).
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
  });

  it('returns 200 + participants array for a non-host participant on a private session they are part of', async () => {
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PRIVATE_ALICE],
      // Ben is a participant — the private session is visible to him.
      participants: [ALICE_MODERATOR_PRIVATE, BEN_DEBATER_PRIVATE],
    });
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: `/api/sessions/${PRIVATE_SESSION_ID}/participants`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      participants?: Array<{ userId?: string; role?: string }>;
    }>();
    expect(body.participants).toHaveLength(2);
    // Ben (the caller) is included; no scrubbing of the host's userId
    // for non-host viewers.
    const benRow = body.participants?.find((p) => p.userId === BEN_ID);
    expect(benRow?.role).toBe('debater-A');
    const aliceRow = body.participants?.find((p) => p.userId === ALICE_ID);
    expect(aliceRow?.role).toBe('moderator');
  });

  it('returns 400 validation-failed when the path :id is not a UUID', async () => {
    built = await buildWithSeed({
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
      ],
      sessions: [PUBLIC_SESSION],
      participants: [ALICE_MODERATOR],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/not-a-uuid/participants',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('validation-failed');
  });
});

// =============================================================
// POST /sessions/:id/include — cross-session entity inclusion
// =============================================================
//
// Refinement: tasks/refinements/backend/entity_inclusion_endpoint.md.
//
// Coverage (8 cases):
//   1. Success — node: 200 + join row + entity-included event.
//   2. Success — edge: 200 + join row + entity-included event.
//   3. Success — annotation: 200 + join row + entity-included event.
//   4. Destination invisible (private + caller is not host/participant)
//      → 404 not-found (existence-non-leak).
//   5. Destination visible but caller is NOT an active participant
//      → 403 not-a-participant.
//   6. Destination is ended → 409 session-already-ended.
//   7. Entity unreachable to caller (source is a private session
//      caller can't see) → 403 entity-not-referenceable.
//   8. Entity already included in destination → 409
//      entity-already-included (composite-PK ON CONFLICT collapse).
//   9. Bad body / bad UUID → 400 validation-failed.
//  10. No auth cookie → 401 auth-required.

describe('POST /sessions/:id/include — cross-session entity inclusion', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
    sessionNodes?: InclusionRow[];
    sessionEdges?: InclusionRow[];
    sessionAnnotations?: InclusionRow[];
    events?: SessionEventRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    if (opts.sessionNodes !== undefined) {
      built.store.sessionNodes.push(...opts.sessionNodes);
    }
    if (opts.sessionEdges !== undefined) {
      built.store.sessionEdges.push(...opts.sessionEdges);
    }
    if (opts.sessionAnnotations !== undefined) {
      built.store.sessionAnnotations.push(...opts.sessionAnnotations);
    }
    if (opts.events !== undefined) {
      built.store.events.push(...opts.events);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  // Two sessions: a public SOURCE (where the entity lives) and a
  // public DESTINATION (where the entity is being included). Alice
  // hosts both; she's an active participant of the destination (per
  // the participant-assignment Option-A amendment her moderator row
  // is implicit at session creation, but the test seeds it
  // explicitly).
  const SOURCE_SESSION_ID = '00000000-0000-4000-8000-3333aaaa0001';
  const DESTINATION_SESSION_ID = '00000000-0000-4000-8000-3333aaaa0002';
  const PRIVATE_SOURCE_SESSION_ID = '00000000-0000-4000-8000-3333aaaa0003';
  const ENDED_DESTINATION_SESSION_ID = '00000000-0000-4000-8000-3333aaaa0004';
  const NODE_ID = '00000000-0000-4000-a000-100000000001';
  const EDGE_ID = '00000000-0000-4000-a000-100000000002';
  const ANNOTATION_ID = '00000000-0000-4000-a000-100000000003';
  const PRIVATE_NODE_ID = '00000000-0000-4000-a000-100000000004';

  const PUBLIC_SOURCE: SessionRow = {
    id: SOURCE_SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Source session',
    created_at: new Date('2026-05-09T09:00:00.000Z'),
    ended_at: null,
  };
  const PUBLIC_DESTINATION: SessionRow = {
    id: DESTINATION_SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Destination session',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    ended_at: null,
  };
  const PRIVATE_SOURCE: SessionRow = {
    id: PRIVATE_SOURCE_SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'Private source',
    created_at: new Date('2026-05-09T09:30:00.000Z'),
    ended_at: null,
  };
  const ENDED_DESTINATION: SessionRow = {
    id: ENDED_DESTINATION_SESSION_ID,
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Ended destination',
    created_at: new Date('2026-05-09T08:00:00.000Z'),
    ended_at: new Date('2026-05-09T08:30:00.000Z'),
  };

  const ALICE_MODERATOR_DEST: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000001',
    session_id: DESTINATION_SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T10:00:00.001Z'),
    left_at: null,
  };
  const ALICE_MODERATOR_ENDED_DEST: SessionParticipantRow = {
    id: '00000000-0000-4000-9000-300000000002',
    session_id: ENDED_DESTINATION_SESSION_ID,
    user_id: ALICE_ID,
    role: 'moderator',
    joined_at: new Date('2026-05-09T08:00:00.001Z'),
    left_at: null,
  };

  const NODE_IN_PUBLIC_SOURCE: InclusionRow = {
    session_id: SOURCE_SESSION_ID,
    entity_id: NODE_ID,
    included_by: ALICE_ID,
    included_at: new Date('2026-05-09T09:00:00.500Z'),
  };
  const EDGE_IN_PUBLIC_SOURCE: InclusionRow = {
    session_id: SOURCE_SESSION_ID,
    entity_id: EDGE_ID,
    included_by: ALICE_ID,
    included_at: new Date('2026-05-09T09:00:00.500Z'),
  };
  const ANNOTATION_IN_PUBLIC_SOURCE: InclusionRow = {
    session_id: SOURCE_SESSION_ID,
    entity_id: ANNOTATION_ID,
    included_by: ALICE_ID,
    included_at: new Date('2026-05-09T09:00:00.500Z'),
  };
  const NODE_IN_PRIVATE_SOURCE: InclusionRow = {
    session_id: PRIVATE_SOURCE_SESSION_ID,
    entity_id: PRIVATE_NODE_ID,
    included_by: ALICE_ID,
    included_at: new Date('2026-05-09T09:30:00.500Z'),
  };

  function aliceSeed(
    extra?: Partial<Parameters<typeof buildWithSeed>[0]>,
  ): Parameters<typeof buildWithSeed>[0] {
    return {
      users: [
        { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
        { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
      ],
      sessions: [PUBLIC_SOURCE, PUBLIC_DESTINATION],
      participants: [ALICE_MODERATOR_DEST],
      sessionNodes: [NODE_IN_PUBLIC_SOURCE],
      sessionEdges: [EDGE_IN_PUBLIC_SOURCE],
      sessionAnnotations: [ANNOTATION_IN_PUBLIC_SOURCE],
      ...extra,
    };
  }

  it('returns 200 + join row + entity-included event when the host includes a node', async () => {
    built = await buildWithSeed(aliceSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      entityKind?: string;
      entityId?: string;
      sessionId?: string;
      includedBy?: string;
      includedAt?: string;
    }>();
    expect(body.entityKind).toBe('node');
    expect(body.entityId).toBe(NODE_ID);
    expect(body.sessionId).toBe(DESTINATION_SESSION_ID);
    expect(body.includedBy).toBe(ALICE_ID);
    expect(typeof body.includedAt).toBe('string');

    // Join-table row landed.
    const destNodeRow = built.store.sessionNodes.find(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === NODE_ID,
    );
    expect(destNodeRow).toBeDefined();
    expect(destNodeRow?.included_by).toBe(ALICE_ID);

    // entity-included event landed at the next sequence (no prior
    // events for this destination → sequence=1).
    const inclusionEvent = built.store.events.find(
      (e) => e.kind === 'entity-included' && e.session_id === DESTINATION_SESSION_ID,
    );
    expect(inclusionEvent).toBeDefined();
    expect(inclusionEvent?.sequence).toBe(1);
    expect(inclusionEvent?.actor).toBe(ALICE_ID);
    const payload = inclusionEvent?.payload as Record<string, unknown>;
    expect(payload['entity_kind']).toBe('node');
    expect(payload['entity_id']).toBe(NODE_ID);
    expect(payload['included_by']).toBe(ALICE_ID);
    expect(typeof payload['included_at']).toBe('string');

    // Transaction shape — no ROLLBACK.
    expect(built.store.trace[0]).toBe('BEGIN');
    expect(built.store.trace[built.store.trace.length - 1]).toBe('COMMIT');
    expect(built.store.trace).not.toContain('ROLLBACK');
  });

  it('returns 200 + join row + entity-included event when including an edge', async () => {
    built = await buildWithSeed(aliceSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'edge', entityId: EDGE_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ entityKind?: string; entityId?: string }>();
    expect(body.entityKind).toBe('edge');
    expect(body.entityId).toBe(EDGE_ID);

    // Join-table row landed in session_edges.
    const destEdgeRow = built.store.sessionEdges.find(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === EDGE_ID,
    );
    expect(destEdgeRow).toBeDefined();

    // entity-included event payload's entity_kind is 'edge'.
    const evt = built.store.events.find((e) => e.kind === 'entity-included');
    const payload = evt?.payload as Record<string, unknown>;
    expect(payload['entity_kind']).toBe('edge');
  });

  it('returns 200 + join row + entity-included event when including an annotation', async () => {
    built = await buildWithSeed(aliceSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'annotation', entityId: ANNOTATION_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ entityKind?: string; entityId?: string }>();
    expect(body.entityKind).toBe('annotation');
    expect(body.entityId).toBe(ANNOTATION_ID);

    // Join-table row landed in session_annotations.
    const destAnnotationRow = built.store.sessionAnnotations.find(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === ANNOTATION_ID,
    );
    expect(destAnnotationRow).toBeDefined();

    const evt = built.store.events.find((e) => e.kind === 'entity-included');
    const payload = evt?.payload as Record<string, unknown>;
    expect(payload['entity_kind']).toBe('annotation');
  });

  it('returns 404 not-found when the destination is private and the caller is not host/participant', async () => {
    // Ben is the caller; the destination session is private and Ben
    // is neither host nor participant. The visibility predicate
    // collapses zero-rows → 404 (existence-non-leak). 404, NOT 403.
    const seed = aliceSeed();
    // Mark the destination private and remove Alice's moderator
    // row so Ben (the caller) isn't a participant either.
    seed.sessions = [PUBLIC_SOURCE, { ...PUBLIC_DESTINATION, privacy: 'private' }];
    // Keep ALICE_MODERATOR_DEST so Alice is still a participant of
    // her own private destination — but Ben is the caller, and Ben
    // isn't in `participants`. The visibility predicate fires first.
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(response.statusCode).toBe(404);
    expect(response.statusCode).not.toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-found');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 403 not-a-participant when the destination is visible but the caller is not an active participant', async () => {
    // Ben can SEE the public destination (visibility predicate
    // passes — public sessions are visible to every authenticated
    // user) but is NOT an active participant. The participant check
    // fires with 403 `not-a-participant`.
    built = await buildWithSeed(aliceSeed());
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('not-a-participant');

    // No writes — the destination's join table is unchanged.
    expect(
      built.store.sessionNodes.filter((r) => r.session_id === DESTINATION_SESSION_ID),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 session-already-ended when the destination is ended', async () => {
    const seed = aliceSeed();
    seed.sessions = [PUBLIC_SOURCE, ENDED_DESTINATION];
    seed.participants = [ALICE_MODERATOR_ENDED_DEST];
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${ENDED_DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('session-already-ended');
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 403 entity-not-referenceable when the source is a private session the caller cannot see', async () => {
    // The private node lives only in a private session Ben can't
    // see; Ben IS an active participant of the destination, so the
    // first two gates pass, but the source-side `canReferenceNode`
    // returns false → 403 `entity-not-referenceable`.
    const seed = aliceSeed();
    seed.sessions = [PRIVATE_SOURCE, PUBLIC_DESTINATION];
    seed.sessionNodes = [NODE_IN_PRIVATE_SOURCE];
    // Add Ben as an active participant of the destination so the
    // earlier gates don't fire.
    seed.participants = [
      ALICE_MODERATOR_DEST,
      {
        id: '00000000-0000-4000-9000-300000000099',
        session_id: DESTINATION_SESSION_ID,
        user_id: BEN_ID,
        role: 'debater-A',
        joined_at: new Date('2026-05-09T10:00:01.000Z'),
        left_at: null,
      },
    ];
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: BEN_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: PRIVATE_NODE_ID },
    });
    expect(response.statusCode).toBe(403);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('entity-not-referenceable');

    // No writes — the destination's join table is unchanged.
    expect(
      built.store.sessionNodes.filter(
        (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === PRIVATE_NODE_ID,
      ),
    ).toHaveLength(0);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 409 entity-already-included when the entity is already in the destination', async () => {
    // Seed the destination's join table with the same node id —
    // the `ON CONFLICT DO NOTHING` collapses to zero RETURNING rows
    // and the handler raises 409.
    const seed = aliceSeed();
    seed.sessionNodes = [
      NODE_IN_PUBLIC_SOURCE,
      {
        session_id: DESTINATION_SESSION_ID,
        entity_id: NODE_ID,
        included_by: ALICE_ID,
        included_at: new Date('2026-05-09T10:00:02.000Z'),
      },
    ];
    built = await buildWithSeed(seed);
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('entity-already-included');

    // The destination still has exactly one row for this (session,
    // node) pair — no duplicate was added.
    const matches = built.store.sessionNodes.filter(
      (r) => r.session_id === DESTINATION_SESSION_ID && r.entity_id === NODE_ID,
    );
    expect(matches).toHaveLength(1);
    expect(built.store.trace).toContain('ROLLBACK');
  });

  it('returns 400 validation-failed for a malformed body or bad path UUID', async () => {
    built = await buildWithSeed(aliceSeed());
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);

    // Missing entityId.
    const missing = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Invalid enum.
    const badEnum = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'gizmo', entityId: NODE_ID },
    });
    expect(badEnum.statusCode).toBe(400);
    expect(badEnum.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');

    // Bad UUID in path.
    const badPath = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/not-a-uuid/include`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(badPath.statusCode).toBe(400);
    expect(badPath.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed(aliceSeed());
    const response = await built.app.inject({
      method: 'POST',
      url: `/api/sessions/${DESTINATION_SESSION_ID}/include`,
      payload: { entityKind: 'node', entityId: NODE_ID },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ error?: { code?: string } }>();
    expect(body.error?.code).toBe('auth-required');
  });
});

// ============================================================
// GET /sessions/mine — the membership-scoped, role-annotated list.
//
// Refinement: tasks/refinements/session_discovery/sd_my_sessions_endpoint.md
//
// Covered here (Vitest against the memory pool):
//   1. Maps rows to the camelCase `MySessionResponse` shape — including
//      `startedAt` and the resolved `role` (no unhandled-query 500).
//   2. Membership scope: host role; moderator / debater-A / debater-B
//      participant roles; a non-member session (incl. a public one) is
//      absent.
//   3. Lobby-first ordering (`started_at DESC NULLS FIRST, created_at
//      DESC`).
//   4. Role precedence: host beats a participant row on the same
//      session; the active participant row beats a historical one.
//   5. Topic + date filtering; an over-cap/bad param → 400.
//   6. Pagination + `total`.
//   7. Auth: no cookie → 401; valid cookie → 200.
// ============================================================
describe('GET /sessions/mine — membership-scoped, role-annotated list', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
    participants?: SessionParticipantRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    if (opts.participants !== undefined) {
      built.store.participants.push(...opts.participants);
    }
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const CAROL_ID = '33333333-3333-4333-8333-333333333333';
  const seededUsers: UserRow[] = [
    { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
    { id: BEN_ID, oauth_subject: 'authelia:ben', screen_name: 'ben', deleted_at: null },
    { id: CAROL_ID, oauth_subject: 'authelia:carol', screen_name: 'carol', deleted_at: null },
  ];

  // Alice hosts a started session.
  const S_HOST_STARTED: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Alice hosts a started talk',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    started_at: new Date('2026-05-10T10:00:00.000Z'),
    ended_at: null,
  };
  // Alice hosts a lobby (unstarted) session.
  const S_HOST_LOBBY: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0002',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'Alice hosts a lobby talk',
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    started_at: null,
    ended_at: null,
  };
  // Ben hosts; Alice is a moderator. Started + ended.
  const S_BEN_MOD: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0003',
    host_user_id: BEN_ID,
    privacy: 'public',
    topic: 'Ben hosts, Alice moderates',
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    started_at: new Date('2026-05-10T08:00:00.000Z'),
    ended_at: new Date('2026-05-10T09:00:00.000Z'),
  };
  // Carol hosts a public session Alice is NOT in — must be absent.
  const S_CAROL_OTHER: SessionRow = {
    id: '00000000-0000-4000-8000-aaaaaaaa0004',
    host_user_id: CAROL_ID,
    privacy: 'public',
    topic: "Carol's session Alice is not in",
    created_at: new Date('2026-05-09T13:00:00.000Z'),
    started_at: new Date('2026-05-10T07:00:00.000Z'),
    ended_at: null,
  };

  it('maps rows to the camelCase MySessionResponse shape including startedAt and role', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_HOST_STARTED] });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<{
        id?: string;
        hostUserId?: string;
        privacy?: string;
        topic?: string;
        createdAt?: string;
        startedAt?: string | null;
        endedAt?: string | null;
        role?: string;
      }>;
      total?: number;
    }>();
    expect(body.sessions).toHaveLength(1);
    const row = body.sessions?.[0];
    expect(row?.id).toBe(S_HOST_STARTED.id);
    expect(row?.hostUserId).toBe(ALICE_ID);
    expect(row?.privacy).toBe('public');
    expect(row?.topic).toBe(S_HOST_STARTED.topic);
    expect(row?.createdAt).toBe('2026-05-09T10:00:00.000Z');
    expect(row?.startedAt).toBe('2026-05-10T10:00:00.000Z');
    expect(row?.endedAt).toBeNull();
    expect(row?.role).toBe('host');
    expect(body.total).toBe(1);
  });

  it('annotates host / moderator / debater roles and hides non-member sessions', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_HOST_STARTED, S_BEN_MOD, S_CAROL_OTHER],
      participants: [
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0001',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-10T08:00:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<{ id?: string; role?: string }>;
      total?: number;
    }>();
    const byId = new Map((body.sessions ?? []).map((s) => [s.id, s.role]));
    expect(byId.get(S_HOST_STARTED.id)).toBe('host');
    expect(byId.get(S_BEN_MOD.id)).toBe('moderator');
    // Carol's public session — Alice is neither host nor participant.
    expect(byId.has(S_CAROL_OTHER.id)).toBe(false);
    expect(body.total).toBe(2);
  });

  it('returns the debater role for a debater-A / debater-B participant row', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_BEN_MOD, S_CAROL_OTHER],
      participants: [
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0002',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'debater-A',
          joined_at: new Date('2026-05-10T08:00:00.000Z'),
          left_at: null,
        },
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0003',
          session_id: S_CAROL_OTHER.id,
          user_id: ALICE_ID,
          role: 'debater-B',
          joined_at: new Date('2026-05-10T07:00:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string; role?: string }> }>();
    const byId = new Map((body.sessions ?? []).map((s) => [s.id, s.role]));
    expect(byId.get(S_BEN_MOD.id)).toBe('debater-A');
    expect(byId.get(S_CAROL_OTHER.id)).toBe('debater-B');
  });

  it('sorts lobby (NULL started_at) sessions ahead of started ones, then by started_at DESC', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      // S_HOST_STARTED started 2026-05-10T10:00, S_BEN_MOD started
      // 2026-05-10T08:00 (Alice moderates), S_HOST_LOBBY is lobby.
      sessions: [S_HOST_STARTED, S_HOST_LOBBY, S_BEN_MOD],
      participants: [
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0004',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-10T08:00:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }> }>();
    const ids = (body.sessions ?? []).map((s) => s.id);
    // Lobby first, then most-recently-started (10:00 before 08:00).
    expect(ids).toEqual([S_HOST_LOBBY.id, S_HOST_STARTED.id, S_BEN_MOD.id]);
  });

  it('resolves role precedence: host beats a participant row on the same session', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_HOST_STARTED],
      participants: [
        // Alice is ALSO a moderator participant on her own hosted
        // session — host must still win.
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0005',
          session_id: S_HOST_STARTED.id,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-10T10:00:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const body = response.json<{ sessions?: Array<{ role?: string }> }>();
    expect(body.sessions?.[0]?.role).toBe('host');
  });

  it('prefers the active participant row over a historical one for the role', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_BEN_MOD],
      participants: [
        // Historical debater row (left), plus a current moderator row.
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0006',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'debater-A',
          joined_at: new Date('2026-05-10T08:00:00.000Z'),
          left_at: new Date('2026-05-10T08:30:00.000Z'),
        },
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0007',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-10T08:31:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const body = response.json<{ sessions?: Array<{ role?: string }> }>();
    expect(body.sessions?.[0]?.role).toBe('moderator');
  });

  it('?topic narrows by case-insensitive substring', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_HOST_STARTED, S_HOST_LOBBY] });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine?topic=LOBBY',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions?.[0]?.id).toBe(S_HOST_LOBBY.id);
    expect(body.total).toBe(1);
  });

  it('?startedAfter narrows by started_at and excludes lobby (NULL) rows', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_HOST_STARTED, S_HOST_LOBBY] });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine?startedAfter=2026-05-10T00:00:00.000Z',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    // Only the started session — the lobby (NULL started_at) drops out.
    expect(body.sessions?.map((s) => s.id)).toEqual([S_HOST_STARTED.id]);
    expect(body.total).toBe(1);
  });

  it('rejects an over-cap offset with 400 validation-failed before any DB round-trip', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_HOST_STARTED] });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine?offset=100001',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');
  });

  it('pages the ordered set with limit/offset and reports the full total', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_HOST_STARTED, S_HOST_LOBBY, S_BEN_MOD],
      participants: [
        {
          id: '00000000-0000-4000-9000-bbbbbbbb0008',
          session_id: S_BEN_MOD.id,
          user_id: ALICE_ID,
          role: 'moderator',
          joined_at: new Date('2026-05-10T08:00:00.000Z'),
          left_at: null,
        },
      ],
    });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/mine?limit=1&offset=1',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    // Full order is [lobby, host-started, ben-mod]; offset 1 limit 1 →
    // the started host session.
    expect(body.sessions?.map((s) => s.id)).toEqual([S_HOST_STARTED.id]);
    expect(body.total).toBe(3);
  });

  it('returns 401 auth-required when no session cookie is present', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_HOST_STARTED] });
    const response = await built.app.inject({ method: 'GET', url: '/api/sessions/mine' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error?: { code?: string } }>().error?.code).toBe('auth-required');
  });
});

describe('GET /sessions/public — anonymous, started-only public list', () => {
  async function buildWithSeed(opts: {
    users: UserRow[];
    sessions: SessionRow[];
  }): Promise<BuiltApp> {
    const built = await buildApp({ users: opts.users });
    built.store.sessions.push(...opts.sessions);
    return built;
  }

  let built: BuiltApp | undefined;
  afterEach(async () => {
    if (built !== undefined) {
      await built.app.close();
      built = undefined;
    }
  });

  const seededUsers: UserRow[] = [
    { id: ALICE_ID, oauth_subject: 'authelia:alice', screen_name: 'alice', deleted_at: null },
  ];

  // A live, started public session — the "join live" target.
  const S_PUBLIC_LIVE: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0001',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Public live debate',
    created_at: new Date('2026-05-09T10:00:00.000Z'),
    started_at: new Date('2026-05-10T10:00:00.000Z'),
    ended_at: null,
  };
  // An ended public session — the "see replay" target.
  const S_PUBLIC_ENDED: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0002',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Public ended debate',
    created_at: new Date('2026-05-09T09:00:00.000Z'),
    started_at: new Date('2026-05-10T08:00:00.000Z'),
    ended_at: new Date('2026-05-10T09:00:00.000Z'),
  };
  // A lobby (unstarted) public session — id is still the join secret;
  // must NEVER appear.
  const S_PUBLIC_LOBBY: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0003',
    host_user_id: ALICE_ID,
    privacy: 'public',
    topic: 'Public lobby debate',
    created_at: new Date('2026-05-09T11:00:00.000Z'),
    started_at: null,
    ended_at: null,
  };
  // A started private session — must NEVER appear.
  const S_PRIVATE_STARTED: SessionRow = {
    id: '00000000-0000-4000-8000-cccccccc0004',
    host_user_id: ALICE_ID,
    privacy: 'private',
    topic: 'Private started debate',
    created_at: new Date('2026-05-09T12:00:00.000Z'),
    started_at: new Date('2026-05-10T11:00:00.000Z'),
    ended_at: null,
  };

  it('maps rows to the camelCase PublicSessionResponse shape (listing fields only)', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_PUBLIC_LIVE] });
    const response = await built.app.inject({ method: 'GET', url: '/api/sessions/public' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions?: Array<Record<string, unknown>>;
      total?: number;
    }>();
    expect(body.sessions).toHaveLength(1);
    const row = body.sessions?.[0];
    expect(row?.id).toBe(S_PUBLIC_LIVE.id);
    expect(row?.topic).toBe(S_PUBLIC_LIVE.topic);
    expect(row?.startedAt).toBe('2026-05-10T10:00:00.000Z');
    expect(row?.endedAt).toBeNull();
    // No host identity / privacy / role / participant fields leak.
    expect(row).not.toHaveProperty('hostUserId');
    expect(row).not.toHaveProperty('privacy');
    expect(row).not.toHaveProperty('role');
    expect(row).not.toHaveProperty('createdAt');
    expect(body.total).toBe(1);
  });

  it('gates to started public sessions — lobby and private are absent', async () => {
    built = await buildWithSeed({
      users: seededUsers,
      sessions: [S_PUBLIC_LIVE, S_PUBLIC_ENDED, S_PUBLIC_LOBBY, S_PRIVATE_STARTED],
    });
    const response = await built.app.inject({ method: 'GET', url: '/api/sessions/public' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sessions?: Array<{ id?: string }>; total?: number }>();
    const ids = body.sessions?.map((s) => s.id);
    expect(ids).toContain(S_PUBLIC_LIVE.id);
    expect(ids).toContain(S_PUBLIC_ENDED.id);
    expect(ids).not.toContain(S_PUBLIC_LOBBY.id);
    expect(ids).not.toContain(S_PRIVATE_STARTED.id);
    expect(body.total).toBe(2);
  });

  it('ignores any session cookie — anonymous and signed-in get the same list', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_PUBLIC_LIVE] });
    const anon = await built.app.inject({ method: 'GET', url: '/api/sessions/public' });
    const token = await signSessionToken({ sub: ALICE_ID }, TEST_SECRET);
    const authed = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/public',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(anon.statusCode).toBe(200);
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual(anon.json());
  });

  it('rejects an over-cap offset with 400 validation-failed before any DB round-trip', async () => {
    built = await buildWithSeed({ users: seededUsers, sessions: [S_PUBLIC_LIVE] });
    const response = await built.app.inject({
      method: 'GET',
      url: '/api/sessions/public?offset=100001',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error?: { code?: string } }>().error?.code).toBe('validation-failed');
  });
});
