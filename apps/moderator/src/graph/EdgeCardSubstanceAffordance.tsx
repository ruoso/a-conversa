// `<EdgeCardSubstanceAffordance>` — per-edge inline substance affordance
// mounted on `<StatementEdge>`'s label container.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_card_substance_affordance.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§1, §8, §10)
// Sibling:    apps/moderator/src/graph/NodeCardSubstanceAffordance.tsx
//             (the node-side per-card substance affordance — same
//             two-button picker, same in-flight / error region; this
//             is its edge counterpart, mounted inside the edge label's
//             `<EdgeLabelRenderer>` portal.)
//
// **Per-facet refactor (ADR 0030 §1 + §8).** For edges the facet
// sequence is `shape → substance`. Shape lands inline on
// `edge-created`; once shape settles, substance becomes the next
// facet awaiting a candidate. The moderator names a candidate value
// via this affordance mounted on the edge label. Picking a value
// fires a `set-edge-substance` propose envelope keyed to the edge id,
// with `value` ∈ `'agreed' | 'disputed'` per `docs/data-model.md:248`:
//   - `'agreed'`  → "the relation holds"
//   - `'disputed'` → "the relation doesn't hold"
//
// **Visibility gate.** The affordance is mounted by `<StatementEdge>`
// ONLY when `substance === 'awaiting-proposal'`. The simpler gate
// (vs. the node-side `classification ∈ {agreed, committed} AND
// substance === 'awaiting-proposal'`) is the practical consequence
// of the moderator's `facetStatus.ts` mirror skipping the shape
// facet entirely today — see the refinement Decisions. The server's
// `pf_sequence_gate_server_enforced` is the integrity boundary that
// rejects an out-of-sequence `set-edge-substance` against an
// unsettled shape; the UI gate is the simplest predicate that
// admits the in-sequence case and lets the server reject anything
// else. When the substance facet itself moves past
// `awaiting-proposal` (a proposal landed), the affordance is no
// longer mounted.
//
// **No store coupling.** Like its node sibling, this affordance has
// NO shared store slice — there could be N edges on the canvas, each
// with its own affordance, and they must not interfere. A click
// immediately dispatches the per-edge proposal via
// `useProposeSetEdgeSubstanceAction`.
//
// **Two buttons only.** The substance facet has exactly two values
// (`agreed` / `disputed`); the affordance renders a two-button picker.
// The labels surface the methodology's "holds" / "doesn't hold"
// phrasing — the same i18n strings as the node-side affordance under
// the shared `moderator.setNodeSubstanceAction.*` namespace (per the
// refinement Decisions: identical user-visible labels, one source of
// truth, avoid translation drift).
//
// **Optimistic in-flight.** The affordance's buttons disable while the
// `propose` round-trip is in flight; on rejection the affordance
// restores and the wire-error region surfaces. The hook's `inFlight`
// boolean drives the disabled state; `lastError` drives the inline
// region.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useProposeSetEdgeSubstanceAction,
  type SubstanceValue,
  type WireError,
} from '../layout/useProposeSetEdgeSubstanceAction.js';

/**
 * Canonical button order — "holds" first, "doesn't hold" second. Reading
 * left-to-right mirrors the methodology's framing ("does the relation
 * hold?") and matches the node-side affordance's ordering.
 */
const SUBSTANCE_VALUES: readonly SubstanceValue[] = ['agreed', 'disputed'];

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 disabled:cursor-not-allowed';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface EdgeCardSubstanceAffordanceProps {
  /** The edge id this affordance mounts on; the propose envelope's `edge_id`. */
  readonly edgeId: string;
}

export function EdgeCardSubstanceAffordance(props: EdgeCardSubstanceAffordanceProps): ReactElement {
  const { edgeId } = props;
  const { t } = useTranslation();
  const { propose, inFlight, lastError } = useProposeSetEdgeSubstanceAction(edgeId);

  // Hold the latest propose callback in a ref so the click handler is
  // stable across renders. Same defensive seam as the node-side
  // affordance.
  const proposeRef = useRef(propose);
  useEffect(() => {
    proposeRef.current = propose;
  }, [propose]);

  function handlePick(event: MouseEvent<HTMLButtonElement>, value: SubstanceValue): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // edge-selection handler (which would re-select the edge through
    // `GraphCanvasPane`'s `onEdgeClick`). The affordance is mounted
    // INSIDE the edge label container, so a bare click would bubble
    // up to the underlying label div and ReactFlow would treat it as
    // an edge-click. The propagation halt isolates the affordance's
    // gesture from the canvas selection chain. Same posture as
    // `<NodeCardSubstanceAffordance>`.
    event.stopPropagation();
    void proposeRef.current(value);
  }

  return (
    <div
      data-testid={`edge-card-substance-affordance-${edgeId}`}
      data-edge-id={edgeId}
      className="mt-1 flex w-full flex-col gap-1"
    >
      <div
        role="group"
        aria-label={t('moderator.setNodeSubstanceAction.affordanceAriaLabel')}
        className="flex flex-wrap items-center gap-1"
      >
        <span className="sr-only" data-testid={`edge-card-substance-affordance-legend-${edgeId}`}>
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
              data-testid={`edge-card-substance-affordance-button-${edgeId}-${value}`}
              data-value={value}
              data-edge-id={edgeId}
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
        <SetEdgeSubstanceErrorRegion edgeId={edgeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface SetEdgeSubstanceErrorRegionProps {
  readonly edgeId: string;
  readonly error: WireError;
}

function SetEdgeSubstanceErrorRegion(props: SetEdgeSubstanceErrorRegionProps): ReactElement {
  const { edgeId, error } = props;
  const { t } = useTranslation();
  return (
    <p
      data-testid={`edge-card-substance-affordance-error-${edgeId}`}
      data-error-code={error.code}
      role="alert"
      aria-label={t('moderator.setNodeSubstanceAction.errorBanner.errorRoleLabel')}
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
