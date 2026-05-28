// Vitest cases for the canonical `projectAxiomMarks` /
// `groupAxiomMarksByNode` derivation.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (Consolidates the moderator's `apps/moderator/src/graph/selectors.test.ts`
//   axiom-mark block + the participant's `apps/participant/src/graph/
//   axiomMarks.test.ts` + the audience's `apps/audience/src/graph/
//   axiomMarks.test.ts` into one suite at the canonical shell home.)
// ADRs:        0022 (no throwaway verifications).
//
// The 7 cases mirror the predecessor suites' union:
//   (a) empty event log → [].
//   (b) `axiom-mark` proposal without commit → [].
//   (c) one (proposal + commit) pair → one `AxiomMark` with the right
//       `nodeId` / `participantId` / `committedAt`.
//   (d) two participants marking the same node → two records (the
//       per-participant uniqueness invariant).
//   (e) emission order matches commit arrival order.
//   (f) mixed log — non-axiom-mark proposals (`classify-node`) and
//       unrelated event kinds are ignored.
//   (g) `groupAxiomMarksByNode` buckets axiom-marks under their target
//       node id (multi-bucket case).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { groupAxiomMarksByNode, projectAxiomMarks, type AxiomMark } from './axiom-marks.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_Y = '00000000-0000-4000-8000-0000000000c2';
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_AX_A_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const PROPOSAL_AX_B_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const PROPOSAL_AX_A_Y = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';
const PROPOSAL_AX_UNCOMMITTED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa004';
const PROPOSAL_CLASSIFY = '00000000-0000-4000-8000-0000000000d1';

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

function makeClassifyProposal(opts: {
  sequence: number;
  envelopeId: string;
  nodeId: string;
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
        classification: 'fact',
      },
    },
    createdAt: '2026-05-28T00:00:00.000Z',
  };
}

function makeNodeCreated(opts: { sequence: number; nodeId: string }): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x100 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'node-created',
    actor: ACTOR,
    payload: {
      node_id: opts.nodeId,
      wording: 'wording',
      created_by: ACTOR,
      created_at: '2026-05-28T00:00:00.000Z',
    },
    createdAt: '2026-05-28T00:00:00.000Z',
  };
}

function makeCommit(opts: {
  sequence: number;
  proposalEnvelopeId: string;
  committedAt?: string;
}): Event {
  return {
    id: `00000000-0000-4000-8000-${(0x800 + opts.sequence).toString(16).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'commit',
    actor: ACTOR,
    payload: {
      target: 'proposal',
      proposal_id: opts.proposalEnvelopeId,
      committed_by: ACTOR,
      committed_at: opts.committedAt ?? '2026-05-28T00:00:00.000Z',
    },
    createdAt: opts.committedAt ?? '2026-05-28T00:00:00.000Z',
  };
}

describe('projectAxiomMarks', () => {
  it('(a) returns [] for an empty event log', () => {
    expect(projectAxiomMarks([])).toEqual([]);
  });

  it('(b) returns [] when an axiom-mark proposal has no matching commit', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_UNCOMMITTED,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
    ];
    expect(projectAxiomMarks(events)).toEqual([]);
  });

  it('(c) emits one AxiomMark for a proposal + commit pair', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({
        sequence: 2,
        proposalEnvelopeId: PROPOSAL_AX_A_X,
        committedAt: '2026-05-28T10:00:00.000Z',
      }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({
      nodeId: NODE_X,
      participantId: PARTICIPANT_A,
      committedAt: '2026-05-28T10:00:00.000Z',
    });
  });

  it('(d) emits two AxiomMarks when two participants mark the same node (per-participant uniqueness invariant)', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.participantId)).toEqual([PARTICIPANT_A, PARTICIPANT_B]);
    expect(marks.every((m) => m.nodeId === NODE_X)).toBe(true);
  });

  it('(e) preserves emission order in commit-arrival order', () => {
    // Both proposals land before either commit; the emission order
    // tracks the commits, not the proposals.
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeAxiomMarkProposal({
        sequence: 2,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_AX_B_X }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks.map((m) => m.participantId)).toEqual([PARTICIPANT_B, PARTICIPANT_A]);
  });

  it('(f) ignores non-axiom-mark proposals + unrelated event kinds in a mixed log', () => {
    const events: Event[] = [
      makeNodeCreated({ sequence: 1, nodeId: NODE_X }),
      makeClassifyProposal({
        sequence: 2,
        envelopeId: PROPOSAL_CLASSIFY,
        nodeId: NODE_X,
      }),
      makeCommit({ sequence: 3, proposalEnvelopeId: PROPOSAL_CLASSIFY }),
      makeAxiomMarkProposal({
        sequence: 4,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 5, proposalEnvelopeId: PROPOSAL_AX_A_X }),
    ];
    const marks = projectAxiomMarks(events);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.participantId).toBe(PARTICIPANT_A);
    expect(marks[0]?.nodeId).toBe(NODE_X);
  });
});

describe('groupAxiomMarksByNode', () => {
  it('(g) buckets axiom-marks under their target node id', () => {
    const events: Event[] = [
      makeAxiomMarkProposal({
        sequence: 1,
        envelopeId: PROPOSAL_AX_A_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 2, proposalEnvelopeId: PROPOSAL_AX_A_X }),
      makeAxiomMarkProposal({
        sequence: 3,
        envelopeId: PROPOSAL_AX_B_X,
        nodeId: NODE_X,
        participantId: PARTICIPANT_B,
      }),
      makeCommit({ sequence: 4, proposalEnvelopeId: PROPOSAL_AX_B_X }),
      makeAxiomMarkProposal({
        sequence: 5,
        envelopeId: PROPOSAL_AX_A_Y,
        nodeId: NODE_Y,
        participantId: PARTICIPANT_A,
      }),
      makeCommit({ sequence: 6, proposalEnvelopeId: PROPOSAL_AX_A_Y }),
    ];
    const grouped: ReadonlyMap<string, readonly AxiomMark[]> = groupAxiomMarksByNode(
      projectAxiomMarks(events),
    );
    expect(grouped.get(NODE_X)?.map((m) => m.participantId)).toEqual([
      PARTICIPANT_A,
      PARTICIPANT_B,
    ]);
    expect(grouped.get(NODE_Y)?.map((m) => m.participantId)).toEqual([PARTICIPANT_A]);
  });
});
