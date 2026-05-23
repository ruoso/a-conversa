// @vitest-environment node
//
// Vitest unit tests for the WS `withdraw-proposal` handler.
//
// Refinement: tasks/refinements/backend/ws_withdraw_proposal_message.md
// ADRs:        docs/adr/0020-postgres-write-path-locking-and-event-ordering.md,
//              docs/adr/0021-event-envelope-discriminated-union-with-zod.md,
//              docs/adr/0022-no-throwaway-verifications.md,
//              docs/adr/0027-entity-and-facet-layers-strict-separation.md
// TaskJuggler: backend.websocket_protocol.ws_withdraw_proposal_message
//
// **What this file covers.** The handler-level surface — driven end-to-
// end through a real Fastify instance (`__buildTestWsApp`), the real
// dispatcher, and a real WS upgrade via `app.injectWS`. The methodology
// engine + projector layers are covered in their own files
// (`projection/replay.test.ts`'s `handleEntityRemoved` arm); this file
// is the integration of:
//
//   1. Subscribe-before-act gate → 403 `forbidden` wire error.
//   2. Subscribed but session not visible → 404 `not-found` wire error.
//   3. Stale `expectedSequence` → 409 `sequence-mismatch` wire error.
//   4. Proposal-not-found → 404 `proposal-not-found` wire error.
//   5. **Headline gate**: a subscribed non-proposer attempting withdraw
//      → 403 `forbidden` wire error (the proposer-only authority gate
//      per D1 of the refinement).
//   6. Proposal-already-committed → 422 `proposal-already-committed`.
//   7. Proposal-already-meta-disagreement → 422
//      `proposal-already-meta-disagreement`.
//   8. Successful withdraw (free-floating `classify-node`) → one
//      `entity-removed(node)` event + `event-applied` broadcast +
//      `proposal-withdrawn` ack on the same socket. The ack's
//      `removedEventCount` is 1.
//   9. Successful withdraw of a sub-kind that introduced ZERO entities
//      at propose-time (`set-node-substance`) → zero `entity-removed`
//      events appended + ack with `removedEventCount: 0` (no
//      broadcast). Pins the per-sub-kind mapping's zero-emission case.
//  10. **SECURITY**: even when the client includes a spoofed
//      `proposerId` on the payload, the handler ignores it and uses
//      `connection.user.id` for the authority match. A non-proposer
//      who spoofs the proposer id still hits `forbidden`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signSessionToken, SESSION_COOKIE_NAME } from '../../auth/session-token.js';
import type { DbPool } from '../../db.js';
import { __buildTestWsApp } from '../connection.js';
import { FIXTURE_SCREEN_NAME, FIXTURE_USER_ID, TEST_SESSION_SECRET } from '../test-helpers.js';

// Stable fixture ids.
const WITHDRAWABLE_SESSION_ID = '00000000-0000-4000-8000-0000000010a1';
const HIDDEN_SESSION_ID = '00000000-0000-4000-8000-0000000010a2';
const NON_PROPOSER_SESSION_ID = '00000000-0000-4000-8000-0000000010a3';
const COMMITTED_PROPOSAL_SESSION_ID = '00000000-0000-4000-8000-0000000010a4';
const META_DISAGREE_SESSION_ID = '00000000-0000-4000-8000-0000000010a5';
const NO_EMIT_SESSION_ID = '00000000-0000-4000-8000-0000000010a6';
// Session seeded with a connecting `set-edge-substance` propose that
// minted an edge at propose-time (per
// `mod_set_edge_substance_endpoint_carriage`). Used for the
// edge-retraction withdraw test.
const EDGE_WITHDRAW_SESSION_ID = '00000000-0000-4000-8000-0000000010a7';
// Sessions seeded with the per-component fan-out from a decompose /
// interpretive-split propose (per
// `mod_decompose_propose_time_canvas_visibility`). Used for the
// per-component-retraction withdraw tests.
const DECOMPOSE_WITHDRAW_SESSION_ID = '00000000-0000-4000-8000-0000000010a8';
const SPLIT_WITHDRAW_SESSION_ID = '00000000-0000-4000-8000-0000000010a9';

const NODE_ID = '00000000-0000-4000-8000-0000000010b1';
const COMMITTED_NODE_ID = '00000000-0000-4000-8000-0000000010b2';
const META_NODE_ID = '00000000-0000-4000-8000-0000000010b3';
const NON_PROPOSER_NODE_ID = '00000000-0000-4000-8000-0000000010b4';
const NO_EMIT_NODE_ID = '00000000-0000-4000-8000-0000000010b5';
// Nodes + edge id for the connecting-edge withdraw test.
const EDGE_WITHDRAW_TARGET_NODE_ID = '00000000-0000-4000-8000-0000000010b6';
const EDGE_WITHDRAW_SOURCE_NODE_ID = '00000000-0000-4000-8000-0000000010b7';
const EDGE_WITHDRAW_EDGE_ID = '00000000-0000-4000-8000-0000000010b8';
// Parent + component / reading node ids for the decompose / interpretive-
// split withdraw tests.
const DECOMPOSE_PARENT_NODE_ID = '00000000-0000-4000-8000-0000000010b9';
const DECOMPOSE_COMPONENT_A_NODE_ID = '00000000-0000-4000-8000-0000000010ba';
const DECOMPOSE_COMPONENT_B_NODE_ID = '00000000-0000-4000-8000-0000000010bb';
const SPLIT_PARENT_NODE_ID = '00000000-0000-4000-8000-0000000010bc';
const SPLIT_READING_A_NODE_ID = '00000000-0000-4000-8000-0000000010bd';
const SPLIT_READING_B_NODE_ID = '00000000-0000-4000-8000-0000000010be';

const PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c1';
const COMMITTED_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c2';
const META_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c3';
const NON_PROPOSER_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c4';
const NO_EMIT_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c5';
const EDGE_WITHDRAW_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c6';
const DECOMPOSE_WITHDRAW_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c7';
const SPLIT_WITHDRAW_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010c8';

