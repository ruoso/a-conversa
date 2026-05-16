// `useProposeDecompositionAction()` — the moderator's
// propose-decomposition React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_propose_decomposition.md
// Design doc: docs/moderator-ui.md (F2 decompose flow, step 4)
//
// Sibling to `useProposeAction` (F1 capture flow). Binds the two
// decompose-specific `useCaptureStore` slices
// (`decomposeTargetNodeId`, `decomposeComponents`) plus the shared
// `proposing` slice to the WS-write surface
// (`useWsClient().send('propose', payload)`) and exposes:
//
//   - `propose()` — the gesture handler, called from the
//     `<ProposeDecompositionAction>` button click. v1 has no keyboard
//     path (per `mod_propose_decomposition.md` Decision §8 — the per-
//     row textareas don't fire a submit chord, mirroring the
//     predecessor's `mod_multi_component_capture` Decision §6).
//   - `canPropose` — `true` iff the four-gate validation passes AND no
//     other propose round-trip is in flight.
//   - `validationError` — the failing-gate reason, or `null`.
//   - `inFlight` — `true` while the round-trip is in flight (reads the
//     shared `proposing` slice — Decision §5).
//   - `lastError` — the wire-error code + message from the last failed
//     propose, or `undefined`.
//
// The hook owns:
//
//   - The four-gate validation (Decision §4) — gates fire in order:
//     `session-missing` → `not-connected` → `target-missing` →
//     `components-invalid`. The `components-invalid` gate is the only
//     user-correctable rule and surfaces a single atomic message
//     (not enumerated per-row violations — Decision §4).
//   - The wire-shape construction: one `propose` envelope per call,
//     payload shape `{ kind: 'decompose', parent_node_id, components:
//     [{ wording, classification }, ...] }`. The per-row `text` field
//     is renamed to `wording` at envelope-build time (Decision §2 —
//     the store keeps the more natural `text` name for UI continuity).
//   - The optimistic-clear contract: capture a snapshot of the
//     decompose state BEFORE clearing; on error restore the snapshot
//     via `enterDecomposeMode` + per-row setter replay (Decision §6).
//   - The in-flight guard: a concurrent `propose()` call while a prior
//     round-trip is still in flight is a no-op.
//
// Errors raised by the WS client are mapped to `WireError` via the
// shared `toWireError` helper re-exported from `useProposeAction.ts`
// (Decision §11). Dismissal of `lastError` is driven by user
// modifications to the per-row capture inputs: any reference change to
// `decomposeComponents` OR a change to `decomposeTargetNodeId`
// dismisses the region (Decision §7 — array-reference baseline).

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';
import type { ProposalPayload } from '@a-conversa/shared-types';

import {
  useCaptureStore,
  validateDecomposeComponents,
  type DecomposeComponent,
} from '../stores/captureStore';
import { useWsClient } from '../ws/WsClientProvider';
import { useWsStore } from '../ws/wsStore';
import { toWireError, type WireError } from './useProposeAction';

/**
 * The discriminated set of validation-gate failure reasons for the
 * propose-decomposition flow. Each maps to a localized inline-error
 * message via the `moderator.decompose.propose.reason.<reason>`
 * catalog key. The order in `validate()` matches Decision §4.
 *
 * `components-invalid` is the only user-correctable reason; the other
 * three are defensive (only reachable via test seams or transient WS
 * states).
 */
export type DecomposeValidationErrorReason =
  | 'session-missing'
  | 'not-connected'
  | 'target-missing'
  | 'components-invalid';

export interface UseProposeDecompositionActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  propose: () => Promise<void>;
  /** True when all four gates pass and no propose is in flight. */
  canPropose: boolean;
  /** The failing-gate reason, or null. */
  validationError: DecomposeValidationErrorReason | null;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

/**
 * Module-scoped Zustand slice holding the last wire error for the
 * propose-decomposition flow. Lives outside React so the hook + the
 * component observe the SAME error after a failed propose.
 *
 * Parallel to `useProposeErrorStore` in `useProposeAction.ts` rather
 * than reusing it: the two inline-error regions render their
 * respective errors; mixing them would cause cross-flow error bleed
 * (Decision §11). The slice is intentionally tiny — no setters beyond
 * the two the hook uses internally; no React provider; no devtools
 * wiring.
 */
interface ProposeDecompositionErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

const useProposeDecompositionErrorStore = create<ProposeDecompositionErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — let test suites reset the module-scoped error slice
 * between cases without poking at the store's internals.
 */
export function resetProposeDecompositionError(): void {
  useProposeDecompositionErrorStore.getState().setLastError(undefined);
}

/**
 * Build the `decompose` proposal payload for the envelope. Maps the
 * store's per-row `text` field to the wire's `wording` field
 * (Decision §2). `validateDecomposeComponents` is called immediately
 * before this, so `classification` is known non-null here; the `!`
 * narrowing reflects that established invariant.
 */
function buildDecomposeProposal(args: {
  parentNodeId: string;
  components: ReadonlyArray<DecomposeComponent>;
}): ProposalPayload {
  return {
    kind: 'decompose',
    parent_node_id: args.parentNodeId,
    components: args.components.map((row) => ({
      wording: row.text,
      // Non-null by the validateDecomposeComponents gate; the cast
      // narrows for the type system.
      classification: row.classification!,
    })),
  };
}

