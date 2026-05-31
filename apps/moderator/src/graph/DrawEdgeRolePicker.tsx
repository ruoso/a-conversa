// `<DrawEdgeRolePicker>` — small role-picker popover that opens at the
// drop point when the moderator drags from one statement node's source
// handle to another statement node's target handle on the canvas.
//
// Refinement: tasks/refinements/moderator-ui/mod_draw_edge_flow.md
// Mirrors the cursor-anchored fixed-position render + outside-click /
// Escape close paths of `<AxiomMarkSubmenu>` and `<GraphContextMenu>`.
//
// Wire path: a role pick fires a single `set-edge-substance`
// proposal envelope carrying all four endpoint fields (`source_node_id`
// / `target_node_id` / `role` / a default `value` of `'agreed'`) per
// the connecting-case contract pinned by
// `mod_set_edge_substance_endpoint_carriage`. The server's propose
// handler discriminates on the fresh-edge predicate and emits
// `edge-created` + `entity-included(edge)` + `proposal`, so the new
// edge shows up on the canvas in `proposed` state immediately. The
// substance default is `'agreed'` because the moderator's draw-edge
// gesture asserts the relation holds — participants who disagree
// will move the substance facet via the per-edge affordance after
// the shape facet settles.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { EDGE_ROLES, EDGE_ROLE_TO_SHORTCUT, type EdgeRole } from '@a-conversa/i18n-catalogs';

import { useWsClient, WsRequestError, WsRequestTimeoutError } from '@a-conversa/shell';
import { useWsStore } from '../ws/wsStore';

const ROLE_BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

const KEY_CHIP_CLASSES =
  'ml-0.5 rounded border border-current bg-transparent px-1 text-[0.65rem] font-semibold leading-none opacity-80';

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const b = Array.from(bytes, hex);
  return `${b[0]}${b[1]}${b[2]}${b[3]}-${b[4]}${b[5]}-${b[6]}${b[7]}-${b[8]}${b[9]}-${b[10]}${b[11]}${b[12]}${b[13]}${b[14]}${b[15]}`;
}

/**
 * Kind discriminator for an endpoint id — whether the id names a
 * statement node or a promoted annotation. Drives which polymorphic
 * schema slot the proposal payload routes the id into
 * (`source_node_id` vs `source_annotation_id`, and likewise for
 * `target_*`).
 *
 * Refinement:
 * `tasks/refinements/moderator-ui/mod_propose_annotation_endpoint_gestures.md`.
 */
export type DrawEdgeEndpointKind = 'node' | 'annotation';

export interface DrawEdgeRolePickerProps {
  /** Source endpoint id (where the drag started). */
  readonly source: string;
  /** Source endpoint kind (statement node vs promoted annotation). */
  readonly sourceKind: DrawEdgeEndpointKind;
  /** Target endpoint id (where the drag ended). */
  readonly target: string;
  /** Target endpoint kind (statement node vs promoted annotation). */
  readonly targetKind: DrawEdgeEndpointKind;
  /** Cursor x-coordinate (client coords) where the drop landed. */
  readonly x: number;
  /** Cursor y-coordinate (client coords) where the drop landed. */
  readonly y: number;
  /** Close handler — fires after a role is submitted, on outside-click, or on Escape. */
  readonly onClose: () => void;
}

export function DrawEdgeRolePicker(props: DrawEdgeRolePickerProps): ReactElement {
  const { source, sourceKind, target, targetKind, x, y, onClose } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const client = useWsClient();
  const { id: sessionIdParam } = useParams<{ id: string }>();
  const sessionId = sessionIdParam ?? '';

  const [inFlight, setInFlight] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Click-outside + Escape close — same idiom as the other submenus.
  // The listener is attached once and reads `inFlight` via closure;
  // the dependency on `inFlight` re-attaches so the in-flight gate
  // short-circuits correctly.
  useEffect(() => {
    function handleMouseDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (root === null) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      if (inFlight) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !inFlight) onClose();
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, inFlight]);

  async function handlePick(role: EdgeRole): Promise<void> {
    if (inFlight) return;
    setInFlight(true);
    setErrorMessage(null);
    try {
      const expectedSequence =
        useWsStore.getState().sessionState[sessionId]?.lastAppliedSequence ?? 0;
      // Route each endpoint id to its kind-appropriate schema slot per
      // `set_edge_substance_annotation_endpoint`'s polymorphic widening.
      // Per-endpoint AT-MOST-ONE is enforced by `.refine()` on
      // `setEdgeSubstanceProposalSchema` — write to ONE slot per
      // endpoint and leave the other absent.
      const sourceSlot =
        sourceKind === 'annotation' ? { source_annotation_id: source } : { source_node_id: source };
      const targetSlot =
        targetKind === 'annotation' ? { target_annotation_id: target } : { target_node_id: target };
      await client.send('propose', {
        sessionId,
        expectedSequence,
        proposal: {
          kind: 'set-edge-substance',
          edge_id: randomUuid(),
          value: 'agreed',
          ...sourceSlot,
          ...targetSlot,
          role,
        },
      });
      setInFlight(false);
      onClose();
    } catch (err) {
      setInFlight(false);
      let message: string;
      if (err instanceof WsRequestError) {
        message = err.message;
      } else if (err instanceof WsRequestTimeoutError) {
        message = t('moderator.drawEdgePicker.timeoutError');
      } else if (err instanceof Error) {
        message = err.message;
      } else {
        message = String(err);
      }
      setErrorMessage(message);
    }
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="draw-edge-role-picker"
      data-source-id={source}
      data-source-kind={sourceKind}
      data-target-id={target}
      data-target-kind={targetKind}
      style={{ position: 'fixed', top: y, left: x, zIndex: 60 }}
      className="min-w-[14rem] rounded-md border border-slate-200 bg-white p-2 shadow-md"
    >
      <div
        data-testid="draw-edge-role-picker-header"
        className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {t('moderator.drawEdgePicker.header')}
      </div>
      <div className="flex flex-wrap gap-1">
        {EDGE_ROLES.map((role) => {
          const label = t(`methodology.edgeRole.${role}.label`);
          const description = t(`methodology.edgeRole.${role}.description`);
          const shortcut = EDGE_ROLE_TO_SHORTCUT[role].toUpperCase();
          return (
            <button
              key={role}
              type="button"
              role="menuitem"
              data-testid={`draw-edge-role-picker-button-${role}`}
              data-role={role}
              disabled={inFlight}
              title={description}
              aria-label={t('moderator.edgeRolePalette.roleButtonAriaLabel', {
                label,
                key: shortcut,
              })}
              onClick={() => {
                void handlePick(role);
              }}
              className={ROLE_BUTTON_CLASSES}
            >
              <span>{label}</span>
              <kbd aria-hidden="true" className={KEY_CHIP_CLASSES}>
                {shortcut}
              </kbd>
            </button>
          );
        })}
      </div>
      {errorMessage !== null ? (
        <div
          data-testid="draw-edge-role-picker-error"
          role="alert"
          className="mt-2 px-1 text-xs text-rose-700"
        >
          {t('moderator.drawEdgePicker.errorPrefix', { message: errorMessage })}
        </div>
      ) : null}
    </div>
  );
}
