// `audienceWsStore` — audience-side WS-fed Zustand singleton.
//
// Refinement: tasks/refinements/audience/aud_ws_client.md
//   (Decision §2, §B — the audience was originally a thin re-export of
//   the shell's `createDefaultWsStore()` because no audience-specific
//   projection requirement existed. That refinement explicitly named
//   the audience as the eventual third caller that would trigger the
//   `activeDiagnostics` slot's lift into the shell — see the
//   `audience.aud_animations.aud_diagnostic_fire_animation` entry
//   below.)
// Refinement: tasks/refinements/audience/aud_diagnostic_fire_animation.md
//   (Decision §3 — extend `BaseWsStoreState` locally with the
//   `activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>` slot,
//   mirroring `apps/participant/src/ws/wsStore.ts` byte-identical. The
//   shell lift is registered as the named-future-task
//   `shell_diagnostic_highlights_extract`; this file is the third-
//   caller port that triggers the future extraction, not the extraction
//   itself.)
//
// The slice extends `BaseWsStoreState` (from `@a-conversa/shell`) and
// adds the audience-side `activeDiagnostics` projection on top. The
// shell client only ever touches the base methods; the
// `activeDiagnostics` map is read by `<AudienceDiagnosticFireOverlay>`
// for the per-(diagnostic, node) one-shot halo animation.

import { create } from 'zustand';
import type {
  DiagnosticPayload,
  ErrorPayload,
  Event,
  ProposalStatusPayload,
} from '@a-conversa/shared-types';
import type { BaseWsSessionState, BaseWsStoreState } from '@a-conversa/shell';

import { diagnosticIdentityKey } from '../graph/diagnosticHighlights.js';

/**
 * Re-export the shell's `WsConnectionStatus` under the audience's
 * historical name so internal imports continue to resolve.
 */
export type { WsConnectionStatus } from '@a-conversa/shell';

/**
 * Audience-specific extension of `BaseWsSessionState`: adds the
 * `activeDiagnostics` map keyed by `diagnosticIdentityKey(payload)`. An
 * entry is added/replaced on each `'fired'` envelope and removed on each
 * `'cleared'` envelope. Read by `<AudienceDiagnosticFireOverlay>` to
 * drive the per-(diagnostic, node) fire animation.
 *
 * `lastDiagnostic` (inherited from the base) stays the "last envelope
 * seen" slot for backward compat with the existing default store
 * behaviour; this map is the "active set" surface.
 */
export interface WsSessionState extends BaseWsSessionState {
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
}

/**
 * Audience-side store state. Extends `BaseWsStoreState` (the contract
 * the shell client consumes) and re-narrows `sessionState` to the
 * richer `WsSessionState` shape that includes `activeDiagnostics`.
 */
export interface WsStoreState extends BaseWsStoreState {
  sessionState: Record<string, WsSessionState>;
}

const initialState: Pick<
  WsStoreState,
  'connectionStatus' | 'connectionId' | 'subscriptions' | 'sessionState' | 'lastError'
> = {
  connectionStatus: 'idle',
  connectionId: undefined,
  subscriptions: new Set<string>(),
  sessionState: {},
  lastError: undefined,
};

function ensureSession(state: WsStoreState, sessionId: string): WsSessionState {
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
 * The audience's singleton WS store. Mirrors the participant's
 * `useWsStore` shape so the shell client plugs into it via
 * `createWsClient({ store: audienceWsStore, ... })`.
 */
export const audienceWsStore = create<WsStoreState>()((set) => ({
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
      // contract is "last envelope seen", not "last fired diagnostic").
      const key = diagnosticIdentityKey(payload);
      const nextActive = new Map(session.activeDiagnostics);
      if (payload.status === 'fired') {
        nextActive.set(key, payload);
      } else {
        // `cleared` — remove the entry if present. An unknown key is
        // a no-op (the server may emit a `cleared` for a diagnostic
        // this client never saw `fired` for, e.g. on first connect).
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
}));
