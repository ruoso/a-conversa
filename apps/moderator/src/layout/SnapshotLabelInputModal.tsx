// `<SnapshotLabelInputModal>` — F10 snapshot-label overlay dialog.
//
// Refinement: tasks/refinements/moderator-ui/mod_snapshot_label_input.md
//
// Centered overlay (full-viewport fixed backdrop + centered card) that
// the moderator types a snapshot label into and submits. Mounted only
// when `useSnapshotFlowStore.isLabelInputOpen === true` (the
// `<SnapshotLabelInputMount>` wrapper handles the lifecycle).
//
// Close-paths (all gated on `!inFlight` per Decision §5 / Constraints):
//   - Escape key (window-level keydown).
//   - Backdrop click (the click target equals the backdrop wrapper —
//     not the card or any descendant).
//   - Cancel button click.
//   - Successful submit — the hook calls `useSnapshotFlowStore.close()`
//     itself on ack arrival (Decision §10), so the modal observes the
//     flag flip and unmounts.
//
// On submit failure the modal stays open with the inline error region
// rendered; the moderator can read the message and retry or cancel.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_SNAPSHOT_LABEL_LENGTH } from '@a-conversa/shared-types';

import { useSnapshotFlowStore } from './useSnapshotFlowStore';
import {
  useLabelSnapshotAction,
  useLabelSnapshotStore,
  type UseLabelSnapshotActionResult,
  type WireError,
} from './useLabelSnapshotAction';

/**
 * Resolve a localized error message for a `WireError`. The three
 * documented codes on the `label-snapshot` write path
 * (`moderator-only`, `sequence-mismatch`, `timeout`) get catalog-mapped
 * messages; anything else falls back to `message` verbatim then to the
 * localized generic "unknown" text. Mirrors
 * `resolveEditWordingErrorMessage` from `EditWordingSubmenu.tsx`.
 */
export function resolveSnapshotLabelInputErrorMessage(
  error: WireError,
  t: (key: string) => string,
): string {
  if (error.code === 'moderator-only') {
    return t('moderator.snapshotLabelInput.errors.moderatorOnly');
  }
  if (error.code === 'sequence-mismatch') {
    return t('moderator.snapshotLabelInput.errors.sequenceMismatch');
  }
  if (error.code === 'timeout') {
    return t('moderator.snapshotLabelInput.errors.timeout');
  }
  if (error.message.length > 0) {
    return error.message;
  }
  return t('moderator.snapshotLabelInput.errors.unknown');
}

export interface SnapshotLabelInputModalProps {
  /**
   * Test seam — inject a hook result instead of calling
   * `useLabelSnapshotAction` internally. Mirrors `EditWordingSubmenu`'s
   * `hookOverride` so unit tests can stub the WS surface without
   * spinning up a `<WsClientProvider>`.
   */
  readonly hookOverride?: UseLabelSnapshotActionResult;
}

export function SnapshotLabelInputModal(props: SnapshotLabelInputModalProps): ReactElement {
  const { hookOverride } = props;
  const { t } = useTranslation();

  const realHook = useLabelSnapshotAction();
  const hook = hookOverride ?? realHook;

  const [label, setLabel] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // One-shot mount focus — mirrors the CaptureTextInput pattern (avoid
  // `autoFocus` because it interferes with Playwright's keyboard-driven
  // focus assertions).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Window-level Escape listener. Reads the LIVE in-flight flag so the
  // closure doesn't capture a stale value across renders. Gated on
  // `!inFlight` per Constraints — the moderator can't accidentally
  // abandon a request mid-flight.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (useLabelSnapshotStore.getState().inFlight) return;
      useSnapshotFlowStore.getState().close();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const trimmed = label.trim();
  const canSubmit =
    !hook.inFlight && trimmed.length > 0 && trimmed.length <= MAX_SNAPSHOT_LABEL_LENGTH;

  const error = hook.lastError;
  const hasError = error !== undefined;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    // Defensive clamp — `maxLength` is honored on type but is bypassed
    // by paste in some legacy browsers and by programmatic value sets
    // in test harnesses (Decision §6).
    if (value.length > MAX_SNAPSHOT_LABEL_LENGTH) {
      setLabel(value.slice(0, MAX_SNAPSHOT_LABEL_LENGTH));
      return;
    }
    setLabel(value);
  };

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    void hook.submit(trimmed);
  };

  const handleCancel = (): void => {
    if (hook.inFlight) return;
    useLabelSnapshotStore.getState().setError(undefined);
    useSnapshotFlowStore.getState().close();
  };

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (hook.inFlight) return;
    if (event.target !== backdropRef.current) return;
    useSnapshotFlowStore.getState().close();
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && canSubmit) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      ref={backdropRef}
      data-testid="snapshot-label-input-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-label-input-title"
      onMouseDown={handleBackdropMouseDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
    >
      <div className="w-[28rem] max-w-[90vw] rounded-md border border-slate-200 bg-white p-4 shadow-md">
        <h2 id="snapshot-label-input-title" className="mb-3 text-sm font-semibold text-slate-900">
          {t('moderator.snapshotLabelInput.title')}
        </h2>
        <label
          htmlFor="snapshot-label-input-field"
          className="block text-xs font-medium text-slate-700"
        >
          {t('moderator.snapshotLabelInput.fieldLabel')}
        </label>
        <input
          ref={inputRef}
          id="snapshot-label-input-field"
          data-testid="snapshot-label-input-field"
          type="text"
          value={label}
          onChange={handleChange}
          onKeyDown={handleInputKeyDown}
          disabled={hook.inFlight}
          maxLength={MAX_SNAPSHOT_LABEL_LENGTH}
          aria-describedby="snapshot-label-input-helper snapshot-label-input-error"
          aria-invalid={hasError}
          placeholder={t('moderator.snapshotLabelInput.placeholder')}
          autoComplete="off"
          spellCheck
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p
          id="snapshot-label-input-helper"
          data-testid="snapshot-label-input-helper"
          className="mt-1 text-xs text-slate-500"
        >
          {t('moderator.snapshotLabelInput.helper', {
            used: label.length,
            max: MAX_SNAPSHOT_LABEL_LENGTH,
          })}
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="snapshot-label-input-cancel"
            disabled={hook.inFlight}
            onClick={handleCancel}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('moderator.snapshotLabelInput.cancelLabel')}
          </button>
          <button
            type="button"
            data-testid="snapshot-label-input-submit"
            data-snapshot-label-state={hook.inFlight ? 'in-flight' : 'idle'}
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hook.inFlight
              ? t('moderator.snapshotLabelInput.inFlightLabel')
              : t('moderator.snapshotLabelInput.submitLabel')}
          </button>
        </div>
        {error !== undefined ? (
          <div
            id="snapshot-label-input-error"
            data-testid="snapshot-label-input-error"
            data-error-code={error.code}
            role="alert"
            className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700"
          >
            {resolveSnapshotLabelInputErrorMessage(error, t)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
