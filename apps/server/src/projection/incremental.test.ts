// Tests for applyEventIncremental — the steady-state per-event apply.
//
// Refinement: tasks/refinements/data-and-methodology/project_incrementally.md
// TaskJuggler: data_and_methodology.projection.project_incrementally
//
// Coverage:
//   - Single event apply advances lastAppliedSequence and produces
//     the right change-feed entry.
//   - Multiple-event sequential apply.
//   - Duplicate / gap / out-of-order sequences throw
//     OutOfOrderEventError; the projection's lastAppliedSequence
//     is unchanged after the throw.
//   - Equivalence property: projectFromLog ≡ N calls of
//     applyEventIncremental from empty (both projection state AND
//     concatenated change-feed length / well-formedness).
//   - One coverage case per `ProjectionChange` discriminator
//     emitted by the structural-commit handlers.

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from './projection.js';
import { applyEventIncremental } from './incremental.js';
import { applyEvent, OutOfOrderEventError, projectFromLog } from './replay.js';
import type { ProjectionChange } from './types.js';

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
// Basic sequence advancement.
// ---------------------------------------------------------------

describe('applyEventIncremental — sequence advancement', () => {
  it('an empty projection starts at lastAppliedSequence=0', () => {
    const projection = createEmptyProjection(SESSION_ID);
    expect(projection.lastAppliedSequence).toBe(0);
  });

  it('a single event advances lastAppliedSequence to 1 and yields a session-state-changed change', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const changes = applyEventIncremental(
      projection,
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 't',
        created_at: T0,
      }),
    );
    expect(projection.lastAppliedSequence).toBe(1);
    expect(changes).toEqual([{ kind: 'session-state-changed', state: 'open' }]);
  });

  it('two sequential events advance lastAppliedSequence and both changes are recorded', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 't',
        created_at: T0,
      }),
    );
    const second = applyEventIncremental(
      projection,
      makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T1,
      }),
    );
    expect(projection.lastAppliedSequence).toBe(2);
    expect(second).toEqual([
      { kind: 'participant-joined', userId: MODERATOR_ID, role: 'moderator' },
    ]);
  });
});

// ---------------------------------------------------------------
// Out-of-order / gap / duplicate.
// ---------------------------------------------------------------

describe('applyEventIncremental — out-of-order / gap / duplicate rejection', () => {
  function seedToSequence(n: number): ReturnType<typeof createEmptyProjection> {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'session-created', HOST_ID, T0, {
        host_user_id: HOST_ID,
        privacy: 'public',
        topic: 't',
        created_at: T0,
      }),
    );
    if (n >= 2) {
      applyEventIncremental(
        projection,
        makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
          user_id: MODERATOR_ID,
          role: 'moderator',
          screen_name: 'M',
          joined_at: T1,
        }),
      );
    }
    return projection;
  }

  it('a duplicate sequence throws OutOfOrderEventError and leaves lastAppliedSequence unchanged', () => {
    const projection = seedToSequence(2);
    const before = projection.lastAppliedSequence;
    expect(() =>
      applyEventIncremental(
        projection,
        makeEvent(2, 'participant-joined', DEBATER_A_ID, T2, {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: T2,
        }),
      ),
    ).toThrow(OutOfOrderEventError);
    expect(projection.lastAppliedSequence).toBe(before);
  });

  it('a gap (N+5 when projection is at N) throws OutOfOrderEventError', () => {
    const projection = seedToSequence(2);
    expect(() =>
      applyEventIncremental(
        projection,
        makeEvent(7, 'participant-joined', DEBATER_A_ID, T2, {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: T2,
        }),
      ),
    ).toThrow(OutOfOrderEventError);
    expect(projection.lastAppliedSequence).toBe(2);
  });

  it('out-of-order (N-1 when projection is at N) throws OutOfOrderEventError', () => {
    const projection = seedToSequence(2);
    expect(() =>
      applyEventIncremental(
        projection,
        makeEvent(1, 'session-created', HOST_ID, T0, {
          host_user_id: HOST_ID,
          privacy: 'public',
          topic: 't',
          created_at: T0,
        }),
      ),
    ).toThrow(OutOfOrderEventError);
    expect(projection.lastAppliedSequence).toBe(2);
  });

  it('the OutOfOrderEventError carries expected and actual sequence fields', () => {
    const projection = seedToSequence(2);
    try {
      applyEventIncremental(
        projection,
        makeEvent(5, 'participant-joined', DEBATER_A_ID, T2, {
          user_id: DEBATER_A_ID,
          role: 'debater-A',
          screen_name: 'A',
          joined_at: T2,
        }),
      );
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OutOfOrderEventError);
      const e = err as OutOfOrderEventError;
      expect(e.expectedSequence).toBe(3);
      expect(e.actualSequence).toBe(5);
    }
  });
});

