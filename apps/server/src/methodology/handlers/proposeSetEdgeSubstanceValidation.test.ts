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

// Annotation ids — used by the polymorphic-endpoint cases per
// `set_edge_substance_annotation_endpoint`.
const SOURCE_ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee01ce';
const TARGET_ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee02ce';
const UNKNOWN_ANNOTATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee99ce';

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
  advanceShapeToCommitted(projection, EXTANT_EDGE_ID);
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
  source_annotation_id?: string | undefined;
  target_node_id?: string | undefined;
  target_annotation_id?: string | undefined;
  role?: EdgeRoleLiteral | undefined;
}

// Build a `set-edge-substance` propose action at the next-expected
// sequence. Default: moderator proposes a fresh connecting edge with
// the node-source + node-target endpoint pair + `role: 'supports'`.
// Pass `source_node_id: undefined` + `source_annotation_id: <id>` (and
// symmetric for target) to mint a polymorphic-endpoint proposal per
// `set_edge_substance_annotation_endpoint`.
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
  const sourceAnnotationId =
    'source_annotation_id' in proposalOverrides
      ? proposalOverrides.source_annotation_id
      : undefined;
  const targetNodeId =
    'target_node_id' in proposalOverrides ? proposalOverrides.target_node_id : TARGET_NODE_ID;
  const targetAnnotationId =
    'target_annotation_id' in proposalOverrides
      ? proposalOverrides.target_annotation_id
      : undefined;
  const role: EdgeRoleLiteral | undefined =
    'role' in proposalOverrides ? proposalOverrides.role : 'supports';
  const proposal: SetEdgeSubstanceProposal = {
    kind: 'set-edge-substance',
    edge_id: proposalOverrides.edge_id ?? FRESH_EDGE_ID,
    value: proposalOverrides.value ?? 'agreed',
    ...(sourceNodeId !== undefined ? { source_node_id: sourceNodeId } : {}),
    ...(sourceAnnotationId !== undefined ? { source_annotation_id: sourceAnnotationId } : {}),
    ...(targetNodeId !== undefined ? { target_node_id: targetNodeId } : {}),
    ...(targetAnnotationId !== undefined ? { target_annotation_id: targetAnnotationId } : {}),
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

// Advance an extant edge's `shape` facet to `'committed'` so the
// propose-handler sequence gate accepts. The three current
// participants each vote agree on `(edge, 'shape')`, then the
// moderator commits.
function advanceShapeToCommitted(
  projection: ReturnType<typeof createEmptyProjection>,
  edgeId: string,
): void {
  for (const voter of [MODERATOR_ID, DEBATER_A_ID, DEBATER_B_ID]) {
    applyEvent(
      projection,
      makeEvent(nextSequence(projection), 'vote', voter, T3, {
        target: 'facet' as const,
        entity_kind: 'edge' as const,
        entity_id: edgeId,
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
      entity_id: edgeId,
      facet: 'shape' as const,
      committed_by: MODERATOR_ID,
      committed_at: T3,
    }),
  );
}

// Seed two annotations attached to the seeded nodes (`SOURCE_NODE_ID` /
// `TARGET_NODE_ID`); used by the polymorphic-endpoint Phase 2a/2b/2c
// cases. The annotations are visible by default (the projection sets
// `visible: true` at `annotation-created` time).
function seedAnnotations(projection: ReturnType<typeof createEmptyProjection>): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'annotation-created', DEBATER_A_ID, T2, {
      annotation_id: SOURCE_ANNOTATION_ID,
      kind: 'note',
      content: 'Annotation on the source node.',
      target_node_id: SOURCE_NODE_ID,
      target_edge_id: null,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'annotation-created', DEBATER_B_ID, T2, {
      annotation_id: TARGET_ANNOTATION_ID,
      kind: 'note',
      content: 'Annotation on the target node.',
      target_node_id: TARGET_NODE_ID,
      target_edge_id: null,
      created_by: DEBATER_B_ID,
      created_at: T2,
    }),
  );
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

  // Per `set_edge_substance_annotation_endpoint` D5 the polymorphic
  // triple comparison covers four-or-six field equalities. The three
  // cases below pin the cross-kind disagreement paths (projected-
  // annotation vs carried-node, projected-node vs carried-annotation,
  // both-annotation-but-different-ids).

  it('rejects when projected edge has annotation source but carried payload has node source', () => {
    const p = seedSession();
    seedAnnotations(p);
    // Build an annotation-source extant edge by raw `applyEvent`. The
    // edge runs SOURCE_ANNOTATION_ID → TARGET_NODE_ID.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'contradicts',
        source_annotation_id: SOURCE_ANNOTATION_ID,
        target_node_id: TARGET_NODE_ID,
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
    advanceShapeToCommitted(p, EXTANT_EDGE_ID);
    // Carry node source against the annotation-source projected edge.
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      source_node_id: SOURCE_NODE_ID,
      source_annotation_id: undefined,
      target_node_id: TARGET_NODE_ID,
      target_annotation_id: undefined,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain(SOURCE_ANNOTATION_ID);
      expect(r.detail).toContain(SOURCE_NODE_ID);
    }
  });

  it('rejects when projected edge has node target but carried payload has annotation target', () => {
    const p = seedSession();
    seedAnnotations(p);
    // Standard node→node extant edge already seeded by helper; rebuild
    // inline for clarity. SOURCE_NODE_ID → TARGET_NODE_ID.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'supports',
        source_node_id: SOURCE_NODE_ID,
        target_node_id: TARGET_NODE_ID,
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
    advanceShapeToCommitted(p, EXTANT_EDGE_ID);
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      source_node_id: SOURCE_NODE_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'supports',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain(TARGET_ANNOTATION_ID);
      expect(r.detail).toContain(TARGET_NODE_ID);
    }
  });

  it('rejects when projected and carried are both annotation targets but the annotation ids differ', () => {
    const p = seedSession();
    seedAnnotations(p);
    // Project an annotation-target extant edge against
    // SOURCE_ANNOTATION_ID; the propose payload then names
    // TARGET_ANNOTATION_ID — the ids differ.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'contradicts',
        source_node_id: SOURCE_NODE_ID,
        target_annotation_id: SOURCE_ANNOTATION_ID,
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
    advanceShapeToCommitted(p, EXTANT_EDGE_ID);
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      source_node_id: SOURCE_NODE_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain(EXTANT_EDGE_ID);
      expect(r.detail).toContain(SOURCE_ANNOTATION_ID);
      expect(r.detail).toContain(TARGET_ANNOTATION_ID);
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

// ---------------------------------------------------------------
// Polymorphic-endpoint cases per `set_edge_substance_annotation_endpoint`.
// Each endpoint is independently a node id or an annotation id.
// ---------------------------------------------------------------

describe('propose set-edge-substance — polymorphic Phase 1 symmetry', () => {
  it('rejects when target_annotation_id + role are present but no source-side slot is set', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      source_node_id: undefined,
      source_annotation_id: undefined,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('source-side');
      expect(r.detail).toContain(FRESH_EDGE_ID);
    }
  });

  it('rejects when both source-side AND target-side annotation slots are present but role is absent', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      source_node_id: undefined,
      source_annotation_id: SOURCE_ANNOTATION_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: undefined,
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('illegal-state-transition');
      expect(r.detail).toContain('role');
      expect(r.detail).toContain(FRESH_EDGE_ID);
    }
  });
});