const OTHER_HOST_ID = '00000000-0000-4000-8000-0000000010d1';
const DEBATER_A_ID = '00000000-0000-4000-8000-0000000010d2';
const DEBATER_B_ID = '00000000-0000-4000-8000-0000000010d3';

// A proposal id that DOES NOT exist in any seeded session — for the
// proposal-not-found case.
const UNKNOWN_PROPOSAL_EVENT_ID = '00000000-0000-4000-8000-0000000010e1';

// RFC 4122 v4 UUID matcher.
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Pool composition ----------------------------------------------
//
// Five sessions, each seeding a different test path:
//
// 1. WITHDRAWABLE_SESSION_ID — public, FIXTURE_USER_ID host/moderator;
//    a free-floating `classify-node` propose by FIXTURE_USER_ID
//    already landed (emitted node-created + entity-included +
//    proposal in that order). Used for the happy-path withdraw test
//    (one entity-removed(node) is emitted; the ack carries
//    removedEventCount: 1). MAX(sequence) = 5.
//
// 2. HIDDEN_SESSION_ID — private, hosted by OTHER_HOST_ID; not
//    visible to FIXTURE_USER_ID. Used for the visibility-recheck
//    gate test.
//
// 3. NON_PROPOSER_SESSION_ID — public, FIXTURE_USER_ID is a
//    debater-A; OTHER_HOST_ID is the moderator + the original
//    proposer. Used for the headline proposer-only authority gate
//    test. MAX(sequence) = 6 after the propose-time fan-out
//    (node-created + entity-included + proposal).
//
// 4. COMMITTED_PROPOSAL_SESSION_ID — public, FIXTURE_USER_ID is
//    moderator + original proposer; the proposal has been committed
//    (DEBATER_A_ID + DEBATER_B_ID both joined + voted agree + the
//    commit landed). Used for the proposal-already-committed test.
//    MAX(sequence) = 11 (5 lifecycle + node-created +
//    entity-included + proposal + 3 votes + commit).
//
// 5. META_DISAGREE_SESSION_ID — public, FIXTURE_USER_ID is
//    moderator + original proposer; the proposal has been marked as
//    meta-disagreement. Used for the proposal-already-meta-
//    disagreement test. MAX(sequence) = 9 (after the
//    meta-disagreement-marked event).
//
// 6. NO_EMIT_SESSION_ID — public, FIXTURE_USER_ID is moderator +
//    original proposer; a `set-node-substance` propose against an
//    already-committed node (so the propose-time fan-out emits
//    nothing — only the proposal envelope). Used for the
//    zero-emission case. MAX(sequence) = 5 (3 lifecycle + node
//    pre-existed in a prior commit + the proposal).

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

