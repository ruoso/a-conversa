// Tests for the real propose-side validator for the
// `set-edge-substance` proposal sub-kind's cross-field referential
// rules.
//
// Refinement: tasks/refinements/data-and-methodology/set_edge_substance_endpoint_validation.md
// TaskJuggler: data_and_methodology.methodology_engine.set_edge_substance_endpoint_validation
//
// **What this file pins.** The validator
// `validateSetEdgeSubstanceProposal` in
// `apps/server/src/methodology/handlers/propose.ts` runs in two phases:
//
//   1. Symmetry — if any of the three optional endpoint fields
//      (`source_node_id`, `target_node_id`, `role`) is present, all
//      three must be present. → `'illegal-state-transition'`.
//
//   2. Referential (only when all three are present):
//      2a. Source-node-visible. → `'target-entity-not-found'`.
//      2b. Target-node-visible. → `'target-entity-not-found'`.
//      2c. Agreement with extant edge — when `edge_id` already names a
//          projected edge, the carried `(source, target, role)` triple
//          MUST equal the projected triple. → `'illegal-state-transition'`.
//
// The substance-only re-vote shape (zero endpoint fields) short-
// circuits Phase 1 trivially and skips Phase 2; the
// `proposeDefeaterPreCommit.test.ts` baseline covers that shape end-
// to-end. The connecting-edge happy path overlaps with the existing
// `proposeSetEdgeSubstanceEndpoints.test.ts` cover (the validator's
// accept path is implicitly exercised there too); the duplication is
// intentional per D6 of the refinement — this file pins the
// validator's behavior; the other file pins the structural-event
// builder's behavior; together they pin the dispatcher seam.
//
// Per D2 of the refinement, no new `RejectionReason` is minted; the
// existing `'target-entity-not-found'` + `'illegal-state-transition'`
// codes carry the kind-specific specificity via the `detail` string.

import { describe, expect, it } from 'vitest';

import type { Event, SetEdgeSubstanceProposal } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type ProposeAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-1111111111ce';

const HOST_ID = '22222222-2222-4222-8222-2222222222ce';
const MODERATOR_ID = '33333333-3333-4333-8333-3333333333ce';
const DEBATER_A_ID = '44444444-4444-4444-8444-4444444444ce';
const DEBATER_B_ID = '55555555-5555-4555-8555-5555555555ce';

const SOURCE_NODE_ID = '66666666-6666-4666-8666-6666666666ce';
const TARGET_NODE_ID = '77777777-7777-4777-8777-7777777777ce';
const OTHER_NODE_ID = '88888888-8888-4888-8888-8888888888ce';
const EXTANT_EDGE_ID = '99999999-9999-4999-8999-9999999999ce';
const FRESH_EDGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaace';

const UNKNOWN_NODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbce';

const PRIOR_DECOMPOSE_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccce1';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddce1';

const T0 = '2026-05-10T12:00:00Z';
const T1 = '2026-05-10T12:00:01Z';
const T2 = '2026-05-10T12:00:02Z';
const T3 = '2026-05-10T12:00:03Z';
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

