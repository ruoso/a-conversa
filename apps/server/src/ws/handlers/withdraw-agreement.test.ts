// @vitest-environment node
//
// Vitest unit tests for the WS `withdraw-agreement` handler.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_withdraw_agreement_handler.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0029-protocol-rejection-policies.md,
//              docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md
// TaskJuggler: per_facet_refactor.server_handlers.pf_withdraw_agreement_handler
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The projection-
// side replay of the `withdraw-agreement` event is covered in
// `projection/replay.test.ts`'s `handleWithdrawAgreement` arm; this
// file is the integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Actor-must-match-participant gate (the headline authority gate
//      per the refinement's D2) → `forbidden` wire error when
//      `connection.user.id !== payload.participant`.
//   3. Subscribed but session not visible → 404 `not-found` wire error.
//   4. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   5. Requester is not a current participant → 403 `not-a-participant`.
//   6. Target facet not present → 404 `target-entity-not-found`.
//   7. Facet not committed → 422 `inapplicable-to-facet` (per ADR 0030
//      §3 — withdraw only meaningful against a committed facet).
//   8. No prior agreement → 409 `no-prior-agree`.
//   9. Successful withdraw (the headline happy path) → one
//      `withdraw-agreement` event appended + `event-applied` broadcast +
//      `agreement-withdrawn` ack on the same socket.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
// COMMITTED_SESSION_ID — the happy-path session. FIXTURE_USER_ID is
// the moderator; DEBATER_A_ID + DEBATER_B_ID are debaters; all three
// voted agree on a `classify-node` proposal that the moderator then
// committed. FIXTURE_USER_ID's withdraw against the now-committed
// classification facet is the headline success case.
const COMMITTED_SESSION_ID = '00000000-0000-4000-8000-000000000e01';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-000000000e02';
// PENDING_SESSION_ID — same shape as committed BUT no commit event
// landed yet. Used for the `facet-not-committed` gate test
// (`inapplicable-to-facet`).
const PENDING_SESSION_ID = '00000000-0000-4000-8000-000000000e03';
// NO_PRIOR_AGREE_SESSION_ID — committed session, but FIXTURE_USER_ID
// voted DISPUTE before the unanimity flipped via post-hoc agree (we
// just seed an extra agree vote so commit holds, and FIXTURE_USER_ID's
// last recorded vote stays `'dispute'`). Used for `no-prior-agree`.
const NO_PRIOR_AGREE_SESSION_ID = '00000000-0000-4000-8000-000000000e04';
// OUTSIDER_SESSION_ID — FIXTURE_USER_ID is NOT a current participant
// in this session (they never joined). Used for the
// `not-a-participant` gate test. Public so visibility passes.
const OUTSIDER_SESSION_ID = '00000000-0000-4000-8000-000000000e05';

const NODE_ID = '00000000-0000-4000-8000-000000000e10';
const PENDING_NODE_ID = '00000000-0000-4000-8000-000000000e11';
const NO_PRIOR_NODE_ID = '00000000-0000-4000-8000-000000000e12';
const UNKNOWN_NODE_ID = '00000000-0000-4000-8000-000000000eff';
const OUTSIDER_NODE_ID = '00000000-0000-4000-8000-000000000e13';

const COMMITTED_PROPOSAL_ID = '00000000-0000-4000-8000-000000000ea1';
const PENDING_PROPOSAL_ID = '00000000-0000-4000-8000-000000000ea2';
const NO_PRIOR_PROPOSAL_ID = '00000000-0000-4000-8000-000000000ea3';
const OUTSIDER_PROPOSAL_ID = '00000000-0000-4000-8000-000000000ea4';

const OTHER_HOST_ID = '00000000-0000-4000-8000-000000000ed1';
const DEBATER_A_ID = '00000000-0000-4000-8000-000000000ed2';
const DEBATER_B_ID = '00000000-0000-4000-8000-000000000ed3';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SessionRow {
  id: string;
  host_user_id: string;
  privacy: 'public' | 'private';
  ended_at: Date | null;
}

