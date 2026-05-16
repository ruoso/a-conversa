// `<CaptureTargetChip>` — staged edge-target chip for the bottom-strip
// capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 3)
//
// Mounts into the `bottom-strip-edge-role` sub-slot exposed by
// `<BottomStripCapture>` (the scaffold from `mod_bottom_strip_capture`).
// Reads `targetEntityId` from `useCaptureStore` and `selected` from
// `useSelectionStore`; writes back to `useCaptureStore.setTargetEntityId`
// only via the auto-stage effect described below. Reads the wording
// for the staged target from `useWsStore` via the
// `selectNodeWordingById` selector.
//
// **Auto-stage no-stomp contract.** A `useRef` tracks the last id this
// component wrote via auto-stage. The effect runs four cases (the
// 0-case below was added by `mod_target_clear_override`):
//   (0) `userHasClearedRef.current === true` → the moderator deliberately
//       cleared via the × button or `Esc`. Stay cleared until the
//       most-recently-active node id changes (a deliberate
//       selection-change re-engages the auto-stage path); only then
//       de-bump the ref, auto-stage the new id, and update
//       `lastAutoStagedRef`.
//   (1) `targetEntityId === null` AND the derived "most-recently-active
//       node id" is non-null → write the id and remember it.
//   (2) `targetEntityId === lastAutoStagedRef.current` AND the derived
//       id changed → re-auto-stage to the new id (the moderator never
//       overrode; selection just moved).
//   (3) `targetEntityId !== lastAutoStagedRef.current` AND non-null →
//       the slice is an override (a different writer wrote a value the
//       auto-stage didn't put there); do NOT stomp.
// The ref-tracked seam is what lets an override survive subsequent
// selection changes without the auto-stage clobbering it.
//
// **Override marker.** When `targetEntityId !== null` AND the derived
// most-recently-active node id differs from `targetEntityId`, the chip
// renders a small amber dot marker (informational only, screen-reader
// labelled). The marker is invisible when the slice is `null`, and
// invisible when the slice matches the auto-suggestion.
//
// **Clear gesture.** In the filled state the chip also renders a small
// `×` button (testid `capture-target-chip-clear`). Clicking it — or
// pressing `Esc` while focus is outside an editable target — calls
// `setTargetEntityId(null)` and bumps `userHasClearedRef` so the
// auto-stage effect does not immediately re-suggest from the still-
// selected node. The Esc binding routes through
// `attachCaptureKeymap`'s `onClearTarget` handler, which inherits the
// existing modifier-bail / repeat-skip / editable-target guards. See
// `mod_target_clear_override.md` for the full re-engagement contract.
//
// **Wording truncation.** The chip renders the first 32 characters of
// the target node's wording (with `…` if truncated) per Decision §4.
// Wordings are participant-supplied content and not translated; only
// the chip's prefix label is localized.
//
// **Routing coupling.** `useParams()` resolves `sessionId` from the
// operate route's `:id` param per Decision §6. Tests wrap the render in
// `<MemoryRouter initialEntries={['/sessions/test-session/operate']}>`
// to recover the testing-in-isolation ergonomic.

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useSelectionStore } from '../stores/selectionStore';
import { selectMostRecentlyActiveNodeId } from '../stores/recentlyActiveNode';
import { useWsStore } from '../ws/wsStore';
import { selectNodeWordingById } from '../graph/selectors';
import { attachCaptureKeymap, type CaptureKeymapHandlers } from './captureKeymap';

/**
 * Max characters of the target's wording rendered inside the chip
 * before truncation kicks in. The chip is one strip cell wide; 32
 * characters is enough to convey the gist of a typical statement
 * opening and small enough to fit without forcing horizontal scroll.
 * Decision §4 records the rationale.
 */
const WORDING_TRUNCATE_AT = 32;

/**
 * Stable empty `events` reference. Same `===`-stable-across-renders
 * rationale as `EMPTY_EVENTS` in `GraphCanvasPane.tsx` — the Zustand
 * selector returns this constant for sessions with no events yet, so
 * the chip's wording-selector input ref is stable and React's diff
 * short-circuits when nothing else changed.
 */
const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

const CHIP_BASE_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium';

const CHIP_FILLED_CLASSES = 'text-slate-700';

const CHIP_EMPTY_CLASSES = 'text-slate-400';

const OVERRIDE_MARKER_CLASSES = 'inline-block h-1.5 w-1.5 rounded-full bg-amber-500';

const CHIP_CLEAR_BUTTON_CLASSES =
  'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500';

