// `<KeymapHelpOverlay>` — the `?`-toggled keyboard-shortcut reference
// dialog.
//
// Refinement: tasks/refinements/moderator-ui/mod_keymap_help_overlay.md
//
// A read-only presentational view of `GLOBAL_KEYMAP`: it maps the live
// registry, in registry order, grouped by `category` under localized
// section headers, rendering each row as `formatChord(chord)` (the
// platform glyph, composed presentationally) beside `t(labelKey)` (the
// localized label). It hardcodes NO chord or label string and
// enumerates NO fixed id list — adding/removing a registry row or
// flipping a `reachable` flag changes the rendered panel with zero
// overlay edit (Constraints / Decision §1).
//
// `reachable` drives presentation, not omission: EVERY entry renders.
// `reachable: false` rows dim and carry a localized "coming soon" badge
// plus `data-keymap-entry-reachable="false"`; `reachable: true` rows
// carry `"true"`. This is the seam that surfaces the deferred commit
// chord (and the planned mode chords) as forthcoming today and live the
// instant their flag flips.
//
// Modal idiom mirrors `<SnapshotLabelInputModal>` (Decision §3):
// `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, a fixed
// full-viewport backdrop with a centered card, close on Esc (a local
// window-level listener mounted only while open) / backdrop-click /
// close-button. No focus trap, no focus restoration in v1 — the close
// button is focused on mount (via `useRef`, not `autoFocus`, to keep
// Playwright keyboard assertions deterministic) so Esc/Tab land sanely.

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatChord } from './formatChord';
import { GLOBAL_KEYMAP, type GlobalShortcut } from './globalKeymap';
import { useKeymapHelpStore } from './useKeymapHelpStore';

// Section-header catalog key per registry category. The overlay reads
// this map by the entry's `category` so a new category in the registry
// surfaces as a missing-key parity failure rather than silently
// rendering ungrouped.
const CATEGORY_LABEL_KEY: Record<GlobalShortcut['category'], string> = {
  kind: 'moderator.keymapHelp.category.kind',
  'edge-role': 'moderator.keymapHelp.category.edgeRole',
  'meta-move-kind': 'moderator.keymapHelp.category.metaMoveKind',
  action: 'moderator.keymapHelp.category.action',
  navigation: 'moderator.keymapHelp.category.navigation',
  mode: 'moderator.keymapHelp.category.mode',
};

const KEY_CHIP_CLASSES =
  'rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold leading-none text-slate-700';

/**
 * Group the registry into ordered category buckets, preserving registry
 * order both within a bucket and across buckets (first appearance of a
 * category fixes its position). GLOBAL_KEYMAP already arrives
 * category-blocked, but grouping by first-appearance keeps the overlay
 * correct even if the registry order is later interleaved.
 */
function groupByCategory(
  entries: readonly GlobalShortcut[],
): readonly { category: GlobalShortcut['category']; rows: readonly GlobalShortcut[] }[] {
  const order: GlobalShortcut['category'][] = [];
  const buckets = new Map<GlobalShortcut['category'], GlobalShortcut[]>();
  for (const entry of entries) {
    let bucket = buckets.get(entry.category);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(entry.category, bucket);
      order.push(entry.category);
    }
    bucket.push(entry);
  }
  return order.map((category) => ({ category, rows: buckets.get(category) ?? [] }));
}

export function KeymapHelpOverlay(): ReactElement {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // One-shot mount focus — mirrors the snapshot modal (avoid
  // `autoFocus` because it interferes with Playwright's keyboard-driven
  // focus assertions). No focus trap in v1 (Decision §3).
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Window-level Escape listener, mounted only while the overlay is
  // open. Esc here closes the overlay even though `navigation.esc` also
  // listens at the capture layer — when the overlay is open it is the
  // topmost surface, so closing it is the correct Esc semantics
  // (Constraints / Decision §5).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      useKeymapHelpStore.getState().close();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target !== backdropRef.current) return;
    useKeymapHelpStore.getState().close();
  };

  const handleClose = (): void => {
    useKeymapHelpStore.getState().close();
  };

  const groups = groupByCategory(GLOBAL_KEYMAP);

  return (
    <div
      ref={backdropRef}
      data-testid="keymap-help-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keymap-help-title"
      onMouseDown={handleBackdropMouseDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
    >
      <div className="max-h-[85vh] w-[32rem] max-w-[90vw] overflow-y-auto rounded-md border border-slate-200 bg-white p-4 shadow-md">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="keymap-help-title" className="text-sm font-semibold text-slate-900">
            {t('moderator.keymapHelp.title')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="keymap-help-close"
            aria-label={t('moderator.keymapHelp.closeLabel')}
            onClick={handleClose}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            {t('moderator.keymapHelp.closeLabel')}
          </button>
        </div>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.category} data-keymap-help-category={group.category}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(CATEGORY_LABEL_KEY[group.category])}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {group.rows.map((entry) => (
                  <li
                    key={entry.id}
                    data-testid={`keymap-help-row-${entry.id}`}
                    data-keymap-entry-reachable={entry.reachable ? 'true' : 'false'}
                    className={`flex items-center justify-between gap-3 rounded px-1 py-1 text-sm ${
                      entry.reachable ? 'text-slate-900' : 'text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{t(entry.labelKey)}</span>
                      {entry.reachable ? null : (
                        <span
                          data-testid={`keymap-help-coming-soon-${entry.id}`}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-slate-500"
                        >
                          {t('moderator.keymapHelp.comingSoon')}
                        </span>
                      )}
                    </span>
                    <kbd data-testid={`keymap-help-chord-${entry.id}`} className={KEY_CHIP_CLASSES}>
                      {formatChord(entry.chord)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
