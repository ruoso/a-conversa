// `<EditWordingSubmenu>` — the small sibling submenu that opens when the
// moderator clicks the node context menu's `propose-edit-wording` item.
//
// Mirror:     apps/moderator/src/layout/AxiomMarkSubmenu.tsx (the same
//             outside-click / Escape close-paths; the fixed-position
//             cursor-anchored render; the `hookOverride` test seam).
//
// Renders inside / alongside the node context menu. The submenu lets the
// moderator:
//   1. Edit the current wording in a textarea (pre-filled with the
//      node's current wording).
//   2. Pick an explicit edit kind — **Reword** (same statement, clearer
//      phrasing; node id preserved) or **Restructure** (meaningfully
//      different statement; mints a new node id, superseding the
//      original). Per docs/methodology.md the two are methodologically
//      distinct surfaces; we render both choices as equal-weight radio
//      buttons (no default — the moderator must choose).
//   3. Submit the proposal.
//
// **Sibling, not nested.** The submenu does NOT live inside
// `<GraphContextMenu>`'s `items` array — the canvas (`GraphCanvasPane`)
// mounts `<EditWordingSubmenu>` as a sibling render when its
// `editWordingSubmenu` state is non-null. Same placement decision as
// `<AxiomMarkSubmenu>`.
//
// **Inline error region.** When the propose fires and the hook surfaces
// a `lastError`, the submenu renders the localized message inside
// `<div data-testid="edit-wording-submenu-error">`. The submenu stays
// open on failure so the moderator can read the explanation and retry.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';

import {
  useEditWordingAction,
  useEditWordingStore,
  type EditWordingKind,
  type UseEditWordingActionResult,
  type WireError,
} from './useEditWordingAction';

/**
 * Resolve a localized error message for a `WireError`. The engine's
 * three documented rejection codes on the edit-wording path
 * (`target-entity-not-found`, `illegal-state-transition`, `timeout`)
 * get catalog-mapped messages; anything else falls back to `message`
 * verbatim then to the localized generic "unknown" text. Exported for
 * direct unit testing.
 */
export function resolveEditWordingErrorMessage(
  error: WireError,
  t: (key: string) => string,
): string {
  if (error.code === 'target-entity-not-found') {
    return t('moderator.editWordingAction.errorBanner.targetNotFound');
  }
  if (error.code === 'illegal-state-transition') {
    return t('moderator.editWordingAction.errorBanner.illegalStateTransition');
  }
  if (error.code === 'timeout') {
    return t('moderator.editWordingAction.errorBanner.timeout');
  }
  if (error.message.length > 0) {
    return error.message;
  }
  return t('moderator.editWordingAction.errorBanner.unknown');
}

export interface EditWordingSubmenuProps {
  /** The node id the parent context menu targets — the proposal's `node_id`. */
  readonly nodeId: string;
  /** Cursor x-coordinate (client coordinates) where the submenu opens. */
  readonly x: number;
  /** Cursor y-coordinate (client coordinates) where the submenu opens. */
  readonly y: number;
  /**
   * The right-clicked node's current wording — used to pre-fill the
   * textarea so the moderator sees the existing text and edits in
   * place. The canvas reads this from the projected `StatementNodeData`.
   */
  readonly currentWording: string;
  /** Close handler — fires on outside-click, Escape, or after a successful submit. */
  readonly onClose: () => void;
  /**
   * Test seam — inject a hook result instead of calling
   * `useEditWordingAction` internally. When omitted (production), the
   * component calls `useEditWordingAction(nodeId)` itself. The seam
   * lets unit tests stub the WS surface without spinning up a full
   * `WsClientProvider`.
   */
  readonly hookOverride?: UseEditWordingActionResult;
}

