// `<NodeCardSubstanceAffordance>` — per-node inline substance affordance
// mounted on `<StatementNode>`.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_node_card_substance_affordance.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §8, §10)
// Sibling:    apps/moderator/src/graph/NodeCardClassificationPalette.tsx
//             (the classification facet's per-node-card palette — same
//             shape, one facet earlier in the sequential capture order).
//
// **Per-facet refactor (ADR 0030 §1 + §10).** A freshly captured node's
// substance facet enters life `awaiting-proposal`; the moderator names a
// candidate value via this affordance mounted on the node card AFTER
// the classification facet settles. Picking a value fires a
// `set-node-substance` propose envelope keyed to the node id, with
// `value` ∈ `'agreed' | 'disputed'` per `docs/data-model.md:247`:
//   - `'agreed'`  → "the claim holds"
//   - `'disputed'` → "the claim doesn't hold"
//
// **Visibility gate.** The affordance is mounted by `<StatementNode>`
// ONLY when `classification ∈ {agreed, committed}` AND `substance ===
// 'awaiting-proposal'`. The gate's UI side mirrors the methodology's
// sequential-capture order (classification must settle before substance
// can be named); the server's `pf_sequence_gate_server_enforced` is
// the integrity boundary. When the substance facet itself moves past
// `awaiting-proposal` (a proposal landed), the affordance is no
// longer mounted — the per-facet pill row + the `<DisputationTestChip>`
// surface the candidate value.
//
// **No store coupling.** Like its classification sibling, this
// affordance has NO shared store slice — there could be N node cards
// on the canvas, each with its own affordance, and they must not
// interfere. A click immediately dispatches the per-node proposal via
// `useProposeSetNodeSubstanceAction`.
//
// **Two buttons only.** Unlike the five-kind classification palette,
// the substance facet has exactly two values (`agreed` /
// `disputed`); the affordance renders a two-button picker. The labels
// surface the methodology's "holds" / "doesn't hold" phrasing
// (`docs/methodology.md` § "Facets") so the moderator reads the
// substantive intent, not the wire vocabulary.
//
// **Optimistic in-flight.** The affordance's buttons disable while the
// `propose` round-trip is in flight; on rejection the affordance
// restores and the wire-error region surfaces. The hook's `inFlight`
// boolean drives the disabled state; `lastError` drives the inline
// region.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useProposeSetNodeSubstanceAction,
  type SubstanceValue,
  type WireError,
} from '../layout/useProposeSetNodeSubstanceAction.js';

/**
 * Canonical button order — "holds" first, "doesn't hold" second. Reading
 * left-to-right mirrors the methodology's framing ("does the claim
 * hold?") and matches the substance-facet pill's `agreed | disputed`
 * surface ordering in the per-facet pill row.
 */
const SUBSTANCE_VALUES: readonly SubstanceValue[] = ['agreed', 'disputed'];

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface NodeCardSubstanceAffordanceProps {
  /** The node id this affordance mounts on; the propose envelope's `node_id`. */
  readonly nodeId: string;
}

export function NodeCardSubstanceAffordance(props: NodeCardSubstanceAffordanceProps): ReactElement {
  const { nodeId } = props;
  const { t } = useTranslation();
  const { propose, inFlight, lastError } = useProposeSetNodeSubstanceAction(nodeId);

  // Hold the latest propose callback in a ref so the click handler is
  // stable across renders (the hook returns a fresh closure each render,
  // but the binding is per-call lexical so we can wire it directly —
  // the ref is purely a defensive seam for any future memoization).
  const proposeRef = useRef(propose);
  useEffect(() => {
    proposeRef.current = propose;
  }, [propose]);

  function handlePick(event: MouseEvent<HTMLButtonElement>, value: SubstanceValue): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // `onNodeClick` (which would select the node + auto-stage it as
    // the capture-pane edge target via `<CaptureTargetChip>`). The
    // affordance is mounted INSIDE the node card, so a bare click
    // would bubble up to the underlying card div and ReactFlow would
    // treat it as a node-click. The propagation halt isolates the
    // affordance's gesture from the canvas selection chain. Same
    // posture as `<NodeCardClassificationPalette>`.
    event.stopPropagation();
    void proposeRef.current(value);
  }

  return (
    <div
      data-testid={`node-card-substance-affordance-${nodeId}`}
      data-node-id={nodeId}
      className="mt-1 flex w-full flex-col gap-1"
    >
      <div
        role="group"
        aria-label={t('moderator.setNodeSubstanceAction.affordanceAriaLabel')}
        className="flex flex-wrap items-center gap-1"
      >
        <span className="sr-only" data-testid={`node-card-substance-affordance-legend-${nodeId}`}>
          {t('moderator.setNodeSubstanceAction.affordanceLegend')}
        </span>
        {SUBSTANCE_VALUES.map((value) => {
          const label = t(`moderator.setNodeSubstanceAction.valueButton.${value}`);
          const ariaLabel = t('moderator.setNodeSubstanceAction.valueButtonAriaLabel', {
            label,
          });
          return (
            <button
              key={value}
              type="button"
              data-testid={`node-card-substance-affordance-button-${nodeId}-${value}`}
              data-value={value}
              data-node-id={nodeId}
              aria-label={ariaLabel}
              disabled={inFlight}
              onClick={(event) => {
                handlePick(event, value);
              }}
              className={BUTTON_CLASSES}
            >
              {label}
            </button>
          );
        })}
      </div>
      {lastError !== undefined ? (
        <SetNodeSubstanceErrorRegion nodeId={nodeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface SetNodeSubstanceErrorRegionProps {
  readonly nodeId: string;
  readonly error: WireError;
}

function SetNodeSubstanceErrorRegion(props: SetNodeSubstanceErrorRegionProps): ReactElement {
  const { nodeId, error } = props;
  const { t } = useTranslation();
  return (
    <p
      data-testid={`node-card-substance-affordance-error-${nodeId}`}
      data-error-code={error.code}
      role="alert"
      aria-label={t('moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel')}
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
