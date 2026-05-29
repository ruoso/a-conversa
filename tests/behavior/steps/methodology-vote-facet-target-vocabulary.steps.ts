// Steps for tests/behavior/methodology/vote-facet-target-vocabulary.feature.
//
// Cross-surface seam pin for the per-facet vote-projection vocabulary.
// The moderator's `projectVotesByFacet` and the participant's
// `projectOtherVotesByFacet` are the two client-side projectors that
// resolve proposal-arm votes to per-(entity, facet) buckets via their
// internal `voteTargetOf` / `facetTargetOf` dispatchers. The Vitest
// layer per surface pins each dispatcher's local behavior; this step
// file pins their AGREEMENT against the same in-memory event log.
//
// Refinement: tasks/refinements/data-and-methodology/align_vote_facet_target_vocabulary.md
// ADRs:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md,
//              docs/adr/0022-no-throwaway-verifications.md

import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { AConversaWorld } from '../support/world.js';
import type { Event } from '../../../packages/shared-types/src/events.js';
import type { FacetName, Vote } from '../../../packages/shell/src/index.js';
import { projectVotesByFacet } from '../../../apps/moderator/src/graph/selectors.js';
import { projectOtherVotesByFacet } from '../../../apps/participant/src/proposals/otherVotesByFacet.js';

// Distinct UUID prefix (`f7...`) from sibling step files so the shared
// Cucumber World doesn't collide on scratch state when scenarios run in
// one pass.
const FV_SESSION_ID = 'f7777777-7777-4777-8777-777777777000';
const FV_ACTOR_ID = 'f7777777-7777-4777-8777-777777777001';
const FV_NODE_ID = 'f7777777-7777-4777-8777-77777777700a';
const FV_EDGE_ID = 'f7777777-7777-4777-8777-77777777700b';
const FV_CAPTURED_NODE_ID = 'f7777777-7777-4777-8777-77777777700c';
const FV_EDGE_SRC_ID = 'f7777777-7777-4777-8777-77777777700d';
const FV_EDGE_TGT_ID = 'f7777777-7777-4777-8777-77777777700e';

const FV_PROP_CLASSIFY = 'f7777777-7777-4777-8777-7777777770a1';
const FV_PROP_NODE_SUBSTANCE = 'f7777777-7777-4777-8777-7777777770a2';
const FV_PROP_EDGE_SUBSTANCE = 'f7777777-7777-4777-8777-7777777770a3';
const FV_PROP_EDIT_WORDING = 'f7777777-7777-4777-8777-7777777770a4';
const FV_PROP_AMEND = 'f7777777-7777-4777-8777-7777777770a5';
const FV_PROP_CAPTURE = 'f7777777-7777-4777-8777-7777777770a6';

const FV_PARTICIPANT_A = 'f7777777-7777-4777-8777-777777777a01';
const FV_PARTICIPANT_B = 'f7777777-7777-4777-8777-777777777b01';

const FV_TS = '2026-05-28T00:00:00.000Z';

function evIdFor(label: string): string {
  // Stable, scenario-local UUIDs for vote events. The label is a short
  // string; we hash it into the trailing 12 hex chars of a v4-shape
  // template so each step's events get distinct IDs without
  // hand-maintaining a counter.
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const tail = h.toString(16).padStart(12, '0').slice(-12);
  return `f7777777-7777-4777-8777-${tail}`;
}

