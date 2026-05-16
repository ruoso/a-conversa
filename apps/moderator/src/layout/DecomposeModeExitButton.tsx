// `<DecomposeModeExitButton>` — decompose-mode exit affordance + target
// wording overlay.
//
// Refinement: tasks/refinements/moderator-ui/mod_decompose_mode.md
// Sibling pattern: apps/moderator/src/layout/ModeBanner.tsx
// ADRs:        docs/adr/0022-no-throwaway-verifications.md
//              docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Renders as a sibling to `<ModeBanner>` inside the
// `bottom-strip-mode-banner` slot of `<BottomStripCapture>`. The two
// components together fill the slot: the banner carries the
// mode-generic label + description; this button carries the
// decompose-specific target-wording overlay + the `×` exit affordance
// + the keyboard Escape handler.
//
// **Visibility gate.** Returns `null` when
// `useCaptureStore((s) => s.mode) !== 'decompose'`. The bottom-strip
// chrome therefore looks identical to the F1 capture pane while idle;
// the decompose-specific surface only mounts when the moderator has
// entered decompose mode via the node context-menu's
// "Propose decompose" item (or via the keyboard shortcut once that
// lands as a separate task).
//
// **Target-wording resolution.** Walks the per-session events log for
// the matching `node-created` event and reads its `payload.wording`.
// Decision §7 of the refinement records why this lives close to the
// component (event-log walk is the canonical source of truth; a
// snapshot stored on the store would risk going stale on a wording
// edit). The walk is O(N events) per render but bounded — typical
// session sizes (≤ 1000 events) make the cost trivial.
//
// **Escape key.** Mounts an `attachCaptureKeymap({ onExitMode })`
// listener only while `mode === 'decompose'`. The keymap's mode-aware
// Escape dispatch routes the keystroke to `onExitMode` (priority over
// `onClearTarget`) per Decision §5 of the refinement.

import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { Event } from '@a-conversa/shared-types';

import { useCaptureStore } from '../stores/captureStore';
import { useWsStore } from '../ws/wsStore';
import { attachCaptureKeymap } from './captureKeymap';

/**
 * Resolve the operator-facing wording for the decompose-target node.
 *
 * Walks the supplied events array for the matching `node-created`
 * event. Returns the payload's `wording` field, or `null` when no
 * matching event has reached the projection yet (a transient
 * inconsistency that the render-path tolerates by rendering an empty
 * overlay).
 *
 * Exported for direct unit testing.
 */
export function resolveDecomposeTargetWording(
  events: readonly Event[],
  nodeId: string | null,
): string | null {
  if (nodeId === null) return null;
  for (const event of events) {
    if (event.kind === 'node-created' && event.payload.node_id === nodeId) {
      return event.payload.wording;
    }
  }
  return null;
}

const EMPTY_EVENTS: readonly Event[] = Object.freeze([]);

export function DecomposeModeExitButton(): ReactElement | null {
  const { t } = useTranslation();
  const mode = useCaptureStore((s) => s.mode);
  const decomposeTargetNodeId = useCaptureStore((s) => s.decomposeTargetNodeId);
  const exitDecomposeMode = useCaptureStore((s) => s.exitDecomposeMode);
  // The session id comes from the route param the moderator console
  // mounts under (`/sessions/:id/operate`). The hook is safe to call
  // unconditionally: when the component renders outside a router (some
  // unit tests), `useParams` returns an empty object and the wording
  // resolution gracefully degrades to `null`.
  const { id: sessionId = '' } = useParams<{ id: string }>();
  const events = useWsStore((state) => state.sessionState[sessionId]?.events ?? EMPTY_EVENTS);

  // Attach the keymap's `onExitMode` handler only while in decompose
  // mode. The keymap routes Escape to `onExitMode` when
  // `useCaptureStore.getState().mode === 'decompose'` (mode-aware
  // priority — Decision §5 of the refinement).
  useEffect(() => {
    if (mode !== 'decompose') return undefined;
    return attachCaptureKeymap({ onExitMode: exitDecomposeMode });
  }, [mode, exitDecomposeMode]);

  if (mode !== 'decompose') return null;

  const wording = resolveDecomposeTargetWording(events, decomposeTargetNodeId);

  return (
    <span
      data-testid="decompose-mode-exit-container"
      className="ml-2 inline-flex items-center gap-2"
    >
      <span data-testid="decompose-mode-target-wording" className="text-xs text-slate-600">
        {wording === null
          ? ''
          : t('moderator.decompose.banner.targetWording', { nodeWording: wording })}
      </span>
      <button
        type="button"
        data-testid="decompose-mode-exit"
        aria-label={t('moderator.decompose.exit.ariaLabel')}
        title={t('moderator.decompose.exit.tooltip')}
        onClick={exitDecomposeMode}
        className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        ×
      </button>
    </span>
  );
}
