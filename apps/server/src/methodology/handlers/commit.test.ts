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
import { annotationCreatedPayloadSchema } from '@a-conversa/shared-types';

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
const EDGE_ID_1 = '99999999-9999-4999-8999-999999999999';

// RFC 4122 v4 UUID shape — the meta-move arm mints `annotation_id` /
// envelope `id` via `randomUUID()`, so both must match this.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

// Build a `commit` action at the next-expected sequence. Defaults to
// the facet arm against the seeded `classify-node` proposal's
// classification facet (NODE_ID_1) — the canonical facet-valued case.
// Pass an explicit `proposalEventId` to route through the proposal arm
// (used for structural sub-kinds and rule-2 / rule-3 tests).
function makeCommitAction(
  projection: ReturnType<typeof createEmptyProjection>,
  requester: string = MODERATOR_ID,
  proposalEventId?: string,
): CommitAction {
  const baseCommon = {
    kind: 'commit' as const,
    requester,
    sessionId: SESSION_ID,
    eventId: NEW_EVENT_ID,
    sequence: nextSequence(projection),
    actor: requester,
    createdAt: T9,
    committedAt: T9,
  };
  if (proposalEventId === undefined) {
    return {
      ...baseCommon,
      target: 'facet' as const,
      entityKind: 'node' as const,
      entityId: NODE_ID_1,
      facet: 'classification' as const,
    };
  }
  return {
    ...baseCommon,
    target: 'proposal' as const,
    proposalEventId,
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

  it('refuses a second commit on the same facet — the projection swept the proposal so the engine sees `proposal-not-found`', () => {
    // First commit lands the facet as `committed`. A second commit
    // attempt on the same proposal must not land. The projection's
    // facet-keyed `handleCommit` clears every pending proposal whose
    // payload targets the resolved facet (per the facet-resolution
    // sweep in `apps/server/src/projection/replay.ts`), so the engine's
    // `findProposal` rule-2 lookup returns `null` for the second
    // attempt and the request is rejected with `'proposal-not-found'`.
    // The facet-status cross-check inside `checkUnanimousAgreeFacet`
    // (rejecting with `'proposal-already-committed'`) stays in the
    // commit handler as a defense-in-depth for races where a proposal
    // somehow remains pending while the facet is already resolved;
    // under steady-state replay the projection sweep is the primary
    // gate.
    const p = seedSession();
    applyVote(p, DEBATER_A_ID, 'agree');
    applyVote(p, DEBATER_B_ID, 'agree');
    const firstAction = makeCommitAction(p);
    const firstResult = validateAction(p, firstAction);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    // Apply the emitted facet-keyed commit event so the projection's
    // `handleCommit` stamps the facet `'committed'` and sweeps the
    // pending proposal.
    for (const ev of firstResult.events) {
      applyEvent(p, ev);
    }
    expect(deriveFacetStatus(p, 'node', NODE_ID_1, 'classification')).toBe('committed');
    expect(p.getPendingProposal(PROPOSAL_ID_1)).toBeUndefined();
    // Second commit attempt at the next sequence with a fresh event id.
    // Under the discriminated-union refactor the facet-arm commit reads
    // the facet's derived status directly; the facet is now
    // `'committed'`, so the engine rejects with
    // `'proposal-already-committed'` (the proposal lookup that used to
    // surface `'proposal-not-found'` post-sweep is no longer on the
    // path — the facet status IS the authoritative gate).
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

// ---------------------------------------------------------------
// Interpretive-split edge inheritance (ADR 0046).
//
// At commit, each of the parent's QUALIFYING outgoing edges is
// mirrored onto each reading node: `edge-created` (fresh id, the
// parent edge's role, the reading as source, the target endpoint
// carried verbatim) + `entity-included` + a facet-keyed
// `commit{carried_from_edge_id}`, the whole cluster before the
// split's own proposal-keyed commit. Qualifying = parent is the
// source, edge included and visible, substance facet committed.
// Refinement:
// tasks/refinements/data-and-methodology/interpretive_split_edge_inheritance.md
// ---------------------------------------------------------------

const SPLIT_TARGET_NODE_ID = '00000000-0000-4000-8000-00000000e040';
const SPLIT_ANNOTATION_ID = '00000000-0000-4000-8000-00000000e041';
const EDGE_OUT_COMMITTED_ID = '00000000-0000-4000-8000-00000000e051';
const EDGE_IN_COMMITTED_ID = '00000000-0000-4000-8000-00000000e052';
const EDGE_OUT_PROPOSED_ID = '00000000-0000-4000-8000-00000000e053';
const EDGE_OUT_REMOVED_ID = '00000000-0000-4000-8000-00000000e054';
const EDGE_TO_ANNOTATION_ID = '00000000-0000-4000-8000-00000000e055';

// Apply an `edge-created` with a polymorphic target endpoint.
function applyEdgeCreate(
  projection: ReturnType<typeof createEmptyProjection>,
  edgeId: string,
  sourceNodeId: string,
  target: { node?: string; annotation?: string },
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'edge-created', DEBATER_A_ID, T2, {
      edge_id: edgeId,
      role: 'rebuts',
      source_node_id: sourceNodeId,
      ...(target.node !== undefined ? { target_node_id: target.node } : {}),
      ...(target.annotation !== undefined ? { target_annotation_id: target.annotation } : {}),
      created_by: DEBATER_A_ID,
      created_at: T2,
    }),
  );
}

// Land the edge's substance facet in the committed terminal state:
// a `set-edge-substance` proposal supplies the candidate, a facet-keyed
// commit pins it (`deriveFacetStatus` reads `'committed'`).
function applyLandedEdgeSubstance(
  projection: ReturnType<typeof createEmptyProjection>,
  edgeId: string,
): void {
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
      proposal: { kind: 'set-edge-substance', edge_id: edgeId, value: 'agreed' },
    }),
  );
  applyEvent(
    projection,
    makeEvent(nextSequence(projection), 'commit', MODERATOR_ID, T3, {
      target: 'facet' as const,
      entity_kind: 'edge' as const,
      entity_id: edgeId,
      facet: 'substance' as const,
      committed_by: MODERATOR_ID,
      committed_at: T3,
    }),
  );
}

