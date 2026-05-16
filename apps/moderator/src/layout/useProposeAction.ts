// `useProposeAction()` — the moderator's propose-bundle React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_action.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 4)
//
// Binds the four `useCaptureStore` slices (`text`, `classification`,
// `targetEntityId`, `edgeRole`) to the WS-write surface
// (`useWsClient().send('propose', payload)`). Exposes:
//
//   - `propose()` — the gesture handler, called from both the
//     `<CaptureTextInput>` Cmd/Ctrl+Enter callback and the
//     `<ProposeAction>` button click.
//   - `canPropose` — `true` iff the six-gate validation passes AND no
//     other propose round-trip is in flight.
//   - `validationError` — the failing-gate reason, or `null`.
//   - `inFlight` — `true` while the round-trip is in flight.
//   - `lastError` — the wire-error code + message from the last failed
//     propose, or `undefined`.
//
// The hook owns:
//
//   - The six-gate validation (Decision §2 in the refinement) — the
//     gates fire in fixed order: `session-missing` →
//     `not-connected` → `text-empty` → `classification-missing` →
//     `target-without-role` → `role-without-target`.
//   - Client-side `node_id` / `edge_id` UUID generation via
//     `crypto.randomUUID()` (same primitive `WsClient` uses for
//     envelope ids).
//   - The optimistic-clear contract: capture a snapshot of the four
//     slices before resetting the store; on error, restore the
//     snapshot so the moderator can fix and retry without re-typing.
//   - The sequential-envelope protocol for the connecting case: fire
//     the `classify-node` envelope first, await the `proposed` ack,
//     then fire the `set-edge-substance` envelope reading the
//     post-first-broadcast `lastAppliedSequence` for the second
//     envelope's `expectedSequence` token.
//   - The in-flight guard: a concurrent `propose()` call while a
//     prior round-trip is still in flight is a no-op.
//
// Errors raised by the WS client are mapped to `WireError`:
//
//   - `WsRequestError(payload)` → `{ code: payload.code, message:
//     payload.message }`. The server's localized-or-not message is
//     authoritative (some engine rejections carry per-case detail
//     that cannot be looked up from a fixed key catalog —
//     Decision §6).
//   - `WsRequestTimeoutError` → `{ code: 'timeout', message: <localized
//     timeout text> }`.
//   - Any other `Error` → `{ code: 'unknown', message: err.message }`.
//
// Dismissal of `lastError` is driven by the consumer: the hook
// auto-clears `lastError` on the next successful `propose()` AND on
// any change to `text` / `classification` / `targetEntityId` /
// `edgeRole` (the "user is fixing it" signal — Decision §6).

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';
import type { ProposalPayload, StatementKind } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useWsClient } from '../ws/WsClientProvider';
import { useWsStore } from '../ws/wsStore';
import { WsRequestError, WsRequestTimeoutError } from '../ws/client';

/**
 * The discriminated set of validation-gate failure reasons. Each maps
 * to a localized inline-error message via the
 * `moderator.proposeAction.reason.<reason>` catalog key. The order in
 * `validate()` matches the priority pinned by Decision §2.
 */
export type ValidationErrorReason =
  | 'text-empty'
  | 'classification-missing'
  | 'role-without-target'
  | 'target-without-role'
  | 'session-missing'
  | 'not-connected';

/**
 * Shape surfaced from `lastError`. `code` is the engine's rejection
 * code (or a transport-layer code like `'timeout'` / `'unknown'`);
 * `message` is the wire-supplied message verbatim when present, or a
 * localized fallback for transport-layer errors.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseProposeActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  propose: () => Promise<void>;
  /** True when all six gates pass and no propose is in flight. */
  canPropose: boolean;
  /** The failing-gate reason, or null. */
  validationError: ValidationErrorReason | null;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice holding the last wire error. Lives
 * outside React so the two `useProposeAction()` call sites — one in
 * `<OperateRoute>` (driving the textarea Cmd/Ctrl+Enter callback) and
 * one in `<ProposeAction>` (driving the button click) — observe the
 * SAME error after a failed propose. `useState` would give each hook
 * instance its own copy, which would mean a Cmd+Enter-triggered
 * failure would not render the error region inside the
 * `<ProposeAction>` button.
 *
 * The slice is intentionally tiny — no setters beyond the two the
 * hook uses internally; no React provider; no devtools wiring.
 * Reset on a fresh successful propose AND on any user-modification
 * of the four capture-store slices (Decision §6).
 */