/**
 * Truncate `text` to at most `max` characters, appending `…` when
 * truncation kicks in. Inline because the chip is the only consumer
 * and a 10-line helper does not earn a module of its own.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function CaptureTargetChip(): ReactElement {
  const { t } = useTranslation();
  const { id: sessionId = '' } = useParams<{ id: string }>();

  const stagedTargetId = useCaptureStore((s) => s.targetEntityId);
  const setTargetEntityId = useCaptureStore((s) => s.setTargetEntityId);
  const recentlyActiveNodeId = useSelectionStore(selectMostRecentlyActiveNodeId);
  const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  // Tracks the last id this component wrote via auto-stage. The ref
  // distinguishes "the staged target is whatever auto-suggest last
  // wrote" from "the staged target is a deliberate override" — see the
  // file header for the four-case contract. The ref persists across
  // renders without itself triggering a re-render on update.
  const lastAutoStagedRef = useRef<string | null>(null);

  // Tracks whether the moderator deliberately cleared the target via
  // the × button or `Esc`. `true` after a clear gesture; reset to
  // `false` by Case 0 of the auto-stage effect when the
  // most-recently-active node id changes (a deliberate
  // selection-change re-engages the auto-stage path). Per-mount UI
  // state — the same idiom as `lastAutoStagedRef`.
  const userHasClearedRef = useRef<boolean>(false);

  const handleClear = useCallback(() => {
    setTargetEntityId(null);
    userHasClearedRef.current = true;
  }, [setTargetEntityId]);

  // Hold the latest clear handler in a ref so the document-level
  // listener (attached once on mount) can read fresh values without
  // re-attaching on every render — same ref-then-listener pattern
  // `<ClassificationPalette>` uses for `onPickKind`. Survives
  // strict-mode double-mount.
  const handlersRef = useRef<{ handleClear: () => void }>({ handleClear });
  handlersRef.current = { handleClear };

  useEffect(() => {
    const handlers: CaptureKeymapHandlers = {
      onClearTarget: () => {
        handlersRef.current.handleClear();
      },
    };
    const detach = attachCaptureKeymap(handlers);
    return detach;
  }, []);

  useEffect(() => {
    if (recentlyActiveNodeId === null) return;
    // Case 0: the moderator deliberately cleared (via × button or
    // `Esc`). Wait for the most-recently-active node id to change
    // before re-engaging the auto-stage path. If the active node has
    // changed, de-bump the ref and re-stage; otherwise stay cleared.
    if (userHasClearedRef.current) {
      if (recentlyActiveNodeId !== lastAutoStagedRef.current) {
        userHasClearedRef.current = false;
        setTargetEntityId(recentlyActiveNodeId);
        lastAutoStagedRef.current = recentlyActiveNodeId;
      }
      return;
    }
    // Case 1: nothing staged yet — auto-stage.
    if (stagedTargetId === null) {
      setTargetEntityId(recentlyActiveNodeId);
      lastAutoStagedRef.current = recentlyActiveNodeId;
      return;
    }
    // Case 2: the staged target IS the previously auto-staged one
    // AND the most-recently-active node has changed — re-auto-stage
    // to the new active node (the moderator never overrode; they just
    // moved selection).
    if (stagedTargetId === lastAutoStagedRef.current && stagedTargetId !== recentlyActiveNodeId) {
      setTargetEntityId(recentlyActiveNodeId);
      lastAutoStagedRef.current = recentlyActiveNodeId;
      return;
    }
    // Case 3: the staged target is NOT the previously auto-staged one
    // — the moderator has overridden. Do not stomp. The override
    // survives subsequent selection changes until the clear gesture
    // (× button / Esc) explicitly clears the slice.
  }, [recentlyActiveNodeId, stagedTargetId, setTargetEntityId]);

  // Render-side derivation. Resolve the staged target's display label
  // from the events log; fall back to the raw id when no `node-created`
  // event has been seen for it yet.
  const targetWording =
    stagedTargetId === null ? null : selectNodeWordingById(events, stagedTargetId);
  const targetLabel =
    stagedTargetId === null
      ? ''
      : targetWording === null
        ? stagedTargetId
        : truncate(targetWording, WORDING_TRUNCATE_AT);

  // Override marker is visible only when the staged target is non-null
  // AND differs from the derived most-recently-active node id (the
  // auto-suggestion). The marker is invisible in the empty state and
  // invisible when the staged target IS the auto-suggestion.
  const overrideActive =
    stagedTargetId !== null &&
    recentlyActiveNodeId !== null &&
    stagedTargetId !== recentlyActiveNodeId;

  if (stagedTargetId === null) {
    return (
      <span
        data-testid="capture-target-chip"
        aria-label={t('moderator.captureTargetChip.ariaLabel')}
        className={`${CHIP_BASE_CLASSES} ${CHIP_EMPTY_CLASSES}`}
      >
        <span data-testid="capture-target-chip-label">
          {t('moderator.captureTargetChip.empty')}
        </span>
      </span>
    );
  }

  return (
    <span
      data-testid="capture-target-chip"
      aria-label={t('moderator.captureTargetChip.ariaLabel')}
      className={`${CHIP_BASE_CLASSES} ${CHIP_FILLED_CLASSES}`}
    >
      <span data-testid="capture-target-chip-label">
        {t('moderator.captureTargetChip.suggested', { label: targetLabel })}
      </span>
      {overrideActive ? (
        <span
          data-testid="capture-target-chip-override-marker"
          role="img"
          aria-label={t('moderator.captureTargetChip.overrideMarkerAria')}
          className={OVERRIDE_MARKER_CLASSES}
        />
      ) : null}
      <button
        data-testid="capture-target-chip-clear"
        type="button"
        aria-label={t('moderator.captureTargetChip.clearAria')}
        title={t('moderator.captureTargetChip.clearTitle')}
        onClick={handleClear}
        className={CHIP_CLEAR_BUTTON_CLASSES}
      >
        ×
      </button>
    </span>
  );
}
