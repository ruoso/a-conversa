// `<EdgeShapeCommitAffordance>` — per-edge inline commit affordance for
// the inline `shape` facet, mounted on `<StatementEdge>`'s label
// container.
//
// Refinement: tasks/refinements/per-facet-refactor/pf_mod_edge_shape_commit_affordance.md
// ADR:        docs/adr/0030-per-facet-vote-keying-and-sequential-capture.md (§2, §5, §10)
// Sibling:    apps/moderator/src/graph/EdgeCardSubstanceAffordance.tsx
//             (the per-edge substance picker mounted on the same edge-
//             label portal — this commit affordance stacks BENEATH the
//             role-label pill alongside that picker.)
//
// **Per-facet refactor (ADR 0030 §5).** For edges the facet sequence is
// `shape → substance`. Shape lands inline on `edge-created` (the carriage
// is the edge role) with no proposal sub-kind — there is no
// `propose-edge-shape` in v1. Participants vote `(edge, 'shape')` directly
// via the facet-arm wire shape (`pf_shape_facet_wire_vote`); once every
// current participant has voted `'agree'`, the shape facet is `'agreed'`
// and the moderator's path forward is to commit the facet so the per-
// facet status flips to `'committed'`. This affordance is that commit
// surface.
//
// **Visibility gate.** The affordance is mounted by `<StatementEdge>`
// ONLY when the edge's shape status is `'agreed'`. The status is derived
// narrowly by `deriveEdgeShapeStatus(events, edgeId)` (see
// `edgeShapeStatus.ts`) — the moderator's global `facetStatus.ts` mirror
// skips the shape facet entirely (the local `FacetName` is 3-valued), so
// a NARROW per-edge helper is sufficient for this gate without widening
// the global mirror. When shape moves to `'committed'` (or any non-
// agreed state) the affordance unmounts.
//
// **One button.** Unlike the substance affordance's two-value picker
// (`agreed | disputed`), commit is a single action — "land the agreed
// shape facet". The button label / aria-label reuse the existing
// `moderator.commitButton.*` catalog scope (same user-visible semantics
// as the pending-pane row commit button — Decision: reuse i18n strings,
// avoid translation drift).
//
// **Dispatch.** A click fires `useCommitAction({ entity_kind: 'edge',
// entity_id, facet: 'shape' })` — the same facet-arm commit hook the
// `<PendingProposalsPane>` row uses for facet-valued proposals. The wire
// envelope is `commit { target: 'facet', entity_kind: 'edge', entity_id,
// facet: 'shape' }` per ADR 0030 §2 + the `wsCommitPayloadSchema`
// discriminated union. The server resolves through the
// `commit-handler-facet-keyed` walk per ADR 0030 §2 + `pf_commit_handler_
// facet_keyed`.
//
// **No store coupling.** Like its substance sibling, this affordance has
// NO shared store slice beyond the per-slot `useCommitStore` slice the
// commit hook owns. The slot key is `facet:edge:<edgeId>:shape` so
// concurrent commit attempts on different edges (or on the same edge's
// substance facet) observe disjoint in-flight state.

import { useEffect, useRef, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommitAction, type WireError } from '../layout/useCommitAction.js';

const BUTTON_CLASSES =
  'inline-flex items-center gap-1 rounded border border-emerald-700 bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-800 hover:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500';

const ERROR_REGION_CLASSES =
  'mt-1 text-[0.65rem] leading-snug text-rose-700 break-words whitespace-pre-line';

export interface EdgeShapeCommitAffordanceProps {
  /** The edge id this affordance mounts on; the commit envelope's `entity_id`. */
  readonly edgeId: string;
}

export function EdgeShapeCommitAffordance(props: EdgeShapeCommitAffordanceProps): ReactElement {
  const { edgeId } = props;
  const { t } = useTranslation();
  const { commit, inFlight, lastError } = useCommitAction({
    entity_kind: 'edge',
    entity_id: edgeId,
    facet: 'shape',
  });

  // Hold the latest commit callback in a ref so the click handler is
  // stable across renders. Same defensive seam as the substance sibling.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    // Stop propagation so the click does NOT also fire ReactFlow's
    // edge-selection handler (which would re-select the edge through
    // `GraphCanvasPane`'s `onEdgeClick`). Mirrors `<EdgeCardSubstanceAffordance>`'s
    // propagation halt — the affordance is mounted INSIDE the edge label
    // container; a bare click would bubble up to the underlying label
    // div and ReactFlow would treat it as an edge-click.
    event.stopPropagation();
    void commitRef.current();
  }

  const label = inFlight
    ? t('moderator.commitButton.inFlightLabel')
    : t('moderator.commitButton.label');
  const ariaLabel = t('moderator.commitButton.ariaLabel');
  const commitState: 'enabled' | 'in-flight' = inFlight ? 'in-flight' : 'enabled';

  return (
    <div
      data-testid={`edge-shape-commit-affordance-${edgeId}`}
      data-edge-id={edgeId}
      className="mt-1 flex w-full flex-col gap-1"
    >
      <button
        type="button"
        data-testid={`edge-shape-commit-affordance-button-${edgeId}`}
        data-edge-id={edgeId}
        data-commit-state={commitState}
        aria-label={ariaLabel}
        disabled={inFlight}
        onClick={handleClick}
        className={BUTTON_CLASSES}
      >
        {label}
      </button>
      {lastError !== undefined ? (
        <EdgeShapeCommitErrorRegion edgeId={edgeId} error={lastError} />
      ) : null}
    </div>
  );
}

interface EdgeShapeCommitErrorRegionProps {
  readonly edgeId: string;
  readonly error: WireError;
}

function EdgeShapeCommitErrorRegion(props: EdgeShapeCommitErrorRegionProps): ReactElement {
  const { edgeId, error } = props;
  return (
    <p
      data-testid={`edge-shape-commit-affordance-error-${edgeId}`}
      data-error-code={error.code}
      role="alert"
      className={ERROR_REGION_CLASSES}
    >
      {error.message}
    </p>
  );
}