interface ProposeErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

const useProposeErrorStore = create<ProposeErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — let test suites reset the module-scoped error slice
 * between cases without poking at the store's internals.
 */
export function resetProposeError(): void {
  useProposeErrorStore.getState().setLastError(undefined);
}

/**
 * Generate a client-side UUID v4. Delegates to `crypto.randomUUID()`
 * when available (every modern browser; `WsClient` already relies on
 * it), with a deterministic-shape fallback for environments that
 * lack the API.
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — same shape as `client.ts`'s `nativeRandomId` fallback.
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

/**
 * Build a `classify-node` proposal payload for the new statement node.
 */
function buildClassifyNodeProposal(args: {
  nodeId: string;
  classification: StatementKind;
}): ProposalPayload {
  return {
    kind: 'classify-node',
    node_id: args.nodeId,
    classification: args.classification,
  };
}

/**
 * Build a `set-edge-substance` proposal payload for the connecting
 * edge. v1 always seeds the edge substance as `'agreed'` — the moderator
 * is proposing a new edge with the role they selected; the substance
 * vote is the subsequent step. The wire shape requires the field, and
 * `'agreed'` is the methodology default for a fresh proposal (the engine
 * will reject if the substance is disallowed for the role).
 */
function buildSetEdgeSubstanceProposal(args: { edgeId: string }): ProposalPayload {
  return {
    kind: 'set-edge-substance',
    edge_id: args.edgeId,
    value: 'agreed',
  };
}

/**
 * Map any thrown error to the `WireError` surface. `WsRequestError`
 * carries the server's typed payload verbatim; `WsRequestTimeoutError`
 * gets a localized fallback message; anything else lands as
 * `'unknown'`. The `timeoutText` is pre-resolved by the caller (so the
 * function stays React-free and easy to test).
 */
