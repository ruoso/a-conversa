// `<AnnotateSubmenu>` — the small sibling submenu that opens when the
// moderator clicks a node/edge context menu's `annotate` item.
//
// Mirror: apps/moderator/src/layout/AxiomMarkSubmenu.tsx (the
//         outside-click / Escape close-paths; the fixed-position
//         cursor-anchored render; sibling-of-menu render strategy
//         rather than nested submenu).
//
// Renders inside / alongside the node OR edge context menu. Exposes a
// textarea (`annotate-submenu-input`) + a Submit button
// (`annotate-submenu-submit`). The Submit click fires the hook's
// `annotate(content)` callback then closes the submenu on success.
// On failure the submenu stays open so the inline error region is
// visible.
//
// **Per-target.** The submenu opens against ONE target — either a
// node (`target_kind: 'node'`) or an edge (`target_kind: 'edge'`). The
// hook's per-target keying isolates the in-flight + error slices so
// two concurrent annotate gestures against different targets don't
// stomp each other.
//
// **Inline error region.** When `lastError` is non-undefined the
// submenu renders `<div data-testid="annotate-submenu-error">` under
// the input. Catalog mapping for the engine-side rejection codes is
// owned here; transport-layer codes (`timeout`, `unknown`) fall back
// to the hook's pre-resolved `error.message` text.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_METHODOLOGY_TEXT_LENGTH } from '@a-conversa/shared-types';
import type { AnnotationKind } from '@a-conversa/shared-types';

import {
  useAnnotateAction,
  useAnnotateStore,
  annotateStoreKey,
  type AnnotateTargetKind,
  type UseAnnotateActionResult,
  type WireError,
} from './useAnnotateAction';

/**
 * The four canonical annotation kinds the picker surfaces. Wire-format
 * values from `annotationKindSchema`; rendered through the existing
 * `methodology.annotationKind.<kind>` catalog keys (the same ones
 * `<AnnotationBadge>` consumes — DRY).
 */
const ANNOTATION_KINDS: readonly AnnotationKind[] = ['note', 'reframe', 'scope-change', 'stance'];

/**
 * Translator function shape — narrow facade over `react-i18next`'s
 * `TFunction` so this helper stays React-free and easy to test. Mirrors
 * the pattern `resolveAxiomMarkErrorMessage` uses.
 */
export type AnnotateTranslator = (key: string, opts?: { readonly max?: number }) => string;

/**
 * Resolve a localized error message for a `WireError`. Engine-side
 * codes get catalog-mapped messages; transport-layer codes (timeout,
 * unknown, content-empty, content-too-long) reuse the hook's pre-
 * resolved `error.message` text. Exported for direct unit testing.
 */
export function resolveAnnotateErrorMessage(error: WireError, t: AnnotateTranslator): string {
  if (error.code === 'target-entity-not-found') {
    return t('moderator.annotateAction.errorBanner.targetEntityNotFound');
  }
  if (error.code === 'illegal-state-transition') {
    return t('moderator.annotateAction.errorBanner.illegalStateTransition');
  }
  if (error.code === 'timeout') {
    // The hook pre-resolved the localized timeout text into
    // `error.message`; calling the catalog here lets a future override
    // of the timeout key take effect even if a call site bypassed the
    // hook.
    return t('moderator.annotateAction.errorBanner.timeout');
  }
  if (error.code === 'content-empty') {
    return t('moderator.annotateAction.errorBanner.contentEmpty');
  }
  if (error.code === 'content-too-long') {
    return t('moderator.annotateAction.errorBanner.contentTooLong', {
      max: MAX_METHODOLOGY_TEXT_LENGTH,
    });
  }
  if (error.message.length > 0) {
    return error.message;
  }
  return t('moderator.annotateAction.errorBanner.unknown');
}

export interface AnnotateSubmenuProps {
  /** The target entity id the parent context menu targets. */
  readonly targetId: string;
  /** Whether the target is a node, an edge, or an annotation. */
  readonly targetKind: AnnotateTargetKind;
  /** Cursor x-coordinate (client coordinates) where the submenu opens. */
  readonly x: number;
  /** Cursor y-coordinate (client coordinates) where the submenu opens. */
  readonly y: number;
  /** Close handler — fires on outside-click, Escape, or after a successful Submit. */
  readonly onClose: () => void;
  /**
   * Optional initial kind for the kind-radio picker. Defaults to
   * `'note'` (the v1 implicit default per `mod_annotation_kind_tagging`)
   * when omitted. The annotation-context-menu "Disagree with this
   * annotation" item passes `'stance'` here to bias the moderator
   * toward a stance-shaped annotation that frames their disagreement,
   * without forking a separate submenu component. Refinement:
   * `mod_annotation_context_menu`.
   */
  readonly initialAnnotationKind?: AnnotationKind;
  /**
   * Test seam — inject a hook result instead of calling
   * `useAnnotateAction` internally. When omitted (production), the
   * component calls `useAnnotateAction(targetId, targetKind)` itself.
   */
  readonly hookOverride?: UseAnnotateActionResult;
}

