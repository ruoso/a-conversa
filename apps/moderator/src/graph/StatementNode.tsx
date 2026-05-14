// `<StatementNode>` — custom ReactFlow node for the moderator's graph.
//
// Refinement: tasks/refinements/moderator-ui/mod_proposed_state_styling.md
// (prior:     tasks/refinements/moderator-ui/mod_annotation_rendering.md,
//             tasks/refinements/moderator-ui/mod_node_rendering.md)
// ADRs:       docs/adr/0004-graph-libraries-reactflow-and-cytoscape.md
//             docs/adr/0024-frontend-i18n-react-i18next-with-icu.md
//
// Every domain node on the moderator's canvas is a "statement" — a
// piece of methodology text with (eventually) a classification. The
// node card renders three things:
//
//   1. The statement wording (the `node-created` payload's `wording`).
//   2. The localized methodology kind label (`methodology.kind.<id>`
//      from the i18n catalog landed by `i18n_methodology_glossary`).
//   3. A decoration row of annotation badges, one per `annotation-
//      created` event whose `target_node_id` is this node. Badges
//      render only when the list is non-empty so the unannotated
//      card stays clean. See `mod_annotation_rendering`.
//
// Classification is null until a `classify-node` proposal has been
// committed (see `projectNodes` in `GraphCanvasPane.tsx`). When kind
// is null we render an em-dash placeholder rather than guessing a
// default — `node-created` carries no classification, and surfacing
// an "uncategorized" state honestly is more useful than a misleading
// default tag.
//
// The visual states (proposed / agreed / disputed / meta-disagreement)
// and the per-facet decorations are owned by separate downstream tasks
// (`mod_proposed_state_styling`, `mod_agreed_state_styling`,
// `mod_disputed_state_styling`, `mod_per_facet_state_visualization`,
// `mod_axiom_mark_decoration`, ...) and layer on top of this card.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeProps } from 'reactflow';
import type { StatementKind } from '@a-conversa/shared-types';

import { AnnotationBadge } from './AnnotationBadge.js';
import type { FacetName, FacetStatus } from './facetStatus.js';
import type { Annotation } from './selectors.js';

/**
 * The shape of `data` ReactFlow hands to `<StatementNode>` via
 * `NodeProps<StatementNodeData>`. Wording and kind come from the
 * `node-created` payload + any committed `classify-node` proposal;
 * `annotations` is enriched in `projectNodes` from the same event log.
 */
export interface StatementNodeData {
  /** The node's wording (verbatim from `node-created` / `edit-wording.reword`). */
  readonly wording: string;
  /**
   * The node's current methodology classification, or `null` when the
   * node has not yet had a `classify-node` proposal committed.
   */
  readonly kind: StatementKind | null;
  /**
   * Annotations targeting this node. Empty when no `annotation-created`
   * event references the node — the badge list is omitted entirely in
   * that case (no empty container in the DOM).
   */
  readonly annotations: readonly Annotation[];
  /**
   * Per-facet `FacetStatus` for this node. Populated by `projectNodes`
   * via `computeFacetStatuses(events)`. Empty when no facet-targeting
   * proposal references the node — the card renders with the solid-
   * border / fully-opaque baseline in that case. The sibling per-facet
   * state-visualization task (`mod_per_facet_state_visualization`)
   * subdivides the card into per-facet slices using this same record.
   */
  readonly facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>;
}

/**
 * The ReactFlow `type` key under which `StatementNode` is registered
 * on `<ReactFlow nodeTypes={...} />`. Hoisted to a constant so the
 * registration and every projected `Node.type` stay in lockstep — a
 * literal typo would silently fall back to ReactFlow's default node
 * (no custom rendering, no localized label).
 */
export const STATEMENT_NODE_TYPE = 'statement';

/**
 * Card-level rollup of the per-facet statuses. Returns `'proposed'` when
 * any facet is `'proposed'` (the conservative "any in flight → card reads
 * as in flight" default per the refinement's Decisions); otherwise
 * `undefined` and the card renders with its solid-border / fully-opaque
 * baseline. The sibling state-styling tasks (`mod_agreed_state_styling`,
 * `mod_disputed_state_styling`) extend this rollup with their own
 * branches; `mod_per_facet_state_visualization` ultimately replaces the
 * rollup with per-facet rendering. Exported so the test suite can pin
 * the rollup logic without re-rendering.
 */
export function cardRollupStatus(
  facetStatuses: Readonly<Partial<Record<FacetName, FacetStatus>>>,
): FacetStatus | undefined {
  for (const status of Object.values(facetStatuses)) {
    if (status === 'proposed') return 'proposed';
  }
  return undefined;
}

export function StatementNode(props: NodeProps<StatementNodeData>): ReactElement {
  const { id, data } = props;
  const { t } = useTranslation();
  const { wording, kind, annotations, facetStatuses } = data;

  // Resolve the kind label off the canonical glossary namespace from
  // `i18n_methodology_glossary`. `t('methodology.kind.fact')` etc.
  // returns the localized string for the active locale; on `null` we
  // render an em-dash placeholder so the card height stays stable
  // regardless of classification state.
  const kindLabel = kind === null ? '—' : t(`methodology.kind.${kind}`);

  // Card-level state-styling rollup. Today only the proposed branch is
  // implemented (this refinement); the sibling `mod_agreed_state_styling`
  // and `mod_disputed_state_styling` tasks extend the same rollup with
  // their own branches on the same `data.facetStatuses` shape. A null
  // rollup means no styling override — the card reads as the existing
  // solid-border / fully-opaque baseline.
  const rollupStatus = cardRollupStatus(facetStatuses);
  const isProposed = rollupStatus === 'proposed';

  // Proposed-state classes per the refinement: replace the default solid
  // `border` with `border-dashed` and dim the card with `opacity-60`.
  // The data attribute is the stable test / downstream-styling seam
  // (Tailwind class strings are not stable across JIT / production
  // builds, but `[data-facet-status="proposed"]` selectors are).
  const cardClassName = isProposed
    ? 'rounded-md border border-dashed border-slate-400 bg-white shadow-sm px-3 py-2 min-w-[12rem] max-w-[18rem] opacity-60'
    : 'rounded-md border border-slate-300 bg-white shadow-sm px-3 py-2 min-w-[12rem] max-w-[18rem]';
  const rootProps = isProposed ? { 'data-facet-status': 'proposed' as const } : {};

  return (
    <div data-testid={`statement-node-${id}`} className={cardClassName} {...rootProps}>
      <p
        data-testid={`statement-node-wording-${id}`}
        className="text-sm text-slate-900 leading-snug whitespace-pre-line break-words"
      >
        {wording}
      </p>
      <p
        data-testid={`statement-node-kind-${id}`}
        className={
          kind === null
            ? 'mt-1 text-xs uppercase tracking-wide text-slate-400'
            : 'mt-1 text-xs uppercase tracking-wide text-slate-500'
        }
      >
        {kindLabel}
      </p>
      {annotations.length > 0 ? (
        <div data-testid={`annotation-badge-list-node-${id}`} className="mt-1 flex flex-wrap gap-1">
          {annotations.map((annotation) => (
            <AnnotationBadge key={annotation.id} annotation={annotation} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
