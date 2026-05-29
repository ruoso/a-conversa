// Shell-side base WS store contract.
//
// Refinement: tasks/refinements/shell-package/shell_substrate_extraction.md
//   (Decisions §"WsStore extraction shape" — the original base shape.
//   Path (b): per-app extension via `WsSessionState extends
//   BaseWsSessionState`, deferred canonicalization until a third caller
//   materialized.)
// Refinement: tasks/refinements/shell-package/shell_diagnostic_highlights_extract.md
//   (Decision §4 — the third caller materialized; `activeDiagnostics`
//   becomes canonical on `BaseWsSessionState` and the three per-app
//   widenings collapse.)
//
// The WS client (`./client.ts`) dispatches inbound envelopes into a
// store via the `WsStoreLike` handle. `BaseWsStoreState` is the single
// source of truth for the surface the client consumes. Adding a new
// method here means the client expects every store to implement it.

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
 * dedup'd event log received over the wire (live + replay merged).
 *
 * `activeDiagnostics` is the canonical per-session active-set of
 * fired-but-not-cleared diagnostics, keyed by
 * `diagnosticIdentityKey(payload)` (see
 * `packages/shell/src/diagnostics/diagnostic-highlights.ts`). The
 * `applyDiagnostic` reducer dispatches on `payload.status`: `'fired'`
 * sets/replaces the entry; `'cleared'` deletes it. The slot
 * canonicalized here in `shell_diagnostic_highlights_extract` (Decision
 * §4) after the moderator + participant + audience converged on the
 * same widening shape.
 *
 * `lastDiagnostic` remains the "last envelope seen" slot (including
 * cleared envelopes) for backward compat with existing readers.
 */
export interface BaseWsSessionState {
  /** High-water mark of `event.sequence` seen for this session. */
  lastAppliedSequence: number;
  /** Dedup'd event log, in arrival order. */
  events: Event[];
  /** Per-proposal status frames keyed by `proposalId`. */
  pendingProposals: Record<string, ProposalStatusPayload>;
  /**
   * Active-set of fired-but-not-cleared diagnostics keyed by the
   * canonical `diagnosticIdentityKey(payload)`.
   */
  activeDiagnostics: ReadonlyMap<string, DiagnosticPayload>;
  /** Latest diagnostic snapshot envelope, if any. */
  lastDiagnostic?: DiagnosticPayload;
}

/**
 * Base WS store contract — the methods the shell's `client.ts` invokes.
 * The shell client is parameterized over this interface so callers can
 * supply their own store (with extra projections or middleware) and
 * future surfaces can supply their own.
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
  /** Per-session server-state. */
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
