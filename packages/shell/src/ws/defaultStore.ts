// Default minimal WS store — a Zustand-backed implementation of
// `BaseWsStoreState`.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"Shell's default minimal WS store ships alongside the client")
// Refinement: tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (Decision §3 — ship `createDefaultWsStoreInitializer()` alongside
//   `createDefaultWsStore()` so the moderator + participant can wrap
//   the bare state-creator with their per-app devtools middleware while
//   the audience continues to use the wrapped one-line factory.
//   Decision §4 — `activeDiagnostics` becomes canonical on
//   `BaseWsSessionState`; the reducer dispatches on `payload.status`.)

import { create, type UseBoundStore, type StoreApi, type StateCreator } from 'zustand';

import { diagnosticIdentityKey } from '../diagnostics/diagnostic-highlights.js';
import type { BaseWsSessionState, BaseWsStoreState } from './store-contract.js';

function makeInitialSessionState(): BaseWsSessionState {
  return {
    lastAppliedSequence: 0,
    events: [],
    pendingProposals: {},
    activeDiagnostics: new Map(),
  };
}

function ensureSession(state: BaseWsStoreState, sessionId: string): BaseWsSessionState {
  const existing = state.sessionState[sessionId];
  if (existing) return existing;
  return makeInitialSessionState();
}

/**
 * The bare Zustand `StateCreator<BaseWsStoreState>` for the shell's
 * default WS store. Callers that want to layer their own middleware
 * (e.g. `withDevtools`) wrap this initializer before passing it to
 * `create<BaseWsStoreState>()(...)`. Callers that just want a wrapped
 * store use `createDefaultWsStore()` below.
 */
export function createDefaultWsStoreInitializer(): StateCreator<BaseWsStoreState> {
  return (set) => ({
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
        // `fired` adds/replaces under the canonical identity key;
        // `cleared` removes (no-op if absent — the server may emit a
        // `cleared` for a diagnostic this client never saw `fired`
        // for). `lastDiagnostic` updates unconditionally — its contract
        // is "last envelope seen", not "last fired".
        const key = diagnosticIdentityKey(payload);
        const nextActive = new Map(session.activeDiagnostics);
        if (payload.status === 'fired') {
          nextActive.set(key, payload);
        } else {
          nextActive.delete(key);
        }
        const nextSession: BaseWsSessionState = {
          ...session,
          lastDiagnostic: payload,
          activeDiagnostics: nextActive,
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
  });
}

/**
 * Build a fresh Zustand store conforming to `BaseWsStoreState`. The
 * returned hook is a stateful singleton — repeated `createDefaultWsStore`
 * calls return distinct stores (useful for tests that want isolation).
 *
 * Equivalent to `create<BaseWsStoreState>()(createDefaultWsStoreInitializer())`.
 */
export function createDefaultWsStore(): UseBoundStore<StoreApi<BaseWsStoreState>> {
  return create<BaseWsStoreState>()(createDefaultWsStoreInitializer());
}
