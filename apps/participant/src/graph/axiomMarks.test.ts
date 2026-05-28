// Vitest cases for the participant-local `nodeHasAxiomMark` helper.
//
// Refinement: tasks/refinements/shell-package/shell_axiom_marks_extraction.md
//   (After the cross-surface lift the `projectAxiomMarks` /
//   `groupAxiomMarksByNode` cases moved to
//   `packages/shell/src/axiom-marks/axiom-marks.test.ts`. The
//   participant-local `nodeHasAxiomMark` helper stays here — single
//   call site, boolean-collapse shape the audience doesn't need.)
// Prior:
//   - tasks/refinements/participant-ui/part_axiom_mark_decoration.md
// ADRs: 0022 (no throwaway verifications).

import { describe, expect, it } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { groupAxiomMarksByNode, projectAxiomMarks, type AxiomMark } from '@a-conversa/shell';

import { nodeHasAxiomMark } from './axiomMarks';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NODE_X = '00000000-0000-4000-8000-0000000000c1';
const NODE_Y = '00000000-0000-4000-8000-0000000000c2';
const NODE_UNMARKED = '00000000-0000-4000-8000-0000000000c3';
const PARTICIPANT_A = '00000000-0000-4000-8000-000000000001';
const PARTICIPANT_B = '00000000-0000-4000-8000-000000000002';
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const PROPOSAL_AX_A_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa001';
const PROPOSAL_AX_B_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa002';
const PROPOSAL_AX_A_Y = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa003';

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
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

function makeCommit(opts: { sequence: number; proposalEnvelopeId: string }): Event {
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
      committed_at: '2026-05-17T00:00:00.000Z',
    },
    createdAt: '2026-05-17T00:00:00.000Z',
  };
}

describe('nodeHasAxiomMark', () => {
  it('returns true for a bucketed node and false for an unbucketed node', () => {
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

    expect(nodeHasAxiomMark(grouped, NODE_X)).toBe(true);
    expect(nodeHasAxiomMark(grouped, NODE_Y)).toBe(true);
    expect(nodeHasAxiomMark(grouped, NODE_UNMARKED)).toBe(false);
  });
});
