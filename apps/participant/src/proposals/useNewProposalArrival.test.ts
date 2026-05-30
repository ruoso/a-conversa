// Vitest cases for `useNewProposalArrival`.
//
// Refinement: tasks/refinements/participant-ui/part_proposal_notification.md
//   (Test layer §1 — eight observable transitions: empty session,
//    empty events, single arrival, second arrival mid-window, window
//    expiry, non-proposal events ignored, no-op re-render, dedup
//    against repeat ids.)
//
// Uses `vi.useFakeTimers()` so the `setTimeout` driving the
// soonest-expiry clean-up is deterministic. Vitest's modern fake-timer
// implementation also fakes `performance.now()` so the hook's clock
// reads stay in lockstep with the timer queue.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@a-conversa/shared-types';

import { FLASH_WINDOW_MS, useNewProposalArrival } from './useNewProposalArrival';
import { useWsStore } from '../ws/wsStore';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const ACTOR = '00000000-0000-4000-8000-0000000000ac';
const NODE_A = '00000000-0000-4000-8000-00000000000a';
const NODE_B = '00000000-0000-4000-8000-00000000000b';
const EDGE_A = '00000000-0000-4000-8000-00000000000e';
const PROPOSAL_1 = '00000000-0000-4000-8000-0000000000a1';
const PROPOSAL_2 = '00000000-0000-4000-8000-0000000000a2';
const PROPOSAL_3 = '00000000-0000-4000-8000-0000000000a3';

function captureNodeProposalEvent(opts: {
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
        kind: 'capture-node',
        node_id: opts.nodeId,
        wording: 'wording',
      },
    },
    createdAt: '2026-05-26T00:00:00.000Z',
  };
}

function setEdgeSubstanceProposalEvent(opts: {
  sequence: number;
  envelopeId: string;
  edgeId: string;
}): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'proposal',
    actor: ACTOR,
    payload: {
      proposal: {
        kind: 'set-edge-substance',
        edge_id: opts.edgeId,
        value: 'agreed',
      },
    },
    createdAt: '2026-05-26T00:00:00.000Z',
  };
}

function voteEvent(opts: { sequence: number; envelopeId: string }): Event {
  return {
    id: opts.envelopeId,
    sessionId: SESSION_ID,
    sequence: opts.sequence,
    kind: 'vote',
    actor: ACTOR,
    payload: {
      target: 'facet',
      entity_kind: 'node',
      entity_id: NODE_A,
      facet: 'wording',
      participant: ACTOR,
      choice: 'agree',
      voted_at: '2026-05-26T00:00:00.000Z',
    },
    createdAt: '2026-05-26T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useWsStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useWsStore.getState().reset();
});

