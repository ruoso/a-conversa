// Vitest cases for the audience's pure `projectGraph` projection.
//
// Refinement: tasks/refinements/audience/aud_cytoscape_init.md
//   (Acceptance criteria — 10 cases (a–j) pin the single-pass projection
//   algorithm without mounting Cytoscape.)
//
// Refinement: tasks/refinements/audience/aud_proposed_styling.md
//   (Acceptance criteria — 6 additional cases (k–p) pin the per-facet
//   status stamping: every emitted node + edge carries
//   `data.facetStatuses` (sourced from `computeFacetStatuses(events)`)
//   and `data.rollupStatus` (the priority rollup, or the literal
//   sentinel `'none'` when the per-facet record is empty per
//   Decision §4). The commit-arm kind flips preserve both fields via
//   the `{...existing.data}` spread.)
//
// Refinement: tasks/refinements/audience/aud_axiom_mark_decoration.md
//   (Acceptance criteria — 5 additional cases (q–u) pin the per-node
//   axiom-mark stamping: default empty, targeted non-empty, multi-
//   participant accumulation, commit-survives-kind-flip, and edges-
//   carry-no-axiomMarks shape.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering.md
//   (Acceptance criteria — 5 additional cases (v–z) pin the per-node
//   annotation stamping: default empty, targeted single-entry,
//   multi-annotation accumulation in arrival order, survives a later
//   classify-commit kind-flip, and edges-carry-no-annotations shape.)
//
// Refinement: tasks/refinements/audience/aud_annotation_rendering_edges.md
//   (Acceptance criteria — 4 additional cases (aaa–ddd) pin the per-edge
//   annotation stamping: default `EMPTY_ANNOTATIONS` on every projected
//   edge, single-entry on an edge targeted by a committed annotation,
//   multi-annotation accumulation in arrival order on the same edge,
//   and the symmetric isolation pin (one node + one edge target in the
//   same log emit isolated per-element arrays). Case (z) is rewritten:
//   `AudienceEdgeData` now carries `annotations`; the prior "field
//   absent" assertion becomes the default-empty assertion.)
//
// ADRs: 0022 (no throwaway verifications — the projection's
//   behaviour is fully pinned at this pure layer; the `<AudienceGraphView>`
//   mount tests then assert the Cytoscape side without re-asserting
//   algorithmic behaviour).

import { describe, expect, it } from 'vitest';
import type { AnnotationKind, EdgeRole, Event, StatementKind } from '@a-conversa/shared-types';

import { projectGraph } from './projectGraph';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const NODE_C = '00000000-0000-4000-8000-00000000000c';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_A = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_UNKNOWN = '00000000-0000-4000-8000-0000000000bb';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';

const ALL_STATEMENT_KINDS: readonly StatementKind[] = [
  'fact',
  'predictive',
  'value',
  'normative',
  'definitional',
];

const ALL_EDGE_ROLES: readonly EdgeRole[] = [
  'supports',
  'rebuts',
  'qualifies',
  'bridges-from',
  'bridges-to',
  'defines',
  'contradicts',
];

