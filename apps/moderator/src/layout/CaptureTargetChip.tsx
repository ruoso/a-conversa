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
// component wrote via auto-stage. The effect runs three cases:
//   (1) `targetEntityId === null` AND the derived "most-recently-active
//       node id" is non-null → write the id and remember it.
//   (2) `targetEntityId === lastAutoStagedRef.current` AND the derived
//       id changed → re-auto-stage to the new id (the moderator never
//       overrode; selection just moved).
//   (3) `targetEntityId !== lastAutoStagedRef.current` AND non-null →
//       the slice is an override (a different writer — e.g., the future
//       `mod_target_clear_override` task — wrote a value the auto-stage
//       didn't put there); do NOT stomp.
// The ref-tracked seam is what lets a future override survive subsequent
// selection changes without the auto-stage clobbering it.
//
// **Override marker.** When `targetEntityId !== null` AND the derived
// most-recently-active node id differs from `targetEntityId`, the chip
// renders a small amber dot marker (informational only, screen-reader
// labelled). The marker is invisible when the slice is `null`, and
// invisible when the slice matches the auto-suggestion.
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

import { useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useSelectionStore } from '../stores/selectionStore';
import { selectMostRecentlyActiveNodeId } from '../stores/recentlyActiveNode';
import { useWsStore } from '../ws/wsStore';
import { selectNodeWordingById } from '../graph/selectors';

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
  // file header for the three-case contract. The ref persists across
  // renders without itself triggering a re-render on update.
  const lastAutoStagedRef = useRef<string | null>(null);

  useEffect(() => {
    if (recentlyActiveNodeId === null) return;
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
    // survives subsequent selection changes until the override sibling
    // task's gesture (Esc / × button) explicitly clears the slice.
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
    </span>
  );
}