describe('useNewProposalArrival', () => {
  it('(a) returns empty state when the per-session slice is absent', () => {
    const { result } = renderHook(() => useNewProposalArrival(OTHER_SESSION_ID));
    expect(result.current.isBadgeFlashing).toBe(false);
    expect(result.current.activeFlashes.size).toBe(0);
  });

  it('(b) returns empty state for an empty events array', () => {
    act(() => {
      useWsStore.setState((state) => ({
        sessionState: {
          ...state.sessionState,
          [SESSION_ID]: {
            lastAppliedSequence: 0,
            events: [],
            pendingProposalFacetStatus: new Map(),
            activeDiagnostics: new Map(),
          },
        },
      }));
    });
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    expect(result.current.isBadgeFlashing).toBe(false);
    expect(result.current.activeFlashes.size).toBe(0);
  });

  it('(c) flips both badge and per-entity flash on a single proposal arrival', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
    });
    expect(result.current.isBadgeFlashing).toBe(true);
    expect(result.current.activeFlashes.size).toBe(1);
    const entry = result.current.activeFlashes.get(NODE_A);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('node');
    expect(entry?.elementId).toBe(NODE_A);
  });

  it('(d) tracks a second arrival in addition to the first when its window overlaps', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
    });
    // Advance time partway through the first window.
    act(() => {
      vi.advanceTimersByTime(FLASH_WINDOW_MS / 2);
    });
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          setEdgeSubstanceProposalEvent({ sequence: 2, envelopeId: PROPOSAL_2, edgeId: EDGE_A }),
        );
    });
    expect(result.current.isBadgeFlashing).toBe(true);
    expect(result.current.activeFlashes.size).toBe(2);
    expect(result.current.activeFlashes.get(NODE_A)?.kind).toBe('node');
    expect(result.current.activeFlashes.get(EDGE_A)?.kind).toBe('edge');
  });

  it('(e) clears badge + flashes after the flash window expires', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
    });
    expect(result.current.isBadgeFlashing).toBe(true);
    expect(result.current.activeFlashes.size).toBe(1);
    act(() => {
      // Pass the full window plus a small margin so the soonest-expiry
      // timer's `<=` comparison drops the entry.
      vi.advanceTimersByTime(FLASH_WINDOW_MS + 50);
    });
    expect(result.current.isBadgeFlashing).toBe(false);
    expect(result.current.activeFlashes.size).toBe(0);
  });

  it('(f) ignores non-proposal events (vote / commit / …)', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore.getState().applyEvent(voteEvent({ sequence: 1, envelopeId: PROPOSAL_1 }));
    });
    expect(result.current.isBadgeFlashing).toBe(false);
    expect(result.current.activeFlashes.size).toBe(0);
  });

  it('(g) returns the same `activeFlashes` reference across renders with no new events', () => {
    const { result, rerender } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
    });
    const before = result.current.activeFlashes;
    rerender();
    expect(result.current.activeFlashes).toBe(before);
  });

  it('(h) dedups a repeat of the same envelope id (does not re-flash)', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
    });
    act(() => {
      // Pass the full window so the first flash drops.
      vi.advanceTimersByTime(FLASH_WINDOW_MS + 50);
    });
    expect(result.current.activeFlashes.size).toBe(0);
    // Inject the same envelope id again — the store dedups on
    // `event.sequence <= lastAppliedSequence` so we directly overwrite
    // the events array to simulate the "replay-vs-live overlap" arm
    // the refinement names. The hook's `seenProposalEventIds` ref MUST
    // suppress the duplicate even when the events array contains it.
    act(() => {
      useWsStore.setState((state) => {
        const slice = state.sessionState[SESSION_ID];
        if (slice === undefined) return state;
        const dup = captureNodeProposalEvent({
          sequence: 99,
          envelopeId: PROPOSAL_1,
          nodeId: NODE_A,
        });
        return {
          sessionState: {
            ...state.sessionState,
            [SESSION_ID]: { ...slice, events: [...slice.events, dup] },
          },
        };
      });
    });
    expect(result.current.isBadgeFlashing).toBe(false);
    expect(result.current.activeFlashes.size).toBe(0);
  });

  it('(i) a third arrival into a different entity adds without dropping the prior two', () => {
    const { result } = renderHook(() => useNewProposalArrival(SESSION_ID));
    act(() => {
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 1, envelopeId: PROPOSAL_1, nodeId: NODE_A }),
        );
      useWsStore
        .getState()
        .applyEvent(
          captureNodeProposalEvent({ sequence: 2, envelopeId: PROPOSAL_2, nodeId: NODE_B }),
        );
      useWsStore
        .getState()
        .applyEvent(
          setEdgeSubstanceProposalEvent({ sequence: 3, envelopeId: PROPOSAL_3, edgeId: EDGE_A }),
        );
    });
    expect(result.current.activeFlashes.size).toBe(3);
    expect(result.current.activeFlashes.get(NODE_A)?.kind).toBe('node');
    expect(result.current.activeFlashes.get(NODE_B)?.kind).toBe('node');
    expect(result.current.activeFlashes.get(EDGE_A)?.kind).toBe('edge');
  });
});