function toWireError(err: unknown, timeoutText: string): WireError {
  if (err instanceof WsRequestError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof WsRequestTimeoutError) {
    return { code: 'timeout', message: timeoutText };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

export function useProposeAction(): UseProposeActionResult {
  const { t } = useTranslation();

  // Capture-store reads (one selector each so React re-subscribes
  // only when the relevant slice changes).
  const text = useCaptureStore((s) => s.text);
  const classification = useCaptureStore((s) => s.classification);
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const edgeRole = useCaptureStore((s) => s.edgeRole);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  // Session + WS reads.
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const lastError = useProposeErrorStore((s) => s.lastError);
  const setLastError = useProposeErrorStore((s) => s.setLastError);

  // Validation — fixed order per Decision §2.
  let validationError: ValidationErrorReason | null = null;
  if (sessionId === '') {
    validationError = 'session-missing';
  } else if (connectionStatus !== 'open') {
    validationError = 'not-connected';
  } else if (text.trim().length === 0) {
    validationError = 'text-empty';
  } else if (classification === null) {
    validationError = 'classification-missing';
  } else if (targetEntityId !== null && edgeRole === null) {
    validationError = 'target-without-role';
  } else if (edgeRole !== null && targetEntityId === null) {
    validationError = 'role-without-target';
  }

  const canPropose = validationError === null && !proposing;

  // Auto-dismiss the wire-error region on any user-modification of the
  // capture inputs (Decision §6). The effect fires when any of the four
  // capture slices change. To avoid the snapshot-restore-after-failure
  // path immediately clearing the just-set `lastError`, we capture the
  // slice values at the moment `lastError` was set (the snapshot
  // restore's post-condition); the effect only dismisses when the
  // current slice values DIFFER from those captured values — i.e., the
  // moderator typed / picked something after the failure.
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorSliceSnapshotRef = useRef<{
    text: string;
    classification: typeof classification;
    targetEntityId: typeof targetEntityId;
    edgeRole: typeof edgeRole;
  } | null>(null);
  // Detect a fresh `setLastError(error)` transition (undefined → defined)
  // and capture the current slice values as the "baseline" — subsequent
  // slice changes that differ from this baseline dismiss the error.
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorSliceSnapshotRef.current = { text, classification, targetEntityId, edgeRole };
  }
  if (lastError === undefined) {
    errorSliceSnapshotRef.current = null;
  }
  lastErrorRef.current = lastError;
  useEffect(() => {
    if (lastErrorRef.current === undefined) return;
    const baseline = errorSliceSnapshotRef.current;
    if (baseline === null) return;
    if (
      baseline.text === text &&
      baseline.classification === classification &&
      baseline.targetEntityId === targetEntityId &&
      baseline.edgeRole === edgeRole
    ) {
      // No real user change since the error landed — keep the region
      // visible.
      return;
    }
    setLastError(undefined);
    // Dep list is the four slices the moderator is editing.
  }, [text, classification, targetEntityId, edgeRole, setLastError]);

  // The propose handler. Closes over the current render's slice values
  // via lexical scope; the in-flight guard short-circuits a re-entry.
  async function propose(): Promise<void> {
    // Re-check validation at call-time — keystrokes between the last
    // render and this call could have invalidated the form.
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const textNow = currentState.text;
    const classificationNow = currentState.classification;
    const targetEntityIdNow = currentState.targetEntityId;
    const edgeRoleNow = currentState.edgeRole;

    if (currentState.proposing) {
      // Concurrent re-entry — Decision §5 + AC 12.8. Drop silently.
      return;
    }

    // Re-run the gates against the call-time state.
    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (textNow.trim().length === 0) return;
    if (classificationNow === null) return;
    if (targetEntityIdNow !== null && edgeRoleNow === null) return;
    if (edgeRoleNow !== null && targetEntityIdNow === null) return;

    // Snapshot the four slices BEFORE the optimistic clear. On any
    // error path we restore from the snapshot so the moderator can fix
    // and retry without re-typing (Decision §4).
    const snapshot = {
      text: textNow,
      classification: classificationNow,
      targetEntityId: targetEntityIdNow,
      edgeRole: edgeRoleNow,
    };

    // Mint the client-side ids. Held in `propose`'s lexical scope so
    // the two envelopes (connecting case) reference the same edge id.
    const nodeId = randomUuid();
    const edgeId = targetEntityIdNow !== null ? randomUuid() : undefined;
    const isConnecting = targetEntityIdNow !== null && edgeRoleNow !== null && edgeId !== undefined;

    // Optimistic clear + flip in-flight. The moderator's next keystroke
    // immediately begins a new draft; the prior propose is in flight.
    // **Order matters**: `reset()` spreads `initialCaptureState`, which
    // includes `proposing: false`; flipping `proposing` to `true` AFTER
    // the reset is what lets sibling components observe the in-flight
    // window AND what makes the in-flight guard at the top of `propose()`
    // reject a concurrent re-entry.
    currentState.reset();
    setProposing(true);

    try {
      // First envelope — `classify-node`. The server's propose handler
      // creates the paired `node-created` + `entity-included` events
      // inline; the `event-applied` broadcast lands and updates
      // `useWsStore.sessionState[sessionId].lastAppliedSequence` BEFORE
      // the matching `proposed` ack resolves the send-promise (the WS
      // client dispatches the broadcast into the store via its
      // `applyEvent` reducer; the broadcast arrives on the proposer's
      // socket alongside non-proposer subscribers).
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal: buildClassifyNodeProposal({
          nodeId,
          classification: classificationNow,
        }),
      });

      if (isConnecting) {
        // Second envelope — `set-edge-substance`. Reads the
        // post-first-broadcast high-water mark for its
        // `expectedSequence` token.
        await client.send('propose', {
          sessionId: sessionIdNow,
          expectedSequence: lastAppliedSequenceForCall(),
          proposal: buildSetEdgeSubstanceProposal({ edgeId }),
        });
      }

      // Success — clear in-flight, drop any stale wire-error.
      setProposing(false);
      setLastError(undefined);
    } catch (err) {
      // Failure — restore the snapshot and surface the error inline.
      // Use `setState` rather than the individual setters so the four
      // slices land atomically (one re-render, one store transition).
      useCaptureStore.setState({
        text: snapshot.text,
        classification: snapshot.classification,
        targetEntityId: snapshot.targetEntityId,
        edgeRole: snapshot.edgeRole,
        proposing: false,
      });
      const timeoutText = t('moderator.proposeAction.timeoutError');
      setLastError(toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    canPropose,
    validationError,
    inFlight: proposing,
    lastError,
  };
}