describe('propose set-edge-substance — polymorphic Phase 2a: source annotation visibility', () => {
  it('rejects when source_annotation_id references an unknown annotation', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      source_node_id: undefined,
      source_annotation_id: UNKNOWN_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain('source_annotation_id');
      expect(r.detail).toContain(UNKNOWN_ANNOTATION_ID);
    }
  });

  it('rejects when source_annotation_id references an annotation that exists but is invisible', () => {
    const p = seedSession();
    seedAnnotations(p);
    // Flip the source annotation to invisible directly on the
    // projection — no `annotation-retract` replay arm exists today;
    // the helper aligns with the established visibility-check
    // pattern.
    p.setAnnotationVisible(SOURCE_ANNOTATION_ID, false);
    expect(p.getAnnotation(SOURCE_ANNOTATION_ID)?.visible).toBe(false);

    const action = makeSetEdgeSubstanceAction(p, {
      source_node_id: undefined,
      source_annotation_id: SOURCE_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain('source_annotation_id');
      expect(r.detail).toContain(SOURCE_ANNOTATION_ID);
    }
  });
});

describe('propose set-edge-substance — polymorphic Phase 2b: target annotation visibility', () => {
  it('rejects when target_annotation_id references an unknown annotation', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      target_node_id: undefined,
      target_annotation_id: UNKNOWN_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain('target_annotation_id');
      expect(r.detail).toContain(UNKNOWN_ANNOTATION_ID);
    }
  });

  it('rejects when target_annotation_id references an annotation that is invisible', () => {
    const p = seedSession();
    seedAnnotations(p);
    p.setAnnotationVisible(TARGET_ANNOTATION_ID, false);

    const action = makeSetEdgeSubstanceAction(p, {
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('target-entity-not-found');
      expect(r.detail).toContain('target_annotation_id');
      expect(r.detail).toContain(TARGET_ANNOTATION_ID);
    }
  });
});

