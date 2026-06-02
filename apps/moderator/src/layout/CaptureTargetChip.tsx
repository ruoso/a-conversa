// `<CaptureTargetChip>` — staged edge-target chip for the bottom-strip
// capture pane.
//
// Refinement: tasks/refinements/moderator-ui/mod_annotation_capture_auto_suggest.md
// Predecessor: tasks/refinements/moderator-ui/mod_target_auto_suggest.md
// Predecessor: tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md
// Design doc: docs/moderator-ui.md (F1 capture flow, step 3)
//
// Mounts into the `bottom-strip-edge-role` sub-slot exposed by
// `<BottomStripCapture>` (the scaffold from `mod_bottom_strip_capture`).
// Reads `targetEntityId` + `targetEntityKind` from `useCaptureStore` and
// `selected` from `useSelectionStore`; writes back to
// `useCaptureStore.setTargetEntity` only via the unified auto-stage
// effect described below. Reads the wording for the staged target from
// `useWsStore` via `selectNodeWordingById` (node-staged) or
// `selectAnnotationContentById` (annotation-staged).
//
// **Unified kind-aware auto-stage no-stomp contract.** A `useRef`
// tracks the last `{ kind, id }` this component wrote via auto-stage.
// The effect runs four cases against the kind-aware
// most-recently-active entity selector (which returns
// `{ kind: 'node' | 'annotation'; id } | null`; edges never qualify):
//   (0) `userHasClearedRef.current === true` → the moderator deliberately
//       cleared via the × button or `Esc`. Stay cleared until the
//       most-recently-active entity changes (by kind OR id); only then
//       de-bump the ref, auto-stage the new entity, and update
//       `lastAutoStagedRef`.
//   (1) `targetEntityId === null` AND the derived entity is non-null →
//       write `{ kind, id }` and remember it.
//   (2) The staged target equals the previously auto-staged
//       `{ kind, id }` AND the derived entity changed (by kind OR id)
//       → re-auto-stage to the new entity (the moderator never
//       overrode; selection just moved, possibly across kinds).
//   (3) The staged target is NOT the previously auto-staged `{ kind,
//       id }` AND non-null → the slice is an override; do NOT stomp.
// The ref-tracked seam is what lets an override survive subsequent
// selection changes without the auto-stage clobbering it. Cross-kind
// transitions are first-class (Decision §4): clicking an annotation
// after staging a node, or vice versa, triggers Case 2 when no
// override is active.
//
// **Override marker.** When `targetEntityId !== null` AND the derived
// most-recently-active entity differs from the staged target (by kind
// OR id), the chip renders a small amber dot marker (informational
// only, screen-reader labelled). The marker is invisible when the
// slice is `null`, and invisible when the slice matches the
// auto-suggestion.
//
// **Clear gesture.** In the filled state the chip also renders a small
// `×` button (testid `capture-target-chip-clear`). Clicking it — or
// pressing `Esc` while focus is outside an editable target — calls
// `setTargetEntityId(null)` AND `setEdgeRole(null)` (coupled clear per
// `mod_edge_role_selector.md` Decision §5: a role-without-target state
// is methodologically nonsensical) and bumps `userHasClearedRef` so the
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
import { useShallow } from 'zustand/react/shallow';
import type { Event } from '@a-conversa/shared-types';

import { useCaptureStore, type EdgeDirection } from '../stores/captureStore';
import { useSelectionStore } from '../stores/selectionStore';
import { selectMostRecentlyActiveEntity } from '../stores/recentlyActiveNode';
import { useWsStore } from '../ws/wsStore';
import {
  selectAnnotationContentById,
  selectEdgeLabelById,
  selectNodeWordingById,
} from '../graph/selectors';
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

