// Tests for the event-log replay dispatcher.
//
// Refinement: tasks/refinements/data-and-methodology/project_from_log.md
// TaskJuggler: data_and_methodology.projection.project_from_log
//
// Coverage:
//   - Per-event-kind happy paths.
//   - Negative cases for cross-event referential consistency
//     (vote / commit / meta-disagreement-marked of an unknown
//     proposal id throws `ReplayError`).
//   - Visible-graph rule: decompose commit makes the parent
//     not-visible.
//   - Round-trip property: replay-from-log === iterative-apply.
//   - The walkthrough: 3 participants, 2 nodes, 1 edge, classify
//     proposal, 3 agree votes, commit. Asserts final projection
//     state.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { deriveFacetStatus } from './facet-status.js';
import { createEmptyProjection } from './projection.js';
import { applyEvent, projectFromLog, ReplayError } from './replay.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_ID_1 = '66666666-6666-4666-8666-666666666666';
const NODE_ID_2 = '77777777-7777-4777-8777-777777777777';
const NODE_ID_3 = '88888888-8888-4888-8888-888888888888';
const EDGE_ID_1 = '99999999-9999-4999-8999-999999999999';
const ANNOTATION_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const PROPOSAL_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const NEW_NODE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SNAPSHOT_ID_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
const T4 = '2026-05-10T12:00:04Z';
const T5 = '2026-05-10T12:00:05Z';
const T6 = '2026-05-10T12:00:06Z';
const T7 = '2026-05-10T12:00:07Z';
const T8 = '2026-05-10T12:00:08Z';
const T9 = '2026-05-10T12:00:09Z';

function evId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeEvent<K extends Event['kind']>(
  sequence: number,
  kind: K,
  actor: string | null,
  createdAt: string,
  payload: Extract<Event, { kind: K }>['payload'],
): Extract<Event, { kind: K }> {
  return {
    id: evId(sequence),
    sessionId: SESSION_ID,
    sequence,
    kind,
    actor,
    payload,
    createdAt,
  } as Extract<Event, { kind: K }>;
}

// ---------------------------------------------------------------
// Per-event-kind happy paths.
// ---------------------------------------------------------------

describe('applyEvent — session-created / session-ended', () => {
  it('session-created sets sessionState=open; session-ended flips to ended', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test debate',
        created_at: T0,
      }),
    );
    expect(projection.sessionState).toBe('open');

    applyEvent(projection, makeEvent(2, 'session-ended', MODERATOR_ID, T1, { ended_at: T1 }));
    expect(projection.sessionState).toBe('ended');
  });
});

describe('applyEvent — session-mode-changed (ADR 0028)', () => {
  it('initial currentMode is "lobby" before any session-mode-changed event applies', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(projection.currentMode).toBe('lobby');
  });

  it('session-mode-changed with new_mode "operate" flips currentMode and emits a change-feed entry', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test debate',
        created_at: T0,
      }),
    );
    expect(projection.currentMode).toBe('lobby');

    const changes = applyEvent(
      projection,
      makeEvent(2, 'session-mode-changed', MODERATOR_ID, T1, {
        previous_mode: 'lobby',
        new_mode: 'operate',
        changed_by: MODERATOR_ID,
        changed_at: T1,
      }),
    );
    expect(projection.currentMode).toBe('operate');
    const transition = changes.find((c) => c.kind === 'session-mode-changed');
    expect(transition).toBeDefined();
    if (transition?.kind === 'session-mode-changed') {
      expect(transition.previousMode).toBe('lobby');
      expect(transition.newMode).toBe('operate');
    }
  });

  it('replay-order invariance: applying the same event log step-by-step yields the same currentMode', () => {
    const projectionA = createEmptyProjection(SESSION_ID);
    const projectionB = createEmptyProjection(SESSION_ID);
    const events = [
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test debate',
        created_at: T0,
      }),
      makeEvent(2, 'session-mode-changed', MODERATOR_ID, T1, {
        previous_mode: 'lobby' as const,
        new_mode: 'operate' as const,
        changed_by: MODERATOR_ID,
        changed_at: T1,
      }),
    ];
    for (const event of events) applyEvent(projectionA, event);
    projectFromLog(events, SESSION_ID);
    const projB = projectFromLog(events, SESSION_ID);
    void projectionB;
    expect(projectionA.currentMode).toBe('operate');
    expect(projB.currentMode).toBe('operate');
    expect(projectionA.currentMode).toBe(projB.currentMode);
  });
});

