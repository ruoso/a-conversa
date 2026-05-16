// `<AxiomMarkSubmenu>` — the small sibling submenu that opens when the
// moderator clicks the node context menu's `axiom-mark` item.
//
// Refinement: tasks/refinements/moderator-ui/mod_axiom_mark_action.md
// Mirror:     apps/moderator/src/graph/GraphContextMenu.tsx (the
//             outside-click / Escape close-paths; the fixed-position
//             cursor-anchored render).
//
// Renders inside / alongside the node context menu. Lists every
// currently-joined non-moderator participant (via
// `deriveCurrentParticipants(events)` from `proposalFacets.ts`) as a
// clickable `<button data-testid="axiom-mark-submenu-participant-{participantId}">`.
// Click fires the hook's `markAxiom(participantId)` callback then
// closes both the submenu and the parent menu.
//
// **Sibling, not nested (Decision §2).** The submenu does NOT live
// inside `<GraphContextMenu>`'s `items` array — that component is
// intentionally a thin flat-list presentation layer. The canvas
// (`GraphCanvasPane`) mounts `<AxiomMarkSubmenu>` as a sibling render
// when `submenuOpen === true` AND the parent context menu is still
// open against a node target. Both close-paths reset the canvas's
// transient state.
//
// **Inline error region (Decision §7).** When a click on a participant
// button fails (hook's `lastErrorFor(participantId)` returns a
// WireError), the submenu renders a localized message inside
// `<div data-testid="axiom-mark-submenu-error">` under the buttons.
// Per Decision §1, the moderator-side path will (in v1) always hit
// the engine's `'axiom-mark-not-self'` rejection — the inline message
// surfaces that with a localized explanation that axiom-marks are
// personal.

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Event } from '@a-conversa/shared-types';

import { deriveCurrentParticipants } from '../graph/proposalFacets';
import {
  axiomMarkStoreKey,
  useAxiomMarkAction,
  useAxiomMarkStore,
  type WireError,
  type UseAxiomMarkActionResult,
} from './useAxiomMarkAction';

/**
 * Walk the session's event log once and collapse `participant-joined`
 * / `participant-left` into a `Map<userId, screenName>` covering the
 * currently-joined non-moderator participants. Mirrors the same
 * `deriveSlotOccupants` collapse in
 * `apps/moderator/src/routes/InviteParticipants.tsx` lines 108-137 —
 * Decision §4 of the refinement keeps the helper local to the submenu
 * for now; a future participants-projection task will lift this to a
 * shared selector module.
 *
 * Exclusion rule: the moderator's `participant-joined` event is
 * filtered out (axiom-marks are per-debater; the moderator is never a
 * mark target).
 *
 * Exported for direct unit testing.
 */
export function derivePartipantScreenNames(events: readonly Event[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'participant-joined') {
      if (event.payload.role === 'moderator') continue;
      out.set(event.payload.user_id, event.payload.screen_name);
      continue;
    }
    if (event.kind === 'participant-left') {
      out.delete(event.payload.user_id);
    }
  }
  return out;
}

/**
 * Resolve a localized error message for a `WireError`. The three codes
 * the engine emits on the axiom-mark path get catalog-mapped messages;
 * timeouts get the localized timeout text the hook already wrote into
 * `message`; anything unmapped falls back to `message` verbatim then
 * to the localized generic "unknown" text. Exported for direct unit
 * testing.
 */
export function resolveAxiomMarkErrorMessage(error: WireError, t: (key: string) => string): string {
  if (error.code === 'axiom-mark-not-self') {
    return t('moderator.axiomMarkAction.errorBanner.notSelf');
  }
  if (error.code === 'timeout') {
    // The hook pre-resolved the localized timeout text into
    // `error.message`; we still call the catalog here so a future
    // catalog override of the timeout key takes effect even if a
    // call site bypassed the hook.
    return t('moderator.axiomMarkAction.errorBanner.timeout');
  }
  if (error.message.length > 0) {
    return error.message;
  }
  return t('moderator.axiomMarkAction.errorBanner.unknown');
}

export interface AxiomMarkSubmenuProps {
  /** The node id the parent context menu targets — the mark's `node_id`. */
  readonly nodeId: string;
  /** Cursor x-coordinate (client coordinates) where the submenu opens. */
  readonly x: number;
  /** Cursor y-coordinate (client coordinates) where the submenu opens. */
  readonly y: number;
  /** The session's event log — used to derive joined participants + screen names. */
  readonly events: readonly Event[];
  /** Close handler — fires on outside-click, Escape, or after a participant button is clicked. */
  readonly onClose: () => void;
  /**
   * Test seam — inject a hook result instead of calling `useAxiomMarkAction`
   * internally. When omitted (production), the component calls
   * `useAxiomMarkAction(nodeId)` itself. The seam lets unit tests
   * stub the WS surface without spinning up a full `WsClientProvider`.
   */
  readonly hookOverride?: UseAxiomMarkActionResult;
}