export function useProposeDecompositionAction(): UseProposeDecompositionActionResult {
  const { t } = useTranslation();

  // Capture-store reads (one selector each so React re-subscribes only
  // when the relevant slice changes).
  const decomposeTargetNodeId = useCaptureStore((s) => s.decomposeTargetNodeId);
  const decomposeComponents = useCaptureStore((s) => s.decomposeComponents);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  // Session + WS reads.
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const lastError = useProposeDecompositionErrorStore((s) => s.lastError);
  const setLastError = useProposeDecompositionErrorStore((s) => s.setLastError);

  // Validation — fixed order per Decision §4.
  let validationError: DecomposeValidationErrorReason | null = null;
  if (sessionId === '') {
    validationError = 'session-missing';
  } else if (connectionStatus !== 'open') {
    validationError = 'not-connected';
  } else if (decomposeTargetNodeId === null) {
    validationError = 'target-missing';
  } else if (!validateDecomposeComponents(decomposeComponents)) {
    validationError = 'components-invalid';
  }

  const canPropose = validationError === null && !proposing;

  // Auto-dismiss the wire-error region on any user-modification of the
  // per-row capture inputs (Decision §7). The effect fires when the
  // `decomposeComponents` array reference changes OR when
  // `decomposeTargetNodeId` flips. To avoid the snapshot-restore-after-
  // failure path immediately clearing the just-set `lastError`, we
  // capture the two values at the moment `lastError` was set (the
  // snapshot restore's post-condition); the effect only dismisses when
  // the current values DIFFER from those captured values.
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorSliceSnapshotRef = useRef<{
    decomposeTargetNodeId: typeof decomposeTargetNodeId;
    decomposeComponents: typeof decomposeComponents;
  } | null>(null);
  // Detect a fresh `setLastError(error)` transition (undefined → defined)
  // and capture the current slice values as the "baseline" — subsequent
  // slice changes that differ from this baseline dismiss the error.
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorSliceSnapshotRef.current = { decomposeTargetNodeId, decomposeComponents };
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
      baseline.decomposeTargetNodeId === decomposeTargetNodeId &&
      baseline.decomposeComponents === decomposeComponents
    ) {
      // No real user change since the error landed — keep the region
      // visible.
      return;
    }
    setLastError(undefined);
    // Dep list is the two decompose slices the moderator can mutate.
  }, [decomposeTargetNodeId, decomposeComponents, setLastError]);

  // The propose handler. Closes over the current render's slice values
  // via lexical scope; the in-flight guard short-circuits a re-entry.
  async function propose(): Promise<void> {
    // Re-check validation at call-time — keystrokes between the last
    // render and this call could have invalidated the form.
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const decomposeTargetNodeIdNow = currentState.decomposeTargetNodeId;
    const decomposeComponentsNow = currentState.decomposeComponents;

    if (currentState.proposing) {
      // Concurrent re-entry — Decision §5. Drop silently.
      return;
    }

    // Re-run the gates against the call-time state.
    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (decomposeTargetNodeIdNow === null) return;
    if (!validateDecomposeComponents(decomposeComponentsNow)) return;

    // Snapshot the decompose state BEFORE the optimistic clear. On any
    // error path we restore from the snapshot via the helper-driven
    // replay (Decision §6) so the moderator can fix and retry without
    // re-typing.
    const snapshot = {
      decomposeTargetNodeId: decomposeTargetNodeIdNow,
      decomposeComponents: decomposeComponentsNow,
    };

    // Optimistic clear + flip in-flight. The mode flips to 'idle'; the
    // route's conditional swap re-mounts the F1 slots; the moderator's
    // next gesture immediately begins a new F1 capture; the prior
    // propose-decomposition is in flight.
    // **Order matters**: `exitDecomposeMode()` does not touch
    // `proposing`; flipping `proposing` to `true` AFTER the exit is
    // what lets sibling components observe the in-flight window AND
    // what makes the in-flight guard at the top of `propose()` reject
    // a concurrent re-entry.
    currentState.exitDecomposeMode();
    setProposing(true);

    try {
      // One envelope per propose-decomposition call (Decision §1).
      // Per `tasks/refinements/backend/ws_propose_message.md:13` the
      // server's propose handler appends exactly one event per
      // envelope — the `proposal` event — via `appendSessionEvent`.
      // Structural entity-creation events (`node-created` per
      // component + `entity-included` per component) are commit-time
      // effects per `decomposition_logic.md`'s Open Questions; they
      // do NOT fire here.
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal: buildDecomposeProposal({
          parentNodeId: snapshot.decomposeTargetNodeId,
          components: snapshot.decomposeComponents,
        }),
      });

      // Success — clear in-flight, drop any stale wire-error.
      setProposing(false);
      setLastError(undefined);
    } catch (err) {
      // Failure — restore the snapshot via the helper-driven path
      // (Decision §6). `enterDecomposeMode` atomically sets `mode =
      // 'decompose'`, the target id, clears the F1 slices, and seeds
      // two empty rows; subsequent `addDecomposeComponent` calls grow
      // the array to the snapshot length; per-row setters write the
      // saved text + classification.
      const restoreState = useCaptureStore.getState();
      restoreState.enterDecomposeMode(snapshot.decomposeTargetNodeId);
      const targetLength = snapshot.decomposeComponents.length;
      for (let i = 2; i < targetLength; i += 1) {
        useCaptureStore.getState().addDecomposeComponent();
      }
      snapshot.decomposeComponents.forEach((row, index) => {
        useCaptureStore.getState().setDecomposeComponentText(index, row.text);
        useCaptureStore.getState().setDecomposeComponentClassification(index, row.classification);
      });
      useCaptureStore.getState().setProposing(false);
      const timeoutText = t('moderator.decompose.propose.timeoutError');
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
