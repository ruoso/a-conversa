// `useProposeProposalAction({ mode })` — parameterised
// propose-{decomposition,interpretive-split} React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_interpretive_split_mode.md
// (extracted from `useProposeDecompositionAction.ts`; the existing
//  `useProposeDecompositionAction` becomes a thin wrapper —
//  Decision §2 of the refinement).
// Sibling refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 4)
//
// Single shared body for the propose-side hook of the two structural-
// restructure proposal sub-kinds (`decompose`, `interpretive-split`).
// The two share an identical four-gate validation, the wire-shape
// construction shape (kind + parent_node_id + per-row array of
// wording+classification), the optimistic-clear contract, the
// snapshot-restore-on-error path, the in-flight guard, and the
// user-modification dismissal. Mode-specific values switch on
// `args.mode`:
//
//   - The slice reads — `decomposeTargetNodeId` /
//     `interpretiveSplitTargetNodeId` and `decomposeComponents` /
//     `interpretiveSplitReadings`.
//   - The optimistic-clear helper — `exitDecomposeMode` /
//     `exitInterpretiveSplitMode`.
//   - The snapshot-restore replay — `enterDecomposeMode` /
//     `enterInterpretiveSplitMode` and the per-row setters.
//   - The envelope `kind` and the per-row array field name —
//     `components` (decompose) vs `readings` (interpretive-split)
//     per `packages/shared-types/src/events/proposals.ts:182-186`.
//   - The i18n key resolution — `moderator.{decompose, interpretiveSplit}.propose.*`.
//   - The module-scoped error store — per-mode (Decision §6).

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';
import type { ProposalPayload } from '@a-conversa/shared-types';

import {
  useCaptureStore,
  validateProposalRows,
  type DecomposeComponent,
} from '../stores/captureStore';
import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { toWireError, type WireError } from './useProposeAction';
import type { StructuralProposalMode } from './ProposalModeExitAffordance';

/**
 * Shared four-reason union surfaced by both decompose- and
 * interpretive-split-side propose hooks. The `rows-invalid` reason
 * (mode-neutral) replaces the predecessor's `components-invalid`.
 *
 * `DecomposeValidationErrorReason` is preserved as an alias in
 * `useProposeDecompositionAction.ts` for source-stable consumers; it
 * carries the `'components-invalid'` legacy spelling.
 */
export type ProposalValidationErrorReason =
  | 'session-missing'
  | 'not-connected'
  | 'target-missing'
  | 'rows-invalid';

export interface UseProposeProposalActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  propose: () => Promise<void>;
  /** True when all four gates pass and no propose is in flight. */
  canPropose: boolean;
  /** The failing-gate reason, or null. */
  validationError: ProposalValidationErrorReason | null;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

interface ProposalErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

/**
 * Module-scoped Zustand slice holding the last wire error for the
 * propose-decomposition flow. Preserved with its prior name for
 * source-stable consumers (`useProposeDecompositionAction.ts`).
 */
export const useProposeDecompositionErrorStore = create<ProposalErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Sibling module-scoped slice for the propose-interpretive-split
 * flow. Independent of the decompose store so the two inline-error
 * regions don't cross-bleed (Decision §6 of the refinement; mirrors
 * `mod_propose_decomposition` Decision §11).
 */
export const useProposeInterpretiveSplitErrorStore = create<ProposalErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — reset the decompose-side module-scoped error slice.
 */
export function resetProposeDecompositionError(): void {
  useProposeDecompositionErrorStore.getState().setLastError(undefined);
}

/**
 * Test seam — reset the interpretive-split-side module-scoped error
 * slice.
 */
export function resetProposeInterpretiveSplitError(): void {
  useProposeInterpretiveSplitErrorStore.getState().setLastError(undefined);
}

const MODE_CONFIG = {
  decompose: {
    timeoutErrorKey: 'moderator.decompose.propose.timeoutError',
    errorStore: useProposeDecompositionErrorStore,
  },
  'interpretive-split': {
    timeoutErrorKey: 'moderator.interpretiveSplit.propose.timeoutError',
    errorStore: useProposeInterpretiveSplitErrorStore,
  },
} as const;

/**
 * Generate a client-side UUID v4. Delegates to `crypto.randomUUID()`
 * when available (every modern browser), with a deterministic-shape
 * fallback for environments that lack the API. Mirrors the helper at
 * `useProposeAction.ts:144` — duplicated rather than imported because
 * the two hooks are independent module-scope entry points; if a third
 * consumer needs the helper the right time to extract it is then.
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

/**
 * Build the proposal payload for the envelope. Maps the store's
 * per-row `text` field to the wire's `wording` field; mints a fresh
 * per-component `node_id` per row; switches the `kind` + per-row
 * array field name on `mode`.
 *
 * `validateProposalRows` is called immediately before this, so
 * `classification` is known non-null here; the `!` narrowing reflects
 * that established invariant.
 *
 * **Per-component UUIDs are minted CLIENT-side at envelope-build-time**
 * per Decision D2 of `mod_decompose_propose_time_canvas_visibility`.
 * Each invocation mints fresh UUIDs — a propose-error-then-retry
 * mints new IDs, which is the correct behavior for a propose retry
 * (the snapshot-restore path doesn't carry the IDs because the
 * per-row state doesn't store them — they're derived here at
 * envelope-build-time). Mirrors the `classify-node` pattern in
 * `useProposeAction.ts`'s `buildClassifyNodeProposal`. The server's
 * propose handler reads each `node_id` from the payload and emits
 * `node-created` + `entity-included` per component at propose-time
 * so the canvas projector renders each proposed component in
 * `proposed` state immediately (ADR 0027).
 */
