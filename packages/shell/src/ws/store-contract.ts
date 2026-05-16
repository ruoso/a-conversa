// Shell-side base WS store contract.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"WsStore extraction shape", Open question "Should the
//   moderator's wsStore.ts extend a shell-supplied base store type?" —
//   path (b), the recommended one)
//
// The WS client (`./client.ts`) dispatches inbound envelopes into a
// store via the `WsStoreLike` handle. Moderator-specific projections
// (the `activeDiagnostics` map keyed by `diagnosticIdentityKey`) live
// outside the shell — see `apps/moderator/src/ws/wsStore.ts`. The
// moderator's slice extends `BaseWsStoreState` and layers its own
// fields on top; the shell client only ever touches the base methods.
//
// `BaseWsStoreState` is the single source of truth for the surface the
// client consumes. Adding a new method here means the client expects
// every store to implement it; adding a method to the moderator's
// extension does not require touching the shell.

import type {
  DiagnosticPayload,
  ErrorPayload,
  Event,
  ProposalStatusPayload,
} from '@a-conversa/shared-types';

/**
 * Connection-level status for the WS surface. UI affordances (a reconnect
 * banner, a "live" badge) switch on this.
 */
export type WsConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * The per-session server-state the client maintains. `events` is the full
 * dedup'd event log received over the wire (live + replay merged). UI
 * surfaces project off it (the moderator's change-history pane reads
 * `events` verbatim; the moderator's pending-proposals pane reads
 * `pendingProposals`).
 *
 * The base shape does NOT include moderator-specific projections like
 * `activeDiagnostics`. Surfaces that need richer projections extend
 * this interface (see `apps/moderator/src/ws/wsStore.ts`).
 */
export interface BaseWsSessionState {
  /** High-water mark of `event.sequence` seen for this session. */
  lastAppliedSequence: number;
  /** Dedup'd event log, in arrival order. */
  events: Event[];
  /** Per-proposal status frames keyed by `proposalId`. */
  pendingProposals: Record<string, ProposalStatusPayload>;
  /** Latest diagnostic snapshot envelope, if any. */
  lastDiagnostic?: DiagnosticPayload;
}

/**
 * Base WS store contract — the methods the shell's `client.ts` invokes.
 * The shell client is parameterized over this interface so the moderator
 * can supply its richer store (with `activeDiagnostics` etc.) and future
 * surfaces can supply their own.
 *
 * `applyEvent` returns `boolean` so the client can tell whether the
 * dedupe path was hit (replay-vs-live overlap). The other writers
 * return `void`.
 */
export interface BaseWsStoreState {
  /** Connection-level status. */
  connectionStatus: WsConnectionStatus;
  /** `connectionId` from the latest `hello`. */
  connectionId: string | undefined;
  /** Session ids the consumer asked to follow (used as resume list). */
  subscriptions: ReadonlySet<string>;
  /** Per-session server-state — base shape (subclasses may widen). */
  sessionState: Record<string, BaseWsSessionState>;
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

/**
 * A Zustand-like store handle. The shell's `client.ts` only needs
 * `getState()` — it does not subscribe (UI components subscribe via the
 * underlying store's `useStore` selector hook).
 *
 * Zustand's `UseBoundStore` shape satisfies this interface naturally.
 */
export interface WsStoreLike<TState extends BaseWsStoreState> {
  getState: () => TState;
}
