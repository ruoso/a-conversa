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
import type { FacetStatus } from '../facet-status/facet-status.js';
import type { BaseWsSessionState, BaseWsStoreState } from './store-contract.js';

const FACET_STATUS_VALUES: ReadonlySet<string> = new Set<FacetStatus>([
  'proposed',
  'agreed',
  'disputed',
  'committed',
  'withdrawn',
  'meta-disagreement',
  'awaiting-proposal',
]);

function isFacetStatus(value: string): value is FacetStatus {
  return FACET_STATUS_VALUES.has(value);
}

function makeInitialSessionState(): BaseWsSessionState {
  return {
    lastAppliedSequence: 0,
    events: [],
    pendingProposals: {},
    pendingProposalFacetStatus: new Map(),
    activeDiagnostics: new Map(),
  };
}

/**
 * Compose the composite key for the per-`(entityKind, entityId, facet)`
 * cell-map. Plain JSON-friendly string per the refinement's D2 — keeps
 * the map serializable for any future snapshot / persistence consumer
 * and constructible at both write- and read-sites without a tuple-
 * comparison helper.
 */
function cellKey(entityKind: string, entityId: string, facetName: string): string {
  return `${entityKind}:${entityId}:${facetName}`;
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
        // Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`
        // D3 — on `entity-removed` (the predecessor's withdraw-arm seam),
        // drop every per-`(entityKind, entityId, facet)` cell in
        // `pendingProposalFacetStatus` matching the named entity. The
        // server emits no terminal `proposal-status` envelope for the
        // withdraw transition; this is where the contract is honored on
        // the client.
        const currentFacetStatus: ReadonlyMap<string, FacetStatus> =
          session.pendingProposalFacetStatus ?? new Map();
        let nextFacetStatus: ReadonlyMap<string, FacetStatus> = currentFacetStatus;
        if (event.kind === 'entity-removed') {
          const payload = event.payload as { entity_kind?: string; entity_id?: string };
          const entityKind = payload.entity_kind;
          const entityId = payload.entity_id;
          if (entityKind !== undefined && entityId !== undefined) {
            const prefix = `${entityKind}:${entityId}:`;
            let mutated: Map<string, FacetStatus> | null = null;
            for (const key of currentFacetStatus.keys()) {
              if (key.startsWith(prefix)) {
                if (mutated === null) {
                  mutated = new Map(currentFacetStatus);
                }
                mutated.delete(key);
              }
            }
            if (mutated !== null) {
              nextFacetStatus = mutated;
            }
          }
        }
        const nextSession: BaseWsSessionState = {
          ...session,
          lastAppliedSequence: event.sequence,
          events: [...session.events, event],
          pendingProposalFacetStatus: nextFacetStatus,
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
        // Per `migrate_off_compute_facet_statuses_onto_proposal_status_broadcast`
        // D2 — populate the per-`(entityKind, entityId, facet)` cell-map
        // for every envelope that carries explicit entity identity. The
        // older proposalId-keyed `pendingProposals` slot is also
        // populated (last-write-wins per proposalId) for backward
        // compatibility with the participant pane's per-proposal lookup
        // until that surface migrates to the per-entity map (tech debt:
        // `participant_ui.part_migrate_to_pending_proposal_facet_status`).
        const currentFacetStatus: ReadonlyMap<string, FacetStatus> =
          session.pendingProposalFacetStatus ?? new Map();
        let nextFacetStatus: ReadonlyMap<string, FacetStatus> = currentFacetStatus;
        if (payload.entityKind !== undefined && payload.entityId !== undefined) {
          const entityKind = payload.entityKind;
          const entityId = payload.entityId;
          let mutated: Map<string, FacetStatus> | null = null;
          for (const [facetName, status] of Object.entries(payload.perFacetStatus)) {
            if (!isFacetStatus(status)) continue;
            if (mutated === null) {
              mutated = new Map(currentFacetStatus);
            }
            mutated.set(cellKey(entityKind, entityId, facetName), status);
          }
          if (mutated !== null) {
            nextFacetStatus = mutated;
          }
        }
        const nextSession: BaseWsSessionState = {
          ...session,
          pendingProposals: {
            ...session.pendingProposals,
            [payload.proposalId]: payload,
          },
          pendingProposalFacetStatus: nextFacetStatus,
        };
        return {
          sessionState: { ...state.sessionState, [payload.sessionId]: nextSession },
        };
      }),

    clearProposalFacetStatusForEntity: (sessionId, entityKind, entityId) =>
      set((state) => {
        const existing = state.sessionState[sessionId];
        if (existing === undefined) return state;
        const currentFacetStatus = existing.pendingProposalFacetStatus;
        if (currentFacetStatus === undefined) return state;
        const prefix = `${entityKind}:${entityId}:`;
        let mutated: Map<string, FacetStatus> | null = null;
        for (const key of currentFacetStatus.keys()) {
          if (key.startsWith(prefix)) {
            if (mutated === null) {
              mutated = new Map(currentFacetStatus);
            }
            mutated.delete(key);
          }
        }
        if (mutated === null) return state;
        const nextSession: BaseWsSessionState = {
          ...existing,
          pendingProposalFacetStatus: mutated,
        };
        return {
          sessionState: { ...state.sessionState, [sessionId]: nextSession },
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