export function AnnotateSubmenu(props: AnnotateSubmenuProps): ReactElement {
  const { targetId, targetKind, x, y, onClose, initialAnnotationKind, hookOverride } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [content, setContent] = useState<string>('');
  // Default to `'note'` (the v1 implicit default). See Decisions §1 in
  // `tasks/refinements/moderator-ui/mod_annotation_kind_tagging.md`. The
  // optional `initialAnnotationKind` prop overrides for menu items that
  // pre-bias the picker (e.g. the annotation-context-menu's
  // "Disagree with this annotation" pre-selects `'stance'`).
  const [selectedKind, setSelectedKind] = useState<AnnotationKind>(initialAnnotationKind ?? 'note');

  // Always call the hook (Rules of Hooks). The `hookOverride` shadow
  // is for tests that inject a fully-stubbed result; in production
  // the override is undefined and the real hook drives behavior.
  const realHook = useAnnotateAction(targetId, targetKind);
  const hook = hookOverride ?? realHook;

  // Focus the textarea when the submenu mounts so the moderator can
  // start typing immediately without an extra click.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const handleSubmit = useCallback((): void => {
    void hook.annotate(content, selectedKind).then(() => {
      // Close ONLY on success. On failure the error has landed in the
      // module-scoped store and the submenu stays open so the inline
      // error region is visible.
      //
      // Read the live store state (not the closed-over `hook.lastError`)
      // so we see the just-written error from the hook's catch arm.
      const liveErrors = useAnnotateStore.getState().errors;
      const errorAfter = liveErrors.get(annotateStoreKey(targetKind, targetId));
      if (errorAfter === undefined) {
        onClose();
      }
    });
  }, [hook, content, selectedKind, onClose, targetId, targetKind]);

  const inFlight = hook.inFlight;
  const error = hook.lastError;
  // Submit disabled while in-flight OR when content is empty (cap-
  // aware guard is enforced by the hook on the call too).
  const disableSubmit = inFlight || content.length === 0;

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="annotate-submenu"
      data-target-id={targetId}
      data-target-kind={targetKind}
      style={{ position: 'fixed', top: y, left: x, zIndex: 60 }}
      className="min-w-[18rem] rounded-md border border-slate-200 bg-white p-2 shadow-md"
    >
      <div
        data-testid="annotate-submenu-header"
        className="px-1 py-1 text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {t('moderator.annotateAction.submenu.header')}
      </div>
      <textarea
        ref={inputRef}
        data-testid="annotate-submenu-input"
        aria-label={t('moderator.annotateAction.submenu.inputAriaLabel')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={MAX_METHODOLOGY_TEXT_LENGTH}
        rows={3}
        placeholder={t('moderator.annotateAction.submenu.placeholder')}
        className="my-1 block w-full resize-y rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
      />
      <fieldset className="mt-1 px-1">
        <legend
          data-testid="annotate-submenu-kind-legend"
          className="mb-1 text-xs font-medium text-slate-700"
        >
          {t('moderator.annotateAction.submenu.kindLegend')}
        </legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-1">
          {ANNOTATION_KINDS.map((kind) => {
            const isSelected = selectedKind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`annotate-submenu-kind-${kind}`}
                data-selected={isSelected ? 'true' : 'false'}
                disabled={inFlight}
                onClick={() => setSelectedKind(kind)}
                className={`rounded border px-2 py-1 text-xs ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="font-medium">{t(`methodology.annotationKind.${kind}`)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 px-1 pt-1">
        <button
          type="button"
          data-testid="annotate-submenu-submit"
          data-annotate-state={inFlight ? 'in-flight' : 'idle'}
          disabled={disableSubmit}
          onClick={handleSubmit}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {inFlight
            ? t('moderator.annotateAction.submenu.submitInFlight')
            : t('moderator.annotateAction.submenu.submit')}
        </button>
      </div>
      {error !== undefined ? (
        <div
          data-testid="annotate-submenu-error"
          data-error-code={error.code}
          role="alert"
          className="px-1 pt-1 text-xs text-rose-700"
        >
          {resolveAnnotateErrorMessage(error, (key, opts) =>
            opts === undefined ? t(key) : t(key, opts),
          )}
        </div>
      ) : null}
    </div>
  );
}
