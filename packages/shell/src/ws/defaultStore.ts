// Default minimal WS store — a Zustand-backed implementation of
// `BaseWsStoreState`.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"Shell's default minimal WS store ships alongside the client")
//
// The future participant / audience / replay-test / root surfaces and
// the shell's own test suite want a baseline store without re-deriving
// the moderator's store-shape conventions from scratch. This factory
// returns a fresh Zustand store satisfying the `BaseWsStoreState`
// contract — no projection-specific extensions (no `activeDiagnostics`
// map, no `diagnosticIdentityKey` import). Consumers that want richer
// projections build their own store (see `apps/moderator/src/ws/wsStore.ts`)
// and pass it to `<WsClientProvider store={...}>`.

import { create, type UseBoundStore, type StoreApi } from 'zustand';

import type { BaseWsSessionState, BaseWsStoreState } from './store-contract.js';

function makeInitialSessionState(): BaseWsSessionState {
  return {
    lastAppliedSequence: 0,
    events: [],
    pendingProposals: {},
  };
}

function ensureSession(state: BaseWsStoreState, sessionId: string): BaseWsSessionState {
  const existing = state.sessionState[sessionId];
  if (existing) return existing;
  return makeInitialSessionState();
}

/**
 * Build a fresh Zustand store conforming to `BaseWsStoreState`. The
 * returned hook is a stateful singleton — repeated `createDefaultWsStore`
 * calls return distinct stores (useful for tests that want isolation).
 */
export function createDefaultWsStore(): UseBoundStore<StoreApi<BaseWsStoreState>> {
  return create<BaseWsStoreState>()((set) => ({
    connectionStatus: 'idle',
    connectionId: undefined,
    subscriptions: new Set<string>(),
    sessionState: {},
    lastError: undefined,

    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
    setConnectionId: (connectionId) => set({ connectionId }),

    trackSubscription: (sessionId) => {
      let added = false;
      set((state) => {
        if (state.subscriptions.has(sessionId)) return state;
        const next = new Set(state.subscriptions);
        next.add(sessionId);
        added = true;
        return { subscriptions: next };
      });
      return added;
    },

    untrackSubscription: (sessionId) =>
      set((state) => {
        if (!state.subscriptions.has(sessionId)) return state;
        const next = new Set(state.subscriptions);
        next.delete(sessionId);
        return { subscriptions: next };
      }),

    applyEvent: (event) => {
      let applied = false;
      set((state) => {
        const session = ensureSession(state, event.sessionId);
        if (event.sequence <= session.lastAppliedSequence) {
          // Dedup'd — replay-vs-live overlap is the expected path here.
          return state;
        }
        const nextSession: BaseWsSessionState = {
          ...session,
          lastAppliedSequence: event.sequence,
          events: [...session.events, event],
        };
        applied = true;
        return {
          sessionState: { ...state.sessionState, [event.sessionId]: nextSession },
        };
      });
      return applied;
    },

    applySnapshot: (sessionId, sequence) =>
      set((state) => {
        const session = ensureSession(state, sessionId);
        if (sequence < session.lastAppliedSequence) return state;
        const nextSession: BaseWsSessionState = {
          ...session,
          lastAppliedSequence: sequence,
        };
        return {
          sessionState: { ...state.sessionState, [sessionId]: nextSession },
        };
      }),

    applyProposalStatus: (payload) =>
      set((state) => {
        const session = ensureSession(state, payload.sessionId);
        const nextSession: BaseWsSessionState = {
          ...session,
          pendingProposals: {
            ...session.pendingProposals,
            [payload.proposalId]: payload,
          },
        };
        return {
          sessionState: { ...state.sessionState, [payload.sessionId]: nextSession },
        };
      }),

    applyDiagnostic: (payload) =>
      set((state) => {
        const session = ensureSession(state, payload.sessionId);
        const nextSession: BaseWsSessionState = {
          ...session,
          lastDiagnostic: payload,
        };
        return {
          sessionState: { ...state.sessionState, [payload.sessionId]: nextSession },
        };
      }),

    recordError: (payload) => set({ lastError: payload }),

    reset: () =>
      set({
        connectionStatus: 'idle',
        connectionId: undefined,
        subscriptions: new Set<string>(),
        sessionState: {},
        lastError: undefined,
      }),
  }));
}
