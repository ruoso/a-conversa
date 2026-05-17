// `useWsStore` — participant-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/participant-ui/part_state_management.md
//   (Decision §1 — Zustand store mirroring the moderator's
//   `mod_state_management`. Decision §2 originally delegated to the
//   shell's `createDefaultWsStore()` factory because no participant-
//   specific projection requirement existed; this leaf reverses that
//   decision because diagnostic-highlight rendering needs the
//   per-session `activeDiagnostics` map the base factory does not
//   maintain — see the next refinement entry.)
// Refinement: tasks/refinements/participant-ui/part_diagnostic_highlights.md
//   (Decision §2 path (b) — extend `BaseWsStoreState` locally with
//   `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` per
//   session, mirroring `apps/moderator/src/ws/wsStore.ts`. The shell-
//   package-extraction decision explicitly kept the slot OUT of the
//   shell — the third caller, the audience surface, is the eventual
//   extract trigger.)
//
// The slice extends `BaseWsStoreState` (from `@a-conversa/shell`) and
// adds the participant-specific `activeDiagnostics` projection on top.
// The shell client only ever touches the base methods; the
// `activeDiagnostics` map is read by `<GraphView>` for the per-entity
// diagnostic highlight.

import { create } from 'zustand';
import type {
  DiagnosticPayload,
  ErrorPayload,
  Event,
  ProposalStatusPayload,
} from '@a-conversa/shared-types';
import type { BaseWsSessionState, BaseWsStoreState } from '@a-conversa/shell';

import { diagnosticIdentityKey } from '../graph/diagnosticHighlights';
import { withDevtools } from '../stores/devtools';

/**
 * Re-export the shell's `WsConnectionStatus` under the participant's
 * historical name so internal imports continue to resolve.
 */
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * Participant-specific extension of `BaseWsSessionState`: adds the
 * `activeDiagnostics` map keyed by `diagnosticIdentityKey(payload)`.
 * An entry is added/replaced on each `'fired'` envelope and removed on
 * each `'cleared'` envelope. Read by `<GraphView>` to drive the
 * per-entity diagnostic highlight on nodes / edges.
 *
 * `lastDiagnostic` (inherited from the base) stays the "last envelope
 * seen" slot for backward compat with the existing default store
 * behaviour; this map is the "active set" surface.
 */
export interface WsSessionState extends BaseWsSessionState {
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
}

/**
 * Participant-side store state. Extends `BaseWsStoreState` (the contract
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

/**
 * The participant's singleton WS store. Mirrors the moderator's
 * `useWsStore` shape so the future `part_ws_client` plugs into it via
 * `createWsClient({ store: useWsStore, ... })`.
 */
export const useWsStore = create<WsState>()(
  withDevtools('participant/ws', (set) => ({
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
        // existing readers continue to work).
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
