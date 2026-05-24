// Tests for the real `commit` action handler.
//
// Refinement: tasks/refinements/data-and-methodology/commit_logic.md
// TaskJuggler: data_and_methodology.methodology_engine.commit_logic
//
// The framework-level dispatcher tests live in
// `apps/server/src/methodology/engine.test.ts`. This file covers the
// commit-specific rule set:
//
//   1. Moderator gate — debaters can't commit.
//   2. Proposal exists — unknown id rejected.
//   3. Proposal is pending — already-committed / meta-disagreement
//      rejected.
//   4. Unanimous agree across current NON-moderator participants —
//      every current debater must have voted agree on the affected
//      facet; the moderator is structurally excluded from the walk
//      (commit IS the moderator's act of agreement, per
//      `docs/methodology.md` § "The commit step" lines 15–25 — "the
//      moderator's role is structural, not interpretive ... they
//      enact [agreement] once participants have expressed it").
//      Mirrors `deriveCurrentParticipants` in
//      `apps/moderator/src/graph/proposalFacets.ts` (Decision §1.a —
//      "only debaters vote").
//
// Plus the chosen semantics for a participant who left after agreeing
// (left participants don't count, consistent with `deriveFacetStatus`
// rule 2 on the read side).

import { describe, expect, it } from 'vitest';

import type { Event } from '@a-conversa/shared-types';

import { createEmptyProjection } from '../../projection/projection.js';
import { applyEvent } from '../../projection/replay.js';
import { deriveFacetStatus } from '../../projection/facet-status.js';
import { nextSequence } from '../primitives.js';
import { validateAction, type CommitAction } from '../index.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const HOST_ID = '22222222-2222-4222-8222-222222222222';
const MODERATOR_ID = '33333333-3333-4333-8333-333333333333';
const DEBATER_A_ID = '44444444-4444-4444-8444-444444444444';
const DEBATER_B_ID = '55555555-5555-4555-8555-555555555555';

const NODE_ID_1 = '77777777-7777-4777-8777-777777777777';
const NODE_ID_STRUCT = '88888888-8888-4888-8888-888888888888';
const PROPOSAL_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID_STRUCT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PROPOSAL_ID_UNKNOWN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW_EVENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

// Seed a session at sequence 6 with three participants, one node, and
// one pending `classify-node` proposal. No votes yet.
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
      node_id: NODE_ID_1,
      wording: 'A statement.',
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(projection, {
    ...makeEvent(6, 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'classify-node', node_id: NODE_ID_1, classification: 'fact' },
    }),
    id: PROPOSAL_ID_1,
  });
  return projection;
}

// Apply a vote event at the next-expected sequence.
function applyVote(
  projection: ReturnType<typeof createEmptyProjection>,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  proposalId: string = PROPOSAL_ID_1,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'vote', participant, T9, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: T9,
    }),
  );
}

// Build a `commit` action at the next-expected sequence.
function makeCommitAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string = MODERATOR_ID,
  proposalEventId: string = PROPOSAL_ID_1,
): CommitAction {
  return {
    kind: 'commit',
    requester,
    sessionId: SESSION_ID,
    eventId: NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    proposalEventId,
    committedAt: T9,
  };
}

// ---------------------------------------------------------------
// Rule 1 — moderator gate.
// ---------------------------------------------------------------

describe('commit handler — rule 1: moderator gate', () => {
  it('rejects a commit from a debater with not-a-moderator', () => {
    const p = seedSession();
    // Make the commit valid in every other respect — every debater has
    // voted agree — so the only failing rule is the moderator gate.
    // (The moderator does NOT vote: commit is the moderator's act of
    // agreement; see the file header for the methodology rationale.)
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    const action = makeCommitAction(p, DEBATER_A_ID);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-a-moderator');
      expect(r.detail).toContain(DEBATER_A_ID);
    }
  });
});

// ---------------------------------------------------------------
// Rule 2 — proposal exists.
// ---------------------------------------------------------------

describe('commit handler — rule 2: proposal exists', () => {
  it('rejects a commit referencing an unknown proposal id', () => {
    const p = seedSession();
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_UNKNOWN);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-not-found');
      expect(r.detail).toContain(PROPOSAL_ID_UNKNOWN);
    }
  });
});

