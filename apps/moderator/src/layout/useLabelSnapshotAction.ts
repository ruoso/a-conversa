// `useLabelSnapshotAction()` — the moderator's F10 snapshot-label
// dispatch hook.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Mirrors `useCommitAction.ts` in shape (module-scoped Zustand slice +
// `submit()` callback + `WireError` mapping + in-flight guard +
// `expectedSequence` read from `useWsStore`). Differs in one way: the
// modal is a singleton (Decision §4 of the refinement) so there is no
// per-slot keying — the slice tracks ONE `inFlight` boolean and ONE
// `lastError`.
//
// On submit success the hook calls `useSnapshotFlowStore.getState().close()`
// so the modal unmounts via the parent subscription (Decision §10). On
// submit failure the hook leaves the modal open and surfaces the error
// via `lastError`; the moderator can retry or cancel.
//
// Label is trimmed + clamped to `MAX_SNAPSHOT_LABEL_LENGTH` before
// dispatch; whitespace-only labels short-circuit with no `client.send`.

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { create } from 'zustand';

import { useWsClient, WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import { MAX_SNAPSHOT_LABEL_LENGTH } from '@a-conversa/shared-types';

import { useWsStore } from '../ws/wsStore';
import { useSnapshotFlowStore } from './useSnapshotFlowStore';

/**
 * Wire-error shape surfaced on `lastError`. Re-declared here (rather
 * than imported from `useCommitAction` / `useEditWordingAction`) so the
 * hook stays independently consumable — same redeclaration the sibling
 * hooks did off `useProposeAction`.
 */
export interface WireError {
  readonly code: string;
  readonly message: string;
}

export interface UseLabelSnapshotActionResult {
  /** Trigger the `label-snapshot` round-trip. No-op while already in flight. */
  submit: (label: string) => Promise<void>;
  /** True while a `label-snapshot` request is in flight. */
  inFlight: boolean;
  /** The wire-error from the last failed submit, or undefined. */
  lastError: WireError | undefined;
}

interface LabelSnapshotState {
  readonly inFlight: boolean;
  readonly lastError: WireError | undefined;
  readonly setInFlight: (flag: boolean) => void;
  readonly setError: (error: WireError | undefined) => void;
}

export const useLabelSnapshotStore = create<LabelSnapshotState>((set) => ({
  inFlight: false,
  lastError: undefined,
  setInFlight: (flag: boolean) => set({ inFlight: flag }),
  setError: (error: WireError | undefined) => set({ lastError: error }),
}));

/**
 * Test seam — reset the module-scoped slice between cases without
 * poking at the store's internals. Mirrors `resetCommitStore()` from
 * the commit hook.
 */
export function resetLabelSnapshotStore(): void {
  useLabelSnapshotStore.setState({ inFlight: false, lastError: undefined });
}

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

export function useLabelSnapshotAction(): UseLabelSnapshotActionResult {
  const { t } = useTranslation();
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const client = useWsClient();
  const inFlight = useLabelSnapshotStore((s) => s.inFlight);
  const lastError = useLabelSnapshotStore((s) => s.lastError);

  async function submit(label: string): Promise<void> {
    if (useLabelSnapshotStore.getState().inFlight) {
      return;
    }

    const trimmed = label.trim().slice(0, MAX_SNAPSHOT_LABEL_LENGTH);
    if (trimmed.length === 0) {
      return;
    }

    const store = useLabelSnapshotStore.getState();
    store.setInFlight(true);
    store.setError(undefined);

    const expectedSequence =
      useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;

    try {
      await client.send('label-snapshot', {
        sessionId,
        expectedSequence,
        label: trimmed,
      });
      useLabelSnapshotStore.getState().setInFlight(false);
      useSnapshotFlowStore.getState().close();
    } catch (err) {
      const timeoutText = t('moderator.snapshotLabelInput.errors.timeout');
      const after = useLabelSnapshotStore.getState();
      after.setInFlight(false);
      after.setError(toWireError(err, timeoutText));
    }
  }

  return { submit, inFlight, lastError };
}