Given(
  'an in-memory event log seeded for the per-facet vote-vocabulary seam',
  function (this: AConversaWorld) {
    let seq = 0;
    const next = (): number => ++seq;

    const events: Event[] = [
      // Inline node-created for the captured node — `capture-node`
      // proposals emit `node-created` + `proposal` at the wire level
      // per ADR 0030 §1. The other (extant) node `FV_NODE_ID` is the
      // target for the four facet-valued proposals + amend-node.
      {
        id: evIdFor('node-created-captured'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'node-created',
        actor: FV_ACTOR_ID,
        payload: {
          node_id: FV_CAPTURED_NODE_ID,
          wording: 'captured node wording',
          created_by: FV_ACTOR_ID,
          created_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_CLASSIFY,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: { kind: 'classify-node', node_id: FV_NODE_ID, classification: 'fact' },
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_NODE_SUBSTANCE,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: { kind: 'set-node-substance', node_id: FV_NODE_ID, value: 'agreed' },
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_EDGE_SUBSTANCE,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: {
            kind: 'set-edge-substance',
            edge_id: FV_EDGE_ID,
            value: 'agreed',
            source_node_id: FV_EDGE_SRC_ID,
            target_node_id: FV_EDGE_TGT_ID,
            role: 'supports',
          },
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_EDIT_WORDING,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: {
            kind: 'edit-wording',
            edit_kind: 'reword',
            node_id: FV_NODE_ID,
            new_wording: 'reworded',
          },
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_AMEND,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: {
            kind: 'amend-node',
            node_id: FV_NODE_ID,
            new_content: 'amended content',
          },
        },
        createdAt: FV_TS,
      },
      {
        id: FV_PROP_CAPTURE,
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'proposal',
        actor: FV_ACTOR_ID,
        payload: {
          proposal: {
            kind: 'capture-node',
            node_id: FV_CAPTURED_NODE_ID,
            wording: 'captured node wording',
          },
        },
        createdAt: FV_TS,
      },
      // Proposal-arm votes from participant-A against each
      // facet-valued proposal — should land in `(N, classification)`,
      // `(N, substance)`, `(E, substance)`, `(N, wording)` on BOTH
      // projectors.
      {
        id: evIdFor('vote-classify'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: FV_PROP_CLASSIFY,
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      {
        id: evIdFor('vote-node-substance'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: FV_PROP_NODE_SUBSTANCE,
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      {
        id: evIdFor('vote-edge-substance'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: FV_PROP_EDGE_SUBSTANCE,
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      {
        id: evIdFor('vote-edit-wording'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: FV_PROP_EDIT_WORDING,
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      // Amend-node proposal-arm vote — both dispatchers return `null`,
      // so neither projector buckets this vote.
      {
        id: evIdFor('vote-amend'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'proposal',
          proposal_id: FV_PROP_AMEND,
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
      // Facet-arm wording vote on the captured node — both projectors
      // reach the `(node, wording)` bucket via the facet branch,
      // WITHOUT consulting the dispatcher.
      {
        id: evIdFor('vote-capture-wording'),
        sessionId: FV_SESSION_ID,
        sequence: next(),
        kind: 'vote',
        actor: FV_PARTICIPANT_A,
        payload: {
          target: 'facet',
          entity_kind: 'node',
          entity_id: FV_CAPTURED_NODE_ID,
          facet: 'wording',
          participant: FV_PARTICIPANT_A,
          choice: 'agree',
          voted_at: FV_TS,
        },
        createdAt: FV_TS,
      },
    ];

    this.scratch['fvEvents'] = events;
  },
);

type FlatBucket = ReadonlyMap<string, ReadonlyMap<FacetName, readonly Vote[]>>;

function bucketSummary(
  map: FlatBucket,
): Map<string, Array<{ participantId: string; choice: 'agree' | 'dispute' }>> {
  const out = new Map<string, Array<{ participantId: string; choice: 'agree' | 'dispute' }>>();
  for (const [entityId, perFacet] of map) {
    for (const [facet, votes] of perFacet) {
      out.set(
        `${entityId}|${facet}`,
        votes.map((v) => ({ participantId: v.participantId, choice: v.choice })),
      );
    }
  }
  return out;
}

When('both client projectors run against the seeded log', function (this: AConversaWorld) {
  const events = this.scratch['fvEvents'] as Event[];
  // The participant's projector takes a self-id and drops self-votes
  // at insertion. The voter is `FV_PARTICIPANT_A`; the participant's
  // self is `FV_PARTICIPANT_B`. The self-filter is therefore a no-op
  // for this seed and the two projectors should agree byte-for-byte.
  const modOut = projectVotesByFacet(events);
  const partOut = projectOtherVotesByFacet(events, FV_PARTICIPANT_B);
  this.scratch['fvModSummary'] = bucketSummary(modOut);
  this.scratch['fvPartSummary'] = bucketSummary(partOut);
});

Then(
  'both projectors produce the same per-\\(entity, facet) vote bucket',
  function (this: AConversaWorld) {
    const mod = this.scratch['fvModSummary'] as Map<
      string,
      Array<{ participantId: string; choice: 'agree' | 'dispute' }>
    >;
    const part = this.scratch['fvPartSummary'] as Map<
      string,
      Array<{ participantId: string; choice: 'agree' | 'dispute' }>
    >;
    const modJson = JSON.stringify([...mod.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const partJson = JSON.stringify([...part.entries()].sort(([a], [b]) => a.localeCompare(b)));
    assert.equal(
      modJson,
      partJson,
      'moderator and participant per-(entity, facet) buckets diverge',
    );

    // Spot-check the four facet-valued targets each have exactly one
    // vote from participant-A.
    for (const [key, expectedKey] of [
      [`${FV_NODE_ID}|classification`, '(node, classification)'],
      [`${FV_NODE_ID}|substance`, '(node, substance)'],
      [`${FV_EDGE_ID}|substance`, '(edge, substance)'],
      [`${FV_NODE_ID}|wording`, '(node, wording)'],
    ] as const) {
      const votes = mod.get(key);
      assert.ok(votes, `expected a moderator bucket for ${expectedKey}`);
      assert.deepEqual(votes, [{ participantId: FV_PARTICIPANT_A, choice: 'agree' }]);
    }
  },
);

Then('neither projector buckets the amend-node proposal-arm vote', function (this: AConversaWorld) {
  const mod = this.scratch['fvModSummary'] as Map<
    string,
    Array<{ participantId: string; choice: 'agree' | 'dispute' }>
  >;
  const part = this.scratch['fvPartSummary'] as Map<
    string,
    Array<{ participantId: string; choice: 'agree' | 'dispute' }>
  >;
  // The amend-node vote shares its node target (`FV_NODE_ID`) with
  // the edit-wording proposal's wording bucket — if the dispatcher
  // mistakenly bucketed amend-node as `(node, wording)`, the wording
  // bucket would carry TWO entries (one per vote). The
  // last-write-wins / position-stable semantics would still leave
  // the SAME participant id, so the bucket-length check is the
  // discriminating assertion.
  for (const summary of [mod, part]) {
    const wordingBucket = summary.get(`${FV_NODE_ID}|wording`);
    assert.ok(wordingBucket, 'expected a (node, wording) bucket from the edit-wording vote');
    assert.equal(
      wordingBucket.length,
      1,
      'amend-node vote leaked into the wording bucket — dispatcher misalignment',
    );
  }
});

Then(
  "both projectors bucket the captured node's wording vote under \\(node, wording)",
  function (this: AConversaWorld) {
    const mod = this.scratch['fvModSummary'] as Map<
      string,
      Array<{ participantId: string; choice: 'agree' | 'dispute' }>
    >;
    const part = this.scratch['fvPartSummary'] as Map<
      string,
      Array<{ participantId: string; choice: 'agree' | 'dispute' }>
    >;
    for (const summary of [mod, part]) {
      const captured = summary.get(`${FV_CAPTURED_NODE_ID}|wording`);
      assert.ok(captured, 'expected a (captured-node, wording) bucket from the facet-arm vote');
      assert.deepEqual(captured, [{ participantId: FV_PARTICIPANT_A, choice: 'agree' }]);
    }
  },
);