function makeWithdrawPool(): { pool: DbPool; store: Store } {
  const t = (n: number) => new Date(`2026-05-11T10:00:${String(n).padStart(2, '0')}.000Z`);

  const store: Store = {
    sessions: [
      {
        id: WITHDRAWABLE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      { id: HIDDEN_SESSION_ID, host_user_id: OTHER_HOST_ID, privacy: 'private', ended_at: null },
      {
        id: NON_PROPOSER_SESSION_ID,
        host_user_id: OTHER_HOST_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: COMMITTED_PROPOSAL_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: META_DISAGREE_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: NO_EMIT_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: EDGE_WITHDRAW_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: DECOMPOSE_WITHDRAW_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
      {
        id: SPLIT_WITHDRAW_SESSION_ID,
        host_user_id: FIXTURE_USER_ID,
        privacy: 'public',
        ended_at: null,
      },
    ],
    events: [
      // ---- WITHDRAWABLE_SESSION_ID ----
      // session-created + participant-joined(moderator) + node-created
      // + entity-included + proposal (= classify-node minted at
      // propose-time). MAX(sequence) = 5.
      {
        id: '00000000-0000-4000-8000-00000001fa01',
        session_id: WITHDRAWABLE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'WS withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001fa02',
        session_id: WITHDRAWABLE_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fa03',
        session_id: WITHDRAWABLE_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NODE_ID,
          wording: 'A claim under withdraw test.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fa04',
        session_id: WITHDRAWABLE_SESSION_ID,
        sequence: 4,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: PROPOSAL_EVENT_ID,
        session_id: WITHDRAWABLE_SESSION_ID,
        sequence: 5,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NODE_ID,
            classification: 'fact',
            wording: 'A claim under withdraw test.',
          },
        },
        created_at: t(2),
      },

      // ---- NON_PROPOSER_SESSION_ID ----
      // OTHER_HOST_ID hosts + proposes; FIXTURE_USER_ID is a debater
      // and is therefore NOT the original proposer. MAX(sequence) = 6.
      {
        id: '00000000-0000-4000-8000-00000001fb01',
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: OTHER_HOST_ID,
        payload: {
          host_user_id: OTHER_HOST_ID,
          privacy: 'public',
          topic: 'Non-proposer withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001fb02',
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: OTHER_HOST_ID,
        payload: {
          user_id: OTHER_HOST_ID,
          role: 'moderator',
          screen_name: 'other-host',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000001fb03',
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: FIXTURE_USER_ID,
        payload: {
          user_id: FIXTURE_USER_ID,
          role: 'debater-A',
          screen_name: FIXTURE_SCREEN_NAME,
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000001fb04',
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: OTHER_HOST_ID,
        payload: {
          node_id: NON_PROPOSER_NODE_ID,
          wording: 'Foreign proposer claim.',
          created_by: OTHER_HOST_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fb05',
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 5,
        kind: 'entity-included',
        actor: OTHER_HOST_ID,
        payload: {
          entity_kind: 'node',
          entity_id: NON_PROPOSER_NODE_ID,
          included_by: OTHER_HOST_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: NON_PROPOSER_PROPOSAL_EVENT_ID,
        session_id: NON_PROPOSER_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: OTHER_HOST_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: NON_PROPOSER_NODE_ID,
            classification: 'fact',
            wording: 'Foreign proposer claim.',
          },
        },
        created_at: t(2),
      },

      // ---- COMMITTED_PROPOSAL_SESSION_ID ----
      // FIXTURE_USER_ID proposes, all participants agree, the
      // moderator commits. MAX(sequence) = 11.
      {
        id: '00000000-0000-4000-8000-00000001fc01',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Committed-proposal withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc02',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fc03',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fc04',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fc05',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: COMMITTED_NODE_ID,
          wording: 'A committed claim.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc06',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 6,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: COMMITTED_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: COMMITTED_PROPOSAL_EVENT_ID,
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 7,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: COMMITTED_NODE_ID,
            classification: 'fact',
            wording: 'A committed claim.',
          },
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc08',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_EVENT_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc09',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 9,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_EVENT_ID,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc0a',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 10,
        kind: 'vote',
        actor: DEBATER_B_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: COMMITTED_PROPOSAL_EVENT_ID,
          participant: DEBATER_B_ID,
          choice: 'agree',
          voted_at: t(5).toISOString(),
        },
        created_at: t(5),
      },
      {
        id: '00000000-0000-4000-8000-00000001fc0b',
        session_id: COMMITTED_PROPOSAL_SESSION_ID,
        sequence: 11,
        kind: 'commit',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal',
          proposal_id: COMMITTED_PROPOSAL_EVENT_ID,
          committed_by: FIXTURE_USER_ID,
          committed_at: t(6).toISOString(),
        },
        created_at: t(6),
      },

      // ---- META_DISAGREE_SESSION_ID ----
      // FIXTURE_USER_ID proposes, debaters disagree, moderator marks
      // meta-disagreement. MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-00000001fd01',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Meta-disagree withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd02',
        session_id: META_DISAGREE_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fd03',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 3,
        kind: 'participant-joined',
        actor: DEBATER_A_ID,
        payload: {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'debater-a-meta',
          joined_at: t(1).toISOString(),
        },
        created_at: t(1),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd04',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 4,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: META_NODE_ID,
          wording: 'A meta-disagreed claim.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd05',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 5,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: META_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: META_PROPOSAL_EVENT_ID,
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 6,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'classify-node',
            node_id: META_NODE_ID,
            classification: 'fact',
            wording: 'A meta-disagreed claim.',
          },
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd07',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 7,
        kind: 'vote',
        actor: FIXTURE_USER_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: META_PROPOSAL_EVENT_ID,
          participant: FIXTURE_USER_ID,
          choice: 'agree',
          voted_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd08',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 8,
        kind: 'vote',
        actor: DEBATER_A_ID,
        payload: {
          target: 'proposal' as const,
          proposal_id: META_PROPOSAL_EVENT_ID,
          participant: DEBATER_A_ID,
          choice: 'dispute',
          voted_at: t(4).toISOString(),
        },
        created_at: t(4),
      },
      {
        id: '00000000-0000-4000-8000-00000001fd09',
        session_id: META_DISAGREE_SESSION_ID,
        sequence: 9,
        kind: 'meta-disagreement-marked',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal_id: META_PROPOSAL_EVENT_ID,
          marker: FIXTURE_USER_ID,
          marked_at: t(5).toISOString(),
        },
        created_at: t(5),
      },

      // ---- NO_EMIT_SESSION_ID ----
      // A `set-node-substance` proposal against a pre-existing
      // committed node (one that was minted in a prior, already
      // committed cycle so the propose-time fan-out emits nothing).
      // Simplified: the node was minted by a `node-created` /
      // `entity-included` BEFORE the proposal, so the proposal
      // doesn't introduce it. set-node-substance never emits
      // structural events at propose-time today. MAX(sequence) = 5.
      {
        id: '00000000-0000-4000-8000-00000001fe01',
        session_id: NO_EMIT_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'No-emission withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001fe02',
        session_id: NO_EMIT_SESSION_ID,
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
        id: '00000000-0000-4000-8000-00000001fe03',
        session_id: NO_EMIT_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: NO_EMIT_NODE_ID,
          wording: 'A pre-existing node.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001fe04',
        session_id: NO_EMIT_SESSION_ID,
        sequence: 4,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: NO_EMIT_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: NO_EMIT_PROPOSAL_EVENT_ID,
        session_id: NO_EMIT_SESSION_ID,
        sequence: 5,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'set-node-substance',
            node_id: NO_EMIT_NODE_ID,
            substance: 'agreed',
          },
        },
        created_at: t(3),
      },

      // ---- EDGE_WITHDRAW_SESSION_ID ----
      // FIXTURE_USER_ID hosts + proposes a connecting
      // `set-edge-substance` per
      // `mod_set_edge_substance_endpoint_carriage`. Pre-state: target
      // node + source node both already on the canvas. The propose-
      // time fan-out emitted `edge-created` + `entity-included` for
      // the fresh edge alongside the `proposal` envelope. Used for
      // the connecting-edge withdraw test (one
      // `entity-removed(edge)` lands at seq 10). MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-00000001ff01',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Edge-withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-00000001ff02',
        session_id: EDGE_WITHDRAW_SESSION_ID,
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
      // Target node (pre-existing) — visible on the canvas before the
      // connecting propose.
      {
        id: '00000000-0000-4000-8000-00000001ff03',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: EDGE_WITHDRAW_TARGET_NODE_ID,
          wording: 'Target claim.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001ff04',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 4,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: EDGE_WITHDRAW_TARGET_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      // Source node — the first envelope of the two-envelope chain
      // just minted this.
      {
        id: '00000000-0000-4000-8000-00000001ff05',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: EDGE_WITHDRAW_SOURCE_NODE_ID,
          wording: 'Source claim.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001ff06',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 6,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: EDGE_WITHDRAW_SOURCE_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      // The connecting propose-time fan-out — `edge-created` +
      // `entity-included(edge)` + `proposal`.
      {
        id: '00000000-0000-4000-8000-00000001ff07',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 7,
        kind: 'edge-created',
        actor: FIXTURE_USER_ID,
        payload: {
          edge_id: EDGE_WITHDRAW_EDGE_ID,
          role: 'supports',
          source_node_id: EDGE_WITHDRAW_SOURCE_NODE_ID,
          target_node_id: EDGE_WITHDRAW_TARGET_NODE_ID,
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-00000001ff08',
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 8,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'edge',
          entity_id: EDGE_WITHDRAW_EDGE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: EDGE_WITHDRAW_PROPOSAL_EVENT_ID,
        session_id: EDGE_WITHDRAW_SESSION_ID,
        sequence: 9,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'set-edge-substance',
            edge_id: EDGE_WITHDRAW_EDGE_ID,
            value: 'agreed',
            source_node_id: EDGE_WITHDRAW_SOURCE_NODE_ID,
            target_node_id: EDGE_WITHDRAW_TARGET_NODE_ID,
            role: 'supports',
          },
        },
        created_at: t(2),
      },

      // ---- DECOMPOSE_WITHDRAW_SESSION_ID ----
      // FIXTURE_USER_ID hosts + decomposes a parent into 2 components
      // per `mod_decompose_propose_time_canvas_visibility`. Pre-state:
      // the parent node already exists (committed via a prior
      // classify-node cycle, simplified here to a direct `node-created`
      // + `entity-included` pair). The propose-time fan-out emitted
      // per-component `node-created` + `entity-included` for both
      // components, followed by the `proposal` envelope.
      // MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-0000000200a01',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Decompose-withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-0000000200a02',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
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
      // Parent node — already on the canvas before the decompose
      // propose lands.
      {
        id: '00000000-0000-4000-8000-0000000200a03',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: DECOMPOSE_PARENT_NODE_ID,
          wording: 'Parent claim to decompose.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-0000000200a04',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 4,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: DECOMPOSE_PARENT_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      // Propose-time fan-out — component A node-created + entity-included.
      {
        id: '00000000-0000-4000-8000-0000000200a05',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: DECOMPOSE_COMPONENT_A_NODE_ID,
          wording: 'Component A wording.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-0000000200a06',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 6,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: DECOMPOSE_COMPONENT_A_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      // Propose-time fan-out — component B node-created + entity-included.
      {
        id: '00000000-0000-4000-8000-0000000200a07',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 7,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: DECOMPOSE_COMPONENT_B_NODE_ID,
          wording: 'Component B wording.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-0000000200a08',
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 8,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: DECOMPOSE_COMPONENT_B_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      // The decompose proposal envelope itself — carries per-component
      // node_id values per `mod_decompose_propose_time_canvas_visibility`.
      {
        id: DECOMPOSE_WITHDRAW_PROPOSAL_EVENT_ID,
        session_id: DECOMPOSE_WITHDRAW_SESSION_ID,
        sequence: 9,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'decompose',
            parent_node_id: DECOMPOSE_PARENT_NODE_ID,
            components: [
              {
                wording: 'Component A wording.',
                classification: 'fact',
                node_id: DECOMPOSE_COMPONENT_A_NODE_ID,
              },
              {
                wording: 'Component B wording.',
                classification: 'value',
                node_id: DECOMPOSE_COMPONENT_B_NODE_ID,
              },
            ],
          },
        },
        created_at: t(3),
      },

      // ---- SPLIT_WITHDRAW_SESSION_ID ----
      // FIXTURE_USER_ID hosts + interpretively-splits a parent into 2
      // readings per `mod_decompose_propose_time_canvas_visibility`.
      // Same shape as the decompose seed but with the `readings` array
      // on the proposal payload. MAX(sequence) = 9.
      {
        id: '00000000-0000-4000-8000-0000000200b01',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 1,
        kind: 'session-created',
        actor: FIXTURE_USER_ID,
        payload: {
          host_user_id: FIXTURE_USER_ID,
          privacy: 'public',
          topic: 'Interpretive-split-withdraw test',
          created_at: t(0).toISOString(),
        },
        created_at: t(0),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b02',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
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
        id: '00000000-0000-4000-8000-0000000200b03',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 3,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: SPLIT_PARENT_NODE_ID,
          wording: 'Parent claim to interpretively split.',
          created_by: FIXTURE_USER_ID,
          created_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b04',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 4,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: SPLIT_PARENT_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(2).toISOString(),
        },
        created_at: t(2),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b05',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 5,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: SPLIT_READING_A_NODE_ID,
          wording: 'Reading A wording.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b06',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 6,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: SPLIT_READING_A_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b07',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 7,
        kind: 'node-created',
        actor: FIXTURE_USER_ID,
        payload: {
          node_id: SPLIT_READING_B_NODE_ID,
          wording: 'Reading B wording.',
          created_by: FIXTURE_USER_ID,
          created_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: '00000000-0000-4000-8000-0000000200b08',
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 8,
        kind: 'entity-included',
        actor: FIXTURE_USER_ID,
        payload: {
          entity_kind: 'node',
          entity_id: SPLIT_READING_B_NODE_ID,
          included_by: FIXTURE_USER_ID,
          included_at: t(3).toISOString(),
        },
        created_at: t(3),
      },
      {
        id: SPLIT_WITHDRAW_PROPOSAL_EVENT_ID,
        session_id: SPLIT_WITHDRAW_SESSION_ID,
        sequence: 9,
        kind: 'proposal',
        actor: FIXTURE_USER_ID,
        payload: {
          proposal: {
            kind: 'interpretive-split',
            parent_node_id: SPLIT_PARENT_NODE_ID,
            readings: [
              {
                wording: 'Reading A wording.',
                classification: 'fact',
                node_id: SPLIT_READING_A_NODE_ID,
              },
              {
                wording: 'Reading B wording.',
                classification: 'value',
                node_id: SPLIT_READING_B_NODE_ID,
              },
            ],
          },
        },
        created_at: t(3),
      },
    ],
  };

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

      // Auth middleware SELECT.
      if (text.includes('SELECT id, screen_name') && text.includes('WHERE id')) {
        const id = p[0] as string;
        if (id === FIXTURE_USER_ID) {
          return Promise.resolve({
            rows: [{ id: FIXTURE_USER_ID, screen_name: FIXTURE_SCREEN_NAME }] as unknown as TRow[],
          });
        }
        return Promise.resolve({ rows: [] as TRow[] });
      }

      // `canSeeSession` — visibility-gated SELECT 1.
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

      // FOR UPDATE on `sessions` inside the withdraw handler's transaction.
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

      // MAX(sequence) for the optimistic-concurrency check.
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

      // Event-log SELECT for projection-load.
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

      // INSERT INTO session_events via `appendSessionEvent`.
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
      return Promise.reject(new Error(`unexpected SQL in WS withdraw test pool: ${text}`));
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
const SUB_MSG_ID = '11111111-1111-4111-8111-1111111110a1';
const WITHDRAW_MSG_ID = '22222222-2222-4222-8222-2222222220a1';