const DIRECTION_SELECT_CLASSES =
  'rounded border border-slate-300 bg-white px-1 py-0.5 text-xs font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500';

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
  const stagedTargetKind = useCaptureStore((s) => s.targetEntityKind);
  const setTargetEntityId = useCaptureStore((s) => s.setTargetEntityId);
  const setTargetEntity = useCaptureStore((s) => s.setTargetEntity);
  const setEdgeRole = useCaptureStore((s) => s.setEdgeRole);
  const edgeDirection = useCaptureStore((s) => s.edgeDirection);
  const setEdgeDirection = useCaptureStore((s) => s.setEdgeDirection);
  // `useShallow` is required because the kind-aware selector returns a
  // fresh `{ kind, id }` object each call; without shallow equality
  // Zustand v5's `useSyncExternalStore`-backed subscription would warn
  // about an unstable snapshot and re-render on every store touch.
  const recentlyActiveEntity = useSelectionStore(useShallow(selectMostRecentlyActiveEntity));
  const events = useWsStore((s) => s.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  // Tracks the last `{ kind, id }` this component wrote via auto-stage.
  // The ref distinguishes "the staged target is whatever auto-suggest
  // last wrote" from "the staged target is a deliberate override" —
  // see the file header for the four-case contract. The ref persists
  // across renders without itself triggering a re-render on update.
  // Kind-aware so cross-kind transitions (node↔annotation) participate
  // in Case 2 (Decision §4 of mod_annotation_capture_auto_suggest).
  const lastAutoStagedRef = useRef<{ kind: 'node' | 'annotation'; id: string } | null>(null);

  // Tracks whether the moderator deliberately cleared the target via
  // the × button or `Esc`. `true` after a clear gesture; reset to
  // `false` by Case 0 of the auto-stage effect when the
  // most-recently-active entity changes (a deliberate selection-change
  // re-engages the auto-stage path). Per-mount UI state — the same
  // idiom as `lastAutoStagedRef`.
  const userHasClearedRef = useRef<boolean>(false);

  const handleClear = useCallback(() => {
    setTargetEntityId(null);
    // Coupled clear per `mod_edge_role_selector.md` Decision §5: the
    // edge role is only meaningful while a target is staged, so the
    // single clear sink nulls both slices in one step. Both the ×
    // button and the Esc keyboard gesture reach this handler, so the
    // contract is symmetric across both affordances. `edgeDirection`
    // is reset to the default for the same reason — direction without
    // a target is meaningless.
    setEdgeRole(null);
    setEdgeDirection('targets');
    userHasClearedRef.current = true;
  }, [setTargetEntityId, setEdgeRole, setEdgeDirection]);

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
    if (recentlyActiveEntity === null) return;
    const stagedMatchesLastAuto =
      lastAutoStagedRef.current !== null &&
      stagedTargetId === lastAutoStagedRef.current.id &&
      stagedTargetKind === lastAutoStagedRef.current.kind;
    const activeDiffersFromLastAuto =
      lastAutoStagedRef.current === null ||
      lastAutoStagedRef.current.id !== recentlyActiveEntity.id ||
      lastAutoStagedRef.current.kind !== recentlyActiveEntity.kind;
    // Case 0: the moderator deliberately cleared (via × button or
    // `Esc`). Wait for the most-recently-active entity to change
    // (by kind OR id) before re-engaging the auto-stage path. If the
    // active entity has changed, de-bump the ref and re-stage;
    // otherwise stay cleared.
    if (userHasClearedRef.current) {
      if (activeDiffersFromLastAuto) {
        userHasClearedRef.current = false;
        setTargetEntity(recentlyActiveEntity.kind, recentlyActiveEntity.id);
        lastAutoStagedRef.current = {
          kind: recentlyActiveEntity.kind,
          id: recentlyActiveEntity.id,
        };
      }
      return;
    }
    // Case 1: nothing staged yet — auto-stage.
    if (stagedTargetId === null) {
      setTargetEntity(recentlyActiveEntity.kind, recentlyActiveEntity.id);
      lastAutoStagedRef.current = {
        kind: recentlyActiveEntity.kind,
        id: recentlyActiveEntity.id,
      };
      return;
    }
    // Case 2: the staged target IS the previously auto-staged one
    // (same kind + id) AND the most-recently-active entity has
    // changed (by kind OR id) — re-auto-stage to the new active
    // entity (the moderator never overrode; they just moved
    // selection, possibly across kinds).
    if (stagedMatchesLastAuto && activeDiffersFromLastAuto) {
      setTargetEntity(recentlyActiveEntity.kind, recentlyActiveEntity.id);
      lastAutoStagedRef.current = {
        kind: recentlyActiveEntity.kind,
        id: recentlyActiveEntity.id,
      };
      return;
    }
    // Case 3: the staged target is NOT the previously auto-staged one
    // — the moderator has overridden. Do not stomp. The override
    // survives subsequent selection changes (including cross-kind
    // moves) until the clear gesture (× button / Esc) explicitly
    // clears the slice.
  }, [recentlyActiveEntity, stagedTargetId, stagedTargetKind, setTargetEntity]);

  // Render-side derivation. Resolve the staged target's display label
  // from the events log; fall back to the raw id when the kind-
  // appropriate selector returns null. Per Decision §7 of
  // `mod_propose_annotation_endpoint_gestures.md`, annotation-staged
  // targets resolve through `selectAnnotationContentById` (returns the
  // annotation's `content` body) — moderators distinguish one
  // annotation from another by content more than by kind.
  // Per-kind wording-lookup dispatch. `'node'` → `selectNodeWordingById`;
  // `'annotation'` → `selectAnnotationContentById` (per
  // `mod_propose_annotation_endpoint_gestures` Decision §7);
  // `'edge'` → `selectEdgeLabelById` (per Decision §2 of
  // `mod_meta_move_edge_target_gesture.md`). The edge label is already
  // formatted with role + truncated endpoint snippets, so the chip
  // applies the standard 32-char truncation as a defensive cap rather
  // than as the primary truncation.
  let targetLabel = '';
  if (stagedTargetId !== null) {
    if (stagedTargetKind === 'edge') {
      const edgeLabel = selectEdgeLabelById(events, stagedTargetId);
      targetLabel = edgeLabel === null ? stagedTargetId : truncate(edgeLabel, WORDING_TRUNCATE_AT);
    } else {
      const targetWording =
        stagedTargetKind === 'annotation'
          ? selectAnnotationContentById(events, stagedTargetId)
          : selectNodeWordingById(events, stagedTargetId);
      targetLabel =
        targetWording === null ? stagedTargetId : truncate(targetWording, WORDING_TRUNCATE_AT);
    }
  }

  // Override marker is visible only when the staged target is non-null
  // AND differs (by kind OR id) from the derived most-recently-active
  // entity (the auto-suggestion). The marker is invisible in the empty
  // state and invisible when the staged target IS the auto-suggestion.
  const overrideActive =
    stagedTargetId !== null &&
    recentlyActiveEntity !== null &&
    (stagedTargetId !== recentlyActiveEntity.id || stagedTargetKind !== recentlyActiveEntity.kind);

  if (stagedTargetId === null) {
    return (
      <span
        data-testid="capture-target-chip"
        data-target-kind={stagedTargetKind}
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
      data-target-kind={stagedTargetKind}
      aria-label={t('moderator.captureTargetChip.ariaLabel')}
      className={`${CHIP_BASE_CLASSES} ${CHIP_FILLED_CLASSES}`}
    >
      <select
        data-testid="capture-target-chip-direction"
        aria-label={t('moderator.captureTargetChip.directionAriaLabel')}
        value={edgeDirection}
        onChange={(event) => {
          setEdgeDirection(event.target.value as EdgeDirection);
        }}
        className={DIRECTION_SELECT_CLASSES}
      >
        <option value="targets">{t('moderator.captureTargetChip.directionTargets')}</option>
        <option value="targeted-by">{t('moderator.captureTargetChip.directionTargetedBy')}</option>
      </select>
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