describe('applyEvent — participant-joined / participant-left', () => {
  it('joined adds the participant; left flips their leftAt', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'participant-joined', MODERATOR_ID, T0, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T0,
      }),
    );
    expect(projection.currentParticipants().map((p) => p.userId)).toEqual([MODERATOR_ID]);

    applyEvent(
      projection,
      makeEvent(2, 'participant-left', MODERATOR_ID, T1, {
        user_id: MODERATOR_ID,
        left_at: T1,
      }),
    );
    expect(projection.currentParticipants()).toEqual([]);
    const history = projection.getParticipantHistory(MODERATOR_ID);
    expect(history.length).toBe(1);
    expect(history[0]?.leftAt).toBe(T1);
  });

  it('rejoin appends a fresh row to the same userId history', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'participant-joined', DEBATER_A_ID, T0, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T0,
      }),
    );
    applyEvent(
      projection,
      makeEvent(2, 'participant-left', DEBATER_A_ID, T1, {
        user_id: DEBATER_A_ID,
        left_at: T1,
      }),
    );
    applyEvent(
      projection,
      makeEvent(3, 'participant-joined', DEBATER_A_ID, T2, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T2,
      }),
    );
    const history = projection.getParticipantHistory(DEBATER_A_ID);
    expect(history.length).toBe(2);
    expect(history[0]?.leftAt).toBe(T1);
    expect(history[1]?.leftAt).toBeNull();
    expect(projection.currentParticipants().length).toBe(1);
  });

  it('participant-joined for an already-joined user throws via ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'participant-joined', DEBATER_A_ID, T0, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T0,
      }),
    );
    expect(() =>
      applyEvent(
        projection,
        makeEvent(2, 'participant-joined', DEBATER_A_ID, T1, {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: T1,
        }),
      ),
    ).toThrow(ReplayError);
  });

  it('participant-left for a never-joined user throws via ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      applyEvent(
        projection,
        makeEvent(1, 'participant-left', DEBATER_A_ID, T0, {
          user_id: DEBATER_A_ID,
          left_at: T0,
        }),
      ),
    ).toThrow(ReplayError);
  });
});

describe('applyEvent — entity creation events', () => {
  it('node-created adds a node visible with proposed facets', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'Hello.',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    const node = projection.getNode(NODE_ID_1);
    expect(node?.wording).toBe('Hello.');
    expect(node?.visible).toBe(true);
    expect(node?.classificationFacet.status).toBe('proposed');
  });

  it('node-created with a duplicate id throws ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    expect(() =>
      applyEvent(
        projection,
        makeEvent(2, 'node-created', DEBATER_A_ID, T1, {
          node_id: NODE_ID_1,
          wording: 'b',
          created_by: DEBATER_A_ID,
          created_at: T1,
        }),
      ),
    ).toThrow(ReplayError);
  });

  it('edge-created adds an edge with the supplied role and endpoints', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEvent(
      projection,
      makeEvent(2, 'node-created', DEBATER_A_ID, T1, {
        node_id: NODE_ID_2,
        wording: 'b',
        created_by: DEBATER_A_ID,
        created_at: T1,
      }),
    );
    applyEvent(
      projection,
      makeEvent(3, 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_1,
        target_node_id: NODE_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    expect(projection.getEdge(EDGE_ID_1)?.role).toBe('supports');
    expect(projection.getEdgesBySource(NODE_ID_1).length).toBe(1);
  });

  it('annotation-created on a node lands on annotationsByNode', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEvent(
      projection,
      makeEvent(2, 'annotation-created', DEBATER_A_ID, T1, {
        annotation_id: ANNOTATION_ID_1,
        kind: 'note',
        content: 'Annotation.',
        target_node_id: NODE_ID_1,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T1,
      }),
    );
    expect(projection.getAnnotation(ANNOTATION_ID_1)?.content).toBe('Annotation.');
    expect(projection.getAnnotationsByNode(NODE_ID_1).length).toBe(1);
  });
});

