// `useWsStore` — moderator-side server-state Zustand slice fed by the
// shell's WebSocket client.
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md +
//   tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"WsStore extraction shape" — option C: the moderator's
//   store stays in the moderator workspace because it imports the
//   moderator-side `diagnosticIdentityKey` helper; the shell's WS client
//   is parameterized over a `WsStoreLike<BaseWsStoreState>` handle and
//   the moderator passes this store to `<WsClientProvider>` /
//   `createWsClient`).
//
// The slice extends `BaseWsStoreState` (from `@a-conversa/shell`) and
// adds the moderator-specific `activeDiagnostics` projection on top.
// The shell client only ever touches the base methods; the
// `activeDiagnostics` map is read by `<GraphCanvasPane>` for the
// per-entity diagnostic halo.

import { create } from 'zustand';
import type {
  DiagnosticPayload,
  ErrorPayload,
  Event,
  ProposalStatusPayload,
} from '@a-conversa/shared-types';
import type { BaseWsSessionState, BaseWsStoreState } from '@a-conversa/shell';

import { diagnosticIdentityKey } from '../graph/diagnosticHighlights.js';
import { withDevtools } from '../stores/devtools.js';

/**
 * Re-export the shell's `WsConnectionStatus` under the moderator's
 * historical name so internal imports continue to resolve.
 */
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * Moderator-specific extension of `BaseWsSessionState`: adds the
 * `activeDiagnostics` map keyed by `diagnosticIdentityKey(payload)`.
 * An entry is added/replaced on each `'fired'` envelope and removed on
 * each `'cleared'` envelope. Read by `<GraphCanvasPane>` to drive the
 * per-entity diagnostic halo on nodes / edges.
 *
 * `lastDiagnostic` (inherited from the base) stays the "last envelope
 * seen" slot for backward compat with the existing `client.test.ts`
 * test; this map is the "active set" surface.
 */
export interface WsSessionState extends BaseWsSessionState {
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
}

/**
 * Moderator-side store state. Extends `BaseWsStoreState` (the contract
 * the shell client consumes) and re-narrows `sessionState` to the
 * richer `WsSessionState` shape that includes `activeDiagnostics`.
 */
export interface WsState extends BaseWsStoreState {
  sessionState: Record<string, WsSessionState>;
}

const initialState: Pick<
  WsState,
  'connectionStatus' | 'connectionId' | 'subscriptions' | 'sessionState' | 'lastError'
> = {
  connectionStatus: 'idle',
  connectionId: undefined,
  subscriptions: new Set<string>(),
  sessionState: {},
  lastError: undefined,
};

function ensureSession(state: WsState, sessionId: string): WsSessionState {
  const existing = state.sessionState[sessionId];
  if (existing) return existing;
  return {
    lastAppliedSequence: 0,
    events: [],
    pendingProposals: {},
    activeDiagnostics: new Map(),
  };
}

export const useWsStore = create<WsState>()(
  withDevtools('moderator/ws', (set) => ({
    ...initialState,

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

    applyEvent: (event: Event) => {
      let applied = false;
      set((state) => {
        const session = ensureSession(state, event.sessionId);
        if (event.sequence <= session.lastAppliedSequence) {
          // Dedup'd — replay-vs-live overlap is the expected path here.
          return state;
        }
        const nextSession: WsSessionState = {
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
        const nextSession: WsSessionState = {
          ...session,
          lastAppliedSequence: sequence,
        };
        return {
          sessionState: { ...state.sessionState, [sessionId]: nextSession },
        };
      }),

    applyProposalStatus: (payload: ProposalStatusPayload) =>
      set((state) => {
        const session = ensureSession(state, payload.sessionId);
        const nextSession: WsSessionState = {
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

    applyDiagnostic: (payload: DiagnosticPayload) =>
      set((state) => {
        const session = ensureSession(state, payload.sessionId);
        // Compute the canonical identity key for the active-set delta.
        // `fired` adds/replaces the entry under the key; `cleared`
        // removes the entry. `lastDiagnostic` always updates to the
        // latest envelope (cleared envelopes included — the slot's
        // contract is "last envelope seen", not "last fired diagnostic";
        // the pre-existing `client.test.ts` reader continues to work).
        const key = diagnosticIdentityKey(payload);
        const nextActive = new Map(session.activeDiagnostics);
        if (payload.status === 'fired') {
          nextActive.set(key, payload);
        } else {
          // `cleared` — remove the entry if present. An unknown key is
          // a no-op (the diff machinery on the server may emit a
          // `cleared` for a diagnostic this client never saw `fired`
          // for, e.g. on first connect; we tolerate the no-op
          // silently).
          nextActive.delete(key);
        }
        const nextSession: WsSessionState = {
          ...session,
          lastDiagnostic: payload,
          activeDiagnostics: nextActive,
        };
        return {
          sessionState: { ...state.sessionState, [payload.sessionId]: nextSession },
        };
      }),

    recordError: (payload: ErrorPayload | undefined) => set({ lastError: payload }),

    reset: () => set({ ...initialState, subscriptions: new Set<string>() }),
  })),
);