// Seed a session with three participants and two visible nodes
// (the would-be source + target of a connecting edge). Returns the
// projection.
function seedSession(): ReturnType<typeof createEmptyProjection> {
  const projection = createEmptyProjection(SESSION_ID);
  applyEvent(
    projection,
    makeEvent(1, 'session-created', HOST_ID, T0, {
      host_user_id: HOST_ID,
      privacy: 'public',
      topic: 't',
      created_at: T0,
    }),
  );
  applyEvent(
    projection,
    makeEvent(2, 'participant-joined', MODERATOR_ID, T1, {
      user_id: MODERATOR_ID,
      role: 'moderator',
      screen_name: 'M',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(3, 'participant-joined', DEBATER_A_ID, T1, {
      user_id: DEBATER_A_ID,
      role: 'debater-A',
      screen_name: 'A',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(4, 'participant-joined', DEBATER_B_ID, T1, {
      user_id: DEBATER_B_ID,
      role: 'debater-B',
      screen_name: 'B',
      joined_at: T1,
    }),
  );
  applyEvent(
    projection,
    makeEvent(5, 'node-created', DEBATER_A_ID, T2, {
      node_id: SOURCE_NODE_ID,
      wording: 'Backing fact for the edge.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(6, 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'node',
      entity_id: SOURCE_NODE_ID,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(7, 'node-created', DEBATER_B_ID, T2, {
      node_id: TARGET_NODE_ID,
      wording: 'Claim that the edge supports.',
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(8, 'entity-included', DEBATER_B_ID, T2, {
      entity_kind: 'node',
      entity_id: TARGET_NODE_ID,
      included_by: DEBATER_B_ID,
      included_at: T2,
    }),
  );
  return projection;
}

// Extend the seed with an extant edge `supports`(source → target),
// then vote-agree + commit the edge's `shape` facet on behalf of all
// three current participants so the propose-handler sequence gate
// (per `pf_shape_facet_wire_vote` + ADR 0030 §8) accepts
// `set-edge-substance` proposals against this edge. The substance-only
// re-vote / agreement-with-existing-edge cases below pin the per-sub-
// kind validator's rules; without the shape commit the gate would
// short-circuit those rules with `'facet-sequence-out-of-order'`.
function seedSessionWithExtantEdge(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSession();
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: EXTANT_EDGE_ID,
      role: 'supports',
      source_node_id: SOURCE_NODE_ID,
      target_node_id: TARGET_NODE_ID,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'edge',
      entity_id: EXTANT_EDGE_ID,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
  // Advance the edge's shape facet to `'committed'` so the gate
  // accepts. Each current participant (moderator + both debaters)
  // votes agree on `(edge, 'shape')`, then the moderator commits.
  for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    applyEvent(
      projection,
      makeEvent(nextSequence(projection), 'vote', voter, T3, {
        target: 'facet' as const,
        entity_kind: 'edge' as const,
        entity_id: EXTANT_EDGE_ID,
        facet: 'shape' as const,
        participant: voter,
        choice: 'agree' as const,
        voted_at: T3,
      }),
    );
  }
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T3, {
      target: 'facet' as const,
      entity_kind: 'edge' as const,
      entity_id: EXTANT_EDGE_ID,
      facet: 'shape' as const,
      committed_by: MODERATOR_ID,
      committed_at: T3,
    }),
  );
  return projection;
}

// Extend the seed by superseding SOURCE_NODE_ID via a committed
// decompose; the source node remains in the projection but with
// `visible === false`. Used by the rule-2a "not-visible" case.
function seedSessionWithSupersededSource(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSession();
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: {
        kind: 'decompose',
        parent_node_id: SOURCE_NODE_ID,
        components: [
          {
            wording: 'Prior split component one.',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000e041',
          },
          {
            wording: 'Prior split component two.',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000e042',
          },
        ],
      },
    }),
    id: PRIOR_DECOMPOSE_PROPOSAL_ID,
  });
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T9, {
      target: 'proposal',
      proposal_id: PRIOR_DECOMPOSE_PROPOSAL_ID,
      committed_by: MODERATOR_ID,
      committed_at: T9,
    }),
  );
  return projection;
}

// Same as `seedSessionWithSupersededSource` but against TARGET_NODE_ID.
function seedSessionWithSupersededTarget(): ReturnType<typeof createEmptyProjection> {
  const projection = seedSession();
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_B_ID, T3, {
      proposal: {
        kind: 'decompose',
        parent_node_id: TARGET_NODE_ID,
        components: [
          {
            wording: 'Prior split component one.',
            classification: 'fact',
            node_id: '00000000-0000-4000-8000-00000000e041',
          },
          {
            wording: 'Prior split component two.',
            classification: 'value',
            node_id: '00000000-0000-4000-8000-00000000e042',
          },
        ],
      },
    }),
    id: PRIOR_DECOMPOSE_PROPOSAL_ID,
  });
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T9, {
      target: 'proposal',
      proposal_id: PRIOR_DECOMPOSE_PROPOSAL_ID,
      committed_by: MODERATOR_ID,
      committed_at: T9,
    }),
  );
  return projection;
}