function makeNodeCreated(opts: { sequence: number; nodeId: string; wording: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: opts.wording,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeEdgeCreated(opts: {
  sequence: number;
  edgeId: string;
  source: string;
  target: string;
  role?: EdgeRole;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x300 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'edge-created',
    actor: ACTOR,
    payload: {
      edge_id: opts.edgeId,
      role: opts.role ?? 'supports',
      source_node_id: opts.source,
      target_node_id: opts.target,
      created_by: ACTOR,
      created_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
  classification: StatementKind;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'classify-node',
        node_id: opts.nodeId,
        classification: opts.classification,
      },
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x200 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

function makeParticipantJoined(sequence: number): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x400 + sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'participant-joined',
    actor: ACTOR,
    payload: {
      user_id: ACTOR,
      role: 'debater-A',
      screen_name: 'alice',
      joined_at: '2026-05-27T00:00:00.000Z',
    },
    createdAt: '2026-05-27T00:00:00.000Z',
  };
}

describe('projectGraph (audience baseline)', () => {
  it('(a) returns empty arrays for an empty event log', () => {
    expect(projectGraph([])).toEqual({ nodes: [], edges: [] });
  });

  it('(b) emits one node descriptor per node-created event with kind: null', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'UBI lifts welfare floor' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      group: 'nodes',
      data: { id: NODE_A, wording: 'UBI lifts welfare floor', kind: null },
    });
  });

  it('(b2) stamps content-measured width / height / textMaxWidth on statement nodes (not a constant box)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'Yes' }),
      makeNodeCreated({
        sequence: 2,
        nodeId: NODE_B,
        wording:
          'A considerably longer statement whose wording wraps across several lines and grows the box',
      }),
    ];
    const { nodes } = projectGraph(events);
    const short = nodes.find((n) => n.data.id === NODE_A)?.data;
    const long = nodes.find((n) => n.data.id === NODE_B)?.data;
    // Both carry numeric, positive box dimensions sourced from the
    // projector's `computeNodeDimensions(wording)` call.
    expect(typeof short?.width).toBe('number');
    expect(typeof short?.height).toBe('number');
    expect(typeof long?.width).toBe('number');
    // The wrap budget invariant the stylesheet relies on: a node's
    // `text-max-width: data(textMaxWidth)` is always `width - 2*padding`.
    expect(short?.textMaxWidth).toBe((short?.width ?? 0) - 24);
    expect(long?.textMaxWidth).toBe((long?.width ?? 0) - 24);
    // Content drives the size: the long wording produces a wider and
    // taller box than the short one — the whole point of the change.
    expect(long?.width ?? 0).toBeGreaterThan(short?.width ?? 0);
    expect(long?.height ?? 0).toBeGreaterThan(short?.height ?? 0);
  });

  it('(c) emits one edge descriptor per edge-created with correct source / target / role', () => {
    const events: Event[] = [
      makeEdgeCreated({
        sequence: 1,
        edgeId: EDGE_A,
        source: NODE_A,
        target: NODE_B,
        role: 'rebuts',
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes).toEqual([]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      group: 'edges',
      data: { id: EDGE_A, source: NODE_A, target: NODE_B, role: 'rebuts' },
    });
  });

  it('(d) projects both nodes and edges from an interleaved event log', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeEdgeCreated({ sequence: 2, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeNodeCreated({ sequence: 3, nodeId: NODE_B, wording: 'B' }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.map((n) => n.data.id)).toEqual([NODE_A, NODE_B]);
    expect(edges.map((e) => e.data.id)).toEqual([EDGE_A]);
  });

  it('(e) leaves kind: null when a classify-node proposal has no matching commit', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(f) flips kind to the committed classification after a classify-node proposal + commit pair', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBe('normative');
  });

  it('(g) ignores a commit referencing an unknown proposal envelope id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_UNKNOWN }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.kind).toBeNull();
  });

  it('(h) round-trips every StatementKind through proposal + commit', () => {
    for (const kind of ALL_STATEMENT_KINDS) {
      const proposalId = `00000000-0000-4000-8000-0000000000${ALL_STATEMENT_KINDS.indexOf(kind)
        .toString()
        .padStart(2, '0')}`;
      const events: Event[] = [
        makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'wording' }),
        makeClassifyProposal({
          sequence: 2,
          envelopeId: proposalId,
          nodeId: NODE_A,
          classification: kind,
        }),
        makeCommit({ sequence: 3, proposalEnvelopeId: proposalId }),
      ];
      const { nodes } = projectGraph(events);
      expect(nodes[0]?.data.kind).toBe(kind);
    }
  });

  it('(i) round-trips every EdgeRole through edge-created', () => {
    for (const role of ALL_EDGE_ROLES) {
      const events: Event[] = [
        makeEdgeCreated({
          sequence: 1,
          edgeId: EDGE_A,
          source: NODE_A,
          target: NODE_B,
          role,
        }),
      ];
      const { edges } = projectGraph(events);
      expect(edges).toHaveLength(1);
      expect(edges[0]?.data.role).toBe(role);
    }
  });

  it('(k) emits facetStatuses + rollupStatus on every projected node', () => {
    // A lone `node-created` seeds the wording facet inline (per ADR
    // 0030 §4): wording = 'proposed' (no votes, no participants),
    // classification and substance = 'awaiting-proposal' (no candidate
    // yet). Rollup priority surfaces 'proposed'.
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.facetStatuses).toEqual({
      wording: 'proposed',
      classification: 'awaiting-proposal',
      substance: 'awaiting-proposal',
    });
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(l) stamps a classify-node proposal target as facetStatuses.classification: "proposed"', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.facetStatuses.classification).toBe('proposed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(m) stamps a set-edge-substance proposal as edge facetStatuses.substance: "proposed"', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      {
        id: '00000000-0000-4000-8000-0000000000ee',
        sessionId: SESSION_ID,
        sequence: 4,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-edge-substance', edge_id: EDGE_A, value: 'agreed' },
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { edges } = projectGraph(events);
    expect(edges[0]?.data.facetStatuses.substance).toBe('proposed');
    expect(edges[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(n) preserves facetStatuses + rollupStatus across the proposal-keyed classify commit branch', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    // kind flipped to the committed classification...
    expect(nodes[0]?.data.kind).toBe('fact');
    // ...and the facet stamping survived the `{...existing.data}`
    // spread inside the commit arm.
    expect(nodes[0]?.data.facetStatuses.classification).toBe('committed');
    // wording stays 'proposed' (no wording-targeting events, 0
    // participants); rollupStatus priority ordering surfaces it.
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(o) preserves facetStatuses + rollupStatus across the facet-keyed classification commit branch', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      // Facet-keyed commit (ADR 0030 §2). The projection resolves the
      // committed classification via `currentClassificationByNode`.
      {
        id: '00000000-0000-4000-8000-0000000000c5',
        sessionId: SESSION_ID,
        sequence: 3,
        kind: 'commit',
        actor: ACTOR,
        payload: {
          target: 'facet',
          entity_kind: 'node',
          entity_id: NODE_A,
          facet: 'classification',
          committed_by: ACTOR,
          committed_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.kind).toBe('value');
    expect(nodes[0]?.data.facetStatuses.classification).toBe('committed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(p) ROLLUP_PRIORITY: proposed beats agreed across facets on the same node', () => {
    // Two participants join + agree on classify-node → classification:
    // 'agreed'. A set-node-substance proposal then lands with no votes
    // → substance: 'proposed'. Wording stays 'proposed' (no wording
    // votes against 2 current participants). Rollup priority surfaces
    // 'proposed' because at least one facet is proposed.
    const PROPOSAL_SUB = '00000000-0000-4000-8000-0000000000b2';
    const PARTICIPANT_X = '00000000-0000-4000-8000-0000000000b9';
    const PARTICIPANT_Y = '00000000-0000-4000-8000-0000000000ba';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000401',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_X,
          role: 'debater-A',
          screen_name: 'X',
          joined_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000402',
        sessionId: SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: {
          user_id: PARTICIPANT_Y,
          role: 'debater-B',
          screen_name: 'Y',
          joined_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      makeNodeCreated({ sequence: 3, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 4,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'predictive',
      }),
      {
        id: '00000000-0000-4000-8000-000000000601',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'vote',
        actor: PARTICIPANT_X,
        payload: {
          target: 'proposal',
          proposal_id: PROPOSAL_A,
          participant: PARTICIPANT_X,
          choice: 'agree',
          voted_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000602',
        sessionId: SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: PARTICIPANT_Y,
        payload: {
          target: 'proposal',
          proposal_id: PROPOSAL_A,
          participant: PARTICIPANT_Y,
          choice: 'agree',
          voted_at: '2026-05-27T00:00:00.000Z',
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
      {
        id: PROPOSAL_SUB,
        sessionId: SESSION_ID,
        sequence: 7,
        kind: 'proposal',
        actor: ACTOR,
        payload: {
          proposal: { kind: 'set-node-substance', node_id: NODE_A, value: 'agreed' },
        },
        createdAt: '2026-05-27T00:00:00.000Z',
      },
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.facetStatuses.classification).toBe('agreed');
    expect(nodes[0]?.data.facetStatuses.substance).toBe('proposed');
    expect(nodes[0]?.data.rollupStatus).toBe('proposed');
  });

  it('(sp) stamps step-pill data — facetCandidates, facetVotes, debaters — on statement nodes', () => {
    const T = '2026-05-27T00:00:00.000Z';
    const ALICE = '00000000-0000-4000-8000-0000000000a1';
    const BEN = '00000000-0000-4000-8000-0000000000a2';
    const events: Event[] = [
      {
        id: '00000000-0000-4000-8000-000000000701',
        sessionId: SESSION_ID,
        sequence: 1,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: { user_id: ALICE, role: 'debater-A', screen_name: 'Alice', joined_at: T },
        createdAt: T,
      },
      {
        id: '00000000-0000-4000-8000-000000000702',
        sessionId: SESSION_ID,
        sequence: 2,
        kind: 'participant-joined',
        actor: ACTOR,
        payload: { user_id: BEN, role: 'debater-B', screen_name: 'Ben', joined_at: T },
        createdAt: T,
      },
      makeNodeCreated({ sequence: 3, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 4,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      // Facet-keyed classification votes: Alice agrees, Ben disputes.
      {
        id: '00000000-0000-4000-8000-000000000703',
        sessionId: SESSION_ID,
        sequence: 5,
        kind: 'vote',
        actor: ALICE,
        payload: {
          target: 'facet',
          entity_kind: 'node',
          entity_id: NODE_A,
          facet: 'classification',
          participant: ALICE,
          choice: 'agree',
          voted_at: T,
        },
        createdAt: T,
      },
      {
        id: '00000000-0000-4000-8000-000000000704',
        sessionId: SESSION_ID,
        sequence: 6,
        kind: 'vote',
        actor: BEN,
        payload: {
          target: 'facet',
          entity_kind: 'node',
          entity_id: NODE_A,
          facet: 'classification',
          participant: BEN,
          choice: 'dispute',
          voted_at: T,
        },
        createdAt: T,
      },
      // Substance candidate.
      {
        id: '00000000-0000-4000-8000-000000000705',
        sessionId: SESSION_ID,
        sequence: 7,
        kind: 'proposal',
        actor: ACTOR,
        payload: { proposal: { kind: 'set-node-substance', node_id: NODE_A, value: 'agreed' } },
        createdAt: T,
      },
    ];
    const data = projectGraph(events).nodes[0]?.data;
    // Candidate values: classification kind + substance value (raw).
    expect(data?.facetCandidates).toEqual({ classification: 'fact', substance: 'agreed' });
    // Debater roster in slot order, both listed.
    expect(data?.debaters).toEqual([
      { role: 'debater-A', participantId: ALICE, screenName: 'Alice' },
      { role: 'debater-B', participantId: BEN, screenName: 'Ben' },
    ]);
    // Per-debater classification votes.
    const classVotes = data?.facetVotes?.classification ?? [];
    expect(classVotes).toHaveLength(2);
    const choiceById = Object.fromEntries(classVotes.map((v) => [v.participantId, v.choice]));
    expect(choiceById[ALICE]).toBe('agree');
    expect(choiceById[BEN]).toBe('dispute');
  });

  // ---------------------------------------------------------------
  // aud_axiom_mark_decoration — per-node axiom-mark stamping. Pinned
  // cases pulled directly from the refinement Constraints section.
  // ---------------------------------------------------------------

  function makeAxiomMarkProposal(opts: {
    sequence: number;
    envelopeId: string;
    nodeId: string;
    participantId: string;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: opts.participantId,
      payload: {
        proposal: {
          kind: 'axiom-mark',
          node_id: opts.nodeId,
          participant: opts.participantId,
        },
      },
      createdAt: '2026-05-28T00:00:00.000Z',
    };
  }

  const PARTICIPANT_AX_A = '00000000-0000-4000-8000-0000000000aa1';
  const PARTICIPANT_AX_B = '00000000-0000-4000-8000-0000000000bb2';
  const PROPOSAL_AX_A = '00000000-0000-4000-8000-0000000000ax1';
  const PROPOSAL_AX_B = '00000000-0000-4000-8000-0000000000ax2';

  it('(q) stamps axiomMarks: [] on every projected node by default when no axiom-mark events landed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks).toEqual([]);
  });

  it('(r) stamps a one-entry axiomMarks array on a node targeted by a committed axiom-mark', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks[0]).toEqual({
      nodeId: NODE_A,
      participantId: PARTICIPANT_AX_A,
      committedAt: '2026-05-27T00:00:00.000Z',
    });
  });

  it('(s) stamps a two-entry axiomMarks array on a node two participants have marked, in commit-arrival order', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_AX_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.axiomMarks.map((m) => m.participantId)).toEqual([
      PARTICIPANT_AX_B,
      PARTICIPANT_AX_A,
    ]);
  });

  it('(t) preserves axiomMarks across a later classify-node commit (commit-arm spread)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_A,
        nodeId: NODE_A,
        participantId: PARTICIPANT_AX_A,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_A }),
      makeClassifyProposal({
        sequence: 4,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.kind).toBe('value');
    expect(nodes[0]?.data.axiomMarks).toHaveLength(1);
    expect(nodes[0]?.data.axiomMarks[0]?.participantId).toBe(PARTICIPANT_AX_A);
  });

  it('(u) edges carry no axiomMarks field — AudienceEdgeData is unchanged', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toHaveLength(1);
    expect((edges[0]?.data as unknown as Record<string, unknown>).axiomMarks).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // aud_annotation_rendering — per-node annotation stamping. Pinned
  // cases pulled directly from the refinement Constraints section.
  // ---------------------------------------------------------------

  function makeAnnotationCreated(opts: {
    sequence: number;
    annotationId: string;
    kind: AnnotationKind;
    content?: string;
    targetNodeId: string | null;
    targetEdgeId: string | null;
  }): Event {
    return {
      id: `00000000-0000-4000-8000-${(0x500 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'annotation-created',
      actor: ACTOR,
      payload: {
        annotation_id: opts.annotationId,
        kind: opts.kind,
        content: opts.content ?? 'annotation body',
        target_node_id: opts.targetNodeId,
        target_edge_id: opts.targetEdgeId,
        created_by: ACTOR,
        created_at: '2026-05-28T00:00:00.000Z',
      },
      createdAt: '2026-05-28T00:00:00.000Z',
    };
  }

  const ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
  const ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
  const ANNO_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
  const ANNO_EDGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';

  it('(v) stamps annotations: [] on every projected node by default when no annotation events landed', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.annotations).toEqual([]);
  });

  it('(w) stamps a one-entry annotations array on a node targeted by a committed annotation-created', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_1,
        kind: 'note',
        content: 'see also F-003',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.annotations).toHaveLength(1);
    expect(nodes[0]?.data.annotations[0]).toEqual({
      id: ANNO_1,
      kind: 'note',
      content: 'see also F-003',
      targetNodeId: NODE_A,
      targetEdgeId: null,
      createdBy: ACTOR,
      createdAt: '2026-05-28T00:00:00.000Z',
    });
  });

  it('(x) stamps a multi-entry annotations array on a node with multiple committed annotations, in arrival order', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.annotations.map((a) => a.id)).toEqual([ANNO_1, ANNO_2, ANNO_3]);
  });

  it('(y) preserves annotations across a later classify-node commit (commit-arm spread)', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeClassifyProposal({
        sequence: 3,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'value',
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.kind).toBe('value');
    expect(nodes[0]?.data.annotations).toHaveLength(1);
    expect(nodes[0]?.data.annotations[0]?.id).toBe(ANNO_1);
  });

  it('(z) edges with no edge-targeted annotation carry annotations: EMPTY_ANNOTATIONS by default', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.annotations).toEqual([]);
  });

  // ---------------------------------------------------------------
  // aud_annotation_rendering_edges — per-edge annotation stamping.
  // Pinned cases pulled directly from the refinement Constraints
  // section.
  // ---------------------------------------------------------------

  it('(aaa) stamps annotations: EMPTY_ANNOTATIONS on every projected edge by default when no edge-targeted annotation events landed', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      // A node-targeted annotation in the same log must not leak into
      // the edge's bucket.
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.annotations).toEqual([]);
  });

  it('(bbb) stamps a one-entry annotations array on an edge targeted by a committed annotation-created', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_EDGE,
        kind: 'reframe',
        content: 'applies only to the accredited subset',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    ];
    const { edges } = projectGraph(events);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.annotations).toHaveLength(1);
    expect(edges[0]?.data.annotations[0]).toEqual({
      id: ANNO_EDGE,
      kind: 'reframe',
      content: 'applies only to the accredited subset',
      targetNodeId: null,
      targetEdgeId: EDGE_A,
      createdBy: ACTOR,
      createdAt: '2026-05-28T00:00:00.000Z',
    });
  });

  it('(ccc) stamps a multi-entry annotations array on an edge with multiple committed annotations, in arrival order', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
      makeAnnotationCreated({
        sequence: 5,
        annotationId: ANNO_2,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
      makeAnnotationCreated({
        sequence: 6,
        annotationId: ANNO_3,
        kind: 'stance',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    ];
    const { edges } = projectGraph(events);
    expect(edges[0]?.data.annotations.map((a) => a.id)).toEqual([ANNO_1, ANNO_2, ANNO_3]);
  });

  it('(ddd) symmetric isolation: a mixed log (one node-targeted + one edge-targeted) emits one annotation on each element', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 5,
        annotationId: ANNO_EDGE,
        kind: 'reframe',
        targetNodeId: null,
        targetEdgeId: EDGE_A,
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    const nodeA = nodes.find((n) => n.data.id === NODE_A);
    const nodeB = nodes.find((n) => n.data.id === NODE_B);
    expect(nodeA?.data.annotations.map((a) => a.id)).toEqual([ANNO_1]);
    expect(nodeB?.data.annotations).toEqual([]);
    expect(edges[0]?.data.annotations.map((a) => a.id)).toEqual([ANNO_EDGE]);
  });

  // ---------------------------------------------------------------
  // Supersession — a committed decompose / interpretive-split (the
  // parent) or restructure (the old node) OMITS the superseded node
  // (and any edge touching it) from the emitted graph entirely.
  // ---------------------------------------------------------------

  const COMPONENT_X = '00000000-0000-4000-8000-0000000000c1';
  const COMPONENT_Y = '00000000-0000-4000-8000-0000000000c2';
  const COMPONENT_Z = '00000000-0000-4000-8000-0000000000c3';
  const PROPOSAL_DEC_1 = '00000000-0000-4000-8000-0000000000d1';
  const PROPOSAL_DEC_2 = '00000000-0000-4000-8000-0000000000d2';
  const PROPOSAL_SPLIT_1 = '00000000-0000-4000-8000-0000000000d3';

  function makeDecomposeProposal(opts: {
    sequence: number;
    envelopeId: string;
    parentNodeId: string;
    components: ReadonlyArray<{ nodeId: string; wording: string; classification: StatementKind }>;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: ACTOR,
      payload: {
        proposal: {
          kind: 'decompose',
          parent_node_id: opts.parentNodeId,
          components: opts.components.map((c) => ({
            node_id: c.nodeId,
            wording: c.wording,
            classification: c.classification,
          })),
        },
      },
      createdAt: '2026-05-29T00:00:00.000Z',
    };
  }

  function makeInterpretiveSplitProposal(opts: {
    sequence: number;
    envelopeId: string;
    parentNodeId: string;
    readings: ReadonlyArray<{ nodeId: string; wording: string; classification: StatementKind }>;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: ACTOR,
      payload: {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: opts.parentNodeId,
          readings: opts.readings.map((c) => ({
            node_id: c.nodeId,
            wording: c.wording,
            classification: c.classification,
          })),
        },
      },
      createdAt: '2026-05-29T00:00:00.000Z',
    };
  }

  function makeRestructureProposal(opts: {
    sequence: number;
    envelopeId: string;
    oldNodeId: string;
    newNodeId: string;
    newWording: string;
  }): Event {
    return {
      id: opts.envelopeId,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'proposal',
      actor: ACTOR,
      payload: {
        proposal: {
          kind: 'edit-wording',
          edit_kind: 'restructure',
          node_id: opts.oldNodeId,
          new_wording: opts.newWording,
          new_node_id: opts.newNodeId,
        },
      },
      createdAt: '2026-05-29T00:00:00.000Z',
    };
  }

  it('(dec1) a pending (uncommitted) decompose leaves the parent in the graph', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: COMPONENT_Y, wording: 'Y' }),
      makeDecomposeProposal({
        sequence: 4,
        envelopeId: PROPOSAL_DEC_1,
        parentNodeId: NODE_A,
        components: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
        ],
      }),
    ];
    const { nodes } = projectGraph(events);
    // Supersession only takes effect on COMMIT — the pending proposal
    // leaves all three nodes in the graph.
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeDefined();
    expect(nodes.find((n) => n.data.id === COMPONENT_X)).toBeDefined();
    expect(nodes.find((n) => n.data.id === COMPONENT_Y)).toBeDefined();
  });

  it('(dec2) a committed decompose OMITS the parent and keeps the components', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'Parent wording' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: COMPONENT_Y, wording: 'Y' }),
      makeDecomposeProposal({
        sequence: 4,
        envelopeId: PROPOSAL_DEC_1,
        parentNodeId: NODE_A,
        components: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
        ],
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_DEC_1 }),
    ];
    const { nodes } = projectGraph(events);
    // The superseded parent is gone; the components remain.
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
    expect(nodes.find((n) => n.data.id === COMPONENT_X)).toBeDefined();
    expect(nodes.find((n) => n.data.id === COMPONENT_Y)).toBeDefined();
  });

  it('(dec3) a committed interpretive-split OMITS the parent', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: COMPONENT_Y, wording: 'Y' }),
      makeNodeCreated({ sequence: 4, nodeId: COMPONENT_Z, wording: 'Z' }),
      makeInterpretiveSplitProposal({
        sequence: 5,
        envelopeId: PROPOSAL_SPLIT_1,
        parentNodeId: NODE_A,
        readings: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
          { nodeId: COMPONENT_Z, wording: 'Z', classification: 'fact' },
        ],
      }),
      makeCommit({ sequence: 6, proposalEnvelopeId: PROPOSAL_SPLIT_1 }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
  });

  it('(dec4) a superseding decompose (first pending, second committed) OMITS the parent', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: COMPONENT_Y, wording: 'Y' }),
      makeDecomposeProposal({
        sequence: 4,
        envelopeId: PROPOSAL_DEC_1,
        parentNodeId: NODE_A,
        components: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
        ],
      }),
      makeDecomposeProposal({
        sequence: 5,
        envelopeId: PROPOSAL_DEC_2,
        parentNodeId: NODE_A,
        components: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
        ],
      }),
      makeCommit({ sequence: 6, proposalEnvelopeId: PROPOSAL_DEC_2 }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
  });

  it('(dec5) a commit against a classify-node proposal does NOT omit the node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'fact',
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    const parent = nodes.find((n) => n.data.id === NODE_A);
    // classify-node is not a supersession — the node stays, classified.
    expect(parent).toBeDefined();
    expect(parent?.data.kind).toBe('fact');
  });

  it('(dec6) a committed decompose OMITS the parent even if a later classify-node commit targets it', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: COMPONENT_Y, wording: 'Y' }),
      makeDecomposeProposal({
        sequence: 4,
        envelopeId: PROPOSAL_DEC_1,
        parentNodeId: NODE_A,
        components: [
          { nodeId: COMPONENT_X, wording: 'X', classification: 'fact' },
          { nodeId: COMPONENT_Y, wording: 'Y', classification: 'fact' },
        ],
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_DEC_1 }),
      makeClassifyProposal({
        sequence: 6,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_A,
        classification: 'normative',
      }),
      makeCommit({ sequence: 7, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
  });

  it('(dec7) a committed decompose drops edges with the superseded parent as an endpoint', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: COMPONENT_X, wording: 'X' }),
      makeNodeCreated({ sequence: 3, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 4, edgeId: EDGE_A, source: NODE_B, target: NODE_A }),
      makeDecomposeProposal({
        sequence: 5,
        envelopeId: PROPOSAL_DEC_1,
        parentNodeId: NODE_A,
        components: [{ nodeId: COMPONENT_X, wording: 'X', classification: 'fact' }],
      }),
      makeCommit({ sequence: 6, proposalEnvelopeId: PROPOSAL_DEC_1 }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
    // The edge into the superseded parent is dropped too.
    expect(edges.find((e) => e.data.id === EDGE_A)).toBeUndefined();
    expect(nodes.find((n) => n.data.id === NODE_B)).toBeDefined();
  });

  it('(dec8) a committed restructure OMITS the old node and keeps the freshly-minted node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'Old wording' }),
      makeRestructureProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        oldNodeId: NODE_A,
        newNodeId: NODE_B,
        newWording: 'Restructured wording',
      }),
      makeNodeCreated({ sequence: 3, nodeId: NODE_B, wording: 'Restructured wording' }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const { nodes } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeUndefined();
    expect(nodes.find((n) => n.data.id === NODE_B)).toBeDefined();
  });

  it('(j) is invariant under the POSITION of a participant-joined interleaved between node-created and its classify commit', () => {
    // The participant roster is causal (it feeds `data.debaters`), so both
    // logs carry the SAME participant-joined; the test pins that WHERE it
    // sits in the stream does not change the node projection.
    const direct: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_C, wording: 'C' }),
      makeParticipantJoined(2),
      makeClassifyProposal({
        sequence: 3,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_C,
        classification: 'predictive',
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const interleaved: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_C, wording: 'C' }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_A,
        nodeId: NODE_C,
        classification: 'predictive',
      }),
      makeParticipantJoined(3),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_A }),
    ];
    const directOut = projectGraph(direct);
    const interleavedOut = projectGraph(interleaved);
    expect(interleavedOut.nodes).toEqual(directOut.nodes);
    expect(interleavedOut.edges).toEqual(directOut.edges);
  });

  // ---------------------------------------------------------------
  // aud_render_annotation_endpoint_edges — hybrid promotion of
  // annotation-endpoint edges. The L308-321 skip-guard is lifted;
  // referenced annotations materialize as Cytoscape graph-nodes with
  // sentinel defaults; the synthetic annotation-host tether anchors
  // each promoted annotation to its host; the DOM-overlay-badge
  // population is filtered to exclude promoted ids (mutual exclusion).
  // ---------------------------------------------------------------

  function makeAnnotationEndpointEdge(opts: {
    sequence: number;
    edgeId: string;
    sourceNodeId?: string;
    targetNodeId?: string;
    sourceAnnotationId?: string;
    targetAnnotationId?: string;
    role?: EdgeRole;
  }): Event {
    const payload: Record<string, unknown> = {
      edge_id: opts.edgeId,
      role: opts.role ?? 'contradicts',
      created_by: ACTOR,
      created_at: '2026-05-30T00:00:00.000Z',
    };
    if (opts.sourceNodeId !== undefined) payload.source_node_id = opts.sourceNodeId;
    else payload.source_annotation_id = opts.sourceAnnotationId;
    if (opts.targetNodeId !== undefined) payload.target_node_id = opts.targetNodeId;
    else payload.target_annotation_id = opts.targetAnnotationId;
    return {
      id: `00000000-0000-4000-8000-${(0x600 + opts.sequence).toString(16).padStart(12, '0')}`,
      sessionId: SESSION_ID,
      sequence: opts.sequence,
      kind: 'edge-created',
      actor: ACTOR,
      payload: payload as Event extends { kind: 'edge-created'; payload: infer P } ? P : never,
      createdAt: '2026-05-30T00:00:00.000Z',
    };
  }

  const AEP_ANNO_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa601';
  const AEP_ANNO_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa602';
  const AEP_EDGE = '00000000-0000-4000-8000-000000000601';
  const AEP_HOST_EDGE = '00000000-0000-4000-8000-000000000602';

  it('(aep-1) stamps nodeKind: "statement" and annotationKind: null on every node from a node-created', () => {
    const events: Event[] = [makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' })];
    const { nodes } = projectGraph(events);
    expect(nodes[0]?.data.nodeKind).toBe('statement');
    expect(nodes[0]?.data.annotationKind).toBeNull();
  });

  it('(aep-2) stamps entityRole: "statement" on every edge from a statement edge-created', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: EDGE_A, source: NODE_A, target: NODE_B }),
    ];
    const { edges } = projectGraph(events);
    expect(edges[0]?.data.entityRole).toBe('statement');
  });

  it('(aep-3) emits an annotation-endpoint edge (node → annotation) with the promoted annotation node + host tether', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'N_A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: AEP_ANNO_1,
        kind: 'reframe',
        content: 'reframe of N_A',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 3,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
        role: 'contradicts',
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    // Statement node + promoted annotation node both exist.
    const annotationNode = nodes.find((n) => n.data.id === AEP_ANNO_1);
    expect(annotationNode?.data.nodeKind).toBe('annotation');
    expect(annotationNode?.data.annotationKind).toBe('reframe');
    expect(annotationNode?.data.wording).toBe('reframe of N_A');
    // Lifted statement edge with annotation-id target.
    const statementEdge = edges.find((e) => e.data.id === AEP_EDGE);
    expect(statementEdge?.data.source).toBe(NODE_A);
    expect(statementEdge?.data.target).toBe(AEP_ANNO_1);
    expect(statementEdge?.data.entityRole).toBe('statement');
    // Synthetic host pseudo-edge.
    const hostEdge = edges.find((e) => e.data.id === `annotation-host-${AEP_ANNO_1}`);
    expect(hostEdge?.data.source).toBe(NODE_A);
    expect(hostEdge?.data.target).toBe(AEP_ANNO_1);
    expect(hostEdge?.data.entityRole).toBe('annotation-host');
  });

  it('(aep-4) emits an annotation-source-endpoint edge resolving data.source to the annotation id', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'N_A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: AEP_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 3,
        edgeId: AEP_EDGE,
        sourceAnnotationId: AEP_ANNO_1,
        targetNodeId: NODE_A,
      }),
    ];
    const { edges } = projectGraph(events);
    const statementEdge = edges.find((e) => e.data.id === AEP_EDGE);
    expect(statementEdge?.data.source).toBe(AEP_ANNO_1);
    expect(statementEdge?.data.target).toBe(NODE_A);
  });

  it('(aep-5) emits an annotation-to-annotation edge with both endpoints resolved as annotation ids', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: AEP_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: AEP_ANNO_2,
        kind: 'stance',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 4,
        edgeId: AEP_EDGE,
        sourceAnnotationId: AEP_ANNO_1,
        targetAnnotationId: AEP_ANNO_2,
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === AEP_ANNO_1)).toBeDefined();
    expect(nodes.find((n) => n.data.id === AEP_ANNO_2)).toBeDefined();
    const statementEdge = edges.find((e) => e.data.id === AEP_EDGE);
    expect(statementEdge?.data.source).toBe(AEP_ANNO_1);
    expect(statementEdge?.data.target).toBe(AEP_ANNO_2);
  });

  it('(aep-6) mutual exclusion: a node-targeted annotation promoted by an edge endpoint drops from data.annotations on the host node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: AEP_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 3,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
      }),
    ];
    const { nodes } = projectGraph(events);
    const statementNode = nodes.find((n) => n.data.id === NODE_A);
    expect(statementNode?.data.annotations.map((a) => a.id)).toEqual([]);
  });

  it('(aep-7) defensive skip: an annotation-endpoint edge referencing an unknown annotation id is silently dropped', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationEndpointEdge({
        sequence: 2,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    expect(nodes.find((n) => n.data.id === NODE_A)).toBeDefined();
    expect(edges.find((e) => e.data.id === AEP_EDGE)).toBeUndefined();
  });

  it('(aep-8) annotation nodes carry sentinel defaults for statement-only fields', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: AEP_ANNO_1,
        kind: 'reframe',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 3,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
      }),
    ];
    const { nodes } = projectGraph(events);
    const annotationNode = nodes.find((n) => n.data.id === AEP_ANNO_1);
    expect(annotationNode?.data.kind).toBeNull();
    expect(annotationNode?.data.facetStatuses).toEqual({});
    expect(annotationNode?.data.rollupStatus).toBe('none');
    expect(annotationNode?.data.axiomMarks).toEqual([]);
    expect(annotationNode?.data.annotations).toEqual([]);
    expect(annotationNode?.data.decomposed).toBeUndefined();
  });

  it('(aep-9) host pseudo-edge is omitted (and node carries hostMissing) when the host cannot be resolved', () => {
    const events: Event[] = [
      // Annotation is decorating NODE_B but NODE_B is never created.
      makeAnnotationCreated({
        sequence: 1,
        annotationId: AEP_ANNO_1,
        kind: 'note',
        targetNodeId: NODE_B,
        targetEdgeId: null,
      }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_A, wording: 'A' }),
      makeAnnotationEndpointEdge({
        sequence: 3,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
      }),
    ];
    const { nodes, edges } = projectGraph(events);
    const annotationNode = nodes.find((n) => n.data.id === AEP_ANNO_1);
    expect(annotationNode?.data.hostMissing).toBe(true);
    expect(edges.find((e) => e.data.id === `annotation-host-${AEP_ANNO_1}`)).toBeUndefined();
  });

  it('(aep-10) an edge-hosted annotation tethers to the host edge source node', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'A' }),
      makeNodeCreated({ sequence: 2, nodeId: NODE_B, wording: 'B' }),
      makeEdgeCreated({ sequence: 3, edgeId: AEP_HOST_EDGE, source: NODE_A, target: NODE_B }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: AEP_ANNO_1,
        kind: 'scope-change',
        targetNodeId: null,
        targetEdgeId: AEP_HOST_EDGE,
      }),
      makeAnnotationEndpointEdge({
        sequence: 5,
        edgeId: AEP_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: AEP_ANNO_1,
      }),
    ];
    const { edges } = projectGraph(events);
    const hostEdge = edges.find((e) => e.data.id === `annotation-host-${AEP_ANNO_1}`);
    expect(hostEdge?.data.source).toBe(NODE_A);
    expect(hostEdge?.data.target).toBe(AEP_ANNO_1);
    expect(hostEdge?.data.entityRole).toBe('annotation-host');
  });

  // ---------------------------------------------------------------
  // aud_annotation_of_annotation_overlay_chain — propagation through
  // the polymorphic-entity-id bucketer. An annotation A2 whose
  // `target_node_id` carries promoted annotation A1's UUID surfaces in
  // A1's `data.annotations` array on the materialized annotation
  // graph-node, and the existing `<AudienceAnnotationOverlay>` renders
  // the DOM badge over it. Mirrors participant ann-oa-1/2/3.
  // ---------------------------------------------------------------

  const ANN_OA_A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa701';
  const ANN_OA_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa702';
  const ANN_OA_A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa703';
  const ANN_OA_EDGE = '00000000-0000-4000-8000-000000000701';

  it("(ann-oa-1) an annotation A2 whose target_node_id carries A1's id surfaces in A1's materialized graph-node data.annotations array", () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'N_A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANN_OA_A1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANN_OA_A2,
        kind: 'reframe',
        targetNodeId: ANN_OA_A1,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 4,
        edgeId: ANN_OA_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: ANN_OA_A1,
      }),
    ];
    const { nodes } = projectGraph(events);
    const annotationNode = nodes.find((n) => n.data.id === ANN_OA_A1);
    expect(annotationNode?.data.nodeKind).toBe('annotation');
    expect(annotationNode?.data.annotations.map((a) => a.id)).toEqual([ANN_OA_A2]);
    // N1's DOM-overlay population excludes the promoted A1 (mutual
    // exclusion per aud_render_annotation_endpoint_edges); A2 targets
    // A1 not N1, so N1's bucket is empty.
    const statementNode = nodes.find((n) => n.data.id === NODE_A);
    expect(statementNode?.data.annotations).toEqual([]);
  });

  it('(ann-oa-2) multiple annotations targeting the same materialized annotation graph-node aggregate in arrival order', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'N_A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANN_OA_A1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANN_OA_A2,
        kind: 'reframe',
        targetNodeId: ANN_OA_A1,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 4,
        annotationId: ANN_OA_A3,
        kind: 'stance',
        targetNodeId: ANN_OA_A1,
        targetEdgeId: null,
      }),
      makeAnnotationEndpointEdge({
        sequence: 5,
        edgeId: ANN_OA_EDGE,
        sourceNodeId: NODE_A,
        targetAnnotationId: ANN_OA_A1,
      }),
    ];
    const { nodes } = projectGraph(events);
    const annotationNode = nodes.find((n) => n.data.id === ANN_OA_A1);
    expect(annotationNode?.data.annotations.map((a) => a.id)).toEqual([ANN_OA_A2, ANN_OA_A3]);
  });

  it('(ann-oa-3) annotation-on-annotation where the target annotation is NOT materialized surfaces nowhere visually', () => {
    // No `edge-created` references A1 — A1 stays a DOM-overlay badge on
    // N1 and is NOT promoted to a graph-node. A2 targets A1 (not
    // materialized); the orphan A2 surfaces nowhere.
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_A, wording: 'N_A' }),
      makeAnnotationCreated({
        sequence: 2,
        annotationId: ANN_OA_A1,
        kind: 'note',
        targetNodeId: NODE_A,
        targetEdgeId: null,
      }),
      makeAnnotationCreated({
        sequence: 3,
        annotationId: ANN_OA_A2,
        kind: 'reframe',
        targetNodeId: ANN_OA_A1,
        targetEdgeId: null,
      }),
    ];
    const { nodes } = projectGraph(events);
    // A1 and A2 are NOT emitted as graph-nodes.
    expect(nodes).toHaveLength(1);
    expect(nodes.find((n) => n.data.id === ANN_OA_A1)).toBeUndefined();
    expect(nodes.find((n) => n.data.id === ANN_OA_A2)).toBeUndefined();
    // N1 keeps its existing overlay (A1 targets N1 — A1 is not
    // promoted, so the filter preserves it on N1's bucket).
    const statementNode = nodes.find((n) => n.data.id === NODE_A);
    expect(statementNode?.data.annotations.map((a) => a.id)).toEqual([ANN_OA_A1]);
    // The orphan A2 surfaces on no node: A2's bucket is keyed under
    // A1, but A1 was not materialized as a graph-node so nothing reads
    // that bucket.
    for (const n of nodes) {
      expect(n.data.annotations.find((a) => a.id === ANN_OA_A2)).toBeUndefined();
    }
  });
});