// ---------------------------------------------------------------
// Rule 3 — proposal is pending.
// ---------------------------------------------------------------

describe('commit handler — rule 3: proposal is pending', () => {
  it('rejects a commit on an already-committed proposal with proposal-already-committed', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'commit', MODERATOR_ID, T9, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        committed_by: MODERATOR_ID,
        committed_at: T9,
      }),
    );
    // Second commit attempt on the same proposal.
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_1);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-committed');
    }
  });

  it('rejects a commit on a meta-disagreement-marked proposal with proposal-already-meta-disagreement', () => {
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'meta-disagreement-marked', MODERATOR_ID, T9, {
        target: 'proposal',
        proposal_id: PROPOSAL_ID_1,
        marked_by: MODERATOR_ID,
        marked_at: T9,
      }),
    );
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_1);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-meta-disagreement');
    }
  });
});

// ---------------------------------------------------------------
// Rule 4 — unanimous agree across current participants.
// ---------------------------------------------------------------

describe('commit handler — rule 4: unanimous agree (moderator-excluded)', () => {
  it('rejects when no debater has voted yet (all missing) AND does NOT list the moderator', () => {
    const p = seedSession();
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain('missing votes');
      // The moderator is NOT part of the unanimity walk — even though
      // the moderator has not voted, the rejection must not name them
      // (commit IS the moderator's act of agreement; there is no
      // separate moderator vote to be missing).
      expect(r.detail).not.toContain(MODERATOR_ID);
      expect(r.detail).toContain(DEBATER_A_ID);
      expect(r.detail).toContain(DEBATER_B_ID);
    }
  });

  it('rejects when one debater has voted agree but another has not', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    // DEBATER_B has not voted.
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain('missing votes');
      expect(r.detail).toContain(DEBATER_B_ID);
      expect(r.detail).not.toContain(MODERATOR_ID);
    }
  });

  it('rejects when one debater has voted dispute', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'dispute');
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain('non-agree votes');
      expect(r.detail).toContain(`${DEBATER_B_ID}=dispute`);
    }
  });

  it('rejects when one debater has voted withdraw (without prior commit)', () => {
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'withdraw');
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain(`${DEBATER_B_ID}=withdraw`);
    }
  });

  it('accepts when every CURRENT DEBATER has voted agree (moderator has NOT cast a vote)', () => {
    // CANONICAL CONTRACT TEST.
    //
    // Per `docs/methodology.md` lines 15–25 (§ "The commit step"):
    //
    //   "The moderator's role is structural, not interpretive. They
    //    don't decide whether agreement has been reached on the merits;
    //    they enact it once participants have expressed it."
    //
    // The commit IS the moderator's act of agreement; there is no
    // separate moderator vote. With every debater voting agree and the
    // moderator never having cast a vote event, the commit succeeds.
    // Mirrors `deriveCurrentParticipants` on the client side
    // (`apps/moderator/src/graph/proposalFacets.ts`, Decision §1.a —
    // "only debaters vote").
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    // NOTE: NO moderator vote is cast.
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('commit');
      expect(ev.id).toBe(NEW_EVENT_ID);
      expect(ev.sessionId).toBe(SESSION_ID);
      expect(ev.sequence).toBe(action.sequence);
      expect(ev.actor).toBe(MODERATOR_ID);
      expect(ev.createdAt).toBe(T9);
      if (ev.kind === 'commit' && ev.payload.target === 'facet') {
        // Per ADR 0030 §2 + §9 + `pf_commit_handler_facet_keyed`, the
        // commit payload is a `target`-discriminated union. For the
        // four facet-valued sub-kinds (classify-node /
        // set-node-substance / set-edge-substance / edit-wording) the
        // handler emits the facet-keyed arm keyed by
        // `(entity_kind, entity_id, facet)`. The seed proposal is a
        // `classify-node` on `NODE_ID_1`; the matching facet is
        // `node.classification`.
        expect(ev.payload.entity_kind).toBe('node');
        expect(ev.payload.entity_id).toBe(NODE_ID_1);
        expect(ev.payload.facet).toBe('classification');
        expect(ev.payload.committed_by).toBe(MODERATOR_ID);
        expect(ev.payload.committed_at).toBe(T9);
      } else {
        // Programmer-error guard: the seed is facet-valued; the handler
        // MUST emit the facet arm. If a future test reshuffle changes
        // the seed sub-kind, this branch fails loudly so the
        // assertion-pattern is updated rather than silently degraded.
        expect.fail(
          `expected facet-keyed commit emission for classify-node; got target=${
            ev.kind === 'commit' ? ev.payload.target : 'non-commit'
          }`,
        );
      }
    }
  });

  it('also accepts when the moderator HAS cast an agree vote alongside the debaters (extra moderator-vote events are harmless to the walk)', () => {
    // Defensive coverage: clients that incidentally route a moderator
    // vote event through the wire (legacy clients, replays of older
    // event logs) must not change the outcome. The walk ignores the
    // moderator's row regardless of what it contains.
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------
// ADR 0030 §2 + §9 — `target`-discriminated commit emission.
//
// The handler emits `target: 'facet'` for the four facet-valued sub-
// kinds (classify-node / set-node-substance / set-edge-substance /
// edit-wording) and `target: 'proposal'` for the seven structural sub-
// kinds (decompose / interpretive-split / axiom-mark / meta-move /
// break-edge / amend-node / annotate). The dispatcher reads the same
// `facetTargetForProposal` helper rule 4 uses (`null` ↔ structural arm,
// non-null ↔ facet arm).
// ---------------------------------------------------------------

describe('commit handler — facet-arm vs proposal-arm emission per ADR 0030', () => {
  it('emits the facet-keyed arm for the four facet-valued sub-kinds (classify-node here as canonical)', () => {
    // The seed's PROPOSAL_ID_1 is a classify-node; the dispatcher emits
    // `target: 'facet'` keyed by (`node`, NODE_ID_1, `classification`).
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.events[r.events.length - 1]!;
    expect(ev.kind).toBe('commit');
    if (ev.kind !== 'commit') return;
    expect(ev.payload.target).toBe('facet');
    if (ev.payload.target !== 'facet') return;
    expect(ev.payload.entity_kind).toBe('node');
    expect(ev.payload.entity_id).toBe(NODE_ID_1);
    expect(ev.payload.facet).toBe('classification');
    expect(ev.payload.committed_by).toBe(MODERATOR_ID);
  });

  it('emits the proposal-keyed arm for structural sub-kinds (axiom-mark here as canonical)', () => {
    // Seed a parallel structural proposal — axiom-mark — and commit it.
    // Axiom-mark is a structural sub-kind per ADR 0030 §9: the commit
    // attaches to the proposal id, not to a facet.
    const p = seedSession();
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'node-created', DEBATER_A_ID, T2, {
        node_id: NODE_ID_STRUCT,
        wording: 'A bedrock claim.',
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'axiom-mark',
          node_id: NODE_ID_STRUCT,
          participant: DEBATER_A_ID,
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    // For axiom-mark the declared participant (DEBATER_A_ID) is
    // excluded from the required-voters set per
    // `checkUnanimousAgreeStructural`. DEBATER_B's agree alone is
    // sufficient.
    applyVote(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.events[r.events.length - 1]!;
    expect(ev.kind).toBe('commit');
    if (ev.kind !== 'commit') return;
    expect(ev.payload.target).toBe('proposal');
    if (ev.payload.target !== 'proposal') return;
    expect(ev.payload.proposal_id).toBe(PROPOSAL_ID_STRUCT);
    expect(ev.payload.committed_by).toBe(MODERATOR_ID);
  });

  it('refuses a second commit on the same facet via the facet-status cross-check (the facet is already `committed`)', () => {
    // First commit lands the facet as `committed`. A second commit
    // attempt on the same proposal must not land. Per ADR 0030 §2 the
    // projection's facet-keyed `handleCommit` does NOT remove the
    // pending proposal (only the proposal-keyed arm does); the
    // facet-status cross-check inside `checkUnanimousAgreeFacet` is the
    // gate that catches the duplicate.
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    const firstAction = makeCommitAction(p);
    const firstResult = validateAction(p, firstAction);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    // Apply the emitted facet-keyed commit event so the projection's
    // `handleCommit` stamps the facet `'committed'`.
    for (const ev of firstResult.events) {
      applyEvent(p, ev);
    }
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('committed');
    // Second commit attempt at the next sequence with a fresh event id.
    const secondAction: CommitAction = {
      ...makeCommitAction(p),
      eventId: '11111111-1111-4111-8111-aaaaaaaaaaaa',
    };
    const r = validateAction(p, secondAction);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('proposal-already-committed');
    }
  });
});

// ---------------------------------------------------------------
// Participant-leaves-after-voting semantics.
//
// Decision (per refinement): a participant who left no longer counts
// toward rule 4. Their prior `agree` vote sits historically in the
// `perParticipant` map but is filtered out by the
// `currentParticipants()` walk; the remaining current set's unanimity
// gates the commit. Matches `deriveFacetStatus` rule 2 on the read
// side.
// ---------------------------------------------------------------

describe('commit handler — participant-leaves-after-voting semantics', () => {
  it('accepts when a participant left after voting agree and the remaining set is unanimous', () => {
    const p = seedSession();
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    // DEBATER_B leaves the session after voting agree.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'participant-left', DEBATER_B_ID, T9, {
        user_id: DEBATER_B_ID,
        left_at: T9,
      }),
    );
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    // Cross-check: read-side derivation also returns `'agreed'`.
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });

  it('accepts when a participant left without voting and the remaining current set is unanimous', () => {
    const p = seedSession();
    // DEBATER_B leaves before voting.
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'participant-left', DEBATER_B_ID, T9, {
        user_id: DEBATER_B_ID,
        left_at: T9,
      }),
    );
    // Remaining current participants both vote agree.
    applyVote(p, MODERATOR_ID, 'agree');
    applyVote(p, DEBATER_A_ID, 'agree');
    const action = makeCommitAction(p);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('agreed');
  });
});