describe('applyEvent — entity-included', () => {
  it('entity-included for an already-present node is a no-op', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEvent(
      projection,
      makeEvent(2, 'entity-included', MODERATOR_ID, T1, {
        entity_kind: 'node',
        entity_id: NODE_ID_1,
        included_by: MODERATOR_ID,
        included_at: T1,
      }),
    );
    expect(projection.getNode(NODE_ID_1)).toBeDefined();
    expect(projection.nodeCount()).toBe(1);
  });

  it('entity-included for an unknown node throws ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      applyEvent(
        projection,
        makeEvent(1, 'entity-included', MODERATOR_ID, T0, {
          entity_kind: 'node',
          entity_id: NODE_ID_1,
          included_by: MODERATOR_ID,
          included_at: T0,
        }),
      ),
    ).toThrow(ReplayError);
  });
});

// ---------------------------------------------------------------
// Proposal / vote / commit lifecycle (the walkthrough).
// ---------------------------------------------------------------

describe('applyEvent — proposal / vote / commit (classify-node)', () => {
  it('walkthrough: 3 participants, 2 nodes, 1 edge, classify proposal, 3 agree votes, commit', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const events: Event[] = [
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 'Test',
        created_at: T0,
      }),
      makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T1,
      }),
      makeEvent(3, 'participant-joined', DEBATER_A_ID, T1, {
        user_id: DEBATER_A_ID,
        role: 'debater-A',
        screen_name: 'A',
        joined_at: T1,
      }),
      makeEvent(4, 'participant-joined', DEBATER_B_ID, T1, {
        user_id: DEBATER_B_ID,
        role: 'debater-B',
        screen_name: 'B',
        joined_at: T1,
      }),
      makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
        node_id: NODE_ID_1,
        wording: 'Sky is blue.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
      makeEvent(6, 'node-created', DEBATER_B_ID, T3, {
        node_id: NODE_ID_2,
        wording: 'Sky reflects ocean.',
        created_by: DEBATER_B_ID,
        created_at: T3,
      }),
      makeEvent(7, 'edge-created', DEBATER_A_ID, T4, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_2,
        target_node_id: NODE_ID_1,
        created_by: DEBATER_A_ID,
        created_at: T4,
      }),
      {
        ...makeEvent(8, 'proposal', DEBATER_A_ID, T5, {
          proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
        }),
        id: PROPOSAL_ID_1,
      },
      makeEvent(9, 'vote', MODERATOR_ID, T6, {
        target: 'proposal' as const,
        proposal_id: PROPOSAL_ID_1,
        participant: MODERATOR_ID,
        choice: 'agree',
        voted_at: T6,
      }),
      makeEvent(10, 'vote', DEBATER_A_ID, T6, {
        target: 'proposal' as const,
        proposal_id: PROPOSAL_ID_1,
        participant: DEBATER_A_ID,
        choice: 'agree',
        voted_at: T6,
      }),
      makeEvent(11, 'vote', DEBATER_B_ID, T6, {
        target: 'proposal' as const,
        proposal_id: PROPOSAL_ID_1,
        participant: DEBATER_B_ID,
        choice: 'agree',
        voted_at: T6,
      }),
      makeEvent(12, 'commit', MODERATOR_ID, T7, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T7,
      }),
    ];
    for (const ev of events) applyEvent(projection, ev);

    expect(projection.nodeCount()).toBe(2);
    expect(projection.edgeCount()).toBe(1);
    expect(projection.getPendingProposal(PROPOSAL_ID_1)).toBeUndefined();
    expect(projection.pendingProposalCount()).toBe(0);
    const node = projection.getNode(NODE_ID_1);
    expect(node?.classificationFacet.value).toBe('fact');
    expect(node?.classificationFacet.status).toBe('agreed');
  });

  it('vote against an unknown proposal throws ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      applyEvent(
        projection,
        makeEvent(1, 'vote', DEBATER_A_ID, T0, {
          target: 'proposal' as const,
          proposal_id: PROPOSAL_ID_1,
          participant: DEBATER_A_ID,
          choice: 'agree',
          voted_at: T0,
        }),
      ),
    ).toThrow(ReplayError);
  });

  it('commit of an unknown proposal throws ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      applyEvent(
        projection,
        makeEvent(1, 'commit', MODERATOR_ID, T0, {
          target: 'proposal',
          proposal_id: PROPOSAL_ID_1,
          committed_by: MODERATOR_ID,
          committed_at: T0,
        }),
      ),
    ).toThrow(ReplayError);
  });
});