interface EventRow {
  id: string;
  session_id: string;
  sequence: number;
  kind: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface Store {
  sessions: SessionRow[];
  events: EventRow[];
}

function makeWithdrawAgreementPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: COMMITTED_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
      {
        id: PENDING_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: NO_PRIOR_AGREE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: OUTSIDER_SESSION_ID,
        host_user_id: OTHER_HOST_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    events: [
      // ---- COMMITTED_SESSION_ID ----
      // Three participants + node + classify-node proposal + three
      // agree votes + commit. MAX(sequence) = 10.
      {
        id: '00000000-0000-4000-8000-00000000ea01',
        session_id: COMMITTED_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Committed-classify withdraw-agreement test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea02',
        session_id: COMMITTED_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea03',
        session_id: COMMITTED_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea04',
        session_id: COMMITTED_SESSION_ID,
        sequence: 4,
        kind: 'participant-joined',
        actor: DEBATER_B_ID,
        payload: {
          user_id: DEBATER_B_ID,
          role: 'debater-B',
          screen_name: 'debater-b',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea05',
        session_id: COMMITTED_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim to commit + withdraw.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea06',
        session_id: COMMITTED_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(3),
      },
      // The proposal envelope is `id`-overridden to the well-known
      // COMMITTED_PROPOSAL_ID — replace the prior row.
      {
        id: COMMITTED_PROPOSAL_ID,
        session_id: COMMITTED_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea08',
        session_id: COMMITTED_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea09',
        session_id: COMMITTED_SESSION_ID,
        sequence: 9,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_ID,
          participant: DEBATER_B_ID,
          choice: 'agree',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },
      {
        id: '00000000-0000-4000-8000-00000000ea0a',
        session_id: COMMITTED_SESSION_ID,
        sequence: 10,
        kind: 'commit',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal',
          proposal_id: COMMITTED_PROPOSAL_ID,
          committed_by: FIXTURE_USER_ID,
          committed_at: t(7).toISOString(),
        },
        created_at: t(7),
      },

      // ---- PENDING_SESSION_ID ----
      // Same as committed but NO commit event → facet stays at
      // `agreed`, never `committed`. The withdraw handler rejects with
      // `inapplicable-to-facet`. MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-00000000eb01',
        session_id: PENDING_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Pending-classify withdraw-agreement test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb02',
        session_id: PENDING_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb03',
        session_id: PENDING_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a-p',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb04',
        session_id: PENDING_SESSION_ID,
        sequence: 4,
        kind: 'participant-joined',
        actor: DEBATER_B_ID,
        payload: {
          user_id: DEBATER_B_ID,
          role: 'debater-B',
          screen_name: 'debater-b-p',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb05',
        session_id: PENDING_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: PENDING_NODE_ID,
          wording: 'A pending claim.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: PENDING_PROPOSAL_ID,
        session_id: PENDING_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: PENDING_NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb07',
        session_id: PENDING_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: PENDING_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb08',
        session_id: PENDING_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: PENDING_PROPOSAL_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
      {
        id: '00000000-0000-4000-8000-00000000eb09',
        session_id: PENDING_SESSION_ID,
        sequence: 9,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: PENDING_PROPOSAL_ID,
          participant: DEBATER_B_ID,
          choice: 'agree',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },

      // ---- NO_PRIOR_AGREE_SESSION_ID ----
      // Same shape as committed BUT FIXTURE_USER_ID's last vote is
      // `'dispute'`. To get the proposal committed despite the
      // dispute, we'd normally need a unanimity flip — the simpler
      // setup that exercises the "no prior agree" path is to commit
      // the proposal (so the facet is committed) but seed
      // FIXTURE_USER_ID's recorded vote as the trailing dispute. This
      // is technically a divergent state (the engine wouldn't accept
      // the commit after a dispute), but the projection's
      // `perParticipant` map records whatever vote events landed
      // last — so the handler reads `'dispute'` even though the
      // commit landed. The check we're exercising is "the projection
      // says your last vote is NOT 'agree'" — orthogonal to whether
      // the upstream chain was lawful. The test pin's purpose is to
      // exercise the handler's predicate; it isn't a methodology-
      // engine pin.
      //
      // MAX(sequence) = 11 (5 lifecycle + node + proposal + 4 votes
      // [agree×3, dispute by FIXTURE_USER_ID at the tail] + commit).
      {
        id: '00000000-0000-4000-8000-00000000ec01',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'No-prior-agree withdraw-agreement test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec02',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'moderator',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec03',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a-np',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec04',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 4,
        kind: 'participant-joined',
        actor: DEBATER_B_ID,
        payload: {
          user_id: DEBATER_B_ID,
          role: 'debater-B',
          screen_name: 'debater-b-np',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec05',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NO_PRIOR_NODE_ID,
          wording: 'A claim with no-prior-agree on the requester.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: NO_PRIOR_PROPOSAL_ID,
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NO_PRIOR_NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(3),
      },
      // Three agree votes (needed for the commit to land).
      {
        id: '00000000-0000-4000-8000-00000000ec07',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: NO_PRIOR_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec08',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: NO_PRIOR_PROPOSAL_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
      {
        id: '00000000-0000-4000-8000-00000000ec09',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 9,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: NO_PRIOR_PROPOSAL_ID,
          participant: DEBATER_B_ID,
          choice: 'agree',
          voted_at: t(6).toISOString(),
        },
        created_at: t(6),
      },
      // Commit at seq 10.
      {
        id: '00000000-0000-4000-8000-00000000ec0a',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 10,
        kind: 'commit',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal',
          proposal_id: NO_PRIOR_PROPOSAL_ID,
          committed_by: FIXTURE_USER_ID,
          committed_at: t(7).toISOString(),
        },
        created_at: t(7),
      },
      // Now FIXTURE_USER_ID's last recorded vote is overwritten to
      // 'dispute' (post-commit). This leaves `perParticipant` showing
      // `dispute` for FIXTURE_USER_ID even though `committedAt` is
      // populated — the projection-layer scenario the handler must
      // reject with `no-prior-agree`.
      {
        id: '00000000-0000-4000-8000-00000000ec0b',
        session_id: NO_PRIOR_AGREE_SESSION_ID,
        sequence: 11,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: NO_PRIOR_PROPOSAL_ID,
          participant: FIXTURE_USER_ID,
          choice: 'dispute',
          voted_at: t(8).toISOString(),
        },
        created_at: t(8),
      },

      // ---- OUTSIDER_SESSION_ID ----
      // FIXTURE_USER_ID is NOT a participant. Hosted by OTHER_HOST_ID;
      // public so visibility passes. Two debater participants only.
      // MAX(sequence) = 7 (3 lifecycle + node + proposal + 2 votes).
      {
        id: '00000000-0000-4000-8000-00000000ed01',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: OTHER_HOST_ID,
        payload: {
          host_user_id: OTHER_HOST_ID,
          privacy: 'public',
          topic: 'Outsider withdraw-agreement test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000000ed02',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: OTHER_HOST_ID,
        payload: {
          user_id: OTHER_HOST_ID,
          role: 'moderator',
          screen_name: 'other-host-o',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ed03',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a-o',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000000ed04',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: OTHER_HOST_ID,
        payload: {
          node_id: OUTSIDER_NODE_ID,
          wording: 'A claim in a session FIXTURE_USER_ID never joined.',
          created_by: OTHER_HOST_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: OUTSIDER_PROPOSAL_ID,
        session_id: OUTSIDER_SESSION_ID,
        sequence: 5,
        kind: 'proposal',
        actor: OTHER_HOST_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: OUTSIDER_NODE_ID,
            classification: 'fact',
          },
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-00000000ed06',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: OTHER_HOST_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: OUTSIDER_PROPOSAL_ID,
          participant: OTHER_HOST_ID,
          choice: 'agree',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000000ed07',
        session_id: OUTSIDER_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: OUTSIDER_PROPOSAL_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
    ],
  };

  // The COMMITTED_SESSION_ID seed above has a tiny ordering wart — the
  // proposal envelope was given sequence 6 with the well-known id, but
  // then we treated sequence 7's vote as referencing COMMITTED_PROPOSAL_ID.
  // That works because the seed array used the SECOND-listed entry's id
  // for the proposal at seq 6 (we'd given seq 6 the auto id ending in
  // `ea06`, but the proposal_id constant is `ea1`). Fix the wiring: the
  // proposal at seq 6 must literally use COMMITTED_PROPOSAL_ID as its
  // event id — overwrite the auto-id below.
  const commitProposalRow = store.events.find(
    (e) => e.session_id === COMMITTED_SESSION_ID && e.sequence === 6 && e.kind === 'proposal',
  );
  if (commitProposalRow !== undefined) {
    commitProposalRow.id = COMMITTED_PROPOSAL_ID;
  }
  // Same trick for the other seeded sessions whose proposal event ids
  // matter — done inline above by setting `id: PENDING_PROPOSAL_ID` /
  // `NO_PRIOR_PROPOSAL_ID` / `OUTSIDER_PROPOSAL_ID` directly. Only
  // COMMITTED needed this post-hoc fix because we tried to be cute with
  // the inline structure above.

  const pool: DbPool = {
    query<TRow extends Record<string, unknown>>(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: TRow[] }> {
      const p = (params ?? []) as unknown[];
      const trimmed = text.trim();

      if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (
        trimmed.startsWith('SELECT 1') &&
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes("privacy = 'public'") &&
        text.includes('host_user_id = $2') &&
        text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const userId = p[1] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        const isPublic = session.privacy === 'public';
        const isHost = session.host_user_id === userId;
        if (isPublic || isHost) {
          return Promise.resolve({ rows: [{ visible: 1 }] as unknown as TRow[] });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (
        text.includes('FROM sessions') &&
        text.includes('WHERE id = $1') &&
        text.includes('FOR UPDATE') &&
        !text.includes('session_participants')
      ) {
        const sessionId = p[0] as string;
        const session = store.sessions.find((s) => s.id === sessionId);
        if (session === undefined) {
          return Promise.resolve({ rows: [] as TRow[] });
        }
        return Promise.resolve({
          rows: [{ id: session.id, ended_at: session.ended_at }] as unknown as TRow[],
        });
      }

      if (
        text.includes('FROM session_events') &&
        text.includes('MAX(sequence)') &&
        text.includes('WHERE session_id = $1')
      ) {
        const sessionId = p[0] as string;
        const seqs = store.events.filter((e) => e.session_id === sessionId).map((e) => e.sequence);
        const maxSeq = seqs.length === 0 ? 0 : Math.max(...seqs);
        return Promise.resolve({ rows: [{ max_seq: maxSeq }] as unknown as TRow[] });
      }

      if (
        text.includes('SELECT id, session_id, sequence, kind, actor, payload, created_at') &&
        text.includes('FROM session_events') &&
        text.includes('WHERE session_id = $1') &&
        text.includes('ORDER BY sequence ASC')
      ) {
        const sessionId = p[0] as string;
        const rows = store.events
          .filter((e) => e.session_id === sessionId)
          .sort((a, b) => a.sequence - b.sequence);
        return Promise.resolve({ rows: rows as unknown as TRow[] });
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
          created_at: new Date('2026-05-11T10:00:30.000Z'),
        });
        return Promise.resolve({ rows: [] as TRow[] });
      }

      if (text.includes('FROM auth_token_denylist') && text.includes('WHERE jti')) {
        return Promise.resolve({ rows: [] as TRow[] });
      }
      return Promise.reject(
        new Error(`unexpected SQL in WS withdraw-agreement test pool: ${text}`),
      );
    },
  };

  return { pool, store };
}

// ---- WS client plumbing --------------------------------------------

type WsLike = {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  readyState: number;
};

function toUtf8(data: unknown): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  return String(data);
}

interface OpenedWs {
  ws: WsLike;
  next: () => Promise<string>;
}

async function openWsClient(app: FastifyInstance, cookie: string): Promise<OpenedWs> {
  const queue: string[] = [];
  let waiter: ((msg: string) => void) | null = null;

  const ws = await app.injectWS(
    '/api/ws',
    { headers: { cookie } },
    {
      onInit(client: unknown) {
        const wsClient = client as WsLike;
        wsClient.on('message', (data: unknown) => {
          const text = toUtf8(data);
          if (waiter) {
            const w = waiter;
            waiter = null;
            w(text);
          } else {
            queue.push(text);
          }
        });
      },
    },
  );

  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      waiter = resolve;
    });

