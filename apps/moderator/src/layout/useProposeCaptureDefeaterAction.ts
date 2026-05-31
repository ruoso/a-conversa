// `useProposeCaptureDefeaterAction()` — the moderator's
// propose-capture-defeater React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_defeater_node_creation.md
// Sibling templates:
//   apps/moderator/src/layout/useProposeAction.ts (F1 — `buildCaptureNodeProposal` + `toWireError` source)
//   apps/moderator/src/layout/useProposeProposalAction.ts (per-mode hook architectural template)
//
// Drives the F6 defeater-capture flow's propose round-trip. Reads the
// wording from the reused F1 `text` slice (Decision §D3 of the
// refinement — no new mutable slice; the F1-clear coupling on
// `enterCaptureDefeaterMode` already prevents bleed-through), mints
// fresh client-side UUIDs for the new defeater node Y and the new
// rebut edge Y → X, and dispatches a SINGLE `propose capture-node`
// envelope whose payload carries the optional `edge` block (role
// `'rebuts'`, direction `'targets'`, target is the staged
// `captureDefeaterTargetNodeId`). The server emits
// `node-created(Y)` + `entity-included(node)` + `edge-created(rebuts
// Y→X)` + `entity-included(edge)` + `proposal` in a single envelope
// chain per ADR 0027 + the `capture-node` doc-block at
// `packages/shared-types/src/events/proposals.ts:95-146`.
//
// On success: `exitCaptureDefeaterMode()` flips the mode back to
// `'idle'` and clears the target slice; an explicit `setText('')`
// clears the wording slice (Decision §D10 — the exit helper does NOT
// clear `text` on its own); `setProposing(false)` releases the
// in-flight lock; `lastError` clears.
//
// On failure: `setProposing(false)`; `text` restores from a
// pre-call snapshot (Decision §D7 — only `text` is snapshotted; mode
// and target stay in place so the moderator can edit + retry);
// `lastError` surfaces the wire error via the shared `toWireError`
// mapper from `useProposeAction.ts`.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useCaptureStore } from '../stores/captureStore';
import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { toWireError, type WireError } from './useProposeAction';

export interface UseProposeCaptureDefeaterActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  propose: () => Promise<void>;
  /** True when all six gates pass and no propose is in flight. */
  canPropose: boolean;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

interface CaptureDefeaterErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

/**
 * Module-scoped Zustand slice holding the last wire error for the
 * capture-defeater propose flow. Independent of the F1 + decompose +
 * interpretive-split error stores so the inline error region for this
 * gesture doesn't cross-bleed (mirrors the per-mode error-store
 * convention pinned by `mod_propose_decomposition` Decision §11 +
 * `mod_interpretive_split_mode` Decision §6).
 */
const useProposeCaptureDefeaterErrorStore = create<CaptureDefeaterErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — reset the capture-defeater-side module-scoped error
 * slice between cases. Mirrors `resetProposeDecompositionError`.
 */
export function resetProposeCaptureDefeaterError(): void {
  useProposeCaptureDefeaterErrorStore.getState().setLastError(undefined);
}

/**
 * Generate a client-side UUID v4. Delegates to `crypto.randomUUID()`
 * when available; same shape as the sibling hooks'
 * `randomUuid` helper (mirrors `useProposeAction.ts:144` /
 * `useProposeProposalAction.ts:137`). Duplicated locally per the
 * three-similar-lines-is-better-than-an-abstraction policy until a
 * fourth consumer appears.
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

export function useProposeCaptureDefeaterAction(): UseProposeCaptureDefeaterActionResult {
  const { t } = useTranslation();

  const text = useCaptureStore((s) => s.text);
  const mode = useCaptureStore((s) => s.mode);
  const captureDefeaterTargetNodeId = useCaptureStore((s) => s.captureDefeaterTargetNodeId);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const lastError = useProposeCaptureDefeaterErrorStore((s) => s.lastError);
  const setLastError = useProposeCaptureDefeaterErrorStore((s) => s.setLastError);

  const canPropose =
    sessionId !== '' &&
    connectionStatus === 'open' &&
    mode === 'capture-defeater' &&
    captureDefeaterTargetNodeId !== null &&
    text.trim().length > 0 &&
    proposing === false;

  // Auto-dismiss the wire-error region on user-modification of the
  // wording (mirrors `useProposeAction.ts:328` + the decompose hook's
  // identical effect). Snapshot the text value at the moment
  // `lastError` was set so the snapshot-restore-after-failure path
  // doesn't immediately clear the just-set `lastError`; only a real
  // user edit dismisses.
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorTextSnapshotRef = useRef<string | null>(null);
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorTextSnapshotRef.current = text;
  }
  if (lastError === undefined) {
    errorTextSnapshotRef.current = null;
  }
  lastErrorRef.current = lastError;
  useEffect(() => {
    if (lastErrorRef.current === undefined) return;
    const baseline = errorTextSnapshotRef.current;
    if (baseline === null) return;
    if (baseline === text) return;
    setLastError(undefined);
  }, [text, setLastError]);

  async function propose(): Promise<void> {
    // Re-check the gates against call-time state — keystrokes between
    // the last render and this call could have invalidated the form.
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const textNow = currentState.text;
    const modeNow = currentState.mode;
    const targetNodeIdNow = currentState.captureDefeaterTargetNodeId;

    if (currentState.proposing) return;
    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (modeNow !== 'capture-defeater') return;
    if (targetNodeIdNow === null) return;
    if (textNow.trim().length === 0) return;

    // Snapshot `text` before the in-flight flip (Decision §D7) — on
    // any error path we restore it so the moderator can edit + retry
    // without re-typing the defeater wording.
    const textSnapshot = textNow;

    // Mint fresh UUIDs for the new defeater node Y and the new rebut
    // edge Y → X. Held in lexical scope so both ride the same
    // single `propose capture-node` envelope.
    const nodeId = randomUuid();
    const edgeId = randomUuid();

    setProposing(true);

    try {
      // Single `capture-node`-with-edge envelope (Decision §D2): the
      // server emits node-created(Y) + entity-included(node) +
      // edge-created(rebuts Y→X) + entity-included(edge) + proposal in
      // one envelope chain per ADR 0027 + the `capture-node` doc-block
      // at `packages/shared-types/src/events/proposals.ts:95-146`.
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal: {
          kind: 'capture-node',
          node_id: nodeId,
          wording: textNow,
          edge: {
            edge_id: edgeId,
            role: 'rebuts',
            // Direction is locked to `'targets'`: the new defeater
            // node Y is the edge SOURCE and the staged existing node
            // X (the rebut target) is the edge TARGET. Decision §D2.
            source_node_id: nodeId,
            target_node_id: targetNodeIdNow,
          },
        },
      });

      // Success — mode → idle, target → null, wording slice cleared,
      // in-flight released, any prior wire-error dropped. Decision §D10
      // records the explicit `setText('')` (the exit helper does NOT
      // clear the wording slice on its own).
      useCaptureStore.getState().exitCaptureDefeaterMode();
      useCaptureStore.getState().setText('');
      setProposing(false);
      setLastError(undefined);
    } catch (err) {
      // Failure — restore the wording snapshot, leave mode + target
      // alone so the moderator can edit + retry, surface the wire
      // error inline.
      useCaptureStore.setState({
        text: textSnapshot,
        proposing: false,
      });
      const timeoutText = t('moderator.proposeAction.timeoutError');
      setLastError(toWireError(err, timeoutText));
    }
  }

  return {
    propose,
    canPropose,
    inFlight: proposing,
    lastError,
  };
}