describe('applyEvent — meta-disagreement-marked', () => {
  it('removes the proposal from pendingProposals and records it as unresolved', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    const proposal: Event = {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      }),
      id: PROPOSAL_ID_1,
    };
    applyEvent(projection, proposal);
    applyEvent(
      projection,
      makeEvent(3, 'meta-disagreement-marked', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        marked_by: MODERATOR_ID,
        marked_at: T2,
      }),
    );
    expect(projection.getPendingProposal(PROPOSAL_ID_1)).toBeUndefined();
    expect(projection.getUnresolvedMetaDisagreement(PROPOSAL_ID_1)?.markedBy).toBe(MODERATOR_ID);
  });

  it('meta-disagreement-marked of an unknown proposal throws ReplayError', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(() =>
      applyEvent(
        projection,
        makeEvent(1, 'meta-disagreement-marked', MODERATOR_ID, T0, {
          target: 'proposal',
          proposal_id: PROPOSAL_ID_1,
          marked_by: MODERATOR_ID,
          marked_at: T0,
        }),
      ),
    ).toThrow(ReplayError);
  });
});

// ---------------------------------------------------------------
// Per-proposal-sub-kind structural commit effects.
// ---------------------------------------------------------------

function seedNodeAndProposal(
  events: Event[],
  proposalId: string,
  proposal: Extract<Event, { kind: 'proposal' }>['payload']['proposal'],
  startSeq: number,
): void {
  events.push({
    ...makeEvent(startSeq, 'proposal', DEBATER_A_ID, T1, { proposal }),
    id: proposalId,
  });
}