describe('propose set-edge-substance — polymorphic happy paths', () => {
  it('accepts node→annotation connecting case (the E15 shape)', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: FRESH_EDGE_ID,
      source_node_id: SOURCE_NODE_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(3);
      expect(r.events[0]!.kind).toBe('edge-created');
      const first = r.events[0]!;
      if (first.kind === 'edge-created') {
        const payload = first.payload;
        expect(payload.source_node_id).toBe(SOURCE_NODE_ID);
        expect(payload.target_annotation_id).toBe(TARGET_ANNOTATION_ID);
        expect(payload.target_node_id).toBeUndefined();
        expect(payload.source_annotation_id).toBeUndefined();
      }
      expect(r.events[1]!.kind).toBe('entity-included');
      expect(r.events[2]!.kind).toBe('proposal');
    }
  });

  it('accepts annotation→node connecting case', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: FRESH_EDGE_ID,
      source_node_id: undefined,
      source_annotation_id: SOURCE_ANNOTATION_ID,
      target_node_id: TARGET_NODE_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(3);
      const first = r.events[0]!;
      if (first.kind === 'edge-created') {
        const payload = first.payload;
        expect(payload.source_annotation_id).toBe(SOURCE_ANNOTATION_ID);
        expect(payload.target_node_id).toBe(TARGET_NODE_ID);
        expect(payload.source_node_id).toBeUndefined();
        expect(payload.target_annotation_id).toBeUndefined();
      }
    }
  });

  it('accepts annotation→annotation connecting case', () => {
    const p = seedSession();
    seedAnnotations(p);
    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: FRESH_EDGE_ID,
      source_node_id: undefined,
      source_annotation_id: SOURCE_ANNOTATION_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(3);
      const first = r.events[0]!;
      if (first.kind === 'edge-created') {
        const payload = first.payload;
        expect(payload.source_annotation_id).toBe(SOURCE_ANNOTATION_ID);
        expect(payload.target_annotation_id).toBe(TARGET_ANNOTATION_ID);
        expect(payload.source_node_id).toBeUndefined();
        expect(payload.target_node_id).toBeUndefined();
      }
    }
  });

  // Regression for the lifted defensive guard
  // (`projection_edge_annotation_endpoint` D6's breadcrumb): a
  // substance-only re-vote against an annotation-endpoint extant edge
  // used to reject with the follow-up-task name in the detail. THIS
  // task lifts the guard; the re-vote now accepts and emits one
  // event (the proposal envelope).
  it('accepts the substance-only re-vote against an extant annotation-endpoint edge (lifted-guard regression)', () => {
    const p = seedSession();
    seedAnnotations(p);
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'contradicts',
        source_node_id: SOURCE_NODE_ID,
        target_annotation_id: TARGET_ANNOTATION_ID,
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
    advanceShapeToCommitted(p, EXTANT_EDGE_ID);

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
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('proposal');
    }
  });

  it('accepts the agreement-with-extant case carrying a matching polymorphic triple (target_annotation)', () => {
    const p = seedSession();
    seedAnnotations(p);
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'edge-created', DEBATER_A_ID, T2, {
        edge_id: EXTANT_EDGE_ID,
        role: 'contradicts',
        source_node_id: SOURCE_NODE_ID,
        target_annotation_id: TARGET_ANNOTATION_ID,
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
    advanceShapeToCommitted(p, EXTANT_EDGE_ID);

    const action = makeSetEdgeSubstanceAction(p, {
      edge_id: EXTANT_EDGE_ID,
      value: 'agreed',
      source_node_id: SOURCE_NODE_ID,
      target_node_id: undefined,
      target_annotation_id: TARGET_ANNOTATION_ID,
      role: 'contradicts',
    });
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The fresh-edge predicate fails because the edge already exists;
      // only the proposal envelope fires.
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('proposal');
    }
  });
});