type EdgeRoleLiteral = NonNullable<SetEdgeSubstanceProposal['role']>;

interface ProposalOverrides {
  edge_id?: string;
  value?: 'agreed' | 'disputed';
  // Pass `undefined` (explicitly) to omit the field; pass a string to
  // override the default seed value. Absent key → default seed value.
  source_node_id?: string | undefined;
  target_node_id?: string | undefined;
  role?: EdgeRoleLiteral | undefined;
}

// Build a `set-edge-substance` propose action at the next-expected
// sequence. Default: moderator proposes a fresh connecting edge with
// all three endpoint fields set.
function makeSetEdgeSubstanceAction(
  projection: ReturnType<typeof createEmptyProjection>,
  proposalOverrides: ProposalOverrides = {},
  actorOverrides: Partial<{ requester: string; eventId: string }> = {},
): ProposeAction {
  const requester = actorOverrides.requester ?? MODERATOR_ID;
  // Resolve each endpoint field with explicit "absent key → default,
  // present-but-undefined → omit, present string → use" semantics.
  const sourceNodeId =
    'source_node_id' in proposalOverrides ? proposalOverrides.source_node_id : SOURCE_NODE_ID;
  const targetNodeId =
    'target_node_id' in proposalOverrides ? proposalOverrides.target_node_id : TARGET_NODE_ID;
  const role: EdgeRoleLiteral | undefined =
    'role' in proposalOverrides ? proposalOverrides.role : 'supports';
  const proposal: SetEdgeSubstanceProposal = {
    kind: 'set-edge-substance',
    edge_id: proposalOverrides.edge_id ?? FRESH_EDGE_ID,
    value: proposalOverrides.value ?? 'agreed',
    ...(sourceNodeId !== undefined ? { source_node_id: sourceNodeId } : {}),
    ...(targetNodeId !== undefined ? { target_node_id: targetNodeId } : {}),
    ...(role !== undefined ? { role } : {}),
  };
  return {
    kind: 'propose',
    requester,
    sessionId: SESSION_ID,
    eventId: actorOverrides.eventId ?? NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposal,
  };
}

// ---------------------------------------------------------------
// Rule 1 — symmetry: if any endpoint field is present, all three must
// be present.
// ---------------------------------------------------------------