function subscribeFrame(messageId: string, sessionId: string): string {
  return JSON.stringify({ type: 'subscribe', id: messageId, payload: { sessionId } });
}

function withdrawFrame(
  messageId: string,
  sessionId: string,
  expectedSequence: number,
  proposalEventId: string,
): string {
  return JSON.stringify({
    type: 'withdraw-proposal',
    id: messageId,
    payload: { sessionId, expectedSequence, proposalEventId },
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

describe('ws_withdraw_proposal_message — handler integration', () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(async () => {
    const built = makeWithdrawPool();
    store = built.store;
    app = await buildHandlerApp(built.pool);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an unsubscribed withdraw with a `forbidden` wire error and does NOT append an event', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Skip subscribe — go straight to withdraw.
      ws.send(withdrawFrame(WITHDRAW_MSG_ID, WITHDRAWABLE_SESSION_ID, 5, PROPOSAL_EVENT_ID));

      const errRaw = await next();
      const err = JSON.parse(errRaw) as {
        type?: unknown;
        inResponseTo?: unknown;
        payload?: { code?: unknown; message?: unknown };
      };
      expect(err.type).toBe('error');
      expect(err.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(err.payload?.code).toBe('forbidden');
      expect(typeof err.payload?.message).toBe('string');

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === WITHDRAWABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw for a non-visible session with `not-found` (existence-non-leak)', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      // Forcibly mark this connection as subscribed to HIDDEN_SESSION_ID,
      // bypassing the subscribe handler's visibility gate to isolate the
      // withdraw handler's own gate (mirrors the commit/vote test approach).
      const conns = (await import('../connection.js')).__getOpenConnectionsForTests();
      expect(conns.length).toBe(1);
      const connectionId = conns[0]!.connectionId;
      app.wsSubscriptions.subscribe(connectionId, HIDDEN_SESSION_ID);

      ws.send(withdrawFrame(WITHDRAW_MSG_ID, HIDDEN_SESSION_ID, 0, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('not-found');
    } finally {
      ws.terminate();
    }
  });

  it('rejects a stale `expectedSequence` with a `sequence-mismatch` wire error', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, WITHDRAWABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Seed MAX(sequence) is 5; expectedSequence=4 is stale.
      ws.send(withdrawFrame(WITHDRAW_MSG_ID, WITHDRAWABLE_SESSION_ID, 4, PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('sequence-mismatch');

      const eventCount = store.events.filter(
        (e) => e.session_id === WITHDRAWABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw for an unknown proposalEventId with `proposal-not-found`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, WITHDRAWABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      ws.send(
        withdrawFrame(WITHDRAW_MSG_ID, WITHDRAWABLE_SESSION_ID, 5, UNKNOWN_PROPOSAL_EVENT_ID),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('proposal-not-found');

      const eventCount = store.events.filter(
        (e) => e.session_id === WITHDRAWABLE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('HEADLINE: rejects a non-proposer subscribed participant attempting withdraw with `forbidden`', async () => {
    // FIXTURE_USER_ID is a debater-A in NON_PROPOSER_SESSION_ID; the
    // pending proposal was minted by OTHER_HOST_ID. FIXTURE_USER_ID
    // passes subscribe (they're a participant), passes visibility (the
    // session is public), and the proposer-only authority gate fires
    // with `forbidden`. This is the headline gate for this handler.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_PROPOSER_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for NON_PROPOSER_SESSION_ID is 6.
      ws.send(
        withdrawFrame(WITHDRAW_MSG_ID, NON_PROPOSER_SESSION_ID, 6, NON_PROPOSER_PROPOSAL_EVENT_ID),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('forbidden');
      expect(typeof payload.message).toBe('string');
      // The message names BOTH the requester and the original proposer
      // so logs + on-wire diagnostics are unambiguous.
      expect(String(payload.message)).toContain(FIXTURE_USER_ID);
      expect(String(payload.message)).toContain(OTHER_HOST_ID);

      // No new event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_PROPOSER_SESSION_ID,
      ).length;
      expect(eventCount).toBe(6);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw of an already-committed proposal with `proposal-already-committed`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, COMMITTED_PROPOSAL_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for COMMITTED_PROPOSAL_SESSION_ID is 11.
      ws.send(
        withdrawFrame(
          WITHDRAW_MSG_ID,
          COMMITTED_PROPOSAL_SESSION_ID,
          11,
          COMMITTED_PROPOSAL_EVENT_ID,
        ),
      );

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('proposal-already-committed');

      const eventCount = store.events.filter(
        (e) => e.session_id === COMMITTED_PROPOSAL_SESSION_ID,
      ).length;
      expect(eventCount).toBe(11);
    } finally {
      ws.terminate();
    }
  });

  it('rejects a withdraw of an already-meta-disagreement-marked proposal with `proposal-already-meta-disagreement`', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, META_DISAGREE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for META_DISAGREE_SESSION_ID is 9.
      ws.send(withdrawFrame(WITHDRAW_MSG_ID, META_DISAGREE_SESSION_ID, 9, META_PROPOSAL_EVENT_ID));

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(payload.code).toBe('proposal-already-meta-disagreement');

      const eventCount = store.events.filter(
        (e) => e.session_id === META_DISAGREE_SESSION_ID,
      ).length;
      expect(eventCount).toBe(9);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + proposer + classify-node propose → one entity-removed(node) + event-applied broadcast + proposal-withdrawn ack on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, WITHDRAWABLE_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // Withdraw the classify-node proposal. MAX(sequence) = 5; the
      // single entity-removed event lands at seq 6.
      ws.send(withdrawFrame(WITHDRAW_MSG_ID, WITHDRAWABLE_SESSION_ID, 5, PROPOSAL_EVENT_ID));

      // The proposer receives BOTH the `event-applied` broadcast AND
      // the `proposal-withdrawn` ack (the proposer is also a
      // subscriber). Read both tolerantly.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('proposal-withdrawn');
      expect(types).toContain('event-applied');

      // `proposal-withdrawn` ack assertions.
      const ack = frames.find((f) => f.type === 'proposal-withdrawn') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: {
              sessionId?: unknown;
              proposalEventId?: unknown;
              removedEventCount?: unknown;
            };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(ack?.id).toMatch(UUID_V4_PATTERN);
      expect(ack?.payload?.sessionId).toBe(WITHDRAWABLE_SESSION_ID);
      expect(ack?.payload?.proposalEventId).toBe(PROPOSAL_EVENT_ID);
      expect(ack?.payload?.removedEventCount).toBe(1);

      // `event-applied` broadcast carries an `entity-removed(node)`
      // for NODE_ID.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: {
                kind?: unknown;
                sequence?: unknown;
                sessionId?: unknown;
                actor?: unknown;
                payload?: {
                  entity_kind?: unknown;
                  entity_id?: unknown;
                  removed_by?: unknown;
                  removed_at?: unknown;
                };
              };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('entity-removed');
      expect(applied?.payload?.event?.sequence).toBe(6);
      expect(applied?.payload?.event?.sessionId).toBe(WITHDRAWABLE_SESSION_ID);
      expect(applied?.payload?.event?.actor).toBe(FIXTURE_USER_ID);
      const innerPayload = applied?.payload?.event?.payload;
      expect(innerPayload?.entity_kind).toBe('node');
      expect(innerPayload?.entity_id).toBe(NODE_ID);
      expect(innerPayload?.removed_by).toBe(FIXTURE_USER_ID);
      expect(typeof innerPayload?.removed_at).toBe('string');

      // The entity-removed event was appended to the store at seq 6.
      const appended = store.events.find(
        (e) => e.session_id === WITHDRAWABLE_SESSION_ID && e.sequence === 6,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('entity-removed');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      const appendedPayload = appended?.payload as
        | {
            entity_kind?: unknown;
            entity_id?: unknown;
            removed_by?: unknown;
          }
        | undefined;
      expect(appendedPayload?.entity_kind).toBe('node');
      expect(appendedPayload?.entity_id).toBe(NODE_ID);
      expect(appendedPayload?.removed_by).toBe(FIXTURE_USER_ID);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + proposer + zero-emission sub-kind (set-node-substance) → no entity-removed events + ack with removedEventCount: 0', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NO_EMIT_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) for NO_EMIT_SESSION_ID is 5.
      ws.send(withdrawFrame(WITHDRAW_MSG_ID, NO_EMIT_SESSION_ID, 5, NO_EMIT_PROPOSAL_EVENT_ID));

      // No event-applied broadcast should arrive (zero-emission). The
      // ack lands directly. Read the next frame and expect it to be
      // the ack.
      const ack = await readUntilType(next, 'proposal-withdrawn');
      expect(ack.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      const ackPayload = ack.parsed.payload as {
        sessionId?: unknown;
        proposalEventId?: unknown;
        removedEventCount?: unknown;
      };
      expect(ackPayload.sessionId).toBe(NO_EMIT_SESSION_ID);
      expect(ackPayload.proposalEventId).toBe(NO_EMIT_PROPOSAL_EVENT_ID);
      expect(ackPayload.removedEventCount).toBe(0);

      // No event was appended — the store still has MAX(sequence)=5.
      const eventCount = store.events.filter((e) => e.session_id === NO_EMIT_SESSION_ID).length;
      expect(eventCount).toBe(5);
    } finally {
      ws.terminate();
    }
  });

  it('SECURITY: ignores any client-supplied `proposerId` field on the payload — authority is from the authenticated connection', async () => {
    // FIXTURE_USER_ID is a debater-A in NON_PROPOSER_SESSION_ID (not
    // the original proposer). The client sends a `withdraw-proposal`
    // envelope with an EXTRA `proposerId` field naming OTHER_HOST_ID
    // (the actual proposer) in an attempt to impersonate the proposer.
    // The wire schema strips unknown fields on parse; even if it
    // didn't, the handler uses `connection.user.id` regardless. The
    // authority check sees FIXTURE_USER_ID and rejects with
    // `forbidden` — the spoof has zero effect on authority. This is
    // the security invariant pinned in this test.
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, NON_PROPOSER_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      const spoofedFrame = JSON.stringify({
        type: 'withdraw-proposal',
        id: WITHDRAW_MSG_ID,
        payload: {
          sessionId: NON_PROPOSER_SESSION_ID,
          expectedSequence: 6,
          proposalEventId: NON_PROPOSER_PROPOSAL_EVENT_ID,
          proposerId: OTHER_HOST_ID, // <-- spoof attempt
        },
      });
      ws.send(spoofedFrame);

      const err = await readUntilType(next, 'error');
      const payload = err.parsed.payload as { code?: unknown; message?: unknown };
      expect(err.parsed.inResponseTo).toBe(WITHDRAW_MSG_ID);
      // The handler reads `connection.user.id` (FIXTURE_USER_ID, the
      // authenticated debater) and matches against the projection's
      // `proposer` (OTHER_HOST_ID) — the match fails, rejection is
      // `forbidden`. The spoofed `proposerId` field has zero effect.
      expect(payload.code).toBe('forbidden');
      expect(String(payload.message)).toContain(FIXTURE_USER_ID);
      expect(String(payload.message)).toContain(OTHER_HOST_ID);

      // No event appended.
      const eventCount = store.events.filter(
        (e) => e.session_id === NON_PROPOSER_SESSION_ID,
      ).length;
      expect(eventCount).toBe(6);
    } finally {
      ws.terminate();
    }
  });

  // Per `mod_set_edge_substance_endpoint_carriage` the
  // propose-handler now emits `edge-created` + `entity-included` for
  // the connecting `set-edge-substance` case (three optional endpoint
  // fields present, projection.getEdge returns undefined). The
  // inverse-pair invariant (D3 of
  // `ws_withdraw_proposal_message.md`) requires the
  // `entitiesToRetractForWithdraw` switch to grow a matching
  // `'set-edge-substance' → entity-removed(edge)` arm in lockstep.
  // This test pins that arm: withdrawing a connecting
  // `set-edge-substance` proposal emits exactly one
  // `entity-removed(edge)` event whose `entity_id` matches the
  // proposal's `edge_id`.
  it('subscribed + visible + proposer + connecting set-edge-substance propose → one entity-removed(edge) + event-applied broadcast + proposal-withdrawn ack on the same socket', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, EDGE_WITHDRAW_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) = 9; the single entity-removed(edge) lands at seq 10.
      ws.send(
        withdrawFrame(
          WITHDRAW_MSG_ID,
          EDGE_WITHDRAW_SESSION_ID,
          9,
          EDGE_WITHDRAW_PROPOSAL_EVENT_ID,
        ),
      );

      // Proposer receives BOTH `event-applied` broadcast AND the
      // `proposal-withdrawn` ack (proposer is also a subscriber).
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 2; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('proposal-withdrawn');
      expect(types).toContain('event-applied');

      // `proposal-withdrawn` ack assertions.
      const ack = frames.find((f) => f.type === 'proposal-withdrawn') as
        | {
            id?: unknown;
            inResponseTo?: unknown;
            payload?: {
              sessionId?: unknown;
              proposalEventId?: unknown;
              removedEventCount?: unknown;
            };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(ack?.id).toMatch(UUID_V4_PATTERN);
      expect(ack?.payload?.sessionId).toBe(EDGE_WITHDRAW_SESSION_ID);
      expect(ack?.payload?.proposalEventId).toBe(EDGE_WITHDRAW_PROPOSAL_EVENT_ID);
      expect(ack?.payload?.removedEventCount).toBe(1);

      // `event-applied` broadcast carries an `entity-removed(edge)`
      // for EDGE_WITHDRAW_EDGE_ID.
      const applied = frames.find((f) => f.type === 'event-applied') as
        | {
            payload?: {
              event?: {
                kind?: unknown;
                sequence?: unknown;
                sessionId?: unknown;
                actor?: unknown;
                payload?: {
                  entity_kind?: unknown;
                  entity_id?: unknown;
                  removed_by?: unknown;
                  removed_at?: unknown;
                };
              };
            };
          }
        | undefined;
      expect(applied?.payload?.event?.kind).toBe('entity-removed');
      expect(applied?.payload?.event?.sequence).toBe(10);
      expect(applied?.payload?.event?.sessionId).toBe(EDGE_WITHDRAW_SESSION_ID);
      expect(applied?.payload?.event?.actor).toBe(FIXTURE_USER_ID);
      const innerPayload = applied?.payload?.event?.payload;
      expect(innerPayload?.entity_kind).toBe('edge');
      expect(innerPayload?.entity_id).toBe(EDGE_WITHDRAW_EDGE_ID);
      expect(innerPayload?.removed_by).toBe(FIXTURE_USER_ID);
      expect(typeof innerPayload?.removed_at).toBe('string');

      // The entity-removed event was appended to the store at seq 10.
      const appended = store.events.find(
        (e) => e.session_id === EDGE_WITHDRAW_SESSION_ID && e.sequence === 10,
      );
      expect(appended).toBeDefined();
      expect(appended?.kind).toBe('entity-removed');
      expect(appended?.actor).toBe(FIXTURE_USER_ID);
      const appendedPayload = appended?.payload as
        | {
            entity_kind?: unknown;
            entity_id?: unknown;
            removed_by?: unknown;
          }
        | undefined;
      expect(appendedPayload?.entity_kind).toBe('edge');
      expect(appendedPayload?.entity_id).toBe(EDGE_WITHDRAW_EDGE_ID);
      expect(appendedPayload?.removed_by).toBe(FIXTURE_USER_ID);
    } finally {
      ws.terminate();
    }
  });

  // Per `mod_decompose_propose_time_canvas_visibility` the propose
  // handler now emits per-component `node-created` + `entity-included`
  // for `decompose` and `interpretive-split` at propose-time. The
  // inverse-pair invariant (D3 of `ws_withdraw_proposal_message.md` +
  // D4 of `mod_decompose_propose_time_canvas_visibility.md`) requires
  // the `entitiesToRetractForWithdraw` switch to grow matching
  // `'decompose' → N × entity-removed(node)` and
  // `'interpretive-split' → N × entity-removed(node)` arms in
  // lockstep. These two tests pin those arms.
  it('subscribed + visible + proposer + 2-component decompose propose → two entity-removed(node) events + event-applied broadcasts + proposal-withdrawn ack with removedEventCount: 2', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, DECOMPOSE_WITHDRAW_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) = 9; the two entity-removed events land at seq 10 + 11.
      ws.send(
        withdrawFrame(
          WITHDRAW_MSG_ID,
          DECOMPOSE_WITHDRAW_SESSION_ID,
          9,
          DECOMPOSE_WITHDRAW_PROPOSAL_EVENT_ID,
        ),
      );

      // Proposer receives 2 `event-applied` broadcasts + 1 ack — 3 frames total.
      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 3; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('proposal-withdrawn');
      expect(types.filter((t) => t === 'event-applied')).toHaveLength(2);

      // Ack assertions.
      const ack = frames.find((f) => f.type === 'proposal-withdrawn') as
        | {
            inResponseTo?: unknown;
            payload?: {
              sessionId?: unknown;
              proposalEventId?: unknown;
              removedEventCount?: unknown;
            };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(ack?.payload?.sessionId).toBe(DECOMPOSE_WITHDRAW_SESSION_ID);
      expect(ack?.payload?.proposalEventId).toBe(DECOMPOSE_WITHDRAW_PROPOSAL_EVENT_ID);
      expect(ack?.payload?.removedEventCount).toBe(2);

      // The two event-applied broadcasts carry `entity-removed(node)`
      // for the two components, in proposal-payload array order.
      const applieds = frames.filter((f) => f.type === 'event-applied') as Array<{
        payload?: {
          event?: {
            kind?: unknown;
            sequence?: unknown;
            payload?: { entity_kind?: unknown; entity_id?: unknown; removed_by?: unknown };
          };
        };
      }>;
      // Sort by sequence to be deterministic regardless of arrival order.
      const sorted = applieds
        .slice()
        .sort(
          (a, b) => (a.payload?.event?.sequence as number) - (b.payload?.event?.sequence as number),
        );
      expect(sorted[0]?.payload?.event?.kind).toBe('entity-removed');
      expect(sorted[0]?.payload?.event?.sequence).toBe(10);
      expect(sorted[0]?.payload?.event?.payload?.entity_kind).toBe('node');
      expect(sorted[0]?.payload?.event?.payload?.entity_id).toBe(DECOMPOSE_COMPONENT_A_NODE_ID);
      expect(sorted[0]?.payload?.event?.payload?.removed_by).toBe(FIXTURE_USER_ID);

      expect(sorted[1]?.payload?.event?.kind).toBe('entity-removed');
      expect(sorted[1]?.payload?.event?.sequence).toBe(11);
      expect(sorted[1]?.payload?.event?.payload?.entity_kind).toBe('node');
      expect(sorted[1]?.payload?.event?.payload?.entity_id).toBe(DECOMPOSE_COMPONENT_B_NODE_ID);

      // The parent node is NOT retracted — the propose-time emission
      // never touched its visibility (the parent flips invisible only
      // on commit per `apps/server/src/projection/replay.ts:691-711`).
      const removedEntityIds = store.events
        .filter(
          (e) => e.session_id === DECOMPOSE_WITHDRAW_SESSION_ID && e.kind === 'entity-removed',
        )
        .map((e) => (e.payload as { entity_id?: string }).entity_id);
      expect(removedEntityIds).not.toContain(DECOMPOSE_PARENT_NODE_ID);
      expect(removedEntityIds).toContain(DECOMPOSE_COMPONENT_A_NODE_ID);
      expect(removedEntityIds).toContain(DECOMPOSE_COMPONENT_B_NODE_ID);
    } finally {
      ws.terminate();
    }
  });

  it('subscribed + visible + proposer + 2-reading interpretive-split propose → two entity-removed(node) events + event-applied broadcasts + proposal-withdrawn ack with removedEventCount: 2', async () => {
    const cookie = await fixtureCookieHeader();
    const { ws, next } = await openWsClient(app, cookie);
    try {
      await next(); // hello

      ws.send(subscribeFrame(SUB_MSG_ID, SPLIT_WITHDRAW_SESSION_ID));
      const subAck = JSON.parse(await next()) as { type?: unknown };
      expect(subAck.type).toBe('subscribed');

      // MAX(sequence) = 9; the two entity-removed events land at seq 10 + 11.
      ws.send(
        withdrawFrame(
          WITHDRAW_MSG_ID,
          SPLIT_WITHDRAW_SESSION_ID,
          9,
          SPLIT_WITHDRAW_PROPOSAL_EVENT_ID,
        ),
      );

      const frames: Record<string, unknown>[] = [];
      for (let i = 0; i < 3; i++) {
        const raw = await next();
        frames.push(JSON.parse(raw) as Record<string, unknown>);
      }
      const types = frames.map((f) => f.type);
      expect(types).toContain('proposal-withdrawn');
      expect(types.filter((t) => t === 'event-applied')).toHaveLength(2);

      const ack = frames.find((f) => f.type === 'proposal-withdrawn') as
        | {
            inResponseTo?: unknown;
            payload?: {
              sessionId?: unknown;
              proposalEventId?: unknown;
              removedEventCount?: unknown;
            };
          }
        | undefined;
      expect(ack?.inResponseTo).toBe(WITHDRAW_MSG_ID);
      expect(ack?.payload?.sessionId).toBe(SPLIT_WITHDRAW_SESSION_ID);
      expect(ack?.payload?.proposalEventId).toBe(SPLIT_WITHDRAW_PROPOSAL_EVENT_ID);
      expect(ack?.payload?.removedEventCount).toBe(2);

      const applieds = frames.filter((f) => f.type === 'event-applied') as Array<{
        payload?: {
          event?: {
            kind?: unknown;
            sequence?: unknown;
            payload?: { entity_kind?: unknown; entity_id?: unknown };
          };
        };
      }>;
      const sorted = applieds
        .slice()
        .sort(
          (a, b) => (a.payload?.event?.sequence as number) - (b.payload?.event?.sequence as number),
        );
      expect(sorted[0]?.payload?.event?.kind).toBe('entity-removed');
      expect(sorted[0]?.payload?.event?.sequence).toBe(10);
      expect(sorted[0]?.payload?.event?.payload?.entity_kind).toBe('node');
      expect(sorted[0]?.payload?.event?.payload?.entity_id).toBe(SPLIT_READING_A_NODE_ID);

      expect(sorted[1]?.payload?.event?.kind).toBe('entity-removed');
      expect(sorted[1]?.payload?.event?.sequence).toBe(11);
      expect(sorted[1]?.payload?.event?.payload?.entity_kind).toBe('node');
      expect(sorted[1]?.payload?.event?.payload?.entity_id).toBe(SPLIT_READING_B_NODE_ID);

      // The parent node is NOT retracted.
      const removedEntityIds = store.events
        .filter((e) => e.session_id === SPLIT_WITHDRAW_SESSION_ID && e.kind === 'entity-removed')
        .map((e) => (e.payload as { entity_id?: string }).entity_id);
      expect(removedEntityIds).not.toContain(SPLIT_PARENT_NODE_ID);
      expect(removedEntityIds).toContain(SPLIT_READING_A_NODE_ID);
      expect(removedEntityIds).toContain(SPLIT_READING_B_NODE_ID);
    } finally {
      ws.terminate();
    }
  });
});