export function EditWordingSubmenu(props: EditWordingSubmenuProps): ReactElement {
  const { nodeId, x, y, currentWording, onClose, hookOverride } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Always call the hook (Rules of Hooks). The `hookOverride` shadow
  // is for tests that inject a fully-stubbed result; in production
  // the override is undefined and the real hook drives behavior.
  const realHook = useEditWordingAction(nodeId);
  const hook = hookOverride ?? realHook;

  // Local form state — pre-filled with the current wording. No default
  // edit-kind: per docs/methodology.md the reword-vs-restructure choice
  // is methodologically significant, so we don't pre-select either. The
  // submit button is disabled until the moderator picks.
  const [wording, setWording] = useState<string>(currentWording);
  const [editKind, setEditKind] = useState<EditWordingKind | null>(null);

  // Click-outside + Escape close-paths. Mirrors `<AxiomMarkSubmenu>`'s
  // identical pattern.
  useEffect(() => {
    function handleMouseDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const trimmed = wording.trim();
  const tooLong = wording.length > MAX_METHODOLOGY_TEXT_LENGTH;
  const canSubmit = !hook.inFlight && trimmed.length > 0 && !tooLong && editKind !== null;

  const error = hook.lastError;

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="edit-wording-submenu"
      data-node-id={nodeId}
      style={{ position: 'fixed', top: y, left: x, zIndex: 60 }}
      className="min-w-[20rem] rounded-md border border-slate-200 bg-white p-3 shadow-md"
    >
      <div
        data-testid="edit-wording-submenu-header"
        className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {t('moderator.editWordingAction.submenu.header')}
      </div>
      <label htmlFor={`edit-wording-submenu-input-${nodeId}`} className="sr-only">
        {t('moderator.editWordingAction.submenu.wordingLabel')}
      </label>
      <textarea
        id={`edit-wording-submenu-input-${nodeId}`}
        data-testid="edit-wording-submenu-input"
        value={wording}
        onChange={(e) => setWording(e.target.value)}
        disabled={hook.inFlight}
        rows={4}
        maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
        className="block w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <fieldset className="mt-2">
        <legend
          data-testid="edit-wording-submenu-edit-kind-legend"
          className="mb-1 text-xs font-medium text-slate-700"
        >
          {t('moderator.editWordingAction.submenu.editKindLegend')}
        </legend>
        <div role="radiogroup" className="flex gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={editKind === 'reword'}
            data-testid="edit-wording-submenu-edit-kind-reword"
            data-selected={editKind === 'reword' ? 'true' : 'false'}
            disabled={hook.inFlight}
            onClick={() => setEditKind('reword')}
            className={`flex-1 rounded border px-2 py-1.5 text-sm ${
              editKind === 'reword'
                ? 'border-blue-500 bg-blue-50 text-blue-900'
                : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="block font-medium">
              {t('moderator.editWordingAction.submenu.reword.label')}
            </span>
            <span className="block text-[11px] text-slate-600">
              {t('moderator.editWordingAction.submenu.reword.description')}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={editKind === 'restructure'}
            data-testid="edit-wording-submenu-edit-kind-restructure"
            data-selected={editKind === 'restructure' ? 'true' : 'false'}
            disabled={hook.inFlight}
            onClick={() => setEditKind('restructure')}
            className={`flex-1 rounded border px-2 py-1.5 text-sm ${
              editKind === 'restructure'
                ? 'border-blue-500 bg-blue-50 text-blue-900'
                : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className="block font-medium">
              {t('moderator.editWordingAction.submenu.restructure.label')}
            </span>
            <span className="block text-[11px] text-slate-600">
              {t('moderator.editWordingAction.submenu.restructure.description')}
            </span>
          </button>
        </div>
      </fieldset>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid="edit-wording-submenu-submit"
          data-edit-wording-state={hook.inFlight ? 'in-flight' : 'idle'}
          disabled={!canSubmit}
          onClick={() => {
            if (editKind === null) return;
            void hook.propose(trimmed, editKind).then(() => {
              // Close ONLY on success — read the live store state (not
              // the closed-over `hook.lastError`) so we observe the
              // just-written error from the hook's catch arm.
              const liveErrors = useEditWordingStore.getState().errors;
              if (!liveErrors.has(nodeId)) {
                onClose();
              }
            });
          }}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {hook.inFlight
            ? t('moderator.editWordingAction.submenu.inFlightLabel')
            : t('moderator.editWordingAction.submenu.submitLabel')}
        </button>
      </div>
      {error !== undefined ? (
        <div
          data-testid="edit-wording-submenu-error"
          data-error-code={error.code}
          role="alert"
          className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700"
        >
          {resolveEditWordingErrorMessage(error, t)}
        </div>
      ) : null}
    </div>
  );
}