describe('propose set-edge-substance — rule 1: symmetry (all-or-nothing endpoint fields)', () => {
  it('rejects when source_node_id is missing but target_node_id + role are present', () => {
    const p = seedSession();
    const action = makeSetEdgeSubstanceAction(p, { source_node_id: undefined });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('source_node_id');
      expect(r.detail).toContain(FRESH_EDGE_ID);
    }
  });

  it('rejects when target_node_id is missing but source_node_id + role are present', () => {
    const p = seedSession();
    const action = makeSetEdgeSubstanceAction(p, { target_node_id: undefined });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('target_node_id');
      expect(r.detail).toContain(FRESH_EDGE_ID);
    }
  });

  it('rejects when role is missing but source_node_id + target_node_id are present', () => {
    const p = seedSession();
    const action = makeSetEdgeSubstanceAction(p, { role: undefined });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('role');
      expect(r.detail).toContain(FRESH_EDGE_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2a — source-node-visible.
// ---------------------------------------------------------------

describe('propose set-edge-substance — rule 2a: source-node-visible', () => {
  it('rejects when source_node_id does not reference any node in the projection', () => {
    const p = seedSession();
    const action = makeSetEdgeSubstanceAction(p, { source_node_id: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
      expect(r.detail).toContain('source_node_id');
    }
  });

  it('rejects when source_node_id references a superseded (not-visible) node', () => {
    const p = seedSessionWithSupersededSource();
    // Sanity: the source exists but has been superseded.
    expect(p.getNode(SOURCE_NODE_ID)?.visible).toBe(false);

    const action = makeSetEdgeSubstanceAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(SOURCE_NODE_ID);
      expect(r.detail).toContain('source_node_id');
    }
  });
});

// ---------------------------------------------------------------
// Rule 2b — target-node-visible.
// ---------------------------------------------------------------

describe('propose set-edge-substance — rule 2b: target-node-visible', () => {
  it('rejects when target_node_id does not reference any node in the projection', () => {
    const p = seedSession();
    const action = makeSetEdgeSubstanceAction(p, { target_node_id: UNKNOWN_NODE_ID });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(UNKNOWN_NODE_ID);
      expect(r.detail).toContain('target_node_id');
    }
  });

  it('rejects when target_node_id references a superseded (not-visible) node', () => {
    const p = seedSessionWithSupersededTarget();
    // Sanity: the target exists but has been superseded.
    expect(p.getNode(TARGET_NODE_ID)?.visible).toBe(false);

    const action = makeSetEdgeSubstanceAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain(TARGET_NODE_ID);
      expect(r.detail).toContain('target_node_id');
    }
  });
});

// ---------------------------------------------------------------
// Rule 2c — agreement-with-existing-edge.
//
// Only fires when `edge_id` already names a projected edge AND all
// three endpoint fields are present. The carried `(source, target,
// role)` triple must equal the projected triple; entity identity is
// fixed at `edge-created` time per ADR 0027.
// ---------------------------------------------------------------

describe('propose set-edge-substance — rule 2c: agreement-with-existing-edge', () => {
  it('rejects when carried source_node_id disagrees with the projected edge', () => {
    const p = seedSessionWithExtantEdge();
    // Seed an extra visible node so the carried source resolves.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: OTHER_NODE_ID,
        wording: 'A different fact.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'entity-included', DEBATER_A_ID, T2, {
        entity_kind: 'node',
        entity_id: OTHER_NODE_ID,
        included_by: DEBATER_A_ID,
        included_at: T2,
      }),
    );

    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      source_node_id: OTHER_NODE_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain(OTHER_NODE_ID);
      expect(r.detail).toContain(SOURCE_NODE_ID);
    }
  });

  it('rejects when carried target_node_id disagrees with the projected edge', () => {
    const p = seedSessionWithExtantEdge();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_B_ID, T2, {
        node_id: OTHER_NODE_ID,
        wording: 'A different claim.',
        created_by: DEBATER_B_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'entity-included', DEBATER_B_ID, T2, {
        entity_kind: 'node',
        entity_id: OTHER_NODE_ID,
        included_by: DEBATER_B_ID,
        included_at: T2,
      }),
    );

    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      target_node_id: OTHER_NODE_ID,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain(OTHER_NODE_ID);
      expect(r.detail).toContain(TARGET_NODE_ID);
    }
  });

  it('rejects when carried role disagrees with the projected edge', () => {
    const p = seedSessionWithExtantEdge();
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      role: 'rebuts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain('supports');
      expect(r.detail).toContain('rebuts');
    }
  });

  it('rejects when the resolved existing edge carries annotation endpoints (per projection_edge_annotation_endpoint D6)', () => {
    const p = seedSession();
    // Build an annotation-endpoint edge by raw `applyEvent` of an
    // annotation-target `edge-created` event — the wire schema permits
    // this shape; the projection layer (post
    // `projection_edge_annotation_endpoint`) records it; the
    // `set-edge-substance` proposal doesn't yet carry annotation
    // endpoints (`set_edge_substance_annotation_endpoint` is the
    // follow-up). The substance-only re-vote shape (zero endpoint
    // fields) is what we then send.
    const ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeece';
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: ANNOTATION_ID,
        kind: 'note',
        content: 'annotation',
        target_node_id: SOURCE_NODE_ID,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'contradicts',
        source_node_id: SOURCE_NODE_ID,
        target_annotation_id: ANNOTATION_ID,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'entity-included', DEBATER_A_ID, T2, {
        entity_kind: 'edge',
        entity_id: EXTANT_EDGE_ID,
        included_by: DEBATER_A_ID,
        included_at: T2,
      }),
    );
    // Advance the edge's shape facet to `'committed'` so the
    // sequence gate accepts and we reach the per-sub-kind validator.
    for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
      applyEvent(
        p,
        makeEvent(nextSequence(p), 'vote', voter, T3, {
          target: 'facet' as const,
          entity_kind: 'edge' as const,
          entity_id: EXTANT_EDGE_ID,
          facet: 'shape' as const,
          participant: voter,
          choice: 'agree' as const,
          voted_at: T3,
        }),
      );
    }
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T3, {
        target: 'facet' as const,
        entity_kind: 'edge' as const,
        entity_id: EXTANT_EDGE_ID,
        facet: 'shape' as const,
        committed_by: MODERATOR_ID,
        committed_at: T3,
      }),
    );
    // Substance-only re-vote shape (zero endpoint fields). The
    // validator resolves the existing edge by id, sees the annotation
    // endpoint, and rejects with the follow-up name in the message.
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      value: 'disputed',
      source_node_id: undefined,
      target_node_id: undefined,
      role: undefined,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain('annotation endpoints');
      expect(r.detail).toContain('set_edge_substance_annotation_endpoint');
    }
  });
});

