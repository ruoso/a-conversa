// `useMetaMoveAction()` — the moderator's propose-meta-move React hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_meta_move_action.md
// Sibling templates:
//   apps/moderator/src/layout/useProposeAction.ts (`toWireError` source)
//   apps/moderator/src/layout/useProposeCaptureDefeaterAction.ts
//
// Drives the F8 meta-move flow's propose round-trip. Reads the wording
// from the reused F1 `text` slice (Decision §5 — text slice reuse), the
// staged target from `targetEntityId` + `targetEntityKind` (the existing
// `<CaptureTargetChip>` auto-suggest mechanism stays unchanged), and
// the kind from the new `metaMoveKind` slice (default `'reframe'` per
// Decision §3). Dispatches a SINGLE `propose meta-move` envelope whose
// payload mirrors `metaMoveProposalSchema`
// (`packages/shared-types/src/events/proposals.ts:412-419`): `{ kind:
// 'meta-move', meta_kind, content, target_kind: 'node', target_id }`.
//
// **Target kind allow-list: `{'node', 'edge'}`** (Decision §3 of
// `mod_meta_move_edge_target_gesture.md`). The schema sanctions both
// values; the hook derives `target_kind` from the staged
// `targetEntityKind` rather than hardcoding `'node'`. Annotation
// targets are still rejected client-side (rather than silently coerced)
// so the confusing engine-side `'target-entity-not-found'` rejection
// is surfaced inline as a localized validation gate instead. The
// permanence of the annotation rejection is recorded in ADR 0036
// (`docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md`).
//
// On success: clears `text` and `targetEntityId` optimistically (the
// moderator's next propose starts from an empty draft); leaves mode
// staged at `'meta-move'` so the moderator can compose another (mirror
// of the in-flight UX choice the propose-action chain pioneered).
// Decision §6: the wire-error region is dismissed on the next
// successful propose AND on any user modification of the inputs.
//
// On failure: `setProposing(false)`; `text` / `targetEntityId` /
// `metaMoveKind` restore from a pre-call snapshot; `lastError` carries
// the wire code + message verbatim via the shared `toWireError` mapper.

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useCaptureStore } from '../stores/captureStore';
import { useWsClient } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';
import { toWireError, type WireError } from './useProposeAction';

/**
 * The discriminated set of meta-move validation-gate failure reasons.
 * Each maps to a localized inline-error message via
 * `moderator.metaMoveAction.reason.<reason>` in the catalog. The order
 * in the gate chain matches the priority pinned by the unit tests:
 * `session-missing` → `not-connected` → `content-missing` →
 * `target-missing` → `target-kind-invalid` → `kind-missing`.
 */
export type MetaMoveValidationReason =
  | 'session-missing'
  | 'not-connected'
  | 'content-missing'
  | 'target-missing'
  | 'target-kind-invalid'
  | 'kind-missing';

export interface UseMetaMoveActionResult {
  /** Trigger the propose round-trip. Idempotent during the in-flight window. */
  proposeMetaMove: () => Promise<void>;
  /** True when all gates pass and no propose is in flight. */
  canPropose: boolean;
  /** The failing-gate reason, or null. */
  validationError: MetaMoveValidationReason | null;
  /** True while a propose round-trip is in flight. */
  inFlight: boolean;
  /** The wire-error code + message from the last failed propose, or undefined. */
  lastError: WireError | undefined;
}

interface MetaMoveErrorState {
  lastError: WireError | undefined;
  setLastError: (error: WireError | undefined) => void;
}

/**
 * Module-scoped Zustand slice holding the last wire error for the
 * meta-move propose flow. Independent of the F1 / decompose /
 * interpretive-split / capture-defeater error stores (per the per-mode
 * error-store convention pinned by `mod_propose_decomposition`
 * Decision §11 + carried by `mod_capture_defeater_mode` /
 * `mod_meta_move_action`). The inline error region for the meta-move
 * gesture stays independent of any other propose-action region.
 */
const useMetaMoveErrorStore = create<MetaMoveErrorState>((set) => ({
  lastError: undefined,
  setLastError: (lastError) => set({ lastError }),
}));

/**
 * Test seam — let test suites reset the module-scoped error slice
 * between cases without poking the store's internals.
 */
export function resetMetaMoveError(): void {
  useMetaMoveErrorStore.getState().setLastError(undefined);
}