function buildProposal(args: {
  mode: StructuralProposalMode;
  parentNodeId: string;
  rows: ReadonlyArray<DecomposeComponent>;
}): ProposalPayload {
  const wireRows = args.rows.map((row) => ({
    wording: row.text,
    classification: row.classification!,
    node_id: randomUuid(),
  }));
  if (args.mode === 'decompose') {
    return {
      kind: 'decompose',
      parent_node_id: args.parentNodeId,
      components: wireRows,
    };
  }
  return {
    kind: 'interpretive-split',
    parent_node_id: args.parentNodeId,
    readings: wireRows,
  };
}

export interface UseProposeProposalActionArgs {
  mode: StructuralProposalMode;
}

export function useProposeProposalAction(
  args: UseProposeProposalActionArgs,
): UseProposeProposalActionResult {
  const { mode } = args;
  const { t } = useTranslation();

  const targetNodeId = useCaptureStore((s) =>
    mode === 'decompose' ? s.decomposeTargetNodeId : s.interpretiveSplitTargetNodeId,
  );
  const rows = useCaptureStore((s) =>
    mode === 'decompose' ? s.decomposeComponents : s.interpretiveSplitReadings,
  );
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const config = MODE_CONFIG[mode];
  const errorStore = config.errorStore;
  const lastError = errorStore((s) => s.lastError);
  const setLastError = errorStore((s) => s.setLastError);

  // Validation — fixed order per Decision §4 of mod_propose_decomposition.
  let validationError: ProposalValidationErrorReason | null = null;
  if (sessionId === '') {
    validationError = 'session-missing';
  } else if (connectionStatus !== 'open') {
    validationError = 'not-connected';
  } else if (targetNodeId === null) {
    validationError = 'target-missing';
  } else if (!validateProposalRows(rows)) {
    validationError = 'rows-invalid';
  }

  const canPropose = validationError === null && !proposing;

  // Auto-dismiss the wire-error region on user-modification of the
  // per-row capture inputs (Decision §7 of mod_propose_decomposition,
  // applied symmetrically to interpretive-split).
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorSliceSnapshotRef = useRef<{
    targetNodeId: typeof targetNodeId;
    rows: typeof rows;
  } | null>(null);
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorSliceSnapshotRef.current = { targetNodeId, rows };
  }
  if (lastError === undefined) {
    errorSliceSnapshotRef.current = null;
  }
  lastErrorRef.current = lastError;
  useEffect(() => {
    if (lastErrorRef.current === undefined) return;
    const baseline = errorSliceSnapshotRef.current;
    if (baseline === null) return;
    if (baseline.targetNodeId === targetNodeId && baseline.rows === rows) {
      return;
    }
    setLastError(undefined);
  }, [targetNodeId, rows, setLastError]);

  async function propose(): Promise<void> {
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const targetNodeIdNow =
      mode === 'decompose'
        ? currentState.decomposeTargetNodeId
        : currentState.interpretiveSplitTargetNodeId;
    const rowsNow =
      mode === 'decompose'
        ? currentState.decomposeComponents
        : currentState.interpretiveSplitReadings;

    if (currentState.proposing) {
      return;
    }

    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (targetNodeIdNow === null) return;
    if (!validateProposalRows(rowsNow)) return;

    const snapshot = {
      targetNodeId: targetNodeIdNow,
      rows: rowsNow,
    };

    // Optimistic clear + flip in-flight. Order matters: exit-mode
    // clears `proposing === false` so we must set it AFTER.
    if (mode === 'decompose') {
      currentState.exitDecomposeMode();
    } else {
      currentState.exitInterpretiveSplitMode();
    }
    setProposing(true);

    try {
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal: buildProposal({
          mode,
          parentNodeId: snapshot.targetNodeId,
          rows: snapshot.rows,
        }),
      });

      setProposing(false);
      setLastError(undefined);
    } catch (err) {
      // Snapshot restore via the helper-driven path. `enterXxxMode`
      // atomically sets `mode`, the target id, clears the F1 slices,
      // and seeds two empty rows; subsequent `addXxx` calls grow the
      // array to the snapshot length; per-row setters write the
      // saved text + classification.
      const restoreState = useCaptureStore.getState();
      if (mode === 'decompose') {
        restoreState.enterDecomposeMode(snapshot.targetNodeId);
      } else {
        restoreState.enterInterpretiveSplitMode(snapshot.targetNodeId);
      }
      const targetLength = snapshot.rows.length;
      for (let i = 2; i < targetLength; i += 1) {
        if (mode === 'decompose') {
          useCaptureStore.getState().addDecomposeComponent();
        } else {
          useCaptureStore.getState().addInterpretiveSplitReading();
        }
      }
      snapshot.rows.forEach((row, index) => {
        if (mode === 'decompose') {
          useCaptureStore.getState().setDecomposeComponentText(index, row.text);
          useCaptureStore.getState().setDecomposeComponentClassification(index, row.classification);
        } else {
          useCaptureStore.getState().setInterpretiveSplitReadingText(index, row.text);
          useCaptureStore
            .getState()
            .setInterpretiveSplitReadingClassification(index, row.classification);
        }
      });
      useCaptureStore.getState().setProposing(false);
      const timeoutText = t(config.timeoutErrorKey);
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