// ---------------------------------------------------------------
// Happy paths.
// ---------------------------------------------------------------

describe('propose set-edge-substance — accept paths', () => {
  it('accepts the connecting case (all three endpoint fields present; edge does not yet exist; source + target visible)', () => {
    const p = seedSession();
    // Sanity: the fresh edge does NOT yet exist; source + target are visible.
    expect(p.getEdge(FRESH_EDGE_ID)).toBeUndefined();
    expect(p.getNode(SOURCE_NODE_ID)?.visible).toBe(true);
    expect(p.getNode(TARGET_NODE_ID)?.visible).toBe(true);

    const action = makeSetEdgeSubstanceAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The structural-event builder fires alongside the proposal
      // envelope per ADR 0027: edge-created + entity-included +
      // proposal, in that order.
      expect(r.events).toHaveLength(3);
      expect(r.events[0]!.kind).toBe('edge-created');
      expect(r.events[1]!.kind).toBe('entity-included');
      expect(r.events[2]!.kind).toBe('proposal');
    }
  });

  it('accepts the substance-only re-vote (zero endpoint fields; edge exists)', () => {
    const p = seedSessionWithExtantEdge();
    expect(p.getEdge(EXTANT_EDGE_ID)).not.toBeUndefined();

    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      value: 'disputed',
      source_node_id: undefined,
      target_node_id: undefined,
      role: undefined,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Phase 1 short-circuits; the structural-event builder's
      // predicate fails on `getEdge !== undefined`; only the proposal
      // envelope fires.
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('proposal');
    }
  });

  it('accepts a substance-only re-vote that redundantly carries the projected (source, target, role) triple', () => {
    const p = seedSessionWithExtantEdge();
    // Carry all three endpoint fields against the extant edge,
    // matching the projected triple exactly. Rule 2c agrees; the
    // structural-event builder's predicate fails on
    // `getEdge !== undefined`; only the proposal envelope fires.
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      value: 'agreed',
      source_node_id: SOURCE_NODE_ID,
      target_node_id: TARGET_NODE_ID,
      role: 'supports',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('proposal');
    }
  });
});