// ---------------------------------------------------------------
// Structural-sub-kind commits.
//
// Per docs/methodology.md every change to the graph requires unanimous
// agreement — structural moves (decompose, interpretive-split,
// axiom-mark, annotate) are not special-cased. The commit handler
// accepts these sub-kinds when every current participant has voted
// agree on the pending proposal (`perParticipantVotes` populated by
// `handleVote`).
//
// Axiom-mark is special: the participant whose bedrock is declared
// doesn't vote separately — their proposal IS the declaration. The
// unanimity walk excludes that participant from the required set.
// ---------------------------------------------------------------

const COMPONENT_NODE_ID_1 = '00000000-0000-4000-8000-00000000e031';
const COMPONENT_NODE_ID_2 = '00000000-0000-4000-8000-00000000e032';

// Apply propose-time `node-created` + `entity-included` for a structural
// component / reading, mirroring `buildStructuralEventsForPropose`.
function applyComponentCreate(
  projection: ReturnType<typeof createEmptyProjection>,
  nodeId: string,
  wording: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'node-created', DEBATER_A_ID, T2, {
      node_id: nodeId,
      wording,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'entity-included', DEBATER_A_ID, T2, {
      entity_kind: 'node',
      entity_id: nodeId,
      included_by: DEBATER_A_ID,
      included_at: T2,
    }),
  );
}