// ---------------------------------------------------------------
// One test per ProjectionChange variant the structural handlers
// emit.
// ---------------------------------------------------------------

describe('applyEventIncremental — change-feed coverage by discriminator', () => {
  it('node-added: node-created emits one node-added entry', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const changes = applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    expect(changes).toEqual([{ kind: 'node-added', nodeId: NODE_ID_1 }]);
  });

  it('edge-added: edge-created emits one edge-added entry', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(
      projection,
      makeEvent(2, 'node-created', DEBATER_A_ID, T1, {
        node_id: NODE_ID_2,
        wording: 'b',
        created_by: DEBATER_A_ID,
        created_at: T1,
      }),
    );
    const changes = applyEventIncremental(
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
    expect(changes).toEqual([
      {
        kind: 'edge-added',
        edgeId: EDGE_ID_1,
        sourceNodeId: NODE_ID_1,
        targetNodeId: NODE_ID_2,
        role: 'supports',
      },
    ]);
  });

  it('annotation-added: annotation-created emits one annotation-added entry', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    const changes = applyEventIncremental(
      projection,
      makeEvent(2, 'annotation-created', DEBATER_A_ID, T1, {
        annotation_id: ANNOTATION_ID_1,
        kind: 'note',
        content: 'note content',
        target_node_id: NODE_ID_1,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T1,
      }),
    );
    expect(changes).toEqual([
      {
        kind: 'annotation-added',
        annotationId: ANNOTATION_ID_1,
        targetNodeId: NODE_ID_1,
        targetEdgeId: null,
      },
    ]);
  });

  it('entity-included: emits one entity-included entry', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    const changes = applyEventIncremental(
      projection,
      makeEvent(2, 'entity-included', MODERATOR_ID, T1, {
        entity_kind: 'node',
        entity_id: NODE_ID_1,
        included_by: MODERATOR_ID,
        included_at: T1,
      }),
    );
    expect(changes).toEqual([{ kind: 'entity-included', entityKind: 'node', entityId: NODE_ID_1 }]);
  });

  it('pending-proposal-added: proposal event emits pending-proposal-added', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    const proposalEvent: Event = {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      }),
      id: PROPOSAL_ID_1,
    };
    const changes = applyEventIncremental(projection, proposalEvent);
    expect(changes).toEqual([{ kind: 'pending-proposal-added', proposalId: PROPOSAL_ID_1 }]);
  });

  it('vote-recorded: vote event emits vote-recorded', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'vote', DEBATER_A_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        participant: DEBATER_A_ID,
        vote: 'agree',
        voted_at: T2,
      }),
    );
    expect(changes).toEqual([
      {
        kind: 'vote-recorded',
        proposalId: PROPOSAL_ID_1,
        participantId: DEBATER_A_ID,
        vote: 'agree',
      },
    ]);
  });

  it('facet-updated + pending-proposal-cleared: classify-node commit emits both', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    expect(changes).toEqual([
      {
        kind: 'facet-updated',
        entityKind: 'node',
        entityId: NODE_ID_1,
        facet: 'classification',
        value: 'fact',
        status: 'agreed',
      },
      { kind: 'pending-proposal-cleared', proposalId: PROPOSAL_ID_1, reason: 'commit' },
    ]);
  });

  it('visibility-changed: decompose commit emits visibility-changed for the parent', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'parent',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID_1,
          components: [
            {
              wording: 'c1',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-00000000d001',
            },
            {
              wording: 'c2',
              classification: 'fact',
              node_id: '00000000-0000-4000-8000-00000000d002',
            },
          ],
        },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    expect(changes).toEqual([
      { kind: 'visibility-changed', entityKind: 'node', entityId: NODE_ID_1, visible: false },
      { kind: 'pending-proposal-cleared', proposalId: PROPOSAL_ID_1, reason: 'commit' },
    ]);
  });

  it('node-wording-updated + facet-updated: edit-wording(reword) commit emits both', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'old',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'reword',
          node_id: NODE_ID_1,
          new_wording: 'new',
        },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    const kinds = changes.map((c) => c.kind);
    expect(kinds).toEqual(['node-wording-updated', 'facet-updated', 'pending-proposal-cleared']);
  });

  it('axiom-mark-added: axiom-mark commit emits axiom-mark-added', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'axiom-mark', node_id: NODE_ID_1, participant: DEBATER_A_ID },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'commit', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    expect(changes[0]).toEqual({
      kind: 'axiom-mark-added',
      nodeId: NODE_ID_1,
      participantId: DEBATER_A_ID,
    });
    expect(changes[changes.length - 1]).toEqual({
      kind: 'pending-proposal-cleared',
      proposalId: PROPOSAL_ID_1,
      reason: 'commit',
    });
  });

  it('meta-disagreement-marked: emits meta-disagreement-marked + pending-proposal-cleared(meta-disagreement)', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'a',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(2, 'proposal', DEBATER_A_ID, T1, {
        proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(3, 'meta-disagreement-marked', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        marked_at: T2,
      }),
    );
    expect(changes).toEqual([
      { kind: 'meta-disagreement-marked', proposalId: PROPOSAL_ID_1 },
      { kind: 'pending-proposal-cleared', proposalId: PROPOSAL_ID_1, reason: 'meta-disagreement' },
    ]);
  });

  it('snapshot-added: snapshot-created emits snapshot-added', () => {
    const projection = createEmptyProjection(SESSION_ID);
    const changes = applyEventIncremental(
      projection,
      makeEvent(1, 'snapshot-created', MODERATOR_ID, T0, {
        snapshot_id: SNAPSHOT_ID_1,
        label: 'midpoint',
        log_position: 1,
      }),
    );
    expect(changes).toEqual([
      { kind: 'snapshot-added', snapshotId: SNAPSHOT_ID_1, label: 'midpoint', logPosition: 1 },
    ]);
  });

  it('participant-left: participant-left emits participant-left change', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'participant-joined', MODERATOR_ID, T0, {
        user_id: MODERATOR_ID,
        role: 'moderator',
        screen_name: 'Mod',
        joined_at: T0,
      }),
    );
    const changes = applyEventIncremental(
      projection,
      makeEvent(2, 'participant-left', MODERATOR_ID, T1, {
        user_id: MODERATOR_ID,
        left_at: T1,
      }),
    );
    expect(changes).toEqual([{ kind: 'participant-left', userId: MODERATOR_ID }]);
  });
});