  return { ws, next };
}

async function buildHandlerApp(pool: DbPool): Promise<FastifyInstance> {
  return __buildTestWsApp({
    pool,
    sessionTokenSecret: TEST_SESSION_SECRET,
  });
}

async function fixtureCookieHeader(): Promise<string> {
  const token = await signSessionToken({ sub: FIXTURE_USER_ID }, TEST_SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// Sample v4 UUIDs for the test envelopes' `id` field.
const SUB_MSG_ID = '11111111-1111-4111-8111-111111111ed1';
const WD_MSG_ID = '22222222-2222-4222-8222-222222222ed1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

interface WithdrawFramePayload {
  sessionId: string;
  expectedSequence: number;
  entity_kind: 'node' | 'edge';
  entity_id: string;
  facet: 'classification' | 'substance' | 'wording';
  participant: string;
}

function withdrawAgreementFrame(messageId: string, payload: WithdrawFramePayload): string {
  return JSON.stringify({
    type: 'withdraw-agreement',
    id: messageId,
    payload,
  });
}

async function readUntilType(
  next: () => Promise<string>,
  type: string,
  maxFrames = 5,
): Promise<{ raw: string; parsed: Record<string, unknown> }> {
  for (let i = 0; i < maxFrames; i++) {
    const raw = await next();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === type) {
      return { raw, parsed };
    }
  }
  throw new Error(`did not receive frame of type '${type}' within ${String(maxFrames)} reads`);
}

describe('ws_withdraw_agreement_handler — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeWithdrawAgreementPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed withdraw with `forbidden` and does NOT append', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to withdraw-agreement.
      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: COMMITTED_SESSION_ID,
          expectedSequence: 10,
          entity_kind: 'node',
          entity_id: NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('forbidden');

      const eventCount = store.events.filter((e) => e.session_id === COMMITTED_SESSION_ID).length;
      expect(eventCount).toBe(10);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw where actor !== payload.participant with `forbidden` (actor-mismatch)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello
      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: COMMITTED_SESSION_ID,
          expectedSequence: 10,
          entity_kind: 'node',
          entity_id: NODE_ID,
          facet: 'classification',
          // Spoof a different participant id — the handler MUST match
          // against `connection.user.id`, NOT this field.
          participant: DEBATER_A_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('forbidden');
      expect(typeof payload.message).toBe('string');

      const eventCount = store.events.filter((e) => e.session_id === COMMITTED_SESSION_ID).length;
      expect(eventCount).toBe(10);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw against a non-visible session with `not-found`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly subscribe to bypass the subscribe-handler visibility
      // gate (the test isolates the withdraw-agreement handler's own
      // visibility re-check). Mirrors the meta-disagreement test
      // pattern.
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: HIDDEN_SESSION_ID,
          expectedSequence: 0,
          entity_kind: 'node',
          entity_id: NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a stale expectedSequence with `sequence-mismatch`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: COMMITTED_SESSION_ID,
          expectedSequence: 5, // server is at 10.
          entity_kind: 'node',
          entity_id: NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw from a non-participant with `not-a-participant`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, OUTSIDER_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: OUTSIDER_SESSION_ID,
          expectedSequence: 7,
          entity_kind: 'node',
          entity_id: OUTSIDER_NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('not-a-participant');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw against a non-existent facet target with `target-entity-not-found`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: COMMITTED_SESSION_ID,
          expectedSequence: 10,
          entity_kind: 'node',
          entity_id: UNKNOWN_NODE_ID, // not present on the projection.
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('target-entity-not-found');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw against an uncommitted facet with `inapplicable-to-facet`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, PENDING_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: PENDING_SESSION_ID,
          expectedSequence: 9,
          entity_kind: 'node',
          entity_id: PENDING_NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('inapplicable-to-facet');

      const eventCount = store.events.filter((e) => e.session_id === PENDING_SESSION_ID).length;
      expect(eventCount).toBe(9);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw when the requester has no prior `agree` on the facet with `no-prior-agree`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, NO_PRIOR_AGREE_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: NO_PRIOR_AGREE_SESSION_ID,
          expectedSequence: 11,
          entity_kind: 'node',
          entity_id: NO_PRIOR_NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(payload.code).toBe('no-prior-agree');

      const eventCount = store.events.filter(
        (e) => e.session_id === NO_PRIOR_AGREE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(11);
    } finally {
      ws.terminate();
    }
  });

  it('accepts a valid withdraw and emits `event-applied` + `agreement-withdrawn` ack', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next();
      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_SESSION_ID));
      await readUntilType(next, 'subscribed');

      ws.send(
        withdrawAgreementFrame(WD_MSG_ID, {
          sessionId: COMMITTED_SESSION_ID,
          expectedSequence: 10,
          entity_kind: 'node',
          entity_id: NODE_ID,
          facet: 'classification',
          participant: FIXTURE_USER_ID,
        }),
      );

      // The broadcast emits BEFORE the ack — read both in order.
      const broadcast = await readUntilType(next, 'event-applied');
      const broadcastPayload = broadcast.parsed.payload as {
        event?: {
          kind?: unknown;
          sessionId?: unknown;
          sequence?: unknown;
          actor?: unknown;
          payload?: {
            entity_kind?: unknown;
            entity_id?: unknown;
            facet?: unknown;
            participant?: unknown;
            withdrawn_at?: unknown;
          };
        };
      };
      expect(broadcastPayload.event?.kind).toBe('withdraw-agreement');
      expect(broadcastPayload.event?.sessionId).toBe(COMMITTED_SESSION_ID);
      expect(broadcastPayload.event?.sequence).toBe(11);
      expect(broadcastPayload.event?.actor).toBe(FIXTURE_USER_ID);
      expect(broadcastPayload.event?.payload?.entity_kind).toBe('node');
      expect(broadcastPayload.event?.payload?.entity_id).toBe(NODE_ID);
      expect(broadcastPayload.event?.payload?.facet).toBe('classification');
      expect(broadcastPayload.event?.payload?.participant).toBe(FIXTURE_USER_ID);
      expect(typeof broadcastPayload.event?.payload?.withdrawn_at).toBe('string');

      const ack = await readUntilType(next, 'agreement-withdrawn');
      const ackPayload = ack.parsed.payload as {
        sessionId?: unknown;
        sequence?: unknown;
        eventId?: unknown;
      };
      expect(ack.parsed.inResponseTo).toBe(WD_MSG_ID);
      expect(ackPayload.sessionId).toBe(COMMITTED_SESSION_ID);
      expect(ackPayload.sequence).toBe(11);
      expect(typeof ackPayload.eventId).toBe('string');
      expect(ackPayload.eventId).toMatch(UUID_V4_PATTERN);

      // The event was appended.
      const appended = store.events.find(
        (e) => e.session_id === COMMITTED_SESSION_ID && e.sequence === 11,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('withdraw-agreement');
    } finally {
      ws.terminate();
    }
  });
});