// Apply the propose-time reading fan-out + the split proposal
// (PROPOSAL_ID_STRUCT) + the unanimous structural votes.
function proposeAndAgreeSplit(projection: ReturnType<typeof createEmptyProjection>): void {
  applyComponentCreate(projection, COMPONENT_NODE_ID_1, 'Reading one.');
  applyComponentCreate(projection, COMPONENT_NODE_ID_2, 'Reading two.');
  applyEvent(projection, {
    ...makeEvent(nextSequence(projection), 'proposal', DEBATER_A_ID, T3, {
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
  voteStructural(projection, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
  voteStructural(projection, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
  voteStructural(projection, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
}

describe('commit handler — interpretive-split edge inheritance (ADR 0046)', () => {
  it('mirrors only the qualifying parent edge onto each reading, cluster before the proposal-keyed commit', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to re-read.');
    seedStructuralParent(p, SPLIT_TARGET_NODE_ID, 'Target of the rebut.');
    // Qualifying: outgoing, visible, substance committed.
    applyEdgeCreate(p, EDGE_OUT_COMMITTED_ID, NODE_ID_STRUCT, { node: SPLIT_TARGET_NODE_ID });
    applyLandedEdgeSubstance(p, EDGE_OUT_COMMITTED_ID);
    // Non-qualifying: incoming (the parent is the TARGET), even though
    // its substance is committed.
    applyEdgeCreate(p, EDGE_IN_COMMITTED_ID, SPLIT_TARGET_NODE_ID, { node: NODE_ID_STRUCT });
    applyLandedEdgeSubstance(p, EDGE_IN_COMMITTED_ID);
    // Non-qualifying: outgoing but substance still proposed.
    applyEdgeCreate(p, EDGE_OUT_PROPOSED_ID, NODE_ID_STRUCT, { node: SPLIT_TARGET_NODE_ID });
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: { kind: 'set-edge-substance', edge_id: EDGE_OUT_PROPOSED_ID, value: 'agreed' },
      }),
    );
    // Non-qualifying: outgoing and committed but no longer visible.
    applyEdgeCreate(p, EDGE_OUT_REMOVED_ID, NODE_ID_STRUCT, { node: SPLIT_TARGET_NODE_ID });
    applyLandedEdgeSubstance(p, EDGE_OUT_REMOVED_ID);
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'entity-removed', MODERATOR_ID, T3, {
        entity_kind: 'edge',
        entity_id: EDGE_OUT_REMOVED_ID,
        removed_by: MODERATOR_ID,
        removed_at: T3,
      }),
    );
    proposeAndAgreeSplit(p);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // 2 readings × 1 qualifying edge × (edge-created + entity-included
    // + carried commit) + the proposal-keyed commit envelope.
    expect(r.events).toHaveLength(7);
    const kinds = r.events.map((ev) => ev.kind);
    expect(kinds).toEqual([
      'edge-created',
      'entity-included',
      'commit',
      'edge-created',
      'entity-included',
      'commit',
      'commit',
    ]);
    const readingIds = [COMPONENT_NODE_ID_1, COMPONENT_NODE_ID_2];
    const inheritedEdgeIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const created = r.events[i * 3]!;
      const included = r.events[i * 3 + 1]!;
      const carried = r.events[i * 3 + 2]!;
      expect(created.sequence).toBe(action.sequence + i * 3);
      if (created.kind === 'edge-created') {
        expect(created.payload.edge_id).toMatch(UUID_RE);
        expect(created.payload.edge_id).not.toBe(EDGE_OUT_COMMITTED_ID);
        expect(created.payload.role).toBe('rebuts');
        expect(created.payload.source_node_id).toBe(readingIds[i]);
        expect(created.payload.target_node_id).toBe(SPLIT_TARGET_NODE_ID);
        expect(created.payload.target_annotation_id).toBeUndefined();
        expect(created.payload.created_by).toBe(MODERATOR_ID);
        inheritedEdgeIds.push(created.payload.edge_id);
      }
      if (included.kind === 'entity-included') {
        expect(included.payload.entity_kind).toBe('edge');
        expect(included.payload.entity_id).toBe(inheritedEdgeIds[i]);
      }
      if (carried.kind === 'commit') {
        expect(carried.payload.target).toBe('facet');
        if (carried.payload.target === 'facet') {
          expect(carried.payload.entity_kind).toBe('edge');
          expect(carried.payload.entity_id).toBe(inheritedEdgeIds[i]);
          expect(carried.payload.facet).toBe('substance');
          expect(carried.payload.carried_from_edge_id).toBe(EDGE_OUT_COMMITTED_ID);
        }
      }
    }
    // The two mirrors carry distinct fresh ids.
    expect(inheritedEdgeIds[0]).not.toBe(inheritedEdgeIds[1]);
    const commitEnvelope = r.events[6]!;
    expect(commitEnvelope.kind).toBe('commit');
    expect(commitEnvelope.sequence).toBe(action.sequence + 6);
    if (commitEnvelope.kind === 'commit') {
      expect(commitEnvelope.payload.target).toBe('proposal');
    }
  });

  it('emits exactly the pre-task event shape when the parent has zero qualifying edges', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to re-read.');
    seedStructuralParent(p, SPLIT_TARGET_NODE_ID, 'Target of the rebut.');
    // Incoming committed + outgoing proposed — neither qualifies.
    applyEdgeCreate(p, EDGE_IN_COMMITTED_ID, SPLIT_TARGET_NODE_ID, { node: NODE_ID_STRUCT });
    applyLandedEdgeSubstance(p, EDGE_IN_COMMITTED_ID);
    applyEdgeCreate(p, EDGE_OUT_PROPOSED_ID, NODE_ID_STRUCT, { node: SPLIT_TARGET_NODE_ID });
    proposeAndAgreeSplit(p);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('commit');
    expect(r.events[0]!.sequence).toBe(action.sequence);
  });

  it('carries an annotation-target endpoint verbatim onto the mirrored edges', () => {
    const p = seedSession();
    seedStructuralParent(p, NODE_ID_STRUCT, 'Parent to re-read.');
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'annotation-created', DEBATER_A_ID, T2, {
        annotation_id: SPLIT_ANNOTATION_ID,
        kind: 'note',
        content: 'An annotation the parent rebuts.',
        target_node_id: NODE_ID_1,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T2,
      }),
    );
    applyEdgeCreate(p, EDGE_TO_ANNOTATION_ID, NODE_ID_STRUCT, {
      annotation: SPLIT_ANNOTATION_ID,
    });
    applyLandedEdgeSubstance(p, EDGE_TO_ANNOTATION_ID);
    proposeAndAgreeSplit(p);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(7);
    for (const i of [0, 3]) {
      const created = r.events[i]!;
      expect(created.kind).toBe('edge-created');
      if (created.kind === 'edge-created') {
        expect(created.payload.target_annotation_id).toBe(SPLIT_ANNOTATION_ID);
        expect(created.payload.target_node_id).toBeUndefined();
      }
    }
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

  // Refinement: tasks/refinements/moderator-ui/mod_annotation_context_menu.md
  // (Decision §1 wire widening — annotate-on-annotation commit lands the
  // parent annotation's id in `target_node_id` because that's the field
  // the projection's `addAnnotation` indexes for the renderer's nested-
  // annotation overlay chain established by
  // `mod_annotation_of_annotation_overlay_chain`).
  it('annotate-on-annotation commit emits annotation-created with the parent annotation id in target_node_id', () => {
    const p = seedSession();
    // Seed a first-order annotation on NODE_ID_1 so the projection has
    // a visible annotation A1 to target.
    const ANN_A1_ID = '9aaa9aaa-9aaa-4aaa-8aaa-9aaa9aaa10aa';
    applyEvent(
      p,
      makeEvent(nextSequence(p), 'annotation-created', DEBATER_A_ID, T3, {
        annotation_id: ANN_A1_ID,
        kind: 'note',
        content: 'A first-order annotation.',
        target_node_id: NODE_ID_1,
        target_edge_id: null,
        created_by: DEBATER_A_ID,
        created_at: T3,
      }),
    );
    // Now a second-order annotate proposal targeting A1.
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'annotate',
          target_kind: 'annotation',
          target_id: ANN_A1_ID,
          annotation_kind: 'reframe',
          content: 'A second-order reframe on the first annotation.',
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
      expect(r.events).toHaveLength(2);
      const annotationEvent = r.events[0]!;
      expect(annotationEvent.kind).toBe('annotation-created');
      if (annotationEvent.kind === 'annotation-created') {
        // The parent annotation's id rides in `target_node_id` — that's
        // the projection's shared keyspace for nested-annotation overlays.
        expect(annotationEvent.payload.target_node_id).toBe(ANN_A1_ID);
        expect(annotationEvent.payload.target_edge_id).toBeNull();
        expect(annotationEvent.payload.kind).toBe('reframe');
        expect(annotationEvent.payload.content).toBe(
          'A second-order reframe on the first annotation.',
        );
      }
    }
  });
});

