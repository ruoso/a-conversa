// `useWsStore` — server-state Zustand slice fed by the moderator's
// WebSocket client (see `./client.ts`).
//
// Refinement: tasks/refinements/moderator-ui/mod_ws_client.md
//
// The slice holds:
//   - The connection-level status (idle / connecting / open / reconnecting /
//     closed) and the latest `connectionId` minted server-side.
//   - The set of `sessionId`s the consumer asked to follow. This set is the
//     resume-list used by the reconnection logic in `client.ts`.
//   - Per-session server-state derived from inbound envelopes:
//     `lastAppliedSequence`, the live event log, per-proposal status, and
//     the latest diagnostic snapshot.
//   - The latest UNSOLICITED `error` envelope (correlated errors reject
//     the send-promise; only un-correlated server-side errors land here).
//
// The slice is intentionally append-only on writes — the client reducer is
// the only writer; UI components are pure readers. Dedupe of replay-vs-live
// `event-applied` frames is enforced here so the contract holds across
// both the live broadcast path and the catch-up replay path (see
// `docs/ws-protocol.md`, "Reconnection / catch-up flow").

import { create } from 'zustand';
import type {
  DiagnosticPayload,
  ErrorPayload,
  Event,
  ProposalStatusPayload,
} from '@a-conversa/shared-types';

import { diagnosticIdentityKey } from '../graph/diagnosticHighlights.js';
import { withDevtools } from '../stores/devtools.js';

/**
 * Connection-level status for the WS surface. UI affordances (a reconnect
 * banner, a "live" badge) switch on this.
 */
export type WsConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * The per-session server-state the client maintains. `events` is the full
 * dedup'd event log received over the wire (live + replay merged). Other
 * UI surfaces project off it (the change-history pane reads `events`
 * verbatim; the pending-proposals pane reads `pendingProposals`).
 */
export interface WsSessionState {
  /** High-water mark of `event.sequence` seen for this session. */
  lastAppliedSequence: number;
  /** Dedup'd event log, in arrival order. */
  events: Event[];
  /** Per-proposal status frames keyed by `proposalId`. */
  pendingProposals: Record<string, ProposalStatusPayload>;
  /** Latest diagnostic snapshot envelope, if any. */
  lastDiagnostic?: DiagnosticPayload;
  /**
   * Active diagnostics for this session, keyed by the canonical
   * identity key (`diagnosticIdentityKey(payload)`). An entry is
   * added/replaced on each `'fired'` envelope and removed on each
   * `'cleared'` envelope. Refinement:
   * `tasks/refinements/moderator-ui/mod_diagnostic_highlighting.md`.
   *
   * Read by `<GraphCanvasPane>` to drive the per-entity diagnostic
   * halo on nodes / edges. `lastDiagnostic` (above) stays the
   * "last envelope seen" slot for backward compat with the existing
   * `client.test.ts` test; this map is the new "active set" surface.
   */
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
}

export interface WsState {
  /** Connection-level status. */
  connectionStatus: WsConnectionStatus;
  /** `connectionId` from the latest `hello`. */
  connectionId: string | undefined;
  /** Session ids the consumer asked to follow (used as resume list). */
  subscriptions: ReadonlySet<string>;
  /** Per-session server-state. */
  sessionState: Record<string, WsSessionState>;
  /** Latest UNSOLICITED error envelope (no `inResponseTo`). */
  lastError: ErrorPayload | undefined;

  // ── client-side writers (called by `client.ts` only) ─────────────────

  setConnectionStatus: (status: WsConnectionStatus) => void;
  setConnectionId: (id: string | undefined) => void;
  /** Track a session in the resume list. Returns `true` if newly added. */
  trackSubscription: (sessionId: string) => boolean;
  /** Drop a session from the resume list. */
  untrackSubscription: (sessionId: string) => void;
  /**
   * Apply an `event-applied` payload's event. Idempotent — duplicates
   * (replay-vs-live overlap) are dropped silently. Returns `true` when
   * the event was actually applied, `false` when it was deduped.
   */
  applyEvent: (event: Event) => boolean;
  /** Replace per-session state from a `snapshot-state` payload. */
  applySnapshot: (sessionId: string, sequence: number) => void;
  /** Record a `proposal-status` envelope. */
  applyProposalStatus: (payload: ProposalStatusPayload) => void;
  /** Record a `diagnostic` envelope. */
  applyDiagnostic: (payload: DiagnosticPayload) => void;
  /** Record an unsolicited `error` envelope. */
  recordError: (payload: ErrorPayload | undefined) => void;
  /** Hard reset — used on logout / unmount. */
  reset: () => void;
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

    applyEvent: (event) => {
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

    applyProposalStatus: (payload) =>
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

    applyDiagnostic: (payload) =>
      set((state) => {
        const session = ensureSession(state, payload.sessionId);
        // Compute the canonical identity key for the active-set delta.
        // `fired` adds/replaces the entry under the key; `cleared` removes
        // the entry. `lastDiagnostic` always updates to the latest
        // envelope (cleared envelopes included — the slot's contract is
        // "last envelope seen", not "last fired diagnostic"; the
        // pre-existing `client.test.ts` reader continues to work).
        const key = diagnosticIdentityKey(payload);
        const nextActive = new Map(session.activeDiagnostics);
        if (payload.status === 'fired') {
          nextActive.set(key, payload);
        } else {
          // `cleared` — remove the entry if present. An unknown key is a
          // no-op (the diff machinery on the server may emit a `cleared`
          // for a diagnostic this client never saw `fired` for, e.g. on
          // first connect; we tolerate the no-op silently).
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

    recordError: (payload) => set({ lastError: payload }),

    reset: () => set({ ...initialState, subscriptions: new Set<string>() }),
  })),
);