// Seed the parent node a structural proposal targets.
function seedStructuralParent(
  projection: ReturnType<typeof createEmptyProjection>,
  nodeId: string,
  wording: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'node-created', DEBATER_A_ID, T2, {
      node_id: nodeId,
      wording,
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

// Apply a vote against the supplied proposal id at the next sequence.
function voteStructural(
  projection: ReturnType<typeof createEmptyProjection>,
  participant: string,
  vote: 'agree' | 'dispute' | 'withdraw',
  proposalId: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'vote', participant, T9, {
      target: 'proposal' as const,
      proposal_id: proposalId,
      participant,
      choice: vote as 'agree' | 'dispute',
      voted_at: T9,
    }),
  );
}

describe('commit handler — structural sub-kind: decompose', () => {
  it('accepts a commit on a fully-agreed decompose proposal and emits the commit event', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to decompose.');
    // Propose-time fan-out — components land via `node-created` +
    // `entity-included` per ADR 0027.
    applyComponentCreate(p, COMPONENT_NODE_ID_1, 'Component one.');
    applyComponentCreate(p, COMPONENT_NODE_ID_2, 'Component two.');
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID_STRUCT,
          components: [
            { wording: 'Component one.', classification: 'fact', node_id: COMPONENT_NODE_ID_1 },
            { wording: 'Component two.', classification: 'value', node_id: COMPONENT_NODE_ID_2 },
          ],
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    // Unanimous agree across the three current participants.
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      const ev = r.events[0]!;
      expect(ev.kind).toBe('commit');
      if (ev.kind === 'commit' && ev.payload.target === 'proposal') {
        expect(ev.payload.proposal_id).toBe(PROPOSAL_ID_STRUCT);
      }
    }
  });

  it('rejects a decompose commit when a participant has not voted', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to decompose.');
    applyComponentCreate(p, COMPONENT_NODE_ID_1, 'Component one.');
    applyComponentCreate(p, COMPONENT_NODE_ID_2, 'Component two.');
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'decompose',
          parent_node_id: NODE_ID_STRUCT,
          components: [
            { wording: 'Component one.', classification: 'fact', node_id: COMPONENT_NODE_ID_1 },
            { wording: 'Component two.', classification: 'value', node_id: COMPONENT_NODE_ID_2 },
          ],
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    // DEBATER_B_ID hasn't voted.
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain(DEBATER_B_ID);
    }
  });
});