// ---------------------------------------------------------------
// Structural sub-kind: meta-move.
//
// A committed meta-move materializes as a visible annotation on its
// target — mirroring `annotate` above. The handler emits an
// `annotation-created` event (kind = the proposal's `meta_kind`)
// ahead of the `commit` envelope, so the accept path returns
// `[annotation-created, commit]`. Per ADR 0036 the target is always a
// node or edge (never an annotation), so the `target_node_id` /
// `target_edge_id` XOR is set directly from `target_kind` / `target_id`.
//
// Refinement: tasks/refinements/data-and-methodology/meta_move_commit_logic.md
// ---------------------------------------------------------------

describe('commit handler — structural sub-kind: meta-move', () => {
  function seedMetaMove(
    targetKind: 'node' | 'edge',
    targetId: string,
    metaKind: 'reframe' | 'scope-change' | 'stance',
    content: string,
  ): ReturnType<typeof createEmptyProjection> {
    const p = seedSession();
    applyEvent(p, {
      ...makeEvent(nextSequence(p), 'proposal', DEBATER_A_ID, T3, {
        proposal: {
          kind: 'meta-move',
          meta_kind: metaKind,
          content,
          target_kind: targetKind,
          target_id: targetId,
        },
      }),
      id: PROPOSAL_ID_STRUCT,
    });
    return p;
  }

  it('accepts a fully-agreed meta-move (reframe) on a node and emits annotation-created + commit', () => {
    const p = seedMetaMove(
      'node',
      NODE_ID_1,
      'reframe',
      'The real question is the operational form, not the surface phrasing.',
    );
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
        // kind is the meta_kind verbatim; content echoed; node target XOR.
        expect(annotationEvent.payload.kind).toBe('reframe');
        expect(annotationEvent.payload.content).toBe(
          'The real question is the operational form, not the surface phrasing.',
        );
        expect(annotationEvent.payload.target_node_id).toBe(NODE_ID_1);
        expect(annotationEvent.payload.target_edge_id).toBeNull();
        expect(annotationEvent.payload.created_by).toBe(MODERATOR_ID);
        // annotation_id and envelope id are valid UUIDs — the payload
        // round-trips through the wire schema's UUID + XOR refine.
        expect(() => annotationCreatedPayloadSchema.parse(annotationEvent.payload)).not.toThrow();
        expect(annotationEvent.id).toMatch(UUID_RE);
      }
    }
  });

  it('accepts a fully-agreed meta-move (scope-change) on an edge with the target_edge_id branch set', () => {
    const p = seedMetaMove(
      'edge',
      EDGE_ID_1,
      'scope-change',
      'We should be defending the typical case, not the edge case.',
    );
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events).toHaveLength(2);
      const annotationEvent = r.events[0]!;
      expect(annotationEvent.kind).toBe('annotation-created');
      if (annotationEvent.kind === 'annotation-created') {
        expect(annotationEvent.payload.kind).toBe('scope-change');
        // edge target → target_edge_id set, target_node_id null.
        expect(annotationEvent.payload.target_edge_id).toBe(EDGE_ID_1);
        expect(annotationEvent.payload.target_node_id).toBeNull();
        expect(() => annotationCreatedPayloadSchema.parse(annotationEvent.payload)).not.toThrow();
        expect(annotationEvent.payload.annotation_id).toMatch(UUID_RE);
      }
    }
  });

  it('replays the emitted events so the annotation surfaces on the target and re-applying the commit does not double-create', () => {
    const p = seedMetaMove(
      'node',
      NODE_ID_1,
      'reframe',
      'A reframe that should surface as an annotation on the node.',
    );
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_B_ID, 'agree', PROPOSAL_ID_STRUCT);
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const annotationEvent = r.events[0]!;
    expect(annotationEvent.kind).toBe('annotation-created');
    if (annotationEvent.kind !== 'annotation-created') return;
    const annotationId = annotationEvent.payload.annotation_id;

    // Apply the emitted events in order: annotation-created lands the
    // annotation; the commit's `applyCommittedProposal` meta-move arm is
    // now a no-op (does NOT also create an annotation). This guards
    // against a double-create — `handleAnnotationCreated` would throw a
    // ReplayError on a duplicate id if the read-side arm still synthesized
    // one.
    expect(() => {
      for (const ev of r.events) {
        applyEvent(p, ev);
      }
    }).not.toThrow();

    const ann = p.getAnnotation(annotationId);
    expect(ann).toBeDefined();
    expect(ann!.kind).toBe('reframe');
    expect(ann!.targetNodeId).toBe(NODE_ID_1);
    expect(ann!.targetEdgeId).toBeNull();
    // The annotation is indexed against its target node.
    expect(p.getAnnotationsByNode(NODE_ID_1).map((a) => a.id)).toContain(annotationId);
  });

  it('rejects a meta-move commit that is not unanimously agreed (no annotation emitted)', () => {
    const p = seedMetaMove('node', NODE_ID_1, 'stance', 'A stance the room has not all agreed to.');
    voteStructural(p, MODERATOR_ID, 'agree', PROPOSAL_ID_STRUCT);
    voteStructural(p, DEBATER_A_ID, 'agree', PROPOSAL_ID_STRUCT);
    // DEBATER_B has not voted — structural unanimity fails.
    const action = makeCommitAction(p, MODERATOR_ID, PROPOSAL_ID_STRUCT);
    const r = validateAction(p, action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unanimous-agree-required');
      expect(r.detail).toContain(DEBATER_B_ID);
    }
  });
});