export function AxiomMarkSubmenu(props: AxiomMarkSubmenuProps): ReactElement {
  const { nodeId, x, y, events, onClose, hookOverride } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Always call the hook (Rules of Hooks). The `hookOverride` shadow
  // is for tests that inject a fully-stubbed result; in production
  // the override is undefined and the real hook drives behavior.
  const realHook = useAxiomMarkAction(nodeId);
  const hook = hookOverride ?? realHook;

  // Derive the current participants + their screen names from the
  // events log. Memoize on the `events` reference — the WS store
  // swaps it immutably on every event, so a fresh reference signals
  // a real change.
  const participantIds = useMemo(() => deriveCurrentParticipants(events), [events]);
  const screenNames = useMemo(() => derivePartipantScreenNames(events), [events]);

  // Sort participantIds for deterministic render order (test
  // assertions rely on a stable order across runs). Sort by the
  // screen name so the visible order matches the alphabetical
  // reading; ties fall back to the userId.
  const sortedParticipantIds = useMemo(() => {
    const ids = Array.from(participantIds);
    ids.sort((a, b) => {
      const aName = screenNames.get(a) ?? a;
      const bName = screenNames.get(b) ?? b;
      const byName = aName.localeCompare(bName);
      if (byName !== 0) return byName;
      return a.localeCompare(b);
    });
    return ids;
  }, [participantIds, screenNames]);

  // Click-outside + Escape close-paths. Mirrors `<GraphContextMenu>`'s
  // identical pattern — both menus share the close-on-outside-click
  // behaviour the moderator expects from desktop graph editors.
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

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="axiom-mark-submenu"
      data-node-id={nodeId}
      style={{ position: 'fixed', top: y, left: x, zIndex: 60 }}
      className="min-w-[14rem] rounded-md border border-slate-200 bg-white py-1 shadow-md"
    >
      <div
        data-testid="axiom-mark-submenu-header"
        className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {t('moderator.axiomMarkAction.submenu.header')}
      </div>
      {sortedParticipantIds.length === 0 ? (
        <div
          data-testid="axiom-mark-submenu-empty"
          role="presentation"
          className="px-3 py-1.5 text-sm italic text-slate-500"
        >
          {t('moderator.axiomMarkAction.submenu.empty')}
        </div>
      ) : (
        <ul role="none" className="m-0 list-none p-0">
          {sortedParticipantIds.map((participantId) => {
            const screenName = screenNames.get(participantId) ?? participantId;
            const label = t('moderator.axiomMarkAction.submenu.participantLabel', {
              participantName: screenName,
            });
            const inFlight = hook.inFlightFor(participantId);
            const error = hook.lastErrorFor(participantId);
            return (
              <li key={participantId} role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`axiom-mark-submenu-participant-${participantId}`}
                  data-participant-id={participantId}
                  data-axiom-mark-state={inFlight ? 'in-flight' : 'idle'}
                  disabled={inFlight}
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    void hook.markAxiom(participantId).then(() => {
                      // Close ONLY on success. On failure, the error
                      // has landed in the module-scoped store and the
                      // submenu stays open so the inline error region
                      // is visible — Decision §7 (inline error region
                      // in the submenu) is load-bearing for the
                      // moderator's understanding of what happened.
                      // Per Decision §1 every moderator-side attempt
                      // hits the engine's `axiom-mark-not-self`
                      // rejection, so closing-on-error would dismiss
                      // the explanation before the moderator could
                      // read it. The moderator dismisses the submenu
                      // explicitly via outside-click / Escape.
                      //
                      // The success path (which lights up once rule 3
                      // is relaxed or the participant-tablet surface
                      // exercises the hook) closes the submenu so the
                      // canvas returns to its idle state.
                      //
                      // Read the live store state (not the closed-over
                      // `hook.lastErrorFor`) so we see the just-written
                      // error from the hook's catch arm — `lastErrorFor`
                      // is a render-time snapshot of the previous
                      // commit's slice.
                      const liveErrors = useAxiomMarkStore.getState().errors;
                      const errorAfter = liveErrors.get(axiomMarkStoreKey(nodeId, participantId));
                      if (errorAfter === undefined) {
                        onClose();
                      }
                    });
                  }}
                >
                  {label}
                </button>
                {error !== undefined ? (
                  <div
                    data-testid="axiom-mark-submenu-error"
                    data-error-code={error.code}
                    role="alert"
                    className="px-3 py-1 text-xs text-rose-700"
                  >
                    {resolveAxiomMarkErrorMessage(error, t)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