// ---------------------------------------------------------------
// Equivalence property.
// ---------------------------------------------------------------

function buildLog(): Event[] {
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
    makeEvent(4, 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  events.push(
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_1,
      wording: 'n1',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(6, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_2,
      wording: 'n2',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(7, 'node-created', DEBATER_A_ID, T2, {
      node_id: NODE_ID_3,
      wording: 'n3',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  events.push(
    makeEvent(8, 'edge-created', DEBATER_A_ID, T3, {
      edge_id: EDGE_ID_1,
      role: 'supports',
      source_node_id: NODE_ID_1,
      target_node_id: NODE_ID_2,
      created_by: DEBATER_A_ID,
      created_at: T3,
    }),
  );
  events.push({
    ...makeEvent(9, 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: PROPOSAL_ID_1,
  });
  events.push(
    makeEvent(10, 'vote', MODERATOR_ID, T3, {
      proposal_id: PROPOSAL_ID_1,
      participant: MODERATOR_ID,
      vote: 'agree',
      voted_at: T3,
    }),
  );
  events.push(
    makeEvent(11, 'commit', MODERATOR_ID, T3, {
      proposal_id: PROPOSAL_ID_1,
      moderator: MODERATOR_ID,
      committed_at: T3,
    }),
  );
  events.push({
    ...makeEvent(12, 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-node-substance', node_id: NODE_ID_2, value: 'agreed' },
    }),
    id: PROPOSAL_ID_2,
  });
  events.push(
    makeEvent(13, 'commit', MODERATOR_ID, T3, {
      proposal_id: PROPOSAL_ID_2,
      moderator: MODERATOR_ID,
      committed_at: T3,
    }),
  );
  events.push(
    makeEvent(14, 'snapshot-created', MODERATOR_ID, T3, {
      snapshot_id: SNAPSHOT_ID_1,
      label: 'midpoint',
      log_position: 13,
    }),
  );
  return events;
}

function projectionFingerprint(p: ReturnType<typeof createEmptyProjection>): string {
  const nodes = [...p.nodes()]
    .map((n) => ({
      id: n.id,
      wording: n.wording,
      visible: n.visible,
      classification: n.classificationFacet.value,
      classificationStatus: n.classificationFacet.status,
      substance: n.substanceFacet.value,
      substanceStatus: n.substanceFacet.status,
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
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pending = [...p.pendingProposals()].map((pp) => pp.proposalEventId).sort();
  const snapshots = [...p.snapshots()].map((s) => s.snapshotId).sort();
  const participants = [...p.currentParticipants()].map((pp) => pp.userId).sort();
  return JSON.stringify({
    sessionState: p.sessionState,
    lastAppliedSequence: p.lastAppliedSequence,
    nodes,
    edges,
    pending,
    snapshots,
    participants,
  });
}

describe('applyEventIncremental — equivalence with projectFromLog', () => {
  it('projectFromLog ≡ N calls of applyEventIncremental from empty', () => {
    const events = buildLog();

    const fromLog = projectFromLog(events, SESSION_ID);

    const incremental = createEmptyProjection(SESSION_ID);
    const allChanges: ProjectionChange[] = [];
    for (const ev of events) {
      const changes = applyEventIncremental(incremental, ev);
      allChanges.push(...changes);
    }

    expect(projectionFingerprint(fromLog)).toBe(projectionFingerprint(incremental));
    // The concatenated change feed must be well-formed: every
    // entry has a `kind` discriminator. We don't assert an exact
    // sequence here — the per-event-kind tests above cover each
    // discriminator. The contract we DO assert: the feed has at
    // least one entry per non-no-op event (every event in the
    // log emits something).
    expect(allChanges.length).toBeGreaterThanOrEqual(events.length);
    for (const change of allChanges) {
      expect(typeof change.kind).toBe('string');
    }
    expect(fromLog.lastAppliedSequence).toBe(events[events.length - 1]!.sequence);
    expect(incremental.lastAppliedSequence).toBe(events[events.length - 1]!.sequence);
  });
});

// ---------------------------------------------------------------
// Smoke: applyEvent and applyEventIncremental are the same path.
// ---------------------------------------------------------------

describe('applyEventIncremental and applyEvent share the same dispatcher', () => {
  it('produce identical change feeds for the same event', () => {
    const a = createEmptyProjection(SESSION_ID);
    const b = createEmptyProjection(SESSION_ID);

    const event = makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
      node_id: NODE_ID_1,
      wording: 'x',
      created_by: DEBATER_A_ID,
      created_at: T0,
    });
    const cA = applyEvent(a, event);
    const cB = applyEventIncremental(b, event);

    expect(cA).toEqual(cB);
    expect(a.lastAppliedSequence).toBe(b.lastAppliedSequence);
  });

  it('restructure edit-wording commit emits visibility-changed for the old node', () => {
    const projection = createEmptyProjection(SESSION_ID);
    applyEventIncremental(
      projection,
      makeEvent(1, 'node-created', DEBATER_A_ID, T0, {
        node_id: NODE_ID_1,
        wording: 'old',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(
      projection,
      makeEvent(2, 'node-created', DEBATER_A_ID, T0, {
        node_id: NEW_NODE_ID,
        wording: 'new',
        created_by: DEBATER_A_ID,
        created_at: T0,
      }),
    );
    applyEventIncremental(projection, {
      ...makeEvent(3, 'proposal', DEBATER_A_ID, T1, {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: NODE_ID_1,
          new_wording: 'new',
          new_node_id: NEW_NODE_ID,
        },
      }),
      id: PROPOSAL_ID_1,
    });
    const changes = applyEventIncremental(
      projection,
      makeEvent(4, 'commit', MODERATOR_ID, T2, {
        proposal_id: PROPOSAL_ID_1,
        moderator: MODERATOR_ID,
        committed_at: T2,
      }),
    );
    expect(changes[0]).toEqual({
      kind: 'visibility-changed',
      entityKind: 'node',
      entityId: NODE_ID_1,
      visible: false,
    });
  });
});
