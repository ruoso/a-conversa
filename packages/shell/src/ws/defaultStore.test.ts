// Vitest cover for the shell's default WS store reducers.
//
// Refinement: tasks/refinements/moderator-ui/migrate_off_compute_facet_statuses_onto_proposal_status_broadcast.md
//
// The new `pendingProposalFacetStatus` cell-map slot (per refinement D2)
// + the `clearProposalFacetStatusForEntity` writer (per D3) + the
// `applyEvent` entity-removed clear hook (per D3 again) are the surface
// this file pins. The legacy `pendingProposals` proposalId-keyed slot
// is preserved for backward compatibility with the participant pane;
// its existing cover lives at `apps/participant/src/ws/wsStore.test.ts`
// and is not duplicated here.

import { describe, expect, it } from 'vitest';

import type { Event, ProposalStatusPayload } from '@a-conversa/shared-types';

import { createDefaultWsStore } from './defaultStore.js';

const SESSION_ID = '00000000-0000-0000-0000-000000000001';
const PROPOSAL_ID = '00000000-0000-0000-0000-0000000000a1';
const PROPOSAL_ID_B = '00000000-0000-0000-0000-0000000000b2';
const NODE_N1 = '00000000-0000-0000-0000-0000000000d1';
const NODE_N2 = '00000000-0000-0000-0000-0000000000d2';

function makePayload(overrides: Partial<ProposalStatusPayload>): ProposalStatusPayload {
  return {
    sessionId: SESSION_ID,
    proposalId: PROPOSAL_ID,
    sequence: 1,
    perFacetStatus: { classification: 'proposed' },
    entityKind: 'node',
    entityId: NODE_N1,
    ...overrides,
  };
}

function makeEntityRemoved(
  sequence: number,
  entityKind: 'node' | 'edge' | 'annotation',
  entityId: string,
): Event {
  return {
    id: `00000000-0000-0000-0000-00000000ff${String(sequence).padStart(2, '0')}`,
    sessionId: SESSION_ID,
    sequence,
    kind: 'entity-removed',
    actor: null,
    payload: { entity_kind: entityKind, entity_id: entityId },
    createdAt: '2026-05-29T00:00:00.000Z',
  } as unknown as Event;
}

describe('defaultStore — applyProposalStatus per-entity cell write', () => {
  it('writes the cell `${entityKind}:${entityId}:${facetName} → status` from a fresh envelope', () => {
    const store = createDefaultWsStore();
    store.getState().applyProposalStatus(
      makePayload({
        entityKind: 'node',
        entityId: NODE_N1,
        perFacetStatus: { classification: 'proposed' },
      }),
    );
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N1}:classification`)).toBe(
      'proposed',
    );
  });

  it('accumulates two cells when consecutive envelopes share proposalId+sequence but differ by entityId (multi-component decompose case)', () => {
    const store = createDefaultWsStore();
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { classification: 'proposed' } }),
      );
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N2, perFacetStatus: { classification: 'proposed' } }),
      );
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus!.size).toBe(2);
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N1}:classification`)).toBe(
      'proposed',
    );
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N2}:classification`)).toBe(
      'proposed',
    );
  });

  it('overwrites the cell on a subsequent envelope with the same entity (proposed → committed transition)', () => {
    const store = createDefaultWsStore();
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { classification: 'proposed' } }),
      );
    store.getState().applyProposalStatus(
      makePayload({
        entityId: NODE_N1,
        proposalId: PROPOSAL_ID_B,
        sequence: 2,
        perFacetStatus: { classification: 'committed' },
      }),
    );
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N1}:classification`)).toBe(
      'committed',
    );
  });

  it('skips the per-entity cell write when the envelope lacks entityKind/entityId (backward-compat path)', () => {
    const store = createDefaultWsStore();
    // Build a payload WITHOUT entity fields by spreading the base
    // helper and pruning. Direct `entityKind: undefined` would trip
    // `exactOptionalPropertyTypes`.
    const baseline = makePayload({ perFacetStatus: { classification: 'proposed' } });
    const payload: ProposalStatusPayload = {
      sessionId: baseline.sessionId,
      proposalId: baseline.proposalId,
      sequence: baseline.sequence,
      perFacetStatus: baseline.perFacetStatus,
    };
    store.getState().applyProposalStatus(payload);
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus?.size ?? 0).toBe(0);
    expect(session?.pendingProposals[PROPOSAL_ID]).toBeDefined();
  });
});

describe('defaultStore — clearProposalFacetStatusForEntity', () => {
  it('drops every cell matching `${entityKind}:${entityId}:` prefix and leaves siblings intact', () => {
    const store = createDefaultWsStore();
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { classification: 'proposed' } }),
      );
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { wording: 'proposed' } }),
      );
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N2, perFacetStatus: { classification: 'proposed' } }),
      );
    store.getState().clearProposalFacetStatusForEntity(SESSION_ID, 'node', NODE_N1);
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus!.size).toBe(1);
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N2}:classification`)).toBe(
      'proposed',
    );
  });

  it('is a no-op when no matching cells are present', () => {
    const store = createDefaultWsStore();
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { classification: 'proposed' } }),
      );
    const before = store.getState().sessionState[SESSION_ID]?.pendingProposalFacetStatus;
    store.getState().clearProposalFacetStatusForEntity(SESSION_ID, 'node', NODE_N2);
    const after = store.getState().sessionState[SESSION_ID]?.pendingProposalFacetStatus;
    expect(after).toBe(before);
  });
});

describe('defaultStore — applyEvent entity-removed clears matching cells', () => {
  it('drops every `${entityKind}:${entityId}:*` cell when `entity-removed` lands for that entity', () => {
    const store = createDefaultWsStore();
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { classification: 'proposed' } }),
      );
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N1, perFacetStatus: { wording: 'proposed' } }),
      );
    store
      .getState()
      .applyProposalStatus(
        makePayload({ entityId: NODE_N2, perFacetStatus: { classification: 'proposed' } }),
      );
    store.getState().applyEvent(makeEntityRemoved(10, 'node', NODE_N1));
    const session = store.getState().sessionState[SESSION_ID];
    expect(session?.pendingProposalFacetStatus!.size).toBe(1);
    expect(session?.pendingProposalFacetStatus!.get(`node:${NODE_N2}:classification`)).toBe(
      'proposed',
    );
  });
});