export function useMetaMoveAction(): UseMetaMoveActionResult {
  const { t } = useTranslation();

  const text = useCaptureStore((s) => s.text);
  const targetEntityId = useCaptureStore((s) => s.targetEntityId);
  const targetEntityKind = useCaptureStore((s) => s.targetEntityKind);
  const metaMoveKind = useCaptureStore((s) => s.metaMoveKind);
  const proposing = useCaptureStore((s) => s.proposing);
  const setProposing = useCaptureStore((s) => s.setProposing);

  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';
  const connectionStatus = useWsStore((s) => s.connectionStatus);
  const lastAppliedSequenceForCall = (): number =>
    useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
  const client = useWsClient();

  const lastError = useMetaMoveErrorStore((s) => s.lastError);
  const setLastError = useMetaMoveErrorStore((s) => s.setLastError);

  // Validation — fixed order. The gate chain mirrors `useProposeAction`'s
  // shape but trades the F1 reasons for the meta-move-specific four
  // (target / target-kind / kind / content).
  let validationError: MetaMoveValidationReason | null = null;
  if (sessionId === '') {
    validationError = 'session-missing';
  } else if (connectionStatus !== 'open') {
    validationError = 'not-connected';
  } else if (text.trim().length === 0) {
    validationError = 'content-missing';
  } else if (targetEntityId === null) {
    validationError = 'target-missing';
  } else if (targetEntityKind !== 'node' && targetEntityKind !== 'edge') {
    // Decision §3 of `mod_meta_move_edge_target_gesture.md`: the schema
    // allow-list is `{'node', 'edge'}`. Annotation targets are rejected
    // client-side so the engine's `'target-entity-not-found'` rejection
    // is surfaced as a clearer inline message instead of a confusing
    // wire error. ADR 0036 freezes annotation rejection as a permanent
    // product rule (see
    // `docs/adr/0036-meta-move-target-scope-nodes-and-edges-only.md`).
    validationError = 'target-kind-invalid';
  } else if (metaMoveKind === null) {
    validationError = 'kind-missing';
  }

  const canPropose = validationError === null && !proposing;

  // Auto-dismiss the wire-error region on any user-modification of the
  // capture inputs (Decision §6 mirroring `useProposeAction`). Snapshot
  // the slice values at the moment `lastError` was set so the
  // snapshot-restore-after-failure path doesn't immediately clear the
  // just-set `lastError`; only a real user edit dismisses.
  const lastErrorRef = useRef<WireError | undefined>(lastError);
  const errorSliceSnapshotRef = useRef<{
    text: string;
    targetEntityId: typeof targetEntityId;
    metaMoveKind: typeof metaMoveKind;
  } | null>(null);
  if (lastError !== undefined && lastErrorRef.current === undefined) {
    errorSliceSnapshotRef.current = { text, targetEntityId, metaMoveKind };
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
      baseline.targetEntityId === targetEntityId &&
      baseline.metaMoveKind === metaMoveKind
    ) {
      return;
    }
    setLastError(undefined);
  }, [text, targetEntityId, metaMoveKind, setLastError]);

  async function proposeMetaMove(): Promise<void> {
    // Re-check the gates against call-time state — keystrokes between
    // the last render and this call could have invalidated the form.
    const currentState = useCaptureStore.getState();
    const wsState = useWsStore.getState();
    const sessionIdNow = sessionId;
    const connectionStatusNow = wsState.connectionStatus;
    const textNow = currentState.text;
    const targetEntityIdNow = currentState.targetEntityId;
    const targetEntityKindNow = currentState.targetEntityKind;
    const metaMoveKindNow = currentState.metaMoveKind;

    if (currentState.proposing) return;
    if (sessionIdNow === '') return;
    if (connectionStatusNow !== 'open') return;
    if (textNow.trim().length === 0) return;
    if (targetEntityIdNow === null) return;
    if (targetEntityKindNow !== 'node' && targetEntityKindNow !== 'edge') return;
    if (metaMoveKindNow === null) return;

    // Snapshot the capture slices BEFORE the optimistic clear. On any
    // error path we restore from the snapshot so the moderator can fix
    // and retry without re-typing.
    const snapshot = {
      text: textNow,
      targetEntityId: targetEntityIdNow,
      targetEntityKind: targetEntityKindNow,
      metaMoveKind: metaMoveKindNow,
    };

    setProposing(true);

    try {
      await client.send('propose', {
        sessionId: sessionIdNow,
        expectedSequence: lastAppliedSequenceForCall(),
        proposal: {
          kind: 'meta-move',
          meta_kind: metaMoveKindNow,
          content: textNow,
          // Derived from the staged target kind (Decision §3 of
          // `mod_meta_move_edge_target_gesture.md`). The gate above
          // narrowed `targetEntityKindNow` to `'node' | 'edge'`.
          target_kind: targetEntityKindNow,
          target_id: targetEntityIdNow,
        },
      });

      // Success — clear `text` + `targetEntityId` optimistically (the
      // moderator's next propose starts from an empty draft); leave
      // mode + `metaMoveKind` in place so a follow-up meta-move can be
      // composed in the same mode without re-pressing F8.
      useCaptureStore.setState({
        text: '',
        targetEntityId: null,
        targetEntityKind: 'node',
        proposing: false,
      });
      setLastError(undefined);
    } catch (err) {
      // Failure — restore the snapshot and surface the error inline.
      useCaptureStore.setState({
        text: snapshot.text,
        targetEntityId: snapshot.targetEntityId,
        targetEntityKind: snapshot.targetEntityKind,
        metaMoveKind: snapshot.metaMoveKind,
        proposing: false,
      });
      const timeoutText = t('moderator.metaMoveAction.timeoutError');
      setLastError(toWireError(err, timeoutText));
    }
  }

  return {
    proposeMetaMove,
    canPropose,
    validationError,
    inFlight: proposing,
    lastError,
  };
}
