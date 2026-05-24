// `<NodeCardClassificationPalette>` — per-node inline classification
// affordance mounted on `<StatementNode>`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_classification_affordance.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §10)
// Sibling:    apps/moderator/src/layout/ClassificationPalette.tsx
//             (the capture-pane palette — retired from the bottom strip
//             per `pf_mod_capture_pane_wording_only`; the per-node-card
//             gesture takes its place).
//
// **Per-facet refactor (ADR 0030 §1 + §10).** A freshly captured node's
// classification facet enters life `awaiting-proposal`; the moderator
// names a candidate via this palette mounted on the node card. Picking
// a kind fires a `classify-node` propose envelope keyed to the node id.
//
// **Visibility gate.** The palette is mounted by `<StatementNode>` ONLY
// when `wording ∈ {agreed, committed}` AND `classification ===
// 'awaiting-proposal'`. The gate's UI side mirrors the methodology's
// sequential-capture order (wording must settle before classification
// can be named); the server's `pf_sequence_gate_server_enforced` is
// the integrity boundary. When the classification facet itself moves
// past `awaiting-proposal` (a proposal landed), the palette is no
// longer mounted — the per-facet pill row + downstream affordances
// surface the candidate value.
//
// **No store coupling.** Unlike `<ClassificationPalette>` (which binds
// to `useCaptureStore.classification`), this palette has NO shared
// store slice — there could be N node cards on the canvas, each with
// its own palette, and they must not interfere. A click immediately
// dispatches the per-node proposal via `useProposeClassifyNodeAction`.
//
// **No keyboard shortcut.** The capture-pane palette listens for
// document-level `F`/`P`/`V`/`N`/`D` keystrokes against the global
// capture flow. Per-node palettes can't share that listener (which
// node would the keystroke target?). Click-only here; a future task
// can layer a focus-scoped keyboard surface on top.
//
// **Optimistic in-flight.** The palette's buttons disable while the
// `propose` round-trip is in flight; on rejection the palette restores
// and the wire-error region surfaces. The hook's `inFlight` boolean
// drives the disabled state; `lastError` drives the inline region.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { METHODOLOGY_KINDS, type MethodologyKind } from '@a-conversa/i18n-catalogs';

import {
  useProposeClassifyNodeAction,
  type WireError,
} from '../layout/useProposeClassifyNodeAction.js';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface NodeCardClassificationPaletteProps {
  /** The node id this palette mounts on; the propose envelope's `node_id`. */
  readonly nodeId: string;
}

export function NodeCardClassificationPalette(
  props: NodeCardClassificationPaletteProps,
): ReactElement {
  const { nodeId } = props;
  const { t } = useTranslation();
  const { propose, inFlight, lastError } = useProposeClassifyNodeAction(nodeId);

  // Hold the latest propose callback in a ref so the click handler is
  // stable across renders (the hook returns a fresh closure each render,
  // but the binding is per-call lexical so we can wire it directly —
  // the ref is purely a defensive seam for any future memoization).
  const proposeRef = useRef(propose);
  useEffect(() => {
    proposeRef.current = propose;
  }, [propose]);

  function handlePick(event: MouseEvent<HTMLButtonElement>, kind: MethodologyKind): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // `onNodeClick` (which would select the node + auto-stage it as
    // the capture-pane edge target via `<CaptureTargetChip>`). The
    // palette is mounted INSIDE the node card, so a bare click would
    // bubble up to the underlying card div and ReactFlow would treat
    // it as a node-click. The propagation halt isolates the palette's
    // gesture from the canvas selection chain.
    event.stopPropagation();
    void proposeRef.current(kind);
  }

  return (
    <div
      data-testid={`node-card-classification-palette-${nodeId}`}
      data-node-id={nodeId}
      className="mt-1 flex w-full flex-col gap-1"
    >
      <div
        role="group"
        aria-label={t('moderator.classifyNodeAction.paletteAriaLabel')}
        className="flex flex-wrap items-center gap-1"
      >
        <span className="sr-only" data-testid={`node-card-classification-palette-legend-${nodeId}`}>
          {t('moderator.classifyNodeAction.paletteLegend')}
        </span>
        {METHODOLOGY_KINDS.map((kind) => {
          const label = t(`methodology.kind.${kind}`);
          const ariaLabel = t('moderator.classifyNodeAction.kindButtonAriaLabel', { label });
          return (
            <button
              key={kind}
              type="button"
              data-testid={`node-card-classification-palette-button-${nodeId}-${kind}`}
              data-kind={kind}
              data-node-id={nodeId}
              aria-label={ariaLabel}
              disabled={inFlight}
              onClick={(event) => {
                handlePick(event, kind);
              }}
              className={BUTTON_CLASSES}
            >
              {label}
            </button>
          );
        })}
      </div>
      {lastError !== undefined ? (
        <ClassifyNodeErrorRegion nodeId={nodeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface ClassifyNodeErrorRegionProps {
  readonly nodeId: string;
  readonly error: WireError;
}

function ClassifyNodeErrorRegion(props: ClassifyNodeErrorRegionProps): ReactElement {
  const { nodeId, error } = props;
  const { t } = useTranslation();
  return (
    <p
      data-testid={`node-card-classification-palette-error-${nodeId}`}
      data-error-code={error.code}
      role="alert"
      aria-label={t('moderator.classifyNodeAction.errorBanner.errorRoleLabel')}
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