describe('commit handler — structural sub-kind: interpretive-split', () => {
  it('accepts a commit on a fully-agreed interpretive-split proposal', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to re-read.');
    applyComponentCreate(p, COMPONENT_NODE_ID_1, 'Reading one.');
    applyComponentCreate(p, COMPONENT_NODE_ID_2, 'Reading two.');
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'interpretive-split',
          parent_node_id: NODE_ID_STRUCT,
          readings: [
            { wording: 'Reading one.', classification: 'fact', node_id: COMPONENT_NODE_ID_1 },
            { wording: 'Reading two.', classification: 'value', node_id: COMPONENT_NODE_ID_2 },
          ],
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
  });
});

describe('commit handler — structural sub-kind: axiom-mark', () => {
  it('accepts a commit on a fully-agreed axiom-mark proposal; the declared participant does not need to vote', () => {
    const p = seedSession();
    // DEBATER_A_ID declares N1 as their axiom. Per the methodology
    // "we all agree that this participant holds this node as bedrock"
    // — the proposer IS the declarer. Only the other participants
    // need to vote agree.
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'axiom-mark',
          node_id: NODE_ID_1,
          participant: DEBATER_A_ID,
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    // DEBATER_A_ID intentionally does NOT vote — they're the declarer.
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(1);
      expect(r.events[0]!.kind).toBe('commit');
    }
  });

  it('rejects an axiom-mark commit when one non-declarer participant has not voted', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'axiom-mark',
          node_id: NODE_ID_1,
          participant: DEBATER_A_ID,
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    // DEBATER_B_ID missing.
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain(DEBATER_B_ID);
    }
  });
});

describe('commit handler — structural sub-kind: annotate', () => {
  it('accepts a commit on a fully-agreed annotate proposal and emits annotation-created + commit', () => {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'annotate',
          target_kind: 'node',
          target_id: NODE_ID_1,
          annotation_kind: 'note',
          content: 'Context for this node.',
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // annotation-created precedes commit; commit envelope is last.
      expect(r.events).toHaveLength(2);
      expect(r.events[0]!.kind).toBe('annotation-created');
      expect(r.events[1]!.kind).toBe('commit');
      const annotationEvent = r.events[0]!;
      if (annotationEvent.kind === 'annotation-created') {
        expect(annotationEvent.payload.content).toBe('Context for this node.');
        expect(annotationEvent.payload.target_node_id).toBe(NODE_ID_1);
        expect(annotationEvent.payload.target_edge_id).toBeNull();
        expect(annotationEvent.payload.kind).toBe('note');
      }
    }
  });
});