describe('commit effects — structural', () => {
  it('classify-node sets classification facet to the proposed value', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'classify-node', node_id: NODE_ID_1, classification: 'value' },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.classificationFacet.value).toBe('value');
  });

  it('set-node-substance sets the substance facet', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'set-node-substance', node_id: NODE_ID_1, value: 'agreed' },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.substanceFacet.value).toBe('agreed');
  });

  it('set-edge-substance sets the substance facet on the edge', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_2,
        wording: 'b',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(3, 'edge-created', DEBATER_A_ID, T0, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_1,
        target_node_id: NODE_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'set-edge-substance', edge_id: EDGE_ID_1, value: 'disputed' },
      4,
    );
    events.push(
      makeEvent(5, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getEdge(EDGE_ID_1)?.substanceFacet.value).toBe('disputed');
  });

  it('edit-wording (reword) updates wording in place', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'old',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'edit-wording',
        edit_kind: 'reword',
        node_id: NODE_ID_1,
        new_wording: 'new',
      },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.wording).toBe('new');
  });

  it('edit-wording (restructure) marks old node not-visible and keeps the new node visible', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'old',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'node-created', DEBATER_A_ID, T1, {
        node_id: NEW_NODE_ID,
        wording: 'replaced',
        created_by: DEBATER_A_ID,
        created_at: T1,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'edit-wording',
        edit_kind: 'restructure',
        node_id: NODE_ID_1,
        new_wording: 'replaced',
        new_node_id: NEW_NODE_ID,
      },
      3,
    );
    events.push(
      makeEvent(4, 'commit', MODERATOR_ID, T3, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T3,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.visible).toBe(false);
    expect(projection.getNode(NEW_NODE_ID)?.visible).toBe(true);
  });

  it('decompose commit makes the parent not-visible', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'parent',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'decompose',
        parent_node_id: NODE_ID_1,
        components: [
          {
            wording: 'c1',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000c001',
          },
          {
            wording: 'c2',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000c002',
          },
        ],
      },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.visible).toBe(false);
  });

  it('interpretive-split commit makes the parent not-visible', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'ambiguous',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'interpretive-split',
        parent_node_id: NODE_ID_1,
        readings: [
          {
            wording: 'reading1',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000c003',
          },
          {
            wording: 'reading2',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000c004',
          },
        ],
      },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.visible).toBe(false);
  });

  it('axiom-mark commit records the (node, participant) pair', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'axiom',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'axiom-mark', node_id: NODE_ID_1, participant: DEBATER_A_ID },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.axiomMarks.has(DEBATER_A_ID)).toBe(true);
  });

  it('break-edge commit marks the edge not-visible', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_2,
        wording: 'b',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(3, 'edge-created', DEBATER_A_ID, T0, {
        edge_id: EDGE_ID_1,
        role: 'supports',
        source_node_id: NODE_ID_1,
        target_node_id: NODE_ID_2,
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(events, PROPOSAL_ID_1, { kind: 'break-edge', edge_id: EDGE_ID_1 }, 4);
    events.push(
      makeEvent(5, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getEdge(EDGE_ID_1)?.visible).toBe(false);
  });

  it('amend-node commit updates the node wording in place', () => {
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'old',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'amend-node', node_id: NODE_ID_1, new_content: 'amended' },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    expect(projection.getNode(NODE_ID_1)?.wording).toBe('amended');
  });

  // -------------------------------------------------------------
  // Per-component facet-stamping cover for the two multi-component
  // sub-kinds (`decompose`, `interpretive-split`). Refinement:
  // tasks/refinements/data-and-methodology/
  //   replay_decompose_commit_marks_component_classification_committed.md
  // TaskJuggler:
  // data_and_methodology.methodology_engine.
  //   replay_decompose_commit_marks_component_classification_committed
  //
  // Per the refinement's D1: the per-component stamping happens at
  // the `handleCommit` call-site via the renamed plural
  // `facetTargetsForProposal` helper. Each component's classification
  // facet gets stamped with the parent decompose / interpretive-split
  // proposal event's id (per D4) and the commit event's `committed_at`
  // (per D5). Together with `deriveFacetStatus` rule 5 this flips
  // each component's classification facet from `'proposed'` to
  // `'committed'` post-commit.
  // -------------------------------------------------------------

  it('decompose commit stamps per-component classification facets with committedProposalEventId + committedAt', () => {
    const C1 = '00000000-0000-4000-8000-00000000c001';
    const C2 = '00000000-0000-4000-8000-00000000c002';
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'parent',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'participant-joined', MODERATOR_ID, T0, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T0,
      }),
      // Components are emitted by the propose handler as paired
      // `node-created` + `entity-included` events ahead of the
      // proposal event itself (per commit 166b407). Their facets
      // start as `'proposed'`.
      makeEvent(3, 'node-created', DEBATER_A_ID, T0, {
        node_id: C1,
        wording: 'c1',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(4, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: C1,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
      makeEvent(5, 'node-created', DEBATER_A_ID, T0, {
        node_id: C2,
        wording: 'c2',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(6, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: C2,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'decompose',
        parent_node_id: NODE_ID_1,
        components: [
          { wording: 'c1', classification: 'fact', node_id: C1 },
          { wording: 'c2', classification: 'fact', node_id: C2 },
        ],
      },
      7,
    );
    events.push(
      makeEvent(8, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );

    const projection = projectFromLog(events, SESSION_ID);

    // Both components' classification facets carry the SAME
    // commit pair — the parent proposal commits ONCE, expressed N
    // times for the N components (per D4 of the refinement).
    const c1 = projection.getNode(C1);
    const c2 = projection.getNode(C2);
    expect(c1?.classificationFacet.committedProposalEventId).toBe(PROPOSAL_ID_1);
    expect(c1?.classificationFacet.committedAt).toBe(T2);
    expect(c2?.classificationFacet.committedProposalEventId).toBe(PROPOSAL_ID_1);
    expect(c2?.classificationFacet.committedAt).toBe(T2);

    // `deriveFacetStatus` rule 5 returns `'committed'` once the
    // marker is stamped and no current dispute / withdraw exists.
    expect(deriveFacetStatus(projection, 'node', C1, 'classification')).toBe('committed');
    expect(deriveFacetStatus(projection, 'node', C2, 'classification')).toBe('committed');

    // The parent's classification facet is NOT touched by the
    // decompose commit — its commit-state derives from its own
    // prior `classify-node` commit (which this fixture doesn't
    // include, so the parent's marker stays `null`).
    const parent = projection.getNode(NODE_ID_1);
    expect(parent?.classificationFacet.committedProposalEventId).toBeNull();
    expect(parent?.classificationFacet.committedAt).toBeNull();

    // Structural-arm behaviour preserved.
    expect(parent?.visible).toBe(false);
  });

  it('interpretive-split commit stamps per-reading classification facets with committedProposalEventId + committedAt', () => {
    const R1 = '00000000-0000-4000-8000-00000000c003';
    const R2 = '00000000-0000-4000-8000-00000000c004';
    const R3 = '00000000-0000-4000-8000-00000000c005';
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'ambiguous',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'participant-joined', MODERATOR_ID, T0, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T0,
      }),
      makeEvent(3, 'node-created', DEBATER_A_ID, T0, {
        node_id: R1,
        wording: 'reading1',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(4, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: R1,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
      makeEvent(5, 'node-created', DEBATER_A_ID, T0, {
        node_id: R2,
        wording: 'reading2',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(6, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: R2,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
      makeEvent(7, 'node-created', DEBATER_A_ID, T0, {
        node_id: R3,
        wording: 'reading3',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(8, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: R3,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'interpretive-split',
        parent_node_id: NODE_ID_1,
        readings: [
          { wording: 'reading1', classification: 'fact', node_id: R1 },
          { wording: 'reading2', classification: 'fact', node_id: R2 },
          { wording: 'reading3', classification: 'fact', node_id: R3 },
        ],
      },
      9,
    );
    events.push(
      makeEvent(10, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );

    const projection = projectFromLog(events, SESSION_ID);

    for (const readingId of [R1, R2, R3]) {
      const reading = projection.getNode(readingId);
      expect(reading?.classificationFacet.committedProposalEventId).toBe(PROPOSAL_ID_1);
      expect(reading?.classificationFacet.committedAt).toBe(T2);
      expect(deriveFacetStatus(projection, 'node', readingId, 'classification')).toBe('committed');
    }

    // Structural-arm behaviour preserved.
    expect(projection.getNode(NODE_ID_1)?.visible).toBe(false);
  });

  it('decompose commit replay round-trip preserves per-component committed-state deterministically', () => {
    const C1 = '00000000-0000-4000-8000-00000000c001';
    const C2 = '00000000-0000-4000-8000-00000000c002';
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'parent',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(2, 'node-created', DEBATER_A_ID, T0, {
        node_id: C1,
        wording: 'c1',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(3, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: C1,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
      makeEvent(4, 'node-created', DEBATER_A_ID, T0, {
        node_id: C2,
        wording: 'c2',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
      makeEvent(5, 'entity-included', MODERATOR_ID, T0, {
        entity_kind: 'node',
        entity_id: C2,
        included_by: MODERATOR_ID,
        included_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      {
        kind: 'decompose',
        parent_node_id: NODE_ID_1,
        components: [
          { wording: 'c1', classification: 'fact', node_id: C1 },
          { wording: 'c2', classification: 'fact', node_id: C2 },
        ],
      },
      6,
    );
    events.push(
      makeEvent(7, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );

    const projectionA = projectFromLog(events, SESSION_ID);
    const projectionB = projectFromLog(events, SESSION_ID);

    // Per-component stamping is deterministic across replays —
    // the same log produces identical projection state for both
    // components' classification facets.
    expect(projectionA.getNode(C1)?.classificationFacet.committedProposalEventId).toBe(
      projectionB.getNode(C1)?.classificationFacet.committedProposalEventId,
    );
    expect(projectionA.getNode(C1)?.classificationFacet.committedAt).toBe(
      projectionB.getNode(C1)?.classificationFacet.committedAt,
    );
    expect(projectionA.getNode(C2)?.classificationFacet.committedProposalEventId).toBe(
      projectionB.getNode(C2)?.classificationFacet.committedProposalEventId,
    );
    expect(projectionA.getNode(C2)?.classificationFacet.committedAt).toBe(
      projectionB.getNode(C2)?.classificationFacet.committedAt,
    );
  });

  it('classify-node commit still stamps committedProposalEventId on the classificationFacet (single-target regression)', () => {
    // Single-target sub-kinds remain unchanged by the plural-
    // helper rename per the refinement's Case 4. This regression
    // pins that the four single-target sub-kinds keep their
    // 1-element-array stamping behaviour.
    const events: Event[] = [
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    ];
    seedNodeAndProposal(
      events,
      PROPOSAL_ID_1,
      { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      2,
    );
    events.push(
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const projection = projectFromLog(events, SESSION_ID);
    const node = projection.getNode(NODE_ID_1);
    expect(node?.classificationFacet.committedProposalEventId).toBe(PROPOSAL_ID_1);
    expect(node?.classificationFacet.committedAt).toBe(T2);
  });
});

// ---------------------------------------------------------------
// Snapshots.
// ---------------------------------------------------------------

describe('applyEvent — snapshot-created', () => {
  it('records the snapshot in the projection without affecting the graph', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEvent(
      projection,
      makeEvent(1, 'snapshot-created', MODERATOR_ID, T0, {
        snapshot_id: SNAPSHOT_ID_1,
        label: 'midpoint',
        log_position: 1,
      }),
    );
    expect(projection.getSnapshot(SNAPSHOT_ID_1)?.label).toBe('midpoint');
    expect(projection.snapshotCount()).toBe(1);
    expect(projection.nodeCount()).toBe(0);
  });
});

// ---------------------------------------------------------------
// Session id mismatch.
// ---------------------------------------------------------------

describe('applyEvent — session id check', () => {
  it('throws ReplayError if the event.sessionId mismatches', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const event: Event = {
      id: evId(1),
      sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sequence: 1,
      kind: 'session-created',
      actor: HOST_ID,
      payload: {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 't',
        created_at: T0,
      },
      createdAt: T0,
    };
    expect(() => applyEvent(projection, event)).toThrow(ReplayError);
  });
});

// ---------------------------------------------------------------
// Round-trip property: projectFromLog === iterative applyEvent
// from empty.
// ---------------------------------------------------------------

function buildRandomLog(): Event[] {
  // Deterministic sequence: 4 nodes, 3 edges, 2 proposals each with
  // a commit and a vote. The point of the property test is "the
  // dispatcher is invariant in entry shape," so the log only needs
  // to exercise multiple kinds — it doesn't need to be enormous.
  const events: Event[] = [];
  events.push(
    makeEvent(1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 't',
      created_at: T0,
    }),
  );
  events.push(
    makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  events.push(
    makeEvent(3, 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  events.push(
    makeEvent(4, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_1,
      wording: 'n1',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_2,
      wording: 'n2',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(6, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_3,
      wording: 'n3',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(7, 'edge-created', DEBATER_A_ID, T3, {
      edge_id: EDGE_ID_1,
      role: 'supports',
      source_node_id: NODE_ID_1,
      target_node_id: NODE_ID_2,
      created_by: DEBATER_A_ID,
      created_at: T3,
    }),
  );
  events.push({
    ...makeEvent(8, 'proposal', DEBATER_A_ID, T4, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: PROPOSAL_ID_1,
  });
  events.push(
    makeEvent(9, 'vote', MODERATOR_ID, T5, {
      target: 'proposal' as const,
      proposal_id: PROPOSAL_ID_1,
      participant: MODERATOR_ID,
      choice: 'agree',
      voted_at: T5,
    }),
  );
  events.push(
    makeEvent(10, 'commit', MODERATOR_ID, T6, {
      target: 'proposal',
      proposal_id: PROPOSAL_ID_1,
      committed_by: MODERATOR_ID,
      committed_at: T6,
    }),
  );
  events.push({
    ...makeEvent(11, 'proposal', DEBATER_A_ID, T7, {
      proposal: { kind: 'set-node-substance', node_id: NODE_ID_2, value: 'agreed' },
    }),
    id: PROPOSAL_ID_2,
  });
  events.push(
    makeEvent(12, 'commit', MODERATOR_ID, T8, {
      target: 'proposal',
      proposal_id: PROPOSAL_ID_2,
      committed_by: MODERATOR_ID,
      committed_at: T8,
    }),
  );
  events.push(
    makeEvent(13, 'snapshot-created', MODERATOR_ID, T9, {
      snapshot_id: SNAPSHOT_ID_1,
      label: 'midpoint',
      log_position: 12,
    }),
  );
  return events;
}

function projectionFingerprint(p: ReturnType<typeof createEmptyProjection>): string {
  // A stable serialization of the parts of the projection both
  // entry shapes must agree on. Built from the public iterators
  // and accessors.
  const nodes = [...p.nodes()]
    .map((n) => ({
      id: n.id,
      wording: n.wording,
      visible: n.visible,
      classification: n.classificationFacet.value,
      classificationStatus: n.classificationFacet.status,
      substance: n.substanceFacet.value,
      substanceStatus: n.substanceFacet.status,
      axiomMarks: [...n.axiomMarks.keys()].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...p.edges()]
    .map((e) => ({
      id: e.id,
      role: e.role,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      visible: e.visible,
      substance: e.substanceFacet.value,
      substanceStatus: e.substanceFacet.status,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const annotations = [...p.annotations()]
    .map((a) => ({ id: a.id, content: a.content, kind: a.kind, visible: a.visible }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pending = [...p.pendingProposals()].map((pp) => pp.proposalEventId).sort();
  const snapshots = [...p.snapshots()]
    .map((s) => ({ id: s.snapshotId, label: s.label, position: s.logPosition }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const meta = [...p.unresolvedMetaDisagreements()].map((m) => m.proposalEventId).sort();
  const participants = [...p.currentParticipants()].map((pp) => pp.userId).sort();
  return JSON.stringify({
    sessionState: p.sessionState,
    nodes,
    edges,
    annotations,
    pending,
    snapshots,
    meta,
    participants,
  });
}

describe('round-trip property — projectFromLog ≡ iterative applyEvent', () => {
  it('replay-from-log and one-by-one apply produce identical projection state', () => {
    const events = buildRandomLog();

    const fromLog = projectFromLog(events, SESSION_ID);

    const incremental = createEmptyProjection(SESSION_ID);
    for (const ev of events) applyEvent(incremental, ev);

    expect(projectionFingerprint(fromLog)).toBe(projectionFingerprint(incremental));
  });
});

// ---------------------------------------------------------------
// projectFromLog — empty log.
// ---------------------------------------------------------------

describe('projectFromLog — empty input', () => {
  it('returns a fresh empty projection bound to the supplied sessionId', () => {
    const projection = projectFromLog([], SESSION_ID);
    expect(projection.sessionId).toBe(SESSION_ID);
    expect(projection.nodeCount()).toBe(0);
    expect(projection.sessionState).toBe('open');
  });
});
